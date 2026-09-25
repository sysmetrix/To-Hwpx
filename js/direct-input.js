const PREVIEW_AUTO_MAX_BYTES = 500 * 1024;
const DIRECT_INPUT_MAX_BYTES = 10 * 1024 * 1024;
const DRAFT_MAX_BYTES = 2 * 1024 * 1024;
const DRAFT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const DRAFT_DB_NAME = 'tohwpx-direct-input';
const DRAFT_DB_VERSION = 1;
const DRAFT_STORE = 'drafts';
const DRAFT_ID = 'active';
export const DRAFT_ENABLED_KEY = 'tohwpx_direct_draft_enabled';

export const DIRECT_INPUT_LIMITS = Object.freeze({
    previewAutoBytes: PREVIEW_AUTO_MAX_BYTES,
    inputBytes: DIRECT_INPUT_MAX_BYTES,
    draftBytes: DRAFT_MAX_BYTES,
    draftAgeMs: DRAFT_MAX_AGE_MS,
});

function byteLength(value) {
    return new TextEncoder().encode(String(value || '')).byteLength;
}

function lineColumn(text, offset) {
    const before = String(text || '').slice(0, Math.max(0, offset));
    const lines = before.split('\n');
    return { line: lines.length, column: lines.at(-1).length + 1 };
}

function result(format, confidence, evidence, alternatives = []) {
    return { format, confidence, evidence, alternatives };
}

function delimitedEvidence(text) {
    const lines = String(text || '').split(/\r?\n/).filter(line => line.trim()).slice(0, 30);
    if (lines.length < 2) return null;
    const count = (line, delimiter) => {
        let quote = false;
        let total = 0;
        for (let i = 0; i < line.length; i++) {
            if (line[i] === '"') {
                if (quote && line[i + 1] === '"') i++;
                else quote = !quote;
            } else if (!quote && line[i] === delimiter) total++;
        }
        return total;
    };
    const candidates = [
        { delimiter: '\t', label: '탭' },
        { delimiter: ',', label: '쉼표' },
    ];
    for (const candidate of candidates) {
        const counts = lines.map(line => count(line, candidate.delimiter));
        const positive = counts.filter(value => value > 0);
        if (positive.length >= Math.min(2, lines.length) && new Set(positive).size === 1) {
            // 두 줄에 쉼표 하나씩 있는 일반 문장은 흔하다. 이를 2열 CSV로 오인하면
            // 문장이 표로 바뀌므로, 쉼표 1개짜리는 최소 3행에서만 자동 적용한다.
            if (candidate.delimiter === ',' && positive[0] === 1 && lines.length < 3) continue;
            return { label: candidate.label, columns: positive[0] + 1 };
        }
    }
    return null;
}

