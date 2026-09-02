/* ===================================================================
 * [reverse-export.js] 역방향 내보내기 — HWPX → HWP / 인쇄용 페이지
 * ===================================================================
 * ⚠ 이 모듈은 **선택 기능**이며 생성 경로와 분리된 별도 계통이다.
 *
 *   생성(주 경로)  : js/hwpx.js — 한컴 공개 OWPML/KS X 6101을 단일 근거로 삼는다.
 *   역방향(이 파일): @rhwp/core(MIT) — 리버스 엔지니어링 산물이다.
 *
 * 두 계통을 섞지 않는 이유: 생성 품질의 근거가 공식 규격 하나로 유지돼야
 * "왜 이 XML이 맞는가"에 답할 수 있기 때문이다. 역방향은 편의 기능이며,
 * 실패해도 HWPX 생성·다운로드는 영향을 받지 않아야 한다.
 *
 * 따라서 이 모듈은:
 *   - app.js에서 **동적 import**로만 불린다(초기 로딩에 WASM 8MB를 얹지 않는다).
 *   - 예외를 삼키지 않고 호출자에게 그대로 넘긴다(실패는 실패로 보여야 한다).
 *   - rhwp가 보고하는 content-loss를 가공 없이 전달한다(보존도 과장 금지).
 * ===================================================================*/

'use strict';

// 버전 고정 vendor 경로 — 사용자 입력이 아니다. 같은 서비스 도메인에서 제공한다.
const RHWP_CORE_URL = new URL('./vendor/rhwp-core-0.8.4/rhwp.js', import.meta.url).href;

/** rhwp 모듈 싱글턴 — WASM 초기화는 프로세스당 한 번이면 된다. */
let _rhwpPromise = null;

/**
 * @rhwp/core(WASM)를 지연 로드한다.
 * HWP 내보내기를 실제로 요청했을 때만 8MB WASM을 내려받는다.
 */
export async function loadRhwpCore() {
    if (_rhwpPromise) return _rhwpPromise;
    _rhwpPromise = (async () => {
        let mod;
        try {
            // URL은 위의 버전 고정 상수다(사용자 입력 아님).
            // eslint-disable-next-line no-unsanitized/method
            mod = await import(/* webpackIgnore: true */ RHWP_CORE_URL);
            await mod.default();
        } catch (err) {
            _rhwpPromise = null;   // 네트워크 실패는 재시도 가능해야 한다
            throw new Error('HWP 내보내기 엔진을 불러오지 못했습니다(네트워크 확인 후 다시 시도해 주세요).');
        }
        return mod;
    })();
    return _rhwpPromise;
}

/** 내보내기 대상 형식 정의 — UI 라벨과 MIME/확장자의 단일 출처. */
export const REVERSE_FORMATS = Object.freeze({
    hwp: {
        id: 'hwp',
        label: 'HWP',
        ext: '.hwp',
        mimeType: 'application/x-hwp',
        // 사용자에게 보여줄 한 줄 — 왜 이 형식이 필요한지
        reason: '구버전 한/글에서도 열립니다',
    },
    pdf: {
        id: 'pdf',
        label: 'PDF',
        ext: '.pdf',
        mimeType: 'application/pdf',
        reason: '한/글이 없어도 누구나 열 수 있습니다',
    },
});

/** CSS px(96dpi) → mm. @page 크기를 SVG 실측 치수에 맞추는 데 쓴다. */
const PX_TO_MM = 25.4 / 96;

/** 파일명 확장자를 바꾼다. 원본 확장자가 없으면 덧붙인다. */
export function swapExtension(fileName, ext) {
    const base = String(fileName || 'document').replace(/\.(hwpx|hwp)$/i, '');
    return `${base}${ext}`;
}

/**
 * rhwp의 content-loss JSON을 UI가 쓸 수 있는 형태로 정규화한다.
 * 스키마를 추측해서 채우지 않는다 — 파싱 실패는 "알 수 없음"으로 남긴다.
 */
function normalizeLossReport(raw) {
    if (!raw) return { known: false, count: 0, losses: [] };
    let parsed;
    try {
        parsed = JSON.parse(raw);
    } catch {
        return { known: false, count: 0, losses: [] };
    }
    const losses = Array.isArray(parsed.losses) ? parsed.losses : [];
    return {
        known: true,
        schemaVersion: parsed.schemaVersion ?? null,
        outputFormat: parsed.outputFormat ?? null,
        count: Number.isFinite(parsed.count) ? parsed.count : losses.length,
        losses,
    };
}

/**
 * exportHwpVerify()의 자기 재로드 검증 결과를 정규화한다.
 * 검증 자체가 실패해도 내보내기를 막지 않는다 — 사실만 기록해 호출자가 판단한다.
 */
