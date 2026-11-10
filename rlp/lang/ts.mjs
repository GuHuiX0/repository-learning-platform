/**
 * TypeScript / JavaScript language adapter.
 *
 * Produces a language-neutral per-file record:
 *   symbols[]  鈥?functions, methods, classes, interfaces, closures, module scope
 *   calls[]    鈥?raw call sites attributed to the innermost symbol + CFG node
 *   imports[]  鈥?module specifiers (resolved later, cross-file)
 *   cfg        鈥?per symbol: basic blocks + typed edges
 *   state[]    鈥?field / env reads and mutations (data-flow channel)
 *
 * Deliberately syntactic only (no type checker): anything that needs type
 * inference is reported as Unknown downstream instead of guessed here.
 */
import ts from 'typescript';
import { collapse, countLines, declAnchor } from '../util.mjs';

const SCRIPT_KINDS = { ts: ts.ScriptKind.TS, tsx: ts.ScriptKind.TSX, js: ts.ScriptKind.JS, jsx: ts.ScriptKind.JSX, mjs: ts.ScriptKind.JS, cjs: ts.ScriptKind.JS };

export function scriptKindFor(rel) {
  const ext = rel.slice(rel.lastIndexOf('.') + 1).toLowerCase();
  return SCRIPT_KINDS[ext] ?? ts.ScriptKind.TS;
}

const TEST_RE = /\.(test|spec)\.[cm]?[jt]sx?$/i;
const TEST_DIR_RE = /(^|\/)(__tests__|__mocks__|test-utils|tests?|integration-tests|perf-tests|memory-tests|evals|mocks)\//i;

export function isTestPath(rel) {
  return TEST_RE.test(rel) || TEST_DIR_RE.test(rel);
}

const MAX_NODES = 1500;
const MAX_EXPR_BRANCHES = 6;

const ASSIGN_OPS = new Set([
  ts.SyntaxKind.EqualsToken,
  ts.SyntaxKind.PlusEqualsToken,
  ts.SyntaxKind.MinusEqualsToken,
  ts.SyntaxKind.AsteriskEqualsToken,
  ts.SyntaxKind.SlashEqualsToken,
  ts.SyntaxKind.BarBarEqualsToken,
  ts.SyntaxKind.QuestionQuestionEqualsToken,
  ts.SyntaxKind.AmpersandAmpersandEqualsToken,
]);

/* ------------------------------------------------------------------ */
/* CFG builder                                                        */
/* ------------------------------------------------------------------ */

class CfgBuilder {
  constructor(sf, sym) {
    this.sf = sf;
    this.sym = sym;
    this.nodes = [];
    this.edges = [];
    this.calls = [];
    this.state = [];
    this.truncated = false;
    this.tryStack = [];
    this.loopStack = [];
    this.switchStack = [];
    this.entry = this.node('entry', 'entry');
    this.exit = this.node('exit', 'exit');
  }

  node(kind, label, anchor) {
    if (this.nodes.length >= MAX_NODES) {
      this.truncated = true;
      return this.nodes[this.nodes.length - 1]?.id ?? 'n0';
    }
    const id = 'n' + this.nodes.length;
    const n = { id, k: kind, l: collapse(label, 150) };
    if (anchor) n.a = collapse(anchor, 180);
    this.nodes.push(n);
    return id;
  }

  edge(from, to, kind) {
    if (from == null || to == null) return;
    this.edges.push({ f: from, t: to, k: kind });
  }

  text(node) {
    try { return node.getText(this.sf); } catch { return ''; }
  }

  /* ---- statements ------------------------------------------------ */

  walkStmts(stmts) {
    let entry = null;
    let exits = [];
    let pending = null; // statement terminated the flow
    for (const s of stmts || []) {
      if (this.truncated) break;
      const seg = this.walkStmt(s);
      if (pending === true) {
        // Flow was terminated: subsequent code is statically unreachable.
        if (seg && seg.entry != null) this.markUnreachable(seg.entry);
      }
      if (!seg || seg.entry == null) continue;
      if (entry == null) entry = seg.entry;
      else for (const n of exits) this.edge(n, seg.entry, 'seq');
      exits = seg.exits;
      if (exits.length === 0) pending = true;
      else pending = false;
    }
    return { entry, exits: pending === true ? [] : exits };
  }

