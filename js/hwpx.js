/* ===================================================================
 * [hwpx.js]  HWPX 빌더 + 클라이언트 사이드 검증기  v2
 * ===================================================================
 * v1 대비 개선 사항:
 *   ① charPr 2종 → 7종 (본문/H1/H2/H3/H4/표머리/코드)
 *   ② paraPr 1종 → 7종 (본문/H1/H2/H3/H4/목록/코드블록) 단락전후 여백 정의
 *   ③ charPr borderFillIDRef "2"(실선) → "1"(없음) 버그 수정
 *      ← 이 버그가 모든 글자에 박스 테두리를 붙여 품질 최악의 주원인
 *   ④ secPr 추가: A4/B5/Letter 용지, 페이지 여백 사용자 지정
 *   ⑤ buildHwpx(ir, fontName, marginsMm, paperSize) 서명 변경
 *   ⑥ code 블록 타입 지원 (들여쓰기 + 소형 폰트)
 *   ⑦ 순서있는 목록(ordered:true) 지원
 *
 * 핵심 규칙:
 *   - mimetype은 ZIP 첫 항목, 무압축(STORE)
 *   - header.xml의 charPr/paraPr id와 section0.xml의 IDRef가 일치해야 함
 *   - secPr는 section0.xml 맨 마지막에 배치 (한컴 호환)
 *
 * [수정 가이드]
 *   글꼴 변경    → HEADER_XML의 face="KoPubDotumMedium" 교체
 *   스타일 추가  → HEADER_XML charProperties/paraProperties + buildSection 분기 추가
 *   용지 추가    → PAPER_SIZES 객체에 항목 추가
 * ===================================================================*/

'use strict';

// ─────────────────────────────────────────────────────────────────────────
// [측정 단위 상수]
//   HWPUNIT: 한글 내부 단위, 1/7200 inch
//   1pt  = 100  HWPUNIT   (글자 height: 10pt = 1000)
//   1mm  ≈ 283  HWPUNIT   (정확: 283.465)
//   1inch= 7200 HWPUNIT
// ─────────────────────────────────────────────────────────────────────────
const MM_TO_HWP = 283.465;

/** mm → HWPUNIT 변환 (반올림) */
function mmToHwp(mm) { return Math.round(mm * MM_TO_HWP); }

// ─────────────────────────────────────────────────────────────────────────
// [용지 크기] HWPUNIT 기준
// ─────────────────────────────────────────────────────────────────────────
const PAPER_SIZES = {
    'A4':     { w: 59528, h: 84188 },  // 210 × 297 mm
    'B5':     { w: 51430, h: 72817 },  // 182 × 257 mm (JIS)
    'Letter': { w: 61920, h: 80136 },  // 8.5 × 11 inch
};

// ─────────────────────────────────────────────────────────────────────────
// [기본 페이지 여백] — 모두 HWPUNIT
//   좌30mm 우30mm 상20mm 하20mm 머리글15mm 꼬리글15mm
// ─────────────────────────────────────────────────────────────────────────
const DEFAULT_MARGINS_HWP = {
    left:   8504,  // 30mm
    right:  8504,  // 30mm
    top:    5669,  // 20mm
    bottom: 5669,  // 20mm
    header: 4252,  // 15mm
    footer: 4252,  // 15mm
};


// ─────────────────────────────────────────────────────────────────────────
// [베이스 템플릿 상수]
//   검증된 HWPX 구조를 JS 상수로 내장
//   [주의] 이 상수는 직접 수정 시 한글 호환이 깨질 수 있음
// ─────────────────────────────────────────────────────────────────────────

/** mimetype (정확히 이 문자열, 앞뒤 공백 금지) */
const MIMETYPE = 'application/hwp+zip';

/** 버전 XML */
const VERSION_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<hv:HCFVersion xmlns:hv="http://www.hancom.co.kr/hwpml/2011/version" tagetApplication="WORDPROCESSOR" major="5" minor="0" micro="5" buildNumber="0" os="1" application="Hancom Office Hangul"/>`;

/** 애플리케이션 설정 */
const SETTINGS_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<ha:HWPApplicationSetting xmlns:ha="http://www.hancom.co.kr/hwpml/2011/app"/>`;

/** OPC 컨테이너 */
const CONTAINER_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<ocf:container xmlns:ocf="urn:oasis:names:tc:opendocument:xmlns:container">
  <ocf:rootfiles>
    <ocf:rootfile full-path="Contents/content.hpf" media-type="application/hwpml-package+xml"/>
  </ocf:rootfiles>
</ocf:container>`;

/** RDF 메타데이터 */
const CONTAINER_RDF = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
</rdf:RDF>`;

/** ODF 매니페스트 */
const MANIFEST_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<odf:manifest xmlns:odf="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" version="1.2">
  <odf:file-entry odf:full-path="/" odf:media-type="application/hwp+zip"/>
  <odf:file-entry odf:full-path="Contents/header.xml" odf:media-type="application/xml"/>
  <odf:file-entry odf:full-path="Contents/section0.xml" odf:media-type="application/xml"/>
