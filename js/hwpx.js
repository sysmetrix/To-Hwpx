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
// [이미지 단락 생성]
// ─────────────────────────────────────────────────────────────────────────

/**
 * image IR 블록 → hp:p (인라인 그림 컨트롤) XML
 * @param {object} imgBlock        IR image 블록 ({widthHwp, heightHwp, binName, ...})
 * @param {number} imgIndex        imageBlocks 배열 내 0-기반 인덱스
 * @param {number} contentWidthHwp 본문 폭(HWPUNIT) — 초과 시 비율 유지 축소
 */
function buildImageRun(imgBlock, imgIndex, contentWidthHwp = 48000) {
    const pid = _nextParaId();
    let w = imgBlock.widthHwp  || 40000;
    let h = imgBlock.heightHwp || 30000;
    // 본문 폭보다 넓으면 비율 유지하면서 축소
    if (w > contentWidthHwp) {
        h = Math.round(h * contentWidthHwp / w);
        w = contentWidthHwp;
    }
    const binId = imgIndex + 1; // 1-based
    return `<hp:p id="${pid}" paraPrIDRef="0" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0">` +
        `<hp:run charPrIDRef="0">` +
        `<hp:pic id="P${String(binId).padStart(8, '0')}" pictureType="img" reverse="0" watermark="0" picSubType="0" zOrder="0">` +
        `<hp:sz width="${w}" height="${h}"/>` +
        `<hp:pos treatAsChar="1" affectLSpacing="0" flowWithText="1" allowOverlap="0" holdAnchorAndSO="0" ` +
        `vertRelTo="PARA" horzRelTo="COLUMN" vertAlign="TOP" horzAlign="LEFT" vertOffset="0" horzOffset="0"/>` +
        `<hp:outMargin left="0" right="0" top="0" bottom="0"/>` +
        `<hp:picEffect effect="REAL_PIC" alpha="255">` +
        `<hp:imgRectangle left="0" top="0" right="${w}" bottom="${h}"/>` +
        `</hp:picEffect>` +
        `<hp:instd binDataIDRef="${binId}"/>` +
        `</hp:pic>` +
        `</hp:run>` +
        `</hp:p>`;
}


// ─────────────────────────────────────────────────────────────────────────
// [머리글/바닥글 masterPage 생성]
// ─────────────────────────────────────────────────────────────────────────

/**
 * masterPage XML 생성 (머리글/바닥글 포함)
 * header.xml 내에 포함됨 — 단락 ID는 이 파일 내에서 0-based 독립 할당
 */
function buildMasterPage(header = '', footer = '') {
    const NS_HP = 'http://www.hancom.co.kr/hwpml/2011/paragraph';
    // masterPage 단락 ID는 header.xml 스코프에서 독립적으로 0부터 할당
    let mpId = 0;
    const headerXml = header
        ? `<hh:header textDirection="HORIZONTAL" lineWrap="BREAK">` +
          `<hp:p xmlns:hp="${NS_HP}" id="${mpId++}" paraPrIDRef="0" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0">` +
          `<hp:run charPrIDRef="0"><hp:t>${xmlEsc(replaceEmoji(header))}</hp:t></hp:run>` +
          `</hp:p></hh:header>`
        : '';
    const footerXml = footer
        ? `<hh:footer textDirection="HORIZONTAL" lineWrap="BREAK">` +
          `<hp:p xmlns:hp="${NS_HP}" id="${mpId++}" paraPrIDRef="0" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0">` +
          `<hp:run charPrIDRef="0"><hp:t>${xmlEsc(replaceEmoji(footer))}</hp:t></hp:run>` +
          `</hp:p></hh:footer>`
        : '';
    return `<hh:masterPage id="0" textDirection="HORIZONTAL" protect="0">${headerXml}${footerXml}</hh:masterPage>`;
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
    if (/KoPub돋움체 Medium/i.test(name)) return 'KoPub돋움체 Bold';
    return null;
}

/**
 * HEADER_XML 동적 생성
 * @param {string}   fontName         글꼴명 (기본: 휴먼명조)
 * @param {number}   basePt           기본 본문 글꼴 크기 pt (기본: 12)
 * @param {Map}      customBfMap      표 셀 배경색 → borderFill id 맵
 * @param {Array}    imageBlocks      IR image 블록 배열
 * @param {object}   docHeaderFooter  {header?, footer?} 머리글/바닥글 텍스트
 *
 * [charPr ID]  0=본문, 1=H1, 2=H2, 3=H3, 4=H4, 5=표머리, 6=코드, 7=본문bold, 8=본문italic
 * [paraPr ID]  0=본문, 1=H1, 2=H2, 3=H3, 4=H4, 5=목록, 6=코드블록, 7=표셀(CENTER)
 * [borderFill] 1=테두리없음, 2=실선(표셀), 3=실선+회색음영(표머리)
 *              4~9=표 좌/우 바깥 테두리 제거 변형
 */
