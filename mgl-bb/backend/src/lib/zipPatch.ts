/**
 * ZIP-ийг ДАХИН БИЧИХ — `.docx` (OOXML) доторх цөөн бичлэгийг солих/нэмэх,
 * бусдыг нь ЯГ байгаагаар нь (шахсан байтыг задлахгүйгээр) хуулна.
 *
 * Хамаарал НЭМЭХГҮЙ: `zipRead.ts`-ийн нэгэн адил Workers + Node ≥ 21-ийн
 * `CompressionStream('deflate-raw')`-ийг хэрэглэнэ.  Гарын үсэг зурахад
 * (`lib/docxSignFile.ts`) зөвхөн `word/document.xml`, түүний rels,
 * `[Content_Types].xml` өөрчлөгдөж, нэг зураг нэмэгддэг — 17 MB-ийн RFI-д ч
 * бусад бичлэгийг дахин шахах шаардлагагүй.
 *
 * Бүтэц хэвийжинэ: бичлэг бүрд ШИНЭ локал толгой (data descriptor-гүй, bit 3
 * цэвэрлэгдэнэ, CRC/хэмжээ нь төв лавлахаас), төв лавлахын мөр нь эх мөрийн
 * хуулбар дээр offset/CRC/хэмжээ/арга засагдана — нэр, extra, тайлбар хэвээр.
 * Google-ийн экспортлосон .docx data descriptor хэрэглэдэг бол ч зөв гарна.
 *
 * ZIP64, шифрлэлт, олон дискийг ДЭМЖИХГҮЙ (`zipRead.ts`-тэй ижил хязгаар).
 */

const SIG_EOCD = 0x06054b50;
const SIG_CEN = 0x02014b50;
const SIG_LOC = 0x04034b50;

/* ------------------------------------------------------------------ */
/*  CRC-32 (IEEE 802.3)                                                 */
/* ------------------------------------------------------------------ */

let CRC_TABLE: Uint32Array | null = null;

function crcTable(): Uint32Array {
  if (CRC_TABLE) return CRC_TABLE;
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  CRC_TABLE = t;
  return t;
}

