// Rendering only. This module computes no economics — it turns numbers from the
// other modules into terminal output, honouring NO_COLOR and non-TTY pipes.

import { num } from './util.mjs';
import { topContextConsumers } from './context.mjs';

const ESC = '\x1b';
const ANSI = {
  reset: `${ESC}[0m`,
  bold: `${ESC}[1m`,
  dim: `${ESC}[2m`,
  red: `${ESC}[31m`,
  green: `${ESC}[32m`,
  yellow: `${ESC}[33m`,
  blue: `${ESC}[34m`,
  cyan: `${ESC}[36m`,
  gray: `${ESC}[90m`,
};

/** Whether to emit ANSI colour for a given stream. */
export function colorEnabled(stream = process.stdout) {
  if (process.env.NO_COLOR !== undefined && process.env.NO_COLOR !== '') return false;
  if (process.env.FORCE_COLOR !== undefined && process.env.FORCE_COLOR !== '0') return true;
  return !!(stream && stream.isTTY);
}

export function color(s, name, on = true) {
  if (!on || !ANSI[name]) return String(s);
  return `${ANSI[name]}${s}${ANSI.reset}`;
}

/** Format a USD amount with precision that scales to the magnitude. */
export function money(usd) {
  const v = num(usd);
  const a = Math.abs(v);
  let s;
  if (a >= 1) s = v.toFixed(2);
  else if (a >= 0.01) s = v.toFixed(4);
  else s = v.toFixed(6);
  return `$${s}`;
}

