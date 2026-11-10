import { createHash } from 'node:crypto';

export const sha1 = (s) => createHash('sha1').update(s).digest('hex');

export const shortId = (prefix, ...parts) =>
  prefix + '-' + sha1(parts.join('\u0000')).slice(0, 10);

export const symId = (rel, qualified) =>
  'S' + sha1(rel + '::' + qualified).slice(0, 12);

export const evidenceId = (...parts) => 'E-' + sha1(parts.join('\u0000')).slice(0, 10);

/** Whitespace-collapsed, line-independent snippet. */
export function collapse(s, max = 200) {
  if (!s) return '';
  const t = String(s).replace(/\r/g, '').replace(/\s+/g, ' ').trim();
  return t.length > max ? t.slice(0, max - 1) + '\u2026' : t;
}

/** Declaration head: first meaningful line(s), no line numbers. */
export function declAnchor(text, max = 200) {
  return collapse(text, max);
}

export function countLines(s) {
  if (!s) return 0;
  let n = 1;
  for (let i = 0; i < s.length; i++) if (s.charCodeAt(i) === 10) n++;
  return n;
}

export function sortBy(arr, fn) {
  return arr.sort((a, b) => {
    const x = fn(a);
    const y = fn(b);
    return x < y ? -1 : x > y ? 1 : 0;
  });
}

/** Deterministic 0..1 hash for pseudo-random but stable ordering. */
export function hashUnit(s, salt = '') {
  const h = sha1(s + '\u0000' + salt).slice(0, 8);
  return parseInt(h, 16) / 0xffffffff;
}

export function pct(covered, total) {
  if (!total) return 0;
  return Math.round((covered / total) * 1000) / 10;
}

export function bump(map, key, by = 1) {
  map.set(key, (map.get(key) || 0) + by);
}

export function topN(map, n) {
  return [...map.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, n);
}
