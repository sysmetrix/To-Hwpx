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
 *   ⑧ buildSection docType 분기 (titleblock=상단 제목 블록 / plain=없음)
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
    'A3':     { w: 84189, h: 119055 },   // 297 × 420 mm
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

function normalizeLineSpacingPercent(value = 160) {
    const n = parseInt(value, 10);
    return [130, 150, 160, 180, 200].includes(n) ? n : 160;
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

/**
 * content.hpf 동적 생성 — 이미지가 있으면 opf:manifest에 BinData를 선언한다.
 * 그림(hc:img@binaryItemIDRef)이 참조하는 id = 여기 opf:item@id (binName에서 확장자 제외).
 * (한컴 호환 라이브러리 hwpxlib SimplePicture.hwpx 기준)
 */
function buildContentHpf(imageBlocks = []) {
    const items = imageBlocks.map(img => {
        const id  = String(img.binName).replace(/\.[^.]+$/, '');
        const ext = String(img.binName).split('.').pop().toLowerCase();
        const mt  = 'image/' + (ext === 'jpeg' ? 'jpg' : ext);
        return `    <opf:item id="${id}" href="BinData/${img.binName}" media-type="${mt}" isEmbeded="1"/>`;
    }).join('\n');
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<opf:package xmlns:opf="http://www.idpf.org/2007/opf/" xmlns:hp="http://www.hancom.co.kr/hwpml/2011/paragraph" xmlns:hc="http://www.hancom.co.kr/hwpml/2011/core" xmlns:hh="http://www.hancom.co.kr/hwpml/2011/head" xmlns:hs="http://www.hancom.co.kr/hwpml/2011/section" xmlns:hpf="http://www.hancom.co.kr/schema/2011/hpf" version="" unique-identifier="" id="">
  <opf:metadata><opf:title>HWPX Document</opf:title></opf:metadata>
  <opf:manifest>
    <opf:item id="header" href="Contents/header.xml" media-type="application/xml"/>
${items ? items + '\n' : ''}    <opf:item id="section0" href="Contents/section0.xml" media-type="application/xml"/>
  </opf:manifest>
  <opf:spine><opf:itemref idref="section0" linear="yes"/></opf:spine>
</opf:package>`;
}


// ─────────────────────────────────────────────────────────────────────────
// [XML 유틸리티]
// ─────────────────────────────────────────────────────────────────────────

/** XML 특수문자 이스케이프 */
function xmlEsc(s) {
    return String(s == null ? '' : s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
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
    // 그림 바이너리 참조 id = content.hpf manifest의 opf:item id = binName(확장자 제외)
    const imgId   = String(imgBlock.binName || `image${imgIndex + 1}`).replace(/\.[^.]+$/, '');
    const shapeId = 1500000000 + imgIndex;
    const instId  = 1600000000 + imgIndex;
    // OWPML 정식 그림 구조 (hwpxlib SimplePicture.hwpx 기준). hc: 요소는 section0 루트에 xmlns:hc 선언됨.
    return `<hp:p id="${pid}" paraPrIDRef="0" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0">` +
        `<hp:run charPrIDRef="0">` +
        `<hp:pic id="${shapeId}" zOrder="0" numberingType="PICTURE" textWrap="TOP_AND_BOTTOM" ` +
        `textFlow="BOTH_SIDES" lock="0" dropcapstyle="None" href="" groupLevel="0" instid="${instId}" reverse="0">` +
        `<hp:offset x="0" y="0"/>` +
        `<hp:orgSz width="${w}" height="${h}"/>` +
        `<hp:curSz width="${w}" height="${h}"/>` +
        `<hp:flip horizontal="0" vertical="0"/>` +
        `<hp:rotationInfo angle="0" centerX="${Math.round(w / 2)}" centerY="${Math.round(h / 2)}" rotateimage="1"/>` +
        `<hp:renderingInfo>` +
        `<hc:transMatrix e1="1" e2="0" e3="0" e4="0" e5="1" e6="0"/>` +
        `<hc:scaMatrix e1="1" e2="0" e3="0" e4="0" e5="1" e6="0"/>` +
        `<hc:rotMatrix e1="1" e2="0" e3="0" e4="0" e5="1" e6="0"/>` +
        `</hp:renderingInfo>` +
        `<hp:imgRect><hc:pt0 x="0" y="0"/><hc:pt1 x="${w}" y="0"/><hc:pt2 x="${w}" y="${h}"/><hc:pt3 x="0" y="${h}"/></hp:imgRect>` +
        `<hp:imgClip left="0" right="${w}" top="0" bottom="${h}"/>` +
        `<hp:inMargin left="0" right="0" top="0" bottom="0"/>` +
        `<hp:imgDim dimwidth="${w}" dimheight="${h}"/>` +
        `<hc:img binaryItemIDRef="${imgId}" bright="0" contrast="0" effect="REAL_PIC" alpha="0"/>` +
        `<hp:sz width="${w}" widthRelTo="ABSOLUTE" height="${h}" heightRelTo="ABSOLUTE" protect="0"/>` +
        `<hp:pos treatAsChar="1" affectLSpacing="0" flowWithText="1" allowOverlap="0" holdAnchorAndSO="0" ` +
        `vertRelTo="PARA" horzRelTo="COLUMN" vertAlign="TOP" horzAlign="CENTER" vertOffset="0" horzOffset="0"/>` +
        `<hp:outMargin left="0" right="0" top="0" bottom="0"/>` +
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
 * @param {number}   lineSpacingPercent 본문 줄 간격 퍼센트
 *
 * [charPr ID]  0=본문, 1=H1, 2=H2, 3=H3, 4=H4, 5=표머리, 6=코드, 7=본문bold, 8=본문italic
 * [paraPr ID]  0=본문, 1=H1, 2=H2, 3=H3, 4=H4, 5=목록, 6=코드블록, 7=표셀(CENTER), 19=인용
 * [borderFill] 1=테두리없음, 2=실선(표셀), 3=실선+회색음영(표머리)
 *              4~9=표 좌/우 바깥 테두리 제거 변형
 */
function buildHeaderXml(fontName, basePt, customBfMap = new Map(), imageBlocks = [], docHeaderFooter = {}, customCharMap = new Map(), lineSpacingPercent = 160) {
    const resolvedFontName = fontName || '휴먼명조';
    const fn = xmlEsc(resolvedFontName);
    const bp = Math.max(6, Math.min(36, parseInt(basePt, 10) || 12));
    const bodyLineSpacing = normalizeLineSpacingPercent(lineSpacingPercent);
    const h1LineSpacing = Math.max(bodyLineSpacing, 180);
    const h2LineSpacing = Math.max(bodyLineSpacing, 170);
    const { familyType, weight, type } = getFontMeta(resolvedFontName);
    // 현재 PC의 실제 등록명을 주 글꼴로 쓰고 반대 등록명을 OWPML 대체 글꼴로 둔다.
    const substFontName = resolvedFontName === 'Pretendard GOV Variable'
        ? 'Pretendard GOV'
        : (resolvedFontName === 'Pretendard GOV' ? 'Pretendard GOV Variable' : null);
    const substFontTag = substFontName
        ? `\n          <hh:substFont face="${xmlEsc(substFontName)}" type="TTF" isEmbedded="0"/>`
        : '';

    // KoPubWorld Dotum Medium처럼 Bold가 별도 폰트 파일인 경우
    const boldFontName = getBoldFontName(resolvedFontName);
    const boldFn = boldFontName ? xmlEsc(boldFontName) : null;
    const totalFontCnt = boldFn ? 2 : 1;

    // 글자 크기 HWPUNIT (1pt = 100)
    const sz = {
        body:  bp * 100,
        h1:    (bp + 6) * 100,
        h2:    (bp + 4) * 100,
        h3:    (bp + 2) * 100,
        h4:    (bp + 1) * 100,
        h5:    bp * 100,                        // H5: 본문 크기(굵게)
        h6:    Math.max((bp - 1) * 100, 800),   // H6: 본문보다 한 단계 작게(굵게)
        tblHd: bp * 100,
        code:  Math.max((bp - 1) * 100, 800),
    };

    const fontFaceBlock = (lang) => `
      <hh:fontface lang="${lang}" fontCnt="${totalFontCnt}">
        <hh:font id="0" face="${fn}" type="${type}" isEmbedded="0">${substFontTag}
          <hh:typeInfo familyType="${familyType}" weight="${weight}" proportion="4" contrast="0" strokeVariation="1" armStyle="1" letterform="1" midline="1" xHeight="1"/>
        </hh:font>${boldFn ? `
        <hh:font id="1" face="${boldFn}" type="TTF" isEmbedded="0">
          <hh:typeInfo familyType="FCAT_GOTHIC" weight="8" proportion="4" contrast="0" strokeVariation="1" armStyle="1" letterform="1" midline="1" xHeight="1"/>
        </hh:font>` : ''}
      </hh:fontface>`;

    // bold=true 시: boldFn이 있으면 font face 1 참조(별도 Bold 폰트), 없으면 <hh:bold/> 태그
    const charBase = (id, height, bold = false, italic = false, fontId = null, opts = {}) => {
        const fi = fontId !== null ? String(fontId) : ((bold && boldFn) ? '1' : '0');
        const color = (opts.color && /^#[0-9A-Fa-f]{6}$/.test(opts.color)) ? opts.color.toUpperCase() : '#000000';
        const boldTag   = (bold   && !boldFn) ? '\n        <hh:bold/>'   : '';
        const italicTag = italic ? '\n        <hh:italic/>' : '';
        // OWPML CharShape 순서: ...offset → bold → italic → underline → strikeout
        const underlineTag = opts.underline ? `\n        <hh:underline type="BOTTOM" shape="SOLID" color="${color}"/>` : '';
        const strikeTag    = opts.strike    ? `\n        <hh:strikeout shape="SOLID" color="${color}"/>` : '';
        return `      <hh:charPr id="${id}" height="${height}" textColor="${color}" shadeColor="none" useFontSpace="0" useKerning="0" symMark="NONE" borderFillIDRef="1">
        <hh:fontRef hangul="${fi}" latin="${fi}" hanja="${fi}" japanese="${fi}" other="${fi}" symbol="${fi}" user="${fi}"/>
        <hh:ratio hangul="100" latin="100" hanja="100" japanese="100" other="100" symbol="100" user="100"/>
        <hh:spacing hangul="0" latin="0" hanja="0" japanese="0" other="0" symbol="0" user="0"/>
        <hh:relSz hangul="100" latin="100" hanja="100" japanese="100" other="100" symbol="100" user="100"/>
        <hh:offset hangul="0" latin="0" hanja="0" japanese="0" other="0" symbol="0" user="0"/>${boldTag}${italicTag}${underlineTag}${strikeTag}
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
<hh:head xmlns:hh="http://www.hancom.co.kr/hwpml/2011/head" xmlns:hc="http://www.hancom.co.kr/hwpml/2011/core" version="1.4" secCnt="1">
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
    <hh:charProperties itemCnt="${13 + customCharMap.size}">
      <!-- 0=본문, 1=H1, 2=H2, 3=H3, 4=H4, 5=표머리, 6=코드, 7=본문bold, 8=본문italic, 9=본문bold+italic,
           10=H5, 11=H6, 12=1pt(표지 색띠 높이 최소화), 13~ = 동적 확장(밑줄/취소선/글자색) -->
${charBase(0, sz.body,  false, false)}
${charBase(1, sz.h1,   true,  false)}
${charBase(2, sz.h2,   true,  false)}
${charBase(3, sz.h3,   true,  false)}
${charBase(4, sz.h4,   true,  false)}
${charBase(5, sz.tblHd,true,  false)}
${charBase(6, sz.code, false, false).replace('"#000000"', '"#FFFFFF"')}
${charBase(7, sz.body, true,  false)}
${charBase(8, sz.body, false, true)}
${charBase(9, sz.body, true,  true)}
${charBase(10, sz.h5,  true,  false)}
${charBase(11, sz.h6,  true,  false)}
${charBase(12, 100,    false, false)}
${[...customCharMap.entries()].map(([key, cid]) => {
    const [flags, color, height] = String(key).split('|');
    return charBase(cid, height ? +height : sz.body, flags[0] === '1', flags[1] === '1', null,
        { underline: flags[2] === '1', strike: flags[3] === '1', color });
}).join('\n')}
    </hh:charProperties>
    <hh:paraProperties itemCnt="20">
      <!-- id  정렬    행간  전    후   들여  테두리참조 -->
${paraBase(0, 'JUSTIFY', bodyLineSpacing,   0,  850,    0)}
${paraBase(1, 'LEFT',    h1LineSpacing, 850,  567,    0)}
${paraBase(2, 'LEFT',    h2LineSpacing, 700,  425,    0)}
${paraBase(3, 'LEFT',    bodyLineSpacing, 567,  283,    0)}
${paraBase(4, 'LEFT',    bodyLineSpacing, 425,  200,    0)}
${paraBase(5, 'LEFT',    bodyLineSpacing,   0,  100,  600)}
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
${paraBase(12, 'CENTER', bodyLineSpacing,   0,  850,    0)}
${paraBase(13, 'RIGHT',  bodyLineSpacing,   0,  850,    0)}
      <!-- id=14  코드 라인: 사용자가 선택한 문서 글꼴 -->
${paraBase(14, 'LEFT',   120,   0,    0,    0)}
      <!-- id=15/16  H5/H6 제목 -->
${paraBase(15, 'LEFT',   bodyLineSpacing, 300,  150,    0)}
${paraBase(16, 'LEFT',   bodyLineSpacing, 200,  100,    0)}
      <!-- id=17/18  중첩 목록 들여쓰기 (레벨1/레벨2). 레벨0은 id=5 사용 -->
${paraBase(17, 'LEFT',   bodyLineSpacing,   0,  100, 1200)}
${paraBase(18, 'LEFT',   bodyLineSpacing,   0,  100, 1800)}
      <!-- id=19  인용구: 왼쪽 선+옅은 배경, 본문보다 조금 들여쓰기, 아래 3mm -->
${paraBase(19, 'LEFT',   bodyLineSpacing, 300,  850,  900, '19')}
    </hh:paraProperties>
    <hh:borderFills itemCnt="${19 + customBfMap.size}">
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
        <hc:fillBrush><hc:winBrush faceColor="#D9D9D9" hatchColor="#000000" alpha="0"/></hc:fillBrush>
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
        <hc:fillBrush><hc:winBrush faceColor="#D9D9D9" hatchColor="#000000" alpha="0"/></hc:fillBrush>
      </hh:borderFill>
      <!-- id=7 표 머리글: 오른쪽 바깥 테두리 없음 -->
      <hh:borderFill id="7" threeD="0" shadow="0" centerLine="NONE" breakCellSeparateLine="0">
        <hh:slash type="NONE" Crooked="0" isCounter="0"/><hh:backSlash type="NONE" Crooked="0" isCounter="0"/>
        <hh:leftBorder type="SOLID" width="0.12 mm" color="#000000"/>
        <hh:rightBorder type="NONE" width="0.1 mm" color="#000000"/>
        <hh:topBorder type="SOLID" width="0.12 mm" color="#000000"/>
        <hh:bottomBorder type="SOLID" width="0.12 mm" color="#000000"/>
        <hh:diagonal type="SOLID" width="0.1 mm" color="#000000"/>
        <hc:fillBrush><hc:winBrush faceColor="#D9D9D9" hatchColor="#000000" alpha="0"/></hc:fillBrush>
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
        <hc:fillBrush><hc:winBrush faceColor="#D9D9D9" hatchColor="#000000" alpha="0"/></hc:fillBrush>
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
      <!-- id=11 코드 블록 셀용: 검정 배경 + 옅은 테두리 (글자색 흰색은 charPr 6) -->
      <hh:borderFill id="11" threeD="0" shadow="0" centerLine="NONE" breakCellSeparateLine="0">
        <hh:slash type="NONE" Crooked="0" isCounter="0"/><hh:backSlash type="NONE" Crooked="0" isCounter="0"/>
        <hh:leftBorder type="SOLID" width="0.12 mm" color="#444444"/>
        <hh:rightBorder type="SOLID" width="0.12 mm" color="#444444"/>
        <hh:topBorder type="SOLID" width="0.12 mm" color="#444444"/>
        <hh:bottomBorder type="SOLID" width="0.12 mm" color="#444444"/>
        <hh:diagonal type="NONE" width="0.1 mm" color="#000000"/>
        <hc:fillBrush><hc:winBrush faceColor="#000000" hatchColor="#000000" alpha="0"/></hc:fillBrush>
      </hh:borderFill>
      <!-- 표지 밴드용 borderFill (사용자 지정 색). 테두리 없음 -->
      <!-- id=12 단위형 상단: 단색 #0080C0 -->
      <hh:borderFill id="12" threeD="0" shadow="0" centerLine="NONE" breakCellSeparateLine="0">
        <hh:slash type="NONE" Crooked="0" isCounter="0"/><hh:backSlash type="NONE" Crooked="0" isCounter="0"/>
        <hh:leftBorder type="NONE" width="0.1 mm" color="#FFFFFF"/><hh:rightBorder type="NONE" width="0.1 mm" color="#FFFFFF"/>
        <hh:topBorder type="NONE" width="0.1 mm" color="#FFFFFF"/><hh:bottomBorder type="NONE" width="0.1 mm" color="#FFFFFF"/>
        <hh:diagonal type="NONE" width="0.1 mm" color="#FFFFFF"/>
        <hc:fillBrush><hc:winBrush faceColor="#0080C0" hatchColor="#000000" alpha="0"/></hc:fillBrush>
      </hh:borderFill>
      <!-- id=13 단위형 하단: 원형(RADIAL) 그라데이션 #0080C0→#3CBFFF (중심0·기울임0·번짐50·번짐중심50) -->
      <hh:borderFill id="13" threeD="0" shadow="0" centerLine="NONE" breakCellSeparateLine="0">
        <hh:slash type="NONE" Crooked="0" isCounter="0"/><hh:backSlash type="NONE" Crooked="0" isCounter="0"/>
        <hh:leftBorder type="NONE" width="0.1 mm" color="#FFFFFF"/><hh:rightBorder type="NONE" width="0.1 mm" color="#FFFFFF"/>
        <hh:topBorder type="NONE" width="0.1 mm" color="#FFFFFF"/><hh:bottomBorder type="NONE" width="0.1 mm" color="#FFFFFF"/>
        <hh:diagonal type="NONE" width="0.1 mm" color="#FFFFFF"/>
        <hc:fillBrush><hc:gradation type="RADIAL" angle="0" centerX="0" centerY="0" step="50" colorNum="2" stepCenter="50" alpha="0"><hc:color value="#0080C0"/><hc:color value="#3CBFFF"/></hc:gradation></hc:fillBrush>
      </hh:borderFill>
      <!-- id=14 연간형 상단: 단색 #126E3A -->
      <hh:borderFill id="14" threeD="0" shadow="0" centerLine="NONE" breakCellSeparateLine="0">
        <hh:slash type="NONE" Crooked="0" isCounter="0"/><hh:backSlash type="NONE" Crooked="0" isCounter="0"/>
        <hh:leftBorder type="NONE" width="0.1 mm" color="#FFFFFF"/><hh:rightBorder type="NONE" width="0.1 mm" color="#FFFFFF"/>
        <hh:topBorder type="NONE" width="0.1 mm" color="#FFFFFF"/><hh:bottomBorder type="NONE" width="0.1 mm" color="#FFFFFF"/>
        <hh:diagonal type="NONE" width="0.1 mm" color="#FFFFFF"/>
        <hc:fillBrush><hc:winBrush faceColor="#126E3A" hatchColor="#000000" alpha="0"/></hc:fillBrush>
      </hh:borderFill>
      <!-- id=15 연간형 하단 좌(8): 단색 #724598 -->
      <hh:borderFill id="15" threeD="0" shadow="0" centerLine="NONE" breakCellSeparateLine="0">
        <hh:slash type="NONE" Crooked="0" isCounter="0"/><hh:backSlash type="NONE" Crooked="0" isCounter="0"/>
        <hh:leftBorder type="NONE" width="0.1 mm" color="#FFFFFF"/><hh:rightBorder type="NONE" width="0.1 mm" color="#FFFFFF"/>
        <hh:topBorder type="NONE" width="0.1 mm" color="#FFFFFF"/><hh:bottomBorder type="NONE" width="0.1 mm" color="#FFFFFF"/>
        <hh:diagonal type="NONE" width="0.1 mm" color="#FFFFFF"/>
        <hc:fillBrush><hc:winBrush faceColor="#724598" hatchColor="#000000" alpha="0"/></hc:fillBrush>
      </hh:borderFill>
      <!-- id=16 연간형 하단 우(2): 단색 #FFD900 -->
      <hh:borderFill id="16" threeD="0" shadow="0" centerLine="NONE" breakCellSeparateLine="0">
        <hh:slash type="NONE" Crooked="0" isCounter="0"/><hh:backSlash type="NONE" Crooked="0" isCounter="0"/>
        <hh:leftBorder type="NONE" width="0.1 mm" color="#FFFFFF"/><hh:rightBorder type="NONE" width="0.1 mm" color="#FFFFFF"/>
        <hh:topBorder type="NONE" width="0.1 mm" color="#FFFFFF"/><hh:bottomBorder type="NONE" width="0.1 mm" color="#FFFFFF"/>
        <hh:diagonal type="NONE" width="0.1 mm" color="#FFFFFF"/>
        <hc:fillBrush><hc:winBrush faceColor="#FFD900" hatchColor="#000000" alpha="0"/></hc:fillBrush>
      </hh:borderFill>
      <!-- id=17 표지 [팀명/이름] 칸: 흰 배경(투명), 하단만 점선 -->
      <hh:borderFill id="17" threeD="0" shadow="0" centerLine="NONE" breakCellSeparateLine="0">
        <hh:slash type="NONE" Crooked="0" isCounter="0"/><hh:backSlash type="NONE" Crooked="0" isCounter="0"/>
        <hh:leftBorder type="NONE" width="0.1 mm" color="#FFFFFF"/><hh:rightBorder type="NONE" width="0.1 mm" color="#FFFFFF"/>
        <hh:topBorder type="NONE" width="0.1 mm" color="#FFFFFF"/><hh:bottomBorder type="DOT" width="0.12 mm" color="#000000"/>
        <hh:diagonal type="NONE" width="0.1 mm" color="#FFFFFF"/>
      </hh:borderFill>
      <!-- id=18 기본형 표지 밴드: 회색 #808080 단색(위아래 동일), 테두리 없음 -->
      <hh:borderFill id="18" threeD="0" shadow="0" centerLine="NONE" breakCellSeparateLine="0">
        <hh:slash type="NONE" Crooked="0" isCounter="0"/><hh:backSlash type="NONE" Crooked="0" isCounter="0"/>
        <hh:leftBorder type="NONE" width="0.1 mm" color="#FFFFFF"/><hh:rightBorder type="NONE" width="0.1 mm" color="#FFFFFF"/>
        <hh:topBorder type="NONE" width="0.1 mm" color="#FFFFFF"/><hh:bottomBorder type="NONE" width="0.1 mm" color="#FFFFFF"/>
        <hh:diagonal type="NONE" width="0.1 mm" color="#FFFFFF"/>
        <hc:fillBrush><hc:winBrush faceColor="#808080" hatchColor="#000000" alpha="0"/></hc:fillBrush>
      </hh:borderFill>
      <!-- id=19 인용구: 왼쪽 강조선 + 옅은 배경 -->
      <hh:borderFill id="19" threeD="0" shadow="0" centerLine="NONE" breakCellSeparateLine="0">
        <hh:slash type="NONE" Crooked="0" isCounter="0"/><hh:backSlash type="NONE" Crooked="0" isCounter="0"/>
        <hh:leftBorder type="SOLID" width="0.5 mm" color="#64748B"/>
        <hh:rightBorder type="NONE" width="0.1 mm" color="#000000"/>
        <hh:topBorder type="NONE" width="0.1 mm" color="#000000"/>
        <hh:bottomBorder type="NONE" width="0.1 mm" color="#000000"/>
        <hh:diagonal type="NONE" width="0.1 mm" color="#000000"/>
        <hc:fillBrush><hc:winBrush faceColor="#F8FAFC" hatchColor="#000000" alpha="0"/></hc:fillBrush>
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
        <hc:fillBrush><hc:winBrush faceColor="#${color}" hatchColor="#000000" alpha="0"/></hc:fillBrush>
      </hh:borderFill>`;
}).join('\n')}
    </hh:borderFills>
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
 * run이 기본 charPr(0/6~9)로 표현 불가한 확장 서식(밑줄/취소선/유효한 글자색)을
 * 가지는지 판정. 동적 charPr(customCharMap) 대상 여부를 결정한다.
 */
function runNeedsExtChar(run) {
    const hasColor = run.color && /^#[0-9A-Fa-f]{6}$/.test(run.color) && run.color.toUpperCase() !== '#000000';
    return !!(run.underline || run.strike || hasColor);
}

/** 확장 charPr 시그니처 키: "bold italic underline strike | #RRGGBB | height"
 *  height 비움 = 본문 크기. 제목 색 보존 시 제목 크기(HWPUNIT)를 함께 넣어 구분한다. */
function extCharKey(run) {
    const color = (run.color && /^#[0-9A-Fa-f]{6}$/.test(run.color)) ? run.color.toUpperCase() : '#000000';
    return `${run.bold ? 1 : 0}${run.italic ? 1 : 0}${run.underline ? 1 : 0}${run.strike ? 1 : 0}|${color}|${run.height || ''}`;
}

/**
 * 인라인 runs 배열(bold/italic/code/underline/strike/color 플래그) → 단락 XML
 * parsers.js extractInlineRuns()가 생성한 runs 배열을 처리한다.
 * charPr ID: 0=본문, 6=코드, 7=본문bold, 8=본문italic, 9=본문bold+italic,
 *            10~ = 동적 확장(밑줄/취소선/글자색) — customCharMap 조회.
 * run.footnote 가 있는 경우 각주 컨트롤(hp:ctrl) 을 삽입한다.
 */
function buildParaRuns(runs, paraId = '0', customCharMap = new Map()) {
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
        if (run.code) {
            cId = '6';
        } else if (runNeedsExtChar(run) && customCharMap.has(extCharKey(run))) {
            // 동적 확장 charPr (밑줄/취소선/색). 미스 시 아래 bold/italic 폴백으로 안전 처리
            cId = String(customCharMap.get(extCharKey(run)));
        } else if (run.bold && run.italic) {
            cId = '9';
        } else if (run.bold) {
            cId = '7';
        } else if (run.italic) {
            cId = '8';
        }
        runsXml += `<hp:run charPrIDRef="${cId}"><hp:t>${safe}</hp:t></hp:run>`;
    }
    if (!runsXml && !ctrlsXml) return buildBlankPara();
    return `<hp:p id="${pid}" paraPrIDRef="${paraId}" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0">${runsXml}${ctrlsXml}</hp:p>`;
}

/**
 * 빈 단락 (빈 줄 간격 표현용) — paraPr id=9(여백 없음) 사용
 * 본문 paraPr(id=0)의 next=850 여백이 중복 적용되지 않도록 별도 스타일 사용
 */
function buildBlankPara(charId = '0') {
    const pid = _nextParaId();
    return `<hp:p id="${pid}" paraPrIDRef="9" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0">` +
        `<hp:run charPrIDRef="${charId}"><hp:t> </hp:t></hp:run></hp:p>`;
}

function buildCodePara(text, paraId = '14', charId = '6') {
    const pid = _nextParaId();
    const raw = String(text ?? '');
    const safe = xmlEsc(raw === '' ? ' ' : raw);
    return `<hp:p id="${pid}" paraPrIDRef="${paraId}" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0">` +
        `<hp:run charPrIDRef="${charId}"><hp:t xml:space="preserve">${safe}</hp:t></hp:run></hp:p>`;
}

function buildCodeBlock(block, prefix = '', contentWidthHwp = 48000) {
    const text = String(block.text ?? '');
    const lines = text === '' ? [''] : text.split('\n');
    const tableWidth = Math.min(45000, Math.max(12000, contentWidthHwp));
    const rowHeight = Math.max(1500, 720 + (lines.length * 520));
    const pid = _nextParaId();
    const codeParas = lines.map(line => buildCodePara(prefix + line, '14', '6')).join('');
    return `<hp:p id="${pid}" paraPrIDRef="0" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0"><hp:run charPrIDRef="0">` +
        `<hp:tbl id="0" zOrder="0" numberingType="TABLE" textWrap="TOP_AND_BOTTOM" ` +
        `textFlow="BOTH_SIDES" lock="0" dropcapstyle="None" pageBreak="CELL" ` +
        `repeatHeader="0" rowCnt="1" colCnt="1" cellSpacing="0" borderFillIDRef="11" noAdjust="0">` +
        `<hp:sz width="${tableWidth}" widthRelTo="ABSOLUTE" height="${rowHeight}" heightRelTo="ABSOLUTE" protect="0"/>` +
        `<hp:pos treatAsChar="0" affectLSpacing="0" flowWithText="1" allowOverlap="0" holdAnchorAndSO="0" ` +
        `vertRelTo="PARA" horzRelTo="PARA" vertAlign="TOP" horzAlign="LEFT" vertOffset="0" horzOffset="0"/>` +
        `<hp:outMargin left="0" right="0" top="0" bottom="${mmToHwp(3)}"/>` +
        `<hp:inMargin left="0" right="0" top="0" bottom="0"/>` +
        `<hp:cellzoneList><hp:cellzone startRowAddr="0" startColAddr="0" endRowAddr="0" endColAddr="0" borderFillIDRef="11"/></hp:cellzoneList>` +
        `<hp:tr><hp:tc name="" header="0" hasMargin="0" protect="0" editable="0" dirty="0" borderFillIDRef="11">` +
        `<hp:subList id="" textDirection="HORIZONTAL" lineWrap="BREAK" vertAlign="CENTER" ` +
        `linkListIDRef="0" linkListNextIDRef="0" textWidth="0" textHeight="0" hasTextRef="0" hasNumRef="0">` +
        codeParas +
        `</hp:subList><hp:cellAddr colAddr="0" rowAddr="0"/><hp:cellSpan colSpan="1" rowSpan="1"/>` +
        `<hp:cellSz width="${tableWidth}" height="${rowHeight}"/>` +
        `<hp:cellMargin left="420" right="420" top="300" bottom="300"/></hp:tc></hp:tr>` +
        `</hp:tbl><hp:t></hp:t></hp:run></hp:p>`;
}

function collectCodeAuditForHwpx(blocks) {
    const codeBlocks = [];
    function walk(list) {
        for (const block of (list || [])) {
            if (block.type === 'code') {
                const lines = String(block.text ?? '').split('\n');
                codeBlocks.push({
                    lineCount: lines.length,
                    firstLine: lines[0] ?? '',
                    lastLine: lines[lines.length - 1] ?? '',
                });
            } else if (block.type === 'quote') {
                walk(block.blocks);
            } else if (block.type === 'list') {
                for (const item of (block.items || [])) walk(item.codeBlocks);
            }
        }
    }
    walk(blocks);
    return {
        blockCount: codeBlocks.length,
        lineCount: codeBlocks.reduce((sum, b) => sum + b.lineCount, 0),
        blocks: codeBlocks,
    };
}

function validateCodeAudit(ir) {
    if (!ir || !ir.codeAudit) return;
    const expected = ir.codeAudit;
    const actual = collectCodeAuditForHwpx(ir.blocks || []);
    const sameEdgeLines = (expected.blocks || []).every((block, i) => {
        const other = actual.blocks[i] || {};
        return block.firstLine === other.firstLine && block.lastLine === other.lastLine;
    });
    if (expected.blockCount !== actual.blockCount
        || expected.lineCount !== actual.lineCount
        || !sameEdgeLines) {
        throw new Error('코드 블록 검증 실패: Markdown 코드 블록 수/줄 수가 변환 전후와 일치하지 않습니다.');
    }
}

/** 구분선(HR) — treatAsChar=1 표 객체로 생성해 한글에서 선택/삭제하기 쉽게 한다. */
function buildHrPara(contentWidthHwp = 48000) {
    const pid = _nextParaId();
    const cellPara = buildBlankPara();
    return `<hp:p id="${pid}" paraPrIDRef="9" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0"><hp:run charPrIDRef="0">` +
        `<hp:tbl id="0" zOrder="0" numberingType="TABLE" textWrap="TOP_AND_BOTTOM" ` +
        `textFlow="BOTH_SIDES" lock="0" dropcapstyle="None" pageBreak="ROW" ` +
        `repeatHeader="0" rowCnt="1" colCnt="1" cellSpacing="0" borderFillIDRef="1">` +
        `<hp:sz width="${Math.max(12000, contentWidthHwp)}" widthRelTo="ABSOLUTE" height="0" heightRelTo="ABSOLUTE" protect="0"/>` +
        `<hp:pos treatAsChar="1" affectLSpacing="0" flowWithText="1" allowOverlap="0" holdAnchorAndSO="0" ` +
        `vertRelTo="PARA" horzRelTo="COLUMN" vertAlign="TOP" horzAlign="LEFT" vertOffset="0" horzOffset="0"/>` +
        `<hp:outMargin left="0" right="0" top="${mmToHwp(3)}" bottom="${mmToHwp(3)}"/>` +
        `<hp:inMargin left="0" right="0" top="0" bottom="0"/>` +
        `<hp:tr><hp:tc name="" header="0" hasMargin="0" protect="0" editable="0" dirty="0" borderFillIDRef="10">` +
        `<hp:subList id="" textDirection="HORIZONTAL" lineWrap="BREAK" vertAlign="CENTER" ` +
        `linkListIDRef="0" linkListNextIDRef="0" textWidth="0" textHeight="0" hasTextRef="0" hasNumRef="0">` +
        cellPara +
        `</hp:subList><hp:cellAddr colAddr="0" rowAddr="0"/><hp:cellSpan colSpan="1" rowSpan="1"/>` +
        `<hp:cellSz width="${Math.max(12000, contentWidthHwp)}" height="120"/>` +
        `<hp:cellMargin left="0" right="0" top="0" bottom="0"/></hp:tc></hp:tr>` +
        `</hp:tbl><hp:t></hp:t></hp:run></hp:p>`;
}

/** 구분선 주변의 IR 빈 문단은 표 바깥 여백과 중복되므로 렌더링에서 제외한다. */
function removeHrSpacerBlanks(blocks) {
    const list = blocks || [];
    return list.filter((block, index) => {
        if (block.type !== 'blank') return true;
        let prev = index - 1;
        let next = index + 1;
        while (prev >= 0 && list[prev]?.type === 'blank') prev--;
        while (next < list.length && list[next]?.type === 'blank') next++;
        return list[prev]?.type !== 'hr' && list[next]?.type !== 'hr';
    });
}

/**
 * 표지 표 — 상단 색 띠 / 제목 흰칸 / 하단 색 띠 / (이름/소속) 흰칸을 한 표로 생성.
 * 제목은 중간 흰 칸에 들어간다. 색 띠 내용은 1pt(charPr 12)로 높이를 최소화.
 *   basic : 위아래 #808080 단색, 아래칸 = 소속/작성자(우측)              (1열)
 *   unit  : 상단 #0080C0 / 하단 #0080C0→#3CBFFF 그라데이션, 아래칸 [팀명/이름] (1열)
 *   annual: 상단 #126E3A / 하단 좌 #724598(129.93mm)·우 #FFD900(39.93mm)        (2열)
 * @param {string} style  'basic' | 'unit' | 'annual'
 */
function buildCoverTable(style, titleText, contentWidthHwp = 48000) {
    const pid   = _nextParaId();
    // 총높이 22.96mm 통일. 색띠 높이는 style별(단위 1.91 / 그 외 1.35), 이름칸 8.22mm,
    // 중간 제목칸은 나머지(= 22.96 - 색띠×2 - 8.22)로 역산.
    const bandMm = style === 'unit' ? 1.91 : 1.35;
    const nameMm = 8.22;
    const midMm  = 22.96 - bandMm * 2 - nameMm;
    const hThin = mmToHwp(bandMm);
    const hMid  = mmToHwp(midMm);
    const hName = mmToHwp(nameMm);

    const cell = (bf, w, h, colSpan, colAddr, rowAddr, contentXml) =>
        `<hp:tc name="" header="0" hasMargin="1" protect="0" editable="0" dirty="0" borderFillIDRef="${bf}">` +
        `<hp:subList id="" textDirection="HORIZONTAL" lineWrap="BREAK" vertAlign="CENTER" ` +
        `linkListIDRef="0" linkListNextIDRef="0" textWidth="0" textHeight="0" hasTextRef="0" hasNumRef="0">` +
        contentXml +
        `</hp:subList><hp:cellAddr colAddr="${colAddr}" rowAddr="${rowAddr}"/><hp:cellSpan colSpan="${colSpan}" rowSpan="1"/>` +
        `<hp:cellSz width="${w}" height="${h}"/><hp:cellMargin left="280" right="280" top="0" bottom="0"/></hp:tc>`;

    const band = () => buildBlankPara('12');                                       // 1pt 빈줄(띠 높이 최소화)
    const titlePara = titleText ? buildPara(titleText, '1', '7') : buildBlankPara();// H1 가운데
    const nameContent = buildPara('[팀명 / 이름]', '7', '13');                     // 모든 스타일 공통, 굵게 우측
    const nameBf = '17';                                                           // 하단 점선(0.12mm)

    let colCnt, W, rows;
    if (style === 'annual') {
        colCnt = 2;
        const wL = mmToHwp(129.93), wR = mmToHwp(39.93);
        W = wL + wR;
        rows =
            `<hp:tr>${cell(14, W, hThin, 2, 0, 0, band())}</hp:tr>` +
            `<hp:tr>${cell(1,  W, hMid,  2, 0, 1, titlePara)}</hp:tr>` +
            `<hp:tr>${cell(15, wL, hThin, 1, 0, 2, band())}${cell(16, wR, hThin, 1, 1, 2, band())}</hp:tr>` +
            `<hp:tr>${cell(nameBf, W, hName, 2, 0, 3, nameContent)}</hp:tr>`;
    } else {
        colCnt = 1;
        W = Math.min(Math.max(12000, contentWidthHwp), mmToHwp(169));
        const topBf = style === 'unit' ? 12 : 18;     // unit=#0080C0, basic=#808080
        const botBf = style === 'unit' ? 13 : 18;     // unit=원형 그라데이션, basic=#808080
        rows =
            `<hp:tr>${cell(topBf, W, hThin, 1, 0, 0, band())}</hp:tr>` +
            `<hp:tr>${cell(1,     W, hMid,  1, 0, 1, titlePara)}</hp:tr>` +
            `<hp:tr>${cell(botBf, W, hThin, 1, 0, 2, band())}</hp:tr>` +
            `<hp:tr>${cell(nameBf, W, hName, 1, 0, 3, nameContent)}</hp:tr>`;
    }
    const totalH = hThin + hMid + hThin + hName;
    return `<hp:p id="${pid}" paraPrIDRef="9" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0"><hp:run charPrIDRef="0">` +
        `<hp:tbl id="0" zOrder="0" numberingType="TABLE" textWrap="TOP_AND_BOTTOM" ` +
        `textFlow="BOTH_SIDES" lock="0" dropcapstyle="None" pageBreak="ROW" ` +
        `repeatHeader="0" rowCnt="4" colCnt="${colCnt}" cellSpacing="0" borderFillIDRef="1">` +
        `<hp:sz width="${W}" widthRelTo="ABSOLUTE" height="${totalH}" heightRelTo="ABSOLUTE" protect="0"/>` +
        `<hp:pos treatAsChar="1" affectLSpacing="0" flowWithText="1" allowOverlap="0" holdAnchorAndSO="0" ` +
        `vertRelTo="PARA" horzRelTo="COLUMN" vertAlign="TOP" horzAlign="CENTER" vertOffset="0" horzOffset="0"/>` +
        `<hp:outMargin left="0" right="0" top="0" bottom="${mmToHwp(3)}"/><hp:inMargin left="0" right="0" top="0" bottom="0"/>` +
        rows +
        `</hp:tbl><hp:t></hp:t></hp:run></hp:p>`;
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

/** heading level → charId / paraId 매핑 (1~4→charPr/paraPr 1~4, 5→10/15, 6→11/16) */
function headingIds(level) {
    const lv = Math.max(1, Math.min(level || 1, 6));
    if (lv <= 4) return { charId: String(lv), paraId: String(lv) };
    if (lv === 5) return { charId: '10', paraId: '15' };
    return { charId: '11', paraId: '16' };
}

/**
 * 표 열 너비를 셀 내용 길이에 비례하여 계산
 * 한글 글자(2바이트)는 2배, 영문/숫자(1바이트)는 1로 환산
 * 최소 열 너비 3000 HWPUNIT(≈10.6mm) 보장, 최대 40자로 상한
 */
function cellText(cell)    { return typeof cell === 'object' ? (cell?.text ?? '') : String(cell ?? ''); }
function cellBg(cell)     { return typeof cell === 'object' ? (cell?.bg  || null) : null; }
function cellColor(cell)   { return typeof cell === 'object' ? (cell?.color || null) : null; }
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

function buildTable(header, rows, contentWidthHwp = 48000, customBfMap = new Map(), customCharMap = new Map()) {
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

    // 단일 셀(hp:tc) XML 생성 — 실제 셀과 격자 보충용 더미 셀이 공유
    // 자식 순서: subList → cellAddr → cellSpan → cellSz → cellMargin
    // (rhwp serializer/hwpx/table.rs 기준 OWPML 공식 순서)
    const renderCell = (r, c, cs, rs, val, bg, isHd, color) => {
        let cId      = isHd ? '5' : '0';                               // 표머리=5(bold), 일반=0
        // 셀 글자색(예: 흰 글자 머리행)이 있으면 동적 charPr 사용 (미스 시 기본값 유지)
        if (color && runNeedsExtChar({ color })) {
            const key = extCharKey({ bold: isHd, color });
            if (customCharMap.has(key)) cId = String(customCharMap.get(key));
        }
        const paraId = isHd ? '7' : (isNumericCell(val) ? '11' : '10');
        let bfId;
        if (bg) {
            const variant = tableSideVariant(nCols, c, cs);
            bfId = customBfMap.get(bgBorderKey(bg, variant))
                || customBfMap.get(bgBorderKey(bg, 'full'));
        }
        if (!bfId) {
            if (nCols === 1)          bfId = isHd ? '9' : '8';
            else if (c === 0)         bfId = isHd ? '6' : '4';
            else if (c + cs >= nCols) bfId = isHd ? '7' : '5';
            else                      bfId = isHd ? '3' : '2';
        }
        const cellWidth = colWidths.slice(c, c + cs).reduce((a, b) => a + b, 0);
        return `<hp:tc name="" header="${isHd ? '1' : '0'}" hasMargin="1" protect="0" editable="0" dirty="0" borderFillIDRef="${bfId}">` +
            `<hp:subList id="" textDirection="HORIZONTAL" lineWrap="BREAK" vertAlign="CENTER" ` +
                `linkListIDRef="0" linkListNextIDRef="0" textWidth="0" textHeight="0" hasTextRef="0" hasNumRef="0">` +
            buildPara(val, cId, paraId) +
            `</hp:subList>` +
            `<hp:cellAddr colAddr="${c}" rowAddr="${r}"/>` +
            `<hp:cellSpan colSpan="${cs}" rowSpan="${rs}"/>` +
            `<hp:cellSz width="${cellWidth}" height="1200"/>` +
            `<hp:cellMargin left="650" right="650" top="220" bottom="220"/>` +
            `</hp:tc>`;
    };

    // 점유 행렬: 모든 (행,열) 격자가 정확히 한 번 덮이도록 보장한다.
    // 들쭉날쭉한 행·세로병합·중첩표 잔재가 있어도 한글이 여는 표를 만든다.
    const occupied = Array.from({ length: nRows }, () => new Array(nCols).fill(false));
    let rowsXml = '';
    for (let r = 0; r < nRows; r++) {
        const row  = allRows[r] || [];
        const isHd = (header && header.length && r === 0);
        const rowCells = [];   // {c, xml}

        for (let ci = 0; ci < row.length; ci++) {
            const cell = (row[ci] !== undefined && row[ci] !== null) ? row[ci] : '';
            // 세로 병합 연속 셀(rowSpan=0)은 위 셀의 rowSpan 점유로 처리되므로 건너뜀
            if (cellRowSpan(cell) === 0) continue;

            // 이 행에서 비어 있는 첫 열 — 위 행 rowSpan이 점유한 열은 자동으로 건너뜀
            let c = 0;
            while (c < nCols && occupied[r][c]) c++;
            if (c >= nCols) break;   // 행 넘침 — 격자 유지를 위해 잉여 셀 폐기

            const cs = Math.min(Math.max(cellColSpan(cell) || 1, 1), nCols - c);
            const rs = Math.min(Math.max(cellRowSpan(cell) || 1, 1), nRows - r);
            for (let rr = r; rr < r + rs; rr++)
                for (let cc = c; cc < c + cs; cc++) occupied[rr][cc] = true;

            rowCells.push({ c, xml: renderCell(r, c, cs, rs, cellText(cell), cellBg(cell), isHd, cellColor(cell)) });
        }

        // 남은 빈 열을 1×1 더미 셀로 채워 격자를 완성한다.
        for (let c = 0; c < nCols; c++) {
            if (occupied[r][c]) continue;
            occupied[r][c] = true;
            rowCells.push({ c, xml: renderCell(r, c, 1, 1, '', null, isHd, null) });
        }

        // <hp:tr>은 속성 없음 (rhwp 기준); header 마킹은 <hp:tc>에만 적용
        rowCells.sort((a, b) => a.c - b.c);
        rowsXml += `<hp:tr>${rowCells.map(x => x.xml).join('')}</hp:tr>`;
    }

    // 일반 데이터 표는 글자처럼 취급하지 않는 본문 개체로 배치한다.
    // pageBreak="TABLE" → 여러 쪽 지원 '나눔', repeatHeader="1" + 첫 행 header="1" → 제목 줄 자동 반복.
    // 오른쪽 정렬은 단 전체 폭 표에서는 위치 변화가 없고, 표 폭이 작아질 경우 단 오른쪽을 기준으로 배치한다.
    // height="0" → HWP이 셀 내용 기준으로 자동 계산 (고정값 제거)
    return `<hp:p id="${pid}" paraPrIDRef="0" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0"><hp:run charPrIDRef="0">` +
        `<hp:tbl id="0" zOrder="0" numberingType="TABLE" textWrap="TOP_AND_BOTTOM" ` +
        `textFlow="BOTH_SIDES" lock="0" dropcapstyle="None" pageBreak="TABLE" ` +
        `repeatHeader="1" rowCnt="${nRows}" colCnt="${nCols}" cellSpacing="0" borderFillIDRef="1">` +
        `<hp:sz width="${tableWidth}" widthRelTo="ABSOLUTE" height="0" heightRelTo="ABSOLUTE" protect="0"/>` +
        `<hp:pos treatAsChar="0" affectLSpacing="0" flowWithText="1" allowOverlap="0" holdAnchorAndSO="0" ` +
        `vertRelTo="PARA" horzRelTo="COLUMN" vertAlign="TOP" horzAlign="RIGHT" vertOffset="0" horzOffset="0"/>` +
        `<hp:outMargin left="0" right="0" top="0" bottom="${mmToHwp(3)}"/>` +
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
    // HWPX는 기본 용지 폭/높이를 유지하고 landscape enum으로 회전한다.
    // 가로에서 폭/높이까지 교환하면 한컴에서 이중 회전되어 페이지는 세로, 콘텐츠만 가로 폭이 된다.
    const paper = paperBase;
    const m = Object.assign({}, DEFAULT_MARGINS_HWP, marginsHwp || {});
    return `<hp:secPr id="" textDirection="HORIZONTAL" spaceColumns="1134" tabStop="8000" ` +
        `tabStopVal="4000" tabStopUnit="HWPUNIT" outlineShapeIDRef="0" memoShapeIDRef="0" ` +
        `textVerticalWidthHead="0" masterPageCnt="${hasMasterPage ? 1 : 0}">` +
        `<hp:grid lineGrid="0" charGrid="0" wonggojiFormat="0"/>` +
        `<hp:startNum pageStartsOn="BOTH" page="0" pic="0" tbl="0" equation="0"/>` +
        `<hp:visibility hideFirstHeader="0" hideFirstFooter="0" hideFirstMasterPage="0" ` +
        `border="SHOW_ALL" fill="SHOW_ALL" hideFirstPageNum="0" hideFirstEmptyLine="0" showLineNumber="0"/>` +
        `<hp:lineNumberShape restartType="0" countBy="0" distance="0" startNumber="0"/>` +
        `<hp:pagePr landscape="${landscape ? 'NARROWLY' : 'WIDELY'}" width="${paper.w}" height="${paper.h}" gutterType="LEFT_ONLY">` +
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
function buildSection(ir, marginsHwp, paperKey, landscape = false, customBfMap = new Map(), customCharMap = new Map()) {
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

    // ── 상단 제목 블록 / 표지 / 문서 제목 ─────────────────────────────────
    //   basic/unit/annual 은 모두 한 표(buildCoverTable)로: 상단 띠 / 제목 흰칸 /
    //   하단 띠 / (소속·작성자 또는 [팀명·이름]) 흰칸. 작성일은 표 밖 바로 아래 우측.
    //   그 외(없음)   : 제목만 H1
    const titleText = (ir.title && ir.title.trim()) ? ir.title.trim() : '';
    const coverStyle = docType === 'titleblock' ? 'basic'
                     : docType === 'cover-unit' ? 'unit'
                     : docType === 'cover-annual' ? 'annual' : null;
    if (coverStyle) {
        parts.push(buildCoverTable(coverStyle, titleText, contentWidthHwp));
        const today = new Date();
        const dateStr = `${today.getFullYear()}년 ${today.getMonth() + 1}월 ${today.getDate()}일`;
        parts.push(buildPara(dateStr, '0', '13'));   // 작성일: 표 밖 바로 아래, 우측 정렬(paraPr 13)
        parts.push(buildBlankPara());
    } else if (titleText) {
        parts.push(buildPara(titleText, '1', '12'));   // 제목: H1 + 가운데 정렬(paraPr 12)
        parts.push(buildBlankPara());  // 제목 아래 빈 줄
    }

    const pushQuoteBlocks = (quoteBlocks) => {
        for (const quoteBlock of removeHrSpacerBlanks(quoteBlocks)) {
            const qType = quoteBlock.type;
            if (qType === 'para') {
                if (quoteBlock.runs && quoteBlock.runs.length > 0) {
                    const hasText = quoteBlock.runs.some(r => r.text && r.text.trim());
                    parts.push(hasText ? buildParaRuns(quoteBlock.runs, '19', customCharMap) : buildBlankPara());
                } else if (quoteBlock.text && quoteBlock.text.trim()) {
                    parts.push(buildPara(quoteBlock.text, '0', '19'));
                } else {
                    parts.push(buildBlankPara());
                }
            } else if (qType === 'heading') {
                const { charId } = headingIds(quoteBlock.level);
                parts.push(buildPara(quoteBlock.text || '', quoteBlock._cId || charId, '19'));
            } else if (qType === 'list') {
                const blockOrdered = !!quoteBlock.ordered;
                let autoNum = 0;
                (quoteBlock.items || []).forEach((rawItem) => {
                    const item = typeof rawItem === 'object' ? rawItem : { text: rawItem };
                    const level = Math.max(0, Math.min(item.level || 0, 2));
                    const ordered = item.ordered != null ? item.ordered : blockOrdered;
                    const bullets = ['· ', '◦ ', '▪ '];
                    let marker;
                    if (item.task) marker = item.checked ? '▣ ' : '□ ';
                    else if (ordered) marker = `${item.marker != null ? item.marker : (++autoNum)}. `;
                    else marker = bullets[level];
                    if (item.text) parts.push(buildPara(marker + item.text, '0', '19'));
                    for (const codeBlock of (item.codeBlocks || [])) {
                        parts.push(buildCodeBlock(codeBlock, '', contentWidthHwp));
                    }
                });
            } else if (qType === 'code') {
                parts.push(buildCodeBlock(quoteBlock, '', contentWidthHwp));
            } else if (qType === 'table') {
                parts.push(buildTable(quoteBlock.header, quoteBlock.rows, contentWidthHwp, customBfMap, customCharMap));
            } else if (qType === 'hr') {
                parts.push(buildHrPara(contentWidthHwp));
            } else if (qType === 'quote') {
                pushQuoteBlocks(quoteBlock.blocks || []);
            } else if (quoteBlock.text) {
                parts.push(buildPara(quoteBlock.text, '0', '19'));
            }
        }
    };

    // ── 본문 블록 ──────────────────────────────────────────────────────
    for (const block of removeHrSpacerBlanks(ir.blocks)) {
        const bt = block.type;

        if (bt === 'heading') {
            const { charId, paraId } = headingIds(block.level);
            // 색 있는 제목은 사전 스캔이 만든 동적 charPr(제목 크기+색) 사용
            parts.push(buildPara(block.text || '', block._cId || charId, paraId));

        } else if (bt === 'para') {
            const alignParaId = block.align === 'center' ? '12' : block.align === 'right' ? '13' : '0';
            if (block.runs && block.runs.length > 0) {
                // 인라인 서식(bold/italic/code) 보존 경로
                const hasText = block.runs.some(r => r.text && r.text.trim());
                parts.push(hasText ? buildParaRuns(block.runs, alignParaId, customCharMap) : buildBlankPara());
            } else if (!block.text || !block.text.trim()) {
                parts.push(buildBlankPara());
            } else {
                parts.push(buildPara(block.text, '0', alignParaId));
            }

        } else if (bt === 'blank') {
            // 명시적 빈 줄 블록
            parts.push(buildBlankPara());

        } else if (bt === 'hr') {
            // 구분선 → 글자처럼 취급되는 표 객체
            parts.push(buildHrPara(contentWidthHwp));

        } else if (bt === 'list') {
            // 중첩 레벨(level)별 들여쓰기 paraPr: 0→5, 1→17, 2+→18
            // 항목은 문자열(레거시 HTML 경로) 또는 객체(MD: level/ordered/marker/task/checked)
            const blockOrdered = !!block.ordered;
            let autoNum = 0;
            (block.items || []).forEach((rawItem) => {
                const item = typeof rawItem === 'object' ? rawItem : { text: rawItem };
                const level = Math.max(0, Math.min(item.level || 0, 2));
                const listParaId = level === 0 ? '5' : level === 1 ? '17' : '18';
                const ordered = item.ordered != null ? item.ordered : blockOrdered;
                const bullets = ['· ', '◦ ', '▪ '];
                let marker;
                // 체크박스: ☑/☐(U+2600~ 블록)은 replaceEmoji가 □로 치환하므로
                // 그 범위 밖 기하 도형으로 체크(▣)/미체크(□)를 구분 표기
                if (item.task) marker = item.checked ? '▣ ' : '□ ';
                else if (ordered) marker = `${item.marker != null ? item.marker : (++autoNum)}. `;
                else marker = bullets[level];
                if (item.text) parts.push(buildPara(marker + item.text, '0', listParaId));
                for (const codeBlock of (item.codeBlocks || [])) {
                    parts.push(buildCodeBlock(codeBlock, '  ', contentWidthHwp));
                }
            });

        } else if (bt === 'table') {
            parts.push(buildTable(block.header, block.rows, contentWidthHwp, customBfMap, customCharMap));

        } else if (bt === 'code') {
            parts.push(buildCodeBlock(block, '', contentWidthHwp));

        } else if (bt === 'quote') {
            pushQuoteBlocks(block.blocks || []);

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
        `<hs:sec xmlns:hs="${NS_HS}" xmlns:hp="${NS_HP}" xmlns:hc="http://www.hancom.co.kr/hwpml/2011/core">` +
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
 * @param {number} lineSpacingPercent 본문 줄 간격 퍼센트
 */
async function buildHwpx(ir, fontName = '휴먼명조', fontSize = 12, marginsMm = null, paperSize = 'A4', onProgress = null, orientation = 'portrait', lineSpacingPercent = 160) {
    if (typeof JSZip === 'undefined') throw new Error('JSZip 미로드: 인터넷 연결을 확인하세요.');

    validateCodeAudit(ir);

    const marginsHwp = marginsMmToHwp(marginsMm || DEFAULT_MARGINS_MM);
    const landscape  = orientation === 'landscape';

    // 표 셀 배경색 수집 → 동적 borderFill 생성용
    const customBfMap = new Map();
    let nextBfId = 20;   // 1~11 기본 + 12~18 표지 밴드 + 19 인용구 이후부터 DOCX 셀 배경색
    const scanBorderFills = (blocks) => {
        for (const block of (blocks || [])) {
            if (block.type === 'table') {
                const allRows = (block.header && block.header.length ? [block.header] : []).concat(block.rows || []);
                for (const row of allRows) {
                    for (const cell of (row || [])) {
                        const bg = cellBg(cell);
                        if (bg) {
                            nextBfId = addBgBorderFillVariants(customBfMap, bg, nextBfId);
                        }
                    }
                }
            } else if (block.type === 'quote') {
                scanBorderFills(block.blocks || []);
            } else if (block.type === 'list') {
                for (const item of (block.items || [])) scanBorderFills(item.codeBlocks || []);
            }
        }
    };
    scanBorderFills(ir.blocks || []);

    // 인라인 확장 서식(밑줄/취소선/글자색) 수집 → 동적 charPr 생성용
    // (header가 section보다 먼저 빌드되므로 customBfMap과 동일하게 사전 스캔)
    const customCharMap = new Map();
    let nextCharId = 13;   // 0~11 기본 + 12(1pt) 이후부터 동적 확장
    const addExtChar = (run) => {
        if (!runNeedsExtChar(run)) return null;
        const key = extCharKey(run);
        if (!customCharMap.has(key)) customCharMap.set(key, nextCharId++);
        return customCharMap.get(key);
    };
    // 제목 색 보존용 제목 크기(HWPUNIT) — buildHeaderXml sz와 동일 계산
    const _bp = Math.max(6, Math.min(36, parseInt(fontSize, 10) || 12));
    const headingHeightHwp = (lvl) => ({
        1: (_bp + 6) * 100, 2: (_bp + 4) * 100, 3: (_bp + 2) * 100,
        4: (_bp + 1) * 100, 5: _bp * 100, 6: Math.max((_bp - 1) * 100, 800),
    }[lvl] || _bp * 100);
    const scanCharProps = (blocks) => {
        for (const block of (blocks || [])) {
            if (block.type === 'para' && Array.isArray(block.runs)) {
                for (const run of block.runs) if (run.text) addExtChar(run);
            } else if (block.type === 'heading' && block.color) {
                // 색 있는 제목: 제목 크기 + bold + 색으로 동적 charPr 생성 후 블록에 charId 주석
                const cid = addExtChar({ bold: true, color: block.color, height: headingHeightHwp(block.level || 1) });
                if (cid != null) block._cId = String(cid);
            } else if (block.type === 'table') {
                // 표 셀 글자색(예: 흰 글자 머리행)도 동적 charPr 대상 — 머리행은 bold
                (block.header || []).forEach(c => { const col = cellColor(c); if (col) addExtChar({ color: col, bold: true }); });
                (block.rows || []).forEach(row => (row || []).forEach(c => { const col = cellColor(c); if (col) addExtChar({ color: col, bold: false }); }));
            } else if (block.type === 'quote') {
                scanCharProps(block.blocks || []);
            } else if (block.type === 'list') {
                for (const item of (block.items || [])) scanCharProps(item.codeBlocks || []);
            }
        }
    };
    scanCharProps(ir.blocks || []);

    // 이미지 블록 수집
    const imageBlocks = (ir.blocks || []).filter(b => b.type === 'image');
    const docHeaderFooter = { header: ir.header || '', footer: ir.footer || '' };

    const headerXml   = buildHeaderXml(fontName, fontSize, customBfMap, imageBlocks, docHeaderFooter, customCharMap, lineSpacingPercent);
    const section0Xml = buildSection(ir, marginsHwp, paperSize, landscape, customBfMap, customCharMap);

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
    zip.file('Contents/content.hpf',   imageBlocks.length ? buildContentHpf(imageBlocks) : CONTENT_HPF);
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
            const pageDirection = (pagePrMatch[1].match(/\blandscape="([^"]+)"/) || [])[1] || 'WIDELY';
            const effectivePageWidth = pageDirection === 'NARROWLY' ? pageAttrs.height : pageAttrs.width;
            const expectedContentWidth = effectivePageWidth - marginAttrs.left - marginAttrs.right;
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
