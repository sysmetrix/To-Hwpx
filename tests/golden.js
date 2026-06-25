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
      "HTML 엔티티 작은따옴표 회귀: 사용자'문서, ",
      "강조'문장",
      "엔티티 목록 사용자'항목",
      "사용자'표",
      '문장 안의 ',
      '인라인 코드',
      '는 앞뒤 문장과 같은 문단에 자연스럽게 이어집니다.',
      '단독 코드 문단',
    ],
    mustNotContain: ['▶ Quoted Alpha line'],
    rawMustContain: ["don't", "사용자의 '문서'", "it's bold", "사용자'문서", "강조'문장", "사용자'항목", "사용자'표"],
    rawMustNotContain: ['&apos;', '&#39;', '&amp;#39;'],
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
  const bodyParaPr = (/<hh:paraPr\b[^>]*\bid="0"[\s\S]*?<\/hh:paraPr>/.exec(headerXml) || [])[0] || '';
  assert(bodyParaPr.includes('<hh:lineSpacing type="PERCENT" value="160" unit="HWPUNIT"/>'),
    `${testCase.name}: 기본 본문 줄 간격 160% 누락`);

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
  assert(new RegExp(`landscape="${expectedLandscape ? 'NARROWLY' : 'WIDELY'}"`).test(pagePr),
    `${testCase.name}: 한컴 호환 landscape 값 불일치`);
  const pageWidth = +((/\bwidth="(\d+)"/.exec(pagePr) || [])[1]);
  const pageHeight = +((/\bheight="(\d+)"/.exec(pagePr) || [])[1]);
  assert(pageWidth < pageHeight, `${testCase.name}: HWPX 기본 용지 폭/높이를 회전 전에 유지하지 않음`);
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
    const outMarginOpen = (/<hp:outMargin\b[^>]*\/>/.exec(table) || [])[0] || '';
    const firstRow = (/<hp:tr>[\s\S]*?<\/hp:tr>/.exec(table) || [])[0] || '';
    const headerFlags = [...firstRow.matchAll(/<hp:tc\b[^>]*\bheader="([^"]+)"/g)].map(match => match[1]);
    assert(/\bpageBreak="TABLE"/.test(tableOpen), `${testCase.name}: 일반 표 여러 쪽 지원이 '나눔(TABLE)'이 아님`);
    assert(/\brepeatHeader="1"/.test(tableOpen), `${testCase.name}: 일반 표 제목 줄 자동 반복이 꺼져 있음`);
    assert(/\btreatAsChar="0"/.test(posOpen), `${testCase.name}: 일반 표가 글자처럼 취급됨`);
    assert(/\bflowWithText="1"/.test(posOpen), `${testCase.name}: 일반 표가 본문 흐름을 따르지 않음`);
    assert(/\bhorzRelTo="COLUMN"/.test(posOpen), `${testCase.name}: 일반 표 가로 기준이 단(COLUMN)이 아님`);
    assert(/\bhorzAlign="RIGHT"/.test(posOpen), `${testCase.name}: 일반 표가 단 오른쪽 정렬이 아님`);
    assert(/\bbottom="850"/.test(outMarginOpen), `${testCase.name}: 일반 표 아래쪽 바깥 여백이 3mm가 아님`);
    assert(headerFlags.length > 0 && headerFlags.every(flag => flag === '1'),
      `${testCase.name}: 일반 표 첫 행이 제목 셀로 지정되지 않음`);
  }
  const codeTables = [...sectionXml.matchAll(/<hp:tbl\b[\s\S]*?<\/hp:tbl>/g)]
    .map(match => match[0])
    .filter(table => /<hp:tbl\b[^>]*\bborderFillIDRef="11"/.test(table));
  for (const table of codeTables) {
    const outMarginOpen = (/<hp:outMargin\b[^>]*\/>/.exec(table) || [])[0] || '';
    assert(/\bbottom="850"/.test(outMarginOpen), `${testCase.name}: 코드문 아래쪽 바깥 여백이 3mm가 아님`);
  }
  if (testCase.name === 'markdown') {
    const hrTableMatch = [...sectionXml.matchAll(/<hp:tbl\b[\s\S]*?<\/hp:tbl>/g)]
      .find(match => /<hp:tc\b[^>]*\bborderFillIDRef="10"/.test(match[0]));
    assert(hrTableMatch, `${testCase.name}: 구분선 표를 찾지 못함`);
    const hrOutMargin = (/<hp:outMargin\b[^>]*\/>/.exec(hrTableMatch[0]) || [])[0] || '';
    assert(/\btop="850"/.test(hrOutMargin) && /\bbottom="850"/.test(hrOutMargin),
      `${testCase.name}: 구분선 표 위아래 바깥 여백이 각각 3mm가 아님`);
    const aroundHr = sectionXml.slice(Math.max(0, hrTableMatch.index - 250), hrTableMatch.index + hrTableMatch[0].length + 250);
    assert(!/<hp:p\b[^>]*\bparaPrIDRef="9"[^>]*>[\s\S]*?<\/hp:p>\s*<hp:p\b[^>]*>[\s\S]*?<hp:tbl\b/.test(aroundHr),
      `${testCase.name}: 구분선 위에 외부 빈 문단이 남아 있음`);
    assert(!/<\/hp:tbl>[\s\S]*?<\/hp:p>\s*<hp:p\b[^>]*\bparaPrIDRef="9"/.test(aroundHr),
      `${testCase.name}: 구분선 아래에 외부 빈 문단이 남아 있음`);
  }
  if (testCase.name === 'markdown' || testCase.name === 'html') {
    assert(headerXml.includes('<hh:paraPr id="19"'), `${testCase.name}: 인용구 문단 모양 paraPr id=19 누락`);
    assert(headerXml.includes('<hh:borderFill id="19"'), `${testCase.name}: 인용구 borderFill id=19 누락`);
    assert(sectionXml.includes('paraPrIDRef="19"'), `${testCase.name}: 인용구 문단 paraPrIDRef=19 누락`);
    const quoteParaPr = (/<hh:paraPr\b[^>]*\bid="19"[\s\S]*?<\/hh:paraPr>/.exec(headerXml) || [])[0] || '';
    assert(/<hh:next value="850" unit="HWPUNIT"\/>/.test(quoteParaPr),
      `${testCase.name}: 인용구 아래 간격이 3mm가 아님`);
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
    const previewState = await page.locator('#preview-ir').evaluate(host => {
      const pages = [...host.querySelectorAll('.ir-page')];
      const el = pages[0];
      return {
      paper: el.dataset.paper,
      orientation: el.dataset.orientation,
      width: el.style.getPropertyValue('--preview-page-width'),
      ratio: el.style.getPropertyValue('--preview-page-ratio'),
      pageCount: pages.length,
      inlineCodeParagraphs: pages.flatMap(page => [...page.querySelectorAll('p')]).filter(p =>
        p.textContent.includes('문장 안의 인라인 코드는 앞뒤 문장과 같은 문단에 자연스럽게 이어집니다.')
        && p.querySelector('code')?.textContent === '인라인 코드'
      ).length,
      renderedWidth: el.getBoundingClientRect().width,
      renderedHeight: el.getBoundingClientRect().height,
      overflow: getComputedStyle(el).overflow,
      clippedPages: pages.filter(page => page.scrollHeight > page.clientHeight + 1).length,
    }});
    assert(previewState.paper === testCase.previewPaper,
      `${testCase.name}: 미리보기에 용지 크기가 반영되지 않음`);
    assert(previewState.orientation === testCase.previewOrientation,
      `${testCase.name}: 미리보기에 용지 방향이 반영되지 않음`);
    assert(previewState.width === '1440px' && previewState.ratio === '420 / 297',
      `${testCase.name}: A3 가로 미리보기 페이지 비율/폭이 잘못됨`);
    assert(previewState.inlineCodeParagraphs === 1,
      `${testCase.name}: 미리보기에서 인라인 코드가 앞뒤 문장과 분리됨`);
    assert(previewState.renderedWidth > previewState.renderedHeight && previewState.pageCount > 1,
      `${testCase.name}: 긴 가로 문서가 가로 비율의 여러 페이지로 나뉘지 않음`);
    assert(previewState.overflow === 'hidden' && previewState.clippedPages === 0,
      `${testCase.name}: 미리보기 페이지에서 내용이 잘림`);
    const pageInfo = await page.locator('#preview-pagecount').textContent();
    assert(/^A3 · 가로 · \d+쪽$/.test(pageInfo.trim()), `${testCase.name}: 미리보기 용지 안내가 잘못됨`);
  }
  console.log(`PASS ${testCase.format.padEnd(5)} ${testCase.file}`);
}

