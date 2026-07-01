/* ===================================================================
 * [parsers.js]  포맷별 입력 파일 → IR(중간 표현 JSON) 변환 파서 모음
 * ===================================================================
 * IR 구조 예시:
 *   {
 *     title: "문서 제목",
 *     doc_type: "official" | "report" | "plain",
 *     blocks: [
 *       { type: "heading", level: 1, text: "제목" },
 *       { type: "para",    text: "본문 단락" },
 *       { type: "list",    items: ["항목 1", "항목 2"] },
 *       { type: "table",   header: ["열1","열2"], rows: [["값1","값2"]] }
 *     ]
 *   }
 *
 * [수정 가이드]
 *   새 포맷 추가 → 이 파일에 parseXxx() 함수 추가 후
 *                  맨 아래 PARSERS 맵에 "확장자" → { fn, ... } 항목 추가
 * ===================================================================*/

'use strict';

// ─────────────────────────────────────────────────────────────────────────
// [공통 유틸] 파서 전반에서 재사용하는 보조 함수들
// ─────────────────────────────────────────────────────────────────────────

/** 텍스트에서 제어 문자(비표시 문자) 제거 — XML 생성 시 오류 방지 */
function sanitize(s) {
    // \x00-\x08 등 XML에서 허용되지 않는 제어 문자를 공백으로 치환
    return String(s || '').replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
}

/** 빈 IR 기본 객체 반환 */
function emptyIR(title = '제목 없음', docType = 'plain') {
    return { title: sanitize(title), doc_type: docType, blocks: [] };
}

// GFM 각주 처리용 모듈 레벨 Map — parseMd 호출마다 초기화된다.
const _mdFnMap = new Map();

/**
 * YAML frontmatter 추출 (---\n...\n--- 블록).
 * title: 같은 key: value 쌍을 meta 객체로 반환하고, body는 frontmatter 제거 후 본문이다.
 */
function parseFrontmatter(text) {
    const m = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(text);
    if (!m) return { meta: {}, body: text };
    const meta = {};
    for (const line of m[1].split(/\r?\n/)) {
        const kv = /^([\w-]+)[ \t]*:[ \t]*(.*)$/.exec(line);
        if (kv) meta[kv[1].toLowerCase()] = kv[2].trim().replace(/^['"]|['"]$/g, '');
    }
    return { meta, body: text.slice(m[0].length) };
}

/**
 * GFM 각주 전처리.
 * [^id]: text 정의를 _mdFnMap에 저장하고 본문에서 제거한다.
 * [^id] 참조를 U+FFF9 N U+FFFA 마커로 치환해 markdownInlineRuns에서 footnote run으로 복원한다.
 */
function preProcessMdFootnotes(text) {
    _mdFnMap.clear();
    const defs = {};
    const body = text.replace(/^\[\^([^\]\n]+)\]:[ \t]+(.+)$/gm, (_, id, def) => {
        defs[id.trim()] = def.trim();
        return '';
    });
    let counter = 0;
    return body.replace(/\[\^([^\]\n]+)\]/g, (_, id) => {
        const fnText = defs[id.trim()];
        if (fnText === undefined) return `[^${id}]`;
        const idx = counter++;
        _mdFnMap.set(idx, fnText);
        return `￹${idx}￺`;
    });
}

/**
 * 텍스트를 GFM 각주 마커(￹N￺)로 분리해 footnote run과 일반 run을 섞어 반환.
 * 각주가 없으면 splitInlineEmphasis를 그대로 위임한다.
 */
function splitWithFnRefs(text) {
    if (!_mdFnMap.size || !text.includes('￹')) return splitInlineEmphasis(text);
    const re = /￹(\d+)￺/g;
    const parts = [];
    let last = 0, m;
    while ((m = re.exec(text)) !== null) {
        if (m.index > last) parts.push(...splitInlineEmphasis(text.slice(last, m.index)));
        const fnText = _mdFnMap.get(Number(m[1]));
        if (fnText != null) parts.push({ text: '', footnote: fnText });
        last = re.lastIndex;
    }
    if (last < text.length) parts.push(...splitInlineEmphasis(text.slice(last)));
    return parts.length ? parts : splitInlineEmphasis(text);
}

/** WebP 매직 바이트 판별 (RIFF....WEBP) */
function isWebP(bytes) {
    return bytes.length >= 12 &&
        bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
        bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50;
}

/**
 * Canvas API를 이용해 WebP → PNG 변환.
 * HWPX는 BMP/PNG/JPEG/GIF만 지원하므로 WebP는 반드시 변환해야 한다.
 * 반환: { bytes: Uint8Array, width: number, height: number }
 */
function convertWebpToPng(bytes) {
    return new Promise((resolve, reject) => {
        const blob = new Blob([bytes], { type: 'image/webp' });
        const url = URL.createObjectURL(blob);
        const img = new Image();
        img.onload = () => {
            const canvas = document.createElement('canvas');
            canvas.width = img.naturalWidth;
            canvas.height = img.naturalHeight;
            canvas.getContext('2d').drawImage(img, 0, 0);
            canvas.toBlob(b => {
                URL.revokeObjectURL(url);
                if (!b) { reject(new Error('WebP를 PNG로 변환하지 못했습니다.')); return; }
                b.arrayBuffer().then(ab => resolve({
                    bytes: new Uint8Array(ab),
                    width: img.naturalWidth,
                    height: img.naturalHeight,
                })).catch(reject);
            }, 'image/png');
        };
        img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('WebP 이미지를 불러오지 못했습니다.')); };
        img.src = url;
    });
}


// ─────────────────────────────────────────────────────────────────────────
// [1] Markdown 파서
//     방법: marked.js(CDN)로 MD→HTML 변환 후, HTML 파서 재사용
//     장점: marked.js가 CommonMark 표준을 처리하므로 별도 MD 파싱 불필요
// ─────────────────────────────────────────────────────────────────────────
export function parseMd(text, docType = 'plain') {
    // marked.js가 index.html CDN으로 로드되지 않았으면 TXT 파서로 폴백
    if (typeof marked === 'undefined') {
        console.warn('[parsers] marked.js 미로드 — TXT 파서로 폴백');
        return parseTxt(text, docType);
    }
    // YAML frontmatter 추출 → title/meta 분리
    const { meta: fmMeta, body: fmBody } = parseFrontmatter(text);
    // GFM 각주 전처리: [^id]: text 정의 추출 + [^id] 참조를 마커로 치환
    const fnBody = preProcessMdFootnotes(fmBody);
    // 3개 이상 연속 빈 줄 → 빈 단락 HTML 마커로 보존
    // (marked.js는 연속 빈 줄을 하나의 단락 구분으로 처리해서 정보가 손실됨)
    const preprocessed = fnBody.replace(/\n{3,}/g, '\n\n<p></p>\n\n');
    if (typeof marked.lexer === 'function') {
        try {
            const tokens = marked.lexer(preprocessed);
            const ir = emptyIR('제목 없음', docType);
            extractMarkdownTokens(tokens, ir.blocks);
            const firstH1Idx = ir.blocks.findIndex(b => b.type === 'heading' && b.level === 1);
            if (firstH1Idx !== -1) {
                ir.title = ir.blocks[firstH1Idx].text;
                ir.blocks.splice(firstH1Idx, 1);
            } else if (fmMeta.title) {
                ir.title = sanitize(fmMeta.title);
            }
            ir.codeAudit = collectCodeAudit(ir.blocks);
            return ir;
        } catch (e) {
            console.warn('[parsers] marked lexer 실패 — HTML 파서로 폴백', e);
        }
    }
    let html = marked.parse(preprocessed);
    // CommonMark 엣지 케이스 폴백: **"텍스트"** 처럼 유니코드 구두점에 인접한 ** / * 를
    // marked.js가 right-flanking delimiter로 인식하지 못해 변환 실패하는 경우 보정
    html = html.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, '<em>$1</em>');
    const ir = parseHtml(html, docType);
    if (fmMeta.title && ir.title === '제목 없음') ir.title = sanitize(fmMeta.title);
    return ir;
}

/**
 * marked 인라인 토큰의 .text는 HTML 엔티티로 이스케이프돼 있다(&quot; &amp; &lt; 등).
 * 이를 디코드하지 않으면 hwpx 생성 시 xmlEsc가 한 번 더 이스케이프해 한컴에서
 * `A &amp; B`, `"` → `&quot;` 처럼 깨져 보인다. 알려진 엔티티만 역변환(&amp;는 마지막).
 * (펜스 코드블록 .text는 이스케이프되지 않으므로 이 함수를 적용하지 않는다)
 */
function decodeMdEntities(s) {
    return String(s == null ? '' : s)
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&apos;/g, "'")
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&');
}

function plainMdText(token) {
    if (!token) return '';
    if (typeof token === 'string') return sanitize(decodeMdEntities(token));
    if (Array.isArray(token)) return sanitize(token.map(plainMdText).join(''));
    if (token.type === 'codespan') return sanitize(decodeMdEntities(token.text || token.raw || ''));
    if (token.type === 'br') return '\n';
    if (token.tokens) return plainMdText(token.tokens);
    return sanitize(decodeMdEntities(token.text || token.raw || ''));
}

/**
 * marked가 구두점 인접(flanking) 규칙으로 놓친 인라인 강조를 텍스트에서 복구.
 *   `**굵게**`(strong) · `*기울임*`(em) · `~~취소~~`(del) 를 런 배열로 분리한다.
 * marked가 정상 토큰화한 경우 text 토큰에는 `*`/`~`가 남지 않으므로 중복 처리되지 않는다.
 * (예: `"**굵게**"`, `(**굵게**)`, `**굵게**:` 처럼 따옴표·괄호·콜론에 붙은 경우 복구)
 */
function splitInlineEmphasis(text) {
    const src = String(text == null ? '' : text);
    if (!/[*~]/.test(src)) return [{ text: src }];
    const runs = [];
    // **굵게** | *기울임*(첫 글자 공백 아님) | ~~취소~~
    const re = /\*\*([^*]+?)\*\*|\*([^*\s][^*]*?)\*|~~([^~]+?)~~/g;
    let last = 0, m;
    while ((m = re.exec(src)) !== null) {
        if (m.index > last) runs.push({ text: src.slice(last, m.index) });
        if (m[1] != null)      runs.push({ text: m[1], bold: true });
        else if (m[2] != null) runs.push({ text: m[2], italic: true });
        else if (m[3] != null) runs.push({ text: m[3], strike: true });
        last = re.lastIndex;
    }
    if (last < src.length) runs.push({ text: src.slice(last) });
    return runs.length ? runs : [{ text: src }];
}

/**
 * marked 인라인 토큰 → 공통 IR run.
 * 링크는 표시 문자열과 href/title을 분리해 보존하고, strong/em/del의 중첩 서식을 유지한다.
 * image 토큰은 문단 블록 분할이 필요하므로 processMdInlineBlocks()에서 처리한다.
 */