  markUnreachable(nodeId) {
    const n = this.nodes[Number(String(nodeId).slice(1))];
    if (n) n.un = true;
  }

  walkStmt(stmt) {
    if (!stmt) return { entry: null, exits: [] };
    const K = ts.SyntaxKind;

    if (ts.isBlock(stmt)) return this.walkStmts(stmt.statements);

    if (ts.isIfStatement(stmt)) return this.walkIf(stmt);
    if (ts.isSwitchStatement(stmt)) return this.walkSwitch(stmt);
    if (ts.isTryStatement(stmt)) return this.walkTry(stmt);
    if (ts.isForStatement(stmt) || ts.isForOfStatement(stmt) || ts.isForInStatement(stmt) || ts.isWhileStatement(stmt) || ts.isDoStatement(stmt))
      return this.walkLoop(stmt);

    if (ts.isReturnStatement(stmt)) {
      const n = this.node('return', 'return ' + collapse(this.text(stmt.expression) || '', 90), this.text(stmt).slice(0, 80));
      this.scanExpr(stmt.expression, n);
      this.edge(n, this.exit, 'return');
      return { entry: n, exits: [] };
    }

    if (ts.isThrowStatement(stmt)) {
      const n = this.node('throw', 'throw ' + collapse(this.text(stmt.expression) || '', 90));
      this.scanExpr(stmt.expression, n);
      const target = this.currentCatch();
      this.edge(n, target ?? this.exit, target ? 'exception' : 'throw');
      return { entry: n, exits: [] };
    }

    if (ts.isBreakStatement(stmt)) {
      const n = this.node('stmt', 'break');
      const ctx = this.switchStack[this.switchStack.length - 1] || this.loopStack[this.loopStack.length - 1];
      if (ctx) ctx.breaks.push(n);
      else this.edge(n, this.exit, 'break');
      return { entry: n, exits: [] };
    }

    if (ts.isContinueStatement(stmt)) {
      const n = this.node('stmt', 'continue');
      const ctx = this.loopStack[this.loopStack.length - 1];
      if (ctx) ctx.continues.push(n);
      else this.edge(n, this.exit, 'continue');
      return { entry: n, exits: [] };
    }

    // Generic statement.
    const label = this.stmtLabel(stmt);
    const n = this.node(stmt.kind === K.ExpressionStatement ? 'stmt' : 'stmt', label);
    this.scanExpr(stmt.expression, n);
    if (ts.isVariableStatement(stmt)) {
      for (const d of stmt.declarationList.declarations) {
        this.scanExpr(d.initializer, n);
        if (d.initializer && (ts.isArrowFunction(d.initializer) || ts.isFunctionExpression(d.initializer))) {
          this.registerClosure(d.initializer, String(d.name.getText(this.sf)));
        }
      }
    }
    if (ts.isClassDeclaration(stmt) || ts.isFunctionDeclaration(stmt)) return { entry: null, exits: [] };
    return { entry: n, exits: [n] };
  }

  stmtLabel(stmt) {
    if (ts.isExpressionStatement(stmt)) return collapse(this.text(stmt.expression), 120);
    if (ts.isVariableStatement(stmt)) {
      const names = stmt.declarationList.declarations.map((d) => this.text(d.name)).join(', ');
      return collapse('const ' + names + (stmt.declarationList.declarations[0]?.initializer ? ' = \u2026' : ''), 120);
    }
    const t = this.text(stmt);
    return collapse(t.split('\n')[0], 120);
  }

  walkIf(stmt) {
    const cond = collapse(this.text(stmt.expression), 130);
    const b = this.node('branch', 'if (' + cond + ')', this.text(stmt).slice(0, 90));
    this.scanExpr(stmt.expression, b);
    const m = this.node('merge', 'after if');
    const thenSeg = this.walkStmt(stmt.thenStatement);
    if (thenSeg?.entry != null) {
      this.edge(b, thenSeg.entry, 'true');
      for (const n of thenSeg.exits) this.edge(n, m, 'seq');
    } else this.edge(b, m, 'true');
    if (stmt.elseStatement) {
      const elseSeg = this.walkStmt(stmt.elseStatement);
      if (elseSeg?.entry != null) {
        this.edge(b, elseSeg.entry, 'false');
        for (const n of elseSeg.exits) this.edge(n, m, 'seq');
      } else this.edge(b, m, 'false');
    } else {
      this.edge(b, m, 'false');
    }
    return { entry: b, exits: [m] };
  }

