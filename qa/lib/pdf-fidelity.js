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
    // ⚠ `text`와 `runs`는 **같은 내용**이다. 둘 다 세면 글자가 두 번 들어가
    // 보존율이 부풀고 읽기 순서 비교가 통째로 어긋난다(`서문서문`).
    // 서식이 있으면 runs가 정본이고, 없으면 text가 정본이다.
    const pushBoth = (text, runs) => {
        if (runs && runs.length) pushRuns(runs);
        else if (typeof text === 'string') out.push(text);
    };
    const walk = blocks => {
        for (const b of blocks || []) {
            if (!b) continue;
            pushBoth(b.text, b.runs);
            for (const item of b.items || []) {
                if (typeof item === 'string') out.push(item);
                else if (item) pushBoth(item.text, item.runs);
            }
            // 표는 머리행(header)이 rows와 **별도 배열**이다. 빠뜨리면
            // 파서는 멀쩡한데 측정만 글자를 잃은 것처럼 보인다.
            for (const row of [b.header, ...(b.rows || [])]) {
                if (!row) continue;
                for (const cell of row || []) {
                    if (typeof cell === 'string') out.push(cell);
                    else if (cell) {
                        pushBoth(cell.text, cell.runs);
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
 * 두 문자열의 최장 공통 부분수열(LCS) 길이 — **띠(band) 안에서만** 계산한다.
 *
 * 읽기 순서를 재려면 "같은 순서로 얼마나 겹치는가"를 알아야 한다. 예전에는
 * 앞에서부터 탐욕적으로 같은 글자를 찾았는데, 그러면 **먼 곳의 같은 글자에
 * 잘못 걸려** 그 뒤가 통째로 어긋난다. 실제로 쪽번호 `1`이 본문 `1.1.`의 `1`에
 * 걸려 `서문`을 건너뛰었고, 멀쩡한 문서가 순서 2%로 나왔다.
 *
 * 온전한 LCS는 19,000자 × 19,000자면 3억 6천만 칸이라 못 쓴다. 하지만 두 문자열이
 * 거의 같으므로 정렬은 대각선 근처를 벗어나지 않는다. 그래서 대각선에서 ±W만
 * 계산한다.
 */
function lcsBanded(a, b, band) {
    const n = a.length, m = b.length;
    if (!n || !m) return 0;
    const W = Math.min(4096, Math.max(256, band ?? (Math.abs(n - m) + 512)));
    const width = 2 * W + 1;
    let prev = new Int32Array(width);
    let cur = new Int32Array(width);

    for (let i = 1; i <= n; i++) {
        cur.fill(0);
        const lo = Math.max(1, i - W), hi = Math.min(m, i + W);
        for (let j = lo; j <= hi; j++) {
            const k = j - i + W;                       // 띠 안 위치
            if (a.charCodeAt(i - 1) === b.charCodeAt(j - 1)) {
                cur[k] = prev[k] + 1;                  // D[i-1][j-1]
            } else {
                const up = (k + 1 < width) ? prev[k + 1] : 0;   // D[i-1][j]
                const left = (k - 1 >= 0) ? cur[k - 1] : 0;     // D[i][j-1]
                cur[k] = up > left ? up : left;
            }
        }
        const t = prev; prev = cur; cur = t;
    }
    let best = 0;
    for (let k = 0; k < width; k++) if (prev[k] > best) best = prev[k];
    return best;
}

/**
 * 읽기 순서 정확도.
 *
 * 원문 글자 중 **원래 순서대로** 결과에 남아 있는 비율이다.
 * 일부러 뺀 글자(쪽 장식·구조로 바뀐 글머리 기호)는 분모에서 뺀다 —
 * 빼기로 한 글자는 순서를 따질 대상이 아니다.
 *
 * @param {string} rawText PDF 원문
 * @param {string} outText 변환 결과
 * @param {string[]} [declaredPieces] 일부러 뺀 것들
 */
function orderAccuracy(rawText, outText, declaredPieces = []) {
    const src = normalizeForCompare(rawText);
    const dst = normalizeForCompare(outText);
    if (!src.length) return { rate: 1, lcs: 0, total: 0 };

    let declared = 0;
    for (const piece of declaredPieces) declared += normalizeForCompare(piece).length;

    const lcs = lcsBanded(src, dst);
    const total = Math.max(1, src.length - declared);
    return { rate: Math.min(1, lcs / total), lcs, total };
}

module.exports = { normalizeForCompare, irText, pdfRawText, orderAccuracy, lcsBanded, loadPdfjsForMeasure };
