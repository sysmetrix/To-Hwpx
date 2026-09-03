/* ===================================================================
 * [pdf-parser.js] PDF → 공통 IR
 * ===================================================================
 * PDF는 **레이아웃 기술 형식**이다. 문단·표·목록 같은 논리 구조를 담지
 * 않고, 글자를 어느 좌표에 어떤 크기로 그릴지만 담는다. 따라서 구조 복원은
 * 본질적으로 **추론**이며 손실이 있다.
 *
 * 이 파서는 그 사실을 숨기지 않는다.
 *   - 추론한 근거(글자 크기, x 좌표, 줄 간격)를 `ir.audit`에 남긴다.
 *   - 확신할 수 없는 것은 만들어내지 않는다.
 *   - 결과 카드와 CLI가 "무엇을 추론했고 무엇을 못 했는지" 그대로 보여준다.
 *
 * 고정 백분율로 품질을 표기하지 않는다(AGENTS.md 원칙). 문서마다 다르다.
 *
 * 추론 규칙
 *   본문 크기 = 글자 높이의 최빈값
 *   제목      = 본문보다 15% 이상 큰 줄. 크기 내림차순으로 레벨 부여
 *   표        = 열 경계가 일치하는 줄이 2줄 이상 연속
 *   목록      = 본문 왼쪽 여백보다 안쪽에서 시작하는 줄
 *   문단 이어짐 = 줄 간격이 줄 높이의 1.6배 이내이고 글자 크기가 같을 때
 *
 * 하지 못하는 것 (v1)
 *   - 그림 추출: PDF 안 이미지는 가져오지 않는다.
 *   - 셀 병합·중첩 표: 좌표만으로 신뢰할 수 없다.
 *   - 글꼴·색·굵게: 스캔 PDF와 벡터 PDF의 표현이 제각각이라 v1에서 제외.
 *   - 스캔 이미지 PDF: 글자 레이어가 없으면 추출할 것이 없다(그 사실을 알린다).
 * ===================================================================*/

'use strict';

import { styleOf, splitByColor, DEFAULT_COLOR } from './pdf-style.js';
import { extractGraphics, encodePng } from './pdf-graphics.js';
import { buildGrids, fillCells, firstRowIsHeader } from './pdf-table.js';
import { findRunningLines, orderByColumns } from './pdf-layout.js';

// 버전 고정 vendor 경로. PDF 입력이 실제로 들어왔을 때만 지연 로드한다.
const PDFJS_DIR = new URL('./vendor/pdfjs-6.3.289/', import.meta.url).href;

let _pdfjsPromise = null;

/**
 * 글꼴의 **원래 이름**을 얻는다(`AAAAAA+MalgunGothicBold`).
 *
 * pdf.js v6.3에서 이 값은 열거 가능한 속성이 아니라 `getOwnPropertyNames`로는
 * 안 보인다. 직접 `.name`으로 읽어야 한다. 그리고 `getOperatorList()`를 먼저
 * 부르지 않으면 commonObjs가 비어 있어 예외가 난다.
 *
 * 이름을 못 얻어도 변환은 계속한다 — 서식이 빠질 뿐 글자는 온전하다.
 */
function fontRealName(page, loadedName) {
    if (!loadedName) return '';
    try {
        return page.commonObjs.get(loadedName)?.name || loadedName;
    } catch {
        return loadedName;
    }
}

/** 1pt = 1/72인치, HWP 단위 = 1/7200인치 → 정확히 100배. */
const PT_TO_HWP = 100;

/**
 * 뽑아낸 픽셀을 IR 그림 블록으로 만든다.
 *
 * pdf.js는 원본 JPEG이 아니라 **디코딩된 픽셀**을 준다. 그래서 HWPX에 넣으려면
 * 다시 인코딩해야 한다. 무손실이 필요한 도표·로고가 문서 그림의 대부분이라
 * PNG로 굽는다.
 *
 * 크기는 픽셀 수가 아니라 **PDF가 놓은 크기**를 쓴다. 1x1 픽셀을 90x60pt로
 * 늘려 놓은 그림이 실제로 있다.
 */
async function toImageBlocks(images, startIndex) {
    const out = [];
    for (let k = 0; k < images.length; k++) {
        const img = images[k];
        // 너무 작은 그림은 대개 표 배경이나 여백 채움이다. 본문 그림이 아니다.
        if (img.wPt < 4 || img.hPt < 4) continue;
        let data;
        try {
            data = await encodePng(img.rgba, img.pxWidth, img.pxHeight);
        } catch {
            continue;   // 한 장을 못 구워도 나머지 변환은 계속한다
        }
        out.push({
            block: {
                type: 'image',
                binName: `pdf-image${startIndex + k}.png`,
                mimeType: 'image/png',
                data,
                widthHwp: Math.round(img.wPt * PT_TO_HWP),
                heightHwp: Math.round(img.hPt * PT_TO_HWP),
                alt: '',
                sourceFormat: 'pdf',
            },
            // 줄 사이 어디에 끼울지 정하려면 놓인 높이가 필요하다.
            top: img.y + img.hPt,
        });
    }
    return out;
}

async function loadPdfjs() {
    if (_pdfjsPromise) return _pdfjsPromise;
    _pdfjsPromise = (async () => {
        let mod;
        try {
            // URL은 위의 버전 고정 상수다(사용자 입력 아님).
            // eslint-disable-next-line no-unsanitized/method
            mod = await import(/* webpackIgnore: true */ `${PDFJS_DIR}pdf.min.mjs`);
        } catch (err) {
            _pdfjsPromise = null;
            throw new Error('PDF 읽기 엔진을 불러오지 못했습니다(네트워크 확인 후 다시 시도해 주세요).');
        }
        mod.GlobalWorkerOptions.workerSrc = `${PDFJS_DIR}pdf.worker.min.mjs`;
        return mod;
    })();
    return _pdfjsPromise;
}

// ─────────────────────────────────────────────────────────────────────────
// [1단계] 글자 조각 → 줄
// ─────────────────────────────────────────────────────────────────────────

