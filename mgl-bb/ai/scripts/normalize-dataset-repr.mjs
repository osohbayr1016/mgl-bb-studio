#!/usr/bin/env node
/**
 * `node --experimental-strip-types scripts/normalize-dataset-repr.mjs [<багц> …] [--write] [--check] [--json <файл>]`
 * (`npm run ai:dataset:repr -- …`)
 *
 * GAP-023: түүхий норматив багцын БИЧВЭРТ (text_mn / text_latin / search_text / alias /
 * тестийн асуулт / SFT хариулт) орсон Python `repr` (`g = {'gt': 2200}`,
 * `{'without_used_attic': 51, …}`)-ийг ЭРХ БҮХИЙ талбараас нь угсарсан хүний уншихуйц
 * хэлбэр болгож ГАЗАР ДЭЭР НЬ засна.  Дүрэм нь `retrieval/src/reprText.ts` — шингээлт
 * (`datasetProfiles.ts`) ЯГ ИЖИЛ функцээр цэвэрлэдэг тул түүхий файл ба сан зөрөхгүй.
 *
 * ⚠️ УТГА ӨӨРЧЛӨГДӨХГҮЙ: тоо, түлхүүр хэвээр (нэрлэсэн хувилбарын түлхүүр монгол шошгын
 *    ард хаалтанд үлдэнэ).  Бүтэцтэй талбар (`g_mj_m2: {min,max}`, `variants_percent`)
 *    ОГТ ХӨНДӨГДӨХГҮЙ — зөвхөн МӨР утга.  Хөрвүүлж чадаагүй repr (үүрлэсэн dict) хэвээр
 *    үлдэж, `--check` унана.
 *
 * ⚠️ `data-train-files/` нь gitignore-д (эзний шийдвэр) — засвар нь энэ PC дээр; багц
 *    авсан хүн бүр ижил командыг ажиллуулна (`OPERATIONS.md` §9).
 *
 * Өгөгдмөл нь DRY RUN: юу өөрчлөгдөхийг л тоолно.  `--write` бичнэ.  `--check` нь
 * (бичсэний дараа ч) repr үлдсэн бол exit 1 — CI/lint-ийн хаалга.
 */
import { readdirSync, readFileSync, writeFileSync, statSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, resolve, basename } from 'node:path';
import { normalizeReprText, hasPythonRepr } from '../retrieval/src/reprText.ts';

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const opt = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const write = flag('--write');
const check = flag('--check');
const jsonOut = opt('--json');
const root = resolve(opt('--root') ?? join(import.meta.dirname, '..', 'data-train-files'));
const positional = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--json' && args[i - 1] !== '--root');
const packages = positional.length > 0 ? positional.map((p) => resolve(p)) : readdirSync(root).map((d) => join(root, d)).filter((d) => statSync(d).isDirectory());

/**
 * ТАСАРСАН repr (`… {'with_used_attic': 4`) — багцын угсрагч alias-ыг 120 тэмдэгтэд тайрсан
 * тул бичвэрээс сэргээх боломжгүй; alias-ыг ЗОРИЛТОТ хэсгийн (цэвэрлэсэн) `text_mn`-ээс
 * дахин угсарна.  Хэсэг олдохгүй бол хэвээр үлдэж `--check` унана.
 */
const TRUNCATED_RE = /\{'[^}]*$/;
function rebuildAlias(row, chunkText) {
  const alias = row.alias;
  if (typeof alias !== 'string' || !TRUNCATED_RE.test(alias)) return null;
  const target = chunkText.get(String(row.target_id ?? row.canonical ?? ''));
  if (target === undefined) return null;
  return target.replace(/[.\s]+$/, '');
}

function loadChunkText(pkg) {
  const file = join(pkg, 'knowledge_chunks.jsonl');
  const map = new Map();
  if (!existsSync(file)) return map;
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    if (line.trim().length === 0) continue;
    const row = JSON.parse(line);
    map.set(String(row.chunk_id ?? ''), normalizeReprText(String(row.text_mn ?? ''), { percentVariants: true }));
  }
  return map;
}

/** Мөр утга бүрийг гүнзгий цэвэрлэнэ; бүтэцтэй объект ХӨНДӨХГҮЙ. */
function walk(value, stats, chunkText) {
  if (value !== null && typeof value === 'object' && !Array.isArray(value) && chunkText !== undefined) {
    const rebuilt = rebuildAlias(value, chunkText);
    if (rebuilt !== null) {
      stats.seen += 1;
      stats.changed += 1;
      stats.rebuilt = (stats.rebuilt ?? 0) + 1;
      value = { ...value, alias: rebuilt };
    }
  }
  if (typeof value === 'string') {
    if (!hasPythonRepr(value) && !TRUNCATED_RE.test(value)) return value;
    const next = normalizeReprText(value, { percentVariants: true });
    stats.seen += 1;
    if (next !== value) stats.changed += 1;
    if (hasPythonRepr(next) || TRUNCATED_RE.test(next)) stats.remaining += 1;
    return next;
  }
  if (Array.isArray(value)) return value.map((v) => walk(v, stats, chunkText));
  if (value !== null && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = walk(v, stats, chunkText);
    return out;
  }
  return value;
}