function buildHeaderXml(fontName, basePt, customBfMap = new Map(), imageBlocks = [], docHeaderFooter = {}) {
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
    const charBase = (id, height, bold = false, italic = false) => {
        const fi = (bold && boldFn) ? '1' : '0';
        const boldTag   = (bold   && !boldFn) ? '\n        <hh:bold/>'   : '';
        const italicTag = italic ? '\n        <hh:italic/>' : '';
        return `      <hh:charPr id="${id}" height="${height}" textColor="#000000" shadeColor="none" useFontSpace="0" useKerning="0" symMark="NONE" borderFillIDRef="1">
        <hh:fontRef hangul="${fi}" latin="${fi}" hanja="${fi}" japanese="${fi}" other="${fi}" symbol="${fi}" user="${fi}"/>
        <hh:ratio hangul="100" latin="100" hanja="100" japanese="100" other="100" symbol="100" user="100"/>
        <hh:spacing hangul="0" latin="0" hanja="0" japanese="0" other="0" symbol="0" user="0"/>
        <hh:relSz hangul="100" latin="100" hanja="100" japanese="100" other="100" symbol="100" user="100"/>
        <hh:offset hangul="0" latin="0" hanja="0" japanese="0" other="0" symbol="0" user="0"/>${boldTag}${italicTag}
      </hh:charPr>`;
    };

    const paraBase = (id, align, spacing, prev, next, indentLeft = 0, borderRef = '1') =>
        `      <hh:paraPr id="${id}" tabPrIDRef="0" condense="0" fontLineHeight="0" snapToGrid="1" suppressLineNumbers="0" checked="0">
        <hh:align horizontal="${align}" vertical="BASELINE"/>
        <hh:heading type="NONE" idRef="0" level="0"/>
        <hh:breakSetting breakLatinWord="KEEP_WORD" breakNonLatinWord="KEEP_WORD" widowOrphan="0" keepWithNext="0" keepLines="0" pageBreakBefore="0" lineWrap="BREAK"/>
        <hh:margin><hh:intent value="0" unit="HWPUNIT"/><hh:left value="${indentLeft}" unit="HWPUNIT"/><hh:right value="0" unit="HWPUNIT"/><hh:prev value="${prev}" unit="HWPUNIT"/><hh:next value="${next}" unit="HWPUNIT"/></hh:margin>
        <hh:lineSpacing type="PERCENT" value="${spacing}" unit="HWPUNIT"/>
        <hh:border borderFillIDRef="${borderRef}" offsetLeft="0" offsetRight="0" offsetTop="0" offsetBottom="0" connect="0" ignoreMargin="0"/>
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
    <hh:charProperties itemCnt="10">
      <!-- 0=본문, 1=H1 bold, 2=H2 bold, 3=H3 bold, 4=H4 bold, 5=표머리 bold, 6=코드, 7=본문bold, 8=본문italic, 9=본문bold+italic -->
${charBase(0, sz.body,  false, false)}
${charBase(1, sz.h1,   true,  false)}
${charBase(2, sz.h2,   true,  false)}
${charBase(3, sz.h3,   true,  false)}
${charBase(4, sz.h4,   true,  false)}
${charBase(5, sz.tblHd,true,  false)}
${charBase(6, sz.code, false, false).replace('"#000000"', '"#333333"')}
${charBase(7, sz.body, true,  false)}
${charBase(8, sz.body, false, true)}
${charBase(9, sz.body, true,  true)}
    </hh:charProperties>
    <hh:paraProperties itemCnt="14">
      <!-- id  정렬    행간  전    후   들여  테두리참조 -->
${paraBase(0, 'JUSTIFY', 160,   0,  850,    0)}
${paraBase(1, 'LEFT',    180, 850,  567,    0)}
${paraBase(2, 'LEFT',    170, 700,  425,    0)}
${paraBase(3, 'LEFT',    160, 567,  283,    0)}
${paraBase(4, 'LEFT',    160, 425,  200,    0)}
${paraBase(5, 'LEFT',    160,   0,  100,  600)}
${paraBase(6, 'LEFT',    140, 200,  200,  400)}
      <!-- id=7  표 셀 가운데 정렬 -->
${paraBase(7, 'CENTER',  150,   0,    0,    0)}
      <!-- id=8  구분선(HR): 위아래 여백을 넉넉히 둔 하단 테두리 -->
${paraBase(8, 'LEFT',    130, 850,  850,    0, '10')}
      <!-- id=9  빈 줄 간격 조절용: 추가 여백 없음 -->
${paraBase(9, 'LEFT',    100,   0,    0,    0)}
      <!-- id=10/11  표 일반 셀: 텍스트 왼쪽, 숫자 오른쪽 정렬 -->
${paraBase(10, 'LEFT',   150,   0,    0,    0)}
${paraBase(11, 'RIGHT',  150,   0,    0,    0)}
      <!-- id=12/13  DOCX 정렬 보존: 가운데/오른쪽 -->
${paraBase(12, 'CENTER', 160,   0,  850,    0)}
${paraBase(13, 'RIGHT',  160,   0,  850,    0)}
    </hh:paraProperties>
    <hh:borderFills itemCnt="${10 + customBfMap.size}">
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
        <hh:fillBrush><hh:winBrush faceColor="#D9D9D9" hatchColor="#000000" alpha="0"/></hh:fillBrush>
      </hh:borderFill>
      <!-- id=4 일반 셀: 왼쪽 바깥 테두리 없음 -->
      <hh:borderFill id="4" threeD="0" shadow="0" centerLine="NONE" breakCellSeparateLine="0">
        <hh:slash type="NONE" Crooked="0" isCounter="0"/><hh:backSlash type="NONE" Crooked="0" isCounter="0"/>
        <hh:leftBorder type="NONE" width="0.1 mm" color="#000000"/>
        <hh:rightBorder type="SOLID" width="0.12 mm" color="#000000"/>
        <hh:topBorder type="SOLID" width="0.12 mm" color="#000000"/>
        <hh:bottomBorder type="SOLID" width="0.12 mm" color="#000000"/>
        <hh:diagonal type="SOLID" width="0.1 mm" color="#000000"/>
      </hh:borderFill>
      <!-- id=5 일반 셀: 오른쪽 바깥 테두리 없음 -->
      <hh:borderFill id="5" threeD="0" shadow="0" centerLine="NONE" breakCellSeparateLine="0">
        <hh:slash type="NONE" Crooked="0" isCounter="0"/><hh:backSlash type="NONE" Crooked="0" isCounter="0"/>
        <hh:leftBorder type="SOLID" width="0.12 mm" color="#000000"/>
        <hh:rightBorder type="NONE" width="0.1 mm" color="#000000"/>
        <hh:topBorder type="SOLID" width="0.12 mm" color="#000000"/>
        <hh:bottomBorder type="SOLID" width="0.12 mm" color="#000000"/>
        <hh:diagonal type="SOLID" width="0.1 mm" color="#000000"/>
      </hh:borderFill>
      <!-- id=6 표 머리글: 왼쪽 바깥 테두리 없음 -->
      <hh:borderFill id="6" threeD="0" shadow="0" centerLine="NONE" breakCellSeparateLine="0">
        <hh:slash type="NONE" Crooked="0" isCounter="0"/><hh:backSlash type="NONE" Crooked="0" isCounter="0"/>
        <hh:leftBorder type="NONE" width="0.1 mm" color="#000000"/>
        <hh:rightBorder type="SOLID" width="0.12 mm" color="#000000"/>
        <hh:topBorder type="SOLID" width="0.12 mm" color="#000000"/>
        <hh:bottomBorder type="SOLID" width="0.12 mm" color="#000000"/>
        <hh:diagonal type="SOLID" width="0.1 mm" color="#000000"/>
        <hh:fillBrush><hh:winBrush faceColor="#D9D9D9" hatchColor="#000000" alpha="0"/></hh:fillBrush>
      </hh:borderFill>
      <!-- id=7 표 머리글: 오른쪽 바깥 테두리 없음 -->
      <hh:borderFill id="7" threeD="0" shadow="0" centerLine="NONE" breakCellSeparateLine="0">
        <hh:slash type="NONE" Crooked="0" isCounter="0"/><hh:backSlash type="NONE" Crooked="0" isCounter="0"/>
        <hh:leftBorder type="SOLID" width="0.12 mm" color="#000000"/>
        <hh:rightBorder type="NONE" width="0.1 mm" color="#000000"/>
        <hh:topBorder type="SOLID" width="0.12 mm" color="#000000"/>
        <hh:bottomBorder type="SOLID" width="0.12 mm" color="#000000"/>
        <hh:diagonal type="SOLID" width="0.1 mm" color="#000000"/>
        <hh:fillBrush><hh:winBrush faceColor="#D9D9D9" hatchColor="#000000" alpha="0"/></hh:fillBrush>
      </hh:borderFill>
      <!-- id=8 일반 셀: 좌우 바깥 테두리 없음 (1열 표) -->
      <hh:borderFill id="8" threeD="0" shadow="0" centerLine="NONE" breakCellSeparateLine="0">
        <hh:slash type="NONE" Crooked="0" isCounter="0"/><hh:backSlash type="NONE" Crooked="0" isCounter="0"/>
        <hh:leftBorder type="NONE" width="0.1 mm" color="#000000"/>
        <hh:rightBorder type="NONE" width="0.1 mm" color="#000000"/>
        <hh:topBorder type="SOLID" width="0.12 mm" color="#000000"/>
        <hh:bottomBorder type="SOLID" width="0.12 mm" color="#000000"/>
        <hh:diagonal type="SOLID" width="0.1 mm" color="#000000"/>
      </hh:borderFill>
      <!-- id=9 표 머리글: 좌우 바깥 테두리 없음 (1열 표) -->
      <hh:borderFill id="9" threeD="0" shadow="0" centerLine="NONE" breakCellSeparateLine="0">
        <hh:slash type="NONE" Crooked="0" isCounter="0"/><hh:backSlash type="NONE" Crooked="0" isCounter="0"/>
        <hh:leftBorder type="NONE" width="0.1 mm" color="#000000"/>
        <hh:rightBorder type="NONE" width="0.1 mm" color="#000000"/>
        <hh:topBorder type="SOLID" width="0.12 mm" color="#000000"/>
        <hh:bottomBorder type="SOLID" width="0.12 mm" color="#000000"/>
        <hh:diagonal type="SOLID" width="0.1 mm" color="#000000"/>
        <hh:fillBrush><hh:winBrush faceColor="#D9D9D9" hatchColor="#000000" alpha="0"/></hh:fillBrush>
      </hh:borderFill>
      <!-- id=10 구분선(HR)용: 하단 테두리만 실선 0.4mm 회색 -->
      <hh:borderFill id="10" threeD="0" shadow="0" centerLine="NONE" breakCellSeparateLine="0">
        <hh:slash type="NONE" Crooked="0" isCounter="0"/><hh:backSlash type="NONE" Crooked="0" isCounter="0"/>
        <hh:leftBorder type="NONE" width="0.1 mm" color="#000000"/>
        <hh:rightBorder type="NONE" width="0.1 mm" color="#000000"/>
        <hh:topBorder type="NONE" width="0.1 mm" color="#000000"/>
        <hh:bottomBorder type="SOLID" width="0.4 mm" color="#555555"/>
        <hh:diagonal type="SOLID" width="0.1 mm" color="#000000"/>
      </hh:borderFill>
${[...customBfMap.entries()].map(([key, bfId]) => {
    const [color, variant = 'full'] = String(key).split(':');
    const noLeft = variant === 'left' || variant === 'both';
    const noRight = variant === 'right' || variant === 'both';
    return `      <!-- id=${bfId} DOCX 셀 배경색 #${color}${variant === 'full' ? '' : ` (${variant})`} -->
      <hh:borderFill id="${bfId}" threeD="0" shadow="0" centerLine="NONE" breakCellSeparateLine="0">
        <hh:slash type="NONE" Crooked="0" isCounter="0"/><hh:backSlash type="NONE" Crooked="0" isCounter="0"/>
        <hh:leftBorder type="${noLeft ? 'NONE' : 'SOLID'}" width="${noLeft ? '0.1' : '0.12'} mm" color="#000000"/>
        <hh:rightBorder type="${noRight ? 'NONE' : 'SOLID'}" width="${noRight ? '0.1' : '0.12'} mm" color="#000000"/>
        <hh:topBorder type="SOLID" width="0.12 mm" color="#000000"/>
        <hh:bottomBorder type="SOLID" width="0.12 mm" color="#000000"/>
        <hh:diagonal type="SOLID" width="0.1 mm" color="#000000"/>
        <hh:fillBrush><hh:winBrush faceColor="#${color}" hatchColor="#000000" alpha="0"/></hh:fillBrush>
      </hh:borderFill>`;
}).join('\n')}
    </hh:borderFills>
${imageBlocks.length
    ? `    <hh:binDataList itemCnt="${imageBlocks.length}">
${imageBlocks.map((img, i) => {
        const fmt = img.binName.split('.').pop().toUpperCase();
        return `      <hh:binData id="${i + 1}" type="EMBED" format="${fmt}" compress="COMPRESS" inAccessible="0">BinData/${img.binName}</hh:binData>`;
    }).join('\n')}
    </hh:binDataList>`
    : ''}
  </hh:refList>
${(docHeaderFooter.header || docHeaderFooter.footer)
    ? `  <hh:masterPages itemCnt="1">${buildMasterPage(docHeaderFooter.header || '', docHeaderFooter.footer || '')}</hh:masterPages>`
    : `  <hh:masterPages itemCnt="0"/>`}
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

let _footnoteIdCounter = 1;
function _nextFootnoteId() { return _footnoteIdCounter++; }
function _resetFootnoteId() { _footnoteIdCounter = 1; }

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

/**
 * 인라인 runs 배열(bold/italic/code 플래그) → 단락 XML
 * parsers.js extractInlineRuns()가 생성한 runs 배열을 처리한다.
 * charPr ID: 0=본문, 6=코드, 7=본문bold, 8=본문italic, 9=본문bold+italic
 * run.footnote 가 있는 경우 각주 컨트롤(hp:ctrl) 을 삽입한다.
 */
function buildParaRuns(runs, paraId = '0') {
    const pid = _nextParaId();
    let runsXml = '';
    let ctrlsXml = '';   // 각주 컨트롤은 run 뒤에 배치
    for (const run of (runs || [])) {
        if (run.footnote) {
            ctrlsXml += buildFootnoteCtrl(run.footnote);
            continue;
        }
        if (!run.text) continue;
        const safe = xmlEsc(replaceEmoji(run.text));
        let cId = '0';
        if      (run.code)               cId = '6';
        else if (run.bold && run.italic) cId = '9';
        else if (run.bold)               cId = '7';
        else if (run.italic)             cId = '8';
        runsXml += `<hp:run charPrIDRef="${cId}"><hp:t>${safe}</hp:t></hp:run>`;
    }
    if (!runsXml && !ctrlsXml) return buildBlankPara();
    return `<hp:p id="${pid}" paraPrIDRef="${paraId}" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0">${runsXml}${ctrlsXml}</hp:p>`;
}

