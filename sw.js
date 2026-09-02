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

const CACHE_VERSION = 'to-hwpx-v4.17.1';

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
    './js/parsers.js',
    './js/hwpx.js',
    './js/app.js',
    './manifest.json',
    './icons/app-icon.svg',
    './icons/app-icon-192.png',
    './icons/app-icon-512.png',
    './icons/chrome-install.svg',
    './icons/edge-install.svg',
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
    // changelog.json(≈170KB)은 모달 열 때 fetch로 온디맨드 로드 → 선점 캐시 불필요
];

const CACHEABLE_URLS = new Set(APP_SHELL.map(url => new URL(url, self.location.href).href));

function isCacheableRequest(request) {
    if (request.method !== 'GET') return false;
    return CACHEABLE_URLS.has(request.url);
}

// ── 설치 이벤트: 앱 셸을 캐시에 미리 저장 ────────────────────────
// Promise.allSettled: 개별 파일 실패가 전체 SW 설치를 중단시키지 않음.
self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_VERSION)
            .then(cache => Promise.allSettled(
                APP_SHELL.map(url => cache.add(url).catch(err =>
                    console.warn('[SW] cache.add 실패:', url, err)
                ))
            ))
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
