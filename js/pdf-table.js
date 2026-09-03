/* ===================================================================
 * [pdf-table.js] 괘선으로 표 격자 세우기
 * ===================================================================
 * 지금까지 PDF 표는 **글자 사이 공백**으로만 찾았다. 그래서 열 간격이 좁은
 * 표(`A B C` / `1 2 3`)는 그냥 문단이 되고, 병합 셀이 있으면 격자가 어긋나
 * `사업비 130`이 `120 140 사업비` 순서로 뒤섞였다.
 *
 * 괘선이 있으면 추측할 필요가 없다. 선이 곧 격자다.
 *
 * ── 쪽 하나에 격자 하나가 아니다 ──
 * 처음에는 쪽의 모든 괘선을 모아 격자를 **하나만** 세웠다. 그러자 실제 문서에서
 * 머리말 밑줄·제목 밑줄·설명 상자·진짜 표가 전부 한 표로 뭉쳐 **14행짜리 가짜
 * 표**가 나왔다. 제목과 본문 문단이 셀 안에 갇혀 문서를 읽을 수 없었다.
 *
 * 그래서 pdfplumber와 같은 방식으로 바꿨다.
 *   ① 가로선·세로선의 **교차점**에서 시작해
 *   ② 오른쪽·아래로 가장 가까운 **닫힌 사각형**을 찾는다. 네 변이 모두 실제
 *      선으로 이어져 있어야 셀이다. 병합 셀은 자연히 여러 칸을 덮는 큰 셀
 *      하나로 나온다 — 따로 병합을 추론할 필요가 없다.
 *   ③ 꼭짓점을 공유하는 셀끼리 묶는다. **묶음 하나가 표 하나**다.
 *
 * ── 상자는 표가 아니다 ──
 * 테두리만 있고 안에 세로 칸막이가 없는 영역은 표가 아니라 **설명 상자**다.
 * 표로 만들면 본문 문단이 셀 안에 갇혀 읽기 흐름이 끊긴다. 그래서 열이
 * 하나뿐인 묶음은 표로 만들지 않고 본문으로 흘려보낸다.
 * ===================================================================*/

'use strict';

/** 같은 선으로 볼 좌표 오차(pt). 괘선 굵기와 반올림을 흡수한다. */
const SNAP = 3;

/** 선 끝이 이만큼 모자라도 그 구간을 덮은 것으로 본다. */
const COVER_TOL = 2.5;

/**
 * 1차원 좌표를 뭉친다.
 *
 * ⚠ 연쇄 주의: 기준을 **직전 값**으로 삼으면 3pt씩 떨어진 좌표가 끝없이
 * 이어져 열 전체가 하나로 무너진다. 그래서 **그룹의 첫 값**을 기준으로 둔다.
 */
function cluster(values, tol = SNAP) {
    const sorted = [...values].sort((a, b) => a - b);
    const groups = [];
    for (const v of sorted) {
        const g = groups[groups.length - 1];
        if (g && v - g.anchor <= tol) g.items.push(v);
        else groups.push({ anchor: v, items: [v] });
    }
    return groups.map(g => g.items.reduce((a, b) => a + b, 0) / g.items.length);
}

/** 선분 [s,e]가 구간 [a,b]를 덮는가. */
function covers(s, e, a, b) {
    return s <= a + COVER_TOL && e >= b - COVER_TOL;
}

/** 이어진 것으로 볼 선분 사이 틈(pt). */
const JOIN_TOL = 3;

/**
 * 같은 직선 위의 선분들을 **이어 붙인다.**
 *
 * 표 테두리는 하나의 긴 선이 아니라 **칸마다 따로** 그려지는 일이 흔하다.
 * 실측하면 왼쪽 세로 테두리가 이렇게 온다.
 *
 *   x=57.4  y 706.4..734.1     ← 0행
 *   x=57.4  y 679.4..706.4     ← 1행
 *   x=57.4  y 653.1..679.4     ← 2행
 *
 * 이걸 이어 붙이지 않으면 **두 행에 걸친 셀(세로 병합)을 절대 못 찾는다.**
 * 어떤 선분 하나도 그 범위를 덮지 못하기 때문이다. 실제로 병합 셀과 머리행이
 * 통째로 사라졌다.
 *
 * @returns {Map<number, [number,number][]>} 뭉친 좌표 → 이어 붙인 구간들
 */
function mergeCollinear(lines, keyOf, lowOf, highOf, keys) {
    const out = new Map(keys.map(k => [k, []]));
    for (const key of keys) {
        const segs = lines
            .filter(l => Math.abs(keyOf(l) - key) <= SNAP)
            .map(l => [lowOf(l), highOf(l)])
            .sort((a, b) => a[0] - b[0]);
        const merged = [];
        for (const [lo, hi] of segs) {
            const last = merged[merged.length - 1];
            if (last && lo <= last[1] + JOIN_TOL) last[1] = Math.max(last[1], hi);
            else merged.push([lo, hi]);
        }
        out.set(key, merged);
    }
    return out;
}

