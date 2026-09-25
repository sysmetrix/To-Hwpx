// SVG 브랜드 마크에서 favicon·Apple Touch·PWA PNG와 멀티사이즈 ICO를 재생성한다.
// 사용법: node scripts/gen-icons.js
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ICONS_DIR = path.join(__dirname, '..', 'icons');

async function renderSvg(browser, svg, size, fileName, { background = 'transparent' } = {}) {
    const page = await browser.newPage({ viewport: { width: size, height: size } });
    await page.setContent(`<!doctype html><html><head><style>
        html,body{margin:0;padding:0;width:${size}px;height:${size}px;background:${background};}
        svg{display:block;width:${size}px;height:${size}px;}
    </style></head><body>${svg}</body></html>`);
    const outPath = path.join(ICONS_DIR, fileName);
    await page.screenshot({ path: outPath, omitBackground: background === 'transparent' });
    await page.close();
    console.log('wrote', outPath);
    return fs.readFileSync(outPath);
}

function writeIco(images, fileName) {
    const headerSize = 6 + images.length * 16;
    const header = Buffer.alloc(headerSize);
    header.writeUInt16LE(0, 0); // reserved
    header.writeUInt16LE(1, 2); // image type: icon
    header.writeUInt16LE(images.length, 4);
    let offset = headerSize;
    images.forEach(({ size, bytes }, index) => {
        const entry = 6 + index * 16;
        header.writeUInt8(size === 256 ? 0 : size, entry);
        header.writeUInt8(size === 256 ? 0 : size, entry + 1);
        header.writeUInt8(0, entry + 2);
        header.writeUInt8(0, entry + 3);
        header.writeUInt16LE(1, entry + 4);
        header.writeUInt16LE(32, entry + 6);
        header.writeUInt32LE(bytes.length, entry + 8);
        header.writeUInt32LE(offset, entry + 12);
        offset += bytes.length;
    });
    const outPath = path.join(ICONS_DIR, fileName);
    fs.writeFileSync(outPath, Buffer.concat([header, ...images.map(image => image.bytes)]));
    console.log('wrote', outPath);
}

async function main() {
    const svg = fs.readFileSync(path.join(ICONS_DIR, 'app-icon.svg'), 'utf8');
    const maskableSvg = fs.readFileSync(path.join(ICONS_DIR, 'app-icon-maskable.svg'), 'utf8');
    const browser = await chromium.launch();
    try {
        const faviconImages = [];
        for (const size of [16, 32, 48]) {
            const bytes = await renderSvg(browser, svg, size, `favicon-${size}.png`);
            faviconImages.push({ size, bytes });
        }
        writeIco(faviconImages, 'favicon.ico');
        await renderSvg(browser, svg, 180, 'apple-touch-icon.png', { background: '#f7f8f5' });
        for (const size of [192, 512]) {
            await renderSvg(browser, svg, size, `app-icon-${size}.png`);
        }
        await renderSvg(browser, maskableSvg, 512, 'app-icon-maskable-512.png', { background: '#dcebe6' });
    } finally {
        await browser.close();
    }
}

main().catch(error => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
});
