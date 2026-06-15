// Locate and parse a Claude Code session transcript (JSONL) into normalized records.
//
// The transcript at ~/.claude/projects/<encoded-cwd>/<sessionId>.jsonl is the
// primary, exact, OFFLINE source of per-turn token usage. Parsing is tolerant:
// a single malformed line is skipped, never thrown — a live transcript may have a
// half-written trailing line while the session is active.

import { createReadStream } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { get, num } from './util.mjs';

// A single JSONL line past this many chars is skipped rather than handed to
// JSON.parse — guards against a crafted transcript with one enormous line.
const MAX_LINE_CHARS = 20_000_000;

/** Encode a cwd the way Claude Code names its projects subdir. */
export function encodeCwd(cwd) {
  return String(cwd || '').replace(/[^a-zA-Z0-9]/g, '-');
}

/** Root of on-disk transcripts. */
export function projectsRoot() {
  return join(homedir(), '.claude', 'projects');
}

/**
 * Resolve a transcript file path.
 * Preference: explicit transcriptPath > <root>/<encoded cwd>/<sessionId>.jsonl >
 * newest *.jsonl in that project dir > newest *.jsonl matching sessionId anywhere.
 * Returns null if nothing is found.
 */
export async function findTranscript({ transcriptPath, cwd, sessionId, root } = {}) {
  if (transcriptPath) return resolve(transcriptPath);
  const base = root || projectsRoot();

  const candidates = [];
  if (cwd) candidates.push(join(base, encodeCwd(cwd)));

  for (const dir of candidates) {
    const newest = await newestJsonl(dir, sessionId);
    if (newest) return newest;
  }

  // Fallback: scan every project dir for the exact sessionId.
  if (sessionId) {
    let dirs = [];
    try {
      dirs = await readdir(base, { withFileTypes: true });
    } catch {
      return null;
    }
    for (const d of dirs) {
      if (!d.isDirectory()) continue;
      const p = join(base, d.name, `${sessionId}.jsonl`);
      if (await exists(p)) return p;
    }
  }
  return null;
}

async function newestJsonl(dir, preferredId) {
  let entries;
  try {
    entries = await readdir(dir);
  } catch {
    return null;
  }
  const jsonl = entries.filter((f) => f.endsWith('.jsonl'));
  if (preferredId && jsonl.includes(`${preferredId}.jsonl`)) {
    return join(dir, `${preferredId}.jsonl`);
  }
  let best = null;
  let bestMtime = -1;
  for (const f of jsonl) {
    const p = join(dir, f);
    try {
      const s = await stat(p);
      if (s.mtimeMs > bestMtime) {
        bestMtime = s.mtimeMs;
        best = p;
      }
    } catch {
      /* ignore */
    }
  }
  return best;
}

async function exists(p) {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

/** Fresh accumulator for parsed transcript state. */
function freshParsed(path) {
  return {
    meta: {
      path: path || null,
      sessionId: null,
      cwd: null,
      gitBranch: null,
      version: null,
      firstTs: null,
      lastTs: null,
      lines: 0,
      skipped: 0,
    },
    turns: [], // assistant turns with usage
    toolResults: [], // {id, name?, bytes, isError}
    compactions: [], // {preTokens, postTokens, ts}
  };
}

/** Fold one parsed JSON record into the accumulator. Pure-ish (mutates acc). */
export function processRecord(acc, rec) {
  if (!rec || typeof rec !== 'object') return acc;
  acc.meta.lines += 1;

  if (rec.sessionId && !acc.meta.sessionId) acc.meta.sessionId = rec.sessionId;
  if (rec.cwd && !acc.meta.cwd) acc.meta.cwd = rec.cwd;
  if (rec.gitBranch && !acc.meta.gitBranch) acc.meta.gitBranch = rec.gitBranch;
  if (rec.version && !acc.meta.version) acc.meta.version = rec.version;
  if (rec.timestamp) {
    if (!acc.meta.firstTs) acc.meta.firstTs = rec.timestamp;
    acc.meta.lastTs = rec.timestamp;
  }

  // compaction bookkeeping (preTokens/postTokens) wherever it appears
  const cm = rec.compactMetadata || get(rec, 'message.compactMetadata', undefined);
  if (cm && (cm.preTokens !== undefined || cm.postTokens !== undefined)) {
    acc.compactions.push({
      preTokens: num(cm.preTokens),
      postTokens: num(cm.postTokens),
      ts: rec.timestamp || null,
    });
  }

  if (rec.type === 'assistant' && rec.message) {
    const msg = rec.message;
    const usage = msg.usage;
    if (usage && typeof usage === 'object') {
      acc.turns.push({
        uuid: rec.uuid || null,
        parentUuid: rec.parentUuid || null,
        ts: rec.timestamp || null,
        model: msg.model || null,
        usage,
        isSidechain: !!rec.isSidechain,
        toolUses: extractToolUses(msg.content),
      });
    }
  } else if (rec.type === 'user' && rec.message) {
    for (const tr of extractToolResults(rec.message.content)) acc.toolResults.push(tr);
  }
  return acc;
}

function extractToolUses(content) {
  if (!Array.isArray(content)) return [];
  const out = [];
  for (const block of content) {
    if (block && block.type === 'tool_use') {
      const entry = { id: block.id || null, name: block.name || 'unknown' };
      if (block.name === 'Skill' && block.input && block.input.skill) {
        entry.skill = String(block.input.skill);
      }
      out.push(entry);
    }
  }
  return out;
}

function extractToolResults(content) {
  if (!Array.isArray(content)) return [];
  const out = [];
  for (const block of content) {
    if (block && block.type === 'tool_result') {
      let bytes = 0;
      try {
        bytes =
          typeof block.content === 'string'
            ? block.content.length
            : JSON.stringify(block.content ?? '').length;
      } catch {
        bytes = 0;
      }
      out.push({ id: block.tool_use_id || null, bytes, isError: !!block.is_error });
    }
  }
  return out;
}

/** Parse transcript text (sync, pure) — primary unit-test entry point. */
export function parseTranscriptText(text, path = null) {
  const acc = freshParsed(path);
  const lines = String(text).split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed.length > MAX_LINE_CHARS) {
      acc.meta.skipped += 1;
      continue;
    }
    let rec;
    try {
      rec = JSON.parse(trimmed);
    } catch {
      acc.meta.skipped += 1;
      continue;
    }
    processRecord(acc, rec);
  }
  return acc;
}

/** Parse a transcript file by streaming lines (memory-safe for large files). */
export async function parseTranscriptFile(path) {
  const acc = freshParsed(path);
  await new Promise((resolveP, rejectP) => {
    const rl = createInterface({
      input: createReadStream(path, { encoding: 'utf8' }),
      crlfDelay: Infinity,
    });
    rl.on('line', (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      if (trimmed.length > MAX_LINE_CHARS) {
        acc.meta.skipped += 1;
        return;
      }
      let rec;
      try {
        rec = JSON.parse(trimmed);
      } catch {
        acc.meta.skipped += 1;
        return;
      }
      processRecord(acc, rec);
    });
    rl.on('close', resolveP);
    rl.on('error', rejectP);
  });
  return acc;
}
