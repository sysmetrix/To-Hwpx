# Format Conversion Playbook

이 문서는 To-Hwpx의 포맷별 변환 기술과 작업 노하우를 모은다. 목적은 새 에이전트가 `js/parsers.js`, `js/hwpx.js`, `js/app.js`를 매번 처음부터 추측하지 않고 같은 품질 기준으로 수정하게 하는 것이다.

## 재현도 채점 (전 포맷)

원본과 생성 HWPX를 항목별로 대조해 포맷마다 100점 만점으로 채점하고 미달 근거를 출력한다. 회귀를 "무언가 바뀌었다"가 아니라 **"무엇이 얼마나 사라졌다"**로 보게 하는 것이 목적이다.

```
node tests/format-fidelity-score.js [md html txt csv xlsx json ipynb pptx]   # 픽스처: tests/fixtures/fidelity/rich.*
node tests/docx-real-convert.js "원본.docx" && node tests/docx-fidelity-score.js "원본.docx"   # DOCX는 실제 원본 기준
```

채점 기준을 고칠 때는 **코드 버그와 채점 기준 오류를 구분한다.** 실제로 있었던 예:

- 첫 H1은 기본 제목 정책(`heading`)에 따라 **문서 제목 문단(`paraPr 12`)으로 승격**된다 → 본문 제목만 세면 항상 1개 모자라 보인다.
- `> a` / `> b` 두 줄은 Markdown 상 **한 문단**이다 → 인용 문단 수가 아니라 두 줄이 `hp:lineBreak`로 함께 남았는지를 본다.
- 코드 블록은 **표로 렌더**된다 → 데이터 표를 세려면 코드 줄(`paraPr 14`)을 포함한 표를 빼야 한다.
- TXT의 `- 항목`은 목록으로 인식돼 마커가 `·`로 바뀐다(의도된 동작) → 원문 글자가 아니라 낱말 보존을 본다.

> ⚠️ **채점 100점은 구조·값 대조 결과일 뿐 한컴 육안 확인을 대체하지 않는다.** v4.16.8의 borderFill 순서 버그는 자동 게이트 ①~⑨를 전부 통과하고도 한컴에서 틀리게 그려졌다(`hwpx_rendering_gotchas.md` 2-1절).

## 공통 원칙

- 입력 파일은 파서에서 IR(`{ title, doc_type, blocks }`)로 정규화하고, `js/hwpx.js`가 IR을 HWPX ZIP/XML로 만든다.
- 내용 누락 방지가 1순위다. 시각적 완전성보다 제목, 문단, 목록, 표, 코드, 주요 텍스트가 빠지지 않는지 먼저 확인한다.
- 포맷 카드와 결과 카드 문구는 실제 파서 품질을 과장하지 않는다. `js/app.js`의 `FORMAT_INFO`와 `getConversionSummaryForExt()`를 파서 변경과 함께 갱신한다.
- 관리자 모드의 `포맷 품질 평가` 탭은 사용자 파일 수집 통계가 아니라 golden/게이트 fixture와 현재 파서 지원 범위 기준의 추정 지표다. 숫자를 바꿀 때는 근거가 되는 fixture, 제한사항, 개선 계획을 함께 갱신한다.
- HWPX는 출력 형식이다. `.hwpx` 입력 처리는 오업로드/복구용 예외로 유지하되 기본 입력 안내에는 넣지 않는다.
- 새 시각 요소, 표 스타일, 이미지, 채우기, 폰트 관련 변경은 먼저 `hwpx_rendering_gotchas.md`를 읽고 네임스페이스와 IDRef를 확인한다.
- Pretendard GOV는 PC별 등록명이 다르므로 UI 선택값을 그대로 고정 출력하지 않는다. 변환 직전 실제 등록명을 정확히 감지해 주 글꼴로 기록하고 반대 이름을 `hh:substFont`로 둔다. 대체 글꼴만 맞으면 화면은 렌더링돼도 한컴 글꼴란이 빈칸일 수 있으므로, 주 이름이 설치명과 일치하는지까지 품질 기준으로 본다.

## 제목 정책

관련 코드: `applyDocumentTitlePolicy()` in `js/app.js`

- 문서 제목 기준은 `heading`(문서 첫 문장), `filename`(파일 이름), `custom`(직접 입력) 세 값이다.
- 기본 자동 제목 기준은 `heading`이다. 문서 첫 문장/제목 후보를 쓰고, `문서 구성`, `목차`, `개요` 같은 일반 섹션명은 제목 후보에서 제외한다.
- `filename` 옵션은 파일 이름을 제목으로 쓰는 명시적 선택이다.
- `custom` 옵션을 선택했을 때만 제목 입력칸을 표시하고, 단일 파일 변환에서만 직접 입력값을 제목으로 적용한다. 배치 변환은 파일별 자동 제목 규칙을 유지한다.
- 파서가 추출한 제목을 최상단 제목으로 쓰지 않는 경우, 의미 있는 제목 텍스트가 본문에서 사라지지 않도록 본문 heading으로 복구한다.
- DOCX는 parser title만 믿지 말고 문서 순서의 heading/paragraph 후보를 다시 본다.

## 관리자 모드와 품질 평가

관련 코드: `isAdminMode()`, `renderAdminPanel()`, `renderQualityPanel()` in `js/app.js`

- **직접 입력**은 v4.8.3부터 일반 사용자에게 베타로 공개되었다. 탭은 항상 노출되고, 탭 진입 시 품질 안내 패널이 표시된다. 미리보기 패널(`paste_preview`)과 HTML 복사·다운로드 메뉴(`html_actions`)는 v4.10.6부터 정식 공개되어 관리자 여부와 무관하게 항상 노출된다. 업데이트 내역 상세, 구현된 실험 기능 목록, 추천 실험 기능, 포맷 품질 평가는 계속 관리자 모드에서만 노출된다. `?admin=1` 또는 호환용 `?lab=1`로 관리자 모드에 들어가면 localStorage에 상태를 저장한다.
- 관리자 모드 최상단 스위치는 개별 기능 토글이 아니라 전체 사용/전체 사용 안함이다. 켜면 현재 구현된 실험 기능 기본값을 함께 켜고, 끄면 개별 기능도 모두 비활성화한다. 개별 기능은 `tohwpx_feature_*` localStorage 키로 관리한다.
- 서식 있는 입력(DOCX/HTML/XLSX/HWP 계열)은 문서 세부 설정의 `본문 서식 처리`를 `원본 우선`으로 두는 것이 기본이다. 원본 우선은 IR에 들어온 병합·색상·인라인 서식을 먼저 존중하고 앱 장식 프리셋 적용을 줄인다. 사용자가 `설정 우선`(value `app`)을 선택하면 문단·제목·표·링크·이미지 세부 프리셋을 강하게 적용한다. UI 라벨은 `원본 우선 / 혼합 / 설정 우선`이고 내부 value는 `source / balanced / app`로 고정한다(라벨 변경과 value 변경 구분).
- 업데이트 내역 모달의 탭은 `사용자 변경사항`, `개발자 변경사항`, `관리자 모드`, `포맷 품질 평가`로 분리한다.
- 관리자 모드 탭에는 관리자 모드 토글과 추천 실험 기능을 둔다. 추천 실험은 공개 사용자 기능이 아니므로 사용자가 명시적으로 공개를 승인하기 전에는 `changelog.json`의 user 항목에 쓰지 않는다.
- 포맷 품질 평가는 버전/일자별 추이를 보여주되, 원격 통계처럼 표현하지 않는다. 현재 값은 `FORMAT_QUALITY_METRICS`와 `QUALITY_HISTORY`에서 관리하며 `FORMAT_INFO.limits`를 함께 보여준다. 평가는 릴리스마다 golden/게이트 기준으로 갱신하고, 서식 보존 관련 파서·렌더러 변경 시 한컴 수동 확인을 별도로 요청한다. fixture가 늘어나거나 월 1회 점검 때 추정 수치를 다시 조정한다.
- 변환률은 원본 기능이 IR/HWPX로 의미 있게 옮겨지는 추정 비율(내용 보존도), 성공률은 오류 없이 HWPX 생성·구조 검증을 통과할 가능성(생성 안정성)이다. 둘은 다른 축이라 성공률이 높아도 변환률은 낮을 수 있다. 실측이 아니므로 UI에서는 `.quality-est-tag`(추정/추정치) 배지로 표시하고, 사용자 도움말 세부 설정 탭과 같은 문구(내용 보존도/생성 안정성)로 설명한다. 실제 사용자 파일 성공률이 필요하면 별도 익명/동의 기반 telemetry 설계가 먼저 필요하다.
- 부분 롤백을 쉽게 하려면 파서 변경, HWPX XML 생성 변경, 관리자 UI/품질 문구 변경을 커밋 메시지와 테스트에서 분리해 추적한다.

검증:

- `tests/golden.js`의 관리자 회귀는 직접 입력 탭 일반 모드 노출, `?admin=1` 미리보기·HTML 메뉴 노출, `?lab=1` 호환, 관리자 모드 토글, 추천 실험 패널, 포맷 품질 평가 탭의 핵심 문구를 확인한다.
- 품질 숫자나 개선 계획을 바꾸면 관련 포맷 fixture와 이 문서의 제한사항 설명이 같은 방향인지 확인한다.

## 직접 입력

관련 코드: `initInputMode()`, `renderPastePreview()`, `getPastePreviewIr()` in `js/app.js`

