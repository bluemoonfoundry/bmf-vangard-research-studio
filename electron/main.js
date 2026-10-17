import { app, BrowserWindow, ipcMain, session, shell } from 'electron';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { logger } from './lib/logger.main.js';
import { applyContentSecurityPolicy } from './lib/csp.js';
import { secureWebPreferences, applyNavigationGuards } from './lib/windowSecurity.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const INDEX_HTML = path.join(__dirname, '..', 'dist', 'index.html');
const PRELOAD = path.join(__dirname, 'preload.js');

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
    win.loadFile(INDEX_HTML).catch(err => logger.error('Failed to load renderer', err));
    return win;
}

function registerIpcHandlers() {
    ipcMain.handle('app:get-version', () => app.getVersion());
}

app.whenReady().then(() => {
    applyContentSecurityPolicy(session.defaultSession);
    // The renderer never needs camera, microphone, notifications, etc.
    session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));

    registerIpcHandlers();
    createMainWindow();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});
