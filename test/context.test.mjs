import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  degradationTier,
  contextSignal,
  fromStatusline,
  growthCurve,
  topContextConsumers,
} from '../src/context.mjs';

test('degradationTier thresholds', () => {
  assert.equal(degradationTier(0).name, 'ok');
  assert.equal(degradationTier(49).name, 'ok');
  assert.equal(degradationTier(50).name, 'watch');
  assert.equal(degradationTier(69).name, 'watch');
  assert.equal(degradationTier(70).name, 'warn');
  assert.equal(degradationTier(84).name, 'warn');
  assert.equal(degradationTier(85).name, 'critical');
  assert.equal(degradationTier(100).name, 'critical');
  // out of range is clamped
  assert.equal(degradationTier(150).name, 'critical');
  assert.equal(degradationTier(-5).name, 'ok');
});

test('contextSignal derives remaining and tier', () => {
  const s = contextSignal({ usedPercent: 72, windowSize: 200000, inputTokens: 144000 });
  assert.equal(s.usedPercent, 72);
  assert.equal(s.remainingPercent, 28);
  assert.equal(s.tier.name, 'warn');
  assert.equal(s.windowSize, 200000);
});

test('fromStatusline parses Claude Code statusLine stdin', () => {
  const stdin = {
    context_window: {
      used_percentage: 88,
      remaining_percentage: 12,
      context_window_size: 200000,
      total_input_tokens: 176000,
      exceeds_200k_tokens: false,
    },
    cost: { total_cost_usd: 0.4213 },
    model: { id: 'claude-opus-4-8', display_name: 'Opus 4.8' },
    transcript_path: '/tmp/x.jsonl',
    session_id: 'abc',
  };
  const p = fromStatusline(stdin);
  assert.equal(p.signal.usedPercent, 88);
  assert.equal(p.signal.tier.name, 'critical');
  assert.equal(p.costUsd, 0.4213);
  assert.equal(p.model.name, 'Opus 4.8');
  assert.equal(p.transcriptPath, '/tmp/x.jsonl');
  assert.equal(p.sessionId, 'abc');
});

test('fromStatusline tolerates empty/garbage stdin', () => {
  const p = fromStatusline({});
  assert.equal(p.signal.usedPercent, 0);
  assert.equal(p.signal.tier.name, 'ok');
  assert.equal(p.costUsd, 0);
});

test('growthCurve uses only main-channel turns', () => {
  const parsed = {
    turns: [
      { isSidechain: false, ts: 't1', usage: { input_tokens: 100, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } },
      { isSidechain: true, ts: 't2', usage: { input_tokens: 999, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } },
      { isSidechain: false, ts: 't3', usage: { input_tokens: 50, cache_read_input_tokens: 200, cache_creation_input_tokens: 100 } },
    ],
  };
  const curve = growthCurve(parsed);
  assert.equal(curve.length, 2);
  assert.equal(curve[0].promptTokens, 100);
  assert.equal(curve[1].promptTokens, 350);
});

test('growthCurve is nested-aware (matches the priced prompt size)', () => {
  // a turn with ONLY the nested 1h split and no flat field — the old flat-only
  // read would report 100; the fix reports 5100.
  const parsed = {
    turns: [
      {
        isSidechain: false,
        ts: 't',
        usage: { input_tokens: 100, cache_read_input_tokens: 0, cache_creation: { ephemeral_1h_input_tokens: 5000 } },
      },
    ],
  };
  assert.equal(growthCurve(parsed)[0].promptTokens, 5100);
});

test('topContextConsumers ranks tools by bytes with share', () => {
  const ledger = {
    byTool: [
      { name: 'Read', contextBytes: 800, calls: 2 },
      { name: 'Bash', contextBytes: 200, calls: 5 },
      { name: 'Grep', contextBytes: 0, calls: 1 },
    ],
  };
  const top = topContextConsumers(ledger, 2);
  assert.equal(top.length, 2);
  assert.equal(top[0].name, 'Read');
  assert.equal(top[0].sharePercent, 80);
  assert.equal(top[1].sharePercent, 20);
});
