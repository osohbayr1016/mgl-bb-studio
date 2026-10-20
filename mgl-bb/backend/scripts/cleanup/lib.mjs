/**
 * `scripts/cleanup/*` -ийн хамтын хэсэг — D1 хуулбарыг нээх, R2 түлхүүрийн
 * ишлэлийн графыг D1-ээс гаргах, R2 инвенторыг ангилах.
 *
 * ⚠️ ЭНЭ ФАЙЛ ЮУ Ч УСТГАДАГГҮЙ, ЮУ Ч БИЧДЭГГҮЙ.  Бүх скрипт ОФФЛАЙН D1
 *    хуулбар (`wrangler d1 export`-ийн .sql эсвэл miniflare-ийн .sqlite) дээр
 *    ажиллана — production D1 руу ХЭЗЭЭ Ч шууд асуулга явуулахгүй.
 *
 * D1 эх сурвалжийг сонгох дараалал (`resolveDbPath`):
 *   1. `--db=<path>`  — .sqlite ЭСВЭЛ `wrangler d1 export`-ийн .sql (түр sqlite-д ачаална)
 *   2. `.wrangler/state/v3/d1/miniflare-D1DatabaseObject/<database_id-ийн sha256>.sqlite`
 *      (локал wrangler dev-ийн prod хуулбар — CLAUDE.md-ийн зааврын дагуу
 *      `wrangler d1 export --remote` → локал bootstrap-оор үүсдэг)
 */
import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const backendDir = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

export function parseArgs(argv = process.argv.slice(2)) {
  const flags = {};
  const positional = [];
  for (const a of argv) {
    if (a.startsWith('--')) {
      const [k, v] = a.slice(2).split('=', 2);
      flags[k] = v === undefined ? true : v;
    } else positional.push(a);
  }
  return { flags, positional };
}

/**
 * miniflare-ийн локал D1 файл.  Файлын нэр нь Durable Object id (database_id-ийн
 * дериватив, шууд sha256 БИШ) тул нэрээр нь олохгүй — тэр хавтасны .sqlite
 * файлуудаас `users` + `d1_migrations` хүснэгттэй, ХАМГИЙН ОЛОН миграц
 * хэрэгжсэнийг сонгоно (эргэлзээтэй бол `--db=` өгнө).
 */
export function localMiniflareDbPath() {
  const dir = join(backendDir, '.wrangler/state/v3/d1/miniflare-D1DatabaseObject');
  if (!existsSync(dir)) return null;
  let best = null;
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.sqlite') || f === 'metadata.sqlite') continue;
    const p = join(dir, f);
    try {
      const db = new DatabaseSync(p, { readOnly: true });
      const has = db
        .prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name IN ('users','d1_migrations')")
        .get().n;
      if (has === 2) {
        const n = db.prepare('SELECT COUNT(*) AS n FROM d1_migrations').get().n;
        if (!best || n > best.n) best = { p, n };
      }
      db.close();
    } catch {
      /* түгжигдсэн / гэмтсэн файл — алгасна */
    }
  }
  return best?.p ?? null;
}

/** `wrangler d1 export`-ийн .sql-ийг түр sqlite-д ачаална (уншихад л). */
function loadSqlDump(sqlPath) {
  const dir = mkdtempSync(join(tmpdir(), 'mgl-cleanup-'));
  const dbPath = join(dir, 'export.sqlite');
  const db = new DatabaseSync(dbPath);
  const sql = readFileSync(sqlPath, 'utf8');
  db.exec('PRAGMA foreign_keys = OFF;');
  db.exec(sql);
  db.close();
  return dbPath;
}

export function resolveDbPath(flags) {
  if (flags.db) {
    const p = String(flags.db);
    if (!existsSync(p)) throw new Error(`--db олдсонгүй: ${p}`);
    return p.toLowerCase().endsWith('.sql') ? loadSqlDump(p) : p;
  }
  const local = localMiniflareDbPath();
  if (!local) {
    throw new Error(
      'D1 хуулбар олдсонгүй.  --db=<export.sql|копи.sqlite> өгнө үү ' +
        '(`node scripts/d1.mjs export --remote --output=d1-backup.sql` — зөвхөн УНШИНА).',
    );
  }
  return local;
}

export function openDb(path) {
  return new DatabaseSync(path, { readOnly: true });
}

/* ------------------------------------------------------------------ */
/*  D1 инвентор                                                        */
/* ------------------------------------------------------------------ */

export function listTables(db) {
  return db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name",
    )
    .all()
    .map((r) => r.name);
}

export function tableInfo(db, table) {
  const cols = db.prepare(`PRAGMA table_info("${table}")`).all();
  const rows = db.prepare(`SELECT COUNT(*) AS n FROM "${table}"`).get().n;
  const idx = db.prepare(`PRAGMA index_list("${table}")`).all().map((i) => i.name);
  return { table, rows, columns: cols.map((c) => c.name), textColumns: cols.filter((c) => /TEXT|CHAR|CLOB|JSON/i.test(c.type || '') || !c.type).map((c) => c.name), indexes: idx };
}

/* ------------------------------------------------------------------ */
/*  R2 түлхүүрийн ишлэл — D1-ийн БҮХ текст баганаас                    */
/* ------------------------------------------------------------------ */