async function convertThroughUi(page, { inputPath, format, text, baseName }) {
  const baseUrl = `http://127.0.0.1:${PORT}/index.html`;
  await page.goto(inputPath ? baseUrl : `${baseUrl}?lab=1`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.JSZip && window.marked && window.XLSX, null, { timeout: 30000 });
  if (!inputPath) {
    assert(await page.locator('.input-mode-tabs').isVisible(), 'lab: ?lab=1에서 직접 입력 탭이 보이지 않음');
  }

  const downloadPromise = page.waitForEvent('download', { timeout: 30000 });
  if (inputPath) {
    await page.setInputFiles('#file-input', inputPath);
  } else {
    await page.locator('#mode-paste').click();
    await page.locator('#paste-format').selectOption(format);
    await page.locator('#paste-name').fill(baseName);
    await page.locator('#paste-input').fill(text);
  }
  await page.locator('#convert-btn').click();
  const download = await downloadPromise;
  const outPath = path.join(os.tmpdir(), `to-hwpx-direct-${format}-${inputPath ? 'file' : 'paste'}.hwpx`);
  await download.saveAs(outPath);
  const zip = await JSZip.loadAsync(fs.readFileSync(outPath));
  return zip.file('Contents/section0.xml').async('string');
}

async function validateDirectInput(page) {
  const baseUrl = `http://127.0.0.1:${PORT}/index.html`;
  await page.goto(`${baseUrl}?lab=0`, { waitUntil: 'domcontentloaded' });
  assert(!await page.locator('.input-mode-tabs').isVisible(),
    'lab: 일반 사용자에게 직접 입력 탭이 노출됨');
  await page.locator('#open-changelog').click();
  await page.locator('.changelog-tab[data-tab="dev"]').click();
  assert(await page.locator('[data-lab-toggle]').count() === 0,
    'lab: 승인 전 사용자에게 실험실 토글이 노출됨');

  const cases = [
    ['md', 'sample.md'],
    ['html', 'sample.html'],
    ['txt', 'sample.txt'],
    ['csv', 'sample.csv'],
    ['json', 'sample.json'],
  ];

  for (const [format, file] of cases) {
    const inputPath = path.join(FIXTURES, file);
    const baseName = path.basename(file, path.extname(file));
    const text = fs.readFileSync(inputPath, 'utf8');
    const fileXml = await convertThroughUi(page, { inputPath, format, baseName });
    const pasteXml = await convertThroughUi(page, { format, text, baseName });
    assert(extractHpText(pasteXml) === extractHpText(fileXml),
      `direct ${format}: 파일 업로드와 직접 입력의 HWPX 본문이 다름`);
    assert((pasteXml.match(/<hp:tbl\b/g) || []).length === (fileXml.match(/<hp:tbl\b/g) || []).length,
      `direct ${format}: 파일 업로드와 직접 입력의 표 개수가 다름`);
    console.log(`PASS DIRECT ${format.toUpperCase().padEnd(4)} file/paste parity`);
  }

  const tsv = '이름\t수량\t비고\n사과\t2\t신선함\n배\t\t빈 셀 보존';
  const tsvXml = await convertThroughUi(page, { format: 'csv', text: tsv, baseName: '표-붙여넣기' });
  const tsvText = extractHpText(tsvXml);
  for (const expected of ['이름', '수량', '비고', '사과', '2', '신선함', '배', '빈 셀 보존']) {
    assert(tsvText.includes(expected), `direct TSV: 텍스트 누락 "${expected}"`);
  }
  assert((tsvXml.match(/<hp:tbl\b/g) || []).length >= 1, 'direct TSV: HWPX 표가 생성되지 않음');

  const plainHtmlXml = await convertThroughUi(page, {
    format: 'html',
    text: '웹 화면에서 복사한 일반 텍스트도 보존됩니다.',
    baseName: '일반-텍스트-html',
  });
  assert(extractHpText(plainHtmlXml).includes('웹 화면에서 복사한 일반 텍스트도 보존됩니다.'),
    'direct HTML: 태그 없는 일반 텍스트가 누락됨');

  await page.goto(`${baseUrl}?lab=1`, { waitUntil: 'domcontentloaded' });
  await page.locator('#open-changelog').click();
  await page.locator('.changelog-tab[data-tab="dev"]').click();
  assert(await page.locator('[data-lab-toggle]').getAttribute('aria-pressed') === 'true',
    'lab: 승인 후 실험실 토글 상태가 켜짐으로 표시되지 않음');
  await page.locator('[data-lab-toggle]').click();
  await page.waitForLoadState('domcontentloaded');
  assert(!await page.locator('.input-mode-tabs').isVisible(),
    'lab: 토글을 끈 뒤 직접 입력 탭이 남아 있음');
  await page.locator('#open-changelog').click();
  await page.locator('.changelog-tab[data-tab="dev"]').click();
  assert(await page.locator('[data-lab-toggle]').getAttribute('aria-pressed') === 'false',
    'lab: 토글을 끈 상태가 반영되지 않음');

  await page.goto(`${baseUrl}?lab=0`, { waitUntil: 'domcontentloaded' });
  console.log('PASS DIRECT TSV + plain HTML + hidden Lab UI');
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

  const installGuide = page.locator('#open-install-guide');
  await installGuide.click();
  assert(await page.locator('#install-guide-modal').isVisible(), 'ux: 앱 설치 안내 모달이 열리지 않음');
  assert(await page.locator('img[src="icons/chrome-install.svg"]').count() === 1,
    'ux: Chrome 설치 아이콘 안내가 없음');
  assert(await page.locator('img[src="icons/edge-install.svg"]').count() === 1,
    'ux: Edge 설치 아이콘 안내가 없음');
  const chromeInstallIcon = fs.readFileSync(path.join(ROOT, 'icons/chrome-install.svg'), 'utf8');
  const edgeInstallIcon = fs.readFileSync(path.join(ROOT, 'icons/edge-install.svg'), 'utf8');
  assert(chromeInstallIcon.includes('stroke="#667085"')
    && edgeInstallIcon.includes('stroke="#667085"')
    && !chromeInstallIcon.includes('<rect width="64"')
    && !edgeInstallIcon.includes('<rect width="64"'),
    'ux: Chrome/Edge 설치 아이콘의 색상 또는 배경 스타일이 통일되지 않음');
  const installGuideText = await page.locator('#install-guide-modal').textContent();
  assert(installGuideText.includes('브라우저마다 설치 아이콘 모양이 다릅니다'),
    'ux: 브라우저별 아이콘 차이 안내가 없음');
  assert(installGuideText.includes('이미 설치된 경우에는 아이콘이 나타나지 않을 수 있습니다'),
    'ux: 설치 아이콘이 보이지 않는 경우의 설명이 없음');
  await page.keyboard.press('Escape');
  assert(await installGuide.evaluate(el => document.activeElement === el),
    'ux: 설치 안내 종료 후 열기 버튼으로 포커스가 복귀하지 않음');

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
  const serviceWorker = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
  assert(serviceWorker.includes("'./icons/chrome-install.svg'")
    && serviceWorker.includes("'./icons/edge-install.svg'"),
    'pwa: 설치 안내 아이콘이 오프라인 앱 셸 캐시에 없음');
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

async function validatePaperMatrix(page) {
  const baseUrl = `http://127.0.0.1:${PORT}/index.html`;
  const papers = {
    A3: [84189, 119055],
    A4: [59528, 84188],
    B5: [51430, 72817],
    Letter: [61920, 80136],
  };
  const previewWidths = {};
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.JSZip && window.marked && window.XLSX, null, { timeout: 30000 });
  await page.locator('.advanced-settings > summary').click();

  for (const [paper, [rawWidth, rawHeight]] of Object.entries(papers)) {
    for (const orientation of ['portrait', 'landscape']) {
      await page.locator('#paper-size').selectOption(paper);
      await page.locator(`[data-orient="${orientation}"]`).click();
      const result = await page.evaluate(async ({ paper, orientation }) => {
        const host = document.createElement('div');
        host.className = 'preview-ir';
        host.style.cssText = 'position:fixed;left:-9999px;top:0;width:1600px;height:900px;display:block';
        const sheet = document.createElement('div');
        sheet.className = 'ir-page';
        sheet.textContent = 'paper matrix';
        host.appendChild(sheet);
        document.body.appendChild(host);
        applyPreviewPaper(sheet);
        const rect = sheet.getBoundingClientRect();
        const preview = {
          paper: sheet.dataset.paper,
          orientation: sheet.dataset.orientation,
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        };
        host.remove();

        const blob = await buildHwpx({ title: 'paper matrix', doc_type: 'plain', blocks: [{ type: 'para', text: 'test' }] },
          '휴먼명조', 12, null, paper, null, orientation);
        const zip = await JSZip.loadAsync(await blob.arrayBuffer());
        const section = await zip.file('Contents/section0.xml').async('string');
        const pagePr = (section.match(/<hp:pagePr\b[^>]*>/) || [])[0] || '';
        const lineSeg = (section.match(/<hp:lineseg\b[^>]*>/) || [])[0] || '';
        return { preview, pagePr, lineSeg };
      }, { paper, orientation });

      const landscape = orientation === 'landscape';
      assert(result.preview.paper === paper && result.preview.orientation === orientation,
        `paper matrix: ${paper} ${orientation} 미리보기 상태 불일치`);
      assert(landscape ? result.preview.width > result.preview.height : result.preview.width < result.preview.height,
        `paper matrix: ${paper} ${orientation} 미리보기 실제 비율 불일치`);
      previewWidths[`${paper}:${orientation}`] = result.preview.width;
      assert(result.pagePr.includes(`landscape="${landscape ? 'NARROWLY' : 'WIDELY'}"`),
        `paper matrix: ${paper} ${orientation} pagePr 방향 불일치`);
      assert(result.pagePr.includes(`width="${rawWidth}"`) && result.pagePr.includes(`height="${rawHeight}"`),
        `paper matrix: ${paper} 기본 용지 치수 불일치`);
      const expectedContentWidth = (landscape ? rawHeight : rawWidth) - 2 * Math.round(20 * 283.465);
      assert(result.lineSeg.includes(`horzsize="${expectedContentWidth}"`),
        `paper matrix: ${paper} ${orientation} 회전 후 본문 폭 불일치`);
    }
  }
  assert(previewWidths['A3:landscape'] > previewWidths['A4:landscape']
      && previewWidths['A4:landscape'] > previewWidths['A4:portrait']
      && previewWidths['A4:portrait'] > previewWidths['B5:portrait'],
    'paper matrix: 미리보기에서 용지 크기·방향별 상대 크기가 구분되지 않음');
  console.log('PASS PAPER  A3/A4/B5/Letter × portrait/landscape');
}