/**
 * 빈 단락 (빈 줄 간격 표현용) — paraPr id=9(여백 없음) 사용
 * 본문 paraPr(id=0)의 next=850 여백이 중복 적용되지 않도록 별도 스타일 사용
 */
function buildBlankPara() {
    const pid = _nextParaId();
    return `<hp:p id="${pid}" paraPrIDRef="9" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0">` +
        `<hp:run charPrIDRef="0"><hp:t> </hp:t></hp:run></hp:p>`;
}

/** 구분선(HR) 단락 — paraPr id=8(하단 테두리 실선) 사용 */
function buildHrPara() {
    const pid = _nextParaId();
    return `<hp:p id="${pid}" paraPrIDRef="8" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0">` +
        `<hp:run charPrIDRef="0"><hp:t> </hp:t></hp:run></hp:p>`;
}

/**
 * 각주(footnote) 컨트롤 XML 생성
 * HWPX의 hp:ctrl type="FOOTNOTE" 구조를 사용한다.
 */
function buildFootnoteCtrl(footnoteText) {
    const fnId = _nextFootnoteId();
    const pid  = _nextParaId();
    return `<hp:ctrl ctrlID="${fnId}" type="FOOTNOTE">` +
        `<hp:fnote id="${fnId}" autoNum="1">` +
        `<hp:p id="${pid}" paraPrIDRef="0" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0">` +
        `<hp:run charPrIDRef="0"><hp:t>${xmlEsc(replaceEmoji(footnoteText))}</hp:t></hp:run>` +
        `</hp:p>` +
        `</hp:fnote>` +
        `</hp:ctrl>`;
}

