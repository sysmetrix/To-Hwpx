/* ===================================================================
 * [qa/pdf-gate.js] PDF 구조 추론 게이트
 * ===================================================================
 * 실행: node qa/pdf-gate.js
 *
 * PDF는 레이아웃 형식이라 구조 복원이 **추론**이다. 그래서 다른 포맷처럼
 * "원본과 같은가"를 물을 수 없다. 대신 **정답을 아는 PDF**를 만들어 두고
 * 추론 결과가 그 정답과 맞는지 검사한다.
 *
 * 픽스처는 HTML에서 생성한다(구조를 우리가 정확히 알기 때문). 생성 과정은
 * tests/make-pdf-fixtures.js에 있고, 기대값은 이 파일에 함께 적는다 —
 * 정답과 검사가 떨어져 있으면 어느 쪽이 틀렸는지 알 수 없다.
 *
 * 이 게이트가 지키는 것
 *   ① 제목 개수와 레벨 — 글자 크기 추론이 무너지면 여기서 잡힌다
 *   ② 표 개수와 각 표의 행·열 — 열 경계 추론이 무너지면 여기서 잡힌다
 *   ③ 머리행 판정 — **근거 없이 머리행을 주장하지 않는지**까지 본다
 *   ④ 문단 이어붙이기 — 줄바꿈으로 잘린 문장이 한 문단으로 합쳐지는지
 *   ⑤ 본문 텍스트 보존 — 추론이 어긋나도 글자는 잃지 않아야 한다
 *   ⑥ 스캔 PDF(글자 레이어 없음)를 조용히 빈 문서로 만들지 않고 거절하는지
 *
 * ⑥이 특히 중요하다. 빈 HWPX를 성공으로 돌려주면 사용자는 변환이 된 줄 안다.
 * ===================================================================*/

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

/**
 * 픽스처별 기대값. 픽스처를 만드는 HTML과 짝을 이룬다.
 * `headerRow: false`는 "머리행이 아니어야 한다"가 아니라
 * **"머리행이라고 주장할 근거가 없으므로 주장하면 안 된다"**는 뜻이다.
 */
const EXPECTATIONS = [
    {
        file: 'qa/fixtures/sample.pdf',
        title: 'PDF 추출 검증 문서',
        headings: [2, 3],                       // 24pt는 제목으로 승격, 18/14pt가 본문 제목
        tables: [{ rows: 2, cols: 3, headerRow: true }],   // 머리행은 글꼴이 달라 근거 있음
        minListItems: 2,
        mustContain: [
            '첫 번째 문단입니다. 한글과 English가 섞여 있고 문장이 길어져서 자동으로 줄바꿈이 일어나도록 충분히 긴 내용을 담고 있습니다.',
            '표 다음 문단입니다.',
            '홍길동',
        ],
    },
    {
        file: 'tests/fixtures/gov-plan.pdf',
        title: '2026년도 사업 추진 계획',
        headings: [2, 2, 2, 2],                 // 4개 절 제목(14pt)
        tables: [
            { rows: 3, cols: 4, headerRow: true },    // 머리행 글꼴이 다름
            { rows: 4, cols: 2, headerRow: false },   // 글꼴이 같아 머리행 근거 없음
        ],
        mustContain: [
            '본 계획은 행정업무운영 및 혁신에 관한 규정 개정에 따라 개방형 문서 형식 전환을 추진하기 위하여 수립되었습니다.',
            '2026.10~',
            '155,000',
        ],
    },
];

function collectText(ir) {
    const out = [ir.title || ''];
    const walk = b => {
        if (!b) return;
        if (b.type === 'table') {
            for (const c of b.header || []) out.push(typeof c === 'string' ? c : c.text);
            for (const r of b.rows || []) for (const c of r) out.push(typeof c === 'string' ? c : c.text);
        } else if (b.type === 'list') {
            for (const i of b.items || []) out.push(typeof i === 'string' ? i : i.text);
        } else if (b.text) {
            out.push(b.text);
        }
    };
    for (const b of ir.blocks || []) walk(b);
    return out.join('\n');
}

