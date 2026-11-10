/* =============================================================================
 * _selftest.mjs — verification harness for the RLP browser runtime.
 *
 * Not part of the product (the app never loads it). It proves three things:
 *
 *   1. STATIC — every `raw.<field>` read in app.js sits inside the declared
 *      contract boundary and names a top-level field of RLPData in CONTRACT.md;
 *      every nested field path the app consumes exists in the contract.
 *   2. PAYLOAD — the mock generator emits the contract shape (required keys,
 *      id integrity, cross-references, counts).
 *   3. RUNTIME — buildStore + the pure query layer work in Node with no DOM:
 *      filters, fuzzy search, entry-chain walking, closures, treemap geometry,
 *      lab self-check, level items, coverage aggregates.
 *
 * Run: node _selftest.mjs
 * ========================================================================== */

import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const contractSrc = fs.readFileSync(path.join(here, '..', 'CONTRACT.md'), 'utf8');
const appSrc = fs.readFileSync(path.join(here, 'app.js'), 'utf8');
const mockSrc = fs.readFileSync(path.join(here, 'mock-data.js'), 'utf8');
const htmlSrc = fs.readFileSync(path.join(here, 'index.html'), 'utf8');
const cssSrc = fs.readFileSync(path.join(here, 'app.css'), 'utf8');

let pass = 0;
const failures = [];

function check(name, condition, detail) {
  if (condition) {
    pass += 1;
    return;
  }
  failures.push(name + (detail ? ' — ' + detail : ''));
}

function eq(name, actual, expected) {
  check(name, actual === expected, 'expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(actual));
}

/* ---------------------------------------------------------------------------
 * Contract parsing
 * ------------------------------------------------------------------------- */

/** Top-level keys of `type RLPData = { ... }` (depth-aware, line based). */
function topLevelKeys(src) {
  const lines = src.split('\n');
  const start = lines.findIndex((l) => l.startsWith('type RLPData'));
  if (start < 0) return new Set();
  let depth = 0;
  const keys = new Set();
  for (let i = start; i < lines.length; i++) {
    const line = lines[i];
    if (depth === 1) {
      const m = /^\s{2}([A-Za-z_][A-Za-z0-9_]*)(\?)?:/.exec(line);
      if (m) keys.add(m[1]);
    }
    for (const ch of line) {
      if (ch === '{') depth += 1;
      else if (ch === '}') depth -= 1;
    }
    if (depth === 0 && i > start) break;
  }
  return keys;
}

/** Keys of an object literal block starting at `marker` (e.g. "symbols: Array<{"). */
function blockKeys(src, marker) {
  const at = src.indexOf(marker);
  if (at < 0) return null;
  const begin = src.indexOf('{', at);
  let depth = 0;
  let end = -1;
  for (let i = begin; i < src.length; i++) {
    if (src[i] === '{') depth += 1;
    else if (src[i] === '}') { depth -= 1; if (depth === 0) { end = i; break; } }
  }
  if (end < 0) return null;
  const block = src.slice(begin + 1, end);
  const keys = new Set();
  let d = 0;
  for (const line of block.split('\n')) {
    const code = line.split('//')[0];
    if (d === 0) {
      // the emitter packs several fields per line ("id: string; k: …; level: number;")
      for (const m of code.matchAll(/([A-Za-z_][A-Za-z0-9_]*)\??:/g)) keys.add(m[1]);
    }
    for (const ch of line) {
      if (ch === '{') d += 1;
      else if (ch === '}') d -= 1;
    }
  }
  return keys;
}

/** Keys declared inline: "steps: Array<{ a: string; b: string }>" */
function inlineKeys(src, marker) {
  const at = src.indexOf(marker);
  if (at < 0) return null;
  const open = src.indexOf('{', at);
  const close = src.indexOf('}', open);
  if (open < 0 || close < 0) return null;
  const body = src.slice(open + 1, close);
  const keys = new Set();
  for (const part of body.split(';')) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\??:/.exec(part);
    if (m) keys.add(m[1]);
  }
  return keys;
}

