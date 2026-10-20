/**
 * .docx БАЙТ дээрх гарын үсгийн ажил — `docxSign.ts`-ийн цэвэр XML логикийг
 * ZIP-тэй холбоно: задлах (`zipRead.ts`) → нүд олох / суулгах → дахин
 * багцлах (`zipPatch.ts`, өөрчлөгдөөгүй бичлэгийг ДАХИН ШАХАХГҮЙ).
 *
 * Сүлжээ, D1 хөндөхгүй — `node --test`-ээр шууд тестлэгдэнэ.
 */
import { readZipText } from './zipRead';
import { rewriteZip } from './zipPatch';
import {
  addImageRelationship,
  detectDateStyle,
  ensureImageContentType,
  findSignatureSlots,
  formatDocDate,
  nextDocPrId,
  parseTables,
  signatureExtent,
  stampDocumentXml,
  type ImageInfo,
  type SignSlot,
} from './docxSign';
import { appendClientRowXml } from './docxClientRow';

/** Гарын үсэг зурах .docx-ийн дээд хэмжээ — Worker-ийн санах ойд (128 MB)
 *  эх + шинэ хоёр хуулбар багтана.  `projectDriveUpload.ts`-ийн
 *  `REVISION_MAX_BYTES`-тэй ижил утга. */
export const SIGN_MAX_BYTES = 40 * 1024 * 1024;

const DOC_PART = 'word/document.xml';
const RELS_PART = 'word/_rels/document.xml.rels';
const CT_PART = '[Content_Types].xml';

export type AnalyzeResult =
  | { ok: true; slots: SignSlot[] }
  | { ok: false; reason: 'NOT_DOCX' };

/** Баримтын гарын үсгийн нүднүүд.  ZIP/Word биш бол `NOT_DOCX`. */
export async function analyzeDocx(bytes: Uint8Array): Promise<AnalyzeResult> {
  let xml: string | null;
  try {
    xml = await readZipText(bytes, DOC_PART);
  } catch {
    return { ok: false, reason: 'NOT_DOCX' };
  }
  if (!xml) return { ok: false, reason: 'NOT_DOCX' };
  return { ok: true, slots: findSignatureSlots(parseTables(xml)) };
}

export interface StampDocxInput {
  slotKey: string;
  image: { bytes: Uint8Array; info: ImageInfo };
  /** `mgl-sign-<токен>` — docPr нэр, медиа файлын нэр. */
  mark: string;
  /** Word-ийн «Alt text» — хэн, хэзээ (хүнд уншигдах). */
  descr: string;
  /** Хоосон нүдэнд бичих утгууд; огноо нь «YYYY-MM-DD» (УБ) — хүснэгтийн
   *  бусад огнооны хэлбэрээр хөрвүүлэгдэнэ. */
  fill: { name?: string; position?: string; ymd?: string };
}

export type StampDocxResult =
  | {
      ok: true;
      bytes: Uint8Array;
      slot: SignSlot;
      filled: Array<{ field: 'name' | 'position' | 'date'; text: string }>;
    }
  | { ok: false; reason: 'NOT_DOCX' | 'SLOT_NOT_FOUND' | 'SLOT_NOT_EMPTY' };

/** Нэг нүдэнд гарын үсэг суулгасан ШИНЭ .docx байт. */
export async function stampDocx(bytes: Uint8Array, input: StampDocxInput): Promise<StampDocxResult> {
  let xml: string | null;
  let rels: string | null;
  let ct: string | null;
  try {
    [xml, rels, ct] = await Promise.all([
      readZipText(bytes, DOC_PART),
      readZipText(bytes, RELS_PART),
      readZipText(bytes, CT_PART),
    ]);
  } catch {
    return { ok: false, reason: 'NOT_DOCX' };
  }
  if (!xml || !ct) return { ok: false, reason: 'NOT_DOCX' };

  const slots = findSignatureSlots(parseTables(xml));
  const slot = slots.find((s) => s.key === input.slotKey);
  if (!slot) return { ok: false, reason: 'SLOT_NOT_FOUND' };
  if (slot.state !== 'empty') return { ok: false, reason: 'SLOT_NOT_EMPTY' };

  const ext = input.image.info.ext;
  const mediaFile = `${input.mark}.${ext === 'png' ? 'png' : 'jpg'}`;
  const relsXml =
    rels ??
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>';
  const rel = addImageRelationship(relsXml, `media/${mediaFile}`);
  const { cx, cy } = signatureExtent(input.image.info, slot.box.widthTwips);

  const dateSamples = slots.filter((s) => s.group === slot.group).map((s) => s.date);
  const date = input.fill.ymd ? formatDocDate(input.fill.ymd, detectDateStyle(dateSamples)) : undefined;

  const stamped = stampDocumentXml(xml, slots, {
    slot,
    rid: rel.rid,
    docPrId: nextDocPrId(xml),
    mark: input.mark,
    descr: input.descr,
    ext,
    cx,
    cy,
    fill: { name: input.fill.name, position: input.fill.position, date },
  });

  const enc = new TextEncoder();
  const replace = new Map<string, Uint8Array>([
    [DOC_PART, enc.encode(stamped.xml)],
    [CT_PART, enc.encode(ensureImageContentType(ct, ext))],
  ]);
  const add = [{ name: `word/media/${mediaFile}`, data: input.image.bytes, compress: false }];
  if (rels) replace.set(RELS_PART, enc.encode(rel.xml));
  else add.push({ name: RELS_PART, data: enc.encode(rel.xml), compress: true });

  const out = await rewriteZip(bytes, { replace, add });
  return { ok: true, bytes: out, slot, filled: stamped.filled };
}

export type AppendClientRowDocxResult =
  | { ok: true; bytes: Uint8Array }
  | { ok: false; reason: 'NOT_DOCX' | 'HAS_CLIENT_ROW' | 'NO_TABLE' };

/**
 * Захиалагчийн гарын үсгийн мөргүй баримтад «Захиалагч хүлээн авсан» мөр нэмсэн ШИНЭ
 * .docx байт (`docxClientRow.ts`).  Зөвхөн `word/document.xml` солигдоно.
 */
export async function appendClientRowDocx(bytes: Uint8Array): Promise<AppendClientRowDocxResult> {
  let xml: string | null;
  try {
    xml = await readZipText(bytes, DOC_PART);
  } catch {
    return { ok: false, reason: 'NOT_DOCX' };
  }
  if (!xml) return { ok: false, reason: 'NOT_DOCX' };
  const r = appendClientRowXml(xml);
  if (!r.ok) return r;
  const out = await rewriteZip(bytes, { replace: new Map([[DOC_PART, new TextEncoder().encode(r.xml)]]) });
  return { ok: true, bytes: out };
}
