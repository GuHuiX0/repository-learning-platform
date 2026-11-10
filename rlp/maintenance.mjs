/**
 * Maintenance layer: impact analysis, maintenance tasks, testing
 * recommendations and the ownership report.
 *
 * Impact is derived from the reverse call graph (direct/indirect), the state
 * channel graph (shared fields) and test reachability. Nothing here is
 * generated from intuition: every entry points at symbols and evidence.
 */
import { sortBy } from './util.mjs';

export function buildMaintenance(model, obSet, plan, learning, opts = {}) {
  const maxImpact = opts.maxImpact ?? 600;
  const rev = new Map();
  for (const e of model.edges) {
    if (!rev.has(e.b)) rev.set(e.b, []);
    rev.get(e.b).push(e.a);
  }
  const statePartners = new Map();
  for (const ch of model.stateChannels) {
    if (!statePartners.has(ch.a)) statePartners.set(ch.a, new Set());
    if (!statePartners.has(ch.b)) statePartners.set(ch.b, new Set());
    statePartners.get(ch.a).add(ch.b + '|' + ch.field);
    statePartners.get(ch.b).add(ch.a + '|' + ch.field);
  }

  const testsBySymbol = new Map();
  for (const e of model.edges) {
    const a = model.byId.get(e.a);
    const b = model.byId.get(e.b);
    if (!a || !b) continue;
    if (a.isTest) {
      if (!testsBySymbol.has(b.id)) testsBySymbol.set(b.id, new Set());
      testsBySymbol.get(b.id).add(a.id);
    }
  }

  const testReach = (id, depth = 2) => {
    const out = new Set();
    let frontier = [id];
    for (let d = 0; d < depth; d++) {
      const next = [];
      for (const cur of frontier) {
        for (const p of rev.get(cur) || []) {
          const sym = model.byId.get(p);
          if (!sym) continue;
          if (sym.isTest) out.add(sym.id);
          next.push(p);
        }
      }
      frontier = next;
    }
    return out;
  };

  /* ---------------- impact map ---------------- */
  const candidates = model.symbols
    .filter((s) => !s.isTest && (s.fanIn >= 3 || (s.kind === 'class' && s.fanIn >= 1)))
    .sort((a, b) => b.fanIn - a.fanIn || (a.id < b.id ? -1 : 1))
    .slice(0, maxImpact);

  const maxFanIn = Math.max(1, ...candidates.map((s) => s.fanIn));
  const logMax = Math.log1p(maxFanIn);
  const impact = [];
  for (const sym of candidates) {
    const direct = [...new Set((rev.get(sym.id) || []).filter((id) => !model.byId.get(id)?.isTest))];
    const indirect = new Set();
    for (const d of direct) for (const p of rev.get(d) || []) if (p !== sym.id && !direct.includes(p)) indirect.add(p);
    const tests = [...testReach(sym.id)];
    const partners = [...(statePartners.get(sym.id) || [])].slice(0, 12);
    const contracts = [];
    if (sym.exported) contracts.push('exported from ' + sym.rel);
    if (sym.kind === 'class') contracts.push('class surface: ' + (sym.name));
    if (sym.kind === 'interface' || sym.kind === 'type') contracts.push('type contract consumed by ' + sym.fanIn + ' sites');
    // Calibrated 1..10: logarithmic fan-in (a hub with 200 callers is not 10x a
    // hub with 20), plus explicit penalties for untested / exported / stateful.
    const base = 1 + 9 * (Math.log1p(direct.length) / logMax);
    const risk = Math.max(1, Math.min(10, Math.round(base + (tests.length ? 0 : 1) + (partners.length ? 0.5 : 0))));
    impact.push({
      id: 'IM-' + sym.id.slice(1, 8),
      s: sym.id,
      direct: direct.slice(0, 40),
      indirect: [...indirect].slice(0, 60),
      tests: tests.slice(0, 20),
      shared_state: partners,
      contracts,
      risk,
      note:
        `${sym.qualified} has ${direct.length} direct in-repo callers, ${indirect.size} second-order consumers and ${tests.length} test symbols in reach. ` +
        (tests.length ? '' : 'No test reaches this symbol, so a change here is unverified. ') +
        (partners.length ? `It shares ${partners.length} state channels.` : 'It shares no tracked state channel.'),
    });
  }

  /* ---------------- maintenance tasks ---------------- */
  const tasks = [];
  const taskSeeds = sortBy(impact.slice(), (im) => -im.risk).slice(0, 10);
  taskSeeds.forEach((im, i) => {
    const sym = model.byId.get(im.s);
    if (!sym) return;
    const callers = im.direct.map((id) => model.byId.get(id)).filter(Boolean).slice(0, 6);
    tasks.push({
      id: 'MT-A-' + String(i + 1).padStart(3, '0'),
      k: 'contract-change',
      title: `Change the contract of ${sym.qualified}`,
      prompt:
        `Extend the contract of ${sym.qualified} (${sym.kind}, ${sym.fanIn} callers, risk ${im.risk}/10) by one new field or return variant. ` +
        `Before writing code, list every caller that must change, every consumer that reads the field indirectly, and every test that will fail.`,
      steps: [
        `Read the declaration: ${sym.anchor}`,
        `Walk the direct callers: ${callers.map((c) => c.qualified).join(', ') || '(none)'}`,
        `Check shared state edges: ${im.shared_state.length ? im.shared_state.map((p) => p.split('|')[1]).slice(0, 5).join(', ') : '(none recorded)'}`,
        `Update tests: ${im.tests.length ? im.tests.map((t) => model.byId.get(t)?.rel).slice(0, 4).join(', ') : 'no test currently reaches this symbol'}`,
        'Re-run the path suite for this symbol and confirm no obligation flips to uncovered.',
      ],
      level: 4,
      symbols: [sym.id, ...im.direct.slice(0, 10)],
      tests: im.tests.slice(0, 8),
      risk: im.risk,
    });
  });

  // Error-propagation tasks.
  const errSeeds = sortBy(
    obSet.obligations.filter((o) => o.t === 'exception' && o.st !== 'excluded').slice(),
    (o) => -(o.crit || 1),
  ).slice(0, 8);
  errSeeds.forEach((ob, i) => {
    const sym = model.byId.get(ob.s);
    if (!sym) return;
    tasks.push({
      id: 'MT-B-' + String(i + 1).padStart(3, '0'),
      k: 'error-propagation',
      title: `Trace and fix error propagation in ${sym.qualified}`,
      prompt:
        `An error surfaces from \u201c${clean(ob.l)}\u201d inside ${sym.qualified}. Introduce a distinguishable error type, propagate it, and make sure the caller can tell it apart from a generic failure.`,
      steps: [
        `Locate the throwing region: ${sym.anchor}`,
        `List every catch clause on the route (obligation ${ob.id})`,
        'Decide the error contract at the module boundary (typed error vs. result object)',
        'Update the caller switch/match statements that inspect the error',
        'Add a regression test that forces the error path',
      ],
      level: 3,
      symbols: [sym.id],
      tests: [...testReach(sym.id)].slice(0, 6),
      risk: ob.crit || 1,
    });
  });

  // Coverage-driven tasks: the gaps are the assignments.
  const uncoveredCrit = sortBy(
    obSet.obligations.filter((o) => o.st === 'uncovered' && (o.crit || 1) >= 2).slice(),
    (o) => o.id,
  ).slice(0, 14);
  uncoveredCrit.forEach((ob, i) => {
    const sym = model.byId.get(ob.s);
    if (!sym) return;
    tasks.push({
      id: 'MT-C-' + String(i + 1).padStart(3, '0'),
      k: 'coverage-gap',
      title: `Close coverage gap: ${trim(ob.l, 60)}`,
      prompt:
        `No path in this package reaches the \u201c${ob.o}\u201d outcome of \u201c${trim(ob.l, 90)}\u201d in ${sym.qualified}. ` +
        `Either the branch is unreachable in the current design (then delete or guard it), or the path suite is missing a scenario (then add it). Decide which, and justify with source evidence.`,
      steps: [
        `Read ${sym.rel} around: ${sym.anchor}`,
        `Decide: reachable-but-unwitnessed, or dead code? (reason recorded: ${ob.r || 'none'})`,
        'If reachable, name the entry point and the external outcome that triggers it',
        'If dead, propose the deletion and the test that proves it stays dead',
      ],
      level: 3,
      symbols: [sym.id],
      tests: [...testReach(sym.id)].slice(0, 6),
      risk: ob.crit || 1,
    });
  });

  /* ---------------- testing recommendations ---------------- */
  const testing = [];
  const testFileByDir = new Map();
  for (const f of model.files) {
    if (!/\.(test|spec)\.[cm]?[jt]sx?$/.test(f.rel)) continue;
    const dir = f.rel.split('/').slice(0, -1).join('/');
    if (!testFileByDir.has(dir)) testFileByDir.set(dir, []);
    testFileByDir.get(dir).push(f.rel);
  }
  const uncoveredBranch = sortBy(
    obSet.obligations.filter((o) => (o.t === 'branch' || o.t === 'scenario') && o.st === 'uncovered').slice(),
    (o) => -(o.crit || 1),
  ).slice(0, 400);
  for (const ob of uncoveredBranch) {
    const sym = model.byId.get(ob.s);
    if (!sym) continue;
    const dir = sym.rel.split('/').slice(0, -1).join('/');
    const existing = testFileByDir.get(dir) || [];
    testing.push({
      id: 'TR-' + ob.id.slice(3, 9),
      s: sym.id,
      kind: ob.t === 'scenario' ? 'scenario-test' : 'branch-test',
      text:
        `Add a test that forces the \u201c${ob.o}\u201d outcome of \u201c${trim(ob.l, 90)}\u201d in ${sym.qualified} ` +
        `(${ob.w === 'path' ? 'already witnessed statically' : 'no witness yet'}).`,
      covers: [ob.id],
      exists: existing.length > 0,
      where: existing[0] || dir + '/<new>.test.ts',
    });
  }

  /* ---------------- gaps ---------------- */
  const gaps = [];
  for (const ob of obSet.obligations) {
    if (ob.st === 'covered') continue;
    const sym = model.byId.get(ob.s);
    if (!sym) continue;
    gaps.push({
      id: ob.id,
      kind: ob.st,
      s: ob.s,
      f: sym.rel,
      text: (ob.l || ob.t).slice(0, 120),
      reason: ob.r || '',
      crit: ob.crit || 1,
      t: ob.t,
    });
  }

  return { impact, tasks, testing, gaps };
}

