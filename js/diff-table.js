/* ===================================================================
 * [diff-table.js] 신구조문대비표 생성
 * ===================================================================
 * 규정·법령·지침을 고칠 때 늘 따라붙는 산출물이다. 현행과 개정안을 나란히
 * 놓아 무엇이 바뀌었는지 보이게 한다.
 *
 * 법제처 실무 기준 중 이 모듈이 지키는 것:
 *   - **현행을 기준으로 순서를 잡는다.** 현행 조문 순서대로 내려가며
 *     개정안을 맞춰 놓는다. 개정안 기준으로 정렬하면 현행에서 사라진
 *     조문이 표에서 빠져 "무엇이 없어졌는지"를 볼 수 없다.
 *   - 새로 만든 항목은 현행 칸에 `<신설>`, 없앤 항목은 개정안 칸에 `<삭제>`.
 *   - 바뀌지 않은 항목도 그대로 둔다. 문맥이 없으면 대비표를 읽을 수 없다.
 *
 * ⚠ 이 모듈은 **문단 단위**로 비교한다. 조·항·호 단위 대비는 법령 구조
 *   파싱이 따로 필요하며, 그것을 문단 비교로 흉내내면 조문 번호가 어긋난
 *   표가 나온다. 제N조 머리글은 인식해 행을 나누되, 그 이상은 하지 않는다.
 * ===================================================================*/

'use strict';

/** 「제3조(목적)」처럼 조문이 시작하는 줄. 대비표의 행 경계로 쓴다. */
const ARTICLE_HEAD = /^제\s*\d+\s*조(\s*의\s*\d+)?\s*(\([^)]*\))?/;

/** 비교용 정규화 — 공백 차이만으로 "바뀜"이 되면 표가 잡음으로 찬다. */
function normalize(s) {
    return String(s || '').replace(/\s+/g, ' ').trim();
}

/**
 * IR 또는 문자열을 비교 단위(문단) 배열로 만든다.
 * 빈 줄은 버린다 — 대비표에서 빈 행은 의미가 없다.
 */
export function toUnits(source) {
    if (typeof source === 'string') {
        return source.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    }
    const blocks = source?.blocks || [];
    const out = [];
    const push = (t) => { const v = String(t || '').trim(); if (v) out.push(v); };

    for (const b of blocks) {
        if (!b) continue;
        switch (b.type) {
            case 'para': case 'heading': case 'quote': {
                const text = Array.isArray(b.runs)
                    ? b.runs.map(r => r.text || '').join('')
                    : (b.text || '');
                // 파서가 여러 줄을 한 문단으로 묶어 넘기므로 줄로 편다.
                for (const line of String(text).split(/\r?\n/)) push(line);
                break;
            }
            case 'list':
                for (const it of b.items || []) push(typeof it === 'string' ? it : it.text);
                break;
            case 'code':
                for (const line of String(b.text || '').split(/\r?\n/)) push(line);
                break;
            case 'table':
                // 표는 문단 대비의 단위가 아니다. 셀을 줄로 펴면 대비표가
                // 원문과 전혀 다른 모양이 되므로 한 행으로만 요약한다.
                push(`[표 ${(b.rows || []).length + (b.header ? 1 : 0)}행]`);
                break;
            default:
                if (b.text) push(b.text);
        }
    }
    return out;
}

/**
 * 최장 공통 부분 수열(LCS)로 두 목록을 맞춘다.
 *
 * 단순 순서 비교(i번째끼리 비교)를 쓰면 한 줄만 삽입돼도 그 뒤가 전부
 * "바뀜"으로 밀린다. 대비표에서 그건 치명적이다 — 실제로 한 줄 고쳤는데
 * 표 전체가 빨갛게 나온다.
 *
 * @returns {Array<{type:'same'|'changed'|'added'|'removed', old?:string, new?:string}>}
 */
