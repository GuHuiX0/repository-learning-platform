/**
 * Path planner — candidate generation + lazy greedy set cover.
 *
 * A path witness = a call chain from a declared entry point to a terminal,
 * plus an explicit CFG route per symbol (one outcome per branch). A single
 * path can only take one direction per branch, so both directions of a branch
 * require two paths — this is recorded, not smoothed over.
 *
 * Candidates: for every chain-reachable symbol, one candidate per CFG route.
 * Selection: lazy greedy with a max-heap (deterministic tie-break by candidate
 * id), bounded by a path budget. Whatever the budget cannot reach is reported
 * as uncovered with a reason.
 */
import { TYPE_PRIORITY } from './obligations.mjs';

const EDGE_OUTCOME = {
  true: 'true', false: 'false', left: 'left', right: 'right',
  defined: 'defined', undefined: 'undefined',
  'loop-exit': 'zero-iteration', 'loop-body': 'iterate',
  default: 'default',
};

export function routeOutcome(edgeKind) {
  if (EDGE_OUTCOME[edgeKind]) return EDGE_OUTCOME[edgeKind];
  if (edgeKind.startsWith('case:')) return edgeKind;
  return null;
}

/* ------------------------------------------------------------------ */
/* call chains (reverse BFS from entry points)                        */
/* ------------------------------------------------------------------ */

export function buildChains(model) {
  const adj = new Map();
  for (const e of model.edges) {
    if (!adj.has(e.a)) adj.set(e.a, []);
    adj.get(e.a).push(e.b);
  }
  for (const list of adj.values()) list.sort();

  const chains = new Map();
  const chainFor = (id, parentMap) => {
    const chain = [];
    let cur = id;
    let guard = 0;
    while (cur && guard++ < 64) {
      chain.push(cur);
      cur = parentMap.get(cur);
    }
    return chain.reverse();
  };

  // Forward BFS from entry points: parent[b] = the caller that first reached b,
  // so following parents walks back to a declared entry.
  const fromEntries = bfsForward(model.entrySymbols, adj);
  for (const id of fromEntries.keys()) chains.set(id, chainFor(id, fromEntries));

  const testStarts = new Set();
  for (const s of model.symbols) if (s.isTest && !chains.has(s.id)) testStarts.add(s.id);
  if (testStarts.size) {
    const fromTests = bfsForward(testStarts, adj);
    for (const id of fromTests.keys()) if (!chains.has(id)) chains.set(id, chainFor(id, fromTests));
  }
  return chains;
}

function bfsForward(starts, adj) {
  const parent = new Map();
  const seen = new Set(starts);
  const queue = [...starts].sort();
  for (const s of queue) parent.set(s, null);
  for (let i = 0; i < queue.length; i++) {
    const cur = queue[i];
    for (const n of adj.get(cur) || []) {
      if (seen.has(n)) continue;
      seen.add(n);
      parent.set(n, cur);
      queue.push(n);
    }
  }
  return parent;
}

/* ------------------------------------------------------------------ */
/* CFG routes                                                         */
/* ------------------------------------------------------------------ */

const ROUTE_CACHE = new WeakMap();

export function routesOf(sym, opts = {}) {
  if (ROUTE_CACHE.has(sym)) return ROUTE_CACHE.get(sym);
  const routes = enumerateRoutes(sym, opts);
  ROUTE_CACHE.set(sym, routes);
  return routes;
}

