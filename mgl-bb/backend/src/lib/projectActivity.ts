/**
 * Төслийн «идэвх» — Төслүүд хуудасны ӨГӨГДМӨЛ эрэмбэ (2026-09-18).
 *
 * Эзний хүсэлт: «хамгийн их оролцоотой, хамгийн олон хүн өөр дээрээ авсан,
 * хамгийн идэвхтэй, олон ажилтан ирцээ бүртгүүлдэг төслүүд хамгийн дээр,
 * дээрээсээ доошоо идэвхээрээ». Дөрвөн дохиог НЭГ тоонд нэгтгэнэ:
 *
 *   • assignee_count          — таск дээр өөрийгөө / оноогдсон ялгаатай хүн
 *                               (бүх хугацаанд — «оролцоо»)
 *   • attendance_users_30d    — сүүлийн 30 хоногт ирц дээр энэ төслийг
 *                               сонгосон ялгаатай хүн
 *   • attendance_user_days_30d— мөн хугацаанд хүн×өдөр (`daily_active_projects`)
 *   • progress_users_30d /
 *     progress_entries_30d    — сүүлийн 30 хоногт явц бичсэн хүн / бичлэг
 *
 * Жин нь зориуд ЭНГИЙН (бүхэл тоо, нэг газар): ХҮН нь бичлэгээс үнэтэй, учир
 * нь нэг хүн өдөрт олон бичлэг хийж «идэвхтэй» болгож чадах ёсгүй.
 * Хэмжигдэхүүн бүр хариултад тусдаа буцдаг тул UI яагаад энэ дараалал вэ
 * гэдгийг chip дээр харуулж чадна.
 *
 * ⚠️ `PROJECT_LIST_SQL`-д НЭМЭЭГҮЙ: тэр template нь дөрвөн дуудагчаас
 * байрлалаар bind хийгддэг (асуултын тэмдэг нэмэх боломжгүй), мөн MCP /
 * клиентийн тайланд энэ тоо хэрэггүй.  `GET /api/projects` тусдаа асуулгаар
 * тооцоод JS дээр нийлүүлнэ.
 */

/** Идэвхийн цонх (хоног).  30 = «энэ сард хэн юу хийж байна». */
export const ACTIVITY_WINDOW_DAYS = 30;

export interface ProjectActivityRow {
  project_id: number;
  assignee_count: number;
  attendance_users_30d: number;
  attendance_user_days_30d: number;
  progress_users_30d: number;
  progress_entries_30d: number;
  /** Сүүлийн явцын бичлэгийн `created_at` (UTC ISO) эсвэл null. */
  last_progress_at: string | null;
  /** Сүүлийн ирцийн огноо (UB 'YYYY-MM-DD') эсвэл null. */
  last_attendance_date: string | null;
}

export interface ProjectActivity extends ProjectActivityRow {
  /** Нэгтгэсэн оноо — их = идэвхтэй.  Зөвхөн эрэмбэлэхэд. */
  score: number;
  /** Хамгийн сүүлийн үйл ажиллагаа (явц эсвэл ирц) — ижил оноотой үед tiebreak. */
  last_activity_at: string | null;
}

/** Жин — ГАНЦ газар.  Өөрчилбөл доорх тестийг ч хамт.
 *
 * `assignee` нь ЗОРИУД бага (1): прод хуулбар дээр хэмжсэн (2026-09-18) —
 * 37 хариуцагчтай ч сард нэг ч ирц/явцгүй төсөл (EVERGREEN-AZ) 3-ын жингээр
 * 29 хүн ирцээ бүртгүүлж 317 явц бичсэн төслүүдийн ЗАВСАРТ орж байв.  Хүн
 * тоологдсон хэвээр, гэхдээ зогссон төсөл идэвхтэйг давахгүй. */
export const ACTIVITY_WEIGHTS = {
  assignee: 1,
  attendanceUser: 2,
  attendanceUserDay: 0.25,
  progressUser: 2,
  progressEntry: 0.5,
} as const;

export function scoreProjectActivity(r: ProjectActivityRow): number {
  const w = ACTIVITY_WEIGHTS;
  const s =
    r.assignee_count * w.assignee +
    r.attendance_users_30d * w.attendanceUser +
    r.attendance_user_days_30d * w.attendanceUserDay +
    r.progress_users_30d * w.progressUser +
    r.progress_entries_30d * w.progressEntry;
  return Math.round(s * 100) / 100;
}

/**
 * Явцын `created_at` (UTC, `datetime('now')` → 'YYYY-MM-DD HH:MM:SS') ба ирцийн
 * огноо ('YYYY-MM-DD') хоёрын ХОЖУУГ нь буцаана.  Хоёулаа ISO хэлбэрийн
 * лексик эрэмбэтэй тул стринг харьцуулалт хангалттай; ирцийн огноог өдрийн
 * эхлэл гэж үзнэ (тэр өдөр явц бичсэн бол явц нь хожуу).
 */
