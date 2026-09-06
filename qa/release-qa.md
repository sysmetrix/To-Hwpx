# To HWPX Release QA

Date: 2026-06-25
Scope: static browser-only conversion flow from file selection to HWPX download.

## 44. v4.16.20 공문서 항목 들여쓰기 — 규정 기반 변환

### 릴리스 전 확인

- [ ] `npm run test:gov` 14개 검사 통과.
- [ ] **기본값이 끔인지** — golden `DETAIL`이 고정한다. 켜져 있으면 일반 문서가 망가진다.
- [ ] **기호 위치 = 단계 × 2타**인지 8종 전부. 기호 폭이 다른 단계(`가.` `가)` `(1)` `(가)`)에서 어긋나기 쉽고, `1.`·`1)`은 우연히 맞아 눈으로는 안 잡힌다.
- [ ] 기호 없는 문서를 건드리지 않는지(게이트 ⑦, 블록 전체 비교).
- [ ] 실제 공문서(TXT·PDF·HWP)를 변환해 한컴에서 눈으로 확인. 항목이 규정대로 계단을 이루는지, 두 줄 이상 항목의 둘째 줄이 내용 첫 글자에 맞는지.

### 알아둘 것

- **Markdown에는 적용하지 않는다.** `1. `이 순서 목록 문법이라 파서가 이미 목록을 만든다. 이 기능은 문단으로 들어오는 입력(TXT·PDF·HWP·직접 입력)용이다.
- 깊이는 고정표가 아니라 **바로 위 항목과의 상대 관계**로 매긴다. 규정 문구가 그렇게 정한다.

## 43. v4.16.18 PDF 입력 — 추론을 추론이라 말하기

### 무엇이 바뀌었나

PDF 입력을 열었다. PDF는 레이아웃 형식이라 구조 복원이 **추론**이며, 이 릴리스의 설계 원칙은 그 사실을 숨기지 않는 것이다.

### 릴리스 전 확인

- [ ] `npm run test:pdf` 3/3 — 픽스처는 `tests/make-pdf-fixtures.js`가 만든다. 기대값은 `qa/pdf-gate.js`에 있고 둘은 짝이다.
- [ ] **스캔 PDF가 거절되는지** — `blank-scan.pdf`가 빈 HWPX로 변환되면 안 된다. 빈 문서를 성공으로 주면 사용자는 변환된 줄 안다.
- [ ] **근거 없는 머리행 주장이 없는지** — `gov-plan.pdf`의 두 번째 표는 글꼴이 같아 머리행 근거가 없다. `headerRow: false`가 기대값이다.
- [ ] `npm run test:core`에 `sample.pdf` 포함 — 웹앱과 CLI가 같은 HWPX를 만드는지.
- [ ] 결과 카드의 추론 근거 패널이 본문 크기·제목 크기·쪽수·추론 계수를 보여주는지. **고정 백분율이 있으면 안 된다.**
- [ ] 실제 공문서 PDF 몇 건을 한컴에서 열어 눈으로 확인. 추론은 문서마다 다르게 맞는다.

### 이 작업에서 실제로 밟은 함정

1. **머리행이 목록으로 오분류** — 머리행은 가운데 정렬되어 x 좌표가 본문 행과 어긋난다. 좌표만 보면 표에서 떨어져 나가 "들여쓴 줄"이 된다. 열 개수와 줄 간격으로 끌어들인다.
2. **들여쓰기 폭 고정 상수** — 문서마다 어긋나 1단계 목록이 레벨 1로 잡혔다. 관측된 최소 들여쓰기를 한 단계로 삼는다.
3. **`SUPPORTED_EXTENSIONS` 누락** — `accept` 속성과 `PARSERS`에만 넣으면 변환 버튼이 비활성 상태로 남는다. 확장자 등록 지점이 셋(`accept`, `PARSERS`, `SUPPORTED_EXTENSIONS`)이다.

## 42. v4.16.15 코어 추출 — 브라우저 ≡ Node

### 무엇이 바뀌었나

`js/hwpx.js`(렌더러)를 복제하지 않고 Node에서도 실행할 수 있게 했다. 호스트마다 다른 것(ZIP 구현·출력 컨테이너·XML 파서)만 `js/core/runtime.js`에서 갈아 끼운다. 그 위에 CLI(`js/core/cli.js`)와 MCP 서버(`js/core/mcp-server.js`)를 올렸다.

### 새 게이트 3종

| 명령 | 검사 대상 | 합격 기준 |
|---|---|---|
| `npm run test:core` | 웹앱 산출물 ≡ Node 코어 산출물 | 9개 픽스처, 모든 ZIP 엔트리 내용 동일 |
| `npm run test:cli` | CLI 종료 코드·오류 문구 계약 | 22개 검사 |
| `npm run test:mcp` | MCP 프로토콜 + 생성 품질 | 20개 검사 |

`test:core`가 이 릴리스의 핵심이다. 코어를 꺼내는 흔한 실패 방식은 "코어를 만들고 웹앱은 예전 경로를 계속 쓰는 것"이고, 그러면 두 산출물이 조용히 갈라진다. 이 게이트는 브라우저가 **실제로 쓴** IR·옵션을 `window.__tohwpxDebug.lastRender`에서 꺼내 Node 코어에 넣고 비교한다.

### 릴리스 전 확인

- [ ] `npm run test:core` 9/9 — 하나라도 엔트리 불일치면 릴리스하지 않는다.
- [ ] `npm run test:cli` 22개, `npm run test:mcp` 20개 전부 통과.
- [ ] `window.__tohwpxDebug.lastRender`가 채워지는지 golden에서 확인 — 이게 비면 `test:core`가 조용히 무의미해진다.
- [ ] 모듈 타입 스코프가 맞는지: `js/`(module) · `js/vendor/`(commonjs) · `js/vendor/rhwp-core-0.8.4/`(module). 하나만 틀려도 특정 게이트만 깨진다.
- [ ] CLI 산출물을 한컴에서 열어 확인. 구조 게이트 통과는 시각 통과가 아니다.

### 이 작업에서 실제로 밟은 함정

1. **일괄 변환 데이터 손실** — `notes.csv`와 `notes.json`이 둘 다 `notes.hwpx`가 되어 뒤 파일이 앞 파일을 조용히 덮어썼다. 변환 시작 전에 출력 경로 충돌을 검사해 종료 코드 2로 거절하도록 고쳤다.
2. **vendor 모듈 타입 혼재** — `js/vendor/`에 UMD(marked·jszip·xlsx)와 ESM(rhwp)이 섞여 있다. `js/vendor/package.json`을 commonjs로만 두면 rhwp가 `Unexpected token 'export'`로 깨지고, **역방향 게이트에서만** 드러난다.
3. **IR 이미지 직렬화** — `image.data`(`Uint8Array`)를 `JSON.stringify`로 옮기면 `{0:..,1:..}`가 되어 JSZip이 거절한다. base64로 감싸 넘긴다.

## 41. v4.13.1 상용화 변경 회귀 수정

재분석에서 확인한 문제:
- Windows `core.autocrlf=true` 체크아웃에서 vendor JS가 CRLF로 바뀌어 로컬 상용화 해시 게이트가 실패했다.
- 오픈소스·글꼴 고지가 Markdown 원문 링크라 일반 사용자가 웹 문서처럼 읽기 어려웠다.
- 사용자 화면과 법적 문서에 GitHub 및 부천여성청소년재단 외부 링크가 남아 있었다.

수정:
- `.gitattributes`에서 `js/vendor/** -text`를 선언해 OS와 무관하게 원본 바이트를 유지한다.
- `notices.html`을 추가하고 푸터·개인정보·약관을 전용 HTML 고지로 연결한다.
- Vercel의 기존 Markdown URL은 HTML 고지로 영구 이동하고 Markdown 파일은 운영 직접 배포에서 제외한다.
- 사용자 HTML에서 GitHub/BWYF 링크를 제거하고 관련 회귀 검사를 추가한다.

자동 확인:
- [x] `npm run test:release` PASS
- [x] Windows `npm run test:commercial` vendor 5개 해시 PASS
- [ ] `npm run test:browsers` Linux CI Chromium·Firefox·WebKit PASS
- [x] `node qa/gate.js` 대표 입력 5종 ①~⑨ PASS
- [x] `node tests/orientation-e2e.js` PASS
- [ ] 배포 후 기존 `/THIRD_PARTY_NOTICES.md` → `/notices.html` 이동 확인
- [ ] Vercel/Pages v4.13.1 production smoke PASS

비교 근거: `qa/v4.13.1-regression-comparison.md`

## 40. v4.13.0 상용화 P0 보안·법적·운영 게이트

수정:
- SheetJS 0.18.5를 CVE-2023-30533/CVE-2024-22363 수정 버전 0.20.3으로 교체하고 JSZip/marked/@rhwp/core까지 `js/vendor/`에 고정했다.
- XLS/XLSX를 Web Worker에서 처리하며 15초, 20MB, 20,000행, 256열, 2,000,000셀 한도를 적용했다.
- PostHog는 기본 미로드 상태이며 사용자가 명시 동의한 뒤에만 로드한다. 변환 이벤트는 코드 allowlist 속성만 허용한다.
- Vercel 보안 응답 헤더, 법적 문서, 제3자·글꼴 고지, 배포 제외 목록, vendor SHA-256 게이트를 추가했다.
- Chromium/Firefox/WebKit smoke, axe WCAG AA, 10MB 성능 게이트와 15분 운영 감시·롤백 절차를 추가했다.

자동 확인:
- [x] `npm run lint` PASS
- [x] `npm run test:commercial` PASS — vendor 5개 해시, 법적/개인정보/보안 헤더/배포 allowlist
- [x] `npm run test:golden` PASS — 12 format cases, 손상 입력 7건, XLSX 20MB 제한 포함
- [x] `npm run test:accessibility` PASS — 메인 1280×900·390×844와 개인정보/약관 serious/critical 0
- [x] `npm run test:performance` PASS — 10MB TXT 약 3.0초, UI heartbeat 유지
- [x] Chromium 변환 smoke PASS
- [x] WebKit 변환 smoke PASS
- [ ] Firefox headless smoke — 현재 Windows 세션에서 앱 로드 전 `RenderCompositorSWGL failed mapping default framebuffer`로 Playwright 자체 실행 실패. Linux GitHub Actions 재확인 필요
- [x] `node qa/gate.js` 대표 입력 5종 ①~⑨ ALL PASS
- [x] `node tests/orientation-e2e.js` PASS — A3 landscape 3쪽, 잘림 0, 이중 스크롤 없음

