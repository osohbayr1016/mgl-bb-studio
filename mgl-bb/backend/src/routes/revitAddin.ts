import { Hono } from 'hono';
import type { Env, AppVariables } from '../types';

// «Revit нэмэлт» татах — MGL Revit QTO add-in-ий урьдчилан build хийсэн суулгах
// багцуудыг (R2 доторх zip) татуулна.  ОДООХОНДОО зөвхөн НЭГ хэрэглэгчид
// (user id 1, Anand) нээлттэй — дараа бусдад нээхэд OWNER_ID-г role шалгалт
// эсвэл жагсаалт болгож солино.  authMiddleware (/api/* дээр аль хэдийн ажилласан)
// нь user-ийг тавьсан байна тул энд зөвхөн эзэмшигчийг шалгана.
const OWNER_ID = 1;

// Дэмжсэн Revit хувилбарууд.  R2 түлхүүр: revit-addin/RevitMcpAddin-Revit<он>.zip
const YEARS = ['2024', '2025', '2026', '2027'] as const;
type Year = (typeof YEARS)[number];
const r2Key = (year: Year) => `revit-addin/RevitMcpAddin-Revit${year}.zip`;

const revitAddin = new Hono<{ Bindings: Env; Variables: AppVariables }>();

// Бүх route зөвхөн эзэмшигчид (id 1).  Бусдад 403.
revitAddin.use('*', async (c, next) => {
  const user = c.get('user');
  if (!user || user.sub !== OWNER_ID) {
    return c.json({ error: 'Forbidden' }, 403);
  }
  await next();
});

// GET /api/revit-addin/download/:year — суулгах zip-ийг attachment болгож татуулна.
// Нийтийн /media/<key> линк ашиглахгүй (тэр нь authless) — зөвхөн энэ gated
// route-оор дамжуулна.
revitAddin.get('/download/:year', async (c) => {
  const year = c.req.param('year');
  if (!YEARS.includes(year as Year)) {
    return c.json({ error: 'Invalid Revit version' }, 400);
  }

  const object = await c.env.MEDIA_BUCKET.get(r2Key(year as Year));
  if (!object) {
    return c.json({ error: `Revit ${year}-ийн багц одоогоор байхгүй байна.` }, 404);
  }

  const filename = `RevitMcpAddin-Revit${year}.zip`;
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('Content-Type', 'application/zip');
  // writeHttpMetadata Content-Length-ийг тавьдаггүй — гараар нэмнэ (татах progress).
  headers.set('Content-Length', object.size.toString());
  headers.set('Content-Disposition', `attachment; filename="${filename}"`);
  headers.set('Cache-Control', 'private, no-store');
  return new Response(object.body, { headers });
});

/* ------------------------------------------------------------------ */
/*  Релизийн бүртгэл ба паркийн зураг (v2 §74 — MANIFEST / HASH)        */
/* ------------------------------------------------------------------ */

/** 64 тэмдэгтийн ЖИЖИГ үсгээр бичигдсэн sha256 үү. */
function isSha256(v: unknown): v is string {
  return typeof v === 'string' && /^[0-9a-f]{64}$/.test(v.trim().toLowerCase());
}

const RELEASE_STATUS = ['published', 'superseded', 'revoked'] as const;
type ReleaseStatus = (typeof RELEASE_STATUS)[number];

function txt(v: unknown, max: number): string | null {
  const s = typeof v === 'string' ? v.trim() : '';
  if (!s) return null;
  return s.length > max ? s.slice(0, max) : s;
}

