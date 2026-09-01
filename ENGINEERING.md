# To-Hwpx 엔지니어링 루프

## 목적

이 문서는 변환 품질 변경을 “코드가 실행됨”이 아니라 “입력 결함을 설명하고, 구조 보존을 계수하고, 한컴 화면을 전수 확인할 수 있음”으로 완료시키는 작업 하네스다.

## 변경 루프

1. **Sync** — `git fetch origin` 후 작업 기준이 `origin/main`과 일치하는지 확인한다.
2. **Observe** — 원본 DOCX, 기존 HWPX, PDF를 각각 입력·실패 산출물·시각 증거로 구분한다.
3. **Audit** — OOXML 결함 코드와 구조 기준선(문단/표/행/셀/줄바꿈/그림/섹션)을 기록한다.
4. **Model** — 보존할 정보를 IR v2 계약에 먼저 추가한다. 렌더러가 DOCX 확장자를 보게 하지 않는다.
5. **Render** — hwpxlib 샘플과 한컴 생성 파일을 대조해 HWPX 구조를 만든다.
6. **Gate** — lint, impact graph, DOCX fidelity, golden, commercial, accessibility, performance를 실행한다.
7. **Visual loop** — 한컴 COM으로 HWPX를 PDF 내보내기하고 모든 페이지를 contact sheet로 렌더한다. 빈 페이지, 잘림, 거대 행, 표 폭, 글자 크기를 확인한 뒤 필요한 경우 3단계로 돌아간다.
8. **Release** — 버전·changelog 동기화, 커밋, push, PR, merge, main 재동기화 순서로 끝낸다.

## 명령 하네스

```powershell
npm run test:impact
npm run test:docx
npm run test:golden
npm run test:package
npm run test:release

node qa/docx-fidelity-harness.js "C:\path\input.docx" --out "$env:TEMP\candidate.hwpx" --report "$env:TEMP\report.json"
powershell -ExecutionPolicy Bypass -File qa/hwp-export-pdf.ps1 -InputPath "$env:TEMP\candidate.hwpx" -OutputPath "$env:TEMP\candidate.pdf"
uv run --with pymupdf --with pillow python qa/render-pdf-contact-sheets.py "$env:TEMP\candidate.pdf" "$env:TEMP\candidate-pages"
```

## 품질 판정표

| 축 | 자동 판정 | 시각 판정 |
|---|---|---|
| 입력 건전성 | audit status, 결함 코드·개수 | 원본이 Word/한컴에서 열리는지 |
| 구조 보존 | 표/행/셀 exact, 문단 ≥97%, 줄바꿈 ≥입력 | 표가 페이지 사이에서 읽을 수 있게 이어지는지 |
| 페이지 | 용지·방향·여백 exact | 불필요한 빈 페이지, 비정상 폭, 잘림 |
| 패키지 | mimetype, XML, IDRef, 격자, CRC32 | 한컴에서 경고 없이 열림 |
| 기대치 | 결과 카드의 보존/손실·감사 수치 | 사용자 확인 결과 |

페이지 수 자체는 합격 기준이 아니다. Word와 한컴의 줄/표 나눔 엔진이 다르기 때문이다. 대신 구조 개수와 모든 페이지의 내용 흐름을 함께 본다.

## 그래프 엔지니어링

변경 영향의 기계 판독 원본은 [qa/impact-graph.json](qa/impact-graph.json)이다. `qa/impact-gate.js`는 노드·간선·파일 존재를 검사하고 현재 변경에 필요한 테스트와 동반 문서를 출력한다.

```text
docx-audit → docx-parser → IR-v2 → hwpx-renderer → package-validator
      └──────────────→ fidelity-fixture/harness ───────→ Hancom PDF visual QA
UI expectation ───────────────────────────────────────→ result audit card
```

## 실패 시 중단 기준

- `blocked` 입력을 임의 복구해서 계속하지 않는다.
- 표/행/셀 또는 수동 줄바꿈 수가 감소하면 릴리스하지 않는다.
- 한컴 PDF 전수 렌더에서 빈 페이지·잘림·누락을 발견하면 자동 게이트가 통과해도 완료로 처리하지 않는다.
- 사용자 제공 원본을 덮어쓰지 않는다. 개선본은 별도 이름으로 저장한다.
