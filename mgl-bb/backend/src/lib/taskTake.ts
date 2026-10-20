/**
 * ТАСК «ӨӨРТӨӨ АВАХ» — ЦЭВЭР ДҮРЭМ (эзний шийдвэр 2026-10-01).
 *
 * Эзний загвар («нэр = одоо хийж буй хүн»):
 *   • Таскийн жагсаалтад НЭР нь зөвхөн ОДОО ажиллаж буй хүнийх — тэр хүний албан
 *     таймер (0361) тухайн таск дээр явж байна.  Байнгын «эзэн», «оноосон хүн» гэж
 *     байхгүй; ахлах/админ оноох боломж хасагдсан.
 *   • «Өөртөө авах» = албан таймер тэр таск дээр ЭХЭЛНЭ; өөр таск дээр явж байсан
 *     нь АТОМ зогсож нэр нь шилжинэ.  Тоогоор хязгааргүй.  Ирцээ «Ирэх» бүртгээгүй
 *     бол авахгүй (ирцээс чөлөөлөгдсөн хүнээс бусад).
 *   • ХУВААГДАХ таск (жин > 0, цагаар бодогддоггүй) дээр нэг удаад НЭГ хүн;
 *     өөр хүн ажиллаж байвал «Өөртөө авах» нь 50/50 урьдчилан бөглөсөн хуваах
 *     цонх нээж, нэг товчоор хувааж авна (`lib/taskSplit.ts` `planSplit`).
 *     ХУВААГДАХГҮЙ таск (засварын цагийн ZA, жин 0) дээр хэд хэдэн хүн зэрэг.
 *   • Хувь оруулах = тухайн таскийг авч ажилласан (албан таймерын сэшнтэй) хүн;
 *     admin залруулга хэвээр.
 *   • Оноо: таск урьд хүрч байсан ХАМГИЙН ӨНДӨР хувиасаа дээш гарсан хэсэгт л
 *     (бууруулаад дахин өсгөхөд давхар оноо өгөхгүй).
 *
 * Энэ файл юу ч импортлохгүй — `node --test` hook-гүйгээр ачаална.  D1 талын
 * бичилт `taskTimerStore.ts` (таймер/авах), `routes/tasks.ts` (хуваах),
 * `routes/progress.ts` (оноо).
 */

/* ------------------------------------------------------------------ */
/*  Авах эрх                                                            */
/* ------------------------------------------------------------------ */

/** Таск авч ажиллах үүрэг — инженер, архитектор, ахлах (+ CEO-г дуудагч шийднэ).
 *  Өмнөх `canSelfClaim`-ийн ЯГ ижил олонлог: энгийн admin таск дээр ажилладаггүй. */
export const TAKE_ROLES = ['engineer', 'architect', 'senior'] as const;

export function canTakeRole(role: string, isCeoUser: boolean): boolean {
  return (TAKE_ROLES as readonly string[]).includes(role) || isCeoUser;
}

/**
 * Хуваагдах таск уу — ЗӨВХӨН ийм таск дээр нэг удаад нэг хүн ажиллана.
 * Цагаар бодогддог (засварын ZA) таск жингүйгээр явцаа авдаг, жин 0 таск
 * (хурлын даалгавар г.м.) хуваах юмгүй — тэдгээр дээр хэд хэдэн хүн зэрэг.
 */
export function isSplittableTask(t: { progress_mode: string | null; weight_percent: number }): boolean {
  return t.progress_mode !== 'hours' && Number(t.weight_percent) > 0;
}

export type TakeDenial =
  | 'ROLE_NOT_ALLOWED'
  | 'TASK_NOT_FOUND'
  | 'PROJECT_INACTIVE'
  | 'TASK_COMPLETED'
  | 'NOT_CLOCKED_IN';

export interface TakeFacts {
  exists: boolean;
  project_active: boolean;
  latest_pct: number;
  /** «Миний хэсэг дууссан» (0253) — энэ хүнд таск дууссан. */
  self_done: boolean;
  /** Ирц нээлттэй эсвэл ирцээс чөлөөлөгдсөн. */
  clocked_in: boolean;
}

/** Авч болох уу — эхний саад (дараалал: эрх → таск → төсөл → дууссан → ирц). */
export function takeDenial(role: string, isCeoUser: boolean, f: TakeFacts): TakeDenial | null {
  if (!canTakeRole(role, isCeoUser)) return 'ROLE_NOT_ALLOWED';
  if (!f.exists) return 'TASK_NOT_FOUND';
  if (!f.project_active) return 'PROJECT_INACTIVE';
  if (f.latest_pct >= 100 || f.self_done) return 'TASK_COMPLETED';
  if (!f.clocked_in) return 'NOT_CLOCKED_IN';
  return null;
}

/**
 * `NOT_ALLOCATED` (2026-10-02): хуваарилагдсан («managed») үндсэн ажил дээр танд ирээдүйн ажил хуваарилагдаагүй
 * (хуваарилалтгүй, эсвэл үлдсэн ажлаа буцаасан).  Хуучин «эзлэгдсэн → хувааж ав» зам managed таскт ажиллахгүй —
 * чөлөөт ажил (U) байвал авна, үгүй бол оролцогч/ахлах хуваарилалтыг засна.
 */
