/* ===================================================================
 * [hwpx.js]  HWPX 빌더 + 클라이언트 사이드 검증기
 * ===================================================================
 * build_hwpx.py와 validate_hwpx.py의 핵심 로직을 JavaScript로 포팅
 *
 * 핵심 규칙 (이 파일의 모든 코드는 이 규칙을 지킴):
 *   1. mimetype은 ZIP의 첫 항목이어야 하고 무압축(STORE)이어야 함
 *      → 이를 어기면 한글이 "파일 손상" 오류를 표시함
 *   2. 베이스 템플릿 XML은 변경하지 않음 (section0.xml만 동적 생성)
 *      → 헤더/컨테이너/Preview를 수정하면 한글 호환이 깨짐
 *   3. 생성 후 반드시 validateHwpx()로 4영역 검증
 *
 * [수정 가이드]
 *   글꼴 변경:  HEADER_XML의 <hh:font face="..."> 값 수정
 *   폰트 크기:  HEADER_XML의 <hh:charPr height="..."> 수정 (단위: 1/10pt)
 *               id="0" = 본문(1000=10pt), id="1" = 제목(1400=14pt bold)
 *   줄간격:     HEADER_XML의 <hh:lineSpacing value="..."> 수정 (단위: %)
 * ===================================================================*/

'use strict';

// ─────────────────────────────────────────────────────────────────────────
// [베이스 템플릿 상수]
//   hwpx-public-doc/assets/base_template/ 에서 검증된 구조를 JS 상수로 내장
//   [주의] 이 상수들을 직접 수정하지 말 것 → 한글 호환 검증이 필요함
// ─────────────────────────────────────────────────────────────────────────

/** mimetype 파일 내용 (정확히 이 문자열이어야 함, 앞뒤 공백 금지) */
const MIMETYPE = 'application/hwp+zip';

/** 한컴 오피스 버전 정보 */
const VERSION_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<hv:HCFVersion xmlns:hv="http://www.hancom.co.kr/hwpml/2011/version" tagetApplication="WORDPROCESSOR" major="5" minor="0" micro="5" buildNumber="0" os="1" application="Hancom Office Hangul"/>`;

/** 애플리케이션 설정 (빈 요소로 유지) */
const SETTINGS_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<ha:HWPApplicationSetting xmlns:ha="http://www.hancom.co.kr/hwpml/2011/app"/>`;

/** OPC 컨테이너: 루트 파일(content.hpf) 위치 선언 */
const CONTAINER_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<ocf:container xmlns:ocf="urn:oasis:names:tc:opendocument:xmlns:container">
  <ocf:rootfiles>
    <ocf:rootfile full-path="Contents/content.hpf" media-type="application/hwpml-package+xml"/>
  </ocf:rootfiles>
</ocf:container>`;

/** RDF 메타데이터 (비어 있어도 파일 존재 필수) */
const CONTAINER_RDF = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
</rdf:RDF>`;

/** ODF 매니페스트: 포함된 파일 목록 */
const MANIFEST_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<odf:manifest xmlns:odf="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" version="1.2">
  <odf:file-entry odf:full-path="/" odf:media-type="application/hwp+zip"/>
  <odf:file-entry odf:full-path="Contents/header.xml" odf:media-type="application/xml"/>
  <odf:file-entry odf:full-path="Contents/section0.xml" odf:media-type="application/xml"/>
</odf:manifest>`;

/**
 * OPF 패키지: 콘텐츠 파일 매핑
 * [수정 시] 섹션을 추가하려면 여기에 item과 itemref도 추가해야 함
 */
const CONTENT_HPF = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<opf:package xmlns:opf="http://www.idpf.org/2007/opf/" version="" unique-identifier="" id="">
  <opf:metadata>
    <opf:title>HWPX Document</opf:title>
  </opf:metadata>
  <opf:manifest>
    <opf:item id="header" href="Contents/header.xml" media-type="application/xml"/>
    <opf:item id="section0" href="Contents/section0.xml" media-type="application/xml"/>
  </opf:manifest>
  <opf:spine>
    <opf:itemref idref="section0" linear="yes"/>
  </opf:spine>
</opf:package>`;

