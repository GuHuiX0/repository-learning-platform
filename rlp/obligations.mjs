/**
 * Coverage obligations — the unit the whole platform is accountable for.
 *
 * An obligation is a source fact a learner must be able to explain, trace or
 * verify. Obligations are derived from the CFG (branch/loop/exception/return),
 * from external scenario anchors, from resolved call edges, and from
 * end-to-end path reachability. Never from "interesting examples".
 */
import { evidenceId, sortBy } from './util.mjs';

const CATEGORY_RULES = [
  [/permission|authori[sz]|authent|credential|secret|api.?key|token|sanitiz|trust|allowlist|approved|policy|security|deny|forbidden|privilege/i, 'security'],
  [/writeFile|readFile|readdir|existsSync|mkdir|rmSync|storage|persist|save|load|database|sqlite|checkpoint|snapshot|\.json\b|\.gemini\b/i, 'persistence'],
  [/fetch|request|https?|endpoint|stream|socket|mcp|model|gemini|openai|server|client\./i, 'network'],
  [/catch|error|err\b|throw|retry|fallback|fail|reject|abort/i, 'error-handling'],
  [/\?\?|\?\./, 'null-safety'],
  [/config|settings|option|flag|env\b|process\.env/i, 'config'],
  [/render|component|\bText\b|ink|display|ui\b|prompt|output/i, 'ui'],
  [/this\.[A-Za-z_$]/, 'state'],
];

function categorize(label) {
  for (const [re, cat] of CATEGORY_RULES) if (re.test(label)) return cat;
  return 'none';
}

const TYPE_PRIORITY = {
  branch: 5, scenario: 5, exception: 4, loop: 3, return: 2, throw: 3, 'call-edge': 2, 'e2e-path': 4, symbol: 1, maintenance: 3,
};

