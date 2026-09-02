/* ===================================================================
 * [core/hwpx-to-ir.js] HWPX → 공통 IR (왕복 검증용 역파서)
 * ===================================================================
 * 목적은 **기능이 아니라 증명**이다.
 *
 * 지금까지 변환 품질은 "자기 픽스처를 자기 채점기로 잰 점수"였다. 그건
 * 회귀 감지에는 쓸모가 있지만, 제3자가 재현할 수 있는 주장은 아니다.
 * 이 모듈은 우리가 만든 HWPX를 **다시 읽어** IR로 되돌린다. 그러면
 *
 *     IR → HWPX → IR′
 *
 * 의 왕복에서 무엇이 살아남고 무엇이 사라지는지 기계적으로 잴 수 있다.
 * 살아남지 못한 것은 그 자체로 "이 형식으로는 표현되지 않았다"는 뜻이다.
 *
 * ⚠ 이 역파서는 **우리가 만든 HWPX**를 대상으로 한다. 임의의 한컴 문서를
 *   완전히 해석하는 범용 리더가 아니다. 우리 렌더러가 쓰는 paraPr/charPr
 *   id 규약을 알고 그것을 되짚는다. 규약을 바꾸면 여기도 함께 바꿔야 하고,
 *   그 사실 자체가 왕복 게이트로 드러난다.
 *
 * ⚠ 생성 경로와 계통이 다르지 않다. 둘 다 한컴 공개 OWPML 기준이며
 *   rhwp(리버스 엔지니어링 산물)를 쓰지 않는다.
 * ===================================================================*/

'use strict';

import { requireZip, toZipInput } from './runtime.js';

// ─────────────────────────────────────────────────────────────────────────
// [렌더러 규약] js/hwpx.js가 쓰는 id 의미. 두 파일은 함께 바뀐다.
// ─────────────────────────────────────────────────────────────────────────

/** paraPr id → 블록 의미 */
const PARA_ROLE = {
    0: { kind: 'para' },
    1: { kind: 'heading', level: 1 },
    2: { kind: 'heading', level: 2 },
    3: { kind: 'heading', level: 3 },
    4: { kind: 'heading', level: 4 },
    15: { kind: 'heading', level: 5 },
    16: { kind: 'heading', level: 6 },
    5: { kind: 'list', level: 0 },
    17: { kind: 'list', level: 1 },
    18: { kind: 'list', level: 2 },
    7: { kind: 'cell', align: 'center' },
    10: { kind: 'cell', align: 'left' },
    11: { kind: 'cell', align: 'right' },
    9: { kind: 'blank' },
    12: { kind: 'para', align: 'center' },
    13: { kind: 'para', align: 'right' },
    14: { kind: 'code' },
    19: { kind: 'quote' },
};

/**
 * 목록 마커 — 렌더러가 붙이는 문자열. 역파싱 때 떼어낸다.
 * 글머리는 js/hwpx.js의 bullets = ['· ', '◦ ', '▪ '], 태스크는 ▣/□,
 * 순서 목록은 "N. "이다. 렌더러의 마커를 바꾸면 여기도 함께 바꿔야 하고,
 * 놓치면 왕복 게이트가 텍스트 불일치로 잡는다.
 */
const LIST_MARKER = /^(?:[·•◦▪]\s|[▣□]\s|\d+[.)]\s)/;

const NS = {
    hp: 'http://www.hancom.co.kr/hwpml/2011/paragraph',
    hs: 'http://www.hancom.co.kr/hwpml/2011/section',
    hh: 'http://www.hancom.co.kr/hwpml/2011/head',
    hc: 'http://www.hancom.co.kr/hwpml/2011/core',
};

/** XML 파서 — 호스트마다 다르므로 주입받거나 전역에서 찾는다. */
function getParser(explicit) {
    if (explicit) return explicit;
    if (typeof globalThis !== 'undefined' && globalThis.DOMParser) {
        const DP = globalThis.DOMParser;
        return (xml) => new DP().parseFromString(xml, 'application/xml');
    }
    return null;
}

