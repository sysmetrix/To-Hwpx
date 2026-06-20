# To HWPX

｢BWYF｣ AX Challenger 2026 프로젝트로 제작된 브라우저에서 바로 실행되는 문서 변환기입니다. Markdown, DOCX, HTML 등 다양한 포맷을 한글 오피스(.hwpx) 파일로 변환합니다.

**GitHub Pages 배포:** https://sysmetrix.github.io/To-Hwpx/

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

### 절대 함부로 바꾸면 안 되는 것

- `id="..."`: JavaScript가 화면 요소를 찾는 연결 이름입니다.
- `class="..."`: CSS 스타일과 일부 JavaScript 동작이 연결됩니다.
- `data-ext="..."`: 포맷 카드와 파서/팝업 설명을 연결합니다.
- `<script src="js/parsers.js">`, `<script src="js/hwpx.js">`, `<script src="js/app.js">` 순서: 실행 순서가 중요합니다.
- `integrity="..."`: CDN 파일 보안 검증값입니다. 라이브러리 버전을 바꿀 때만 같이 바꿉니다.

### 파일 저장 인코딩

모든 파일은 **UTF-8**로 열고 저장하세요. 한글 주석과 화면 문구가 깨져 보이면 편집기의 인코딩을 UTF-8로 바꾼 뒤 다시 열어야 합니다.

---

## 주요 특징

- **완전 로컬 처리** — 파일이 서버에 전송되지 않습니다. 모든 변환이 브라우저 안에서 이루어집니다.
- **설치 불필요** — 한컴 오피스 없이도 .hwpx 파일을 생성합니다.
- **PC·모바일 지원** — 데스크톱과 모바일 브라우저에서 같은 변환 흐름으로 동작합니다.
- **드래그앤드롭** — 파일을 끌어다 놓거나 클릭해서 선택합니다.
- **PWA 지원** — 오프라인에서도 동작합니다 (서비스 워커 캐싱).
- **다양한 옵션** — 한글 폰트, 글꼴 크기, 용지 크기, 여백 등을 자유롭게 설정합니다.

---

## 지원 포맷

### 기본 서비스 (즉시 사용 가능)

| 포맷 | 품질 | 특징 |
|------|------|------|
| **MD** (Markdown) | ★★★ | 제목·표·코드블록·목록 지원. 현재 가장 안정적인 변환 품질. |
| **HTML** | ★★☆ | h1~h6, table, ul/ol 등 주요 태그 지원. CSS 레이아웃·이미지 무시. |
| **DOCX** (Word) | ★☆☆ | 본문·단순 표·일부 굵게/기울임 추출. 복잡한 Word 서식은 손실. |
| **HWP** (한글) | ★☆☆ | HWPX(XML) 파싱 가능. HWP5 바이너리는 제한적. |
| **TXT** | ★★★ | 빈 줄 기반 문단 구분. EUC-KR 자동 감지. |
| **CSV / XLSX** | ★★☆ | CSV 전체 또는 XLSX 첫 시트를 표로 변환. 셀 서식·병합은 손실. |
| **JSON** | ★★★ | 배열→표, 객체→목록 변환. IR 형식 직접 지원. |

### 확장 서비스

| 포맷 | 품질 | 상태 |
|------|------|------|
| **IPYNB** (Jupyter Notebook) | ★★☆ | 지원됨. 마크다운·코드·출력 셀 변환. |
| **PDF** | ★★☆ | 개발 예정 (백엔드 필요). |
| **PPTX** (PowerPoint) | ★☆☆ | 개발 예정. |
| **ODT / RTF** | ★★☆ | 개발 예정. |
| **EPUB** | ★★☆ | 개발 예정. |

---

## 사용 방법

1. **파일 선택** — 드롭존에 파일을 드래그하거나 클릭하여 선택합니다.
2. **옵션 설정** — 한글 폰트, 글꼴 크기, 용지 크기, 여백을 필요에 맞게 변경합니다.
3. **변환** — `변환하기` 버튼을 클릭하면 7단계 파이프라인이 실행됩니다.
4. **다운로드** — 변환 완료 후 자동 다운로드되거나, 완료 카드에서 다시 받을 수 있습니다.

> **HWP 파일을 더 잘 변환하려면:** 한글 프로그램에서 `파일 → 다른 이름으로 저장` 후 파일 형식을 **HWPX(\*.hwpx)** 로 변경하여 저장한 뒤 업로드하면 훨씬 높은 품질로 변환됩니다.

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
| 배포 | `main` 브랜치 푸시 후 GitHub Pages Actions 성공 확인 | 배포 후 확인 |

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
├── hwpx-public-doc/    — HWPX 스펙 참고 문서 (공개 자료)
└── .github/
    └── workflows/
        └── pages.yml   — GitHub Pages 자동 배포
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

### 서비스 워커 캐시 갱신

`sw.js`의 `CACHE_VERSION`을 변경하면 이전 캐시가 자동 삭제됩니다:

```js
const CACHE_VERSION = 'to-hwpx-v4.0.3';
```

배포 시마다 버전을 올려주세요. 화면 상단 버전 문구, `changelog.json`, `CACHE_VERSION`을 함께 맞추면 사용자가 보는 버전과 실제 캐시 버전이 어긋나지 않습니다.

### 폰트 파일 제공

앱의 `fonts/` 폴더에 제공용 TTF 파일을 두면 화면의 **폰트 설치 안내** 팝업에 사용자용 다운로드 버튼이 표시됩니다. 자세한 파일명은 [fonts/README.md](./fonts/README.md)를 확인하세요.

단, 현재 HWPX 생성 로직은 폰트 파일을 문서 안에 임베딩하지 않고 폰트 이름만 기록합니다. 사용자가 한컴오피스에서 같은 모양으로 보려면 해당 폰트를 PC에 설치해야 합니다.

---

## 연계 서비스

| 서비스 | 설명 |
|--------|------|
| [MD→HWPX 직접 입력](https://md-to-hwpx.vercel.app/) | Markdown 텍스트를 직접 입력해서 HWPX로 변환 |
| [MD→HTML 변환기](https://md-to-html-seven.vercel.app/) | Markdown을 HTML로 변환 |

---

## 업데이트 내역

최신 변경 사항은 페이지 상단의 **📋 업데이트 내역** 버튼 또는 [changelog.json](./changelog.json)에서 확인할 수 있습니다.

---

## 라이선스

MIT License — 자유롭게 사용, 수정, 배포할 수 있습니다.

© 2026 [BWYF](https://www.bwyf.or.kr) / [sysmetrix](https://github.com/sysmetrix)
