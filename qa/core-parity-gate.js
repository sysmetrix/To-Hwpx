/* ===================================================================
 * [qa/core-parity-gate.js] 웹앱 산출물 ≡ Node 코어 산출물
 * ===================================================================
 * 실행: node qa/core-parity-gate.js
 *
 * Phase 1(엔진 추출)의 합격 기준이다. 렌더러를 한 벌로 유지한다는 결정이
 * 실제로 지켜지는지 — 즉 웹앱과 CLI/MCP가 **같은 HWPX**를 만드는지 검사한다.
 *
 * 왜 필요한가: 코어를 꺼내는 흔한 실패 방식은 "코어를 만들고 웹앱은 예전
 * 경로를 계속 쓰는 것"이다. 그러면 두 산출물이 조용히 갈라지고, 어느 쪽이
 * 진짜인지 아무도 모르게 된다. 이 게이트가 그것을 막는다.
 *
 * 방법
 *   ① 실제 브라우저에서 픽스처를 변환하고, 그때 쓰인 IR과 옵션을 함께 꺼낸다.
 *   ② 같은 IR·옵션을 Node 코어(js/core/index.js)에 넣는다.
 *   ③ 두 ZIP을 엔트리 단위로 비교한다.
 *
 * ZIP 원시 바이트가 아니라 엔트리 내용을 비교하는 이유: JSZip은 엔트리마다
 * 생성 시각을 기록하므로 원시 바이트는 실행할 때마다 달라진다. 그 차이는
 * 변환 품질과 무관하다. 우리가 같아야 한다고 주장하는 것은 **내용**이다.
 * ===================================================================*/

'use strict';

const path = require('node:path');
const JSZip = require('jszip');
const { withConverter, ROOT } = require('./lib/browser-convert.js');

/** 브라우저와 Node 양쪽에서 검사할 대표 입력. */
const FIXTURES = [
    'qa/fixtures/md_hwpx_test.md',
    'qa/fixtures/sample.html',
    'qa/fixtures/sample.csv',
    'qa/fixtures/sample.json',
    'qa/fixtures/sample.docx',
    'qa/fixtures/docx_table_test.docx',
    'qa/fixtures/docx_image_test.docx',
    'qa/fixtures/sample.pptx',
    'qa/fixtures/sample.ipynb',
    'qa/fixtures/sample.pdf',
    // 그림이 있는 PDF. 브라우저는 ImageBitmap을, Node는 원시 픽셀을 준다 —
    // 서로 다른 경로로 같은 PNG가 나오는지 여기서 확인한다.
    'qa/fixtures/pdf_image_test.pdf',
];

/** 페이지에서 base64로 감싸 넘긴 바이트를 Uint8Array로 되돌린다. */
function reviveBytes(node) {
    if (Array.isArray(node)) return node.map(reviveBytes);
    if (node && typeof node === 'object') {
        if (typeof node.__u8__ === 'string') return new Uint8Array(Buffer.from(node.__u8__, 'base64'));
        const out = {};
        for (const [k, v] of Object.entries(node)) out[k] = reviveBytes(v);
        return out;
    }
    return node;
}

/** 시각 등 비결정 필드를 뺀 엔트리 목록 + 내용 해시. */
async function zipEntries(bytes) {
    const zip = await JSZip.loadAsync(bytes);
    const names = Object.keys(zip.files).filter(n => !zip.files[n].dir).sort();
    const out = new Map();
    for (const n of names) {
        const buf = await zip.files[n].async('nodebuffer');
        out.set(n, buf);
    }
    return out;
}

function compareEntries(webMap, nodeMap) {
    const issues = [];
    const webNames = [...webMap.keys()];
    const nodeNames = [...nodeMap.keys()];

    const onlyWeb = webNames.filter(n => !nodeMap.has(n));
    const onlyNode = nodeNames.filter(n => !webMap.has(n));
    if (onlyWeb.length) issues.push(`웹에만 있는 엔트리: ${onlyWeb.join(', ')}`);
    if (onlyNode.length) issues.push(`Node에만 있는 엔트리: ${onlyNode.join(', ')}`);

    let identical = 0;
    for (const n of webNames) {
        if (!nodeMap.has(n)) continue;
        const a = webMap.get(n), b = nodeMap.get(n);
        if (a.equals(b)) { identical++; continue; }
        // 어디가 다른지 짧게 보여준다 — "다르다"만으로는 고칠 수 없다.
        const at = a.toString('utf8'), bt = b.toString('utf8');
        let at0 = 0;
        while (at0 < at.length && at0 < bt.length && at[at0] === bt[at0]) at0++;
        issues.push(
            `엔트리 내용 불일치 ${n} (${a.length}B vs ${b.length}B, 첫 차이 ${at0}자)\n` +
            `        웹  : …${at.slice(Math.max(0, at0 - 40), at0 + 60).replace(/\n/g, '⏎')}\n` +
            `        Node: …${bt.slice(Math.max(0, at0 - 40), at0 + 60).replace(/\n/g, '⏎')}`
        );
    }
    return { issues, identical, total: webNames.length };
}

