#!/usr/bin/env node
/* ===================================================================
 * [core/cli.js] tohwpx — 명령줄 변환기
 * ===================================================================
 *   node js/core/cli.js input.md -o out.hwpx
 *   node js/core/cli.js docs/*.md --out-dir build --paper A4
 *
 * 웹앱과 **같은 렌더러**(js/hwpx.js)와 **같은 파서**(js/parsers.js)를 쓴다.
 * 동등성은 qa/core-parity-gate.js가 지킨다.
 *
 * 지원 입력은 브라우저 DOM 없이 파싱 가능한 것으로 한정한다.
 * MD·CSV·TSV·JSON·TXT와 IR JSON. HTML/DOCX/PPTX/XLSX/IPYNB는 각각
 * DOMParser·JSZip·SheetJS가 더 필요해 아직 웹앱에서만 변환한다.
 * 반쯤 지원해서 조용히 다른 결과를 내는 것보다, 안 된다고 말하는 편이 낫다.
 * ===================================================================*/

'use strict';

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

// parseMd는 전역 marked를 참조한다(브라우저에서 스크립트 태그로 로드되는 구조).
// vendor 번들이 UMD라 Node에서도 그대로 쓸 수 있다. parsers.js를 import하기
// 전에 전역에 얹어야 한다.
if (typeof globalThis.marked === 'undefined') {
    globalThis.marked = require('../vendor/marked-18.0.11.min.js');
}

const { irToHwpx, ensureNodeRuntime } = await import('./index.js');
const { parseMd, parseCsv, parseJson, parseTxt } = await import('../parsers.js');
const { hwpxToIr, coalesceBlocks } = await import('./hwpx-to-ir.js');
const { parsePdf } = await import('../pdf-parser.js');
const { TEXT_EXPORTERS } = await import('./ir-to-text.js');

const VERSION = require('../../package.json').version;

/** 확장자 → 파서. 여기 없는 확장자는 "지원하지 않음"으로 명확히 거절한다. */
const PARSERS = {
    '.md': parseMd,
    '.markdown': parseMd,
    '.csv': parseCsv,
    '.tsv': parseCsv,      // parseCsv가 쉼표/탭을 자동 판별한다
    '.txt': parseTxt,
    '.json': parseJson,
};

/** 비동기 파서 — 확장자별로 따로 둔다(동기 파서와 호출 방식이 다르다). */
const ASYNC_PARSERS = {
    '.pdf': (buffer, docType) => parsePdf(buffer, { docType }),
};

/** 웹앱에만 있는 입력 — 왜 안 되는지 함께 말한다. */
const BROWSER_ONLY = {
    '.html': 'HTML 파싱에 DOM이 필요합니다',
    '.htm': 'HTML 파싱에 DOM이 필요합니다',
    '.docx': 'DOCX 파싱에 DOM과 ZIP 리더가 필요합니다',
    '.pptx': 'PPTX 파싱에 DOM과 ZIP 리더가 필요합니다',
    '.xlsx': 'XLSX 파싱에 SheetJS가 필요합니다',
    '.xls': 'XLS 파싱에 SheetJS가 필요합니다',
    '.ipynb': 'IPYNB의 Markdown 셀 처리에 DOM이 필요합니다',
    '.hwp': 'HWP 읽기에 WASM 엔진이 필요합니다',
    '.hwpx': 'HWPX는 출력 형식입니다(역방향 추출은 --to를 쓰세요)',
};

