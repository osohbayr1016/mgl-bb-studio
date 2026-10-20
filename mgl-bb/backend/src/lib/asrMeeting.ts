/**
 * Зохиогчийн хяналт — «Оффис уулзалт» төрлийн маягт (миграц 0367, эзний
 * хүсэлт 2026-09-30).  Цэвэр дүрэм; D1 уншдаггүй.
 *
 * Оффис уулзалтын тайлан нь талбайн хяналтын маягтаас ӨӨР хэлбэртэй:
 *   • «Тайлбар», «Бичиг баримтын төрөл» мөр гарахгүй — оронд нь уулзалтын
 *     мэдээлэл (Уулзах газар, Цаг, Оролцогч тал, Уулзалтын зорилго);
 *   • «Хяналтаар явсан» → «Оролцсон»: БҮХ ажилтнаас сонгоно (талбайн
 *     хяналтын «хамт явсан» нь зөвхөн өөрийн багаас) — хадгалалт нь ижил
 *     `asr_report_companions` (харагдац, «хэн хэзээ явсан» самбар автоматаар);
 *   • «Ажлын тайлан» → «Уулзалтын агуулга»: ганц чөлөөт бичвэр
 *     (`work_report`), асуултгүй;
 *   • гарын үсгийн хоёр дахь мөр «Талбайн инженер» → «Захиалагч тал»;
 *   • улаан дэвтэр огт шаардахгүй (`requiresRedBook` аль хэдийн site-only),
 *     хавсралт зураг ЯГ НЭГ (UI-ийн хязгаар — төрөл солиход хуучин зураг
 *     устахгүй тул сервер хаадаггүй).
 *
 * ⚠️ ИХЭР: frontend `features/projects/asr/types.ts` `usesMeetingForm` +
 *    `ASR_MEETING_*`.  Төрлийг нэмэх / хасахдаа хоёуланг нь өөрчил.
 */
import type { AsrReportType } from './asrReportType';
import { isSingleSegmentMediaUrl } from './mediaUrl';

/** Уулзалтын маягттай төрлүүд — одоогоор зөвхөн «Оффис уулзалт». */
export function usesMeetingForm(type: AsrReportType): boolean {
  return type === 'office';
}

/**
 * Оффис уулзалтын оролцогчийн дээд тоо.  Талбайн «хамт явсан»-ы 8 нь
 * талбайд явсан багийнханд зориулагдсан; уулзалтад илүү олон хүн суудаг.
 */
export const MAX_MEETING_PARTICIPANTS = 40;

/** Уулзах газрын урт. */
export const MEETING_PLACE_MAX = 300;
/** Оролцогч тал, зорилгын урт. */
export const MEETING_TEXT_MAX = 4000;

export const MEETING_TEXT_COLUMNS = ['meeting_place', 'meeting_parties', 'meeting_purpose'] as const;
export const MEETING_TIME_COLUMNS = ['meeting_start', 'meeting_end'] as const;

export type MeetingColumn =
  | (typeof MEETING_TEXT_COLUMNS)[number]
  | (typeof MEETING_TIME_COLUMNS)[number];

/**
 * «HH:MM» цаг.  Хоосон / null → null (цэвэрлэх); «9:05» → «09:05»;
 * бусад хэлбэр → `false` (400).  Секундтэй «13:00:00» (хөтчийн time input
 * step-ээр) — минут хүртэл тайрна.
 */
export function normMeetingTime(v: unknown): string | null | false {
  if (v == null) return null;
  if (typeof v !== 'string') return false;
  const s = v.trim();
  if (!s) return null;
  const m = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(s);
  if (!m) return false;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return false;
  return `${String(h).padStart(2, '0')}:${m[2]}`;
}

function normText(v: unknown, max: number): string | null | false {
  if (v == null) return null;
  if (typeof v !== 'string') return false;
  const s = v.trim();
  return s ? s.slice(0, max) : null;
}

/* ------------------------------------------------------------------ */
/*  Хүсэлтийн хүснэгтүүд (0396): 0.1 Захиалагч · 0.2 Гүйцэтгэгч          */
/* ------------------------------------------------------------------ */

/**
 * ⚠️ ИХЭР: frontend `features/projects/asr/meetingDoc.ts`
 *    `MeetingRequests` / `emptyMeetingRequests` / `meetingRequestSections`.
 */
export const MEETING_REQUEST_SIDES = ['client', 'contractor'] as const;
export type MeetingRequestSide = (typeof MEETING_REQUEST_SIDES)[number];
/**
 * Хүснэгтийн нэг мөр — бичвэр + сонголттой зураг (эзэн 2026-10-12: «бичсэн зүйл
 * бүрийнхээ ард зураг оруулж болох»).  Зураг = нийтийн `/media/<key>` URL
 * (тайлангийн хавсралт зурагтай ижил байршуулалт).  ⚠️ 0396-гийн хуучин мөр нь
 * ТҮҮХИЙ бичвэр (`string`) — уншихдаа `{text, images: []}` болгоно.
 */
