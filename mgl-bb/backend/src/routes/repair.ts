import { Hono } from 'hono';
import { requireRole, requireAdmin } from '../middleware/auth';
import { todayInUB } from '../lib/time';
import { leaderboardMemberSql } from '../lib/ceo';
import {
  WORK_DAY_HOURS,
  baseDailyRate as ladderRate,
  hoursProgressSql,
  backfillProgressPct,
  pctForHours,
  type BaseRate,
} from '../lib/repairProgress';
import { summarizeRepairHours, type RepairHoursRow } from '../lib/repairHours';
import {
  ENDPOINT_BACKFILL_DAYS,
  createLiveMark,
  deleteMark,
  hoursBackfillStatus,
  markHoursBackfillDone,
  runHoursBackfill,
  syncRepairDay,
  type RepairMarkRow,
} from '../lib/repairDayStore';
import type {
  Env,
  AppVariables,
  CreateRepairRequest,
  RepairEntryRow,
  RepairAdminRow,
  RepairProjectRow,
  RepairProjectInput,
} from '../types';

/* ============================================================
 * /api/repair — ажилтны өөрөө бүртгэх засвар / нэмэлт ажил.
 *
 *  Засвар нь project-ийн ахицыг урагшлуулдаггүй (өмнө хийсэн ажлыг засдаг)
 *  тул энгийн progress шиг leaderboard оноо авдаггүй — шударга бус. Энэ route
 *  нь ажилтанд засвараа цаг (man-hours)-аар бүртгэх боломж олгоно.
 *
 *  Хувь нь ажилтны ӨДРИЙН ДУНДАЖ хувь дээр суурилна (эзний шийдвэр,
 *  2026-08-25): «өдрийн дундаж хувь нь 1.2% хүн 4 цаг зарцуулбал өдрийн
 *  0.6%-ийг авна».  Нэг ажлын өдөр = 8 цаг = 100%:
 *
 *      computed_pct = base_daily_rate × (hours / WORK_DAY_HOURS)
 *
 *  Засвар нь батлагдах шаардлагагүй, шууд user_points (source='repair')-д
 *  бичигдэж leaderboard-д ордог.
 *
 *  Зөвхөн leaderboard-eligible role (engineer/architect/senior) засвар үүсгэнэ
 *  — admin/client оноо авдаггүй тул засвар бүртгэх шаардлагагүй.
 *
 *  ── ҮНЭЛГЭЭ: ӨДРИЙН ДУНДАЖ ХАНШ ШАТАЛСАН БАЙДЛААР ОЛДОНО ──────────────
 *  Анх томьёо нь ЗӨВХӨН тухайн хүний өөрийн сүүлийн 7 хоногийн гаргацаар
 *  үрждэг байв.  Энэ нь яг энэ функцэд зориулагдсан хүнийг — «бүх төсөл
 *  эзэнтэй, хийх ажил алга» — 0 оноотой үлдээдэг байсан: 7 хоногт progress
 *  оноо аваагүй ⇒ үржүүлэгч 0 ⇒ хэдэн ч цаг ажилласан 0.
 *
 *  Тиймээс `baseDailyRate` нь ЭХНИЙ ТЭГ БИШ утгыг шатлан олно.  Шат бүр
 *  НЭГ АЖЛЫН ӨДӨРТ ноогдох дундаж хувь болж хөрвөнө (цонхны хуанлийн өдрийг
 *  5/7-оор үржүүлж ажлын өдөр болгоно):
 *      1. self7      — өөрийн 7 хоног      ÷ 5 ажлын өдөр
 *      2. self90     — өөрийн 90 хоног     ÷ 64.29 ажлын өдөр
 *      3. team30     — багийн 30 хоног     ÷ (гишүүдийн тоо × 21.43)
 *      4. company30  — компанийн 30 хоног  ÷ (ажилтны тоо × 21.43)
 *  1-р шат хамгийн түрүүнд ялдаг тул ИДЭВХТЭЙ АЖИЛЛАЖ БАЙГАА хүний хувьд
 *  түүний өөрийн гаргац шийднэ — зөвхөн 0 болж унасан тохиолдолд доошоо
 *  шатална.
 *
 *      computed_pct = baseDailyRate × (hours / 8)
 *
 *  Хоёулаа бичлэг үүсэх үед SNAPSHOT-логдоно (`weekly_avg_pct` — нэр нь
 *  түүхэн, 0196-аас хойш ӨДРИЙН ханш хадгална; ба `rate_source`).
 *  `user_points` бол ДЭВТЭР — хожим ханш хэлбэлзсэн ч түүхэн оноо хөдлөхгүй.
 *
 *  ⚠️ `repair_projects.rate_multiplier` нь 2026-08-25-нд ҮХМЭЛ болсон (эзэн
 *  «үржвэр хэрэггүй» гэж шийдсэн).  Багана нь `DEFAULT 1`-тэйгээ үлдсэн —
 *  устгахад хүснэгт дахин байгуулах шаардлагатай бөгөөд ашиггүй.  Энэ файл
 *  түүнийг УНШИХГҮЙ, БИЧИХГҮЙ.
 *
 *  ── ЦАГИЙГ СИСТЕМ БОДНО (эзний шийдвэр 2026-09-25, миграц 0348) ────────
 *  ⚠️ Доорх «ажилтан өөрөө оруулна» (2026-09-23) хэсгийг ДАРСАН.  Одоо
 *  ажилтан цаг БИЧИХГҮЙ: `POST /` нь «өнөөдөр үүн дээр ажилласан» гэсэн
 *  ТЭМДЭГЛЭГЭЭ (`repair_marks`) үүсгэнэ, цагийг өдрийн бөглөлтүүдээс систем
 *  хуваарилна (lib/repairDay.ts — дүрэм, lib/repairDayStore.ts — D1):
 *  өдөр = ээлж − цай = 8 цаг, нэг суултаар бөглөсөн бүх таскт тэнцүү, өглөө
 *  өөр ажлаа бөглөсөн бол тэр цагаас эхэлнэ.  Хувь = 30 хоногийн өдрийн
 *  дундаж × цаг / 8 (lib/repairProgress.ts).  Хуучин (гараар бичсэн) мөрүүд
 *  `hours_source = 'manual'` хэвээр, өдрийн багтаамжаас эхэлж хасагдана.
 *  Ирцийн тааз сэргээгдээгүй — өдрийн сүүлийн бөглөлт ээлж дуустал сунадаг
 *  тул «та 0.1 цаг ажилласан» гэсэн асуудал давтагдахгүй.
 *
 *  ── (ТҮҮХ) ЦАГИЙГ АЖИЛТАН ӨӨРӨӨ ОРУУЛНА (эзний шийдвэр, 2026-09-23) ────
 *  ⚠️ ИРЦЭЭС ГАРГАСАН ЦАГИЙН ТААЗ ХАСАГДСАН.  Урьд нь `dailyHourCap` нь
 *  тухайн өдрийн нийт засварын цагийг ирцийн session-ээс (хаагдсаны
 *  `hours_worked` + нээлттэйн одоог хүртэлх хугацаа) гаргаж хязгаарладаг
 *  байв.  Практикт энэ нь СИСТЕМ ажилтанд «та 0.1 цаг ажилласан байна» гэж
 *  хэлэх үр дагавартай: дөнгөж ирцээ бүртгээд ажлаа дуусгасан хүн 8 цаг
 *  бичих гэхэд «Ирцээс хэтэрч байна — өнөөдөр дээд тал нь 0.1 цаг» гэж
 *  няцаагдана.  `hasReportedWorkToday` (attendance.ts) нь ажлаа гарахын
 *  ӨМНӨ бүртгэхийг шаарддаг тул бүртгэх МӨЧИД өнгөрсөн хугацаа нь бараг
 *  үргэлж бодит ажилласан цагаас БАГА байдаг — тааз нь зарчмын хувьд
 *  ажилтнаас хоцордог.
 *
 *  Одоо: ажилтан хэдэн цаг зарцуулснаа ӨӨРӨӨ оруулна, систем түүн дээр
 *  тулгуурлаж хувийг өдрийн дундажаас автоматаар бодно.  Ирцийн бүртгэл
 *  байх шаардлага БАЙХГҮЙ.  Үлдсэн хамгаалалт нь зөвхөн ХЭМЖЭЭНИЙ ухаалаг
 *  дээд хязгаар (`MAX_REPAIR_HOURS` нэг бичлэгт, `MAX_REPAIR_HOURS_PER_DAY`
 *  тухайн өдрийн нийлбэрт) ба ИРЭЭДҮЙН огноог няцаах — эдгээр нь «та хэдэн
 *  цаг ажилласан» гэж ХЭЛДЭГГҮЙ, зөвхөн утгагүй тоог хаана.
 *
 *  ── ЗАСВАРЫН ТӨСӨЛ (`repair_projects`, миграци 0194) ──────────────────
 *  Засвар нь ХОЁР эх сурвалжийн аль нэгэнд холбогдоно:
 *    • `project_id`        — жинхэнэ төсөл дээрх дахин ажил (анхны загвар);
 *    • `repair_project_id` — админы ГАРААР үүсгэсэн засварын төсөл.
 *  Хоёр багана дээр `CHECK ((project_id IS NULL) <> (repair_project_id IS
 *  NULL))` буюу ЯГ НЭГ нь дүүрэн байх дүрэм DB-д бичигдсэн.
 *
 *  Засварын төсөл нь `projects` хүснэгтэд ОРДОГГҮЙ.  Учир нь бүх төсөл
 *  эзэнтэй болчихсон үед ажилтан компанийн дотоод ажил хийж цагаа бүртгэх
 *  сав хэрэгтэй боловч тэр сав нь Төслүүд хуудас, хянах самбар, Timeline,
 *  компанийн тойм, MCP, клиент портал, глобал хайлтад ГАРАХ ЁСГҮЙ.  Тусдаа
 *  хүснэгт байснаар `projects.id` огт үүсдэггүй тул тэдгээр 126 асуулгын
 *  НЭГЭНД Ч шүүлт нэмэх шаардлагагүй — далдлах тугийн (`is_pending`) адил
 *  «нэгийг нь мартвал алдагдана» гэсэн эрсдэл байхгүй.
 *
 *  ── ЗӨВХӨН ЦАГ, ХУВЬГҮЙ, ТАЙЛБАРГҮЙ (2026-09-24) ─────────────────────
 *  Ажилтан засварын ажлаа ЦАГААР бүртгэнэ, хувь ХАРАХГҮЙ: бүртгэх цонхонд
 *  «өдрийн %», «авах %», «явцад нэмэгдэх %» байхгүй, «хийсэн засвар» гэсэн
 *  тайлбарын талбар ч хасагдсан.  `description` багана 0114-д NOT NULL тул
 *  шинэ мөрөнд '' бичигдэнэ (хуучин тайлбарууд хэвээр).  Оноо
 *  (`computed_pct` → `user_points`) ХЭВЭЭР бодогдоно, төслийн явц нь тэр оноо
 *  (2026-09-29, lib/repairProgress.ts `hoursProgressSql`)
 *  — зөвхөн ажилтанд харагдахгүй.  `task_id` (0341) нь цагаар бодогддог
 *  төслийн таскийн мөрөөс бүртгэхэд таскийг тэмдэглэнэ — «хэн хэдэн цаг»
 *  хураангуй нь `GET /hours` (lib/repairHours.ts).
 * ============================================================ */

