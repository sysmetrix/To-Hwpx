'use strict';
/**
 * DOCX → HWPX 재현도 점수 채점기.
 *
 * 원본 .docx와 이미 생성된 HWPX(tests/section0-real.xml, tests/header-real.xml)를
 * 항목별로 대조해 100점 만점으로 채점하고 미달 항목의 구체적 근거를 출력한다.
 *
 * 사용: node tests/docx-fidelity-score.js "원본 docx.docx"
 * (HWPX는 tests/docx-real-convert.js로 먼저 생성해 둘 것)
 */
const fs = require('fs');
const path = require('path');
const JSZip = require('jszip');

const DOCX = process.argv[2] || path.join(__dirname, '..', '원본 docx.docx');
const SECTION = path.join(__dirname, 'section0-real.xml');
const HEADER = path.join(__dirname, 'header-real.xml');

const all = (s, re) => [...String(s).matchAll(re)];
const count = (s, re) => all(s, re).length;
const norm = (c) => String(c || '').replace(/^#/, '').toUpperCase();
const uniq = (a) => [...new Set(a)];

/** 원본 DOCX에서 사실(fact)을 추출한다. */
async function readDocx(file) {
    const zip = await JSZip.loadAsync(fs.readFileSync(file));
    const doc = await zip.file('word/document.xml').async('string');
    const stylesFile = zip.file('word/styles.xml');
    const styles = stylesFile ? await stylesFile.async('string') : '';
    const body = doc.slice(doc.indexOf('<w:body'));

    // 표 바깥/안 구분 없이 전체 문단. 셀 안 문단도 HWPX에 그대로 나오므로 모두 센다.
    const paras = all(body, /<w:p\b[^>]*>[\s\S]*?<\/w:p>/g).map(m => m[0]);
    const texts = all(body, /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)
        .map(m => m[1].replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
            .replace(/&quot;/g, '"').replace(/&apos;/g, "'"));

    // 스타일별 색상(스타일에만 색이 있고 run에는 없는 경우가 있다).
    // 본문에서 실제로 참조되는 스타일만 센다 — 정의만 있고 쓰이지 않는 스타일의 색까지
    // 요구하면 재현할 대상이 없는데도 감점되는 오탐이 된다.
    const usedStyleIds = new Set(all(body, /<w:(?:p|r)Style\s+w:val="([^"]+)"/g).map(m => m[1]));
    const styleColors = uniq(all(styles, /<w:style\b[^>]*>[\s\S]*?<\/w:style>/g)
        .filter(m => usedStyleIds.has((m[0].match(/w:styleId="([^"]+)"/) || [])[1]))
        .map(m => (m[0].match(/<w:color\s+w:val="([0-9A-Fa-f]{6})"/) || [])[1])
        .filter(Boolean).map(norm));

    return {
        paragraphs: paras.length,
        tables: count(body, /<w:tbl[ >]/g),
        rows: count(body, /<w:tr[ >]/g),
        cells: count(body, /<w:tc[ >]/g),
        lineBreaks: count(body, /<w:br\b(?![^>]*w:type="page")/g),
        images: count(body, /<a:blip\b/g),
        hyperlinks: count(body, /<w:hyperlink\b[^>]*r:id=/g),
        bold: count(body, /<w:b\/>|<w:b\s+w:val="(?:1|true|on)"/g),
        italic: count(body, /<w:i\/>|<w:i\s+w:val="(?:1|true|on)"/g),
        underline: count(body, /<w:u\s+w:val="(?!none)/g),
        strike: count(body, /<w:strike\/>|<w:strike\s+w:val="(?:1|true|on)"/g),
        // 셀 배경(tcPr 안의 shd)
        cellFills: uniq(all(body, /<w:tcPr>[\s\S]*?<\/w:tcPr>/g)
            .map(m => (m[0].match(/<w:shd\b[^>]*w:fill="([0-9A-Fa-f]{6})"/) || [])[1])
            .filter(f => f && !/^(FFFFFF|ffffff)$/.test(f)).map(norm)),
        // 문단 배경(pPr 안의 shd) — 콜아웃 상자
        paraFills: uniq(all(body, /<w:pPr>[\s\S]*?<\/w:pPr>/g)
            .map(m => (m[0].match(/<w:shd\b[^>]*w:fill="([0-9A-Fa-f]{6})"/) || [])[1])
            .filter(f => f && !/^(FFFFFF|ffffff)$/.test(f)).map(norm)),
        // 글자 색
        runColors: uniq(all(body, /<w:color\s+w:val="([0-9A-Fa-f]{6})"/g).map(m => norm(m[1]))),
        styleColors,
        // 글자 배경(run shd) + 형광펜
        runFills: uniq(all(body, /<w:rPr>[\s\S]*?<\/w:rPr>/g)
            .map(m => (m[0].match(/<w:shd\b[^>]*w:fill="([0-9A-Fa-f]{6})"/) || [])[1])
            .filter(f => f && !/^(FFFFFF|ffffff)$/.test(f)).map(norm)),
        align: {
            center: count(body, /<w:jc\s+w:val="center"/g),
            right: count(body, /<w:jc\s+w:val="right"/g),
            both: count(body, /<w:jc\s+w:val="(?:both|distribute)"/g),
        },
        gridSpan: count(body, /<w:gridSpan\b/g),
        vMerge: count(body, /<w:vMerge\b/g),
        // 실제로 글자가 그려지는 run의 크기만 센다(half-point → pt).
        // 공백뿐인 spacer run의 w:sz는 글리프가 없어 눈에 보이는 크기가 아니다.
        fontSizes: uniq(all(body, /<w:r>[\s\S]*?<\/w:r>/g)
            .filter(m => all(m[0], /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g).some(t => t[1].trim()))
            .map(m => Number((m[0].match(/<w:sz\s+w:val="(\d+)"/) || [])[1]))
            .filter(v => Number.isFinite(v) && v > 0).map(v => v / 2)),
        footnotes: count(body, /<w:footnoteReference\b/g),
        // 페이지 설정(twip)
        page: (() => {
            const sz = body.match(/<w:pgSz\b[^>]*\/>/);
            const mar = body.match(/<w:pgMar\b[^>]*\/>/);
            const at = (s, k) => Number((String(s || '').match(new RegExp(`w:${k}="(-?\\d+)"`)) || [])[1] || 0);
            return {
                w: at(sz, 'w'), h: at(sz, 'h'),
                landscape: /w:orient="landscape"/.test(sz || ''),
                left: at(mar, 'left'), right: at(mar, 'right'),
                top: at(mar, 'top'), bottom: at(mar, 'bottom'),
            };
        })(),
        // 첫 표의 열 너비 비율
        firstTableGrid: (() => {
            const t = body.match(/<w:tblGrid>[\s\S]*?<\/w:tblGrid>/);
            if (!t) return [];
            const w = all(t[0], /w:w="(\d+)"/g).map(m => Number(m[1]));
            const sum = w.reduce((a, b) => a + b, 0);
            return sum ? w.map(v => v / sum) : [];
        })(),
        texts,
    };
}

/** 생성된 HWPX에서 사실을 추출한다. */
function readHwpx() {
    const s = fs.readFileSync(SECTION, 'utf-8');
    const h = fs.readFileSync(HEADER, 'utf-8');
    const charPrs = all(h, /<hh:charPr\b[\s\S]*?<\/hh:charPr>/g).map(m => m[0]);
    return {
        section: s, header: h,
        paragraphs: count(s, /<hp:p\b/g),
        tables: count(s, /<hp:tbl\b/g),
        rows: count(s, /<hp:tr\b/g),
        cells: count(s, /<hp:tc\b/g),
        lineBreaks: count(s, /<hp:lineBreak\b|linebreak/gi),
        images: count(s, /<hc:img\b/g),
        hyperlinks: count(s, /<hp:fieldBegin\b[^>]*type="HYPERLINK"/g),
        texts: all(s, /<hp:t(?:\s[^>]*)?>([\s\S]*?)<\/hp:t>/g)
            .map(m => m[1].replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
                .replace(/&quot;/g, '"').replace(/&apos;/g, "'")),
        bold: count(charPrs.join(''), /<hh:bold\b/g),
        italic: count(charPrs.join(''), /<hh:italic\b/g),
        underline: count(charPrs.join(''), /<hh:underline\b[^>]*type="(?!NONE)/g),
        strike: count(charPrs.join(''), /<hh:strikeout\b[^>]*type="(?!NONE)/g),
        fillColors: uniq(all(h, /<hc:winBrush\b[^>]*faceColor="#?([0-9A-Fa-f]{6})"/g).map(m => norm(m[1]))),
        textColors: uniq(charPrs.map(c => (c.match(/textColor="#?([0-9A-Fa-f]{6})"/) || [])[1])
            .filter(Boolean).map(norm)),
        shadeColors: uniq(charPrs.map(c => (c.match(/shadeColor="#?([0-9A-Fa-f]{6})"/) || [])[1])
            .filter(c => c && c.toUpperCase() !== 'NONE').map(norm)),
        align: {
            center: count(s, /paraPrIDRef="(\d+)"/g) && null,
        },
        colSpan: count(s, /colSpan="([2-9]|\d\d+)"/g),
        rowSpan: count(s, /rowSpan="([2-9]|\d\d+)"/g),
        // 정렬은 paraPr 정의를 통해 간접 확인
        alignDefs: uniq(all(h, /<hh:align\b[^>]*horizontal="(\w+)"/g).map(m => m[1])),
        footnotes: count(s, /<hp:footNote\b|<hp:noteShape\b/g),
        // charPr의 height(HWPUNIT, 1pt=100) → pt
        fontSizes: uniq(charPrs.map(c => Number((c.match(/height="(\d+)"/) || [])[1] || 0))
            .filter(Boolean).map(v => v / 100)),
        // 첫 표의 열 너비 비율(첫 행의 cellSz만)
        firstRowWidths: (() => {
            const tr = s.match(/<hp:tr\b[\s\S]*?<\/hp:tr>/);
            if (!tr) return [];
            const w = all(tr[0], /<hp:cellSz\b[^>]*width="(\d+)"/g).map(m => Number(m[1]));
            const sum = w.reduce((a, b) => a + b, 0);
            return sum ? w.map(v => v / sum) : [];
        })(),
        page: {
            w: Number((s.match(/<hp:pagePr\b[^>]*width="(\d+)"/) || [])[1] || 0),
            h: Number((s.match(/<hp:pagePr\b[^>]*height="(\d+)"/) || [])[1] || 0),
            landscape: /landscape="(?:1|LANDSCAPE)"|orientation="LANDSCAPE"/i.test(s),
            left: Number((s.match(/<hp:margin\b[^>]*left="(\d+)"/) || [])[1] || 0),
            right: Number((s.match(/<hp:margin\b[^>]*right="(\d+)"/) || [])[1] || 0),
            top: Number((s.match(/<hp:margin\b[^>]*top="(\d+)"/) || [])[1] || 0),
            bottom: Number((s.match(/<hp:margin\b[^>]*bottom="(\d+)"/) || [])[1] || 0),
        },
    };
}

/** twip(1/1440인치) → HWPUNIT(1/7200인치) */
const twipToHwp = (t) => Math.round(t * 5);

/** 텍스트 커버리지: 원본의 각 텍스트 조각이 HWPX 전체 텍스트에 존재하는가. */
function textCoverage(docx, hwpx) {
    const haystack = hwpx.texts.join('\u0001');
    let total = 0, hit = 0;
    const missing = [];
    for (const t of docx.texts) {
        const s = t.trim();
        if (!s) continue;
        total += s.length;
        if (haystack.includes(s)) hit += s.length;
        else if (missing.length < 12) missing.push(s.slice(0, 60));
    }
    return { ratio: total ? hit / total : 1, total, hit, missing };
}

/** 두 색 집합의 교집합 비율 */
function colorCoverage(want, haveSets) {
    const have = new Set(haveSets.flat());
    const missing = want.filter(c => !have.has(c));
    return { ratio: want.length ? (want.length - missing.length) / want.length : 1, missing, want };
}

/** 계수 일치도: 부족하면 감점, 초과는 감점하지 않음(HWPX가 문단을 더 쪼갤 수 있음) */
function countScore(src, out, allowExcess = true) {
    if (src === 0) return out === 0 || allowExcess ? 1 : 0;
    if (out >= src) return allowExcess ? 1 : Math.min(1, src / out);
    return out / src;
}

(async () => {
    if (!fs.existsSync(SECTION) || !fs.existsSync(HEADER)) {
        console.error('먼저 node tests/docx-real-convert.js 로 HWPX를 생성하세요.');
        process.exit(2);
    }
    const d = await readDocx(DOCX);
    const x = readHwpx();

    const cov = textCoverage(d, x);
    const cellC = colorCoverage(d.cellFills, [x.fillColors]);
    const paraC = colorCoverage(d.paraFills, [x.fillColors]);
    const textC = colorCoverage(d.runColors.concat(d.styleColors).filter(c => c !== 'FFFFFF'),
        [x.textColors]);
    const runFillC = colorCoverage(d.runFills, [x.shadeColors, x.fillColors]);

    // 페이지 설정: 크기·방향·여백을 2% 오차 안에서 비교
    const near = (a, b, tol) => (a === 0 && b === 0) || Math.abs(a - b) <= Math.max(tol, Math.abs(b) * 0.02);
    const pageChecks = [
        near(x.page.w, twipToHwp(d.page.w), 60),
        near(x.page.h, twipToHwp(d.page.h), 60),
        x.page.landscape === d.page.landscape,
        near(x.page.left, twipToHwp(d.page.left), 60),
        near(x.page.right, twipToHwp(d.page.right), 60),
        near(x.page.top, twipToHwp(d.page.top), 60),
        near(x.page.bottom, twipToHwp(d.page.bottom), 60),
    ];
    const pageRatio = pageChecks.filter(Boolean).length / pageChecks.length;

    // 열 너비 비율: 첫 표 기준, 각 열 비율 오차 2%p 이내면 일치
    const gw = d.firstTableGrid, hw = x.firstRowWidths;
    const colRatio = !gw.length ? 1
        : gw.length !== hw.length ? 0
            : gw.filter((v, i) => Math.abs(v - hw[i]) <= 0.02).length / gw.length;

    // 글자 크기: 원본에서 쓰인 pt가 HWPX charPr에 존재하는가(0.5pt 오차 허용)
    const sizeMissing = d.fontSizes.filter(pt => !x.fontSizes.some(o => Math.abs(o - pt) <= 0.5));
    const sizeRatio = d.fontSizes.length
        ? (d.fontSizes.length - sizeMissing.length) / d.fontSizes.length : 1;

    const items = [
        ['텍스트 완전성', 18, cov.ratio,
            cov.missing.length ? `누락 예: ${cov.missing.slice(0, 5).join(' | ')}` : '전체 일치'],
        ['표 구조(표/행/셀)', 10,
            (countScore(d.tables, x.tables, false) + countScore(d.rows, x.rows, false)
                + countScore(d.cells, x.cells, false)) / 3,
            `표 ${x.tables}/${d.tables}, 행 ${x.rows}/${d.rows}, 셀 ${x.cells}/${d.cells}`],
        ['문단 보존', 6, countScore(d.paragraphs, x.paragraphs),
            `문단 ${x.paragraphs}/${d.paragraphs}`],
        ['수동 줄바꿈', 3, countScore(d.lineBreaks, x.lineBreaks),
            `줄바꿈 ${x.lineBreaks}/${d.lineBreaks}`],
        ['그림', 4, countScore(d.images, x.images, false), `그림 ${x.images}/${d.images}`],
        ['하이퍼링크', 3, countScore(d.hyperlinks, x.hyperlinks, false),
            `링크 ${x.hyperlinks}/${d.hyperlinks}`],
        ['표 셀 배경색', 8, cellC.ratio,
            cellC.missing.length ? `누락 ${cellC.missing.join(', ')}` : `${cellC.want.length}색 전부 반영`],
        ['문단 배경(콜아웃)', 5, paraC.ratio,
            paraC.missing.length ? `누락 ${paraC.missing.join(', ')}` : `${paraC.want.length}색 전부 반영`],
        ['글자 색', 8, textC.ratio,
            textC.missing.length ? `누락 ${textC.missing.slice(0, 10).join(', ')}` : `${textC.want.length}색 전부 반영`],
        ['글자 배경/형광', 4, runFillC.ratio,
            runFillC.missing.length ? `누락 ${runFillC.missing.join(', ')}` : `${runFillC.want.length}색 전부 반영`],
        ['글자 서식(굵게/기울임/밑줄/취소선)', 5,
            (d.bold ? Math.min(1, x.bold ? 1 : 0) : 1) * 0.4
            + (d.italic ? (x.italic ? 1 : 0) : 1) * 0.2
            + (d.underline ? (x.underline ? 1 : 0) : 1) * 0.2
            + (d.strike ? (x.strike ? 1 : 0) : 1) * 0.2,
            `원본 B${d.bold}/I${d.italic}/U${d.underline}/S${d.strike} → HWPX charPr B${x.bold}/I${x.italic}/U${x.underline}/S${x.strike}`],
        ['셀 병합', 4,
            (countScore(d.gridSpan, x.colSpan, false) + countScore(d.vMerge, x.rowSpan, false)) / 2,
            `가로병합 ${x.colSpan}/${d.gridSpan}, 세로병합 ${x.rowSpan}/${d.vMerge}`],
        ['정렬', 4,
            (d.align.center ? (x.alignDefs.includes('CENTER') ? 1 : 0) : 1) * 0.4
            + (d.align.right ? (x.alignDefs.includes('RIGHT') ? 1 : 0) : 1) * 0.3
            + (d.align.both ? (x.alignDefs.includes('JUSTIFY') ? 1 : 0) : 1) * 0.3,
            `원본 가운데${d.align.center}/오른쪽${d.align.right}/양쪽${d.align.both} → HWPX align 정의 [${x.alignDefs.join(',')}]`],
        ['글자 크기', 6, sizeRatio,
            sizeMissing.length ? `누락 ${sizeMissing.join(', ')}pt` : `${d.fontSizes.length}종 전부 반영`],
        ['페이지 설정(크기/방향/여백)', 6, pageRatio,
            `${x.page.w}×${x.page.h} vs ${twipToHwp(d.page.w)}×${twipToHwp(d.page.h)}, `
            + `여백 L${x.page.left}/${twipToHwp(d.page.left)} R${x.page.right}/${twipToHwp(d.page.right)} `
            + `T${x.page.top}/${twipToHwp(d.page.top)} B${x.page.bottom}/${twipToHwp(d.page.bottom)}`],
        ['표 열 너비 비율', 4, colRatio,
            gw.length ? `${gw.length}열: ${gw.map(v => (v * 100).toFixed(0)).join('/')} vs ${hw.map(v => (v * 100).toFixed(0)).join('/')}` : '표 없음'],
        ['각주/주석', 2, countScore(d.footnotes, x.footnotes, false),
            `각주 ${x.footnotes}/${d.footnotes}`],
    ];

    let score = 0, max = 0;
    console.log('\n=== DOCX → HWPX 재현도 채점 ===');
    console.log(`원본: ${path.basename(DOCX)}\n`);
    for (const [name, w, r, note] of items) {
        const got = w * Math.max(0, Math.min(1, r));
        score += got; max += w;
        // 반올림으로 손실을 숨기지 않는다 — 정확히 1.0일 때만 ✅.
        const mark = r >= 1 ? '✅' : r >= 0.9 ? '🟡' : '❌';
        console.log(`${mark} ${name.padEnd(34)} ${got.toFixed(1)}/${w}  ${note}`);
    }
    const pct = (score / max) * 100;
    console.log(`\n총점: ${score.toFixed(1)} / ${max}  →  ${pct.toFixed(1)}점`);
    process.exitCode = pct >= 99.5 ? 0 : 1;
})();
