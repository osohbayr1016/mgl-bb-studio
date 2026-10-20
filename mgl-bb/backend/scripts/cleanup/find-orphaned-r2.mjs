/**
 * find-orphaned-r2 — R2 инвентор × D1 ишлэлийн граф → ОРФАН МАНИФЕСТ.
 *
 *   node scripts/cleanup/find-orphaned-r2.mjs [--db=<export.sql|копи.sqlite>]
 *       [--inventory=cleanup-out/r2-inventory-media.json[,…]] [--out=cleanup-out]
 *       [--min-age-days=7]
 *
 * ЮУ Ч УСТГАХГҮЙ.  Гаралт `cleanup-out/orphan-manifest.json`:
 *   { generatedAt, dbPath, summary, orphans: [{ bucket, key, category, size,
 *     uploaded, ageDays, confidence, reason, refs: 0 }], referenced: <тоо>, skipped: [...] }
 *
 * ИТГЭЛИЙН ТҮВШИН (зөвхөн HIGH-г `cleanup-r2.mjs --execute` устгана):
 *   HIGH   — ангиллын D1 багана мэдэгдэж байгаа (email/*, хэрэглэгчийн upload,
 *            docpreview), D1-д НЭГ Ч ишлэлгүй, `--min-age-days`-ээс хуучин
 *            (сая байршуулсан, мөр нь хараахан бичигдээгүй файлыг хамгаална);
 *   MEDIUM — ангилал мэдэгдэж байгаа ч ишлэл нь JSON/өөр хэлбэрээр байж болзошгүй
 *            (client/, meetings/, bim_) — хүн шалгана;
 *   LOW    — танигдаагүй түлхүүр — хэзээ ч автоматаар устгахгүй.
 *   `never` бодлоготой ангилал (revit-addin/, seed) манифестад ОРОХГҮЙ.
 *
 * ⚠️ D1 хуулбар нь инвентороос ХУУЧИН байвал шинэ файлууд «ишлэлгүй» мэт
 *    харагдана — тиймээс `--min-age-days` нь хуулбарын огнооноос ХОЙШ байх
 *    ёстой (өгөгдмөл 7; export-оо инвентортой НЭГ өдөр авбал хамгийн зөв).
 */
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  parseArgs,
  resolveDbPath,
  openDb,
  collectReferencedKeys,
  categorize,
  daysSince,
  fmtBytes,
  writeJson,
} from './lib.mjs';

const { flags } = parseArgs();
const outDir = String(flags.out ?? 'cleanup-out');
mkdirSync(outDir, { recursive: true });
const minAge = Number(flags['min-age-days'] ?? 7);
const inventoryFiles = flags.inventory
  ? String(flags.inventory).split(',')
  : ['media', 'meeting'].map((b) => join(outDir, `r2-inventory-${b}.json`)).filter(existsSync);
if (inventoryFiles.length === 0) {
  throw new Error('Инвентор олдсонгүй — эхлээд `node scripts/cleanup/fetch-r2-inventory.mjs` ажиллуул.');
}

const dbPath = resolveDbPath(flags);
const db = openDb(dbPath);
console.log(`D1 хуулбар: ${dbPath}`);
console.log('D1-ийн ишлэлийг цуглуулж байна…');
const refs = collectReferencedKeys(db, {
  onProgress: (t, n) => process.stdout.write(`\r  ${t} (${n} мөр)`.padEnd(70)),
});
process.stdout.write('\n');
console.log(`Ишлэгдсэн түлхүүр: ${refs.size}\n`);

const orphans = [];
const skipped = [];
let referenced = 0;
const summary = {};
const bump = (cat, conf, size) => {
  const k = `${cat}:${conf}`;
  summary[k] ??= { category: cat, confidence: conf, count: 0, bytes: 0 };
  summary[k].count++;
  summary[k].bytes += size;
};

for (const file of inventoryFiles) {
  const inv = JSON.parse(readFileSync(file, 'utf8'));
  for (const o of inv.objects) {
    const cat = categorize(o.key);
    if (cat.policy === 'never') {
      skipped.push({ bucket: inv.bucket, key: o.key, why: cat.note });
      continue;
    }
    const r = refs.get(o.key);
    if (r) {
      referenced++;
      continue;
    }
    const ageDays = daysSince(o.uploaded);
    let confidence = cat.confidence;
    let reason = `D1-д ишлэлгүй; ангилал «${cat.id}»`;
    if (cat.policy === 'age') {
      reason = `${cat.note}; ${cat.minAgeDays} хоногоос хуучин`;
      if (ageDays < cat.minAgeDays) confidence = 'LOW';
    } else if (ageDays < minAge) {
      confidence = 'LOW';
      reason += `; ${minAge} хоногоос шинэ (D1 хуулбар хоцорсон байж болзошгүй)`;
    }
    orphans.push({
      bucket: inv.bucket,
      key: o.key,
      category: cat.id,
      size: o.size,
      uploaded: o.uploaded,
      ageDays: Math.round(ageDays),
      confidence,
      reason,
      refs: 0,
    });
    bump(cat.id, confidence, o.size);
  }
}

orphans.sort((a, b) => b.size - a.size);
const manifest = {
  generatedAt: new Date().toISOString(),
  dbPath,
  minAgeDays: minAge,
  referenced,
  summary: Object.values(summary).sort((a, b) => b.bytes - a.bytes),
  orphans,
  skipped,
};
const out = join(outDir, 'orphan-manifest.json');
writeJson(out, manifest);

console.log('category                confidence  count      bytes');
for (const s of manifest.summary) {
  console.log(s.category.padEnd(24), s.confidence.padEnd(11), String(s.count).padStart(5), fmtBytes(s.bytes).padStart(11));
}
const high = orphans.filter((o) => o.confidence === 'HIGH');
console.log(
  `\nИшлэлтэй: ${referenced} · орфан: ${orphans.length} (HIGH ${high.length} = ${fmtBytes(high.reduce((s, o) => s + o.size, 0))}) · алгассан (never): ${skipped.length}`,
);
console.log(`Манифест: ${out}  (юу ч устгаагүй)`);