const repair = new Hono<{ Bindings: Env; Variables: AppVariables }>();

/* `WORK_DAY_HOURS` (8 цаг = өдрийн 100%) нь одоо
 * lib/repairProgress.ts-д — оноо ба явц (миграц 0339) хоёулаа НЭГ тогтмолоос.
 * 0348-аас хойш цагийг систем хуваарилдаг тул нэг өдөр ээлжээсээ (8 цаг)
 * хэтрэхгүй — гараар оруулах үеийн 24/12 цагийн хязгаар хэрэггүй болсон. */

/** Гараар бүртгэх нэг бичлэгийн дээд цаг (2026-10-08 сэргээсэн). */
const MAX_REPAIR_HOURS = 24;
/** Гараар бүртгэх өдрийн нийлбэрийн дээд хязгаар; `GET /rate`-ийн `daily_cap`. */
const MAX_REPAIR_HOURS_PER_DAY = 12;

const REPAIR_ROLES = ['engineer', 'architect', 'senior'] as const;
/** Засварын төслийн ЖАГСААЛТЫГ уншиж болох role-ууд.  Админ засвар бүртгэдэггүй
 *  ч жагсаалтаа хараад шинээр нэмэх ёстой тул энд нэмэгдэнэ. */
const REPAIR_VIEW_ROLES = ['engineer', 'architect', 'senior', 'admin'] as const;

