/* ===================================================================
 * [roadmap-panel.js] 관리자 모드 '고도화 계획' 패널
 * ===================================================================
 * `roadmap.json`을 읽어 단계별 진행 상황·게이트·수동 확인 항목·다음 후보를
 * 보여준다. 관리자가 "지금 어디까지 왔고 다음에 뭘 할지"를 한 화면에서
 * 판단하기 위한 것이다.
 *
 * 설계 원칙
 *   - **내용을 여기에 적지 않는다.** 전부 roadmap.json에서 온다. 화면과
 *     데이터가 갈라지면 계획서를 보고 잘못된 판단을 하게 된다.
 *   - 완료 항목에는 근거(버전·PR)를 함께 보여준다. 증거 없는 "완료"는
 *     주장일 뿐이다.
 *   - **수동 확인 항목을 완료 목록보다 눈에 띄게 둔다.** 자동 게이트가
 *     아무리 많아도 한컴 시각 확인을 대체하지 않는다는 것이 이 저장소의
 *     황금률이고, 화면이 그 반대 인상을 주면 안 된다.
 *
 * 정합성은 qa/roadmap-gate.js가 지킨다(적어둔 버전·PR·게이트가 실제로
 * 존재하는지, 게이트가 test:release에 편입됐는지).
 * ===================================================================*/

'use strict';

const STATUS_LABEL = Object.freeze({
    done: '완료',
    'in-progress': '진행 중',
    planned: '예정',
    already: '기존 구현',
    dropped: '보류',
});

const VALUE_LABEL = Object.freeze({ high: '높음', mid: '중간', low: '낮음' });

let _roadmapData = null;

/** roadmap.json을 한 번만 읽는다. */
export async function loadRoadmap() {
    if (_roadmapData) return _roadmapData;
    const res = await fetch('roadmap.json');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    _roadmapData = await res.json();
    return _roadmapData;
}

/** 테스트에서 상태를 되돌릴 수 있게 한다. */
export function resetRoadmapCache() { _roadmapData = null; }

function countItems(phases) {
    let done = 0, total = 0;
    for (const p of phases || []) {
        for (const i of p.items || []) {
            total++;
            if (i.status === 'done' || i.status === 'already') done++;
        }
    }
    return { done, total };
}

/**
 * 계획 패널 HTML.
 * @param {object} data roadmap.json
 * @param {(s:string)=>string} esc 앱의 escHtml — 이 모듈은 자체 이스케이프를 두지 않는다
 */
