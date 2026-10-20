/**
 * Зохиогчийн хяналт — ХУУЧИН тайлан нөхөж бүртгэх («Project document нөхөх»),
 * миграц 0332.  `/api/author-supervision/backfill/*` — үндсэн ASR router-оос
 * ӨМНӨ mount хийгдэнэ (index.ts).
 *
 * Систем нэвтрэхээс өмнөх ЗХ тайлангууд нь `YYMMDD_<ТӨСӨЛ>_ASR_<БАГ>_<NNN>.docx|pdf`
 * файлууд бөгөөд төслийн Google Drive хавтсанд (main_projects.google_drive_folder_id)
 * хадгалагдсан.  Drive-ын сонсогч (0300, `project_drive_versions`) тэдгээрийг
 * аль хэдийн индекслэсэн тул:
 *
 *   1. НЭР ДЭВШИГЧ = ledger-ийн сүүлийн мөрөөр амьд файлууд, нэр нь задардаг
 *      (`lib/asrLegacy.ts`) — Drive рүү ганц ч дуудлагагүй;
 *   2. docx байвал АГУУЛГЫГ серверээр уншуулж урьдчилан бөглөнө
 *      (`lib/asrLegacyDocx.ts`, Drive-аас SA-гаар татна);
 *   3. хэрэглэгч (admin/senior) зорилтот төсөл, огноо, баг, дугаар, тайлбарыг
 *      баталгаажуулж ИМПОРТ хийнэ — тайлан `approved`, `origin='legacy'`,
 *      эх файл `asr_legacy_sources`-д.  2026-09-29-нөөс (эзний шийдвэр, 0359)
 *      нөхсөн тайлан ч багийнхаа DASR дараалалд ОГНООГООРОО орно: импортын
 *      дараа `renumberAsrProject` бүх дугаарыг дахин тооцно (11-р сарынх 001,
 *      өмнө нь 001 байсан 12-р сарынх 002).  Файлын өөрийн дугаар
 *      («ASR-BB-005») `legacy_doc_no`-д хэвээр;
 *   4. файлгүй (цаасан) тайланг ГАРААР ч оруулж болно (ижил endpoint, файлгүй).
 *
 * Давхардлын дүрэм (эзэн, 2026-09-21):
 *   • НЭГ Drive файл → нэг л удаа (UNIQUE `asr_legacy_sources.drive_file_id`);
 *   • ижил төсөл + огноо + баг = ЗӨӨЛӨН давхардал → алгасна, `force_duplicate`
 *     өгвөл л орно;
 *   • docx + pdf ижил огноо/баг/дугаар = НЭГ тайлан (хоёр файл холбогдоно).
 *
 * Эрх: `requireManager` (admin + senior) — Drive хэсгийн `DRIVE_ROLES`-той ижил
 * хос.  `worker`/`client` нь `workerScope`/`clientScope`-оор аль хэдийн хаалттай.
 *
 * ⚠️ `routes/authorSupervision.ts`-ийг ХӨНДӨХГҮЙ: тэнд `r.*` сонгодог тул шинэ
 *    баганууд (`origin`, `legacy_doc_no` …) жагсаалт/дэлгэрэнгүйд автоматаар очно.
 */
import { Hono, type Context } from 'hono';
import { requireManager } from '../middleware/auth';
import { driveBrowseConfigured, driveBrowseDownload } from '../lib/google/driveBrowse';
import { driveErrorResponse } from './projectDrive';
import { seedZaShares } from '../lib/asrTargets';
import { renumberAsrProject } from '../lib/asrNo';
import {
  driveViewUrl,
  groupLegacyFiles,
  matchLegacyAuthor,
  normalizeTeamCode,
  parseLegacyAsrFileName,
  softDuplicateOf,
  suggestTargetProject,
  type ExistingReportLite,
  type LegacyCandidate,
  type LegacyDriveFile,
  type TargetMember,
} from '../lib/asrLegacy';
import { extractDocxImages, parseAsrDocx, type ParsedAsrDoc } from '../lib/asrLegacyDocx';
import type { Env, AppVariables } from '../types';

type AppEnv = { Bindings: Env; Variables: AppVariables };
type Ctx = Context<AppEnv>;

const router = new Hono<AppEnv>();
router.use('/backfill/*', requireManager());

const DOC_KINDS = new Set(['planning', 'progress', 'report', 'drawing', 'schedule', 'other']);
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
/** Drive-аас татах docx-ийн дээд хэмжээ — зурагтай тайлан хэдэн MB, 25 MB хангалттай. */
const DOCX_MAX_BYTES = 25 * 1024 * 1024;
const MAX_ITEMS_PER_IMPORT = 100;
const MAX_TEXT = 20_000;