  walkLoop(stmt) {
    const K = ts.SyntaxKind;
    let header;
    if (ts.isForStatement(stmt)) header = stmt.condition ? 'for (; ' + collapse(this.text(stmt.condition), 100) + '; )' : 'for (\u2026)';
    else if (ts.isWhileStatement(stmt)) header = 'while (' + collapse(this.text(stmt.expression), 110) + ')';
    else if (ts.isDoStatement(stmt)) header = 'do\u2026while (' + collapse(this.text(stmt.expression), 100) + ')';
    else if (ts.isForOfStatement(stmt)) header = 'for (\u2026 of ' + collapse(this.text(stmt.expression), 90) + ')';
    else header = 'for (\u2026 in ' + collapse(this.text(stmt.expression), 90) + ')';

    const cond = this.node('loop', header);
    if (ts.isDoStatement(stmt) || ts.isForStatement(stmt)) {
      const init = stmt.initializer;
      if (init) this.scanExpr(init, cond);
      if (stmt.condition) this.scanExpr(stmt.condition, cond);
      if (stmt.incrementor) this.scanExpr(stmt.incrementor, cond);
    } else {
      this.scanExpr(stmt.expression, cond);
    }

    const ctx = { breaks: [], continues: [], node: cond };
    this.loopStack.push(ctx);
    const body = this.walkStmt(stmt.statement);
    this.loopStack.pop();

    const m = this.node('merge', 'after loop');
    this.edge(cond, m, 'loop-exit'); // zero-iteration outcome
    if (body?.entry != null) {
      this.edge(cond, body.entry, 'loop-body');
      for (const n of body.exits) this.edge(n, cond, 'loop-back');
    }
    for (const n of ctx.continues) this.edge(n, cond, 'continue');
    for (const n of ctx.breaks) this.edge(n, m, 'break');
    return { entry: cond, exits: [m] };
  }

  walkSwitch(stmt) {
    const sw = this.node('switch', 'switch (' + collapse(this.text(stmt.expression), 100) + ')');
    this.scanExpr(stmt.expression, sw);
    const m = this.node('merge', 'after switch');
    const ctx = { breaks: [] };
    this.switchStack.push(ctx);
    const clauses = stmt.caseBlock.clauses;
    const caseNodes = [];
    for (let i = 0; i < clauses.length; i++) {
      const cl = clauses[i];
      const isDefault = ts.isDefaultClause(cl);
      const label = isDefault ? 'default' : 'case ' + collapse(this.text(cl.expression), 70);
      const cn = this.node('case', label);
      caseNodes.push({ cn, isDefault, i });
      this.edge(sw, cn, isDefault ? 'default' : 'case:' + i);
    }
    let carry = [];
    let lastMerge = null;
    for (let i = 0; i < clauses.length; i++) {
      const cl = clauses[i];
      const { cn } = caseNodes[i];
      if (carry.length) for (const n of carry) this.edge(n, cn, 'case-fallthrough');
      const seg = this.walkStmts(cl.statements || []);
      let exits = [];
      if (seg.entry != null) this.edge(cn, seg.entry, 'seq');
      else exits = [cn];
      exits = exits.concat(seg.exits);
      if (i === clauses.length - 1) {
        for (const n of exits) this.edge(n, m, 'seq');
        lastMerge = m;
      } else {
        carry = exits;
      }
      if (seg.entry != null && seg.exits.length === 0) carry = [];
    }
    this.switchStack.pop();
    for (const n of ctx.breaks) this.edge(n, m, 'break');
    return { entry: sw, exits: [lastMerge ?? m] };
  }

