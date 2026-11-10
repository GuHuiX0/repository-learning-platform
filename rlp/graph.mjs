/**
 * Cross-file graph assembly.
 *
 * Takes raw per-file analysis records and produces the unified model:
 * resolved call edges, entry-point reachability, dependency graph,
 * state/env data-flow channels and source evidence records.
 *
 * Everything that cannot be resolved syntactically is recorded as
 * `unknown` with a reason 鈥?never guessed.
 */
import fs from 'node:fs';
import path from 'node:path';
import { symId, evidenceId, collapse, sortBy } from './util.mjs';

const BUILTIN_GLOBALS = new Set([
  'fetch', 'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval', 'queueMicrotask',
  'structuredClone', 'parseInt', 'parseFloat', 'isNaN', 'encodeURIComponent', 'decodeURIComponent',
  'require', 'eval', 'atob', 'btoa', 'JSON', 'Object', 'Array', 'Promise', 'String', 'Number',
  'Boolean', 'Date', 'Math', 'RegExp', 'Error', 'Map', 'Set', 'WeakMap', 'WeakSet', 'Symbol',
  'BigInt', 'Intl', 'URL', 'URLSearchParams', 'TextEncoder', 'TextDecoder', 'Buffer', 'crypto',
  'performance', 'AbortController', 'AbortSignal', 'Headers', 'Request', 'Response', 'FormData',
  'Blob', 'File', 'ReadableStream', 'WritableStream', 'TransformStream', 'EventTarget', 'Event',
  'MessageChannel', 'MessagePort', 'Worker', 'process', 'console', 'globalThis', 'Deno', 'Bun',
]);

