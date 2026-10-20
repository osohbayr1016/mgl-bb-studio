/**
 * Төслийн бус ажил (0342) — D1 уншилт ба хариуны хэлбэр.  Дүрэм нь
 * `lib/nonProjectWork.ts`-д (цэвэр, тесттэй); энэ файл нь SQL-ийг НЭГ газарт
 * байлгаж `routes/nonProjectWork.ts` ба `routes/attendance.ts` хоёрыг зөрүүлэхгүй.
 */
import { getAttendanceSettings, type AttendanceSettings } from './settings';
import { loadCountingWindow, loadShiftForUser } from './scheduleStore';
import { isShiftBounded } from './shiftBoundedHours';
import { hhmmOfMinutes, ubMinutesOf } from './workSchedule';
import {
  NON_PROJECT_CATEGORIES,
  categoryLabelOf,
  entryStage,
  halfOfCheckpoint,
  hhmm,
  lunchWindowOf,
  nonProjectCreditMinutes,
  parseHhmm,
  planPicks,
  type CheckpointType,
  type DayHalf,
  type NonProjectPick,
  type NonProjectStatus,
} from './nonProjectWork';

export type NonProjectRow = {
  id: number;
  user_id: number;
  date: string;
  category: string;
  note: string | null;
  /** Цаггүй бүртгэлд (0356, ирцэд сонгосон) хоёулаа null — ажилтан «Миний
   *  ажлууд»-аас оруулах хүртэл. */
  start_time: string | null;
  end_time: string | null;
  /** Цагтай мөрөнд цагаас (цай хассан); цаггүй мөрөнд ҮРГЭЛЖ 0. */
  minutes: number;
  report: string | null;
  reported_at: string | null;
  status: NonProjectStatus;
  reviewed_by: number | null;
  reviewed_at: string | null;
  review_note: string | null;
  created_at: string;
  updated_at: string;
  /** Батлах үед бүтээмжид олгосон хувь (0344) — хүлээгдэж буй / татгалзсан мөрөнд null. */
  computed_pct: number | null;
};

const COLS = `id, user_id, date, category, note, start_time, end_time, minutes, report,
  reported_at, status, reviewed_by, reviewed_at, review_note, created_at, updated_at, computed_pct`;

/** Ирцийн сонголтын мэдээлэл (0357) — зөвхөн харуулахад. */
export type EntryPicks = {
  /** Ирцэд аль хагаст сонгогдсон (өглөө/үдээс хойш). */
  halves: DayHalf[];
  /** Ирцэд АНХ сонгосон цаг 'HH:MM' (УБ) — «Миний ажлууд»-ын эхэлсэн цагийн
   *  урьдчилсан утга.  Сонгогдоогүй бол null. */
  pickedAt: string | null;
};

export const NO_PICKS: EntryPicks = { halves: [], pickedAt: null };

/**
 * API-ийн мөр.  `stage` нь хадгалдаггүй, `entryStage`-ээс гарна.
 * `halves` / `picked_at` — ирцийн сонголт (`EntryPicks`); `active` —
 * өнөөдрийн хамгийн сүүлийн ирцийн цэгт сонгогдсон (дараагийн цонхны
 * урьдчилсан сонголт).  Мэдэхгүй бол хоосон / null / false.
 */
export function shapeEntry(r: NonProjectRow, extra: Partial<EntryPicks> & { active?: boolean } = {}) {
  return {
    id: r.id,
    date: r.date,
    category: r.category,
    category_label: categoryLabelOf(r.category),
    note: r.note,
    start_time: r.start_time,
    end_time: r.end_time,
    minutes: r.minutes,
    timed: r.start_time != null,
    halves: extra.halves ?? [],
    picked_at: extra.pickedAt ?? null,
    active: extra.active ?? false,
    report: r.report,
    reported_at: r.reported_at,
    status: r.status,
    stage: entryStage(r),
    review_note: r.review_note,
    reviewed_at: r.reviewed_at,
    created_at: r.created_at,
    computed_pct: r.computed_pct,
  };
}

