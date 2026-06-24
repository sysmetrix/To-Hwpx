'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const JSZip = require('jszip');
const { chromium } = require('playwright');

const target = process.argv[2] || 'https://sysmetrix.github.io/To-Hwpx/';

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ acceptDownloads: true, viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));

  await page.goto(target, { waitUntil: 'networkidle' });
  await page.evaluate(async () => {
    localStorage.removeItem('tohwpx_paperSize');
    localStorage.removeItem('tohwpx_orientation');
    for (const registration of await navigator.serviceWorker?.getRegistrations?.() || []) await registration.unregister();
    for (const key of await caches?.keys?.() || []) await caches.delete(key);
  });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.JSZip && window.marked && window.XLSX, null, { timeout: 30000 });

  await page.locator('.advanced-settings > summary').click();
  await page.locator('#paper-size').selectOption('A3');
  await page.locator('[data-orient="landscape"]').click();
  const selected = await page.evaluate(() => ({
    paper: document.querySelector('#paper-size')?.value,
    portraitPressed: document.querySelector('[data-orient="portrait"]')?.getAttribute('aria-pressed'),
    landscapePressed: document.querySelector('[data-orient="landscape"]')?.getAttribute('aria-pressed'),
    storedPaper: localStorage.getItem('tohwpx_paperSize'),
    storedOrientation: localStorage.getItem('tohwpx_orientation'),
  }));

  const downloadPromise = page.waitForEvent('download', { timeout: 30000 });
  await page.setInputFiles('#file-input', path.join(__dirname, 'fixtures', 'sample.md'));
  await page.locator('#convert-btn').click();
  const download = await downloadPromise;
  const outPath = path.join(os.tmpdir(), 'to-hwpx-orientation-e2e.hwpx');
  await download.saveAs(outPath);

  await page.locator('#preview-result-btn').click();
  const preview = await page.locator('#preview-ir').evaluate(host => {
    const pages = [...host.querySelectorAll('.ir-page')];
    const el = pages[0];
    const style = getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    return {
      paper: el.dataset.paper,
      orientation: el.dataset.orientation,
      cssWidth: el.style.getPropertyValue('--preview-page-width'),
      cssRatio: el.style.getPropertyValue('--preview-page-ratio'),
      renderedWidth: Math.round(rect.width),
      renderedHeight: Math.round(rect.height),
      computedAspectRatio: style.aspectRatio,
      overflow: style.overflow,
      clientHeight: el.clientHeight,
      scrollHeight: el.scrollHeight,
      pageCount: pages.length,
      clippedPages: pages.filter(page => page.scrollHeight > page.clientHeight + 1).length,
      label: document.querySelector('#preview-pagecount')?.textContent?.trim(),
    };
  });
  await page.screenshot({ path: path.join(os.tmpdir(), 'to-hwpx-orientation-e2e.png'), fullPage: false });

  const zip = await JSZip.loadAsync(fs.readFileSync(outPath));
  const section = await zip.file('Contents/section0.xml').async('string');
  const pagePr = (section.match(/<hp:pagePr\b[^>]*>/) || [])[0] || '';
  const table = (section.match(/<hp:tbl\b[^>]*>[\s\S]*?<hp:sz\b[^>]*\bwidth="(\d+)"/) || []);
  const output = { selected, preview, pagePr, firstTableWidth: table[1] ? Number(table[1]) : null, pageErrors: errors };
  console.log(JSON.stringify(output, null, 2));

  const width = Number((pagePr.match(/\bwidth="(\d+)"/) || [])[1]);
  const height = Number((pagePr.match(/\bheight="(\d+)"/) || [])[1]);
  if (selected.paper !== 'A3' || selected.storedOrientation !== 'landscape') throw new Error('UI selection state mismatch');
  if (preview.orientation !== 'landscape' || preview.cssRatio !== '420 / 297' || preview.renderedWidth <= preview.renderedHeight) throw new Error('Preview paper ratio mismatch');
  if (preview.pageCount < 2 || preview.clippedPages > 0) throw new Error('Preview pagination failed');
  if (!/landscape="NARROWLY"/.test(pagePr) || !(width < height)) throw new Error('HWPX landscape structure mismatch');
  if (errors.length) throw new Error(`Page errors: ${errors.join(' | ')}`);
  await browser.close();
})().catch(error => {
  console.error(error.stack || error.message);
  process.exit(1);
});
