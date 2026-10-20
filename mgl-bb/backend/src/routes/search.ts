/**
 * Нэгдсэн хайлт — `GET /api/search?q=&limit=`.
 *
 * Хайлтын хайрцаг товчлуур бүрт дуудагдана: төслийг НЭР, УРТ ГАРЧИГ,
 * ЗУРГИЙН ШИФР, БАРИМТЫН ДУГААРААР нь олж, дараа нь тэдгээр төслийн
 * доторх БИЧЛЭГҮҮД (ЗХ тайлан, гүйцэтгэлийн тайлан, хурал, тоо хэмжээ)
 * -ийг хамт буцаана.
 *
 * ⚠️ ХООСОН / 2 тэмдэгтээс богино `q` нь 4xx БИШ, 200 + хоосон массив.
 *    UI нь энэ гарцыг ГАР ДАРАЛТ БҮРТ дууддаг тул алдаа буцаавал
 *    консол хог болж, `apiFetch` нь нэвтрэх рүү шидэх эрсдэлтэй.
 *
 * ⚠️ `withEdgeCache` ХЭРЭГЛЭХГҮЙ.  Тэр давхарга хэрэглэгчээр автоматаар
 *    хуваадаггүй (`varyTags`-ыг дуудагч гараар тоолно) бөгөөд `q` нь
 *    хязгааргүй олон утгатай — кэш нь ашиггүй, зөрчил нь аюултай.
 *
 * ⚠️ ЯАГААД SQL дотор текстийн шүүлт БАЙХГҮЙ вэ:
 *    • SQLite-ийн `lower()`/`LIKE` нь ЗӨВХӨН ASCII-г буулгадаг тул
 *      кирилл үсэгт огт ажиллахгүй;
 *    • алсын D1 нь урт TEXT багана дээрх `LIKE '%…%'`-ийг татгалздаг;
 *    • «MEC-25/21» ↔ «МЕС-25/21» гэсэн ХОЁР бичлэгийг зөвхөн
 *      `foldCodeVariants` эвлүүлдэг — SQL-д давтах боломжгүй.
 *    Хэмжсэн: 31 төслийн БҮТЭН уншилт 0.16 мс (~5 µs/мөр).  Индекс ч,
 *    FTS ч, миграц ч ХЭРЭГГҮЙ.
 *
 * ═══ ЗОРИУДААР ХАМРУУЛААГҮЙ ЭХ СУРВАЛЖУУД ═══
 *    • correspondence — эрхийн шалгалт нь `project_members` дээр тогтдог
 *      бөгөөд продакшнд тэр хүснэгт 5 мөртэй, бүгд client.  Ажилтан бүрд
 *      ҮРГЭЛЖ ХООСОН бүлэг харагдана — хайлтад утгагүй.
 *    • documents — `routes/documents.ts`-д дүрийн ч, гишүүнчлэлийн ч
 *      хаалт БАЙХГҮЙ (баримтжуулсан нээлттэй эрсдэл).  Хайлтад гаргавал
 *      мэдэгдэж буй нүхийг УЛАМ ӨРГӨН болгоно.
 *    • quotes — route бүр `requireAdmin`, үнэ нь нууц; түүнчлэн
 *      `quotes.project_id` нь үүсгэх үед хатуу NULL тул төсөлтэй огт
 *      холбогдохгүй.
 *    • email — 4882 мөр, ~30 мс.  DB дэх ХАМГИЙН ҮНЭТЭЙ уншилт;
 *      гар дараалт бүрт ажиллуулах боломжгүй.
 *
 * Модуль: `core` (`lib/modules.ts`).  Хайлтын хайрцаг нь апп-ын үндсэн
 * навигаци — унтраах боломжгүй.  Бүлэг тус бүрийн эрх нь ДООР, өөрийнх нь
 * route-ын дүрмийг ДАХИН бичсэн байдлаар шалгагдана.
 */
import { Hono } from 'hono';
import { foldText, foldCodeVariants } from '../lib/textFold';
import { isAdminRole } from '../types';
import { asrVisibleSql } from '../lib/asrVisibility';
import type { Env, AppVariables } from '../types';

const search = new Hono<{ Bindings: Env; Variables: AppVariables }>();

/* ------------------------------------------------------------------ */
/*  Хязгаарууд                                                         */
/* ------------------------------------------------------------------ */

