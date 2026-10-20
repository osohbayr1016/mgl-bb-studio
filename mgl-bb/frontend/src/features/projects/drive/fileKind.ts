/**
 * Drive-ын MIME → жагсаалтын дүрс/шошго.  Зөвхөн ХАРАГДАЦ — «яаж харуулах»
 * гэдгийг сервер шийдээд `preview` талбараар өгдөг (`types.ts`).
 */
export type DriveFileKind =
  | 'folder'
  | 'shortcut'
  | 'pdf'
  | 'image'
  | 'gdoc'
  | 'gsheet'
  | 'gslides'
  | 'word'
  | 'excel'
  | 'powerpoint'
  | 'cad'
  | 'archive'
  | 'text'
  | 'video'
  | 'other';

const EXACT: Record<string, DriveFileKind> = {
  'application/vnd.google-apps.folder': 'folder',
  'application/vnd.google-apps.shortcut': 'shortcut',
  'application/pdf': 'pdf',
  'application/vnd.google-apps.document': 'gdoc',
  'application/vnd.google-apps.spreadsheet': 'gsheet',
  'application/vnd.google-apps.presentation': 'gslides',
  'application/vnd.google-apps.drawing': 'image',
  'application/msword': 'word',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'word',
  'application/vnd.oasis.opendocument.text': 'word',
  'application/rtf': 'word',
  'application/vnd.ms-excel': 'excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'excel',
  'application/vnd.oasis.opendocument.spreadsheet': 'excel',
  'text/csv': 'excel',
  'application/vnd.ms-powerpoint': 'powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'powerpoint',
  'application/vnd.oasis.opendocument.presentation': 'powerpoint',
  'application/zip': 'archive',
  'application/x-zip-compressed': 'archive',
  'application/x-rar-compressed': 'archive',
  'application/vnd.rar': 'archive',
  'application/x-7z-compressed': 'archive',
  'application/acad': 'cad',
  'application/x-acad': 'cad',
  'application/autocad_dwg': 'cad',
  'image/vnd.dwg': 'cad',
  'image/x-dwg': 'cad',
  'application/dxf': 'cad',
  'application/x-dxf': 'cad',
  'image/vnd.dxf': 'cad',
  'application/x-revit': 'cad',
  'application/octet-stream': 'other',
};

const CAD_EXT = /\.(dwg|dxf|rvt|rfa|ifc|nwd|nwc|skp|3dm|dgn)$/i;
/** Drive `application/octet-stream` гэсэн (ERP-ээс хоосон `File.type`-тэй
 *  байршуулсан) файлын дүрсийг өргөтгөлөөр — сервер `previewPlan` ч мөн
 *  нэрээр нь таньдаг (`lib/projectDrive.ts effectiveMime`), тиймээс дүрс ба
 *  урьдчилан харах төлөвлөгөө зөрөхгүй. */
const EXT_KIND: [RegExp, DriveFileKind][] = [
  [/\.pdf$/i, 'pdf'],
  [/\.(docx?|rtf|odt)$/i, 'word'],
  [/\.(xlsx?|csv|ods)$/i, 'excel'],
  [/\.(pptx?|odp)$/i, 'powerpoint'],
  [/\.(jpe?g|png|gif|webp|bmp|tiff?|avif)$/i, 'image'],
  [/\.(mp4|webm|mov|avi|mkv)$/i, 'video'],
  [/\.(txt|md|json|xml|log)$/i, 'text'],
  [/\.(zip|rar|7z)$/i, 'archive'],
];

export function driveFileKind(mime: string, name = ''): DriveFileKind {
  const exact = EXACT[mime];
  if (exact && exact !== 'other') return exact;
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('text/')) return 'text';
  if (CAD_EXT.test(name)) return 'cad';
  for (const [re, kind] of EXT_KIND) if (re.test(name)) return kind;
  return 'other';
}

/** Хүснэгтийн «Төрөл» багана — орчуулгын түлхүүр. */
export function driveKindLabelKey(kind: DriveFileKind): string {
  return `projectDrive.kind_${kind}`;
}

/** Өргөтгөл байхгүй Google файлд ч уншигдахуйц нэр — татахад ашиглана. */
export function downloadName(name: string, kind: DriveFileKind): string {
  if (kind === 'gdoc' || kind === 'gsheet' || kind === 'gslides') return `${name}.pdf`;
  return name;
}

/** .docx (Word OOXML) — «Google Docs болгох» ба navy текстийн засвар зөвхөн
 *  үүнд (`docxAutoText.ts`).  Хоосон `File.type`-тэй байршуулсан нь octet-stream. */
export function isDocxFile(mime: string, name: string): boolean {
  return (
    mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    (mime === 'application/octet-stream' && /\.docx$/i.test(name))
  );
}