</odf:manifest>`;

/** OPF 패키지 */
const CONTENT_HPF = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<opf:package xmlns:opf="http://www.idpf.org/2007/opf/" version="" unique-identifier="" id="">
  <opf:metadata>
    <opf:title>HWPX Document</opf:title>
  </opf:metadata>
  <opf:manifest>
    <opf:item id="header"   href="Contents/header.xml"   media-type="application/xml"/>
    <opf:item id="section0" href="Contents/section0.xml" media-type="application/xml"/>
  </opf:manifest>
  <opf:spine>
    <opf:itemref idref="section0" linear="yes"/>
  </opf:spine>
</opf:package>`;

/**
 * HEADER_XML — 글꼴·글자모양·문단모양·테두리 정의
 *
 * [charPr ID 체계]
 *   id=0  본문       10pt 보통
 *   id=1  H1 대제목  18pt 굵게
 *   id=2  H2 중제목  16pt 굵게
 *   id=3  H3 소제목  14pt 굵게
 *   id=4  H4 세제목  12pt 굵게
 *   id=5  표 머리글  10pt 굵게
 *   id=6  코드 블록   9pt 보통 (색상 #333333)
 *
 * [paraPr ID 체계]
 *   id=0  본문   양쪽정렬 160% 단락후283
 *   id=1  H1    왼쪽정렬 180% 전850 후567
 *   id=2  H2    왼쪽정렬 170% 전700 후425
 *   id=3  H3    왼쪽정렬 160% 전567 후283
 *   id=4  H4    왼쪽정렬 160% 전425 후200
 *   id=5  목록  왼쪽정렬 160% 좌들여600 후100
 *   id=6  코드  왼쪽정렬 140% 좌우들여400 전후200
 *
 * [borderFill ID 체계]
 *   id=1  테두리 없음    (charPr · 일반 단락에서 참조)
 *   id=2  실선 테두리    (표 일반 셀)
 *   id=3  실선+회색음영  (표 머리글 셀)
 *
 * [중요] charPr의 borderFillIDRef는 반드시 "1"(테두리 없음) 사용
 *        "2"로 설정하면 모든 글자에 박스 테두리가 붙어 품질이 최악이 됨
 */
