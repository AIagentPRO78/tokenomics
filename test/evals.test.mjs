import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summarizeLedger, diffLedgers } from '../src/evals.mjs';

function ledger(usd, tokens, turns = 1, cacheHitRate = 0) {
  return {
    totals: {
      cost: { total: usd },
      tokens: { input: tokens, output: 0, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0 },
      turns,
      cacheHitRate,
    },
  };
}

test('summarizeLedger reduces to headline numbers', () => {
  const s = summarizeLedger(ledger(0.1, 1000, 3));
  assert.equal(s.usd, 0.1);
  assert.equal(s.billedTokens, 1000);
  assert.equal(s.turns, 3);
});

test('summarizeLedger tolerates a missing/garbage ledger', () => {
  const s = summarizeLedger(null);
  assert.equal(s.usd, 0);
  assert.equal(s.billedTokens, 0);
});

test('diffLedgers reports improvement when cost drops', () => {
  const r = diffLedgers(ledger(0.1, 2000), ledger(0.04, 800), 'route to haiku');
  assert.equal(r.verdict, 'improved');
  assert.ok(Math.abs(r.deltaUsd - -0.06) < 1e-9);
  assert.ok(Math.abs(r.savedUsd - 0.06) < 1e-9);
  assert.equal(r.savedTokens, 1200);
  assert.ok(r.percentUsd < 0);
  assert.equal(r.label, 'route to haiku');
});

test('diffLedgers reports regression when cost rises', () => {
  const r = diffLedgers(ledger(0.04, 800), ledger(0.1, 2000));
  assert.equal(r.verdict, 'regressed');
  assert.ok(r.savedUsd < 0);
});

test('diffLedgers reports neutral when cost is unchanged', () => {
  const r = diffLedgers(ledger(0.05, 1000), ledger(0.05, 1000));
  assert.equal(r.verdict, 'neutral');
  assert.equal(r.deltaUsd, 0);
});

test('percentUsd is zero when before is zero (no divide-by-zero)', () => {
  const r = diffLedgers(ledger(0, 0), ledger(0.01, 100));
  assert.equal(r.percentUsd, 0);
  assert.equal(r.verdict, 'regressed');
});
