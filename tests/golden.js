'use strict';

const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const JSZip = require('jszip');
const { chromium } = require('playwright');
const { buildDocx } = require('./make-docx-fixture');
const { buildXlsx } = require('./make-xlsx-fixture');

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
    minTables: 2,
    mustContain: [
      'Golden HTML 제목 Alpha',
      'HTML 하위 제목 Beta',
      '첫 문단입니다',
      '굵은 텍스트',
      '기울임 텍스트',
      '밑줄 텍스트',
      '취소선 텍스트',
      '색상 텍스트',
      '비순서 목록 하나',
      '중첩 목록 Alpha',
      '순서 목록 첫째',
      '표 값 한글',
      'HTML Quote Alpha',
      '병합 제목',
      '병합 값',
      '병합 본문',
    ],
    mustNotContain: ['▶ HTML Quote Alpha'],
  },
  {
    name: 'txt-utf8',
    file: 'sample.txt',
    format: 'TXT',
    minTables: 0,
    mustContain: ['Golden TXT 제목 Alpha', '첫 문단입니다', 'English Alpha', '목록 항목 하나', '둘째 문단'],
  },
  {
    name: 'txt-euckr',
    file: 'sample-euckr.txt',
    format: 'TXT',
    minTables: 0,
    mustContain: ['EUC-KR 제목', '첫 문단 한글 보존', '목록 하나', '목록 둘'],
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
    name: 'xlsx',
    file: 'sample.xlsx',
    format: 'XLSX',
    minTables: 1,
    mustContain: ['Golden 첫 시트', 'XLSX 제목', '표 값 한글', 'English Cell', '계산 결과', '1234', 'long text wraps safely'],
    mustNotContain: ['SECOND_SHEET_MUST_NOT_APPEAR'],
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
    name: 'json-ir',
    file: 'sample-ir.json',
    format: 'JSON',
    minTables: 1,
    mustContain: ['Golden IR JSON 제목', 'IR 굵은 텍스트', '와 일반 텍스트', 'IR 열', 'IR 셀', '제어문자 제거', 'IR 인용문'],
    rawMustNotContain: ['\u0001', '\u0002', '\u0003', '\u0004', '\u0005'],
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

  const pagePr = (/<hp:pagePr\b[^>]*>/.exec(sectionXml) || [])[0] || '';
  const expectedLandscape = testCase.previewOrientation === 'landscape';
  // 한컴 실렌더링 회귀 기준: landscape 속성은 WIDELY를 유지하고 폭/높이로 방향을 결정한다.
  assert(/landscape="WIDELY"/.test(pagePr), `${testCase.name}: 한컴 호환 landscape 값 불일치`);
  const pageWidth = +((/\bwidth="(\d+)"/.exec(pagePr) || [])[1]);
  const pageHeight = +((/\bheight="(\d+)"/.exec(pagePr) || [])[1]);
  assert(expectedLandscape ? pageWidth > pageHeight : pageWidth < pageHeight,
    `${testCase.name}: HWPX 용지 폭/높이 방향 불일치`);
  if (testCase.name === 'ipynb') {
    const codeTable = [...sectionXml.matchAll(/<hp:tbl\b[\s\S]*?<\/hp:tbl>/g)]
      .map(match => match[0])
      .find(table => table.includes('코드 셀 Alpha') && table.includes('print(message)'));
    assert(codeTable, `${testCase.name}: 코드 셀이 코드 블록 표로 출력되지 않음`);
    assert(/charPrIDRef="6"/.test(codeTable), `${testCase.name}: 코드 셀에 등폭 코드 글자 모양이 적용되지 않음`);
  }
  if (testCase.name === 'json') {
    const objectArrayTable = [...sectionXml.matchAll(/<hp:tbl\b[\s\S]*?<\/hp:tbl>/g)]
      .map(match => match[0])
      .find(table => table.includes('구분') && table.includes('값') && table.includes('비고')
        && table.includes('표 제목') && table.includes('long text wraps safely'));
    assert(objectArrayTable, `${testCase.name}: 객체 배열이 행형 데이터 표로 변환되지 않음`);
  }
  if (testCase.name === 'html') {
    assert(/<hp:cellSpan colSpan="2" rowSpan="1"\/>/.test(sectionXml),
      `${testCase.name}: colspan 병합이 HWPX cellSpan으로 보존되지 않음`);
    assert(/<hp:cellSpan colSpan="1" rowSpan="2"\/>/.test(sectionXml),
      `${testCase.name}: rowspan 병합이 HWPX cellSpan으로 보존되지 않음`);
  }
  if (testCase.name === 'html' || testCase.name === 'docx') {
    const charPrById = new Map([...headerXml.matchAll(/<hh:charPr\b[^>]*\bid="(\d+)"[\s\S]*?<\/hh:charPr>/g)]
      .map(match => [match[1], match[0]]));
    const charPrForText = expected => {
      const run = [...sectionXml.matchAll(/<hp:run\b[^>]*\bcharPrIDRef="(\d+)"[^>]*>[\s\S]*?<\/hp:run>/g)]
        .find(match => match[0].includes(expected));
      return run ? (charPrById.get(run[1]) || '') : '';
    };
    assert(charPrForText('굵은 텍스트').includes('<hh:bold/>'), `${testCase.name}: 굵게 서식 누락`);
    assert(charPrForText('기울임 텍스트').includes('<hh:italic/>'), `${testCase.name}: 기울임 서식 누락`);
    if (testCase.name === 'html') {
      assert(charPrForText('밑줄 텍스트').includes('<hh:underline '), `${testCase.name}: 밑줄 서식 누락`);
      assert(charPrForText('취소선 텍스트').includes('<hh:strikeout '), `${testCase.name}: 취소선 서식 누락`);
      assert(charPrForText('색상 텍스트').includes('textColor="#C62828"'), `${testCase.name}: 글자색 서식 누락`);
    }
  }
  const dataTables = [...sectionXml.matchAll(/<hp:tbl\b[\s\S]*?<\/hp:tbl>/g)]
    .map(match => match[0])
    .filter(table => /<hp:tbl\b[^>]*\brepeatHeader="1"/.test(table));
  if (testCase.minTables > 0) {
    assert(dataTables.length >= 1, `${testCase.name}: 일반 데이터 표를 찾지 못함`);
  }
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
  } else {
    await page.locator('[data-orient="portrait"]').evaluate(el => el.click());
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

async function validateCommercialUx(page) {
  const baseUrl = `http://127.0.0.1:${PORT}/index.html`;
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.JSZip && window.marked && window.XLSX, null, { timeout: 30000 });

  const pcGuide = page.locator('#open-pc-guide');
  await pcGuide.focus();
  await pcGuide.press('Enter');
  assert(await page.locator('#pc-guide-modal').isVisible(), 'ux: PC 안내 모달이 키보드로 열리지 않음');
  await page.keyboard.press('Tab');
  assert(await page.locator('#pc-guide-modal').evaluate(modal => modal.contains(document.activeElement)),
    'ux: 모달 Tab 포커스가 배경으로 이탈함');
  await page.keyboard.press('Escape');
  assert(await pcGuide.evaluate(el => document.activeElement === el), 'ux: 모달 종료 후 열기 버튼으로 포커스가 복귀하지 않음');

  const mdCard = page.locator('.format-card[data-ext="md"]');
  await mdCard.focus();
  await mdCard.press('Enter');
  assert(await page.locator('#format-modal').isVisible(), 'ux: 포맷 카드 Enter 조작 실패');
  await page.keyboard.press('Escape');
  assert(await mdCard.evaluate(el => document.activeElement === el), 'ux: 포맷 모달 종료 후 카드로 포커스가 복귀하지 않음');

  const tabs = page.locator('.service-info .format-tab');
  await tabs.first().focus();
  await tabs.first().press('ArrowRight');
  assert(await tabs.nth(1).getAttribute('aria-selected') === 'true', 'ux: 포맷 탭 방향키 전환 실패');

  await page.evaluate(() => {
    validateHwpx = async () => ({ pass: false, issues: ['golden warning'] });
  });
  let downloaded = false;
  page.once('download', () => { downloaded = true; });
  await page.setInputFiles('#file-input', path.join(FIXTURES, 'sample.md'));
  await page.locator('#convert-btn').click();
  await page.locator('.result-card--warn').waitFor({ state: 'visible', timeout: 30000 });
  await page.waitForTimeout(1000);
  assert(!downloaded, 'ux: 구조 검증 경고 산출물이 자동 다운로드됨');
  assert((await page.locator('.result-note').textContent()).includes('자동 다운로드를 중지'),
    'ux: 자동 다운로드 중지 안내 누락');

  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
  assert(manifest.id === './' && manifest.start_url === './' && manifest.scope === './',
    'pwa: 하위 경로용 id/start_url/scope 불일치');
  console.log('PASS UX    keyboard, modal, warning download, PWA scope');
}

