const DB_NAME = 'tohwpx-workspace';
const DB_VERSION = 1;
const RUN_STORE = 'runs';
const PRESET_STORE = 'presets';
const HISTORY_ENABLED_KEY = 'tohwpx_history_enabled';
const MAX_RUNS = 30;
const MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000;
const MAX_PRESETS = 20;

const OPTION_KEYS = new Set([
    'docType', 'titleSource', 'docFont', 'fontSize', 'paperSize', 'orientation',
    'lineSpacing', 'showHorizontalRules', 'govDocIndent', 'paragraphSpacing',
    'headingStyle', 'tableStyle', 'linkStyle', 'imageMaxWidth', 'imageAlign',
    'titleBodyPolicy', 'stylePolicy', 'pageMargins', 'autoDownload',
]);

function openDb() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onerror = () => reject(request.error);
        request.onupgradeneeded = () => {
            const db = request.result;
            if (!db.objectStoreNames.contains(RUN_STORE)) {
                const store = db.createObjectStore(RUN_STORE, { keyPath: 'id' });
                store.createIndex('completedAt', 'completedAt');
            }
            if (!db.objectStoreNames.contains(PRESET_STORE)) {
                const store = db.createObjectStore(PRESET_STORE, { keyPath: 'id' });
                store.createIndex('updatedAt', 'updatedAt');
            }
        };
        request.onsuccess = () => resolve(request.result);
    });
}

function requestResult(request) {
    return new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

async function allFrom(storeName) {
    const db = await openDb();
    try {
        return await requestResult(db.transaction(storeName, 'readonly').objectStore(storeName).getAll());
    } finally {
        db.close();
    }
}

function cleanText(value, max = 200) {
    return String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, '').slice(0, max);
}

export function sanitizeWorkspaceOptions(options = {}) {
    const safe = {};
    for (const [key, value] of Object.entries(options)) {
        if (!OPTION_KEYS.has(key)) continue;
        if (key === 'pageMargins' && value && typeof value === 'object') {
            safe.pageMargins = {};
            for (const side of ['top', 'bottom', 'left', 'right', 'header', 'footer']) {
                const n = Number(value[side]);
                if (Number.isFinite(n)) safe.pageMargins[side] = n;
            }
        } else if (['string', 'number', 'boolean'].includes(typeof value)) {
            safe[key] = value;
        }
    }
    return safe;
}

export function historyEnabled() {
    try { return localStorage.getItem(HISTORY_ENABLED_KEY) !== 'false'; } catch { return true; }
}

export function setHistoryEnabled(enabled) {
    try { localStorage.setItem(HISTORY_ENABLED_KEY, String(Boolean(enabled))); } catch {}
}

export async function recordRun(run) {
    if (!historyEnabled()) return;
    const now = Date.now();
    const safe = {
        id: `run_${now}_${Math.random().toString(36).slice(2, 8)}`,
        completedAt: now,
        files: (run.files || []).slice(0, 100).map(file => ({
            name: cleanText(file.name),
            ext: cleanText(file.ext, 12),
            size: Math.max(0, Number(file.size) || 0),
            status: ['done', 'warn', 'error'].includes(file.status) ? file.status : 'error',
            outputName: cleanText(file.outputName),
            audit: cleanText(file.audit, 240),
        })),
        summary: {
            total: Math.max(0, Number(run.summary?.total) || 0),
            ok: Math.max(0, Number(run.summary?.ok) || 0),
            warn: Math.max(0, Number(run.summary?.warn) || 0),
            error: Math.max(0, Number(run.summary?.error) || 0),
            durationMs: Math.max(0, Number(run.summary?.durationMs) || 0),
            outputBytes: Math.max(0, Number(run.summary?.outputBytes) || 0),
        },
        options: sanitizeWorkspaceOptions(run.options),
    };
    const db = await openDb();
    try {
        await requestResult(db.transaction(RUN_STORE, 'readwrite').objectStore(RUN_STORE).put(safe));
    } finally { db.close(); }
    await pruneRuns();
}

async function pruneRuns() {
    const all = (await allFrom(RUN_STORE)).sort((a, b) => b.completedAt - a.completedAt);
    const cutoff = Date.now() - MAX_AGE_MS;
    const remove = all.filter((item, index) => index >= MAX_RUNS || item.completedAt < cutoff);
    if (!remove.length) return;
    const db = await openDb();
    try {
        const tx = db.transaction(RUN_STORE, 'readwrite');
        for (const item of remove) tx.objectStore(RUN_STORE).delete(item.id);
        await new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); });
    } finally { db.close(); }
}

export async function listRuns() {
    await pruneRuns();
    return (await allFrom(RUN_STORE)).sort((a, b) => b.completedAt - a.completedAt);
}

export async function clearRuns() {
    const db = await openDb();
    try { await requestResult(db.transaction(RUN_STORE, 'readwrite').objectStore(RUN_STORE).clear()); }
    finally { db.close(); }
}

export async function savePreset(name, options) {
    const all = await listPresets();
    if (all.length >= MAX_PRESETS) throw new Error(`프리셋은 최대 ${MAX_PRESETS}개까지 저장할 수 있습니다.`);
    const now = Date.now();
    const preset = {
        id: `preset_${now}_${Math.random().toString(36).slice(2, 8)}`,
        name: cleanText(name || '내 설정', 40),
        updatedAt: now,
        options: sanitizeWorkspaceOptions(options),
    };
    const db = await openDb();
    try { await requestResult(db.transaction(PRESET_STORE, 'readwrite').objectStore(PRESET_STORE).put(preset)); }
    finally { db.close(); }
    return preset;
}

export async function listPresets() {
    return (await allFrom(PRESET_STORE)).sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function deletePreset(id) {
    const db = await openDb();
    try { await requestResult(db.transaction(PRESET_STORE, 'readwrite').objectStore(PRESET_STORE).delete(id)); }
    finally { db.close(); }
}

export const HISTORY_SCHEMA = Object.freeze({
    db: DB_NAME,
    stores: [RUN_STORE, PRESET_STORE],
    forbidden: ['bytes', 'text', 'ir', 'blob', 'url', 'source'],
});
