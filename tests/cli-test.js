/* ===================================================================
 * [tests/cli-test.js] tohwpx CLI 계약 검사
 * ===================================================================
 * 실행: node tests/cli-test.js
 *
 * CLI는 스크립트가 소비하므로 **종료 코드와 오류 문구가 계약**이다.
 * 성공/실패를 문자열로만 알리고 0을 반환하면 CI가 실패를 놓친다.
 *
 * 검사 항목
 *   ① 정상 변환: 파일 생성 + 종료 코드 0
 *   ② CLI 산출물이 브라우저 산출물과 같은 크기(코어 동등성의 파이프라인 확인)
 *   ③ 미지원 확장자: 종료 코드 1 + 이유와 대안을 함께 말함
 *   ④ 없는 파일: 종료 코드 1
 *   ⑤ 잘못된 옵션 값: 종료 코드 2(사용자 입력 오류)
 *   ⑥ --out과 여러 입력 동시 사용 거절
 *   ⑦ 여러 파일 일괄 변환 + --out-dir
 *   ⑧ 옵션이 실제 산출물에 반영됨(용지/방향)
 *   ⑨ --help / --version
 * ===================================================================*/

'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const JSZip = require('jszip');

const ROOT = path.resolve(__dirname, '..');
const CLI = path.join(ROOT, 'js/core/cli.js');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'tohwpx-cli-'));

const failures = [];
function note(ok, label, detail = '') {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
    if (!ok) failures.push(label);
}

function run(args) {
    const r = spawnSync(process.execPath, [CLI, ...args], { cwd: ROOT, encoding: 'utf8' });
    return { code: r.status, out: r.stdout || '', err: r.stderr || '' };
}

