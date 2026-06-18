/* ===================================================================
 * [hwpx.js]  HWPX 빌더 + 검증기  v3
 * ===================================================================
 * v3 변경사항:
 *   ① 기본 글꼴 → 휴먼명조 (familyType FCAT_MYEONGJO)
 *   ② HEADER_XML 정적 상수 → buildHeaderXml(fontName, basePt) 동적 생성
 *      → 글꼴 크기(기본 12pt) 기반 H1~H4·코드 자동 비례 조정
 *   ③ paraPr id=7 추가 (표 셀 가운데 정렬)
 *   ④ 표 셀 내용 paraPrIDRef="7" 적용 (수평 CENTER 정렬)
 *   ⑤ replaceEmoji() 추가 — HWP 미지원 이모지 → □ 치환
 *   ⑥ secPr를 section 맨 앞으로 이동 (한컴 호환 방식)
 *   ⑦ secPr 단순화 — 호환성 최우선 구조
 *   ⑧ buildSection docType 분기 (공문/보고서/일반)
 *   ⑨ 빈 블록(blank 타입) → 빈 단락으로 출력
 *   ⑩ buildHwpx 시그니처: (ir, fontName, fontSize, marginsMm, paperSize)
 *
 * HWPUNIT: 1pt = 100, 1mm ≈ 283
 * ===================================================================*/

'use strict';

// ─────────────────────────────────────────────────────────────────────────
// [단위 상수]
// ─────────────────────────────────────────────────────────────────────────
const MM_TO_HWP = 283.465;
function mmToHwp(mm) { return Math.round(mm * MM_TO_HWP); }

const PAPER_SIZES = {
    'A4':     { w: 59528, h: 84188 },
    'B5':     { w: 51430, h: 72817 },
    'Letter': { w: 61920, h: 80136 },
};

const DEFAULT_MARGINS_MM = {
    top: 10,
    bottom: 10,
    left: 20,
    right: 20,
    header: 10,
    footer: 10,
};

const DEFAULT_MARGINS_HWP = {
    left: mmToHwp(DEFAULT_MARGINS_MM.left),
    right: mmToHwp(DEFAULT_MARGINS_MM.right),
    top: mmToHwp(DEFAULT_MARGINS_MM.top),
    bottom: mmToHwp(DEFAULT_MARGINS_MM.bottom),
    header: mmToHwp(DEFAULT_MARGINS_MM.header),
    footer: mmToHwp(DEFAULT_MARGINS_MM.footer),
};

function normalizeMarginsMm(marginsMm = {}) {
    const source = marginsMm || {};
    return {
        top: Number.isFinite(Number(source.top)) ? Number(source.top) : DEFAULT_MARGINS_MM.top,
        bottom: Number.isFinite(Number(source.bottom)) ? Number(source.bottom) : DEFAULT_MARGINS_MM.bottom,
        left: Number.isFinite(Number(source.left)) ? Number(source.left) : DEFAULT_MARGINS_MM.left,
        right: Number.isFinite(Number(source.right)) ? Number(source.right) : DEFAULT_MARGINS_MM.right,
        header: Number.isFinite(Number(source.header)) ? Number(source.header) : DEFAULT_MARGINS_MM.header,
        footer: Number.isFinite(Number(source.footer)) ? Number(source.footer) : DEFAULT_MARGINS_MM.footer,
    };
}

function marginsMmToHwp(marginsMm = {}) {
    const m = normalizeMarginsMm(marginsMm);
    return {
        left: mmToHwp(m.left),
        right: mmToHwp(m.right),
        top: mmToHwp(m.top),
        bottom: mmToHwp(m.bottom),
        header: mmToHwp(m.header),
        footer: mmToHwp(m.footer),
    };
}


// ─────────────────────────────────────────────────────────────────────────
// [베이스 템플릿 상수]
// ─────────────────────────────────────────────────────────────────────────
const MIMETYPE    = 'application/hwp+zip';
const VERSION_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<hv:HCFVersion xmlns:hv="http://www.hancom.co.kr/hwpml/2011/version" tagetApplication="WORDPROCESSOR" major="5" minor="0" micro="5" buildNumber="0" os="1" application="Hancom Office Hangul"/>`;
const SETTINGS_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<ha:HWPApplicationSetting xmlns:ha="http://www.hancom.co.kr/hwpml/2011/app"/>`;
const CONTAINER_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<ocf:container xmlns:ocf="urn:oasis:names:tc:opendocument:xmlns:container">
  <ocf:rootfiles>
    <ocf:rootfile full-path="Contents/content.hpf" media-type="application/hwpml-package+xml"/>
  </ocf:rootfiles>
</ocf:container>`;
const CONTAINER_RDF = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"></rdf:RDF>`;
const MANIFEST_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<odf:manifest xmlns:odf="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" version="1.2">
  <odf:file-entry odf:full-path="/" odf:media-type="application/hwp+zip"/>
  <odf:file-entry odf:full-path="Contents/header.xml" odf:media-type="application/xml"/>
  <odf:file-entry odf:full-path="Contents/section0.xml" odf:media-type="application/xml"/>
