#!/usr/bin/env node
/* ===================================================================
 * [core/mcp-server.js] tohwpx MCP 서버 — HWPX 생성 전용
 * ===================================================================
 * AI 에이전트가 한/글 설치 없이 HWPX를 **만들도록** 하는 서버다.
 *
 * 이 서버가 다른 HWP/HWPX MCP 서버와 다른 점은 범위가 좁다는 것이다.
 * 읽기·편집 도구를 늘리는 대신, 생성 품질 하나만 보증한다.
 *   - 표를 텍스트 행으로 평탄화하지 않는다(셀 병합·머리행 유지).
 *   - 링크를 표시 문자열로 죽이지 않는다(hp:fieldBegin 하이퍼링크).
 *   - 그림을 BinData·manifest·content.hpf까지 연결해 넣는다.
 *   - 모든 산출물을 패키지 검증기에 통과시킨 뒤에만 돌려준다.
 *
 * 웹앱과 **같은 렌더러**를 쓰며, 동등성은 qa/core-parity-gate.js가 지킨다.
 *
 * 프로토콜: MCP stdio, JSON-RPC 2.0. 외부 SDK에 의존하지 않는다
 * (이 저장소는 공급망을 최소로 유지한다 — vendor 해시를 게이트가 검사한다).
 *
 * 실행:  node js/core/mcp-server.js
 * 등록:  { "mcpServers": { "tohwpx": { "command": "node",
 *          "args": ["<경로>/js/core/mcp-server.js"] } } }
 * ===================================================================*/

'use strict';

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

if (typeof globalThis.marked === 'undefined') {
    globalThis.marked = require('../vendor/marked-18.0.11.min.js');
}

const { irToHwpx } = await import('./index.js');
const { parseMd, parseCsv, parseJson, parseTxt } = await import('../parsers.js');

const VERSION = require('../../package.json').version;
const PROTOCOL_VERSION = '2024-11-05';

// ─────────────────────────────────────────────────────────────────────────
// [도구 정의]
// ─────────────────────────────────────────────────────────────────────────

const RENDER_OPTION_SCHEMA = {
    fontName: { type: 'string', description: '글꼴 이름. 한컴이 매칭하는 패밀리명을 쓴다(기본: 휴먼명조).' },
    fontSize: { type: 'number', description: '기본 글자 크기 pt (기본 12, 범위 6~72)' },
    paperSize: { type: 'string', enum: ['A4', 'A3', 'B5', 'Letter'], description: '용지 (기본 A4)' },
    orientation: { type: 'string', enum: ['portrait', 'landscape'], description: '방향 (기본 portrait)' },
    lineSpacingPercent: { type: 'number', description: '줄 간격 % (기본 160, 범위 50~500)' },
    showHorizontalRules: { type: 'boolean', description: '가로 구분선을 선으로 출력 (기본 false)' },
};

const TOOLS = [
    {
        name: 'markdown_to_hwpx',
        description:
            'Markdown 문자열을 HWPX(한글) 파일로 만든다. 표·목록·코드블록·링크·각주를 구조로 보존한다. '
            + '표를 텍스트로 평탄화하지 않는다. 결과는 패키지 검증을 통과한 것만 반환한다.',
        inputSchema: {
            type: 'object',
            properties: {
                markdown: { type: 'string', description: '변환할 Markdown 본문' },
                outputPath: { type: 'string', description: '저장할 .hwpx 경로. 생략하면 파일을 쓰지 않고 요약만 반환한다.' },
                title: { type: 'string', description: '문서 제목. 생략하면 첫 H1을 쓴다.' },
                ...RENDER_OPTION_SCHEMA,
            },
            required: ['markdown'],
        },
    },
    {
        name: 'text_to_hwpx',
        description:
            '평문·CSV/TSV·JSON 문자열을 HWPX로 만든다. format으로 해석 방식을 고른다. '
            + 'CSV/TSV는 표로, JSON은 구조를 유지한 형태로 들어간다.',
        inputSchema: {
            type: 'object',
            properties: {
                content: { type: 'string', description: '변환할 본문' },
                format: { type: 'string', enum: ['txt', 'csv', 'json'], description: '해석 방식' },
                outputPath: { type: 'string', description: '저장할 .hwpx 경로. 생략하면 요약만 반환한다.' },
                title: { type: 'string', description: '문서 제목' },
                ...RENDER_OPTION_SCHEMA,
            },
            required: ['content', 'format'],
        },
    },
    {
        name: 'ir_to_hwpx',
        description:
            '공통 IR(JSON)을 직접 HWPX로 렌더한다. 문단·제목·표·목록·코드·인용·그림을 정밀 제어할 때 쓴다. '
            + 'get_ir_schema로 스키마를 먼저 확인하라.',
        inputSchema: {
            type: 'object',
            properties: {
                ir: { type: 'object', description: '{title, doc_type, blocks:[...]} 형태의 IR' },
                outputPath: { type: 'string', description: '저장할 .hwpx 경로. 생략하면 요약만 반환한다.' },
                ...RENDER_OPTION_SCHEMA,
            },
            required: ['ir'],
        },
    },
    {
        name: 'get_ir_schema',
        description:
            'ir_to_hwpx가 받는 IR 스키마와 블록 종류별 예시를 반환한다. IR을 직접 만들기 전에 호출하라.',
        inputSchema: { type: 'object', properties: {} },
    },
];

