/* ===================================================================
 * [pdf-layout.js] 쪽 레이아웃 — 머리말·꼬리말과 다단
 * ===================================================================
 * PDF는 "이건 머리말이다", "여긴 2단이다"라고 말해 주지 않는다. 좌표만 있다.
 * 그대로 위에서 아래로 읽으면 두 가지가 무너진다.
 *
 *   ① 쪽마다 반복되는 머리말·쪽번호가 본문 사이에 계속 끼어든다.
 *      10쪽 문서면 "내부 검토용" 10번, 쪽번호 10개가 본문에 박힌다.
 *
 *   ② 2단 편집에서 좌우가 섞인다. 같은 높이에 있는 왼쪽 단과 오른쪽 단이
 *      한 줄로 합쳐져, 글자는 다 남는데 문장이 읽히지 않는다.
 *
 * ── 다단을 어떻게 가르는가 ──
 * 재귀 XY-cut을 그대로 쓰지 않는다. 전폭 제목이 하나만 있어도 세로로 자를 수
 * 없게 되어 2단이 통째로 1단으로 무너지기 때문이다.
 *
 * 그래서 **전폭 줄을 먼저 떼어낸다.** 본문 폭의 대부분을 가로지르는 줄은
 * 단 구분과 무관한 "띠"로 보고, 그 띠들 사이 구간마다 따로 단을 찾는다.
 * ===================================================================*/

'use strict';

/** 쪽 가장자리에서 이 비율 안쪽까지를 머리말·꼬리말 자리로 본다. */
const MARGIN_BAND = 0.12;

/** 같은 자리로 볼 세로 오차(pt). */
const SAME_Y = 6;

/** 한 줄의 글자를 잇는다. */
function lineText(line) {
    return (line.items || []).map(i => i.s).join('').replace(/\s+/g, ' ').trim();
}

/**
 * 쪽마다 반복되는 머리말·꼬리말·쪽번호를 찾는다.
 *
 * 판단 근거는 셋을 **모두** 만족할 때다.
 *   ① 쪽 위/아래 가장자리 띠 안에 있다
 *   ② 여러 쪽에서 거의 같은 높이에 나타난다
 *   ③ 숫자를 뺀 글자가 같다 — `- 1 -`과 `- 2 -`를 같은 것으로 보기 위해서다
 *
 * ②가 없으면 본문의 흔한 문장이 지워지고, ①이 없으면 반복되는 표 머리행이
 * 지워진다. 셋 다 있어야 "이건 쪽 장식이다"라고 말할 수 있다.
 *
 * 쪽이 하나뿐이면 반복을 관찰할 수 없으므로 아무것도 지우지 않는다.
 *
 * @returns {Set<string>} `"쪽번호:줄번호"` 집합
 */
export function findRunningLines(pages) {
    const drop = new Set();
    if (!pages || pages.length < 2) return drop;

    // 숫자는 쪽마다 달라지므로 자리표시자로 바꿔 비교한다.
    const shape = t => t.replace(/\d+/g, '#');

    const seen = new Map();   // shape → [{p, i, y}]
    pages.forEach((page, p) => {
        const h = page.height || 842;
        const bottom = page.yBottom || 0;
        const topBand = bottom + h * (1 - MARGIN_BAND);
        const botBand = bottom + h * MARGIN_BAND;

        (page.lines || []).forEach((line, i) => {
            if (line.y < topBand && line.y > botBand) return;   // 본문 영역
            const t = lineText(line);
            if (!t) return;
            const key = shape(t);
            if (!seen.has(key)) seen.set(key, []);
            seen.get(key).push({ p, i, y: line.y });
        });
    });

    for (const hits of seen.values()) {
        if (hits.length < 2) continue;
        // 서로 다른 쪽에서 나와야 한다. 같은 쪽에 두 번 있는 건 반복이 아니다.
        const pagesHit = new Set(hits.map(h => h.p));
        if (pagesHit.size < 2) continue;
        // 높이도 비슷해야 한다.
        const ys = hits.map(h => h.y);
        if (Math.max(...ys) - Math.min(...ys) > SAME_Y) continue;
        for (const h of hits) drop.add(`${h.p}:${h.i}`);
    }
    return drop;
}