/** Үүнээс богино хайлт → хоосон хариу (200).  Нэг үсэг бүх зүйлтэй таарна. */
const MIN_QUERY_CHARS = 2;

const DEFAULT_LIMIT = 8;
const MAX_LIMIT = 25;

/**
 * Бичлэг татах төслийн тоо.  Таарсан төсөл 20 байлаа ч тус бүрээс нь
 * бичлэг татвал 4 бүлэг × 20 = утгагүй том уншилт болно.  Хэрэглэгч
 * дээд талын үр дүнг л хардаг тул ЭХНИЙ 5 төсөл хангалттай.
 */
const RECORD_PROJECT_LIMIT = 5;

/** Нэг бүлгээс буцаах дээд бичлэг. */
const RECORDS_PER_GROUP = 8;

/* ------------------------------------------------------------------ */
/*  Гаралтын хэлбэр — ЭНЭ БОЛ ХӨЛДӨӨСӨН ГЭРЭЭ                          */
/* ------------------------------------------------------------------ */

export interface SearchProjectHit {
  id: number;
  name: string;
  display_title: string | null;
  full_title: string | null;
  drawing_no: string | null;
  doc_no: string | null;
  category: string | null;
  status: string;
  /** `true` ⇒ Зохиогчийн хяналтын төсөл — UI дээр «ЗХ» тэмдэглэгээтэй. */
  is_asr_only: boolean;
  is_pending: boolean;
}

export type SearchRecordKind = 'asr' | 'perf_report' | 'meeting' | 'qto';

export interface SearchRecordHit {
  kind: SearchRecordKind;
  id: number;
  project_id: number;
  /** Давхардсан шифрийг ялгахад ХЭРЭГТЭЙ — эзний шийдвэр (2026-09-03). */
  project_name: string;
  title: string;
  code: string | null;
  date: string | null;
  /** Бэлэн frontend зам (`?tab=`/`?section=` хамт). */
  to: string;
}

export interface SearchResponse {
  projects: SearchProjectHit[];
  records: SearchRecordHit[];
}

const EMPTY: SearchResponse = { projects: [], records: [] };

/* ------------------------------------------------------------------ */
/*  Мөрийн төрлүүд                                                     */
/* ------------------------------------------------------------------ */

interface ProjectRow {
  id: number;
  name: string;
  display_title: string | null;
  category: string | null;
  status: string;
  asr_only: number;
  is_pending: number;
  full_title: string | null;
  drawing_no: string | null;
  doc_no: string | null;
}

interface AsrRow {
  id: number;
  project_id: number;
  project_name: string;
  doc_no: string | null;
  shifr: string | null;
  description: string | null;
  report_date: string | null;
}

interface PerfRow {
  id: number;
  project_id: number;
  project_name: string;
  report_no: number;
  period_end: string | null;
  issued_at: string | null;
}

interface MeetingRow {
  id: number;
  project_id: number;
  project_name: string;
  title: string;
  meeting_date: string | null;
}

interface QtoRow {
  id: number;
  project_id: number;
  project_name: string;
  file_name: string | null;
  source: string | null;
  created_at: string | null;
}

/* ------------------------------------------------------------------ */
/*  Фолд + таарц (JS тал)                                              */
/* ------------------------------------------------------------------ */

/** Хэрэглэгчийн бичсэн НЭГ үг — текстийн ба шифрийн ХОЁР хэлбэрээр. */
interface QueryToken {
  /** `foldText`-ийн үр дүнг зайгаар хуваасан хэсгүүд (БҮГД таарах ёстой). */
  textParts: string[];
  /** `foldCodeVariants` — фонетик + глиф хувилбарууд. */
  codes: string[];
}

/** Нэг төслийн УРЬДЧИЛАН фолдлогдсон харьцуулах хэлбэр. */
interface PreparedProject {
  row: ProjectRow;
  /** Нэр + богино гарчиг + урт гарчиг, нэг мөр болгож фолдсон. */
  text: string;
  /** Зургийн шифр ба баримтын дугаарын БҮХ хувилбар. */
  codes: string[];
}

