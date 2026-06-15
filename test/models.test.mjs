import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeModelId, priceFor, rateConfig, fastPriceFor } from '../src/models.mjs';

test('normalizeModelId strips provider/region/date/version/context tags', () => {
  assert.equal(normalizeModelId('claude-opus-4-8'), 'claude-opus-4-8');
  assert.equal(normalizeModelId('us.anthropic.claude-opus-4-8-20260101-v1:0'), 'claude-opus-4-8');
  assert.equal(normalizeModelId('claude-opus-4-8[1m]'), 'claude-opus-4-8');
  assert.equal(normalizeModelId('claude-sonnet-4-6@20260301'), 'claude-sonnet-4-6');
  assert.equal(normalizeModelId('bedrock/claude-haiku-4-5'), 'claude-haiku-4-5');
  assert.equal(normalizeModelId('CLAUDE-OPUS-4-8'), 'claude-opus-4-8');
  assert.equal(normalizeModelId(''), '');
  assert.equal(normalizeModelId(null), '');
  assert.equal(normalizeModelId(undefined), '');
});

test('priceFor resolves exact ids', () => {
  const o = priceFor('claude-opus-4-8');
  assert.equal(o.input, 5);
  assert.equal(o.output, 25);
  assert.equal(o.source, 'exact');
  assert.equal(o.unknown, false);
  assert.equal(o.normalizedId, 'claude-opus-4-8');
  assert.equal(priceFor('claude-haiku-4-5').input, 1);
  assert.equal(priceFor('claude-sonnet-4-6').output, 15);
  assert.equal(priceFor('claude-fable-5').input, 10);
  assert.equal(priceFor('claude-fable-5').output, 50);
});

test('priceFor falls back to family patterns for new/returning models', () => {
  // Opus 5 not in the exact table -> family pattern, Opus-4.8 class
  const opus5 = priceFor('claude-opus-5-0');
  assert.equal(opus5.source, 'family');
  assert.equal(opus5.input, 5);
  assert.equal(opus5.output, 25);
  assert.equal(opus5.unknown, false);

  // A future Fable revision
  const fable6 = priceFor('claude-fable-6');
  assert.equal(fable6.source, 'family');
  assert.equal(fable6.input, 10);

  // Sonnet 7 future
  assert.equal(priceFor('claude-sonnet-7').output, 15);
});

test('priceFor distinguishes legacy Opus 4/4.1 (15/75) from Opus 4.5+ (5/25)', () => {
  assert.equal(priceFor('claude-opus-4-1').input, 15);
  assert.equal(priceFor('claude-opus-4-0').input, 15);
  assert.equal(priceFor('claude-opus-4').input, 15);
  assert.equal(priceFor('claude-opus-4-5').input, 5);
  assert.equal(priceFor('claude-opus-4-9').input, 5); // family covers 4.5-4.9
});

test('priceFor flags genuinely unknown models with conservative default', () => {
  const r = priceFor('claude-zztop-9');
  assert.equal(r.source, 'default');
  assert.equal(r.unknown, true);
  assert.equal(r.input, 5);
  assert.equal(r.output, 25);
  assert.ok(r.note && r.note.length > 0);
});

test('rateConfig exposes universal multipliers and add-ons', () => {
  const cfg = rateConfig();
  assert.equal(cfg.multipliers.cacheRead, 0.1);
  assert.equal(cfg.multipliers.cacheWrite5m, 1.25);
  assert.equal(cfg.multipliers.cacheWrite1h, 2.0);
  assert.equal(cfg.modifiers.batch, 0.5);
  assert.equal(cfg.modifiers.usGeo, 1.1);
  assert.equal(cfg.addons.webSearchPerRequest, 0.01);
});

test('normalizeModelId handles compound platform+region prefixes', () => {
  assert.equal(
    normalizeModelId('bedrock/us.anthropic.claude-opus-4-8-20260101-v1:0'),
    'claude-opus-4-8'
  );
  assert.equal(normalizeModelId('vertex/eu.anthropic.claude-sonnet-4-6'), 'claude-sonnet-4-6');
});

test('compound bedrock/us.anthropic id prices exactly (not unknown)', () => {
  const r = priceFor('bedrock/us.anthropic.claude-opus-4-8');
  assert.equal(r.source, 'exact');
  assert.equal(r.unknown, false);
  assert.equal(r.input, 5);
});

test('Opus 4.2-4.4 are covered by the family pattern (15/75), not unknown', () => {
  for (const v of ['claude-opus-4-2', 'claude-opus-4-3', 'claude-opus-4-4']) {
    const r = priceFor(v);
    assert.equal(r.source, 'family', v);
    assert.equal(r.unknown, false, v);
    assert.equal(r.input, 15, v);
  }
});

test('fastPriceFor returns the fast schedule for known models, null otherwise', () => {
  assert.equal(fastPriceFor('claude-opus-4-8').input, 10);
  assert.equal(fastPriceFor('claude-opus-4-8').output, 50);
  assert.equal(fastPriceFor('claude-opus-4-7').output, 150);
  assert.equal(fastPriceFor('claude-haiku-4-5'), null);
  assert.equal(fastPriceFor('claude-zztop-9'), null);
});

test('injected registry overrides bundled data', () => {
  const inject = {
    multipliers: { cacheRead: 0.1, cacheWrite5m: 1.25, cacheWrite1h: 2 },
    modifiers: { batch: 0.5, usGeo: 1.1 },
    addons: { webSearchPerRequest: 0.01, webFetchPerRequest: 0 },
    models: { 'claude-test-1': { input: 2, output: 8 } },
    families: [],
    default: { input: 99, output: 99, note: 'x' },
  };
  assert.equal(priceFor('claude-test-1', inject).input, 2);
  assert.equal(priceFor('nope', inject).input, 99);
});
