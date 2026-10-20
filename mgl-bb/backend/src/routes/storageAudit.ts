/**
 * R2 хадгалалтын аудит ба эзэнгүй (orphan) объектын цэвэрлэгээ (2026-09-13).
 *
 * Эзний асуулт: «R2 41.9 GB болсон, гэхдээ ихэнхийг нь хэрэглэхгүй байна —
 * юу хэрэгтэй, юу хэрэггүйг олоод цэвэрлэ».  Асуудал нь `MEDIA_BUCKET`-ийн
 * түлхүүр ЗОРИУЛАЛТААР угтваргүй: профайлын зураг, ЗХ-ын фото, төслийн зураг,
 * IFC загвар, хуучин архивын файл бүгд `<userId>-<ts>-<rand>-<нэр>` гэсэн НЭГ
 * хэлбэртэй (`routes/upload.ts`).  Тиймээс «юу хэрэгтэй вэ» гэдгийг зөвхөн
 * D1-тэй ТУЛГАЖ л мэднэ: D1-ийн ямар нэг мөр заасан объект = хэрэгтэй, хэн ч
 * заагаагүй объект = эзэнгүй (солигдсон профайлын зураг, устгасан мөрийн файл,
 * хагас дутуу upload, MCP-ийн 404-ддог тайлан …).
 *
 *   GET  /api/storage/audit?bucket=media|meeting[&keys=1]   (admin)
 *        R2-ыг бүхэлд нь жагсааж, D1-ийн БҮХ хүснэгтийн БҮХ текст баганыг
 *        түлхүүр/`/media/` URL-аар шүүж, объект бүрийг
 *        referenced | orphan | recent | protected гэж ангилна.  Юу ч устгахгүй.
 *   POST /api/storage/purge   (admin)
 *        { confirm: 'PURGE-R2-ORPHANS', bucket, keys: string[] }
 *        Зөвхөн ӨГСӨН түлхүүрүүдийг, устгахын ӨМНӨ D1-ийн лавлагааг ДАХИН
 *        тооцож (аудитаас хойш үүссэн мөрийг алдахгүй), лавлагаатай/хамгаалагдсан
 *        түлхүүрийг алгасаад устгана.
 *
 * ⚠️ Prefix-ээр ХЭЗЭЭ Ч устгахгүй (`documentPurgeRoutes.ts`-тэй ижил дүрэм).
 * ⚠️ Лавлагааны хайлт нь баганын НЭРЭЭР биш, УТГААР: `photos_json`,
 *    `attachments_json`, landing блокийн JSON зэрэг нь `/media/…` URL-ыг
 *    бичвэр дотроо тээдэг тул нэрийн жагсаалт хэзээ ч бүрэн байхгүй.
 * ⚠️ Кодоос ГАРАЛТАЙ, D1-д мөргүй түлхүүрүүд «protected»:
 *    `revit-addin/…` (add-in-ийн zip, `routes/revitAddin.ts`) ба
 *    `meetings/<id>/transcript.json` (`lib/meetingTranscription.ts`).
 *    Шинэ код-гаралтай гэр бүл нэмбэл `PROTECTED_PREFIXES`-д нэм.
 * ⚠️ `recent` = сүүлийн 48 цагт байршуулсан — upload дууссан ч D1 мөр нь
 *    хараахан бичигдээгүй (ЗХ-ын тайлан бөглөж байгаа) файлыг эзэнгүй гэж
 *    үзэхгүй.
 * ⚠️ Хуучин архивын файл (`document_revisions.file_url`) нь ЛАВЛАГААТАЙ тул энд
 *    orphan биш — түүнийг `POST /api/documents/purge-legacy` устгана (D1 мөртэй нь).
 */
import { Hono } from 'hono';
import { requireAdmin } from '../middleware/auth';
import type { Env, AppVariables } from '../types';

const storage = new Hono<{ Bindings: Env; Variables: AppVariables }>();

export const PURGE_ORPHANS_CONFIRM = 'PURGE-R2-ORPHANS';

/** Кодоос гаралтай, D1-д хэзээ ч бичигддэггүй түлхүүрийн угтварууд. */
const PROTECTED_PREFIXES = ['revit-addin/', 'meetings/'];

/** Эзэнгүй гэж тооцохын өмнөх хүлээлт — хагас дутуу upload-ыг хамгаална. */
const RECENT_MS = 48 * 3600 * 1000;

type BucketName = 'media' | 'meeting';

