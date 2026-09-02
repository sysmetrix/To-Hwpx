/* ===================================================================
 * [tests/make-pdf-fixtures.js] PDF 검사 픽스처 생성
 * ===================================================================
 * 실행: node tests/make-pdf-fixtures.js
 *
 * PDF 추론이 맞는지 보려면 **정답을 아는 PDF**가 필요하다. 그래서 구조를
 * 우리가 정확히 아는 HTML에서 생성한다. 여기 HTML과 qa/pdf-gate.js의
 * 기대값은 짝이다 — 한쪽을 고치면 다른 쪽도 고쳐야 한다.
 *
 * 만드는 것
 *   qa/fixtures/sample.pdf        기본 구조(제목 3단계·목록·머리행 있는 표)
 *   tests/fixtures/gov-plan.pdf   실제 공문서를 닮은 2쪽 문서
 *                                 (머리행 근거가 있는 표 + 없는 표를 함께 둔다)
 *   tests/fixtures/blank-scan.pdf 글자 레이어가 없는 PDF
 *                                 (스캔 PDF를 조용히 빈 문서로 만들지 않는지 확인)
 * ===================================================================*/

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

const BASE_CSS = `
  body{font-family:'Malgun Gothic',sans-serif;margin:25mm;line-height:1.7}
  table{border-collapse:collapse;width:100%}
  td,th{border:1px solid #333;padding:6px}
`;

/** 기본 구조 — 제목 크기 3단계, 목록, 머리행이 굵은 표. */
const SAMPLE_HTML = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><style>${BASE_CSS}
  h1{font-size:24pt}h2{font-size:18pt}h3{font-size:14pt}p,li,td,th{font-size:11pt}
</style></head><body>
<h1>PDF 추출 검증 문서</h1>
<p>첫 번째 문단입니다. 한글과 English가 섞여 있고 문장이 길어져서 자동으로 줄바꿈이 일어나도록 충분히 긴 내용을 담고 있습니다.</p>
<h2>2단계 제목</h2>
<p>두 번째 문단입니다.</p>
<ul><li>목록 항목 하나</li><li>목록 항목 둘</li></ul>
<h3>3단계 제목</h3>
<table><thead><tr><th>이름</th><th>점수</th><th>비고</th></tr></thead>
<tbody><tr><td>홍길동</td><td>95</td><td>우수</td></tr>
<tr><td>김영희</td><td>88</td><td>양호</td></tr></tbody></table>
<p>표 다음 문단입니다.</p>
</body></html>`;

/**
 * 공문서를 닮은 2쪽 문서.
 * 표 두 개를 일부러 다르게 둔다 — 하나는 th(글꼴이 다름)로 머리행 근거가 있고,
 * 하나는 td만 써서 근거가 없다. 파서가 **근거 없이 머리행을 주장하는지**를 본다.
 */
const GOV_HTML = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><style>${BASE_CSS}
  body{font-family:'Malgun Gothic',serif;margin:20mm;line-height:1.8;font-size:11pt}
  h1{font-size:20pt;text-align:center}h2{font-size:14pt;margin-top:1.5em}
  td,th{border:1px solid #000;padding:5px 8px;font-size:10pt}
  .right{text-align:right}.note{font-size:9pt;color:#555}
</style></head><body>
<h1>2026년도 사업 추진 계획</h1>
<h2>1. 추진 배경</h2>
<p>본 계획은 행정업무운영 및 혁신에 관한 규정 개정에 따라 개방형 문서 형식 전환을 추진하기 위하여 수립되었습니다. 각 부서는 아래 일정에 따라 협조하여 주시기 바랍니다.</p>
<h2>2. 추진 일정</h2>
<table><thead><tr><th>단계</th><th>기간</th><th>담당</th><th>비고</th></tr></thead><tbody>
<tr><td>1단계</td><td>2026.05~06</td><td>기획팀</td><td>현황 조사</td></tr>
<tr><td>2단계</td><td>2026.07~09</td><td>전산팀</td><td>시스템 전환</td></tr>
<tr><td>3단계</td><td>2026.10~</td><td>전 부서</td><td>전면 시행</td></tr>
</tbody></table>
<h2>3. 세부 사항</h2>
<p>가. 전환 대상은 온나라 문서시스템에 첨부되는 모든 문서로 합니다.</p>
<p>나. 기존 hwp 파일은 2026년 10월부터 첨부가 제한됩니다.</p>
<p class="note">※ 문의: 기획팀 (내선 1234)</p>
<div style="page-break-before:always"></div>
<h2>4. 예산 내역</h2>
<table><tbody>
<tr><td>항목</td><td class="right">금액(천원)</td></tr>
<tr><td>시스템 구축</td><td class="right">120,000</td></tr>
<tr><td>교육 운영</td><td class="right">35,000</td></tr>
<tr><td>합계</td><td class="right">155,000</td></tr>
</tbody></table>
<p>예산은 확정 예산 기준이며 집행 과정에서 변경될 수 있습니다.</p>
</body></html>`;

/** 글자 레이어가 없는 PDF — 도형만 그린다(스캔 PDF의 최소 재현). */
const BLANK_HTML = `<!doctype html><html><head><meta charset="utf-8"><style>
  body{margin:0}
  .box{width:180mm;height:240mm;margin:15mm;background:linear-gradient(120deg,#e8e8e8,#cfcfcf)}
</style></head><body><div class="box"></div></body></html>`;

async function render(page, html, outPath) {
    await page.setContent(html, { waitUntil: 'networkidle' });
    const pdf = await page.pdf({ format: 'A4', printBackground: true });
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, pdf);
    console.log(`  ${path.relative(ROOT, outPath)} (${pdf.length.toLocaleString()}B)`);
}

(async () => {
    let chromium;
    try {
        ({ chromium } = require('playwright'));
    } catch {
        console.error('playwright가 필요합니다. `npm i` 후 `npx playwright install chromium`을 실행하세요.');
        process.exit(1);
    }

    console.log('PDF 픽스처 생성 중…');
    const browser = await chromium.launch();
    const page = await browser.newPage();
    try {
        await render(page, SAMPLE_HTML, path.join(ROOT, 'qa/fixtures/sample.pdf'));
        await render(page, GOV_HTML, path.join(ROOT, 'tests/fixtures/gov-plan.pdf'));
        await render(page, BLANK_HTML, path.join(ROOT, 'tests/fixtures/blank-scan.pdf'));
    } finally {
        await browser.close();
    }
    console.log('완료. 기대값은 qa/pdf-gate.js에 있습니다 — 픽스처를 바꾸면 함께 고치세요.');
})().catch(err => {
    console.error('픽스처 생성 실패:', err.message || err);
    process.exit(1);
});
