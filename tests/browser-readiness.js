'use strict';

const fs = require('fs');
const http = require('http');
const path = require('path');
const { chromium, firefox, webkit } = require('playwright');
const AxeBuilder = require('@axe-core/playwright').default;

const ROOT = path.resolve(__dirname, '..');
const types = {
    '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml', '.png': 'image/png', '.ttf': 'font/ttf', '.wasm': 'application/wasm', '.md': 'text/markdown; charset=utf-8',
};

function startServer() {
    return new Promise(resolve => {
        const server = http.createServer((request, response) => {
            const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
            const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
            const target = path.resolve(ROOT, relative);
            if (!target.startsWith(ROOT + path.sep) || !fs.existsSync(target) || fs.statSync(target).isDirectory()) {
                response.writeHead(404).end('not found'); return;
            }
            response.setHeader('Content-Type', types[path.extname(target).toLowerCase()] || 'application/octet-stream');
            response.end(fs.readFileSync(target));
        });
        server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
    });
}

async function smokeBrowser(browserType, name, baseUrl) {
    const launchOptions = { headless: true, timeout: 30000 };
    if (name === 'Firefox') {
        launchOptions.firefoxUserPrefs = {
            'gfx.webrender.all': false,
            'gfx.webrender.software': false,
            'layers.acceleration.disabled': true,
        };
    }
    const browser = await browserType.launch(launchOptions);
    try {
        const context = await browser.newContext({ acceptDownloads: true });
        await context.addInitScript(() => {
            localStorage.setItem('tohwpx_analytics_consent', 'denied');
            localStorage.setItem('tohwpx_autoDownload', 'false');
        });
        const page = await context.newPage();
        await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => window.__appReady && window.JSZip && window.marked, null, { timeout: 30000 });
        const versions = await page.evaluate(() => ({ xlsx: XLSX.version, jszip: JSZip.version }));
        if (versions.xlsx !== '0.20.3' || versions.jszip !== '3.10.1') throw new Error(`${name}: vendor 버전 불일치`);
        await page.setInputFiles('#file-input', {
            name: 'browser-smoke.md', mimeType: 'text/markdown',
            buffer: Buffer.from('# 브라우저 변환 점검\n\n본문 **굵게**와 [링크](https://example.com).'),
        });
        await page.locator('#convert-btn').click();
        await page.locator('.result-card').waitFor({ state: 'visible', timeout: 30000 });
        if (await page.locator('.result-card--error').count()) throw new Error(`${name}: MD 변환 실패`);
        await context.close();
        console.log(`PASS BROWSER ${name}`);
    } finally { await browser.close(); }
}

async function accessibility(baseUrl) {
    const browser = await chromium.launch({ headless: true });
    try {
        const targets = [
            { url: baseUrl, viewport: { width: 1280, height: 900 }, label: 'index-desktop' },
            { url: baseUrl, viewport: { width: 390, height: 844 }, label: 'index-mobile' },
            { url: new URL('privacy.html', baseUrl).href, viewport: { width: 1280, height: 900 }, label: 'privacy' },
            { url: new URL('terms.html', baseUrl).href, viewport: { width: 1280, height: 900 }, label: 'terms' },
            { url: new URL('notices.html', baseUrl).href, viewport: { width: 1280, height: 900 }, label: 'notices' },
        ];
        for (const { url, viewport, label } of targets) {
            const context = await browser.newContext({ viewport });
            await context.addInitScript(() => localStorage.setItem('tohwpx_analytics_consent', 'denied'));
            const page = await context.newPage();
            await page.goto(url, { waitUntil: 'domcontentloaded' });
            if (label.startsWith('index')) await page.waitForFunction(() => window.__appReady);
            const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
            const blocking = results.violations.filter(item => ['critical', 'serious'].includes(item.impact));
            if (blocking.length) {
                const detail = blocking.flatMap(item => item.nodes.map(node => `${item.id}:${node.target.join(' ')}`)).join(', ');
                throw new Error(`AXE ${label}: ${detail}`);
            }
            await context.close();
            console.log(`PASS AXE ${label} ${viewport.width}x${viewport.height}`);
        }
    } finally { await browser.close(); }
}

