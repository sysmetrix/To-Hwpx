/* ===================================================================
 * [qa/roadmap-gate.js] 고도화 계획 정합성 게이트
 * ===================================================================
 * 실행: node qa/roadmap-gate.js
 *
 * `roadmap.json`은 관리자 모드 '고도화 계획' 탭의 단일 출처다. 손으로 적는
 * 문서이므로 **가만두면 반드시 저장소와 어긋난다** — 완료로 표시한 항목의
 * 게이트가 지워지거나, 적어둔 버전이 changelog에 없거나, PR 번호가 틀리거나.
 *
 * 계획서가 현실과 다르면 그것을 보고 판단하는 사람이 잘못된 판단을 한다.
 * 그래서 여기 적힌 주장을 저장소에 대조한다.
 *
 * 검사 항목
 *   ① JSON 스키마와 필수 필드
 *   ② 완료(done) 단계의 버전이 changelog.json에 실제로 있는가
 *   ③ 적어둔 게이트가 package.json scripts에 실제로 있는가
 *   ④ 그 게이트가 test:release에 편입돼 있는가  ← 안 돌면 없는 것과 같다
 *   ⑤ 게이트 스크립트 파일이 실제로 존재하는가
 *   ⑥ 수동 확인 항목이 가리키는 문서가 존재하는가
 *   ⑦ 상태 값이 허용된 것만 쓰이는가
 *   ⑧ 후보 항목의 blockedBy가 실재하는 다른 후보를 가리키는가
 *
 * ④가 특히 중요하다. 게이트를 만들고 test:release에 넣지 않으면
 * 릴리스 때 돌지 않아 계획서만 "검증됨"이라고 말하게 된다.
 * ===================================================================*/

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

const failures = [];
function check(ok, label, detail = '') {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
    if (!ok) failures.push(label);
}

const VALID_PHASE_STATUS = new Set(['done', 'in-progress', 'planned']);
const VALID_ITEM_STATUS = new Set(['done', 'planned', 'already', 'dropped']);
const VALID_VALUE = new Set(['high', 'mid', 'low']);

