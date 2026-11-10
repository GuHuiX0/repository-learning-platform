# Repository Learning Platform (RLP)

**从源码快照到可验证的代码所有权。**

输入一个**版本绑定**的代码仓库快照，输出一个**可交互、可审计、可考核**的 Repository Learning Package：
知识图谱 + 覆盖义务 + 确定性路径套件 + 学习课程 + 维护工具箱 + 浏览器运行时。

不是 "AI 代码讲解器"，而是 **Repository Onboarding & Maintenance Infrastructure**。

```
Repository Snapshot → Knowledge → Understanding → Maintenance
```

---

## 1. 输入 / 输出契约

**输入**：一个确定版本的仓库（`git rev-parse HEAD` 固定）。

**输出**：一个 ZIP，目录结构固定：

```
repository-learning-package/
├── manifest.json                  # 快照、分析版本、产物状态、计数、限制声明
├── analysis/                      # L0-L1 知识层
│   ├── repository-index.json      # 包 / 文件清单
│   ├── symbol-index.json          # 符号（id 为 file+qualified 的哈希，不含行号）
│   ├── call-graph.json            # 已解析调用边（含 may-reach 标记）
│   ├── control-flow-graph.json    # 每个符号的基本块 + 带类型边
│   ├── data-flow-graph.json       # 类字段状态通道 + env 读取
│   ├── dependency-graph.json      # 文件级导入 + 外部依赖
│   └── source-evidence.json       # 每条结论的源码锚点
├── coverage/                      # 覆盖模型
│   ├── coverage-obligations.json  # 全部覆盖义务及其状态
│   ├── branch-coverage.json       # 每个符号的分支覆盖
│   ├── scenario-matrix.json       # 外部结果锚点 × 结果 × 状态
│   ├── path-coverage.json         # 路径套件与义务映射
│   └── coverage-gaps.json         # 未覆盖 / 未知 / 关键缺口
├── learning/
│   ├── path-suite.json            # 确定性路径（入口 → 终止，含每步 CFG 节点与分支走向）
│   ├── storylines.json            # 路径的教学化包装（acts 绑定源码证据）
│   ├── learning-objectives.json   # L1-L5 目标（按包 / 模块）
│   ├── exercises.json             # 理解 / 诊断 / 影响 / 补丁练习
│   └── assessments.json           # 五级能力考核项
├── maintenance/
│   ├── impact-map.json            # 直接/间接调用者、相关测试、共享状态、风险
│   ├── maintenance-tasks.json     # 契约变更 / 错误传播 / 覆盖缺口任务
│   ├── testing-recommendations.json
│   └── OWNERSHIP_REPORT.md        # 模块级可维护性报告
└── app/                           # 运行时（Material Design 3，离线可用）
    ├── index.html · app.css · app.js
    └── data.js                    # 运行时载荷（window.RLP_DATA）
```

`app/index.html` 直接双击即可打开（`file://` 可用）。需要完整图谱时用任意静态服务器托管该目录。

---

## 2. 核心概念

### 2.1 Coverage Obligation（覆盖义务）

平台不挑"有趣的 10 条故事线"，而是先把仓库拆成**可审计的覆盖义务**：

| 类型 | 含义 |
| --- | --- |
| `symbol` | 每个非测试符号必须被索引并解释 |
| `call-edge` | 每条已解析调用关系必须可追踪 |
| `branch` / `loop` | 每个条件出口、循环零次/迭代出口 |
| `exception` / `throw` / `return` | 异常接管出口、抛出、返回终止 |
| `scenario` | 每个外部结果（成功/失败/超时/限流/缺失…） |
| `e2e-path` | 从声明入口到终止的完整路径 |

状态严格区分，**永不混算**：

- `covered` — 有静态路径见证（链证据 `chain` 或路径套件 `path`，或被测试驱动 `test`）
- `uncovered` — 可达但无见证（预算/路线原因写入 `reason`）
- `unknown` — 静态分析无法判定（动态派发、按名引用、预算截断）
- `infeasible` — 在当前模型下证明不可达
- `excluded` — 明确排除（默认排除测试脚手架，可用 `--include-tests` 纳入）

### 2.2 两层见证

- **结构层**：只要能证明存在 `entry → … → 符号` 的静态调用链，`symbol / call-edge / e2e-path` 即为 covered。
- **方向层**：`branch / loop / scenario / exception` 必须由**具体路径**选择一个分支方向。一次执行只能走一个方向，所以两个方向需要两条路径。这是真实的路径覆盖，不是故事线数量。

### 2.3 路径规划 = 候选生成 + 惰性贪心集合覆盖

- 候选：每个可达符号 × 其 CFG 路线（≤8 条，DFS 枚举，循环允许 2 次重入）。
- 选择：按**关键度加权**的惰性贪心（最大堆 + 稳定 tie-break），受 `--max-paths` 预算约束。
- 产出：`witness: modelled | may-reach`；依赖 RTA 边的路径永远标 `may-reach`，不冒充必须可达。