function localName(node) {
    return (node && (node.localName || node.nodeName || '')).replace(/^.*:/, '');
}

function childElements(node, name = null) {
    const out = [];
    for (const c of Array.from(node?.childNodes || [])) {
        if (c.nodeType !== 1) continue;
        if (name && localName(c) !== name) continue;
        out.push(c);
    }
    return out;
}

function descendants(node, name) {
    const out = [];
    (function walk(n) {
        for (const c of Array.from(n?.childNodes || [])) {
            if (c.nodeType !== 1) continue;
            if (localName(c) === name) out.push(c);
            walk(c);
        }
    })(node);
    return out;
}

/** 직계 자손 중 특정 이름 — 중첩 표가 외부 표로 새는 것을 막는다. */
function nearestAncestor(node, name) {
    let p = node?.parentNode;
    while (p && p.nodeType === 1) {
        if (localName(p) === name) return p;
        p = p.parentNode;
    }
    return null;
}

// ─────────────────────────────────────────────────────────────────────────
// [run 복원]
// ─────────────────────────────────────────────────────────────────────────

/**
 * charPr 정의를 읽어 id → 서식으로 만든다.
 * 서식은 header.xml에만 있으므로 section만 보고는 굵게/색을 알 수 없다.
 */
function readCharProperties(headerDoc) {
    const map = new Map();
    if (!headerDoc) return map;
    for (const cp of descendants(headerDoc, 'charPr')) {
        const id = cp.getAttribute('id');
        if (id == null) continue;
        const color = (cp.getAttribute('textColor') || '').toUpperCase();
        map.set(String(id), {
            bold: childElements(cp, 'bold').length > 0,
            italic: childElements(cp, 'italic').length > 0,
            underline: childElements(cp, 'underline').length > 0,
            strike: childElements(cp, 'strikeout').length > 0,
            color: color && color !== '#000000' ? color : null,
            heightHwp: Number(cp.getAttribute('height')) || null,
            // 굵게를 별도 Bold 폰트 face로 표현하는 경로도 있다(getBoldFontName).
            fontFace: childElements(cp, 'fontRef')[0]?.getAttribute('hangul') ?? null,
        });
    }
    return map;
}

/** 문단 안의 run들을 {text, bold, ...} 배열로 되돌린다. 하이퍼링크 구간도 복원한다. */
function readRuns(paraEl, charMap, boldFaceIds) {
    const runs = [];
    let activeHref = null;

    for (const child of childElements(paraEl)) {
        const name = localName(child);

        if (name === 'ctrl') {
            // 하이퍼링크 필드는 fieldBegin ... fieldEnd로 감싸인다.
            for (const f of childElements(child)) {
                const fn = localName(f);
                if (fn === 'fieldBegin' && (f.getAttribute('type') || '').toUpperCase() === 'HYPERLINK') {
                    activeHref = readHyperlinkTarget(f);
                } else if (fn === 'fieldEnd') {
                    activeHref = null;
                }
            }
            continue;
        }

        if (name !== 'run') continue;

        // run 안에도 ctrl(fieldBegin/End)이 들어갈 수 있다.
        for (const f of descendants(child, 'fieldBegin')) {
            if ((f.getAttribute('type') || '').toUpperCase() === 'HYPERLINK') {
                activeHref = readHyperlinkTarget(f);
            }
        }

        const charId = String(child.getAttribute('charPrIDRef') ?? '0');
        const fmt = charMap.get(charId) || {};
        let text = '';
        for (const t of childElements(child, 't')) text += readTextNode(t);

        if (text) {
            const run = { text };
            if (fmt.bold || (fmt.fontFace && boldFaceIds.has(String(fmt.fontFace)))) run.bold = true;
            if (fmt.italic) run.italic = true;
            if (fmt.underline) run.underline = true;
            if (fmt.strike) run.strike = true;
            if (fmt.color) run.color = fmt.color;
            if (activeHref) run.href = activeHref;
            runs.push(run);
        }

        if (descendants(child, 'fieldEnd').length) activeHref = null;
    }

    return runs;
}

