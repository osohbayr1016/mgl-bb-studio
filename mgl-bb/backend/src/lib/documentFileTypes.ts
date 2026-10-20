/**
 * Архивт оруулж болох файл — ЦАГААН биш ХАР жагсаалт.
 *
 * Эзний шийдвэр (2026-09-03): серверийн бүтэн хавтсыг байгаагаар нь оруулах
 * учраас DWG, RVT, XLSX, PPTX, зураг, ZIP гэх мэт ажлын бүх файл орох ёстой.
 * Өмнөх `pdf|doc|docx` цагаан жагсаалт нь бодит хавтасны 90 гаруй хувийг
 * хаядаг байсан.
 *
 * Хориглосон цорын ганц зүйл нь АЖИЛЛАХ/СКРИПТ файл: `/media/<key>` нь
 * нэвтрэлтгүй, нийтэд ил зам (CLAUDE.md-ийн аюулгүй байдлын #2) тул тэнд
 * .exe/.ps1 байршуулбал компанийн итгэмжлэгдсэн домэйн малваре тараах
 * холбоос болно.  HTML/SVG-г `safeMediaContentType` аль хэдийн
 * `application/octet-stream` болгодог тул хөтөч рендерлэхгүй ч, ижил
 * шалтгаанаар мөн хориглов.
 *
 * ⚠️ Энэ файлын ихрийг `frontend/src/features/projects/documents/fileTypes.ts`
 * барьдаг — хоёулаа хамт өөрчлөгдөх ёстой.
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

/** Нэр солиход өргөтгөл алга болохоос сэргийлнэ. */
export function withOriginalExt(newName: string, oldName: string): string {
  const ext = fileExt(oldName);
  if (!ext) return newName.trim();
  const trimmed = newName.trim();
  if (fileExt(trimmed) === ext) return trimmed;
  return `${trimmed}.${ext}`;
}
