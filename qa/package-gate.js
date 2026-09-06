'use strict';

const path = require('node:path');
const { spawn } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const inputs = process.argv.slice(2);
if (!inputs.length) {
    inputs.push(
        'qa/fixtures/md_hwpx_test.md',
        'qa/fixtures/sample.docx',
        'qa/fixtures/docx_table_test.docx',
        'qa/fixtures/docx_image_test.docx',
        'tests/fixtures/sample.xlsx',
    );
}

function runGate(input) {
    return new Promise(resolve => {
        const child = spawn(process.execPath, ['qa/gate.js', input], {
            cwd: ROOT,
            stdio: ['ignore', 'pipe', 'pipe'],
            env: process.env,
        });
        let output = '';
        child.stdout.on('data', chunk => { output += chunk; });
        child.stderr.on('data', chunk => { output += chunk; });
        child.on('close', code => resolve({ input, code, output }));
    });
}

(async () => {
    const results = new Array(inputs.length);
    let next = 0;
    const worker = async () => {
        while (next < inputs.length) {
            const index = next++;
            results[index] = await runGate(inputs[index]);
        }
    };
    await Promise.all(Array.from({ length: Math.min(2, inputs.length) }, worker));
    for (const result of results) process.stdout.write(result.output);
    const failed = results.filter(result => result.code !== 0);
    if (failed.length) {
        console.error(`PACKAGE GATE: FAIL — ${failed.map(result => result.input).join(', ')}`);
        process.exit(1);
    }
    console.log(`PACKAGE GATE: PASS (${results.length} inputs, concurrency=2)`);
})().catch(error => {
    console.error(`PACKAGE GATE: FAIL — ${error.message}`);
    process.exit(1);
});