const HEADER_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<hh:head xmlns:hh="http://www.hancom.co.kr/hwpml/2011/head" version="1.4" secCnt="1">
  <hh:beginNum page="1" footnote="1" endnote="1" pic="1" tbl="1" equation="1"/>
  <hh:refList>

    <!-- ── 글꼴 정의 ────────────────────────────────────────────────
         lang: HANGUL(한글) / LATIN(영문) 각각 정의 필수
         [수정 시] face 속성값만 원하는 글꼴명으로 교체
         buildHwpx(ir, fontName)의 fontName이 이 face 값을 치환함
    ──────────────────────────────────────────────────────────────── -->
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

    <!-- ── 글자 모양 (charPr) 7종 ──────────────────────────────────
         [핵심] borderFillIDRef="1" (테두리 없음) — "2"면 글자마다 박스 생김
    ──────────────────────────────────────────────────────────────── -->
    <hh:charProperties itemCnt="7">

      <!-- id=0  본문 10pt -->
      <hh:charPr id="0" height="1000" textColor="#000000" shadeColor="none" useFontSpace="0" useKerning="0" symMark="NONE" borderFillIDRef="1">
        <hh:fontRef hangul="0" latin="0" hanja="0" japanese="0" other="0" symbol="0" user="0"/>
        <hh:ratio hangul="100" latin="100" hanja="100" japanese="100" other="100" symbol="100" user="100"/>
        <hh:spacing hangul="0" latin="0" hanja="0" japanese="0" other="0" symbol="0" user="0"/>
        <hh:relSz hangul="100" latin="100" hanja="100" japanese="100" other="100" symbol="100" user="100"/>
        <hh:offset hangul="0" latin="0" hanja="0" japanese="0" other="0" symbol="0" user="0"/>
      </hh:charPr>

      <!-- id=1  H1 대제목 18pt 굵게 -->
      <hh:charPr id="1" height="1800" textColor="#000000" shadeColor="none" useFontSpace="0" useKerning="0" symMark="NONE" borderFillIDRef="1">
        <hh:fontRef hangul="0" latin="0" hanja="0" japanese="0" other="0" symbol="0" user="0"/>
        <hh:ratio hangul="100" latin="100" hanja="100" japanese="100" other="100" symbol="100" user="100"/>
        <hh:spacing hangul="0" latin="0" hanja="0" japanese="0" other="0" symbol="0" user="0"/>
        <hh:relSz hangul="100" latin="100" hanja="100" japanese="100" other="100" symbol="100" user="100"/>
        <hh:offset hangul="0" latin="0" hanja="0" japanese="0" other="0" symbol="0" user="0"/>
        <hh:bold/>
      </hh:charPr>

      <!-- id=2  H2 중제목 16pt 굵게 -->
      <hh:charPr id="2" height="1600" textColor="#000000" shadeColor="none" useFontSpace="0" useKerning="0" symMark="NONE" borderFillIDRef="1">
        <hh:fontRef hangul="0" latin="0" hanja="0" japanese="0" other="0" symbol="0" user="0"/>
        <hh:ratio hangul="100" latin="100" hanja="100" japanese="100" other="100" symbol="100" user="100"/>
        <hh:spacing hangul="0" latin="0" hanja="0" japanese="0" other="0" symbol="0" user="0"/>
        <hh:relSz hangul="100" latin="100" hanja="100" japanese="100" other="100" symbol="100" user="100"/>
        <hh:offset hangul="0" latin="0" hanja="0" japanese="0" other="0" symbol="0" user="0"/>
        <hh:bold/>
      </hh:charPr>

      <!-- id=3  H3 소제목 14pt 굵게 -->
      <hh:charPr id="3" height="1400" textColor="#000000" shadeColor="none" useFontSpace="0" useKerning="0" symMark="NONE" borderFillIDRef="1">
        <hh:fontRef hangul="0" latin="0" hanja="0" japanese="0" other="0" symbol="0" user="0"/>
        <hh:ratio hangul="100" latin="100" hanja="100" japanese="100" other="100" symbol="100" user="100"/>
        <hh:spacing hangul="0" latin="0" hanja="0" japanese="0" other="0" symbol="0" user="0"/>
        <hh:relSz hangul="100" latin="100" hanja="100" japanese="100" other="100" symbol="100" user="100"/>
        <hh:offset hangul="0" latin="0" hanja="0" japanese="0" other="0" symbol="0" user="0"/>
        <hh:bold/>
      </hh:charPr>

      <!-- id=4  H4 세제목 12pt 굵게 -->
      <hh:charPr id="4" height="1200" textColor="#000000" shadeColor="none" useFontSpace="0" useKerning="0" symMark="NONE" borderFillIDRef="1">
        <hh:fontRef hangul="0" latin="0" hanja="0" japanese="0" other="0" symbol="0" user="0"/>
        <hh:ratio hangul="100" latin="100" hanja="100" japanese="100" other="100" symbol="100" user="100"/>
        <hh:spacing hangul="0" latin="0" hanja="0" japanese="0" other="0" symbol="0" user="0"/>
        <hh:relSz hangul="100" latin="100" hanja="100" japanese="100" other="100" symbol="100" user="100"/>
        <hh:offset hangul="0" latin="0" hanja="0" japanese="0" other="0" symbol="0" user="0"/>
        <hh:bold/>
      </hh:charPr>

      <!-- id=5  표 머리글 10pt 굵게 (표 내부 헤더 행 전용) -->
      <hh:charPr id="5" height="1000" textColor="#000000" shadeColor="none" useFontSpace="0" useKerning="0" symMark="NONE" borderFillIDRef="1">
        <hh:fontRef hangul="0" latin="0" hanja="0" japanese="0" other="0" symbol="0" user="0"/>
        <hh:ratio hangul="100" latin="100" hanja="100" japanese="100" other="100" symbol="100" user="100"/>
        <hh:spacing hangul="0" latin="0" hanja="0" japanese="0" other="0" symbol="0" user="0"/>
        <hh:relSz hangul="100" latin="100" hanja="100" japanese="100" other="100" symbol="100" user="100"/>
        <hh:offset hangul="0" latin="0" hanja="0" japanese="0" other="0" symbol="0" user="0"/>
        <hh:bold/>
      </hh:charPr>

      <!-- id=6  코드 블록 9pt 진회색 -->
      <hh:charPr id="6" height="900" textColor="#333333" shadeColor="none" useFontSpace="0" useKerning="0" symMark="NONE" borderFillIDRef="1">
        <hh:fontRef hangul="0" latin="0" hanja="0" japanese="0" other="0" symbol="0" user="0"/>
        <hh:ratio hangul="100" latin="100" hanja="100" japanese="100" other="100" symbol="100" user="100"/>
        <hh:spacing hangul="0" latin="0" hanja="0" japanese="0" other="0" symbol="0" user="0"/>
        <hh:relSz hangul="100" latin="100" hanja="100" japanese="100" other="100" symbol="100" user="100"/>
        <hh:offset hangul="0" latin="0" hanja="0" japanese="0" other="0" symbol="0" user="0"/>
      </hh:charPr>

    </hh:charProperties>

    <!-- ── 문단 모양 (paraPr) 7종 ──────────────────────────────────
         margin: intent=들여쓰기, left=왼쪽, right=오른쪽, prev=단락전, next=단락후
         단위: HWPUNIT (1mm≈283)
    ──────────────────────────────────────────────────────────────── -->
    <hh:paraProperties itemCnt="7">

      <!-- id=0  본문: 양쪽정렬, 줄간격160%, 단락후 283(1mm) -->
      <hh:paraPr id="0" tabPrIDRef="0" condense="0" fontLineHeight="0" snapToGrid="1" suppressLineNumbers="0" checked="0">
        <hh:align horizontal="JUSTIFY" vertical="BASELINE"/>
        <hh:heading type="NONE" idRef="0" level="0"/>
        <hh:breakSetting breakLatinWord="KEEP_WORD" breakNonLatinWord="KEEP_WORD" widowOrphan="0" keepWithNext="0" keepLines="0" pageBreakBefore="0" lineWrap="BREAK"/>
        <hh:margin><hh:intent value="0" unit="HWPUNIT"/><hh:left value="0" unit="HWPUNIT"/><hh:right value="0" unit="HWPUNIT"/><hh:prev value="0" unit="HWPUNIT"/><hh:next value="283" unit="HWPUNIT"/></hh:margin>
        <hh:lineSpacing type="PERCENT" value="160" unit="HWPUNIT"/>
        <hh:border borderFillIDRef="1" offsetLeft="0" offsetRight="0" offsetTop="0" offsetBottom="0" connect="0" ignoreMargin="0"/>
      </hh:paraPr>

      <!-- id=1  H1: 왼쪽정렬, 줄간격180%, 단락전850(3mm) 단락후567(2mm) -->
      <hh:paraPr id="1" tabPrIDRef="0" condense="0" fontLineHeight="0" snapToGrid="1" suppressLineNumbers="0" checked="0">
        <hh:align horizontal="LEFT" vertical="BASELINE"/>
        <hh:heading type="NONE" idRef="0" level="0"/>
        <hh:breakSetting breakLatinWord="KEEP_WORD" breakNonLatinWord="KEEP_WORD" widowOrphan="0" keepWithNext="1" keepLines="0" pageBreakBefore="0" lineWrap="BREAK"/>
        <hh:margin><hh:intent value="0" unit="HWPUNIT"/><hh:left value="0" unit="HWPUNIT"/><hh:right value="0" unit="HWPUNIT"/><hh:prev value="850" unit="HWPUNIT"/><hh:next value="567" unit="HWPUNIT"/></hh:margin>
        <hh:lineSpacing type="PERCENT" value="180" unit="HWPUNIT"/>
        <hh:border borderFillIDRef="1" offsetLeft="0" offsetRight="0" offsetTop="0" offsetBottom="0" connect="0" ignoreMargin="0"/>
      </hh:paraPr>

      <!-- id=2  H2: 왼쪽정렬, 줄간격170%, 단락전700(2.5mm) 단락후425(1.5mm) -->
      <hh:paraPr id="2" tabPrIDRef="0" condense="0" fontLineHeight="0" snapToGrid="1" suppressLineNumbers="0" checked="0">
        <hh:align horizontal="LEFT" vertical="BASELINE"/>
        <hh:heading type="NONE" idRef="0" level="0"/>
        <hh:breakSetting breakLatinWord="KEEP_WORD" breakNonLatinWord="KEEP_WORD" widowOrphan="0" keepWithNext="1" keepLines="0" pageBreakBefore="0" lineWrap="BREAK"/>
        <hh:margin><hh:intent value="0" unit="HWPUNIT"/><hh:left value="0" unit="HWPUNIT"/><hh:right value="0" unit="HWPUNIT"/><hh:prev value="700" unit="HWPUNIT"/><hh:next value="425" unit="HWPUNIT"/></hh:margin>
        <hh:lineSpacing type="PERCENT" value="170" unit="HWPUNIT"/>
        <hh:border borderFillIDRef="1" offsetLeft="0" offsetRight="0" offsetTop="0" offsetBottom="0" connect="0" ignoreMargin="0"/>
      </hh:paraPr>

      <!-- id=3  H3: 왼쪽정렬, 줄간격160%, 단락전567(2mm) 단락후283(1mm) -->
      <hh:paraPr id="3" tabPrIDRef="0" condense="0" fontLineHeight="0" snapToGrid="1" suppressLineNumbers="0" checked="0">
        <hh:align horizontal="LEFT" vertical="BASELINE"/>
        <hh:heading type="NONE" idRef="0" level="0"/>
        <hh:breakSetting breakLatinWord="KEEP_WORD" breakNonLatinWord="KEEP_WORD" widowOrphan="0" keepWithNext="1" keepLines="0" pageBreakBefore="0" lineWrap="BREAK"/>
        <hh:margin><hh:intent value="0" unit="HWPUNIT"/><hh:left value="0" unit="HWPUNIT"/><hh:right value="0" unit="HWPUNIT"/><hh:prev value="567" unit="HWPUNIT"/><hh:next value="283" unit="HWPUNIT"/></hh:margin>
        <hh:lineSpacing type="PERCENT" value="160" unit="HWPUNIT"/>
        <hh:border borderFillIDRef="1" offsetLeft="0" offsetRight="0" offsetTop="0" offsetBottom="0" connect="0" ignoreMargin="0"/>
      </hh:paraPr>

      <!-- id=4  H4: 왼쪽정렬, 줄간격160%, 단락전425(1.5mm) 단락후200 -->
      <hh:paraPr id="4" tabPrIDRef="0" condense="0" fontLineHeight="0" snapToGrid="1" suppressLineNumbers="0" checked="0">
        <hh:align horizontal="LEFT" vertical="BASELINE"/>
        <hh:heading type="NONE" idRef="0" level="0"/>
        <hh:breakSetting breakLatinWord="KEEP_WORD" breakNonLatinWord="KEEP_WORD" widowOrphan="0" keepWithNext="1" keepLines="0" pageBreakBefore="0" lineWrap="BREAK"/>
        <hh:margin><hh:intent value="0" unit="HWPUNIT"/><hh:left value="0" unit="HWPUNIT"/><hh:right value="0" unit="HWPUNIT"/><hh:prev value="425" unit="HWPUNIT"/><hh:next value="200" unit="HWPUNIT"/></hh:margin>
        <hh:lineSpacing type="PERCENT" value="160" unit="HWPUNIT"/>
        <hh:border borderFillIDRef="1" offsetLeft="0" offsetRight="0" offsetTop="0" offsetBottom="0" connect="0" ignoreMargin="0"/>
      </hh:paraPr>

      <!-- id=5  목록: 왼쪽정렬, 줄간격160%, 왼쪽들여600, 단락후100 -->
      <hh:paraPr id="5" tabPrIDRef="0" condense="0" fontLineHeight="0" snapToGrid="1" suppressLineNumbers="0" checked="0">
        <hh:align horizontal="LEFT" vertical="BASELINE"/>
        <hh:heading type="NONE" idRef="0" level="0"/>
        <hh:breakSetting breakLatinWord="KEEP_WORD" breakNonLatinWord="KEEP_WORD" widowOrphan="0" keepWithNext="0" keepLines="0" pageBreakBefore="0" lineWrap="BREAK"/>
        <hh:margin><hh:intent value="0" unit="HWPUNIT"/><hh:left value="600" unit="HWPUNIT"/><hh:right value="0" unit="HWPUNIT"/><hh:prev value="0" unit="HWPUNIT"/><hh:next value="100" unit="HWPUNIT"/></hh:margin>
        <hh:lineSpacing type="PERCENT" value="160" unit="HWPUNIT"/>
        <hh:border borderFillIDRef="1" offsetLeft="0" offsetRight="0" offsetTop="0" offsetBottom="0" connect="0" ignoreMargin="0"/>
      </hh:paraPr>

      <!-- id=6  코드블록: 왼쪽정렬, 줄간격140%, 좌우들여400, 전후200 -->
      <hh:paraPr id="6" tabPrIDRef="0" condense="0" fontLineHeight="0" snapToGrid="1" suppressLineNumbers="0" checked="0">
        <hh:align horizontal="LEFT" vertical="BASELINE"/>
        <hh:heading type="NONE" idRef="0" level="0"/>
        <hh:breakSetting breakLatinWord="KEEP_WORD" breakNonLatinWord="KEEP_WORD" widowOrphan="0" keepWithNext="0" keepLines="0" pageBreakBefore="0" lineWrap="BREAK"/>
        <hh:margin><hh:intent value="0" unit="HWPUNIT"/><hh:left value="400" unit="HWPUNIT"/><hh:right value="400" unit="HWPUNIT"/><hh:prev value="200" unit="HWPUNIT"/><hh:next value="200" unit="HWPUNIT"/></hh:margin>
        <hh:lineSpacing type="PERCENT" value="140" unit="HWPUNIT"/>
        <hh:border borderFillIDRef="1" offsetLeft="0" offsetRight="0" offsetTop="0" offsetBottom="0" connect="0" ignoreMargin="0"/>
      </hh:paraPr>

    </hh:paraProperties>

    <!-- ── 테두리/채움 패턴 3종 ──────────────────────────────────────
         id=1  테두리 없음  (charPr·paraPr 기본값 — 이게 없으면 글자마다 박스 생김)
         id=2  실선 테두리  (표 일반 셀)
         id=3  실선+회색음영 (표 머리글 셀)
    ──────────────────────────────────────────────────────────────── -->
    <hh:borderFills itemCnt="3">

      <!-- id=1  테두리 없음 -->
      <hh:borderFill id="1" threeD="0" shadow="0" centerLine="NONE" breakCellSeparateLine="0">
        <hh:slash type="NONE" Crooked="0" isCounter="0"/>
        <hh:backSlash type="NONE" Crooked="0" isCounter="0"/>
        <hh:leftBorder type="NONE" width="0.1 mm" color="#000000"/>
        <hh:rightBorder type="NONE" width="0.1 mm" color="#000000"/>
        <hh:topBorder type="NONE" width="0.1 mm" color="#000000"/>
        <hh:bottomBorder type="NONE" width="0.1 mm" color="#000000"/>
        <hh:diagonal type="SOLID" width="0.1 mm" color="#000000"/>
      </hh:borderFill>

      <!-- id=2  실선 테두리 (표 일반 셀) -->
      <hh:borderFill id="2" threeD="0" shadow="0" centerLine="NONE" breakCellSeparateLine="0">
        <hh:slash type="NONE" Crooked="0" isCounter="0"/>
        <hh:backSlash type="NONE" Crooked="0" isCounter="0"/>
        <hh:leftBorder type="SOLID" width="0.12 mm" color="#000000"/>
        <hh:rightBorder type="SOLID" width="0.12 mm" color="#000000"/>
        <hh:topBorder type="SOLID" width="0.12 mm" color="#000000"/>
        <hh:bottomBorder type="SOLID" width="0.12 mm" color="#000000"/>
        <hh:diagonal type="SOLID" width="0.1 mm" color="#000000"/>
      </hh:borderFill>

      <!-- id=3  실선+회색음영 (표 머리글 셀) -->
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