async function validateLineSpacingOption(page) {
  const baseUrl = `http://127.0.0.1:${PORT}/index.html`;
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.JSZip && window.marked && window.XLSX, null, { timeout: 30000 });
  await page.locator('.advanced-settings > summary').click();
  const defaultValue = await page.locator('#line-spacing').inputValue();
  assert(defaultValue === '160', 'line spacing: UI 기본값 160%가 아님');

  const header = await page.evaluate(async () => {
    const blob = await buildHwpx(
      { title: 'line spacing', doc_type: 'plain', blocks: [{ type: 'para', text: '줄 간격 테스트' }] },
      '휴먼명조',
      12,
      null,
      'A4',
      null,
      'portrait',
      180
    );
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    return zip.file('Contents/header.xml').async('string');
  });
  const bodyParaPr = (/<hh:paraPr\b[^>]*\bid="0"[\s\S]*?<\/hh:paraPr>/.exec(header) || [])[0] || '';
  const listParaPr = (/<hh:paraPr\b[^>]*\bid="5"[\s\S]*?<\/hh:paraPr>/.exec(header) || [])[0] || '';
  const codeParaPr = (/<hh:paraPr\b[^>]*\bid="6"[\s\S]*?<\/hh:paraPr>/.exec(header) || [])[0] || '';
  assert(bodyParaPr.includes('value="180"'), 'line spacing: 본문 줄 간격 180% 반영 실패');
  assert(listParaPr.includes('value="180"'), 'line spacing: 목록 줄 간격 180% 반영 실패');
  assert(codeParaPr.includes('value="140"'), 'line spacing: 코드 블록 전용 줄 간격이 변경됨');
  console.log('PASS LINE  line spacing default + HWPX paraPr');
}