/**
 * 헤더 XML: 글꼴·글자모양·문단모양·테두리 정의
 *
 * [참조 ID 구조] section0.xml에서 이 ID를 참조함
 *   charPr id="0" → 본문 (KoPubDotumMedium, 10pt, 검정)
 *   charPr id="1" → 제목 (KoPubDotumMedium, 14pt, 굵게, 검정)
 *   paraPr id="0" → 기본 문단 (양쪽 정렬, 행간 160%)
 *   borderFill id="1" → 테두리 없음 (기본)
 *   borderFill id="2" → 실선 테두리 (표 일반 셀)
 *   borderFill id="3" → 실선 + 회색 음영 (표 헤더 셀)
 *
 * [글꼴 변경] face="KoPubDotumMedium" → 원하는 글꼴명으로 교체
 *             한글 시스템에 해당 글꼴이 설치되어 있어야 함
 */
const HEADER_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<hh:head xmlns:hh="http://www.hancom.co.kr/hwpml/2011/head" version="1.4" secCnt="1">
  <hh:beginNum page="1" footnote="1" endnote="1" pic="1" tbl="1" equation="1"/>
  <hh:refList>
    <hh:fontfaces itemCnt="2">
      <hh:fontface lang="HANGUL" fontCnt="1">
        <hh:font id="0" face="KoPubDotumMedium" type="TTF" isEmbedded="0">
          <hh:typeInfo familyType="FCAT_GOTHIC" weight="6" proportion="4" contrast="0" strokeVariation="1" armStyle="1" letterform="1" midline="1" xHeight="1"/>
        </hh:font>
      </hh:fontface>
      <hh:fontface lang="LATIN" fontCnt="1">
        <hh:font id="0" face="KoPubDotumMedium" type="TTF" isEmbedded="0">
          <hh:typeInfo familyType="FCAT_GOTHIC" weight="6" proportion="4" contrast="0" strokeVariation="1" armStyle="1" letterform="1" midline="1" xHeight="1"/>
        </hh:font>
      </hh:fontface>
    </hh:fontfaces>
    <hh:charProperties itemCnt="2">
      <hh:charPr id="0" height="1000" textColor="#000000" shadeColor="none" useFontSpace="0" useKerning="0" symMark="NONE" borderFillIDRef="2">
        <hh:fontRef hangul="0" latin="0" hanja="0" japanese="0" other="0" symbol="0" user="0"/>
        <hh:ratio hangul="100" latin="100" hanja="100" japanese="100" other="100" symbol="100" user="100"/>
        <hh:spacing hangul="0" latin="0" hanja="0" japanese="0" other="0" symbol="0" user="0"/>
        <hh:relSz hangul="100" latin="100" hanja="100" japanese="100" other="100" symbol="100" user="100"/>
        <hh:offset hangul="0" latin="0" hanja="0" japanese="0" other="0" symbol="0" user="0"/>
      </hh:charPr>
      <hh:charPr id="1" height="1400" textColor="#000000" shadeColor="none" useFontSpace="0" useKerning="0" symMark="NONE" borderFillIDRef="2">
        <hh:fontRef hangul="0" latin="0" hanja="0" japanese="0" other="0" symbol="0" user="0"/>
        <hh:ratio hangul="100" latin="100" hanja="100" japanese="100" other="100" symbol="100" user="100"/>
        <hh:spacing hangul="0" latin="0" hanja="0" japanese="0" other="0" symbol="0" user="0"/>
        <hh:relSz hangul="100" latin="100" hanja="100" japanese="100" other="100" symbol="100" user="100"/>
        <hh:offset hangul="0" latin="0" hanja="0" japanese="0" other="0" symbol="0" user="0"/>
        <hh:bold/>
      </hh:charPr>
    </hh:charProperties>
    <hh:paraProperties itemCnt="1">
      <hh:paraPr id="0" tabPrIDRef="0" condense="0" fontLineHeight="0" snapToGrid="1" suppressLineNumbers="0" checked="0">
        <hh:align horizontal="JUSTIFY" vertical="BASELINE"/>
        <hh:heading type="NONE" idRef="0" level="0"/>
        <hh:breakSetting breakLatinWord="KEEP_WORD" breakNonLatinWord="KEEP_WORD" widowOrphan="0" keepWithNext="0" keepLines="0" pageBreakBefore="0" lineWrap="BREAK"/>
        <hh:margin><hh:intent value="0" unit="HWPUNIT"/><hh:left value="0" unit="HWPUNIT"/><hh:right value="0" unit="HWPUNIT"/><hh:prev value="0" unit="HWPUNIT"/><hh:next value="0" unit="HWPUNIT"/></hh:margin>
        <hh:lineSpacing type="PERCENT" value="160" unit="HWPUNIT"/>
        <hh:border borderFillIDRef="2" offsetLeft="0" offsetRight="0" offsetTop="0" offsetBottom="0" connect="0" ignoreMargin="0"/>
      </hh:paraPr>
    </hh:paraProperties>
    <hh:borderFills itemCnt="3">
      <hh:borderFill id="1" threeD="0" shadow="0" centerLine="NONE" breakCellSeparateLine="0">
        <hh:slash type="NONE" Crooked="0" isCounter="0"/>
        <hh:backSlash type="NONE" Crooked="0" isCounter="0"/>
        <hh:leftBorder type="NONE" width="0.1 mm" color="#000000"/>
        <hh:rightBorder type="NONE" width="0.1 mm" color="#000000"/>
        <hh:topBorder type="NONE" width="0.1 mm" color="#000000"/>
        <hh:bottomBorder type="NONE" width="0.1 mm" color="#000000"/>
        <hh:diagonal type="SOLID" width="0.1 mm" color="#000000"/>
      </hh:borderFill>
      <hh:borderFill id="2" threeD="0" shadow="0" centerLine="NONE" breakCellSeparateLine="0">
        <hh:slash type="NONE" Crooked="0" isCounter="0"/>
        <hh:backSlash type="NONE" Crooked="0" isCounter="0"/>
        <hh:leftBorder type="SOLID" width="0.12 mm" color="#000000"/>
        <hh:rightBorder type="SOLID" width="0.12 mm" color="#000000"/>
        <hh:topBorder type="SOLID" width="0.12 mm" color="#000000"/>
        <hh:bottomBorder type="SOLID" width="0.12 mm" color="#000000"/>
        <hh:diagonal type="SOLID" width="0.1 mm" color="#000000"/>
      </hh:borderFill>
      <hh:borderFill id="3" threeD="0" shadow="0" centerLine="NONE" breakCellSeparateLine="0">
        <hh:slash type="NONE" Crooked="0" isCounter="0"/>
        <hh:backSlash type="NONE" Crooked="0" isCounter="0"/>
        <hh:leftBorder type="SOLID" width="0.12 mm" color="#000000"/>
        <hh:rightBorder type="SOLID" width="0.12 mm" color="#000000"/>
        <hh:topBorder type="SOLID" width="0.12 mm" color="#000000"/>
        <hh:bottomBorder type="SOLID" width="0.12 mm" color="#000000"/>
        <hh:diagonal type="SOLID" width="0.1 mm" color="#000000"/>
        <hh:fillBrush>
          <hh:winBrush faceColor="#E6E6E6" hatchColor="#000000" alpha="0"/>
        </hh:fillBrush>
      </hh:borderFill>
    </hh:borderFills>
  </hh:refList>
