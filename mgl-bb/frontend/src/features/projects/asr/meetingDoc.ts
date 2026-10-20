import { brand } from '@/shared/config/brand';
import { formatStaffShortName } from '@/shared/lib/staffName';
import type { AsrReport } from './types';

/**
 * «Оффис уулзалт»-ын баримтын ХАТУУ монгол шошгууд (миграц 0367, эзний
 * хүсэлт 2026-09-30).  Засварлагч (`AsrEditor`), хэвлэх/PDF (`AsrDocument`),
 * Word (`buildAsrDocx`) гурвуулаа эндээс уншина — нэг газар солиход гурвуулаа
 * дагана.  Баримт хэлээр хувирдаггүй (`AsrDocument.tsx`-ийн зарчим).
 *
 * Мөрүүд нь эзний Word уулзалтын тэмдэглэлийн хүснэгтийн (Өдөр · Цаг · Уулзах
 * газар · Оролцогч тал · Уулзалтын зорилго) хэлбэр.  «Өдөр» нь маягтын эхний
 * мөрийн «Он сар өдөр» — давхардуулахгүй.
 */
export const MEETING_LABEL = {
  place: 'Уулзах газар',
  time: 'Цаг',
  parties: 'Оролцогч тал',
  purpose: 'Уулзалтын зорилго',
  /** «Хяналтаар явсан»-ы оронд. */
  participants: 'Оролцсон',
  /** «Ажлын тайлан»-гийн оронд. */
  content: 'Уулзалтын агуулга',
  contentEn: 'Meeting minutes',
  /** Гарын үсгийн хоёр дахь мөр — «Талбайн инженер»-ийн оронд. */
  clientSide: 'Захиалагч тал',
  /**
   * Гарын үсгийн эхний мөр — «Архитектор, Инженер»-ийн оронд (эзэн
   * 2026-10-08): «Оролцсон» хүмүүсээс НЭГИЙГ сонгоно, албан тушаал нь
   * өөрөө гарна (`meetingSigner`).
   */
  ourSide: 'Манай тал',
  /** Засварлагчийн гарын үсгийн тууз — «Хяналт хийсэн»-ий оронд. */
  signBand: 'Гарын үсэг',
  /** Гарын үсгийн хүснэгтийн толгой — «Хяналт хийсэн» / «Овог, нэр»-ийн оронд. */
  signHeadSide: 'Тал',
  signHeadName: 'Албан тушаал, нэр',
  /* 0396 — «Уулзалтын агуулга» доторх хүсэлтийн хоёр хүснэгт (эзний Word
     тэмдэглэлийн хэлбэр: дугаартай гарчиг, № · Хүсэлт гаргагч · Тайлбар). */
  requestClient: 'Захиалагч',
  requestContractor: 'Гүйцэтгэгч',
  requestNo: '№',
  requestBy: 'Хүсэлт гаргагч',
  requestText: 'Тайлбар',
  /** Хүснэгтүүдийн доорх чөлөөт тэмдэглэлийн (`work_report`) гарчиг. */
  notesHead: 'Тайлбар',
} as const;

/* ------------------------------------------------------------------ */
/*  0396 — хүсэлтийн хүснэгтүүд: 0.1 Захиалагч · 0.2 Гүйцэтгэгч          */
/* ------------------------------------------------------------------ */

/**
 * ⚠️ ИХЭР: backend `lib/asrMeeting.ts` (`sanitizeMeetingRequests`,
 *    `hasMeetingRequests`).  Хадгалалт `meeting_requests_json`.
 */
export const MEETING_REQUEST_SIDES = ['client', 'contractor'] as const;
export type MeetingRequestSide = (typeof MEETING_REQUEST_SIDES)[number];
/**
 * Хүснэгтийн нэг мөр — бичвэр + сонголттой зураг (`/media/<key>`, эзэн 2026-10-12).
 * ⚠️ 0396-гийн хуучин мөр нь түүхий бичвэр — `toRequestItem`-ээр уншина.
 */
export interface MeetingRequestItem {
  text: string;
  images: string[];
}

/** Мөр / «Тайлбар»-ын зургийн дээд тоо (backend `MEETING_ITEM_MAX_IMAGES`). */
export const MEETING_ITEM_MAX_IMAGES = 6;

export function toRequestItem(v: unknown): MeetingRequestItem {
  if (typeof v === 'string') return { text: v, images: [] };
  if (v && typeof v === 'object') {
    const o = v as { text?: unknown; images?: unknown };
    return {
      text: typeof o.text === 'string' ? o.text : '',
      images: Array.isArray(o.images) ? o.images.filter((u): u is string => typeof u === 'string') : [],
    };
  }
  return { text: '', images: [] };
}

