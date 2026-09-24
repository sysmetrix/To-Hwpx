'use strict';

const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const PORT = 4199;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' };

const server = http.createServer((request, response) => {
    const pathname = decodeURIComponent(new URL(request.url, `http://127.0.0.1:${PORT}`).pathname);
    const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\//, '');
    const file = path.resolve(ROOT, relative);
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
        response.writeHead(404).end('not found');
        return;
    }
    response.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(response);
});

(async () => {
    await new Promise(resolve => server.listen(PORT, '127.0.0.1', resolve));
    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
    await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => localStorage.setItem('tohwpx_onboarding_seen', '1'));
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.locator('#analytics-consent-deny').click();
    await page.locator('#start-paste').click();
    await page.locator('#paste-input').fill([
        '# 주간 업무 보고', '', '- 완료한 일', '- 다음 할 일', '',
        '| 항목 | 상태 |', '| --- | --- |', '| 변환 | 완료 |',
    ].join('\n'));
    await page.waitForFunction(() => document.querySelector('#paste-preview-status')?.textContent.includes('해석 완료'));
    const desktop = path.join(os.tmpdir(), 'tohwpx-direct-desktop.png');
    const mobile = path.join(os.tmpdir(), 'tohwpx-direct-mobile.png');
    await page.screenshot({ path: desktop, fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: mobile, fullPage: true });
    await browser.close();
    console.log(desktop);
    console.log(mobile);
})().finally(() => server.close());
