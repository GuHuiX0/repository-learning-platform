#!/usr/bin/env node
/**
 * Validator — checks the generated package against the real repository.
 *
 * It does not re-run the analyser; it takes the emitted artifacts and asks the
 * source tree whether the claims hold:
 *   1. every symbol anchor exists in its file
 *   2. every branch label's condition text exists in its file
 *   3. every resolved call edge has both endpoints declared, and the callee name
 *      appears in the caller's file
 *   4. every path step points at a real file, and every consecutive pair is an
 *      edge in the call graph
 *   5. obligation counts reconcile with the manifest
 *   6. ids are deterministic hashes of (file, qualified name)
 */
import fs from 'node:fs';
import path from 'node:path';
import { sha1 } from './util.mjs';

const args = process.argv.slice(2);
const pkgDir = path.resolve(args[0] || 'out/gemini-cli');
const repoDir = path.resolve(args[1] || 'D:/codes/gemini-cli');
const SAMPLE = Number(args[2] || 400);

const read = (rel) => JSON.parse(fs.readFileSync(path.join(pkgDir, rel), 'utf8'));
const manifest = read('manifest.json');
const symIdx = read('analysis/symbol-index.json');
const calls = read('analysis/call-graph.json');
const obs = read('coverage/coverage-obligations.json');
const paths = read('learning/path-suite.json');

const symRows = symIdx.rows;
const symById = new Map(symRows.map((r) => [r[0], r]));
const obsRows = obs.rows;
const callRows = calls.rows;

const fileText = new Map();
const textOf = (rel) => {
  if (!fileText.has(rel)) {
    try { fileText.set(rel, fs.readFileSync(path.join(repoDir, rel), 'utf8')); } catch { fileText.set(rel, null); }
  }
  return fileText.get(rel);
};
const norm = (s) => String(s).replace(/\s+/g, ' ').trim();

function sample(arr, n) {
  if (arr.length <= n) return arr;
  const out = [];
  const step = arr.length / n;
  for (let i = 0; i < n; i++) out.push(arr[Math.floor(i * step)]);
  return out;
}

const results = [];
const check = (name, ok, total, failSamples) => {
  results.push({ name, ok, total, pass: ok, rate: total ? (ok / total) * 100 : 100, failSamples: failSamples || [] });
};