/**
 * 같은 y에 있는 조각을 한 줄로 묶는다.
 * 허용 오차를 글자 높이에 비례시킨다 — 고정값을 쓰면 큰 글씨의 위첨자나
 * 작은 글씨의 다음 줄이 같은 줄로 붙는다.
 */
function assembleLines(items) {
    const lines = [];
    for (const it of items) {
        const tol = Math.max(2, (it.h || 10) * 0.35);
        const line = lines.find(l => Math.abs(l.y - it.y) <= tol);
        if (line) {
            line.items.push(it);
            line.h = Math.max(line.h, it.h);
        } else {
            lines.push({ y: it.y, h: it.h, items: [it] });
        }
    }
    lines.sort((a, b) => b.y - a.y);              // PDF y축은 아래에서 위
    for (const l of lines) l.items.sort((a, b) => a.x - b.x);
    return lines;
}



/**
 * 줄이 바뀐 자리에 원래 공백이 있었는가.
 *
 * PDF는 줄 끝의 공백을 **버린다.** 조각 문자열에도, 좌표에도 남지 않는다
 * (양쪽 정렬이라 모든 줄이 오른쪽 끝에 딱 붙어 여백으로도 구별되지 않는다).
 * 그래서 글자만 보고 판단해야 한다.
 *
 * ── 실제 문서에서 센 것 ──
 * 한글 공문서 23쪽에서 이어지는 줄 46쌍을 뽑아 보니 **약 90%가 어절
 * 경계**에서 끊겼다(`향상과`+`새로운`). 어절 중간에서 끊긴 것은
 * `차원`+`에서는`처럼 뒤 줄이 **조사·어미로 시작하는** 경우가 대부분이었다.
 *
 * 그래서 기본은 공백을 넣고, 뒤 줄의 첫 낱말이 **홀로 설 수 없는 조사·어미**일
 * 때만 붙인다. 예전에는 근거가 없다는 이유로 공백을 아예 넣지 않았는데,
 * 그러면 90%가 틀린다(`향상과새로운`). 이제는 세어 본 근거가 있다.
 *
 * 한 글자짜리는 조사로 보지 않는다 — `이`는 조사이기도 하지만 `이 문서`의
 * 관형사이기도 해서, 붙이면 오히려 낱말을 망친다.
 */
const KOREAN_BOUND_TOKENS = new Set([
    // 조사
    '은는', '에서', '에게', '에겐', '께서', '부터', '까지', '마다', '처럼', '보다',
    '밖에', '조차', '마저', '이나', '이란', '이라', '이라는', '라는', '이며', '이고',
    '라도', '이라도', '든지', '이든', '로서', '으로서', '로써', '으로써', '으로',
    '에서는', '에게는', '으로는', '에는', '에도', '에서도', '만을', '만이', '만은',
    '과는', '와는', '과의', '와의', '에의', '로의', '으로의', '까지도', '부터는',
    '조차도', '마저도', '이라고', '라고', '에서의', '로는',
    // 어미·용언 꼬리
    '하여', '하며', '하고', '하는', '한다', '했다', '하지', '하기', '하면', '해야',
    '되어', '되며', '되고', '되는', '된다', '됐다', '되지', '이다', '입니다',
    '합니다', '됩니다',
    // 연결어미 — 낱말 첫머리에 올 수 없는 것들만 넣는다.
    '도록', '하도록', '되도록', '면서', '으면서', '지만', '이지만', '는데', '은데',
    '니까', '으니까', '므로', '으므로', '거나', '이거나', '게끔', '려면', '으려면',
    '더라도', '이더라도', '든가', '이든가', '에서만', '으로만', '로만',
]);

/**
 * 홀로 쓰이는 한 글자 낱말. 이것들로 줄이 끝났다면 어절이 끝난 것이다.
 * (`기여할 수` + `있다` → `수`는 홀로 쓰이므로 공백을 넣는다.)
 */
const STANDALONE_SYLLABLES = new Set([
    '수', '것', '등', '및', '때', '점', '바', '뿐', '자', '그', '이', '저',
    '더', '못', '안', '잘', '곧', '또', '즉', '단', '약', '전', '후', '말',
    // 관형사 — 뒤 낱말과 반드시 띄어 쓴다(`본 윤리원칙`, `각 기관`).
    '본', '각', '매', '총', '온', '뭇', '첫',
]);

/**
 * `하`·`되` 계열 어미. 낱말 첫머리에 올 수 없는 조합만 골라 적는다.
 *
 * 목록으로 하나씩 적으면 끝이 없어서(`할지에`, `하도록`, `되므로`…) 규칙으로 둔다.
 * 두 번째 글자까지 함께 봐야 안전하다 — `하`로 시작한다고 다 어미가 아니다.
 * `하나의`·`함께`·`한국`·`해결`은 어엿한 낱말이라 여기에 걸리면 안 된다.
 */
const HA_DOE_ENDING = new RegExp(
    '^(?:하|되)(?:여|며|고|는|지|기|면|도록|더라도|든지|지만|는데|니까|므로|거나|게끔|려면|였|았|겠)'
    + '|^(?:할|될|한|된|함|됨|했|됐)(?:지|까|수|는|던|으로|으며|고|다|서|야|도|에|를|은)');

/**
 * 줄을 이어 붙일 때 공백이 필요한가 — 언어와 무관한 부분.
 *
 * (테스트에서 직접 부를 수 있게 내보낸다. 이 판단은 규칙이 많아
 *  픽스처만으로는 어떤 규칙이 깨졌는지 짚어내기 어렵다.)
 *
 * **문장부호 판정을 한글 판정보다 먼저 해야 한다.** 예전에는 "앞이 한글로 끝날
 * 때만" 한글 규칙을 태웠는데, 그러면 `보상,`+`일자리의`나 `한다.`+`나아가`가
 * 라틴 규칙으로 떨어졌다. 라틴 규칙은 뒤가 영문·숫자일 때만 공백을 넣으므로
 * 한글이 오면 그냥 붙어 버렸다(`한다.나아가`).
 *
 * @returns {boolean|null} 확정이면 true/false, 언어별 판단이 필요하면 null
 */
