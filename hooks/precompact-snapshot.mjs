#!/usr/bin/env node
// PreCompact hook — fires just before the context window is compacted.
//
// Deliberately silent on the happy path: it writes a small compaction marker to a
// per-session state file and exits 0. It injects NOTHING into context and never
// blocks compaction — a cost/context plugin must not itself bloat the window or
// surprise the user. The session report later reads these markers.
//
// Failure handling is split on purpose: a malformed-stdin parse error is an
// expected, swallowed condition; a disk-write error is a real failure surfaced to
// stderr (so it is observable) but still never fails the session.

import { readFileSync, mkdirSync, appendFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, sep } from 'node:path';

function readStdin() {
  try {
    return readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

/** Reduce an untrusted id to a safe single path segment. */
function safeSegment(value, fallback = 'unknown') {
  const s = String(value == null ? '' : value)
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .slice(0, 128);
  return s || fallback;
}

// Parse (expected to sometimes fail on malformed stdin — swallowed).
let ev = {};
try {
  const raw = readStdin();
  const parsed = raw ? JSON.parse(raw) : {};
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) ev = parsed;
} catch {
  ev = {};
}

// Write the marker (a real failure here is logged, not silently dropped).
try {
  const safeId = safeSegment(ev.session_id);
  const dir = join(homedir(), '.claude', 'tokenomics', 'state');
  const file = join(dir, `${safeId}.compactions.jsonl`);
  // defense in depth: the resolved path must stay inside the state dir
  if (!file.startsWith(dir + sep)) {
    throw new Error('refusing to write outside the state directory');
  }
  const marker = {
    sessionId: safeId,
    trigger: ev.trigger || ev.matcher || null,
    transcriptPath: ev.transcript_path || null,
    at: ev.timestamp || null,
  };
  mkdirSync(dir, { recursive: true });
  appendFileSync(file, JSON.stringify(marker) + '\n');
} catch (err) {
  // observable in dev, but never fail the session over bookkeeping
  if (process.env.TOKENOMICS_DEBUG) {
    process.stderr.write(`tokenomics precompact: ${err && err.message ? err.message : err}\n`);
  }
}

// no stdout => no context injection, no block
process.exit(0);