function prepareTokens(raw: string): QueryToken[] {
  const out: QueryToken[] = [];
  for (const word of raw.trim().split(/\s+/)) {
    if (!word) continue;
    const folded = foldText(word);
    const token: QueryToken = {
      textParts: folded ? folded.split(' ').filter(Boolean) : [],
      codes: foldCodeVariants(word),
    };
    // Зөвхөн цэг таслалаас бүрдсэн үг («!!», «—») нь юутай ч таарахгүй тул
    // хаяна.  Үлдээвэл «БҮХ үг таарна» (AND) дүрэм үр дүнг БҮГДИЙГ устгана.
    if (token.textParts.length > 0 || token.codes.length > 0) out.push(token);
  }
  return out;
}

function prepareProject(row: ProjectRow): PreparedProject {
  const text = foldText([row.name, row.display_title, row.full_title].filter((v) => !!v).join(' '));
  const codes: string[] = [];
  for (const src of [row.drawing_no, row.doc_no]) {
    if (!src) continue;
    for (const variant of foldCodeVariants(src)) {
      if (!codes.includes(variant)) codes.push(variant);
    }
  }
  return { row, text, codes };
}

/**
 * НЭГ үг таарсан эсэх.
 *
 * ⚠️ ШИФРИЙН ТАЛД ХОЁР ТАЛЫН ОЛОНЛОГ ОГТЛОЛЦОНО — `lib/textFold.ts`-ийн
 * `foldCodeVariants`-ийн толгойд бичигдсэн дүрэм.  Зөвхөн хадгалсан
 * талыг нь дэлгэвэл ХАНГАЛТГҮЙ: «MEC-25/21» аль хэдийн латин тул түүний
 * олонлог {mec2521} ганцаараа бөгөөд кириллээр бичсэн хайлт 'mes2521'
 * хэвээр үлдэж ХЭЗЭЭ Ч таарахгүй.
 */
function tokenMatches(tok: QueryToken, p: PreparedProject): boolean {
  if (tok.textParts.length > 0 && tok.textParts.every((part) => p.text.includes(part))) {
    return true;
  }
  for (const form of tok.codes) {
    if (p.codes.some((code) => code.includes(form))) return true;
  }
  return false;
}

/** 0 = шифр ЯГ таарсан · 1 = эхлэлээр таарсан · 2 = бусад. */
function rankOf(p: PreparedProject, queryCodes: string[], queryText: string): number {
  if (p.codes.some((code) => queryCodes.includes(code))) return 0;
  if (p.codes.some((code) => queryCodes.some((qc) => code.startsWith(qc)))) return 1;
  if (queryText && p.text.startsWith(queryText)) return 1;
  return 2;
}

/* ------------------------------------------------------------------ */
/*  GET /api/search                                                    */
/* ------------------------------------------------------------------ */

