# 상용화 개선 실행 현황

기준일: 2026-07-12 / 대상 릴리스: v4.13.0

| 계획 | 상태 | 구현·증적 |
|---|---|---|
| 운영 기준 소스 동기화 | 완료 | `origin/main` v4.12.1에서 시작, v4.13.0 단일 릴리스로 작업 |
| SheetJS 취약점 제거 | 완료 | 0.20.3 자체 호스팅, vendor SHA-256, 취약 URL 재유입 게이트 |
| 악성 XLSX UI 정지 방어 | 완료 | Web Worker, 15초/20MB/행·열·셀 제한, 손상 입력 golden |
| CDN·웹폰트 공급망 축소 | 완료 | JSZip/marked/SheetJS/@rhwp/core/Noto Sans KR 같은 도메인 배포 |
| 보안 응답 헤더 | 구현 완료·배포 확인 대기 | `vercel.json`, production smoke |
| 분석 사전 동의·최소수집 | 코드 완료·대시보드 설정 확인 대기 | 동의/거부 UI, allowlist, recording off, memory persistence |
| 개인정보·약관·라이선스 | 초안/구현 완료·운영자 승인 대기 | `privacy.html`, `terms.html`, `LICENSE`, `THIRD_PARTY_NOTICES.md` |
| 글꼴 재배포 경계 | 완료 | OFL 포함, KoPub 운영 배포 제외 |
| 자동 품질 게이트 | 완료 | lint, commercial, golden, axe, performance, HWPX gate, orientation |
| 브라우저 호환 | Chromium·WebKit 완료, Firefox CI/실기기 대기 | `tests/browser-readiness.js` |
| 운영 감시·롤백 | 완료 | 15분 production smoke, `OPERATIONS.md` 10분 롤백 절차 |
| 한컴 시각 검증 | 담당자 실행 대기 | `qa/manual-release-evidence-template.md` |
| 모바일 실기기 검증 | 담당자 실행 대기 | 동일 증적 템플릿 |

정식 GA 전 남은 외부 승인 항목은 코드로 대신 완료 처리하지 않는다. PostHog 보유기간, 법적 운영 주체, 실제 Firefox/모바일, 한컴오피스 렌더링 결과가 모두 기록돼야 최종 승인한다.
