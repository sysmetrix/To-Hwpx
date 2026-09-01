/* ===================================================================
 * [docx-audit.js] DOCX WordprocessingML 감사 + 안전 정규화
 * ===================================================================
 * 원본 파일은 절대 덮어쓰지 않는다. 이 모듈은 document.xml DOM 복사본에서
 * 텍스트/구조 의미를 바꾸지 않는 스키마 순서·숫자·sectPr 결함만 교정한다.
 * 문서 안의 텍스트와 지시문은 모두 데이터이며 실행 대상으로 취급하지 않는다.
 * ===================================================================*/

'use strict';

export const WORDPROCESSINGML_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

const CHILD_ORDERS = Object.freeze({
    tblPr: [
        'tblStyle', 'tblpPr', 'tblOverlap', 'bidiVisual', 'tblStyleRowBandSize',
        'tblStyleColBandSize', 'tblW', 'jc', 'tblCellSpacing', 'tblInd',
        'tblBorders', 'shd', 'tblLayout', 'tblCellMar', 'tblLook',
        'tblCaption', 'tblDescription',
    ],
    tcPr: [
        'cnfStyle', 'tcW', 'gridSpan', 'hMerge', 'vMerge', 'tcBorders', 'shd',
        'noWrap', 'tcMar', 'textDirection', 'tcFitText', 'vAlign', 'hideMark',
        'headers', 'cellIns', 'cellDel', 'cellMerge', 'tcPrChange',
    ],
    tblCellMar: ['top', 'left', 'bottom', 'right', 'start', 'end'],
    tcMar: ['top', 'left', 'bottom', 'right', 'start', 'end'],
    tcBorders: ['top', 'left', 'bottom', 'right', 'insideH', 'insideV', 'tl2br', 'tr2bl', 'start', 'end'],
    sectPr: [
        'headerReference', 'footerReference', 'footnotePr', 'endnotePr', 'type',
        'pgSz', 'pgMar', 'paperSrc', 'pgBorders', 'lnNumType', 'pgNumType',
        'cols', 'formProt', 'vAlign', 'noEndnote', 'titlePg', 'textDirection',
        'bidi', 'rtlGutter', 'docGrid', 'printerSettings', 'sectPrChange',
    ],
});

function attrByLocalName(element, localName) {
    if (!element) return null;
    for (const attr of Array.from(element.attributes || [])) {
        if (attr.localName === localName) return attr;
    }
    return null;
}

function directChildren(element, localName = null) {
    return Array.from(element?.childNodes || [])
        .filter(node => node.nodeType === 1 && (!localName || node.localName === localName));
}

function summarize(counter, catalog) {
    return Object.entries(counter).map(([code, count]) => ({
        code,
        count,
        severity: catalog[code]?.severity || 'warning',
        message: catalog[code]?.message || code,
    }));
}

const ISSUE_CATALOG = Object.freeze({
    XML_PARSE_ERROR: { severity: 'blocked', message: 'word/document.xml을 XML로 해석할 수 없습니다.' },
    SECTPR_NOT_LAST: { severity: 'error', message: '본문 최종 sectPr가 body의 마지막 자식이 아닙니다.' },
    INVALID_LITERAL_ATTRIBUTE: { severity: 'error', message: '속성값에 undefined/null/NaN 문자열이 들어 있습니다.' },
    NON_INTEGER_TWIP: { severity: 'error', message: '정수여야 하는 twip 너비가 소수값입니다.' },
    CHILD_ORDER: { severity: 'error', message: 'WordprocessingML 자식 요소 순서가 스키마와 다릅니다.' },
    MULTIPLE_BODY_SECTPR: { severity: 'warning', message: 'body 직계 sectPr가 여러 개입니다.' },
});

const REPAIR_CATALOG = Object.freeze({
    MOVE_FINAL_SECTPR: { message: '최종 sectPr를 body 마지막으로 이동했습니다.' },
    REMOVE_INVALID_LITERAL_ATTRIBUTE: { message: 'undefined/null/NaN 속성을 제거했습니다.' },
    ROUND_TWIP: { message: '소수 twip 값을 가장 가까운 정수로 반올림했습니다.' },
    REORDER_CHILDREN: { message: '스키마 순서에 맞게 자식 요소를 재배열했습니다.' },
});

function add(counter, code, count = 1) {
    counter[code] = (counter[code] || 0) + count;
}