function markdownInlineRuns(tokens, inherited = {}) {
    const runs = [];
    const source = Array.isArray(tokens) ? tokens : [];
    for (const token of source) {
        if (!token || token.type === 'image') continue;
        if (token.type === 'br') {
            runs.push({ ...inherited, text: '\n' });
            continue;
        }
        if (token.type === 'codespan') {
            const text = sanitize(decodeMdEntities(token.text || token.raw || ''));
            if (text) runs.push({ ...inherited, text, code: true });
            continue;
        }
        if (token.type === 'strong' || token.type === 'em' || token.type === 'del') {
            const next = {
                ...inherited,
                bold: inherited.bold || token.type === 'strong',
                italic: inherited.italic || token.type === 'em',
                strike: inherited.strike || token.type === 'del',
            };
            runs.push(...markdownInlineRuns(token.tokens || [{ type: 'text', text: token.text || '' }], next));
            continue;
        }
        if (token.type === 'link') {
            const rawHref = sanitize(decodeMdEntities(token.href || ''));
            // IR 레벨에서 위험 스킴 차단(defense-in-depth) — hwpx.js와 preview도 각자 검증함
            const href = /^(https?:|mailto:|#)/i.test(rawHref) ? rawHref : '';
            const title = sanitize(decodeMdEntities(token.title || ''));
            const next = { ...inherited, href, title };
            runs.push(...markdownInlineRuns(token.tokens || [{ type: 'text', text: token.text || href }], next));
            continue;
        }
        if (token.tokens) {
            runs.push(...markdownInlineRuns(token.tokens, inherited));
            continue;
        }
        const text = plainMdText(token.text || token.raw);
        if (text) {
            for (const run of splitWithFnRefs(text)) runs.push({ ...inherited, ...run });
        }
    }
    return runs;
}

/**
 * Markdown 표 셀 → 문자열 또는 서식 있는 공통 셀 객체.
 * 평문 셀은 기존 문자열 IR을 유지하고, bold/italic/code/strike가 있을 때만
 * { text, runs }로 승격한다. 표 내부 링크·이미지는 아직 표시 텍스트만 보존한다.
 */
function markdownTableCell(cell) {
    const source = cell?.tokens || cell?.text || cell || '';
    const text = sanitize(plainMdText(source).trim());
    const runs = markdownInlineRuns(Array.isArray(source) ? source : [{ type: 'text', text: source }])
        .map(({ text: runText, bold, italic, code, underline, strike, color }) => ({
            text: sanitize(runText ?? ''),
            ...(bold ? { bold: true } : {}),
            ...(italic ? { italic: true } : {}),
            ...(code ? { code: true } : {}),
            ...(underline ? { underline: true } : {}),
            ...(strike ? { strike: true } : {}),
            ...(color ? { color } : {}),
        }))
        .filter(run => run.text);
    const hasFormatting = runs.some(run =>
        run.bold || run.italic || run.code || run.underline || run.strike || run.color
    );
    return hasFormatting ? { text, runs } : text;
}

function markdownImageSource(token) {
    return {
        type: 'image-source',
        src: sanitize(decodeMdEntities(token?.href || '')),
        alt: sanitize(decodeMdEntities(token?.text || '')),
        title: sanitize(decodeMdEntities(token?.title || '')),
        sourceFormat: 'md',
    };
}

function processMdInlineBlocks(tokens, blocks) {
    const source = Array.isArray(tokens) ? tokens : [];
    const meaningful = source.filter(token => {
        if (!token) return false;
        if (token.type === 'br') return true;
        return plainMdText(token.tokens || token.text || token.raw).trim() !== '';
    });
    // 문단 전체가 단일 인라인 코드인 경우에만 기존 코드 블록(표) 표현을 유지한다.
    if (meaningful.length === 1 && meaningful[0].type === 'codespan') {
        blocks.push({
            type: 'code',
            text: sanitize(decodeMdEntities(meaningful[0].text || '')),
            inline: true,
        });
        return;
    }

    let paraRuns = [];
    function flushPara() {
        const hasText = paraRuns.some(r => r.text && r.text.trim());
        if (hasText) blocks.push({ type: 'para', runs: paraRuns });
        paraRuns = [];
    }
    for (const token of source) {
        if (token.type === 'image') {
            flushPara();
            blocks.push(markdownImageSource(token));
            continue;
        }
        paraRuns.push(...markdownInlineRuns([token]));
    }
    flushPara();
}

/**
 * marked list 토큰을 재귀적으로 평면화 — 중첩 항목을 잃지 않고 level로 들여쓰기 보존.
 * 각 항목: {text, codeBlocks, level, ordered, marker(번호|null), task, checked}
 */
function flattenMdList(listToken, level, out) {
    const ordered = !!listToken.ordered;
    let n = (typeof listToken.start === 'number' && listToken.start > 0) ? listToken.start : 1;
    for (const item of (listToken.items || [])) {
        const ownBlocks = [];
        const nested = [];
        for (const t of (item.tokens || [])) {
            if (t.type === 'list') nested.push(t);          // 하위 목록은 레벨+1로 따로
            else extractMarkdownTokens([t], ownBlocks);
        }
        const textParts = ownBlocks
            .filter(b => b.type === 'para' || b.type === 'heading')
            .map(b => b.text ? sanitize(decodeMdEntities(b.text)) : plainMdText(b.runs || ''))
            .filter(Boolean);
        const runs = [];
        for (const token of (item.tokens || [])) {
            if (token.type === 'list' || token.type === 'code') continue;
            const inlineTokens = token.tokens || [token];
            const tokenRuns = markdownInlineRuns(inlineTokens);
            if (!tokenRuns.length) continue;
            if (runs.length) runs.push({ text: ' ' });
            runs.push(...tokenRuns);
        }
        if (!runs.length) {
            for (const block of ownBlocks.filter(b => b.type === 'para')) {
                const blockRuns = Array.isArray(block.runs) && block.runs.length
                    ? block.runs.map(run => ({ ...run }))
                    : (block.text ? [{ text: block.text }] : []);
                if (!blockRuns.length) continue;
                if (runs.length) runs.push({ text: ' ' });
                runs.push(...blockRuns);
            }
        }
        const codeBlocks = ownBlocks.filter(b => b.type === 'code');
        const fallbackText = typeof item.text === 'string' ? decodeMdEntities(item.text) : '';
        const text = sanitize(textParts.join(' ').trim() || fallbackText);
        if (text || codeBlocks.length) {
            out.push({
                text, runs, codeBlocks, level, ordered,
                marker: ordered ? (n++) : null,
                task: item.task === true,
                checked: !!item.checked,
            });
        } else if (ordered) {
            n++;   // 빈 항목도 번호는 소비해 순서 유지
        }
        for (const sub of nested) flattenMdList(sub, level + 1, out);
    }
}

function extractMarkdownTokens(tokens, blocks) {
    for (const token of (tokens || [])) {
        if (!token) continue;
        if (token.type === 'heading') {
            const text = sanitize(plainMdText(token.tokens || token.text).trim());
            if (text) blocks.push({ type: 'heading', level: token.depth || 1, text });
        } else if (token.type === 'paragraph') {
            processMdInlineBlocks(token.tokens || [{ type: 'text', text: token.text || '' }], blocks);
        } else if (token.type === 'image') {
            blocks.push(markdownImageSource(token));
        } else if (token.type === 'code') {
            blocks.push({ type: 'code', text: sanitize(token.text || ''), lang: sanitize(token.lang || '').trim() });
        } else if (token.type === 'space') {
            blocks.push({ type: 'blank' });
        } else if (token.type === 'hr') {
            blocks.push({ type: 'hr' });
        } else if (token.type === 'list') {
            // 중첩 목록을 평면화하되 각 항목에 level(들여쓰기)·번호·태스크를 보존
            const items = [];
            flattenMdList(token, 0, items);
            if (items.length) blocks.push({ type: 'list', items });
        } else if (token.type === 'blockquote') {
            const quoteBlocks = [];
            extractMarkdownTokens(token.tokens || [], quoteBlocks);
            blocks.push({ type: 'quote', blocks: quoteBlocks });
        } else if (token.type === 'table') {
            const header = (token.header || []).map(markdownTableCell);
            const rows = (token.rows || []).map(row =>
                row.map(markdownTableCell)
            );
            blocks.push({ type: 'table', header, rows });
        } else if (token.type === 'html') {
            const htmlIr = parseHtml(token.raw || token.text || '', 'plain');
            blocks.push(...htmlIr.blocks);
        } else if (token.tokens) {
            extractMarkdownTokens(token.tokens, blocks);
        } else if (token.text) {
            blocks.push({ type: 'para', text: sanitize(decodeMdEntities(token.text)) });
        }
    }
}

function collectCodeAudit(blocks) {
    const codeBlocks = [];
    function walk(list) {
        for (const block of (list || [])) {
            if (block.type === 'code') {
                const lines = String(block.text ?? '').split('\n');
                codeBlocks.push({
                    lang: block.lang || '',
                    lineCount: lines.length,
                    firstLine: lines[0] ?? '',
                    lastLine: lines[lines.length - 1] ?? '',
                });
            } else if (block.type === 'quote') {
                walk(block.blocks);
            } else if (block.type === 'list') {
                for (const item of (block.items || [])) walk(item.codeBlocks);
            }
        }
    }
    walk(blocks);
    return {
        blockCount: codeBlocks.length,
        lineCount: codeBlocks.reduce((sum, b) => sum + b.lineCount, 0),
        blocks: codeBlocks,
    };
}


// ─────────────────────────────────────────────────────────────────────────
// [2] HTML 파서
//     방법: DOMParser API로 HTML DOM을 생성하고 요소 순회하며 IR 블록 추출
//     보안: 파싱 결과를 textContent로만 읽어 XSS 실행 불가
// ─────────────────────────────────────────────────────────────────────────
export function parseHtml(htmlText, docType = 'plain') {
    const parser = new DOMParser();
    const doc = parser.parseFromString(htmlText, 'text/html');

    // <title> 태그가 있으면 문서 제목으로 사용
    const titleEl = doc.querySelector('title');
    const explicitTitle = titleEl ? sanitize(titleEl.textContent.trim()) : '';
    const ir = emptyIR(explicitTitle || '제목 없음', docType);

    extractFromNode(doc.body || doc.documentElement, ir.blocks);

    // <title> 없는 경우(Markdown→HTML 변환 등): 첫 번째 H1 블록을 문서 제목으로 승격
    // 승격된 H1은 본문 목록에서 제거 (buildSection이 ir.title을 별도로 출력)
    if (!explicitTitle) {
        const firstH1Idx = ir.blocks.findIndex(b => b.type === 'heading' && b.level === 1);
        if (firstH1Idx !== -1) {
            ir.title = ir.blocks[firstH1Idx].text;
            ir.blocks.splice(firstH1Idx, 1);
        }
    }

    return ir;
}

/** 색상 문자열(#rgb/#rrggbb/rgb()/일부 색이름) → #RRGGBB 정규화. 실패 시 null */
function normalizeHexColor(raw) {
    if (!raw) return null;
    raw = String(raw).trim();
    let m = /^#([0-9a-fA-F]{6})$/.exec(raw);
    if (m) return '#' + m[1].toUpperCase();
    m = /^#([0-9a-fA-F]{3})$/.exec(raw);
    if (m) return '#' + m[1].split('').map(c => c + c).join('').toUpperCase();
    m = /^rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)$/i.exec(raw);
    if (m) return '#' + [m[1], m[2], m[3]]
        .map(n => Math.max(0, Math.min(255, parseInt(n, 10))).toString(16).padStart(2, '0')).join('').toUpperCase();
    const named = { red: '#FF0000', blue: '#0000FF', green: '#008000', black: '#000000',
        white: '#FFFFFF', gray: '#808080', grey: '#808080', orange: '#FFA500',
        purple: '#800080', yellow: '#FFFF00', navy: '#000080', teal: '#008080' };
    return named[raw.toLowerCase()] || null;
}

/** 요소의 글자색을 style="color:" 또는 <font color>에서 추출 → #RRGGBB | null */
function extractNodeColor(node) {
    if (!node || node.nodeType !== 1 || typeof node.getAttribute !== 'function') return null;
    const style = node.getAttribute('style');
    if (style) {
        const m = /(?:^|;)\s*color\s*:\s*([^;]+)/i.exec(style);
        const c = m && normalizeHexColor(m[1]);
        if (c) return c;
    }
    return normalizeHexColor(node.getAttribute('color'));
}

/**
 * DOM 요소 안의 인라인 서식을 runs 배열로 추출
 * bold/italic/code 외에 underline(u/ins)·strike(s/strike/del)·color(style/font)도 보존.
 * hwpx.js buildParaRuns()와 대응됨
 */
function extractInlineRuns(el) {
    const runs = [];
    function walk(node, st) {
        if (node.nodeType === 3) {
            const text = sanitize(node.textContent || '');
            if (text) runs.push({ text, bold: st.bold, italic: st.italic, code: st.code,
                underline: st.underline, strike: st.strike, color: st.color || null });
        } else if (node.nodeType === 1) {
            const t = (node.tagName || '').toLowerCase();
            const next = {
                bold:      st.bold      || t === 'strong' || t === 'b',
                italic:    st.italic    || t === 'em'     || t === 'i',
                code:      st.code      || t === 'code',
                underline: st.underline || t === 'u'      || t === 'ins',
                strike:    st.strike    || t === 's'      || t === 'strike' || t === 'del',
                color:     extractNodeColor(node) || st.color,
            };
            for (const ch of node.childNodes) walk(ch, next);
        }
    }
    for (const ch of el.childNodes) walk(ch, { bold: false, italic: false, code: false, underline: false, strike: false, color: null });
    return runs;
}

/** HTML 노드 재귀 순회 → 의미 있는 요소를 IR 블록으로 추출 */
function extractFromNode(node, blocks) {
    for (const child of node.childNodes) {
        const tag = (child.tagName || '').toLowerCase();

        if (child.nodeType === Node.TEXT_NODE) {
            // HTML 소스 대신 웹 화면의 일반 텍스트를 붙여넣은 경우에도 빈 문서가 되지 않게 보존한다.
            // 요소 사이의 들여쓰기/개행처럼 공백뿐인 텍스트 노드는 건너뛴다.
            const text = sanitize(child.textContent.trim());
            if (text) blocks.push({ type: 'para', text });

        } else if (/^h[1-6]$/.test(tag)) {
            // h1~h6 → heading 블록 (level = 숫자 부분)
            const text = sanitize(child.textContent.trim());
            if (text) blocks.push({ type: 'heading', level: parseInt(tag[1], 10), text });

        } else if (tag === 'p') {
            // <p> → 인라인 서식 보존 runs 배열로 추출
            // textContent 대신 DOM 순회 → bold/italic/code 플래그 유지
            const runs = extractInlineRuns(child);
            const hasText = runs.some(r => r.text && r.text.trim());
            if (hasText) {
                blocks.push({ type: 'para', runs });
            } else {
                blocks.push({ type: 'blank' });
            }

        } else if (tag === 'ul' || tag === 'ol') {
            // 들여쓴 HTML과 중첩 목록도 직접 항목 텍스트·레벨·번호를 보존
            const items = extractHtmlList(child);
            if (items.length) blocks.push({ type: 'list', ordered: tag === 'ol', items });

        } else if (tag === 'table') {
            // <table> → table 블록
            const tb = extractHtmlTable(child);
            if (tb) blocks.push(tb);

        } else if (tag === 'pre') {
            // <pre> 또는 <pre><code> → code 블록 (코드 스타일 9pt 들여쓰기)
            const codeEl = child.querySelector('code') || child;
            const text = sanitize(codeEl.textContent.trim());
            if (text) blocks.push({ type: 'code', text });

        } else if (tag === 'code' && (child.parentNode && (child.parentNode.tagName || '').toLowerCase() !== 'pre')) {
            // 인라인 <code>: 백틱 감싸서 para로 처리 (블록 수준 code와 구분)
            const text = sanitize(child.textContent.trim());
            if (text) blocks.push({ type: 'para', text: '`' + text + '`' });

        } else if (tag === 'blockquote') {
            // 인용 → quote IR. HWPX 출력에서 전용 문단 모양(왼쪽 선+배경)을 적용한다.
            const quoteBlocks = [];
            extractFromNode(child, quoteBlocks);
            if (quoteBlocks.length) {
                blocks.push({ type: 'quote', blocks: quoteBlocks });
            } else {
                const text = sanitize(child.textContent.trim());
                if (text) blocks.push({ type: 'quote', blocks: [{ type: 'para', text }] });
            }

        } else if (tag === 'hr') {
            // 수평선 → HR 블록 (hwpx.js buildHrPara()에서 단락 하단 테두리 선으로 렌더링)
            blocks.push({ type: 'hr' });

        } else if (child.childNodes && child.childNodes.length > 0
            && !['script', 'style', 'head', 'nav', 'footer', 'aside'].includes(tag)) {
            // div, section, article 등 컨테이너는 재귀 탐색
            // script/style/nav/footer 등 비콘텐츠 요소는 건너뜀
            extractFromNode(child, blocks);
        }
    }
}

function extractHtmlList(listEl, level = 0, out = []) {
    const ordered = (listEl.tagName || '').toLowerCase() === 'ol';
    const start = ordered ? (parseInt(listEl.getAttribute('start') || '1', 10) || 1) : null;
    const children = Array.from(listEl.children || []).filter(el => (el.tagName || '').toLowerCase() === 'li');
    children.forEach((li, index) => {
        const clone = li.cloneNode(true);
        clone.querySelectorAll('ul, ol').forEach(nested => nested.remove());
        const text = sanitize(clone.textContent.trim());
        if (text) out.push({ text, level, ordered, marker: ordered ? start + index : null });
        Array.from(li.children || [])
            .filter(el => ['ul', 'ol'].includes((el.tagName || '').toLowerCase()))
            .forEach(nested => extractHtmlList(nested, level + 1, out));
    });
    return out;
}

/** <table> DOM 요소 → IR table 블록 변환 */
function extractHtmlTable(tableEl) {
    const rows = tableEl.querySelectorAll('tr');
    if (!rows.length) return null;

    const allRows = Array.from(rows).map(tr =>
        Array.from(tr.querySelectorAll(':scope > th, :scope > td')).map(td => ({
            text: sanitize(td.textContent.trim()),
            colSpan: Math.max(1, parseInt(td.getAttribute('colspan') || '1', 10) || 1),
            rowSpan: Math.max(1, parseInt(td.getAttribute('rowspan') || '1', 10) || 1),
        }))
    );

    if (!allRows.length) return null;
    // 첫 행을 항상 헤더 행으로 처리 (D9D9D9 배경색 적용)
    return { type: 'table', header: allRows[0], rows: allRows.slice(1) };
}