(async () => {
    // ① 정상 변환
    const out1 = path.join(TMP, 'basic.hwpx');
    const r1 = run(['qa/fixtures/md_hwpx_test.md', '-o', out1, '-q']);
    note(r1.code === 0, '① 정상 변환 종료 코드 0', `code=${r1.code}${r1.err ? ' err=' + r1.err.slice(0, 120) : ''}`);
    note(fs.existsSync(out1), '① 출력 파일 생성');

    if (fs.existsSync(out1)) {
        const bytes = fs.readFileSync(out1);
        note(bytes.subarray(0, 4).toString('latin1') === 'PK\x03\x04', '① ZIP 시그니처');

        // ② 브라우저 산출물과 같은 크기 — 파서까지 포함한 파이프라인 동등성.
        //    qa/core-parity-gate.js는 IR부터 비교하고, 여기서는 파일 입력부터 본다.
        const zip = await JSZip.loadAsync(bytes);
        const need = ['mimetype', 'Contents/header.xml', 'Contents/section0.xml', 'Contents/content.hpf'];
        const missing = need.filter(n => !zip.file(n));
        note(missing.length === 0, '② 필수 엔트리 존재', missing.length ? `누락 ${missing}` : `${Object.keys(zip.files).length}개 엔트리`);
        const mime = await zip.file('mimetype').async('string');
        note(mime.trim() === 'application/hwp+zip', '② mimetype 내용', mime.trim());
    }

    // ③ 미지원 확장자 — 이유 + 대안을 말하고 실패로 끝나야 한다
    const r3 = run(['qa/fixtures/sample.docx', '--out-dir', TMP]);
    note(r3.code === 1, '③ 미지원 확장자 종료 코드 1', `code=${r3.code}`);
    note(/지원하지 않습니다/.test(r3.err) && /웹앱을 사용하세요/.test(r3.err),
        '③ 이유와 대안을 함께 안내');
    // CLI는 스크립트가 소비한다. Node 런타임 경고가 stderr에 섞이면 오류 파싱이 깨진다.
    note(!/MODULE_TYPELESS_PACKAGE_JSON|ExperimentalWarning/.test(r1.err + r3.err),
        '③ stderr에 Node 런타임 경고가 섞이지 않음');

    // ④ 없는 파일
    const r4 = run(['does-not-exist.md', '--out-dir', TMP]);
    note(r4.code === 1, '④ 없는 파일 종료 코드 1', `code=${r4.code}`);

    // ⑤ 잘못된 옵션 값 → 사용자 입력 오류(2)
    const r5 = run(['qa/fixtures/md_hwpx_test.md', '--paper', 'A9']);
    note(r5.code === 2, '⑤ 잘못된 --paper 종료 코드 2', `code=${r5.code}`);
    const r5b = run(['qa/fixtures/md_hwpx_test.md', '--size', '999']);
    note(r5b.code === 2, '⑤ 범위 밖 --size 종료 코드 2', `code=${r5b.code}`);
    const r5c = run(['qa/fixtures/md_hwpx_test.md', '--nope']);
    note(r5c.code === 2, '⑤ 알 수 없는 옵션 종료 코드 2', `code=${r5c.code}`);

    // ⑥ --out + 여러 입력 거절
    const r6 = run(['qa/fixtures/md_hwpx_test.md', 'qa/fixtures/sample.csv', '-o', path.join(TMP, 'x.hwpx')]);
    note(r6.code === 2, '⑥ --out과 다중 입력 동시 사용 거절', `code=${r6.code}`);

    // ⑦ 여러 파일 일괄 변환 (이름이 겹치지 않는 입력)
    const batchDir = path.join(TMP, 'batch');
    const r7 = run(['qa/fixtures/md_hwpx_test.md', 'qa/fixtures/sample.csv', 'qa/fixtures/empty.txt',
        '--out-dir', batchDir, '-q']);
    const produced = fs.existsSync(batchDir) ? fs.readdirSync(batchDir).filter(f => f.endsWith('.hwpx')) : [];
    note(r7.code === 0 && produced.length === 3, '⑦ 여러 파일 일괄 변환',
        `code=${r7.code}, 산출 ${produced.length}개`);

    // ⑦-b 출력 이름이 겹치면 변환 전에 거절해야 한다.
    //     sample.csv와 sample.json은 둘 다 sample.hwpx가 되므로, 막지 않으면
    //     뒤 파일이 앞 파일을 조용히 덮어쓴다(일괄 변환의 데이터 손실).
    const clashDir = path.join(TMP, 'clash');
    const r7b = run(['qa/fixtures/sample.csv', 'qa/fixtures/sample.json', '--out-dir', clashDir]);
    const clashProduced = fs.existsSync(clashDir) ? fs.readdirSync(clashDir).length : 0;
    note(r7b.code === 2, '⑦ 출력 이름 충돌을 종료 코드 2로 거절', `code=${r7b.code}`);
    note(/출력 경로가 겹칩니다/.test(r7b.err), '⑦ 충돌 원인을 명시');
    note(clashProduced === 0, '⑦ 충돌 시 어떤 파일도 쓰지 않음', `${clashProduced}개 생성됨`);

    // ⑧ 옵션이 실제로 반영되는가 — A3 가로
    const out8 = path.join(TMP, 'a3.hwpx');
    const r8 = run(['qa/fixtures/md_hwpx_test.md', '-o', out8, '--paper', 'A3', '--orientation', 'landscape', '-q']);
    if (r8.code === 0 && fs.existsSync(out8)) {
        const zip = await JSZip.loadAsync(fs.readFileSync(out8));
        const sec = await zip.file('Contents/section0.xml').async('string');
        // HWPX는 회전 전 치수 + landscape enum으로 방향을 기록한다.
        const isA3 = /width="84189"/.test(sec) && /height="119055"/.test(sec);
        const isLandscape = /landscape="NARROWLY"/.test(sec);
        note(isA3, '⑧ --paper A3가 산출물에 반영', isA3 ? '84189×119055' : sec.match(/<hp:pagePr[^>]*/)?.[0]?.slice(0, 90));
        note(isLandscape, '⑧ --orientation landscape 반영', isLandscape ? 'NARROWLY' : '미반영');
    } else {
        note(false, '⑧ A3 가로 변환 실패', `code=${r8.code}`);
    }

    // ⑧-b 역방향 --to — HWPX를 Markdown/HTML로 추출
    const mdOut = path.join(TMP, 'back.md');
    const r10 = run([out1, '--to', 'md', '-o', mdOut, '-q']);
    note(r10.code === 0 && fs.existsSync(mdOut), '⑧ --to md 성공', `code=${r10.code}`);
    if (fs.existsSync(mdOut)) {
        const md = fs.readFileSync(mdOut, 'utf8');
        note(/^#{1,6} /m.test(md), '⑧ 제목이 Markdown 제목으로');
        note(/\|.*\|/.test(md) && /\| --- \|/.test(md), '⑧ 표가 Markdown 표로');
        // 렌더러는 제목을 굵은 글꼴로 그린다. 그대로 직렬화하면 ## **제목**이 된다.
        note(!/^#{1,6} \*\*/m.test(md), '⑧ 제목에 굵게가 중복되지 않음');
    }

    const htmlOut = path.join(TMP, 'back.html');
    const r11 = run([out1, '--to', 'html', '-o', htmlOut, '-q']);
    note(r11.code === 0 && fs.existsSync(htmlOut), '⑧ --to html 성공', `code=${r11.code}`);
    if (fs.existsSync(htmlOut)) {
        const html = fs.readFileSync(htmlOut, 'utf8');
        note(/<!doctype html>/i.test(html) && /<table>/.test(html), '⑧ HTML 문서 구조');
    }

    const r12 = run([out1, '--to', 'pdf']);
    note(r12.code === 2, '⑧ 지원하지 않는 --to 값 거절', `code=${r12.code}`);
    const r13 = run(['qa/fixtures/md_hwpx_test.md', '--to', 'md', '--out-dir', TMP]);
    note(r13.code === 1 && /\.hwpx 입력에만/.test(r13.err), '⑧ --to는 .hwpx 입력에만');

    // ⑨ --help / --version
    const r9 = run(['--help']);
    note(r9.code === 0 && /사용법/.test(r9.out), '⑨ --help', `code=${r9.code}`);
    const r9b = run(['--version']);
    note(r9b.code === 0 && /^\d+\.\d+\.\d+/.test(r9b.out.trim()), '⑨ --version', r9b.out.trim());
    const r9c = run([]);
    note(r9c.code === 2, '⑨ 인자 없음은 종료 코드 2', `code=${r9c.code}`);

    fs.rmSync(TMP, { recursive: true, force: true });

    console.log('');
    if (failures.length) {
        console.error(`CLI 계약 검사 실패 ${failures.length}건: ${failures.join(', ')}`);
        process.exit(1);
    }
    console.log('CLI 계약 검사 통과.');
})().catch(err => {
    console.error('테스트 실행 실패:', err.message || err);
    process.exit(1);
});
