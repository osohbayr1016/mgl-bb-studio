/**
 * Төслийн бус ажил (миграц 0342) — ЦЭВЭР дүрэм.  Импортгүй тул
 * `node --test` шууд ачаална.
 *
 * Урсгал (эзний шийдвэр, 2026-09-24):
 *   1. Ажилтан ирцийн цонхноос (эсвэл «Миний ажлууд»-аас) ажлын төрөл +
 *      эхэлсэн/дууссан цагаа бүртгэнэ.  Дууссан цаг тухайн өдрийн ээлжийн
 *      төгсгөлөөс хойш байж болохгүй (17:00-д тарвал 17:00 хүртэл).  Тэр өдрийн ирц энэ ажлаар
 *      тооцогдоно — «дор хаяж нэг төсөл» шаардлагыг хангана.
 *   2. Өдрийн төгсгөлд яг юу хийснээ `report`-д бичнэ — бичээгүй бол гарах
 *      бүртгэл хийгдэхгүй (`routes/attendance.ts`).
 *   3. Админ шалгаж батална → өдрийн хувь орно (дараагийн шат).
 *
 * Хугацаа нь цайны цонхтой давхцсан хэсгийг ХАСНА — ирцийн `hours_worked`-
 * тэй ижил дүрэм (09:00–18:00 → 8 цаг).
 *
 * ЦАГГҮЙ бүртгэл (миграц 0356/0357; эзний шийдвэр 2026-09-28, тэр өдрийн
 * ДАХИН шийдвэрээр «зөвхөн хяналт» болсон):
 *   • Ирцийн цонхонд (өглөө / 14:00 / гарах) ажилтан зөвхөн ажлаа СОНГОНО —
 *     «одоо юу хийж байна» гэдгийг л тэмдэглэнэ (Багууд хуудасны хяналт).
 *     Цаг, хувь, ажилласан цагийн нэмэлт, засварын хуваарилалт — ЮУ Ч
 *     бодогдохгүй: цаггүй мөрийн `minutes` үргэлж 0.
 *   • Ажлаа дуусгасны дараа «Миний ажлууд»-аас тэр мөрийг сонгож «юу
 *     хийсэн» + эхэлсэн/дууссан цагаа оруулна — тэгж байж л шалгуулахаар
 *     илгээгдэнэ (`entryStage`) ба админ баталсны дараа хувь бодогдоно.
 *   • Тиймээс гарах бүртгэл «юу хийсэн»-ийг ШААРДАХГҮЙ (15:00-д гараад
 *     зохиогчийн хяналтад явсан хүн ажлаа хараахан хийгээгүй).
 */

/** Бүртгэж болох ролиуд — засвар бүртгэх эрхтэй ижил олонлог.  Админ tier
 *  ирцийн popup-гүй (unrestricted) тул энд ороогүй. */
export const NON_PROJECT_WORK_ROLES = ['engineer', 'architect', 'senior'] as const;

/**
 * Ажлын төрлүүд — ЭНЭ ЖАГСААЛТ Л ЭХ СУРВАЛЖ.  Frontend нь серверээс
 * (`my-status` / `GET /api/non-project-work/my`) авч, шошгыг i18n-ээр
 * орчуулна; i18n-д түлхүүр байхгүй бол `label`-ийг харуулна.
 * ⚠️ Эзний өгсөн жагсаалтаас (2026-09-25) өөр ангилал ЗОХИОЖ нэмэхгүй.
 */
export const NON_PROJECT_CATEGORIES = [
  { key: 'author_supervision', label: 'Зохиогчийн хяналт', requiresNote: false },
  { key: 'document_exchange', label: 'Баримт бичиг өгөх/авах', requiresNote: false },
  { key: 'drawing_exchange', label: 'Зураг өгөх/авах', requiresNote: false },
  { key: 'drawing_printing', label: 'Зураг хэвлэх/наах', requiresNote: false },
  { key: 'meeting', label: 'Хурал, уулзалт', requiresNote: false },
  { key: 'other', label: 'Бусад', requiresNote: true },
] as const;

/**
 * 2026-09-25 хүртэлх ангиллууд — шинээр СОНГОГДОХГҮЙ, зөвхөн хуучин мөрийн
 * шошгонд.  Хадгалсан `category`-г хөрвүүлээгүй (утга нь шинэ ангилалтай
 * яг таардаггүй), тиймээс түүх хуучин нэрээрээ харагдана.
 */