/** Маягтад хэрэгтэй тогтмол мэдээлэл: ангиллууд + цайны цонх + ээлжийн эхлэл/төгсгөл. */
export function nonProjectMeta(
  settings: AttendanceSettings,
  shiftEnd: string | null = null,
  shiftStart: string | null = null,
) {
  const lunch = lunchWindowOf(settings);
  return {
    categories: NON_PROJECT_CATEGORIES.map((c) => ({
      key: c.key,
      label: c.label,
      requires_note: c.requiresNote,
    })),
    lunch: lunch ? { start: hhmm(lunch.start), end: hhmm(lunch.end) } : null,
    /** 'HH:MM' — дууссан цаг үүнээс хойш байж болохгүй.  `null` = хаалтгүй. */
    shift_end: shiftEnd,
    /** 'HH:MM' — ирцэд ээлж эхлэхээс өмнө сонгосон ажлын эхэлсэн цагийн
     *  урьдчилсан утгыг үүгээр доод хязгаарлана (зөвхөн UI). */
    shift_start: shiftStart,
  };
}

/** Тухайн өдрийн бодит ээлжийн дуусах цаг (сонголт + зун + тогтмол ээлж). */
export async function loadShiftEnd(
  db: D1Database,
  userId: number,
  date: string,
): Promise<{ minutes: number; hhmm: string; startMinutes: number }> {
  const shift = await loadShiftForUser(db, userId, date);
  return {
    minutes: shift.endMinutes,
    hhmm: hhmmOfMinutes(shift.endMinutes),
    startMinutes: shift.startMinutes,
  };
}

export async function loadEntry(db: D1Database, id: number): Promise<NonProjectRow | null> {
  return (
    (await db
      .prepare(`SELECT ${COLS} FROM non_project_work_entries WHERE id = ?`)
      .bind(id)
      .first<NonProjectRow>()) ?? null
  );
}

export async function loadEntriesForDay(
  db: D1Database,
  userId: number,
  date: string,
): Promise<NonProjectRow[]> {
  const { results } = await db
    .prepare(
      `SELECT ${COLS} FROM non_project_work_entries
        WHERE user_id = ? AND date = ?
        ORDER BY start_time, id`,
    )
    .bind(userId, date)
    .all<NonProjectRow>();
  return results ?? [];
}

export async function loadRecentEntries(
  db: D1Database,
  userId: number,
  limit = 100,
): Promise<NonProjectRow[]> {
  const { results } = await db
    .prepare(
      `SELECT ${COLS} FROM non_project_work_entries
        WHERE user_id = ?
        ORDER BY date DESC, start_time DESC, id DESC
        LIMIT ?`,
    )
    .bind(userId, limit)
    .all<NonProjectRow>();
  return results ?? [];
}

/**
 * Өдрийн тоо — `total` > 0 бол ирцийн «дор хаяж нэг төсөл» шаардлага
 * хангагдана.  Татгалзсан мөр тооцогдохгүй.  («Юу хийсэн» тайлбарыг гарах
 * бүртгэл 2026-09-28-наас шаардахаа больсон — «Миний ажлууд»-аас оруулна.)
 */
