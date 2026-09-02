/* ===================================================================
 * [reverse-export-gate.js] 역방향 내보내기 게이트 (HWPX → HWP)
 * ===================================================================
 * 실행:  node qa/reverse-export-gate.js [파일.hwpx ...]
 *        인자가 없으면 qa/samples/*.hwpx 전체를 검사한다.
 *        --fixtures  : qa/fixtures의 대표 입력을 실제 브라우저로 변환한 뒤 검사한다
 *                      (표·링크·그림·목록이 든 문서까지 커버 — playwright 필요)
 *
 * 이 게이트가 확인하는 것 ─ 구조만 본다. 렌더링은 못 본다.
 *   ① HWP 산출물이 CFB(OLE2) 시그니처를 갖는가
 *   ② rhwp가 보고하는 content-loss가 0인가
 *   ③ 자기 재로드 후 페이지 수가 유지되는가 (pageCountBefore === pageCountAfter)
 *   ④ HWPX 본문 텍스트가 HWP 왕복 후에도 문단 단위로 동일한가
 *   ⑤ 렌더된 페이지의 그림(<image>)·글자(<text>) 개수가 유지되는가
 *
 * ④⑤가 이 게이트의 핵심이다. ①~③은 엔진의 자기 보고이므로 엔진이 놓친
 * 손실은 잡지 못한다. 실제로 개발 중 "그림이 사라진 것처럼 보이는데
 * content-loss는 0"인 상황을 만났고, 렌더 비교(⑤)로만 진위를 가릴 수 있었다.
 * 이 프로젝트의 황금률("구조 통과 ≠ 한컴에서 보임")을 자동으로 좁히는 부분이다.
 *
 * ⚠ 그래도 통과가 시각 통과는 아니다. rhwp 렌더러와 한컴 렌더러는 다르다.
 *    릴리스 전 한컴에서 눈으로 확인해야 한다.
 * ===================================================================*/

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const ROOT = path.resolve(__dirname, '..');
const VENDOR = path.join(ROOT, 'js/vendor/rhwp-core-0.8.4');

const CFB_SIGNATURE = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);

/** rhwp는 web 타깃 wasm-bindgen 모듈이라 Node에서는 initSync로 직접 넣는다. */
async function loadRhwp() {
    const mod = await import(pathToFileURL(path.join(VENDOR, 'rhwp.js')).href);
    mod.initSync({ module: fs.readFileSync(path.join(VENDOR, 'rhwp_bg.wasm')) });
    return mod;
}

/** 문서 전체 본문을 문단 배열로 뽑는다(표 안 문단은 엔진이 자체 순회에 포함). */
function paragraphTexts(doc) {
    const out = [];
    const sections = doc.getSectionCount();
    for (let s = 0; s < sections; s++) {
        const paras = doc.getParagraphCount(s);
        for (let p = 0; p < paras; p++) {
            const len = doc.getParagraphLength(s, p);
            out.push(len > 0 ? doc.getTextRange(s, p, 0, len) : '');
        }
    }
    return out;
}

/** 비교용 정규화 — 줄바꿈/공백 표현 차이는 손실이 아니다. */
function normalizeForCompare(list) {
    return list.join('\n').replace(/\s+/g, ' ').trim();
}

/**
 * 문서를 페이지별 SVG로 렌더해 시각 요소를 계수한다.
 *
 * ⚠ HwpViewer는 생성 시 HwpDocument의 소유권을 가져간다. viewer.free() 뒤에
 *   doc.free()를 부르면 이중 해제로 WASM 프로세스가 죽는다. 뷰어를 만들었으면
 *   뷰어만 해제한다.
 */
function renderStats(mod, bytes) {
    const doc = new mod.HwpDocument(new Uint8Array(bytes));
    let viewer;
    try {
        viewer = new mod.HwpViewer(doc);
    } catch (err) {
        doc.free();
        throw err;
    }
    try {
        const pageCount = viewer.pageCount();
        let images = 0, texts = 0;
        for (let i = 0; i < pageCount; i++) {
            const svg = viewer.renderPageSvg(i);
            images += (svg.match(/<image\b/g) || []).length;
            texts += (svg.match(/<text\b/g) || []).length;
        }
        return { pageCount, images, texts };
    } finally {
        viewer.free();
    }
}