수동/외부 승인:
- [ ] PostHog 프로젝트 보유기간을 90일 이하로 설정하고 Network payload에 문서 내용·파일명·제목·HWPX 바이트가 없음을 확인
- [ ] 개인정보처리방침과 이용약관의 운영 주체·연락 창구를 담당자가 최종 승인
- [ ] Vercel 배포 후 CSP/nosniff/Referrer/Permissions 헤더와 v4.13.0 확인
- [ ] Firefox 실제 브라우저와 iPhone Safari/Android Chrome의 변환·다운로드·회전 확인
- [ ] 지정 한컴오피스에서 MD/DOCX/XLSX/PPTX/HWP5/A3 landscape 시각 확인
- [ ] `qa/manual-release-evidence-template.md`를 복사해 확인자·환경·증적 링크 기록

판정: 코드·자동화 범위의 P0는 해소. 외부 서비스 설정, 실제 기기, 한컴 렌더링은 담당자 증적 완료 전까지 제한 출시 상태를 유지한다.

## 39. v4.12.1 상용화 전 보안·개인정보 경계 강화

수정:
- PostHog 초기화를 `js/posthog-init.js`로 분리해 CSP `script-src`가 인라인 스크립트를 허용하지 않아도 동작하게 했다.
- 정밀 미리보기(rhwp)는 사용자가 확인하기 전까지 외부 iframe을 로드하거나 생성 HWPX 바이트를 전달하지 않는다. iframe 응답도 `contentWindow`가 일치할 때만 받는다.
- 서비스 워커 런타임 캐시는 앱 셸과 명시 CDN만 허용한다. Markdown 원격 이미지 같은 임의 외부 GET은 Cache Storage에 저장하지 않는다.
- README와 지원 환경 모달에 원격 이미지, HWP5 WASM, rhwp iframe, 분석 도구의 외부 요청 예외를 명시했다.
- PWA 설치 품질을 위해 192/512 PNG 아이콘을 추가했다.
- `qa/gate.js`는 고정 포트 대신 사용 가능 포트를 자동 배정해 병렬 실행 충돌을 줄였다.

검증일/환경:
- 검증일: 2026-07-08 18:47 KST
- 실행 환경: Windows PowerShell, Node.js v24.16.0, Playwright Chromium(headless)
- 기준 커밋/버전: v4.12.1, PR #120 머지 후 main

자동 확인:
- [x] `npm run lint` — PASS, ESLint 오류/경고 없음
- [x] `npm run test:golden` — PASS, 12 cases + 보안/PWA/SW/rhwp iframe 사전 미로드 회귀 포함
- [x] `node qa/gate.js qa/fixtures/md_hwpx_test.md` — PASS, 게이트 ①~⑨ ALL PASS
- [x] `node qa/gate.js qa/fixtures/sample.docx` — PASS, 게이트 ①~⑨ ALL PASS
- [x] `node qa/gate.js qa/fixtures/docx_table_test.docx` — PASS, 게이트 ①~⑨ ALL PASS
- [x] `node qa/gate.js qa/fixtures/docx_image_test.docx` — PASS, 그림 참조 1개 포함 게이트 ①~⑨ ALL PASS
- [x] `node qa/gate.js tests/fixtures/sample.xlsx` — PASS, 게이트 ①~⑨ ALL PASS
- [x] `qa/gate.js` 5개 fixture 병렬 smoke — PASS, 동적 포트/입력별 임시 파일명으로 충돌 없음
- [x] 운영 도메인 HTML GET 확인 — `https://to-hwpx.vercel.app/` 응답에 `📋 v4.12.1`, CSP meta, `js/posthog-init.js`, `rhwp-iframe`, PNG 아이콘 참조 포함

수동 확인 기준:
- [ ] 운영 도메인 DevTools Console에서 CSP 오류가 없음
- [ ] PostHog 이벤트에 파일명, 문서 제목, 본문, HWPX 바이트가 포함되지 않음
- [ ] 정밀 미리보기 버튼을 처음 눌렀을 때 외부 rhwp/HWPX 전달 확인 창이 먼저 뜸
- [ ] 확인 취소 시 `#rhwp-iframe`에 `src`가 설정되지 않고 기본 미리보기만 유지됨
- [ ] Markdown 원격 이미지 변환 후 Cache Storage에 해당 외부 이미지 URL이 저장되지 않음
- [ ] Android Chrome 설치 화면에서 192/512 PNG 아이콘이 정상 표시됨
- [ ] iPhone Safari와 Android Chrome에서 `.hwpx` 파일명, 자동 다운로드, 수동 다운로드, 화면 회전, safe-area 확인
- [ ] 한컴오피스에서 MD 링크/이미지, DOCX 이미지/표, XLSX 표, PPTX 그림/발표자 노트, HWP5 텍스트, A3 landscape 문서 열기 확인

운영 도메인 수동 확인 체크리스트:
- [x] 운영 도메인에서 `📋 v4.12.1` 표시 확인 — 2026-07-08 HTML GET 기준
- [ ] DevTools Console에서 CSP 오류 없음
- [ ] PostHog 이벤트에 파일명, 문서 제목, 본문, HWPX 바이트가 포함되지 않음
- [ ] 정밀 미리보기 최초 클릭 시 외부 rhwp/HWPX 전달 확인창 표시
- [ ] 확인 취소 시 rhwp iframe `src` 미설정 및 기본 미리보기 유지
- [ ] Markdown 원격 이미지 변환 후 Cache Storage에 해당 외부 이미지 URL이 저장되지 않음
- [ ] Android Chrome 설치 화면에서 192/512 PNG 아이콘 정상 표시
- [ ] iPhone Safari와 Android Chrome에서 `.hwpx` 파일명, 자동 다운로드, 수동 다운로드, 화면 회전, safe-area 확인
- [ ] 한컴오피스에서 MD 링크/이미지, DOCX 이미지/표, XLSX 표, PPTX 그림/발표자 노트, HWP5 텍스트, A3 landscape 문서 열기 확인

최종 승인 샘플 세트:
- Markdown: 제목, 표, 코드블록, 인라인 코드, `http/https/mailto` 링크, data URL 이미지, 실패 이미지(CORS/상대경로 fallback) 포함. 후보: `tests/fixtures/sample.md`, `qa/fixtures/md_hwpx_test.md`, `qa/fixtures/md_link_image_test.md`.
- DOCX: 제목, 본문, 표, 이미지, 각주, 주석, 머리글/바닥글 포함. 후보: `tests/fixtures/sample.docx`, `qa/fixtures/sample.docx`, 실제 Word 수동 샘플 1개.
- XLSX: 긴 표, 숫자, 빈 셀, 수식 표시값, 첫 시트 변환 확인. 후보: `tests/fixtures/sample.xlsx`, `qa/fixtures/long-table.csv`, 실제 Excel 수동 샘플 1개.
- PPTX: 제목, 본문, 표, 그림, 그룹 도형, 발표자 노트 포함. 후보: `tests/fixtures/sample.pptx`, 실제 PowerPoint 수동 샘플 1개.
- HWP5: 본문 텍스트 추출 확인. 후보: 라이선스 확인 가능한 실제 HWP5 샘플 1개(저장소 미커밋).
- A3 landscape: 용지 방향, 본문 폭, 표 경계 확인. 후보: `tests/fixtures/sample.md`를 A3/landscape로 변환한 산출물, 긴 표 fixture.

CI 회귀 검사 상태:
- [x] `qa/gate.js` 병렬 실행 smoke test — `.github/workflows/pages.yml`에 추가
- [x] 서비스 워커 캐시 allowlist 회귀 검사 — `tests/golden.js`에 추가
- [x] PostHog 인라인 스크립트 재유입 방지 검사 — `tests/golden.js`에 추가
- [x] manifest PNG 아이콘 존재 검사 — `tests/golden.js`에 추가
- [x] rhwp iframe이 사용자 확인 전 로드되지 않는지 검사 — `tests/golden.js`에 추가

v4.12.1 출시 승인 판정:
- 자동 검증 기준: 출시 가능
- 운영/실기기/한컴 수동 기준: 수동 확인 완료 전까지 조건부 출시 가능
- 최종 판정: B 조건부 출시 가능. 원본 업로드 없음, HWPX 구조, XSS 방어, PWA/SW 회귀는 자동 증빙 완료. 단, DevTools/운영 분석 payload, 모바일 다운로드, 한컴 실제 렌더링은 사람 승인 필요.

남은 리스크:
- 한컴오피스 렌더링은 XML 구조 게이트로 완전히 보증할 수 없다.
- iOS/Android 다운로드 파일명과 safe-area는 OS/브라우저 정책 영향을 받는다.
- PostHog/Vercel 이벤트 payload는 운영 DevTools Network에서 실제 이벤트 단위 확인이 필요하다.
- rhwp 정밀 미리보기는 외부 iframe 코드 의존 기능이므로 네트워크/서드파티 변경에 따라 실패할 수 있다.

다음 버전으로 넘길 개선 과제:
- 운영 도메인 smoke test를 Playwright로 분리해 버전 표시, 콘솔 CSP 오류, rhwp 취소 흐름, Cache Storage allowlist를 자동화한다.
- PostHog 이벤트 스키마를 코드 상수로 고정하고 이벤트 payload snapshot 테스트를 추가한다.
- 한컴오피스 수동 승인 샘플 산출물을 릴리스별로 보관할 위치와 네이밍 규칙을 정한다.
- 모바일 실기기 체크 결과를 스크린샷과 함께 기록하는 QA 템플릿을 추가한다.

## 1. Release Risk Diagnosis

