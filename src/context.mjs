// Context-window signal: how full is the window, how fast is it growing, and
// what is filling it. The plugin can SEE this and WARN/ADVISE on it, but cannot
// trigger or retime compaction (platform-blocked) — so everything here is read
// + advice, never force.

import { num, get, clamp } from './util.mjs';
import { promptTokensOf } from './pricing.mjs';

// Degradation tiers keyed on input-token usage percent of the window.
// Chosen below the ~95% auto-compact trigger so warnings arrive with headroom
// to act ("attention budget" degrades well before the hard cliff).
export const TIERS = [
  { name: 'ok', min: 0, label: 'healthy' },
  { name: 'watch', min: 50, label: 'filling' },
  { name: 'warn', min: 70, label: 'getting tight' },
  { name: 'critical', min: 85, label: 'near the cliff' },
];

/** Map a used-percentage to a degradation tier object. */
export function degradationTier(usedPercent) {
  const p = clamp(usedPercent, 0, 100);
  let chosen = TIERS[0];
  for (const t of TIERS) if (p >= t.min) chosen = t;
  return chosen;
}

/**
 * Build a normalized context signal from raw numbers (statusline or computed).
 * @returns {{usedPercent, remainingPercent, windowSize, inputTokens, exceeds200k, tier, tierName}}
 */
export function contextSignal({ usedPercent, remainingPercent, windowSize, inputTokens, exceeds200k } = {}) {
  const used = clamp(num(usedPercent), 0, 100);
  const remaining = remainingPercent !== undefined ? clamp(num(remainingPercent), 0, 100) : 100 - used;
  const tier = degradationTier(used);
  return {
    usedPercent: used,
    remainingPercent: remaining,
    windowSize: num(windowSize) || null,
    inputTokens: num(inputTokens) || null,
    exceeds200k: !!exceeds200k,
    tier,
    tierName: tier.name,
  };
}

/** Parse Claude Code statusLine stdin JSON into a context signal + cost + model. */
export function fromStatusline(stdin) {
  const cw = get(stdin, 'context_window', {}) || {};
  const signal = contextSignal({
    usedPercent: cw.used_percentage,
    remainingPercent: cw.remaining_percentage,
    windowSize: cw.context_window_size,
    inputTokens: cw.total_input_tokens,
    exceeds200k: cw.exceeds_200k_tokens,
  });
  return {
    signal,
    costUsd: num(get(stdin, 'cost.total_cost_usd', 0)),
    model: {
      id: get(stdin, 'model.id', null),
      name: get(stdin, 'model.display_name', null),
    },
    transcriptPath: get(stdin, 'transcript_path', null),
    sessionId: get(stdin, 'session_id', null),
  };
}

/**
 * Per-turn prompt-size curve over the MAIN channel (subagent sidechains have their
 * own windows). Useful as a growth sparkline. Returns ascending-by-time samples.
 */
export function growthCurve(parsed) {
  const samples = [];
  for (const turn of parsed.turns || []) {
    if (turn.isSidechain) continue;
    // Use the same nested-vs-flat cache resolution the cost path uses, so the
    // growth curve matches the priced prompt size even when only the nested
    // ephemeral split is present.
    samples.push({ ts: turn.ts || null, promptTokens: promptTokensOf(turn.usage || {}) });
  }
  return samples;
}

/**
 * Top context consumers by tool-result bytes, from a built ledger.
 * Tool results are the main lever a user can act on (the bytes a tool dumped into
 * the window). Returns up to `n`, largest first, with a share of total bytes.
 */
export function topContextConsumers(ledger, n = 5) {
  const tools = (ledger.byTool || []).filter((t) => t.contextBytes > 0);
  const total = tools.reduce((s, t) => s + t.contextBytes, 0);
  return tools.slice(0, n).map((t) => ({
    name: t.name,
    bytes: t.contextBytes,
    calls: t.calls,
    sharePercent: total ? (t.contextBytes / total) * 100 : 0,
  }));
}
