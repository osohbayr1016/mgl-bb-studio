/**
 * Засварын төслийн ЯВЦ — цагийн бүртгэлээс (миграц 0339, эзний шийдвэр
 * 2026-09-21).  ГАНЦ газар: томьёо, суурь ханшийн шат, SQL хэлтэрхий,
 * нөхөн тооцоолол бүгд энд.
 *
 * ── ХОЁР «ЗАСВАРЫН ТӨСӨЛ», НЭГ ДҮРЭМ ─────────────────────────────────
 *   • `repair_projects` (дотоод ажил, Approvals → Засвар) — өмнө нь явцын
 *     хувь ОГТ байгаагүй;
 *   • `projects.progress_mode = 'hours'` — шинээр үүсгэсэн ZA (Засвар)
 *     төсөл.  Ажилтан таск дээр гараар % БИЧИХГҮЙ (`POST /api/progress`
 *     403); зөвхөн «Засвар бүртгэх» цонхоор ЦАГ бүртгэнэ.  Одоо байгаа ZA
 *     төслүүд `'tasks'` хэвээр (эзний шийдвэр — тэдний жинлэсэн явц
 *     хөндөгдөхгүй), админ ProjectEditDialog-оос сольж болно.
 *
 * ⚠️ 2026-09-29-нөөс ЯВЦ = АЖИЛЧДАД ОЛГОСОН ХУВИЙН НИЙЛБЭР, 100-д ТАСЛАХГҮЙ
 *    (доорх «АЖИЛТАНД НЭМЭГДСЭН ХУВИАР» хэсэг).  Энэ хэсгийн progress_pct-ийн
 *    томьёо нь 0339–0348-ын ТҮҮХ: баганууд бичигдсээр, гэвч явцыг бодохгүй.
 *
 *     (хуучин) явц = MIN(100, Σ progress_pct)
 *     progress_pct = progress_rate × (цаг / 8)
 *     progress_rate = ажилтны ӨДРИЙН ДУНДАЖ ТӨСЛИЙН-% шаталсан: self30 →
 *                     self90 → team30 → company30, эхний тэг биш утга
 *                     (routes/repair.ts-ийн оноо-ны шаттай ИЖИЛ цонх, зөвхөн
 *                     ХЭМЖИГДЭХҮҮН өөр — `measureSql`).
 *     Шат бүр = хүний сүүлийн K АЖИЛЛАСАН өдрийн дундаж (`lib/dailyAverage.ts`,
 *     2026-09-28): шинэ хүн ажилласан өдрөөрөө хуваагдана, батлагдсан чөлөө
 *     (ээлжийн амралт) ханшийг өсгөхгүй, бууруулахгүй — амралтаас өмнөх
 *     ажилласан өдрүүдээр үргэлжилнэ.
 *
 * ── 30 ХОНОГ, ХҮНИЙ БҮХ АЖИЛ (эзний шийдвэр 2026-09-25, миграц 0348) ──
 *   • Эхний шат `self7` → `self30`: «тухайн хүний 30 хоногийн дундаж».
 *     Хуучин мөрүүдийн `rate_source = 'self7'` түүх хэвээр.
 *   • Шатанд хүний БҮХ ажил орно: хувиар бөглөсөн (source='progress'), засварын
 *     цаг ('repair'), батлагдсан төслийн бус ажил ('non_project').  Урьд нь
 *     зөвхөн 'progress' тоологддог байв — бүх ZA төсөл цагаар бодогдох болсноор
 *     зөвхөн засвар хийдэг хүн (FURNITURE LAND дээр 15 хүн) хувиар бөглөх
 *     ажилгүй болж, түүний ханш 30 хоногийн дараа баг/компанийн дундаж руу
 *     «унах» байв.  Өөрийгөө тэжээх нь ТОГТВОРТОЙ: өдөр ≤ 8 цаг тул засварын
 *     өдрийн оноо ≤ ханш — дундаж өсөхгүй, зөвхөн хадгалагдана.
 *   • ЯВЦЫН хэмжигдэхүүнд засварын мөрийн хувь нэмэр нь `repair_entries.
 *     progress_pct` (цагаас бодсон төслийн-%) — `user_points.delta_pct` БИШ:
 *     засварын мөрийн delta_pct нь оноотой тэнцүү (repair.ts), төслийн-% биш.
 *     Төслийн бус ажил төслийн явц өгдөггүй тул явцын шатанд орохгүй.
 *
 * ⚠️ ОНОО ХЭВЭЭР.  `computed_pct` / `user_points.amount` нь `amount` (оноо)
 *    хэмжигдэхүүнтэй шатнаас гардаг бөгөөд энэ файл түүнийг ХӨНДӨХГҮЙ —
 *    самбар, тайлангийн оноо өөрчлөгдөхгүй.  Нэг бүртгэл ХОЁР snapshot
 *    тээнэ: `computed_pct` (оноо, дэвтэр) ба `progress_pct` (төслийн явц).
 *    Хоёулаа бүртгэх үед хөлддөг — цонх гүйсэн ч түүхэн утга хөдлөхгүй.
 *
 * ⚠️ Хэмжсэн (прод 2026-09-21): ажилчдын 30 хоногийн өдрийн дундаж
 *    delta_pct 0.006–1.7 (медиан ~0.1).  Өдөрт 0.3% нэмдэг хүн 8 цаг
 *    бүртгэвэл төсөл +0.3% — засварын төсөл удаан «дүүрнэ».  Энэ бол эзний
 *    сонгосон томьёо; тоог ЭНД зохиомлоор өсгөхгүй.
 *
 * ── АЖИЛТАНД НЭМЭГДСЭН ХУВИАР, 100%-ААС ДАВНА (эзний шийдвэр 2026-09-29) ──
 *     явц = [суурь +] Σ user_points.amount (тэр төсөл / дотоод ажил дээр)
 *   Ажилтан засвар хийхэд түүний дундаж хувьд (самбар, профайл) хэдэн хувь
 *   нэмэгдсэн бол төсөлд ЯГ ТЭР хувь нэмэгдэнэ — нэг тоо хоёр газарт.  Орно:
 *   засварын цагийн оноо (`source='repair'`), төсөл цагаар шилжихээс өмнө
 *   таск дээр хувиар бөглөж авсан оноо (`'progress'`).  0348-ын нөхөлтийн
 *   мөр (`hours_source='backfill'`) оноогүй тул ДАВХАРДАХГҮЙ — тэр ажил аль
 *   хэдийн `'progress'` оноогоороо орсон.  Хэмжсэн шалтгаан (прод, Теннис
 *   ZA #42): delta_pct хэмжигдэхүүнээр Σ = 114% байсны 86.5%-ийг 2 хүн өгсөн —
 *   тэд 05-28-нд жижиг эскиз төслийг нэг өдөрт 100% бөглөсөн тул «өдрийн
 *   дундаж төслийн хувь» нь сарын турш ≈5%/өдөр (бусад ≈0.1) болж байв.
 *   Онооны дундаж ийм савалгаагүй (тэр 100% нь 4 оноо).
 *   ТААЗГҮЙ: нийлбэр 100-аас давж болно (эзэн: засварын ажил дуусдаггүй);
 *   баарны зурвас л frontend-д 100-д таслагдана, бичигдэх тоо — жинхэнэ.
 */