/** heading level → charId / paraId 매핑 (1→H1, 2→H2, 3→H3, 4+→H4) */
function headingIds(level) {
    const lv = Math.max(1, Math.min(level || 1, 4));
    return { charId: String(lv), paraId: String(lv) };
}

/**
 * 표 열 너비를 셀 내용 길이에 비례하여 계산
 * 한글 글자(2바이트)는 2배, 영문/숫자(1바이트)는 1로 환산
 * 최소 열 너비 3000 HWPUNIT(≈10.6mm) 보장, 최대 40자로 상한
 */
function cellText(cell)    { return typeof cell === 'object' ? (cell?.text ?? '') : String(cell ?? ''); }
function cellBg(cell)     { return typeof cell === 'object' ? (cell?.bg  || null) : null; }
function cellColSpan(cell) { return typeof cell === 'object' ? (cell?.colSpan || 1) : 1; }
function cellRowSpan(cell) { return typeof cell === 'object' ? (cell?.rowSpan || 1) : 1; }

function tableSideVariant(nCols, logicalC, colSpan) {
    if (nCols === 1) return 'both';
    if (logicalC === 0) return 'left';
    if (logicalC + colSpan >= nCols) return 'right';
    return 'full';
}

function bgBorderKey(color, variant = 'full') {
    return `${color}:${variant}`;
}