export type TakeError = TakeDenial | 'TASK_OCCUPIED' | 'NOT_ALLOCATED';

export const TAKE_DENIAL_STATUS: Record<TakeError, 403 | 404 | 409> = {
  ROLE_NOT_ALLOWED: 403,
  TASK_NOT_FOUND: 404,
  PROJECT_INACTIVE: 409,
  TASK_COMPLETED: 409,
  NOT_CLOCKED_IN: 409,
  TASK_OCCUPIED: 409,
  NOT_ALLOCATED: 409,
};

export const TAKE_DENIAL_MESSAGE: Record<TakeError, string> = {
  ROLE_NOT_ALLOWED: 'Таны эрхээр таск авч ажиллах боломжгүй.',
  TASK_NOT_FOUND: 'Таск олдсонгүй.',
  PROJECT_INACTIVE: 'Төсөл идэвхгүй тул таск авах боломжгүй.',
  TASK_COMPLETED: 'Таск дууссан тул авах боломжгүй.',
  NOT_CLOCKED_IN: 'Эхлээд ирцээ «Ирэх» бүртгэнэ үү — таскийн цаг зөвхөн ажил дээр байх хугацаанд явна.',
  TASK_OCCUPIED: 'Энэ таск дээр өөр хүн ажиллаж байна — таскийг хувааж нэг хэсгийг нь авна уу.',
  NOT_ALLOCATED: 'Энэ таскийн ирээдүйн ажил танд хуваарилагдаагүй байна.',
};

/** Хувь оруулах эрхгүй үеийн алдаа (`submitProgressEntry` — вэб, bulk, Revit). */
export const TAKE_REQUIRED_MESSAGE =
  'Энэ таск дээр эхлээд цагаа эхлүүлнэ үү («Миний ажлууд» эсвэл төслийн хуудсанд ▶ дарна) — таскийг авч ажиллаагүй бол хувь оруулах боломжгүй.';

/**
 * Хуваалтаар хаагдсан «хийгдсэн хэсэг» (`source = 'split'` 100% бичлэгтэй эх таск)
 * дээр хувь оруулах оролдлого.  Хуваахаас өмнө нээгдсэн хуудаснаас 80% гэж
 * бичвэл сүүлийн хувь 100 → 80 болж төслийн явц буурна — тиймээс хаана (admin
 * залруулга л хэвээр).  Үргэлжлэл нь хуваасан шинэ хэсэг дээр.
 */
export const SPLIT_DONE_MESSAGE =
  'Энэ таскийн хийгдсэн хэсэг хуваалтаар дууссан гэж хаагдсан — үргэлжлэлийг хуваасан шинэ хэсэг дээр оруулна уу.';

/* ------------------------------------------------------------------ */
/*  Оноо — хамгийн өндөр хүрсэн хувиас дээш л                            */
/* ------------------------------------------------------------------ */

/**
 * Шинэ бичлэгийн төслийн Δ%-аас оноонд тооцогдох ХАРЬЦАА (0..1).
 *
 * Төслийн явц нь нэг таскийн хувьтай ШУГАМАН (бусад нь тогтмол) тул
 * `Δproject = k × (new − old)`.  Таск урьд хүрч байсан хамгийн өндөр хувь
 * (`hwm`, энэ бичлэгээс ӨМНӨХ) хүртэлх хэсэг аль хэдийн оноо авсан тул
 * зөвхөн `max(0, new − max(old, hwm))` хэсэг шинэ.  Ингэснээр 77 → 8 (алдаа) →
 * 77 гэж бичихэд 69%-ийн давхар оноо гарахгүй, өөр хүний бууруулсныг дахин
 * өсгөгч зөвхөн шинээр хийсэн хэсгийнхээ оноог авна.
 */
export function hwmFraction(oldPct: number, newPct: number, hwm: number): number {
  const o = Number(oldPct) || 0;
  const n = Number(newPct) || 0;
  const h = Math.max(o, Number(hwm) || 0);
  if (n <= o) return 0;
  if (n <= h) return 0;
  return Math.min(1, (n - h) / (n - o));
}

/**
 * Хуваалтын «хийгдсэн хэсэг 100%» бичлэгийн (source='split') оноог тухайн
 * таскийн ӨМНӨХ хувь нэмэрчдэд ХУВЬ ТЭНЦҮҮЛЭН хуваана
 * (`recalculateProjectPoints`).  Эх таскийн жин багассан тул дахин тооцоход хүн
 * бүрийн хуучин хувь нэмэр яг сэргэнэ.  Хувь нэмэрч байхгүй бол хоосон.
 */
export function distributeByContribution(
  total: number,
  contributions: ReadonlyMap<number, number>,
): Array<{ user_id: number; amount: number; fraction: number }> {
  let sum = 0;
  for (const v of contributions.values()) if (v > 0) sum += v;
  if (!(total > 0) || sum <= 0) return [];
  const out: Array<{ user_id: number; amount: number; fraction: number }> = [];
  for (const [user_id, v] of contributions) {
    if (v <= 0) continue;
    const fraction = v / sum;
    out.push({ user_id, amount: total * fraction, fraction });
  }
  return out;
}
