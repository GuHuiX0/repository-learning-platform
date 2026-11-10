/**
 * Package emitter — writes the Repository Learning Package and the runtime
 * payload.
 *
 * Large assets use a compact, documented encoding (tuple rows + a schema key in
 * the manifest) so that a 200k-obligation graph stays a few MB on disk instead
 * of 70. The app payload carries a prioritised slice plus exact per-file
 * aggregates, so the dashboard can report true denominators.
 */
import fs from 'node:fs';
import path from 'node:path';
import { sortBy, pct } from './util.mjs';

const ANALYSIS_VERSION = 'rlp-0.1.0';

export function emitPackage({ outDir, model, obSet, plan, learning, maintenance, report, ownership, appDir }) {
  const dir = outDir;
  fs.mkdirSync(dir, { recursive: true });
  const artifacts = [];
  const stageMs = {};

  const write = (rel, obj, pretty = false) => {
    const t0 = Date.now();
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    const text = pretty ? JSON.stringify(obj, null, 2) : JSON.stringify(obj);
    fs.writeFileSync(abs, text);
    stageMs[rel] = Date.now() - t0;
    artifacts.push({ path: rel, bytes: Buffer.byteLength(text), rows: rowCount(obj) });
  };

  const meta = {
    repository: model.meta.repository,
    commit: model.meta.commit,
    branch: model.meta.branch,
    snapshot_hash: model.meta.snapshot_hash,
    analysis_version: ANALYSIS_VERSION,
    generated_at: new Date().toISOString(),
    language: 'typescript',
    analysis_ms: model.meta.analysis_ms,
  };

  /* ---------------- analysis ---------------- */
  const pkgAgg = new Map();
  for (const f of model.files) {
    if (!pkgAgg.has(f.pkg)) pkgAgg.set(f.pkg, { name: f.pkg, files: 0, symbols: 0, loc: 0 });
    const a = pkgAgg.get(f.pkg);
    a.files++;
    a.symbols += f.symbolCount;
    a.loc += f.lines;
  }

  write('analysis/repository-index.json', {
    meta,
    packages: [...pkgAgg.values()].sort((a, b) => (a.name < b.name ? -1 : 1)),
    files: model.files.map((f) => ({ path: f.rel, package: f.pkg, lines: f.lines, bytes: f.bytes, isTest: f.isTest, symbols: f.symbolCount })),
  });

  // symbol rows: [id, qualified, kind, file, package, exported, isTest, reach, fanIn, fanOut, anchor, evidence]
  write('analysis/symbol-index.json', {
    schema: ['id', 'qualified', 'kind', 'file', 'package', 'exported', 'is_test', 'reach', 'fan_in', 'fan_out', 'anchor', 'evidence'],
    rows: model.symbols.map((s) => [
      s.id, s.qualified, s.kind, s.rel, s.pkg, s.exported ? 1 : 0, s.isTest ? 1 : 0, s.reach, s.fanIn, s.fanOut, s.anchor, s.evidence,
    ]),
  });

  write('analysis/call-graph.json', {
    schema: ['from', 'to', 'kind', 'weight'],
    rows: model.edges.map((e) => [e.a, e.b, e.k, e.n]),
  });

  // CFG rows keyed by symbol id: {n: [nodeId, kind, label], e: [from, to, kind]}
  const cfgOut = {};
  for (const s of model.symbols) {
    if (!s.cfg || s.isTest) continue;
    cfgOut[s.id] = {
      n: s.cfg.nodes.map((n) => (n.a ? [n.id, n.k, n.l, n.a] : [n.id, n.k, n.l])),
      e: s.cfg.edges.map((e) => [e.f, e.t, e.k]),
    };
  }
  write('analysis/control-flow-graph.json', { symbols: Object.keys(cfgOut).length, cfg: cfgOut });

  write('analysis/data-flow-graph.json', {
    state_channels: model.stateChannels.map((c) => [c.a, c.b, c.field, c.k]),
    env_channels: model.envChannels.map((c) => [c.s, c.key, c.k]),
  });

  write('analysis/dependency-graph.json', {
    file_edges: model.importEdges.map((e) => [e.a, e.b, e.k, e.w]),
    externals: sortBy(model.externals.slice(), (x) => x.id).map((e) => [e.id, e.cat, e.c]),
  });

  write('analysis/source-evidence.json', {
    schema: ['evidence_id', 'file', 'symbol', 'kind', 'anchor'],
    rows: model.symbols.filter((s) => !s.isTest).map((s) => [s.evidence, s.rel, s.qualified, s.kind, s.anchor]),
  });

  /* ---------------- coverage ---------------- */
  const reasonTable = [];
  const reasonIdx = new Map();
  const intern = (r) => {
    if (!r) return -1;
    if (!reasonIdx.has(r)) { reasonIdx.set(r, reasonTable.length); reasonTable.push(r); }
    return reasonIdx.get(r);
  };
  // obligation rows: [id, type, symbol, node, outcome, status, witness, crit, cat, label, reason]
  write('coverage/coverage-obligations.json', {
    schema: ['id', 'type', 'symbol', 'node', 'outcome', 'status', 'witness', 'criticality', 'category', 'label', 'reason_index'],
    note: 'evidence for a row = evidence_id of the owning symbol (analysis/source-evidence.json) plus the CFG node id',
    rows: obSet.obligations.map((o) => [
      o.id, o.t, o.s, o.n || '', o.o, o.st, o.w || '', o.crit || 1, o.cat || 'none',
      ['return', 'symbol', 'e2e-path'].includes(o.t) ? '' : (o.l || '').slice(0, 140),
      intern(o.r),
    ]),
    reason_table: reasonTable,
  });

  const perSymbol = new Map();
  for (const ob of obSet.obligations) {
    if (!perSymbol.has(ob.s)) perSymbol.set(ob.s, { s: ob.s, f: ob.f, total: 0, covered: 0, uncovered: 0, unknown: 0, excluded: 0, branches: 0, branchCovered: 0 });
    const d = perSymbol.get(ob.s);
    d.total++;
    if (ob.st === 'covered') d.covered++;
    else if (ob.st === 'uncovered') d.uncovered++;
    else if (ob.st === 'unknown') d.unknown++;
    else if (ob.st === 'excluded') d.excluded++;
    if (ob.t === 'branch') {
      d.branches++;
      if (ob.st === 'covered') d.branchCovered++;
    }
  }
  write('coverage/branch-coverage.json', {
    schema: ['symbol', 'file', 'total', 'covered', 'uncovered', 'unknown', 'excluded', 'branches', 'branch_covered', 'branch_pct'],
    rows: [...perSymbol.values()]
      .filter((d) => d.branches > 0)
      .sort((a, b) => b.branches - a.branches || (a.s < b.s ? -1 : 1))
      .map((d) => [d.s, d.f, d.total, d.covered, d.uncovered, d.unknown, d.excluded, d.branches, d.branchCovered, pct(d.branchCovered, d.branches)]),
  });

  // Scenario matrix — indexed once, never quadratic.
  const scenBySymbolNode = new Map();
  for (const ob of obSet.obligations) {
    if (ob.t !== 'scenario') continue;
    const key = ob.s + '|' + ob.n;
    if (!scenBySymbolNode.has(key)) scenBySymbolNode.set(key, []);
    scenBySymbolNode.get(key).push(ob);
  }
  const scenRows = [];
  for (const sc of model.scenarios) {
    if (model.byId.get(sc.s)?.isTest) continue;
    const group = scenBySymbolNode.get(sc.s + '|' + sc.n) || [];
    scenRows.push([
      sc.s,
      sc.callee,
      sc.cat,
      sc.label,
      sc.outcomes.map((o) => {
        const hit = group.find((x) => x.o === o);
        return [o, hit ? hit.st : 'missing', hit ? hit.w || '' : ''];
      }),
    ]);
  }
  write('coverage/scenario-matrix.json', {
    schema: ['symbol', 'callee', 'category', 'call_site', 'outcomes'],
    rows: scenRows,
  });

  const coveredByPath = new Set();
  for (const p of plan.paths) for (const id of p.covers) coveredByPath.add(id);
  write('coverage/path-coverage.json', {
    paths: plan.paths.length,
    obligations_with_path: coveredByPath.size,
    per_path: plan.paths.map((p) => [p.id, p.entry, p.terminal, p.witness, p.tier, p.length, p.covers.length]),
  });

  write('coverage/coverage-gaps.json', {
    summary: {
      uncovered: obSet.obligations.filter((o) => o.st === 'uncovered').length,
      unknown: obSet.obligations.filter((o) => o.st === 'unknown').length,
      excluded: obSet.obligations.filter((o) => o.st === 'excluded').length,
      infeasible: obSet.obligations.filter((o) => o.st === 'infeasible').length,
      critical: report.critical_gaps,
    },
    gaps: maintenance.gaps.map((g) => [g.id, g.kind, g.s, g.f, g.t, g.crit, g.text, intern(g.reason)]),
    gap_schema: ['id', 'status', 'symbol', 'file', 'type', 'criticality', 'text', 'reason_index'],
    reason_table: reasonTable,
  });

  /* ---------------- learning ---------------- */
  write('learning/path-suite.json', plan.paths.map((p) => ({
    id: p.id, entry: p.entry, terminal: p.terminal, title: p.title, witness: p.witness, tier: p.tier,
    length: p.length, steps: p.steps, covers: p.covers, symbols: p.symbols, pivot: p.pivot,
  })));
  write('learning/storylines.json', learning.storylines);
  write('learning/learning-objectives.json', learning.objectives);
  write('learning/exercises.json', learning.exercises);
  write('learning/assessments.json', learning.assessments);

  /* ---------------- maintenance ---------------- */
  write('maintenance/impact-map.json', maintenance.impact);
  write('maintenance/maintenance-tasks.json', maintenance.tasks);
  write('maintenance/testing-recommendations.json', maintenance.testing);
  write('maintenance/ownership-report.json', ownership, true);
  const md = renderOwnershipMd(ownership, report);
  fs.writeFileSync(path.join(dir, 'maintenance/OWNERSHIP_REPORT.md'), md);
  artifacts.push({ path: 'maintenance/OWNERSHIP_REPORT.md', bytes: Buffer.byteLength(md), rows: ownership.modules.length });

  /* ---------------- runtime payload ---------------- */
  const tPay = Date.now();
  const payload = buildPayload(model, obSet, plan, learning, maintenance, report, meta);
  const sizeOf = {};
  for (const k of Object.keys(payload)) sizeOf[k] = (JSON.stringify(payload[k]) || '').length;
  const dataJs = 'window.RLP_DATA = ' + JSON.stringify(payload) + ';';
  fs.mkdirSync(path.join(dir, 'app'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'app', 'data.js'), dataJs);
  artifacts.push({ path: 'app/data.js', bytes: Buffer.byteLength(dataJs), rows: payload.symbols.length });
  stageMs['app/data.js'] = Date.now() - tPay;

  for (const f of ['index.html', 'app.js', 'app.css']) {
    const src = path.join(appDir, f);
    if (!fs.existsSync(src)) { artifacts.push({ path: 'app/' + f, bytes: 0, rows: 0, missing: true }); continue; }
    const dst = path.join(dir, 'app', f);
    fs.copyFileSync(src, dst);
    artifacts.push({ path: 'app/' + f, bytes: fs.statSync(dst).size, rows: 0 });
  }

  /* ---------------- manifest ---------------- */
  const manifest = {
    schema: 'repository-learning-package/v0.1',
    repository: model.meta.repository,
    commit: model.meta.commit,
    branch: model.meta.branch,
    snapshot_hash: model.meta.snapshot_hash,
    analysis_version: ANALYSIS_VERSION,
    generated_at: meta.generated_at,
    input: { type: 'git-snapshot', commit: model.meta.commit, files: model.meta.file_count, language: 'typescript' },
    counts: {
      packages: pkgAgg.size,
      files: model.files.length,
      test_files: model.files.filter((f) => f.isTest).length,
      symbols: model.symbols.length,
      symbols_non_test: model.symbols.filter((s) => !s.isTest).length,
      call_edges: model.edges.length,
      may_reach_edges: model.stats.mayReachEdges || 0,
      obligations: obSet.total,
      obligations_covered: obSet.obligations.filter((o) => o.st === 'covered').length,
      obligations_uncovered: obSet.obligations.filter((o) => o.st === 'uncovered').length,
      obligations_unknown: obSet.obligations.filter((o) => o.st === 'unknown').length,
      obligations_excluded: obSet.obligations.filter((o) => o.st === 'excluded').length,
      paths: plan.paths.length,
      storylines: learning.storylines.length,
      exercises: learning.exercises.length,
      maintenance_tasks: maintenance.tasks.length,
    },
    coverage: report.coverage,
    layers: report.layers,
    unknown_ratio: report.unknown_ratio,
    critical_gaps: report.critical_gaps,
    encoding: {
      'analysis/symbol-index.json': 'rows follow schema[]',
      'analysis/call-graph.json': 'rows = [from, to, kind, weight]',
      'analysis/control-flow-graph.json': 'cfg[symbolId] = {n: [nodeId, kind, label, anchor?], e: [from, to, kind]}',
      'analysis/source-evidence.json': 'rows follow schema[]',
      'coverage/coverage-obligations.json': 'rows follow schema[]; evidence = symbol evidence id + node id',
      'coverage/branch-coverage.json': 'rows follow schema[]',
      'coverage/scenario-matrix.json': 'rows = [symbol, callee, category, call_site, [[outcome, status, witness]]]',
      'coverage/coverage-gaps.json': 'gaps = [id, kind, symbol, file, type, criticality, text, reason]',
    },
    artifacts,
    status: Object.fromEntries(artifacts.map((f) => [f.path, f.missing ? 'missing' : 'ok'])),
    write_ms: stageMs,
    limits: [
      'Static analysis only: the analysed repository is never executed.',
      'Dynamic dispatch, reflection, runtime registration and string-keyed lookups remain Unknown with reasons.',
      'Loop/recursion coverage is abstracted (zero-iteration / iterate); unbounded path coverage is not claimed.',
      'May-reach edges come from Rapid Type Analysis; paths depending on them are labelled may-reach.',
      'app/data.js carries a prioritised slice of obligations plus exact per-file aggregates; the complete set is coverage/coverage-obligations.json.',
    ],
  };
  write('manifest.json', manifest, true);

  return { dir, artifacts, payloadBytes: Buffer.byteLength(dataJs), payloadSizes: sizeOf, manifest, stageMs };
}