export function punctuationJoinRule(prev) {
    // 가운뎃점·붙임표로 끝나면 이어지는 표기다(`공정성·포용성`).
    if (/[·・‧/\-]$/.test(prev)) return false;
    // 다른 문장부호로 끝나면 어절 경계가 확실하다.
    if (/[.,!?;:)\]}」』”’…、。]$/.test(prev)) return true;
    return null;
}

export function koreanJoinNeedsSpace(prevText, nextText) {
    const prev = String(prevText).trimEnd();
    const next = String(nextText).trim();

    // ① 앞 줄이 **홀로 못 쓰는 한 글자**로 끝나면 어절 중간에서 끊긴 것이다.
    //    `…칙을 존` + `중하고` → `존중하고`,  `…추진하기 위` + `하여` → `위하여`.
    const lastToken = prev.split(/\s+/).pop() || '';
    if ([...lastToken].length === 1 && /[가-힣]/.test(lastToken)
        && !STANDALONE_SYLLABLES.has(lastToken)) {
        return false;
    }

    // ② 뒤 줄이 **홀로 못 쓰는 조사·어미**로 시작하면 이어지는 것이다.
    //    `…인류 차원` + `에서는` → `차원에서는`.
    const first = next.split(/\s+/)[0] || '';
    if ([...first].length < 2) return true;   // 한 글자는 조사인지 낱말인지 모른다
    // 앞 어절이 보조적 연결어미(-아야/어야/게/지)로 끝나면 뒤의 `한다`·`된다`는
    // 어미가 아니라 **보조용언**이다. `흘러야 한다`를 `흘러야한다`로 붙이면 안 된다.
    if (/[야게지]$/.test(lastToken)) return true;

    if (KOREAN_BOUND_TOKENS.has(first)) return false;
    if (HA_DOE_ENDING.test(first)) return false;
    return true;
}

const HANGUL_END = /[가-힣]$/;
const HANGUL_START = /^[가-힣]/;

/**
 * 글머리 기호. 이것들이 뒤 글자와 떨어져 있으면 **열 경계가 아니라 목록 표시**다.
 * 구분하지 못하면 불릿 문단이 통째로 2열 표가 된다(23쪽 문서에서 실제로 그랬다).
 */
const BULLET_CHARS = /^[\u25CF\u26AB\u2022\u00B7\uFF65\u25A0\u25A1\u25CB\u25E6\u2023\u2043\u203B\u2219\u30FB\u2756\u25B8\u25AA-]+$/;

/** 줄 맨 앞의 글머리 기호. 뒤에 공백이 없어도 목록 표시다(`⚫AI 행위자는`). */
const LEADING_BULLET = /^([\u25CF\u26AB\u2022\u00B7\uFF65\u25A0\u25A1\u25CB\u25E6\u2023\u2043\u203B\u2219\u30FB\u2756\u25B8\u25AA])\s*/;

/**
 * 조각의 가로 폭.
 *
 * pdf.js가 주는 `width`는 **믿을 수 없을 때가 있다.** 실측하면
 *   `"⚫"` → w=0.0    (0일 리가 없다)
 *   `" "`  → w=55.8   (11pt 글꼴의 공백이 55.8pt일 리가 없다)
 * 둘 다 간격 계산을 망가뜨려 문단을 표로 만들었다.
 *
 * 그래서 값이 그럴듯할 때만 쓰고, 아니면 글자 수와 글자 크기로 추정한다.
 * 한글·한자·가나는 글자 크기만큼, 나머지는 그 절반으로 잡는다.
 */
function itemWidth(it) {
    const size = it.h || 10;
    const chars = [...(it.s || '')];
    if (!chars.length) return 0;

    let est = 0;
    for (const ch of chars) {
        est += /[\u1100-\u11FF\u2E80-\uA4CF\uA960-\uA97F\uAC00-\uD7FF\uF900-\uFAFF\uFE30-\uFE4F\uFF00-\uFF60\u2E80-\u303F\u3040-\u30FF\u25A0-\u27BF]/.test(ch)
            ? size : size * 0.5;
    }
    // 보고된 폭이 추정치의 0.3~2.5배 안이면 그대로 믿는다.
    if (it.w > 0 && it.w >= est * 0.3 && it.w <= est * 2.5) return it.w;
    return est;
}

/**
 * 한 줄 안에서 가로 간격이 큰 지점을 열 경계로 본다.
 *
 * ── 공백 조각의 width는 믿을 수 없다 ──
 * 양쪽 정렬된 한글 문서에서 실측하면 이렇게 나온다(11pt 글꼴):
 *
 *   "AI"          x= 72.6  w=10.4   → 83.0에서 끝남
 *   " "           x= 83.0  w=55.8   ← 11pt 글꼴의 공백이 55.8pt?
 *   "행위자는 AI를" x= 89.8          ← 실제 전진은 6.8pt
 *
 * 예전에는 공백 조각을 **버리고** 그 엉터리 width로 열을 나눴다. 그래서
 *   ① 낱말이 붙어 버리고(`AI행위자는`)
 *   ② 한 줄이 여러 열로 쪼개져 **문단이 표로 둔갑했다**(23쪽 문서에서 표 19개).
 *
 * 그래서 width를 쓰지 않고 **좌표로 간격을 잰다.** 공백 조각은 "여기 공백이
 * 있었다"는 사실만 기억하고, 열을 나눌지는 실제 x 간격으로 판단한다.
 */
