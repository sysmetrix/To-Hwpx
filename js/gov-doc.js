/* ===================================================================
 * [gov-doc.js] 공문서 항목 구조 인식
 * ===================================================================
 * 한국 공문서는 항목 기호와 들여쓰기가 **규정으로 정해져 있다.**
 * 「행정업무의 운영 및 혁신에 관한 규정」시행규칙과 행정안전부
 * 『행정업무 운영 편람』이 정하는 바는 다음과 같다.
 *
 *   항목 기호 순서
 *     1.  →  가.  →  1)  →  가)  →  (1)  →  (가)  →  ①  →  ㉮
 *
 *   들여쓰기
 *     첫째 항목 기호는 왼쪽 기본선에서 시작하고,
 *     둘째 항목부터는 바로 위 항목 위치에서 오른쪽으로 **2타씩** 옮긴다.
 *
 *   띄어쓰기
 *     항목 기호와 그 항목의 내용 사이는 **1타** 띄운다.
 *
 *   줄 바꿈
 *     항목이 두 줄 이상이면 둘째 줄부터 **항목 내용의 첫 글자에 맞춘다**(원칙).
 *
 * 이 모듈은 평문 문단에서 그 구조를 찾아 IR에 깊이를 표시한다. 서식을
 * 만들어내지 않는다 — **규정이 정한 것만** 적용하고, 규정 밖의 추측은 하지 않는다.
 *
 * ⚠ 이 변환은 사용자가 켜는 선택 기능이다. 일반 문서에도 "1."로 시작하는
 *   줄은 흔하고, 그것을 전부 공문서 항목으로 취급하면 원문보다 나빠진다.
 * ===================================================================*/

'use strict';

/**
 * 항목 기호 정의 — 규정이 정한 순서 그대로다. 순서를 바꾸면 깊이가 틀어진다.
 * `re`는 줄 맨 앞에서만 맞아야 하고, 기호 뒤에 공백이 와야 한다(1타 규칙).
 */
const MARKERS = Object.freeze([
    { level: 0, name: '1.',   re: /^(\d{1,2}\.)\s+(?=\S)/ },
    { level: 1, name: '가.',  re: /^([가-힣]\.)\s+(?=\S)/ },
    { level: 2, name: '1)',   re: /^(\d{1,2}\))\s+(?=\S)/ },
    { level: 3, name: '가)',  re: /^([가-힣]\))\s+(?=\S)/ },
    { level: 4, name: '(1)',  re: /^(\(\d{1,2}\))\s+(?=\S)/ },
    { level: 5, name: '(가)', re: /^(\([가-힣]\))\s+(?=\S)/ },
    { level: 6, name: '①',    re: /^([①-⑳])\s*(?=\S)/ },
    { level: 7, name: '㉮',    re: /^([㉮-㉿])\s*(?=\S)/ },
]);

/** 공문서 특유의 구역 표지. 본문 흐름과 다르게 다뤄야 한다. */
const SECTION_MARKS = Object.freeze({
    // "붙임  1. 계획서 1부." — 붙임은 본문이 끝난 뒤의 별도 구역이다.
    attachment: /^(붙\s*임|첨\s*부)\s*[\d.]*\s*/,
    // "끝." 표시 — 본문의 마지막임을 뜻한다.
    end: /^끝\.\s*$/,
});

/**
 * 한 줄이 어떤 항목 기호로 시작하는지 찾는다.
 * @returns {{level:number, marker:string, rest:string, name:string}|null}
 */
export function matchMarker(text) {
    const s = String(text || '');
    for (const m of MARKERS) {
        const hit = m.re.exec(s);
        if (hit) {
            return {
                level: m.level,
                name: m.name,
                marker: hit[1],
                rest: s.slice(hit[0].length),
            };
        }
    }
    return null;
}

/**
 * 앞선 항목들의 깊이를 보고 실제 들여쓰기 단계를 정한다.
 *
 * 규정의 기호 순서는 "1.이 나오면 무조건 0단계"를 뜻하지 않는다. 규정이
 * 정하는 것은 **상대적 관계**다 — "둘째 항목부터는 **바로 위 항목 위치에서**
 * 오른쪽으로 2타씩 옮겨 시작한다." 기준은 고정표가 아니라 바로 위 항목이다.
 *
 * 그래서 "기호 종류 → 실제 단계" 대응을 문서를 읽어가며 만든다.
 *   - 1.을 안 쓰고 가.부터 시작하는 문서도 0단계에서 시작한다.
 *   - 같은 기호가 다시 나오면 그 단계로 돌아가고 아래 단계는 버린다.
 *   - 중간 기호를 건너뛴 문서(가. 다음에 바로 (1))도 (1)이 가.보다
 *     한 단계만 안쪽에 놓인다. 고정표를 쓰면 (1)이 5단계로 튀어
 *     읽는 사람에게 부모가 없는 항목처럼 보인다.
 */
function createDepthTracker() {
    /** @type {string[]} 각 단계에 배정된 기호 종류(name) */
    const stack = [];

    return function depthOf(markerName) {
        const known = stack.indexOf(markerName);
        if (known >= 0) {
            // 이미 본 기호 — 그 단계로 돌아가고 아래 단계는 버린다.
            stack.length = known + 1;
            return known;
        }
        stack.push(markerName);
        return stack.length - 1;
    };
}

/**
 * IR 블록에서 공문서 항목 구조를 찾아 `indentLevel`을 붙인다.
 *
 * 원본 텍스트는 **바꾸지 않는다.** 항목 기호는 문서의 일부이므로 그대로 두고
 * 들여쓰기만 더한다. 기호를 떼어내 다시 만들면 원문과 달라진다.
 *
 * @param {object} ir
 * @returns {{ir:object, report:object}}
 */
