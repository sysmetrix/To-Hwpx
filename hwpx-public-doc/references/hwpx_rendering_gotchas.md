# HWPX 렌더링 함정 체크리스트 (꼭 읽기)

> **핵심 교훈: "파일이 열린다 + XML이 well-formed + 게이트 통과" ≠ "한글에서 제대로 보인다."**
> 한글(한컴오피스)은 **모르는 네임스페이스의 요소를 조용히 무시**한다. 오류도 없고 파일도 열리지만, 그 기능만 화면에 안 나온다. 이 때문에 디버깅이 매우 어렵다.

---

## 1. 가장 자주 막히는 것 — 네임스페이스(prefix) 불일치

OWPML은 요소마다 소속 네임스페이스가 정해져 있다. **prefix를 틀리면 한글이 그 요소를 버린다.**

| 네임스페이스 | URI | 대표 요소 |
|---|---|---|
| `hh` (head) | `http://www.hancom.co.kr/hwpml/2011/head` | `hh:head`, `hh:borderFill`, **테두리** `hh:leftBorder`/`rightBorder`/`topBorder`/`bottomBorder`/`diagonal`/`slash`, `hh:charPr`, `hh:paraPr`, `hh:fontfaces` |
| `hc` (core) | `http://www.hancom.co.kr/hwpml/2011/core` | **채우기** `hc:fillBrush`, `hc:winBrush`, `hc:gradation`, `hc:imgBrush` (그리고 공통 color 등) |
| `hp` (paragraph) | `http://www.hancom.co.kr/hwpml/2011/paragraph` | `hp:p`, `hp:run`, `hp:t`, `hp:tbl`, `hp:tc`, `hp:secPr` |
| `hs` (section) | `http://www.hancom.co.kr/hwpml/2011/section` | `hs:sec` |

### 실제로 우리를 오래 막았던 사례 (v4.3.33에서 해결)
- **증상:** 표 머리글 음영·코드블록 배경·DOCX 셀 배경색이 한글에서 **안 보임**. 파일은 정상으로 열림.
- **원인:** `borderFill` 안의 채우기를 `hh:fillBrush`/`hh:winBrush`로 출력. 표준은 **`hc:fillBrush`/`hc:winBrush`**. 테두리(`hh:`)는 맞아서 보였지만 채우기만 무시됨.
- **헛다리:** `alpha="0"` vs `"255"`(투명도), 서비스워커 캐시 — 모두 원인이 아니었음.
- **해결:** header 루트에 `xmlns:hc="http://www.hancom.co.kr/hwpml/2011/core"` 선언 + 채우기를 `hc:`로. `alpha="0"`이 불투명(정상값).

```xml
<!-- 올바른 표 셀 음영/배경 -->
<hh:borderFill id="3" ...>
  <hh:leftBorder type="SOLID" .../>   <!-- 테두리는 hh: -->
  ...
  <hc:fillBrush><hc:winBrush faceColor="#D9D9D9" hatchColor="#000000" alpha="0"/></hc:fillBrush>  <!-- 채우기는 hc: -->
</hh:borderFill>
```

### 이미지(그림)도 같은 함정 — v4.3.45에서 해결

- **증상:** 이미지가 든 DOCX를 변환하면 HWPX가 한글에서 **오류 창이 뜨고 안 열림**.
- **원인 3가지:**
  1. `hp:pic` 구조가 비표준(`hp:instd`·`hp:picEffect` 등)이었음. 정식 구조는 `hp:offset/orgSz/curSz/flip/rotationInfo/renderingInfo(hc:transMatrix…)/imgRect(hc:pt0…)/imgClip/inMargin/imgDim/hc:img/sz/pos`.
  2. 그림 바이너리 참조는 **`<hc:img binaryItemIDRef="image1">`(문자열 id)** 이고, 그 id는 **`content.hpf`의 `<opf:item id="image1" href="BinData/image1.jpg" media-type="image/jpg" isEmbeded="1"/>`** 와 매칭된다. header의 `hh:binDataList`가 아니다(제거함).
  3. `hc:img`·`hc:pt0` 등 hc: 요소를 쓰므로 **section0 루트에 `xmlns:hc` 선언 필요**.
