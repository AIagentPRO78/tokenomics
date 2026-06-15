import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  parseTranscriptText,
  parseTranscriptFile,
  encodeCwd,
  processRecord,
} from '../src/transcript.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(HERE, 'fixtures', 'session.jsonl');

test('encodeCwd matches Claude Code project-dir encoding', () => {
  assert.equal(encodeCwd('/Users/ellerywee/agentmeet'), '-Users-ellerywee-agentmeet');
  assert.equal(encodeCwd('/a/b.c/d'), '-a-b-c-d');
});

test('encodeCwd neutralizes path-traversal input', () => {
  const enc = encodeCwd('../../etc/passwd');
  assert.ok(!enc.includes('..'));
  assert.ok(!enc.includes('/'));
});

test('compactMetadata: top-level takes priority over message-nested', () => {
  const text = JSON.stringify({
    type: 'system',
    compactMetadata: { preTokens: 1, postTokens: 11 },
    message: { compactMetadata: { preTokens: 2, postTokens: 22 } },
  });
  const parsed = parseTranscriptText(text);
  assert.equal(parsed.compactions.length, 1);
  assert.equal(parsed.compactions[0].preTokens, 1);
});

test('parseTranscriptText skips malformed lines without throwing', () => {
  const text = [
    '{"type":"assistant","message":{"model":"claude-opus-4-8","usage":{"input_tokens":1,"output_tokens":1}}}',
    '{ this is broken',
    '',
    '{"type":"assistant","message":{"model":"claude-opus-4-8","usage":{"input_tokens":2,"output_tokens":2}}}',
  ].join('\n');
  const parsed = parseTranscriptText(text);
  assert.equal(parsed.turns.length, 2);
  assert.equal(parsed.meta.skipped, 1);
});

test('extracts tool_use names, Skill name, and tool_result bytes exactly', () => {
  const text = [
    JSON.stringify({
      type: 'assistant',
      isSidechain: false,
      message: {
        model: 'claude-opus-4-8',
        usage: { input_tokens: 1, output_tokens: 1 },
        content: [
          { type: 'tool_use', id: 't1', name: 'Read', input: { file_path: '/x' } },
          { type: 'tool_use', id: 't2', name: 'Skill', input: { skill: 'debugging' } },
        ],
      },
    }),
    JSON.stringify({
      type: 'user',
      message: {
        content: [
          { type: 'tool_result', tool_use_id: 't1', content: 'abcde' }, // 5 bytes
          { type: 'tool_result', tool_use_id: 't2', content: 'xy', is_error: true }, // 2 bytes, error
        ],
      },
    }),
  ].join('\n');
  const parsed = parseTranscriptText(text);
  assert.equal(parsed.turns[0].toolUses.length, 2);
  assert.equal(parsed.turns[0].toolUses[0].name, 'Read');
  assert.equal(parsed.turns[0].toolUses[1].skill, 'debugging');
  const byId = Object.fromEntries(parsed.toolResults.map((r) => [r.id, r]));
  assert.equal(byId.t1.bytes, 5);
  assert.equal(byId.t2.bytes, 2);
  assert.equal(byId.t2.isError, true);
});

test('tool_result with array content measures JSON byte length', () => {
  const content = [{ type: 'text', text: 'hi' }];
  const text = JSON.stringify({
    type: 'user',
    message: { content: [{ type: 'tool_result', tool_use_id: 'a', content }] },
  });
  const parsed = parseTranscriptText(text);
  assert.equal(parsed.toolResults[0].bytes, JSON.stringify(content).length);
});

test('captures isSidechain, compactMetadata, and meta', () => {
  const text = [
    JSON.stringify({
      type: 'assistant',
      isSidechain: true,
      sessionId: 's1',
      cwd: '/p',
      gitBranch: 'dev',
      version: '2.0.0',
      timestamp: '2026-06-15T00:00:00Z',
      message: { model: 'claude-haiku-4-5', usage: { input_tokens: 1, output_tokens: 1 } },
    }),
    JSON.stringify({ type: 'system', compactMetadata: { preTokens: 100, postTokens: 10 } }),
  ].join('\n');
  const parsed = parseTranscriptText(text);
  assert.equal(parsed.turns[0].isSidechain, true);
  assert.equal(parsed.meta.sessionId, 's1');
  assert.equal(parsed.meta.gitBranch, 'dev');
  assert.equal(parsed.compactions.length, 1);
  assert.equal(parsed.compactions[0].preTokens, 100);
});

test('processRecord ignores non-object input safely', () => {
  const acc = { meta: { lines: 0 }, turns: [], toolResults: [], compactions: [] };
  assert.doesNotThrow(() => processRecord(acc, null));
  assert.doesNotThrow(() => processRecord(acc, 42));
});

test('parseTranscriptFile streams the fixture and matches text parse', async () => {
  const fromFile = await parseTranscriptFile(FIXTURE);
  assert.equal(fromFile.turns.length, 4); // u1,u2,u3,u4 (only assistant-with-usage)
  assert.equal(fromFile.meta.skipped, 1); // the malformed trailing line
  assert.equal(fromFile.meta.sessionId, 'sess-fixture');
  assert.equal(fromFile.compactions.length, 1);
});
