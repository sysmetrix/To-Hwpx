# To HWPX

｢BWYF｣ AX Challenger 2026 프로젝트로 제작된 브라우저에서 바로 실행되는 문서 변환기입니다. Markdown, DOCX, HTML 등 다양한 포맷을 한글 오피스(.hwpx) 파일로 변환합니다.

**정식 운영 주소:** https://to-hwpx.vercel.app/

**재해복구 미러:** https://sysmetrix.github.io/To-Hwpx/

---

## 주요 특징

- **로컬 변환** — 원본 파일과 변환된 HWPX는 서버에 업로드되지 않습니다. 단, Markdown 원격 이미지는 해당 이미지 서버에 브라우저가 직접 요청하고, 정밀 미리보기(베타)를 누르면 외부 rhwp iframe에 생성된 HWPX 바이트를 전달합니다. HWP5 엔진은 같은 서비스 도메인에 고정 배포합니다.
- **설치 불필요** — 한컴 오피스 없이도 .hwpx 파일을 생성합니다.
- **PC·모바일 지원** — 데스크톱과 모바일 브라우저에서 같은 변환 흐름으로 동작합니다.
- **드래그앤드롭** — 파일을 끌어다 놓거나 클릭해서 선택합니다.
- **직접 입력(베타)** — 파일 없이 MD·HTML·TXT·CSV·JSON 텍스트를 바로 붙여넣어 변환합니다. 실시간 미리보기와 HTML 복사·다운로드도 지원합니다.
- **PWA 지원** — 오프라인에서도 동작합니다 (서비스 워커 캐싱).
- **다양한 옵션** — 한글 폰트, 글꼴 크기, 용지 크기, 여백 등을 자유롭게 설정합니다.

---

## 지원 포맷

### 기본 서비스 (즉시 사용 가능)

| 포맷 | 품질 | 특징 |
|------|------|------|
| **MD** (Markdown) | ★★★ | 제목·표·코드블록·목록·클릭 가능한 본문 링크·삽입 가능한 이미지 지원. 상대경로·접근 차단 이미지는 대체 문구 처리. |
| **HTML** | ★★☆ | h1~h6, table, ul/ol 등 주요 태그 지원. CSS 레이아웃·이미지 무시. |
| **DOCX** (Word) | ★★★ | 본문·제목 후보·목록·하이퍼링크·표·이미지·각주·주석(각주 형태)과 주요 인라인 서식 지원. 페이지 배치와 복잡한 Word 개체는 손실 가능. |
| **HWP** (한글) | ★★☆ | HWP5 바이너리 본문 텍스트를 추출(표·이미지·서식은 제외). HWPX 업로드는 복구/예외용 텍스트 추출 경로이며, 기본적으로 HWPX는 출력 형식입니다. |
| **TXT** | ★★★ | 빈 줄 기반 문단 구분. EUC-KR 자동 감지. |
| **CSV / XLSX** | ★★☆ | CSV 전체 또는 XLSX 첫 시트를 표로 변환. XLSX는 안전한 작업자에서 최대 20MB·20,000행·256열까지 처리하며 셀 서식·병합은 손실. |
| **JSON** | ★★☆ | 객체·배열 값을 문단·목록·표로 펼침. 보고서형 레이아웃 자동 설계는 하지 않음. |

### 확장 서비스

| 포맷 | 품질 | 상태 |
|------|------|------|
| **IPYNB** (Jupyter Notebook) | ★★☆ | 지원됨. 마크다운·코드·출력 셀(이미지 포함) 변환. |
| **PPTX** (PowerPoint) | ★☆☆ | 지원됨(베타). 슬라이드 순서대로 제목·본문·표·그림·발표자 노트 추출. 레이아웃·애니메이션·도형 위치는 손실. |
| **PDF** | ★★☆ | 개발 예정 (백엔드 필요). |
| **ODT / RTF** | ★★☆ | 개발 예정. |
| **EPUB** | ★★☆ | 개발 예정. |

---

## 사용 방법

1. **파일 선택** — 드롭존에 파일을 드래그하거나 클릭하여 선택합니다.
2. **옵션 설정** — 한글 폰트, 글꼴 크기, 용지 크기, 여백을 필요에 맞게 변경합니다.
3. **변환** — `변환하기` 버튼을 클릭하면 7단계 파이프라인이 실행됩니다.
4. **다운로드** — 변환 완료 후 자동 다운로드되거나, 완료 카드에서 다시 받을 수 있습니다.

> **HWP 파일을 더 잘 변환하려면:** 한글 프로그램에서 `파일 → 다른 이름으로 저장` 후 파일 형식을 **HWPX(\*.hwpx)** 로 변경하여 저장한 뒤 업로드하면 훨씬 높은 품질로 변환됩니다.

## 명령줄과 AI 에이전트 (tohwpx CLI · MCP)

웹앱과 **같은 렌더러**를 Node에서도 쓸 수 있습니다. 두 경로가 같은 HWPX를 만드는지는 `npm run test:core`가 엔트리 단위로 검사합니다.

### CLI

```bash
node js/core/cli.js README.md                 # README.hwpx 생성
node js/core/cli.js notes.md -o 보고서.hwpx --font 함초롬바탕
node js/core/cli.js data/*.csv --out-dir build --paper A3 --orientation landscape
node js/core/cli.js --help
```

지원 입력은 `.md` `.markdown` `.csv` `.tsv` `.txt` `.json` `.pdf`입니다. HTML·DOCX·PPTX·XLSX·IPYNB·HWP는 DOM이나 추가 엔진이 필요해 아직 웹앱에서만 변환합니다. CLI는 그런 입력을 **조용히 다르게 처리하지 않고 이유를 말하며 거절**합니다.

