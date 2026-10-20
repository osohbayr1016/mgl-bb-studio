/**
 * Office файлыг Google-ийн ямар засварлагчаар нээхийг тодорхойлох ГАНЦ хүснэгт.
 *
 * Эзний шаардлага (2026-09-07): «файл нь Excel бол Google Sheets-ээр, Word бол
 * Google Docs-оор нээгдэх ёстой» — өөрөөр хэлбэл өргөтгөлөөс нь АВТОМАТААР
 * танина.  Тэр логик бүхэлдээ энд байна, өөр хаана ч давхардуулж бичихгүй.
 *
 * ⚠️ Энэ файлын ИХЭР нь `frontend/src/features/projects/documents/officeKind.ts`
 * — хоёулаа хамт өөрчлөгдөх ёстой (repo-гийн ихэр файлын конвенц).  Front-end
 * тал нь зөвхөн «энэ мөрд Google товч гаргах уу» гэдгийг мэдэхийн тулд `kind`-ыг
 * хэрэглэдэг тул MIME/URL талбарууд тэнд байхгүй.
 *
 * Яагаад PDF энд байхгүй вэ: PDF-ийг Google Doc болгож хөрвүүлэх нь бүтцийг нь
 * бүрэн задалдаг (баганан текст, тамга, гарын үсэг алдагдана) тул архивын PDF-ыг
 * ЗӨВХӨН уншина.  Урьдчилан харагдац нь ямар ч тохиолдолд PDF учир хөрвүүлэх
 * шаардлагагүй.
 */
export type OfficeKind = 'doc' | 'sheet' | 'slide';

export interface OfficeSpec {
  kind: OfficeKind;
  /** Drive рүү илгээхэд өгөх эх MIME. */
  sourceMime: string;
  /** Хөрвүүлсний дараах Google-ийн төрөл. */
  googleMime: string;
  /** Буцааж татахад ашиглах Office MIME (зөвхөн хөрвүүлсэн зам дээр). */
  exportMime: string;
  /** Буцаан татсан файлын өргөтгөл (зөвхөн хөрвүүлсэн зам дээр). */
  exportExt: string;
  /** `https://docs.google.com/<seg>/d/<id>/edit` дэх сегмент. */
  urlSegment: string;
  /**
   * ⚠️ ЭНЭ ТАЛБАР ХӨРВҮҮЛЭЛТИЙН АЛДАГДЛЫГ ШИЙДДЭГ (2026-09-07).
   *
   * `true` = Google Docs файлыг ХӨРВҮҮЛЭЛГҮЙГЭЭР, эх OOXML хэлбэрээр нь шууд
   * засна (Office editing mode).  `.docx` нь `.docx` хэвээрээ Drive дээр
   * суух бөгөөд realtime хамтын засвар ижилхэн ажиллана.
   *
   * Яагаад чухал вэ: хөрвүүлсэн үед Google-ийн хөрвүүлэгч Word-ийн агуулгын
   * жагсаалтын tab-stop + цэгэн залгаасыг задалдаг тул мөр нь тэгшилсэн
   * (justified) болж, үгс мөрийн өргөөнд сунан тарж уншигдахаа больдог.
   * Эзний хэмжсэн бодит алдаа — «google doc structure is incorrect».
   *
   * Хоёр дахь ашиг: буцааж татахдаа `files.export` биш `alt=media` ашигладаг
   * тул Drive-ын **10 MB-ийн экспортын хязгаар үйлчлэхгүй**.
   *
   * `false` = хуучин/бусад формат (.doc, .xls, .rtf, .odt, .csv…).  Google
   * тэдгээрийг эх хэлбэрээр нь засаж ЧАДДАГГҮЙ тул заавал хөрвүүлнэ, буцааж
   * татахад өргөтгөл нь орчин үеийнх рүү шилжинэ (.doc → .docx).
   */
  nativeEdit: boolean;
}

const DOC: Omit<OfficeSpec, 'sourceMime' | 'nativeEdit'> = {
  kind: 'doc',
  googleMime: 'application/vnd.google-apps.document',
  exportMime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  exportExt: 'docx',
  urlSegment: 'document',
};

const SHEET: Omit<OfficeSpec, 'sourceMime' | 'nativeEdit'> = {
  kind: 'sheet',
  googleMime: 'application/vnd.google-apps.spreadsheet',
  exportMime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  exportExt: 'xlsx',
  urlSegment: 'spreadsheets',
};