/* ------------------------------------------------------------------ */
/* ownership report                                                   */
/* ------------------------------------------------------------------ */

export function buildOwnershipReport(model, obSet, plan, learning, maintenance) {
  const byPkg = new Map();
  for (const ob of obSet.obligations) {
    const sym = model.byId.get(ob.s);
    if (!sym) continue;
    const pkg = sym.pkg;
    if (!byPkg.has(pkg)) byPkg.set(pkg, { total: 0, covered: 0, uncovered: 0, unknown: 0, excluded: 0, crit: 0, critOpen: 0 });
    const d = byPkg.get(pkg);
    d.total++;
    d[ob.st] = (d[ob.st] || 0) + 1;
    if ((ob.crit || 1) >= 2) {
      d.crit++;
      if (ob.st !== 'covered') d.critOpen++;
    }
  }
  const taskCount = new Map();
  for (const t of maintenance.tasks) for (const s of t.symbols) {
    const sym = model.byId.get(s);
    if (sym) taskCount.set(sym.pkg, (taskCount.get(sym.pkg) || 0) + 1);
  }

  const modules = [...byPkg.entries()]
    .map(([pkg, d]) => {
      const denom = Math.max(1, d.total - d.excluded);
      const structural = Math.round((d.covered / denom) * 1000) / 10;
      return {
        pkg,
        total: d.total,
        covered: d.covered,
        uncovered: d.uncovered || 0,
        unknown: d.unknown || 0,
        excluded: d.excluded || 0,
        critical_open: d.critOpen,
        coverage_pct: structural,
        tasks: taskCount.get(pkg) || 0,
        verdict:
          structural >= 40 && d.critOpen === 0
            ? 'learnable end-to-end'
            : structural >= 15
              ? 'partially learnable — critical gaps remain'
              : 'not yet learnable from this package',
      };
    })
    .sort((a, b) => b.total - a.total || (a.pkg < b.pkg ? -1 : 1));

  return {
    repository: model.meta.repository,
    commit: model.meta.commit,
    generated_at: new Date().toISOString(),
    modules,
    totals: {
      obligations: obSet.total,
      covered: obSet.obligations.filter((o) => o.st === 'covered').length,
      paths: plan.paths.length,
      exercises: learning.exercises.length,
      storylines: learning.storylines.length,
      maintenance_tasks: maintenance.tasks.length,
      open_critical_gaps: obSet.obligations.filter((o) => (o.crit || 1) >= 2 && o.st === 'uncovered').length,
    },
    statement:
      'This report states what the package can prove about this snapshot. It cannot prove that a developer can maintain the code; that requires the learner evidence produced inside the runtime (exercises, diagnoses, patches).',
  };
}

function clean(s) {
  return String(s || '').replace(/\s+/g, ' ').trim();
}
function trim(s, n) {
  const t = clean(s);
  return t.length > n ? t.slice(0, n - 1) + '\u2026' : t;
}
