/**
 * Learning compiler.
 *
 * Converts confirmed structural facts into teaching artefacts. It never
 * invents source facts: every sentence is assembled from symbol names, file
 * paths, anchors and obligation labels that already exist in the graph, and
 * every artefact carries the evidence ids it is grounded in.
 */
import { hashUnit, sortBy } from './util.mjs';

const LEVEL_NAMES = [
  'Repository Literacy',
  'Execution Literacy',
  'Failure Diagnosis',
  'Change Impact Reasoning',
  'Independent Maintenance',
];

export function compileLearning(model, obSet, plan, opts = {}) {
  const objectives = [];
  const storylines = [];
  const exercises = [];
  const assessments = [];

  const bySymbol = obSet.bySymbol;
  const paths = plan.paths;

  /* ---------------- objectives per package / module ---------------- */
  const packages = new Map();
  for (const f of model.files) {
    if (!packages.has(f.pkg)) packages.set(f.pkg, { files: [], symbols: [] });
    packages.get(f.pkg).files.push(f);
  }
  for (const sym of model.symbols) {
    if (!packages.has(sym.pkg)) packages.set(sym.pkg, { files: [], symbols: [] });
    packages.get(sym.pkg).symbols.push(sym);
  }

  for (const [pkg, info] of packages) {
    const nonTest = info.symbols.filter((s) => !s.isTest);
    if (!nonTest.length) continue;
    const hubs = [...nonTest].sort((a, b) => b.fanIn - a.fanIn || (a.id < b.id ? -1 : 1)).slice(0, 5);
    const pkgPaths = paths.filter((p) => model.byId.get(p.terminal)?.pkg === pkg);
    const pkgObs = obSet.obligations.filter((o) => model.byId.get(o.s)?.pkg === pkg && o.st !== 'excluded');

    objectives.push({
      id: 'LO-L1-' + shortPkg(pkg),
      level: 1,
      text: `Explain what ${pkg} is responsible for, its public entry points, and how its ${nonTest.length} source symbols are organised.`,
      symbols: hubs.map((s) => s.id),
      obligations: pkgObs.filter((o) => o.t === 'symbol').slice(0, 40).map((o) => o.id),
    });

    const rolePath = sortBy(pkgPaths.slice(), (p) => -p.covers.length)[0];
    if (rolePath) {
      objectives.push({
        id: 'LO-L2-' + shortPkg(pkg),
        level: 2,
        text: `Trace one complete execution through ${pkg}: ${model.byId.get(rolePath.entry)?.name ?? 'entry'} \u2192 ${model.byId.get(rolePath.terminal)?.name ?? 'terminal'}, and explain each branch decision on the way.`,
        symbols: rolePath.symbols,
        obligations: rolePath.covers.slice(0, 60),
      });
    }

    const branchObs = pkgObs.filter((o) => o.t === 'branch' || o.t === 'loop');
    if (branchObs.length) {
      objectives.push({
        id: 'LO-L3-' + shortPkg(pkg),
        level: 3,
        text: `Explain ${branchObs.length} control-flow obligations in ${pkg} (${count(branchObs, 'covered')} currently covered) and diagnose what happens when each error path fires.`,
        symbols: hubs.map((s) => s.id),
        obligations: branchObs.slice(0, 200).map((o) => o.id),
      });
    }

    const contracts = nonTest.filter((s) => s.exported && s.fanIn >= 4).slice(0, 12);
    if (contracts.length) {
      objectives.push({
        id: 'LO-L4-' + shortPkg(pkg),
        level: 4,
        text: `Predict the blast radius of changing ${contracts[0].qualified} in ${pkg}: ${contracts.length} exported symbols have 4+ in-repo callers.`,
        symbols: contracts.map((s) => s.id),
        obligations: [],
      });
    }

    if (pkgObs.length) {
      objectives.push({
        id: 'LO-L5-' + shortPkg(pkg),
        level: 5,
        text: `Own ${pkg}: complete the maintenance tasks, produce a patch, and verify with the tests that reach the changed symbols.`,
        symbols: hubs.map((s) => s.id),
        obligations: pkgObs.filter((o) => o.crit >= 2).slice(0, 80).map((o) => o.id),
      });
    }
  }

  /* ---------------- storylines from selected paths ---------------- */
  const ranked = sortBy(paths.slice(), (p) => -(p.covers.length * (p.witness === 'modelled' ? 1.2 : 1)))
    .slice(0, Math.min(28, paths.length));
  ranked.forEach((path, i) => {
    const entry = model.byId.get(path.entry);
    const terminal = model.byId.get(path.terminal);
    if (!entry || !terminal) return;
    const acts = [];
    let actNo = 1;
    const chainSymbols = path.symbols.slice(0, 8);
    for (const symId of chainSymbols) {
      const sym = model.byId.get(symId);
      if (!sym) continue;
      const steps = path.steps.filter((s) => s.s === symId && s.l);
      const labels = steps.map((s) => s.l).filter(Boolean).slice(0, 3);
      acts.push({
        n: actNo++,
        title: `${sym.name} \u2014 ${sym.kind} in ${shortFile(sym.rel)}`,
        body: [
          sym.doc ? trim(sym.doc, 300) : `${sym.kind} \u201c${sym.qualified}\u201d, declared as: ${sym.anchor}`,
          labels.length ? `Decisions on this route: ${labels.join(' \u2192 ')}.` : '',
          steps.length ? `Evidence: ${sym.evidence}.` : '',
        ].filter(Boolean).join(' '),
        symbols: [symId],
        obligations: (bySymbol.get(symId) || []).filter((o) => o.st === 'covered').slice(0, 12).map((o) => o.id),
      });
    }
    storylines.push({
      id: 'ST-' + String(i + 1).padStart(3, '0'),
      path: path.id,
      title: `${entry.name} \u2192 ${terminal.name}`,
      premise:
        `You are on-call for ${model.meta.repository} at ${String(model.meta.commit).slice(0, 8)}. ` +
        `A call enters at ${entry.qualified} and ends at ${terminal.qualified}. ` +
        `Follow the exact route (${path.steps.length} execution steps, ${path.covers.length} obligations) and justify every branch you pass.` +
        (path.witness === 'may-reach' ? ' Note: this route depends on a may-reach (RTA) edge, so treat the path as possible, not proven.' : ''),
      acts,
      objectives: objectives.filter((o) => o.level === path.tier).slice(0, 3).map((o) => o.id),
      level: path.tier,
    });
  });

  /* ---------------- comprehension exercises from the call graph ---------------- */
  const hubSymbols = model.symbols
    .filter((s) => !s.isTest && s.fanIn >= 3 && s.reach !== 'none')
    .sort((a, b) => b.fanIn - a.fanIn || (a.id < b.id ? -1 : 1))
    .slice(0, 40);

  for (const hub of hubSymbols) {
    const callers = [...new Set(model.edges.filter((e) => e.b === hub.id && e.k !== 'may-reach').map((e) => e.a))];
    if (callers.length < 1) continue;
    const correct = model.byId.get(callers[0]);
    if (!correct) continue;
    const distractors = model.symbols
      .filter((s) => !s.isTest && s.pkg === hub.pkg && s.id !== hub.id && s.id !== correct.id && s.fanIn > 0)
      .sort((a, b) => hashUnit(a.id, 'ex' + hub.id) - hashUnit(b.id, 'ex' + hub.id))
      .slice(0, 2);
    const choices = shuffleDeterministic(
      [
        { id: 'c-correct', text: `${correct.qualified} (${shortFile(correct.rel)})`, correct: true },
        ...distractors.map((d, k) => ({ id: 'c-d' + k, text: `${d.qualified} (${shortFile(d.rel)})`, correct: false })),
      ],
      hub.id,
    );
    exercises.push({
      id: 'EX-C-' + hub.id.slice(1, 7),
      k: 'comprehension',
      level: 2,
      title: `Callers of ${hub.name}`,
      prompt: `Which symbol calls ${hub.qualified} directly in this snapshot?`,
      choices,
      answer: `${correct.qualified} \u2192 ${hub.qualified}`,
      explain: `${hub.qualified} has ${hub.fanIn} in-repo callers${hub.fanOut ? ` and calls ${hub.fanOut} symbols` : ''}. Evidence: ${hub.evidence}.`,
      symbols: [hub.id, correct.id],
      obligations: (bySymbol.get(hub.id) || []).filter((o) => o.t === 'call-edge').slice(0, 5).map((o) => o.id),
      evidence: [hub.evidence],
    });
  }

  /* ---------------- diagnosis exercises from error scenarios ---------------- */
  const errorObs = obSet.obligations.filter(
    (o) => o.t === 'scenario' && o.st !== 'excluded' && ['error', 'timeout', 'failure', 'rate-limited', 'blocked', 'absent'].includes(o.o),
  );
  const diagSeeds = sortBy(errorObs.slice(), (o) => -(o.crit || 1) * (o.st === 'covered' ? 2 : 1)).slice(0, 30);
  for (const ob of diagSeeds) {
    const sym = model.byId.get(ob.s);
    if (!sym) continue;
    const handlers = (bySymbol.get(ob.s) || []).filter((o) => o.t === 'exception');
    if (!handlers.length) continue;
    exercises.push({
      id: 'EX-D-' + ob.id.slice(3, 9),
      k: 'diagnosis',
      level: 3,
      title: `Failure at ${sym.name}`,
      prompt: `\u201c${trim(ob.l, 120)}\u201d in ${sym.qualified} returns the outcome \u201c${ob.o}\u201d. Which construct in the same symbol handles that outcome, and what does the caller observe?`,
      choices: shuffleDeterministic(
        [
          { id: 'c-correct', text: handlers[0].l, correct: true },
          ...(bySymbol.get(ob.s) || [])
            .filter((o) => o.t === 'branch' && o.l !== handlers[0].l)
            .slice(0, 2)
            .map((o, k) => ({ id: 'c-d' + k, text: o.l, correct: false })),
        ],
        ob.id,
      ),
      answer: handlers[0].l,
      explain: `Handled at node \u201c${handlers[0].l}\u201d in ${sym.qualified}. Evidence: ${ob.e}.`,
      symbols: [sym.id],
      obligations: [ob.id, handlers[0].id],
      evidence: [ob.e, handlers[0].e],
    });
  }

  /* ---------------- impact exercises ---------------- */
  const impactSeeds = model.symbols
    .filter((s) => !s.isTest && (s.kind === 'class' || s.kind === 'interface' || s.fanIn >= 6) && s.reach !== 'none')
    .sort((a, b) => b.fanIn - a.fanIn || (a.id < b.id ? -1 : 1))
    .slice(0, 20);
  for (const hub of impactSeeds) {
    const callers = [...new Set(model.edges.filter((e) => e.b === hub.id).map((e) => model.byId.get(e.a)).filter(Boolean))];
    if (callers.length < 2) continue;
    exercises.push({
      id: 'EX-I-' + hub.id.slice(1, 7),
      k: 'impact',
      level: 4,
      title: `Change surface of ${hub.name}`,
      prompt:
        `You must change the contract of ${hub.qualified} (${hub.kind}, ${hub.fanIn} callers, ${testReachCount(model, hub.id)} test symbols reach it). ` +
        `List every directly affected caller, every indirectly affected module, and the tests that would need updating.`,
      answer: callers.slice(0, 8).map((c) => c.qualified).join(', '),
      explain:
        `Direct callers: ${callers.slice(0, 6).map((c) => c.qualified).join(', ')}${callers.length > 6 ? ` (+${callers.length - 6} more)` : ''}. ` +
        `Evidence: ${hub.evidence}.`,
      symbols: [hub.id, ...callers.slice(0, 8).map((c) => c.id)],
      obligations: (bySymbol.get(hub.id) || []).filter((o) => o.crit >= 2).slice(0, 6).map((o) => o.id),
      evidence: [hub.evidence],
    });
  }

  /* ---------------- assessments ---------------- */
  for (let level = 1; level <= 5; level++) {
    const levelEx = exercises.filter((e) => e.level === level);
    const levelOb = obSet.obligations.filter((o) => o.st !== 'excluded' && levelForObligation(o) === level);
    assessments.push({
      id: 'AS-L' + level,
      level,
      kind: LEVEL_NAMES[level - 1],
      text: levelText(level),
      checks: levelChecks(level, levelOb, exercises),
      exercise: levelEx.map((e) => e.id),
      weight: level,
    });
  }

  return { objectives, storylines, exercises, assessments, levelNames: LEVEL_NAMES };
}