const SLIDE: Omit<OfficeSpec, 'sourceMime' | 'nativeEdit'> = {
  kind: 'slide',
  googleMime: 'application/vnd.google-apps.presentation',
  exportMime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  exportExt: 'pptx',
  urlSegment: 'presentation',
};

/** Өргөтгөл → эх MIME + аль засварлагч.  Drive нь эх MIME-ыг зөв өгөхийг
 *  шаарддаг: `application/octet-stream` илгээвэл хөрвүүлэлгүйгээр түүхий
 *  файл болгож хадгалдаг бөгөөд Docs-оор нээх боломжгүй болно. */
const BY_EXT: Record<string, OfficeSpec> = {
  // — Word —
  doc: { ...DOC, sourceMime: 'application/msword', nativeEdit: false },
  docx: {
    ...DOC,
    sourceMime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    nativeEdit: true,
  },
  odt: { ...DOC, sourceMime: 'application/vnd.oasis.opendocument.text', nativeEdit: false },
  rtf: { ...DOC, sourceMime: 'application/rtf', nativeEdit: false },
  txt: { ...DOC, sourceMime: 'text/plain', nativeEdit: false },
  // — Excel —
  xls: { ...SHEET, sourceMime: 'application/vnd.ms-excel', nativeEdit: false },
  xlsx: {
    ...SHEET,
    sourceMime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    nativeEdit: true,
  },
  ods: { ...SHEET, sourceMime: 'application/vnd.oasis.opendocument.spreadsheet', nativeEdit: false },
  csv: { ...SHEET, sourceMime: 'text/csv', nativeEdit: false },
  // — PowerPoint —
  ppt: { ...SLIDE, sourceMime: 'application/vnd.ms-powerpoint', nativeEdit: false },
  pptx: {
    ...SLIDE,
    sourceMime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    nativeEdit: true,
  },
  odp: { ...SLIDE, sourceMime: 'application/vnd.oasis.opendocument.presentation', nativeEdit: false },
};

/** Хадгалсан `kind`-аас тодорхойлолтыг сэргээнэ.  Буцааж татахад эх файлын
 *  нэр биш, холболтын `kind` нь эрх мэдэлтэй: Google дээрх хуулбар аль хэдийн
 *  тэр төрөл рүү хөрвөчихсөн байдаг (жишээ нь .doc → Google Doc → .docx). */
export const SPEC_BY_KIND: Record<OfficeKind, OfficeSpec> = {
  doc: BY_EXT.docx!,
  sheet: BY_EXT.xlsx!,
  slide: BY_EXT.pptx!,
};

export function specForKind(kind: string): OfficeSpec | null {
  return SPEC_BY_KIND[kind as OfficeKind] ?? null;
}

function extOf(fileName: string): string {
  const i = fileName.lastIndexOf('.');
  return i >= 0 ? fileName.slice(i + 1).toLowerCase() : '';
}

/** Office файл мөн үү — мөн бол бүрэн тодорхойлолтыг нь буцаана. */
export function officeSpec(fileName: string): OfficeSpec | null {
  return BY_EXT[extOf(fileName)] ?? null;
}

/** Google-ийн засварлагчийн хаяг.  Шинэ ТАБ-д нээнэ — iframe БОЛОХГҮЙ:
 *  (1) Google `/edit`-ийг frame-д оруулахыг хориглодог, (2) манай origin нь
 *  COEP `credentialless` тул гадаад iframe күүкигүй ачаалагдаж хэрэглэгч
 *  «нэвтрээгүй» болж харагдана.  COEP-ийг авах нь APS 3D үзүүлэгч болон push
 *  service worker-ийг унагана (CLAUDE.md). */
export function googleEditUrl(spec: OfficeSpec, fileId: string): string {
  return `https://docs.google.com/${spec.urlSegment}/d/${fileId}/edit`;
}

/** Буцаан татсан файлын нэр — өргөтгөлийг экспортын форматад тааруулна
 *  (.doc → .docx, .xls → .xlsx).  Эх нэрийг хадгална. */
export function exportedFileName(fileName: string, spec: OfficeSpec): string {
  const i = fileName.lastIndexOf('.');
  const stem = i > 0 ? fileName.slice(0, i) : fileName;
  return `${stem}.${spec.exportExt}`;
}