function checkOne(mod, filePath, providedBytes = null) {
    const issues = [];
    const bytes = providedBytes || fs.readFileSync(filePath);

    const src = new mod.HwpDocument(new Uint8Array(bytes));
    let before, verifyRaw, hwpBytes, lossRaw;
    try {
        before = paragraphTexts(src);
        try {
            verifyRaw = src.exportHwpVerify();
        } catch (err) {
            issues.push(`exportHwpVerify 실패: ${err.message || err}`);
        }
        const result = src.exportHwpWithReport();
        try {
            lossRaw = result.contentLoss();
            hwpBytes = Buffer.from(result.takeBytes());
        } finally {
            result.free();
        }
    } finally {
        src.free();
    }

    // ① CFB 시그니처
    if (!hwpBytes || hwpBytes.length < 8 || !hwpBytes.subarray(0, 8).equals(CFB_SIGNATURE)) {
        issues.push(`HWP 시그니처 불일치: ${hwpBytes ? hwpBytes.subarray(0, 8).toString('hex') : '(빈 결과)'}`);
    }

    // ② content-loss
    let loss = null;
    try {
        loss = JSON.parse(lossRaw);
        if (loss.count > 0) {
            issues.push(`content-loss ${loss.count}건: ${JSON.stringify(loss.losses).slice(0, 200)}`);
        }
    } catch {
        issues.push('content-loss 보고서를 해석하지 못했습니다.');
    }

    // ③ 페이지 수 유지
    let verify = null;
    try {
        verify = JSON.parse(verifyRaw);
        if (verify.pageCountBefore !== verify.pageCountAfter) {
            issues.push(`페이지 수 변동 ${verify.pageCountBefore} → ${verify.pageCountAfter}`);
        }
    } catch {
        if (verifyRaw !== undefined) issues.push('검증 보고서를 해석하지 못했습니다.');
    }

    // ④ 왕복 텍스트 동일성 — 우리가 독립적으로 재는 값
    let after = [];
    if (hwpBytes && hwpBytes.length >= 8) {
        const rt = new mod.HwpDocument(new Uint8Array(hwpBytes));
        try {
            after = paragraphTexts(rt);
        } finally {
            rt.free();
        }
        const a = normalizeForCompare(before);
        const b = normalizeForCompare(after);
        if (a !== b) {
            const firstDiff = before.findIndex((t, i) => t !== (after[i] || ''));
            issues.push(
                `왕복 텍스트 불일치 (문단 ${before.length}→${after.length}, 글자 ${a.length}→${b.length}` +
                (firstDiff >= 0 ? `, 첫 차이 [${firstDiff}] "${(before[firstDiff] || '').slice(0, 40)}" → "${(after[firstDiff] || '').slice(0, 40)}"` : '') +
                ')'
            );
        }
    }

    // ⑤ 렌더 비교 — 엔진의 자기 보고가 놓치는 시각 손실을 잡는 유일한 검사
    let visualBefore = null, visualAfter = null;
    if (hwpBytes && hwpBytes.length >= 8) {
        try {
            visualBefore = renderStats(mod, bytes);
            visualAfter = renderStats(mod, hwpBytes);
            if (visualBefore.images !== visualAfter.images) {
                issues.push(`그림 개수 변동 ${visualBefore.images} → ${visualAfter.images}`);
            }
            if (visualBefore.pageCount !== visualAfter.pageCount) {
                issues.push(`렌더 페이지 수 변동 ${visualBefore.pageCount} → ${visualAfter.pageCount}`);
            }
            // 글자 조각 수는 줄바꿈 위치에 따라 미세하게 갈릴 수 있으므로
            // 완전 일치가 아니라 급감(10% 초과 감소)만 실패로 본다.
            if (visualBefore.texts > 0) {
                const drop = (visualBefore.texts - visualAfter.texts) / visualBefore.texts;
                if (drop > 0.1) {
                    issues.push(`글자 조각 급감 ${visualBefore.texts} → ${visualAfter.texts} (${Math.round(drop * 100)}% 감소)`);
                }
            }
        } catch (err) {
            issues.push(`렌더 검사 실패: ${err.message || err}`);
        }
    }

    return {
        file: path.basename(filePath),
        pass: issues.length === 0,
        issues,
        metrics: {
            inputBytes: bytes.length,
            hwpBytes: hwpBytes ? hwpBytes.length : 0,
            paragraphsBefore: before.length,
            paragraphsAfter: after.length,
            pageCount: verify ? verify.pageCountAfter : null,
            lossCount: loss ? loss.count : null,
            images: visualAfter ? visualAfter.images : null,
            imagesBefore: visualBefore ? visualBefore.images : null,
            texts: visualAfter ? visualAfter.texts : null,
        },
    };
}

