/* ===================================================================
 * [qa/diff-table-gate.js] 신구조문대비표 게이트
 * ===================================================================
 * 실행: node qa/diff-table-gate.js
 *
 * 대비표는 **틀리면 없느니만 못한** 산출물이다. 서로 관계없는 두 조문이
 * 한 행에 놓이면 읽는 사람은 그것을 "개정됐다"고 읽는다. 그래서 이 게이트는
 * "표가 만들어지는가"가 아니라 **"올바르게 짝지어지는가"**를 본다.
 *
 * 법제처 실무 기준 중 이 모듈이 지키기로 한 것
 *   - 현행을 기준으로 순서를 잡는다
 *   - 신설은 현행 칸에 <신설>, 삭제는 개정안 칸에 <삭제>
 *   - 바뀌지 않은 항목도 문맥으로 남긴다
 *
 * 검사 항목
 *   ① 한 줄만 고치면 그 줄만 "개정"이다 (연쇄 오염 없음)
 *   ② 조문 번호가 같으면 같은 조문의 개정으로 짝짓는다
 *   ③ 관계없는 삭제·신설을 억지로 짝짓지 않는다  ← 핵심
 *   ④ 신설·삭제 표기가 규칙대로다
 *   ⑤ 중간 삽입이 뒤쪽을 전부 "바뀜"으로 밀지 않는다
 *   ⑥ changedOnly가 유지 항목을 뺀다
 *   ⑦ HWPX 표 구조가 유효하고 바뀐 쪽만 강조된다
 *   ⑧ 빈 입력·같은 문서를 안전하게 다룬다
 * ===================================================================*/

'use strict';

const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

const failures = [];
function check(ok, label, detail = '') {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
    if (!ok) failures.push(label);
}

const cellText = (c) => (typeof c === 'string' ? c : (c?.text ?? ''));
const isBold = (c) => Array.isArray(c?.runs) && c.runs.some(r => r.bold);

/** 표를 "현행 → 개정안" 문자열 쌍 배열로 편다. */
function pairs(ir) {
    return (ir.blocks[0].rows || []).map(r => [cellText(r[0]), cellText(r[1])]);
}