const HELP = `tohwpx ${VERSION} — 문서를 HWPX(한글)로 변환합니다

사용법
  tohwpx <입력...> [옵션]

옵션
  -o, --out <파일>        출력 파일 (입력이 하나일 때)
      --out-dir <디렉터리> 출력 디렉터리 (기본: 입력과 같은 위치)
      --font <이름>        글꼴 (기본: 휴먼명조)
      --size <pt>          기본 글자 크기 (기본: 12)
      --paper <A4|A3|B5|Letter>   용지 (기본: A4)
      --orientation <portrait|landscape>  방향 (기본: portrait)
      --line-spacing <%>   줄 간격 퍼센트 (기본: 160)
      --title <제목>       문서 제목 (기본: 첫 제목/문장)
      --doc-type <plain|titleblock>  표지 처리 (기본: plain)
      --hr                 가로 구분선을 선으로 출력
      --json-ir            입력 .json을 IR로 그대로 사용
  -q, --quiet              진행 출력을 줄입니다
  -h, --help               이 도움말
  -v, --version            버전

역방향 (.hwpx 입력)
      --to <md|html>       HWPX를 Markdown 또는 HTML로 추출합니다

지원 입력
  ${Object.keys(PARSERS).join(' ')} ${Object.keys(ASYNC_PARSERS).join(' ')}  (역방향은 .hwpx)

예시
  tohwpx README.md
  tohwpx notes.md -o 보고서.hwpx --font 함초롬바탕 --paper A4
  tohwpx data/*.csv --out-dir build --orientation landscape
  tohwpx 공문.hwpx --to md -o 공문.md
`;

function parseArgs(argv) {
    const opts = {
        inputs: [], out: null, outDir: null,
        fontName: '휴먼명조', fontSize: 12, paperSize: 'A4',
        orientation: 'portrait', lineSpacingPercent: 160,
        title: null, docType: 'plain', showHorizontalRules: false,
        jsonIr: false, quiet: false, help: false, version: false,
        to: null,
    };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        const next = () => {
            const v = argv[++i];
            if (v === undefined) throw new Error(`${a} 옵션에 값이 필요합니다.`);
            return v;
        };
        switch (a) {
            case '-o': case '--out': opts.out = next(); break;
            case '--out-dir': opts.outDir = next(); break;
            case '--font': opts.fontName = next(); break;
            case '--size': opts.fontSize = Number(next()); break;
            case '--paper': opts.paperSize = next(); break;
            case '--orientation': opts.orientation = next(); break;
            case '--line-spacing': opts.lineSpacingPercent = Number(next()); break;
            case '--title': opts.title = next(); break;
            case '--doc-type': opts.docType = next(); break;
            case '--hr': opts.showHorizontalRules = true; break;
            case '--json-ir': opts.jsonIr = true; break;
            case '--to': opts.to = String(next()).toLowerCase(); break;
            case '-q': case '--quiet': opts.quiet = true; break;
            case '-h': case '--help': opts.help = true; break;
            case '-v': case '--version': opts.version = true; break;
            default:
                if (a.startsWith('-')) throw new Error(`알 수 없는 옵션: ${a}`);
                opts.inputs.push(a);
        }
    }
    return opts;
}

function validateOptions(o) {
    const errors = [];
    if (!['A4', 'A3', 'B5', 'Letter'].includes(o.paperSize)) {
        errors.push(`--paper 값이 잘못됐습니다: ${o.paperSize} (A4|A3|B5|Letter)`);
    }
    if (!['portrait', 'landscape'].includes(o.orientation)) {
        errors.push(`--orientation 값이 잘못됐습니다: ${o.orientation} (portrait|landscape)`);
    }
    if (!['plain', 'titleblock'].includes(o.docType)) {
        errors.push(`--doc-type 값이 잘못됐습니다: ${o.docType} (plain|titleblock)`);
    }
    if (!Number.isFinite(o.fontSize) || o.fontSize < 6 || o.fontSize > 72) {
        errors.push(`--size는 6~72 사이여야 합니다: ${o.fontSize}`);
    }
    if (!Number.isFinite(o.lineSpacingPercent) || o.lineSpacingPercent < 50 || o.lineSpacingPercent > 500) {
        errors.push(`--line-spacing은 50~500 사이여야 합니다: ${o.lineSpacingPercent}`);
    }
    if (o.to && !TEXT_EXPORTERS[o.to]) {
        errors.push(`--to 값이 잘못됐습니다: ${o.to} (${Object.keys(TEXT_EXPORTERS).join('|')})`);
    }
    if (o.out && o.inputs.length > 1) {
        errors.push('--out은 입력이 하나일 때만 쓸 수 있습니다. 여러 개는 --out-dir을 쓰세요.');
    }
    return errors;
}

