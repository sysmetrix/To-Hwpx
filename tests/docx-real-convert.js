'use strict';
const fs = require('fs');
const path = require('path');
const http = require('http');
const os = require('os');
const JSZip = require('jszip');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const PORT = 8733;
const INPUT = process.argv[2] || path.join(ROOT, '원본 docx.docx');

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.pdf': 'application/pdf',
  '.wasm': 'application/wasm', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.ttf': 'font/ttf', '.woff2': 'font/woff2', '.png': 'image/png', '.wasm': 'application/wasm',
};

function serve() {
  return new Promise(resolve => {
    const srv = http.createServer((req, res) => {
      let urlPath = decodeURIComponent(req.url.split('?')[0]);
      if (urlPath === '/') urlPath = '/index.html';
      const filePath = path.normalize(path.join(ROOT, urlPath));
      fs.readFile(filePath, (err, data) => {
        if (err) { res.writeHead(404); res.end('404'); return; }
        res.writeHead(200, { 'Content-Type': TYPES[path.extname(filePath)] || 'application/octet-stream' });
        res.end(data);
      });
    });
    srv.listen(PORT, '127.0.0.1', () => resolve(srv));
  });
}

(async () => {
  const srv = await serve();
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const t0 = Date.now();
  page.on('console', msg => { if (msg.type() === 'error') console.log('[console.error]', msg.text()); });
  page.on('pageerror', err => console.log('[pageerror]', err.message));
  try {
    await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.JSZip && window.marked && window.XLSX && window.__appReady, null, { timeout: 30000 });
    const downloadPromise = page.waitForEvent('download', { timeout: 120000 });
    await page.setInputFiles('#file-input', INPUT);
    await page.locator('#convert-btn').click();
    const download = await downloadPromise;
    const elapsedMs = Date.now() - t0;
    const outPath = path.join(os.tmpdir(), 'real-docx-test.hwpx');
    await download.saveAs(outPath);
    console.log('elapsedMs=', elapsedMs);
    const zip = await JSZip.loadAsync(fs.readFileSync(outPath));
    const section = await zip.file('Contents/section0.xml').async('string');
    fs.writeFileSync(path.join(__dirname, 'section0-real.xml'), section, 'utf-8');
    const header = await zip.file('Contents/header.xml').async('string');
    fs.writeFileSync(path.join(__dirname, 'header-real.xml'), header, 'utf-8');
    console.log('section0.xml bytes:', section.length);
    console.log('OK');
  } catch (e) {
    console.log('ERROR:', e.message);
  } finally {
    await browser.close();
    srv.close();
  }
})();
