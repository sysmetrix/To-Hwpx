'use strict';

const fs = require('fs');
const crypto = require('crypto');

const primary = process.argv[2] || 'https://to-hwpx.vercel.app/';
const mirror = process.argv[3] || 'https://sysmetrix.github.io/To-Hwpx/';
const expectedVersion = JSON.parse(fs.readFileSync('package.json', 'utf8')).version;
const vendorIntegrity = JSON.parse(fs.readFileSync('qa/vendor-integrity.json', 'utf8'));

async function get(url) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try { return await fetch(url, { signal: controller.signal, redirect: 'follow' }); }
    finally { clearTimeout(timer); }
}

async function checkSite(base, { headers = false } = {}) {
    const response = await get(base);
    if (!response.ok) throw new Error(`${base} HTTP ${response.status}`);
    const html = await response.text();
    if (!html.includes(`v${expectedVersion}`)) throw new Error(`${base} 운영 버전이 v${expectedVersion}이 아님`);
    if (headers) {
        for (const key of ['content-security-policy', 'x-content-type-options', 'referrer-policy', 'permissions-policy']) {
            if (!response.headers.get(key)) throw new Error(`${base} 보안 헤더 누락: ${key}`);
        }
    }
    for (const path of ['privacy.html', 'terms.html', 'sw.js']) {
        const asset = await get(new URL(path, base));
        if (!asset.ok) throw new Error(`${base}${path} HTTP ${asset.status}`);
    }
}

async function checkVendor(base) {
    for (const [file, expected] of Object.entries(vendorIntegrity)) {
        const response = await get(new URL(file, base));
        if (!response.ok) throw new Error(`${file} HTTP ${response.status}`);
        const actual = crypto.createHash('sha256').update(Buffer.from(await response.arrayBuffer())).digest('hex');
        if (actual !== expected) throw new Error(`${file} 운영 해시 불일치`);
    }
}

(async () => {
    await checkSite(primary, { headers: true });
    await checkVendor(primary);
    await checkSite(mirror);
    await checkVendor(mirror);
    console.log(`PRODUCTION SMOKE: PASS v${expectedVersion} primary+mirror`);
})().catch(error => {
    console.error(`PRODUCTION SMOKE: FAIL — ${error.message}`);
    process.exitCode = 1;
});
