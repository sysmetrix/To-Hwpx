# To HWPX Release QA

Date: 2026-06-20
Scope: static browser-only conversion flow from file selection to HWPX download.

## 1. Release Risk Diagnosis

| Severity | 위치 | 문제 | 사용자 영향 | 수정 방향 | 난이도 |
| --- | --- | --- | --- | --- | --- |
| Critical | `js/app.js` `handleFileSelect()`, `js/parsers.js` `fileToIR()` | 지원하지 않는 확장자가 오류 문서로 HWPX 생성될 수 있음 | 사용자가 실패를 성공으로 오해 | 선택 단계에서 차단하고 파서 실패는 변환 중단 | Low |
| High | `js/app.js` 배치 변환 | 다중 파일을 큐로 순차 변환(부분 실패 허용) — 일부 실패가 전체를 막거나 결과 누락될 위험 | 일부 파일 누락/오해 | 파일별 상태 표시 + 실패해도 계속 + 전체 ZIP/개별 다운로드 | Medium |
| High | `js/app.js` 결과 카드 | 변환 후 보존/손실 가능 요소 안내 부족 | DOCX/HTML/XLSX 서식 손실을 품질 오류로 인식 | 결과 카드에 포맷별 보존/손실 안내 표시 | Medium |
| High | `js/parsers.js` DOCX/HWPX ZIP 처리 | 손상 ZIP/비정상 구조가 오류 문서로 변환될 수 있음 | 실패 파일을 정상 결과로 오해 | 손상/비정상 ZIP은 파싱 실패로 중단 | Medium |
| Medium | `index.html` 미리보기 안내 | rhwp 미리보기와 한컴오피스 결과 차이 고지 약함 | 최종 렌더링 오해 | 글꼴/여백/표 너비 차이 가능성 명시 | Low |
| Medium | `sw.js` 캐시 | 배포 후 오래된 JS/CSS 캐시 가능 | 최신 안내/방어 로직 미반영 | 변경 시 `CACHE_VERSION` 갱신 | Low |
| Low | `qa/fixtures` 부재 | 반복 회귀 테스트 기준 부족 | 릴리스마다 수동 확인 누락 | 작은 샘플 입력과 체크리스트 추가 | Low |

## 2. Conversion Quality Test Matrix

| 포맷 | 테스트 입력 | 기대 결과 |
| --- | --- | --- |
| MD | `qa/fixtures/sample.md` | 제목, 본문, 목록, 표, 코드블록, 구분선 생성. 이미지/복잡 CSS 없음 안내 |
| HTML | `qa/fixtures/sample.html` | 스크립트 미실행, 텍스트/표/목록만 추출 |
| DOCX | 수동 DOCX 샘플 | 본문, 표, 일부 굵게/기울임, 이미지, 첫 머리글/바닥글, 각주 텍스트 보존. 페이지 배치·복잡 개체 손실 안내 |
| TXT | `qa/fixtures/sample.txt`, `empty.txt` | 순수 텍스트 변환, 빈 문서도 오류 없이 처리 |
| CSV/XLSX | `sample.csv`, 수동 XLSX 샘플 | 첫 행 머리글, 숫자 오른쪽 정렬, 복잡 서식 손실 안내 |
| JSON | `qa/fixtures/sample.json` | 제목, 목록, 객체 표 또는 텍스트 단순화 |
| IPYNB | `qa/fixtures/sample.ipynb` | 마크다운/코드/텍스트 출력 추출, 이미지 출력 손실 안내 |
| HWP/HWPX | 앱 생성 HWPX, HWP5 샘플 | HWPX 텍스트 재추출, HWP5는 변환 안내 메시지 |

## 3. Edge Cases

| 케이스 | 기대 결과 |
| --- | --- |
| 한글/이모지/특수문자 | XML 생성 오류 없이 텍스트 보존 |
| 긴 파일명 | 다운로드 파일명이 `.hwpx`로 끝남 |
| 잘못된 확장자 | 변환 버튼 비활성화 및 지원 형식 안내 |
| 손상 ZIP `.docx` | HWPX 생성 없이 파싱 실패 안내 |
| 대용량 파일 | 텍스트 100MB, 바이너리 50MB 초과 시 사전 차단 |
| 다중 파일 드롭(배치) | 파일별 큐 적재(미지원/초과분 제외 토스트), 순차 변환, 파일별 상태 표시 |
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
- 일반 데이터 표가 `pageBreak="TABLE"`, `repeatHeader="1"`, `treatAsChar="0"`이고 첫 행 셀이 `header="1"`인지 확인
- 다운로드 링크의 파일명과 `type="application/hwp+zip"` 확인

## 5. Security and Privacy Checks

- HTML/Markdown/JSON 입력은 `textContent` 또는 XML escape 경로로만 출력
- IR 미리보기는 `textContent` 사용
- 문서 내용은 서버로 전송하지 않음
- 외부 요청은 CDN 라이브러리, Google Fonts, rhwp 미리보기 iframe, 공식 폰트 링크로 제한
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
- [ ] 직접 입력 탭: 형식 선택 + 내용 붙여넣기 → 변환·다운로드 동작
- [ ] 직접 입력 ↔ 파일 업로드 탭 전환 시 입력·결과 초기화, 파일 드롭 시 업로드 모드 자동 전환
- [ ] HWPX ZIP 구조 검증 PASS
- [ ] `long-table.csv` 변환 후 한컴에서 표가 두 쪽 이상으로 나뉘고, 다음 쪽에도 제목 줄이 자동 반복됨
- [ ] 긴 표가 글자처럼 취급되지 않으며 단 오른쪽 정렬로 설정되고, 행 높이·열 너비·병합 셀이 깨지지 않음
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