/**
 * POST /api/revit-addin/releases — нийтэлсэн zip-ийн манифестыг бүртгэнэ.
 *
 * ⚠️ ЯАГААД ЗӨВХӨН БҮРТГЭЛ ВЭ: R2 руу байршуулах нь
 * `node backend/scripts/r2.mjs put media <түлхүүр> --file=… --remote`-ээр
 * ГАРААР хийгддэг.  Энэ route нь тэр байршуулалтын ДАРАА ажиллаж, «яг ямар
 * байт нийтлэгдсэн» гэдгийг тогтооно.  Байршуулалт өөрөө энд ШИЛЖИХГҮЙ —
 * Worker-ийн хүсэлтийн хэмжээний хязгаар ~20 MB zip-д тохирохгүй.
 *
 * ⚠️ ОРОЛТ нь `dist\*.manifest.json`-ийн ЯГ ТЭР бүтэц (package-addin.ps1
 * бичдэг): version · revit · zip · sha256 · bytes · built_at · git_sha.
 *
 * ⚠️ Хэрэв ижил (version, revit_year, channel)-д ӨӨР sha256 ирвэл тэр нь
 * «нэг хувилбарын дугаараар ХОЁР ӨӨР БАЙТ тараагдсан» гэсэн үг — хариунд
 * `sha_changed: true` буцаана.  Оператор түүнийг заавал мэдэх ёстой:
 * буцаалтын архив нь дугаараар нэрлэгддэг тул хоёрдмол дугаар нь §8-ийн
 * буцаалтыг УТГАГҮЙ болгоно.
 *
 * ⚠️ ГАРЫН ҮСГИЙН ОРЛУУЛАГЧ БИШ.  sha256 нь бүрэн бүтэн байдал (integrity)
 * — гарал үүсэл (authenticity) БИШ.  Код гарын үсгийн гэрчилгээ репод
 * БАЙХГҮЙ; §74-ийн SIGN/VERIFY шат нээлттэй цоорхой хэвээр.
 */
revitAddin.post('/releases', async (c) => {
  const user = c.get('user');

  let b: Record<string, unknown>;
  try {
    b = await c.req.json<Record<string, unknown>>();
  } catch {
    return c.json({ error: 'JSON бие шаардлагатай' }, 400);
  }

  // `revit` (манифестын нэр) ба `revit_year` (DB-ийн нэр) хоёуланг хүлээж авна.
  const year = txt(b.revit_year ?? b.revit, 8);
  if (!year || !YEARS.includes(year as Year)) {
    return c.json({ error: 'revit_year нь 2024|2025|2026|2027 байх ёстой' }, 400);
  }

  const version = txt(b.version, 32);
  if (!version) return c.json({ error: 'version шаардлагатай' }, 400);

  const sha = typeof b.sha256 === 'string' ? b.sha256.trim().toLowerCase() : '';
  if (!isSha256(sha)) {
    return c.json({ error: 'sha256 нь 64 тэмдэгтийн hex байх ёстой' }, 400);
  }

  // ⚠️ ЗӨВХӨН ЭНЭ ХЭШИЙГ клиент тооцоолж чадна — `recognised` тугийн эх
  //    сурвалж.  Байхгүй бол тухайн релизийн НЭГ Ч суулгац танигдахгүй.
  const payloadShaRaw = typeof b.payload_sha256 === 'string'
    ? b.payload_sha256.trim().toLowerCase()
    : '';
  const payloadSha = isSha256(payloadShaRaw) ? payloadShaRaw : null;

  const bytes = typeof b.bytes === 'number' && Number.isFinite(b.bytes)
    ? Math.floor(b.bytes)
    : 0;
  if (bytes <= 0) return c.json({ error: 'bytes > 0 байх ёстой' }, 400);

  const builtAt = txt(b.built_at, 40);
  if (!builtAt) return c.json({ error: 'built_at шаардлагатай' }, 400);

  const channel = txt(b.channel, 16) ?? 'prod';
  const status = (RELEASE_STATUS as readonly string[]).includes(String(b.status))
    ? (String(b.status) as ReleaseStatus)
    : 'published';
  const zipName = txt(b.zip ?? b.zip_name, 128) ?? `RevitMcpAddin-Revit${year}.zip`;

  // Урьд нь энэ гурвалд ямар хэш бүртгэгдсэн бэ — дарж бичихийн ӨМНӨ уншина.
  const prev = await c.env.DB.prepare(
    `SELECT sha256 FROM addin_releases
      WHERE version = ? AND revit_year = ? AND channel = ? LIMIT 1`,
  )
    .bind(version, year, channel)
    .first<{ sha256: string }>();

  await c.env.DB.prepare(
    `INSERT INTO addin_releases
       (version, revit_year, channel, zip_name, sha256, payload_sha256, bytes,
        git_sha, built_at, min_client, status, notes, published_by, published_at)
     VALUES (?,?,?,?,?, ?,?,?,?, ?,?,?,?, datetime('now'))
     ON CONFLICT (version, revit_year, channel) DO UPDATE SET
       zip_name       = excluded.zip_name,
       sha256         = excluded.sha256,
       payload_sha256 = excluded.payload_sha256,
       bytes          = excluded.bytes,
       git_sha        = excluded.git_sha,
       built_at       = excluded.built_at,
       min_client     = excluded.min_client,
       status         = excluded.status,
       notes          = excluded.notes,
       published_by   = excluded.published_by,
       published_at   = datetime('now')`,
  )
    .bind(
      version, year, channel, zipName, sha, payloadSha, bytes, txt(b.git_sha, 64),
      builtAt, txt(b.min_client, 32), status, txt(b.notes, 500), user.sub,
    )
    .run();

  return c.json({
    ok: true,
    version,
    revit_year: year,
    channel,
    sha256: sha,
    payload_sha256: payloadSha,
    // ⚠️ payload хэшгүй бүртгэл нь ХЭСЭГЧИЛСЭН — тэр релизийн суулгацууд
    //    `recognised: false` авна.  Оператор үүнийг ХАРАХ ёстой.
    payload_missing: payloadSha === null,
    // ⚠️ true нь ЗААВАЛ судлагдана — нэг дугаар, хоёр өөр байт.
    sha_changed: Boolean(prev && prev.sha256 !== sha),
    previous_sha256: prev?.sha256 ?? null,
  });
});

