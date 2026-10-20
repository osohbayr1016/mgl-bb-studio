/**
 * Мартагдсан албан таймерын 23:59 зогсолт (эзэн 2026-10-01).
 *
 * Таск дээрх НЭР = таймер нь ОДОО явж буй хүн тул зогсоохоо мартсан хүн шөнөжин
 * тэр таск дээр «ажиллаж байгаа» харагдаж, хуваагдах таскийг бусдад хааж, цаг нь
 * буруу хуримтлагдана.  «Гарах» бүртгэхэд таймер аль хэдийн зогсдог
 * (`routes/attendance.ts`); гарахаа мартсан бол ЭНД эхэлсэн өдрийнх нь
 * 23:59:59.999-д хаагдана (`end_note='day_end'`, `ended_by = 0` систем) ба
 * тухайн хүнд мэдэгдэл очно.
 *
 * Cron: ШИНЭ cron илэрхийлэл БҮРТГЭЭГҮЙ — `index.ts`-ийн fail-safe салаа (2 мин)
 * дээр залгагдана.  Ажил байхгүй үед `ended_at IS NULL` мөрүүдийн ганц уншилт.
 */
import type { Env } from '../types';
import { createNotification } from './notify';
import { orgUtcOffsetMinutes } from './reportWindows';
import { sweepDayEndTimers } from './taskTimerStore';

export async function runTaskTimerDayEndSweep(env: Env): Promise<void> {
  const closed = await sweepDayEndTimers(env.DB, Date.now(), orgUtcOffsetMinutes());
  for (const s of closed) {
    await createNotification(
      env.DB,
      s.user_id,
      'task_assigned',
      'Таны таскийн цаг 23:59-д автоматаар зогслоо',
      `${s.task_name ? `«${s.task_name}» — ` : ''}зогсоохоо эсвэл ирцээ «Гарах» бүртгэхээ мартсан байна.  Үргэлжлүүлэх бол «Миний ажлууд»-аас дахин эхлүүлнэ үү.`,
      '/app/my-tasks',
    );
  }
}