const IR_SCHEMA_DOC = {
    description: 'To-Hwpx 공통 IR. 입력 포맷과 무관하게 같은 IR은 같은 HWPX를 만든다.',
    root: {
        title: 'string — 문서 제목(표지/미리보기에 쓰인다)',
        doc_type: "'plain' | 'titleblock' — titleblock은 상단 제목 블록을 만든다",
        blocks: 'Block[] — 본문 블록 배열',
    },
    blocks: {
        heading: { type: 'heading', level: '1~4', text: 'string' },
        para: {
            type: 'para',
            text: 'string — 평문일 때',
            runs: "Run[] — 서식이 있을 때. {text, bold, italic, code, underline, strike, color, href, title}",
        },
        list: {
            type: 'list',
            ordered: 'boolean',
            items: "Item[] — {text, runs?, level?(0부터), task?, checked?}",
        },
        table: {
            type: 'table',
            header: 'Cell[] — 머리행(생략 가능)',
            rows: 'Cell[][] — 본문 행',
            note: "Cell은 문자열이거나 {text, runs?, colSpan?, rowSpan?, bg?, color?}",
        },
        code: { type: 'code', text: 'string', lang: 'string(선택)' },
        quote: { type: 'quote', text: 'string' },
        image: {
            type: 'image',
            binName: 'string — BinData 안 파일명(예: img1.png)',
            mimeType: 'image/png | image/jpeg | image/gif | image/bmp',
            data: 'Uint8Array | base64 문자열',
            widthHwp: 'number', heightHwp: 'number', alt: 'string(선택)',
        },
        hr: { type: 'hr' },
        blank: { type: 'blank' },
    },
    notes: [
        '링크는 run의 href로 넣는다. http/https/mailto만 활성화된다.',
        '표 셀 안의 링크는 현재 계약상 미지원이다(의도적 보류).',
        'HWPUNIT: 1pt = 100, 1mm ≈ 283.465',
    ],
    example: {
        title: '분기 보고',
        doc_type: 'plain',
        blocks: [
            { type: 'heading', level: 1, text: '1. 개요' },
            { type: 'para', runs: [{ text: '자세한 내용은 ' }, { text: '문서', href: 'https://example.com' }, { text: '를 보라.' }] },
            { type: 'table', header: ['항목', '값'], rows: [['매출', '120'], ['비용', '80']] },
        ],
    },
};

// ─────────────────────────────────────────────────────────────────────────
// [도구 실행]
// ─────────────────────────────────────────────────────────────────────────

function pickRenderOptions(args) {
    const o = {};
    if (args.fontName) o.fontName = String(args.fontName);
    if (Number.isFinite(args.fontSize)) o.fontSize = args.fontSize;
    if (args.paperSize) o.paperSize = String(args.paperSize);
    if (args.orientation) o.orientation = String(args.orientation);
    if (Number.isFinite(args.lineSpacingPercent)) o.lineSpacingPercent = args.lineSpacingPercent;
    o.options = { showHorizontalRules: args.showHorizontalRules === true };
    return o;
}

/** IR 안의 base64 이미지 데이터를 Uint8Array로 되돌린다(JSON-RPC는 바이트를 못 싣는다). */
function reviveImageData(ir) {
    if (!ir || !Array.isArray(ir.blocks)) return ir;
    for (const b of ir.blocks) {
        if (b && b.type === 'image' && typeof b.data === 'string') {
            const base64 = b.data.replace(/^data:[^,]*,/, '');
            b.data = new Uint8Array(Buffer.from(base64, 'base64'));
        }
    }
    return ir;
}

/** 출력 경로를 검증한다. 확장자와 디렉터리 존재 여부를 먼저 본다. */
function resolveOutputPath(outputPath) {
    const abs = path.resolve(outputPath);
    if (!/\.hwpx$/i.test(abs)) {
        throw new Error(`outputPath는 .hwpx로 끝나야 합니다: ${outputPath}`);
    }
    return abs;
}

