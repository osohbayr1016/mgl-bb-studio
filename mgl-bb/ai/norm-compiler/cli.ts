#!/usr/bin/env node
/**
 * `npm run ai:norm:generate [-- --check] [--datasets <dir>] [--out <dir>] [--strict]`
 *
 * Багц (ai/data-train-files/*) → backend/src/lib/mglai/norm/generated/*.generated.ts
 *
 *   (үгүй)    үүсгэж бичнэ
 *   --check   бичихгүй; дискийн файл хуучирсан бол exit 1
 *   --strict  `--check`-тэй: адаптер таарах багц ОЛДОХГҮЙ бол ч exit 1
 *             (өгөгдмөлөөр: багц байхгүй машин дээр «алгасав» гэж exit 0 —
 *             data-train-files нь .gitignore-д тул CI-д байхгүй)
 */
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkFiles, compileTargets, discoverTargets, writeFiles } from './src/compile.ts';

const argv = process.argv.slice(2);
const flag = (n: string, d: string): string => {
  const i = argv.indexOf('--' + n);
  return i === -1 ? d : (argv[i + 1] ?? d);
};
const here = resolve(fileURLToPath(import.meta.url), '..');
const datasetRoot = resolve(flag('datasets', resolve(here, '..', 'data-train-files')));
const outDir = resolve(flag('out', resolve(here, '..', '..', 'backend', 'src', 'lib', 'mglai', 'norm', 'generated')));
const check = argv.includes('--check');
const strict = argv.includes('--strict');

const { targets, skipped } = discoverTargets(datasetRoot);
if (targets.length === 0) {
  process.stdout.write(`нормын хөрвүүлэгч: ${datasetRoot} дотор адаптер таарах багц олдсонгүй (алгассан: ${skipped.length}).\n`);
  process.exitCode = strict ? 1 : 0;
} else {
  const { docs, files } = compileTargets(targets, outDir);
  for (const d of docs) {
    process.stdout.write(`  ${d.documentCode}  дүрэм ${d.rules.length} · томьёо ${d.formulas.length} · хэсэг ${d.clauses.length} · кейс ${d.cases.length} · dataset ${d.datasetSha256.slice(0, 12)}…\n`);
  }
  if (check) {
    const r = checkFiles(files);
    if (r.ok) process.stdout.write(`✓ үүсгэсэн бүртгэл шинэ (${files.length} файл).\n`);
    else {
      for (const p of r.missing) process.stdout.write(`✖ байхгүй: ${p}\n`);
      for (const p of r.stale) process.stdout.write(`✖ хуучирсан: ${p}\n`);
      process.stdout.write('→ cd ai && npm run ai:norm:generate\n');
      process.exitCode = 1;
    }
  } else {
    writeFiles(files);
    process.stdout.write(`✓ ${files.length} файл бичив → ${outDir}\n`);
  }
  if (skipped.length > 0) process.stdout.write(`  (адаптергүй тул алгассан: ${skipped.join(', ')})\n`);
}