import { loadDailyAverages } from './dailyAverage';

export type ProgressMode = 'tasks' | 'hours';
export const PROGRESS_MODES: readonly ProgressMode[] = ['tasks', 'hours'] as const;
export function isProgressMode(v: unknown): v is ProgressMode {
  return v === 'tasks' || v === 'hours';
}

/** Шинэ төслийн өгөгдмөл горим: ZA → цагаар, бусад → жинлэсэн мод. */
export function defaultProgressMode(category: string | null | undefined): ProgressMode {
  return category === 'ZA' ? 'hours' : 'tasks';
}

/** Нэг ажлын өдрийн цаг — 8 цаг = өдрийн 100%. */
export const WORK_DAY_HOURS = 8;

/** Суурь ханш аль шатнаас гарсан бэ.  (`self7` нь 0348-аас өмнөх мөрүүдийн
 *  түүхэн утга — шинэ бичлэг хэзээ ч авахгүй.) */
export type RateSource = 'self30' | 'self90' | 'team30' | 'company30' | 'none';

export interface BaseRate {
  /** «Нэг АЖЛЫН ӨДӨР (8 цаг) хэдэн нэгжтэй тэнцэх вэ». */
  rate: number;
  source: RateSource;
}

/** Ханшийн шатны нэг мөр — `baseDailyRate` угсарна.  team/company = гишүүдийн
 *  өдрийн дундажийн нийлбэр ба тоо. */