/** 붙여넣은 원문을 바꾸지 않고 가장 가능성 높은 형식만 추천한다. */
export function detectDirectInput({ plainText = '', htmlText = '' } = {}) {
    const text = String(plainText || '').trim();
    const richHtml = String(htmlText || '').trim();
    if (richHtml && /<(?:p|div|table|h[1-6]|ul|ol|blockquote|pre|strong|em|a)\b/i.test(richHtml)) {
        return result('html', 0.98, '클립보드에 HTML 서식이 포함되어 있습니다.', ['md', 'txt']);
    }
    if (!text) return result('txt', 0, '내용이 없어 형식을 판별하지 않았습니다.', []);
    if (/^[\[{]/.test(text)) {
        try {
            JSON.parse(text);
            return result('json', 0.99, '유효한 JSON 구조입니다.', ['txt']);
        } catch (_) {
            if (/^\s*[\[{][\s\S]*(?:"[^"\n]+"\s*:|[\]}])/.test(text)) {
                return result('json', 0.76, 'JSON과 유사한 구조이며 문법 확인이 필요합니다.', ['txt']);
            }
        }
    }
    const delimited = delimitedEvidence(text);
    if (delimited) {
        return result('csv', delimited.label === '탭' ? 0.97 : 0.91,
            `${delimited.label}로 구분된 ${delimited.columns}열 표가 반복됩니다.`, ['txt']);
    }
    if (/<(?:!doctype|html|head|body|title|p|div|table|h[1-6]|ul|ol|blockquote|pre|br)\b[^>]*>/i.test(text)) {
        return result('html', 0.94, 'HTML 문서 태그가 확인되었습니다.', ['txt']);
    }
    const mdSignals = [
        [/^#{1,6}\s+\S/m, '제목'],
        [/^(?:[-*+] |\d+[.)] )\S/m, '목록'],
        [/```[\s\S]*```/, '코드 블록'],
        [/^\s*\|.+\|\s*$[\s\S]*^\s*\|?\s*:?-+/m, '표'],
        [/\[[^\]]+\]\((?:https?:|mailto:)[^)]+\)/i, '링크'],
        [/(?:\*\*|__)[^\n]+(?:\*\*|__)/, '강조'],
    ].filter(([pattern]) => pattern.test(text)).map(([, label]) => label);
    if (mdSignals.length) {
        const confidence = Math.min(0.96, 0.68 + mdSignals.length * 0.08);
        return result('md', confidence, `Markdown ${mdSignals.join('·')} 문법이 확인되었습니다.`, ['txt']);
    }
    return result('txt', 0.55, '구조 문법이 뚜렷하지 않아 일반 텍스트로 추천합니다.', ['md']);
}

function diagnostic(severity, code, message, line = null, column = null, recoverable = true, action = '') {
    return { severity, code, message, line, column, recoverable, action };
}

function diagnoseJson(text) {
    try {
        JSON.parse(text);
        return [];
    } catch (error) {
        const match = /position\s+(\d+)/i.exec(error.message || '');
        const offset = match ? Number(match[1]) : 0;
        const pos = lineColumn(text, offset);
        return [diagnostic('error', 'json-invalid', `JSON 문법 오류: ${error.message}`, pos.line, pos.column,
            false, '표시된 위치의 쉼표·따옴표·괄호를 확인하세요.')];
    }
}

function diagnoseDelimited(text) {
    const rows = [];
    const separator = String(text).includes('\t') ? '\t' : ',';
    let rowColumns = 1;
    let quote = false;
    let line = 1;
    let quoteLine = 1;
    let quoteColumn = 1;
    let column = 0;
    for (let i = 0; i < text.length; i++) {
        const char = text[i];
        column++;
        if (char === '"') {
            if (quote && text[i + 1] === '"') { i++; column++; }
            else {
                quote = !quote;
                if (quote) { quoteLine = line; quoteColumn = column; }
            }
        } else if (!quote && char === separator) rowColumns++;
        else if (!quote && char === '\n') {
            rows.push({ line, columns: rowColumns });
            line++;
            column = 0;
            rowColumns = 1;
        }
    }
    rows.push({ line, columns: rowColumns });
    const out = [];
    if (quote) out.push(diagnostic('error', 'csv-open-quote', '닫히지 않은 따옴표가 있습니다.', quoteLine,
        quoteColumn, false, '따옴표를 닫거나 셀 안의 따옴표를 두 번 입력하세요.'));
    const expected = rows.find(row => row.columns > 1)?.columns || 1;
    const mismatch = rows.find(row => row.columns !== expected && row.columns > 1);
    if (mismatch) out.push(diagnostic('warning', 'csv-column-count',
        `이 행은 ${mismatch.columns}열이며 다른 행은 ${expected}열입니다. 빈 셀로 보정됩니다.`, mismatch.line, 1,
        true, '구분자와 빈 셀을 확인하세요.'));
    return out;
}

function diagnoseMarkdown(text) {
    const out = [];
    const fences = [...String(text).matchAll(/^\s*```/gm)];
    if (fences.length % 2) {
        const pos = lineColumn(text, fences.at(-1).index);
        out.push(diagnostic('warning', 'md-open-fence', '닫히지 않은 코드 블록이 있습니다.', pos.line, pos.column,
            true, '마지막에 ```를 추가하면 이후 내용이 일반 문단으로 처리됩니다.'));
    }
    const definitions = new Set([...String(text).matchAll(/^\s*\[([^\]]+)\]:\s*\S+/gm)]
        .map(match => match[1].toLowerCase()));
    for (const match of String(text).matchAll(/\[[^\]]+\]\[([^\]]+)\]/g)) {
        if (definitions.has(match[1].toLowerCase())) continue;
        const pos = lineColumn(text, match.index);
        out.push(diagnostic('warning', 'md-missing-reference', `링크 참조 [${match[1]}] 정의를 찾지 못했습니다.`,
            pos.line, pos.column, true, '문서 아래에 [이름]: URL 정의를 추가하세요.'));
        if (out.length >= 20) break;
    }
    return out;
}