- 직접 입력은 v4.8.3부터 일반 사용자에게 베타로 공개되었다. MD/HTML/TXT/CSV/JSON 텍스트를 가상 `File`로 감싸 기존 `fileToIR()` 변환 파이프라인을 재사용한다.
- 입력 아래 미리보기는 실제 HWPX 렌더러가 아니라 변환 전 IR 해석 결과다. `parseMd()`, `parseHtml()`, `parseTxt()`, `parseCsv()`, `parseJson()`을 직접 호출하고 `irBlocksToHtml()`로 표시한다.
- 미리보기는 타이핑마다 즉시 무거운 변환을 돌리지 않고 짧은 debounce를 둔다. Markdown 원격 이미지는 미리보기 단계에서 resolve하지 않는다.
- 복사는 `원문 복사`, `미리보기 복사`, `HTML` 메뉴로 분리한다. HTML 메뉴에서는 미리보기 DOM의 정리된 HTML 조각을 `복사`하거나 간단한 독립 HTML 파일로 `다운로드`한다. 이 HTML은 HWPX 최종 XML이나 한컴 렌더링 결과가 아니다. Clipboard API가 막힌 브라우저에서는 textarea fallback을 사용한다.
- JSON처럼 형식 오류가 생길 수 있는 입력은 변환 전 미리보기 패널에서 오류를 보여주고, 실제 변환 버튼은 기존 검증/실패 카드 흐름을 유지한다.

검증:

- 직접 입력 미리보기 회귀는 Markdown 제목·문단·표가 미리보기 영역에 표시되는지, HTML 메뉴에 복사/다운로드 선택지가 있는지 확인한다.
- 파일 입력과 직접 입력의 HWPX 본문·표·링크·이미지 개수 동등성 검사는 기존 `tests/golden.js` 기준을 유지한다.

## 문서 세부 설정 옵션 매핑

관련 코드: `initOptions()`, `updateAdvancedSettingsSummary()` in `js/app.js`; `buildHeaderXml()`, `buildSection()`, `buildTable()`, `buildParaRuns()`, `buildImageRun()` in `js/hwpx.js`

목표:

- 이 옵션들(원본 서식 처리·문단 간격·제목/표/링크·이미지·첫 제목 처리)은 `문서 세부 설정` 접힘 영역 안의 `본문 서식` 하위 블록(`.document-detail-settings`)에 모여 있다. 바깥 접힘 컨테이너 이름과 구분한다.
- UI는 세그먼트 버튼(`.detail-field .seg-btn[data-seg-for][data-seg-value]`)이고, 값/state/localStorage의 단일 소스는 같은 `id`의 숨김 `<select class="sr-only">`다. 버튼 클릭은 `select.value`를 바꾸고 `change`를 디스패치하며, 활성 표시는 `syncDetailSegButtons()`가 select 값에 맞춘다(초기 로드·리셋 후 호출). 버튼 라벨은 짧게 줄여도 되지만 select의 `option` 텍스트(`큰 제목·굵게` 등)와 `value`는 변환 계약이므로 유지한다.
- `원본 서식 처리`(style-policy)는 나머지 7개 옵션의 전제이므로 그리드 밖 상위 마스터(`.detail-field--master`)로 분리한다. golden `validateDetailSettingsUx`가 마스터 분리와 `.detail-settings-grid` 밖 위치를 검사한다.
- 직접 입력 미리보기 표(`.paste-preview-doc .ir-table`)와 진단 미리보기 표는 실제 HWPX 표의 하드코딩 속성(또렷한 테두리, 머리행 가운데+굵게+음영, 숫자 셀 오른쪽 정렬)을 반영한다. 숫자 셀 판별은 `irTableToHtml()`이 `isNumericCell()`로 `.ir-cell-num`을 붙여 처리한다.
- 직접 입력(`state.inputMode==='paste'`) 변환의 출력 파일명은 가상 파일명이 아니라 제목 옵션이 반영된 `ir.title`(`sanitizeBaseName`) 기반으로 만든다. 파일 업로드는 입력 파일명을 유지한다.
- 이미지 정렬: IR `image` 블록이 자체 `align`('left'|'center'|'right')을 가지면 전역 `imageAlign` 옵션보다 우선한다(`buildImageRun`). DOCX는 이미지가 든 단락의 `w:jc`를 `docxParagraphAlign()`로 읽어 `imgBlock.align`에 보존하므로 원본 우선에서도 가운데/오른쪽 정렬이 유지된다. 전역 `imageAlign` 기본값은 가운데(`center`)다.
- `본문 서식 처리`(style-policy, 이전 '원본 서식 처리')는 상단 제목 블록 아래(advanced-main)에 둔다. 세그먼트 배선을 위해 `detail-field` 클래스를 유지하고, 그리드 밖이지만 `#style-policy`(`.sr-only`)가 값 소스다.
- `원본 우선`(stylePolicy='source')일 때는 `applyStylePolicyUi()`가 `본문 고급 서식`의 `.detail-settings-grid`를 흐리게(`.detail-grid-dimmed`) 하고 `#detail-source-note`를 띄워, 세부 설정이 원본 서식 있는 파일에서는 원본에 양보됨을 강조한다(조정 자체는 가능).
- `isAdminMode()`는 부수효과 없는 순수 read여야 한다. 과거 이 함수가 매 호출마다 `setAdminEnabled()`를 불러 `?admin=1` URL에서 기능 플래그가 계속 기본값으로 리셋돼 개별 기능 토글을 끌 수 없었다. URL 파라미터 반영은 `initAdminParam()`에서 1회만 한다. golden `?lab=1` 테스트에 기능 토글 on→off 지속 검증을 둔다.
- 가로 구분선 토글은 `본문 고급 서식`(이전 '본문 서식') 그리드 끝에 둔다. `본문 고급 서식` 도움말 aria-label도 함께 갱신한다.
- 자동 다운로드는 문서 기본 설정에서 용지 방향 바로 오른쪽에 둔다. 데스크톱은 `한글 폰트 · 글꼴 크기 · 줄 간격 · 용지 크기 · 용지 방향 · 자동 다운로드` 1행이며, 컨트롤 높이를 맞춘다. 모바일은 터치 폭을 위해 1열로 전환한다.
- 도움말 모달(`#onboarding-guide-modal`) 탭은 `사용법 · 세부 설정 · 단축키`다. `세부 설정` 탭(`#help-panel-detail`)은 이 매핑을 사용자 언어로 거울처럼 설명하고, 칩 클릭이 `#detail-demo-doc`의 `data-*`만 바꿔 CSS 목업 미리보기를 갱신한다(`initHelpDetailDemo()`). 실 HWPX 렌더러가 아니므로 효과 방향만 맞으면 된다. 옵션 라벨/효과를 바꾸면 이 탭 설명과 `data-*` 효과 규칙도 함께 갱신한다. 같은 탭에서 변환률=내용 보존도, 성공률=생성 안정성으로 풀어 쓴다.
- 자동 다운로드는 색상만으로 상태를 전달하지 않는다. 컨트롤 안에는 중복 설명 없이 `✓ 켜짐`/`○ 꺼짐`만 표시하고 배경·테두리·스위치를 함께 바꾸며, 체크박스의 접근성 이름도 현재 상태와 동기화한다.
- UI 라벨은 사용자가 예상하는 결과 중심으로 쓴다. 예를 들어 `prominent`는 "강조"가 아니라 `큰 제목·굵게`, `report`는 "보고서형"이 아니라 `머리행 음영`처럼 실제 출력 변화를 드러낸다.
- 옵션의 `value`는 저장값/localStorage/HWPX 생성 계약이므로 라벨만 바꿀 때는 `value`를 바꾸지 않는다.
- 세부 설정을 바꿨는데 HWPX XML이 변하지 않는 회귀를 막기 위해 UI 라벨, `state`, `buildHwpx()` 옵션 전달, XML 검증을 한 묶음으로 본다.

옵션별 계약:

| UI 항목 | UI 라벨/값 | 내부 값 | HWPX 반영 |
| --- | --- | --- | --- |
| 문단 앞/뒤 간격 | 간격 작게 / 기본 간격 / 간격 크게 | `compact` / `normal` / `relaxed` | `hh:paraPr`의 `hh:prev`, `hh:next` 값. 기본은 본문 아래 `850`, 제목 앞 `850`, 제목 뒤 `567`; 작게는 본문 아래 `283`; 크게는 본문 아래 `1134`, 제목 앞 `1134`, 제목 뒤 `850`. |
| 제목 스타일 | 작은 제목 / 기본 제목 / 큰 제목·굵게 | `compact` / `standard` / `prominent` | `hh:charPr` 제목 크기. 기본 글꼴 pt 기준 H1은 `+4/+6/+8pt`, H2는 `+3/+4/+6pt`, H3는 `+1/+2/+3pt`; 제목은 기본적으로 bold. |
| 표 스타일 | 기본 테두리 / 단순 테두리 / 머리행 음영 | `standard` / `plain` / `report` | `buildTable()`의 머리행 처리. `plain`은 머리행 bold/음영을 끄고, `report`는 머리행에 `EAF2FF` 배경 borderFill을 추가한다. 모든 표는 격자·병합·제목 행 반복 무결성을 유지해야 한다. |
| 링크 표시 | 파란색+밑줄 / 검정 본문 / 텍스트+주소 | `blue` / `plain` / `url` | `buildParaRuns()`의 HYPERLINK 필드는 유지한다. `blue`는 동적 charPr로 파란 밑줄, `plain`은 일반 본문처럼 표시, `url`은 표시문자 뒤에 ` (URL)`을 붙인다. |
| 이미지 최대 폭 | 본문의 50% / 75% / 본문 폭까지 | `50` / `75` / `100` | `buildImageRun()`의 `hp:curSz` 폭을 본문 폭 기준으로 제한한다. 원본 비율을 유지하며 0 또는 본문 폭 초과가 나오면 안 된다. |
| 이미지 정렬 | 왼쪽 정렬 / 가운데 정렬 / 오른쪽 정렬 | `left` / `center` / `right` | 그림 위치의 `horzAlign`을 LEFT/CENTER/RIGHT로 기록한다. |
| 첫 제목 본문 처리 | 본문 첫 제목 제거 / 본문 첫 제목 유지 | `remove` / `keep` | `applyDocumentTitlePolicy()`에서 자동 제목으로 쓴 첫 heading을 본문에서 제거하거나 유지한다. parser가 이미 title을 선점한 경우에도 같은 정책을 적용한다. |
| 가로 구분선 | 숨김 / 표시 | `showHorizontalRules=false/true` | 숨김은 `paraPr id=9` 빈 줄, 표시는 `buildHrPara()` 구분선 표. 옵션 자체를 제거하지 않는다. |
| 페이지 여백 | 위/아래/왼쪽/오른쪽/머리말/꼬리말 mm | `pageMargins` | `marginsMmToHwp()`로 HWPUNIT 변환 후 `hp:pagePr`와 내용 폭 계산에 반영한다. 미니맵은 실제 mm 비율에 맞춰 상하좌우 라벨과 본문 영역을 표시한다. |