/* ------------------------------------------------------------------ */
/* runtime payload                                                    */
/* ------------------------------------------------------------------ */

function buildPayload(model, obSet, plan, learning, maintenance, report, meta) {
  const symbols = [];
  const id2idx = new Map();
  for (const s of model.symbols) {
    if (s.isTest) continue;
    const ob = obSet.bySymbol.get(s.id) || [];
    id2idx.set(s.id, symbols.length);
    symbols.push({
      id: s.id,
      n: s.qualified,
      k: s.kind,
      f: s.rel,
      p: s.pkg,
      x: !!s.exported,
      a: s.anchor,
      e: s.evidence,
      c: s.fanOut,
      i: s.fanIn,
      b: ob.filter((o) => o.t === 'branch').length,
      o: ob.filter((x) => x.st !== 'excluded').length,
      q: s.cfg ? s.cfg.nodes.filter((n) => n.k === 'branch' || n.k === 'loop').length + 1 : 1,
      st: s.st,
      ...(s.doc ? { doc: s.doc.slice(0, 180) } : {}),
    });
  }

  const calls = [];
  for (const e of model.edges) {
    if (!id2idx.has(e.a) || !id2idx.has(e.b)) continue;
    calls.push({ a: e.a, b: e.b, k: e.k, n: e.n });
  }

  // Obligation slice: a *representative* mix. Covered rows first (so the atlas
  // can show what a witness looks like), then every critical open obligation,
  // then a sample of the remaining open ones. Exact totals live in report.totals.
  const coveredObs = [];
  const openCrit = [];
  const openRest = [];
  for (const ob of obSet.obligations) {
    if (ob.st === 'excluded') continue;
    const sym = model.byId.get(ob.s);
    if (!sym || sym.isTest) continue;
    if (ob.st === 'covered') coveredObs.push(ob);
    else if ((ob.crit || 1) >= 2) openCrit.push(ob);
    else openRest.push(ob);
  }
  const obById = new Map(obSet.obligations.map((o) => [o.id, o]));
  const pathCovers = new Set();
  for (const p of plan.paths) for (const id of p.covers) pathCovers.add(id);
  const mustHave = [];
  for (const id of pathCovers) {
    const ob = obById.get(id);
    if (!ob || ob.st === 'excluded') continue;
    if (model.byId.get(ob.s)?.isTest) continue;
    mustHave.push(ob);
  }
  const seenId = new Set();
  const slice = [];
  for (const ob of [...mustHave, ...coveredObs.slice(0, 3000), ...openCrit.slice(0, 5000), ...openRest.slice(0, 2000)]) {
    if (seenId.has(ob.id)) continue;
    seenId.add(ob.id);
    slice.push(ob);
  }

  const obligations = slice.map((o) => ({
    id: o.id, t: o.t, s: o.s, f: o.f, n: o.n || '', o: o.o,
    l: (o.l || '').slice(0, 140), st: o.st,
    ...(o.r ? { r: o.r.slice(0, 180) } : {}),
    e: o.e, cat: o.cat || 'none', crit: o.crit || 1,
    ...(o.w ? { w: o.w } : {}),
  }));

  // Per-file aggregates: full denominators, not the slice.
  const fileAgg = new Map();
  for (const ob of obSet.obligations) {
    const sym = model.byId.get(ob.s);
    if (!sym) continue;
    if (!fileAgg.has(sym.rel)) fileAgg.set(sym.rel, { ob: 0, cov: 0, unc: 0, unk: 0, exc: 0, crit: 0, crit_open: 0 });
    const d = fileAgg.get(sym.rel);
    d.ob++;
    if (ob.st === 'covered') d.cov++;
    else if (ob.st === 'uncovered') d.unc++;
    else if (ob.st === 'unknown') d.unk++;
    else d.exc++;
    if ((ob.crit || 1) >= 2) { d.crit++; if (ob.st !== 'covered') d.crit_open++; }
  }
  const filesPayload = model.files.map((f) => {
    const d = fileAgg.get(f.rel) || { ob: 0, cov: 0, unc: 0, unk: 0, exc: 0, crit: 0, crit_open: 0 };
    return { f: f.rel, p: f.pkg, l: f.lines, t: f.isTest, s: f.symbolCount, ...d };
  });

  // CFG detail only where the learner actually walks.
  const learningSymbols = new Set();
  for (const p of plan.paths) for (const s of p.symbols) learningSymbols.add(s);
  const cfgs = {};
  for (const s of model.symbols) {
    if (!learningSymbols.has(s.id) || !s.cfg || s.isTest) continue;
    const nodeSlice = s.cfg.nodes.slice(0, 70);
    const kept = new Set(nodeSlice.map((n) => n.id));
    cfgs[s.id] = {
      nodes: nodeSlice.map((n) => ({ id: n.id, k: n.k, l: (n.l || '').slice(0, 110) })),
      edges: s.cfg.edges.filter((e2) => kept.has(e2.f) && kept.has(e2.t)).map((e2) => ({ f: e2.f, t: e2.t, k: e2.k })),
    };
  }

  const packages = [];
  const pkgMap = new Map();
  for (const f of model.files) {
    if (!pkgMap.has(f.pkg)) pkgMap.set(f.pkg, { name: f.pkg, files: 0, symbols: 0, loc: 0 });
    const p = pkgMap.get(f.pkg);
    p.files++;
    p.symbols += f.symbolCount;
    p.loc += f.lines;
  }
  for (const p of pkgMap.values()) packages.push(p);
  packages.sort((a, b) => (a.name < b.name ? -1 : 1));

  return {
    meta: {
      repository: meta.repository,
      commit: meta.commit,
      branch: meta.branch,
      generated_at: meta.generated_at,
      analysis_version: meta.analysis_version,
      languages: ['typescript'],
      package_names: packages.map((p) => p.name),
      counts: {
        files: model.files.length,
        symbols: symbols.length,
        edges: calls.length,
        obligations: obSet.total,
        obligations_in_payload: obligations.length,
        paths: plan.paths.length,
        storylines: learning.storylines.length,
        exercises: learning.exercises.length,
        tasks: maintenance.tasks.length,
      },
      truncated: obligations.length < obSet.total,
    },
    packages,
    files: filesPayload,
    symbols,
    modules: [],
    calls,
    imports: [],
    externals: sortBy(model.externals.slice(), (x) => -x.c).slice(0, 200).map((e) => ({ id: e.id, n: e.id, cat: e.cat, c: e.c })),
    obligations,
    cfgs,
    paths: plan.paths.map((p) => ({
      id: p.id, entry: p.entry, title: p.title, origin: p.origin, steps: p.steps.slice(0, 18), covers: p.covers.slice(0, 140),
      terminal: p.terminal, length: p.length, tier: p.tier, witness: p.witness,
    })),
    storylines: learning.storylines,
    objectives: learning.objectives,
    exercises: learning.exercises,
    assessments: learning.assessments,
    impact: maintenance.impact.map((im) => ({
      id: im.id, s: im.s, direct: im.direct, indirect: im.indirect, tests: im.tests,
      shared_state: im.shared_state, contracts: im.contracts,
      risk: Math.round((im.risk / 10) * 100) / 100,
      note: im.note,
    })),
    maintenance: maintenance.tasks,
    testing: maintenance.testing,
    gaps: maintenance.gaps.slice(0, 4000),
    report: normalizeReport(report, obSet),
  };
}

