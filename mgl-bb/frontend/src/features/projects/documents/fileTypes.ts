export type DocKind = 'pdf' | 'doc' | 'docx' | 'other';

/**
 * ⚠️ Энэ жагсаалт нь `backend/src/lib/documentFileTypes.ts`-ийн ИХЭР —
 * хоёулаа хамт өөрчлөгдөх ёстой.  Хар жагсаалт болсон шалтгааныг тэнд бичсэн:
 * серверийн бүтэн хавтсыг оруулах учир DWG/RVT/XLSX/зураг/ZIP бүгд орно,
 * зөвхөн ажиллах/скрипт файлыг хориглоно.
 */
const BLOCKED_EXT = new Set([
  'exe', 'msi', 'bat', 'cmd', 'com', 'scr', 'pif', 'cpl', 'msc', 'lnk', 'reg',
  'dll', 'sys', 'drv', 'jar', 'app', 'apk', 'deb', 'rpm', 'dmg',
  'ps1', 'psm1', 'vbs', 'vbe', 'js', 'mjs', 'cjs', 'jse', 'wsf', 'wsh', 'hta',
  'sh', 'bash', 'php', 'phtml', 'asp', 'aspx', 'jsp', 'cgi',
  'html', 'htm', 'xhtml', 'shtml', 'svg',
]);

export function fileExt(fileName: string): string {
  const i = fileName.lastIndexOf('.');
  return i >= 0 ? fileName.slice(i + 1).toLowerCase() : '';
}

export function isAllowedDocFile(fileName: string): boolean {
  return !BLOCKED_EXT.has(fileExt(fileName));
}

export function docKind(fileName: string): DocKind {
  const ext = fileExt(fileName);
  if (ext === 'pdf' || ext === 'doc' || ext === 'docx') return ext;
  return 'other';
}

export function formatBytes(n: number | null | undefined): string {
  if (n == null || n < 0) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/** Файл сонгох цонхонд бүх төрлийг зөвшөөрнө — шалгалт нь хар жагсаалт. */
export const ACCEPT_DOCS = '*/*';
