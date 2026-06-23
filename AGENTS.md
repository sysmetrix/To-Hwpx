# AGENTS.md — To‑Hwpx 작업 지침 (에이전트는 여기부터)

> 이 파일은 저장소의 **단일 작업 지침**이다. 코딩 에이전트 공통 표준(`AGENTS.md`)이라 **Codex·Cursor 등도 그대로 읽고**, Claude Code는 `CLAUDE.md`가 이 파일을 import 한다. git으로 따라다녀 다른 PC·다른 세션·다른 도구에서도 동일.
> 목적: 매번 코드를 다시 탐색하지 않고 **같은 변환 품질**을 바로 재현하는 것. 깊은 내용은 아래 문서로 연결만 하고 여기선 요점만.

## 이 프로젝트가 뭔가

빌드 과정 없는 **정적 브라우저 앱**. 사용자가 올린 파일(MD/DOCX/HTML/TXT/CSV/XLSX/JSON/IPYNB/HWPX)을 **IR**로 정규화 → **HWPX(한컴 OWPML)** 로 생성·검증·다운로드. 서버 전송 없음.

핵심 파일:
- [js/parsers.js](js/parsers.js) — 입력 → IR(`{title, doc_type, blocks:[...]}`)
- [js/hwpx.js](js/hwpx.js) — IR → HWPX(ZIP+XML). 글자/문단모양, borderFill, 표, 그림, 표지(cover) 생성
- [js/app.js](js/app.js) — UI·옵션·파이프라인·`FORMAT_INFO`·`FONT_DOWNLOADS`
- [index.html](index.html) / [style.css](style.css) — 옵션 UI, 버전 버튼
- [changelog.json](changelog.json) / [sw.js](sw.js) — 버전·캐시
- 개발 상세: [DEV.md](DEV.md) / QA: [qa/release-qa.md](qa/release-qa.md)

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

## 릴리스 절차 (사용자 기대 — 변경 1건 = 1릴리스)

1. 코드 수정.
2. **버전 범프**: `node qa/bump-version.js --write` → package/lock/sw(`CACHE_VERSION`)/index(버전 버튼) 자동 갱신. **단 [changelog.json](changelog.json)은 수동**: `current`를 새 버전으로 바꾸고 `versions[]` 맨 앞에 `{version,date,user[],dev[]}` 항목 추가. (날짜 같으면 patch+1, 다르면 minor+1.0 규칙.)
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