export function buildObligations(model, opts = {}) {
  const includeTests = !!opts.includeTests;
  const obligations = [];
  const bySymbol = new Map();
  const scenariosBySymbol = new Map();
  for (const sc of model.scenarios) {
    if (!scenariosBySymbol.has(sc.s)) scenariosBySymbol.set(sc.s, []);
    scenariosBySymbol.get(sc.s).push(sc);
  }

  const outEdges = new Map();
  for (const sym of model.symbols) {
    if (!sym.cfg) continue;
    for (const e of sym.cfg.edges) {
      if (!outEdges.has(sym.id)) outEdges.set(sym.id, []);
      outEdges.get(sym.id).push(e);
    }
  }

  const push = (ob) => {
    ob.crit = ob.crit ?? criticality(ob, model);
    obligations.push(ob);
    if (!bySymbol.has(ob.s)) bySymbol.set(ob.s, []);
    bySymbol.get(ob.s).push(ob);
  };

  for (const sym of model.symbols) {
    if (!sym.cfg || sym.cfg.aborted) continue;
    const excluded = sym.isTest && !includeTests;
    const base = {
      s: sym.id,
      f: sym.rel,
      t: 'branch',
      st: 'covered',
      w: sym.reach === 'entry' ? 'production' : sym.reach === 'test' ? 'test' : 'none',
    };

    const nodeById = new Map(sym.cfg.nodes.map((n) => [n.id, n]));

    for (const n of sym.cfg.nodes) {
      if (n.un) {
        push({
          ...base,
          id: evidenceId('ob', sym.id, n.id, 'unreachable').replace('E-', 'CO-'),
          t: 'branch', n: n.id, o: 'unreachable', l: n.l,
          st: 'infeasible', r: 'control flow terminates before this node',
          e: evidenceId(sym.rel, sym.qualified, n.id),
          cat: categorize(n.l),
        });
        continue;
      }

      if (n.k === 'branch') {
        for (const o of outcomesOf(n.l)) {
          push({
            ...base,
            id: obId(sym.id, n.id, o),
            t: 'branch', n: n.id, o, l: n.l,
            e: evidenceId(sym.rel, sym.qualified, n.id, o),
            cat: categorize(n.l),
            st: excluded ? 'excluded' : 'covered',
            r: excluded ? 'test-harness code outside the maintenance target' : undefined,
          });
        }
      } else if (n.k === 'loop') {
        for (const o of ['zero-iteration', 'iterate']) {
          push({
            ...base,
            id: obId(sym.id, n.id, o),
            t: 'loop', n: n.id, o, l: n.l,
            e: evidenceId(sym.rel, sym.qualified, n.id, o),
            cat: categorize(n.l),
            st: excluded ? 'excluded' : 'covered',
            r: excluded ? 'test-harness code outside the maintenance target' : undefined,
          });
        }
      } else if (n.k === 'catch') {
        push({
          ...base,
          id: obId(sym.id, n.id, 'handler'),
          t: 'exception', n: n.id, o: 'handler', l: n.l,
          e: evidenceId(sym.rel, sym.qualified, n.id, 'handler'),
          cat: 'error-handling',
          st: excluded ? 'excluded' : 'covered',
          r: excluded ? 'test-harness code outside the maintenance target' : undefined,
        });
      } else if (n.k === 'return') {
        push({
          ...base,
          id: obId(sym.id, n.id, 'terminal'),
          t: 'return', n: n.id, o: 'terminal', l: n.l,
          e: evidenceId(sym.rel, sym.qualified, n.id, 'terminal'),
          cat: categorize(n.l),
          st: excluded ? 'excluded' : 'covered',
        });
      } else if (n.k === 'throw') {
        push({
          ...base,
          id: obId(sym.id, n.id, 'raise'),
          t: 'throw', n: n.id, o: 'raise', l: n.l,
          e: evidenceId(sym.rel, sym.qualified, n.id, 'raise'),
          cat: 'error-handling',
          st: excluded ? 'excluded' : 'covered',
        });
      } else if (n.k === 'switch') {
        const outs = (outEdges.get(sym.id) || []).filter((e) => e.f === n.id);
        for (const e of outs) {
          push({
            ...base,
            id: obId(sym.id, n.id, e.k),
            t: 'branch', n: n.id, o: e.k, l: n.l + ' \u2192 ' + e.k,
            e: evidenceId(sym.rel, sym.qualified, n.id, e.k),
            cat: categorize(n.l),
            st: excluded ? 'excluded' : 'covered',
          });
        }
      }
      void nodeById;
    }

    // Scenario anchors (external results) inside this symbol.
    for (const sc of scenariosBySymbol.get(sym.id) || []) {
      for (const o of sc.outcomes) {
        push({
          ...base,
          id: obId(sym.id, 'sc:' + sc.n + ':' + sc.callee, o),
          t: 'scenario', n: sc.n, o, l: sc.label,
          e: evidenceId(sym.rel, sym.qualified, sc.n, sc.callee, o),
          cat: sc.cat,
          st: excluded ? 'excluded' : 'covered',
          r: excluded ? 'test-harness code outside the maintenance target' : undefined,
        });
      }
    }

    // Symbol-level: is this unit indexed and explained at all?
    if (!sym.isTest || includeTests) {
      push({
        ...base,
        id: obId(sym.id, 'self', 'invoked'),
        t: 'symbol', n: '', o: 'invoked', l: (sym.kind + ' ' + sym.qualified).slice(0, 120),
        e: sym.evidence,
        cat: 'none',
        st: excluded ? 'excluded' : 'covered',
      });
    }

    // End-to-end: a full entry→terminal path through this symbol.
    push({
      ...base,
      id: obId(sym.id, 'e2e', 'entry-to-terminal'),
      t: 'e2e-path', n: '', o: 'entry-to-terminal', l: 'entry \u2192 ' + sym.qualified + ' \u2192 terminal',
      e: sym.evidence,
      cat: 'none',
      st: excluded ? 'excluded' : 'covered',
      r: excluded ? 'test-harness code outside the maintenance target' : undefined,
    });
  }

  // Call-edge obligations: every resolved relationship must be traceable.
  for (const e of model.edges) {
    const a = model.byId.get(e.a);
    const b = model.byId.get(e.b);
    if (!a || !b) continue;
    const excluded = (a.isTest || b.isTest) && !includeTests;
    push({
      id: obId(e.a, 'edge', e.b),
      s: e.a, f: a.rel, t: 'call-edge', n: '', o: e.k,
      a: e.a, b: e.b,
      l: a.qualified + ' \u2192 ' + b.qualified,
      st: excluded ? 'excluded' : 'covered',
      w: a.reach === 'entry' ? 'production' : 'test',
      e: evidenceId(a.rel, a.qualified, 'calls', b.qualified),
      cat: 'none',
      r: excluded ? 'edge touches test-harness code' : undefined,
    });
  }

  /* ---- status refinement for symbols with no static chain ----
     A symbol the syntactic call graph cannot reach is *not* proven dead: the
     repository may reach it through dependency injection, a registry, a plugin
     or a string-keyed lookup. Calling that "uncovered" would claim a certainty
     the analysis does not have, so it is reported as Unknown with the reason. */
  for (const ob of obligations) {
    if (ob.st === 'excluded' || ob.st === 'infeasible') continue;
    const sym = model.byId.get(ob.s);
    if (!sym) continue;
    if (sym.reach === 'none') {
      const name = sym.name;
      const dyn = name && name.length > 3 && model.stringIndex.has(name);
      ob.st = 'unknown';
      ob.r = dyn
        ? 'reachability unproven: no static chain from a declared entry point, and \u201c' + name + '\u201d appears as a runtime string literal'
        : 'reachability unproven: no static chain from a declared entry point (dynamic dispatch / registry wiring is not modelled)';
    }
  }

  sortBy(obligations, (o) => o.id);
  return { obligations, bySymbol, total: obligations.length };
}

function obId(...parts) {
  return 'CO-' + evidenceId(...parts).slice(2);
}

function outcomesOf(label) {
  if (label.startsWith('&&')) return ['true', 'false'];
  if (label.startsWith('||')) return ['true', 'false'];
  if (label.startsWith('??')) return ['left', 'right'];
  if (label.startsWith('?.')) return ['defined', 'undefined'];
  return ['true', 'false'];
}

function criticality(ob, model) {
  const sym = model.byId.get(ob.s);
  let crit = 1;
  if (ob.cat === 'security' || ob.cat === 'persistence') crit = 2;
  if (ob.cat === 'network') crit = 2;
  if (sym) {
    if ((ob.cat === 'security' || ob.cat === 'persistence') && sym.reach === 'entry' && sym.fanIn >= 2) crit = 3;
    else if (sym.fanIn >= 8 && (ob.cat === 'security' || ob.cat === 'persistence' || ob.cat === 'error-handling')) crit = 3;
  }
  if (ob.t === 'e2e-path' && sym && sym.reach === 'entry') crit = Math.max(crit, 2);
  if (ob.t === 'call-edge' && sym && sym.fanIn >= 8) crit = 2;
  return crit;
}

export { TYPE_PRIORITY, categorize };
