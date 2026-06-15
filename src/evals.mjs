// Eval harness: prove the token/$ delta of a change by comparing two sessions
// (before vs after). This is the differentiator — recommendations are not just
// asserted, they are measured, the way Anthropic frames evals (token consumption
// as a first-class quality metric) alongside context engineering.

import { num } from './util.mjs';

/** Reduce a built ledger to the headline numbers an eval compares. */
export function summarizeLedger(ledger) {
  const t = (ledger && ledger.totals) || { cost: { total: 0 }, tokens: {}, turns: 0, cacheHitRate: 0 };
  const tk = t.tokens || {};
  const billedTokens =
    num(tk.input) + num(tk.output) + num(tk.cacheRead) + num(tk.cacheWrite5m) + num(tk.cacheWrite1h);
  return {
    usd: num(t.cost && t.cost.total),
    billedTokens,
    outputTokens: num(tk.output),
    turns: num(t.turns),
    cacheHitRate: num(t.cacheHitRate),
  };
}

const EPS = 1e-12;

/** Compare two ledgers; returns deltas and a verdict. Pure. */
export function diffLedgers(beforeLedger, afterLedger, label = 'eval') {
  const before = summarizeLedger(beforeLedger);
  const after = summarizeLedger(afterLedger);

  const deltaUsd = after.usd - before.usd;
  const deltaTokens = after.billedTokens - before.billedTokens;
  const percentUsd = before.usd > EPS ? (deltaUsd / before.usd) * 100 : 0;
  const percentTokens = before.billedTokens > 0 ? (deltaTokens / before.billedTokens) * 100 : 0;

  let verdict;
  if (deltaUsd < -EPS) verdict = 'improved';
  else if (deltaUsd > EPS) verdict = 'regressed';
  else verdict = 'neutral';

  return {
    label,
    before,
    after,
    deltaUsd,
    deltaTokens,
    percentUsd,
    percentTokens,
    verdict,
    // positive = money saved
    savedUsd: -deltaUsd,
    savedTokens: -deltaTokens,
  };
}
