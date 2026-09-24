import fs from 'node:fs';
import path from 'node:path';

const args = Object.fromEntries(process.argv.slice(2).map((arg, index, all) => {
    if (!arg.startsWith('--')) return [arg, true];
    const key = arg.slice(2);
    const next = all[index + 1];
    return [key, next && !next.startsWith('--') ? next : true];
}));

const source = path.resolve(String(args.source || '.'));
const dest = path.resolve(String(args.dest || '_site'));
const legacy = args.legacy === true || args.legacy === 'true';
const files = [
    'index.html', 'style.css', 'legal.css', 'privacy.html', 'terms.html', 'notices.html',
    'LICENSE', 'robots.txt', 'sitemap.xml', 'sw.js', 'manifest.json', 'changelog.json', 'roadmap.json',
];
const dirs = ['js', 'icons', 'fonts', '.well-known'];

fs.mkdirSync(dest, { recursive: true });
for (const file of files) {
    const from = path.join(source, file);
    if (fs.existsSync(from)) fs.copyFileSync(from, path.join(dest, file));
}
for (const dir of dirs) {
    const from = path.join(source, dir);
    if (fs.existsSync(from)) fs.cpSync(from, path.join(dest, dir), { recursive: true });
}

// 네 가지 사용자 샘플만 배포한다. 테스트 전체를 공개 자산으로 복사하지 않는다.
const sampleDir = path.join(dest, 'tests', 'fixtures');
fs.mkdirSync(sampleDir, { recursive: true });
for (const name of ['sample.md', 'sample.docx', 'sample.xlsx', 'sample.pdf']) {
    const from = path.join(source, 'tests', 'fixtures', name);
    if (fs.existsSync(from)) fs.copyFileSync(from, path.join(sampleDir, name));
}

if (legacy) {
    const swPath = path.join(dest, 'sw.js');
    let sw = fs.readFileSync(swPath, 'utf8');
    sw = sw.replace(
        "const CACHE_VERSION = 'to-hwpx-v4.19.3';",
        "const CACHE_PREFIX = 'to-hwpx-legacy-v4.19.3-';\nconst CACHE_VERSION = 'to-hwpx-legacy-v4.19.3-cache';",
    ).replace(
        '.filter(key => key !== CACHE_VERSION)',
        '.filter(key => key.startsWith(CACHE_PREFIX) && key !== CACHE_VERSION)',
    );
    fs.writeFileSync(swPath, sw);
}