export interface LadderRow {
  self30: number;
  self90: number;
  team_sum: number;
  team_n: number;
  company_sum: number;
  company_n: number;
}

export type RateMeasure = 'amount' | 'delta_pct';

/**
 * Шатанд орох `user_points` мөрүүд ба тэдгээрийн утга (`ref` = хүснэгтийн
 * нэр эсвэл alias).  Оноо: хүний бүх ажил.  Явц: хувиар бөглөсөн мөрийн
 * `delta_pct` + засварын мөрийн цагаас бодсон `progress_pct` — файлын
 * толгойн «30 ХОНОГ, ХҮНИЙ БҮХ АЖИЛ» хэсгийг үз.
 */
export function measureSql(measure: RateMeasure, ref: string): { expr: string; where: string } {
  if (measure === 'amount') {
    return {
      expr: `${ref}.amount`,
      where: `${ref}.source IN ('progress', 'repair', 'non_project')`,
    };
  }
  return {
    expr: `CASE WHEN ${ref}.source = 'repair'
                THEN COALESCE((SELECT re.progress_pct FROM repair_entries re WHERE re.id = ${ref}.repair_entry_id), 0)
                ELSE ${ref}.delta_pct END`,
    where: `${ref}.source IN ('progress', 'repair')`,
  };
}

/**
 * Шатнаас эхний тэг биш утгыг сонгоно (ЦЭВЭР).  Оноо-ны шат (repair.ts) ба
 * явцын шат хоёулаа яг энэ функцээр — «эхний тэг биш» дүрэм нэг газар.
 */
export function pickLadderRate(row: LadderRow | null | undefined): BaseRate {
  if (!row) return { rate: 0, source: 'none' };
  const teamAvg = row.team_n > 0 ? row.team_sum / row.team_n : 0;
  const companyAvg = row.company_n > 0 ? row.company_sum / row.company_n : 0;
  const ladder: Array<[number, RateSource]> = [
    [Number(row.self30), 'self30'],
    [Number(row.self90), 'self90'],
    [teamAvg, 'team30'],
    [companyAvg, 'company30'],
  ];
  for (const [value, source] of ladder) {
    if (Number.isFinite(value) && value > 0) return { rate: value, source };
  }
  return { rate: 0, source: 'none' };
}

/** Нэг бүртгэлийн хувь: ханш × (цаг / 8).  Сөрөг/буруу оролт → 0. */
export function pctForHours(rate: number, hours: number): number {
  if (!Number.isFinite(rate) || !Number.isFinite(hours) || rate <= 0 || hours <= 0) return 0;
  return rate * (hours / WORK_DAY_HOURS);
}

/** Төслийн явц: Σ олгосон хувь, 2 орон.  100-д ТАСЛАХГҮЙ (2026-09-29). */
export function sumProgress(pcts: Iterable<number>): number {
  let s = 0;
  for (const p of pcts) if (Number.isFinite(p) && p > 0) s += p;
  return Math.round(s * 100) / 100;
}

/* ------------------------------------------------------------------ */
/*  SQL                                                                */
/* ------------------------------------------------------------------ */

