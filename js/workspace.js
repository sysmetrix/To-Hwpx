import {
    clearRuns, deletePreset, historyEnabled, listPresets, listRuns, recordRun,
    savePreset, setHistoryEnabled,
} from './workspace-history.js';

const ROUTES = new Set(['start', 'prepare', 'settings', 'result', 'history', 'guide']);
let callbacks = {};
let queueCount = 0;
let resultReady = false;

function routeFromHash() {
    const raw = location.hash.replace(/^#\/?/, '').split(/[?&]/)[0];
    if (raw === 'converter') return queueCount ? 'settings' : 'start';
    if (raw === 'formats') return 'guide';
    return ROUTES.has(raw) ? raw : 'start';
}

function makeButton(label, action, className = '') {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    if (className) button.className = className;
    button.addEventListener('click', action);
    return button;
}

function formatWhen(timestamp) {
    try { return new Intl.DateTimeFormat('ko-KR', { dateStyle: 'medium', timeStyle: 'short' }).format(timestamp); }
    catch { return new Date(timestamp).toLocaleString(); }
}

function formatBytes(bytes) {
    const n = Number(bytes) || 0;
    if (n < 1024) return `${n}B`;
    if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)}KB`;
    return `${(n / 1024 ** 2).toFixed(1)}MB`;
}

function validRoute(route) {
    if ((route === 'prepare' || route === 'settings') && !queueCount && !callbacks.hasInput?.()) return 'start';
    if (route === 'result' && !resultReady && !callbacks.isConverting?.()) return queueCount ? 'settings' : 'start';
    return route;
}

function renderRoute() {
    const route = validRoute(routeFromHash());
    if (route !== routeFromHash()) {
        history.replaceState(null, '', `#/` + route);
    }
    document.body.dataset.workspaceRoute = route;
    const hero = document.querySelector('.hero');
    const converter = document.getElementById('converter');
    const formats = document.getElementById('formats');
    const historyPage = document.getElementById('workspace-history');
    const steps = document.getElementById('workspace-steps');
    if (hero) hero.hidden = route !== 'start';
    if (converter) converter.hidden = !['prepare', 'settings', 'result'].includes(route);
    if (formats) formats.hidden = route !== 'guide';
    if (historyPage) historyPage.hidden = route !== 'history';
    if (steps) steps.hidden = !queueCount || ['start', 'history', 'guide'].includes(route);

    document.querySelectorAll('[data-workspace-route]').forEach(button => {
        const target = button.dataset.workspaceRoute;
        const unavailable = (['prepare', 'settings'].includes(target) && !queueCount)
            || (target === 'result' && !resultReady && !callbacks.isConverting?.());
        button.disabled = unavailable;
        button.classList.toggle('is-current', target === route);
        if (target === route) button.setAttribute('aria-current', 'step');
        else button.removeAttribute('aria-current');
    });
    if (route === 'history') renderHistory();
    if (route === 'start') renderRecentStart();
    requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: 'instant' }));
}

export function goWorkspace(route) {
    const next = validRoute(ROUTES.has(route) ? route : 'start');
    if (location.hash === `#/${next}`) renderRoute();
    else location.hash = `#/${next}`;
}

async function renderRecentStart() {
    const host = document.getElementById('recent-start-list');
    const section = document.getElementById('recent-start');
    if (!host || !section) return;
    const runs = historyEnabled() ? (await listRuns()).slice(0, 2) : [];
    section.hidden = !runs.length;
    host.replaceChildren();
    for (const run of runs) {
        const item = document.createElement('article');
        item.className = 'recent-start-item';
        const copy = document.createElement('div');
        const title = document.createElement('strong');
        title.textContent = run.files.map(file => file.name).slice(0, 2).join(' · ') || '이전 변환';
        const meta = document.createElement('span');
        meta.textContent = `${formatWhen(run.completedAt)} · 성공 ${run.summary.ok} · 경고 ${run.summary.warn} · 실패 ${run.summary.error}`;
        copy.append(title, meta);
        item.append(copy, makeButton('설정 다시 쓰기', () => restoreOptions(run.options)));
        host.append(item);
    }
}

function restoreOptions(options, source = 'history') {
    callbacks.applyOptions?.(options || {});
    callbacks.track?.('workspace_settings_restore', { source });
    goWorkspace('start');
    callbacks.notify?.('설정을 복원했습니다. 원본 파일을 다시 선택해 주세요.');
}