export function emptyRequestItem(): MeetingRequestItem {
  return { text: '', images: [] };
}

export interface MeetingRequestSection {
  /** Сонголттой оршил: «2026.01.24-ны өдрийн уулзалтаар … хэлэлцэв». */
  intro: string;
  items: MeetingRequestItem[];
}
export type MeetingRequests = Record<MeetingRequestSide, MeetingRequestSection>;

export const MEETING_REQUEST_MAX_ITEMS = 60;

export function emptyMeetingRequests(): MeetingRequests {
  return { client: { intro: '', items: [] }, contractor: { intro: '', items: [] } };
}

/** Хэсгийн дугаартай гарчиг — эзний баримтын «0.1 Захиалагч» хэлбэр. */
export function meetingRequestHeading(side: MeetingRequestSide): string {
  return side === 'client'
    ? `0.1 ${MEETING_LABEL.requestClient}`
    : `0.2 ${MEETING_LABEL.requestContractor}`;
}

/** «Хүсэлт гаргагч» баганын (нэгтгэсэн нүд) утга. */
export function meetingRequestSideLabel(side: MeetingRequestSide): string {
  return side === 'client' ? MEETING_LABEL.requestClient : MEETING_LABEL.requestContractor;
}

export interface PrintedRequestSection {
  side: MeetingRequestSide;
  heading: string;
  sideLabel: string;
  intro: string;
  items: MeetingRequestItem[];
}

/**
 * Хэвлэх / Word-д гарах хэсгүүд.  Хоосон мөр алгасагдаж, үлдсэн нь 1-ээс
 * дугаарлагдана; оршилгүй + мөргүй хэсэг ОГТ гарахгүй.
 */
export function meetingRequestSections(
  r: MeetingRequests | null | undefined,
): PrintedRequestSection[] {
  if (!r) return [];
  const out: PrintedRequestSection[] = [];
  for (const side of MEETING_REQUEST_SIDES) {
    const sec = r[side];
    if (!sec) continue;
    const intro = (sec.intro ?? '').trim();
    const items = (sec.items ?? [])
      .map(toRequestItem)
      .map((it) => ({ text: it.text.trim(), images: it.images }))
      .filter((it) => it.text || it.images.length > 0);
    if (!intro && items.length === 0) continue;
    out.push({
      side,
      heading: meetingRequestHeading(side),
      sideLabel: meetingRequestSideLabel(side),
      intro,
      items,
    });
  }
  return out;
}

/** Засварлагчийн «илгээх» шалгалтад (серверийн `hasMeetingRequests`-ийн ихэр). */
export function hasMeetingRequests(r: MeetingRequests | null | undefined): boolean {
  return meetingRequestSections(r).length > 0;
}

export interface MeetingParticipant {
  id: number;
  name: string;
  position: string;
  author: boolean;
}

/**
 * «Оролцсон» — зохиогч (тайланг бичсэн хүн, уулзалтад оролцсон) эхэнд, дараа
 * нь сонгосон ажилтнууд (`asr_report_companions`).  Зохиогчийг сервер
 * companions-оос хасдаг тул энд давхардахгүй.
 */
export function meetingParticipants(
  entry: Pick<AsrReport, 'author_id' | 'author_name' | 'author_position' | 'companions'>,
): MeetingParticipant[] {
  const out: MeetingParticipant[] = [];
  if (entry.author_name) {
    out.push({
      id: entry.author_id,
      name: entry.author_name,
      position: (entry.author_position ?? '').trim(),
      author: true,
    });
  }
  for (const c of entry.companions ?? []) {
    if (c.user_id === entry.author_id) continue;
    out.push({
      id: c.user_id,
      name: c.full_name ?? '—',
      position: (c.position ?? '').trim(),
      author: false,
    });
  }
  return out;
}

/**
 * «Оролцогч тал»-ын МАНАЙ талын мөрүүд (эзэн 2026-10-12): «Оролцсон» хүн бүрд
 * `«Эм Жи Эл И Эн Си» ХХК-ийн Захирал Б.Билгүүн`.  ХАДГАЛАГДАХГҮЙ — оролцогчдоос
 * үргэлж дахин гарна, тиймээс хүн нэмэх/хасахад засварлагч, хэвлэлт, Word
 * гурвуулаа шууд дагана.  `meeting_parties` (гараар) нь бусад талынх (захиалагч …).
 * Компанийн нэр = `brand().legalNameMn` (админ тохиргооноос).
 */