async function validatePretendardCompatibility(page) {
  const baseUrl = `http://127.0.0.1:${PORT}/index.html`;
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.JSZip && window.marked && window.XLSX, null, { timeout: 30000 });

  const options = await page.locator('#doc-font option').evaluateAll(nodes =>
    nodes.map(node => ({ value: node.value, text: node.textContent.trim() })));
  assert(options.some(option => option.value === 'Pretendard GOV Variable'
      && option.text === 'Pretendard GOV Variable'), 'font: Pretendard GOV Variable 선택 항목 누락');
  assert(!options.some(option => option.value === 'Pretendard GOV'),
    'font: 사용자 선택지에 대체 등록명이 중복 노출됨');
  const resolution = await page.evaluate(async () => ({
    variable: await resolveOutputFontName('Pretendard GOV Variable', [
      { family: 'Pretendard GOV Variable', fullName: 'Pretendard GOV Variable Regular', postscriptName: 'PretendardGOVVariable-Regular' }
    ]),
    gov: await resolveOutputFontName('Pretendard GOV Variable', [
      { family: 'Pretendard GOV', fullName: 'Pretendard GOV Regular', postscriptName: 'PretendardGOV-Regular' }
    ]),
    both: await resolveOutputFontName('Pretendard GOV Variable', [
      { family: 'Pretendard GOV', fullName: 'Pretendard GOV Regular', postscriptName: 'PretendardGOV-Regular' },
      { family: 'Pretendard GOV Variable', fullName: 'Pretendard GOV Variable Regular', postscriptName: 'PretendardGOVVariable-Regular' }
    ]),
    absent: await resolveOutputFontName('Pretendard GOV Variable', []),
    other: await resolveOutputFontName('Noto Sans KR', []),
  }));
  assert(resolution.variable === 'Pretendard GOV Variable', 'font: Variable 설치명 감지 실패');
  assert(resolution.gov === 'Pretendard GOV', 'font: GOV 설치명 감지 실패');
  assert(resolution.both === 'Pretendard GOV Variable', 'font: 두 글꼴 설치 시 Variable 우선순위 실패');
  assert(resolution.absent === 'Pretendard GOV Variable', 'font: 감지 불가 기본값 불일치');
  assert(resolution.other === 'Noto Sans KR', 'font: 다른 글꼴 이름이 변경됨');

  for (const [primary, substitute] of [
    ['Pretendard GOV Variable', 'Pretendard GOV'],
    ['Pretendard GOV', 'Pretendard GOV Variable'],
  ]) {
    const header = await page.evaluate(async fontName => {
      const blob = await buildHwpx(
        { title: 'font compatibility', doc_type: 'plain', blocks: [{ type: 'para', text: '글꼴 호환성' }] },
        fontName
      );
      const zip = await JSZip.loadAsync(await blob.arrayBuffer());
      return zip.file('Contents/header.xml').async('string');
    }, primary);
    const primaryFonts = header.match(new RegExp(`<hh:font id="0" face="${primary}" type="TTF" isEmbedded="0">`, 'g')) || [];
    const substituteFonts = header.match(new RegExp(`<hh:substFont face="${substitute}" type="TTF" isEmbedded="0"\\/>`, 'g')) || [];
    assert(primaryFonts.length === 7, `font: ${primary} 주 글꼴 7개 기록 실패`);
    assert(substituteFonts.length === 7, `font: ${substitute} 대체 글꼴 7개 기록 실패`);
    assert(/<hh:font id="0" face="Pretendard GOV(?: Variable)?"[^>]*>\s*<hh:substFont[^>]*\/>\s*<hh:typeInfo/.test(header),
      'font: substFont가 typeInfo보다 앞에 기록되지 않음');
    const codeCharPr = (/<hh:charPr\b[^>]*\bid="6"[\s\S]*?<\/hh:charPr>/.exec(header) || [])[0] || '';
    assert(/<hh:fontRef hangul="0" latin="0" hanja="0" japanese="0" other="0" symbol="0" user="0"\/>/.test(codeCharPr),
      `font: ${primary} 선택값이 코드문 글꼴에 반영되지 않음`);
    assert(!header.includes('face="D2Coding"'), 'font: 코드문에 D2Coding 고정 글꼴이 남아 있음');
  }

  await page.locator('.advanced-settings > summary').click();
  await page.locator('#open-font-guide').click();
  const guideText = await page.locator('#font-guide-modal').textContent();
  assert(guideText.includes('Pretendard GOV Variable'), 'font: 안내 페이지 대표 명칭 누락');
  const configuredDownload = await page.evaluate(() =>
    FONT_DOWNLOADS.find(font => font.name === 'Pretendard GOV Variable')?.local?.[0] || '');
  assert(configuredDownload === 'fonts/PretendardGOVVariable.ttf', 'font: Variable 다운로드 설정 불일치');
  const renderedDownload = await page.locator('#font-guide-modal a[download]').evaluateAll(links =>
    links.map(link => link.getAttribute('href')).find(href => /Pretendard/i.test(href || '')) || '');
  assert(!renderedDownload || renderedDownload === configuredDownload,
    'font: 미설치 상태의 Variable 다운로드 링크 불일치');
  console.log('PASS FONT   installed Pretendard name + reverse substFont');
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
    await validateDirectInput(page);
    await validateCommercialUx(page);
    await validateRejectedInputs(page);
    await validatePaperMatrix(page);
    await validateLineSpacingOption(page);
    await validatePretendardCompatibility(page);
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
