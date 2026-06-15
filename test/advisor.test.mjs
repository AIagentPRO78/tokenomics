import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recommend, THRESHOLDS } from '../src/advisor.mjs';
import { contextSignal } from '../src/context.mjs';

function makeLedger(p = {}) {
  return {
    byChannel: {
      main: { cost: { total: 0.05 }, turns: 3 },
      sidechain: { cost: { total: 0 }, turns: 0 },
      ...(p.byChannel || {}),
    },
    byModel: p.byModel || [],
    byTool: p.byTool || [],
    totals: p.totals || { tokens: { input: 0 }, cacheHitRate: 100 },
    unknownModels: p.unknownModels || [],
  };
}

const kinds = (recs) => recs.map((r) => r.kind);

test('recommends routing an expensive Opus subagent off-tier', () => {
  const ledger = makeLedger({
    byChannel: { sidechain: { cost: { total: 0.0525 }, turns: 1 } },
    byModel: [{ key: 'claude-opus-4-8', cost: { total: 0.0975 } }],
  });
  const recs = recommend(ledger, null);
  const route = recs.find((r) => r.kind === 'route-subtask');
  assert.ok(route, 'route-subtask present');
  // saving = sidechain * (1 - haikuOut/opusOut) = 0.0525 * 0.8
  assert.ok(Math.abs(route.estSavingUsd - 0.042) < 1e-9);
  assert.ok(route.evalCmd.includes('eval'));
});

test('route severity scales to the saving (high for big subagent spend)', () => {
  const ledger = makeLedger({
    byChannel: { sidechain: { cost: { total: 1.0 }, turns: 5 } },
    byModel: [{ key: 'claude-opus-4-8', cost: { total: 2.0 } }],
  });
  const route = recommend(ledger, null).find((r) => r.kind === 'route-subtask');
  assert.equal(route.severity, 'high');
});

test('no routing advice when subagent spend is trivial', () => {
  const ledger = makeLedger({
    byChannel: { sidechain: { cost: { total: 0.001 }, turns: 1 } },
    byModel: [{ key: 'claude-opus-4-8', cost: { total: 0.5 } }],
  });
  assert.ok(!kinds(recommend(ledger, null)).includes('route-subtask'));
});

test('flags a single tool flooding context', () => {
  const ledger = makeLedger({
    byTool: [
      { name: 'Read', contextBytes: 60000, calls: 1 },
      { name: 'Bash', contextBytes: 100, calls: 2 },
    ],
  });
  const bloat = recommend(ledger, null).find((r) => r.kind === 'tool-bloat');
  assert.ok(bloat);
  assert.equal(bloat.severity, 'high'); // ~99% share
  assert.ok(bloat.title.includes('Read'));
});

test('emits compact advice from a critical context signal', () => {
  const signal = contextSignal({ usedPercent: 90, windowSize: 200000 });
  const rec = recommend(makeLedger(), signal).find((r) => r.kind === 'compact-now');
  assert.ok(rec);
  assert.equal(rec.severity, 'high');
});

test('no compact advice when context is healthy', () => {
  const signal = contextSignal({ usedPercent: 20 });
  assert.ok(!kinds(recommend(makeLedger(), signal)).includes('compact-now'));
});

test('flags cache churn (low hit-rate with heavy input)', () => {
  const ledger = makeLedger({ totals: { tokens: { input: 200000 }, cacheHitRate: 10 } });
  assert.ok(kinds(recommend(ledger, null)).includes('cache-miss'));
});

test('no cache churn flag when input volume is small', () => {
  const ledger = makeLedger({ totals: { tokens: { input: 5000 }, cacheHitRate: 0 } });
  assert.ok(!kinds(recommend(ledger, null)).includes('cache-miss'));
});

test('surfaces unknown model pricing as info', () => {
  const ledger = makeLedger({ unknownModels: ['claude-zztop-9'] });
  const rec = recommend(ledger, null).find((r) => r.kind === 'unknown-model');
  assert.ok(rec);
  assert.equal(rec.severity, 'info');
});

test('a lean session yields no recommendations', () => {
  assert.deepEqual(recommend(makeLedger(), null), []);
});

test('recommendations are sorted by severity (high first, info last)', () => {
  const ledger = makeLedger({
    byChannel: { sidechain: { cost: { total: 1.0 }, turns: 5 } },
    byModel: [{ key: 'claude-opus-4-8', cost: { total: 2.0 } }],
    unknownModels: ['claude-zztop-9'],
  });
  const recs = recommend(ledger, null);
  const rank = { high: 3, medium: 2, low: 1, info: 0 };
  for (let i = 1; i < recs.length; i++) {
    assert.ok(rank[recs[i - 1].severity] >= rank[recs[i].severity]);
  }
});

test('THRESHOLDS are exported for tuning/inspection', () => {
  assert.ok(THRESHOLDS.toolBloatBytes > 0);
});
