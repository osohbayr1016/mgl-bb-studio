/**
 * cleanup-db — `audit-d1.mjs`-ийн SAFE_CANDIDATE дүрмүүдийг D1 дээр хэрэгжүүлэх.
 *
 *   node scripts/cleanup/cleanup-db.mjs [--db=<копи>] [--rule=id1,id2]
 *                                       [--execute --i-have-a-backup] [--local]
 *
 * ӨГӨГДМӨЛ = DRY RUN: дүрэм бүрийн МӨРИЙН ТОО (оффлайн хуулбараас) + ажиллах
 * SQL-ийг хэвлээд гарна.  Устгал нь `--execute --i-have-a-backup` ХОЁУЛАА
 * шаардана; тэгэхэд SQL-ийг `cleanup-out/cleanup-db-<огноо>.sql` файлд бичээд
 * `wrangler d1 execute <DB> --remote --file=…`-ээр ажиллуулна (`--local` бол
 * локал D1 дээр — турших зориулалттай).
 *
 * Зөвхөн SAFE_CANDIDATE дүрэм; NEEDS_REVIEW-г `--rule=`-ээр нэрлэсэн ч ажиллахгүй
 * (эхлээд audit-d1.mjs дээр түвшинг нь өөрчилнө = хүний шийдвэр кодод бичигдэнэ).
 *
 * ⚠️ `--execute`-ийг Claude/агент ХЭЗЭЭ Ч өөрөө ажиллуулахгүй — эзний гар.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { wranglerNames } from '../wranglerNames.mjs';
import { backendDir, parseArgs, resolveDbPath, openDb } from './lib.mjs';

// Дүрмүүд audit-d1.mjs-тэй ИЖИЛ байх ёстой — тэндээс импортлохын тулд тэр
// файл CLI хэлбэрээ хадгалсан тул энд давтав (жижиг, тогтвортой жагсаалт).
const SAFE_RULES = [
  {
    id: 'notifications-read-90d',
    sql: "DELETE FROM notifications WHERE read = 1 AND created_at IS NOT NULL AND created_at < datetime('now','-90 days')",
    count: "SELECT COUNT(*) AS n FROM notifications WHERE read = 1 AND created_at IS NOT NULL AND created_at < datetime('now','-90 days')",
  },
  {
    id: 'push-subs-failed',
    sql: "DELETE FROM push_subscriptions WHERE failure_count >= 10 OR (last_used_at IS NOT NULL AND last_used_at < datetime('now','-90 days'))",
    count: "SELECT COUNT(*) AS n FROM push_subscriptions WHERE failure_count >= 10 OR (last_used_at IS NOT NULL AND last_used_at < datetime('now','-90 days'))",
  },
  {
    id: 'docpreview-closed',
    sql: "UPDATE document_google_files SET preview_key = NULL WHERE status = 'closed' AND preview_key IS NOT NULL",
    count: "SELECT COUNT(*) AS n FROM document_google_files WHERE status = 'closed' AND preview_key IS NOT NULL",
  },
];

const { flags } = parseArgs();
const only = flags.rule ? new Set(String(flags.rule).split(',')) : null;
const rules = SAFE_RULES.filter((r) => !only || only.has(r.id));
const execute = flags.execute === true && flags['i-have-a-backup'] === true;

const db = openDb(resolveDbPath(flags));
console.log(execute ? '⚠️  EXECUTE ГОРИМ' : 'DRY RUN — юу ч өөрчлөхгүй');
let total = 0;
for (const r of rules) {
  let n = '?';
  try {
    n = db.prepare(r.count).get().n;
    total += n;
  } catch (e) {
    n = `ERR ${e.message}`;
  }
  console.log(`${String(n).padStart(7)}  ${r.id}\n         ${r.sql}`);
}
console.log(`\nНийт мөр (оффлайн хуулбараас): ${total}`);

if (!execute) {
  console.log(flags.execute ? '`--i-have-a-backup` алга — зогслоо.' : 'Хэрэгжүүлэх: --execute --i-have-a-backup [--local]');
  process.exit(0);
}

mkdirSync('cleanup-out', { recursive: true });
const file = join('cleanup-out', `cleanup-db-${new Date().toISOString().replace(/[:.]/g, '-')}.sql`);
writeFileSync(file, rules.map((r) => `-- ${r.id}\n${r.sql};`).join('\n') + '\n');
const { databaseName } = wranglerNames();
const args = ['wrangler', 'd1', 'execute', databaseName, flags.local ? '--local' : '--remote', `--file=${file}`, '--config', 'wrangler.toml'];
console.log(`→ npx ${args.join(' ')}`);
const res = spawnSync('npx', args, { cwd: backendDir, shell: true, stdio: 'inherit' });
process.exit(res.status ?? 1);