export interface MeetingRequestItem {
  text: string;
  images: string[];
}
export interface MeetingRequestSection {
  intro: string;
  items: MeetingRequestItem[];
}
export type MeetingRequests = Record<MeetingRequestSide, MeetingRequestSection>;

/** Хүснэгт бүрийн мөрийн дээд тоо. */
export const MEETING_REQUEST_MAX_ITEMS = 60;
/** Нэг мөр / оршлын урт. */
export const MEETING_REQUEST_TEXT_MAX = 2000;
/** Нэг мөрийн / «Тайлбар»-ын зургийн дээд тоо. */
export const MEETING_ITEM_MAX_IMAGES = 6;

/** Зургийн жагсаалт: `/media/<key>` л, давхардалгүй, ≤ дээд тоо.  Буруу бол `false`. */
function sanitizeImages(v: unknown): string[] | false {
  if (v == null) return [];
  if (!Array.isArray(v) || v.length > MEETING_ITEM_MAX_IMAGES) return false;
  const out: string[] = [];
  for (const u of v) {
    if (!isSingleSegmentMediaUrl(u)) return false;
    if (!out.includes(u)) out.push(u);
  }
  return out;
}

/** Нэг мөр: хуучин бичвэр мөр эсвэл `{text, images}`. */
function sanitizeItem(v: unknown): MeetingRequestItem | false {
  if (typeof v === 'string') return { text: v.slice(0, MEETING_REQUEST_TEXT_MAX), images: [] };
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
  const { text, images } = v as { text?: unknown; images?: unknown };
  if (text != null && typeof text !== 'string') return false;
  const imgs = sanitizeImages(images);
  if (imgs === false) return false;
  return { text: (text ?? '').slice(0, MEETING_REQUEST_TEXT_MAX), images: imgs };
}

const emptySection = (): MeetingRequestSection => ({ intro: '', items: [] });

/**
 * PATCH-аар ирсэн утга → хадгалах JSON (эсвэл NULL = хоосон).
 *
 * Хоосон мөрүүдийг ХАЯХГҮЙ: засварлагч «Мөр нэмэх» дарсны дараа autosave
 * явахад мөр хадгалагдах ёстой (хэвлэлт хоосон мөрийг өөрөө алгасна).
 * Мөрийн доторх зай хэвээр — хэрэглэгч бичиж байх үед таслахгүй.
 */
export function sanitizeMeetingRequests(
  v: unknown,
): { ok: true; json: string | null } | { ok: false; error: string } {
  if (v == null) return { ok: true, json: null };
  if (typeof v !== 'object' || Array.isArray(v)) {
    return { ok: false, error: 'Уулзалтын хүсэлтийн хүснэгт буруу байна.' };
  }
  const out: MeetingRequests = { client: emptySection(), contractor: emptySection() };
  for (const side of MEETING_REQUEST_SIDES) {
    const raw = (v as Record<string, unknown>)[side];
    if (raw == null) continue;
    if (typeof raw !== 'object' || Array.isArray(raw)) {
      return { ok: false, error: 'Уулзалтын хүсэлтийн хүснэгт буруу байна.' };
    }
    const { intro, items } = raw as { intro?: unknown; items?: unknown };
    if (intro != null && typeof intro !== 'string') {
      return { ok: false, error: 'Уулзалтын хүсэлтийн хүснэгт буруу байна.' };
    }
    if (items != null && !Array.isArray(items)) {
      return { ok: false, error: 'Уулзалтын хүсэлтийн хүснэгт буруу байна.' };
    }
    const list = (items ?? []) as unknown[];
    if (list.length > MEETING_REQUEST_MAX_ITEMS) {
      return { ok: false, error: `Хүснэгтэд ${MEETING_REQUEST_MAX_ITEMS}-аас олон мөр байж болохгүй.` };
    }
    const parsed = list.map(sanitizeItem);
    if (parsed.some((x) => x === false)) {
      return { ok: false, error: 'Уулзалтын хүсэлтийн хүснэгт буруу байна (зураг эсвэл бичвэр).' };
    }
    out[side] = {
      intro: (intro ?? '').slice(0, MEETING_REQUEST_TEXT_MAX),
      items: parsed as MeetingRequestItem[],
    };
  }
  // ⚠️ Хоосон хүснэгтийг ч хадгална: засварлагч анхнаасаа 1 хоосон мөртэй нээгддэг
  //    тул хэрэглэгч тэр мөрийг устгасныг NULL болгож мартвал дахин нээхэд мөр буцаж гарна.
  return { ok: true, json: JSON.stringify(out) };
}

/** Хадгалсан JSON → бүтэц.  Эвдэрсэн / NULL → хоосон (хэзээ ч throw хийхгүй). */
export function parseMeetingRequests(json: string | null | undefined): MeetingRequests {
  const out: MeetingRequests = { client: emptySection(), contractor: emptySection() };
  if (!json) return out;
  try {
    const r = sanitizeMeetingRequests(JSON.parse(json));
    if (r.ok && r.json) return JSON.parse(r.json) as MeetingRequests;
  } catch {
    /* эвдэрсэн мөр — хоосон */
  }
  return out;
}

