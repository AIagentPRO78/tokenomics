import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { findTranscript, encodeCwd } from '../src/transcript.mjs';

test('findTranscript returns an explicit transcriptPath verbatim', async () => {
  const p = await findTranscript({ transcriptPath: '/some/explicit/x.jsonl' });
  assert.equal(p, '/some/explicit/x.jsonl');
});

test('findTranscript resolves <root>/<encoded cwd>/<sessionId>.jsonl', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tok-root-'));
  const cwd = '/Users/test/proj';
  const dir = join(root, encodeCwd(cwd));
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'sess-A.jsonl'), '{}\n');
  await writeFile(join(dir, 'sess-B.jsonl'), '{}\n');
  const p = await findTranscript({ root, cwd, sessionId: 'sess-B' });
  assert.equal(p, join(dir, 'sess-B.jsonl'));
});

test('findTranscript falls back to newest jsonl when sessionId is absent', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tok-root-'));
  const cwd = '/Users/test/proj2';
  const dir = join(root, encodeCwd(cwd));
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'old.jsonl'), '{}\n');
  await new Promise((r) => setTimeout(r, 15));
  await writeFile(join(dir, 'new.jsonl'), '{}\n');
  const p = await findTranscript({ root, cwd });
  assert.equal(p, join(dir, 'new.jsonl'));
});

test('findTranscript scans all project dirs for a sessionId', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tok-root-'));
  const dirA = join(root, encodeCwd('/a'));
  const dirB = join(root, encodeCwd('/b'));
  await mkdir(dirA, { recursive: true });
  await mkdir(dirB, { recursive: true });
  await writeFile(join(dirB, 'target.jsonl'), '{}\n');
  // cwd points at A, but the session lives in B -> global scan finds it
  const p = await findTranscript({ root, cwd: '/a', sessionId: 'target' });
  assert.equal(p, join(dirB, 'target.jsonl'));
});

test('findTranscript returns null when nothing matches', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tok-root-'));
  const p = await findTranscript({ root, cwd: '/nope', sessionId: 'missing' });
  assert.equal(p, null);
});