</odf:manifest>`;
const CONTENT_HPF = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<opf:package xmlns:opf="http://www.idpf.org/2007/opf/" version="" unique-identifier="" id="">
  <opf:metadata><opf:title>HWPX Document</opf:title></opf:metadata>
  <opf:manifest>
    <opf:item id="header"   href="Contents/header.xml"   media-type="application/xml"/>
    <opf:item id="section0" href="Contents/section0.xml" media-type="application/xml"/>
  </opf:manifest>
  <opf:spine><opf:itemref idref="section0" linear="yes"/></opf:spine>
</opf:package>`;

const MIN_PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';


// ─────────────────────────────────────────────────────────────────────────
// [XML 유틸리티]
// ─────────────────────────────────────────────────────────────────────────

/** XML 특수문자 이스케이프 */
function xmlEsc(s) {
    return String(s == null ? '' : s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}

/**
 * HWP 미지원 이모지 → □(흰 사각형) 치환
 * - 보조 다국어 평면(U+10000+): surrogate pair 형태 — 거의 전부 미지원
 * - BMP 이모지 심볼 블록(U+2600-U+2B55): 기호·날씨·다이스 등
 * - Variation Selector(U+FE00-FE0F), ZWJ(U+200D): 수정자 문자 → 제거
 */
function replaceEmoji(s) {
    return String(s || '')
        // 보조 평면 이모지 (surrogate pair)
        .replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, '□')
        // BMP 이모지 심볼 블록 U+2600 ~ U+2B55
        .replace(/[☀-⭕]/g, '□')
        // Variation Selector U+FE00-FE0F, ZWJ U+200D → 제거
        .replace(/[︀-️‍]/g, '');
}


// ─────────────────────────────────────────────────────────────────────────
// [HEADER_XML 동적 생성]
//   글꼴명·기본 크기에 따라 charPr 7종·paraPr 8종 자동 계산
// ─────────────────────────────────────────────────────────────────────────

/**
 * 글꼴 패밀리 타입 감지
 * 명조 계열(바탕·명조): FCAT_MYEONGJO / 고딕 계열: FCAT_GOTHIC
 */
function getFontMeta(name) {
    const myeongjo = /명조|바탕|궁서|Times|Batang|Gungsuh/i.test(name);
    // 한글 기본 폰트들은 HWP에서 주로 HFT 타입으로 인식함
    const isHft = /^(바탕|돋움|굴림|궁서|바탕체|돋움체|굴림체|궁서체)$/.test(name);
    return {
        familyType: myeongjo ? 'FCAT_MYEONGJO' : 'FCAT_GOTHIC',
        weight: myeongjo ? 5 : 6,
        type: isHft ? 'HFT' : 'TTF'
    };
}

/**
 * Bold 전용 분리 폰트가 필요한 글꼴인지 확인
 * KoPubWorld Dotum Medium → Bold는 별도 폰트 파일이므로 <hh:bold/> 대신 폰트 face 전환 필요
 * @returns {string|null} bold 폰트명, 없으면 null
 */
function getBoldFontName(name) {
    if (/KoPubWorld Dotum Medium/i.test(name)) return 'KoPubWorld Dotum Bold';
    return null;
}

/**
 * HEADER_XML 동적 생성
 * @param {string} fontName  글꼴명 (기본: 휴먼명조)
 * @param {number} basePt    기본 본문 글꼴 크기 pt (기본: 12)
 *
 * [charPr ID]  0=본문, 1=H1, 2=H2, 3=H3, 4=H4, 5=표머리, 6=코드
 * [paraPr ID]  0=본문, 1=H1, 2=H2, 3=H3, 4=H4, 5=목록, 6=코드블록, 7=표셀(CENTER)
 * [borderFill] 1=테두리없음, 2=실선(표셀), 3=실선+회색음영(표머리)
 */
