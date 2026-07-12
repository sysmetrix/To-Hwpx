# To HWPX 운영 기준

최종 갱신: 2026-07-12

## 서비스 등급과 목표

- 정식 주소: `https://to-hwpx.vercel.app/`
- 재해복구 미러: `https://sysmetrix.github.io/To-Hwpx/`
- 월 가용성 목표: 99.9%
- 운영 감지 목표: 15분 이내
- P0(전체 접속/다운로드 불가, 문서 외부 전송) 대응 시작: 감지 후 30분 이내
- P1(주요 포맷 전체 실패) 대응 시작: 영업시간 4시간 이내
- 롤백 목표: 결정 후 10분 이내

GitHub Actions의 `운영 서비스 감시`가 15분마다 두 주소의 응답, 배포 버전, Vercel 보안 헤더, 핵심 vendor 해시를 확인한다. 실패 알림 수신자는 저장소 Watch 설정에서 Actions 알림을 활성화한다.

## 릴리스 승인

1. 작업 브랜치에서 `npm ci`.
2. `npm run test:release`.
3. `node tests/orientation-e2e.js`.
4. `qa/release-qa.md`의 해당 버전 자동·수동 항목 기록.
5. 버전 범프 및 `changelog.json` 일치 확인.
6. PR에서 Pages 워크플로 성공 확인 후 병합.
7. Vercel과 Pages 모두 새 버전인지 `node qa/production-smoke.js`로 확인.
8. 한컴오피스 시각 검증 결과와 확인자·환경을 릴리스 QA에 기록.

테스트한 커밋 SHA는 PR merge SHA 및 GitHub Actions 실행의 `head_sha`와 일치해야 한다. 운영 배포가 다른 SHA를 가리키면 출시 승인을 취소한다.

## 롤백

1. 마지막 정상 릴리스의 merge SHA와 버전을 확인한다.
2. 문제 커밋을 새 PR에서 `git revert`한다. 공개 이력이므로 강제 push나 hard reset은 사용하지 않는다.
3. 서비스워커 캐시가 바뀐 경우 새 patch 버전으로 `CACHE_VERSION`을 다시 올린다.
4. 긴급 PR도 최소 `test:commercial`, 관련 golden, HWPX gate를 통과해야 한다.
5. 병합 후 Vercel/Pages 버전과 보안 헤더를 production smoke로 확인한다.
6. 장애 원인·영향·탐지·복구·재발방지를 `qa/release-qa.md`에 기록한다.

## 개인정보·오류 제보

- 분석은 명시 동의 후에만 활성화하며 문서 내용·파일명·HWPX 바이트를 이벤트에 넣지 않는다.
- 오류 제보에는 실제 민감 문서를 첨부하지 않도록 안내한다.
- 재현 파일이 필요하면 개인정보를 제거한 최소 fixture를 새로 만들어 사용한다.
- 문서 외부 전송 가능성이 의심되면 분석과 외부 미리보기를 우선 비활성화하고 P0로 처리한다.

## 수동 검증 환경

릴리스마다 Chrome, Edge, Firefox, Safari와 iPhone Safari/Android Chrome에서 파일 선택·변환·자동/수동 다운로드를 확인한다. HWPX는 운영에서 지정한 한컴오피스 버전과 Windows 환경을 기록해 MD, DOCX, XLSX, PPTX, HWP5 대표 파일을 직접 연다. 자동 게이트 통과는 이 시각 확인을 대체하지 않는다.
