/* ===================================================================
 * [pdf-style.js] PDF 글자 서식(굵게·기울임·색) 복원
 * ===================================================================
 * PDF는 "굵게"라는 속성을 담지 않는다. 굵은 글자는 **다른 글꼴 파일**로
 * 그려질 뿐이다. 기울임도 마찬가지고, 만드는 프로그램에 따라서는 글꼴이
 * 아니라 **글자 행렬을 기울여서**(synthetic oblique) 만든다.
 *
 * 그래서 세 곳을 본다.
 *
 *   굵게  글꼴 이름 — `AAAAAA+MalgunGothicBold`처럼 이름에 무게가 들어 있다.
 *         pdf.js는 `commonObjs.get(fontName).name`으로 원래 이름을 준다.
 *         (열거 가능한 속성이 아니라 `getOwnPropertyNames`에는 안 나온다.
 *          직접 `.name`으로 읽어야 한다 — v6.3 기준으로 확인.)
 *
 *   기울임 이름에 italic/oblique가 있거나, **글자 행렬의 기울기**가 0이 아니다.
 *         Chrome이 만든 PDF는 보통 후자다(같은 글꼴 + 행렬 c=0.25·d).
 *
 *   색    `getTextContent()`는 색이 바뀌어도 조각을 **합쳐서** 준다.
 *         "그리고 빨간 글자와"가 검정-빨강-검정인데 한 덩어리로 온다.
 *         그래서 색만은 연산자 목록에서 글리프 단위로 읽어야 하고, 그 수집은
 *         `pdf-graphics.js`가 그림·괘선과 **한 번에** 한다(연산자 목록을 여러 번
 *         훑으면 큰 문서에서 같은 일을 반복하게 된다). 여기서는 그 결과를
 *         조각에 붙이는 일만 한다.
 *
 * 이 파일은 IR을 만들지 않는다. 글자 조각에 붙일 서식만 계산한다.
 * ===================================================================*/

'use strict';

/** 이름에 무게가 드러나는 흔한 표기. `Semibold`·`Heavy`·`-Bd`까지 본다. */
const BOLD_NAME = /(bold|black|heavy|semibold|demibold|extrabold|ultrabold|[-_,]bd\b|[-_,]blk\b)/i;

/** 기울임을 이름으로 드러내는 표기. */
const ITALIC_NAME = /(italic|oblique|[-_,]it\b|[-_,]obl\b)/i;

/**
 * 글자 행렬의 기울기 임계값.
 *
 * synthetic oblique는 보통 0.2~0.3(약 12~17°)이다. 0.1 미만은 반올림 오차나
 * 아주 살짝 기운 로고 텍스트일 수 있어 기울임으로 보지 않는다.
 */
const SKEW_THRESHOLD = 0.1;

/** 기본 글자색. 이 색이면 run에 색을 적지 않는다(불필요한 charPr을 늘리지 않는다). */
const DEFAULT_COLOR = '#000000';

/**
 * 글꼴 이름과 글자 행렬로 굵게·기울임을 판정한다.
 *
 * @param {string} fontName pdf.js가 준 원래 글꼴 이름(`AAAAAA+MalgunGothicBold`)
 * @param {number[]} transform 글자 행렬 [a,b,c,d,e,f]
 */
export function styleOf(fontName, transform) {
    // 서브셋 접두사(`AAAAAA+`)는 무게와 무관하다. 떼고 본다.
    const name = String(fontName || '').replace(/^[A-Z]{6}\+/, '');
    const bold = BOLD_NAME.test(name);

    let italic = ITALIC_NAME.test(name);
    if (!italic && Array.isArray(transform) && transform.length >= 4) {
        const [, , c, d] = transform;
        if (d) italic = Math.abs(c / d) > SKEW_THRESHOLD;
    }
    return { bold, italic };
}

/**
 * 글자 조각(item) 하나를 색이 바뀌는 지점에서 잘라 run으로 만든다.
 *
 * `colorChars`와 조각의 글자를 앞에서부터 맞춰 나간다. pdf.js가 조각 사이에
 * **없던 공백을 넣기도** 하므로, 맞지 않으면 그 글자는 건너뛰되 색은 유지한다.
 * 억지로 맞추려 하지 않는다 — 색을 하나 놓치는 것이 글자를 잃는 것보다 낫다.
 *
 * @param {string} text 조각의 글자
 * @param {{u:string,color:string}[]} seq  페이지 전체의 글자별 색
 * @param {{i:number}} cursor  seq에서 어디까지 썼는지(호출자가 이어서 씀)
 * @returns {{text:string,color:string}[]}
 */
export function splitByColor(text, seq, cursor) {
    const parts = [];
    let cur = null;

    for (const ch of text) {
        let color = DEFAULT_COLOR;

        // 앞으로 조금만 훑어 같은 글자를 찾는다. 멀리 가면 다른 곳의
        // 같은 글자를 잘못 집어 색이 통째로 어긋난다.
        let hit = -1;
        for (let k = cursor.i; k < Math.min(seq.length, cursor.i + 4); k++) {
            if (seq[k].u === ch) { hit = k; break; }
        }
        if (hit !== -1) {
            color = seq[hit].color;
            cursor.i = hit + 1;
        } else if (cur) {
            color = cur.color;      // 합성 공백 등 — 앞 색을 잇는다
        }

        if (cur && cur.color === color) cur.text += ch;
        else { cur = { text: ch, color }; parts.push(cur); }
    }
    return parts;
}

export { DEFAULT_COLOR };
