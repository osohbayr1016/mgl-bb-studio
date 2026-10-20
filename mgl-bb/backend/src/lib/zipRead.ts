/**
 * Хамгийн жижиг ZIP уншигч — `.docx` (OOXML) доторх ганц бичлэгийг гаргана.
 *
 * Хамаарал НЭМЭХГҮЙ: Workers runtime ба Node ≥ 21 хоёулаа
 * `DecompressionStream('deflate-raw')`-тай тул `fflate`/`jszip` хэрэггүй.
 * ZIP64, шифрлэлт, олон дискийг ДЭМЖИХГҮЙ — Word-ийн үүсгэдэг .docx хэзээ ч
 * тэдгээрийг хэрэглэдэггүй (файл < 4 GB, бичлэг < 65 535).  Хэмжээг төв
 * лавлахаас (central directory) уншдаг тул data descriptor (bit 3) саад биш.
 */

const SIG_EOCD = 0x06054b50;
const SIG_CEN = 0x02014b50;
const SIG_LOC = 0x04034b50;

export interface ZipEntry {
  name: string;
  method: number;
  compressedSize: number;
  size: number;
  /** Локал толгойн байрлал. */
  localOffset: number;
}

export function listZipEntries(bytes: Uint8Array): ZipEntry[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // EOCD нь файлын төгсгөлд, тайлбар (≤ 65 535 байт) араас нь байж болно.
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

  const entries: ZipEntry[] = [];
  let p = cdOffset;
  for (let i = 0; i < count; i++) {
    if (p + 46 > bytes.length || view.getUint32(p, true) !== SIG_CEN) {
      throw new Error('zip: bad central directory');
    }
    const method = view.getUint16(p + 10, true);
    const compressedSize = view.getUint32(p + 20, true);
    const size = view.getUint32(p + 24, true);
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    const localOffset = view.getUint32(p + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(p + 46, p + 46 + nameLen));
    entries.push({ name, method, compressedSize, size, localOffset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const ds = new DecompressionStream('deflate-raw');
  const writer = ds.writable.getWriter();
  void writer.write(data);
  void writer.close();
  const out = new Uint8Array(await new Response(ds.readable).arrayBuffer());
  return out;
}

/** Бичлэгийн ТҮҮХИЙ байтууд; байхгүй бол null. */
export async function readZipEntry(bytes: Uint8Array, name: string): Promise<Uint8Array | null> {
  const entry = listZipEntries(bytes).find((e) => e.name === name);
  if (!entry) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const lo = entry.localOffset;
  if (lo + 30 > bytes.length || view.getUint32(lo, true) !== SIG_LOC) {
    throw new Error('zip: bad local header');
  }
  const nameLen = view.getUint16(lo + 26, true);
  const extraLen = view.getUint16(lo + 28, true);
  const start = lo + 30 + nameLen + extraLen;
  const raw = bytes.subarray(start, start + entry.compressedSize);
  if (entry.method === 0) return raw;
  if (entry.method === 8) return inflateRaw(raw);
  throw new Error(`zip: unsupported method ${entry.method}`);
}

/** Текст бичлэг (XML) — UTF-8. */
export async function readZipText(bytes: Uint8Array, name: string): Promise<string | null> {
  const data = await readZipEntry(bytes, name);
  return data ? new TextDecoder().decode(data) : null;
}
