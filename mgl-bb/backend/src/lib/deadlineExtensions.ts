/**
 * Төслийн дуусах хугацааны СУНГАЛТ ба ТҮҮХ — дүрмийн ЦОРЫН ГАНЦ газар
 * (migration 0337, `project_deadline_changes`).
 *
 * ЗАГВАР:
 *   • `project_passport.finish_date` нь ХЭВЭЭР «одоо хүчинтэй дуусах хугацаа».
 *     Хугацаа хэтэрсэн (`lib/projectRisk.ts`), Timeline, график, компанийн
 *     тойм, MCP, захиалагчийн PDF — тэр баганыг уншдаг 30 гаруй газар юу ч
 *     өөрчлөгдөхгүй: сунгасан даруйд шинэ хугацаа бүгдэд автоматаар хүрнэ.
 *   • Өөрчлөлт бүр `project_deadline_changes`-д мөр болж үлдэнэ:
 *       `extension`  — «Хугацаа сунгах» (батлагч + шалтгаан заавал, `seq` = хэд дэх).
 *       `correction` — «Хуваарь» цонх / паспортын 1.3-аар зассан (батлагчгүй).
 *     Анхны хугацаа = эхний сунгалтын `from_date`; сунгалтгүй бол `finish_date`.
 *   • ХОЙШЛУУЛАХ нь зөвхөн сунгалтаар: `isLaterThan(next, current)` үнэн бол
 *     хуучин хоёр бичих зам 409 `EXTENSION_REQUIRED` буцаана (`change_kind:
 *     'correction'` тугтай бол зөвшөөрч, correction гэж бүртгэнэ — буруу бичсэн
 *     огноог залруулах зам).
 *
 * Энэ модуль DB-гүй цэвэр функцүүд + нэг INSERT туслах (`recordDeadlineChange`).
 * Routes-оос юу ч импортлохгүй (`routes/projects.ts` ба `routes/timeline.ts`
 * хоёулаа эндээс импортолдог тул тойрог үүсгэж болохгүй).
 */
import { diffDays, isIsoDate } from './projectRisk';
import {
  TL_EXT_PREFIX,
  TL_FINISH_ID,
  defaultTimelineRows,
  type PassportTimelineRow,
  type TimelineRowLike,
} from './passportTimeline';

/* ------------------------------------------------------------------ */
/*  Төрлүүд                                                            */
/* ------------------------------------------------------------------ */

export const APPROVED_BY_KINDS = ['client', 'director', 'other'] as const;
export type ApprovedByKind = (typeof APPROVED_BY_KINDS)[number];

export type DeadlineChangeKind = 'extension' | 'correction';

/** `project_deadline_changes`-ийн нэг мөр (+ `users` JOIN-ийн нэр). */
export interface DeadlineChangeRow {
  id: number;
  project_id: number;
  kind: DeadlineChangeKind;
  seq: number | null;
  from_date: string | null;
  to_date: string | null;
  days: number | null;
  reason: string | null;
  approved_by_kind: ApprovedByKind | null;
  approved_by_name: string | null;
  approved_on: string | null;
  reference_no: string | null;
  note: string | null;
  created_by: number | null;
  created_at: string;
  created_by_name?: string | null;
}

/** `POST …/extensions`-ийн шалгагдсан бие. */
export interface ExtensionInput {
  new_finish_date: string;
  reason: string;
  approved_by_kind: ApprovedByKind;
  approved_by_name: string | null;
  approved_on: string;
  reference_no: string | null;
  note: string | null;
}

export const REASON_MAX = 1000;
export const NAME_MAX = 200;
export const REF_MAX = 200;
export const NOTE_MAX = 1000;

/* ------------------------------------------------------------------ */
/*  Огноо                                                              */
/* ------------------------------------------------------------------ */

/** Паспортын огооны багана нь баталгаажаагүй чөлөөт текст — продакшнд
 *  `2026.07.09` хэлбэр бодитоор байдаг (frontend `passportSections.ts`-ийн
 *  `toIsoDate`-ийн ихэр).  ISO болгож чадвал буцаана, эс бөгөөс null. */
