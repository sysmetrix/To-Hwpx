/* ===================================================================
 * [core/ir-to-text.js] IR → Markdown / HTML 직렬화
 * ===================================================================
 * `hwpx-to-ir.js`와 짝을 이뤄 HWPX를 다른 형식으로 내보낸다.
 *
 *     HWPX → (hwpx-to-ir) → IR → (여기) → Markdown / HTML
 *
 * 전환기 통증의 한 갈래에 답한다 — 받은 HWPX를 열 수 없거나, 문서를
 * AI·검색·버전관리에 쓰려는 경우. HWP 내보내기(구버전 한/글용)와 달리
 * 이 경로는 **텍스트 형식으로의 추출**이며, 레이아웃 복제가 아니다.
 *
 * 정직성 원칙: 표현할 수 없는 것을 표현한 척하지 않는다.
 *   - 표 안의 링크·그림처럼 IR이 담지 않는 것은 만들어내지 않는다.
 *   - 그림은 파일 이름만 참조한다(바이트를 함께 내보내려면 호출자가 한다).
 * ===================================================================*/

'use strict';

// ─────────────────────────────────────────────────────────────────────────
// [공통]
// ─────────────────────────────────────────────────────────────────────────

function runText(x) {
    if (typeof x === 'string') return x;
    if (Array.isArray(x?.runs)) return x.runs.map(r => r.text ?? '').join('');
    return x?.text ?? '';
}

function cellOf(c) {
    if (typeof c === 'string') return { text: c, runs: null };
    return { text: c?.text ?? '', runs: Array.isArray(c?.runs) ? c.runs : null };
}

// ─────────────────────────────────────────────────────────────────────────
// [Markdown]
// ─────────────────────────────────────────────────────────────────────────