/**
 * qa/fixtures의 대표 입력을 실제 브라우저로 변환해 HWPX 바이트를 만든다.
 * 표·링크·그림·목록·코드가 든 문서까지 역방향 검사에 넣기 위한 경로다.
 */
const FIXTURE_INPUTS = [
    'qa/fixtures/md_hwpx_test.md',
    'qa/fixtures/md_link_image_test.md',
    'qa/fixtures/sample.html',
    'qa/fixtures/sample.csv',
    'qa/fixtures/sample.json',
    'qa/fixtures/sample.ipynb',
    'qa/fixtures/sample.docx',
    'qa/fixtures/docx_table_test.docx',
    'qa/fixtures/docx_image_test.docx',
    'qa/fixtures/sample.pptx',
];

async function convertFixtures() {
    const { withConverter } = require('./lib/browser-convert.js');
    const out = [];
    await withConverter(async (convert) => {
        for (const rel of FIXTURE_INPUTS) {
            const abs = path.join(ROOT, rel);
            if (!fs.existsSync(abs)) { console.log(`  (건너뜀 — 없음) ${rel}`); continue; }
            try {
                const { bytes } = await convert(rel);
                out.push({ label: rel, bytes });
                console.log(`  변환 완료 ${rel} (${bytes.length}B)`);
            } catch (err) {
                console.log(`  변환 실패 ${rel}: ${err.message || err}`);
                out.push({ label: rel, bytes: null, convertError: err.message || String(err) });
            }
        }
    });
    return out;
}

async function main() {
    const useFixtures = process.argv.includes('--fixtures');
    const args = process.argv.slice(2).filter(a => !a.startsWith('--'));

    /** @type {{label:string, bytes:Buffer|null, convertError?:string}[]} */
    let targets = [];

    if (useFixtures) {
        console.log('픽스처를 실제 브라우저로 변환하는 중…');
        targets = await convertFixtures();
        console.log('');
    } else {
        let files = args;
        if (files.length === 0) {
            const dir = path.join(ROOT, 'qa/samples');
            files = fs.readdirSync(dir)
                .filter(f => f.toLowerCase().endsWith('.hwpx'))
                .map(f => path.join(dir, f));
        }
        targets = files.map(f => ({ label: f, bytes: null }));
    }

    if (targets.length === 0) {
        console.error('검사할 HWPX가 없습니다. qa/samples/*.hwpx를 먼저 생성하거나 --fixtures를 쓰세요.');
        process.exit(1);
    }

    const mod = await loadRhwp();
    console.log(`역방향 내보내기 게이트 — @rhwp/core ${mod.version()}\n`);

    let failed = 0;
    for (const t of targets) {
        let r;
        if (t.convertError) {
            r = { file: path.basename(t.label), pass: false, issues: [`HWPX 생성 실패: ${t.convertError}`], metrics: {} };
        } else {
            try {
                r = checkOne(mod, t.label, t.bytes);
            } catch (err) {
                r = { file: path.basename(t.label), pass: false, issues: [`예외: ${err.message || err}`], metrics: {} };
            }
        }
        const m = r.metrics;
        const summary = m.hwpBytes
            ? `${m.inputBytes}B → ${m.hwpBytes}B · 문단 ${m.paragraphsBefore}→${m.paragraphsAfter} · ${m.pageCount ?? '?'}쪽`
              + ` · 그림 ${m.imagesBefore ?? '?'}→${m.images ?? '?'} · 글자조각 ${m.texts ?? '?'} · 손실 ${m.lossCount ?? '?'}건`
            : '(산출물 없음)';
        console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.file}\n      ${summary}`);
        for (const i of r.issues) console.log(`      ✗ ${i}`);
        if (!r.pass) failed++;
    }

    console.log(`\n${targets.length - failed}/${targets.length} 통과`);
    if (failed > 0) {
        console.error('\n역방향 내보내기 게이트 실패 — 릴리스하지 않는다.');
        process.exit(1);
    }
    console.log('구조 검사 통과. 시각 확인은 한컴에서 별도로 해야 한다.');
}

main().catch(err => {
    console.error('게이트 실행 실패:', err);
    process.exit(1);
});