const LEGACY_CATEGORY_LABELS: Record<string, string> = {
  paper_pasting: 'Цаас наах',
  document_organizing: 'Баримт бичиг янзлах',
};

/** Мөрийн шошго — идэвхтэй ангилал, хуучин ангилал, эс бөгөөс түлхүүр өөрөө. */
export function categoryLabelOf(key: string): string {
  return categoryOf(key)?.label ?? LEGACY_CATEGORY_LABELS[key] ?? key;
}

export type NonProjectCategory = (typeof NON_PROJECT_CATEGORIES)[number]['key'];

export const NOTE_MAX = 500;
export const REPORT_MAX = 2000;

export type NonProjectStatus = 'pending' | 'approved' | 'rejected';

/**
 * Дэлгэцэнд харуулах шат — ХАДГАЛДАГГҮЙ, `status` + `report` + цагаас гаргана:
 *   needs_report    — бүртгэсэн (ирцэд сонгосон), гэхдээ «юу хийсэн» тайлбар
 *                     ЭСВЭЛ эхэлсэн/дууссан цаг дутуу — ажилтан «Миний ажлууд»-
 *                     аас дуусгаж бүртгээгүй (түлхүүрийн нэр түүхэн);
 *   awaiting_review — тайлбар + цагтай, админы шалгалт хүлээж буй;
 *   approved / rejected — админы шийдвэр.
 */
export type NonProjectStage = 'needs_report' | 'awaiting_review' | 'approved' | 'rejected';

export function categoryOf(key: unknown) {
  return NON_PROJECT_CATEGORIES.find((c) => c.key === key) ?? null;
}

