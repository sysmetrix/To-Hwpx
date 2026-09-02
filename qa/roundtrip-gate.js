/* ===================================================================
 * [qa/roundtrip-gate.js] 왕복 불변식 게이트  IR → HWPX → IR′
 * ===================================================================
 * 실행: node qa/roundtrip-gate.js [--verbose]
 *
 * 무엇을 바꾸는가
 * ---------------
 * 지금까지 변환 품질의 근거는 "자기 픽스처를 자기 채점기로 잰 점수"였다.
 * 회귀 감지에는 쓸모가 있지만 제3자가 재현할 수 있는 주장은 아니다.
 * 채점 규칙을 느슨하게 쓰면 점수는 올라가고, 아무도 눈치채지 못한다.
 *
 * 이 게이트는 만든 HWPX를 **다시 읽어** IR로 되돌리고 원본 IR과 비교한다.
 * 살아남지 못한 것은 그 자체로 "이 형식으로 표현되지 않았다"는 뜻이다.
 * 점수를 매기지 않는다. 세고, 비교하고, 다르면 실패한다.
 *
 * 불변식 (전부 지켜야 한다)
 *   ① 본문 텍스트가 빠짐없이 살아남는다
 *   ② 표 개수와 각 표의 행·열·셀 수, 머리행 유무가 같다
 *   ③ 링크 개수와 URL 집합이 같다
 *   ④ 목록 항목 수·중첩 레벨 분포·순서 목록 항목 수·태스크 체크 상태가 같다
 *   ⑤ 제목 개수와 레벨 분포가 같다
 *   ⑥ 그림 개수가 같다
 *   ⑦ 코드 블록 개수와 코드 본문이 같다
 *
 * 의도된 변형 (실패가 아니며, 여기에 명시된 것만 허용한다)
 *   - 첫 H1은 ir.title로 승격되어 본문 제목 문단으로 렌더된다.
 *   - 빈 줄(blank)은 간격 표현이라 개수를 보지 않는다.
 *   - 코드 블록은 표로 렌더된 뒤 코드로 되돌아온다(paraPr 14로 판별).
 *
 * ⚠ 이 게이트는 구조 보존만 본다. 한컴에서 어떻게 보이는지는 여전히 사람이 본다.
 * ===================================================================*/

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');

const ROOT = path.resolve(__dirname, '..');
const VERBOSE = process.argv.includes('--verbose');

/**
 * 왕복 검사에 쓸 입력 — DOM 없이 파싱 가능한 포맷.
 * tests/fixtures/fidelity/*는 재현도 채점용으로 만든 가장 조밀한 표본이라
 * 왕복 검사에서도 가장 많은 것을 드러낸다.
 */
const FIXTURES = [
    'qa/fixtures/md_hwpx_test.md',
    'qa/fixtures/sample.md',
    'qa/fixtures/md_link_image_test.md',
    'tests/fixtures/fidelity/rich.md',
    'tests/fixtures/fidelity/rich.csv',
    'tests/fixtures/fidelity/rich.json',
    'tests/fixtures/fidelity/rich.txt',
    'qa/fixtures/sample.csv',
    'qa/fixtures/sample.json',
    'qa/fixtures/sample.txt',
];

// ─────────────────────────────────────────────────────────────────────────
// [측정] IR에서 비교 가능한 값만 뽑는다
// ─────────────────────────────────────────────────────────────────────────

/**
 * 이모지 치환 — js/hwpx.js replaceEmoji()와 **같은 규칙**이어야 한다.
 *
 * 한/글이 지원하지 않는 이모지를 □로 바꾸는 것은 렌더러의 의도된 동작이다.
 * 왕복 비교에서 이걸 손실로 세면 게이트가 고칠 수 없는 실패를 계속 낸다.
 * 대신 원본 쪽에 같은 규칙을 적용해 "약속대로 치환됐는가"를 본다.
 * 렌더러의 규칙이 바뀌면 여기도 바꿔야 하고, 놓치면 이 게이트가 잡는다.
 */
function applyEmojiPolicy(s) {
    return String(s || '')
        .replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, '□')
        .replace(/[☀-⭕]/g, '□')
        .replace(/[︀-️‍]/g, '');
}

function normText(s) {
    return applyEmojiPolicy(s).replace(/\s+/g, ' ').trim();
}