/**
 * 괘선에서 표들을 세운다. **여러 개**를 돌려준다.
 *
 * @param {{y:number,x1:number,x2:number}[]} hLines 가로 괘선
 * @param {{x:number,y1:number,y2:number}[]} vLines 세로 괘선
 * @returns {object[]} 표마다 `{xs, ys, cells, nRows, nCols, top, bottom}`.
 *   `ys`는 위에서 아래 순서(PDF y는 위가 크므로 내림차순).
 */
export function buildGrids(hLines, vLines) {
    if (!hLines?.length || !vLines?.length) return [];

    const xs = cluster(vLines.map(v => v.x));
    const ys = cluster(hLines.map(h => h.y)).sort((a, b) => b - a);   // 위→아래
    if (xs.length < 2 || ys.length < 2) return [];

    // 칸마다 끊겨 그려진 테두리를 먼저 이어 붙인다.
    const vSegs = mergeCollinear(vLines, l => l.x, l => l.y1, l => l.y2, xs);
    const hSegs = mergeCollinear(hLines, l => l.y, l => l.x1, l => l.x2, ys);

    const hasV = (x, yTop, yBot) => (vSegs.get(x) || []).some(([lo, hi]) => covers(lo, hi, yBot, yTop));
    const hasH = (y, xL, xR) => (hSegs.get(y) || []).some(([lo, hi]) => covers(lo, hi, xL, xR));

    // ── ② 교차점에서 가장 가까운 닫힌 사각형 ──
    // 가장 가까운 것만 취해야 큰 사각형(바깥 테두리)이 안쪽 칸들을 삼키지 않는다.
    const raw = [];
    for (let r = 0; r < ys.length - 1; r++) {
        for (let c = 0; c < xs.length - 1; c++) {
            let hit = null;
            for (let c2 = c + 1; c2 < xs.length && !hit; c2++) {
                if (!hasH(ys[r], xs[c], xs[c2])) continue;            // 윗변
                for (let r2 = r + 1; r2 < ys.length; r2++) {
                    if (!hasH(ys[r2], xs[c], xs[c2])) continue;       // 아랫변
                    if (!hasV(xs[c], ys[r], ys[r2])) continue;        // 왼변
                    if (!hasV(xs[c2], ys[r], ys[r2])) continue;       // 오른변
                    hit = { r2, c2 };
                    break;
                }
            }
            if (hit) raw.push({ r0: r, c0: c, r1: hit.r2, c1: hit.c2 });
        }
    }
    if (!raw.length) return [];

    // ── ③ 꼭짓점을 공유하는 셀끼리 묶기 ──
    const parent = raw.map((_, i) => i);
    const find = i => (parent[i] === i ? i : (parent[i] = find(parent[i])));
    const union = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent[ra] = rb; };

    const corners = new Map();
    raw.forEach((cell, i) => {
        for (const r of [cell.r0, cell.r1]) {
            for (const c of [cell.c0, cell.c1]) {
                const key = `${r},${c}`;
                if (!corners.has(key)) corners.set(key, []);
                corners.get(key).push(i);
            }
        }
    });
    for (const group of corners.values()) {
        for (let k = 1; k < group.length; k++) union(group[0], group[k]);
    }

    const byRoot = new Map();
    raw.forEach((cell, i) => {
        const root = find(i);
        if (!byRoot.has(root)) byRoot.set(root, []);
        byRoot.get(root).push(cell);
    });

    const grids = [];
    for (const group of byRoot.values()) {
        // 이 표가 실제로 쓰는 경계만 추린다. 전역 격자 번호를 표 안 번호로 옮긴다.
        const rowIdx = [...new Set(group.flatMap(c => [c.r0, c.r1]))].sort((a, b) => a - b);
        const colIdx = [...new Set(group.flatMap(c => [c.c0, c.c1]))].sort((a, b) => a - b);
        const nRows = rowIdx.length - 1;
        const nCols = colIdx.length - 1;

        // 세로 칸막이가 없으면 표가 아니라 설명 상자다. 본문으로 흘려보낸다.
        if (nRows < 1 || nCols < 2) continue;

        const rowAt = new Map(rowIdx.map((v, i) => [v, i]));
        const colAt = new Map(colIdx.map((v, i) => [v, i]));

        const cells = group.map(c => ({
            row: rowAt.get(c.r0),
            col: colAt.get(c.c0),
            rowspan: Math.max(1, rowAt.get(c.r1) - rowAt.get(c.r0)),
            colspan: Math.max(1, colAt.get(c.c1) - colAt.get(c.c0)),
            x0: xs[c.c0], x1: xs[c.c1],
            yTop: ys[c.r0], yBot: ys[c.r1],
            runs: [], fonts: new Set(), maxH: 0,
        }));

        grids.push({
            xs: colIdx.map(i => xs[i]),
            ys: rowIdx.map(i => ys[i]),
            cells, nRows, nCols,
            top: Math.max(...cells.map(c => c.yTop)),
            bottom: Math.min(...cells.map(c => c.yBot)),
        });
    }

    grids.sort((a, b) => b.top - a.top);   // 위에 있는 표부터
    return grids;
}

