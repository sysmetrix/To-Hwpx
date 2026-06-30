/**
 * og:image PNG 생성 스크립트 (1200×630)
 * 사용: node qa/gen-og-image.js
 * 출력: icons/og-image.png
 */
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const HTML = String.raw`<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=1200">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    width: 1200px; height: 630px; overflow: hidden;
    background: #1e3a8a;
    font-family: 'Noto Sans KR', 'Apple SD Gothic Neo', 'Malgun Gothic', sans-serif;
    display: flex; align-items: center; justify-content: center;
    position: relative;
  }
  .bg-accent {
    position: absolute; inset: 0;
    background: linear-gradient(135deg, #1d4ed8 0%, #1e3a8a 60%, #0f172a 100%);
  }
  .card {
    position: relative; z-index: 1;
    text-align: center; color: #fff;
    padding: 0 80px;
  }
  .badge {
    display: inline-block;
    background: rgba(255,255,255,0.15);
    border: 1px solid rgba(255,255,255,0.3);
    border-radius: 24px;
    padding: 6px 20px;
    font-size: 18px; font-weight: 600; letter-spacing: 0.05em;
    color: #93c5fd;
    margin-bottom: 28px;
  }
  .title {
    font-size: 88px; font-weight: 900; line-height: 1;
    letter-spacing: -0.02em;
    color: #fff;
    margin-bottom: 20px;
  }
  .title span { color: #60a5fa; }
  .subtitle {
    font-size: 30px; font-weight: 500; color: #bfdbfe;
    margin-bottom: 40px;
  }
  .formats {
    display: flex; gap: 12px; justify-content: center; flex-wrap: wrap;
  }
  .fmt {
    background: rgba(255,255,255,0.1);
    border: 1px solid rgba(255,255,255,0.2);
    border-radius: 8px;
    padding: 8px 16px;
    font-size: 18px; font-weight: 700; color: #e0f2fe;
    letter-spacing: 0.02em;
  }
  .arrow { color: #60a5fa; font-size: 22px; display: flex; align-items: center; }
  .deco-circle {
    position: absolute; border-radius: 50%;
    background: rgba(96,165,250,0.08); border: 1px solid rgba(96,165,250,0.12);
  }
</style>
</head>
<body>
  <div class="bg-accent"></div>
  <div class="deco-circle" style="width:480px;height:480px;top:-160px;right:-120px;"></div>
  <div class="deco-circle" style="width:300px;height:300px;bottom:-100px;left:-80px;"></div>
  <div class="card">
    <div class="badge">브라우저에서 바로 · 서버 전송 없음</div>
    <div class="title">TO <span>HWPX</span></div>
    <div class="subtitle">한글로, 한 번에</div>
    <div class="formats">
      <span class="fmt">MD</span>
      <span class="fmt">DOCX</span>
      <span class="fmt">HTML</span>
      <span class="fmt">CSV</span>
      <span class="fmt">XLSX</span>
      <span class="fmt">JSON</span>
      <span class="fmt">IPYNB</span>
      <span class="arrow">→</span>
      <span class="fmt" style="background:rgba(96,165,250,0.25);border-color:#60a5fa;color:#fff;">HWPX</span>
    </div>
  </div>
</body>
</html>`;

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1200, height: 630 });
  await page.setContent(HTML, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(300);

  const outPath = path.join(__dirname, '..', 'icons', 'og-image.png');
  await page.screenshot({ path: outPath, type: 'png', clip: { x: 0, y: 0, width: 1200, height: 630 } });
  await browser.close();

  const size = fs.statSync(outPath).size;
  console.log(`✅ og-image.png 생성 완료 — ${(size / 1024).toFixed(1)} KB → icons/og-image.png`);
})();