function splitColumns(line) {
    const gapThreshold = Math.max(6, (line.h || 10) * 0.9);
    const cols = [];
    let cur = null;
    let sawSpace = false;

    for (const it of line.items) {
        if (!it.s.trim()) {
            sawSpace = true;      // width는 보지 않는다
            continue;
        }
        // 앞 조각의 끝에서 이 조각의 시작까지가 진짜 간격이다.
        const w = itemWidth(it);
        const gap = cur ? (it.x - (cur.x + cur.w)) : 0;
        // 글머리 기호 하나만 있는 열은 열이 아니다. 뒤 글자와 한 덩어리로 둔다.
        const curIsBullet = cur && BULLET_CHARS.test(cur.s.trim());
        if (cur && (gap < gapThreshold || curIsBullet)) {
            if (sawSpace && !/\s$/.test(cur.s)) {
                cur.s += ' ';
                cur.runs.push({ text: ' ', bold: false, italic: false, color: DEFAULT_COLOR });
            }
            cur.s += it.s;
            cur.runs.push(...(it.runs || []));
            cur.w = (it.x + w) - cur.x;
        } else {
            cur = { s: it.s, x: it.x, w, runs: [...(it.runs || [])] };
            cols.push(cur);
        }
        sawSpace = false;
    }
    return cols
        .map(c => ({ text: c.s.trim(), x: c.x, w: c.w, runs: trimRuns(c.runs) }))
        .filter(c => c.text);
}

/** 같은 서식이 이어지면 하나로 합친다. 잘게 쪼개진 run은 XML만 불린다. */
function mergeRuns(runs) {
    const out = [];
    for (const r of runs || []) {
        if (!r || !r.text) continue;
        const last = out[out.length - 1];
        if (last && last.bold === r.bold && last.italic === r.italic && last.color === r.color) {
            last.text += r.text;
        } else {
            out.push({ ...r });
        }
    }
    return out;
}

/** 앞뒤 공백을 잘라낸다 — 조각 단위로 붙은 공백이 run 경계에 남지 않게. */
function trimRuns(runs) {
    const merged = mergeRuns(runs);
    if (merged.length) {
        merged[0].text = merged[0].text.replace(/^\s+/, '');
        merged[merged.length - 1].text = merged[merged.length - 1].text.replace(/\s+$/, '');
    }
    return merged.filter(r => r.text);
}

/**
 * 공통 IR 계약에 맞는 run 배열로 만든다.
 *
 * 서식이 하나도 없으면 `runs`를 아예 붙이지 않는다 — 기존 출력과 바이트가
 * 같아야 다른 포맷의 회귀 검사가 이 변경에 걸리지 않는다.
 */
function runsForBlock(runs) {
    const merged = mergeRuns(runs);
    const plain = merged.every(r => !r.bold && !r.italic && (!r.color || r.color === DEFAULT_COLOR));
    if (plain) return null;
    return merged.map(r => {
        const out = { text: r.text };
        if (r.bold) out.bold = true;
        if (r.italic) out.italic = true;
        if (r.color && r.color !== DEFAULT_COLOR) out.color = r.color;
        return out;
    });
}

/** runs 앞에서 n글자를 떼어낸다. 글머리 기호를 없앨 때 쓴다. */
function stripLeadingChars(runs, n) {
    let left = n;
    const out = [];
    for (const r of runs || []) {
        if (left <= 0) { out.push(r); continue; }
        const len = [...r.text].length;
        if (len <= left) { left -= len; continue; }
        out.push({ ...r, text: [...r.text].slice(left).join('') });
        left = 0;
    }
    return out;
}

/** 여러 열/줄의 runs를 이어 붙인다(사이에 구분 문자를 넣어). */
function joinRuns(groups, sep) {
    const out = [];
    groups.forEach((g, i) => {
        if (i > 0 && sep) out.push({ text: sep, bold: false, italic: false, color: DEFAULT_COLOR });
        out.push(...(g || []));
    });
    return out;
}

// ─────────────────────────────────────────────────────────────────────────
// [2단계] 줄 → 블록
// ─────────────────────────────────────────────────────────────────────────

/** 최빈 글자 높이 = 본문 크기. 소수점을 0.5 단위로 뭉쳐 잡음을 줄인다. */
function bodyFontSize(lines) {
    const hist = new Map();
    for (const l of lines) {
        const key = Math.round((l.h || 0) * 2) / 2;
        if (key <= 0) continue;
        // 긴 줄일수록 본문일 가능성이 높으므로 글자 수로 가중한다.
        const weight = l.items.reduce((n, i) => n + i.s.trim().length, 0);
        hist.set(key, (hist.get(key) || 0) + weight);
    }
    let best = 0, bestW = -1;
    for (const [size, w] of hist) if (w > bestW) { best = size; bestW = w; }
    return best || 10;
}

/** 본문 왼쪽 여백 = 본문 크기 줄들의 최소 x(최빈값). */
function bodyLeftMargin(lines, bodySize) {
    const xs = lines
        .filter(l => Math.abs(l.h - bodySize) < 0.6 && l.items.length)
        .map(l => Math.round(l.items[0].x));
    if (!xs.length) return 0;
    const hist = new Map();
    for (const x of xs) hist.set(x, (hist.get(x) || 0) + 1);
    let best = xs[0], bestN = -1;
    for (const [x, n] of hist) if (n > bestN) { best = x; bestN = n; }
    return best;
}

/** 한 줄에 쓰인 글꼴 식별자 집합. 머리행 판정의 근거로 쓴다. */
function lineFonts(line) {
    const s = new Set();
    for (const it of line?.items || []) if (it.s.trim() && it.font) s.add(it.font);
    return s;
}

/**
 * 목록 들여쓰기 한 단계의 폭을 문서에서 직접 구한다.
 *
 * 고정 상수를 쓰면 문서마다 어긋난다 — 1단계 목록이 레벨 1로 잡히거나
 * 2단계가 1단계로 눌린다. 관측된 들여쓰기 값 중 가장 작은 것을 한 단계로
 * 본다(그것이 곧 "첫 들여쓰기"다).
 */
function indentStepOf(lines, bodySize, leftMargin) {
    const indents = lines
        .filter(l => Math.abs(l.h - bodySize) < 0.6 && l.items.length)
        .map(l => Math.round(l.items[0].x - leftMargin))
        .filter(d => d > bodySize * 0.5);
    if (!indents.length) return bodySize * 2;
    return Math.min(...indents);
}