검증:

- `tests/golden.js`의 `validateDetailSettingsUx()`는 세부 설정 컨트롤 존재, 결과 중심 라벨, 구분선 숨김/표시 XML, 여백 미니맵 라벨, 문단 간격/제목/표/링크/이미지/첫 제목 정책의 HWPX 반영을 함께 확인한다.
- 세부 설정을 추가하거나 `value`를 바꾸면 `state`, localStorage key, reset 기본값, `buildHwpx()` 옵션 객체, changelog, 이 표, golden 검증을 동시에 갱신한다.
- UI 라벨만 바꾸는 경우에도 사용자가 보는 라벨과 `updateAdvancedSettingsSummary()` 문구가 같은 의미인지 확인한다.

## Markdown

관련 코드: `parseMd()`, `extractMarkdownTokens()`, `markdownInlineRuns()`, `processMdInlineBlocks()`, `resolveMarkdownAssets()` in `js/parsers.js`; `buildParaRuns()`, `buildImageRun()` in `js/hwpx.js`

목표:

- 현재 가장 안정적인 구조형 입력이다.
- 제목, 문단, 목록, 표, 코드블록, 인용구, 클릭 가능한 본문 링크와 해결 가능한 이미지를 안정적으로 HWPX로 옮긴다.

보존:

- H1-H6 제목
- 문단과 빈 줄
- 순서/비순서 목록, 중첩 목록, task list
- GFM 표와 머리행
- 코드블록, 인라인 코드
- bold/italic/strike 일부와 엔티티(`&`, `<`, `>`, quotes)
- 인용문(왼쪽 강조선+옅은 배경)과 수평선

주의:

- `marked.lexer()` 경로가 우선이다. 실패하면 HTML 파서로 폴백한다.
- marked가 구두점 인접 강조를 놓치는 경우가 있어 `splitInlineEmphasis()` 보정이 있다.
- 작은따옴표(`'`)는 `hp:t` 본문에서 `&apos;`로 바꾸지 않고 문자 그대로 출력한다. XML 문법상 안전하며, 한컴에서 `&apos;`가 표시되지 않는 회귀를 막기 위한 처리다.
- Markdown 입력의 HTML 엔티티 작은따옴표(`&#39;`, `&apos;`)는 일반 문단뿐 아니라 강조·목록·표에서도 문자 `'`로 복원한다. `marked` 목록 토큰의 `item.text` fallback과 하위 `text` 토큰도 반드시 `decodeMdEntities()`를 거쳐야 하며, 한 경로라도 빠지면 목록에서만 엔티티가 그대로 노출된다.
- 일반 문장 안의 인라인 코드(`codespan`)는 문단을 끊지 않고 `code:true` 런으로 출력한다. 문단 전체가 단일 인라인 코드인 경우에만 기존 코드 블록(표) 표현을 유지한다.
- `marked`의 `link` 토큰은 표시 문자열과 `href/title`을 분리해 공통 run IR로 보존한다. 링크와 `strong/em/del`이 중첩되어도 재귀 run 변환으로 두 속성을 함께 유지한다.
- 클릭 가능한 URL은 `http:`, `https:`, `mailto:`만 허용한다. 위험하거나 잘못된 URL은 표시 문자열만 남긴다.
- HWPX 링크는 `hp:fieldBegin type="HYPERLINK"` → 표시 문자열 run → 같은 `id/fieldid`의 `hp:fieldEnd` 순서다. `Command`와 `Path`를 모두 기록하고 XML escape를 적용한다.
- 인용구는 `quote` IR → HWPX `paraPrIDRef="19"`로 출력한다. 예전처럼 `▶` 텍스트를 붙이면 안 된다.
- Markdown 이미지 토큰은 먼저 `image-source`로 만들고 `fileToIR()` 뒤 `resolveMarkdownAssets()`에서 최종 `image` IR로 바꾼다. `parseMd()`는 IPYNB 재사용을 위해 동기로 유지한다.
- data URL과 CORS가 허용된 HTTP(S) PNG/JPEG/GIF/BMP를 지원한다. 이미지별 8MB, 문서 합계 20MB, 요청 10초 제한을 적용한다.
- 상대경로·CORS 차단·지원하지 않는 형식은 전체 변환을 실패시키지 않고 alt/주소가 포함된 fallback 문단과 `assetWarnings`로 남긴다.
- 원격 이미지는 이미지 원본 서버에 브라우저가 직접 요청한다. 원본 MD/HWPX는 전송하지 않지만 개인정보 안내에 이 예외를 명시한다.
- 목록 항목은 `text`와 `runs`를 함께 보존하며 marker 뒤에 `buildParaRuns()`로 출력한다. `flattenMdList()`에서 `plainMdText()`만 남기면 목록 링크 URL이 다시 사라진다.
- Markdown 표 셀은 평문이면 기존 문자열 IR을 유지하고, bold/italic/code/strike가 있으면 `{text,runs}` 셀로 승격해 인라인 서식을 보존한다. 내부 링크·이미지는 아직 표시 텍스트 중심이며, 활성 링크나 그림까지 확장할 때는 공용 cell run 계약을 별도로 설계한다.
- 이미지 URL 자리에 `[URL](URL)`이 중첩된 입력은 실제 URL을 자동 추출한다. 올바른 원문은 `![대체 텍스트](https://.../image.jpg)`이다.
- CORS로 바이너리를 읽을 수 없는 원격 이미지는 정적 브라우저 앱에서 임베딩할 수 없다. 이 경우 실패 이유와 클릭 가능한 `원본 이미지 열기` 링크를 남긴다.

검증:

- `tests/fixtures/sample.md`
- 코드블록, 목록, 표, 인용구, 한글/영문 혼합, 특수문자가 `section0.xml`에 남는지 본다.
- 작은따옴표 회귀는 일반 문장·인라인 강조의 원문 `'`와 입력 엔티티 `&#39;`가 문단·강조·목록·표 모두에서 문자 `'`로 남는지 확인한다. `section0.xml`에는 `&apos;`, `&#39;`, `&amp;#39;`가 없어야 한다.
- 인라인 코드는 앞뒤 텍스트와 같은 `hp:p` 안에서 코드용 `charPrIDRef="6"` 런으로 남고, 단독 코드 문단은 코드 블록 표로 유지되는지 확인한다.
- 인용구 회귀는 `section0.xml`에 `paraPrIDRef="19"`가 있고 `▶ Quoted Alpha line`이 없어야 한다.
- 링크 회귀는 `fieldBegin/fieldEnd`의 `id/fieldid` 쌍, `Path` URL의 `&amp;` escape, 위험 URL 부재를 검사한다.
- 목록 링크 회귀는 일반 문단 링크와 별도로 `item.runs`가 남고 HWPX 링크 필드 개수가 증가하는지 검사한다.
- 표 셀 회귀는 `**굵게**`와 인라인 코드가 각각 굵게/코드용 `charPrIDRef` run으로 표 내부에 남는지 검사한다.
- 중첩 이미지 링크 문법은 `normalizeMarkdownImageSource()`가 실제 URL을 반환하고, CORS 실패 fallback의 run에 해당 URL `href`가 남는지 검사한다.
- 이미지 회귀는 `hc:img → content.hpf item → BinData → package manifest` 4단 연결과 MIME/고유 binName을 검사한다.
- `tests/fixtures/sample.md`, `qa/fixtures/md_link_image_test.md`, `npm run test:golden`, `node qa/gate.js qa/fixtures/md_link_image_test.md`를 함께 실행한다.
- Markdown 파서 변경은 IPYNB Markdown 셀에 전파되므로 `tests/fixtures/sample.ipynb` 회귀를 함께 확인한다.

## HTML

관련 코드: `parseHtml()`, `extractInlineRuns()`, `elementToTable()` in `js/parsers.js`

목표:

- 웹 화면 복제가 아니라 문서 구조 추출이다.

보존:

- `h1`-`h6`, `p`, `ul`, `ol`, `li`, `table`
- 들여쓴 중첩 `ul/ol`의 항목 레벨과 `table`의 `rowspan/colspan`
- `blockquote`(Markdown 인용구와 같은 HWPX 인용 문단)
- `strong`, `em`, `code`, `u`, `ins`, `s`, `strike`, `del`
- 일부 글자색(`style="color:"`, `<font color>`)
- (v4.16.12) `<li>` 항목의 인라인 서식과 링크 — `extractHtmlList()`가 `textContent`만 담아 목록 안의 굵게·기울임·글자색·링크가 통째로 사라졌다. Markdown 목록과 같은 공통 run 계약(`{text, runs}`)으로 함께 보존한다. **표 셀 안 링크는 여전히 미지원** — `hwpx.js`의 `buildCellBlockContent()`가 `href: undefined`로 명시적으로 끈다(공용 cell run 계약 설계 후 별도 릴리스).
- (v4.16.10) `<a href>` 링크 — Markdown `link` 토큰과 같은 공통 run 계약(`href`/`title`)으로 보존해 HWPX 하이퍼링크 필드로 나간다. 허용 스킴은 `http:`, `https:`, `mailto:`, `#`이고 그 외는 표시 문자열만 남는다(IR 레벨 차단 + `hwpx.js`·preview 각자 재검증). 이전엔 `extractInlineRuns()`가 `<a>`를 일반 인라인 요소로만 훑어 **링크가 죽은 텍스트로만 남았다.**

주의:

- CSS 레이아웃, 반응형 배치, 클래스 기반 디자인은 보존하지 않는다.
- `script`, `style`, `head`, `nav`, `footer`, `aside` 등 비본문 요소는 건너뛴다.
- 이미지, SVG, 외부 리소스는 안내상 제외 가능으로 둔다.
- 직접 입력에서 HTML 버튼은 HTML 소스 코드를 붙여넣는 용도다. 입력 형식은 버튼 UI로 고르며 내부 값은 `#paste-format`과 `tohwpx_pasteFormat`에 동기화한다. 웹 화면에서 복사해 태그 없이 들어온 일반 텍스트는 MD나 TXT로 붙여넣도록 탭 안내 패널에서 안내하며, HTML 파서도 태그 없는 텍스트를 빈 문서 대신 문단으로 보존한다.
- HTML 변경 후에는 Markdown fallback 경로도 같이 깨지지 않았는지 확인한다.

