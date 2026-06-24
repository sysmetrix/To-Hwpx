'use strict';

const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const JSZip = require('jszip');
const { chromium } = require('playwright');
const { buildDocx } = require('./make-docx-fixture');

const ROOT = path.resolve(__dirname, '..');
const FIXTURES = path.join(__dirname, 'fixtures');
const PORT = 8732;

const CASES = [
  {
    name: 'markdown',
    file: 'sample.md',
    format: 'MD',
    previewPaper: 'A3',
    previewOrientation: 'landscape',
    minTables: 1,
    mustContain: [
      'Golden Markdown 제목 Alpha',
      '첫 문단입니다',
      'English Alpha',
      '특수문자',
      '목록 항목 하나',
      '표 값 한글',
      'console.log',
      'Quoted Alpha line',
      'bold quote',
      '링크 텍스트',
      "작은따옴표 회귀: don't, 사용자의 '문서', ",
      "it's bold",
      '문장 안의 ',
      '인라인 코드',
      '는 앞뒤 문장과 같은 문단에 자연스럽게 이어집니다.',
      '단독 코드 문단',
    ],
    mustNotContain: ['▶ Quoted Alpha line'],
    rawMustContain: ["don't", "사용자의 '문서'", "it's bold"],
    rawMustNotContain: ['&apos;'],
  },
  {
    name: 'html',
    file: 'sample.html',
    format: 'HTML',
    minTables: 1,
    mustContain: [
      'Golden HTML 제목 Alpha',
      'HTML 하위 제목 Beta',
      '첫 문단입니다',
      '굵은 텍스트',
      '기울임 텍스트',
      '비순서 목록 하나',
      '순서 목록 첫째',
      '표 값 한글',
      'HTML Quote Alpha',
    ],
    mustNotContain: ['▶ HTML Quote Alpha'],
  },
  {
    name: 'csv',
    file: 'sample.csv',
    format: 'CSV',
    minTables: 1,
    mustContain: [
      '구분',
      'CSV 제목',
      '표 값 한글',
      'English Cell',
      '빈 셀',
      '긴 텍스트',
      'long text wraps safely',
    ],
  },
  {
    name: 'long-table',
    file: 'long-table.csv',
    format: 'CSV',
    minTables: 1,
    mustContain: [
      '긴 표 제목',
      '첫 번째 행',
      '마지막 행',
    ],
  },
  {
    name: 'json',
    file: 'sample.json',
    format: 'JSON',
    minTables: 1,
    mustContain: [
      'Golden JSON 제목 Alpha',
      'paragraph',
      '첫 문단입니다',
      'English Alpha',
      '목록 항목 하나',
      '표 값 한글',
      'long text wraps safely',
    ],
  },
  {
    name: 'ipynb',
    file: 'sample.ipynb',
    format: 'IPYNB',
    minTables: 1,
    mustContain: [
      'Golden IPYNB 제목 Alpha',
      '첫 문단입니다',
      '목록 항목 하나',
      '표 값 한글',
      '코드 셀 Alpha',
      '출력 텍스트 Output Alpha',
    ],
  },
  {
    name: 'docx',
    file: 'sample.docx',
    format: 'DOCX',
    minTables: 1,
    mustContain: [
      'Golden DOCX 제목 Alpha',
      'DOCX 하위 제목 Beta',
      '첫 문단입니다',
      'English Alpha',
      '굵은 텍스트',
      '기울임 텍스트',
      '목록 항목 하나',
      '표 값 한글',
      'long text wraps safely',
    ],
  },
];

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.md': 'text/markdown; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.ipynb': 'application/x-ipynb+json; charset=utf-8',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.ttf': 'font/ttf',
  '.png': 'image/png',
};