종료 코드: `0` 성공 / `1` 변환 실패·구조 경고 / `2` 사용법 오류.

### 역방향 — HWPX에서 뽑아내기

```bash
node js/core/cli.js 공문.hwpx --to md      # 공문.md
node js/core/cli.js 공문.hwpx --to html    # 공문.html
```

표는 Markdown 표로, 링크는 Markdown 링크로, 목록은 중첩·순서·체크 상태까지 유지합니다.

**레이아웃 복제가 아니라 구조 추출입니다.** 서식·여백·글꼴은 포함되지 않고, 그림은 파일 이름만 참조합니다(바이트는 내보내지 않음). 결과에 그 사실을 함께 표시합니다.

### 신구조문대비표

```bash
node js/core/cli.js 개정안.txt --diff 현행.txt -o 신구조문대비표.hwpx
node js/core/cli.js 개정안.txt --diff 현행.txt --changed-only
```

현행 순서를 기준으로 정렬하고, 새 항목은 현행 칸에 `<신설>`, 없앤 항목은 개정안 칸에 `<삭제>`로 표시합니다. 조문 번호(`제N조`)가 같으면 같은 조문의 개정으로 짝짓습니다.

**문단 단위 비교입니다.** 조·항·호 단위 대비는 하지 않습니다.

### MCP 서버

AI 에이전트가 한/글 설치 없이 HWPX를 만들 수 있습니다.

```json
{
  "mcpServers": {
    "tohwpx": { "command": "node", "args": ["<저장소 경로>/js/core/mcp-server.js"] }
  }
}
```

| 도구 | 하는 일 |
|---|---|
| `markdown_to_hwpx` | Markdown → HWPX |
| `text_to_hwpx` | TXT·CSV/TSV·JSON → HWPX |
| `ir_to_hwpx` | 공통 IR(JSON)을 직접 렌더 — 정밀 제어용 |
| `pdf_to_hwpx` | PDF → HWPX. 구조를 좌표에서 추론하며 근거를 함께 반환 |
| `make_comparison_table` | 현행·개정안 → 신구조문대비표 HWPX |
| `draft_official_document` | 공문 초안 골격(두문·본문·결문) HWPX. 공식 별지 서식의 복제는 아님 |
| `read_hwpx` | HWPX를 읽어 Markdown·HTML·IR로 반환 — 읽고 고쳐 다시 쓰기의 첫 단계 |
| `get_ir_schema` | IR 스키마와 블록별 예시 반환 |

범위를 좁게 유지합니다. 읽기·편집 도구를 늘리는 대신 **생성 품질**만 보증합니다.

- 표를 텍스트 행으로 평탄화하지 않습니다(셀 병합·머리행 유지).
- 링크를 표시 문자열로 죽이지 않습니다(`hp:fieldBegin` 하이퍼링크).
- 그림을 `BinData`·manifest·`content.hpf`까지 연결해 넣습니다.
- **구조 검증에 실패한 산출물은 파일로 쓰지 않습니다.** 에이전트가 성공으로 읽고 넘어가면 깨진 문서가 사람 손에 들어가기 때문입니다.

구조 검증 통과가 한컴에서 보이는 것까지 보증하지는 않습니다. 최종 확인은 한컴오피스에서 하세요.

## 개인정보와 외부 요청

원본 파일과 생성된 HWPX는 서버에 업로드하지 않습니다. 브라우저가 외부로 접속하는 경우는 다음으로 제한됩니다.

- 핵심 라이브러리(JSZip, marked, SheetJS)와 기본 웹폰트는 저장소에 고정해 같은 서비스 도메인에서 제공합니다.
- 사용자가 익명 통계에 동의한 경우에만 PostHog 페이지뷰·사용 이벤트
- Markdown 원격 이미지가 있는 경우 해당 이미지 URL 직접 요청
- HWP5 입력 처리 시 같은 서비스 도메인의 고정 `@rhwp/core` WASM 로드
- 사용자가 정밀 미리보기(베타)를 확인한 경우 외부 rhwp iframe 로드와 생성 HWPX 바이트 전달

분석 도구에는 문서 본문, 파일명, 문서 제목, URL, 변환된 HWPX 바이트를 보내지 않습니다. 통계 수집을 거부해도 변환 기능을 사용할 수 있고 지원 환경의 로컬 처리 탭에서 언제든지 변경할 수 있습니다.

정식 운영 정책은 [개인정보처리방침](./privacy.html), [이용약관](./terms.html), [오픈소스·글꼴 고지](./notices.html)를 확인하세요.

---

## 연계 서비스

| 서비스 | 설명 |
|--------|------|
| [MD→HWPX 직접 입력](https://md-to-hwpx.vercel.app/) | Markdown 텍스트를 직접 입력해서 HWPX로 변환 |
| [MD→HTML 변환기](https://md-to-html-seven.vercel.app/) | Markdown을 HTML로 변환 |

---

## 업데이트 내역

최신 변경 사항은 [changelog.json](./changelog.json)에서 확인할 수 있습니다. 페이지 상단의 **📋 vX.Y.Z** 버전 버튼은 관리자 모드(`?admin=1`, 기존 `?lab=1` 호환)에서만 업데이트 내역 창을 엽니다.

---

## 라이선스

MIT License — 자유롭게 사용, 수정, 배포할 수 있습니다.

운영·장애 대응 기준은 [OPERATIONS.md](./OPERATIONS.md), 수동 출시 승인은 [qa/manual-release-evidence-template.md](./qa/manual-release-evidence-template.md)를 사용합니다.

© 2026 BWYF / sysmetrix
