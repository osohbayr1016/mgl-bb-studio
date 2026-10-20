// Норм дүрмийн каталог seed migration ҮҮСГЭГЧ.
// -----------------------------------------------------------------------------
// Эх сурвалж: frontend catalog.ts (NORM_CATALOG статик массив). Энэ скрипт нь
// схем (norm_categories / norm_items) + бүх мөрийн INSERT-ийг агуулсан migration
// файлыг үүсгэнэ. Норм бүрийн `key`-г ЯГ хэвээр хадгална — project_team_reports-д
// хадгалагдсан checkbox сонголтын холбоос тул.
//
// Ажиллуулах:  node scripts/gen-norm-seed.mjs
// Гаралт:      migrations/0120_norm_catalog.sql
//
// (gen-resources-seed.mjs-ийн q()/chunk хэв маягтай.)

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const catalogPath = join(
  here,
  '..',
  '..',
  'frontend',
  'src',
  'features',
  'projects',
  'team-reports',
  'norm',
  'catalog.ts',
);
const outPath = join(here, '..', 'migrations', '0120_norm_catalog.sql');

const src = readFileSync(catalogPath, 'utf8');

// NORM_CATALOG массивын литералыг таслан авч eval хийнэ (цэвэр өгөгдөл —
// бүх утга string literal). ALL_NORM_ITEMS-ийн өмнөх `];`-д зогсоно.
const m = src.match(/NORM_CATALOG:\s*NormCategory\[\]\s*=\s*(\[[\s\S]*?\]);\s*\n/);
if (!m) {
  throw new Error('NORM_CATALOG массивыг catalog.ts-ээс олсонгүй');
}
// eslint-disable-next-line no-eval
const catalog = eval(`(${m[1]})`);
if (!Array.isArray(catalog) || catalog.length === 0) {
  throw new Error('NORM_CATALOG хоосон эсвэл буруу бүтэцтэй');
}

const q = (v) => (v == null || v === '' ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`);

const catRows = [];
const itemRows = [];
catalog.forEach((cat, ci) => {
  const catId = ci + 1;
  const catPos = (ci + 1) * 10;
  if (!cat.id || !cat.category) throw new Error(`Ангилал ${ci} дутуу`);
  catRows.push(`  (${catId}, ${q(cat.id)}, ${q(cat.category)}, ${catPos})`);
  (cat.items ?? []).forEach((it, ii) => {
    if (!it.key || !it.code || !it.title) throw new Error(`Item ${cat.id}[${ii}] дутуу`);
    const pos = (ii + 1) * 10;
    itemRows.push(`  (${q(it.key)}, ${q(it.code)}, ${q(it.title)}, ${catId}, ${pos})`);
  });
});

const statements = [];
statements.push(`INSERT OR IGNORE INTO norm_categories (id, key, title, position) VALUES\n${catRows.join(',\n')};`);
const CHUNK = 50;
for (let i = 0; i < itemRows.length; i += CHUNK) {
  statements.push(
    `INSERT OR IGNORE INTO norm_items (key, code, title, category_id, position) VALUES\n${itemRows.slice(i, i + CHUNK).join(',\n')};`,
  );
}

const schema = `-- Норм дүрмийн каталог — DB-д удирдах боломжтой (admin нэм/зас/устга, senior зас).
--
-- Өмнө нь frontend catalog.ts-д статик массив байсныг DB рүү шилжүүлэв. Төслийн
-- "аль нормыг сонгосон" (project_team_reports, team_code='NORM') хэвээр — зөвхөн
-- каталог өөрөө энд орж ирнэ. norm_items.key нь checkbox-ийн ТОГТВОРТОЙ түлхүүр
-- (хадгалсан сонголтын холбоос) тул seed-д хэвээр, засахад өөрчлөгдөхгүй.

CREATE TABLE IF NOT EXISTS norm_categories (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  key        TEXT NOT NULL UNIQUE,             -- тогтвортой slug (Accordion value)
  title      TEXT NOT NULL,
  position   INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS norm_items (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  key         TEXT NOT NULL UNIQUE,            -- checkbox-ийн immutable түлхүүр
  code        TEXT NOT NULL,
  title       TEXT NOT NULL,
  category_id INTEGER NOT NULL REFERENCES norm_categories(id) ON DELETE CASCADE,
  position    INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_norm_items_category ON norm_items(category_id);
`;

const header = `-- ⚙️ АВТОМАТААР ҮҮСГЭСЭН (scripts/gen-norm-seed.mjs) — гараар бүү засварла.
-- Эх сурвалж: frontend/.../norm/catalog.ts · ${catalog.length} ангилал, ${itemRows.length} норм.

`;

writeFileSync(outPath, header + schema + '\n' + statements.join('\n\n') + '\n', 'utf8');
console.log(`Wrote ${outPath} — ${catalog.length} categories, ${itemRows.length} items.`);