/** 입력 파일 하나를 IR로 만든다. PDF만 비동기 엔진을 쓴다. */
async function fileToIr(file, o) {
    const ext = path.extname(file).toLowerCase();

    // PDF는 레이아웃 형식이라 구조를 추론한다. 엔진이 크므로 여기서만 쓴다.
    const asyncParser = ASYNC_PARSERS[ext];
    if (asyncParser) {
        return await asyncParser(new Uint8Array(fs.readFileSync(file)), o.docType);
    }

    if (o.jsonIr && ext === '.json') {
        const ir = JSON.parse(fs.readFileSync(file, 'utf8'));
        if (!ir || !Array.isArray(ir.blocks)) {
            throw new Error('IR JSON에 blocks 배열이 없습니다.');
        }
        return ir;
    }

    const parser = PARSERS[ext];
    if (!parser) {
        const why = BROWSER_ONLY[ext];
        throw new Error(
            why
                ? `${ext}는 명령줄에서 아직 지원하지 않습니다 — ${why}. 웹앱을 사용하세요.`
                : `지원하지 않는 확장자: ${ext || '(없음)'}`
        );
    }

    // BOM을 남기면 첫 제목이 깨진다.
    const text = fs.readFileSync(file, 'utf8').replace(/^﻿/, '');
    return parser(text, o.docType);
}

/**
 * HWPX를 Markdown/HTML로 추출한다.
 *
 * 레이아웃 복제가 아니라 **텍스트 형식으로의 추출**이다. 그림은 파일 이름만
 * 참조하며 바이트는 내보내지 않는다 — 그 사실을 호출자가 사용자에게 알린다.
 */
async function hwpxToText(input, o) {
    ensureNodeRuntime();
    let parseXml;
    try {
        const { DOMParser } = require('@xmldom/xmldom');
        parseXml = (xml) => new DOMParser().parseFromString(xml, 'text/xml');
    } catch {
        throw new Error('XML 파서가 없습니다. `npm i -D @xmldom/xmldom`을 실행하세요.');
    }

    const { ir, stats } = await hwpxToIr(fs.readFileSync(input), { parseXml });
    ir.blocks = coalesceBlocks(ir.blocks);
    if (o.title) ir.title = o.title;

    // 제목 문단은 이미 blocks 안에 있다. 앞에 title을 또 붙이면 두 번 나온다.
    const text = TEXT_EXPORTERS[o.to].serialize(ir, { includeTitle: false });
    return { text, stats };
}

function outputPathFor(input, o) {
    if (o.out) return path.resolve(o.out);
    const ext = o.to ? TEXT_EXPORTERS[o.to].ext : '.hwpx';
    const base = path.basename(input, path.extname(input)) + ext;
    const dir = o.outDir ? path.resolve(o.outDir) : path.dirname(path.resolve(input));
    return path.join(dir, base);
}