function addBgBorderFillVariants(customBfMap, color, nextId) {
    for (const variant of ['full', 'left', 'right', 'both']) {
        const key = bgBorderKey(color, variant);
        if (!customBfMap.has(key)) {
            customBfMap.set(key, String(nextId++));
        }
    }
    return nextId;
}

function getColumnWidths(allRows, nCols, tableWidth) {
    const MIN_COL = 3000;
    if (nCols <= 1) return [tableWidth];

    const maxLens = new Array(nCols).fill(1);
    for (const row of allRows) {
        for (let c = 0; c < nCols; c++) {
            const cellStr = cellText(row && row[c] !== undefined ? row[c] : '');
            const len = Math.min(
                Array.from(cellStr).reduce((s, ch) =>
                    s + (/[ᄀ-퟿가-힯　-〿]/.test(ch) ? 2 : 1), 0),
                40
            );
            maxLens[c] = Math.max(maxLens[c], len);
        }
    }

    const totalLen = maxLens.reduce((a, b) => a + b, 0);
    const usable = tableWidth - MIN_COL * nCols;
    if (usable <= 0) {
        const eq = Math.floor(tableWidth / nCols);
        return new Array(nCols).fill(eq);
    }

    const widths = maxLens.map(len => Math.round(MIN_COL + (len / totalLen) * usable));
    const diff = tableWidth - widths.reduce((a, b) => a + b, 0);
    widths[widths.length - 1] += diff;
    return widths;
}