/**
 * Ажилтны ӨДРИЙН ДУНДАЖ ханш (шаталсан).  Шат бүр `lib/dailyAverage.ts`-ийн
 * ГАНЦ дүрмээр (эзний 2026-09-28): хүний сүүлийн K АЖИЛЛАСАН өдрийн дундаж —
 *   • шинэ хүн ажилд орсноосоо хойш ажилласан өдрөөрөө хуваагдана (3 хоногийн
 *     өмнө орсон хүн 3-т, 21.43-т биш — эс бөгөөс эхний засварын оноо нь
 *     дараагийн өдөр ханшийг ~20 дахин унагадаг байв);
 *   • батлагдсан чөлөө (ээлжийн амралт) ханшийг хөдөлгөхгүй — амралтаас
 *     өмнөх ажилласан өдрүүдээр үргэлжилнэ;
 *   • дуусаагүй өдөр оноо авсан бол л тоологдоно.
 * team30 / company30 = гишүүн бүрийн ӨӨРИЙН өдрийн дундажийн дундаж (ижил
 * дүрэм — шинэ гишүүн 21-д хуваагдаж багийн ханшийг доош татахгүй; хараахан
 * ажиллаагүй шинэ гишүүн тоологдохгүй).  Хүн ам `memberSql` (CEO хасагдана).
 *
 * `until` (UTC агшин) өгвөл тэр мөчийг хүртэлх түүхээр (нөхөн тооцоолол:
 * «тэр үед мэдэгдэж байсан» ханш, тэр өдөр дуусаагүй), эс бөгөөс одоо.
 */
export async function baseDailyRate(
  db: D1Database,
  userId: number,
  measure: RateMeasure,
  memberSql: string,
  until: string | null = null,
): Promise<BaseRate> {
  const { results } = await db
    .prepare(
      `SELECT u.id, u.team_id FROM users u
        WHERE u.status = 'active' AND u.is_support = 0 AND ${memberSql}`,
    )
    .all<{ id: number; team_id: number | null }>();
  const members = results ?? [];
  const myTeam =
    members.find((m) => m.id === userId)?.team_id ??
    (await db.prepare(`SELECT team_id FROM users WHERE id = ?`).bind(userId).first<{ team_id: number | null }>())
      ?.team_id ??
    null;
  // `measureSql` нь alias-тай; ачаалагч `FROM user_points` (alias-гүй).
  const m = measureSql(measure, 'user_points');
  const avg = await loadDailyAverages(db, {
    windows: [
      { days: 30, userIds: [userId, ...members.map((x) => x.id)] },
      { days: 90, userIds: [userId] },
    ],
    asOf: until,
    expr: m.expr,
    where: m.where,
  });
  const row: LadderRow = {
    self30: avg.get(userId, 0)?.avg ?? 0,
    self90: avg.get(userId, 1)?.avg ?? 0,
    team_sum: 0,
    team_n: 0,
    company_sum: 0,
    company_n: 0,
  };
  for (const x of members) {
    const a = avg.get(x.id, 0)?.avg;
    if (a == null) continue;
    row.company_sum += a;
    row.company_n += 1;
    if (myTeam != null && x.team_id === myTeam) {
      row.team_sum += a;
      row.team_n += 1;
    }
  }
  return pickLadderRate(row);
}

export type RepairTargetCol = 'project_id' | 'repair_project_id';

/**
 * «Цагаар бодсон явц» скаляр SQL: `[суурь +] Σ user_points.amount` — ажилчдад
 * тэр зорилт дээр олгосон хувийн нийлбэр, ТААЗГҮЙ (файлын толгойн «АЖИЛТАНД
 * НЭМЭГДСЭН ХУВИАР» хэсэг).  Жагсаалтын асуулгад төсөл/дотоод ажил бүрд нэг
 * индексийн уншилт (idx_user_points_project / idx_user_points_repair_project).
 *
 * Суурь (`projects.hours_progress_base`, миграц 0349) — FURNITURE LAND 0353-аар
 * хувь руу буцсанаас хойш бүх мөрөнд NULL; хуучин нийцлийн төлөө л үлдсэн.
 * Дотоод ажилд (`repair_projects`) суурь байхгүй.  `idRef` нь ХОЁР удаа гарна —
 * bind бол `?1` хэлбэрээр өг (`hoursProgressOf`).
 */
