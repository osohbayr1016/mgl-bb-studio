/**
 * Зургийн АВСАН ОГНООГ уншина — EXIF `DateTimeOriginal`, байхгүй бол файлын
 * `lastModified`.
 *
 * Яагаад тусдаа: `downscaleImage` нь зургийг canvas-аар ДАХИН КОДЛОДОГ тул
 * R2-д хүрэх файлд EXIF байхгүй.  Огноог байршуулахаас ӨМНӨ, ЭХ файлаас
 * уншиж, зургийн мета өгөгдөл (`AsrPhoto.taken_at`) болгон хадгална —
 * эх зургийн байт хөндөгдөхгүй.
 *
 * Гаралт нь `YYYY-MM-DDTHH:mm:ss` — камерын/утасны ХАНАНЫ ЦАГ, бүсгүй.
 * (2026-09-25-аас СЕКУНДТЭЙ — эзний хүсэлт: зургийн тэмдэг «он сар өдөр цаг
 * минут секунд».  Өмнөх `YYYY-MM-DDTHH:mm` утга хүчинтэй хэвээр.)  EXIF
 * өөрөө бүсийн мэдээлэлгүй тул хөрвүүлэх зүйл байхгүй; `lastModified`-ыг
 * хөтчийн локал цагаар форматлана (талбайн утас УБ цагтай).
 *
 * ⚠️ `@/` импорт ЗОРИУДААР байхгүй — `scripts/check-asr-photo-stamp.mjs`
 *    энэ файлыг Node дээр шууд ачаалж шалгадаг.
 */

/** JPEG SOI + APP1 «Exif\0\0» толгойг хайх дээд хэмжээ. */
const HEAD_BYTES = 256 * 1024;

const TAG_EXIF_IFD = 0x8769;
const TAG_DATETIME_ORIGINAL = 0x9003;
const TAG_DATETIME = 0x0132;