검증:

- `tests/fixtures/sample.html`
- 제목/문단/중첩 목록/병합 표 텍스트와 namespace, 굵게·기울임·밑줄·취소선·글자색을 확인한다.

## TXT

관련 코드: `parseTxt()` in `js/parsers.js`

목표:

- 서식보다 원문 텍스트 보존을 우선한다.

보존:

- 원문 텍스트
- 줄바꿈과 빈 줄 기반 문단
- 한글/영문/특수문자
- UTF-8(BOM 포함), UTF-16 BOM, EUC-KR(CP949) 디코딩

주의:

- 표, bold처럼 원본에 근거가 없는 서식은 추정하지 않는다. 표처럼 보이는 텍스트도 일반 문단으로 처리될 수 있다.
- 다만 `parseTxt()`는 **원문에 표기가 있는 것만** 가볍게 인식한다: `#`~`######` 제목(첫 H1은 문서 제목으로 승격), `- `/`* `/`+ `/`1. `로 시작하는 줄의 목록, ```` ``` ```` 코드 블록. 목록으로 인식된 줄은 마커가 `·`(또는 번호)로 바뀌므로 원문의 `-` 문자 자체는 남지 않는다 — 낱말은 전부 보존된다. `tests/golden.js`의 `txt-utf8`/`txt-euckr`가 이 동작을 고정한다.
- 인코딩 감지는 앱 로딩 경로와 함께 확인한다.

검증:

- `tests/fixtures/sample.txt`, `tests/fixtures/sample-euckr.txt`
- UTF-8/EUC-KR의 제목·문단·목록·한글이 동일하게 HWPX에 남는지 확인한다.

## CSV / XLSX

관련 코드: `parseCsv()`, `csvToRows()`, `parseXlsx()` in `js/parsers.js`; `buildTable()` in `js/hwpx.js`

목표:

- 데이터 표의 행/열과 셀 텍스트를 HWPX 표로 안정적으로 옮긴다.

보존:

- CSV 전체 데이터
- XLSX 첫 번째 시트
- 첫 행 머리글
- 빈 셀, 긴 텍스트, 숫자/텍스트 값
- 기본 표 테두리와 머리행 스타일

주의:

- XLSX는 CVE-2023-30533/CVE-2024-22363 수정 버전인 SheetJS 0.20.3 고정 파일을 사용한다. `js/xlsx-worker.js`의 Web Worker에서 첫 시트를 CSV로 바꾼 뒤 CSV 파서를 재사용해 악성 입력이 UI 스레드를 장시간 막지 않게 한다.
- XLS/XLSX 입력은 최대 20MB, 첫 시트 최대 20,000행·256열·2,000,000셀, 작업자 실행 15초로 제한한다. 한도 초과는 일부를 조용히 자르지 않고 오류와 CSV 대안을 안내한다.
- 직접 입력의 CSV 모드는 쉼표 CSV와 Excel·Google Sheets에서 복사한 탭 구분 표(TSV)를 따옴표 밖 구분자 개수로 자동 판별한다.
- 행마다 열 수가 다르면 가장 넓은 행에 맞춰 빈 셀을 보충해 HWPX 표 격자 불일치를 막는다.
- 여러 시트, 차트, 이미지, 셀 병합, 색상, 폰트, 세부 서식은 보존 대상이 아니다.
- 수식 자체가 아니라 계산된 표시 값 중심으로 안내한다.
- 표 폭/열 너비 변경은 HWPX 렌더링에 민감하므로 `buildTable()`의 grid/rowSpan/colSpan 무결성을 확인한다.
- 일반 데이터 표는 `pageBreak="TABLE"`(여러 쪽 지원: 나눔), `treatAsChar="0"`(글자처럼 취급 해제), `flowWithText="1"`로 출력한다. 단 기준 오른쪽 정렬은 배치만 바꾸며 행 높이·열 너비·병합 계산에는 관여하지 않는다.
- 일반 데이터 표와 코드 블록 표의 `hp:outMargin` 아래쪽은 `mmToHwp(3)`(XML 값 850, 약 3mm)로 둬서 다음 본문 블록과 시각적으로 분리한다. 인용구는 표가 아니므로 `paraPr id=19`의 `hh:next=850`으로 같은 아래 간격을 적용한다. 구분선(`hr`)은 가로 구분선 옵션이 숨김이면 `paraPr id=9` 빈 줄로 대체하고, 표시이면 `buildHrPara()` 구분선 표로 출력한다. 셀 내부 여백인 `hp:cellMargin`과 혼동하지 않으며, 표지에는 일괄 적용하지 않는다.
- 제목 줄 자동 반복은 표의 `repeatHeader="1"`만으로 부족하다. 첫 행의 모든 실제 셀을 `header="1"`로 함께 지정해야 한다.

검증:

- `tests/fixtures/sample.csv`
- `tests/fixtures/long-table.csv`
- `tests/fixtures/sample.xlsx`
- `tests/golden.js`의 손상 XLSX worker 거부 및 20MB 초과 사전 차단
- `qa/vendor-integrity.json`의 SheetJS 0.20.3 SHA-256과 `qa/commercial-gate.js`의 취약 URL 재유입 검사
- `tests/golden.js` 직접 입력 회귀: MD/HTML/TXT/CSV/JSON 파일 입력과 직접 입력 HWPX 본문·표 개수 동등성, TSV 표 생성, 태그 없는 HTML 텍스트 보존
- 빈 셀, 열 개수, 긴 텍스트, 표 존재 여부를 본다.
- 일반 표의 `pageBreak="TABLE"`, `repeatHeader="1"`, `treatAsChar="0"`, 단 오른쪽 정렬, `hp:outMargin@bottom="850"`, 첫 행 제목 셀 지정을 XML로 검사한다. 한컴에서는 짧은 표 뒤 3mm 간격과 긴 표의 실제 쪽 나눔·제목 줄 반복을 함께 확인한다.

## JSON

관련 코드: `parseJson()`, `jsonToBlocks()` in `js/parsers.js`

목표:

- 데이터 구조를 사람이 읽기 쉬운 문단/목록/표 형태로 펼친다.

보존:

- 객체 key/value
- 배열 값
- 배열 안 객체 구조의 표 변환
- IR 형식 JSON 직접 변환
- IR 직접 입력의 runs/items/table/quote 내부 XML 금지 제어문자 재귀 정규화

주의:

- 보고서형 편집 레이아웃을 자동 설계하지 않는다.
- 깊은 중첩은 길게 펼쳐질 수 있다.
- 데이터 타입의 의미, 원본 들여쓰기, JSON formatting 자체는 보존 목표가 아니다.
- 안내 문구에서 JSON을 “문서 품질 높음”처럼 표현하지 않는다. 값 보존과 가독성 중심이다.

검증:

- `tests/fixtures/sample.json`
- `tests/fixtures/sample-ir.json`
- 제목/문단/표 텍스트 누락이 없는지 확인한다.
- 객체 배열의 열/행 표와 IR 내부 제어문자 제거 후 XML well-formed를 확인한다.

## IPYNB

관련 코드: `parseIpynb()` in `js/parsers.js`

목표:

- 실행 가능한 노트북 복제가 아니라 읽는 문서화다.

보존:

- markdown cell: Markdown 파서 재사용
- code cell: 일반 문단이 아닌 등폭 코드블록 표
- text output: 문서 본문으로 포함. `stream`은 `out.text`, `execute_result`·`display_data`는 `out.data['text/plain']`(없으면 `text/html`)에 값이 들어간다 — v4.16.10 이전엔 `out.text`만 읽어 **셀 결과값(노트북에서 가장 흔한 출력)이 통째로 사라졌다.**
- image output(`image/png`, `image/jpeg`): base64 디코드 → `sniffRasterImage()`로 픽셀 크기 확인 → `imageSizeHwp()`로 HWP 단위 변환 → 공통 image IR 블록으로 변환(v4.10.7~)

주의:

- 차트 라이브러리의 인터랙티브·위젯 출력, LaTeX 수식, 실행 상태, metadata는 보존하지 않는다.
- 첫 markdown 제목은 문서 제목 후보가 될 수 있다.
- Markdown 파서 변경 시 IPYNB markdown cell도 함께 확인한다.
- **binName 충돌 주의**: markdown cell 이미지는 `resolveMarkdownAssets()`가 `image1.png`부터 별도로 번호를 매긴다. 코드 출력 이미지가 같은 `image${n}` 접두사를 쓰면 같은 문서 안에서 binName(=BinData 파일명/manifest id)이 겹쳐 한쪽 그림이 조용히 사라진다. 그래서 코드 출력 이미지는 `ipynb-out${n}.ext` 접두사를 쓴다.

검증:

- `tests/fixtures/sample.ipynb`(markdown cell 이미지 1개 + code output 이미지 1개 모두 포함)
- markdown/code/output text가 구분되어 누락 없이 들어가는지, `<hc:img>`가 2개(마크다운 이미지 + 출력 이미지) 생성되는지 본다.

## DOCX

재현도 채점: `node tests/tmp-real-docx-check.js`(실제 원본으로 HWPX 생성 → `tests/section0-real.xml`·`tests/header-real.xml`) 후 `node tests/docx-fidelity-score.js <원본.docx>`. 원본 OOXML과 생성 HWPX를 18개 항목(텍스트 완전성·표 구조·문단·줄바꿈·그림·링크·셀 배경·문단 배경·글자 색/배경/서식/크기·셀 병합·정렬·페이지 설정·열 너비·각주)으로 대조해 100점 만점으로 채점하고 미달 근거를 출력한다. **구조 게이트가 못 보는 "값은 맞는데 안 보임"은 여전히 사람 눈으로만 잡힌다** — 채점 100점은 한컴 육안 확인을 대체하지 않는다.

관련 코드: `auditAndNormalizeDocxXml()` in `js/docx-audit.js`; `parseDocx()`, `extractDocxParagraph()`, `extractDocxTable()`, `extractDocxImage()` in `js/parsers.js`; image/table/footnote paths in `js/hwpx.js`

목표:

- Word 화면을 픽셀 단위로 복제하지 않고, 입력 결함을 설명하면서 페이지·타이포그래피·본문 구조를 계수 가능한 형태로 HWPX에 재구성한다.

보존:

- 문서 순서 기준 heading/paragraph 후보
- 문단, 일부 정렬(center/right/justify)
- bold, italic, underline, strike, text color, highlight, 탭, 수동 줄바꿈
- 원본 페이지 크기·방향·여백과 styles.xml의 기본 글자 크기·줄 간격
- (v4.16.3) 제목(heading) 글자색 — 1순위 직접 run의 `w:color`, 2순위 해당 문단 스타일 자체의 `w:rPr/w:color`(styles.xml). Word 제목 스타일은 색을 run마다 반복하지 않고 스타일 정의에만 두는 경우가 많아, 이전엔 직접 run 색이 없는 제목은 전부 검정으로 나왔음. 제목 스타일의 왼쪽 테두리(`w:pBdr`)는 아직 미지원 — 글자색만 옮겨진다.
- (v4.16.5) 문단 배경(`w:pPr/w:shd@w:fill`, 표 셀이 아닌 문단 자체 음영) — "쉽게 말하면"류 콜아웃 박스가 흔히 쓰는 방식. 색상별로 동적 `paraPr`/`borderFill`을 만들어 인용구(quote)와 같은 왼쪽 강조선+배경 박스로 렌더한다(왼쪽 선 색은 고정 `#64748B`, 배경만 원본 색 사용). 원본에 테두리(`w:pBdr`)가 없는 문단 배경만 대상이며, 감지된 배경이 있는 문단은 목록 항목(`_list_item`)이거나 문서 제목(`docTitle`)이 아닌 경우에만 감싼다. 여러 문단에 걸친 콜아웃을 하나로 묶는 기능은 없음(원본이 이미 한 문단인 경우가 대부분).
- (v4.16.9) **스타일 상속** — `w:rStyle`(문자 스타일)과 문단 스타일의 `w:rPr`이 정의하는 굵게·기울임·밑줄·취소선·글자색·글자 배경·글자 크기를, run에 직접 지정이 없을 때 물려받는다. 우선순위는 `run 직접 > w:rStyle > 문단 스타일`이고 `w:basedOn` 체인을 따라간다(순환은 방문 집합으로 차단). 이전엔 `w:rStyle`을 아예 읽지 않아, 서식을 스타일에만 둔 run(실제 원본의 콜아웃 라벨 스타일 `lbl2` = 굵게+`#8A5A08`, 214개 run)이 통째로 서식 없는 검은 글자로 떨어졌다. 채점기는 "본문에서 실제로 참조되는" 스타일만 대상으로 한다 — 정의만 있고 쓰이지 않는 스타일(예: `none1`)까지 요구하면 재현 대상이 없는데 감점되는 오탐이 된다.
- (v4.16.9) **run별 글자 크기(`w:sz`)** — 이전엔 전부 무시하고 문서 기본 크기 하나로 렌더했다. 실제 원본은 본문이 7.5/8/8.5/9/9.5/10.5pt로 촘촘히 나뉘어 있어(4만여 run) 전 문서가 잘못된 크기로 나왔다. `run.sizePt` → charPr `height`(1pt=100 HWPUNIT)로 옮기며, 본문 기준 크기와 다를 때만 동적 charPr을 만든다(`_runBaseHeightHwp`).
- (v4.16.9) **제목 안 인라인 배지** — 제목은 통짜 문자열로 렌더하므로 제목 안의 배경색 run(예: 초록 `#16A34A` 위 흰 글자 "신규")이 통째로 사라졌다. 배지(`highlight` 있는 run)가 있는 제목만 `runs`를 함께 넘겨 run별로 렌더한다(`block._runs`). 배지가 없으면 기존 단일 charPr 경로를 그대로 쓴다.
- (v4.16.9) **이모지** — 본문 글꼴에 이모지 글리프가 없어 예전엔 `□`로 치환했다(정보 손실). 이제 각 `hh:fontface`에 `Segoe UI Emoji`(대체 `Segoe UI Symbol`)를 추가 등록하고, 이모지 구간만 그 폰트를 참조하는 별도 run으로 떼어낸다. 같은 서식의 "이모지 변형" charPr을 `customCharMap`에 함께 등록하므로 **크기·색은 주변 글자와 동일하게 유지**된다(`extCharKey`의 5번째 필드 `E`). Variation Selector/ZWJ는 한컴이 별도 글자로 그리므로 제거한다. `buildParaRuns` 경로에만 적용되며, 통짜 문자열로 나가는 `buildPara`(머리글/바닥글 등)는 여전히 `□` 폴백이다.
- (v4.16.9) **글자 없는 `w:pBdr` 문단 → `hr`** — 위/아래 테두리만 있고 내용은 2pt 공백뿐인 문단은 Word의 가로 구분선 표현이다. 이전엔 텍스트가 없어 `null`로 버려져 구분선이 사라졌다. 이제 `hr` 블록으로 살린다(가로 구분선 옵션이 숨김이면 빈 줄).
- 표 전체 폭·열 비율·정렬·셀 여백·행 높이·머리행 반복·수직 정렬
- 기본 표, 가로/세로 병합, 셀 배경색(순검정 `000000` 포함 — v4.16.1부터. 이전엔 검정을 "배경 없음"으로 오판해 그 위 흰 글자가 안 보였음), 셀 글자색 일부
- (v4.16.1) 셀 배경이 감지되지 않은 표 셀과 표 밖 문단에서 강조 표시(`w:highlight`) 없는 흰 글자(`#FFFFFF`)는 안전하게 기본색(검정)으로 대체함 — Word의 배경 없는 흰 글자는 화면에서 특수 테마·인쇄 조건에서만 보이거나 사실상 실수인 경우가 많고, HWPX는 흰 배경이 기본이라 그대로 옮기면 육안으로 안 보임. 표 셀 배경이 있거나 강조 표시가 있는 흰 글자는 그대로 보존한다. 표 스타일(`w:tblStylePr`) 기반 조건부 셀 음영은 아직 지원하지 않음 — 직접 `w:tcPr/w:shd`가 없는 셀은 여전히 배경 없음으로 처리된다.
- 셀 안의 여러 문단, 목록, 중첩 표, 그림 순서
- PNG/JPG/GIF/BMP 본문 이미지
- 각주 텍스트
- 주석(`word/comments.xml`, v4.10.28~) — `w:commentReference`를 만나면 `run.footnote`와 같은 필드에 `[주석] 작성자: 내용`으로 삽입해 기존 각주 렌더 경로를 그대로 재사용한다. `commentRangeStart/End`(하이라이트 범위)는 다루지 않고 앵커 위치만 사용한다.
- 첫 머리글/바닥글 텍스트(현재는 문서 전체에서 첫 번째로 발견된 관계만 사용 — 섹션별/첫 페이지 전용 머리글 구분은 아직 없음)

