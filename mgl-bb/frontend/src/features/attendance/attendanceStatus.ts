/**
 * `GET /attendance/my-status`-ийн query түлхүүр ба «ирцийн төлвийг хуучирсанд
 * тооцох» ГАНЦ цэг.
 *
 * ⚠️ Явц бичдэг БҮХ зам үүнийг дуудна (`/progress`, `/progress/bulk`,
 * хуваарилалтын `−/+` хяналт).  `my-status`-ийн `progress_logged_today` нь
 * «Гарах» товчийг хаадаг тул явц хадгалсны дараа кэш хуучин үлдвэл ажилтан
 * гарах бүртгэлээ хийж чадалгүй тардаг байв (прод 2026-10-16, user 84): явцаа
 * 18:34-д оруулаад Хяналтын самбар руу 60 секундийн дотор буцсан тул кэш
 * «шинэ» гэж тооцогдож (`staleTime` 60 сек) дахин татагдаагүй — товч хаалттай
 * хэвээр, дарахад юу ч болоогүй, маргааш нь ирэх бүртгэл түгжигдсэн.
 * Засварын бүртгэл (`RepairSection`) ба төслийн бус ажил аль хэдийн шинэчилдэг
 * байсан тул тэр өдрүүдэд гарах бүртгэл 5–8 секундын дараа амжилттай болж байв.
 *
 * Энэ нь queryClient-ийн түвшний invalidate тул ирцийн гадаргуу (Ирц хуудас,
 * Хяналтын самбарын widget) ТЭР агшинд нээлттэй байхгүй байсан ч дараа нь
 * нээгдэхэд заавал дахин татна.
 */
import { queryClient } from '@/shared/api/queryClient';

export const ATTENDANCE_STATUS_KEY = ['/attendance/my-status'] as const;

export function invalidateAttendanceStatus(): void {
  void queryClient.invalidateQueries({ queryKey: ATTENDANCE_STATUS_KEY });
}