export async function nonProjectDayCounts(
  db: D1Database,
  userId: number,
  date: string,
): Promise<{ total: number }> {
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS total
         FROM non_project_work_entries
        WHERE user_id = ? AND date = ? AND status <> 'rejected'`,
    )
    .bind(userId, date)
    .first<{ total: number }>();
  return { total: row?.total ?? 0 };
}

/**
 * Тухайн (ажилтан, өдөр)-ийн төслийн бус ажлын цагийг ирцийн `hours_worked`-д
 * ДАХИН тооцож бичнэ (миграц 0352).  Идемпотент: хэдэн ч удаа дуудсан ижил
 * үр дүн.  Дүрэм нь `nonProjectCreditMinutes`-д (цэвэр, тесттэй).
 *
 * Нэмэгдэх цаг бүхэлдээ өдрийн СҮҮЛД хаагдсан session дээр очно (бусад нь 0) —
 * өдрийн тайлан session-уудыг нэгтгэдэг тул хаана нь байх нь нийлбэрт
 * нөлөөлөхгүй, харин нэг л газар байх нь дахин хуваарилахыг энгийн болгоно.
 * Хаагдсан session байхгүй өдөр (нээлттэй / огт ирээгүй) юу ч нэмэхгүй —
 * хаагдаагүй өдөр тайланд тооцогдохгүй гэсэн одоогийн дүрэм хэвээр.
 *
 * `hours_worked`-ийг ДАХИН бодохгүй: `hours_worked − хуучин_кредит + шинэ`.
 * Тиймээс админы засвар, давхар бүртгэлийн 0 цаг хөндөгдөхгүй.  `hours_worked`-
 * ийг шинээр бичдэг газар (админы нөхөлт) `non_project_credit_hours = 0`-ийг
 * ХАМТ бичээд энэ функцийг дуудах ёстой.
 *
 * ЦАГГҮЙ бүртгэл (0356/0357, ирцэд сонгосон) ЮУ Ч нэмэхгүй — эзний дүрэм
 * (2026-09-28): ирцийн сонголт зөвхөн хяналт.  15:00-д гараад зохиогчийн
 * хяналтад явсан хүн ажлаа дуусгаад «Миний ажлууд»-аас 15:00–17:00 гэж
 * оруулахад л (PATCH → `afterNonProjectChange`) тэр хугацаа энд нэмэгдэнэ.
 *
 * Дуудагдах газар: гарах бүртгэл, дахин орох (clock-in), төслийн бус ажлыг
 * нэмэх/засах/устгах/шалгах, ирцийн цэгийн сонголт, админы ирц засвар.
 */
export async function syncNonProjectCredit(
  db: D1Database,
  userId: number,
  date: string,
  settings?: AttendanceSettings,
): Promise<{ creditHours: number; sessionId: number | null }> {
  const [cfg, sessionsRes, entriesRes] = await Promise.all([
    settings ? Promise.resolve(settings) : getAttendanceSettings(db),
    db
      .prepare(
        `SELECT id, date, clock_in, clock_out, hours_worked, non_project_credit_hours
           FROM attendance_sessions
          WHERE user_id = ? AND date = ?`,
      )
      .bind(userId, date)
      .all<{
        id: number;
        date: string;
        clock_in: string;
        clock_out: string | null;
        hours_worked: number | null;
        non_project_credit_hours: number | null;
      }>(),
    db
      .prepare(
        `SELECT start_time, end_time FROM non_project_work_entries
          WHERE user_id = ? AND date = ? AND status <> 'rejected'`,
      )
      .bind(userId, date)
      .all<{ start_time: string | null; end_time: string | null }>(),
  ]);
  const sessions = sessionsRes.results ?? [];
  if (sessions.length === 0) return { creditHours: 0, sessionId: null };

  // Session-ийн интервал өдрийн минутаар; өөр өдөр (шөнө дамнасан) тарсан бол
  // өдрийн төгсгөл хүртэл.
  const spans = sessions.map((s) => ({
    start: s.clock_in.slice(0, 10) < date ? 0 : ubMinutesOf(s.clock_in),
    end: s.clock_out == null ? null : s.clock_out.slice(0, 10) > date ? 1440 : ubMinutesOf(s.clock_out),
  }));
  const entries = (entriesRes.results ?? []).flatMap((e) => {
    const start = parseHhmm(e.start_time);
    const end = parseHhmm(e.end_time);
    return start === null || end === null ? [] : [{ start, end }];
  });
  const lunch = lunchWindowOf(cfg);
  // 2026-10-01-ээс ирцийн цагтай ижил: зөвхөн ээлжийн цонх доторх ажил
  // (`lib/shiftBoundedHours.ts`).  Түүнээс өмнөх өдөр хуучин дүрмээрээ.
  const window =
    entries.length > 0 && isShiftBounded(date) ? await loadCountingWindow(db, userId, date) : null;
  const minutes = nonProjectCreditMinutes(
    spans,
    entries,
    lunch,
    window ? { start: window.startMinutes, end: window.endMinutes } : null,
  );
  const creditHours = Math.round((minutes / 60) * 100) / 100;

  // Хүлээн авагч = хамгийн сүүлд хаагдсан session.  Давхар бүртгэлийн ихэр
  // (ижил clock_out, 0 цаг) сонгогдохгүйн тулд үндсэн цагаар нь тэнцүүлнэ.
  const baseOf = (s: (typeof sessions)[number]) =>
    (s.hours_worked ?? 0) - (s.non_project_credit_hours ?? 0);
  const closed = sessions
    .filter((s) => s.clock_out != null)
    .sort(
      (a, b) =>
        b.clock_out!.localeCompare(a.clock_out!) || baseOf(b) - baseOf(a) || b.id - a.id,
    );
  const target = closed[0] ?? null;

  const stmts: D1PreparedStatement[] = [];
  for (const s of sessions) {
    const want = target && s.id === target.id ? creditHours : 0;
    const have = s.non_project_credit_hours ?? 0;
    if (Math.abs(want - have) < 0.005) continue;
    stmts.push(
      s.clock_out == null
        ? db
            .prepare(`UPDATE attendance_sessions SET non_project_credit_hours = 0 WHERE id = ?`)
            .bind(s.id)
        : db
            .prepare(
              `UPDATE attendance_sessions
                  SET hours_worked = ROUND(COALESCE(hours_worked, 0) - non_project_credit_hours + ?, 2),
                      non_project_credit_hours = ?
                WHERE id = ?`,
            )
            .bind(want, want, s.id),
    );
  }
  if (stmts.length > 0) await db.batch(stmts);
  return { creditHours: target ? creditHours : 0, sessionId: target?.id ?? null };
}

/** Алдаа нь үндсэн хүсэлтийг унагахгүй хувилбар — ирц/ажлын бичилт аль хэдийн
 *  амжилттай болсон үед дуудна. */
export async function syncNonProjectCreditSafe(
  db: D1Database,
  userId: number,
  date: string,
  settings?: AttendanceSettings,
): Promise<{ creditHours: number; sessionId: number | null }> {
  try {
    return await syncNonProjectCredit(db, userId, date, settings);
  } catch (err) {
    console.error('[non-project-credit] sync failed', userId, date, err);
    return { creditHours: 0, sessionId: null };
  }
}

/* ------------------------------------------------------------------ */
/*  Ирцийн сонголт (0357) — зөвхөн хяналт, цаг бодохгүй                */
/* ------------------------------------------------------------------ */

type SelectionRow = { id: number; checkpoint_type: CheckpointType; entry_id: number | null };

/**
 * Өдрийн ирцийн цэгүүд ба тэнд сонгосон төслийн бус бүртгэлүүд, `recorded_at`-
 * аар эрэмбэлсэн — сүүлийнх нь «одоо сонгогдсон».  0357 хэрэгжээгүй (worker
 * миграцаас түрүүлсэн) бол хоосон — үндсэн хүсэлтийг унагахгүй.
 */
export async function loadDaySelections(
  db: D1Database,
  userId: number,
  date: string,
): Promise<Array<{ id: number; checkpoint: CheckpointType; entryIds: number[] }>> {
  let rows: SelectionRow[];
  try {
    const res = await db
      .prepare(
        `SELECT c.id, c.checkpoint_type, a.entry_id
           FROM attendance_project_checkpoints c
           LEFT JOIN attendance_checkpoint_non_project a ON a.checkpoint_id = c.id
          WHERE c.user_id = ? AND c.date = ?
          ORDER BY c.recorded_at, c.id`,
      )
      .bind(userId, date)
      .all<SelectionRow>();
    rows = res.results ?? [];
  } catch (err) {
    console.error('[non-project] checkpoint selections unavailable', err);
    return [];
  }
  const out: Array<{ id: number; checkpoint: CheckpointType; entryIds: number[] }> = [];
  for (const r of rows) {
    let cp = out.find((c) => c.id === r.id);
    if (!cp) out.push((cp = { id: r.id, checkpoint: r.checkpoint_type, entryIds: [] }));
    if (r.entry_id != null) cp.entryIds.push(r.entry_id);
  }
  return out;
}

/** Бүртгэл бүрийн ирцийн сонголт (харуулахад) — олон өдрийн мөрд нэг асуулгаар. */
export async function loadEntryPicks(
  db: D1Database,
  entryIds: readonly number[],
): Promise<Map<number, EntryPicks>> {
  const out = new Map<number, EntryPicks>();
  if (entryIds.length === 0) return out;
  try {
    const { results } = await db
      .prepare(
        `SELECT a.entry_id, c.checkpoint_type, MIN(c.recorded_at) AS first_at
           FROM attendance_checkpoint_non_project a
           JOIN attendance_project_checkpoints c ON c.id = a.checkpoint_id
          WHERE a.entry_id IN (SELECT value FROM json_each(?))
          GROUP BY a.entry_id, c.checkpoint_type`,
      )
      .bind(JSON.stringify(entryIds))
      .all<{ entry_id: number; checkpoint_type: CheckpointType; first_at: string | null }>();
    // `recorded_at` нь `nowInUBIso()` (+08:00) — мөрөөр харьцуулахад эрэмбэ зөв.
    const firstAt = new Map<number, string>();
    for (const r of results ?? []) {
      const cur = out.get(r.entry_id) ?? { halves: [], pickedAt: null };
      const half = halfOfCheckpoint(r.checkpoint_type);
      if (!cur.halves.includes(half)) cur.halves.push(half);
      const prev = firstAt.get(r.entry_id);
      if (r.first_at && (prev == null || r.first_at < prev)) firstAt.set(r.entry_id, r.first_at);
      out.set(r.entry_id, cur);
    }
    for (const [id, at] of firstAt) out.get(id)!.pickedAt = hhmm(ubMinutesOf(at));
  } catch (err) {
    console.error('[non-project] entry picks unavailable', err);
  }
  for (const p of out.values()) p.halves.sort();
  return out;
}

/** Олон мөрийг ирцийн сонголттой нь хэлбэржүүлнэ (`/my`, шалгах таб). */
export async function withPicks<T extends NonProjectRow, R>(
  db: D1Database,
  rows: readonly T[],
  shape: (row: T, picks: EntryPicks) => R,
): Promise<R[]> {
  const picks = await loadEntryPicks(
    db,
    rows.map((r) => r.id),
  );
  return rows.map((r) => shape(r, picks.get(r.id) ?? NO_PICKS));
}

/**
 * Өнөөдрийн бүртгэлүүд ирцийн цонхонд: сонголт + `active` (сүүлийн цэгт
 * сонгогдсон — дараагийн цэгийн урьдчилсан сонголт).
 */
export async function loadTodayForAttendance(db: D1Database, userId: number, date: string) {
  const [rows, selections] = await Promise.all([
    loadEntriesForDay(db, userId, date),
    loadDaySelections(db, userId, date),
  ]);
  const last = selections[selections.length - 1];
  const active = new Set(last?.entryIds ?? []);
  return withPicks(db, rows, (r, picks) => shapeEntry(r, { ...picks, active: active.has(r.id) }));
}

/**
 * Нэг ирцийн цэгийн төслийн бус сонголтыг хадгална: сонголт бүрийг өнөөдрийн
 * бүртгэлтэй тулгана (`planPicks`), байхгүйг нь ЦАГГҮЙ (0 минут) мөр болгож
 * үүсгэнэ, сонголтоор ирсэн «юу хийсэн» тайлбарыг (хуучин клиент) бичнэ, тэгээд
 * тэр цэгийн сонголтыг бүхэлд нь солино.  Цаг, хувь ЭНД ч, дараа нь ч бодогдохгүй
 * — зөвхөн хяналт; дуудагч `afterNonProjectChange`-ийг дуудна.
 */
export async function applyNonProjectPicks(
  db: D1Database,
  args: {
    userId: number;
    date: string;
    checkpointId: number;
    picks: readonly NonProjectPick[];
    now: string;
  },
): Promise<void> {
  const entries = await loadEntriesForDay(db, args.userId, args.date);
  const plan = planPicks(entries, args.picks);
  const ids: number[] = [];
  for (const { pick, entry } of plan) {
    if (entry) {
      ids.push(entry.id);
      if (pick.report && pick.report !== entry.report) {
        await db
          .prepare(
            `UPDATE non_project_work_entries
                SET report = ?, reported_at = ?, updated_at = datetime('now')
              WHERE id = ? AND status = 'pending'`,
          )
          .bind(pick.report, args.now, entry.id)
          .run();
      }
      continue;
    }
    const res = await db
      .prepare(
        `INSERT INTO non_project_work_entries
           (user_id, date, category, note, start_time, end_time, minutes, report, reported_at)
         VALUES (?, ?, ?, ?, NULL, NULL, 0, ?, ?)`,
      )
      .bind(args.userId, args.date, pick.category, pick.note, pick.report, pick.report ? args.now : null)
      .run();
    ids.push(Number(res.meta.last_row_id));
  }
  await db.batch([
    db
      .prepare(`DELETE FROM attendance_checkpoint_non_project WHERE checkpoint_id = ?`)
      .bind(args.checkpointId),
    ...ids.map((id) =>
      db
        .prepare(
          `INSERT OR IGNORE INTO attendance_checkpoint_non_project (checkpoint_id, entry_id) VALUES (?, ?)`,
        )
        .bind(args.checkpointId, id),
    ),
  ]);
}
