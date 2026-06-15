// Turn a parsed transcript into ledgers: cost + tokens attributed by model,
// channel (main loop vs subagent sidechains), tool, and skill.

import { costOfTurn, emptyCost, addCost } from './pricing.mjs';
import { pct } from './util.mjs';

function emptyTokens() {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0, promptTotal: 0 };
}

function emptyGroup() {
  return { cost: emptyCost(), tokens: emptyTokens(), turns: 0 };
}

function addTurnToGroup(group, priced) {
  group.cost = addCost(group.cost, priced.cost);
  const t = priced.tokens;
  group.tokens.input += t.input;
  group.tokens.output += t.output;
  group.tokens.cacheRead += t.cacheRead;
  group.tokens.cacheWrite5m += t.cacheWrite5m;
  group.tokens.cacheWrite1h += t.cacheWrite1h;
  group.tokens.promptTotal += t.promptTotal;
  group.turns += 1;
}

/**
 * @param {object} parsed  output of parseTranscript*()
 * @param {object} [opts]  forwarded to costOfTurn (inject, fastMode, rateOverride, defaultCacheTtl)
 */
export function buildLedger(parsed, opts = {}) {
  const totals = emptyGroup();
  const byModelMap = new Map();
  const channels = { main: emptyGroup(), sidechain: emptyGroup() };
  const bySkillMap = new Map();
  const unknownModels = new Set();
  const toolUseName = new Map(); // tool_use id -> tool name (for context attribution)

  for (const turn of parsed.turns || []) {
    const priced = costOfTurn(turn.usage, turn.model, opts);
    if (priced.unknownModel && turn.model) unknownModels.add(turn.model);

    addTurnToGroup(totals, priced);

    const modelKey = priced.normalizedId || turn.model || 'unknown';
    if (!byModelMap.has(modelKey)) byModelMap.set(modelKey, { ...emptyGroup(), source: priced.rateSource, unknown: priced.unknownModel });
    addTurnToGroup(byModelMap.get(modelKey), priced);

    addTurnToGroup(turn.isSidechain ? channels.sidechain : channels.main, priced);

    for (const tu of turn.toolUses || []) {
      if (tu.id) toolUseName.set(tu.id, tu.name);
      if (tu.skill) {
        if (!bySkillMap.has(tu.skill)) bySkillMap.set(tu.skill, { calls: 0 });
        bySkillMap.get(tu.skill).calls += 1;
      }
    }
  }

  // Tool context attribution: join tool_results back to the tool that produced them.
  const byToolMap = new Map();
  // seed with call counts
  for (const name of toolUseName.values()) {
    if (!byToolMap.has(name)) byToolMap.set(name, { name, calls: 0, contextBytes: 0, errors: 0 });
    byToolMap.get(name).calls += 1;
  }
  for (const tr of parsed.toolResults || []) {
    const name = (tr.id && toolUseName.get(tr.id)) || 'unknown';
    if (!byToolMap.has(name)) byToolMap.set(name, { name, calls: 0, contextBytes: 0, errors: 0 });
    const g = byToolMap.get(name);
    g.contextBytes += tr.bytes || 0;
    if (tr.isError) g.errors += 1;
  }

  const grand = totals.cost.total || 0;

  const byModel = [...byModelMap.entries()]
    .map(([key, g]) => ({ key, ...g, share: pct(g.cost.total, grand) }))
    .sort((a, b) => b.cost.total - a.cost.total);

  const byTool = [...byToolMap.values()].sort((a, b) => b.contextBytes - a.contextBytes);
  const bySkill = [...bySkillMap.entries()]
    .map(([name, g]) => ({ name, calls: g.calls }))
    .sort((a, b) => b.calls - a.calls);

  const cacheDenom =
    totals.tokens.cacheRead + totals.tokens.input + totals.tokens.cacheWrite5m + totals.tokens.cacheWrite1h;
  const cacheHitRate = pct(totals.tokens.cacheRead, cacheDenom);

  return {
    totals: { ...totals, cacheHitRate },
    byModel,
    byChannel: {
      main: { ...channels.main, share: pct(channels.main.cost.total, grand) },
      sidechain: { ...channels.sidechain, share: pct(channels.sidechain.cost.total, grand) },
    },
    byTool,
    bySkill,
    unknownModels: [...unknownModels],
    meta: parsed.meta || {},
    compactions: parsed.compactions || [],
  };
}
