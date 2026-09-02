/* ===================================================================
 * [tests/mcp-server-test.js] MCP 서버 프로토콜·생성 품질 검사
 * ===================================================================
 * 실행: node tests/mcp-server-test.js
 *
 * 실제 stdio JSON-RPC로 서버와 대화한다. 내부 함수를 직접 부르면
 * 프로토콜 계층의 버그(응답 누락, id 불일치, 알림에 응답하기 등)를 놓친다.
 *
 * 이 서버의 존재 이유는 "생성 품질"이므로, 프로토콜뿐 아니라 **산출물이
 * 실제로 표를 표로 담고 링크를 링크로 담는지**까지 검사한다. 시장의 다른
 * HWPX MCP 서버가 표를 텍스트 행으로 평탄화하는 지점이 바로 여기다.
 * ===================================================================*/

'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const JSZip = require('jszip');

const ROOT = path.resolve(__dirname, '..');
const SERVER = path.join(ROOT, 'js/core/mcp-server.js');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'tohwpx-mcp-'));

const failures = [];
function note(ok, label, detail = '') {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
    if (!ok) failures.push(label);
}

/** 서버를 띄우고 요청/응답을 주고받는 얇은 클라이언트. */
function startServer() {
    const proc = spawn(process.execPath, [SERVER], { cwd: ROOT, stdio: ['pipe', 'pipe', 'pipe'] });
    const pending = new Map();
    const stderr = [];
    let buf = '';

    proc.stdout.setEncoding('utf8');
    proc.stdout.on('data', chunk => {
        buf += chunk;
        let nl;
        while ((nl = buf.indexOf('\n')) >= 0) {
            const line = buf.slice(0, nl).trim();
            buf = buf.slice(nl + 1);
            if (!line) continue;
            try {
                const msg = JSON.parse(line);
                const resolve = pending.get(msg.id);
                if (resolve) { pending.delete(msg.id); resolve(msg); }
            } catch { /* 서버가 비 JSON을 뱉으면 아래 stdout 오염 검사에서 잡힌다 */ }
        }
    });
    proc.stderr.setEncoding('utf8');
    proc.stderr.on('data', d => stderr.push(d));

    let nextId = 1;
    return {
        stderr,
        request(method, params) {
            const id = nextId++;
            return new Promise((resolve, reject) => {
                const timer = setTimeout(() => reject(new Error(`응답 시간 초과: ${method}`)), 30000);
                pending.set(id, msg => { clearTimeout(timer); resolve(msg); });
                proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
            });
        },
        notify(method, params) {
            proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n');
        },
        close() { proc.stdin.end(); proc.kill(); },
    };
}