function levelForObligation(ob) {
  if (ob.t === 'symbol') return 1;
  if (ob.t === 'call-edge' || ob.t === 'return') return 2;
  if (ob.t === 'exception' || ob.t === 'throw' || ob.t === 'scenario') return 3;
  if (ob.t === 'e2e-path') return 4;
  if (ob.t === 'branch' || ob.t === 'loop') return 2;
  return 1;
}

function levelText(level) {
  return [
    'Repository Literacy: locate entry points, modules and the symbols that carry the main responsibilities.',
    'Execution Literacy: trace calls, control flow and data across module boundaries and explain each branch.',
    'Failure Diagnosis: follow an error from its origin to the terminal the caller observes.',
    'Change Impact Reasoning: predict everything that breaks before you edit a symbol or contract.',
    'Independent Maintenance: design the change, apply it, add tests and prove no regression.',
  ][level - 1];
}

function levelChecks(level, obs, exercises) {
  const total = obs.length;
  const covered = obs.filter((o) => o.st === 'covered').length;
  const base = [`${covered}/${total} level-${level} obligations carry a witness in this package`];
  if (level === 3) base.push('Answer every diagnosis exercise without opening the coverage atlas');
  if (level === 4) base.push('Produce an impact list that contains no missing direct caller');
  if (level === 5) base.push('Complete at least one maintenance task with a patch description and a test plan');
  const ex = exercises.filter((e) => e.level === level);
  if (ex.length) base.push(`${ex.length} exercises gate this level`);
  return base;
}

function count(list, status) {
  return list.filter((o) => o.st === status).length;
}

function shortPkg(pkg) {
  return String(pkg).replace(/^@/, '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24) || 'root';
}

function shortFile(rel) {
  const parts = rel.split('/');
  return parts.slice(-2).join('/');
}

function trim(s, n) {
  const t = String(s).replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n - 1) + '\u2026' : t;
}

function shuffleDeterministic(items, seed) {
  return items
    .map((x) => ({ x, k: hashUnit(String(x.text) + String(x.id), seed) }))
    .sort((a, b) => a.k - b.k)
    .map((v) => v.x);
}

function testReachCount(model, id) {
  let n = 0;
  for (const e of model.edges) if (e.b === id && model.byId.get(e.a)?.isTest) n++;
  return n;
}

export { LEVEL_NAMES };
