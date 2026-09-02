/* ===================================================================
 * [qa/gov-doc-gate.js] 공문서 항목 들여쓰기 게이트
 * ===================================================================
 * 실행: node qa/gov-doc-gate.js
 *
 * 이 기능은 **규정에 근거한 변환**이다. 따라서 검사도 규정을 기준으로 한다.
 *
 *   「행정업무의 운영 및 혁신에 관한 규정」 시행규칙 / 행정업무 운영 편람
 *     항목 기호: 1. → 가. → 1) → 가) → (1) → (가) → ① → ㉮
 *     들여쓰기 : 첫째 항목은 왼쪽 기본선, 둘째부터 바로 위 항목에서 2타씩
 *     띄어쓰기 : 기호와 내용 사이 1타
 *     줄바꿈   : 둘째 줄부터 항목 내용 첫 글자에 맞춤(내어쓰기)
 *
 * 검사 항목
 *   ① 기호 8종을 모두 인식하는가
 *   ② 깊이가 "바로 위 항목보다 한 단계"로 매겨지는가
 *   ③ 같은 기호가 다시 나오면 그 단계로 돌아가는가
 *   ④ HWPX에서 기호 실제 위치 = 단계 × 2타 인가  ← 규정 그 자체
 *   ⑤ 내어쓰기가 기호 폭 + 1타인가(둘째 줄 정렬)
 *   ⑥ 여러 줄 문단을 줄 단위로 나누되, 기호 없는 줄은 앞 항목에 붙는가
 *   ⑦ 기호가 전혀 없는 문서를 건드리지 않는가  ← 오작동 방지
 *   ⑧ 붙임·끝. 표지를 인식하는가
 *
 * ⑦이 특히 중요하다. 일반 문서에도 "1."로 시작하는 줄은 흔하고,
 * 그것을 전부 공문서 항목으로 취급하면 원문보다 나빠진다.
 * ===================================================================*/

'use strict';

const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

/** 규정이 정한 한 단계 = 2타. 12pt 기준 2400 HWPUNIT. */
const PT = 12;
const STEP = PT * 100 * 2;

const failures = [];
function check(ok, label, detail = '') {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
    if (!ok) failures.push(label);
}

/** header.xml에서 공문서 paraPr의 (기호 위치, 내어쓰기)를 뽑는다. */
function govParaGeometry(headerXml) {
    const out = [];
    for (const m of headerXml.matchAll(/공문서 항목 (\d+)\|(\S+) [^>]*-->\s*\n\s*<hh:paraPr id="(\d+)"/g)) {
        const seg = headerXml.slice(headerXml.indexOf(`id="${m[3]}"`));
        const left = Number(/<hh:left value="(\d+)"/.exec(seg)[1]);
        const intent = Number(/<hh:intent value="(-?\d+)"/.exec(seg)[1]);
        out.push({
            level: Number(m[1]),
            marker: m[2],
            paraId: m[3],
            markerPos: left + intent,   // 첫 줄(기호)이 놓이는 위치
            hanging: -intent,           // 둘째 줄이 기호보다 오른쪽으로 밀리는 폭
        });
    }
    return out;
}