- **확인처:** hwpxlib `testFile/reader_writer/SimplePicture.hwpx` (실제 한컴 그림 HWPX 샘플) — GitHub API로 받아 `Contents/section0.xml`의 `hp:pic`, `content.hpf`를 그대로 대조.

### 하이퍼링크도 필드 시작/끝이 맞지 않으면 조용히 일반 글자가 된다

- **증상:** 링크 글자는 파란색·밑줄로 보이고 파일도 열리지만 한컴에서 클릭되지 않음.
- **원인:** 표시 run에 URL 속성만 임의로 붙이거나 `hp:fieldBegin`만 만들고 짝이 되는 `hp:fieldEnd`의 `beginIDRef/fieldid`를 맞추지 않음.
- **정답 구조:** `hp:run/hp:ctrl/hp:fieldBegin type="HYPERLINK"` → 링크 표시 `hp:run/hp:t` → `hp:run/hp:ctrl/hp:fieldEnd`. begin의 `id/fieldid`와 end의 `beginIDRef/fieldid`가 각각 같아야 한다.
- `fieldBegin`의 `hp:parameters`에는 `Prop`, `Command`, `Path`, `Category=HWPHYPERLINK_TYPE_URL`, `TargetType`, `DocOpenType`을 기록한다. URL의 `&`는 XML에서 `&amp;`로 escape한다.
- URL 안전성은 XML 생성 전에 검사한다. 현재 활성 프로토콜은 `http:`, `https:`, `mailto:`이고 나머지는 일반 텍스트로 내린다.
- **확인처:** hwpxlib `testFile/error/20240919/테스트문서.hwpx`의 HYPERLINK 필드와 `FieldBeginWriter`/`CtrlWriter`.
- **검증:** `qa/gate.js` ⑧이 begin/end 쌍과 안전한 Path를 검사한다. 자동 구조 검증 후에도 실제 한컴에서 Ctrl+클릭/링크 열기를 확인해야 한다.

### 글꼴(폰트)도 "조용히 무시"의 한 종류 — v4.4.10에서 해결

- **증상:** 특정 글꼴(Pretendard)만 선택해도 한글에서 **적용이 안 됨**. 다른 글꼴은 정상, 파일도 정상 열림.
- **원인:** 폰트 select의 `value`가 HWPX 글꼴면(fontface) 이름으로 **그대로 박힌다**. 값이 `Pretendard GOV Variable Medium`(가변폰트 풀네임)이라 한컴/Windows에 설치된 실제 패밀리명 `Pretendard GOV`와 **매칭 실패** → 글꼴만 조용히 무시됨.
- **1차 해결과 실기기 결과(v4.5.10):** UI에는 실제 가변 TTF 내부 패밀리명인 `Pretendard GOV Variable` 하나만 제공하고, 주 이름 Variable 아래에 `<hh:substFont face="Pretendard GOV" .../>`를 기록했다. Variable 설치 PC는 글꼴 적용과 한컴 글꼴란이 모두 정상. GOV 설치 PC는 대체 글꼴로 화면 렌더링은 됐지만 한컴 글꼴란이 빈칸이었다. 즉 `substFont`는 누락 글꼴의 렌더링 대체이지 선택 글꼴 메타데이터 치환이 아니다.
- **최종 해결(v4.5.11):** 변환 직전 [js/app.js](../../js/app.js)가 `queryLocalFonts()`의 정확한 family/fullName/PostScript 이름으로 실제 등록명을 판별한다. Variable 설치 시 주 이름 Variable + 대체 GOV, GOV 설치 시 주 이름 GOV + 대체 Variable로 기록한다. 권한 거부·API 미지원·미설치로 판별할 수 없으면 배포 TTF 내부 이름인 Variable을 기본값으로 쓴다. `hh:substFont`는 반드시 `hh:typeInfo`보다 앞에 둔다.
- **교훈:** 네임스페이스뿐 아니라 **"이름 매칭"이 틀려도 동일하게 조용히 무시**된다. 글꼴이 안 먹으면 흐름을 의심하기 전에 **value가 실제 설치 패밀리명인지** 먼저 본다.

### 새 borderFill/paraPr을 추가할 때 ID 충돌도 조용히 망가진다 — v4.4.20 인용구

