'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const changelogPath = path.join(root, 'changelog.json');
const packagePath = path.join(root, 'package.json');
const lockPath = path.join(root, 'package-lock.json');
const swPath = path.join(root, 'sw.js');
const indexPath = path.join(root, 'index.html');

function todayIso() {
    const now = new Date();
    const pad = value => String(value).padStart(2, '0');
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function parseVersion(version) {
    const parts = String(version || '0.0.0').split('.').map(n => parseInt(n, 10));
    while (parts.length < 3) parts.push(0);
    return parts.map(n => Number.isFinite(n) ? n : 0);
}

function nextVersion(changelog, date = todayIso()) {
    const latest = (changelog.versions || [])[0] || { version: changelog.current || '0.0.0', date: '' };
    const [major, minor, patch] = parseVersion(latest.version || changelog.current);
    if (latest.date === date) return `${major}.${minor}.${patch + 1}`;
    return `${major}.${minor + 1}.0`;
}

function replaceInFile(filePath, replacer) {
    const before = fs.readFileSync(filePath, 'utf8');
    const after = replacer(before);
    if (after !== before) fs.writeFileSync(filePath, after);
}

function writeVersion(version) {
    const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
    pkg.version = version;
    fs.writeFileSync(packagePath, `${JSON.stringify(pkg, null, 2)}\n`);

    const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
    lock.version = version;
    if (lock.packages && lock.packages['']) lock.packages[''].version = version;
    fs.writeFileSync(lockPath, `${JSON.stringify(lock, null, 2)}\n`);

    replaceInFile(swPath, text => text.replace(/to-hwpx-v\d+\.\d+\.\d+/g, `to-hwpx-v${version}`));
    replaceInFile(indexPath, text => text.replace(/v\d+\.\d+\.\d+ 업데이트 내역/g, `v${version} 업데이트 내역`));
}

const changelog = JSON.parse(fs.readFileSync(changelogPath, 'utf8'));
const dateArg = process.argv.find(arg => /^--date=/.test(arg));
const date = dateArg ? dateArg.slice('--date='.length) : todayIso();
const version = nextVersion(changelog, date);

if (process.argv.includes('--write')) {
    writeVersion(version);
    console.log(`updated ${version}`);
} else {
    console.log(version);
}
