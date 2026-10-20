/**
 * Сарын ирцийн өгөгдлийн хурууны хээ (migration 0403, 2026-10-15).
 *
 * Ажилтан сарын ирцээ батлах/зөрчилтэй гэж хариулах агшинд хадгалж, дараа нь дахин тооцож харьцуулна — зөрвөл
 * хариултын ДАРАА тэр сарын ирцэд нөлөөлөх өгөгдөл өөрчлөгдсөн (админы засвар, чөлөө батлах/устгах, ирсэн цагаар
 * чөлөө богиносгох, гадуур ажил, нийтийн баяр).  Эх сурвалж нь `buildDailyAttendanceRows` (`routes/attendance.ts`)-ийн
 * уншдаг ЯГ тэр хүснэгтүүд — тэнд шинэ эх сурвалж нэмбэл ЭНД ч нэм, эс бөгөөс тэр өөрчлөлт «хуучирсан» гэж барихгүй.
 *
 * Тооцоолсон цаг БИШ түүхий мөрийг хэшлэнэ: тохиргоо (цайны цаг, ээлж) солигдсоноор хуучин сарууд бүгд «хуучирсан»
 * болохгүй, харин мөр бүрийн засвар баригдана.  Хүснэгт тус бүрт НЭГ асуулга (олон хэрэглэгч нэг дор).
 */

export const FINGERPRINT_VERSION = 'v1';

/** 'YYYY-MM' → тухайн сарын эхний / сүүлийн өдөр. */
export function monthRange(month: string): { from: string; to: string } {
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, '0')}` };
}

async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** D1-ийн нэг statement-ийн bind хязгаар 100 — хэрэглэгчийн id-г багцалж уншина. */
const CHUNK = 80;

type Row = Record<string, unknown> & { user_id: number };

async function rowsFor(db: D1Database, sql: (ph: string) => string, binds: unknown[], userIds: number[]): Promise<Row[]> {
  const out: Row[] = [];
  for (let i = 0; i < userIds.length; i += CHUNK) {
    const ids = userIds.slice(i, i + CHUNK);
    const { results } = await db
      .prepare(sql(ids.map(() => '?').join(',')))
      .bind(...binds, ...ids)
      .all<Row>();
    out.push(...(results ?? []));
  }
  return out;
}

/** Цэвэр: нэг хэрэглэгчийн мөрүүдээс хээ (тестэд шууд). */
export async function fingerprintOf(parts: {
  sessions: unknown[];
  leaves: unknown[];
  cuts: unknown[];
  ooo: unknown[];
  holidays: string[];
}): Promise<string> {
  return `${FINGERPRINT_VERSION}:${await sha256Hex(JSON.stringify(parts))}`;
}

/** Хэрэглэгч бүрийн тухайн сарын хээ.  Өгөгдөлгүй хэрэглэгч ч хээтэй (хоосон жагсаалтуудын хээ). */
export async function monthFingerprints(db: D1Database, month: string, userIds: number[]): Promise<Map<number, string>> {
  const result = new Map<number, string>();
  const ids = [...new Set(userIds)].filter((n) => Number.isSafeInteger(n));
  if (ids.length === 0) return result;
  const { from, to } = monthRange(month);

  const [sessions, leaves, cuts, ooo, hol] = await Promise.all([
    rowsFor(
      db,
      (ph) => `SELECT user_id, id, date, clock_in, clock_out, hours_worked, late_minutes, non_project_credit_hours
                 FROM attendance_sessions
                WHERE date >= ? AND date <= ? AND user_id IN (${ph})
                ORDER BY user_id, id`,
      [from, to],
      ids,
    ),
    rowsFor(
      db,
      (ph) => `SELECT user_id, id, leave_type, start_date, end_date, start_time, end_time, hours, days, is_paid
                 FROM leave_requests
                WHERE status = 'approved' AND start_date <= ? AND end_date >= ? AND user_id IN (${ph})
                ORDER BY user_id, id`,
      [to, from],
      ids,
    ),
    rowsFor(
      db,
      (ph) => `SELECT user_id, leave_id, date, used_minutes
                 FROM leave_arrival_cuts
                WHERE date >= ? AND date <= ? AND user_id IN (${ph})
                ORDER BY user_id, leave_id, date`,
      [from, to],
      ids,
    ),
    rowsFor(
      db,
      (ph) => `SELECT user_id, id, work_date, hours, start_time, end_time
                 FROM out_of_office_requests
                WHERE status = 'approved' AND work_date >= ? AND work_date <= ? AND user_id IN (${ph})
                ORDER BY user_id, id`,
      [from, to],
      ids,
    ),
    db.prepare('SELECT date FROM holidays WHERE date >= ? AND date <= ? ORDER BY date').bind(from, to).all<{ date: string }>(),
  ]);
  const holidays = (hol.results ?? []).map((h) => h.date);

  const group = (rows: Row[]) => {
    const m = new Map<number, unknown[]>();
    for (const r of rows) {
      const { user_id, ...rest } = r;
      const list = m.get(user_id) ?? [];
      list.push(Object.values(rest));
      m.set(user_id, list);
    }
    return m;
  };
  const s = group(sessions);
  const l = group(leaves);
  const c = group(cuts);
  const o = group(ooo);
  for (const id of ids) {
    result.set(
      id,
      await fingerprintOf({
        sessions: s.get(id) ?? [],
        leaves: l.get(id) ?? [],
        cuts: c.get(id) ?? [],
        ooo: o.get(id) ?? [],
        holidays,
      }),
    );
  }
  return result;
}

/** Хариулт (`confirmed`/`disputed`) өгсний дараа өгөгдөл өөрчлөгдсөн эсэх.  Хээгүй (0403-аас өмнөх) хариулт = false. */
export function changedSinceAnswer(
  row: { status: string | null; data_fingerprint?: string | null },
  current: string | undefined,
): boolean {
  if (row.status !== 'confirmed' && row.status !== 'disputed') return false;
  if (!row.data_fingerprint || !current) return false;
  return row.data_fingerprint !== current;
}
