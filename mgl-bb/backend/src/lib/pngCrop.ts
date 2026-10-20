/**
 * Гарын үсгийн PNG-ийг баримтад бэлтгэх — БЭХНИЙ хүрээгээр тайрч, «цаас»
 * пикселийг тунгалаг болгоно.  Сервер талын `frontend/src/shared/lib/trimInk.ts`
 * (ижил «цаас» босго: alpha < 20 эсвэл гэрэлтэлт > 242).
 *
 * Яагаад: профайлын хуучин гарын үсгүүд их хэмжээний хоосон зайтай (прод
 * 2026-10-01: 554×739 зурагт бэх нь ~30%), Word-д 12 мм өндрөөр суулгахад
 * бэх нь хэдхэн мм болж үл ялгарна.  Frontend нь зөвхөн ХАРУУЛАХДАА тайрдаг
 * (`cropInkUrl`) — баримтад суух байт энд тайрагдана.
 *
 * Хамаарал нэмэхгүй: `DecompressionStream/CompressionStream('deflate')`
 * (zlib) + өөрийн CRC.  Дэмжих: interlace-гүй, 8/16 битийн саарал / RGB /
 * саарал+α / RGBA, 1/2/4/8 битийн палитр.  Бусад (Adam7, хэт том) → null,
 * дуудагч эх зургаа хэрэглэнэ — тайралт бол зөвхөн гоо сайхны ажил.
 */
import { crc32 } from './zipPatch';

const SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
/** Үүнээс олон пикселтэй зургийг тайрахгүй (санах ой: RGBA ×4 байт). */
export const CROP_MAX_PIXELS = 6_000_000;

interface Header {
  width: number;
  height: number;
  bitDepth: number;
  colorType: number;
  interlace: number;
}

async function inflateZlib(data: Uint8Array): Promise<Uint8Array> {
  const ds = new DecompressionStream('deflate');
  const w = ds.writable.getWriter();
  void w.write(data);
  void w.close();
  return new Uint8Array(await new Response(ds.readable).arrayBuffer());
}

async function deflateZlib(data: Uint8Array): Promise<Uint8Array> {
  const cs = new CompressionStream('deflate');
  const w = cs.writable.getWriter();
  void w.write(data);
  void w.close();
  return new Uint8Array(await new Response(cs.readable).arrayBuffer());
}

function channelsOf(colorType: number): number {
  switch (colorType) {
    case 0:
      return 1;
    case 2:
      return 3;
    case 3:
      return 1;
    case 4:
      return 2;
    case 6:
      return 4;
    default:
      return 0;
  }
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

/** Бүх мөрийг шүүлтүүрээс буцаана → мөр бүрийн түүхий байт. */
function unfilter(raw: Uint8Array, h: Header): Uint8Array[] | null {
  const bitsPerPixel = channelsOf(h.colorType) * h.bitDepth;
  const bpp = Math.max(1, Math.ceil(bitsPerPixel / 8));
  const stride = Math.ceil((h.width * bitsPerPixel) / 8);
  const rows: Uint8Array[] = [];
  let prev = new Uint8Array(stride);
  let p = 0;
  for (let y = 0; y < h.height; y++) {
    if (p + 1 + stride > raw.length) return null;
    const ft = raw[p]!;
    const line = raw.slice(p + 1, p + 1 + stride);
    p += 1 + stride;
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? line[i - bpp]! : 0;
      const b = prev[i]!;
      const c = i >= bpp ? prev[i - bpp]! : 0;
      let v = line[i]!;
      if (ft === 1) v += a;
      else if (ft === 2) v += b;
      else if (ft === 3) v += (a + b) >> 1;
      else if (ft === 4) v += paeth(a, b, c);
      else if (ft !== 0) return null;
      line[i] = v & 0xff;
    }
    rows.push(line);
    prev = line;
  }
  return rows;
}

/** Нэг пикселийн RGBA (8 бит). */
function pixelReader(h: Header, palette: Uint8Array | null, trns: Uint8Array | null) {
  const ch = channelsOf(h.colorType);
  const d = h.bitDepth;
  return (row: Uint8Array, x: number): [number, number, number, number] => {
    if (h.colorType === 3) {
      const bit = x * d;
      const byte = row[bit >> 3] ?? 0;
      const idx = d === 8 ? byte : (byte >> (8 - d - (bit & 7))) & ((1 << d) - 1);
      const r = palette?.[idx * 3] ?? 0;
      const g = palette?.[idx * 3 + 1] ?? 0;
      const b = palette?.[idx * 3 + 2] ?? 0;
      const a = trns && idx < trns.length ? trns[idx]! : 255;
      return [r, g, b, a];
    }
    const bytesPer = d / 8;
    const at = (c: number) => row[(x * ch + c) * bytesPer] ?? 0; // 16 бит → дээд байт
    if (h.colorType === 0) {
      const v = at(0);
      return [v, v, v, 255];
    }
    if (h.colorType === 4) {
      const v = at(0);
      return [v, v, v, at(1)];
    }
    if (h.colorType === 2) return [at(0), at(1), at(2), 255];
    return [at(0), at(1), at(2), at(3)];
  };
}