function serve() {
  return new Promise(resolve => {
    const srv = http.createServer((req, res) => {
      let urlPath = decodeURIComponent(req.url.split('?')[0]);
      if (urlPath === '/') urlPath = '/index.html';
      const filePath = path.normalize(path.join(ROOT, urlPath));
      if (!filePath.startsWith(ROOT)) {
        res.writeHead(403);
        res.end('403');
        return;
      }
      fs.readFile(filePath, (err, data) => {
        if (err) {
          res.writeHead(404);
          res.end('404');
          return;
        }
        res.writeHead(200, { 'Content-Type': TYPES[path.extname(filePath)] || 'application/octet-stream' });
        res.end(data);
      });
    });
    srv.listen(PORT, '127.0.0.1', () => resolve(srv));
  });
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function decodeXmlText(value) {
  return String(value || '')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function extractHpText(xml) {
  return [...xml.matchAll(/<hp:t(?:\s[^>]*)?>([\s\S]*?)<\/hp:t>/g)]
    .map(match => decodeXmlText(match[1]))
    .join('\n');
}

async function validateHwpxPackage(page, zip, testCase) {
  const required = [
    'META-INF/container.xml',
    'META-INF/manifest.xml',
    'META-INF/container.rdf',
    'Contents/header.xml',
    'Contents/section0.xml',
    'Contents/content.hpf',
    'Preview/PrvText.txt',
  ];

  assert(zip.file('mimetype'), `${testCase.name}: mimetype 엔트리 없음`);
  const mimetype = await zip.file('mimetype').async('string');
  assert(mimetype.trim() === 'application/hwp+zip', `${testCase.name}: mimetype 내용 불일치`);

  for (const entry of required) {
    assert(zip.file(entry), `${testCase.name}: 필수 엔트리 누락 ${entry}`);
  }

  const headerXml = await zip.file('Contents/header.xml').async('string');
  const sectionXml = await zip.file('Contents/section0.xml').async('string');
  assert(sectionXml.includes('hancom.co.kr/hwpml/2011/section'), `${testCase.name}: section namespace 누락`);
  assert(sectionXml.includes('hancom.co.kr/hwpml/2011/paragraph'), `${testCase.name}: paragraph namespace 누락`);
  assert(headerXml.includes('hancom.co.kr/hwpml/2011/head'), `${testCase.name}: header namespace 누락`);

  const sectionWellFormed = await page.evaluate(xml => {
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    return !doc.querySelector('parsererror');
  }, sectionXml);
  assert(sectionWellFormed, `${testCase.name}: section0.xml 파싱 오류`);

  const text = extractHpText(sectionXml);
  for (const expected of testCase.mustContain) {
    assert(text.includes(expected), `${testCase.name}: 텍스트 누락 "${expected}"`);
  }
  for (const unexpected of (testCase.mustNotContain || [])) {
    assert(!text.includes(unexpected), `${testCase.name}: 예전 인용구 마커가 남음 "${unexpected}"`);
  }
  for (const expected of (testCase.rawMustContain || [])) {
    assert(sectionXml.includes(expected), `${testCase.name}: section0.xml 원문 누락 "${expected}"`);
  }
  for (const unexpected of (testCase.rawMustNotContain || [])) {
    assert(!sectionXml.includes(unexpected), `${testCase.name}: section0.xml에 금지된 XML 엔티티가 남음 "${unexpected}"`);
  }

  const tableCount = (sectionXml.match(/<hp:tbl\b/g) || []).length;
  assert(tableCount >= testCase.minTables, `${testCase.name}: 표 개수 부족 (${tableCount} < ${testCase.minTables})`);
  if (testCase.name === 'markdown') {
    const inlineCodePara = [...sectionXml.matchAll(/<hp:p\b[\s\S]*?<\/hp:p>/g)]
      .map(match => match[0])
      .find(para => para.includes('문장 안의 ') && para.includes('인라인 코드')
        && para.includes('는 앞뒤 문장과 같은 문단에 자연스럽게 이어집니다.'));
    assert(inlineCodePara, `${testCase.name}: 인라인 코드가 앞뒤 문장과 다른 문단으로 분리됨`);
    assert(/charPrIDRef="6"><hp:t>인라인 코드<\/hp:t>/.test(inlineCodePara),
      `${testCase.name}: 인라인 코드 런에 코드 글자 모양이 적용되지 않음`);
    assert(sectionXml.includes('<hp:t xml:space="preserve">단독 코드 문단</hp:t>'),
      `${testCase.name}: 단독 코드 문단의 기존 코드 블록 표현이 유지되지 않음`);
  }
  const dataTables = [...sectionXml.matchAll(/<hp:tbl\b[\s\S]*?<\/hp:tbl>/g)]
    .map(match => match[0])
    .filter(table => /<hp:tbl\b[^>]*\brepeatHeader="1"/.test(table));
  assert(dataTables.length >= 1, `${testCase.name}: 일반 데이터 표를 찾지 못함`);
  for (const table of dataTables) {
    const tableOpen = (/<hp:tbl\b[^>]*>/.exec(table) || [])[0] || '';
    const posOpen = (/<hp:pos\b[^>]*\/>/.exec(table) || [])[0] || '';
    const firstRow = (/<hp:tr>[\s\S]*?<\/hp:tr>/.exec(table) || [])[0] || '';
    const headerFlags = [...firstRow.matchAll(/<hp:tc\b[^>]*\bheader="([^"]+)"/g)].map(match => match[1]);
    assert(/\bpageBreak="TABLE"/.test(tableOpen), `${testCase.name}: 일반 표 여러 쪽 지원이 '나눔(TABLE)'이 아님`);
    assert(/\brepeatHeader="1"/.test(tableOpen), `${testCase.name}: 일반 표 제목 줄 자동 반복이 꺼져 있음`);
    assert(/\btreatAsChar="0"/.test(posOpen), `${testCase.name}: 일반 표가 글자처럼 취급됨`);
    assert(/\bflowWithText="1"/.test(posOpen), `${testCase.name}: 일반 표가 본문 흐름을 따르지 않음`);
    assert(/\bhorzRelTo="COLUMN"/.test(posOpen), `${testCase.name}: 일반 표 가로 기준이 단(COLUMN)이 아님`);
    assert(/\bhorzAlign="RIGHT"/.test(posOpen), `${testCase.name}: 일반 표가 단 오른쪽 정렬이 아님`);
    assert(headerFlags.length > 0 && headerFlags.every(flag => flag === '1'),
      `${testCase.name}: 일반 표 첫 행이 제목 셀로 지정되지 않음`);
  }
  if (testCase.name === 'markdown' || testCase.name === 'html') {
    assert(headerXml.includes('<hh:paraPr id="19"'), `${testCase.name}: 인용구 문단 모양 paraPr id=19 누락`);
    assert(headerXml.includes('<hh:borderFill id="19"'), `${testCase.name}: 인용구 borderFill id=19 누락`);
    assert(sectionXml.includes('paraPrIDRef="19"'), `${testCase.name}: 인용구 문단 paraPrIDRef=19 누락`);
  }
}

async function runCase(page, testCase) {
  const inputPath = path.join(FIXTURES, testCase.file);
  assert(fs.existsSync(inputPath), `${testCase.name}: fixture 없음 ${inputPath}`);

  await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.JSZip && window.marked && window.XLSX, null, { timeout: 30000 });
  if (testCase.previewPaper) {
    await page.locator('#paper-size').evaluate((el, value) => {
      el.value = value;
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }, testCase.previewPaper);
  }
  if (testCase.previewOrientation) {
    await page.locator(`[data-orient="${testCase.previewOrientation}"]`).evaluate(el => el.click());
  }

  const downloadPromise = page.waitForEvent('download', { timeout: 30000 });
  await page.setInputFiles('#file-input', inputPath);
  await page.locator('#convert-btn').click();
  const download = await downloadPromise;
  const outPath = path.join(os.tmpdir(), `to-hwpx-golden-${testCase.name}.hwpx`);
  await download.saveAs(outPath);

  const buf = fs.readFileSync(outPath);
  const zip = await JSZip.loadAsync(buf);
  await validateHwpxPackage(page, zip, testCase);
  if (testCase.previewPaper) {
    await page.locator('#preview-result-btn').click();
    const previewState = await page.locator('#preview-ir .ir-page').evaluate(el => ({
      paper: el.dataset.paper,
      orientation: el.dataset.orientation,
      width: el.style.getPropertyValue('--preview-page-width'),
      ratio: el.style.getPropertyValue('--preview-page-ratio'),
      inlineCodeParagraphs: [...el.querySelectorAll('p')].filter(p =>
        p.textContent.includes('문장 안의 인라인 코드는 앞뒤 문장과 같은 문단에 자연스럽게 이어집니다.')
        && p.querySelector('code')?.textContent === '인라인 코드'
      ).length,
    }));
    assert(previewState.paper === testCase.previewPaper,
      `${testCase.name}: 미리보기에 용지 크기가 반영되지 않음`);
    assert(previewState.orientation === testCase.previewOrientation,
      `${testCase.name}: 미리보기에 용지 방향이 반영되지 않음`);
    assert(previewState.width === '1440px' && previewState.ratio === '420 / 297',
      `${testCase.name}: A3 가로 미리보기 페이지 비율/폭이 잘못됨`);
    assert(previewState.inlineCodeParagraphs === 1,
      `${testCase.name}: 미리보기에서 인라인 코드가 앞뒤 문장과 분리됨`);
    const pageInfo = await page.locator('#preview-pagecount').textContent();
    assert(pageInfo.trim() === 'A3 · 가로', `${testCase.name}: 미리보기 용지 안내가 잘못됨`);
  }
  console.log(`PASS ${testCase.format.padEnd(5)} ${testCase.file}`);
}

async function validateLabControl(page) {
  const baseUrl = `http://127.0.0.1:${PORT}/index.html`;

  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => {
    localStorage.removeItem('tohwpx_lab');
    localStorage.removeItem('tohwpx_lab_access');
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.locator('#open-changelog').click();
  await page.locator('.changelog-tab[data-tab="dev"]').click();
  assert(await page.locator('[data-lab-toggle]').count() === 0,
    'lab: toggle exposed before initial authorization');

  await page.goto(`${baseUrl}?lab=1`, { waitUntil: 'domcontentloaded' });
  assert(await page.locator('.input-mode-tabs').isVisible(),
    'lab: direct input tabs hidden after ?lab=1');
  await page.locator('#open-changelog').click();
  await page.locator('.changelog-tab[data-tab="dev"]').click();
  assert((await page.locator('[data-lab-toggle]').textContent()).trim() === '끄기',
    'lab: enabled toggle does not offer off action');

  await page.locator('[data-lab-toggle]').click();
  await page.waitForLoadState('domcontentloaded');
  assert(!await page.locator('.input-mode-tabs').isVisible(),
    'lab: direct input tabs remain visible after toggle off');
  await page.locator('#open-changelog').click();
  await page.locator('.changelog-tab[data-tab="dev"]').click();
  assert((await page.locator('[data-lab-toggle]').textContent()).trim() === '켜기',
    'lab: toggle disappears or has wrong label while disabled');

  await page.locator('[data-lab-toggle]').click();
  await page.waitForLoadState('domcontentloaded');
  assert(await page.locator('.input-mode-tabs').isVisible(),
    'lab: direct input tabs hidden after toggle on');

  await page.goto(`${baseUrl}?lab=0`, { waitUntil: 'domcontentloaded' });
  await page.locator('#open-changelog').click();
  await page.locator('.changelog-tab[data-tab="dev"]').click();
  assert(await page.locator('[data-lab-toggle]').count() === 0,
    'lab: toggle remains after full ?lab=0 reset');
  console.log('PASS LAB   changelog toggle');
}

(async () => {
  const docxPath = path.join(FIXTURES, 'sample.docx');
  if (!fs.existsSync(docxPath)) {
    await buildDocx(docxPath);
  }

  const srv = await serve();
  const browser = await chromium.launch();
  const context = await browser.newContext({ acceptDownloads: true });
  await context.addInitScript(() => {
    localStorage.setItem('tohwpx_autoDownload', 'true');
  });
  await context.route('https://edwardkim.github.io/**', route => route.abort());
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', err => {
    const message = err.message || '';
    if (/localStorage.*Access is denied/i.test(message)) return;
    pageErrors.push(message);
  });

  try {
    for (const testCase of CASES) {
      await runCase(page, testCase);
    }
    await validateLabControl(page);
    assert(pageErrors.length === 0, `브라우저 오류 발생: ${pageErrors.join(' | ')}`);
    console.log(`\nGOLDEN: ${CASES.length} cases passed`);
  } finally {
    await browser.close();
    srv.close();
  }
})().catch(err => {
  console.error('\nGOLDEN: FAIL');
  console.error(err.message);
  process.exit(1);
});