/* ------------------------------------------------------------------ */
/* ownership markdown                                                 */
/* ------------------------------------------------------------------ */

function renderOwnershipMd(o, report) {
  const lines = [];
  lines.push(`# Repository Ownership Report`);
  lines.push('');
  lines.push(`- repository: \`${o.repository}\``);
  lines.push(`- commit: \`${o.commit}\``);
  lines.push(`- generated: ${o.generated_at}`);
  lines.push('');
  lines.push(`> ${o.statement}`);
  lines.push('');
  lines.push('## Totals');
  lines.push('');
  lines.push('| metric | value |');
  lines.push('| --- | --- |');
  for (const [k, v] of Object.entries(o.totals)) lines.push(`| ${k} | ${v} |`);
  lines.push('');
  lines.push('## Layers');
  lines.push('');
  lines.push('| layer | covered | denominator | pct |');
  lines.push('| --- | --- | --- | --- |');
  for (const k of ['structural', 'directional']) {
    const l = report.layers[k];
    lines.push(`| ${k} | ${l.covered} | ${l.denominator} | ${l.pct}% |`);
  }
  lines.push('');
  lines.push('## Modules');
  lines.push('');
  lines.push('| package | obligations | covered | critical open | coverage | tasks | verdict |');
  lines.push('| --- | --- | --- | --- | --- | --- | --- |');
  for (const m of o.modules) {
    lines.push(`| ${m.pkg} | ${m.total} | ${m.covered} | ${m.critical_open} | ${m.coverage_pct}% | ${m.tasks} | ${m.verdict} |`);
  }
  lines.push('');
  lines.push('## Critical open gaps (sample)');
  lines.push('');
  for (const g of report.critical_gap_sample.slice(0, 20)) {
    lines.push(`- \`${g.id}\` ${g.cat} \u2014 ${String(g.l).slice(0, 110)} (${g.f}) \u2014 ${g.r || 'no witness'}`);
  }
  lines.push('');
  lines.push('## Policy');
  lines.push('');
  for (const p of report.policy) lines.push(`- ${p}`);
  lines.push('');
  return lines.join('\n');
}

