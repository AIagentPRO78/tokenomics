// Cost of a single API turn, computed from its `usage` object and model id.
//
// Pricing model (verified 2026-06-15 against platform.claude.com pricing):
//   inputCost      = input_tokens            * rate.input
//   cacheReadCost  = cache_read_tokens       * rate.input * 0.1
//   cacheWrite5m   = ephemeral_5m_tokens     * rate.input * 1.25
//   cacheWrite1h   = ephemeral_1h_tokens     * rate.input * 2.0
//   outputCost     = output_tokens           * rate.output     (output already includes thinking)
//   tokenSubtotal  = (sum of above) * batchModifier * usGeoModifier
//   addons         = web_search_requests * $0.01  (+ web_fetch, currently free)
//   total          = tokenSubtotal + addons
//
// All rates are per 1,000,000 tokens, so token counts are divided by 1e6.
// There is no long-context premium tier on current models (flat 1M pricing).

import { num, get } from './util.mjs';
import { priceFor, fastPriceFor, rateConfig } from './models.mjs';

const PER_MTOK = 1_000_000;

/**
 * Resolve cache-write tokens, splitting into 5m and 1h tiers.
 * Prefers the nested ephemeral breakdown; falls back to the flat total at the
 * assumed default TTL. Never double-counts. Shared so the cost path and the
 * context/growth path agree on prompt size.
 */
export function resolveCacheWrites(usage, defaultTtl = '5m') {
  const u = usage && typeof usage === 'object' ? usage : {};
  const nested5m = get(u, 'cache_creation.ephemeral_5m_input_tokens', undefined);
  const nested1h = get(u, 'cache_creation.ephemeral_1h_input_tokens', undefined);
  if (nested5m !== undefined || nested1h !== undefined) {
    return { write5m: num(nested5m), write1h: num(nested1h) };
  }
  const flat = num(u.cache_creation_input_tokens);
  return defaultTtl === '1h' ? { write5m: 0, write1h: flat } : { write5m: flat, write1h: 0 };
}

/** Full prompt size seen by the model this turn (context proxy), nested-aware. */
export function promptTokensOf(usage, defaultTtl = '5m') {
  const u = usage && typeof usage === 'object' ? usage : {};
  const w = resolveCacheWrites(u, defaultTtl);
  return num(u.input_tokens) + num(u.cache_read_input_tokens) + w.write5m + w.write1h;
}

/**
 * @param {object} usage   the API `usage` object from a transcript turn
 * @param {string} modelId raw model id (will be normalized)
 * @param {object} [opts]
 * @param {object} [opts.inject]      injected registry (tests)
 * @param {boolean} [opts.fastMode]   price on the fast-mode schedule (separate, no usage flag)
 * @param {{input:number,output:number}} [opts.rateOverride] force specific rates (wins over fastMode)
 * @param {'5m'|'1h'} [opts.defaultCacheTtl] TTL to assume when cache_creation has no nested split (default '5m')
 */