(async () => {
    const { buildComparisonTable, COMPARISON_MARKS } = await import('../js/diff-table.js');
    const { irToHwpx, ensureNodeRuntime } = await import('../js/core/index.js');
    ensureNodeRuntime();

    console.log('신구조문대비표 게이트\n');

    // ① 한 줄만 수정 — 연쇄 오염 없음
    const base = ['가. 신청서는 방문 접수한다.', '나. 처리 기한은 7일이다.', '다. 결과는 우편으로 통보한다.'];
    const oneEdit = [...base];
    oneEdit[1] = '나. 처리 기한은 5일이다.';
    const r1 = buildComparisonTable(base.join('\n'), oneEdit.join('\n')).report;
    check(r1.same === 2 && r1.changed === 1 && r1.added === 0 && r1.removed === 0,
        '① 한 줄 수정은 그 줄만 개정', JSON.stringify(r1).slice(0, 90));

    // ② 조문 번호가 같으면 같은 조문 — 본문이 크게 바뀌어도
    const artOld = '제5조(보존기간) 문서는 3년간 보존한다.';
    const artNew = '제5조(보존기간) 전자문서를 포함한 모든 문서는 영구 보존을 원칙으로 하되 종류에 따라 달리 정할 수 있다.';
    const r2 = buildComparisonTable(artOld, artNew);
    const p2 = pairs(r2.ir);
    check(r2.report.changed === 1 && p2.length === 1 && p2[0][0] === artOld && p2[0][1] === artNew,
        '② 같은 조문 번호는 개정으로 짝지음', `changed=${r2.report.changed}`);

    // ③ 관계없는 삭제·신설을 억지로 짝짓지 않는다 (핵심)
    //    실제로 "제4조(문서의 보존)"과 "제2조의2(개방형 문서)"가 한 행에 놓였던 결함이다.
    const relOld = [
        '제1조(목적) 이 규정은 문서 관리를 목적으로 한다.',
        '제2조(정의) 용어의 뜻은 다음과 같다.',
        '제3조(적용) 이 규정은 본사에 적용한다.',
        '제4조(보존) 문서는 3년간 보존한다.',
    ].join('\n');
    const relNew = [
        '제1조(목적) 이 규정은 문서 관리를 목적으로 한다.',
        '제2조(정의) 용어의 뜻은 다음과 같다.',
        '제2조의2(개방형) 전자문서는 개방형 형식으로 작성한다.',
        '제3조(적용) 이 규정은 본사와 지사에 적용한다.',
    ].join('\n');
    const r3 = buildComparisonTable(relOld, relNew);
    const p3 = pairs(r3.ir);

    const badPair = p3.find(([o, n]) =>
        /제4조/.test(o) && /제2조의2/.test(n));
    check(!badPair, '③ 관계없는 조문을 한 행에 놓지 않음',
        badPair ? `잘못된 짝: ${badPair[0].slice(0, 24)} ↔ ${badPair[1].slice(0, 24)}` : '없음');

    const art3 = p3.find(([o]) => /제3조/.test(o));
    check(art3 && /본사와 지사/.test(art3[1]), '③ 제3조는 개정으로 올바르게 짝지음',
        art3 ? art3[1].slice(0, 34) : '못 찾음');

    // ④ 신설·삭제 표기
    const deleted = p3.find(([o]) => /제4조/.test(o));
    check(deleted && deleted[1] === COMPARISON_MARKS.removed, '④ 삭제 표기',
        deleted ? deleted[1] : '못 찾음');
    const added = p3.find(([, n]) => /제2조의2/.test(n));
    check(added && added[0] === COMPARISON_MARKS.added, '④ 신설 표기',
        added ? added[0] : '못 찾음');
    check(r3.report.changed === 1 && r3.report.added === 1 && r3.report.removed === 1 && r3.report.same === 2,
        '④ 집계', JSON.stringify(r3.report).slice(0, 100));

    // ⑤ 중간 삽입이 뒤쪽을 밀지 않는다
    const seqOld = ['가. 하나', '나. 둘', '다. 셋', '라. 넷', '마. 다섯'];
    const seqNew = ['가. 하나', '나. 둘', '나의2. 새 항목', '다. 셋', '라. 넷', '마. 다섯'];
    const r5 = buildComparisonTable(seqOld.join('\n'), seqNew.join('\n')).report;
    check(r5.same === 5 && r5.added === 1 && r5.changed === 0 && r5.removed === 0,
        '⑤ 중간 삽입이 뒤쪽을 오염시키지 않음', JSON.stringify(r5).slice(0, 90));

    // ⑥ changedOnly
    const onlyChanged = buildComparisonTable(base.join('\n'), oneEdit.join('\n'), { includeUnchanged: false });
    check(pairs(onlyChanged.ir).length === 1, '⑥ changedOnly가 유지 항목 제외',
        `${pairs(onlyChanged.ir).length}행`);

    // ⑦ HWPX 표 구조 + 강조
    const { bytes, validation } = await irToHwpx(r3.ir);
    check(validation.pass, '⑦ HWPX 구조 검증', validation.issues.join(' / ') || '통과');
    const m = validation.metrics || {};
    // 머리행 1 + 본문 5행 = 6행, 2열 → 12셀
    check(m.tables === 1 && m.rows === p3.length + 1 && m.cells === (p3.length + 1) * 2,
        '⑦ 표 행·셀 수', `표 ${m.tables} 행 ${m.rows} 셀 ${m.cells}`);
    check(bytes.length > 1000, '⑦ 산출물 크기', `${bytes.length}B`);

    // 바뀐 쪽만 굵게 — 양쪽 다 굵으면 무엇이 바뀐 건지 안 보인다
    const changedRow = (r3.ir.blocks[0].rows || []).find(r => /본사와 지사/.test(cellText(r[1])));
    check(changedRow && isBold(changedRow[1]) && !isBold(changedRow[0]),
        '⑦ 개정 쪽만 강조', changedRow ? `현행 굵게=${isBold(changedRow[0])} 개정 굵게=${isBold(changedRow[1])}` : '못 찾음');

    // ⑧ 경계 입력
    const same = buildComparisonTable(base.join('\n'), base.join('\n')).report;
    check(same.changed === 0 && same.added === 0 && same.removed === 0 && same.same === 3,
        '⑧ 같은 문서는 변경 0', JSON.stringify(same).slice(0, 70));

    const emptyNew = buildComparisonTable(base.join('\n'), '').report;
    check(emptyNew.removed === 3 && emptyNew.added === 0, '⑧ 개정안이 비면 전부 삭제',
        JSON.stringify(emptyNew).slice(0, 70));

    const emptyOld = buildComparisonTable('', base.join('\n')).report;
    check(emptyOld.added === 3 && emptyOld.removed === 0, '⑧ 현행이 비면 전부 신설',
        JSON.stringify(emptyOld).slice(0, 70));

    const bothEmpty = buildComparisonTable('', '');
    check(pairs(bothEmpty.ir).length === 1 && /내용 없음/.test(pairs(bothEmpty.ir)[0][0]),
        '⑧ 둘 다 비면 빈 표 대신 안내 행');

    console.log('');
    if (failures.length) {
        console.error(`신구조문대비표 게이트 실패 ${failures.length}건: ${failures.join(', ')}`);
        process.exit(1);
    }
    console.log('현행 기준 정렬과 신설·삭제 표기가 규칙대로다.');
    console.log('※ 문단 단위 비교다. 조·항·호 단위 대비는 하지 않는다.');
})().catch(err => {
    console.error('게이트 실행 실패:', err.message || err);
    process.exit(1);
});
