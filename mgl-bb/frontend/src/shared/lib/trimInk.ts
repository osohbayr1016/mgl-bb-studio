/** Цаасан/тунгалаг пиксел — бэх биш. */
function isPaper(r: number, g: number, b: number, a: number): boolean {
  if (a < 20) return true;
  return 0.299 * r + 0.587 * g + 0.114 * b > 242;
}

export type InkBox = { x: number; y: number; w: number; h: number };

/** Бэхний bounding box. Бараг бүтэн зураг бол null — тайрах шаардлагагүй. */
export function findInkBox(
  data: Uint8ClampedArray,
  width: number,
  height: number,
): InkBox | null {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if (isPaper(data[i]!, data[i + 1]!, data[i + 2]!, data[i + 3]!)) continue;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0) return null;
  const pad = 3;
  const x = Math.max(0, minX - pad);
  const y = Math.max(0, minY - pad);
  const w = Math.min(width, maxX + 1 + pad) - x;
  const h = Math.min(height, maxY + 1 + pad) - y;
  if (w * h > width * height * 0.9) return null;
  return { x, y, w, h };
}

function sourceSize(img: HTMLImageElement | HTMLCanvasElement): { width: number; height: number } {
  if (img instanceof HTMLImageElement) {
    return { width: img.naturalWidth, height: img.naturalHeight };
  }
  return { width: img.width, height: img.height };
}

/**
 * Цаасыг ТУНГАЛАГ болгоно (2026-10-12, эзэн: «гарын үсгийг PNG болго»).  Цагаан
 * дэвсгэртэй JPEG/PNG гарын үсэг баримт дээр цэгтэй мөр, хүснэгтийн шугамыг
 * цагаан тэгш өнцөгтөөр ДАРДАГ байв.  Цаасны пиксел → alpha 0; цаасанд ойрхон
 * (антиалиас) пиксел → гэрэлтэлтэй урвуу хамааралтай хагас тунгалаг — ирмэг
 * «шаржигнахгүй».  Аль хэдийн тунгалаг пиксел хөндөгдөхгүй.
 */
export function makePaperTransparent(data: Uint8ClampedArray): void {
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3]!;
    if (a === 0) continue;
    const lum = 0.299 * data[i]! + 0.587 * data[i + 1]! + 0.114 * data[i + 2]!;
    if (lum > 242) data[i + 3] = 0;
    else if (lum > 200) data[i + 3] = Math.round((a * (242 - lum)) / 42);
  }
}

export function cropInkFromImage(img: HTMLImageElement | HTMLCanvasElement): string | null {
  const { width, height } = sourceSize(img);
  if (width < 2 || height < 2) return null;
  const src = document.createElement('canvas');
  src.width = width;
  src.height = height;
  const ctx = src.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(img, 0, 0);
  let box: InkBox | null;
  try {
    const image = ctx.getImageData(0, 0, width, height);
    box = findInkBox(image.data, width, height);
    makePaperTransparent(image.data);
    ctx.putImageData(image, 0, 0);
  } catch {
    return null;
  }
  // Бэх бараг бүтэн зураг (тайрах юмгүй) байсан ч тунгалаг PNG буцаана.
  if (!box) return src.toDataURL('image/png');
  const out = document.createElement('canvas');
  out.width = box.w;
  out.height = box.h;
  const octx = out.getContext('2d');
  if (!octx) return null;
  octx.drawImage(src, box.x, box.y, box.w, box.h, 0, 0, box.w, box.h);
  return out.toDataURL('image/png');
}

function decodeImg(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('decode'));
    img.src = src;
  });
}

