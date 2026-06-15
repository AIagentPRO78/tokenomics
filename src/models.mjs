// Model registry: resolve a model id to its per-MTok input/output rates.
//
// Lookup order (first hit wins):
//   1. exact id in `models`
//   2. first matching `families[].pattern` (regex over the normalized id)
//   3. `default` (flagged unknown:true so callers can warn)
//
// Future-proofing: a returning or brand-new model (Fable 5, Opus 5, ...) is priced
// by a family pattern with zero code change. Only a genuinely unrecognised family
// falls through to the conservative default.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const DATA_PATH = join(HERE, 'models.json');

let cachedRegistry = null;

/** Load and cache models.json. Pass an object to inject a registry (tests). */
export function loadRegistry(inject) {
  if (inject) return inject;
  if (cachedRegistry) return cachedRegistry;
  try {
    cachedRegistry = JSON.parse(readFileSync(DATA_PATH, 'utf8'));
  } catch (err) {
    throw new Error(
      `tokenomics: cannot load model registry at ${DATA_PATH} — reinstall the plugin (${err && err.message ? err.message : err})`
    );
  }
  return cachedRegistry;
}

/**
 * Normalize a raw model id from a transcript/API into a canonical form for lookup.
 * Strips provider prefixes, region/date/version suffixes, and context-window tags
 * that do not change pricing. Never throws; returns '' for nullish input.
 *
 *   "us.anthropic.claude-opus-4-8-20260101-v1:0" -> "claude-opus-4-8"
 *   "claude-opus-4-8[1m]"                         -> "claude-opus-4-8"
 *   "claude-sonnet-4-6@20260301"                  -> "claude-sonnet-4-6"
 */
export function normalizeModelId(raw) {
  if (!raw || typeof raw !== 'string') return '';
  let id = raw.trim().toLowerCase();

  // Provider/region prefixes. Order matters for COMPOUND prefixes like
  // "bedrock/us.anthropic.…": strip the platform first, then the region, then
  // the vendor — otherwise the region strip runs too early and leaves "us." behind.
  id = id.replace(/^(bedrock|vertex|foundry)[/.]/, ''); // platform: bedrock/ vertex/ foundry/
  id = id.replace(/^[a-z]{2}\./, ''); // region: us. eu. apac. -> (drop)
  id = id.replace(/^anthropic\./, ''); // vendor

  // Context-window / capability tags: "[1m]", "(1m)"
  id = id.replace(/[[(]\d+[a-z]?[\])]/g, '');

  // Vertex/Foundry "@date" and Bedrock "-v1:0" / ":0" suffixes
  id = id.replace(/@[\w-]+$/, '');
  id = id.replace(/-v\d+:\d+$/, '');
  id = id.replace(/:\d+$/, '');

  // Trailing release date: "-20260101" (6-8 digits)
  id = id.replace(/-\d{6,8}$/, '');

  // Defensive: collapse any stray trailing separators/space
  id = id.replace(/[-_.\s]+$/, '');

  return id;
}

/**
 * Resolve rates for a model id.
 * @returns {{input:number, output:number, source:'exact'|'family'|'default', unknown:boolean, normalizedId:string, note?:string}}
 */
export function priceFor(rawId, inject) {
  const reg = loadRegistry(inject);
  const id = normalizeModelId(rawId);

  if (id && Object.prototype.hasOwnProperty.call(reg.models, id)) {
    const m = reg.models[id];
    return { input: m.input, output: m.output, source: 'exact', unknown: false, normalizedId: id };
  }

  if (id) {
    for (const fam of reg.families) {
      let re;
      try {
        re = new RegExp(fam.pattern);
      } catch {
        continue; // a malformed pattern must never crash pricing
      }
      if (re.test(id)) {
        return {
          input: fam.input,
          output: fam.output,
          source: 'family',
          unknown: false,
          normalizedId: id,
          note: fam.note,
        };
      }
    }
  }

  const d = reg.default;
  return {
    input: d.input,
    output: d.output,
    source: 'default',
    unknown: true,
    normalizedId: id,
    note: d.note,
  };
}

/**
 * Fast-mode rates for a model id, if a fast schedule is known. Fast mode is a
 * separate price schedule with NO usage flag in the transcript, so callers opt
 * in (e.g. `--fast-mode`). Returns null when no fast schedule is known for the id.
 * @returns {{input:number, output:number, normalizedId:string}|null}
 */
export function fastPriceFor(rawId, inject) {
  const reg = loadRegistry(inject);
  const id = normalizeModelId(rawId);
  if (reg.fast && id && Object.prototype.hasOwnProperty.call(reg.fast, id)) {
    const f = reg.fast[id];
    return { input: f.input, output: f.output, normalizedId: id };
  }
  return null;
}

/** Universal cache/add-on multipliers and modifiers (data-driven). */
export function rateConfig(inject) {
  const reg = loadRegistry(inject);
  return {
    multipliers: reg.multipliers,
    modifiers: reg.modifiers,
    addons: reg.addons,
    version: reg.version,
  };
}
