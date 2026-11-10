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

// Untrusted text. Session ids, branch names, model ids and tool names are copied
// out of the transcript, which may be a file somebody else wrote. Before any of it
// reaches a terminal (or a model reading the output) it is reduced HERE, in the
// rendering layer, to one bounded line of printable text.
export const MAX_NAME_CHARS = 128; // ids in headers and table cells (fits a long MCP tool name)
export const MAX_TEXT_CHARS = 1024; // any other string (advice sentences, paths)
const MAX_DEPTH = 12; // the deepest real ledger path is 6 levels

// CSI (ESC [ ... final byte, or the C1 form), then OSC/DCS/SOS/PM/APC strings up
// to BEL or ST, then any other ESC-introduced sequence.
const ESCAPE_SEQUENCES =
  /(?:\x1b\[|\x9b)[0-?]*[ -/]*[@-~]|(?:\x1b[\]PX^_]|[\x90\x98\x9d-\x9f])[^\x07\x1b\x9c]*(?:\x07|\x1b\\|\x9c)?|\x1b[ -/]*[0-~]?/g;
// Line/tab-like controls become one space so words stay separated ...
const BREAKS = /[\t\n\v\f\r\x85\u2028\u2029]+/g;
// ... every other C0/C1 control, DEL, and the bidi override/isolate characters go.
const CONTROLS = /[\x00-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]/g;

/** Reduce an untrusted value to a single printable line of at most `max` chars. */
export function sanitizeText(value, max = MAX_TEXT_CHARS) {
  let s = String(value ?? '');
  // bound the work first: one field can be as long as a whole transcript line
  if (s.length > max * 4) s = s.slice(0, max * 4);
  s = s.replace(ESCAPE_SEQUENCES, '').replace(BREAKS, ' ').replace(CONTROLS, '');
  if (s.length > max) s = s.slice(0, max - 1).replace(/[\ud800-\udbff]$/, '') + '…';
  return s;
}

/** Deep copy of plain data with every string (keys included) through sanitizeText. */
export function sanitizeData(value, max = MAX_TEXT_CHARS, depth = 0) {
  if (typeof value === 'string') return sanitizeText(value, max);
  if (value === null || typeof value !== 'object') return value;
  if (depth >= MAX_DEPTH) return null; // hostile nesting: drop it rather than recurse
  if (Array.isArray(value)) return value.map((v) => sanitizeData(v, max, depth + 1));
  return Object.fromEntries(
    Object.entries(value).map(([k, v]) => [sanitizeText(k, max), sanitizeData(v, max, depth + 1)])
  );
}

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
  const modelTxt =
    model && (model.name || model.id)
      ? color(sanitizeText(model.name || model.id, MAX_NAME_CHARS), 'gray', on)
      : '';
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
  // every string below (names, advice text, suggested commands) is cleaned first
  const { ledger, signal, recs } = sanitizeData(data);
  const t = ledger.totals;
  const out = [];
  const h = (s) => color(s, 'bold', on);
  const dim = (s) => color(s, 'gray', on);
  const name = (v) => sanitizeText(v, MAX_NAME_CHARS);

  out.push(h('tokenomics — session report'));
  if (ledger.meta && ledger.meta.sessionId) {
    out.push(
      dim(
        `session ${name(ledger.meta.sessionId)}${ledger.meta.gitBranch ? ` · ${name(ledger.meta.gitBranch)}` : ''}`
      )
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
          m.unknown ? `${name(m.key)} ${color('(est)', 'yellow', on)}` : name(m.key),
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
        consumers.map((c) => [name(c.name), tokensHuman(c.bytes) + 'B', String(c.calls), `${c.sharePercent.toFixed(0)}%`])
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
  out.push(color(`eval: ${sanitizeText(result.label)}`, 'bold', on));
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