주의:

- DOCX는 ZIP + OOXML이다. `word/document.xml`, 관계 파일, `word/media`, styles, footnotes, comments, header/footer를 함께 본다.
- 파싱 전 감사는 `undefined`/`null`/`NaN` 리터럴 속성, 소수 twip, 최종 `sectPr` 위치, 알려진 자식 순서를 계수한다. 텍스트 삭제나 임의 레이아웃 추론은 자동 복구하지 않는다.
- 변경 추적의 삭제·이동 전 텍스트는 제외한다. 외부 관계는 안전한 URL 정책을 통과한 링크만 활성화한다.
- WMF/EMF, 복잡한 drawing, style theme, 섹션별 레이아웃 전환은 손실 가능으로 안내한다. Word와 한컴의 줄·표 나눔 엔진이 다르므로 총 페이지 수는 동일성을 보증하지 않는다.
- 목록 번호는 문서마다 XML 차이가 커서 변경 시 반드시 fixture를 추가한다.
- 이미지 추가/수정은 `content.hpf` item id, manifest, `BinData` 파일, `hc:img@binaryItemIDRef`가 모두 맞아야 한다.
- 표 병합은 HWPX에서 조용히 깨질 수 있다. row/col span 무결성과 borderFill ID를 검사한다.
- 주석과 각주는 HWPX 안에서 구분되지 않는다(둘 다 같은 각주 필드로 나온다) — "각주가 늘었는데 원본엔 없었다"는 피드백을 받으면 comments.xml 여부부터 확인한다.

검증:

- `tests/fixtures/sample.docx`, `qa/fixtures/docx_table_test.docx`, `qa/fixtures/docx_image_test.docx`, `tests/fixtures/docx-fidelity.docx`
- `npm run test:impact`, `npm run test:docx`, `npm run test:golden`
- 고충실도 하네스는 표·행·셀 exact, 문단 97% 이상, 줄바꿈 입력 이상, 페이지 크기·방향·여백 exact, 잘못된 리터럴 부재를 검사한다.
- 릴리스 후보는 `qa/hwp-export-pdf.ps1`로 한컴 PDF를 만들고 `qa/render-pdf-contact-sheets.py`로 모든 페이지를 렌더한다. 이미지/색/병합/머리글/각주(주석 포함), 빈 페이지·잘림·누락은 contact sheet와 한컴에서 수동 확인한다.

## PPTX

관련 코드: `parsePptx()`, `parsePptxSlideItems()`, `collectPptxSpTreeItems()`, `extractPptxTable()`, `extractPptxImage()`, `extractPptxNotesText()` in `js/parsers.js`

목표:

- 슬라이드 디자인(도형 위치·애니메이션)을 재현하지 않고, 슬라이드의 텍스트·표·그림을 순서대로 읽는 문서로 정리한다(v4.10.8 텍스트, v4.10.10 표/그림, v4.10.12 그룹 도형 재귀).