function enumerateRoutes(sym, opts = {}) {
  const maxRoutes = opts.maxRoutes ?? 8;
  const maxSteps = opts.maxSteps ?? 4000;
  const maxDepth = opts.maxDepth ?? 90;
  const cfg = sym.cfg;
  if (!cfg || cfg.aborted) return [];

  const adj = new Map();
  for (const e of cfg.edges) {
    if (!adj.has(e.f)) adj.set(e.f, []);
    adj.get(e.f).push(e);
  }
  for (const list of adj.values()) {
    list.sort((a, b) => (a.k < b.k ? -1 : a.k > b.k ? 1 : a.t < b.t ? -1 : a.t > b.t ? 1 : 0));
  }

  const start = cfg.nodes[0]?.id ?? 'n0';
  const exitId = cfg.nodes.find((n) => n.k === 'exit')?.id ?? null;
  const revisitAllowed = new Set(cfg.nodes.filter((n) => n.k === 'loop' || n.k === 'merge').map((n) => n.id));

  const routes = [];
  const seenRoutes = new Set();
  let steps = 0;

  const record = (nodes, outcomes) => {
    if (!nodes.length) return;
    const key = nodes.join(',');
    if (seenRoutes.has(key)) return;
    seenRoutes.add(key);
    const oc = {};
    for (const o of outcomes) oc[o.node] = o.outcome;
    routes.push({ nodes: nodes.slice(), outcomes: oc, len: nodes.length });
  };

  const dfs = (node, path, outcomes, visits) => {
    if (routes.length >= maxRoutes || steps >= maxSteps) return;
    steps++;
    if (node === exitId || path.length > maxDepth) return record(path, outcomes);
    let advanced = false;
    for (const e of adj.get(node) || []) {
      const limit = revisitAllowed.has(e.t) ? 2 : 1;
      if ((visits.get(e.t) || 0) >= limit) continue;
      advanced = true;
      const oc = routeOutcome(e.k);
      path.push(e.t);
      if (oc) outcomes.push({ node, outcome: oc });
      visits.set(e.t, (visits.get(e.t) || 0) + 1);
      dfs(e.t, path, outcomes, visits);
      visits.set(e.t, visits.get(e.t) - 1);
      if (oc) outcomes.pop();
      path.pop();
      if (routes.length >= maxRoutes || steps >= maxSteps) return;
    }
    if (!advanced) record(path, outcomes);
  };

  const visits = new Map([[start, 1]]);
  dfs(start, [start], [], visits);
  if (!routes.length) routes.push({ nodes: [start], outcomes: {}, len: 1 });
  routes.sort((a, b) => a.len - b.len || (a.nodes.join(',') < b.nodes.join(',') ? -1 : 1));
  return routes.slice(0, maxRoutes);
}

/* ------------------------------------------------------------------ */
/* planning                                                           */
/* ------------------------------------------------------------------ */

