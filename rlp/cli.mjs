#!/usr/bin/env node
/**
 * Repository Learning Platform — CLI.
 *
 *   node rlp/cli.mjs --repo D:\\codes\\gemini-cli --out out/gemini-cli
 *
 * Stages: ingest -> obligations -> path plan -> learning compile ->
 *         maintenance -> report -> emit package -> zip
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { analyzeRepository } from './ingest.mjs';
import { buildObligations } from './obligations.mjs';
import { planPathSuite } from './planner.mjs';
import { compileLearning, LEVEL_NAMES } from './compiler.mjs';
import { buildMaintenance, buildOwnershipReport } from './maintenance.mjs';
import { buildReport } from './report.mjs';
import { emitPackage } from './emit.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

const argv = process.argv.slice(2);
const opt = {
  repo: null,
  out: null,
  maxPaths: 2400,
  includeTests: false,
  zip: true,
  quiet: false,
  appDir: path.join(HERE, 'app'),
};
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--repo') opt.repo = argv[++i];
  else if (a === '--out') opt.out = argv[++i];
  else if (a === '--max-paths') opt.maxPaths = Number(argv[++i]);
  else if (a === '--include-tests') opt.includeTests = true;
  else if (a === '--no-zip') opt.zip = false;
  else if (a === '--quiet') opt.quiet = true;
  else if (a === '--help' || a === '-h') {
    console.log('usage: node rlp/cli.mjs --repo <path> [--out <dir>] [--max-paths N] [--include-tests] [--no-zip]');
    process.exit(0);
  }
}

if (!opt.repo) {
  console.error('missing --repo');
  process.exit(2);
}
const repo = path.resolve(opt.repo);
const outBase = opt.out ? path.resolve(opt.out) : path.join(path.dirname(HERE), 'out', slug(path.basename(repo)));

const log = (msg) => { if (!opt.quiet) console.log(msg); };
const t = (label, fn) => {
  const t0 = Date.now();
  const r = fn();
  log(`  ${label.padEnd(24)} ${(((Date.now() - t0) / 1000).toFixed(1) + 's').padStart(7)}`);
  return r;
};

log(`\nRepository Learning Platform  ·  analysis ${slug(path.basename(repo))}`);
log(`  repo                     ${repo}`);

const model = await analyzeRepository(repo, { includeTests: opt.includeTests }, (p) => {
  if (!opt.quiet && p.scanned % 500 === 0) log(`  … scanned ${p.scanned}/${p.total}`);
});
log(`  ingest                   ${(model.meta.analysis_ms / 1000).toFixed(1).padStart(7)}s  ${model.files.length} files · ${model.symbols.length} symbols · ${model.edges.length} call edges`);
log(`  resolution               ${' '.repeat(6)}  unknown ${(model.stats.unknownRatio * 100).toFixed(1)}% · entry-reachable ${[...model.reach].filter((id) => model.byId.get(id) && !model.byId.get(id).isTest).length} symbols`);

const obSet = t('obligations', () => buildObligations(model, { includeTests: opt.includeTests }));
log(`  obligations              ${' '.repeat(6)}  ${obSet.total} total`);

const plan = t('path plan', () => planPathSuite(model, obSet, { maxPaths: opt.maxPaths, includeTests: opt.includeTests }));
log(`  path suite               ${' '.repeat(6)}  ${plan.paths.length} paths · ${plan.candidates} candidates`);

const learning = t('learning compile', () => compileLearning(model, obSet, plan, {}));
const maintenance = t('maintenance', () => buildMaintenance(model, obSet, plan, learning, {}));
const report = t('coverage report', () => buildReport(model, obSet, plan, learning, maintenance));
const ownership = buildOwnershipReport(model, obSet, plan, learning, maintenance);

const emitted = t('emit package', () =>
  emitPackage({ outDir: outBase, model, obSet, plan, learning, maintenance, report, ownership, appDir: opt.appDir }),
);

log(`\n  package                  ${outBase}`);
log(`  payload                  ${(emitted.payloadBytes / 1024 / 1024).toFixed(1)} MB (app/data.js)`);
log('  payload by section       ' + Object.entries(emitted.payloadSizes).sort((a,b)=>b[1]-a[1]).map(([k,v])=>k+' '+(v/1024/1024).toFixed(1)+'MB').join(' · '));
log(`  artifacts                ${emitted.artifacts.length}`);

/* ---------------- summary ---------------- */
const c = report.coverage;
const line = (k) => `${k.padEnd(12)} ${String(c[k].covered).padStart(7)} / ${String(c[k].denominator).padStart(7)}  ${String(c[k].pct + '%').padStart(6)}   unknown ${c[k].unknown}  excluded ${c[k].excluded}`;
log('\n  coverage (denominator excludes excluded + infeasible)');
for (const k of ['symbol', 'call-edge', 'branch', 'scenario', 'e2e-path', 'exception', 'loop', 'return', 'throw']) log('   ' + line(k));
log(`\n  layers      structural ${report.layers.structural.pct}%   directional ${report.layers.directional.pct}%   unknown ratio ${report.unknown_ratio}%   critical gaps ${report.critical_gaps}`);
log(`  evidence    chain ${report.evidence_kinds.chain || 0} · path ${report.evidence_kinds.path || 0} · test ${report.evidence_kinds.test || 0}`);
log(`  levels      ${LEVEL_NAMES.map((n, i) => `${i + 1}.${n} ${report.levels[i].pct}%`).join('  ')}`);

/* ---------------- zip ---------------- */
let zipPath = null;
if (opt.zip) {
  zipPath = outBase + '.zip';
  if (fs.existsSync(zipPath)) fs.rmSync(zipPath);
  // Prefer Windows' bundled bsdtar (no external dependency); fall back to Compress-Archive.
  let zipped = false;
  try {
    execFileSync('tar', ['-a', '-c', '-f', zipPath, '-C', outBase, '.'], { stdio: 'ignore' });
    zipped = true;
  } catch {
    zipped = false;
  }
  if (!zipped) {
    const ps = `Compress-Archive -Path '${outBase}\\*' -DestinationPath '${zipPath}' -Force`;
    for (const exe of ['pwsh', 'powershell']) {
      try { execFileSync(exe, ['-NoProfile', '-Command', ps], { stdio: 'ignore' }); zipped = true; break; } catch { /* next */ }
    }
  }
  if (!zipped) throw new Error('zip step failed: neither tar nor Compress-Archive is available');
  log(`\n  zip                      ${zipPath}  (${(fs.statSync(zipPath).size / 1024 / 1024).toFixed(1)} MB)`);
}

const summaryPath = path.join(outBase, 'RUN_SUMMARY.json');
fs.writeFileSync(
  summaryPath,
  JSON.stringify(
    {
      units: 'percent (0..100); app/data.js uses 0..1',
      repo,
      commit: model.meta.commit,
      out: outBase,
      zip: zipPath,
      counts: emitted.manifest.counts,
      layers: report.layers,
      coverage: report.coverage,
      unknown_ratio: report.unknown_ratio,
      critical_gaps: report.critical_gaps,
      evidence_kinds: report.evidence_kinds,
      timing_ms: model.meta.analysis_ms,
    },
    null,
    2,
  ),
);
log(`\n  done. open ${path.join(outBase, 'app', 'index.html')} — or serve ${outBase} over http for the full graph.\n`);

function slug(s) {
  return String(s).replace(/[^A-Za-z0-9._-]+/g, '-');
}