보존:

- 슬라이드 순서(`ppt/presentation.xml`의 `p:sldIdLst` + `ppt/_rels/presentation.xml.rels`로 확정, 실패 시 `slideN.xml` 파일명 숫자 정렬로 폴백)
- 슬라이드 안 `p:spTree`를 `collectPptxSpTreeItems()`가 도형 등장 순서대로 순회한다. `p:sp`/`p:graphicFrame`/`p:pic`를 변환하고, **`p:grpSp`(그룹 도형)를 만나면 재귀로 내부까지 펼쳐서** 그룹 안 텍스트·표·그림도 누락 없이 처리한다.
- 제목 placeholder(`p:ph type="title"`/`"ctrTitle"`) → heading
- 글머리 기호(`a:buChar`/`a:buAutoNum`, `a:buNone` 없음)가 있는 문단 → list, 없으면 para
- `p:graphicFrame`의 `a:tbl`(DrawingML 표) → 공통 IR table 블록. `a:tc`의 `gridSpan`/`hMerge`/`vMerge`로 가로/세로 병합을 재구성한다.
- `p:pic`의 `a:blip@r:embed` → 슬라이드 rels(`ppt/slides/_rels/slideN.xml.rels`)로 실제 `ppt/media/...` 경로를 찾아 공통 IR image 블록으로 변환(PNG/JPG/GIF/BMP, WebP는 PNG로 변환). 크기는 `a:ext`(EMU) ÷127, 없으면 픽셀 크기로 보정.
- 발표자 노트(v4.10.30~) — `extractPptxNotesText()`가 슬라이드 rels에서 `.../relationships/notesSlide` 관계를 찾아 `ppt/notesSlides/notesSlideN.xml`을 열고 `a:t` 텍스트를 모두 이어붙인다. 슬라이드 본문 뒤에 `[발표자 노트] ...` 문단으로 추가(슬라이드에 표시되는 내용과 구분되게 접두사 유지). 슬라이드 본문(`items`)이 하나도 없는 빈 슬라이드는 통째로 건너뛰므로 그런 슬라이드의 노트는 함께 누락된다 — 알려진 스코프 제한.
- 슬라이드마다 "슬라이드 N" heading으로 구분

주의:

- PPTX는 ZIP + OOXML이다(DOCX와 같은 계열이지만 `ppt/` 네임스페이스와 `p:`/`a:` 접두사를 쓴다).
- **PPTX 표는 DOCX와 병합 표현이 다르다**: DOCX(`w:tbl`)는 가로 병합을 `gridSpan`으로 압축해 셀 자체가 줄어들지만, PPTX(`a:tbl`)는 병합된 칸도 각 열마다 `hMerge="1"`/`vMerge="1"` placeholder `a:tc`를 그대로 둔다. 그래서 `extractPptxTable()`은 논리열 인덱스를 raw cell 개수만큼 그대로 증가시키고, DOCX처럼 colSpan만큼 건너뛰지 않는다.
- **그룹 도형을 빠뜨리기 쉽다**: `p:spTree`의 직계 자식만 보면 `p:grpSp` 안의 텍스트박스·표·그림이 조용히 사라진다(실제 발표자료에서 매우 흔한 구조). 새 도형 종류를 추가할 때도 `collectPptxSpTreeItems()`를 거치는지 확인한다.
- 그룹 도형 내부를 제외한 일반 도형(텍스트 상자·표·그림 제외), 애니메이션, 슬라이드 디자인/레이아웃은 다루지 않는다. WMF/EMF 벡터 이미지는 alt 텍스트가 있으면 안내 문단으로 대체한다.
- `extractPptxNotesText()`의 상대경로 정규화(`../notesSlides/notesSlideN.xml` → `ppt/notesSlides/notesSlideN.xml`)는 세그먼트 단위 `..`/`.` 처리를 직접 구현한다(Node 환경이 아니라 `path.resolve`를 못 쓰므로). 새 상대경로 해석이 필요한 곳이 생기면 이 패턴을 재사용한다.
- `p:sldId`의 `r:id`, `p:pic`의 `a:blip@r:embed`는 모두 `DOCX_NS_R`(officeDocument relationships 네임스페이스)로 읽는다. `getAttributeNS(DOCX_NS_R, 'id'/'embed') || getAttribute('r:id'/'r:embed')` 패턴을 DOCX와 동일하게 유지한다.
- 이미지 binName은 `pptx-img${n}`을 쓴다(다른 포맷과 접두사가 겹치지 않게).
- `js/app.js`의 `getConversionSummaryForExt()`도 `FORMAT_INFO.pptx`와 같은 말을 하는지 반드시 함께 확인한다. 표/그림 지원 추가 당시 이 함수 갱신을 누락해 포맷 카드에 "이미지가 제외된다"는 문구가 남았던 회귀가 있었다(v4.10.12에서 수정).
- 본문 콘텐츠가 없는 빈 슬라이드라도 발표자 노트가 있으면 `슬라이드 N` 제목과 노트 문단을 출력한다. 본문과 노트가 모두 없을 때만 건너뛴다.
- **아직 실제 PowerPoint/Keynote/Google Slides로 내보낸 진짜 PPTX로 검증하지 않았다.** fixture는 손으로 만든 최소 XML이라 네임스페이스 접두사·구조가 실제 파일과 다를 가능성이 있다. 실 파일 회귀 전에는 "완료"로 보지 않는다.

검증:

- `tests/fixtures/sample.pptx`(2슬라이드: 제목+본문+목록+가로/세로 병합 표+그림+그룹 도형+슬라이드1 발표자 노트, v4.10.30부터 notesSlide1 포함)
- `npm run test:golden`
- 슬라이드 순서, 표 병합, 그림 삽입, 그룹 도형 내부 텍스트, 발표자 노트 문단은 한컴에서도 확인한다.

## HWP / HWPX

관련 코드: `parseHwp()`, `parseHwp5WithRhwp()`, `extractHwpxTable()` in `js/parsers.js`

목표:

- HWP는 베타 입력이다. HWPX는 출력 형식이며 입력 안내에서 분리한다.

보존:

- HWPX 오업로드 시 내부 XML 본문 텍스트와 일부 표(기존 ZIP 경로, 변경 없음)
- HWP5(OLE2) 바이너리는 v4.10.27부터 `@rhwp/core`(Rust+WASM, MIT)를 사용하며, 상용화 게이트 이후 0.8.4 JS/WASM을 `js/vendor/rhwp-core-0.8.4/`에 고정해 같은 서비스 도메인에서 동적 import한다.
  문단 단위 본문 텍스트를 추출한다. 표·이미지·글머리·서식 등 구조 정보는 다루지 않는다
  (TXT 포맷과 동일한 보존 수준 — 텍스트만).
- CFBF(OLE2) 헤더 섹터는 항상 512바이트이므로, 그보다 작은 버퍼는 WASM을 내려받기 전에
  즉시 거부한다(손상 파일에서 불필요한 네트워크 요청 방지, `parseHwp5WithRhwp()` 상단).
- 암호 보호·손상된 HWP5는 `new HwpDocument()` 생성자가 던지는 예외를 잡아 안내 메시지로 변환한다.

주의:

- HWP5는 여전히 텍스트만 나온다. 서식·표·이미지까지 보존하고 싶다면 한컴오피스에서 HWPX로
  다시 저장하도록 안내한다(카드의 tip/links는 유지).
- 이미 HWPX인 파일은 변환보다 원본 사용을 권장한다.
- HWP/HWPX 안내를 카드나 실패 메시지에서 과장하지 않는다 — "텍스트 추출됨"과 "서식까지 보존됨"을 구분한다.
- `@rhwp/core`는 이 앱이 이미 "정밀 미리보기" iframe(`https://edwardkim.github.io/rhwp/`)으로 쓰던
  것과 같은 프로젝트(edwardkim/rhwp)의 npm 패키지다. 버전을 올릴 때는 두 곳(CSP 주석 근처
  `RHWP_CORE_URL`과 index.html의 rhwp iframe URL)의 버전이 서로 다를 수 있음을 인지한다
  (iframe은 외부 사이트가 자체적으로 최신화하므로 이 앱이 직접 버전을 맞출 필요는 없다).

## HWPX 생성

관련 코드: `buildHwpx()`, `buildHeaderXml()`, `buildTable()`, `buildParaRuns()` in `js/hwpx.js`

핵심:

- `mimetype`은 ZIP 첫 엔트리이며 `application/hwp+zip`이어야 한다.
- 필수 엔트리: `Contents/header.xml`, `Contents/section0.xml`, `Contents/content.hpf`, `META-INF/manifest.xml`, `Preview/PrvText.txt`.
- `header.xml`의 `charPr`, `paraPr`, `borderFill` 정의와 `section0.xml` 참조가 맞아야 한다.
- 새 borderFill, charPr, paraPr를 만들면 IDRef 검증과 namespace를 같이 본다.
- 표는 grid, row, cell span이 맞지 않으면 한컴에서 조용히 깨진다.
- 그림은 `BinData`, manifest, content.hpf, `hp:pic/hc:img`가 모두 맞아야 한다.
- HWPX에는 회전 전 기본 용지 치수(`width < height`)를 기록한다. 세로는 `landscape="WIDELY"`, 가로는 `landscape="NARROWLY"`로 회전하고, 본문·표 폭 계산만 회전 후 유효 폭(가로에서는 기본 `height`)을 사용한다. enum과 폭·높이를 동시에 뒤집으면 이중 회전되어 페이지와 콘텐츠 폭이 분리된다.

## 기본 미리보기 페이지 처리

목표:

- 용지 크기와 방향을 시각적으로 정확히 전달하면서 모든 내용을 빠짐없이 보여준다.

불변식:

- 페이지 폭과 높이는 선택한 용지의 종횡비로 고정한다.
- 내용이 페이지 높이를 넘으면 다음 페이지로 분할한다.
- 종이 자체에 스크롤을 넣거나, 넘친 내용을 `overflow:hidden`만으로 잘라서는 안 된다.
- 한 블록이 페이지보다 큰 경우에도 해당 블록을 조용히 누락하지 않는다. 향후 블록 내부 분할을 지원하기 전까지는 회귀 테스트에서 큰 단일 블록 표본을 별도로 확인한다.