const norm = (v: unknown): string | null => {
  if (v == null) return null;
  const s = String(v).trim();
  return s ? s.slice(0, MAX_TEXT) : null;
};
const isValidDate = (v: unknown): v is string =>
  typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));

/* ------------------------------------------------------------------ */
/*  Уншилтын туслахууд                                                 */
/* ------------------------------------------------------------------ */

interface MainRow {
  id: number;
  code: string | null;
  name: string;
  google_drive_folder_id: string | null;
}

async function loadMain(db: D1Database, mainId: number): Promise<MainRow | null> {
  return (
    (await db
      .prepare('SELECT id, code, name, google_drive_folder_id FROM main_projects WHERE id = ?')
      .bind(mainId)
      .first<MainRow>()) ?? null
  );
}

interface MemberRow extends TargetMember {
  name: string;
  asr_only: number | null;
}

async function loadMembers(db: D1Database, mainId: number): Promise<MemberRow[]> {
  const { results } = await db
    .prepare(
      `SELECT p.id, p.name, p.category, p.status, p.asr_only,
              (SELECT COUNT(*) FROM author_supervision_reports r
                WHERE r.project_id = p.id AND r.status IN ('submitted','approved')) AS report_count
         FROM projects p
        WHERE p.main_project_id = ?
          -- ЗХ-д оролцохоо больсон гишүүн (0340) нөхөх бүртгэлийн зорилт
          -- болохгүй: эс тэгвэл хуучин файлууд тэр мөр дээр бууж хуваагдал дахин үүснэ.
          AND p.asr_merged_into IS NULL
        ORDER BY (p.status = 'active') DESC, p.category, p.id`,
    )
    .bind(mainId)
    .all<MemberRow>();
  return results ?? [];
}

/**
 * Хавтасны АМЬД файлууд — файл бүрийн ledger-ийн СҮҮЛИЙН мөр (trashed/deleted
 * биш).  Хавтас (folder mime) орохгүй.  Аль хэдийн шийдэгдсэн (imported /
 * ignored) файлыг ялгахын тулд `asr_legacy_sources`-тэй LEFT JOIN.
 */
interface LedgerFile {
  file_id: string;
  file_name: string;
  mime_type: string;
  drive_modified_at: string | null;
  state: 'imported' | 'ignored' | null;
  report_id: number | null;
  source_project_id: number | null;
}

async function loadLiveFiles(db: D1Database, rootId: string): Promise<LedgerFile[]> {
  const { results } = await db
    .prepare(
      `WITH latest AS (
         SELECT v.file_id, MAX(v.id) AS max_id
           FROM project_drive_versions v
          WHERE v.root_folder_id = ?
          GROUP BY v.file_id
       )
       SELECT v.file_id, v.file_name, v.mime_type, v.drive_modified_at,
              s.state, s.report_id, s.project_id AS source_project_id
         FROM latest l
         JOIN project_drive_versions v ON v.id = l.max_id
         LEFT JOIN asr_legacy_sources s ON s.drive_file_id = v.file_id
        WHERE v.change_kind NOT IN ('trashed', 'deleted')
          AND v.mime_type <> 'application/vnd.google-apps.folder'
        ORDER BY v.file_name`,
    )
    .bind(rootId)
    .all<LedgerFile>();
  return results ?? [];
}

async function loadExistingReports(db: D1Database, projectId: number): Promise<ExistingReportLite[]> {
  const { results } = await db
    .prepare(
      `SELECT r.id, r.doc_no, r.report_date,
              (SELECT group_concat(t.code) FROM author_supervision_report_teams rt
                 JOIN teams t ON t.id = rt.team_id WHERE rt.report_id = r.id) AS team_codes
         FROM author_supervision_reports r
        WHERE r.project_id = ? AND r.status <> 'draft'`,
    )
    .bind(projectId)
    .all<ExistingReportLite>();
  return results ?? [];
}

function toLegacyFile(f: LedgerFile): LegacyDriveFile {
  return {
    file_id: f.file_id,
    file_name: f.file_name,
    mime_type: f.mime_type,
    modified_at: f.drive_modified_at,
    parsed: parseLegacyAsrFileName(f.file_name),
  };
}

function fileView(f: LedgerFile) {
  return {
    file_id: f.file_id,
    file_name: f.file_name,
    mime_type: f.mime_type,
    modified_at: f.drive_modified_at,
    view_url: driveViewUrl(f.file_id),
    is_docx: f.mime_type === DOCX_MIME,
  };
}