function checkOne(ir, exp) {
    const issues = [];
    const blocks = ir.blocks || [];

    // ① 제목
    const headings = blocks.filter(b => b.type === 'heading').map(b => b.level);
    if (JSON.stringify(headings) !== JSON.stringify(exp.headings)) {
        issues.push(`① 제목 레벨 ${JSON.stringify(exp.headings)} 기대, ${JSON.stringify(headings)} 나옴`);
    }
    if (exp.title && ir.title !== exp.title) {
        issues.push(`① 문서 제목 "${exp.title}" 기대, "${ir.title}" 나옴`);
    }

    // ②③ 표
    const tables = blocks.filter(b => b.type === 'table');
    if (tables.length !== exp.tables.length) {
        issues.push(`② 표 개수 ${exp.tables.length} 기대, ${tables.length} 나옴`);
    } else {
        tables.forEach((t, i) => {
            const e = exp.tables[i];
            const bodyRows = (t.rows || []).length;
            const cols = Math.max(
                t.header ? t.header.length : 0,
                ...(t.rows || []).map(r => r.length),
                0,
            );
            const hasHeader = !!(t.header && t.header.length);
            if (bodyRows !== e.rows) issues.push(`② 표[${i}] 본문 행 ${e.rows} 기대, ${bodyRows} 나옴`);
            if (cols !== e.cols) issues.push(`② 표[${i}] 열 ${e.cols} 기대, ${cols} 나옴`);
            if (hasHeader !== e.headerRow) {
                issues.push(e.headerRow
                    ? `③ 표[${i}] 머리행을 찾지 못함(글꼴/크기 근거가 있는데 놓쳤다)`
                    : `③ 표[${i}] 근거 없이 머리행을 주장함`);
            }
        });
    }

    // ④ 목록
    if (exp.minListItems) {
        const items = blocks.filter(b => b.type === 'list').reduce((n, l) => n + (l.items || []).length, 0);
        if (items < exp.minListItems) {
            issues.push(`④ 목록 항목 ${exp.minListItems}개 이상 기대, ${items}개 나옴`);
        }
    }

    // ⑤ 본문 텍스트 — 줄바꿈으로 잘린 문장이 합쳐졌는지 포함해서 확인
    const text = collectText(ir).replace(/\s+/g, ' ');
    for (const needle of exp.mustContain || []) {
        if (!text.includes(needle.replace(/\s+/g, ' '))) {
            issues.push(`⑤ 본문에 없음: "${needle.slice(0, 50)}…"`);
        }
    }

    return issues;
}

(async () => {
    const { parsePdf } = await import('../js/pdf-parser.js');

    console.log('PDF 구조 추론 게이트\n');
    let failed = 0;

    for (const exp of EXPECTATIONS) {
        const abs = path.join(ROOT, exp.file);
        if (!fs.existsSync(abs)) {
            console.log(`FAIL  ${path.basename(exp.file)}\n      ✗ 픽스처 없음 — node tests/make-pdf-fixtures.js 를 실행하세요.`);
            failed++;
            continue;
        }

        let issues, ir;
        try {
            ir = await parsePdf(new Uint8Array(fs.readFileSync(abs)));
            issues = checkOne(ir, exp);
        } catch (err) {
            issues = [`예외: ${err.message || err}`];
        }

        const ok = issues.length === 0;
        console.log(`${ok ? 'PASS' : 'FAIL'}  ${path.basename(exp.file)}`);
        if (ir) {
            const c = ir.audit.counts;
            console.log(`      본문 ${ir.audit.bodyFontSizePt}pt · 제목크기 [${ir.audit.headingSizesPt.join(',')}]`
                + ` · ${ir.audit.pages}쪽 · 제목 ${c.headings} · 문단 ${c.paragraphs} · 표 ${c.tables} · 목록 ${c.listItems}`);
        }
        for (const i of issues) console.log(`      ✗ ${i}`);
        if (!ok) failed++;
    }

    // ⑥ 글자 레이어가 없는 PDF는 조용히 빈 문서를 만들면 안 된다.
    //    빈 HWPX를 성공으로 돌려주면 사용자는 변환된 줄 안다.
    const blankPath = path.join(ROOT, 'tests/fixtures/blank-scan.pdf');
    if (fs.existsSync(blankPath)) {
        let rejected = false, msg = '';
        try {
            await parsePdf(new Uint8Array(fs.readFileSync(blankPath)));
        } catch (err) {
            rejected = true;
            msg = err.message || String(err);
        }
        const explains = /스캔|글자를 찾지 못했습니다/.test(msg);
        console.log(`${rejected && explains ? 'PASS' : 'FAIL'}  blank-scan.pdf (글자 레이어 없음)`);
        console.log(`      ${rejected ? msg : '거절하지 않고 통과시킴 — 빈 문서가 성공으로 나간다'}`);
        if (!rejected || !explains) failed++;
    } else {
        console.log('SKIP  blank-scan.pdf (픽스처 없음)');
    }

    const total = EXPECTATIONS.length + (fs.existsSync(blankPath) ? 1 : 0);
    console.log(`\n${total - failed}/${total} 통과`);
    if (failed) {
        console.error('\nPDF 추론 게이트 실패 — 구조 추론 규칙이 바뀌었거나 무너졌다.');
        process.exit(1);
    }
    console.log('PDF 구조 추론이 기대값과 일치한다.');
    console.log('※ 추론은 문서마다 다르게 맞는다. 이 게이트는 회귀 감지용이지 품질 보증이 아니다.');
})().catch(err => {
    console.error('게이트 실행 실패:', err.message || err);
    process.exit(1);
});
