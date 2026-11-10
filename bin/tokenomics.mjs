#!/usr/bin/env node
// tokenomics CLI — report | attribute | advise | route | eval | statusline | models
//
// Reads the session transcript JSONL (exact, offline). Never makes a network call.

import { readFileSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { findTranscript, parseTranscriptFile } from '../src/transcript.mjs';
import { buildLedger } from '../src/attribute.mjs';
import { recommend } from '../src/advisor.mjs';
import { contextSignal, fromStatusline } from '../src/context.mjs';
import { diffLedgers } from '../src/evals.mjs';
import { priceFor } from '../src/models.mjs';
import {
  renderReport,
  renderStatusline,
  renderEval,
  colorEnabled,
  money,
  sanitizeText,
  sanitizeData,
  MAX_NAME_CHARS,
} from '../src/format.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG = JSON.parse(readFileSync(join(HERE, '..', 'package.json'), 'utf8'));

// The complete set of options the CLI accepts. Anything else is rejected instead of
// being silently ignored: the /tokenomics slash command builds this command line
// from text typed into a chat, so the script — not the prompt — is what decides
// which arguments are valid.
const BOOLEAN_FLAGS = new Set(['json', 'no-color', 'fast-mode', 'force', 'help', 'version', 'h', 'v']);
const VALUE_FLAGS = new Set([
  'transcript',
  'cwd',
  'session',
  'before',
  'after',
  'label',
  'check',
  'scaffold',
  'model',
]);
const SHORT_FLAGS = new Set(['h', 'v']);
// Options whose value is a filesystem path. A leading "~" is expanded here rather
// than by a shell: /tokenomics passes every value single-quoted, so a shell never
// expands it, and transcripts live under ~/.claude/projects.
const PATH_FLAGS = ['transcript', 'cwd', 'before', 'after'];

/** "~" or "~/x" -> the home directory, the way an unquoted shell word would be. */
function expandHome(p) {
  return p === '~' || p.startsWith('~/') ? homedir() + p.slice(1) : p;
}

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const body = a.slice(2);
      const eq = body.indexOf('=');
      const name = eq >= 0 ? body.slice(0, eq) : body;
      if (BOOLEAN_FLAGS.has(name)) {
        if (eq >= 0) throw new Error(`option --${name} takes no value`);
        args[name] = true;
      } else if (VALUE_FLAGS.has(name)) {
        if (eq >= 0) {
          args[name] = body.slice(eq + 1);
        } else {
          const next = argv[i + 1];
          if (next === undefined || next.startsWith('--')) {
            throw new Error(`option --${name} needs a value`);
          }
          args[name] = next;
          i++;
        }
      } else {
        throw new Error(`unknown option "${sanitizeText(a, MAX_NAME_CHARS)}" (see --help)`);
      }
    } else if (a.startsWith('-') && a.length === 2) {
      if (!SHORT_FLAGS.has(a[1])) {
        throw new Error(`unknown option "${sanitizeText(a, MAX_NAME_CHARS)}" (see --help)`);
      }
      args[a.slice(1)] = true;
    } else {
      args._.push(a);
    }
  }
  return args;
}

function colorOn(args) {
  if (args['no-color']) return false;
  return colorEnabled(process.stdout);
}