/**
 * 표(hp:tbl) XML 생성
 * 헤더=가운데, 일반 텍스트=왼쪽, 숫자=오른쪽 정렬로 가독성을 높인다.
 */
function isNumericCell(value) {
    const s = String(value || '').trim();
    if (!s) return false;
    return /^[-+]?[\d,]+(\.\d+)?%?$/.test(s)
        || /^[-+]?\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)
        || /^[₩$€¥]\s?[-+]?[\d,]+(\.\d+)?$/.test(s);
}

function getContentWidthHwp(marginsHwp, paperKey, landscape = false) {
    const paperBase = PAPER_SIZES[paperKey] || PAPER_SIZES['A4'];
    const paper = landscape ? { w: paperBase.h, h: paperBase.w } : paperBase;
    const m = Object.assign({}, DEFAULT_MARGINS_HWP, marginsHwp || {});
    return Math.max(12000, paper.w - m.left - m.right);
}

function buildTable(header, rows, contentWidthHwp = 48000, customBfMap = new Map()) {
    const allRows = (header && header.length ? [header] : []).concat(rows || []);
    if (!allRows.length) return buildBlankPara();

    const nRows = allRows.length;
    // 열 수: 각 행의 셀 수 + colSpan - 1 합산으로 실제 논리 열 수 계산
    const nCols = Math.max(...allRows.map(r =>
        (r || []).reduce((sum, cell) => sum + (cellColSpan(cell) || 1), 0)
    ), 1);
    const tableWidth = Math.max(12000, contentWidthHwp);
    const colWidths = getColumnWidths(allRows, nCols, tableWidth);
    const pid = _nextParaId();

    let rowsXml = '';
    for (let r = 0; r < nRows; r++) {
        const row  = allRows[r] || [];
        const isHd = (header && header.length && r === 0);
        const cId  = isHd ? '5' : '0';   // 표머리=5(bold), 일반=0
        let cellsXml = '';
        let logicalC = 0;   // 논리 열 인덱스 (colSpan 누적)

        for (let ci = 0; ci < row.length; ci++) {
            const cell = (row[ci] !== undefined && row[ci] !== null) ? row[ci] : '';

            // 세로 병합 연속 셀(rowSpan=0)은 출력 건너뜀
            if (cellRowSpan(cell) === 0) {
                logicalC += cellColSpan(cell);
                continue;
            }

            const val  = cellText(cell);
            const bg   = cellBg(cell);
            const cs   = cellColSpan(cell);
            const rs   = cellRowSpan(cell);
            const paraId = isHd ? '7' : (isNumericCell(val) ? '11' : '10');
            let bfId;
            if (bg) {
                const variant = tableSideVariant(nCols, logicalC, cs);
                bfId = customBfMap.get(bgBorderKey(bg, variant))
                    || customBfMap.get(bgBorderKey(bg, 'full'));
            }
            if (!bfId) {
                if (nCols === 1) {
                    bfId = isHd ? '9' : '8';
                } else if (logicalC === 0) {
                    bfId = isHd ? '6' : '4';
                } else if (logicalC + cs >= nCols) {
                    bfId = isHd ? '7' : '5';
                } else {
                    bfId = isHd ? '3' : '2';
                }
            }
            // 병합 셀 너비: 해당 논리 열부터 colSpan 열까지 합산
            const cellWidth = colWidths.slice(logicalC, logicalC + cs).reduce((a, b) => a + b, 0);
            // 자식 순서: subList → cellAddr → cellSpan → cellSz → cellMargin
            // (rhwp serializer/hwpx/table.rs 기준 OWPML 공식 순서)
            cellsXml +=
                `<hp:tc name="" header="${isHd ? '1' : '0'}" hasMargin="1" protect="0" editable="0" dirty="0" borderFillIDRef="${bfId}">` +
                `<hp:subList id="" textDirection="HORIZONTAL" lineWrap="BREAK" vertAlign="CENTER" ` +
                    `linkListIDRef="0" linkListNextIDRef="0" textWidth="0" textHeight="0" hasTextRef="0" hasNumRef="0">` +
                buildPara(val, cId, paraId) +
                `</hp:subList>` +
                `<hp:cellAddr colAddr="${logicalC}" rowAddr="${r}"/>` +
                `<hp:cellSpan colSpan="${cs}" rowSpan="${rs}"/>` +
                `<hp:cellSz width="${cellWidth}" height="1200"/>` +
                `<hp:cellMargin left="650" right="650" top="220" bottom="220"/>` +
                `</hp:tc>`;
            logicalC += cs;
        }
        // <hp:tr>은 속성 없음 (rhwp 기준); header 마킹은 <hp:tc>에만 적용
        rowsXml += `<hp:tr>${cellsXml}</hp:tr>`;
    }

    // pageBreak="ROW" → 행 경계에서 쪽 넘김 허용 (긴 표가 다음 페이지로 이어짐)
    //      height="0" → HWP이 셀 내용 기준으로 자동 계산 (고정값 제거)
    return `<hp:p id="${pid}" paraPrIDRef="0" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0"><hp:run charPrIDRef="0">` +
        `<hp:tbl id="0" zOrder="0" numberingType="TABLE" textWrap="TOP_AND_BOTTOM" ` +
        `textFlow="BOTH_SIDES" lock="0" dropcapstyle="None" pageBreak="ROW" ` +
        `repeatHeader="1" rowCnt="${nRows}" colCnt="${nCols}" cellSpacing="0" borderFillIDRef="1">` +
        `<hp:sz width="${tableWidth}" widthRelTo="ABSOLUTE" height="0" heightRelTo="ABSOLUTE" protect="0"/>` +
        `<hp:pos treatAsChar="1" affectLSpacing="0" flowWithText="1" allowOverlap="0" holdAnchorAndSO="0" ` +
        `vertRelTo="PARA" horzRelTo="COLUMN" vertAlign="TOP" horzAlign="LEFT" vertOffset="0" horzOffset="0"/>` +
        `<hp:outMargin left="0" right="0" top="0" bottom="0"/>` +
        `<hp:inMargin left="650" right="650" top="220" bottom="220"/>` +
        `${rowsXml}` +
        `</hp:tbl><hp:t></hp:t></hp:run></hp:p>`;
}

