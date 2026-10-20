import type { ScheduleKey } from '@/shared/types';

/**
 * Ээлжийн өнгө — chip, хүснэгтийн badge, шүүлт гурав ИЖИЛ өнгөтэй байхын тулд.
 *
 * Загвар нь `shared/lib/team-colors.ts`-ийн `TeamChipTone`-той ЯГ ижил (хоёр
 * chip мөр зэрэгцээ зогсдог тул нэг нь тунгалаг, нөгөө нь дүүрэн байвал
 * харагдац эвдэрнэ): `chip` = тунгалаг, `chipSolid` = дүүрэн.  Хоёр текстийн
 * өнгө (`*-700` / `dark:*-300`) нь гэрэл ба харанхуй хоёуланд уншигдана.
 *
 * ⚠️ Багийн палеттай ДАВХЦАХГҮЙ өнгө сонгосон: ижил мөрөнд багийн код (цэнхэр
 *    BA, улбар шар BB…) болон ээлжийн badge зэрэгцэн харагддаг тул хоёулаа
 *    цэнхэр байвал уншигч аль нь юу болохыг ялгахгүй.
 *
 * ⚠️ Түлхүүр нь `ScheduleKey`-ийн БҮРЭН бүрхэвч (`Record`) — дөрөв дэх ээлж
 *    нэмэгдвэл энэ файл КОМПИЛЯЦИЙН АЛДАА өгнө, чимээгүй саарал болохгүй.
 */
export const SHIFT_TONE: Record<ScheduleKey, { chip: string; chipSolid: string; text: string }> = {
  // 08:00–17:00 — эртийн ээлж, нар мандах өнгө.
  early: {
    chip: 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/40',
    chipSolid: 'bg-amber-500/90 text-white border-amber-400',
    text: 'text-amber-700 dark:text-amber-400',
  },
  // 08:30–17:30 — хүүхдээ хүргэдэг ажилтны дунд ээлж.
  mid: {
    chip: 'bg-violet-500/15 text-violet-700 dark:text-violet-300 border-violet-500/40',
    chipSolid: 'bg-violet-500/90 text-white border-violet-400',
    text: 'text-violet-700 dark:text-violet-400',
  },
  // 09:00–18:00 — үндсэн ажлын цаг.
  standard: {
    chip: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/40',
    chipSolid: 'bg-emerald-500/90 text-white border-emerald-400',
    text: 'text-emerald-700 dark:text-emerald-400',
  },
};

/**
 * Ээлжийн ЭХ СУРВАЛЖИЙН эрэмбэ — «Сонголт» баганыг өсөхөөр эрэмбэлэхэд
 * «сонгоогүй» нь ЭХЭНД гарна.  Админы асуулт нь бараг үргэлж «хэн сонголтоо
 * хийгээгүй байна вэ, хэнд сануулах вэ» байдаг тул тэр нь дефолт дараалал.
 *
 * ⚠️ Түлхүүр нь `User['work_schedule_source']`-ийн бүх утгыг бүрхэнэ.  Хуучин
 *    backend талбарыг буцаахгүй үед дуудагч `?? 'default'` гэж уналгана.
 */
export const SOURCE_RANK: Record<'default' | 'admin' | 'self', number> = {
  default: 0,
  admin: 1,
  self: 2,
};