/**
 * Засварын ОНООНЫ суурь ханш — «нэг АЖЛЫН ӨДРИЙН дундаж гаргац хэдэн ОНОО вэ».
 *
 * Эхний тэг биш утгыг шатлан сонгоно (`pickLadderRate`).  Шат бүр нэг хүний
 * ӨДРИЙН ДУНДАЖ — lib/dailyAverage.ts-ийн ГАНЦ дүрэм (2026-09-28): сүүлийн K
 * АЖИЛЛАСАН өдөр (30 хоног = 21, 90 = 64); шинэ хүн ажилд орсноос хойш
 * ажилласан өдрөөрөө хуваагдана; батлагдсан чөлөө (ээлжийн амралт) алгасагдаж
 * өмнөх ажлын өдрүүдээр нөхөгдөнө; дуусаагүй өдөр оноо авсан бол л тоологдоно.
 *
 *   1. self30     — өөрийн сүүлийн 21 ажилласан өдрийн дундаж.  Хамгийн түрүүнд
 *                   ялдаг (0348-аас өмнө self7 байв — эзний «30 хоногийн дундаж»).
 *   2. self90     — өөрийн сүүлийн 64 ажилласан өдрийн дундаж.
 *   3. team30     — багийнхаа гишүүн бүрийн self30-ийн дундаж (`users.team_id`).
 *   4. company30  — компанийн ажилтан бүрийн self30-ийн дундаж.
 *
 * ⚠️ Хуваарь ба хуваагч нь ИЖИЛ хүн амыг хамарна: `leaderboardMemberSql(…,
 * false)` + `status='active'` + `is_support = 0`.  Хэрэв тоологчид CEO-гийн
 * оноо орчихоод хуваагчид тэр өөрөө ороогүй бол дундаж хиймлээр өснө.
 * `includeCeo = false` тул хоёр талдаа ижилхэн хасагдана.
 *
 * 0348-аас хойш шатанд хүний БҮХ ажил орно (хувиар бөглөсөн + засварын цаг +
 * төслийн бус ажил) — бүх ZA төсөл цагаар бодогдох болсноор зөвхөн засвар
 * хийдэг хүний ханш баг/компанийн дундаж руу «унахаас» сэргийлнэ.  Өдөр ≤ 8
 * цаг тул засвар өөрийн ханшийг өсгөж чадахгүй, зөвхөн хадгална
 * (lib/repairProgress.ts `measureSql`).
 *
 * Хэрэгжүүлэлт нь lib/repairProgress.ts `baseDailyRate('amount', …)`.  ЯВЦЫН
 * ханш (`progressDailyRate`) ижил шат, ижил цонх, зөвхөн хэмжигдэхүүн нь
 * төслийн-%.  Өдрийг УБ-ийн цагаар тоолно.
 */
async function baseDailyRate(db: D1Database, userId: number): Promise<BaseRate> {
  return ladderRate(db, userId, 'amount', leaderboardMemberSql('u', false));
}

/**
 * Засварын ЯВЦЫН ханш (миграц 0339) — ижил шат, харин `user_points.delta_pct`
 * (төслийн %) хэмжигдэхүүнээр.  `progress_pct = ханш × цаг/8` нь snapshot л —
 * 2026-09-29-нөөс зорилтын явцыг олгосон оноо (`hoursProgressSql`) тодорхойлно.
 */
async function progressDailyRate(db: D1Database, userId: number): Promise<BaseRate> {
  return ladderRate(db, userId, 'delta_pct', leaderboardMemberSql('u', false));
}

/** Тухайн өдөр аль хэдийн бүртгэсэн засварын цаг. */
async function loggedHoursOn(db: D1Database, userId: number, date: string): Promise<number> {
  const row = await db
    .prepare(
      `SELECT COALESCE(SUM(hours), 0) AS h FROM repair_entries WHERE user_id = ? AND date = ?`,
    )
    .bind(userId, date)
    .first<{ h: number }>();
  return Math.max(0, Number(row?.h ?? 0));
}

/* ------------------------------------------------------------------
 * Засварын төсөл (admin CRUD)
 *
 * ⚠ МАРШРУТЫН ДАРААЛАЛ: `/projects*` нь доорх `/:id`-аас ӨМНӨ байна.  Одоо
 *   `/:id` нь зөвхөн DELETE (нэг сегмент) тул мөргөлдөхгүй ч шинэ нэг
 *   сегментийн route нэмэгдвэл энэ дараалал л хамгаална.
 * ------------------------------------------------------------------ */

// GET /api/repair/projects — цонхны сонголтын жагсаалт.
//   Анхдагчаар зөвхөн `status='active'`; админ `?include_archived=1`-ээр
//   архивласныг нь хамт харна (удирдах хэсэгт хэрэгтэй).  Ажилтанд архивласан
//   мөр ХЭЗЭЭ Ч буцахгүй — эс бөгөөс тэр түүнийг сонгоод POST дээр 400 иднэ.
repair.get('/projects', requireRole(...REPAIR_VIEW_ROLES), async (c) => {
  const user = c.get('user');
  const includeArchived = user.role === 'admin' && c.req.query('include_archived') === '1';

  const { results } = await c.env.DB.prepare(
    `SELECT rp.id, rp.name, rp.description, rp.status, rp.sort_order,
            rp.created_by, rp.created_at,
            (SELECT COUNT(*) FROM repair_entries re WHERE re.repair_project_id = rp.id)
              AS entry_count,
            -- Ажилласан цаг (2026-09-24): «хувь» биш «хэдэн цаг, хэдэн хүн».
            ROUND((SELECT COALESCE(SUM(re.hours), 0) FROM repair_entries re
                    WHERE re.repair_project_id = rp.id), 2) AS total_hours,
            (SELECT COUNT(DISTINCT re.user_id) FROM repair_entries re
              WHERE re.repair_project_id = rp.id) AS people_count,
            ROUND(${hoursProgressSql('repair_project_id', 'rp.id')}, 2) AS progress
     FROM repair_projects rp
     ${includeArchived ? '' : `WHERE rp.status = 'active'`}
     ORDER BY rp.sort_order ASC, rp.name ASC`,
  ).all<RepairProjectRow>();
  return c.json({ items: results ?? [] });
});

