'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const LEGACY_VERSION = '4.21.3';
const LEGACY_COMMIT = '8de8a3832566e757600e6a92d8424b7759f9bd94';

function assert(condition, message) {
    if (!condition) throw new Error(message);
}

const archivedIndex = execFileSync('git', ['show', `${LEGACY_COMMIT}:index.html`], {
    cwd: ROOT,
    encoding: 'utf8',
});
const archivedSw = execFileSync('git', ['show', `${LEGACY_COMMIT}:sw.js`], {
    cwd: ROOT,
    encoding: 'utf8',
});
const currentIndex = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const workflow = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'pages.yml'), 'utf8');
const stageScript = fs.readFileSync(path.join(ROOT, 'scripts', 'stage-static-site.mjs'), 'utf8');

assert(archivedIndex.includes(`v${LEGACY_VERSION}`), `고정 커밋의 화면 버전이 v${LEGACY_VERSION}이 아님`);
assert(currentIndex.includes(`/legacy/v${LEGACY_VERSION}/`), '현재 화면의 직전 버전 링크 누락');
assert(workflow.includes(LEGACY_COMMIT), 'Pages 워크플로의 레거시 커밋 고정 누락');
assert(workflow.includes(`legacy/v${LEGACY_VERSION}`), 'Pages 워크플로의 레거시 배포 경로 누락');
assert(stageScript.includes('to-hwpx-legacy-'), '레거시 서비스워커 캐시 격리 누락');
assert(archivedSw.includes('key.startsWith(CACHE_PREFIX)'), '고정 커밋 서비스워커 캐시 삭제 범위 격리 누락');
const stagedLegacySw = archivedSw.replace(
    "const CACHE_PREFIX = 'to-hwpx-v';\nconst CACHE_VERSION = 'to-hwpx-v4.21.3';",
    "const CACHE_PREFIX = 'to-hwpx-legacy-v4.21.3-';\nconst CACHE_VERSION = 'to-hwpx-legacy-v4.21.3-cache';",
);
assert(stagedLegacySw !== archivedSw, '고정 커밋 서비스워커 패치가 실제 원문과 일치하지 않음');
assert(stagedLegacySw.includes("const CACHE_VERSION = 'to-hwpx-legacy-v4.21.3-cache'"), '레거시 캐시 버전 패치 실패');
assert(stagedLegacySw.includes('key.startsWith(CACHE_PREFIX)'), '레거시 캐시 삭제 범위 패치 실패');

console.log(`PASS LEGACY v${LEGACY_VERSION} exact commit · link · isolated cache`);
