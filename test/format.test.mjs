import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  money,
  tokensHuman,
  bar,
  sparkline,
  table,
  color,
  renderStatusline,
  renderReport,
  renderEval,
} from '../src/format.mjs';
import { contextSignal } from '../src/context.mjs';
import { diffLedgers } from '../src/evals.mjs';

test('money scales precision to magnitude', () => {
  assert.equal(money(12.345), '$12.35');
  assert.equal(money(0.0521), '$0.0521');
  assert.equal(money(0.0001234), '$0.000123');
  assert.equal(money(0), '$0.000000');
});

test('tokensHuman abbreviates', () => {
  assert.equal(tokensHuman(950), '950');
  assert.equal(tokensHuman(1500), '1.5K');
  assert.equal(tokensHuman(2_300_000), '2.3M');
});

test('bar fills proportionally and is fixed width', () => {
  const b = bar(50, 10);
  assert.equal(b.length, 10);
  assert.equal([...b].filter((c) => c === '█').length, 5);
  assert.equal(bar(0, 10), '░░░░░░░░░░');
  assert.equal([...bar(100, 10)].every((c) => c === '█'), true);
});

test('sparkline maps a series to block glyphs', () => {
  const s = sparkline([1, 2, 3, 4]);
  assert.equal([...s].length, 4);
  assert.equal(sparkline([]), '');
});

test('table aligns columns', () => {
  const t = table(['a', 'bb'], [['1', '2'], ['333', '4']]);
  const lines = t.split('\n');
  assert.equal(lines.length, 4); // header, rule, 2 rows
  assert.ok(lines[0].startsWith('a'));
});

test('color() respects the on flag', () => {
  assert.equal(color('x', 'red', false), 'x');
  const c = color('x', 'red', true);
  assert.ok(c.includes('\x1b['));
  assert.ok(c.endsWith('\x1b[0m'));
});

test('renderStatusline emits a one-line HUD with percent and cost', () => {
  const parsed = {
    signal: contextSignal({ usedPercent: 72, windowSize: 200000 }),
    costUsd: 0.42,
    model: { id: 'claude-opus-4-8', name: 'Opus 4.8' },
  };
  const line = renderStatusline(parsed, false);
  assert.ok(line.includes('72%'));
  assert.ok(line.includes('$0.42'));
  assert.ok(!line.includes('\n'));
});

test('renderStatusline shows a warning glyph when critical', () => {
  const parsed = {
    signal: contextSignal({ usedPercent: 92 }),
    costUsd: 1,
    model: { id: 'm', name: 'M' },
  };
  assert.ok(renderStatusline(parsed, false).includes('compact'));
});

function sampleLedger() {
  return {
    meta: { sessionId: 's1', gitBranch: 'main' },
    totals: { cost: { total: 0.1005 }, tokens: { output: 2700 }, turns: 4, cacheHitRate: 67.8 },
    byModel: [
      { key: 'claude-opus-4-8', cost: { total: 0.0975 }, share: 97, turns: 3, source: 'exact', unknown: false },
      { key: 'claude-zztop-9', cost: { total: 0.003 }, share: 3, turns: 1, source: 'default', unknown: true },
    ],
    byChannel: {
      main: { cost: { total: 0.048 }, share: 47.8, turns: 3 },
      sidechain: { cost: { total: 0.0525 }, share: 52.2, turns: 1 },
    },
    byTool: [{ name: 'Read', contextBytes: 600, calls: 1 }],
  };
}

test('renderReport (no-color) emits clean ASCII with no ANSI', () => {
  const out = renderReport(
    { ledger: sampleLedger(), signal: contextSignal({ usedPercent: 72 }), recs: [] },
    false
  );
  assert.ok(!out.includes('\x1b'), 'no ANSI when color off');
  assert.ok(out.includes('$0.1005'));
  assert.ok(out.includes('claude-opus-4-8'));
  assert.ok(out.includes('subagents'));
});

test('renderReport includes recommendations and eval hints', () => {
  const recs = [
    { kind: 'route-subtask', severity: 'high', title: 'Route off Opus', detail: 'do it', estSavingUsd: 0.04, evalCmd: 'tokenomics eval ...' },
  ];
  const out = renderReport({ ledger: sampleLedger(), signal: null, recs }, false);
  assert.ok(out.includes('Route off Opus'));
  assert.ok(out.includes('prove it:'));
  assert.ok(out.includes('~save'));
});

test('renderEval shows verdict and deltas', () => {
  const before = { totals: { cost: { total: 0.1 }, tokens: { input: 2000, output: 0, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0 }, turns: 1 } };
  const after = { totals: { cost: { total: 0.04 }, tokens: { input: 800, output: 0, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0 }, turns: 1 } };
  const out = renderEval(diffLedgers(before, after, 'x'), false);
  assert.ok(out.includes('IMPROVED'));
  assert.ok(out.includes('before'));
});
