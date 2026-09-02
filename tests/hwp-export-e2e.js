/* ===================================================================
 * [tests/hwp-export-e2e.js] 역방향 내보내기 UI 종단 검사
 * ===================================================================
 * 실행: node tests/hwp-export-e2e.js
 *
 * qa/reverse-export-gate.js는 엔진 수준(HWPX 바이트 → HWP 바이트)만 본다.
 * 이 테스트는 그 위의 UI 계약을 본다 — 사용자가 실제로 버튼을 눌러
 * 파일을 손에 넣을 수 있는지, 그리고 화면에 적히는 문구가 사실인지.
 *
 * 검사 항목
 *   ① 변환 성공 후 "HWP로도 받기" 버튼이 결과 카드에 노출된다
 *   ② 버튼을 누르면 HWP 다운로드 링크와 요약 문구가 생긴다
 *   ③ 내려받은 파일이 실제 HWP 5.0(CFB) 바이너리다
 *   ④ 파일명이 .hwpx가 아니라 .hwp로 바뀌어 있다
 *   ⑤ 그 과정에서 페이지 오류가 발생하지 않는다
 *
 * ⚠ 역방향은 선택 기능이다. 이 테스트가 실패해도 HWPX 생성 자체는
 *    별개로 동작해야 한다(회귀 판단 시 두 축을 섞지 말 것).
 * ===================================================================*/

'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { withConverter } = require('../qa/lib/browser-convert.js');

const CFB_SIGNATURE = 'd0cf11e0a1b11ae1';
const FIXTURE = 'qa/fixtures/md_hwpx_test.md';

(async () => {
    const failures = [];
    const note = (ok, label, detail = '') => {
        console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
        if (!ok) failures.push(label);
    };

    await withConverter(async (convert, ctx) => {
        const { page } = ctx;

        await convert(FIXTURE);

        // ① 버튼 노출
        const btn = page.locator('#export-hwp-btn');
        await btn.waitFor({ timeout: 15000 });
        note(await btn.count() === 1, '① 결과 카드에 HWP 내보내기 버튼 노출');

        // ② 버튼 클릭 → 링크 + 요약 문구
        const downloadPromise = page.waitForEvent('download', { timeout: 90000 });
        await btn.click();
        await page.waitForSelector('.hwp-export-done a', { timeout: 90000 });

        const meta = (await page.textContent('.hwp-export-meta') || '').trim();
        note(meta.length > 0, '② 변환 요약 문구 표시', meta);

        // 요약은 사실이어야 한다 — 손실 건수를 적었다면 숫자가 있어야 한다
        const claimsNoLoss = /손실 항목은 없습니다/.test(meta);
        const claimsLoss = /손실 \d+건/.test(meta);
        note(claimsNoLoss || claimsLoss || /확인 불가|보고서를 주지 않았습니다/.test(meta),
            '② 요약 문구가 손실 상태를 명시', claimsNoLoss ? '손실 없음' : claimsLoss ? '손실 보고됨' : '엔진 미보고');

        // ④ 파일명 확장자
        const downloadName = await page.getAttribute('.hwp-export-done a', 'download');
        note(/\.hwp$/i.test(downloadName || '') && !/\.hwpx$/i.test(downloadName || ''),
            '④ 다운로드 파일명이 .hwp', downloadName);

        // ③ 실제 바이너리 확인
        await page.click('.hwp-export-done a');
        const dl = await downloadPromise;
        const outPath = path.join(os.tmpdir(), `tohwpx_e2e_${process.pid}.hwp`);
        await dl.saveAs(outPath);
        const bytes = fs.readFileSync(outPath);
        fs.unlinkSync(outPath);
        const sig = bytes.subarray(0, 8).toString('hex');
        note(sig === CFB_SIGNATURE, '③ HWP 5.0(CFB) 시그니처', `${sig}, ${bytes.length}B`);
        note(bytes.length > 1024, '③ 산출물 크기가 유효', `${bytes.length}B`);

        // ⑤ 페이지 오류 없음
        note(ctx.pageErrors.length === 0, '⑤ 페이지 오류 없음',
            ctx.pageErrors.length ? ctx.pageErrors.join(' | ') : '없음');
    });

    console.log('');
    if (failures.length) {
        console.error(`역방향 UI 종단 검사 실패 ${failures.length}건: ${failures.join(', ')}`);
        process.exit(1);
    }
    console.log('역방향 UI 종단 검사 통과. 시각 확인은 한컴에서 별도로 해야 한다.');
})().catch(err => {
    console.error('테스트 실행 실패:', err.message || err);
    process.exit(1);
});
