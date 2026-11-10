# Repository Learning Package — Data Contract v0.1

Single source of truth: one `Coverage Knowledge Graph` per repository snapshot.
Every consumer (runtime app, CLI, future VS Code extension) reads the same assets.

## Package layout

```
repository-learning-package/
├── manifest.json
├── analysis/{repository-index,symbol-index,call-graph,control-flow-graph,data-flow-graph,dependency-graph,source-evidence}.json
├── coverage/{coverage-obligations,branch-coverage,scenario-matrix,path-coverage,coverage-gaps}.json
├── learning/{path-suite,storylines,learning-objectives,exercises,assessments}.json
├── maintenance/{impact-map,maintenance-tasks,testing-recommendations}.json
└── app/{index.html,data.js,app.js,app.css}
```

`app/data.js` contains `window.RLP_DATA = { ... }` — the embedded runtime payload.

## Identity rules

- No line numbers anywhere in ids. `symbol_id = "S" + sha1(file + "::" + qualified)[:10]`.
- `evidence.anchor` = whitespace-collapsed declaration head (<=200 chars). Line-independent.
- All arrays sorted deterministically (by id) before emission.

## Runtime payload (`window.RLP_DATA`)

```ts
> Percentages in the payload are **0..1** (pct, unknown_ratio, impact.risk).
> Human-facing markdown (*.md, OWNERSHIP_REPORT.md) uses 0..100 with a % sign.

type RLPData = {
  meta: {
    repository: string;        // "google-gemini/gemini-cli"
    commit: string;            // 40-char sha
    branch?: string;
    generated_at: string;      // ISO
    analysis_version: string;  // "rlp-0.1.0"
    languages: string[];       // ["typescript"]
    package_names: string[];
    counts: {
      files: number; symbols: number; edges: number;
      obligations: number;              // EXACT corpus total, not the payload slice
      obligations_in_payload: number;   // slice size
      paths: number; storylines: number; exercises: number; tasks: number;
    };
    truncated: boolean;        // true when obligations_in_payload < obligations
  };

  packages: Array<{ name: string; files: number; symbols: number; loc: number }>;

  files: Array<{
    f: string;    // path relative to repo root, forward slashes
    p: string;    // package name
    l: number;    // lines
    t: boolean;   // is test/support harness
    s: number;    // symbol count
    ob: number;   // obligations owned by this file (exact, not the slice)
    cov: number; unc: number; unk: number; exc: number;
    crit: number; crit_open: number;
  }>;

  symbols: Array<{
    id: string;
    n: string;   // name, e.g. "getModel" / "Config.setModel"
    k: string;   // kind: function|method|class|constructor|arrow|closure|interface|type|enum|var|namespace
    f: string;   // file path
    p: string;   // package
    x: boolean;  // exported
    t: boolean;  // test code
    a: string;   // evidence anchor (declaration head)
    e: string;   // evidence id, e.g. "E-1a2b3c4d5e"
    c: number;   // call-out count (callees resolved)
    i: number;   // in-repo caller count (fan-in)
    b: number;   // branch obligation count
    o: number;   // total obligation count
    q: number;   // complexity proxy (branch nodes + 1)
    st?: 'entry' | 'leaf' | 'internal';
    doc?: string; // leading doc comment, <=240 chars
  }>;

  calls: Array<{ a: string; b: string; k: string; n: number }>;
  // k = "calls" | "constructs" | "awaits" | "nested"

  modules: Array<{ id: string; n: string; f: string; p: string; k: string; a: string; e: string }>; // file-level modules

  imports: Array<{ a: string; b: string; k: 'internal' | 'workspace' | 'external'; w: string }>; // a,b file paths; w=bare specifier

  externals: Array<{ id: string; n: string; cat: string; c: number }>; // external dependency nodes

  obligations: Array<{
    id: string;
    t: string;   // symbol|call-edge|branch|exception|loop|return|throw|scenario|e2e-path|maintenance
    s: string;   // symbol id (owner)
    f: string;   // file path
    n: string;   // node/local id inside symbol CFG, "" if symbol-level
    o: string;   // outcome: "true"|"false"|"case:k"|"default"|"success"|"error"|"empty"|"timeout"|"entry"|"terminal"|...
    l: string;   // human label, e.g. `if (config.trusted)`
    st: string;  // status: covered|uncovered|unknown|infeasible|excluded
    r?: string;  // reason for unknown/infeasible/excluded
    e: string;   // evidence id
    cat?: string; // risk category: security|persistence|network|state|error-handling|null-safety|config|ui|none
    crit?: number; // 1..3 criticality
    p?: number;   // 0..1 static feasibility confidence
  }>;

  cfgs: Record<string, {            // key = symbol id, only for "learning set" symbols
    nodes: Array<{ id: string; k: string; l: string; a?: string }>;
    edges: Array<{ f: string; t: string; k: string }>;
  }>;

  paths: Array<{
    id: string;
    entry: string;      // symbol id of entry point
    title: string;
    steps: Array<{ s: string; f: string; n: string; o: string; l: string; e: string }>; // s=symbol id, n=cfg node id, o=branch outcome taken
    covers: string[];   // obligation ids
    terminal: string;   // symbol id where flow ends
    length: number;
    tier: number;       // 1..5 mapped learning level
    origin: 'production' | 'test';  // test-driven chains are kept but ranked last
    witness: 'modelled' | 'may-reach';
  }>;

  storylines: Array<{
    id: string;
    path: string;       // path id
    title: string;
    premise: string;
    acts: Array<{ n: string; title: string; body: string; symbols: string[]; obligations: string[] }>;
    objectives: string[];
    level: number;      // 1..5
  }>;

  objectives: Array<{ id: string; level: number; text: string; symbols: string[]; obligations: string[] }>;

  exercises: Array<{
    id: string; k: 'comprehension'|'diagnosis'|'impact'|'patch'; level: number;
    title: string; prompt: string;
    choices?: Array<{ id: string; text: string; correct: boolean }>;
    answer?: string; explain: string;
    symbols: string[]; obligations: string[]; evidence: string[];
  }>;

  assessments: Array<{
    id: string; level: number; kind: string; text: string; checks: string[];
    exercise: string[]; weight: number;
  }>;

  impact: Array<{
    id: string; s: string; // changed symbol
    direct: string[]; indirect: string[]; tests: string[];
    shared_state: string[]; contracts: string[]; risk: number; note: string;
  }>;

  maintenance: Array<{
    id: string; k: string; title: string; prompt: string; steps: string[];
    level: number; symbols: string[]; tests: string[]; risk: number;
  }>;

  testing: Array<{ id: string; s: string; kind: string; text: string; covers: string[]; exists: boolean }>;

  gaps: Array<{ id: string; kind: string; s: string; f: string; text: string; reason: string }>;

  report: {
    totals: { obligations: number; covered: number; uncovered: number; unknown: number;
              excluded: number; denominator: number; critical_open: number; pct: number };
    coverage: Record<string, { covered: number; total: number; unknown: number; excluded: number; denominator: number; pct: number }>;
    unknown_ratio: number;
    critical_gaps: number;
    levels: Array<{ level: number; name: string; obligations: number; evidence_kinds: string[] }>;
    policy: string[];
  };
};
```

