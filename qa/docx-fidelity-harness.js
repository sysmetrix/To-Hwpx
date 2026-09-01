'use strict';

const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const JSZip = require('jszip');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');

function argValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : '';
}

function serve() {
  const types = {
    '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml', '.wasm': 'application/wasm', '.woff2': 'font/woff2', '.ttf': 'font/ttf',
  };
  return new Promise(resolve => {
    const server = http.createServer((request, response) => {
      const relative = decodeURIComponent(request.url.split('?')[0] === '/' ? '/index.html' : request.url.split('?')[0]);
      const target = path.join(ROOT, relative);
      fs.readFile(target, (error, data) => {
        if (error) { response.writeHead(404); response.end('404'); return; }
        response.writeHead(200, { 'Content-Type': types[path.extname(target)] || 'application/octet-stream' });
        response.end(data);
      });
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

function attr(xml, tag, name) {
  const open = (new RegExp(`<${tag}\\b[^>]*>`).exec(xml) || [])[0] || '';
  return (new RegExp(`\\b${name}="([^"]+)"`).exec(open) || [])[1] || '';
}

function count(xml, pattern) {
  return (xml.match(pattern) || []).length;
}

function outputMetrics(section) {
  const marginTag = (/<hp:margin\b[^>]*\/>/.exec(section) || [])[0] || '';
  const margin = name => Number((new RegExp(`\\b${name}="(\\d+)"`).exec(marginTag) || [])[1]);
  return {
    paragraphs: count(section, /<hp:p\b/g),
    tables: count(section, /<hp:tbl\b/g),
    rows: count(section, /<hp:tr>/g),
    cells: count(section, /<hp:tc\b/g),
    lineBreaks: count(section, /<hp:lineBreak\/>/g),
    page: {
      widthHwp: Number(attr(section, 'hp:pagePr', 'width')),
      heightHwp: Number(attr(section, 'hp:pagePr', 'height')),
      orientation: attr(section, 'hp:pagePr', 'landscape') === 'NARROWLY' ? 'landscape' : 'portrait',
      marginsHwp: {
        left: margin('left'), right: margin('right'), top: margin('top'), bottom: margin('bottom'),
        header: margin('header'), footer: margin('footer'),
      },
    },
  };
}

function checkReport(ir, output, section) {
  const source = ir.audit?.metrics || {};
  const expectedPage = ir.pageSetup || {};
  const expectedMargins = expectedPage.marginsHwp || {};
  const marginNames = ['left', 'right', 'top', 'bottom', 'header', 'footer'];
  const checks = [
    { id: 'audit-not-blocked', pass: ir.audit?.status !== 'blocked', detail: ir.audit?.status || 'missing' },
    { id: 'tables-exact', pass: output.tables === source.tables, detail: `${output.tables}/${source.tables}` },
    { id: 'rows-exact', pass: output.rows === source.rows, detail: `${output.rows}/${source.rows}` },
    { id: 'cells-exact', pass: output.cells === source.cells, detail: `${output.cells}/${source.cells}` },
    {
      id: 'paragraph-retention',
      pass: !source.paragraphs || output.paragraphs >= source.paragraphs * 0.97,
      detail: `${output.paragraphs}/${source.paragraphs}`,
    },
    {
      id: 'manual-break-retention',
      pass: output.lineBreaks >= (source.lineBreaks || 0),
      detail: `${output.lineBreaks}/${source.lineBreaks || 0}`,
    },
    {
      id: 'page-size',
      pass: !expectedPage.widthHwp || (output.page.widthHwp === expectedPage.widthHwp
        && output.page.heightHwp === expectedPage.heightHwp
        && output.page.orientation === expectedPage.orientation),
      detail: `${output.page.widthHwp}×${output.page.heightHwp} ${output.page.orientation}`,
    },
    {
      id: 'page-margins',
      pass: !expectedPage.widthHwp || marginNames.every(name => output.page.marginsHwp[name] === expectedMargins[name]),
      detail: marginNames.map(name => `${name}=${output.page.marginsHwp[name]}/${expectedMargins[name]}`).join(', '),
    },
    {
      id: 'invalid-literals-absent',
      pass: !/="(?:undefined|null|NaN)"/.test(section),
      detail: 'undefined/null/NaN attribute values',
    },
  ];
  return { checks, pass: checks.every(check => check.pass) };
}

async function main() {
  const input = process.argv[2];
  if (!input || !fs.existsSync(input) || path.extname(input).toLowerCase() !== '.docx') {
    throw new Error('사용법: node qa/docx-fidelity-harness.js <input.docx> [--out output.hwpx] [--report report.json]');
  }
  const outputPath = path.resolve(argValue('--out') || path.join(os.tmpdir(), `${path.basename(input, '.docx')}.fidelity.hwpx`));
  const reportPath = argValue('--report') ? path.resolve(argValue('--report')) : '';
  const server = await serve();
  const browser = await chromium.launch();
  let report;
  try {
    const context = await browser.newContext({ acceptDownloads: true });
    await context.addInitScript(() => {
      localStorage.setItem('tohwpx_autoDownload', 'true');
      localStorage.setItem('tohwpx_onboarding_seen', '1');
      localStorage.setItem('tohwpx_stylePolicy', 'source');
    });
    const page = await context.newPage();
    const pageErrors = [];
    page.on('pageerror', error => { if (!/localStorage/i.test(error.message)) pageErrors.push(error.message); });
    await page.goto(`http://127.0.0.1:${server.address().port}/index.html`, { waitUntil: 'networkidle' });
    const downloadPromise = page.waitForEvent('download', { timeout: 120000 });
    await page.setInputFiles('#file-input', input);
    await page.locator('#convert-btn').click();
    const download = await downloadPromise;
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    await download.saveAs(outputPath);

    const ir = JSON.parse(await page.locator('#ir-content').textContent());
    const zip = await JSZip.loadAsync(fs.readFileSync(outputPath), { checkCRC32: true });
    const section = await zip.file('Contents/section0.xml').async('string');
    const output = outputMetrics(section);
    const result = checkReport(ir, output, section);
    report = {
      input: path.resolve(input),
      output: outputPath,
      inputBytes: fs.statSync(input).size,
      outputBytes: fs.statSync(outputPath).size,
      audit: ir.audit || null,
      pageSetup: ir.pageSetup || null,
      typography: ir.typography || null,
      outputMetrics: output,
      pageErrors,
      checks: result.checks,
      pass: result.pass && pageErrors.length === 0,
    };
    if (reportPath) {
      fs.mkdirSync(path.dirname(reportPath), { recursive: true });
      fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8');
    }
  } finally {
    await browser.close();
    server.close();
  }

  console.log(JSON.stringify(report, null, 2));
  process.exitCode = report.pass ? 0 : 1;
}

main().catch(error => {
  console.error(error.stack || error.message);
  process.exit(1);
});