/* ------------------------------------------------------------------ */
/*  GET /backfill/overview — үндсэн төслүүд + тоо                       */
/* ------------------------------------------------------------------ */

router.get('/backfill/overview', async (c) => {
  const db = c.env.DB;
  try {
    return await overview(c);
  } catch (err) {
    console.error('[asr-backfill] overview failed', err);
    return c.json({ error: err instanceof Error ? err.message : 'overview failed' }, 500);
  }
});

async function overview(c: Ctx) {
  const db = c.env.DB;
  const { results: mains } = await db
    .prepare(
      `SELECT m.id, m.code, m.name, m.google_drive_folder_id
         FROM main_projects m
        ORDER BY m.name`,
    )
    .all<MainRow>();

  const out = [];
  for (const m of mains ?? []) {
    const root = m.google_drive_folder_id?.trim() || null;
    let candidates = 0;
    let unrecognized = 0;
    let imported = 0;
    let ignored = 0;
    if (root) {
      const files = await loadLiveFiles(db, root);
      const pending = files.filter((f) => !f.state).map(toLegacyFile);
      candidates = groupLegacyFiles(pending).length;
      unrecognized = pending.filter((f) => f.parsed.kind === 'unrecognized').length;
      imported = files.filter((f) => f.state === 'imported').length;
      ignored = files.filter((f) => f.state === 'ignored').length;
    }
    const members = await loadMembers(db, m.id);
    out.push({
      id: m.id,
      code: m.code,
      name: m.name,
      folder_id: root,
      candidate_count: candidates,
      unrecognized_count: unrecognized,
      imported_count: imported,
      ignored_count: ignored,
      members: members.map((p) => ({
        id: p.id,
        name: p.name,
        category: p.category,
        status: p.status,
        report_count: p.report_count,
      })),
    });
  }
  return c.json({ mains: out, drive_configured: driveBrowseConfigured(c.env) });
}

/* ------------------------------------------------------------------ */
/*  GET /backfill/main/:mainId — нэг үндсэн төслийн нэр дэвшигчид       */
/* ------------------------------------------------------------------ */

interface CandidateView extends Omit<LegacyCandidate, 'files'> {
  files: ReturnType<typeof fileView>[];
  duplicate_of: ExistingReportLite | null;
}

router.get('/backfill/main/:mainId', async (c) => {
  const db = c.env.DB;
  const mainId = Number(c.req.param('mainId'));
  if (!Number.isFinite(mainId)) return c.json({ error: 'Invalid id' }, 400);
  const main = await loadMain(db, mainId);
  if (!main) return c.json({ error: 'Not found' }, 404);

  const members = await loadMembers(db, mainId);
  const suggested = suggestTargetProject(members);
  const requested = Number(c.req.query('project_id'));
  const targetId =
    Number.isFinite(requested) && members.some((m) => m.id === requested) ? requested : suggested;
  const existing = targetId != null ? await loadExistingReports(db, targetId) : [];

  const root = main.google_drive_folder_id?.trim() || null;
  const files = root ? await loadLiveFiles(db, root) : [];
  const pending = files.filter((f) => !f.state);
  const byId = new Map(files.map((f) => [f.file_id, f]));

  const groups = groupLegacyFiles(pending.map(toLegacyFile));
  const candidates: CandidateView[] = groups.map((g) => ({
    ...g,
    files: g.files.map((f) => fileView(byId.get(f.file_id)!)),
    duplicate_of: softDuplicateOf(existing, g.date, g.team_code ? [g.team_code] : []),
  }));

  const unrecognized = pending
    .filter((f) => parseLegacyAsrFileName(f.file_name).kind === 'unrecognized')
    .map(fileView);

  const importedRows = files.filter((f) => f.state === 'imported');
  const reportIds = [...new Set(importedRows.map((f) => f.report_id).filter((x): x is number => x != null))];
  const reportMeta = new Map<number, { doc_no: string | null; report_date: string; project_id: number }>();
  if (reportIds.length > 0) {
    const { results } = await db
      .prepare(
        `SELECT id, doc_no, report_date, project_id FROM author_supervision_reports
          WHERE id IN (${reportIds.map(() => '?').join(',')})`,
      )
      .bind(...reportIds)
      .all<{ id: number; doc_no: string | null; report_date: string; project_id: number }>();
    for (const r of results ?? []) reportMeta.set(r.id, r);
  }
  const imported = importedRows.map((f) => ({
    ...fileView(f),
    report_id: f.report_id,
    report: f.report_id != null ? (reportMeta.get(f.report_id) ?? null) : null,
  }));
  const ignored = files.filter((f) => f.state === 'ignored').map(fileView);

  const { results: teams } = await db
    .prepare('SELECT id, code, name_mn, name_en FROM teams ORDER BY sort_order, code')
    .all<{ id: number; code: string; name_mn: string; name_en: string | null }>();

  return c.json({
    main: { id: main.id, code: main.code, name: main.name, folder_id: root },
    members: members.map((p) => ({
      id: p.id,
      name: p.name,
      category: p.category,
      status: p.status,
      asr_only: p.asr_only,
      report_count: p.report_count,
    })),
    suggested_project_id: suggested,
    target_project_id: targetId,
    existing_reports: existing,
    candidates,
    unrecognized,
    imported,
    ignored,
    teams: teams ?? [],
    drive_configured: driveBrowseConfigured(c.env),
    ledger_indexed: files.length > 0,
  });
});