- **증상:** Markdown 인용구(`>`)가 HWPX에서 인용 모양이 아니라 `▶`로 시작하는 일반 목록처럼 보임.
- **원인:** 파서는 `quote` IR을 만들었지만 HWPX 출력에서 `▶ ` 텍스트를 붙인 일반 문단으로 내려보냈다. 인용 전용 `paraPr`/`borderFill`이 없었다.
- **해결:** `header.xml`에 `hh:paraPr id="19"`와 `hh:borderFill id="19"`를 추가하고, `section0.xml`의 인용 문단을 `paraPrIDRef="19"`로 출력한다. 인용 배경 채우기는 `hc:fillBrush`/`hc:winBrush`를 쓴다.
- **주의:** 새 고정 borderFill을 추가하면 DOCX 셀 배경색 같은 동적 borderFill 시작 번호도 함께 밀어야 한다. 이번 인용구 추가 후 동적 borderFill은 20번부터 시작한다.
- **검증:** `tests/fixtures/sample.md`에 인용구 fixture를 두고, `tests/golden.js`에서 `paraPrIDRef="19"` 존재와 `▶ Quoted Alpha line` 부재를 함께 확인한다.

### 긴 표가 쪽 경계에서 잘리는 경우 — 여러 쪽 지원·개체 배치 값을 함께 본다

- **증상:** 행이 많은 표가 다음 쪽으로 이어지지 않거나, 다음 쪽에서 제목 줄이 반복되지 않는다. 파일은 정상으로 열린다.
- **원인:** 일반 표가 `pageBreak="ROW"`처럼 OWPML에 없는 값을 쓰거나 `treatAsChar="1"`로 글자처럼 취급되어, 한컴의 여러 쪽 표 동작이 적용되지 않는다.
- **정답 구조:** 일반 데이터 표는 `pageBreak="TABLE"`(나눔), `repeatHeader="1"`, `hp:pos@treatAsChar="0"`, `flowWithText="1"`을 사용한다. 첫 행의 실제 `hp:tc`에는 모두 `header="1"`이 필요하다.
- **배치:** `horzRelTo="COLUMN"` + `horzAlign="RIGHT"`는 표의 가로 배치 기준만 정한다. 현재처럼 표 너비가 단 전체 폭이면 화면상 차이가 없으며 행 높이·열 너비·병합 계산에는 영향을 주지 않는다.
- **블록 뒤 간격:** 일반 데이터 표와 코드 블록 표의 `hp:outMargin@bottom`은 `mmToHwp(3)`(850 HWPUNIT, 약 3mm)로 둔다. 인용구는 표가 아니므로 `paraPr id=19`의 `hh:next=850`으로 같은 간격을 둔다. 이는 개체/문단과 다음 본문 사이의 간격이며 셀 내부 `hp:cellMargin`이 아니다. 페이지 끝에서는 이 공간 때문에 다음 블록이 다음 쪽으로 이동할 수 있으며 정상이다.
- **구분선:** 구분선 표는 `hp:outMargin@top/bottom=850`으로 위아래 간격을 만들고, 앞뒤에 별도 `buildBlankPara()`를 붙이거나 IR의 인접 `blank`를 출력하지 않는다. 엔터로 간격을 흉내 내면 편집 시 빈 문단이 남는다.
- **제외:** 표지처럼 별도 배치 의도가 있는 레이아웃 개체에는 일반 데이터 표 설정을 일괄 적용하지 않는다.
- **검증:** `tests/fixtures/sample.csv`, `tests/fixtures/long-table.csv`, `tests/golden.js`로 아래쪽 바깥 여백과 여러 쪽 속성을 검사한다. 한컴에서 짧은 표 뒤 간격, 두 쪽 이상 나눔, 매 쪽 첫 줄의 제목 행 반복을 눈으로 확인한다.

### 가로 용지에서 enum과 폭·높이를 함께 뒤집으면 이중 회전된다 — v4.5.7