async function renderAndReport(ir, args, sourceLabel) {
    if (args.title) ir.title = String(args.title);

    const { bytes, validation } = await irToHwpx(ir, pickRenderOptions(args));

    // 검증에 실패한 산출물은 파일로 쓰지 않는다. 에이전트가 "성공"으로 읽고
    // 다음 단계로 넘어가면 깨진 문서가 사람 손에 들어간다.
    if (!validation.pass) {
        return {
            isError: true,
            text: `HWPX 구조 검증에 실패해 파일을 만들지 않았습니다.\n`
                + validation.issues.map(i => `  - ${i}`).join('\n'),
        };
    }

    const m = validation.metrics || {};
    const lines = [
        `HWPX 생성 완료 (${sourceLabel})`,
        `  크기      ${bytes.length.toLocaleString()} bytes`,
        `  문단      ${m.paragraphs ?? 0}`,
        `  표        ${m.tables ?? 0} (행 ${m.rows ?? 0}, 셀 ${m.cells ?? 0})`,
        `  줄바꿈    ${m.lineBreaks ?? 0}`,
        `  구조 검증 통과`,
    ];

    if (args.outputPath) {
        const abs = resolveOutputPath(args.outputPath);
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        fs.writeFileSync(abs, bytes);
        lines.push(`  저장      ${abs}`);
    } else {
        lines.push(`  (outputPath를 주지 않아 파일로 쓰지 않았습니다)`);
    }

    lines.push('', '구조 검증은 한컴에서 실제로 보이는지까지는 보증하지 않습니다. 최종 확인은 한컴오피스에서 하세요.');
    return { isError: false, text: lines.join('\n') };
}

async function callTool(name, args = {}) {
    switch (name) {
        case 'markdown_to_hwpx': {
            if (typeof args.markdown !== 'string' || !args.markdown.trim()) {
                throw new Error('markdown이 비어 있습니다.');
            }
            return await renderAndReport(parseMd(args.markdown, 'plain'), args, 'Markdown');
        }
        case 'text_to_hwpx': {
            if (typeof args.content !== 'string' || !args.content.trim()) {
                throw new Error('content가 비어 있습니다.');
            }
            const parser = { txt: parseTxt, csv: parseCsv, json: parseJson }[args.format];
            if (!parser) throw new Error(`format은 txt|csv|json 중 하나여야 합니다: ${args.format}`);
            return await renderAndReport(parser(args.content, 'plain'), args, args.format.toUpperCase());
        }
        case 'ir_to_hwpx': {
            if (!args.ir || !Array.isArray(args.ir.blocks)) {
                throw new Error('ir.blocks 배열이 필요합니다. get_ir_schema를 먼저 호출하세요.');
            }
            return await renderAndReport(reviveImageData(args.ir), args, 'IR');
        }
        case 'get_ir_schema':
            return { isError: false, text: JSON.stringify(IR_SCHEMA_DOC, null, 2) };
        default:
            throw new Error(`알 수 없는 도구: ${name}`);
    }
}

// ─────────────────────────────────────────────────────────────────────────
// [JSON-RPC over stdio]
// ─────────────────────────────────────────────────────────────────────────

function send(msg) {
    process.stdout.write(JSON.stringify(msg) + '\n');
}

function reply(id, result) { send({ jsonrpc: '2.0', id, result }); }
function replyError(id, code, message) { send({ jsonrpc: '2.0', id, error: { code, message } }); }

async function handle(msg) {
    const { id, method, params } = msg;

    // 알림(notification)은 id가 없다 — 응답하지 않는다.
    const isNotification = id === undefined || id === null;

    try {
        switch (method) {
            case 'initialize':
                return reply(id, {
                    protocolVersion: PROTOCOL_VERSION,
                    capabilities: { tools: {} },
                    serverInfo: { name: 'tohwpx', version: VERSION },
                });

            case 'notifications/initialized':
            case 'initialized':
                return;

            case 'tools/list':
                return reply(id, { tools: TOOLS });

            case 'tools/call': {
                const { name, arguments: args } = params || {};
                const r = await callTool(name, args || {});
                return reply(id, {
                    content: [{ type: 'text', text: r.text }],
                    isError: r.isError === true,
                });
            }

            case 'ping':
                return reply(id, {});

            default:
                if (isNotification) return;
                return replyError(id, -32601, `지원하지 않는 메서드: ${method}`);
        }
    } catch (err) {
        if (isNotification) return;
        // 도구 실행 오류는 프로토콜 오류가 아니라 결과로 돌려준다 —
        // 그래야 에이전트가 원인을 읽고 스스로 고칠 수 있다.
        if (method === 'tools/call') {
            return reply(id, {
                content: [{ type: 'text', text: `오류: ${err.message || err}` }],
                isError: true,
            });
        }
        return replyError(id, -32603, err.message || String(err));
    }
}

let buffer = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => {
    buffer += chunk;
    let nl;
    while ((nl = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line) continue;
        let msg;
        try {
            msg = JSON.parse(line);
        } catch {
            replyError(null, -32700, 'JSON 파싱 실패');
            continue;
        }
        handle(msg);
    }
});

process.stdin.on('end', () => process.exit(0));