function diagnoseHtml(text) {
    const blocked = [...String(text).matchAll(/<(script|style|iframe|object|embed|form|svg)\b/gi)];
    if (!blocked.length) return [];
    const pos = lineColumn(text, blocked[0].index);
    const names = [...new Set(blocked.map(match => match[1].toLowerCase()))];
    return [diagnostic('warning', 'html-ignored-elements',
        `${names.join(', ')} 요소는 안전을 위해 결과에서 제외됩니다.`, pos.line, pos.column, true,
        '본문 요소와 인라인 서식만 남겨 주세요.')];
}

/** 변환 전에 고칠 수 있는 문법 문제를 공통 진단 형태로 반환한다. */
export function diagnoseDirectInput(text, format) {
    const value = String(text || '');
    const bytes = byteLength(value);
    if (bytes > DIRECT_INPUT_MAX_BYTES) {
        return [diagnostic('error', 'input-too-large', '직접 입력은 10MB까지 지원합니다.', 1, 1, false,
            '큰 문서는 파일 업로드를 사용하세요.')];
    }
    const sizeNotice = bytes > PREVIEW_AUTO_MAX_BYTES
        ? [diagnostic('info', 'preview-manual', '큰 문서는 편집 성능을 위해 미리보기를 수동으로 갱신합니다.',
            null, null, true, '미리보기 갱신 버튼을 누르세요.')]
        : [];
    const formatDiagnostics = format === 'json' ? diagnoseJson(value)
        : format === 'csv' ? diagnoseDelimited(value)
            : format === 'md' ? diagnoseMarkdown(value)
                : format === 'html' ? diagnoseHtml(value) : [];
    return [...formatDiagnostics, ...sizeNotice];
}

function openDraftDb() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DRAFT_DB_NAME, DRAFT_DB_VERSION);
        request.onerror = () => reject(request.error);
        request.onupgradeneeded = () => {
            const db = request.result;
            if (!db.objectStoreNames.contains(DRAFT_STORE)) db.createObjectStore(DRAFT_STORE, { keyPath: 'id' });
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

export function draftRecoveryEnabled() {
    try { return localStorage.getItem(DRAFT_ENABLED_KEY) === 'true'; } catch { return false; }
}

export function setDraftRecoveryEnabled(enabled) {
    try { localStorage.setItem(DRAFT_ENABLED_KEY, String(Boolean(enabled))); } catch {}
}

export async function saveDirectInputDraft({ text, format, name, formatLocked }) {
    const value = String(text || '');
    if (!draftRecoveryEnabled() || !value.trim()) return { saved: false, reason: 'disabled-or-empty' };
    if (byteLength(value) > DRAFT_MAX_BYTES) return { saved: false, reason: 'too-large' };
    const db = await openDraftDb();
    try {
        const draft = {
            id: DRAFT_ID,
            text: value,
            format: ['md', 'html', 'txt', 'csv', 'json'].includes(format) ? format : 'txt',
            name: String(name || '').slice(0, 200),
            formatLocked: Boolean(formatLocked),
            updatedAt: Date.now(),
        };
        await requestResult(db.transaction(DRAFT_STORE, 'readwrite').objectStore(DRAFT_STORE).put(draft));
        return { saved: true, updatedAt: draft.updatedAt };
    } finally { db.close(); }
}

export async function loadDirectInputDraft() {
    const db = await openDraftDb();
    try {
        const draft = await requestResult(db.transaction(DRAFT_STORE, 'readonly').objectStore(DRAFT_STORE).get(DRAFT_ID));
        if (!draft) return null;
        if (Date.now() - Number(draft.updatedAt || 0) <= DRAFT_MAX_AGE_MS) return draft;
    } finally { db.close(); }
    await deleteDirectInputDraft();
    return null;
}

export async function deleteDirectInputDraft() {
    const db = await openDraftDb();
    try {
        await requestResult(db.transaction(DRAFT_STORE, 'readwrite').objectStore(DRAFT_STORE).delete(DRAFT_ID));
    } finally { db.close(); }
}

export const DIRECT_INPUT_SCHEMA = Object.freeze({
    draftDb: DRAFT_DB_NAME,
    draftStore: DRAFT_STORE,
    draftId: DRAFT_ID,
    draftMaxBytes: DRAFT_MAX_BYTES,
    draftMaxAgeMs: DRAFT_MAX_AGE_MS,
});