(async () => {
    console.log('고도화 계획 정합성 게이트 — roadmap.json ↔ 저장소\n');

    const roadmapPath = path.join(ROOT, 'roadmap.json');
    if (!fs.existsSync(roadmapPath)) {
        console.error('FAIL  roadmap.json이 없습니다.');
        process.exit(1);
    }

    let roadmap;
    try {
        roadmap = JSON.parse(fs.readFileSync(roadmapPath, 'utf8'));
    } catch (err) {
        console.error(`FAIL  roadmap.json 파싱 실패: ${err.message}`);
        process.exit(1);
    }

    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    const changelog = JSON.parse(fs.readFileSync(path.join(ROOT, 'changelog.json'), 'utf8'));
    const knownVersions = new Set((changelog.versions || []).map(v => v.version));

    // ① 스키마
    check(roadmap.schemaVersion === 1, '① schemaVersion', String(roadmap.schemaVersion));
    check(typeof roadmap.updated === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(roadmap.updated),
        '① updated 날짜 형식', roadmap.updated);
    check(Array.isArray(roadmap.phases) && roadmap.phases.length > 0, '① phases 존재',
        `${(roadmap.phases || []).length}개`);
    check(!!roadmap.thesis?.from && !!roadmap.thesis?.to, '① thesis 존재');

    // ⑦ 상태 값
    const badPhaseStatus = (roadmap.phases || []).filter(p => !VALID_PHASE_STATUS.has(p.status));
    check(badPhaseStatus.length === 0, '⑦ 단계 상태 값',
        badPhaseStatus.map(p => `${p.id}=${p.status}`).join(', ') || [...VALID_PHASE_STATUS].join('|'));

    const badItemStatus = (roadmap.phases || [])
        .flatMap(p => (p.items || []).map(i => ({ p: p.id, ...i })))
        .filter(i => !VALID_ITEM_STATUS.has(i.status));
    check(badItemStatus.length === 0, '⑦ 항목 상태 값',
        badItemStatus.map(i => `${i.p}:${i.title}=${i.status}`).join(', ') || [...VALID_ITEM_STATUS].join('|'));

    // ② 완료 단계의 버전이 changelog에 있는가
    const missingVersions = [];
    for (const phase of roadmap.phases || []) {
        if (phase.status !== 'done') continue;
        for (const v of phase.versions || []) {
            if (!knownVersions.has(v)) missingVersions.push(`${phase.id}:${v}`);
        }
    }
    check(missingVersions.length === 0, '② 완료 단계 버전이 changelog에 존재',
        missingVersions.join(', ') || `${[...knownVersions].length}개 버전 대조`);

    // 완료 단계는 버전과 PR을 반드시 적는다 — 증거 없는 "완료"는 주장일 뿐이다
    const noEvidence = (roadmap.phases || [])
        .filter(p => p.status === 'done')
        .filter(p => !(p.versions || []).length || !(p.prs || []).length);
    check(noEvidence.length === 0, '② 완료 단계에 버전·PR 증거 존재',
        noEvidence.map(p => p.id).join(', ') || '전부 있음');

    // ③④⑤ 게이트
    const scripts = pkg.scripts || {};
    const releaseScript = scripts['test:release'] || '';

    const missingScripts = (roadmap.gates || []).filter(g => !scripts[g.script]);
    check(missingScripts.length === 0, '③ 적어둔 게이트가 package.json에 존재',
        missingScripts.map(g => g.script).join(', ') || `${(roadmap.gates || []).length}개 대조`);

    const notInRelease = (roadmap.gates || [])
        .filter(g => scripts[g.script])
        .filter(g => !releaseScript.includes(`npm run ${g.script}`));
    check(notInRelease.length === 0, '④ 게이트가 test:release에 편입됨',
        notInRelease.map(g => g.script).join(', ') || '전부 편입');

    const missingFiles = [];
    for (const g of roadmap.gates || []) {
        const cmd = scripts[g.script];
        if (!cmd) continue;
        // "node qa/xxx.js --flag && node tests/yyy.js" 형태에서 파일 경로만 뽑는다
        for (const m of cmd.matchAll(/node\s+([\w./-]+\.js)/g)) {
            if (!fs.existsSync(path.join(ROOT, m[1]))) missingFiles.push(`${g.script} → ${m[1]}`);
        }
    }
    check(missingFiles.length === 0, '⑤ 게이트 스크립트 파일 존재',
        missingFiles.join(', ') || '전부 존재');

    // 게이트에 since를 적었다면 그 버전도 실재해야 한다
    const badSince = (roadmap.gates || []).filter(g => g.since && !knownVersions.has(g.since));
    check(badSince.length === 0, '⑤ 게이트 도입 버전이 changelog에 존재',
        badSince.map(g => `${g.script}@${g.since}`).join(', ') || '전부 존재');

    // ⑥ 수동 확인 항목이 가리키는 문서
    const badDocs = [];
    for (const m of roadmap.manualVerification || []) {
        const file = String(m.where || '').split(/\s/)[0];
        if (!file) { badDocs.push(`${m.title}: where 없음`); continue; }
        if (!fs.existsSync(path.join(ROOT, file))) badDocs.push(`${m.title} → ${file}`);
    }
    check(badDocs.length === 0, '⑥ 수동 확인 항목의 참조 문서 존재',
        badDocs.join(', ') || `${(roadmap.manualVerification || []).length}건`);

    check((roadmap.manualVerification || []).length > 0,
        '⑥ 수동 확인 항목이 비어 있지 않음',
        '구조 게이트 통과는 시각 통과가 아니므로 항상 남아 있어야 한다');

    // ⑧ 후보 항목
    const candidates = roadmap.candidates || [];
    const badValue = candidates.filter(c => !VALID_VALUE.has(c.value) || !VALID_VALUE.has(c.effort));
    check(badValue.length === 0, '⑧ 후보의 value·effort 값',
        badValue.map(c => c.title).join(', ') || `${candidates.length}개`);

    const titles = new Set(candidates.map(c => c.title));
    const danglingBlocks = candidates
        .filter(c => c.blockedBy)
        .filter(c => !titles.has(c.blockedBy) && !/파서|설계|정책|결정|확장/.test(c.blockedBy));
    check(danglingBlocks.length === 0, '⑧ blockedBy가 실재하는 항목이나 명시적 선행 작업을 가리킴',
        danglingBlocks.map(c => `${c.title} → ${c.blockedBy}`).join(', ') || '전부 유효');

    console.log('');
    if (failures.length) {
        console.error(`고도화 계획 정합성 실패 ${failures.length}건: ${failures.join(', ')}`);
        console.error('roadmap.json이 저장소와 어긋났다. 계획서를 보고 판단하는 사람이 잘못된 판단을 하게 된다.');
        process.exit(1);
    }
    console.log('roadmap.json의 주장이 저장소와 일치한다.');
})().catch(err => {
    console.error('게이트 실행 실패:', err.message || err);
    process.exit(1);
});