/* ------------------------------------------------------------------ */
/*  Drive-аас docx татах + унших                                        */
/* ------------------------------------------------------------------ */

async function fetchDocxBytes(env: Env, fileId: string): Promise<Uint8Array> {
  const res = await driveBrowseDownload(env, fileId);
  const len = Number(res.headers.get('content-length') ?? '0');
  if (len > DOCX_MAX_BYTES) throw new Error('docx too large');
  const buf = new Uint8Array(await res.arrayBuffer());
  if (buf.length > DOCX_MAX_BYTES) throw new Error('docx too large');
  return buf;
}

/** Файл ЭНЭ үндсэн төслийн хавтсанд амьд байгаа эсэх — ledger-ээр. */
async function assertFileInRoot(db: D1Database, rootId: string, fileId: string): Promise<LedgerFile | null> {
  const row = await db
    .prepare(
      `SELECT v.file_id, v.file_name, v.mime_type, v.drive_modified_at,
              s.state, s.report_id, s.project_id AS source_project_id
         FROM project_drive_versions v
         LEFT JOIN asr_legacy_sources s ON s.drive_file_id = v.file_id
        WHERE v.file_id = ? AND v.root_folder_id = ?
        ORDER BY v.id DESC LIMIT 1`,
    )
    .bind(fileId, rootId)
    .first<LedgerFile & { change_kind?: string }>();
  return row ?? null;
}

/**
 * POST /backfill/main/:mainId/parse { file_id }
 * docx-ийн агуулгыг уншиж урьдчилан бөглөх утгуудыг буцаана.  Уншиж
 * чадахгүй бол `parsed: null` + `error` — 500 БИШ (задлан бол зөвхөн тусламж).
 */
router.post('/backfill/main/:mainId/parse', async (c) => {
  const db = c.env.DB;
  const mainId = Number(c.req.param('mainId'));
  if (!Number.isFinite(mainId)) return c.json({ error: 'Invalid id' }, 400);
  const main = await loadMain(db, mainId);
  if (!main) return c.json({ error: 'Not found' }, 404);
  const root = main.google_drive_folder_id?.trim() || null;
  if (!root) return c.json({ error: 'Drive хавтас холбогдоогүй.', code: 'NOT_LINKED' }, 409);
  if (!driveBrowseConfigured(c.env)) {
    return c.json({ error: 'Google Drive тохируулагдаагүй.', code: 'NOT_CONFIGURED' }, 503);
  }

  const body = await c.req.json<{ file_id?: string }>().catch(() => ({}) as { file_id?: string });
  const fileId = norm(body.file_id);
  if (!fileId) return c.json({ error: 'file_id is required' }, 400);
  const file = await assertFileInRoot(db, root, fileId);
  if (!file) return c.json({ error: 'Файл энэ төслийн хавтсанд алга.', code: 'NOT_FOUND' }, 404);
  if (file.mime_type !== DOCX_MIME) {
    return c.json({ error: 'Зөвхөн .docx файлын агуулгыг уншина.', code: 'NOT_DOCX' }, 415);
  }

  try {
    const bytes = await fetchDocxBytes(c.env, fileId);
    const parsed = await parseAsrDocx(bytes);
    return c.json({ parsed, photo_count: parsed.photo_rids.length });
  } catch (err) {
    if (err instanceof Error && /too large|zip:|docx:/.test(err.message)) {
      console.warn('[asr-backfill] parse failed', fileId, err.message);
      return c.json({ parsed: null, error: err.message });
    }
    return driveErrorResponse(c, err, 'backfill parse');
  }
});

/* ------------------------------------------------------------------ */
/*  POST /backfill/main/:mainId/import — тайлан үүсгэх                  */
/* ------------------------------------------------------------------ */