function pickBucket(env: Env, raw: unknown): { bucket: R2Bucket; name: BucketName } {
  if (raw === 'meeting') return { bucket: env.MEETING_BUCKET, name: 'meeting' };
  return { bucket: env.MEDIA_BUCKET, name: 'media' };
}

/** Түлхүүрийн «гэр бүл»: угтвартай бол угтвар, `bim_…` бол `bim`, бусад нь flat upload. */
export function keyFamily(key: string): string {
  const slash = key.indexOf('/');
  if (slash > 0) return key.slice(0, slash + 1);
  if (key.startsWith('bim_')) return 'bim_';
  return 'upload';
}

function extOf(key: string): string {
  const base = key.slice(key.lastIndexOf('/') + 1);
  const dot = base.lastIndexOf('.');
  if (dot <= 0 || base.length - dot > 8) return '(none)';
  return base.slice(dot + 1).toLowerCase();
}

/* ---------------------------------------------------------------------------
 * D1 лавлагааны хайлт
 * ------------------------------------------------------------------------ */

/** `/media/<key>` URL-ууд — бичвэрийн хаана ч (JSON дотор ч). */
const MEDIA_URL_RE = /\/media\/([^\s"'<>\\)\]},]+)/g;
/** Түүхий түлхүүр — бүтэн утга эсвэл JSON-ы хашилттай утга. */
const RAW_KEY_RE =
  /(?:^|")((?:client|email|meetings|docpreview|client-reports|revit-addin)\/[^"\s]+|bim_[0-9a-f]{64}|\d+-\d{13}-[^"\s]+)(?:$|")/g;

/** Нэг бичвэрээс олдох бүх түлхүүрийн хувилбар (түүхий + decode хийсэн). */
export function extractKeys(text: string, out: Set<string>): void {
  for (const m of text.matchAll(MEDIA_URL_RE)) {
    const raw = m[1];
    if (!raw) continue;
    out.add(raw);
    try {
      out.add(decodeURIComponent(raw));
    } catch {
      /* буруу кодчлол — түүхийгээр нь үлдээв */
    }
  }
  for (const m of text.matchAll(RAW_KEY_RE)) {
    if (m[1]) out.add(m[1]);
  }
}

/** Баганыг SQL-ээр урьдчилан шүүх — зөвхөн түлхүүр агуулж БОЛОХ мөр ирнэ. */
function columnFilter(col: string): string {
  const c = `"${col.replace(/"/g, '""')}"`;
  return `(${c} LIKE '%/media/%' OR ${c} LIKE '%-1____________-%' OR ${c} LIKE '%client/%' OR ${c} LIKE '%email/%' OR ${c} LIKE '%meetings/%' OR ${c} LIKE '%docpreview/%' OR ${c} LIKE '%client-reports/%' OR ${c} LIKE '%bim_%')`;
}

interface RefIndex {
  /** түлхүүр → түүнийг заасан `table.column` жагсаалт */
  refs: Map<string, Set<string>>;
  tables: number;
  columns: number;
}

function isTextType(type: string): boolean {
  const t = type.toUpperCase();
  return t === '' || t.includes('TEXT') || t.includes('CHAR') || t.includes('CLOB') || t.includes('JSON');
}

export async function collectReferences(db: D1Database): Promise<RefIndex> {
  const { results: tables } = await db
    .prepare(
      `SELECT name FROM sqlite_master
        WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name <> 'd1_migrations'
        ORDER BY name`,
    )
    .all<{ name: string }>();

  const columns: Array<{ table: string; column: string }> = [];
  for (const t of tables) {
    const { results: info } = await db
      .prepare(`PRAGMA table_info("${t.name.replace(/"/g, '""')}")`)
      .all<{ name: string; type: string }>();
    for (const col of info) {
      if (isTextType(col.type ?? '')) columns.push({ table: t.name, column: col.name });
    }
  }

  const refs = new Map<string, Set<string>>();
  const BATCH = 25;
  for (let i = 0; i < columns.length; i += BATCH) {
    const slice = columns.slice(i, i + BATCH);
    const stmts = slice.map(({ table, column }) =>
      db.prepare(
        `SELECT "${column.replace(/"/g, '""')}" AS v FROM "${table.replace(/"/g, '""')}" WHERE ${columnFilter(column)}`,
      ),
    );
    const results = await db.batch<{ v: unknown }>(stmts);
    results.forEach((res, j) => {
      const src = slice[j];
      if (!src) return;
      const label = `${src.table}.${src.column}`;
      const found = new Set<string>();
      for (const row of res.results ?? []) {
        if (typeof row.v === 'string') extractKeys(row.v, found);
      }
      for (const k of found) {
        let set = refs.get(k);
        if (!set) refs.set(k, (set = new Set()));
        set.add(label);
      }
    });
  }
  return { refs, tables: tables.length, columns: columns.length };
}

/* ---------------------------------------------------------------------------
 * Ангилал
 * ------------------------------------------------------------------------ */

type Status = 'referenced' | 'orphan' | 'recent' | 'protected';

interface Classified {
  key: string;
  size: number;
  uploaded: string;
  status: Status;
  family: string;
  refs: string[];
}

function classify(obj: { key: string; size: number; uploaded: Date }, index: RefIndex, now: number): Classified {
  const family = keyFamily(obj.key);
  const refSet = index.refs.get(obj.key);
  let status: Status;
  if (PROTECTED_PREFIXES.some((p) => obj.key.startsWith(p))) status = 'protected';
  else if (refSet && refSet.size > 0) status = 'referenced';
  else if (now - obj.uploaded.getTime() < RECENT_MS) status = 'recent';
  else status = 'orphan';
  return {
    key: obj.key,
    size: obj.size,
    uploaded: obj.uploaded.toISOString(),
    status,
    family,
    refs: refSet ? [...refSet].sort() : [],
  };
}

interface Agg {
  count: number;
  bytes: number;
}
function bump(map: Map<string, Agg>, k: string, size: number): void {
  const a = map.get(k) ?? { count: 0, bytes: 0 };
  a.count++;
  a.bytes += size;
  map.set(k, a);
}
function rows(map: Map<string, Agg>): Array<{ name: string } & Agg> {
  return [...map.entries()]
    .map(([name, a]) => ({ name, ...a }))
    .sort((x, y) => y.bytes - x.bytes);
}

async function listAll(bucket: R2Bucket): Promise<Array<{ key: string; size: number; uploaded: Date }>> {
  const out: Array<{ key: string; size: number; uploaded: Date }> = [];
  let cursor: string | undefined;
  for (;;) {
    const page = await bucket.list({ limit: 1000, cursor });
    for (const o of page.objects) out.push({ key: o.key, size: o.size, uploaded: o.uploaded });
    if (!page.truncated) break;
    cursor = page.cursor;
  }
  return out;
}

/* ---------------------------------------------------------------------------
 * Routes
 * ------------------------------------------------------------------------ */

storage.get('/audit', requireAdmin(), async (c) => {
  c.header('Cache-Control', 'private, no-store');
  const { bucket, name } = pickBucket(c.env, c.req.query('bucket'));
  const includeKeys = c.req.query('keys') === '1';
  const now = Date.now();

  const [index, objects] = await Promise.all([collectReferences(c.env.DB), listAll(bucket)]);

  const byStatus = new Map<string, Agg>();
  const byFamilyStatus = new Map<string, Agg>();
  const byRef = new Map<string, Agg>();
  const orphanByExt = new Map<string, Agg>();
  const orphanByOwner = new Map<string, Agg>();
  const orphans: Classified[] = [];
  let totalBytes = 0;

  for (const o of objects) {
    const cl = classify(o, index, now);
    totalBytes += cl.size;
    bump(byStatus, cl.status, cl.size);
    bump(byFamilyStatus, `${cl.family} · ${cl.status}`, cl.size);
    // Олон лавлагаатай объект хүснэгт бүрд тоологдоно — «энэ модуль хэдийг эзэлж
    // байна» гэсэн асуултад хариулна; нийлбэр нь нийт хэмжээнээс их байж болно.
    for (const r of cl.refs) bump(byRef, r, cl.size);
    if (cl.status === 'orphan') {
      orphans.push(cl);
      bump(orphanByExt, extOf(cl.key), cl.size);
      const owner = cl.family === 'upload' ? (cl.key.match(/^(\d+)-/)?.[1] ?? '?') : cl.family;
      bump(orphanByOwner, owner, cl.size);
    }
  }
  orphans.sort((a, b) => b.size - a.size);

  return c.json({
    bucket: name,
    scanned_at: new Date(now).toISOString(),
    objects: objects.length,
    bytes: totalBytes,
    references: { tables: index.tables, columns: index.columns, keys: index.refs.size },
    by_status: rows(byStatus),
    by_family_status: rows(byFamilyStatus),
    by_reference: rows(byRef),
    orphans: {
      count: orphans.length,
      bytes: orphans.reduce((s, o) => s + o.size, 0),
      by_ext: rows(orphanByExt),
      by_owner: rows(orphanByOwner),
      largest: orphans.slice(0, 50).map(({ key, size, uploaded }) => ({ key, size, uploaded })),
      keys: includeKeys ? orphans.map(({ key, size, uploaded }) => ({ key, size, uploaded })) : undefined,
    },
  });
});

storage.post('/purge', requireAdmin(), async (c) => {
  c.header('Cache-Control', 'private, no-store');
  const body = await c.req
    .json<{ confirm?: string; bucket?: string; keys?: unknown }>()
    .catch(() => ({}) as { confirm?: string; bucket?: string; keys?: unknown });
  if (body.confirm !== PURGE_ORPHANS_CONFIRM) {
    return c.json({ error: 'Баталгаажуулах үг таарсангүй', code: 'CONFIRM_REQUIRED' }, 400);
  }
  const keys = Array.isArray(body.keys) ? body.keys.filter((k): k is string => typeof k === 'string' && k.length > 0) : [];
  if (keys.length === 0) return c.json({ error: 'keys хоосон', code: 'KEYS_REQUIRED' }, 400);
  const { bucket, name } = pickBucket(c.env, body.bucket);

  // Лавлагааг ДАХИН тооцно: аудитаас хойш үүссэн мөр (шинэ профайлын зураг,
  // шинэ ЗХ-ын тайлан) заасан түлхүүрийг устгахгүй.
  const index = await collectReferences(c.env.DB);
  const skippedReferenced: string[] = [];
  const skippedProtected: string[] = [];
  const toDelete: string[] = [];
  for (const k of new Set(keys)) {
    if (PROTECTED_PREFIXES.some((p) => k.startsWith(p))) skippedProtected.push(k);
    else if (index.refs.has(k)) skippedReferenced.push(k);
    else toDelete.push(k);
  }

  let deleted = 0;
  for (let i = 0; i < toDelete.length; i += 1000) {
    const batch = toDelete.slice(i, i + 1000);
    await bucket.delete(batch);
    deleted += batch.length;
  }

  console.log(
    `[storage-purge] by user=${c.get('user').sub} bucket=${name} requested=${keys.length} deleted=${deleted} ` +
      `skipped_referenced=${skippedReferenced.length} skipped_protected=${skippedProtected.length}`,
  );
  return c.json({
    bucket: name,
    requested: keys.length,
    deleted,
    skipped_referenced: skippedReferenced,
    skipped_protected: skippedProtected,
  });
});

/* ---------------------------------------------------------------------------
 * R2 bucket-ийн ИНВЕНТОР (зөвхөн УНШИНА) — `scripts/cleanup/fetch-r2-inventory.mjs`
 * -ийн эх сурвалж (2026-09-11 зардлын аудит).  `wrangler r2 object`-д `list` дэд
 * команд БАЙХГҮЙ (get/put/delete л), S3 API нь тусдаа токен шаарддаг тул bucket-ийн
 * агуулгыг Worker дотроос л жагсаана.  Ямар ч бичих/устгах үйлдэл ЭНД БАЙХГҮЙ.
 * R2 `list` нь Class A үйлдэл (1 000 объект/хуудас): 15 000 объекттой bucket =
 * 15 үйлдэл — сард нэг удаагийн аудитад ач холбогдолгүй.
 *
 *   GET /api/storage/inventory?bucket=media|meeting&cursor=…&prefix=…
 *     → { bucket, objects: [{ key, size, uploaded, etag, contentType }], cursor, truncated }
 * ------------------------------------------------------------------------ */
storage.get('/inventory', requireAdmin(), async (c) => {
  c.header('Cache-Control', 'private, no-store');
  const which = c.req.query('bucket') === 'meeting' ? 'meeting' : 'media';
  const bucket = which === 'meeting' ? c.env.MEETING_BUCKET : c.env.MEDIA_BUCKET;
  const cursor = c.req.query('cursor') || undefined;
  const prefix = c.req.query('prefix') || undefined;

  const listed = await bucket.list({
    cursor,
    prefix,
    limit: 1000,
    include: ['httpMetadata'],
  });

  return c.json({
    bucket: which,
    objects: listed.objects.map((o) => ({
      key: o.key,
      size: o.size,
      uploaded: o.uploaded.toISOString(),
      etag: o.etag,
      contentType: o.httpMetadata?.contentType ?? null,
    })),
    cursor: listed.truncated ? listed.cursor : null,
    truncated: listed.truncated,
  });
});

export default storage;
