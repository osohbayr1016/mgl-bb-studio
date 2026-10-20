import { Hono } from 'hono';
import type { Env, AppVariables, UserRole } from '../types';
import { requireRole, requireAdmin } from '../middleware/auth';
import { revitLegacyTokenGuard } from '../middleware/revitLegacyTokenGuard';
import { foldText } from '../lib/textFold';
import {
  resolveTeamContext,
  scopesFor,
  complianceEnabled,
  evidenceOf,
  isTeamCodeShape,
  TIER_CONFIDENCE,
  type TeamDecision,
  type TeamResolution,
} from '../lib/teamContext';
import { isSingleSegmentMediaUrl } from '../lib/mediaUrl';
import { todayInUB } from '../lib/time';
import { suggestBinding, checklistTextForSheet, type SheetInput } from '../lib/revitMatch';
import { CEILING, COMPLETE, deriveSuggestedPercent, verifySubmittedPercent } from '../lib/revitProgress';
import {
  isOpenTask,
  mglCodeIn,
  pickRegistration,
  suggestProjects,
  type ProjectCandidate,
  type ProjectSuggestion,
  type WorkRegistration,
} from '../lib/revitWorkContext';
import { latestApprovedPctByDate } from '../lib/progressLatest';
import { TAKE_REQUIRED_MESSAGE } from '../lib/taskTake';
import { parseProjectName } from '../lib/mainProjects';
import { parseCompletionQuestions } from '../lib/taskCompletionAi';
import {
  generateRevitNote,
  REVIT_NOTE_PROMPT_VERSION,
  type ChangeGroupFact,
} from '../lib/revitNoteAi';
import { submitProgressEntry, ctxOf } from './progress';
import { contractHeaders, convertedPartBody, isManagedTask, managedRootBody, retiredIntoRoot } from '../lib/taskAllocGate';
import { resolveReportDate, cleanActiveMs } from '../lib/revitTracking';
import { syncRepairDayIfMarked } from '../lib/repairDayStore';
import {
  sanitizeTurn,
  resolveProvider,
  runAgentTurn,
  MAX_TURNS_PER_HOUR,
  REVIT_AGENT_PROMPT_VERSION,
} from '../lib/revitAgent';
import {
  ASSISTANT_LOG_COLUMN_SQL,
  ASSISTANT_LOG_ROWS_PER_STATEMENT,
  ASSISTANT_LOG_TUPLE,
  buildTimingJson,
} from '../lib/assistantLogInsert';
import {
  ASSISTANT_EXAMPLE_COLUMN_SQL,
  ASSISTANT_EXAMPLE_CONFLICT_TARGET,
  ASSISTANT_EXAMPLE_ROWS_PER_STATEMENT,
  ASSISTANT_EXAMPLE_TUPLE,
  CLIENT_REVIEW_STATES,
  CURATION_ACTIONS,
  deriveSourceType,
  resolveExampleTeam,
  type CurationAction,
} from '../lib/assistantExampleInsert';
import {
  BULK_IDS_PER_STATEMENT,
  BULK_REVIEW_CAP,
  blockRejectedExamples,
  chunkIds,
  eligibleIds,
  exampleKey,
  isBulkAction,
  parseBulkIds,
  planBulkReview,
  settleBulkReview,
  summarizeBulkResults,
  toWireResults,
  type BulkLogRow,
  type BulkVerifyRow,
} from '../lib/assistantBulkReview';

/**
 * Revit 2027 add-in ↔ вэбийн ГҮҮР.
 *
 * Урсгал:
 *   1. POST /handshake      — .rvt файлыг төсөлтэй холбож, хуудас бүрт
 *                             зураг/ажлыг САНАЛ болгоно (юуг ч батлахгүй).
 *   2. PUT  /bindings       — инженер саналыг батална; хүсвэл хуудас бүрээр
 *                             дэд жагсаалт АВТОМАТААР үүснэ.
 *   3. GET  /context        — панель өнөөдрийн байдлыг уншина.
 *   4. POST /draft          — хувь + монгол тэмдэглэлийн НООРОГ (бичихгүй).
 *   5. POST /submissions    — ЦОРЫН ГАНЦ бичих гарц.
 *
 * ⚠️ ЭНЭ ФАЙЛ ЯВЦЫН МАТЕМАТИКИЙГ ДАХИН БИЧДЭГГҮЙ.  Бүх бичилт нь
 * `progress.ts`-ийн `submitProgressEntry`-ээр дамжина — эрхийн шалгалт,
 * `completion_qa`, оноо, архивлалт, мэдэгдэл бүгд тэндээс ижилхэн ажиллана.
 * Rollup-ийн 11 хуулбарын аль нь ч энд хуулагдаагүй.
 *
 * Эрх: router-ийн gate нь `POST /api/progress`-ийн ЯГ ИЖИЛ дөрвөн үүрэг.
 * `client` ба `worker` энд хүрэхгүй (`workerScope.ts` нь хаалттай-анхдагч
 * зөвшөөрлийн жагсаалт тул `/api/revit` түүнд автоматаар 403).
 */
const REVIT_ROLES: UserRole[] = ['engineer', 'architect', 'senior', 'admin'];

/** Нэг handshake-д зөвшөөрөх дээд хуудас.  Бодит төсөл ~30-200. */
const MAX_SHEETS = 500;
/** Нэг PUT /bindings-д зөвшөөрөх дээд мөр. */
const MAX_BINDING_ITEMS = 200;
/** Текстийн дээд урт — DB-д хэт урт мөр орохоос сэргийлнэ. */
const MAX_STR = 256;

/**
 * `revit_sheet_bindings`-ийн upsert-д НЭГ мөрөнд ногдох bind.
 * ⚠️ Багана нэмбэл ЭНЭ ТООГ ЗАСАХ ЁСТОЙ — D1-ийн нэг statement 100 bind-аар
 * хязгаарлагдана.  `qto.ts`-ийн 4 fact × 21 bind-тай ижил төрлийн гар тохируулга,
 * гэхдээ энд мөрийн тоог КОДООС гаргаж авдаг тул алдах магадлал бага.
 */
const BINDS_PER_BINDING_ROW = 13;
const BINDING_ROWS_PER_STATEMENT = Math.floor(100 / BINDS_PER_BINDING_ROW); // = 7

/** `tasks.ts:701-702`-тай ИЖИЛ хязгаар — дэд жагсаалтын дүрэм нэг байх ёстой. */
const MAX_CHECKLIST_TEXT = 300;
const MAX_CHECKLIST_ITEMS = 50;

/**
 * Нэг statement-д хэдэн ID-г `IN (...)`-д хийхийг зөвшөөрөх вэ.  D1-ийн нэг
 * statement 100 bind-аар хязгаарлагдана; 50 нь `user_id`-тай хамт ч аюулгүй.
 */
const IDS_PER_STATEMENT = 50;

/**
 * `/context`-ийн буцаах ажлын дээд тоо.  Нэг хүн нэг төсөлд ийм олон ажилтай
 * байх нь ховор — хязгаар нь зөвхөн самбарын жагсаалт хэт томрохоос сэргийлнэ.
 */
const MAX_CONTEXT_TASKS = 60;

const revit = new Hono<{ Bindings: Env; Variables: AppVariables }>();

revit.use('*', requireRole(...REVIT_ROLES));
// 365 хоногийн `mcp` токеныг шат шатаар хаах бодлого (migration 0375; `revit.legacy_token_policy`).
revit.use('*', revitLegacyTokenGuard);

/* ------------------------------------------------------------------ */
/*  Туслах функцууд                                                    */
/* ------------------------------------------------------------------ */

function str(v: unknown, max = MAX_STR): string {
  const s = typeof v === 'string' ? v.trim() : '';
  return s.length > max ? s.slice(0, max) : s;
}

/**
 * Клиентийн ISO-8601 цаг.  Хэлбэр буруу бол NULL — хог утга DB-д оруулахгүй.
 * ⚠️ Утгыг ЗАСАХГҮЙ (clamp хийхгүй): ажилтны PC-ийн цаг буруу байх нь
 * ӨӨРӨӨ мэдэх ёстой баримт.  `created_at` үргэлж найдвартай хэвээр байна.
 * ⚠️ Мөрийг ТАТГАЛЗАХГҮЙ, зөвхөн энэ талбарыг NULL болгоно —
 * `AssistantLog.cs:49-52`: бүртгэл нь чат ажиллахад саад болох ЁСГҮЙ.
 */