interface ImportItem {
  /** Клиентийн түлхүүр — хариунд буцаана. */
  key?: string;
  file_ids?: string[];
  report_date?: string;
  team_codes?: string[];
  /** Баг тус бүрийн «Ажлын тайлан»; байхгүй бол `work_note` бүх багт. */
  work_notes?: Record<string, string | null>;
  work_note?: string | null;
  legacy_doc_no?: string | null;
  legacy_author_name?: string | null;
  /**
   * Тайланг бичсэн ажилтны `users.id` — өгөөгүй бол `legacy_author_name`-ийг
   * `users.full_name`/`username`-тэй тулгаж ЯГ НЭГ хүн таарвал түүнийг,
   * эс бөгөөс импортлогчийг зохиогч болгоно (очилтын тойм тэр хүнээр тоолно).
   */
  author_user_id?: number | null;
  description?: string | null;
  shifr?: string | null;
  doc_types?: string[];
  doc_type_other?: string | null;
  checked_by_name?: string | null;
  sig_arch_name?: string | null;
  sig_arch_date?: string | null;
  sig_site_name?: string | null;
  sig_site_date?: string | null;
  /** docx-ийн зургийг R2 руу хуулж тайланд хавсаргах (өгөгдмөл true). */
  import_photos?: boolean;
  /** Зөөлөн давхардлыг үл тоож оруулах. */
  force_duplicate?: boolean;
}

type ImportResult =
  | { key: string | null; ok: true; report_id: number; photos: number; author_id: number; author_matched: boolean }
  | { key: string | null; ok: false; reason: string; duplicate_of?: ExistingReportLite | null };

