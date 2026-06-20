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


// ─────────────────────────────────────────────────────────────────────────
// [1] Markdown 파서
//     방법: marked.js(CDN)로 MD→HTML 변환 후, HTML 파서 재사용
//     장점: marked.js가 CommonMark 표준을 처리하므로 별도 MD 파싱 불필요
// ─────────────────────────────────────────────────────────────────────────
function parseMd(text, docType = 'plain') {
    // marked.js가 index.html CDN으로 로드되지 않았으면 TXT 파서로 폴백
    if (typeof marked === 'undefined') {
        console.warn('[parsers] marked.js 미로드 — TXT 파서로 폴백');
        return parseTxt(text, docType);
    }
    // 3개 이상 연속 빈 줄 → 빈 단락 HTML 마커로 보존
    // (marked.js는 연속 빈 줄을 하나의 단락 구분으로 처리해서 정보가 손실됨)
    const preprocessed = text.replace(/\n{3,}/g, '\n\n<p></p>\n\n');
    let html = marked.parse(preprocessed);
    // CommonMark 엣지 케이스 폴백: **"텍스트"** 처럼 유니코드 구두점에 인접한 ** / * 를
    // marked.js가 right-flanking delimiter로 인식하지 못해 변환 실패하는 경우 보정
    html = html.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, '<em>$1</em>');
    return parseHtml(html, docType);
}


