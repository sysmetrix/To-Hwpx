# 오픈소스·글꼴 고지

최종 갱신: 2026-09-02

To HWPX 본체는 루트 `LICENSE`의 MIT License로 배포됩니다. 아래 구성요소의 저작권과 라이선스는 각 원저작자에게 있습니다.

## 브라우저 라이브러리

| 구성요소 | 고정 버전 | 라이선스 | 배포 파일 |
|---|---:|---|---|
| JSZip | 3.10.1 | MIT | `js/vendor/jszip-3.10.1.min.js`, `js/vendor/JSZIP-LICENSE.txt` |
| marked | 18.0.11 | MIT | `js/vendor/marked-18.0.11.min.js`, `js/vendor/MARKED-LICENSE.txt` |
| SheetJS Community Edition | 0.20.3 | Apache-2.0 | `js/vendor/xlsx-0.20.3.full.min.js`, `js/vendor/SHEETJS-LICENSE.txt` |
| @rhwp/core | 0.8.4 | MIT | `js/vendor/rhwp-core-0.8.4/`의 JS·WASM·LICENSE, HWP5 입력 때만 실행 |
| rhwp viewer | 외부 서비스 | 원 프로젝트 고지 참조 | 사용자가 정밀 미리보기에 동의할 때만 iframe 로드 |

고정 브라우저 파일의 SHA-256은 `qa/vendor-integrity.json`에 기록하고 CI에서 검증합니다.

## 글꼴

| 글꼴 | 권리자/출처 | 라이선스·조건 |
|---|---|---|
| Inter | The Inter Project Authors | SIL Open Font License 1.1, `fonts/OFL-1.1.txt` |
| Noto Sans KR | Google Noto Fonts | SIL Open Font License 1.1, `fonts/OFL-1.1.txt` |
| NanumGothic | NAVER | SIL Open Font License 1.1, `fonts/OFL-1.1.txt`; Reserved Font Name 조건 유지 |
| Pretendard GOV | 길형진 및 기여자 | SIL Open Font License 1.1, `fonts/OFL-1.1.txt` |
| KoPubWorldDotum | 한국출판인회의 | 재배포 조건의 별도 최종 확인 전에는 운영 배포에서 제외하며 공식 사이트 링크만 제공 |

글꼴 파일 자체를 단독으로 판매하지 않습니다. 글꼴을 수정하여 재배포할 경우 각 라이선스의 Reserved Font Name 및 이름 변경 조건을 별도로 확인해야 합니다.

## 외부 처리 경계

- Markdown 원격 이미지: 사용자가 입력한 이미지 서버로 브라우저가 직접 요청합니다.
- HWP5 입력: 같은 서비스 도메인에서 고정된 @rhwp/core 코드와 WASM을 로드합니다.
- 정밀 미리보기: 별도 확인 후 외부 rhwp iframe에 생성 HWPX 바이트를 전달합니다.
- PostHog: 사용자가 익명 통계에 동의한 경우에만 로드합니다.

세부 내용은 `privacy.html`과 `terms.html`을 참조하세요.