- **증상:** 한컴 페이지는 세로로 남는데 표만 가로 폭으로 계산되어 페이지 밖으로 나간다. 기본 미리보기는 내용 높이에 밀려 가로 비율이 세로처럼 늘어난다.
- **원인:** 가로에서 `landscape="NARROWLY"`와 `width > height`를 동시에 적용하거나, 반대로 `WIDELY`에서 폭·높이만 뒤집는 비표준 조합을 사용했다. 내부 검증기도 회전 전 width만 본문 폭으로 사용했다.
- **정답:** `pagePr`에는 모든 용지의 회전 전 기본 치수(`width < height`)를 둔다. 세로는 `WIDELY`, 가로는 `NARROWLY`; 가로 본문 폭은 기본 `height - 좌우 여백`으로 계산·검증한다.
- **미리보기:** A3 가로를 100%로 두고 실제 mm 폭 비율로 용지 크기를 축소한다. 페이지에는 `overflow:auto`를 적용해 내용이 `aspect-ratio`를 밀어내지 못하게 한다.
- **검증:** `tests/golden.js`가 A3/A4/B5/Letter × 세로/가로 8조합의 enum, 기본 치수, 유효 본문 폭, 미리보기 실제 비율·상대 크기를 검사한다. `tests/orientation-e2e.js`는 라이브 클릭→변환→미리보기→다운로드 XML을 한 흐름으로 진단한다.

### DOCX의 흰 글자가 배경 없이 그대로 옮겨져 안 보이는 경우 — v4.16.1에서 방어 처리

이건 HWPX 네임스페이스 문제가 아니라 **DOCX 파싱 단계**의 함정이다. 한컴은 `textColor="#FFFFFF"`를 정확히 그린다 — 문제는 그 흰 글자 뒤에 어두운 배경이 없어서 흰 바탕에 흰 글자가 되는 것.

- **증상:** DOCX에서 색 있는 글자(특히 표 셀의 흰 굵은 글자 배지)가 변환 후 육안으로 안 보임. XML은 well-formed이고 게이트도 통과함.
- **원인 두 가지:**
  1. `js/parsers.js`의 표 셀 배경 감지 정규식이 `auto|FFFFFF|000000`을 모두 "배경 없음"으로 걸렀음 — **순검정(`000000`)은 실제로 자주 쓰이는 배지 배경색**인데 배경 없음으로 오판해 셀 배경 자체가 사라졌다.
  2. 표 스타일(`w:tblStylePr`) 조건부 서식으로 셀 음영을 주는 DOCX는 직접 `w:tcPr/w:shd`가 없어 여전히 배경을 못 찾는다 — 이 경우는 아직 미지원.
- **방어책 (완전한 원인 해결이 아니라 안전망):** `js/parsers.js`의 `stripInvisibleWhiteRuns()`가 배경을 못 찾은 셀·표 밖 문단에서 강조 표시(`w:highlight`) 없는 흰 글자만 기본색(검정)으로 되돌린다. 배경이 있거나 강조 표시가 있는 흰 글자는 그대로 보존된다.
- **한계:** 표 스타일 기반 조건부 셀 음영을 직접 지원하지 않으므로, 그런 셀은 배경 없이 검정 글자로 나온다(안 보이는 것보다는 낫지만 원본 배지 모양은 아님). 표 스타일 음영까지 완전히 재현하려면 `styles.xml`의 `w:tblStylePr`(`firstRow`/`band1Horz` 등)을 조건에 맞춰 파싱해야 한다 — 아직 별도 작업으로 남아 있음.
- **v4.16.2 추가 발견(실제 사용자 원본으로 재현):** "착수"·"승인" 같은 **문단 안 일부 글자만** 색 배지로 꾸민 경우는 셀 배경이 아니라 **run 속성(`w:rPr/w:shd@w:fill`)**을 쓴다 — `<w:rPr><w:color w:val="FFFFFF"/><w:shd w:val="clear" w:color="auto" w:fill="D97706"/></w:rPr>` 형태. 이전엔 `w:highlight`(고정 형광펜 이름)만 읽고 이 임의 RRGGBB `w:shd`는 완전히 무시해, 흰 글자만 배경 없이 그대로 남았다. `docxRunHighlight()`가 이제 `w:shd@w:fill`도 shadeColor 후보로 읽는다(`js/parsers.js`). HWPX 쪽 `shadeColor`(`hh:charPr`) 배관은 이미 있었으므로 파싱 쪽만 고치면 됐다 — 파일이 아무리 커도(51쪽·수백 개 표 행) 원인은 결국 특정 요소를 못 읽은 파싱 버그였다.

