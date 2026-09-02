/* ===================================================================
 * [core/index.js] @tohwpx/core — Node 진입점
 * ===================================================================
 * 웹앱과 **같은 렌더러**(js/hwpx.js)를 Node에서 쓰기 위한 얇은 진입점이다.
 * 렌더러를 복제하지 않으므로 CLI·MCP·웹앱의 산출물이 갈라지지 않는다.
 *
 *   import { irToHwpx } from './js/core/index.js';
 *   const { bytes } = await irToHwpx(ir, { fontName: '함초롬바탕' });
 *
 * 이 파일이 하는 일은 두 가지뿐이다.
 *   ① 호스트 기능(JSZip, 출력 타입, XML 파서)을 런타임에 주입한다.
 *   ② 렌더러의 긴 위치 인자 시그니처를 이름 있는 옵션으로 감싼다.
 *
 * 변환 규칙은 한 줄도 여기에 두지 않는다.
 * ===================================================================*/

'use strict';

import { createRequire } from 'node:module';
import { configureRuntime } from './runtime.js';
import { buildHwpx, validateHwpx } from '../hwpx.js';

const require = createRequire(import.meta.url);

let _configured = false;

/**
 * Node 호스트 기능을 렌더러에 주입한다(중복 호출 안전).
 * XML well-formed 검사는 파서가 있을 때만 켠다 — 없으면 그 검사를 건너뛰고,
 * 없다는 이유로 "통과"라고 말하지 않는다.
 */
export function ensureNodeRuntime() {
    if (_configured) return;
    const JSZip = require('jszip');

    let parseXml = null;
    try {
        // 선택 의존성. 있으면 XML well-formed 검사까지 Node에서 수행한다.
        const { DOMParser } = require('@xmldom/xmldom');
        parseXml = (xml) => {
            const errors = [];
            const doc = new DOMParser({
                onError: (level, msg) => { if (level === 'error' || level === 'fatalError') errors.push(msg); },
            }).parseFromString(xml, 'text/xml');
            if (errors.length) throw new Error(errors[0]);
            return doc;
        };
    } catch {
        parseXml = null;   // 검사를 건너뛴다(통과로 처리하지 않는다)
    }

    configureRuntime({ JSZip, outputType: 'uint8array', parseXml });
    _configured = true;
}

/** 렌더러 기본값 — 웹앱 기본 옵션과 같은 값을 유지한다. */
export const DEFAULT_RENDER_OPTIONS = Object.freeze({
    fontName: '휴먼명조',
    fontSize: 12,
    marginsMm: null,
    paperSize: 'A4',
    orientation: 'portrait',
    lineSpacingPercent: 160,
    onProgress: null,
    options: {},
});

/**
 * IR → HWPX 바이트.
 *
 * @param {object} ir  공통 IR {title, doc_type, blocks}
 * @param {object} [opts] DEFAULT_RENDER_OPTIONS 참조
 * @returns {Promise<{bytes:Uint8Array, validation:object}>}
 */
export async function irToHwpx(ir, opts = {}) {
    ensureNodeRuntime();
    const o = { ...DEFAULT_RENDER_OPTIONS, ...opts };

    const bytes = await buildHwpx(
        ir,
        o.fontName,
        o.fontSize,
        o.marginsMm,
        o.paperSize,
        o.onProgress,
        o.orientation,
        o.lineSpacingPercent,
        o.options,
    );

    const validation = await validateHwpx(bytes, o.marginsMm);
    return { bytes, validation };
}

/** 이미 만들어진 HWPX 바이트를 검증한다. */
export async function verifyHwpx(bytes, expectedMarginsMm = null) {
    ensureNodeRuntime();
    return await validateHwpx(bytes, expectedMarginsMm);
}

export { buildHwpx, validateHwpx, configureRuntime };