/** 두 줄의 열 경계가 같은 표에 속한다고 볼 만큼 맞는가. */
function columnsAlign(a, b, tolerance) {
    if (a.length !== b.length || a.length < 2) return false;
    for (let i = 0; i < a.length; i++) {
        if (Math.abs(a[i].x - b[i].x) > tolerance) return false;
    }
    return true;
}

/**
 * 줄 목록에서 표 구간을 찾는다.
 * 열 개수가 2 이상이고 경계가 맞는 줄이 2줄 이상 연속하면 표로 본다.
 *
 * 한 줄짜리 "표처럼 보이는 줄"은 표로 만들지 않는다 — 들여쓴 문단이나
 * 좌우 정렬된 머리말이 표로 둔갑하면 원문보다 나쁜 결과가 된다.
 */
function findTableRuns(lines, colsOf, bodySize) {
    const tol = Math.max(4, bodySize * 0.8);
    const runs = [];
    let i = 0;
    while (i < lines.length) {
        const cols = colsOf(i);
        if (cols.length < 2) { i++; continue; }
        let j = i + 1;
        while (j < lines.length && columnsAlign(cols, colsOf(j), tol)) j++;
        if (j - i >= 2) {
            let start = i;

            // 머리행은 가운데 정렬되는 경우가 많아 x 좌표가 본문 행과 어긋난다.
            // 좌표만 보면 머리행이 표에서 떨어져 나가 "들여쓴 줄" — 즉 목록으로
            // 오분류된다(실제로 그랬다). 열 **개수**가 같고 줄 간격이 표 안
            // 행 간격과 비슷하면 머리행으로 끌어들인다.
            const prev = start - 1;
            if (prev >= 0 && colsOf(prev).length === cols.length) {
                const rowGap = lines[start].y - lines[start + 1].y;
                const headGap = lines[prev].y - lines[start].y;
                if (headGap > 0 && headGap <= rowGap * 1.8) start = prev;
            }

            runs.push({ start, end: j - 1 });
            i = j;
        } else {
            i++;
        }
    }
    return runs;
}

/**
 * PDF 페이지들의 줄을 IR 블록으로 바꾼다.
 * @returns {{blocks:Array, audit:object}}
 */
