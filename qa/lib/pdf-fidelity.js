/* ===================================================================
 * [qa/lib/pdf-fidelity.js] PDF 변환 충실도 측정
 * ===================================================================
 * "변환율 100%"를 주장하려면 **무엇을 세는지** 먼저 정해야 한다.
 * PDF에는 문단·표·제목이라는 개념이 없고 "이 좌표에 이 글자를 그려라"만
 * 있다. 그래서 "원본과 같은가"를 그대로 물을 수 없고, 두 가지로 나눈다.
 *
 * ① 문자 보존율 — PDF 글자 레이어의 모든 글자가 결과 IR에 남아 있는가.
 *    정답이 따로 필요 없다(PDF 자신이 정답). **100%가 목표이자 하한이다.**
 *    글자가 사라지는 것은 추론 실패가 아니라 버그다.
 *
 * ② 구조 정확도 — 제목·표·목록·그림·서식이 정답과 맞는가.
 *    이건 정답을 아는 픽스처에서만 잴 수 있다.
 *
 * 두 숫자를 섞지 않는다. 섞으면 글자를 잃고도 구조 점수로 가릴 수 있다.
 * ===================================================================*/

'use strict';

/**
 * 비교용 정규화.
 *
 * 공백은 PDF에서 "글자 사이 간격"으로도 표현되므로 개수를 비교할 수 없다.
 * 그래서 공백을 전부 지우고 **글자만** 비교한다. 줄바꿈 위치가 달라지는 것은
 * 손실이 아니지만, 글자가 없어지는 것은 손실이다.
 */
function normalizeForCompare(s) {
    return String(s || '')
        .normalize('NFC')
        .replace(/\s+/g, '');
}

/** IR 블록에서 사람이 읽는 글자를 전부 모은다. */
function irText(ir) {
    const out = [];
    const pushRuns = runs => {
        for (const r of runs || []) if (r && typeof r.text === 'string') out.push(r.text);
    };
    const walk = blocks => {
        for (const b of blocks || []) {
            if (!b) continue;
            if (typeof b.text === 'string') out.push(b.text);
            pushRuns(b.runs);
            for (const item of b.items || []) {
                if (typeof item === 'string') out.push(item);
                else if (item) { if (typeof item.text === 'string') out.push(item.text); pushRuns(item.runs); }
            }
            // 표는 머리행(header)이 rows와 **별도 배열**이다. 빠뜨리면
            // 파서는 멀쩡한데 측정만 글자를 잃은 것처럼 보인다.
            for (const row of [b.header, ...(b.rows || [])]) {
                if (!row) continue;
                for (const cell of row || []) {
                    if (typeof cell === 'string') out.push(cell);
                    else if (cell) {
                        if (typeof cell.text === 'string') out.push(cell.text);
                        pushRuns(cell.runs);
                        walk(cell.blocks);
                    }
                }
            }
            walk(b.blocks);
        }
    };
    if (ir && typeof ir.title === 'string') out.push(ir.title);
    walk(ir && ir.blocks);
    // 블록 사이에 줄바꿈을 넣는다. 붙여 버리면 앞 블록 끝과 뒤 블록 시작이
    // 한 낱말처럼 보여 "낱말이 붙었다"는 검사가 헛돈다.
    // 비교용 정규화가 공백을 지우므로 보존율 계산에는 영향이 없다.
    return out.join('\n');
}

/**
 * PDF 글자 레이어의 원문을 그대로 모은다(추론 전).
 * 파서가 무엇을 했든 상관없이 **원본이 무엇이었는지**의 기준선이다.
 */
let _pdfjs = null;

/**
 * 파서와 **같은 방식으로** pdf.js를 연다.
 * workerSrc를 안 잡으면 Node에서 getDocument가 실패한다.
 */
async function loadPdfjsForMeasure() {
    if (_pdfjs) return _pdfjs;
    const { pathToFileURL } = require('node:url');
    const path = require('node:path');
    const dir = pathToFileURL(path.join(__dirname, '..', '..', 'js', 'vendor', 'pdfjs-6.3.289') + path.sep).href;
    const mod = await import(`${dir}pdf.min.mjs`);
    mod.GlobalWorkerOptions.workerSrc = `${dir}pdf.worker.min.mjs`;
    _pdfjs = mod;
    return mod;
}

async function pdfRawText(data) {
    const pdfjs = await loadPdfjsForMeasure();
    const doc = await pdfjs.getDocument({
        data, useSystemFonts: true, disableFontFace: true, isEvalSupported: false,
    }).promise;
    try {
        const parts = [];
        for (let p = 1; p <= doc.numPages; p++) {
            const page = await doc.getPage(p);
            const tc = await page.getTextContent();
            for (const it of tc.items) if (typeof it.str === 'string') parts.push(it.str);
            page.cleanup();
        }
        return parts.join('');
    } finally {
        try { await doc.cleanup?.(); } catch { /* 정리 실패 무시 */ }
        try { await doc.destroy?.(); } catch { /* 정리 실패 무시 */ }
    }
}

/**
 * 문자 보존율.
 *
 * 원문 글자를 순서대로 훑으며 결과에서 같은 순서로 찾는다. 단순 집합 비교로는
 * 같은 글자가 여러 번 나올 때 하나만 남아도 100%가 나와 버린다.
 *
 * @returns {{rate:number, total:number, kept:number, lostSample:string[]}}
 */
function charCoverage(rawText, outText) {
    const src = normalizeForCompare(rawText);
    const dst = normalizeForCompare(outText);
    if (!src.length) return { rate: 1, total: 0, kept: 0, lostSample: [] };

    let di = 0, kept = 0;
    const lost = [];
    for (let si = 0; si < src.length; si++) {
        const ch = src[si];
        const found = dst.indexOf(ch, di);
        // 너무 멀리 건너뛰면 "다른 곳의 같은 글자"를 잘못 맞춘 것이다.
        if (found !== -1 && found - di <= 200) { kept++; di = found + 1; }
        else if (lost.length < 40) lost.push(`${ch}@${si}`);
    }
    return {
        rate: kept / src.length,
        total: src.length,
        kept,
        lostSample: lost,
    };
}

module.exports = { normalizeForCompare, irText, pdfRawText, charCoverage, loadPdfjsForMeasure };