search.get('/', async (c) => {
  const user = c.get('user');
  const rawQuery = (c.req.query('q') ?? '').trim();
  if (rawQuery.length < MIN_QUERY_CHARS) return c.json(EMPTY);

  const limitParam = Number.parseInt(c.req.query('limit') ?? '', 10);
  const limit =
    Number.isFinite(limitParam) && limitParam > 0 ? Math.min(limitParam, MAX_LIMIT) : DEFAULT_LIMIT;

  const tokens = prepareTokens(rawQuery);
  if (tokens.length === 0) return c.json(EMPTY);

  const isClient = user.role === 'client';
  /**
   * ⚠️ ГАРААР БИЧСЭН нь ЗОРИУДААР.  `PROJECT_LIST_SQL`-д энэ нь дефолт
   * `true`-тэй параметр бөгөөд `mcp/tools/*` ба `lib/clientReport.ts`
   * хоёул түүнийг дамжуулахаа мартаад «гэрээ хэлэлцээрийн шатны»
   * төслийг өнөөдөр ил гаргаж байгаа.  Тэр алдааг энд ДАВТАХГҮЙ.
   */
  const seesPending = isAdminRole(user.role) || user.role === 'senior';

  /*
   * ⚠️ ЭНД `NOT_ASR_ONLY_SQL` БАЙХГҮЙ — `PROJECT_LIST_SQL`-ээс ЗОРИУДААР
   * ЗӨРСӨН.  Зохиогчийн хяналтын төсөл (`asr_only=1`) нь Төслүүд хуудас,
   * sidebar, dashboard-аас хасагддаг ч `lib/asrTargets.ts` нь тэдгээрт
   * ЖИНХЭНЭ ШИФР БИЧДЭГ.  Шифрээр хайхад олдохгүй бол хэрэглэгч «шифр нь
   * алга болжээ» гэж ойлгоно.  Тиймээс энд ХАРАГДАНА — гаралт дээрээ
   * `is_asr_only: true` тугтай бөгөөд UI нь «ЗХ» тэмдэглэгээ зурна.
   * (Эзний шийдвэр, 2026-09-03.)  Үүнийг «засаж» БОЛОХГҮЙ.
   */
  const projectSql = `
    SELECT p.id, p.name, p.display_title, p.category, p.status,
           COALESCE(p.asr_only, 0)   AS asr_only,
           COALESCE(p.is_pending, 0) AS is_pending,
           pp.full_title, pp.drawing_no, pp.doc_no
      FROM projects p
      LEFT JOIN project_passport pp ON pp.project_id = p.id
      ${isClient ? 'INNER JOIN project_members pm ON pm.project_id = p.id AND pm.user_id = ?' : ''}
     WHERE 1=1
       ${seesPending ? '' : 'AND COALESCE(p.is_pending, 0) = 0'}
  `;

  const projectStmt = isClient
    ? c.env.DB.prepare(projectSql).bind(user.sub)
    : c.env.DB.prepare(projectSql);
  const projectRows = (await projectStmt.all<ProjectRow>()).results ?? [];

  const queryCodes = foldCodeVariants(rawQuery);
  const queryText = foldText(rawQuery);

  const matched = projectRows
    .map(prepareProject)
    .filter((p) => tokens.every((tok) => tokenMatches(tok, p)))
    .map((p) => ({ p, rank: rankOf(p, queryCodes, queryText) }))
    .sort((a, b) => a.rank - b.rank || a.p.row.name.localeCompare(b.p.row.name))
    .slice(0, limit)
    .map((m) => m.p.row);

  const projects: SearchProjectHit[] = matched.map((r) => ({
    id: r.id,
    name: r.name,
    display_title: r.display_title,
    full_title: r.full_title,
    drawing_no: r.drawing_no,
    doc_no: r.doc_no,
    category: r.category,
    status: r.status,
    is_asr_only: Number(r.asr_only) === 1,
    is_pending: Number(r.is_pending) === 1,
  }));

  const records = await loadRecords(
    c.env.DB,
    { sub: user.sub, role: user.role, isClient, seesPending },
    rawQuery,
    matched.slice(0, RECORD_PROJECT_LIMIT),
  );

  return c.json({ projects, records } satisfies SearchResponse);
});

/* ------------------------------------------------------------------ */
/*  Бичлэгүүд — бүлэг тус бүр ӨӨРИЙН эрхийн дүрмийг ДАХИН бичнэ         */
/* ------------------------------------------------------------------ */

/**
 * ЗХ тайлан ХАРАХ эрхтэй дүрүүд — `routes/authorSupervision.ts`-ийн
 * `ASR_ROLES`-ийн ХУУЛБАР.
 */
const ASR_ROLES = new Set(['admin', 'engineer', 'architect', 'senior']);

/**
 * Гүйцэтгэлийн тайлан ХАЙЛТАД харах эрхтэй дүрүүд.
 *
 * ⚠️ ЦАГААН ЖАГСААЛТ, ХАР ЖАГСААЛТ БИШ.  Өмнө нь энэ нь
 * `role !== 'client' && role !== 'worker'` байсан — тэр хэлбэр нь
 * ирээдүйд нэмэгдэх ШИНЭ дүрд гүйцэтгэлийн тайланг ЧИМЭЭГҮЙ нээж өгнө
 * (fail-open).  Энэ файлын бусад бүх хаалт, мөн
 * `authorSupervision.ts:198` нь ЦАГААН ЖАГСААЛТААР бичигдсэн — өгөгдмөл
 * нь ХААЛТТАЙ.  Өнөөдрийн зургаан дүр дээр зан төлөв нь ЯГ хэвээр:
 * admin/engineer/architect/senior → тийм, client/worker → үгүй.
 *
 * ⚠️ `routes/performanceReports.ts` нь жагсаалтаа `assertProjectVisible`
 * -ээр хамгаалдаг: ажилтан бүх төслийг, `client` нь ЗӨВХӨН
 * `project_members` гишүүнчлэлтэй төслөө хардаг.  Хайлтад `client`-ийг
 * БҮРМӨСӨН хассан нь ЗОРИУДААР — прод дээр `project_members` нь
 * 5 мөртэй, бодитоор хөтлөгддөггүй тул хайлтын үр дүн нь тогтворгүй
 * байх бөгөөд «яагаад заримыг нь харагдахгүй байна» гэсэн ойлгомжгүй
 * гомдол төрүүлнэ.  `worker` нь `lib/workerScope.ts`-ийн цагаан
 * жагсаалтад `/api/search` байхгүй тул энд ХЭЗЭЭ Ч хүрэхгүй — энэ Set
 * бол тэр хамгаалалтын давхарлал.
 */