// POST /api/repair/projects — админ шинэ засварын төсөл үүсгэнэ.
repair.post('/projects', requireAdmin(), async (c) => {
  const user = c.get('user');
  const body = await c.req.json<RepairProjectInput>();

  const name = (body.name ?? '').trim();
  if (!name) return c.json({ error: 'name is required' }, 400);
  if (name.length > 200) return c.json({ error: 'name is too long' }, 400);
  const description = (body.description ?? '')?.toString().trim() || null;
  const sortOrder = Number.isFinite(body.sort_order) ? Number(body.sort_order) : 0;

  // Нэр нь UNIQUE (0194).  Давхардлыг 500 болгож гаргалгүй ойлгомжтой 409
  // болгож хөрвүүлнэ — админ ижил нэрийг хоёр удаа бичих нь энгийн явдал.
  const dup = await c.env.DB.prepare(`SELECT id FROM repair_projects WHERE name = ?`)
    .bind(name)
    .first<{ id: number }>();
  if (dup) return c.json({ error: 'Ийм нэртэй засварын төсөл аль хэдийн байна', id: dup.id }, 409);

  const row = await c.env.DB.prepare(
    `INSERT INTO repair_projects (name, description, sort_order, created_by)
     VALUES (?, ?, ?, ?)
     RETURNING id, name, description, status, sort_order, created_by, created_at`,
  )
    .bind(name, description, sortOrder, user.sub)
    .first<RepairProjectRow>();
  if (!row) return c.json({ error: 'Failed to create repair project' }, 500);

  // Шинэ засварын төсөл 0%-иас эхэлнэ (0339) — явц нь зөвхөн цагийн
  // бүртгэлээс нэмэгдэнэ, хэн ч гараар хувь өгөхгүй.
  return c.json(
    { project: { ...row, entry_count: 0, total_hours: 0, people_count: 0, progress: 0 } },
    201,
  );
});

// POST /api/repair/backfill-progress — админ: 0339-оос ӨМНӨХ бүртгэлүүдийн
//   явцын хувийг (`progress_pct`) мөр бүрийн огноогоор нөхөж бодно.  Идемпотент:
//   `progress_rate_source IS NULL` мөрүүд л; `?all=1` бол бүгдийг дахин.
//   Approvals → Засвар самбарын «Явц нөхөж тооцох» товч энийг дуудна.
//   ⚠ МАРШРУТЫН ДАРААЛАЛ: доорх `DELETE /:id`-аас өмнө (POST тул мөргөлдөхгүй
//   ч тодорхой байлгав).
repair.post('/backfill-progress', requireAdmin(), async (c) => {
  const all = c.req.query('all') === '1';
  const limitRaw = Number(c.req.query('limit'));
  const limit = Number.isInteger(limitRaw) && limitRaw > 0 ? limitRaw : undefined;
  const res = await backfillProgressPct(c.env.DB, leaderboardMemberSql('u', false), { all, limit });
  const remaining = all
    ? 0
    : Number(
        (
          await c.env.DB.prepare(
            `SELECT COUNT(*) AS n FROM repair_entries WHERE progress_rate_source IS NULL`,
          ).first<{ n: number }>()
        )?.n ?? 0,
      );
  return c.json({ ...res, remaining });
});

// PATCH /api/repair/projects/:rid — нэр/тайлбар/төлөв/эрэмбэ.
//   Архивлах нь УСТГАХЫН оронд: `repair_entries` нь зөвхөн FK хадгалдаг,
//   нэрийн хуулбар авдаггүй тул мөрийг устгавал бүх түүхэн бичлэг нэрээ алдана.
repair.patch('/projects/:rid', requireAdmin(), async (c) => {
  const rid = Number(c.req.param('rid'));
  if (!Number.isInteger(rid) || rid <= 0) return c.json({ error: 'Invalid id' }, 400);
  const body = await c.req.json<RepairProjectInput>();

  const sets: string[] = [];
  const binds: (string | number | null)[] = [];

  if (body.name !== undefined) {
    const name = (body.name ?? '').trim();
    if (!name) return c.json({ error: 'name is required' }, 400);
    if (name.length > 200) return c.json({ error: 'name is too long' }, 400);
    const dup = await c.env.DB.prepare(`SELECT id FROM repair_projects WHERE name = ? AND id <> ?`)
      .bind(name, rid)
      .first<{ id: number }>();
    if (dup) return c.json({ error: 'Ийм нэртэй засварын төсөл аль хэдийн байна' }, 409);
    sets.push('name = ?');
    binds.push(name);
  }
  if (body.description !== undefined) {
    sets.push('description = ?');
    binds.push((body.description ?? '')?.toString().trim() || null);
  }
  if (body.status !== undefined) {
    if (body.status !== 'active' && body.status !== 'archived') {
      return c.json({ error: "status must be 'active' or 'archived'" }, 400);
    }
    sets.push('status = ?');
    binds.push(body.status);
  }
  if (body.sort_order !== undefined && Number.isFinite(body.sort_order)) {
    sets.push('sort_order = ?');
    binds.push(Number(body.sort_order));
  }
  if (sets.length === 0) return c.json({ error: 'Nothing to update' }, 400);

  const res = await c.env.DB.prepare(
    `UPDATE repair_projects SET ${sets.join(', ')} WHERE id = ?`,
  )
    .bind(...binds, rid)
    .run();
  if (res.meta.changes === 0) return c.json({ error: 'Not found' }, 404);

  return c.json({ message: 'Repair project updated' });
});