### 2.4 诚实的静态分析边界

- 只做**语法级**分析（TypeScript Compiler API，无类型检查）。
- 无法解析的接收者（`this.config.getX()`、参数对象、链式调用）记为 `unknown` 并写入原因，不猜。
- 类被实例化即认为其方法 `may-reach`（Rapid Type Analysis，保守过近似）。
- 循环/递归按 `zero-iteration / iterate` 抽象，**不宣称**任意长度路径覆盖。
- 静态路径证据 ≠ 运行时覆盖。运行时掌握度由浏览器内的练习/诊断/补丁证据单独记录。

---

## 3. 运行时（Material Design 3）

7 个工作区（hash 路由，`/` 聚焦搜索，`space`/`←` 驱动调试器）：

| 路由 | 工作区 | 说明 |
| --- | --- | --- |
| `#/map` | Repository Map | Repository → package → file → symbol，含覆盖条与符号详情 |
| `#/atlas` | Coverage Atlas | 按义务加权的 treemap（按文件着色）、matrix、list；筛选状态/类型/风险/关键度；未覆盖义务 → 学习路线卡片 |
| `#/debugger` | Execution Debugger | 逐步骤执行轨迹（已走/未走）、Call Stack、Branch Inspector、Evidence、Data Flow、已覆盖义务 |
| `#/deps` | Dependency & Impact | 上游闭包、下游消费者、共享状态、相关测试、接口契约、风险卡 |
| `#/lab` | Maintenance Lab | 真实维护任务 + 自检（漏掉了哪些受影响模块）+ 测试建议 |
| `#/dashboard` | Coverage Dashboard | 9 个维度分别报告，绝不合并成单一百分比；unknown ratio；关键缺口 |
| `#/report` | Ownership Report | 五级能力、证据种类、掌握度勾选、未掌握清单、打印/导出 |

设计实现要点：

- M3 token（colour roles / typescale / shape / elevation / state layer）落在 `app.css`，深浅色两套 scheme，深浅色通过顶栏 `◐` 切换并持久化（默认深色）。
- 无框架、无 CDN、无网络请求；1200+ 符号 / 2 万义务量级下保持虚拟列表与 canvas treemap（不按符号建 DOM）。
- 语义色是产品扩展角色：`covered` 绿、`uncovered` 琥珀、`unknown` 紫、`infeasible` 灰、`excluded` 石板灰，跨主题固定。

---

## 4. 运行

```bash
# 依赖：node >= 20，本机已装 typescript（npm i typescript）
node rlp/cli.mjs --repo D:\codes\gemini-cli --out out\gemini-cli --max-paths 1500

# 可选
--include-tests        把测试代码纳入维护目标
--max-paths N          路径套件预算（默认 2400）
--no-zip               不打包
--quiet                静默
```

产物：`out/gemini-cli/`（包目录）+ `out/gemini-cli.zip`。

验证（把结论拿回真实源码核对）：

```bash
node rlp/validate.mjs out\gemini-cli D:\codes\gemini-cli 600
```

---

## 5. 代码地图

| 文件 | 职责 |
| --- | --- |
| `rlp/ingest.mjs` | 仓库遍历、语言分派、git 快照身份 |
| `rlp/lang/ts.mjs` | TypeScript/JS 适配层：符号、调用点、CFG、状态通道、闭包 |
| `rlp/graph.mjs` | 跨文件解析（相对/工作区/外部）、RTA、入口与可达性、依赖图 |
| `rlp/obligations.mjs` | 覆盖义务生成、风险分类、关键度、状态细化 |
| `rlp/planner.mjs` | 链构造、CFG 路线枚举、惰性贪心集合覆盖 |
| `rlp/compiler.mjs` | 学习编译器：目标、故事线、练习、考核（全部绑定证据） |
| `rlp/maintenance.mjs` | 影响分析、维护任务、测试建议、所有权报告 |
| `rlp/report.mjs` | 覆盖仪表盘语义、策略声明 |
| `rlp/emit.mjs` | 包落盘、紧凑编码、运行时载荷 |
| `rlp/validate.mjs` | 源码回溯验证 |

---

## 6. 已知边界（明确写在 manifest 里）

1. 仅静态分析，不执行被分析仓库。
2. 动态派发 / 反射 / 运行时注册 / 字符串键引用 → `Unknown`（带原因）。
3. 循环与递归按抽象类别覆盖，不宣称无限路径完整。
4. `may-reach` 边来自 RTA，是保守过近似，路径会明确标注。
5. 浏览器载荷是**优先切片 + 精确的每文件聚合**；完整义务集合在 `coverage/coverage-obligations.json`。
6. 路径套件有预算；预算外的方向义务保持 `uncovered` 并说明原因，不做四舍五入。