function normalizeVerify(raw) {
    if (!raw) return { known: false };
    let parsed;
    try {
        parsed = JSON.parse(raw);
    } catch {
        return { known: false };
    }
    const before = parsed.pageCountBefore;
    const after = parsed.pageCountAfter;
    return {
        known: true,
        bytesLen: parsed.bytesLen ?? null,
        pageCountBefore: before ?? null,
        pageCountAfter: after ?? null,
        recovered: parsed.recovered === true,
        // 페이지 수가 달라졌다면 그것 자체가 사용자에게 알릴 사실이다
        pageCountStable: Number.isFinite(before) && Number.isFinite(after) && before === after,
    };
}

/**
 * HWPX 바이트를 HWP 5.0 바이너리로 내보낸다.
 *
 * rhwp가 HWPX 출처 문서에 HWPX→HWP IR 매핑 어댑터를 자동 적용하므로
 * 한컴 호환성과 자기 재로드 페이지 보존이 엔진 수준에서 보장된다.
 *
 * @param {ArrayBuffer|Uint8Array} hwpxBytes 생성 완료된 HWPX 바이트
 * @returns {Promise<{bytes:Uint8Array, blob:Blob, report:object, verify:object}>}
 */
export async function exportHwpxToHwp(hwpxBytes) {
    const mod = await loadRhwpCore();
    const input = hwpxBytes instanceof Uint8Array ? hwpxBytes : new Uint8Array(hwpxBytes);

    let doc;
    try {
        doc = new mod.HwpDocument(input);
    } catch (err) {
        throw new Error('HWPX를 다시 열지 못해 HWP로 변환할 수 없습니다.');
    }

    try {
        // 자기 재로드 검증 — 실패해도 내보내기는 계속한다(사실만 남긴다).
        let verify = { known: false };
        try {
            verify = normalizeVerify(doc.exportHwpVerify());
        } catch {
            verify = { known: false };
        }

        // 바이트 + 손실 보고를 같은 산출물에서 받는다(다른 저장의 상태와 섞이지 않음).
        const result = doc.exportHwpWithReport();
        let bytes, report;
        try {
            report = normalizeLossReport(result.contentLoss());
            bytes = result.takeBytes();
        } finally {
            result.free();
        }

        if (!bytes || bytes.length === 0) {
            throw new Error('HWP 변환 결과가 비어 있습니다.');
        }
        assertHwpSignature(bytes);

        return {
            bytes,
            blob: new Blob([bytes], { type: REVERSE_FORMATS.hwp.mimeType }),
            report,
            verify,
        };
    } finally {
        doc.free();
    }
}

/** HWP 5.0은 CFB(OLE2) 컨테이너다. 시그니처가 아니면 내보내기를 신뢰하지 않는다. */
const CFB_SIGNATURE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];

export function assertHwpSignature(bytes) {
    if (!bytes || bytes.length < CFB_SIGNATURE.length) {
        throw new Error('HWP 변환 결과가 너무 짧습니다.');
    }
    for (let i = 0; i < CFB_SIGNATURE.length; i++) {
        if (bytes[i] !== CFB_SIGNATURE[i]) {
            throw new Error('HWP 변환 결과가 올바른 HWP 5.0 구조가 아닙니다.');
        }
    }
    return true;
}

/**
 * HWPX의 각 페이지를 SVG로 렌더한다(인쇄→PDF 저장 경로에 사용).
 *
 * 별도 PDF 라이브러리를 들이지 않는다. 브라우저 인쇄 대화상자의
 * "PDF로 저장"이 이미 모든 대상 브라우저에 있고, 공급망을 늘리지 않는 편이
 * 이 프로젝트의 기존 결정(vendor 최소화)과 일치하기 때문이다.
 *
 * @param {ArrayBuffer|Uint8Array} hwpxBytes
 * @param {{maxPages?:number}} [options]
 * @returns {Promise<{pages:string[], pageCount:number, truncated:boolean}>}
 */
export async function renderHwpxPagesToSvg(hwpxBytes, options = {}) {
    const maxPages = Number.isFinite(options.maxPages) ? options.maxPages : 200;
    const mod = await loadRhwpCore();
    const input = hwpxBytes instanceof Uint8Array ? hwpxBytes : new Uint8Array(hwpxBytes);

    let doc;
    try {
        doc = new mod.HwpDocument(input);
    } catch (err) {
        throw new Error('HWPX를 다시 열지 못해 인쇄용 페이지를 만들 수 없습니다.');
    }

    // ⚠ HwpViewer는 생성 시 HwpDocument의 소유권을 가져간다.
    //   viewer.free() 뒤에 doc.free()를 부르면 이중 해제로 WASM이 죽는다
    //   ("null pointer passed to rust"). 뷰어를 만든 뒤에는 뷰어만 해제한다.
    let viewer;
    try {
        viewer = new mod.HwpViewer(doc);
    } catch (err) {
        doc.free();
        throw new Error('HWPX 페이지를 렌더링하지 못했습니다.');
    }

    try {
        const pageCount = viewer.pageCount();
        const limit = Math.min(pageCount, maxPages);
        const pages = [];
        for (let i = 0; i < limit; i++) {
            pages.push(viewer.renderPageSvg(i));
        }
        return { pages, pageCount, truncated: pageCount > limit };
    } finally {
        viewer.free();
    }
}