// DELETE /api/repair/projects/:rid — зөвхөн ХООСОН (бичлэггүй) төслийг устгана.
//   Бичлэгтэй бол 409 — архивлахыг зөвлөнө.  Ингэснээр түүхэн засварын мөр
//   хэзээ ч эзэнгүй үлдэхгүй (0194-ийн CHECK нь repair_project_id NULL болохыг
//   зөвшөөрөхгүй).  Ирцийн сонголт (0324: `daily_active_repairs`,
//   `attendance_checkpoint_repairs`) ч мөн адил — түүхэн ирц дээр нэргүй мөр
//   үлдэхгүйн тулд тэдгээр байхад ч 409.
repair.delete('/projects/:rid', requireAdmin(), async (c) => {
  const rid = Number(c.req.param('rid'));
  if (!Number.isInteger(rid) || rid <= 0) return c.json({ error: 'Invalid id' }, 400);

  // Тэмдэглэгээ (0348) ч «бүртгэл» — 0 цаг ногдсон ч мөргүй үлдэж болох тул
  // `repair_entries`-ээс гадна тусад нь тоолно.
  const used = await c.env.DB.prepare(
    `SELECT
       (SELECT COUNT(*) FROM repair_entries WHERE repair_project_id = ?)
       + (SELECT COUNT(*) FROM repair_marks WHERE repair_project_id = ?) AS n,
       (SELECT COUNT(*) FROM daily_active_repairs WHERE repair_project_id = ?)
       + (SELECT COUNT(*) FROM attendance_checkpoint_repairs WHERE repair_project_id = ?)
         AS attendance_n`,
  )
    .bind(rid, rid, rid, rid)
    .first<{ n: number; attendance_n: number }>();
  if ((used?.n ?? 0) > 0) {
    return c.json(
      {
        error: 'Бүртгэлтэй засвартай тул устгах боломжгүй — архивлана уу',
        entry_count: used?.n ?? 0,
      },
      409,
    );
  }
  if ((used?.attendance_n ?? 0) > 0) {
    return c.json(
      {
        error: 'Ирцээр сонгогдсон байсан тул устгах боломжгүй — архивлана уу',
        attendance_count: used?.attendance_n ?? 0,
      },
      409,
    );
  }

  const res = await c.env.DB.prepare(`DELETE FROM repair_projects WHERE id = ?`).bind(rid).run();
  if (res.meta.changes === 0) return c.json({ error: 'Not found' }, 404);
  return c.json({ message: 'Repair project deleted' });
});

// GET /api/repair/rate — цонхны live preview-ийн суурь тоонууд.
//   `daily_rate` = ажилтны өдрийн дундаж хувь, `rate_source` нь «яагаад ийм
//   тоо гарав?»-д хариулна.
//   `daily_cap` нь 2026-09-23-аас ИРЦЭЭС ХАМААРАХГҮЙ тогтмол өдрийн дээд
//   хязгаар (12 ц) — ажилтан цагаа өөрөө оруулна.  `daily_logged` нь тухайн
//   өдөр аль хэдийн бүртгэсэн нийлбэр, цонх нь хоёрыг хамт харуулна.
repair.get('/rate', requireRole(...REPAIR_ROLES), async (c) => {
  const user = c.get('user');
  const date = todayInUB();
  const [base, progressBase, logged] = await Promise.all([
    baseDailyRate(c.env.DB, user.sub),
    progressDailyRate(c.env.DB, user.sub),
    loggedHoursOn(c.env.DB, user.sub, date),
  ]);
  return c.json({
    daily_rate: base.rate,
    rate_source: base.source,
    // Явцын ханш (0339) — цонхны «төсөлд нэмэгдэх явц» урьдчилсан харалт.
    progress_rate: progressBase.rate,
    progress_rate_source: progressBase.source,
    work_day_hours: WORK_DAY_HOURS,
    daily_cap: MAX_REPAIR_HOURS_PER_DAY,
    daily_logged: logged,
  });
});

// GET /api/repair/hours?project_id=N | ?repair_project_id=N — АЖИЛЛАСАН ЦАГИЙН
//   хураангуй (2026-09-24): нийт цаг, хүн бүрийн цаг («А — 3 цаг, Б — 5 цаг»),
//   таск бүрийн цаг + хүмүүс (0341 `task_id`), таскгүй цаг.  Цагаар бодогддог
//   төслийн хуудас ба дотоод ажлын самбар уншина.  ХУВЬ буцаахгүй.
//   Ажилтан бүр харна (төслийн хуудас ажилтан бүрд нээлттэй тул ижил хүрээ);
//   client/worker-ийг scope guard-ууд `/api/repair`-ээс аль хэдийн хаадаг.
repair.get('/hours', requireRole(...REPAIR_VIEW_ROLES), async (c) => {
  const projectId = Number(c.req.query('project_id'));
  const repairProjectId = Number(c.req.query('repair_project_id'));
  const hasProject = Number.isInteger(projectId) && projectId > 0;
  const hasRepairProject = Number.isInteger(repairProjectId) && repairProjectId > 0;
  if (hasProject === hasRepairProject) {
    return c.json({ error: 'Exactly one of project_id / repair_project_id is required' }, 400);
  }
  const col = hasProject ? 'project_id' : 'repair_project_id';
  // LEFT JOIN tasks: таскгүй эсвэл устсан таск (FK тайлагдаагүй үлдсэн id) →
  // task_id NULL → «таскгүй цаг» болж нийлнэ, хэзээ ч алга болохгүй.
  const { results } = await c.env.DB.prepare(
    `SELECT re.user_id, u.full_name, t.id AS task_id,
            SUM(re.hours) AS hours, COUNT(*) AS entries, MAX(re.date) AS last_date
       FROM repair_entries re
       JOIN users u      ON u.id = re.user_id
       LEFT JOIN tasks t ON t.id = re.task_id
      WHERE re.${col} = ?
      GROUP BY re.user_id, t.id`,
  )
    .bind(hasProject ? projectId : repairProjectId)
    .all<RepairHoursRow>();
  return c.json(summarizeRepairHours(results ?? []));
});

/** Засварын мөрийг нэрлэх нийтлэг SELECT.
 *
 *  ⚠️ LEFT JOIN байх ЁСТОЙ.  0194-ийн дараа мөрийн `project_id` NULL байж
 *  болох тул хуучин `JOIN projects` нь засварын төсөл дээрх БҮХ бичлэгийг
 *  чимээгүй алга болгоно — ажилтан бүртгээд түүхээсээ алга болохыг нь хардаг.
 *  `task_name` (0341) — таскийн мөрөөс бүртгэсэн бол; бусад үед NULL. */
const NAME_JOIN = `
  LEFT JOIN projects        p  ON p.id  = r.project_id
  LEFT JOIN repair_projects rp ON rp.id = r.repair_project_id
  LEFT JOIN tasks           tk ON tk.id = r.task_id`;
const NAME_COL = `COALESCE(p.name, rp.name) AS project_name,
                  CASE WHEN r.repair_project_id IS NOT NULL THEN 1 ELSE 0 END AS is_repair_project,
                  tk.id AS task_id, tk.name AS task_name`;