export function toIsoDateLoose(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  if (isIsoDate(s)) return s;
  const m = /^(\d{4})[./](\d{1,2})[./](\d{1,2})$/.exec(s);
  if (!m) return null;
  const iso = `${m[1]}-${m[2]!.padStart(2, '0')}-${m[3]!.padStart(2, '0')}`;
  return isIsoDate(iso) ? iso : null;
}
// EXPECT: toIsoDateLoose('2026.07.09') === '2026-07-09'
// EXPECT: toIsoDateLoose('2026-07-09') === '2026-07-09'
// EXPECT: toIsoDateLoose('-') === null && toIsoDateLoose(null) === null

/** `next` нь `current`-аас ХОЙШ уу — хоёулаа ISO байх үед л үнэн.  Хуучин
 *  хугацаа огт байхгүй / уншигдахгүй бол «хойшлуулах» гэсэн ойлголт
 *  байхгүй (анх тогтоох нь сунгалт биш). */
export function isLaterThan(next: string | null | undefined, current: string | null | undefined): boolean {
  const n = toIsoDateLoose(next);
  const c = toIsoDateLoose(current);
  return n !== null && c !== null && n > c;
}
// EXPECT: isLaterThan('2026-09-30', '2026-07-09') === true
// EXPECT: isLaterThan('2026-07-01', '2026-07-09') === false
// EXPECT: isLaterThan('2026-09-30', null) === false
// EXPECT: isLaterThan('2026-09-30', '2026.07.09') === true   (чөлөөт текст ч уншигдана)

/** `to − from` хуанлийн хоногоор; аль нэг нь уншигдахгүй бол null. */
export function extensionDays(from: string | null | undefined, to: string | null | undefined): number | null {
  const f = toIsoDateLoose(from);
  const t = toIsoDateLoose(to);
  if (!f || !t) return null;
  return diffDays(f, t);
}
// EXPECT: extensionDays('2026-07-09', '2026-09-30') === 83
// EXPECT: extensionDays(null, '2026-09-30') === null

/* ------------------------------------------------------------------ */
/*  Оролтын шалгалт                                                    */
/* ------------------------------------------------------------------ */

function str(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  if (!s) return null;
  return s.length > max ? s.slice(0, max) : s;
}

export type ExtensionValidation =
  | { ok: true; value: ExtensionInput }
  | { ok: false; error: string; code: 'NO_CURRENT_DEADLINE' | 'INVALID_DATE' | 'NOT_LATER' | 'INVALID_INPUT' };

/**
 * `POST …/extensions`-ийн биеийг шалгана.  ЗААВАЛ: шинэ огноо (ISO, одоогийн
 * хугацаанаас ХОЙШ), батлагчийн төрөл, шалтгаан.  Батлагчийн нэр нь
 * `other` төрөлд заавал (хэн гэдэг нь бусад төрлөөс өөрөө гардаггүй).
 * `approved_on` өгөөгүй бол өнөөдөр.
 *
 * `currentFinish` уншигдахгүй (null / '-') бол сунгалт БОЛОМЖГҮЙ — эхлээд
 * «Хуваарь»-аар хугацаа тогтооно.  Анхны тогтоолт нь сунгалт биш.
 */