---

## 2. 정답 확인처 — 추측하지 말고 한컴 호환 라이브러리와 대조

XML 구조/네임스페이스/요소명/속성명이 의심되면 **추측하지 말고** 한컴 호환 오픈소스로 검증한다.

- **neolord0/hwpxlib** (Java, 한컴 호환 HWPX 읽기/쓰기): https://github.com/neolord0/hwpxlib
  - `writer/.../*Writer.java`의 `ElementNames.hh_*` / `hc_*` / `hp_*` 상수가 **요소의 실제 네임스페이스**다.
  - 예: `BorderFillWriter`는 테두리에 `ElementNames.hh_leftBorder`, 채우기에 `ElementNames.hc_fillBrush`를 쓴다.
  - 네임스페이스 URI: `commonstrings/Namespaces.java` (`hc=.../core`, `hh=.../head` 등).
- **hancom-io/hwpx-owpml-model** (한컴 공식 모델): https://github.com/hancom-io/hwpx-owpml-model
- **airmang/python-hwpx** (Python, 공식 OWPML XSD로 검증): https://github.com/airmang/python-hwpx
  - `docs/owpml-deviations.md`에서 "공식 OWPML 2024 스키마"와 "한컴 실동작(2011 본체 + 2016 확장 네임스페이스)"이 다르다는 것을 자체 확인하고, **스키마 위반을 하드 에러가 아니라 lint 경고로만 취급**한다(`src/hwpx/tools/validator.py`). 이 저장소가 2011/hh·hc 네임스페이스를 정답으로 삼는 것과 같은 결론 — "공식 스펙보다 호환 구현체를 믿는다"는 원칙의 독립적 교차검증.

GitHub API로 빠르게 파일 내용 확인(토큰은 git credential에서):
```
curl -s -H "Authorization: Bearer $TOKEN" \
  "https://api.github.com/repos/neolord0/hwpxlib/contents/<경로>?ref=main" \
  | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(Buffer.from(JSON.parse(d).content,'base64').toString()))"
```

---

## 2-1. refList 항목은 **id 오름차순으로 써야 한다** (v4.16.8 실측)

**증상**: DOCX 콜아웃(문단 배경) 상자가 한글에서 엉뚱한 파란 배경으로 렌더 — 지정한 `#FFFAF0`이 아니라 **다른 borderFill의 색**이 나왔다. 사용자가 새 파일명으로 재변환해도 동일 재현(캐시 아님).

**그런데 XML은 전부 정확했다**: well-formed, id 중복 없음, `itemCnt` 일치, `paraPrIDRef=21` → `borderFillIDRef=33` → `faceColor="#FFFAF0"`까지 값이 다 맞고 **자동 게이트 ①~⑨ 전부 통과**.

**진짜 원인**: `<hh:borderFills>` 안의 **등장 순서**가 id 순서와 어긋났다.
`buildHeaderXml()`이 표 셀 배경(`customBfMap`)과 문단 배경(`customQuoteMap`)을 **Map별로 통째로 이어 붙여** 출력했는데, 두 Map은 같은 id 카운터를 공유하면서 문서 순서대로 번호를 받는다. 그 결과 파일에는 `...31, 34, 35, ..., 41, 32, 33` 순으로 실렸다(32·33이 콜아웃).

```
한글은 borderFill을 id 속성이 아니라 "등장 위치"로 찾는 것처럼 동작한다.
→ refList(borderFills·charProperties·paraProperties)는 반드시 id 오름차순으로 출력할 것.
```

**고친 법**: 두 Map의 항목을 한 배열로 모아 `sort((a,b) => a.id - b.id)` 후 단일 블록으로 출력.

**교훈**: 동적 id를 여러 Map/여러 출처에서 같은 카운터로 뽑는다면, **출력 시점에 반드시 다시 정렬**한다. 그리고 이 부류는 구조 게이트로 절대 안 잡힌다 — "게이트 통과 = 정상"이라는 추론 자체가 틀렸음을 보여주는 사례다.

---

## 3. "열림 ≠ 보임" 자가 진단 순서

