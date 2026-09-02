'use strict';
/**
 * 포맷별 재현도 채점기 (DOCX 외 전 포맷).
 *
 * tests/fixtures/fidelity/rich.* 를 실제 브라우저로 변환한 뒤, 원본에서 뽑은 사실과
 * 생성된 HWPX(section0.xml / header.xml)를 항목별로 대조해 포맷마다 100점 만점으로
 * 채점하고 미달 근거를 출력한다.
 *
 * 사용: node tests/format-fidelity-score.js [포맷...]
 *   예: node tests/format-fidelity-score.js md html
 *
 * 주의: 채점 100점은 구조·값 대조 결과일 뿐 한컴 육안 확인을 대체하지 않는다.
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const JSZip = require('jszip');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const FIXTURES = path.join(__dirname, 'fixtures', 'fidelity');
const PORT = 8741;

const TYPES = {
    '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml', '.ttf': 'font/ttf', '.woff2': 'font/woff2',
    '.png': 'image/png', '.wasm': 'application/wasm',
};

const all = (s, re) => [...String(s).matchAll(re)];
const count = (s, re) => all(s, re).length;
const uniq = (a) => [...new Set(a)];
const norm = (c) => String(c || '').replace(/^#/, '').toUpperCase();

function serve() {
    return new Promise(resolve => {
        const srv = http.createServer((req, res) => {
            let urlPath = decodeURIComponent(req.url.split('?')[0]);
            if (urlPath === '/') urlPath = '/index.html';
            const filePath = path.normalize(path.join(ROOT, urlPath));
            fs.readFile(filePath, (err, data) => {
                if (err) { res.writeHead(404); res.end('404'); return; }
                res.writeHead(200, { 'Content-Type': TYPES[path.extname(filePath)] || 'application/octet-stream' });
                res.end(data);
            });
        });
        srv.listen(PORT, '127.0.0.1', () => resolve(srv));
    });
}

/** 생성된 HWPX에서 공통 사실을 뽑는다. */
function readHwpx(section, header) {
    const charPrs = all(header, /<hh:charPr\b[\s\S]*?<\/hh:charPr>/g).map(m => m[0]);
    // 코드/인용구는 전용 paraPr/charPr id로 판별한다(playbook 계약).
    return {
        section, header, charPrs,
        texts: all(section, /<hp:t(?:\s[^>]*)?>([\s\S]*?)<\/hp:t>/g)
            .map(m => m[1].replace(/&lt;/g, '<').replace(/&gt;/g, '>')
                .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&')),
        paragraphs: count(section, /<hp:p\b/g),
        tables: count(section, /<hp:tbl\b/g),
        rows: count(section, /<hp:tr\b/g),
        cells: count(section, /<hp:tc\b/g),
        images: count(section, /<hc:img\b/g),
        links: count(section, /<hp:fieldBegin\b[^>]*type="HYPERLINK"/g),
        linkEnds: count(section, /<hp:fieldEnd\b/g),
        linkPaths: all(section, /<hp:stringParam[^>]*name="Path"[^>]*>([\s\S]*?)<\/hp:stringParam>/g)
            .map(m => m[1].replace(/&amp;/g, '&')),
        codeRuns: count(section, /charPrIDRef="6"/g),
        quoteParas: count(section, /paraPrIDRef="19"/g),
        colSpan: count(section, /colSpan="([2-9]|\d\d+)"/g),
        rowSpan: count(section, /rowSpan="([2-9]|\d\d+)"/g),
        headerCells: count(section, /header="1"/g),
        repeatHeader: count(section, /repeatHeader="1"/g),
        // 본문 제목은 paraPrIDRef 1~4,15,16 (H1~H6)
        headingParas: count(section, /paraPrIDRef="(?:1|2|3|4|15|16)"/g),
        // 첫 H1은 기본 제목 정책(heading)에 따라 문서 제목 문단(가운데 정렬 paraPr 12)으로 승격된다.
        titleParas: count(section, /paraPrIDRef="12"/g),
        quoteText: all(section, /<hp:p [^>]*paraPrIDRef="19"[^>]*>([\s\S]*?)<\/hp:p>/g)
            .map(m => all(m[1], /<hp:t[^>]*>([\s\S]*?)<\/hp:t>/g).map(t => t[1]).join('')).join(' '),
        // 코드 블록은 표로 렌더되므로(코드 줄 = paraPr 14), 데이터 표만 세려면 그 표들을 뺀다.
        dataTables: all(section, /<hp:tbl\b[\s\S]*?<\/hp:tbl>/g)
            .filter(m => !/paraPrIDRef="14"/.test(m[0])).length,
        // 목록 문단을 레벨(5=1단계, 17=2단계, 18=3단계)별로 텍스트와 함께 뽑는다.
        listItems: all(section, /<hp:p [^>]*paraPrIDRef="(5|17|18)"[^>]*>([\s\S]*?)<\/hp:p>/g)
            .map(m => ({
                level: m[1],
                text: all(m[2], /<hp:t[^>]*>([\s\S]*?)<\/hp:t>/g).map(t => t[1]).join(''),
            })),
        boldChars: count(charPrs.join(''), /<hh:bold\b/g),
        italicChars: count(charPrs.join(''), /<hh:italic\b/g),
        underlineChars: count(charPrs.join(''), /<hh:underline\b[^>]*type="(?!NONE)/g),
        strikeChars: count(charPrs.join(''), /<hh:strikeout\b[^>]*shape="(?!NONE)/g),
        textColors: uniq(charPrs.map(c => (c.match(/textColor="#?([0-9A-Fa-f]{6})"/) || [])[1])
            .filter(Boolean).map(norm)),
    };
}

/** 원본 텍스트 조각들이 HWPX 본문에 남아 있는가 (글자 수 기준 비율) */
function textCoverage(pieces, x) {
    const hay = x.texts.join('');
    let total = 0, hit = 0;
    const missing = [];
    for (const raw of pieces) {
        const s = String(raw).trim();
        if (!s) continue;
        total += s.length;
        if (hay.includes(s)) hit += s.length;
        else if (missing.length < 8) missing.push(s.slice(0, 50));
    }
    return { ratio: total ? hit / total : 1, missing };
}

const atLeast = (out, want) => (want <= 0 ? 1 : Math.min(1, out / want));

// ── 포맷별 채점 규칙 ────────────────────────────────────────────────
// 각 규칙은 [항목명, 배점, 0~1 점수, 근거 문자열] 배열을 돌려준다.

function scoreMd(src, x) {
    const cov = textCoverage([
        '재현도 검증 문서', '2단계 제목', '6단계 제목',
        '일반 문단입니다. 한글과 English가 섞여 있습니다.',
        '굵은 글씨', '기울임', '취소선', '인라인 코드',
        "don't 'quoted' 'entity' 그리고 & < > 엔티티.",
        '비순서 목록 첫째', '중첩 항목 2단계', '순서 목록 셋',
        '미완료 작업', '완료된 작업',
        '첫째 행', '굵은 셀', '코드 셀', '셋째 행',
        '인용문 첫 줄입니다.', '인용문 둘째 줄입니다.',
        '안녕하세요, ${name}', '예제 사이트', '문의', '마지막 문단입니다.',
    ], x);
    const badEntities = /&apos;|&#39;|&amp;#39;/.test(x.section);
    return [
        ['텍스트 완전성', 18, cov.ratio, cov.missing.length ? `누락: ${cov.missing.join(' | ')}` : '전체 일치'],
        ['제목 H1~H6', 10, atLeast(x.headingParas + x.titleParas, 6),
            `본문 제목 ${x.headingParas} + 문서 제목 ${x.titleParas} = ${x.headingParas + x.titleParas}/6`],
        ['표(머리행 지정 + 3행)', 10,
            atLeast(x.rows, 4) * atLeast(x.cells, 12) * (x.headerCells >= 3 ? 1 : 0),
            `표 ${x.dataTables}, 행 ${x.rows}/4, 셀 ${x.cells}/12, header="1" ${x.headerCells}/3`],
        // 목록은 텍스트 존재만으로는 부족하다 — 중첩 레벨(paraPr 5/17/18), 순서 번호,
        // 태스크 마커가 각각 맞아야 하고, 원문 체크박스 표기 "[ ]"/"[x]"가 마커와
        // 중복으로 새면 안 된다(marked 18의 checkbox 토큰 raw 유출).
        ['목록 중첩 레벨(1/2/3단계)', 5,
            (['5', '17', '18'].filter(l => x.listItems.some(i => i.level === l)).length) / 3,
            `레벨별 항목 수: ${['5', '17', '18'].map(l => `${l}:${x.listItems.filter(i => i.level === l).length}`).join(' ')}`],
        ['순서 목록 번호', 3,
            (['1.', '2.', '3.'].filter(n => x.listItems.some(i => i.text.startsWith(n))).length) / 3,
            `번호 항목: ${x.listItems.filter(i => /^\d+\./.test(i.text)).length}/3`],
        ['태스크 마커(체크 상태 + 원문 표기 미유출)', 4,
            ((x.listItems.some(i => i.text.startsWith('□ ')) ? 1 : 0)
                + (x.listItems.some(i => i.text.startsWith('▣ ')) ? 1 : 0)
                + (x.listItems.some(i => /\[[ x]\]/.test(i.text)) ? 0 : 1)) / 3,
            `□ ${x.listItems.some(i => i.text.startsWith('□ '))}, ▣ ${x.listItems.some(i => i.text.startsWith('▣ '))}, `
            + `원문 [ ]/[x] 유출 ${x.listItems.some(i => /\[[ x]\]/.test(i.text))}`],
        ['인용구(paraPr 19)', 8,
            (atLeast(x.quoteParas, 1) + (x.quoteText.includes('인용문 첫 줄입니다.')
                && x.quoteText.includes('인용문 둘째 줄입니다.') ? 1 : 0)) / 2,
            `인용 문단 ${x.quoteParas}/1, 두 줄 보존 ${x.quoteText.includes('인용문 둘째 줄입니다.')}`],
        ['코드(블록+인라인, charPr 6)', 8, atLeast(x.codeRuns, 2), `코드 run ${x.codeRuns}`],
        ['인라인 서식(굵게/기울임/취소선)', 10,
            (x.boldChars ? 1 : 0) * 0.4 + (x.italicChars ? 1 : 0) * 0.3 + (x.strikeChars ? 1 : 0) * 0.3,
            `charPr B${x.boldChars}/I${x.italicChars}/S${x.strikeChars}`],
        ['하이퍼링크(field 쌍 + Path)', 12,
            (atLeast(x.links, 4) + (x.links === x.linkEnds ? 1 : 0)
                + (x.linkPaths.some(p => p.includes('a=1&b=2')) ? 1 : 0)) / 3,
            `링크 ${x.links}/4, begin=end ${x.links === x.linkEnds}, Path 예: ${x.linkPaths[0] || '없음'}`],
        ['작은따옴표/엔티티 회귀', 7, badEntities ? 0 : 1,
            badEntities ? 'section0.xml에 &apos;/&#39; 잔존' : "원문 ' 로 정상 출력"],
        ['구분선(hr)', 5, /paraPrIDRef="8"|paraPrIDRef="9"/.test(x.section) ? 1 : 0, 'hr 문단 존재'],
    ];
}

function scoreHtml(src, x) {
    const cov = textCoverage([
        'HTML 재현도 검증', '2단계 제목', '6단계 제목',
        '일반 문단입니다. 한글과 English가 섞여 있습니다.',
        '굵게', '기울임', '코드', '밑줄', '삽입', '취소', '취소2', '삭제',
        '빨강 글자', '파랑 글자',
        '비순서 항목 하나', '중첩 항목 2단계', '순서 항목 둘',
        '머리 A', '가로 병합 셀', '세로 병합 셀', '본문 4',
        '인용문 문단입니다.', '예제 사이트', '메일 링크',
    ], x);
    const excluded = !x.texts.join('').includes('내비게이션은 제외')
        && !x.texts.join('').includes('푸터는 제외')
        && !x.texts.join('').includes('var ignored');
    return [
        ['텍스트 완전성', 20, cov.ratio, cov.missing.length ? `누락: ${cov.missing.join(' | ')}` : '전체 일치'],
        ['제목 H1~H6', 10, atLeast(x.headingParas + x.titleParas, 6),
            `본문 제목 ${x.headingParas} + 문서 제목 ${x.titleParas} = ${x.headingParas + x.titleParas}/6`],
        ['표 + 병합(colspan/rowspan) + th 머리행', 14,
            (atLeast(x.rows, 4) + (x.colSpan >= 1 ? 1 : 0) + (x.rowSpan >= 1 ? 1 : 0)
                + (x.headerCells >= 3 ? 1 : 0)) / 4,
            `행 ${x.rows}/4, colSpan ${x.colSpan}, rowSpan ${x.rowSpan}, header="1" ${x.headerCells}/3`],
        ['목록 중첩 레벨(1/2/3단계)', 6,
            (['5', '17', '18'].filter(l => x.listItems.some(i => i.level === l)).length) / 3,
            `레벨별 항목 수: ${['5', '17', '18'].map(l => `${l}:${x.listItems.filter(i => i.level === l).length}`).join(' ')}`],
        ['순서 목록 번호', 4,
            (['1.', '2.'].filter(n => x.listItems.some(i => i.text.startsWith(n))).length) / 2,
            `번호 항목: ${x.listItems.filter(i => /^\d+\./.test(i.text)).length}/2`],
        ['인용구(blockquote)', 8, atLeast(x.quoteParas, 1), `인용 문단 ${x.quoteParas}/1`],
        ['서식(굵게/기울임/코드/밑줄/취소)', 14,
            (x.boldChars ? 1 : 0) * 0.25 + (x.italicChars ? 1 : 0) * 0.2
            + (x.codeRuns ? 1 : 0) * 0.2 + (x.underlineChars ? 1 : 0) * 0.2
            + (x.strikeChars ? 1 : 0) * 0.15,
            `B${x.boldChars}/I${x.italicChars}/코드${x.codeRuns}/U${x.underlineChars}/S${x.strikeChars}`],
        ['글자색(style color + font color)', 10,
            (['C0392B', '1D4ED8'].filter(c => x.textColors.includes(c)).length) / 2,
            `HWPX 글자색: ${x.textColors.join(', ') || '없음'}`],
        ['하이퍼링크', 9,
            (atLeast(x.links, 2) + (x.links === x.linkEnds ? 1 : 0)
                + (x.linkPaths.some(p => p.includes('a=1&b=2')) ? 1 : 0)) / 3,
            `링크 ${x.links}/2, Path 예: ${x.linkPaths[0] || '없음'}`],
        ['비본문 요소 제외(nav/footer/script/style)', 5, excluded ? 1 : 0,
            excluded ? 'nav/footer/script 제외됨' : '비본문 텍스트가 본문에 섞임'],
    ];
}

function scoreTxt(src, x) {
    // TXT는 "- 항목" 같은 줄을 목록으로 인식해 마커를 `·`로 바꾼다(golden이 고정한 의도된 동작).
    // 글자 자체가 아니라 낱말이 전부 남았는지를 본다.
    const lines = src.split(/\r?\n/)
        .map(l => l.replace(/^\s*[-*+]\s+/, '').replace(/^\s*\d+\.\s+/, ''))
        .filter(l => l.trim());
    const cov = textCoverage(lines, x);
    // 빈 줄 기준 문단 수
    const wantParas = src.split(/\r?\n\s*\r?\n/).filter(b => b.trim()).length;
    return [
        ['텍스트 완전성(전 줄)', 55, cov.ratio, cov.missing.length ? `누락: ${cov.missing.join(' | ')}` : `${lines.length}줄 전부 일치`],
        ['문단 분리(빈 줄 기준)', 20, atLeast(x.paragraphs, wantParas), `HWPX 문단 ${x.paragraphs}/${wantParas}`],
        ['특수문자 보존', 15,
            textCoverage(['& < > " \' \\ / @ # $ % ^ * ( ) [ ] { } | ~ `'], x).ratio,
            '특수문자 줄 원문 일치'],
        // 원본에 서식 근거가 없는 것을 지어내지 않는지 본다. "- 항목"의 목록 인식은
        // 원문에 근거가 있는 의도된 동작이므로 여기서 감점 대상이 아니다.
        ['서식 추정 안 함(제목/표 날조 없음)', 10,
            x.headingParas === 0 && x.dataTables === 0 ? 1 : 0,
            `본문 제목 ${x.headingParas}, 데이터 표 ${x.dataTables} (둘 다 0이어야 함)`],
    ];
}

function scoreCsv(src, x) {
    const rows = src.trim().split(/\r?\n/);
    const cov = textCoverage([
        '항목명', '수량', '단가', '비고', '사무용 의자', '쉼표, 포함된 값',
        '따옴표 "이중" 값', '긴 텍스트가 들어가는 셀입니다 한글과 English 혼합',
        '특수문자 & < > 검증', '마지막 행', '310000', '18000',
    ], x);
    return [
        ['셀 값 완전성', 35, cov.ratio, cov.missing.length ? `누락: ${cov.missing.join(' | ')}` : '전체 일치'],
        ['행/열 수', 25, atLeast(x.rows, rows.length) * atLeast(x.cells, rows.length * 4),
            `행 ${x.rows}/${rows.length}, 셀 ${x.cells}/${rows.length * 4}`],
        ['머리행 지정(header=1 + repeatHeader)', 20,
            ((x.headerCells >= 4 ? 1 : 0) + (x.repeatHeader >= 1 ? 1 : 0)) / 2,
            `header="1" 셀 ${x.headerCells}/4, repeatHeader ${x.repeatHeader}`],
        ['표 속성(pageBreak/treatAsChar/outMargin)', 20,
            ((/pageBreak="TABLE"/.test(x.section) ? 1 : 0)
                + (/treatAsChar="0"/.test(x.section) ? 1 : 0)
                + (/<hp:outMargin[^>]*bottom="850"/.test(x.section) ? 1 : 0)) / 3,
            `pageBreak ${/pageBreak="TABLE"/.test(x.section)}, treatAsChar0 ${/treatAsChar="0"/.test(x.section)}, outMargin850 ${/<hp:outMargin[^>]*bottom="850"/.test(x.section)}`],
    ];
}

function scoreXlsx(src, x) {
    const cov = textCoverage([
        '항목명', '수량', '단가', '비고', '사무용 의자', '쉼표, 포함된 값',
        '따옴표 "이중" 값', '긴 텍스트가 들어가는 셀입니다 한글과 English 혼합',
        '특수문자 & < > 검증', '마지막 행', '310000', '18000',
    ], x);
    const secondSheetLeaked = x.texts.join('').includes('둘째 시트는 변환 대상 아님');
    return [
        ['첫 시트 셀 값 완전성', 40, cov.ratio, cov.missing.length ? `누락: ${cov.missing.join(' | ')}` : '전체 일치'],
        ['행/열 수', 25, atLeast(x.rows, 7) * atLeast(x.cells, 28), `행 ${x.rows}/7, 셀 ${x.cells}/28`],
        ['머리행 지정', 20, ((x.headerCells >= 4 ? 1 : 0) + (x.repeatHeader >= 1 ? 1 : 0)) / 2,
            `header="1" 셀 ${x.headerCells}/4, repeatHeader ${x.repeatHeader}`],
        ['첫 시트만 변환(계약)', 15, secondSheetLeaked ? 0 : 1,
            secondSheetLeaked ? '둘째 시트가 섞여 들어옴' : '첫 시트만 변환됨'],
    ];
}

function scoreJson(src, x) {
    const cov = textCoverage([
        'JSON 재현도 검증', '4.16.9', '42', '값 하나', '값 둘', '깊은 값',
        '가', '나', '다', '라', '첫째 항목', '둘째 항목', '셋째 항목',
        '95', '87', '73', '특수문자 & < > " 검증',
    ], x);
    return [
        ['key/value 완전성', 45, cov.ratio, cov.missing.length ? `누락: ${cov.missing.join(' | ')}` : '전체 일치'],
        ['객체 배열 → 표', 25,
            (x.tables >= 1 ? 1 : 0) * atLeast(x.rows, 4),
            `표 ${x.tables}, 행 ${x.rows}/4 (records 3행 + 머리행)`],
        ['중첩 객체 펼침', 15, textCoverage(['깊은 값'], x).ratio, 'nested.deep.level3 도달'],
        ['배열 값 보존', 15, textCoverage(['가', '나', '다', '라'], x).ratio, 'tags 배열 4개'],
    ];
}

function scoreIpynb(src, x) {
    const cov = textCoverage([
        'IPYNB 재현도 검증', '노트북 첫 마크다운 셀입니다.',
        '마크다운 서식', '굵게', '기울임', '인라인 코드',
        '목록 하나', '목록 둘',
        'def greet(name):', '안녕하세요, {name}',
        '실행 결과 텍스트 출력입니다', '둘째 줄 출력',
        'import numpy as np', 'result = 6 * 7', '42',
    ], x);
    return [
        ['셀 텍스트 완전성', 35, cov.ratio, cov.missing.length ? `누락: ${cov.missing.join(' | ')}` : '전체 일치'],
        ['markdown 셀 서식(제목/목록/표)', 20,
            ((x.headingParas + x.titleParas >= 2 ? 1 : 0) + (x.dataTables >= 1 ? 1 : 0)
                + (x.boldChars ? 1 : 0)) / 3,
            `제목 ${x.headingParas + x.titleParas}/2, 데이터 표 ${x.dataTables}/1, 굵게 charPr ${x.boldChars}`],
        ['code 셀 = 등폭 코드블록', 20, atLeast(x.codeRuns, 2), `코드 run ${x.codeRuns}`],
        ['출력 텍스트 포함', 10, textCoverage(['실행 결과 텍스트 출력입니다', '42'], x).ratio, 'stream + execute_result'],
        ['이미지 2개(마크다운 + 출력)', 15, atLeast(x.images, 2), `hc:img ${x.images}/2`],
    ];
}

function scorePptx(src, x) {
    // PPTX는 원본 텍스트를 XML에서 직접 뽑아 대조한다.
    const texts = all(src, /<a:t>([\s\S]*?)<\/a:t>/g)
        .map(m => m[1].replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&'))
        .filter(t => t.trim());
    const cov = textCoverage(texts, x);
    const slides = Number(src.__slideCount || 0);
    return [
        ['슬라이드 텍스트 완전성', 60, cov.ratio,
            cov.missing.length ? `누락: ${cov.missing.join(' | ')}` : `${texts.length}개 텍스트 전부 일치`],
        ['슬라이드별 구분(제목 문단)', 25, atLeast(x.headingParas, slides), `제목 문단 ${x.headingParas}/${slides}슬라이드`],
        ['본문 문단 생성', 15, x.paragraphs > slides ? 1 : 0, `HWPX 문단 ${x.paragraphs}`],
    ];
}

const RULES = {
    md: scoreMd, html: scoreHtml, txt: scoreTxt, csv: scoreCsv,
    xlsx: scoreXlsx, json: scoreJson, ipynb: scoreIpynb, pptx: scorePptx,
};

/** 원본을 채점에 쓸 형태로 읽는다(바이너리는 내부 XML을 이어붙인 문자열). */
async function readSource(file, ext) {
    if (ext === 'xlsx') return '';
    if (ext === 'pptx') {
        const zip = await JSZip.loadAsync(fs.readFileSync(file));
        const names = Object.keys(zip.files)
            .filter(n => /^ppt\/slides\/slide\d+\.xml$/.test(n)).sort();
        let xml = '';
        for (const n of names) xml += await zip.file(n).async('string');
        // eslint-disable-next-line no-new-wrappers
        const boxed = new String(xml);
        boxed.__slideCount = names.length;
        return boxed;
    }
    return fs.readFileSync(file, 'utf-8');
}

(async () => {
    const want = process.argv.slice(2).filter(a => !a.startsWith('-'));
    const exts = (want.length ? want : Object.keys(RULES))
        .filter(e => fs.existsSync(path.join(FIXTURES, `rich.${e}`)));

    const srv = await serve();
    const browser = await chromium.launch();
    const results = [];
    try {
        for (const ext of exts) {
            const file = path.join(FIXTURES, `rich.${ext}`);
            const page = await browser.newPage();
            let section = '', header = '', err = null;
            try {
                await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'domcontentloaded' });
                await page.waitForFunction(
                    () => window.JSZip && window.marked && window.XLSX && window.__appReady,
                    null, { timeout: 30000 });
                const dl = page.waitForEvent('download', { timeout: 60000 });
                await page.setInputFiles('#file-input', file);
                await page.locator('#convert-btn').click();
                const download = await dl;
                const out = path.join(require('os').tmpdir(), `fidelity-${ext}.hwpx`);
                await download.saveAs(out);
                const zip = await JSZip.loadAsync(fs.readFileSync(out));
                section = await zip.file('Contents/section0.xml').async('string');
                header = await zip.file('Contents/header.xml').async('string');
            } catch (e) {
                err = e.message;
            }
            await page.close();

            if (err) { results.push({ ext, err }); continue; }
            const src = await readSource(file, ext);
            const x = readHwpx(section, header);
            results.push({ ext, items: RULES[ext](src, x) });
        }
    } finally {
        await browser.close();
        srv.close();
    }

    let grand = 0, grandMax = 0, failed = 0;
    for (const r of results) {
        console.log(`\n=== ${r.ext.toUpperCase()} 재현도 ===`);
        if (r.err) { console.log(`❌ 변환 실패: ${r.err}`); failed++; continue; }
        let score = 0, max = 0;
        for (const [name, w, ratio, note] of r.items) {
            const got = w * Math.max(0, Math.min(1, ratio));
            score += got; max += w;
            const mark = ratio >= 1 ? '✅' : ratio >= 0.9 ? '🟡' : '❌';
            console.log(`${mark} ${name.padEnd(36)} ${got.toFixed(1)}/${w}  ${note}`);
        }
        const pct = (score / max) * 100;
        console.log(`   → ${pct.toFixed(1)}점`);
        grand += score; grandMax += max;
        if (pct < 99.95) failed++;
    }
    console.log(`\n전체 평균: ${((grand / grandMax) * 100).toFixed(1)}점  (미달 포맷 ${failed}개)`);
    process.exitCode = failed ? 1 : 0;
})();
