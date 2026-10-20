/**
 * Текст файлын кодчлолыг илрүүлэх — «Нэмэлт» гэх мэт кирилл текст Chrome-д
 * зөв харагдуулахын тулд.
 *
 * Асуудал: `.txt`-г хөтөч `text/plain` гэж илгээдэг ч charset ЯЛГААГҮЙ.
 * Charset заагаагүй `text/plain`-ыг Chrome өөрөө таамагладаг бөгөөд UTF-8
 * кирилл ихэвчлэн `Ð�Ñ�Ð¼...` болж эвдэрдэг.  Тиймээс байтыг нь хараад
 * charset-ыг ТОДОРХОЙ бичиж, R2-ийн метадатад хадгална.
 *
 * Монголд серверийн хуучин `.txt` нь UTF-8 эсвэл windows-1251 байдаг тул
 * ялгах дараалал нь: BOM → хүчинтэй UTF-8 мөн үү → үгүй бол windows-1251.
 */

export type TextCharset = 'utf-8' | 'utf-16le' | 'utf-16be' | 'windows-1251';

/** Chrome-д мөрөөр нь харуулах утгатай өргөтгөлүүд. */
const TEXT_EXT = new Set(['txt', 'log', 'md']);

export function isTextFileName(name: string): boolean {
  const i = name.lastIndexOf('.');
  return i >= 0 && TEXT_EXT.has(name.slice(i + 1).toLowerCase());
}

/** UTF-8 шалгахад уншиж үзэх дээд байт — том лог файлыг бүтнээр нь шалгахгүй. */
const SNIFF_BYTES = 64 * 1024;

export function detectCharset(input: ArrayBuffer | Uint8Array): TextCharset {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return 'utf-8';
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) return 'utf-16le';
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) return 'utf-16be';

  // `stream: true` нь сүүлчийн ТАСАРСАН олон байтын тэмдэгтийг алдаа гэж
  // үзэхгүй — тиймээс эхний хэсгийг л уншиж байгаа нь худал сөрөг өгөхгүй.
  const sample = bytes.length > SNIFF_BYTES ? bytes.subarray(0, SNIFF_BYTES) : bytes;
  try {
    // `ignoreBOM` нь workers-types-д заавал — BOM-той тохиолдлыг дээр
    // шийдсэн тул утга нь энд ач холбогдолгүй.
    new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(sample, { stream: true });
    return 'utf-8';
  } catch {
    return 'windows-1251';
  }
}

/** R2-д хадгалах / буцаах бүрэн content-type. */
export function textContentType(charset: TextCharset): string {
  return `text/plain; charset=${charset}`;
}

/** Хадгалсан content-type нь charset агуулж байна уу. */
export function hasCharset(contentType: string | null | undefined): boolean {
  return typeof contentType === 'string' && /;\s*charset=/i.test(contentType);
}