// ─────────────────────────────────────────────────────────────────────────
// [2] HTML 파서
//     방법: DOMParser API로 HTML DOM을 생성하고 요소 순회하며 IR 블록 추출
//     보안: 파싱 결과를 textContent로만 읽어 XSS 실행 불가
// ─────────────────────────────────────────────────────────────────────────
function parseHtml(htmlText, docType = 'plain') {
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

/**
 * DOM 요소 안의 인라인 서식을 runs 배열로 추출
 * bold({text, bold:true}), italic({text, italic:true}), code({text, code:true}) 구분
 * hwpx.js buildParaRuns()와 대응됨
 */
function extractInlineRuns(el) {
    const runs = [];
    function walk(node, bold, italic, code) {
        if (node.nodeType === 3) {
            const text = sanitize(node.textContent || '');
            if (text) runs.push({ text, bold: !!bold, italic: !!italic, code: !!code });
        } else if (node.nodeType === 1) {
            const t = (node.tagName || '').toLowerCase();
            const b = bold  || t === 'strong' || t === 'b';
            const i = italic || t === 'em'     || t === 'i';
            const c = code  || t === 'code';
            for (const ch of node.childNodes) walk(ch, b, i, c);
        }
    }
    for (const ch of el.childNodes) walk(ch, false, false, false);
    return runs;
}

/** HTML 노드 재귀 순회 → 의미 있는 요소를 IR 블록으로 추출 */
function extractFromNode(node, blocks) {
    for (const child of node.childNodes) {
        const tag = (child.tagName || '').toLowerCase();

        if (/^h[1-6]$/.test(tag)) {
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

        } else if (tag === 'ul') {
            // 순서없는 목록 → ordered:false
            const items = Array.from(child.querySelectorAll(':scope > li'))
                .map(li => sanitize((li.firstChild ? li.firstChild.textContent : li.textContent) || li.textContent).trim())
                .filter(Boolean);
            if (items.length) blocks.push({ type: 'list', ordered: false, items });

        } else if (tag === 'ol') {
            // 순서있는 목록 → ordered:true (buildSection에서 "1. 2. 3." 형식으로 출력)
            const items = Array.from(child.querySelectorAll(':scope > li'))
                .map(li => sanitize((li.firstChild ? li.firstChild.textContent : li.textContent) || li.textContent).trim())
                .filter(Boolean);
            if (items.length) blocks.push({ type: 'list', ordered: true, items });

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
            // 인용 → 들여쓰기 para (▶ 접두어)
            const text = sanitize(child.textContent.trim());
            if (text) blocks.push({ type: 'para', text: '▶ ' + text });

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

/** <table> DOM 요소 → IR table 블록 변환 */
function extractHtmlTable(tableEl) {
    const rows = tableEl.querySelectorAll('tr');
    if (!rows.length) return null;

    const allRows = Array.from(rows).map(tr =>
        Array.from(tr.querySelectorAll('th, td'))
            .map(td => sanitize(td.textContent.trim()))
    );

    if (!allRows.length) return null;
    // 첫 행을 항상 헤더 행으로 처리 (D9D9D9 배경색 적용)
    return { type: 'table', header: allRows[0], rows: allRows.slice(1) };
}


// ─────────────────────────────────────────────────────────────────────────
// [3] 일반 텍스트(TXT) 파서
//     방법: 빈 줄로 단락 구분, '#' 접두어로 제목 인식
// ─────────────────────────────────────────────────────────────────────────
function parseTxt(text, docType = 'plain') {
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
function parseCsv(text, docType = 'plain') {
    const ir = emptyIR('스프레드시트', docType);
    const rows = csvToRows(text);
    if (!rows.length) return ir;

    const header = rows[0].map(sanitize);
    const dataRows = rows.slice(1).map(r => r.map(sanitize));

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
 * CSV 문자열 → 2차원 배열
 * 따옴표 안 쉼표, 이중 따옴표 이스케이프(""), CRLF/LF 모두 처리
 */
function csvToRows(text) {
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
        } else if (c === ',') {
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
    // 마지막 행 처리 (줄바꿈 없이 끝나는 경우)
    row.push(field);
    if (row.some(v => v.trim())) rows.push(row);
    return rows;
}


// ─────────────────────────────────────────────────────────────────────────
// [5] XLSX 파서
//     방법: SheetJS(CDN) 라이브러리로 첫 번째 시트 → CSV 변환 후 parseCsv() 재사용
//     [주의] SheetJS가 CDN에서 로드되어 있어야 함 (index.html 스크립트 태그 참조)
// ─────────────────────────────────────────────────────────────────────────
function parseXlsx(arrayBuffer, docType = 'plain') {
    if (typeof XLSX === 'undefined') {
        // SheetJS 미로드 시 오류 블록으로 폴백
        const ir = emptyIR('XLSX 문서', docType);
        ir.blocks.push({ type: 'para', text: 'SheetJS 라이브러리 미로드: XLSX 처리 불가. 인터넷 연결을 확인하세요.' });
        return ir;
    }

    const workbook = XLSX.read(arrayBuffer, { type: 'array' });
    const firstSheetName = workbook.SheetNames[0];
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
function parseJson(text, docType = 'plain') {
    let obj;
    try {
        obj = JSON.parse(text);
    } catch (e) {
        const ir = emptyIR('JSON 문서', docType);
        ir.blocks.push({ type: 'para', text: 'JSON 파싱 오류: ' + e.message });
        return ir;
    }

    // IR 형식 판별: { blocks: [...] } 구조면 직접 사용
    if (obj && typeof obj === 'object' && Array.isArray(obj.blocks)) {
        return {
            title: sanitize(obj.title || 'JSON 문서'),
            doc_type: obj.doc_type || docType,
            // 중첩 객체 내 텍스트도 sanitize 적용
            blocks: (obj.blocks || []).map(b => ({
                ...b,
                text:  b.text  ? sanitize(b.text)  : b.text,
                items: b.items ? b.items.map(sanitize) : b.items,
            }))
        };
    }

    // 일반 JSON → key-value 표/목록으로 변환
    const ir = emptyIR('JSON 문서', docType);
    jsonToBlocks(obj, ir.blocks, 0);
    return ir;
}

/** JSON 값을 재귀적으로 IR 블록으로 변환 */
function jsonToBlocks(value, blocks, depth) {
    if (Array.isArray(value)) {
        // 모든 항목이 단순값(문자열/숫자)이면 list 블록
        const allSimple = value.every(v => typeof v !== 'object' || v === null);
        if (allSimple) {
            blocks.push({ type: 'list', items: value.map(v => sanitize(String(v))) });
        } else {
            // 복잡한 배열: 인덱스 제목 + 재귀
            value.forEach((v, i) => {
                blocks.push({ type: 'heading', level: Math.min(depth + 2, 6), text: `[${i}]` });
                jsonToBlocks(v, blocks, depth + 1);
            });
        }
    } else if (value && typeof value === 'object') {
        // 객체 → 키/값 2열 표
        const rows = Object.entries(value).map(([k, v]) => [
            sanitize(k),
            typeof v === 'object' ? JSON.stringify(v) : sanitize(String(v))
        ]);
        if (rows.length) blocks.push({ type: 'table', header: ['키', '값'], rows });
    } else {
        blocks.push({ type: 'para', text: sanitize(String(value)) });
    }
}


// ─────────────────────────────────────────────────────────────────────────
// [7] IPYNB 파서 (Jupyter Notebook)
//     방법: IPYNB는 JSON 구조. cell_type에 따라 markdown/code/raw 처리
//     지원: nbformat 3(worksheets) / 4(cells) 모두 처리
//     한계: base64 이미지 출력 셀은 "[그림]" 안내 텍스트로 대체
// ─────────────────────────────────────────────────────────────────────────
function parseIpynb(text, docType = 'plain') {
    let nb;
    try {
        nb = JSON.parse(text);
    } catch {
        return { ...emptyIR('Notebook', docType), blocks: [{ type: 'para', text: 'IPYNB 파싱 오류: JSON 형식이 아님' }] };
    }

    const ir = emptyIR('Jupyter Notebook', docType);
    // nbformat 3: nb.worksheets[0].cells / nbformat 4: nb.cells
    const cells = nb.cells || (nb.worksheets && nb.worksheets[0] && nb.worksheets[0].cells) || [];

    for (const cell of cells) {
        // source는 문자열 배열 또는 단일 문자열로 올 수 있음
        const source = Array.isArray(cell.source) ? cell.source.join('') : (cell.source || '');

        if (cell.cell_type === 'markdown') {
            // 마크다운 셀 → MD 파서 재사용
            const mdIR = parseMd(source, docType);
            ir.blocks.push(...mdIR.blocks);

        } else if (cell.cell_type === 'code') {
            // 코드 셀: 코드 내용 표시
            if (source.trim()) {
                ir.blocks.push({ type: 'para', text: '[코드]\n' + sanitize(source) });
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
                    // 이미지 출력은 안내 텍스트로 대체
                    if (out.data && out.data['image/png']) {
                        ir.blocks.push({ type: 'para', text: '[그림 — HWPX에서 이미지 삽입 미지원]' });
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
//     한계: 이미지·복잡 스타일·주석·머리글/바닥글 미지원 (텍스트 추출만)
//     [주의] ArrayBuffer를 받는 비동기 함수 (async)
// ─────────────────────────────────────────────────────────────────────────
const DOCX_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

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
    const ir = emptyIR('DOCX 문서', docType);

    // w:body 직계 자식 순회 (단락: w:p, 표: w:tbl)
    const body = xmlDoc.getElementsByTagNameNS(DOCX_NS, 'body')[0];
    if (!body) return ir;

    for (const node of body.childNodes) {
        const localName = node.localName || '';

        if (localName === 'p') {
            const block = extractDocxParagraph(node);
            if (block) ir.blocks.push(block);
        } else if (localName === 'tbl') {
            const block = extractDocxTable(node);
            if (block) ir.blocks.push(block);
        }
    }

    return ir;
}

/** w:p 단락 노드 → IR 블록 (텍스트 추출 + 스타일 판별) */
function extractDocxParagraph(pNode) {
    // [버그 수정] getAttribute('w:val')은 namespaced attribute를 못 읽음
    //             DOMParser('application/xml')에서 네임스페이스 속성은
    //             getAttributeNS(namespace, localName)으로 읽어야 함
    const pStyles = pNode.getElementsByTagNameNS(DOCX_NS, 'pStyle');
    let styleId = '';
    if (pStyles.length) {
        // 방법 1: 네임스페이스 인식 읽기 (표준)
        styleId = pStyles[0].getAttributeNS(DOCX_NS, 'val') || '';
        // 방법 2: 일부 파서가 prefix 없이 저장하는 경우 폴백
        if (!styleId) styleId = pStyles[0].getAttribute('w:val') || '';
        if (!styleId) styleId = pStyles[0].getAttribute('val') || '';
    }

    // w:r 단위로 텍스트를 읽어 bold/italic 같은 인라인 서식을 일부 보존
    const runEls = Array.from(pNode.getElementsByTagNameNS(DOCX_NS, 'r'));
    const inlineRuns = [];
    for (const r of runEls) {
        const text = sanitize(Array.from(r.getElementsByTagNameNS(DOCX_NS, 't'))
            .map(t => t.textContent || '')
            .join(''));
        if (!text) continue;
        inlineRuns.push({
            text,
            bold: r.getElementsByTagNameNS(DOCX_NS, 'b').length > 0,
            italic: r.getElementsByTagNameNS(DOCX_NS, 'i').length > 0,
        });
    }
    const text = sanitize(inlineRuns.map(r => r.text).join('').trim());
    if (!text) return null;

    // 스타일 이름에 'heading'/'제목'/'title' 포함 시 heading 블록
    if (/heading|제목|title/i.test(styleId)) {
        const level = parseInt(styleId.replace(/\D/g, '') || '1', 10) || 1;
        return { type: 'heading', level: Math.min(level, 6), text };
    }

    // bold 런(w:b)이 단락 전체를 덮고 있으면 소제목으로 처리
    const allBold = inlineRuns.length > 0 && inlineRuns.every(r => r.bold);
    if (allBold) {
        return { type: 'heading', level: 3, text };
    }

    return inlineRuns.length
        ? { type: 'para', runs: inlineRuns }
        : { type: 'para', text };
}

/** w:tbl 표 노드 → IR table 블록 */
function extractDocxTable(tblNode) {
    const rowEls = tblNode.getElementsByTagNameNS(DOCX_NS, 'tr');
    if (!rowEls.length) return null;

    const rows = Array.from(rowEls).map(tr => {
        const cells = tr.getElementsByTagNameNS(DOCX_NS, 'tc');
        return Array.from(cells).map(tc => {
            const tEls = tc.getElementsByTagNameNS(DOCX_NS, 't');
            return sanitize(Array.from(tEls).map(t => t.textContent).join('').trim());
        });
    });

    // 첫 행을 헤더로 사용
    return { type: 'table', header: rows[0] || [], rows: rows.slice(1) };
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

/**
 * HWP/HWPX 파서
 *   ZIP 형식이면 JSZip으로 열어 XML 섹션에서 텍스트 추출 시도
 *   OLE2(HWP5)이면 클라이언트 파싱 불가 안내 반환
 */
async function parseHwp(buffer, docType = 'plain') {
    const ir = emptyIR('HWP 문서', docType);
    const fmt = detectHwpFormat(buffer);

    if (fmt === 'ole2') {
        // HWP5 바이너리 — 브라우저에서 완전 파싱 불가
        ir.title = 'HWP5 바이너리 파일';
        ir.blocks.push({
            type: 'para',
            text: '[알림] 이 파일은 HWP5 바이너리 형식입니다. 브라우저에서 완전한 텍스트 추출이 불가능합니다.'
        });
        ir.blocks.push({
            type: 'para',
            text: '한컴오피스에서 "다른 이름으로 저장 → HWPX 형식"으로 변환하거나, .docx 형식으로 내보내기 후 다시 시도해 주세요.'
        });
        return ir;
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
                ir.blocks.push({ type: 'para', text: '[HWPX] 텍스트를 추출하지 못했습니다. 파일 구조를 확인해 주세요.' });
            }
        } catch (err) {
            throw new Error(`HWP/HWPX 파싱 오류: ${err.message}`);
        }
        return ir;
    }

    // 알 수 없는 형식
    ir.blocks.push({ type: 'para', text: '[HWP] 알 수 없는 파일 형식입니다. HWP 또는 HWPX 파일이 맞는지 확인해 주세요.' });
    return ir;
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
async function fileToIR(file, docType = 'plain') {
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
        const text = await file.text();
        return parser.async ? await parser.fn(text, docType) : parser.fn(text, docType);
    } else {
        const buffer = await file.arrayBuffer();
        return parser.async ? await parser.fn(buffer, docType) : parser.fn(buffer, docType);
    }
}