// GET /api/repair/all — admin: бүх ажилтны засварын түүх (submitter + төслийн нэртэй).
repair.get('/all', requireAdmin(), async (c) => {
  const userId = Number(c.req.query('user_id'));
  const projectId = Number(c.req.query('project_id'));
  const repairProjectId = Number(c.req.query('repair_project_id'));

  const filters: string[] = [];
  const binds: (number | string)[] = [];
  if (Number.isInteger(userId) && userId > 0) {
    filters.push('r.user_id = ?');
    binds.push(userId);
  }
  if (Number.isInteger(projectId) && projectId > 0) {
    filters.push('r.project_id = ?');
    binds.push(projectId);
  }
  if (Number.isInteger(repairProjectId) && repairProjectId > 0) {
    filters.push('r.repair_project_id = ?');
    binds.push(repairProjectId);
  }
  const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';

  const { results } = await c.env.DB.prepare(
    `SELECT r.id, r.user_id, r.project_id, r.repair_project_id, r.description,
            r.hours, r.day_hours, r.weekly_avg_pct, r.rate_source,
            r.computed_pct, r.progress_pct, r.date, r.created_at,
            u.full_name AS user_full_name, ${NAME_COL}
     FROM repair_entries r
     JOIN users u ON u.id = r.user_id
     ${NAME_JOIN}
     ${where}
     ORDER BY r.created_at DESC
     LIMIT 200`,
  )
    .bind(...binds)
    .all<RepairAdminRow>();
  return c.json({ items: results ?? [] });
});

// GET /api/repair/my — тухайн ажилтны засваруудын түүх (төслийн нэртэй).
//   0348-аас хойш хоёр төрөл НЭГ жагсаалтад: `repair_entries` мөр (гараар
//   бичсэн / тэмдэглэгээнээс бодсон / хуучин бөглөлтөөс нөхсөн) + ӨӨРИЙН
//   тэмдэглэгээ боловч 0 цаг ногдсон тул мөргүй (`kind = 'mark'`, hours 0) —
//   сүүлийнх нь алга болбол ажилтан «хадгалагдсангүй» гэж бодно.
repair.get('/my', requireRole(...REPAIR_ROLES), async (c) => {
  const user = c.get('user');
  const { results } = await c.env.DB.prepare(
    `SELECT 'entry' AS kind, r.id, r.mark_id, r.project_id, r.repair_project_id, r.description,
            r.hours, r.day_hours, r.weekly_avg_pct, r.rate_source, r.computed_pct, r.progress_pct,
            r.date, r.created_at, r.hours_source, ${NAME_COL}
     FROM repair_entries r
     ${NAME_JOIN}
     WHERE r.user_id = ?
     UNION ALL
     SELECT 'mark' AS kind, m.id, m.id AS mark_id, m.project_id, m.repair_project_id, '' AS description,
            0 AS hours, ${WORK_DAY_HOURS} AS day_hours, m.daily_rate AS weekly_avg_pct, m.rate_source,
            0 AS computed_pct, 0 AS progress_pct, m.date, m.marked_at AS created_at,
            'auto' AS hours_source,
            COALESCE(mp.name, mrp.name) AS project_name,
            CASE WHEN m.repair_project_id IS NOT NULL THEN 1 ELSE 0 END AS is_repair_project,
            mt.id AS task_id, mt.name AS task_name
     FROM repair_marks m
     LEFT JOIN projects        mp  ON mp.id  = m.project_id
     LEFT JOIN repair_projects mrp ON mrp.id = m.repair_project_id
     LEFT JOIN tasks           mt  ON mt.id  = m.task_id
     WHERE m.user_id = ? AND m.award_points = 1
       AND NOT EXISTS (SELECT 1 FROM repair_entries r2 WHERE r2.mark_id = m.id)
     ORDER BY created_at DESC
     LIMIT 100`,
  )
    .bind(user.sub, user.sub)
    .all<RepairEntryRow & { project_name: string }>();
  return c.json({ items: results ?? [] });
});

// GET /api/repair/hours-backfill — админ: хуучин ZA хувийн бөглөлтөөс цаг
//   нөхөх ажлын үлдэгдэл (0348).  Cron өөрөө бага багаар нөхдөг; энэ нь
//   Approvals → Засвар самбарын товчны тоолуур.
repair.get('/hours-backfill', requireAdmin(), async (c) => {
  const status = await hoursBackfillStatus(c.env.DB);
  return c.json(status);
});

// POST /api/repair/hours-backfill?days=N — админ: дараагийн N ажилтан-өдрийг
//   нөхнө (өгөгдмөл 15, ≤25 — D1 нэг дуудлагад ≤1000 асуулга, ≈35 асуулга/өдөр).  Идемпотент;
//   товч нь `remaining_days = 0` болтол давтан дуудна.
repair.post('/hours-backfill', requireAdmin(), async (c) => {
  const raw = Number(c.req.query('days'));
  const days = Number.isInteger(raw) && raw > 0 ? Math.min(raw, 25) : ENDPOINT_BACKFILL_DAYS;
  const res = await runHoursBackfill(c.env.DB, { maxDays: days });
  if (res.remaining_days === 0) await markHoursBackfillDone(c.env.DB);
  return c.json(res);
});

