/**
 * Утасны камерын зургийг байршуулахын өмнө жижигрүүлэх.
 *
 * Яагаад заавал: орчин үеийн утасны нэг кадр 3-12 МБ.  Талбайн нэг
 * тайланд 10 зураг = ~40 МБ, барилгын талбайн нэг зураас LTE дээр энэ
 * нь «явахгүй».  1600px @ q0.8 ≈ 250-450 КБ → нийт ~3.5 МБ болно.
 * A4 хэвлэлтийн ~85 мм нүдэнд 1600px ≈ 480dpi — цаасны нягтралаас
 * хол их тул чанар алдагдахгүй.
 *
 * ⚠️ Мөн энэ функц бол HEIC-ийн ШИЙДЭЛ.  iPhone анхдагчаар `image/heic`
 *    өгдөг; `POST /api/upload`-ийн single-shot зам нь `file.type`-ыг
 *    ШАЛГАЛГҮЙ R2 руу бичдэг (`safeMediaContentType` зөвхөн multipart
 *    замд ажилладаг).  Тэгвэл Windows/Chrome дээрх админ болон хэвлэх
 *    хуудсанд эвдэрсэн зургийн дүрс гарна.  Safari нь HEIC-ийг canvas
 *    руу декодлож чаддаг тул энд болзолгүйгээр JPEG болгон дахин
 *    кодлосноор асуудал R2 хүртэл хүрэхгүй.  `heic2any` (≈1 МБ chunk)
 *    нэмэх шаардлагагүй — зураг авсан төхөөрөмж дээрээ л боловсруулагдана.
 */

/** Дахин кодлохгүй өнгөрөөх дээд хэмжээ (аль хэдийн жижиг зургийг муутгахгүй). */
const SKIP_BELOW_BYTES = 400_000;

const PASSTHROUGH_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

export class UnsupportedImageError extends Error {
  constructor() {
    super('Unsupported image format');
    this.name = 'UnsupportedImageError';
  }
}

export interface DownscaleOptions {
  /** Уртаашаа талын дээд пиксел (анхдагч 1600). */
  maxEdge?: number;
  /** JPEG чанар 0-1 (анхдагч 0.8). */
  quality?: number;
}

/**
 * Зургийг жижигрүүлж JPEG болгоно.  Декодлож чадахгүй бол
 * `UnsupportedImageError` шиднэ — эх файлыг чимээгүй байршуулбал
 * дараа нь эвдэрсэн зураг болж гарна.
 */
export async function downscaleImage(file: File, opts: DownscaleOptions = {}): Promise<File> {
  const maxEdge = opts.maxEdge ?? 1600;
  const quality = opts.quality ?? 0.8;

  if (file.size < SKIP_BELOW_BYTES && PASSTHROUGH_TYPES.has(file.type)) return file;

  const bitmap = await decode(file);
  try {
    const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new UnsupportedImageError();
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bitmap, 0, 0, w, h);

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', quality),
    );
    if (!blob) throw new UnsupportedImageError();

    const base = file.name.replace(/\.[^.]+$/, '') || 'photo';
    return new File([blob], `${base}.jpg`, { type: 'image/jpeg', lastModified: file.lastModified });
  } finally {
    if ('close' in bitmap && typeof bitmap.close === 'function') bitmap.close();
  }
}

/**
 * EXIF эргэлтийг хүндэтгэн декодлоно.  `imageOrientation: 'from-image'`
 * байхгүй бол хөрөг чиглэлтэй талбайн зургийн тал нь хажуугаараа хэвлэгдэнэ.
 */
async function decode(file: File): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch {
      /* доорх <img> руу шилжинэ */
    }
  }

  const url = URL.createObjectURL(file);
  try {
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new UnsupportedImageError());
      img.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}