/**
 * ⚠️ ИХЭР: backend `lib/asrMeeting.ts` `MeetingDocExtra` (0398,
 *    `meeting_doc_json`).  `party_lines` — «Оролцогч тал»-ын мөрийг гараар
 *    зассан утга, түлхүүр = user_id; засаагүй хүн автомат мөрөө авна.
 */
export interface MeetingDocExtra {
  party_lines: Record<string, string>;
  client_org: string;
  client_position: string;
  /** «Тайлбар» (`work_report`)-ын ард хавсаргасан зураг.  ⚠️ Хуучин хариунд байхгүй. */
  note_images?: string[];
}

export function emptyMeetingDoc(): MeetingDocExtra {
  return { party_lines: {}, client_org: '', client_position: '', note_images: [] };
}

/** «Эм Жи Эл И Эн Си» ХХК → «Эм Жи Эл И Эн Си» ХХК-ийн (ХХК/ХК/ТББ-д л залгавар). */
export function orgGenitive(company: string): string {
  const org = company.trim();
  return !org ? '' : /(ХХК|ХК|ТББ)$/u.test(org) ? `${org}-ийн` : org;
}

export interface OurPartyEntry {
  id: number;
  /** Оролцогчдоос гаргасан автомат мөр. */
  auto: string;
  /** Харагдах мөр — гараар зассан бол тэр, үгүй бол `auto`. */
  text: string;
  edited: boolean;
}

/**
 * «Оролцогч тал»-ын МАНАЙ талын мөрүүд (эзэн 2026-10-12): «Оролцсон» хүн бүрд
 * `«Эм Жи Эл И Эн Си» ХХК-ийн Захирал Б.Билгүүн`.  Оролцогчдоос үргэлж дахин гарна
 * (хүн нэмэх/хасахад шууд дагана); мөрийг гараар засвал (0398 `party_lines`) тэр
 * хүнд зассан нь хэвээр.  `meeting_parties` (гараар) нь бусад талынх (захиалагч …).
 * Компанийн нэр = `brand().legalNameMn` (админ тохиргооноос).
 */
export function ourPartyEntries(
  participants: readonly MeetingParticipant[],
  overrides: Record<string, string> | null | undefined,
  company: string = brand().legalNameMn,
): OurPartyEntry[] {
  const orgGen = orgGenitive(company);
  const out: OurPartyEntry[] = [];
  for (const p of participants) {
    const name = formatStaffShortName(p.name) || p.name.trim();
    const auto = name ? [orgGen, p.position, name].filter(Boolean).join(' ') : '';
    const o = overrides?.[String(p.id)];
    const edited = typeof o === 'string' && o.trim() !== '' && o.trim() !== auto;
    const text = edited ? o!.trim() : auto;
    if (text) out.push({ id: p.id, auto, text, edited });
  }
  return out;
}

export function ourPartyLines(
  participants: readonly MeetingParticipant[],
  overrides?: Record<string, string> | null,
  company?: string,
): string[] {
  return ourPartyEntries(participants, overrides, company).map((e) => e.text);
}

/** «Оролцогч тал» нүдний бүтэн бичвэр: манай талын мөрүүд + гараар бичсэн бусад тал. */
export function meetingPartiesText(
  entry: Pick<
    AsrReport,
    'author_id' | 'author_name' | 'author_position' | 'companions' | 'meeting_parties' | 'meeting_doc'
  >,
): string {
  const manual = (entry.meeting_parties ?? '').trim();
  return [
    ...ourPartyLines(meetingParticipants(entry), entry.meeting_doc?.party_lines),
    ...(manual ? [manual] : []),
  ].join('\n');
}

/* ------------------------------------------------------------------ */
/*  Хөл — эзний RFI/уулзалтын тэмдэглэлийн хэлбэр (2026-10-12)          */
/* ------------------------------------------------------------------ */

export interface MeetingFooterPerson {
  /** «“Эм Жи Эл И Эн Си” ХХК-ийн» — байгууллагын мөр (байхгүй бол хоосон). */
  orgLine: string;
  /** Албан тушаал + нэр — ард нь гарын үсгийн цэгтэй мөр. */
  nameLine: string;
  /** Гарын үсгийн зураг (байвал). */
  signatureUrl: string | null;
}

/** Мөрийн эхний байгууллагын хэсгийг («…ХХК-ийн») тусгаарлана. */
export function splitOrgPrefix(text: string, orgGen: string): { orgLine: string; rest: string } {
  const t = text.trim();
  if (orgGen && t.startsWith(orgGen)) {
    return { orgLine: orgGen, rest: t.slice(orgGen.length).trim() };
  }
  const m = /^(.*?(?:ХХК|ХК|ТББ)-ийн)\s+(.+)$/u.exec(t);
  return m ? { orgLine: m[1]!.trim(), rest: m[2]!.trim() } : { orgLine: '', rest: t };
}

