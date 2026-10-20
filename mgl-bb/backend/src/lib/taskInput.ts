/**
 * `POST /api/tasks`-ийн биеийн ажиллах үеийн шалгалт (2026-10-15).  ЦЭВЭР — D1 уншихгүй.
 *
 * Урьд нь зөвхөн «байгаа эсэх» шалгадаг байсан тул мөр («50»), NaN, сөрөг жин, хязгааргүй урт нэр, «tomorrow» гэх огноо
 * шууд `tasks`-д ордог байв — managed root-ийн коэффициент NaN болж оноо эвдэрнэ.  Жингийн хил `PUT /:id`-ийн BAD_WEIGHT-тэй
 * ЯГ ижил; нэрийн хил `PUT /:id/name`-тэй ижил (≤ 200).
 */
export const TASK_NAME_MAX = 200;
export const TASK_WEIGHT_MAX = 100_000;

export interface NewTaskInput {
  component_id: number;
  name: string;
  weight_percent: number;
  due_date: string | null;
  start_date: string | null;
}

export type NewTaskValidation =
  | { ok: true; value: NewTaskInput }
  | { ok: false; code: 'BAD_BODY' | 'BAD_COMPONENT' | 'BAD_NAME' | 'BAD_WEIGHT' | 'BAD_DATE'; error: string };

/** «YYYY-MM-DD» бөгөөд хуанлийн бодит өдөр (2026-02-30 биш). */
export function isCalendarDate(v: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3]);
}

/** undefined / null / '' → null; хүчинтэй огноо → тэр; бусад → undefined (= алдаа). */
function optionalDate(v: unknown): string | null | undefined {
  if (v === undefined || v === null || v === '') return null;
  return typeof v === 'string' && isCalendarDate(v) ? v : undefined;
}

export function validateNewTask(raw: unknown): NewTaskValidation {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, code: 'BAD_BODY', error: 'JSON бие шаардлагатай' };
  }
  const b = raw as Record<string, unknown>;

  const comp = b.component_id;
  if (typeof comp !== 'number' || !Number.isSafeInteger(comp) || comp <= 0) {
    return { ok: false, code: 'BAD_COMPONENT', error: 'component_id нь эерэг бүхэл тоо байх ёстой' };
  }

  const name = typeof b.name === 'string' ? b.name.trim() : '';
  if (!name) return { ok: false, code: 'BAD_NAME', error: 'Ажлын нэр шаардлагатай' };
  if (name.length > TASK_NAME_MAX) {
    return { ok: false, code: 'BAD_NAME', error: `Ажлын нэр ${TASK_NAME_MAX} тэмдэгтээс ихгүй` };
  }

  const w = b.weight_percent;
  if (typeof w !== 'number' || !Number.isFinite(w) || w < 0 || w > TASK_WEIGHT_MAX) {
    return { ok: false, code: 'BAD_WEIGHT', error: 'weight_percent must be a finite number >= 0' };
  }

  const due = optionalDate(b.due_date);
  const start = optionalDate(b.start_date);
  if (due === undefined || start === undefined) {
    return { ok: false, code: 'BAD_DATE', error: 'Огноо YYYY-MM-DD хэлбэртэй байх ёстой' };
  }
  if (due && start && start > due) {
    return { ok: false, code: 'BAD_DATE', error: 'Эхлэх огноо дуусах огнооноос хойш байж болохгүй' };
  }

  return { ok: true, value: { component_id: comp, name, weight_percent: w, due_date: due, start_date: start } };
}