router.post('/backfill/main/:mainId/import', async (c) => {
  const db = c.env.DB;
  const user = c.get('user');
  const mainId = Number(c.req.param('mainId'));
  if (!Number.isFinite(mainId)) return c.json({ error: 'Invalid id' }, 400);
  const main = await loadMain(db, mainId);
  if (!main) return c.json({ error: 'Not found' }, 404);
  const root = main.google_drive_folder_id?.trim() || null;

  const body = await c.req
    .json<{ project_id?: number; items?: ImportItem[] }>()
    .catch(() => ({}) as { project_id?: number; items?: ImportItem[] });
  const projectId = Number(body.project_id);
  if (!Number.isFinite(projectId)) return c.json({ error: 'project_id is required' }, 400);
  const members = await loadMembers(db, mainId);
  if (!members.some((m) => m.id === projectId)) {
    return c.json({ error: 'Зорилтот төсөл энэ үндсэн төслийн гишүүн биш.' }, 400);
  }
  const items = Array.isArray(body.items) ? body.items : [];
  if (items.length === 0) return c.json({ error: 'items is required' }, 400);
  if (items.length > MAX_ITEMS_PER_IMPORT) {
    return c.json({ error: `Нэг удаад дээд тал нь ${MAX_ITEMS_PER_IMPORT} тайлан.` }, 400);
  }

  const { results: teamRows } = await db
    .prepare('SELECT id, code, sort_order FROM teams')
    .all<{ id: number; code: string; sort_order: number }>();
  const teamByCode = new Map((teamRows ?? []).map((t) => [t.code.toUpperCase(), t]));
  // Хяналт хийсэн хүнийг нэрээр нь таних — ажилтнууд л (client биш).
  const { results: staffRows } = await db
    .prepare(`SELECT id, full_name, username FROM users WHERE role <> 'client'`)
    .all<{ id: number; full_name: string | null; username: string | null }>();
  const staff = staffRows ?? [];
  const staffIds = new Set(staff.map((u) => u.id));

  // Давхардлын жагсаалтыг нэг удаа уншаад импорт бүрийн дараа шинэчилнэ —
  // нэг батч дотор ижил огноо/багтай хоёр файл хоёулаа орохгүй.
  const existing = await loadExistingReports(db, projectId);
  const results: ImportResult[] = [];
  const now = new Date().toISOString();

  for (const item of items) {
    const key = typeof item.key === 'string' ? item.key : null;
    const fail = (reason: string, duplicate_of?: ExistingReportLite | null) => {
      results.push({ key, ok: false, reason, duplicate_of });
    };

    const fileIds = [...new Set((item.file_ids ?? []).map((f) => String(f).trim()).filter(Boolean))];
    if (fileIds.length > 0 && !root) {
      fail('NOT_LINKED');
      continue;
    }
    if (!isValidDate(item.report_date)) {
      fail('BAD_DATE');
      continue;
    }
    const rawCodes = Array.isArray(item.team_codes) ? item.team_codes : [];
    const codes = [...new Set(rawCodes.map((x) => normalizeTeamCode(String(x))).filter(Boolean))] as string[];
    if (codes.length === 0) {
      fail(rawCodes.length > 0 ? 'UNKNOWN_TEAM' : 'NO_TEAM');
      continue;
    }
    const teams = codes.map((code) => teamByCode.get(code)).filter((t): t is NonNullable<typeof t> => !!t);
    if (teams.length !== codes.length) {
      fail('UNKNOWN_TEAM');
      continue;
    }

    // Файлууд: энэ хавтсанд амьд, аль хэдийн шийдэгдээгүй.
    const files: LedgerFile[] = [];
    let fileProblem: string | null = null;
    for (const fid of fileIds) {
      const f = await assertFileInRoot(db, root!, fid);
      if (!f) {
        fileProblem = 'FILE_NOT_FOUND';
        break;
      }
      if (f.state) {
        fileProblem = f.state === 'imported' ? 'ALREADY_IMPORTED' : 'IGNORED';
        break;
      }
      files.push(f);
    }
    if (fileProblem) {
      fail(fileProblem);
      continue;
    }

    const dup = softDuplicateOf(existing, item.report_date, codes);
    if (dup && !item.force_duplicate) {
      fail('DUPLICATE', dup);
      continue;
    }

    // Агуулга: хэрэглэгчийн өгсөн утга ТҮРҮҮЛНЭ; хоосон талбарыг docx-оос нөхнө.
    let parsed: ParsedAsrDoc | null = null;
    let docxBytes: Uint8Array | null = null;
    const docx = files.find((f) => f.mime_type === DOCX_MIME);
    if (docx && driveBrowseConfigured(c.env)) {
      try {
        docxBytes = await fetchDocxBytes(c.env, docx.file_id);
        parsed = await parseAsrDocx(docxBytes);
      } catch (err) {
        console.warn('[asr-backfill] docx read failed', docx.file_id, err instanceof Error ? err.message : err);
        parsed = null;
        docxBytes = null;
      }
    }

    const description = norm(item.description) ?? parsed?.description ?? null;
    const docTypes = Array.isArray(item.doc_types)
      ? item.doc_types.filter((k) => typeof k === 'string' && DOC_KINDS.has(k))
      : (parsed?.doc_types ?? []);
    const workNotes: Record<string, string | null> = {};
    for (const code of codes) {
      const specific = item.work_notes && typeof item.work_notes === 'object' ? item.work_notes[code] : undefined;
      workNotes[code] = norm(specific) ?? norm(item.work_note) ?? parsed?.work_note ?? null;
    }
    const legacyDocNoValue = norm(item.legacy_doc_no);
    const legacyAuthor = norm(item.legacy_author_name) ?? parsed?.sig_site_name ?? parsed?.sig_arch_name ?? null;
    const explicitAuthor = Number(item.author_user_id);
    const authorId =
      Number.isFinite(explicitAuthor) && staffIds.has(explicitAuthor)
        ? explicitAuthor
        : (matchLegacyAuthor(legacyAuthor, staff) ?? user.sub);
    const shifr = norm(item.shifr) ?? parsed?.shifr ?? null;

    // Зураг: docx-ийн зургийг MEDIA_BUCKET руу — байршуулах route-ийн яг тэр
    // түлхүүрийн хэлбэр (`<sub>-<ms>-<rand>-<name>`), `/media/<нэг сегмент>`.
    const photos: { url: string; name: string }[] = [];
    if (docxBytes && parsed && item.import_photos !== false && parsed.photo_rids.length > 0) {
      try {
        const images = await extractDocxImages(docxBytes, parsed.photo_rids);
        for (const img of images.slice(0, 20)) {
          const rand = crypto.randomUUID().replace(/-/g, '').slice(0, 12);
          const safe = img.name.replace(/[^a-zA-Z0-9.-]/g, '_');
          const keyName = `${user.sub}-${Date.now()}-${rand}-legacy-${safe}`;
          await c.env.MEDIA_BUCKET.put(keyName, img.bytes, { httpMetadata: { contentType: img.mime } });
          photos.push({ url: `/media/${keyName}`, name: img.name });
        }
      } catch (err) {
        console.warn('[asr-backfill] photo extract failed', docx?.file_id, err instanceof Error ? err.message : err);
      }
    }

    const clientUuid = files[0] ? `legacy-drive:${files[0].file_id}` : `legacy-manual:${crypto.randomUUID()}`;
    const sourceLabel = files.map((f) => f.file_name).join(', ');
    const reviewNote = files.length > 0 ? `Нөхөж бүртгэсэн — эх файл: ${sourceLabel}` : 'Нөхөж бүртгэсэн (файлгүй, гараар)';

    let reportId: number;
    try {
      const ins = await db
        .prepare(
          `INSERT INTO author_supervision_reports
             (project_id, client_uuid, seq, doc_no, report_date, shifr, doc_types_json, doc_type_other,
              description, photos_json,
              sig_arch_name, sig_arch_date, sig_site_name, sig_site_date,
              checked_by_name, checked_by_title,
              author_id, status, submitted_at, reviewed_by, reviewed_at, review_note,
              origin, legacy_doc_no, legacy_author_name, imported_by)
           VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'approved', ?, ?, ?, ?, 'legacy', ?, ?, ?)`,
        )
        .bind(
          projectId,
          clientUuid,
          legacyDocNoValue, // doc_no = ТҮР (файлын дугаар) — доорх renumberAsrProject DASR-<баг>-NNN болгоно
          item.report_date,
          shifr,
          JSON.stringify(docTypes),
          norm(item.doc_type_other),
          description,
          JSON.stringify(photos),
          norm(item.sig_arch_name) ?? parsed?.sig_arch_name ?? null,
          isValidDate(item.sig_arch_date) ? item.sig_arch_date : (parsed?.sig_arch_date ?? null),
          norm(item.sig_site_name) ?? parsed?.sig_site_name ?? null,
          isValidDate(item.sig_site_date) ? item.sig_site_date : (parsed?.sig_site_date ?? null),
          norm(item.checked_by_name) ?? parsed?.checked_by ?? null,
          null,
          authorId,
          `${item.report_date}T00:00:00.000Z`,
          user.sub,
          now,
          reviewNote,
          legacyDocNoValue,
          legacyAuthor,
          user.sub,
        )
        .run();
      reportId = Number(ins.meta.last_row_id);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // client_uuid UNIQUE — ижил файлаар үүссэн тайлан аль хэдийн байна.
      fail(/UNIQUE|constraint/i.test(msg) ? 'ALREADY_IMPORTED' : 'INSERT_FAILED');
      continue;
    }

    const stmts: D1PreparedStatement[] = [];
    teams.forEach((t, i) => {
      stmts.push(
        db
          .prepare(
            `INSERT INTO author_supervision_report_teams (report_id, team_id, work_note, sort_order)
             VALUES (?, ?, ?, ?)`,
          )
          .bind(reportId, t.id, workNotes[t.code.toUpperCase()] ?? null, i),
      );
    });
    for (const f of files) {
      stmts.push(
        db
          .prepare(
            `INSERT INTO asr_legacy_sources
               (drive_file_id, root_folder_id, file_name, mime_type, project_id, report_id, state, decided_by)
             VALUES (?, ?, ?, ?, ?, ?, 'imported', ?)`,
          )
          .bind(f.file_id, root!, f.file_name, f.mime_type, projectId, reportId, user.sub),
      );
    }
    try {
      await db.batch(stmts);
    } catch (err) {
      // Файлын UNIQUE мөргөлдөөн (зэрэг хоёр импорт) — тайланг буцааж устгана.
      await db.prepare('DELETE FROM author_supervision_reports WHERE id = ?').bind(reportId).run();
      const msg = err instanceof Error ? err.message : String(err);
      fail(/UNIQUE|constraint/i.test(msg) ? 'ALREADY_IMPORTED' : 'INSERT_FAILED');
      continue;
    }

    existing.push({ id: reportId, doc_no: legacyDocNoValue, report_date: item.report_date, team_codes: codes.join(',') });
    results.push({ key, ok: true, report_id: reportId, photos: photos.length, author_id: authorId, author_matched: authorId !== user.sub });
  }

  const imported = results.filter((r) => r.ok).length;
  // Нөхсөн тайлангууд огноогоороо багийн дараалалд орж, хойшхи тайлангуудын
  // дугаар шилжинэ (эзний шийдвэр 2026-09-29).
  if (imported > 0) await renumberAsrProject(db, projectId);
  return c.json({ results, imported });
});

