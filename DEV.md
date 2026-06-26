# To HWPX — 개발·관리자 메모

이 파일은 개발자 및 관리자용 내부 문서입니다. 사용자 안내는 [README.md](./README.md)를 보세요.

화면 구조와 시각 톤을 바꿀 때는 [DESIGN.md](./DESIGN.md)의 변환기 패널 구조와 롤백 가능한 작업 방식을 먼저 확인하세요.

---

## 코드를 몰라도 하는 빠른 수정 가이드

이 프로젝트는 빌드 과정이 없는 정적 웹 앱입니다. 대부분의 문구, 링크, 색상은 아래 위치만 바꾸면 됩니다.

| 하고 싶은 수정 | 수정할 파일 | 찾을 내용 | 주의할 점 |
|---|---|---|---|
| 첫 화면 제목/설명 변경 | `index.html` | `hero-title`, `hero-sub` | 태그 이름과 `id`는 그대로 두고 글자만 바꾸세요. |
| 상단/푸터 링크 변경 | `index.html` | `main-nav`, `footer-links` | `href` 주소와 화면 글자만 바꾸면 됩니다. |
| 지원 포맷 카드 문구 변경 | `index.html` | `.format-card` | `data-ext` 값은 JS와 연결되므로 함부로 바꾸지 마세요. |
| 포맷 팝업 설명 변경 | `js/app.js` | `FORMAT_INFO` | 카드의 `data-ext`와 같은 키를 찾아 설명만 바꾸세요. |
| 대표 색상 변경 | `style.css` | `:root`, `--c-primary`, `--c-accent` | 위쪽 CSS 변수만 바꾸면 전체 테마에 반영됩니다. |
| 최대 화면 폭 변경 | `style.css` | `--max-w` | 너무 작게 바꾸면 표/옵션 영역이 답답해질 수 있습니다. |
| 앱 이름/PWA 설명 변경 | `manifest.json` | `name`, `short_name`, `description` | JSON 파일이므로 쉼표와 따옴표 형식을 유지하세요. |
| 설치형 폰트 제공 | `fonts/` | `fonts/README.md` | HWPX에는 폰트가 임베딩되지 않으므로 사용자가 PC에 설치해야 합니다. |
| 캐시 버전 갱신 | `sw.js` | `CACHE_VERSION` | 배포할 때마다 버전을 올려야 이전 캐시가 사라집니다. |
| 업데이트 내역 변경 | `changelog.json` | `versions` | JSON 형식을 깨뜨리지 않도록 마지막 항목 쉼표에 주의하세요. |
| 상단 버전 버튼 문구 | `index.html` | `📋 v4.0.x` | changelog.json `current` 버전과 일치시키세요. 업데이트 내역 창은 관리자 모드(`?admin=1`, 기존 `?lab=1` 호환)에서만 열립니다. |

### 절대 함부로 바꾸면 안 되는 것

- `id="..."`: JavaScript가 화면 요소를 찾는 연결 이름입니다.
- `class="..."`: CSS 스타일과 일부 JavaScript 동작이 연결됩니다.
- `data-ext="..."`: 포맷 카드와 파서/팝업 설명을 연결합니다.
- `<script src="js/parsers.js">`, `<script src="js/hwpx.js">`, `<script src="js/app.js">` 순서: 실행 순서가 중요합니다.
- `integrity="..."`: CDN 파일 보안 검증값입니다. 라이브러리 버전을 바꿀 때만 같이 바꿉니다.

### 파일 저장 인코딩

모든 파일은 **UTF-8**로 열고 저장하세요. 한글 주석과 화면 문구가 깨져 보이면 편집기의 인코딩을 UTF-8로 바꾼 뒤 다시 열어야 합니다.

---

## 기술 구조

### 변환 파이프라인 (7단계)

```
파일 읽기 → IR 변환 → HWPX 생성 → 구조 검증 → 미리보기 → 자동 수정 → 다운로드 준비
```

각 단계는 `app.js`의 `PIPELINE_STEPS` 배열로 정의되며, UI에 실시간 진행 상황을 표시합니다.

### 중간 표현 (IR, Intermediate Representation)

포맷 파서들은 원본 파일을 직접 HWPX로 변환하지 않고, 먼저 공통 IR(JSON) 구조로 변환합니다:

```json
{
  "title": "문서 제목",
  "doc_type": "plain",
  "blocks": [
    { "type": "heading", "level": 1, "text": "제목" },
    { "type": "para", "runs": [{ "text": "본문 텍스트", "bold": true }] },
    { "type": "table", "header": ["열1", "열2"], "rows": [["값1", "값2"]] }
  ]
}
```

