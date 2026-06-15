// Tiny shared helpers. No domain logic lives here — only things that would
// otherwise be duplicated and drift.

/** Coerce to a finite number, else `fallback`. Guards against null/NaN/strings. */
export function num(v, fallback = 0) {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/** Sum a list of numbers, tolerating non-numeric entries. */
export function sum(list) {
  let t = 0;
  for (const v of list) t += num(v);
  return t;
}

/** part/whole as a 0-100 percentage; 0 when whole is 0. */
export function pct(part, whole) {
  const w = num(whole);
  if (w === 0) return 0;
  return (num(part) / w) * 100;
}

/** Clamp n into [lo, hi]. */
export function clamp(n, lo, hi) {
  return Math.min(hi, Math.max(lo, num(n)));
}

/** Deep-get a nested path safely: get(obj, 'a.b.c', fallback). */
export function get(obj, path, fallback) {
  let cur = obj;
  for (const key of path.split('.')) {
    if (cur == null || typeof cur !== 'object') return fallback;
    cur = cur[key];
  }
  return cur === undefined ? fallback : cur;
}