/* ------------------------------------------------------------------ */
/*  POST /backfill/main/:mainId/ignore — «энэ тайлан биш» / буцаах     */
/* ------------------------------------------------------------------ */

router.post('/backfill/main/:mainId/ignore', async (c) => {
  const db = c.env.DB;
  const user = c.get('user');
  const mainId = Number(c.req.param('mainId'));
  if (!Number.isFinite(mainId)) return c.json({ error: 'Invalid id' }, 400);
  const main = await loadMain(db, mainId);
  if (!main) return c.json({ error: 'Not found' }, 404);
  const root = main.google_drive_folder_id?.trim() || null;
  if (!root) return c.json({ error: 'Drive хавтас холбогдоогүй.', code: 'NOT_LINKED' }, 409);

  const body = await c.req
    .json<{ file_ids?: string[]; ignore?: boolean; note?: string }>()
    .catch(() => ({}) as { file_ids?: string[]; ignore?: boolean; note?: string });
  const fileIds = [...new Set((body.file_ids ?? []).map((f) => String(f).trim()).filter(Boolean))];
  if (fileIds.length === 0) return c.json({ error: 'file_ids is required' }, 400);
  const ignore = body.ignore !== false;

  const stmts: D1PreparedStatement[] = [];
  let skipped = 0;
  for (const fid of fileIds) {
    const f = await assertFileInRoot(db, root, fid);
    if (!f) {
      skipped++;
      continue;
    }
    if (ignore) {
      if (f.state === 'imported') {
        skipped++;
        continue;
      }
      stmts.push(
        db
          .prepare(
            `INSERT INTO asr_legacy_sources
               (drive_file_id, root_folder_id, file_name, mime_type, project_id, report_id, state, decided_by, note)
             VALUES (?, ?, ?, ?, NULL, NULL, 'ignored', ?, ?)
             ON CONFLICT(drive_file_id) DO UPDATE SET state = 'ignored', decided_by = excluded.decided_by,
               decided_at = datetime('now'), note = excluded.note`,
          )
          .bind(f.file_id, root, f.file_name, f.mime_type, user.sub, norm(body.note)),
      );
    } else {
      // Зөвхөн «алгассан» мөрийг буцаана — импортлогдсоныг энэ замаар хөндөхгүй
      // (тайланг устгавал CASCADE-аар өөрөө буцна).
      stmts.push(
        db
          .prepare(`DELETE FROM asr_legacy_sources WHERE drive_file_id = ? AND state = 'ignored'`)
          .bind(f.file_id),
      );
    }
  }
  if (stmts.length > 0) await db.batch(stmts);
  return c.json({ ok: true, changed: stmts.length, skipped });
});

