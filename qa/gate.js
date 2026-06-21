/* ===================================================================
 * [qa/gate.js]  HWPX 변환 회귀 검증 게이트 (개발자용, 선택)
 * ===================================================================
 * 목적: 입력 파일을 실제 브라우저에서 .hwpx로 변환한 뒤, HWPX 패키지
 *       무결성 ①~⑤를 자동 검사한다. 하나라도 FAIL이면 exit code 1.
 *
 *   ① mimetype이 ZIP 첫 항목·무압축(STORED)·내용 application/hwp+zip
 *   ② META-INF 3종(container.xml/manifest.xml/container.rdf) + Preview + Contents 존재
 *   ③ section0.xml well-formed + hwpml 네임스페이스
 *   ④ section0의 모든 charPrIDRef/paraPrIDRef/borderFillIDRef ⊆ header 정의 id
 *   ⑤ header의 모든 itemCnt == 실제 자식 수 (fontfaces 내부 fontCnt 포함)
 *
 * [사전 준비] (CDN 전용 저장소라 개발 의존성은 일시 설치)
 *   npm i playwright jszip
 *   npx playwright install chromium
 *
 * [실행]
 *   node qa/gate.js                         # 기본: qa/fixtures/md_hwpx_test.md
 *   node qa/gate.js qa/fixtures/sample.docx # 임의 입력 지정
 *
 * [주의] 정리: 검증 후 node_modules / package*.json 은 커밋하지 않는다.
 * ===================================================================*/
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const JSZip = require('jszip');

const ROOT = path.resolve(__dirname, '..');
const PORT = 8731;
const input = process.argv[2] || path.join(ROOT, 'qa/fixtures/md_hwpx_test.md');

const TYPES = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript',
    '.json': 'application/json', '.svg': 'image/svg+xml', '.md': 'text/markdown' };

function serve() {
    return new Promise(resolve => {
        const srv = http.createServer((req, res) => {
            let p = decodeURIComponent(req.url.split('?')[0]);
            if (p === '/') p = '/index.html';
            const fp = path.join(ROOT, p);
            fs.readFile(fp, (e, d) => {
                if (e) { res.writeHead(404); res.end('404'); return; }
                res.writeHead(200, { 'Content-Type': TYPES[path.extname(fp)] || 'application/octet-stream' });
                res.end(d);
            });
        });
        srv.listen(PORT, '127.0.0.1', () => resolve(srv));
    });
}

const ids = (xml, re) => [...new Set([...xml.matchAll(re)].map(m => +m[1]))].sort((a, b) => a - b);
function childCount(xml, container, child) {
    const self = new RegExp(`<hh:${container}[^>]*itemCnt="(\\d+)"[^>]*/>`).exec(xml);
    if (self) return { declared: +self[1], actual: 0 };
    const m = new RegExp(`<hh:${container}[^>]*itemCnt="(\\d+)"[^>]*>([\\s\\S]*?)</hh:${container}>`).exec(xml);
    if (!m) return null;
    return { declared: +m[1], actual: (m[2].match(new RegExp(`<hh:${child}\\b`, 'g')) || []).length };
}

