#!/usr/bin/env node
/**
 * MGL AI · MERGE-ИЙН УРЬДЧИЛСАН ТААМАГ (Session D §28, §33).
 *
 *   node integration/merge-forecast.mjs \
 *     --tree A=C:/Users/User/project/mgl-e-c \
 *     --tree B=C:/Users/User/project/mgl-ai-session-b \
 *     --tree C=C:/Users/User/project/mgl-ai-session-c \
 *     --tree D=C:/Users/User/project/mgl-ai-session-d
 *
 * Сесс бүрийн working tree-д ӨӨРЧЛӨГДСӨН файлуудыг (`git status --porcelain`,
 * коммитлогдоогүй + салааны коммит) уншиж, ХОЁР БА ТҮҮНЭЭС ОЛОН сесс хүрсэн
 * файлыг SAFE / LOW-RISK / HIGH-RISK гэж ангилна.  Юу ч merge ХИЙХГҮЙ, юу ч
 * ЗАСАХГҮЙ — зөвхөн уншина.
 *
 * ⚠️ Семантик зөрчлийг (нэг файлд хоёр өөр утга) энэ скрипт шийдэхгүй —
 *    ХЭН ялахыг `CONTRACTS.md` §4-ийн хүснэгт хэлнэ.
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const argv = process.argv.slice(2);
const trees = [];
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--tree') {
    const [name, path] = String(argv[i + 1]).split('=');
    trees.push({ name, path: resolve(path) });
    i++;
  }
}
if (trees.length < 2) {
  console.error('Хамгийн багадаа хоёр --tree NAME=PATH хэрэгтэй.');
  process.exit(2);
}

/** Файлын эрсдэлийн дүрэм — CONTRACTS.md §4-тэй ижил. */
const HIGH = [
  /^ai\/package\.json$/,
  /^ai\/tsconfig\.json$/,
  /^backend\/src\/routes\/mglAi\.ts$/,
  /^backend\/src\/index\.ts$/,
  /^ai\/runtime\/src\/server\.ts$/,
  /^frontend\/src\/features\/mgl-ai\/lib\/orchestrator\.ts$/,
  /^frontend\/src\/features\/mgl-ai\/MglAiPage\.tsx$/,
  /^CLAUDE\.md$/,
  /^docs\/mgl-ai\//,
  /^backend\/migrations\//, // дугаарын мөргөлдөөн
];
const LOW = [
  /^frontend\/src\/features\/mgl-ai\/lib\/(runtime|types|validator)\.ts$/,
  /^backend\/src\/lib\/mglai\/(version|localNorm|trustedFacts|promptFrame|intent)\.ts$/,
  /^ai\/retrieval\/src\//,
  /^backend\/src\/lib\/(workerScope|clientScope)\.ts$/,
];

function changed(tree) {
  const out = new Set();
  const st = spawnSync('git', ['status', '--porcelain', '--untracked-files=all'], { cwd: tree.path, encoding: 'utf8' });
  if (st.status === 0) {
    for (const line of st.stdout.split('\n')) {
      const f = line.slice(3).trim().replace(/\\/g, '/');
      if (f && !f.includes('node_modules/')) out.add(f.replace(/^"|"$/g, ''));
    }
  }
  // Салааны коммит (main-аас хойш)
  const log = spawnSync('git', ['diff', '--name-only', 'main...HEAD'], { cwd: tree.path, encoding: 'utf8' });
  if (log.status === 0) for (const f of log.stdout.split('\n')) if (f.trim()) out.add(f.trim());
  return out;
}

const byFile = new Map();
for (const t of trees) {
  if (!existsSync(t.path)) {
    console.warn(`  ⚠ ${t.name}: ${t.path} алга`);
    continue;
  }
  for (const f of changed(t)) {
    if (!byFile.has(f)) byFile.set(f, new Set());
    byFile.get(f).add(t.name);
  }
}

function risk(f, owners) {
  if (owners.size < 2) return 'SAFE';
  if (HIGH.some((r) => r.test(f))) return 'HIGH-RISK OVERLAP';
  if (LOW.some((r) => r.test(f))) return 'LOW-RISK OVERLAP';
  return 'LOW-RISK OVERLAP';
}

/** Миграцын дугаарын мөргөлдөөн — өөр файл нэр, ижил дугаар. */
const migrations = new Map();
for (const [f, owners] of byFile) {
  const m = f.match(/^backend\/migrations\/(\d{4})_/);
  if (!m) continue;
  if (!migrations.has(m[1])) migrations.set(m[1], []);
  migrations.get(m[1]).push({ f, owners: [...owners] });
}

const rows = [...byFile].map(([f, owners]) => ({ f, owners: [...owners].sort().join('+'), risk: risk(f, owners) }));
rows.sort((a, b) => (a.risk === b.risk ? a.f.localeCompare(b.f) : a.risk.localeCompare(b.risk)));

const overlap = rows.filter((r) => r.risk !== 'SAFE');
console.log(`\nMGL AI · merge forecast — ${trees.map((t) => t.name).join(' + ')}\n`);
console.log(`  Өөрчлөгдсөн файл: ${rows.length} · давхцсан: ${overlap.length}\n`);
for (const r of overlap) console.log(`  ${r.risk.padEnd(18)} ${r.owners.padEnd(8)} ${r.f}`);
const dup = [...migrations].filter(([, v]) => v.length > 1);
if (dup.length) {
  console.log('\n  ⚠ МИГРАЦЫН ДУГААР ДАВХЦАВ:');
  for (const [n, v] of dup) console.log(`    ${n}: ${v.map((x) => `${x.f} [${x.owners.join('+')}]`).join(' · ')}`);
}
const perOwner = {};
for (const r of rows) for (const o of r.owners.split('+')) perOwner[o] = (perOwner[o] ?? 0) + 1;
console.log(`\n  Сесс бүрийн файл: ${Object.entries(perOwner).map(([k, v]) => `${k}=${v}`).join(' · ')}`);
if (argv.includes('--json')) console.log(JSON.stringify({ trees, rows, migrations: [...migrations] }, null, 2));
process.exit(overlap.some((r) => r.risk.startsWith('HIGH')) || dup.length ? 1 : 0);