  walkTry(stmt) {
    const t = this.node('stmt', 'try');
    const m = this.node('merge', 'after try');
    const catches = [];
    if (stmt.catchClause) {
      const cl = stmt.catchClause;
      const cn = this.node('catch', 'catch (' + collapse(this.text(cl.variableDeclaration?.name) || '', 40) + ')');
      catches.push({ node: cn, clause: cl });
    }
    const startNodes = this.nodes.length;
    this.tryStack.push({ catches, m });
    const trySeg = this.walkStmts(stmt.tryBlock.statements);
    this.tryStack.pop();
    const regionNodes = this.nodes.slice(startNodes).map((n) => n.id);

    if (trySeg.entry != null) this.edge(t, trySeg.entry, 'seq');
    else this.edge(t, m, 'seq');
    for (const n of trySeg.exits) this.edge(n, m, 'seq');

    // Exception edges: model every potentially-throwing node in the protected
    // region as able to reach each handler (coarse, documented approximation).
    if (catches.length) {
      const budget = regionNodes.length <= 120 ? regionNodes : [t.id ?? t, trySeg.entry].filter(Boolean);
      for (const cn of catches) {
        this.edge(t, cn.node, 'exception');
        for (const rn of budget) if (rn !== cn.node) this.edge(rn, cn.node, 'exception');
      }
      for (const cn of catches) {
        const seg = this.walkStmts(cn.clause.block.statements);
        if (seg.entry != null) {
          this.edge(cn.node, seg.entry, 'seq');
          for (const n of seg.exits) this.edge(n, m, 'seq');
        } else this.edge(cn.node, m, 'seq');
      }
    }

    if (stmt.finallyBlock) {
      const fseg = this.walkStmts(stmt.finallyBlock.statements);
      if (fseg.entry != null) {
        this.edge(m, fseg.entry, 'finally');
        return { entry: t, exits: fseg.exits.length ? fseg.exits : [fseg.entry] };
      }
    }
    return { entry: t, exits: [m] };
  }

  currentCatch() {
    for (let i = this.tryStack.length - 1; i >= 0; i--) {
      const s = this.tryStack[i];
      if (s.catches.length) return s.catches[0].node;
    }
    return null;
  }

  /* ---- expressions ----------------------------------------------- */

  scanExpr(expr, host) {
    if (!expr || host == null) return;
    const self = this;
    let branchBudget = 0;

    const inlineBranch = (label, outcomes) => {
      if (branchBudget++ >= MAX_EXPR_BRANCHES || self.truncated) return;
      const b = self.node('branch', label);
      const m = self.node('merge', 'expr-merge');
      self.edge(host, b, 'seq');
      for (const o of outcomes) self.edge(b, m, o);
    };

    const visit = (node) => {
      if (!node) return;
      const K = ts.SyntaxKind;

      // Do not descend into nested function bodies; they are separate symbols.
      if (ts.isArrowFunction(node) || ts.isFunctionExpression(node) || ts.isClassExpression(node)) {
        self.registerClosure(node, null);
        return;
      }

      switch (node.kind) {
        case K.CallExpression: {
          self.recordCall(node, host, 'call');
          break;
        }
        case K.NewExpression: {
          self.recordCall(node, host, 'new');
          break;
        }
        case K.ConditionalExpression: {
          inlineBranch('?: ' + collapse(self.text(node.condition), 90), ['true', 'false']);
          break;
        }
        case K.BinaryExpression: {
          const op = node.operatorToken?.kind;
          if (op === K.AmpersandAmpersandToken) inlineBranch('&& ' + collapse(self.text(node.left), 80), ['true', 'false']);
          else if (op === K.BarBarToken) inlineBranch('|| ' + collapse(self.text(node.left), 80), ['true', 'false']);
          else if (op === K.QuestionQuestionToken) inlineBranch('?? ' + collapse(self.text(node.left), 80), ['left', 'right']);
          break;
        }
        case K.PropertyAccessExpression: {
          const chain = node.questionDotToken ? '?.' : '.';
          if (node.questionDotToken) inlineBranch('?. ' + collapse(self.text(node), 90), ['defined', 'undefined']);
          if (isThisKeyword(node.expression)) {
            self.state.push({ ch: node.name.text, k: 'read', n: host, own: true });
          } else if (ts.isIdentifier(node.expression) && node.expression.text === 'process' && node.name.text === 'env') {
            self.state.push({ ch: 'process.env', k: 'read', n: host });
          }
          void chain;
          break;
        }
        case K.ElementAccessExpression: {
          const base = self.text(node.expression);
          if (base === 'process.env' || base.endsWith('.env')) {
            self.state.push({ ch: 'process.env[' + collapse(self.text(node.argumentExpression), 60) + ']', k: 'read', n: host });
          }
          break;
        }
        default:
          break;
      }

      // State mutation: `this.field = ...`
      if (ts.isBinaryExpression(node) && ASSIGN_OPS.has(node.operatorToken?.kind)) {
        const lhs = node.left;
        if (ts.isPropertyAccessExpression(lhs) && isThisKeyword(lhs.expression)) {
          self.state.push({ ch: lhs.name.text, k: 'write', n: host, own: true });
        }
      }

      ts.forEachChild(node, visit);
    };

    visit(expr);
  }