export function planPathSuite(model, obSet, opts = {}) {
  const maxPaths = opts.maxPaths ?? 1200;
  const maxRoutesPerSymbol = opts.maxRoutes ?? 8;
  const includeTests = !!opts.includeTests;
  const chains = buildChains(model);
  const obligations = obSet.obligations;
  const bySymbol = obSet.bySymbol;

  const edgeKind = new Map();
  for (const e of model.edges) edgeKind.set(e.a + '>' + e.b, e.k);
  const obIndex = new Map();
  for (const ob of obligations) obIndex.set(ob.id, ob);

  // Split obligations: analysed vs. out of target.
  const live = [];
  for (const ob of obligations) {
    if (ob.st === 'excluded' || ob.st === 'infeasible' || ob.st === 'unknown') continue;
    if (!includeTests && model.byId.get(ob.s)?.isTest) { ob.st = 'excluded'; ob.r = 'test-harness code outside the maintenance target'; continue; }
    if (!chains.has(ob.s)) {
      ob.st = 'uncovered';
      ob.r = 'no call chain from a declared entry point (symbol is not reachable in the static call graph)';
      continue;
    }
    live.push(ob);
  }

  const covered = new Set();
  const candidates = [];

  /* ---- layer split ---------------------------------------------------
     1. Structural obligations (symbol / call-edge / end-to-end) are covered
        by the existence of a static chain from a declared entry point. That
        chain is itself the path witness, so no route choice is needed.
     2. Direction-specific obligations (branch / loop / exception / return /
        throw / scenario) need an explicit route in a selected path, because a
        single execution can only take one direction per branch.
     The two layers are counted separately and never blended.               */
  const STRUCTURAL = new Set(['symbol', 'call-edge', 'e2e-path']);
  const directional = [];
  for (const ob of live) {
    if (STRUCTURAL.has(ob.t)) {
      covered.add(ob.id);
      ob.st = 'covered';
      ob.w = ob.w === 'test' ? 'test' : 'chain';
      delete ob.r;
    } else {
      directional.push(ob);
    }
  }
  const directionWeight = (ob) => Math.max(1, ob.crit || 1);

  const routeOf = (symId, idx) => {
    const sym = model.byId.get(symId);
    if (!sym || !sym.cfg) return null;
    const routes = routesOf(sym, { maxRoutes: maxRoutesPerSymbol });
    return routes[Math.min(idx, routes.length - 1)] || null;
  };

  /* Direction obligations covered by one symbol route. */
  const coversFor = (symId, route) => {
    const ids = new Set();
    const list = bySymbol.get(symId) || [];
    const scenarioGroups = new Map();
    for (const ob of list) {
      if (ob.st === 'excluded' || ob.st === 'infeasible' || ob.st === 'unknown') continue;
      if (ob.t === 'branch' || ob.t === 'loop') {
        if (route && route.outcomes[ob.n] === ob.o) ids.add(ob.id);
      } else if (ob.t === 'exception' || ob.t === 'throw' || ob.t === 'return') {
        if (route && route.nodes.includes(ob.n)) ids.add(ob.id);
      } else if (ob.t === 'scenario') {
        if (!route || !route.nodes.includes(ob.n)) continue;
        if (!scenarioGroups.has(ob.n)) scenarioGroups.set(ob.n, []);
        scenarioGroups.get(ob.n).push(ob);
      }
    }
    for (const [, group] of scenarioGroups) ids.add(group[0].id); // other outcomes need their own path
    return ids;
  };

  // Candidates: one per (symbol, route) for symbols carrying direction obligations.
  const symbolsWithDirections = new Set(directional.map((o) => o.s));
  for (const symId of symbolsWithDirections) {
    const chain = chains.get(symId);
    if (!chain || !chain.length) continue;
    let routes = routesOf(model.byId.get(symId), { maxRoutes: maxRoutesPerSymbol });
    if (!routes.length) routes = [null];
    let routeIdx = 0;
    for (const route of routes) {
      const ids = new Set();
      for (let i = 0; i < chain.length; i++) {
        const chainSym = chain[i];
        const r = chainSym === symId ? route : routeOf(chainSym, 0);
        for (const id of coversFor(chainSym, r)) ids.add(id);
      }
      const weight = [...ids].reduce((a, id) => a + directionWeight(obIndex.get(id) || {}), 0);
      candidates.push({
        idx: candidates.length,
        symId,
        routeIdx,
        chain,
        route,
        label: route ? route.nodes.join('>') : '',
        covers: [...ids],
        gain: weight,
      });
      routeIdx++;
    }
  }

  /* ---- lazy greedy set cover (criticality-weighted) ---- */
  const weightOf = (id) => {
    const ob = obIndex.get(id);
    return ob ? Math.max(1, ob.crit || 1) : 1;
  };
  candidates.sort((a, b) => b.covers.length - a.covers.length || a.idx - b.idx);
  const selected = [];
  let guard = 0;
  const heap = candidates.map((c) => ({ c, key: -weightedGain(c, covered, weightOf) - tieBreak(c) }));
  heapify(heap);

  while (heap.length && selected.length < maxPaths && guard++ < maxPaths * 40) {
    const top = pop(heap);
    if (!top) break;
    const c = top.c;
    const gain = weightedGain(c, covered, weightOf);
    if (gain <= 0) continue;
    if (heap.length && gain + tieBreak(c) < -peek(heap).key) {
      push(heap, { c, key: -(gain + tieBreak(c)) });
      continue;
    }
    selected.push(c);
    for (const id of c.covers) covered.add(id);
  }

  /* ---- rank the selection: production before test-driven, then reach ---- */
  const originOf = (c) => (model.byId.get(c.chain[0])?.isTest ? 'test' : 'production');
  selected.sort((a, b) => {
    const oa = originOf(a) === 'production' ? 0 : 1;
    const ob = originOf(b) === 'production' ? 0 : 1;
    if (oa !== ob) return oa - ob;
    return b.covers.length - a.covers.length || a.idx - b.idx;
  });

  /* ---- materialise selected paths ---- */
  const paths = [];
  let n = 0;
  for (const c of selected) {
    n++;
    const steps = [];
    let mayReach = false;
    for (let i = 0; i < c.chain.length; i++) {
      const sym = model.byId.get(c.chain[i]);
      if (!sym || !sym.cfg) continue;
      const r = c.chain[i] === c.symId ? c.route : routeOf(c.chain[i], 0);
      if (!r) continue;
      const nodeById = new Map(sym.cfg.nodes.map((x) => [x.id, x]));
      const interesting = r.nodes.filter((id) => {
        const nd = nodeById.get(id);
        return nd && ['entry', 'branch', 'loop', 'catch', 'return', 'throw', 'switch', 'case', 'exit'].includes(nd.k);
      });
      const shown = (interesting.length ? interesting : r.nodes.slice(0, 3)).slice(0, 10);
      for (const id of shown) {
        const nd = nodeById.get(id);
        steps.push({
          s: sym.id, f: sym.rel, n: id,
          o: r.outcomes[id] || '',
          l: nd ? nd.l : '',
          e: sym.evidence,
        });
      }
      const next = c.chain[i + 1];
      if (next && edgeKind.get(sym.id + '>' + next) === 'may-reach') mayReach = true;
    }
    const entrySym = displaySymbol(model, c.chain, false);
    const termSym = displaySymbol(model, c.chain, true);
    const covers = c.covers.filter((id) => covered.has(id));
    paths.push({
      id: 'P-' + String(n).padStart(4, '0'),
      entry: c.chain[0],
      terminal: c.chain[c.chain.length - 1],
      title: (entrySym ? entrySym.name : 'entry') + ' \u2192 ' + (termSym ? termSym.name : '?') + ': ' + pivotOf(bySymbol.get(c.symId), c.route),
      origin: originOf(c),
      steps,
      covers,
      symbols: c.chain,
      length: steps.length,
      tier: tierOf(c),
      witness: mayReach ? 'may-reach' : 'modelled',
      pivot: c.symId,
    });
  }

  /* ---- final statuses: direction layer only (structural already settled) ---- */
  for (const ob of directional) {
    if (covered.has(ob.id)) {
      ob.st = 'covered';
      ob.w = ob.w === 'test' ? 'test' : 'path';
      delete ob.r;
    } else {
      ob.st = 'uncovered';
      ob.r = ob.r || 'no route selected within the path budget (path suite cap reached)';
    }
  }
  for (const ob of obligations) if (ob.st === 'covered' && !ob.w) ob.w = 'chain';

  return { paths, chains, coveredCount: covered.size, candidates: candidates.length };
}

