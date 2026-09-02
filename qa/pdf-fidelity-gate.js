/* ===================================================================
 * [qa/pdf-fidelity-gate.js] PDF 변환 충실도 게이트
 * ===================================================================
 * 실행: node qa/pdf-fidelity-gate.js
 *
 * "PDF 변환율 100%"를 주장하려면 **무엇을 세는지** 먼저 정해야 한다.
 * 하나의 숫자로 뭉치면 글자를 잃고도 구조 점수로 가릴 수 있다. 그래서 셋으로
 * 나누고, 셋 다 따로 100%여야 한다.
 *
 *  ① 문자 보존율 — PDF 글자 레이어의 모든 글자가 결과에 남아 있는가.
 *     정답이 따로 필요 없다(PDF 자신이 정답). **글자 유실은 추론 실패가
 *     아니라 버그다.** 그래서 점수가 아니라 하한선으로 다룬다.
 *
 *  ② 읽기 순서 — 글자가 원래 읽는 순서대로 있는가. 2단 편집이나 병합 셀에서
 *     글자는 다 남아 있는데 순서만 뒤섞이는 일이 실제로 일어난다. ①만 보면
 *     그게 100%로 보인다.
 *
 *  ③ 구조 정확도 — 제목·표·목록·그림·서식이 정답과 맞는가. 정답을 아는
 *     픽스처(tests/make-pdf-hard-fixtures.js)에서만 잴 수 있다.
 *
 * 픽스처는 **일부러 어려운 것만** 모았다. 쉬운 문서에서 나온 100%는
 * PDF 변환이 100%라는 뜻이 아니다.
 * ===================================================================*/

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { irText, pdfRawText, charCoverage, normalizeForCompare } = require('./lib/pdf-fidelity.js');

const ROOT = path.resolve(__dirname, '..');
const FIX = path.join(ROOT, 'tests', 'fixtures');

/* ── 정답 ────────────────────────────────────────────────────────────
 * `checks`의 각 항목은 IR을 받아 참/거짓을 돌려주는 단언이다.
 * 점수 = 통과한 단언 / 전체 단언. 그래서 "몇 %"가 무엇을 뜻하는지 셀 수 있다.
 * ------------------------------------------------------------------*/

/** 블록을 훑어 타입별로 모은다. */
function byType(ir, type) {
    return (ir.blocks || []).filter(b => b.type === type);
}

/** 모든 run을 모은다(문단·목록·표 셀 안까지). */
function allRuns(ir) {
    const out = [];
    const walk = blocks => {
        for (const b of blocks || []) {
            if (!b) continue;
            for (const r of b.runs || []) out.push(r);
            for (const it of b.items || []) for (const r of (it && it.runs) || []) out.push(r);
            for (const row of [b.header, ...(b.rows || [])]) {
                for (const c of row || []) {
                    if (c && typeof c === 'object') {
                        for (const r of c.runs || []) out.push(r);
                        walk(c.blocks);
                    }
                }
            }
            walk(b.blocks);
        }
    };
    walk(ir.blocks);
    return out;
}

/** 본문 전체에서 a가 b보다 먼저 나오는가 — 읽기 순서 검사용. */
function orderedBefore(ir, a, b) {
    const t = normalizeForCompare(irText(ir));
    const ia = t.indexOf(normalizeForCompare(a));
    const ib = t.indexOf(normalizeForCompare(b));
    return ia !== -1 && ib !== -1 && ia < ib;
}

/** 표 하나의 행·열 수(머리행 포함). */
function tableShape(tb) {
    if (!tb) return null;
    const rows = [];
    if (tb.header) rows.push(tb.header);
    for (const r of tb.rows || []) rows.push(r);
    return { rows: rows.length, cols: Math.max(0, ...rows.map(r => (r || []).length)), grid: rows };
}

/** 공백을 하나로 눌러 비교하기 쉽게. */
function flat(ir) {
    return irText(ir).replace(/\s+/g, ' ');
}