v4.5.7 회귀에서 피해야 할 오답:

- `aspect-ratio`와 `.ir-page { overflow:auto; }`를 함께 적용해 겉보기 폭·높이만 가로로 만드는 방식.
- `renderedWidth > renderedHeight` 하나만 성공 조건으로 삼는 테스트.
- 이 방식은 긴 문서에서 종이 내부 스크롤과 콘텐츠 잘림을 만들지만 단순 치수 테스트는 통과한다.

검증:

- `tests/golden.js`: 긴 A3 가로 표본이 두 페이지 이상으로 나뉘고, 모든 페이지가 넘침 없이 유지되는지 확인한다.
- `tests/orientation-e2e.js`: 실제 파일 선택 → 변환 → 미리보기 흐름에서 가로 비율, 페이지 수, 잘림 여부, 안내 문구를 확인한다.
- 화면 캡처에서 종이 내부 스크롤이 없고 각 페이지가 가로 형태로 보이는지 사람이 확인한다.

## 왕복 불변식 (IR → HWPX → IR′)

관련 코드: `js/core/hwpx-to-ir.js` · 게이트: `qa/roundtrip-gate.js` (`npm run test:roundtrip`)

### 왜 만들었나 — 자기 채점의 한계

`tests/format-fidelity-score.js`는 자기 픽스처를 자기 채점기로 잰다. 회귀 감지에는 쓸모가 있지만 **제3자가 재현할 수 있는 주장은 아니다.** 채점 규칙을 느슨하게 쓰면 점수는 올라가고 아무도 눈치채지 못한다.

왕복 게이트는 점수를 매기지 않는다. 만든 HWPX를 **다시 읽어** IR로 되돌리고 원본과 비교한다. 살아남지 못한 것은 그 자체로 "이 형식으로 표현되지 않았다"는 뜻이다. 세고, 비교하고, 다르면 실패한다.

### 불변식 7종

① 본문 텍스트 · ② 표 개수와 행·열·셀 수 **및 머리행 유무** · ③ 링크 개수와 URL 집합 · ④ 목록 항목 수와 중첩 레벨 분포 · ⑤ 제목 개수와 레벨 분포 · ⑥ 그림 개수 · ⑦ 코드 블록 개수와 본문

### 의도된 변형 (실패가 아니다 — 명시된 것만 허용)

- 첫 H1은 `ir.title`로 승격되어 본문 제목 문단으로 렌더된다. 원본 지문에는 title을 더하고, 왕복 지문에는 더하지 않는다(왕복에서는 이미 블록이다). 양쪽 다 더하면 왕복만 두 번 세어 **항상** 불일치한다.
- 이모지는 `replaceEmoji()` 규칙으로 □가 된다. 게이트가 원본 쪽에 같은 규칙을 적용한다.
- URL은 `new URL().href`로 정규화된다(`https://example.org` → `https://example.org/`). 안전하지 않은 스킴은 링크가 걸리지 않으므로 기대값에서도 뺀다.
- 코드 블록은 표로 렌더된 뒤 코드로 되돌아온다(셀 문단 `paraPr=14`로 판별).

### 역파서가 지키는 렌더러 규약

`js/core/hwpx-to-ir.js`는 **우리가 만든 HWPX**를 대상으로 한다. 임의의 한컴 문서를 해석하는 범용 리더가 아니다. 렌더러의 id 규약을 되짚으므로 규약을 바꾸면 여기도 바꿔야 하고, 놓치면 왕복 게이트가 잡는다.

| 규약 | 값 |
|---|---|
| 제목 | `paraPr` 1~4 = H1~H4, 15 = H5, 16 = H6 |
| 목록 | `paraPr` 5 / 17 / 18 = 중첩 레벨 0 / 1 / 2 |
| 표 셀 | `paraPr` 7 / 10 / 11 = 가운데 / 왼쪽 / 오른쪽 |
| 코드 | `paraPr` 14 |
| 인용 | `paraPr` 19 |
| 목록 마커 | `· ` `◦ ` `▪ ` `▣ ` `□ ` `N. ` — 별도 run으로 앞에 붙는다 |

### 이 작업에서 실제로 밟은 함정

1. **`hp:lineBreak`는 `hp:t`의 자식이다** — `hp:run`의 형제가 아니다.
   ```xml
   <hp:t>첫 줄<hp:lineBreak/><hp:lineBreak/>둘째 줄</hp:t>
   ```
   `textContent`만 읽으면 "첫 줄둘째 줄"이 되어 줄바꿈이 소리 없이 사라지고, `hp:run`에서 lineBreak를 찾으면 하나도 못 찾는다. 자식 노드를 순서대로 훑어야 한다.

2. **머리행 표시는 행이 아니라 셀에 있다** (`hp:tc@header`). 행에서 찾으면 항상 "머리행 없음"으로 판정한다.

3. **목록 마커는 `text`와 `runs` 양쪽에서 떼야 한다.** 마커는 별도 run이라 `text`에서만 떼면 `runs`를 우선하는 소비자가 마커를 다시 본다.

4. **IR은 같은 정보를 여러 모양으로 담는다.** 목록 항목은 문자열(JSON 파서)일 수도 `{text, runs}`(MD 파서)일 수도 있고, `quote`는 `text`가 아니라 중첩 `blocks`를 갖는다. 한쪽 모양만 읽으면 원본이 비어 보여 **렌더러 결함으로 오진한다**(실제로 그렇게 오진했다).

### 변이 테스트 — 게이트가 실제로 잡는지 확인

항상 통과하는 게이트는 무가치하다. 렌더러를 고의로 훼손해 검출을 확인한다.

| 변이 | 검출 |
|---|---|
| `buildHyperlinkBegin`을 빈 문자열로 | ③ 링크 URL 개수 4→0, 6→0 |
| `header="${isHd?'1':'0'}"` → `header="0"` | ② `hasHeader` true→false (표 6개) |
| `listParaId`를 항상 `'5'`로 | ④ 목록 중첩 레벨 1→0 |
| `'<hp:lineBreak/>'` → `''` | ① 텍스트 495→494, 213→204 |

`hasHeader`는 이 변이 테스트 때문에 추가됐다. 처음에는 행·셀 총계만 봐서 머리행이 일반 행으로 내려앉아도 통과했다.

현재 상태(v4.16.16): MD 4종·CSV 2종·JSON 2종·TXT 2종 총 10개 픽스처 전부 통과.

## 역방향 텍스트 추출 (HWPX → MD / HTML)

관련 코드: `js/core/ir-to-text.js` · `js/core/hwpx-to-ir.js`

```
HWPX → (hwpx-to-ir) → IR → (ir-to-text) → Markdown / HTML
```

HWP 내보내기(구버전 한/글 수신자용, rhwp 기반)와 **다른 계통**이다. 이쪽은 한컴 공개 OWPML 기준의 자체 역파서를 쓰며 rhwp를 거치지 않는다.

### 정직성 원칙

레이아웃 복제가 아니라 **구조 추출**이다. 표현할 수 없는 것을 표현한 척하지 않는다.

- 서식·여백·글꼴은 포함되지 않는다.
- 그림은 파일 이름(`BinData/xxx.png`)만 참조하며 바이트는 내보내지 않는다. CLI와 MCP 모두 결과에 그 사실을 적는다.
- 표 안의 링크처럼 IR이 담지 않는 것은 만들어내지 않는다.

### 마커가 담는 정보를 버리지 않는다

목록 마커(`· ◦ ▪ ▣ □ N.`)는 장식이 아니라 정보다. `1. `은 순서 목록, `▣/□`는 태스크와 체크 상태를 뜻한다. **떼어내기만 하고 버리면** HWPX를 Markdown으로 되돌릴 때 순서 목록이 글머리 목록이 되고 체크박스가 사라진다 — 실제로 그랬다.

`readMarkerMeta()`가 마커를 해석해 `ordered` / `task` / `checked`를 복원하고, 왕복 게이트의 ④가 그 회귀를 막는다.

또한 `coalesceBlocks()`는 순서 목록과 글머리 목록이 붙어 있으면 **다른 목록으로 나눈다.** 한 덩어리로 묶으면 되돌릴 때 번호가 글머리로 바뀐다.

### 제목의 굵게는 한 번만

렌더러는 제목을 굵은 글꼴 face로 그리므로 역파서가 모든 제목 run에 `bold`를 붙인다. 그대로 직렬화하면 `## **제목**`이 되어 강조가 두 번 표현된다. Markdown·HTML 직렬화 모두 제목 안의 굵게를 뺀다(`headingRunsToMd`, HTML은 `bold:false` 매핑).

### 사용

```bash
node js/core/cli.js 공문.hwpx --to md
node js/core/cli.js 공문.hwpx --to html
```

MCP는 `read_hwpx`(`as: markdown | html | ir`). `as=ir`은 파싱 가능한 IR JSON을 주므로 에이전트가 읽고 고쳐 `ir_to_hwpx`로 다시 쓰는 왕복 작업이 가능하다.

## 코어 추출 (브라우저 ≡ Node)

관련 코드: `js/core/runtime.js`, `js/core/index.js` · 게이트: `qa/core-parity-gate.js`

### 원칙 — 렌더러는 한 벌만 둔다

CLI·MCP를 만들 때 가장 쉬운 실수는 렌더러를 복제하는 것이다. 그러면 웹앱과 코어 산출물이 조용히 갈라지고, 어느 쪽이 진짜인지 아무도 모르게 된다.

그래서 `js/hwpx.js`는 한 벌로 두고, 호스트마다 다른 것만 `js/core/runtime.js`에서 갈아 끼운다.

| 갈아 끼우는 것 | 브라우저 | Node |
|---|---|---|
| ZIP 구현 | 전역 `JSZip` | `require('jszip')` |
| 출력 컨테이너 | `Blob` | `Uint8Array` |
| XML well-formed 검사 | `DOMParser` | `@xmldom/xmldom` (없으면 **건너뛴다**) |

