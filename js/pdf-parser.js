/* ===================================================================
 * [pdf-parser.js] PDF → 공통 IR
 * ===================================================================
 * PDF는 **레이아웃 기술 형식**이다. 문단·표·목록 같은 논리 구조를 담지
 * 않고, 글자를 어느 좌표에 어떤 크기로 그릴지만 담는다. 따라서 구조 복원은
 * 본질적으로 **추론**이며 손실이 있다.
 *
 * 이 파서는 그 사실을 숨기지 않는다.
 *   - 추론한 근거(글자 크기, x 좌표, 줄 간격)를 `ir.audit`에 남긴다.
 *   - 확신할 수 없는 것은 만들어내지 않는다.
 *   - 결과 카드와 CLI가 "무엇을 추론했고 무엇을 못 했는지" 그대로 보여준다.
 *
 * 고정 백분율로 품질을 표기하지 않는다(AGENTS.md 원칙). 문서마다 다르다.
 *
 * 추론 규칙
 *   본문 크기 = 글자 높이의 최빈값
 *   제목      = 본문보다 15% 이상 큰 줄. 크기 내림차순으로 레벨 부여
 *   표        = 열 경계가 일치하는 줄이 2줄 이상 연속
 *   목록      = 본문 왼쪽 여백보다 안쪽에서 시작하는 줄
 *   문단 이어짐 = 줄 간격이 줄 높이의 1.6배 이내이고 글자 크기가 같을 때
 *
 * 하지 못하는 것 (v1)
 *   - 그림 추출: PDF 안 이미지는 가져오지 않는다.
 *   - 셀 병합·중첩 표: 좌표만으로 신뢰할 수 없다.
 *   - 글꼴·색·굵게: 스캔 PDF와 벡터 PDF의 표현이 제각각이라 v1에서 제외.
 *   - 스캔 이미지 PDF: 글자 레이어가 없으면 추출할 것이 없다(그 사실을 알린다).
 * ===================================================================*/

'use strict';

// 버전 고정 vendor 경로. PDF 입력이 실제로 들어왔을 때만 지연 로드한다.
const PDFJS_DIR = new URL('./vendor/pdfjs-6.3.289/', import.meta.url).href;

let _pdfjsPromise = null;

async function loadPdfjs() {
    if (_pdfjsPromise) return _pdfjsPromise;
    _pdfjsPromise = (async () => {
        let mod;
        try {
            // URL은 위의 버전 고정 상수다(사용자 입력 아님).
            // eslint-disable-next-line no-unsanitized/method
            mod = await import(/* webpackIgnore: true */ `${PDFJS_DIR}pdf.min.mjs`);
        } catch (err) {
            _pdfjsPromise = null;
            throw new Error('PDF 읽기 엔진을 불러오지 못했습니다(네트워크 확인 후 다시 시도해 주세요).');
        }
        mod.GlobalWorkerOptions.workerSrc = `${PDFJS_DIR}pdf.worker.min.mjs`;
        return mod;
    })();
    return _pdfjsPromise;
}

// ─────────────────────────────────────────────────────────────────────────
// [1단계] 글자 조각 → 줄
// ─────────────────────────────────────────────────────────────────────────

/**
 * 같은 y에 있는 조각을 한 줄로 묶는다.
 * 허용 오차를 글자 높이에 비례시킨다 — 고정값을 쓰면 큰 글씨의 위첨자나
 * 작은 글씨의 다음 줄이 같은 줄로 붙는다.
 */
function assembleLines(items) {
    const lines = [];
    for (const it of items) {
        const tol = Math.max(2, (it.h || 10) * 0.35);
        const line = lines.find(l => Math.abs(l.y - it.y) <= tol);
        if (line) {
            line.items.push(it);
            line.h = Math.max(line.h, it.h);
        } else {
            lines.push({ y: it.y, h: it.h, items: [it] });
        }
    }
    lines.sort((a, b) => b.y - a.y);              // PDF y축은 아래에서 위
    for (const l of lines) l.items.sort((a, b) => a.x - b.x);
    return lines;
}

/**
 * 한 줄 안에서 가로 간격이 큰 지점을 열 경계로 본다.
 * 간격 기준을 글자 높이에 비례시킨다(고정 px는 글꼴 크기에 따라 무너진다).
 */
function splitColumns(line) {
    const gapThreshold = Math.max(6, (line.h || 10) * 0.9);
    const cols = [];
    let cur = null;
    for (const it of line.items) {
        if (!it.s.trim()) {
            // 공백 조각은 그 자체로 열 사이의 간격일 수 있다.
            if (cur && it.w > gapThreshold) cur.forceBreak = true;
            continue;
        }
        const contiguous = cur && !cur.forceBreak && (it.x - (cur.x + cur.w)) < gapThreshold;
        if (contiguous) {
            cur.s += it.s;
            cur.w = (it.x + it.w) - cur.x;
        } else {
            cur = { s: it.s, x: it.x, w: it.w, forceBreak: false };
            cols.push(cur);
        }
    }
    return cols.map(c => ({ text: c.s.trim(), x: c.x, w: c.w })).filter(c => c.text);
}