(async () => {
    const { createRequire } = require('node:module');
    const require2 = createRequire(path.join(ROOT, 'x.js'));
    const JSZip = require2('jszip');

    const { irToHwpx, ensureNodeRuntime } = await import('../js/core/index.js');
    const { applyGovDocStructure, matchMarker, GOV_MARKER_ORDER } = await import('../js/gov-doc.js');
    ensureNodeRuntime();

    console.log('공문서 항목 들여쓰기 게이트 — 「행정업무의 운영 및 혁신에 관한 규정」 기준\n');

    // ① 기호 8종 인식
    const samples = ['1. 가나', '가. 나다', '1) 라마', '가) 바사', '(1) 아자', '(가) 차카', '① 타파', '㉮ 하가'];
    const seen = samples.map(s => matchMarker(s)?.name || null);
    check(
        JSON.stringify(seen) === JSON.stringify(GOV_MARKER_ORDER),
        '① 기호 8종 인식', seen.map(x => x ?? '✗').join(' '),
    );

    // 기호 뒤에 공백이 없으면 항목이 아니다(1타 규칙). "1.5배" 같은 본문을 잡으면 안 된다.
    check(matchMarker('1.5배 증가') === null, '① 기호 뒤 공백 없으면 항목 아님', '"1.5배 증가"');
    check(matchMarker('2026. 9. 2. 시행') === null || matchMarker('2026. 9. 2. 시행').marker !== '2026.',
        '① 네 자리 연도는 항목 기호가 아님', '"2026. 9. 2. 시행"');

    // ②③ 깊이 매김 — 중간 기호를 건너뛴 문서와 되돌아오는 문서
    const nested = {
        title: 'T', doc_type: 'plain',
        blocks: [{
            type: 'para',
            text: [
                '1. 첫째', '가. 둘째', '1) 셋째', '가) 넷째',
                '나. 둘째로 복귀',          // 같은 기호 → 같은 단계로 돌아가야 한다
                '(1) 건너뛴 기호',          // 바로 위(나.)보다 한 단계만 안쪽
                '2. 첫째로 복귀',
            ].join('\n'),
        }],
    };
    applyGovDocStructure(nested);
    const depths = nested.blocks.filter(b => Number.isInteger(b.indentLevel)).map(b => b.indentLevel);
    check(JSON.stringify(depths) === JSON.stringify([0, 1, 2, 3, 1, 2, 0]),
        '②③ 깊이 매김(복귀·건너뜀 포함)', `[${depths.join(',')}] 기대 [0,1,2,3,1,2,0]`);

    // ④⑤ HWPX 기하 — 규정 그 자체
    const doc = {
        title: 'T', doc_type: 'plain',
        blocks: [{
            type: 'para',
            text: ['1. 가', '가. 나', '1) 다', '가) 라', '(1) 마', '(가) 바', '① 사', '㉮ 아'].join('\n'),
        }],
    };
    applyGovDocStructure(doc);
    const { bytes, validation } = await irToHwpx(doc, { fontSize: PT });
    check(validation.pass, '④ HWPX 구조 검증', validation.issues.join(' / ') || '통과');

    const zip = await JSZip.loadAsync(bytes);
    const header = await zip.file('Contents/header.xml').async('string');
    const geo = govParaGeometry(header);

    check(geo.length === 8, '④ 기호 8종 모두 paraPr 생성', `${geo.length}개`);

    const wrongPos = geo.filter(g => g.markerPos !== STEP * g.level);
    check(wrongPos.length === 0, '④ 기호 위치 = 단계 × 2타',
        wrongPos.length
            ? wrongPos.map(g => `${g.marker} ${g.markerPos}≠${STEP * g.level}`).join(', ')
            : geo.map(g => g.markerPos).join(', '));

    // ⑤ 내어쓰기 — 기호 폭 + 1타. 한글·원문자는 한 칸, 영숫자·괄호는 반 칸으로 센다.
    const expectHanging = (marker) => {
        let w = 0;
        for (const ch of marker) w += /[가-힣①-⑳㉮-㉿]/.test(ch) ? 1 : 0.5;
        return Math.round((w + 1) * PT * 100);
    };
    const wrongHang = geo.filter(g => g.hanging !== expectHanging(g.marker));
    check(wrongHang.length === 0, '⑤ 내어쓰기 = 기호 폭 + 1타',
        wrongHang.length
            ? wrongHang.map(g => `${g.marker} ${g.hanging}≠${expectHanging(g.marker)}`).join(', ')
            : '전부 일치');

    // ⑥ 여러 줄 문단 나누기 — 기호 없는 줄은 앞 항목에 붙어야 한다
    const wrapped = {
        title: 'T', doc_type: 'plain',
        blocks: [{
            type: 'para',
            text: ['1. 첫째 항목입니다.', '이어지는 설명 줄입니다.', '가. 둘째 항목입니다.'].join('\n'),
        }],
    };
    const wrappedReport = applyGovDocStructure(wrapped).report;
    const wrappedParas = wrapped.blocks.filter(b => b.type === 'para');
    check(wrappedParas.length === 2, '⑥ 기호 없는 줄은 앞 항목에 합쳐짐',
        `문단 ${wrappedParas.length}개 (기대 2)`);
    check(/이어지는 설명 줄입니다\./.test(wrappedParas[0]?.text || ''),
        '⑥ 이어지는 줄이 첫 항목 본문에 남음');
    check(wrappedReport.splitParagraphs === 1, '⑥ 분할한 문단 수 기록', String(wrappedReport.splitParagraphs));

    // ⑦ 오작동 방지 — 기호가 없는 문서는 손대지 않는다
    const plain = {
        title: 'T', doc_type: 'plain',
        blocks: [
            { type: 'para', text: '일반 문단입니다.\n두 번째 줄입니다.' },
            { type: 'para', text: '버전 1.5배 성능 향상' },
        ],
    };
    const before = JSON.stringify(plain.blocks);
    const plainReport = applyGovDocStructure(plain).report;
    check(plainReport.applied === 0, '⑦ 기호 없는 문서는 항목 0건', `${plainReport.applied}건`);
    check(JSON.stringify(plain.blocks) === before, '⑦ 블록을 전혀 바꾸지 않음');

    // ⑧ 붙임·끝.
    const marks = {
        title: 'T', doc_type: 'plain',
        blocks: [{ type: 'para', text: ['1. 본문', '붙임  1. 계획서 1부.', '끝.'].join('\n') }],
    };
    const markReport = applyGovDocStructure(marks).report;
    check(markReport.attachments === 1 && markReport.hasEndMark,
        '⑧ 붙임·끝. 표지 인식', `붙임 ${markReport.attachments} · 끝 ${markReport.hasEndMark}`);

    // ⑨ 공문 구성요소 인식 — 두문/본문/결문
    const full = {
        title: '행정안전부', doc_type: 'plain',
        blocks: [{
            type: 'para',
            text: [
                '행정안전부',
                '수신  수신자 참조',
                '경유',
                '제목  개방형 문서 형식 전환 추진 계획 알림',
                '1. 관련: 「행정업무의 운영 및 혁신에 관한 규정」 제7조',
                '가. 전환 대상: 온나라 문서시스템 첨부 문서',
                '붙임  1. 추진계획서 1부.',
                '끝.',
                '행정안전부장관',
                '시행  정보기반보호정책과-1234 (2026. 9. 2.)',
                '접수  기획조정실-5678 (2026. 9. 3.)',
                '공개 구분  공개',
            ].join('\n'),
        }],
    };
    const fullReport = applyGovDocStructure(full).report;
    const el = fullReport.elements;

    check(['recipient', 'via', 'subject', 'issued', 'received', 'disclosure', 'sender']
        .every(k => el[k] === 1),
        '⑨ 두문·본문·결문 구성요소 인식', JSON.stringify(el));

    // 제목은 문서를 대표하는 유일한 줄이다. 파서가 첫 줄(기관명)을 제목으로
    // 잡아 두는 경우가 많으므로 승격해야 한다.
    check(full.title === '개방형 문서 형식 전환 추진 계획 알림',
        '⑨ 제목을 문서 제목으로 승격', full.title);
    const subjectBlock = full.blocks.find(b => b.govRole === 'subject');
    check(subjectBlock && subjectBlock.type === 'heading' && !/^제\s*목/.test(subjectBlock.text),
        '⑨ 제목 문단은 제목 스타일 + 표지 제거', subjectBlock ? subjectBlock.text : '못 찾음');

    // 발신명의는 규정 서식에서 결문 가운데에 온다.
    const sender = full.blocks.find(b => b.govRole === 'sender');
    check(sender && sender.align === 'center', '⑨ 발신명의 가운데 정렬',
        sender ? `${sender.text} align=${sender.align}` : '못 찾음');

    // 두문·결문 줄이 앞 줄에 삼켜지지 않아야 한다. 항목 기호만 경계로 삼으면
    // 기관명·수신·경유·제목이 통째로 한 문단이 되어 제목을 찾지 못한다.
    const heads = full.blocks.filter(b => ['recipient', 'via', 'subject'].includes(b.govRole));
    check(heads.length === 3, '⑨ 두문 줄이 각각 분리됨', `${heads.length}개`);

    // 본문 안의 "제7조"를 조문/구성요소로 오인하지 않는다.
    const relatedLine = full.blocks.find(b => /관련:/.test(b.text || ''));
    check(relatedLine && relatedLine.indentLevel === 0 && !relatedLine.govRole,
        '⑨ 본문 안 조문 인용을 구성요소로 오인하지 않음',
        relatedLine ? `깊이=${relatedLine.indentLevel} 역할=${relatedLine.govRole || '없음'}` : '못 찾음');

    // ⑩ 구성요소 표지가 없는 문서는 역할을 붙이지 않는다
    const noElem = {
        title: 'T', doc_type: 'plain',
        blocks: [{ type: 'para', text: ['1. 첫째', '가. 둘째'].join('\n') }],
    };
    const noElemReport = applyGovDocStructure(noElem).report;
    check(Object.keys(noElemReport.elements).length === 0 && noElemReport.subject === null,
        '⑩ 표지 없는 문서에는 역할을 붙이지 않음', JSON.stringify(noElemReport.elements));

    // ⑪ 공문 골격 생성
    const { buildOfficialSkeleton } = await import('../js/gov-doc.js');
    const sk = buildOfficialSkeleton({
        agency: '행정안전부',
        recipient: '수신자 참조',
        subject: '개방형 문서 형식 전환 알림',
        body: ['1. 관련: 근거 문서', '가. 세부 사항'],
        attachments: ['계획서 1부.', '목록 1부.'],
        sender: '행정안전부장관',
    });
    const roles = sk.ir.blocks.map(b => b.govRole).filter(Boolean);
    check(['agency', 'recipient', 'via', 'subject', 'attachment', 'end', 'sender', 'issued', 'received', 'disclosure']
        .every(r => roles.includes(r)),
        '⑪ 골격에 두문·본문·결문 요소가 모두 있음', roles.join(' '));

    // 규정 순서: 두문 → 본문 → 결문
    const idx = (r) => roles.indexOf(r);
    check(idx('recipient') < idx('subject') && idx('subject') < idx('end') && idx('end') < idx('sender')
        && idx('sender') < idx('issued'),
        '⑪ 구성요소 순서가 규정대로', roles.join(' → '));

    // 본문 항목에는 규정 들여쓰기가 적용된다
    const skDepths = sk.ir.blocks.filter(b => Number.isInteger(b.indentLevel)).map(b => b.indentLevel);
    check(JSON.stringify(skDepths) === JSON.stringify([0, 1]), '⑪ 골격 본문에 규정 들여쓰기 적용',
        `[${skDepths.join(',')}]`);

    // 붙임 둘째 줄이 본문 항목으로 떨어져 나오지 않는다
    const attachItems = sk.ir.blocks.filter(b => b.govRole === 'attachment-item');
    check(attachItems.length === 1 && attachItems.every(b => !Number.isInteger(b.indentLevel)),
        '⑪ 붙임 둘째 줄이 본문 항목으로 재분류되지 않음',
        `${attachItems.length}개, 깊이 없음=${attachItems.every(b => !Number.isInteger(b.indentLevel))}`);

    // 공식 서식이 아니라는 사실을 반드시 말한다
    check(sk.notes.some(n => /복제가 아닙니다/.test(n)) && sk.notes.some(n => /공식 서식 파일/.test(n)),
        '⑪ 공식 별지 서식이 아님을 안내', `${sk.notes.length}개 안내`);

    // 값을 안 주면 자리 표시로 남는다(빈 문서가 나오면 안 된다)
    const empty = buildOfficialSkeleton({});
    check(empty.ir.blocks.some(b => /\(제목\)/.test(b.text || ''))
        && empty.ir.blocks.some(b => /\(수신자\)/.test(b.text || '')),
        '⑪ 값이 없으면 자리 표시를 남김');

    console.log('');
    if (failures.length) {
        console.error(`공문서 게이트 실패 ${failures.length}건: ${failures.join(', ')}`);
        process.exit(1);
    }
    console.log('규정이 정한 항목 체계와 들여쓰기를 그대로 따른다.');
    console.log('※ 구조만 본다. 실제 공문서로 한컴에서 눈으로 확인해야 한다.');
})().catch(err => {
    console.error('게이트 실행 실패:', err.message || err);
    process.exit(1);
});