| Severity | 위치 | 문제 | 사용자 영향 | 현재 상태 | 남은 조치 | 검증 방법 |
| --- | --- | --- | --- | --- | --- | --- |
| Critical | `js/app.js` `handleFileSelect()`, `js/parsers.js` `fileToIR()` | 지원하지 않는 확장자가 오류 문서로 HWPX 생성될 수 있음 | 사용자가 실패를 성공으로 오해 | 해결됨: 선택 단계 차단, 파서 실패 시 다운로드 없음 | 없음 | `npm run test:golden`의 malformed/unsupported 입력 6건 rejected |
| High | `js/parsers.js` DOCX/HWPX ZIP 처리 | 손상 ZIP/비정상 구조가 오류 문서로 변환될 수 있음 | 실패 파일을 정상 결과로 오해 | 해결됨: 손상 DOCX/HWP5 실패 케이스가 HWPX 다운로드를 만들지 않음 | 실제 손상 파일 추가 샘플은 다음 버전에서 확장 | `npm run test:golden`, `node qa/gate.js qa/fixtures/sample.docx` |
| High | `index.html`, `js/posthog-init.js` | CSP와 PostHog 인라인 초기화 충돌 | 운영 지표 누락, CSP 오류 | 해결됨: self-host `js/posthog-init.js`로 분리, golden 재유입 검사 추가 | 운영 DevTools에서 CSP 오류와 payload 수동 확인 | `npm run lint`, `npm run test:golden`, 운영 Network 확인 |
| High | `js/app.js` rhwp 정밀 미리보기 | 외부 iframe에 HWPX 바이트 전달 고지 부족 | 로컬 변환 기대와 충돌 | 해결됨: 최초 사용 전 확인창, iframe source 검증, 사전 미로드 테스트 추가 | 운영 브라우저에서 확인 취소 흐름 수동 확인 | `npm run test:golden`, 운영 DevTools Elements 확인 |
| High | `sw.js` 서비스 워커 캐시 | 임의 외부 GET 응답이 Cache Storage에 남을 수 있음 | 원격 이미지 URL/응답 캐시 개인정보 리스크 | 해결됨: APP_SHELL allowlist만 런타임 캐시, golden 회귀 추가 | 운영 브라우저 Cache Storage 수동 확인 | `npm run test:golden`, 운영 Application 탭 확인 |
| Medium | `js/app.js` 배치 변환 | 다중 파일 일부 실패가 전체 결과를 막거나 누락될 위험 | 일부 파일 누락/오해 | 해결됨: 파일별 큐/상태/부분 실패/ZIP/개별 다운로드 회귀 통과 | 모바일 배치 다운로드는 수동 확인 권장 | `npm run test:golden`의 BATCH 칸반 보드 |
| Medium | `js/app.js` 결과 카드/포맷 안내 | 변환 후 보존/손실 가능 요소 안내 부족 | DOCX/HTML/XLSX 서식 손실을 품질 오류로 인식 | 해결됨: 포맷별 보존/제외 안내와 결과 요약 회귀 통과 | 실제 사용자 문구 이해도는 운영 관찰 | `npm run test:golden`의 UX/FORMAT_INFO 검사 |
| Medium | `index.html` 미리보기 안내 | 기본/rhwp 미리보기와 한컴오피스 결과 차이 | 최종 렌더링 오해 | 잔여 리스크: 안내는 있으나 실제 렌더링 보증 불가 | 한컴오피스 승인 샘플 세트 수동 열기 | 한컴오피스에서 MD/DOCX/XLSX/PPTX/HWP5/A3 산출물 확인 |
| Medium | 모바일 Safari/Android Chrome | 다운로드 파일명, 자동 다운로드, safe-area/회전 | 저장 실패 또는 버튼 가림 | 잔여 리스크: 자동 테스트는 레이아웃 일부만 보증 | iPhone Safari/Android Chrome 실기기 확인 | 운영 도메인 수동 체크리스트 |
| Medium | 운영 분석 payload | PostHog/Vercel 이벤트에 문서 정보가 섞일 가능성 | 개인정보 신뢰 리스크 | 잔여 리스크: 코드상 track은 이벤트 중심이나 운영 payload 미확인 | DevTools Network에서 이벤트 payload 수동 검토 | PostHog `/e/`, `/batch/` 요청 payload 확인 |
| Low | PWA 설치 아이콘 | SVG 단일 아이콘 호환성 | 설치 화면 품질 저하 | 해결됨: 192/512 PNG maskable 추가 | Android 설치 화면 수동 확인 | `npm run test:golden`, 운영 설치 UI 확인 |
| Low | `qa/gate.js` 병렬 실행 | 포트/임시 파일명 충돌 | CI smoke 불안정 | 해결됨: 동적 포트와 입력별 임시 파일명, CI 병렬 smoke 추가 | 없음 | 로컬 병렬 smoke PASS, GitHub Actions 병렬 smoke |

## 2. Conversion Quality Test Matrix

| 포맷 | 테스트 입력 | 기대 결과 |
| --- | --- | --- |
| MD | `tests/fixtures/sample.md`, `qa/fixtures/md_link_image_test.md` | 제목, 본문, 목록, 표, 코드블록, 클릭 가능한 본문 링크, data URL 그림 생성. 상대경로 이미지는 fallback 안내 |
| HTML | `qa/fixtures/sample.html` | 스크립트 미실행, 텍스트/표/목록만 추출 |
| DOCX | 수동 DOCX 샘플 | 본문, 표, 일부 굵게/기울임, 이미지, 첫 머리글/바닥글, 각주 텍스트 보존. 페이지 배치·복잡 개체 손실 안내 |
| PPTX | `tests/fixtures/sample.pptx`, `qa/fixtures/sample.pptx` | 슬라이드 순서대로 제목/본문/목록 텍스트, 표(a:tbl, 가로/세로 병합 포함), 그림(p:pic), **그룹 도형(p:grpSp) 내부 콘텐츠**까지 추출. 도형 위치·애니메이션·레이아웃·발표자 노트 손실 안내. ⚠ 실제 PowerPoint/Keynote/Google Slides 파일로는 아직 미검증(수작업 fixture만 통과) |
| TXT | `qa/fixtures/sample.txt`, `empty.txt` | 순수 텍스트 변환, 빈 문서도 오류 없이 처리 |
| CSV/XLSX | `sample.csv`, 수동 XLSX 샘플 | 첫 행 머리글, 숫자 오른쪽 정렬, 복잡 서식 손실 안내 |
| JSON | `qa/fixtures/sample.json` | 제목, 목록, 객체 표 또는 텍스트 단순화 |
| IPYNB | `qa/fixtures/sample.ipynb`, `tests/fixtures/sample.ipynb` | 마크다운/코드/텍스트 출력 추출, 코드 셀 이미지 출력(PNG/JPEG)을 HWPX 그림으로 변환 |
| HWP/HWPX | 앱 생성 HWPX, HWP5 샘플 | HWPX 텍스트 재추출, HWP5는 변환 안내 메시지 |
| XLSX 자동 fixture | `tests/fixtures/sample.xlsx` | 첫 시트·빈 셀·수식 표시값 보존, 두 번째 시트 제외 |
| TXT 인코딩 | `tests/fixtures/sample.txt`, `sample-euckr.txt` | UTF-8/EUC-KR 한글·문단·목록 보존 |

## 3. Edge Cases

| 케이스 | 기대 결과 |
| --- | --- |
| 한글/이모지/특수문자 | XML 생성 오류 없이 텍스트 보존 |
| Markdown `&#39;` 엔티티 | 일반 문단·강조·목록·표에서 문자 `'`로 복원되고 HWPX XML에 엔티티 문자열이 남지 않음 |
| 긴 파일명 | 다운로드 파일명이 `.hwpx`로 끝남 |
| 잘못된 확장자 | 변환 버튼 비활성화 및 지원 형식 안내 |
| 손상 ZIP `.docx` | HWPX 생성 없이 파싱 실패 안내 |
| 대용량 파일 | 텍스트 100MB, 바이너리 50MB 초과 시 사전 차단 |
| 다중 파일 드롭(배치) | 파일별 큐 적재(미지원/초과분 제외 토스트), 순차 변환, 칸반 보드(대기/변환 중/완료/실패 4컬럼)로 상태 표시(v4.10.16~) |
| 배치 부분 실패 | 일부 파일 실패해도 나머지 변환 완료, 실패 사유 행 표시 |
| 배치 다운로드 | 전체 ZIP 1회 + 파일별 개별 받기, 중복 파일명 유일화 |
| 단일 파일 | 큐 길이 1 — 기존 단일 결과 카드 + 자동 다운로드 동작 유지(회귀) |
| 자동 다운로드 차단 | 완료 카드의 수동 다운로드 버튼 사용 |
| iPhone Safari / Android Chrome | 다운로드 확장자가 `.hwpx`로 유지되는지 수동 확인 |

## 4. HWPX Package Checks

- `mimetype`이 ZIP 첫 항목인지 확인
- `mimetype` 내용이 `application/hwp+zip`인지 확인
- `META-INF/container.xml`, `META-INF/manifest.xml`, `Contents/header.xml`, `Contents/section0.xml`, `Preview/PrvText.txt` 존재 확인
- `section0.xml` 네임스페이스와 XML 파싱 오류 확인
- `charPrIDRef`, `paraPrIDRef`, `borderFillIDRef` 참조 무결성 확인
- `hc:img@binaryItemIDRef`가 `content.hpf` item, `BinData`, package manifest와 연결되는지 확인
- `hp:fieldBegin type="HYPERLINK"`와 `hp:fieldEnd`의 `id/fieldid` 쌍, 안전한 `Path` 프로토콜, URL XML escape 확인
- 일반 데이터 표가 `pageBreak="TABLE"`, `repeatHeader="1"`, `treatAsChar="0"`, `hp:outMargin@bottom="850"`이고 첫 행 셀이 `header="1"`인지 확인
- 코드 블록 표의 `hp:outMargin@bottom="850"`, 인용구 `paraPr id=19`의 `hh:next value="850"` 및 코드 글자 모양이 사용자가 선택한 글꼴 id를 참조하는지 확인
- 가로 구분선 옵션 기본값이 숨김이고, 숨김일 때 `hr`이 `paraPrIDRef="9"` 빈 줄로 대체되는지 확인
- 다운로드 링크의 파일명과 `type="application/hwp+zip"` 확인

## 5. Security and Privacy Checks

- HTML/Markdown/JSON 입력은 `textContent` 또는 XML escape 경로로만 출력
- IR 미리보기는 `textContent` 사용
- 문서 내용은 서버로 전송하지 않음
- 외부 요청은 CDN 라이브러리, Google Fonts, rhwp 미리보기 iframe, 공식 폰트 링크와 Markdown에 사용자가 명시한 원격 이미지로 제한
- Markdown 원격 이미지는 `credentials: omit`, `referrerPolicy: no-referrer`, 10초 제한으로 직접 요청하며 원본 문서/HWPX는 전송하지 않음
- 손상 ZIP과 압축 해제 50MB 초과 DOCX/HWPX는 파싱 실패로 중단

## 6. Changed Files and Reasons

| 파일 | 변경 이유 |
| --- | --- |
| `js/app.js` | 지원 확장자 사전 차단, 다중 파일 안내, 파싱 실패 중단, 결과 카드 보존/손실 안내 추가 |
| `js/parsers.js` | 지원하지 않는 형식/크기 초과/손상 DOCX/HWPX ZIP을 실패로 처리 |
| `index.html` | rhwp 미리보기와 한컴오피스 결과 차이 고지 강화 |
| `style.css` | 결과 카드의 보존/손실 안내 가독성 보강 |
| `qa/fixtures/*` | 회귀 테스트 입력 파일 추가 |
| `qa/release-qa.md` | 릴리스 위험 진단, 회귀 테스트, 출시 판정 기록 |

## 7. Regression Checklist

