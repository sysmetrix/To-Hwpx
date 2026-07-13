// SVG 브랜드 마크(icons/app-icon.svg)를 PWA 설치용 PNG(192/512)로 재생성한다.
// 사용법: node scripts/gen-icons.js
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

async function main() {
    const svgPath = path.join(__dirname, '..', 'icons', 'app-icon.svg');
    const svg = fs.readFileSync(svgPath, 'utf8');
    const browser = await chromium.launch();
    try {
        for (const size of [192, 512]) {
            const page = await browser.newPage({ viewport: { width: size, height: size } });
            await page.setContent(`<!doctype html><html><head><style>
                html,body{margin:0;padding:0;width:${size}px;height:${size}px;background:transparent;}
                svg{display:block;width:${size}px;height:${size}px;}
            </style></head><body>${svg}</body></html>`);
            const outPath = path.join(__dirname, '..', 'icons', `app-icon-${size}.png`);
            await page.screenshot({ path: outPath, omitBackground: true });
            await page.close();
            console.log('wrote', outPath);
        }
    } finally {
        await browser.close();
    }
}

main();