`runtime.js`에는 포맷 지식을 넣지 않는다. 여기에 변환 규칙이 들어가기 시작하면 어댑터가 아니라 두 번째 렌더러가 된다.

XML 파서가 없을 때 그 검사를 "통과"로 처리하지 않는다(`checkXmlWellFormed`가 `null`을 반환하고 호출자가 건너뛴다). 검사기가 없다는 사실을 합격으로 바꾸면 게이트가 거짓말을 하게 된다.

### 동등성 게이트

`npm run test:core` — 브라우저에서 픽스처를 변환하면서 그때 쓰인 IR과 렌더 옵션을 `window.__tohwpxDebug.lastRender`로 꺼내, 같은 값을 Node 코어에 넣고 두 ZIP을 **엔트리 단위로** 비교한다.

옵션을 게이트에서 손으로 다시 적으면 그 순간 비교가 무의미해지므로 반드시 앱에서 꺼내 간다.

ZIP 원시 바이트가 아니라 엔트리 내용을 비교하는 이유: JSZip은 엔트리마다 생성 시각을 기록해 원시 바이트가 실행마다 달라진다. 그 차이는 변환 품질과 무관하다. 같아야 한다고 주장하는 것은 **내용**이다.

현재 상태(v4.16.15): 9개 픽스처에서 모든 엔트리 내용 동일, 산출물 크기도 동일. 변이 테스트로 게이트 유효성 확인 — `lineSpacingPercent`를 코어에서만 바꾸자 7개 픽스처가 `Contents/header.xml` 불일치로 실패했다.

### 이미지 데이터 직렬화 함정

IR의 `image.data`는 `Uint8Array`다. 게이트가 브라우저에서 IR을 꺼낼 때 `JSON.stringify`를 그냥 태우면 `{0:..,1:..}` 꼴의 평범한 객체가 되어 JSZip이 `Can't read the data of ...`로 거절한다. base64로 감싸 넘기고 Node에서 되돌린다. MCP의 `ir_to_hwpx`도 같은 이유로 base64 문자열을 받아 `Uint8Array`로 복원한다.

### CLI·MCP 범위

DOM 없이 파싱 가능한 포맷만 지원한다 — MD·CSV/TSV·TXT·JSON. HTML·DOCX·PPTX·XLSX·IPYNB는 각각 DOMParser·JSZip·SheetJS가 더 필요하다.

**반쯤 지원해서 조용히 다른 결과를 내는 것보다 안 된다고 말하는 편이 낫다.** CLI는 미지원 확장자에 이유와 대안(웹앱)을 함께 말하며 종료 코드 1로 끝낸다.

일괄 변환에서 `notes.csv`와 `notes.json`은 둘 다 `notes.hwpx`가 된다. 막지 않으면 뒤 파일이 앞 파일을 조용히 덮어쓰므로, 변환 시작 **전에** 충돌을 검사해 종료 코드 2로 거절한다(`tests/cli-test.js` ⑦).

## 역방향 내보내기 (HWPX → HWP)

관련 코드: `js/reverse-export.js` · 게이트: `qa/reverse-export-gate.js`, `tests/hwp-export-e2e.js`

### 왜 있는가

2026-05-18부터 중앙·지방 온나라 문서시스템이 개방형 문서만 첨부하도록 의무화됐고, 2026년 10월부터 hwp 첨부가 제한된다. 그런데 전환기 현장에서는 반대 방향의 통증이 같이 관측된다 — "HWPX를 보냈더니 상대방이 열지 못한다"(구버전 한/글 수신자). HWP 내보내기는 **그 수신자에게 보낼 때 쓰는 보조 산출물**이며, 주 산출물은 계속 HWPX다.

### 계통 분리 (중요)

| 축 | 근거 | 파일 |
|---|---|---|
| 생성(주 경로) | 한컴 공개 OWPML / KS X 6101 | `js/hwpx.js` |
| 역방향(선택) | `@rhwp/core` (MIT, 리버스 엔지니어링 산물) | `js/reverse-export.js` |

두 계통을 섞지 않는다. 생성 품질의 근거가 공식 규격 하나로 유지돼야 "왜 이 XML이 맞는가"에 답할 수 있다. 역방향은 편의 기능이며, 실패해도 HWPX 생성·다운로드에 영향을 주면 안 된다.

### 엔진 사용 시 함정

- **`HwpViewer`는 `HwpDocument`의 소유권을 가져간다.** `viewer.free()` 뒤에 `doc.free()`를 부르면 이중 해제로 WASM이 죽는다(`null pointer passed to rust`). 뷰어를 만들었으면 뷰어만 해제한다.
- **`exportHml()`은 HML 원본 문서에서만 동작한다.** HWPX 출처 문서에는 `HML_SOURCE_REQUIRED`로 거부되므로 UI에 노출하지 않는다.
- **`getSourceImageBytes(i)`는 그림 존재 확인용으로 쓰면 안 된다.** 인덱스가 맞지 않으면 예외가 아니라 `memory access out of bounds`로 죽고, 그림이 멀쩡히 있어도 "없음"처럼 보인다. 그림 보존 여부는 **렌더된 SVG의 `<image>` 개수**로 판정한다.
- **`contentLoss()`를 단독 근거로 삼지 않는다.** 엔진이 놓친 손실은 0으로 보고된다. 실제로 "그림이 사라진 것처럼 보이는데 손실 0" 상황을 만났고, 렌더 비교로만 진위를 가릴 수 있었다.

### 검증

`node qa/reverse-export-gate.js --fixtures` — 픽스처를 실제 브라우저로 HWPX 변환한 뒤 5개 항목을 본다.

1. HWP 산출물이 CFB(OLE2) 시그니처(`d0cf11e0a1b11ae1`)를 갖는가
2. 엔진이 보고한 content-loss가 0인가
3. 자기 재로드 후 페이지 수가 유지되는가
4. 본문 텍스트가 문단 단위로 왕복 동일한가 ← **우리가 독립적으로 재는 값**
5. 렌더된 `<image>` 개수와 페이지 수가 유지되고 `<text>` 조각이 급감(10% 초과)하지 않는가 ← **황금률을 자동으로 좁히는 부분**

`node tests/hwp-export-e2e.js` — 결과 카드의 버튼 노출, 파일명 `.hwp` 변환, 실제 다운로드 바이너리, 요약 문구의 사실성, 페이지 오류 없음.

현재 상태(v4.16.13): MD·HTML·CSV·JSON·IPYNB·DOCX·PPTX 등 10개 픽스처에서 문단 수·그림 수·페이지 수 전부 유지, 손실 0건.

### PDF 저장 (인쇄 경로)

`printHwpxAsPdf()`는 각 페이지를 `renderPageSvg()`로 렌더해 인쇄용 문서로 조립하고 브라우저 인쇄 대화상자를 연다. 사용자가 "PDF로 저장"을 고른다.

**별도 PDF 라이브러리를 vendor에 추가하지 않는다.** 인쇄 대화상자의 PDF 저장이 모든 대상 브라우저에 이미 있고, 공급망을 늘리지 않는 편이 이 저장소의 기존 결정(vendor 최소화, SRI 고정)과 일치한다.

- `@page` 크기는 첫 페이지 SVG의 실측 px를 mm(96dpi 기준)로 환산해 정한다. 용지·방향이 원본과 어긋나지 않는다.
- HWPX는 **회전 전 치수 + `landscape` enum**으로 방향을 기록한다. 엔진이 그 enum을 무시하면 가로 문서가 세로로 인쇄되므로, A3 가로에서 `@page size: 420mm 297mm`(폭>높이)가 나오는지 회귀 검사한다.
- 팝업 차단을 피하려고 새 창 대신 숨은 iframe(`srcdoc`)을 쓴다. `print()`는 반드시 사용자 클릭 안에서 호출한다.
- 인쇄 전 `document.fonts.ready`를 기다린다. 폰트가 자리잡기 전에 인쇄하면 글자가 잘린다.

검증(`tests/hwp-export-e2e.js` ⑥⑦): A4 세로에서 `@page 210×297mm`, A3 가로에서 `420×297mm` + 2쪽 분할 + 글자 788개 보존.

### 보존 / 제외 가능

- 보존: 본문 텍스트와 문단 구분, 표, 그림, 쪽수, 페이지 설정.
- 제외 가능: rhwp IR이 다루지 않는 개체. 엔진이 보고하면 결과 카드에 건수를 그대로 적는다.
- **과장 금지**: 손실 보고서를 받지 못했으면 "손실 없음"이라고 쓰지 않고 "확인할 수 없습니다"로 남긴다.

## 포맷 안내 문구 작성 규칙

- 카드 한 줄: “제외 가능”을 짧고 구체적으로 쓴다.
- 모달: `desc`, `tech`, `features`, `limits`, 필요 시 `tip` 순서로 쓴다.
- `features`는 실제 구현된 것만 쓴다.
- 일반론은 “일반적으로 이 포맷은…”처럼 기대치 조정에만 사용한다.
- `quality` 별점은 원본 시각 복제 점수가 아니라 현재 서비스의 내용/구조 보존 기대치다.
- 변환 실패 문구는 원인과 다음 행동을 같이 제시한다.

## 변경 시 체크리스트

- 파서를 바꿨는가? 해당 fixture와 `npm run test:golden`을 돌린다.
- 포맷별 보존/손실 범위가 바뀌었는가? `FORMAT_INFO`와 `getConversionSummaryForExt()`를 같이 고친다.
- HWPX XML 구조를 바꿨는가? `qa/gate.js` 또는 golden unzip 검사와 한컴 확인 요청을 병행한다.
- 폰트/색/표/그림을 바꿨는가? `hwpx_rendering_gotchas.md`를 먼저 보고 namespace/IDRef를 대조한다.
- 사용자 안내가 바뀌었는가? `changelog.json` 사용자 항목은 자잘한 내부 구현보다 사용자가 체감하는 변화 중심으로 쓴다.
- 역방향 내보내기를 건드렸는가? `npm run test:reverse`와 `node tests/hwp-export-e2e.js`를 돌리고, 그림이 든 픽스처의 `<image>` 개수 유지를 확인한다.
