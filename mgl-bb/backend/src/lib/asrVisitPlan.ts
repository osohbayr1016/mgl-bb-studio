/**
 * Зохиогчийн хяналтын ХУВААРЬ (`asr_visit_plans`, миграц 0331) — цэвэр хэсэг.
 *
 * Оролтын шалгалт ба мэдэгдлийн бичвэр ЭНД, D1-гүй; маршрут
 * (`lib/asrVisitPlanRoutes.ts`) нь зөвхөн уншиж/бичиж, эндхийн функцийг
 * дуудна.  Тэгснээр «тэдэн сарын тэдэнд энэ төсөл дээр зохиогчийн
 * хяналтаар явна» гэсэн өгүүлбэр `node --test`-ээр баталгаажна.
 */

export type AsrVisitPlanStatus = 'planned' | 'cancelled';

/** Хуваарь үүсгэх/засах биет — шалгалтын ДАРААХ хэлбэр. */
export interface AsrVisitPlanInput {
  project_id: number;
  /** YYYY-MM-DD (УБ). */
  visit_date: string;
  /** HH:MM эсвэл null. */
  visit_time: string | null;
  note: string | null;
  /** Давхардалгүй, эрэмбэ хадгалсан. */
  user_ids: number[];
}

export type AsrVisitPlanValidation =
  | { ok: true; value: AsrVisitPlanInput }
  | { ok: false; error: string };

/** Нэг хуваарьт явах хүний дээд тоо — санамсаргүй «бүгдийг сонгох»-оос хамгаална. */
export const MAX_PLAN_MEMBERS = 30;
/** Тэмдэглэлийн дээд урт — мэдэгдлийн биетэд ч ордог тул богино. */
export const MAX_PLAN_NOTE_CHARS = 1000;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