/**
 * hp:parameters에서 URL을 꺼낸다.
 *
 * Path에는 원본 URL이 그대로, Command에는 `\` 이스케이프와 `;1;0;1;` 꼬리가
 * 붙은 형태가 들어간다(js/hwpx.js hyperlinkCommand). **Path를 먼저 본다** —
 * XML 순서상 Command가 앞에 있어 단순 순회로 집으면 `https\://...`를 얻는다.
 */
function readHyperlinkTarget(fieldBeginEl) {
    const params = descendants(fieldBeginEl, 'stringParam');

    for (const p of params) {
        if ((p.getAttribute('name') || '').toLowerCase() !== 'path') continue;
        const v = (p.textContent || '').trim();
        if (v) return v;
    }

    // Path가 없을 때만 Command에서 되살린다(이스케이프와 꼬리를 벗긴다).
    for (const p of params) {
        if ((p.getAttribute('name') || '').toLowerCase() !== 'command') continue;
        const v = (p.textContent || '').trim();
        if (v) return v.split(';')[0].replace(/\\([\\:?])/g, '$1').trim() || null;
    }

    // 일부 경로는 파라미터를 단순 텍스트로 둔다.
    const m = /(https?:\/\/[^\s;]+|mailto:[^\s;]+)/i.exec((fieldBeginEl.textContent || '').trim());
    return m ? m[1] : null;
}

/**
 * `hp:t`의 내용을 순서대로 읽는다.
 *
 * 수동 줄바꿈과 탭은 `hp:t`의 **자식**으로 들어간다 — `hp:run`의 형제가 아니다.
 *
 *   <hp:t>첫 줄<hp:lineBreak/><hp:lineBreak/>둘째 줄</hp:t>
 *
 * 따라서 `textContent`만 읽으면 "첫 줄둘째 줄"이 되어 줄바꿈이 소리 없이
 * 사라지고, `hp:run`에서 lineBreak를 찾으면 하나도 발견하지 못한다
 * (실제로 그렇게 틀렸고 왕복 게이트가 잡아냈다).
 * 자식 노드를 순서대로 훑어 위치까지 보존한다.
 */
function readTextNode(tEl) {
    let out = '';
    for (const n of Array.from(tEl?.childNodes || [])) {
        if (n.nodeType === 3 || n.nodeType === 4) {          // text / CDATA
            out += n.nodeValue ?? '';
        } else if (n.nodeType === 1) {
            const ln = localName(n);
            if (ln === 'lineBreak') out += '\n';
            else if (ln === 'tab') out += '\t';
            else out += n.textContent ?? '';
        }
    }
    return out;
}

function runsToText(runs) {
    return runs.map(r => r.text).join('');
}

/**
 * 목록 마커를 runs에서 떼어낸다.
 * 렌더러가 마커를 앞선 별도 run으로 넣으므로 보통 첫 run 전체가 마커다.
 * 마커와 본문이 한 run에 섞인 경우에도 앞부분만 잘라낸다.
 */
function stripMarkerFromRuns(runs) {
    if (!runs.length) return runs;
    const first = runs[0];
    const stripped = first.text.replace(LIST_MARKER, '');
    if (stripped === first.text) return runs;          // 마커 없음
    if (!stripped) return runs.slice(1);               // 마커 전용 run
    return [{ ...first, text: stripped }, ...runs.slice(1)];
}

// ─────────────────────────────────────────────────────────────────────────
// [블록 복원]
// ─────────────────────────────────────────────────────────────────────────