// ─────────────────────────────────────────────────────────────────────────
// [3] 일반 텍스트(TXT) 파서
//     방법: 빈 줄로 단락 구분, '#' 접두어로 제목 인식
// ─────────────────────────────────────────────────────────────────────────
export function parseTxt(text, docType = 'plain') {
    const ir = emptyIR('텍스트 문서', docType);
    // 2개 이상 연속 줄바꿈을 단락 구분자로 사용
    const paragraphs = text.split(/\n{2,}/);
    let titleSet = false;

    for (const para of paragraphs) {
        const trimmed = sanitize(para.trim());
        if (!trimmed) continue;

        // 간이 Markdown 제목 인식 (####, ###, ##, #)
        const headMatch = trimmed.match(/^(#{1,6})\s+(.+)$/);
        if (headMatch) {
            const level = headMatch[1].length;
            const headText = headMatch[2];
            if (level === 1 && !titleSet) {
                // 첫 번째 H1 → 문서 제목으로 승격
                ir.title = headText;
                titleSet = true;
            } else {
                ir.blocks.push({ type: 'heading', level, text: headText });
            }
            continue;
        }

        // 줄 단위 목록 인식 ("- " / "* " / "+ " 으로 시작하는 항목들)
        const lines = para.split('\n').map(l => sanitize(l.trim())).filter(Boolean);
        const isList = lines.every(l => /^[-*+]\s/.test(l) || /^\d+\.\s/.test(l));
        if (isList && lines.length > 0) {
            const isOrdered = /^\d+\.\s/.test(lines[0]);
            const items = lines.map(l => l.replace(/^[-*+]\s+/, '').replace(/^\d+\.\s+/, ''));
            ir.blocks.push({ type: 'list', ordered: isOrdered, items });
            continue;
        }

        // 코드 블록 (``` 로 감싼 경우)
        if (trimmed.startsWith('```')) {
            const codeText = trimmed.replace(/^```[^\n]*\n?/, '').replace(/```$/, '').trim();
            if (codeText) ir.blocks.push({ type: 'code', text: codeText });
            continue;
        }

        ir.blocks.push({ type: 'para', text: trimmed });
    }

    return ir;
}


// ─────────────────────────────────────────────────────────────────────────
// [4] CSV 파서
//     방법: RFC 4180 표준 CSV 파싱, 첫 행을 헤더로 사용
//     의존성 없음 — 순수 JS 구현
// ─────────────────────────────────────────────────────────────────────────
export function parseCsv(text, docType = 'plain') {
    const ir = emptyIR('스프레드시트', docType);
    const delimiter = detectDelimitedTextSeparator(text);
    const rows = csvToRows(text, delimiter);
    if (!rows.length) return ir;

    // 붙여넣기 표에서 행별 열 수가 다르면 가장 넓은 행에 맞춰 빈 셀을 보충한다.
    // 데이터가 조용히 잘리거나 HWPX 표 격자가 어긋나는 것을 막는다.
    const columnCount = Math.max(...rows.map(row => row.length));
    const normalizeRow = row => Array.from(
        { length: columnCount },
        (_, index) => sanitize(row[index] ?? '')
    );
    const header = normalizeRow(rows[0]);
    const dataRows = rows.slice(1).map(normalizeRow);

    if (dataRows.length) {
        // 데이터가 있으면 table 블록
        ir.blocks.push({ type: 'table', header, rows: dataRows });
    } else {
        // 1행만 있으면 목록으로 처리
        ir.blocks.push({ type: 'list', items: header });
    }
    return ir;
}

/**
 * CSV/TSV 문자열 → 2차원 배열
 * 따옴표 안 구분자, 이중 따옴표 이스케이프(""), CRLF/LF 모두 처리
 */
function csvToRows(text, delimiter = ',') {
    const rows = [];
    let row = [], field = '', inQuote = false;

    for (let i = 0; i < text.length; i++) {
        const c = text[i];

        if (inQuote) {
            if (c === '"' && text[i + 1] === '"') {
                // 이중 따옴표("") → 따옴표 문자 하나로 처리
                field += '"';
                i++;
            } else if (c === '"') {
                inQuote = false;
            } else {
                field += c;
            }
        } else if (c === '"') {
            inQuote = true;
        } else if (c === delimiter) {
            row.push(field);
            field = '';
        } else if (c === '\r' && text[i + 1] === '\n') {
            // CRLF 줄바꿈
            row.push(field); field = '';
            if (row.some(v => v.trim())) rows.push(row);
            row = []; i++;
        } else if (c === '\n') {
            row.push(field); field = '';
            if (row.some(v => v.trim())) rows.push(row);
            row = [];
        } else {
            field += c;
        }
    }
    if (inQuote) {
        throw new Error('표 데이터 파싱 오류: 닫히지 않은 따옴표가 있습니다.');
    }
    // 마지막 행 처리 (줄바꿈 없이 끝나는 경우)
    row.push(field);
    if (row.some(v => v.trim())) rows.push(row);
    return rows;
}

/**
 * CSV 파일의 쉼표와 Excel/Google Sheets에서 복사한 TSV의 탭을 자동 판별한다.
 * 따옴표 안 구분자는 셀 내용이므로 개수에서 제외한다.
 */
function detectDelimitedTextSeparator(text) {
    let commaCount = 0;
    let tabCount = 0;
    let inQuote = false;
    let recordCount = 0;

    for (let i = 0; i < text.length && recordCount < 20; i++) {
        const c = text[i];
        if (c === '"' && inQuote && text[i + 1] === '"') {
            i++;
        } else if (c === '"') {
            inQuote = !inQuote;
        } else if (!inQuote && c === ',') {
            commaCount++;
        } else if (!inQuote && c === '\t') {
            tabCount++;
        } else if (!inQuote && c === '\n') {
            recordCount++;
        }
    }

    return tabCount > commaCount ? '\t' : ',';
}


// ─────────────────────────────────────────────────────────────────────────
// [5] XLSX 파서
//     방법: SheetJS(CDN) 라이브러리로 첫 번째 시트 → CSV 변환 후 parseCsv() 재사용
//     [주의] SheetJS가 CDN에서 로드되어 있어야 함 (index.html 스크립트 태그 참조)
// ─────────────────────────────────────────────────────────────────────────
function parseXlsx(arrayBuffer, docType = 'plain') {
    if (typeof XLSX === 'undefined') {
        throw new Error('SheetJS 라이브러리 미로드: XLSX 처리 불가. 인터넷 연결을 확인하세요.');
    }

    const workbook = XLSX.read(arrayBuffer, { type: 'array' });
    const firstSheetName = workbook.SheetNames[0];
    if (!firstSheetName || !workbook.Sheets[firstSheetName]) {
        throw new Error('XLSX 첫 번째 시트를 찾을 수 없습니다. 비어 있거나 손상된 파일입니다.');
    }
    // sheet_to_csv로 CSV 문자열 생성 후 파서 재사용
    const csvText = XLSX.utils.sheet_to_csv(workbook.Sheets[firstSheetName]);
    const ir = parseCsv(csvText, docType);
    ir.title = sanitize(firstSheetName) || 'XLSX 문서';
    return ir;
}


// ─────────────────────────────────────────────────────────────────────────
// [6] JSON 파서
//     방법: IR 형식이면 직접 사용; 아니면 key-value 구조를 표/목록으로 변환
// ─────────────────────────────────────────────────────────────────────────
export function parseJson(text, docType = 'plain') {
    let obj;
    try {
        obj = JSON.parse(text);
    } catch (e) {
        throw new Error('JSON 파싱 오류: ' + e.message);
    }

    // IR 형식 판별: { blocks: [...] } 구조면 직접 사용
    if (obj && typeof obj === 'object' && Array.isArray(obj.blocks)) {
        return {
            title: sanitize(obj.title || 'JSON 문서'),
            doc_type: obj.doc_type || docType,
            blocks: obj.blocks.map(sanitizeIrBlock),
        };
    }

    // 일반 JSON → key-value 표/목록으로 변환
    const ir = emptyIR('JSON 문서', docType);
    let content = obj;
    if (obj && typeof obj === 'object' && !Array.isArray(obj) && typeof obj.title === 'string') {
        ir.title = sanitize(obj.title) || ir.title;
        content = { ...obj };
        delete content.title;
    }
    jsonToBlocks(content, ir.blocks, 0);
    return ir;
}

/** JSON 값을 재귀적으로 IR 블록으로 변환 */
function jsonToBlocks(value, blocks, depth) {
    if (Array.isArray(value)) {
        // 모든 항목이 단순값(문자열/숫자)이면 list 블록
        const allSimple = value.every(v => typeof v !== 'object' || v === null);
        if (allSimple) {
            blocks.push({ type: 'list', items: value.map(v => sanitize(String(v))) });
        } else if (value.length && value.every(v => v && typeof v === 'object' && !Array.isArray(v))) {
            // 객체 배열은 key 합집합을 열로 사용해 실제 데이터 표로 변환
            const keys = [...new Set(value.flatMap(v => Object.keys(v)))];
            blocks.push({
                type: 'table',
                header: keys.map(sanitize),
                rows: value.map(v => keys.map(k => {
                    const cell = v[k];
                    return cell && typeof cell === 'object' ? JSON.stringify(cell) : sanitize(String(cell ?? ''));
                })),
            });
        } else {
            // 복잡한 배열: 인덱스 제목 + 재귀
            value.forEach((v, i) => {
                blocks.push({ type: 'heading', level: Math.min(depth + 2, 6), text: `[${i}]` });
                jsonToBlocks(v, blocks, depth + 1);
            });
        }
    } else if (value && typeof value === 'object') {
        // 단순값은 키/값 표, 중첩 객체·배열은 키 제목 아래 구조적으로 재귀 전개
        const entries = Object.entries(value);
        const simple = entries.filter(([, v]) => typeof v !== 'object' || v === null);
        if (simple.length) {
            blocks.push({
                type: 'table',
                header: ['키', '값'],
                rows: simple.map(([k, v]) => [sanitize(k), sanitize(String(v ?? ''))]),
            });
        }
        for (const [key, nested] of entries.filter(([, v]) => v && typeof v === 'object')) {
            blocks.push({ type: 'heading', level: Math.min(depth + 2, 6), text: sanitize(key) });
            jsonToBlocks(nested, blocks, depth + 1);
        }
    } else {
        blocks.push({ type: 'para', text: sanitize(String(value)) });
    }
}


// ─────────────────────────────────────────────────────────────────────────
// [7] IPYNB 파서 (Jupyter Notebook)
//     방법: IPYNB는 JSON 구조. cell_type에 따라 markdown/code/raw 처리
//     지원: nbformat 3(worksheets) / 4(cells) 모두 처리
//     이미지 출력(image/png, image/jpeg)은 base64 → HWPX 그림 블록으로 변환
// ─────────────────────────────────────────────────────────────────────────
function parseIpynb(text, docType = 'plain') {
    let nb;
    try {
        nb = JSON.parse(text);
    } catch (e) {
        throw new Error('IPYNB 파싱 오류: JSON 형식이 아님 (' + e.message + ')');
    }

    const ir = emptyIR('Jupyter Notebook', docType);
    // nbformat 3: nb.worksheets[0].cells / nbformat 4: nb.cells
    const cells = nb.cells || (nb.worksheets && nb.worksheets[0] && nb.worksheets[0].cells) || [];
    let imageCounter = 1;

    for (const cell of cells) {
        // source는 문자열 배열 또는 단일 문자열로 올 수 있음
        const source = Array.isArray(cell.source) ? cell.source.join('') : (cell.source || '');

        if (cell.cell_type === 'markdown') {
            // 마크다운 셀 → MD 파서 재사용
            const mdIR = parseMd(source, docType);
            if (mdIR.title && mdIR.title !== '제목 없음' && ir.title === 'Jupyter Notebook') {
                ir.title = mdIR.title;
            }
            ir.blocks.push(...mdIR.blocks);

        } else if (cell.cell_type === 'code') {
            // 코드 셀: 등폭 코드 블록으로 출력
            if (source.trim()) {
                ir.blocks.push({ type: 'code', text: sanitize(source.replace(/\s+$/, '')) });
            }
            // 실행 출력 처리
            for (const out of (cell.outputs || [])) {
                const otype = out.output_type;
                if (otype === 'stream' || otype === 'execute_result' || otype === 'display_data') {
                    // text 출력만 처리
                    const txt = Array.isArray(out.text) ? out.text.join('') : (out.text || '');
                    if (txt.trim()) {
                        ir.blocks.push({ type: 'para', text: '[출력] ' + sanitize(txt) });
                    }
                    // 이미지 출력(image/png, image/jpeg) → HWPX 그림 블록
                    const imageMime = out.data && (out.data['image/png'] ? 'image/png' : out.data['image/jpeg'] ? 'image/jpeg' : null);
                    if (imageMime) {
                        const raw = out.data[imageMime];
                        const b64 = Array.isArray(raw) ? raw.join('') : (raw || '');
                        try {
                            const imageBytes = decodeBase64Bytes(b64);
                            const imageMeta = sniffRasterImage(imageBytes, imageMime);
                            const size = imageSizeHwp(imageMeta);
                            // binName은 markdown 셀 이미지가 resolveMarkdownAssets()에서
                            // 별도로 image1.png부터 다시 번호를 매기므로, 접두사를 달리해
                            // 같은 문서 안에서 binName(=BinData 파일명/manifest id)이 겹치지 않게 한다.
                            ir.blocks.push({
                                type: 'image',
                                binName: `ipynb-out${imageCounter++}.${imageMeta.ext}`,
                                mimeType: imageMeta.mimeType,
                                data: imageBytes,
                                ...size,
                                alt: '노트북 출력 그림',
                                title: '',
                                sourceFormat: 'ipynb',
                            });
                        } catch (e) {
                            ir.blocks.push({ type: 'para', text: '[그림 — HWPX에서 이미지 삽입 미지원]' });
                        }
                    }
                }
            }

        } else if (cell.cell_type === 'raw') {
            if (source.trim()) ir.blocks.push({ type: 'para', text: sanitize(source) });
        }
    }

    return ir;
}


// ─────────────────────────────────────────────────────────────────────────
// [8] DOCX 파서
//     방법: DOCX(ZIP+XML)를 JSZip으로 열고 word/document.xml을 DOMParser로 파싱
//     네임스페이스: http://schemas.openxmlformats.org/wordprocessingml/2006/main
//     지원: 이미지(word/media/) 삽입, 머리글/바닥글 추출
//     [주의] ArrayBuffer를 받는 비동기 함수 (async)
// ─────────────────────────────────────────────────────────────────────────
const DOCX_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const DOCX_NS_R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

/**
 * word/numbering.xml 파싱 → numId·abstractNumId 매핑 + 레벨별 순서/글머리 정보.
 * 반환: { numMap: {numId→absId}, abstractMap: {absId→{lvls:{ilvl→{ordered,start}}}} }
 */
async function parseDocxNumbering(zip) {
    const numMap = {};
    const abstractMap = {};
    const numFile = zip.file('word/numbering.xml');
    if (!numFile) return { numMap, abstractMap };
    try {
        const xml = await numFile.async('string');
        const doc = new DOMParser().parseFromString(xml, 'application/xml');
        for (const abs of doc.getElementsByTagNameNS(DOCX_NS, 'abstractNum')) {
            const absId = abs.getAttributeNS(DOCX_NS, 'abstractNumId')
                       || abs.getAttribute('w:abstractNumId') || '';
            if (!absId) continue;
            const lvls = {};
            for (const lvl of abs.getElementsByTagNameNS(DOCX_NS, 'lvl')) {
                const ilvl = parseInt(
                    lvl.getAttributeNS(DOCX_NS, 'ilvl') || lvl.getAttribute('w:ilvl') || '0', 10);
                const numFmtEl = lvl.getElementsByTagNameNS(DOCX_NS, 'numFmt')[0];
                const fmt = numFmtEl
                    ? (numFmtEl.getAttributeNS(DOCX_NS, 'val') || numFmtEl.getAttribute('w:val') || 'bullet')
                    : 'bullet';
                const startEl = lvl.getElementsByTagNameNS(DOCX_NS, 'start')[0];
                const start = startEl
                    ? (parseInt(startEl.getAttributeNS(DOCX_NS, 'val') || startEl.getAttribute('w:val') || '1', 10) || 1)
                    : 1;
                lvls[ilvl] = { ordered: !['bullet', 'none', 'chicago'].includes(fmt), start };
            }
            abstractMap[absId] = { lvls };
        }
        for (const num of doc.getElementsByTagNameNS(DOCX_NS, 'num')) {
            const numId = num.getAttributeNS(DOCX_NS, 'numId')
                       || num.getAttribute('w:numId') || '';
            const absRefEl = num.getElementsByTagNameNS(DOCX_NS, 'abstractNumId')[0];
            const absId = absRefEl
                ? (absRefEl.getAttributeNS(DOCX_NS, 'val') || absRefEl.getAttribute('w:val') || '')
                : '';
            if (numId && absId) numMap[numId] = absId;
        }
    } catch (_) {}
    return { numMap, abstractMap };
}

/**
 * parseDocx 내부 전용: 연속된 _list_item 블록을 list 블록으로 묶는 후처리.
 * 순서 목록의 마커 번호를 레벨별로 독립 추적한다.
 */
function groupDocxListItems(blocks) {
    const result = [];
    let i = 0;
    while (i < blocks.length) {
        if (blocks[i]?.type !== '_list_item') { result.push(blocks[i++]); continue; }
        const items = [];
        const orderCounters = {};
        while (i < blocks.length && blocks[i]?.type === '_list_item') {
            const b = blocks[i++];
            const lvl = Math.max(0, Math.min(b.level || 0, 2));
            if (b.ordered) {
                orderCounters[lvl] = (orderCounters[lvl] || 0) + 1;
                for (const k of Object.keys(orderCounters))
                    if (Number(k) > lvl) delete orderCounters[k];
            } else {
                delete orderCounters[lvl];
            }
            items.push({
                text: b.text || '',
                runs: b.runs || [],
                level: lvl,
                ordered: b.ordered || false,
                marker: b.ordered ? orderCounters[lvl] : null,
                task: false, checked: false, codeBlocks: [],
            });
        }
        result.push({ type: 'list', items });
    }
    return result;
}

/**
 * w:p 단락에서 인라인 런 배열 추출.
 * w:r, w:hyperlink(URL 포함), ins/del/sdt 컨테이너를 재귀 순회해
 * 공통 run 계약({text,bold,italic,underline,strike,color,href?})으로 반환한다.
 */
function extractDocxInlineRuns(pNode, relsMap = {}, footnotesMap = {}) {
    const runs = [];
    function walk(node, href) {
        for (const child of node.childNodes) {
            if (child.nodeType !== 1) continue;
            const local = child.localName;
            if (local === 'pPr' || local === 'rPr') continue;
            if (local === 'r') {
                const fnRef = child.getElementsByTagNameNS(DOCX_NS, 'footnoteReference')[0];
                if (fnRef) {
                    const fnId = fnRef.getAttributeNS(DOCX_NS, 'id') || fnRef.getAttribute('w:id') || '';
                    if (fnId && footnotesMap[fnId]) runs.push({ text: '', footnote: footnotesMap[fnId] });
                }
                const text = sanitize(Array.from(child.getElementsByTagNameNS(DOCX_NS, 't'))
                    .map(t => t.textContent).join(''));
                if (!text) continue;
                const run = {
                    text,
                    bold:      docxRunToggle(child, 'b'),
                    italic:    docxRunToggle(child, 'i'),
                    underline: docxRunToggle(child, 'u'),
                    strike:    docxRunToggle(child, 'strike') || docxRunToggle(child, 'dstrike'),
                    color:     docxRunColor(child),
                };
                if (href) run.href = href;
                runs.push(run);
            } else if (local === 'hyperlink') {
                const rId = child.getAttributeNS(DOCX_NS_R, 'id') || child.getAttribute('r:id') || '';
                const rawHref = (rId && relsMap[rId]?.target)
                    || child.getAttributeNS(DOCX_NS, 'url') || child.getAttribute('w:url') || '';
                const safeHref = /^https?:|^mailto:/i.test(rawHref) ? rawHref : '';
                walk(child, safeHref || href);
            } else {
                walk(child, href);
            }
        }
    }
    walk(pNode, '');
    return runs;
}

/**
 * w:p 단락에서 이미지 블록 추출
 * wp:extent(크기), a:blip(관계 ID)를 localName으로 탐색
 * @param {Element} pNode   w:p 노드
 * @param {object}  relsMap rId → {target, type} 맵
 * @param {JSZip}   zip     열린 JSZip 인스턴스
 * @param {number}  counter 이미지 카운터 (1부터)
 * @returns {object|null}   image IR 블록 또는 null
 */
async function extractDocxImage(pNode, relsMap, zip, counter) {
    const allEls = pNode.getElementsByTagName('*');
    let extentEl = null, blipEl = null, altText = '';
    for (const el of allEls) {
        if (el.localName === 'extent' && !extentEl) extentEl = el;
        if (el.localName === 'blip'   && !blipEl)   blipEl   = el;
        // docPr @descr / @title / @name → alt text (WMF/EMF fallback용 포함)
        if (el.localName === 'docPr' && !altText) {
            altText = sanitize(
                el.getAttribute('descr') || el.getAttribute('title') || el.getAttribute('name') || ''
            ).trim();
        }
    }
    if (!blipEl) return null;

    const rId = blipEl.getAttribute('r:embed')
             || blipEl.getAttributeNS(DOCX_NS_R, 'embed')
             || blipEl.getAttribute('embed')
             || '';
    if (!rId || !relsMap[rId]) return null;

    const target = relsMap[rId].target; // e.g. "media/image1.png"
    const ext    = target.split('.').pop().toLowerCase();

    // WMF/EMF 벡터 이미지 — HWPX 삽입 미지원. alt 텍스트가 있으면 안내 문단 반환.
    if (ext === 'wmf' || ext === 'emf') {
        return altText
            ? { type: 'para', text: `[벡터 이미지: ${altText}]` }
            : null;
    }

    const mimeTypes = {
        jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
        gif: 'image/gif',  bmp: 'image/bmp',   tiff: 'image/tiff',
        webp: 'image/webp',
    };
    const mimeType = mimeTypes[ext] || 'image/jpeg';

    const imgFile = zip.file('word/' + target);
    if (!imgFile) return null;
    let imgData = await imgFile.async('uint8array');

    // EMU → HWPX 단위: 1 inch = 914400 EMU = 7200 HWP units → divide EMU by 127
    const cx = parseInt(extentEl ? (extentEl.getAttribute('cx') || '0') : '0', 10);
    const cy = parseInt(extentEl ? (extentEl.getAttribute('cy') || '0') : '0', 10);
    let widthHwp  = Math.round(cx / 127);
    let heightHwp = Math.round(cy / 127);

    // WebP → PNG 변환 (HWPX는 PNG/JPEG/GIF/BMP만 지원)
    let finalExt = ext, finalMime = mimeType;
    if (ext === 'webp') {
        try {
            const conv = await convertWebpToPng(imgData);
            imgData = conv.bytes;
            finalExt = 'png'; finalMime = 'image/png';
            // EMU 크기가 없으면 canvas 크기 사용
            if (!widthHwp || !heightHwp) {
                const sz = imageSizeHwp({ width: conv.width, height: conv.height });
                widthHwp = sz.widthHwp; heightHwp = sz.heightHwp;
            }
        } catch (_) { return altText ? { type: 'para', text: `[이미지: ${altText}]` } : null; }
    }

    return {
        type:      'image',
        binName:   `image${counter}.${finalExt}`,
        mimeType:  finalMime,
        data:      imgData,
        widthHwp,
        heightHwp,
        alt:       altText,
    };
}

async function parseDocx(arrayBuffer, docType = 'plain') {
    if (typeof JSZip === 'undefined') {
        throw new Error('JSZip 미로드: DOCX 처리 불가');
    }

    let zip;
    try {
        zip = await JSZip.loadAsync(arrayBuffer);
    } catch (e) {
        throw new Error('DOCX ZIP 열기 실패: ' + e.message);
    }

    // [보안] Zip Bomb 방지: 압축 해제 예상 크기 합산
    let totalUncompressed = 0;
    zip.forEach((_, entry) => {
        totalUncompressed += entry._data ? (entry._data.uncompressedSize || 0) : 0;
    });
    if (totalUncompressed > 50 * 1024 * 1024) {
        throw new Error('DOCX 압축 해제 크기 초과 (50MB): 처리 거부');
    }

    // word/document.xml이 DOCX의 본문 파일
    const docFile = zip.file('word/document.xml');
    if (!docFile) {
        throw new Error('word/document.xml 없음: 유효한 DOCX 파일이 아닙니다.');
    }

    const xmlText = await docFile.async('string');
    const xmlDoc = new DOMParser().parseFromString(xmlText, 'application/xml');
    // 제목은 본문에서 추출(아래 첫 제목 승격). 못 찾으면 빈 제목으로 둔다("DOCX 문서" 같은 자리표시 방지)
    const ir = emptyIR('', docType);

    // word/_rels/document.xml.rels 로드 → rId → {target, type} 맵
    // 이미지 관계(type ends /image)와 머리글/바닥글 관계(type ends /header, /footer) 모두 수집
    const relsMap = {};
    const relsFile = zip.file('word/_rels/document.xml.rels');
    if (relsFile) {
        try {
            const relsXml = await relsFile.async('string');
            const relsDoc = new DOMParser().parseFromString(relsXml, 'application/xml');
            for (const rel of relsDoc.getElementsByTagName('Relationship')) {
                const id     = rel.getAttribute('Id')     || '';
                const type   = rel.getAttribute('Type')   || '';
                const target = rel.getAttribute('Target') || '';
                if (id) relsMap[id] = { target, type };
            }
        } catch (_) {}
    }

    // word/styles.xml 로드 → 스타일 ID → 이름 맵 (제목 감지 정확도 향상)
    const stylesMap = {};
    const stylesFile = zip.file('word/styles.xml');
    if (stylesFile) {
        try {
            const stylesXml = await stylesFile.async('string');
            const stylesDoc = new DOMParser().parseFromString(stylesXml, 'application/xml');
            for (const style of stylesDoc.getElementsByTagNameNS(DOCX_NS, 'style')) {
                const sid = style.getAttributeNS(DOCX_NS, 'styleId')
                         || style.getAttribute('w:styleId')
                         || style.getAttribute('styleId') || '';
                const nameEl = style.getElementsByTagNameNS(DOCX_NS, 'name')[0];
                if (sid && nameEl) {
                    const sval = nameEl.getAttributeNS(DOCX_NS, 'val')
                              || nameEl.getAttribute('w:val')
                              || nameEl.getAttribute('val') || '';
                    if (sval) stylesMap[sid] = sval;
                }
            }
        } catch (_) {}
    }

    // word/numbering.xml 로드 → numId·abstractNumId → 레벨별 순서/글머리 정보
    const numberingInfo = await parseDocxNumbering(zip);

    // word/footnotes.xml 로드 → 각주 ID → 텍스트 맵
    const footnotesMap = {};
    const fnFile = zip.file('word/footnotes.xml');
    if (fnFile) {
        try {
            const fnXml = await fnFile.async('string');
            const fnDoc = new DOMParser().parseFromString(fnXml, 'application/xml');
            for (const fn of fnDoc.getElementsByTagNameNS(DOCX_NS, 'footnote')) {
                const fnId = fn.getAttributeNS(DOCX_NS, 'id') || fn.getAttribute('w:id') || '';
                // id -1과 0은 특수 구분자 — 건너뜀
                if (fnId === '-1' || fnId === '0') continue;
                const tEls = fn.getElementsByTagNameNS(DOCX_NS, 't');
                const fnText = sanitize(Array.from(tEls).map(t => t.textContent).join('').trim());
                if (fnId && fnText) footnotesMap[fnId] = fnText;
            }
        } catch (_) {}
    }

    // 머리글/바닥글 텍스트 추출 헬퍼
    const extractFileText = async (relTarget) => {
        const f = zip.file('word/' + relTarget);
        if (!f) return '';
        try {
            const xml = await f.async('string');
            const doc = new DOMParser().parseFromString(xml, 'application/xml');
            const tEls = doc.getElementsByTagNameNS(DOCX_NS, 't');
            return sanitize(Array.from(tEls).map(t => t.textContent).join(' ').trim());
        } catch (_) { return ''; }
    };

    // relsMap에서 머리글/바닥글 파일 찾기 (첫 번째만 사용)
    const headerTargets = [], footerTargets = [];
    for (const rel of Object.values(relsMap)) {
        if (rel.type.endsWith('/header')) headerTargets.push(rel.target);
        if (rel.type.endsWith('/footer')) footerTargets.push(rel.target);
    }
    if (headerTargets.length) {
        const text = await extractFileText(headerTargets[0]);
        if (text) ir.header = text;
    }
    if (footerTargets.length) {
        const text = await extractFileText(footerTargets[0]);
        if (text) ir.footer = text;
    }

    // w:body 직계 자식 순회 (단락: w:p, 표: w:tbl)
    const body = xmlDoc.getElementsByTagNameNS(DOCX_NS, 'body')[0];
    if (!body) return ir;

    let imageCounter = 1;
    for (const node of body.childNodes) {
        const localName = node.localName || '';

        if (localName === 'p') {
            // w:drawing이 있는 단락은 이미지 처리 시도 (localName으로 탐색, NS prefix 무관)
            const hasDrawing = Array.from(node.getElementsByTagName('*'))
                .some(el => el.localName === 'drawing');
            if (hasDrawing) {
                const imgOrFallback = await extractDocxImage(node, relsMap, zip, imageCounter);
                if (imgOrFallback) {
                    if (imgOrFallback.type === 'image') {
                        // 이미지가 든 단락의 정렬(가운데/오른쪽/왼쪽)을 이미지 블록에 보존한다.
                        const imgAlign = docxParagraphAlign(node);
                        if (imgAlign === 'center' || imgAlign === 'right' || imgAlign === 'left') {
                            imgOrFallback.align = imgAlign;
                        }
                        ir.blocks.push(imgOrFallback);
                        imageCounter++;
                    } else {
                        // WMF/EMF alt-text fallback 또는 기타 비이미지 블록
                        ir.blocks.push(imgOrFallback);
                    }
                    continue;
                }
            }
            const block = extractDocxParagraph(node, stylesMap, footnotesMap, relsMap, numberingInfo);
            if (block) ir.blocks.push(block);
        } else if (localName === 'tbl') {
            const block = extractDocxTable(node);
            if (block) ir.blocks.push(block);
        }
    }

    // 연속된 _list_item 블록 → list 블록으로 묶기
    ir.blocks = groupDocxListItems(ir.blocks);

    // Word '제목(Title)' 스타일 단락만 문서 제목으로 승격하고 본문에서 제거.
    // (섹션 제목인 '제목 1'/Heading 1 등은 본문에 그대로 둔다 — 잘못된 제목 방지)
    const titleIdx = ir.blocks.findIndex(b => b.type === 'heading' && b.docTitle);
    if (titleIdx !== -1) {
        ir.title = ir.blocks[titleIdx].text;
        ir.blocks.splice(titleIdx, 1);
    }
    // docTitle 표시는 IR 밖으로 내보내지 않음 (렌더에 불필요)
    for (const b of ir.blocks) if (b && b.docTitle) delete b.docTitle;

    return ir;
}

/** w:p 단락의 정렬(w:pPr/w:jc) → 'center'|'right'|'left'|'justify'|null */
function docxParagraphAlign(pNode) {
    const pPrEl = pNode.getElementsByTagNameNS(DOCX_NS, 'pPr')[0];
    if (!pPrEl) return null;
    const jcEl = pPrEl.getElementsByTagNameNS(DOCX_NS, 'jc')[0];
    if (!jcEl) return null;
    const v = jcEl.getAttributeNS(DOCX_NS, 'val')
           || jcEl.getAttribute('w:val')
           || jcEl.getAttribute('val') || '';
    if (v === 'center') return 'center';
    if (v === 'right')  return 'right';
    if (v === 'left')   return 'left';
    if (v === 'both' || v === 'distribute') return 'justify';
    return null;
}

/** w:r 안의 토글 속성(w:u/w:strike 등) on/off 판정 — val=0/false/none/off면 off */
function docxRunToggle(r, name) {
    const el = r.getElementsByTagNameNS(DOCX_NS, name)[0];
    if (!el) return false;
    const v = el.getAttributeNS(DOCX_NS, 'val') || el.getAttribute('w:val') || el.getAttribute('val');
    if (v == null || v === '') return true;   // 속성만 있고 val 없으면 on
    return !/^(0|false|none|off)$/i.test(v);
}

/** w:r 안의 글자색(w:color@val) → #RRGGBB | null (auto/지정없음 제외) */
function docxRunColor(r) {
    const el = r.getElementsByTagNameNS(DOCX_NS, 'color')[0];
    if (!el) return null;
    const v = el.getAttributeNS(DOCX_NS, 'val') || el.getAttribute('w:val') || el.getAttribute('val') || '';
    if (!v || /^auto$/i.test(v)) return null;
    return normalizeHexColor(v.startsWith('#') ? v : '#' + v);
}

/** w:p 단락 노드 → IR 블록 (텍스트 추출 + 스타일 판별 + 각주 + 목록 + 하이퍼링크) */
function extractDocxParagraph(pNode, stylesMap = {}, footnotesMap = {}, relsMap = {}, numberingInfo = null) {
    const pStyles = pNode.getElementsByTagNameNS(DOCX_NS, 'pStyle');
    let styleId = '';
    if (pStyles.length) {
        styleId = pStyles[0].getAttributeNS(DOCX_NS, 'val') || '';
        if (!styleId) styleId = pStyles[0].getAttribute('w:val') || '';
        if (!styleId) styleId = pStyles[0].getAttribute('val') || '';
    }

    const pPrEl = pNode.getElementsByTagNameNS(DOCX_NS, 'pPr')[0];
    // 단락 정렬 (w:pPr/w:jc)
    const align = docxParagraphAlign(pNode);

    // 번호 매기기(w:numPr) 확인 → _list_item 블록 반환 (groupDocxListItems에서 list로 묶임)
    if (pPrEl && numberingInfo) {
        const numPrEl = pPrEl.getElementsByTagNameNS(DOCX_NS, 'numPr')[0];
        if (numPrEl) {
            const numIdEl = numPrEl.getElementsByTagNameNS(DOCX_NS, 'numId')[0];
            const ilvlEl  = numPrEl.getElementsByTagNameNS(DOCX_NS, 'ilvl')[0];
            const numId = numIdEl
                ? (numIdEl.getAttributeNS(DOCX_NS, 'val') || numIdEl.getAttribute('w:val') || '')
                : '';
            const ilvl = parseInt(ilvlEl
                ? (ilvlEl.getAttributeNS(DOCX_NS, 'val') || ilvlEl.getAttribute('w:val') || '0')
                : '0', 10);
            // numId=0은 번호 매기기 해제 마커 — 일반 단락으로 처리
            if (numId && numId !== '0') {
                const absId   = numberingInfo.numMap[numId];
                const lvlDef  = absId ? numberingInfo.abstractMap[absId]?.lvls?.[ilvl] : null;
                const ordered = lvlDef ? lvlDef.ordered : false;
                const inlineRuns = extractDocxInlineRuns(pNode, relsMap, footnotesMap);
                const text = sanitize(inlineRuns.filter(r => r.text).map(r => r.text).join('').trim());
                if (!text && !inlineRuns.some(r => r.footnote)) return null;
                return { type: '_list_item', text, runs: inlineRuns, level: Math.min(ilvl, 2), ordered };
            }
        }
    }

    // 인라인 런 추출 — w:r, w:hyperlink, 변경 추적 컨테이너를 통합 처리
    const inlineRuns = extractDocxInlineRuns(pNode, relsMap, footnotesMap);
    const text = sanitize(inlineRuns.filter(r => r.text).map(r => r.text).join('').trim());
    // 각주만 있고 텍스트가 없는 경우도 각주 런이 있으면 null 반환 안 함
    const hasFootnotes = inlineRuns.some(r => r.footnote);
    if (!text && !hasFootnotes) return null;

    // 제목 단락의 글자색(첫 색 있는 런) — 제목으로 렌더해도 색을 보존하기 위해 전달
    const headColor = (inlineRuns.find(r => r.text && r.color) || {}).color || null;
    const withColor = (b) => (headColor ? { ...b, color: headColor } : b);

    // styles.xml에서 해석한 스타일 이름 사용 (없으면 styleId 원본으로 폴백)
    const resolvedStyle = stylesMap[styleId] || styleId;
    // 1) 스타일 이름으로 제목 판별 — 한글 "제목 N" / 영문 "Heading N" / "Title"
    if (/heading|제목|title/i.test(resolvedStyle)) {
        const digits = resolvedStyle.replace(/\D/g, '') || styleId.replace(/\D/g, '');
        const level = parseInt(digits || '1', 10) || 1;
        // Word '제목(Title)' 스타일(번호 없음)만 문서 제목으로 표시. '제목 1'(Heading 1)은
        // 섹션 제목이므로 docTitle로 보지 않음 → 본문에 그대로 남는다.
        const block = withColor({ type: 'heading', level: Math.min(level, 6), text });
        if (!digits && (/title/i.test(resolvedStyle) || /^\s*제목\s*$/.test(resolvedStyle) || /title/i.test(styleId))) {
            block.docTitle = true;
        }
        return block;
    }
    // 2) 스타일명 매칭 실패 시 w:outlineLvl(0~8)을 보조 신호로 사용 (val+1 = 제목 레벨)
    if (pPrEl) {
        const olEl = pPrEl.getElementsByTagNameNS(DOCX_NS, 'outlineLvl')[0];
        if (olEl) {
            const ov = olEl.getAttributeNS(DOCX_NS, 'val') || olEl.getAttribute('w:val') || olEl.getAttribute('val');
            const lvl = parseInt(ov, 10);
            if (Number.isFinite(lvl) && lvl >= 0 && lvl <= 8) {
                return withColor({ type: 'heading', level: Math.min(lvl + 1, 6), text });
            }
        }
    }

    // bold 런(w:b)이 단락 전체를 덮고 있으면 소제목으로 처리 (텍스트 런만 확인).
    // 단, 글자색/밑줄/취소선이 있으면 그 서식을 보존해야 하므로 heading으로 바꾸지 않고
    // 색 있는 단락(runs)으로 둔다(소제목 변환 시 색이 사라지던 문제 방지).
    const textRuns = inlineRuns.filter(r => r.text);
    const allBold = textRuns.length > 0 && textRuns.every(r => r.bold);
    const hasExtFmt = textRuns.some(r => r.color || r.underline || r.strike);
    if (allBold && !hasExtFmt) {
        return { type: 'heading', level: 3, text };
    }

    const base = inlineRuns.length ? { type: 'para', runs: inlineRuns } : { type: 'para', text };
    return align ? { ...base, align } : base;
}

/** 요소의 직계 자식 중 해당 localName 만 반환 (네임스페이스 prefix 무관) */
function docxDirectChildren(el, localName) {
    const out = [];
    for (const c of el.childNodes) {
        if (c.nodeType === 1 && c.localName === localName) out.push(c);
    }
    return out;
}

/** 셀(w:tc) 텍스트 추출 — 중첩 표 내용은 평탄화해 보존하되 단락 경계는 공백으로 구분 */
function docxCellText(tc) {
    const parts = [];
    for (const p of tc.getElementsByTagNameNS(DOCX_NS, 'p')) {
        const t = Array.from(p.getElementsByTagNameNS(DOCX_NS, 't'))
            .map(el => el.textContent || '').join('');
        if (t) parts.push(t);
    }
    return sanitize(parts.join(' ').trim());
}

/** 셀(w:tc) 글자색 — 셀 안 첫 번째 유효 w:color(run) → #RRGGBB | null (흰 글자 등 보존) */
function docxCellColor(tc) {
    for (const r of tc.getElementsByTagNameNS(DOCX_NS, 'r')) {
        const c = docxRunColor(r);
        if (c) return c;
    }
    return null;
}

/** w:tbl 표 노드 → IR table 블록 (셀 병합 지원, 중첩 표 무시) */
function extractDocxTable(tblNode) {
    // 직계 자식 행/셀만 사용 — 중첩 표의 w:tr/w:tc가 그리드에 섞여 들어가
    // rowCnt/colCnt 불일치(한글이 거부하는 깨진 표)가 생기는 것을 방지
    const rowEls = docxDirectChildren(tblNode, 'tr');
    if (!rowEls.length) return null;

    // 1단계: 물리 행/열 원시 데이터 수집
    const rawRows = [];
    for (const tr of rowEls) {
        const rawCells = [];
        const cells = docxDirectChildren(tr, 'tc');
        for (const tc of cells) {
            const text = docxCellText(tc);
            const color = docxCellColor(tc);

            const tcPr = docxDirectChildren(tc, 'tcPr')[0];
            let bg = null, colSpan = 1, vMergeType = null;

            if (tcPr) {
                // 배경색 (w:tcPr/w:shd@w:fill)
                const shd = tcPr.getElementsByTagNameNS(DOCX_NS, 'shd')[0];
                if (shd) {
                    const fill = shd.getAttributeNS(DOCX_NS, 'fill')
                              || shd.getAttribute('w:fill')
                              || shd.getAttribute('fill') || '';
                    if (fill && !/^(auto|FFFFFF|ffffff|000000)$/.test(fill)) {
                        bg = fill.replace(/^#/, '').toUpperCase().padStart(6, '0');
                    }
                }
                // 가로 병합 (w:gridSpan)
                const gs = tcPr.getElementsByTagNameNS(DOCX_NS, 'gridSpan')[0];
                if (gs) {
                    colSpan = parseInt(gs.getAttributeNS(DOCX_NS, 'val') || gs.getAttribute('w:val') || '1', 10) || 1;
                }
                // 세로 병합 (w:vMerge)
                const vm = tcPr.getElementsByTagNameNS(DOCX_NS, 'vMerge')[0];
                if (vm) {
                    const vmVal = vm.getAttributeNS(DOCX_NS, 'val') || vm.getAttribute('w:val') || '';
                    vMergeType = (vmVal === 'restart') ? 'restart' : 'continue';
                }
            }
            rawCells.push({ text, bg, color, colSpan, vMergeType });
        }
        rawRows.push(rawCells);
    }

    // 2단계: 논리 그리드 구성 — 세로 병합 연속 셀 처리
    // vMergeStart[논리열] = 병합 시작 행 인덱스 (진행 중인 병합 추적)
    // mergeStartCells["행_열"] = 병합 시작 셀 객체 (rowSpan을 나중에 증가시킴)
    const vMergeStart = {};
    const mergeStartCells = {};
    const outputRows = [];

    for (let r = 0; r < rawRows.length; r++) {
        const outRow = [];
        let logicalCol = 0;

        for (const raw of rawRows[r]) {
            // 위 행에서 내려오는 세로 병합이 점유 중인 논리 열 건너뜀
            while (vMergeStart[logicalCol] !== undefined) logicalCol++;

            if (raw.vMergeType === 'continue') {
                // 세로 병합 연속 셀 → 병합 시작 셀의 rowSpan 증가 후 스킵
                const startKey = `${vMergeStart[logicalCol]}_${logicalCol}`;
                if (mergeStartCells[startKey]) mergeStartCells[startKey].rowSpan++;
                // 이 열은 다음 행에도 병합이 계속될 수 있으므로 vMergeStart 유지
            } else {
                // 일반 셀 또는 병합 시작 셀
                const cell = { text: raw.text, colSpan: raw.colSpan, rowSpan: 1 };
                if (raw.bg) cell.bg = raw.bg;
                if (raw.color) cell.color = raw.color;

                if (raw.vMergeType === 'restart') {
                    vMergeStart[logicalCol] = r;
                    mergeStartCells[`${r}_${logicalCol}`] = cell;
                } else {
                    // 일반 셀: 이 열의 세로 병합 추적 제거
                    delete vMergeStart[logicalCol];
                }
                outRow.push(cell);
            }

            logicalCol += raw.colSpan;
        }

        // 현재 행에서 vMerge continue가 없는 논리 열의 병합 추적 정리
        // (다음 행에서 해당 열에 일반 셀이 오면 자동으로 delete됨)
        outputRows.push(outRow);
    }

    // 3단계: 세로 병합 연속 셀을 rowSpan=0 sentinel로 삽입
    // outputRows의 각 행에 건너뛴 셀(세로 병합 연속) 위치에 sentinel 추가
    // 현재 구현에서는 연속 셀을 행에서 제외하므로 rowSpan=0은 별도 처리 없이
    // hwpx.js에서 outRow 그대로 사용 (연속 셀은 이미 제외됨)

    return { type: 'table', header: outputRows[0] || [], rows: outputRows.slice(1) };
}


// ─────────────────────────────────────────────────────────────────────────
// [8] PPTX 파서 (PowerPoint)
//     방법: JSZip으로 열고 ppt/presentation.xml의 슬라이드 순서(p:sldIdLst) +
//           ppt/_rels/presentation.xml.rels로 실제 슬라이드 파일 경로를 확정.
//           실패 시 ppt/slides/slideN.xml 파일명 숫자 정렬로 폴백.
//           슬라이드 안 p:spTree를 도형 순서대로 순회해 텍스트(p:sp)·표
//           (p:graphicFrame의 a:tbl)·이미지(p:pic)를 각각 IR로 변환한다.
//     한계: 레이아웃·애니메이션·도형(표/그림 제외)·발표자 노트는 다루지 않는다.
// ─────────────────────────────────────────────────────────────────────────

/** 셀(a:tc) 텍스트 추출 — a:txBody 안의 a:p/a:r/a:t를 공백으로 이어붙임 */
function pptxCellText(tc) {
    const txBody = tc.getElementsByTagName('a:txBody')[0];
    if (!txBody) return '';
    const parts = Array.from(txBody.getElementsByTagName('a:p'))
        .map(p => Array.from(p.getElementsByTagName('a:t')).map(t => t.textContent || '').join(''))
        .filter(Boolean);
    return sanitize(parts.join(' ').trim());
}

/**
 * a:tbl(DrawingML 표) → IR table 블록.
 * PPTX 표는 병합된 칸도 각 열마다 별도 a:tc(hMerge="1"/vMerge="1")로 나오므로
 * DOCX(gridSpan 압축형)와 달리 매 a:tc가 논리 열 하나에 대응한다.
 */
function extractPptxTable(tblNode) {
    const rowEls = Array.from(tblNode.getElementsByTagName('a:tr'));
    if (!rowEls.length) return null;

    const rawRows = rowEls.map(tr => Array.from(tr.getElementsByTagName('a:tc')).map(tc => ({
        text: pptxCellText(tc),
        colSpan: parseInt(tc.getAttribute('gridSpan') || '1', 10) || 1,
        hMerge: tc.getAttribute('hMerge') === '1',
        vMerge: tc.getAttribute('vMerge') === '1',
    })));

    const vMergeStart = {};     // logicalCol → 병합 시작 행 인덱스
    const mergeStartCells = {}; // "행_열" → 병합 시작 셀 객체 (rowSpan 증가 대상)
    const outputRows = [];

    for (let r = 0; r < rawRows.length; r++) {
        const outRow = [];
        let logicalCol = 0;
        for (const raw of rawRows[r]) {
            if (raw.hMerge || raw.vMerge) {
                // 가로/세로 병합 연속 칸 — 출력 없음. 세로 병합이면 시작 셀 rowSpan만 증가.
                if (raw.vMerge) {
                    const startKey = `${vMergeStart[logicalCol]}_${logicalCol}`;
                    if (mergeStartCells[startKey]) mergeStartCells[startKey].rowSpan++;
                }
                logicalCol++;
                continue;
            }
            const cell = { text: raw.text, colSpan: raw.colSpan, rowSpan: 1 };
            vMergeStart[logicalCol] = r;
            mergeStartCells[`${r}_${logicalCol}`] = cell;
            outRow.push(cell);
            logicalCol++;
        }
        outputRows.push(outRow);
    }

    if (!outputRows.some(row => row.length)) return null;
    return { type: 'table', header: outputRows[0] || [], rows: outputRows.slice(1) };
}

/**
 * 슬라이드 상대 경로 rels Target을 zip 절대 경로로 정규화.
 * 예) baseDir="ppt/slides", target="../media/image1.png" → "ppt/media/image1.png"
 */
function resolvePptxRelPath(baseDir, target) {
    if (!target || /^https?:/i.test(target)) return null;
    const stack = [];
    for (const part of (baseDir + '/' + target).split('/')) {
        if (part === '' || part === '.') continue;
        if (part === '..') stack.pop();
        else stack.push(part);
    }
    return stack.join('/');
}

/**
 * p:pic(그림 도형) → IR image 블록. r:embed로 슬라이드 rels에서 실제 media 경로를 찾는다.
 * @param {Element} picNode
 * @param {object}  relsMap   슬라이드 rels의 rId → Target 맵
 * @param {JSZip}   zip
 * @param {string}  slideDir  슬라이드 파일이 위치한 디렉터리(예: "ppt/slides")
 * @param {{n:number}} counterRef  문서 전체에서 공유하는 이미지 카운터(참조로 증가)
 */
async function extractPptxImage(picNode, relsMap, zip, slideDir, counterRef) {
    const blipEl = picNode.getElementsByTagName('a:blip')[0];
    if (!blipEl) return null;
    const rId = blipEl.getAttributeNS(DOCX_NS_R, 'embed') || blipEl.getAttribute('r:embed') || '';
    const target = rId && relsMap[rId];
    if (!target) return null;

    const resolved = resolvePptxRelPath(slideDir, target);
    if (!resolved) return null;
    const ext = resolved.split('.').pop().toLowerCase();

    const cNvPr = picNode.getElementsByTagName('p:cNvPr')[0];
    const altText = cNvPr
        ? sanitize(cNvPr.getAttribute('descr') || cNvPr.getAttribute('title') || cNvPr.getAttribute('name') || '').trim()
        : '';

    // WMF/EMF 벡터 이미지 — HWPX 삽입 미지원. alt 텍스트가 있으면 안내 문단으로 대체.
    if (ext === 'wmf' || ext === 'emf') {
        return altText ? { type: 'para', text: `[벡터 이미지: ${altText}]` } : null;
    }

    const mimeTypes = {
        jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
        gif: 'image/gif',  bmp: 'image/bmp',   tiff: 'image/tiff',
        webp: 'image/webp',
    };
    const mimeType = mimeTypes[ext];
    if (!mimeType) return null;

    const imgFile = zip.file(resolved);
    if (!imgFile) return null;
    let imgData;
    try {
        imgData = await imgFile.async('uint8array');
    } catch (_) { return null; }

    // EMU → HWPX 단위: 1 inch = 914400 EMU = 7200 HWP units → divide EMU by 127
    const extEl = picNode.getElementsByTagName('a:ext')[0];
    const cx = extEl ? parseInt(extEl.getAttribute('cx') || '0', 10) : 0;
    const cy = extEl ? parseInt(extEl.getAttribute('cy') || '0', 10) : 0;
    let widthHwp  = Math.round(cx / 127);
    let heightHwp = Math.round(cy / 127);

    // WebP → PNG 변환 (HWPX는 PNG/JPEG/GIF/BMP만 지원)
    let finalExt = ext, finalMime = mimeType;
    if (ext === 'webp') {
        try {
            const conv = await convertWebpToPng(imgData);
            imgData = conv.bytes;
            finalExt = 'png'; finalMime = 'image/png';
            if (!widthHwp || !heightHwp) {
                const sz = imageSizeHwp({ width: conv.width, height: conv.height });
                widthHwp = sz.widthHwp; heightHwp = sz.heightHwp;
            }
        } catch (_) { return altText ? { type: 'para', text: `[이미지: ${altText}]` } : null; }
    }
    // 슬라이드 도형 크기(a:ext)가 없거나 0이면 픽셀 크기로 보정
    if (!widthHwp || !heightHwp) {
        try {
            const meta = sniffRasterImage(imgData, finalMime);
            const sz = imageSizeHwp(meta);
            widthHwp = sz.widthHwp; heightHwp = sz.heightHwp;
        } catch (_) {}
    }

    counterRef.n = (counterRef.n || 0) + 1;
    return {
        type: 'image',
        binName: `pptx-img${counterRef.n}.${finalExt}`,
        mimeType: finalMime,
        data: imgData,
        widthHwp: widthHwp || 40000,
        heightHwp: heightHwp || 30000,
        alt: altText,
        sourceFormat: 'pptx',
    };
}

/**
 * 슬라이드 XML(ppt/slides/slideN.xml)을 p:spTree 자식 순서대로 순회해
 * 텍스트(kind: title/para/listItem)·표(kind: table)·이미지(kind: image) 항목을 만든다.
 * @returns {Promise<Array<object>>}
 */
async function parsePptxSlideItems(xmlText, zip, slidePath, imageCounterRef) {
    const doc = new DOMParser().parseFromString(xmlText, 'application/xml');
    if (doc.querySelector('parsererror')) return [];
    const spTree = doc.getElementsByTagName('p:spTree')[0];
    if (!spTree) return [];

    // 슬라이드별 관계 파일 — p:pic의 r:embed를 실제 media 경로로 바꾸는 데 필요
    const slideDir = slidePath.replace(/\/[^/]+$/, '');
    const relsMap = {};
    const relsFile = zip.file(`${slideDir}/_rels/${slidePath.split('/').pop()}.rels`);
    if (relsFile) {
        try {
            const relsXml = await relsFile.async('string');
            const relsDoc = new DOMParser().parseFromString(relsXml, 'application/xml');
            for (const rel of relsDoc.getElementsByTagName('Relationship')) {
                const id = rel.getAttribute('Id') || '';
                if (id) relsMap[id] = rel.getAttribute('Target') || '';
            }
        } catch (_) {}
    }

    const items = [];
    await collectPptxSpTreeItems(spTree, zip, relsMap, slideDir, imageCounterRef, items);
    return items;
}

/**
 * p:spTree(또는 그 안의 p:grpSp) 직계 자식을 순회해 items에 push한다.
 * p:grpSp(그룹 도형)는 여러 도형을 하나로 묶은 컨테이너라 자식 도형이 spTree의
 * 직계가 아니게 되므로, 그룹을 만나면 재귀로 내부까지 펼쳐서 콘텐츠 누락을 막는다.
 */
async function collectPptxSpTreeItems(container, zip, relsMap, slideDir, imageCounterRef, items) {
    for (const child of Array.from(container.childNodes)) {
        if (child.nodeType !== 1) continue;
        const local = child.localName;

        if (local === 'sp') {
            const nvPr = child.getElementsByTagName('p:nvSpPr')[0];
            const ph = nvPr ? nvPr.getElementsByTagName('p:ph')[0] : null;
            const phType = ph ? (ph.getAttribute('type') || '') : '';
            const isTitle = phType === 'title' || phType === 'ctrTitle';
            const txBody = child.getElementsByTagName('p:txBody')[0];
            if (!txBody) continue;
            for (const p of Array.from(txBody.getElementsByTagName('a:p'))) {
                const text = sanitize(Array.from(p.getElementsByTagName('a:t')).map(t => t.textContent).join(''));
                if (!text.trim()) continue;
                const pPr = p.getElementsByTagName('a:pPr')[0];
                const lvl = pPr ? parseInt(pPr.getAttribute('lvl') || '0', 10) || 0 : 0;
                const hasBuNone = !!(pPr && pPr.getElementsByTagName('a:buNone')[0]);
                const hasBuAutoNum = !!(pPr && pPr.getElementsByTagName('a:buAutoNum')[0]);
                const hasBuChar = !!(pPr && pPr.getElementsByTagName('a:buChar')[0]);
                const bullet = !isTitle && !hasBuNone && (hasBuAutoNum || hasBuChar);
                if (isTitle) items.push({ kind: 'title', text });
                else if (bullet) items.push({ kind: 'listItem', text, level: Math.max(0, Math.min(lvl, 2)), ordered: hasBuAutoNum });
                else items.push({ kind: 'para', text });
            }
        } else if (local === 'graphicFrame') {
            const tbl = child.getElementsByTagName('a:tbl')[0];
            if (tbl) {
                const table = extractPptxTable(tbl);
                if (table) items.push({ kind: 'table', table });
            }
        } else if (local === 'pic') {
            const result = await extractPptxImage(child, relsMap, zip, slideDir, imageCounterRef);
            if (result?.type === 'image') items.push({ kind: 'image', image: result });
            else if (result?.type === 'para') items.push({ kind: 'para', text: result.text });
        } else if (local === 'grpSp') {
            await collectPptxSpTreeItems(child, zip, relsMap, slideDir, imageCounterRef, items);
        }
    }
}

async function parsePptx(arrayBuffer, docType = 'plain') {
    if (typeof JSZip === 'undefined') {
        throw new Error('JSZip 미로드: PPTX 처리 불가');
    }

    let zip;
    try {
        zip = await JSZip.loadAsync(arrayBuffer);
    } catch (e) {
        throw new Error('PPTX ZIP 열기 실패: ' + e.message);
    }

    // [보안] Zip Bomb 방지: 압축 해제 예상 크기 합산 (DOCX와 동일 기준)
    let totalUncompressed = 0;
    zip.forEach((_, entry) => {
        totalUncompressed += entry._data ? (entry._data.uncompressedSize || 0) : 0;
    });
    if (totalUncompressed > 50 * 1024 * 1024) {
        throw new Error('PPTX 압축 해제 크기 초과 (50MB): 처리 거부');
    }

    const presFile = zip.file('ppt/presentation.xml');
    if (!presFile) {
        throw new Error('ppt/presentation.xml 없음: 유효한 PPTX 파일이 아닙니다.');
    }

    // 슬라이드 순서: p:sldIdLst의 r:id → presentation.xml.rels → 실제 슬라이드 경로
    let slidePaths = [];
    try {
        const presXml = await presFile.async('string');
        const presDoc = new DOMParser().parseFromString(presXml, 'application/xml');
        const relsMap = {};
        const relsFile = zip.file('ppt/_rels/presentation.xml.rels');
        if (relsFile) {
            const relsXml = await relsFile.async('string');
            const relsDoc = new DOMParser().parseFromString(relsXml, 'application/xml');
            for (const rel of relsDoc.getElementsByTagName('Relationship')) {
                const id = rel.getAttribute('Id') || '';
                if (id) relsMap[id] = rel.getAttribute('Target') || '';
            }
        }
        for (const sldId of Array.from(presDoc.getElementsByTagName('p:sldId'))) {
            const rid = sldId.getAttributeNS(DOCX_NS_R, 'id') || sldId.getAttribute('r:id') || '';
            const target = rid && relsMap[rid];
            if (target) slidePaths.push('ppt/' + target.replace(/^\.?\/?/, ''));
        }
    } catch (_) {}

    // presentation.xml에서 순서를 못 얻으면 파일명 숫자 정렬로 폴백
    if (!slidePaths.length) {
        slidePaths = Object.keys(zip.files)
            .filter(name => /^ppt\/slides\/slide\d+\.xml$/.test(name))
            .sort((a, b) => {
                const na = parseInt((/slide(\d+)\.xml$/.exec(a) || [])[1] || '0', 10);
                const nb = parseInt((/slide(\d+)\.xml$/.exec(b) || [])[1] || '0', 10);
                return na - nb;
            });
    }
    if (!slidePaths.length) {
        throw new Error('슬라이드를 찾을 수 없습니다: 유효한 PPTX 파일이 아닙니다.');
    }

    const ir = emptyIR('', docType);
    const imageCounterRef = { n: 0 };
    let slideNum = 0;
    for (const path of slidePaths) {
        slideNum++;
        const slideFile = zip.file(path);
        if (!slideFile) continue;
        let xmlText;
        try {
            xmlText = await slideFile.async('string');
        } catch (_) { continue; }
        const items = await parsePptxSlideItems(xmlText, zip, path, imageCounterRef);
        if (!items.length) continue;

        ir.blocks.push({ type: 'heading', level: 2, text: `슬라이드 ${slideNum}` });
        let listBuf = [];
        const flushList = () => {
            if (listBuf.length) {
                ir.blocks.push({ type: 'list', items: listBuf });
                listBuf = [];
            }
        };
        for (const item of items) {
            if (item.kind === 'title') {
                flushList();
                ir.blocks.push({ type: 'heading', level: 3, text: item.text });
            } else if (item.kind === 'listItem') {
                listBuf.push({
                    text: item.text,
                    runs: [{ text: item.text }],
                    level: item.level,
                    ordered: item.ordered,
                    marker: null,
                    task: false, checked: false, codeBlocks: [],
                });
            } else if (item.kind === 'table') {
                flushList();
                ir.blocks.push(item.table);
            } else if (item.kind === 'image') {
                flushList();
                ir.blocks.push(item.image);
            } else {
                flushList();
                ir.blocks.push({ type: 'para', text: item.text });
            }
        }
        flushList();
    }

    return ir;
}

// ─────────────────────────────────────────────────────────────────────────
// [7] HWP 파서
//     HWP 포맷에는 두 가지 종류가 있음:
//       HWP5 : 바이너리 OLE2 컴파운드 도큐먼트 (D0 CF 11 E0 마법 바이트)
//       HWPX : ZIP + XML 기반 (HWP 포맷의 새로운 버전, PK 헤더)
//     HWPX(ZIP) 형식이면 text XML에서 텍스트 추출 시도
//     HWP5 바이너리는 클라이언트에서 완전 파싱 불가 → 안내 메시지 반환
// ─────────────────────────────────────────────────────────────────────────

/**
 * HWPX <hp:tbl> 요소 → IR table 블록 변환
 * <hp:tr> → <hp:tc> → <hp:subList> → <hp:p> → <hp:t> 구조 탐색
 */
function extractHwpxTable(tblEl, NS_HP) {
    const trEls = tblEl.getElementsByTagNameNS(NS_HP, 'tr');
    if (!trEls.length) return null;

    const rows = Array.from(trEls).map(tr => {
        const tcEls = tr.getElementsByTagNameNS(NS_HP, 'tc');
        return Array.from(tcEls).map(tc => {
            const tEls = tc.getElementsByTagNameNS(NS_HP, 't');
            return sanitize(Array.from(tEls).map(e => e.textContent).join('').trim());
        });
    });

    if (!rows.length) return null;
    // 첫 행 셀에 header="1" 속성이 있으면 헤더 행으로 분리
    const firstTr = trEls[0];
    const firstTc = firstTr.getElementsByTagNameNS(NS_HP, 'tc')[0];
    const isHeader = firstTc && (firstTc.getAttribute('header') === '1');
    if (isHeader && rows.length > 1) {
        return { type: 'table', header: rows[0], rows: rows.slice(1) };
    }
    return { type: 'table', header: null, rows };
}

/**
 * ArrayBuffer의 첫 바이트들을 비교해 파일 시그니처(매직 바이트) 확인
 * OLE2 컴파운드 도큐먼트(HWP5): D0 CF 11 E0 A1 B1 1A E1
 * ZIP 기반(HWPX/HWP 신형):      50 4B 03 04 (PK header)
 */
function detectHwpFormat(buffer) {
    const bytes = new Uint8Array(buffer, 0, 8);
    // OLE2 마법 바이트 (HWP5 바이너리)
    if (bytes[0] === 0xD0 && bytes[1] === 0xCF && bytes[2] === 0x11 && bytes[3] === 0xE0) {
        return 'ole2';
    }
    // ZIP PK 헤더 (HWPX 또는 구버전 HWP의 ZIP 래퍼)
    if (bytes[0] === 0x50 && bytes[1] === 0x4B) {
        return 'zip';
    }
    return 'unknown';
}

// @rhwp/core — Rust+WASM HWP5/HWPX 파서(MIT). 버전 고정 CDN URL(정밀 미리보기 iframe과
// 같은 0.7.17). HWP5 입력 처리에만 필요하므로 정적 import 대신 parseHwp5WithRhwp()에서만
// 동적 import한다(초기 로드에 5MB+ WASM을 얹지 않기 위함).
const RHWP_CORE_URL = 'https://cdn.jsdelivr.net/npm/@rhwp/core@0.7.17/rhwp.js';

/**
 * HWP5(OLE2) 바이너리에서 본문 텍스트를 문단 단위로 추출.
 *   @rhwp/core의 HwpDocument는 원본 레코드를 직접 읽으므로 표/이미지/서식 등
 *   구조 정보까지는 다루지 않고 텍스트만 사용한다(TXT 포맷과 동일한 보존 수준).
 */
async function parseHwp5WithRhwp(buffer, ir) {
    // CFBF(OLE2) 헤더 섹터는 항상 512바이트 — 이보다 작으면 유효한 구조가 될 수 없으므로
    // WASM 엔진을 내려받기 전에 즉시 거부한다(손상 파일에서 불필요한 네트워크 요청 방지).
    if (buffer.byteLength < 512) {
        throw new Error('HWP5 바이너리 구조가 아닙니다(파일이 손상되었을 수 있습니다). 한컴오피스에서 HWPX로 다시 저장해 주세요.');
    }
    let HwpDocument;
    try {
        const rhwp = await import(/* webpackIgnore: true */ RHWP_CORE_URL);
        await rhwp.default();
        HwpDocument = rhwp.HwpDocument;
    } catch (err) {
        throw new Error('HWP5 읽기 엔진을 불러오지 못했습니다(네트워크 확인 후 다시 시도하거나, 한컴오피스에서 HWPX로 다시 저장해 주세요).');
    }

    let doc;
    try {
        doc = new HwpDocument(new Uint8Array(buffer));
    } catch (err) {
        throw new Error('HWP5 바이너리를 열지 못했습니다(암호 보호 또는 손상된 파일일 수 있습니다). 한컴오피스에서 HWPX로 다시 저장해 주세요.');
    }

    try {
        const sectionCount = doc.getSectionCount();
        for (let s = 0; s < sectionCount; s++) {
            const paraCount = doc.getParagraphCount(s);
            for (let p = 0; p < paraCount; p++) {
                const len = doc.getParagraphLength(s, p);
                const text = sanitize((len > 0 ? doc.getTextRange(s, p, 0, len) : '').trim());
                if (!text) { ir.blocks.push({ type: 'blank' }); continue; }
                ir.blocks.push({ type: 'para', text });
            }
        }
    } finally {
        doc.free();
    }

    if (!ir.blocks.some(b => b.type !== 'blank')) {
        throw new Error('HWP5 문서에서 추출할 본문 텍스트를 찾지 못했습니다.');
    }
    return ir;
}

/**
 * HWP/HWPX 파서
 *   ZIP 형식이면 JSZip으로 열어 XML 섹션에서 텍스트 추출 시도
 *   OLE2(HWP5)이면 @rhwp/core(WASM)로 본문 텍스트 추출
 */
async function parseHwp(buffer, docType = 'plain') {
    const ir = emptyIR('HWP 문서', docType);
    const fmt = detectHwpFormat(buffer);

    if (fmt === 'ole2') {
        return await parseHwp5WithRhwp(buffer, ir);
    }

    if (fmt === 'zip') {
        // ZIP 기반 HWP/HWPX — 내부 XML에서 텍스트 추출 시도
        if (typeof JSZip === 'undefined') {
            throw new Error('JSZip 라이브러리가 로드되지 않아 HWP/HWPX 파싱 불가');
        }
        try {
            const zip = await JSZip.loadAsync(buffer);

            let totalUncompressed = 0;
            zip.forEach((_, entry) => {
                totalUncompressed += entry._data ? (entry._data.uncompressedSize || 0) : 0;
            });
            if (totalUncompressed > 50 * 1024 * 1024) {
                throw new Error('압축 해제 크기 초과 (50MB): 처리 거부');
            }

            // HWPX 섹션 파일 패턴 (Contents/section0.xml 등)
            const sectionPatterns = [
                /^Contents\/section\d+\.xml$/i,
                /^BodyText\/Section\d+$/i,
                /^Section\d+\.xml$/i,
            ];

            // HWPX 정식 네임스페이스 (2011 버전 — 2012가 아님)
            const NS_HS = 'http://www.hancom.co.kr/hwpml/2011/section';
            const NS_HP = 'http://www.hancom.co.kr/hwpml/2011/paragraph';

            const entries = Object.keys(zip.files).sort();
            for (const path of entries) {
                if (!sectionPatterns.some(re => re.test(path))) continue;

                const xmlText = await zip.files[path].async('string');
                const xmlDoc  = new DOMParser().parseFromString(xmlText, 'application/xml');
                const secEl   = xmlDoc.getElementsByTagNameNS(NS_HS, 'sec')[0]
                              || xmlDoc.documentElement;

                // 섹션 직계 <hp:p> 순회 (표 안의 셀 단락은 제외)
                for (const child of secEl.childNodes) {
                    const ln = (child.localName || '').toLowerCase();

                    if (ln === 'p') {
                        // 이 단락이 표를 포함하는지 확인
                        const tblEl = child.getElementsByTagNameNS(NS_HP, 'tbl')[0];
                        if (tblEl) {
                            const tblBlock = extractHwpxTable(tblEl, NS_HP);
                            if (tblBlock) ir.blocks.push(tblBlock);
                            continue;
                        }
                        // 일반 텍스트 단락 — <hp:t> 텍스트 합산
                        const tEls = child.getElementsByTagNameNS(NS_HP, 't');
                        const text = sanitize(Array.from(tEls).map(e => e.textContent).join('').trim());
                        if (!text) { ir.blocks.push({ type: 'blank' }); continue; }
                        // paraPrIDRef로 제목 레벨 추정 (우리 스키마: 1=H1, 2=H2, 3=H3, 4=H4)
                        const pprId = parseInt(child.getAttribute('paraPrIDRef') || '0', 10);
                        if (pprId >= 1 && pprId <= 4) {
                            if (!ir.title) {
                                ir.title = text;  // 첫 제목 → 문서 제목
                            } else {
                                ir.blocks.push({ type: 'heading', level: pprId, text });
                            }
                        } else {
                            ir.blocks.push({ type: 'para', text });
                        }

                    } else if (ln === 'secpr') {
                        // 섹션 설정 — 건너뜀
                    }
                }
            }

            // 텍스트가 전혀 없으면 네임스페이스 폴백 (서드파티 HWPX 대응)
            if (!ir.blocks.length && !ir.title) {
                for (const path of entries) {
                    if (!sectionPatterns.some(re => re.test(path))) continue;
                    const xmlText = await zip.files[path].async('string');
                    const xmlDoc  = new DOMParser().parseFromString(xmlText, 'application/xml');
                    const allT    = xmlDoc.querySelectorAll('t');
                    const text    = sanitize(Array.from(allT).map(e => e.textContent).join('\n').trim());
                    if (text) { ir.blocks.push({ type: 'para', text }); break; }
                }
            }

            if (!ir.blocks.length && !ir.title) {
                throw new Error('HWPX에서 변환 가능한 본문 텍스트를 추출하지 못했습니다.');
            }
        } catch (err) {
            throw new Error(`HWP/HWPX 파싱 오류: ${err.message}`);
        }
        return ir;
    }

    // 알 수 없는 형식
    throw new Error('알 수 없는 HWP 파일 구조입니다. HWP 또는 HWPX 파일이 맞는지 확인해 주세요.');
}

function sanitizeIrCell(cell) {
    if (cell && typeof cell === 'object' && !Array.isArray(cell)) {
        return {
            ...cell,
            text: sanitize(cell.text ?? ''),
            runs: Array.isArray(cell.runs)
                ? cell.runs.map(run => ({ ...run, text: sanitize(run?.text ?? '') }))
                : undefined,
        };
    }
    return sanitize(cell ?? '');
}

function sanitizeIrBlock(block) {
    if (!block || typeof block !== 'object') return { type: 'para', text: sanitize(block ?? '') };
    const clean = { ...block };
    if ('text' in clean) clean.text = sanitize(clean.text ?? '');
    if (Array.isArray(clean.runs)) clean.runs = clean.runs.map(run => ({ ...run, text: sanitize(run?.text ?? '') }));
    if (Array.isArray(clean.items)) {
        clean.items = clean.items.map(item => item && typeof item === 'object'
            ? {
                ...item,
                text: sanitize(item.text ?? ''),
                runs: Array.isArray(item.runs)
                    ? item.runs.map(run => ({ ...run, text: sanitize(run?.text ?? '') }))
                    : undefined,
                codeBlocks: (item.codeBlocks || []).map(sanitizeIrBlock),
            }
            : sanitize(item ?? ''));
    }
    if (Array.isArray(clean.header)) clean.header = clean.header.map(sanitizeIrCell);
    if (Array.isArray(clean.rows)) clean.rows = clean.rows.map(row => Array.isArray(row) ? row.map(sanitizeIrCell) : []);
    if (Array.isArray(clean.blocks)) clean.blocks = clean.blocks.map(sanitizeIrBlock);
    return clean;
}

const MARKDOWN_IMAGE_MAX_BYTES = 8 * 1024 * 1024;
const MARKDOWN_IMAGE_TOTAL_MAX_BYTES = 20 * 1024 * 1024;

function decodeBase64Bytes(base64) {
    const binary = atob(base64.replace(/\s+/g, ''));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
}

function decodePercentBytes(value) {
    const source = String(value || '');
    const out = [];
    for (let i = 0; i < source.length; i++) {
        if (source[i] === '%' && /^[0-9A-Fa-f]{2}$/.test(source.slice(i + 1, i + 3))) {
            out.push(parseInt(source.slice(i + 1, i + 3), 16));
            i += 2;
        } else {
            const encoded = new TextEncoder().encode(source[i]);
            out.push(...encoded);
        }
    }
    return new Uint8Array(out);
}

function decodeDataImageUrl(src) {
    const match = /^data:(image\/[a-z0-9.+-]+)(;base64)?,(.*)$/is.exec(String(src || ''));
    if (!match) throw new Error('지원하는 이미지 data URL이 아닙니다.');
    const mimeType = match[1].toLowerCase();
    let bytes;
    try {
        bytes = match[2]
            ? decodeBase64Bytes(match[3])
            : decodePercentBytes(match[3]);
    } catch (_) {
        throw new Error('이미지 data URL을 해석하지 못했습니다.');
    }
    return { bytes, mimeType };
}

function sniffRasterImage(bytes, declaredMime = '') {
    const b = bytes || new Uint8Array();
    if (b.length >= 24 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4E && b[3] === 0x47) {
        const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
        return { ext: 'png', mimeType: 'image/png', width: view.getUint32(16), height: view.getUint32(20) };
    }
    if (b.length >= 10 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) {
        const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
        return { ext: 'gif', mimeType: 'image/gif', width: view.getUint16(6, true), height: view.getUint16(8, true) };
    }
    if (b.length >= 26 && b[0] === 0x42 && b[1] === 0x4D) {
        const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
        return {
            ext: 'bmp', mimeType: 'image/bmp',
            width: Math.abs(view.getInt32(18, true)),
            height: Math.abs(view.getInt32(22, true)),
        };
    }
    if (b.length >= 4 && b[0] === 0xFF && b[1] === 0xD8) {
        let offset = 2;
        while (offset + 9 < b.length) {
            if (b[offset] !== 0xFF) { offset++; continue; }
            const marker = b[offset + 1];
            if (marker === 0xD8 || marker === 0xD9) { offset += 2; continue; }
            const len = (b[offset + 2] << 8) | b[offset + 3];
            if (len < 2 || offset + len + 2 > b.length) break;
            if ([0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF].includes(marker)) {
                return {
                    ext: 'jpg', mimeType: 'image/jpeg',
                    height: (b[offset + 5] << 8) | b[offset + 6],
                    width: (b[offset + 7] << 8) | b[offset + 8],
                };
            }
            offset += len + 2;
        }
    }
    throw new Error(`지원하지 않는 이미지 형식입니다${declaredMime ? ` (${declaredMime})` : ''}.`);
}

function imageSizeHwp(meta) {
    const pxToHwp = 75; // 96dpi 기준: 7200 HWPUNIT / 96px
    const width = Math.max(1, Number(meta.width) || 0);
    const height = Math.max(1, Number(meta.height) || 0);
    let widthHwp = Math.round(width * pxToHwp);
    let heightHwp = Math.round(height * pxToHwp);
    const maxDefaultWidth = 40000;
    if (widthHwp > maxDefaultWidth) {
        heightHwp = Math.round(heightHwp * maxDefaultWidth / widthHwp);
        widthHwp = maxDefaultWidth;
    }
    return { widthHwp, heightHwp };
}

function markdownImageFallback(block, reason) {
    const alt = String(block.alt || '').trim();
    const src = normalizeMarkdownImageSource(block.src);
    const sourceLabel = src.startsWith('data:') ? '삽입 데이터' : src.slice(0, 240);
    const label = alt ? `[이미지: ${alt}]` : '[이미지]';
    const message = `${label} — 불러오지 못했습니다${reason ? ` (${reason})` : ''}`;
    if (/^https?:/i.test(src)) {
        return {
            type: 'para',
            runs: [
                { text: `${message} · ` },
                { text: '원본 이미지 열기', href: src, title: alt || '원본 이미지' },
            ],
        };
    }
    return {
        type: 'para',
        text: `${message}${sourceLabel ? ` · 원본: ${sourceLabel}` : ''}`,
    };
}

function normalizeMarkdownImageSource(raw) {
    let src = String(raw || '').trim();
    const nestedLink = /^\[[^\]]*\]\(\s*(https?:\/\/[\s\S]+)\s*\)$/.exec(src);
    if (nestedLink) src = nestedLink[1].trim();
    const angleUrl = /^<(https?:\/\/[\s\S]+)>$/.exec(src);
    if (angleUrl) src = angleUrl[1].trim();
    return src;
}

async function fetchMarkdownImage(src) {
    const url = new URL(src);
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('허용하지 않는 이미지 주소입니다.');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    try {
        const response = await fetch(url.href, {
            signal: controller.signal,
            credentials: 'omit',
            referrerPolicy: 'no-referrer',
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const contentLength = Number(response.headers.get('content-length') || 0);
        if (contentLength > MARKDOWN_IMAGE_MAX_BYTES) throw new Error('이미지 용량이 8MB를 초과합니다.');
        let bytes;
        if (response.body?.getReader) {
            const reader = response.body.getReader();
            const chunks = [];
            let size = 0;
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                size += value.byteLength;
                if (size > MARKDOWN_IMAGE_MAX_BYTES) {
                    await reader.cancel();
                    throw new Error('이미지 용량이 8MB를 초과합니다.');
                }
                chunks.push(value);
            }
            bytes = new Uint8Array(size);
            let offset = 0;
            for (const chunk of chunks) {
                bytes.set(chunk, offset);
                offset += chunk.byteLength;
            }
        } else {
            bytes = new Uint8Array(await response.arrayBuffer());
        }
        return { bytes, mimeType: response.headers.get('content-type') || '' };
    } catch (error) {
        if (error?.name === 'AbortError') throw new Error('이미지 요청 시간이 초과되었습니다.');
        if (error instanceof TypeError && /failed to fetch/i.test(error.message || '')) {
            throw new Error('이미지 서버의 브라우저 접근 정책(CORS)으로 가져오지 못했습니다.');
        }
        throw error;
    } finally {
        clearTimeout(timer);
    }
}

async function resolveMarkdownAssets(ir, sourceFormat = 'md') {
    let imageCounter = 1;
    let totalBytes = 0;
    let externalFetchCount = 0;  // 외부 서버 접속 건수 — 투명성 안내용
    const warnings = [];

    async function resolveBlocks(blocks) {
        const out = [];
        for (const block of (blocks || [])) {
            if (block?.type === 'quote') {
                out.push({ ...block, blocks: await resolveBlocks(block.blocks || []) });
                continue;
            }
            if (block?.type !== 'image-source') {
                out.push(block);
                continue;
            }
            try {
                const src = normalizeMarkdownImageSource(block.src);
                let loaded;
                if (/^data:/i.test(src)) loaded = decodeDataImageUrl(src);
                else if (/^https?:/i.test(src)) {
                    externalFetchCount++;  // fetch 시도 전 카운트 — 실패해도 서버 접속은 발생
                    loaded = await fetchMarkdownImage(src);
                } else throw new Error('상대경로 이미지는 이미지 파일을 함께 선택하는 방식이 아직 필요합니다.');

                if (loaded.bytes.byteLength > MARKDOWN_IMAGE_MAX_BYTES) {
                    throw new Error('이미지 용량이 8MB를 초과합니다.');
                }
                // WebP → PNG 변환 (HWPX는 BMP/PNG/JPEG/GIF만 지원)
                let imageBytes = loaded.bytes;
                let imageMeta;
                if (isWebP(imageBytes)) {
                    const conv = await convertWebpToPng(imageBytes);
                    imageBytes = conv.bytes;
                    imageMeta = { ext: 'png', mimeType: 'image/png', width: conv.width, height: conv.height };
                } else {
                    imageMeta = sniffRasterImage(imageBytes, loaded.mimeType);
                }
                if (totalBytes + imageBytes.byteLength > MARKDOWN_IMAGE_TOTAL_MAX_BYTES) {
                    throw new Error('문서 이미지 총용량이 20MB를 초과합니다.');
                }
                totalBytes += imageBytes.byteLength;
                const size = imageSizeHwp(imageMeta);
                out.push({
                    type: 'image',
                    binName: `image${imageCounter++}.${imageMeta.ext}`,
                    mimeType: imageMeta.mimeType,
                    data: imageBytes,
                    ...size,
                    alt: block.alt || '',
                    title: block.title || '',
                    sourceFormat,
                });
            } catch (error) {
                const reason = error?.message || '알 수 없는 오류';
                warnings.push({ assetType: 'image', source: block.src || '', reason });
                out.push(markdownImageFallback(block, reason));
            }
        }
        return out;
    }

    ir.blocks = await resolveBlocks(ir.blocks || []);
    if (warnings.length) ir.assetWarnings = warnings;
    if (externalFetchCount > 0) ir.externalImageCount = externalFetchCount;
    return ir;
}

/** 텍스트 입력 디코딩: BOM 우선, 유효 UTF-8, 마지막으로 EUC-KR(CP949) */
function decodeTextBuffer(arrayBuffer) {
    const bytes = new Uint8Array(arrayBuffer);
    let text;
    if (bytes.length >= 2 && bytes[0] === 0xFF && bytes[1] === 0xFE) {
        text = new TextDecoder('utf-16le').decode(bytes.subarray(2));
        return text.replace(/\r\n?/g, '\n');
    }
    if (bytes.length >= 2 && bytes[0] === 0xFE && bytes[1] === 0xFF) {
        text = new TextDecoder('utf-16be').decode(bytes.subarray(2));
        return text.replace(/\r\n?/g, '\n');
    }
    const utf8Bytes = bytes.length >= 3 && bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF
        ? bytes.subarray(3) : bytes;
    try {
        text = new TextDecoder('utf-8', { fatal: true }).decode(utf8Bytes);
    } catch (_) {
        try {
            text = new TextDecoder('euc-kr', { fatal: true }).decode(bytes);
        } catch (e) {
            throw new Error('텍스트 인코딩을 해석할 수 없습니다. UTF-8 또는 EUC-KR로 다시 저장해 주세요.');
        }
    }
    // textarea는 줄바꿈을 LF로 정규화한다. 파일 입력도 같은 기준을 써야
    // 문단·목록·표 파싱 결과가 운영체제의 CRLF/LF 차이에 좌우되지 않는다.
    return text.replace(/\r\n?/g, '\n');
}


// ─────────────────────────────────────────────────────────────────────────
// [포맷 레지스트리]
//   확장자 → 파서 정보 맵
//   [수정 시] 새 포맷 추가는 여기에 항목만 추가하면 됨
//   accept: 'text'(텍스트 읽기) | 'buffer'(ArrayBuffer 읽기)
//   async:  true = parseXxx가 async 함수
// ─────────────────────────────────────────────────────────────────────────
const PARSERS = {
    'md':       { fn: parseMd,    async: false, label: 'Markdown', accept: 'text'   },
    'markdown': { fn: parseMd,    async: false, label: 'Markdown', accept: 'text'   },
    'html':     { fn: parseHtml,  async: false, label: 'HTML',     accept: 'text'   },
    'htm':      { fn: parseHtml,  async: false, label: 'HTML',     accept: 'text'   },
    'txt':      { fn: parseTxt,   async: false, label: 'TXT',      accept: 'text'   },
    'text':     { fn: parseTxt,   async: false, label: 'TXT',      accept: 'text'   },
    'csv':      { fn: parseCsv,   async: false, label: 'CSV',      accept: 'text'   },
    'xlsx':     { fn: parseXlsx,  async: false, label: 'XLSX',     accept: 'buffer' },
    'xls':      { fn: parseXlsx,  async: false, label: 'XLS',      accept: 'buffer' },
    'json':     { fn: parseJson,  async: false, label: 'JSON',     accept: 'text'   },
    'ipynb':    { fn: parseIpynb, async: false, label: 'IPYNB',    accept: 'text'   },
    'docx':     { fn: parseDocx,  async: true,  label: 'DOCX',     accept: 'buffer' },
    'pptx':     { fn: parsePptx,  async: true,  label: 'PPTX',     accept: 'buffer' },
    'hwp':      { fn: parseHwp,   async: true,  label: 'HWP',      accept: 'buffer' },
    'hwpx':     { fn: parseHwp,   async: true,  label: 'HWPX',     accept: 'buffer' },
};

/**
 * 파일명에서 소문자 확장자 추출
 * 예) "report.v2.DOCX" → "docx"
 */
function getExtension(filename) {
    return filename.split('.').pop().toLowerCase().trim();
}

/**
 * File 객체를 IR로 변환하는 통합 진입점
 * [보안] 파일 크기 20MB 제한 적용
 * [수정 시] 지원 포맷 추가 후에는 이 함수 수정 불필요 (PARSERS 맵만 수정)
 */
export async function fileToIR(file, docType = 'plain') {
    const ext = getExtension(file.name);
    const parser = PARSERS[ext];

    if (!parser) {
        throw new Error(`지원하지 않는 형식: .${ext}`);
    }

    // 포맷별 파일 크기 제한: 바이너리(buffer) 50MB, 텍스트 100MB
    const maxMb    = parser.accept === 'buffer' ? 50 : 100;
    const MAX_BYTES = maxMb * 1024 * 1024;
    if (file.size > MAX_BYTES) {
        throw new Error(`파일 크기 초과: ${(file.size / 1024 / 1024).toFixed(1)}MB (최대 ${maxMb}MB)`);
    }

    // accept 타입에 따라 파일 읽기 방법 선택
    if (parser.accept === 'text') {
        const text = decodeTextBuffer(await file.arrayBuffer());
        const ir = parser.async ? await parser.fn(text, docType) : parser.fn(text, docType);
        return (ext === 'md' || ext === 'markdown' || ext === 'ipynb')
            ? await resolveMarkdownAssets(ir, ext === 'ipynb' ? 'ipynb' : 'md')
            : ir;
    } else {
        const buffer = await file.arrayBuffer();
        return parser.async ? await parser.fn(buffer, docType) : parser.fn(buffer, docType);
    }
}

// golden test의 page.evaluate()에서 전역 접근이 필요한 함수만 노출(과도기 — 추후 제거 예정)
if (typeof window !== 'undefined') {
    window.normalizeMarkdownImageSource = normalizeMarkdownImageSource;
    window.markdownImageFallback = markdownImageFallback;
}