function alignByLcs(oldUnits, newUnits) {
    const a = oldUnits.map(normalize);
    const b = newUnits.map(normalize);
    const n = a.length, m = b.length;

    // 표본이 아주 크면 O(n*m) 표가 메모리를 먹는다. 실무 대비표 규모를
    // 넘어서면 정렬을 포기하고 순서 비교로 내려간다(그 사실을 호출자가 안다).
    if (n * m > 4_000_000) return null;

    const dp = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
    for (let i = n - 1; i >= 0; i--) {
        for (let j = m - 1; j >= 0; j--) {
            dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
        }
    }

    const rows = [];
    let i = 0, j = 0;
    while (i < n && j < m) {
        if (a[i] === b[j]) {
            rows.push({ type: 'same', old: oldUnits[i], new: newUnits[j] });
            i++; j++;
        } else if (dp[i + 1][j] >= dp[i][j + 1]) {
            rows.push({ type: 'removed', old: oldUnits[i] });
            i++;
        } else {
            rows.push({ type: 'added', new: newUnits[j] });
            j++;
        }
    }
    while (i < n) rows.push({ type: 'removed', old: oldUnits[i++] });
    while (j < m) rows.push({ type: 'added', new: newUnits[j++] });
    return rows;
}

/** 「제3조의2」에서 조문 번호만 뽑는다. 없으면 null. */
function articleKey(text) {
    const m = /^제\s*(\d+)\s*조(?:\s*의\s*(\d+))?/.exec(String(text || '').trim());
    return m ? `${m[1]}${m[2] ? '-' + m[2] : ''}` : null;
}

/** 글자 이중자 기반 유사도(Dice). 0~1. */
function similarity(a, b) {
    const s1 = normalize(a), s2 = normalize(b);
    if (!s1 || !s2) return 0;
    if (s1 === s2) return 1;
    if (s1.length < 2 || s2.length < 2) return s1 === s2 ? 1 : 0;

    const grams = new Map();
    for (let i = 0; i < s1.length - 1; i++) {
        const g = s1.slice(i, i + 2);
        grams.set(g, (grams.get(g) || 0) + 1);
    }
    let hits = 0;
    for (let i = 0; i < s2.length - 1; i++) {
        const g = s2.slice(i, i + 2);
        const c = grams.get(g);
        if (c > 0) { grams.set(g, c - 1); hits++; }
    }
    return (2 * hits) / (s1.length - 1 + s2.length - 1);
}

/** 이 정도는 닮아야 "같은 조문을 고친 것"으로 본다. */
const PAIR_THRESHOLD = 0.5;

/**
 * 두 항목이 **같은 것의 개정**인지 판단한다.
 *
 * 조문 번호가 같으면 같은 조문이다(내용이 크게 바뀌어도). 번호가 없거나
 * 다르면 본문 유사도로 본다.
 */
function isSameItem(oldText, newText) {
    const ko = articleKey(oldText), kn = articleKey(newText);
    if (ko && kn) return ko === kn;
    if (ko !== null || kn !== null) return false;   // 한쪽만 조문이면 다른 것
    return similarity(oldText, newText) >= PAIR_THRESHOLD;
}

/**
 * 붙어 있는 삭제/신설을 "고침"으로 합친다 — **같은 항목일 때만.**
 *
 * LCS는 한 줄을 고친 것을 (삭제 + 신설)로 본다. 그것이 같은 행의 좌우여야
 * 읽힌다. 그러나 **아무 삭제와 아무 신설을 붙이면 안 된다.** 실제로 그렇게
 * 했다가 "제4조(문서의 보존)"과 "제2조의2(개방형 문서)"가 한 행에 놓였다 —
 * 서로 아무 관계가 없는데 개정된 것처럼 보인다. 법령 문서에서 그런 표는
 * 없느니만 못하다.
 *
 * 그래서 인접 쌍만 보지 않고, 삭제 항목마다 뒤따르는 신설 후보 중에서
 * 같은 조문(또는 충분히 닮은 문장)을 찾아 짝짓는다.
 */