export function hoursProgressSql(fk: RepairTargetCol, idRef: string): string {
  const sum = `COALESCE((SELECT SUM(up.amount) FROM user_points up WHERE up.${fk} = ${idRef}), 0)`;
  const base =
    fk === 'project_id'
      ? `COALESCE((SELECT pb.hours_progress_base FROM projects pb WHERE pb.id = ${idRef}), 0) + `
      : '';
  return `(${base}${sum})`;
}

/**
 * Төслийн явцын илэрхийлэл: `'hours'` горимд цагаар, бусдад жинлэсэн
 * rollup (`rollupExpr`) — PROJECT_LIST_SQL, dashboard, company overview
 * бүгд ЭНЭ функцээр, тиймээс горимын дүрэм зөрөхгүй.  `pAlias` = projects
 * хүснэгтийн alias.
 */
export function projectProgressSql(pAlias: string, rollupExpr: string): string {
  return `CASE WHEN ${pAlias}.progress_mode = 'hours'
               THEN ${hoursProgressSql('project_id', `${pAlias}.id`)}
               ELSE ${rollupExpr} END`;
}

/** Нэг зорилтын цагаар бодсон явц (детайл хуудас). */
export async function hoursProgressOf(
  db: D1Database,
  fk: RepairTargetCol,
  id: number,
): Promise<number> {
  const row = await db
    .prepare(`SELECT ${hoursProgressSql(fk, '?1')} AS progress`)
    .bind(id)
    .first<{ progress: number }>();
  return Math.round(Number(row?.progress ?? 0) * 100) / 100;
}

/* ------------------------------------------------------------------ */
/*  Нөхөн тооцоолол                                                    */
/* ------------------------------------------------------------------ */

export interface BackfillResult {
  scanned: number;
  updated: number;
}

/**
 * `progress_rate_source IS NULL` (0339-оос өмнөх) бүртгэл бүрийн явцын
 * хувийг МӨРИЙН ӨӨРИЙН ОГНООГООР нөхөж бодно: `until` = created_at
 * (UTC, `datetime('now')` хэлбэр) эсвэл байхгүй бол огнооны сүүлч.  Ингэснээр
 * «тэр үед энэ хүний өдрийн дундаж хэд байсан» гэдэг л хөлдөнө — өнөөдрийн
 * цонхоор бодвол 2 сарын өмнөх бүртгэл өнөөдрийн ханш авна.
 *
 * Идемпотент: аль хэдийн source-той мөрийг ДАХИН БОДОХГҮЙ (`all = true`
 * бол бүгдийг).  Багийн гишүүнчлэл (users.team_id) нь өнөөдрийнх —
 * түүхэн багийн бүртгэл байхгүй, хүлээн зөвшөөрсөн ойролцоолол.
 */
export async function backfillProgressPct(
  db: D1Database,
  memberSql: string,
  opts: { all?: boolean; limit?: number } = {},
): Promise<BackfillResult> {
  const limit = Math.max(1, Math.min(opts.limit ?? 500, 2000));
  const where = opts.all ? '' : 'WHERE progress_rate_source IS NULL';
  const { results } = await db
    .prepare(
      `SELECT id, user_id, hours, date, created_at
         FROM repair_entries ${where}
        ORDER BY id ASC
        LIMIT ?`,
    )
    .bind(limit)
    .all<{ id: number; user_id: number; hours: number; date: string; created_at: string | null }>();
  const rows = results ?? [];
  let updated = 0;
  for (const r of rows) {
    const until = r.created_at && /^\d{4}-\d{2}-\d{2}/.test(r.created_at) ? r.created_at : `${r.date} 23:59:59`;
    const base = await baseDailyRate(db, r.user_id, 'delta_pct', memberSql, until);
    const pct = pctForHours(base.rate, Number(r.hours));
    const res = await db
      .prepare(
        `UPDATE repair_entries
            SET progress_rate = ?, progress_rate_source = ?, progress_pct = ?
          WHERE id = ?`,
      )
      .bind(base.rate, base.source, pct, r.id)
      .run();
    updated += res.meta.changes ?? 0;
  }
  return { scanned: rows.length, updated };
}