function readStdinSync() {
  try {
    return readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

async function loadLedger(args) {
  const path = await findTranscript({
    transcriptPath: args.transcript,
    cwd: args.cwd || process.cwd(),
    sessionId: args.session,
  });
  if (!path || !existsSync(path)) {
    process.stderr.write('tokenomics: no transcript found (try --transcript <path>)\n');
    process.exit(1);
  }
  const parsed = await parseTranscriptFile(path);
  const opts = { fastMode: !!args['fast-mode'] };
  return { ledger: buildLedger(parsed, opts), path };
}

const HELP = `tokenomics ${PKG.version} — see, attribute, and prove the cost & context of a Claude Code session

usage: tokenomics <command> [options]

commands:
  report        Session cost, context gauge, attribution, and top recommendations (default)
  attribute     Cost & context broken down by model, subagent, tool, and skill
  advise        Just the ranked recommendations
  route         Routing advice; --scaffold <name> --model <tier> writes a subagent preset
  eval          Prove a delta: --before <a.jsonl> --after <b.jsonl>
  statusline    One-line HUD from statusLine stdin JSON (used by the statusLine hook)
  models        --check <model-id> shows how an id is priced (exact/family/default)

common options:
  --transcript <path>   explicit transcript file (else newest for --cwd)
  --cwd <dir>           project dir to resolve the transcript from (default: cwd)
  --session <id>        session id to resolve
  --json                machine-readable output
  --no-color            disable ANSI colour
  --fast-mode           price on the fast-mode schedule (known for Opus 4.6/4.7/4.8)
  --version, --help
`;

async function cmdReport(args) {
  const { ledger } = await loadLedger(args);
  const recs = recommend(ledger, null);
  if (args.json) return printJson({ ledger, recs });
  print(renderReport({ ledger, signal: null, recs }, colorOn(args)));
}

async function cmdAttribute(args) {
  const { ledger } = await loadLedger(args);
  if (args.json) return printJson(ledger);
  // attribute view = report without the recommendations section (recs null = omit)
  print(renderReport({ ledger, signal: null, recs: null }, colorOn(args)));
}

async function cmdAdvise(args) {
  const { ledger } = await loadLedger(args);
  const recs = sanitizeData(recommend(ledger, null));
  if (args.json) return printJson(recs);
  const on = colorOn(args);
  if (!recs.length) return print('no recommendations — this session is lean.');
  for (const r of recs) {
    print(`[${r.severity}] ${r.title}${r.estSavingUsd ? ` (~save ${money(r.estSavingUsd)})` : ''}`);
    print(`   ${r.detail}`);
    if (r.evalCmd) print(`   prove it: ${r.evalCmd}`);
  }
}

async function cmdRoute(args) {
  // Scaffolding a preset does not need a transcript — handle it before resolving one.
  if (args.scaffold) return scaffoldSubagent(args);
  const { ledger } = await loadLedger(args);
  const recs = sanitizeData(recommend(ledger, null).filter((r) => r.kind === 'route-subtask'));
  if (args.json) return printJson(recs);
  if (!recs.length) return print('no routing change recommended — subagent spend is already lean.');
  for (const r of recs) {
    print(`${r.title}\n   ${r.detail}`);
  }
  print('\nto act: tokenomics route --scaffold <name> --model haiku');
}

function scaffoldSubagent(args) {
  const name = String(args.scaffold).replace(/[^a-zA-Z0-9_-]/g, '-');
  // sanitize model too — it is interpolated into YAML frontmatter
  const model = String(args.model || 'haiku').replace(/[^a-zA-Z0-9._:-]/g, '') || 'haiku';
  const dir = resolve(args.cwd || process.cwd(), '.claude', 'agents');
  const file = join(dir, `${name}.md`);
  if (existsSync(file) && !args.force) {
    process.stderr.write(`tokenomics: ${sanitizeText(file)} exists (use --force)\n`);
    process.exit(1);
  }
  const body = `---
name: ${name}
description: Cost-routed worker subagent (pinned to ${model} by tokenomics). Use for mechanical fan-out work.
model: ${model}
---

You are a focused worker. Do exactly the task in your prompt and return a concise result.
Keep output minimal — your caller pays for every token you emit.
`;
  mkdirSync(dir, { recursive: true });
  writeFileSync(file, body);
  print(`wrote ${sanitizeText(file)} (model: ${model})`);
}

async function cmdEval(args) {
  if (
    !args.before ||
    !args.after ||
    typeof args.before !== 'string' ||
    typeof args.after !== 'string'
  ) {
    process.stderr.write('tokenomics eval: need --before <a.jsonl> --after <b.jsonl>\n');
    process.exit(1);
  }
  const opts = { fastMode: !!args['fast-mode'] };
  const before = buildLedger(await parseTranscriptFile(resolve(args.before)), opts);
  const after = buildLedger(await parseTranscriptFile(resolve(args.after)), opts);
  const result = diffLedgers(before, after, args.label || 'before vs after');
  if (args.json) return printJson(result);
  print(renderEval(result, colorOn(args)));
}

function cmdStatusline(args) {
  const raw = readStdinSync();
  let stdin = {};
  try {
    stdin = raw ? JSON.parse(raw) : {};
  } catch {
    stdin = {};
  }
  const parsed = fromStatusline(stdin);
  if (!parsed.signal.windowSize && !parsed.costUsd && !parsed.signal.usedPercent) {
    // nothing useful on stdin — emit a minimal, non-noisy line
    return process.stdout.write('tokenomics\n');
  }
  process.stdout.write(renderStatusline(parsed, colorOn(args)) + '\n');
}

function cmdModels(args) {
  const id = args.check || args._[1];
  if (!id) {
    process.stderr.write('tokenomics models: --check <model-id>\n');
    process.exit(1);
  }
  const r = sanitizeData(priceFor(id));
  if (args.json) return printJson(r);
  print(
    `${sanitizeText(id, MAX_NAME_CHARS)}\n  normalized: ${r.normalizedId}\n  rates: in $${r.input}/MTok · out $${r.output}/MTok\n  source: ${r.source}${r.unknown ? ' (UNKNOWN — estimate)' : ''}${r.note ? `\n  note: ${r.note}` : ''}`
  );
}

function print(s) {
  process.stdout.write(s + '\n');
}

/** --json output: same data, with every string cleaned the way the text views are. */
function printJson(value) {
  print(JSON.stringify(sanitizeData(value), null, 2));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  for (const name of PATH_FLAGS) {
    if (typeof args[name] === 'string') args[name] = expandHome(args[name]);
  }
  if (args.version || args.v) return print(PKG.version);
  if (args.help || args.h) return print(HELP);

  const cmd = args._[0] || 'report';
  // one command word; `models` may also take the model id positionally
  const extra = args._[cmd === 'models' ? 2 : 1];
  if (extra !== undefined) {
    throw new Error(`unexpected argument "${sanitizeText(extra, MAX_NAME_CHARS)}" (see --help)`);
  }
  switch (cmd) {
    case 'report':
      return cmdReport(args);
    case 'attribute':
      return cmdAttribute(args);
    case 'advise':
      return cmdAdvise(args);
    case 'route':
      return cmdRoute(args);
    case 'eval':
      return cmdEval(args);
    case 'statusline':
      return cmdStatusline(args);
    case 'models':
      return cmdModels(args);
    case 'help':
      return print(HELP);
    default:
      process.stderr.write(
        `tokenomics: unknown command "${sanitizeText(cmd, MAX_NAME_CHARS)}"\n\n${HELP}`
      );
      process.exit(1);
  }
}

main().catch((err) => {
  process.stderr.write(`tokenomics: ${sanitizeText(err && err.message ? err.message : err)}\n`);
  process.exit(1);
});