  recordCall(node, host, kind) {
    const callee = node.expression ?? node;
    let name = '';
    let method = '';
    let receiver = '';
    let form = kind;

    if (ts.isIdentifier(callee)) {
      name = callee.text;
    } else if (ts.isPropertyAccessExpression(callee)) {
      method = callee.name.text;
      receiver = collapse(this.text(callee.expression), 60);
      name = method;
      form = 'method';
    } else if (ts.isElementAccessExpression(callee)) {
      name = '<computed>';
      form = 'dynamic';
    } else if (ts.isCallExpression(callee)) {
      name = '<call-result>';
      form = 'dynamic';
    } else {
      name = '<expr>';
      form = 'dynamic';
    }

    let awaited = false;
    let p = node.parent;
    while (p && (ts.isParenthesizedExpression(p) || ts.isAwaitExpression(p))) {
      if (ts.isAwaitExpression(p)) awaited = true;
      p = p.parent;
    }

    const optional = !!callee.questionDotToken || !!(node.flags & ts.NodeFlags.OptionalChain);

    this.calls.push({
      c: name,
      m: method,
      r: receiver,
      k: form,
      n: host,
      aw: awaited,
      opt: optional,
      a: collapse(this.text(node), 160),
    });
  }

  registerClosure(node, explicitName) {
    const parent = this.sym;
    parent.closures = (parent.closures || 0) + 1;
    const idx = parent.closures;
    let name = explicitName || node.name?.text;
    if (!name && node.parent) {
      const p = node.parent;
      if (ts.isCallExpression(p)) {
        const cal = ts.isPropertyAccessExpression(p.expression)
          ? p.expression.name.text
          : ts.isIdentifier(p.expression)
            ? p.expression.text
            : 'call';
        const ord = p.arguments ? Array.prototype.indexOf.call(p.arguments, node) : -1;
        name = cal + '$arg' + (ord >= 0 ? ord + 1 : '');
      } else if (ts.isPropertyAssignment(p) && p.name) {
        name = '$' + collapse(this.text(p.name), 30);
      } else if (ts.isVariableDeclaration(p) && p.name) {
        name = '$' + collapse(this.text(p.name), 30);
      }
    }
    name = name || 'fn' + idx;
    parent.pendingClosures = parent.pendingClosures || [];
    if (!parent._closureSeq) parent._closureSeq = new Map();
    const seq = (parent._closureSeq.get(name) || 0) + 1;
    parent._closureSeq.set(name, seq);
    if (seq > 1) name = name + '#' + seq;
    parent.pendingClosures.push({ node, name, idx });
  }
}

/* ------------------------------------------------------------------ */
/* File analysis                                                      */
/* ------------------------------------------------------------------ */