export function renderRoadmapPanel(data, esc) {
    if (!data) return '<p class="changelog-load-error">고도화 계획을 불러오지 못했습니다.</p>';

    const phases = data.phases || [];
    const donePhases = phases.filter(p => p.status === 'done').length;
    const { done, total } = countItems(phases);
    const gates = data.gates || [];
    const manual = data.manualVerification || [];
    const candidates = data.candidates || [];

    const phaseHtml = phases.map(phase => {
        const items = (phase.items || []).map(item => `
            <li class="rm-item rm-item--${esc(item.status)}">
                <span class="rm-item-mark">${item.status === 'done' ? '✓'
                    : item.status === 'already' ? '·'
                    : item.status === 'dropped' ? '—' : '○'}</span>
                <div>
                    <strong>${esc(item.title)}</strong>
                    <span class="rm-item-status">${esc(STATUS_LABEL[item.status] || item.status)}</span>
                    ${item.note ? `<p>${esc(item.note)}</p>` : ''}
                </div>
            </li>
        `).join('');

        const evidence = [];
        if ((phase.versions || []).length) evidence.push(`v${(phase.versions || []).join(' · v')}`);
        if ((phase.prs || []).length) evidence.push(`#${(phase.prs || []).join(' #')}`);

        return `
            <section class="rm-phase rm-phase--${esc(phase.status)}">
                <header class="rm-phase-head">
                    <div>
                        <span class="rm-phase-badge">${esc(STATUS_LABEL[phase.status] || phase.status)}</span>
                        <strong>${esc(phase.name)}</strong>
                    </div>
                    ${evidence.length ? `<span class="rm-evidence">${esc(evidence.join(' · '))}</span>` : ''}
                </header>
                ${phase.goal ? `<p class="rm-phase-goal">${esc(phase.goal)}</p>` : ''}
                <ul class="rm-item-list">${items}</ul>
            </section>
        `;
    }).join('');

    const gateHtml = gates.map(g => `
        <tr>
            <td class="rm-mono">${esc(g.script)}</td>
            <td>${esc(g.label)}</td>
            <td class="rm-mono">${esc(g.since ? 'v' + g.since : '')}</td>
            <td class="rm-gate-checks">${esc(g.checks || '')}</td>
        </tr>
    `).join('');

    const manualHtml = manual.map(m => `
        <li>
            <strong>${esc(m.title)}</strong>
            <p>${esc(m.why)}</p>
            ${m.where ? `<span class="rm-mono">${esc(m.where)}</span>` : ''}
        </li>
    `).join('');

    const candidateHtml = candidates.map(c => `
        <tr>
            <td>${esc(c.title)}</td>
            <td><span class="rm-chip rm-chip--${esc(c.value)}">${esc(VALUE_LABEL[c.value] || c.value)}</span></td>
            <td><span class="rm-chip rm-chip--effort-${esc(c.effort)}">${esc(VALUE_LABEL[c.effort] || c.effort)}</span></td>
            <td class="rm-cand-note">
                ${esc(c.note || '')}
                ${c.blockedBy ? `<em>선행: ${esc(c.blockedBy)}</em>` : ''}
            </td>
        </tr>
    `).join('');

    return `
    <div class="roadmap-panel">
        <div class="rm-summary">
            <div><span>단계</span><b>${donePhases}/${phases.length}</b><small>완료</small></div>
            <div><span>세부 항목</span><b>${done}/${total}</b><small>완료</small></div>
            <div><span>자동 게이트</span><b>${gates.length}</b><small>계획 등재</small></div>
            <div class="rm-summary-manual"><span>사람 확인</span><b>${manual.length}</b><small>남음</small></div>
        </div>

        <div class="rm-thesis">
            <div><span class="rm-thesis-label">기존</span><span class="rm-thesis-from">${esc(data.thesis?.from || '')}</span></div>
            <div><span class="rm-thesis-label">전환</span><strong>${esc(data.thesis?.to || '')}</strong></div>
            ${data.thesis?.why ? `<p>${esc(data.thesis.why)}</p>` : ''}
            ${data.thesis?.marketWindow ? `<p class="rm-window">${esc(data.thesis.marketWindow)}</p>` : ''}
        </div>

        <div class="rm-manual">
            <h4>⚠ 자동 게이트가 대신할 수 없는 확인</h4>
            <p class="rm-manual-lead">구조 게이트 통과는 시각 통과가 아닙니다. 아래는 한컴오피스에서 사람이 봐야 합니다.</p>
            <ul class="rm-manual-list">${manualHtml}</ul>
        </div>

        <h4 class="rm-section-title">단계별 진행</h4>
        ${phaseHtml}

        <h4 class="rm-section-title">이번에 추가된 자동 게이트</h4>
        <div class="rm-table-wrap">
            <table class="rm-table">
                <thead><tr><th>스크립트</th><th>검사 대상</th><th>도입</th><th>확인 항목</th></tr></thead>
                <tbody>${gateHtml}</tbody>
            </table>
        </div>

        <h4 class="rm-section-title">다음 후보</h4>
        <div class="rm-table-wrap">
            <table class="rm-table">
                <thead><tr><th>항목</th><th>가치</th><th>비용</th><th>메모</th></tr></thead>
                <tbody>${candidateHtml}</tbody>
            </table>
        </div>

        <p class="rm-footnote">
            이 화면의 모든 내용은 <span class="rm-mono">roadmap.json</span>에서 옵니다.
            적어둔 버전·PR·게이트가 실제로 존재하는지는 <span class="rm-mono">npm run test:roadmap</span>이 검사합니다.
            마지막 갱신 ${esc(data.updated || '')}
        </p>
    </div>
    `;
}
