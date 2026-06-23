# AGENTS.md — To‑Hwpx 작업 지침 (에이전트는 여기부터)

> 이 파일은 저장소의 **단일 작업 지침**이다. 코딩 에이전트 공통 표준(`AGENTS.md`)이라 **Codex·Cursor 등도 그대로 읽고**, Claude Code는 `CLAUDE.md`가 이 파일을 import 한다. git으로 따라다녀 다른 PC·다른 세션·다른 도구에서도 동일.
> 목적: 매번 코드를 다시 탐색하지 않고 **같은 변환 품질**을 바로 재현하는 것. 깊은 내용은 아래 문서로 연결만 하고 여기선 요점만.

## 이 프로젝트가 뭔가

빌드 과정 없는 **정적 브라우저 앱**. 사용자가 올린 파일(MD/DOCX/HTML/TXT/CSV/XLSX/JSON/IPYNB/HWP)을 **IR**로 정규화 → **HWPX(한컴 OWPML)** 로 생성·검증·다운로드. 서버 전송 없음. `.hwpx` 업로드 처리는 예외/복구용으로 남겨 두되, 기본 입력 포맷 안내에는 넣지 않는다. **HWPX는 출력 형식**이다.

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
2. **글꼴 이름 = 한컴이 매칭하는 패밀리명**: 폰트 select의 `value`가 HWPX 글꼴면 이름으로 **그대로 박힌다**. 가변폰트 풀네임(예: `Pretendard GOV Variable Medium`)을 넣으면 매칭 실패 → 미적용. 반드시 [js/app.js](js/app.js) `FONT_DOWNLOADS`의 `systemNames`와 일치하는 **패밀리명**(예: `Pretendard GOV`)을 쓴다. (v4.4.10에서 이걸로 한 번 데임.)
3. **그림**: `hc:img@binaryItemIDRef`(문자열 id)는 header가 아니라 **`content.hpf`의 `opf:item id`** 와 매칭. `hp:pic` 구조는 hwpxlib `testFile/reader_writer/SimplePicture.hwpx`를 정답으로 대조.

**진단 순서(안 보일 때):** ①네임스페이스/요소명·이름 매칭 → ②`xmlns` 선언 → ③IDRef 무결성 → ④속성값(alpha 등은 **마지막**). 추측 금지, **hwpxlib와 대조**(gotchas 2절).

## 검증 (코드로 잡히는 것 vs 사람만 잡는 것)

- 자동: `node qa/gate.js qa/fixtures/md_hwpx_test.md` → 게이트 ①~⑥(mimetype·필수파일·well‑formed·IDRef⊆정의·itemCnt·표 격자 무결성). `npm run test:golden`도 있음.
- **자동은 well‑formed/구조만 본다. 렌더링은 못 본다.** 비주얼(색·음영·그림·표지)은 **반드시 한컴에서 눈으로** 확인 → 사용자에게 "캐시 비우고 `📋 vX.Y.Z` 버전 확인 후 보이나요?"로 요청.
- 회귀 입력·체크리스트: [qa/fixtures/README.md](qa/fixtures/README.md), [qa/release-qa.md](qa/release-qa.md).
- 포맷 파서·HWPX 생성·포맷 안내 문구를 새로 작업할 때는 먼저 [format_conversion_playbook.md](hwpx-public-doc/references/format_conversion_playbook.md)의 해당 포맷 섹션을 읽고, 보존/손실 안내와 테스트를 함께 갱신한다.

## UI·기대치 정렬 불변식

변환 품질만큼 중요한 것은 사용자가 **무엇이 보존되고 무엇이 빠지는지** 미리 알게 하는 것이다. 최근 UX 기준은 아래를 유지한다.

