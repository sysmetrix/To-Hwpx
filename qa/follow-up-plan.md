# To‑HWPX 후속 개발 계획 (2026‑06‑28 다관점 진단 기준)

> 보안 전문가 · 시니어 개발자 · 디자인 3관점 진단 후, **통합 우선순위 #1~#3을 v4.7.7에서 적용 완료**.
> 이 문서는 남은 #4(ES 모듈 전환)와, 진단·구현 과정에서 추가로 발견한 항목의 실행 계획이다.
> 다음 세션/에이전트가 바로 집어서 진행할 수 있도록 원인·근거·조치·검증을 구체적으로 적는다.

## ✅ 완료 (v4.7.7, PR #100)

- **CSP**: `index.html`에 `Content-Security-Policy` meta 추가(`script-src 'self' https://cdnjs.cloudflare.com`로 XSS 실행 통로 차단). 인라인 테마 스크립트 → `js/theme-init.js` 분리. `sw.js` 앱셸/CACHE_VERSION 갱신.
- **접근성**: `.skip-link`(본문 바로가기) 추가, `--c-text-muted` 대비 상향(라이트 `#686c75`, 다크 `#8a8f99` — 모든 표면 WCAG AA ≥4.5:1).
- **XSS 회귀 테스트**: `tests/golden.js` `validateXssHardening` — HWPX 생성 이스케이프 + `javascript:` URL allowlist + 미리보기 innerHTML 실행 차단.

---

## A. 즉시 처리 권장 (작고 영향 큼)

### ✅ A1. 서비스워커 등록 — **완료 (v4.7.8)**
- **조치**: `app.js` 마지막 줄에 `window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}))` 추가. (app.js:4632)
- `sw.js`의 `skipWaiting()`+`clients.claim()`과 연동하여 cache‑first 정상 작동 확인.

### A2. iconify 아이콘 self‑host · MEDIUM
- **현황**: 포맷 카드 브랜드 아이콘이 매 로드 `api.iconify.design`(제3자)에 요청. SRI 불가, "로컬 처리" 브랜드와 약한 모순.
- **조치**: 6~7개 SVG를 `icons/brand/`에 받아 self‑host → `index.html` `<img src>` 교체. `pages.yml`은 `icons/` 통째 복사라 자동 포함.
- **이득**: 이후 CSP `img-src`에서 `https:`를 빼고 `'self' data:`로 강화 가능(D2).

### A3. `changelog.json`(≈164KB) precache 제거 · LOW~MEDIUM
- **현황**: 모든 방문자가 앱셸(`sw.js` `APP_SHELL`)로 강제 다운로드.
- **조치**: `APP_SHELL`에서 `'./changelog.json'` 제거. 모달 열 때만 fetch(이미 fetch 렌더 구조). 런타임 캐시는 fetch 핸들러가 자동 처리.

---

## B. 중기 — 구조 (#4 ES 모듈 전환)

### B1. 동기
`app.js` 4,491줄/212KB가 단일 전역 스코프. 3개 스크립트가 전역 함수로 결합되어 로드 순서에 의존("순서 바꾸면 실행 안 됨", index.html 주석). 결합도가 높아 변경 위험이 크다.

### B2. 목표 상태
`<script type="module">` + `import/export`. 전역 함수 제거, 명시적 의존. **빌드는 계속 없음**(브라우저 네이티브 ESM).

### B3. 단계적 마이그레이션 (각 단계 = 독립 릴리스, golden 통과 유지)
1. **과도기 이중 노출**: 각 파일(parsers/hwpx)에 `export` 추가 + 기존 `window.X = X` 유지 → `app.js`를 module로 바꿔 `import`로 전환 → 안정화 후 `window` 전역 제거.
2. **index.html**: 본문 끝 3개 `<script>`를 `<script type="module" src="js/app.js">` 하나로(app.js가 parsers/hwpx import). `theme-init.js`는 **classic 유지**(head 동기, FOUC 방지).
3. **CDN 전역**(JSZip/marked/XLSX)은 classic이라 그대로 `window` 전역 사용.
4. **주의**: module은 자동 defer → 실행 시점이 늦다. `DOMContentLoaded` 의존 코드 점검. golden은 `page.evaluate`로 전역 함수(`normalizeMarkdownImageSource`, `markdownImageFallback` 등)를 직접 호출 → module화 시 `window`에 노출 필요(과도기 이중 노출이 안전).
5. **CSP**: `script-src 'self'`는 모듈에도 동일 적용 → 추가 작업 없음.

### B4. 동반 도입 — ESLint
`eslint` + `eslint-plugin-no-unsanitized`로 `innerHTML` 규율 자동 감시. `pages.yml`에 lint 스텝 추가. (이번 XSS 테스트가 런타임 회귀를, ESLint가 정적 회귀를 막아 이중 방어.)

---

## C. 디자인 — 어워드 차별화 (선택)
- **C1.** 이모지 기능 아이콘(📂📋💡🌙↺) → 일관 SVG 세트(A2와 함께). OS/브라우저 렌더 불일치·SR 안내 불안정 해소.
- **C2.** Noto Sans KR subset self‑host → 렌더블로킹·제3자 폰트 요청 제거(성능+프라이버시). 현재 preconnect/`display=swap`은 적용됨.
- **C3.** 랜딩에 원본→HWPX before/after 비주얼 + 드롭 마이크로 인터랙션. DESIGN.md "조용한 고급감"은 유지하되 가치 한 컷.

---

## D. 보안 잔여
- **D1.** 정밀 미리보기 rhwp iframe에서 `allow-same-origin` 제거 가능성 검증(WASM 동작 필요 여부). 불필요하면 제거.
- **D2.** A2 완료 후 CSP `img-src`/`connect-src` 강화(`https:` 제거 → `'self' data:` + 필요한 원격 이미지 정책만).

---

## 추천 순서
1. **A1**(SW 결정·수정) — 잠재 버그
2. **A2 + C1**(아이콘 self‑host + SVG 통일) → **D2**(CSP 강화)
3. **A3**(changelog 경량화)
4. **B**(ES 모듈 + ESLint) — 중기 1~2 릴리스
5. **C2/C3**(디자인 폴리시)
