import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdtempSync, existsSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';

const HERE = dirname(fileURLToPath(import.meta.url));
const HOOK = join(HERE, '..', 'hooks', 'precompact-snapshot.mjs');
const BIN = join(HERE, '..', 'bin', 'tokenomics.mjs');

function runHook(input, home) {
  return spawnSync(process.execPath, [HOOK], {
    input,
    encoding: 'utf8',
    env: { ...process.env, HOME: home },
  });
}

function stateDir(home) {
  return join(home, '.claude', 'tokenomics', 'state');
}

test('precompact hook writes a marker for a normal session_id and exits 0', () => {
  const home = mkdtempSync(join(tmpdir(), 'tok-home-'));
  const r = runHook(JSON.stringify({ session_id: 'abc-123', trigger: 'manual' }), home);
  assert.equal(r.status, 0);
  const file = join(stateDir(home), 'abc-123.compactions.jsonl');
  assert.ok(existsSync(file));
  const rec = JSON.parse(readFileSync(file, 'utf8').trim());
  assert.equal(rec.sessionId, 'abc-123');
  assert.equal(rec.trigger, 'manual');
});

test('precompact hook neutralizes a path-traversal session_id', () => {
  const home = mkdtempSync(join(tmpdir(), 'tok-home-'));
  const r = runHook(JSON.stringify({ session_id: '../../evil' }), home);
  assert.equal(r.status, 0);
  // sanitized to a single safe segment, written INSIDE the state dir
  const safe = join(stateDir(home), '______evil.compactions.jsonl');
  assert.ok(existsSync(safe), 'sanitized file in state dir');
  // nothing escaped above the state dir
  assert.ok(!existsSync(join(home, '.claude', 'tokenomics', 'evil.compactions.jsonl')));
  assert.ok(!existsSync(join(home, 'evil.compactions.jsonl')));
  // the state dir holds exactly one file
  assert.equal(readdirSync(stateDir(home)).length, 1);
});

test('precompact hook treats garbage stdin as an empty event (id "unknown"), exits 0', () => {
  const home = mkdtempSync(join(tmpdir(), 'tok-home-'));
  const r = runHook('this is not json', home);
  assert.equal(r.status, 0);
  assert.ok(existsSync(join(stateDir(home), 'unknown.compactions.jsonl')));
});

test('precompact hook survives empty stdin', () => {
  const home = mkdtempSync(join(tmpdir(), 'tok-home-'));
  const r = runHook('', home);
  assert.equal(r.status, 0);
});

test('scaffold sanitizes a --model value that tries to inject YAML', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'tok-cwd-'));
  const r = spawnSync(
    process.execPath,
    [BIN, 'route', '--scaffold', 'w', '--model', 'haiku\ndescription: injected', '--cwd', cwd],
    { encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' } }
  );
  assert.equal(r.status, 0);
  const body = readFileSync(join(cwd, '.claude', 'agents', 'w.md'), 'utf8');
  // the newline injection is stripped — no second top-level "description: injected" line
  assert.ok(!body.includes('\ndescription: injected'));
  // frontmatter has exactly one model line, still a single YAML document
  assert.equal((body.match(/^model:/gm) || []).length, 1);
});