- [ ] 각 fixture 업로드 후 변환 완료 카드 표시
- [ ] unsupported 확장자 업로드 시 변환 버튼 비활성화
- [ ] 손상 `.docx` 업로드 시 HWPX 파일 미생성
- [ ] 다중 파일 드롭 시 큐 목록 표시 + N개 변환 버튼
- [ ] 배치 변환 후 파일별 상태(완료/경고/실패) 표시
- [ ] 전체 ZIP 다운로드 열림 + 파일별 개별 받기 동작
- [ ] 단일 파일 변환은 기존과 동일(결과 카드 1개 + 자동 다운로드)
- [x] 일반 접속에서도 직접 입력 탭(베타) 노출: MD/HTML/TXT/CSV/JSON 형식 버튼 선택 + 내용 붙여넣기 → 변환·다운로드 동작 (v4.8.3 공개)
- [x] 직접 입력 탭 상단에 베타 안내 패널 표시 — 품질 미완성 경고 + HTML 버튼 설명
- [x] 기존 호환용 `?lab=1`도 관리자 모드를 켜며 업데이트 내역이 노출됨
- [x] 일반 접속에서는 관리자 모드 토글 자격, 업데이트 내역 창이 보이지 않음
- [x] 직접 입력 미리보기·HTML 복사/다운로드는 v4.11.0부터 관리자 여부와 무관하게 항상 노출됨
- [x] 동일 입력의 파일 업로드·직접 입력 HWPX 본문 및 표 개수 동등성
- [x] Excel·Google Sheets 탭 구분 표 붙여넣기 → HWPX 표 변환
- [x] HTML 태그 없는 일반 텍스트 붙여넣기 → 문단 보존
- [ ] 직접 입력 ↔ 파일 업로드 탭 전환 시 입력·결과 초기화, 파일 드롭 시 업로드 모드 자동 전환
- [ ] HWPX ZIP 구조 검증 PASS
- [ ] `long-table.csv` 변환 후 한컴에서 표가 두 쪽 이상으로 나뉘고, 다음 쪽에도 제목 줄이 자동 반복됨
- [ ] 긴 표가 글자처럼 취급되지 않으며 단 오른쪽 정렬로 설정되고, 행 높이·열 너비·병합 셀이 깨지지 않음
- [ ] 짧은 일반 표와 다음 본문 사이에 아래쪽 바깥 여백 약 3mm가 보이며, 긴 표의 쪽 나눔에는 불필요한 중간 간격이 생기지 않음
- [ ] Markdown 문장 속 인라인 코드가 앞뒤 문장과 같은 문단에 표시되고, 단독 코드 문단은 기존 코드 블록 형태 유지
- [ ] Markdown의 `&#39;`가 일반 문단·강조·목록·표에서 모두 `'`로 보이며 `section0.xml`에 `&apos;`, `&#39;`, `&amp;#39;`가 남지 않음
- [ ] Markdown 안전 링크가 한컴에서 열리고, 굵은 링크의 서식과 클릭 기능이 함께 유지됨
- [ ] `javascript:` 링크는 일반 표시 문자열만 남고 HWPX `Path`/`Command`에 포함되지 않음
- [ ] Markdown data URL 그림이 한컴에 표시되고 `hc:img → content.hpf → BinData → manifest`가 연결됨
- [ ] 상대경로·CORS 차단 이미지는 전체 변환을 실패시키지 않고 fallback 문단과 결과 카드 경고로 남음
- [ ] 기본 미리보기 페이지 비율과 상단 표시가 A3/A4/B5/Letter 및 세로/가로 선택을 반영
- [ ] 긴 가로 문서가 가로 비율을 유지한 여러 장으로 나뉘며, 종이 내부 스크롤·내용 잘림·이중 스크롤이 없음
- [ ] 결과 카드에 보존/손실 가능 요소 표시
- [ ] 수동 다운로드 버튼으로 `.hwpx` 파일 저장
- [ ] 한컴오피스에서 실제 열기 확인

## 8. Release Verdict

조건부 출시.

핵심 변환/다운로드 흐름은 출시 가능 수준으로 정리되었지만, DOCX/XLSX/HWPX의 실제 한컴오피스 렌더링은 브라우저 자동 검증만으로 보증할 수 없습니다. 배포 전 수동 한컴오피스 열기 확인을 완료하면 출시 가능으로 전환할 수 있습니다.

## 9. Remaining Risks

1. DOCX의 페이지 배치, 스타일 테마, 주석, 변경 추적, 복잡 개체는 손실될 수 있어 사용자가 원본과 다르다고 느낄 수 있음.
2. XLSX의 여러 시트, 병합 셀, 수식, 차트는 보존되지 않아 표 중심 문서 외 품질 기대를 낮춰야 함.
3. rhwp 미리보기와 한컴오피스 렌더링 차이로 최종 여백/표 너비 확인이 필요함.
4. 모바일 브라우저 다운로드 UI는 OS 정책 영향을 받아 자동 다운로드가 차단될 수 있음.
5. HWP5 바이너리는 브라우저에서 완전 파싱하지 못해 HWPX/DOCX로 사전 변환이 필요함.

포맷별 점수·결함·검증 근거는 `qa/conversion-quality-audit-v4.5.5.md`를 기준으로 한다.

## 10. v4.5.4 상용화 마무리 기록

### 수정·개선 결정

- 구조 검증 경고 산출물은 결과 카드에서 수동 다운로드할 수 있지만 자동 다운로드하지 않는다. 배치 변환도 경고 항목이 하나라도 있으면 ZIP 자동 다운로드를 중지한다.
- 모든 모달은 열린 창 안에서 Tab/Shift+Tab 포커스를 순환하고, ESC·닫기·바깥 클릭으로 종료하면 원래 열기 컨트롤로 포커스를 돌려준다.
- 포맷 카드는 Enter/Space, 포맷 탭은 좌우 방향키·Home·End를 지원한다.
- 모바일 모달은 `dvh`와 safe-area를 사용하고, 닫기·메뉴 컨트롤은 최소 44px 터치 영역을 확보한다.
- GitHub Pages 배포 전 golden 테스트와 MD/DOCX HWPX 패키지 게이트를 실행한다. 테스트 의존성이 운영 산출물에 섞이지 않도록 `index.html`, CSS, JS, fonts, icons, manifest, changelog, service worker만 `_site`에 구성한다.
- PWA 시작 경로는 저장소 하위 경로 배포를 위해 `./` 기준으로 고정하고, 외부 rhwp iframe 권한은 실제 사용에 필요한 스크립트·동일 출처로 제한한다.

### 자동 승인 기준

- [x] `npm run test:golden` PASS — 기존 입력 + 관리자 모드 직접 입력 + 상용 UX 회귀
- [x] `node qa/gate.js qa/fixtures/md_hwpx_test.md` PASS
- [x] `node qa/gate.js qa/fixtures/sample.docx` PASS
- [x] package/lock/SW/index/changelog 버전 4.5.4 일치
- [ ] GitHub Actions Pages 배포 성공

### 실기기·사람 승인 기준

- [ ] Chrome·Edge 데스크톱에서 파일 선택 → 변환 → 자동/수동 다운로드 → 한컴오피스 열기
- [ ] iPhone Safari 375/390px 및 Android Chrome 360/412px에서 `.hwpx` 파일명 유지
- [ ] 모바일 세로/가로 회전, 화면 키보드, 노치/홈 인디케이터에서 주요 버튼이 가려지지 않음
- [ ] Tab/Shift+Tab, Enter/Space, 방향키, ESC만으로 주요 흐름 이용 가능
- [ ] MD·DOCX·CSV 표본을 한컴오피스에서 열어 글꼴·표·코드·여백을 시각 확인

## 11. v4.5.5 포맷 품질 감사 결과

- [x] Golden 정상 입력 11개: MD, HTML, TXT UTF-8/EUC-KR, CSV, XLSX, JSON 일반/IR, IPYNB, DOCX
- [x] 손상·미지원 입력 5개: JSON, IPYNB, CSV, DOCX, HWP5 — HWPX 미생성 및 실패 카드 확인
- [x] MD 패키지 게이트 ①~⑦ PASS
- [x] DOCX 기본 패키지 게이트 ①~⑦ PASS
- [x] DOCX 병합·중첩 표 격자 게이트 PASS
- [x] DOCX 그림 `hc:img → content.hpf → BinData → manifest` 참조 게이트 PASS
- [x] XLSX 첫 시트 HWPX 표 패키지 게이트 PASS
- [x] 회전 전 `width < height` 유지, 세로 `WIDELY`/가로 `NARROWLY`, 회전 후 본문 폭 자동 검사 PASS
- [ ] 한컴오피스에서 A3 가로, DOCX 그림, 병합 표, IPYNB 코드 배경을 시각 확인

## 12. v4.5.7 용지 방향 회귀 교정

- [x] A3/A4/B5/Letter × 세로/가로 8조합 pagePr enum·기본 치수 검사
- [x] 가로 본문/표 폭이 회전 후 유효 폭을 사용하고 내부 검증과 일치
- [x] 기본 미리보기 실제 렌더 폭·높이와 용지별 상대 크기 검사
- [x] 라이브 흐름 진단 스크립트 `tests/orientation-e2e.js` 추가
- [ ] 배포 후 동일 사용자 문서로 한컴 가로 페이지와 표 경계 확인

## 13. v4.5.8 기본 미리보기 회귀 방지

원인:
- v4.5.7에서 긴 가로 문서를 가로처럼 보이게 하려고 `.ir-page`에 고정 종횡비와 내부 `overflow:auto`를 함께 적용했다.
- 테스트가 첫 페이지의 `renderedWidth > renderedHeight`만 확인하여 내부 스크롤과 내용 잘림을 정상으로 승인했다.

필수 승인 기준:
- [x] A3 가로 긴 문서가 두 페이지 이상으로 분할
- [x] 모든 `.ir-page`가 선택 용지의 가로 종횡비 유지
- [x] 각 페이지 `scrollHeight <= clientHeight + 1`
- [x] 종이 내부 `overflow:auto` 없음
- [x] 상단에 `용지 · 방향 · N쪽` 표시
- [x] `npm run test:golden` PASS
- [x] 로컬 실제 흐름 `tests/orientation-e2e.js` PASS 및 화면 캡처 확인
- [ ] 배포 후 캐시를 비우고 `📋 v4.5.8` 확인
- [ ] 사용자 문서로 세로·가로 미리보기와 페이지 이동을 최종 확인

릴리스 중단 조건:
- 위 자동 항목이 하나라도 실패하거나 실제 화면 캡처를 확인하지 않았으면 배포하지 않는다.
- 단순 폭·높이 비교만으로 미리보기 회귀 검증을 대체하지 않는다.

## 14. Pretendard GOV PC별 등록명 호환성

실기기 확인 결과:

- [x] `Pretendard GOV Variable` 설치 PC: v4.5.10에서 글꼴 적용 및 한컴 글꼴란 표시 정상
- [x] `Pretendard GOV` 설치 PC: v4.5.10에서 대체 글꼴 렌더링은 적용됐으나 한컴 글꼴란이 빈칸

최종 품질 기준(v4.5.11):

