/**
 * Өдрийн ажлын тайлан (миграц 0345) — цэвэр дүрэм.  Импортгүй тул
 * `node --test`-д `registerHooks` шаардлагагүй.
 *
 * Мөр бүр нэг ажил.  Хэрэглэгч «1. …», «2) …», «- …» гэж бичиж болно —
 * дугаарыг ХАСААД хадгална (UI өөрөө 1. 2. 3. гэж дугаарлана), эс тэгвэл
 * засах бүрд «1. 1. …» болж давхарлана.
 */

/** Зөвхөн админ (= «Менежмент» баг, 2026-09-24-нд хэмжсэн: 9 админ бүгд MGMT). */
export const DAILY_LOG_ROLES = ['admin'] as const;

export const MAX_ITEMS = 50;
export const MAX_ITEM_LEN = 2000;
/** Үүнээс өмнөх огноо нь бараг үргэлж шивэх алдаа. */
export const MIN_LOG_DATE = '2020-01-01';

export type ItemsResult =
  | { ok: true; items: string[] }
  | { ok: false; error: string; code: 'EMPTY' | 'TOO_MANY' | 'TOO_LONG' | 'BAD_INPUT' };

/**
 * Мөрийн эхний дугаар / тэмдэг.  `(?!\d)` нь «3.5 м хана»-г дугаар гэж
 * таслахгүй, харин «1.Хурал» (зайгүй бичдэг хэв маяг)-ыг тасална.
 */
const LEADING_MARK = /^\s*(?:\d{1,3}[.)](?!\d)|[-*•·])\s*/u;

export function stripLeadingMark(line: string): string {
  return line.replace(LEADING_MARK, '').trim();
}

/**
 * Оролт: мөрийн массив ЭСВЭЛ олон мөрт бичвэр.  Хоосон мөр хасагдана.
 */
export function normalizeItems(input: unknown): ItemsResult {
  let lines: string[];
  if (typeof input === 'string') lines = input.split(/\r?\n/);
  else if (Array.isArray(input) && input.every((x) => typeof x === 'string')) {
    lines = (input as string[]).flatMap((x) => x.split(/\r?\n/));
  } else return { ok: false, error: 'Ажлын жагсаалт буруу хэлбэртэй', code: 'BAD_INPUT' };

  const items = lines.map(stripLeadingMark).filter((s) => s.length > 0);
  if (items.length === 0) {
    return { ok: false, error: 'Ядаж нэг ажил бичнэ үү', code: 'EMPTY' };
  }
  if (items.length > MAX_ITEMS) {
    return { ok: false, error: `Нэг өдөрт ${MAX_ITEMS}-аас ихгүй мөр`, code: 'TOO_MANY' };
  }
  if (items.some((s) => s.length > MAX_ITEM_LEN)) {
    return { ok: false, error: `Нэг мөр ${MAX_ITEM_LEN} тэмдэгтээс хэтэрч байна`, code: 'TOO_LONG' };
  }
  return { ok: true, items };
}

export function itemsEqual(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((s, i) => s === b[i]);
}

/** DB-ийн `items_json` — эвдэрсэн мөр ч хуудсыг унагахгүй. */
export function parseStoredItems(json: string | null | undefined): string[] {
  if (!json) return [];
  try {
    const v: unknown = JSON.parse(json);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Бодит хуанлийн огноо эсэх (2026-02-30 → false). */
export function isRealDate(s: string): boolean {
  const m = DATE_RE.exec(s);
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.toISOString().slice(0, 10) === s;
}

/** Бичиж болох огноо: бодит, `MIN_LOG_DATE`-ээс хойш, өнөөдрөөс хойш БИШ. */
export function checkLogDate(date: string, today: string): string | null {
  if (!isRealDate(date)) return 'Огноо буруу (YYYY-MM-DD)';
  if (date < MIN_LOG_DATE) return 'Огноо хэт эрт байна';
  if (date > today) return 'Ирээдүйн өдрийн тайлан бичих боломжгүй';
  return null;
}

/** `YYYY-MM` → тухайн сарын эхний ба сүүлийн өдөр.  Буруу бол null. */
export function monthBounds(ym: string): { from: string; to: string } | null {
  const m = /^(\d{4})-(\d{2})$/.exec(ym);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  if (mo < 1 || mo > 12) return null;
  const last = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  return { from: `${m[1]}-${m[2]}-01`, to: `${m[1]}-${m[2]}-${String(last).padStart(2, '0')}` };
}

/**
 * Жагсаалтын муж — календарь (7 хоног / сарын 6×7 тор = 42 өдөр) ба өөрийн
 * «Нэгтгэл» (сүүлийн 1 жил хүртэл).  Мөр нь өдөрт нэг тул 400 өдөр ч жижиг.
 */
export const MAX_RANGE_DAYS = 400;
/** Contribution heatmap — 53 долоо хоног (371) + нөөц. */
export const MAX_ACTIVITY_DAYS = 400;

/** `YYYY-MM-DD` ± n өдөр (UTC арифметик — УБ огноо тул цагийн бүс хамаарахгүй). */
export function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/**
 * `[from, to]` муж: хоёулаа бодит огноо, `from ≤ to`, урт (хоёр төгсгөл
 * багтсан) `maxDays`-аас хэтрэхгүй.  Буруу бол null.
 */
export function rangeBounds(
  from: string,
  to: string,
  maxDays: number,
): { from: string; to: string } | null {
  if (!isRealDate(from) || !isRealDate(to) || from > to) return null;
  const days = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000 + 1;
  return days <= maxDays ? { from, to } : null;
}

/** Тайлангийн өдрөөс ХОЙШ анх бичсэн бол «хожим нөхсөн». */
export function isLate(firstWrittenOn: string, logDate: string): boolean {
  return firstWrittenOn > logDate;
}
