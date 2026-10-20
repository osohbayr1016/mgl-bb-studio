/**
 * Төслийн бус ажил өөрчлөгдсөний дараах ГАНЦ дараалал — бүртгэл нэмэх/засах/
 * устгах (`routes/nonProjectWork.ts`) ба ирцийн цэгийн сонголт
 * (`routes/attendance.ts`) хоёулаа үүнийг дуудна:
 *
 *   1. ирцийн ажилласан цагийн нэмэлт (0352, зөвхөн цагтай бүртгэлээс);
 *   2. өнөөдрийн засварын цагийн хуваарилалт (0348 — төслийн бус ажлын цаг
 *      засварт тооцогдохгүй).
 *
 * Ирцийн сонголт (цаггүй мөр) аль алинд нь ОРОЛЦОХГҮЙ — зөвхөн хяналт (эзний
 * дүрэм 2026-09-28).  Ажилтан «Миний ажлууд»-аас цагаа оруулахад л тооцогдоно.
 *
 * `nonProjectWorkStore.ts`-ээс ТУСДАА файл: `repairDayStore.ts` нь
 * `nonProjectWorkStore.ts`-ийг импортолдог тул эсрэг чиглэлд импортлох нь
 * тойрог үүсгэнэ.  Алдаа нь үндсэн хүсэлтийг унагахгүй — бичилт аль хэдийн
 * амжилттай болсон үед дуудагдана.
 */
import type { AttendanceSettings } from './settings';
import { todayInUB } from './time';
import { syncNonProjectCreditSafe } from './nonProjectWorkStore';
import { syncRepairDayIfMarked } from './repairDayStore';

export async function afterNonProjectChange(
  db: D1Database,
  userId: number,
  date: string,
  settings?: AttendanceSettings,
): Promise<void> {
  await syncNonProjectCreditSafe(db, userId, date, settings);
  if (date !== todayInUB()) return;
  try {
    await syncRepairDayIfMarked(db, userId, date);
  } catch (err) {
    console.error('[repair-day] resync after non-project change failed', err);
  }
}
