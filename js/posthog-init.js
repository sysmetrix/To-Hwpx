'use strict';

// 익명 제품 분석은 사용자가 명시적으로 동의한 뒤에만 로드한다.
// 문서 본문, 파일명, 붙여넣은 텍스트, 생성 HWPX 바이트는 이벤트 속성에 넣지 않는다.
(function initConsentManagedAnalytics() {
    const CONSENT_KEY = 'tohwpx_analytics_consent';
    const POSTHOG_KEY = 'phc_qxSMoqzHzeZXFhi464YVPYEGdrrEpbbTPXv5H7FMdjnZ';
    const POSTHOG_HOST = 'https://us.i.posthog.com';
    let loaded = false;
    let sessionConsent = null;

    function readConsent() {
        try {
            const saved = localStorage.getItem(CONSENT_KEY);
            if (saved === 'granted' || saved === 'denied') return saved;
        } catch (_) { /* 저장소 차단 시 현재 탭의 선택만 사용 */ }
        return sessionConsent;
    }

    function writeConsent(value) {
        sessionConsent = value;
        try { localStorage.setItem(CONSENT_KEY, value); } catch (_) {}
    }

    function loadPostHog() {
        if (loaded || readConsent() !== 'granted' || !POSTHOG_KEY) return;
        loaded = true;

        // PostHog 공식 비동기 로더. 외부 코드는 동의 이후에만 요청한다.
        !function(t,e){var o,n,p,r;e.__SV||(window.posthog=e,e._i=[],e.init=function(i,s,a){function g(t,e){var o=e.split('.');2==o.length&&(t=t[o[0]],e=o[1]);t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}}(p=t.createElement('script')).type='text/javascript',p.async=!0,p.src=s.api_host+'/static/array.js',(r=t.getElementsByTagName('script')[0]).parentNode.insertBefore(p,r);var u=e;for(void 0!==a?u=e[a]=[]:a='posthog',u.people=u.people||[],u.toString=function(t){var e='posthog';return'posthog'!==a&&(e+='.'+a),t||(e+=' (stub)'),e},u.people.toString=function(){return u.toString()},o='capture identify alias people.set people.set_once set_config register register_once unregister opt_out_capturing has_opted_out_capturing opt_in_capturing reset'.split(' '),n=0;n<o.length;n++)g(u,o[n]);e._i.push([i,s,a])},e.__SV=1)}(document,window.posthog||[]);

        window.posthog.init(POSTHOG_KEY, {
            api_host: POSTHOG_HOST,
            autocapture: false,
            capture_pageview: true,
            disable_session_recording: true,
            persistence: 'memory',
        });
    }

    function renderConsent() {
        const consent = readConsent();
        const banner = document.getElementById('analytics-consent-banner');
        if (banner) banner.hidden = consent === 'granted' || consent === 'denied';
        document.querySelectorAll('#analytics-consent-status').forEach(el => {
            el.textContent = consent === 'granted' ? '동의' : consent === 'denied' ? '거부' : '선택 전';
        });
    }

    function setConsent(value) {
        if (value !== 'granted' && value !== 'denied') return;
        writeConsent(value);
        if (value === 'granted') {
            window.posthog?.opt_in_capturing?.();
            loadPostHog();
        } else {
            window.posthog?.opt_out_capturing?.();
            window.posthog?.reset?.();
        }
        renderConsent();
    }

    window.ToHwpxAnalytics = Object.freeze({
        consent: readConsent,
        setConsent,
    });

    document.addEventListener('DOMContentLoaded', () => {
        document.getElementById('analytics-consent-allow')?.addEventListener('click', () => setConsent('granted'));
        document.getElementById('analytics-consent-deny')?.addEventListener('click', () => setConsent('denied'));
        document.querySelectorAll('[data-analytics-consent]').forEach(button => {
            button.addEventListener('click', () => setConsent(button.dataset.analyticsConsent));
        });
        renderConsent();
        loadPostHog();
    });
})();