const EXTERNAL_CATEGORIES = [
  [/^node:fs(\/promises)?$/, 'filesystem'],
  [/^node:(http|https|http2|net|dns|tls)$/, 'network'],
  [/^node:child_process$/, 'process-spawn'],
  [/^node:(os|worker_threads|cluster|v8|perf_hooks)$/, 'process-host'],
  [/^node:crypto$/, 'crypto'],
  [/^node:(stream|readline|zlib|string_decoder)$/, 'io'],
  [/^node:(process|timers|util|path|url|events|assert)$/, 'runtime'],
  [/^(undici|axios|node-fetch|got|https-proxy-agent)$/, 'network'],
  [/^@google\/genai/, 'model-api'],
  [/^google-auth-library$/, 'auth'],
  [/^@modelcontextprotocol\//, 'mcp'],
  [/^(react|ink)(\/.*)?$/, 'ui'],
  [/^zod$/, 'validation'],
  [/^(simple-git|@octokit\/.*)$/, 'vcs'],
  [/^(open|clipboardy|chalk|yargs|commander)$/, 'ui'],
];

export const OUTCOMES_BY_CATEGORY = {
  network: ['success', 'error', 'timeout'],
  filesystem: ['success', 'error', 'empty'],
  'process-spawn': ['success', 'failure', 'error'],
  'model-api': ['success', 'error', 'rate-limited', 'blocked'],
  mcp: ['success', 'error', 'timeout'],
  auth: ['success', 'error'],
  validation: ['pass', 'fail'],
  ui: ['rendered'],
  io: ['success', 'error'],
  crypto: ['success', 'error'],
  'process-host': ['success', 'error'],
  vcs: ['success', 'error'],
  runtime: ['success', 'error'],
  'external-generic': ['success', 'error'],
  config: ['present', 'absent'],
};

export function categoryOfExternal(spec) {
  for (const [re, cat] of EXTERNAL_CATEGORIES) if (re.test(spec)) return cat;
  return 'external-generic';
}

/* ------------------------------------------------------------------ */
/* index construction                                                 */
/* ------------------------------------------------------------------ */

export function buildPackageIndex(repoRoot) {
  const pkgRoot = path.join(repoRoot, 'packages');
  const map = new Map(); // pkg name -> {dir(rel), entryFiles[]}
  const out = [];
  if (!fs.existsSync(pkgRoot)) return { map, list: out };

  const dirs = fs.readdirSync(pkgRoot, { withFileTypes: true }).filter((d) => d.isDirectory());
  for (const d of dirs) {
    const pj = path.join(pkgRoot, d.name, 'package.json');
    if (!fs.existsSync(pj)) continue;
    let json;
    try { json = JSON.parse(fs.readFileSync(pj, 'utf8')); } catch { continue; }
    if (!json.name) continue;
    const entryFiles = [];
    const pushTarget = (t) => {
      if (!t) return;
      const clean = String(t).replace(/^\.\//, '');
      const rel = 'packages/' + d.name + '/' + clean;
      const cands = [rel, rel.replace(/^dist\//, 'src/'), rel.replace(/\.js$/, '.ts'), rel.replace(/^dist\//, 'src/').replace(/\.js$/, '.ts')];
      for (const c of cands) entryFiles.push(c);
    };
    if (typeof json.bin === 'string') pushTarget(json.bin);
    else if (json.bin && typeof json.bin === 'object') for (const v of Object.values(json.bin)) pushTarget(v);
    if (typeof json.main === 'string') pushTarget(json.main);
    if (json.exports) {
      const walk = (v) => {
        if (typeof v === 'string') pushTarget(v);
        else if (v && typeof v === 'object') for (const x of Object.values(v)) walk(x);
      };
      walk(json.exports);
    }
    map.set(json.name, { name: json.name, dir: 'packages/' + d.name, entryFiles: [...new Set(entryFiles)], version: json.version });
    out.push({ name: json.name, dir: 'packages/' + d.name, version: json.version, bin: json.bin, deps: Object.keys(json.dependencies || {}) });
  }
  return { map, list: out };
}

function fileIndexRecords(files) {
  const byRel = new Map();
  for (const f of files) byRel.set(f.rel, f);
  return byRel;
}

function tryFile(byRel, base) {
  const cands = [base + '.ts', base + '.tsx', base + '.d.ts', base + '.js', base + '.mjs', base + '.cjs', base + '/index.ts', base + '/index.tsx', base + '/index.js'];
  for (const c of cands) {
    if (byRel.has(c)) return c;
  }
  return null;
}

export function resolveSpecifier(fromRel, spec, pkgIndex, byRel) {
  if (spec.startsWith('.')) {
    const dir = path.posix.dirname(fromRel);
    const base = path.posix.normalize(path.posix.join(dir, spec));
    const noExt = base.replace(/\.(js|jsx|mjs|cjs)$/, '');
    const hit = tryFile(byRel, noExt) || tryFile(byRel, base);
    return hit ? { kind: 'internal', target: hit } : { kind: 'internal-missing', target: null };
  }
  if (spec.startsWith('node:')) return { kind: 'external', externalId: spec };
  const pkgHit = [...pkgIndex.map.entries()].find(([name]) => spec === name || spec.startsWith(name + '/'));
  if (pkgHit) {
    const [name, info] = pkgHit;
    const rest = spec.slice(name.length).replace(/^\//, '');
    let target = null;
    if (!rest) {
      for (const e of info.entryFiles) {
        if (byRel.has(e)) { target = e; break; }
      }
      if (!target) target = tryFile(byRel, info.dir + '/index');
    } else {
      const clean = rest.replace(/^dist\//, 'src/').replace(/\.js$/, '');
      target = tryFile(byRel, info.dir + '/' + clean) || tryFile(byRel, info.dir + '/src/' + clean);
    }
    return target ? { kind: 'workspace', target } : { kind: 'workspace-missing', target: null, externalId: spec };
  }
  return { kind: 'external', externalId: spec };
}

/* ------------------------------------------------------------------ */
/* model                                                              */
/* ------------------------------------------------------------------ */

export function buildModel(files, repoMeta) {
  const { pkgIndex } = repoMeta;
  const byRel = fileIndexRecords(files);

  const symbols = [];
  const fileRecs = new Map(); // rel -> {rec, symbols: [], importMap: Map<local,{spec,imported}>, exportMap: Map<name, idx>}

  for (const f of files) {
    const rec = { rec: f, rel: f.rel, symbols: [], importMap: new Map(), exportMap: new Map(), localMap: new Map() };
    for (const s of f.symbols) {
      s.rel = f.rel;
      s.pkg = pkgOf(f.rel, pkgIndex);
      s.id = symId(f.rel, s.qualified);
      s.evidence = evidenceId(f.rel, s.qualified, s.kind);
      s.idx = symbols.length;
      s.isTest = f.isTest;
      s.fanIn = 0;
      s.fanOut = 0;
      symbols.push(s);
      rec.symbols.push(s);
      rec.localMap.set(s.name, s);
      if (s.exported) rec.exportMap.set(s.name, s);
      // Class members are also addressable by `Class#member` for `this.x()` calls.
      if (s.ownerClass) {
        if (!rec.classMembers) rec.classMembers = new Map();
        const key = s.ownerClass + '#' + s.name;
        if (!rec.classMembers.has(key)) rec.classMembers.set(key, s);
      }
    }
    fileRecs.set(f.rel, rec);
  }

  // Import maps + module-level dep edges.
  const importEdges = [];
  const externals = new Map(); // id -> {id, n, cat, c}
  for (const f of files) {
    const rec = fileRecs.get(f.rel);
    for (const imp of f.imports) {
      const res = resolveSpecifier(f.rel, imp.spec, pkgIndex, byRel);
      if (res.target) {
        importEdges.push({ a: f.rel, b: res.target, k: res.kind, w: imp.spec });
        for (const n of imp.names) rec.importMap.set(n.local, { spec: imp.spec, imported: n.imported, target: res.target, isTypeOnly: imp.isTypeOnly });
      } else {
        const extId = res.externalId || (res.kind === 'internal-missing' ? null : imp.spec);
        if (!extId) {
          for (const n of imp.names) rec.importMap.set(n.local, { spec: imp.spec, imported: n.imported, target: null, missing: true });
          continue;
        }
        const cat = categoryOfExternal(extId);
        const cur = externals.get(extId) || { id: extId, n: extId, cat, c: 0 };
        cur.c++;
        externals.set(extId, cur);
        for (const n of imp.names) rec.importMap.set(n.local, { spec: imp.spec, imported: n.imported, target: null, externalId: extId, isTypeOnly: imp.isTypeOnly });
      }
    }
    for (const re of f.reexports || []) {
      const res = resolveSpecifier(f.rel, re.spec, pkgIndex, byRel);
      if (res.target) importEdges.push({ a: f.rel, b: res.target, k: 'reexport', w: re.spec });
    }
  }

  /* ---- export resolution with one-hop-star support ---- */
  const exportCache = new Map();
  function resolveExport(rel, name, depth = 0) {
    if (depth > 4) return null;
    const key = rel + '#' + name;
    if (exportCache.has(key)) return exportCache.get(key);
    exportCache.set(key, null);
    const rec = fileRecs.get(rel);
    if (!rec) return null;
    if (rec.exportMap.has(name)) {
      const hit = rec.exportMap.get(name).id;
      exportCache.set(key, hit);
      return hit;
    }
    const f = rec.rec;
    for (const re of f.reexports || []) {
      if (re.names && re.names.length) {
        const hit = re.names.find((n) => n.local === name || n.imported === name);
        if (hit) {
          const res = resolveSpecifier(rel, re.spec, pkgIndex, byRel);
          if (res.target) {
            const inner = resolveExport(res.target, hit.imported, depth + 1);
            if (inner) { exportCache.set(key, inner); return inner; }
          }
        }
      } else if (re.star) {
        const res = resolveSpecifier(rel, re.spec, pkgIndex, byRel);
        if (res.target) {
          const inner = resolveExport(res.target, name, depth + 1);
          if (inner) { exportCache.set(key, inner); return inner; }
        }
      }
    }
    return null;
  }

  /* ---- call resolution ---- */
  const callEdges = [];
  const unresolved = [];
  const scenarios = [];
  const stateChannels = [];
  const envChannels = [];
  const selfId = (s) => s.id;

  for (const sym of symbols) {
    if (!sym.calls || !sym.calls.length) continue;
    const rec = fileRecs.get(sym.rel);
    for (const call of sym.calls) {
      const r = resolveCall(sym, call, rec, fileRecs, resolveExport);
      if (r.to) {
        callEdges.push({ a: sym.id, b: r.to, k: call.aw ? 'awaits' : r.kind, n: 1, a2: call.a });
      } else if (r.external) {
        const cur = externals.get(r.external) || { id: r.external, n: r.external, cat: categoryOfExternal(r.external), c: 0 };
        cur.c++;
        externals.set(r.external, cur);
        const cat = categoryOfExternal(r.external);
        if (!sym.isTest && OUTCOMES_BY_CATEGORY[cat] && cat !== 'external-generic') {
          scenarios.push({ s: sym.id, n: call.n, callee: r.external, cat, label: call.a, outcomes: OUTCOMES_BY_CATEGORY[cat] });
        }
      } else {
        unresolved.push({ s: sym.id, n: call.n, callee: call.c, form: call.k, recv: call.r, why: r.why });
      }
    }
  }

  /* ---- dedupe + aggregate edges ---- */
  const edgeKey = (e) => e.a + '>' + e.b + '>' + e.k;
  const edgeAgg = new Map();
  for (const e of callEdges) {
    const k = edgeKey(e);
    const cur = edgeAgg.get(k);
    if (cur) cur.n++;
    else edgeAgg.set(k, { ...e, n: 1 });
  }
  const edges = [...edgeAgg.values()];

  /* ---- nested (closure) edges: a closure is reachable where it is defined ---- */
  for (const sym of symbols) {
    if (!sym.parentSymbol) continue;
    const parentRec = fileRecs.get(sym.rel);
    const parent = parentRec?.symbols.find((s) => s.qualified === sym.parentSymbol);
    if (parent) edges.push({ a: parent.id, b: sym.id, k: 'nested', n: 1 });
  }

  /* ---- may-reach (RTA) is applied after entry points are known ---- */

  const byId = new Map(symbols.map((s) => [s.id, s]));

  /* ---- state channels (class fields) ---- */
  const fieldWriters = new Map(); // classFieldKey -> [symId]
  const fieldReaders = new Map();
  for (const sym of symbols) {
    if (!sym.state || !sym.state.length) continue;
    for (const st of sym.state) {
      if (st.ch.startsWith('process.env')) {
        envChannels.push({ s: sym.id, key: st.ch, k: st.k, n: st.n });
        continue;
      }
      const fieldKey = sym.ownerClass ? sym.ownerClass + '.' + st.ch : sym.rel + '::' + st.ch;
      if (st.k === 'write') {
        if (!fieldWriters.has(fieldKey)) fieldWriters.set(fieldKey, []);
        fieldWriters.get(fieldKey).push(sym.id);
      } else {
        if (!fieldReaders.has(fieldKey)) fieldReaders.set(fieldKey, []);
        fieldReaders.get(fieldKey).push(sym.id);
      }
    }
  }
  for (const [field, writers] of fieldWriters) {
    const readers = fieldReaders.get(field) || [];
    for (const w of writers) {
      for (const r of readers) {
        if (w === r) continue;
        stateChannels.push({ a: w, b: r, field, k: 'writes->reads' });
      }
    }
  }

  /* ---- entry points & reachability ---- */
  const entryFiles = new Set();
  for (const [, info] of pkgIndex.map) {
    for (const e of info.entryFiles) if (byRel.has(e)) entryFiles.add(e);
  }
  // Real process entries: bin targets.
  const binFiles = new Set();
  for (const p of repoMeta.packageList || []) {
    const bin = p.bin;
    const push = (t) => {
      const clean = String(t).replace(/^\.\//, '');
      const base = p.dir + '/' + clean;
      const cands = [
        base,
        base.replace(/\/dist\//, '/src/'),
        base.replace(/\.js$/, '.ts'),
        base.replace(/\/dist\//, '/src/').replace(/\.js$/, '.ts'),
        base.replace(/\/dist\//, '/src/').replace(/\.js$/, '.tsx'),
      ];
      for (const c of cands) if (byRel.has(c)) binFiles.add(c);
    };
    if (typeof bin === 'string') push(bin);
    else if (bin && typeof bin === 'object') Object.values(bin).forEach(push);
  }
  for (const f of ['packages/cli/index.ts', 'packages/a2a-server/src/main.ts', 'packages/cli/src/gemini.tsx']) {
    if (byRel.has(f)) binFiles.add(f);
  }

  // Single-package repositories: the root package.json carries the binary/main,
  // and there is no `packages/` tree to scan. Fall back to it, then to
  // conventional entry filenames, so a flat repo is not reported as 100% unknown.
  {
    let rootPkg = null;
    try {
      const raw = fs.readFileSync(path.join(repoMeta.repoRoot, 'package.json'), 'utf8');
      rootPkg = JSON.parse(raw);
    } catch { rootPkg = null; }
    const pushRoot = (target) => {
      const clean = String(target).replace(/^\.\//, '');
      const cands = [clean, clean.replace(/\.js$/, '.ts'), clean.replace(/\.js$/, '.tsx'), clean.replace(/^dist\//, 'src/').replace(/\.js$/, '.ts')];
      for (const c of cands) if (byRel.has(c)) binFiles.add(c);
    };
    if (rootPkg) {
      if (typeof rootPkg.bin === 'string') pushRoot(rootPkg.bin);
      else if (rootPkg.bin && typeof rootPkg.bin === 'object') Object.values(rootPkg.bin).forEach(pushRoot);
      if (typeof rootPkg.main === 'string') pushRoot(rootPkg.main);
      const walkExports = (v) => {
        if (typeof v === 'string') pushRoot(v);
        else if (v && typeof v === 'object') for (const x of Object.values(v)) walkExports(x);
      };
      if (rootPkg.exports) walkExports(rootPkg.exports);
    }
    for (const f of ['index.ts', 'src/index.ts', 'src/main.ts', 'src/cli.ts', 'src/app.ts', 'main.ts']) {
      if (byRel.has(f)) binFiles.add(f);
    }
  }

  const entrySymbols = new Set();
  for (const sym of symbols) {
    if (sym.isTest) continue;
    if (binFiles.has(sym.rel)) entrySymbols.add(sym.id);
  }
  if (entrySymbols.size === 0) {
    // Last resort for unusual layouts: exported, never-called, callable symbols
    // are the process surface as far as static analysis can tell.
    for (const sym of symbols) {
      if (sym.isTest || !sym.exported) continue;
      if (!['function', 'arrow', 'class', 'method'].includes(sym.kind)) continue;
      if (sym.fanIn > 0) continue;
      entrySymbols.add(sym.id);
    }
  }
  if (entrySymbols.size === 0) {
    for (const sym of symbols) if (!sym.isTest && sym.kind === 'module') entrySymbols.add(sym.id);
  }

  /* ---- may-reach (RTA): instantiating a class makes its methods reachable ----
     Rapid Type Analysis over-approximation, run to a fixpoint over the
     entry-reachable set. Every such edge is labelled `may-reach`, and a path
     witness that depends on one is reported as may-reach, never as modelled. */
  const classMethods = new Map();
  for (const sym of symbols) {
    if (!sym.ownerClass) continue;
    const rec = fileRecs.get(sym.rel);
    const cls = rec?.localMap.get(sym.ownerClass);
    if (!cls || cls.kind !== 'class') continue;
    if (!classMethods.has(cls.id)) classMethods.set(cls.id, []);
    classMethods.get(cls.id).push(sym.id);
  }
  const ctorSites = new Map();
  for (const e of edges) {
    if (e.k !== 'constructs') continue;
    if (!ctorSites.has(e.b)) ctorSites.set(e.b, new Set());
    ctorSites.get(e.b).add(e.a);
  }
  let mayEdgeCount = 0;
  for (let round = 0; round < 3; round++) {
    const adjR = new Map();
    for (const e of edges) {
      if (!adjR.has(e.a)) adjR.set(e.a, []);
      adjR.get(e.a).push(e.b);
    }
    const reachR = bfs(entrySymbols, adjR);
    let added = 0;
    for (const [clsId, sites] of ctorSites) {
      const methods = classMethods.get(clsId);
      if (!methods || !methods.length) continue;
      for (const site of sites) {
        if (!reachR.has(site)) continue;
        const cap = Math.min(methods.length, 400);
        for (let i = 0; i < cap; i++) {
          const m = methods[i];
          if (m === site) continue;
          const key = site + '>' + m + '>may-reach';
          if (edgeAgg.has(key)) continue;
          const e = { a: site, b: m, k: 'may-reach', n: 1 };
          edgeAgg.set(key, e);
          edges.push(e);
          added++;
        }
      }
    }
    mayEdgeCount += added;
    if (!added) break;
  }

  for (const e of edges) {
    if (e.k === 'may-reach' || e.k === 'nested') continue;
    const a = byId.get(e.a);
    const b = byId.get(e.b);
    if (a) a.fanOut++;
    if (b) b.fanIn++;
  }

  const adj = new Map();
  for (const e of edges) {
    if (!adj.has(e.a)) adj.set(e.a, []);
    adj.get(e.a).push(e.b);
  }
  const reach = bfs(new Set(entrySymbols), adj);

  const testAdj = new Map();
  for (const e of edges) {
    const a = byId.get(e.a);
    if (!a || !a.isTest) continue;
    if (!testAdj.has(e.a)) testAdj.set(e.a, []);
    testAdj.get(e.a).push(e.b);
  }
  const testEntry = new Set(symbols.filter((s) => s.isTest).map((s) => s.id));
  const testReach = bfs(testEntry, testAdj);

  for (const sym of symbols) {
    if (sym.isTest) sym.reach = 'test';
    else if (reach.has(sym.id)) sym.reach = 'entry';
    else if (testReach.has(sym.id)) sym.reach = 'test';
    else sym.reach = 'none';
    if (entrySymbols.has(sym.id)) sym.st = 'entry';
    else if (sym.fanIn === 0) sym.st = 'leaf';
    else sym.st = 'internal';
  }

  /* ---- dynamic reference index (string literals) ---- */
  const stringIndex = new Set();
  for (const f of files) for (const s of f.strings || []) stringIndex.add(s);

  return {
    symbols,
    byId,
    edges,
    importEdges: dedupeImports(importEdges),
    externals: [...externals.values()],
    scenarios,
    unresolved,
    stateChannels,
    envChannels,
    entrySymbols,
    entryFiles,
    binFiles,
    files: files.map((f) => ({ rel: f.rel, lines: f.lines, bytes: f.bytes, isTest: f.isTest, pkg: pkgOf(f.rel, pkgIndex), symbolCount: f.symbols.length })),
    fileRecs,
    stringIndex,
    pkgIndex,
    reach,
    testReach,
    stats: {
      resolvedCalls: edges.length,
      unresolvedCalls: unresolved.length,
      mayReachEdges: mayEdgeCount, unknownRatio: edges.length + unresolved.length ? unresolved.length / (edges.length + unresolved.length) : 0,
    },
  };
}

function dedupeImports(list) {
  const m = new Map();
  for (const e of list) {
    const k = e.a + '>' + e.b + '>' + e.k;
    if (!m.has(k)) m.set(k, { ...e, n: 1 });
    else m.get(k).n++;
  }
  return [...m.values()];
}

function bfs(starts, adj) {
  const seen = new Set(starts);
  const queue = [...starts];
  for (let i = 0; i < queue.length; i++) {
    const cur = queue[i];
    const nxt = adj.get(cur);
    if (!nxt) continue;
    for (const n of nxt) if (!seen.has(n)) { seen.add(n); queue.push(n); }
  }
  return seen;
}

function pkgOf(rel, pkgIndex) {
  const m = rel.match(/^packages\/([^/]+)\//);
  if (m) {
    for (const [, info] of pkgIndex.map) if (info.dir === 'packages/' + m[1]) return info.name;
    return m[1];
  }
  return '(root)';
}

/* ------------------------------------------------------------------ */
/* call resolution                                                    */
/* ------------------------------------------------------------------ */

function resolveCall(sym, call, rec, fileRecs, resolveExport) {
  const { c, m, r, k } = call;

  if (k === 'dynamic' || c === '<computed>' || c === '<expr>') {
    return { why: 'dynamic-callee' };
  }

  // Method call: receiver-based
  if (m && r) {
    // Chained / computed receivers (`expect(x).toBe()`, `(a||b).c()`) cannot be
    // resolved without type information.
    if (!/^[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*)*$/.test(r)) return { why: 'complex-receiver' };
    if (r === 'this') {
      if (sym.ownerClass) {
        const hit = rec.classMembers?.get(sym.ownerClass + '#' + m);
        if (hit) return { to: hit.id, kind: 'calls' };
      }
      if (rec.localMap.has(m)) return { to: rec.localMap.get(m).id, kind: 'calls' };
      return { why: 'this-dispatch-unresolved' };
    }
    if (/^this\./.test(r)) return { why: 'field-typed-receiver' };

    // Receiver is a simple identifier.
    const rootName = r.split('.')[0];
    if (rootName === 'process') return { external: 'node:process' };
    if (rootName === 'console') return { external: 'console' };
    if (rootName === 'fs' || rootName === 'os' || rootName === 'path' || rootName === 'crypto' || rootName === 'child_process') return { external: 'node:' + rootName };
    if (rootName === 'JSON' || rootName === 'Object' || rootName === 'Array' || rootName === 'Promise' || rootName === 'Math' || rootName === 'Date' || rootName === 'String' || rootName === 'Number' || rootName === 'Buffer' || rootName === 'Intl' || rootName === 'Reflect') return { external: 'js-builtin:' + rootName };

    const imported = rec.importMap.get(rootName);
    if (imported) {
      if (imported.target) {
        if (imported.imported === '*') return { why: 'namespace-member' };
        const clsId = resolveExport(imported.target, imported.imported);
        if (clsId) {
          const targetRec = fileRecs.get(fileRecs.get(imported.target)?.rel);
          const tSym = [...findSym(imported.target)].find((s) => s.id === clsId);
          if (tSym) {
            const member = memberOf(tSym, m);
            if (member) return { to: member.id, kind: 'calls' };
          }
          void targetRec;
          return { why: 'static-member-unresolved' };
        }
        return { why: 'export-not-found' };
      }
      if (imported.externalId) return { external: imported.externalId };
      if (imported.missing) return { why: 'import-unresolved' };
    }

    const local = rec.localMap.get(rootName);
    if (local) {
      const member = memberOf(local, m);
      if (member) return { to: member.id, kind: 'calls' };
      return { why: 'instance-member-unresolved' };
    }
    if (BUILTIN_GLOBALS.has(rootName)) return { external: 'js-global:' + rootName };
    if (sym.params && sym.params.includes(rootName)) return { why: 'param-typed-receiver' };
    return { why: 'unknown-receiver' };
  }

  // Plain identifier call
  if (c && !m) {
    const local = rec.localMap.get(c);
    if (local) return { to: local.id, kind: k === 'new' ? 'constructs' : 'calls' };

    const imported = rec.importMap.get(c);
    if (imported) {
      if (imported.target) {
        const id = resolveExport(imported.target, imported.imported);
        if (id) return { to: id, kind: k === 'new' ? 'constructs' : 'calls' };
        return { why: 'export-not-found' };
      }
      if (imported.externalId) return { external: imported.externalId };
      if (imported.missing) return { why: 'import-unresolved' };
    }
    if (BUILTIN_GLOBALS.has(c)) return { external: 'js-global:' + c };
    if (c === 'fetch') return { external: 'fetch' };
    return { why: 'unknown-callee' };
  }

  return { why: 'unclassified' };

  function memberOf(targetSym, member) {
    const targetRec = fileRecs.get(targetSym.rel);
    if (!targetRec) return null;
    return targetRec.classMembers?.get(targetSym.name + '#' + member) || null;
  }
  function* findSym(rel) {
    const r = fileRecs.get(rel);
    if (r) for (const s of r.symbols) yield s;
  }
}