// POST /api/repair — хоёр горимтой:
//   • `hours` + `description` ирвэл ГАРААР бүртгэнэ (хуучин логик, 2026-10-08
//     сэргээсэн — «Засвар бүртгэх» цонх): хувь = өдрийн дундаж × цаг/8,
//     `hours_source='manual'`, өдрийн нийлбэр ≤ 12 цаг.
//   • `hours` ирэхгүй бол «өнөөдөр үүн дээр ажилласан» ТЭМДЭГЛЭГЭЭ (0348,
//     My Tasks-ийн «Ажилласан» товч): цагийг
//   өдрийн бөглөлтүүдээс систем хуваарилна (`syncRepairDay`).  Огноо үргэлж
//   ӨНӨӨДӨР: цаг нь «тэмдэглэсэн агшин»-аас бодогддог тул өнгөрсөн өдөрт
//   тэмдэглэх нь утгагүй.  Ижил ажлыг өнөөдөр дахин тэмдэглэвэл шинэ мөр
//   үүсэхгүй — байгааг нь буцаана (200).
repair.post('/', requireRole(...REPAIR_ROLES), async (c) => {
  const user = c.get('user');
  const body = await c.req.json<CreateRepairRequest>().catch(() => ({}) as CreateRepairRequest);

  // Яг НЭГ эзэн: жинхэнэ төсөл ЭСВЭЛ засварын төсөл (0194-ийн CHECK-ийн
  // програм талын хос).  Хоёулаа/аль нь ч биш бол 400 — DB-ийн CHECK-д
  // хүрч 500 болгохгүй.
  const projectId = Number(body.project_id);
  const repairProjectId = Number(body.repair_project_id);
  const hasProject = Number.isInteger(projectId) && projectId > 0;
  const hasRepairProject = Number.isInteger(repairProjectId) && repairProjectId > 0;
  if (hasProject === hasRepairProject) {
    return c.json({ error: 'Exactly one of project_id / repair_project_id is required' }, 400);
  }

  // Таск (0341) — зөвхөн цагаар бодогддог жинхэнэ төслийн таск.  Доор
  // төсөлтэй нь тулгана.
  const rawTaskId = body.task_id;
  const hasTask = rawTaskId !== undefined && rawTaskId !== null;
  const taskId = Number(rawTaskId);
  if (hasTask && !(Number.isInteger(taskId) && taskId > 0)) {
    return c.json({ error: 'Invalid task_id' }, 400);
  }
  if (hasTask && !hasProject) {
    return c.json({ error: 'task_id requires project_id' }, 400);
  }
  const today = todayInUB();
  // `hours` ирсэн = ГАРААР бүртгэх хуучин зам (2026-10-08 сэргээсэн): ажилтан
  // тайлбар + цагаа өөрөө оруулна.  Ирээгүй = 0348-ын «Ажилласан» тэмдэглэгээ
  // (My Tasks-ийн hours мөрийн товч) — цагийг систем хуваарилна.
  const manual = body.hours !== undefined && body.hours !== null;
  const description = (body.description ?? '').trim();
  const hours = Number(body.hours);
  let date = today;
  if (manual) {
    if (!description) return c.json({ error: 'description is required' }, 400);
    if (!Number.isFinite(hours) || hours <= 0 || hours > MAX_REPAIR_HOURS) {
      return c.json({ error: `hours must be between 0 and ${MAX_REPAIR_HOURS}` }, 400);
    }
    date = body.date && /^\d{4}-\d{2}-\d{2}$/.test(body.date) ? body.date : today;
    // Ирээдүйн огноог ил няцаана — эс бөгөөс «2027-01-01-д 8 цаг» оноо, явцад шууд орно.
    if (date > today) {
      return c.json({ error: 'Ирээдүйн огноогоор засвар бүртгэх боломжгүй' }, 400);
    }
  } else if (body.date && body.date !== today) {
    return c.json({ error: 'Засварыг зөвхөн өнөөдрийн огноогоор тэмдэглэнэ' }, 400);
  }

  if (hasProject) {
    // Project оршин буй эсэхийг шалгана (FK хангалтгүй D1-д тодорхой алдаа өгөх).
    const project = await c.env.DB.prepare(`SELECT id, progress_mode FROM projects WHERE id = ?`)
      .bind(projectId)
      .first<{ id: number; progress_mode: string | null }>();
    if (!project) return c.json({ error: 'Project not found' }, 404);
    if (hasTask) {
      // Ердийн (жинлэсэн) төслийн таск ХӨНДӨГДӨХГҮЙ — тэнд явц нь хувиар.
      if (project.progress_mode !== 'hours') {
        return c.json({ error: 'task_id is only allowed on an hours-mode project' }, 400);
      }
      const task = await c.env.DB.prepare(
        `SELECT t.id FROM tasks t
           JOIN components co ON co.id = t.component_id
           JOIN drawings d    ON d.id  = co.drawing_id
           JOIN blocks b      ON b.id  = d.block_id
          WHERE t.id = ? AND b.project_id = ?`,
      )
        .bind(taskId, projectId)
        .first<{ id: number }>();
      if (!task) return c.json({ error: 'Task not found in this project' }, 404);
    }
  } else {
    // Архивласан засварын төсөл дээр ШИНЭ бичлэг хийхийг хориглоно — тэр нь
    // жагсаалтаас аль хэдийн алга болсон, зөвхөн түүхэндээ л амьд.
    const rp = await c.env.DB.prepare(`SELECT id, status FROM repair_projects WHERE id = ?`)
      .bind(repairProjectId)
      .first<{ id: number; status: string }>();
    if (!rp) return c.json({ error: 'Repair project not found' }, 404);
    if (rp.status !== 'active') return c.json({ error: 'Repair project is archived' }, 400);
  }

  if (manual) {
    // Өдрийн нийлбэр 12 цагаас хэтрэхгүй (ирцээс ХАМААРАХГҮЙ — 2026-09-23-ны дүрэм).
    const alreadyLogged = await loggedHoursOn(c.env.DB, user.sub, date);
    const cap = MAX_REPAIR_HOURS_PER_DAY;
    if (alreadyLogged + hours > cap + 0.01) {
      return c.json(
        {
          error: `Өдөрт дээд тал нь ${cap} цаг бүртгэнэ: тухайн өдөр аль хэдийн ${alreadyLogged.toFixed(1)} цаг бүртгэсэн байна`,
          daily_cap: cap,
          daily_logged: alreadyLogged,
        },
        400,
      );
    }

    // Хувь = ӨДРИЙН ДУНДАЖ ханш × (цаг / 8); оноо ба явцын ханш энэ агшинд хөлдөнө.
    const [base, progressBase] = await Promise.all([
      baseDailyRate(c.env.DB, user.sub),
      progressDailyRate(c.env.DB, user.sub),
    ]);
    const computed = pctForHours(base.rate, hours);
    const progressPct = pctForHours(progressBase.rate, hours);

    // hours_source = 'manual' (өгөгдмөл) — `syncRepairDay` энэ мөрийг хөндөхгүй,
    // харин өдрийн багтаамжаас хасна.
    const inserted = await c.env.DB.prepare(
      `INSERT INTO repair_entries
         (user_id, project_id, repair_project_id, task_id, description, hours, day_hours,
          weekly_avg_pct, rate_source, computed_pct, date,
          progress_rate, progress_rate_source, progress_pct)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       RETURNING id`,
    )
      .bind(
        user.sub,
        hasProject ? projectId : null,
        hasProject ? null : repairProjectId,
        hasTask ? taskId : null,
        description,
        hours,
        WORK_DAY_HOURS,
        base.rate,
        base.source,
        computed,
        date,
        progressBase.rate,
        progressBase.source,
        progressPct,
      )
      .first<{ id: number }>();
    const repairId = inserted?.id;
    if (!repairId) return c.json({ error: 'Failed to create repair entry' }, 500);

    // source='repair' тул recalculateProjectPoints дарж устгахгүй.
    await c.env.DB.prepare(
      `INSERT INTO user_points
         (user_id, project_id, repair_project_id, task_id, progress_entry_id,
          amount, delta_pct, assignee_count, awarded_by, source, repair_entry_id)
       VALUES (?, ?, ?, NULL, NULL, ?, ?, 1, ?, 'repair', ?)`,
    )
      .bind(
        user.sub,
        hasProject ? projectId : null,
        hasProject ? null : repairProjectId,
        computed,
        computed,
        user.sub,
        repairId,
      )
      .run();

    // Өнөөдрийн «Ажилласан» тэмдэглэгээнүүдийн цаг гар цагийг хасаж дахин хуваагдана.
    if (date === today) await syncRepairDay(c.env.DB, user.sub, today);

    return c.json(
      {
        id: repairId,
        created: true,
        date,
        hours,
        computed_pct: computed,
        daily_rate: base.rate,
        rate_source: base.source,
        progress_pct: progressPct,
        progress_rate: progressBase.rate,
        progress_rate_source: progressBase.source,
        work_day_hours: WORK_DAY_HOURS,
        daily_cap: cap,
        daily_logged: alreadyLogged + hours,
      },
      201,
    );
  }

  // Тэмдэглэгээ + ханшийн snapshot (оноо ба явц энэ агшинд хөлдөнө), дараа нь
  // өдрийг бүхэлд нь дахин хуваарилна — өмнөх тэмдэглэгээнүүдийн цаг ч
  // өөрчлөгдөж болно (2 таск → 4 + 4).
  const target = {
    project_id: hasProject ? projectId : null,
    repair_project_id: hasProject ? null : repairProjectId,
    task_id: hasTask ? taskId : null,
  };
  const { mark, created } = await createLiveMark(c.env.DB, user.sub, today, target);
  const sync = await syncRepairDay(c.env.DB, user.sub, today);
  return c.json(
    {
      id: mark.id,
      mark_id: mark.id,
      created,
      date: today,
      hours: sync.hoursByMark.get(mark.id) ?? 0,
      /** Өнөөдрийн бүх тэмдэглэгээний шинэ цаг — цонх бусад мөрөө ч шинэчилнэ. */
      today: [...sync.hoursByMark].map(([markId, hours]) => ({ mark_id: markId, hours })),
    },
    created ? 201 : 200,
  );
});

