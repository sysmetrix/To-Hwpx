# AGENTS.md — To‑Hwpx 작업 지침 (에이전트는 여기부터)

> 이 파일은 저장소의 **단일 작업 지침**이다. 코딩 에이전트 공통 표준(`AGENTS.md`)이라 **Codex·Cursor 등도 그대로 읽고**, Claude Code는 `CLAUDE.md`가 이 파일을 import 한다. git으로 따라다녀 다른 PC·다른 세션·다른 도구에서도 동일.
> 목적: 매번 코드를 다시 탐색하지 않고 **같은 변환 품질**을 바로 재현하는 것. 깊은 내용은 아래 문서로 연결만 하고 여기선 요점만.

## 이 프로젝트가 뭔가

빌드 과정 없는 **정적 브라우저 앱**. 사용자가 올린 파일(MD/DOCX/HTML/TXT/CSV/XLSX/JSON/IPYNB/HWP)을 **IR**로 정규화 → **HWPX(한컴 OWPML)** 로 생성·검증·다운로드. 원본 파일/HWPX의 서버 업로드는 없다. 단, Markdown 원격 이미지는 브라우저가 이미지 원본 서버에 직접 요청할 수 있다. `.hwpx` 업로드 처리는 예외/복구용으로 남겨 두되, 기본 입력 포맷 안내에는 넣지 않는다. **HWPX는 출력 형식**이다.

핵심 파일:
- [js/parsers.js](js/parsers.js) — 입력 → IR(`{title, doc_type, blocks:[...]}`)
- [js/hwpx.js](js/hwpx.js) — IR → HWPX(ZIP+XML). 글자/문단모양, borderFill, 표, 그림, 표지(cover) 생성
- [js/app.js](js/app.js) — UI·옵션·파이프라인·`FORMAT_INFO`·`FONT_DOWNLOADS`
- [index.html](index.html) / [style.css](style.css) — 옵션 UI, 버전 버튼
- [changelog.json](changelog.json) / [sw.js](sw.js) — 버전·캐시
- 개발 상세: [DEV.md](DEV.md) / QA: [qa/release-qa.md](qa/release-qa.md)
- 포맷별 변환 노하우: [hwpx-public-doc/references/format_conversion_playbook.md](hwpx-public-doc/references/format_conversion_playbook.md)

## ⛔ 변환 품질 불변식 (어기면 "열리는데 한글에서 안 보임")

> **황금률: "파일 열림 + XML well‑formed + 게이트 통과" ≠ "한글에서 제대로 보임."**
> 한글은 **모르는 네임스페이스·매칭 안 되는 이름을 조용히 무시**한다. 오류 없이 그 기능만 사라진다.
> 깊은 설명·실제 사례·hwpxlib 대조법: **[hwpx-public-doc/references/hwpx_rendering_gotchas.md](hwpx-public-doc/references/hwpx_rendering_gotchas.md) — 새 비주얼 요소 손대기 전 필독.**

세 가지만 외우면 대부분 막는다:

