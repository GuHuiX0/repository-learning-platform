# RLP package validation

- package: `D:\codes\r-l-p\out\gemini-cli`
- source : `D:\codes\gemini-cli`
- commit : `cd1b45c2db0a5ea7b7fc3b67c1ba5879601d6005`
- generated: 2026-11-09T16:50:49.494Z
- samples: 600 rows per check (evenly spaced, deterministic)

| check | pass | sample | rate |
| --- | --- | --- | --- |
| symbol anchor resolvable in source file | 600 | 600 | 100.0% |
| branch obligation label traceable to source text | 600 | 600 | 100.0% |
| call edge: callee appears in caller source | 600 | 600 | 100.0% |
| path witness: steps and chain edges exist | 120 | 120 | 100.0% |
| obligation counts reconcile with manifest | 1 | 1 | 100.0% |
| symbol ids are deterministic hashes of (file, qualified) | 200 | 200 | 100.0% |

No sampled failure.

## What this does and does not prove

It proves the package is source-grounded: symbols, branch labels, call edges and path steps resolve back to text in the pinned commit.
It does not prove runtime behaviour, and it does not prove completeness of the call graph — unresolved dynamic dispatch is reported as Unknown instead.