const EXPECTATIONS = [
    {
        file: 'pdf-styled.pdf',
        why: '굵게·기울임·색은 PDF 글꼴 이름과 채움색에서 복원할 수 있다',
        checks: {
            '굵은 run': ir => allRuns(ir).some(r => r.bold && r.text.includes('굵은')),
            '기울인 run': ir => allRuns(ir).some(r => r.italic && r.text.includes('기울인')),
            '색 run': ir => allRuns(ir).some(r => r.color && r.text.includes('빨간')),
            '굵고 기울임 동시': ir => allRuns(ir).some(r => r.bold && r.italic),
            // 서식 없는 문단은 runs를 아예 달지 않는 것이 정상이다(불필요한 charPr을
            // 늘리지 않는다). 그래서 "run이 있고 평범한지"가 아니라
            // **"굵거나 기울지 않은지"**를 본다.
            '보통 문단은 서식 없음': ir => {
                const b = (ir.blocks || []).find(x => typeof x.text === 'string' && x.text.includes('보통'));
                return !!b && !(b.runs || []).some(r => r.bold || r.italic);
            },
        },
    },
    {
        file: 'pdf-picture.pdf',
        why: '본문에 낀 그림이 통째로 사라지면 사용자는 그림이 없던 문서로 안다',
        checks: {
            // every()는 빈 배열에서 참이다. 그림이 하나도 없을 때 "데이터 있음"이
            // 통과해 버리면 0개인 상태가 3/4로 보인다. length부터 확인한다.
            '그림 블록 1개': ir => byType(ir, 'image').length === 1,
            '그림 데이터 있음': ir => byType(ir, 'image').length > 0
                && byType(ir, 'image').every(b => b.data && b.data.length > 0),
            '그림 크기 있음': ir => byType(ir, 'image').length > 0
                && byType(ir, 'image').every(b => b.widthHwp > 0 && b.heightHwp > 0),
            '그림 앞뒤 문단 유지': ir => orderedBefore(ir, '아래에 그림이', '그림 다음 문단'),
        },
    },
    {
        file: 'pdf-merged.pdf',
        why: '병합 셀이 있으면 좌표만으로는 격자가 어긋난다',
        checks: {
            '표 1개': ir => byType(ir, 'table').length === 1,
            '4행': ir => tableShape(byType(ir, 'table')[0])?.rows === 4,
            '3열': ir => tableShape(byType(ir, 'table')[0])?.cols === 3,
            '읽기 순서 유지': ir => orderedBefore(ir, '사업비', '130'),
            '총괄 머리 유지': ir => orderedBefore(ir, '2026년 예산 총괄', '구분'),
        },
    },
    {
        file: 'pdf-ruled.pdf',
        why: '열 간격이 좁으면 공백만으로는 열을 못 나눈다 — 괘선을 봐야 한다',
        checks: {
            '표 1개': ir => byType(ir, 'table').length === 1,
            '3행': ir => tableShape(byType(ir, 'table')[0])?.rows === 3,
            '3열': ir => tableShape(byType(ir, 'table')[0])?.cols === 3,
        },
    },
    {
        file: 'pdf-twocol.pdf',
        why: '2단 편집에서 좌우가 섞이면 글자는 다 남아도 문서는 못 읽는다',
        checks: {
            '왼쪽 단이 먼저': ir => orderedBefore(ir, '왼쪽 단의 첫 문장', '오른쪽 단으로 넘어간'),
            '왼쪽 단 순서': ir => orderedBefore(ir, '왼쪽 단의 첫 문장', '왼쪽 단의 두 번째'),
            '오른쪽 단 순서': ir => orderedBefore(ir, '오른쪽 단으로 넘어간', '오른쪽 단의 마지막'),
            '왼쪽 두번째 → 오른쪽': ir => orderedBefore(ir, '왼쪽 단의 두 번째', '오른쪽 단으로 넘어간'),
            // 오른쪽 단은 쪽 왼쪽에서 멀 뿐이지 들여쓴 것이 아니다.
            // 단 기준으로 재지 않으면 오른쪽 단 전체가 목록이 된다.
            '오른쪽 단이 목록이 아님': ir => !(ir.blocks || []).some(b =>
                b.type === 'list' && (b.items || []).some(i => /오른쪽 단/.test(i.text || ''))),
        },
    },
    {
        file: 'pdf-hyphen.pdf',
        why: '줄 끝 하이픈과 합자를 그대로 두면 검색도 편집도 안 된다',
        checks: {
            '합자 정규화': ir => !/[ﬀ-ﬆ]/.test(irText(ir)),
            'office 온전': ir => /office/i.test(flat(ir)),
            'international 복원': ir => /international/i.test(flat(ir)),
            'documentation 복원': ir => /documentation/i.test(flat(ir)),
        },
    },
    {
        file: 'pdf-runhead.pdf',
        why: '쪽마다 반복되는 머리말·쪽번호가 본문에 섞이면 문서가 읽히지 않는다',
        checks: {
            '반복 머리말 제거': ir => !/내부\s*검토용/.test(flat(ir)),
            '쪽번호 제거': ir => !/-\s*1\s*-/.test(flat(ir)),
            '본문 보존': ir => /1쪽\s*본문입니다/.test(flat(ir)) && /2쪽\s*본문입니다/.test(flat(ir)),
            '제목 보존': ir => /반복\s*머리말\s*문서/.test(`${ir.title} ${flat(ir)}`),
        },
    },
    {
        file: 'pdf-korean-gov.pdf',
        why: '공문서 항목 기호 계층은 이 도구의 핵심 용도다',
        checks: {
            '표 1개': ir => byType(ir, 'table').length === 1,
            '3행 3열': ir => {
                const s = tableShape(byType(ir, 'table')[0]);
                return s?.rows === 3 && s?.cols === 3;
            },
            '항목 순서': ir => orderedBefore(ir, '1. 추진 배경', '2. 추진 방향'),
            '하위 항목 보존': ir => /기관별\s*서식이/.test(flat(ir)) && /가\.\s*단계적\s*전환/.test(flat(ir)),
        },
    },
];