/** 미리보기 PNG (1×1 투명) — 한글 파일 탐색기 썸네일용 */
const MIN_PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';


// ─────────────────────────────────────────────────────────────────────────
// [XML 유틸리티]
// ─────────────────────────────────────────────────────────────────────────

/**
 * XML 특수문자 이스케이프
 * [필수] 사용자 입력 텍스트를 XML에 포함할 때 반드시 이 함수를 거쳐야 함
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
// ─────────────────────────────────────────────────────────────────────────

/**
 * 단일 단락(hp:p) XML 생성
 * @param {string} text    단락 텍스트
 * @param {string} charId  글자 스타일 ID ("0"~"6")
 * @param {string} paraId  문단 스타일 ID ("0"~"6")
 */
function buildPara(text, charId = '0', paraId = '0') {
    return `<hp:p paraPrIDRef="${paraId}" styleIDRef="0" pageBreak="0" columnBreak="0">` +
        `<hp:run charPrIDRef="${charId}">` +
        `<hp:t>${xmlEsc(text)}</hp:t>` +
        `</hp:run></hp:p>`;
}

/**
 * heading level → charId / paraId 변환
 * level 1=H1(1/1), 2=H2(2/2), 3=H3(3/3), 4+=H4(4/4)
 */
function headingIds(level) {
    const lv = Math.max(1, Math.min(level || 1, 4));
    return { charId: String(lv), paraId: String(lv) };
}

