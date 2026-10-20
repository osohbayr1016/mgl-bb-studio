/**
 * Блок хуулах — `POST /api/blocks/:id/duplicate` (migration 0401).
 *
 * Блок → зураг → бүрэлдэхүүн → таск модыг НЭГ `db.batch` (= нэг транзакц)-аар
 * хуулна.  Өмнөх хувилбар 4 тусдаа бичилт байсан тул дундаас унавал хоосон эсвэл
 * дутуу хуулбар блок үлддэг байв; одоо бүх мод бүтнээрээ бичигдэнэ эсвэл ЮУ Ч
 * бичигдэхгүй — тиймээс «орхигдсон хуулбар»-ыг нөхөн цэвэрлэх шаардлага үүсэхгүй.
 *
 * Мөрийн тоо хэдэн мянга байсан ч batch нь ТОГТМОЛ 5 statement: түвшин бүр нэг
 * `INSERT … SELECT`.  Хуучин id → шинэ id-г RETURNING-ийн байрлалаар БИШ,
 * id-ийн эрэмбээр (ROW_NUMBER) холбоно:
 *   • түвшин бүр эх мөрүүдээ `ORDER BY id`-ээр оруулна → шинэ id-ууд яг тэр
 *     дарааллаар өснө (AUTOINCREMENT / rowid = max + 1);
 *   • шинэ блок нь шинээр үүссэн тул түүний доорх мөрүүд ЗӨВХӨН энэ batch-ийнх —
 *     эх ба шинэ мөрийн тоо тэнцүү, k дахь эх мөр ↔ k дахь шинэ мөр.
 * Нэг транзакц дотор тул хооронд нь өөр бичилт орохгүй (D1 нь ганц бичигчтэй).
 *
 * Шинэ блокийн id-г `(SELECT MAX(id) FROM blocks)`-аар `block_duplicate_ops`-д
 * бичнэ: блокийн INSERT ба ops мөрийн INSERT хоёулаа «эх блок байгаа» гэсэн ИЖИЛ
 * нөхцөлтэй, тиймээс ops мөр байгаа бол блок ЯГ сая орсон бөгөөд хамгийн их id-тай.
 * Эх блок preflight-ийн дараа устсан бол хоёулаа 0 мөр → юу ч үүсэхгүй (404).
 *
 * Жингийн төсөв (баг дотор ≤ 100%) нь preflight-д ч, блокийн INSERT-ийн WHERE-д ч
 * шалгагдана — preflight нь зөвхөн UX (тоог хэрэглэгчид харуулах), ҮНЭН нь
 * транзакц доторх шалгалт: хоёр хуулалт зэрэг preflight-ийг давсан ч (70 + 30,
 * 70 + 30) хоёр дахь нь batch дотор 100 + 30-ыг харж 0 мөр бичнэ.  Журналын мөр
 * `changes() = 1`-ээр ЗӨВХӨН блок үнэхээр орсон үед бичигдэнэ (хэмжсэн: workerd-ийн
 * D1 batch дээр `changes()` өмнөх statement-ийг заана) — эс бөгөөс MAX(id) нь
 * өөр блок болж хуулбар буруу блок дор бичигдэх байсан.
 *
 * ⚠️ `task_assignees`, хуваарилалт, явц, оноо ХУУЛАГДАХГҮЙ (2026-10-01-ний дүрэм —
 *    шинэ таск дээр хэн ч ажиллаагүй).  Огноо (`due_date`/`start_date`) өмнөх
 *    зан төлөвөөрөө хуулагдана.
 */

/** Нэг хуулбарт зөвшөөрөх таскийн дээд тоо (`structureCopyWrite.MAX_COPY_TASKS`-тэй ижил). */
export const MAX_DUPLICATE_TASKS = 2000;
export const MAX_BLOCK_NAME = 200;

/** Хөвөгч цэгийн шуугиан («99.99999999») босгыг хуурахгүйн тулд. */
const round6 = (n: number) => Math.round(n * 1e6) / 1e6;

export type WeightBudget = {
  /** Ижил багийн (team_id) блокуудын одоогийн нийлбэр жин. */
  team_total: number;
  /** Хуулбарын жин. */
  added: number;
  /** Хуулсны дараах нийлбэр. */
  after: number;
  over: boolean;
};

/** Блокийн жин нь «баг дотор 100%» (0062).  Жинг DB хүчээр тулгадаггүй — илүүдэл
 *  харагдах ёстой — тиймээс хуулалт илүүдэлтэй бол ДУУДАГЧ ил зөвшөөрөх ёстой. */
/** `weightBudget`-ийн `over`-ийн SQL ихэр (round6 ↔ ROUND(…, 6)) — блокийн INSERT-д.
 *  `s` = эх блок, `?2` = хуулбарын жин. */
