/**
 * RFI/CR захиалагчийн гарын үсэг — ЦЭВЭР дүрмүүд (D1/R2/Hono-гүй, тесттэй).
 *
 * `routes/correspondence.ts` эдгээрийг л дуудна — төлөвийн шилжилт, гарын
 * үсгийн зургийн шалгалт, R2 түлхүүр/файлын нэр ЭНД нэг газар.
 *
 *   none ──(ажилтан: хүсэлт)──▶ pending ──(захиалагч: зурав)──▶ signed
 *     ▲                            │
 *     └────(ажилтан: цуцлав)───────┘
 *
 * `signed` нь ЭЦСИЙН: агуулгын талбар түгжигдэнэ, цуцлах боломжгүй
 * (устгах нь тусдаа — admin л).  Захиалагчийн гарын үсэг нь баримтын
 * нотолгоо тул дахин «pending» болгож давхар зуруулахгүй.
 */

export type SignStatus = 'none' | 'pending' | 'signed';
export type SignableDocType = 'rfi' | 'cr';

export const SIGNABLE_DOC_TYPES: readonly SignableDocType[] = ['rfi', 'cr'];

export function isSignableDocType(v: unknown): v is SignableDocType {
  return v === 'rfi' || v === 'cr';
}

export function isSignStatus(v: unknown): v is SignStatus {
  return v === 'none' || v === 'pending' || v === 'signed';
}

/** Баримтын толгойн нэр (print хуудас + PDF файлын нэр хоёулаа эндээс). */
export const DOC_TYPE_TITLE_MN: Record<SignableDocType, string> = {
  rfi: 'Мэдээлэл хүсэлт',
  cr: 'Өөрчлөлтийн хүсэлт',
};
export const DOC_TYPE_TITLE_EN: Record<SignableDocType, string> = {
  rfi: 'Request for Information',
  cr: 'Change Request',
};

export type TransitionResult = { ok: true } | { ok: false; status: 400 | 409; error: string };

/** Ажилтан «гарын үсэг зуруулах» хүсэлт тавих боломжтой юу. */
export function canRequestSignature(entry: {
  doc_type: string | null;
  sign_status: string;
}): TransitionResult {
  if (!isSignableDocType(entry.doc_type)) {
    return { ok: false, status: 400, error: 'Зөвхөн RFI / CR бичигт гарын үсэг зуруулна' };
  }
  if (entry.sign_status === 'pending') {
    return { ok: false, status: 409, error: 'Гарын үсгийн хүсэлт аль хэдийн илгээгдсэн' };
  }
  if (entry.sign_status === 'signed') {
    return { ok: false, status: 409, error: 'Захиалагч аль хэдийн гарын үсэг зурсан' };
  }
  return { ok: true };
}

/** Ажилтан хүлээгдэж буй хүсэлтийг цуцлах боломжтой юу. */
export function canCancelSignatureRequest(entry: { sign_status: string }): TransitionResult {
  if (entry.sign_status === 'signed') {
    return { ok: false, status: 409, error: 'Гарын үсэг зурагдсан бичгийн хүсэлтийг цуцлахгүй' };
  }
  if (entry.sign_status !== 'pending') {
    return { ok: false, status: 409, error: 'Хүлээгдэж буй хүсэлт алга' };
  }
  return { ok: true };
}

/** Захиалагч гарын үсэг зурах боломжтой юу. */
export function canSign(entry: { doc_type: string | null; sign_status: string }): TransitionResult {
  if (!isSignableDocType(entry.doc_type)) {
    return { ok: false, status: 400, error: 'Энэ бичигт гарын үсэг зурахгүй' };
  }
  if (entry.sign_status === 'signed') {
    return { ok: false, status: 409, error: 'Аль хэдийн гарын үсэг зурсан' };
  }
  if (entry.sign_status !== 'pending') {
    return { ok: false, status: 409, error: 'Гарын үсгийн хүсэлт илгээгдээгүй байна' };
  }
  return { ok: true };
}

/**
 * Захиалагч зурсны дараа ХӨДЛӨХГҮЙ талбарууд — PDF-д орж, гарын үсгийн
 * утгыг тодорхойлдог бүхэн.  `attachment_url` (Gmail-ийн дэлгэцийн зураг)
 * ЗОРИУД орохгүй — баримтын бүрэлдэхүүн биш.
 */
export const SIGNED_LOCKED_FIELDS = [
  'log_date',
  'direction',
  'subject',
  'body',
  'from_email',
  'to_email',
  'cc_emails',
  'doc_type',
  'ref_no',
  'signature_url',
] as const;

/** PATCH body-д түгжигдсэн талбар байгаа эсэх — байвал тэдгээрийн нэрс. */
export function lockedFieldsIn(body: Record<string, unknown>): string[] {
  return SIGNED_LOCKED_FIELDS.filter((f) => body[f] !== undefined);
}

/* ------------------------------------------------------------------ */
/*  Гарын үсгийн зураг                                                 */
/* ------------------------------------------------------------------ */

/** Зурсан гарын үсэг — тайрсан PNG ердөө хэдэн арван KB; 512 KB нь дээд хязгаар. */
export const MAX_SIGNATURE_BYTES = 512 * 1024;

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

export type ParsedSignature = { ok: true; bytes: Uint8Array } | { ok: false; error: string };