이 구조 덕분에 새 포맷 지원은 IR을 생성하는 파서만 추가하면 됩니다. `parsers.js`에서 포맷별 파서를 관리합니다.

### HWPX 포맷

HWPX는 ZIP 컨테이너 안에 XML 파일들이 들어있는 구조입니다:

```
document.hwpx (ZIP)
├── mimetype              — "application/hwp+zip" (ZIP_STORED, 압축 없음)
├── META-INF/
│   └── container.xml
├── Contents/
│   ├── content.hpf       — 문서 패키지 정의
│   ├── header.xml        — 폰트·스타일·문단 속성 정의
│   └── section0.xml      — 실제 본문 XML
└── Preview/
    └── PrvText.txt       — 미리보기용 텍스트
```

핵심 생성 로직은 `js/hwpx.js`의 `buildHwpx()` 함수입니다.

### 파일 구조

```
to hwpx/
├── index.html          — 단일 페이지 앱 (SPA)
├── style.css           — 전체 스타일 (CSS 변수 기반)
├── sw.js               — 서비스 워커 (오프라인 캐싱)
├── manifest.json       — PWA 매니페스트
├── changelog.json      — 버전별 업데이트 내역
├── js/
│   ├── app.js          — UI 이벤트, 드래그앤드롭, 파이프라인 제어
│   ├── parsers.js      — 포맷별 파서 (MD/HTML/DOCX/CSV/JSON/IPYNB 등)
│   └── hwpx.js         — HWPX ZIP 패키징, XML 생성
├── fonts/              — 사용자 배포용 TTF 파일 (폰트 안내 팝업에서 다운로드 제공)
├── hwpx-public-doc/    — HWPX 스펙 참고 문서 (공개 자료)
└── .github/
    └── workflows/
        └── pages.yml   — GitHub Pages 자동 배포 (미러 용도)
```

### 의존성 (CDN, 빌드 불필요)

