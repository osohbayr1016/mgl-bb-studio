/**
 * «Баримт бичиг» (Drive) дээрх Word баримтын ЗАХИАЛАГЧИЙН гарын үсгийн төлөв — ЦЭВЭР дүрэм.
 *
 * Эзний хүсэлт (2026-10-19): «CR-ийг манай тал (ажилтан + захирлын «Батлах») дуусгахад
 * «Батлагдсан» гэж харагддаг ч захиалагчийн баталгаажуулалт, гарын үсэг дутуу гэсэн төлөв
 * алга — захиалагч баталгаажуулж гарын үсэг зурсны ДАРАА л «Батлагдсан» болго.»
 * Мөн өдөр залруулсан: «RFI-д захиалагч батлахгүй — манай тал зурсан бол батлагдсан; захиалагчийн
 * гарын үсгийг ЗӨВХӨН CR-д шаардана.»
 *
 * Захиалагчийн талын мөр (`isClientSide`) — аль нэг нь:
 *   • баримтын захиалагчийн мөр (`client`): CR-ийн «Захиалагчаас баталсан: (Approved by client)»;
 *   • гаднын (login-гүй) link-ээр зурсан мөр (`external`);
 *   • амьд / зурсан гаднын link-тэй мөр (`linkKeys`).
 *
 * Шаардлагатай (`required`) = ЗӨВХӨН CR (файлын нэрээр — `…-CR-…`, `…_CR_…`).  RFI ба бусад Word
 * баримтад захиалагчийн мөр / link байсан ч шаардахгүй — захирал баталмагц «Батлагдсан».
 * Бүрэн (`complete`) = шаардлагагүй, эсвэл захиалагчийн талын мөр ≥ 1 бөгөөд бүгд зурагдсан
 * (ERP-ээр эсвэл гараар оруулсан зураг — цаасан дээр зуруулаад сканнердсан ч тоологдоно).
 * Захиалагчийн мөргүй CR нь `missing_row` — admin «Гарын үсгийн link» цонхноос мөр нэмнэ.
 *
 * Захирлын батлалт (`drive_doc_sign_requests.status`) ӨӨРЧЛӨГДӨХГҮЙ — тэр нь «манай тал
 * баталсан» хэвээр; «Батлагдсан» = захирал баталсан ∧ `complete` (UI нийлүүлнэ).
 */

export type ClientSlotState = 'empty' | 'erp' | 'other';

export interface ClientSignSlot {
  key: string;
  client: boolean;
  state: ClientSlotState;
  /** Гаднын link-ээр зурсан (`drive_doc_sign_events.action = 'external'`). */
  external: boolean;
}

export interface ClientSignState {
  /** Захиалагчийн гарын үсэг шаардлагатай эсэх. */
  required: boolean;
  /** Захиалагчийн талын мөрийн тоо. */
  total: number;
  /** Тэдгээрээс зурагдсан. */
  signed: number;
  /** Шаардлагагүй, эсвэл захиалагчийн талын бүх мөр зурагдсан. */
  complete: boolean;
  /** Шаардлагатай атлаа баримтад захиалагчийн мөр алга (link үүсгэхдээ мөр нэмнэ). */
  missing_row: boolean;
}

/** Баримтын төрөл — файлын нэрээр (`…_RFI_…`, `…-CR-…`).  Захиалагчийн гарын үсгийг зөвхөн `cr` шаардана. */
export function clientDocKind(fileName: string): 'rfi' | 'cr' | null {
  const n = fileName.toUpperCase();
  if (/(^|[^A-Z])RFI([^A-Z]|$)/.test(n)) return 'rfi';
  if (/(^|[^A-Z])CR([^A-Z]|$)/.test(n)) return 'cr';
  return null;
}

export function isClientSide(slot: Pick<ClientSignSlot, 'key' | 'client' | 'external'>, linkKeys: ReadonlySet<string>): boolean {
  return slot.client || slot.external || linkKeys.has(slot.key);
}

export function clientSignState(
  slots: readonly ClientSignSlot[],
  opts: { fileName: string; linkKeys?: ReadonlySet<string> },
): ClientSignState {
  const linkKeys = opts.linkKeys ?? new Set<string>();
  const side = slots.filter((s) => isClientSide(s, linkKeys));
  const signed = side.filter((s) => s.state !== 'empty').length;
  const required = clientDocKind(opts.fileName) === 'cr';
  const total = side.length;
  return {
    required,
    total,
    signed,
    complete: !required || (total > 0 && signed === total),
    missing_row: required && total === 0,
  };
}

/** D1-д хадгалах хэлбэр (`drive_doc_sign_summaries.slots_json`) — танихгүй мөрийг хаяна. */
export function parseClientSlots(raw: string | null | undefined): ClientSignSlot[] | null {
  if (!raw) return null;
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!Array.isArray(v)) return null;
  const out: ClientSignSlot[] = [];
  for (const x of v) {
    if (!x || typeof x !== 'object') continue;
    const o = x as Record<string, unknown>;
    if (typeof o.key !== 'string' || !o.key) continue;
    const state = o.state === 'erp' || o.state === 'other' ? o.state : 'empty';
    out.push({ key: o.key, client: o.client === true, state, external: o.external === true });
  }
  return out;
}

export interface ClientLinkRow {
  id: number;
  slot_key: string;
  slot_client: number;
  /** 'pending' | 'signing' (амьд) | 'signed'. */
  status: string;
}

/**
 * Баримтын мөрүүд D1-д хараахан хадгалагдаагүй (энэ өөрчлөлтөөс өмнө баталсан, самбарыг
 * нээгээгүй) файлын ойролцоо мөрүүд — зөвхөн гаднын link-ээс: мөр тус бүрийн СҮҮЛИЙН link.
 */
export function slotsFromLinks(links: readonly ClientLinkRow[]): ClientSignSlot[] {
  const latest = new Map<string, ClientLinkRow>();
  for (const l of links) {
    const prev = latest.get(l.slot_key);
    if (!prev || l.id > prev.id) latest.set(l.slot_key, l);
  }
  return [...latest.values()].map((l) => ({
    key: l.slot_key,
    client: l.slot_client === 1,
    state: l.status === 'signed' ? 'erp' : 'empty',
    external: l.status === 'signed',
  }));
}
