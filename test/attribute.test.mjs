import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseTranscriptFile, parseTranscriptText } from '../src/transcript.mjs';
import { buildLedger } from '../src/attribute.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(HERE, 'fixtures', 'session.jsonl');
const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`);

let ledger;
test('build ledger from fixture', async () => {
  ledger = buildLedger(await parseTranscriptFile(FIXTURE));
  assert.ok(ledger);
});

test('totals: cost and turns', () => {
  // opus turns: u1 0.0175 + u2 0.0275 + u3 0.0525 = 0.0975 ; zztop u4 default 5/25: 0.003
  close(ledger.totals.cost.total, 0.1005);
  assert.equal(ledger.totals.turns, 4);
});

test('cache hit-rate computed over read/input/writes', () => {
  // cacheRead 8000 / (8000 + input 1800 + write1h 2000) = 8000/11800 = 67.79...%
  close(ledger.totals.cacheHitRate, (8000 / 11800) * 100, 1e-6);
});

test('by-model: opus exact + unknown flagged', () => {
  const opus = ledger.byModel.find((m) => m.key === 'claude-opus-4-8');
  const zz = ledger.byModel.find((m) => m.key === 'claude-zztop-9');
  close(opus.cost.total, 0.0975);
  assert.equal(opus.source, 'exact');
  assert.equal(opus.unknown, false);
  assert.equal(zz.unknown, true);
  assert.equal(zz.source, 'default');
  close(zz.cost.total, 0.003);
});

test('by-channel: main vs subagent split', () => {
  // main = u1+u2+u4 = 0.0175+0.0275+0.003 = 0.048 ; sidechain = u3 = 0.0525
  close(ledger.byChannel.main.cost.total, 0.048);
  close(ledger.byChannel.sidechain.cost.total, 0.0525);
  assert.equal(ledger.byChannel.main.turns, 3);
  assert.equal(ledger.byChannel.sidechain.turns, 1);
});

test('by-tool: context bytes joined and ordered, Read largest', () => {
  const names = ledger.byTool.map((t) => t.name);
  assert.deepEqual(names, ['Read', 'Bash', 'Skill']); // 30 > 10 > 1 bytes
  const read = ledger.byTool.find((t) => t.name === 'Read');
  assert.equal(read.calls, 1);
  assert.ok(read.contextBytes > ledger.byTool.find((t) => t.name === 'Bash').contextBytes);
});

test('by-skill: Skill tool_use surfaced', () => {
  assert.equal(ledger.bySkill.length, 1);
  assert.equal(ledger.bySkill[0].name, 'brainstorming');
  assert.equal(ledger.bySkill[0].calls, 1);
});

test('unknownModels and compactions surfaced', () => {
  assert.deepEqual(ledger.unknownModels, ['claude-zztop-9']);
  assert.equal(ledger.compactions.length, 1);
  assert.equal(ledger.compactions[0].preTokens, 50000);
});

test('model shares sum to ~100%', () => {
  const sum = ledger.byModel.reduce((s, m) => s + m.share, 0);
  close(sum, 100, 1e-6);
});

test('counts repeated calls to the same tool', () => {
  const text = JSON.stringify({
    type: 'assistant',
    message: {
      model: 'claude-opus-4-8',
      usage: { input_tokens: 1, output_tokens: 1 },
      content: [
        { type: 'tool_use', id: 'a', name: 'Read' },
        { type: 'tool_use', id: 'b', name: 'Read' },
        { type: 'tool_use', id: 'c', name: 'Read' },
      ],
    },
  });
  const led = buildLedger(parseTranscriptText(text));
  assert.equal(led.byTool.find((t) => t.name === 'Read').calls, 3);
});

test('empty transcript yields zeroed ledger, no throw', () => {
  const empty = buildLedger({ turns: [], toolResults: [], compactions: [], meta: {} });
  assert.equal(empty.totals.cost.total, 0);
  assert.equal(empty.totals.cacheHitRate, 0);
  assert.deepEqual(empty.byModel, []);
});