/**
 * 표(hp:tbl) XML 생성
 * [참조] borderFillIDRef "2"=셀 실선, "3"=머리글 셀 음영
 *        헤더 행 글자: charId="5" (표머리 10pt bold)
 *        일반 행 글자: charId="0" (본문 10pt)
 */
function buildTable(header, rows) {
    const allRows = (header && header.length ? [header] : []).concat(rows || []);
    if (!allRows.length) return buildPara('');

    const nRows = allRows.length;
    const nCols = Math.max(...allRows.map(r => (r || []).length), 1);
    const cellWidth = Math.floor(48000 / nCols);  // 전체 너비 48000 균등 분배

    let rowsXml = '';
    for (let r = 0; r < nRows; r++) {
        const row  = allRows[r] || [];
        const isHd = (header && header.length && r === 0);
        // 헤더 행: charId=5 (10pt bold), borderFill=3 (음영)
        // 일반 행: charId=0 (10pt), borderFill=2 (실선)
        const cId  = isHd ? '5' : '0';
        const bfId = isHd ? '3' : '2';
        let cellsXml = '';

        for (let c = 0; c < nCols; c++) {
            const val = (row[c] !== undefined && row[c] !== null) ? String(row[c]) : '';
            cellsXml +=
                `<hp:tc name="" header="${isHd ? '1' : '0'}" hasMargin="0" protect="0" editable="0" dirty="0" borderFillIDRef="${bfId}">` +
                `<hp:cellAddr colAddr="${c}" rowAddr="${r}"/>` +
                `<hp:cellSpan colSpan="1" rowSpan="1"/>` +
                `<hp:cellSz width="${cellWidth}" height="1000"/>` +
                `<hp:cellMargin left="510" right="510" top="141" bottom="141"/>` +
                `<hp:subList id="" textDirection="HORIZONTAL" lineWrap="BREAK" vertAlign="CENTER" ` +
                    `linkListIDRef="0" linkListNextIDRef="0" textWidth="0" textHeight="0" hasTextRef="0" hasNumRef="0">` +
                buildPara(val, cId, '0') +
                `</hp:subList></hp:tc>`;
        }
        rowsXml += `<hp:tr>${cellsXml}</hp:tr>`;
    }

    return `<hp:p paraPrIDRef="0" styleIDRef="0" pageBreak="0" columnBreak="0"><hp:run charPrIDRef="0">` +
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
 * 페이지 레이아웃(secPr) XML 생성
 * @param {object} marginsHwp - HWPUNIT 여백 {left, right, top, bottom, header, footer}
 * @param {string} paperKey   - 용지 키 "A4"|"B5"|"Letter"
 */
function buildSecPr(marginsHwp, paperKey) {
    const paper = PAPER_SIZES[paperKey] || PAPER_SIZES['A4'];
    const m = Object.assign({}, DEFAULT_MARGINS_HWP, marginsHwp || {});
    return `<hs:secPr textDirection="HORIZONTAL" spaceColumns="1134" tabStop="8000" ` +
        `outlineType="OUTLINE_TYPE_NONE" masterID="0" hideFirstHeader="0" hideFirstFooter="0" ` +
        `isBreak="0" breakType="SECTION">` +
        `<hs:page width="${paper.w}" height="${paper.h}" orientation="PORTRAIT" ` +
        `gutterType="LEFT_ONLY" gutterPosition="LEFT_ONLY">` +
        `<hs:margin left="${m.left}" right="${m.right}" top="${m.top}" bottom="${m.bottom}" ` +
        `header="${m.header}" footer="${m.footer}" gutter="0"/>` +
        `</hs:page>` +
        `<hs:footnote numFormat="DIGIT" numType="CONTINUOUS" position="EACH_COLUMN" startNum="1"/>` +
        `<hs:endnote numFormat="DIGIT" numType="CONTINUOUS" position="EACH_COLUMN" startNum="1"/>` +
        `<hs:pageNumPos pageNumType="NONE" anchorType="PAPER" format="DIGIT" startNum="1" doubleNum="0"/>` +
        `<hs:hide header="0" footer="0" masterpageBorder="0" emptyLine="0" pageNum="0" lineNum="0"/>` +
        `</hs:secPr>`;
}

/**
 * IR → section0.xml XML 전체 문자열 생성
 * @param {object} ir          IR 구조 {title, doc_type, blocks}
 * @param {object} marginsHwp  HWPUNIT 여백 (buildHwpx에서 변환하여 전달)
 * @param {string} paperKey    용지 키
 */
function buildSection(ir, marginsHwp, paperKey) {
    const NS_HS = 'http://www.hancom.co.kr/hwpml/2011/section';
    const NS_HP = 'http://www.hancom.co.kr/hwpml/2011/paragraph';

    const parts = [];

    // 문서 제목 (H1 스타일로 첫 단락)
    if (ir.title && ir.title.trim()) {
        parts.push(buildPara(ir.title, '1', '1'));
        parts.push(buildPara(''));  // 제목 아래 여백 단락
    }

    for (const block of (ir.blocks || [])) {
        const bt = block.type;

        if (bt === 'heading') {
            // level 1→H1(charId=1,paraId=1) … level 4+→H4(4,4)
            const { charId, paraId } = headingIds(block.level);
            parts.push(buildPara(block.text || '', charId, paraId));

        } else if (bt === 'para') {
            parts.push(buildPara(block.text || '', '0', '0'));

        } else if (bt === 'list') {
            // ordered:true → "1. 2. 3." 번호 / false → "· " 글머리
            (block.items || []).forEach((item, i) => {
                const prefix = block.ordered ? `${i + 1}. ` : '· ';
                parts.push(buildPara(prefix + item, '0', '5'));
            });

        } else if (bt === 'table') {
            parts.push(buildTable(block.header, block.rows));

        } else if (bt === 'code') {
            // 코드 블록: 줄별로 분리, 코드 스타일(charId=6, paraId=6) 적용
            const lines = (block.text || '').split('\n');
            for (const line of lines) {
                parts.push(buildPara(line === '' ? ' ' : line, '6', '6'));
            }

        } else {
            // 알 수 없는 타입: text 있으면 일반 단락으로 폴백
            if (block.text) parts.push(buildPara(block.text, '0', '0'));
        }
    }

    // 완전히 비어있으면 공백 단락 하나 필수 (한글이 빈 섹션 처리 오류 방지)
    if (!parts.length) parts.push(buildPara(''));

    // secPr는 섹션 맨 마지막에 배치 (한컴 호환 방식)
    const secPrXml = buildSecPr(marginsHwp, paperKey);

    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
        `<hs:sec xmlns:hs="${NS_HS}" xmlns:hp="${NS_HP}">` +
        parts.join('') +
        secPrXml +
        `</hs:sec>`;
}


// ─────────────────────────────────────────────────────────────────────────
// [HWPX 패키징]
// ─────────────────────────────────────────────────────────────────────────

/**
 * IR → HWPX Blob 생성 (비동기)
 * @param {object} ir             IR 구조
 * @param {string} fontName       출력 폰트 (기본: KoPubDotumMedium)
 * @param {object|null} marginsMm 페이지 여백 mm {left,right,top,bottom} — null이면 기본값
 * @param {string} paperSize      용지 크기 키 "A4"|"B5"|"Letter"
 * @returns {Promise<Blob>}
 */
async function buildHwpx(ir, fontName = 'KoPubDotumMedium', marginsMm = null, paperSize = 'A4') {
    if (typeof JSZip === 'undefined') {
        throw new Error('JSZip 미로드: HWPX 생성 불가. 인터넷 연결을 확인하세요.');
    }

    // mm → HWPUNIT 변환 (사용자 입력이 있을 때만)
    let marginsHwp = null;
    if (marginsMm) {
        marginsHwp = {
            left:   mmToHwp(marginsMm.left   || 30),
            right:  mmToHwp(marginsMm.right  || 30),
            top:    mmToHwp(marginsMm.top    || 20),
            bottom: mmToHwp(marginsMm.bottom || 20),
            header: DEFAULT_MARGINS_HWP.header,
            footer: DEFAULT_MARGINS_HWP.footer,
        };
    }

    // 폰트 교체 (기본값이면 치환 불필요)
    const safeFont = xmlEsc(fontName || 'KoPubDotumMedium');
    const headerXml = (safeFont === 'KoPubDotumMedium')
        ? HEADER_XML
        : HEADER_XML.replace(/face="KoPubDotumMedium"/g, `face="${safeFont}"`);

    // section0.xml 생성
    const section0Xml = buildSection(ir, marginsHwp, paperSize);

    const zip = new JSZip();

    // ─ 1) mimetype: 첫 항목 무압축(STORE) — 어기면 한글에서 손상 파일로 인식 ─
    zip.file('mimetype', MIMETYPE, { compression: 'STORE' });

    // ─ 2) 루트 메타파일 ─
    zip.file('version.xml',  VERSION_XML);
    zip.file('settings.xml', SETTINGS_XML);

    // ─ 3) META-INF ─
    zip.file('META-INF/container.xml', CONTAINER_XML);
    zip.file('META-INF/container.rdf', CONTAINER_RDF);
    zip.file('META-INF/manifest.xml',  MANIFEST_XML);

    // ─ 4) Contents ─
    zip.file('Contents/header.xml',   headerXml);
    zip.file('Contents/section0.xml', section0Xml);
    zip.file('Contents/content.hpf',  CONTENT_HPF);

    // ─ 5) Preview ─
    zip.file('Preview/PrvText.txt',  ir.title || 'To HWPX 변환 문서');
    zip.file('Preview/PrvImage.png', MIN_PNG_B64, { base64: true });

    const blob = await zip.generateAsync({
        type: 'blob',
        compression: 'DEFLATE',
        compressionOptions: { level: 6 },
    });

    return blob;
}


// ─────────────────────────────────────────────────────────────────────────
// [HWPX 검증기]
//   생성된 Blob을 JSZip으로 재로드해 4개 영역 검증
// ─────────────────────────────────────────────────────────────────────────

/**
 * HWPX Blob 4영역 구조 검증
 * @param {Blob} blob
 * @returns {Promise<{pass:boolean, issues:string[]}>}
 */
async function validateHwpx(blob) {
    const issues = [];

    let zip;
    try {
        zip = await JSZip.loadAsync(await blob.arrayBuffer());
    } catch (e) {
        return { pass: false, issues: ['ZIP 로드 실패: ' + e.message] };
    }

    const files = zip.files;
    const names = Object.keys(files);

    // ─ 검증 1: 컨테이너 구조 ─
    if (!names.length || names[0] !== 'mimetype') {
        issues.push('mimetype이 ZIP 첫 항목이 아님 (한글이 손상 파일로 인식)');
    }
    if (files['mimetype']) {
        const mime = await files['mimetype'].async('string');
        if (mime.trim() !== 'application/hwp+zip') {
            issues.push(`mimetype 내용 불일치: "${mime.trim()}"`);
        }
    } else {
        issues.push('mimetype 파일 없음');
    }
    for (const req of ['META-INF/container.xml', 'META-INF/container.rdf', 'META-INF/manifest.xml']) {
        if (!files[req]) issues.push(`필수 메타파일 누락: ${req}`);
    }

    // ─ 검증 2: 필수 콘텐츠 파일 ─
    for (const req of ['Contents/header.xml', 'Contents/section0.xml', 'Preview/PrvText.txt']) {
        if (!files[req]) issues.push(`필수 파일 누락: ${req}`);
    }

    // ─ 검증 3: section0.xml 네임스페이스 + XML 파싱 ─
    if (files['Contents/section0.xml']) {
        const xml = await files['Contents/section0.xml'].async('string');
        if (!xml.includes('hancom.co.kr/hwpml/2011/section')) {
            issues.push('section0.xml에 section 네임스페이스 선언 없음');
        }
        if (!xml.includes('hancom.co.kr/hwpml/2011/paragraph')) {
            issues.push('section0.xml에 paragraph 네임스페이스 선언 없음');
        }
        try {
            const parsed = new DOMParser().parseFromString(xml, 'application/xml');
            const err = parsed.querySelector('parsererror');
            if (err) issues.push('section0.xml XML 파싱 오류: ' + err.textContent.slice(0, 120).trim());
        } catch {
            issues.push('section0.xml XML 파싱 예외');
        }
    }

    // ─ 검증 4: charPrIDRef / paraPrIDRef 참조 무결성 ─
    if (files['Contents/header.xml'] && files['Contents/section0.xml']) {
        const header  = await files['Contents/header.xml'].async('string');
        const section = await files['Contents/section0.xml'].async('string');

        const defChar  = new Set([...header.matchAll(/charPr\s+id="(\d+)"/g)].map(m => m[1]));
        const usedChar = new Set([...section.matchAll(/charPrIDRef="(\d+)"/g)].map(m => m[1]));
        for (const id of usedChar) {
            if (!defChar.has(id)) issues.push(`charPrIDRef="${id}" 미정의 — header.xml 확인`);
        }

        const defPara  = new Set([...header.matchAll(/paraPr\s+id="(\d+)"/g)].map(m => m[1]));
        const usedPara = new Set([...section.matchAll(/paraPrIDRef="(\d+)"/g)].map(m => m[1]));
        for (const id of usedPara) {
            if (!defPara.has(id)) issues.push(`paraPrIDRef="${id}" 미정의 — header.xml 확인`);
        }
    }

    return { pass: issues.length === 0, issues };
}