export function latestActivityAt(
  lastProgressAt: string | null,
  lastAttendanceDate: string | null,
): string | null {
  if (!lastProgressAt) return lastAttendanceDate;
  if (!lastAttendanceDate) return lastProgressAt;
  return lastProgressAt >= lastAttendanceDate ? lastProgressAt : lastAttendanceDate;
}

export function buildProjectActivity(r: ProjectActivityRow): ProjectActivity {
  return {
    ...r,
    score: scoreProjectActivity(r),
    last_activity_at: latestActivityAt(r.last_progress_at, r.last_attendance_date),
  };
}

/** Мөргүй төсөл (ямар ч оролцоогүй) — 0 оноо. */
export function emptyProjectActivity(projectId: number): ProjectActivity {
  return buildProjectActivity({
    project_id: projectId,
    assignee_count: 0,
    attendance_users_30d: 0,
    attendance_user_days_30d: 0,
    progress_users_30d: 0,
    progress_entries_30d: 0,
    last_progress_at: null,
    last_attendance_date: null,
  });
}

/** `since` = өнөөдрөөс `ACTIVITY_WINDOW_DAYS` хоногийн өмнөх UB огноо. */
export function activityWindowStart(todayUB: string, days = ACTIVITY_WINDOW_DAYS): string {
  const d = new Date(`${todayUB}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

/**
 * Төсөл бүрийн идэвхийн мөр.  Bind: (since, since) — явцын `date` ба ирцийн
 * `date` хоёулаа UB 'YYYY-MM-DD' тул нэг утга.  Явц — зөвхөн `approved`
 * (rollup-тай ижил; 0323-аас хойш бүх шинэ мөр approved).  `+pe.status` —
 * унар + нь SQLite-д тэр баганын индексийг ХААДАГ: EXPLAIN (workerd, 2026-09-18)
 * `idx_progress_status (status=?)`-ыг сонгож бараг бүх мөрийг уншиж байсан,
 * харин `idx_progress_date (date>?)` нь 30 хоногийн хэсгийг л уншина.
 * Оролцоогүй төсөл мөр буцаахгүй — дуудагч `emptyProjectActivity`-аар нөхнө.
 */
export const PROJECT_ACTIVITY_SQL = `
WITH proj_tasks AS (
  SELECT t.id AS task_id, b.project_id
  FROM tasks t
  INNER JOIN components c ON c.id = t.component_id
  INNER JOIN drawings d   ON d.id = c.drawing_id
  INNER JOIN blocks b     ON b.id = d.block_id
),
assignees AS (
  SELECT pt.project_id, COUNT(DISTINCT ta.user_id) AS assignee_count
  FROM task_assignees ta
  INNER JOIN proj_tasks pt ON pt.task_id = ta.task_id
  GROUP BY pt.project_id
),
prog AS (
  SELECT pt.project_id,
         COUNT(*)                    AS progress_entries_30d,
         COUNT(DISTINCT pe.user_id)  AS progress_users_30d,
         MAX(pe.created_at)          AS last_progress_at
  FROM progress_entries pe
  INNER JOIN proj_tasks pt ON pt.task_id = pe.task_id
  WHERE pe.date >= ? AND +pe.status = 'approved' AND COALESCE(pe.source, '') <> 'alloc_adj'
  GROUP BY pt.project_id
),
att AS (
  SELECT project_id,
         COUNT(*)                AS attendance_user_days_30d,
         COUNT(DISTINCT user_id) AS attendance_users_30d,
         MAX(date)               AS last_attendance_date
  FROM daily_active_projects
  WHERE date >= ?
  GROUP BY project_id
),
ids AS (
  SELECT project_id FROM assignees
  UNION SELECT project_id FROM prog
  UNION SELECT project_id FROM att
)
SELECT ids.project_id,
       COALESCE(a.assignee_count, 0)            AS assignee_count,
       COALESCE(att.attendance_users_30d, 0)     AS attendance_users_30d,
       COALESCE(att.attendance_user_days_30d, 0) AS attendance_user_days_30d,
       COALESCE(pr.progress_users_30d, 0)        AS progress_users_30d,
       COALESCE(pr.progress_entries_30d, 0)      AS progress_entries_30d,
       pr.last_progress_at,
       att.last_attendance_date
FROM ids
LEFT JOIN assignees a ON a.project_id = ids.project_id
LEFT JOIN prog pr     ON pr.project_id = ids.project_id
LEFT JOIN att         ON att.project_id = ids.project_id
`;