/**
 * 표를 되돌린다.
 *
 * 머리행 표시는 **행이 아니라 셀**(`hp:tc@header`)에 있다. 행에서 찾으면
 * 항상 머리행이 없다고 판정한다(실제로 처음에 그렇게 틀렸다).
 *
 * 코드 블록은 렌더러가 표로 표현한다(AGENTS.md 참조). 따라서 구조만으로는
 * 표와 구분되지 않는다. 셀 문단의 paraPr가 코드 전용 id(14)인지로 가른다.
 */
function readTable(tblEl, charMap, boldFaceIds) {
    const rows = [];
    let codeParaCount = 0;
    let totalParaCount = 0;

    for (const tr of descendants(tblEl, 'tr')) {
        // 중첩 표의 행이 외부 표로 새지 않게 가장 가까운 tbl 조상을 확인한다.
        if (nearestAncestor(tr, 'tbl') !== tblEl) continue;
        const cells = [];
        let rowIsHeader = false;

        for (const tc of descendants(tr, 'tc')) {
            if (nearestAncestor(tc, 'tr') !== tr) continue;
            if (tc.getAttribute('header') === '1') rowIsHeader = true;

            const span = childElements(tc, 'cellSpan')[0];
            const colSpan = Number(span?.getAttribute('colSpan')) || 1;
            const rowSpan = Number(span?.getAttribute('rowSpan')) || 1;

            const paras = [];
            for (const sub of childElements(tc, 'subList')) {
                for (const p of childElements(sub, 'p')) {
                    totalParaCount++;
                    if (Number(p.getAttribute('paraPrIDRef')) === 14) codeParaCount++;
                    paras.push(runsToText(readRuns(p, charMap, boldFaceIds)));
                }
            }
            const cell = { text: paras.join('\n').trim() };
            if (colSpan > 1) cell.colSpan = colSpan;
            if (rowSpan > 1) cell.rowSpan = rowSpan;
            cells.push(cell);
        }
        if (cells.length) rows.push({ cells, header: rowIsHeader });
    }

    // 셀 문단이 전부 코드 문단이면 코드 블록이다(단일 셀 표로 렌더된다).
    if (totalParaCount > 0 && codeParaCount === totalParaCount) {
        const text = rows.map(r => r.cells.map(c => c.text).join('\t')).join('\n');
        return { type: 'code', text };
    }

    const headerRow = rows.length && rows[0].header ? rows.shift() : null;
    return {
        type: 'table',
        ...(headerRow ? { header: headerRow.cells } : {}),
        rows: rows.map(r => r.cells),
    };
}

function readImage(picEl) {
    const img = descendants(picEl, 'img')[0];
    if (!img) return null;
    const sz = descendants(picEl, 'sz')[0] || descendants(picEl, 'curSz')[0];
    return {
        type: 'image',
        binName: img.getAttribute('binaryItemIDRef') || null,
        widthHwp: Number(sz?.getAttribute('width')) || null,
        heightHwp: Number(sz?.getAttribute('height')) || null,
        alt: img.getAttribute('alt') || '',
    };
}

// ─────────────────────────────────────────────────────────────────────────
// [진입점]
// ─────────────────────────────────────────────────────────────────────────

/**
 * HWPX 바이트를 공통 IR로 되돌린다.
 *
 * @param {Blob|ArrayBuffer|Uint8Array} input
 * @param {{parseXml?:(xml:string)=>any}} [options]
 * @returns {Promise<{ir:object, stats:object}>}
 */