| 라이브러리 | 버전 | 용도 |
|-----------|------|------|
| [JSZip](https://stuk.github.io/jszip/) | 3.10.1 | HWPX ZIP 패키징, DOCX/IPYNB 압축 해제 |
| [marked.js](https://marked.js.org/) | 9.1.6 | Markdown → HTML 파싱 |
| [SheetJS](https://sheetjs.com/) | 0.18.5 | XLSX 파일 읽기 |

빌드 과정이 없습니다. `index.html`을 브라우저에서 직접 열거나 정적 파일 서버로 서빙하면 동작합니다.

---

## 개발 가이드

### 로컬 실행

```bash
# 정적 파일 서버 (Node.js)
npx serve .

# 또는 Python
python -m http.server 8080
```

> `file://` 프로토콜로는 서비스 워커와 일부 fetch 기능이 동작하지 않으므로 로컬 서버를 사용하세요.

### 새 포맷 파서 추가

1. `js/parsers.js`에 `parseXxx()` 함수 추가 (IR 구조 반환)
2. `js/parsers.js` 맨 아래 `PARSERS` 맵에 확장자 항목 추가
3. `index.html`에 `.format-card` 추가 (`data-ext="xxx"`)
4. `js/app.js`의 `FORMAT_INFO`에 같은 키(`xxx`)로 포맷 설명 객체 추가
5. 파일 선택창에서 바로 보이게 하려면 `index.html`의 `<input id="file-input" accept="...">`에 확장자 추가

### Parser / Resolver / IR / Renderer 경계

포맷 품질을 같은 기준으로 유지하려면 다음 책임을 섞지 않습니다.

1. **Parser**: 원본 문법·파일 구조를 읽어 포맷 중간 IR을 만듭니다.
2. **Resolver**: 원격/내부 리소스 확보, MIME·크기 검증, 실패 fallback을 포맷별로 처리합니다.
3. **공통 IR**: `para.runs[]`와 최종 `image` 블록처럼 Renderer가 이해하는 하나의 계약으로 정규화합니다.
4. **Renderer**: 입력 확장자를 분기하지 않고 IR만 HWPX로 출력합니다.
5. **Gate**: 링크 필드 쌍, 그림 4단 참조, XML/IDRef/표 격자를 검사합니다.

공용 `js/hwpx.js`를 바꾸면 전체 golden을 실행합니다. Markdown 변경은 IPYNB Markdown 셀을 함께 검사하고, 이미지 패키징 변경은 기존 DOCX 그림 게이트도 함께 실행합니다. 세부 계약은 `AGENTS.md`와 `hwpx-public-doc/references/ir_schema.md`를 기준으로 합니다.

### 배포 후 반드시 맞춰야 하는 세 가지

배포할 때마다 아래 세 곳을 함께 올려야 사용자가 보는 버전과 실제 캐시가 어긋나지 않습니다:

1. `sw.js` → `CACHE_VERSION = 'to-hwpx-vX.X.X'`
2. `changelog.json` → `"current": "X.X.X"` + `versions` 배열 최상단에 항목 추가
3. `index.html` → `📋 vX.X.X` 버튼 문구

### 폰트 파일 제공

`fonts/` 폴더에 TTF 파일을 두면 **폰트 설치 안내** 팝업에 다운로드 버튼이 표시됩니다. 자세한 파일명은 [fonts/README.md](./fonts/README.md) 확인.

HWPX 생성 로직은 폰트 이름만 기록하고 임베딩하지 않으므로, 사용자가 한컴오피스에서 같은 모양으로 보려면 해당 폰트를 PC에 설치해야 합니다.

---

## 상용화 전 최종 마무리 계획

### 1. 잔여 버그 수정 내역

| 항목 | 조치 | 검증 기준 |
|------|------|-----------|
| 모바일 상단 메뉴가 열리지 않거나 위치가 어긋나는 문제 | 모바일 메뉴 표시 선택자를 `#main-nav.open` 기준으로 수정하고 항목 폭을 100%로 정렬 | 360px/390px/768px 폭에서 메뉴 열기·닫기·외부 클릭 닫기 확인 |
| 모바일 다운로드가 ZIP로 보이는 문제 | HWPX Blob MIME 타입, 다운로드 링크 type, `.hwpx` 파일명 정규화 추가 | Android/iOS 저장 UI에서 파일명이 `.hwpx`로 유지되는지 확인 |
| HWP 카드 아이콘이 태극기로 보이는 문제 | 이모지 대신 HWP 문서형 CSS 아이콘 적용 | 데스크톱/모바일 포맷 카드에서 동일한 아이콘 표시 |
| 표 머리글과 외곽선 규격 불일치 | 첫 행 배경 `#D9D9D9`, 좌우 바깥 테두리 `NONE` borderFill 적용 | 생성된 HWPX를 한글에서 열어 표 첫 행 색상과 좌우 바깥선 확인 |
| 동작 설명과 실제 파이프라인 단계 불일치 | 사용자 안내 문구를 7단계 파이프라인 기준으로 정정 | 앱 화면과 README의 단계 설명이 일치 |

### 2. UX 재검토에 따른 개선 사항

| 영역 | 개선 사항 | 완료 기준 |
|------|-----------|-----------|
| 첫 화면 신뢰 정보 | PC 브라우저, 모바일 브라우저, PWA 설치 가능 배지 추가 | 방문 직후 지원 환경을 즉시 이해 |
| 모바일 가독성 | 480px 이하에서 옵션 그리드 1열 전환, 카드 텍스트 줄바꿈 보강 | 긴 텍스트가 버튼·카드 밖으로 넘치지 않음 |
| 지원 현황 | 지원 표에 PC/모바일 브라우저 지원 행 추가 | 모바일 동작 가능 여부를 문서와 앱 안에서 모두 확인 가능 |
| 다운로드 피드백 | 자동/수동 다운로드 링크에 HWPX 타입과 파일명 보정 적용 | 자동 다운로드 실패 시에도 완료 카드에서 재다운로드 가능 |
| 캐시 갱신 | 서비스 워커 캐시 버전 갱신 | 배포 후 이전 캐시가 새 파일을 가리지 않음 |

### 3. 최종 배포 체크리스트

| 구분 | 체크 항목 | 상태 |
|------|-----------|------|
| 코드 검증 | `node --check js/app.js`, `node --check js/hwpx.js` 통과 | 완료 |
| 데이터 검증 | `changelog.json` JSON 파싱 통과 | 완료 |
| 데스크톱 QA | MD/TXT/CSV/XLSX 샘플 변환, 결과 파일 한글에서 열기 | 배포 전 수동 확인 |
| 모바일 QA | Android Chrome, iOS Safari에서 파일 선택·변환·다운로드 확인 | 배포 전 수동 확인 |
| PWA/캐시 | `sw.js` `CACHE_VERSION` 최신 버전 반영 | 완료 |
| 릴리스 기록 | `changelog.json` 최신 버전 추가, 상단 업데이트 버튼 버전 일치 | 완료 |
| 배포 | `main` 브랜치 푸시 후 Vercel 배포 성공 확인 | 배포 후 확인 |
