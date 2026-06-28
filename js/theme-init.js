/* ===================================================================
 * [theme-init.js]  테마(다크/라이트) 선적용 — FOUC 방지
 * ===================================================================
 * [중요] 이 파일은 <head>에서 스타일시트보다 먼저, defer 없이 동기 실행되어야
 *        한다. 첫 페인트 전에 <html data-theme="light|dark">를 박아야 화면이
 *        깜빡(FOUC)이지 않는다.
 *
 * [CSP] 인라인 <script>를 외부 파일로 분리한 이유:
 *        Content-Security-Policy의 script-src를 'self'로 고정하기 위함.
 *        인라인이면 해시('sha256-...')를 매번 맞춰야 해서, index.html을
 *        편집하는 비개발자가 공백만 바꿔도 테마가 조용히 깨진다. 외부 파일은
 *        script-src 'self'로 자동 허용된다.
 *
 * 동작: 저장된 명시적 선택(tohwpx_theme)이 있으면 그 값을, 없으면 시스템
 *       설정(prefers-color-scheme)을 해석해 즉시 적용한다.
 *       (app.js의 initTheme가 토글·시스템 변경 실시간 동기화를 담당)
 * ===================================================================*/

(function () {
    try {
        var stored = localStorage.getItem('tohwpx_theme');
        var theme = (stored === 'dark' || stored === 'light')
            ? stored
            : (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
        document.documentElement.setAttribute('data-theme', theme);
    } catch (e) { /* localStorage/matchMedia 차단 — 기본 라이트 */ }
})();
