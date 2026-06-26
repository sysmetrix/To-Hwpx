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
      '굵은 링크',
      '위험 링크',
      '관련 페이지:',
      '청년공간 예약 안내',
      '참고 자료:',
      '운영 매뉴얼 보기',
      '[이미지: 상대경로 이미지] — 불러오지 못했습니다',
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
      '노트북 링크',
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
  const contentHpf = await zip.file('Contents/content.hpf').async('string');
  const manifestXml = await zip.file('META-INF/manifest.xml').async('string');
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
    const hyperlinkBegins = [...sectionXml.matchAll(/<hp:fieldBegin\b[^>]*\btype="HYPERLINK"[^>]*>/g)].map(match => {
      const tag = match[0];
      return [tag, (/\bid="([^"]+)"/.exec(tag) || [])[1], (/\bfieldid="([^"]+)"/.exec(tag) || [])[1]];
    });
    const hyperlinkEnds = [...sectionXml.matchAll(/<hp:fieldEnd\b[^>]*\bbeginIDRef="([^"]+)"[^>]*\bfieldid="([^"]+)"[^>]*\/>/g)];
    assert(hyperlinkBegins.length === 4, `${testCase.name}: 본문·목록 Markdown 링크 4개가 HYPERLINK 필드로 생성되지 않음`);
    assert(hyperlinkEnds.length === hyperlinkBegins.length, `${testCase.name}: HYPERLINK fieldBegin/fieldEnd 개수 불일치`);
    for (const begin of hyperlinkBegins) {
      assert(hyperlinkEnds.some(end => end[1] === begin[1] && end[2] === begin[2]),
        `${testCase.name}: HYPERLINK fieldBegin과 fieldEnd ID 연결 불일치`);
    }
    assert(sectionXml.includes('<hp:stringParam name="Path">https://example.com/path?a=1&amp;b=2</hp:stringParam>'),
      `${testCase.name}: 링크 URL 또는 XML escaping 누락`);
    assert(!sectionXml.includes('javascript:alert'), `${testCase.name}: 위험한 javascript 링크가 HWPX에 남음`);
    assert(sectionXml.includes('<hp:stringParam name="Path">https://example.com/youth-space</hp:stringParam>')
      && sectionXml.includes('<hp:stringParam name="Path">https://example.com/manual</hp:stringParam>'),
      `${testCase.name}: 목록 항목 링크 URL이 HWPX 필드로 보존되지 않음`);
    const linkRun = [...sectionXml.matchAll(/<hp:run\b[^>]*\bcharPrIDRef="(\d+)"[^>]*>[\s\S]*?<\/hp:run>/g)]
      .find(match => match[0].includes('<hp:t>링크 텍스트</hp:t>'));
    const linkCharPr = linkRun
      ? ((new RegExp(`<hh:charPr\\b[^>]*\\bid="${linkRun[1]}"[\\s\\S]*?</hh:charPr>`).exec(headerXml) || [])[0] || '')
      : '';
    assert(linkCharPr.includes('textColor="#0563C1"') && linkCharPr.includes('<hh:underline '),
      `${testCase.name}: 링크용 파란색·밑줄 글자 모양 누락`);

    const imageRefs = [...sectionXml.matchAll(/<hc:img\b[^>]*\bbinaryItemIDRef="([^"]+)"/g)].map(m => m[1]);
    assert(imageRefs.length === 1 && imageRefs[0] === 'image1',
      `${testCase.name}: data URL 이미지가 단일 hc:img로 생성되지 않음`);
    assert(contentHpf.includes('<opf:item id="image1" href="BinData/image1.png" media-type="image/png" isEmbeded="1"/>'),
      `${testCase.name}: Markdown 이미지 content.hpf item 누락`);
    assert(zip.file('BinData/image1.png'), `${testCase.name}: Markdown 이미지 BinData 파일 누락`);
    assert(manifestXml.includes('odf:full-path="BinData/image1.png"') && manifestXml.includes('odf:media-type="image/png"'),
      `${testCase.name}: Markdown 이미지 package manifest 선언 누락`);

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
    assert((sectionXml.match(/type="HYPERLINK"/g) || []).length === 1,
      `${testCase.name}: Markdown 셀 링크가 HYPERLINK 필드로 생성되지 않음`);
    assert((sectionXml.match(/<hc:img\b/g) || []).length === 1
      && contentHpf.includes('href="BinData/image1.png"') && zip.file('BinData/image1.png'),
      `${testCase.name}: Markdown 셀 data URL 이미지가 공통 그림 경로로 생성되지 않음`);
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
    assert(!hrTableMatch, `${testCase.name}: 기본 설정에서 구분선 표가 표시됨`);
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

function assertHorizontalRuleAsBlank(sectionXml, label) {
  const hrTableMatch = [...sectionXml.matchAll(/<hp:tbl\b[\s\S]*?<\/hp:tbl>/g)]
    .find(match => /<hp:tc\b[^>]*\bborderFillIDRef="10"/.test(match[0]));
  assert(!hrTableMatch, `${label}: 구분선 표가 남아 있음`);
  assert(/<hp:p\b[^>]*\bparaPrIDRef="9"[\s\S]*?<hp:t> <\/hp:t>[\s\S]*?<\/hp:p>/.test(sectionXml),
    `${label}: 구분선이 빈 줄 문단으로 대체되지 않음`);
}