export function validateExtensionInput(
  body: unknown,
  currentFinish: string | null | undefined,
  todayIso: string,
): ExtensionValidation {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const current = toIsoDateLoose(currentFinish);
  if (!current) {
    return {
      ok: false,
      code: 'NO_CURRENT_DEADLINE',
      error: 'Сунгахын өмнө төслийн дуусах хугацааг тогтоосон байх ёстой («Хуваарь»).',
    };
  }
  const next = str(b.new_finish_date, 32);
  if (!next || !isIsoDate(next)) {
    return { ok: false, code: 'INVALID_DATE', error: 'Шинэ дуусах огноо буруу форматтай (YYYY-MM-DD).' };
  }
  if (next <= current) {
    return {
      ok: false,
      code: 'NOT_LATER',
      error: `Сунгалтын огноо одоогийн хугацаанаас (${current}) хойш байх ёстой. Урагшлуулах бол «Хуваарь»-аар засна.`,
    };
  }
  const kindRaw = str(b.approved_by_kind, 32);
  if (!kindRaw || !(APPROVED_BY_KINDS as readonly string[]).includes(kindRaw)) {
    return { ok: false, code: 'INVALID_INPUT', error: 'Хэн зөвшөөрснийг сонгоно уу (захиалагч / захирал / бусад).' };
  }
  const approved_by_kind = kindRaw as ApprovedByKind;
  const approved_by_name = str(b.approved_by_name, NAME_MAX);
  if (approved_by_kind === 'other' && !approved_by_name) {
    return { ok: false, code: 'INVALID_INPUT', error: 'Зөвшөөрсөн хүн / эх сурвалжийн нэрийг бичнэ үү.' };
  }
  const reason = str(b.reason, REASON_MAX);
  if (!reason) {
    return { ok: false, code: 'INVALID_INPUT', error: 'Сунгалтын шалтгааныг бичнэ үү.' };
  }
  const approvedRaw = str(b.approved_on, 32);
  let approved_on = todayIso;
  if (approvedRaw) {
    if (!isIsoDate(approvedRaw)) {
      return { ok: false, code: 'INVALID_DATE', error: 'Зөвшөөрлийн огноо буруу форматтай (YYYY-MM-DD).' };
    }
    approved_on = approvedRaw;
  }
  return {
    ok: true,
    value: {
      new_finish_date: next,
      reason,
      approved_by_kind,
      approved_by_name,
      approved_on,
      reference_no: str(b.reference_no, REF_MAX),
      note: str(b.note, NOTE_MAX),
    },
  };
}

/* ------------------------------------------------------------------ */
/*  Түүхийн хураангуй                                                  */
/* ------------------------------------------------------------------ */

export interface DeadlineSummary {
  /** Хүчинтэй (одоогийн) дуусах хугацаа — ISO эсвэл null. */
  current_finish_date: string | null;
  /** Анхны хугацаа: эхний сунгалтын `from_date`; сунгалтгүй бол одоогийнх. */
  original_finish_date: string | null;
  extension_count: number;
  /** Бүх сунгалтын хоногийн нийлбэр (уншигдсан мөрүүд л). */
  total_extended_days: number;
  /** Сүүлийн сунгалт (байвал). */
  last_extension: DeadlineChangeRow | null;
}

/** Мөрүүд `id` (= цаг хугацааны) дарааллаар ирнэ гэж үзнэ. */
export function summarizeDeadlineChanges(
  rows: readonly DeadlineChangeRow[],
  currentFinish: string | null | undefined,
): DeadlineSummary {
  const current = toIsoDateLoose(currentFinish);
  const extensions = rows.filter((r) => r.kind === 'extension');
  const first = extensions[0] ?? null;
  const last = extensions[extensions.length - 1] ?? null;
  const total = extensions.reduce((acc, r) => acc + (typeof r.days === 'number' ? r.days : 0), 0);
  return {
    current_finish_date: current,
    original_finish_date: first ? (toIsoDateLoose(first.from_date) ?? first.from_date ?? null) : current,
    extension_count: extensions.length,
    total_extended_days: total,
    last_extension: last,
  };
}
// EXPECT: summarizeDeadlineChanges([], '2026-07-09') → { original_finish_date:'2026-07-09', extension_count:0, total_extended_days:0 }

/* ------------------------------------------------------------------ */
/*  Паспортын 1.3 хүснэгт                                              */
/* ------------------------------------------------------------------ */

/** `tl-ext`-ийн угтвартай мөр үү. */
function isExtRow(r: TimelineRowLike): boolean {
  return r.id.startsWith(TL_EXT_PREFIX);
}

function extRowId(rows: readonly TimelineRowLike[]): string {
  let n = 2;
  const ids = new Set(rows.map((r) => r.id));
  while (ids.has(`${TL_EXT_PREFIX}-${n}`)) n += 1;
  return `${TL_EXT_PREFIX}-${n}`;
}