/** SVG 루트의 width/height(px)를 읽는다. 없으면 A4 세로로 가정한다. */
function readSvgSizePx(svg) {
    const m = /<svg[^>]*\bwidth="([\d.]+)"[^>]*\bheight="([\d.]+)"/.exec(svg || '');
    if (!m) return { widthPx: 793.7, heightPx: 1122.5 };
    return { widthPx: parseFloat(m[1]), heightPx: parseFloat(m[2]) };
}

/**
 * 렌더된 페이지들을 인쇄용 문서로 조립한다.
 *
 * 별도 PDF 라이브러리를 vendor에 추가하지 않는다. 브라우저 인쇄 대화상자의
 * "PDF로 저장"이 모든 대상 브라우저에 이미 있고, 공급망을 늘리지 않는 편이
 * 이 저장소의 기존 결정(vendor 최소화, SRI 고정)과 일치한다.
 *
 * @page 크기를 SVG 실측 치수에서 계산하므로 용지·방향이 원본과 어긋나지 않는다.
 */
export function buildPrintDocument(pages, docTitle = '문서') {
    const { widthPx, heightPx } = readSvgSizePx(pages[0]);
    const wMm = (widthPx * PX_TO_MM).toFixed(2);
    const hMm = (heightPx * PX_TO_MM).toFixed(2);

    // 페이지 SVG는 rhwp가 만든 신뢰 가능한 문자열이지만, 제목은 파일명에서
    // 오므로 이스케이프한다.
    const safeTitle = String(docTitle).replace(/[<>&"']/g, ch => (
        { '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' }[ch]
    ));

    const body = pages.map(svg => `<div class="pg">${svg}</div>`).join('\n');

    return `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><title>${safeTitle}</title>
<style>
  @page { size: ${wMm}mm ${hMm}mm; margin: 0; }
  html, body { margin: 0; padding: 0; background: #fff; }
  .pg { width: ${wMm}mm; height: ${hMm}mm; overflow: hidden; page-break-after: always; break-after: page; }
  .pg:last-child { page-break-after: auto; break-after: auto; }
  .pg svg { display: block; width: 100%; height: 100%; }
  @media print { .pg { box-shadow: none; } }
</style></head>
<body>${body}</body></html>`;
}

/**
 * HWPX를 인쇄 대화상자로 넘긴다(사용자가 "PDF로 저장"을 선택).
 *
 * 팝업 차단을 피하려고 새 창 대신 숨은 iframe을 쓴다. 호출은 반드시
 * 사용자 제스처(클릭) 안에서 일어나야 한다.
 *
 * @returns {Promise<{pageCount:number, truncated:boolean}>}
 */
export async function printHwpxAsPdf(hwpxBytes, docTitle = '문서', options = {}) {
    const { pages, pageCount, truncated } = await renderHwpxPagesToSvg(hwpxBytes, options);
    if (!pages.length) throw new Error('인쇄할 페이지를 만들지 못했습니다.');

    const html = buildPrintDocument(pages, docTitle);

    const frame = document.createElement('iframe');
    frame.setAttribute('aria-hidden', 'true');
    frame.style.cssText = 'position:fixed;right:0;bottom:0;width:1px;height:1px;opacity:0;border:0;';
    document.body.appendChild(frame);

    await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('인쇄 문서를 준비하지 못했습니다(시간 초과).')), 20000);
        frame.onload = () => { clearTimeout(timer); resolve(); };
        frame.onerror = () => { clearTimeout(timer); reject(new Error('인쇄 문서를 준비하지 못했습니다.')); };
        frame.srcdoc = html;
    });

    try {
        // 폰트가 자리를 잡은 뒤에 인쇄해야 글자가 잘리지 않는다
        await frame.contentDocument?.fonts?.ready?.catch?.(() => {});
        frame.contentWindow.focus();
        frame.contentWindow.print();
    } finally {
        // 인쇄 대화상자가 닫힐 시간을 준 뒤 정리한다.
        setTimeout(() => frame.remove(), 60000);
    }

    return { pageCount, truncated };
}
