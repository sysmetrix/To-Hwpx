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
| XLSX 자동 fixture | `tests/fixtures/sample.xlsx` | 첫 시트·빈 셀·수식 표시값 보존, 두 번째 시트 제외 |
| TXT 인코딩 | `tests/fixtures/sample.txt`, `sample-euckr.txt` | UTF-8/EUC-KR 한글·문단·목록 보존 |

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
- `hc:img@binaryItemIDRef`가 `content.hpf` item, `BinData`, package manifest와 연결되는지 확인
- 일반 데이터 표가 `pageBreak="TABLE"`, `repeatHeader="1"`, `treatAsChar="0"`, `hp:outMargin@bottom="850"`이고 첫 행 셀이 `header="1"`인지 확인
- 코드 블록 표의 `hp:outMargin@bottom="850"`, 인용구 `paraPr id=19`의 `hh:next value="850"` 및 코드 글자 모양이 사용자가 선택한 글꼴 id를 참조하는지 확인
- 구분선 표의 `hp:outMargin@top/bottom="850"`과 구분선 앞뒤 외부 빈 문단 제거 여부 확인
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
- [ ] 짧은 일반 표와 다음 본문 사이에 아래쪽 바깥 여백 약 3mm가 보이며, 긴 표의 쪽 나눔에는 불필요한 중간 간격이 생기지 않음
- [ ] Markdown 문장 속 인라인 코드가 앞뒤 문장과 같은 문단에 표시되고, 단독 코드 문단은 기존 코드 블록 형태 유지
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

- [x] `npm run test:golden` PASS — 기존 7개 입력 + Lab + 상용 UX 회귀
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

## 17. v4.5.14 구분선 표 바깥 여백

- [x] 구분선 표 `hp:outMargin@top/bottom="850"`(각 약 3mm) 자동 검사
- [x] 구분선 앞뒤 외부 `paraPrIDRef="9"` 빈 문단이 없는지 자동 검사
- [x] `npm run test:golden` PASS
- [x] `node qa/gate.js qa/fixtures/md_hwpx_test.md` PASS
- [ ] 한컴오피스에서 구분선 위아래 3mm와 불필요한 빈 문단 제거 확인

## 18. v4.5.15 실험실 설정 UI

- [x] 실험실 설정이 아이콘·상태 배지·스위치로 표시됨
- [x] 활성/비활성 상태가 `aria-pressed`와 `사용 중`/`꺼짐` 문구에 함께 반영됨
- [x] 모바일 폭과 다크 테마 디자인 토큰 대응
- [x] `npm run test:golden` PASS