- UI에는 `Pretendard GOV Variable` 하나만 노출한다.
- 변환 직전 실제 등록명을 정확히 감지한다.
- Variable 설치 PC는 주 글꼴 `Pretendard GOV Variable`, 대체 글꼴 `Pretendard GOV`로 기록한다.
- GOV 설치 PC는 주 글꼴 `Pretendard GOV`, 대체 글꼴 `Pretendard GOV Variable`로 기록한다.
- 감지 불가 시 배포 TTF 내부 이름인 `Pretendard GOV Variable`을 기본값으로 사용한다.
- [x] 자동 테스트: 두 설치명 감지, 동시 설치 시 Variable 우선, 미감지 기본값, 양방향 `substFont`, 7개 언어 fontface 검사
- [ ] v4.5.11 배포 후 두 PC 모두 글꼴 적용과 한컴 글꼴란 표시 재확인

## 15. v4.5.12 일반 표 아래 바깥 여백

- [x] 일반 데이터 표 `hp:outMargin@bottom="850"`(약 3mm) 자동 검사
- [x] 표지·구분선·코드 블록용 표에는 일반 데이터 표 여백을 일괄 적용하지 않음
- [x] `npm run test:golden` PASS
- [x] `node qa/gate.js qa/fixtures/md_hwpx_test.md` PASS
- [x] 한컴오피스에서 일반 표 아래 3mm 바깥 여백 적용 확인

## 16. v4.5.13 인용구·코드문 간격과 코드 글꼴

- [x] 코드 블록 표 `hp:outMargin@bottom="850"`(약 3mm) 자동 검사
- [x] 인용구 `paraPr id=19`의 `hh:next value="850"` 자동 검사
- [x] 코드 글자 모양 `charPr id=6`이 선택한 문서 글꼴 id=0을 참조하고 `D2Coding` 고정 fontface가 없는지 자동 검사
- [x] `npm run test:golden` PASS
- [x] `node qa/gate.js qa/fixtures/md_hwpx_test.md` PASS
- [ ] 한컴오피스에서 인용구·코드문 아래 3mm 간격과 코드문 선택 글꼴 적용 확인

## 17. v4.5.14 표 여백 및 구분선 처리

- [x] 구분선(`hr`)은 숨김 옵션에서 `paraPrIDRef="9"` 빈 줄, 표시 옵션에서 구분선 표로 처리되는지 자동 검사
- [x] `npm run test:golden` PASS
- [x] `node qa/gate.js qa/fixtures/md_hwpx_test.md` PASS
- [ ] 한컴오피스에서 숨김 모드의 구분선 자리가 빈 줄로, 표시 모드의 구분선이 선으로 자연스럽게 보이는지 확인

## 18. v4.5.15 관리자/실험 기능 설정 UI

- [x] 관리자 모드 설정이 아이콘·상태 배지·스위치로 표시됨
- [x] 활성/비활성 상태가 `aria-pressed`와 `사용 중`/`꺼짐` 문구에 함께 반영됨
- [x] 모바일 폭과 다크 테마 디자인 토큰 대응
- [x] `npm run test:golden` PASS

## 19. v4.5.17 Markdown `&#39;` 엔티티 복원

원인:
- 일반 문단·강조·표는 `decodeMdEntities()`를 거쳤지만, Markdown 목록은 하위 `text` 토큰과 `item.text` fallback 경로에서 디코딩을 건너뛰었다.
- 같은 입력이어도 목록에서만 `&#39;`가 그대로 노출되어 이전 작은따옴표 회귀 검사가 실제 적용 범위를 충분히 보장하지 못했다.

수정·승인 기준:
- [x] 목록 하위 `text` 토큰과 `item.text` fallback 모두 `decodeMdEntities()` 적용
- [x] fixture에 일반 문단·강조·목록·표의 `&#39;` 입력 추가
- [x] 생성된 `section0.xml`에서 각 입력이 문자 `'`로 존재
- [x] 생성된 `section0.xml`에 `&apos;`, `&#39;`, `&amp;#39;`가 남지 않음
- [x] `npm run test:golden` PASS
- [x] `node qa/gate.js tests/fixtures/sample.md` 게이트 ①~⑦ PASS
- [ ] 배포 후 캐시를 비우고 `📋 v4.5.17` 확인
- [ ] 사용자 원본 Markdown을 한컴에서 열어 해당 문구가 작은따옴표로 보이는지 확인

## 20. v4.5.18 앱 설치 안내 이해도 개선

문제:
- 브라우저별 실제 설치 아이콘이 다른데도 공통 가상 주소창과 `설치` 글자 칩으로 안내해 사용자가 어떤 아이콘을 눌러야 하는지 연결하기 어려웠다.
- 설치 아이콘이 없을 때의 메뉴 경로와 이미 설치된 경우를 같은 단계에서 구분하지 않아 원인을 판단하기 어려웠다.

수정·승인 기준:
- [x] Chrome의 모니터·화살표 설치 아이콘과 Edge의 창·더하기 앱 설치 아이콘을 별도 이미지로 표시
- [x] 브라우저별 카드에서 아이콘 → 기본 설치 단계 → 메뉴 대체 경로 순으로 안내
- [x] 이미 설치된 경우 아이콘이 보이지 않을 수 있다는 별도 설명 제공
- [x] 아이콘 이미지에 의미 있는 대체 텍스트 제공
- [x] 데스크톱 1280px, 모바일 390px, 다크 테마 실제 렌더 캡처 확인
- [x] 새 아이콘 2종을 서비스 워커 앱 셸 캐시에 포함
- [x] `npm run test:golden` PASS
- [ ] 배포 후 Chrome·Edge 실제 주소창 아이콘과 안내 이미지를 비교 확인

## 21. v4.5.19 설치 아이콘 시각 통일

문제:
- Chrome 캡처는 밝은 배경·어두운 선, Edge 캡처는 어두운 배경·밝은 선이라 같은 카드 묶음에서 이질적으로 보였다.

수정·승인 기준:
- [x] 두 SVG의 캡처 배경 제거
- [x] 두 아이콘의 선 색상 `#667085`, 선 굵기 `2.5`로 통일
- [x] 공통 CSS 타일이 테마별 배경·테두리를 담당하도록 역할 분리
- [x] SVG 벡터 유지로 확대·고해상도 화면의 화소 저하 없음
- [x] 데스크톱 라이트·다크 테마 실제 렌더 확인
- [x] `npm run test:golden` PASS
- [ ] 배포 후 Chrome·Edge 실제 화면에서 아이콘 식별성 확인

## 22. v4.5.20 직접 입력 관리자 기능 품질 강화

공개 기준:

- [x] MD/HTML/TXT/CSV/JSON 직접 입력을 기존 `fileToIR()` 변환 파이프라인으로 처리
- [x] 5개 형식에서 동일 원문의 파일 업로드·직접 입력 HWPX 본문과 표 개수 동등성 검사
- [x] CSV 모드에서 쉼표 CSV와 Excel·Google Sheets 탭 구분 표 자동 판별
- [x] 열 수가 다른 표 행에 빈 셀을 보충해 HWPX 표 격자 유지
- [x] HTML 소스와 태그 없는 일반 텍스트 모두 본문 보존
- [x] CRLF/LF 줄바꿈을 LF로 정규화해 운영체제와 textarea 간 문단 파싱 차이 제거
- [x] 관리자 모드 플래그와 업데이트 내역의 관리자 토글 유지, `?admin=1` 또는 호환용 `?lab=1` 승인 브라우저에서만 노출
- [x] `FORMAT_INFO`, 결과 카드 보존/손실 안내, 플레이북, AGENTS 작업 지침 정합성 갱신
- [x] `npm run test:golden` PASS
- [x] 데스크톱 1280px·모바일 390px에서 관리자 모드 활성 시 직접 입력 안내가 자연스럽게 보이는지 확인
- [x] 관리자 모드 비활성 일반 화면에서 파일 업로드만 보이는지 확인
- [ ] 직접 입력으로 만든 MD·HTML·TSV 결과를 한컴오피스에서 열어 시각 확인

## 23. v4.5.21 직접 입력 관리자 모드 비공개 복원

- [x] 일반 접속에서 입력 방식 탭과 직접 입력 패널 비노출
- [x] 관리자 모드 승인 전 개발자 변경사항에 관리자 토글 비노출
- [x] `?admin=1`에서 직접 입력 탭과 활성 상태 토글 노출
- [x] `?lab=1`은 호환용으로 같은 관리자 모드를 활성화
- [x] 토글을 끄면 직접 입력 탭과 업데이트 내역 접근이 숨겨짐
- [x] `?admin=0` 또는 `?lab=0`에서 기능 상태와 토글 자격 모두 제거
- [x] v4.5.20 사용자 changelog의 직접 입력 공개 공지 제거
- [x] 데스크톱 1280px·모바일 390px 일반/관리자 모드 화면 시각 확인
- [x] 직접 입력 품질 개선과 5개 형식 동등성 회귀는 유지

## 24. v4.6.4 Markdown 링크·이미지 및 포맷 경계 품질 기준

설계 경계:

- [x] Markdown 문법 해석은 `parseMd()`/인라인 토큰 변환에 한정
- [x] 비동기 이미지 확보는 `resolveMarkdownAssets()`로 분리하고 `parseMd()` 동기 계약 유지
- [x] 링크·최종 그림은 공통 IR로 정규화한 뒤 포맷을 모르는 `hwpx.js`에서 출력
- [x] HTML/DOCX 파서는 변경하지 않고 공용 Renderer의 새 속성이 있을 때만 새 동작 적용
- [x] IPYNB Markdown 셀은 MD 파서 재사용 영향권으로 명시하고 golden 회귀 포함
- [x] 목록·표 내부 링크/이미지는 문자열 IR 제약을 사용자 안내와 플레이북에 명시

자동 승인 기준:

- [x] 안전한 본문 링크 2개가 HYPERLINK fieldBegin/fieldEnd 쌍으로 생성
- [x] 쿼리 문자열 `&`가 `Path`에서 `&amp;`로 XML escape
- [x] `javascript:` 링크가 HWPX URL 필드에서 제거되고 표시 문자열은 보존
- [x] data URL PNG가 `hc:img → content.hpf → BinData → manifest`로 연결
- [x] 상대경로 이미지 실패가 문서 전체 실패가 아닌 fallback 문단/경고로 처리
- [x] `qa/gate.js`에 링크 필드 무결성 ⑧ 추가
- [x] `npm run test:golden` 전체 포맷 PASS
- [x] `node qa/gate.js qa/fixtures/md_hwpx_test.md` ①~⑧ PASS
- [x] `node qa/gate.js qa/fixtures/md_link_image_test.md` ①~⑧ PASS
- [x] `node qa/gate.js qa/fixtures/docx_image_test.docx` ①~⑧ PASS

실기기 승인 기준:

- [ ] 캐시를 비우고 `📋 v4.6.4` 확인
- [ ] 한컴에서 일반 링크와 굵은 링크를 Ctrl+클릭해 올바른 주소가 열림
- [ ] 한컴에서 data URL 그림이 보이고 비율이 깨지지 않음
- [ ] 상대경로/접근 차단 이미지의 fallback 문구가 이해 가능함
- [ ] DOCX 기존 그림이 이전 버전과 동일하게 표시됨

