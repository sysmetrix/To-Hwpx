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

### 글꼴(폰트)도 "조용히 무시"의 한 종류 — v4.4.10에서 해결

- **증상:** 특정 글꼴(Pretendard)만 선택해도 한글에서 **적용이 안 됨**. 다른 글꼴은 정상, 파일도 정상 열림.
- **원인:** 폰트 select의 `value`가 HWPX 글꼴면(fontface) 이름으로 **그대로 박힌다**. 값이 `Pretendard GOV Variable Medium`(가변폰트 풀네임)이라 한컴/Windows에 설치된 실제 패밀리명 `Pretendard GOV`와 **매칭 실패** → 글꼴만 조용히 무시됨.
- **해결:** [index.html](../../index.html) 폰트 옵션 `value`를 **한컴이 매칭하는 패밀리명**으로. 반드시 [js/app.js](../../js/app.js) `FONT_DOWNLOADS`의 `systemNames`(예: `Pretendard GOV`, `Pretendard`)와 일치시킨다. KoPub처럼 무게를 포함한 이름이 맞는 경우도 있으니(`KoPub돋움체 Medium`) **설치된 등록명 기준**으로 정한다.
- **교훈:** 네임스페이스뿐 아니라 **"이름 매칭"이 틀려도 동일하게 조용히 무시**된다. 글꼴이 안 먹으면 흐름을 의심하기 전에 **value가 실제 설치 패밀리명인지** 먼저 본다.

### 새 borderFill/paraPr을 추가할 때 ID 충돌도 조용히 망가진다 — v4.4.20 인용구

- **증상:** Markdown 인용구(`>`)가 HWPX에서 인용 모양이 아니라 `▶`로 시작하는 일반 목록처럼 보임.
- **원인:** 파서는 `quote` IR을 만들었지만 HWPX 출력에서 `▶ ` 텍스트를 붙인 일반 문단으로 내려보냈다. 인용 전용 `paraPr`/`borderFill`이 없었다.
- **해결:** `header.xml`에 `hh:paraPr id="19"`와 `hh:borderFill id="19"`를 추가하고, `section0.xml`의 인용 문단을 `paraPrIDRef="19"`로 출력한다. 인용 배경 채우기는 `hc:fillBrush`/`hc:winBrush`를 쓴다.
- **주의:** 새 고정 borderFill을 추가하면 DOCX 셀 배경색 같은 동적 borderFill 시작 번호도 함께 밀어야 한다. 이번 인용구 추가 후 동적 borderFill은 20번부터 시작한다.
- **검증:** `tests/fixtures/sample.md`에 인용구 fixture를 두고, `tests/golden.js`에서 `paraPrIDRef="19"` 존재와 `▶ Quoted Alpha line` 부재를 함께 확인한다.

---

## 2. 정답 확인처 — 추측하지 말고 한컴 호환 라이브러리와 대조

XML 구조/네임스페이스/요소명/속성명이 의심되면 **추측하지 말고** 한컴 호환 오픈소스로 검증한다.

- **neolord0/hwpxlib** (Java, 한컴 호환 HWPX 읽기/쓰기): https://github.com/neolord0/hwpxlib
  - `writer/.../*Writer.java`의 `ElementNames.hh_*` / `hc_*` / `hp_*` 상수가 **요소의 실제 네임스페이스**다.
  - 예: `BorderFillWriter`는 테두리에 `ElementNames.hh_leftBorder`, 채우기에 `ElementNames.hc_fillBrush`를 쓴다.
  - 네임스페이스 URI: `commonstrings/Namespaces.java` (`hc=.../core`, `hh=.../head` 등).
- **hancom-io/hwpx-owpml-model** (한컴 공식 모델): https://github.com/hancom-io/hwpx-owpml-model

GitHub API로 빠르게 파일 내용 확인(토큰은 git credential에서):
```
curl -s -H "Authorization: Bearer $TOKEN" \
  "https://api.github.com/repos/neolord0/hwpxlib/contents/<경로>?ref=main" \
  | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(Buffer.from(JSON.parse(d).content,'base64').toString()))"
```

---

## 3. "열림 ≠ 보임" 자가 진단 순서

한글에서 어떤 요소가 **안 보일 때**:
1. 그 요소가 **올바른 네임스페이스**인가? (1번 표 + hwpxlib 대조) ← **가장 먼저 의심**
2. 루트에 해당 **xmlns:** 선언이 있는가? (없으면 prefix가 무효)
3. 참조(IDRef)가 header 정의와 일치하는가? (게이트 ④)
4. 속성값(색/alpha/타입)이 유효 범위인가? ← **여기는 마지막에 의심** (네임스페이스부터 확인)
5. 서비스워커 캐시? → 페이지의 `📋 vX.Y.Z 업데이트 내역` 버튼 버전으로 현재 로드된 빌드 확인, 강력 새로고침.

> 노드 하니스(`@xmldom/xmldom`+`jszip`)는 well-formed/게이트는 잡지만 **렌더링은 못 본다.** 시각 확인은 한컴에서만 가능 → 사용자에게 "버전 버튼 확인 후 보이나요?"로 검증 요청.

---

## 4. 사용자(지시자)용 — 이렇게 지시하면 빠르다

- 한글에서 무언가 **안 보이거나 깨지면**, "**파일은 열리는데 한글에서 ○○(음영/배경/그림/표)가 안 보임**"처럼 **증상 + 열림 여부**를 함께 알려주세요. → 네임스페이스/요소 점검으로 바로 들어갑니다.
- 새 비주얼 요소(채우기/그라데이션/그림/도형)를 추가해달라고 할 때는 "**hwpxlib 기준으로 맞춰서**"라고만 해도 됩니다. → 추측 대신 호환 라이브러리와 대조해 구현합니다.
- 버전 확인이 필요하면 페이지 우상단 `📋 vX.Y.Z 업데이트 내역` 버튼 숫자를 알려주세요(현재 로드된 빌드 = 캐시 여부 판별).