/**
 * 첫 행을 머리행으로 볼 **근거**가 있는가.
 *
 *   (1) 글자가 더 크거나
 *   (2) 아래 행과 겹치지 않는 글꼴로 그려졌다(보통 굵은 변형)
 *
 * 둘 다 없으면 머리행이라고 주장하지 않는다. 괘선이 있다고 첫 행이 머리행인
 * 것은 아니다 — 근거 없이 주장하면 본문 행 하나를 잃는다.
 */
export function firstRowIsHeader(grid) {
    if (!grid || grid.nRows < 2) return false;
    const row0 = grid.cells.filter(c => c.row === 0);
    const row1 = grid.cells.filter(c => c.row === 1);
    if (!row0.length || !row1.length) return false;

    const h0 = Math.max(...row0.map(c => c.maxH || 0));
    const h1 = Math.max(...row1.map(c => c.maxH || 0));
    if (h0 > h1 + 0.3) return true;

    const f0 = new Set(row0.flatMap(c => [...c.fonts]));
    const f1 = new Set(row1.flatMap(c => [...c.fonts]));
    if (!f0.size || !f1.size) return false;
    return ![...f0].some(f => f1.has(f));
}

/**
 * 글자 조각을 칸에 넣는다.
 *
 * 조각의 **중심**이 어느 칸 안에 있는지로 정한다. 왼쪽 끝으로 정하면 경계에
 * 걸친 글자가 옆 칸으로 새고, 오른쪽 끝으로 정하면 반대로 샌다.
 *
 * @returns {Set<number>} 이 표가 삼킨 줄 번호
 */
export function fillCells(grid, lines) {
    const { cells, xs, ys } = grid;
    const left = xs[0], right = xs[xs.length - 1];
    const top = ys[0], bottom = ys[ys.length - 1];
    const used = new Set();

    for (let li = 0; li < lines.length; li++) {
        const line = lines[li];
        if (line.y > top + SNAP || line.y < bottom - SNAP) continue;

        let touched = false;
        for (const it of line.items) {
            // 공백 조각의 width는 믿을 수 없으므로 중심 대신 왼쪽 끝을 쓴다.
            const cx = it.s.trim() ? it.x + (it.w || 0) / 2 : it.x;
            const cy = line.y;
            if (cx < left - SNAP || cx > right + SNAP) continue;

            const cell = cells.find(c =>
                cx >= c.x0 - SNAP && cx <= c.x1 + SNAP
                && cy <= c.yTop + SNAP && cy >= c.yBot - SNAP);
            if (!cell) continue;

            // 같은 칸 안에서 줄이 바뀌면 공백으로 잇는다(칸 안 여러 줄).
            if (cell.runs.length && cell.lastLine !== li) {
                cell.runs.push({ text: ' ', bold: false, italic: false, color: '#000000' });
            }
            cell.lastLine = li;
            cell.runs.push(...(it.runs || [{ text: it.s }]));
            if (it.font) cell.fonts.add(it.font);
            cell.maxH = Math.max(cell.maxH, it.h || line.h || 0);
            touched = true;
        }
        if (touched) used.add(li);
    }
    return used;
}

/**
 * 채워진 면을 표 셀에 이어 준다 — 셀 음영.
 *
 * 셀 하나를 **충분히 덮는** 면만 그 셀의 배경으로 본다. 단순히 셀 중심을
 * 포함하는 면을 쓰면 쪽 전체를 덮는 큰 도형이 모든 셀의 배경이 되어 버린다.
 *
 * 이걸 하지 않으면 흰 글자 머리행이 **배경 없이** 남아 한글에서 글자가
 * 보이지 않는다(흰 바탕에 흰 글자). 실문서에서 표 20개가 그 상태였다.
 */
export function applyCellFills(grid, fills) {
    if (!fills?.length) return;
    for (const cell of grid.cells) {
        const cw = cell.x1 - cell.x0, ch = cell.yTop - cell.yBot;
        if (cw <= 0 || ch <= 0) continue;
        const cellArea = cw * ch;

        let best = null, bestCover = 0;
        for (const f of fills) {
            const ox = Math.min(cell.x1, f.x1) - Math.max(cell.x0, f.x0);
            const oy = Math.min(cell.yTop, f.y1) - Math.max(cell.yBot, f.y0);
            if (ox <= 0 || oy <= 0) continue;
            const cover = (ox * oy) / cellArea;                 // 셀의 몇 %를 덮나
            const fillArea = (f.x1 - f.x0) * (f.y1 - f.y0);
            // 셀보다 훨씬 큰 면은 배경 도형이지 이 셀의 음영이 아니다.
            if (fillArea > cellArea * 2.5) continue;
            if (cover > bestCover) { bestCover = cover; best = f; }
        }
        // 절반 넘게 덮어야 그 셀의 음영으로 인정한다.
        if (best && bestCover >= 0.5) cell.bg = best.color.replace(/^#/, '').toUpperCase();
    }
}
