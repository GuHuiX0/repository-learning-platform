/* =============================================================================
 * RLP runtime — app.js
 * Coverage-Driven Repository Learning Platform. Vanilla ES2020, no deps.
 *
 * This file is a pure READ-ONLY consumer of window.RLP_DATA (CONTRACT.md v0.1).
 * Every raw payload field is touched inside buildStore() only — the block marked
 * "RAW PAYLOAD (contract boundary)". Everything downstream consumes the
 * normalised store, so a missing section degrades instead of crashing.
 *
 * Sections
 *   0. utilities / html templating
 *   1. constants (status semantics, routes)
 *   2. payload -> store (indexes + aggregates)
 *   3. query layer (filters, search, closures, learning route, treemap, lab check)
 *   4. UI primitives (virtual list, chips, bars, combobox, toast)
 *   5. shell (top bar, nav, global search)
 *   6. views: map, atlas, debugger, deps, lab, dashboard, report
 *   7. router, boot, Node test surface
 * ========================================================================== */

(function () {
  'use strict';

  /* ==========================================================================
   * 0. Utilities
   * ======================================================================== */

  const ESC_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ESC_MAP[c]);
  }

  const RAW = Symbol('rlp-raw');

  function rawHTML(s) {
    return { [RAW]: String(s == null ? '' : s) };
  }

  /** Convert any interpolation to HTML: raw objects pass through, everything else escapes. */
  function toHTML(v) {
    if (v == null || v === false) return '';
    if (Array.isArray(v)) {
      let out = '';
      for (const item of v) out += toHTML(item);
      return out;
    }
    if (typeof v === 'object' && v[RAW] != null) return v[RAW];
    return esc(v);
  }

  /** Tagged template: every ${} is escaped unless it is itself an html`` result. */
  function html(strings, ...vals) {
    let out = strings[0];
    for (let i = 0; i < vals.length; i++) out += toHTML(vals[i]) + strings[i + 1];
    return rawHTML(out);
  }

  function str(v) {
    return v && v[RAW] != null ? v[RAW] : String(v == null ? '' : v);
  }

  function cat(parts) {
    let out = '';
    for (const p of parts) out += str(p);
    return rawHTML(out);
  }

  function setHTML(node, value) {
    if (!node) return;
    node.innerHTML = value && value[RAW] != null ? value[RAW] : String(value == null ? '' : value);
  }

  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  function el(tag, cls, text) {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text != null) node.textContent = String(text);
    return node;
  }

  /** addEventListener that also registers teardown for the current view. */
  const cleanups = [];
  function on(node, type, handler, opts) {
    if (!node) return () => {};
    node.addEventListener(type, handler, opts);
    const off = () => node.removeEventListener(type, handler, opts);
    cleanups.push(off);
    return off;
  }

  function flushCleanups() {
    while (cleanups.length) {
      const fn = cleanups.pop();
      try { fn(); } catch (e) { /* teardown must never break routing */ }
    }
  }

  /** Listener that survives view changes (shell chrome: search box). */
  function onPersist(node, type, handler, opts) {
    if (!node) return () => {};
    node.addEventListener(type, handler, opts);
    return () => node.removeEventListener(type, handler, opts);
  }

  /** Register an arbitrary teardown (observers, timers) for the current view. */
  function reg(fn) {
    if (typeof fn === 'function') cleanups.push(fn);
  }

  function nfmt(n) {
    const v = Number(n);
    if (!Number.isFinite(v)) return '—';
    if (Math.abs(v) >= 1e6) return (v / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
    if (Math.abs(v) >= 1e4) return (v / 1e3).toFixed(1).replace(/\.0$/, '') + 'k';
    return String(Math.round(v)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  function pct(x, digits) {
    const v = Number(x);
    if (!Number.isFinite(v)) return '—';
    return (v * 100).toFixed(digits == null ? 1 : digits) + '%';
  }

  function clamp(v, lo, hi) {
    return v < lo ? lo : v > hi ? hi : v;
  }

  function debounce(fn, ms) {
    let t = 0;
    return function debounced(...args) {
      clearTimeout(t);
      t = setTimeout(() => fn.apply(this, args), ms);
    };
  }

  function fnv1a(text) {
    let h = 0x811c9dc5;
    const s = String(text);
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return h >>> 0;
  }

  /** Deterministic pseudo-position in [0,1)² from an id — no randomness at render time. */
  function hashPos(id) {
    const a = fnv1a(id);
    const b = fnv1a(id + '\u0000rlp-salt');
    return [(a % 1024) / 1024, (b % 1024) / 1024];
  }

  const LS = {
    get(key, fallback) {
      try {
        const text = window.localStorage.getItem(key);
        return text == null ? fallback : JSON.parse(text);
      } catch (e) { return fallback; }
    },
    set(key, value) {
      try { window.localStorage.setItem(key, JSON.stringify(value)); return true; }
      catch (e) { return false; }
    },
  };

  function shortPath(p, keep) {
    const parts = String(p || '').split('/');
    const n = keep == null ? 3 : keep;
    return parts.length <= n ? String(p || '') : '…/' + parts.slice(-n).join('/');
  }

  function baseName(p) {
    const s = String(p || '');
    const i = s.lastIndexOf('/');
    return i < 0 ? s : s.slice(i + 1);
  }

  function dirName(p) {
    const s = String(p || '');
    const i = s.lastIndexOf('/');
    return i < 0 ? '' : s.slice(0, i);
  }

  function plural(n, word, suffix) {
    return n + ' ' + word + (n === 1 ? '' : (suffix || 's'));
  }

  /* ==========================================================================
   * 1. Constants
   * ======================================================================== */

  const STATUSES = ['covered', 'uncovered', 'unknown', 'infeasible', 'excluded'];

  const STATUS_HINT = {
    covered: 'an analysable obligation with a static path witness (chain from an entry point)',
    uncovered: 'reachable obligation without a witness yet (path planner gap)',
    unknown: 'static analysis cannot decide (dynamic dispatch, runtime registration, budget cap)',
    infeasible: 'proven unreachable under the current model',
    excluded: 'deliberately out of target scope; reason recorded',
  };

  const TYPES = ['symbol', 'call-edge', 'branch', 'exception', 'loop', 'return', 'throw', 'scenario', 'e2e-path', 'maintenance'];

  const RISK_CATS = ['security', 'persistence', 'network', 'state', 'error-handling', 'null-safety', 'config', 'ui', 'none'];

  const ROUTES = [
    { id: 'map', label: 'Map', hash: '#/map', hint: 'repository map' },
    { id: 'atlas', label: 'Atlas', hash: '#/atlas', hint: 'coverage atlas' },
    { id: 'debugger', label: 'Debugger', hash: '#/debugger', hint: 'execution debugger' },
    { id: 'deps', label: 'Deps', hash: '#/deps', hint: 'dependency & impact' },
    { id: 'lab', label: 'Lab', hash: '#/lab', hint: 'maintenance lab' },
    { id: 'dashboard', label: 'Dashboard', hash: '#/dashboard', hint: 'coverage dashboard' },
    { id: 'report', label: 'Report', hash: '#/report', hint: 'ownership report' },
  ];

  const DEP_DEPTH = 3;        // transitive closure depth shown to the learner
  const TEST_HOPS = 2;        // "related tests" reachability
  const MAX_ROWS = 200;       // hard ceiling on simultaneously rendered rows
  const CONTINUE_MS = 600;

  const PROGRESS_KEY = 'rlp:progress';

  /* ==========================================================================
   * 2. Payload -> store
   * ======================================================================== */

  const asArray = (x) => (Array.isArray(x) ? x : []);
  const num = (x) => {
    const n = Number(x);
    return Number.isFinite(n) ? n : 0;
  };
  const text = (x) => (x == null ? '' : String(x));
  const bool = (x) => x === true;

  function pushTo(map, key, value) {
    const arr = map.get(key);
    if (arr) arr.push(value);
    else map.set(key, [value]);
  }

  function emptyStat() {
    return { total: 0, covered: 0, uncovered: 0, unknown: 0, infeasible: 0, excluded: 0 };
  }

  function addStat(target, source) {
    target.total += source.total || 0;
    for (const st of STATUSES) target[st] += source[st] || 0;
    return target;
  }

  function normalizeMeta(m) {
    const src = m && typeof m === 'object' ? m : {};
    return {
      repository: text(src.repository) || 'unknown repository',
      commit: text(src.commit),
      branch: text(src.branch),
      generated_at: text(src.generated_at),
      analysis_version: text(src.analysis_version),
      languages: asArray(src.languages).map(text),
      package_names: asArray(src.package_names).map(text),
      counts: src.counts && typeof src.counts === 'object' ? src.counts : {},
      truncated: bool(src.truncated),
    };
  }

  function normalizeSymbol(s) {
    return {
      id: text(s.id),
      n: text(s.n),
      k: text(s.k) || 'symbol',
      f: text(s.f),
      p: text(s.p),
      x: bool(s.x),
      t: bool(s.t),
      a: text(s.a),
      e: text(s.e),
      c: num(s.c),
      i: num(s.i),
      b: num(s.b),
      o: num(s.o),
      q: num(s.q),
      st: text(s.st) || '',
      doc: text(s.doc),
    };
  }

  function normalizeObligation(o) {
    return {
      id: text(o.id),
      t: text(o.t) || 'symbol',
      s: text(o.s),
      f: text(o.f),
      n: text(o.n),
      o: text(o.o),
      l: text(o.l),
      st: STATUSES.indexOf(text(o.st)) >= 0 ? text(o.st) : 'unknown',
      r: text(o.r),
      e: text(o.e),
      cat: text(o.cat) || 'none',
      crit: num(o.crit) || 1,
      p: Number.isFinite(Number(o.p)) ? Number(o.p) : null,
    };
  }

  function normalizeFile(f) {
    return { f: text(f.f), p: text(f.p), l: num(f.l), t: bool(f.t), s: num(f.s) };
  }

  function normalizePath(p) {
    const steps = asArray(p.steps).map((s) => ({
      s: text(s.s),
      f: text(s.f),
      n: text(s.n),
      o: text(s.o),
      l: text(s.l),
      e: text(s.e),
    })).filter((s) => s.s && s.s !== 'undefined');
    return {
      id: text(p.id),
      entry: text(p.entry),
      title: text(p.title) || text(p.id),
      steps,
      covers: asArray(p.covers).map(text).filter(Boolean),
      terminal: text(p.terminal),
      length: num(p.length) || steps.length,
      tier: num(p.tier) || 1,
    };
  }

  function normalizeExercise(x) {
    return {
      id: text(x.id),
      k: text(x.k) || 'comprehension',
      level: num(x.level) || 1,
      title: text(x.title),
      prompt: text(x.prompt),
      choices: asArray(x.choices).map((c) => ({ id: text(c.id), text: text(c.text), correct: bool(c.correct) })),
      answer: text(x.answer),
      explain: text(x.explain),
      symbols: asArray(x.symbols).map(text).filter(Boolean),
      obligations: asArray(x.obligations).map(text).filter(Boolean),
      evidence: asArray(x.evidence).map(text).filter(Boolean),
    };
  }

  /**
   * Build the whole in-memory model once at boot.
   * All object identities are opaque strings; indexes are Maps.
   */
  function buildStore(data) {
    const raw = data && typeof data === 'object' ? data : {};

    /* ------------------------------------------------------------------ *
     * RAW PAYLOAD (contract boundary) — the only raw.* reads in this file.
     * ------------------------------------------------------------------ */
    const meta = normalizeMeta(raw.meta);
    const packagesRaw = asArray(raw.packages);
    const filesRaw = asArray(raw.files);
    const symbolsRaw = asArray(raw.symbols);
    const obligationsRaw = asArray(raw.obligations);
    const callsRaw = asArray(raw.calls);
    const modulesRaw = asArray(raw.modules);
    const importsRaw = asArray(raw.imports);
    const externalsRaw = asArray(raw.externals);
    const pathsRaw = asArray(raw.paths);
    const storylinesRaw = asArray(raw.storylines);
    const objectivesRaw = asArray(raw.objectives);
    const exercisesRaw = asArray(raw.exercises);
    const assessmentsRaw = asArray(raw.assessments);
    const impactRaw = asArray(raw.impact);
    const maintenanceRaw = asArray(raw.maintenance);
    const testingRaw = asArray(raw.testing);
    const gapsRaw = asArray(raw.gaps);
    const reportRaw = raw.report && typeof raw.report === 'object' ? raw.report : null;
    const cfgsRaw = raw.cfgs && typeof raw.cfgs === 'object' ? raw.cfgs : {};
    /* ---------------------------- end contract boundary ------------------ */

    /* --- symbols --- */
    const symbols = symbolsRaw.map(normalizeSymbol).filter((s) => s.id);
    const symById = new Map();
    for (const s of symbols) if (!symById.has(s.id)) symById.set(s.id, s);

    /* --- files (derive from symbols if the analyzer omitted the section) --- */
    let files = filesRaw.map(normalizeFile).filter((f) => f.f);
    if (!files.length && symbols.length) {
      const byFile = new Map();
      for (const s of symbols) {
        const entry = byFile.get(s.f) || { f: s.f, p: s.p, l: 0, t: s.t, s: 0 };
        entry.s += 1;
        entry.t = entry.t && s.t;
        if (!entry.p) entry.p = s.p;
        byFile.set(s.f, entry);
      }
      files = Array.from(byFile.values());
    }
    const fileByPath = new Map();
    for (const f of files) if (!fileByPath.has(f.f)) fileByPath.set(f.f, f);

    /* --- packages (derive from files if needed) --- */
    let packages = packagesRaw.map((p) => ({
      name: text(p.name),
      files: num(p.files),
      symbols: num(p.symbols),
      loc: num(p.loc),
    })).filter((p) => p.name);
    if (!packages.length && files.length) {
      const byPkg = new Map();
      for (const f of files) {
        const key = f.p || '(root)';
        const entry = byPkg.get(key) || { name: key, files: 0, symbols: 0, loc: 0 };
        entry.files += 1;
        entry.symbols += f.s;
        entry.loc += f.l;
        byPkg.set(key, entry);
      }
      packages = Array.from(byPkg.values());
    }
    const pkgByName = new Map();
    for (const p of packages) pkgByName.set(p.name, p);

    /* --- obligations --- */
    const obligations = obligationsRaw.map(normalizeObligation).filter((o) => o.id);
    const obById = new Map();
    const obsBySymbol = new Map();
    const obsByFile = new Map();
    for (const o of obligations) {
      if (!obById.has(o.id)) obById.set(o.id, o);
      pushTo(obsBySymbol, o.s, o);
      pushTo(obsByFile, o.f, o);
    }

    /* --- symbols by file / package --- */
    const fileSymbols = new Map();
    const pkgFiles = new Map();
    for (const s of symbols) pushTo(fileSymbols, s.f, s.id);
    for (const f of files) pushTo(pkgFiles, f.p || '(root)', f.f);

    /* --- call graph --- */
    const callsOut = new Map();
    const callsIn = new Map();
    const calls = callsRaw
      .map((c) => ({ a: text(c.a), b: text(c.b), k: text(c.k) || 'calls', n: num(c.n) || 1 }))
      .filter((c) => c.a && c.b);
    for (const c of calls) {
      if (!callsOut.has(c.a)) callsOut.set(c.a, []);
      callsOut.get(c.a).push(c);
      if (!callsIn.has(c.b)) callsIn.set(c.b, []);
      callsIn.get(c.b).push(c);
    }

    /* --- paths --- */
    const paths = pathsRaw.map(normalizePath).filter((p) => p.id && p.steps.length);
    const pathById = new Map();
    for (const p of paths) pathById.set(p.id, p);
    const pathsBySymbol = new Map();
    for (const p of paths) {
      const seen = new Set();
      for (const step of p.steps) {
        if (seen.has(step.s)) continue;
        seen.add(step.s);
        pushTo(pathsBySymbol, step.s, p.id);
      }
    }

    /* --- per-symbol aggregates --- */
    const statBySymbol = new Map();
    for (const [sid, list] of obsBySymbol) {
      const st = emptyStat();
      for (const o of list) { st.total += 1; st[o.st] += 1; }
      statBySymbol.set(sid, st);
    }
    for (const s of symbols) {
      if (!statBySymbol.has(s.id) && s.o > 0) {
        const st = emptyStat();
        st.total = s.o;
        statBySymbol.set(s.id, st);
      }
    }

    /* --- per-file aggregates --- */
    const statByFile = new Map();
    for (const [fp, list] of obsByFile) {
      const st = emptyStat();
      for (const o of list) { st.total += 1; st[o.st] += 1; }
      statByFile.set(fp, st);
    }
    for (const f of files) {
      if (statByFile.has(f.f)) continue;
      const st = emptyStat();
      for (const sid of fileSymbols.get(f.f) || []) {
        const sst = statBySymbol.get(sid);
        if (sst) addStat(st, sst);
      }
      if (st.total) statByFile.set(f.f, st);
    }

    /* --- per-package aggregates --- */
    const statByPkg = new Map();
    for (const f of files) {
      const st = statByFile.get(f.f);
      if (!st) continue;
      const key = f.p || '(root)';
      if (!statByPkg.has(key)) statByPkg.set(key, emptyStat());
      addStat(statByPkg.get(key), st);
    }

    /* --- impact / exercises / lab indexes --- */
    const impact = impactRaw.map((i) => ({
      id: text(i.id),
      s: text(i.s),
      direct: asArray(i.direct).map(text).filter(Boolean),
      indirect: asArray(i.indirect).map(text).filter(Boolean),
      tests: asArray(i.tests).map(text).filter(Boolean),
      shared_state: asArray(i.shared_state).map(text).filter(Boolean),
      contracts: asArray(i.contracts).map(text).filter(Boolean),
      risk: num(i.risk),
      note: text(i.note),
    })).filter((i) => i.s);
    const impactBySymbol = new Map();
    for (const i of impact) if (!impactBySymbol.has(i.s)) impactBySymbol.set(i.s, i);

    const exercises = exercisesRaw.map(normalizeExercise).filter((x) => x.id);
    const exercisesByLevel = new Map();
    for (const x of exercises) pushTo(exercisesByLevel, x.level, x);

    const maintenance = maintenanceRaw.map((t) => ({
      id: text(t.id),
      k: text(t.k) || 'maintenance',
      title: text(t.title),
      prompt: text(t.prompt),
      steps: asArray(t.steps).map(text),
      level: num(t.level) || 1,
      symbols: asArray(t.symbols).map(text).filter(Boolean),
      tests: asArray(t.tests).map(text).filter(Boolean),
      risk: num(t.risk),
    })).filter((t) => t.id);
    const maintenanceByLevel = new Map();
    for (const t of maintenance) pushTo(maintenanceByLevel, t.level, t);

    const testing = testingRaw.map((t) => ({
      id: text(t.id),
      s: text(t.s),
      kind: text(t.kind) || 'test',
      text: text(t.text),
      covers: asArray(t.covers).map(text).filter(Boolean),
      exists: bool(t.exists),
    })).filter((t) => t.id);

    const gaps = gapsRaw.map((g) => ({
      id: text(g.id),
      kind: text(g.kind),
      s: text(g.s),
      f: text(g.f),
      text: text(g.text),
      reason: text(g.reason),
    })).filter((g) => g.id);

    const assessments = assessmentsRaw.map((a) => ({
      id: text(a.id),
      level: num(a.level) || 1,
      kind: text(a.kind),
      text: text(a.text),
      checks: asArray(a.checks).map(text),
      exercise: asArray(a.exercise).map(text).filter(Boolean),
      weight: num(a.weight),
    })).filter((a) => a.id);
    const assessmentsByLevel = new Map();
    for (const a of assessments) pushTo(assessmentsByLevel, a.level, a);

    const objectives = objectivesRaw.map((o) => ({
      id: text(o.id),
      level: num(o.level) || 1,
      text: text(o.text),
      symbols: asArray(o.symbols).map(text).filter(Boolean),
      obligations: asArray(o.obligations).map(text).filter(Boolean),
    })).filter((o) => o.id);

    const storylines = storylinesRaw.map((s) => ({
      id: text(s.id),
      path: text(s.path),
      title: text(s.title),
      premise: text(s.premise),
      acts: asArray(s.acts).map((a) => ({
        n: num(a.n),
        title: text(a.title),
        body: text(a.body),
        symbols: asArray(a.symbols).map(text).filter(Boolean),
        obligations: asArray(a.obligations).map(text).filter(Boolean),
      })),
      objectives: asArray(s.objectives).map(text),
      level: num(s.level) || 1,
    })).filter((s) => s.id);

    const storylinesByPath = new Map();
    for (const s of storylines) if (s.path) pushTo(storylinesByPath, s.path, s);

    /* --- imports / externals (kept for completeness of the consumer) --- */
    const imports = importsRaw.map((i) => ({ a: text(i.a), b: text(i.b), k: text(i.k), w: text(i.w) }));
    const externals = externalsRaw.map((e) => ({ id: text(e.id), n: text(e.n), cat: text(e.cat), c: num(e.c) }));
    const modules = modulesRaw.map((m) => ({
      id: text(m.id), n: text(m.n), f: text(m.f), p: text(m.p), k: text(m.k), a: text(m.a), e: text(m.e),
    }));

    /* --- report --- */
    const coverageMap = new Map();
    let report = null;
    if (reportRaw) {
      const cov = reportRaw.coverage && typeof reportRaw.coverage === 'object' ? reportRaw.coverage : {};
      for (const key of Object.keys(cov)) {
        const d = cov[key] || {};
        coverageMap.set(key, {
          covered: num(d.covered),
          total: num(d.total),
          unknown: num(d.unknown),
          excluded: num(d.excluded),
          pct: Number.isFinite(Number(d.pct)) ? Number(d.pct) : (num(d.total) ? num(d.covered) / num(d.total) : 0),
        });
      }
      report = {
        totals: reportRaw.totals && typeof reportRaw.totals === 'object' ? {
          obligations: num(reportRaw.totals.obligations),
          covered: num(reportRaw.totals.covered),
          uncovered: num(reportRaw.totals.uncovered),
          unknown: num(reportRaw.totals.unknown),
          excluded: num(reportRaw.totals.excluded),
          denominator: num(reportRaw.totals.denominator),
          critical_open: num(reportRaw.totals.critical_open),
          pct: Number(reportRaw.totals.pct) || 0,
        } : null,
        coverage: coverageMap,
        unknown_ratio: Number.isFinite(Number(reportRaw.unknown_ratio)) ? Number(reportRaw.unknown_ratio) : 0,
        reachability: reportRaw.reachability && typeof reportRaw.reachability === 'object' ? {
          entry_reachable: num(reportRaw.reachability.entry_reachable),
          test_reachable: num(reportRaw.reachability.test_reachable),
          unproven: num(reportRaw.reachability.unproven),
          unproven_pct: Number(reportRaw.reachability.unproven_pct) || 0,
          note: text(reportRaw.reachability.note),
        } : null,
        critical_gaps: num(reportRaw.critical_gaps),
        levels: asArray(reportRaw.levels).map((l) => ({
          level: num(l.level) || 1,
          name: text(l.name) || 'Level ' + (num(l.level) || 1),
          obligations: num(l.obligations),
          evidence_kinds: asArray(l.evidence_kinds).map(text),
        })).sort((a, b) => a.level - b.level),
        policy: asArray(reportRaw.policy).map(text),
      };
    }

    /* --- CFGs (only learning-set symbols) --- */
    const cfgs = new Map();
    for (const key of Object.keys(cfgsRaw)) {
      const cfg = cfgsRaw[key];
      if (!cfg || typeof cfg !== 'object') continue;
      cfgs.set(key, {
        nodes: asArray(cfg.nodes).map((n) => ({ id: text(n.id), k: text(n.k), l: text(n.l), a: text(n.a) })),
        edges: asArray(cfg.edges).map((e) => ({ f: text(e.f), t: text(e.t), k: text(e.k) })),
      });
    }

    /* --- derived counts (never trust meta.counts alone) --- */
    const totalStat = emptyStat();
    for (const o of obligations) { totalStat.total += 1; totalStat[o.st] += 1; }

    const store = {
      meta, packages, files, symbols, obligations, calls, paths, storylines, objectives,
      exercises, assessments, impact, maintenance, testing, gaps, storylinesByPath,
      imports, externals, modules, report, cfgs,

      symById, fileByPath, pkgByName, obById, obsBySymbol, obsByFile,
      fileSymbols, pkgFiles, pathsBySymbol, impactBySymbol, callOut: callsOut, callIn: callsIn,
      statBySymbol, statByFile, statByPkg, pathById,
      exercisesByLevel, maintenanceByLevel, assessmentsByLevel,
      totalStat,

      symbolList: symbols,
      fileList: files,
      packageList: packages,
      entrySymbols: symbols.filter((s) => s.st === 'entry'),
      testSymbols: symbols.filter((s) => s.t),

      statOfSymbol(id) { return statBySymbol.get(id) || emptyStat(); },
      statOfFile(f) { return statByFile.get(f) || emptyStat(); },
      statOfPackage(p) { return statByPkg.get(p) || emptyStat(); },
      symbolName(id) {
        const s = symById.get(id);
        return s ? s.n : String(id || '');
      },
      isTest(ob) {
        const s = symById.get(ob.s);
        if (s) return s.t;
        const f = fileByPath.get(ob.f);
        return f ? f.t : false;
      },
      counts() {
        // Exact corpus totals come from meta.counts when the payload carries a
        // trimmed obligation slice; the arrays are the fallback.
        const mc = meta.counts || {};
        const numOr = (v, fallback) => (Number.isFinite(Number(v)) ? Number(v) : fallback);
        return {
          symbols: numOr(mc.symbols, symbols.length),
          files: numOr(mc.files, files.length),
          packages: packages.length,
          obligations: numOr(mc.obligations, obligations.length),
          obligationsInPayload: obligations.length,
          paths: numOr(mc.paths, paths.length),
          calls: numOr(mc.edges, calls.length),
          covered: totalStat.covered,
          uncovered: totalStat.uncovered,
          unknown: totalStat.unknown,
        };
      },
    };

    return store;
  }

  /* ==========================================================================
   * 3. Query layer — pure functions over a store (unit-testable in Node)
   * ======================================================================== */

  function createFilters(store) {
    const presentStatus = new Set();
    const presentTypes = new Set();
    const presentRisks = new Set();
    for (const o of store.obligations) {
      presentStatus.add(o.st);
      presentTypes.add(o.t);
      presentRisks.add(o.cat);
    }
    return {
      statuses: new Set(STATUSES.filter((s) => presentStatus.has(s))),
      types: new Set(TYPES.filter((t) => presentTypes.has(t)).concat(Array.from(presentTypes).filter((t) => TYPES.indexOf(t) < 0))),
      risks: new Set(RISK_CATS.filter((r) => presentRisks.has(r)).concat(Array.from(presentRisks).filter((r) => RISK_CATS.indexOf(r) < 0))),
      crit: new Set([1, 2, 3]),
      includeTests: true,
      presentStatus,
      presentTypes,
      presentRisks,
    };
  }

  function passFilter(store, ob, f) {
    if (!f) return true;
    if (!f.statuses.has(ob.st)) return false;
    if (!f.types.has(ob.t)) return false;
    if (!f.risks.has(ob.cat)) return false;
    if (!f.crit.has(ob.crit || 1)) return false;
    if (!f.includeTests && store.isTest(ob)) return false;
    return true;
  }

  function filterObligations(store, f) {
    const out = [];
    for (const o of store.obligations) if (passFilter(store, o, f)) out.push(o);
    return out;
  }

  /** Aggregate a filtered obligation list by an arbitrary key function. */
  function aggregate(list, keyFn) {
    const map = new Map();
    for (const o of list) {
      const key = keyFn(o);
      let st = map.get(key);
      if (!st) { st = emptyStat(); map.set(key, st); }
      st.total += 1;
      st[o.st] += 1;
    }
    return map;
  }

  function coverageOf(stat) {
    return stat && stat.total ? stat.covered / stat.total : 0;
  }

  function unknownRatio(list) {
    if (!list.length) return 0;
    let unknown = 0;
    for (const o of list) if (o.st === 'unknown') unknown += 1;
    return unknown / list.length;
  }

  /* --- fuzzy search ------------------------------------------------------ */

  function fuzzyScore(query, target) {
    if (!query) return -1;
    if (!target) return -1;
    const q = query;
    if (target === q) return 1000;
    let idx = target.indexOf(q);
    let score = -1;
    if (idx === 0) score = 800 - Math.min(200, target.length - q.length);
    else if (idx > 0) score = 600 - Math.min(200, target.length - q.length);

    // subsequence pass (handles "gtMdl" -> "getModel")
    let ti = 0;
    let run = 0;
    let sub = 0;
    for (let qi = 0; qi < q.length; qi++) {
      const ch = q[qi];
      let found = -1;
      for (let k = ti; k < target.length; k++) {
        if (target[k] === ch) { found = k; break; }
      }
      if (found < 0) { sub = -1; break; }
      sub += 8 + (found === ti ? 6 : 0) + (run > 0 ? 10 : 0);
      if (found === ti) run += 1; else run = 0;
      ti = found + 1;
    }
    if (sub > 0) score = Math.max(score, Math.min(580, sub));
    return score;
  }

  function fuzzySearch(store, query, limit) {
    const q = String(query || '').trim().toLowerCase();
    if (q.length < 1) return [];
    const capped = q.length > 64 ? q.slice(0, 64) : q;
    const out = [];
    for (const s of store.symbols) {
      const nameHit = fuzzyScore(capped, s.n.toLowerCase());
      const pathHit = fuzzyScore(capped, s.f.toLowerCase());
      const idHit = fuzzyScore(capped, s.id.toLowerCase());
      let best = Math.max(nameHit, pathHit > 0 ? pathHit - 90 : pathHit, idHit > 0 ? idHit - 160 : idHit);
      if (best > 0) out.push({ s, score: best });
    }
    out.sort((a, b) => (b.score - a.score) || (a.s.id < b.s.id ? -1 : a.s.id > b.s.id ? 1 : 0));
    return out.slice(0, limit || 30);
  }

  /* --- graph walks ------------------------------------------------------- */

  /**
   * Walk callers backwards from a symbol until an entry point is reached.
   * Returns [entry, ..., symbol] or null.
   */
  function findEntryChain(store, startId, maxDepth) {
    const limit = maxDepth == null ? 12 : maxDepth;
    const start = store.symById.get(startId);
    if (!start) return null;
    if (start.st === 'entry') return [startId];

    const prev = new Map([[startId, null]]);
    const queue = [{ id: startId, d: 0 }];
    let guard = 0;

    while (queue.length && guard < 20000) {
      guard += 1;
      const cur = queue.shift();
      if (cur.d >= limit) continue;
      const callers = store.callIn.get(cur.id) || [];
      for (const edge of callers) {
        if (prev.has(edge.a)) continue;
        const caller = store.symById.get(edge.a);
        if (!caller) continue;
        prev.set(edge.a, cur.id);
        if (caller.st === 'entry') {
          const chain = [edge.a];
          let p = cur.id;
          let hops = 0;
          while (p != null && hops < limit + 2) { chain.push(p); p = prev.get(p); hops += 1; }
          if (chain[chain.length - 1] !== startId) chain.push(startId);
          return chain;
        }
        queue.push({ id: edge.a, d: cur.d + 1 });
      }
    }
    return null;
  }

  function bestPathForSymbol(store, symId) {
    let best = null;
    for (const p of store.paths) {
      if (!p.steps.some((s) => s.s === symId)) continue;
      if (!best || p.length < best.length || (p.length === best.length && p.id < best.id)) best = p;
    }
    return best;
  }

  function buildLearningRoute(store, ob) {
    const sym = store.symById.get(ob.s) || null;
    const chain = sym ? findEntryChain(store, ob.s) : null;
    const path = bestPathForSymbol(store, ob.s);
    return {
      obligation: ob,
      symbol: sym,
      chain: chain || [],
      entry: chain && chain.length ? store.symById.get(chain[0]) || null : null,
      pathId: path ? path.id : '',
      reachable: !!(chain && chain.length),
    };
  }

  /**
   * Transitive closure over call edges.
   * dir: 'up' = callers (dependencies), 'down' = callees (consumers).
   */
  function closure(store, startId, dir, maxDepth) {
    const depth = maxDepth == null ? DEP_DEPTH : maxDepth;
    const seen = new Set([startId]);
    const levels = [];
    let frontier = [startId];
    let truncated = false;
    for (let d = 1; d <= depth; d++) {
      const next = [];
      for (const id of frontier) {
        const edges = (dir === 'up' ? store.callIn : store.callOut).get(id) || [];
        for (const e of edges) {
          const nid = dir === 'up' ? e.a : e.b;
          if (!nid || seen.has(nid)) continue;
          seen.add(nid);
          if (next.length >= 800) { truncated = true; continue; }
          next.push(nid);
        }
      }
      levels.push(next);
      frontier = next;
      if (!next.length) break;
      if (d === depth && next.length) truncated = true;
    }
    return { levels, total: seen.size - 1, truncated, depth };
  }

  /** Symbols with t===true reachable in <= hops over the call graph (undirected). */
  function relatedTests(store, startId, hops) {
    const max = hops == null ? TEST_HOPS : hops;
    const seen = new Set([startId]);
    let frontier = [startId];
    const found = [];
    const foundIds = new Set();
    for (let d = 1; d <= max; d++) {
      const next = [];
      for (const id of frontier) {
        const edges = (store.callIn.get(id) || []).concat(store.callOut.get(id) || []);
        for (const e of edges) {
          const nid = e.a === id ? e.b : e.a;
          if (!nid || seen.has(nid)) continue;
          seen.add(nid);
          next.push(nid);
          const sym = store.symById.get(nid);
          if (sym && sym.t && !foundIds.has(nid)) { foundIds.add(nid); found.push({ sym, hops: d }); }
        }
      }
      frontier = next;
      if (!frontier.length) break;
    }
    return found;
  }

  /* --- treemap ----------------------------------------------------------- */

  /**
   * Squarified treemap. Deterministic: input order is the payload order.
   * items: [{ value, ...meta }]. Returns rects with pixel geometry.
   */
  function squarify(items, x, y, w, h) {
    const rects = [];
    const nodes = items.filter((d) => d.value > 0);
    if (!nodes.length || w <= 1 || h <= 1) return rects;

    const total = nodes.reduce((a, b) => a + b.value, 0);
    const area = w * h;
    const scaled = nodes.map((n) => Object.assign({}, n, { area: (n.value / total) * area }));

    let cx = x, cy = y, cw = w, ch = h;
    let rest = scaled;
    let row = [];

    const worst = (list, side) => {
      if (!list.length || side <= 0) return Infinity;
      let sum = 0, mx = -Infinity, mn = Infinity;
      for (const r of list) { sum += r.area; if (r.area > mx) mx = r.area; if (r.area < mn) mn = r.area; }
      if (sum <= 0) return Infinity;
      return Math.max((side * side * mx) / (sum * sum), (sum * sum) / (side * side * mn));
    };

    const layout = () => {
      const sum = row.reduce((a, b) => a + b.area, 0);
      if (sum <= 0) { row = []; return; }
      if (cw >= ch) {
        const colW = sum / ch;
        let yy = cy;
        for (const r of row) {
          const hh = colW > 0 ? r.area / colW : 0;
          rects.push({ item: r, x: cx, y: yy, w: colW, h: hh });
          yy += hh;
        }
        cx += colW;
        cw -= colW;
      } else {
        const rowH = sum / cw;
        let xx = cx;
        for (const r of row) {
          const ww = rowH > 0 ? r.area / rowH : 0;
          rects.push({ item: r, x: xx, y: cy, w: ww, h: rowH });
          xx += ww;
        }
        cy += rowH;
        ch -= rowH;
      }
      row = [];
    };

    let guard = 0;
    while ((rest.length || row.length) && guard < 20000) {
      guard += 1;
      if (!rest.length) {
        layout();
        break;
      }
      if (!row.length) {
        row.push(rest.shift());
        continue;
      }
      const side = Math.min(Math.max(cw, 1), Math.max(ch, 1));
      if (worst(row.concat([rest[0]]), side) > worst(row, side)) layout();
      else row.push(rest.shift());
    }
    if (row.length) layout();

    return rects.map((r) => ({
      item: r.item,
      x: r.x, y: r.y,
      w: Math.max(0, r.w), h: Math.max(0, r.h),
    }));
  }

  /** Sequential ramp: low coverage -> amber, mid -> olive, high -> green. */
  function coverageColor(p, alpha) {
    const t = clamp(Number.isFinite(p) ? p : 0, 0, 1);
    const stops = [
      [0.0, [122, 74, 18]],
      [0.45, [74, 106, 58]],
      [1.0, [46, 160, 67]],
    ];
    let a = stops[0], b = stops[stops.length - 1];
    for (let i = 0; i < stops.length - 1; i++) {
      if (t >= stops[i][0] && t <= stops[i + 1][0]) { a = stops[i]; b = stops[i + 1]; break; }
    }
    const span = b[0] - a[0] || 1;
    const k = (t - a[0]) / span;
    const rgb = [0, 1, 2].map((i) => Math.round(a[1][i] + (b[1][i] - a[1][i]) * k));
    return alpha == null ? 'rgb(' + rgb.join(',') + ')' : 'rgba(' + rgb.join(',') + ',' + alpha + ')';
  }

  /* --- lab self-check ---------------------------------------------------- */

  const TOKEN_STOP = new Set(['get', 'set', 'use', 'handle', 'should', 'with', 'from', 'that', 'this', 'when', 'then', 'and', 'the', 'for', 'has', 'are', 'build', 'make']);

  function symbolTokens(sym) {
    if (!sym) return [];
    const base = String(sym.n).split('.').pop() || '';
    const parts = base
      .replace(/[^A-Za-z0-9_$]/g, ' ')
      .split(/(?=[A-Z])|[\s_]+/)
      .map((x) => x.toLowerCase())
      .filter((x) => x.length > 2 && !TOKEN_STOP.has(x));
    const fileBase = String(sym.f).split('/').pop().replace(/\.[a-z0-9]+$/i, '').toLowerCase();
    const tokens = new Set();
    for (const p of parts) tokens.add(p);
    if (base.toLowerCase().length > 3) tokens.add(base.toLowerCase());
    if (fileBase.length > 3 && !TOKEN_STOP.has(fileBase)) tokens.add(fileBase);
    tokens.add(String(sym.f).toLowerCase());
    return Array.from(tokens).filter(Boolean);
  }

  /**
   * Compare a learner's free-text answer against the task's affected symbols.
   * Token match only — deliberately conservative and explainable.
   */
  function labCheck(store, task, answer) {
    const text = String(answer || '').toLowerCase();
    const affected = asArray(task && task.symbols)
      .map((id) => store.symById.get(id))
      .filter(Boolean);
    const covered = [];
    const missed = [];
    for (const sym of affected) {
      const tokens = symbolTokens(sym);
      const hit = tokens.some((t) => t && text.indexOf(t) >= 0);
      if (hit) covered.push(sym); else missed.push(sym);
    }
    const noun = affected.length === 1 ? 'module' : 'modules';
    let message;
    if (!affected.length) message = 'This task lists no affected symbols in the payload; nothing to match against.';
    else if (!text.trim()) message = 'Nothing to check yet — name the affected symbols in your answer.';
    else if (!missed.length) message = 'All ' + affected.length + ' affected ' + noun + ' named.';
    else message = 'You missed ' + missed.length + ' affected ' + noun + ' (' + covered.length + '/' + affected.length + ' named).';
    return { covered, missed, message, total: affected.length };
  }

  /* --- coverage summary (dashboard fallback) ----------------------------- */

  function coverageByType(store) {
    const rows = [];
    for (const t of TYPES) {
      const list = store.obligations.filter((o) => o.t === t);
      if (!list.length) continue;
      const st = emptyStat();
      for (const o of list) { st.total += 1; st[o.st] += 1; }
      rows.push({ key: t, stat: st });
    }
    return rows;
  }

  function criticalityBreakdown(store) {
    const rows = [1, 2, 3].map((c) => ({ crit: c, stat: emptyStat() }));
    const byCrit = new Map(rows.map((r) => [r.crit, r.stat]));
    for (const o of store.obligations) {
      const st = byCrit.get(o.crit || 1) || byCrit.get(1);
      st.total += 1;
      st[o.st] += 1;
    }
    return rows;
  }

  /* --- progress (learner evidence) --------------------------------------- */

  let PROGRESS = null;

  function getProgress() {
    if (PROGRESS) return PROGRESS;
    const saved = LS.get(PROGRESS_KEY, null);
    const base = saved && typeof saved === 'object' ? saved : {};
    PROGRESS = {
      paths: base.paths && typeof base.paths === 'object' ? base.paths : {},
      exercises: base.exercises && typeof base.exercises === 'object' ? base.exercises : {},
      lab: base.lab && typeof base.lab === 'object' ? base.lab : {},
      symbols: base.symbols && typeof base.symbols === 'object' ? base.symbols : {},
    };
    return PROGRESS;
  }

  function saveProgress() {
    LS.set(PROGRESS_KEY, getProgress());
  }

  function mark(kind, id, value) {
    if (!id) return false;
    const p = getProgress();
    if (!p[kind]) p[kind] = {};
    if (value === false) {
      if (p[kind][id]) { delete p[kind][id]; saveProgress(); return true; }
      return false;
    }
    if (p[kind][id]) return false;
    p[kind][id] = Date.now();
    // cap the symbol-visit ledger so localStorage cannot grow without bound
    if (kind === 'symbols') {
      const keys = Object.keys(p.symbols);
      if (keys.length > 3000) {
        keys.sort((a, b) => p.symbols[a] - p.symbols[b]);
        for (const k of keys.slice(0, keys.length - 3000)) delete p.symbols[k];
      }
    }
    saveProgress();
    return true;
  }

  function isMarked(kind, id) {
    const p = getProgress();
    return !!(p[kind] && p[kind][id]);
  }

  function progressCounts() {
    const p = getProgress();
    return {
      paths: Object.keys(p.paths).length,
      exercises: Object.keys(p.exercises).length,
      lab: Object.keys(p.lab).length,
      symbols: Object.keys(p.symbols).length,
    };
  }

  /* --- per-level items for the report ----------------------------------- */

  function levelItems(store, level) {
    const p = getProgress();
    const items = [];
    for (const path of store.paths) {
      if (path.tier !== level) continue;
      items.push({
        kind: 'path',
        id: path.id,
        title: path.title,
        done: !!p.paths[path.id],
        hash: '#/debugger?path=' + encodeURIComponent(path.id),
        meta: path.steps.length + ' steps',
      });
    }
    for (const ex of store.exercises) {
      if (ex.level !== level) continue;
      items.push({
        kind: 'exercise',
        id: ex.id,
        title: ex.title,
        done: !!p.exercises[ex.id],
        meta: ex.k,
      });
    }
    for (const task of store.maintenance) {
      if (task.level !== level) continue;
      items.push({
        kind: 'lab',
        id: task.id,
        title: task.title,
        done: !!p.lab[task.id],
        hash: '#/lab',
        meta: task.k,
      });
    }
    for (const a of store.assessmentsByLevel.get(level) || []) {
      const done = a.exercise.length ? a.exercise.every((id) => !!p.exercises[id]) : !!p.exercises[a.id];
      items.push({ kind: 'assessment', id: a.id, title: a.text, done, meta: a.kind });
    }
    return items;
  }


  /* ==========================================================================
   * 4. UI primitives
   * ======================================================================== */

  /**
   * Windowed list. Renders at most MAX_ROWS rows regardless of list size.
   * Row content is produced on demand: render(i) -> html``.
   */
  function VirtualList(opts) {
    const host = opts.host;
    if (!host) return null;
    const rowHeight = opts.rowHeight || 28;
    const overscan = opts.overscan == null ? 6 : opts.overscan;
    const maxRows = Math.min(opts.maxRows || MAX_ROWS, MAX_ROWS);
    const renderRow = opts.render;
    const emptyHTML = opts.empty == null ? '' : str(opts.empty);

    host.classList.add('vlist');
    host.innerHTML = '';
    const spacer = el('div', 'vlist-spacer');
    const win = el('div', 'vlist-window');
    host.appendChild(spacer);
    host.appendChild(win);

    let count = 0;
    let frame = 0;
    let dirty = true;
    let dead = false;
    let lastStart = -1;
    let lastEnd = -1;

    function paint(force) {
      frame = 0;
      if (dead) return;
      const viewH = host.clientHeight || rowHeight * 10;
      const visible = Math.ceil(viewH / rowHeight) + overscan * 2;
      const start = Math.max(0, Math.floor(host.scrollTop / rowHeight) - overscan);
      const end = Math.min(count, start + Math.min(maxRows, visible));
      if (!force && !dirty && start === lastStart && end === lastEnd) return;
      lastStart = start;
      lastEnd = end;
      dirty = false;

      if (!count) {
        win.style.transform = 'translateY(0px)';
        win.innerHTML = emptyHTML;
        return;
      }

      let out = '';
      for (let i = start; i < end; i++) out += str(renderRow(i));
      win.innerHTML = out;
      win.style.transform = 'translateY(' + start * rowHeight + 'px)';
      for (let i = 0; i < win.children.length; i++) {
        win.children[i].style.height = rowHeight + 'px';
      }
    }

    function schedule() {
      if (frame || dead) return;
      frame = requestAnimationFrame(() => paint(false));
    }

    const onScroll = () => schedule();
    host.addEventListener('scroll', onScroll, { passive: true });

    let ro = null;
    if (typeof ResizeObserver === 'function') {
      ro = new ResizeObserver(schedule);
      ro.observe(host);
    } else {
      window.addEventListener('resize', schedule);
    }

    const api = {
      setCount(n) {
        count = Math.max(0, Number(n) || 0);
        spacer.style.height = count * rowHeight + 'px';
        dirty = true;
        paint(true);
      },
      refresh() {
        dirty = true;
        paint(true);
      },
      scrollToIndex(i) {
        const top = Math.max(0, (Number(i) || 0) * rowHeight - rowHeight * 2);
        host.scrollTop = top;
        dirty = true;
        paint(true);
      },
      rowHeight,
      destroy() {
        dead = true;
        host.removeEventListener('scroll', onScroll);
        if (ro) ro.disconnect();
        else window.removeEventListener('resize', schedule);
        if (frame) cancelAnimationFrame(frame);
      },
    };

    paint(true);
    return api;
  }

  let toastTimer = 0;
  function toast(message) {
    const node = document.getElementById('toast');
    if (!node) return;
    node.textContent = String(message || '');
    node.hidden = false;
    requestAnimationFrame(() => node.classList.add('show'));
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      node.classList.remove('show');
      node.hidden = true;
    }, 2600);
  }

  function statusChip(st, extraClass) {
    const cls = STATUSES.indexOf(st) >= 0 ? st : 'unknown';
    return html`<span class="chip st-${cls}${extraClass ? ' ' + extraClass : ''}" title="${STATUS_HINT[cls] || ''}">${st}</span>`;
  }

  function barStat(stat, opts) {
    const o = opts || {};
    const s = stat || emptyStat();
    const total = s.total || 0;
    const seg = [];
    for (const st of STATUSES) {
      const v = s[st] || 0;
      if (!v || !total) continue;
      seg.push(html`<i class="s-${st}" style="width:${(v / total) * 100}%"></i>`);
    }
    const title = total ? STATUSES.map((st) => st + ' ' + s[st]).join(' · ') : 'no obligations';
    return html`<div class="barwrap">
      <div class="bar ${o.size || ''}" title="${title}" role="img" aria-label="${title}">${seg}</div>
      ${o.meta === false ? '' : html`<div class="barmeta"><span>${s.covered || 0}/${total}</span><span>${total ? pct(coverageOf(s), 0) : '—'}</span></div>`}
    </div>`;
  }

  function kpi(label, value, sub) {
    return html`<div class="kvcell"><span>${label}</span><b>${value}</b>${sub ? html`<span>${sub}</span>` : ''}</div>`;
  }

  function viewHead(title, subtitle, right) {
    return html`<div class="viewhead">
      <div><h1>${title}</h1>${subtitle ? html`<p>${subtitle}</p>` : ''}</div>
      ${right ? html`<div class="viewhead-r">${right}</div>` : ''}
    </div>`;
  }

  function crumbs(items) {
    const out = [];
    items.forEach((it, i) => {
      if (i) out.push(html`<span class="sep">/</span>`);
      out.push(it.hash ? html`<a href="${it.hash}">${it.label}</a>` : html`<span>${it.label}</span>`);
    });
    return html`<div class="crumbs">${out}</div>`;
  }

  function fileLabel(pathValue) {
    return shortPath(pathValue, 3);
  }

  /* --- combobox ---------------------------------------------------------- */

  /**
   * Mount a search combobox on an input + results container.
   * getItems(query) -> [{ key, name, meta, sym }]
   */
  function mountCombo(cfg) {
    const input = cfg.input;
    const list = cfg.list;
    const getItems = cfg.getItems;
    const onPick = cfg.onPick;
    const bind = cfg.persist ? onPersist : on;
    let items = [];
    let active = -1;

    function close() {
      list.hidden = true;
      input.setAttribute('aria-expanded', 'false');
      active = -1;
    }

    function open() {
      list.hidden = false;
      input.setAttribute('aria-expanded', 'true');
    }

    function setActive(i) {
      const buttons = list.querySelectorAll('.res');
      if (!buttons.length) return;
      active = (i + buttons.length) % buttons.length;
      buttons.forEach((b, idx) => {
        b.classList.toggle('active', idx === active);
        b.setAttribute('aria-selected', idx === active ? 'true' : 'false');
      });
      const current = buttons[active];
      if (current && current.scrollIntoView) current.scrollIntoView({ block: 'nearest' });
    }

    function renderResults() {
      if (!items.length) {
        setHTML(list, html`<div class="res-empty">${cfg.emptyText || 'no match'}</div>`);
        open();
        return;
      }
      setHTML(list, cat(items.map((it) => html`
        <button class="res" role="option" aria-selected="false" data-key="${it.key}">
          <span class="res-name">${it.name}</span>
          <span class="res-kind">${it.meta || ''}</span>
          <span class="res-path">${it.path || ''}</span>
        </button>`)));
      open();
      active = -1;
    }

    function run() {
      const q = input.value;
      items = q.trim() ? getItems(q) : [];
      if (!q.trim()) { close(); setHTML(list, ''); return; }
      renderResults();
    }

    bind(input, 'input', run);
    bind(input, 'focus', () => { if (input.value.trim()) run(); });
    bind(input, 'keydown', (ev) => {
      if (ev.key === 'ArrowDown') { ev.preventDefault(); if (list.hidden) run(); setActive(active + 1); }
      else if (ev.key === 'ArrowUp') { ev.preventDefault(); setActive(active - 1); }
      else if (ev.key === 'Enter') {
        ev.preventDefault();
        const pick = items[active >= 0 ? active : 0];
        if (pick) { onPick(pick); close(); }
      } else if (ev.key === 'Escape') { close(); input.blur(); }
    });
    bind(list, 'mousedown', (ev) => {
      const btn = ev.target.closest('.res');
      if (!btn) return;
      ev.preventDefault();
      const pick = items.find((it) => it.key === btn.dataset.key);
      if (pick) { onPick(pick); close(); }
    });
    bind(document, 'click', (ev) => {
      if (!list.hidden && !list.contains(ev.target) && ev.target !== input) close();
    });

    return { close, run, focus: () => input.focus() };
  }

  /* ==========================================================================
   * 5. Shell
   * ======================================================================== */

  let STORE = null;

  function renderNav() {
    const tabs = document.getElementById('tabs');
    if (!tabs) return;
    setHTML(tabs, cat(ROUTES.map((r) => html`
      <a class="tab" href="${r.hash}" data-route="${r.id}" title="${r.hint}">${r.label}</a>`)));
  }

  function setActiveTab(id) {
    $$('.tab').forEach((tab) => {
      if (tab.dataset.route === id) tab.setAttribute('aria-current', 'page');
      else tab.removeAttribute('aria-current');
    });
  }

  function renderTopbar() {
    const name = document.getElementById('brandName');
    const sub = document.getElementById('brandSub');
    const countsHost = document.getElementById('topCounts');
    if (!STORE) return;
    const m = STORE.meta;
    const c = STORE.counts();
    if (name) name.textContent = m.repository;
    if (sub) {
      const bits = [];
      if (m.commit) bits.push(m.commit.slice(0, 8));
      if (m.branch) bits.push(m.branch);
      bits.push(m.analysis_version || 'rlp');
      if (m.languages.length) bits.push(m.languages.join('/'));
      setHTML(sub, html`${bits.join(' · ')}${m.truncated ? html` · <span class="warn">payload truncated</span>` : ''}`);
      sub.title = [
        'generated ' + (m.generated_at || 'unknown'),
        m.truncated ? 'budget cap hit: payload truncated' : 'complete payload',
      ].join(' · ');
    }
    if (countsHost) {
      const cells = [
        ['symbols', c.symbols],
        ['obligations', c.obligations],
        ['paths', c.paths],
        ['files', c.files],
      ];
      setHTML(countsHost, cat(cells.map(([label, value]) => html`
        <div class="tcount"><b>${nfmt(value)}</b><span>${label}</span></div>`)));
    }
  }

  function mountGlobalSearch() {
    const host = document.getElementById('searchHost');
    if (!host) return;
    setHTML(host, html`<div class="search">
      <input id="gsearch" type="search" placeholder="search symbols, paths, ids…" autocomplete="off"
             spellcheck="false" role="combobox" aria-expanded="false" aria-controls="gresults"
             aria-label="Search symbols and files">
      <kbd>/</kbd>
      <div class="results" id="gresults" role="listbox" hidden></div>
    </div>`);

    const input = $('#gsearch', host);
    const list = $('#gresults', host);
    if (!input || !list) return;

    const combo = mountCombo({
      input,
      list,
      persist: true,
      emptyText: 'no symbol matches that query',
      getItems(q) {
        return fuzzySearch(STORE, q, 40).map((hit) => ({
          key: hit.s.id,
          name: hit.s.n || hit.s.id,
          meta: hit.s.k,
          path: fileLabel(hit.s.f),
          sym: hit.s,
        }));
      },
      onPick(item) {
        if (!item || !item.sym) return;
        go('#/map?symbol=' + encodeURIComponent(item.sym.id));
      },
    });

    onPersist(document, 'keydown', (ev) => {
      const tag = (ev.target && ev.target.tagName) || '';
      const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (ev.target && ev.target.isContentEditable);
      if (ev.key === '/' && !typing && !ev.metaKey && !ev.ctrlKey && !ev.altKey) {
        ev.preventDefault();
        input.focus();
        input.select();
      }
    });

    return combo;
  }

  /** Re-render the current view in place, tearing down the previous listeners first. */
  function rerender(fn) {
    destroyMounts();
    flushCleanups();
    fn();
  }

  /* ==========================================================================
   * 6. Views
   * ======================================================================== */


  /* ------------------------------------------------------------------ *
   * A. Repository Map
   * ------------------------------------------------------------------ */

  const mapState = {
    openPkgs: new Set(),
    sel: '',
    selFile: '',
  };

  function compactBar(stat, size) {
    const s = stat || emptyStat();
    const total = s.total || 0;
    const seg = [];
    if (total) {
      for (const st of STATUSES) {
        const v = s[st] || 0;
        if (v) seg.push(html`<i class="s-${st}" style="width:${(v / total) * 100}%"></i>`);
      }
    }
    const title = total ? STATUSES.map((st) => st + ' ' + s[st]).join(' · ') : 'no obligations';
    return html`<span class="bar ${size || 'xs'}" role="img" aria-label="${title}" title="${title}">${seg}</span>`;
  }

  function renderMap(params) {
    const view = document.getElementById('view');
    const symId = params.get('symbol') || '';
    const filePath = params.get('file') || '';
    const sym = STORE.symById.get(symId) || null;
    const file = STORE.fileByPath.get(filePath) || null;

    if (sym) {
      mark('symbols', sym.id);
      mapState.openPkgs.add(sym.p);
      mapState.sel = sym.id;
      mapState.selFile = '';
    } else if (file) {
      mapState.openPkgs.add(file.p);
      mapState.selFile = file.f;
      mapState.sel = '';
    }

    const shown = STORE.obligations.length;
    setHTML(view, html`
      ${viewHead(
        'Repository map',
        'Repository → package → file → symbol. Counts are obligation counts; the bar is covered/total.',
        html`<span class="muted mono">${nfmt(STORE.counts().symbols)} symbols · ${nfmt(shown)} obligations</span>`
      )}
      <div class="mapgrid">
        <aside class="panel tree-panel">
          <div class="panel-head"><span class="ph-title">Tree</span><span class="mono">${nfmt(STORE.packageList.length)} packages</span></div>
          <div id="tree" class="tree"></div>
        </aside>
        <section class="panel detail-panel" id="detail"></section>
      </div>`);

    const treeHost = document.getElementById('tree');
    const detailHost = document.getElementById('detail');

    mountTree(treeHost);
    renderDetail(detailHost, sym, file);
    wireMap(view);
  }

  function wireMap(view) {
    on(view, 'click', (ev) => {
      const t = ev.target.closest('[data-act]');
      if (!t) return;
      const act = t.dataset.act;
      if (act === 'pkg') {
        const pkg = t.dataset.pkg;
        if (mapState.openPkgs.has(pkg)) mapState.openPkgs.delete(pkg);
        else mapState.openPkgs.add(pkg);
        rerender(() => renderMap(parseHash().params));
        return;
      }
      if (act === 'repo') {
        mapState.openPkgs.clear();
        rerender(() => renderMap(parseHash().params));
        return;
      }
      if (act === 'file') { go('#/map?file=' + encodeURIComponent(t.dataset.file)); return; }
      if (act === 'sym') { go('#/map?symbol=' + encodeURIComponent(t.dataset.id)); return; }
      if (act === 'ob') {
        atlasState.sel = t.dataset.id;
        atlasState.focusFile = '';
        go('#/atlas');
      }
    });
  }

  function mountTree(host) {
    if (!host) return;
    host.innerHTML = '';

    const repoStat = STORE.totalStat;
    const repoRow = el('div');
    setHTML(repoRow, html`
      <button class="trow" data-act="repo" aria-expanded="true" title="${STORE.meta.repository}">
        <span class="caret">▾</span>
        <span class="tname">${STORE.meta.repository}</span>
        <span class="tcount">${nfmt(repoStat.total)}</span>
        <span class="tbar">${compactBar(repoStat)}</span>
      </button>`);
    host.appendChild(repoRow);

    const pkgs = STORE.packageList.slice().sort((a, b) => a.name.localeCompare(b.name));
    for (const pkg of pkgs) {
      const open = mapState.openPkgs.has(pkg.name);
      const stat = STORE.statOfPackage(pkg.name);
      const files = STORE.pkgFiles.get(pkg.name) || [];

      const node = el('div', 'tnode');
      setHTML(node, html`
        <button class="trow" data-act="pkg" data-pkg="${pkg.name}" aria-expanded="${open ? 'true' : 'false'}">
          <span class="caret">▸</span>
          <span class="tname">${pkg.name}</span>
          <span class="tcount">${nfmt(stat.total)}</span>
          <span class="tbar">${compactBar(stat)}</span>
        </button>`);
      host.appendChild(node);

      if (!open) continue;

      const filesBox = el('div', 'tfiles');
      host.appendChild(filesBox);

      const vh = clamp(files.length * 26, 52, 300);
      const listHost = el('div');
      listHost.style.height = vh + 'px';
      filesBox.appendChild(listHost);

      if (!files.length) {
        setHTML(listHost, html`<div class="muted-2" style="padding:6px">no files indexed</div>`);
        continue;
      }

      const list = VirtualList({
        host: listHost,
        rowHeight: 26,
        empty: html`<div class="muted-2" style="padding:6px">no files</div>`,
        render(i) {
          const fp = files[i];
          const f = STORE.fileByPath.get(fp);
          const fstat = STORE.statOfFile(fp);
          if (!f) return html``;
          const isSel = mapState.selFile === fp;
          return html`
            <div class="vrow ${isSel ? 'sel' : ''}" tabindex="0" role="button"
                 data-act="file" data-file="${fp}" title="${fp}">
              <span class="vr-main">
                <span class="vr-name">${baseName(fp)}</span>
                ${f.t ? html`<span class="chip test plain">test</span>` : ''}
                <span class="vr-path">${dirName(fp)}</span>
              </span>
              <span class="vr-right">
                <span class="muted-2 mono" style="font-size:10px">${fstat.covered || 0}/${fstat.total || 0}</span>
                <span class="tbar" style="width:44px;flex:0 0 44px">${compactBar(fstat)}</span>
              </span>
            </div>`;
        },
      });
      list.setCount(files.length);
      regList(list);
    }
  }

  const mounts = [];
  function regList(list) {
    if (list) mounts.push(list);
  }
  function destroyMounts() {
    while (mounts.length) {
      const m = mounts.pop();
      try { m.destroy(); } catch (e) { /* ignore */ }
    }
  }

  function renderDetail(host, sym, file) {
    if (!host) return;
    host.innerHTML = '';

    if (sym) {
      mountSymbolDetail(host, sym);
      return;
    }
    if (file) {
      mountFileDetail(host, file);
      return;
    }
    mountOverview(host);
  }

  function mountSymbolDetail(host, sym) {
    const stat = STORE.statOfSymbol(sym.id);
    const obs = STORE.obsBySymbol.get(sym.id) || [];
    const callers = STORE.callIn.get(sym.id) || [];
    const callees = STORE.callOut.get(sym.id) || [];
    const bestPath = bestPathForSymbol(STORE, sym.id);
    const pkgName = sym.p || (STORE.fileByPath.get(sym.f) || {}).p || '';

    const actions = html`
      <div class="btnrow">
        ${bestPath ? html`<a class="btn sm" href="#/debugger?path=${encodeURIComponent(bestPath.id)}">Trace path ${bestPath.id}</a>` : ''}
        <a class="btn sm" href="#/deps?symbol=${encodeURIComponent(sym.id)}">Impact</a>
        <a class="btn sm" href="#/atlas?file=${encodeURIComponent(sym.f)}">In atlas</a>
      </div>`;

    const head = el('div', 'detail');
    setHTML(head, html`
      ${crumbs([
        { label: STORE.meta.repository, hash: '#/map' },
        { label: pkgName || '(root)', hash: '#/map' },
        { label: baseName(sym.f), hash: '#/map?file=' + encodeURIComponent(sym.f) },
        { label: sym.n },
      ])}
      <div class="row" style="justify-content:space-between;align-items:flex-start">
        <h2>${sym.n}</h2>
        ${actions}
      </div>
      <div class="row">
        <span class="chip plain kind">${sym.k}</span>
        ${sym.x ? html`<span class="chip plain">exported</span>` : ''}
        ${sym.t ? html`<span class="chip test">test code</span>` : ''}
        ${sym.st ? html`<span class="chip plain">${sym.st}</span>` : ''}
      </div>
      <div class="kv">
        ${kpi('fan-in', nfmt(sym.i), 'callers')}
        ${kpi('fan-out', nfmt(sym.c), 'callees')}
        ${kpi('obligations', nfmt(stat.total), (stat.covered || 0) + ' covered')}
        ${kpi('branches', nfmt(sym.b))}
        ${kpi('complexity', nfmt(sym.q))}
        ${kpi('evidence', sym.e || '—')}
      </div>
      ${sym.doc ? html`<p class="doc">${sym.doc}</p>` : html`<p class="doc muted-2">No doc comment recorded for this declaration.</p>`}
      <div>
        <div class="subhead"><span>Evidence anchor</span><span class="mono">${sym.e || ''}</span></div>
        <pre class="anchor">${sym.a || '(no anchor in payload)'}</pre>
      </div>
      <div>
        <div class="subhead"><span>File</span><a href="#/map?file=${encodeURIComponent(sym.f)}">${sym.f}</a></div>
      </div>`);
    host.appendChild(head);

    /* obligations */
    const obPanel = panelShell('Obligations', '');
    const obListHost = el('div');
    obListHost.style.height = clamp(obs.length * 34, 60, 260) + 'px';
    obPanel.appendChild(obListHost);
    setHTML(obPanel.firstChild, html`<span class="ph-title">Obligations</span><span class="mono">${obs.length}</span>`);
    host.appendChild(obPanel);

    if (obs.length) {
      const v = VirtualList({
        host: obListHost,
        rowHeight: 34,
        render(i) {
          const o = obs[i];
          return html`<div class="vrow obrow" tabindex="0" role="button" data-act="ob" data-id="${o.id}"
                        title="${o.l} · ${o.t} · ${o.e}">
            <span class="stcol">${statusChip(o.st)}</span>
            <span class="obmain"><span class="lab">${o.l || '(no label)'}</span>
              <span class="obpath">${o.t} · ${o.n || 'symbol-level'} · ${o.e}</span></span>
            ${o.cat && o.cat !== 'none' ? html`<span class="chip risk">${o.cat}</span>` : ''}
            ${o.crit ? html`<span class="chip crit">c${o.crit}</span>` : ''}
          </div>`;
        },
      });
      v.setCount(obs.length);
      regList(v);
    } else {
      setHTML(obListHost, html`<div class="muted-2" style="padding:8px">No obligations recorded for this symbol.</div>`);
    }

    host.appendChild(edgePanel('Callers', callers, (e) => ({ id: e.a, via: e.k, w: e.n })));
    host.appendChild(edgePanel('Callees', callees, (e) => ({ id: e.b, via: e.k, w: e.n })));
  }

  function panelShell(title, right) {
    const p = el('div', 'panel');
    const headEl = el('div', 'panel-head');
    setHTML(headEl, html`<span class="ph-title">${title}</span>${right ? html`<span class="mono">${right}</span>` : ''}`);
    p.appendChild(headEl);
    return p;
  }

  function edgePanel(title, edges, mapFn) {
    const p = panelShell(title, edges.length + '');
    const body = el('div');
    body.style.height = clamp(edges.length * 26, 44, 180) + 'px';
    p.appendChild(body);
    if (!edges.length) {
      setHTML(body, html`<div class="muted-2" style="padding:8px">none resolved in this snapshot</div>`);
      return p;
    }
    const v = VirtualList({
      host: body,
      rowHeight: 26,
      render(i) {
        const info = mapFn(edges[i]);
        const target = STORE.symById.get(info.id);
        return html`<div class="vrow" tabindex="0" role="button" data-act="sym" data-id="${info.id}" title="${target ? target.f : info.id}">
          <span class="vr-main"><span class="vr-name">${target ? target.n : info.id}</span></span>
          <span class="vr-right"><span class="mono muted-2" style="font-size:10px">${info.via}</span></span>
        </div>`;
      },
    });
    v.setCount(edges.length);
    regList(v);
    return p;
  }

  function mountFileDetail(host, file) {
    const stat = STORE.statOfFile(file.f);
    const symIds = STORE.fileSymbols.get(file.f) || [];
    const pkgName = file.p || '';

    const head = el('div', 'detail');
    setHTML(head, html`
      ${crumbs([
        { label: STORE.meta.repository, hash: '#/map' },
        { label: pkgName || '(root)' },
        { label: baseName(file.f) },
      ])}
      <div class="row" style="justify-content:space-between;align-items:flex-start">
        <h2>${baseName(file.f)}</h2>
        <a class="btn sm" href="#/atlas?file=${encodeURIComponent(file.f)}">Explore in atlas</a>
      </div>
      <div class="row">
        ${file.t ? html`<span class="chip test">test code</span>` : ''}
        <span class="chip plain">${symIds.length} symbols</span>
        <span class="chip plain">${nfmt(file.l)} lines</span>
        <span class="chip plain">${pkgName}</span>
      </div>
      <div>${barStat(stat)}</div>
      <div class="mono muted" style="font-size:11px">${file.f}</div>`);
    host.appendChild(head);

    const p = panelShell('Symbols in file', symIds.length + '');
    const body = el('div');
    body.style.height = clamp(symIds.length * 26, 80, 380) + 'px';
    p.appendChild(body);
    host.appendChild(p);

    if (!symIds.length) {
      setHTML(body, html`<div class="muted-2" style="padding:8px">No symbols indexed for this file.</div>`);
      return;
    }

    const v = VirtualList({
      host: body,
      rowHeight: 26,
      render(i) {
        const s = STORE.symById.get(symIds[i]);
        if (!s) return html``;
        const st = STORE.statOfSymbol(s.id);
        return html`<div class="vrow" tabindex="0" role="button" data-act="sym" data-id="${s.id}">
          <span class="vr-main"><span class="vr-name">${s.n}</span>
            <span class="chip plain kind">${s.k}</span>
            ${s.x ? html`<span class="chip plain">x</span>` : ''}</span>
          <span class="vr-right"><span class="mono muted-2" style="font-size:10px">${st.covered || 0}/${st.total || 0}</span>
            <span style="width:44px;flex:0 0 44px">${compactBar(st)}</span></span>
        </div>`;
      },
    });
    v.setCount(symIds.length);
    regList(v);
  }

  function mountOverview(host) {
    const c = STORE.counts();
    const head = el('div', 'detail');
    setHTML(head, html`
      ${crumbs([{ label: STORE.meta.repository }])}
      <h2 style="font-size:15px">Snapshot overview</h2>
      <div class="kv">
        ${kpi('packages', nfmt(c.packages))}
        ${kpi('files', nfmt(c.files))}
        ${kpi('symbols', nfmt(c.symbols))}
        ${kpi('obligations', nfmt(c.obligations))}
        ${kpi('paths', nfmt(c.paths))}
        ${kpi('call edges', nfmt(c.calls))}
      </div>
      <div class="note info">
        Pick a file or symbol on the left. Counts come from the payload, not from this UI:
        obligation totals are the sum of <span class="mono">obligations[]</span> and may differ from the per-symbol
        <span class="mono">o</span> field if the analyzer capped output.
      </div>`);
    host.appendChild(head);

    const p = panelShell('Package coverage', STORE.packageList.length + '');
    const body = el('div', 'panel-body');
    setHTML(body, cat(STORE.packageList.slice().sort((a, b) => a.name.localeCompare(b.name)).map((pkg) => {
      const stat = STORE.statOfPackage(pkg.name);
      return html`<div class="row" style="justify-content:space-between;gap:10px;padding:4px 0;border-bottom:1px solid var(--line-soft)">
        <span class="mono" style="min-width:120px">${pkg.name}</span>
        <span style="flex:1 1 160px">${compactBar(stat, 'xs')}</span>
        <span class="mono muted-2" style="font-size:10px">${stat.covered || 0}/${stat.total || 0}</span>
      </div>`;
    })));
    p.appendChild(body);
    host.appendChild(p);

    const constellation = el('div', 'tmwrap');
    constellation.style.height = '230px';
    host.appendChild(constellation);

    const canvas = el('canvas', 'tmcanvas');
    canvas.tabIndex = 0;
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', 'Package constellation; bubble area is symbol count, colour is coverage');
    constellation.appendChild(canvas);
    const tip = el('div', 'tmtip');
    tip.hidden = true;
    constellation.appendChild(tip);

    let bubbles = [];
    const draw = () => {
      const w = constellation.clientWidth;
      const h = constellation.clientHeight;
      if (!w || !h) return;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      const ctx = canvas.getContext('2d');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      const pkgs = STORE.packageList;
      const maxSymbols = Math.max(1, ...pkgs.map((p) => p.symbols || 1));
      bubbles = pkgs.map((pkg) => {
        const [ax, ay] = hashPos(pkg.name);
        const stat = STORE.statOfPackage(pkg.name);
        const r = 12 + Math.sqrt((pkg.symbols || 1) / maxSymbols) * Math.min(w, h) * 0.15;
        return {
          pkg,
          x: clamp(28 + ax * (w - 56), r + 8, w - r - 8),
          y: clamp(28 + ay * (h - 56), r + 8, h - r - 18),
          r,
          cov: coverageOf(stat),
        };
      });

      for (const b of bubbles) {
        ctx.beginPath();
        ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
        ctx.fillStyle = coverageColor(b.cov, 0.22);
        ctx.fill();
        ctx.lineWidth = 1;
        ctx.strokeStyle = coverageColor(b.cov, 0.9);
        ctx.stroke();
        ctx.fillStyle = '#c7d3e2';
        ctx.font = '11px ui-monospace, monospace';
        ctx.textAlign = 'center';
        ctx.fillText(b.pkg.name.length > 16 ? b.pkg.name.slice(0, 15) + '…' : b.pkg.name, b.x, b.y + b.r + 13);
      }
    };

    const ro = new ResizeObserver(draw);
    ro.observe(constellation);
    requestAnimationFrame(draw);

    on(canvas, 'pointermove', (ev) => {
      const rect = canvas.getBoundingClientRect();
      const x = ev.clientX - rect.left;
      const y = ev.clientY - rect.top;
      const hit = bubbles.find((b) => Math.hypot(b.x - x, b.y - y) <= b.r + 2);
      if (!hit) { tip.hidden = true; return; }
      const stat = STORE.statOfPackage(hit.pkg.name);
      setHTML(tip, html`<b>${hit.pkg.name}</b><span>${hit.pkg.files} files · ${hit.pkg.symbols} symbols</span><br>
        <span>${stat.covered || 0}/${stat.total || 0} obligations · ${pct(hit.cov, 0)} covered</span>`);
      tip.style.left = Math.min(constellation.clientWidth - 220, x + 12) + 'px';
      tip.style.top = Math.max(4, y - 44) + 'px';
      tip.hidden = false;
    });
    on(canvas, 'pointerleave', () => { tip.hidden = true; });
    on(canvas, 'click', (ev) => {
      const rect = canvas.getBoundingClientRect();
      const x = ev.clientX - rect.left;
      const y = ev.clientY - rect.top;
      const hit = bubbles.find((b) => Math.hypot(b.x - x, b.y - y) <= b.r + 2);
      if (!hit) return;
      mapState.openPkgs.add(hit.pkg.name);
      mapState.sel = '';
      mapState.selFile = '';
      renderMap(new URLSearchParams());
      toast('expanded package ' + hit.pkg.name);
    });
    on(canvas, 'keydown', (ev) => {
      if (ev.key === 'Enter' || ev.key === ' ') {
        ev.preventDefault();
        if (bubbles[0]) {
          mapState.openPkgs.add(bubbles[0].pkg.name);
          rerender(() => renderMap(new URLSearchParams()));
        }
      }
    });
    reg(() => ro.disconnect());
  }

  /* ------------------------------------------------------------------ *
   * B. Coverage Atlas
   * ------------------------------------------------------------------ */

  const atlasState = {
    mode: 'treemap',
    filters: null,
    sel: '',
    drill: null,
    focusFile: '',
    openPkgs: new Set(),
  };

  function ensureFilters() {
    if (!atlasState.filters) atlasState.filters = createFilters(STORE);
    return atlasState.filters;
  }

  function pkgOfFile(fp) {
    const f = STORE.fileByPath.get(fp);
    if (f && f.p) return f.p;
    const m = /^packages\/([^/]+)\//.exec(fp || '');
    return m ? m[1] : fp ? dirName(fp) || '(root)' : '(root)';
  }

  function renderAtlas(params) {
    ensureFilters();
    const view = document.getElementById('view');
    const fileParam = params.get('file');
    if (fileParam && STORE.fileByPath.has(fileParam)) {
      atlasState.drill = { kind: 'file', file: fileParam };
      atlasState.focusFile = fileParam;
    }
    atlasState.mode = params.get('mode') === 'matrix' ? 'matrix' : atlasState.mode;

    view.innerHTML = '';
    const shell = el('div');
    setHTML(shell, html`
      ${viewHead(
        'Coverage atlas',
        'Obligation-weighted view of the repository. Every filter applies to the treemap, the matrix and the list below.',
        html`<div class="btnrow" role="group" aria-label="Atlas mode">
          <button class="btn sm ${atlasState.mode === 'treemap' ? 'primary' : ''}" data-act="mode" data-mode="treemap" aria-pressed="${atlasState.mode === 'treemap' ? 'true' : 'false'}">Treemap</button>
          <button class="btn sm ${atlasState.mode === 'matrix' ? 'primary' : ''}" data-act="mode" data-mode="matrix" aria-pressed="${atlasState.mode === 'matrix' ? 'true' : 'false'}">Matrix</button>
          <button class="btn sm ${atlasState.mode === 'list' ? 'primary' : ''}" data-act="mode" data-mode="list" aria-pressed="${atlasState.mode === 'list' ? 'true' : 'false'}">List</button>
        </div>`
      )}
      <div class="filterbar" id="filterbar"></div>
      <div class="atlasgrid">
        <section class="panel atlas-main" id="atlasMain"></section>
        <aside class="panel atlas-side" id="atlasSide"></aside>
      </div>
      <div class="panel" id="atlasListPanel" style="margin-top:12px">
        <div class="panel-head" id="atlasListHead"><span class="ph-title">Filtered obligations</span><span class="mono" id="atlasListCount"></span></div>
        <div id="atlasList"></div>
      </div>`);
    view.appendChild(shell);

    renderFilterBar();
    renderAtlasMain();
    renderAtlasSide();
    mountAtlasList();
    wireAtlas();
  }

  function renderFilterBar() {
    const host = document.getElementById('filterbar');
    if (!host) return;
    const f = currentFilters();
    const list = filterObligations(STORE, f);
    const statusCounts = new Map();
    const typeCounts = new Map();
    const riskCounts = new Map();
    for (const o of STORE.obligations) {
      statusCounts.set(o.st, (statusCounts.get(o.st) || 0) + 1);
      typeCounts.set(o.t, (typeCounts.get(o.t) || 0) + 1);
      riskCounts.set(o.cat, (riskCounts.get(o.cat) || 0) + 1);
    }
    const ratio = unknownRatio(list);

    const chipBtn = (group, value, active, count, cls, label) => html`
      <button class="chip ${cls || ''}" aria-pressed="${active ? 'true' : 'false'}" data-fgroup="${group}" data-fval="${value}"
              title="${count} obligations">${label || value} <span class="muted-2">${count}</span></button>`;

    setHTML(host, html`
      <div class="fgroup"><span class="flabel">Status</span>
        ${STATUSES.map((st) => chipBtn('statuses', st, f.statuses.has(st), statusCounts.get(st) || 0, 'st-' + st))}
      </div>
      <div class="fgroup"><span class="flabel">Type</span>
        ${Array.from(typeCounts.keys()).sort().map((t) => chipBtn('types', t, f.types.has(t), typeCounts.get(t), ''))}
      </div>
      <div class="fgroup"><span class="flabel">Risk</span>
        ${Array.from(riskCounts.keys()).sort().map((r) => chipBtn('risks', r, f.risks.has(r), riskCounts.get(r), ''))}
      </div>
      <div class="fgroup"><span class="flabel">Criticality</span>
        ${[1, 2, 3].map((c) => chipBtn('crit', String(c), f.crit.has(c), countCrit(c), 'crit', 'c' + c))}
      </div>
      <label class="switch"><input type="checkbox" id="includeTests" ${f.includeTests ? 'checked' : ''}> include test code</label>
      <button class="btn ghost sm" data-act="reset-filters">Reset filters</button>
      <div class="fcount">${nfmt(list.length)} / ${nfmt(STORE.obligations.length)} obligations · unknown ${pct(ratio)}</div>`);
  }

  function currentFilters() {
    return atlasState.filters || createFilters(STORE);
  }

  function countCrit(c) {
    let n = 0;
    for (const o of STORE.obligations) if ((o.crit || 1) === c) n += 1;
    return n;
  }

  function filteredFiles() {
    const f = ensureFilters();
    const list = filterObligations(STORE, f);
    const map = aggregate(list, (o) => o.f);
    const out = [];
    for (const [file, stat] of map) {
      out.push({ file, stat });
    }
    out.sort((a, b) => b.stat.total - a.stat.total || (a.file < b.file ? -1 : 1));
    return { list, files: out };
  }

  function renderAtlasMain() {
    const host = document.getElementById('atlasMain');
    if (!host) return;
    host.innerHTML = '';
    const mode = atlasState.mode;
    if (mode === 'matrix') {
      mountMatrix(host);
      return;
    }
    if (mode === 'list') {
      mountAtlasFileList(host);
      return;
    }
    if (atlasState.drill && atlasState.drill.kind === 'file') {
      mountDrill(host, atlasState.drill.file);
      return;
    }
    mountTreemap(host);
  }

  function mountTreemap(host) {
    const { files } = filteredFiles();
    const head = el('div', 'panel-head');
    setHTML(head, html`<span class="ph-title">Treemap · files sized by obligations, coloured by covered%</span>
      <span class="mono">${files.length} files</span>`);
    host.appendChild(head);

    const body = el('div', 'panel-body');
    host.appendChild(body);

    const wrap = el('div', 'tmwrap');
    body.appendChild(wrap);
    const canvas = el('canvas', 'tmcanvas');
    canvas.tabIndex = 0;
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', 'Coverage treemap: ' + files.length + ' files sized by filtered obligation count');
    wrap.appendChild(canvas);
    const tip = el('div', 'tmtip');
    tip.hidden = true;
    wrap.appendChild(tip);

    const legend = el('div', 'tmlegend');
    setHTML(legend, html`<span>0%</span>
      <span class="tmramp" style="background:linear-gradient(90deg, ${coverageColor(0)}, ${coverageColor(0.5)}, ${coverageColor(1)})"></span>
      <span>100% covered</span>
      <span class="muted-2">· click a cell to drill into its symbols</span>`);
    body.appendChild(legend);

    if (!files.length) {
      setHTML(wrap, html`<div class="empty" style="margin:0"><h2>No obligations match these filters</h2>
        <p>Widen the status/type/risk selection, or enable test code.</p></div>`);
      return;
    }

    const nodes = buildTreemapNodes(files);
    let rects = [];
    let selected = -1;

    const draw = () => {
      const w = wrap.clientWidth;
      const h = wrap.clientHeight;
      if (!w || !h) return;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      const ctx = canvas.getContext('2d');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      rects = squarify(nodes.map((n) => ({ key: n.key, value: n.value, node: n })), 0, 0, w, h);
      for (const r of rects) {
        const node = r.item.node;
        const cov = node.cov;
        ctx.fillStyle = coverageColor(cov, 0.4);
        ctx.fillRect(r.x, r.y, r.w, r.h);
        ctx.strokeStyle = 'rgba(4,8,12,.85)';
        ctx.lineWidth = 1;
        ctx.strokeRect(r.x + 0.5, r.y + 0.5, Math.max(0, r.w - 1), Math.max(0, r.h - 1));
        if (r.w > 54 && r.h > 20) {
          ctx.fillStyle = 'rgba(0,0,0,.55)';
          ctx.fillRect(r.x + 3, r.y + 3, Math.max(0, Math.min(r.w - 6, node.label.length * 6.1 + 6)), 14);
          ctx.fillStyle = '#e8eef7';
          ctx.font = '10px ui-monospace, monospace';
          ctx.textAlign = 'left';
          ctx.textBaseline = 'top';
          ctx.fillText(node.label, r.x + 6, r.y + 5, Math.max(0, r.w - 12));
        }
        if (r.w > 76 && r.h > 38) {
          ctx.fillStyle = 'rgba(230,238,247,.72)';
          ctx.font = '9.5px ui-monospace, monospace';
          ctx.fillText(node.value + ' obs · ' + pct(cov, 0), r.x + 6, r.y + 21, Math.max(0, r.w - 12));
        }
      }
      if (selected >= 0 && rects[selected]) {
        const r = rects[selected];
        ctx.strokeStyle = '#7cc4ff';
        ctx.lineWidth = 2;
        ctx.strokeRect(r.x + 1, r.y + 1, Math.max(0, r.w - 2), Math.max(0, r.h - 2));
      }
    };

    const hitAt = (x, y) => rects.findIndex((r) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h);

    const ro = new ResizeObserver(draw);
    ro.observe(wrap);
    requestAnimationFrame(draw);
    reg(() => ro.disconnect());

    on(canvas, 'pointermove', (ev) => {
      const box = canvas.getBoundingClientRect();
      const x = ev.clientX - box.left;
      const y = ev.clientY - box.top;
      const i = hitAt(x, y);
      if (i < 0) { tip.hidden = true; canvas.style.cursor = 'crosshair'; return; }
      const node = rects[i].item.node;
      canvas.style.cursor = 'pointer';
      setHTML(tip, html`<b>${node.label}</b><span>${node.full}</span><br>
        <span>${node.value} obligations · ${pct(node.cov, 0)} covered</span>`);
      tip.style.left = Math.min(wrap.clientWidth - 240, x + 12) + 'px';
      tip.style.top = Math.max(4, y - 40) + 'px';
      tip.hidden = false;
    });
    on(canvas, 'pointerleave', () => { tip.hidden = true; });
    on(canvas, 'click', (ev) => {
      const box = canvas.getBoundingClientRect();
      const i = hitAt(ev.clientX - box.left, ev.clientY - box.top);
      if (i < 0) return;
      selected = i;
      drillInto(rects[i].item.node);
    });
    on(canvas, 'keydown', (ev) => {
      if (!rects.length) return;
      if (ev.key === 'ArrowRight' || ev.key === 'ArrowDown') { ev.preventDefault(); selected = (selected + 1) % rects.length; draw(); }
      else if (ev.key === 'ArrowLeft' || ev.key === 'ArrowUp') { ev.preventDefault(); selected = (selected - 1 + rects.length) % rects.length; draw(); }
      else if (ev.key === 'Enter' && selected >= 0) { ev.preventDefault(); drillInto(rects[selected].item.node); }
    });

    function drillInto(node) {
      if (node.kind === 'rest') {
        atlasState.drill = { kind: 'rest', files: node.files };
        atlasState.focusFile = '';
        rerender(() => renderAtlas(new URLSearchParams()));
        return;
      }
      atlasState.drill = { kind: 'file', file: node.file };
      atlasState.focusFile = node.file;
      rerender(() => renderAtlas(new URLSearchParams()));
    }

    /* accessible / virtualised file table under the canvas */
    const listWrap = el('div');
    body.appendChild(listWrap);
    const lh = el('div', 'subhead');
    setHTML(lh, html`<span>Files by filtered obligations</span><span class="mono">top 200 shown · all ${files.length} scrollable</span>`);
    listWrap.appendChild(lh);
    const listHost = el('div');
    listHost.style.height = '200px';
    listWrap.appendChild(listHost);
    const v = VirtualList({
      host: listHost,
      rowHeight: 26,
      render(i) {
        const row = files[i];
        const f = STORE.fileByPath.get(row.file);
        return html`<div class="vrow" tabindex="0" role="button" data-act="tm-file" data-file="${row.file}" title="${row.file}">
          <span class="vr-main"><span class="vr-name">${baseName(row.file)}</span>
            <span class="vr-path">${dirName(row.file)}</span>
            ${f && f.t ? html`<span class="chip test plain">test</span>` : ''}</span>
          <span class="vr-right"><span class="mono muted-2" style="font-size:10px">${row.stat.total}</span>
            <span style="width:60px;flex:0 0 60px">${compactBar(row.stat)}</span></span>
        </div>`;
      },
    });
    v.setCount(files.length);
    regList(v);
  }

  function buildTreemapNodes(files) {
    const MAX = 220;
    const nodes = [];
    const rest = [];
    files.forEach((row, i) => {
      if (i < MAX - 1 || files.length <= MAX) {
        nodes.push({
          kind: 'file',
          key: row.file,
          file: row.file,
          label: baseName(row.file),
          full: row.file,
          value: row.stat.total,
          cov: coverageOf(row.stat),
        });
      } else {
        rest.push(row);
      }
    });
    if (rest.length) {
      const stat = emptyStat();
      for (const r of rest) addStat(stat, r.stat);
      nodes.push({
        kind: 'rest',
        key: '__rest',
        files: rest.map((r) => r.file),
        label: '+' + rest.length + ' files',
        full: 'aggregated small files',
        value: stat.total,
        cov: coverageOf(stat),
      });
    }
    return nodes;
  }

  function mountDrill(host, file) {
    const filtered = filterObligations(STORE, ensureFilters()).filter((o) => o.f === file);
    const stat = emptyStat();
    for (const o of filtered) { stat.total += 1; stat[o.st] += 1; }
    const symIds = STORE.fileSymbols.get(file) || [];

    const head = el('div', 'panel-head');
    setHTML(head, html`<span class="ph-title">Drill · ${baseName(file)}</span>
      <span class="mono">${symIds.length} symbols · ${filtered.length} filtered obligations</span>`);
    host.appendChild(head);

    const body = el('div', 'panel-body');
    host.appendChild(body);

    const bar = el('div', 'drillbar');
    setHTML(bar, html`
      <div class="row">
        <button class="btn sm" data-act="drill-back">← all files</button>
        <span class="mono muted-2" style="font-size:10.5px">${file}</span>
      </div>
      <div style="min-width:180px;flex:0 0 220px">${barStat(stat)}</div>`);
    body.appendChild(bar);

    if (!filtered.length) {
      body.appendChild(el('div', 'note', 'No filtered obligations in this file. The drill shows symbol coverage only when the file has matching obligations.'));
      return;
    }

    const bySym = aggregate(filtered, (o) => o.s);
    const cards = symIds
      .map((id) => ({ sym: STORE.symById.get(id), stat: bySym.get(id) }))
      .filter((x) => x.sym && x.stat)
      .sort((a, b) => b.stat.total - a.stat.total);

    if (!cards.length) {
      body.appendChild(el('div', 'note', 'The obligations in this file no longer resolve to indexed symbols (payload symbols[] may be truncated).'));
      return;
    }

    const grid = el('div', 'smgrid');
    body.appendChild(grid);
    const MAXC = 180;
    setHTML(grid, cat(cards.slice(0, MAXC).map(({ sym, stat: s }) => {
      const cov = coverageOf(s);
      return html`<button class="sm" data-act="sym" data-id="${sym.id}" title="${sym.n} · ${sym.k}">
        <span class="sm-name">${sym.n}</span>
        <span class="sm-meta"><span>${sym.k}</span><span>${s.covered}/${s.total} · ${pct(cov, 0)}</span></span>
        <span class="bar xs" role="img" aria-label="${s.covered} of ${s.total} covered">${STATUSES.map((st) => s[st] ? html`<i class="s-${st}" style="width:${(s[st] / s.total) * 100}%"></i>` : '')}</span>
      </button>`;
    })));
    if (cards.length > MAXC) {
      body.appendChild(el('div', 'muted-2', '+' + (cards.length - MAXC) + ' more symbols in this file not rendered (cap ' + MAXC + ')'));
    }
  }

  function mountAtlasFileList(host) {
    const { files } = filteredFiles();
    const head = el('div', 'panel-head');
    setHTML(head, html`<span class="ph-title">Files</span><span class="mono">${files.length}</span>`);
    host.appendChild(head);
    const listHost = el('div');
    listHost.style.height = '520px';
    host.appendChild(listHost);
    const v = VirtualList({
      host: listHost,
      rowHeight: 30,
      render(i) {
        const row = files[i];
        return html`<div class="vrow" tabindex="0" role="button" data-act="tm-file" data-file="${row.file}" title="${row.file}">
          <span class="vr-main"><span class="vr-name">${row.file}</span></span>
          <span class="vr-right"><span class="muted-2 mono" style="font-size:10px">${row.stat.covered}/${row.stat.total}</span>
            <span style="width:80px;flex:0 0 80px">${compactBar(row.stat)}</span>
            <span class="muted-2 mono" style="font-size:10px">${pct(coverageOf(row.stat), 0)}</span></span>
        </div>`;
      },
    });
    v.setCount(files.length);
    regList(v);
  }

  function mountMatrix(host) {
    const { list } = filteredFiles();
    const byPkg = aggregate(list, (o) => pkgOfFile(o.f));

    // one pass: package -> file -> stat (avoids O(packages × obligations))
    const filesByPkg = new Map();
    for (const o of list) {
      const pkg = pkgOfFile(o.f);
      let bucket = filesByPkg.get(pkg);
      if (!bucket) { bucket = new Map(); filesByPkg.set(pkg, bucket); }
      let st = bucket.get(o.f);
      if (!st) { st = emptyStat(); bucket.set(o.f, st); }
      st.total += 1;
      st[o.st] += 1;
    }
    const head = el('div', 'panel-head');
    setHTML(head, html`<span class="ph-title">Matrix · obligations by package × status</span><span class="mono">${byPkg.size} packages</span>`);
    host.appendChild(head);

    const body = el('div', 'panel-body');
    host.appendChild(body);
    const matrix = el('div', 'matrix');
    body.appendChild(matrix);

    const rows = Array.from(byPkg.entries()).sort((a, b) => (a[0] < b[0] ? -1 : 1));

    const headRow = el('div', 'mxrow head');
    setHTML(headRow, html`<span></span><span>package</span><span>covered / total</span><span>status mix</span><span>unknown</span>`);
    matrix.appendChild(headRow);

    for (const [pkg, stat] of rows) {
      const open = atlasState.openPkgs.has(pkg);
      const row = el('div', 'mxrow');
      row.setAttribute('role', 'button');
      row.tabIndex = 0;
      row.dataset.act = 'mx-pkg';
      row.dataset.pkg = pkg;
      row.setAttribute('aria-expanded', open ? 'true' : 'false');
      setHTML(row, html`
        <span class="mxcaret">${open ? '▾' : '▸'}</span>
        <span class="mxname">${pkg}</span>
        <span class="mono muted">${stat.covered || 0}/${stat.total}</span>
        <span>${compactBar(stat)}</span>
        <span class="mono" style="color:var(--unknown)">${stat.unknown || 0}</span>`);
      matrix.appendChild(row);

      if (!open) continue;

      const bucket = filesByPkg.get(pkg) || new Map();
      const fileRows = Array.from(bucket.entries())
        .map(([file, s]) => ({ file, stat: s }))
        .sort((a, b) => b.stat.total - a.stat.total);

      const wrap = el('div', 'mxchildren');
      const listHost = el('div');
      listHost.style.height = clamp(fileRows.length * 26, 52, 240) + 'px';
      wrap.appendChild(listHost);
      matrix.appendChild(wrap);

      const v = VirtualList({
        host: listHost,
        rowHeight: 26,
        render(i) {
          const r = fileRows[i];
          return html`<div class="vrow" tabindex="0" role="button" data-act="tm-file" data-file="${r.file}" title="${r.file}">
            <span class="vr-main"><span class="vr-name">${baseName(r.file)}</span></span>
            <span class="vr-right"><span class="muted-2 mono" style="font-size:10px">${r.stat.covered}/${r.stat.total}</span>
              <span style="width:66px;flex:0 0 66px">${compactBar(r.stat)}</span></span>
          </div>`;
        },
      });
      v.setCount(fileRows.length);
      regList(v);
    }

    if (!rows.length) {
      body.appendChild(el('div', 'note', 'No obligations survive the current filters.'));
    }
  }

  function renderAtlasSide() {
    const host = document.getElementById('atlasSide');
    if (!host) return;
    host.innerHTML = '';
    const head = el('div', 'panel-head');
    setHTML(head, html`<span class="ph-title">${atlasState.sel ? 'Learning route' : 'Atlas summary'}</span>
      <span class="mono">${atlasState.sel ? 'obligation' : 'filtered set'}</span>`);
    host.appendChild(head);
    const body = el('div', 'panel-body');
    host.appendChild(body);

    if (atlasState.sel) {
      const ob = STORE.obById.get(atlasState.sel);
      if (!ob) {
        setHTML(body, html`<div class="note">That obligation id is not in this payload.</div>`);
        return;
      }
      const route = buildLearningRoute(STORE, ob);
      const sym = route.symbol;
      const path = route.pathId ? STORE.pathById.get(route.pathId) : null;
      setHTML(body, html`
        <div class="routecard">
          <div class="rc-title">${ob.st === 'covered' ? 'Covered obligation' : 'Learning route'}</div>
          <div class="row">${statusChip(ob.st)}<span class="chip plain kind">${ob.t}</span>${ob.crit ? html`<span class="chip crit">criticality ${ob.crit}</span>` : ''}${ob.cat && ob.cat !== 'none' ? html`<span class="chip risk">${ob.cat}</span>` : ''}</div>
          <div class="rc-ob">${ob.l || '(no label)'}</div>
          <div class="mono muted-2" style="font-size:10.5px">${ob.f}</div>
          ${ob.r ? html`<div class="note info" style="font-size:10.5px">reason: ${ob.r}</div>` : ''}

          <div class="rc-title" style="margin-top:2px">Call chain to an entry point</div>
          ${route.chain.length
            ? html`<ol class="rc-chain">${route.chain.map((id, i) => {
                const s = STORE.symById.get(id);
                return html`<li>
                  <span class="idx">${String(i).padStart(2, '0')}</span>
                  <span class="sym" title="${s ? s.f : id}">${s ? s.n : id}</span>
                  ${i === route.chain.length - 1 ? html`<span class="chip plain">obligation owner</span>` : ''}
                  ${s && s.st === 'entry' ? html`<span class="chip plain">entry</span>` : ''}
                </li>`;
              })}</ol>`
            : html`<div class="rc-note">No caller chain reaches a symbol marked <span class="mono">st: "entry"</span>. This obligation is either unreachable under the model or its callers were capped out of the payload.</div>`}

          <div class="rc-entry">parent symbol: ${sym ? sym.n : ob.s} · ${sym ? sym.k : 'unresolved'}</div>
          ${path ? html`<div class="rc-entry">best path: ${path.id} · ${path.title} · tier ${path.tier}</div>` : html`<div class="rc-note">No path in paths[] contains this symbol.</div>`}

          <div class="btnrow">
            <button class="btn sm primary" data-act="trace" data-path="${route.pathId}" title="${route.pathId ? 'path ' + route.pathId : 'no path in paths[] contains this symbol'}">Trace in Debugger</button>
            ${sym ? html`<a class="btn sm" href="#/deps?symbol=${encodeURIComponent(sym.id)}">Impact</a>` : ''}
          </div>
          <div class="rc-note">Route order: obligation → owning symbol → callers → entry point, derived from <span class="mono">calls[]</span> only.</div>
        </div>`);
      return;
    }

    const { list, files } = filteredFiles();
    const stat = emptyStat();
    for (const o of list) { stat.total += 1; stat[o.st] += 1; }
    const ratio = unknownRatio(list);
    const top = files.slice(0, 6);
    setHTML(body, html`
      <div style="display:flex;flex-direction:column;gap:10px">
        <div>${barStat(stat, { size: 'lg' })}</div>
        <div class="row" style="justify-content:space-between">
          <span class="muted">filtered obligations</span><b class="mono">${nfmt(list.length)}</b>
        </div>
        <div class="row" style="justify-content:space-between">
          <span class="muted">unknown ratio</span><b class="mono" style="color:var(--unknown)">${pct(ratio)}</b>
        </div>
        <div class="row" style="justify-content:space-between">
          <span class="muted">files touched</span><b class="mono">${files.length}</b>
        </div>
        <div class="subhead"><span>Top files</span><span class="mono">${files.length ? 'by obligations' : ''}</span></div>
        ${top.length ? cat(top.map((r) => html`<div class="row" style="justify-content:space-between;gap:8px">
          <button class="linkbtn" data-act="tm-file" data-file="${r.file}" title="${r.file}">${baseName(r.file)}</button>
          <span class="mono muted-2" style="font-size:10px">${r.stat.total}</span>
        </div>`)) : html`<div class="muted-2">nothing matches</div>`}
        <div class="note info" style="font-size:10.5px">Select any obligation row below to build its learning route.</div>
      </div>`);
  }

  function mountAtlasList() {
    const host = document.getElementById('atlasList');
    const countHost = document.getElementById('atlasListCount');
    const headHost = document.getElementById('atlasListHead');
    if (!host) return;
    host.innerHTML = '';
    const f = ensureFilters();
    let list = filterObligations(STORE, f);
    if (atlasState.focusFile) list = list.filter((o) => o.f === atlasState.focusFile);
    list.sort((a, b) => (b.crit || 1) - (a.crit || 1) || (a.f < b.f ? -1 : a.f > b.f ? 1 : a.id < b.id ? -1 : 1));

    if (countHost) {
      setHTML(countHost, html`${nfmt(list.length)} rows${atlasState.focusFile ? html` · focused on ${baseName(atlasState.focusFile)}` : ''}`);
    }
    if (headHost && atlasState.focusFile) {
      setHTML(headHost, html`<span class="ph-title">Filtered obligations</span>
        <span class="row" style="gap:8px">
          <span class="chip plain">file: ${baseName(atlasState.focusFile)}</span>
          <button class="btn sm ghost" data-act="clear-focus">clear focus</button>
        </span>`);
    } else if (headHost) {
      setHTML(headHost, html`<span class="ph-title">Filtered obligations</span><span class="mono" id="atlasListCount"></span>`);
      const c2 = document.getElementById('atlasListCount');
      if (c2) c2.textContent = nfmt(list.length) + ' rows';
    }

    const listHost = el('div');
    listHost.style.height = '320px';
    host.appendChild(listHost);

    if (!list.length) {
      setHTML(listHost, html`<div class="note" style="margin:10px">No obligations match the active filters.</div>`);
      return;
    }

    const v = VirtualList({
      host: listHost,
      rowHeight: 36,
      empty: html`<div class="muted-2" style="padding:10px">no rows</div>`,
      render(i) {
        const o = list[i];
        const sym = STORE.symById.get(o.s);
        return html`<div class="vrow obrow ${atlasState.sel === o.id ? 'sel' : ''}" tabindex="0" role="button"
                     data-act="ob" data-id="${o.id}" title="${o.l}">
          <span>${statusChip(o.st)}</span>
          <span class="obmain"><span class="lab">${o.l || '(no label)'}</span>
            <span class="obpath">${sym ? sym.n : o.s} · ${o.f}</span></span>
          <span class="chip plain kind">${o.t}</span>
          ${o.cat && o.cat !== 'none' ? html`<span class="chip risk">${o.cat}</span>` : ''}
          <span class="mono muted-2" style="font-size:10px">c${o.crit || 1}</span>
        </div>`;
      },
    });
    v.setCount(list.length);
    regList(v);
    if (atlasState.sel) {
      const idx = list.findIndex((o) => o.id === atlasState.sel);
      if (idx >= 0) v.scrollToIndex(idx);
    }
  }

  function wireAtlas() {
    const view = document.getElementById('view');
    on(view, 'click', (ev) => {
      const target = ev.target.closest('[data-act]');
      if (!target) return;
      const act = target.dataset.act;

      if (act === 'mode') {
        atlasState.mode = target.dataset.mode;
        atlasState.drill = null;
        atlasState.focusFile = '';
        atlasState.sel = '';
        rerender(() => renderAtlas(new URLSearchParams()));
        return;
      }
      if (act === 'ob') {
        atlasState.sel = target.dataset.id;
        renderAtlasSide();
        const row = target;
        row.classList.add('sel');
        return;
      }
      if (act === 'trace') {
        const path = target.dataset.path;
        if (path) go('#/debugger?path=' + encodeURIComponent(path));
        else toast('no path in this payload contains that symbol');
        return;
      }
      if (act === 'tm-file') {
        atlasState.drill = { kind: 'file', file: target.dataset.file };
        atlasState.focusFile = target.dataset.file;
        atlasState.sel = '';
        rerender(() => renderAtlas(new URLSearchParams()));
        return;
      }
      if (act === 'drill-back') {
        atlasState.drill = null;
        atlasState.focusFile = '';
        atlasState.sel = '';
        rerender(() => renderAtlas(new URLSearchParams()));
        return;
      }
      if (act === 'clear-focus') {
        atlasState.focusFile = '';
        atlasState.drill = null;
        rerender(() => renderAtlas(new URLSearchParams()));
        return;
      }
      if (act === 'sym') {
        go('#/map?symbol=' + encodeURIComponent(target.dataset.id));
        return;
      }
      if (act === 'mx-pkg') {
        const pkg = target.dataset.pkg;
        if (atlasState.openPkgs.has(pkg)) atlasState.openPkgs.delete(pkg);
        else atlasState.openPkgs.add(pkg);
        rerender(() => renderAtlas(new URLSearchParams()));
        return;
      }
      if (act === 'reset-filters') {
        atlasState.filters = createFilters(STORE);
        atlasState.sel = '';
        rerender(() => renderAtlas(new URLSearchParams()));
      }
    });

    on(view, 'change', (ev) => {
      const t = ev.target;
      if (t && t.id === 'includeTests') {
        ensureFilters().includeTests = !!t.checked;
        atlasState.sel = '';
        rerender(() => renderAtlas(new URLSearchParams()));
      }
    });

    on(document.getElementById('filterbar'), 'click', (ev) => {
      const btn = ev.target.closest('[data-fgroup]');
      if (!btn) return;
      const f = ensureFilters();
      const group = btn.dataset.fgroup;
      const val = btn.dataset.fval;
      if (group === 'crit') {
        const c = Number(val);
        if (f.crit.has(c)) f.crit.delete(c); else f.crit.add(c);
      } else if (f[group]) {
        if (f[group].has(val)) f[group].delete(val); else f[group].add(val);
      }
      atlasState.sel = '';
      rerender(() => renderAtlas(new URLSearchParams()));
    });
  }


  /* ------------------------------------------------------------------ *
   * C. Execution Debugger
   * ------------------------------------------------------------------ */

  const dbgState = { pathId: '', index: -1, timer: 0 };

  function stopContinue() {
    if (dbgState.timer) {
      clearInterval(dbgState.timer);
      dbgState.timer = 0;
    }
    const b = document.querySelector('[data-act="continue"]');
    if (b) b.textContent = 'Continue';
    const b2 = document.querySelector('[data-act="continue"]');
    if (b2) b2.setAttribute('aria-pressed', 'false');
  }

  function isTyping(node) {
    if (!node) return false;
    const tag = node.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || node.isContentEditable === true;
  }

  function outcomeChip(value) {
    return html`<span class="chip plain" title="branch outcome taken">${value || '—'}</span>`;
  }

  function renderDebugger(params) {
    const view = document.getElementById('view');
    const paramId = params.get('path') || '';
    let path = STORE.pathById.get(paramId);
    if (!path && STORE.paths.length) path = STORE.paths[0];

    if (!path) {
      setHTML(view, html`
        ${viewHead('Execution debugger', 'Replay a recorded path step by step.')}
        <div class="note bad">paths[] is empty in this payload — the analyzer emitted no path witness, so there is nothing to replay.</div>`);
      return;
    }

    if (dbgState.pathId !== path.id) {
      dbgState.pathId = path.id;
      dbgState.index = -1;
    }
    dbgState.index = clamp(dbgState.index, -1, path.steps.length - 1);

    const steps = path.steps;
    const entrySym = STORE.symById.get(path.entry) || STORE.symById.get(steps[0] && steps[0].s) || null;

    view.innerHTML = '';
    const shell = el('div');
    setHTML(shell, html`
      ${viewHead(
        'Execution debugger',
        'Each row is a recorded step. Steps not yet taken stay visible but dimmed — the trace is never truncated by the cursor.',
        html`<span class="mono muted">${steps.length} steps · tier ${path.tier}</span>
          <button class="btn sm" data-act="print" title="print this trace">Print</button>`
      )}
      <div class="dbggrid">
        <aside class="panel dbg-paths">
          <div class="panel-head"><span class="ph-title">Paths</span><span class="mono">${STORE.paths.length}</span></div>
          <div id="pathList"></div>
        </aside>
        <section class="panel dbg-trace">
          <div class="panel-head"><span class="ph-title">${path.title}</span><span class="mono">${path.id}</span></div>
          <div class="controls" id="dbgControls">
            <button class="btn sm" data-act="start" title="go to the first step">Start</button>
            <button class="btn sm" data-act="into" title="advance one step (space)">Step Into</button>
            <button class="btn sm" data-act="over" title="advance to the next distinct symbol">Step Over</button>
            <button class="btn sm" data-act="continue" title="animate to the end, 600ms per step">Continue</button>
            <button class="btn sm" data-act="prev" title="previous step (←)">Previous Step</button>
            <button class="btn sm ghost" data-act="reset">Reset</button>
            <span class="spacer"></span>
            <span class="status" id="dbgStatus"></span>
          </div>
          ${(STORE.storylinesByPath.get(path.id) || []).length ? (function () {
            const story = STORE.storylinesByPath.get(path.id)[0];
            return html`<details class="storyline" style="border-bottom:1px solid var(--line-soft)">
              <summary style="padding:7px 11px;cursor:pointer;font-size:11px;color:var(--muted)">Narrative · ${story.title}</summary>
              <div style="padding:0 12px 10px;display:flex;flex-direction:column;gap:6px">
                <div class="muted" style="font-size:11.5px">${story.premise}</div>
                ${story.acts.map((act) => html`<div>
                  <div class="mono" style="font-size:10.5px;color:var(--accent-ink)">Act ${act.n} · ${act.title}</div>
                  <div class="muted-2" style="font-size:11px">${act.body}</div>
                </div>`)}
              </div>
            </details>`;
          })() : ''}
          <div class="tracewrap"><div id="trace" class="trace"></div></div>
          <div class="sr-only" id="dbgAnnounce" aria-live="polite"></div>
        </section>
        <aside class="dbg-panels" id="dbgPanels"></aside>
      </div>`);
    view.appendChild(shell);

    /* path list */
    const pathHost = document.getElementById('pathList');
    pathHost.style.height = '100%';
    const pathList = VirtualList({
      host: pathHost,
      rowHeight: 44,
      render(i) {
        const p = STORE.paths[i];
        const isCur = p.id === path.id;
        return html`<div class="vrow ${isCur ? 'sel' : ''}" tabindex="0" role="button" data-act="path" data-path="${p.id}">
          <span class="vr-main" style="flex-direction:column;align-items:flex-start;gap:0">
            <span class="vr-name">${p.title}</span>
            <span class="vr-path">${p.id} · ${p.steps.length} steps · tier ${p.tier}</span>
          </span>
          ${isMarked('paths', p.id) ? html`<span class="chip plain" title="explored">✓</span>` : ''}
        </div>`;
      },
    });
    pathList.setCount(STORE.paths.length);
    regList(pathList);
    const curIdx = STORE.paths.findIndex((p) => p.id === path.id);
    if (curIdx >= 0) pathList.scrollToIndex(curIdx);

    /* trace */
    const traceHost = document.getElementById('trace');
    const traceList = VirtualList({
      host: traceHost,
      rowHeight: 64,
      render(i) {
        const step = steps[i];
        const sym = STORE.symById.get(step.s);
        const state = i === dbgState.index ? 'current' : i < dbgState.index ? 'taken' : 'pending';
        return html`<div class="vrow ${state}" data-act="step" data-i="${i}" tabindex="0" role="button"
                     title="${sym ? sym.f : step.f}">
          <span class="step-grid">
            <span class="idx">${String(i + 1).padStart(2, '0')}</span>
            <span>
              <span class="sname">${sym ? sym.n : step.s}</span>
              <span class="sfile">${step.f || (sym ? sym.f : '')}</span>
              <span class="slabel">${step.l || '(no label)'}</span>
            </span>
            <span class="sright">${outcomeChip(step.o)}${sym && sym.st === 'entry' ? html`<span class="chip plain">entry</span>` : ''}</span>
          </span>
        </div>`;
      },
    });
    traceList.setCount(steps.length);
    regList(traceList);

    const announce = document.getElementById('dbgAnnounce');
    const statusEl = document.getElementById('dbgStatus');
    const contBtn = document.querySelector('[data-act="continue"]');

    function coveredSoFar() {
      const seen = new Set();
      for (let i = 0; i <= dbgState.index && i < steps.length; i++) seen.add(steps[i].s);
      const list = [];
      for (const id of path.covers) {
        const ob = STORE.obById.get(id);
        if (ob && seen.has(ob.s)) list.push(ob);
      }
      return list;
    }

    function paintPanels() {
      const host = document.getElementById('dbgPanels');
      if (!host) return;
      const step = dbgState.index >= 0 ? steps[dbgState.index] : null;
      const sym = step ? STORE.symById.get(step.s) : null;
      const ob = step ? findStepObligation(step) : null;
      const covered = coveredSoFar();

      host.innerHTML = '';

      /* call stack */
      const stackRows = [];
      for (let i = dbgState.index; i >= 0; i--) {
        const st = steps[i];
        const s = STORE.symById.get(st.s);
        const depth = dbgState.index - i;
        stackRows.push(html`<div class="mini-row">
          <span class="mi">${depth}</span>
          <button class="linkbtn mname" data-act="step" data-i="${i}" title="${st.f}">${s ? s.n : st.s}</button>
          <span class="mono muted-2" style="font-size:9px">${String(i + 1).padStart(2, '0')}</span>
        </div>`);
      }
      host.appendChild(panelBlock('Call stack', dbgState.index < 0
        ? html`<div class="muted-2">not started</div>`
        : html`<div class="mini-list">${stackRows.slice(0, 40)}</div>${stackRows.length > 40 ? html`<div class="muted-2" style="font-size:10px">+${stackRows.length - 40} earlier frames</div>` : ''}`));

      /* branch inspector */
      host.appendChild(panelBlock('Branch inspector', step
        ? html`<div style="display:flex;flex-direction:column;gap:6px">
            <div class="row">${statusChip(ob ? ob.st : 'unknown')}${outcomeChip(step.o)}</div>
            <div class="mono" style="font-size:11px">${step.l || '(no label)'}</div>
            <div class="muted" style="font-size:11px">${ob
              ? 'Obligation ' + ob.id + ' · type ' + ob.t + ' · node ' + (ob.n || 'symbol-level') + (ob.crit ? ' · criticality ' + ob.crit : '')
              : 'No obligation in obligations[] matches this step (symbol + node + outcome).'}</div>
            ${ob && ob.r ? html`<div class="note info" style="font-size:10.5px">reason: ${ob.r}</div>` : ''}
            ${ob && !ob.r ? html`<div class="muted-2" style="font-size:10.5px">why: ${ob.st === 'covered'
              ? 'a static path witness reaches this step from an entry point'
              : ob.st === 'unknown'
                ? 'static analysis cannot decide this step (no reason string emitted)'
                : 'no reason recorded in obligations[] for this status'}</div>` : ''}
            ${ob && ob.p != null ? html`<div class="mono muted-2" style="font-size:10px">static feasibility p = ${Number(ob.p).toFixed(2)}</div>` : ''}
          </div>`
        : html`<div class="muted-2">step to a node to inspect its branch</div>`));

      /* evidence */
      host.appendChild(panelBlock('Evidence', sym
        ? html`<div style="display:flex;flex-direction:column;gap:6px">
            <div class="mono muted-2" style="font-size:10px">${sym.e || 'no evidence id'}</div>
            <pre class="anchor" style="max-height:96px">${sym.a || '(no anchor)'}</pre>
            <button class="linkbtn" data-act="sym" data-id="${sym.id}">${sym.n} → open in map</button>
          </div>`
        : html`<div class="muted-2">no current symbol</div>`));

      /* data flow */
      const outs = sym ? (STORE.callOut.get(sym.id) || []) : [];
      const ins = sym ? (STORE.callIn.get(sym.id) || []) : [];
      host.appendChild(panelBlock('Data flow', sym
        ? html`<div style="display:flex;flex-direction:column;gap:5px">
            <div class="mono muted-2" style="font-size:10px">${ins.length} in · ${outs.length} out</div>
            <div class="mini-list">
              ${outs.slice(0, 8).map((e) => {
                const t = STORE.symById.get(e.b);
                return html`<div class="mini-row"><span class="mi">out</span>
                  <button class="linkbtn mname" data-act="sym" data-id="${e.b}">${t ? t.n : e.b}</button>
                  <span class="mono muted-2" style="font-size:9px">${e.k}</span></div>`;
              })}
              ${ins.slice(0, 4).map((e) => {
                const t = STORE.symById.get(e.a);
                return html`<div class="mini-row"><span class="mi">in</span>
                  <button class="linkbtn mname" data-act="sym" data-id="${e.a}">${t ? t.n : e.a}</button>
                  <span class="mono muted-2" style="font-size:9px">${e.k}</span></div>`;
              })}
            </div>
            ${!outs.length && !ins.length ? html`<div class="muted-2" style="font-size:10.5px">no call edges recorded for this symbol</div>` : ''}
          </div>`
        : html`<div class="muted-2">no current symbol</div>`));

      /* covered obligations */
      const inPayload = path.covers.filter((id) => STORE.obById.has(id));
      const missed = path.covers.length - inPayload.length;
      host.appendChild(panelBlock('Obligations covered', html`
        <div style="display:flex;flex-direction:column;gap:6px">
          <div class="counter"><span class="countbig">${covered.length}</span><small>/ ${inPayload.length} witness obligations in this payload</small></div>
          <div class="row" style="gap:4px">
            ${covered.slice(0, 10).map((o) => html`<span class="chip st-covered" title="${o.l}">${o.id}</span>`)}
            ${covered.length > 10 ? html`<span class="chip plain">+${covered.length - 10}</span>` : ''}
          </div>
          <div class="muted-2" style="font-size:10.5px">${dbgState.index < 0
            ? 'not started · step through the trace to count obligations as you reach them'
            : missed > 0
              ? missed + ' more witness obligation(s) exist beyond the payload slice · ' + path.covers.length + ' total on the path'
              : 'every witness obligation on this path is present · ' + path.covers.length + ' total'}</div>
        </div>`));
    }

    function findStepObligation(step) {
      const list = STORE.obsBySymbol.get(step.s) || [];
      let exact = null;
      let byOutcome = null;
      for (const o of list) {
        if (o.n && step.n && o.n === step.n && o.o === step.o) { exact = o; break; }
        if (!byOutcome && o.o === step.o) byOutcome = o;
      }
      return exact || byOutcome || null;
    }

    function sync() {
      const atEnd = dbgState.index >= steps.length - 1;
      const started = dbgState.index >= 0;
      const set = (act, disabled) => {
        const b = document.querySelector('[data-act="' + act + '"]');
        if (b) b.disabled = !!disabled;
      };
      set('start', started);
      set('into', atEnd);
      set('over', atEnd);
      set('prev', !started);
      set('reset', !started);
      set('continue', atEnd);
      if (contBtn) {
        contBtn.textContent = dbgState.timer ? 'Stop' : 'Continue';
        contBtn.setAttribute('aria-pressed', dbgState.timer ? 'true' : 'false');
      }
      if (statusEl) {
        statusEl.textContent = started
          ? 'step ' + (dbgState.index + 1) + ' / ' + steps.length
          : 'ready · ' + steps.length + ' steps';
      }
      traceList.refresh();
      if (started) traceList.scrollToIndex(dbgState.index);
      paintPanels();
      if (started) {
        const step = steps[dbgState.index];
        const sym = STORE.symById.get(step.s);
        if (announce) {
          announce.textContent = 'Step ' + (dbgState.index + 1) + ' of ' + steps.length + ': ' +
            (sym ? sym.n : step.s) + ', outcome ' + (step.o || 'unknown');
        }
      }
      if (atEnd && steps.length) {
        const first = mark('paths', path.id);
        if (first) toast('path ' + path.id + ' marked explored');
      }
    }

    function stepInto() {
      if (dbgState.index >= steps.length - 1) return;
      dbgState.index += 1;
      sync();
    }

    function stepPrev() {
      if (dbgState.index <= 0) { dbgState.index = -1; }
      else dbgState.index -= 1;
      sync();
    }

    function stepOver() {
      if (dbgState.index >= steps.length - 1) return;
      if (dbgState.index < 0) { dbgState.index = 0; sync(); return; }
      const cur = steps[dbgState.index].s;
      let i = dbgState.index + 1;
      while (i < steps.length - 1 && steps[i].s === cur) i += 1;
      dbgState.index = i;
      sync();
    }

    function continueRun() {
      if (dbgState.timer) { stopContinue(); sync(); return; }
      if (dbgState.index >= steps.length - 1) return;
      if (dbgState.index < 0) { dbgState.index = 0; sync(); }
      dbgState.timer = setInterval(() => {
        if (dbgState.index >= steps.length - 1) {
          stopContinue();
          sync();
          return;
        }
        dbgState.index += 1;
        sync();
      }, CONTINUE_MS);
      sync();
    }

    /* wire controls (delegated so the buttons can be re-created freely) */
    const viewEl = document.getElementById('view');
    on(viewEl, 'click', (ev) => {
      const target = ev.target.closest('[data-act]');
      if (!target) return;
      const act = target.dataset.act;
      if (act === 'start') { dbgState.index = 0; sync(); }
      else if (act === 'into') stepInto();
      else if (act === 'over') stepOver();
      else if (act === 'prev') stepPrev();
      else if (act === 'reset') { stopContinue(); dbgState.index = -1; sync(); }
      else if (act === 'continue') continueRun();
      else if (act === 'step') { dbgState.index = clamp(Number(target.dataset.i), 0, steps.length - 1); sync(); }
      else if (act === 'path') {
        stopContinue();
        dbgState.index = -1;
        go('#/debugger?path=' + encodeURIComponent(target.dataset.path));
      } else if (act === 'sym') {
        go('#/map?symbol=' + encodeURIComponent(target.dataset.id));
      } else if (act === 'print') {
        window.print();
      }
    });

    on(document, 'keydown', (ev) => {
      if (isTyping(ev.target)) return;
      if (ev.key === ' ' || ev.key === 'Spacebar') { ev.preventDefault(); stepInto(); }
      else if (ev.key === 'ArrowLeft') { ev.preventDefault(); stepPrev(); }
    });

    reg(stopContinue);
    sync();
  }

  function panelBlock(title, body) {
    const p = el('div', 'panel');
    const head = el('div', 'panel-head');
    setHTML(head, html`<span class="ph-title">${title}</span>`);
    p.appendChild(head);
    const b = el('div', 'panel-body');
    if (typeof body === 'string' || (body && body[RAW] != null)) setHTML(b, body);
    else if (body) b.appendChild(body);
    p.appendChild(b);
    return p;
  }

  /* ------------------------------------------------------------------ *
   * D. Dependency & Impact Explorer
   * ------------------------------------------------------------------ */

  const depsState = { id: '', openUp: -1, openDown: -1 };

  function renderDeps(params) {
    const view = document.getElementById('view');
    const wanted = params.get('symbol') || depsState.id;
    const sym = STORE.symById.get(wanted) || null;
    if (wanted) depsState.id = wanted;

    view.innerHTML = '';
    const shell = el('div');
    setHTML(shell, html`
      ${viewHead(
        'Dependency & impact',
        'Upstream = callers (transitive, depth ' + DEP_DEPTH + '). Downstream = consumers. Tests are reachability over t===true symbols.',
        ''
      )}
      <div class="panel" style="margin-bottom:12px">
        <div class="panel-head"><span class="ph-title">Symbol</span><span class="mono">${STORE.symbols.length} indexed</span></div>
        <div class="panel-body">
          <div class="picker">
            <div class="combo" style="flex:1 1 360px">
              <input id="depInput" type="search" placeholder="search a symbol to analyse…" autocomplete="off"
                     spellcheck="false" role="combobox" aria-expanded="false" aria-controls="depResults"
                     value="${sym ? sym.n : ''}">
              <div class="results" id="depResults" role="listbox" hidden></div>
            </div>
            <a class="btn sm" href="#/map">browse map</a>
            ${sym ? html`<button class="btn sm ghost" data-act="clear-dep">clear</button>` : ''}
          </div>
        </div>
      </div>
      <div id="depsBody"></div>`);
    view.appendChild(shell);

    const input = document.getElementById('depInput');
    const list = document.getElementById('depResults');
    if (input && list) {
      mountCombo({
        input,
        list,
        emptyText: 'no symbol matches',
        getItems(q) {
          return fuzzySearch(STORE, q, 30).map((hit) => ({
            key: hit.s.id,
            name: hit.s.n,
            meta: hit.s.k,
            path: fileLabel(hit.s.f),
            sym: hit.s,
          }));
        },
        onPick(item) {
          if (!item || !item.sym) return;
          go('#/deps?symbol=' + encodeURIComponent(item.sym.id));
        },
      });
    }

    const body = document.getElementById('depsBody');
    if (!sym) {
      mountDepsPicker(body);
      return;
    }

    mountDepsDetail(body, sym);

    on(document.getElementById('view'), 'click', (ev) => {
      const t = ev.target.closest('[data-act]');
      if (!t) return;
      const act = t.dataset.act;
      if (act === 'clear-dep') { depsState.id = ''; depsState.openUp = -1; depsState.openDown = -1; go('#/deps'); }
      else if (act === 'depth') {
        const dir = t.dataset.dir;
        const d = Number(t.dataset.d);
        if (dir === 'up') depsState.openUp = depsState.openUp === d ? -1 : d;
        else depsState.openDown = depsState.openDown === d ? -1 : d;
        rerender(() => renderDeps(new URLSearchParams('symbol=' + encodeURIComponent(sym.id))));
      } else if (act === 'sym') {
        go('#/map?symbol=' + encodeURIComponent(t.dataset.id));
      } else if (act === 'analyze') {
        go('#/deps?symbol=' + encodeURIComponent(t.dataset.id));
      }
    });
  }

  function mountDepsPicker(host) {
    const ranked = STORE.symbols.slice().sort((a, b) => b.i - a.i || (a.id < b.id ? -1 : 1)).slice(0, 200);
    const p = panelBlock('Start from a symbol', html`
      <div class="muted" style="font-size:11.5px;margin-bottom:8px">
        Highest fan-in symbols in this snapshot. Search above, or pick one here.
      </div>`);
    const listHost = el('div');
    listHost.style.height = '420px';
    p.appendChild(listHost);
    host.appendChild(p);

    const v = VirtualList({
      host: listHost,
      rowHeight: 28,
      render(i) {
        const s = ranked[i];
        return html`<div class="vrow" tabindex="0" role="button" data-act="analyze" data-id="${s.id}">
          <span class="vr-main"><span class="vr-name">${s.n}</span><span class="vr-path">${s.f}</span></span>
          <span class="vr-right"><span class="mono muted-2" style="font-size:10px">fan-in ${s.i}</span></span>
        </div>`;
      },
    });
    v.setCount(ranked.length);
    regList(v);
  }

  function breakageText(store, sym, up, down, tests) {
    const parts = [];
    const edges = (store.callOut.get(sym.id) || []).length + (store.callIn.get(sym.id) || []).length;
    if (!edges) {
      return 'No call edges in this snapshot reference ' + sym.n + '. Return-type impact cannot be derived — not analysed here.';
    }
    parts.push('Changing the return type of ' + sym.n + ' propagates to ' + plural(up.total, 'upstream dependent') + ' within ' + DEP_DEPTH + ' call hops.');
    if (down.total) parts.push(plural(down.total, 'downstream callee') + ' consume its execution context (side effects, thrown errors, awaited values).');
    if (!tests.length) parts.push('No test-code symbol reaches this symbol within ' + TEST_HOPS + ' hops, so the change is unguarded by tests in this snapshot.');
    else parts.push(plural(tests.length, 'test symbol') + ' reach it within ' + TEST_HOPS + ' hops.');
    if (sym.i >= 3) parts.push('It has fan-in ' + sym.i + ', which is above the interface-contract threshold (3), so callers likely assume the current shape.');
    else parts.push('Fan-in is ' + sym.i + ', below the interface-contract threshold of 3.');
    return parts.join(' ');
  }

  function mountDepsDetail(host, sym) {
    const up = closure(STORE, sym.id, 'up', DEP_DEPTH);
    const down = closure(STORE, sym.id, 'down', DEP_DEPTH);
    const tests = relatedTests(STORE, sym.id, TEST_HOPS);
    const impact = STORE.impactBySymbol.get(sym.id) || null;

    const stat = STORE.statOfSymbol(sym.id);
    const bestPath = bestPathForSymbol(STORE, sym.id);
    const contracts = (sym.i >= 3) || (sym.x && (sym.k === 'class' || sym.k === 'interface'));

    /* 1 — selection + breakage + impact */
    const sel = panelBlock('Selection', html`
      <div style="display:flex;flex-direction:column;gap:9px">
        <div class="row" style="justify-content:space-between;align-items:flex-start">
          <div>
            <div class="mono" style="font-size:13px">${sym.n}</div>
            <div class="mono muted-2" style="font-size:10.5px">${sym.f}</div>
          </div>
          <div class="row"><span class="chip plain kind">${sym.k}</span>${sym.x ? html`<span class="chip plain">exported</span>` : ''}${sym.t ? html`<span class="chip test">test</span>` : ''}</div>
        </div>
        <div class="depgrid">
          <div class="depcard"><div class="dc-label">fan-in</div><div class="dc-value">${sym.i}</div></div>
          <div class="depcard"><div class="dc-label">fan-out</div><div class="dc-value">${sym.c}</div></div>
          <div class="depcard"><div class="dc-label">upstream ≤${DEP_DEPTH}</div><div class="dc-value">${up.total}</div></div>
          <div class="depcard"><div class="dc-label">downstream ≤${DEP_DEPTH}</div><div class="dc-value">${down.total}</div></div>
          <div class="depcard"><div class="dc-label">tests ≤${TEST_HOPS}</div><div class="dc-value">${tests.length}</div></div>
          <div class="depcard"><div class="dc-label">obligations</div><div class="dc-value">${stat.total}</div></div>
        </div>
        <div>${barStat(stat)}</div>
        <div class="breakage">
          <h3>What breaks if I change the return type?</h3>
          <p>${breakageText(STORE, sym, up, down, tests)}</p>
          <div class="btnrow">
            ${bestPath ? html`<a class="btn sm primary" href="#/debugger?path=${encodeURIComponent(bestPath.id)}">Trace in debugger (${bestPath.id})</a>` : html`<span class="muted-2" style="font-size:10.5px">no path in paths[] contains this symbol</span>`}
            <a class="btn sm" href="#/map?symbol=${encodeURIComponent(sym.id)}">Open in map</a>
          </div>
        </div>
        ${impact ? html`
          <div class="breakage">
            <h3>Impact entry <span class="mono muted-2" style="font-size:10px">${impact.id}</span></h3>
            <div class="riskbar"><span class="mono muted-2" style="font-size:10px">risk</span>
              <span class="rb"><i style="width:${clamp(impact.risk, 0, 1) * 100}%"></i></span>
              <b class="mono">${impact.risk.toFixed(2)}</b></div>
            <p>${impact.note || '(no note)'}</p>
            <div class="row" style="gap:4px">
              <span class="chip plain">direct ${impact.direct.length}</span>
              <span class="chip plain">indirect ${impact.indirect.length}</span>
              <span class="chip plain">tests ${impact.tests.length}</span>
              <span class="chip plain">contracts ${impact.contracts.length}</span>
            </div>
          </div>` : html`<div class="note">No <span class="mono">impact[]</span> entry for this symbol in the payload — impact scoring was not emitted, not "zero risk".</div>`}
      </div>`);
    host.appendChild(sel);

    /* 2 — upstream */
    host.appendChild(depClosurePanel('Upstream dependencies', 'up', sym, up));
    /* 3 — downstream */
    host.appendChild(depClosurePanel('Downstream consumers', 'down', sym, down));

    /* 4 — shared state */
    const shared = impact && impact.shared_state.length
      ? impact.shared_state.map((id) => ({ id, resolved: STORE.symById.get(id) || null }))
      : deriveSharedState(sym);
    host.appendChild(panelBlock('Shared state', html`
      <div style="display:flex;flex-direction:column;gap:6px">
        ${shared.length ? html`<div class="mini-list">${shared.slice(0, 40).map((row) => html`
          <div class="mini-row"><span class="mi">•</span>
            ${row.resolved
              ? html`<button class="linkbtn mname" data-act="sym" data-id="${row.id}">${row.resolved.n}</button>`
              : html`<span class="mname">${row.id}</span>`}
            <span class="mono muted-2" style="font-size:9px">${row.resolved ? row.resolved.k : 'unresolved'}</span>
          </div>`)}</div>` : html`<div class="muted-2">none recorded</div>`}
        <div class="muted-2" style="font-size:10.5px">${impact && impact.shared_state.length
          ? 'From impact[].shared_state for this symbol.'
          : 'Derived from module adjacency (same file, state-like kind). The payload has no shared-state analysis for this symbol — treat as a heuristic, not a result.'}</div>
      </div>`));

    /* 5 — related tests */
    host.appendChild(panelBlock('Related tests', html`
      ${tests.length
        ? html`<div class="mini-list">${tests.slice(0, 40).map((t) => html`
            <div class="mini-row"><span class="mi">${t.hops}h</span>
              <button class="linkbtn mname" data-act="sym" data-id="${t.sym.id}">${t.sym.n}</button>
              <span class="mono muted-2" style="font-size:9px">${baseName(t.sym.f)}</span>
            </div>`)}</div>
          ${tests.length > 40 ? html`<div class="muted-2" style="font-size:10px">+${tests.length - 40} more</div>` : ''}`
        : html`<div class="muted-2">No test-code symbol (t===true) reaches this symbol within ${TEST_HOPS} hops.</div>`}
      <div class="muted-2" style="font-size:10.5px;margin-top:6px">Reachability is over calls[] in both directions; kind is not inspected.</div>`));

    /* 6 — interface contracts */
    host.appendChild(panelBlock('Interface contracts', html`
      <div style="display:flex;flex-direction:column;gap:6px">
        ${contracts
          ? html`<div class="note info" style="font-size:11px">Candidate contract: fan-in ${sym.i}${sym.x ? ' · exported ' + sym.k : ''}. Callers should be reviewed before a signature change.</div>`
          : html`<div class="muted-2" style="font-size:11.5px">No interface contract signal: fan-in ${sym.i} &lt; 3 and the symbol is not an exported class/interface.</div>`}
        ${(STORE.callIn.get(sym.id) || []).length ? html`
          <div class="mini-list">${(STORE.callIn.get(sym.id) || []).slice(0, 20).map((e) => {
            const caller = STORE.symById.get(e.a);
            return html`<div class="mini-row"><span class="mi">${e.k.slice(0, 3)}</span>
              <button class="linkbtn mname" data-act="sym" data-id="${e.a}">${caller ? caller.n : e.a}</button></div>`;
          })}</div>` : ''}
        ${impact && impact.contracts.length ? html`
          <div class="subhead"><span>contracts from impact[]</span><span class="mono">${impact.contracts.length}</span></div>
          <div class="mini-list">${impact.contracts.slice(0, 20).map((id) => html`<div class="mini-row"><span class="mi">c</span><span class="mname">${STORE.symById.get(id) ? STORE.symById.get(id).n : id}</span></div>`)}</div>` : ''}
      </div>`));
  }

  function deriveSharedState(sym) {
    const ids = STORE.fileSymbols.get(sym.f) || [];
    const out = [];
    for (const id of ids) {
      if (id === sym.id) continue;
      const s = STORE.symById.get(id);
      if (!s) continue;
      if (s.k === 'var' || s.k === 'enum' || s.k === 'class') out.push({ id, resolved: s });
      if (out.length >= 40) break;
    }
    return out;
  }

  function depClosurePanel(title, dir, sym, info) {
    const p = panelBlock(title, '');
    const body = p.querySelector('.panel-body');
    const max = Math.max(1, ...info.levels.map((l) => l.length));
    const rows = info.levels.map((level, idx) => {
      const d = idx + 1;
      const pctWidth = (level.length / max) * 100;
      const open = (dir === 'up' ? depsState.openUp : depsState.openDown) === d;
      return html`<div>
        <div class="depthrow">
          <span class="d">depth ${d}</span>
          <span class="depthbar"><i style="width:${pctWidth}%"></i></span>
          <span class="row" style="gap:8px">
            <span class="n">${level.length}</span>
            ${level.length ? html`<button class="expand" data-act="depth" data-dir="${dir}" data-d="${d}">${open ? 'hide' : 'show'}</button>` : ''}
          </span>
        </div>
        ${open ? html`<div class="mini-list" style="max-height:180px;margin:2px 0 6px">${level.slice(0, 60).map((id) => {
          const s = STORE.symById.get(id);
          return html`<div class="mini-row"><span class="mi">•</span>
            <button class="linkbtn mname" data-act="sym" data-id="${id}" title="${s ? s.f : id}">${s ? s.n : id}</button>
            <span class="mono muted-2" style="font-size:9px">${s ? s.k : ''}</span></div>`;
        })}${level.length > 60 ? html`<div class="muted-2" style="padding-left:6px;font-size:10px">+${level.length - 60} more</div>` : ''}</div>` : ''}
      </div>`;
    });

    setHTML(body, html`
      <div style="display:flex;flex-direction:column;gap:2px">
        ${rows.length ? rows : html`<div class="muted-2">no edges</div>`}
        <div class="muted-2" style="font-size:10.5px;margin-top:6px">
          ${info.total} symbol(s) within depth ${info.depth}${info.truncated ? ' · truncated at the depth/cap limit' : ''}.
          Direct ${dir === 'up' ? 'callers' : 'callees'}: ${(dir === 'up' ? STORE.callIn : STORE.callOut).get(sym.id) ? (dir === 'up' ? STORE.callIn : STORE.callOut).get(sym.id).length : 0}.
        </div>
      </div>`);
    return p;
  }


  /* ------------------------------------------------------------------ *
   * E. Maintenance Lab
   * ------------------------------------------------------------------ */

  function labKey(id) {
    return 'rlp:lab:' + id;
  }

  function readLabState(task) {
    const saved = LS.get(labKey(task.id), null);
    const steps = task.steps.map((_, i) => (saved && Array.isArray(saved.steps) ? !!saved.steps[i] : false));
    return {
      steps,
      answer: saved && typeof saved.answer === 'string' ? saved.answer : '',
      checked: !!(saved && saved.checked),
    };
  }

  function writeLabState(task, state) {
    LS.set(labKey(task.id), {
      steps: state.steps,
      answer: state.answer,
      checked: !!state.checked,
      ts: Date.now(),
    });
  }

  function renderLab() {
    const view = document.getElementById('view');
    const tasks = STORE.maintenance;
    const groups = new Map();
    for (const t of tasks) pushTo(groups, t.k, t);
    const keys = Array.from(groups.keys()).sort();

    let doneCount = 0;
    for (const t of tasks) if (isMarked('lab', t.id)) doneCount += 1;

    view.innerHTML = '';
    const shell = el('div');
    setHTML(shell, html`
      ${viewHead(
        'Maintenance lab',
        'Working sessions over the maintenance ledger. Answers and step progress persist in localStorage per task.',
        html`<span class="mono muted">${doneCount}/${tasks.length} tasks complete</span>`
      )}
      <div class="labgrid" id="labBody"></div>`);
    view.appendChild(shell);

    const body = document.getElementById('labBody');
    if (!tasks.length) {
      body.appendChild(el('div', 'note', 'maintenance[] is empty in this payload — there are no maintenance tasks to practise.'));
    }

    for (const key of keys) {
      const list = groups.get(key);
      const groupPanel = el('div', 'panel');
      const head = el('div', 'panel-head');
      setHTML(head, html`<span class="ph-title">${key}</span><span class="mono">${list.length} task(s)</span>`);
      groupPanel.appendChild(head);
      const inner = el('div');
      inner.style.padding = '10px';
      inner.style.display = 'flex';
      inner.style.flexDirection = 'column';
      inner.style.gap = '10px';
      groupPanel.appendChild(inner);
      body.appendChild(groupPanel);

      for (const task of list) inner.appendChild(taskNode(task));
    }

    /* testing recommendations */
    const recs = STORE.testing;
    const recPanel = panelBlock('Testing recommendations', '');
    const recBody = recPanel.querySelector('.panel-body');
    if (!recs.length) {
      setHTML(recBody, html`<div class="muted-2">testing[] is empty in this payload.</div>`);
    } else {
      const yes = recs.filter((r) => r.exists).length;
      const headExtra = el('div', 'panel-head');
      setHTML(headExtra, html`<span class="ph-title">Testing recommendations</span><span class="mono">${yes}/${recs.length} exist</span>`);
      recPanel.replaceChild(headExtra, recPanel.firstChild);
      setHTML(recBody, cat(recs.map((r) => html`
        <div class="testrec">
          <span class="flag ${r.exists ? 'yes' : 'no'}">${r.exists ? 'exists' : 'missing'}</span>
          <div class="tr-main">
            <div class="tr-text">${r.text}</div>
            <div class="tr-sub">
              ${r.kind} · ${STORE.symById.get(r.s) ? html`<button class="linkbtn" data-act="sym" data-id="${r.s}">${STORE.symById.get(r.s).n}</button>` : html`<span>${r.s}</span>`}
              ${r.covers.length ? html` · covers ${r.covers.length} obligation(s)` : ''}
            </div>
          </div>
        </div>`)));
    }
    body.appendChild(recPanel);

    wireLab(view);
  }

  function taskNode(task) {
    const state = readLabState(task);
    const checked = state.steps.filter(Boolean).length;
    const done = isMarked('lab', task.id);
    const affected = task.symbols.map((id) => STORE.symById.get(id)).filter(Boolean);

    const node = el('details', 'task');
    node.dataset.task = task.id;
    if (done) node.open = false;
    setHTML(node, html`
      <summary>
        <span class="task-k">${task.k}</span>
        <span class="task-title">${task.title}</span>
        <span class="chip crit">L${task.level}</span>
        <span class="chip risk">risk ${task.risk}</span>
        ${done ? html`<span class="chip st-covered">complete</span>` : ''}
        <span class="task-prog" data-prog="${task.id}">${checked}/${task.steps.length} steps</span>
      </summary>
      <div class="task-body">
        <p class="task-prompt">${task.prompt}</p>
        <div>
          <div class="subhead"><span>Steps</span><span class="mono" data-prog2="${task.id}">${checked}/${task.steps.length}</span></div>
          <ol class="steps">
            ${task.steps.map((text, i) => html`<li>
              <input type="checkbox" id="step-${task.id}-${i}" data-act="lab-step" data-task="${task.id}" data-i="${i}" ${state.steps[i] ? 'checked' : ''}>
              <label for="step-${task.id}-${i}"><span>${text}</span></label>
            </li>`)}
          </ol>
        </div>
        <div>
          <div class="subhead"><span>Affected symbols</span><span class="mono">${task.symbols.length}</span></div>
          <div class="row">
            ${affected.length ? affected.map((s) => html`<button class="chip plain" data-act="sym" data-id="${s.id}" title="${s.f}">${s.n}</button>`)
              : html`<span class="muted-2">none resolved</span>`}
          </div>
        </div>
        <div>
          <div class="subhead"><span>Tests</span><span class="mono">${task.tests.length}</span></div>
          <div class="row">
            ${task.tests.length ? task.tests.map((id) => html`<button class="chip plain" data-act="sym" data-id="${id}">${STORE.symById.get(id) ? STORE.symById.get(id).n : id}</button>`)
              : html`<span class="muted-2">no tests listed</span>`}
          </div>
        </div>
        <div>
          <label class="subhead" for="ans-${task.id}"><span>Your answer</span><span class="mono">symbols + rationale</span></label>
          <textarea class="answer" id="ans-${task.id}" data-answer="${task.id}" spellcheck="false"
                    placeholder="Name the modules you would touch and why…">${state.answer}</textarea>
        </div>
        <div class="row">
          <button class="btn sm" data-act="lab-check" data-task="${task.id}">Run self-check</button>
          <button class="btn sm ghost" data-act="lab-reset" data-task="${task.id}">Clear answer</button>
        </div>
        <div id="check-${task.id}" class="selfcheck" hidden></div>
      </div>`);
    return node;
  }

  function wireLab(view) {
    const timers = new Map();

    on(view, 'input', (ev) => {
      const ta = ev.target.closest('[data-answer]');
      if (!ta) return;
      const taskId = ta.dataset.answer;
      const task = STORE.maintenance.find((t) => t.id === taskId);
      if (!task) return;
      clearTimeout(timers.get(taskId));
      timers.set(taskId, setTimeout(() => {
        const state = readLabState(task);
        state.answer = ta.value;
        writeLabState(task, state);
      }, 300));
    });

    on(view, 'change', (ev) => {
      const box = ev.target.closest('[data-act="lab-step"]');
      if (!box) return;
      const taskId = box.dataset.task;
      const task = STORE.maintenance.find((t) => t.id === taskId);
      if (!task) return;
      const state = readLabState(task);
      const i = Number(box.dataset.i);
      state.steps[i] = !!box.checked;
      writeLabState(task, state);
      const checked = state.steps.filter(Boolean).length;
      const prog = view.querySelector('[data-prog="' + cssEscape(taskId) + '"]');
      if (prog) prog.textContent = checked + '/' + task.steps.length + ' steps';
      const prog2 = view.querySelector('[data-prog2="' + cssEscape(taskId) + '"]');
      if (prog2) prog2.textContent = checked + '/' + task.steps.length;
    });

    on(view, 'click', (ev) => {
      const t = ev.target.closest('[data-act]');
      if (!t) return;
      const act = t.dataset.act;
      if (act === 'sym') {
        go('#/map?symbol=' + encodeURIComponent(t.dataset.id));
        return;
      }
      if (act === 'lab-check') {
        runLabCheck(t.dataset.task);
        return;
      }
      if (act === 'lab-reset') {
        const task = STORE.maintenance.find((x) => x.id === t.dataset.task);
        if (!task) return;
        const state = readLabState(task);
        state.answer = '';
        state.checked = false;
        writeLabState(task, state);
        const ta = document.getElementById('ans-' + task.id);
        if (ta) ta.value = '';
        mark('lab', task.id, false);
        toast('answer cleared');
      }
    });
  }

  function cssEscape(value) {
    return String(value).replace(/["\\]/g, '\\$&');
  }

  function runLabCheck(taskId) {
    const task = STORE.maintenance.find((t) => t.id === taskId);
    if (!task) return;
    const ta = document.getElementById('ans-' + taskId);
    const state = readLabState(task);
    if (ta) state.answer = ta.value;
    writeLabState(task, state);

    const result = labCheck(STORE, task, state.answer);
    const host = document.getElementById('check-' + taskId);
    if (!host) return;
    host.hidden = false;
    const allSteps = state.steps.length > 0 && state.steps.every(Boolean);
    const pass = result.missed.length === 0 && result.total > 0;
    host.className = 'selfcheck ' + (pass ? 'ok' : 'warn');
    setHTML(host, html`
      <div>${result.message}</div>
      ${result.missed.length ? html`<div class="missed">${result.missed.map((s) => html`<span class="chip st-uncovered" title="${s.f}">${s.n}</span>`)}</div>` : ''}
      <div class="muted-2" style="font-size:10px;margin-top:5px">
        matched ${result.covered.length}/${result.total} affected symbols · token match on names, file stems and paths
        ${allSteps ? '' : ' · ' + (task.steps.length - state.steps.filter(Boolean).length) + ' step(s) unchecked'}
      </div>`);

    if (pass && allSteps && !isMarked('lab', taskId)) {
      mark('lab', taskId);
      const node = document.querySelector('details.task[data-task="' + cssEscape(taskId) + '"]');
      const summary = node ? node.querySelector('summary') : null;
      if (summary && !summary.querySelector('.chip.st-covered')) {
        const chip = document.createElement('span');
        chip.className = 'chip st-covered';
        chip.textContent = 'complete';
        summary.insertBefore(chip, summary.querySelector('.task-prog'));
      }
      toast('task ' + taskId + ' marked complete');
    } else if (pass && !allSteps) {
      toast('all affected symbols named — tick the steps to finish');
    }
  }

  /* ------------------------------------------------------------------ *
   * F. Coverage Dashboard
   * ------------------------------------------------------------------ */

  function renderDashboard() {
    const view = document.getElementById('view');
    const report = STORE.report;
    const overall = STORE.totalStat;
    const derivedDims = coverageByType(STORE);
    const hasReport = !!(report && report.coverage.size);

    const dims = hasReport
      ? Array.from(report.coverage.entries()).map(([key, d]) => ({
          key,
          total: d.total,
          covered: d.covered,
          unknown: d.unknown,
          excluded: d.excluded,
          uncovered: Math.max(0, d.total - d.covered - d.unknown - d.excluded),
          pct: d.pct,
        }))
      : derivedDims.map((r) => ({
          key: r.key,
          total: r.stat.total,
          covered: r.stat.covered,
          unknown: r.stat.unknown,
          excluded: r.stat.excluded,
          uncovered: r.stat.uncovered + r.stat.infeasible,
          pct: coverageOf(r.stat),
        }));

    const unknownR = report ? report.unknown_ratio : unknownRatio(STORE.obligations);
    const criticalGaps = report ? report.critical_gaps : STORE.obligations.filter((o) => o.st === 'uncovered' && (o.crit || 1) >= 2).length;
    const crit = criticalityBreakdown(STORE);
    const gapKinds = new Map();
    for (const g of STORE.gaps) gapKinds.set(g.kind, (gapKinds.get(g.kind) || 0) + 1);
    const rt = report ? report.totals : null;
    const totals = rt
      ? { covered: rt.covered, unknown: rt.unknown, total: rt.obligations, denom: rt.denominator || rt.obligations }
      : { covered: overall.covered, unknown: overall.unknown, total: overall.total, denom: overall.total };

    view.innerHTML = '';
    const shell = el('div');
    setHTML(shell, html`
      ${viewHead(
        'Coverage dashboard',
        'Each dimension is reported on its own axis. They are deliberately not blended into one number.',
        html`<span class="mono muted">${hasReport ? 'report.coverage' : 'derived from obligations[] (report missing)'}</span>`
      )}
      <div class="stack">
        <div class="statrow">
          <div class="stat"><div class="s-label">obligations</div><div class="s-value">${nfmt(totals.total)}</div><div class="s-sub">${STATUSES.length} statuses tracked${rt && rt.excluded ? ' · ' + nfmt(rt.excluded) + ' excluded' : ''}</div></div>
          <div class="stat"><div class="s-label">covered</div><div class="s-value" style="color:var(--covered)">${pct(totals.denom ? totals.covered / totals.denom : 0)}</div><div class="s-sub">${nfmt(totals.covered)} of ${nfmt(totals.denom)} in-scope obligations carry a witness</div></div>
          <div class="stat violet"><div class="s-label">unknown ratio</div><div class="s-value">${pct(unknownR)}</div><div class="s-sub">${nfmt(totals.unknown)} undecidable by static analysis</div></div>
          <div class="stat"><div class="s-label">reachability unproven</div><div class="s-value">${report && report.reachability ? pct(report.reachability.unproven_pct / 100) : '—'}</div><div class="s-sub">${report && report.reachability ? nfmt(report.reachability.unproven) + ' symbols without a static chain · reported Unknown, not dead' : 'not reported'}</div></div>
        <div class="stat ${criticalGaps ? 'warn' : ''}"><div class="s-label">critical gaps</div><div class="s-value">${nfmt(criticalGaps)}</div><div class="s-sub">uncovered with criticality ≥ 2</div></div>
        </div>

        <div class="panel">
          <div class="panel-head"><span class="ph-title">Coverage by dimension</span><span class="mono">${dims.length} dimensions</span></div>
          <div class="panel-body">
            ${dims.length ? cat(dims.map((d) => html`
              <div class="dim">
                <div class="dname">${d.key}</div>
                <div>
                  <div class="bar lg" role="img" aria-label="${d.covered} covered of ${d.total}">
                    <i class="s-covered" style="width:${d.total ? (d.covered / d.total) * 100 : 0}%"></i>
                    <i class="s-uncovered" style="width:${d.total ? (d.uncovered / d.total) * 100 : 0}%"></i>
                    <i class="s-unknown" style="width:${d.total ? (d.unknown / d.total) * 100 : 0}%"></i>
                    <i class="s-excluded" style="width:${d.total ? (d.excluded / d.total) * 100 : 0}%"></i>
                  </div>
                  <div class="barmeta"><span>${d.covered}/${d.total} covered</span><span>unknown ${d.unknown} · excluded ${d.excluded}</span></div>
                </div>
                <div class="dpct">${pct(d.pct)}</div>
              </div>`)) : html`<div class="muted-2">no dimensions available</div>`}
          </div>
        </div>

        <div class="dashgrid" style="grid-template-columns:minmax(0,1fr) minmax(0,1fr)">
          <div class="panel">
            <div class="panel-head"><span class="ph-title">Criticality breakdown</span><span class="mono">obligations[].crit</span></div>
            <div class="panel-body">
              <table class="crittable">
                <thead><tr><th>crit</th><th class="num">total</th><th class="num">covered</th><th class="num">uncovered</th><th class="num">unknown</th><th>mix</th></tr></thead>
                <tbody>
                  ${crit.map((row) => html`<tr>
                    <td class="mono">${row.crit}</td>
                    <td class="num">${row.stat.total}</td>
                    <td class="num" style="color:var(--covered)">${row.stat.covered}</td>
                    <td class="num" style="color:var(--uncovered)">${row.stat.uncovered}</td>
                    <td class="num" style="color:var(--unknown)">${row.stat.unknown}</td>
                    <td style="width:34%">${compactBar(row.stat)}</td>
                  </tr>`)}
                </tbody>
              </table>
            </div>
          </div>
          <div class="panel">
            <div class="panel-head"><span class="ph-title">Status legend</span><span class="mono">semantics are not interchangeable</span></div>
            <div class="panel-body">
              <div class="legend">
                ${STATUSES.map((st) => html`<div class="li">
                  <span class="sw" style="background:var(--${st})"></span>
                  <span><b>${st}</b><br>${STATUS_HINT[st]}</span>
                </div>`)}
              </div>
            </div>
          </div>
        </div>

        <div class="panel">
          <div class="panel-head"><span class="ph-title">Gap ledger · gaps[]</span><span class="mono">${STORE.gaps.length}</span></div>
          <div class="panel-body" style="display:flex;flex-direction:column;gap:8px">
            ${gapKinds.size ? html`<div class="row" style="gap:5px">${Array.from(gapKinds.entries()).map(([kind, n]) => html`<span class="chip plain">${kind} ${n}</span>`)}</div>` : ''}
            ${STORE.gaps.length ? cat(STORE.gaps.slice(0, 12).map((g) => html`
              <div class="testrec">
                <span class="flag ${g.kind === 'uncovered-critical' ? 'no' : 'yes'}">${g.kind}</span>
                <div class="tr-main">
                  <div class="tr-text">${g.text}</div>
                  <div class="tr-sub">
                    ${STORE.symById.get(g.s) ? html`<button class="linkbtn" data-act="gap-sym" data-id="${g.s}">${STORE.symById.get(g.s).n}</button>` : html`<span>${g.s}</span>`}
                    · ${g.reason}
                  </div>
                </div>
              </div>`)) : html`<div class="muted-2">gaps[] is empty in this payload — no gap ledger was emitted.</div>`}
            ${STORE.gaps.length > 12 ? html`<div class="muted-2" style="font-size:10.5px">+${STORE.gaps.length - 12} more gaps in the payload</div>` : ''}
          </div>
        </div>
        <div class="panel">
          <div class="panel-head"><span class="ph-title">Reading this dashboard</span><span class="mono">evidence ladder</span></div>
          <div class="panel-body" style="display:flex;flex-direction:column;gap:8px">
            <div class="note info">
              Static path evidence is <b>not</b> runtime coverage. A <span class="mono">covered</span> obligation means a static
              chain from an entry point exists — not that the code ran.
            </div>
            <div class="row" style="gap:6px">
              <span class="chip plain">modeled</span><span class="muted-2">&lt;</span>
              <span class="chip plain">constraint-validated</span><span class="muted-2">&lt;</span>
              <span class="chip plain">runtime-verified</span><span class="muted-2">&lt;</span>
              <span class="chip plain">learner-mastered</span>
            </div>
            <div class="muted-2" style="font-size:11px">
              Learner evidence in this session: ${progressCounts().paths} paths explored,
              ${progressCounts().exercises} exercises answered, ${progressCounts().lab} lab tasks complete.
              ${report && report.policy.length ? 'Payload policy: ' + report.policy.join(' · ') : ''}
            </div>
          </div>
        </div>
      </div>`);
    view.appendChild(shell);
    on(view, 'click', (ev) => {
      const t = ev.target.closest('[data-act="gap-sym"]');
      if (t) go('#/map?symbol=' + encodeURIComponent(t.dataset.id));
    });
  }

  /* ------------------------------------------------------------------ *
   * G. Ownership Report
   * ------------------------------------------------------------------ */

  const reportState = { feedback: new Map() };

  function deriveLevels(storeArg) {
    const S = storeArg || STORE;
    const out = [];
    for (let l = 1; l <= 5; l++) {
      const symIds = new Set();
      for (const p of S.paths) {
        if (p.tier !== l) continue;
        for (const step of p.steps) symIds.add(step.s);
      }
      let obligations = 0;
      const kinds = new Set();
      for (const id of symIds) {
        for (const o of S.obsBySymbol.get(id) || []) {
          obligations += 1;
          kinds.add(o.t);
        }
      }
      out.push({ level: l, name: 'Level ' + l, obligations, evidence_kinds: Array.from(kinds), derived: true });
    }
    return out;
  }

  function renderReport() {
    const view = document.getElementById('view');
    const levels = STORE.report && STORE.report.levels.length ? STORE.report.levels : deriveLevels();
    const counts = progressCounts();
    const totalPaths = STORE.paths.length;
    const totalEx = STORE.exercises.length;
    const totalLab = STORE.maintenance.length;

    view.innerHTML = '';
    const shell = el('div');
    setHTML(shell, html`
      ${viewHead(
        'Ownership report',
        'Five capability levels. Mastery ticks are driven by what you actually explored in this browser — paths replayed, exercises answered, lab tasks completed.',
        html`<div class="report-actions">
          <span class="mono muted">${counts.paths}/${totalPaths} paths · ${counts.exercises}/${totalEx} exercises · ${counts.lab}/${totalLab} lab</span>
          <button class="btn sm primary" data-act="print">Print / Export</button>
        </div>`
      )}
      <div class="print-only" style="margin-bottom:10px;font-family:var(--mono);font-size:10pt">
        ${STORE.meta.repository} · ${STORE.meta.commit ? STORE.meta.commit.slice(0, 12) : 'no commit'} · generated ${STORE.meta.generated_at || 'unknown'}
      </div>
      <div class="stack" id="reportBody"></div>`);
    view.appendChild(shell);

    const body = document.getElementById('reportBody');
    if (!levels.length) {
      body.appendChild(el('div', 'note', 'report.levels is empty and paths[] carries no tiers — no capability levels can be derived.'));
    }

    for (const level of levels) {
      const items = levelItems(STORE, level.level);
      const done = items.filter((i) => i.done).length;
      const missing = items.filter((i) => !i.done);
      const exercises = STORE.exercisesByLevel.get(level.level) || [];
      const objectives = STORE.objectives.filter((o) => o.level === level.level);

      const card = el('section', 'level');
      setHTML(card, html`
        <div class="level-head">
          <span class="level-num">${level.level}</span>
          <span class="level-name">${level.name}</span>
          <span class="level-meta">${nfmt(level.obligations)} obligations${level.derived ? ' · derived from paths[] tiers' : ''}</span>
          <span class="level-meta">${done}/${items.length} demonstrated</span>
        </div>
        <div>${barStat({ total: items.length, covered: done, uncovered: items.length - done, unknown: 0, infeasible: 0, excluded: 0 }, { meta: false, size: 'lg' })}</div>
        <div class="row" style="gap:4px">
          ${level.evidence_kinds.length ? level.evidence_kinds.map((k) => html`<span class="chip plain kind">${k}</span>`) : html`<span class="muted-2">no evidence kinds recorded</span>`}
        </div>

        <div>
          <div class="subhead"><span>Mastery checks</span><span class="mono">${done}/${items.length}</span></div>
          ${items.length ? cat(items.map((item) => html`
            <div class="mastery-row ${item.done ? 'done' : ''}">
              <input type="checkbox" id="m-${level.level}-${item.kind}-${item.id}" data-act="mastery"
                     data-kind="${item.kind}" data-id="${item.id}" ${item.done ? 'checked' : ''}>
              <div class="mr-main">
                <label class="mr-title" for="m-${level.level}-${item.kind}-${item.id}">
                  ${item.hash ? html`<a href="${item.hash}">${item.title}</a>` : item.title}
                </label>
                <div class="mr-kind">${item.kind}${item.meta ? ' · ' + item.meta : ''}</div>
              </div>
            </div>`)) : html`<div class="muted-2">No paths, exercises or lab tasks are mapped to this level.</div>`}
        </div>

        ${objectives.length ? html`<div>
          <div class="subhead"><span>Objectives</span><span class="mono">${objectives.length}</span></div>
          ${objectives.map((o) => html`<div class="muted" style="font-size:11.5px">· ${o.text}</div>`)}
        </div>` : ''}

        ${exercises.length ? html`<div>
          <div class="subhead"><span>Exercises</span><span class="mono">${exercises.length}</span></div>
          ${exercises.map((ex) => exerciseBlock(ex))}
        </div>` : ''}

        <div>
          <div class="subhead"><span>Not yet demonstrated</span><span class="mono">${missing.length}</span></div>
          ${missing.length
            ? html`<div class="missing">${missing.map((m) => html`<div class="m-item"><span>${m.title}</span><span class="mr-kind">${m.kind}</span></div>`)}</div>`
            : html`<div class="muted" style="font-size:11.5px">All mapped evidence for this level is demonstrated in this browser.</div>`}
        </div>`);
      body.appendChild(card);
    }

    const footer = el('div', 'panel');
    setHTML(footer, html`
      <div class="panel-head"><span class="ph-title">Assessment basis</span><span class="mono">rlp:progress</span></div>
      <div class="panel-body" style="display:flex;flex-direction:column;gap:8px">
        <div class="muted" style="font-size:11.5px">
          Mastery is local to this browser profile and is learner-reported. Replaying a path to its terminal step marks it explored;
          a lab task completes when every affected symbol is named and every step is ticked; exercises register when answered
          (choice) or revealed (self-assessed). Nothing is sent anywhere.
        </div>
        <div class="btnrow">
          <button class="btn sm ghost" data-act="print">Print this report</button>
          <button class="btn sm ghost" data-act="reset-progress">Reset learner progress</button>
        </div>
        ${STORE.report && STORE.report.policy.length ? html`<div class="muted-2" style="font-size:11px">Payload policy: ${STORE.report.policy.join(' · ')}</div>` : ''}
      </div>`);
    body.appendChild(footer);

    wireReport(view);
  }

  function exerciseBlock(ex) {
    const feedback = reportState.feedback.get(ex.id);
    const answered = isMarked('exercises', ex.id);
    const chosen = feedback && feedback.choiceId;
    const showExplain = feedback != null;
    return html`<div class="exercise">
      <div class="row" style="justify-content:space-between">
        <span class="mr-kind">${ex.k} · L${ex.level} · ${ex.id}</span>
        ${answered ? html`<span class="ex-answered">answered</span>` : ''}
      </div>
      <div class="ex-prompt">${ex.prompt || ex.title}</div>
      ${ex.choices.length
        ? html`<div style="display:flex;flex-direction:column;gap:5px">
            ${ex.choices.map((c) => {
              let cls = 'choice';
              if (showExplain && c.correct) cls += ' correct';
              if (showExplain && chosen === c.id && !c.correct) cls += ' wrong';
              return html`<button class="${cls}" data-act="choice" data-ex="${ex.id}" data-choice="${c.id}" ${showExplain ? 'disabled' : ''}>${c.text}</button>`;
            })}
          </div>`
        : html`<div class="btnrow">
            <button class="btn sm" data-act="reveal" data-ex="${ex.id}" ${showExplain ? 'disabled' : ''}>Reveal answer</button>
          </div>`}
      ${showExplain ? html`<div class="ex-explain">
        ${ex.answer ? html`<div class="mono" style="font-size:10.5px;color:var(--accent-ink)">answer: ${ex.answer}</div>` : ''}
        <div>${ex.explain || 'No explanation recorded in the payload.'}</div>
        ${ex.symbols.length ? html`<div class="row" style="gap:4px;margin-top:5px">${ex.symbols.slice(0, 8).map((id) => html`<button class="chip plain" data-act="sym" data-id="${id}">${STORE.symById.get(id) ? STORE.symById.get(id).n : id}</button>`)}</div>` : ''}
      </div>` : ''}
    </div>`;
  }

  function wireReport(view) {
    on(view, 'click', (ev) => {
      const t = ev.target.closest('[data-act]');
      if (!t) return;
      const act = t.dataset.act;
      if (act === 'print') { window.print(); return; }
      if (act === 'sym') { go('#/map?symbol=' + encodeURIComponent(t.dataset.id)); return; }
      if (act === 'choice') {
        const ex = STORE.exercises.find((x) => x.id === t.dataset.ex);
        if (!ex) return;
        const choice = ex.choices.find((c) => c.id === t.dataset.choice);
        reportState.feedback.set(ex.id, { choiceId: t.dataset.choice, correct: !!(choice && choice.correct) });
        if (choice && choice.correct) mark('exercises', ex.id);
        preserveScroll(renderReport);
        return;
      }
      if (act === 'reveal') {
        const ex = STORE.exercises.find((x) => x.id === t.dataset.ex);
        if (!ex) return;
        reportState.feedback.set(ex.id, { choiceId: '', correct: true });
        mark('exercises', ex.id);
        preserveScroll(renderReport);
        return;
      }
      if (act === 'reset-progress') {
        LS.set(PROGRESS_KEY, { paths: {}, exercises: {}, lab: {}, symbols: {} });
        PROGRESS = null;
        reportState.feedback.clear();
        toast('learner progress cleared');
        rerender(() => renderReport());
      }
    });

    on(view, 'change', (ev) => {
      const box = ev.target.closest('[data-act="mastery"]');
      if (!box) return;
      const kind = box.dataset.kind;
      const id = box.dataset.id;
      const checked = !!box.checked;
      if (kind === 'path') mark('paths', id, checked);
      else if (kind === 'lab') mark('lab', id, checked);
      else if (kind === 'exercise') mark('exercises', id, checked);
      else if (kind === 'assessment') {
        const a = STORE.assessments.find((x) => x.id === id);
        if (a) for (const exId of a.exercise) mark('exercises', exId, checked);
      }
      preserveScroll(renderReport);
    });
  }

  function preserveScroll(fn) {
    const view = document.getElementById('view');
    const y = view ? view.scrollTop : 0;
    rerender(fn);
    const next = document.getElementById('view');
    if (next) next.scrollTop = y;
  }

  /* ------------------------------------------------------------------ *
   * Empty state + shell startup
   * ------------------------------------------------------------------ */

  function renderEmptyState() {
    const view = document.getElementById('view');
    if (!view) return;
    setHTML(view, html`
      <div class="empty">
        <h2>No payload found</h2>
        <p>
          This runtime reads <code>window.RLP_DATA</code>. Nothing was defined, and <code>./data.json</code>
          could not be fetched (normal under <code>file://</code>).
        </p>
        <p>
          The analyzer pipeline writes <code>app/data.js</code> as <code>window.RLP_DATA = { … }</code>. It is regenerated per
          snapshot and must not be hand-edited; this file deliberately does not create it.
        </p>
        <ul>
          <li>Run the analyzer, then reload this page with <code>data.js</code> next to it.</li>
          <li>Or launch with <code>?mock=1</code> / press the button below to load the generated fixture (<code>mock-data.js</code>).</li>
          <li>Or inline the payload in a <code>&lt;script&gt;</code> before <code>app.js</code> — the runtime does not care how it arrives.</li>
        </ul>
        <div class="btnrow">
          <button class="btn primary" data-act="load-mock">Load mock dataset</button>
          <button class="btn" data-act="retry">Retry load</button>
        </div>
        <div class="muted-2 mono" style="font-size:10.5px">expected: ${'window.RLP_DATA = { meta, packages, files, symbols, obligations, … }'}</div>
      </div>`);

    on(view, 'click', async (ev) => {
      const t = ev.target.closest('[data-act]');
      if (!t) return;
      if (t.dataset.act === 'load-mock') {
        const ok = await loadScript('mock-data.js');
        if (!ok) { toast('mock-data.js could not be loaded from this directory'); return; }
        if (window.RLP_DATA) {
          toast('mock payload loaded');
          await start();
        } else toast('mock-data.js ran but defined no payload');
      } else if (t.dataset.act === 'retry') {
        await start();
      }
    });
  }

  function loadScript(src) {
    return new Promise((resolve) => {
      try {
        const s = document.createElement('script');
        s.src = src;
        s.async = false;
        s.onload = () => resolve(true);
        s.onerror = () => resolve(false);
        document.head.appendChild(s);
      } catch (e) { resolve(false); }
    });
  }

  async function resolveData() {
    const w = window;
    if (w.RLP_DATA && typeof w.RLP_DATA === 'object') return w.RLP_DATA;
    if (/[?&]mock=1/.test(location.search)) {
      const ok = await loadScript('mock-data.js');
      if (ok && w.RLP_DATA) return w.RLP_DATA;
    }
    try {
      const res = await fetch('./data.json', { cache: 'no-store' });
      if (res && res.ok) {
        const json = await res.json();
        if (json && typeof json === 'object') return json;
      }
    } catch (e) { /* file:// or missing — fall through to the empty state */ }
    return null;
  }

  async function start() {
    const data = await resolveData();
    if (!data) {
      STORE = null;
      renderEmptyState();
      return false;
    }
    STORE = buildStore(data);
    renderTopbar();
    if (!document.getElementById('gsearch')) mountGlobalSearch();
    render();
    return true;
  }

  async function boot() {
    if (typeof document === 'undefined') return;
    if (!document.getElementById('view')) return;
    renderNav();
    const ok = await start();
    if (ok) {
      window.removeEventListener('hashchange', render);
      window.addEventListener('hashchange', render);
    }
  }

  /* ------------------------------------------------------------------ *
   * 7. Router
   * ------------------------------------------------------------------ */

  const VIEWS = {
    map: renderMap,
    atlas: renderAtlas,
    debugger: renderDebugger,
    deps: renderDeps,
    lab: renderLab,
    dashboard: renderDashboard,
    report: renderReport,
  };

  function parseHash() {
    const hashText = (typeof location !== 'undefined' ? location.hash : '') || '#/map';
    const body = hashText.replace(/^#/, '');
    const qIndex = body.indexOf('?');
    const pathPart = qIndex >= 0 ? body.slice(0, qIndex) : body;
    const query = qIndex >= 0 ? body.slice(qIndex + 1) : '';
    const name = (pathPart || '/map').replace(/^\/+/, '') || 'map';
    return { name, params: new URLSearchParams(query) };
  }

  function go(hash) {
    if (typeof location === 'undefined') return;
    if (location.hash === hash) { render(); return; }
    location.hash = hash;
  }

  function renderCrash(view, err) {
    setHTML(view, html`<div class="empty">
      <h2>This view could not be rendered</h2>
      <p>The payload is malformed for this workspace. The rest of the runtime still works — switch tabs or inspect the console.</p>
      <pre class="anchor">${String(err && err.stack ? err.stack : err)}</pre>
      <div class="btnrow"><button class="btn" data-act="reload-view">Reload view</button></div>
    </div>`);
    on(view, 'click', (ev) => {
      if (ev.target.closest('[data-act="reload-view"]')) render();
    });
  }

  function rowKeyHandler(ev) {
    if (ev.key !== 'Enter' && ev.key !== ' ' && ev.key !== 'Spacebar') return;
    const row = ev.target && ev.target.closest ? ev.target.closest('[data-act][tabindex="0"]') : null;
    if (!row) return;
    ev.preventDefault();
    ev.stopPropagation();
    row.click();
  }

  function render() {
    if (!STORE) return;
    stopContinue();
    destroyMounts();
    flushCleanups();

    const route = parseHash();
    const view = document.getElementById('view');
    if (!view) return;
    view.innerHTML = '';
    setActiveTab(route.name);
    on(view, 'keydown', rowKeyHandler, true);

    const fn = VIEWS[route.name] || renderMap;
    try {
      fn(route.params);
    } catch (err) {
      if (typeof console !== 'undefined' && console.error) console.error('[rlp] view crash', err);
      renderCrash(view, err);
    }
    view.scrollTop = 0;
  }

  /* ------------------------------------------------------------------ *
   * Node test surface (no DOM required)
   * ------------------------------------------------------------------ */

  const TEST_API = {
    buildStore,
    createFilters,
    passFilter,
    filterObligations,
    aggregate,
    coverageOf,
    unknownRatio,
    fuzzyScore,
    fuzzySearch,
    findEntryChain,
    bestPathForSymbol,
    buildLearningRoute,
    closure,
    relatedTests,
    squarify,
    coverageColor,
    symbolTokens,
    labCheck,
    levelItems,
    coverageByType,
    criticalityBreakdown,
    deriveLevels,
    STATUSES,
    TYPES,
    MAX_ROWS,
    PROGRESS_KEY,
  };

  if (typeof window !== 'undefined') {
    window.RLP_TEST_API = TEST_API;
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = TEST_API;
  }

  if (typeof document !== 'undefined' && typeof window !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => { boot(); });
    } else {
      boot();
    }
  }
})();



