import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFileSync, existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';

const HERE = dirname(fileURLToPath(import.meta.url));
const BIN = join(HERE, '..', 'bin', 'tokenomics.mjs');
const FIXTURE = join(HERE, 'fixtures', 'session.jsonl');
const AFTER = join(HERE, 'fixtures', 'after.jsonl');
const PKG = JSON.parse(readFileSync(join(HERE, '..', 'package.json'), 'utf8'));

function run(args, input = '') {
  return spawnSync(process.execPath, [BIN, ...args], {
    input,
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1' },
  });
}

test('--version prints package version', () => {
  const r = run(['--version']);
  assert.equal(r.status, 0);
  assert.equal(r.stdout.trim(), PKG.version);
});

test('--help prints usage', () => {
  const r = run(['--help']);
  assert.equal(r.status, 0);
  assert.ok(r.stdout.includes('usage: tokenomics'));
});

test('models --check prices a known model', () => {
  const r = run(['models', '--check', 'claude-fable-5']);
  assert.equal(r.status, 0);
  assert.ok(r.stdout.includes('$10'));
  assert.ok(r.stdout.includes('$50'));
  assert.ok(r.stdout.includes('exact'));
});

test('models --check flags an unknown model', () => {
  const r = run(['models', '--check', 'claude-zztop-9', '--json']);
  assert.equal(r.status, 0);
  const j = JSON.parse(r.stdout);
  assert.equal(j.unknown, true);
  assert.equal(j.source, 'default');
});

test('report --json over a fixture transcript', () => {
  const r = run(['report', '--transcript', FIXTURE, '--json']);
  assert.equal(r.status, 0);
  const j = JSON.parse(r.stdout);
  assert.ok(Math.abs(j.ledger.totals.cost.total - 0.1005) < 1e-9);
  assert.equal(j.ledger.totals.turns, 4);
  assert.ok(Array.isArray(j.recs));
});

test('report (text) renders a readable report', () => {
  const r = run(['report', '--transcript', FIXTURE]);
  assert.equal(r.status, 0);
  assert.ok(r.stdout.includes('$0.1005'));
  assert.ok(r.stdout.includes('cost by model'));
  assert.ok(!r.stdout.includes('\x1b'), 'NO_COLOR honoured');
});

test('advise emits the routing recommendation for the fixture', () => {
  const r = run(['advise', '--transcript', FIXTURE]);
  assert.equal(r.status, 0);
  // fixture has an Opus subagent (sidechain) -> route-subtask must fire
  assert.ok(/Route mechanical subagents/.test(r.stdout), 'route advice present');
});

test('statusline renders from stdin JSON', () => {
  const stdin = JSON.stringify({
    context_window: { used_percentage: 73, context_window_size: 200000 },
    cost: { total_cost_usd: 0.42 },
    model: { id: 'claude-opus-4-8', display_name: 'Opus 4.8' },
  });
  const r = run(['statusline'], stdin);
  assert.equal(r.status, 0);
  assert.ok(r.stdout.includes('73%'));
  assert.ok(r.stdout.includes('$0.42'));
});

test('statusline survives empty stdin without crashing', () => {
  const r = run(['statusline'], '');
  assert.equal(r.status, 0);
  assert.ok(r.stdout.trim().length > 0);
});

test('missing transcript exits non-zero with a helpful message', () => {
  const r = run(['report', '--transcript', '/no/such/file.jsonl']);
  assert.notEqual(r.status, 0);
});

test('unknown command exits non-zero', () => {
  const r = run(['frobnicate']);
  assert.notEqual(r.status, 0);
  assert.ok(r.stderr.includes('unknown command'));
});

test('attribute renders the breakdown without recommendations', () => {
  const r = run(['attribute', '--transcript', FIXTURE]);
  assert.equal(r.status, 0);
  assert.ok(r.stdout.includes('cost by model'));
  assert.ok(!r.stdout.includes('recommendations'));
});

test('eval proves a before/after delta as JSON', () => {
  const r = run(['eval', '--before', FIXTURE, '--after', AFTER, '--json']);
  assert.equal(r.status, 0);
  const j = JSON.parse(r.stdout);
  assert.equal(j.verdict, 'improved');
  assert.ok(j.savedUsd > 0);
});

test('eval requires both --before and --after', () => {
  const r = run(['eval', '--before', FIXTURE]);
  assert.notEqual(r.status, 0);
});

test('route prints advice for the fixture', () => {
  const r = run(['route', '--transcript', FIXTURE]);
  assert.equal(r.status, 0);
  assert.ok(/Route|route --scaffold/.test(r.stdout));
});

test('route --scaffold writes a cost-routed subagent preset', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'tok-cwd-'));
  const r = run(['route', '--scaffold', 'cheap-worker', '--model', 'haiku', '--cwd', cwd]);
  assert.equal(r.status, 0);
  const file = join(cwd, '.claude', 'agents', 'cheap-worker.md');
  assert.ok(existsSync(file), 'preset file created');
  const body = readFileSync(file, 'utf8');
  assert.ok(body.includes('model: haiku'));
  assert.ok(body.includes('name: cheap-worker'));
});
