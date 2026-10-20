/**
 * cleanup-preview — БҮХ цэвэрлэгээний DRY RUN нэг дор (юу ч устгахгүй):
 *   1. audit-d1        — D1 хуучирсан мөрийн нэр дэвшигчид
 *   2. find-orphaned-r2 — R2 орфан манифест (инвентор байвал)
 *   3. cleanup-r2 (dry) — HIGH итгэлтэй устгалын тойм
 *   4. cleanup-db (dry) — SAFE_CANDIDATE устгалын тойм
 *
 *   node scripts/cleanup/cleanup-preview.mjs [--db=…]
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const passthrough = process.argv.slice(2).filter((a) => !/^--(execute|i-have-a-backup)/.test(a));
const run = (script, extra = []) => {
  console.log(`\n${'='.repeat(78)}\n▶ ${script}\n${'='.repeat(78)}`);
  const r = spawnSync(process.execPath, [join(here, script), ...passthrough, ...extra], { stdio: 'inherit' });
  return r.status ?? 1;
};

run('audit-d1.mjs');
const hasInventory = existsSync('cleanup-out/r2-inventory-media.json') || existsSync('cleanup-out/r2-inventory-meeting.json');
if (hasInventory) {
  run('audit-storage.mjs');
  run('find-orphaned-r2.mjs');
  run('cleanup-r2.mjs');
} else {
  console.log('\n(R2 инвентор алга — `MGL_TOKEN=… node scripts/cleanup/fetch-r2-inventory.mjs` ажиллуулсны дараа R2 хэсэг гарна.)');
}
run('cleanup-db.mjs');
console.log('\nDRY RUN дууслаа — юу ч устгаагүй.');