/**
 * `data:image/png;base64,…` → байтууд.  Зөвхөн PNG (canvas-ийн гаралт);
 * MIME-ийг толгойгоор БИШ, PNG-ийн magic байтаар тулгана — хөтчийн
 * илгээсэн шошгонд итгэхгүй.
 */
export function parseSignatureDataUrl(input: unknown): ParsedSignature {
  if (typeof input !== 'string') return { ok: false, error: 'Гарын үсгийн зураг алга' };
  const m = /^data:image\/png;base64,([A-Za-z0-9+/=\s]+)$/.exec(input.trim());
  if (!m) return { ok: false, error: 'Гарын үсэг PNG data URL байх ёстой' };
  const b64 = m[1]!.replace(/\s+/g, '');
  // base64 → ойролцоо урт: 4 тэмдэгт = 3 байт.  Декодлохоос ӨМНӨ таслана.
  if ((b64.length * 3) / 4 > MAX_SIGNATURE_BYTES + 3) {
    return { ok: false, error: 'Гарын үсгийн зураг хэт том (512 KB-аас их)' };
  }
  let bytes: Uint8Array;
  try {
    bytes = decodeBase64(b64);
  } catch {
    return { ok: false, error: 'Гарын үсгийн зураг гэмтэлтэй' };
  }
  if (bytes.length < 64) return { ok: false, error: 'Гарын үсгийн зураг хоосон' };
  if (bytes.length > MAX_SIGNATURE_BYTES) {
    return { ok: false, error: 'Гарын үсгийн зураг хэт том (512 KB-аас их)' };
  }
  for (let i = 0; i < PNG_MAGIC.length; i++) {
    if (bytes[i] !== PNG_MAGIC[i]) return { ok: false, error: 'Гарын үсэг PNG биш байна' };
  }
  return { ok: true, bytes };
}

function decodeBase64(b64: string): Uint8Array {
  // Worker + Node хоёуланд `atob` бий; буруу тэмдэгтэд throw хийнэ.
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/* ------------------------------------------------------------------ */
/*  R2 түлхүүр / файлын нэр                                            */
/* ------------------------------------------------------------------ */

/**
 * Хувийн bucket доторх түлхүүрүүд.  `client/` угтвар нь `upload.ts`-ийн
 * нэрийн зайтай ижил (захиалагчийн порталын бүх хувийн файл тэнд).
 * Мөч бүрд ШИНЭ түлхүүр — дарж бичихгүй, хуучныг тусад нь устгана.
 */
export function clientSignatureKey(entryId: number, nowMs: number, rand: string): string {
  return `client/signatures/corr-${entryId}-${nowMs}-${rand}.png`;
}

export function correspondencePdfKey(entryId: number, nowMs: number, rand: string): string {
  return `client/correspondence-pdf/corr-${entryId}-${nowMs}-${rand}.pdf`;
}

/** Татах файлын нэр: `RFI-202606-001.pdf`, дугааргүй бол `RFI-<id>.pdf`. */
export function correspondencePdfFileName(entry: {
  id: number;
  doc_type: string | null;
  ref_no: string | null;
}): string {
  const prefix = entry.doc_type === 'cr' ? 'CR' : 'RFI';
  const raw = (entry.ref_no ?? '').trim() || `${prefix}-${entry.id}`;
  const safe =
    raw
      .normalize('NFKD')
      .replace(/[\s/\\]+/g, '-')
      .replace(/[^\p{L}\p{N}._-]/gu, '')
      .slice(0, 80) || `${prefix}-${entry.id}`;
  return `${safe}.pdf`;
}

/**
 * Хадгалсан PDF хүчинтэй юу — үүсгэсэн мөч нь сүүлийн өөрчлөлтөөс (засвар,
 * гарын үсэг) ХОЖУУ байх ёстой.  ISO/`datetime('now')` мөрүүд нэг хэлбэрт
 * (`YYYY-MM-DD HH:MM:SS` ↔ `YYYY-MM-DDTHH:MM:SS.sssZ`) байхгүй тул `Date`-ээр
 * тулгана.
 */
export function pdfIsCurrent(entry: {
  pdf_key: string | null;
  pdf_generated_at: string | null;
  updated_at: string;
  client_signed_at: string | null;
}): boolean {
  if (!entry.pdf_key || !entry.pdf_generated_at) return false;
  const gen = toMs(entry.pdf_generated_at);
  if (gen == null) return false;
  const upd = toMs(entry.updated_at) ?? 0;
  const signed = entry.client_signed_at ? (toMs(entry.client_signed_at) ?? 0) : 0;
  return gen >= upd && gen >= signed;
}

function toMs(s: string): number | null {
  // `datetime('now')` = 'YYYY-MM-DD HH:MM:SS' (UTC, timezone-гүй) → ISO болгоно.
  const iso = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(s) ? `${s.replace(' ', 'T')}Z` : s;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}

/** Gmail-ээр илгээх бичгийн төгсгөлд залгах порталын заавар. */
export function signatureRequestMailFooter(frontendUrl: string): string {
  const base = frontendUrl.replace(/\/+$/, '');
  return (
    `\n\n---\nЭнэ бичигт захиалагчийн ГАРЫН ҮСЭГ шаардлагатай. ` +
    `Порталдаа нэвтэрч «Захидал» хэсгээс гарын үсэг зурна уу: ${base}/client`
  );
}
