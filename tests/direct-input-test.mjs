import assert from 'node:assert/strict';
import {
    detectDirectInput, diagnoseDirectInput, DIRECT_INPUT_LIMITS, DIRECT_INPUT_SCHEMA,
} from '../js/direct-input.js';

const cases = [
    [{ plainText: '{"title":"보고서","items":[1,2]}' }, 'json'],
    [{ plainText: '이름\t수량\n사과\t2\n배\t3' }, 'csv'],
    [{ plainText: '<h1>제목</h1><p>본문</p>' }, 'html'],
    [{ plainText: '# 제목\n\n- 항목\n- 항목' }, 'md'],
    [{ plainText: '문법 표지가 없는 일반 문장입니다.' }, 'txt'],
    [{ plainText: '안녕하세요, 반갑습니다.\n오늘은, 날씨가 좋습니다.' }, 'txt'],
    [{ plainText: '복사된 문장', htmlText: '<p><strong>복사된</strong> 문장</p>' }, 'html'],
];

for (const [input, expected] of cases) {
    const actual = detectDirectInput(input);
    assert.equal(actual.format, expected, `${expected} 감지 실패: ${JSON.stringify(actual)}`);
    assert.ok(actual.confidence >= 0 && actual.confidence <= 1);
    assert.ok(actual.evidence);
}

const jsonErrors = diagnoseDirectInput('{\n  "a": 1,\n}', 'json');
assert.equal(jsonErrors[0].code, 'json-invalid');
assert.equal(jsonErrors[0].severity, 'error');
assert.ok(jsonErrors[0].line >= 2);

const csvErrors = diagnoseDirectInput('a,b\n"열린 셀,b', 'csv');
assert.ok(csvErrors.some(item => item.code === 'csv-open-quote' && item.line === 2));

const mdWarnings = diagnoseDirectInput('# 제목\n\n```js\nalert(1)', 'md');
assert.ok(mdWarnings.some(item => item.code === 'md-open-fence'));

const htmlWarnings = diagnoseDirectInput('<p>본문</p><script>alert(1)</script>', 'html');
assert.ok(htmlWarnings.some(item => item.code === 'html-ignored-elements'));

const largeNotice = diagnoseDirectInput('가'.repeat(DIRECT_INPUT_LIMITS.previewAutoBytes), 'txt');
assert.ok(largeNotice.some(item => item.code === 'preview-manual'));

const tooLarge = diagnoseDirectInput('a'.repeat(DIRECT_INPUT_LIMITS.inputBytes + 1), 'txt');
assert.ok(tooLarge.some(item => item.code === 'input-too-large' && item.severity === 'error'));

assert.equal(DIRECT_INPUT_SCHEMA.draftMaxBytes, 2 * 1024 * 1024);
assert.equal(DIRECT_INPUT_SCHEMA.draftMaxAgeMs, 7 * 24 * 60 * 60 * 1000);

console.log('PASS direct input detection, diagnostics, and privacy limits');