function buildHeaderXml(fontName, basePt) {
    const fn = xmlEsc(fontName || '휴먼명조');
    const bp = Math.max(6, Math.min(36, parseInt(basePt, 10) || 12));
    const { familyType, weight, type } = getFontMeta(fontName || '휴먼명조');

    // KoPubWorld Dotum Medium처럼 Bold가 별도 폰트 파일인 경우
    const boldFontName = getBoldFontName(fontName || '휴먼명조');
    const boldFn = boldFontName ? xmlEsc(boldFontName) : null;
    const fontCnt = boldFn ? 2 : 1;

    // 글자 크기 HWPUNIT (1pt = 100)
    const sz = {
        body:  bp * 100,
        h1:    (bp + 6) * 100,
        h2:    (bp + 4) * 100,
        h3:    (bp + 2) * 100,
        h4:    (bp + 1) * 100,
        tblHd: bp * 100,
        code:  Math.max((bp - 1) * 100, 800),
    };

    const fontFaceBlock = (lang) => `
      <hh:fontface lang="${lang}" fontCnt="${fontCnt}">
        <hh:font id="0" face="${fn}" type="${type}" isEmbedded="0">
          <hh:typeInfo familyType="${familyType}" weight="${weight}" proportion="4" contrast="0" strokeVariation="1" armStyle="1" letterform="1" midline="1" xHeight="1"/>
        </hh:font>${boldFn ? `
        <hh:font id="1" face="${boldFn}" type="TTF" isEmbedded="0">
          <hh:typeInfo familyType="FCAT_GOTHIC" weight="8" proportion="4" contrast="0" strokeVariation="1" armStyle="1" letterform="1" midline="1" xHeight="1"/>
        </hh:font>` : ''}
      </hh:fontface>`;

    // bold=true 시: boldFn이 있으면 font face 1 참조(별도 Bold 폰트), 없으면 <hh:bold/> 태그
    const charBase = (id, height, bold = false) => {
        const fi = (bold && boldFn) ? '1' : '0';
        const boldTag = (bold && !boldFn) ? '\n        <hh:bold/>' : '';
        return `      <hh:charPr id="${id}" height="${height}" textColor="#000000" shadeColor="none" useFontSpace="0" useKerning="0" symMark="NONE" borderFillIDRef="1">
        <hh:fontRef hangul="${fi}" latin="${fi}" hanja="${fi}" japanese="${fi}" other="${fi}" symbol="${fi}" user="${fi}"/>
        <hh:ratio hangul="100" latin="100" hanja="100" japanese="100" other="100" symbol="100" user="100"/>
        <hh:spacing hangul="0" latin="0" hanja="0" japanese="0" other="0" symbol="0" user="0"/>
        <hh:relSz hangul="100" latin="100" hanja="100" japanese="100" other="100" symbol="100" user="100"/>
        <hh:offset hangul="0" latin="0" hanja="0" japanese="0" other="0" symbol="0" user="0"/>${boldTag}
      </hh:charPr>`;
    };

    const paraBase = (id, align, spacing, prev, next, indentLeft = 0) =>
        `      <hh:paraPr id="${id}" tabPrIDRef="0" condense="0" fontLineHeight="0" snapToGrid="1" suppressLineNumbers="0" checked="0">
        <hh:align horizontal="${align}" vertical="BASELINE"/>
        <hh:heading type="NONE" idRef="0" level="0"/>
        <hh:breakSetting breakLatinWord="KEEP_WORD" breakNonLatinWord="KEEP_WORD" widowOrphan="0" keepWithNext="0" keepLines="0" pageBreakBefore="0" lineWrap="BREAK"/>
        <hh:margin><hh:intent value="0" unit="HWPUNIT"/><hh:left value="${indentLeft}" unit="HWPUNIT"/><hh:right value="0" unit="HWPUNIT"/><hh:prev value="${prev}" unit="HWPUNIT"/><hh:next value="${next}" unit="HWPUNIT"/></hh:margin>
        <hh:lineSpacing type="PERCENT" value="${spacing}" unit="HWPUNIT"/>
        <hh:border borderFillIDRef="1" offsetLeft="0" offsetRight="0" offsetTop="0" offsetBottom="0" connect="0" ignoreMargin="0"/>
      </hh:paraPr>`;

    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<hh:head xmlns:hh="http://www.hancom.co.kr/hwpml/2011/head" version="1.4" secCnt="1">
  <hh:beginNum page="1" footnote="1" endnote="1" pic="1" tbl="1" equation="1"/>
  <hh:refList>
    <hh:fontfaces itemCnt="7">
${fontFaceBlock('HANGUL')}
${fontFaceBlock('LATIN')}
${fontFaceBlock('HANJA')}
${fontFaceBlock('JAPANESE')}
${fontFaceBlock('OTHER')}
${fontFaceBlock('SYMBOL')}
${fontFaceBlock('USER')}
    </hh:fontfaces>
    <hh:charProperties itemCnt="7">
      <!-- 0=본문, 1=H1 bold, 2=H2 bold, 3=H3 bold, 4=H4 bold, 5=표머리 bold, 6=코드 -->
${charBase(0, sz.body,  false)}
${charBase(1, sz.h1,   true)}
${charBase(2, sz.h2,   true)}
${charBase(3, sz.h3,   true)}
${charBase(4, sz.h4,   true)}
${charBase(5, sz.tblHd,true)}
${charBase(6, sz.code, false).replace('"#000000"', '"#333333"')}
    </hh:charProperties>
    <hh:paraProperties itemCnt="8">
      <!-- id  정렬    행간  전    후   들여 -->
${paraBase(0, 'JUSTIFY', 160,   0,  567,    0)}
${paraBase(1, 'LEFT',    180, 850,  567,    0)}
${paraBase(2, 'LEFT',    170, 700,  425,    0)}
${paraBase(3, 'LEFT',    160, 567,  283,    0)}
${paraBase(4, 'LEFT',    160, 425,  200,    0)}
${paraBase(5, 'LEFT',    160,   0,  100,  600)}
${paraBase(6, 'LEFT',    140, 200,  200,  400)}
      <!-- id=7  표 셀 가운데 정렬 -->
${paraBase(7, 'CENTER',  160,   0,    0,    0)}
    </hh:paraProperties>
    <hh:borderFills itemCnt="3">
      <!-- id=1 테두리 없음 -->
      <hh:borderFill id="1" threeD="0" shadow="0" centerLine="NONE" breakCellSeparateLine="0">
        <hh:slash type="NONE" Crooked="0" isCounter="0"/><hh:backSlash type="NONE" Crooked="0" isCounter="0"/>
        <hh:leftBorder type="NONE" width="0.1 mm" color="#000000"/>
        <hh:rightBorder type="NONE" width="0.1 mm" color="#000000"/>
        <hh:topBorder type="NONE" width="0.1 mm" color="#000000"/>
        <hh:bottomBorder type="NONE" width="0.1 mm" color="#000000"/>
        <hh:diagonal type="SOLID" width="0.1 mm" color="#000000"/>
      </hh:borderFill>
      <!-- id=2 실선 테두리 (표 일반 셀) -->
      <hh:borderFill id="2" threeD="0" shadow="0" centerLine="NONE" breakCellSeparateLine="0">
        <hh:slash type="NONE" Crooked="0" isCounter="0"/><hh:backSlash type="NONE" Crooked="0" isCounter="0"/>
        <hh:leftBorder type="SOLID" width="0.12 mm" color="#000000"/>
        <hh:rightBorder type="SOLID" width="0.12 mm" color="#000000"/>
        <hh:topBorder type="SOLID" width="0.12 mm" color="#000000"/>
        <hh:bottomBorder type="SOLID" width="0.12 mm" color="#000000"/>
        <hh:diagonal type="SOLID" width="0.1 mm" color="#000000"/>
      </hh:borderFill>
      <!-- id=3 실선+회색 음영 (표 머리글 셀) -->
      <hh:borderFill id="3" threeD="0" shadow="0" centerLine="NONE" breakCellSeparateLine="0">
        <hh:slash type="NONE" Crooked="0" isCounter="0"/><hh:backSlash type="NONE" Crooked="0" isCounter="0"/>
        <hh:leftBorder type="SOLID" width="0.12 mm" color="#000000"/>
        <hh:rightBorder type="SOLID" width="0.12 mm" color="#000000"/>
        <hh:topBorder type="SOLID" width="0.12 mm" color="#000000"/>
        <hh:bottomBorder type="SOLID" width="0.12 mm" color="#000000"/>
        <hh:diagonal type="SOLID" width="0.1 mm" color="#000000"/>
        <hh:fillBrush><hh:winBrush faceColor="#E6E6E6" hatchColor="#000000" alpha="0"/></hh:fillBrush>
      </hh:borderFill>
    </hh:borderFills>
  </hh:refList>
</hh:head>`;
}


// ─────────────────────────────────────────────────────────────────────────
// [section0.xml 생성]
// ─────────────────────────────────────────────────────────────────────────

/**
 * 전역 문단 ID 카운터
 * rhwp 기준: <hp:p id>는 섹션 전체에서 0부터 순번 부여
 * (한컴 OWPML 스펙: PARA_HEADER instance_id 매핑)
 */
let _paraIdCounter = 0;
function _nextParaId() { return _paraIdCounter++; }
function _resetParaId() { _paraIdCounter = 0; }

/**
 * 단락(hp:p) XML 생성
 * replaceEmoji → xmlEsc 순서로 처리하여 이모지 □ 치환 후 XML 안전 처리
 */
function buildPara(text, charId = '0', paraId = '0') {
    const safe = xmlEsc(replaceEmoji(text));
    const pid  = _nextParaId();
    return `<hp:p id="${pid}" paraPrIDRef="${paraId}" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0">` +
        `<hp:run charPrIDRef="${charId}"><hp:t>${safe}</hp:t></hp:run></hp:p>`;
}