/**
 * URL 정규화 — js/hwpx.js normalizeSafeHyperlink()와 **같은 규칙**이어야 한다.
 *
 * 렌더러는 `new URL(src).href`를 기록하므로 `https://example.org`가
 * `https://example.org/`가 된다. 이건 의도된 정규화이며 손실이 아니다.
 * 안전하지 않은 스킴은 빈 문자열이 되어 링크가 사라지는데, 그건 손실로
 * 세야 하므로 여기서도 같게 걸러 원본 쪽 기대값을 만든다.
 */
function normUrl(raw) {
    const src = String(raw || '').trim();
    if (!src) return '';
    try {
        const u = new URL(src);
        return ['http:', 'https:', 'mailto:'].includes(u.protocol) ? u.href : '';
    } catch {
        return '';
    }
}

/**
 * 블록에서 평문을 뽑는다.
 *
 * IR은 같은 정보를 여러 모양으로 담는다 — 목록 항목은 문자열(JSON 파서)일 수도
 * {text, runs}(Markdown 파서)일 수도 있고, quote는 text가 아니라 중첩 blocks를
 * 갖는다. 한쪽 모양만 읽으면 원본에서 내용이 **비어 보이고**, 왕복 쪽에만
 * 있는 것처럼 나타나 렌더러 결함으로 오진하게 된다(실제로 그렇게 오진했다).
 */
function blockText(b) {
    if (!b) return '';
    const fromRuns = x => (Array.isArray(x?.runs) ? x.runs.map(r => r.text).join('') : (x?.text ?? ''));
    const itemText = i => (typeof i === 'string' ? i : fromRuns(i));
    const cellText = c => {
        if (typeof c === 'string') return c;
        if (Array.isArray(c?.blocks) && c.blocks.length) return c.blocks.map(blockText).join('\n');
        return fromRuns(c);
    };

    switch (b.type) {
        case 'para': case 'heading': case 'code': case 'code-line':
            return fromRuns(b);

        case 'quote':
            // quote는 중첩 blocks로 본문을 담는다(text가 아니다).
            return Array.isArray(b.blocks) && b.blocks.length
                ? b.blocks.map(blockText).join('\n')
                : fromRuns(b);

        case 'list':
            return (b.items || []).map(itemText).join('\n');

        case 'list-item':
            return fromRuns(b);

        case 'table': {
            const head = (b.header || []).map(cellText).join('\t');
            const body = (b.rows || []).map(r => (r || []).map(cellText).join('\t')).join('\n');
            return [head, body].filter(Boolean).join('\n');
        }

        case 'image':
            return b.alt || '';

        default:
            return b.text || '';
    }
}

function collectRuns(blocks) {
    const out = [];
    for (const b of blocks) {
        if (Array.isArray(b.runs)) out.push(...b.runs);
        if (b.type === 'list') for (const i of b.items || []) if (Array.isArray(i.runs)) out.push(...i.runs);
    }
    return out;
}

/**
 * 표의 비교 가능한 모양.
 *
 * `hasHeader`가 반드시 있어야 한다. 없으면 머리행이 일반 행으로 내려앉아도
 * 행·셀 총계가 그대로라 게이트가 통과한다 — 변이 테스트에서 실제로 그랬다
 * (`header="1"` → `header="0"`으로 바꿔도 6/6 통과). 머리행 지정은 한컴에서
 * 표가 페이지를 넘길 때 반복되는지를 가르는 의미 있는 정보다.
 */
function tableShape(b) {
    const rows = (b.rows || []).length + (b.header ? 1 : 0);
    const widths = [];
    if (b.header) widths.push(b.header.length);
    for (const r of b.rows || []) widths.push((r || []).length);
    return {
        rows,
        cols: widths.length ? Math.max(...widths) : 0,
        cells: widths.reduce((a, c) => a + c, 0),
        hasHeader: !!(b.header && b.header.length),
    };
}

/**
 * IR을 비교 가능한 지문으로 만든다.
 *
 * @param {boolean} titleIsRendered
 *   원본 IR에서는 title이 blocks 밖에 있고 렌더러가 본문 제목 문단으로 그린다.
 *   왕복 IR에서는 그 문단이 이미 blocks 안에 있고 title(PrvText)은 그 사본이다.
 *   양쪽 다 title을 더하면 왕복 쪽만 두 번 세어 항상 불일치한다.
 */