/**
 * 페이지 설정(secPr) XML
 * HWPX 스키마 기준 secPr는 paragraph 네임스페이스이며 hp:run 내부에 위치한다.
 */
function buildSecPr(marginsHwp, paperKey, landscape = false, hasMasterPage = false) {
    const paperBase = PAPER_SIZES[paperKey] || PAPER_SIZES['A4'];
    const paper = landscape ? { w: paperBase.h, h: paperBase.w } : paperBase;
    const m = Object.assign({}, DEFAULT_MARGINS_HWP, marginsHwp || {});
    return `<hp:secPr id="" textDirection="HORIZONTAL" spaceColumns="1134" tabStop="8000" ` +
        `tabStopVal="4000" tabStopUnit="HWPUNIT" outlineShapeIDRef="0" memoShapeIDRef="0" ` +
        `textVerticalWidthHead="0" masterPageCnt="${hasMasterPage ? 1 : 0}">` +
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
function buildSection(ir, marginsHwp, paperKey, landscape = false, customBfMap = new Map()) {
    const NS_HS = 'http://www.hancom.co.kr/hwpml/2011/section';
    const NS_HP = 'http://www.hancom.co.kr/hwpml/2011/paragraph';
    const docType = ir.doc_type || 'plain';

    // 섹션마다 문단 ID 및 각주 ID를 재시작
    _resetParaId();
    _resetFootnoteId();

    // 이미지 블록 목록 (빈 배열이면 이미지 없음)
    const imageBlocks = (ir.blocks || []).filter(b => b.type === 'image');
    const hasMasterPage = !!(ir.header || ir.footer);

    const contentWidthHwp = getContentWidthHwp(marginsHwp, paperKey, landscape);
    const parts = [];
    parts.push(buildSectionBootstrap(buildSecPr(marginsHwp, paperKey, landscape, hasMasterPage), contentWidthHwp));

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
            const alignParaId = block.align === 'center' ? '12' : block.align === 'right' ? '13' : '0';
            if (block.runs && block.runs.length > 0) {
                // 인라인 서식(bold/italic/code) 보존 경로
                const hasText = block.runs.some(r => r.text && r.text.trim());
                parts.push(hasText ? buildParaRuns(block.runs, alignParaId) : buildBlankPara());
            } else if (!block.text || !block.text.trim()) {
                parts.push(buildBlankPara());
            } else {
                parts.push(buildPara(block.text, '0', alignParaId));
            }

        } else if (bt === 'blank') {
            // 명시적 빈 줄 블록
            parts.push(buildBlankPara());

        } else if (bt === 'hr') {
            // 구분선 → 하단 테두리 실선 단락
            parts.push(buildHrPara());

        } else if (bt === 'list') {
            (block.items || []).forEach((item, i) => {
                const prefix = block.ordered ? `${i + 1}. ` : '· ';
                parts.push(buildPara(prefix + item, '0', '5'));
            });

        } else if (bt === 'table') {
            parts.push(buildTable(block.header, block.rows, contentWidthHwp, customBfMap));

        } else if (bt === 'code') {
            const lines = (block.text || '').split('\n');
            lines.forEach(line => parts.push(buildPara(line === '' ? ' ' : line, '6', '6')));

        } else if (bt === 'image') {
            const imgIndex = imageBlocks.indexOf(block);
            if (imgIndex >= 0) {
                parts.push(buildImageRun(block, imgIndex, contentWidthHwp));
            }

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
 * @param {string} orientation   용지 방향 "portrait"|"landscape"
 */
async function buildHwpx(ir, fontName = '휴먼명조', fontSize = 12, marginsMm = null, paperSize = 'A4', onProgress = null, orientation = 'portrait') {
    if (typeof JSZip === 'undefined') throw new Error('JSZip 미로드: 인터넷 연결을 확인하세요.');

    const marginsHwp = marginsMmToHwp(marginsMm || DEFAULT_MARGINS_MM);
    const landscape  = orientation === 'landscape';

    // 표 셀 배경색 수집 → 동적 borderFill 생성용
    const customBfMap = new Map();
    let nextBfId = 11;
    for (const block of (ir.blocks || [])) {
        if (block.type !== 'table') continue;
        const allRows = (block.header && block.header.length ? [block.header] : []).concat(block.rows || []);
        for (const row of allRows) {
            for (const cell of (row || [])) {
                const bg = cellBg(cell);
                if (bg) {
                    nextBfId = addBgBorderFillVariants(customBfMap, bg, nextBfId);
                }
            }
        }
    }

    // 이미지 블록 수집
    const imageBlocks = (ir.blocks || []).filter(b => b.type === 'image');
    const docHeaderFooter = { header: ir.header || '', footer: ir.footer || '' };

    const headerXml   = buildHeaderXml(fontName, fontSize, customBfMap, imageBlocks, docHeaderFooter);
    const section0Xml = buildSection(ir, marginsHwp, paperSize, landscape, customBfMap);

    // 이미지가 있을 때 manifest를 동적으로 생성하여 BinData 파일 선언
    const manifestXml = imageBlocks.length
        ? `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<odf:manifest xmlns:odf="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" version="1.2">
  <odf:file-entry odf:full-path="/" odf:media-type="application/hwp+zip"/>
  <odf:file-entry odf:full-path="Contents/header.xml" odf:media-type="application/xml"/>
  <odf:file-entry odf:full-path="Contents/section0.xml" odf:media-type="application/xml"/>
${imageBlocks.map(img => `  <odf:file-entry odf:full-path="BinData/${img.binName}" odf:media-type="${img.mimeType}"/>`).join('\n')}
</odf:manifest>`
        : MANIFEST_XML;

    const zip = new JSZip();
    zip.file('mimetype',              MIMETYPE,      { compression: 'STORE' });
    zip.file('version.xml',           VERSION_XML);
    zip.file('settings.xml',          SETTINGS_XML);
    zip.file('META-INF/container.xml', CONTAINER_XML);
    zip.file('META-INF/container.rdf', CONTAINER_RDF);
    zip.file('META-INF/manifest.xml',  manifestXml);
    zip.file('Contents/header.xml',    headerXml);
    zip.file('Contents/section0.xml',  section0Xml);
    zip.file('Contents/content.hpf',   CONTENT_HPF);
    zip.file('Preview/PrvText.txt',    ir.title || 'To HWPX 변환 문서');
    zip.file('Preview/PrvImage.png',   MIN_PNG_B64, { base64: true });

    // 이미지 바이너리를 BinData/ 폴더에 추가
    imageBlocks.forEach(img => {
        zip.file(`BinData/${img.binName}`, img.data);
    });

    return zip.generateAsync(
        { type: 'blob', mimeType: MIMETYPE, compression: 'DEFLATE', compressionOptions: { level: 6 } },
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
        if (typeof DOMParser !== 'undefined') {
            try {
                const parsed = new DOMParser().parseFromString(xml, 'application/xml');
                const err = parsed.querySelector('parsererror');
                if (err) issues.push('section0.xml XML 파싱 오류: ' + err.textContent.slice(0, 100).trim());
            } catch (e) {
                issues.push('section0.xml XML 파싱 예외: ' + e.message);
            }
        }

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
        const defBorder = new Set([...header.matchAll(/borderFill\s+id="(\d+)"/g)].map(m => m[1]));
        const usedBorder = new Set([
            ...header.matchAll(/borderFillIDRef="(\d+)"/g),
            ...section.matchAll(/borderFillIDRef="(\d+)"/g),
        ].map(m => m[1]));
        for (const id of usedBorder) if (!defBorder.has(id)) issues.push(`borderFillIDRef="${id}" 미정의`);
    }

    return { pass: issues.length === 0, issues };
}