/**
 * 한 쪽의 줄을 **읽는 순서**로 다시 늘어놓는다.
 *
 * ── 왜 줄을 다시 쪼개야 하는가 ──
 * 줄 묶기(`assembleLines`)는 y가 같으면 한 줄로 본다. 쪽 전체를 가로질러서.
 * 그래서 2단 편집에서는 **왼쪽 단의 한 줄과 오른쪽 단의 한 줄이 같은 줄 객체로
 * 합쳐진다.** 실제로 `"오른쪽 단으로 넘어간 문장입니다. 왼쪽 단을"` 같은 줄이
 * 만들어졌다. 이미 합쳐진 뒤에 순서만 바꾸면 고칠 수 없다.
 *
 * 그래서 여기서 골짜기를 찾아 **합쳐진 줄을 도로 가른 뒤** 순서를 잡는다.
 *
 * @param {object[]} lines 위→아래로 정렬된 줄
 * @returns {object[]} 재배열된 줄
 */
export function orderByColumns(lines) {
    if (!lines || lines.length < 4) return lines;

    // ── 골짜기 찾기 ──
    // 줄 단위가 아니라 **글자 조각 단위**로 본다. 줄은 이미 좌우가 합쳐져
    // 있어서 폭이 항상 전폭으로 보이기 때문이다.
    const items = lines.flatMap(l => l.items || []);
    if (items.length < 8) return lines;

    const left = Math.min(...items.map(i => i.x));
    const right = Math.max(...items.map(i => i.x + (i.w || 0)));
    const width = right - left;
    if (!(width > 0)) return lines;

    const STEP = 2;
    const bins = Math.max(1, Math.ceil(width / STEP));
    const occupied = new Uint8Array(bins);
    for (const it of items) {
        if (!it.s || !it.s.trim()) continue;
        const a = Math.max(0, Math.floor((it.x - left) / STEP));
        const b = Math.min(bins - 1, Math.ceil((it.x + (it.w || 0) - left) / STEP));
        for (let k = a; k <= b; k++) occupied[k] = 1;
    }

    // 가운데 60% 안에서 가장 넓은 빈 구간. 가장자리 여백은 골짜기가 아니다.
    const lo = Math.floor(bins * 0.2), hi = Math.ceil(bins * 0.8);
    let best = null, run = null;
    for (let k = lo; k <= hi; k++) {
        if (!occupied[k]) { run = run || { a: k }; run.b = k; }
        else if (run) {
            if (!best || (run.b - run.a) > (best.b - best.a)) best = run;
            run = null;
        }
    }
    if (run && (!best || (run.b - run.a) > (best.b - best.a))) best = run;
    if (!best) return lines;

    const gutterW = (best.b - best.a + 1) * STEP;
    if (gutterW < Math.max(width * 0.04, 10)) return lines;
    const gutterX = left + ((best.a + best.b) / 2) * STEP;

    // 오른쪽 단이 실제로 시작하는 x. 골짜기 오른쪽 첫 글자 자리다.
    const rightItems = items.filter(i => i.s?.trim() && (i.x + (i.w || 0) / 2) >= gutterX);
    const rightColLeft = rightItems.length ? Math.min(...rightItems.map(i => i.x)) : gutterX;

    // ── 골짜기를 걸친 줄을 도로 가른다 ──
    const split = [];
    for (const line of lines) {
        const L = [], R = [];
        for (const it of line.items || []) {
            ((it.x + (it.w || 0) / 2) < gutterX ? L : R).push(it);
        }
        // colLeft = 그 단의 왼쪽 끝. 들여쓰기는 쪽 왼쪽이 아니라 **제 단** 기준으로
        // 재야 한다. 아니면 오른쪽 단 전체가 "들여쓴 줄"로 보여 목록이 된다.
        if (L.length && R.length) {
            split.push({ y: line.y, h: line.h, items: L, side: 'L', colLeft: left });
            split.push({ y: line.y, h: line.h, items: R, side: 'R', colLeft: rightColLeft });
        } else {
            const only = L.length ? L : R;
            const side = L.length ? 'L' : 'R';
            split.push({ y: line.y, h: line.h, items: only, side,
                colLeft: side === 'L' ? left : rightColLeft });
        }
    }

    // 전폭 줄(제목·표)은 단을 가로지르므로 밴드 경계가 된다.
    const isBand = l => {
        const xs = l.items.map(i => i.x);
        const xe = l.items.map(i => i.x + (i.w || 0));
        return (Math.max(...xe) - Math.min(...xs)) >= width * 0.8;
    };

    const out = [];
    let bandL = [], bandR = [];
    const flush = () => { out.push(...bandL, ...bandR); bandL = []; bandR = []; };
    for (const l of split) {
        if (isBand(l)) { flush(); out.push(l); continue; }
        (l.side === 'L' ? bandL : bandR).push(l);
    }
    flush();
    return out;
}
