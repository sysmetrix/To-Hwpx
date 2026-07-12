'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');
const mustExist = file => {
    if (!fs.existsSync(path.join(ROOT, file))) throw new Error(`필수 운영 파일 누락: ${file}`);
};
const assert = (condition, message) => { if (!condition) throw new Error(message); };

for (const file of [
    'LICENSE', 'THIRD_PARTY_NOTICES.md', 'privacy.html', 'terms.html', 'legal.css',
    'vercel.json', '.vercelignore', 'robots.txt', 'sitemap.xml', '.well-known/security.txt',
    'fonts/OFL-1.1.txt', 'qa/release-qa.md', 'qa/manual-release-evidence-template.md',
    'OPERATIONS.md', '.github/workflows/production-smoke.yml',
]) mustExist(file);

const integrity = JSON.parse(read('qa/vendor-integrity.json'));
for (const [file, expected] of Object.entries(integrity)) {
    mustExist(file);
    const actual = crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, file))).digest('hex');
    assert(actual === expected, `vendor 무결성 불일치: ${file}`);
}

const index = read('index.html');
assert(!/xlsx\/0\.18\.5|cdnjs\.cloudflare\.com|fonts\.googleapis\.com|_vercel\/(insights|speed-insights)/.test(index),
    '외부/취약 런타임 의존이 index.html에 남아 있음');
for (const file of ['js/vendor/jszip-3.10.1.min.js', 'js/vendor/marked-9.1.6.min.js', 'js/vendor/xlsx-0.20.3.full.min.js']) {
    assert(index.includes(file), `고정 vendor 스크립트 미참조: ${file}`);
}
assert(index.includes('privacy.html') && index.includes('terms.html'), '법적 문서 링크 누락');

const pkg = JSON.parse(read('package.json'));
const lock = JSON.parse(read('package-lock.json'));
const changelog = JSON.parse(read('changelog.json'));
assert(lock.version === pkg.version && lock.packages[''].version === pkg.version
    && changelog.current === pkg.version && index.includes(`v${pkg.version}`)
    && read('sw.js').includes(`to-hwpx-v${pkg.version}`), '릴리스 버전 5종 불일치');

const worker = read('js/xlsx-worker.js');
assert(worker.includes('xlsx-0.20.3.full.min.js') && worker.includes('MAX_ROWS = 20000')
    && worker.includes('MAX_COLUMNS = 256') && worker.includes('MAX_CELLS = 2000000'),
    'XLSX 격리/처리 한도 누락');
const parsers = read('js/parsers.js');
assert(parsers.includes('XLSX 처리 시간 초과(15초)') && parsers.includes("maxMb: 20"),
    'XLSX 시간/용량 제한 누락');
assert(parsers.includes("./vendor/rhwp-core-0.7.17/rhwp.js") && !parsers.includes('cdn.jsdelivr.net'),
    'HWP5 엔진 자체 호스팅/버전 고정 누락');

const analytics = read('js/posthog-init.js');
assert(analytics.includes("readConsent() !== 'granted'") && analytics.includes('disable_session_recording: true')
    && analytics.includes("persistence: 'memory'"), '분석 사전 동의 또는 최소수집 설정 누락');
const app = read('js/app.js');
assert(app.includes('const ANALYTICS_SCHEMA') && app.includes("window.ToHwpxAnalytics?.consent() !== 'granted'")
    && !app.includes('window.va?.'), '분석 이벤트 allowlist/동의 방어 또는 Vercel 분석 제거 누락');

const vercel = JSON.parse(read('vercel.json'));
const allHeaders = vercel.headers.flatMap(rule => rule.headers || []);
for (const key of ['Content-Security-Policy', 'X-Content-Type-Options', 'Referrer-Policy', 'Permissions-Policy', 'X-Frame-Options']) {
    assert(allHeaders.some(header => header.key === key), `Vercel 보안 헤더 누락: ${key}`);
}
assert(allHeaders.find(header => header.key === 'Content-Security-Policy')?.value.includes("frame-ancestors 'none'"),
    '응답 CSP frame-ancestors 누락');
const metaCsp = index.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/)?.[1];
const headerCsp = allHeaders.find(header => header.key === 'Content-Security-Policy')?.value;
assert(metaCsp && headerCsp?.replace("frame-ancestors 'none'; ", '') === metaCsp,
    'meta CSP와 Vercel 응답 CSP가 불일치');

const vercelIgnore = read('.vercelignore');
assert(vercelIgnore.includes('fonts/KoPubWorldDotum-Medium.ttf') && vercelIgnore.includes('hwpx-public-doc'),
    '미검증 글꼴/개발 산출물 Vercel 배포 제외 누락');
const workflow = read('.github/workflows/pages.yml');
assert(workflow.includes('npm run test:commercial') && workflow.includes('privacy.html')
    && !workflow.includes('cp -R js fonts icons'), 'Pages 상용 게이트/선별 배포 누락');
assert(!/uses:\s+[^\s]+@(v\d+|main|master)\b/.test(workflow), 'GitHub Action이 커밋 SHA로 고정되지 않음');
assert(read('.github/workflows/production-smoke.yml').includes('*/15 * * * *')
    && read('OPERATIONS.md').includes('10분 이내'), '15분 감시 또는 10분 롤백 기준 누락');

console.log(`COMMERCIAL GATE: PASS (${Object.keys(integrity).length} vendor hashes, legal/privacy/security/deploy)`);