function readDateAt(view: DataView, at: number): string | null {
  if (at < 0 || at + 19 > view.byteLength) return null;
  let s = '';
  for (let i = 0; i < 19; i++) s += String.fromCharCode(view.getUint8(at + i));
  // «YYYY:MM:DD HH:MM:SS»
  const m = /^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(s);
  if (!m) return null;
  return normalizeTakenAt(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}`);
}

/**
 * Хэлбэр + утгын хяналт.  Цаг нь тохируулаагүй камер «2000-01-01»,
 * «1970-…» гэх мэт утга өгдөг — тэднийг хаяж, дуудагч `lastModified` руу
 * унана.  Ирээдүйн огноо ч мөн (буруу тохируулсан цаг).
 */
export function normalizeTakenAt(v: unknown, now: Date = new Date()): string | null {
  if (typeof v !== 'string') return null;
  // Секунд СОНГОЛТТОЙ: 2026-09-25-аас өмнөх утгууд `HH:mm` хэлбэртэй.
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(v);
  if (!m) return null;
  const y = +m[1]!;
  const mo = +m[2]!;
  const d = +m[3]!;
  const h = +m[4]!;
  const mi = +m[5]!;
  const sec = m[6] != null ? +m[6] : 0;
  if (y < 2005 || mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || sec > 59) {
    return null;
  }
  // Ирээдүй: нэг өдрийн зөрүү зөвшөөрнө (бүс, цагийн зөрүү).
  const asDate = new Date(y, mo - 1, d, h, mi, sec);
  if (Number.isNaN(asDate.getTime())) return null;
  if (asDate.getTime() > now.getTime() + 24 * 3600 * 1000) return null;
  return v;
}

/**
 * JPEG байтаас EXIF `DateTimeOriginal` (байхгүй бол `DateTime`) уншина.
 * Ямар ч алдаанд `null` — шидэхгүй.  JPEG биш (HEIC, PNG, WebP) бол `null`.
 */
export function parseExifTakenAt(bytes: ArrayBuffer | Uint8Array): string | null {
  const buf =
    bytes instanceof Uint8Array
      ? new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
      : new DataView(bytes);
  try {
    if (buf.byteLength < 4 || buf.getUint16(0) !== 0xffd8) return null;
    let p = 2;
    while (p + 4 <= buf.byteLength) {
      if (buf.getUint8(p) !== 0xff) return null;
      const marker = buf.getUint8(p + 1);
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
        p += 2;
        continue;
      }
      if (marker === 0xda || marker === 0xd9) return null; // SOS / EOI — EXIF-ийн ард
      const len = buf.getUint16(p + 2);
      if (marker === 0xe1 && len >= 16) {
        const tiff = p + 4 + 6; // «Exif\0\0»-ийн ард
        if (
          buf.getUint8(p + 4) === 0x45 && // E
          buf.getUint8(p + 5) === 0x78 && // x
          buf.getUint8(p + 6) === 0x69 && // i
          buf.getUint8(p + 7) === 0x66 // f
        ) {
          return parseTiff(buf, tiff, p + 2 + len);
        }
      }
      p += 2 + len;
    }
    return null;
  } catch {
    return null;
  }
}

function parseTiff(view: DataView, tiff: number, end: number): string | null {
  const limit = Math.min(end, view.byteLength);
  if (tiff + 8 > limit) return null;
  const order = view.getUint16(tiff);
  const le = order === 0x4949; // «II»
  if (!le && order !== 0x4d4d) return null;
  const u16 = (at: number) => view.getUint16(at, le);
  const u32 = (at: number) => view.getUint32(at, le);
  if (u16(tiff + 2) !== 0x2a) return null;
  const ifd0 = tiff + u32(tiff + 4);

  const scan = (ifd: number, want: number): number | null => {
    if (ifd < tiff || ifd + 2 > limit) return null;
    const n = u16(ifd);
    for (let i = 0; i < n; i++) {
      const e = ifd + 2 + i * 12;
      if (e + 12 > limit) return null;
      if (u16(e) === want) return e;
    }
    return null;
  };
  const asciiValueAt = (entry: number): number | null => {
    const type = u16(entry + 2);
    const count = u32(entry + 4);
    if (type !== 2 || count < 19) return null;
    // ASCII 20 байт нь 4-өөс урт тул үргэлж offset-оор
    return tiff + u32(entry + 8);
  };

  const exifPtr = scan(ifd0, TAG_EXIF_IFD);
  if (exifPtr != null) {
    const exifIfd = tiff + u32(exifPtr + 8);
    const e = scan(exifIfd, TAG_DATETIME_ORIGINAL);
    if (e != null) {
      const at = asciiValueAt(e);
      const v = at != null ? readDateAt(view, at) : null;
      if (v) return v;
    }
  }
  const e0 = scan(ifd0, TAG_DATETIME);
  if (e0 != null) {
    const at = asciiValueAt(e0);
    return at != null ? readDateAt(view, at) : null;
  }
  return null;
}

/** `Date` → `YYYY-MM-DDTHH:mm:ss` (локал цаг). */
export function localTakenAt(d: Date): string | null {
  if (Number.isNaN(d.getTime())) return null;
  const p = (n: number) => String(n).padStart(2, '0');
  return normalizeTakenAt(
    `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`,
  );
}

/**
 * Файлын авсан огноо: EXIF → `lastModified` → `null`.  Хэзээ ч шидэхгүй —
 * огноо олдохгүй бол зураг хэвээр байршина, тайлангийн огноо нөхнө.
 */
export async function readPhotoTakenAt(file: File): Promise<string | null> {
  try {
    if (file.type === 'image/jpeg' || file.type === 'image/jpg' || /\.jpe?g$/i.test(file.name)) {
      const head = await file.slice(0, HEAD_BYTES).arrayBuffer();
      const exif = parseExifTakenAt(head);
      if (exif) return exif;
    }
  } catch {
    /* EXIF алга — доош */
  }
  return file.lastModified ? localTakenAt(new Date(file.lastModified)) : null;
}