export async function hwpxToIr(input, options = {}) {
    const parseXml = getParser(options.parseXml);
    if (!parseXml) {
        throw new Error('XML 파서를 찾지 못했습니다. options.parseXml을 주입하세요.');
    }

    const zip = await requireZip().loadAsync(await toZipInput(input));
    const sectionFile = zip.file('Contents/section0.xml');
    if (!sectionFile) throw new Error('Contents/section0.xml이 없습니다.');

    const sectionDoc = parseXml(await sectionFile.async('string'));
    const headerFile = zip.file('Contents/header.xml');
    const headerDoc = headerFile ? parseXml(await headerFile.async('string')) : null;

    const charMap = readCharProperties(headerDoc);

    // 굵게를 별도 Bold 폰트 face로 표현하는 경로 — face id 1이 그 자리다.
    const boldFaceIds = new Set(['1']);

    const previewFile = zip.file('Preview/PrvText.txt');
    const title = previewFile ? (await previewFile.async('string')).trim() : '';

    const secEl = descendants(sectionDoc, 'sec')[0] || sectionDoc.documentElement;
    const blocks = [];
    const stats = { paragraphs: 0, tables: 0, images: 0, links: 0, lineBreaks: 0 };

    for (const p of childElements(secEl, 'p')) {
        stats.paragraphs++;
        const paraId = Number(p.getAttribute('paraPrIDRef') ?? 0);
        const role = PARA_ROLE[paraId] || { kind: 'para' };

        // 표는 문단 안의 ctrl로 들어간다.
        const tbls = descendants(p, 'tbl').filter(t => nearestAncestor(t, 'tbl') === null);
        if (tbls.length) {
            for (const t of tbls) {
                blocks.push(readTable(t, charMap, boldFaceIds));
                stats.tables++;
            }
            continue;
        }

        const pics = descendants(p, 'pic');
        if (pics.length) {
            for (const pic of pics) {
                const img = readImage(pic);
                if (img) { blocks.push(img); stats.images++; }
            }
            continue;
        }

        const runs = readRuns(p, charMap, boldFaceIds);
        const text = runsToText(runs);
        stats.links += runs.filter(r => r.href).length;
        stats.lineBreaks += (text.match(/\n/g) || []).length;

        if (!text.trim()) {
            blocks.push({ type: 'blank' });
            continue;
        }

        switch (role.kind) {
            case 'heading':
                blocks.push({ type: 'heading', level: role.level, text, runs });
                break;
            case 'list': {
                // 마커는 렌더러가 **별도 run**으로 앞에 붙인다. text에서만 떼면
                // runs에는 그대로 남아, runs를 우선하는 소비자가 마커를 다시 본다.
                // 둘이 어긋나지 않도록 같은 규칙으로 함께 떼어낸다.
                blocks.push({
                    type: 'list-item',
                    level: role.level,
                    text: text.replace(LIST_MARKER, ''),
                    runs: stripMarkerFromRuns(runs),
                });
                break;
            }
            case 'code':
                blocks.push({ type: 'code-line', text });
                break;
            case 'quote':
                blocks.push({ type: 'quote', text, runs });
                break;
            case 'blank':
                blocks.push({ type: 'blank' });
                break;
            default:
                blocks.push({ type: 'para', text, runs, ...(role.align ? { align: role.align } : {}) });
        }
    }

    return {
        ir: { title, doc_type: 'plain', blocks },
        stats,
    };
}

/**
 * 연속한 list-item / code-line을 원래 블록 모양(list, code)으로 다시 묶는다.
 * 왕복 비교에서 "구조"를 보려면 이 단계가 필요하다.
 */
export function coalesceBlocks(blocks) {
    const out = [];
    for (const b of blocks) {
        const last = out[out.length - 1];
        if (b.type === 'list-item') {
            if (last && last.type === 'list') {
                last.items.push({ text: b.text, level: b.level, runs: b.runs });
            } else {
                out.push({ type: 'list', items: [{ text: b.text, level: b.level, runs: b.runs }] });
            }
            continue;
        }
        if (b.type === 'code-line') {
            if (last && last.type === 'code') {
                last.text += '\n' + b.text;
            } else {
                out.push({ type: 'code', text: b.text });
            }
            continue;
        }
        out.push(b);
    }
    return out;
}
