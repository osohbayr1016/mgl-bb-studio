/**
 * audit-d1 — D1-ийн ОФФЛАЙН инвентор + хуучирсан мөрийн нэр дэвшигчид.
 *
 *   node scripts/cleanup/audit-d1.mjs [--db=<export.sql|копи.sqlite>] [--json=<out.json>]
 *
 * ЮУ Ч УСТГАХГҮЙ, ЮУ Ч БИЧИХГҮЙ (зөвхөн `--json` тайлан).  Production D1 руу
 * ХЭЗЭЭ Ч хандахгүй — `wrangler d1 export`-ийн .sql эсвэл локал хуулбар дээр.
 *
 * Гаралт:
 *   • хүснэгт бүрийн мөр, индексийн тоо, хоосон хүснэгтүүд;
 *   • ХУУЧИРСАН МӨРИЙН НЭР ДЭВШИГЧ (SAFE_CANDIDATE / NEEDS_REVIEW) — тус бүр
 *     тоо + шалтгаан + `cleanup-db.mjs`-ийн ашиглах SQL;
 *   • кодоос уншигддаггүй (эсвэл 0 мөртэй) хүснэгтийн жагсаалт — устгал БИШ,
 *     зөвхөн мэдээлэл (хүснэгт устгах нь миграц + хүний шийдвэр).
 */
import { parseArgs, resolveDbPath, openDb, listTables, tableInfo, writeJson } from './lib.mjs';

const { flags } = parseArgs();
const dbPath = resolveDbPath(flags);
const db = openDb(dbPath);
console.log(`D1 хуулбар: ${dbPath}\n`);

/* ---------- 1. Хүснэгтийн инвентор ---------- */
const tables = listTables(db).map((t) => tableInfo(db, t));
tables.sort((a, b) => b.rows - a.rows);
console.log('rows     idx  table');
for (const t of tables) console.log(String(t.rows).padStart(8), String(t.indexes.length).padStart(4), t.table);
const empty = tables.filter((t) => t.rows === 0).map((t) => t.table);
console.log(`\nХүснэгт: ${tables.length}, хоосон: ${empty.length}`);

/* ---------- 2. Хуучирсан мөрийн нэр дэвшигчид ---------- */
/**
 * Дүрэм бүр: { id, table, level, why, countSql, deleteSql }.
 *   SAFE_CANDIDATE — код аль хэдийн ижил цэвэрлэгээ хийдэг ЭСВЭЛ мөрийг ямар ч
 *                    feature уншдаггүй нь баттай;
 *   NEEDS_REVIEW   — хүний шийдвэр (бодлого/түүх).
 * `deleteSql`-ийг `cleanup-db.mjs` DRY RUN-д хэвлэнэ, `--execute`-д л ажиллуулна.
 */