1. **네임스페이스**: 테두리·borderFill·charPr·paraPr·fontfaces = `hh:`(head). **채우기**(fillBrush/winBrush/gradation/imgBrush)·그림(`hc:img`)·공통 좌표(`hc:pt0`) = `hc:`(core). `hc:`를 쓰면 그 **루트(header·section0)에 `xmlns:hc="http://www.hancom.co.kr/hwpml/2011/core"` 선언 필수.** (`alpha="0"`이 불투명=정상값.)
2. **글꼴 이름 = 한컴이 매칭하는 패밀리명**: 폰트 select의 `value`가 HWPX 글꼴면 이름으로 기록된다. 가변폰트의 무게까지 붙은 풀네임(예: `Pretendard GOV Variable Medium`)은 매칭 실패한다. Pretendard GOV는 UI에 `Pretendard GOV Variable` 하나만 노출하되, 변환 직전 `queryLocalFonts()`의 정확한 family/fullName/PostScript 이름으로 실제 등록명을 판별한다. Variable 설치 PC는 주 이름 `Pretendard GOV Variable`, GOV 설치 PC는 주 이름 `Pretendard GOV`를 기록하고 반대 이름을 `<hh:substFont .../>`로 `hh:typeInfo`보다 먼저 둔다. 감지 불가 시 배포 TTF 내부 이름인 Variable을 기본값으로 쓴다. 대체 글꼴만으로 렌더링하면 글꼴은 적용돼도 한컴 글꼴란이 빈칸이 될 수 있다. (v4.4.10, v4.5.10~11에서 확인.)
3. **그림**: `hc:img@binaryItemIDRef`(문자열 id)는 header가 아니라 **`content.hpf`의 `opf:item id`** 와 매칭. `hp:pic` 구조는 hwpxlib `testFile/reader_writer/SimplePicture.hwpx`를 정답으로 대조.
4. **하이퍼링크**: `hp:fieldBegin type="HYPERLINK"` → 표시 문자열 run → 같은 `id/fieldid`의 `hp:fieldEnd` 순서를 유지한다. URL은 `hp:parameters`의 `Command`와 `Path`에 기록하며 `http:`, `https:`, `mailto:`만 활성화한다. 링크 XML은 hwpxlib와 실제 한컴 생성 HWPX를 대조한다.

**진단 순서(안 보일 때):** ①네임스페이스/요소명·이름 매칭 → ②`xmlns` 선언 → ③IDRef 무결성 → ④속성값(alpha 등은 **마지막**). 추측 금지, **hwpxlib와 대조**(gotchas 2절).

## 검증 (코드로 잡히는 것 vs 사람만 잡는 것)

- 자동: `node qa/gate.js qa/fixtures/md_hwpx_test.md` → 게이트 ①~⑧(mimetype·필수파일·well‑formed·IDRef⊆정의·itemCnt·표 격자·그림 참조·링크 필드 무결성). `npm run test:golden`도 있음.
- **자동은 well‑formed/구조만 본다. 렌더링은 못 본다.** 비주얼(색·음영·그림·표지)은 **반드시 한컴에서 눈으로** 확인 → 사용자에게 "캐시 비우고 `📋 vX.Y.Z` 버전 확인 후 보이나요?"로 요청.
- 회귀 입력·체크리스트: [qa/fixtures/README.md](qa/fixtures/README.md), [qa/release-qa.md](qa/release-qa.md).
- 포맷 파서·HWPX 생성·포맷 안내 문구를 새로 작업할 때는 먼저 [format_conversion_playbook.md](hwpx-public-doc/references/format_conversion_playbook.md)의 해당 포맷 섹션을 읽고, 보존/손실 안내와 테스트를 함께 갱신한다.
- 일반 데이터 표와 코드 블록 표는 다음 본문과 붙지 않도록 `hp:outMargin@bottom="${mmToHwp(3)}"`(실제 XML 값 850, 약 3mm)를 유지한다. 인용구는 표가 아니라 `paraPr id=19`의 `hh:next=850`으로 같은 아래 간격을 적용한다. Markdown/HTML 구분선(`hr`)은 가로 구분선 옵션이 숨김이면 `paraPr id=9` 빈 줄, 표시이면 `buildHrPara()`의 구분선 표로 출력한다. 표지처럼 다른 레이아웃 개체에는 표 여백 값을 일괄 적용하지 않는다.

### 포맷 분리와 공통 IR 계약