릴리스 중단 조건:

- 링크가 파란색·밑줄로만 보이고 클릭되지 않거나, 그림이 자동 게이트를 통과해도 한컴에서 사라지면 완료 처리하지 않는다.
- 공용 Renderer 변경 후 HTML/DOCX/JSON IR golden 중 하나라도 실패하면 포맷별 예외를 추가하기 전에 IR 계약 위반 여부를 먼저 확인한다.

## 25. v4.6.5 Markdown 목록 링크·이미지 실패 안내 교정

- [x] Markdown 목록 항목의 `runs`를 보존해 일반/중첩 목록 링크를 HYPERLINK 필드로 출력
- [x] 목록 marker와 링크 표시 문자열이 같은 문단에 유지
- [x] 이미지 URL 자리에 `[URL](URL)`이 중첩된 입력을 실제 URL로 정규화
- [x] CORS `Failed to fetch`를 브라우저 접근 정책 안내로 변환
- [x] 원격 이미지 실패 fallback에 클릭 가능한 `원본 이미지 열기` 링크 보존
- [x] MD 링크 게이트에서 본문 2개 + 목록 2개, 총 4개 링크 필드 PASS
- [x] 전체 golden PASS
- [ ] 한컴에서 `관련 페이지`, `참고 자료` 목록 링크 클릭 확인
- [ ] CORS 차단 이미지 fallback의 `원본 이미지 열기` 클릭 확인

## 26. v4.6.6 온보딩·문서 설정 UX 정리

- [x] 문서 기본 설정에서 `변환` 표현 제거
- [x] 줄 간격을 글꼴 크기 오른쪽으로 이동하고 설정 요약에 `줄 N%` 표시
- [x] 상단 제목 블록과 여백 설정을 세부 설정에서 우선 노출
- [x] 첫 방문 1회 온보딩: 파일 선택 → 기본 설정 확인 → 변환 후 다운로드 3단계 안내
- [x] 헤비 유저용 고급 사용 팁: 문서 모양, 폰트, 보존 한계, 추천 순서 분리 안내
- [x] 세부 설정 항목별 짧은 도움말 버튼 추가
- [x] Chrome/Edge 설치 안내 아이콘을 같은 품질의 128px SVG 스타일로 교체
- [x] 페이지 여백 미니맵이 용지 크기·방향·mm 비율을 반영
- [x] 자동 QA에서 온보딩 모달이 변환 게이트를 막지 않도록 `tohwpx_onboarding_seen` 상태 주입
- [x] 전체 golden PASS
- [x] `tests/orientation-e2e.js` PASS
- [x] `node qa/gate.js qa/fixtures/md_hwpx_test.md` ①~⑧ PASS
- [x] 데스크톱 캡처: 온보딩 모달, 세부 설정 도움말, 고급 사용 팁 모달 확인
- [ ] 배포 후 캐시를 비우고 `📋 v4.6.6` 확인
- [ ] Chrome/Edge 실제 화면에서 설치 안내 아이콘 식별성 확인
- [ ] 한컴에서 기본 여백·가로/세로 문서가 의도대로 보이는지 시각 확인

## 27. v4.6.7 닫아도 남는 첫 사용 안내

- [x] 첫 방문 모달을 3단계 핵심 흐름만 남긴 짧은 안내로 축소
- [x] 모달을 닫아도 드롭존 아래 `처음이면` 안내 바가 유지됨
- [x] 안내 바의 `숨기기`를 명시적으로 눌렀을 때만 잔존 안내가 숨겨짐
- [x] 변환기 섹션에 파일 선택 전/선택 후/완료 후 상황별 한 줄 안내 추가
- [x] 안내 바와 상황별 안내가 파일 선택·변환·용지 방향 e2e를 막지 않도록 자동 테스트 상태 분리
- [x] 전체 golden PASS
- [x] `tests/orientation-e2e.js` PASS
- [x] `node qa/gate.js qa/fixtures/md_hwpx_test.md` ①~⑧ PASS
- [x] 데스크톱 캡처: 축약 온보딩 모달, 닫은 뒤 안내 바, 세부 설정 화면 확인
- [ ] 배포 후 캐시를 비우고 `📋 v4.6.7` 확인
- [ ] 실제 사용자 흐름에서 모달을 닫은 뒤 안내 바가 과하게 방해되지 않는지 확인

## 28. v4.6.13 문서 세부 설정 옵션 기록 기준

자동 승인 기준:

- [x] 문서 세부 설정 옵션 매핑이 `format_conversion_playbook.md`에 UI 라벨, 내부 값, HWPX 반영 기준으로 기록됨
- [x] `AGENTS.md`에 세부 설정 변경 시 플레이북 표와 `validateDetailSettingsUx()`를 함께 갱신하라는 기준이 있음
- [x] `validateDetailSettingsUx()`가 문단 간격, 제목 스타일, 표 스타일, 링크 표시, 이미지 폭/정렬, 첫 제목 본문 처리, 가로 구분선, 페이지 여백의 UI 또는 XML 회귀를 확인함
- [x] `npm run test:golden` PASS
- [x] `node qa/gate.js qa/fixtures/md_hwpx_test.md` ①~⑧ PASS

수동 문서 확인 기준:

- [ ] 세부 설정 라벨만 바뀐 변경인지, `value`/localStorage/HWPX 생성 계약까지 바뀐 변경인지 changelog와 플레이북에서 구분됨
- [ ] 새 세부 설정을 추가한 경우 `state`, reset, localStorage key, `buildHwpx()` 옵션 전달, HWPX XML 반영, UI 라벨, 도움말, 테스트가 같은 의미로 정렬됨

실기기 승인 기준:

- [ ] 캐시를 비우고 `📋 v4.6.13` 확인
- [ ] 한컴에서 대표 MD 파일을 기본값과 세부 설정 변경값으로 각각 열어 문단 간격, 제목 크기, 표 머리행, 링크 표시, 이미지 정렬, 구분선 표시/숨김이 기대와 일치하는지 확인

## 29. v4.6.22 관리자 품질 평가와 직접 입력 미리보기

자동 승인 기준:

- [x] 상단 배너의 MD→HWPX, MD→HTML 연계 링크 제거
- [x] 직접 입력 아래 IR 기반 미리보기와 원문/미리보기 복사 버튼 추가
- [x] 업데이트 내역 모달에서 추천 실험 기능을 `관리자 모드` 탭으로 이동
- [x] `포맷 품질 평가` 탭에서 포맷별 변환률/성공률, 제한사항, 개선 방안, 버전/일자별 추이를 표시
- [x] 일반 모드에서는 직접 입력과 업데이트 내역 상세가 계속 비노출
- [x] `tests/golden.js`에 관리자 탭, 품질 탭, 직접 입력 미리보기, 상단 링크 제거 회귀 추가

수동 확인 기준:

- [ ] `?admin=1`에서 관리자 모드 탭의 토글과 추천 실험 패널이 보임
- [ ] 품질 평가 탭의 지표가 원격 사용자 통계가 아니라 fixture/구조 기준 추정임을 안내함
- [ ] 직접 입력 MD/HTML/CSV에서 미리보기가 입력 흐름을 과하게 밀어내지 않고 복사 버튼이 동작함
- [ ] 캐시를 비우고 `📋 v4.6.22` 확인
- [ ] 직접 입력으로 만든 MD·HTML·TSV 결과를 한컴오피스에서 열어 표/문단/링크가 기존 직접 입력 기준과 동일하게 보이는지 확인

## 30. v4.6.23 직접 입력 HTML 복사와 개발 환경 정리

자동 승인 기준:

- [x] 상단 도움말 버튼에 다른 유틸 버튼과 맞는 아이콘 추가
- [x] 직접 입력 미리보기에 `HTML 복사` 버튼 추가
- [x] 직접 입력 변환도 파일 업로드와 같은 HWPX 생성 경로를 쓰고, 링크 표시·줄 간격 같은 문서 설정이 적용되는지 golden에서 확인
- [x] GitHub CLI 설치 확인: `gh version 2.95.0`

수동 확인 기준:

- [ ] 새 터미널에서 `gh --version`이 바로 실행되는지 확인
- [ ] `gh auth login` 저장 인증은 현재 git credential 토큰 scope 부족으로 미완료. 필요 시 `read:org` 포함 토큰 또는 브라우저 로그인으로 인증
- [ ] 직접 입력 미리보기에서 `HTML 복사`가 표/문단 HTML 조각을 클립보드에 복사하는지 확인
- [ ] 캐시를 비우고 `📋 v4.6.23` 확인

## 31. v4.6.24 관리자 기능 토글과 원본 서식 우선 옵션

자동 승인 기준:

- [x] 직접 입력 미리보기의 `HTML` 버튼에서 `복사`와 `다운로드`를 선택할 수 있음
- [x] 관리자 모드 탭에 전체 사용/전체 사용 안함 스위치와 현재 구현된 기능 목록, 개별 기능 토글이 표시됨
- [x] 추천 실험 기능이 구현 완료 기능과 분리된 상태판 문구로 표시됨
- [x] 문서 세부 설정에 `원본 서식 처리` 옵션이 추가되고 기본값이 `원본 우선`임
- [x] 단일 파일 선택 직후 관리자 IR 미리 분석 캐시가 생성되고 변환 시 재사용됨
- [x] `npm.cmd run test:golden` PASS
- [x] `node tests/orientation-e2e.js` PASS
- [x] `node qa/gate.js qa/fixtures/md_hwpx_test.md` ①~⑧ PASS

수동 확인 기준:

- [ ] `?admin=1`에서 현재 구현된 기능별 토글을 끄고 켰을 때 직접 입력/미리보기/HTML 메뉴 노출이 기대대로 바뀌는지 확인
- [ ] DOCX·HTML·XLSX 대표 파일을 `원본 우선`과 `설정 우선`(value `app`)으로 각각 변환해 한컴에서 표/색상/링크/문단 간격 차이를 시각 확인
- [ ] 파일 선택 후 변환 버튼을 누르기 전 IR 미리보기가 채워지는지 확인
- [ ] 캐시를 비우고 `📋 v4.6.24` 확인

## 32. v4.6.25 HTML 다운로드와 베타/품질 주기 표시

자동 승인 기준:

- [x] 직접 입력 미리보기의 HTML 다운로드가 `.hwpx`로 정규화되지 않고 `.html` 파일명으로 저장됨
- [x] 첫 화면에 DOCX·HTML·XLSX 서식 변환 베타 표시가 보임
- [x] 지원 현황 표에서 DOCX·HTML·CSV·XLSX 상태가 베타로 표시됨
- [x] 포맷 품질 평가 탭에 평가 주기 안내가 표시됨
- [x] 관리자 구현 기능 토글이 텍스트 버튼이 아니라 스위치형 UI로 표시됨
- [x] `npm.cmd run test:golden` PASS
- [x] `node tests/orientation-e2e.js` PASS
- [x] `node qa/gate.js qa/fixtures/md_hwpx_test.md` ①~⑧ PASS

