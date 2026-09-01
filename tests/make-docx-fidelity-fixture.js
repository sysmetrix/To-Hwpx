'use strict';

const fs = require('fs');
const path = require('path');
const JSZip = require('jszip');

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

async function buildDocxFidelityFixture(outPath) {
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
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>`);
  zip.file('word/styles.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="${W}">
  <w:docDefaults>
    <w:rPrDefault><w:rPr><w:sz w:val="20"/><w:szCs w:val="20"/></w:rPr></w:rPrDefault>
    <w:pPrDefault><w:pPr><w:spacing w:line="288" w:lineRule="auto"/></w:pPr></w:pPrDefault>
  </w:docDefaults>
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:pPr><w:spacing w:line="288" w:lineRule="auto"/></w:pPr></w:style>
  <w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="Heading 1"/></w:style>
</w:styles>`);

  // 실제 실패 문서에서 확인한 결함을 작게 재현한다.
  // - body 첫머리 sectPr, undefined 여백, decimal gridCol
  // - tblPr/tblCellMar/tcPr 자식 순서 오류
  // - 한 셀 안 다중 문단 + 수동 줄바꿈
  zip.file('word/document.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="${W}">
  <w:body>
    <w:sectPr>
      <w:pgMar w:left="850" w:right="850" w:top="960" w:bottom="960" w:header="undefined" w:footer="undefined" w:gutter="undefined"/>
      <w:pgSz w:w="12240" w:h="15840"/>
    </w:sectPr>
    <w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>DOCX 충실도 회귀 제목</w:t></w:r></w:p>
    <w:p><w:r><w:t>표 앞 본문</w:t></w:r></w:p>
    <w:tbl>
      <w:tblPr>
        <w:jc w:val="center"/>
        <w:tblCellMar>
          <w:top w:w="100" w:type="dxa"/><w:bottom w:w="120" w:type="dxa"/>
          <w:left w:w="140" w:type="dxa"/><w:right w:w="160" w:type="dxa"/>
        </w:tblCellMar>
        <w:tblW w:w="7200" w:type="dxa"/>
      </w:tblPr>
      <w:tblGrid><w:gridCol w:w="2400.4"/><w:gridCol w:w="3199.6"/><w:gridCol w:w="1600.0"/></w:tblGrid>
      <w:tr>
        <w:trPr><w:tblHeader/><w:trHeight w:val="480" w:hRule="atLeast"/></w:trPr>
        <w:tc><w:tcPr><w:vAlign w:val="top"/><w:tcW w:w="2400.4" w:type="dxa"/></w:tcPr>
          <w:p><w:r><w:t>첫 셀 첫 문단</w:t><w:br/><w:t>수동 줄바꿈 뒤</w:t></w:r></w:p>
          <w:p><w:r><w:rPr><w:highlight w:val="yellow"/></w:rPr><w:t>첫 셀 둘째 문단</w:t></w:r></w:p>
        </w:tc>
        <w:tc><w:tcPr><w:tcW w:w="3199.6" w:type="dxa"/><w:vAlign w:val="center"/></w:tcPr><w:p><w:r><w:t>가운데 셀</w:t></w:r></w:p></w:tc>
        <w:tc><w:tcPr><w:tcW w:w="1600" w:type="dxa"/></w:tcPr><w:p><w:r><w:t>끝 셀</w:t></w:r></w:p></w:tc>
      </w:tr>
      <w:tr>
        <w:tc><w:tcPr><w:tcW w:w="2400" w:type="dxa"/></w:tcPr><w:p><w:r><w:t>둘째 행 1</w:t></w:r></w:p></w:tc>
        <w:tc><w:tcPr><w:tcW w:w="3200" w:type="dxa"/></w:tcPr><w:p><w:r><w:t>둘째 행 2</w:t></w:r></w:p></w:tc>
        <w:tc><w:tcPr><w:tcW w:w="1600" w:type="dxa"/></w:tcPr><w:p><w:r><w:t>둘째 행 3</w:t></w:r></w:p></w:tc>
      </w:tr>
    </w:tbl>
    <w:p><w:r><w:t>표 뒤 본문</w:t></w:r></w:p>
  </w:body>
</w:document>`);

  const buffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, buffer);
}

if (require.main === module) {
  buildDocxFidelityFixture(process.argv[2] || path.join(__dirname, 'fixtures', 'docx-fidelity.docx'))
    .catch(error => {
      console.error(error);
      process.exit(1);
    });
}

module.exports = { buildDocxFidelityFixture };