export function crc32(data: Uint8Array): number {
  const t = crcTable();
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = t[(c ^ data[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

async function deflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const cs = new CompressionStream('deflate-raw');
  const writer = cs.writable.getWriter();
  void writer.write(data);
  void writer.close();
  return new Uint8Array(await new Response(cs.readable).arrayBuffer());
}

/* ------------------------------------------------------------------ */
/*  Унших                                                              */
/* ------------------------------------------------------------------ */

interface CenRecord {
  name: string;
  /** Төв лавлахын мөрийн ТҮҮХИЙ байт (46 + нэр + extra + тайлбар). */
  raw: Uint8Array;
  method: number;
  crc: number;
  compressedSize: number;
  size: number;
  localOffset: number;
}

function readCentralDirectory(bytes: Uint8Array): { records: CenRecord[]; comment: Uint8Array } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const minPos = Math.max(0, bytes.length - 22 - 65_535);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= minPos; i--) {
    if (view.getUint32(i, true) === SIG_EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('zip: EOCD not found');
  const count = view.getUint16(eocd + 10, true);
  const cdOffset = view.getUint32(eocd + 16, true);
  const commentLen = view.getUint16(eocd + 20, true);
  const comment = bytes.slice(eocd + 22, eocd + 22 + commentLen);
  if (count === 0xffff || cdOffset === 0xffffffff) throw new Error('zip: ZIP64 is not supported');

  const records: CenRecord[] = [];
  let p = cdOffset;
  for (let i = 0; i < count; i++) {
    if (p + 46 > bytes.length || view.getUint32(p, true) !== SIG_CEN) {
      throw new Error('zip: bad central directory');
    }
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const cmtLen = view.getUint16(p + 32, true);
    const total = 46 + nameLen + extraLen + cmtLen;
    const flags = view.getUint16(p + 8, true);
    if (flags & 0x1) throw new Error('zip: encrypted entries are not supported');
    records.push({
      name: new TextDecoder().decode(bytes.subarray(p + 46, p + 46 + nameLen)),
      raw: bytes.slice(p, p + total),
      method: view.getUint16(p + 10, true),
      crc: view.getUint32(p + 16, true),
      compressedSize: view.getUint32(p + 20, true),
      size: view.getUint32(p + 24, true),
      localOffset: view.getUint32(p + 42, true),
    });
    p += total;
  }
  return { records, comment };
}

/** Локал толгой → { толгойн ТОГТМОЛ 30 байт, нэр+extra, өгөгдлийн эхлэл }. */
function readLocal(bytes: Uint8Array, rec: CenRecord): { fixed: Uint8Array; nameExtra: Uint8Array; dataStart: number } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const lo = rec.localOffset;
  if (lo + 30 > bytes.length || view.getUint32(lo, true) !== SIG_LOC) {
    throw new Error(`zip: bad local header for ${rec.name}`);
  }
  const nameLen = view.getUint16(lo + 26, true);
  const extraLen = view.getUint16(lo + 28, true);
  return {
    fixed: bytes.slice(lo, lo + 30),
    nameExtra: bytes.slice(lo + 30, lo + 30 + nameLen + extraLen),
    dataStart: lo + 30 + nameLen + extraLen,
  };
}

/* ------------------------------------------------------------------ */
/*  Бичих                                                              */
/* ------------------------------------------------------------------ */

/** DOS огноо/цаг (UTC-ээр — ZIP-д бүс байхгүй; Word үүнийг уншдаггүй). */
function dosDateTime(d: Date): { time: number; date: number } {
  const year = Math.max(1980, d.getUTCFullYear());
  return {
    time: (d.getUTCHours() << 11) | (d.getUTCMinutes() << 5) | Math.floor(d.getUTCSeconds() / 2),
    date: ((year - 1980) << 9) | ((d.getUTCMonth() + 1) << 5) | d.getUTCDate(),
  };
}

class ByteSink {
  private parts: Uint8Array[] = [];
  length = 0;
  push(b: Uint8Array): void {
    this.parts.push(b);
    this.length += b.length;
  }
  concat(): Uint8Array {
    const out = new Uint8Array(this.length);
    let o = 0;
    for (const p of this.parts) {
      out.set(p, o);
      o += p.length;
    }
    return out;
  }
}

export interface ZipAddition {
  name: string;
  data: Uint8Array;
  /** false = хадгалах (method 0) — PNG/JPEG аль хэдийн шахагдсан. */
  compress?: boolean;
}

export interface ZipChanges {
  /** Байгаа бичлэгийн шинэ (задласан) агуулга — нэрээр. */
  replace?: Map<string, Uint8Array>;
  /** Шинэ бичлэгүүд (нэр давхцвал алдаа). */
  add?: ZipAddition[];
  /** Хасах бичлэгүүд. */
  remove?: Set<string>;
  /** Шинэ бичлэгийн огноо (тестэд тогтмол). */
  now?: Date;
}

interface Prepared {
  method: number;
  crc: number;
  compressedSize: number;
  size: number;
  data: Uint8Array;
}

async function prepare(data: Uint8Array, compress: boolean): Promise<Prepared> {
  const crc = crc32(data);
  if (!compress) return { method: 0, crc, compressedSize: data.length, size: data.length, data };
  const deflated = await deflateRaw(data);
  return { method: 8, crc, compressedSize: deflated.length, size: data.length, data: deflated };
}

/**
 * ZIP-ийг өөрчлөлтүүдтэй нь дахин угсарна.  Солих нэр байхгүй бол алдаа —
 * дуудагч «юу ч өөрчлөгдсөнгүй» гэж андуурахгүй.
 */
export async function rewriteZip(src: Uint8Array, changes: ZipChanges): Promise<Uint8Array> {
  const { records, comment } = readCentralDirectory(src);
  const replace = changes.replace ?? new Map<string, Uint8Array>();
  const remove = changes.remove ?? new Set<string>();
  const adds = changes.add ?? [];
  const names = new Set(records.map((r) => r.name));
  for (const name of replace.keys()) {
    if (!names.has(name)) throw new Error(`zip: entry to replace not found: ${name}`);
  }
  for (const a of adds) {
    if (names.has(a.name) && !remove.has(a.name)) throw new Error(`zip: entry already exists: ${a.name}`);
  }

  const out = new ByteSink();
  const central = new ByteSink();
  let entryCount = 0;

  for (const rec of records) {
    if (remove.has(rec.name)) continue;
    const local = readLocal(src, rec);
    const newBody = replace.get(rec.name);
    const prepared: Prepared = newBody
      ? await prepare(newBody, true)
      : {
          method: rec.method,
          crc: rec.crc,
          compressedSize: rec.compressedSize,
          size: rec.size,
          data: src.subarray(local.dataStart, local.dataStart + rec.compressedSize),
        };
    const offset = out.length;

    // Локал толгой: эх толгойн хуулбар — bit 3 цэвэр, арга/CRC/хэмжээ бодит.
    const fixed = local.fixed.slice();
    const lv = new DataView(fixed.buffer);
    lv.setUint16(6, lv.getUint16(6, true) & ~0x0008, true);
    lv.setUint16(8, prepared.method, true);
    lv.setUint32(14, prepared.crc, true);
    lv.setUint32(18, prepared.compressedSize, true);
    lv.setUint32(22, prepared.size, true);
    out.push(fixed);
    out.push(local.nameExtra);
    out.push(prepared.data);

    // Төв лавлахын мөр — эх мөр + засвар.
    const cen = rec.raw.slice();
    const cv = new DataView(cen.buffer);
    cv.setUint16(8, cv.getUint16(8, true) & ~0x0008, true);
    cv.setUint16(10, prepared.method, true);
    cv.setUint32(16, prepared.crc, true);
    cv.setUint32(20, prepared.compressedSize, true);
    cv.setUint32(24, prepared.size, true);
    cv.setUint32(42, offset, true);
    central.push(cen);
    entryCount++;
  }

  const { time, date } = dosDateTime(changes.now ?? new Date());
  const enc = new TextEncoder();
  for (const add of adds) {
    const prepared = await prepare(add.data, add.compress !== false);
    const nameBytes = enc.encode(add.name);
    const offset = out.length;
    const loc = new Uint8Array(30);
    const lv = new DataView(loc.buffer);
    lv.setUint32(0, SIG_LOC, true);
    lv.setUint16(4, 20, true); // version needed
    lv.setUint16(6, 0x0800, true); // UTF-8 нэр
    lv.setUint16(8, prepared.method, true);
    lv.setUint16(10, time, true);
    lv.setUint16(12, date, true);
    lv.setUint32(14, prepared.crc, true);
    lv.setUint32(18, prepared.compressedSize, true);
    lv.setUint32(22, prepared.size, true);
    lv.setUint16(26, nameBytes.length, true);
    lv.setUint16(28, 0, true);
    out.push(loc);
    out.push(nameBytes);
    out.push(prepared.data);

    const cen = new Uint8Array(46);
    const cv = new DataView(cen.buffer);
    cv.setUint32(0, SIG_CEN, true);
    cv.setUint16(4, 20, true); // version made by
    cv.setUint16(6, 20, true); // version needed
    cv.setUint16(8, 0x0800, true);
    cv.setUint16(10, prepared.method, true);
    cv.setUint16(12, time, true);
    cv.setUint16(14, date, true);
    cv.setUint32(16, prepared.crc, true);
    cv.setUint32(20, prepared.compressedSize, true);
    cv.setUint32(24, prepared.size, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint32(42, offset, true);
    central.push(cen);
    central.push(nameBytes);
    entryCount++;
  }

  if (entryCount > 0xfffe) throw new Error('zip: too many entries');
  const cdOffset = out.length;
  const cdBytes = central.concat();
  out.push(cdBytes);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, SIG_EOCD, true);
  ev.setUint16(8, entryCount, true);
  ev.setUint16(10, entryCount, true);
  ev.setUint32(12, cdBytes.length, true);
  ev.setUint32(16, cdOffset, true);
  ev.setUint16(20, comment.length, true);
  out.push(eocd);
  out.push(comment);
  return out.concat();
}
