/**
 * audit-storage — R2 инвенторыг ангилал/угтвараар нэгтгэсэн тайлан (зөвхөн уншина).
 *
 *   node scripts/cleanup/audit-storage.mjs [--inventory=cleanup-out/r2-inventory-media.json[,…]]
 *
 * Эхлээд `fetch-r2-inventory.mjs`.  Ангилал бүрийн тоо/хэмжээ, хамгийн том 15
 * объект, сараар байршуулалтын хэмжээ (өсөлтийн хурд) — lifecycle дүрэм,
 * retention бодлогод суурь өгнө.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs, categorize, fmtBytes } from './lib.mjs';

const { flags } = parseArgs();
const outDir = String(flags.out ?? 'cleanup-out');
const files = flags.inventory
  ? String(flags.inventory).split(',')
  : ['media', 'meeting'].map((b) => join(outDir, `r2-inventory-${b}.json`)).filter(existsSync);
if (files.length === 0) throw new Error('Инвентор олдсонгүй — эхлээд fetch-r2-inventory.mjs');

for (const file of files) {
  const inv = JSON.parse(readFileSync(file, 'utf8'));
  const total = inv.objects.reduce((s, o) => s + o.size, 0);
  console.log(`\n=== ${inv.bucket} — ${inv.objects.length} объект, ${fmtBytes(total)} (${inv.fetchedAt}) ===`);
  const byCat = {};
  const byMonth = {};
  for (const o of inv.objects) {
    const c = categorize(o.key).id;
    byCat[c] ??= { count: 0, bytes: 0 };
    byCat[c].count++;
    byCat[c].bytes += o.size;
    const m = o.uploaded.slice(0, 7);
    byMonth[m] ??= { count: 0, bytes: 0 };
    byMonth[m].count++;
    byMonth[m].bytes += o.size;
  }
  console.log('category                 count       bytes');
  for (const [c, v] of Object.entries(byCat).sort((a, b) => b[1].bytes - a[1].bytes)) {
    console.log(c.padEnd(24), String(v.count).padStart(6), fmtBytes(v.bytes).padStart(11));
  }
  console.log('\nсараар (байршуулсан):');
  for (const [m, v] of Object.entries(byMonth).sort()) console.log(`  ${m}  ${String(v.count).padStart(6)}  ${fmtBytes(v.bytes)}`);
  console.log('\nхамгийн том 15:');
  for (const o of [...inv.objects].sort((a, b) => b.size - a.size).slice(0, 15)) {
    console.log(`  ${fmtBytes(o.size).padStart(10)}  ${o.uploaded.slice(0, 10)}  ${o.key}`);
  }
}