// ─────────────────────────────────────────────────────────────────────────
// [2단계] 줄 → 블록
// ─────────────────────────────────────────────────────────────────────────

/** 최빈 글자 높이 = 본문 크기. 소수점을 0.5 단위로 뭉쳐 잡음을 줄인다. */
function bodyFontSize(lines) {
    const hist = new Map();
    for (const l of lines) {
        const key = Math.round((l.h || 0) * 2) / 2;
        if (key <= 0) continue;
        // 긴 줄일수록 본문일 가능성이 높으므로 글자 수로 가중한다.
        const weight = l.items.reduce((n, i) => n + i.s.trim().length, 0);
        hist.set(key, (hist.get(key) || 0) + weight);
    }
    let best = 0, bestW = -1;
    for (const [size, w] of hist) if (w > bestW) { best = size; bestW = w; }
    return best || 10;
}

/** 본문 왼쪽 여백 = 본문 크기 줄들의 최소 x(최빈값). */
function bodyLeftMargin(lines, bodySize) {
    const xs = lines
        .filter(l => Math.abs(l.h - bodySize) < 0.6 && l.items.length)
        .map(l => Math.round(l.items[0].x));
    if (!xs.length) return 0;
    const hist = new Map();
    for (const x of xs) hist.set(x, (hist.get(x) || 0) + 1);
    let best = xs[0], bestN = -1;
    for (const [x, n] of hist) if (n > bestN) { best = x; bestN = n; }
    return best;
}

/** 한 줄에 쓰인 글꼴 식별자 집합. 머리행 판정의 근거로 쓴다. */
function lineFonts(line) {
    const s = new Set();
    for (const it of line?.items || []) if (it.s.trim() && it.font) s.add(it.font);
    return s;
}

/**
 * 목록 들여쓰기 한 단계의 폭을 문서에서 직접 구한다.
 *
 * 고정 상수를 쓰면 문서마다 어긋난다 — 1단계 목록이 레벨 1로 잡히거나
 * 2단계가 1단계로 눌린다. 관측된 들여쓰기 값 중 가장 작은 것을 한 단계로
 * 본다(그것이 곧 "첫 들여쓰기"다).
 */
function indentStepOf(lines, bodySize, leftMargin) {
    const indents = lines
        .filter(l => Math.abs(l.h - bodySize) < 0.6 && l.items.length)
        .map(l => Math.round(l.items[0].x - leftMargin))
        .filter(d => d > bodySize * 0.5);
    if (!indents.length) return bodySize * 2;
    return Math.min(...indents);
}

/** 두 줄의 열 경계가 같은 표에 속한다고 볼 만큼 맞는가. */
function columnsAlign(a, b, tolerance) {
    if (a.length !== b.length || a.length < 2) return false;
    for (let i = 0; i < a.length; i++) {
        if (Math.abs(a[i].x - b[i].x) > tolerance) return false;
    }
    return true;
}

/**
 * 줄 목록에서 표 구간을 찾는다.
 * 열 개수가 2 이상이고 경계가 맞는 줄이 2줄 이상 연속하면 표로 본다.
 *
 * 한 줄짜리 "표처럼 보이는 줄"은 표로 만들지 않는다 — 들여쓴 문단이나
 * 좌우 정렬된 머리말이 표로 둔갑하면 원문보다 나쁜 결과가 된다.
 */
function findTableRuns(lines, colsOf, bodySize) {
    const tol = Math.max(4, bodySize * 0.8);
    const runs = [];
    let i = 0;
    while (i < lines.length) {
        const cols = colsOf(i);
        if (cols.length < 2) { i++; continue; }
        let j = i + 1;
        while (j < lines.length && columnsAlign(cols, colsOf(j), tol)) j++;
        if (j - i >= 2) {
            let start = i;

            // 머리행은 가운데 정렬되는 경우가 많아 x 좌표가 본문 행과 어긋난다.
            // 좌표만 보면 머리행이 표에서 떨어져 나가 "들여쓴 줄" — 즉 목록으로
            // 오분류된다(실제로 그랬다). 열 **개수**가 같고 줄 간격이 표 안
            // 행 간격과 비슷하면 머리행으로 끌어들인다.
            const prev = start - 1;
            if (prev >= 0 && colsOf(prev).length === cols.length) {
                const rowGap = lines[start].y - lines[start + 1].y;
                const headGap = lines[prev].y - lines[start].y;
                if (headGap > 0 && headGap <= rowGap * 1.8) start = prev;
            }

            runs.push({ start, end: j - 1 });
            i = j;
        } else {
            i++;
        }
    }
    return runs;
}

