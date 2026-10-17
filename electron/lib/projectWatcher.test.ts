import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import path from 'path';
import { createProjectWatcher } from './projectWatcher.js';

const ROOT = path.resolve('/projects/A.vrs');

type Listener = (eventType: string, filename: string | null) => void;

function setup(files: Record<string, string> = {}) {
    let listener: Listener = () => {};
    const closed = { value: false };
    const watchFn = vi.fn((_root: string, _opts: object, cb: Listener) => {
        listener = cb;
        return { close: () => { closed.value = true; }, on: () => {} };
    });
    const readFileFn = vi.fn(async (full: string) => {
        const rel = path.relative(ROOT, full).split(path.sep).join('/');
        if (!(rel in files)) throw Object.assign(new Error('missing'), { code: 'ENOENT' });
        return files[rel];
    });
    const onChange = vi.fn();
    const watcher = createProjectWatcher(ROOT, { onChange, debounceMs: 100, watchFn, readFileFn });
    const emit = (filename: string | null, eventType = 'change') => listener(eventType, filename);
    return { watcher, files, emit, onChange, watchFn, closed };
}

beforeEach(() => {
    vi.useFakeTimers();
});

afterEach(() => {
    vi.useRealTimers();
});

describe('projectWatcher', () => {
    it('watches the project folder recursively', () => {
        const { watchFn } = setup();
        expect(watchFn).toHaveBeenCalledWith(ROOT, { recursive: true }, expect.any(Function));
    });

    it('batches events and reports changed paths with forward slashes', async () => {
        const { emit, onChange } = setup({ 'docs/a.md': 'edited', 'tree.json': '{}' });
        emit(path.join('docs', 'a.md'));
        emit(path.join('docs', 'a.md'));
        emit('tree.json');
        await vi.advanceTimersByTimeAsync(100);
        expect(onChange).toHaveBeenCalledTimes(1);
        expect(onChange).toHaveBeenCalledWith([
            { path: 'docs/a.md', deleted: false },
            { path: 'tree.json', deleted: false },
        ]);
    });

    it('ignores its own writes', async () => {
        const { watcher, emit, onChange } = setup({ 'docs/a.md': 'mine' });
        watcher.noteWrite('docs/a.md', 'mine');
        emit('docs/a.md');
        await vi.advanceTimersByTimeAsync(100);
        expect(onChange).not.toHaveBeenCalled();
    });

    it('reports an external edit made after its own write', async () => {
        const { watcher, files, emit, onChange } = setup({ 'docs/a.md': 'mine' });
        watcher.noteWrite('docs/a.md', 'mine');
        files['docs/a.md'] = 'theirs';
        emit('docs/a.md');
        await vi.advanceTimersByTimeAsync(100);
        expect(onChange).toHaveBeenCalledWith([{ path: 'docs/a.md', deleted: false }]);
    });

    it('reports each external content change once', async () => {
        const { emit, onChange } = setup({ 'docs/a.md': 'theirs' });
        emit('docs/a.md');
        await vi.advanceTimersByTimeAsync(100);
        emit('docs/a.md');
        await vi.advanceTimersByTimeAsync(100);
        expect(onChange).toHaveBeenCalledTimes(1);
    });

    it('reports external deletions but not its own', async () => {
        const { watcher, emit, onChange } = setup();
        watcher.noteWrite('docs/mine.md', null);
        emit('docs/mine.md', 'rename');
        emit('docs/theirs.md', 'rename');
        await vi.advanceTimersByTimeAsync(100);
        expect(onChange).toHaveBeenCalledWith([{ path: 'docs/theirs.md', deleted: true }]);
    });

    it.each([
        ['atomic-write temp files', 'docs/.a.md.tmp-1234abcd'],
        ['dot folders', '.git/index'],
        ['migration backups', 'vrs.json.v1.bak'],
        ['a null filename', null],
    ])('ignores %s', async (_label, filename) => {
        const { emit, onChange } = setup({ [String(filename)]: 'x' });
        emit(filename);
        await vi.advanceTimersByTimeAsync(100);
        expect(onChange).not.toHaveBeenCalled();
    });

    it('stops reporting after close', async () => {
        const { watcher, emit, onChange, closed } = setup({ 'docs/a.md': 'x' });
        emit('docs/a.md');
        watcher.close();
        await vi.advanceTimersByTimeAsync(100);
        expect(closed.value).toBe(true);
        expect(onChange).not.toHaveBeenCalled();
    });
});