function fingerprint(ir, blocks, titleIsRendered = true) {
    const bs = blocks.filter(b => b.type !== 'blank');
    const runs = collectRuns(bs);

    const headings = bs.filter(b => b.type === 'heading');
    const lists = bs.filter(b => b.type === 'list');
    const listItems = lists.flatMap(l => l.items || []);
    const tables = bs.filter(b => b.type === 'table');
    const codes = bs.filter(b => b.type === 'code');
    const images = bs.filter(b => b.type === 'image');

    return {
        text: normText([titleIsRendered ? (ir.title || '') : '', ...bs.map(blockText)].join('\n')),
        headingLevels: headings.map(h => h.level).sort((a, b2) => a - b2),
        listItemCount: listItems.length,
        listLevels: listItems.map(i => (typeof i === 'object' ? (i.level || 0) : 0)).sort((a, b2) => a - b2),
        // 순서 목록 여부와 태스크 상태는 마커가 담는 정보다. 마커를 떼면서
        // 이것까지 버리면 HWPX를 Markdown으로 되돌릴 때 번호가 글머리가 되고
        // 체크박스가 사라진다 — 실제로 그랬고 이 항목이 그 회귀를 막는다.
        //
        // ordered는 IR 모양에 따라 항목에 있기도(Markdown 파서) 블록에 있기도
        // (역파서) 하다. 한쪽만 보면 같은 문서를 다르게 센다.
        orderedItemCount: lists.reduce(
            (n, l) => n + (l.items || []).filter(
                i => (typeof i === 'object' && i.ordered === true) || l.ordered === true
            ).length,
            0,
        ),
        taskStates: listItems
            .filter(i => typeof i === 'object' && i.task)
            .map(i => (i.checked ? 'x' : ' '))
            .sort(),
        tableShapes: tables.map(tableShape),
        tableCount: tables.length,
        codeTexts: codes.map(c => normText(c.text)),
        imageCount: images.length,
        // 안전하지 않은 스킴은 렌더러가 링크를 걸지 않으므로 기대값에서도 뺀다.
        // 걸러진 것까지 기대하면 게이트가 고칠 수 없는 실패를 계속 낸다.
        linkUrls: runs.map(r => normUrl(r.href)).filter(Boolean).sort(),
    };
}

// ─────────────────────────────────────────────────────────────────────────
// [비교]
// ─────────────────────────────────────────────────────────────────────────

function diffLists(a, b, label) {
    if (a.length !== b.length) return `${label} 개수 ${a.length} → ${b.length}`;
    for (let i = 0; i < a.length; i++) {
        if (JSON.stringify(a[i]) !== JSON.stringify(b[i])) {
            return `${label}[${i}] ${JSON.stringify(a[i])} → ${JSON.stringify(b[i])}`;
        }
    }
    return null;
}

function firstTextDiff(a, b) {
    let i = 0;
    while (i < a.length && i < b.length && a[i] === b[i]) i++;
    return `첫 차이 ${i}자\n        원본: …${a.slice(Math.max(0, i - 30), i + 50)}\n        왕복: …${b.slice(Math.max(0, i - 30), i + 50)}`;
}

function compare(src, back) {
    const issues = [];

    // ① 본문 텍스트 — 제목 승격을 반영해 양쪽 모두 title을 포함시켰다.
    if (src.text !== back.text) {
        issues.push(`① 본문 텍스트 불일치 (${src.text.length}자 → ${back.text.length}자)\n        ${firstTextDiff(src.text, back.text)}`);
    }

    // ② 표
    const tblDiff = diffLists(src.tableShapes, back.tableShapes, '② 표 구조');
    if (tblDiff) issues.push(tblDiff);

    // ③ 링크
    const linkDiff = diffLists(src.linkUrls, back.linkUrls, '③ 링크 URL');
    if (linkDiff) issues.push(linkDiff);

    // ④ 목록
    if (src.listItemCount !== back.listItemCount) {
        issues.push(`④ 목록 항목 수 ${src.listItemCount} → ${back.listItemCount}`);
    }
    const lvlDiff = diffLists(src.listLevels, back.listLevels, '④ 목록 중첩 레벨');
    if (lvlDiff) issues.push(lvlDiff);
    if (src.orderedItemCount !== back.orderedItemCount) {
        issues.push(`④ 순서 목록 항목 수 ${src.orderedItemCount} → ${back.orderedItemCount}`);
    }
    const taskDiff = diffLists(src.taskStates, back.taskStates, '④ 태스크 상태');
    if (taskDiff) issues.push(taskDiff);

    // ⑤ 제목
    const hDiff = diffLists(src.headingLevels, back.headingLevels, '⑤ 제목 레벨');
    if (hDiff) issues.push(hDiff);

    // ⑥ 그림
    if (src.imageCount !== back.imageCount) {
        issues.push(`⑥ 그림 개수 ${src.imageCount} → ${back.imageCount}`);
    }

    // ⑦ 코드
    const codeDiff = diffLists(src.codeTexts, back.codeTexts, '⑦ 코드 블록');
    if (codeDiff) issues.push(codeDiff);

    return issues;
}