function pairEdits(rows) {
    const used = new Set();
    const out = [];

    for (let k = 0; k < rows.length; k++) {
        if (used.has(k)) continue;
        const cur = rows[k];

        if (cur.type !== 'removed') { out.push(cur); continue; }

        // 뒤쪽의 연속된 편집 구간에서만 짝을 찾는다. 멀리 떨어진 항목과
        // 묶으면 현행 순서가 무너진다(대비표는 현행 순서가 기준이다).
        let partner = -1;
        for (let j = k + 1; j < rows.length; j++) {
            if (rows[j].type === 'same') break;          // 편집 구간 종료
            if (used.has(j) || rows[j].type !== 'added') continue;
            if (isSameItem(cur.old, rows[j].new)) { partner = j; break; }
        }

        if (partner >= 0) {
            used.add(partner);
            out.push({ type: 'changed', old: cur.old, new: rows[partner].new });
        } else {
            out.push(cur);
        }
    }

    return out;
}

const MARK_NEW = '<신설>';
const MARK_DELETED = '<삭제>';

/**
 * 신구조문대비표 IR을 만든다.
 *
 * @param {object|string} oldSource 현행
 * @param {object|string} newSource 개정안
 * @param {{title?:string, includeUnchanged?:boolean}} [options]
 * @returns {{ir:object, report:object}}
 */
export function buildComparisonTable(oldSource, newSource, options = {}) {
    const oldUnits = toUnits(oldSource);
    const newUnits = toUnits(newSource);

    let rows = alignByLcs(oldUnits, newUnits);
    const degraded = rows === null;
    if (degraded) {
        // 정렬을 포기한 경로 — 순서대로 짝짓는다. 정확도가 낮다는 사실을
        // report에 남겨 호출자가 사용자에게 알릴 수 있게 한다.
        const len = Math.max(oldUnits.length, newUnits.length);
        rows = [];
        for (let i = 0; i < len; i++) {
            const o = oldUnits[i], nu = newUnits[i];
            if (o === undefined) rows.push({ type: 'added', new: nu });
            else if (nu === undefined) rows.push({ type: 'removed', old: o });
            else if (normalize(o) === normalize(nu)) rows.push({ type: 'same', old: o, new: nu });
            else rows.push({ type: 'changed', old: o, new: nu });
        }
    } else {
        rows = pairEdits(rows);
    }

    const includeUnchanged = options.includeUnchanged !== false;
    const shown = includeUnchanged ? rows : rows.filter(r => r.type !== 'same');

    const report = {
        oldUnits: oldUnits.length,
        newUnits: newUnits.length,
        same: rows.filter(r => r.type === 'same').length,
        changed: rows.filter(r => r.type === 'changed').length,
        added: rows.filter(r => r.type === 'added').length,
        removed: rows.filter(r => r.type === 'removed').length,
        degraded,
        articles: rows.filter(r => ARTICLE_HEAD.test(r.old || r.new || '')).length,
    };

    // 바뀐 쪽만 굵게 표시한다. 양쪽을 다 굵게 하면 무엇이 바뀐 건지 안 보인다.
    const cell = (text, emphasize) => (
        emphasize
            ? { text: String(text), runs: [{ text: String(text), bold: true }] }
            : { text: String(text) }
    );

    const tableRows = shown.map(r => {
        switch (r.type) {
            case 'same':
                return [cell(r.old, false), cell(r.new, false)];
            case 'changed':
                return [cell(r.old, false), cell(r.new, true)];
            case 'added':
                return [cell(MARK_NEW, false), cell(r.new, true)];
            case 'removed':
                return [cell(r.old, false), cell(MARK_DELETED, true)];
            default:
                return [cell('', false), cell('', false)];
        }
    });

    const blocks = [
        {
            type: 'table',
            header: [cell('현 행', true), cell('개 정 안', true)],
            rows: tableRows.length ? tableRows : [[cell('(내용 없음)', false), cell('(내용 없음)', false)]],
        },
    ];

    return {
        ir: {
            title: options.title || '신구조문대비표',
            doc_type: 'plain',
            blocks,
        },
        report,
    };
}

export const COMPARISON_MARKS = Object.freeze({ added: MARK_NEW, removed: MARK_DELETED });