/** Human token count: 1234 -> "1.2K", 1500000 -> "1.5M". */
export function tokensHuman(n) {
  const v = num(n);
  if (Math.abs(v) >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (Math.abs(v) >= 1000) return `${(v / 1000).toFixed(1)}K`;
  return `${Math.round(v)}`;
}

const SPARK = '▁▂▃▄▅▆▇█';

/** Unicode sparkline from a numeric series. */
export function sparkline(values) {
  const vals = (values || []).map(num);
  if (vals.length === 0) return '';
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const span = max - min || 1;
  return vals
    .map((v) => SPARK[Math.min(SPARK.length - 1, Math.floor(((v - min) / span) * (SPARK.length - 1)))])
    .join('');
}

/** Horizontal bar: [█████░░░░░] for a 0-100 percent over `width` cells. */
export function bar(percent, width = 20) {
  const p = Math.max(0, Math.min(100, num(percent)));
  const filled = Math.round((p / 100) * width);
  return '█'.repeat(filled) + '░'.repeat(Math.max(0, width - filled));
}

const TIER_COLOR = { ok: 'green', watch: 'cyan', warn: 'yellow', critical: 'red' };
export function tierColor(name) {
  return TIER_COLOR[name] || 'gray';
}

const SEV_COLOR = { high: 'red', medium: 'yellow', low: 'cyan', info: 'gray' };

/** Render a simple left-aligned table from rows of strings. */
export function table(headers, rows) {
  const widths = headers.map((h, i) =>
    Math.max(String(h).length, ...rows.map((r) => String(r[i] ?? '').length))
  );
  const fmtRow = (cells) =>
    cells.map((c, i) => String(c ?? '').padEnd(widths[i])).join('  ').replace(/\s+$/, '');
  const lines = [fmtRow(headers), widths.map((w) => '─'.repeat(w)).join('  ')];
  for (const r of rows) lines.push(fmtRow(r));
  return lines.join('\n');
}

/** One-line statusLine HUD from a parsed statusline ({signal, costUsd, model}). */
export function renderStatusline(parsed, on = colorEnabled(process.stdout)) {
  const { signal, costUsd, model } = parsed;
  const tName = signal.tier.name;
  const gauge = bar(signal.usedPercent, 10);
  const pctTxt = `${signal.usedPercent.toFixed(0)}%`;
  const left = color(`${gauge} ${pctTxt}`, tierColor(tName), on);
  const mid = color(money(costUsd), 'green', on);
  const modelTxt = model && (model.name || model.id) ? color(model.name || model.id, 'gray', on) : '';
  const warn =
    tName === 'critical'
      ? color(' ⚠ compact', 'red', on)
      : tName === 'warn'
        ? color(' ◔ tight', 'yellow', on)
        : '';
  return [left, mid, modelTxt].filter(Boolean).join(color(' · ', 'gray', on)) + warn;
}

/** Full session report. `data` = {ledger, signal?, recs}. */
export function renderReport(data, on = colorEnabled(process.stdout)) {
  const { ledger, signal, recs } = data;
  const t = ledger.totals;
  const out = [];
  const h = (s) => color(s, 'bold', on);
  const dim = (s) => color(s, 'gray', on);

  out.push(h('tokenomics — session report'));
  if (ledger.meta && ledger.meta.sessionId) {
    out.push(
      dim(`session ${ledger.meta.sessionId}${ledger.meta.gitBranch ? ` · ${ledger.meta.gitBranch}` : ''}`)
    );
  }
  out.push('');

  // Headline
  out.push(
    `${h(money(t.cost.total))}  ` +
      dim(
        `across ${t.turns} turns · ${tokensHuman(t.tokens.output)} out · cache hit ${num(t.cacheHitRate).toFixed(0)}%`
      )
  );

  // Live context gauge
  if (signal) {
    const tc = tierColor(signal.tier.name);
    out.push('');
    out.push(
      `context  ${color(bar(signal.usedPercent, 24), tc, on)} ` +
        color(`${signal.usedPercent.toFixed(0)}% ${signal.tier.label}`, tc, on)
    );
  }

  // Cost by model
  if (ledger.byModel.length) {
    out.push('');
    out.push(h('cost by model'));
    out.push(
      table(
        ['model', 'cost', 'share', 'turns', 'src'],
        ledger.byModel.map((m) => [
          m.unknown ? `${m.key} ${color('(est)', 'yellow', on)}` : m.key,
          money(m.cost.total),
          `${m.share.toFixed(0)}%`,
          String(m.turns),
          m.source,
        ])
      )
    );
  }

  // Main vs subagent
  const ch = ledger.byChannel;
  if (ch && (ch.main.turns || ch.sidechain.turns)) {
    out.push('');
    out.push(h('main vs subagents'));
    out.push(
      table(
        ['channel', 'cost', 'share', 'turns'],
        [
          ['main loop', money(ch.main.cost.total), `${num(ch.main.share).toFixed(0)}%`, String(ch.main.turns)],
          [
            'subagents',
            money(ch.sidechain.cost.total),
            `${num(ch.sidechain.share).toFixed(0)}%`,
            String(ch.sidechain.turns),
          ],
        ]
      )
    );
  }

  // Top context consumers
  const consumers = topContextConsumers(ledger, 5);
  if (consumers.length) {
    out.push('');
    out.push(h('top context consumers (tool output)'));
    out.push(
      table(
        ['tool', 'context', 'calls', 'share'],
        consumers.map((c) => [c.name, tokensHuman(c.bytes) + 'B', String(c.calls), `${c.sharePercent.toFixed(0)}%`])
      )
    );
  }

  // Recommendations
  if (recs && recs.length) {
    out.push('');
    out.push(h('recommendations'));
    for (const r of recs) {
      const tag = color(`[${r.severity}]`, SEV_COLOR[r.severity] || 'gray', on);
      const save = r.estSavingUsd ? color(` ~save ${money(r.estSavingUsd)}`, 'green', on) : '';
      out.push(`${tag} ${color(r.title, 'bold', on)}${save}`);
      out.push(dim(`      ${r.detail}`));
      if (r.evalCmd) out.push(dim(`      prove it: ${r.evalCmd}`));
    }
  } else if (Array.isArray(recs)) {
    // recs computed but empty -> show the lean state. recs null/undefined -> omit the section.
    out.push('');
    out.push(dim('no recommendations — this session is lean.'));
  }

  return out.join('\n');
}

/** Render an eval result block. */
export function renderEval(result, on = colorEnabled(process.stdout)) {
  const v = result.verdict;
  const vColor = v === 'improved' ? 'green' : v === 'regressed' ? 'red' : 'gray';
  const out = [];
  out.push(color(`eval: ${result.label}`, 'bold', on));
  out.push(
    table(
      ['', 'before', 'after', 'delta'],
      [
        [
          'cost',
          money(result.before.usd),
          money(result.after.usd),
          `${money(result.deltaUsd)} (${result.percentUsd.toFixed(1)}%)`,
        ],
        [
          'tokens',
          tokensHuman(result.before.billedTokens),
          tokensHuman(result.after.billedTokens),
          `${tokensHuman(result.deltaTokens)} (${result.percentTokens.toFixed(1)}%)`,
        ],
        ['turns', String(result.before.turns), String(result.after.turns), String(result.after.turns - result.before.turns)],
      ]
    )
  );
  const verdictLine =
    v === 'improved'
      ? `verdict: ${color('IMPROVED', vColor, on)} — saved ${money(result.savedUsd)} (${tokensHuman(result.savedTokens)} tokens)`
      : v === 'regressed'
        ? `verdict: ${color('REGRESSED', vColor, on)} — cost ${money(-result.savedUsd)} more`
        : `verdict: ${color('NEUTRAL', vColor, on)}`;
  out.push(verdictLine);
  return out.join('\n');
}