export function analyzeFile(rel, source) {
  const sf = ts.createSourceFile(rel, source, ts.ScriptTarget.Latest, true, scriptKindFor(rel));
  const isTest = isTestPath(rel);
  const out = {
    rel,
    isTest,
    lines: countLines(source),
    bytes: Buffer.byteLength(source, 'utf8'),
    imports: [],
    reexports: [],
    exports: [],
    symbols: [],
  };

  const exportsSet = new Set();
  const importList = [];

  const collectModifiers = (node) => {
    const mods = ts.canHaveModifiers(node) ? ts.getModifiers(node) || [] : [];
    return {
      exported: mods.some((m) => m.kind === ts.SyntaxKind.ExportKeyword),
      isDefault: mods.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword),
      isDeclare: mods.some((m) => m.kind === ts.SyntaxKind.DeclareKeyword),
      isAbstract: mods.some((m) => m.kind === ts.SyntaxKind.AbstractKeyword),
    };
  };

  const docOf = (node) => {
    const ranges = ts.getLeadingCommentRanges(source, node.getFullStart()) || [];
    for (const r of ranges) {
      const txt = source.slice(r.pos, r.end);
      if (txt.startsWith('/**')) {
        const clean = txt
          .replace(/^\/\*\*?|\*\/$/g, '')
          .split('\n')
          .map((l) => l.replace(/^\s*\*\s?/, '').trim())
          .filter(Boolean)
          .join(' ');
        if (clean) return collapse(clean, 240);
      }
    }
    return undefined;
  };

  const addSymbol = (sym) => {
    sym.idx = out.symbols.length;
    if (sym.exported) exportsSet.add(sym.name);
    out.symbols.push(sym);
    return sym;
  };

  const makeSym = (kind, name, qualified, node, extra = {}) => ({
    key: qualified,
    name,
    qualified,
    kind,
    node,
    anchor: declAnchor(firstLineOf(sf, node)),
    doc: docOf(node),
    exported: extra.exported ?? false,
    isDefault: extra.isDefault ?? false,
    isAsync: extra.isAsync ?? false,
    isStatic: extra.isStatic ?? false,
    isTest,
    params: extra.params ?? [],
    cfg: null,
    closures: [],
  });

  /* ---- imports ---- */
  for (const s of sf.statements) {
    if (ts.isImportDeclaration(s) && ts.isStringLiteral(s.moduleSpecifier)) {
      const spec = s.moduleSpecifier.text;
      const names = [];
      const clause = s.importClause;
      if (clause) {
        if (clause.name) names.push({ imported: 'default', local: clause.name.text });
        const nb = clause.namedBindings;
        if (nb && ts.isNamespaceImport(nb)) names.push({ imported: '*', local: nb.name.text });
        else if (nb && ts.isNamedImports(nb)) for (const el of nb.elements) names.push({ imported: el.propertyName?.text ?? el.name.text, local: el.name.text });
      }
      importList.push({ spec, names, isTypeOnly: !!clause?.isTypeOnly, line: 0 });
    } else if (ts.isImportEqualsDeclaration(s) && ts.isExternalModuleReference(s.moduleReference)) {
      importList.push({ spec: s.moduleReference.expression.text, names: [{ imported: '*', local: s.name.text }], isTypeOnly: false });
    } else if (ts.isExportDeclaration(s) && s.moduleSpecifier && ts.isStringLiteral(s.moduleSpecifier)) {
      const names = [];
      if (s.exportClause && ts.isNamedExports(s.exportClause)) {
        for (const el of s.exportClause.elements) names.push({ imported: el.propertyName?.text ?? el.name.text, local: el.name.text });
      }
      out.reexports.push({ spec: s.moduleSpecifier.text, names, star: !s.exportClause });
    }
  }

  /* ---- declarations ---- */
  /**
   * Register a function-like symbol with its CFG.
   */
  const registerFunction = (kind, name, qualified, node, extra = {}) => {
    const sym = makeSym(kind, name, qualified, node, extra);
    addSymbol(sym);
    buildCfgFor(sym, node);
    return sym;
  };

  const paramsOf = (node) => {
    const out = [];
    for (const p of node.parameters || []) {
      if (ts.isIdentifier(p.name)) out.push(p.name.text);
      else if (ts.isObjectBindingPattern(p.name) || ts.isArrayBindingPattern(p.name)) {
        for (const el of p.name.elements) if (ts.isBindingElement(el) && ts.isIdentifier(el.name)) out.push(el.name.text);
      }
    }
    return out;
  };

  const buildCfgFor = (sym, node) => {
    sym.params = paramsOf(node);
    if (!node.body) {
      // Declaration without a body (overload / abstract / interface method)
      sym.cfg = { nodes: [{ id: 'n0', k: 'entry', l: 'declaration-only' }], edges: [], truncated: false, aborted: true };
      return;
    }
    const b = new CfgBuilder(sf, sym);
    if (ts.isBlock(node.body)) {
      const seg = b.walkStmts(node.body.statements);
      if (seg.entry != null) b.edge(b.entry, seg.entry, 'seq');
      else b.edge(b.entry, b.exit, 'seq');
      for (const n of seg.exits) b.edge(n, b.exit, 'seq');
    } else {
      // Concise arrow body: an expression.
      const n = b.node('return', 'return ' + collapse(b.text(node.body), 90));
      b.scanExpr(node.body, n);
      b.edge(b.entry, n, 'seq');
      b.edge(n, b.exit, 'return');
    }
    sym.cfg = { nodes: b.nodes, edges: b.edges, truncated: b.truncated };
    sym.calls = b.calls;
    sym.state = b.state;
    // Nested closures discovered during the walk.
    for (const pc of sym.pendingClosures || []) {
      const cname = (sym.name || 'fn') + '$' + pc.name;
      const cq = sym.qualified + '~' + pc.name;
      const child = registerFunction('closure', cname, cq, pc.node, { exported: false, isAsync: !!(pc.node.modifiers || []).some?.((m) => m.kind === ts.SyntaxKind.AsyncKeyword) });
      child.parentSymbol = sym.qualified;
      child.cfg = child.cfg || null;
    }
    delete sym.pendingClosures;
  };

  for (const stmt of sf.statements) {
    if (ts.isFunctionDeclaration(stmt) && stmt.name) {
      const mods = collectModifiers(stmt);
      registerFunction('function', stmt.name.text, stmt.name.text, stmt, {
        ...mods,
        isAsync: (ts.getModifiers(stmt) || []).some((m) => m.kind === ts.SyntaxKind.AsyncKeyword),
      });
      continue;
    }

    if (ts.isClassDeclaration(stmt)) {
      const mods = collectModifiers(stmt);
      const cname = stmt.name?.text || 'default';
      const cls = addSymbol(makeSym('class', cname, cname, stmt, mods));
      for (const m of stmt.members) {
        const mmods = collectModifiers(m);
        const isStatic = (ts.getModifiers(m) || []).some((x) => x.kind === ts.SyntaxKind.StaticKeyword);
        if (ts.isMethodDeclaration(m) && m.name) {
          const mn = memberName(sf, m.name);
          const kind = mn === 'constructor' ? 'constructor' : 'method';
          const q = cname + '.' + mn;
          const sym = registerFunction(kind, mn, q, m, { ...mmods, isStatic, isAsync: (ts.getModifiers(m) || []).some((x) => x.kind === ts.SyntaxKind.AsyncKeyword) });
          sym.ownerClass = cname;
        } else if (ts.isPropertyDeclaration(m) && m.initializer && (ts.isArrowFunction(m.initializer) || ts.isFunctionExpression(m.initializer))) {
          const mn = memberName(sf, m.name);
          const q = cname + '.' + mn;
          const sym = registerFunction('closure', mn, q, m.initializer, { exported: false, isStatic });
          sym.ownerClass = cname;
          sym.anchor = declAnchor(source.slice(m.getStart(sf), m.getStart(sf) + 160));
        } else if (ts.isGetAccessor(m) || ts.isSetAccessor(m)) {
          const mn = memberName(sf, m.name);
          const q = cname + '.' + mn;
          registerFunction('method', mn, q, m, { isStatic });
        }
      }
      continue;
    }

    if (ts.isInterfaceDeclaration(stmt)) {
      const mods = collectModifiers(stmt);
      addSymbol(makeSym('interface', stmt.name.text, stmt.name.text, stmt, mods));
      continue;
    }

    if (ts.isTypeAliasDeclaration(stmt)) {
      const mods = collectModifiers(stmt);
      addSymbol(makeSym('type', stmt.name.text, stmt.name.text, stmt, mods));
      continue;
    }

    if (ts.isEnumDeclaration(stmt)) {
      const mods = collectModifiers(stmt);
      addSymbol(makeSym('enum', stmt.name.text, stmt.name.text, stmt, mods));
      continue;
    }

    if (ts.isModuleDeclaration(stmt) && stmt.name) {
      addSymbol(makeSym('namespace', stmt.name.getText(sf), stmt.name.getText(sf), stmt, collectModifiers(stmt)));
      continue;
    }

    if (ts.isVariableStatement(stmt)) {
      const mods = collectModifiers(stmt);
      for (const d of stmt.declarationList.declarations) {
        if (!ts.isIdentifier(d.name)) continue;
        const nm = d.name.text;
        if (d.initializer && (ts.isArrowFunction(d.initializer) || ts.isFunctionExpression(d.initializer))) {
          registerFunction('arrow', nm, nm, d.initializer, { ...mods, isAsync: (ts.getModifiers(d.initializer) || []).some((x) => x.kind === ts.SyntaxKind.AsyncKeyword) });
          // Anchor to the declaration, not just the arrow.
          const s = out.symbols[out.symbols.length - 1];
          s.anchor = declAnchor(source.slice(d.getStart(sf), d.getStart(sf) + 200));
        } else if (mods.exported && d.initializer && (ts.isObjectLiteralExpression(d.initializer) || ts.isNewExpression(d.initializer) || ts.isCallExpression(d.initializer) || ts.isIdentifier(d.initializer))) {
          const sym = addSymbol(makeSym('var', nm, nm, d, mods));
          sym.cfg = { nodes: [{ id: 'n0', k: 'entry', l: 'value binding' }], edges: [], truncated: false, aborted: true };
        }
      }
      continue;
    }
  }

  /* ---- module scope (top-level executable statements) ---- */
  const moduleStmts = sf.statements.filter(
    (s) =>
      ts.isExpressionStatement(s) ||
      ts.isIfStatement(s) ||
      ts.isTryStatement(s) ||
      ts.isForStatement(s) ||
      ts.isForOfStatement(s) ||
      ts.isWhileStatement(s) ||
      ts.isVariableStatement(s),
  );
  if (moduleStmts.length > 0) {
    const sym = addSymbol(makeSym('module', '(module)', '(module)', sf.statements[0] || sf, { exported: false }));
    const firstExec = moduleStmts[0];
    let firstText = '';
    try { firstText = collapse(firstExec.getText(sf).split('\n')[0], 120); } catch { firstText = ''; }
    sym.anchor = declAnchor('module scope of ' + rel + (firstText ? ' — first statement: ' + firstText : ''));
    const b = new CfgBuilder(sf, sym);
    const seg = b.walkStmts(sf.statements);
    if (seg.entry != null) b.edge(b.entry, seg.entry, 'seq');
    else b.edge(b.entry, b.exit, 'seq');
    for (const n of seg.exits) b.edge(n, b.exit, 'seq');
    sym.cfg = { nodes: b.nodes, edges: b.edges, truncated: b.truncated };
    sym.calls = b.calls;
    sym.state = b.state;
    for (const pc of sym.pendingClosures || []) {
      const child = registerFunction('closure', pc.name, '(module)~' + pc.name, pc.node, {});
      child.parentSymbol = '(module)';
    }
    delete sym.pendingClosures;
  }

  out.imports = importList;
  out.exports = [...exportsSet];

  // String literals: used to prove dynamic (by-name) references to symbols
  // that the call graph cannot resolve statically.
  const strings = new Set();
  const visitStrings = (node) => {
    if (strings.size > 500) return;
    if (ts.isStringLiteral(node)) {
      const v = node.text;
      if (v.length >= 3 && v.length <= 80) strings.add(v);
    } else if (ts.isPropertyAssignment(node) && ts.isIdentifier(node.name)) {
      strings.add(node.name.text);
    } else if (ts.isMethodDeclaration(node)) {
      // object-literal keys are handled by the decorator-less AST shape below
    }
    ts.forEachChild(node, visitStrings);
  };
  ts.forEachChild(sf, visitStrings);
  out.strings = [...strings];

  return out;
}

function memberName(sf, name) {
  if (ts.isIdentifier(name) || ts.isPrivateIdentifier(name) || ts.isStringLiteral(name)) return String(name.getText(sf)).replace(/^["']|["']$/g, '');
  return collapse(name.getText(sf), 40);
}

function firstLineOf(sf, node) {
  const source = sf.text ?? sf;
  let start = 0;
  try {
    start = node.getStart(sf, false);
  } catch {
    start = 0;
  }
  const head = source.slice(start, start + 260);
  const nl = head.indexOf('\n');
  const first = nl > 0 ? head.slice(0, nl) : head;
  // For `export const x = (` style lines, extend a bit to the initializer.
  if (/(=|\(|\{)\s*$/.test(first) && first.length < 120) {
    const two = head.slice(0, head.indexOf('\n', nl + 1) > 0 ? head.indexOf('\n', nl + 1) : 200);
    return two;
  }
  return first;
}




function isThisKeyword(node) {
  return !!node && node.kind === ts.SyntaxKind.ThisKeyword;
}