async function performanceSmoke(baseUrl) {
    const browser = await chromium.launch({ headless: true });
    try {
        const context = await browser.newContext({ acceptDownloads: true });
        await context.addInitScript(() => {
            localStorage.setItem('tohwpx_analytics_consent', 'denied');
            localStorage.setItem('tohwpx_autoDownload', 'false');
        });
        const page = await context.newPage();
        await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => window.__appReady && window.JSZip);
        const targetBytes = 10 * 1024 * 1024;
        const paragraph = '상용화 성능 점검 문장입니다. 0123456789 ABCDEFGHIJKLMNOPQRSTUVWXYZ '.repeat(180);
        const chunk = `${paragraph}\n\n`;
        const text = chunk.repeat(Math.ceil(targetBytes / Buffer.byteLength(chunk))).slice(0, targetBytes);
        await page.setInputFiles('#file-input', { name: 'performance-10mb.txt', mimeType: 'text/plain', buffer: Buffer.from(text) });
        await page.evaluate(() => { window.__perfHeartbeat = 0; window.__perfTimer = setInterval(() => window.__perfHeartbeat++, 50); });
        const started = Date.now();
        await page.locator('#convert-btn').click();
        await page.locator('.result-card').waitFor({ state: 'visible', timeout: 30000 });
        const elapsed = Date.now() - started;
        const heartbeat = await page.evaluate(() => { clearInterval(window.__perfTimer); return window.__perfHeartbeat; });
        if (await page.locator('.result-card--error').count()) throw new Error('10MB TXT 변환 실패');
        if (elapsed > 10000) throw new Error(`10MB TXT 변환 ${elapsed}ms > 10000ms`);
        if (heartbeat < 2) throw new Error('변환 중 UI heartbeat가 장시간 정지됨');
        console.log(`PASS PERF 10MB TXT ${elapsed}ms heartbeat=${heartbeat}`);
        await context.close();

        // 폴더 단위 일괄 변환 — 전환기의 실제 작업 단위다.
        // 파일 수가 많을 때 메인스레드가 살아 있는지가 핵심이다. 변환 루프가
        // 파일마다 await로 양보하지 않으면 탭이 "응답 없음"이 된다.
        const batchCtx = await browser.newContext({ acceptDownloads: true });
        await batchCtx.addInitScript(() => {
            localStorage.setItem('tohwpx_analytics_consent', 'denied');
            localStorage.setItem('tohwpx_autoDownload', 'false');
            localStorage.setItem('tohwpx_onboarding_seen', '1');
        });
        const batchPage = await batchCtx.newPage();
        await batchPage.goto(baseUrl, { waitUntil: 'domcontentloaded' });
        await batchPage.waitForFunction(() => window.__appReady && window.JSZip);

        const BATCH_N = 100;
        const doc = ['# 문서 제목', '', '본문 문단입니다.', '', '| 항목 | 값 |', '|---|---|', '| 가 | 1 |', '', '- 목록 하나'].join(String.fromCharCode(10));
        const batchFiles = Array.from({ length: BATCH_N }, (_, i) => ({
            name: `doc${String(i + 1).padStart(3, '0')}.md`,
            mimeType: 'text/markdown; charset=utf-8',
            buffer: Buffer.from(doc),
        }));
        await batchPage.setInputFiles('#file-input', batchFiles);
        await batchPage.waitForTimeout(800);

        const queued = await batchPage.evaluate(() => window.__tohwpxTest.queueLength());
        if (queued !== BATCH_N) throw new Error(`배치 큐에 ${BATCH_N}개가 담기지 않음 (${queued}개)`);

        await batchPage.evaluate(() => { window.__bh = 0; window.__bhT = setInterval(() => window.__bh++, 100); });
        const batchStart = Date.now();
        await batchPage.locator('#convert-btn').click();
        await batchPage.locator('#batch-report-btn').waitFor({ state: 'visible', timeout: 300000 });
        const batchMs = Date.now() - batchStart;
        const beats = await batchPage.evaluate(() => { clearInterval(window.__bhT); return window.__bh; });

        const expectedBeats = Math.max(1, Math.round(batchMs / 100));
        const ratio = beats / expectedBeats;
        const summary = await batchPage.locator('.result-card').textContent();
        if (!/실패 0/.test(summary.replace(/\s+/g, ' '))) {
            throw new Error(`배치 ${BATCH_N}개 중 실패가 발생함`);
        }
        // 심박이 기대치의 절반 아래면 메인스레드가 오래 잠긴 것이다.
        if (ratio < 0.5) {
            throw new Error(`배치 중 UI 정지 — 심박 ${beats}/${expectedBeats} (${Math.round(ratio * 100)}%)`);
        }
        console.log(`PASS PERF 배치 ${BATCH_N}개 ${batchMs}ms heartbeat=${beats}/${expectedBeats} (${Math.round(ratio * 100)}%)`);
        await batchCtx.close();
    } finally { await browser.close(); }
}

(async () => {
    const { server, port } = await startServer();
    const baseUrl = `http://127.0.0.1:${port}/index.html`;
    try {
        const mode = process.argv[2] || 'all';
        if (mode === 'accessibility' || mode === 'all') await accessibility(baseUrl);
        if (mode === 'performance' || mode === 'all') await performanceSmoke(baseUrl);
        if (mode === 'browsers' || mode === 'all') {
            const only = process.argv[3]?.toLowerCase();
            const browsers = [[chromium, 'Chromium'], [firefox, 'Firefox'], [webkit, 'WebKit']]
                .filter(([, name]) => !only || name.toLowerCase() === only);
            for (const [type, name] of browsers) {
                await smokeBrowser(type, name, baseUrl);
            }
        }
    } finally { await new Promise(resolve => server.close(resolve)); }
})().catch(error => {
    console.error(`BROWSER READINESS: FAIL — ${error.message}`);
    process.exitCode = 1;
});
