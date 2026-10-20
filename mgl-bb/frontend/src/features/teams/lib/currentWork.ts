/**
 * Ажилтны «ОДООГИЙН АЖИЛ» (2026-09-24) — Багууд хуудас ба багийн хуудсанд.
 *
 * Эх сурвалж ГУРАВ, бүгд өмнө нь байсан өгөгдөл — шинэ бүтэц БИШ:
 *   1. Ирцээр сонгосон төсөл / засварын төсөл — `AllocActiveMember`
 *      (`now` / `latest`, `/teams/allocation`).  Хуучин эх сурвалж ХЭВЭЭР.
 *   2. Төслийн бус ажил (0342) — ангилал, «Бусад» тайлбар, цагийн муж.
 *   3. Засварын цаг (`repair_entries`) — төсөл / засварын төсөл, таск, цаг.
 * 2, 3 нь серверийн `day_work` (backend `lib/teamDayWorkStore.ts`) — зангуу
 * өдрийнх, `/teams/allocation` ба `/teams/:id/overview` хоёр ИЖИЛ хэлбэртэй.
 *
 * «Одоо» дүрэм (эзний шийдвэр): төслийн бус ажлын цагийн муж одоог хамарвал
 * ТЭР нь одоогийн ажил — тэр хугацаанд ирцийн сонголтын «одоо» тэмдэг
 * нуугдана (`showPickNow`).  Серверийн `AllocActiveMember.now` ӨӨРЧЛӨГДӨХГҮЙ:
 * донатын «үндсэн төсөл» түүнээс хамаардаг тул энэ нь зөвхөн харагдац.
 */

export interface DayNonProjectItem {
  id: number;
  user_id: number;
  category: string;
  /** Серверийн (монгол) шошго — i18n түлхүүр байхгүй үеийн нөөц. */
  category_label: string;
  /** Зөвхөн «Бусад» ангилалд. */
  note: string | null;
  /** Цаггүй бүртгэлд (ирцэд сонгосон, 0357) хоёулаа null. */
  start_time: string | null;
  end_time: string | null;
  minutes: number;
  /** Зөвхөн өнөөдөр, сервер тооцсон: цагийн муж одоог хамарна, цаггүй бол ирцийн
   *  сүүлийн цэгт сонгогдсон. */
  now: boolean;
}

export interface DayRepairHoursItem {
  id: number;
  user_id: number;
  /** `project` = жинхэнэ төсөл дээрх засвар, `repair` = засварын (дотоод) төсөл. */
  kind: 'project' | 'repair';
  /** ЭЕРЭГ `projects.id` эсвэл `repair_projects.id` — `kind`-аар ялгана. */
  target_id: number;
  target_name: string;
  task_id: number | null;
  task_name: string | null;
  hours: number;
}

/** Серверийн `day_work`. */
export interface DayWorkPayload {
  date: string;
  non_project: DayNonProjectItem[];
  repair_hours: DayRepairHoursItem[];
}

/** Нэг хүний өдрийн нэмэлт ажил. */
export interface PersonDayWork {
  nonProject: DayNonProjectItem[];
  repairHours: DayRepairHoursItem[];
  /** Төслийн бус ажил ОДОО үргэлжилж байна — ирцийн «одоо»-г дарна. */
  nonProjectNow: boolean;
}

/** user_id → өдрийн ажил.  Ажилгүй хүн газрын зурагт ОРОХГҮЙ. */
export function indexDayWork(payload: DayWorkPayload | null | undefined): Map<number, PersonDayWork> {
  const index = new Map<number, PersonDayWork>();
  const slot = (userId: number) => {
    let w = index.get(userId);
    if (!w) index.set(userId, (w = { nonProject: [], repairHours: [], nonProjectNow: false }));
    return w;
  };
  for (const e of payload?.non_project ?? []) {
    const w = slot(e.user_id);
    w.nonProject.push(e);
    if (e.now) w.nonProjectNow = true;
  }
  for (const r of payload?.repair_hours ?? []) slot(r.user_id).repairHours.push(r);
  return index;
}

export function hasDayWork(work: PersonDayWork | undefined): work is PersonDayWork {
  return !!work && (work.nonProject.length > 0 || work.repairHours.length > 0);
}

/**
 * Нэг засварын төсөл ирцийн сонголт (`−repair_projects.id`) БА засварын цагаар
 * (`kind: 'repair'`) хоёуланд нь орсон бол мөрөнд ХОЁР удаа харагдана.  Зөвхөн
 * ХАРАГДАЦЫН дүрэм (эх мөрүүд хөндөгдөхгүй): тийм цагийг тусдаа мөрөөс хасаж,
 * сонголтын id-аар нь нийлүүлж буцаана — шошгон дээр «R · 2 цаг 30 мин».
 * Жинхэнэ төсөл дээрх засвар (`kind: 'project'`) таск нэрээ агуулдаг тул
 * мөрөндөө үлдэнэ.  Нийлэх зүйлгүй бол анхны объект хэвээр буцна.
 */
export function mergePickedRepairHours(
  work: PersonDayWork | undefined,
  pickIds: ReadonlySet<number>,
): { work: PersonDayWork | undefined; hoursByPick: Map<number, number> } {
  const hoursByPick = new Map<number, number>();
  if (!work) return { work, hoursByPick };
  const rest: DayRepairHoursItem[] = [];
  for (const r of work.repairHours) {
    const pickId = -r.target_id;
    if (r.kind === 'repair' && pickIds.has(pickId)) {
      hoursByPick.set(pickId, (hoursByPick.get(pickId) ?? 0) + r.hours);
    } else rest.push(r);
  }
  if (hoursByPick.size === 0) return { work, hoursByPick };
  const merged = { ...work, repairHours: rest };
  return { work: hasDayWork(merged) ? merged : undefined, hoursByPick };
}

/** Ирцийн сонголтын «одоо» тэмдгийг харуулах уу — төслийн бус ажил давамгайлна. */
export function showPickNow(pickNow: boolean, work: PersonDayWork | undefined): boolean {
  return pickNow && !work?.nonProjectNow;
}

/** Цагийг (бутархай) минут болгоно — `formatDuration`-д. */
export const hoursToMinutes = (hours: number): number => Math.max(0, Math.round(hours * 60));
