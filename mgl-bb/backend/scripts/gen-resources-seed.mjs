#!/usr/bin/env node
// resources_catalog.json (repo root) → migrations/0118_resources_seed.sql үүсгэнэ.
//
//   node scripts/gen-resources-seed.mjs
//
// INSERT OR IGNORE (code PK дээр) тул idempotent; ирээдүйн каталог шинэчлэл =
// шинэ NNNN_resources_seed_vN.sql (append-only дүрэм). 50 мөр/statement —
// statement бүр ~8KB, D1-ийн хязгаараас хол доогуур; wrangler файлыг
// statement-ээр хувааж илгээдэг тул нийт ~400KB файл асуудалгүй.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const catalogPath = join(here, '..', '..', 'resources_catalog.json');
const outPath = join(here, '..', 'migrations', '0118_resources_seed.sql');

const catalog = JSON.parse(readFileSync(catalogPath, 'utf8'));
const rows = catalog.resources;
if (!Array.isArray(rows) || rows.length === 0) {
  throw new Error('resources_catalog.json: resources[] хоосон байна');
}

const q = (v) => (v == null || v === '' ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`);

const CHUNK = 50;
const statements = [];
for (let i = 0; i < rows.length; i += CHUNK) {
  const values = rows
    .slice(i, i + CHUNK)
    .map((r) => {
      if (!r.code || !r.name) throw new Error(`code/name дутуу мөр: ${JSON.stringify(r)}`);
      return `  (${q(r.code)}, ${q(r.code_format)}, ${q(r.group)}, ${q(r.name)}, ${q(r.unit)}, ${q(r.unit_raw)}, ${q(JSON.stringify(r.flags ?? []))})`;
    })
    .join(',\n');
  statements.push(
    `INSERT OR IGNORE INTO resources (code, code_format, group_code, name, unit, unit_raw, flags_json) VALUES\n${values};`,
  );
}

const header = `-- Шифр каталогийн seed — scripts/gen-resources-seed.mjs-ээр ҮҮСГЭСЭН, гараар бүү засварла.
-- Эх: resources_catalog.json (${catalog.meta?.source ?? '?'}, татсан ${catalog.meta?.fetched ?? '?'}), ${rows.length} мөр.
-- INSERT OR IGNORE тул давтан ажиллуулахад аюулгүй; шинэчлэл = шинэ seed migration.

`;

writeFileSync(outPath, header + statements.join('\n\n') + '\n', 'utf8');
console.log(`OK: ${outPath} — ${rows.length} мөр, ${statements.length} statement`);