export function applyGovDocStructure(ir) {
    const report = {
        applied: 0,
        byMarker: {},
        maxDepth: 0,
        attachments: 0,
        hasEndMark: false,
        splitParagraphs: 0,
    };

    if (!ir || !Array.isArray(ir.blocks)) return { ir, report };

    const depthOf = createDepthTracker();
    const state = { inAttachment: false };
    const out = [];

    for (const block of ir.blocks) {
        if (!block || block.type !== 'para') { out.push(block); continue; }

        const text = typeof block.text === 'string'
            ? block.text
            : (Array.isArray(block.runs) ? block.runs.map(r => r.text || '').join('') : '');

        if (!text.trim()) { out.push(block); continue; }

        // 공문서 항목은 **줄 단위**다. TXT·PDF·HWP 파서는 여러 줄을 한 문단으로
        // 묶어 넘기는 경우가 많아, 문단 하나만 보면 첫 줄의 기호만 잡힌다.
        // 줄로 나눠 각 줄을 항목 후보로 본다.
        const lines = text.split(/\r?\n/);
        if (lines.length === 1) {
            out.push(classifyLine(block, lines[0], depthOf, state, report));
            continue;
        }

        // 여러 줄 — 기호가 하나라도 있어야 나눈다. 없으면 원래 문단을 유지한다
        // (일반 문단을 줄 단위로 쪼개면 원문보다 나빠진다).
        if (!lines.some(l => l.trim() && (matchMarker(l.trim()) || isSectionMark(l.trim())))) {
            out.push(block);
            continue;
        }

        report.splitParagraphs++;
        // 기호 없는 줄은 **앞 항목의 이어지는 줄**이므로 합쳐 둔다.
        // 따로 떼면 항목 본문이 조각나고 들여쓰기도 어긋난다.
        const groups = [];
        for (const raw of lines) {
            const line = raw.trim();
            if (!line) continue;
            if (matchMarker(line) || isSectionMark(line) || !groups.length) {
                groups.push(line);
            } else {
                groups[groups.length - 1] += ' ' + line;
            }
        }

        for (const g of groups) {
            out.push(classifyLine({ type: 'para', text: g }, g, depthOf, state, report));
        }
    }

    ir.blocks = out;
    return { ir, report };
}

function isSectionMark(line) {
    return SECTION_MARKS.attachment.test(line) || SECTION_MARKS.end.test(line);
}

/** 한 줄(또는 한 문단)을 분류해 깊이·역할을 붙인다. */
function classifyLine(block, rawText, depthOf, state, report) {
    const trimmed = String(rawText || '').trim();
    if (!trimmed) return block;

    // 붙임 구역 시작 — 여기부터는 본문 항목 깊이를 이어받지 않는다.
    if (SECTION_MARKS.attachment.test(trimmed)) {
        state.inAttachment = true;
        report.attachments++;
        block.govRole = 'attachment';
        return block;
    }

    if (SECTION_MARKS.end.test(trimmed)) {
        report.hasEndMark = true;
        block.govRole = 'end';
        return block;
    }

    const hit = matchMarker(trimmed);
    if (!hit) return block;

    const depth = state.inAttachment ? Math.min(1, depthOf(hit.name)) : depthOf(hit.name);
    block.indentLevel = depth;
    block.govMarker = hit.name;

    report.applied++;
    report.byMarker[hit.name] = (report.byMarker[hit.name] || 0) + 1;
    report.maxDepth = Math.max(report.maxDepth, depth);
    return block;
}

/**
 * 들여쓰기 한 단계의 폭(HWPUNIT).
 *
 * 규정은 "2타"라고 정한다. 한 타는 글자 하나 폭이므로 글자 크기에 비례한다.
 * HWPUNIT는 1pt = 100이다.
 *
 * @param {number} fontSizePt 본문 글자 크기(pt)
 */
export function indentStepHwp(fontSizePt) {
    const pt = Number.isFinite(fontSizePt) && fontSizePt > 0 ? fontSizePt : 12;
    return Math.round(pt * 100 * 2);      // 2타
}

/**
 * 항목 기호가 차지하는 폭(HWPUNIT) — 내어쓰기(hanging indent) 값에 쓴다.
 *
 * 규정은 "둘째 줄부터 항목 내용의 첫 글자에 맞춘다"고 한다. 그러려면
 * 기호 폭 + 1타만큼 내어써야 한다. 기호 길이는 종류마다 다르다
 * ("1." 2자, "(가)" 3자). 한글은 영숫자보다 넓으므로 따로 센다.
 *
 * @param {string} markerName MARKERS의 name
 * @param {number} fontSizePt
 */
export function hangingIndentHwp(markerName, fontSizePt) {
    const pt = Number.isFinite(fontSizePt) && fontSizePt > 0 ? fontSizePt : 12;
    const unit = pt * 100;                       // 1타 = 글자 한 칸

    // 영숫자·괄호는 대략 반칸, 한글·원문자는 한 칸으로 센다.
    let width = 0;
    for (const ch of String(markerName || '')) {
        width += /[가-힣①-⑳㉮-㉿]/.test(ch) ? 1 : 0.5;
    }
    // 기호 폭 + 기호와 내용 사이 1타
    return Math.round((width + 1) * unit);
}

/** 지원하는 항목 기호 목록 — UI 안내와 테스트가 같은 출처를 쓰게 한다. */
export const GOV_MARKER_ORDER = MARKERS.map(m => m.name);
