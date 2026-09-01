'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const graph = JSON.parse(fs.readFileSync(path.join(__dirname, 'impact-graph.json'), 'utf8'));

function gitLines(args) {
  try {
    return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' })
      .split(/\r?\n/).filter(line => line.trim());
  } catch (_) {
    return [];
  }
}

function changedPaths() {
  const tracked = gitLines(['diff', '--name-only', 'origin/main...HEAD']).map(line => line.trim());
  const working = gitLines(['status', '--porcelain']).map(line => line.slice(3).replace(/\\/g, '/'));
  return new Set([...tracked, ...working]);
}

function matches(changed, candidates) {
  return candidates.some(candidate => changed.has(candidate));
}

if (graph.schemaVersion !== 1) throw new Error('impact graph schemaVersion은 1이어야 합니다.');
const ids = new Set();
for (const node of graph.nodes || []) {
  if (!node.id || ids.has(node.id)) throw new Error(`impact graph node id 중복/누락: ${node.id || '(empty)'}`);
  ids.add(node.id);
  for (const file of node.paths || []) {
    if (!fs.existsSync(path.join(ROOT, file))) throw new Error(`impact graph 파일 누락: ${file}`);
  }
}
for (const edge of graph.edges || []) {
  if (!ids.has(edge.from) || !ids.has(edge.to)) throw new Error(`impact graph 간선 대상 누락: ${edge.from} -> ${edge.to}`);
}

const changed = changedPaths();
const requiredTests = new Set();
const missingCompanions = [];
for (const rule of graph.rules || []) {
  if (!matches(changed, rule.whenChanged || [])) continue;
  for (const test of rule.tests || []) requiredTests.add(test);
  for (const file of rule.requiresChanged || []) {
    if (!changed.has(file)) missingCompanions.push(file);
  }
}

console.log(`IMPACT GRAPH: PASS (${ids.size} nodes, ${(graph.edges || []).length} edges)`);
if (requiredTests.size) console.log(`필수 테스트: ${[...requiredTests].join(' | ')}`);
if (missingCompanions.length) {
  console.log(`동반 변경 확인 필요: ${[...new Set(missingCompanions)].join(', ')}`);
  process.exitCode = 1;
}