- 포맷별 Parser는 원본 문법/파일 구조 해석만 담당한다. 외부·상대 리소스 확보와 포맷별 실패 복구는 해당 포맷 Resolver가 담당한다.
- 공통 IR 정규화 이후 `js/hwpx.js`는 입력 확장자를 알지 못해야 한다. 같은 IR은 MD·HTML·DOCX 등 출처와 무관하게 같은 HWPX 구조를 만든다.
- 공통 `para.runs[]`는 `{text,bold,italic,code,underline,strike,color,href,title}`를 사용한다. `href`가 없으면 기존 run XML과 동일해야 하며, URL 안전성 검사는 출처와 무관하게 공통 적용한다.
- 최종 `image` 블록은 `{type:'image',binName,mimeType,data,widthHwp,heightHwp,alt,title,sourceFormat}`이며 `data` 확보와 MIME/크기 검증을 끝낸 뒤 Renderer로 넘긴다. 미해결 `image-source`는 Renderer에 넘기지 않는다.
- Markdown은 `parseMd()`를 동기로 유지하고, 비동기 data URL/원격 이미지 처리는 `fileToIR()` 뒤 `resolveMarkdownAssets()`에서만 한다. IPYNB Markdown 셀도 `parseMd()`를 재사용하므로 함께 회귀 검사한다.
- 공용 Renderer를 변경하면 전체 golden을 실행한다. Markdown Parser/Resolver만 변경해도 MD와 IPYNB를 함께 검사하고, 그림 패키징을 변경하면 DOCX 그림 게이트까지 반드시 실행한다.
- 목록 항목은 `{text,runs,...}`를 함께 보존해 링크와 인라인 서식을 출력한다. 표 셀은 아직 문자열 중심 IR이므로 표 내부 링크나 이미지를 지원하려면 공용 cell run 계약을 먼저 설계하고 별도 릴리스로 진행한다.

### 기본 미리보기 불변식

기본 IR 미리보기는 실제 HWPX 렌더러가 아니지만, 용지 방향과 내용 흐름을 오해하게 만들면 안 된다.

- A3/A4/B5/Letter 및 세로/가로의 종횡비를 유지한다. 특히 긴 가로 문서도 첫 페이지가 내용 높이에 밀려 세로처럼 늘어나면 안 된다.
- `.ir-page` 안에 `overflow:auto` 같은 별도 스크롤을 만들지 않는다. 미리보기 영역과 종이 내부의 이중 스크롤은 금지한다.
- 용지 높이를 넘는 내용은 숨기거나 자르지 않고 다음 `.ir-page`로 넘긴다. 각 페이지는 `scrollHeight <= clientHeight + 1`을 만족해야 한다.
- 자동 테스트는 단순히 `width > height`만 보지 않는다. 페이지 수, 내부 잘림 여부, 상단의 용지·방향·쪽수 표시를 함께 검사한다.
- 미리보기 CSS/크기/페이지 분할을 변경하면 `tests/golden.js`와 `tests/orientation-e2e.js`를 모두 실행하고 실제 화면 캡처를 확인한다.
- 위 항목 중 하나라도 확인되지 않으면 릴리스 완료로 처리하지 않는다. “테스트 통과”가 사용자 시각 확인을 대체하지 않는다.

## UI·기대치 정렬 불변식

변환 품질만큼 중요한 것은 사용자가 **무엇이 보존되고 무엇이 빠지는지** 미리 알게 하는 것이다. 최근 UX 기준은 아래를 유지한다.

