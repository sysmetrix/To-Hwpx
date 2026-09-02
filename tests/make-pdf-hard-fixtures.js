/* ===================================================================
 * [tests/make-pdf-hard-fixtures.js] PDF 어려운 케이스 픽스처
 * ===================================================================
 * 실행: node tests/make-pdf-hard-fixtures.js [--force]
 *
 * 기존 픽스처 3개(sample·gov-plan·blank-scan)는 **쉬운 문서**다. 제목 크기가
 * 뚜렷하고, 표는 열 간격이 넓고, 서식도 그림도 없다. 거기서 100%가 나온다고
 * PDF 변환이 100%인 것은 아니다.
 *
 * 여기 픽스처는 **일부러 어려운 것만** 모았다. 실제 문서에서 변환이 무너지는
 * 지점이고, 하나하나가 지금 구현이 못 하는 것을 정확히 겨눈다.
 *
 *   styled     굵게·기울임·색 — 지금은 전부 평문으로 떨어진다
 *   picture    본문에 낀 그림 — 지금은 통째로 사라진다
 *   merged     병합 셀(rowspan/colspan) — 격자가 어긋난다
 *   ruled      열 간격이 좁은 괘선 표 — 공백 클러스터링이 열을 못 나눈다
 *   twocol     2단 편집 — 읽기 순서가 좌우로 섞인다
 *   hyphen     영문 하이픈 줄바꿈 + 합자(ﬁ/ﬂ)
 *   runhead    쪽마다 반복되는 머리말·꼬리말·쪽번호
 *   korean     실제 공문서를 닮은 한글 문서(항목 기호 계층)
 *
 * 정답은 qa/pdf-fidelity-gate.js에 함께 적는다.
 * ===================================================================*/

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const FORCE = process.argv.includes('--force');

const CSS = `
  body{font-family:'Malgun Gothic',sans-serif;margin:20mm;line-height:1.7;font-size:11pt}
  h1{font-size:22pt}h2{font-size:15pt}
  table{border-collapse:collapse;width:100%}
  td,th{border:1px solid #333;padding:5px;font-size:11pt}
`;