/** 'HH:MM' → өдрийн минут (0..1439).  Буруу бол null. */
export function parseHhmm(raw: unknown): number | null {
  if (typeof raw !== 'string') return null;
  const m = /^([01]\d|2[0-3]):([0-5]\d)(?::[0-5]\d)?$/.exec(raw.trim());
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

export function hhmm(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** Цайны цонх, минутаар.  `null` = цайны цаг хасахгүй (тохиргоогоор унтраасан). */
export type LunchWindow = { start: number; end: number } | null;

export function lunchWindowOf(settings: {
  lunchEnabled: boolean;
  lunchStart: string;
  lunchEnd: string;
}): LunchWindow {
  if (!settings.lunchEnabled) return null;
  const start = parseHhmm(settings.lunchStart);
  const end = parseHhmm(settings.lunchEnd);
  if (start === null || end === null || end <= start) return null;
  return { start, end };
}

/** [start, end) хугацаанаас цайны цонхтой давхцсан хэсгийг хассан минут. */
export function workMinutes(start: number, end: number, lunch: LunchWindow): number {
  const gross = Math.max(0, end - start);
  if (!lunch) return gross;
  const overlap = Math.max(0, Math.min(end, lunch.end) - Math.max(start, lunch.start));
  return gross - overlap;
}

/** Хагас нээлттэй [start, end) хоёр интервал давхцах эсэх (зэргэлдээ нь давхцахгүй). */
export function rangesOverlap(
  a: { start: number; end: number },
  b: { start: number; end: number },
): boolean {
  return a.start < b.end && b.start < a.end;
}

export type EntryInput = {
  category: NonProjectCategory;
  note: string | null;
  /** Цаггүй бүртгэлд дөрвөн цагийн талбар бүгд `null` (0356). */
  startTime: string | null;
  endTime: string | null;
  startMin: number | null;
  endMin: number | null;
  minutes: number | null;
};

export type ValidationResult =
  | { ok: true; value: EntryInput }
  | { ok: false; error: string; code: string };

/** Ангилал + «Бусад»-ын тайлбар — маягт ба ирцийн сонголт хоёулаа үүгээр. */
export function validateCategoryNote(body: {
  category?: unknown;
  note?: unknown;
}):
  | { ok: true; category: NonProjectCategory; note: string | null }
  | { ok: false; error: string; code: string } {
  const cat = categoryOf(body.category);
  if (!cat) {
    return { ok: false, error: 'Ажлын төрлөө сонгоно уу', code: 'INVALID_CATEGORY' };
  }
  const rawNote = typeof body.note === 'string' ? body.note.trim().slice(0, NOTE_MAX) : '';
  const note = cat.requiresNote ? rawNote : '';
  if (cat.requiresNote && !note) {
    return { ok: false, error: '«Бусад» сонгосон бол ямар ажил болохыг бичнэ үү', code: 'NOTE_REQUIRED' };
  }
  return { ok: true, category: cat.key, note: note || null };
}

/** Цагийн талбар хоосон эсэх (байхгүй / null / хоосон мөр). */
function blankTime(raw: unknown): boolean {
  return raw == null || (typeof raw === 'string' && raw.trim() === '');
}

/**
 * Үүсгэх / засах биеийг шалгана.  «Бусад» үед `note` ЗААВАЛ; бусад
 * ангилалд `note` хадгалахгүй (эзний шаардлагад тэр талбар байхгүй).
 *
 * Цаг СОНГОЛТТОЙ (0356): эхэлсэн, дууссан цаг ХОЁУЛАА хоосон бол цаггүй
 * бүртгэл (0 минут — хувь бодогдохгүй, шалгуулахаар илгээгдэхгүй); нэг нь л
 * бөглөгдсөн бол алдаа.  «Миний ажлууд»-ын маягт цагийг заавал болгодог —
 * сервер цаггүйг зөвшөөрдөг нь ирцийн сонголтын мөртэй ижил хэлбэр учраас.
 *
 * `shiftEndMin` — тухайн өдрийн бодит ээлжийн дуусах минут.  Дууссан цаг
 * түүнээс ХОЙШ байж болохгүй (17:00-д тардаг хүн 17:00 хүртэл л, 17:01 үгүй).
 * Яг тэнцүү нь зөвшөөрөгдөнө.  Өгөөгүй бол энэ хаалт алгасна.
 */
export function validateEntryInput(
  body: { category?: unknown; note?: unknown; start_time?: unknown; end_time?: unknown },
  lunch: LunchWindow,
  shiftEndMin?: number | null,
): ValidationResult {
  const cn = validateCategoryNote(body);
  if (!cn.ok) return cn;
  if (blankTime(body.start_time) && blankTime(body.end_time)) {
    return {
      ok: true,
      value: {
        category: cn.category,
        note: cn.note,
        startTime: null,
        endTime: null,
        startMin: null,
        endMin: null,
        minutes: null,
      },
    };
  }
  const startMin = parseHhmm(body.start_time);
  const endMin = parseHhmm(body.end_time);
  if (startMin === null || endMin === null) {
    return {
      ok: false,
      error: 'Эхэлсэн, дууссан цагаа хоёуланг нь (ЦЦ:ММ) оруулна уу, эсвэл хоёуланг хоосон үлдээнэ үү',
      code: 'INVALID_TIME',
    };
  }
  if (endMin <= startMin) {
    return { ok: false, error: 'Дууссан цаг эхэлсэн цагаас хойш байх ёстой', code: 'END_BEFORE_START' };
  }
  if (shiftEndMin != null && endMin > shiftEndMin) {
    return {
      ok: false,
      error: `Ажлын цаг ${hhmm(shiftEndMin)}-д дуусна. Түүнээс хойш бүртгэх боломжгүй`,
      code: 'AFTER_SHIFT_END',
    };
  }
  const minutes = workMinutes(startMin, endMin, lunch);
  if (minutes <= 0) {
    return {
      ok: false,
      error: 'Энэ хугацаа бүхэлдээ цайны цагт багтаж байна',
      code: 'ZERO_DURATION',
    };
  }
  return {
    ok: true,
    value: {
      category: cn.category,
      note: cn.note,
      startTime: hhmm(startMin),
      endTime: hhmm(endMin),
      startMin,
      endMin,
      minutes,
    },
  };
}

/** «Юу хийсэн» тайлбар — хоосон бол null (= бичээгүй). */
export function normalizeReport(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const s = raw.trim().slice(0, REPORT_MAX);
  return s ? s : null;
}

/**
 * Цаг хоёулаа бөглөгдсөн эсэх — 0356-ийн CHECK нь «хоёулаа эсвэл аль нь ч
 * биш»-ийг баталгаажуулдаг тул `start_time` л хангалттай.
 */
export function entryStage(row: {
  status: NonProjectStatus;
  report: string | null;
  start_time: string | null;
}): NonProjectStage {
  if (row.status === 'approved') return 'approved';
  if (row.status === 'rejected') return 'rejected';
  const reported = !!(row.report && row.report.trim());
  return reported && row.start_time != null ? 'awaiting_review' : 'needs_report';
}

/**
 * Өдрийн бусад бүртгэлтэй давхцсан эхний мөр (байвал).  Татгалзсан мөр
 * тооцогдохгүй; засах үед өөрийгөө (`excludeId`) алгасна.  Цаггүй мөр
 * (0356) цагийн мужгүй тул хэнтэй ч давхцахгүй.
 */
export function findOverlap<
  T extends { id: number; start_time: string | null; end_time: string | null; status: NonProjectStatus },
>(
  rows: T[],
  range: { start: number; end: number },
  excludeId?: number,
): T | null {
  for (const r of rows) {
    if (r.id === excludeId || r.status === 'rejected') continue;
    const s = parseHhmm(r.start_time);
    const e = parseHhmm(r.end_time);
    if (s === null || e === null) continue;
    if (rangesOverlap(range, { start: s, end: e })) return r;
  }
  return null;
}

/**
 * Ирцийн ажилласан цагт НЭМЭГДЭХ төслийн бус ажлын минут (миграц 0352).
 *
 * Эзний дүрэм (2026-09-28): 17:00-д тардаг хүн 15:00–17:00-д оффисоос гадуур
 * төслийн бус ажил (зохиогчийн хяналт г.м.) хийхээр явахдаа 15:00-д гарах
 * бүртгэлээ ӨӨРӨӨ хийнэ — гарах цаг 15:00 гэж БОДИТООР үлдэнэ, харин
 * 15:00–17:00 нь ажилласан цагт тооцогдоно.  Систем бүртгэлийг автоматаар
 * ХААХГҮЙ.
 *
 * = төслийн бус ажлын интервалуудын НЭГДЭЛ − ирцийн session-уудын НЭГДЭЛ −
 *   цайны цонх.  Оффист байх хугацаанд (session дотор) хийсэн төслийн бус
 *   ажил аль хэдийн тоологдсон тул ДАВХАР нэмэгдэхгүй; нээлттэй session нь
 *   өдрийн төгсгөл хүртэл хамарна гэж үзнэ (одоо оффист байгаа хүн).
 *
 * Бүх утга нь тухайн өдрийн минут (0..1440).  Нэг өдөр = 1440 нүд тул
 * энгийн битмапаар — давхцал, дараалал, зэргэлдээ интервалыг бүгд зөв.
 *
 * `window` (2026-10-01-ээс, `lib/shiftBoundedHours.ts`) — өгвөл зөвхөн
 * ээлжийн цонх доторх минут тоологдоно: ирцийн цагтай ижил дүрмээр
 * 17:00-оос хойш / 08:00-оос өмнөх ажил ажилласан цагт нэмэгдэхгүй.
 */
export function nonProjectCreditMinutes(
  sessions: Array<{ start: number; end: number | null }>,
  entries: Array<{ start: number; end: number }>,
  lunch: LunchWindow,
  window?: { start: number; end: number } | null,
): number {
  const DAY = 1440;
  const clamp = (n: number) => Math.max(0, Math.min(DAY, n));
  const cells = new Uint8Array(DAY);
  const lo = window ? clamp(window.start) : 0;
  const hi = window ? clamp(window.end) : DAY;
  for (const e of entries) {
    const end = Math.min(hi, clamp(e.end));
    for (let m = Math.max(lo, clamp(e.start)); m < end; m += 1) cells[m] = 1;
  }
  for (const s of sessions) {
    for (let m = clamp(s.start); m < clamp(s.end ?? DAY); m += 1) cells[m] = 0;
  }
  if (lunch) {
    for (let m = clamp(lunch.start); m < clamp(lunch.end); m += 1) cells[m] = 0;
  }
  let total = 0;
  for (let m = 0; m < DAY; m += 1) total += cells[m]!;
  return total;
}

/* ------------------------------------------------------------------ */
/*  Ирцийн сонголт (миграц 0356/0357) — зөвхөн хяналт                  */
/* ------------------------------------------------------------------ */

/** `attendance_project_checkpoints.checkpoint_type`-тэй ижил. */
export type CheckpointType = 'morning' | 'afternoon' | 'clock_out';
export type DayHalf = 'am' | 'pm';

/** Өглөөний цэг → өглөөний хагас; 14:00 ба гарах цэг → үдээс хойших хагас.
 *  Зөвхөн харуулахад («Өглөө сонгосон») — цагийн тооцоонд ОРОЛЦОХГҮЙ. */
export function halfOfCheckpoint(type: CheckpointType): DayHalf {
  return type === 'morning' ? 'am' : 'pm';
}

/** Ирцийн цонхонд сонгосон нэг ажил.  `report` — хуучин клиент гарах үед
 *  илгээж болно (хадгална); одоогийн UI «юу хийсэн»-ийг «Миний ажлууд»-аас л авна. */
export type NonProjectPick = {
  category: NonProjectCategory;
  note: string | null;
  report: string | null;
};

/** Нэг цэгт сонгож болох дээд тоо — ангиллын тоо + хэд хэдэн «Бусад». */
export const MAX_PICKS = 12;

/**
 * Ижил ажил мөн эсэхийг таних түлхүүр: ангилал, «Бусад» бол тайлбар ч
 * (том жижиг үсэг, зайг үл тооно).
 */
export function pickKey(p: { category: string; note: string | null }): string {
  return categoryOf(p.category)?.requiresNote
    ? `${p.category}:${(p.note ?? '').trim().replace(/\s+/g, ' ').toLowerCase()}`
    : p.category;
}

/**
 * Ирцийн хүсэлтийн `non_project` талбар.  `undefined`/`null` = талбаргүй
 * (хуучин клиент) → `picks: null`, сонголтод ХҮРЭХГҮЙ.  Хоосон массив =
 * «энэ цэгт төслийн бус ажил сонгоогүй».
 */
export function parseNonProjectPicks(
  raw: unknown,
): { ok: true; picks: NonProjectPick[] | null } | { ok: false; error: string; code: string } {
  if (raw == null) return { ok: true, picks: null };
  if (!Array.isArray(raw)) {
    return { ok: false, error: 'Төслийн бус ажлын сонголт буруу байна', code: 'INVALID_PICKS' };
  }
  const seen = new Set<string>();
  const picks: NonProjectPick[] = [];
  for (const item of raw) {
    const obj = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>;
    const cn = validateCategoryNote(obj);
    if (!cn.ok) return cn;
    const pick: NonProjectPick = { category: cn.category, note: cn.note, report: normalizeReport(obj.report) };
    const key = pickKey(pick);
    if (seen.has(key)) continue;
    seen.add(key);
    picks.push(pick);
  }
  if (picks.length > MAX_PICKS) {
    return { ok: false, error: 'Хэт олон төслийн бус ажил сонгосон байна', code: 'TOO_MANY_PICKS' };
  }
  return { ok: true, picks };
}

/**
 * Сонголт бүрийг өнөөдрийн бүртгэлтэй тулгана: ижил ажил (`pickKey`), шалгагдаагүй
 * (`pending`) мөр байвал ТҮҮНИЙГ (цаггүй нь түрүүлнэ, дараа нь эртнийх) — өглөө
 * сонгосон ажлыг 14:00-д дахин сонгоход ШИНЭ мөр үүсэхгүй, нэг мөр хоёр хагастай
 * болно.  Байхгүй бол `entry: null` = шинээр үүсгэнэ.  Нэг мөр нэг л сонголтод.
 */
export function planPicks<
  T extends { id: number; category: string; note: string | null; status: NonProjectStatus; start_time: string | null },
>(entries: readonly T[], picks: readonly NonProjectPick[]): Array<{ pick: NonProjectPick; entry: T | null }> {
  const used = new Set<number>();
  return picks.map((pick) => {
    const key = pickKey(pick);
    const entry =
      entries
        .filter((e) => e.status === 'pending' && !used.has(e.id) && pickKey(e) === key)
        .sort((a, b) => Number(a.start_time != null) - Number(b.start_time != null) || a.id - b.id)[0] ?? null;
    if (entry) used.add(entry.id);
    return { pick, entry };
  });
}