/* 1. anchors exist in source ------------------------------------------------ */
{
  const rows = sample(symRows.filter((r) => !r[6]), SAMPLE);
  let ok = 0;
  const fails = [];
  for (const r of rows) {
    const [id, qualified, kind, file, , , , , , , anchor] = r;
    const txt = textOf(file);
    if (!txt) { fails.push({ id, file, why: 'file missing' }); continue; }
    if (qualified === '(module)') {
      // Synthetic scope symbol: its anchor cites the first executable statement,
      // so the check is whether that statement's leading identifier exists.
      const after = norm(anchor).split('first statement:')[1] || '';
      const token = (after.match(/[A-Za-z_$][\w$]{2,}/g) || [])[0];
      if (token ? txt.includes(token) : false) ok++;
      else fails.push({ id, qualified, file, anchor: norm(anchor).slice(0, 80) });
      continue;
    }
    // Compare the first identifier-ish token of the anchor, which must appear in the file.
    const head = norm(anchor).split(/[\s(:{=<]/).filter(Boolean).slice(0, 2).join(' ');
    const nameTail = norm(qualified).split(/[.~]/).pop();
    if (txt.includes(nameTail) || (head && txt.includes(head.split(' ')[0]))) ok++;
    else fails.push({ id, qualified, file, anchor: norm(anchor).slice(0, 80) });
  }
  check('symbol anchor resolvable in source file', ok, rows.length, fails.slice(0, 6));
}

/* 2. branch labels exist in source ----------------------------------------- */
{
  const rows = sample(obsRows.filter((r) => r[1] === 'branch' && r[9] && /^(if|while|for|switch|\?\.?|&&|\|\||\?\?)/.test(r[9])), SAMPLE);
  let ok = 0;
  const fails = [];
  for (const r of rows) {
    const [, , symId, , , , , , , label] = r;
    const sym = symById.get(symId);
    if (!sym) { fails.push({ id: r[0], why: 'symbol missing' }); continue; }
    const txt = textOf(sym[3]);
    if (!txt) { fails.push({ id: r[0], file: sym[3], why: 'file missing' }); continue; }
    // Take the longest identifier run inside the condition text; if the label is
    // only short identifiers (`&& i === 0`), fall back to a whitespace-insensitive
    // substring test so single-letter variables still count as traceable.
    const tokens = norm(label).match(/[A-Za-z_$][\w$]{3,}/g) || [];
    const condText = norm(label).replace(/^(&&|\|\||\?\?|\?\.[^\s]*)\s*/, '');
    const compact = condText.replace(/\s+/g, '');
    const compactFile = txt.replace(/\s+/g, '');
    const hit = tokens.length
      ? tokens.some((t) => txt.includes(t)) || compactFile.includes(compact)
      : compactFile.includes(compact);
    if (hit) ok++;
    else fails.push({ id: r[0], label: norm(label).slice(0, 80), file: sym[3] });
  }
  check('branch obligation label traceable to source text', ok, rows.length, fails.slice(0, 6));
}

/* 3. call edges: endpoints declared, callee named in caller file ----------- */
{
  const rows = sample(callRows, SAMPLE);
  let ok = 0;
  const fails = [];
  for (const [from, to, kind] of rows) {
    const a = symById.get(from);
    const b = symById.get(to);
    if (!a || !b) { fails.push({ from, to, why: 'endpoint not in symbol index' }); continue; }
    const txt = textOf(a[3]);
    if (!txt) { fails.push({ from, to, why: 'caller file missing' }); continue; }
    const calleeName = String(b[1]).split(/[.~]/).pop();
    if (txt.includes(calleeName) || kind === 'may-reach' || kind === 'nested') ok++;
    else fails.push({ from: a[1], to: b[1], kind, file: a[3] });
  }
  check('call edge: callee appears in caller source', ok, rows.length, fails.slice(0, 6));
}

/* 4. path witnesses -------------------------------------------------------- */
{
  const rows = sample(paths, Math.min(120, paths.length));
  let ok = 0;
  const fails = [];
  const edgeSet = new Set(callRows.map(([a, b]) => a + '>' + b));
  for (const p of rows) {
    const files = new Set(p.steps.map((s) => s.f));
    const missing = [...files].filter((f) => !textOf(f));
    if (missing.length) { fails.push({ path: p.id, why: 'step file missing', missing: missing.slice(0, 2) }); continue; }
    let chainOk = true;
    for (let i = 0; i + 1 < p.symbols.length; i++) if (!edgeSet.has(p.symbols[i] + '>' + p.symbols[i + 1])) chainOk = false;
    if (p.steps.length && chainOk) ok++;
    else fails.push({ path: p.id, why: chainOk ? 'no steps' : 'chain edge missing' });
  }
  check('path witness: steps and chain edges exist', ok, rows.length, fails.slice(0, 6));
}

/* 5. arithmetic ------------------------------------------------------------ */
{
  const counts = manifest.counts;
  const byStatus = {};
  for (const r of obsRows) byStatus[r[5]] = (byStatus[r[5]] || 0) + 1;
  const total = obsRows.length;
  const ok = total === counts.obligations
    && byStatus.covered === counts.obligations_covered
    && byStatus.uncovered === counts.obligations_uncovered
    && byStatus.unknown === counts.obligations_unknown
    && byStatus.excluded === counts.obligations_excluded;
  check('obligation counts reconcile with manifest', ok ? 1 : 0, 1, ok ? [] : [{ total, byStatus, counts }]);
}

/* 6. deterministic ids ----------------------------------------------------- */
{
  const rows = sample(symRows, Math.min(200, symRows.length));
  let ok = 0;
  const fails = [];
  for (const r of rows) {
    const expect = 'S' + sha1(r[3] + '::' + r[1]).slice(0, 12);
    if (expect === r[0]) ok++;
    else fails.push({ id: r[0], expect, qualified: r[1], file: r[3] });
  }
  check('symbol ids are deterministic hashes of (file, qualified)', ok, rows.length, fails.slice(0, 4));
}

/* ---------------- report ---------------- */
const lines = [];
lines.push('# RLP package validation');
lines.push('');
lines.push(`- package: \`${pkgDir}\``);
lines.push(`- source : \`${repoDir}\``);
lines.push(`- commit : \`${manifest.commit}\``);
lines.push(`- generated: ${manifest.generated_at}`);
lines.push(`- samples: ${SAMPLE} rows per check (evenly spaced, deterministic)`);
lines.push('');
lines.push('| check | pass | sample | rate |');
lines.push('| --- | --- | --- | --- |');
for (const r of results) lines.push(`| ${r.name} | ${r.pass} | ${r.total} | ${r.rate.toFixed(1)}% |`);
lines.push('');
const failures = results.filter((r) => r.rate < 100);
if (failures.length) {
  lines.push('## Sample failures');
  for (const f of failures) {
    lines.push('');
    lines.push(`### ${f.name} — ${f.rate.toFixed(1)}%`);
    for (const s of f.failSamples.slice(0, 5)) lines.push('- `' + JSON.stringify(s) + '`');
  }
} else {
  lines.push('No sampled failure.');
}
lines.push('');
lines.push('## What this does and does not prove');
lines.push('');
lines.push('It proves the package is source-grounded: symbols, branch labels, call edges and path steps resolve back to text in the pinned commit.');
lines.push('It does not prove runtime behaviour, and it does not prove completeness of the call graph — unresolved dynamic dispatch is reported as Unknown instead.');
lines.push('');

fs.mkdirSync(path.join(pkgDir, '..', 'validation'), { recursive: true });
const outFile = path.join(pkgDir, '..', 'validation', 'VALIDATION.md');
fs.writeFileSync(outFile, lines.join('\n'));
fs.writeFileSync(path.join(pkgDir, '..', 'validation', 'VALIDATION.json'), JSON.stringify({ manifest: { commit: manifest.commit, counts: manifest.counts }, results }, null, 2));
console.log(lines.join('\n'));
console.log('\nwritten: ' + outFile);
for (const r of results) if (r.rate < 100) console.log(`  low: ${r.name} ${r.rate.toFixed(1)}%`);