/** Илгээх шалгалтад: аль нэг хүснэгтэд бичвэртэй мөр (эсвэл оршил) байна уу. */
export function hasMeetingRequests(json: string | null | undefined): boolean {
  const r = parseMeetingRequests(json);
  return MEETING_REQUEST_SIDES.some(
    (s) => !!r[s].intro.trim() || r[s].items.some((x) => !!x.text.trim() || x.images.length > 0),
  );
}

/**
 * PATCH биетээс уулзалтын баганууд.  Ирээгүй талбар хөндөгдөхгүй (хуучин
 * клиент эдгээрийг илгээдэггүй).  Буруу хэлбэр → `{ ok: false }`.
 */
export function meetingPatch(
  body: Partial<Record<MeetingColumn, unknown>>,
): { ok: true; cols: [MeetingColumn, string | null][] } | { ok: false; error: string } {
  const cols: [MeetingColumn, string | null][] = [];
  for (const col of MEETING_TIME_COLUMNS) {
    if (body[col] === undefined) continue;
    const v = normMeetingTime(body[col]);
    if (v === false) return { ok: false, error: 'Уулзалтын цаг «ЦЦ:ММ» хэлбэртэй байна.' };
    cols.push([col, v]);
  }
  for (const col of MEETING_TEXT_COLUMNS) {
    if (body[col] === undefined) continue;
    const v = normText(body[col], col === 'meeting_place' ? MEETING_PLACE_MAX : MEETING_TEXT_MAX);
    if (v === false) return { ok: false, error: 'Уулзалтын мэдээлэл буруу байна.' };
    cols.push([col, v]);
  }
  return { ok: true, cols };
}

/* ------------------------------------------------------------------ */
/*  0398 — баримтын нэмэлт: «Оролцогч тал»-ын засварласан мөр, хөлийн   */
/*  захиалагч талын байгууллага / албан тушаал                         */
/* ------------------------------------------------------------------ */

/**
 * ⚠️ ИХЭР: frontend `features/projects/asr/meetingDoc.ts` `MeetingDocExtra`.
 */
export interface MeetingDocExtra {
  party_lines: Record<string, string>;
  client_org: string;
  client_position: string;
  /** «Тайлбар» (`work_report`)-ын ард хавсаргасан зураг (`/media/<key>`). */
  note_images: string[];
}

export const MEETING_DOC_LINE_MAX = 500;
export const MEETING_DOC_MAX_LINES = 60;

export function sanitizeMeetingDoc(
  v: unknown,
): { ok: true; json: string | null } | { ok: false; error: string } {
  if (v == null) return { ok: true, json: null };
  const bad = { ok: false as const, error: 'Уулзалтын баримтын мэдээлэл буруу байна.' };
  if (typeof v !== 'object' || Array.isArray(v)) return bad;
  const { party_lines, client_org, client_position, note_images } = v as Record<string, unknown>;
  const noteImages = sanitizeImages(note_images);
  if (noteImages === false) return bad;
  const lines: Record<string, string> = {};
  if (party_lines != null) {
    if (typeof party_lines !== 'object' || Array.isArray(party_lines)) return bad;
    const entries = Object.entries(party_lines as Record<string, unknown>);
    if (entries.length > MEETING_DOC_MAX_LINES) return bad;
    for (const [k, val] of entries) {
      if (!/^\d{1,9}$/.test(k) || typeof val !== 'string') return bad;
      lines[k] = val.slice(0, MEETING_DOC_LINE_MAX);
    }
  }
  for (const x of [client_org, client_position]) {
    if (x != null && typeof x !== 'string') return bad;
  }
  const out: MeetingDocExtra = {
    party_lines: lines,
    client_org: ((client_org as string | null | undefined) ?? '').slice(0, MEETING_DOC_LINE_MAX),
    client_position: ((client_position as string | null | undefined) ?? '').slice(
      0,
      MEETING_DOC_LINE_MAX,
    ),
    note_images: noteImages,
  };
  const empty =
    Object.keys(out.party_lines).length === 0 &&
    !out.client_org.trim() &&
    !out.client_position.trim() &&
    out.note_images.length === 0;
  return { ok: true, json: empty ? null : JSON.stringify(out) };
}

export function parseMeetingDoc(json: string | null | undefined): MeetingDocExtra {
  const empty: MeetingDocExtra = {
    party_lines: {},
    client_org: '',
    client_position: '',
    note_images: [],
  };
  if (!json) return empty;
  try {
    const r = sanitizeMeetingDoc(JSON.parse(json));
    if (r.ok && r.json) return JSON.parse(r.json) as MeetingDocExtra;
  } catch {
    /* эвдэрсэн мөр — хоосон */
  }
  return empty;
}
