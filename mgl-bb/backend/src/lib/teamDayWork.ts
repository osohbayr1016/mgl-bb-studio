/**
 * Багууд хуудасны «ОДООГИЙН АЖИЛ» (2026-09-24) — ЦЭВЭР дүрэм, импортгүй тул
 * `node --test` шууд ачаална.  D1 уншилт нь `lib/teamDayWorkStore.ts`-д.
 *
 * «Ажилтан одоо юу хийж байна» гэдгийн ҮНДСЭН эх сурвалж ХЭВЭЭР: ирцээр
 * сонгосон төсөл / засварын төсөл (`GET /teams/allocation`-ийн `now` /
 * `latest`, attendance checkpoint + `daily_active_*`).  Энэ файл түүн дээр
 * НЭГ өдрийн хоёр нэмэлт эх сурвалжийг нэмнэ — хоёулаа өмнөх сессүүдийн
 * хүснэгт, шинэ бүтэц БИШ:
 *   • төслийн бус ажил (`non_project_work_entries`, 0342) — ангилал, «Бусад»
 *     тайлбар, эхлэх/дуусах цаг.  `daily_active_*`-д ОРДОГГҮЙ тул allocation
 *     түүнийг өөрөө хэзээ ч харахгүй;
 *   • засварын цаг (`repair_entries`, 0114/0194/0341) — төсөл эсвэл засварын
 *     төсөл, таск (0341), цаг.
 *
 * «Одоо» дүрэм (эзний шийдвэр, 2026-09-24): төслийн бус ажлын цагийн муж
 * одоогийн цагийг хамарвал ТЭР нь одоогийн ажил, тэр хугацаанд ирцийн
 * сонголтын «одоо» тэмдэг ХАРАГДАХГҮЙ (frontend `teams/lib/currentWork.ts`).
 * Ирцийн `now` туг өөрөө ХӨДЛӨХГҮЙ — донатын «үндсэн төсөл» (статистик)
 * түүнээс хамаардаг тул энэ нь зөвхөн ХАРАГДАЦЫН дүрэм.  Ирцийн нээлттэй
 * session шаардахгүй: эзний дүрэм нь зөвхөн цагийн мужаар.
 */

/** 'HH:MM' (эсвэл 'HH:MM:SS') → өдрийн минут.  Буруу бол null. */
export function hhmmMinutes(raw: string | null | undefined): number | null {
  if (typeof raw !== 'string') return null;
  const m = /^([01]\d|2[0-3]):([0-5]\d)(?::[0-5]\d)?$/.exec(raw.trim());
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

/**
 * Төслийн бус ажлын бүртгэл ОДОО үргэлжилж байна уу — хагас нээлттэй
 * [эхлэх, дуусах): 16:00-д дуусах ажил 16:00-д «одоо» биш.  `nowMin` = null
 * (өнгөрсөн / ирээдүйн өдөр) бол үргэлж false.  Цаггүй бүртгэл (0356) энд
 * false — түүний «одоо»-г ирцийн сүүлийн цэгийн сонголтоор дуудагч шийднэ.
 */
export function nonProjectCoversNow(
  entry: { start_time: string | null; end_time: string | null },
  nowMin: number | null,
): boolean {
  if (nowMin == null) return false;
  const start = hhmmMinutes(entry.start_time);
  const end = hhmmMinutes(entry.end_time);
  if (start == null || end == null || end <= start) return false;
  return start <= nowMin && nowMin < end;
}
