/* ===================================================================
 * [core/runtime.js] 렌더러가 쓰는 호스트 기능 어댑터
 * ===================================================================
 * 목적: `js/hwpx.js`(HWPX 렌더러)를 **복제하지 않고** 브라우저와 Node
 *       양쪽에서 돌리는 것.
 *
 * 렌더러를 두 벌로 두면 웹앱과 CLI/MCP의 산출물이 언젠가 반드시 갈라진다.
 * 그래서 렌더러는 한 벌로 두고, 호스트마다 다른 것(ZIP 구현, 출력 컨테이너,
 * XML 파서)만 이 얇은 층에서 갈아 끼운다.
 *
 * 브라우저: 아무것도 하지 않아도 전역 JSZip / Blob / DOMParser를 자동 인식한다.
 * Node    : 진입점에서 configureRuntime({ JSZip, outputType:'uint8array' }) 한 번.
 *
 * ⚠ 이 파일은 변환 규칙을 담지 않는다. 여기에 포맷 지식이 들어가기 시작하면
 *   어댑터가 아니라 두 번째 렌더러가 된다.
 * ===================================================================*/

'use strict';

/** @type {{JSZip:any, outputType:string, parseXml:((xml:string)=>any)|null}} */
const runtime = {
    JSZip: null,
    outputType: null,
    parseXml: null,
};

/**
 * 호스트 기능을 주입한다. Node 진입점에서 한 번 부른다.
 * @param {object} impl
 * @param {any}    [impl.JSZip]      JSZip 생성자
 * @param {string} [impl.outputType] 'blob' | 'uint8array' | 'nodebuffer'
 * @param {(xml:string)=>any} [impl.parseXml] XML 파서(선택 — 없으면 검증 일부를 건너뛴다)
 */
export function configureRuntime(impl = {}) {
    if (impl.JSZip) runtime.JSZip = impl.JSZip;
    if (impl.outputType) runtime.outputType = impl.outputType;
    if (impl.parseXml) runtime.parseXml = impl.parseXml;
}

/** 테스트가 상태를 되돌릴 수 있게 한다. */
export function resetRuntime() {
    runtime.JSZip = null;
    runtime.outputType = null;
    runtime.parseXml = null;
}

/**
 * ZIP 구현을 돌려준다. 주입된 것이 우선이고, 없으면 전역(브라우저)을 쓴다.
 * 둘 다 없으면 호스트별로 다른 안내를 준다 — "인터넷 확인"은 Node에서 틀린 말이다.
 */
export function requireZip() {
    if (runtime.JSZip) return runtime.JSZip;
    if (typeof globalThis !== 'undefined' && globalThis.JSZip) return globalThis.JSZip;
    throw new Error(
        isBrowser()
            ? 'JSZip 미로드: 인터넷 연결을 확인하세요.'
            : 'JSZip이 주입되지 않았습니다. configureRuntime({ JSZip })을 먼저 호출하세요.'
    );
}

/** 브라우저(문서가 있는 환경)인지. */
export function isBrowser() {
    return typeof globalThis !== 'undefined'
        && typeof globalThis.document !== 'undefined'
        && typeof globalThis.Blob !== 'undefined';
}

/**
 * `zip.generateAsync`에 넘길 출력 타입.
 * 브라우저는 Blob(다운로드에 바로 쓰임), Node는 Uint8Array(파일로 바로 씀).
 */
export function zipOutputType() {
    if (runtime.outputType) return runtime.outputType;
    return isBrowser() ? 'blob' : 'uint8array';
}

/**
 * 임의의 입력(Blob | ArrayBuffer | Uint8Array)을 JSZip이 읽을 수 있는 형태로.
 * 검증기가 브라우저에서는 Blob을, Node에서는 바이트를 받기 때문에 필요하다.
 */
export async function toZipInput(value) {
    if (!value) throw new Error('빈 입력입니다.');
    if (typeof value.arrayBuffer === 'function') return await value.arrayBuffer();  // Blob/File
    return value;                                                                   // ArrayBuffer/Uint8Array/Buffer
}

/**
 * XML을 파싱해 well-formed 여부만 확인한다.
 * 파서가 없으면 `null`을 돌려주고, 호출자는 그 검사를 **건너뛴다**.
 * 파서가 없다는 이유로 "통과"라고 말하지 않는다.
 * @returns {{wellFormed:boolean}|null}
 */
export function checkXmlWellFormed(xml) {
    if (runtime.parseXml) {
        try {
            runtime.parseXml(xml);
            return { wellFormed: true };
        } catch {
            return { wellFormed: false };
        }
    }
    const DP = typeof globalThis !== 'undefined' ? globalThis.DOMParser : undefined;
    if (typeof DP === 'undefined') return null;
    const parsed = new DP().parseFromString(xml, 'application/xml');
    return { wellFormed: !parsed.querySelector('parsererror') };
}
