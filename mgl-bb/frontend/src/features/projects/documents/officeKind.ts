/**
 * Файлыг Google-ийн аль засварлагчаар нээхийг өргөтгөлөөс нь тодорхойлно.
 *
 * ⚠️ Энэ жагсаалт нь `backend/src/lib/officeDocs.ts`-ийн ИХЭР — хоёулаа хамт
 * өөрчлөгдөх ёстой.  Front-end нь зөвхөн «энэ мөрд Google товч гаргах уу,
 * ямар дүрс/шошго харуулах уу» гэдгийг мэдэх хэрэгтэй тул MIME болон
 * экспортын талбарууд энд БАЙХГҮЙ — тэдгээр нь зөвхөн серверийн асуудал.
 *
 * Шийдвэрийн эрх нь СЕРВЕРТ: `GET /documents/:id/office` нь `office` талбарт
 * жинхэнэ хариугаа буцаадаг.  Энэ модуль нь зөвхөн серверт дуудахаас өмнөх
 * хямд таамаглал — жагсаалт зөрвөл товч харагдаад дараа нь 400 өгнө.
 */
export type OfficeKind = 'doc' | 'sheet' | 'slide';

const BY_EXT: Record<string, OfficeKind> = {
  doc: 'doc',
  docx: 'doc',
  odt: 'doc',
  rtf: 'doc',
  txt: 'doc',
  xls: 'sheet',
  xlsx: 'sheet',
  ods: 'sheet',
  csv: 'sheet',
  ppt: 'slide',
  pptx: 'slide',
  odp: 'slide',
};

function extOf(fileName: string): string {
  const i = fileName.lastIndexOf('.');
  return i >= 0 ? fileName.slice(i + 1).toLowerCase() : '';
}

export function officeKind(fileName: string | null | undefined): OfficeKind | null {
  if (!fileName) return null;
  return BY_EXT[extOf(fileName)] ?? null;
}

/** Урьдчилан харах цонхонд юу үзүүлэхийг шийднэ.
 *  `office` нь серверээс PDF болгож хөрвүүлэхийг шаардана. */
export type PreviewKind = 'pdf' | 'image' | 'office' | 'none';

const IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'bmp']);

export function previewKind(fileName: string | null | undefined): PreviewKind {
  if (!fileName) return 'none';
  const ext = extOf(fileName);
  if (ext === 'pdf') return 'pdf';
  if (IMAGE_EXT.has(ext)) return 'image';
  // SVG-г зориудаар зураг гэж үзэхгүй — архивын бусад хэсэгтэй ижил бодлого
  // (SVG нь скрипт агуулж чаддаг тул хориотой өргөтгөлийн жагсаалтад бий).
  if (BY_EXT[ext]) return 'office';
  return 'none';
}