- 첫 화면의 주 행동은 **파일 선택/드롭존**이다. PC/모바일/설치/개인정보 같은 보조 안내 버튼은 드롭존보다 먼저 시선을 빼앗지 않게 둔다.
- 드롭존 문구는 `입력: MD · HTML · TXT · CSV · XLSX · JSON · IPYNB · DOCX · HWP` / `출력: HWPX`처럼 입력과 출력을 분리한다. HWPX를 입력 포맷처럼 쓰지 않는다.
- 지원하지 않는 파일을 넣었을 때는 흐름을 막는 alert보다 **토스트 안내**를 우선한다. 변환 도중 실패는 결과 카드/실패 카드로 다음 행동을 제시한다.
- `문서 제목`은 선택 사항이다. 비워두면 기본값 `heading`(문서 첫 문장/제목)을 쓰고, 사용자가 원하면 `filename`(파일 이름 사용)을 고른다. 초기화 후에도 `heading`을 기본값으로 되돌린다.
- `문서 세부 설정`은 UI 라벨만 바꿔도 변환 기대치가 바뀐다. 문단 간격, 제목 스타일, 표 스타일, 링크 표시, 이미지 폭/정렬, 첫 제목 본문 처리, 가로 구분선, 페이지 여백을 수정할 때는 [format_conversion_playbook.md](hwpx-public-doc/references/format_conversion_playbook.md)의 `문서 세부 설정 옵션 매핑` 표와 `tests/golden.js`의 `validateDetailSettingsUx()`를 함께 갱신한다. 옵션 `value`는 localStorage/HWPX 생성 계약이므로 라벨 변경과 값 변경을 구분한다.
- 포맷 카드와 팝업은 일반론만 쓰지 않는다. [js/app.js](js/app.js)의 `FORMAT_INFO`와 `getConversionSummaryForExt()`는 실제 파서 구현 기준으로 **보존됨 / 제외 가능**을 설명해야 한다. DOCX·JSON처럼 내용은 읽히지만 원본 레이아웃 복제가 아닌 포맷은 보존도를 과장하지 않는다.
- 포맷 카드 클릭은 변환 모드 선택이 아니다. 파일 형식은 업로드한 파일 확장자로 결정된다. 따라서 “이 포맷으로 변환하기” 같은 버튼은 두지 않는다.

## 🛠 관리자 모드 숨김 기능 — "직접 입력"과 실험 기능

완성 전 기능은 지우지 않고 **관리자 모드 뒤에 숨겨** 개발자만 쓴다. 현재 대상은 **직접 입력(텍스트 붙여넣기 → HWPX)** 이며, 품질 검증이 끝나더라도 사용자가 공개를 결정하기 전에는 일반 사용자 동선에 노출하지 않는다.

- **켜는 법**: 주소 끝에 `?admin=1`을 붙여 한 번 접속한다 → `localStorage['tohwpx_admin']='1'`로 저장돼 그 브라우저에서 계속 유지된다. 기존 링크 호환을 위해 `?lab=1`도 같은 관리자 모드를 켠다. `?admin=0` 또는 `?lab=0`은 관리자 모드와 토글 자격을 모두 지우는 완전 해제다.
- **업데이트 내역**: 상단 `📋 vX.Y.Z` 버튼은 일반 모드에서 버전 표시만 하고, 관리자 모드에서만 업데이트 내역 창을 연다. 개발자 변경사항 탭에는 관리자 모드 토글과 추천 실험 기능 후보를 둔다.
- 지원 형식은 MD, HTML 소스, TXT, CSV/탭 구분 표, JSON이다. 바이너리 형식(DOCX/XLSX/HWP)은 파일 업로드만 사용한다.
- 직접 입력의 입력 형식 선택은 버튼 UI로 제공하되 내부 값은 `#paste-format`과 `tohwpx_pasteFormat` 저장값을 유지한다.
- 붙여넣은 문자열은 가상 `File`로 감싸 기존 `fileToIR()` 변환 파이프라인을 그대로 재사용한다.
- HTML은 태그 없는 일반 텍스트도 문단으로 보존하고, CSV는 쉼표 CSV와 Excel·Google Sheets의 탭 구분 표(TSV)를 자동 판별한다.
- `tests/golden.js`에서 관리자 모드 게이트, 기존 `?lab=1` 호환, MD/HTML/TXT/CSV/JSON 파일 입력과 직접 입력의 HWPX 본문·표·링크·그림 개수 동등성을 검사한다.
- **주의**: 공개 정적 사이트라 관리자 모드는 보안이 아니라 가림이다. 진짜 비공개가 필요하면 main에 올리지 않는다.
- **정합성**: 관리자 모드 전용 실험 기능은 `changelog.json`의 사용자 항목에 공개 기능처럼 공지하지 않는다. 정식 공개는 사용자의 명시적 결정이 있을 때만 user 항목·UI·안내 문구를 함께 변경한다.