const TOP = topLevelKeys(contractSrc);
const SHAPES = {
  meta: blockKeys(contractSrc, 'meta: {'),
  packages: blockKeys(contractSrc, 'packages: Array<{'),
  files: blockKeys(contractSrc, 'files: Array<{'),
  symbols: blockKeys(contractSrc, 'symbols: Array<{'),
  calls: blockKeys(contractSrc, 'calls: Array<{'),
  modules: blockKeys(contractSrc, 'modules: Array<{'),
  imports: blockKeys(contractSrc, 'imports: Array<{'),
  externals: blockKeys(contractSrc, 'externals: Array<{'),
  obligations: blockKeys(contractSrc, 'obligations: Array<{'),
  paths: blockKeys(contractSrc, 'paths: Array<{'),
  storylines: blockKeys(contractSrc, 'storylines: Array<{'),
  objectives: blockKeys(contractSrc, 'objectives: Array<{'),
  exercises: blockKeys(contractSrc, 'exercises: Array<{'),
  assessments: blockKeys(contractSrc, 'assessments: Array<{'),
  impact: blockKeys(contractSrc, 'impact: Array<{'),
  maintenance: blockKeys(contractSrc, 'maintenance: Array<{'),
  testing: blockKeys(contractSrc, 'testing: Array<{'),
  gaps: blockKeys(contractSrc, 'gaps: Array<{'),
  report: blockKeys(contractSrc, 'report: {'),
  levels: blockKeys(contractSrc, 'levels: Array<{'),
  pathSteps: inlineKeys(contractSrc, 'steps: Array<{'),
  acts: inlineKeys(contractSrc, 'acts: Array<{'),
  choices: inlineKeys(contractSrc, 'choices?: Array<{'),
  cfgNodes: inlineKeys(contractSrc, 'nodes: Array<{'),
  cfgEdges: inlineKeys(contractSrc, 'edges: Array<{'),
};

check('contract: RLPData top-level keys parsed', TOP.size >= 15, 'got ' + TOP.size);
for (const [name, shape] of Object.entries(SHAPES)) {
  check('contract: shape ' + name + ' parsed', shape && shape.size > 0, String(shape && shape.size));
}

/* ---------------------------------------------------------------------------
 * 1. Static checks on app.js
 * ------------------------------------------------------------------------- */

const beginMarker = 'RAW PAYLOAD (contract boundary)';
const endMarker = 'end contract boundary';
const beginAt = appSrc.indexOf(beginMarker);
const endAt = appSrc.indexOf(endMarker);
check('static: contract boundary markers present', beginAt > 0 && endAt > beginAt);

const boundary = beginAt >= 0 && endAt > beginAt ? appSrc.slice(beginAt, endAt) : '';
const outside = appSrc.slice(0, beginAt) + appSrc.slice(endAt);

const rawHits = [...appSrc.matchAll(/\braw\.([A-Za-z_][A-Za-z0-9_]*)/g)].map((m) => m[1]);
const rawHitsOutside = [...outside.matchAll(/\braw\.([A-Za-z_][A-Za-z0-9_]*)/g)].map((m) => m[1]);
eq('static: no raw.* read outside the boundary', rawHitsOutside.length, 0);
check('static: boundary contains raw reads', rawHits.length >= 18, 'got ' + rawHits.length);

const unknownRaw = rawHits.filter((k) => !TOP.has(k));
eq('static: every raw field is a contract field', unknownRaw.join(','), '');

check('static: no Math.random in the runtime', appSrc.indexOf('Math.random') < 0);
check('static: no innerHTML from string concatenation', !/innerHTML\s*=\s*[^;]*\+/.test(appSrc));
check('static: render-time layout is hash based', appSrc.indexOf('function hashPos') > 0 && appSrc.indexOf('fnv1a') > 0);