</hh:head>`;

/**
 * 최소 PNG (1×1 투명) — Base64 인코딩
 * [이유] Preview/PrvImage.png 없으면 일부 한글 버전에서 경고 표시
 *        실제 문서 내용 미리보기 이미지가 아니라 파일 탐색기용 썸네일임
 */
const MIN_PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';


// ─────────────────────────────────────────────────────────────────────────
// [XML 생성 유틸리티]
// ─────────────────────────────────────────────────────────────────────────

/**
 * XML 특수문자 이스케이프
 * [중요] 사용자 입력 텍스트를 XML에 넣을 때 반드시 이 함수를 통과시킬 것
 *        미적용 시 XML 파싱 오류 → 한글에서 빈 문서로 열릴 수 있음
 */
function xmlEsc(s) {
    return String(s == null ? '' : s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}


// ─────────────────────────────────────────────────────────────────────────
// [section0.xml 생성]
//   IR의 blocks 배열을 OWPML 단락·표 XML로 변환
//   이 함수만 동적 생성 대상 — 나머지 템플릿은 그대로 복사
// ─────────────────────────────────────────────────────────────────────────

/**
 * 단일 단락(hp:p) XML 생성
 * @param {string} text     - 단락 텍스트
 * @param {string} charId   - 글자 스타일 ID ("0"=본문, "1"=제목bold)
 * @param {string} paraId   - 문단 스타일 ID ("0"=기본)
 */
function buildPara(text, charId = '0', paraId = '0') {
    return `<hp:p paraPrIDRef="${paraId}" styleIDRef="0">` +
        `<hp:run charPrIDRef="${charId}">` +
        `<hp:t>${xmlEsc(text)}</hp:t>` +
        `</hp:run></hp:p>`;
}

/**
 * 표(hp:tbl) XML 생성
 * @param {string[]|null} header - 헤더 행 (null이면 헤더 없음)
 * @param {string[][]}    rows   - 데이터 행 배열
 *
 * [셀 너비] width="8000" = HWPUNIT (1/100mm). 현재 모든 열이 동일 너비
 *           열 수에 따라 동적 조정하려면 이 값을 48000/nCols 로 계산하면 됨
 */
function buildTable(header, rows) {
    // 헤더가 있으면 allRows의 첫 행으로 포함
    const allRows = (header && header.length ? [header] : []).concat(rows || []);
    if (!allRows.length) return buildPara('');

    const nRows = allRows.length;
    // 가장 긴 행의 열 수를 기준으로 사용 (짧은 행은 빈 셀로 채움)
    const nCols = Math.max(...allRows.map(r => (r || []).length), 1);

    let rowsXml = '';
    for (let r = 0; r < nRows; r++) {
        const row = allRows[r] || [];
        const isHeader = (header && header.length && r === 0);
        let cellsXml = '';

        for (let c = 0; c < nCols; c++) {
            const val = (row[c] !== undefined && row[c] !== null) ? String(row[c]) : '';
            // 헤더 셀: 굵은 글자(charId=1) + 회색 음영(borderFill=3)
            // 일반 셀: 본문 글자(charId=0) + 기본 테두리(borderFill=2)
            const charId = isHeader ? '1' : '0';
            const bfId   = isHeader ? '3' : '2';

            cellsXml += `<hp:tc name="" header="${isHeader ? '1' : '0'}" hasMargin="0" protect="0" editable="0" dirty="0" borderFillIDRef="${bfId}">` +
                `<hp:cellAddr colAddr="${c}" rowAddr="${r}"/>` +
                `<hp:cellSpan colSpan="1" rowSpan="1"/>` +
                `<hp:cellSz width="8000" height="1000"/>` +
                `<hp:cellMargin left="510" right="510" top="141" bottom="141"/>` +
                `<hp:subList id="" textDirection="HORIZONTAL" lineWrap="BREAK" vertAlign="CENTER" ` +
                    `linkListIDRef="0" linkListNextIDRef="0" textWidth="0" textHeight="0" hasTextRef="0" hasNumRef="0">` +
                buildPara(val, charId) +
                `</hp:subList></hp:tc>`;
        }
        rowsXml += `<hp:tr>${cellsXml}</hp:tr>`;
    }

    // hp:tbl: 표 크기는 width=48000(전체 너비 고정), height=행수×1000
    return `<hp:p paraPrIDRef="0" styleIDRef="0"><hp:run charPrIDRef="0">` +
        `<hp:tbl id="0" zOrder="0" numberingType="TABLE" textWrap="TOP_AND_BOTTOM" ` +
        `textFlow="BOTH_SIDES" lock="0" dropcapstyle="None" pageBreak="CELL" ` +
        `repeatHeader="1" rowCnt="${nRows}" colCnt="${nCols}" cellSpacing="0" borderFillIDRef="2">` +
        `<hp:sz width="48000" widthRelTo="ABSOLUTE" height="${nRows * 1000}" heightRelTo="ABSOLUTE" protect="0"/>` +
        `<hp:pos treatAsChar="1" affectLSpacing="0" flowWithText="1" allowOverlap="0" holdAnchorAndSO="0" ` +
        `vertRelTo="PARA" horzRelTo="COLUMN" vertAlign="TOP" horzAlign="LEFT" vertOffset="0" horzOffset="0"/>` +
        `<hp:outMargin left="0" right="0" top="0" bottom="0"/>` +
        `<hp:inMargin left="510" right="510" top="141" bottom="141"/>` +
        `${rowsXml}` +
        `</hp:tbl></hp:run></hp:p>`;
}

/**
 * IR → section0.xml 전체 XML 문자열 생성
 * [수정 시] 블록 타입 추가: 이 함수의 for 루프에 else if 항목 추가
 */
function buildSection(ir) {
    const NS_HS = 'http://www.hancom.co.kr/hwpml/2011/section';
    const NS_HP = 'http://www.hancom.co.kr/hwpml/2011/paragraph';

    const parts = [];

    // 문서 제목이 있으면 첫 단락에 제목 스타일(charId=1)로 삽입
    if (ir.title && ir.title.trim()) {
        parts.push(buildPara(ir.title, '1'));
        parts.push(buildPara(''));  // 제목 아래 공백 단락 (시각적 여백)
    }

    for (const block of (ir.blocks || [])) {
        const bt = block.type;

        if (bt === 'heading') {
            // level 1~2: 제목 크기(14pt bold), level 3+: 본문 크기(10pt)
            const charId = ((block.level || 1) <= 2) ? '1' : '0';
            parts.push(buildPara(block.text || '', charId));

        } else if (bt === 'para') {
            parts.push(buildPara(block.text || ''));

        } else if (bt === 'list') {
            // 목록 항목에 가운뎃점(·) 마커 추가 (공공문서 스타일)
            for (const item of (block.items || [])) {
                parts.push(buildPara('· ' + item));
            }

        } else if (bt === 'table') {
            parts.push(buildTable(block.header, block.rows));

        } else {
            // 알 수 없는 블록 타입: text 속성이 있으면 일반 단락으로 폴백
            if (block.text) parts.push(buildPara(block.text));
        }
    }

    // 빈 문서는 공백 단락 하나 삽입 (완전히 비어 있으면 한글이 오류 표시 가능)
    if (!parts.length) parts.push(buildPara(''));

    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
        `<hs:sec xmlns:hs="${NS_HS}" xmlns:hp="${NS_HP}">` +
        parts.join('') +
        `</hs:sec>`;
}


// ─────────────────────────────────────────────────────────────────────────
// [HWPX 패키징]
//   JSZip으로 HWPX(ZIP+XML) Blob 생성
//   [핵심] mimetype을 반드시 첫 번째로, {compression: "STORE"}로 추가
// ─────────────────────────────────────────────────────────────────────────

/**
 * IR → HWPX Blob 생성 (비동기)
 * @param {object} ir       - IR 구조 ({ title, doc_type, blocks })
 * @param {string} fontName - 출력 폰트명 (기본: "KoPubDotumMedium")
 *                            index.html의 #doc-font select 값이 전달됨
 * @returns {Promise<Blob>} HWPX 파일 Blob
 */
async function buildHwpx(ir, fontName = 'KoPubDotumMedium') {
    if (typeof JSZip === 'undefined') {
        throw new Error('JSZip 미로드: HWPX 생성 불가. 인터넷 연결을 확인하세요.');
    }

    // 폰트명이 기본값이 아니면 HEADER_XML의 face 속성을 동적으로 교체
    // [보안] xmlEsc를 통과해 특수문자가 XML을 깨지 않도록 처리
    const safeFont = xmlEsc(fontName || 'KoPubDotumMedium');
    const headerXml = (safeFont === 'KoPubDotumMedium')
        ? HEADER_XML
        : HEADER_XML.replace(/face="KoPubDotumMedium"/g, `face="${safeFont}"`);

    // IR → section0.xml XML 문자열 생성
    const section0Xml = buildSection(ir);

    const zip = new JSZip();

    // ─ 1) mimetype: 첫 번째 항목, 무압축(STORE) ─
    //   JSZip은 추가 순서대로 ZIP 중앙 디렉토리에 기록하므로 이 줄이 반드시 첫 번째여야 함
    //   {compression: "STORE"} = 무압축 (zip 스펙에서 method=0)
    zip.file('mimetype', MIMETYPE, { compression: 'STORE' });

    // ─ 2) 루트 메타파일 ─
    zip.file('version.xml', VERSION_XML);
    zip.file('settings.xml', SETTINGS_XML);

    // ─ 3) META-INF 디렉토리 (3종 필수) ─
    zip.file('META-INF/container.xml', CONTAINER_XML);
    zip.file('META-INF/container.rdf', CONTAINER_RDF);
    zip.file('META-INF/manifest.xml',  MANIFEST_XML);

    // ─ 4) Contents 디렉토리 ─
    //   header.xml: 글꼴·스타일 정의 (폰트 선택 반영)
    //   section0.xml: 문서 본문 (유일한 동적 생성 파일)
    zip.file('Contents/header.xml',   headerXml);
    zip.file('Contents/section0.xml', section0Xml);
    zip.file('Contents/content.hpf',  CONTENT_HPF);

    // ─ 5) Preview 디렉토리 ─
    //   PrvText.txt: 한글 파일 탐색기에서 표시되는 텍스트 미리보기
    //   PrvImage.png: 썸네일 이미지 (최소 PNG 1×1 투명 사용)
    zip.file('Preview/PrvText.txt', ir.title || 'To HWPX 변환 문서');
    zip.file('Preview/PrvImage.png', MIN_PNG_B64, { base64: true });

    // ZIP Blob 생성 (mimetype 이외 파일은 DEFLATE 압축)
    const blob = await zip.generateAsync({
        type: 'blob',
        compression: 'DEFLATE',
        compressionOptions: { level: 6 }
    });

    return blob;
}


// ─────────────────────────────────────────────────────────────────────────
// [클라이언트 사이드 검증기]
//   validate_hwpx.py의 4영역 검증 로직을 JS로 포팅
//   생성된 Blob을 JSZip으로 재로드하여 구조 점검
// ─────────────────────────────────────────────────────────────────────────

/**
 * HWPX Blob의 4영역 구조 검증
 * @param {Blob} blob - buildHwpx()가 반환한 Blob
 * @returns {Promise<{pass: boolean, issues: string[]}>}
 */
async function validateHwpx(blob) {
    const issues = [];

    let zip;
    try {
        const buffer = await blob.arrayBuffer();
        zip = await JSZip.loadAsync(buffer);
    } catch (e) {
        return { pass: false, issues: ['ZIP 로드 실패: ' + e.message] };
    }

    const files = zip.files;
    // JSZip은 삽입 순서를 유지하므로 Object.keys()의 첫 값이 첫 번째 ZIP 항목
    const names = Object.keys(files);

    // ─ 검증 1: 컨테이너 구조 ─
    if (!names.length || names[0] !== 'mimetype') {
        issues.push('mimetype이 ZIP 첫 항목이 아님 (한글이 손상 파일로 인식)');
    }
    if (!files['mimetype']) {
        issues.push('mimetype 파일 없음');
    } else {
        const mimeContent = await files['mimetype'].async('string');
        if (mimeContent.trim() !== 'application/hwp+zip') {
            issues.push(`mimetype 내용 불일치: "${mimeContent.trim()}"`);
        }
    }
    for (const req of ['META-INF/container.xml', 'META-INF/container.rdf', 'META-INF/manifest.xml']) {
        if (!files[req]) issues.push(`필수 메타파일 누락: ${req}`);
    }

    // ─ 검증 2: 필수 파일 존재 ─
    for (const req of ['Contents/header.xml', 'Contents/section0.xml', 'Preview/PrvText.txt']) {
        if (!files[req]) issues.push(`필수 파일 누락: ${req}`);
    }

    // ─ 검증 3: XML 적합성 (section0.xml 네임스페이스 확인) ─
    if (files['Contents/section0.xml']) {
        const xml = await files['Contents/section0.xml'].async('string');
        if (!xml.includes('hancom.co.kr/hwpml/2011/section')) {
            issues.push('section0.xml에 section 네임스페이스 선언 없음');
        }
        if (!xml.includes('hancom.co.kr/hwpml/2011/paragraph')) {
            issues.push('section0.xml에 paragraph 네임스페이스 선언 없음');
        }
        // DOMParser로 XML 파싱 오류 확인
        try {
            const parsed = new DOMParser().parseFromString(xml, 'application/xml');
            const parseErr = parsed.querySelector('parsererror');
            if (parseErr) issues.push('section0.xml XML 파싱 오류: ' + parseErr.textContent.trim().slice(0, 100));
        } catch {
            issues.push('section0.xml XML 파싱 예외 발생');
        }
    }

    // ─ 검증 4: 참조 무결성 (charPrIDRef가 header에 정의되어 있는지) ─
    if (files['Contents/header.xml'] && files['Contents/section0.xml']) {
        const header  = await files['Contents/header.xml'].async('string');
        const section = await files['Contents/section0.xml'].async('string');

        // header에 정의된 charPr id 집합
        const definedChar = new Set([...header.matchAll(/charPr\s+id="(\d+)"/g)].map(m => m[1]));
        // section에서 참조하는 charPrIDRef 집합
        const usedChar    = new Set([...section.matchAll(/charPrIDRef="(\d+)"/g)].map(m => m[1]));

        for (const id of usedChar) {
            if (!definedChar.has(id)) {
                issues.push(`charPrIDRef="${id}"가 header.xml에 미정의`);
            }
        }

        // paraPrIDRef도 동일하게 검사
        const definedPara = new Set([...header.matchAll(/paraPr\s+id="(\d+)"/g)].map(m => m[1]));
        const usedPara    = new Set([...section.matchAll(/paraPrIDRef="(\d+)"/g)].map(m => m[1]));

        for (const id of usedPara) {
            if (!definedPara.has(id)) {
                issues.push(`paraPrIDRef="${id}"가 header.xml에 미정의`);
            }
        }
    }

    return { pass: issues.length === 0, issues };
}