function isoTs(v: unknown): string | null {
  const s = str(v, 40);
  if (!s) return null;
  const t = Date.parse(s);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

function isManager(role: string): boolean {
  return role === 'admin' || role === 'senior';
}

/**
 * ЖИНХЭНЭ эерэг бүхэл id, эсвэл NULL.
 *
 * ⚠️ ЯАГААД `Number(v)` БИШ ВЭ (1B аудит, P1): `Number(null)` ба `Number('')`
 * нь **0**, `Number(true)` нь **1** — гурвуулаа `Number.isInteger`-ыг
 * ДАВНА.  Тиймээс хуучин `Number.isInteger(Number(e.log_id))` шалгалт нь
 * `log_id: null` илгээсэн клиентийг «id = 0» гэж хүлээж авч, `origin_log_id`
 * / `source_log_id`-д ОРШИН БАЙХГҮЙ бүртгэлийн холбоос бичдэг байв.  D1 нь
 * ажиллах үед гадаад түлхүүрийг ШАЛГАДАГГҮЙ тул тэр хог холбоос ЧИМЭЭГҮЙ
 * хадгалагдана — ба `log_ids: [true]` нь мөр id = 1 гэсэн БОДИТ бүртгэлийг
 * «татгалзсан» гэж хаах хүртэл явна.
 *
 * `> 0` нь заавал: AUTOINCREMENT id хэзээ ч 0 биш, сөрөг ч биш.
 */
function posId(v: unknown): number | null {
  return typeof v === 'number' && Number.isInteger(v) && v > 0 ? v : null;
}

/** JSON массиваас ЖИНХЭНЭ id-уудыг шүүнэ (`posId`-ийн багц хувилбар). */
function idList(v: unknown, max: number): number[] {
  if (!Array.isArray(v)) return [];
  const out: number[] = [];
  for (const raw of v) {
    const n = posId(raw);
    if (n !== null) out.push(n);
    if (out.length >= max) break;
  }
  return out;
}

/** Хэрэглэгч тухайн ТӨСӨЛД хандах эрхтэй эсэх (admin/senior ҮРГЭЛЖ тийм). */
async function canAccessProject(
  db: D1Database,
  user: { sub: number; role: string },
  projectId: number,
): Promise<boolean> {
  if (isManager(user.role)) return true;
  const row = await db
    .prepare(
      `SELECT 1 AS ok FROM project_members WHERE project_id = ? AND user_id = ?
       UNION ALL
       SELECT 1 AS ok
         FROM task_assignees ta
         INNER JOIN tasks t      ON t.id = ta.task_id
         INNER JOIN components c ON c.id = t.component_id
         INNER JOIN drawings d   ON d.id = c.drawing_id
         INNER JOIN blocks b     ON b.id = d.block_id
        WHERE b.project_id = ? AND ta.user_id = ?
       LIMIT 1`,
    )
    .bind(projectId, user.sub, projectId, user.sub)
    .first<{ ok: number }>();
  return !!row;
}

/** Хэрэглэгч тухайн ажлыг «Өөртөө авах»-аар авч ажилласан эсэх (2026-10-01-ээс
 *  `task_assignees` = ажилласан хүмүүсийн бүртгэл — таймер эхлэх бүрт нэмэгдэнэ).
 *  Хувь илгээх эцсийн хаалт нь `submitProgressEntry`-ийн TAKE_REQUIRED. */
async function isAssigned(db: D1Database, userId: number, taskId: number): Promise<boolean> {
  const row = await db
    .prepare(
      `SELECT t.assigned_to,
              EXISTS (SELECT 1 FROM task_assignees ta
                       WHERE ta.task_id = t.id AND ta.user_id = ?) AS is_member
         FROM tasks t WHERE t.id = ?`,
    )
    .bind(userId, taskId)
    .first<{ assigned_to: number | null; is_member: 0 | 1 }>();
  if (!row) return false;
  return row.is_member === 1 || row.assigned_to === userId;
}

interface DrawingRow {
  id: number;
  name: string;
  block_id: number;
  block_name: string;
}
interface TaskRow {
  id: number;
  name: string;
  drawing_id: number;
}

/** Төслийн бүх зураг + ажил — саналын нэр дэвшигчид. */
async function loadCandidates(
  db: D1Database,
  projectId: number,
): Promise<{ drawings: DrawingRow[]; tasks: TaskRow[] }> {
  // ⚠️ `noUncheckedIndexedAccess` backend-д асаалттай тул batch-ийн үр дүнг
  // индексээр шууд задлахгүй — тодорхой бус (undefined) гэж тооцогдоно.
  const batched = await db.batch([
    db
      .prepare(
        `SELECT d.id, d.name, b.id AS block_id, b.name AS block_name
           FROM drawings d
           INNER JOIN blocks b ON b.id = d.block_id
          WHERE b.project_id = ?
          ORDER BY b.sort_order, d.sort_order`,
      )
      .bind(projectId),
    db
      .prepare(
        `SELECT t.id, t.name, c.drawing_id
           FROM tasks t
           INNER JOIN components c ON c.id = t.component_id
           INNER JOIN drawings d   ON d.id = c.drawing_id
           INNER JOIN blocks b     ON b.id = d.block_id
          WHERE b.project_id = ?`,
      )
      .bind(projectId),
  ]);
  return {
    drawings: (batched[0]?.results ?? []) as unknown as DrawingRow[],
    tasks: (batched[1]?.results ?? []) as unknown as TaskRow[],
  };
}


/* ------------------------------------------------------------------ */
/*  1. POST /handshake — файлыг төсөлтэй холбож, санал болгоно          */
/* ------------------------------------------------------------------ */

interface HandshakeBody {
  project_id?: number;
  doc_uid?: string;
  uid_source?: string;
  file_name?: string;
  revit_version?: string;
  is_link?: boolean;
  sheets?: Array<{ uid?: string; number?: string; name?: string; placed_view_count?: number }>;
}

revit.post('/handshake', async (c) => {
  const user = c.get('user');
  const db = c.env.DB;

  // index.ts-д `app.onError` байхгүй тул JSON-ы алдаа нүцгэн 500 болно —
  // энд өөрсдөө барина.
  const body = await c.req.json<HandshakeBody>().catch(() => null);
  if (!body) return c.json({ error: 'Invalid JSON' }, 400);

  const projectId = Number(body.project_id);
  const docUid = str(body.doc_uid, 128);
  const fileName = str(body.file_name);
  const sheetsRaw = Array.isArray(body.sheets) ? body.sheets : null;

  if (!Number.isInteger(projectId) || !docUid || !fileName || !sheetsRaw) {
    return c.json({ error: 'project_id, doc_uid, file_name and sheets are required' }, 400);
  }
  if (sheetsRaw.length > MAX_SHEETS) {
    return c.json({ error: `Too many sheets (max ${MAX_SHEETS})` }, 413);
  }

  const project = await db
    .prepare('SELECT id, name FROM projects WHERE id = ?')
    .bind(projectId)
    .first<{ id: number; name: string }>();
  if (!project) return c.json({ error: 'Project not found' }, 404);
  if (!(await canAccessProject(db, user, projectId))) {
    return c.json({ error: 'Энэ төсөлд хандах эрхгүй байна' }, 403);
  }

  const sheets: SheetInput[] = sheetsRaw
    .map((s) => ({
      uid: str(s?.uid, 128),
      number: str(s?.number, 64),
      name: str(s?.name),
      placed_view_count: Number.isFinite(Number(s?.placed_view_count))
        ? Math.max(0, Math.trunc(Number(s?.placed_view_count)))
        : 0,
    }))
    .filter((s) => s.uid.length > 0);

  // `doc_uid` нь ТӨСӨЛ ДОТОР өвөрмөц (migration 0187).  Нэг .rte template-ээс
  // үүссэн төслүүд ижил ProjectInformation.UniqueId-тай байх БОДИТ эрсдэлтэй
  // тул глобал өвөрмөц болгоогүй.  Өөр төсөлд ижил uid олдвол зөвхөн МЭДЭЭЛНЭ —
  // template-ийн давхардал бол хэвийн байдал тул урсгалыг ХААХГҮЙ.
  const elsewhere = await db
    .prepare(
      `SELECT id, project_id, file_name FROM revit_documents
        WHERE doc_uid = ? AND project_id <> ? LIMIT 1`,
    )
    .bind(docUid, projectId)
    .first<{ id: number; project_id: number; file_name: string }>();

  let doc = await db
    .prepare(
      `SELECT id, project_id, doc_uid, file_name, is_link, sheet_count
         FROM revit_documents WHERE project_id = ? AND doc_uid = ?`,
    )
    .bind(projectId, docUid)
    .first<{
      id: number;
      project_id: number;
      doc_uid: string;
      file_name: string;
      is_link: number;
      sheet_count: number;
    }>();

  const isLink = body.is_link ? 1 : 0;
  const uidSource = body.uid_source === 'es_stamp' ? 'es_stamp' : 'project_info';

  if (doc) {
    // Файлын нэр солигдсон бол ЗӨВХӨН шинэчилнэ — file_name бол шошго,
    // түлхүүр биш (migration 0187-ийн тайлбар).
    await db
      .prepare(
        `UPDATE revit_documents
            SET file_name = ?, revit_version = ?, is_link = ?, sheet_count = ?,
                last_seen_at = datetime('now'), last_seen_by = ?
          WHERE id = ?`,
      )
      .bind(fileName, str(body.revit_version, 16) || null, isLink, sheets.length, user.sub, doc.id)
      .run();
  } else {
    const ins = await db
      .prepare(
        `INSERT INTO revit_documents
           (project_id, doc_uid, uid_source, file_name, revit_version, is_link,
            sheet_count, created_by, last_seen_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        projectId,
        docUid,
        uidSource,
        fileName,
        str(body.revit_version, 16) || null,
        isLink,
        sheets.length,
        user.sub,
        user.sub,
      )
      .run();
    doc = {
      id: Number(ins.meta.last_row_id),
      project_id: projectId,
      doc_uid: docUid,
      file_name: fileName,
      is_link: isLink,
      sheet_count: sheets.length,
    };
  }

  const { drawings, tasks } = await loadCandidates(db, projectId);

  if (sheets.length > 0) {
    const stmts: D1PreparedStatement[] = [];
    for (let i = 0; i < sheets.length; i += BINDING_ROWS_PER_STATEMENT) {
      const chunk = sheets.slice(i, i + BINDING_ROWS_PER_STATEMENT);
      const values = chunk.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').join(', ');
      const binds: unknown[] = [];
      for (const sh of chunk) {
        const sug = suggestBinding(sh, drawings, tasks);
        binds.push(
          doc.id,
          projectId,
          sh.uid,
          sh.number,
          sh.name,
          sh.placed_view_count ?? 0,
          sug.drawing_id,
          sug.task_id,
          null,
          'suggested',
          sug.match_source,
          sug.confidence,
          null,
        );
      }
      stmts.push(
        db
          .prepare(
            `INSERT INTO revit_sheet_bindings
               (revit_document_id, project_id, sheet_uid, sheet_number, sheet_name,
                placed_view_count, drawing_id, task_id, user_id, status,
                match_source, confidence, bound_by)
             VALUES ${values}
             ON CONFLICT (revit_document_id, sheet_uid, IFNULL(user_id, 0)) DO UPDATE SET
               sheet_number      = excluded.sheet_number,
               sheet_name        = excluded.sheet_name,
               placed_view_count = excluded.placed_view_count,
               last_seen_at      = datetime('now'),
               updated_at        = datetime('now'),
               drawing_id   = CASE WHEN revit_sheet_bindings.status = 'suggested'
                              THEN excluded.drawing_id   ELSE revit_sheet_bindings.drawing_id   END,
               task_id      = CASE WHEN revit_sheet_bindings.status = 'suggested'
                              THEN excluded.task_id      ELSE revit_sheet_bindings.task_id      END,
               match_source = CASE WHEN revit_sheet_bindings.status = 'suggested'
                              THEN excluded.match_source ELSE revit_sheet_bindings.match_source END,
               confidence   = CASE WHEN revit_sheet_bindings.status = 'suggested'
                              THEN excluded.confidence   ELSE revit_sheet_bindings.confidence   END`,
          )
          .bind(...binds),
      );
    }
    await db.batch(stmts);
  }

  /* --- `revit_documents.team_code` — 0187:30-ын БИЧИГЧГҮЙ нүхийг дүүргэнэ -- */
  //
  // ⚠️ ЗӨВХӨН ОДООГИЙН УТГА NULL БАЙВАЛ.  Хүний бичсэн утгыг (`sticky`
  //    verify) ХЭЗЭЭ Ч дарж бичихгүй — эс бөгөөс §73-ын залруулга файл нээх
  //    бүрт устана.  `AND team_code IS NULL` нь тэр гэрээг ГҮЙЛГЭЭНИЙ
  //    түвшинд барина, дараалсан хоёр handshake ч уралдаж чадахгүй.
  //
  // ⛔ ХҮНЭЭС ГАРСАН ШАТААР ХЭЗЭЭ Ч БИЧИХГҮЙ (`user_primary`, `binding`).
  //    `revit_documents` нь БАРИМТЫН шинж чанар бөгөөд нэг .rvt-г олон
  //    салбарын инженер хуваалцдаг (`AssistantPane.xaml.cs:246-253`).  Эхний
  //    нээсэн BA-гийн архитектор «BA» гэж тамгалбал тэр нь дараа нь 1b шат
  //    (0.95, ХҮНЭЭС ГАРААГҮЙ) болж, тэр файлыг нээсэн БҮХ цахилгаанчинг
  //    зөрчилд оруулна — яг R5-ийн эвдрэлийн хэлбэр.  `project_shares` нь
  //    хэрэглэгчээс ХАМААРАЛГҮЙ цорын ганц шат тул зөвхөн тэр бичигдэнэ.
  const docTeam = await db
    .prepare('SELECT team_code FROM revit_documents WHERE id = ?')
    .bind(doc.id)
    .first<{ team_code: string | null }>();
  if (!docTeam?.team_code) {
    const hs = await resolveTeamContext(db, {
      userId: user.sub,
      projectId,
      revitDocumentId: doc.id,
    });
    if (hs.decision.team_code && hs.decision.team_source === 'project_shares') {
      await db
        .prepare('UPDATE revit_documents SET team_code = ? WHERE id = ? AND team_code IS NULL')
        .bind(hs.decision.team_code, doc.id)
        .run();
    }
  }

  const { results: bindingRows } = await db
    .prepare(
      `SELECT rb.id, rb.sheet_uid, rb.sheet_number, rb.sheet_name, rb.placed_view_count,
              rb.drawing_id, rb.task_id, rb.status, rb.match_source, rb.confidence,
              d.name AS drawing_name, t.name AS task_name
         FROM revit_sheet_bindings rb
         LEFT JOIN drawings d ON d.id = rb.drawing_id
         LEFT JOIN tasks    t ON t.id = rb.task_id
        WHERE rb.revit_document_id = ? AND rb.user_id IS NULL
        ORDER BY rb.sheet_number`,
    )
    .bind(doc.id)
    .all();

  return c.json({
    document: {
      id: doc.id,
      project_id: projectId,
      project_name: project.name,
      file_name: fileName,
      is_link: isLink === 1,
      sheet_count: sheets.length,
      uid_source: uidSource,
    },
    same_uid_elsewhere: elsewhere
      ? { project_id: elsewhere.project_id, file_name: elsewhere.file_name }
      : null,
    bindings: bindingRows ?? [],
    candidates: { drawings, tasks },
  });
});


/* ------------------------------------------------------------------ */
/*  Хувийн гаралтыг D1-ЭЭС ДАХИН тооцоолох                             */
/* ------------------------------------------------------------------ */

/**
 * Биеэс ирсэн `suggested_percentage`-д ХЭЗЭЭ Ч итгэхгүй — сервер өөрөө
 * D1-ээс дахин тооцоолно.  Энэ нь `POST /submissions`-ийн таталцах
 * шалгалтын цорын ганц эх сурвалж.
 *
 * ⚠️ 'sheets' шатлалыг ОДООХОНДОО ТЭЖЭЭХГҮЙ.  «Хуудас бэлэн болсон» гэсэн
 * төлөв схемд байхгүй — түүнийг зохиох нь яг тэр «тооцоолсон мэт харагдах
 * зохиомол тоо» болно.  Тиймээс checklist байхгүй бол basis='none' болж,
 * инженер өөрөө бичнэ (шийдвэр ①).  Цэвэр функц нь 'sheets'-ийг дэмждэг тул
 * ирээдүйд бодит дохио гарвал энд нэг мөрөөр залгана.
 */
interface Derivation {
  currentPercent: number;
  result: ReturnType<typeof deriveSuggestedPercent>;
  checklistDone: number;
  checklistTotal: number;
}

/**
 * ОЛОН ажлын гаралтыг ХЭСЭГЛЭЖ уншина.
 *
 * ⚠️ `loadDerivation` нь ЭНЭ функцийн нэг ажилтай тохиолдол — хоёр өөр
 * хувилбар БАЙЖ БОЛОХГҮЙ.  `/context` нь 2026-08-26-наас хойш хэрэглэгчийн
 * БҮХ ажлыг буцаадаг тул ажил тутамд нэг `batch` хийвэл 20 ажил = 20 удаагийн
 * D1 дуудлага болно.
 */
async function loadDerivations(
  db: D1Database,
  userId: number,
  taskIds: readonly number[],
): Promise<Map<number, Derivation>> {
  const out = new Map<number, Derivation>();
  if (taskIds.length === 0) return out;

  const totals = new Map<number, { done: number; total: number }>();
  const current = new Map<number, number>();

  for (let i = 0; i < taskIds.length; i += IDS_PER_STATEMENT) {
    const ids = taskIds.slice(i, i + IDS_PER_STATEMENT);
    const ph = ids.map(() => '?').join(', ');
    const [cl, cur] = await db.batch([
      db
        .prepare(
          `SELECT task_id, COUNT(*) AS total,
                  SUM(CASE WHEN is_done = 1 THEN 1 ELSE 0 END) AS done
             FROM task_checklist_items
            WHERE user_id = ? AND task_id IN (${ph})
            GROUP BY task_id`,
        )
        .bind(userId, ...ids),
      db
        .prepare(
          // ⚠️ Ялгах дараалал (`date → created_at → id`) нь САНААТАЙ.  CLAUDE.md-д
          // «сүүлийн батлагдсан бүртгэл»-ийн ГУРВАН зөрүүтэй хувилбар байдаг гэж
          // тэмдэглэсэн — Revit-ийн урсгал энэ нэгийг л хэрэглэнэ.
          `SELECT t.id AS task_id,
                  (SELECT pe.percentage FROM progress_entries pe
                    WHERE pe.task_id = t.id AND pe.status = 'approved'
                    ORDER BY pe.date DESC, pe.created_at DESC, pe.id DESC
                    LIMIT 1) AS percentage
             FROM tasks t
            WHERE t.id IN (${ph})`,
        )
        .bind(...ids),
    ]);

    for (const r of (cl?.results ?? []) as Array<{
      task_id: number;
      total: number | null;
      done: number | null;
    }>) {
      totals.set(Number(r.task_id), {
        done: Number(r.done ?? 0),
        total: Number(r.total ?? 0),
      });
    }
    for (const r of (cur?.results ?? []) as Array<{
      task_id: number;
      percentage: number | null;
    }>) {
      current.set(Number(r.task_id), Number(r.percentage ?? 0));
    }
  }

  for (const id of taskIds) {
    const cl = totals.get(id) ?? { done: 0, total: 0 };
    const currentPercent = current.get(id) ?? 0;
    out.set(id, {
      currentPercent,
      result: deriveSuggestedPercent({
        checklistDone: cl.done,
        checklistTotal: cl.total,
        currentPercent,
      }),
      checklistDone: cl.done,
      checklistTotal: cl.total,
    });
  }
  return out;
}

/** Нэг ажлын гаралт — `/draft` ба `/submissions`-ийн хэрэглэдэг хэлбэр. */
async function loadDerivation(
  db: D1Database,
  userId: number,
  taskId: number,
): Promise<Derivation> {
  const map = await loadDerivations(db, userId, [taskId]);
  return (
    map.get(taskId) ?? {
      currentPercent: 0,
      result: deriveSuggestedPercent({
        checklistDone: 0,
        checklistTotal: 0,
        currentPercent: 0,
      }),
      checklistDone: 0,
      checklistTotal: 0,
    }
  );
}

/* ------------------------------------------------------------------ */
/*  2. PUT /bindings — саналыг батлах + дэд жагсаалт АВТОМАТААР үүсгэх  */
/* ------------------------------------------------------------------ */

interface BindingItem {
  sheet_uid?: string;
  drawing_id?: number | null;
  task_id?: number | null;
  status?: string;
}

revit.put('/bindings', async (c) => {
  const user = c.get('user');
  const db = c.env.DB;

  const body = await c.req
    .json<{ revit_document_id?: number; items?: BindingItem[]; seed_checklist?: boolean }>()
    .catch(() => null);
  if (!body) return c.json({ error: 'Invalid JSON' }, 400);

  const docId = Number(body.revit_document_id);
  const items = Array.isArray(body.items) ? body.items : null;
  if (!Number.isInteger(docId) || !items) {
    return c.json({ error: 'revit_document_id and items are required' }, 400);
  }
  if (items.length > MAX_BINDING_ITEMS) {
    return c.json({ error: `Too many items (max ${MAX_BINDING_ITEMS})` }, 413);
  }

  const doc = await db
    .prepare('SELECT id, project_id FROM revit_documents WHERE id = ?')
    .bind(docId)
    .first<{ id: number; project_id: number }>();
  if (!doc) return c.json({ error: 'Revit document not found' }, 404);
  if (!(await canAccessProject(db, user, doc.project_id))) {
    return c.json({ error: 'Энэ төсөлд хандах эрхгүй байна' }, 403);
  }

  // Батлах гэж буй ажил бүрд хуваарилагдсан эсэхийг ШАЛГАНА (менежерээс бусад).
  // Нэг ч зөрчилтэй мөр байвал БҮГДИЙГ татгалзана — хагас хадгалалт хийхгүй.
  const confirmed = items.filter((it) => (it.status ?? 'confirmed') === 'confirmed');
  if (!isManager(user.role)) {
    for (const it of confirmed) {
      const taskId = Number(it.task_id);
      if (!Number.isInteger(taskId)) continue;
      if (!(await isAssigned(db, user.sub, taskId))) {
        return c.json({ error: TAKE_REQUIRED_MESSAGE, code: 'TAKE_REQUIRED', task_id: taskId }, 403);
      }
    }
  }

  let saved = 0;
  let ignored = 0;
  const stmts: D1PreparedStatement[] = [];
  for (const it of items) {
    const sheetUid = str(it.sheet_uid, 128);
    if (!sheetUid) continue;
    const status = it.status === 'ignored' ? 'ignored' : 'confirmed';
    if (status === 'ignored') ignored++;
    else saved++;
    stmts.push(
      db
        .prepare(
          `UPDATE revit_sheet_bindings
              SET drawing_id = ?, task_id = ?, status = ?, match_source = 'manual',
                  confidence = 1.0, bound_by = ?, bound_at = datetime('now'),
                  updated_at = datetime('now')
            WHERE revit_document_id = ? AND sheet_uid = ? AND user_id IS NULL`,
        )
        .bind(
          it.drawing_id ?? null,
          it.task_id ?? null,
          status,
          user.sub,
          docId,
          sheetUid,
        ),
    );
  }
  if (stmts.length > 0) await db.batch(stmts);

  // --- Дэд жагсаалтыг АВТОМАТААР үүсгэх --------------------------------
  // MGL-ийн инженерүүд дэд жагсаалт ГАРААР бичдэггүй (2026-08-24).  Тиймээс
  // хуудас бүрийг нэг мөр болгож ЭНД үүсгэнэ — хэн ч зуршлаа өөрчлөхгүйгээр
  // `done/total` гэсэн БОДИТ хуваарь бий болно.
  const seeded: Array<{ task_id: number; added: number; total: number }> = [];
  if (body.seed_checklist) {
    const byTask = new Map<number, string[]>();
    for (const it of confirmed) {
      const taskId = Number(it.task_id);
      const sheetUid = str(it.sheet_uid, 128);
      if (!Number.isInteger(taskId) || !sheetUid) continue;
      const list = byTask.get(taskId) ?? [];
      list.push(sheetUid);
      byTask.set(taskId, list);
    }

    for (const [taskId, uids] of byTask) {
      const { results: rows } = await db
        .prepare(
          `SELECT sheet_uid, sheet_number, sheet_name FROM revit_sheet_bindings
            WHERE revit_document_id = ? AND user_id IS NULL AND status = 'confirmed'
              AND task_id = ?
            ORDER BY sheet_number`,
        )
        .bind(docId, taskId)
        .all<{ sheet_uid: string; sheet_number: string; sheet_name: string }>();

      const existing = await db
        .prepare(
          `SELECT text FROM task_checklist_items WHERE task_id = ? AND user_id = ?`,
        )
        .bind(taskId, user.sub)
        .all<{ text: string }>();
      const have = new Set((existing.results ?? []).map((r) => r.text));

      let order = have.size;
      let added = 0;
      const ins: D1PreparedStatement[] = [];
      for (const r of rows ?? []) {
        if (have.size + added >= MAX_CHECKLIST_ITEMS) break;
        const text = checklistTextForSheet(
          { uid: r.sheet_uid, number: r.sheet_number, name: r.sheet_name },
          MAX_CHECKLIST_TEXT,
        );
        if (have.has(text)) continue;
        have.add(text);
        ins.push(
          db
            .prepare(
              `INSERT INTO task_checklist_items (task_id, user_id, text, sort_order)
               VALUES (?, ?, ?, ?)`,
            )
            .bind(taskId, user.sub, text, order++),
        );
        added++;
      }
      if (ins.length > 0) await db.batch(ins);
      seeded.push({ task_id: taskId, added, total: have.size });
      void uids;
    }
  }

  return c.json({ saved, ignored, checklist_seeded: seeded });
});

/* ------------------------------------------------------------------ */
/*  2б. БАГИЙН КОНТЕКСТ — §48 автомат илрүүлэлт, §73 буцаагдах засвар   */
/* ------------------------------------------------------------------ */

/**
 * ⚠️ ЭДГЭЭР ГАРЦ БҮР `/api/revit` ДОР СУУНА, ЗОРИУДААР.  Тэр router нь
 * `purpose:'mcp'` токеныг аль хэдийн хүлээж авдаг, `lib/modules.ts`-ийн
 * `API_PREFIXES` × `MODULE_OF`-д ангилагдсан, `lib/workerScope.ts`-д
 * БАЙХГҮЙ тул `worker` автоматаар 403.  Шинэ дээд түвшний угтвар нэмбэл
 * гурвуулангийн ажлыг ГАРААР давтах ёстой болно.
 */

/**
 * `project_id` — query string (мөр) БОЛОН JSON body (тоо) хоёуланд.
 *
 * ⚠️ `posId` нь `typeof v === 'number'`-ийг шаарддаг тул query параметрт
 * ХЭЗЭЭ Ч тохирохгүй.  `Number('')` = 0, `Number(null)` = 0 тул `> 0`
 * шалгалт нь ЗААВАЛ (`posId`-ийн толгойн 1B аудитын шалтгаан).
 */
function teamProjectId(v: unknown): number | null {
  const n = typeof v === 'string' ? Number(v) : typeof v === 'number' ? v : Number.NaN;
  return Number.isInteger(n) && n > 0 ? n : null;
}

/** `revit_documents`-ийн хөнгөн мөр — багийн шатанд хэрэгтэй хэсэг нь л. */
interface TeamDocRow {
  id: number;
  project_id: number;
  team_code: string | null;
}

/**
 * `doc_uid` (+ сонголттой `project_id`) → баримт.
 *
 * ⚠️ ХЭЗЭЭ Ч ШИДЭХГҮЙ, ХЭЗЭЭ Ч 404 ӨГӨХГҮЙ — бүртгэгдээгүй баримт нь
 * багийн хувьд `null` бөгөөд шат нь хүн дээр тулгуурлан үргэлжилнэ
 * (§2.8: `/context:792`-ийн 404 нь энэ гарцад ХОРИОТОЙ).
 */
async function findTeamDoc(
  db: D1Database,
  docUid: string,
  projectId: number | null,
): Promise<TeamDocRow | null> {
  if (!docUid) return null;
  const sql =
    projectId !== null
      ? `SELECT id, project_id, team_code FROM revit_documents
          WHERE doc_uid = ? AND project_id = ? LIMIT 1`
      : `SELECT id, project_id, team_code FROM revit_documents
          WHERE doc_uid = ? ORDER BY last_seen_at DESC LIMIT 1`;
  const binds = projectId !== null ? [docUid, projectId] : [docUid];
  return await db
    .prepare(sql)
    .bind(...binds)
    .first<TeamDocRow>();
}

/** §73-ын АМЬД (superseded БИШ) хүний баталгаажуулалт. */
interface LiveAttribution {
  id: number;
  verified_team_code: string | null;
  verified_at: string | null;
}

/**
 * Энэ хэрэглэгчийн ХАМГИЙН СҮҮЛИЙН амьд баталгаажуулалт.
 *
 * ⚠️ Хамрах хүрээ: тухайн БАРИМТ дээрх мөр, эсвэл баримтгүй (сессийн)
 * мөр.  ӨӨР баримтын залруулга ЭНД урсахгүй — нэг инженер BA-гийн файл
 * дээр «BA» гэж зассан нь IZ-ийн файлыг BA болгох ЁСГҮЙ.
 */
async function liveVerification(
  db: D1Database,
  userId: number,
  revitDocumentId: number | null,
): Promise<LiveAttribution | null> {
  return await db
    .prepare(
      `SELECT id, verified_team_code, verified_at
         FROM team_attributions
        WHERE user_id = ?
          AND superseded_at IS NULL
          AND verified_team_code IS NOT NULL
          AND COALESCE(revit_document_id, -1) IN (-1, COALESCE(?, -1))
        ORDER BY id DESC
        LIMIT 1`,
    )
    .bind(userId, revitDocumentId)
    .first<LiveAttribution>();
}

interface TeamContextView {
  team_code: string | null;
  team_confidence: number;
  team_source: string;
  team_last_verified: string | null;
  conflict: string[] | null;
  candidates: Array<{ team_code: string; source: string; confidence: number }>;
  scopes: string[];
  /**
   * ⚠️ ГУРВАН УТГАТАЙ.  `true` = багцтай, `false` = ЭНЭ багт багц алга
   * (MGMT / EZ / GT), `null` = дүрмийн бүртгэл ХООСОН (эсвэл `rules`
   * хараахан хэрэгжээгүй) тул шүүх зүйл АЛГА.  `false` ба `null` хоёрыг
   * ХОЛИХ нь «багц хаана ч алга»-г «энэ баг гологдсон» болгож харагдуулна.
   */
  compliance_enabled: boolean | null;
  attribution_id: number | null;
}

/**
 * Шатны үр дүн + §73-ын хүний баталгаажуулалтыг НЭГТГЭНЭ.
 *
 * ⚠️ ХҮН ҮРГЭЛЖ ЯЛНА.  Амьд баталгаажуулалт байвал `team_source` нь
 * `'manual'`, итгэлцэл 1.00 — шатны үр дүн ЗӨВХӨН `candidates`-д үлдэнэ.
 */
function mergeVerification(d: TeamDecision, live: LiveAttribution | null): TeamDecision {
  const code = live?.verified_team_code ?? null;
  if (!code || !isTeamCodeShape(code)) return d;
  return {
    team_code: code,
    team_confidence: TIER_CONFIDENCE.manual,
    team_source: 'manual',
    conflict: null,
    candidates: d.candidates,
  };
}

function teamView(
  res: TeamResolution,
  decision: TeamDecision,
  live: LiveAttribution | null,
): TeamContextView {
  return {
    team_code: decision.team_code,
    team_confidence: decision.team_confidence,
    team_source: decision.team_source,
    team_last_verified: live?.verified_at ?? null,
    conflict: decision.conflict,
    candidates: decision.candidates.map((x) => ({
      team_code: x.team_code,
      source: x.source,
      confidence: x.confidence,
    })),
    scopes: scopesFor(decision, res.packedTeamCodes),
    // ⚠️ `undefined` → `null`, `false` БИШ (дээрх тайлбар).
    compliance_enabled:
      res.packedTeamCodes === undefined
        ? null
        : complianceEnabled(decision, res.packedTeamCodes),
    attribution_id: live?.id ?? null,
  };
}

/**
 * GET /api/revit/team-context — самбарын chip-ийн ЦОРЫН ГАНЦ эх сурвалж.
 *
 * ⚠️ ХЭЗЭЭ Ч 404 ӨГӨХГҮЙ (§2.8).  Бүртгэгдээгүй баримт бол шат нь хүн дээр
 * тулгуурлаж үргэлжилнэ; хамгийн муудаа `team_source: 'uncertain'`.
 * ⚠️ ЮУ Ч БИЧИХГҮЙ.  Залруулга нь ЗӨВХӨН `POST /team-context/verify`.
 * ⚠️ `hint_team_code` нь ЗӨВХӨН НОТОЛГОО — шийдвэрт ХЭЗЭЭ Ч нөлөөлөхгүй.
 *    `settings.json`-ыг тухайн Windows хэрэглэгч засаж чаддаг тул тэр нь
 *    эрхийн эх сурвалж БОЛОХГҮЙ (§82-ийн 4-р шалгуур).  Хүлээн зөвшөөрөх
 *    цорын ганц зам нь `verify` — тэнд `user_teams`-ээр шалгагдана.
 * ⚠️ КЭШ БАЙХГҮЙ — `withEdgeCache` нь хэрэглэгчээр хуваадаггүй.
 */
revit.get('/team-context', async (c) => {
  const user = c.get('user');
  const db = c.env.DB;

  const docUid = str(c.req.query('doc_uid'), 128);
  const queryProject = teamProjectId(c.req.query('project_id'));
  const hint = str(c.req.query('hint_team_code'), 16).toUpperCase();

  const doc = await findTeamDoc(db, docUid, queryProject);

  // ⚠️ ХАНДАХ ЭРХ.  403 өгөхийн ОРОНД төслийн/баримтын нотолгоог ХАЯНА:
  //    гарц нь ХЭЗЭЭ Ч ажлыг блоклохгүй (§3.4-ийн UNCERTAIN гэрээ), гэхдээ
  //    өөр төслийн багийн кодыг ч гоожуулахгүй.
  let projectId = queryProject ?? doc?.project_id ?? null;
  let docId = doc?.id ?? null;
  if (projectId !== null && !(await canAccessProject(db, user, projectId))) {
    projectId = null;
    docId = null;
  }

  const res = await resolveTeamContext(db, {
    userId: user.sub,
    projectId,
    revitDocumentId: docId,
  });
  const live = await liveVerification(db, user.sub, docId);
  const decision = mergeVerification(res.decision, live);

  return c.json({
    ...teamView(res, decision, live),
    // АМЬД РОСТЕР — клиент багийн тоог (8 / 9 / 11) ХЭЗЭЭ Ч хатуу бичихгүй.
    teams: res.teams,
    // Клиентийн зөвлөмж — ЭХО, шийдвэр БИШ.
    hint_team_code: hint || null,
  });
});

/**
 * POST /api/revit/team-context/verify — §73-ын БУЦААГДАХ залруулга.
 *
 * ⚠️ ЭРХИЙН ХААЛГА: `team_code` нь дуудагчийн `user_teams`-ийн ЯМАР Ч
 * мөрөнд байх ЁСТОЙ (`is_primary` ШААРДЛАГАГҮЙ — хүн өөрийн хоёрдогч багаа
 * сонгож болно) ЭСВЭЛ `isManager(user.role)`; эс бөгөөс 403.  Энэ бол
 * §82-ийн 4-р шалгуур (тэг хөндлөн-багийн алдагдал).
 *
 * ⚠️ ВАЛИДАЦ нь АМЬД `teams.code`-оор явна, `code IN ('BA',…)` ХАТУУ
 * ЖАГСААЛТААР БИШ — `MGMT` / `EZ` / `GT` нь дүрмийн багцгүй ч ХҮЧИНТЭЙ код
 * хэвээр, тэдгээр багийн гишүүд өөрийгөө баталгаажуулж чаддаг байх ёстой.
 */
revit.post('/team-context/verify', async (c) => {
  const user = c.get('user');
  const db = c.env.DB;

  const body = await c.req
    .json<{
      doc_uid?: unknown;
      project_id?: unknown;
      session_uid?: unknown;
      team_code?: unknown;
      sticky?: unknown;
    }>()
    .catch(() => null);
  if (!body) return c.json({ error: 'Invalid JSON' }, 400);

  const teamCode = str(body.team_code, 16).toUpperCase();
  if (!isTeamCodeShape(teamCode)) return c.json({ error: 'team_code буруу хэлбэртэй' }, 400);

  const docUid = str(body.doc_uid, 128);
  const sessionUid = str(body.session_uid, 64);
  const sticky = body.sticky === true;
  const queryProject = teamProjectId(body.project_id);

  // 1) Код АМЬД ростерт байгаа эсэх + 2) дуудагч тэр багт харьяалагдах эсэх.
  const [teamRow, membership] = await db.batch([
    db.prepare('SELECT id FROM teams WHERE code = ? LIMIT 1').bind(teamCode),
    db
      .prepare(
        `SELECT 1 AS ok
           FROM user_teams ut
           JOIN teams tm ON tm.id = ut.team_id
          WHERE ut.user_id = ? AND tm.code = ?
          LIMIT 1`,
      )
      .bind(user.sub, teamCode),
  ]);
  if (((teamRow?.results ?? []) as unknown[]).length === 0) {
    return c.json({ error: 'Ийм баг байхгүй байна' }, 400);
  }
  const isMember = ((membership?.results ?? []) as unknown[]).length > 0;
  const via = isMember ? 'membership' : isManager(user.role) ? 'manager' : null;
  if (!via) {
    return c.json({ error: 'Энэ багийг сонгох эрхгүй байна' }, 403);
  }

  const doc = await findTeamDoc(db, docUid, queryProject);
  let projectId = queryProject ?? doc?.project_id ?? null;
  let docId = doc?.id ?? null;
  if (projectId !== null && !(await canAccessProject(db, user, projectId))) {
    projectId = null;
    docId = null;
  }

  // Машины таалт — залруулга нь ЮУГ засаж байгаа нь §66-ын хуурамч-эерэг
  // хэмжилтийн ЦОРЫН ГАНЦ түүхий эд.  Түүнийг ХАМТ хадгална.
  const res = await resolveTeamContext(db, {
    userId: user.sub,
    projectId,
    revitDocumentId: docId,
  });
  const inferred = res.decision;

  const scopeKind = sticky ? 'document' : 'session';
  const sessionRow = sessionUid
    ? await db
        .prepare('SELECT id FROM bim_sessions WHERE session_uid = ? AND user_id = ? LIMIT 1')
        .bind(sessionUid, user.sub)
        .first<{ id: number }>()
    : null;

  const ins = await db
    .prepare(
      `INSERT INTO team_attributions
         (scope_kind, session_id, revit_document_id, project_id, user_id,
          inferred_team_code, inferred_confidence, inferred_source,
          evidence_json, conflict_json,
          verified_team_code, verified_by, verified_at, verified_via)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), ?)`,
    )
    .bind(
      scopeKind,
      sessionRow?.id ?? null,
      docId,
      projectId,
      user.sub,
      inferred.team_code,
      inferred.team_confidence,
      inferred.team_source,
      evidenceOf(inferred),
      inferred.conflict ? JSON.stringify(inferred.conflict) : null,
      teamCode,
      user.sub,
      via,
    )
    .run();
  const attributionId = Number(ins.meta.last_row_id);

  // ⚠️ ХУУЧИН МӨРИЙГ УСТГАХГҮЙ — `superseded_by`-аар ХҮЧИНГҮЙ БОЛГОНО.
  //    0218-ын триггер нь ЯГ ЭНЭ хэлбэрийн UPDATE-ийг л зөвшөөрнө.
  await db
    .prepare(
      `UPDATE team_attributions
          SET superseded_by = ?, superseded_at = datetime('now')
        WHERE user_id = ?
          AND superseded_at IS NULL
          AND id <> ?
          AND COALESCE(revit_document_id, -1) = COALESCE(?, -1)`,
    )
    .bind(attributionId, user.sub, attributionId, docId)
    .run();

  // Нээлттэй сесс(үүд)-ийн ОДООГИЙН төлөв.  `bim_sessions` нь 0206-ын
  // триггерээс ГАДНА байгаа ЦОРЫН ГАНЦ BIM хүснэгт тул §73-ын залруулга
  // ЗӨВХӨН энд бичигдэж чадна.
  if (sessionRow) {
    await db
      .prepare(
        `UPDATE bim_sessions
            SET team_code = ?, team_confidence = ?, team_source = 'manual',
                team_last_verified = datetime('now')
          WHERE id = ? AND user_id = ?`,
      )
      .bind(teamCode, TIER_CONFIDENCE.manual, sessionRow.id, user.sub)
      .run();
  } else if (docId !== null) {
    await db
      .prepare(
        `UPDATE bim_sessions
            SET team_code = ?, team_confidence = ?, team_source = 'manual',
                team_last_verified = datetime('now')
          WHERE user_id = ? AND revit_document_id = ? AND ended_at IS NULL`,
      )
      .bind(teamCode, TIER_CONFIDENCE.manual, user.sub, docId)
      .run();
  }

  // `sticky` — баримт даяар наалдана.  ⚠️ Энэ бол ХҮНИЙ бичилт тул хуучин
  // хүний утгыг дарж бичих нь ЗӨВ (handshake-ийн автомат бичилт харин
  // ЗӨВХӨН NULL үед бичдэг — доорх §3.6-5).
  if (sticky && docId !== null) {
    await db
      .prepare('UPDATE revit_documents SET team_code = ? WHERE id = ?')
      .bind(teamCode, docId)
      .run();
  }

  const live: LiveAttribution = {
    id: attributionId,
    verified_team_code: teamCode,
    verified_at: new Date().toISOString(),
  };
  return c.json({
    ...teamView(res, mergeVerification(inferred, live), live),
    teams: res.teams,
    verified_via: via,
    sticky: sticky && docId !== null,
  });
});

/**
 * GET /api/revit/team-attributions — залруулгын түүх.
 *
 * ⚠️ ЗӨВХӨН ӨӨРИЙГӨӨ ХАРНА (`WHERE user_id = ?`).  Менежер ч гэсэн өөр
 * хүний мөр харахгүй: элемент түвшний үйл ажиллагаа нь өөрийгөө-харах-л
 * зарчимтай (0201:23-32, 0203:27, 0205:44 — гурав давтагдсан,
 * `revitNoteAi.test.ts:262`-т түгжигдсэн).
 */
revit.get('/team-attributions', async (c) => {
  const user = c.get('user');
  const db = c.env.DB;

  const docUid = str(c.req.query('doc_uid'), 128);
  const sessionUid = str(c.req.query('session_uid'), 64);

  const doc = docUid ? await findTeamDoc(db, docUid, null) : null;
  const docId = doc?.id ?? null;

  const { results } = await db
    .prepare(
      `SELECT ta.id, ta.scope_kind, ta.revit_document_id, ta.project_id,
              ta.inferred_team_code, ta.inferred_confidence, ta.inferred_source,
              ta.conflict_json, ta.verified_team_code, ta.verified_at, ta.verified_via,
              ta.superseded_at, ta.created_at
         FROM team_attributions ta
         LEFT JOIN bim_sessions bs ON bs.id = ta.session_id
        WHERE ta.user_id = ?
          AND (? = '' OR bs.session_uid = ?)
          AND (? IS NULL OR ta.revit_document_id = ?)
        ORDER BY ta.id DESC
        LIMIT 50`,
    )
    .bind(user.sub, sessionUid, sessionUid, docId, docId)
    .all();

  return c.json({ attributions: results ?? [] });
});

/* ------------------------------------------------------------------ */
/*  3. GET /context — панелийн унших гарц (юу ч бичихгүй)              */
/* ------------------------------------------------------------------ */

/**
 * ⚠️ 2026-08-26: ЖАГСААЛТЫН ЭХ СУРВАЛЖ НЬ ХОЛБООС БИШ, ХУВААРИЛАЛТ.
 *
 * Урьд нь энэ гарц зөвхөн `status='confirmed'` хуудасны холбоосоос ажил
 * гаргадаг байв.  Үр дүнд нь бодит байдал дээр НЭГ Ч ажил гардаггүй байсан:
 * продакшн дээр 434 холбоосын мөр бүгд `suggested` хэвээр байсан ба самбар
 * «Холбогдсон ажил алга» гээд мухардаж, шинэ ажилтан хэзээ ч эхэлж чаддаггүй
 * байв.  Холбоос нь одоо ЗӨВХӨН хоёр зүйлийг сайжруулна:
 *   • дэд жагсаалтыг хуудсаас автоматаар үүсгэх (`PUT /bindings`)
 *   • «энэ ажлын хуудсыг харуул» гэсэн 3D тусгаарлалт (`sheet_uids`)
 * Ажил өөрөө холбоосгүйгээр ч жагсаалтад гарна.
 *
 * ⚠️ ЗӨВХӨН ӨӨРИЙН АЖИЛ.  Нэг .rvt файлыг олон салбарын инженер хуваалцдаг
 * (2026-08-26-ны шийдвэр) бөгөөд холбоос нь БАГИЙН ХУВААЛЦСАН (`user_id IS
 * NULL`) тул холбогдсон бүх ажлыг харуулбал цахилгаанчинд архитекторын ажил
 * харагдаж, буруу ажил дээр явц илгээх эрсдэл үүснэ.  Менежер (`admin` /
 * `senior`) `?scope=all`-аар файлын бүх холбогдсон ажлыг нэмж харж болно —
 * `submitProgressEntry` тэдэнд хуваарилалтгүй ажлыг ч зөвшөөрдөг тул энэ нь
 * шинэ эрх нээхгүй.
 */
revit.get('/context', async (c) => {
  const user = c.get('user');
  const db = c.env.DB;

  const docUid = str(c.req.query('doc_uid'), 128);
  const projectId = Number(c.req.query('project_id'));
  if (!docUid) return c.json({ error: 'doc_uid is required' }, 400);

  const wantAll = c.req.query('scope') === 'all';
  const scopeAll = wantAll && isManager(user.role);

  const doc = await db
    .prepare(
      Number.isInteger(projectId)
        ? `SELECT id, project_id, file_name FROM revit_documents
            WHERE doc_uid = ? AND project_id = ? LIMIT 1`
        : `SELECT id, project_id, file_name FROM revit_documents
            WHERE doc_uid = ? ORDER BY last_seen_at DESC LIMIT 1`,
    )
    .bind(...(Number.isInteger(projectId) ? [docUid, projectId] : [docUid]))
    .first<{ id: number; project_id: number; file_name: string }>();
  if (!doc) return c.json({ error: 'Баримт бүртгэгдээгүй байна — эхлээд холбоно уу' }, 404);
  if (!(await canAccessProject(db, user, doc.project_id))) {
    return c.json({ error: 'Энэ төсөлд хандах эрхгүй байна' }, 403);
  }

  const project = await db
    .prepare('SELECT id, name, completion_questions FROM projects WHERE id = ?')
    .bind(doc.project_id)
    .first<{ id: number; name: string; completion_questions: string | null }>();

  /* --- Хуудасны холбоос: ажил тутмын uid-ууд + холбогдоогүй хуудсууд ---- */
  const { results: bindings } = await db
    .prepare(
      `SELECT rb.sheet_uid, rb.sheet_number, rb.sheet_name, rb.status, rb.task_id,
              t.name AS task_name, d.name AS drawing_name, b.name AS block_name
         FROM revit_sheet_bindings rb
         LEFT JOIN tasks t       ON t.id = rb.task_id
         LEFT JOIN components co ON co.id = t.component_id
         LEFT JOIN drawings d    ON d.id = co.drawing_id
         LEFT JOIN blocks b      ON b.id = d.block_id
        WHERE rb.revit_document_id = ? AND rb.user_id IS NULL
        ORDER BY rb.sheet_number`,
    )
    .bind(doc.id)
    .all<{
      sheet_uid: string;
      sheet_number: string;
      sheet_name: string;
      status: string;
      task_id: number | null;
      task_name: string | null;
      drawing_name: string | null;
      block_name: string | null;
    }>();

  interface TaskLabel {
    task_id: number;
    task_name: string | null;
    drawing_name: string | null;
    block_name: string | null;
  }

  const unbound: string[] = [];
  const uidsByTask = new Map<number, string[]>();
  const boundLabel = new Map<number, TaskLabel>();
  for (const b of bindings ?? []) {
    if (b.status !== 'confirmed' || b.task_id == null) {
      if (b.status !== 'ignored') unbound.push(b.sheet_uid);
      continue;
    }
    const list = uidsByTask.get(b.task_id) ?? [];
    list.push(b.sheet_uid);
    uidsByTask.set(b.task_id, list);
    if (!boundLabel.has(b.task_id)) {
      boundLabel.set(b.task_id, {
        task_id: b.task_id,
        task_name: b.task_name,
        drawing_name: b.drawing_name,
        block_name: b.block_name,
      });
    }
  }

  /* --- Миний ажлууд (холбоосоос ХАМААРАЛГҮЙ) --------------------------- */
  const { results: mineRows } = await db
    .prepare(
      `SELECT t.id AS task_id, t.name AS task_name,
              d.name AS drawing_name, b.name AS block_name
         FROM tasks t
         INNER JOIN components co ON co.id = t.component_id
         INNER JOIN drawings d    ON d.id = co.drawing_id
         INNER JOIN blocks b      ON b.id = d.block_id
        WHERE b.project_id = ?
          AND (t.assigned_to = ?
               OR EXISTS (SELECT 1 FROM task_assignees ta
                           WHERE ta.task_id = t.id AND ta.user_id = ?))
        ORDER BY b.sort_order, d.sort_order, t.sort_order, t.id
        LIMIT ${MAX_CONTEXT_TASKS}`,
    )
    .bind(doc.project_id, user.sub, user.sub)
    .all<TaskLabel>();

  const mine = mineRows ?? [];
  const mineIds = new Set(mine.map((r) => Number(r.task_id)));

  const order: Array<TaskLabel & { assigned: boolean }> = mine.map((r) => ({
    ...r,
    task_id: Number(r.task_id),
    assigned: true,
  }));
  if (scopeAll) {
    for (const [taskId, label] of boundLabel) {
      if (mineIds.has(taskId)) continue;
      if (order.length >= MAX_CONTEXT_TASKS) break;
      order.push({ ...label, assigned: false });
    }
  }

  /* --- Гаралт, дэд жагсаалт, өнөөдрийн бүртгэл — цөөн дуудлагаар -------- */
  const taskIds = order.map((o) => o.task_id);
  const derivations = await loadDerivations(db, user.sub, taskIds);
  // Хуваарилагдсан (managed) таскууд — add-in-д «Revit-ээс хувь илгээхгүй» гэж урьдчилан мэдэгдэнэ (409 MANAGED_ROOT).
  const managedIds = new Set<number>();
  for (let i = 0; i < taskIds.length; i += IDS_PER_STATEMENT) {
    const ids = taskIds.slice(i, i + IDS_PER_STATEMENT);
    const { results: mr } = await db
      .prepare(`SELECT task_id FROM task_roots WHERE task_id IN (${ids.map(() => '?').join(', ')})`)
      .bind(...ids)
      .all<{ task_id: number }>();
    for (const r of mr ?? []) managedIds.add(Number(r.task_id));
    // Хөрвүүлэлтээр root-д нэгтгэгдсэн хуучин хэсэг (0385) — Revit-ээс хувь илгээх нь ижил 409 (CONVERTED_PART) тул «managed» гэж тэмдэглэнэ.
    const { results: rr } = await db
      .prepare(`SELECT task_id FROM task_conversion_members WHERE role = 'retired' AND task_id IN (${ids.map(() => '?').join(', ')})`)
      .bind(...ids)
      .all<{ task_id: number }>();
    for (const r of rr ?? []) managedIds.add(Number(r.task_id));
  }

  const itemsByTask = new Map<number, Array<{ id: number; text: string; is_done: number }>>();
  const reportedToday = new Set<number>();
  const today = todayInUB();

  for (let i = 0; i < taskIds.length; i += IDS_PER_STATEMENT) {
    const ids = taskIds.slice(i, i + IDS_PER_STATEMENT);
    const ph = ids.map(() => '?').join(', ');
    const [cl, todayRows] = await db.batch([
      db
        .prepare(
          `SELECT id, task_id, text, is_done FROM task_checklist_items
            WHERE user_id = ? AND task_id IN (${ph})
            ORDER BY task_id, sort_order, id`,
        )
        .bind(user.sub, ...ids),
      db
        .prepare(
          `SELECT DISTINCT task_id FROM progress_entries
            WHERE user_id = ? AND date = ? AND status <> 'rejected'
              AND task_id IN (${ph})`,
        )
        .bind(user.sub, today, ...ids),
    ]);

    for (const r of (cl?.results ?? []) as Array<{
      id: number;
      task_id: number;
      text: string;
      is_done: number;
    }>) {
      const list = itemsByTask.get(Number(r.task_id)) ?? [];
      list.push({ id: r.id, text: r.text, is_done: r.is_done });
      itemsByTask.set(Number(r.task_id), list);
    }
    for (const r of (todayRows?.results ?? []) as Array<{ task_id: number }>) {
      reportedToday.add(Number(r.task_id));
    }
  }

  const resolved = order.map((o) => {
    const d = derivations.get(o.task_id) ?? {
      currentPercent: 0,
      result: deriveSuggestedPercent({
        checklistDone: 0,
        checklistTotal: 0,
        currentPercent: 0,
      }),
      checklistDone: 0,
      checklistTotal: 0,
    };
    const items = itemsByTask.get(o.task_id) ?? [];
    return {
      task_id: o.task_id,
      managed: managedIds.has(o.task_id),
      task_name: o.task_name,
      drawing_name: o.drawing_name,
      block_name: o.block_name,
      assigned: o.assigned,
      current_progress: d.currentPercent,
      derived_percent: d.result.derived,
      suggested_percent: d.result.suggested,
      percent_basis: d.result.basis,
      basis_detail: d.result.detail,
      ceiling: d.result.ceiling,
      checklist: {
        total: d.checklistTotal,
        done: d.checklistDone,
        items,
      },
      reported_today: reportedToday.has(o.task_id),
      sheet_uids: uidsByTask.get(o.task_id) ?? [],
    };
  });

  return c.json({
    document: {
      id: doc.id,
      project_id: doc.project_id,
      project_name: project?.name ?? '',
      file_name: doc.file_name,
    },
    completion_questions: project?.completion_questions ?? null,
    resolved,
    unbound_sheet_uids: unbound,
    // Самбар «яагаад хоосон байна вэ» гэдгийг ЯГ ЗӨВ хэлэхийн тулд эдгээр
    // тоонууд хэрэгтэй.  Ганц «алга» мессеж нь гурван өөр шалтгааныг нуудаг:
    // ажил хуваарилагдаагүй / хуудас холбогдоогүй / өөр төсөл сонгосон.
    my_task_count: mine.length,
    bound_task_count: uidsByTask.size,
    sheet_count: (bindings ?? []).length,
    is_manager: isManager(user.role),
    scope: scopeAll ? 'all' : 'mine',
  });
});

/* ------------------------------------------------------------------ */
/*  3b. GET /work-context — «MGL ажил» самбарын унших гарц (бичихгүй)   */
/* ------------------------------------------------------------------ */

/**
 * Revit work tracking MVP (2026-09-29): нээлттэй файл → бүртгэлтэй төсөл →
 * миний НЭЭЛТТЭЙ таскууд.  `/context`-оос ЯЛГАА (тэр нь «MGL туслах»-ынх,
 * хөндөхгүй):
 *   • Бүртгэлгүй файл дээр 404 биш — 200 + САНАЛ (`MGL-yymmdd` код, миний
 *     нээлттэй таск бүхий төслүүд).  Самбар тэднийг СОНГОЛТ болгож харуулна;
 *     сонгосон төслийг байгаа `POST /handshake`-аар бүртгэнэ.
 *   • Нэг `doc_uid` олон төсөлд бүртгэлтэй бол ТААМАГЛАХГҮЙ
 *     (`lib/revitWorkContext.ts` `pickRegistration`).
 *   • Зөвхөн НЭЭЛТТЭЙ таск (хувь < 100 / цагаар / self_done биш), `progress_mode`,
 *     өнөөдрийн тайлан/«Ажилласан» тэмдэг, задлагдсан дуусгалтын асуултууд
 *     (100%-ийн хаалтын маягт — эзний 2026-09-29-ний шийдвэр).
 *
 * ⚠️ ЗӨВХӨН ӨӨРИЙН таск — `/context`-ийн 2026-08-26-ны дүрэм (нэг .rvt-г олон
 *    салбар хуваалцдаг).  Хугацаа, төлөв энд БАЙХГҮЙ — тэр нь `/tracking/*`
 *    (`routes/revitTracking.ts`).
 */
revit.get('/work-context', async (c) => {
  const user = c.get('user');
  const db = c.env.DB;

  const docUid = str(c.req.query('doc_uid'), 128);
  if (!docUid) return c.json({ error: 'doc_uid is required' }, 400);
  const hintRaw = Number(c.req.query('project_id'));
  const hint = Number.isInteger(hintRaw) && hintRaw > 0 ? hintRaw : null;
  const docCode = mglCodeIn(
    str(c.req.query('title')),
    str(c.req.query('file_name')),
    str(c.req.query('project_number'), 128),
    str(c.req.query('project_name')),
  );

  /* --- 1. Энэ uid-ийн бүртгэлүүд — хандах эрхтэйгээр нь л ------------ */
  const { results: regRows } = await db
    .prepare(
      `SELECT rd.id AS revit_document_id, rd.project_id, rd.file_name,
              p.name AS project_name, p.status AS project_status
         FROM revit_documents rd
         INNER JOIN projects p ON p.id = rd.project_id
        WHERE rd.doc_uid = ?
        ORDER BY rd.last_seen_at DESC, rd.id DESC
        LIMIT 10`,
    )
    .bind(docUid)
    .all<WorkRegistration & { file_name: string }>();
  const regs: Array<WorkRegistration & { file_name: string }> = [];
  for (const r of regRows ?? []) {
    if (await canAccessProject(db, user, Number(r.project_id))) regs.push(r);
  }

  /* --- 2. Миний нээлттэй таск бүхий төслүүд (саналын эх) --------------- */
  const { results: myRows } = await db
    .prepare(
      `SELECT b.project_id, p.name AS project_name, COUNT(*) AS open_tasks
         FROM tasks t
         INNER JOIN components co ON co.id = t.component_id
         INNER JOIN drawings d    ON d.id = co.drawing_id
         INNER JOIN blocks b      ON b.id = d.block_id
         INNER JOIN projects p    ON p.id = b.project_id
        WHERE p.status = 'active'
          AND t.id IN (SELECT id FROM tasks WHERE assigned_to = ?
                       UNION SELECT task_id FROM task_assignees WHERE user_id = ?)
          AND NOT EXISTS (SELECT 1 FROM task_self_done sd
                           WHERE sd.task_id = t.id AND sd.user_id = ?)
          AND (p.progress_mode = 'hours'
               OR COALESCE(${latestApprovedPctByDate('t.id')}, 0) < 100)
        GROUP BY b.project_id, p.name`,
    )
    .bind(user.sub, user.sub, user.sub)
    .all<{ project_id: number; project_name: string; open_tasks: number }>();
  const mine = myRows ?? [];
  const openByProject = new Map(mine.map((r) => [Number(r.project_id), Number(r.open_tasks)]));

  const pick = pickRegistration(regs, hint, new Set(openByProject.keys()));

  /* --- 3. Санал — зөвхөн төсөл шийдэгдээгүй үед ------------------------ */
  let suggestions: ProjectSuggestion[] = [];
  if (!pick.registration) {
    const candidates = new Map<number, ProjectCandidate>();
    for (const r of mine) {
      candidates.set(Number(r.project_id), {
        project_id: Number(r.project_id),
        project_name: r.project_name,
        open_tasks: Number(r.open_tasks),
        code: parseProjectName(r.project_name).code,
      });
    }
    if (docCode) {
      const { results: coded } = await db
        .prepare(
          `SELECT id AS project_id, name AS project_name FROM projects
            WHERE status = 'active' AND UPPER(name) LIKE ?
            ORDER BY id DESC LIMIT 10`,
        )
        .bind(`${docCode}%`)
        .all<{ project_id: number; project_name: string }>();
      for (const r of coded ?? []) {
        const id = Number(r.project_id);
        if (candidates.has(id)) continue;
        // ⚠️ Эрхгүй төслийг санал болгохгүй — бүртгэх (`/handshake`) нь 403 өгнө.
        if (!(await canAccessProject(db, user, id))) continue;
        candidates.set(id, {
          project_id: id,
          project_name: r.project_name,
          open_tasks: openByProject.get(id) ?? 0,
          code: parseProjectName(r.project_name).code,
        });
      }
    }
    suggestions = suggestProjects(docCode, [...candidates.values()]);
  }

  /* --- 4. Шийдэгдсэн төслийн миний НЭЭЛТТЭЙ таскууд ------------------- */
  const reg = pick.registration;
  let project: {
    id: number;
    name: string;
    status: string;
    progress_mode: string | null;
    completion_questions: string | null;
  } | null = null;
  const tasks: Array<{
    task_id: number;
    task_name: string;
    drawing_name: string | null;
    block_name: string | null;
    current_progress: number;
    progress_mode: 'tasks' | 'hours';
    reported_today: boolean;
    marked_today: boolean;
    /** Хуваарилагдсан (managed) таск — Revit-ээс хувь илгээхгүй (409 MANAGED_ROOT), вэбээс өөрийн хэсгийг бөглөнө. */
    managed: boolean;
  }> = [];

  if (reg) {
    project = await db
      .prepare(
        `SELECT id, name, status, progress_mode, completion_questions
           FROM projects WHERE id = ?`,
      )
      .bind(reg.project_id)
      .first<{
        id: number;
        name: string;
        status: string;
        progress_mode: string | null;
        completion_questions: string | null;
      }>();
  }

  if (project && project.status === 'active') {
    const mode: 'tasks' | 'hours' = project.progress_mode === 'hours' ? 'hours' : 'tasks';
    const { results: taskRows } = await db
      .prepare(
        `SELECT t.id AS task_id, t.name AS task_name,
                d.name AS drawing_name, b.name AS block_name,
                EXISTS (SELECT 1 FROM task_self_done sd
                         WHERE sd.task_id = t.id AND sd.user_id = ?) AS self_done,
                (EXISTS (SELECT 1 FROM task_roots r WHERE r.task_id = t.id)
                 OR EXISTS (SELECT 1 FROM task_conversion_members m WHERE m.task_id = t.id AND m.role = 'retired')) AS managed
           FROM tasks t
           INNER JOIN components co ON co.id = t.component_id
           INNER JOIN drawings d    ON d.id = co.drawing_id
           INNER JOIN blocks b      ON b.id = d.block_id
          WHERE b.project_id = ?
            AND t.id IN (SELECT id FROM tasks WHERE assigned_to = ?
                         UNION SELECT task_id FROM task_assignees WHERE user_id = ?)
          ORDER BY b.sort_order, d.sort_order, t.sort_order, t.id
          LIMIT ${MAX_CONTEXT_TASKS}`,
      )
      .bind(user.sub, project.id, user.sub, user.sub)
      .all<{
        task_id: number;
        task_name: string;
        drawing_name: string | null;
        block_name: string | null;
        self_done: number;
        managed: number;
      }>();

    const rows = (taskRows ?? []).map((r) => ({ ...r, task_id: Number(r.task_id) }));
    // ⚠️ Одоогийн хувь нь `/submissions`-ийн шалгалттай ЯГ ИЖИЛ эх
    //    (`loadDerivations`, date → created_at → id) — самбарын харуулсан
    //    хувь ба серверийн «ухралт» шалгалт хэзээ ч зөрөхгүй.
    const deriv = await loadDerivations(db, user.sub, rows.map((r) => r.task_id));
    const open = rows.filter((r) =>
      isOpenTask({
        current_progress: deriv.get(r.task_id)?.currentPercent ?? 0,
        progress_mode: mode,
        self_done: Number(r.self_done) === 1,
      }),
    );

    const reported = new Set<number>();
    const marked = new Set<number>();
    const today = todayInUB();
    const ids = open.map((r) => r.task_id);
    for (let i = 0; i < ids.length; i += IDS_PER_STATEMENT) {
      const chunk = ids.slice(i, i + IDS_PER_STATEMENT);
      const ph = chunk.map(() => '?').join(', ');
      const [pe, rm] = await db.batch([
        db
          .prepare(
            `SELECT DISTINCT task_id FROM progress_entries
              WHERE user_id = ? AND date = ? AND status <> 'rejected'
                AND task_id IN (${ph})`,
          )
          .bind(user.sub, today, ...chunk),
        db
          .prepare(
            `SELECT DISTINCT task_id FROM repair_marks
              WHERE user_id = ? AND date = ? AND task_id IN (${ph})`,
          )
          .bind(user.sub, today, ...chunk),
      ]);
      for (const r of (pe?.results ?? []) as Array<{ task_id: number }>) reported.add(Number(r.task_id));
      for (const r of (rm?.results ?? []) as Array<{ task_id: number }>) marked.add(Number(r.task_id));
    }

    for (const r of open) {
      tasks.push({
        task_id: r.task_id,
        task_name: r.task_name,
        drawing_name: r.drawing_name,
        block_name: r.block_name,
        current_progress: deriv.get(r.task_id)?.currentPercent ?? 0,
        progress_mode: mode,
        reported_today: reported.has(r.task_id),
        marked_today: marked.has(r.task_id),
        managed: Number(r.managed) === 1,
      });
    }
  }

  return c.json({
    me: { id: user.sub, role: user.role, is_manager: isManager(user.role) },
    document: reg
      ? {
          revit_document_id: Number(reg.revit_document_id),
          project_id: Number(reg.project_id),
          project_name: reg.project_name,
          project_status: reg.project_status,
          file_name: regs.find((r) => r.revit_document_id === reg.revit_document_id)?.file_name ?? null,
        }
      : null,
    resolved_by: pick.source,
    ambiguous: pick.ambiguous,
    registrations: regs.map((r) => ({
      revit_document_id: Number(r.revit_document_id),
      project_id: Number(r.project_id),
      project_name: r.project_name,
      project_status: r.project_status,
    })),
    doc_code: docCode,
    suggestions,
    project: project
      ? {
          id: Number(project.id),
          name: project.name,
          status: project.status,
          progress_mode: project.progress_mode === 'hours' ? 'hours' : 'tasks',
        }
      : null,
    tasks,
    // Машины санал 99-өөр таглагдана; 100 нь зөвхөн доорх асуултуудын хариутай
    // ил «хаах» үйлдлээр (`POST /submissions` + `completion_qa`).
    ceiling: CEILING,
    completion_questions: project ? parseCompletionQuestions(project.completion_questions) : [],
  });
});

/* ------------------------------------------------------------------ */
/*  4. POST /draft — хувь + монгол тэмдэглэлийн НООРОГ (юу ч бичихгүй) */
/* ------------------------------------------------------------------ */

interface DigestGroupBody {
  category_label?: unknown;
  type_name?: unknown;
  level?: unknown;
  kind?: unknown;
  kind_label?: unknown;
  ops?: unknown;
  count?: unknown;
  sheets?: unknown;
}

interface ChangeSummary {
  totals?: { added?: number; removed?: number; modified?: number };
  sheets?: Array<{ uid?: string; number?: string }>;
  /**
   * Add-in-ий `ChangeReport.ChangeDigest`-ийн гаралт — тайлангийн бичвэрийн
   * эх баримт (категори × төрөл × давхар × үйлдэл → тоо, хуудас).
   *
   * ⚠️ ЭНЭ НЬ ИТГЭМЖЛЭГДЭЭГҮЙ ОРОЛТ.  Add-in-ээс ирдэг ч бие нь хэрэглэгчийн
   * хяналтад байдаг тул `noteGroupsFrom` бүх талбарыг хязгаарлаж цэвэрлэнэ —
   * эндээс шууд AI-ийн prompt руу ордог тул урт мөр нь prompt-ыг дүүргэнэ.
   */
  digest?: {
    groups?: DigestGroupBody[];
    visible_total?: unknown;
    more_groups?: unknown;
  };
}

/** Тэмдэглэлд оруулах бүлгийн дээд тоо — prompt хэт томрохоос сэргийлнэ. */
const MAX_NOTE_GROUPS = 20;

const DIGEST_KINDS = new Set(['added', 'modified', 'deleted']);

function noteGroupsFrom(digest: ChangeSummary['digest']): ChangeGroupFact[] {
  const out: ChangeGroupFact[] = [];
  for (const g of digest?.groups ?? []) {
    if (out.length >= MAX_NOTE_GROUPS) break;

    const count = Number(g?.count);
    if (!Number.isInteger(count) || count <= 0) continue;

    const categoryLabel = str(g?.category_label, 64);
    if (!categoryLabel) continue;

    const kindRaw = typeof g?.kind === 'string' ? g.kind : '';
    const ops = (Array.isArray(g?.ops) ? g.ops : [])
      .slice(0, 3)
      .map((o) => str(o, 48))
      .filter(Boolean);
    const sheets = (Array.isArray(g?.sheets) ? g.sheets : [])
      .slice(0, 3)
      .map((x) => str(x, 32))
      .filter(Boolean);

    out.push({
      categoryLabel,
      typeName: str(g?.type_name, 96) || null,
      level: str(g?.level, 64) || null,
      kind: DIGEST_KINDS.has(kindRaw) ? kindRaw : 'modified',
      kindLabel: str(g?.kind_label, 32) || null,
      ops,
      count,
      sheets,
    });
  }
  return out;
}

function digestInt(v: unknown): number | undefined {
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 ? n : undefined;
}

revit.post('/draft', async (c) => {
  const user = c.get('user');
  const db = c.env.DB;

  const body = await c.req
    .json<{ task_id?: number; sheet_uids?: string[]; change?: ChangeSummary }>()
    .catch(() => null);
  if (!body) return c.json({ error: 'Invalid JSON' }, 400);

  const taskId = Number(body.task_id);
  if (!Number.isInteger(taskId)) return c.json({ error: 'task_id is required' }, 400);
  if (!isManager(user.role) && !(await isAssigned(db, user.sub, taskId))) {
    return c.json({ error: TAKE_REQUIRED_MESSAGE, code: 'TAKE_REQUIRED' }, 403);
  }

  const info = await db
    .prepare(
      `SELECT t.name AS task_name, p.name AS project_name, p.id AS project_id,
              p.completion_questions
         FROM tasks t
         INNER JOIN components c ON c.id = t.component_id
         INNER JOIN drawings d   ON d.id = c.drawing_id
         INNER JOIN blocks b     ON b.id = d.block_id
         INNER JOIN projects p   ON p.id = b.project_id
        WHERE t.id = ?`,
    )
    .bind(taskId)
    .first<{
      task_name: string;
      project_name: string;
      project_id: number;
      completion_questions: string | null;
    }>();
  if (!info) return c.json({ error: 'Task not found' }, 404);

  const d = await loadDerivation(db, user.sub, taskId);

  // Хамрагдсан хуудасны ШОШГО — тэмдэглэлд орно.
  const uids = (body.sheet_uids ?? []).map((u) => str(u, 128)).filter(Boolean);
  let labels: string[] = [];
  if (uids.length > 0) {
    const ph = uids.map(() => '?').join(',');
    const { results } = await db
      .prepare(
        `SELECT DISTINCT sheet_number FROM revit_sheet_bindings
          WHERE sheet_uid IN (${ph}) AND sheet_number <> ''
          ORDER BY sheet_number`,
      )
      .bind(...uids)
      .all<{ sheet_number: string }>();
    labels = (results ?? []).map((r) => r.sheet_number);
  }

  // ⚠️ ҮР ДҮНГИЙН ХЭМЖҮҮР.  «Өнөөдөр хэдэн дэд ажил хаав» гэдэг нь хөдөлгөөн
  // БИШ, ДУУССАН зүйлийг хэмждэг цорын ганц тоо — тайлангийн гол агуулга
  // (эзний шийдвэр, 2026-08-26).  `done_at` нь migration 0177-оос хойш бий.
  const doneTodayRow = await db
    .prepare(
      `SELECT COUNT(*) AS n FROM task_checklist_items
        WHERE task_id = ? AND user_id = ? AND is_done = 1
          AND date(done_at) = ?`,
    )
    .bind(taskId, user.sub, todayInUB())
    .first<{ n: number }>();

  const percent = d.result.suggested ?? d.currentPercent;
  const note = await generateRevitNote(c.env.AI, {
    projectName: info.project_name,
    taskName: info.task_name,
    sheetLabels: labels,
    previousPercent: d.currentPercent,
    percent,
    basisDetail: d.result.detail,
    added: body.change?.totals?.added,
    modified: body.change?.totals?.modified,
    // ⚠️ Задаргаа байвал `templateNote` нь ТҮҮХИЙ тоог (`added`/`modified`)
    // ОГТ бичихгүй — Revit-ийн 155 нь хүний хийсэн ажил биш.
    visibleTotal: digestInt(body.change?.digest?.visible_total),
    groups: noteGroupsFrom(body.change?.digest),
    moreGroups: digestInt(body.change?.digest?.more_groups),
  });

  const warnings: string[] = [];
  if (d.result.basis === 'none') warnings.push('no_checklist');
  if (d.result.derived != null && d.result.derived < d.currentPercent) warnings.push('regression');
  if (!body.change) warnings.push('no_baseline');

  return c.json({
    task_id: taskId,
    project_id: info.project_id,
    current_percent: d.currentPercent,
    suggested_percent: d.result.suggested,
    derived_percent: d.result.derived,
    ceiling: d.result.ceiling,
    percent_basis: d.result.basis,
    basis_detail: d.result.detail,
    checklist: { done: d.checklistDone, total: d.checklistTotal },
    note_mn: note.note,
    ai_model: note.ai_model,
    ai_prompt_version: note.ai_prompt_version,
    fallback: note.fallback,
    warnings,
    completion_questions: info.completion_questions,
  });
});


/* ------------------------------------------------------------------ */
/*  5. POST /submissions — ЦОРЫН ГАНЦ бичих гарц                        */
/* ------------------------------------------------------------------ */

interface EvidenceItem {
  url?: string;
  name?: string;
  type?: string;
}

interface SubmissionBody {
  draft_uid?: string;
  confirmed?: unknown;
  task_id?: number;
  percentage?: unknown;
  notes?: string;
  ai_notes?: string;
  ai_model?: string;
  ai_prompt_version?: string;
  revit_document_id?: number;
  sheet_uids?: string[];
  change?: unknown;
  evidence?: EvidenceItem[];
  completion_qa?: Record<string, string> | null;
  /** Офлайн дараалалд хүлээгдсэн тайлан БИЧСЭН өдөр (≤3 хоног хойш) — `resolveReportDate`. */
  report_date?: string;
  /** Илгээх агшин дахь тухайн таскийн өнөөдрийн Revit цаг (аудит, 0360). */
  revit_active_ms?: number;
}

/**
 * Дараалал нь өөрөө зөв байдлын механизм — D1-д statement хоорондын
 * транзакц БАЙХГҮЙ.  Тиймээс `claim_state` гурван төлөвтэй:
 *
 *   'claimed'    → мөр авсан, бичилт хараахан эхлээгүй   → дахин оролдож БОЛНО
 *   'submitting' → бичилт эхэлсэн, үр дүн МЭДЭГДЭХГҮЙ    → 409, дахин бичихгүй
 *   'sealed'     → progress_entry_id бичигдсэн           → 200 duplicate
 *
 * ⚠️ `progress_entries`-д ямар ч unique constraint байхгүй тул 'submitting'
 * төлөвт дахин `submitProgressEntry` дуудвал ХОЁР мөр + ХОЁР оноо үүснэ.
 * Тиймээс тэр төлөвт ЗААВАЛ 409 өгч, хүнээр шалгуулна.
 */
revit.post('/submissions', async (c) => {
  const user = c.get('user');
  const db = c.env.DB;

  // 1. Биеийг АЮУЛГҮЙ уншина (index.ts-д app.onError байхгүй).
  const body = await c.req.json<SubmissionBody>().catch(() => null);
  if (!body) return c.json({ error: 'Invalid JSON' }, 400);

  // 2. ХҮНИЙ БАТАЛГАА — машин «мартаж» илгээх боломжгүй.
  if (body.confirmed !== true) {
    return c.json({ error: 'confirmation_required' }, 400);
  }

  // 3. Тоон ТӨРӨЛ.  ('62' гэсэн мөр нь JS-ийн харьцуулалтыг чимээгүй давна.)
  if (typeof body.percentage !== 'number' || !Number.isFinite(body.percentage)) {
    return c.json({ error: 'percentage must be a number' }, 400);
  }

  const draftUid = str(body.draft_uid, 64);
  if (!draftUid) return c.json({ error: 'draft_uid is required' }, 400);

  const taskId = Number(body.task_id);
  if (!Number.isInteger(taskId)) return c.json({ error: 'task_id is required' }, 400);

  // 4. Нотолгооны URL — /media/<НЭГ СЕГМЕНТ> түлхүүр л зөвшөөрнө (image_url
  //    хүлээж авахгүй).  ⚠️ Урьд нь зөвхөн `startsWith('/media/')` байсан —
  //    тэр нь `/media/a%2Fb.png` мэтийг нэвтрүүлдэг бөгөөд Hono `%2F`-ыг
  //    задалдаг тул уншихад хавтастай R2 түлхүүр болно (`lib/mediaUrl.ts`).
  const evidence = Array.isArray(body.evidence) ? body.evidence : [];
  for (const e of evidence) {
    if (!isSingleSegmentMediaUrl(String(e?.url ?? ''))) {
      return c.json({ error: 'Evidence url must be a /media/ key' }, 400);
    }
  }

  const info = await db
    .prepare(
      `SELECT b.project_id
         FROM tasks t
         INNER JOIN components c ON c.id = t.component_id
         INNER JOIN drawings d   ON d.id = c.drawing_id
         INNER JOIN blocks b     ON b.id = d.block_id
        WHERE t.id = ?`,
    )
    .bind(taskId)
    .first<{ project_id: number }>();
  if (!info) return c.json({ error: 'Task not found' }, 404);

  // 4b. БИТҮҮМЖЛЭГДСЭН ДАВТАН ХҮРГЭЛТ — хувийн шалгалтаас ӨМНӨ.
  //
  // ⚠️ Урьд нь энэ шалгалт зөвхөн доорх 6-р алхамд, хувийн шалгалтын ДАРАА
  //    байв.  Үр дүн: амжилттай ХААСАН (100%) тайланг хариу нь сүлжээнд
  //    алдагдсаны улмаас ижил `draft_uid`-аар дахин илгээхэд «аль хэдийн
  //    дууссан» 409 ирж, add-in-ий офлайн дараалал түүнийг «татгалзсан» гэж
  //    тэмдэглэдэг байв (2026-09-29-ний route тест барьсан).  Мөн 60%-ийн тайлан
  //    орсны дараа вэбээс 70% бөглөгдвөл давтан 60 нь «ухралт» болж байв.
  //    Битүүмжлэгдсэн мөрийг ЮУ Ч дахин шалгахгүй — анхны хариуг л буцаана.
  const sealedPrior = await db
    .prepare(
      `SELECT id, progress_entry_id, percentage FROM revit_submissions
        WHERE user_id = ? AND draft_uid = ? AND claim_state = 'sealed'
          AND progress_entry_id IS NOT NULL`,
    )
    .bind(user.sub, draftUid)
    .first<{ id: number; progress_entry_id: number; percentage: number }>();
  if (sealedPrior) {
    return c.json({
      duplicate: true,
      submission_id: sealedPrior.id,
      entry_id: sealedPrior.progress_entry_id,
      percentage: sealedPrior.percentage,
      task_id: taskId,
      project_id: info.project_id,
    });
  }

  // 4c. ХУВААРИЛАГДСАН (managed) ТАСК — Revit-ээс root-ийн хувь бичихгүй (хувь = хүн бүрийн ӨӨРИЙН хэсэг, вэбээс).
  //
  // ⚠️ Хувийн шалгалтуудаас (above_ceiling / already_at_ceiling / percentage_regression) ӨМНӨ.  Урьд нь энэ татгалзал
  //    `submitProgressEntry` дотор, ДООР байсан тул managed root-ийн НИЙТ хувиас хамаарсан шалгалт түрүүлж унаж жинхэнэ
  //    шалтгааныг (MANAGED_ROOT) далдалдаг байв (жишээ: root 60% — бусдын ажил — Revit-ээс 40 илгээвэл «ухралт»).
  //    Мөн `retryable: false` — add-in/дараалал ижил тайланг дахин илгээх нь ХЭЗЭЭ Ч амжихгүй, `revit_submissions`-д
  //    «claimed» мөр үлдэхгүй (энэ салбар INSERT-ээс өмнө).
  if (await isManagedTask(db, taskId)) {
    return c.json(managedRootBody(taskId, info.project_id), 409, contractHeaders());
  }
  const retiredInto = await retiredIntoRoot(db, taskId);
  if (retiredInto !== null) {
    return c.json(convertedPartBody(taskId, info.project_id, retiredInto), 409, contractHeaders());
  }

  // 5. Хувийг СЕРВЕР дахин тооцоолж шалгана — биеэс ирсэн тоонд итгэхгүй.
  //
  // ⚠️ ХААХ (100%) — эзний 2026-09-29-ний шийдвэр: Revit-ээс ч хааж болно,
  //    вэбтэй ЯГ ИЖИЛ дуусгалтын асуултуудтай.  Энд зөвхөн «хаах оролдлого
  //    мөн эсэх»-ийг (ЯГ 100 + `completion_qa` объект) тогтооно; хариу БҮРЭН
  //    эсэхийг ганц газар — `submitProgressEntry` шалгаж 400 буцаана
  //    (`completion_qa required` + `questions` + `missing`).
  const completing =
    body.percentage === COMPLETE &&
    body.completion_qa != null &&
    typeof body.completion_qa === 'object' &&
    !Array.isArray(body.completion_qa);
  const d = await loadDerivation(db, user.sub, taskId);
  const verdict = verifySubmittedPercent(body.percentage, d.result, d.currentPercent, { completing });
  if (!verdict.ok) {
    if (verdict.code === 'above_ceiling') {
      return c.json(
        {
          error: 'percentage_above_ceiling',
          ceiling: verdict.ceiling,
          message:
            `Revit-ээс ${verdict.ceiling}%-аас дээш зөвхөн ажлыг ХААХ (100%) үед илгээнэ — ` +
            'дуусгалтын асуултуудад хариулна уу.',
        },
        400,
      );
    }
    if (verdict.code === 'already_at_ceiling') {
      // Ажил аль хэдийн ДУУССАН (100%) — Revit-ээс нэмж илгээх зүйл алга.
      // Хэрэглэгчид ЯАГААД гэдгийг тодорхой хэлнэ.
      return c.json(
        {
          error: 'already_at_ceiling',
          current: d.currentPercent,
          ceiling: verdict.ceiling,
          message: `Энэ ажил аль хэдийн дууссан (${Math.round(d.currentPercent)}%). Revit-ээс нэмж явц илгээх шаардлагагүй.`,
        },
        409,
      );
    }
    if (verdict.code === 'below_current') {
      return c.json(
        {
          error: 'percentage_regression',
          current: d.currentPercent,
          message: `Одоогийн явц ${Math.round(d.currentPercent)}% — үүнээс бага хувь илгээх боломжгүй.`,
        },
        409,
      );
    }
    return c.json({ error: 'percentage must be a number' }, 400);
  }

  const notes = str(body.notes, 2000);
  const aiNotes = str(body.ai_notes, 2000);
  // ⚠️ СЕРВЕР тооцоолно — биеэс уншихгүй.  «AI бичсэн үү, хүн уншсан уу?»
  // гэдэгт жилийн дараа ч хариулах ганц найдвартай арга.
  const editedByHuman = aiNotes.length > 0 && notes !== aiNotes ? 1 : 0;

  const changeJson = JSON.stringify({
    ...(typeof body.change === 'object' && body.change ? body.change : {}),
    // ҮРГЭЛЖ true — өөрчлөлтийн тоо add-in-ий локал snapshot-оос ирдэг тул
    // сервер БАТАЛГААЖУУЛААГҮЙ өгөгдөл.
    self_reported: true,
  });
  const sheetUids = (body.sheet_uids ?? []).map((u) => str(u, 128)).filter(Boolean);
  // Add-in-ий офлайн дараалал (0360): тайлан бичсэн өдөртөө бүртгэгдэнэ —
  // гэхдээ ≤3 хоног хойш, ирээдүй хэзээ ч биш (`lib/revitTracking.ts`).
  const entryDate = resolveReportDate(body.report_date, todayInUB());
  const revitActiveMs = cleanActiveMs(body.revit_active_ms);

  // 6. IDEMPOTENCY — эхлээд уншина, дараа нь бичнэ.
  let submissionId: number;
  const prior = await db
    .prepare(
      `SELECT id, claim_state, progress_entry_id, percentage
         FROM revit_submissions WHERE user_id = ? AND draft_uid = ?`,
    )
    .bind(user.sub, draftUid)
    .first<{
      id: number;
      claim_state: string;
      progress_entry_id: number | null;
      percentage: number;
    }>();

  if (prior) {
    if (prior.claim_state === 'sealed' && prior.progress_entry_id != null) {
      return c.json({
        duplicate: true,
        submission_id: prior.id,
        entry_id: prior.progress_entry_id,
        percentage: prior.percentage,
        task_id: taskId,
        project_id: info.project_id,
      });
    }
    if (prior.claim_state === 'submitting') {
      return c.json(
        {
          error: 'indeterminate',
          submission_id: prior.id,
          message:
            'Өмнөх илгээлтийн үр дүн тодорхойгүй байна. /api/progress/my-recent-ээс шалгаад, ороогүй бол ШИНЭ draft_uid-аар дахин илгээнэ үү.',
        },
        409,
      );
    }
    submissionId = prior.id;
  } else {
    try {
      const ins = await db
        .prepare(
          `INSERT INTO revit_submissions
             (draft_uid, user_id, project_id, task_id, revit_document_id,
              claim_state, percentage, suggested_percentage, prev_percentage,
              percent_basis, checklist_done, checklist_total,
              notes, ai_notes, ai_model, ai_prompt_version, edited_by_human,
              sheet_uids_json, change_json, evidence_json, revit_active_ms)
           VALUES (?, ?, ?, ?, ?, 'claimed', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          draftUid,
          user.sub,
          info.project_id,
          taskId,
          Number.isInteger(Number(body.revit_document_id))
            ? Number(body.revit_document_id)
            : null,
          body.percentage,
          d.result.derived,
          d.currentPercent,
          verdict.basis,
          d.checklistDone,
          d.checklistTotal,
          notes,
          aiNotes || null,
          str(body.ai_model, 64) || null,
          str(body.ai_prompt_version, 32) || REVIT_NOTE_PROMPT_VERSION,
          editedByHuman,
          JSON.stringify(sheetUids),
          changeJson,
          JSON.stringify(evidence),
          revitActiveMs,
        )
        .run();
      submissionId = Number(ins.meta.last_row_id);
    } catch {
      // Уралдаан — өөр хүсэлт яг одоо мөрөө авчихлаа.  Дахин уншиж шийднэ.
      const again = await db
        .prepare(
          `SELECT id, claim_state, progress_entry_id FROM revit_submissions
            WHERE user_id = ? AND draft_uid = ?`,
        )
        .bind(user.sub, draftUid)
        .first<{ id: number; claim_state: string; progress_entry_id: number | null }>();
      if (!again) return c.json({ error: 'Илгээлтийг бүртгэж чадсангүй' }, 500);
      if (again.progress_entry_id != null) {
        return c.json({ duplicate: true, submission_id: again.id, entry_id: again.progress_entry_id });
      }
      return c.json({ error: 'indeterminate', submission_id: again.id }, 409);
    }
  }

  // 7. БИЧИЛТ ЭХЭЛЖ БАЙНА гэж тамгална — үр дүн тодорхойгүй болох цонх нээгдэв.
  await db
    .prepare("UPDATE revit_submissions SET claim_state = 'submitting' WHERE id = ?")
    .bind(submissionId)
    .run();

  // 8. БАЙГАА pipeline.  Явцын математик энд ДАХИН БИЧИГДЭХГҮЙ.
  const res = await submitProgressEntry(
    ctxOf(c),
    {
      task_id: taskId,
      percentage: body.percentage,
      date: entryDate,
      notes,
      completion_qa: body.completion_qa ?? undefined,
      attachments: evidence.map((e) => ({
        url: String(e.url),
        name: str(e.name, 128) || 'нотолгоо',
        type: str(e.type, 64) || 'image/*',
      })),
    },
    { source: 'revit' },
  );

  if (!res.ok) {
    // Бичилт болоогүй нь ТОДОРХОЙ — нэхэмжлэлээ буцааж, ижил draft_uid-аар
    // засаад дахин оролдох боломж үлдээнэ.
    await db
      .prepare("UPDATE revit_submissions SET claim_state = 'claimed' WHERE id = ?")
      .bind(submissionId)
      .run();
    return c.json(res.body, res.status);
  }

  // 9. БИТҮҮМЖЛЭЛ.
  const entryId = Number(res.body.id);
  await db
    .prepare(
      `UPDATE revit_submissions
          SET progress_entry_id = ?, claim_state = 'sealed', sealed_at = datetime('now')
        WHERE id = ?`,
    )
    .bind(entryId, submissionId)
    .run();

  // Хувийн бөглөлт өдрийн засварын цагийн хилийг хөдөлгөнө (0348, progress.ts
  // `resyncRepairHours`-ийн ихэр).  Алдаа нь битүүмжилсэн илгээлтийг унагахгүй.
  try {
    // Засварын өдрийн хуваарилалт ЗӨВХӨН өнөөдөрт (0348) — хожимдсон тайлан өнгөрсөн өдрийг хөдөлгөхгүй.
    if (entryDate === todayInUB()) await syncRepairDayIfMarked(db, c.get('user').sub, entryDate);
  } catch (err) {
    console.error('[repair-day] resync after revit submit failed', err);
  }

  return c.json(
    {
      submission_id: submissionId,
      entry_id: entryId,
      status: res.body.status,
      percentage: body.percentage,
      task_id: taskId,
      project_id: info.project_id,
      // Add-in-ийн гэрээнд үлдсэн талбар — баталгаажуулалтын алхам
      // 2026-09-17-нд хасагдсан тул ҮРГЭЛЖ false.
      awaiting_approver: false,
      project_archived: res.body.project_archived ?? false,
      points_awarded: res.body.points_awarded ?? null,
      message: res.body.message,
    },
    201,
  );
});

/* ------------------------------------------------------------------ */
/*  6. Унших туслах гарцууд                                            */
/* ------------------------------------------------------------------ */

/** Нэг илгээлтийн бүрэн аудит мөр.  Илгээгч өөрөө, эсвэл менежер. */
revit.get('/submissions/:id', async (c) => {
  const user = c.get('user');
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id)) return c.json({ error: 'Invalid id' }, 400);

  const row = await c.env.DB.prepare(
    `SELECT rs.*, t.name AS task_name, p.name AS project_name, u.full_name AS submitter_name
       FROM revit_submissions rs
       LEFT JOIN tasks t    ON t.id = rs.task_id
       LEFT JOIN projects p ON p.id = rs.project_id
       LEFT JOIN users u    ON u.id = rs.user_id
      WHERE rs.id = ?`,
  )
    .bind(id)
    .first<Record<string, unknown>>();
  if (!row) return c.json({ error: 'Not found' }, 404);
  if (Number(row.user_id) !== user.sub && !isManager(user.role)) {
    return c.json({ error: 'Хандах эрхгүй' }, 403);
  }
  return c.json({ submission: row });
});

/** Тухайн төслийн бүх холбоос — вэбийн админ таб уншина (шүүмж #9). */
revit.get('/projects/:id/bindings', async (c) => {
  const user = c.get('user');
  const projectId = Number(c.req.param('id'));
  if (!Number.isInteger(projectId)) return c.json({ error: 'Invalid id' }, 400);
  if (!(await canAccessProject(c.env.DB, user, projectId))) {
    return c.json({ error: 'Энэ төсөлд хандах эрхгүй байна' }, 403);
  }

  const { results } = await c.env.DB.prepare(
    `SELECT rb.id, rb.sheet_uid, rb.sheet_number, rb.sheet_name, rb.status,
            rb.match_source, rb.confidence, rb.drawing_id, rb.task_id,
            rb.last_seen_at, rb.bound_at,
            d.name AS drawing_name, t.name AS task_name,
            rd.id AS document_id, rd.file_name, rd.is_link
       FROM revit_sheet_bindings rb
       INNER JOIN revit_documents rd ON rd.id = rb.revit_document_id
       LEFT JOIN drawings d ON d.id = rb.drawing_id
       LEFT JOIN tasks    t ON t.id = rb.task_id
      WHERE rb.project_id = ? AND rb.user_id IS NULL
      ORDER BY rd.file_name, rb.sheet_number`,
  )
    .bind(projectId)
    .all();

  return c.json({ bindings: results ?? [] });
});

/** Холбоосыг ЗӨӨЛӨН устгана — мөр үлдэж, төлөв нь 'ignored' болно. */
revit.delete('/bindings/:id', async (c) => {
  const user = c.get('user');
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id)) return c.json({ error: 'Invalid id' }, 400);

  const row = await c.env.DB.prepare(
    'SELECT id, bound_by, project_id FROM revit_sheet_bindings WHERE id = ?',
  )
    .bind(id)
    .first<{ id: number; bound_by: number | null; project_id: number }>();
  if (!row) return c.json({ error: 'Not found' }, 404);
  if (row.bound_by !== user.sub && !isManager(user.role)) {
    return c.json({ error: 'Хандах эрхгүй' }, 403);
  }

  await c.env.DB.prepare(
    `UPDATE revit_sheet_bindings
        SET status = 'ignored', updated_at = datetime('now') WHERE id = ?`,
  )
    .bind(id)
    .run();
  return c.json({ ok: true });
});


/* ------------------------------------------------------------------ */
/*  7. POST /agent/turn — AI туслахын НЭГ ээлж                          */
/* ------------------------------------------------------------------ */

/**
 * ⚠️ Давталтыг ADD-IN эзэмшинэ, энэ бол ТӨЛӨВГҮЙ прокси.
 *
 * Урсгал: add-in ярианы түүхээ илгээнэ → сервер нэг assistant ээлж буцаана →
 * `stop_reason === 'tool_use'` бол add-in хэрэгслүүдийг REVIT ДОТОР
 * гүйцэтгээд, `tool_result`-уудыг нэмээд дахин илгээнэ.
 *
 * Сервер ярианы түүхийг ХАДГАЛАХГҮЙ — зөвхөн мета аудит (өртөг, хязгаар).
 */
revit.post('/agent/turn', async (c) => {
  const user = c.get('user');
  const db = c.env.DB;

  const body = await c.req
    .json<{
      run_id?: string;
      turn_id?: string;
      project_id?: number;
      doc?: Record<string, unknown>;
      messages?: unknown;
      tools?: unknown;
      max_tokens?: number;
    }>()
    .catch(() => null);
  if (!body) return c.json({ error: 'Invalid JSON' }, 400);

  const runId = str(body.run_id, 64) || 'run';
  const turnId = str(body.turn_id, 64);
  if (!turnId) return c.json({ error: 'turn_id is required' }, 400);

  // Цагийн хязгаар — өртөг хяналтгүй өсөхөөс сэргийлнэ.
  try {
    const used = await db
      .prepare(
        `SELECT COUNT(*) AS n FROM revit_agent_turns
          WHERE user_id = ? AND created_at > datetime('now', '-1 hour')`,
      )
      .bind(user.sub)
      .first<{ n: number }>();
    if ((used?.n ?? 0) >= MAX_TURNS_PER_HOUR) {
      return c.json(
        {
          error: 'rate_limited',
          message: `Цагт ${MAX_TURNS_PER_HOUR} хүсэлтийн хязгаарт хүрлээ. Түр хүлээнэ үү.`,
        },
        429,
      );
    }
  } catch {
    // Тоолж чадсангүй — хүсэлтийг хаахгүй.
  }

  const clean = sanitizeTurn({ messages: body.messages, tools: body.tools });
  if (!clean.ok) return c.json({ error: clean.error }, 400);

  const provider = await resolveProvider(c.env);
  if (provider === 'off') {
    return c.json({ error: 'AI туслах идэвхгүй байна.' }, 503);
  }

  const result = await runAgentTurn(c.env, provider, {
    messages: clean.messages,
    tools: clean.tools,
    maxTokens: Number(body.max_tokens) || 2000,
    doc: body.doc ?? null,
  });

  // Аудит — хариу буцсаны ДАРАА.  `waitUntil`-ийн зөв хэрэглээ: ээлж аль
  // хэдийн хариулагдсан, энэ бол дагалдах үйлдэл.
  c.executionCtx.waitUntil(
    db
      .prepare(
        `INSERT OR IGNORE INTO revit_agent_turns
           (run_id, turn_id, user_id, project_id, provider, model, degraded,
            stop_reason, tool_names, message_count,
            input_tokens, output_tokens, cache_read_tokens, error)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        runId,
        turnId,
        user.sub,
        Number.isInteger(Number(body.project_id)) ? Number(body.project_id) : null,
        result.provider,
        result.model || null,
        result.degraded ? 1 : 0,
        result.stopReason,
        JSON.stringify(result.toolUses.map((t) => t.name)),
        clean.messages.length,
        Number(result.usage.input_tokens ?? 0),
        Number(result.usage.output_tokens ?? 0),
        Number(result.usage.cache_read_input_tokens ?? 0),
        result.error ?? null,
      )
      .run()
      .catch(() => undefined),
  );

  if (result.error) {
    return c.json({ error: result.error, provider: result.provider }, 502);
  }

  return c.json({
    stop_reason: result.stopReason,
    text: result.text,
    tool_uses: result.toolUses,
    // ⚠️ Add-in үүнийг ЯГ ХЭВЭЭР нь дараагийн assistant мессеж болгоно.
    // `text` + `tool_uses`-аас дахин бүтээвэл tool_use-ийн id алдагдана.
    assistant_content: result.assistantContent,
    model: result.model,
    provider: result.provider,
    degraded: result.degraded,
    dropped_tools: clean.dropped,
    prompt_version: REVIT_AGENT_PROMPT_VERSION,
    usage: result.usage,
  });
});


/* ------------------------------------------------------------------ */
/*  8. Туслахын СУРАЛЦАХ давхарга                                      */
/* ------------------------------------------------------------------ */

/**
 * ⚠️ ЭНЭ БҮЛЭГ НЬ БҮТЭЭГДЭХҮҮНИЙ ЦӨМ.
 *
 * Санаа таних ангилагч нь API, LLM, интернэт ШААРДАХГҮЙ ажилладаг.  Түүнийг
 * сайжруулах ЦОРЫН ГАНЦ зам бол бодит хэрэглээг цуглуулж, шошголж, дахин
 * сургах явдал.  Эдгээр гарц тэр гогцоог хаадаг:
 *
 *   add-in  --logs-->  assistant_logs  --шошго-->  assistant_examples
 *                                                        |
 *                                                    сургалт (Python)
 *                                                        v
 *   add-in  <--model--  assistant_models (is_active = 1)
 */

/** Нэг илгээлтэд хүлээж авах бүртгэлийн дээд тоо. */
const MAX_LOG_BATCH = 200;
/** Нэг бүртгэлийн текстийн дээд урт. */
const MAX_LOG_TEXT = 500;
/** Нэг илгээлтэд нэмэх жишээний дээд тоо. */
const MAX_EXAMPLE_BATCH = 500;

/** Загварын хүлээн зөвшөөрөгдөх санаанууд — twin: `addin/IntentRouter.cs`. */
const ASSISTANT_INTENTS = [
  'submit_progress',
  'list_sheets',
  'isolate_sheet',
  'reset_view',
  'whats_changed',
  'set_baseline',
  'progress_status',
  'help',
  'unknown',
] as const;

function isIntent(v: unknown): boolean {
  return typeof v === 'string' && (ASSISTANT_INTENTS as readonly string[]).includes(v);
}

/**
 * СУРГАЛТЫН КОРПУСЫН БАГИЙН ТАМГА (0238 / 2-6) — ЦОРЫН ГАНЦ уншилт.
 *
 * ⚠️ КЛИЕНТЭЭС ХЭЗЭЭ Ч АВАХГҮЙ.  Add-in `team_code` илгээж чадвал BA-гийн
 *    инженер өөрийгөө IZ гэж зарлаад IZ-ийн корпусыг бохирдуулна, ба
 *    `revit.ts`-ийн курацийн `AND review_status IS NULL` (ЭХНИЙ шийдвэр
 *    ялна) тул тэр алдааг БУЦААХ БОЛОМЖГҮЙ.
 *
 * ⚠️ `is_primary = 1` нь ЗААВАЛ — `users.team_id` (хуучирсан) БИШ, ба
 *    ямар ч харьяалал БИШ.  Продакшн дээр БА багийн бүх гишүүн IZ/EZ-д
 *    ХОЁРДОГЧООР бүртгэлтэй тул шүүлтгүй бол архитекторын мөр IZ рүү очно
 *    (`teamContext.ts:510-520`-ийн ижил хэмжилт).
 *
 * ⚠️ ҮНДСЭН БАГГҮЙ хүн → NULL = КОМПАНИ ДАЯАР.  ТААМАГЛАХГҮЙ.  Тэр мөр
 *    курацийн дараалалд ЯМАР Ч багийн шүүлтээр харагдана (доорх
 *    `team_code IS NULL` салаа) — хянагч л түүнийг багт хуваарилж чадна.
 *
 * ⚠️ ЭНЭ НЬ `resolveTeamContext`-ийн БҮРЭН ШАТ БИШ, ЗОРИУД.  Бүрэн шат нь
 *    `revit_document_id` шаарддаг ба зургаан асуулга явуулдаг;
 *    `POST /assistant/logs` нь өндөр эзлэхүүнтэй, багц бичилт тул НЭГ
 *    хямд асуулга л зөв төлбөр.  Дүрмийн багц татах / олдвор эзэмших
 *    гэх мэт ЖИНХЭНЭ багийн шийдвэрүүд тэр бүрэн шатыг ХЭВЭЭР ашиглана.
 */
async function primaryTeamCodeOf(db: D1Database, userId: number): Promise<string | null> {
  const row = await db
    .prepare(
      `SELECT tm.code AS team_code
         FROM user_teams ut
         JOIN teams tm ON tm.id = ut.team_id
        WHERE ut.user_id = ? AND ut.is_primary = 1
        LIMIT 1`,
    )
    .bind(userId)
    .first<{ team_code: string }>()
    .catch(() => null);
  const code = row?.team_code ?? null;
  // ⚠️ ХЭЛБЭРИЙН ШАЛГАЛТ — `teams.code` нь гараар засагддаг тул хог утга
  //    (жижиг үсэг, зай) сургалтын корпусын тэнхлэг рүү орох ёсгүй.
  return code && isTeamCodeShape(code) ? code : null;
}

/**
 * POST /api/revit/assistant/logs — хэрэглээний багц.
 *
 * ⚠️ Add-in локалд бичээд БАГЦААР илгээдэг тул давхардал БОЛОМЖТОЙ
 * (сүлжээ тасарч дахин илгээх).  `INSERT OR IGNORE` + өвөрмөц индекс
 * түүнийг барина — клиент id-г түлхүүр болгоно.
 */
revit.post('/assistant/logs', async (c) => {
  const user = c.get('user');
  const db = c.env.DB;

  const body = await c.req.json<{ entries?: unknown }>().catch(() => null);
  if (!body || !Array.isArray(body.entries)) {
    return c.json({ error: 'entries must be an array' }, 400);
  }
  if (body.entries.length > MAX_LOG_BATCH) {
    return c.json({ error: `Too many entries (max ${MAX_LOG_BATCH})` }, 413);
  }

  // Бүртгэл унтраасан бол чимээгүй хүлээж авсан мэт хариулна — add-in
  // дахин дахин оролдох ёсгүй.
  const enabled = await db
    .prepare("SELECT value FROM app_settings WHERE key = 'assistant.logging'")
    .first<{ value: string }>()
    .catch(() => null);
  if ((enabled?.value ?? 'on').toLowerCase() === 'off') {
    return c.json({ accepted: 0, logging: 'off' });
  }

  const rows = (body.entries as Array<Record<string, unknown>>)
    .filter((e) => e && typeof e === 'object' && typeof e.text === 'string')
    .map((e) => ({
      id: str(e.id, 40),
      text: str(e.text, MAX_LOG_TEXT),
      predicted: isIntent(e.predicted) ? String(e.predicted) : null,
      confidence: Number.isFinite(Number(e.confidence)) ? Number(e.confidence) : null,
      decided_by: str(e.decided_by, 16) || null,
      corrected: isIntent(e.corrected) ? String(e.corrected) : null,
      // ⚠️ ЧӨЛӨӨТ БИЧВЭР — хэрэглэгч 👎 дарсны дараа «яагаад буруу байсан»
      // гэдгээ бичнэ.  500 тэмдэгтээр таслана: энэ нь долоо хоног тутмын
      // хяналтад уншигдах зүйл, эссэ биш.
      feedback_note: str(e.feedback_note, 500) || null,
      feedback: e.feedback === 1 || e.feedback === -1 ? Number(e.feedback) : null,
      acted: e.acted === true ? 1 : 0,
      doc_uid: str(e.doc_uid, 128) || null,
      revit_version: str(e.revit_version, 16) || null,
      project_id: Number.isInteger(Number(e.project_id)) ? Number(e.project_id) : null,
      // ⚠️ ГАРАЛ ҮҮСЭЛ (0212).  Add-in `model_version`-ыг ЭНЭ ӨӨРЧЛӨЛТӨӨС
      // ӨМНӨӨС илгээж байсан (`AssistantLog.cs:41` DTO, `:185` дүүргэлт);
      // сервер уншдаггүй байсан тул ӨДӨР БҮР ХАЯГДАЖ байв.
      // ⚠️ ЗАЛРУУЛГА (1B аудит).  Энд БА `0212_assistant_log_provenance.sql`-ийн
      // толгойд «add-in `addin_version` илгээхгүй, csproj `<Version>`
      // зарладаггүй» гэж бичсэн нь ХУДАЛ.  Хэмжсэн: `RevitMcpAddin.csproj:47`
      // `<Version>1.1.0</Version>` (+ `:48` FileVersion, `:50`
      // InformationalVersion), `BuildInfo.cs` тэднийг уншиж, `AssistantLog.cs:251`
      // `AddinVersion = BuildInfo.Version` гэж ДҮҮРГЭДЭГ.  Зөвхөн
      // `AssemblyVersion` нь binding identity-ийн улмаас 1.0.0.0-д ЗОРИУД
      // хөлдөөгдсөн — тэр нь ӨӨР талбар.  Миграцыг ЗАСАХГҮЙ (append-only,
      // deploy хүлээж байна); залруулга ЭНД амьдарна.
      model_version: str(e.model_version, 64) || null,
      addin_version: str(e.addin_version, 32) || null,
      // ⚠️ ISO-8601 UTC, КЛИЕНТИЙН цаг (`AssistantLog.cs:18` `ts`).
      // `created_at` нь СЕРВЕРИЙН INSERT цаг бөгөөд бүртгэл БАГЦААР
      // илгээгддэг тул дараалал заахад ТОХИРОХГҮЙ.  Хоёуланг нь хадгална.
      client_ts: isoTs(e.ts),
      // ⚠️ ХЭМЖИЛТ (0216).  Add-in 12 хугацааны талбар илгээдэг
      // (`AssistantLog.cs:66-105` DTO, `:342-376` `AttachTiming` дүүргэлт);
      // 0216 хүртэл сервер НЭГИЙГ Ч уншдаггүй байсан тул Track 1C-ийн БҮХ
      // хэмжилт ӨДӨР БҮР ЧИМЭЭГҮЙ ХАЯГДАЖ байв — `model_version`-ийнхтэй ЯГ
      // ИЖИЛ алдаа, зөвхөн 12 талбар дээр.  «250 мс» гэсэн шаардлагыг энэ
      // өгөгдөлгүйгээр хэмжих БОЛОМЖГҮЙ.
      // ⚠️ NULL vs '{}': `buildTimingJson` нь нэг ч хүчинтэй талбаргүй үед
      // ХООСОН ОБЪЕКТ БИШ, ЯГ NULL буцаана — «хэмжээгүй» (телеметргүй хуучин
      // add-in) ба «хэмжсэн боловч тэр үе шат болоогүй» ХОЁР нь ЯЛГАГДАХ
      // ёстой.  Дэлгэрэнгүй: `lib/assistantLogInsert.ts`.
      timing_json: buildTimingJson(e),
    }))
    .filter((e) => e.id.length > 0 && e.text.length > 0);

  if (rows.length === 0) return c.json({ accepted: 0 });

  // ⚠️ БАГИЙН ТАМГА (0238 / 2-6).  БАГЦАД НЭГ УДАА уншина — мөр бүрд БИШ.
  //    Тэдгээр нь бүгд НЭГ хэрэглэгчийн мөр (`user.sub` bind хийгддэг) тул
  //    нэг утга хангалттай, ба энэ роут нь ХАМГИЙН өндөр эзлэхүүнтэй
  //    бичилт — мөр тутмын нэмэлт round trip нь batch-ийн бүх ашгийг иднэ.
  const teamCode = await primaryTeamCodeOf(db, Number(user.sub));

  // ⚠️ Bind арифметик нь `lib/assistantLogInsert.ts`-ийн БАГАНЫН ЖАГСААЛТААС
  // гарна — энд ГАРААР тоолох зүйл БАЙХГҮЙ.  (Урьд нь энэ тайлбар «12 bind
  // → 8 мөр» гэж бичигдээд тогтмол нь 13 байсан: 0200-ийн `feedback_note`
  // нэмэгдэхэд тогтмол засагдаж, тайлбар хоцорсон.  `tsc` тэр зөрүүг
  // барихгүй, алдаа нь ЭХНИЙ БҮТЭН БАГЦ дээр D1-ийн bind-count алдаа болж
  // гарна.)  Гурвалсан нийцлийг `assistantLogInsert.test.ts` барина.
  // Одоо: 17 багана → floor(100 / 17) = 5 мөр/statement → 85 bind ≤ 100.
  const PER = ASSISTANT_LOG_ROWS_PER_STATEMENT;
  const stmts: D1PreparedStatement[] = [];
  for (let i = 0; i < rows.length; i += PER) {
    const chunk = rows.slice(i, i + PER);
    const values = chunk.map(() => ASSISTANT_LOG_TUPLE).join(', ');
    const binds: unknown[] = [];
    for (const r of chunk) {
      // ⚠️ ДАРААЛАЛ нь `ASSISTANT_LOG_COLUMNS`-тай ЯГ ТААРАХ ЁСТОЙ.
      // Шинэ багана ЗААВАЛ ТӨГСГӨЛД нэмэгдэнэ — дунд нь оруулбал bind бүр
      // нэг байрлалаар гулсаж, ЧИМЭЭГҮЙ буруу баганад бичигдэнэ.
      binds.push(
        user.sub, r.project_id, r.doc_uid, r.revit_version, r.text,
        r.predicted, r.confidence, r.decided_by, r.corrected, r.feedback,
        r.acted, r.id, r.feedback_note,
        r.model_version, r.addin_version, r.client_ts,
        r.timing_json,
        // ⚠️ БАГ (0238).  ЖАГСААЛТЫН ТӨГСГӨЛД — `ASSISTANT_LOG_COLUMNS`-ийн
        //    сүүлийн бичлэгтэй ТААРНА.  Дунд нь оруулбал bind бүр нэг
        //    байрлалаар гулсаж, ЧИМЭЭГҮЙ буруу баганад бичигдэнэ.
        teamCode,
      );
    }
    stmts.push(
      db.prepare(
        `INSERT INTO assistant_logs
           (${ASSISTANT_LOG_COLUMN_SQL})
         VALUES ${values}
         ON CONFLICT (user_id, client_id) DO UPDATE SET
           corrected     = COALESCE(excluded.corrected, assistant_logs.corrected),
           feedback      = COALESCE(excluded.feedback,  assistant_logs.feedback),
           acted         = MAX(excluded.acted, assistant_logs.acted),
           -- ⚠️ COALESCE нь excluded-ыг ТЭРГҮҮНД тавина: тэмдэглэл нь 👎-ээс
           -- ХОЙШ бичигддэг тул хожим ирсэн нь ҮРГЭЛЖ шинэ мэдээлэл.
           feedback_note = COALESCE(excluded.feedback_note, assistant_logs.feedback_note),
           -- ⚠️ ГАРАЛ ҮҮСЛИЙГ ХОЖИМ ИРСЭН УТГААР ДАРЖ БОЛОХГҮЙ — дараалал
           -- нь дээрх feedback_note-ынхтой ЗОРИУД ЭСРЭГ.  Мөр нь 👍/👎
           -- ирэхэд ДАХИН илгээгддэг (AssistantLog.cs нь Sent тугийг
           -- локалд хадгалдаггүй тул Revit асах бүрд ч дахин илгээгдэнэ);
           -- тэр үед add-in аль хэдийн ӨӨР загвар татсан байж болно.  Анхны
           -- шийдвэрийг гаргасан хувилбар л зөв хариулт, тиймээс хуучин нь
           -- ТЭРГҮҮНД.  Андуурвал дахин илгээлт бүр A/B-ийн өгөгдлийг
           -- чимээгүй бохирдуулна.  NULL дээр backfill хэвээр ажиллана.
           model_version = COALESCE(assistant_logs.model_version, excluded.model_version),
           addin_version = COALESCE(assistant_logs.addin_version, excluded.addin_version),
           client_ts     = COALESCE(assistant_logs.client_ts,     excluded.client_ts),
           -- ⚠️ ХЭМЖИЛТ нь ГАРАЛ ҮҮСЛИЙН дүрмийг дагана: ЭХНИЙХ нь ЯЛНА.
           -- Хэмжилт нь тухайн НЭГ эргэлтийн шинж чанар бөгөөд өөрчлөгдөшгүй,
           -- харин мөр нь 👍/👎 ирэхэд ба Revit асах бүрд ДАХИН илгээгддэг.
           -- Дахин илгээлт нь ижил утга авчирна; ялгаа гарвал тэр нь хожим
           -- дахин хэмжсэн ХУДЛАА тоо (ж. кэш халсны дараах хоёр дахь ачаалалт)
           -- байх магадлалтай тул анхныхыг хадгална.  NULL дээр backfill
           -- ажиллана — мөр нь AttachTiming-аас ӨМНӨ flush хийгдсэн бол
           -- хугацаа нь ДАРААГИЙН илгээлтээр ирнэ, тэр нь ЭНЭ салбар.
           timing_json   = COALESCE(assistant_logs.timing_json,   excluded.timing_json),
           -- ⚠️ БАГ (0238) нь ГАРАЛ ҮҮСЛИЙН дүрмийг дагана: ЭХНИЙХ нь ЯЛНА.
           -- Мөр нь сайшаал/цоолт ирэхэд ба Revit асах бүрд ДАХИН
           -- илгээгддэг; тэр хооронд хүний ҮНДСЭН баг өөрчлөгдсөн байж
           -- БОЛНО (шилжсэн).  Асуулт нь «энэ өгүүлбэрийг АЛЬ багийн
           -- ажлын явцад бичив» тул АНХНЫ утга л зөв хариулт — дараа нь
           -- дарж бичих нь түүхэн мөрийг retro-шошголох, learning_events
           -- -ийн «JOIN-оор БИШ, хөлдөөж бич» дүрмийн ЯГ ИЖИЛ шалтгаан.
           -- NULL дээр backfill ХЭВЭЭР ажиллана: үндсэн багаа хожим авсан
           -- хүний хуучин мөр ДАРААГИЙН илгээлтээр шошгологдоно.
           team_code     = COALESCE(assistant_logs.team_code,     excluded.team_code)`,
      ).bind(...binds),
    );
  }
  await db.batch(stmts);

  return c.json({ accepted: rows.length });
});

/**
 * GET /api/revit/assistant/model — идэвхтэй загварын жин.
 *
 * `?have=<version>` дамжуулбал шинэ загвар байхгүй үед жинг ИЛГЭЭХГҮЙ —
 * ~500 KB-ыг Revit асах бүрт татах нь дэмий.
 */
revit.get('/assistant/model', async (c) => {
  const have = str(c.req.query('have'), 64);
  const row = await c.env.DB
    .prepare(
      `SELECT version, weights_json, intents_json, accuracy, example_count, created_at
         FROM assistant_models WHERE is_active = 1 LIMIT 1`,
    )
    .first<{
      version: string;
      weights_json: string;
      intents_json: string;
      accuracy: number | null;
      example_count: number;
      created_at: string;
    }>();

  if (!row) return c.json({ error: 'no_active_model' }, 404);
  if (have && have === row.version) {
    return c.json({ version: row.version, unchanged: true });
  }
  return c.json({
    version: row.version,
    accuracy: row.accuracy,
    example_count: row.example_count,
    created_at: row.created_at,
    // ⚠️ ТҮҮХИЙ JSON мөр — дахин задлан хийхгүй, add-in шууд уншина.
    weights: JSON.parse(row.weights_json),
  });
});

/**
 * POST /api/revit/assistant/models — сургасан загвар байршуулна (admin).
 *
 * ⚠️ Идэвхжүүлэхдээ өмнөхийг унтраана — `idx_assistant_model_active`
 * хэсэгчилсэн өвөрмөц индекс хоёр идэвхтэй загварыг зөвшөөрдөггүй тул
 * дараалал нь ЧУХАЛ: эхлээд бүгдийг унтраа, дараа нь шинийг асаа.
 */
revit.post('/assistant/models', requireAdmin(), async (c) => {
  const user = c.get('user');
  const db = c.env.DB;

  const body = await c.req
    .json<{
      version?: string;
      weights?: unknown;
      accuracy?: number;
      per_intent?: unknown;
      example_count?: number;
      note?: string;
      activate?: boolean;
      // ⚠️ 1B-5 — `eval/run_golden.py --out`-ийн payload.  Хэлбэр:
      //   { dataset_version, manifest_sha256, preprocess_contract, kind,
      //     model_version, partitions:{…}, required:[…], blocked:[], passed }
      // `unknown` санаатай: сервер БҮТЦИЙГ нь баталгаажуулахгүй, зөвхөн
      // `passed` ба `blocked` ХОЁРЫГ уншина (доор).  Багц ургах бүрд энэ
      // төрөл засагдах ёсгүй.
      eval?: unknown;
    }>()
    .catch(() => null);
  if (!body) return c.json({ error: 'Invalid JSON' }, 400);

  const version = str(body.version, 64);
  if (!version) return c.json({ error: 'version is required' }, 400);
  if (!body.weights || typeof body.weights !== 'object') {
    return c.json({ error: 'weights is required' }, 400);
  }

  const w = body.weights as Record<string, unknown>;
  if (!Array.isArray(w.intents) || !Array.isArray(w.coef) || !w.vocab) {
    return c.json({ error: 'weights must have intents, vocab, coef' }, 400);
  }

  const weightsJson = JSON.stringify(body.weights);
  // D1-ийн нэг мөрийн бодит хязгаарт хүрэхгүй байх — 5 MB-аас том загвар
  // бол сургалтын тохиргоо буруу (max_features хэт өндөр).
  if (weightsJson.length > 5_000_000) {
    return c.json({ error: 'weights too large (>5MB) — reduce max_features' }, 413);
  }

  // ⚠️ 1B-5 — GOLDEN БАГЦЫН ОНОО.  Яагаад `note` руу хийж БОЛОХГҮЙ вэ:
  // `str()` нь 500 тэмдэгтээр ЧИМЭЭГҮЙ таслах тул оноо дуусаагүй JSON болж,
  // ямар ч алдаагүй хадгалагдана.  Тиймээс `eval_json` багана (0213).
  const evalRaw =
    body.eval && typeof body.eval === 'object' && !Array.isArray(body.eval)
      ? (body.eval as Record<string, unknown>)
      : null;
  const evalJson = evalRaw ? JSON.stringify(evalRaw) : null;
  if (evalJson && evalJson.length > 100_000) {
    return c.json({ error: 'eval payload too large (>100KB)' }, 413);
  }
  const evalDatasetVersion = evalRaw ? str(evalRaw.dataset_version, 64) || null : null;
  const evalBlocked = Array.isArray(evalRaw?.blocked) ? (evalRaw.blocked as unknown[]) : [];
  // ⚠️ ОНОО нь ЭНЭ ЖИНГИЙНХ мөн үү (1B аудит, P0-B).  `run_golden.py:332` нь
  // `model_version`-ыг оноондоо бичдэг (`:282-284` — `model.json`-ийн
  // `version`-оос).  Түүнийг ТУЛГАХГҮЙ байсан тул ӨЧИГДРИЙН амжилттай
  // eval.json + ДУРЫН ШИНЭ ЖИН = 201 + идэвхжүүлэлт байв: хаалга нь зөвхөн
  // «ямар нэг оноо давсан уу» гэдгийг шалгаад, «ЯМАР загварын оноо вэ»
  // гэдгийг шалгадаггүй байсан.  Одоо гурав дахь нөхцөл болов.
  const evalModelVersion = evalRaw ? str(evalRaw.model_version, 64) : '';
  const evalVersionMatches = evalModelVersion === version;
  // ⚠️ «Давсан» гэдэг нь ГУРВАН нөхцөл: скрипт өөрөө `passed === true` гэсэн,
  // блоклосон хуваарь ТЭГ, БА оноо нь ЯГ ЭНЭ хувилбарынх.  Аль нэг нь дутвал 0.
  // `blocked`-ыг тусад нь шалгах нь `passed`-ыг гараар `true` болгосон
  // payload-ыг барина.
  const evalPassed =
    evalRaw && evalRaw.passed === true && evalBlocked.length === 0 && evalVersionMatches
      ? 1
      : 0;

  // ⚠️⚠️ ГОЛ ХААЛГА (1B-5) — INSERT-ЭЭС ӨМНӨ.  2026-08-28 хүртэл энэ шалгалт
  // INSERT-ийн ДАРАА байсан бөгөөд `ON CONFLICT` салбарт `is_active` БАЙХГҮЙ
  // байсан тул ИЖИЛ `ver` дээр дахин нийтлэхэд `weights_json` ДАРАГДААД
  // `is_active` 1 ХЭВЭЭР үлддэг байв: API нь 409 «идэвхжүүлэх боломжгүй» гэж
  // хариулж байхад `GET /assistant/model` тэр ШИНЭ, ШАЛГАГДААГҮЙ жинг ~20
  // Revit суулгац руу ТАРААДАГ байсан.  Хаалга унасан бол ОДОО ЮУ Ч бичигдэхгүй
  // — амьд загварын жин ХӨНДӨГДӨХГҮЙ.
  //
  // ⚠️ ЮУ АЛДАГДСАН БЭ: «унасан гүйлтийн ТҮҮХ мөр» үлдэхээ болино.  Тэр нь
  // ЗОРИУДЫН СОЛИЛЦОО — амьд загварын жинг хамгаалах нь унасан оролдлогын
  // бүртгэлээс чухал.  Унасан гүйлт нь дуудагчид 409 + `blocked` жагсаалтаар
  // БҮТЭН харагдана (`pull_and_retrain.py` тэр гаралтыг хэвлэдэг).
  //
  // ⚠️ Хөгжүүлэгчийн зөөврийн дээрх Python-ыг засаад загвар өөрийгөө өөрөө
  // «баталгаажуулах» боломжийг хаана — тиймээс шалгалт СЕРВЕР талд байх ЁСТОЙ.
  //
  // ⚠️ НИЙЦТЭЙ БАЙДАЛ: энэ route-ын ЦОРЫН ГАНЦ дуудагч нь
  // `revit-mcp/training/pull_and_retrain.py` (add-in зөвхөн
  // `GET /assistant/model` уншина), тиймээс хаалга нэмэх нь ЯМАР Ч add-in
  // релиз шаардахгүй.  Хуучин Python-оор нийтлэхийг оролдвол ЧАНГА унана —
  // чимээгүй биш.
  if (body.activate !== false && evalPassed !== 1) {
    return c.json(
      {
        error: 'golden багц даваагүй загварыг идэвхжүүлэх боломжгүй',
        version,
        eval: evalRaw
          ? {
              dataset_version: evalDatasetVersion,
              model_version: evalModelVersion || null,
              version_matches: evalVersionMatches,
              blocked: evalBlocked,
              passed: evalRaw.passed === true,
            }
          : null,
        hint: 'python revit-mcp/eval/run_golden.py --kind intent --out eval.json',
      },
      409,
    );
  }

  await db
    .prepare(
      `INSERT INTO assistant_models
         (version, weights_json, intents_json, example_count, accuracy,
          per_intent_json, is_active, note, trained_by,
          eval_json, eval_dataset_version, eval_passed)
       VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?)
       ON CONFLICT (version) DO UPDATE SET
         weights_json    = excluded.weights_json,
         intents_json    = excluded.intents_json,
         example_count   = excluded.example_count,
         accuracy        = excluded.accuracy,
         per_intent_json = excluded.per_intent_json,
         note            = excluded.note,
         -- ⚠️ Ижил хувилбарыг дахин нийтлэхэд оноо нь ч шинэчлэгдэх ёстой,
         -- эс бөгөөс идэвхжүүлэлтийн хаалга ХУУЧИН оноог уншина.
         eval_json            = excluded.eval_json,
         eval_dataset_version = excluded.eval_dataset_version,
         eval_passed          = excluded.eval_passed,
         -- ⚠️⚠️ ЗААВАЛ (1B аудит, P0-B).  Энэ мөр байхгүй үед activate: false
         -- нь хаалганы ХОЁР ДАХЬ ТОЙРУУ ЗАМ байв: дээрх 409 нь зөвхөн
         -- activate !== false үед ажилладаг тул «идэвхжүүлэхгүй» гэж
         -- хэлээд ИДЭВХТЭЙ хувилбарын жинг дарж бичихэд шалгагдаагүй жин
         -- шууд GET /assistant/model-оор тарж эхэлнэ.  Одоо ЖИН СОЛИГДОХ
         -- БҮРД мөр УНТАРНА, ба зөвхөн доорх ИЛ идэвхжүүлэлт (хаалга давсны
         -- дараа) буцааж асаана.  ⇒ ИНВАРИАНТ: is_active = 1 мөрийн жин нь
         -- ҮРГЭЛЖ golden давсан жин.
         --
         -- ⚠️ ҮНЭ: activate: false-оор идэвхтэй хувилбарыг дарж бичвэл
         -- GET /assistant/model 404 өгч эхэлнэ.  Add-in түүнийг ТЭСВЭРЛЭНЭ
         -- (model_load_source = local|embedded — локал кэш/суулгасан жингээ
         -- үргэлжлүүлж хэрэглэнэ), тиймээс энэ нь зогсолт биш, шинэчлэлийн
         -- түр саатал.  Шалгагдаагүй жин тараахаас хамаагүй бага хор хөнөөлтэй.
         is_active            = 0`,
    )
    .bind(
      version,
      weightsJson,
      JSON.stringify(w.intents),
      Number(body.example_count) || 0,
      Number.isFinite(Number(body.accuracy)) ? Number(body.accuracy) : null,
      body.per_intent ? JSON.stringify(body.per_intent) : null,
      str(body.note, 500) || null,
      user.sub,
      evalJson,
      evalDatasetVersion,
      evalPassed,
    )
    .run();

  if (body.activate !== false) {
    await db.batch([
      db.prepare('UPDATE assistant_models SET is_active = 0 WHERE is_active = 1'),
      db.prepare('UPDATE assistant_models SET is_active = 1 WHERE version = ?').bind(version),
    ]);
  }

  return c.json(
    { version, activated: body.activate !== false, eval_passed: evalPassed },
    201,
  );
});

/**
 * GET /api/revit/assistant/borderline — ХИЛИЙН ЗУРВАС дахь бүртгэлүүд (admin).
 *
 * `revit-mcp/eval/nominate.py` `difficult_cases` руу нэр дэвшүүлэхэд
 * ашиглана.  Доорх `/assistant/pending` энэ ажилд ТОХИРОХГҮЙ: `confidence`-ыг
 * БУЦААДАГ ч түүгээр ШҮҮДЭГГҮЙ, `limit` дээд тал 200, эрэмбэ нь curation-ы
 * үнэ цэнээр — тиймээс зурвасын түүвэр гаргах боломжгүй.
 *
 * ⚠️ Босго нь `revit-mcp/addin/IntentRouter.cs:81` дээр ЭМХЭТГЭГДДЭГ (0.45).
 * `app_settings['assistant.min_confidence']`-ыг репо даяар ХЭН Ч УНШДАГГҮЙ
 * (`0195_assistant_learning.sql:154-156` өөрөө ингэж бичсэн) — тиймээс
 * зурвасыг ДУУДАГЧ дамжуулна, сервер таамаглахгүй.
 *
 * ⚠️ `requireAdmin()`: түүхий хэрэглэгчийн текст гардаг тул
 * `/assistant/export`-тэй ИЖИЛ түвшин, `/assistant/pending`-ийн
 * admin|senior-оос чанга.
 *
 * ⚠️ 3 bind — D1-ийн 100 bind хязгаарт ойрхон ч биш.
 */
revit.get('/assistant/borderline', requireAdmin(), async (c) => {
  const lo = Math.max(0, Math.min(1, Number(c.req.query('lo')) || 0.38));
  const hi = Math.max(lo, Math.min(1, Number(c.req.query('hi')) || 0.52));
  const limit = Math.min(500, Math.max(1, Number(c.req.query('limit')) || 200));
  const { results } = await c.env.DB
    .prepare(
      `SELECT id, text, predicted, confidence, decided_by, corrected,
              feedback, feedback_note, acted, created_at
         FROM assistant_logs
        WHERE confidence IS NOT NULL
          AND confidence BETWEEN ? AND ?
          AND curated = 0
        ORDER BY created_at DESC
        LIMIT ?`,
    )
    .bind(lo, hi, limit)
    .all();
  return c.json({ band: { lo, hi }, rows: results ?? [] });
});

/**
 * GET /api/revit/assistant/pending — шошголоогүй бүртгэлүүд (admin/senior).
 *
 * Эрэмбэ нь САНААТАЙ: эхлээд хүн ЗАСВАРЛАСАН мөрүүд (эдгээр нь аль хэдийн
 * зөв шошготой — шууд жишээ болно), дараа нь 👎 авсан, дараа нь fallback
 * дээр зогссон.  Хамгийн үнэ цэнтэй нь дээрээ.
 */
revit.get('/assistant/pending', async (c) => {
  const user = c.get('user');
  if (!isManager(user.role)) return c.json({ error: 'Хандах эрхгүй' }, 403);

  const limit = Math.min(200, Math.max(1, Number(c.req.query('limit')) || 50));

  // ⚠️ ХОЁР ГОРИМ, НЭГ ГАРЦ.  `?status=promoted|rejected` бол «хянасан
  // түүх» (migration 0214-ийн `review_status`); эс бөгөөс шошголоогүй
  // ДАРААЛАЛ.  Bind: status ? [status, limit] : [limit] — D1-ийн 100 bind
  // хязгаарт огт ойртохгүй.
  const rawStatus = c.req.query('status');
  const status = rawStatus === 'promoted' || rawStatus === 'rejected' ? rawStatus : null;

  // ⚠️ ЯАГААД БАГИЙН ШҮҮЛТ ЗААВАЛ ВЭ (0238 / 2-6):
  //    `isManager` нь admin ЭСВЭЛ senior — багийн гишүүнчлэлийн шалгалт
  //    ХААНА Ч БАЙХГҮЙ.  Тиймээс BA-гийн senior нь IZ-ийн инженерийн
  //    мөрийг харж, шошголж, дэвшүүлж чадна.  Доорх `AND review_status IS
  //    NULL` нь ЭХНИЙ шийдвэрийг ялагч болгодог тул тэр алдааг БУЦААХ
  //    БОЛОМЖГҮЙ — багийн корпус БАЙНГА бохирдоно (v2 §82-ийн 4-р шалгуур:
  //    ТЭГ хөндлөн багийн алдагдал).
  // ⚠️ ЭНЭ НЬ ХАРАХ ХЭРЭГСЭЛ, ХАМГААЛАЛТ БИШ — `?team=` нь СОНГОЛТ хэвээр
  //    (шүүлтгүй бол бүх багийн мөр харагдана, шипсэн зан төлөв
  //    ХАДГАЛАГДАНА).  Сургалтын ЖИНХЭНЭ хаалга нь `team_rule_scope` ба
  //    `model_capabilities` дээр.
  // ⚠️ ХЭЛБЭР ТААРАХГҮЙ бол ШҮҮЛТГҮЙ — 400 БИШ.  Хог параметр нь курацийн
  //    дарааллыг зогсоох ёсгүй; SQL руу ХЭЗЭЭ Ч задлагдаагүй мөр очихгүй
  //    (`isTeamCodeShape` + bind).
  const teamRaw = (c.req.query('team') || '').trim().toUpperCase();
  const team = isTeamCodeShape(teamRaw) ? teamRaw : null;

  const clauses: string[] = [
    status ? 'l.review_status = ?' : 'l.curated = 0 AND l.review_status IS NULL',
  ];
  // ⚠️ ЭНЭ МАССИВЫГ `binds` ГЭЖ НЭРЛЭЖ БОЛОХГҮЙ.
  //    `assistantExampleInsert.test.ts`-ийн гурав дахь хөл нь эх файлаас
  //    олон мөрт bind-түлхэлтийн блокуудыг REGEX-ЭЭР олж, дараагийн
  //    `INSERT INTO <хүснэгт>`-ээр нь ялгадаг.  Энэ роутын НЭГ МӨРИЙН
  //    түлхэлт тэр загварыг эхлүүлээд хамгийн ойрын олон мөрийн хаалт
  //    хүртэл ЗАЛГИЖ, дараа нь `assistant_examples`-ийн INSERT-тэй
  //    холбогдож, bind тоог 14-ийн оронд 27 гэж уншуулж байв — өөрөөр
  //    хэлбэл ГУРВАЛСАН НИЙЦЛИЙН хамгаалалт ЧИМЭЭГҮЙ ХУДАЛ УНАЖ байв.
  //    Өөр нэр = тэр мөргөлдөөн БАЙХГҮЙ.
  const pendBinds: unknown[] = [];
  if (status) pendBinds.push(status);
  if (team) {
    // ⚠️ NULL-ыг ЗОРИУД ОРУУЛНА: багийг тодорхойлж чадаагүй мөр (үндсэн
    //    баггүй хэрэглэгч) хаана ч харагдахгүй болж ХОГ БОЛОХ ёсгүй.
    //    Тэднийг багийн шүүлт ямар ч байсан харуулна — хянагч л тэдгээрийг
    //    багт хуваарилж чадна.
    clauses.push('(l.team_code = ? OR l.team_code IS NULL)');
    pendBinds.push(team);
  }
  const where = clauses.join(' AND ');
  // ⚠️ Bind тооцоо: status (0..1) + team (0..1) + limit (1) = дээд тал нь 3.
  pendBinds.push(limit);

  const { results } = await c.env.DB
    .prepare(
      `SELECT l.id, l.user_id, l.project_id, l.text, l.predicted, l.confidence,
              l.decided_by, l.corrected, l.feedback, l.feedback_note, l.acted,
              l.created_at, l.review_status, l.reviewed_at, l.review_note,
              -- ⚠️ 0238: хянагч аль БАГИЙН материалыг дэвшүүлж байгаагаа
              -- ХАРАХ ёстой.  NULL = «компани даяар / баг тодорхойгүй».
              l.team_code,
              -- ⚠️ 0212: шошголж буй хүн «энэ мөрийг АЛЬ загвар гаргасан бэ»
              -- гэдгийг харна.  Хуучин assistant_logs уншигч frontend
              -- БАЙГААГҮЙ тул нэмэлт талбар юуг ч эвдэхгүй.
              -- ⚠️ addin_version мөн ЭНД: 0212-ийн гурван баганын гуравдугаарх
              -- нь SELECT-д байхгүй байсан тул «энэ мөрийг АЛЬ add-in build
              -- гаргасан бэ» гэдэг ХЭЗЭЭ Ч уншигдахгүй байв.  Талбар нэмэх нь
              -- зөвхөн НЭМЭЛТ — хуучин клиент эвдрэхгүй.
              l.model_version, l.addin_version, l.client_ts,
              u.full_name AS user_name,
              r.full_name AS reviewer_name
         FROM assistant_logs l
         LEFT JOIN users u ON u.id = l.user_id
         LEFT JOIN users r ON r.id = l.reviewed_by
        WHERE ${where}
        ORDER BY
          ${status ? 'l.reviewed_at DESC,' : ''}
          CASE
            -- ⚠️ ТЭМДЭГЛЭЛТЭЙ мөр ТЭРГҮҮНД.  Хүн бичих гэж цаг зарцуулсан
            -- бол тэр нь хамгийн үнэ цэнтэй хяналтын материал.
            WHEN l.feedback_note IS NOT NULL THEN -1
            WHEN l.corrected IS NOT NULL THEN 0
            WHEN l.feedback = -1         THEN 1
            WHEN l.decided_by = 'fallback' THEN 2
            ELSE 3
          END,
          l.created_at DESC
        LIMIT ?`,
    )
    .bind(...pendBinds)
    .all();

  return c.json({ pending: results ?? [], team });
});

/** `assistant_examples`-д бичих МӨРИЙН хэлбэр. */
interface AssistantExampleRow {
  text: string;
  intent: string;
  slot: string | null;
  style: string | null;
  source: string;
  source_type: string;
  review_state: string;
  origin_log_id: number | null;
  team_code: string | null;
}

/**
 * `assistant_examples`-ийн БАГЦ INSERT — ЦОРЫН ГАНЦ хуулбар.
 *
 * ⚠️ ЯАГААД ФУНКЦ ВЭ (2026-09-01): курацийн ХОЁР гарц энэ INSERT-ийг
 *    дуудна — `POST /assistant/examples` (мөр тус бүр) ба
 *    `POST /assistant/bulk-review` (багц).  Хоёр ХУУЛБАР байвал bind-ийн
 *    ДАРААЛАЛ зөрөх боломж нээгдэнэ; `tsc` тэр зөрүүг БАРИХГҮЙ (бүгд
 *    `unknown[]`), ба `assistantExampleInsert.test.ts`-ийн гурав дахь хөл
 *    нь эх файлаас ЭХНИЙ `binds.push` блокийг л шалгадаг тул ХОЁР ДАХЬ
 *    хуулбар ХАМГААЛАЛТГҮЙ үлдэх байв.  Нэг хуулбар = тэр эрсдэл АЛГА.
 *
 * ⚠️ Дуудагч нь `review_state`-ыг ӨӨРӨӨ шийднэ; `'rejected'`-ыг ЭНД
 *    хүлээж авахгүй (татгалзал нь `POST /assistant/reject`-ийн ажил, тэнд
 *    `is_active = 0` мөн зэрэг бичигдэнэ).
 */
function assistantExampleStatements(
  db: D1Database,
  rows: readonly AssistantExampleRow[],
  createdBy: number,
): D1PreparedStatement[] {
  // ⚠️ Bind арифметик нь `lib/assistantExampleInsert.ts`-ийн СПЕЦЭЭС гарна —
  //    энд ГАРААР тоолох зүйл БАЙХГҮЙ.  2026-08-28-нд ГУРВАН сесс энэ нэг
  //    INSERT-ийг зэрэг өргөжүүлэв (багана 7 → 13, bind 7 → 13); тэр гурвалсан
  //    нийцлийг `assistantExampleInsert.test.ts` барина.
  //    Одоо: 13 bind/мөр → floor(100 / 13) = 7 мөр/statement → 91 bind ≤ 100.
  const PER = ASSISTANT_EXAMPLE_ROWS_PER_STATEMENT;
  const stmts: D1PreparedStatement[] = [];
  for (let i = 0; i < rows.length; i += PER) {
    const chunk = rows.slice(i, i + PER);
    const values = chunk.map(() => ASSISTANT_EXAMPLE_TUPLE).join(', ');
    const binds: unknown[] = [];
    for (const r of chunk) {
      // ⚠️ ДАРААЛАЛ нь `ASSISTANT_EXAMPLE_COLUMN_SPEC`-тэй ЯГ ТААРАХ ЁСТОЙ.
      //    `reviewed_at` нь bind БИШ, SQL талын CASE — гэхдээ нөхцөлдөө
      //    `review_state`-ыг ДАХИН bind хийдэг тул тэр байрлалд НЭГ утга
      //    түлхэгдэнэ.  Яагаад CASE вэ: `datetime('now')` нь `created_at`-тай
      //    ИЖИЛ форматтай (JS-ийн ISO мөр форматын дрифт үүсгэнэ), ба
      //    'pending' мөрд NULL үлдээх ёстой — ХЯНААГҮЙ мөрөнд хяналтын
      //    хугацаа бичих нь гарал үүслийг ХУДЛАА болгоно.
      binds.push(
        r.text, foldText(r.text), r.intent, r.slot, r.style, r.source, createdBy,
        r.source_type,
        r.review_state,
        r.review_state === 'pending' ? null : createdBy,
        r.review_state,          // ← CASE-ийн нөхцөл (reviewed_at)
        r.origin_log_id,         // origin_log_id  (0215)
        r.origin_log_id,         // source_log_id  (0214) — ЯГ ИЖИЛ утга
        r.team_code,             // team_code      (0238) — СЕРВЕР шийдсэн
      );
    }
    stmts.push(
      db.prepare(
        `INSERT INTO assistant_examples
           (${ASSISTANT_EXAMPLE_COLUMN_SQL})
         VALUES ${values}
         -- ⚠️ ЗОРИЛТ нь 0238-ын idx_assistant_ex_uniq индексийн
         -- илэрхийллийн жагсаалттай ЯГ ТААРАХ ЁСТОЙ.  SQLite-ийн upsert
         -- зорилт нь ОРШИН БАЙГАА өвөрмөц индекстэй таарахгүй бол
         -- «ON CONFLICT clause does not match any PRIMARY KEY or UNIQUE
         -- constraint» өгч БҮХ курацийн бичилт унана.  Тогтмолыг
         -- lib/assistantExampleInsert.ts эзэмшинэ — энд ГАРААР бичихгүй.
         -- ⚠️ ЭНЭ БОЛ ЯГ ТЭР ӨӨРЧЛӨЛТ: хуучин хос индекс нь хоёр багийг
         -- НЭГ өгүүлбэрийг ӨӨРӨӨР шошголохыг БИЕТ БАЙДЛААР хориглодог
         -- байсан (v2 §50-R5-ын долоон шинжийн ХОЁР ДАХЬ нь боломжгүй байв).
         ON CONFLICT (${ASSISTANT_EXAMPLE_CONFLICT_TARGET}) DO UPDATE SET
           is_active     = 1,
           review_state  = excluded.review_state,
           source_type   = excluded.source_type,
           reviewed_by   = COALESCE(excluded.reviewed_by, assistant_examples.reviewed_by),
           reviewed_at   = COALESCE(excluded.reviewed_at, assistant_examples.reviewed_at),
           origin_log_id = COALESCE(assistant_examples.origin_log_id, excluded.origin_log_id),
           source_log_id = COALESCE(assistant_examples.source_log_id, excluded.source_log_id),
           slot          = COALESCE(excluded.slot, assistant_examples.slot)
         -- ⚠️ ЗААВАЛ.  Үүнгүйгээр is_active = 1 нь ТАТГАЛЗСАН жишээг
         -- чимээгүй АМИЛУУЛЖ, 0195:50-ын («муу жишээг устгахгүй, унтраана»)
         -- бүх зорилгыг устгана.
         WHERE assistant_examples.review_state <> 'rejected'`,
      ).bind(...binds),
    );
  }
  return stmts;
}

/**
 * POST /api/revit/assistant/examples — шошголсон жишээ нэмнэ (admin/senior).
 *
 * `log_ids` дамжуулбал тэдгээрийг `curated = 1` болгоно — дахин гарч ирэхгүй.
 */
revit.post('/assistant/examples', async (c) => {
  const user = c.get('user');
  if (!isManager(user.role)) return c.json({ error: 'Хандах эрхгүй' }, 403);

  const db = c.env.DB;
  const body = await c.req
    .json<{ examples?: unknown; log_ids?: unknown }>()
    .catch(() => null);
  if (!body || !Array.isArray(body.examples)) {
    return c.json({ error: 'examples must be an array' }, 400);
  }
  if (body.examples.length > MAX_EXAMPLE_BATCH) {
    return c.json({ error: `Too many examples (max ${MAX_EXAMPLE_BATCH})` }, 413);
  }

  // ⚠️ ЭХ СУРВАЛЖ ЗААВАЛ.  ӨМНӨ НЬ анхдагч нь 'usage' байсан — гараар шивсэн
  // мөр «бодит хэрэглээнээс ажиглагдсан» гэж ХУДАЛ бүртгэгддэг байв.  Одоо
  // 'usage' бол эх бүртгэлийн ХОЛБООС (log_id) заавал, эс бөгөөс 'manual'
  // гэж ИЛ тэмдэглэнэ.  Ингэж байж «корпусын хэдэн хувь нь БОДИТ вэ» гэсэн
  // асуултад хариулж чадна.
  let badSource = false;
  const draft = (body.examples as Array<Record<string, unknown>>)
    .filter((e) => e && typeof e.text === 'string' && isIntent(e.intent))
    .map((e) => {
      const src = e.source;
      if (src !== 'seed' && src !== 'manual' && src !== 'usage') {
        badSource = true;
        return null;
      }
      // ⚠️ `posId` — `Number(...)` БИШ (1B аудит, P1).  `log_id: null` нь
      //    `Number(null) === 0` болж `Number.isInteger`-ыг ДАВДАГ тул
      //    'usage' эх сурвалж «холбоостой» гэж тооцогдоод, дараа нь
      //    `origin_log_id = 0` гэсэн ОРШИН БАЙХГҮЙ холбоос бичигддэг байв.
      const logId = posId(e.log_id);
      if (src === 'usage' && logId === null) {
        badSource = true;
        return null;
      }
      // ⚠️ НЭГ УТГА, ХОЁР БАГАНА.  `source_log_id` (0214) ба `origin_log_id`
      // (0215) нь ХОЁР ТУСДАА сессийн нэмсэн, УТГА НЬ ЯГ ИЖИЛ багана:
      // «энэ жишээ АЛЬ түүхий бүртгэлээс гарсан бэ».  Хоёр миграц хоёулаа
      // продакшнд очих тул аль нэгийг нь NULL үлдээвэл тэр талын индекс үхэж,
      // тухайн уншигч (dataset lineage) ХООСОН хариу авна.  Тиймээс хоёуланг
      // нь ЭНЭ НЭГ илэрхийллээс бичнэ — зөрөх боломж ФИЗИКИЙН ХУВЬД алга.
      // Клиент `origin_log_id`-г ил илгээж болно; эс бөгөөс `log_id` (1B-6-ийн
      // курацийн UI-ийн илгээдэг талбар) уруу унана.
      const origin = posId(e.origin_log_id) ?? (src === 'usage' ? logId : null);
      return {
        text: str(e.text, MAX_LOG_TEXT),
        intent: String(e.intent),
        slot: str(e.slot, 64) || null,
        style: str(e.style, 24) || null,
        source: src,
        // ⚠️ ЭХ СУРВАЛЖИЙН ТӨРӨЛ ЭНД ТОГТОХГҮЙ (гэрээ G1).  Клиентийн
        //    зарласныг ЗӨВХӨН түүхийгээр нь авч явна; эцсийн утгыг доорх
        //    `deriveSourceType` СЕРВЕР талд, `curation_action` ба
        //    `assistant_logs.predicted`-аас ургуулна.  Хуучин код энд
        //    'UNKNOWN'-ыг анхдагч болгодог байсан нь 0215-ийн
        //    `manual → HUMAN` backfill-тай ЗӨРЖ, «өнөөдрөөс хойших хүний
        //    БҮХ хөдөлмөр сургалтад тэнцэхгүй» гэсэн байнгын алдаа болж байв.
        source_type_declared: typeof e.source_type === 'string' ? e.source_type : null,
        // ⚠️ Хянагчийн ИЛ үйлдэл: approved | corrected | manual.
        //    TWIN: `frontend/src/features/revit-assistant/curation.ts`.
        //    Байхгүй бол (хуучин клиент) `source`-оос ургуулна — дэривэц нь
        //    `UNKNOWN` буцаах ЗАМГҮЙ тул G1 хангагдна.
        curation_action: (CURATION_ACTIONS as readonly string[]).includes(
          String(e.curation_action),
        )
          ? (String(e.curation_action) as CurationAction)
          : null,
        // ⚠️ Курацийн UI-аас ирсэн дэвшүүлэлт нь тодорхойлолтоороо ХҮН ХАРСАН
        //    мөр тул өгөгдмөл нь 'verified'.  Багц импорт хийх бол клиент
        //    'pending' илгээнэ — тэр үед reviewed_by/reviewed_at NULL үлдэнэ,
        //    өөрөөр хэлбэл ХУДАЛ хяналтын тэмдэглэгээ ХЭЗЭЭ Ч бичигдэхгүй.
        // ⚠️ 'rejected'-ыг клиентээс ЗОРИУД хүлээж авахгүй (`CLIENT_REVIEW_STATES`):
        //    татгалзал нь `POST /assistant/reject`-ийн ажил, тэнд `is_active = 0`
        //    мөн зэрэг бичигдэж `is_active = 0 ⟺ review_state = 'rejected'`
        //    инвариантыг хадгална.
        review_state: (CLIENT_REVIEW_STATES as readonly string[]).includes(
          String(e.review_state),
        )
          ? String(e.review_state)
          : 'verified',
        origin_log_id: origin,
        // ⚠️ БАГ ЭНД ТОГТОХГҮЙ (0238 / 2-6, гэрээ G1).  Клиентийн зарласныг
        //    ЗӨВХӨН түүхийгээр нь авч явна; эцсийн утгыг доорх
        //    `resolveExampleTeam` СЕРВЕР талд, ГАРАЛ ҮҮСЛИЙН БҮРТГЭЛИЙН
        //    `assistant_logs.team_code`-оос ургуулна — `deriveSourceType`
        //    -тэй ЯГ ИЖИЛ загвар.
        team_declared:
          typeof e.team_code === 'string' ? e.team_code.trim().toUpperCase() : null,
      };
    })
    .filter((e): e is NonNullable<typeof e> => e !== null && e.text.length > 0);

  if (badSource) {
    return c.json({ error: 'each example needs source; source="usage" requires log_id' }, 400);
  }

  // ⚠️ `ids`-ийг ЭРТ БУЦААЛТААС ӨМНӨ тооцно.  Урьд нь `ids` энэ роутын доод
  //    хэсэгт тооцогдож байсан тул `rows.length === 0` үед энд эрт буцаж,
  //    `curated` ХЭЗЭЭ Ч тавигдахгүй байв — тэр бүртгэлүүд `/assistant/pending`
  //    (`WHERE l.curated = 0`)-д ҮҮРД эргэж гардаг байсан.  «Энэ батчид
  //    дэвшүүлэх юм алга» гэдэг нь ХҮЧИНТЭЙ хариулт.
  // ⚠️ `idList` — `.map(Number).filter(Number.isInteger)` БИШ (1B аудит, P1).
  //    Хуучин хувилбар нь `[null]`-ыг `[0]`, `[true]`-г `[1]` болгодог тул
  //    `log_ids: [true]` илгээхэд БОДИТ бүртгэл id = 1 «хянагдсан» гэж
  //    чимээгүй хаагддаг байв.
  const ids = idList(body.log_ids, 500);

  if (draft.length === 0 && ids.length === 0) return c.json({ added: 0, curated: 0 });

  // ⚠️⚠️ СЕРВЕР ДЭРИВЭЦ (гэрээ G1) — «клиент ХУДАЛ ЗАРЛАЖ ЧАДАХГҮЙ».
  //    `HUMAN_VERIFIED` гэдэг нь «машин ТААСАН, хүн БАТАЛСАН» гэсэн үг.
  //    Машины таамаг байсан эсэхийг КЛИЕНТЭЭС асуувал тэр нь зарлал болно;
  //    тиймээс `assistant_logs.predicted`-ыг ЭНД ӨӨРСДӨӨ уншина.  Нэмэлт
  //    ашиг: D1 нь ажиллах үед гадаад түлхүүрийг шалгадаггүй тул ОРШИН
  //    БАЙХГҮЙ бүртгэл рүү заасан `origin_log_id`/`source_log_id` чимээгүй
  //    бичигддэг байсныг ч ЭНЭ УНШИЛТ барина.
  //
  // ⚠️ 90-ийн чанк: D1-ийн 100 bind/statement.  Багц 500 бол 6 хүсэлт —
  //    энэ роут нь admin|senior-ын ГАРААР дардаг курацийн үйлдэл тул
  //    эзлэхүүн бага, зардал үл мэдэгдэхүйц.
  const originIds = [
    ...new Set(
      draft.map((d) => d.origin_log_id).filter((n): n is number => n !== null),
    ),
  ];
  const predictedOf = new Map<number, string | null>();
  const originTeamOf = new Map<number, string | null>();
  for (let i = 0; i < originIds.length; i += 90) {
    const chunk = originIds.slice(i, i + 90);
    const { results } = await db
      .prepare(
        // ⚠️ 0238: team_code-ыг ЯГ ЭНЭ уншилтаас авна — нэмэлт round trip
        //    БАЙХГҮЙ.  Гарал үүслийн бүртгэлийн баг нь ХАМГИЙН ИТГЭЛТЭЙ
        //    эх сурвалж: тэр мөрийг СЕРВЕР бичсэн (primaryTeamCodeOf),
        //    хянагчийн өөрийн баг ОГТ ОРОЛЦООГҮЙ.
        `SELECT id, predicted, team_code FROM assistant_logs WHERE id IN (${chunk
          .map(() => '?')
          .join(',')})`,
      )
      .bind(...chunk)
      .all<{ id: number; predicted: string | null; team_code: string | null }>();
    for (const r of results ?? []) {
      predictedOf.set(r.id, r.predicted);
      originTeamOf.set(r.id, r.team_code);
    }
  }

  // ⚠️ ХЯНАГЧИЙН ИЛ ЗАРЛАСАН БАГИЙГ АМЬД `teams`-ЭЭС ШАЛГАНА (0238 / 2-6).
  //    Тоо (7 · 8 · 9 · 11) ХЭЗЭЭ Ч кодод бичигдэхгүй — эзэн 2026-08-30-нд
  //    найман салбарын багийг баталсан ч тэр нь ТӨЛӨВЛӨЛТИЙН баримт,
  //    эмхэтгэх тогтмол БИШ.  MGMT / EZ / GT нь ХҮЧИНТЭЙ `team_code`
  //    хэвээр — тэд зөвхөн ДҮРМИЙН БАГЦГҮЙ (`team_rule_scope`-д мөргүй),
  //    хүчингүй БИШ.  Тэдний материалыг курацид шошголох нь ЗӨВ: v2 §72 нь
  //    мөр БҮРИЙГ багаар тамгалахыг шаарддаг ба хожим тэдэнд багц зохиох
  //    өдөр ЭХЛЭХ ӨГӨГДӨЛ хэрэгтэй.
  // ⚠️ Асуулга нь ЗӨВХӨН хэрэгтэй үед — гарал үүслийн баг нь ил зарласныг
  //    ҮРГЭЛЖ дардаг тул ихэнх багц энэ уншилтыг ОГТ хийхгүй.
  const needTeamCheck = draft.some(
    (d) =>
      d.team_declared !== null &&
      isTeamCodeShape(d.team_declared) &&
      !(d.origin_log_id !== null && originTeamOf.get(d.origin_log_id)),
  );
  const liveTeams = new Set<string>();
  if (needTeamCheck) {
    const { results } = await db.prepare('SELECT code FROM teams').all<{ code: string }>();
    for (const t of results ?? []) liveTeams.add(t.code);
  }

  const rows = draft.map((d) => {
    const oid = d.origin_log_id;
    // ⚠️ ОЛДООГҮЙ бүртгэлийн холбоосыг NULL болгоно, мөрийг ТАТГАЛЗАХГҮЙ.
    //    0195-ийн 90 хоногийн цэвэрлэгээ нь хуудас нээгдсэнээс хойш
    //    бүртгэлийг устгасан байж БОЛНО — тэр үед хянагчийн хөдөлмөрийг
    //    хаях нь буруу.  Гэхдээ хог гадаад түлхүүр бичих нь бүр буруу.
    const known = oid !== null && predictedOf.has(oid);
    return {
      ...d,
      origin_log_id: known ? oid : null,
      source_type: deriveSourceType({
        source: d.source,
        curationAction: d.curation_action,
        declared: d.source_type_declared,
        predicted: known && oid !== null ? predictedOf.get(oid) ?? null : null,
      }),
      // ⚠️ СЕРВЕР ШИЙДНЭ (0238 / 2-6).  Гарал үүслийн бүртгэлийн баг ЯЛНА;
      //    түүнгүй үед л хянагчийн ИЛ сонголт, тэр ч АМЬД `teams`-д байвал.
      //    ⛔ «Хянагчийн үндсэн баг»-ыг ЧИМЭЭГҮЙ оноох ЗАМ ЭНД БАЙХГҮЙ —
      //    тэр нь IZ-ийн өгүүлбэрийг BA гэж тамгалах ЯГ ТЭР алдаа.
      team_code: resolveExampleTeam({
        originTeam: oid !== null ? originTeamOf.get(oid) ?? null : null,
        declared: d.team_declared,
        declaredAllowed: d.team_declared !== null && liveTeams.has(d.team_declared),
      }),
    };
  });


  // ⚠️ Жишээний INSERT нь `assistantExampleStatements`-д НҮҮСЭН — багц гарц
  //    (`POST /assistant/bulk-review`) ЯГ ТЭР НЭГ кодыг дуудна.  Тайлбар
  //    тэнд; энд ГАРААР bind тоолохгүй.
  const stmts: D1PreparedStatement[] = assistantExampleStatements(db, rows, user.sub);
  // ⚠️ ЖИШЭЭНИЙ statement-үүдийн ТОО — доорх `changed.slice(…)`-ийн зааг.
  //    БҮРТГЭЛИЙН UPDATE-үүдийг түлхэхээс ӨМНӨ авах ЁСТОЙ.
  const exStmtCount = stmts.length;

  if (ids.length > 0) {
    for (let i = 0; i < ids.length; i += 90) {
      const chunk = ids.slice(i, i + 90);
      stmts.push(
        db.prepare(
          // ⚠️ Bind тооцоо: 1 (reviewed_by) + N (id).  Чанк 90 → 1 + 90 = 91 ≤ 100.
          // ⚠️ `AND review_status IS NULL` — давхар хяналт ЭХНИЙ шийдвэрийг
          //    ДАРЖ БИЧИХГҮЙ (татгалзсаныг дэвшүүлсэн болгож чадахгүй).
          `UPDATE assistant_logs
              SET curated       = 1,
                  review_status = 'promoted',
                  reviewed_by   = ?,
                  reviewed_at   = datetime('now')
            WHERE id IN (${chunk.map(() => '?').join(',')})
              AND review_status IS NULL`,
        ).bind(user.sub, ...chunk),
      );
    }
  }

  // ⚠️ БОДИТ `meta.changes` — илгээсэн тоог БИШ (1B аудит, P1).
  //    Хоёулаа БОДОГДООР бага байж БОЛНО:
  //      · INSERT нь `WHERE assistant_examples.review_state <> 'rejected'`-тэй —
  //        ТАТГАЛЗСАН жишээг амилуулахгүй тул тэр мөр 0 өөрчлөлт өгнө.
  //      · UPDATE нь `AND review_status IS NULL`-тай — аль хэдийн шийдвэр
  //        гарсан мөрийг алгасана (давхар хяналт).
  //    Хүсэлтийн тоог буцаах нь хянагчид «5 жишээ нэмэгдлээ» гэж ХУДАЛ
  //    хэлэх байв.  `POST /assistant/reject` аль хэдийн ИЖИЛ хэв маягтай.
  //
  // ⚠️ ДАРААЛАЛ АЧАА УНАНА: дээр эхлээд ЖИШЭЭНИЙ INSERT-үүд,
  //    дараа нь БҮРТГЭЛИЙН UPDATE-үүд `stmts`-д түлхэгдсэн.  Тэднийг
  //    буулгах үед энэ дараалал бол ажлын хэсэг — газар соливол хоёр
  //    тоо СОЛБИЦОНО (`exStmtCount` нь INSERT-үүдийн ТОО).
  const res = await db.batch(stmts);
  const changed = res.map((r) => r.meta?.changes ?? 0);
  return c.json({
    added: changed.slice(0, exStmtCount).reduce((n, v) => n + v, 0),
    curated: changed.slice(exStmtCount).reduce((n, v) => n + v, 0),
  });
});

/**
 * Түүхий бүртгэлийг ТАТГАЛЗСАН гэж хаах statement-ууд.
 *
 * ⚠️ ЯАГААД ТУСЛАХ ФУНКЦ ВЭ: бүртгэл татгалзах ХОЁР гарц бий —
 * `POST /assistant/review` (курацийн UI дуудна) ба `POST /assistant/reject`-ийн
 * `log_ids` салаа.  Хоёр сесс тэднийг тус тусад нь зохиосон бөгөөд
 * ӨӨР багана бичдэг байв (`review`: 0214-ийн бүтэн хяналтын мөчлөг;
 * `reject`: зөвхөн `curated = 1`).  Хоёр зам нэг мөрийг ӨӨР төлөвт үлдээвэл
 * «хянасан түүх» жагсаалт бодит байдалтай зөрнө.  Тиймээс SQL нь ЭНД
 * НЭГ УДАА бичигдэнэ.
 *
 * ⚠️ `AND review_status IS NULL` — давхар хяналт ЭХНИЙ шийдвэрийг ДАРЖ
 * БИЧИХГҮЙ.  Тиймээс бодит өөрчлөлт илгээснээс ЦӨӨН байж болно; дуудагч
 * `meta.changes`-ыг үнэн зөвөөр буцаана.
 *
 * ⚠️ Bind: 2 (reviewed_by, note) + N id.  Чанк 90 → 92 ≤ 100.
 */
function rejectLogStatements(
  db: D1Database,
  ids: number[],
  reviewerId: number,
  note: string | null,
): D1PreparedStatement[] {
  const stmts: D1PreparedStatement[] = [];
  for (let i = 0; i < ids.length; i += 90) {
    const chunk = ids.slice(i, i + 90);
    stmts.push(
      db.prepare(
        `UPDATE assistant_logs
            SET curated       = 1,
                review_status = 'rejected',
                reviewed_by   = ?,
                reviewed_at   = datetime('now'),
                review_note   = ?
          WHERE id IN (${chunk.map(() => '?').join(',')})
            AND review_status IS NULL`,
      ).bind(reviewerId, note, ...chunk),
    );
  }
  return stmts;
}

/**
 * POST /api/revit/assistant/review — бүртгэлийг ТАТГАЛЗАНА (admin/senior).
 *
 * ⚠️ ЯАГААД ТУСДАА ГАРЦ: татгалзал нь `assistant_examples`-д мөр ҮҮСГЭХГҮЙ,
 * тиймээс «хоосон examples» гэж `/examples`-ээр дамжуулах нь семантикийн
 * хувьд буруу байх байв.  Татгалзал бол БИЕ ДААСАН, БҮРТГЭГДСЭН шийдвэр:
 * «энэ мөр сургалтад ОРОХ ЁСГҮЙ, учир нь …» гэдэг нь корпусын хамгийн үнэ
 * цэнтэй СӨРӨГ дохио.  Мөрийг УСТГАХГҮЙ — шалтгаан нь өөрөө өгөгдөл.
 *
 * body: { log_ids: number[], outcome: 'rejected', note?: string }
 */
revit.post('/assistant/review', async (c) => {
  const user = c.get('user');
  if (!isManager(user.role)) return c.json({ error: 'Хандах эрхгүй' }, 403);

  const body = await c.req
    .json<{ log_ids?: unknown; outcome?: unknown; note?: unknown }>()
    .catch(() => null);
  if (!body) return c.json({ error: 'invalid body' }, 400);

  // ⚠️ ОДООГООР ЗӨВХӨН 'rejected'.  'promoted' нь `/assistant/examples`-ээр
  // явна — тэнд ЖИШЭЭНИЙ МӨР ҮҮСЭХ ЁСТОЙ тул хоёрыг нэгтгэвэл «жишээгүй
  // дэвшүүлэлт» гэсэн БОЛОМЖГҮЙ төлөв үүснэ.
  if (body.outcome !== 'rejected') {
    return c.json({ error: "outcome must be 'rejected'" }, 400);
  }

  // ⚠️ `idList` — ЖИНХЭНЭ эерэг бүхэл id (1B аудит, P1).  Хуучин
  //    `.map(Number).filter(Number.isInteger)` нь `[true]`-г `[1]` болгодог тул
  //    `WHERE id IN (1)` нь БОДИТ бүртгэлийг татгалзсан гэж хаадаг байв.
  const ids = idList(body.log_ids, MAX_EXAMPLE_BATCH);
  if (ids.length === 0) return c.json({ error: 'log_ids must be a non-empty array' }, 400);

  const note = str(body.note, MAX_LOG_TEXT) || null;

  const res = await c.env.DB.batch(rejectLogStatements(c.env.DB, ids, user.sub, note));
  const rejected = res.reduce((n, r) => n + (r.meta?.changes ?? 0), 0);
  return c.json({ rejected });
});

/**
 * POST /api/revit/assistant/reject — ЖИШЭЭГ татгалзана (admin/senior).
 *
 * ⚠️ 0195:50 «Муу жишээг УСТГАХГҮЙ, унтраана — юу яагаад хасагдсаныг мэдэх
 *    ёстой» гэсэн зорилгын ХЭРЭГЖҮҮЛЭЛТ (2026-08-28 хүртэл КОД БАЙГААГҮЙ).
 *    Хоёр төрлийн татгалзал:
 *      example_ids — байгаа жишээг унтраана (review_state='rejected', is_active=0)
 *      log_ids     — түүхий бүртгэлийг «харлаа, дэвшүүлэхгүй» гэж хаана
 *
 * ⚠️ `log_ids` салаа нь `POST /assistant/review`-тэй ЯГ ИЖИЛ SQL-ийг
 *    (`rejectLogStatements`) ашиглана.  Хоёр гарц нэг мөрийг өөр төлөвт
 *    үлдээх боломж БАЙХГҮЙ.  Курацийн UI нь `/review`-г дууддаг; энэ гарц нь
 *    жишээний талын татгалзлыг нэмж өгнө.
 *
 * ⚠️ ИНВАРИАНТ: `is_active = 0`  ⟺  `review_state = 'rejected'`.
 *    Хуучин индекс `idx_assistant_ex_intent(intent, is_active)` ба хуучин
 *    уншигч код түүнээс хамаарна.  «Хоёр тэнхлэг» гэдэг нь ХОЁР БАГАНА
 *    ЗӨРӨХ гэсэн үг БИШ — `is_active` нь «унтраагаагүй» туг, `review_state`
 *    нь хянан үзэх мөчлөг, ба татгалзал ХОЁУЛАНГ нь зэрэг бичнэ.
 *
 * Эрх: `isManager` — `POST /assistant/examples`-тэй ЯГ ИЖИЛ (зориуд).
 *      Татгалзал нь дэвшүүлэхээс илүү эрх шаардахгүй.
 */
revit.post('/assistant/reject', async (c) => {
  const user = c.get('user');
  if (!isManager(user.role)) return c.json({ error: 'Хандах эрхгүй' }, 403);

  const db = c.env.DB;
  const body = await c.req
    .json<{ example_ids?: unknown; log_ids?: unknown; note?: unknown }>()
    .catch(() => null);
  if (!body) return c.json({ error: 'Invalid JSON' }, 400);

  const note = str(body.note, 500) || null;
  // ⚠️ `idList` — ЖИНХЭНЭ эерэг бүхэл id (1B аудит, P1).  Энэ гарц нь
  //    `is_active = 0` бичдэг тул хог id нь ГЭМ ГҮЙ жишээг унтраах эрсдэлтэй.
  const exIds = idList(body.example_ids, 500);
  const logIds = idList(body.log_ids, 500);
  if (exIds.length === 0 && logIds.length === 0) {
    return c.json({ error: 'example_ids or log_ids required' }, 400);
  }

  const stmts: D1PreparedStatement[] = [];

  // ⚠️ IN(...)-ийн bind тоо: note + reviewed_by + 90 id = 92 ≤ 100.
  //    Файлын `IDS_PER_STATEMENT = 50` (revit.ts:70)-ээс ЯЛГААТАЙ — тэр нь
  //    өөр гарцынх.  Энд 2 нэмэлт bind байгааг тооцсон ТУСДАА тогтмол.
  const REJECT_IDS_PER_STATEMENT = 90;
  for (let i = 0; i < exIds.length; i += REJECT_IDS_PER_STATEMENT) {
    const chunk = exIds.slice(i, i + REJECT_IDS_PER_STATEMENT);
    stmts.push(
      db.prepare(
        `UPDATE assistant_examples
            SET review_state = 'rejected',
                is_active    = 0,
                note         = COALESCE(?, note),
                reviewed_by  = ?,
                reviewed_at  = datetime('now')
          WHERE id IN (${chunk.map(() => '?').join(',')})`,
      ).bind(note, user.sub, ...chunk),
    );
  }
  stmts.push(...rejectLogStatements(db, logIds, user.sub, note));

  const res = await db.batch(stmts);
  // ⚠️ Бодит `meta.changes` — `rejectLogStatements` нь аль хэдийн хянагдсан
  //    мөрийг алгасдаг тул илгээсэн тоог буцаах нь ХУДАЛ байх байсан.
  const exStmtCount = Math.ceil(exIds.length / REJECT_IDS_PER_STATEMENT);
  const changed = res.map((r) => r.meta?.changes ?? 0);
  return c.json({
    rejected_examples: changed.slice(0, exStmtCount).reduce((n, v) => n + v, 0),
    closed_logs: changed.slice(exStmtCount).reduce((n, v) => n + v, 0),
  });
});


/**
 * POST /api/revit/assistant/bulk-review — БАГЦААР дэвшүүлэх / татгалзах
 * (admin/senior).
 *
 * body: { action: 'promote' | 'reject', log_ids: number[], note?: string }
 *
 * ⚠️ ЯАГААД ЭНЭ ГАРЦ ХЭРЭГТЭЙ ВЭ.  Өнөөдөр ахлагч дараалалд МӨР ТУС БҮРЭЭР
 *    шийдвэр гаргана.  ~20 PC-ээс өдөрт ирэх бүртгэлийн урсгалыг тэр
 *    хурдаар гүйцэхгүй ⇒ курац ЗОГСОНО ⇒ сургалтын корпус ӨСӨХГҮЙ.
 *
 * ⚠️ ЭНЭ НЬ ИНЖЕНЕРТ ЮУ Ч ХАРУУЛАХГҮЙ (эзний 2026-09-01-ний шийдвэр).
 *    Эрх мэдэл OBSERVE хэвээр: мэдэгдэл ч, попап ч, Revit доторх ЯМАР Ч
 *    шинэ зан төлөв ЭНЭ ГАРЦААС ГАРАХГҮЙ.  Энэ бол ЗӨВХӨН вэб дэх
 *    ахлагчийн дарааллын хурд.
 *
 * ⚠️ ЭРХ: `isManager` (admin | senior) — `POST /assistant/examples`,
 *    `/assistant/review`, `/assistant/reject`-тэй ЯГ ИЖИЛ, ӨРГӨЖӨӨГҮЙ.
 *    `lib/workerScope.ts` ХӨНДӨГДӨӨГҮЙ: `/api/revit` нь түүний
 *    зөвшөөрлийн жагсаалтад анхнаасаа БАЙХГҮЙ тул `worker` энд хүрэхгүй.
 *
 * ⚠️ ТЭМДЭГЛЭЛ ЗААВАЛ (татгалзал дээр).  Ганц мөрийн `/assistant/review`
 *    нь `note`-ыг СОНГОЛТ болгодог; БАГЦ дээр тэр нь БОЛОХГҮЙ.  Багц
 *    татгалзал бол «нэг дарахад 200 мөр СӨРӨГ дохио болов» гэсэн үг —
 *    шалтгаангүй бол тэр 200 мөр ЯАГААД хасагдсаныг ХОЖИМ ХЭН Ч мэдэхгүй,
 *    ба 0195:50-ын («юу яагаад хасагдсаныг мэдэх ёстой») бүх утга алдагдана.
 *    ⇒ Багц нь тэмдэглэлийг АЛГАСАХ ЗАМ БОЛОХГҮЙ.
 *
 * ⚠️ IDEMPOTENT.  Гурван давхаргаар:
 *      1. Уншилтын шат — `review_status IS NOT NULL` мөрийг `already_reviewed`
 *         гэж ЯЛГАЖ, бичилтэд ОГТ оруулахгүй.
 *      2. SQL-ийн `AND review_status IS NULL` — ЭХНИЙ ШИЙДВЭР ЯЛНА
 *         (`rejectLogStatements`-ийн ЯГ ИЖИЛ хамгаалалт).
 *      3. Жишээний `ON CONFLICT … DO UPDATE … WHERE review_state <>
 *         'rejected'` — давхар дэвшүүлэлт нь ШИНЭ мөр ҮҮСГЭХГҮЙ, ба
 *         ТАТГАЛЗСАН жишээг АМИЛУУЛАХГҮЙ.
 *
 * ⚠️ D1-ИЙН BIND: `BULK_IDS_PER_STATEMENT = 90` (тайлбар нь
 *    `lib/assistantBulkReview.ts`-д).  Уншилт 90, баталгаа 90,
 *    promote-ийн UPDATE 1+90 = 91, reject-ийн UPDATE 2+90 = 92 — бүгд ≤ 100.
 *    Жишээний INSERT нь ӨӨР арифметиктэй (14 bind/мөр ⇒ 7 мөр ⇒ 98) ба
 *    `assistantExampleStatements` дотор амьдарна.
 */
revit.post('/assistant/bulk-review', async (c) => {
  const user = c.get('user');
  if (!isManager(user.role)) return c.json({ error: 'Хандах эрхгүй' }, 403);

  const db = c.env.DB;
  const body = await c.req
    .json<{ action?: unknown; log_ids?: unknown; note?: unknown }>()
    .catch(() => null);
  if (!body) return c.json({ error: 'Invalid JSON', cap: BULK_REVIEW_CAP }, 400);

  if (!isBulkAction(body.action)) {
    return c.json(
      { error: "action must be 'promote' or 'reject'", cap: BULK_REVIEW_CAP },
      400,
    );
  }
  const action = body.action;

  // ⚠️ `idList` БИШ (`routes/revit.ts`-ийн бусад гарцууд түүнийг хэрэглэдэг).
  //    Тэр нь `max`-д хүрэхэд ЧИМЭЭГҮЙ зогсдог — 250 мөр илгээсэн ахлагч
  //    200 нь л шийдэгдсэнийг МЭДЭХГҮЙ үлдэнэ.  `parseBulkIds` нь БҮГДИЙГ
  //    уншиж, тоог буцаадаг тул доорх 413 нь БҮТЭН тоон дээр гарна.
  const parsed = parseBulkIds(body.log_ids);
  if (parsed.notArray) {
    return c.json({ error: 'log_ids must be an array', cap: BULK_REVIEW_CAP }, 400);
  }
  // ⚠️ ХЯЗГААРЫГ ЭХЭЛЖ шалгана — хоосон/хог шалгалтаас ӨМНӨ.  Ингэснээр
  //    «250 мөр» гэсэн хариулт ҮРГЭЛЖ 413, хэзээ ч 400 болохгүй.
  if (parsed.ids.length > BULK_REVIEW_CAP) {
    return c.json(
      {
        error: `Too many log_ids (max ${BULK_REVIEW_CAP})`,
        cap: BULK_REVIEW_CAP,
        requested: parsed.ids.length,
      },
      413,
    );
  }
  if (parsed.ids.length === 0) {
    return c.json(
      {
        error: 'log_ids must be a non-empty array of positive integers',
        cap: BULK_REVIEW_CAP,
        invalid_ids: parsed.invalid,
      },
      400,
    );
  }

  const note = str(body.note, MAX_LOG_TEXT) || null;
  if (action === 'reject' && note === null) {
    return c.json(
      { error: 'note is required for bulk reject', cap: BULK_REVIEW_CAP },
      400,
    );
  }

  /* --- 1. УНШИЛТ: мөрүүдийн ОДООГИЙН төлөв ------------------------- */
  // ⚠️ Bind: 0 + 90 = 90 ≤ 100.
  const logRows = new Map<number, BulkLogRow>();
  for (const part of chunkIds(parsed.ids, BULK_IDS_PER_STATEMENT)) {
    const { results } = await db
      .prepare(
        `SELECT id, text, predicted, corrected, review_status, team_code
           FROM assistant_logs
          WHERE id IN (${part.map(() => '?').join(',')})`,
      )
      .bind(...part)
      .all<BulkLogRow>();
    for (const r of results ?? []) logRows.set(r.id, r);
  }

  let items = planBulkReview({ action, ids: parsed.ids, rows: logRows, isIntent });

  /* --- 2. ТАТГАЛЗСАН ЖИШЭЭТЭЙ давхцлыг хасна (зөвхөн promote) ------- */
  // ⚠️ ЯАГААД: жишээний INSERT нь `WHERE … review_state <> 'rejected'`-тэй
  //    (0195:50).  Тэр мөр 0 өөрчлөлт өгөх ч бүртгэлийн UPDATE нь ТУСАД НЬ
  //    амжилттай болно ⇒ «promoted» гэж тамгалагдсан, ГЭВЧ ЖИШЭЭ ҮҮСЭЭГҮЙ.
  //    Багц дээр тэр нь ЧИМЭЭГҮЙ АЛДАГДАЛ тул мөрийг БҮХЭЛД НЬ хасаж,
  //    `example_rejected` гэж ИЛ хэлнэ.  Мөр дараалалдаа ҮЛДЭНЭ.
  if (action === 'promote') {
    const drafts = items
      .map((it) => it.promote)
      .filter((p): p is NonNullable<typeof p> => p !== null);
    const texts = [...new Set(drafts.map((p) => p.text))];
    const rejectedKeys = new Set<string>();
    // ⚠️ Bind: 0 + 90 = 90 ≤ 100.  `LIKE '%…%'` ХЭРЭГЛЭХГҮЙ (алсын D1 нь
    //    том TEXT багана дээр түүнийг татгалздаг) — ЯГ ТЭНЦҮҮ `IN (…)`.
    for (const part of chunkIds(texts, BULK_IDS_PER_STATEMENT)) {
      const { results } = await db
        .prepare(
          `SELECT text, intent, team_code
             FROM assistant_examples
            WHERE review_state = 'rejected'
              AND text IN (${part.map(() => '?').join(',')})`,
        )
        .bind(...part)
        .all<{ text: string; intent: string; team_code: string | null }>();
      for (const r of results ?? []) {
        rejectedKeys.add(exampleKey(r.text, r.intent, r.team_code));
      }
    }
    items = blockRejectedExamples(items, rejectedKeys);
  }

  const eligible = eligibleIds(items);

  /* --- 3. БИЧИЛТ --------------------------------------------------- */
  let examplesWritten = 0;
  let logsClosed = 0;

  if (eligible.length > 0) {
    const stmts: D1PreparedStatement[] = [];
    let exStmtCount = 0;

    if (action === 'promote') {
      // ⚠️ ЖИШЭЭНИЙ МӨРИЙГ СЕРВЕР УРГУУЛНА, КЛИЕНТЭЭС АВАХГҮЙ (гэрээ G1).
      //    Багц дэвшүүлэлт нь ТОДОРХОЙЛОЛТООРОО «машины/хүний БАЙГАА
      //    шошгыг БАТАЛГААЖУУЛАХ» үйлдэл; бичвэр ЗОХИОХ бол ганц мөрийн
      //    `POST /assistant/examples`-ээр явна.
      // ⚠️ `slot` нь NULL: `assistant_logs`-д slot багана БАЙХГҮЙ.  Ганц
      //    мөрийн гарц дээр ч хянагч бөглөөгүй бол ЯГ ИЖИЛ NULL бичигддэг
      //    тул шинэ зан төлөв БИШ.  `isolate_sheet`-ийн хуудасны дугаар
      //    хэрэгтэй бол тэр мөрийг ганцаарчлан шошгол.
      const exRows = items
        .filter((it) => it.blocked === null && it.promote !== null)
        .map((it) => {
          const p = it.promote as NonNullable<typeof it.promote>;
          return {
            text: p.text,
            intent: p.intent,
            slot: null,
            style: null,
            source: 'usage',
            source_type: deriveSourceType({
              source: 'usage',
              curationAction: p.curationAction,
              declared: null,
              predicted: p.predicted,
            }),
            // ⚠️ 'verified' — дараалал бол ХҮН ХАРСАН гарц.  `reviewed_by` /
            //    `reviewed_at` тэр үед бичигдэнэ (CASE нь 'pending'-д л NULL).
            review_state: 'verified',
            origin_log_id: it.id,
            // ⚠️ ЗӨВХӨН гарал үүслийн бүртгэлийн баг.  Хянагчийн ӨӨРИЙН
            //    багийг ЭНД оноох ЗАМ БАЙХГҮЙ — BA-гийн senior IZ-ийн
            //    мөрийг багцаар дэвшүүлэхэд корпус бохирдох ба ЭХНИЙ
            //    ШИЙДВЭР ЯЛНА тул БУЦААХ БОЛОМЖГҮЙ.
            team_code: resolveExampleTeam({
              originTeam: p.teamCode,
              declared: null,
              declaredAllowed: false,
            }),
          };
        });
      const exStmts = assistantExampleStatements(db, exRows, user.sub);
      exStmtCount = exStmts.length;
      stmts.push(...exStmts);

      // ⚠️ Bind: 1 (reviewed_by) + 90 = 91 ≤ 100.
      // ⚠️ `AND review_status IS NULL` — ЭХНИЙ ШИЙДВЭР ЯЛНА.  Уншилтын
      //    шатны шүүлт нь тайлбарын төлөө; ЖИНХЭНЭ хамгаалалт ЭНД.
      for (const part of chunkIds(eligible, BULK_IDS_PER_STATEMENT)) {
        stmts.push(
          db
            .prepare(
              `UPDATE assistant_logs
                  SET curated       = 1,
                      review_status = 'promoted',
                      reviewed_by   = ?,
                      reviewed_at   = datetime('now')
                WHERE id IN (${part.map(() => '?').join(',')})
                  AND review_status IS NULL`,
            )
            .bind(user.sub, ...part),
        );
      }
    } else {
      // ⚠️ ГАНЦ МӨРИЙН ЗАМТАЙ ЯГ ИЖИЛ SQL (`rejectLogStatements`).  Багц ба
      //    ганц мөр нэг бүртгэлийг ӨӨР төлөвт үлдээх боломж БАЙХГҮЙ.
      stmts.push(...rejectLogStatements(db, eligible, user.sub, note));
    }

    const res = await db.batch(stmts);
    const changed = res.map((r) => r.meta?.changes ?? 0);
    examplesWritten = changed.slice(0, exStmtCount).reduce((n, v) => n + v, 0);
    logsClosed = changed.slice(exStmtCount).reduce((n, v) => n + v, 0);
  }

  /* --- 4. БАТАЛГААНЫ УНШИЛТ (мөр тус бүрийн ҮНЭН хариу) ------------ */
  // ⚠️ ЯАГААД ДАХИН УНШИХ ВЭ: багц UPDATE нь `meta.changes`-ыг ЧАНК ДАЯАР
  //    НЭГ тоогоор буцаана — «90-өөс 87» гэдэг нь АЛЬ ГУРАВ нь болоогүйг
  //    ХЭЛЭХГҮЙ.  Мөр тус бүрд statement явуулах (200 хүсэлт) эсвэл ДАХИН
  //    унших (≤3 хүсэлт) — сүүлийнх нь хямд.
  // ⚠️ Bind: 0 + 90 = 90 ≤ 100.
  const verified = new Map<number, BulkVerifyRow>();
  for (const part of chunkIds(eligible, BULK_IDS_PER_STATEMENT)) {
    const { results } = await db
      .prepare(
        `SELECT id, review_status, reviewed_by
           FROM assistant_logs
          WHERE id IN (${part.map(() => '?').join(',')})`,
      )
      .bind(...part)
      .all<BulkVerifyRow>();
    for (const r of results ?? []) verified.set(r.id, r);
  }

  const settled = settleBulkReview({ action, items, verified, reviewerId: user.sub });
  const counts = summarizeBulkResults(settled);

  // ⚠️ БҮХ ТОО БОДИТ.  `applied` нь БАТАЛГААНЫ уншилтаас, `added`/`curated`/
  //    `rejected` нь `meta.changes`-аас гарна — илгээсэн тоо ХЭЗЭЭ Ч
  //    буцахгүй (`POST /assistant/examples`-ийн ИЖИЛ дүрэм).
  // ⚠️ `added` < `applied` бол тэр нь ХУДАЛ БИШ, БАРИМТ: жишээ нь аль
  //    хэдийн байсан (upsert 0 өөрчлөлт өгсөн) эсвэл уншилт ба бичилтийн
  //    хооронд хэн нэгэн түүнийг татгалзсан.  Хоёр тоог ТУСАД НЬ буцаах нь
  //    тэр зөрүүг ХАРАГДАХУЙЦ болгох ЦОРЫН ГАНЦ арга.
  return c.json({
    action,
    cap: BULK_REVIEW_CAP,
    requested: parsed.ids.length,
    invalid_ids: parsed.invalid,
    duplicates_dropped: parsed.duplicates,
    counts,
    added: examplesWritten,
    curated: action === 'promote' ? logsClosed : 0,
    rejected: action === 'reject' ? logsClosed : 0,
    results: toWireResults(settled),
  });
});
/**
 * GET /api/revit/assistant/export — сургалтын багцыг бүтнээр (admin).
 * Python сургагч руу шууд дамжина.
 */
revit.get('/assistant/export', requireAdmin(), async (c) => {
  // ⚠️ ХОЁР ТЭНХЛЭГ.  Энэ гарц нь ЗӨВХӨН ХЯНАН ҮЗЭХ тэнхлэгээр шүүдэг
  //    (`reviewed` | `verified`), эх сурвалжийн БОДЛОГООР ШҮҮДЭГГҮЙ —
  //    `source_type`-ыг мөр тус бүр дээр БУЦААНА, шийдвэрийг сургалтын
  //    манифест гаргана.  Энд бодлого шатаавал бодлого солих бүрд worker
  //    deploy шаардагдана.
  //
  // ⚠️ `review_state IN ('reviewed','verified')` нь 0215-ын backfill-ийн
  //    дараа `is_active = 1`-тэй ЯГ ИЖИЛ олонлог өгнө — зан төлөв байт
  //    байтаар хадгалагдана.  `pull_and_retrain.py` энэ олонлогоос
  //    `data/production.json` бичдэг тул шүүлтийг ЧАНГАРУУЛБАЛ дараагийн
  //    загварын нарийвчлал ЧИМЭЭГҮЙ УНАНА.
  const { results } = await c.env.DB
    .prepare(
      // ⚠️ `id` нь ЗААВАЛ: `POST /assistant/reject`-ийн ЦОРЫН ГАНЦ клиент
      //    (`ExamplesTab.tsx` -ийн «Хасах» товч) мөрийг `r.id != null` дээр
      //    зурдаг.  Энэ багана SELECT-д байхгүй байсан тул тэр товч ХЭЗЭЭ Ч
      //    зурагдаагүй ⇒ 0215-ийн татгалзлын хагас нь бүтээгдэхүүнд
      //    ОРШИХГҮЙ байсан.  `pull_and_retrain.py` нь зөвхөн
      //    text/intent/style/source/slot уншдаг тул нэмэлт талбар аюулгүй.
      // ⚠️ `team_code` (0238 / 2-6) нь зөвхөн НЭМЭЛТ талбар — ШҮҮЛТ БИШ.
      //    Сургалтын багцыг багаар ЭНД хуваахгүй: `?team=` параметр
      //    ЗОРИУД БАЙХГҮЙ.  Хуваалт нь сургалтын манифестын шийдвэр
      //    (`pull_and_retrain.py`), сервер тал зөвхөн ШОШГО өгнө — эс
      //    бөгөөс бодлого солих бүрд worker deploy шаардагдана.
      `SELECT id, text, intent, slot, style, source, source_type, review_state,
              reviewed_by, reviewed_at, origin_log_id, source_log_id, team_code
         FROM assistant_examples
        WHERE review_state IN ('reviewed','verified')
        ORDER BY intent, id`,
    )
    .all<{
      id: number;
      text: string; intent: string; slot: string | null; style: string | null;
      source: string; source_type: string; review_state: string;
      reviewed_by: number | null; reviewed_at: string | null;
      origin_log_id: number | null; source_log_id: number | null;
      team_code: string | null;
    }>();

  const rows = results ?? [];
  const byIntent: Record<string, number> = {};
  const bySource: Record<string, number> = {};
  const byTeam: Record<string, number> = {};
  for (const r of rows) {
    byIntent[r.intent] = (byIntent[r.intent] ?? 0) + 1;
    bySource[r.source_type] = (bySource[r.source_type] ?? 0) + 1;
    // ⚠️ NULL нь ХУВААРЬТ ОРНО, «(none)» гэсэн ИЛ түлхүүрээр.  Хасвал
    //    `per_team`-ийн нийлбэр `count`-той таарахгүй болж, «БА-д хэдэн
    //    мөр байна» гэсэн асуултын хариу ЧИМЭЭГҮЙ гуйвна.  NULL = КОМПАНИ
    //    ДАЯАР (баг харгалзахгүй), «алдагдсан» ГЭСЭН ҮГ БИШ.
    const key = r.team_code ?? '(none)';
    byTeam[key] = (byTeam[key] ?? 0) + 1;
  }

  // `per_source_type` / `per_team` нь ШИНЭ, зөвхөн НЭМЭЛТ талбарууд —
  // `pull_and_retrain.py` зөвхөн `rows` ба `per_intent`-ыг уншдаг тул
  // хуучин хэрэглэгч эвдрэхгүй.
  // ⚠️ `count` нь энэ өөрчлөлтөөс ӨМНӨХ утгатай ЯГ ИЖИЛ байх ЁСТОЙ —
  //    `WHERE` НЭГ Ч тэмдэгтээр чангараагүй.  Унасан бол дараагийн
  //    загварын нарийвчлал ЧИМЭЭГҮЙ буурна (rollback-ийн шинж тэмдэг 2).
  return c.json({
    count: rows.length,
    per_intent: byIntent,
    per_source_type: bySource,
    per_team: byTeam,
    rows,
  });
});

/* ------------------------------------------------------------------ */
/*  Суулгалтын эрүүл мэнд (v2 §74 — SELF-CHECK / REPORT HEALTH)         */
/* ------------------------------------------------------------------ */

/**
 * Хоёр semver-төст хувилбарыг харьцуулна.  a < b бол сөрөг, тэнцүү бол 0.
 *
 * ⚠️ ЗӨВХӨН ТООН ХЭСГИЙГ ХАРНА.  «1.2.0-rc1» гэх мэт дагаварыг ҮЛ ТООНО —
 * `parseInt` нь эхний тооноос хойшхыг хаядаг.  Хэрэв клиент огт танигдахгүй
 * хэлбэр илгээвэл бүх сегмент 0 болж, харьцуулалт «тэнцүү» гэж дүгнэнэ —
 * өөрөөр хэлбэл ХУУЧИН гэж ЯЛГААГҮЙ.  Энэ нь ЗОРИУДААР: хувилбарын мөр
 * танигдаагүйгээс болж ажилтны нэмэлтэд «шинэчил» гэж хэлэх нь ХУДАЛ
 * дохио бөгөөд ~20 ПК-ийн гар ажиллагааг шаардана.
 */
function cmpVersion(a: string, b: string): number {
  const pa = String(a).split('.');
  const pb = String(b).split('.');
  const n = Math.max(pa.length, pb.length);
  for (let i = 0; i < n; i++) {
    const x = parseInt(pa[i] ?? '0', 10) || 0;
    const y = parseInt(pb[i] ?? '0', 10) || 0;
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

/**
 * POST /api/revit/health — суулгалтын эрүүл мэндийн тайлан (v2 §74).
 *
 * ⚠️ ЯАГААД `/api/revit` ДООР ВЭ: энэ router нь дээр `requireRole(...REVIT_ROLES)`
 * -оор хаагдсан ба `/api/revit` нь `lib/workerScope.ts`-ийн зөвшөөрлийн
 * жагсаалтад БАЙХГҮЙ тул `worker` автоматаар 403 авна.  Шинэ дээд түвшний
 * prefix үүсгэвэл `lib/modules.ts`-ийн `API_PREFIXES` + `MODULE_OF` бүртгэл,
 * `workerScope` шалгалт, CORS — бүгдийг ДАХИН хийх шаардлагатай болно.
 *
 * ⚠️ АКТОР НЬ ТОКЕНООС.  `user.sub` — биеийн `user_id`-г ХЭЗЭЭ Ч хүлээж
 * авахгүй (`learning.ts`-ийн ижил дүрэм).
 *
 * ⚠️ ЭНЭ ROUTE `purpose === 'mcp'` токеныг ХҮЛЭЭЖ АВНА.  Add-in өөр
 * токенгүй, refresh урсгал БАЙХГҮЙ; татгалзвал ~20 ПК алсаас
 * сэргээгдэхгүй (засах цорын ганц арга нь гар суулгалт).
 *
 * ⚠️ ХУВИЛБАРЫН НИЙЦГҮЙ БАЙДАЛ: сервер ХЭЗЭЭ Ч 4xx буцаахгүй, зөвхөн
 * `upgrade_required` тугийг өгнө.  Хуучин клиентийг алдаагаар зогсоох нь
 * v2 §74-ийн «fail gracefully and not corrupt user work»-ыг зөрчинө.
 *
 * ⚠️ ЭНЭ БОЛ ТЕЛЕМЕТР, ХҮНИЙ ХЯНАЛТ БИШ.  Уншилт нь эсвэл
 * `user_id = viewer.sub` (`GET /health/mine`), эсвэл ЗӨВХӨН НЭГТГЭЛ
 * (`GET /api/revit-addin/fleet`) — 0201:23-32-ийн «өөрөө харах» тогтмолын
 * шууд үргэлжлэл.
 */
revit.post('/health', async (c) => {
  const user = c.get('user');

  type HealthBody = Partial<Record<
    'machine_hash' | 'revit_year' | 'revit_build' | 'addin_version' | 'model_version'
    | 'model_source' | 'ruleset_version' | 'pack_sha256' | 'config_version'
    | 'release_sha256' | 'channel' | 'authority_level' | 'health', string
  >> & { health_json?: unknown };

  // ⚠️ Хэлбэр буруу бие нь 500 БИШ, 400 болно — add-in-ы алдаа серверийн
  //    алдааны бүртгэлийг бохирдуулах ЁСГҮЙ.
  let b: HealthBody;
  try {
    b = await c.req.json<HealthBody>();
  } catch {
    return c.json({ error: 'JSON бие шаардлагатай' }, 400);
  }

  const machineHash = str(b.machine_hash, 64);
  const revitYear = str(b.revit_year, 8);
  const addinVer = str(b.addin_version, 32);
  if (!machineHash || !revitYear || !addinVer) {
    return c.json({ error: 'machine_hash, revit_year, addin_version шаардлагатай' }, 400);
  }

  const health = ['ok', 'degraded', 'failed'].includes(String(b.health ?? ''))
    ? String(b.health)
    : 'unknown';

  // ⚠️ `health_json` нь ОБЬЕКТ байх ЁСТОЙ — 0242-ийн
  //    `json_type(health_json) = 'object'` CHECK-тэй ЯГ ИЖИЛ дүрэм.  Массив
  //    эсвэл скаляр ирвэл CHECK нь INSERT-ыг УНАГААХ ба тэр нь клиентэд
  //    500 болж харагдана.
  const hj =
    b.health_json && typeof b.health_json === 'object' && !Array.isArray(b.health_json)
      ? JSON.stringify(b.health_json).slice(0, 8_000)
      : '{}';

  const channel = str(b.channel, 16) || 'prod';
  const releaseSha = str(b.release_sha256, 64);

  await c.env.DB.prepare(
    `INSERT INTO addin_installs
       (user_id, machine_hash, revit_year, revit_build, addin_version,
        model_version, ruleset_version, config_version, health,
        pack_sha256, release_sha256, channel, model_source, authority_level,
        health_json, last_seen_at)
     VALUES (?,?,?,?,?, ?,?,?,?, ?,?,?,?,?, ?, datetime('now'))
     ON CONFLICT (user_id, machine_hash, revit_year) DO UPDATE SET
       revit_build     = excluded.revit_build,
       addin_version   = excluded.addin_version,
       model_version   = excluded.model_version,
       ruleset_version = excluded.ruleset_version,
       config_version  = excluded.config_version,
       health          = excluded.health,
       pack_sha256     = excluded.pack_sha256,
       release_sha256  = excluded.release_sha256,
       channel         = excluded.channel,
       model_source    = excluded.model_source,
       authority_level = excluded.authority_level,
       health_json     = excluded.health_json,
       last_seen_at    = datetime('now')`,
  )
    .bind(
      user.sub, machineHash, revitYear, str(b.revit_build, 32) || null,
      addinVer, str(b.model_version, 64) || null, str(b.ruleset_version, 64) || null,
      str(b.config_version, 128) || null, health,
      str(b.pack_sha256, 64) || null, releaseSha || null,
      channel, str(b.model_source, 16) || null,
      str(b.authority_level, 8) || null, hj,
    )
    .run();

  // Нийтлэгдсэн багц уу?  Танихгүй хэш нь «албан ёсны бус build» гэсэн үг.
  // ⚠️ Энэ нь БҮРЭН БҮТЭН БАЙДЛЫН шалгалт — ГАРАЛ ҮҮСЛИЙНХ БИШ.  Код
  //    гарын үсэг репод БАЙХГҮЙ тул хортой этгээд zip-ийг сольж, дотоод
  //    хэшийг нь дахин тооцоолж чадна.  Серверийн бүртгэлтэй тулгах нь
  //    цорын ганц БОДИТ баталгаа.
  //
  // ⚠️ `payload_sha256`-аар тулгана, ZIP-ийн `sha256`-аар БИШ: суулгасан
  //    машин дээр ZIP байхгүй, зөвхөн задалсан агуулга байдаг (0241-ийн
  //    хоёр хэшийн тайлбарыг үз).
  const rel = releaseSha
    ? await c.env.DB.prepare(
        `SELECT version, min_client, status FROM addin_releases
          WHERE payload_sha256 = ? AND revit_year = ? LIMIT 1`,
      )
        .bind(releaseSha, revitYear)
        .first<{ version: string; min_client: string | null; status: string }>()
    : null;

  const latest = await c.env.DB.prepare(
    `SELECT version, min_client FROM addin_releases
      WHERE revit_year = ? AND channel = ? AND status = 'published'
      ORDER BY published_at DESC LIMIT 1`,
  )
    .bind(revitYear, channel)
    .first<{ version: string; min_client: string | null }>();

  // ⚠️ Хоёр алхмаар: `min_client` нь NULL байж БОЛНО, тэр үед шинэчлэх
  //    ЗӨВЛӨМЖ ОГТ БАЙХГҮЙ — доод хязгаар тавиагүй релиз нь бүх клиентийг
  //    хүлээн зөвшөөрнө.
  const minClient = latest?.min_client ?? null;

  return c.json({
    ok: true,
    recognised: Boolean(rel),
    revoked: rel?.status === 'revoked',
    latest_version: latest?.version ?? null,
    // ⚠️ ЗӨВЛӨМЖ, АЛБАДЛАГА БИШ.  Клиент энэ тугаас болж ажлаа зогсоохгүй —
    //    самбарын толгойд нэг мөр текст болно, тэгээд л болоо.
    upgrade_required: minClient !== null && cmpVersion(addinVer, minClient) < 0,
  });
});

/**
 * GET /api/revit/health/mine — ЗӨВХӨН ӨӨРИЙН суулгацууд.
 *
 * ⚠️ «ӨӨРӨӨ ХАРАХ» ТОГТМОЛ (0201:23-32).  `WHERE user_id = ?` нь СОНГОЛТ
 * БИШ: энэ хүснэгтээс хүн нэрлэсэн уншилт зөвхөн тухайн хүнд өөрт нь
 * зөвшөөрөгдөнө.  Паркийн зураг нь `GET /api/revit-addin/fleet` дээр,
 * ЗӨВХӨН НЭГТГЭЛЭЭР.
 */
revit.get('/health/mine', async (c) => {
  const user = c.get('user');
  const { results } = await c.env.DB.prepare(
    `SELECT revit_year, revit_build, addin_version, model_version, model_source,
            ruleset_version, config_version, channel, health, sc_failed,
            health_json, first_seen_at, last_seen_at
       FROM addin_installs
      WHERE user_id = ?
      ORDER BY last_seen_at DESC
      LIMIT 20`,
  )
    .bind(user.sub)
    .all();
  return c.json({ installs: results ?? [] });
});

export default revit;