export interface MeetingFooter {
  /** «MGL E&C LLC Талаас Хуралд оролцсон:» */
  ourHead: string;
  our: MeetingFooterPerson[];
  /** «“X” Талаас төлөөлж гарын үсэг зурсан:» */
  clientHead: string;
  client: MeetingFooterPerson | null;
}

/**
 * Хэвлэлт / Word-ийн хөл: манай талын оролцогч бүр (байгууллага · албан тушаал,
 * нэр ……), захиалагчийн төлөөлөгч (0398 `client_org`/`client_position` +
 * `sig_site_name`).  «Манай тал»-ын гарын үсэг (`sig_arch_url`) нь нэрээр нь
 * таарсан оролцогчийн мөрөнд, захиалагчийнх (`sig_site_url`) өөрийн мөрөнд.
 */
export function meetingFooter(
  entry: Pick<
    AsrReport,
    | 'author_id'
    | 'author_name'
    | 'author_position'
    | 'companions'
    | 'meeting_doc'
    | 'sig_arch_name'
    | 'sig_arch_url'
    | 'sig_site_name'
    | 'sig_site_url'
  >,
): MeetingFooter {
  const company = brand().legalNameMn;
  const orgGen = orgGenitive(company);
  const people = meetingParticipants(entry);
  const signer = findParticipantByName(people, entry.sig_arch_name);
  const our = ourPartyEntries(people, entry.meeting_doc?.party_lines, company).map((e) => {
    const { orgLine, rest } = splitOrgPrefix(e.text, orgGen);
    return {
      orgLine,
      nameLine: rest,
      signatureUrl: signer && signer.id === e.id ? (entry.sig_arch_url ?? null) : null,
    };
  });
  const doc = entry.meeting_doc;
  const clientOrg = (doc?.client_org ?? '').trim();
  const clientPos = (doc?.client_position ?? '').trim();
  const clientName = (entry.sig_site_name ?? '').trim();
  const client =
    clientOrg || clientPos || clientName || entry.sig_site_url
      ? {
          orgLine: orgGenitive(clientOrg),
          nameLine: [clientPos, clientName].filter(Boolean).join(' '),
          signatureUrl: entry.sig_site_url ?? null,
        }
      : null;
  return {
    ourHead: `${brand().legalNameEn || company} Талаас Хуралд оролцсон:`,
    our,
    clientHead: clientOrg
      ? `${clientOrg} Талаас төлөөлж гарын үсэг зурсан:`
      : `${MEETING_LABEL.clientSide}аас төлөөлж гарын үсэг зурсан:`,
    client,
  };
}

/** Баримтын нэг мөр: «Архитектор Эрдэнэжин» (эзний тэмдэглэлийн хэлбэр). */
export function participantLine(p: MeetingParticipant): string {
  return p.position ? `${p.position} ${p.name}` : p.name;
}

/**
 * «Манай тал»-ын гарын үсэг зурагч (эзэн 2026-10-08).
 *
 * Хадгалалт нь хуучин `sig_arch_name` багана — засварлагч ЗӨВХӨН «Оролцсон»
 * хүмүүсээс сонгуулж тэдний бүтэн нэрийг бичнэ.  Албан тушаалыг ХАДГАЛАХГҮЙ,
 * оролцогчдын жагсаалтаас нэрээр нь олж гаргана — тиймээс «Оролцсон» мөр
 * дээрх албан тушаалтай үргэлж ижил (миграцгүй).  Тэр хүн оролцогчдоос
 * хасагдсан (эсвэл гаднын гарын үсгийн холбоосоор өөр нэр бичигдсэн) бол
 * нэр нь хэвээр, албан тушаал хоосон.
 */
export function findParticipantByName<T extends Pick<MeetingParticipant, 'name'>>(
  participants: readonly T[],
  name: string | null | undefined,
): T | null {
  const want = (name ?? '').trim();
  if (!want) return null;
  return participants.find((p) => p.name.trim() === want) ?? null;
}

export function meetingSigner(
  entry: Pick<
    AsrReport,
    'author_id' | 'author_name' | 'author_position' | 'companions' | 'sig_arch_name'
  >,
): { name: string; position: string } {
  const name = (entry.sig_arch_name ?? '').trim();
  const p = findParticipantByName(meetingParticipants(entry), name);
  return { name, position: p?.position ?? '' };
}