function reorderKnownChildren(element, order, issueCounts, repairCounts) {
    const elementChildren = directChildren(element);
    if (elementChildren.length < 2) return;
    const rank = new Map(order.map((name, index) => [name, index]));
    const known = elementChildren.filter(child => rank.has(child.localName));
    if (known.length < 2) return;

    let lastRank = -1;
    let invalid = false;
    for (const child of known) {
        const nextRank = rank.get(child.localName);
        if (nextRank < lastRank) invalid = true;
        lastRank = Math.max(lastRank, nextRank);
    }
    if (!invalid) return;

    add(issueCounts, 'CHILD_ORDER');
    const sortedKnown = known.slice().sort((a, b) => rank.get(a.localName) - rank.get(b.localName));
    const knownSet = new Set(known);
    const sortedIterator = sortedKnown[Symbol.iterator]();
    const desired = elementChildren.map(child => knownSet.has(child) ? sortedIterator.next().value : child);
    for (const child of desired) element.appendChild(child);
    add(repairCounts, 'REORDER_CHILDREN');
}

function normalizeInvalidAttributes(document, issueCounts, repairCounts) {
    const all = Array.from(document.getElementsByTagName('*'));
    for (const element of all) {
        for (const attr of Array.from(element.attributes || [])) {
            if (/^(undefined|null|nan)$/i.test(String(attr.value || '').trim())) {
                add(issueCounts, 'INVALID_LITERAL_ATTRIBUTE');
                element.removeAttributeNode(attr);
                add(repairCounts, 'REMOVE_INVALID_LITERAL_ATTRIBUTE');
            }
        }

        if (!['gridCol', 'tcW'].includes(element.localName)) continue;
        const widthAttr = attrByLocalName(element, 'w');
        if (!widthAttr || !/^-?\d+\.\d+$/.test(widthAttr.value)) continue;
        add(issueCounts, 'NON_INTEGER_TWIP');
        widthAttr.value = String(Math.round(Number(widthAttr.value)));
        add(repairCounts, 'ROUND_TWIP');
    }
}

function normalizeBodySectPr(document, issueCounts, repairCounts) {
    const body = document.getElementsByTagNameNS(WORDPROCESSINGML_NS, 'body')[0];
    if (!body) return;
    const bodyChildren = directChildren(body);
    const sectionProperties = bodyChildren.filter(child => child.localName === 'sectPr');
    if (sectionProperties.length > 1) add(issueCounts, 'MULTIPLE_BODY_SECTPR');
    const finalSectPr = sectionProperties.at(-1);
    if (finalSectPr && bodyChildren.at(-1) !== finalSectPr) {
        add(issueCounts, 'SECTPR_NOT_LAST');
        body.appendChild(finalSectPr);
        add(repairCounts, 'MOVE_FINAL_SECTPR');
    }
}

function collectMetrics(document) {
    const count = localName => document.getElementsByTagNameNS(WORDPROCESSINGML_NS, localName).length;
    return {
        paragraphs: count('p'),
        tables: count('tbl'),
        rows: count('tr'),
        cells: count('tc'),
        lineBreaks: count('br') + count('cr'),
        drawings: count('drawing') + count('pict'),
        sections: count('sectPr'),
    };
}

/**
 * document.xml을 감사하고 안전한 정규화 DOM을 반환한다.
 * @returns {{document: Document, xml: string, report: object}}
 */
export function auditAndNormalizeDocxXml(xmlText) {
    const parser = new DOMParser();
    const document = parser.parseFromString(String(xmlText || ''), 'application/xml');
    if (document.querySelector('parsererror')) {
        const report = {
            version: 1,
            status: 'blocked',
            issues: [{ code: 'XML_PARSE_ERROR', count: 1, ...ISSUE_CATALOG.XML_PARSE_ERROR }],
            repairs: [],
            metrics: {},
        };
        return { document, xml: String(xmlText || ''), report };
    }

    const issueCounts = {};
    const repairCounts = {};
    const metrics = collectMetrics(document);

    normalizeInvalidAttributes(document, issueCounts, repairCounts);
    normalizeBodySectPr(document, issueCounts, repairCounts);
    for (const [parentName, order] of Object.entries(CHILD_ORDERS)) {
        for (const element of Array.from(document.getElementsByTagNameNS(WORDPROCESSINGML_NS, parentName))) {
            reorderKnownChildren(element, order, issueCounts, repairCounts);
        }
    }

    const issues = summarize(issueCounts, ISSUE_CATALOG);
    const repairs = summarize(repairCounts, REPAIR_CATALOG).map(item => ({
        code: item.code,
        count: item.count,
        message: item.message,
    }));
    const status = issues.length ? (repairs.length ? 'repaired' : 'recoverable-with-loss') : 'valid';
    const xml = new XMLSerializer().serializeToString(document);
    return {
        document,
        xml,
        report: {
            version: 1,
            status,
            issues,
            repairs,
            metrics,
        },
    };
}