/**
 * Тэмдэглэгээг болиулна: зөвхөн ӨӨРИЙН, оноотой (ажилтны товчоор үүссэн)
 * тэмдэглэгээ.  Хуучин хувийн бөглөлтөөс нөхсөн (`award_points = 0`) нь
 * системийн бүртгэл — ажилтан устгахгүй.  Тэр өдрийн бусад тэмдэглэгээ цагаа
 * буцааж хуваана.
 */
async function removeMark(
  db: D1Database,
  userId: number,
  markId: number,
): Promise<{ status: 200 | 403 | 404 | 409; body: Record<string, unknown> }> {
  const mark = await db
    .prepare(`SELECT * FROM repair_marks WHERE id = ?`)
    .bind(markId)
    .first<RepairMarkRow>();
  if (!mark) return { status: 404, body: { error: 'Not found' } };
  if (mark.user_id !== userId) return { status: 403, body: { error: 'Forbidden' } };
  if (mark.award_points !== 1) {
    return {
      status: 409,
      body: { error: 'Хуучин хувийн бөглөлтөөс бодсон цагийг устгах боломжгүй', code: 'BACKFILL_MARK' },
    };
  }
  await deleteMark(db, markId);
  await syncRepairDay(db, userId, mark.date);
  return { status: 200, body: { message: 'Repair deleted', mark_id: markId, date: mark.date } };
}

// DELETE /api/repair/marks/:markId — «ажилласан» тэмдэглэгээгээ болиулах (0348).
repair.delete('/marks/:markId', requireRole(...REPAIR_ROLES), async (c) => {
  const user = c.get('user');
  const markId = Number(c.req.param('markId'));
  if (!Number.isInteger(markId) || markId <= 0) return c.json({ error: 'Invalid id' }, 400);
  const res = await removeMark(c.env.DB, user.sub, markId);
  return c.json(res.body, res.status);
});

// DELETE /api/repair/:id — зөвхөн эзэн өөрийн засвараа устгана (оноог нь дагуулж).
//   Тэмдэглэгээнээс бодсон мөр бол тэр ТЭМДЭГЛЭГЭЭГ болиулна (мөр дангаараа
//   устгавал дараагийн хуваарилалт буцааж үүсгэнэ).  Гараар бичсэн хуучин мөр
//   бол хуучин ёсоор, дараа нь тэр өдрийг дахин хуваарилна (багтаамж өөрчлөгдсөн).
repair.delete('/:id', requireRole(...REPAIR_ROLES), async (c) => {
  const user = c.get('user');
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id) || id <= 0) return c.json({ error: 'Invalid id' }, 400);

  const row = await c.env.DB.prepare(`SELECT user_id, date, mark_id FROM repair_entries WHERE id = ?`)
    .bind(id)
    .first<{ user_id: number; date: string; mark_id: number | null }>();
  if (!row) return c.json({ error: 'Not found' }, 404);
  if (row.user_id !== user.sub) return c.json({ error: 'Forbidden' }, 403);

  if (row.mark_id != null) {
    const res = await removeMark(c.env.DB, user.sub, row.mark_id);
    return c.json(res.body, res.status);
  }

  // user_points-ийг гараар устгана (D1-д FK cascade хангалтгүй байж болзошгүй).
  await c.env.DB.batch([
    c.env.DB.prepare(`DELETE FROM user_points WHERE repair_entry_id = ?`).bind(id),
    c.env.DB.prepare(`DELETE FROM repair_entries WHERE id = ?`).bind(id),
  ]);
  await syncRepairDay(c.env.DB, user.sub, row.date);

  return c.json({ message: 'Repair deleted' });
});

export default repair;