수동 확인 기준:

- [ ] 직접 입력 미리보기 HTML 다운로드 파일이 브라우저 다운로드 목록에서 `.html`로 보이는지 확인
- [ ] `?admin=1` 관리자 모드 탭에서 구현된 기능 토글이 최신 스위치형으로 보이는지 확인
- [ ] 캐시를 비우고 `📋 v4.6.25` 확인

## 33. v4.10.26 모바일 폼 입력 자동 확대 방지

원인: iOS Safari는 포커스되는 `input`/`select`/`textarea`의 computed font-size가 16px 미만이면 페이지를 자동 확대한다. `.form-row select/input`(14.4px), `.margin-item input[number]`(13.12px), `.paste-textarea`(13.76px)가 모두 기준 미달이었다.

수정: 768px 이하 미디어쿼리에서 위 세 그룹만 `font-size: 16px`로 오버라이드(데스크톱 값은 유지).

자동 승인 기준:

- [x] `npm run test:golden` PASS — `validateMobileFormFontSize()` 신규: 390px 뷰포트에서 옵션 select(`#font-size`)·여백 입력(`#margin-top`)·직접 입력 textarea(`#paste-input`) computed font-size ≥16px 확인
- [x] 데스크톱 폭(1280px)에서 동일 요소 font-size가 기존 값(0.9rem/0.82rem/0.86rem)으로 유지되어 시각 회귀 없음

수동 확인 기준:

- [ ] iPhone Safari(또는 시뮬레이터) 390px에서 문서 제목 직접 입력, 여백 숫자 입력, 직접 입력(붙여넣기) textarea를 각각 탭했을 때 페이지가 자동 확대되지 않는지 확인
- [ ] 캐시를 비우고 `📋 v4.10.26` 확인

## 34. v4.10.27 HWP5 바이너리 텍스트 추출 (@rhwp/core 도입)

원인: `js/parsers.js`의 `parseHwp()`는 OLE2(HWP5) 매직 바이트를 감지하면 항상 파싱 실패 오류를 던졌다. 브라우저에서 HWP5 바이너리(CFBF 컨테이너 + 압축 레코드)를 직접 해석할 자체 구현이 없었기 때문이다.

조사: GitHub에서 변환 품질 개선용 참고 저장소를 탐색하던 중 `edwardkim/rhwp`(이 앱이 이미 "정밀 미리보기" iframe으로 쓰던 Rust+WASM 프로젝트)가 npm에 `@rhwp/core`로 HWP5/HWPX 파서를 공개하고 있음을 확인했다. `HwpDocument` 생성자가 원본 `.hwp` 바이트를 직접 받고 `getSectionCount()/getParagraphCount()/getTextRange()`로 본문 텍스트를 읽을 수 있어, 손으로 CFBF 레코드 파서를 새로 만드는 것보다 훨씬 안전했다.

검증(중요 — 두 단계로 사용자 승인 받음):
1. 로컬 Node 스크립트로 `@rhwp/core`(jsdelivr에서 다운로드)를 실행해 실제 HWP5 샘플(국립국어원 공개 예산 문서, `edwardkim/rhwp` 저장소의 공개 samples)에서 텍스트가 정확히 나오는지 확인(87개 문단, 정상적인 한글 텍스트 확인). 이 저장소에는 커밋하지 않음(제3자 실문서 라이선스 미확정).
2. 실제 앱(정적 서버 + headless Chromium)에 같은 샘플을 업로드해 변환 → 다운로드된 HWPX의 `Contents/section0.xml`에 추출된 한글 텍스트가 그대로 들어있는지 확인.

수정:
- `js/parsers.js`: `parseHwp5WithRhwp()` 신규. CFBF 헤더 최소 크기(512바이트) 미만은 네트워크 요청 없이 즉시 거부, 그 이상이면 `@rhwp/core` 동적 import → `HwpDocument` 생성 → 문단 순회 → 텍스트만 IR로 변환(표/이미지/서식 제외).
- `index.html`: CSP `script-src`에 `https://cdn.jsdelivr.net` + `'wasm-unsafe-eval'` 추가.
- `js/app.js`: `FORMAT_INFO.hwp`, `QUALITY_ESTIMATES.hwp`(25→55/45→75/높음→중간), `QUALITY_HISTORY` 갱신.

자동 승인 기준:

- [x] `npm run test:golden` PASS(12 cases) — `validateRejectedInputs()`에 512바이트 이상 손상 HWP5 케이스 추가, 실제 WASM 로딩·`new HwpDocument()` 실패 경로까지 검증
- [x] `node qa/gate.js qa/fixtures/md_hwpx_test.md` ①~⑧ PASS
- [x] 로컬 실제 HWP5 샘플 → 앱 업로드 → HWPX 다운로드 → section0.xml에 원문 한글 텍스트 포함 확인(위 검증 2단계)

수동 확인 기준:

- [ ] 실제 보유 중인 구형 `.hwp`(HWP5) 파일을 업로드해 본문 텍스트가 읽히는지, 한컴오피스에서 열리는지 확인
- [ ] 암호 보호되거나 손상된 `.hwp` 업로드 시 "HWP5 바이너리를 열지 못했습니다" 안내가 뜨고 크래시하지 않는지 확인
- [ ] 오프라인/jsdelivr 접근 불가 환경에서 `.hwp` 업로드 시 "읽기 엔진을 불러오지 못했습니다" 안내로 우아하게 실패하는지 확인
- [ ] 캐시를 비우고 `📋 v4.10.27` 확인

## 35. v4.10.28 DOCX 주석(comments.xml) 각주 형태 추출

원인: `parseDocx()`는 `word/comments.xml`을 전혀 읽지 않아 Word 주석이 통째로 사라졌다. `FORMAT_INFO.docx.limits`에는 이미 "주석 손실 가능"으로 정직하게 안내돼 있었지만, `QUALITY_HISTORY`의 기존 "next" 계획(comments.xml을 각주 형태로 변환)이 아직 구현되지 않은 상태였다.

수정: `word/comments.xml`(고정 경로, rels 조회 불필요)을 읽어 주석ID→"[주석] 작성자: 내용" 맵을 만들고, 본문에서 `w:commentReference`를 만나면 기존 각주와 동일한 `run.footnote` 필드로 삽입한다. `commentRangeStart/End`(어느 텍스트가 하이라이트됐는지)는 다루지 않고 주석 아이콘 위치(앵커)만 사용한다 — Renderer(`js/hwpx.js`) 변경 없이 기존 각주 출력 경로를 그대로 재사용.

자동 승인 기준:

- [x] `npm run test:golden` PASS(12 cases) — `tests/make-docx-fixture.js`에 comments.xml + commentRangeStart/End/commentReference 추가, docx 케이스 mustContain에 주석 텍스트 확인 추가
- [x] `node qa/gate.js qa/fixtures/md_hwpx_test.md` ①~⑧ PASS

수동 확인 기준:

- [ ] 실제 Word에서 주석을 단 DOCX를 업로드해 주석 내용이 "[주석] 작성자: 내용" 형태로 각주처럼 나오는지 한컴오피스에서 확인
- [ ] 각주와 주석이 둘 다 있는 문서에서 순서·내용이 뒤섞이지 않는지 확인
- [ ] 캐시를 비우고 `📋 v4.10.28` 확인

## 36. v4.10.29 qa/gate.js ⑨ ZIP CRC32 무결성 + python-hwpx 대조 결론

조사: GitHub 리서치(변환 품질 개선 계획) Phase 4로 `airmang/python-hwpx`의 검증 방식(`src/hwpx/tools/validator.py`, `docs/owpml-deviations.md`)을 이 저장소의 `qa/gate.js` 8게이트와 대조했다.

결론(포팅하지 않기로 한 것도 기록):
- python-hwpx는 공식 OWPML XSD로 스키마 검증을 하지만, **스키마 위반을 하드 에러가 아니라 lint 경고로만 취급**한다. 이유는 `owpml-deviations.md`에 명시: 공식 스키마(2024 네임스페이스 중심)가 한컴 실제 동작(2011 본체 + 2016 확장 네임스페이스)과 다르기 때문 — 이 저장소가 이미 채택한 "스펙보다 호환 구현체(hwpxlib)를 믿는다"는 원칙과 정확히 같은 결론에 독립적으로 도달한 것. XSD 스키마 검증 자체는 포팅하지 않는다(오히려 오탐 위험).
- `repair.py`의 `archive.testzip()` 방식(ZIP CRC32 무결성)은 방법론과 무관하게 유효한 안전장치라 판단해 `qa/gate.js`에 게이트 ⑨로 추가했다.

수정: `qa/gate.js`가 `JSZip.loadAsync(buf, {checkCRC32:true})`로 HWPX를 열고, 모든 엔트리를 실제로 압축 해제해 CRC32 불일치 시 즉시 실패하도록 게이트 ⑨ 추가.

자동 승인 기준:

- [x] `node qa/gate.js qa/fixtures/md_hwpx_test.md` ①~⑨ PASS(⑨ 신규 확인)
- [x] `npm run test:golden` PASS(12 cases, 회귀 없음)

수동 확인 기준:

- [ ] 캐시를 비우고 `📋 v4.10.29` 확인(코드 동작 자체는 개발자 도구용이라 사용자 화면 변화 없음)

## 37. v4.10.30 PPTX 발표자 노트 추출 + 문구 드리프트 정정

원인: `parsePptx()`는 `ppt/notesSlides/`를 전혀 읽지 않아 발표자 노트가 항상 사라졌다. `FORMAT_INFO.pptx.limits`에는 정직하게 "발표자 노트 미지원"으로 안내돼 있었지만, `QUALITY_HISTORY`의 기존 "next" 계획(발표자 노트 추출)이 아직 구현 전이었다.

조사 부산물: 같은 김에 `getConversionSummaryForExt()`(포맷 카드 보존/손실 요약)를 보다가 **이미 지원되는 기능이 여전히 lossy로 표시된 기존 드리프트**를 발견해 함께 고쳤다 — DOCX 주석(v4.10.28에서 이미 지원), PPTX 그룹 도형 내부 콘텐츠(v4.10.12부터 지원). `format_conversion_playbook.md`가 "표/그림 지원 추가 당시 이 함수 갱신을 누락해 회귀가 있었다(v4.10.12에서 수정)"고 경고해둔 바로 그 지점에서 또 발생한 드리프트였다.

수정:
- `js/parsers.js`: `extractPptxNotesText()` 신규 — 슬라이드 rels의 notesSlide 관계 → `ppt/notesSlides/notesSlideN.xml`의 `a:t` 텍스트를 모두 이어붙여 슬라이드 본문 뒤에 `[발표자 노트] ...` 문단으로 추가.
- `js/app.js`: `FORMAT_INFO.pptx`, `QUALITY_ESTIMATES.pptx`(42→48/82→83), `QUALITY_HISTORY`, `getConversionSummaryForExt()`의 docx/pptx preserved·lossy 문구 정정.