async function renderHistory() {
    const historyHost = document.getElementById('history-list');
    const presetHost = document.getElementById('preset-list');
    const enabled = document.getElementById('history-enabled');
    if (enabled) enabled.checked = historyEnabled();
    if (historyHost) {
        historyHost.replaceChildren();
        const runs = historyEnabled() ? await listRuns() : [];
        if (!runs.length) {
            const empty = document.createElement('p');
            empty.className = 'history-empty';
            empty.textContent = historyEnabled() ? '아직 기록된 작업이 없습니다.' : '최근 작업 기록이 꺼져 있습니다.';
            historyHost.append(empty);
        }
        for (const run of runs) {
            const item = document.createElement('article');
            const head = document.createElement('div');
            const title = document.createElement('strong');
            title.textContent = run.files.map(file => file.name).slice(0, 3).join(' · ') || '이전 변환';
            const time = document.createElement('span');
            time.textContent = formatWhen(run.completedAt);
            head.append(title, time);
            const meta = document.createElement('p');
            meta.textContent = `파일 ${run.summary.total}개 · 성공 ${run.summary.ok} · 경고 ${run.summary.warn} · 실패 ${run.summary.error} · 출력 ${formatBytes(run.summary.outputBytes)}`;
            item.append(head, meta, makeButton('이 설정으로 새 변환', () => restoreOptions(run.options)));
            historyHost.append(item);
        }
    }
    if (presetHost) {
        presetHost.replaceChildren();
        const presets = await listPresets();
        if (!presets.length) {
            const empty = document.createElement('p');
            empty.className = 'history-empty';
            empty.textContent = '저장된 프리셋이 없습니다.';
            presetHost.append(empty);
        }
        for (const preset of presets) {
            const item = document.createElement('article');
            const title = document.createElement('strong');
            title.textContent = preset.name;
            const actions = document.createElement('div');
            actions.append(
                makeButton('적용', () => restoreOptions(preset.options, 'preset')),
                makeButton('삭제', async () => { await deletePreset(preset.id); renderHistory(); }, 'danger'),
            );
            item.append(title, actions);
            presetHost.append(item);
        }
    }
}

async function loadSample(button) {
    button.disabled = true;
    const original = button.querySelector('strong')?.textContent || '샘플';
    callbacks.notify?.(`${original} 샘플을 불러오는 중입니다.`);
    try {
        const response = await fetch(button.dataset.samplePath);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const blob = await response.blob();
        const file = new File([blob], button.dataset.sampleName, { type: blob.type, lastModified: 0 });
        callbacks.track?.('workspace_sample_open', { format: button.dataset.sampleName.split('.').pop() });
        callbacks.openFiles?.([file], { sample: true });
    } catch (error) {
        callbacks.notify?.(`샘플을 불러오지 못했습니다: ${error.message}`);
    } finally { button.disabled = false; }
}

export function initWorkspace(options = {}) {
    callbacks = options;
    document.querySelectorAll('[data-workspace-route]').forEach(button => {
        button.addEventListener('click', () => goWorkspace(button.dataset.workspaceRoute));
    });
    window.addEventListener('hashchange', renderRoute);
    document.querySelector('.site-logo')?.addEventListener('click', event => {
        event.preventDefault();
        goWorkspace('start');
    });
    document.getElementById('start-paste')?.addEventListener('click', () => {
        callbacks.openPaste?.();
        goWorkspace('settings');
    });
    document.getElementById('start-history')?.addEventListener('click', () => goWorkspace('history'));
    document.getElementById('start-samples')?.addEventListener('click', () => {
        document.getElementById('sample-panel').hidden = false;
        document.getElementById('sample-title')?.focus?.();
    });
    document.getElementById('close-samples')?.addEventListener('click', () => {
        document.getElementById('sample-panel').hidden = true;
    });
    document.querySelectorAll('[data-sample-path]').forEach(button => button.addEventListener('click', () => loadSample(button)));
    document.getElementById('history-enabled')?.addEventListener('change', event => {
        setHistoryEnabled(event.target.checked);
        callbacks.track?.('workspace_history_toggle', { enabled: event.target.checked });
        renderHistory();
    });
    document.getElementById('clear-history')?.addEventListener('click', async () => {
        await clearRuns();
        renderHistory();
    });
    document.getElementById('save-preset')?.addEventListener('click', async () => {
        const name = window.prompt('프리셋 이름', `내 설정 ${new Date().toLocaleDateString('ko-KR')}`);
        if (!name?.trim()) return;
        try {
            await savePreset(name.trim(), callbacks.collectOptions?.() || {});
            callbacks.track?.('workspace_preset_save', {});
            await renderHistory();
        } catch (error) { callbacks.notify?.(error.message); }
    });
    if (!location.hash || location.hash === '#') history.replaceState(null, '', '#/start');
    renderRoute();
}

export function workspaceQueueChanged(count) {
    queueCount = Math.max(0, Number(count) || 0);
    resultReady = false;
    if (queueCount) goWorkspace('prepare');
    else if (!callbacks.hasInput?.()) goWorkspace('start');
}

export function workspaceRunStarted() {
    resultReady = false;
    goWorkspace('result');
}

export async function workspaceRunCompleted(run) {
    resultReady = true;
    await recordRun(run);
    renderRoute();
}

export function workspaceReset() {
    queueCount = 0;
    resultReady = false;
    goWorkspace('start');
}