function linesToBlocks(pages) {
    const allLines = pages.flatMap(p => p.lines);
    const bodySize = bodyFontSize(allLines);
    const leftMargin = bodyLeftMargin(allLines, bodySize);
    const indentStep = indentStepOf(allLines, bodySize, leftMargin);

    // 제목 후보 크기: 본문보다 15% 이상 큰 것들을 내림차순으로 레벨화
    const headingSizes = [...new Set(
        allLines.map(l => Math.round(l.h * 2) / 2).filter(h => h > bodySize * 1.15)
    )].sort((a, b) => b - a).slice(0, 6);

    const blocks = [];
    const audit = {
        sourceFormat: 'pdf',
        status: 'inferred',
        bodyFontSizePt: bodySize,
        headingSizesPt: headingSizes,
        indentStepPt: Math.round(indentStep * 10) / 10,
        pages: pages.length,
        counts: { lines: allLines.length, headings: 0, paragraphs: 0, tables: 0, listItems: 0, images: 0 },
        // 쪽 장식(머리말·꼬리말·쪽번호)으로 보고 본문에서 뺀 글자.
        // 일부러 뺀 것을 기록해 두어야 "조용히 사라진 글자"와 구분된다.
        removedPageFurniture: [],
        // 글머리 기호처럼 **구조로 바뀐** 표시들. 잃어버린 것이 아니라
        // 목록 항목이 되었다는 뜻이다. 이것도 적어 두어야 "조용히 사라진 글자"와
        // 구분된다.
        convertedMarkers: [],
        notes: [],
    };

    // 쪽마다 반복되는 머리말·꼬리말·쪽번호를 먼저 걷어낸다. 본문 사이에
    // 계속 끼어들면 10쪽 문서에서 같은 문장이 10번 박힌다.
    const running = findRunningLines(pages);

    pages.forEach((page, pageIdx) => {
        // 괘선 표는 원래 좌표로 세워야 하므로, 단 재배열은 표에 쓰지 않는다.
        const kept = page.lines.filter((_, i) => {
            if (!running.has(`${pageIdx}:${i}`)) return true;
            // 무엇을 뺐는지 남긴다. 조용히 사라지는 글자가 있으면 안 된다 —
            // 일부러 뺀 것과 잃어버린 것을 구분할 수 없게 되기 때문이다.
            const t = (page.lines[i].items || []).map(x => x.s).join('').trim();
            if (t) audit.removedPageFurniture.push(t);
            return false;
        });
        const lines = orderByColumns(kept, page.width || 595);
        const colsCache = lines.map(l => splitColumns(l));
        const colsOf = i => colsCache[i] || [];
        const tableRuns = findTableRuns(lines, colsOf, bodySize);
        const inTable = new Set();
        for (const r of tableRuns) for (let k = r.start; k <= r.end; k++) inTable.add(k);

        // ── 괘선으로 세운 표 ──
        // 선이 있으면 추측할 필요가 없다. 공백 기반 추론보다 먼저 본다.
        // 쪽 하나에 표가 여럿일 수 있으므로 각각 따로 세운다 — 하나로 뭉치면
        // 제목과 본문 문단까지 표 안에 갇힌다.
        const grids = buildGrids(page.hLines, page.vLines);
        const gridLines = grids.map(g => fillCells(g, lines));
        const emitted = new Set();
        // 줄 번호 → 그 줄을 삼킨 표 번호
        const lineOwner = new Map();
        gridLines.forEach((set, gi) => { for (const li of set) if (!lineOwner.has(li)) lineOwner.set(li, gi); });

        const emitRuledTable = gi => {
            if (emitted.has(gi)) return;
            emitted.add(gi);
            const grid = grids[gi];
            const rows = [];
            for (let r = 0; r < grid.nRows; r++) {
                const rowCells = grid.cells
                    .filter(c => c.row === r)
                    .sort((a, b) => a.col - b.col)
                    .map(c => {
                        const runs = trimRuns(c.runs);
                        const cell = { text: runs.map(x => x.text).join('') };
                        const styled = runsForBlock(runs);
                        if (styled) cell.runs = styled;
                        if (c.colspan > 1) cell.colSpan = c.colspan;
                        if (c.rowspan > 1) cell.rowSpan = c.rowspan;
                        return cell;
                    });
                if (rowCells.length) rows.push(rowCells);
            }
            if (!rows.length) return;
            blocks.push(firstRowIsHeader(grid)
                ? { type: 'table', header: rows[0], rows: rows.slice(1) }
                : { type: 'table', rows });
            audit.counts.tables++;
        };

        let paraBuf = null;
        const flushPara = () => {
            if (paraBuf && paraBuf.text.trim()) {
                const runs = runsForBlock(trimRuns(paraBuf.runs));
                if (paraBuf.bullet) {
                    // 글머리 기호로 시작한 문단은 목록 항목이다. 문단으로 두면
                    // `⚫`가 본문 글자에 붙어 버리고 목록 구조도 사라진다.
                    const item = { text: paraBuf.text.trim(), level: paraBuf.level || 0 };
                    if (runs) item.runs = runs;
                    const last = blocks[blocks.length - 1];
                    if (last && last.type === 'list') last.items.push(item);
                    else blocks.push({ type: 'list', items: [item] });
                    audit.counts.listItems++;
                } else {
                    const block = { type: 'para', text: paraBuf.text.trim() };
                    if (runs) block.runs = runs;
                    blocks.push(block);
                    audit.counts.paragraphs++;
                }
            }
            paraBuf = null;
        };

        // 그림은 줄 사이에 끼워 넣는다. 위에 있는 것부터(PDF y는 위가 크다).
        const pending = [...(page.images || [])].sort((a, b) => b.top - a.top);
        const flushImagesAbove = y => {
            while (pending.length && pending[0].top >= y) {
                flushPara();
                blocks.push(pending.shift().block);
                audit.counts.images = (audit.counts.images || 0) + 1;
            }
        };

        for (let i = 0; i < lines.length; i++) {
            flushImagesAbove(lines[i].y + lines[i].h);

            // 괘선 표가 차지한 줄은 문단으로 다시 내보내지 않는다.
            if (lineOwner.has(i)) {
                flushPara();
                emitRuledTable(lineOwner.get(i));
                continue;
            }

            // ── 표(공백 기반 추론) ──
            const run = tableRuns.find(r => r.start === i);
            if (run) {
                flushPara();
                const rows = [];
                for (let k = run.start; k <= run.end; k++) rows.push(colsOf(k).map(c => c.text));
                // 첫 행을 머리행으로 볼 **근거**가 있는지 본다.
                //   (1) 글자가 더 크거나
                //   (2) 아래 행들과 다른 글꼴로 그려졌다(보통 굵은 변형)
                // 둘 다 없으면 머리행이라고 주장하지 않고 그냥 행으로 둔다.
                const headFonts = lineFonts(lines[run.start]);
                const bodyFonts = lineFonts(lines[run.start + 1]);
                const firstIsHeader =
                    lines[run.start].h > lines[run.start + 1].h + 0.3
                    || (headFonts.size > 0 && bodyFonts.size > 0
                        && ![...headFonts].some(f => bodyFonts.has(f)));
                blocks.push(firstIsHeader
                    ? { type: 'table', header: rows[0], rows: rows.slice(1) }
                    : { type: 'table', rows });
                audit.counts.tables++;
                i = run.end;
                continue;
            }
            if (inTable.has(i)) continue;

            const line = lines[i];
            const cols = colsOf(i);
            const text = cols.map(c => c.text).join(' ').trim();
            if (!text) continue;
            const lineRuns = joinRuns(cols.map(c => c.runs), ' ');

            const size = Math.round(line.h * 2) / 2;
            const headingIdx = headingSizes.indexOf(size);

            // ── 제목 ──
            if (headingIdx >= 0) {
                flushPara();
                const level = headingIdx + 1;
                const runs = runsForBlock(lineRuns);

                // 여러 줄로 놓인 제목은 한 제목이다. 표지의
                // `대한민국` / `인공지능 윤리원칙`이 두 제목으로 갈라지면
                // 문서 제목이 `대한민국`으로 잘린다.
                const last = blocks[blocks.length - 1];
                const prevLine = lines[i - 1];
                const contiguous = last && last.type === 'heading' && last.level === level
                    && prevLine && Math.abs(prevLine.h - line.h) < 0.6
                    && (prevLine.y - line.y) > 0
                    && (prevLine.y - line.y) <= line.h * 2.2
                    && !lineOwner.has(i - 1);

                if (contiguous) {
                    last.text += ` ${text}`;
                    if (last.runs || runs) {
                        last.runs = joinRuns([last.runs || [{ text: last.text }], runs || lineRuns], ' ');
                    }
                } else {
                    const block = { type: 'heading', level, text };
                    if (runs) block.runs = runs;
                    blocks.push(block);
                    audit.counts.headings++;
                }
                continue;
            }

            // ── 목록(들여쓰기 추론) ──
            // 들여쓰기는 **그 줄이 속한 단**의 왼쪽 끝을 기준으로 잰다.
            // 쪽 왼쪽을 기준으로 하면 2단 문서의 오른쪽 단 전체가 목록이 된다.
            const base = Number.isFinite(line.colLeft) ? line.colLeft : leftMargin;
            const lineX = line.items[0]?.x ?? base;
            const indent = lineX - base;
            const isIndented = indent > bodySize * 0.8;

            // 이 줄이 앞 줄에서 흐름이 이어지는가(간격·글자 크기·단 기준).
            const prev = lines[i - 1];
            const gap = prev ? (prev.y - line.y) : Infinity;
            const sameStyle = prev ? Math.abs(prev.h - line.h) < 0.6 : false;
            // 단이 바뀌면 문단은 이어지지 않는다. 왼쪽 단 맨 아래에서 오른쪽 단
            // 맨 위로 넘어가면 y가 **거꾸로 커져** 간격이 음수가 되는데, 그걸
            // 그냥 두면 "아주 가까운 줄"로 읽혀 두 단의 문장이 한 문단이 된다.
            const sameColumn = !prev || prev.colLeft === line.colLeft;
            const continues = paraBuf && sameStyle && sameColumn
                && gap > 0 && gap <= line.h * 1.9 && !inTable.has(i - 1);

            // ── 매달린 들여쓰기는 새 항목이 아니라 **이어지는 줄**이다 ──
            // 목록 항목이 줄을 넘기면 둘째 줄은 기호 너비만큼 더 들여쓴다.
            //   `⚫ AI 행위자는 … 방향으로`   ← x=57.6
            //   `   개발 및 활용한다.`        ← x=73.0
            // 들여쓰기만 보고 새 항목으로 만들면 한 항목이 두 개로 쪼개진다.
            // 항목 첫 줄보다 **더** 들여쓴 줄은 이어지는 줄로 본다.
            const hangingCont = continues && Number.isFinite(paraBuf.startX)
                && lineX > paraBuf.startX + bodySize * 0.3;

            if (isIndented && !hangingCont) {
                flushPara();
                // 첫 들여쓰기 단계가 레벨 0이다(문서에서 구한 indentStep 기준).
                // 목록 항목도 버퍼에 담는다 — 다음 줄이 이어질 수 있어야 한다.
                paraBuf = {
                    text,
                    runs: lineRuns,
                    bullet: true,
                    level: Math.min(2, Math.max(0, Math.round(indent / indentStep) - 1)),
                    colLeft: line.colLeft,
                    startX: lineX,
                };
                continue;
            }

            // ── 문단 (줄 이어붙이기) ──
            // 글머리 기호로 시작하는 줄은 **언제나 새 항목**이다. 이어 붙이면
            // 여러 항목이 한 문단으로 뭉친다(`…않다.· 하나의 개인이나…`).
            const bulletMatch = LEADING_BULLET.exec(text);
            if (bulletMatch) {
                flushPara();
                audit.convertedMarkers.push(bulletMatch[1]);
                const stripped = text.slice(bulletMatch[0].length);
                const strippedRuns = stripLeadingChars(lineRuns, bulletMatch[0].length);
                paraBuf = {
                    text: stripped,
                    runs: strippedRuns,
                    bullet: bulletMatch[1],
                    level: Math.min(2, Math.max(0, Math.round(indent / indentStep))),
                    colLeft: line.colLeft,
                    startX: lineX,
                };
                continue;
            }

            if (continues) {
                // 한글은 어절 사이에 공백이 필요하지만, 줄 끝에서 잘린 단어는
                // 붙여야 한다. 앞 줄이 문장부호로 끝나면 공백, 아니면 그대로 잇는다.
                // 줄이 바뀔 때 PDF는 그 자리의 공백을 **버린다**. 그래서 이어 붙일 때
                // 공백을 넣을지 판단해야 하는데, 한글에서는 **판단할 근거가 없다.**
                //
                //   `…왼쪽 단을` + `모두 읽은…`   → 원래 공백이 있었다(어절 경계)
                //   `…추진하기 위` + `하여 수립…`  → 원래 공백이 없었다(어절 중간)
                //
                // 둘 다 같은 Chrome이 만든 PDF이고, 끝나는 x 좌표도 둘 다 오른쪽
                // 여백에 붙어 있어 구별되지 않는다. 공백을 넣으면 `위 하여`가 되고
                // 넣지 않으면 `단을모두`가 된다 — 손실이 대칭이다.
                //
                // 근거 없이 고르지 않는다. 라틴 문자로 이어질 때만 공백을 넣는다
                // (영문은 어절 중간에서 줄을 바꾸지 않으므로 그때는 근거가 있다).
                // 한글 어절이 붙는 경우가 남는 것은 알려진 한계다.
                const punct = punctuationJoinRule(paraBuf.text.trimEnd());
                const needsSpace = punct !== null
                    ? punct
                    : (HANGUL_END.test(paraBuf.text) && HANGUL_START.test(text))
                        ? koreanJoinNeedsSpace(paraBuf.text, text)
                        : /[.!?。」』\p{L}\p{N}]$/u.test(paraBuf.text) && /^[A-Za-z0-9(]/.test(text);
                paraBuf.text += (needsSpace ? ' ' : '') + text;
                paraBuf.runs = joinRuns([paraBuf.runs, lineRuns], needsSpace ? ' ' : '');
            } else {
                flushPara();
                paraBuf = { text, runs: lineRuns, colLeft: line.colLeft, startX: lineX };
            }
        }
        flushPara();
        // 마지막 줄보다 아래에 있던 그림들.
        while (pending.length) {
            blocks.push(pending.shift().block);
            audit.counts.images = (audit.counts.images || 0) + 1;
        }
        // 페이지 경계는 빈 줄로만 표시한다(강제 쪽 나눔을 넣지 않는다).
        if (page !== pages[pages.length - 1]) blocks.push({ type: 'blank' });
    });

    if (running.size) {
        const sample = [...new Set(audit.removedPageFurniture)].slice(0, 3).join(' · ');
        audit.notes.push(
            `쪽마다 반복되는 머리말·꼬리말·쪽번호 ${running.size}줄을 본문에서 제외했습니다`
            + (sample ? ` (${sample})` : '') + '.');
    }

    return { blocks, audit };
}

// ─────────────────────────────────────────────────────────────────────────
// [진입점]
// ─────────────────────────────────────────────────────────────────────────

/**
 * PDF 바이트를 공통 IR로 바꾼다.
 *
 * @param {ArrayBuffer|Uint8Array} buffer
 * @param {{docType?:string, maxPages?:number}} [options]
 * @returns {Promise<object>} IR ({title, doc_type, blocks, audit})
 */
export async function parsePdf(buffer, options = {}) {
    const pdfjs = await loadPdfjs();
    const maxPages = Number.isFinite(options.maxPages) ? options.maxPages : 300;

    let doc;
    try {
        doc = await pdfjs.getDocument({
            data: buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer),
            useSystemFonts: true,
            // 글꼴 파일을 따로 받지 않는다 — 텍스트 추출에는 필요 없고
            // 외부 요청을 늘리지 않는다는 이 프로젝트의 원칙과도 맞다.
            disableFontFace: true,

            // ── 한글 PDF에 이게 없으면 글자가 깨진다 ──
            // 한국어 PDF는 흔히 미리 정의된 CMap(UniKS-UCS2-H, KSCms-UHC-H,
            // Adobe-Korea1 계열)을 쓰는 Type0/CIDFont로 만들어진다. ToUnicode가
            // 없으면 pdf.js는 이 bcmap 파일을 읽어야 유니코드를 복원할 수 있다.
            // 없으면 조용히 깨진 글자나 빈 문자열이 나오고, 증상은 "어떤 PDF는
            // 되고 어떤 건 안 된다"로 보인다. 한글이 주 대상인 도구에서
            // 이건 치명적이라 파일을 함께 둔다(요청은 self-origin이라 CSP 통과).
            // 끝 슬래시는 선택이 아니다 — pdf.js가 없으면 예외를 던진다.
            cMapUrl: `${PDFJS_DIR}cmaps/`,
            cMapPacked: true,
        }).promise;
    } catch (err) {
        throw new Error('PDF를 열지 못했습니다(암호 보호되었거나 손상된 파일일 수 있습니다).');
    }

    try {
        const pageCount = Math.min(doc.numPages, maxPages);
        const pages = [];
        let rawItemCount = 0;
        let imageCounter = 0;

        for (let p = 1; p <= pageCount; p++) {
            const page = await doc.getPage(p);

            // 그림·괘선·글자색을 연산자 목록 한 번으로 모은다. 그리고 이 호출이
            // commonObjs를 채우므로, 글꼴의 **원래 이름**을 읽으려면 어차피 먼저
            // 해야 한다(getTextContent만으로는 글꼴 이름을 얻을 수 없다).
            const gfx = await extractGraphics(page, pdfjs.OPS);
            const seq = gfx.colorChars;
            const cursor = { i: 0 };

            const tc = await page.getTextContent();
            rawItemCount += tc.items.length;

            const items = tc.items
                .filter(i => typeof i.str === 'string' && i.str.length > 0)
                .map(i => {
                    const realName = fontRealName(page, i.fontName);
                    const { bold, italic } = styleOf(realName, i.transform);
                    const runs = splitByColor(i.str, seq, cursor)
                        .map(r => ({ text: r.text, bold, italic, color: r.color }));
                    return {
                        s: i.str,
                        x: i.transform[4],
                        y: i.transform[5],
                        h: i.height || Math.abs(i.transform[3]) || 0,
                        w: i.width || 0,
                        // 글꼴 식별자는 머리행 판정의 **근거**다. 표 머리행은 보통
                        // 본문과 다른 글꼴(굵은 변형)로 그려진다. 크기가 같아도
                        // 글꼴이 다르면 그건 추측이 아니라 관찰이다.
                        font: i.fontName || '',
                        runs,
                    };
                });

            // 머리말·꼬리말은 "쪽 가장자리에 있는가"로 판단하므로 쪽 크기가 필요하다.
            const view = page.view || [0, 0, 595, 842];
            pages.push({
                number: p,
                width: view[2] - view[0],
                height: view[3] - view[1],
                yBottom: view[1],
                lines: assembleLines(items),
                images: await toImageBlocks(gfx.images, imageCounter),
                hLines: gfx.hLines,
                vLines: gfx.vLines,
            });
            imageCounter += gfx.images.length;
            page.cleanup();
        }

        const { blocks, audit } = linesToBlocks(pages);
        audit.truncatedPages = doc.numPages > pageCount ? doc.numPages - pageCount : 0;

        // 글자 레이어가 없는 스캔 PDF — 추출할 것이 없다는 사실을 분명히 말한다.
        if (rawItemCount === 0 || blocks.every(b => b.type === 'blank' || b.type === 'image')) {
            throw new Error(
                'PDF에서 글자를 찾지 못했습니다. 스캔한 이미지로만 된 PDF일 수 있습니다'
                + '(글자 인식(OCR)은 지원하지 않습니다).'
            );
        }

        // 첫 제목을 문서 제목으로 승격한다(다른 파서와 같은 규약).
        let title = '';
        const firstHeadingIdx = blocks.findIndex(b => b.type === 'heading' && b.level === 1);
        if (firstHeadingIdx !== -1) {
            title = blocks[firstHeadingIdx].text;
            blocks.splice(firstHeadingIdx, 1);
        } else {
            const firstPara = blocks.find(b => b.type === 'para' && b.text.trim());
            title = firstPara ? firstPara.text.slice(0, 60) : 'PDF 문서';
        }

        audit.notes.push('PDF는 레이아웃 형식이라 문단·표·목록은 좌표와 글자 크기로 추론했습니다.');
        audit.notes.push('그림, 셀 병합, 글꼴·색은 가져오지 않습니다.');
        if (audit.truncatedPages > 0) {
            audit.notes.push(`${doc.numPages}쪽 중 ${pageCount}쪽만 변환했습니다.`);
        }

        return {
            title,
            doc_type: options.docType || 'plain',
            blocks,
            audit,
        };
    } finally {
        // pdf.js 버전에 따라 destroy가 없을 수 있다. 정리 실패가 변환 실패를
        // 덮어써서는 안 되므로 조용히 넘긴다.
        try { await doc.cleanup?.(); } catch { /* 정리 실패는 무시 */ }
        try { await doc.destroy?.(); } catch { /* 정리 실패는 무시 */ }
    }
}