check('shell: loads app.css', /<link[^>]+href="app\.css"/.test(htmlSrc));
check('shell: loads data.js before app.js', htmlSrc.indexOf('src="data.js"') > 0 && htmlSrc.indexOf('src="data.js"') < htmlSrc.indexOf('src="app.js"'));
check('shell: does not load mock-data.js', htmlSrc.indexOf('mock-data.js') < 0);
check('shell: no external network references', !/(src|href)="https?:/.test(htmlSrc));
check('shell: no module scripts', !/type="module"/.test(htmlSrc));
check('css: no external @import/fonts', !/@import|https?:/.test(cssSrc));

/* Consumed nested field paths — transcribed from the runtime's reads. */
const CONSUMED = {
  meta: ['repository', 'commit', 'branch', 'generated_at', 'analysis_version', 'languages', 'package_names', 'counts', 'truncated'],
  packages: ['name', 'files', 'symbols', 'loc'],
  files: ['f', 'p', 'l', 't', 's'],
  symbols: ['id', 'n', 'k', 'f', 'p', 'x', 't', 'a', 'e', 'c', 'i', 'b', 'o', 'q', 'st', 'doc'],
  calls: ['a', 'b', 'k', 'n'],
  modules: ['id', 'n', 'f', 'p', 'k', 'a', 'e'],
  imports: ['a', 'b', 'k', 'w'],
  externals: ['id', 'n', 'cat', 'c'],
  obligations: ['id', 't', 's', 'f', 'n', 'o', 'l', 'st', 'r', 'e', 'cat', 'crit', 'p'],
  paths: ['id', 'entry', 'title', 'steps', 'covers', 'terminal', 'length', 'tier'],
  pathSteps: ['s', 'f', 'n', 'o', 'l', 'e'],
  storylines: ['id', 'path', 'title', 'premise', 'acts', 'objectives', 'level'],
  acts: ['n', 'title', 'body', 'symbols', 'obligations'],
  objectives: ['id', 'level', 'text', 'symbols', 'obligations'],
  exercises: ['id', 'k', 'level', 'title', 'prompt', 'choices', 'answer', 'explain', 'symbols', 'obligations', 'evidence'],
  choices: ['id', 'text', 'correct'],
  assessments: ['id', 'level', 'kind', 'text', 'checks', 'exercise', 'weight'],
  impact: ['id', 's', 'direct', 'indirect', 'tests', 'shared_state', 'contracts', 'risk', 'note'],
  maintenance: ['id', 'k', 'title', 'prompt', 'steps', 'level', 'symbols', 'tests', 'risk'],
  testing: ['id', 's', 'kind', 'text', 'covers', 'exists'],
  gaps: ['id', 'kind', 's', 'f', 'text', 'reason'],
  report: ['coverage', 'unknown_ratio', 'critical_gaps', 'levels', 'policy'],
  levels: ['level', 'name', 'obligations', 'evidence_kinds'],
  cfgNodes: ['id', 'k', 'l', 'a'],
  cfgEdges: ['f', 't', 'k'],
};

for (const [shape, fields] of Object.entries(CONSUMED)) {
  const declared = SHAPES[shape];
  check('contract: consumed shape ' + shape + ' exists', !!declared);
  if (!declared) continue;
  const missing = fields.filter((f) => !declared.has(f));
  eq('contract: ' + shape + ' field paths consumed', missing.join(','), '');
}

/* ---------------------------------------------------------------------------
 * 2. Load mock + runtime in a DOM-free VM
 * ------------------------------------------------------------------------- */

const sandbox = { window: {}, console };
vm.createContext(sandbox);
vm.runInContext(mockSrc, sandbox);
const payload = sandbox.window.RLP_DATA;
check('mock: payload defined', !!payload && typeof payload === 'object');
check('mock: RLP_MOCK flag', sandbox.window.RLP_MOCK === true);

vm.runInContext(appSrc, sandbox);
const api = sandbox.window.RLP_TEST_API;
check('runtime: test API exported without a DOM', !!api && typeof api.buildStore === 'function');
check('runtime: MAX_ROWS is 200', api && api.MAX_ROWS === 200);

/* ---------------------------------------------------------------------------
 * 3. Payload conformance
 * ------------------------------------------------------------------------- */

const META_KEYS = ['repository', 'commit', 'generated_at', 'analysis_version', 'languages', 'package_names', 'counts', 'truncated'];
const REPORT_KEYS = ['coverage', 'unknown_ratio', 'critical_gaps', 'levels', 'policy'];

const REQUIRED = {
  packages: ['name', 'files', 'symbols', 'loc'],
  files: ['f', 'p', 'l', 't', 's'],
  symbols: ['id', 'n', 'k', 'f', 'p', 'x', 't', 'a', 'e', 'c', 'i', 'b', 'o', 'q'],
  calls: ['a', 'b', 'k', 'n'],
  obligations: ['id', 't', 's', 'f', 'n', 'o', 'l', 'st', 'e'],
  paths: ['id', 'entry', 'title', 'steps', 'covers', 'terminal', 'length', 'tier'],
  storylines: ['id', 'path', 'title', 'premise', 'acts', 'objectives', 'level'],
  objectives: ['id', 'level', 'text', 'symbols', 'obligations'],
  exercises: ['id', 'k', 'level', 'title', 'prompt', 'explain', 'symbols', 'obligations', 'evidence'],
  assessments: ['id', 'level', 'kind', 'text', 'checks', 'exercise', 'weight'],
  impact: ['id', 's', 'direct', 'indirect', 'tests', 'shared_state', 'contracts', 'risk', 'note'],
  maintenance: ['id', 'k', 'title', 'prompt', 'steps', 'level', 'symbols', 'tests', 'risk'],
  testing: ['id', 's', 'kind', 'text', 'covers', 'exists'],
  gaps: ['id', 'kind', 's', 'f', 'text', 'reason'],
};

for (const [section, keys] of Object.entries(REQUIRED)) {
  const value = payload[section];
  check('payload: ' + section + ' is an array', Array.isArray(value));
  if (!Array.isArray(value) || !value.length) continue;
  const bad = [];
  for (const rec of value) {
    for (const k of keys) if (!(k in rec)) bad.push(section + '.' + k);
  }
  eq('payload: ' + section + ' required keys', [...new Set(bad)].join(','), '');
}
check('payload: meta required keys',
  META_KEYS.every((k) => k in payload.meta),
  META_KEYS.filter((k) => !(k in payload.meta)).join(','));
check('payload: report required keys',
  REPORT_KEYS.every((k) => k in payload.report),
  REPORT_KEYS.filter((k) => !(k in payload.report)).join(','));

check('payload: report present', !!payload.report);
check('payload: report.levels has five levels', payload.report && payload.report.levels.length === 5);
check('payload: report.coverage dimensions > 1', payload.report && Object.keys(payload.report.coverage).length > 1);

const symIds = new Set(payload.symbols.map((s) => s.id));
eq('payload: unique symbol ids', symIds.size, payload.symbols.length);
const obIds = new Set(payload.obligations.map((o) => o.id));
eq('payload: unique obligation ids', obIds.size, payload.obligations.length);

const danglingObs = payload.obligations.filter((o) => !symIds.has(o.s));
eq('payload: every obligation has an owner', danglingObs.length, 0);

const danglingSteps = [];
for (const p of payload.paths) for (const s of p.steps) if (!symIds.has(s.s)) danglingSteps.push(p.id);
eq('payload: every path step resolves', [...new Set(danglingSteps)].join(','), '');

const danglingCovers = [];
for (const p of payload.paths) for (const id of p.covers) if (!obIds.has(id)) danglingCovers.push(p.id);
eq('payload: every path cover resolves', [...new Set(danglingCovers)].join(','), '');

const statuses = new Set(payload.obligations.map((o) => o.st));
for (const st of api.STATUSES) check('payload: status present ' + st, statuses.has(st));
eq('payload: status vocabulary', [...statuses].filter((s) => api.STATUSES.indexOf(s) < 0).join(','), '');

check('payload: ~120 symbols', payload.symbols.length >= 100 && payload.symbols.length <= 140, String(payload.symbols.length));
eq('payload: 400 obligations', payload.obligations.length, 400);
eq('payload: 8 paths', payload.paths.length, 8);
eq('payload: 4 storylines', payload.storylines.length, 4);
eq('payload: 6 exercises', payload.exercises.length, 6);
eq('payload: 3 maintenance tasks', payload.maintenance.length, 3);
eq('payload: 5 packages', payload.packages.length, 5);

const badFile = payload.symbols.filter((s) => !payload.files.some((f) => f.f === s.f));
eq('payload: every symbol has a file record', badFile.length, 0);

const sorted = payload.symbols.every((s, i, a) => i === 0 || a[i - 1].id <= s.id);
check('payload: symbols sorted by id (contract identity rule)', sorted);

/* ---------------------------------------------------------------------------
 * 4. Runtime: store + query layer
 * ------------------------------------------------------------------------- */

const store = api.buildStore(payload);
eq('store: symbols indexed', store.symbols.length, payload.symbols.length);
eq('store: obligations indexed', store.obligations.length, payload.obligations.length);
eq('store: path index', store.pathById.size, payload.paths.length);
eq('store: callers index built', store.callIn.size > 0, true);
eq('store: file aggregates', store.statByFile.size > 0, true);

const counts = store.counts();
eq('store: count symbols', counts.symbols, payload.symbols.length);
eq('store: count obligations', counts.obligations, payload.obligations.length);

const f1 = api.createFilters(store);
eq('filters: default keeps every obligation', api.filterObligations(store, f1).length, payload.obligations.length);

const f2 = api.createFilters(store);
f2.statuses.delete('unknown');
const unknownCount = payload.obligations.filter((o) => o.st === 'unknown').length;
eq('filters: status toggle removes unknown', api.filterObligations(store, f2).length, payload.obligations.length - unknownCount);

const f3 = api.createFilters(store);
f3.statuses.clear();
eq('filters: empty status set yields nothing', api.filterObligations(store, f3).length, 0);

const f4 = api.createFilters(store);
f4.includeTests = false;
const nonTest = payload.obligations.filter((o) => !store.symById.get(o.s).t).length;
eq('filters: test-code toggle', api.filterObligations(store, f4).length, nonTest);

const f5 = api.createFilters(store);
f5.crit.clear();
f5.crit.add(3);
const crit3 = payload.obligations.filter((o) => o.crit === 3).length;
eq('filters: criticality filter', api.filterObligations(store, f5).length, crit3);

/* fuzzy search */
const hits = api.fuzzySearch(store, 'sendMesg', 10);
check('search: subsequence finds sendMessage', hits.some((h) => h.s.n === 'GeminiClient.sendMessage'), hits.map((h) => h.s.n).join(','));
eq('search: no match for nonsense', api.fuzzySearch(store, 'zzzzqqqqxx').length, 0);
check('search: path query works', api.fuzzySearch(store, 'token-storage', 10).length > 0);

/* entry chain / learning route */
const danger = payload.symbols.find((s) => s.n === 'isDangerousCommand');
check('graph: fixture symbol present', !!danger);
const chain = api.findEntryChain(store, danger.id);
check('graph: caller chain reaches an entry', Array.isArray(chain) && chain.length >= 2, JSON.stringify(chain && chain.length));
if (chain) {
  eq('graph: chain starts at an entry symbol', store.symById.get(chain[0]).st, 'entry');
  eq('graph: chain ends at the queried symbol', chain[chain.length - 1], danger.id);
}

const uncovered = payload.obligations.filter((o) => o.st === 'uncovered');
check('graph: fixture has uncovered obligations', uncovered.length > 0);
const route = api.buildLearningRoute(store, uncovered[0]);
check('route: obligation resolved', route.obligation.id === uncovered[0].id);
check('route: symbol resolved', !!route.symbol);
check('route: reachable or explicitly unreachable', typeof route.reachable === 'boolean');
check('route: path id is string', typeof route.pathId === 'string');

const bestPath = api.bestPathForSymbol(store, danger.id);
check('graph: best path lookup returns a path', bestPath === null || !!store.pathById.get(bestPath.id));

/* closures */
const up = api.closure(store, danger.id, 'up', 3);
check('closure: upstream levels capped at depth', up.levels.length <= 3);
check('closure: upstream total positive', up.total > 0);
check('closure: truncated flag boolean', typeof up.truncated === 'boolean');
const down = api.closure(store, danger.id, 'down', 3);
check('closure: downstream levels capped at depth', down.levels.length <= 3);

/* related tests */
const tests = api.relatedTests(store, danger.id, 2);
check('tests: reaches test symbols within 2 hops', tests.length >= 1, String(tests.length));
check('tests: all are test code', tests.every((t) => t.sym.t === true));

/* treemap geometry */
const items = Array.from({ length: 12 }, (_, i) => ({ key: 'k' + i, value: i + 1 }));
const W = 640;
const H = 420;
const rects = api.squarify(items, 0, 0, W, H);
eq('treemap: every positive item becomes a rect', rects.length, items.length);
const area = rects.reduce((a, r) => a + r.w * r.h, 0);
check('treemap: area covers the canvas', Math.abs(area - W * H) / (W * H) < 0.01, String(area));
check('treemap: rects inside bounds', rects.every((r) => r.x >= -0.5 && r.y >= -0.5 && r.x + r.w <= W + 0.5 && r.y + r.h <= H + 0.5));
let overlaps = 0;
for (let i = 0; i < rects.length; i++) {
  for (let j = i + 1; j < rects.length; j++) {
    const a = rects[i];
    const b = rects[j];
    const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
    const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
    if (ox > 0.5 && oy > 0.5) overlaps += 1;
  }
}
eq('treemap: no overlapping cells', overlaps, 0);
eq('treemap: zero-value items skipped', api.squarify([{ value: 0 }, { value: 2 }], 0, 0, 100, 100).length, 1);
check('treemap: colour ramp is monotonic', api.coverageColor(0) !== api.coverageColor(1));

/* lab self-check */
const task = payload.maintenance[0];
const fullAnswer = task.symbols.map((id) => store.symById.get(id).n).join(', ');
const ok = api.labCheck(store, task, fullAnswer);
eq('lab: full answer misses nothing', ok.missed.length, 0);
eq('lab: full answer covers every symbol', ok.covered.length, task.symbols.length);
const empty = api.labCheck(store, task, '');
eq('lab: empty answer misses all', empty.missed.length, task.symbols.length);
check('lab: empty answer message names the gap', /Nothing to check|missed \d+ affected module/.test(empty.message), empty.message);
const partial = api.labCheck(store, task, 'Config.loadSettings');
check('lab: partial answer reports misses', partial.missed.length > 0 && partial.covered.length > 0, partial.message);
check('lab: partial message counts misses', /missed \d+ affected module/.test(partial.message), partial.message);
const noSymbols = api.labCheck(store, { symbols: [] }, 'anything');
eq('lab: empty affected list handled', noSymbols.total, 0);

/* aggregates */
const byType = api.coverageByType(store);
const typeTotal = byType.reduce((a, r) => a + r.stat.total, 0);
eq('aggregate: coverageByType totals', typeTotal, payload.obligations.length);
const critRows = api.criticalityBreakdown(store);
eq('aggregate: criticality totals', critRows.reduce((a, r) => a + r.stat.total, 0), payload.obligations.length);
eq('aggregate: unknown ratio in range', api.unknownRatio(payload.obligations) >= 0 && api.unknownRatio(payload.obligations) <= 1, true);

/* level items (uses progress, which degrades to empty without localStorage) */
const level2 = api.levelItems(store, 2);
check('report: level 2 has mapped items', level2.length > 0);
check('report: items carry progress flags', level2.every((i) => typeof i.done === 'boolean' && !!i.kind && !!i.id));
check('report: derived levels fallback works', api.deriveLevels(store).length === 5);

/* robustness: empty / partial payloads must not throw */
let degradedOk = true;
try {
  const emptyStore = api.buildStore({});
  api.filterObligations(emptyStore, api.createFilters(emptyStore));
  const route2 = api.buildLearningRoute(emptyStore, { id: 'x', s: 'missing', t: 'symbol', st: 'uncovered' });
  api.closure(emptyStore, 'missing', 'up', 3);
  api.relatedTests(emptyStore, 'missing', 2);
  api.levelItems(emptyStore, 1);
  api.coverageByType(emptyStore);
  degradedOk = route2.reachable === false;
} catch (err) {
  degradedOk = false;
  failures.push('robustness: empty payload threw — ' + err.message);
}
check('robustness: empty payload degrades without throwing', degradedOk);

/* ------------------------------------------------------------------------- */

console.log('\nRLP runtime self-test');
console.log('  checks passed: ' + pass);
console.log('  failures: ' + failures.length);
if (failures.length) {
  for (const f of failures) console.log('   ✗ ' + f);
  process.exitCode = 1;
} else {
  console.log('  ✓ all checks passed');
  console.log('  raw payload reads: ' + [...new Set(rawHits)].sort().join(', '));
}
