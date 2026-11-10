/**
 * Coverage dashboard + evidence semantics.
 *
 * Three things are never blended:
 *   analysis coverage (what the analyser indexed),
 *   curriculum coverage (what the path suite can witness),
 *   mastery coverage (what the learner proved — produced at runtime only).
 */
export function buildReport(model, obSet, plan, learning, maintenance) {
  const dims = ['symbol', 'call-edge', 'branch', 'scenario', 'e2e-path', 'exception', 'loop', 'return', 'throw'];
  const coverage = {};
  const evidenceKind = { chain: 0, path: 0, test: 0 };
  for (const d of dims) {
    let total = 0, covered = 0, uncovered = 0, unknown = 0, excluded = 0, infeasible = 0;
    for (const ob of obSet.obligations) {
      if (ob.t !== d) continue;
      total++;
      if (ob.st === 'covered') covered++;
      else if (ob.st === 'uncovered') uncovered++;
      else if (ob.st === 'unknown') unknown++;
      else if (ob.st === 'excluded') excluded++;
      else if (ob.st === 'infeasible') infeasible++;
      if (ob.st === 'covered' && ob.w) evidenceKind[ob.w] = (evidenceKind[ob.w] || 0) + 1;
    }
    const denom = Math.max(0, total - excluded - infeasible);
    coverage[d] = {
      total,
      covered,
      uncovered,
      unknown,
      excluded,
      infeasible,
      denominator: denom,
      pct: denom ? Math.round((covered / denom) * 1000) / 10 : 0,
    };
  }

  // Layer split: direction obligations are the hard part.
  const directional = obSet.obligations.filter((o) => ['branch', 'loop', 'scenario', 'exception', 'throw', 'return'].includes(o.t));
  const directionalOpen = directional.filter((o) => o.st === 'uncovered');
  const dirDenom = directional.filter((o) => o.st !== 'excluded' && o.st !== 'infeasible').length;

  const structural = obSet.obligations.filter((o) => ['symbol', 'call-edge', 'e2e-path'].includes(o.t));
  const structDenom = structural.filter((o) => o.st !== 'excluded' && o.st !== 'infeasible').length;

  const allLive = obSet.obligations.filter((o) => o.st !== 'excluded' && o.st !== 'infeasible');
  const unknownRatio = allLive.length ? Math.round((allLive.filter((o) => o.st === 'unknown').length / allLive.length) * 1000) / 10 : 0;

  const criticalGaps = obSet.obligations.filter((o) => (o.crit || 1) >= 2 && o.st === 'uncovered');

  const levels = [];
  const levelNames = ['Repository Literacy', 'Execution Literacy', 'Failure Diagnosis', 'Change Impact Reasoning', 'Independent Maintenance'];
  for (let level = 1; level <= 5; level++) {
    const obs = obSet.obligations.filter((o) => o.st !== 'excluded' && levelOf(o) === level);
    const cov = obs.filter((o) => o.st === 'covered');
    const kinds = new Set();
    for (const o of cov) kinds.add(o.w === 'path' ? 'path-suite witness' : o.w === 'test' ? 'test-call witness' : 'static call chain');
    if (plan.paths.length && level >= 2) kinds.add('CFG route');
    levels.push({
      level,
      name: levelNames[level - 1],
      obligations: obs.length,
      covered: cov.length,
      pct: obs.length ? Math.round((cov.length / obs.length) * 1000) / 10 : 0,
      evidence_kinds: [...kinds],
      exercises: learning.exercises.filter((e) => e.level === level).length,
    });
  }

  const policy = [
    'Static path evidence is not runtime coverage. Every obligation records its witness kind: static call chain, CFG route, or test call.',
    'may-reach edges come from Rapid Type Analysis (instantiating a class makes its methods reachable). Paths that depend on them are labelled may-reach, never modelled.',
    'Loops are abstracted to zero-iteration / iterate; unbounded path coverage is not claimed.',
    'Dynamic dispatch, runtime registration and string-keyed references stay Unknown with the reason recorded.',
    'Test-harness code is indexed but excluded from the maintenance target by default (configurable with --include-tests).',
    `Path suite is bounded (${plan.paths.length} paths). Uncovered direction obligations are reported with a reason, never rounded away.`,
  ];

  // Reachability classes: the honest denominator for "what can static analysis promise".
  const reachCounts = { entry: 0, test: 0, none: 0 };
  for (const s of model.symbols) if (!s.isTest) reachCounts[s.reach === undefined ? 'none' : s.reach] += 1;
  const reachability = {
    entry_reachable: reachCounts.entry,
    test_reachable: reachCounts.test,
    unproven: reachCounts.none,
    unproven_pct: model.symbols.length ? Math.round((reachCounts.none / Math.max(1, model.symbols.filter((s) => !s.isTest).length)) * 1000) / 10 : 0,
    note: 'symbols not reachable in the syntactic call graph are reported Unknown, never as "dead" or "uncovered"',
  };

  return {
    reachability,
    coverage,
    layers: {
      structural: {
        total: structural.length,
        denominator: structDenom,
        covered: structural.filter((o) => o.st === 'covered').length,
        pct: structDenom ? Math.round((structural.filter((o) => o.st === 'covered').length / structDenom) * 1000) / 10 : 0,
      },
      directional: {
        total: directional.length,
        denominator: dirDenom,
        covered: directional.filter((o) => o.st === 'covered').length,
        open: directionalOpen.length,
        pct: dirDenom ? Math.round((directional.filter((o) => o.st === 'covered').length / dirDenom) * 1000) / 10 : 0,
      },
    },
    evidence_kinds: evidenceKind,
    unknown_ratio: unknownRatio,
    critical_gaps: criticalGaps.length,
    critical_gap_sample: criticalGaps.slice(0, 40).map((o) => ({ id: o.id, l: o.l, f: o.f, cat: o.cat, r: o.r })),
    levels,
    policy,
    resolution: {
      resolved_call_edges: model.stats.resolvedCalls,
      unresolved_call_sites: model.stats.unresolvedCalls,
      unresolved_ratio: Math.round(model.stats.unknownRatio * 1000) / 10,
      may_reach_edges: model.stats.mayReachEdges || 0,
    },
  };
}

function levelOf(ob) {
  if (ob.t === 'symbol') return 1;
  if (ob.t === 'call-edge' || ob.t === 'return' || ob.t === 'branch' || ob.t === 'loop') return 2;
  if (ob.t === 'exception' || ob.t === 'throw' || ob.t === 'scenario') return 3;
  if (ob.t === 'e2e-path') return 4;
  return 1;
}