/** 빈 단락 (빈 줄 표현용) — 공백 문자 하나 포함 */
function buildBlankPara() {
    const pid = _nextParaId();
    return `<hp:p id="${pid}" paraPrIDRef="0" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0">` +
        `<hp:run charPrIDRef="0"><hp:t> </hp:t></hp:run></hp:p>`;
}

/** heading level → charId / paraId 매핑 (1→H1, 2→H2, 3→H3, 4+→H4) */
function headingIds(level) {
    const lv = Math.max(1, Math.min(level || 1, 4));
    return { charId: String(lv), paraId: String(lv) };
}

/**
 * 표(hp:tbl) XML 생성
 * [v3 변경] 셀 내용 paraPrIDRef="7" (CENTER 정렬)
 */
function getContentWidthHwp(marginsHwp, paperKey) {
    const paper = PAPER_SIZES[paperKey] || PAPER_SIZES['A4'];
    const m = Object.assign({}, DEFAULT_MARGINS_HWP, marginsHwp || {});
    return Math.max(12000, paper.w - m.left - m.right);
}

function buildTable(header, rows, contentWidthHwp = 48000) {
    const allRows = (header && header.length ? [header] : []).concat(rows || []);
    if (!allRows.length) return buildBlankPara();

    const nRows = allRows.length;
    const nCols = Math.max(...allRows.map(r => (r || []).length), 1);
    const tableWidth = Math.min(48000, Math.max(12000, contentWidthHwp));
    const cellWidth = Math.floor(tableWidth / nCols);
    const pid = _nextParaId();

    let rowsXml = '';
    for (let r = 0; r < nRows; r++) {
        const row  = allRows[r] || [];
        const isHd = (header && header.length && r === 0);
        const cId  = isHd ? '5' : '0';   // 표머리=5(bold), 일반=0
        const bfId = isHd ? '3' : '2';   // 머리음영=3, 일반셀=2
        let cellsXml = '';

        for (let c = 0; c < nCols; c++) {
            const val = (row[c] !== undefined && row[c] !== null) ? String(row[c]) : '';
            // 자식 순서: subList → cellAddr → cellSpan → cellSz → cellMargin
            // (rhwp serializer/hwpx/table.rs 기준 OWPML 공식 순서)
            cellsXml +=
                `<hp:tc name="" header="${isHd ? '1' : '0'}" hasMargin="0" protect="0" editable="0" dirty="0" borderFillIDRef="${bfId}">` +
                `<hp:subList id="" textDirection="HORIZONTAL" lineWrap="BREAK" vertAlign="CENTER" ` +
                    `linkListIDRef="0" linkListNextIDRef="0" textWidth="0" textHeight="0" hasTextRef="0" hasNumRef="0">` +
                buildPara(val, cId, '7') +  // paraPr=7: CENTER 정렬
                `</hp:subList>` +
                `<hp:cellAddr colAddr="${c}" rowAddr="${r}"/>` +
                `<hp:cellSpan colSpan="1" rowSpan="1"/>` +
                `<hp:cellSz width="${cellWidth}" height="1000"/>` +
                `<hp:cellMargin left="510" right="510" top="141" bottom="141"/>` +
                `</hp:tc>`;
        }
        // <hp:tr>은 속성 없음 (rhwp 기준); header 마킹은 <hp:tc>에만 적용
        rowsXml += `<hp:tr>${cellsXml}</hp:tr>`;
    }

    // [v4] pageBreak="TABLE" → 행 단위로 쪽 넘김 허용 (rhwp TablePageBreak::RowBreak 기준)
    //      height="0" → HWP이 셀 내용 기준으로 자동 계산 (고정값 제거)
    return `<hp:p id="${pid}" paraPrIDRef="0" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0"><hp:run charPrIDRef="0">` +
        `<hp:tbl id="0" zOrder="0" numberingType="TABLE" textWrap="TOP_AND_BOTTOM" ` +
        `textFlow="BOTH_SIDES" lock="0" dropcapstyle="None" pageBreak="TABLE" ` +
        `repeatHeader="1" rowCnt="${nRows}" colCnt="${nCols}" cellSpacing="0" borderFillIDRef="2">` +
        `<hp:sz width="${tableWidth}" widthRelTo="ABSOLUTE" height="0" heightRelTo="ABSOLUTE" protect="0"/>` +
        `<hp:pos treatAsChar="1" affectLSpacing="0" flowWithText="1" allowOverlap="0" holdAnchorAndSO="0" ` +
        `vertRelTo="PARA" horzRelTo="COLUMN" vertAlign="TOP" horzAlign="LEFT" vertOffset="0" horzOffset="0"/>` +
        `<hp:outMargin left="0" right="0" top="0" bottom="0"/>` +
        `<hp:inMargin left="510" right="510" top="141" bottom="141"/>` +
        `${rowsXml}` +
        `</hp:tbl><hp:t></hp:t></hp:run></hp:p>`;
}