/* ------------------------------------------------------------------ */
/*  POST /backfill/main/:mainId/target — ЗХ төсөл үүсгэж харьяалуулах   */
/* ------------------------------------------------------------------ */
/**
 * Гишүүн төсөлгүй үндсэн төсөл (LUXWOOD, WISDOM TOWER …) — `asr_only` төсөл
 * үүсгэж (`lib/asrTargets.ts`-ийн `POST /targets`-тай ижил мөр) `main_project_id`-г
 * шууд заана.  Нэр өгөгдмөл = үндсэн төслийн нэр.
 */
router.post('/backfill/main/:mainId/target', async (c) => {
  const db = c.env.DB;
  const user = c.get('user');
  const mainId = Number(c.req.param('mainId'));
  if (!Number.isFinite(mainId)) return c.json({ error: 'Invalid id' }, 400);
  const main = await loadMain(db, mainId);
  if (!main) return c.json({ error: 'Not found' }, 404);

  const body = await c.req
    .json<{ name?: string; shifr?: string }>()
    .catch(() => ({}) as { name?: string; shifr?: string });
  const name = norm(body.name) ?? main.name;
  const shifr = norm(body.shifr);

  const ins = await db
    .prepare(
      `INSERT INTO projects (name, category, asr_only, created_by, status, main_project_id)
       VALUES (?, 'ZA', 1, ?, 'active', ?)`,
    )
    .bind(name, user.sub, mainId)
    .run();
  const id = Number(ins.meta.last_row_id);
  await seedZaShares(db, id);
  if (shifr) {
    await db
      .prepare(`INSERT INTO project_passport (project_id, drawing_no, updated_by_id) VALUES (?, ?, ?)`)
      .bind(id, shifr, user.sub)
      .run();
  }
  const members = await loadMembers(db, mainId);
  return c.json({ project_id: id, members }, 201);
});

/* ------------------------------------------------------------------ */
/*  GET /backfill/report/:reportId/sources — тайлангийн эх файлууд      */
/* ------------------------------------------------------------------ */

router.get('/backfill/report/:reportId/sources', async (c) => {
  const id = Number(c.req.param('reportId'));
  if (!Number.isFinite(id)) return c.json({ error: 'Invalid id' }, 400);
  const { results } = await c.env.DB.prepare(
    `SELECT drive_file_id, file_name, mime_type, decided_at
       FROM asr_legacy_sources WHERE report_id = ? AND state = 'imported' ORDER BY file_name`,
  )
    .bind(id)
    .all<{ drive_file_id: string; file_name: string; mime_type: string | null; decided_at: string }>();
  return c.json({
    sources: (results ?? []).map((s) => ({ ...s, view_url: driveViewUrl(s.drive_file_id) })),
  });
});

export default router;