function weightedGain(c, covered, weightOf) {
  let g = 0;
  for (const id of c.covers) if (!covered.has(id)) g += weightOf(id);
  return g;
}

function tieBreak(c) {
  // Deterministic jitter so equal-gain candidates resolve stably.
  let h = 0;
  for (let i = 0; i < c.label.length; i++) h = (h * 31 + c.label.charCodeAt(i)) >>> 0;
  return (h % 1000) / 1e6;
}

/** Display name: skip closure/module wrappers so titles read like source. */
function displaySymbol(model, chain, fromEnd) {
  const order = fromEnd ? chain.slice().reverse() : chain;
  let fallback = null;
  for (const id of order) {
    const s = model.byId.get(id);
    if (!s) continue;
    if (!fallback) fallback = cleanName(s);
    if (s.kind !== 'closure' && s.kind !== 'module') return { name: cleanName(s) };
  }
  return fallback ? { name: fallback } : null;
}

/** Human name: drop closure suffixes (~fn$arg2) so titles read like source. */
function cleanName(sym) {
  let n = String(sym.qualified || sym.name || '?');
  const tilde = n.indexOf('~');
  if (tilde > 0) n = n.slice(0, tilde);
  const dollar = n.indexOf('$');
  if (dollar > 0) n = n.slice(0, dollar);
  return n.split('.').pop() || n;
}

function pivotOf(list, route) {
  if (!list) return '';
  for (const ob of list) {
    if ((ob.t === 'branch' || ob.t === 'loop') && route && route.outcomes[ob.n] === ob.o) return ob.l.slice(0, 70);
    if (ob.t === 'scenario' && route && route.nodes.includes(ob.n)) return ob.l.slice(0, 70);
  }
  return list[0]?.l?.slice(0, 70) || '';
}

function tierOf(c) {
  if (c.chain.length >= 4) return 4;
  return Math.min(5, Math.max(1, c.chain.length + 1));
}

/* ------------------------------------------------------------------ */
/* binary heap (min-key)                                              */
/* ------------------------------------------------------------------ */

function heapify(h) {
  for (let i = (h.length >> 1) - 1; i >= 0; i--) siftDown(h, i);
}
function push(h, v) {
  h.push(v);
  let i = h.length - 1;
  while (i > 0) {
    const p = (i - 1) >> 1;
    if (h[p].key <= h[i].key) break;
    [h[p], h[i]] = [h[i], h[p]];
    i = p;
  }
}
function pop(h) {
  if (!h.length) return null;
  const top = h[0];
  const last = h.pop();
  if (h.length) { h[0] = last; siftDown(h, 0); }
  return top;
}
function peek(h) { return h[0]; }
function siftDown(h, i) {
  for (;;) {
    const l = i * 2 + 1;
    const r = l + 1;
    let m = i;
    if (l < h.length && h[l].key < h[m].key) m = l;
    if (r < h.length && h[r].key < h[m].key) m = r;
    if (m === i) break;
    [h[m], h[i]] = [h[i], h[m]];
    i = m;
  }
}