## Status semantics (never conflated)

| status | meaning |
|---|---|
| `covered` | an analysable obligation with a static path witness (chain from an entry point) |
| `uncovered` | reachable obligation without a witness yet (path planner gap) |
| `unknown` | static analysis cannot decide (dynamic dispatch, runtime registration, budget cap) |
| `infeasible` | proven unreachable under the current model |
| `excluded` | deliberately out of target scope; reason recorded |

Static path evidence is NOT runtime coverage. Runtime/learner evidence carries its own
labels: `modeled` < `constraint-validated` < `runtime-verified` < `learner-mastered`.

## App requirements

- Workspaces: Repository Map, Coverage Atlas, Execution Debugger, Dependency & Impact Explorer, Maintenance Lab.
- Coverage dashboard + Ownership Report view.
- Pure static HTML/CSS/JS, no network, no external CDN, works from `file://`.
- Deterministic layout (no random). Keyboard-first. URL hash routing.
- Must tolerate large payloads (thousands of symbols) — no layout of the full graph as DOM nodes.

## Payload trimming policy

`app/data.js` carries a *representative* obligation slice (covered rows, every
critical open row, a sample of the rest) plus exact per-file aggregates and exact
corpus totals in `report.totals`. The complete obligation set ships in
`coverage/coverage-obligations.json`. A consumer must never compute a coverage
percentage from `symbols[].o` or `obligations.length`; use `report.totals` or
`report.coverage`.
