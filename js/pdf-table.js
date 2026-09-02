/* ===================================================================
 * [pdf-table.js] 괘선으로 표 격자 세우기
 * ===================================================================
 * 지금까지 PDF 표는 **글자 사이 공백**으로만 찾았다. 그래서 열 간격이 좁은
 * 표(`A B C` / `1 2 3`)는 그냥 문단이 되고, 병합 셀이 있으면 격자가 어긋나
 * `사업비 130`이 `120 140 사업비` 순서로 뒤섞였다.
 *
 * 괘선이 있으면 추측할 필요가 없다. 선이 곧 격자다.
 *
 * ── 절차 ──
 *  ① 세로선의 x, 가로선의 y를 각각 뭉쳐(클러스터) 격자 경계를 만든다.
 *  ② 경계 사이 칸마다 **네 변에 실제로 선이 있는지** 확인한다.
 *     — 오른쪽 변이 없으면 그 칸은 오른쪽으로 이어져 있다(가로 병합).
 *     — 아래 변이 없으면 아래로 이어져 있다(세로 병합).
 *     이건 추론이 아니라 관찰이다. Camelot이 `set_span()`에서 쓰는 방식과 같다.
 *  ③ 글자를 중심 좌표로 칸에 넣는다.
 *
 * ── 왜 병합을 "빈 칸"으로 두지 않는가 ──
 * pdfplumber는 병합 자리를 `None`으로 남긴다. 그건 표를 다시 그릴 때는
 * 되지만, 우리는 **읽는 순서**도 지켜야 한다. 빈 칸을 그냥 버리면
 * `사업비`가 어느 행에 속하는지가 사라진다.
 * ===================================================================*/

'use strict';

/** 같은 선으로 볼 좌표 오차(pt). 괘선 굵기와 반올림을 흡수한다. */
const SNAP = 3;

/** 이 정도는 덮은 것으로 본다 — 선 끝이 살짝 모자란 경우가 흔하다. */
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

/** [a,b] 구간이 선분 [s,e]에 (오차 안에서) 덮이는가. */
function covers(s, e, a, b) {
    return s <= a + COVER_TOL && e >= b - COVER_TOL;
}

/**
 * 괘선에서 표를 세운다.
 *
 * @param {{y:number,x1:number,x2:number}[]} hLines 가로 괘선
 * @param {{x:number,y1:number,y2:number}[]} vLines 세로 괘선
 * @returns {{xs:number[], ys:number[], cells:object[]}|null}
 *   `ys`는 위에서 아래 순서(PDF y는 위가 크므로 내림차순).
 */
export function buildGrid(hLines, vLines) {
    if (!hLines?.length || !vLines?.length) return null;

    const xs = cluster(vLines.map(v => v.x));
    const ys = cluster(hLines.map(h => h.y)).sort((a, b) => b - a);   // 위→아래

    // 최소 2행 2열이 아니면 표라고 부르지 않는다. 가로 구분선 하나가
    // 표가 되어 버리면 문서 전체가 표투성이가 된다.
    if (xs.length < 3 || ys.length < 3) return null;

    const hasV = (x, yTop, yBot) => vLines.some(v =>
        Math.abs(v.x - x) <= SNAP && covers(v.y1, v.y2, yBot, yTop));
    const hasH = (y, xL, xR) => hLines.some(h =>
        Math.abs(h.y - y) <= SNAP && covers(h.x1, h.x2, xL, xR));

    const nCols = xs.length - 1;
    const nRows = ys.length - 1;

    // 각 칸의 네 변에 선이 있는지 먼저 다 본다.
    const edge = [];
    for (let r = 0; r < nRows; r++) {
        edge.push([]);
        for (let c = 0; c < nCols; c++) {
            const xL = xs[c], xR = xs[c + 1];
            const yTop = ys[r], yBot = ys[r + 1];
            edge[r].push({
                right: hasV(xR, yTop, yBot),
                bottom: hasH(yBot, xL, xR),
            });
        }
    }

    // 오른쪽/아래 변이 없으면 이어진 칸이다. 병합의 시작점만 셀로 남긴다.
    const taken = Array.from({ length: nRows }, () => new Array(nCols).fill(false));
    const cells = [];
    for (let r = 0; r < nRows; r++) {
        for (let c = 0; c < nCols; c++) {
            if (taken[r][c]) continue;

            let colspan = 1;
            while (c + colspan < nCols && !edge[r][c + colspan - 1].right) colspan++;

            let rowspan = 1;
            while (r + rowspan < nRows && !edge[r + rowspan - 1][c].bottom) rowspan++;

            for (let rr = r; rr < r + rowspan; rr++) {
                for (let cc = c; cc < c + colspan; cc++) taken[rr][cc] = true;
            }
            cells.push({
                row: r, col: c, rowspan, colspan,
                x0: xs[c], x1: xs[c + colspan],
                yTop: ys[r], yBot: ys[r + rowspan],
                runs: [],
                // 머리행 판정의 **근거**. 표 머리행은 보통 본문과 다른 글꼴(굵은
                // 변형)이나 더 큰 글자로 그려진다. 근거가 없으면 머리행이라고
                // 주장하지 않는다.
                fonts: new Set(),
                maxH: 0,
            });
        }
    }
    return { xs, ys, cells, nRows, nCols };
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
            const cx = it.x + (it.w || 0) / 2;
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