/* ------------------------------------------------------------------ *
 * Material 3 theme: explicit light/dark toggle, persisted.
 * Default is dark (the instrument's native scheme); <html data-theme>
 * wins over prefers-color-scheme, so both M3 schemes are reachable.
 * ------------------------------------------------------------------ */
(function initTheme() {
  if (typeof document === 'undefined' || !document.documentElement) return;
  const KEY = 'rlp:theme';
  const root = document.documentElement;
  let stored = null;
  try { stored = localStorage.getItem(KEY); } catch { stored = null; }
  if (stored === 'light' || stored === 'dark') root.setAttribute('data-theme', stored);
  const apply = (mode) => {
    root.setAttribute('data-theme', mode);
    try { localStorage.setItem(KEY, mode); } catch { /* private mode */ }
    const btn = document.getElementById('themeToggle');
    if (btn) btn.setAttribute('aria-pressed', mode === 'light' ? 'true' : 'false');
  };
  const bind = () => {
    const btn = document.getElementById('themeToggle');
    if (!btn || btn.dataset.bound === '1') return;
    btn.dataset.bound = '1';
    btn.setAttribute('aria-pressed', root.getAttribute('data-theme') === 'light' ? 'true' : 'false');
    btn.addEventListener('click', () => apply(root.getAttribute('data-theme') === 'light' ? 'dark' : 'light'));
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind, { once: true });
  else bind();
})();