알려진 스코프 제한(문서화됨): 슬라이드 본문(`items`)이 하나도 없는 빈 슬라이드는 통째로 `continue`되므로 그 슬라이드의 노트도 함께 누락된다.

자동 승인 기준:

- [x] `npm run test:golden` PASS(12 cases) — `tests/fixtures/sample.pptx`에 notesSlide1 추가, pptx 케이스 mustContain에 노트 텍스트 확인 추가
- [x] `node qa/gate.js qa/fixtures/md_hwpx_test.md` ①~⑨ PASS

수동 확인 기준:

- [ ] 실제 PowerPoint에서 발표자 노트를 작성한 PPTX를 업로드해 노트 내용이 각 슬라이드 뒤에 "[발표자 노트] ..."로 나오는지 한컴오피스에서 확인
- [ ] 포맷 카드(PPTX)의 보존/손실 요약이 실제 동작과 일치하는지 확인(그룹 도형 내부 콘텐츠·발표자 노트가 이제 "보존됨"으로 표시)
- [ ] 캐시를 비우고 `📋 v4.10.30` 확인

## 38. v4.11.0 빈 PPTX 슬라이드 발표자 노트 보존 + lint 정리

원인: `parsePptx()`가 슬라이드 본문 항목이 없으면 발표자 노트를 읽기 전에 `continue`하여, 노트만 작성된 슬라이드가 결과에서 조용히 사라졌다. 또한 고정 SVG와 버전 고정 CDN URL처럼 사용자 입력이 아닌 값에도 `no-unsanitized` 경고가 남아 실제 신규 경고를 알아보기 어려웠다.

수정:
- `js/parsers.js`: 발표자 노트를 본문 항목 검사 전에 읽고, 본문과 노트가 모두 없을 때만 슬라이드를 건너뛴다.
- `js/app.js`: 드롭존 초기 DOM을 HTML 문자열 대신 복제 노드로 저장·복원한다.
- 고정 SVG 리터럴과 고정 `@rhwp/core` URL은 안전 근거를 인접 주석으로 기록하고 해당 한 줄에만 ESLint 예외를 적용한다.
- 플레이북의 링크 URL 공백 표기와 빈 슬라이드 노트 처리 설명을 실제 코드와 맞춘다.

자동 승인 기준:

- [x] `npm run lint` PASS(경고 0건)
- [x] `npm run test:golden` PASS(12 cases)
- [x] `node qa/gate.js qa/fixtures/md_hwpx_test.md` ①~⑨ PASS

수동 확인 기준:

- [ ] 실제 PowerPoint에서 본문 없이 발표자 노트만 있는 슬라이드를 변환해 `슬라이드 N`과 `[발표자 노트]` 문단이 한컴에서 보이는지 확인
- [ ] 파일 선택 해제 후 드롭존의 안내 문구와 아이콘이 초기 상태로 정상 복원되는지 확인
- [ ] 라이트/다크 모드 전환 아이콘이 기존과 동일하게 보이는지 확인
- [ ] 캐시를 비우고 `📋 v4.11.0` 확인

## 39. v4.15.0 DOCX 고충실도 감사·IR v2·전수 렌더 하네스

원인: 실제 재단 KPI 보고서 DOCX는 XML 자체는 읽을 수 있었지만 잘못된 리터럴 속성 3개, 소수 twip 60개, 최종 `sectPr` 위치 오류, 대량의 OOXML 자식 순서 문제를 포함했다. 기존 DOCX 경로는 표 셀의 여러 문단과 수동 줄바꿈을 평문 한 문단으로 합치고 A4·앱 기본 타이포그래피를 적용해, 열리는 HWPX를 만들면서도 표 34개·4,035개 셀의 실제 내용 흐름을 크게 왜곡했다.

수정:

- `js/docx-audit.js`: 파싱 전 결함 계수와 안전 정규화. 리터럴 속성 제거, 소수 twip 반올림, 최종 `sectPr` 이동, 알려진 자식 순서 교정만 자동 수행한다.
- `js/parsers.js`: IR v2에 `audit`, `pageSetup`, `typography`, 표 geometry·row metadata·cell `blocks`를 보존한다. 수동 줄바꿈·탭·highlight, 변경 추적 삭제 제외, 안전한 외부 관계를 처리한다.
- `js/hwpx.js`: Letter 크기, 원본 여백·타이포그래피, 표 폭·열 비율·정렬·셀 여백·행 높이·머리행, 셀의 여러 문단·중첩 블록, `hp:lineBreak`·`hp:tab`을 출력한다.
- `js/app.js`/`style.css`: DOCX 고정 품질 백분율을 제거하고 파일별 감사 상태·복구 내역·입력→출력 구조 계수 패널을 표시한다.
- `ARCHITECTURE.md`, `ENGINEERING.md`, ADR 3건, `qa/impact-graph.json`: 감사 경계, IR 계약, 다축 QA, 변경 영향도와 반복 루프를 고정한다.

자동 승인 기준:

- [x] `npm run test:impact` — 코드·테스트·플레이북·설계·릴리스 QA 동반 변경 검사
- [x] `npm run test:docx` — 고충실도 fixture의 감사 복구, 표·행·셀 exact, 문단 97% 이상, 줄바꿈 입력 이상, Letter 용지·여백 exact, 잘못된 리터럴 부재
- [x] 실제 KPI 보고서 — 표 34/34, 행 877/877, 셀 4,035/4,035, 문단 5,430/5,444, 수동 줄바꿈 89/89, Letter 61,200×79,200 HWPUNIT, 여백 exact
- [x] `npm run test:release` — v4.15.0 lint·commercial·impact·DOCX·golden·accessibility·performance 전체 PASS

한컴 시각 승인 기준:

- [x] 개선 HWPX를 한컴오피스 2024에서 PDF로 직접 내보냄(106쪽)
- [x] `qa/render-pdf-contact-sheets.py`로 106쪽 전부를 렌더하고 6개 contact sheet에서 빈 페이지·잘림·누락 여부 확인
- [x] 장문 표의 큰 행은 마지막 셀에 실제 장문이 있는 원본 구조와 Word/한컴 표 나눔 차이이며, 셀·텍스트가 사라진 결과가 아님을 구조 계수와 화면을 함께 대조
- [ ] 배포 후 캐시를 비우고 최종 버전 버튼 확인, 같은 원본을 한컴에서 사용자 확인

릴리스 중단 조건:

- 표·행·셀 또는 수동 줄바꿈 수가 감소하거나 원본 페이지 설정이 달라지면 중단한다.
- 자동 게이트가 통과해도 한컴 PDF 전수 렌더에서 빈 페이지·잘림·누락이 보이면 중단한다.
- 총 페이지 수는 Word와 한컴의 레이아웃 엔진 차이 때문에 단독 합격 기준으로 사용하지 않는다.

## 40. v4.15.1 중첩 표 패키지 게이트의 DOM 경계 수정

원인: v4.15.0 제품 변환과 실제 KPI 보고서 검증은 통과했지만, GitHub Pages의 기존 `qa/gate.js qa/fixtures/docx_table_test.docx`가 중첩 표를 정규식으로 잘랐다. 외부 표의 범위가 내부 `</hp:tbl>`에서 조기에 끝나면서 내부 셀을 외부 표 셀로 중복 계수해 `(0,0) 덮임=2` 오탐을 냈고 배포가 중단됐다.

수정:

- `qa/gate.js`: DOMParser로 모든 표를 읽고 각 `hp:tc`의 가장 가까운 `hp:tbl` 조상이 현재 표인지 확인해 직계 셀만 격자 검사한다.
- `package.json`: CI와 동일한 대표 입력 5종의 9단계 패키지 게이트를 `npm run test:package`로 추가하고 로컬 `test:release`에 포함한다. 이후 로컬 전체 게이트가 통과했는데 원격에서 처음 실패하는 드리프트를 막는다.

승인 기준:

- [x] `node qa/gate.js qa/fixtures/docx_table_test.docx` — 외부 병합 표와 중첩 표 3개를 각각 분리해 ⑥ 격자 무결성 PASS
- [x] `npm run test:release` — v4.15.1 lint·commercial·impact·DOCX·golden·대표 5종 package·accessibility·performance 전체 PASS
- [ ] GitHub Pages 배포 워크플로 — 순차·병렬 패키지 게이트와 배포 PASS

## 41. 동시 HWPX 렌더 상태 격리

원인: `buildSection()`이 15개 블록마다 이벤트 루프에 양보하는 동안 다른 웹·CLI·MCP 요청이 모듈 전역 문단/각주/하이퍼링크 카운터와 본문 기준 글자 크기를 덮어썼다. 10pt 문서와 20pt 문서를 동시에 만들면 첫 문서의 20pt run 100개 중 86개가 기본 서식으로 바뀌는 것을 재현했다. 제목 사전 스캔은 원본 IR에 `_runs`·`_cId`도 추가했다.

승인 기준:

- [x] 문단·각주·하이퍼링크 ID, 본문 기준 글자 크기, 제목 동적 서식을 호출별 RenderContext로 격리
- [x] 10pt/20pt 90문단 동시 렌더의 `header.xml`·`section0.xml`이 각각 순차 기준과 동일
- [x] 렌더 전후 입력 IR JSON이 동일하고 `_runs`·`_cId` 임시 필드가 없음
- [x] `npm run test:core` 웹/Node 11개 픽스처 동등성 + 동시 렌더 격리 통과
- [ ] 한컴에서 일반 문서와 링크·각주·색상 제목 문서를 열어 기존 표시가 같은지 확인

## 42. 파일 분석 조정과 Markdown 이미지 병렬 처리

실측 원인: 느린 XLSX 미리보기 뒤 큐를 초기화하고 Markdown을 선택하면 새 문서가 먼저 보인 뒤 이전 XLSX(`Golden 첫 시트`)가 다시 덮었다. 같은 XLSX 미리보기 중 변환을 누르면 Worker가 2개 생성됐다. 500ms 원격 이미지 4개는 232/738/1243/1749ms에 차례로 시작해 총 2273ms가 걸렸다.

승인 기준:

- [x] 큐/정책 generation과 파일 분석 서명이 달라진 늦은 결과는 미리보기·캐시 갱신 금지
- [x] 미리보기와 변환의 같은 XLSX는 in-flight Promise를 공유해 Worker 1개만 생성
- [x] 400ms 원격 이미지 4개 요청 시작 간격 250ms 미만, 전체 분석 1300ms 미만(실측 627ms)
- [x] 병렬 완료 순서와 무관하게 IR 블록과 `image1.png`~`image4.png`가 원문 순서 유지
- [x] `npm run test:golden`에 위 세 경쟁/성능 회귀 포함
- [ ] 실제 원격 이미지 Markdown을 변환해 한컴에서 그림 순서와 표시 확인
