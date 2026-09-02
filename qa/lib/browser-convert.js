/* ===================================================================
 * [qa/lib/browser-convert.js] 입력 파일 → HWPX 바이트 (실제 브라우저 경유)
 * ===================================================================
 * 여러 게이트가 같은 playwright 구동 코드를 각자 복제하고 있었다. 이 모듈은
 * 그 공통 부분만 모은다. 변환 자체는 여전히 실제 index.html에서 일어나므로
 * "테스트가 통과했는데 앱에서는 다르게 동작"하는 틈이 생기지 않는다.
 *
 * Phase 1(엔진 추출)에서 Node용 코어가 생기면 이 모듈은 브라우저 경로와
 * 코어 경로의 산출물이 같은지 비교하는 자리로 쓴다.
 * ===================================================================*/

'use strict';

const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');

const TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.pdf': 'application/pdf',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.ttf': 'font/ttf',
    '.woff2': 'font/woff2',
    '.wasm': 'application/wasm',
    '.md': 'text/markdown; charset=utf-8',
};

/** 저장소 루트를 정적으로 서빙한다(경로 이탈 차단). */
function serve(port = 0) {
    return new Promise((resolve, reject) => {
        const srv = http.createServer((req, res) => {
            let urlPath = decodeURIComponent(req.url.split('?')[0]);
            if (urlPath === '/') urlPath = '/index.html';
            const filePath = path.normalize(path.join(ROOT, urlPath));
            if (!filePath.startsWith(ROOT)) { res.writeHead(403); res.end('403'); return; }
            fs.readFile(filePath, (err, data) => {
                if (err) { res.writeHead(404); res.end('404'); return; }
                res.writeHead(200, { 'Content-Type': TYPES[path.extname(filePath)] || 'application/octet-stream' });
                res.end(data);
            });
        });
        srv.on('error', reject);
        srv.listen(port, '127.0.0.1', () => resolve(srv));
    });
}

/**
 * 브라우저 세션을 열고 콜백에 변환 함수를 넘긴다.
 *
 *   await withConverter(async (convert) => {
 *       const { bytes, fileName } = await convert('qa/fixtures/sample.md');
 *   });
 *
 * @param {(convert:(input:string, opts?:object)=>Promise<{bytes:Buffer,fileName:string}>, ctx:object)=>Promise<any>} fn
 * @param {{headless?:boolean, timeout?:number}} [options]
 */
async function withConverter(fn, options = {}) {
    // playwright는 개발 의존성이다. 없으면 명확히 안내하고 멈춘다.
    let chromium;
    try {
        ({ chromium } = require('playwright'));
    } catch {
        throw new Error('playwright가 설치돼 있지 않습니다. `npm i` 후 `npx playwright install chromium`을 실행하세요.');
    }

    const timeout = options.timeout ?? 30000;
    const srv = await serve();
    const port = srv.address().port;
    const browser = await chromium.launch({ headless: options.headless !== false });
    const ctx = await browser.newContext({ acceptDownloads: true });
    await ctx.addInitScript(() => {
        try { localStorage.setItem('tohwpx_onboarding_seen', '1'); } catch { /* sandboxed iframe */ }
    });
    const page = await ctx.newPage();
    const pageErrors = [];
    page.on('pageerror', e => {
        if (/localStorage/i.test(e.message)) return;   // addInitScript 아티팩트
        pageErrors.push(e.message);
    });

    await page.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: 'networkidle' });

    /** 파일 하나를 변환해 HWPX 바이트를 돌려준다. */
    async function convert(input, opts = {}) {
        const abs = path.isAbsolute(input) ? input : path.join(ROOT, input);
        if (!fs.existsSync(abs)) throw new Error(`입력 파일 없음: ${abs}`);

        // 이전 변환 상태를 지운다 — 같은 세션에서 여러 파일을 연달아 처리하기 위함.
        // 파일 큐는 누적되므로(사용자가 여러 개를 골라 배치 변환하는 설계) 앱의
        // 초기화 버튼을 실제로 눌러 비운다. input.value만 지우면 큐가 남아
        // 두 번째 변환부터 배치 ZIP이 내려온다.
        const resetBtn = page.locator('#reset-btn');
        if (await resetBtn.count()) {
            await resetBtn.click();
            await page.waitForTimeout(150);
        }
        await page.evaluate(() => {
            const el = document.getElementById('file-input');
            if (el) el.value = '';
        });

        if (typeof opts.beforeConvert === 'function') await opts.beforeConvert(page);

        const dlPromise = page.waitForEvent('download', { timeout });
        await page.setInputFiles('#file-input', abs);
        await page.waitForTimeout(400);
        await page.locator('#convert-btn').click();
        const dl = await dlPromise;

        const safe = path.basename(abs).replace(/[^\w.-]+/g, '_');
        const outPath = path.join(os.tmpdir(), `tohwpx_conv_${process.pid}_${Date.now()}_${safe}.hwpx`);
        await dl.saveAs(outPath);
        const bytes = fs.readFileSync(outPath);
        fs.unlinkSync(outPath);
        return { bytes, fileName: dl.suggestedFilename(), sourcePath: abs };
    }

    try {
        return await fn(convert, { page, port, pageErrors });
    } finally {
        await browser.close().catch(() => {});
        srv.close();
    }
}

module.exports = { withConverter, serve, ROOT };