async function validateRejectedInputs(page) {
  const baseUrl = `http://127.0.0.1:${PORT}/index.html`;
  const cases = [
    { name: 'malformed JSON', file: { name: 'broken.json', mimeType: 'application/json', buffer: Buffer.from('{"open":') }, expect: 'JSON 파싱 오류' },
    { name: 'malformed IPYNB', file: { name: 'broken.ipynb', mimeType: 'application/json', buffer: Buffer.from('{not notebook') }, expect: 'IPYNB 파싱 오류' },
    { name: 'unclosed CSV quote', file: { name: 'broken.csv', mimeType: 'text/csv', buffer: Buffer.from('a,b\n"open,cell') }, expect: '닫히지 않은 따옴표' },
    { name: 'broken DOCX', file: { name: 'broken.docx', mimeType: 'application/octet-stream', buffer: Buffer.from('not a zip') }, expect: 'DOCX ZIP 열기 실패' },
    { name: 'HWP5 binary', file: { name: 'legacy.hwp', mimeType: 'application/octet-stream', buffer: Buffer.from([0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1]) }, expect: 'HWP5 바이너리' },
  ];

  for (const testCase of cases) {
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.JSZip && window.marked && window.XLSX, null, { timeout: 30000 });
    let downloaded = false;
    const onDownload = () => { downloaded = true; };
    page.on('download', onDownload);
    await page.setInputFiles('#file-input', testCase.file);
    await page.locator('#convert-btn').click();
    await page.locator('.result-card--error').waitFor({ state: 'visible', timeout: 30000 });
    const failureText = await page.locator('#result-area').textContent();
    assert(failureText.includes(testCase.expect), `${testCase.name}: 기대 오류 문구 누락`);
    await page.waitForTimeout(200);
    assert(!downloaded, `${testCase.name}: 실패 입력에서 HWPX가 다운로드됨`);
    page.off('download', onDownload);
  }
  console.log(`PASS FAIL  ${cases.length} malformed/unsupported inputs rejected`);
}

(async () => {
  const docxPath = path.join(FIXTURES, 'sample.docx');
  if (!fs.existsSync(docxPath)) {
    await buildDocx(docxPath);
  }
  const xlsxPath = path.join(FIXTURES, 'sample.xlsx');
  if (!fs.existsSync(xlsxPath)) {
    await buildXlsx(xlsxPath);
  }
  const eucKrPath = path.join(FIXTURES, 'sample-euckr.txt');
  if (!fs.existsSync(eucKrPath)) {
    fs.writeFileSync(eucKrPath, Buffer.from('IyBFVUMtS1Igwaa48Q0KDQrDuSC5rrTcIMfRsdsgurjBuA0KDQotILjxt88gx8+zqg0KLSC48bfPILXR', 'base64'));
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
    await validateCommercialUx(page);
    await validateRejectedInputs(page);
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
