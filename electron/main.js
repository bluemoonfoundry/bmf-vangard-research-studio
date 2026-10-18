import { app, BrowserWindow, dialog, ipcMain, safeStorage, session, shell } from 'electron';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { logger } from './lib/logger.main.js';
import { applyContentSecurityPolicy } from './lib/csp.js';
import { secureWebPreferences, applyNavigationGuards } from './lib/windowSecurity.js';
import { createProjectSession, toIpcResult } from './lib/projectSession.js';
import { createRecentProjects } from './lib/recentProjects.js';
import { createRecoveryStore } from './lib/recoveryStore.js';
import { atomicWriteFile } from './lib/atomicFileWrite.js';
import { validateExternalUrl } from './lib/ipcSecurity.js';
import { dialogFilters, mediaKind } from './lib/media.js';
import { TEXT_IMPORT_EXTENSIONS } from './lib/textImport.js';
import { createAppSettings } from './lib/appSettings.js';
import { createApiKeyStore } from './lib/apiKeys.js';
import { createLlmService } from './lib/llm/llmService.js';
import { createGeminiAdapter } from './lib/llm/providers/gemini.js';
import { createAnthropicAdapter } from './lib/llm/providers/anthropic.js';
import { createOpenAiAdapter } from './lib/llm/providers/openai.js';
import { resolveTestBaseUrl } from './lib/llm/testOverride.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const INDEX_HTML = path.join(__dirname, '..', 'dist', 'index.html');
const PRELOAD = path.join(__dirname, 'preload.js');

// Test-only override so e2e runs never touch the developer's real recents or recovery snapshots.
if (process.env.VRS_USER_DATA_DIR) {
    app.setPath('userData', process.env.VRS_USER_DATA_DIR);
}

let mainWindow = null;
let recents = null;
let projectSession = null;
let llm = null;
let projectName = null;
let projectDirty = false;
let closeConfirmed = false;

function createMainWindow() {
    const win = new BrowserWindow({
        width: 1280,
        height: 800,
        title: 'Vangard Research Studio',
        show: false,
        webPreferences: secureWebPreferences(PRELOAD),
    });

    applyNavigationGuards(win.webContents, pathToFileURL(INDEX_HTML).href, (url) => {
        shell.openExternal(url).catch(err => logger.warn('openExternal failed', err));
    });
    win.once('ready-to-show', () => win.show());
    win.on('close', (event) => {
        if (!projectDirty || closeConfirmed) return;
        event.preventDefault();
        confirmUnsaved(win).then(async (choice) => {
            if (choice === 'save') {
                // The renderer owns the unsaved state; it saves and then calls app:close-confirmed.
                win.webContents.send('app:save-before-close');
            } else if (choice === 'discard') {
                await projectSession.close({ discardRecovery: true });
                closeConfirmed = true;
                win.close();
            }
        }).catch(err => logger.error('Close confirmation failed', err));
    });
    win.on('closed', () => {
        llm.abortAll();
        projectSession.close().catch(err => logger.warn('Closing project failed', err));
        mainWindow = null;
        closeConfirmed = false;
        projectDirty = false;
    });
    win.loadFile(INDEX_HTML).catch(err => logger.error('Failed to load renderer', err));
    return win;
}

/** @returns {Promise<'save'|'discard'|'cancel'>} */
async function confirmUnsaved(win) {
    const { response } = await dialog.showMessageBox(win, {
        type: 'warning',
        buttons: ['Save', "Don't Save", 'Cancel'],
        defaultId: 0,
        cancelId: 2,
        noLink: true,
        message: `Save changes to "${projectName ?? 'this project'}"?`,
        detail: "Your changes will be lost if you don't save them.",
    });
    return ['save', 'discard', 'cancel'][response];
}

function rememberOpened(result) {
    if (result) projectName = result.manifest.name;
    projectDirty = false;
    return result;
}

/**
 * Registers an IPC handler that only answers the main window and always
 * resolves to a `{ ok, value | error }` envelope (Error properties like `code`
 * don't survive ipcRenderer.invoke rejections).
 */
function handle(channel, fn) {
    ipcMain.handle(channel, (event, ...args) => toIpcResult(async () => {
        if (!mainWindow || event.sender !== mainWindow.webContents) {
            throw Object.assign(new Error('Unexpected IPC sender'), { code: 'FORBIDDEN' });
        }
        return fn(...args);
    }));
}