export function costOfTurn(usage, modelId, opts = {}) {
  const u = usage && typeof usage === 'object' ? usage : {};
  const cfg = rateConfig(opts.inject);
  const resolved = priceFor(modelId, opts.inject);

  // Rate selection: explicit override > fast-mode schedule > standard rates.
  let rate;
  let rateSource;
  let fastRatesKnown = true;
  if (opts.rateOverride) {
    rate = { input: num(opts.rateOverride.input), output: num(opts.rateOverride.output) };
    rateSource = 'override';
  } else if (opts.fastMode) {
    const fast = fastPriceFor(modelId, opts.inject);
    if (fast) {
      rate = { input: fast.input, output: fast.output };
      rateSource = 'fast';
    } else {
      // fast requested but no known fast rate for this model — use standard, flag it.
      rate = { input: resolved.input, output: resolved.output };
      rateSource = resolved.source;
      fastRatesKnown = false;
    }
  } else {
    rate = { input: resolved.input, output: resolved.output };
    rateSource = resolved.source;
  }

  // --- token counts ---
  const inputTokens = num(u.input_tokens);
  const outputTokens = num(u.output_tokens);
  const cacheReadTokens = num(u.cache_read_input_tokens);
  const { write5m, write1h } = resolveCacheWrites(u, opts.defaultCacheTtl || '5m');

  // --- per-category cost (pre-modifier; see note below) ---
  const m = cfg.multipliers;
  const inputCost = (inputTokens / PER_MTOK) * rate.input;
  const outputCost = (outputTokens / PER_MTOK) * rate.output;
  const cacheReadCost = (cacheReadTokens / PER_MTOK) * rate.input * m.cacheRead;
  const cacheWrite5mCost = (write5m / PER_MTOK) * rate.input * m.cacheWrite5m;
  const cacheWrite1hCost = (write1h / PER_MTOK) * rate.input * m.cacheWrite1h;

  let tokenSubtotal =
    inputCost + outputCost + cacheReadCost + cacheWrite5mCost + cacheWrite1hCost;

  // --- modifiers (apply to all token categories; batch then geo => 0.55x when both) ---
  const isBatch = (u.service_tier || '').toLowerCase() === 'batch';
  const isUsGeo = (u.inference_geo || '').toLowerCase() === 'us';
  if (isBatch) tokenSubtotal *= cfg.modifiers.batch;
  if (isUsGeo) tokenSubtotal *= cfg.modifiers.usGeo;

  // --- add-ons (flat, NOT modified by batch/geo) ---
  const webSearch = num(get(u, 'server_tool_use.web_search_requests', 0));
  const webFetch = num(get(u, 'server_tool_use.web_fetch_requests', 0));
  const addonsCost =
    webSearch * cfg.addons.webSearchPerRequest + webFetch * cfg.addons.webFetchPerRequest;

  const total = tokenSubtotal + addonsCost;

  // NOTE: the per-category cost fields (input/output/cacheRead/cacheWrite*) are the
  // PRE-modifier amounts. Only `tokenSubtotal` and `total` reflect batch/geo. This
  // keeps the breakdown legible (full-rate per category) while totals stay exact.
  return {
    modelId: modelId || '',
    normalizedId: resolved.normalizedId,
    rateSource,
    unknownModel: rateSource === 'override' || rateSource === 'fast' ? false : resolved.unknown,
    rate,
    tokens: {
      input: inputTokens,
      output: outputTokens,
      cacheRead: cacheReadTokens,
      cacheWrite5m: write5m,
      cacheWrite1h: write1h,
      promptTotal: inputTokens + cacheReadTokens + write5m + write1h,
    },
    cost: {
      input: inputCost,
      output: outputCost,
      cacheRead: cacheReadCost,
      cacheWrite5m: cacheWrite5mCost,
      cacheWrite1h: cacheWrite1hCost,
      tokenSubtotal,
      addons: addonsCost,
      total,
    },
    modifiers: {
      batch: isBatch,
      usGeo: isUsGeo,
      fastMode: !!opts.fastMode,
      fastRatesKnown,
    },
    addons: { webSearch, webFetch },
  };
}

/** A zero cost accumulator, shape-compatible with `addCost`. */
export function emptyCost() {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite5m: 0,
    cacheWrite1h: 0,
    tokenSubtotal: 0,
    addons: 0,
    total: 0,
  };
}

/** Accumulate a turn's `.cost` into an accumulator (returns a new object). */
export function addCost(acc, cost) {
  return {
    input: acc.input + cost.input,
    output: acc.output + cost.output,
    cacheRead: acc.cacheRead + cost.cacheRead,
    cacheWrite5m: acc.cacheWrite5m + cost.cacheWrite5m,
    cacheWrite1h: acc.cacheWrite1h + cost.cacheWrite1h,
    tokenSubtotal: acc.tokenSubtotal + cost.tokenSubtotal,
    addons: acc.addons + cost.addons,
    total: acc.total + cost.total,
  };
}