## 지속 개발 메모 규칙

새 변환 품질 이슈를 해결했거나 포맷별 처리 노하우가 생기면 코드만 고치고 끝내지 않는다.

- 파서/HWPX 생성/포맷 안내/테스트 기준이 바뀌면 [format_conversion_playbook.md](hwpx-public-doc/references/format_conversion_playbook.md)의 해당 포맷 섹션을 함께 갱신한다.
- 한컴 렌더링에서 조용히 사라지는 문제(namespace, IDRef, 글꼴명, 그림, borderFill, fillBrush 등)를 새로 확인하면 [hwpx_rendering_gotchas.md](hwpx-public-doc/references/hwpx_rendering_gotchas.md)에 원인·증상·정답 구조를 남긴다.
- 새 fixture나 회귀 테스트를 추가하면 플레이북의 `검증` 항목과 [qa/release-qa.md](qa/release-qa.md) 중 관련 위치를 갱신한다.
- 사용자에게 보이는 품질 기대치가 달라졌다면 `FORMAT_INFO`, `getConversionSummaryForExt()`, 결과 카드 문구, `changelog.json` 사용자 항목이 서로 같은 말을 하게 맞춘다.
- 문서 업데이트가 코드 변경과 같은 커밋에 들어가도 된다. 단, 원인/결정/검증 기준을 다음 에이전트가 재현할 수 있을 만큼 구체적으로 적는다.

## 릴리스 절차 (사용자 기대 — 변경 1건 = 1릴리스)

1. 코드 수정.
2. **버전 범프**: `node qa/bump-version.js --write` → package/lock/sw(`CACHE_VERSION`)/index(버전 버튼) 자동 갱신. **단 [changelog.json](changelog.json)은 수동**: `current`를 새 버전으로 바꾸고 `versions[]` 맨 앞에 `{version,date,user[],dev[]}` 항목 추가. (날짜 같으면 patch+1, 다르면 minor+1.0 규칙.) 릴리스 전 `package.json`/`package-lock.json`/`sw.js`/`index.html` 버튼/[changelog.json](changelog.json) `current`가 같은 버전인지 확인한다.
3. 브랜치 → 커밋 → 푸시.
4. **PR 생성·머지는 `gh`를 기본 사용**한다. 명령이 짧고 결과가 같으므로 `gh pr create` / `gh pr merge`로 처리한다. 단, `gh` 미설치·미인증, 필요한 기능 미지원, 반복되는 병합 오류처럼 `gh`로 완료하기 어려울 때만 **GitHub API를 대체 경로**로 사용한다(토큰은 `git credential fill`). API 사용 시 `/tmp`는 node(Windows)와 curl이 다르게 해석하니 **JSON은 stdin 파이프**(`node -e '...JSON.stringify...' | curl ... -d @-`)로 넘긴다. 머지 405("Base branch was modified")는 재시도.
5. main 동기화 → 브랜치 정리.
6. 사용자에게 버전 번호 알리고 한컴 시각 확인 요청.

## 다른 환경(claude.ai 등)용 포터블 스킬

[hwpx-public-doc/SKILL.md](hwpx-public-doc/SKILL.md) — Python 기반 별도 스킬(베이스 템플릿 + section0.xml만 동적 생성). 이 JS 앱과 별개로 자립 동작. 참조 스키마: [references/ir_schema.md](hwpx-public-doc/references/ir_schema.md), [references/hwpx_structure.md](hwpx-public-doc/references/hwpx_structure.md).

## 톤·작업 방식

- 사용자는 한국어로 소통, 코드를 깊게 안 봐도 되게 **증상 + 열림 여부**로 지시. 변경마다 직접 한컴에서 확인 후 다음 지시.
- "hwpxlib 기준으로 맞춰서"라고 하면 추측 말고 호환 라이브러리와 대조.
- 토큰 절약: 위 문서들에 이미 있는 내용은 다시 파헤치지 말고 **링크로 가서 필요한 부분만** 읽는다.