const RULES = [
  {
    id: 'notifications-read-90d',
    table: 'notifications',
    level: 'SAFE_CANDIDATE',
    why: 'lib/pushSweep.ts цагт нэг удаа яг энэ нөхцөлөөр 1 000-аар устгадаг (PRUNE_DAYS=90) — энэ нь түүний бөөн хувилбар.',
    countSql: "SELECT COUNT(*) AS n FROM notifications WHERE read = 1 AND created_at IS NOT NULL AND created_at < datetime('now','-90 days')",
    deleteSql: "DELETE FROM notifications WHERE read = 1 AND created_at IS NOT NULL AND created_at < datetime('now','-90 days')",
  },
  {
    id: 'notifications-unread-365d',
    table: 'notifications',
    level: 'NEEDS_REVIEW',
    why: 'Жилээс дээш УНШААГҮЙ мэдэгдэл — хонхны тоо хэзээ ч буурахгүй; устгах нь UX-ийн шийдвэр.',
    countSql: "SELECT COUNT(*) AS n FROM notifications WHERE read = 0 AND created_at < datetime('now','-365 days')",
    deleteSql: "DELETE FROM notifications WHERE read = 0 AND created_at < datetime('now','-365 days')",
  },
  {
    id: 'push-subs-failed',
    table: 'push_subscriptions',
    level: 'SAFE_CANDIDATE',
    why: 'lib/pushSweep.ts failure_count >= 10 бол өөрөө устгадаг; 10-аас доош ч 90 хоног ашиглагдаагүй бол хүчингүй.',
    countSql: "SELECT COUNT(*) AS n FROM push_subscriptions WHERE failure_count >= 10 OR (last_used_at IS NOT NULL AND last_used_at < datetime('now','-90 days'))",
    deleteSql: "DELETE FROM push_subscriptions WHERE failure_count >= 10 OR (last_used_at IS NOT NULL AND last_used_at < datetime('now','-90 days'))",
  },
  {
    id: 'attendance-admin-logs-2y',
    table: 'attendance_admin_logs',
    level: 'NEEDS_REVIEW',
    why: 'Аудитын лог — HR-ийн хадгалах хугацааны бодлого хэрэгтэй (2 жилээс дээш).',
    countSql: "SELECT COUNT(*) AS n FROM attendance_admin_logs WHERE created_at < datetime('now','-730 days')",
    deleteSql: "DELETE FROM attendance_admin_logs WHERE created_at < datetime('now','-730 days')",
  },
  {
    id: 'ai-action-audits-180d',
    table: 'ai_action_audits',
    level: 'NEEDS_REVIEW',
    why: 'MGL AI-ийн хэрэгслийн аудит (940 мөр, хурдан өсдөг) — санал хүсэлт/сургалтын аудитын шаардлагыг эзэн шийднэ.',
    countSql: "SELECT COUNT(*) AS n FROM ai_action_audits WHERE requested_at < datetime('now','-180 days')",
    deleteSql: "DELETE FROM ai_action_audits WHERE requested_at < datetime('now','-180 days')",
  },
  {
    id: 'email-soft-deleted-30d',
    table: 'email_messages',
    level: 'NEEDS_REVIEW',
    why: 'is_deleted=1 мөр (30+ хоног) — R2 дээрх бие/хавсралт нь хамт цэвэрлэгдэх ёстой (routes/email.ts-ийн softDelete → R2 устгал байгаа эсэхийг шалга).',
    countSql: "SELECT COUNT(*) AS n FROM email_messages WHERE is_deleted = 1 AND created_at < datetime('now','-30 days')",
    deleteSql: "DELETE FROM email_messages WHERE is_deleted = 1 AND created_at < datetime('now','-30 days')",
  },
  {
    id: 'client-events-365d',
    table: 'client_events',
    level: 'NEEDS_REVIEW',
    why: 'Порталын realtime үйл явдлын лог — since_id-аар гүйцээж татдаг; жилээс хуучин нь UI-д харагдахгүй.',
    countSql: "SELECT COUNT(*) AS n FROM client_events WHERE created_at < datetime('now','-365 days')",
    deleteSql: "DELETE FROM client_events WHERE created_at < datetime('now','-365 days')",
  },
  {
    id: 'docpreview-closed',
    table: 'document_google_files',
    level: 'SAFE_CANDIDATE',
    why: "status='closed' боловч preview_key үлдсэн мөр — R2 preview устгагдсан байх ёстой (lib/documentGoogle.ts).",
    countSql: "SELECT COUNT(*) AS n FROM document_google_files WHERE status = 'closed' AND preview_key IS NOT NULL",
    deleteSql: "UPDATE document_google_files SET preview_key = NULL WHERE status = 'closed' AND preview_key IS NOT NULL",
  },
];

console.log('\n=== Хуучирсан мөрийн нэр дэвшигчид (ЮУ Ч УСТГААГҮЙ) ===');
const candidates = [];
for (const r of RULES) {
  let n = null;
  try {
    n = db.prepare(r.countSql).get().n;
  } catch (e) {
    n = `ERR ${e.message}`;
  }
  candidates.push({ ...r, count: n });
  console.log(`${String(n).padStart(7)}  ${r.level.padEnd(15)} ${r.id.padEnd(28)} ${r.why}`);
}

/* ---------- 3. Хоосон / кодоос уншигддаггүй хүснэгтүүд (мэдээлэл) ---------- */
console.log('\n=== Хоосон хүснэгтүүд (устгал БИШ — миграц + хүний шийдвэр) ===');
console.log(empty.join(', ') || '—');

const report = { dbPath, generatedAt: new Date().toISOString(), tables, emptyTables: empty, candidates };
if (flags.json) {
  writeJson(String(flags.json), report);
  console.log(`\nТайлан: ${flags.json}`);
}