function isPaper(r: number, g: number, b: number, a: number): boolean {
  if (a < 20) return true;
  return 0.299 * r + 0.587 * g + 0.114 * b > 242;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const v = new DataView(out.buffer);
  v.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  v.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

export interface CropResult {
  bytes: Uint8Array;
  width: number;
  height: number;
  /** Бэхний хүрээгээр тайрсан эсэх (үгүй бол зөвхөн дэвсгэр тунгалаг болсон). */
  cropped: boolean;
}

interface Decoded {
  header: Header;
  rows: Uint8Array[];
  px: (row: Uint8Array, x: number) => [number, number, number, number];
}

async function decodePng(bytes: Uint8Array): Promise<Decoded | null> {
  if (bytes.length < 33 || SIG.some((b, i) => bytes[i] !== b)) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let p = 8;
  let header: Header | null = null;
  let palette: Uint8Array | null = null;
  let trns: Uint8Array | null = null;
  const idat: Uint8Array[] = [];
  while (p + 8 <= bytes.length) {
    const len = view.getUint32(p);
    const type = String.fromCharCode(bytes[p + 4]!, bytes[p + 5]!, bytes[p + 6]!, bytes[p + 7]!);
    const data = bytes.subarray(p + 8, p + 8 + len);
    if (type === 'IHDR') {
      const v = new DataView(data.buffer, data.byteOffset, data.byteLength);
      header = {
        width: v.getUint32(0),
        height: v.getUint32(4),
        bitDepth: data[8]!,
        colorType: data[9]!,
        interlace: data[12]!,
      };
    } else if (type === 'PLTE') palette = data;
    else if (type === 'tRNS') trns = data;
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    p += 12 + len;
  }
  if (!header || header.interlace !== 0 || channelsOf(header.colorType) === 0) return null;
  if (header.width * header.height > CROP_MAX_PIXELS) return null;
  const okDepth =
    header.colorType === 3 ? [1, 2, 4, 8].includes(header.bitDepth) : header.bitDepth === 8 || header.bitDepth === 16;
  if (!okDepth || (header.colorType === 3 && !palette)) return null;

  const total = idat.reduce((n, d) => n + d.length, 0);
  const joined = new Uint8Array(total);
  let o = 0;
  for (const d of idat) {
    joined.set(d, o);
    o += d.length;
  }
  let rows: Uint8Array[] | null;
  try {
    rows = unfilter(await inflateZlib(joined), header);
  } catch {
    return null;
  }
  if (!rows) return null;
  return { header, rows, px: pixelReader(header, palette, trns) };
}

async function encodeRgbaPng(raw: Uint8Array, w: number, h: number): Promise<Uint8Array> {
  const ihdr = new Uint8Array(13);
  const iv = new DataView(ihdr.buffer);
  iv.setUint32(0, w);
  iv.setUint32(4, h);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const parts = [new Uint8Array(SIG), chunk('IHDR', ihdr), chunk('IDAT', await deflateZlib(raw)), chunk('IEND', new Uint8Array(0))];
  const size = parts.reduce((n, x) => n + x.length, 0);
  const out = new Uint8Array(size);
  let k = 0;
  for (const part of parts) {
    out.set(part, k);
    k += part.length;
  }
  return out;
}

/**
 * Гарын үсгийн PNG-ийг баримтад бэлтгэнэ: бэхний хүрээгээр тайрч (бэх нь
 * бараг бүтэн зураг бол тайрахгүй), «цаас» пикселийг ТУНГАЛАГ болгоно —
 * цагаан дэвсгэр хүснэгтийн шугамыг дардаг байсан (Word-оор хэмжсэн
 * 2026-10-01).  Бэхгүй / дэмжихгүй хэлбэр → null (дуудагч эхийг хэрэглэнэ).
 */
export async function prepareSignaturePng(bytes: Uint8Array): Promise<CropResult | null> {
  const dec = await decodePng(bytes);
  if (!dec) return null;
  const { header, rows, px } = dec;
  const { width, height } = header;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y++) {
    const row = rows[y]!;
    for (let x = 0; x < width; x++) {
      const [r, g, b, a] = px(row, x);
      if (isPaper(r, g, b, a)) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0) return null;
  const pad = 3;
  let x0 = Math.max(0, minX - pad);
  let y0 = Math.max(0, minY - pad);
  let w = Math.min(width, maxX + 1 + pad) - x0;
  let h = Math.min(height, maxY + 1 + pad) - y0;
  const cropped = w * h <= width * height * 0.9;
  if (!cropped) {
    x0 = 0;
    y0 = 0;
    w = width;
    h = height;
  }

  // RGBA 8 бит, мөр бүр «None» шүүлтүүртэй; цаас → тунгалаг.
  const raw = new Uint8Array(h * (1 + w * 4));
  let q = 0;
  for (let y = y0; y < y0 + h; y++) {
    raw[q++] = 0;
    const row = rows[y]!;
    for (let x = x0; x < x0 + w; x++) {
      const [r, g, b, a] = px(row, x);
      const paper = isPaper(r, g, b, a);
      raw[q++] = r;
      raw[q++] = g;
      raw[q++] = b;
      raw[q++] = paper ? 0 : a;
    }
  }
  return { bytes: await encodeRgbaPng(raw, w, h), width: w, height: h, cropped };
}