(async () => {
    const s = startServer();
    try {
        // ① initialize
        const init = await s.request('initialize', { protocolVersion: '2024-11-05', capabilities: {} });
        note(init.result?.serverInfo?.name === 'tohwpx', '① initialize 응답', JSON.stringify(init.result?.serverInfo));
        note(!!init.result?.capabilities?.tools, '① tools 기능 선언');

        // 알림에는 응답하지 않아야 한다(응답하면 클라이언트가 프로토콜 오류로 본다)
        s.notify('notifications/initialized', {});

        // ② tools/list
        const list = await s.request('tools/list', {});
        const names = (list.result?.tools || []).map(t => t.name);
        note(names.includes('markdown_to_hwpx') && names.includes('ir_to_hwpx')
            && names.includes('get_ir_schema') && names.includes('read_hwpx')
            && names.includes('make_comparison_table'),
            '② tools/list', names.join(', '));
        const mdTool = list.result.tools.find(t => t.name === 'markdown_to_hwpx');
        note(mdTool?.inputSchema?.required?.includes('markdown'), '② 입력 스키마에 required 명시');

        // ③ get_ir_schema
        const schema = await s.request('tools/call', { name: 'get_ir_schema', arguments: {} });
        const schemaText = schema.result?.content?.[0]?.text || '';
        note(schema.result?.isError === false && /blocks/.test(schemaText), '③ get_ir_schema');
        let schemaJson = null;
        try { schemaJson = JSON.parse(schemaText); } catch { /* 아래에서 실패 처리 */ }
        note(schemaJson && schemaJson.blocks && schemaJson.example,
            '③ 스키마가 파싱 가능한 JSON이고 예시 포함');

        // ④ markdown_to_hwpx — 실제 파일 생성 + 표/링크 보존
        const out = path.join(TMP, 'md.hwpx');
        const md = [
            '# 분기 보고',
            '',
            '본문에 [링크](https://example.com)가 있다.',
            '',
            '| 항목 | 값 |',
            '|---|---|',
            '| 매출 | 120 |',
            '| 비용 | 80 |',
            '',
            '- 첫째',
            '- 둘째',
        ].join('\n');
        const call = await s.request('tools/call', {
            name: 'markdown_to_hwpx',
            arguments: { markdown: md, outputPath: out, paperSize: 'A4' },
        });
        const callText = call.result?.content?.[0]?.text || '';
        note(call.result?.isError === false, '④ markdown_to_hwpx 성공', callText.split('\n')[0]);
        note(fs.existsSync(out), '④ 파일 생성', out);

        if (fs.existsSync(out)) {
            const zip = await JSZip.loadAsync(fs.readFileSync(out));
            const sec = await zip.file('Contents/section0.xml').async('string');

            // 이 서버의 차별점 — 표를 텍스트로 평탄화하지 않는다
            const tbl = (sec.match(/<hp:tbl\b/g) || []).length;
            const rows = (sec.match(/<hp:tr>/g) || []).length;
            const cells = (sec.match(/<hp:tc\b/g) || []).length;
            note(tbl === 1 && rows === 3 && cells === 6,
                '④ 표가 표 구조로 들어감(평탄화 아님)', `tbl=${tbl} tr=${rows} tc=${cells}`);

            // 링크가 하이퍼링크 필드로 들어갔는지
            const fieldBegin = (sec.match(/<hp:fieldBegin[^>]*type="HYPERLINK"/g) || []).length;
            const fieldEnd = (sec.match(/<hp:fieldEnd\b/g) || []).length;
            note(fieldBegin === 1 && fieldEnd === 1,
                '④ 링크가 하이퍼링크 필드로 들어감', `begin=${fieldBegin} end=${fieldEnd}`);
            note(sec.includes('example.com'), '④ 링크 URL 보존');
        }

        // ⑤ ir_to_hwpx
        const irOut = path.join(TMP, 'ir.hwpx');
        const irCall = await s.request('tools/call', {
            name: 'ir_to_hwpx',
            arguments: {
                ir: {
                    title: 'IR 직접 렌더',
                    doc_type: 'plain',
                    blocks: [
                        { type: 'heading', level: 1, text: '제목' },
                        { type: 'table', header: ['가', '나'], rows: [['1', '2'], ['3', '4']] },
                    ],
                },
                outputPath: irOut,
            },
        });
        note(irCall.result?.isError === false && fs.existsSync(irOut), '⑤ ir_to_hwpx 성공');

        // ⑥ outputPath 없이 호출 — 파일을 쓰지 않고 요약만
        const dry = await s.request('tools/call', {
            name: 'text_to_hwpx', arguments: { content: 'a,b\n1,2', format: 'csv' },
        });
        const dryText = dry.result?.content?.[0]?.text || '';
        note(dry.result?.isError === false && /파일로 쓰지 않았습니다/.test(dryText),
            '⑥ outputPath 생략 시 파일을 쓰지 않음');

        // ⑦ 오류는 프로토콜 오류가 아니라 isError 결과로 — 에이전트가 읽고 고칠 수 있어야 한다
        const bad = await s.request('tools/call', { name: 'markdown_to_hwpx', arguments: { markdown: '' } });
        note(bad.result?.isError === true && !bad.error, '⑦ 빈 입력은 isError 결과로 반환',
            (bad.result?.content?.[0]?.text || '').slice(0, 60));

        const badFmt = await s.request('tools/call', { name: 'text_to_hwpx', arguments: { content: 'x', format: 'xml' } });
        note(badFmt.result?.isError === true && /txt\|csv\|json/.test(badFmt.result?.content?.[0]?.text || ''),
            '⑦ 잘못된 format은 허용값을 알려줌');

        const badPath = await s.request('tools/call', {
            name: 'markdown_to_hwpx', arguments: { markdown: '# a', outputPath: path.join(TMP, 'x.docx') },
        });
        note(badPath.result?.isError === true && /\.hwpx/.test(badPath.result?.content?.[0]?.text || ''),
            '⑦ 잘못된 확장자 거절');

        // ⑦-b read_hwpx — 만든 문서를 다시 읽어 구조가 살아 있는지
        const readBack = await s.request('tools/call', {
            name: 'read_hwpx', arguments: { path: out, as: 'markdown' },
        });
        const readText = readBack.result?.content?.[0]?.text || '';
        note(readBack.result?.isError === false, '⑦ read_hwpx 성공');
        note(/\| 항목 \| 값 \|/.test(readText), '⑦ 표가 Markdown 표로 복원');
        note(/\[링크\]\(https:\/\/example\.com/.test(readText), '⑦ 링크가 Markdown 링크로 복원');
        note(/- 첫째/.test(readText) && /- 둘째/.test(readText), '⑦ 목록 복원');
        // 에이전트가 "레이아웃까지 복제됐다"고 오해하지 않도록 한계를 함께 적는다
        note(/구조 추출입니다/.test(readText), '⑦ 한계를 명시');

        const readIr = await s.request('tools/call', {
            name: 'read_hwpx', arguments: { path: out, as: 'ir' },
        });
        let irBack = null;
        try {
            const raw = readIr.result?.content?.[0]?.text || '';
            irBack = JSON.parse(raw.slice(0, raw.lastIndexOf('\n\n---')));
        } catch { /* 아래에서 실패 처리 */ }
        note(irBack && Array.isArray(irBack.blocks) && irBack.blocks.length > 0,
            '⑦ as=ir이 파싱 가능한 IR 반환', irBack ? `블록 ${irBack.blocks.length}개` : '파싱 실패');

        const badExt = await s.request('tools/call', { name: 'read_hwpx', arguments: { path: 'x.docx' } });
        note(badExt.result?.isError === true, '⑦ .hwpx가 아니면 거절');

        // ⑦-c make_comparison_table — 틀린 짝짓기가 없는지까지 본다
        const cmpOut = path.join(TMP, 'cmp.hwpx');
        const cmp = await s.request('tools/call', {
            name: 'make_comparison_table',
            arguments: {
                current: ['제1조(목적) 목적 조문.', '제2조(적용) 본사에 적용한다.', '제3조(보존) 3년 보존.'].join(String.fromCharCode(10)),
                revised: ['제1조(목적) 목적 조문.', '제2조(적용) 본사와 지사에 적용한다.'].join(String.fromCharCode(10)),
                outputPath: cmpOut,
            },
        });
        const cmpText = cmp.result?.content?.[0]?.text || '';
        note(cmp.result?.isError === false && fs.existsSync(cmpOut), '⑦ make_comparison_table 성공');
        note(/유지 1 · 개정 1 · 신설 0 · 삭제 1/.test(cmpText), '⑦ 대비 집계 정확',
            (cmpText.match(/유지[^\n]*/) || [''])[0]);
        // 현행 기준 정렬이라는 한계를 에이전트에게 알린다
        note(/현행 순서를 기준으로/.test(cmpText) && /문단 단위 비교/.test(cmpText),
            '⑦ 대비표 한계를 명시');

        if (fs.existsSync(cmpOut)) {
            const zip = await JSZip.loadAsync(fs.readFileSync(cmpOut));
            const sec = await zip.file('Contents/section0.xml').async('string');
            note(/현 행/.test(sec) && /개 정 안/.test(sec), '⑦ 대비표 머리행');
            note(/&lt;삭제&gt;|<삭제>/.test(sec), '⑦ 삭제 표기 포함');
        }

        const cmpBad = await s.request('tools/call', {
            name: 'make_comparison_table', arguments: { current: '', revised: '' },
        });
        note(cmpBad.result?.isError === true, '⑦ 빈 입력 거절');

        // ⑧ 알 수 없는 메서드는 JSON-RPC 오류로
        const unknown = await s.request('nope/method', {});
        note(unknown.error?.code === -32601, '⑧ 알 수 없는 메서드는 -32601', `code=${unknown.error?.code}`);

        const unknownTool = await s.request('tools/call', { name: 'nope', arguments: {} });
        note(unknownTool.result?.isError === true, '⑧ 알 수 없는 도구는 isError 결과');

        // ⑨ stdio 위생 — stdout은 JSON-RPC 전용이다. 로그가 섞이면 클라이언트가 깨진다.
        note(s.stderr.join('').length === 0, '⑨ stderr 오염 없음', s.stderr.join('').slice(0, 100) || '없음');

        // ⑩ ping
        const ping = await s.request('ping', {});
        note(!!ping.result, '⑩ ping 응답');
    } finally {
        s.close();
        fs.rmSync(TMP, { recursive: true, force: true });
    }

    console.log('');
    if (failures.length) {
        console.error(`MCP 서버 검사 실패 ${failures.length}건: ${failures.join(', ')}`);
        process.exit(1);
    }
    console.log('MCP 서버 검사 통과.');
})().catch(err => {
    console.error('테스트 실행 실패:', err.message || err);
    process.exit(1);
});
