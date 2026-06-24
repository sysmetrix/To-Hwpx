# Format Conversion Playbook

이 문서는 To-Hwpx의 포맷별 변환 기술과 작업 노하우를 모은다. 목적은 새 에이전트가 `js/parsers.js`, `js/hwpx.js`, `js/app.js`를 매번 처음부터 추측하지 않고 같은 품질 기준으로 수정하게 하는 것이다.

## 공통 원칙

- 입력 파일은 파서에서 IR(`{ title, doc_type, blocks }`)로 정규화하고, `js/hwpx.js`가 IR을 HWPX ZIP/XML로 만든다.
- 내용 누락 방지가 1순위다. 시각적 완전성보다 제목, 문단, 목록, 표, 코드, 주요 텍스트가 빠지지 않는지 먼저 확인한다.
- 포맷 카드와 결과 카드 문구는 실제 파서 품질을 과장하지 않는다. `js/app.js`의 `FORMAT_INFO`와 `getConversionSummaryForExt()`를 파서 변경과 함께 갱신한다.
- HWPX는 출력 형식이다. `.hwpx` 입력 처리는 오업로드/복구용 예외로 유지하되 기본 입력 안내에는 넣지 않는다.
- 새 시각 요소, 표 스타일, 이미지, 채우기, 폰트 관련 변경은 먼저 `hwpx_rendering_gotchas.md`를 읽고 네임스페이스와 IDRef를 확인한다.

## 제목 정책

관련 코드: `applyDocumentTitlePolicy()` in `js/app.js`

- 사용자가 문서 제목을 직접 입력하면 그 값을 최우선으로 쓴다.
- 기본 자동 제목 기준은 `heading`이다. 문서 첫 문장/제목 후보를 쓰고, `문서 구성`, `목차`, `개요` 같은 일반 섹션명은 제목 후보에서 제외한다.
- `filename` 옵션은 파일 이름을 제목으로 쓰는 명시적 선택이다.
- 파서가 추출한 제목을 최상단 제목으로 쓰지 않는 경우, 의미 있는 제목 텍스트가 본문에서 사라지지 않도록 본문 heading으로 복구한다.
- DOCX는 parser title만 믿지 말고 문서 순서의 heading/paragraph 후보를 다시 본다.

## Markdown

관련 코드: `parseMd()`, `extractMarkdownTokens()`, `splitInlineEmphasis()` in `js/parsers.js`

목표:
- 현재 가장 안정적인 구조형 입력이다.
- 제목, 문단, 목록, 표, 코드블록, 인용구, 링크 텍스트를 안정적으로 HWPX로 옮긴다.

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
- 링크 URL 자체보다 링크 텍스트 보존이 우선이다.
- 인용구는 `quote` IR → HWPX `paraPrIDRef="19"`로 출력한다. 예전처럼 `▶` 텍스트를 붙이면 안 된다.
- 이미지와 복잡한 인라인 HTML은 지원 범위 밖으로 안내한다.

검증:
- `tests/fixtures/sample.md`
- 코드블록, 목록, 표, 인용구, 한글/영문 혼합, 특수문자가 `section0.xml`에 남는지 본다.
- 작은따옴표 회귀는 일반 문장·인라인 강조의 `'`가 `section0.xml`에 문자 그대로 있고 `&apos;`가 없는지 확인한다.
- 인용구 회귀는 `section0.xml`에 `paraPrIDRef="19"`가 있고 `▶ Quoted Alpha line`이 없어야 한다.

## HTML

관련 코드: `parseHtml()`, `extractInlineRuns()`, `elementToTable()` in `js/parsers.js`

목표:
- 웹 화면 복제가 아니라 문서 구조 추출이다.

보존:
- `h1`-`h6`, `p`, `ul`, `ol`, `li`, `table`
- `blockquote`(Markdown 인용구와 같은 HWPX 인용 문단)
- `strong`, `em`, `code`, `u`, `ins`, `s`, `strike`, `del`
- 일부 글자색(`style="color:"`, `<font color>`)

주의:
- CSS 레이아웃, 반응형 배치, 클래스 기반 디자인은 보존하지 않는다.
- `script`, `style`, `head`, `nav`, `footer`, `aside` 등 비본문 요소는 건너뛴다.
- 이미지, SVG, 외부 리소스는 안내상 제외 가능으로 둔다.
- HTML 변경 후에는 Markdown fallback 경로도 같이 깨지지 않았는지 확인한다.

검증:
- `tests/fixtures/sample.html`
- 제목/문단/목록/표 텍스트와 namespace가 유지되는지 확인한다.

## TXT

관련 코드: `parseTxt()` in `js/parsers.js`

목표:
- 서식보다 원문 텍스트 보존을 우선한다.

보존:
- 원문 텍스트
- 줄바꿈과 빈 줄 기반 문단
- 한글/영문/특수문자

주의:
- 제목, 표, bold 같은 서식 정보는 원본에 없으므로 추정하지 않는다.
- 표처럼 보이는 텍스트도 기본적으로 일반 문단으로 처리될 수 있다.
- 인코딩 감지는 앱 로딩 경로와 함께 확인한다.

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
- 여러 시트, 차트, 이미지, 셀 병합, 색상, 폰트, 세부 서식은 보존 대상이 아니다.
- 수식 자체가 아니라 계산된 표시 값 중심으로 안내한다.
- 표 폭/열 너비 변경은 HWPX 렌더링에 민감하므로 `buildTable()`의 grid/rowSpan/colSpan 무결성을 확인한다.

검증:
- `tests/fixtures/sample.csv`
- 빈 셀, 열 개수, 긴 텍스트, 표 존재 여부를 본다.

## JSON

관련 코드: `parseJson()`, `jsonToBlocks()` in `js/parsers.js`

목표:
- 데이터 구조를 사람이 읽기 쉬운 문단/목록/표 형태로 펼친다.

보존:
- 객체 key/value
- 배열 값
- 배열 안 객체 구조의 표 변환
- IR 형식 JSON 직접 변환

주의:
- 보고서형 편집 레이아웃을 자동 설계하지 않는다.
- 깊은 중첩은 길게 펼쳐질 수 있다.
- 데이터 타입의 의미, 원본 들여쓰기, JSON formatting 자체는 보존 목표가 아니다.
- 안내 문구에서 JSON을 “문서 품질 높음”처럼 표현하지 않는다. 값 보존과 가독성 중심이다.

검증:
- `tests/fixtures/sample.json`
- 제목/문단/표 텍스트 누락이 없는지 확인한다.

## IPYNB

관련 코드: `parseIpynb()` in `js/parsers.js`

목표:
- 실행 가능한 노트북 복제가 아니라 읽는 문서화다.

보존:
- markdown cell: Markdown 파서 재사용
- code cell: 등폭 코드블록
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
- HWP5 바이너리는 제한/안내 중심

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