/**
 * 페이지 설정(secPr) XML
 * HWPX 스키마 기준 secPr는 paragraph 네임스페이스이며 hp:run 내부에 위치한다.
 */
function buildSecPr(marginsHwp, paperKey) {
    const paper = PAPER_SIZES[paperKey] || PAPER_SIZES['A4'];
    const m = Object.assign({}, DEFAULT_MARGINS_HWP, marginsHwp || {});
    return `<hp:secPr id="" textDirection="HORIZONTAL" spaceColumns="1134" tabStop="8000" ` +
        `tabStopVal="4000" tabStopUnit="HWPUNIT" outlineShapeIDRef="0" memoShapeIDRef="0" ` +
        `textVerticalWidthHead="0" masterPageCnt="0">` +
        `<hp:grid lineGrid="0" charGrid="0" wonggojiFormat="0"/>` +
        `<hp:startNum pageStartsOn="BOTH" page="0" pic="0" tbl="0" equation="0"/>` +
        `<hp:visibility hideFirstHeader="0" hideFirstFooter="0" hideFirstMasterPage="0" ` +
        `border="SHOW_ALL" fill="SHOW_ALL" hideFirstPageNum="0" hideFirstEmptyLine="0" showLineNumber="0"/>` +
        `<hp:lineNumberShape restartType="0" countBy="0" distance="0" startNumber="0"/>` +
        `<hp:pagePr landscape="WIDELY" width="${paper.w}" height="${paper.h}" gutterType="LEFT_ONLY">` +
        `<hp:margin header="${m.header}" footer="${m.footer}" gutter="0" ` +
        `left="${m.left}" right="${m.right}" top="${m.top}" bottom="${m.bottom}"/>` +
        `</hp:pagePr>` +
        `<hp:footNotePr><hp:autoNumFormat type="DIGIT" userChar="" prefixChar="" suffixChar=")" supscript="0"/>` +
        `<hp:noteLine length="-1" type="SOLID" width="0.12 mm" color="#000000"/>` +
        `<hp:noteSpacing betweenNotes="283" belowLine="567" aboveLine="850"/>` +
        `<hp:numbering type="CONTINUOUS" newNum="1"/>` +
        `<hp:placement place="EACH_COLUMN" beneathText="0"/></hp:footNotePr>` +
        `<hp:endNotePr><hp:autoNumFormat type="DIGIT" userChar="" prefixChar="" suffixChar=")" supscript="0"/>` +
        `<hp:noteLine length="-1" type="SOLID" width="0.12 mm" color="#000000"/>` +
        `<hp:noteSpacing betweenNotes="0" belowLine="567" aboveLine="850"/>` +
        `<hp:numbering type="CONTINUOUS" newNum="1"/>` +
        `<hp:placement place="END_OF_DOCUMENT" beneathText="0"/></hp:endNotePr>` +
        `<hp:pageBorderFill type="BOTH" borderFillIDRef="1" textBorder="PAPER" ` +
        `headerInside="0" footerInside="0" fillArea="PAPER">` +
        `<hp:offset left="1417" right="1417" top="1417" bottom="1417"/></hp:pageBorderFill>` +
        `</hp:secPr>`;
}