function assertHorizontalRuleTable(sectionXml, label) {
  const tables = [...sectionXml.matchAll(/<hp:tbl\b[\s\S]*?<\/hp:tbl>/g)].map(match => match[0]);
  const hrTable = tables.find(table => /<hp:tc\b[^>]*\bborderFillIDRef="10"/.test(table));
  assert(hrTable, `${label}: 표시 옵션에서 구분선 표가 생성되지 않음`);
  const outMarginOpen = (/<hp:outMargin\b[^>]*\/>/.exec(hrTable) || [])[0] || '';
  assert(/\btop="850"/.test(outMarginOpen) && /\bbottom="850"/.test(outMarginOpen),
    `${label}: 구분선 표 위아래 바깥 여백이 3mm가 아님`);
  assert(/\btreatAsChar="1"/.test(hrTable), `${label}: 구분선 표가 글자처럼 취급되지 않음`);
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
  if (testCase.name === 'markdown') {
    const nestedImageSource = await page.evaluate(() => normalizeMarkdownImageSource(
      '[https://example.com/image.jpg](https://example.com/image.jpg)'
    ));
    assert(nestedImageSource === 'https://example.com/image.jpg',
      `${testCase.name}: 이미지 URL 자리에 중첩된 Markdown 링크 문법을 실제 URL로 정규화하지 못함`);
    const failedImageFallback = await page.evaluate(() => markdownImageFallback({
      alt: '청년공간 이미지 예시',
      src: '[https://example.com/image.jpg](https://example.com/image.jpg)',
    }, '이미지 서버의 브라우저 접근 정책(CORS)으로 가져오지 못했습니다.'));
    assert(failedImageFallback.runs?.some(run => run.href === 'https://example.com/image.jpg'),
      `${testCase.name}: 원격 이미지 실패 fallback에 클릭 가능한 원본 링크가 남지 않음`);

    const resultText = await page.locator('#result-area').textContent();
    assert(resultText.includes('이미지 제외: 상대경로 이미지는 이미지 파일을 함께 선택하는 방식이 아직 필요합니다.'),
      `${testCase.name}: 상대경로 이미지 실패가 결과 카드 경고에 표시되지 않음`);
  }
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

async function convertThroughUi(page, { inputPath, format, text, baseName, setup, returnPackage = false }) {
  const baseUrl = `http://127.0.0.1:${PORT}/index.html`;
  await page.goto(inputPath ? baseUrl : `${baseUrl}?admin=1`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.JSZip && window.marked && window.XLSX, null, { timeout: 30000 });
  if (!inputPath) {
    assert(await page.locator('.input-mode-tabs').isVisible(), 'admin: ?admin=1에서 직접 입력 탭이 보이지 않음');
  }

  const downloadPromise = page.waitForEvent('download', { timeout: 30000 });
  if (inputPath) {
    await page.setInputFiles('#file-input', inputPath);
  } else {
    await page.locator('#mode-paste').click();
    await page.locator(`.paste-format-btn[data-paste-format="${format}"]`).click();
    assert(await page.locator('#paste-format').inputValue() === format,
      `direct ${format}: 입력 형식 버튼 선택이 select 값과 동기화되지 않음`);
    await page.locator('#paste-name').fill(baseName);
    await page.locator('#paste-input').fill(text);
  }
  if (setup) await setup(page);
  await page.locator('#convert-btn').click();
  const download = await downloadPromise;
  const outPath = path.join(os.tmpdir(), `to-hwpx-direct-${format}-${inputPath ? 'file' : 'paste'}.hwpx`);
  await download.saveAs(outPath);
  const zip = await JSZip.loadAsync(fs.readFileSync(outPath));
  const section = await zip.file('Contents/section0.xml').async('string');
  if (!returnPackage) return section;
  return {
    section,
    header: await zip.file('Contents/header.xml').async('string'),
  };
}

async function validateDirectInput(page) {
  const baseUrl = `http://127.0.0.1:${PORT}/index.html`;
  await page.goto(`${baseUrl}?admin=0`, { waitUntil: 'domcontentloaded' });
  assert(!await page.locator('.input-mode-tabs').isVisible(),
    'admin: 일반 사용자에게 직접 입력 탭이 노출됨');
  await page.locator('#open-changelog').click();
  assert(!(await page.locator('#changelog-modal').isVisible()),
    'admin: 일반 모드에서 버전 클릭으로 업데이트 내역이 열림');
  await page.goto(`${baseUrl}?admin=1`, { waitUntil: 'domcontentloaded' });
  await page.locator('#open-changelog').click();
  assert(await page.locator('#changelog-modal').isVisible(),
    'admin: 관리자 모드에서 버전 클릭으로 업데이트 내역이 열리지 않음');
  await page.locator('.changelog-tab[data-tab="admin"]').click();
  const changelogTabGap = await page.evaluate(() => {
    const header = document.querySelector('#changelog-modal .modal-header')?.getBoundingClientRect();
    const tabs = document.querySelector('#changelog-modal .changelog-tabs')?.getBoundingClientRect();
    return header && tabs ? Math.round(tabs.top - header.bottom) : null;
  });
  assert(changelogTabGap === 0, 'ux: 업데이트 내역 탭 라인이 모달 제목 영역과 떨어져 있음');
  assert(await page.locator('[data-lab-toggle]').getAttribute('aria-pressed') === 'true',
    'admin: 관리자 모드 토글 상태가 켜짐으로 표시되지 않음');
  assert((await page.locator('.changelog-implemented-panel').textContent()).includes('현재 구현된 기능')
    && await page.locator('[data-admin-feature="direct_input"]').count() === 1,
    'admin: 현재 구현된 기능 목록 또는 직접 입력 토글이 누락됨');
  assert((await page.locator('.changelog-experiment-panel').textContent()).includes('원본 서식 우선 모드 고도화'),
    'admin: 추천 실험 기능 안내가 상태판 기준으로 표시되지 않음');
  await page.locator('.changelog-tab[data-tab="quality"]').click();
  const qualityText = await page.locator('#changelog-content').textContent();
  assert(qualityText.includes('포맷별 변환 품질 평가')
    && qualityText.includes('평가 주기')
    && qualityText.includes('버전/일자별 추이')
    && qualityText.includes('HTML 문서')
    && qualityText.includes('CSS'),
    'admin: 포맷 품질 평가 탭의 핵심 내용이 누락됨');
  await page.keyboard.press('Escape');

  await page.locator('#mode-paste').click();
  await page.locator('.paste-format-btn[data-paste-format="md"]').click();
  await page.locator('#paste-input').fill('# 미리보기 제목\n\n본문 **강조**\n\n| A | B |\n| - | - |\n| 1 | 2 |');
  await page.waitForFunction(() => document.querySelector('#paste-preview-status')?.textContent.includes('MD 해석 완료'));
  const previewText = await page.locator('#paste-preview-output').textContent();
  assert(previewText.includes('미리보기 제목') && previewText.includes('강조') && previewText.includes('1'),
    'direct preview: 직접 입력 미리보기가 해석 결과를 표시하지 않음');
  await page.locator('#copy-paste-preview').click();
  assert(await page.locator('#paste-html-action').count() === 1,
    'direct preview: HTML 액션 버튼이 없음');
  await page.locator('#paste-html-action').click();
  assert(await page.locator('#download-paste-html').isVisible(),
    'direct preview: HTML 다운로드 메뉴가 없음');
  const htmlDownloadPromise = page.waitForEvent('download');
  await page.locator('#download-paste-html').click();
  const htmlDownload = await htmlDownloadPromise;
  assert(htmlDownload.suggestedFilename().endsWith('.html'),
    'direct preview: HTML 다운로드 파일명이 .html이 아님');
  await page.locator('#paste-html-action').click();
  await page.locator('#copy-paste-html').click();

  const directSettingsPackage = await convertThroughUi(page, {
    format: 'md',
    text: '# 직접 설정\n\n[링크](https://example.com/direct)',
    baseName: 'direct-settings',
    returnPackage: true,
    setup: async (p) => {
      await p.locator('.advanced-settings > summary').click();
      await p.locator('#line-spacing').selectOption('180');
      await p.locator('#paragraph-spacing').selectOption('relaxed');
      await p.locator('#link-style').selectOption('url');
    },
  });
  assert(directSettingsPackage.section.includes('링크 (https://example.com/direct)'),
    'direct settings: 직접 입력 변환에 링크 주소 표시 설정이 적용되지 않음');
  const directBodyPara = (/<hh:paraPr\b[^>]*\bid="0"[\s\S]*?<\/hh:paraPr>/.exec(directSettingsPackage.header) || [])[0] || '';
  assert(directBodyPara.includes('value="180"'),
    'direct settings: 직접 입력 변환에 줄 간격 설정이 적용되지 않음');
  await page.evaluate(() => {
    localStorage.removeItem('tohwpx_lineSpacing');
    localStorage.removeItem('tohwpx_paragraphSpacing');
    localStorage.removeItem('tohwpx_linkStyle');
  });

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
    assert((pasteXml.match(/type="HYPERLINK"/g) || []).length === (fileXml.match(/type="HYPERLINK"/g) || []).length,
      `direct ${format}: 파일 업로드와 직접 입력의 링크 개수가 다름`);
    assert((pasteXml.match(/<hc:img\b/g) || []).length === (fileXml.match(/<hc:img\b/g) || []).length,
      `direct ${format}: 파일 업로드와 직접 입력의 이미지 개수가 다름`);
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
  assert(await page.locator('.input-mode-tabs').isVisible(),
    'admin: 호환용 ?lab=1에서 직접 입력 탭이 보이지 않음');
  await page.locator('#open-changelog').click();
  await page.locator('.changelog-tab[data-tab="admin"]').click();
  assert(await page.locator('[data-lab-toggle]').getAttribute('aria-pressed') === 'true',
    'admin: 호환용 ?lab=1 후 관리자 토글 상태가 켜짐으로 표시되지 않음');
  await page.locator('[data-lab-toggle]').click();
  await page.waitForLoadState('domcontentloaded');
  assert(!await page.locator('.input-mode-tabs').isVisible(),
    'admin: 토글을 끈 뒤 직접 입력 탭이 남아 있음');
  await page.locator('#open-changelog').click();
  assert(!(await page.locator('#changelog-modal').isVisible()),
    'admin: 토글을 끈 뒤 일반 모드에서 업데이트 내역이 열림');

  await page.goto(`${baseUrl}?admin=0`, { waitUntil: 'domcontentloaded' });
  console.log('PASS DIRECT TSV + plain HTML + admin-gated input UI');
}

async function validateCommercialUx(page) {
  const baseUrl = `http://127.0.0.1:${PORT}/index.html`;
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.JSZip && window.marked && window.XLSX, null, { timeout: 30000 });

  const heroDropText = await page.locator('#drop-zone .drop-sub').textContent();
  assert(heroDropText.includes('MD · DOCX · HTML · CSV/XLSX · JSON · TXT · HWP · IPYNB'),
    'ux: 첫 화면 드롭존 입력 포맷 순서가 안내 기준과 다름');
  // 베타 배지는 관리자 전용 — 일반 사용자 화면엔 generic 배지 제거 + 모든 .badge-beta가 hidden
  assert(await page.locator('.hero-beta-badge').count() === 0,
    'ux: 첫 화면 generic 베타 배지가 일반 사용자에게 남아 있음');
  const guestBeta = await page.evaluate(() => {
    const all = [...document.querySelectorAll('.badge-beta')];
    return { count: all.length, allHidden: all.every(el => el.hidden),
      converterBetaHidden: document.getElementById('converter-beta')?.hidden !== false };
  });
  assert(guestBeta.count > 0 && guestBeta.allHidden && guestBeta.converterBetaHidden,
    'ux: 일반 사용자에게 베타 배지가 노출됨(관리자 전용이어야 함)');
  await page.goto(`${baseUrl}?admin=1`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.JSZip && window.marked && window.XLSX, null, { timeout: 30000 });
  const adminBeta = await page.evaluate(() => {
    const all = [...document.querySelectorAll('.badge-beta')];
    return { count: all.length, allShown: all.every(el => !el.hidden),
      rootClass: document.documentElement.classList.contains('admin-mode') };
  });
  assert(adminBeta.count > 0 && adminBeta.allShown && adminBeta.rootClass,
    'ux: 관리자 모드에서 베타 배지가 표시되지 않음');
  await page.goto(`${baseUrl}?admin=0`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.JSZip && window.marked && window.XLSX, null, { timeout: 30000 });
  assert((await page.locator('#file-input').getAttribute('accept')).startsWith('.md,.markdown,.docx,.html,.htm,.csv,.xlsx,.xls,.json,.txt,.hwp,.ipynb'),
    'ux: 파일 선택 accept 순서가 드롭존 입력 포맷 순서와 다름');
  const versionButtonText = (await page.locator('#open-changelog').textContent()).trim();
  assert(/^📋 v\d+\.\d+\.\d+$/.test(versionButtonText) && !versionButtonText.includes('업데이트 내역'),
    'ux: 상단 버전 버튼 문구가 버전만 표시하지 않음');
  assert(await page.locator('.nav-related-link').count() === 0,
    'ux: 상단 배너의 MD→HWPX/MD→HTML 연계 링크가 남아 있음');
  assert(await page.locator('#open-onboarding-guide').count() === 0,
    'ux: 드롭존 아래 중복 도움말 버튼이 남아 있음');
  const footerText = await page.locator('footer').textContent();
  assert(!footerText.includes('버그 신고')
    && !footerText.includes('스킬 문서')
    && !footerText.includes('파일은 서버에 전송되지 않으며')
    && !footerText.includes('브라우저 안에서 완전히 처리됩니다'),
    'ux: 하단 관련 링크 또는 중복 로컬 처리 문구가 남아 있음');

  const helpButton = page.locator('#open-help');
  await page.locator('#open-help').click();
  assert(await page.locator('#onboarding-guide-modal').isVisible(), 'ux: 상단 도움말 버튼이 모달을 열지 못함');
  assert(await page.locator('.help-tab[data-help-tab="usage"]').getAttribute('aria-selected') === 'true',
    'ux: 상단 도움말 기본 탭이 사용법이 아님');
  await page.locator('.help-tab[data-help-tab="shortcuts"]').click();
  assert(await page.locator('#help-panel-shortcuts').isVisible()
    && (await page.locator('#help-panel-shortcuts').textContent()).includes('Ctrl/⌘ + O'),
    'ux: 도움말 안 단축키 탭 핵심 내용이 누락됨');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Shift+/');
  assert(await page.locator('#onboarding-guide-modal').isVisible()
    && await page.locator('.help-tab[data-help-tab="shortcuts"]').getAttribute('aria-selected') === 'true',
    'ux: Shift+/ 단축키가 도움말의 단축키 탭으로 연결되지 않음');
  await page.keyboard.press('Escape');

  await helpButton.click();
  assert(await page.locator('#onboarding-guide-modal').isVisible(), 'ux: 도움말 모달이 열리지 않음');
  const onboardingText = await page.locator('#onboarding-guide-modal').textContent();
  assert(onboardingText.includes('대부분의 문서는 아래 순서만 기억하면 됩니다')
    && onboardingText.includes('단축키')
    && onboardingText.includes('보고서처럼 맞출 때만'),
    'ux: 도움말 사용법/단축키 탭 문구가 누락됨');
  await page.keyboard.press('Escape');
  await helpButton.click();
  await page.locator('#onboarding-open-advanced').click();
  assert(await page.locator('#advanced-guide-modal').isVisible(), 'ux: 처음 안내에서 고급 사용 팁으로 이동하지 못함');
  const advancedText = await page.locator('#advanced-guide-modal').textContent();
  assert(advancedText.includes('문서 모양')
    && advancedText.includes('보존 한계')
    && advancedText.includes('문단 앞/뒤 간격'),
    'ux: 고급 사용 팁 핵심 내용이 누락됨');
  await page.keyboard.press('Escape');
  assert(await helpButton.evaluate(el => document.activeElement === el),
    'ux: 고급 사용 팁 종료 후 상단 도움말 버튼으로 포커스가 복귀하지 않음');

  const pcGuide = page.locator('#open-pc-guide');
  await pcGuide.focus();
  await pcGuide.press('Enter');
  assert(await page.locator('#pc-guide-modal').isVisible(), 'ux: PC 안내 모달이 키보드로 열리지 않음');
  await page.waitForFunction(() => {
    const modal = document.querySelector('#pc-guide-modal');
    return modal?.contains(document.activeElement);
  });
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
  assert(chromeInstallIcon.includes('width="128"')
    && edgeInstallIcon.includes('width="128"')
    && chromeInstallIcon.includes('feDropShadow')
    && edgeInstallIcon.includes('feDropShadow')
    && chromeInstallIcon.includes('linearGradient')
    && edgeInstallIcon.includes('linearGradient'),
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
  assert(await page.locator('#format-more-tabs').isVisible()
    && await page.locator('#format-more-panels').count() === 1
    && await page.locator('#format-more-toggle').count() === 0,
    'ux: 포맷 안내 버튼 라인이 기본 표시 상태가 아님');
  assert(await page.locator('.service-info-label').textContent() === '더 알아보기'
    && await page.locator('.service-info .format-panel.active').count() === 0,
    'ux: 더 알아보기 라벨이 없거나 기본 열린 포맷 패널이 남아 있음');
  const basicTab = page.locator('.service-info .format-tab[data-target="panel-basic"]');
  await basicTab.click();
  assert(await page.locator('#panel-basic').isVisible()
    && await basicTab.getAttribute('aria-selected') === 'true',
    'ux: 입력 포맷 버튼 클릭 후 패널이 열리지 않음');
  await basicTab.click();
  assert(await page.locator('.service-info .format-panel.active').count() === 0
    && await basicTab.getAttribute('aria-selected') === 'false',
    'ux: 입력 포맷 버튼 재클릭 후 패널이 닫히지 않음');
  await basicTab.click();
  await mdCard.focus();
  await mdCard.press('Enter');
  assert(await page.locator('#format-modal').isVisible(), 'ux: 포맷 카드 Enter 조작 실패');
  await page.keyboard.press('Escape');
  assert(await mdCard.evaluate(el => document.activeElement === el), 'ux: 포맷 모달 종료 후 카드로 포커스가 복귀하지 않음');

  const tabs = page.locator('.service-info .format-tab');
  assert(await page.locator('#formats-title').count() === 0,
    'ux: 입력 포맷 섹션에 별도 상단 타이틀이 다시 노출됨');
  assert(await tabs.first().getAttribute('data-target') === 'panel-basic'
    && await tabs.nth(1).getAttribute('data-target') === 'panel-ext'
    && await tabs.nth(2).getAttribute('data-target') === 'panel-how',
    'ux: 포맷 탭 순서가 입력 포맷 / 예정 포맷 / 변환 과정이 아님');
  assert((await tabs.first().textContent()).trim() === '입력 포맷',
    'ux: 입력 포맷 탭에 설명 문구가 섞여 있음');
  assert((await tabs.nth(1).textContent()).trim() === '예정 포맷',
    'ux: 예정 포맷 탭에 불필요한 이모지 또는 설명 문구가 섞여 있음');
  assert((await page.locator('#panel-basic > .section-sub').textContent()).includes('보존 범위와 제한사항'),
    'ux: 입력 포맷 패널 리드문에 카드 선택 안내 문구가 없음');
  const basicCardOrder = await page.locator('#panel-basic .format-card').evaluateAll(cards =>
    cards.map(card => card.getAttribute('data-ext')));
  assert(JSON.stringify(basicCardOrder) === JSON.stringify(['md', 'docx', 'html', 'csv', 'json', 'txt', 'hwp']),
    'ux: 입력 포맷 카드 순서가 MD/DOCX/HTML/CSV/XLSX/JSON/TXT/HWP 기준과 다름');
  await tabs.nth(1).click();
  assert((await page.locator('#panel-ext > .section-sub').textContent()).includes('변환 품질 검증'),
    'ux: 예정 포맷 패널 리드문 누락');
  assert(await page.locator('#panel-ext .format-card').first().getAttribute('data-ext') === 'ipynb',
    'ux: 예정 포맷 안내에서 IPYNB 위치가 일관되지 않음');
  await tabs.nth(3).click();
  assert(!(await page.locator('#panel-support').textContent()).includes('PC / 모바일 브라우저'),
    'ux: 지원 현황에 포맷이 아닌 PC / 모바일 브라우저 행이 남아 있음');
  const supportOrder = await page.locator('#panel-support tbody tr').evaluateAll(rows =>
    rows.slice(0, 9).map(row => row.cells[0].textContent.trim()));
  assert(JSON.stringify(supportOrder) === JSON.stringify([
    'MD (Markdown)', 'DOCX', 'HTML', 'CSV', 'XLSX', 'JSON', 'TXT', 'HWP', 'IPYNB',
  ]), 'ux: 지원 현황 표 순서가 포맷 카드/안내 순서와 다름');
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
  assert(await page.locator('.help-dot[aria-label="줄 간격 도움말"]').count() === 0
    && await page.locator('.help-dot[aria-label="가로 구분선 도움말"]').count() === 1
    && await page.locator('.help-dot[aria-label="페이지 여백 도움말"]').count() === 1
    && await page.locator('.help-dot[aria-label="본문 서식 도움말"]').count() === 1
    && await page.locator('#open-advanced-guide').count() === 0,
    'ux: 세부 설정 도움말 또는 고급 사용 팁 중복 진입점 상태가 기준과 다름');
  const titleSourceLabel = await page.locator('[data-title-source="heading"]').textContent();
  assert(titleSourceLabel.trim() === '문서 첫 문장'
    && await page.locator('[data-title-source="custom"]').textContent() === '직접 입력'
    && !(await page.locator('.title-input-wrap').isVisible()),
    'ux: 문서 제목 기본 기준 또는 직접 입력 숨김 상태가 기준과 다름');
  await page.locator('[data-title-source="custom"]').click();
  assert(await page.locator('.title-input-wrap').isVisible()
    && (await page.locator('#doc-title').getAttribute('placeholder')).includes('문서 제목을 입력'),
    'ux: 문서 제목 직접 입력 선택 시 입력칸이 나타나지 않음');
  await page.locator('[data-title-source="filename"]').click();
  assert(!(await page.locator('.title-input-wrap').isVisible()),
    'ux: 자동 제목 기준으로 돌아갔는데 직접 입력칸이 남아 있음');
  if (!(await page.locator('.advanced-settings').getAttribute('open'))) {
    await page.locator('.advanced-settings > summary').click();
  }
  const detailHelpDot = page.locator('.help-dot[aria-label="본문 서식 도움말"]');
  await detailHelpDot.scrollIntoViewIfNeeded();
  await page.waitForTimeout(50);
  await detailHelpDot.click();
  await page.locator('#help-popover').waitFor({ state: 'visible', timeout: 3000 });
  assert((await page.locator('#help-popover').textContent()).includes('문단 간격'),
    'ux: 물음표 도움말 커스텀 툴팁이 표시되지 않음');
  assert(await page.locator('#workflow-hint').count() === 0,
    'ux: 고정 1/2/3단계 안내가 남아 있음');
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

async function validateDetailSettingsUx(page) {
  const baseUrl = `http://127.0.0.1:${PORT}/index.html`;
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.JSZip && window.marked && window.XLSX, null, { timeout: 30000 });
  const shapeSummary = await page.locator('#advanced-settings-summary').evaluate(el => ({
    text: el.textContent.trim(),
    scrollWidth: el.scrollWidth,
    clientWidth: el.clientWidth,
    whiteSpace: getComputedStyle(el).whiteSpace,
  }));
  assert(shapeSummary.text.includes('현재:')
    && shapeSummary.text.includes('줄 160%')
    && !shapeSummary.text.includes('문단')
    && shapeSummary.whiteSpace === 'nowrap'
    && shapeSummary.scrollWidth <= shapeSummary.clientWidth + 1,
    'detail settings: 문서 기본 설정 현재값 요약이 한 줄에서 잘림');
  const closedSummaryStyle = await page.locator('.advanced-settings > summary').evaluate(el => {
    const style = getComputedStyle(el);
    return { background: style.backgroundColor, color: style.color };
  });
  assert(closedSummaryStyle.background !== closedSummaryStyle.color,
    'detail settings: 문서 세부 설정 진입 탭의 회색 배경 스타일을 확인할 수 없음');
  await page.locator('.advanced-settings > summary').click();

  const defaults = await page.evaluate(() => ({
    hrButtons: [...document.querySelectorAll('[data-hr-display]')].map(btn => ({
      value: btn.dataset.hrDisplay,
      active: btn.classList.contains('is-active'),
    })),
    marginMap: !!document.querySelector('.margin-paper-map .margin-paper-inner'),
    marginSideLabels: document.querySelectorAll('.margin-page-label--left, .margin-page-label--right').length,
    marginSideLabelsInsidePaper: (() => {
      const paper = document.querySelector('.margin-paper')?.getBoundingClientRect();
      const labels = [...document.querySelectorAll('.margin-page-label--left, .margin-page-label--right')]
        .map(label => label.getBoundingClientRect());
      return !!paper && labels.length === 2 && labels.every(rect =>
        rect.left >= paper.left - 1 && rect.right <= paper.right + 1
        && rect.top >= paper.top - 1 && rect.bottom <= paper.bottom + 1);
    })(),
    marginInputs: ['top', 'header', 'left', 'right', 'bottom', 'footer']
      .filter(side => document.querySelector(`#margin-${side}`)).length,
    detailOptionLabels: {
      stylePolicy: [...document.querySelector('#style-policy').options].map(option => option.textContent.trim()),
      paragraph: [...document.querySelector('#paragraph-spacing').options].map(option => option.textContent.trim()),
      heading: [...document.querySelector('#heading-style').options].map(option => option.textContent.trim()),
      table: [...document.querySelector('#table-style').options].map(option => option.textContent.trim()),
      link: [...document.querySelector('#link-style').options].map(option => option.textContent.trim()),
      titleBody: [...document.querySelector('#title-body-policy').options].map(option => option.textContent.trim()),
    },
  }));
  assert(defaults.hrButtons.length === 2, 'detail settings: 가로 구분선 표시 옵션 누락');
  assert(defaults.hrButtons.some(btn => btn.value === 'hide' && btn.active),
    'detail settings: 가로 구분선 기본값이 숨김이 아님');
  assert(defaults.marginMap, 'detail settings: 페이지 여백 종이 미니맵 누락');
  assert(defaults.marginSideLabels === 2, 'detail settings: 페이지 여백 좌우 라벨 누락');
  assert(defaults.marginSideLabelsInsidePaper, 'detail settings: 페이지 여백 좌우 라벨이 종이 영역 밖으로 침범함');
  assert(defaults.marginInputs === 6, 'detail settings: 페이지 여백 입력 6개가 유지되지 않음');
  assert(defaults.detailOptionLabels.heading.includes('큰 제목·굵게')
    && defaults.detailOptionLabels.table.includes('머리행 음영')
    && defaults.detailOptionLabels.link.includes('텍스트+주소')
    && defaults.detailOptionLabels.titleBody.includes('본문 첫 제목 제거')
    && defaults.detailOptionLabels.stylePolicy.includes('원본 우선'),
    'detail settings: 세부 옵션명이 변환 결과 중심 문구로 표시되지 않음');
  for (const id of ['style-policy', 'paragraph-spacing', 'heading-style', 'table-style', 'link-style', 'image-max-width', 'image-align', 'title-body-policy']) {
    assert(await page.locator(`#${id}`).count() === 1, `detail settings: #${id} 컨트롤 누락`);
  }

  // 본문 서식이 세그먼트 버튼 UI로 노출되고, 버튼이 숨김 select(값 소스)를 구동하는지 검증
  const segDefault = await page.evaluate(() => ({
    styleBtns: document.querySelectorAll('.detail-field .seg-btn[data-seg-for="style-policy"]').length,
    activeMatchesSelect: [...document.querySelectorAll('.detail-field .seg-btn.is-active[data-seg-for]')]
      .every(btn => document.getElementById(btn.dataset.segFor)?.value === btn.dataset.segValue),
    selectHidden: (() => {
      const sel = document.getElementById('style-policy');
      return !!sel && sel.getBoundingClientRect().width <= 2;
    })(),
  }));
  assert(segDefault.styleBtns === 3, 'detail settings: 원본 서식 처리 세그먼트 버튼 3개가 없음');
  assert(segDefault.activeMatchesSelect, 'detail settings: 세그먼트 활성 버튼이 숨김 select 값과 어긋남');
  assert(segDefault.selectHidden, 'detail settings: 데이터 소스 select가 화면에서 숨겨지지 않음');
  await page.locator('.detail-field .seg-btn[data-seg-for="heading-style"][data-seg-value="prominent"]').click();
  const headingAfter = await page.evaluate(() => ({
    value: document.getElementById('heading-style').value,
    active: document.querySelector('.detail-field .seg-btn.is-active[data-seg-for="heading-style"]')?.dataset.segValue,
    stored: localStorage.getItem('tohwpx_headingStyle'),
  }));
  assert(headingAfter.value === 'prominent' && headingAfter.active === 'prominent' && headingAfter.stored === 'prominent',
    'detail settings: 세그먼트 버튼 클릭이 select 값/활성표시/localStorage에 반영되지 않음');

  const detailOutput = await page.evaluate(async () => {
    const ir = {
      title: 'detail output',
      doc_type: 'plain',
      blocks: [
        { type: 'heading', level: 1, text: '큰 제목', color: '#2457A6' },
        { type: 'para', runs: [{ text: '링크', href: 'https://example.com/path' }] },
        { type: 'table', header: ['구분', '값'], rows: [['A', '10']] },
        {
          type: 'image',
          alt: 'sample',
          widthHwp: 40000,
          heightHwp: 20000,
          binName: 'image1.png',
          mimeType: 'image/png',
          data: new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
        },
      ],
    };
    const blob = await buildHwpx(ir, '휴먼명조', 12, null, 'A4', null, 'portrait', 160, {
      paragraphSpacing: 'relaxed',
      headingStyle: 'prominent',
      tableStyle: 'report',
      linkStyle: 'url',
      imageMaxWidth: 50,
      imageAlign: 'right',
    });
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    return {
      header: await zip.file('Contents/header.xml').async('string'),
      section: await zip.file('Contents/section0.xml').async('string'),
    };
  });
  const bodyPara = (/<hh:paraPr\b[^>]*\bid="0"[\s\S]*?<\/hh:paraPr>/.exec(detailOutput.header) || [])[0] || '';
  const listPara = (/<hh:paraPr\b[^>]*\bid="5"[\s\S]*?<\/hh:paraPr>/.exec(detailOutput.header) || [])[0] || '';
  const h1Char = (/<hh:charPr\b[^>]*\bid="1"[^>]*>/.exec(detailOutput.header) || [])[0] || '';
  const imageWidth = Number(((/<hp:curSz\b[^>]*\bwidth="(\d+)"/.exec(detailOutput.section) || [])[1]) || 0);
  assert(bodyPara.includes('<hh:next value="1134"'), 'detail settings: 문단 넓게 프리셋이 HWPX paraPr에 반영되지 않음');
  assert(listPara.includes('<hh:intent value="-600"') && listPara.includes('<hh:left value="600"'),
    'detail settings: 글머리 hanging indent가 첫 글자 기준으로 설정되지 않음');
  assert(h1Char.includes('height="2000"'), 'detail settings: 제목 강조 프리셋이 H1 크기에 반영되지 않음');
  assert(detailOutput.header.includes('faceColor="#EAF2FF"'), 'detail settings: 보고서형 표 머리행 색상이 생성되지 않음');
  assert(detailOutput.section.includes('링크 (https://example.com/path)'), 'detail settings: 링크 주소 함께 표시가 본문에 반영되지 않음');
  assert(detailOutput.section.includes('horzAlign="RIGHT"') && imageWidth > 0 && imageWidth < 26000,
    'detail settings: 이미지 최대 폭/오른쪽 정렬이 그림 XML에 반영되지 않음');

  const keptTitle = await page.evaluate(() => {
    const ir = { title: '', doc_type: 'plain', blocks: [{ type: 'heading', level: 1, text: '본문 제목' }, { type: 'para', text: '본문' }] };
    applyDocumentTitlePolicy(ir, new File(['# 본문 제목'], 'sample.md', { type: 'text/markdown' }), '', 'heading', 'keep');
    return { title: ir.title, firstBlock: ir.blocks[0]?.text, blockCount: ir.blocks.length };
  });
  assert(keptTitle.title === '본문 제목' && keptTitle.firstBlock === '본문 제목' && keptTitle.blockCount === 2,
    'detail settings: 첫 제목 본문 유지 토글 정책이 적용되지 않음');
  const removedParsedTitle = await page.evaluate(() => {
    const ir = { title: '본문 제목', doc_type: 'plain', blocks: [{ type: 'heading', level: 1, text: '본문 제목' }, { type: 'para', text: '본문' }] };
    applyDocumentTitlePolicy(ir, new File(['# 본문 제목'], 'sample.md', { type: 'text/markdown' }), '', 'heading', 'remove');
    return { title: ir.title, firstBlock: ir.blocks[0]?.text, blockCount: ir.blocks.length };
  });
  assert(removedParsedTitle.title === '본문 제목' && removedParsedTitle.firstBlock === '본문' && removedParsedTitle.blockCount === 1,
    'detail settings: 파서가 제목을 선점한 경우 첫 제목 제거 정책이 적용되지 않음');

  const hrBlankSection = await page.evaluate(async () => {
    const blob = await buildHwpx(
      { title: 'hr blank', doc_type: 'plain', blocks: [{ type: 'para', text: '앞' }, { type: 'hr' }, { type: 'para', text: '뒤' }] },
      '휴먼명조',
      12,
      null,
      'A4',
      null,
      'portrait'
    );
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    return zip.file('Contents/section0.xml').async('string');
  });
  assertHorizontalRuleAsBlank(hrBlankSection, 'detail settings');
  const hrTableSection = await page.evaluate(async () => {
    const blob = await buildHwpx(
      { title: 'hr show', doc_type: 'plain', blocks: [{ type: 'para', text: '앞' }, { type: 'hr' }, { type: 'para', text: '뒤' }] },
      '휴먼명조',
      12,
      null,
      'A4',
      null,
      'portrait',
      160,
      { showHorizontalRules: true }
    );
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    return zip.file('Contents/section0.xml').async('string');
  });
  assertHorizontalRuleTable(hrTableSection, 'detail settings');
  console.log('PASS DETAIL hr option + margin paper map');
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
    localStorage.setItem('tohwpx_onboarding_seen', '1');
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
    await validateDetailSettingsUx(page);
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
