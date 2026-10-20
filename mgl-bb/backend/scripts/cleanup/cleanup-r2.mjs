/**
 * cleanup-r2 — орфан манифестын HIGH итгэлтэй объектуудыг R2-оос устгах.
 *
 *   node scripts/cleanup/cleanup-r2.mjs [--manifest=cleanup-out/orphan-manifest.json]
 *                                       [--category=email-body,…] [--limit=N]
 *                                       [--execute --i-have-a-backup]
 *
 * ӨГӨГДМӨЛ = DRY RUN: юу устгах байсныг (тоо, байт, ангилал, эхний 30 түлхүүр)
 * хэвлээд ГАРНА.  Устгал нь ХОЁР туг шаардана: `--execute` + `--i-have-a-backup`
 * (bucket-ийн хуулбар/version байгаа гэдгийг хүн баталгаажуулна).
 *
 * Зөвхөн `confidence === 'HIGH'` мөр устгагдана — MEDIUM/LOW-г хүн манифест
 * дээр гараар HIGH болгож (шалгасны дараа) дахин ажиллуулна.  Устгал нь
 * `wrangler r2 object delete <bucket>/<key>` (үйлдэл бүр тусдаа процесс —
 * удаан ч ил тод; 100 объект ≈ 1-2 мин).  Амжилт/алдааг `cleanup-out/
 * cleanup-r2-<огноо>.log`-д бичнэ.
 *
 * ⚠️ `--execute`-ийг Claude/агент ХЭЗЭЭ Ч өөрөө ажиллуулахгүй — эзний гар.
 */
import { spawnSync } from 'node:child_process';
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { wranglerNames } from '../wranglerNames.mjs';
import { backendDir, parseArgs, fmtBytes } from './lib.mjs';

const { flags } = parseArgs();
const manifestPath = String(flags.manifest ?? 'cleanup-out/orphan-manifest.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const cats = flags.category ? new Set(String(flags.category).split(',')) : null;
const limit = flags.limit ? Number(flags.limit) : Infinity;
const execute = flags.execute === true && flags['i-have-a-backup'] === true;

const names = wranglerNames();
const bucketName = (b) => (b === 'meeting' ? names.meetingBucket : names.mediaBucket);

const targets = manifest.orphans
  .filter((o) => o.confidence === 'HIGH')
  .filter((o) => !cats || cats.has(o.category))
  .slice(0, limit);

const bytes = targets.reduce((s, o) => s + o.size, 0);
const byCat = {};
for (const o of targets) {
  byCat[o.category] ??= { count: 0, bytes: 0 };
  byCat[o.category].count++;
  byCat[o.category].bytes += o.size;
}

console.log(execute ? '⚠️  EXECUTE ГОРИМ — устгана' : 'DRY RUN — юу ч устгахгүй');
console.log(`Манифест: ${manifestPath} (${manifest.generatedAt})`);
console.log(`Объект: ${targets.length}   Хэмжээ: ${fmtBytes(bytes)}`);
for (const [c, v] of Object.entries(byCat)) console.log(`  ${c.padEnd(22)} ${String(v.count).padStart(6)}  ${fmtBytes(v.bytes)}`);
console.log('\nЭхний 30:');
for (const o of targets.slice(0, 30)) console.log(`  [${o.bucket}] ${o.key}  ${fmtBytes(o.size)}  ${o.ageDays}д`);

if (!execute) {
  if (flags.execute) console.log('\n`--execute` өгөгдсөн ч `--i-have-a-backup` алга — зогслоо.');
  else console.log('\nУстгахын тулд: --execute --i-have-a-backup');
  process.exit(0);
}

mkdirSync('cleanup-out', { recursive: true });
const log = join('cleanup-out', `cleanup-r2-${new Date().toISOString().replace(/[:.]/g, '-')}.log`);
let ok = 0;
let fail = 0;
for (const o of targets) {
  const path = `${bucketName(o.bucket)}/${o.key}`;
  const res = spawnSync('npx', ['wrangler', 'r2', 'object', 'delete', `"${path}"`, '--config', 'wrangler.toml'], {
    cwd: backendDir,
    shell: true,
    encoding: 'utf8',
  });
  const line = `${res.status === 0 ? 'OK  ' : 'FAIL'} ${path} ${o.size}\n`;
  appendFileSync(log, line + (res.status === 0 ? '' : res.stderr));
  if (res.status === 0) ok++;
  else fail++;
  process.stdout.write(`\r${ok + fail}/${targets.length} (алдаа ${fail})`);
}
console.log(`\nДууслаа: ${ok} устгав, ${fail} алдаа.  Лог: ${log}`);