function buildSectionBootstrap(secPrXml, contentWidthHwp) {
    const pid = _nextParaId();
    return `<hp:p id="${pid}" paraPrIDRef="0" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0">` +
        `<hp:run charPrIDRef="0">${secPrXml}` +
        `<hp:ctrl><hp:colPr id="" type="NEWSPAPER" layout="LEFT" colCount="1" sameSz="1" sameGap="0"/></hp:ctrl>` +
        `</hp:run><hp:run charPrIDRef="0"><hp:t></hp:t></hp:run>` +
        `<hp:linesegarray><hp:lineseg textpos="0" vertpos="0" vertsize="1000" textheight="1000" ` +
        `baseline="850" spacing="600" horzpos="0" horzsize="${contentWidthHwp}" flags="393216"/></hp:linesegarray></hp:p>`;
}

/**
 * IR → section0.xml 전체 문자열
 * [v4] 참조 앱(md-to-hwpx)처럼 첫 bootstrap 문단에 secPr를 배치한다.
 */
function buildSection(ir, marginsHwp, paperKey) {
    const NS_HS = 'http://www.hancom.co.kr/hwpml/2011/section';
    const NS_HP = 'http://www.hancom.co.kr/hwpml/2011/paragraph';
    const docType = ir.doc_type || 'plain';

    // 섹션마다 문단 ID를 0부터 재시작 (HWPX 섹션 범위 기준)
    _resetParaId();

    const contentWidthHwp = getContentWidthHwp(marginsHwp, paperKey);
    const parts = [];
    parts.push(buildSectionBootstrap(buildSecPr(marginsHwp, paperKey), contentWidthHwp));

    // ── 문서 유형별 머리글 ────────────────────────────────────────────
    if (docType === 'official') {
        // 공문 형식: 수신/발신/제목 헤더
        parts.push(buildPara('수  신: (해당 기관)', '0', '0'));
        parts.push(buildPara('발  신: ', '0', '0'));
        parts.push(buildBlankPara());
    } else if (docType === 'report') {
        // 보고서: 보고서 라벨
        parts.push(buildPara('보  고  서', '1', '1'));
        parts.push(buildBlankPara());
    }

    // ── 문서 제목 ──────────────────────────────────────────────────────
    if (ir.title && ir.title.trim()) {
        if (docType === 'official') {
            parts.push(buildPara('제  목: ' + ir.title, '3', '3'));
        } else {
            parts.push(buildPara(ir.title, '1', '1'));
        }
        parts.push(buildBlankPara());  // 제목 아래 빈 줄
    }

    // 보고서: 작성일 줄
    if (docType === 'report') {
        const today = new Date();
        const dateStr = `${today.getFullYear()}년 ${today.getMonth() + 1}월 ${today.getDate()}일`;
        parts.push(buildPara(dateStr, '0', '0'));
        parts.push(buildBlankPara());
    }

    // ── 본문 블록 ──────────────────────────────────────────────────────
    for (const block of (ir.blocks || [])) {
        const bt = block.type;

        if (bt === 'heading') {
            const { charId, paraId } = headingIds(block.level);
            parts.push(buildPara(block.text || '', charId, paraId));

        } else if (bt === 'para') {
            // 빈 텍스트 para → 빈 단락(빈 줄 표현)
            if (!block.text || !block.text.trim()) {
                parts.push(buildBlankPara());
            } else {
                parts.push(buildPara(block.text, '0', '0'));
            }

        } else if (bt === 'blank') {
            // 명시적 빈 줄 블록
            parts.push(buildBlankPara());

        } else if (bt === 'list') {
            (block.items || []).forEach((item, i) => {
                const prefix = block.ordered ? `${i + 1}. ` : '· ';
                parts.push(buildPara(prefix + item, '0', '5'));
            });

        } else if (bt === 'table') {
            parts.push(buildTable(block.header, block.rows, contentWidthHwp));

        } else if (bt === 'code') {
            const lines = (block.text || '').split('\n');
            lines.forEach(line => parts.push(buildPara(line === '' ? ' ' : line, '6', '6')));

        } else if (block.text) {
            parts.push(buildPara(block.text, '0', '0'));
        }
    }

    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
        `<hs:sec xmlns:hs="${NS_HS}" xmlns:hp="${NS_HP}">` +
        parts.join('') +
        `</hs:sec>`;
}