const WITHIN_BUDGET_SQL = `ROUND((SELECT COALESCE(SUM(b.weight_percent), 0) FROM blocks b
                         WHERE b.project_id = s.project_id AND b.team_id IS s.team_id) + ?2, 6) <= 100`;

export function weightBudget(teamTotal: number, added: number): WeightBudget {
  const after = round6(teamTotal + added);
  return { team_total: round6(teamTotal), added: round6(added), after, over: after > 100 };
}

export type DuplicateBody = {
  name?: unknown;
  request_id?: unknown;
  weight_percent?: unknown;
  allow_over_budget?: unknown;
};

export type ParsedDuplicate =
  | {
      ok: true;
      name: string | null;
      requestId: string | null;
      weight: number | null;
      allowOverBudget: boolean;
    }
  | { ok: false; code: string; error: string };

const REQUEST_ID_RE = /^[A-Za-z0-9_.:-]{8,100}$/;

/** Биеийг шалгана.  Хуучин клиент `{}` илгээдэг тул бүх талбар сонголттой. */
export function parseDuplicateBody(body: DuplicateBody): ParsedDuplicate {
  let name: string | null = null;
  if (body.name !== undefined && body.name !== null) {
    if (typeof body.name !== 'string') return { ok: false, code: 'BAD_NAME', error: 'name must be a string' };
    const t = body.name.trim();
    if (t.length > MAX_BLOCK_NAME) return { ok: false, code: 'BAD_NAME', error: `name ≤ ${MAX_BLOCK_NAME} chars` };
    name = t || null;
  }
  let requestId: string | null = null;
  if (body.request_id !== undefined && body.request_id !== null) {
    if (typeof body.request_id !== 'string' || !REQUEST_ID_RE.test(body.request_id)) {
      return { ok: false, code: 'BAD_REQUEST_ID', error: 'request_id: 8–100 chars [A-Za-z0-9_.:-]' };
    }
    requestId = body.request_id;
  }
  let weight: number | null = null;
  if (body.weight_percent !== undefined && body.weight_percent !== null) {
    const w = body.weight_percent;
    if (typeof w !== 'number' || !Number.isFinite(w) || w < 0 || w > 100) {
      return { ok: false, code: 'BAD_WEIGHT', error: 'weight_percent must be a number 0–100' };
    }
    weight = w;
  }
  return { ok: true, name, requestId, weight, allowOverBudget: body.allow_over_budget === true };
}

export type SourceBlock = {
  id: number;
  project_id: number;
  name: string;
  weight_percent: number;
  team_id: number | null;
};

export type SourceCounts = { drawings: number; components: number; tasks: number };

export async function loadSourceBlock(db: D1Database, id: number): Promise<SourceBlock | null> {
  return db
    .prepare('SELECT id, project_id, name, weight_percent, team_id FROM blocks WHERE id = ?')
    .bind(id)
    .first<SourceBlock>();
}

/** Блокийн доорх модны хэмжээ (зураг ↔ бүрэлдэхүүн ↔ таск ЗӨВХӨН эцэгтэйгээ холбогдсон мөр). */
export async function countTree(db: D1Database, blockId: number): Promise<SourceCounts> {
  const r = await db
    .prepare(
      `SELECT
         (SELECT COUNT(*) FROM drawings d WHERE d.block_id = ?1) AS drawings,
         (SELECT COUNT(*) FROM components c JOIN drawings d ON d.id = c.drawing_id
            WHERE d.block_id = ?1) AS components,
         (SELECT COUNT(*) FROM tasks t JOIN components c ON c.id = t.component_id
            JOIN drawings d ON d.id = c.drawing_id WHERE d.block_id = ?1) AS tasks`,
    )
    .bind(blockId)
    .first<SourceCounts>();
  return { drawings: r?.drawings ?? 0, components: r?.components ?? 0, tasks: r?.tasks ?? 0 };
}

/** Ижил төсөл + ижил баг (`team_id IS ?` — баггүй блокууд нэг бүлэг) -ийн блокийн жингийн нийлбэр. */
export async function teamBlockWeight(db: D1Database, projectId: number, teamId: number | null): Promise<number> {
  const r = await db
    .prepare('SELECT COALESCE(SUM(weight_percent), 0) AS total FROM blocks WHERE project_id = ? AND team_id IS ?')
    .bind(projectId, teamId)
    .first<{ total: number }>();
  return r?.total ?? 0;
}

export type DuplicateOp = {
  request_id: string;
  user_id: number;
  project_id: number;
  source_block_id: number;
  new_block_id: number;
};