/** `/media/<нэг сегмент>` — routes/upload.ts + routes/media.ts гэрээ. */
const MEDIA_URL_RE = /\/media\/([^\s"'<>\\?#,;)}\]]+)/g;
/** Хавтастай R2 түлхүүрүүд — D1-д ШУУД (URL биш) хадгалагддаг. */
const BARE_KEY_RE =
  /(?:^|["'\s,;(\[{])((?:email|client|meetings|docpreview|client-reports|revit-addin)\/[^\s"'<>\\,;)}\]]+|bim_[0-9a-f]{16,64})/g;
/** Хэрэглэгчийн байршуулсан объектын түлхүүр (`<sub>-<ms>-…`). */
const UPLOAD_KEY_RE = /(?:^|["'\s,;(\[{])(\d{1,6}-\d{13}-[^\s"'<>\\,;)}\]]+)/g;

function safeDecode(s) {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/**
 * D1-ийн бүх текст утгаас R2 түлхүүрийн ишлэлийг цуглуулна.
 * Буцаах: Map<key, Array<"table.column">>.
 */
export function collectReferencedKeys(db, { onProgress } = {}) {
  const refs = new Map();
  const add = (key, where) => {
    const k = safeDecode(key);
    const list = refs.get(k);
    if (list) {
      if (!list.includes(where)) list.push(where);
    } else refs.set(k, [where]);
  };
  for (const table of listTables(db)) {
    const info = tableInfo(db, table);
    if (info.textColumns.length === 0 || info.rows === 0) continue;
    const cols = info.textColumns.map((c) => `"${c}"`).join(', ');
    const stmt = db.prepare(`SELECT ${cols} FROM "${table}"`);
    for (const row of stmt.iterate()) {
      for (const col of info.textColumns) {
        const v = row[col];
        if (typeof v !== 'string' || v.length === 0) continue;
        const where = `${table}.${col}`;
        let m;
        MEDIA_URL_RE.lastIndex = 0;
        while ((m = MEDIA_URL_RE.exec(v))) add(m[1], where);
        BARE_KEY_RE.lastIndex = 0;
        while ((m = BARE_KEY_RE.exec(v))) add(m[1], where);
        UPLOAD_KEY_RE.lastIndex = 0;
        while ((m = UPLOAD_KEY_RE.exec(v))) add(m[1], where);
      }
    }
    onProgress?.(table, info.rows);
  }
  return refs;
}

/* ------------------------------------------------------------------ */
/*  R2 инвенторын ангилал                                               */
/* ------------------------------------------------------------------ */

/**
 * Түлхүүрийн ангилал + бодлого.  `never` = ХЭЗЭЭ Ч устгахгүй (статик, хуваалцсан).
 * `confidence` нь ишлэлгүй үед л хамаарна.
 */
export const CATEGORIES = [
  { id: 'static-addin', test: (k) => k.startsWith('revit-addin/'), policy: 'never', note: 'Revit add-in суулгагч (статик)' },
  { id: 'seed', test: (k) => k === 'default-profile-photo.png', policy: 'never', note: 'Өгөгдмөл avatar (seed)' },
  { id: 'email-body', test: (k) => /^email\/\d+\/[^/]+\/body\.html$/.test(k), policy: 'ref', confidence: 'HIGH', note: 'Gmail бие (email_messages.body_html_r2_key)' },
  { id: 'email-attachment', test: (k) => /^email\/\d+\/[^/]+\/att-/.test(k), policy: 'ref', confidence: 'HIGH', note: 'Gmail хавсралт (email_attachments.r2_key)' },
  { id: 'email-flat-copy', test: (k) => k.startsWith('email/'), policy: 'ref', confidence: 'MEDIUM', note: 'email/ доорх бусад (хавсралтын хуулбар г.м.)' },
  { id: 'client-report-pdf', test: (k) => k.startsWith('client-reports/'), policy: 'age', confidence: 'HIGH', minAgeDays: 7, note: 'MCP generate_report PDF — D1 ишлэлгүй, URL нь 404 (CLAUDE.md)' },
  { id: 'docpreview', test: (k) => k.startsWith('docpreview/'), policy: 'ref', confidence: 'HIGH', note: 'Google Docs урьдчилан харах кэш (document_google_files.preview_key)' },
  { id: 'client-file', test: (k) => k.startsWith('client/'), policy: 'ref', confidence: 'MEDIUM', note: 'Захиалагчийн порталын файл (хувийн bucket)' },
  { id: 'meeting-transcript', test: (k) => /^meetings\/\d+\//.test(k), policy: 'ref', confidence: 'MEDIUM', note: 'Хурлын transcript JSON' },
  { id: 'bim-artifact', test: (k) => /^bim_[0-9a-f]+/.test(k), policy: 'ref', confidence: 'MEDIUM', note: 'BIM сургалтын артефакт (bim_artifacts.r2_key)' },
  { id: 'user-upload', test: (k) => /^\d{1,6}-\d{13}-/.test(k), policy: 'ref', confidence: 'HIGH', note: 'Хэрэглэгчийн байршуулсан файл (avatar, зураг, хавсралт, баримт, дуу)' },
  { id: 'unknown', test: () => true, policy: 'ref', confidence: 'LOW', note: 'Танигдаагүй хэлбэр' },
];

export function categorize(key) {
  return CATEGORIES.find((c) => c.test(key));
}

export function fmtBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

export function daysSince(iso) {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? (Date.now() - t) / 86_400_000 : Infinity;
}

export function writeJson(path, data) {
  writeFileSync(path, JSON.stringify(data, null, 2));
}