const PERF_REPORT_ROLES = new Set(['admin', 'engineer', 'architect', 'senior']);

/**
 * ⚠️ Бүлэг бүрийн хаалт нь өөрийнх нь route-ын дүрмийн ХУУЛБАР.  Энд
 * `requireRole` дуудах боломжгүй (нэг хүсэлт дөрвөн ӨӨР эрхийн муж
 * хамардаг) тул дүрмийг гараар давтав.  Эх route өөрчлөгдвөл ЭНЭ ФАЙЛЫГ
 * МӨН засна:
 *   asr         → `routes/authorSupervision.ts` (client 403; ноорог нуугдана)
 *   perf_report → `routes/performanceReports.ts` (client нь гишүүнчлэлээр)
 *   meeting     → `routes/meetings.ts`   (`meetings.use('*', requireAdmin())`)
 *   qto         → `routes/qto.ts`        (`QTO_ROLES = ['admin','senior']`)
 *
 * ⚠️ ТҮҮНЧЛЭН — ЭНЭ ФАЙЛЫН ҮНДСЭН ХӨДӨЛШГҮЙ ДҮРЭМ:
 *    **БИЧЛЭГ нь өөрийг нь эзэмшдэг ТӨСЛӨӨС ИЛҮҮ ИЛ БАЙЖ БОЛОХГҮЙ.**
 *    Дүрийн хаалт («ЗХ харах эрхтэй юу?») нь ХАНГАЛТГҮЙ — түүн дээр
 *    нэмээд төслийн харагдацын дүрэм (`is_pending` + client-ийн
 *    гишүүнчлэл) заавал давхарлагдана.  `IN (${idHoles})` хэлбэртэй
 *    бүлгүүд үүнийг ҮНЭГҮЙ авдаг (id-ууд нь дээрх төслийн асуулгаас
 *    гардаг), харин ШУУД КОДООР хайдаг бүлэг өөрөө хийх ЁСТОЙ.
 */