const report = { root, write, packages: [], totals: { files: 0, rows_changed: 0, strings_changed: 0, remaining: 0 } };
for (const pkg of packages) {
  const entry = { package: basename(pkg), files: [] };
  const chunkText = loadChunkText(pkg);
  const touched = [];
  for (const name of readdirSync(pkg).filter((f) => f.endsWith('.jsonl') || (f.endsWith('.json') && f !== 'manifest.json'))) {
    const file = join(pkg, name);
    const raw = readFileSync(file, 'utf8');
    if (!raw.includes("{'")) continue;
    const stats = { seen: 0, changed: 0, remaining: 0, rows: 0 };
    let out;
    if (name.endsWith('.jsonl')) {
      const eol = raw.includes('\r\n') ? '\r\n' : '\n';
      const lines = raw.split(/\r?\n/);
      const next = lines.map((line) => {
        if (line.trim().length === 0) return line;
        const row = JSON.parse(line);
        const rowStats = { seen: 0, changed: 0, remaining: 0 };
        const cleaned = walk(row, rowStats, chunkText);
        stats.seen += rowStats.seen;
        stats.changed += rowStats.changed;
        stats.remaining += rowStats.remaining;
        if (rowStats.changed > 0) stats.rows += 1;
        return rowStats.changed > 0 ? JSON.stringify(cleaned) : line;
      });
      out = next.join(eol);
    } else {
      const cleaned = walk(JSON.parse(raw), stats, chunkText);
      if (stats.changed > 0) stats.rows = 1;
      out = stats.changed > 0 ? JSON.stringify(cleaned, null, 2) + '\n' : raw;
    }
    if (stats.seen === 0) continue;
    entry.files.push({ file: name, strings_with_repr: stats.seen, strings_changed: stats.changed, rows_changed: stats.rows, remaining_after: stats.remaining });
    report.totals.files += 1;
    report.totals.rows_changed += stats.rows;
    report.totals.strings_changed += stats.changed;
    report.totals.remaining += stats.remaining;
    if (write && stats.changed > 0) {
      writeFileSync(file, out, 'utf8');
      touched.push(name);
    }
  }
  // Багцын manifest (`files: {name: {sha256, bytes}}`) — засагдсан файлын хэш/хэмжээг шинэчилнэ,
  // эс тэгвэл MANIFEST_SHA_MISMATCH (Session C lint) гарна.  Бусад талбар ХӨНДӨГДӨХГҮЙ.
  if (write && touched.length > 0) {
    const mf = join(pkg, 'manifest.json');
    if (existsSync(mf)) {
      const raw = readFileSync(mf, 'utf8');
      const manifest = JSON.parse(raw);
      let updated = 0;
      if (manifest !== null && typeof manifest.files === 'object' && manifest.files !== null && !Array.isArray(manifest.files)) {
        for (const name of touched) {
          const cur = manifest.files[name];
          if (cur === undefined || typeof cur !== 'object') continue;
          const bytes = readFileSync(join(pkg, name));
          if ('sha256' in cur) cur.sha256 = createHash('sha256').update(bytes).digest('hex');
          if ('bytes' in cur) cur.bytes = bytes.length;
          updated += 1;
        }
      }
      if (updated > 0) {
        const eol = raw.includes('\r\n') ? '\r\n' : '\n';
        writeFileSync(mf, JSON.stringify(manifest, null, 2).replace(/\n/g, eol) + eol, 'utf8');
        entry.manifest_updated = updated;
      }
    }
  }
  if (entry.files.length > 0) report.packages.push(entry);
}

for (const p of report.packages) {
  console.log(`\n${p.package}`);
  for (const f of p.files) {
    console.log(`  ${f.file.padEnd(28)} repr мөр ${String(f.strings_with_repr).padStart(3)}  засах ${String(f.strings_changed).padStart(3)}  бичлэг ${String(f.rows_changed).padStart(3)}  үлдэх ${f.remaining_after}`);
  }
}
console.log(`\n${write ? 'БИЧСЭН' : 'DRY RUN'}: ${report.totals.files} файл, ${report.totals.rows_changed} бичлэг, ${report.totals.strings_changed} мөр${write ? '' : ' (--write өгвөл бичнэ)'}; хөрвүүлэгдээгүй ${report.totals.remaining}`);
if (jsonOut !== undefined) writeFileSync(jsonOut, JSON.stringify(report, null, 2));

// --check: бичсэний дараа файлуудад repr үлдсэн эсэх (эсвэл dry run-д хөрвүүлэгдэх боломжгүй)
if (check) {
  let leftover = 0;
  for (const pkg of packages) {
    for (const name of readdirSync(pkg).filter((f) => f.endsWith('.jsonl') || f.endsWith('.json'))) {
      const raw = readFileSync(join(pkg, name), 'utf8');
      for (const line of raw.split(/\r?\n/)) {
        if (line.trim().length === 0) continue;
        const stats = { seen: 0, changed: 0, remaining: 0 };
        try {
          walk(JSON.parse(name.endsWith('.jsonl') ? line : raw), stats, loadChunkText(pkg));
        } catch {
          continue;
        }
        leftover += write ? stats.remaining : stats.seen;
        if (!name.endsWith('.jsonl')) break;
      }
    }
  }
  if (leftover > 0) {
    console.error(`--check: ${leftover} мөр Python repr-тэй хэвээр`);
    process.exit(1);
  }
  console.log('--check: repr үлдээгүй');
}