function canonExt(): PassportTimelineRow {
  const c = defaultTimelineRows().find((r) => r.id === TL_EXT_PREFIX);
  return c ? { ...c } : { id: TL_EXT_PREFIX, labelEn: 'Extension', labelMn: 'Сунгалт', date: '' };
}

/**
 * Сунгалтыг 1.3 хүснэгтэд буулгана.
 *
 *   • `tl-finish` := шинэ огноо — багана ↔ мөрийн инвариант ХЭВЭЭР
 *     (`columnsFromTimelineRows` дараагийн паспорт хадгалалтад `finish_date`-ыг
 *     ЭНЭ мөрөөс уншдаг; хуучин огноо үлдээвэл сунгалт чимээгүй буцна).
 *   • Сунгалтын мөр: ОГНООГҮЙ эхний `tl-ext*` мөр байвал түүнд, эс бөгөөс
 *     ШИНЭ мөр нэмнэ («жишиг баримт дээр Extension мөр ХОЁР» — сунгалт бүр
 *     өөрийн мөртэй).  Сүүлийн сунгалтын мөр аль хэдийн ижил огноотой бол
 *     давхардуулахгүй.
 *   • Хүснэгт огт байхгүй бол `defaultTimelineRows()`-оос үүсгэнэ
 *     (`seed`-ээр эхлэх огноог нөхнө) — id/шошго нь «Мэдээлэл» табтай ЯГ ижил.
 */
export function applyExtensionToTimelineRows(
  rows: readonly TimelineRowLike[],
  toDate: string,
  seed?: { start_date?: string | null; finish_date?: string | null },
): PassportTimelineRow[] {
  const created = rows.length === 0;
  const next: PassportTimelineRow[] = created ? defaultTimelineRows() : rows.map((r) => ({ ...r }));
  if (created && seed) {
    const at = next.findIndex((r) => r.id === 'tl-start');
    const cur = next[at];
    if (cur) next[at] = { ...cur, date: seed.start_date ?? '' };
  }

  const finishAt = next.findIndex((r) => r.id === TL_FINISH_ID);
  if (finishAt !== -1) {
    const cur = next[finishAt]!;
    next[finishAt] = { ...cur, date: toDate };
  } else {
    // Канон мөр алга (хуучин `tl-1` id-тай хүснэгт) — байрлал 1, гэхдээ
    // сунгалтын мөрийг дарж бичихгүй (passportTimeline.ts-ийн дүрэм).
    const atPos = next[1];
    if (atPos && !isExtRow(atPos)) next[1] = { ...atPos, date: toDate };
    else next.splice(Math.min(1, next.length), 0, { ...canonExt(), id: TL_FINISH_ID, labelEn: 'Finish', labelMn: 'Дуусах', date: toDate });
  }

  const extRows = next.map((r, i) => ({ r, i })).filter(({ r }) => isExtRow(r));
  const dated = extRows.filter(({ r }) => r.date);
  const lastDated = dated[dated.length - 1];
  if (lastDated && lastDated.r.date === toDate) return next;
  const empty = extRows.find(({ r }) => !r.date);
  if (empty) {
    next[empty.i] = { ...empty.r, date: toDate };
    return next;
  }
  next.push({ ...canonExt(), id: extRowId(next), date: toDate });
  return next;
}

/**
 * Сүүлийн сунгалтыг БУЦААНА (`DELETE …/extensions/:id`): `tl-finish` :=
 * өмнөх огноо, `toDate`-той сүүлийн сунгалтын мөрийг устгана — гэхдээ
 * канон `tl-ext` мөр ганцаараа бол устгахгүй, ХООСЛОНО (Мэдээлэл таб 3
 * мөртэй байхыг хүлээдэг).  Хүснэгт хоосон бол хоосон хэвээр.
 */