/**
 * GET /api/revit-addin/releases — эзний хуудсанд түүх, мөн БУЦААЛТЫН БАЙ.
 *
 * ⚠️ §8-ийн «буцаах юм байхгүй» асуудлын серверийн хариулт: архивласан
 * zip бүрийн sha256 энд бүртгэгдсэн байвал «өмнөх хувилбар руу буц» гэдэг
 * нь нэрлэж болох алхам болно.
 */
revitAddin.get('/releases', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT id, version, revit_year, channel, zip_name, sha256, payload_sha256, bytes,
            git_sha, built_at, min_client, status, notes, published_at
       FROM addin_releases
      ORDER BY published_at DESC, id DESC
      LIMIT 50`,
  ).all();
  return c.json({ releases: results ?? [] });
});

/**
 * GET /api/revit-addin/fleet — ПАРКИЙН НЭГТГЭСЭН зураг.
 *
 * ⚠️ ЗӨВХӨН НЭГТГЭЛ.  `user_id`, нэвтрэх нэр, `machine_hash` — гурвын аль
 * нь ч ХЭЗЭЭ Ч буцаагдахгүй.  Энэ нь 0201:23-32-ийн «өөрөө харах»
 * тогтмолын шууд үргэлжлэл: суулгацын эрүүл мэнд нь МАШИНЫ шинж чанар,
 * ХҮНИЙ гүйцэтгэлийн үзүүлэлт БИШ.  «Хэн муу суулгацтай вэ» гэсэн хүн
 * нэрлэсэн жагсаалт нь дөрвөн газар баримтжуулсан дүрмийг зөрчинө.
 *
 * ⚠️ `machines` нь `COUNT(DISTINCT machine_hash)` — хэш нь ГАРАХГҮЙ,
 * зөвхөн ТОО.  Энэ бол «парк яг хэдэн машин вэ» гэсэн асуултад анх
 * удаа хариулах тоо (өмнө нь «~20» гэдэг нь хэмжигдээгүй таамаг байсан).
 */
revitAddin.get('/fleet', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT addin_version, revit_year, channel, health,
            COUNT(*) AS installs,
            COUNT(DISTINCT machine_hash) AS machines,
            MAX(last_seen_at) AS last_seen
       FROM addin_installs
      GROUP BY addin_version, revit_year, channel, health
      ORDER BY last_seen DESC`,
  ).all();

  const totals = await c.env.DB.prepare(
    `SELECT COUNT(DISTINCT machine_hash) AS machines,
            COUNT(*) AS installs,
            SUM(CASE WHEN health = 'ok' THEN 1 ELSE 0 END) AS ok,
            SUM(CASE WHEN health <> 'ok' THEN 1 ELSE 0 END) AS not_ok
       FROM addin_installs`,
  ).first<{ machines: number; installs: number; ok: number; not_ok: number }>();

  return c.json({ groups: results ?? [], totals: totals ?? null });
});

export default revitAddin;