function rowCount(obj) {
  if (Array.isArray(obj)) return obj.length;
  if (obj && typeof obj === 'object') {
    if (Array.isArray(obj.rows)) return obj.rows.length;
    if (Array.isArray(obj.files)) return obj.files.length;
    return Object.keys(obj).length;
  }
  return 1;
}

/** Payload percentages are 0..1 (app contract); human markdown keeps 0..100. */
function normalizeReport(report, obSet) {
  const div = (v) => Math.round((v / 100) * 10000) / 10000;
  const coverage = {};
  for (const [k, v] of Object.entries(report.coverage)) coverage[k] = { ...v, pct: div(v.pct) };
  const layers = {};
  for (const [k, v] of Object.entries(report.layers)) layers[k] = { ...v, pct: div(v.pct) };
  const levels = report.levels.map((l) => ({ ...l, pct: div(l.pct) }));
  const all = obSet.obligations;
  const totals = {
    obligations: all.length,
    covered: all.filter((o) => o.st === 'covered').length,
    uncovered: all.filter((o) => o.st === 'uncovered').length,
    unknown: all.filter((o) => o.st === 'unknown').length,
    excluded: all.filter((o) => o.st === 'excluded').length,
    infeasible: all.filter((o) => o.st === 'infeasible').length,
    denominator: all.filter((o) => o.st !== 'excluded' && o.st !== 'infeasible').length,
    critical_open: all.filter((o) => o.st === 'uncovered' && (o.crit || 1) >= 2).length,
  };
  totals.pct = totals.denominator ? Math.round((totals.covered / totals.denominator) * 10000) / 10000 : 0;
  return {
    totals,
    reachability: report.reachability,
    coverage,
    layers,
    unknown_ratio: div(report.unknown_ratio),
    critical_gaps: report.critical_gaps,
    critical_gap_sample: report.critical_gap_sample,
    levels,
    policy: report.policy,
    resolution: report.resolution,
    evidence_kinds: report.evidence_kinds,
  };
}