async function main() {
    let o;
    try {
        o = parseArgs(process.argv.slice(2));
    } catch (err) {
        console.error(`오류: ${err.message}\n`);
        console.error('자세한 사용법은 --help를 보세요.');
        process.exit(2);
    }

    if (o.help || (!o.inputs.length && !o.version)) { console.log(HELP); process.exit(o.help ? 0 : 2); }
    if (o.version) { console.log(VERSION); process.exit(0); }

    const optErrors = validateOptions(o);
    if (optErrors.length) {
        for (const e of optErrors) console.error(`오류: ${e}`);
        process.exit(2);
    }

    const log = o.quiet ? () => {} : (...a) => console.log(...a);
    let failed = 0;

    // 출력 경로 충돌을 미리 잡는다. notes.csv와 notes.json은 둘 다 notes.hwpx가
    // 되므로 그대로 두면 뒤 파일이 앞 파일을 조용히 덮어쓴다 — 일괄 변환에서
    // 사용자가 알아채기 어려운 데이터 손실이다. 변환을 시작하기 전에 거절한다.
    const claimed = new Map();
    const collisions = [];
    for (const input of o.inputs) {
        const target = outputPathFor(input, o);
        if (claimed.has(target)) collisions.push({ target, first: claimed.get(target), second: input });
        else claimed.set(target, input);
    }
    if (collisions.length) {
        for (const c of collisions) {
            console.error(`오류: 출력 경로가 겹칩니다 — ${path.relative(process.cwd(), c.target) || c.target}`);
            console.error(`      ${c.first} 와 ${c.second} 가 같은 파일로 저장됩니다.`);
        }
        console.error('확장자가 달라도 이름이 같으면 결과가 겹칩니다. 한 번에 하나씩 --out으로 지정하거나 입력 이름을 바꾸세요.');
        process.exit(2);
    }

    for (const input of o.inputs) {
        const rel = path.relative(process.cwd(), input) || input;
        try {
            if (!fs.existsSync(input)) throw new Error('파일이 없습니다.');

            // ── 역방향: HWPX → Markdown/HTML ──
            if (o.to) {
                if (path.extname(input).toLowerCase() !== '.hwpx') {
                    throw new Error(`--to는 .hwpx 입력에만 씁니다: ${path.extname(input) || '(확장자 없음)'}`);
                }
                const outPath = outputPathFor(input, o);
                const { text, stats } = await hwpxToText(input, o);
                fs.mkdirSync(path.dirname(outPath), { recursive: true });
                fs.writeFileSync(outPath, text, 'utf8');
                const outRel = path.relative(process.cwd(), outPath) || outPath;
                log(`✓ ${rel} → ${outRel}`);
                log(`  ${Buffer.byteLength(text).toLocaleString()}B · 문단 ${stats.paragraphs} · 표 ${stats.tables} · 링크 ${stats.links} · 그림 ${stats.images}`);
                if (stats.images > 0) {
                    log(`  ! 그림 ${stats.images}개는 파일명만 참조합니다(바이트는 내보내지 않음).`);
                }
                continue;
            }

            const ir = await fileToIr(input, o);
            if (o.title) ir.title = o.title;

            const { bytes, validation } = await irToHwpx(ir, {
                fontName: o.fontName,
                fontSize: o.fontSize,
                paperSize: o.paperSize,
                orientation: o.orientation,
                lineSpacingPercent: o.lineSpacingPercent,
                options: { showHorizontalRules: o.showHorizontalRules },
            });

            const outPath = outputPathFor(input, o);
            fs.mkdirSync(path.dirname(outPath), { recursive: true });
            fs.writeFileSync(outPath, bytes);

            const m = validation.metrics || {};
            const outRel = path.relative(process.cwd(), outPath) || outPath;
            log(`✓ ${rel} → ${outRel}`);
            log(`  ${bytes.length.toLocaleString()}B · 문단 ${m.paragraphs ?? '?'} · 표 ${m.tables ?? 0}`);

            // 구조 경고는 삼키지 않는다. 파일은 남기되 종료 코드로 알린다.
            if (!validation.pass) {
                console.error(`  ! 구조 검증 경고 ${validation.issues.length}건:`);
                for (const i of validation.issues.slice(0, 5)) console.error(`    - ${i}`);
                failed++;
            }
        } catch (err) {
            console.error(`✗ ${rel}: ${err.message}`);
            failed++;
        }
    }

    if (o.inputs.length > 1) log(`\n${o.inputs.length - failed}/${o.inputs.length} 성공`);
    if (failed) process.exit(1);
}

main().catch(err => {
    console.error('실행 실패:', err.message || err);
    process.exit(1);
});