export function revertExtensionInTimelineRows(
  rows: readonly TimelineRowLike[],
  fromDate: string | null,
  toDate: string,
): PassportTimelineRow[] {
  if (rows.length === 0) return [];
  const next: PassportTimelineRow[] = rows.map((r) => ({ ...r }));
  const finishAt = next.findIndex((r) => r.id === TL_FINISH_ID);
  if (finishAt !== -1) next[finishAt] = { ...next[finishAt]!, date: fromDate ?? '' };

  for (let i = next.length - 1; i >= 0; i -= 1) {
    const r = next[i]!;
    if (!isExtRow(r) || r.date !== toDate) continue;
    const extCount = next.filter(isExtRow).length;
    if (extCount > 1) next.splice(i, 1);
    else next[i] = { ...r, date: '' };
    break;
  }
  return next;
}

/* ------------------------------------------------------------------ */
/*  Түүхийн мөр бичих (routes/timeline.ts, routes/projects.ts, сунгалт)  */
/* ------------------------------------------------------------------ */

export interface DeadlineChangeInsert {
  project_id: number;
  kind: DeadlineChangeKind;
  seq?: number | null;
  from_date: string | null;
  to_date: string | null;
  reason?: string | null;
  approved_by_kind?: ApprovedByKind | null;
  approved_by_name?: string | null;
  approved_on?: string | null;
  reference_no?: string | null;
  note?: string | null;
  created_by: number | null;
}

/** INSERT statement — дуудагч `run()` эсвэл `batch()`-д хийнэ.  `days`
 *  энд бодогдоно (хоёр огноо ISO/чөлөөт ISO-той бол). */
export function deadlineChangeInsert(db: D1Database, ins: DeadlineChangeInsert): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO project_deadline_changes
         (project_id, kind, seq, from_date, to_date, days, reason,
          approved_by_kind, approved_by_name, approved_on, reference_no, note, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      ins.project_id,
      ins.kind,
      ins.seq ?? null,
      ins.from_date,
      ins.to_date,
      extensionDays(ins.from_date, ins.to_date),
      ins.reason ?? null,
      ins.approved_by_kind ?? null,
      ins.approved_by_name ?? null,
      ins.approved_on ?? null,
      ins.reference_no ?? null,
      ins.note ?? null,
      ins.created_by,
    );
}

/**
 * «Хуваарь» цонх / паспортын 1.3 хүснэгтээр `finish_date` ӨӨРЧЛӨГДСӨН үед
 * `correction` мөр бичнэ.  Утга ижил бол юу ч хийхгүй (паспорт бүр хадгалахад
 * дуудагддаг тул давхардал үүсэхгүй).  Алдаа залгина — түүх бичигдэхгүй нь
 * үндсэн үйлдлийг унагаах шалтгаан биш.
 */
export async function recordDeadlineCorrection(
  db: D1Database,
  args: { project_id: number; from_date: string | null; to_date: string | null; created_by: number | null; note?: string | null },
): Promise<boolean> {
  const from = args.from_date ?? null;
  const to = args.to_date ?? null;
  if ((from ?? '') === (to ?? '')) return false;
  try {
    await deadlineChangeInsert(db, {
      project_id: args.project_id,
      kind: 'correction',
      from_date: from,
      to_date: to,
      note: args.note ?? null,
      created_by: args.created_by,
    }).run();
    return true;
  } catch (e) {
    console.error('[deadline] correction log failed', e);
    return false;
  }
}

/** Хойшлуулах өөрчлөлтийг хуучин бичих замуудаас хаах 409-ийн бие — хоёр
 *  route ижил мөр буцаана. */
export function extensionRequiredBody(currentFinish: string | null | undefined): {
  error: string;
  code: 'EXTENSION_REQUIRED';
  current_finish_date: string | null;
} {
  return {
    error:
      'Дуусах хугацааг хойшлуулахын тулд «Хугацаа сунгах»-аар бүртгэнэ (хэн зөвшөөрсөн, шалтгаан). Буруу бичсэн огноог залруулах бол «Засвар» гэж тэмдэглэнэ.',
    code: 'EXTENSION_REQUIRED',
    current_finish_date: toIsoDateLoose(currentFinish),
  };
}