/** Markdown 인라인 특수문자 이스케이프. 과하게 하면 본문이 지저분해지므로 최소로. */
function mdEscape(s) {
    return String(s || '').replace(/([\\`*_[\]])/g, '\\$1');
}

/** run 하나를 Markdown 인라인으로. 중첩 순서는 링크 > 굵게 > 기울임 > 코드. */
function runToMd(run) {
    let t = run.code ? String(run.text || '') : mdEscape(run.text);
    if (run.code) t = `\`${t}\``;
    if (run.bold) t = `**${t}**`;
    if (run.italic) t = `*${t}*`;
    if (run.strike) t = `~~${t}~~`;
    if (run.href) t = `[${t}](${run.href})`;
    return t;
}

function runsToMd(runs, fallbackText = '') {
    if (!Array.isArray(runs) || !runs.length) return mdEscape(fallbackText);
    return runs.map(runToMd).join('');
}

/**
 * 제목 안의 굵게는 버린다.
 *
 * 렌더러는 제목을 굵은 글꼴 face로 그리므로 역파서가 모든 제목 run에
 * bold를 붙인다. 그대로 직렬화하면 `## **제목**`이 되어 굵게가 두 번
 * 표현된다. 제목 문법이 이미 강조를 담고 있으므로 여기서 뺀다.
 */
function headingRunsToMd(runs, fallbackText = '') {
    if (!Array.isArray(runs) || !runs.length) return mdEscape(fallbackText);
    return runs.map(r => runToMd({ ...r, bold: false })).join('');
}

/** 표 셀 안의 파이프는 Markdown 표를 깨뜨리므로 이스케이프한다. */
function mdTableCell(c) {
    const { text, runs } = cellOf(c);
    return (runs ? runsToMd(runs, text) : mdEscape(text))
        .replace(/\|/g, '\\|')
        .replace(/\n+/g, '<br>');
}

/**
 * IR을 Markdown으로 직렬화한다.
 * @param {object} ir  {title, blocks}
 * @param {{includeTitle?:boolean}} [options]
 */
export function irToMarkdown(ir, options = {}) {
    const includeTitle = options.includeTitle !== false;
    const out = [];

    if (includeTitle && ir?.title) out.push(`# ${mdEscape(ir.title)}`, '');

    for (const b of ir?.blocks || []) {
        switch (b.type) {
            case 'heading':
                out.push(`${'#'.repeat(Math.min(Math.max(b.level || 1, 1), 6))} ${headingRunsToMd(b.runs, b.text)}`, '');
                break;

            case 'para':
                out.push(runsToMd(b.runs, b.text).replace(/\n/g, '  \n'), '');
                break;

            case 'quote': {
                const inner = Array.isArray(b.blocks) && b.blocks.length
                    ? b.blocks.map(x => runsToMd(x.runs, x.text)).join('\n')
                    : runsToMd(b.runs, b.text);
                for (const line of inner.split('\n')) out.push(`> ${line}`);
                out.push('');
                break;
            }

            case 'code':
                out.push('```' + (b.lang || ''), String(b.text ?? ''), '```', '');
                break;

            case 'list': {
                const ordered = b.ordered === true;
                let n = 0;
                for (const item of b.items || []) {
                    const level = typeof item === 'object' ? (item.level || 0) : 0;
                    const indent = '  '.repeat(level);
                    const body = typeof item === 'string'
                        ? mdEscape(item)
                        : runsToMd(item.runs, item.text);
                    // 태스크 상태는 IR에 있으면 그대로 표기한다.
                    const task = typeof item === 'object' && item.task
                        ? (item.checked ? '[x] ' : '[ ] ')
                        : '';
                    const marker = ordered && level === 0 ? `${++n}. ` : '- ';
                    out.push(`${indent}${marker}${task}${body}`);
                }
                out.push('');
                break;
            }

            case 'table': {
                const header = b.header && b.header.length ? b.header : null;
                const rows = b.rows || [];
                const width = Math.max(
                    header ? header.length : 0,
                    ...rows.map(r => (r || []).length),
                    1,
                );
                const pad = arr => {
                    const cells = (arr || []).map(mdTableCell);
                    while (cells.length < width) cells.push('');
                    return `| ${cells.join(' | ')} |`;
                };
                if (header) {
                    out.push(pad(header), `|${' --- |'.repeat(width)}`);
                } else {
                    // Markdown 표는 머리행이 필수다. 없으면 빈 머리행을 만든다
                    // (내용을 지어내지 않고 자리만 만든다).
                    out.push(`|${' |'.repeat(width)}`, `|${' --- |'.repeat(width)}`);
                }
                for (const r of rows) out.push(pad(r));
                out.push('');
                break;
            }

            case 'image': {
                const alt = mdEscape(b.alt || '');
                const src = b.binName ? `BinData/${b.binName}` : '';
                out.push(src ? `![${alt}](${src})` : (alt ? `![${alt}]()` : ''), '');
                break;
            }

            case 'hr':
                out.push('---', '');
                break;

            case 'blank':
                break;

            default:
                if (b.text) out.push(runsToMd(b.runs, b.text), '');
        }
    }

    // 연속 빈 줄을 하나로 정리하고 끝에 개행 하나만 남긴다.
    return out.join('\n').replace(/\n{3,}/g, '\n\n').replace(/\s+$/, '') + '\n';
}

// ─────────────────────────────────────────────────────────────────────────
// [HTML]
// ─────────────────────────────────────────────────────────────────────────

function htmlEscape(s) {
    return String(s || '').replace(/[&<>"']/g, ch => (
        { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
    ));
}

/** href는 스킴을 제한한다. 렌더러와 같은 정책(http/https/mailto). */
function safeHref(raw) {
    try {
        const u = new URL(String(raw));
        return ['http:', 'https:', 'mailto:'].includes(u.protocol) ? u.href : null;
    } catch {
        return null;
    }
}

function runToHtml(run) {
    let t = htmlEscape(run.text);
    if (run.code) t = `<code>${t}</code>`;
    if (run.bold) t = `<strong>${t}</strong>`;
    if (run.italic) t = `<em>${t}</em>`;
    if (run.underline) t = `<u>${t}</u>`;
    if (run.strike) t = `<s>${t}</s>`;
    if (run.color) t = `<span style="color:${htmlEscape(run.color)}">${t}</span>`;
    const href = run.href ? safeHref(run.href) : null;
    if (href) t = `<a href="${htmlEscape(href)}" rel="noopener noreferrer">${t}</a>`;
    return t;
}

function runsToHtml(runs, fallbackText = '') {
    if (!Array.isArray(runs) || !runs.length) return htmlEscape(fallbackText).replace(/\n/g, '<br>');
    return runs.map(runToHtml).join('').replace(/\n/g, '<br>');
}

function htmlCell(c, tag) {
    const { text, runs } = cellOf(c);
    const attrs = [];
    if (typeof c === 'object') {
        if (c.colSpan > 1) attrs.push(` colspan="${c.colSpan}"`);
        if (c.rowSpan > 1) attrs.push(` rowspan="${c.rowSpan}"`);
    }
    return `<${tag}${attrs.join('')}>${runsToHtml(runs, text)}</${tag}>`;
}

/**
 * IR을 HTML 문서로 직렬화한다.
 * @param {{fragment?:boolean, includeTitle?:boolean}} [options]
 *   fragment=true면 <html> 껍데기 없이 본문만 반환한다.
 */
export function irToHtml(ir, options = {}) {
    const includeTitle = options.includeTitle !== false;
    const out = [];

    if (includeTitle && ir?.title) out.push(`<h1>${htmlEscape(ir.title)}</h1>`);

    for (const b of ir?.blocks || []) {
        switch (b.type) {
            case 'heading': {
                const lv = Math.min(Math.max(b.level || 1, 1), 6);
                // 제목 태그가 이미 강조를 담으므로 안쪽 <strong>은 뺀다(역파서가
                // 굵은 글꼴 face 때문에 모든 제목 run에 bold를 붙인다).
                out.push(`<h${lv}>${runsToHtml((b.runs || []).map(r => ({ ...r, bold: false })), b.text)}</h${lv}>`);
                break;
            }
            case 'para':
                out.push(`<p>${runsToHtml(b.runs, b.text)}</p>`);
                break;
            case 'quote': {
                const inner = Array.isArray(b.blocks) && b.blocks.length
                    ? b.blocks.map(x => `<p>${runsToHtml(x.runs, x.text)}</p>`).join('')
                    : `<p>${runsToHtml(b.runs, b.text)}</p>`;
                out.push(`<blockquote>${inner}</blockquote>`);
                break;
            }
            case 'code':
                out.push(`<pre><code>${htmlEscape(b.text)}</code></pre>`);
                break;
            case 'list': {
                const tag = b.ordered ? 'ol' : 'ul';
                // 중첩은 레벨 변화에 따라 여닫는다.
                const parts = [`<${tag}>`];
                let cur = 0;
                for (const item of b.items || []) {
                    const level = typeof item === 'object' ? (item.level || 0) : 0;
                    while (cur < level) { parts.push(`<${tag}>`); cur++; }
                    while (cur > level) { parts.push(`</${tag}>`); cur--; }
                    const body = typeof item === 'string'
                        ? htmlEscape(item)
                        : runsToHtml(item.runs, item.text);
                    parts.push(`<li>${body}</li>`);
                }
                while (cur > 0) { parts.push(`</${tag}>`); cur--; }
                parts.push(`</${tag}>`);
                out.push(parts.join(''));
                break;
            }
            case 'table': {
                const parts = ['<table>'];
                if (b.header && b.header.length) {
                    parts.push('<thead><tr>' + b.header.map(c => htmlCell(c, 'th')).join('') + '</tr></thead>');
                }
                parts.push('<tbody>');
                for (const r of b.rows || []) {
                    parts.push('<tr>' + (r || []).map(c => htmlCell(c, 'td')).join('') + '</tr>');
                }
                parts.push('</tbody></table>');
                out.push(parts.join(''));
                break;
            }
            case 'image': {
                const src = b.binName ? `BinData/${b.binName}` : '';
                out.push(`<p><img src="${htmlEscape(src)}" alt="${htmlEscape(b.alt || '')}"></p>`);
                break;
            }
            case 'hr':
                out.push('<hr>');
                break;
            case 'blank':
                break;
            default:
                if (b.text) out.push(`<p>${runsToHtml(b.runs, b.text)}</p>`);
        }
    }

    const body = out.join('\n');
    if (options.fragment) return body + '\n';

    return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<title>${htmlEscape(ir?.title || '문서')}</title>
<style>
  body { max-width: 44rem; margin: 2rem auto; padding: 0 1rem;
         font-family: system-ui, "Malgun Gothic", sans-serif; line-height: 1.7; }
  table { border-collapse: collapse; width: 100%; margin: 1rem 0; }
  th, td { border: 1px solid #ccc; padding: .4rem .6rem; text-align: left; }
  th { background: #f4f4f4; }
  pre { background: #f6f6f6; padding: .8rem; overflow-x: auto; }
  blockquote { border-left: 3px solid #ccc; margin: 1rem 0; padding-left: 1rem; color: #555; }
  img { max-width: 100%; }
</style>
</head>
<body>
${body}
</body>
</html>
`;
}

/** 형식 이름 → 직렬화 함수. CLI·MCP가 같은 목록을 쓴다. */
export const TEXT_EXPORTERS = Object.freeze({
    md: { ext: '.md', mimeType: 'text/markdown', serialize: irToMarkdown },
    markdown: { ext: '.md', mimeType: 'text/markdown', serialize: irToMarkdown },
    html: { ext: '.html', mimeType: 'text/html', serialize: irToHtml },
});
