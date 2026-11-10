# Repository Ownership Report

- repository: `google-gemini/gemini-cli`
- commit: `cd1b45c2db0a5ea7b7fc3b67c1ba5879601d6005`
- generated: 2026-11-10T03:49:31.653Z

> This report states what the package can prove about this snapshot. It cannot prove that a developer can maintain the code; that requires the learner evidence produced inside the runtime (exercises, diagnoses, patches).

## Totals

| metric | value |
| --- | --- |
| obligations | 292847 |
| covered | 25335 |
| paths | 1500 |
| exercises | 69 |
| storylines | 28 |
| maintenance_tasks | 32 |
| open_critical_gaps | 4119 |

## Layers

| layer | covered | denominator | pct |
| --- | --- | --- | --- |
| structural | 16454 | 54808 | 30% |
| directional | 8881 | 117212 | 7.6% |

## Modules

| package | obligations | covered | critical open | coverage | tasks | verdict |
| --- | --- | --- | --- | --- | --- | --- |
| @google/gemini-cli | 153064 | 7997 | 7247 | 8.4% | 84 | not yet learnable from this package |
| @google/gemini-cli-core | 115548 | 16914 | 7501 | 26.7% | 41 | partially learnable — critical gaps remain |
| (root) | 14954 | 279 | 1105 | 3.3% | 0 | not yet learnable from this package |
| @google/gemini-cli-a2a-server | 4595 | 121 | 430 | 4.3% | 7 | not yet learnable from this package |
| gemini-cli-vscode-ide-companion | 1631 | 20 | 61 | 2.1% | 0 | not yet learnable from this package |
| @google/gemini-cli-devtools | 1230 | 0 | 41 | 0% | 0 | not yet learnable from this package |
| @google/gemini-cli-test-utils | 1142 | 0 | 144 | 0% | 0 | not yet learnable from this package |
| @google/gemini-cli-sdk | 683 | 4 | 76 | 1.7% | 0 | not yet learnable from this package |

## Critical open gaps (sample)

- `CO-0005f48a95` security — ?? credentials.token_type (packages/core/src/code_assist/oauth-credential-storage.ts) — no route selected within the path budget (path suite cap reached)
- `CO-002d14a016` network — if (serverName) (packages/core/src/tools/list-mcp-resources.ts) — no route selected within the path budget (path suite cap reached)
- `CO-00306ae33c` network — ?: mcpEnabled (packages/cli/src/config/config.ts) — no route selected within the path budget (path suite cap reached)
- `CO-0049a2cd5d` network — if (respectGeminiIgnore && this.geminiIgnoreFilter?.isIgnored(filePath, isDirectory)) (packages/core/src/services/fileDiscoveryService.ts) — no route selected within the path budget (path suite cap reached)
- `CO-004bd3f579` persistence — if (!fs.existsSync(from)) (packages/cli/src/utils/sandbox.ts) — no route selected within the path budget (path suite cap reached)
- `CO-005f1d229c` network — || arePathsEqual(normalized, geminiDirOnHost) || isSubpathOf(normalized, geminiDir… (packages/cli/src/utils/sandboxUtils.ts) — no route selected within the path budget (path suite cap reached)
- `CO-00652f11dd` security — if (credentials?.client_email && activeTelemetryEmail && credentials.client_email !== activeTelemetryEmail) (packages/core/src/telemetry/sdk.ts) — no route selected within the path budget (path suite cap reached)
- `CO-0065802116` error-handling — if (quotaFailure) (packages/core/src/utils/googleQuotaErrors.ts) — no route selected within the path budget (path suite cap reached)
- `CO-007e47397a` error-handling — if (error instanceof Error && 'code' in error && error.code === 'ENOENT') (packages/cli/src/utils/sessionCleanup.ts) — no route selected within the path budget (path suite cap reached)
- `CO-0084a76d8f` network — ?? extension.mcpServers (packages/core/src/tools/mcp-client-manager.ts) — no route selected within the path budget (path suite cap reached)
- `CO-009c3c08ed` error-handling — ?: isNodeError(e) (packages/core/src/policy/toml-loader.ts) — no route selected within the path budget (path suite cap reached)
- `CO-00bbdf2ad2` network — if (config?.getExperimentalDynamicModelConfiguration?.() === true) (packages/core/src/config/models.ts) — no route selected within the path budget (path suite cap reached)
- `CO-00c6fd5cfb` network — && this.discoveryState === MCPDiscoveryState.IN_PROGRESS (packages/core/src/tools/mcp-client-manager.ts) — no route selected within the path budget (path suite cap reached)
- `CO-00c7ca4aba` network — if (coreEvents.listenerCount(CoreEvent.ConsentRequest) > 0) (packages/core/src/utils/authConsent.ts) — no route selected within the path budget (path suite cap reached)
- `CO-01038919fd` network — return resolveToolDeclaration(READ_MANY_FILES_DEFINITION, modelId) (packages/core/src/tools/read-many-files.ts) — no route selected within the path budget (path suite cap reached)
- `CO-0122f61cf1` network — ?? requestedConfig.enableEnvironmentVariableRedaction (packages/core/src/services/environmentSanitization.ts) — no route selected within the path budget (path suite cap reached)
- `CO-0125a654ba` error-handling — && currentError (packages/core/src/utils/googleErrors.ts) — no route selected within the path budget (path suite cap reached)
- `CO-012dabae1e` network — || mcpServerConfig.httpUrl (packages/core/src/tools/mcp-client.ts) — no route selected within the path budget (path suite cap reached)
- `CO-0134ab9bf0` security — if (config.auth.type === 'google-credentials') (packages/core/src/agents/agentLoader.ts) — no route selected within the path budget (path suite cap reached)
- `CO-0141b6ca76` error-handling — ?. signal?.aborted (packages/core/src/utils/retry.ts) — no route selected within the path budget (path suite cap reached)

## Policy

- Static path evidence is not runtime coverage. Every obligation records its witness kind: static call chain, CFG route, or test call.
- may-reach edges come from Rapid Type Analysis (instantiating a class makes its methods reachable). Paths that depend on them are labelled may-reach, never modelled.
- Loops are abstracted to zero-iteration / iterate; unbounded path coverage is not claimed.
- Dynamic dispatch, runtime registration and string-keyed references stay Unknown with the reason recorded.
- Test-harness code is indexed but excluded from the maintenance target by default (configurable with --include-tests).
- Path suite is bounded (1500 paths). Uncovered direction obligations are reported with a reason, never rounded away.
