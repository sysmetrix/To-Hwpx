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

const { irToHwpx, ensureNodeRuntime } = await import('./index.js');
const { parseMd, parseCsv, parseJson, parseTxt } = await import('../parsers.js');
const { hwpxToIr, coalesceBlocks } = await import('./hwpx-to-ir.js');
const { TEXT_EXPORTERS } = await import('./ir-to-text.js');
const { parsePdf } = await import('../pdf-parser.js');
const { buildComparisonTable } = await import('../diff-table.js');

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
        name: 'pdf_to_hwpx',
        description:
            'PDF를 HWPX로 변환한다. PDF는 글자 좌표만 담는 레이아웃 형식이라 문단·제목·표를 '
            + '글자 크기와 좌표로 **추론**한다. 원본 복제가 아니며, 추론에 쓴 근거를 결과에 함께 돌려준다. '
            + '그림·셀 병합·글자 서식은 가져오지 않는다. 원본 문서 파일이 있으면 그쪽이 항상 더 정확하다.',
        inputSchema: {
            type: 'object',
            properties: {
                path: { type: 'string', description: '변환할 .pdf 파일 경로' },
                outputPath: { type: 'string', description: '저장할 .hwpx 경로. 생략하면 요약만 반환한다.' },
                title: { type: 'string', description: '문서 제목' },
                ...RENDER_OPTION_SCHEMA,
            },
            required: ['path'],
        },
    },
    {
        name: 'read_hwpx',
        description:
            'HWPX 파일을 읽어 Markdown·HTML·IR(JSON) 중 하나로 반환한다. 표는 표로, 링크는 링크로, '
            + '목록은 중첩·순서·체크 상태까지 유지한다. 문서를 읽고 고쳐 다시 쓰는 작업의 첫 단계로 쓴다.',
        inputSchema: {
            type: 'object',
            properties: {
                path: { type: 'string', description: '읽을 .hwpx 파일 경로' },
                as: {
                    type: 'string',
                    enum: ['markdown', 'html', 'ir'],
                    description: '반환 형식 (기본 markdown)',
                },
                maxChars: {
                    type: 'number',
                    description: '반환 문자 수 상한(기본 60000). 넘으면 잘린 사실을 함께 알린다.',
                },
            },
            required: ['path'],
        },
    },
    {
        name: 'make_comparison_table',
        description:
            '현행과 개정안을 비교해 신구조문대비표(HWPX)를 만든다. 현행 순서를 기준으로 정렬하고, '
            + '새 항목은 현행 칸에 <신설>, 없앤 항목은 개정안 칸에 <삭제>로 표시한다. '
            + '조문 번호(제N조)가 같으면 같은 조문의 개정으로 짝짓고, 번호가 없으면 문장 유사도로 판단한다. '
            + '문단 단위 비교이며 조·항·호 단위 대비는 하지 않는다.',
        inputSchema: {
            type: 'object',
            properties: {
                current: { type: 'string', description: '현행 본문(줄바꿈으로 구분)' },
                revised: { type: 'string', description: '개정안 본문(줄바꿈으로 구분)' },
                outputPath: { type: 'string', description: '저장할 .hwpx 경로. 생략하면 요약만 반환한다.' },
                title: { type: 'string', description: '문서 제목 (기본: 신구조문대비표)' },
                changedOnly: { type: 'boolean', description: 'true면 바뀐 항목만 표에 담는다 (기본 false)' },
                ...RENDER_OPTION_SCHEMA,
            },
            required: ['current', 'revised'],
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

/**
 * HWPX를 읽어 텍스트 형식으로 돌려준다.
 *
 * 레이아웃 복제가 아니라 **구조 추출**이다. 에이전트가 오해하지 않도록
 * 그림처럼 바이트를 함께 주지 않는 항목은 결과에 명시한다.
 */
async function readHwpxTool(args) {
    if (typeof args.path !== 'string' || !args.path.trim()) {
        throw new Error('path가 필요합니다.');
    }
    const abs = path.resolve(args.path);
    if (!/\.hwpx$/i.test(abs)) throw new Error(`.hwpx 파일이 아닙니다: ${args.path}`);
    if (!fs.existsSync(abs)) throw new Error(`파일이 없습니다: ${abs}`);

    ensureNodeRuntime();
    let parseXml;
    try {
        const { DOMParser } = require('@xmldom/xmldom');
        parseXml = (xml) => new DOMParser().parseFromString(xml, 'text/xml');
    } catch {
        throw new Error('XML 파서가 없습니다. `npm i -D @xmldom/xmldom`을 실행하세요.');
    }

    const { ir, stats } = await hwpxToIr(fs.readFileSync(abs), { parseXml });
    ir.blocks = coalesceBlocks(ir.blocks);

    const as = String(args.as || 'markdown').toLowerCase();
    let body;
    if (as === 'ir') {
        body = JSON.stringify(ir, null, 2);
    } else {
        const exporter = TEXT_EXPORTERS[as === 'markdown' ? 'md' : as];
        if (!exporter) throw new Error(`as는 markdown|html|ir 중 하나여야 합니다: ${args.as}`);
        // 제목 문단은 이미 blocks 안에 있다. 앞에 또 붙이면 두 번 나온다.
        body = exporter.serialize(ir, { includeTitle: false });
    }

    const limit = Number.isFinite(args.maxChars) ? Math.max(1000, args.maxChars) : 60000;
    const truncated = body.length > limit;
    const shown = truncated ? body.slice(0, limit) : body;

    const notes = [
        `문단 ${stats.paragraphs} · 표 ${stats.tables} · 링크 ${stats.links} · 그림 ${stats.images}`,
    ];
    if (stats.images > 0) {
        notes.push(`그림 ${stats.images}개는 파일명만 참조합니다(바이트는 포함되지 않음).`);
    }
    if (truncated) {
        notes.push(`전체 ${body.length}자 중 ${limit}자만 반환했습니다. maxChars를 올리세요.`);
    }
    notes.push('레이아웃 복제가 아니라 구조 추출입니다. 서식·여백·글꼴은 포함되지 않습니다.');

    const noteBlock = notes.map(n => `※ ${n}`).join('\n');
    return { isError: false, text: `${shown}\n\n---\n${noteBlock}` };
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
        case 'pdf_to_hwpx': {
            if (typeof args.path !== 'string' || !args.path.trim()) throw new Error('path가 필요합니다.');
            const abs = path.resolve(args.path);
            if (!/\.pdf$/i.test(abs)) throw new Error(`.pdf 파일이 아닙니다: ${args.path}`);
            if (!fs.existsSync(abs)) throw new Error(`파일이 없습니다: ${abs}`);
            const ir = await parsePdf(new Uint8Array(fs.readFileSync(abs)));
            const r = await renderAndReport(ir, args, 'PDF(구조 추론)');
            if (!r.isError && ir.audit) {
                const a = ir.audit;
                // 추론 근거를 함께 돌려준다. 에이전트가 "원본 복제"로 오해하면
                // 그 결과를 그대로 사람에게 전달하게 된다.
                const evidence = [
                    '',
                    '[추론 근거]',
                    `본문 ${a.bodyFontSizePt}pt · 제목 크기 [${a.headingSizesPt.join(', ')}] · ${a.pages}쪽`,
                    `추론 결과: 제목 ${a.counts.headings} · 문단 ${a.counts.paragraphs} · 표 ${a.counts.tables} · 목록 ${a.counts.listItems}`,
                    ...a.notes.map(n => `※ ${n}`),
                ];
                r.text += evidence.join('\n');
            }
            return r;
        }

        case 'make_comparison_table': {
            if (typeof args.current !== 'string' || typeof args.revised !== 'string') {
                throw new Error('current와 revised가 모두 필요합니다.');
            }
            if (!args.current.trim() && !args.revised.trim()) {
                throw new Error('current와 revised가 모두 비어 있습니다.');
            }
            const { ir, report } = buildComparisonTable(args.current, args.revised, {
                title: args.title || '신구조문대비표',
                includeUnchanged: args.changedOnly !== true,
            });
            const r = await renderAndReport(ir, args, '신구조문대비표');
            if (!r.isError) {
                const lines = [
                    '',
                    '[대비 결과]',
                    `유지 ${report.same} · 개정 ${report.changed} · 신설 ${report.added} · 삭제 ${report.removed}`,
                    `현행 ${report.oldUnits}항목 → 개정안 ${report.newUnits}항목`,
                    '※ 현행 순서를 기준으로 정렬합니다. 개정 부분의 위치가 다소 어색해 보일 수 있습니다.',
                    '※ 문단 단위 비교입니다. 조·항·호 단위 대비는 하지 않습니다.',
                ];
                if (report.degraded) {
                    lines.push('※ 문서가 커서 정밀 대조를 생략하고 순서대로 짝지었습니다. 결과를 확인하세요.');
                }
                r.text += lines.join('\n');
            }
            return r;
        }

        case 'read_hwpx':
            return await readHwpxTool(args);

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