function registerIpcHandlers() {
    ipcMain.handle('app:get-version', () => app.getVersion());

    handle('app:open-external', async (url) => {
        const error = validateExternalUrl(url);
        if (error) throw Object.assign(new Error(error), { code: 'INVALID' });
        await shell.openExternal(url);
    });

    handle('app:close-confirmed', () => {
        closeConfirmed = true;
        mainWindow?.close();
    });

    handle('project:create', async () => {
        const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
            title: 'Create Research Project',
            buttonLabel: 'Create',
            defaultPath: path.join(app.getPath('documents'), 'Untitled.vrs'),
            properties: ['createDirectory', 'showOverwriteConfirmation'],
        });
        if (canceled || !filePath) return null;
        const root = filePath.toLowerCase().endsWith('.vrs') ? filePath : `${filePath}.vrs`;
        return rememberOpened(await projectSession.create(root));
    });

    handle('project:open', async () => {
        const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
            title: 'Open Research Project',
            properties: ['openDirectory'],
        });
        if (canceled || !filePaths?.length) return null;
        return rememberOpened(await projectSession.open(filePaths[0]));
    });

    handle('project:open-recent', async (root) => rememberOpened(await projectSession.openRecent(root)));
    handle('project:list-recent', () => recents.list());
    handle('project:remove-recent', (root) => recents.remove(String(root)));
    handle('project:close', async (options) => {
        llm.abortAll();
        await projectSession.close({ discardRecovery: options?.discardRecovery === true });
        projectName = null;
        projectDirty = false;
    });
    handle('project:read-doc', (id) => projectSession.readDoc(id));
    handle('project:read-chat', (id) => projectSession.readChat(id));
    handle('project:read-structure', () => projectSession.readStructure());
    handle('project:read-asset', (name) => projectSession.readAsset(name));
    handle('project:import-media', async (kind) => {
        const { label } = mediaKind(kind);
        const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
            title: `Import ${label}`,
            properties: ['openFile'],
            filters: dialogFilters(kind),
        });
        if (canceled || !filePaths?.length) return null;
        return projectSession.importAsset(filePaths[0], kind);
    });
    handle('project:import-texts', async () => {
        const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
            title: 'Import Chat Transcripts',
            properties: ['openFile', 'multiSelections'],
            // AI Studio's Drive files have no extension, so "All files" stays available.
            filters: [{ name: 'Chat transcripts', extensions: TEXT_IMPORT_EXTENSIONS }, { name: 'All files', extensions: ['*'] }],
        });
        if (canceled || !filePaths?.length) return null;
        return projectSession.readTextImports(filePaths);
    });
    handle('project:export-dossier', async (markdown) => {
        if (typeof markdown !== 'string') throw Object.assign(new Error('Dossier must be text.'), { code: 'INVALID' });
        const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
            title: 'Export Research Dossier',
            buttonLabel: 'Export',
            defaultPath: path.join(app.getPath('documents'), `${projectName ?? 'Research'} dossier.md`),
            filters: [{ name: 'Markdown', extensions: ['md'] }],
            properties: ['showOverwriteConfirmation'],
        });
        if (canceled || !filePath) return null;
        // The destination comes from the native dialog, so it may be anywhere the user chose.
        await atomicWriteFile(filePath, markdown);
        return filePath;
    });
    handle('project:save', async (payload) => {
        const result = await projectSession.save(payload);
        projectName = result.manifest.name;
        return result;
    });
    handle('project:write-recovery', (snapshot) => projectSession.writeRecovery(snapshot));
    handle('project:discard-recovery', () => projectSession.discardRecovery());
    handle('project:set-dirty', (dirty) => {
        projectDirty = dirty === true;
        mainWindow?.setDocumentEdited(projectDirty);
    });
    handle('project:confirm-unsaved', () => confirmUnsaved(mainWindow));

    // AI layer. Every llm:* channel except the key-management ones is refused while AI is off (see llmService).
    handle('settings:get-ai', () => llm.getStatus());
    handle('settings:set-ai', (patch) => llm.setSettings(patch));
    handle('llm:save-key', (provider, key) => llm.saveKey(provider, key));
    handle('llm:remove-key', (provider) => llm.removeKey(provider));
    handle('llm:reset-keys', () => llm.resetKeys());
    handle('llm:test', (provider) => llm.testKey(provider));
    handle('llm:list-models', (provider, options) => llm.listModels(provider, { refresh: options?.refresh === true }));
    handle('llm:chat-start', (requestId, request) => llm.startChat(requestId, request));
    handle('llm:chat-cancel', (requestId) => llm.cancel(requestId));
    handle('llm:cancel-all', () => llm.cancelAll());
    handle('llm:extract', (requestId, request) => llm.extract(requestId, request));
    handle('llm:extract-cancel', (requestId) => llm.cancelExtract(requestId));
}

function createLlm(userData) {
    // Test-only override so e2e runs talk to a local fake provider instead of the real APIs.
    // Honoured only unpackaged and for a loopback origin, since it would receive decrypted keys.
    const { baseUrl, warning } = resolveTestBaseUrl(process.env.VRS_LLM_BASE_URL, { isPackaged: app.isPackaged });
    if (warning) logger.warn(warning);
    return createLlmService({
        settings: createAppSettings(path.join(userData, 'settings.json')),
        keys: createApiKeyStore(path.join(userData, 'ai-keys.json'), safeStorage),
        adapters: {
            gemini: createGeminiAdapter({ baseUrl }),
            anthropic: createAnthropicAdapter({ baseUrl }),
            openai: createOpenAiAdapter({ baseUrl }),
        },
        emit: (requestId, event) => {
            if (!mainWindow || mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) return;
            try {
                mainWindow.webContents.send('llm:chat-event', { requestId, event });
            } catch (err) {
                // Never log the event: it carries chat text.
                logger.warn('Sending a chat event failed', err?.message);
            }
        },
    });
}

app.whenReady().then(() => {
    applyContentSecurityPolicy(session.defaultSession);
    // The renderer never needs camera, microphone, notifications, etc.
    session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));

    const userData = app.getPath('userData');
    recents = createRecentProjects(path.join(userData, 'recent-projects.json'));
    projectSession = createProjectSession({
        recents,
        recovery: createRecoveryStore(path.join(userData, 'recovery')),
        onExternalChange: (changes) => mainWindow?.webContents.send('project:external-change', changes),
        onWatchError: (err) => logger.warn('Project watcher error', err),
    });
    llm = createLlm(userData);

    registerIpcHandlers();
    mainWindow = createMainWindow();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) mainWindow = createMainWindow();
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});
