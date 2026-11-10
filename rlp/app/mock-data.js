/* =============================================================================
 * mock-data.js — deterministic fixture generator for the RLP runtime.
 *
 * Produces a payload with the exact shape of `window.RLP_DATA` (CONTRACT.md
 * v0.1): ~120 symbols, 400 obligations, 8 paths, 4 storylines, 6 exercises,
 * 3 maintenance tasks, plus modules/imports/externals/report.
 *
 * Loaded explicitly (never by index.html): open index.html?mock=1, or press
 * "Load mock dataset" in the empty state. The real pipeline writes data.js.
 *
 * Deterministic: fixed-seed PRNG, no Math.random, sorted by id like the real
 * emitter.
 * ========================================================================== */

(function (root) {
  'use strict';

  /* --- deterministic PRNG (mulberry32) ---------------------------------- */
  let seed = 0x9e3779b9 >>> 0;
  function rnd() {
    seed = (seed + 0x6d2b79f5) >>> 0;
    let t = seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  const int = (n) => Math.floor(rnd() * n);
  const pick = (arr) => arr[int(arr.length)];
  const chance = (p) => rnd() < p;

  function hash10(input) {
    const s = String(input);
    let h1 = 0x811c9dc5;
    let h2 = 0x01000193;
    for (let i = 0; i < s.length; i++) {
      h1 ^= s.charCodeAt(i);
      h1 = Math.imul(h1, 0x01000193);
      h2 = Math.imul(h2 ^ s.charCodeAt(i), 0x85ebca6b);
    }
    const a = (h1 >>> 0).toString(16).padStart(8, '0');
    const b = (h2 >>> 0).toString(16).padStart(8, '0');
    return (a + b).slice(0, 10);
  }

  /* --- repository skeleton (real-looking paths) ------------------------- */
  const FS = [
    { f: 'packages/core/src/config/config.ts', p: 'core', syms: [
      ['Config', 'class', true], ['Config.setModel', 'method', false], ['Config.getModel', 'method', false],
      ['Config.getTargetDir', 'method', false], ['Config.loadSettings', 'method', false], ['validateSettings', 'function', true],
    ] },
    { f: 'packages/core/src/core/client.ts', p: 'core', syms: [
      ['GeminiClient', 'class', true], ['GeminiClient.sendMessage', 'method', false],
      ['GeminiClient.streamResponse', 'method', false], ['GeminiClient.buildPrompt', 'method', false],
    ] },
    { f: 'packages/core/src/core/contentGenerator.ts', p: 'core', syms: [
      ['ContentGenerator', 'interface', true], ['createContentGenerator', 'function', true],
      ['GoogleGenAIAdapter', 'class', true], ['resolveAuth', 'function', false],
    ] },
    { f: 'packages/core/src/core/turn.ts', p: 'core', syms: [
      ['Turn', 'class', true], ['Turn.run', 'method', false], ['Turn.handleToolCall', 'method', false],
    ] },
    { f: 'packages/core/src/utils/fetch.ts', p: 'core', syms: [
      ['fetchWithTimeout', 'function', true], ['retryWithBackoff', 'function', true], ['shouldRetry', 'function', false],
    ] },
    { f: 'packages/core/src/utils/getFolderStructure.ts', p: 'core', syms: [
      ['getFolderStructure', 'function', true], ['shouldIgnoreFile', 'function', false], ['IGNORE_PATTERNS', 'var', false],
    ] },
    { f: 'packages/core/src/utils/strings.ts', p: 'core', syms: [
      ['collapseWhitespace', 'function', true], ['truncateAnchor', 'function', false], ['slugify', 'function', false],
    ] },
    { f: 'packages/core/src/mcp/token-storage.ts', p: 'core', syms: [
      ['TokenStorage', 'class', true], ['TokenStorage.load', 'method', false], ['TokenStorage.save', 'method', false],
      ['encryptToken', 'function', false], ['decryptToken', 'function', false],
    ] },
    { f: 'packages/core/src/mcp/client.ts', p: 'core', syms: [
      ['McpClient', 'class', true], ['McpClient.connect', 'method', false],
      ['McpClient.listTools', 'method', false], ['parseSseChunk', 'function', false],
    ] },
    { f: 'packages/core/src/services/gitService.ts', p: 'core', syms: [
      ['GitService', 'class', true], ['GitService.getCurrentBranch', 'method', false],
      ['GitService.getRecentCommits', 'method', false], ['parseGitLog', 'function', false],
    ] },
    { f: 'packages/core/src/services/fileDiscovery.ts', p: 'core', syms: [
      ['discoverFiles', 'function', true], ['walkDirectory', 'function', false], ['isBinaryFile', 'function', false],
    ] },
    { f: 'packages/core/src/telemetry/logger.ts', p: 'core', syms: [
      ['Logger', 'class', true], ['Logger.log', 'method', false], ['Logger.flush', 'method', false],
    ] },
    { f: 'packages/core/src/utils/errors.ts', p: 'core', syms: [
      ['RlpError', 'class', true], ['isAbortError', 'function', true], ['normalizeError', 'function', false],
    ] },
    { f: 'packages/core/src/core/prompts.ts', p: 'core', syms: [
      ['getCoreSystemPrompt', 'function', true], ['buildToolPrompt', 'function', false],
    ] },
    { f: 'packages/core/src/config/config.test.ts', p: 'core', t: true, syms: [
      ['describeConfig', 'function', false], ['it_loadsSettings', 'function', false], ['it_rejectsUnknownModel', 'function', false],
    ] },

    { f: 'packages/cli/src/gemini.tsx', p: 'cli', syms: [
      ['main', 'function', false], ['parseArgs', 'function', false], ['startRepl', 'function', false], ['bootstrap', 'function', false],
    ] },
    { f: 'packages/cli/src/ui/App.tsx', p: 'cli', syms: [
      ['App', 'arrow', true], ['App.onSubmit', 'arrow', false], ['App.handleQuit', 'arrow', false],
    ] },
    { f: 'packages/cli/src/ui/components/InputPrompt.tsx', p: 'cli', syms: [
      ['InputPrompt', 'arrow', true], ['InputPrompt.handleKey', 'arrow', false], ['useHistory', 'function', false],
    ] },
    { f: 'packages/cli/src/ui/components/HistoryItemDisplay.tsx', p: 'cli', syms: [
      ['HistoryItemDisplay', 'arrow', true], ['renderMarkdown', 'function', false],
    ] },
    { f: 'packages/cli/src/ui/hooks/useSlashCommand.ts', p: 'cli', syms: [
      ['useSlashCommand', 'function', true], ['parseSlashCommand', 'function', false], ['COMMANDS', 'var', false],
    ] },
    { f: 'packages/cli/src/ui/hooks/useInput.ts', p: 'cli', syms: [
      ['useInput', 'function', true], ['mapKey', 'function', false],
    ] },
    { f: 'packages/cli/src/config/settings.ts', p: 'cli', syms: [
      ['loadCliSettings', 'function', true], ['mergeSettings', 'function', false], ['DEFAULT_SETTINGS', 'var', false],
    ] },
    { f: 'packages/cli/src/ui/themes/theme.ts', p: 'cli', syms: [
      ['Theme', 'interface', true], ['loadTheme', 'function', true], ['semanticColors', 'var', false],
    ] },
    { f: 'packages/cli/src/ui/App.test.tsx', p: 'cli', t: true, syms: [
      ['it_renders_splash', 'function', false], ['it_submits_prompt', 'function', false],
    ] },

    { f: 'packages/tools/src/tools/read-file.ts', p: 'tools', syms: [
      ['ReadFileTool', 'class', true], ['ReadFileTool.execute', 'method', false], ['ReadFileTool.validate', 'method', false],
    ] },
    { f: 'packages/tools/src/tools/shell.ts', p: 'tools', syms: [
      ['ShellTool', 'class', true], ['ShellTool.execute', 'method', false],
      ['ShellTool.confirm', 'method', false], ['isDangerousCommand', 'function', false],
    ] },
    { f: 'packages/tools/src/tools/write-file.ts', p: 'tools', syms: [
      ['WriteFileTool', 'class', true], ['WriteFileTool.execute', 'method', false], ['ensureDir', 'function', false],
    ] },
    { f: 'packages/tools/src/tools/memory.ts', p: 'tools', syms: [
      ['MemoryTool', 'class', true], ['MemoryTool.execute', 'method', false], ['MemoryTool.store', 'method', false],
    ] },
    { f: 'packages/tools/src/tools/tool-registry.ts', p: 'tools', syms: [
      ['ToolRegistry', 'class', true], ['ToolRegistry.register', 'method', false],
      ['ToolRegistry.get', 'method', false], ['ToolRegistry.list', 'method', false],
    ] },
    { f: 'packages/tools/src/utils/sandbox.ts', p: 'tools', syms: [
      ['createSandbox', 'function', true], ['isSandboxSupported', 'function', false], ['SandboxConfig', 'type', true],
    ] },
    { f: 'packages/tools/src/tools/google-web-search.ts', p: 'tools', syms: [
      ['GoogleWebSearchTool', 'class', true], ['GoogleWebSearchTool.execute', 'method', false],
    ] },
    { f: 'packages/tools/src/tools/shell.test.ts', p: 'tools', t: true, syms: [
      ['it_blocks_rm_rf', 'function', false], ['it_allows_git_status', 'function', false],
    ] },

    { f: 'packages/server/src/index.ts', p: 'server', syms: [
      ['createServer', 'function', true], ['startServer', 'function', true], ['registerRoutes', 'function', false],
    ] },
    { f: 'packages/server/src/routes/tools.ts', p: 'server', syms: [
      ['toolsRoute', 'function', false], ['listToolsHandler', 'function', false],
    ] },
    { f: 'packages/server/src/mcp/transport.ts', p: 'server', syms: [
      ['SseTransport', 'class', true], ['SseTransport.send', 'method', false], ['encodeEvent', 'function', false],
    ] },
    { f: 'packages/server/src/auth.ts', p: 'server', syms: [
      ['requireToken', 'function', true], ['verifyToken', 'function', false],
    ] },

    { f: 'packages/telemetry/src/index.ts', p: 'telemetry', syms: [
      ['initTelemetry', 'function', true], ['reportEvent', 'function', true], ['shutdownTelemetry', 'function', false],
    ] },
    { f: 'packages/telemetry/src/loggers.ts', p: 'telemetry', syms: [
      ['FileLogger', 'class', true], ['InMemoryLogger', 'class', true], ['redactPII', 'function', false],
    ] },
    { f: 'packages/telemetry/src/metrics.ts', p: 'telemetry', syms: [
      ['recordLatency', 'function', true], ['recordTokens', 'function', true],
    ] },
  ];

  /* --- id-building ------------------------------------------------------- */
  const fileLoc = new Map();
  for (const file of FS) fileLoc.set(file.f, 40 + int(520));

  const symbols = [];
  const byName = new Map();
  const symById = new Map();

  for (const file of FS) {
    for (const [name, kind, exported] of file.syms) {
      const id = 'S' + hash10(file.f + '::' + name);
      const anchor = makeAnchor(name, kind, exported);
      const sym = {
        id,
        n: name,
        k: kind,
        f: file.f,
        p: file.p,
        x: !!exported,
        t: !!file.t,
        a: anchor,
        e: 'E-' + hash10(file.f + '|' + name),
        c: 0,
        i: 0,
        b: 0,
        o: 0,
        q: 1,
        st: 'internal',
        doc: chance(0.34) ? docFor(name, kind) : '',
      };
      symbols.push(sym);
      byName.set(name, sym);
      symById.set(id, sym);
    }
  }

  function makeAnchor(name, kind, exported) {
    const exp = exported ? 'export ' : '';
    const short = name.split('.').pop();
    if (kind === 'class') return exp + 'class ' + short + ' implements ' + pick(['Disposable', 'ToolInvocation', 'ConfigParams']) + ' {';
    if (kind === 'method') return '  async ' + short + '(' + pick(['options: ToolOptions', 'model: string', 'signal?: AbortSignal']) + '): Promise<' + pick(['ToolResult', 'GenerateContentResponse', 'void']) + '> {';
    if (kind === 'interface') return exp + 'interface ' + short + ' {';
    if (kind === 'type') return exp + 'type ' + short + ' = { ' + pick(['enabled: boolean', 'root?: string', 'timeoutMs: number']) + ' };';
    if (kind === 'var') return exp + 'const ' + short + ': ' + pick(['Record<string, Command>', 'readonly string[]', 'Theme']) + ' = {';
    if (kind === 'arrow') return exp + 'const ' + short + ' = (' + pick(['props: AppProps', 'value: string', 'key: Key']) + ') => {';
    if (kind === 'constructor') return '  constructor(private readonly config: Config) {';
    return exp + 'function ' + short + '(' + pick(['input: string', 'config: Config', 'req: Request, res: Response']) + '): ' + pick(['Promise<void>', 'string', 'boolean']) + ' {';
  }

  function docFor(name, kind) {
    const short = name.split('.').pop();
    const docs = {
      class: 'Owns ' + short.toLowerCase() + ' lifecycle for the current repository snapshot.',
      method: 'Resolves ' + short.toLowerCase() + ' using the active configuration and cached credentials.',
      function: 'Pure helper used by the ' + short.toLowerCase() + ' pipeline; no I/O.' ,
      interface: 'Structural contract implemented by every ' + short.toLowerCase() + ' backend.',
      var: 'Static registry consulted at boot; mutated only through the documented API.',
      type: 'Shape shared between the analyzer and the runtime.',
      arrow: 'React component; renders the current ' + short.toLowerCase() + ' state.',
    };
    return docs[kind] || 'Declaration head captured as evidence.';
  }

  /* --- call graph -------------------------------------------------------- */
  const EDGES = [
    ['main', 'parseArgs'], ['main', 'bootstrap'], ['bootstrap', 'loadCliSettings'], ['bootstrap', 'Config'],
    ['bootstrap', 'GitService'], ['bootstrap', 'initTelemetry'], ['startRepl', 'App'], ['App', 'App.onSubmit'],
    ['App.onSubmit', 'useSlashCommand'], ['useSlashCommand', 'parseSlashCommand'], ['App.onSubmit', 'GeminiClient.sendMessage'],
    ['GeminiClient.sendMessage', 'GeminiClient.buildPrompt'], ['GeminiClient.sendMessage', 'Turn.run'],
    ['GeminiClient.sendMessage', 'retryWithBackoff'], ['GeminiClient.streamResponse', 'parseSseChunk'],
    ['createContentGenerator', 'resolveAuth'], ['createContentGenerator', 'GoogleGenAIAdapter'],
    ['GeminiClient', 'createContentGenerator'], ['Turn.run', 'Turn.handleToolCall'],
    ['Turn.handleToolCall', 'ToolRegistry.get'], ['ToolRegistry.get', 'ToolRegistry.list'],
    ['ToolRegistry.register', 'ToolRegistry.get'], ['ReadFileTool.execute', 'isSandboxSupported'],
    ['ReadFileTool.execute', 'shouldIgnoreFile'], ['ReadFileTool.execute', 'truncateAnchor'],
    ['ShellTool.execute', 'isDangerousCommand'], ['ShellTool.execute', 'ShellTool.confirm'],
    ['WriteFileTool.execute', 'ensureDir'], ['MemoryTool.execute', 'MemoryTool.store'],
    ['getFolderStructure', 'shouldIgnoreFile'], ['getFolderStructure', 'collapseWhitespace'],
    ['fetchWithTimeout', 'shouldRetry'], ['retryWithBackoff', 'fetchWithTimeout'],
    ['McpClient.connect', 'parseSseChunk'], ['McpClient.listTools', 'McpClient.connect'],
    ['SseTransport.send', 'encodeEvent'], ['createServer', 'registerRoutes'], ['createServer', 'requireToken'],
    ['startServer', 'createServer'], ['listToolsHandler', 'ToolRegistry.list'],
    ['requireToken', 'verifyToken'], ['initTelemetry', 'FileLogger'], ['reportEvent', 'recordLatency'],
    ['reportEvent', 'recordTokens'], ['FileLogger', 'redactPII'], ['InMemoryLogger', 'redactPII'],
    ['TokenStorage.save', 'encryptToken'], ['TokenStorage.load', 'decryptToken'],
    ['GitService.getRecentCommits', 'parseGitLog'], ['GitService.getCurrentBranch', 'parseGitLog'],
    ['Logger.log', 'redactPII'], ['Logger.flush', 'FileLogger'], ['useHistory', 'InputPrompt.handleKey'],
    ['InputPrompt', 'useHistory'], ['validateSettings', 'normalizeError'], ['Config.loadSettings', 'validateSettings'],
    ['isAbortError', 'normalizeError'], ['createSandbox', 'isSandboxSupported'],
    ['recordTokens', 'reportEvent'], ['listToolsHandler', 'encodeEvent'],
    ['GoogleWebSearchTool.execute', 'fetchWithTimeout'], ['GoogleWebSearchTool.execute', 'isSandboxSupported'],
    ['it_loadsSettings', 'Config'], ['it_submits_prompt', 'App'], ['it_blocks_rm_rf', 'isDangerousCommand'],
    ['it_allows_git_status', 'isDangerousCommand'], ['it_renders_splash', 'App'],
    ['describeConfig', 'Config'], ['it_rejectsUnknownModel', 'validateSettings'],
    ['discoverFiles', 'walkDirectory'], ['discoverFiles', 'isBinaryFile'], ['walkDirectory', 'shouldIgnoreFile'],
    ['getCoreSystemPrompt', 'collapseWhitespace'], ['HistoryItemDisplay', 'renderMarkdown'],
    ['loadTheme', 'semanticColors'], ['loadCliSettings', 'mergeSettings'], ['loadCliSettings', 'DEFAULT_SETTINGS'],
    ['useInput', 'mapKey'], ['parseSlashCommand', 'COMMANDS'], ['memoryToolStore', 'MemoryTool.store'],
    // deeper chains so recorded paths follow real call sequences, not random edges
    ['bootstrap', 'startRepl'], ['main', 'startRepl'], ['App', 'InputPrompt'],
    ['InputPrompt.handleKey', 'useInput'], ['App.onSubmit', 'InputPrompt'],
    ['McpClient.connect', 'TokenStorage.load'], ['TokenStorage.load', 'decryptToken'],
    ['decryptToken', 'normalizeError'], ['McpClient.listTools', 'ToolRegistry.register'],
    ['ToolRegistry.list', 'ToolRegistry.get'], ['createServer', 'toolsRoute'],
    ['toolsRoute', 'listToolsHandler'], ['startServer', 'initTelemetry'],
    ['initTelemetry', 'reportEvent'], ['reportEvent', 'recordLatency'],
    ['recordLatency', 'FileLogger'], ['ReadFileTool.execute', 'discoverFiles'],
    ['ShellTool.execute', 'createSandbox'], ['isSandboxSupported', 'SandboxConfig'],
    ['MemoryTool.store', 'TokenStorage.save'], ['TokenStorage.save', 'normalizeError'],
    ['normalizeError', 'RlpError'], ['registerRoutes', 'listToolsHandler'],
    ['registerRoutes', 'requireToken'], ['shouldIgnoreFile', 'IGNORE_PATTERNS'],
  ];

  const calls = [];
  const seenEdge = new Set();
  const curatedOut = new Map();

  function addEdge(aName, bName, kind) {
    const a = byName.get(aName);
    const b = byName.get(bName);
    if (!a || !b || a.id === b.id) return;
    const key = a.id + '>' + b.id;
    if (seenEdge.has(key)) return;
    seenEdge.add(key);
    calls.push({ a: a.id, b: b.id, k: kind || 'calls', n: 1 + (int(4)) });
  }

  for (const [a, b] of EDGES) {
    let kind = 'calls';
    if (['Config', 'GitService', 'ShellTool', 'McpClient', 'FileLogger', 'InMemoryLogger'].indexOf(b) >= 0 && !a.includes('.')) kind = 'constructs';
    else if (a.indexOf('sendMessage') >= 0 || a === 'GoogleWebSearchTool.execute') kind = 'awaits';
    else if (b.indexOf('encodeEvent') >= 0) kind = 'nested';
    addEdge(a, b, kind);
    const A = byName.get(a);
    const B = byName.get(b);
    if (A && B && A.id !== B.id) {
      if (!curatedOut.has(A.id)) curatedOut.set(A.id, []);
      const list = curatedOut.get(A.id);
      if (list.indexOf(B.id) < 0) list.push(B.id);
    }
  }

  // synthetic background edges so fan-in/fan-out is not uniform
  for (let i = 0; i < 70; i++) {
    const a = symbols[(i * 17 + 5) % symbols.length];
    const b = symbols[(i * 23 + 9) % symbols.length];
    if (a && b) addEdge(a.n, b.n, i % 5 === 0 ? 'awaits' : 'calls');
  }

  const callsOut = new Map();
  const callsIn = new Map();
  for (const edge of calls) {
    (callsOut.get(edge.a) || callsOut.set(edge.a, []).get(edge.a)).push(edge);
    (callsIn.get(edge.b) || callsIn.set(edge.b, []).get(edge.b)).push(edge);
  }

  /* --- obligations ------------------------------------------------------- */
  const TYPE_POOL = [
    'branch', 'branch', 'branch', 'branch',
    'exception', 'exception', 'loop', 'loop',
    'return', 'return', 'throw', 'call-edge',
    'symbol', 'scenario', 'scenario', 'e2e-path', 'maintenance',
  ];

  const EXPRS = [
    'config.trusted', 'resp.ok', 'token !== undefined', 'files.length > 0',
    'process.env.CI', 'mode === "stream"', 'settings.mcpServers', 'turn.toolCalls.length',
    'sandbox.supported', 'args.includes("--yolo")',
  ];
  const RISKS = ['security', 'security', 'persistence', 'network', 'network', 'state', 'state',
    'error-handling', 'error-handling', 'null-safety', 'config', 'ui', 'none', 'none', 'none'];

  function statusFor() {
    const r = rnd();
    if (r < 0.44) return 'covered';
    if (r < 0.70) return 'uncovered';
    if (r < 0.85) return 'unknown';
    if (r < 0.94) return 'infeasible';
    return 'excluded';
  }

  function reasonFor(status) {
    if (status === 'unknown') {
      return pick([
        'dynamic dispatch target unresolved at analysis time',
        'runtime tool registration in a plugin loader',
        'budget cap hit while expanding this module',
        'value comes from process.env and is not modelled',
      ]);
    }
    if (status === 'infeasible') return 'guard proves this branch false under the current model (constant propagation)';
    if (status === 'excluded') return 'out of target scope: generated or vendored code';
    return '';
  }

  const obligations = [];
  const TOTAL_OBLIGATIONS = 400;

  for (let i = 0; i < TOTAL_OBLIGATIONS; i++) {
    const sym = symbols[(i * 13 + 7) % symbols.length];
    const type = TYPE_POOL[i % TYPE_POOL.length];
    const status = statusFor();
    const outcome = outcomeFor(type);
    const label = labelFor(type, sym, outcome);
    const id = 'OB-' + hash10(sym.id + '|' + type + '|' + outcome + '|' + i);
    const ob = {
      id,
      t: type,
      s: sym.id,
      f: sym.f,
      n: type === 'symbol' ? '' : 'n' + (1 + (i % 9)),
      o: outcome,
      l: label,
      st: status,
      r: reasonFor(status),
      e: 'E-' + hash10(id),
      cat: pick(RISKS),
      crit: chance(0.22) ? 3 : chance(0.4) ? 2 : 1,
      p: Number((0.25 + rnd() * 0.7).toFixed(2)),
    };
    obligations.push(ob);
  }

  function outcomeFor(type) {
    if (type === 'branch') return pick(['true', 'false', 'case:0', 'case:1', 'default']);
    if (type === 'exception') return pick(['success', 'error']);
    if (type === 'loop') return pick(['empty', 'iterate']);
    if (type === 'throw') return 'error';
    if (type === 'return') return 'success';
    if (type === 'call-edge') return 'success';
    if (type === 'scenario') return pick(['success', 'error', 'timeout']);
    if (type === 'e2e-path') return pick(['success', 'timeout']);
    if (type === 'maintenance') return 'success';
    return 'entry';
  }

  function labelFor(type, sym, outcome) {
    const short = sym.n.split('.').pop();
    if (type === 'branch') return 'if (' + pick(EXPRS) + ') → ' + outcome;
    if (type === 'exception') return 'catch (e) around ' + short + '() → ' + outcome;
    if (type === 'loop') return 'for (const item of ' + short.toLowerCase() + 's) → ' + outcome;
    if (type === 'return') return 'return ' + short + 'Result';
    if (type === 'throw') return 'throw new RlpError("' + short + ' failed")';
    if (type === 'call-edge') return 'await ' + short + '(…)';
    if (type === 'scenario') return 'scenario: ' + short + ' under ' + outcome;
    if (type === 'e2e-path') return 'e2e: ' + short + ' journey';
    if (type === 'maintenance') return 'maintenance: ' + short + ' refactor gate';
    return 'enter ' + sym.n;
  }

  /* --- paths (walk the call graph) --------------------------------------- */
  const ENTRIES = ['main', 'App', 'createServer', 'ShellTool.execute', 'McpClient.connect',
    'initTelemetry', 'ReadFileTool.execute', 'useSlashCommand'];
  const PATH_TITLES = [
    'Cold start → first turn', 'Prompt submit → model turn', 'Server boot → tool route',
    'Shell tool → sandbox gate', 'MCP connect → tool listing', 'Telemetry init → flush',
    'Read file → ignore rules', 'Slash command → dispatch',
  ];

  function longestChain(id, seen, budget) {
    if (budget <= 0 || seen.has(id)) return 0;
    seen.add(id);
    let best = 0;
    for (const next of curatedOut.get(id) || []) {
      best = Math.max(best, 1 + longestChain(next, seen, budget - 1));
    }
    seen.delete(id);
    return best;
  }

  const paths = [];

  for (let i = 0; i < ENTRIES.length; i++) {
    const entry = byName.get(ENTRIES[i]);
    if (!entry) continue;
    const steps = [];
    const visited = new Set();
    let cursor = entry;
    let depth = 0;
    while (cursor && depth < 14) {
      visited.add(cursor.id);
      steps.push(makeStep(cursor, depth));
      // follow the declared call edges only, preferring the branch that continues furthest
      const candidates = (curatedOut.get(cursor.id) || []).filter((id) => !visited.has(id));
      if (!candidates.length) break;
      let nextId = candidates[0];
      let best = -1;
      for (const id of candidates) {
        const score = longestChain(id, new Set(), 8);
        if (score > best) { best = score; nextId = id; }
      }
      cursor = symById.get(nextId);
      depth += 1;
    }
    const covers = [];
    for (const sid of visited) {
      const list = obligations.filter((o) => o.s === sid).slice(0, 2);
      for (const o of list) covers.push(o.id);
    }
    const id = 'P' + (i + 1);
    paths.push({
      id,
      entry: entry.id,
      title: PATH_TITLES[i] || ('Path ' + (i + 1)),
      steps,
      covers,
      terminal: steps[steps.length - 1].s,
      length: steps.length,
      tier: (i % 5) + 1,
    });
  }

  function makeStep(sym, depth) {
    const obs = obligations.filter((o) => o.s === sym.id);
    const ob = obs[0];
    return {
      s: sym.id,
      f: sym.f,
      n: ob ? ob.n || ('n' + (depth + 1)) : 'n' + (depth + 1),
      o: ob ? ob.o : 'success',
      l: ob ? ob.l : 'enter ' + sym.n,
      e: 'E-' + hash10(sym.id + '|step|' + depth),
    };
  }

  // obligations with a static path witness become covered
  const coveredIds = new Set();
  for (const p of paths) for (const id of p.covers) coveredIds.add(id);
  for (const ob of obligations) {
    if (coveredIds.has(ob.id)) {
      ob.st = 'covered';
      ob.r = '';
    }
  }

  /* --- post-pass symbol fields ------------------------------------------- */
  const entryIds = new Set(ENTRIES.map((n) => byName.get(n) && byName.get(n).id).filter(Boolean));
  for (const sym of symbols) {
    const obs = obligations.filter((o) => o.s === sym.id);
    sym.o = obs.length;
    sym.b = obs.filter((o) => o.t === 'branch' || o.t === 'exception').length;
    sym.q = sym.b + 1;
    sym.c = (callsOut.get(sym.id) || []).length;
    sym.i = (callsIn.get(sym.id) || []).length;
    if (entryIds.has(sym.id)) sym.st = 'entry';
    else if (!sym.c) sym.st = 'leaf';
    else sym.st = 'internal';
  }

  // a couple of exported leaves with no doc, for realism
  const noDocLeaf = symbols.find((s) => s.st === 'leaf' && s.x);
  if (noDocLeaf) noDocLeaf.doc = '';

  /* --- files / packages -------------------------------------------------- */
  const files = [];
  const filesByPkg = new Map();
  for (const file of FS) {
    const count = file.syms.length;
    const entry = { f: file.f, p: file.p, l: fileLoc.get(file.f) || 120, t: !!file.t, s: count };
    files.push(entry);
    if (!filesByPkg.has(file.p)) filesByPkg.set(file.p, []);
    filesByPkg.get(file.p).push(entry);
  }

  const packages = Array.from(filesByPkg.entries()).map(([name, list]) => ({
    name,
    files: list.length,
    symbols: list.reduce((a, b) => a + b.s, 0),
    loc: list.reduce((a, b) => a + b.l, 0),
  })).sort((a, b) => (a.name < b.name ? -1 : 1));

  /* --- modules / imports / externals ------------------------------------- */
  const modules = files.map((file) => ({
    id: 'MOD-' + hash10(file.f),
    n: file.f.split('/').pop(),
    f: file.f,
    p: file.p,
    k: 'module',
    a: '// ' + file.f,
    e: 'E-' + hash10('mod' + file.f),
  }));

  const imports = [];
  for (let i = 0; i < 40; i++) {
    const a = files[(i * 7) % files.length];
    const b = files[(i * 11 + 3) % files.length];
    if (a.f === b.f) continue;
    imports.push({
      a: a.f,
      b: b.f,
      k: a.p === b.p ? 'internal' : 'workspace',
      w: '@rlp/' + b.p + '/' + b.f.split('/').pop().replace(/\.[a-z]+$/, ''),
    });
  }

  const externals = [
    ['react', 'ui'], ['yargs', 'cli'], ['@google/genai', 'network'], ['zod', 'validation'],
    ['simple-git', 'vcs'], ['undici', 'network'], ['ink', 'ui'], ['vitest', 'testing'],
  ].map(([n, cat]) => ({ id: 'EXT-' + hash10(n), n, cat, c: 2 + int(30) }));

  /* --- storylines -------------------------------------------------------- */
  const storylines = [1, 2, 3, 4].map((n) => {
    const path = paths[n - 1] || paths[0];
    const actSteps = path.steps;
    const chunk = Math.max(1, Math.ceil(actSteps.length / 3));
    const acts = [];
    for (let a = 0; a < 3; a++) {
      const slice = actSteps.slice(a * chunk, (a + 1) * chunk);
      if (!slice.length) break;
      acts.push({
        n: a + 1,
        title: ['Where it starts', 'What the data does', 'How it ends'][a],
        body: 'Follow ' + path.title.toLowerCase() + ' through ' + slice.length + ' recorded step(s). ' +
          'Each step names the symbol that owns the behaviour and the outcome the analyzer witnessed.',
        symbols: slice.map((s) => s.s),
        obligations: path.covers.slice(a * 2, a * 2 + 3),
      });
    }
    return {
      id: 'ST' + n,
      path: path.id,
      title: path.title,
      premise: 'A guided walk of ' + path.title + ' as recorded in the coverage knowledge graph.',
      acts,
      objectives: ['Explain the branch outcomes taken in ' + path.id, 'Name the entry point and terminal symbol'],
      level: path.tier,
    };
  });

  /* --- objectives, exercises, assessments -------------------------------- */
  const objectives = [1, 2, 3, 4, 5, 6].map((n) => {
    const path = paths[n % paths.length];
    return {
      id: 'O' + n,
      level: (n % 5) + 1,
      text: 'Trace ' + path.title.toLowerCase() + ' from ' + (byName.get(ENTRIES[n % ENTRIES.length]) || {}).n + ' to its terminal branch.',
      symbols: path.steps.slice(0, 3).map((s) => s.s),
      obligations: path.covers.slice(0, 3),
    };
  });

  function symId(name) { return byName.get(name) ? byName.get(name).id : ''; }
  function obsOf(name, count) {
    const id = symId(name);
    return obligations.filter((o) => o.s === id).slice(0, count || 2).map((o) => o.id);
  }

  const exercises = [
    {
      id: 'X1', k: 'comprehension', level: 1,
      title: 'Entry point of the CLI',
      prompt: 'Which symbol is the recorded entry point for the cold-start path?',
      choices: [
        { id: 'a', text: 'bootstrap', correct: false },
        { id: 'b', text: 'main', correct: true },
        { id: 'c', text: 'startRepl', correct: false },
      ],
      explain: 'paths[].entry for P1 resolves to main; bootstrap and startRepl are callees below it.',
      symbols: [symId('main'), symId('bootstrap'), symId('startRepl')],
      obligations: obsOf('main', 2),
      evidence: ['E-' + hash10('main')],
    },
    {
      id: 'X2', k: 'diagnosis', level: 2,
      title: 'Why is a branch "unknown"?',
      prompt: 'A branch in ToolRegistry.get is marked unknown. What does that status mean here?',
      choices: [
        { id: 'a', text: 'The branch was proven unreachable', correct: false },
        { id: 'b', text: 'Static analysis could not decide it (dynamic dispatch / registration)', correct: true },
        { id: 'c', text: 'It was deliberately excluded from scope', correct: false },
      ],
      explain: 'unknown is the "undecidable" bucket: dynamic dispatch, runtime registration, or a budget cap. It is not a failure verdict.',
      symbols: [symId('ToolRegistry.get'), symId('ToolRegistry.list')],
      obligations: obsOf('ToolRegistry.get', 3),
      evidence: ['E-' + hash10('ToolRegistry.get')],
    },
    {
      id: 'X3', k: 'impact', level: 3,
      title: 'Signature change fallout',
      prompt: 'If ShellTool.execute changed its return type, which group is the first to break?',
      choices: [
        { id: 'a', text: 'Its callers (upstream dependencies)', correct: true },
        { id: 'b', text: 'The files it imports', correct: false },
        { id: 'c', text: 'Nothing — it is not exported', correct: false },
      ],
      explain: 'Callers consume the return shape; impact[].direct lists them. Downstream callees are unaffected by the shape of their caller.',
      symbols: [symId('ShellTool.execute'), symId('ShellTool'), symId('isDangerousCommand')],
      obligations: obsOf('ShellTool.execute', 3),
      evidence: ['E-' + hash10('ShellTool.execute')],
    },
    {
      id: 'X4', k: 'patch', level: 3,
      title: 'Witness a timeout branch',
      prompt: 'Describe the smallest edit that would give the scenario "McpClient.connect timeout" a static witness.',
      answer: 'Thread an explicit timeout constant into the connect call and handle the rejecting branch, so the path planner can build a chain from the entry point.',
      explain: 'A witness needs a resolvable chain from an entry point to the obligation; dynamic timeouts registered at runtime stay unknown.',
      symbols: [symId('McpClient.connect'), symId('parseSseChunk')],
      obligations: obsOf('McpClient.connect', 2),
      evidence: ['E-' + hash10('McpClient.connect')],
    },
    {
      id: 'X5', k: 'diagnosis', level: 4,
      title: 'Unknown ratio vs covered',
      prompt: 'The dashboard shows 44% covered and an unknown ratio of 15%. Are the remaining 41% definitely broken?',
      choices: [
        { id: 'a', text: 'Yes — not covered means dead code', correct: false },
        { id: 'b', text: 'No — uncovered is a path-planner gap, infeasible is proven unreachable, excluded is out of scope', correct: true },
        { id: 'c', text: 'Only if critical_gaps > 0', correct: false },
      ],
      explain: 'The five statuses are not interchangeable. Only uncovered obligations are candidate gaps; infeasible and excluded are not debts.',
      symbols: [symId('Config'), symId('Config.loadSettings')],
      obligations: obsOf('Config', 3),
      evidence: ['E-' + hash10('Config')],
    },
    {
      id: 'X6', k: 'impact', level: 5,
      title: 'Ownership handover',
      prompt: 'Which artefacts would you hand over for a subsystem you now own? Name the evidence you would cite.',
      answer: 'Path witnesses for each entry point, the covered/uncovered split per dimension, the unknown ratio with reasons, and the test reachability for the interface contracts.',
      explain: 'Ownership is demonstrated by evidence, not by a single percentage: per-dimension coverage, unknown reasons, and test reachability of contracts.',
      symbols: [symId('createServer'), symId('initTelemetry'), symId('main')],
      obligations: obsOf('createServer', 3),
      evidence: ['E-' + hash10('createServer')],
    },
  ];

  const assessments = [1, 2, 3, 4, 5].map((level) => ({
    id: 'A' + level,
    level,
    kind: level >= 4 ? 'transfer' : 'recall',
    text: 'Level ' + level + ' capability check: explain the recorded evidence for this tier and name what is still undemonstrated.',
    checks: ['paths replayed', 'exercises answered', 'lab tasks complete'],
    exercise: exercises.filter((e) => e.level === level).map((e) => e.id),
    weight: 1,
  }));

  /* --- maintenance ------------------------------------------------------- */
  const maintenance = [
    {
      id: 'MT1',
      k: 'refactor',
      title: 'Split Config.loadSettings into parse + validate',
      prompt: 'loadSettings mixes file parsing, env merging and validation. Split it without changing the public surface, and name every module you must touch.',
      steps: [
        'Read the current loadSettings body and list the call sites (fan-in).',
        'Extract parseSettingsFile returning a partial settings object.',
        'Keep validateSettings as the single validation gate.',
        'Re-run the config tests and confirm the coverage witness still exists.',
      ],
      level: 2,
      symbols: [symId('Config.loadSettings'), symId('validateSettings'), symId('Config'), symId('normalizeError')],
      tests: [symId('it_loadsSettings'), symId('it_rejectsUnknownModel')],
      risk: 2,
    },
    {
      id: 'MT2',
      k: 'bugfix',
      title: 'SSE chunks split mid-event',
      prompt: 'parseSseChunk assumes each chunk ends on a frame boundary. Fix the buffering and identify every consumer of the parsed event stream.',
      steps: [
        'Reproduce with a chunk that ends mid-JSON.',
        'Buffer the remainder and only emit complete frames.',
        'Check SseTransport.send for the mirror assumption.',
        'Add a regression test next to the MCP client tests.',
      ],
      level: 3,
      symbols: [symId('parseSseChunk'), symId('McpClient.connect'), symId('SseTransport.send'), symId('encodeEvent')],
      tests: [],
      risk: 3,
    },
    {
      id: 'MT3',
      k: 'migration',
      title: 'Move MCP tokens to the OS keychain',
      prompt: 'Replace the file-backed token store with a keychain adapter, keeping the persisted format readable for one release.',
      steps: [
        'Introduce a TokenStore interface with load/save.',
        'Implement the keychain adapter behind a feature flag.',
        'Keep encryptToken/decryptToken for the legacy read path.',
        'Backfill: read file store, write keychain, mark legacy as read-only.',
      ],
      level: 4,
      symbols: [symId('TokenStorage'), symId('TokenStorage.load'), symId('TokenStorage.save'), symId('encryptToken'), symId('decryptToken')],
      tests: [],
      risk: 3,
    },
  ];

  const testing = [
    { id: 'T1', s: symId('isDangerousCommand'), kind: 'unit', text: 'Assert that rm -rf / is rejected and git status is allowed.', covers: obsOf('isDangerousCommand', 3), exists: true },
    { id: 'T2', s: symId('parseSseChunk'), kind: 'unit', text: 'Feed split frames and assert a single parsed event.', covers: obsOf('parseSseChunk', 3), exists: false },
    { id: 'T3', s: symId('validateSettings'), kind: 'unit', text: 'Reject unknown model ids with a field-level error.', covers: obsOf('validateSettings', 2), exists: true },
    { id: 'T4', s: symId('createServer'), kind: 'integration', text: 'Boot the server, hit /tools, assert 200 and a tool list.', covers: obsOf('createServer', 3), exists: false },
    { id: 'T5', s: symId('encryptToken'), kind: 'unit', text: 'Round-trip a token and assert the ciphertext differs per salt.', covers: obsOf('encryptToken', 2), exists: false },
    { id: 'T6', s: symId('App.onSubmit'), kind: 'component', text: 'Submit a prompt and assert the history row is appended.', covers: obsOf('App.onSubmit', 2), exists: true },
  ];

  const impact = [
    {
      id: 'I1',
      s: symId('ShellTool.execute'),
      direct: [symId('ShellTool')].filter(Boolean),
      indirect: [symId('ToolRegistry.get'), symId('Turn.handleToolCall')].filter(Boolean),
      tests: [symId('it_blocks_rm_rf'), symId('it_allows_git_status')].filter(Boolean),
      shared_state: [symId('isDangerousCommand')].filter(Boolean),
      contracts: [symId('ShellTool')].filter(Boolean),
      risk: 0.82,
      note: 'Two test symbols reach the shell tool within 2 hops, but the dangerous-command predicate is the only shared gate — a return-shape change breaks the registry callers first.',
    },
    {
      id: 'I2',
      s: symId('McpClient.connect'),
      direct: [symId('McpClient.listTools')].filter(Boolean),
      indirect: [symId('listToolsHandler')].filter(Boolean),
      tests: [],
      shared_state: [symId('parseSseChunk')].filter(Boolean),
      contracts: [symId('McpClient')].filter(Boolean),
      risk: 0.61,
      note: 'No test symbol reaches connect within 2 hops; the transport chunk parser is the shared failure point.',
    },
    {
      id: 'I3',
      s: symId('Config.setModel'),
      direct: [symId('Config'), symId('validateSettings')].filter(Boolean),
      indirect: [symId('loadCliSettings'), symId('bootstrap')].filter(Boolean),
      tests: [symId('it_loadsSettings')].filter(Boolean),
      shared_state: [symId('DEFAULT_SETTINGS')].filter(Boolean),
      contracts: [symId('Config')].filter(Boolean),
      risk: 0.44,
      note: 'Model selection flows through bootstrap and the CLI settings merge; one test covers the read path only.',
    },
  ];

  const gaps = [
    { id: 'G1', kind: 'uncovered-critical', s: symId('ShellTool.execute'), f: 'packages/tools/src/tools/shell.ts', text: 'Dangerous-command guard has no witness for the default branch.', reason: 'path planner did not enumerate the deny path' },
    { id: 'G2', kind: 'unknown', s: symId('ToolRegistry.get'), f: 'packages/tools/src/tools/tool-registry.ts', text: 'Registry lookup outcome depends on runtime registration order.', reason: 'dynamic registration' },
    { id: 'G3', kind: 'uncovered', s: symId('McpClient.connect'), f: 'packages/core/src/mcp/client.ts', text: 'SSE reconnect branch has no path witness.', reason: 'timeout value not modelled' },
    { id: 'G4', kind: 'excluded', s: symId('renderMarkdown'), f: 'packages/cli/src/ui/components/HistoryItemDisplay.tsx', text: 'Markdown renderer excluded from target scope.', reason: 'vendored renderer' },
    { id: 'G5', kind: 'infeasible', s: symId('shutdownTelemetry'), f: 'packages/telemetry/src/index.ts', text: 'Shutdown hook is unreachable from any entry point in this snapshot.', reason: 'proven unreachable' },
  ];

  /* --- report ------------------------------------------------------------ */
  const typeKeys = Array.from(new Set(obligations.map((o) => o.t))).sort();
  const coverage = {};
  for (const key of typeKeys) {
    const list = obligations.filter((o) => o.t === key);
    const covered = list.filter((o) => o.st === 'covered').length;
    const unknown = list.filter((o) => o.st === 'unknown').length;
    const excluded = list.filter((o) => o.st === 'excluded').length;
    coverage[key] = {
      covered,
      total: list.length,
      unknown,
      excluded,
      pct: Number((covered / list.length).toFixed(4)),
    };
  }
  {
    const covered = obligations.filter((o) => o.st === 'covered').length;
    const unknown = obligations.filter((o) => o.st === 'unknown').length;
    const excluded = obligations.filter((o) => o.st === 'excluded').length;
    coverage['all obligations'] = {
      covered,
      total: obligations.length,
      unknown,
      excluded,
      pct: Number((covered / obligations.length).toFixed(4)),
    };
  }

  const LEVEL_NAMES = ['Orientation', 'Control flow', 'Data & contracts', 'Failure modes', 'Ownership'];
  const levels = LEVEL_NAMES.map((name, i) => {
    const level = i + 1;
    const symIds = new Set();
    for (const p of paths) {
      if (p.tier !== level) continue;
      for (const s of p.steps) symIds.add(s.s);
    }
    let count = 0;
    const kinds = new Set();
    for (const id of symIds) {
      for (const o of obligations) {
        if (o.s !== id) continue;
        count += 1;
        kinds.add(o.t);
      }
    }
    return {
      level,
      name,
      obligations: count,
      evidence_kinds: Array.from(kinds).sort(),
    };
  });

  const report = {
    coverage,
    unknown_ratio: Number((obligations.filter((o) => o.st === 'unknown').length / obligations.length).toFixed(4)),
    critical_gaps: obligations.filter((o) => o.st === 'uncovered' && (o.crit || 1) >= 2).length,
    levels,
    policy: [
      'covered = static path witness, not runtime execution',
      'unknown ≠ 0 coverage: it is undecidable, never silently rounded down',
      'infeasible and excluded are not debts',
    ],
  };

  /* --- cfg samples ------------------------------------------------------- */
  const cfgs = {};
  for (const name of ['ShellTool.execute', 'parseSseChunk', 'GeminiClient.sendMessage', 'createServer', 'Config.loadSettings', 'validateSettings']) {
    const sym = byName.get(name);
    if (!sym) continue;
    const nodes = [
      { id: 'n1', k: 'entry', l: 'entry', a: sym.a },
      { id: 'n2', k: 'branch', l: 'if (' + pick(EXPRS) + ')', a: '' },
      { id: 'n3', k: 'call', l: 'call ' + pick(['tool', 'fetch', 'validate']), a: '' },
      { id: 'n4', k: 'exit', l: 'exit', a: '' },
    ];
    cfgs[sym.id] = {
      nodes,
      edges: [
        { f: 'n1', t: 'n2', k: 'seq' },
        { f: 'n2', t: 'n3', k: 'true' },
        { f: 'n2', t: 'n4', k: 'false' },
        { f: 'n3', t: 'n4', k: 'seq' },
      ],
    };
  }

  /* --- counts + sorting --------------------------------------------------- */
  const meta = {
    repository: 'rlp-labs/gemini-cli-fixture',
    commit: '4b0d1a7c9e2f3a5b6c8d9e0f1a2b3c4d5e6f7a8b',
    branch: 'main',
    generated_at: '2026-11-09T14:02:11Z',
    analysis_version: 'rlp-0.1.0',
    languages: ['typescript'],
    package_names: packages.map((p) => p.name),
    counts: {
      symbols: symbols.length,
      obligations: obligations.length,
      paths: paths.length,
      files: files.length,
      packages: packages.length,
      calls: calls.length,
      covered: obligations.filter((o) => o.st === 'covered').length,
      uncovered: obligations.filter((o) => o.st === 'uncovered').length,
      unknown: obligations.filter((o) => o.st === 'unknown').length,
    },
    truncated: false,
  };

  const byId = (a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

  const payload = {
    meta,
    packages,
    files: files.slice().sort((a, b) => (a.f < b.f ? -1 : 1)),
    symbols: symbols.slice().sort(byId),
    calls: calls.slice().sort((a, b) => (a.a < b.a ? -1 : a.a > b.a ? 1 : a.b < b.b ? -1 : 1)),
    modules,
    imports,
    externals,
    obligations: obligations.slice().sort(byId),
    cfgs,
    paths: paths.slice().sort(byId),
    storylines,
    objectives,
    exercises,
    assessments,
    impact,
    maintenance,
    testing,
    gaps,
    report,
  };

  root.RLP_DATA = payload;
  root.RLP_MOCK = true;
  if (typeof module !== 'undefined' && module.exports) module.exports = payload;
  if (typeof console !== 'undefined' && console.log) {
    console.log('[mock-data] symbols=' + symbols.length + ' obligations=' + obligations.length +
      ' paths=' + paths.length + ' files=' + files.length);
  }
})(typeof window !== 'undefined' ? window : globalThis);