한글에서 어떤 요소가 **안 보일 때**:
1. 그 요소가 **올바른 네임스페이스**인가? (1번 표 + hwpxlib 대조) ← **가장 먼저 의심**
2. 루트에 해당 **xmlns:** 선언이 있는가? (없으면 prefix가 무효)
3. 참조(IDRef)가 header 정의와 일치하는가? (게이트 ④)
3-1. refList 안의 **등장 순서가 id 오름차순인가?** (2-1절 — 값이 다 맞는데 다른 요소의 서식이 나올 때)
4. 속성값(색/alpha/타입)이 유효 범위인가? ← **여기는 마지막에 의심** (네임스페이스부터 확인)
5. 서비스워커 캐시? → 페이지의 `📋 vX.Y.Z 업데이트 내역` 버튼 버전으로 현재 로드된 빌드 확인, 강력 새로고침.

> 노드 하니스(`@xmldom/xmldom`+`jszip`)는 well-formed/게이트는 잡지만 **렌더링은 못 본다.** 시각 확인은 한컴에서만 가능 → 사용자에게 "버전 버튼 확인 후 보이나요?"로 검증 요청.

---

## 3-1. 역방향 엔진(@rhwp/core)의 "조용한 성공" 함정 (v4.16.13 실측)

역방향 내보내기(HWPX → HWP)를 붙이면서 만난 것들. 생성 경로와는 다른 계통이지만 **증상 모양은 같다 — 오류 없이 기능만 사라진다.**

### ① `contentLoss()`가 0이어도 손실이 없다는 뜻이 아니다

엔진의 자기 보고는 **엔진이 아는 손실만** 센다. 개발 중 그림이 든 문서에서 HWP 산출물이 빈 문서와 같은 크기(6656B)로 나오는데 `contentLoss`는 `{"count":0,"losses":[]}`를 보고했다.

결론적으로 그림은 실제로 보존돼 있었고 크기 차이는 CFB/ZIP 압축 효율 차이였지만, **그 판정을 손실 보고서로는 내릴 수 없었다.** 진위를 가른 것은 렌더 비교였다.

```
HWPX 원본 : pages=1  <image>=1  <text>=27
HWP 변환본: pages=1  <image>=1  <text>=27   ← 보존 확정
```

→ **판정은 항상 렌더된 SVG의 요소 개수로 한다.** 바이트 크기 비교와 엔진 자기 보고는 근거가 아니다. `qa/reverse-export-gate.js`의 ⑤가 이 검사다.

### ② `getSourceImageBytes(i)`로 그림 존재를 확인하면 안 된다

인덱스가 맞지 않을 때 예외가 아니라 `memory access out of bounds`로 WASM이 죽는다. 그림이 멀쩡히 있어도 "0개"로 보인다. 위의 오진이 바로 이것 때문이었다.

### ③ `HwpViewer`는 `HwpDocument`의 소유권을 가져간다

```js
const doc = new mod.HwpDocument(bytes);
const viewer = new mod.HwpViewer(doc);   // ← doc 소유권 이전
// ...
viewer.free();
doc.free();   // ✗ 이중 해제 → "null pointer passed to rust"로 프로세스 사망
```

뷰어를 만들었으면 **뷰어만** 해제한다. 뷰어 생성이 실패한 경우에만 `doc.free()`를 부른다.

### ④ `exportHml()`은 HML 원본에서만 동작한다

HWPX 출처 문서에는 `[HML_SOURCE_REQUIRED]`로 거부된다. UI에 형식 선택지로 노출하지 않는다.

## 4. 사용자(지시자)용 — 이렇게 지시하면 빠르다

- 한글에서 무언가 **안 보이거나 깨지면**, "**파일은 열리는데 한글에서 ○○(음영/배경/그림/표)가 안 보임**"처럼 **증상 + 열림 여부**를 함께 알려주세요. → 네임스페이스/요소 점검으로 바로 들어갑니다.
- 새 비주얼 요소(채우기/그라데이션/그림/도형)를 추가해달라고 할 때는 "**hwpxlib 기준으로 맞춰서**"라고만 해도 됩니다. → 추측 대신 호환 라이브러리와 대조해 구현합니다.
- 버전 확인이 필요하면 페이지 우상단 `📋 vX.Y.Z 업데이트 내역` 버튼 숫자를 알려주세요(현재 로드된 빌드 = 캐시 여부 판별).
