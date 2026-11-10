# Attribution — example package

This directory (`out/gemini-cli/`) is a **generated artifact**, not source code of
this project. It was produced by `rlp/cli.mjs` from a third-party repository and
is committed here only as a worked example.

| field | value |
| --- | --- |
| analysed repository | `google-gemini/gemini-cli` |
| commit | `cd1b45c2db0a5ea7b7fc3b67c1ba5879601d6005` |
| upstream licence | Apache License 2.0 |
| generator | this repository (`rlp/cli.mjs`), analysis version `rlp-0.1.0` |
| files analysed | 2255 (1080 test files) |

What is reproduced from upstream, and why it is redistributable:

- **symbol names, file paths, qualified names** — factual identifiers;
- **declaration anchors** — the first source line of a declaration, whitespace
  collapsed, ≤200 characters, stored as `anchor` in `analysis/source-evidence.json`
  and `app/data.js`; used as evidence pointers so a claim can be traced back to
  the upstream file;
- **control-flow labels** — the condition text of a branch, quotes at most one
  expression, stored as the `label` field;
- **no full source files** are copied: the generator never writes upstream file
  bodies into the package.

Apache-2.0 permits this use provided attribution and the licence notice are
retained; upstream's `LICENSE` and `NOTICE` (if any) remain the authoritative
documents: <https://github.com/google-gemini/gemini-cli>.

To regenerate or replace this example, delete `out/gemini-cli/` and run:

```bash
node rlp/cli.mjs --repo <path-to-repo> --out out/<name> --max-paths 1500
```