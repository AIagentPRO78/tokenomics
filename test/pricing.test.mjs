import { test } from 'node:test';
import assert from 'node:assert/strict';
import { costOfTurn, emptyCost, addCost, promptTokensOf, resolveCacheWrites } from '../src/pricing.mjs';

const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`);

test('basic input + output cost (Opus 4.8: 5/25 per MTok)', () => {
  const r = costOfTurn({ input_tokens: 1000, output_tokens: 500 }, 'claude-opus-4-8');
  close(r.cost.input, (1000 / 1e6) * 5); // 0.005
  close(r.cost.output, (500 / 1e6) * 25); // 0.0125
  close(r.cost.total, 0.0175);
  assert.equal(r.rateSource, 'exact');
  assert.equal(r.unknownModel, false);
});

test('cache read is 0.1x input rate', () => {
  const r = costOfTurn(
    { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 10000 },
    'claude-opus-4-8'
  );
  close(r.cost.cacheRead, (10000 / 1e6) * 5 * 0.1); // 0.005
  close(r.cost.total, 0.005);
});

test('nested cache-creation split: 5m=1.25x, 1h=2x', () => {
  const r = costOfTurn(
    {
      input_tokens: 0,
      output_tokens: 0,
      cache_creation_input_tokens: 3000,
      cache_creation: { ephemeral_5m_input_tokens: 1000, ephemeral_1h_input_tokens: 2000 },
    },
    'claude-opus-4-8'
  );
  close(r.cost.cacheWrite5m, (1000 / 1e6) * 5 * 1.25); // 0.00625
  close(r.cost.cacheWrite1h, (2000 / 1e6) * 5 * 2.0); // 0.02
  assert.equal(r.tokens.cacheWrite5m, 1000);
  assert.equal(r.tokens.cacheWrite1h, 2000);
});

test('flat cache_creation without nested split defaults to 5m TTL', () => {
  const r = costOfTurn(
    { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 4000 },
    'claude-opus-4-8'
  );
  close(r.cost.cacheWrite5m, (4000 / 1e6) * 5 * 1.25);
  assert.equal(r.cost.cacheWrite1h, 0);
});

test('flat cache_creation honours defaultCacheTtl=1h override', () => {
  const r = costOfTurn(
    { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 4000 },
    'claude-opus-4-8',
    { defaultCacheTtl: '1h' }
  );
  close(r.cost.cacheWrite1h, (4000 / 1e6) * 5 * 2.0);
  assert.equal(r.cost.cacheWrite5m, 0);
});

test('batch service tier halves token cost', () => {
  const base = costOfTurn({ input_tokens: 1000, output_tokens: 1000 }, 'claude-opus-4-8');
  const batch = costOfTurn(
    { input_tokens: 1000, output_tokens: 1000, service_tier: 'batch' },
    'claude-opus-4-8'
  );
  close(batch.cost.total, base.cost.total * 0.5);
  assert.equal(batch.modifiers.batch, true);
});

test('us inference geo adds 10%', () => {
  const base = costOfTurn({ input_tokens: 1000, output_tokens: 1000 }, 'claude-opus-4-8');
  const us = costOfTurn(
    { input_tokens: 1000, output_tokens: 1000, inference_geo: 'us' },
    'claude-opus-4-8'
  );
  close(us.cost.total, base.cost.total * 1.1);
  assert.equal(us.modifiers.usGeo, true);
});

test('web search add-on is $0.01/request, flat (not modified by batch)', () => {
  const r = costOfTurn(
    {
      input_tokens: 0,
      output_tokens: 0,
      service_tier: 'batch',
      server_tool_use: { web_search_requests: 5, web_fetch_requests: 3 },
    },
    'claude-opus-4-8'
  );
  close(r.cost.addons, 5 * 0.01); // web fetch is free
  close(r.cost.total, 0.05);
});

test('output_tokens is used as-is (thinking already included, no double count)', () => {
  // a turn that reports thinking tokens inside output should still price only output_tokens
  const r = costOfTurn(
    { input_tokens: 0, output_tokens: 1000, output_tokens_details: { thinking_tokens: 800 } },
    'claude-opus-4-8'
  );
  close(r.cost.output, (1000 / 1e6) * 25);
  close(r.cost.total, 0.025);
});

test('rateOverride forces rates (fast-mode style) and clears unknown flag', () => {
  const r = costOfTurn({ input_tokens: 1000, output_tokens: 1000 }, 'claude-opus-4-8', {
    rateOverride: { input: 10, output: 50 },
  });
  close(r.cost.input, (1000 / 1e6) * 10);
  close(r.cost.output, (1000 / 1e6) * 50);
  assert.equal(r.rateSource, 'override');
});

test('unknown model prices with default and flags unknownModel', () => {
  const r = costOfTurn({ input_tokens: 1000, output_tokens: 0 }, 'claude-zztop-9');
  assert.equal(r.unknownModel, true);
  close(r.cost.input, (1000 / 1e6) * 5);
});

test('promptTotal reflects full context size seen this turn', () => {
  const r = costOfTurn(
    {
      input_tokens: 200,
      output_tokens: 50,
      cache_read_input_tokens: 8000,
      cache_creation: { ephemeral_1h_input_tokens: 2000 },
    },
    'claude-opus-4-8'
  );
  assert.equal(r.tokens.promptTotal, 200 + 8000 + 2000);
});

test('garbage usage never throws; yields zero cost', () => {
  for (const u of [null, undefined, {}, { input_tokens: 'x' }, 42]) {
    const r = costOfTurn(u, 'claude-opus-4-8');
    assert.ok(Number.isFinite(r.cost.total));
  }
});

test('fast-mode applies the fast schedule for a known model', () => {
  const r = costOfTurn({ input_tokens: 1000, output_tokens: 1000 }, 'claude-opus-4-8', { fastMode: true });
  close(r.cost.input, (1000 / 1e6) * 10); // fast input rate
  close(r.cost.output, (1000 / 1e6) * 50); // fast output rate
  assert.equal(r.rateSource, 'fast');
  assert.equal(r.unknownModel, false);
  assert.equal(r.modifiers.fastRatesKnown, true);
});

test('fast-mode falls back to standard rates + flag when no fast schedule exists', () => {
  const r = costOfTurn({ input_tokens: 1000, output_tokens: 0 }, 'claude-haiku-4-5', { fastMode: true });
  close(r.cost.input, (1000 / 1e6) * 1); // standard haiku input
  assert.equal(r.modifiers.fastMode, true);
  assert.equal(r.modifiers.fastRatesKnown, false);
});

test('batch + us-geo compound to 0.55x on token cost only', () => {
  const base = costOfTurn({ input_tokens: 1000, output_tokens: 1000 }, 'claude-opus-4-8');
  const both = costOfTurn(
    {
      input_tokens: 1000,
      output_tokens: 1000,
      service_tier: 'batch',
      inference_geo: 'us',
      server_tool_use: { web_search_requests: 2 },
    },
    'claude-opus-4-8'
  );
  close(both.cost.tokenSubtotal, base.cost.tokenSubtotal * 0.55);
  close(both.cost.addons, 2 * 0.01); // add-ons NOT discounted by batch/geo
});

test('flat + nested cache both present: nested wins, no double count', () => {
  const r = costOfTurn(
    {
      input_tokens: 0,
      output_tokens: 0,
      cache_creation_input_tokens: 9999, // flat total that must be ignored
      cache_creation: { ephemeral_5m_input_tokens: 3000, ephemeral_1h_input_tokens: 2000 },
    },
    'claude-opus-4-8'
  );
  assert.equal(r.tokens.cacheWrite5m, 3000);
  assert.equal(r.tokens.cacheWrite1h, 2000);
  close(r.cost.cacheWrite5m, (3000 / 1e6) * 5 * 1.25);
  close(r.cost.cacheWrite1h, (2000 / 1e6) * 5 * 2.0);
});

test('promptTokensOf and resolveCacheWrites are nested-aware', () => {
  const u = { input_tokens: 200, cache_read_input_tokens: 8000, cache_creation: { ephemeral_1h_input_tokens: 2000 } };
  assert.equal(promptTokensOf(u), 200 + 8000 + 2000);
  assert.deepEqual(resolveCacheWrites(u), { write5m: 0, write1h: 2000 });
  // flat fallback honours TTL
  assert.deepEqual(resolveCacheWrites({ cache_creation_input_tokens: 500 }, '1h'), { write5m: 0, write1h: 500 });
});

test('emptyCost + addCost accumulate correctly', () => {
  const a = costOfTurn({ input_tokens: 1000, output_tokens: 1000 }, 'claude-opus-4-8').cost;
  const b = costOfTurn({ input_tokens: 1000, output_tokens: 1000 }, 'claude-opus-4-8').cost;
  let acc = emptyCost();
  acc = addCost(acc, a);
  acc = addCost(acc, b);
  close(acc.total, a.total + b.total);
  close(acc.input, a.input * 2);
});
