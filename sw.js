/* ===================================================================
 * [sw.js]  Service Worker — 고정 앱 리소스 캐싱 (오프라인 동작 지원)
 * ===================================================================
 * 캐싱 전략: Cache First → Network Fallback
 *   1. 앱 셸/명시 리소스는 캐시에 있으면 캐시에서 반환 (빠른 응답)
 *   2. 허용된 앱 셸/명시 리소스만 네트워크 응답을 캐시에 저장
 *   3. 원격 Markdown 이미지 등 임의 외부 GET은 캐시하지 않고 네트워크 통과
 *
 * [수정 시] CACHE_VERSION 값을 변경하면 이전 캐시가 자동으로 삭제됨
 * ===================================================================*/

'use strict';

const CACHE_VERSION = 'to-hwpx-v4.19.3';

// 설치 시 미리 캐시할 파일 목록 (앱 셸)
// [주의] 절대경로(/)가 아닌 상대경로(./)를 사용해야 함.
//         GitHub Pages 서브경로(/To-Hwpx/) 배포 시 절대경로는
//         origin root를 가리켜 404 → cache.addAll() 전체 실패.
const APP_SHELL = [
    './',
    './index.html',
    './style.css',
    './js/theme-init.js',
    './js/posthog-init.js',
    './js/xlsx-worker.js',
    './js/vendor/jszip-3.10.1.min.js',
    './js/vendor/marked-18.0.11.min.js',
    './js/vendor/xlsx-0.20.3.full.min.js',
    './js/vendor/rhwp-core-0.8.4/rhwp.js',
    './js/vendor/rhwp-core-0.8.4/rhwp_bg.wasm',
    './js/vendor/pdfjs-6.3.289/pdf.min.mjs',
    './js/vendor/pdfjs-6.3.289/pdf.worker.min.mjs',
    './js/vendor/pdfjs-6.3.289/cmaps/Adobe-Korea1-UCS2.bcmap',
    './js/vendor/pdfjs-6.3.289/cmaps/UniKS-UCS2-H.bcmap',
    './js/vendor/pdfjs-6.3.289/cmaps/UniKS-UCS2-V.bcmap',
    './js/core/runtime.js',
    './js/docx-audit.js',
    './js/gov-doc.js',
    './js/parsers.js',
    './js/hwpx.js',
    './js/app.js',
    './js/pdf-parser.js',
    './js/pdf-style.js',
    './js/pdf-graphics.js',
    './js/pdf-table.js',
    './js/pdf-layout.js',
    './js/reverse-export.js',
    './js/roadmap-panel.js',
    './manifest.json',
    './roadmap.json',
    './changelog.json',
    './icons/app-icon.svg',
    './icons/app-icon-192.png',
    './icons/app-icon-512.png',
    './icons/chrome-install.svg',
    './icons/edge-install.svg',
    './icons/logo-mark.svg',
    './icons/og-image.png',
    './icons/brand/markdown.svg',
    './icons/brand/microsoftword.svg',
    './icons/brand/html5.svg',
    './icons/brand/microsoftexcel.svg',
    './icons/brand/jupyter.svg',
    './icons/brand/adobeacrobatreader.svg',
    './icons/brand/microsoftpowerpoint.svg',
    './fonts/InterVariable.woff2',
    './fonts/NotoSansKR-Regular.ttf',
    './privacy.html',
    './terms.html',
    './notices.html',
    './legal.css',
];

const CACHEABLE_URLS = new Set(APP_SHELL.map(url => new URL(url, self.location.href).href));

function isCacheableRequest(request) {
    if (request.method !== 'GET') return false;
    return CACHEABLE_URLS.has(request.url);
}

// ── 설치 이벤트: 앱 셸을 캐시에 미리 저장 ────────────────────────
// 앱 셸 하나라도 빠지면 오프라인 준비가 끝난 것이 아니다. 부분 캐시로 활성화해
// 나중에 import 실패를 내지 말고 설치 자체를 실패시켜 이전 정상 SW를 유지한다.
self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_VERSION)
            .then(cache => cache.addAll(APP_SHELL))
            .then(() => self.skipWaiting())
    );
});

// ── 활성화 이벤트: 오래된 캐시 삭제 ────────────────────────────────
self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(keys =>
            Promise.all(
                keys
                    .filter(key => key !== CACHE_VERSION)
                    .map(key => caches.delete(key))
            )
        ).then(() => self.clients.claim()) // 열린 탭 즉시 제어
    );
});

// ── Fetch 이벤트: Cache First 전략 ─────────────────────────────────
self.addEventListener('fetch', event => {
    // POST 요청 등 캐시 불가 요청은 네트워크로 직접 전달
    if (event.request.method !== 'GET') return;

    // Chrome extension 요청 무시
    if (event.request.url.startsWith('chrome-extension://')) return;

    if (!isCacheableRequest(event.request)) return;

    event.respondWith(
        caches.match(event.request).then(cached => {
            if (cached) return cached;

            // 캐시 미스: 네트워크에서 가져오고 캐시에 저장
            return fetch(event.request).then(response => {
                // 유효한 응답만 캐시 (오류 응답·opaque 응답 제외)
                if (!response || response.status !== 200 || response.type === 'error') {
                    return response;
                }
                const toCache = response.clone();
                caches.open(CACHE_VERSION).then(cache => cache.put(event.request, toCache));
                return response;
            }).catch(() => {
                // 오프라인 + 캐시 미스: index.html 폴백 (SPA용)
                if (event.request.destination === 'document') {
                    return caches.match('./index.html');
                }
            });
        })
    );
});
