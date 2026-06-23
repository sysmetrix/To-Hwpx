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
    ],
    mustNotContain: ['▶ Quoted Alpha line'],
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

  const tableCount = (sectionXml.match(/<hp:tbl\b/g) || []).length;
  assert(tableCount >= testCase.minTables, `${testCase.name}: 표 개수 부족 (${tableCount} < ${testCase.minTables})`);
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

  const downloadPromise = page.waitForEvent('download', { timeout: 30000 });
  await page.setInputFiles('#file-input', inputPath);
  await page.locator('#convert-btn').click();
  const download = await downloadPromise;
  const outPath = path.join(os.tmpdir(), `to-hwpx-golden-${testCase.name}.hwpx`);
  await download.saveAs(outPath);

  const buf = fs.readFileSync(outPath);
  const zip = await JSZip.loadAsync(buf);
  await validateHwpxPackage(page, zip, testCase);
  console.log(`PASS ${testCase.format.padEnd(5)} ${testCase.file}`);
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