/** CORS-оор татаж бэхийг тайрна. Амжилтгүй бол null — эх зураг хэвээр. */
export async function cropInkUrl(src: string): Promise<string | null> {
  const res = await fetch(src, { mode: 'cors' });
  if (!res.ok) return null;
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  try {
    return cropInkFromImage(await decodeImg(url));
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function cropInkFile(file: File): Promise<File> {
  const url = URL.createObjectURL(file);
  try {
    const data = cropInkFromImage(await decodeImg(url));
    if (!data) return file;
    const blob = await (await fetch(data)).blob();
    return new File([blob], file.name.replace(/\.[^.]+$/, '') + '.png', { type: 'image/png' });
  } catch {
    return file;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Crop-ын дараах px-ийг mm болгож, хязгаарт (зөвхөн доош) тааруулна. */
export function fitInkDisplayMm(
  naturalW: number,
  naturalH: number,
  maxH: number,
  maxW: number,
  pxPerMm = 6,
): { heightMm: number; widthMm: number } | null {
  if (naturalW <= 0 || naturalH <= 0 || maxH <= 0 || maxW <= 0) return null;
  let h = naturalH / pxPerMm;
  let w = naturalW / pxPerMm;
  if (h > maxH) {
    w *= maxH / h;
    h = maxH;
  }
  if (w > maxW) {
    h *= maxW / w;
    w = maxW;
  }
  return { heightMm: h, widthMm: w };
}

/**
 * Баримт дээрх гарын үсгийн ЖИГД хэмжээ (2026-10-12, эзэн: «заримдаа хэт том,
 * заримдаа хэт жижиг — хүн A4 цаасан дээр гараар зурахад ямар харагддагаар»).
 *
 * Хүн A4 маягтын гарын үсгийн мөрөн дээр (10–11pt бичвэр, мөр ≈ 50 мм) зурахад
 * бэхний өндөр ихэвчлэн ≈ 10–14 мм (бичвэрийн мөрийн өндрийн 2–3 дахин), өргөн
 * 30–50 мм байдаг.  Зурсан төхөөрөмжийн пикселийн нягт (утас / хулгана / скан)
 * хоорондоо 3–10 дахин зөрдөг тул пикселээс мм бодох нь (`fitInkDisplayMm`)
 * хэмжээг тогтворгүй болгодог байв.  Тиймээс БЭХИЙГ тайрсны дараа зөвхөн
 * харьцаагаар нь: өндөр ≈ 12 мм, өргөн ≤ 44 мм (хэт урт гарын үсгийг өргөнөөр
 * нь багасгана), хэт нарийн/өндөр бол өргөн ≥ 18 мм хүртэл өндрийг 15 мм
 * хүртэл өсгөнө.  Томруулж ч, жижигрүүлж ч болно.
 */
export const SIGNATURE_MM = { height: 12, maxWidth: 44, minWidth: 18, maxHeight: 15 } as const;

export function signatureDisplayMm(
  naturalW: number,
  naturalH: number,
  box: { height: number; maxWidth: number; minWidth: number; maxHeight: number } = SIGNATURE_MM,
): { heightMm: number; widthMm: number } | null {
  if (naturalW <= 0 || naturalH <= 0) return null;
  const aspect = naturalW / naturalH;
  let h = box.height;
  let w = h * aspect;
  if (w > box.maxWidth) {
    w = box.maxWidth;
    h = w / aspect;
  } else if (w < box.minWidth) {
    h = Math.min(box.maxHeight, box.minWidth / aspect);
    w = h * aspect;
  }
  return { heightMm: Math.round(h * 10) / 10, widthMm: Math.round(w * 10) / 10 };
}

/** Зурах canvas дээрх цагаан хүрээг хайчилна. */
export function cropCanvasToInk(canvas: HTMLCanvasElement): void {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return;
  const { width, height } = canvas;
  const image = ctx.getImageData(0, 0, width, height);
  const box = findInkBox(image.data, width, height);
  // Хадгалах PNG тунгалаг дэвсгэртэй (2026-10-12) — ажилтны `SignatureCapture` ба
  // захиалагчийн `SignaturePad` хоёулаа цагаан будаж зурдаг тул энд арилгана.
  makePaperTransparent(image.data);
  ctx.putImageData(image, 0, 0);
  if (!box) return;
  const tmp = document.createElement('canvas');
  tmp.width = box.w;
  tmp.height = box.h;
  tmp.getContext('2d')!.drawImage(canvas, box.x, box.y, box.w, box.h, 0, 0, box.w, box.h);
  canvas.width = box.w;
  canvas.height = box.h;
  canvas.getContext('2d')!.drawImage(tmp, 0, 0);
}