/**
 * 원문에서 "일부러 뺀 쪽 장식"을 지운 문자열.
 * 순서 비교를 할 때 머리말이 원문에 남아 있으면 본문 순서가 어긋난 것처럼 보인다.
 */
function stripDeclared(rawText, ir) {
    let s = normalizeForCompare(rawText);
    for (const piece of ir.audit?.removedPageFurniture || []) {
        const p = normalizeForCompare(piece);
        if (!p) continue;
        const at = s.indexOf(p);
        if (at !== -1) s = s.slice(0, at) + s.slice(at + p.length);
    }
    return s;
}

/** 순서를 무시한 다중집합 비교 — 글자가 사라졌는지만 본다. */
function multisetLoss(rawText, outText) {
    const count = s => {
        const m = new Map();
        for (const c of normalizeForCompare(s)) m.set(c, (m.get(c) || 0) + 1);
        return m;
    };
    const src = count(rawText), dst = count(outText);
    let missing = 0;
    const examples = [];
    for (const [c, n] of src) {
        const d = n - (dst.get(c) || 0);
        if (d > 0) {
            missing += d;
            if (examples.length < 8) examples.push(`${c}x${d}`);
        }
    }
    const total = normalizeForCompare(rawText).length;
    return { rate: total ? (total - missing) / total : 1, missing, examples };
}

(async () => {
    console.log('PDF 변환 충실도 게이트 — 어려운 케이스 8종\n');
    const { parsePdf } = await import('../js/pdf-parser.js');

    let charFail = 0, orderFail = 0, structPass = 0, structTotal = 0;
    const rows = [];

    for (const exp of EXPECTATIONS) {
        const abs = path.join(FIX, exp.file);
        if (!fs.existsSync(abs)) {
            console.error(`FAIL  ${exp.file} — 픽스처 없음. node tests/make-pdf-hard-fixtures.js`);
            charFail++;
            continue;
        }
        let ir, raw;
        try {
            const buf = fs.readFileSync(abs);
            raw = await pdfRawText(new Uint8Array(buf));
            ir = await parsePdf(new Uint8Array(buf));
        } catch (err) {
            console.error(`FAIL  ${exp.file} — 변환 실패: ${err.message}`);
            charFail++;
            continue;
        }

        const out = irText(ir);

        // 쪽 장식(머리말·꼬리말·쪽번호)은 **일부러** 뺀다. 본문이 아니기 때문이다.
        // 그래서 문자 보존의 기준은 "하나도 안 없어졌는가"가 아니라
        // **"조용히 없어진 것이 없는가"**다. 뺀 것은 audit에 적혀 있어야 하고,
        // 적혀 있지 않은데 사라졌다면 그건 버그다.
        const declared = (ir.audit?.removedPageFurniture || []).join('');
        const chars = multisetLoss(raw, out + declared);

        // 읽기 순서도 같은 기준으로 본다 — 뺀 줄을 원문에서 지우고 비교한다.
        const order = charCoverage(stripDeclared(raw, ir), out);

        const results = [];
        for (const [name, fn] of Object.entries(exp.checks)) {
            let ok = false;
            try { ok = !!fn(ir); } catch { ok = false; }
            results.push([name, ok]);
            structTotal++;
            if (ok) structPass++;
        }

        if (chars.rate < 1) charFail++;
        if (order.rate < 1) orderFail++;

        rows.push({
            file: exp.file,
            char: chars.rate,
            order: order.rate,
            struct: `${results.filter(([, ok]) => ok).length}/${results.length}`,
            failed: results.filter(([, ok]) => !ok).map(([n]) => n),
            missEx: chars.examples,
        });
    }

    console.log('파일                     문자    순서    구조   못 맞춘 항목');
    console.log('-'.repeat(96));
    for (const r of rows) {
        const c = `${(r.char * 100).toFixed(1)}%`.padStart(6);
        const o = `${(r.order * 100).toFixed(1)}%`.padStart(6);
        console.log(`${r.file.padEnd(22)} ${c}  ${o}  ${r.struct.padStart(5)}  ${r.failed.join(', ') || '-'}`);
        if (r.missEx.length) console.log(`${' '.repeat(22)} 유실 글자: ${r.missEx.join(' ')}`);
    }

    console.log('-'.repeat(96));
    console.log(`문자 보존 실패 ${charFail}건 · 읽기 순서 실패 ${orderFail}건 · 구조 ${structPass}/${structTotal} (${((structTotal ? structPass / structTotal : 0) * 100).toFixed(1)}%)\n`);

    if (charFail > 0) {
        console.error('문자 보존은 하한선이다. 글자가 사라지는 것은 추론 실패가 아니라 버그다.');
        process.exit(1);
    }
    if (orderFail > 0 || structPass < structTotal) {
        console.error(`아직 100%가 아니다 — 순서 ${orderFail}건, 구조 ${structTotal - structPass}건 남음.`);
        process.exit(1);
    }
    console.log('문자·순서·구조 전부 100%.');
})().catch(err => {
    console.error('게이트 실행 실패:', err.message || err);
    process.exit(1);
});
