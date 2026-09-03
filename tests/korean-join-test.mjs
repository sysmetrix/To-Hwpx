/* ===================================================================
 * [tests/korean-join-test.mjs] 한글 줄바꿈 공백 규칙 표 검사
 * ===================================================================
 * 실행: node tests/korean-join-test.mjs
 *
 * PDF는 줄이 바뀌는 자리의 공백을 **버린다.** 그래서 이어 붙일 때 공백을
 * 넣을지 규칙으로 판단하는데, 규칙이 여러 겹이라 픽스처가 실패해도 **어느
 * 규칙이 깨졌는지** 알 수 없다. 그래서 규칙 자체를 표로 검사한다.
 *
 * 여기 사례는 전부 **실제 문서에서 관찰한 것**이다. 지어내지 않았다.
 * ===================================================================*/

import { punctuationJoinRule, koreanJoinNeedsSpace } from '../js/pdf-parser.js';

/** 실제 호출 순서를 그대로 재현한다 — 문장부호가 언어 판단보다 먼저다. */
const HANGUL_END = /[가-힣]$/;
const HANGUL_START = /^[가-힣]/;
function needsSpace(prev, next) {
    const punct = punctuationJoinRule(prev.trimEnd());
    if (punct !== null) return punct;
    if (HANGUL_END.test(prev) && HANGUL_START.test(next)) return koreanJoinNeedsSpace(prev, next);
    return /[.!?。」』\p{L}\p{N}]$/u.test(prev) && /^[A-Za-z0-9(]/.test(next);
}

const CASES = [
    // [앞 줄 끝, 다음 줄 시작, 공백 필요?, 왜]
    ['…산업의 생산성 향상과', '새로운 서비스', true,  '어절 경계 — 가장 흔한 경우(실측 약 90%)'],
    ['…과제를 해결하는', '데에도 활용되고', true,  '의존명사는 띄어 쓴다'],
    ['…발전에도 기여할', '수 있다', true,  '`수`는 홀로 쓰이는 의존명사'],
    ['…과도한 의존과 인간', '자율성의 약화가', true,  '두 글자 이상 + 조사 아님'],

    ['…대두되고 있다. 인류 차원', '에서는 기술', false, '`에서는`은 홀로 못 쓰는 조사'],
    ['…윤리원칙을 존', '중하고 실천', false, '`존`은 홀로 못 쓰는 한 글자'],
    ['…추진하기 위', '하여 수립', false, '같은 규칙 — `위하여`'],
    ['…개발하고 활용', '할지에 관한', false, '`할지에`는 하/되 계열 어미'],
    ['…지속적', '으로 살피고', false, '`으로`는 조사'],
    ['…편향을 방', '지하기 위해', false, '한 글자 + 어미'],
    ['…역할을 인식', '하고 이를', false, '`하고`는 어미'],
    ['…의도된 사용 조건', '에서 해당', false, '`에서`는 조사'],

    // 문장부호 — 한글 판단보다 먼저 봐야 한다.
    ['…정당한 보상,', '일자리의 변화', true,  '쉼표로 끝나면 어절 경계가 확실'],
    ['…실천해야 한다.', '나아가 국제', true,  '마침표도 마찬가지'],
    ['…‘사회의 공공선’,', '‘인류의 지속', true,  '따옴표+쉼표'],
    ['…이라는 것으로서,', '특정 분야에', true,  '쉼표 뒤 한글'],
    ['…‘공정성·', '포용성’, ‘책임성’', false, '가운뎃점은 이어지는 표기'],

    // 관형사는 뒤 낱말과 띄어 쓴다.
    ['…모을 때, 본', '윤리원칙이 사회', true,  '`본`은 관형사'],
    ['…적용되는 각', '기관은', true,  '`각`도 관형사'],

    // 낱말로 시작하는데 하/되로 시작하는 것들 — 붙이면 안 된다.
    ['…구성원이 함께', '하나의 개인이나', true,  '`하나의`는 어엿한 낱말'],
    ['…모두가', '함께 지켜나가야', true,  '`함께`는 낱말'],
    ['…우리', '한국 사회는', true,  '`한국`은 낱말'],
    ['…문제', '해결 역량을', true,  '`해결`은 낱말'],

    // 보조용언은 띄어 쓴다.
    ['…본문으로 흘러야', '한다.', true,  '-아야 뒤의 `한다`는 보조용언'],
    ['…성능이 유지되도록 해야', '한다', true,  '같은 규칙'],
];

let failed = 0;
for (const [prev, next, want, why] of CASES) {
    const got = needsSpace(prev, next);
    const ok = got === want;
    if (!ok) failed++;
    const joined = want ? `${prev.slice(-6)} ${next.slice(0, 8)}` : `${prev.slice(-6)}${next.slice(0, 8)}`;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${want ? '띄움' : '붙임'}  ${joined.padEnd(22)}  ${why}`);
}

console.log('');
if (failed) {
    console.error(`한글 줄바꿈 공백 규칙 ${failed}건 실패 / ${CASES.length}건`);
    process.exit(1);
}
console.log(`한글 줄바꿈 공백 규칙 ${CASES.length}건 전부 통과.`);