- 첫 화면의 주 행동은 **파일 선택/드롭존**이다. PC/모바일/설치/개인정보 같은 보조 안내 버튼은 드롭존보다 먼저 시선을 빼앗지 않게 둔다.
- 드롭존 문구는 `입력: MD · HTML · TXT · CSV · XLSX · JSON · IPYNB · DOCX · HWP` / `출력: HWPX`처럼 입력과 출력을 분리한다. HWPX를 입력 가능 포맷처럼 쓰지 않는다.
- 지원하지 않는 파일을 넣었을 때는 흐름을 막는 alert보다 **토스트 안내**를 우선한다. 변환 도중 실패는 결과 카드/실패 카드로 다음 행동을 제시한다.
- `문서 제목`은 선택 사항이다. 비워두면 기본값 `heading`(문서 첫 문장/제목)을 쓰고, 사용자가 원하면 `filename`(파일 이름 사용)을 고른다. 초기화 후에도 `heading`을 기본값으로 되돌린다.
- 포맷 카드와 팝업은 일반론만 쓰지 않는다. [js/app.js](js/app.js)의 `FORMAT_INFO`와 `getConversionSummaryForExt()`는 실제 파서 구현 기준으로 **보존됨 / 제외 가능**을 설명해야 한다. DOCX·JSON처럼 내용은 읽히지만 원본 레이아웃 복제가 아닌 포맷은 보존도를 과장하지 않는다.
- 포맷 카드 클릭은 변환 모드 선택이 아니다. 파일 형식은 업로드한 파일 확장자로 결정된다. 따라서 “이 포맷으로 변환하기” 같은 버튼은 두지 않는다.

## 🧪 실험실(Lab) 숨김 기능 — "직접 입력"

완성 전 기능은 지우지 않고 **실험실 플래그 뒤에 숨겨** 개발자만 쓴다. 현재 대상: **직접 입력(텍스트 붙여넣기 → HWPX)**. MD는 쓸 만하지만 HTML 등 일부 형식의 변환 품질이 아직 미완성이라 일반 사용자 동선에서 가렸다.

- **켜는 법**: 주소 끝에 `?lab=1` 을 붙여 한 번 접속한다 → `localStorage['tohwpx_lab']='1'` 로 저장돼 그 브라우저에서 계속 유지된다. 끄려면 `?lab=0`.
  - 콘솔로도 가능: `localStorage.setItem('tohwpx_lab','1')` 후 새로고침.
- **동작**: [js/app.js](js/app.js) `isLabEnabled()`가 참일 때만 변환기 옵션 패널의 `입력 방식 탭(파일 업로드 | 직접 입력)`을 노출한다. 꺼져 있으면 탭을 숨기고 파일 업로드만 보인다. 직접 입력 코드(`setInputMode`/`runPasteConversion` 등)는 그대로 남아 있어, 품질이 완성되면 게이트만 풀면 정식 공개된다.
- **주의**: 빌드 없는 **공개 정적 사이트라 소스가 그대로 보인다 → "보안"이 아니라 "가림"**이다. 일반 사용자 동선에서 안 보이게 하는 용도일 뿐, 소스를 보는 사람은 켤 수 있다. 진짜 비공개가 필요하면 main에 올리지 말고 브랜치/로컬에서만 테스트한다.
- **정합성**: 실험실로 가린 기능은 [changelog.json](changelog.json)의 **사용자(user) 항목에 공지하지 않는다**(개발자(dev) 항목에만 기록). 정식 공개 전환 시 user 항목과 `FORMAT_INFO`/안내 문구를 함께 맞춘다.

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
3. 브랜치 → 커밋(트레일러 `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`) → 푸시.
4. **PR 생성·머지는 `gh` 없이 GitHub API**로(토큰은 `git credential fill`). `/tmp`는 node(Windows)와 curl이 다르게 해석하니 **JSON은 stdin 파이프**(`node -e '...JSON.stringify...' | curl ... -d @-`)로 넘긴다. 머지 405("Base branch was modified")는 재시도.
5. main 동기화 → 브랜치 정리.
6. 사용자에게 버전 번호 알리고 한컴 시각 확인 요청.

## 다른 환경(claude.ai 등)용 포터블 스킬

[hwpx-public-doc/SKILL.md](hwpx-public-doc/SKILL.md) — Python 기반 별도 스킬(베이스 템플릿 + section0.xml만 동적 생성). 이 JS 앱과 별개로 자립 동작. 참조 스키마: [references/ir_schema.md](hwpx-public-doc/references/ir_schema.md), [references/hwpx_structure.md](hwpx-public-doc/references/hwpx_structure.md).

## 톤·작업 방식

- 사용자는 한국어로 소통, 코드를 깊게 안 봐도 되게 **증상 + 열림 여부**로 지시. 변경마다 직접 한컴에서 확인 후 다음 지시.
- "hwpxlib 기준으로 맞춰서"라고 하면 추측 말고 호환 라이브러리와 대조.
- 토큰 절약: 위 문서들에 이미 있는 내용은 다시 파헤치지 말고 **링크로 가서 필요한 부분만** 읽는다.
