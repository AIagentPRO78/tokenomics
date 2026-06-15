// Recommendation engine: a ledger (+ optional live context signal) in, a ranked
// list of concrete, honest actions out. Every recommendation is something the
// platform actually permits (advice, static routing, /compact nudge) — never a
// capability we don't have (no silent reroute, no forced compaction).
//
// Each recommendation carries an `evalCmd` so the user can PROVE the delta — the
// differentiator from passive cost meters.

import { priceFor } from './models.mjs';
import { num } from './util.mjs';

export const THRESHOLDS = {
  toolBloatBytes: 50_000, // a single tool's results past this are worth narrowing
  toolBloatShare: 40, // ...or this share of all tool-result bytes
  cacheMissRate: 30, // cache hit-rate below this with heavy input = churn
  cacheMinInputTokens: 100_000, // only flag cache churn when input volume is real
  routeMinUsd: 0.02, // don't nag about sub-2-cent subagent spend
  contextWarnTier: 'warn', // emit compact advice at this tier or worse
};

const SEVERITY_RANK = { high: 3, medium: 2, low: 1, info: 0 };

function tierAtLeast(name, floor) {
  const order = ['ok', 'watch', 'warn', 'critical'];
  return order.indexOf(name) >= order.indexOf(floor);
}

function humanBytes(b) {
  if (b >= 1_000_000) return `${(b / 1_000_000).toFixed(1)}MB`;
  if (b >= 1000) return `${(b / 1000).toFixed(0)}KB`;
  return `${b}B`;
}

/**
 * @param {object} ledger  from buildLedger()
 * @param {object} [signal] live context signal from context.contextSignal()/fromStatusline()
 * @param {object} [opts]   { inject } forwarded to priceFor for testability
 * @returns {Array<{kind,severity,title,detail,estSavingUsd?,evalCmd?}>}
 */
export function recommend(ledger, signal = null, opts = {}) {
  const recs = [];
  const inject = opts.inject;

  // 1) Route an expensive subagent to a cheaper tier.
  const side = ledger.byChannel && ledger.byChannel.sidechain;
  if (side && side.cost.total >= THRESHOLDS.routeMinUsd) {
    // Find the dominant model used in sidechains (approx: most expensive model row
    // that is opus-class; sidechain rows aren't split by model, so use byModel opus).
    const opusRow = (ledger.byModel || []).find((m) => /^claude-opus/.test(m.key));
    if (opusRow) {
      const cur = priceFor(opusRow.key, inject);
      const haiku = priceFor('claude-haiku-4-5', inject);
      const outRatio = cur.output ? haiku.output / cur.output : 1;
      // Saving bounded by the sidechain spend; assume mechanical subagents are output-heavy.
      const estSaving = side.cost.total * (1 - outRatio);
      if (estSaving >= THRESHOLDS.routeMinUsd) {
        recs.push({
          kind: 'route-subtask',
          severity: estSaving >= 0.25 ? 'high' : estSaving >= 0.05 ? 'medium' : 'low',
          title: `Route mechanical subagents off ${opusRow.key}`,
          detail:
            `Subagent (sidechain) turns cost $${side.cost.total.toFixed(4)} and are running on an ` +
            `Opus-class model. Mechanical fan-out work (search, extraction, formatting) is usually ` +
            `Haiku-shaped. Pin those subagents to a cheaper tier via subagent frontmatter ` +
            `(model: haiku). Estimated saving on this session's subagent spend: ~$${estSaving.toFixed(4)}.`,
          estSavingUsd: estSaving,
          evalCmd: `tokenomics eval --before <opus-run>.jsonl --after <haiku-run>.jsonl`,
        });
      }
    }
  }

  // 2) Tool-result bloat — a tool flooding the context window.
  const tools = (ledger.byTool || []).filter((t) => t.contextBytes > 0);
  const totalBytes = tools.reduce((s, t) => s + t.contextBytes, 0);
  for (const t of tools) {
    const share = totalBytes ? (t.contextBytes / totalBytes) * 100 : 0;
    if (t.contextBytes >= THRESHOLDS.toolBloatBytes || share >= THRESHOLDS.toolBloatShare) {
      recs.push({
        kind: 'tool-bloat',
        severity: share >= 60 ? 'high' : 'medium',
        title: `${t.name} is flooding the context window`,
        detail:
          `${t.name} put ${humanBytes(t.contextBytes)} into context across ${t.calls} call(s) ` +
          `(${share.toFixed(0)}% of all tool output). Narrow it (filter/paginate/limit), or push it ` +
          `behind a subagent that returns a condensed summary so the raw payload never enters the ` +
          `main window.`,
        evalCmd: `tokenomics attribute --tool ${t.name} --before <a>.jsonl --after <b>.jsonl`,
      });
      break; // surface the single worst offender, not every tool
    }
  }

  // 3) Compaction / note-dump advice from the live context tier.
  if (signal && signal.tier && tierAtLeast(signal.tier.name, THRESHOLDS.contextWarnTier)) {
    const crit = signal.tier.name === 'critical';
    recs.push({
      kind: 'compact-now',
      severity: crit ? 'high' : 'medium',
      title: crit ? 'Context near the cliff — compact now' : 'Context getting tight',
      detail:
        `Window is ${signal.usedPercent.toFixed(0)}% full (${signal.tier.label}). Quality degrades ` +
        `before the auto-compact threshold. Run /compact, or dump durable state to a file and clear, ` +
        `so the model keeps a high-signal window. (The plugin can warn but cannot compact for you.)`,
    });
  }

  // 4) Cache churn — paying full input price repeatedly.
  const tot = ledger.totals;
  if (
    tot &&
    tot.tokens.input >= THRESHOLDS.cacheMinInputTokens &&
    num(tot.cacheHitRate) < THRESHOLDS.cacheMissRate
  ) {
    recs.push({
      kind: 'cache-miss',
      severity: 'low',
      title: 'Low cache hit-rate — prompt prefix is churning',
      detail:
        `Only ${num(tot.cacheHitRate).toFixed(0)}% of prompt tokens were served from cache while ` +
        `${(tot.tokens.input / 1000).toFixed(0)}K tokens paid full input price. Keep the early part of ` +
        `the context stable (system prompt, pinned files) so cache reads (0.1x) replace fresh input.`,
    });
  }

  // 5) Unknown model — pricing is an estimate, surface it honestly.
  if (ledger.unknownModels && ledger.unknownModels.length) {
    recs.push({
      kind: 'unknown-model',
      severity: 'info',
      title: 'Unrecognized model id — cost is an estimate',
      detail:
        `Priced with a conservative default: ${ledger.unknownModels.join(', ')}. Add it to models.json ` +
        `(or a family pattern) for exact pricing.`,
    });
  }

  return recs.sort(
    (a, b) =>
      SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] ||
      num(b.estSavingUsd) - num(a.estSavingUsd)
  );
}