export async function loadOp(db: D1Database, requestId: string): Promise<DuplicateOp | null> {
  return db
    .prepare(
      `SELECT request_id, user_id, project_id, source_block_id, new_block_id
       FROM block_duplicate_ops WHERE request_id = ?`,
    )
    .bind(requestId)
    .first<DuplicateOp>();
}

/** Хуулалтын бүх statement — НЭГ `db.batch`-д ажиллана.  Дараалал чухал. */
export function duplicateStatements(
  db: D1Database,
  a: {
    requestId: string;
    userId: number;
    srcId: number;
    name: string;
    weight: number;
    now: string;
    /** false ⇒ багийн нийт жин 100-г давбал блок ОРОХГҮЙ (транзакц дотор шалгана). */
    allowOverBudget: boolean;
  },
): D1PreparedStatement[] {
  const op = '(SELECT new_block_id FROM block_duplicate_ops WHERE request_id = ?1)';
  return [
    // 1. Блок.  `sort_order` ба жингийн төсөв транзакц ДОТОР бодогдоно — зэрэг
    //    хуулбарууд ижил байр авахгүй, хамтдаа 100%-ийг давуулахгүй.
    db
      .prepare(
        `INSERT INTO blocks (project_id, name, weight_percent, sort_order, team_id, responsible_name)
         SELECT s.project_id, ?1, ?2,
                (SELECT COALESCE(MAX(b.sort_order), -1) + 1 FROM blocks b WHERE b.project_id = s.project_id),
                s.team_id, s.responsible_name
         FROM blocks s WHERE s.id = ?3 AND (?4 = 1 OR ${WITHIN_BUDGET_SQL})`,
      )
      .bind(a.name, a.weight, a.srcId, a.allowOverBudget ? 1 : 0),
    // 2. Журнал — ЗӨВХӨН дээрх блок орсон бол (`changes()` = 1-р statement-ийн мөр).
    //    request_id давхардвал ЭНД унаж batch бүхэлдээ буцна.
    db
      .prepare(
        `INSERT INTO block_duplicate_ops
           (request_id, user_id, project_id, source_block_id, new_block_id, name, weight_percent, created_at)
         SELECT ?1, ?2, s.project_id, s.id, (SELECT MAX(id) FROM blocks), ?3, ?4, ?5
         FROM blocks s WHERE s.id = ?6 AND changes() = 1`,
      )
      .bind(a.requestId, a.userId, a.name, a.weight, a.now, a.srcId),
    // 3. Зураг.
    db
      .prepare(
        `INSERT INTO drawings (block_id, name, weight_percent, sort_order)
         SELECT ${op}, d.name, d.weight_percent, d.sort_order
         FROM drawings d
         WHERE d.block_id = ?2 AND ${op} IS NOT NULL
         ORDER BY d.id`,
      )
      .bind(a.requestId, a.srcId),
    // 4. Бүрэлдэхүүн — эх зураг ↔ шинэ зураг id-ийн эрэмбээр.
    db
      .prepare(
        `INSERT INTO components (drawing_id, name, weight_percent, sort_order)
         WITH od AS (SELECT id, ROW_NUMBER() OVER (ORDER BY id) AS rn FROM drawings WHERE block_id = ?2),
              nd AS (SELECT id, ROW_NUMBER() OVER (ORDER BY id) AS rn FROM drawings WHERE block_id = ${op})
         SELECT nd.id, c.name, c.weight_percent, c.sort_order
         FROM components c
         JOIN od ON od.id = c.drawing_id
         JOIN nd ON nd.rn = od.rn
         ORDER BY c.id`,
      )
      .bind(a.requestId, a.srcId),
    // 5. Таск — эх бүрэлдэхүүн ↔ шинэ бүрэлдэхүүн id-ийн эрэмбээр.
    db
      .prepare(
        `INSERT INTO tasks (component_id, name, weight_percent, due_date, start_date, sort_order)
         WITH oc AS (SELECT c.id, ROW_NUMBER() OVER (ORDER BY c.id) AS rn
                     FROM components c JOIN drawings d ON d.id = c.drawing_id WHERE d.block_id = ?2),
              nc AS (SELECT c.id, ROW_NUMBER() OVER (ORDER BY c.id) AS rn
                     FROM components c JOIN drawings d ON d.id = c.drawing_id WHERE d.block_id = ${op})
         SELECT nc.id, t.name, t.weight_percent, t.due_date, t.start_date, t.sort_order
         FROM tasks t
         JOIN oc ON oc.id = t.component_id
         JOIN nc ON nc.rn = oc.rn
         ORDER BY t.id`,
      )
      .bind(a.requestId, a.srcId),
  ];
}

export const isRequestIdConflict = (e: unknown) =>
  /UNIQUE constraint failed: block_duplicate_ops\.request_id|SQLITE_CONSTRAINT_PRIMARYKEY/i.test(String(e));