// ─────────────────────────────────────────────────────────────────────────
// [HWPX 패키징]
// ─────────────────────────────────────────────────────────────────────────

/**
 * IR → HWPX Blob 생성
 * @param {object} ir            IR {title, doc_type, blocks}
 * @param {string} fontName      글꼴 (기본: 휴먼명조)
 * @param {number} fontSize      기본 글자 크기 pt (기본: 12)
 * @param {object|null} marginsMm 여백 mm {left,right,top,bottom,header,footer} — null=기본값
 * @param {string} paperSize     용지 "A4"|"B5"|"Letter"
 * @param {function} onProgress  진행률 콜백 함수 (0~100)
 */
async function buildHwpx(ir, fontName = '휴먼명조', fontSize = 12, marginsMm = null, paperSize = 'A4', onProgress = null) {
    if (typeof JSZip === 'undefined') throw new Error('JSZip 미로드: 인터넷 연결을 확인하세요.');

    const marginsHwp = marginsMmToHwp(marginsMm || DEFAULT_MARGINS_MM);

    const headerXml   = buildHeaderXml(fontName, fontSize);
    const section0Xml = buildSection(ir, marginsHwp, paperSize);

    const zip = new JSZip();
    zip.file('mimetype',              MIMETYPE,      { compression: 'STORE' });
    zip.file('version.xml',           VERSION_XML);
    zip.file('settings.xml',          SETTINGS_XML);
    zip.file('META-INF/container.xml', CONTAINER_XML);
    zip.file('META-INF/container.rdf', CONTAINER_RDF);
    zip.file('META-INF/manifest.xml',  MANIFEST_XML);
    zip.file('Contents/header.xml',    headerXml);
    zip.file('Contents/section0.xml',  section0Xml);
    zip.file('Contents/content.hpf',   CONTENT_HPF);
    zip.file('Preview/PrvText.txt',    ir.title || 'To HWPX 변환 문서');
    zip.file('Preview/PrvImage.png',   MIN_PNG_B64, { base64: true });

    return zip.generateAsync(
        { type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } },
        function updateCallback(metadata) {
            if (onProgress) {
                onProgress(metadata.percent);
            }
        }
    );
}


// ─────────────────────────────────────────────────────────────────────────
// [검증기]
// ─────────────────────────────────────────────────────────────────────────

