# Format Conversion Playbook

이 문서는 To-Hwpx의 포맷별 변환 기술과 작업 노하우를 모은다. 목적은 새 에이전트가 `js/parsers.js`, `js/hwpx.js`, `js/app.js`를 매번 처음부터 추측하지 않고 같은 품질 기준으로 수정하게 하는 것이다.

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

- 일반 사용자 동선에서는 직접 입력, 업데이트 내역 상세, 구현된 실험 기능 목록, 추천 실험 기능을 숨긴다. `?admin=1` 또는 호환용 `?lab=1`로 관리자 모드에 들어가면 localStorage에 상태를 저장한다.
- 관리자 모드 최상단 스위치는 개별 기능 토글이 아니라 전체 사용/전체 사용 안함이다. 켜면 현재 구현된 실험 기능 기본값을 함께 켜고, 끄면 개별 기능도 모두 비활성화한다. 개별 기능은 `tohwpx_feature_*` localStorage 키로 관리한다.
- 서식 있는 입력(DOCX/HTML/XLSX/HWP 계열)은 문서 세부 설정의 `원본 서식 처리`를 `원본 우선`으로 두는 것이 기본이다. 원본 우선은 IR에 들어온 병합·색상·인라인 서식을 먼저 존중하고 앱 장식 프리셋 적용을 줄인다. 사용자가 `앱 설정으로 정리`를 선택하면 문단·제목·표·링크·이미지 세부 프리셋을 강하게 적용한다.
- 업데이트 내역 모달의 탭은 `사용자 변경사항`, `개발자 변경사항`, `관리자 모드`, `포맷 품질 평가`로 분리한다.
- 관리자 모드 탭에는 관리자 모드 토글과 추천 실험 기능을 둔다. 추천 실험은 공개 사용자 기능이 아니므로 사용자가 명시적으로 공개를 승인하기 전에는 `changelog.json`의 user 항목에 쓰지 않는다.
- 포맷 품질 평가는 버전/일자별 추이를 보여주되, 원격 통계처럼 표현하지 않는다. 현재 값은 `FORMAT_QUALITY_METRICS`와 `QUALITY_HISTORY`에서 관리하며 `FORMAT_INFO.limits`를 함께 보여준다. 평가는 릴리스마다 golden/게이트 기준으로 갱신하고, 서식 보존 관련 파서·렌더러 변경 시 한컴 수동 확인을 별도로 요청한다. fixture가 늘어나거나 월 1회 점검 때 추정 수치를 다시 조정한다.
- 변환률은 원본 기능이 IR/HWPX로 의미 있게 옮겨지는 추정 비율, 성공률은 오류 없이 HWPX 생성·구조 검증을 통과할 가능성이다. 실제 사용자 파일 성공률이 필요하면 별도 익명/동의 기반 telemetry 설계가 먼저 필요하다.
- 부분 롤백을 쉽게 하려면 파서 변경, HWPX XML 생성 변경, 관리자 UI/품질 문구 변경을 커밋 메시지와 테스트에서 분리해 추적한다.

검증:
- `tests/golden.js`의 관리자 회귀는 일반 모드 비노출, `?admin=1` 노출, `?lab=1` 호환, 관리자 모드 토글, 추천 실험 패널, 포맷 품질 평가 탭의 핵심 문구를 확인한다.
- 품질 숫자나 개선 계획을 바꾸면 관련 포맷 fixture와 이 문서의 제한사항 설명이 같은 방향인지 확인한다.

## 직접 입력 미리보기

관련 코드: `initInputMode()`, `renderPastePreview()`, `getPastePreviewIr()` in `js/app.js`

- 직접 입력은 관리자 모드 전용이며 MD/HTML/TXT/CSV/JSON 텍스트를 가상 `File`로 감싸 기존 `fileToIR()` 변환 파이프라인을 재사용한다.
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
- 표 셀은 아직 문자열 IR이므로 내부 링크·이미지는 표시 텍스트 중심이다. 해당 범위를 확장할 때는 공용 cell run 계약을 먼저 설계한다.
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