(async () => {
    if (!fs.existsSync(input)) { console.error('입력 파일 없음:', input); process.exit(2); }
    const srv = await serve();
    const browser = await chromium.launch();
    const ctx = await browser.newContext({ acceptDownloads: true });
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', e => errs.push(e.message));

    await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'networkidle' });
    const dlP = page.waitForEvent('download', { timeout: 20000 });
    await page.setInputFiles('#file-input', input);
    await page.waitForTimeout(500);
    await page.locator('#convert-btn').click();
    const dl = await dlP;
    const outPath = path.join(require('os').tmpdir(), 'qa_gate_out.hwpx');
    await dl.saveAs(outPath);

    const buf = fs.readFileSync(outPath);
    const zip = await JSZip.loadAsync(buf);
    const header = await zip.file('Contents/header.xml').async('string');
    const section = await zip.file('Contents/section0.xml').async('string');

    // ① mimetype
    const firstName = buf.slice(30, 30 + buf.readUInt16LE(26)).toString('latin1');
    const c1 = buf.slice(0, 4).toString('latin1') === 'PK\x03\x04'
        && firstName === 'mimetype' && buf.readUInt16LE(8) === 0
        && (await zip.file('mimetype').async('string')) === 'application/hwp+zip';
    // ② entries
    const need = ['META-INF/container.xml', 'META-INF/manifest.xml', 'META-INF/container.rdf',
        'Preview/PrvText.txt', 'Contents/header.xml', 'Contents/section0.xml'];
    const missing = need.filter(f => !zip.file(f));
    const c2 = missing.length === 0;
    // ③ well-formed
    const wf = await page.evaluate(xml => {
        const d = new DOMParser().parseFromString(xml, 'application/xml');
        return !d.querySelector('parsererror');
    }, section);
    const c3 = wf && section.includes('hancom.co.kr/hwpml/2011/section')
        && section.includes('hancom.co.kr/hwpml/2011/paragraph');
    // ④ reference integrity
    const defC = ids(header, /<hh:charPr\b[^>]*\bid="(\d+)"/g);
    const defP = ids(header, /<hh:paraPr\b[^>]*\bid="(\d+)"/g);
    const defB = ids(header, /<hh:borderFill\b[^>]*\bid="(\d+)"/g);
    const sub = (u, d) => u.filter(x => !d.includes(x));
    const badC = sub(ids(section, /charPrIDRef="(\d+)"/g), defC);
    const badP = sub(ids(section, /paraPrIDRef="(\d+)"/g), defP);
    const badB = sub(ids(section, /borderFillIDRef="(\d+)"/g), defB);
    const c4 = !badC.length && !badP.length && !badB.length;
    // ⑤ itemCnt
    const containers = [['fontfaces', 'fontface'], ['charProperties', 'charPr'],
        ['paraProperties', 'paraPr'], ['borderFills', 'borderFill'], ['binDataList', 'binData']];
    const itemRows = containers.map(([c, ch]) => [c, childCount(header, c, ch)]).filter(([, r]) => r);
    const faceFont = [...header.matchAll(/<hh:fontface\b[^>]*fontCnt="(\d+)"[^>]*>([\s\S]*?)<\/hh:fontface>/g)]
        .map(m => ({ d: +m[1], a: (m[2].match(/<hh:font\b/g) || []).length }));
    const c5 = itemRows.every(([, r]) => r.declared === r.actual) && faceFont.every(f => f.d === f.a);

    const gate = [c1, c2, c3, c4, c5];
    console.log(`입력: ${path.relative(ROOT, input)}  (${buf.length} bytes)`);
    console.log(`① mimetype STORED 첫항목 : ${c1 ? 'PASS' : 'FAIL'}`);
    console.log(`② META-INF+Preview+Contents: ${c2 ? 'PASS' : 'FAIL'}${missing.length ? ' missing=' + missing : ''}`);
    console.log(`③ section0 well-formed+ns  : ${c3 ? 'PASS' : 'FAIL'}`);
    console.log(`④ IDRef ⊆ header 정의      : ${c4 ? 'PASS' : 'FAIL'}${c4 ? '' : ` dangling C=${badC} P=${badP} B=${badB}`}`);
    console.log(`⑤ itemCnt == 실제 자식 수  : ${c5 ? 'PASS' : 'FAIL'}  ` +
        itemRows.map(([c, r]) => `${c} ${r.declared}=${r.actual}`).join(' | '));
    if (errs.length) console.log('page errors:', errs);

    await browser.close();
    srv.close();
    const ok = gate.every(Boolean) && !errs.length;
    console.log('\nGATE:', ok ? '✅ ALL PASS' : '❌ FAIL');
    process.exit(ok ? 0 : 1);
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