/** 1×1 빨강 PNG(투명 아님) — 그림이 살아 왔는지 확인용. */
const RED_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const FIXTURES = [
    {
        name: 'pdf-styled.pdf',
        html: `<h1>서식 보존 검증</h1>
<p>이 문단에는 <b>굵은 글자</b>와 <i>기울인 글자</i>가 있습니다.</p>
<p>그리고 <span style="color:#c00000">빨간 글자</span>와 <b><i>굵고 기울인 글자</i></b>도 있습니다.</p>
<p>보통 문단입니다.</p>`,
    },
    {
        name: 'pdf-picture.pdf',
        html: `<h1>그림 포함 문서</h1>
<p>아래에 그림이 하나 있습니다.</p>
<p><img src="${RED_PNG}" width="120" height="80" alt="빨간 사각형"></p>
<p>그림 다음 문단입니다.</p>`,
    },
    {
        name: 'pdf-merged.pdf',
        html: `<h1>병합 셀 표</h1>
<table>
<tr><th colspan="3">2026년 예산 총괄</th></tr>
<tr><th>구분</th><th>상반기</th><th>하반기</th></tr>
<tr><td rowspan="2">사업비</td><td>120</td><td>140</td></tr>
<tr><td>130</td><td>150</td></tr>
</table>`,
    },
    {
        name: 'pdf-ruled.pdf',
        // 열 사이 간격을 일부러 좁힌다 — 공백만으로는 열을 나눌 수 없다.
        html: `<h1>좁은 괘선 표</h1>
<table style="width:auto">
<tr><th style="padding:1px 2px">A</th><th style="padding:1px 2px">B</th><th style="padding:1px 2px">C</th></tr>
<tr><td style="padding:1px 2px">1</td><td style="padding:1px 2px">2</td><td style="padding:1px 2px">3</td></tr>
<tr><td style="padding:1px 2px">4</td><td style="padding:1px 2px">5</td><td style="padding:1px 2px">6</td></tr>
</table>`,
    },
    {
        name: 'pdf-twocol.pdf',
        html: `<h1>2단 편집 문서</h1>
<div style="column-count:2;column-gap:12mm">
<p>왼쪽 단의 첫 문장입니다. 이 문단은 왼쪽 단을 채우기 위해 충분히 길게 작성되었으며 읽기 순서가 위에서 아래로 이어져야 합니다.</p>
<p>왼쪽 단의 두 번째 문장입니다. 역시 길게 이어집니다.</p>
<p>오른쪽 단으로 넘어간 문장입니다. 왼쪽 단을 모두 읽은 뒤에 나와야 합니다.</p>
<p>오른쪽 단의 마지막 문장입니다.</p>
</div>`,
    },
    {
        name: 'pdf-hyphen.pdf',
        html: `<h1>Hyphenation and Ligatures</h1>
<p style="width:52mm;text-align:justify;hyphens:auto" lang="en">The organization published a comprehensive international documentation framework describing extraordinary implementation requirements.</p>
<p>Ligature test: office, film, flow, difficult, affluent.</p>`,
    },
    {
        name: 'pdf-runhead.pdf',
        // 진짜 머리말·꼬리말은 **쪽마다 똑같은 높이**에 찍힌다. CSS로
        // `page-break-after`와 `position:absolute`를 써서 흉내 내면 쪽마다
        // y가 달라져(실측 57pt 차이) 실제 현상을 재현하지 못한다.
        // 그래서 Chrome의 머리말/꼬리말 템플릿을 쓴다 — 이게 진짜 쪽 장식이다.
        html: `<h1>반복 머리말 문서</h1><p>1쪽 본문입니다.</p>
<div style="page-break-after:always"></div>
<h2>둘째 쪽</h2><p>2쪽 본문입니다.</p>`,
        pdfOptions: {
            displayHeaderFooter: true,
            headerTemplate: '<div style="font-size:9px;width:100%;text-align:center;color:#888">내부 검토용 · 배포 금지</div>',
            footerTemplate: '<div style="font-size:9px;width:100%;text-align:center;color:#888">- <span class="pageNumber"></span> -</div>',
            margin: { top: '20mm', bottom: '20mm', left: '20mm', right: '20mm' },
        },
    },
    {
        name: 'pdf-korean-gov.pdf',
        html: `<h1>공공기관 문서 표준화 추진계획</h1>
<p>1. 추진 배경</p>
<p style="margin-left:2em">가. 「행정업무의 운영 및 혁신에 관한 규정」에 따라 문서 서식을 통일할 필요가 있음</p>
<p style="margin-left:4em">1) 기관별 서식이 제각각이어서 검색과 보존이 어려움</p>
<p style="margin-left:4em">2) 2026년 10월부터 hwp 첨부가 제한됨</p>
<p style="margin-left:2em">나. HWPX 전환이 불가피함</p>
<p>2. 추진 방향</p>
<p style="margin-left:2em">가. 단계적 전환</p>
<table><tr><th>단계</th><th>기간</th><th>내용</th></tr>
<tr><td>1단계</td><td>2026.05~06</td><td>현황 조사</td></tr>
<tr><td>2단계</td><td>2026.07~09</td><td>서식 정비</td></tr></table>`,
    },
];

async function render(page, html, outPath, pdfOptions) {
    if (!FORCE && fs.existsSync(outPath)) {
        console.log(`  ${path.relative(ROOT, outPath)} (있음 — 건너뜀)`);
        return;
    }
    const full = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><style>${CSS}</style></head><body>${html}</body></html>`;
    await page.setContent(full, { waitUntil: 'networkidle' });
    const pdf = await page.pdf({ format: 'A4', printBackground: true, ...(pdfOptions || {}) });
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
    console.log(FORCE ? 'PDF 어려운 픽스처 강제 재생성 중…' : 'PDF 어려운 픽스처 확인 중…');
    const browser = await chromium.launch();
    const page = await browser.newPage();
    try {
        for (const f of FIXTURES) {
            await render(page, f.html, path.join(ROOT, 'tests/fixtures', f.name), f.pdfOptions);
        }
    } finally {
        await browser.close();
    }
    console.log('완료. 기대값은 qa/pdf-fidelity-gate.js에 있습니다.');
})().catch(err => {
    console.error('픽스처 생성 실패:', err.message || err);
    process.exit(1);
});