/**
 * PDF 페이지들의 줄을 IR 블록으로 바꾼다.
 * @returns {{blocks:Array, audit:object}}
 */
function linesToBlocks(pages) {
    const allLines = pages.flatMap(p => p.lines);
    const bodySize = bodyFontSize(allLines);
    const leftMargin = bodyLeftMargin(allLines, bodySize);
    const indentStep = indentStepOf(allLines, bodySize, leftMargin);

    // 제목 후보 크기: 본문보다 15% 이상 큰 것들을 내림차순으로 레벨화
    const headingSizes = [...new Set(
        allLines.map(l => Math.round(l.h * 2) / 2).filter(h => h > bodySize * 1.15)
    )].sort((a, b) => b - a).slice(0, 6);

    const blocks = [];
    const audit = {
        sourceFormat: 'pdf',
        status: 'inferred',
        bodyFontSizePt: bodySize,
        headingSizesPt: headingSizes,
        indentStepPt: Math.round(indentStep * 10) / 10,
        pages: pages.length,
        counts: { lines: allLines.length, headings: 0, paragraphs: 0, tables: 0, listItems: 0 },
        notes: [],
    };

    for (const page of pages) {
        const lines = page.lines;
        const colsCache = lines.map(l => splitColumns(l));
        const colsOf = i => colsCache[i] || [];
        const tableRuns = findTableRuns(lines, colsOf, bodySize);
        const inTable = new Set();
        for (const r of tableRuns) for (let k = r.start; k <= r.end; k++) inTable.add(k);

        let paraBuf = null;
        const flushPara = () => {
            if (paraBuf && paraBuf.text.trim()) {
                blocks.push({ type: 'para', text: paraBuf.text.trim() });
                audit.counts.paragraphs++;
            }
            paraBuf = null;
        };

        for (let i = 0; i < lines.length; i++) {
            // ── 표 ──
            const run = tableRuns.find(r => r.start === i);
            if (run) {
                flushPara();
                const rows = [];
                for (let k = run.start; k <= run.end; k++) rows.push(colsOf(k).map(c => c.text));
                // 첫 행을 머리행으로 볼 **근거**가 있는지 본다.
                //   (1) 글자가 더 크거나
                //   (2) 아래 행들과 다른 글꼴로 그려졌다(보통 굵은 변형)
                // 둘 다 없으면 머리행이라고 주장하지 않고 그냥 행으로 둔다.
                const headFonts = lineFonts(lines[run.start]);
                const bodyFonts = lineFonts(lines[run.start + 1]);
                const firstIsHeader =
                    lines[run.start].h > lines[run.start + 1].h + 0.3
                    || (headFonts.size > 0 && bodyFonts.size > 0
                        && ![...headFonts].some(f => bodyFonts.has(f)));
                blocks.push(firstIsHeader
                    ? { type: 'table', header: rows[0], rows: rows.slice(1) }
                    : { type: 'table', rows });
                audit.counts.tables++;
                i = run.end;
                continue;
            }
            if (inTable.has(i)) continue;

            const line = lines[i];
            const cols = colsOf(i);
            const text = cols.map(c => c.text).join(' ').trim();
            if (!text) continue;

            const size = Math.round(line.h * 2) / 2;
            const headingIdx = headingSizes.indexOf(size);

            // ── 제목 ──
            if (headingIdx >= 0) {
                flushPara();
                blocks.push({ type: 'heading', level: headingIdx + 1, text });
                audit.counts.headings++;
                continue;
            }

            // ── 목록(들여쓰기 추론) ──
            const indent = (line.items[0]?.x ?? leftMargin) - leftMargin;
            const isIndented = indent > bodySize * 0.8;

            if (isIndented) {
                flushPara();
                // 첫 들여쓰기 단계가 레벨 0이다(문서에서 구한 indentStep 기준).
                const level = Math.min(2, Math.max(0, Math.round(indent / indentStep) - 1));
                const last = blocks[blocks.length - 1];
                const item = { text, level };
                if (last && last.type === 'list') last.items.push(item);
                else blocks.push({ type: 'list', items: [item] });
                audit.counts.listItems++;
                continue;
            }

            // ── 문단 (줄 이어붙이기) ──
            const prev = lines[i - 1];
            const gap = prev ? (prev.y - line.y) : Infinity;
            const sameStyle = prev ? Math.abs(prev.h - line.h) < 0.6 : false;
            const continues = paraBuf && sameStyle && gap <= line.h * 1.9 && !inTable.has(i - 1);

            if (continues) {
                // 한글은 어절 사이에 공백이 필요하지만, 줄 끝에서 잘린 단어는
                // 붙여야 한다. 앞 줄이 문장부호로 끝나면 공백, 아니면 그대로 잇는다.
                const needsSpace = /[.!?。」』\p{L}\p{N}]$/u.test(paraBuf.text) && /^[A-Za-z0-9(]/.test(text);
                paraBuf.text += (needsSpace ? ' ' : '') + text;
            } else {
                flushPara();
                paraBuf = { text };
            }
        }
        flushPara();
        // 페이지 경계는 빈 줄로만 표시한다(강제 쪽 나눔을 넣지 않는다).
        if (page !== pages[pages.length - 1]) blocks.push({ type: 'blank' });
    }

    return { blocks, audit };
}

// ─────────────────────────────────────────────────────────────────────────
// [진입점]
// ─────────────────────────────────────────────────────────────────────────

/**
 * PDF 바이트를 공통 IR로 바꾼다.
 *
 * @param {ArrayBuffer|Uint8Array} buffer
 * @param {{docType?:string, maxPages?:number}} [options]
 * @returns {Promise<object>} IR ({title, doc_type, blocks, audit})
 */
export async function parsePdf(buffer, options = {}) {
    const pdfjs = await loadPdfjs();
    const maxPages = Number.isFinite(options.maxPages) ? options.maxPages : 300;

    let doc;
    try {
        doc = await pdfjs.getDocument({
            data: buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer),
            useSystemFonts: true,
            // 글꼴 파일을 따로 받지 않는다 — 텍스트 추출에는 필요 없고
            // 외부 요청을 늘리지 않는다는 이 프로젝트의 원칙과도 맞다.
            disableFontFace: true,
            isEvalSupported: false,
        }).promise;
    } catch (err) {
        throw new Error('PDF를 열지 못했습니다(암호 보호되었거나 손상된 파일일 수 있습니다).');
    }

    try {
        const pageCount = Math.min(doc.numPages, maxPages);
        const pages = [];
        let rawItemCount = 0;

        for (let p = 1; p <= pageCount; p++) {
            const page = await doc.getPage(p);
            const tc = await page.getTextContent();
            rawItemCount += tc.items.length;

            const items = tc.items
                .filter(i => typeof i.str === 'string')
                .map(i => ({
                    s: i.str,
                    x: i.transform[4],
                    y: i.transform[5],
                    h: i.height || Math.abs(i.transform[3]) || 0,
                    w: i.width || 0,
                    // 글꼴 식별자는 머리행 판정의 **근거**다. 표 머리행은 보통
                    // 본문과 다른 글꼴(굵은 변형)로 그려진다. 크기가 같아도
                    // 글꼴이 다르면 그건 추측이 아니라 관찰이다.
                    font: i.fontName || '',
                }))
                .filter(i => i.s.length > 0);

            pages.push({ number: p, lines: assembleLines(items) });
            page.cleanup();
        }

        const { blocks, audit } = linesToBlocks(pages);
        audit.truncatedPages = doc.numPages > pageCount ? doc.numPages - pageCount : 0;

        // 글자 레이어가 없는 스캔 PDF — 추출할 것이 없다는 사실을 분명히 말한다.
        if (rawItemCount === 0 || blocks.every(b => b.type === 'blank')) {
            throw new Error(
                'PDF에서 글자를 찾지 못했습니다. 스캔한 이미지로만 된 PDF일 수 있습니다'
                + '(글자 인식(OCR)은 지원하지 않습니다).'
            );
        }

        // 첫 제목을 문서 제목으로 승격한다(다른 파서와 같은 규약).
        let title = '';
        const firstHeadingIdx = blocks.findIndex(b => b.type === 'heading' && b.level === 1);
        if (firstHeadingIdx !== -1) {
            title = blocks[firstHeadingIdx].text;
            blocks.splice(firstHeadingIdx, 1);
        } else {
            const firstPara = blocks.find(b => b.type === 'para' && b.text.trim());
            title = firstPara ? firstPara.text.slice(0, 60) : 'PDF 문서';
        }

        audit.notes.push('PDF는 레이아웃 형식이라 문단·표·목록은 좌표와 글자 크기로 추론했습니다.');
        audit.notes.push('그림, 셀 병합, 글꼴·색은 가져오지 않습니다.');
        if (audit.truncatedPages > 0) {
            audit.notes.push(`${doc.numPages}쪽 중 ${pageCount}쪽만 변환했습니다.`);
        }

        return {
            title,
            doc_type: options.docType || 'plain',
            blocks,
            audit,
        };
    } finally {
        // pdf.js 버전에 따라 destroy가 없을 수 있다. 정리 실패가 변환 실패를
        // 덮어써서는 안 되므로 조용히 넘긴다.
        try { await doc.cleanup?.(); } catch { /* 정리 실패는 무시 */ }
        try { await doc.destroy?.(); } catch { /* 정리 실패는 무시 */ }
    }
}
