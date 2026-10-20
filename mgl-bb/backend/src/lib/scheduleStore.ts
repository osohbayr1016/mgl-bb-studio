/**
 * `user_work_schedules` (миграци 0199) руу хандах ГАНЦ давхарга.
 *
 * ⚠️ Яагаад `lib/workSchedule.ts`-д биш вэ: тэр модуль нь ЦЭВЭР (D1-гүй,
 *    sync) бөгөөд `SHIFTS` getter, `effectiveSchedule` зэрэг нь тестээр
 *    орчингүй ажилладаг.  DB дуудлагыг тэнд оруулбал `effectiveSchedule`
 *    async болж, 6 дуудагчийг бүгдийг нь өөрчлөх шаардлага үүснэ.  Оронд нь
 *    дуудагч нь мөрүүдээ ЭНДЭЭС авч, цэвэр функцэд өгнө.
 */
import type { ScheduleAssignment, ScheduleKey, Shift } from './workSchedule';
import { shiftForUser } from './specialShift';
import { countingWindow } from './shiftBoundedHours';

interface Row {
  user_id: number;
  schedule: string;
  effective_from: string;
  /** Мөрийг бичсэн хүн — ажилтан өөрөө юу, админ уу гэдгийг ялгана. */
  created_by: number | null;
}

function toAssignment(r: Row): ScheduleAssignment {
  return {
    schedule: r.schedule as ScheduleKey,
    effective_from: r.effective_from,
    created_by: r.created_by,
  };
}

/** Нэг ажилтны бүх хуваарилалт, огноогоор өсөхөөр. */
export async function getScheduleAssignments(
  db: D1Database,
  userId: number,
): Promise<ScheduleAssignment[]> {
  const { results } = await db
    .prepare(
      `SELECT user_id, schedule, effective_from, created_by
         FROM user_work_schedules
        WHERE user_id = ?
        ORDER BY effective_from`,
    )
    .bind(userId)
    .all<Row>();
  return (results ?? []).map(toAssignment);
}

/**
 * Нэг хүний ТУХАЙН ӨДРИЙН бодит ээлж (сонголтын түүх + зун + тогтмол ээлж) —
 * `shiftForUser`-ийн DB-тэй хувилбар.  Ирцийн цаг (`lib/shiftBoundedHours.ts`)
 * ба төслийн бус ажлын цонх үүнийг уншина.
 */
export async function loadShiftForUser(
  db: D1Database,
  userId: number,
  date: string,
): Promise<Shift> {
  return (await loadShiftAndRole(db, userId, date)).shift;
}

/**
 * Ирцийн ажилласан цагийг ТООЛОХ цонх (`lib/shiftBoundedHours.ts`
 * `countingWindow`): тухайн өдрийн ээлж, `worker` бол бүтэн өдөр.
 */
export async function loadCountingWindow(
  db: D1Database,
  userId: number,
  date: string,
): Promise<Pick<Shift, 'startMinutes' | 'endMinutes'>> {
  const { shift, role } = await loadShiftAndRole(db, userId, date);
  return countingWindow(shift, role);
}

async function loadShiftAndRole(
  db: D1Database,
  userId: number,
  date: string,
): Promise<{ shift: Shift; role: string | null }> {
  const [row, assignments] = await Promise.all([
    db
      .prepare(`SELECT work_schedule, role FROM users WHERE id = ?`)
      .bind(userId)
      .first<{ work_schedule: ScheduleKey | null; role: string | null }>(),
    getScheduleAssignments(db, userId),
  ]);
  return {
    shift: shiftForUser(userId, row?.work_schedule, date, assignments),
    role: row?.role ?? null,
  };
}

/**
 * Roster-ийн бүх ажилтны хуваарилалт НЭГ дуудлагаар.
 *
 * ⚠️ Тайлангийн builder нь ажилтан × өдөр бүрээр ээлж тооцдог тул хүн бүрд
 *    тусад нь query явуулбал 70 хүнд 70 round-trip болно.  Тиймээс Map.
 *    Хоосон жагсаалт өгвөл огт query явуулахгүй (SQL `IN ()` нь алдаа).
 */
export async function getScheduleAssignmentsFor(
  db: D1Database,
  userIds: readonly number[],
): Promise<Map<number, ScheduleAssignment[]>> {
  const map = new Map<number, ScheduleAssignment[]>();
  if (userIds.length === 0) return map;
  const placeholders = userIds.map(() => '?').join(',');
  const { results } = await db
    .prepare(
      `SELECT user_id, schedule, effective_from, created_by
         FROM user_work_schedules
        WHERE user_id IN (${placeholders})
        ORDER BY user_id, effective_from`,
    )
    .bind(...userIds)
    .all<Row>();
  for (const r of results ?? []) {
    const list = map.get(r.user_id);
    if (list) list.push(toAssignment(r));
    else map.set(r.user_id, [toAssignment(r)]);
  }
  return map;
}

/**
 * Сонголтыг хадгална.  `effective_from` нь ХЭЗЭЭ Ч өнөөдөр биш —
 * `scheduleEffectiveFrom()` маргаашийг (зуны үед 9-р сарын 1-ийг) буцаана.
 *
 * Нэг өдөрт нэг мөр (`UNIQUE(user_id, effective_from)`) тул хэрэглэгч
 * 9-р сарын 1 хүртэл бодлоо өөрчилвөл ижил мөр дарж бичигдэнэ — түүх нь
 * «өдөр бүрийн эцсийн шийдвэр» болж цэвэр үлдэнэ.
 */
export async function setScheduleAssignment(
  db: D1Database,
  params: {
    userId: number;
    schedule: ScheduleKey;
    effectiveFrom: string;
    createdBy: number | null;
  },
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO user_work_schedules (user_id, schedule, effective_from, created_by)
       VALUES (?, ?, ?, ?)
       ON CONFLICT (user_id, effective_from) DO UPDATE SET
         schedule   = excluded.schedule,
         created_by = excluded.created_by,
         created_at = datetime('now')`,
    )
    .bind(params.userId, params.schedule, params.effectiveFrom, params.createdBy)
    .run();
}
