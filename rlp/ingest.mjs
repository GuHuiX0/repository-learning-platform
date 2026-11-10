import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { analyzeFile } from './lang/ts.mjs';
import { buildPackageIndex, buildModel } from './graph.mjs';
import { sha1 } from './util.mjs';

const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', 'out', 'coverage', '.next', '.turbo',
  'tmp', '.cache', 'generated', '.github', 'third_party', 'sea', 'schemas',
]);

const SOURCE_EXT = new Set(['.ts', '.tsx', '.mts', '.cts', '.js', '.mjs', '.cjs', '.jsx']);

export function collectFiles(repoRoot, opts = {}) {
  const maxBytes = opts.maxFileBytes ?? 1_500_000;
  const out = [];
  const walk = (dir) => {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name)) continue;
        if (opts.excludeDirs?.includes(e.name)) continue;
        walk(abs);
      } else if (e.isFile()) {
        const ext = path.extname(e.name).toLowerCase();
        if (!SOURCE_EXT.has(ext)) continue;
        if (e.name.endsWith('.d.ts')) continue;
        if (e.name.includes('.min.')) continue;
        const rel = path.relative(repoRoot, abs).replace(/\\/g, '/');
        if (opts.includeGlob && !opts.includeGlob.test(rel)) continue;
        const st = fs.statSync(abs);
        if (st.size > maxBytes) continue;
        out.push({ rel, abs, size: st.size });
      }
    }
  };
  walk(repoRoot);
  out.sort((a, b) => (a.rel < b.rel ? -1 : 1));
  return out;
}

export function repoMeta(repoRoot) {
  const { map, list } = buildPackageIndex(repoRoot);
  let commit = null;
  let branch = null;
  let repository = path.basename(repoRoot);
  try {
    commit = execFileSync('git', ['-C', repoRoot, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    branch = execFileSync('git', ['-C', repoRoot, 'rev-parse', '--abbrev-ref', 'HEAD'], { encoding: 'utf8' }).trim();
    const url = execFileSync('git', ['-C', repoRoot, 'config', '--get', 'remote.origin.url'], { encoding: 'utf8' }).trim();
    const m = url.match(/github\.com[/:]([^/]+)\/([^/.]+)/);
    if (m) repository = m[1] + '/' + m[2];
  } catch {
    /* not a git repo 鈥?snapshot identity falls back to a content hash */
  }
  return { repoRoot, repository, commit, branch, pkgIndex: { map, list }, packageList: list };
}


export async function analyzeRepository(repoRoot, opts = {}, onProgress) {
  const t0 = Date.now();
  const files = collectFiles(repoRoot, opts);
  const meta = repoMeta(repoRoot);
  const recs = [];
  let i = 0;
  for (const f of files) {
    i++;
    let src;
    try { src = fs.readFileSync(f.abs, 'utf8'); } catch { continue; }
    let rec;
    try {
      rec = analyzeFile(f.rel, src);
    } catch (err) {
      recs.push({ rel: f.rel, isTest: false, lines: 0, bytes: f.size, imports: [], exports: [], symbols: [], strings: [], failed: String(err?.message || err) });
      continue;
    }
    recs.push(rec);
    if (onProgress && i % 100 === 0) onProgress({ scanned: i, total: files.length, ms: Date.now() - t0 });
  }

  const model = buildModel(recs, meta);
  model.meta = {
    repository: meta.repository,
    commit: meta.commit,
    branch: meta.branch,
    repoRoot,
    snapshot_hash: sha1(recs.map((r) => r.rel + ':' + r.lines).join('|')).slice(0, 16),
    analysis_ms: Date.now() - t0,
    file_count: files.length,
    failed_files: recs.filter((r) => r.failed).length,
  };
  model.rawRecs = recs;
  return model;
}