주의:
- CSS 레이아웃, 반응형 배치, 클래스 기반 디자인은 보존하지 않는다.
- `script`, `style`, `head`, `nav`, `footer`, `aside` 등 비본문 요소는 건너뛴다.
- 이미지, SVG, 외부 리소스는 안내상 제외 가능으로 둔다.
- 관리자 모드 직접 입력에는 HTML 소스를 붙여넣는 것이 기본이다. 입력 형식은 버튼 UI로 고르며 내부 값은 `#paste-format`과 `tohwpx_pasteFormat`에 동기화한다. 다만 웹 화면에서 복사해 태그 없이 들어온 일반 텍스트도 빈 문서가 되지 않도록 문단으로 보존한다.
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
- 제목, 표, bold 같은 서식 정보는 원본에 없으므로 추정하지 않는다.
- 표처럼 보이는 텍스트도 기본적으로 일반 문단으로 처리될 수 있다.
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
- XLSX는 SheetJS로 첫 시트를 CSV로 바꾼 뒤 CSV 파서를 재사용한다.
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
- text output: 문서 본문으로 포함

주의:
- 이미지 출력, 차트, 위젯, LaTeX 수식, 실행 상태, metadata는 보존하지 않는다.
- 첫 markdown 제목은 문서 제목 후보가 될 수 있다.
- Markdown 파서 변경 시 IPYNB markdown cell도 함께 확인한다.

검증:
- `tests/fixtures/sample.ipynb`
- markdown/code/output text가 구분되어 누락 없이 들어가는지 본다.

## DOCX

관련 코드: `parseDocx()`, `extractDocxParagraph()`, `extractDocxTable()`, `extractDocxImage()` in `js/parsers.js`; image/table/footnote paths in `js/hwpx.js`

목표:
- Word 화면을 픽셀 단위로 복제하지 않고, 본문 구조 중심으로 HWPX 문서를 재구성한다.

보존:
- 문서 순서 기준 heading/paragraph 후보
- 문단, 일부 정렬(center/right/justify)
- bold, italic, underline, strike, text color
- 기본 표, 가로/세로 병합, 셀 배경색, 셀 글자색 일부
- PNG/JPG/GIF/BMP 본문 이미지
- 각주 텍스트
- 첫 머리글/바닥글 텍스트

주의:
- DOCX는 ZIP + OOXML이다. `word/document.xml`, 관계 파일, `word/media`, footnotes, header/footer를 함께 본다.
- WMF/EMF, 복잡한 drawing, 주석, 변경 추적, style theme, 섹션별 레이아웃은 손실 가능으로 안내한다.
- 목록 번호는 문서마다 XML 차이가 커서 변경 시 반드시 fixture를 추가한다.
- 이미지 추가/수정은 `content.hpf` item id, manifest, `BinData` 파일, `hc:img@binaryItemIDRef`가 모두 맞아야 한다.
- 표 병합은 HWPX에서 조용히 깨질 수 있다. row/col span 무결성과 borderFill ID를 검사한다.

검증:
- `tests/fixtures/sample.docx`
- `npm run test:golden`
- 이미지/색/병합/머리글/각주는 자동 검증만으로 부족할 수 있으므로 한컴 확인을 요청한다.

## HWP / HWPX

관련 코드: `parseHwp()`, `extractHwpxTable()` in `js/parsers.js`

목표:
- HWP는 베타 입력이다. HWPX는 출력 형식이며 입력 안내에서 분리한다.

보존:
- HWPX 오업로드 시 내부 XML 본문 텍스트와 일부 표
- HWP5 바이너리는 결과 HWPX를 만들지 않고 실패 카드에서 HWPX/DOCX 재저장을 안내

주의:
- 사용자가 HWP 파일을 안정적으로 변환하고 싶다면 한컴오피스에서 HWPX 또는 DOCX로 다시 저장하도록 안내한다.
- 이미 HWPX인 파일은 변환보다 원본 사용을 권장한다.
- HWP/HWPX 안내를 카드나 실패 메시지에서 과장하지 않는다.

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
