'use strict';

const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const types = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ttf': 'font/ttf', '.woff2': 'font/woff2',
  '.wasm': 'application/wasm', '.md': 'text/markdown; charset=utf-8', '.pdf': 'application/pdf',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
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
    server.listen(0, '127.0.0.1', () => resolve({ server, url: `http://127.0.0.1:${server.address().port}/` }));
  });
}

(async () => {
  const { server, url } = await startServer();
  const browser = await chromium.launch();
  try {
    for (const width of [1280, 1024, 768, 390]) {
      const context = await browser.newContext({ viewport: { width, height: 900 } });
      await context.addInitScript(() => {
        localStorage.setItem('tohwpx_analytics_consent', 'denied');
        localStorage.setItem('tohwpx_autoDownload', 'false');
      });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(url, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => window.__appReady);
      if (await page.locator('body').getAttribute('data-workspace-route') !== 'start') throw new Error(`${width}: start route missing`);
      const actions = await page.locator('.start-secondary-actions').boundingBox();
      if (!actions || actions.x < -1 || actions.x + actions.width > width + 1) throw new Error(`${width}: start actions clipped`);
      const heroCopy = await page.locator('.hero-copy').boundingBox();
      const heroAction = await page.locator('.hero-action-area').boundingBox();
      if (!heroCopy || !heroAction) throw new Error(`${width}: benchmark hero regions missing`);
      if (width >= 1024 && !(heroCopy.x < heroAction.x && Math.abs(heroCopy.y - heroAction.y) < 180)) {
        throw new Error(`${width}: desktop benchmark hero is not a two-column workspace`);
      }
      if (width <= 768 && !(heroCopy.y < heroAction.y && heroAction.x >= -1 && heroAction.x + heroAction.width <= width + 1)) {
        throw new Error(`${width}: mobile benchmark hero is not stacked or is clipped`);
      }
      const logoReady = await page.locator('.site-logo-mark').evaluate(image => image.complete && image.naturalWidth > 0);
      if (!logoReady) throw new Error(`${width}: benchmark logo did not load`);
      if (width === 1280 || width === 390) {
        await page.screenshot({ path: path.join(os.tmpdir(), `to-hwpx-workspace-${width}.png`), fullPage: true });
      }
      const blockingErrors = errors.filter(message => !message.includes("document is sandboxed and lacks the 'allow-same-origin' flag"));
      if (blockingErrors.length) throw new Error(`${width}: ${blockingErrors.join(' | ')}`);
      await context.close();
    }

    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await context.addInitScript(() => {
      localStorage.setItem('tohwpx_analytics_consent', 'denied');
      localStorage.setItem('tohwpx_autoDownload', 'false');
    });
    const page = await context.newPage();
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__appReady);
    await page.locator('[data-workspace-route="guide"]').first().click();
    await page.waitForFunction(() => location.hash === '#/guide');
    if (!(await page.locator('#panel-dev-story').isVisible())) throw new Error('guide did not open with development background');
    await page.locator('.site-logo').click();
    await page.waitForFunction(() => location.hash === '#/start');
    await page.setInputFiles('#file-input', path.join(__dirname, 'fixtures', 'sample.md'));
    await page.waitForFunction(() => location.hash === '#/prepare');
    await page.locator('.prepare-continue').click();
    await page.waitForFunction(() => location.hash === '#/settings');
    await page.locator('#convert-btn').click();
    await page.locator('.result-card').waitFor({ state: 'visible', timeout: 30000 });
    await page.waitForFunction(() => location.hash === '#/result');
    const stored = await page.evaluate(async () => {
      const request = indexedDB.open('tohwpx-workspace');
      const db = await new Promise((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
      const tx = db.transaction('runs', 'readonly');
      const allRequest = tx.objectStore('runs').getAll();
      const runs = await new Promise((resolve, reject) => { allRequest.onsuccess = () => resolve(allRequest.result); allRequest.onerror = () => reject(allRequest.error); });
      db.close();
      return runs;
    });
    if (stored.length !== 1) throw new Error('recent run was not stored');
    const serialized = JSON.stringify(stored[0]).toLowerCase();
    for (const forbidden of ['"bytes"', '"text"', '"ir"', '"blob"', 'blob:', '"url"', '"source"']) {
      if (serialized.includes(forbidden)) throw new Error(`history contains forbidden field/value: ${forbidden}`);
    }
    await page.locator('.site-logo').click();
    await page.locator('#start-history').click();
    await page.locator('#history-list article').waitFor();
    await page.locator('#history-list article button').click();
    await page.waitForFunction(() => location.hash === '#/start');
    await context.close();
    console.log('PASS WORKSPACE routes · benchmark responsive brand · guide intro · metadata-only history');
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => {
  console.error(error.stack || error.message);
  process.exit(1);
});
