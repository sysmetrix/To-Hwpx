'use strict';

const fs = require('fs');
const path = require('path');
const JSZip = require('jszip');

const DOCX_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

function p(text, opts = {}) {
  const style = opts.style ? `<w:pPr><w:pStyle w:val="${opts.style}"/></w:pPr>` : '';
  const runs = Array.isArray(text) ? text : [{ text }];
  return `<w:p>${style}${runs.map(run => {
    const rPr = [
      run.bold ? '<w:b/>' : '',
      run.italic ? '<w:i/>' : '',
    ].join('');
    return `<w:r>${rPr ? `<w:rPr>${rPr}</w:rPr>` : ''}<w:t>${escapeXml(run.text)}</w:t></w:r>`;
  }).join('')}</w:p>`;
}

function tc(text) {
  return `<w:tc><w:tcPr><w:tcW w:w="2400" w:type="dxa"/></w:tcPr>${p(text)}</w:tc>`;
}

function tr(cells) {
  return `<w:tr>${cells.map(tc).join('')}</w:tr>`;
}

function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

async function buildDocx(outPath) {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
</Types>`);
  zip.file('_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`);
  zip.file('word/_rels/document.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>`);
  zip.file('word/styles.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="${DOCX_NS}">
  <w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="Heading 1"/></w:style>
  <w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="Heading 2"/></w:style>
</w:styles>`);
  zip.file('word/document.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="${DOCX_NS}">
  <w:body>
    ${p('Golden DOCX 제목 Alpha', { style: 'Heading1' })}
    ${p('DOCX 하위 제목 Beta', { style: 'Heading2' })}
    ${p([
      { text: '첫 문단입니다. 한글 English Alpha와 특수문자 & < > " ' },
      { text: '굵은 텍스트', bold: true },
      { text: ' ' },
      { text: '기울임 텍스트', italic: true }
    ])}
    ${p('목록 항목 하나')}
    ${p('목록 항목 English')}
    <w:tbl>
      ${tr(['구분', '값', '비고'])}
      ${tr(['표 제목', '표 값 한글', 'English Cell'])}
      ${tr(['긴 텍스트', 'long text wraps safely', '특수문자 & < >'])}
    </w:tbl>
    <w:sectPr/>
  </w:body>
</w:document>`);

  const buf = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, buf);
}

if (require.main === module) {
  buildDocx(process.argv[2] || path.join(__dirname, 'fixtures', 'sample.docx'))
    .catch(err => {
      console.error(err);
      process.exit(1);
    });
}

module.exports = { buildDocx };