(async () => {
    let failed = 0;
    const { irToHwpx } = await import('../js/core/index.js');

    console.log('코어 동등성 게이트 — 웹앱 산출물 ≡ Node 코어 산출물\n');

    await withConverter(async (convert, ctx) => {
        const { page } = ctx;

        for (const rel of FIXTURES) {
            let webBytes, snapshot;
            try {
                ({ bytes: webBytes } = await convert(rel));
                // 브라우저가 실제로 쓴 IR과 렌더 옵션을 그대로 꺼낸다.
                // 옵션을 손으로 다시 적으면 그 순간 비교가 무의미해진다.
                //
                // 그림 블록의 data는 Uint8Array다. JSON 직렬화를 그냥 태우면
                // {0:..,1:..} 꼴의 평범한 객체가 되어 JSZip이 읽지 못한다.
                // 바이트를 잃지 않도록 base64로 감싸 넘기고 Node에서 되돌린다.
                snapshot = await page.evaluate(() => {
                    const s = window.__tohwpxDebug?.lastRender;
                    if (!s) return null;
                    const encode = (u8) => {
                        let bin = '';
                        for (let i = 0; i < u8.length; i++) bin += String.fromCharCode(u8[i]);
                        return btoa(bin);
                    };
                    const walk = (node) => {
                        if (Array.isArray(node)) return node.map(walk);
                        if (node && typeof node === 'object') {
                            if (node instanceof Uint8Array) return { __u8__: encode(node) };
                            if (node instanceof ArrayBuffer) return { __u8__: encode(new Uint8Array(node)) };
                            const out = {};
                            for (const [k, v] of Object.entries(node)) out[k] = walk(v);
                            return out;
                        }
                        return node;
                    };
                    return walk(s);
                });
                snapshot = reviveBytes(snapshot);
            } catch (err) {
                console.log(`FAIL  ${rel}\n      ✗ 브라우저 변환 실패: ${err.message || err}`);
                failed++;
                continue;
            }

            if (!snapshot) {
                console.log(`FAIL  ${rel}\n      ✗ 브라우저에서 IR/옵션 스냅샷을 얻지 못했습니다(window.__tohwpxDebug.lastRender 없음).`);
                failed++;
                continue;
            }

            let nodeBytes;
            try {
                ({ bytes: nodeBytes } = await irToHwpx(snapshot.ir, snapshot.options));
            } catch (err) {
                console.log(`FAIL  ${rel}\n      ✗ Node 코어 렌더 실패: ${err.message || err}`);
                failed++;
                continue;
            }

            const webMap = await zipEntries(webBytes);
            const nodeMap = await zipEntries(Buffer.from(nodeBytes));
            const { issues, identical, total } = compareEntries(webMap, nodeMap);

            const ok = issues.length === 0;
            console.log(`${ok ? 'PASS' : 'FAIL'}  ${path.basename(rel)}`);
            console.log(`      엔트리 ${identical}/${total} 내용 동일 · 웹 ${webBytes.length}B / Node ${nodeBytes.length}B`);
            for (const i of issues) console.log(`      ✗ ${i}`);
            if (!ok) failed++;
        }
    });

    console.log(`\n${FIXTURES.length - failed}/${FIXTURES.length} 통과`);
    if (failed) {
        console.error('\n코어 동등성 실패 — 웹앱과 코어가 갈라졌다. 릴리스하지 않는다.');
        process.exit(1);
    }
    console.log('웹앱과 Node 코어가 같은 HWPX를 만든다.');
})().catch(err => {
    console.error('게이트 실행 실패:', err.message || err);
    process.exit(1);
});