// ─────────────────────────────────────────────────────────────────────────

(async () => {
    const require2 = createRequire(path.join(ROOT, 'x.js'));
    const { DOMParser } = require2('@xmldom/xmldom');
    const parseXml = (xml) => new DOMParser().parseFromString(xml, 'text/xml');

    globalThis.marked = require2('./js/vendor/marked-18.0.11.min.js');

    const { irToHwpx, ensureNodeRuntime } = await import('../js/core/index.js');
    const { hwpxToIr, coalesceBlocks } = await import('../js/core/hwpx-to-ir.js');
    const { parseMd, parseCsv, parseJson, parseTxt } = await import('../js/parsers.js');
    ensureNodeRuntime();

    const PARSERS = { '.md': parseMd, '.csv': parseCsv, '.json': parseJson, '.txt': parseTxt };

    console.log('왕복 불변식 게이트 — IR → HWPX → IR′\n');

    let failed = 0, checked = 0;
    for (const rel of FIXTURES) {
        const abs = path.join(ROOT, rel);
        if (!fs.existsSync(abs)) { console.log(`SKIP  ${rel} (없음)`); continue; }

        const ext = path.extname(abs).toLowerCase();
        const parser = PARSERS[ext];
        if (!parser) { console.log(`SKIP  ${rel} (파서 없음)`); continue; }

        checked++;
        let issues, srcFp, backFp;
        try {
            const text = fs.readFileSync(abs, 'utf8').replace(/^﻿/, '');
            const srcIr = parser(text, 'plain');

            const { bytes } = await irToHwpx(srcIr);
            const { ir: backIr } = await hwpxToIr(bytes, { parseXml });
            const backBlocks = coalesceBlocks(backIr.blocks);

            // 원본: title은 blocks 밖 → 렌더될 것이므로 포함
            // 왕복: title 문단이 이미 blocks 안 → PrvText의 title은 제외
            srcFp = fingerprint(srcIr, srcIr.blocks, true);
            backFp = fingerprint(backIr, backBlocks, false);
            issues = compare(srcFp, backFp);
        } catch (err) {
            issues = [`예외: ${err.message || err}`];
        }

        const ok = issues.length === 0;
        console.log(`${ok ? 'PASS' : 'FAIL'}  ${path.basename(rel)}`);
        if (srcFp) {
            console.log(`      텍스트 ${srcFp.text.length}자 · 제목 ${srcFp.headingLevels.length} · 목록 ${srcFp.listItemCount}`
                + ` · 표 ${srcFp.tableCount} · 코드 ${srcFp.codeTexts.length} · 링크 ${srcFp.linkUrls.length} · 그림 ${srcFp.imageCount}`);
        }
        for (const i of issues) console.log(`      ✗ ${i}`);
        if (VERBOSE && srcFp) {
            console.log(`      원본 지문: ${JSON.stringify({ ...srcFp, text: srcFp.text.slice(0, 60) + '…' })}`);
            console.log(`      왕복 지문: ${JSON.stringify({ ...backFp, text: backFp.text.slice(0, 60) + '…' })}`);
        }
        if (!ok) failed++;
    }

    console.log(`\n${checked - failed}/${checked} 통과`);
    if (failed) {
        console.error('\n왕복 불변식 실패 — 생성한 HWPX에서 되살아나지 않는 정보가 있다.');
        console.error('원인이 (a) 렌더러가 정보를 버림 (b) 역파서가 규약을 못 따라감 중 무엇인지 먼저 가려라.');
        process.exit(1);
    }
    console.log('왕복 불변식 통과. 만든 HWPX에서 원본 구조를 되살릴 수 있다.');
    console.log('※ 구조 보존만 본다. 한컴 화면 확인은 여전히 사람이 한다.');
})().catch(err => {
    console.error('게이트 실행 실패:', err.message || err);
    process.exit(1);
});