async function validateHwpx(blob, expectedMarginsMm = null) {
    const issues = [];
    let zip;
    try {
        zip = await JSZip.loadAsync(await blob.arrayBuffer());
    } catch (e) {
        return { pass: false, issues: ['ZIP 로드 실패: ' + e.message] };
    }

    const files = zip.files;
    const names = Object.keys(files);

    if (!names.length || names[0] !== 'mimetype') issues.push('mimetype이 ZIP 첫 항목이 아님');
    if (files['mimetype']) {
        const mime = await files['mimetype'].async('string');
        if (mime.trim() !== 'application/hwp+zip') issues.push('mimetype 내용 불일치: ' + mime.trim());
    } else {
        issues.push('mimetype 파일 없음');
    }
    for (const req of ['META-INF/container.xml', 'META-INF/container.rdf', 'META-INF/manifest.xml']) {
        if (!files[req]) issues.push('필수 메타파일 누락: ' + req);
    }
    for (const req of ['Contents/header.xml', 'Contents/section0.xml', 'Preview/PrvText.txt']) {
        if (!files[req]) issues.push('필수 파일 누락: ' + req);
    }

    if (files['Contents/section0.xml']) {
        const xml = await files['Contents/section0.xml'].async('string');
        if (!xml.includes('hancom.co.kr/hwpml/2011/section'))   issues.push('section0.xml: section 네임스페이스 없음');
        if (!xml.includes('hancom.co.kr/hwpml/2011/paragraph')) issues.push('section0.xml: paragraph 네임스페이스 없음');
        try {
            const parsed = new DOMParser().parseFromString(xml, 'application/xml');
            const err = parsed.querySelector('parsererror');
            if (err) issues.push('section0.xml XML 파싱 오류: ' + err.textContent.slice(0, 100).trim());
        } catch { issues.push('section0.xml XML 파싱 예외'); }

        const expected = marginsMmToHwp(expectedMarginsMm || DEFAULT_MARGINS_MM);
        if (/<hs:secPr\b|<hs:page\b|<hs:margin\b/.test(xml)) {
            issues.push('section0.xml: 섹션 설정 네임스페이스 오류(hs:* 대신 hp:* 필요)');
        }
        if (!/<hp:p\b[\s\S]*<hp:run\b[\s\S]*<hp:secPr\b/.test(xml)) {
            issues.push('section0.xml: hp:secPr가 hp:run 내부에 없음');
        }
        const secParaMatch = xml.match(/<hp:p\b([^>]*)>[\s\S]*?<hp:secPr\b/);
        if (!secParaMatch || !/\bid="/.test(secParaMatch[1])) {
            issues.push('section0.xml: hp:secPr를 담은 첫 문단에 id가 없음');
        }

        const marginMatch = xml.match(/<hp:margin\s+([^>]+?)\/>/);
        let marginAttrs = null;
        if (!marginMatch) {
            issues.push('section0.xml: hp:margin 없음');
        } else {
            const attrs = {};
            marginMatch[1].replace(/(\w+)="([^"]+)"/g, (_, key, value) => {
                attrs[key] = Number(value);
                return '';
            });
            marginAttrs = attrs;
            for (const key of ['left', 'right', 'top', 'bottom', 'header', 'footer']) {
                if (attrs[key] !== expected[key]) {
                    issues.push(`section0.xml: ${key} 여백 불일치 (${attrs[key]} ≠ ${expected[key]})`);
                }
            }
        }

        const pagePrMatch = xml.match(/<hp:pagePr\s+([^>]+?)>/);
        if (pagePrMatch && marginAttrs) {
            const pageAttrs = {};
            pagePrMatch[1].replace(/(\w+)="([^"]+)"/g, (_, key, value) => {
                pageAttrs[key] = Number(value);
                return '';
            });
            const expectedContentWidth = pageAttrs.width - marginAttrs.left - marginAttrs.right;
            const lineSegMatch = xml.match(/<hp:p\b[^>]*>[\s\S]*?<hp:secPr\b[\s\S]*?<hp:lineseg\b([^>]+?)\/>/);
            if (!lineSegMatch) {
                issues.push('section0.xml: hp:secPr 문단에 linesegarray가 없음');
            } else {
                const lineAttrs = {};
                lineSegMatch[1].replace(/(\w+)="([^"]+)"/g, (_, key, value) => {
                    lineAttrs[key] = Number(value);
                    return '';
                });
                if (lineAttrs.horzsize !== expectedContentWidth) {
                    issues.push(`section0.xml: 본문 폭 불일치 (${lineAttrs.horzsize} ≠ ${expectedContentWidth})`);
                }
            }
        }
    }

    if (files['Contents/header.xml'] && files['Contents/section0.xml']) {
        const header  = await files['Contents/header.xml'].async('string');
        const section = await files['Contents/section0.xml'].async('string');
        const defChar  = new Set([...header.matchAll(/charPr\s+id="(\d+)"/g)].map(m => m[1]));
        const usedChar = new Set([...section.matchAll(/charPrIDRef="(\d+)"/g)].map(m => m[1]));
        for (const id of usedChar) if (!defChar.has(id)) issues.push(`charPrIDRef="${id}" 미정의`);
        const defPara  = new Set([...header.matchAll(/paraPr\s+id="(\d+)"/g)].map(m => m[1]));
        const usedPara = new Set([...section.matchAll(/paraPrIDRef="(\d+)"/g)].map(m => m[1]));
        for (const id of usedPara) if (!defPara.has(id)) issues.push(`paraPrIDRef="${id}" 미정의`);
    }

    return { pass: issues.length === 0, issues };
}