function isRealDate(s: string): boolean {
  if (!DATE_RE.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number) as [number, number, number];
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/**
 * Түүхий JSON биетийг шалгана.  Алдааны мессеж нь монголоор, UI шууд харуулна.
 *
 * `partial` = PATCH: талбар байхгүй бол өмнөх утга (`base`) хэвээр.
 */
export function validatePlanInput(
  raw: unknown,
  base?: AsrVisitPlanInput,
): AsrVisitPlanValidation {
  const body = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const has = (k: string) => Object.prototype.hasOwnProperty.call(body, k);

  // project_id
  let project_id = base?.project_id ?? 0;
  if (has('project_id') || !base) {
    const pid = Number(body.project_id);
    if (!Number.isInteger(pid) || pid <= 0) return { ok: false, error: 'Төсөл сонгоно уу.' };
    project_id = pid;
  }

  // visit_date
  let visit_date = base?.visit_date ?? '';
  if (has('visit_date') || !base) {
    const v = typeof body.visit_date === 'string' ? body.visit_date.trim() : '';
    if (!isRealDate(v)) return { ok: false, error: 'Огноог YYYY-MM-DD хэлбэрээр оруулна уу.' };
    visit_date = v;
  }

  // visit_time — сонголттой; хоосон мөр = null.
  let visit_time = base?.visit_time ?? null;
  if (has('visit_time')) {
    const t = body.visit_time;
    if (t == null || (typeof t === 'string' && t.trim() === '')) visit_time = null;
    else if (typeof t === 'string' && TIME_RE.test(t.trim())) visit_time = t.trim();
    else return { ok: false, error: 'Цагийг HH:MM хэлбэрээр оруулна уу.' };
  }

  // note
  let note = base?.note ?? null;
  if (has('note')) {
    const n = body.note;
    if (n == null) note = null;
    else if (typeof n === 'string') {
      const s = n.trim();
      if (s.length > MAX_PLAN_NOTE_CHARS) {
        return { ok: false, error: `Тэмдэглэл ${MAX_PLAN_NOTE_CHARS} тэмдэгтээс урт байж болохгүй.` };
      }
      note = s || null;
    } else return { ok: false, error: 'Тэмдэглэл буруу байна.' };
  }

  // user_ids — давхардлыг арилгаад эрэмбийг хадгална.
  let user_ids = base?.user_ids ?? [];
  if (has('user_ids') || !base) {
    const arr = Array.isArray(body.user_ids) ? body.user_ids : null;
    if (!arr) return { ok: false, error: 'Явах хүмүүсээ сонгоно уу.' };
    const seen = new Set<number>();
    const ids: number[] = [];
    for (const v of arr) {
      const id = Number(v);
      if (!Number.isInteger(id) || id <= 0) return { ok: false, error: 'Хэрэглэгчийн id буруу байна.' };
      if (!seen.has(id)) {
        seen.add(id);
        ids.push(id);
      }
    }
    if (ids.length === 0) return { ok: false, error: 'Дор хаяж нэг хүнийг сонгоно уу.' };
    if (ids.length > MAX_PLAN_MEMBERS) {
      return { ok: false, error: `Нэг хуваарьт ${MAX_PLAN_MEMBERS}-аас олон хүн сонгох боломжгүй.` };
    }
    user_ids = ids;
  }

  return { ok: true, value: { project_id, visit_date, visit_time, note, user_ids } };
}

/* ------------------------------------------------------------------ */
/*  Огнооны монгол бичвэр                                              */
/* ------------------------------------------------------------------ */

const WEEKDAYS_MN = ['Ням', 'Даваа', 'Мягмар', 'Лхагва', 'Пүрэв', 'Баасан', 'Бямба'] as const;

/**
 * «9-р сарын 25-нд (Пүрэв)» — өөр оны огноо бол «2027 оны 1-р сарын 5-нд (Мягмар)».
 * `today` нь УБ-ын өнөөдөр (`todayInUB()`), тестэд тогтмол өгнө.
 */
export function formatVisitDateMn(visitDate: string, today: string): string {
  const [y, m, d] = visitDate.split('-').map(Number) as [number, number, number];
  const weekday = WEEKDAYS_MN[new Date(Date.UTC(y, m - 1, d)).getUTCDay()] ?? '';
  const sameYear = today.slice(0, 4) === visitDate.slice(0, 4);
  const yearPart = sameYear ? '' : `${y} оны `;
  return `${yearPart}${m}-р сарын ${d}-нд (${weekday})`;
}

/* ------------------------------------------------------------------ */
/*  Мэдэгдлийн бичвэр                                                  */
/* ------------------------------------------------------------------ */

export interface VisitNoticeContext {
  projectName: string;
  /** `projects.location` — хоосон бол мөр орохгүй. */
  location: string | null;
  /** `project_passport.drawing_no` — хоосон бол мөр орохгүй. */
  shifr: string | null;
  visitDate: string;
  visitTime: string | null;
  note: string | null;
  /** Хамт явах бусад хүмүүсийн нэр (хүлээн авагчаас бусад). */
  companions: string[];
  /** Хуваарийг үүсгэсэн/зассан хүний нэр. */
  actorName: string | null;
  today: string;
}

export interface VisitNotice {
  title: string;
  body: string;
}

function detailLines(ctx: VisitNoticeContext): string[] {
  const lines: string[] = [];
  if (ctx.location?.trim()) lines.push(`Байршил: ${ctx.location.trim()}`);
  if (ctx.shifr?.trim()) lines.push(`Шифр: ${ctx.shifr.trim()}`);
  if (ctx.companions.length > 0) lines.push(`Хамт явах: ${ctx.companions.join(', ')}`);
  if (ctx.note?.trim()) lines.push(`Тэмдэглэл: ${ctx.note.trim()}`);
  if (ctx.actorName?.trim()) lines.push(`Томилсон: ${ctx.actorName.trim()}`);
  return lines;
}

/** «9-р сарын 25-нд (Пүрэв) 10:00 цагт» / «… (Пүрэв)». */
function whenPhrase(ctx: VisitNoticeContext): string {
  const date = formatVisitDateMn(ctx.visitDate, ctx.today);
  return ctx.visitTime ? `${date} ${ctx.visitTime} цагт` : date;
}

/**
 * Хуваарьт ШИНЭЭР орсон хүнд.
 *
 * Мэдэгдлийн биет НЭГ мөр (` · `-ээр зааглана): bell нь `line-clamp-2`,
 * жагсаалт нь энгийн div — шинэ мөр тэмдэгт хоёуланд нь харагдахгүй.
 */
export function buildAssignedNotice(ctx: VisitNoticeContext): VisitNotice {
  return {
    title: 'Зохиогчийн хяналтаар явна',
    body: [`${whenPhrase(ctx)} «${ctx.projectName}» төсөл дээр зохиогчийн хяналтаар явна.`, ...detailLines(ctx)].join(' · '),
  };
}

/** Огноо/цаг/төсөл/тэмдэглэл өөрчлөгдөхөд ХЭВЭЭР үлдсэн гишүүдэд. */
export function buildChangedNotice(ctx: VisitNoticeContext): VisitNotice {
  return {
    title: 'Зохиогчийн хяналтын хуваарь өөрчлөгдлөө',
    body: [`Шинэ хуваарь: ${whenPhrase(ctx)} «${ctx.projectName}» төсөл дээр зохиогчийн хяналтаар явна.`, ...detailLines(ctx)].join(' · '),
  };
}

/** Хуваарь цуцлагдсан, эсвэл хүн хуваариас хасагдсан. */
export function buildCancelledNotice(
  ctx: Pick<VisitNoticeContext, 'projectName' | 'visitDate' | 'visitTime' | 'today' | 'actorName'>,
  reason: 'cancelled' | 'removed',
): VisitNotice {
  const when = ctx.visitTime
    ? `${formatVisitDateMn(ctx.visitDate, ctx.today)} ${ctx.visitTime} цагт`
    : formatVisitDateMn(ctx.visitDate, ctx.today);
  const head =
    reason === 'cancelled'
      ? `${when} «${ctx.projectName}» төсөл дээрх зохиогчийн хяналтын хуваарь цуцлагдлаа.`
      : `${when} «${ctx.projectName}» төсөл дээрх зохиогчийн хяналтын хуваариас таныг хаслаа.`;
  const tail = ctx.actorName?.trim() ? ` · Хийсэн: ${ctx.actorName.trim()}` : '';
  return {
    title:
      reason === 'cancelled'
        ? 'Зохиогчийн хяналтын хуваарь цуцлагдлаа'
        : 'Зохиогчийн хяналтын хуваариас хасагдлаа',
    body: head + tail,
  };
}

/**
 * Хуучин ба шинэ гишүүдийн зөрүү + «мэдэгдэх ёстой өөрчлөлт» шийдвэр.
 * `changed` нь огноо/цаг/төсөл/тэмдэглэлийн аль нэг өөрчлөгдсөн эсэх.
 */
export function diffPlan(
  before: AsrVisitPlanInput,
  after: AsrVisitPlanInput,
): { added: number[]; removed: number[]; kept: number[]; changed: boolean } {
  const b = new Set(before.user_ids);
  const a = new Set(after.user_ids);
  const added = after.user_ids.filter((id) => !b.has(id));
  const removed = before.user_ids.filter((id) => !a.has(id));
  const kept = after.user_ids.filter((id) => b.has(id));
  const changed =
    before.project_id !== after.project_id ||
    before.visit_date !== after.visit_date ||
    (before.visit_time ?? null) !== (after.visit_time ?? null) ||
    (before.note ?? null) !== (after.note ?? null);
  return { added, removed, kept, changed };
}
