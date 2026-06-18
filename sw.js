/* ===================================================================
 * [sw.js]  Service Worker — CDN 리소스 캐싱 (오프라인 동작 지원)
 * ===================================================================
 * 캐싱 전략: Cache First → Network Fallback
 *   1. 캐시에 있으면 캐시에서 반환 (빠른 응답)
 *   2. 없으면 네트워크에서 가져온 후 캐시에 저장
 *
 * [수정 시] CACHE_VERSION 값을 변경하면 이전 캐시가 자동으로 삭제됨
 * ===================================================================*/

'use strict';

const CACHE_VERSION = 'to-hwpx-v3.5.0';

// 설치 시 미리 캐시할 파일 목록 (앱 셸)
const APP_SHELL = [
    '/',
    '/index.html',
    '/style.css',
    '/js/parsers.js',
    '/js/hwpx.js',
    '/js/app.js',
    '/manifest.json',
    '/changelog.json',
    // CDN 라이브러리 (SRI 검증 통과한 것들)
    'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js',
    'https://cdnjs.cloudflare.com/ajax/libs/marked/9.1.6/marked.min.js',
    'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js',
    // 한글 웹 폰트
    'https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;600;700;800&display=swap',
];

// ── 설치 이벤트: 앱 셸을 캐시에 미리 저장 ────────────────────────
self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_VERSION)
            .then(cache => cache.addAll(APP_SHELL))
            .then(() => self.skipWaiting()) // 즉시 활성화
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
                    return caches.match('/index.html');
                }
            });
        })
    );
});