async function loadRecords(
  db: D1Database,
  viewer: { sub: number; role: string; isClient: boolean; seesPending: boolean },
  rawQuery: string,
  projects: ProjectRow[],
): Promise<SearchRecordHit[]> {
  const { role, isClient, seesPending } = viewer;
  const isAdmin = isAdminRole(role);
  const canAsr = ASR_ROLES.has(role);
  const canPerf = PERF_REPORT_ROLES.has(role);
  const canMeeting = isAdmin;
  const canQto = isAdmin || role === 'senior';

  const ids = projects.map((p) => p.id);
  const hasIds = ids.length > 0;
  const idHoles = ids.map(() => '?').join(',');
  // ЗХ-ийн багийн харагдац (2026-09-29) — ББ-гийнхэн ББ-гийн тайланг л олно.
  const asrVisible = asrVisibleSql({ sub: viewer.sub, isAdmin });

  /**
   * ⚠️ ГАР ДАРААХ ШУУД КОДЫН ТААРЦ.  «ASR-007» гэж бичихэд тухайн тайлан
   * нь төслийн НЭР/ШИФРТЭЙ таараагүй ч олдох ёстой.  `doc_no` нь ЯГ
   * `ASR-NNN` хэлбэртэй, БҮРЭН ASCII тул SQLite-ийн `lower()`+`instr()`
   * найдвартай ажиллана (кирилл дээр бол ажиллахгүй байсан — тиймээс
   * хайх мөр ASCII биш бол энэ асуулгыг ОГТ явуулахгүй).
   *
   * ⚠️ Гүйцэтгэлийн тайланд ижил зүйл ХИЙГЭЭГҮЙ: тэнд `doc_no` багана
   * БАЙХГҮЙ, зөвхөн төсөл дотроо дугаарлагдсан бүхэл тоо `report_no`
   * байдаг.  «2» гэж хайхад БҮХ төслийн «Тайлан №2» цуварна — хог.
   */
  const needle = rawQuery.toLowerCase();
  const asciiNeedle = /^[\x20-\x7e]+$/.test(needle) ? needle : null;

  /**
   * ⚠️ ТӨСЛИЙН ХАРАГДАЦЫН ХЭЛТЭРХИЙ — дээрх `projectSql`-ийн ЯГ ижил хоёр
   * нөхцөл, `projects p`-тэй холбогдсон ДУРЫН асуулгад залгаж хэрэглэнэ.
   *
   * ⚠️ Яагаад хэрэгтэй вэ: `IN (${idHoles})` бүлгүүд харагдацаа
   * ҮНЭГҮЙ авдаг (id-ууд нь аль хэдийн шүүгдсэн төслийн асуулгаас
   * ирдэг) ч ШУУД `doc_no`-гоор хайдаг бүлэг тэр жагсаалтыг ТУУЛДАГГҮЙ.
   * Хэлтэрхийг залгаагүй үед «ASR-007» гэж бичсэн инженер/архитектор
   * ГЭРЭЭ ХЭЛЭЛЦЭЭРИЙН ШАТНЫ (`is_pending`) төслийн тайланг хардаг
   * байв — яг тэр алдаанаас сэргийлэхийн тулд дээрх төслийн асуулга
   * тусгайлан бичигдсэн (~:257).
   *
   * ⚠️ Bind-ийн ДАРААЛАЛ чухал: JOIN дахь `?` нь WHERE-ийнхээс ӨМНӨ
   * тоологдох тул `visBinds`-ыг ҮРГЭЛЖ эхэнд нь дамжуулна.  D1-ийн
   * 100-bind хязгаараас хол (хамгийн ихдээ 1 + 1).
   */
  const visJoin = isClient
    ? 'INNER JOIN project_members pm ON pm.project_id = p.id AND pm.user_id = ?'
    : '';
  const visWhere = seesPending ? '' : 'AND COALESCE(p.is_pending, 0) = 0';
  const visBinds: unknown[] = isClient ? [viewer.sub] : [];

  interface Group {
    kind: SearchRecordKind;
    stmt: D1PreparedStatement;
  }
  const groups: Group[] = [];

  if (canAsr && hasIds) {
    groups.push({
      kind: 'asr',
      stmt: db
        .prepare(
          `SELECT r.id, r.project_id, p.name AS project_name, r.doc_no, r.shifr,
                  r.description, r.report_date
             FROM author_supervision_reports r
             INNER JOIN projects p ON p.id = r.project_id
            WHERE r.project_id IN (${idHoles}) AND r.status <> 'draft'
              AND ${asrVisible}
            ORDER BY r.report_date DESC, r.id DESC
            LIMIT ${RECORDS_PER_GROUP}`,
        )
        .bind(...ids),
    });
  }
  if (canAsr && asciiNeedle) {
    groups.push({
      kind: 'asr',
      stmt: db
        .prepare(
          `SELECT r.id, r.project_id, p.name AS project_name, r.doc_no, r.shifr,
                  r.description, r.report_date
             FROM author_supervision_reports r
             INNER JOIN projects p ON p.id = r.project_id
             ${visJoin}
            WHERE r.status <> 'draft'
              ${visWhere}
              AND ${asrVisible}
              AND instr(lower(COALESCE(r.doc_no, '')), ?) > 0
            ORDER BY r.report_date DESC, r.id DESC
            LIMIT ${RECORDS_PER_GROUP}`,
        )
        .bind(...visBinds, asciiNeedle),
    });
  }
  if (canPerf && hasIds) {
    groups.push({
      kind: 'perf_report',
      stmt: db
        .prepare(
          `SELECT r.id, r.project_id, p.name AS project_name, r.report_no,
                  r.period_end, r.issued_at
             FROM project_performance_reports r
             INNER JOIN projects p ON p.id = r.project_id
            WHERE r.project_id IN (${idHoles})
            ORDER BY r.report_no DESC, r.id DESC
            LIMIT ${RECORDS_PER_GROUP}`,
        )
        .bind(...ids),
    });
  }
  if (canMeeting && hasIds) {
    groups.push({
      kind: 'meeting',
      stmt: db
        .prepare(
          `SELECT m.id, m.project_id, p.name AS project_name, m.title, m.meeting_date
             FROM meetings m
             INNER JOIN projects p ON p.id = m.project_id
            WHERE m.project_id IN (${idHoles})
            ORDER BY m.meeting_date DESC, m.id DESC
            LIMIT ${RECORDS_PER_GROUP}`,
        )
        .bind(...ids),
    });
  }
  if (canQto && hasIds) {
    groups.push({
      kind: 'qto',
      stmt: db
        .prepare(
          `SELECT q.id, q.project_id, p.name AS project_name, q.file_name,
                  q.source, q.created_at
             FROM qto_runs q
             INNER JOIN projects p ON p.id = q.project_id
            WHERE q.project_id IN (${idHoles})
            ORDER BY q.created_at DESC, q.id DESC
            LIMIT ${RECORDS_PER_GROUP}`,
        )
        .bind(...ids),
    });
  }

  if (groups.length === 0) return [];

  // НЭГ round trip.  `project_id` индексүүд аль хэдийн байгаа:
  // idx_asr_project · idx_perf_reports_project · idx_meetings_project ·
  // idx_qto_runs_project.
  const results = await db.batch(groups.map((g) => g.stmt));

  const out: SearchRecordHit[] = [];
  // ЗХ-ийн ХОЁР асуулга (төслөөр + кодоор) давхцаж болно.
  const seen = new Set<string>();

  for (let i = 0; i < groups.length; i += 1) {
    const group = groups[i];
    if (!group) continue;
    const rows = results[i]?.results ?? [];
    for (const raw of rows) {
      const hit = toRecordHit(group.kind, raw as Record<string, unknown>);
      const key = `${hit.kind}:${hit.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(hit);
    }
  }
  return out;
}

/** Түүхий мөр → гэрээний хэлбэр.  `to` нь ЖИНХЭНЭ frontend зам. */
function toRecordHit(kind: SearchRecordKind, raw: Record<string, unknown>): SearchRecordHit {
  switch (kind) {
    case 'asr': {
      const r = raw as unknown as AsrRow;
      return {
        kind,
        id: r.id,
        project_id: r.project_id,
        project_name: r.project_name,
        title: shorten(r.description) ?? r.shifr ?? 'Зохиогчийн хяналтын тайлан',
        code: r.doc_no,
        date: r.report_date,
        // `/app/asr/:reportId` — `AsrPage` нь тайланг ЭНЭ НЭГ замаар нээдэг.
        to: `/app/asr/${r.id}`,
      };
    }
    case 'perf_report': {
      const r = raw as unknown as PerfRow;
      return {
        kind,
        id: r.id,
        project_id: r.project_id,
        project_name: r.project_name,
        title: `Гүйцэтгэлийн тайлан №${r.report_no}`,
        code: String(r.report_no).padStart(2, '0'),
        date: r.issued_at ?? r.period_end,
        to: `/app/projects/${r.project_id}/performance-reports`,
      };
    }
    case 'meeting': {
      const r = raw as unknown as MeetingRow;
      return {
        kind,
        id: r.id,
        project_id: r.project_id,
        project_name: r.project_name,
        title: r.title,
        code: null,
        date: r.meeting_date,
        to: `/app/meeting-notes/${r.id}`,
      };
    }
    case 'qto': {
      const r = raw as unknown as QtoRow;
      return {
        kind,
        id: r.id,
        project_id: r.project_id,
        project_name: r.project_name,
        title: r.file_name ?? 'Тоо хэмжээний илгээлт',
        code: r.file_name,
        date: r.created_at,
        // ⚠️ `QtoPage` нь сонгосон төслөө `useState`-д барьдаг — URL
        //    параметр БАЙХГҮЙ.  Тиймээс төслийг урьдчилан сонгодог
        //    `?project=` гэдгийг ЗОХИОЖ БОЛОХГҮЙ (чимээгүй үл ойшоогдоно);
        //    зөвхөн хуудасны Түүх таб руу аваачна.
        to: '/app/qto?tab=history',
      };
    }
  }
}

/** Урт тайлбарыг жагсаалтын НЭГ мөрд багтаана. */
function shorten(text: string | null | undefined, max = 80): string | null {
  if (!text) return null;
  const flat = text.replace(/\s+/g, ' ').trim();
  if (!flat) return null;
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

export default search;
