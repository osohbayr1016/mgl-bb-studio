/**
 * Дотоод журмын хавсралт + бие — цэвэр туслахууд (миграц 0347).
 *
 * Хавсралтын өргөтгөлийн цагаан жагсаалт, хэмжээний хязгаар нь backend
 * `lib/internalRules.ts`-ийн `RULE_FILE_TYPES` / `RULE_FILE_MAX_BYTES`-ийн
 * ИХЭР — энд зөвхөн UX (байршуулахаас ӨМНӨ хэлэх); сервер жинхэнэ хаалга.
 */

/** Backend `RULE_FILE_TYPES`-ийн түлхүүрүүд — хамт өөрчил. */
export const RULE_FILE_EXTS = [
  'pdf',
  'doc',
  'docx',
  'xls',
  'xlsx',
  'ppt',
  'pptx',
  'odt',
  'ods',
  'rtf',
  'txt',
  'csv',
  'png',
  'jpg',
  'jpeg',
  'webp',
  'gif',
  'zip',
] as const;

/** Backend `RULE_FILE_MAX_BYTES`-ийн ихэр. */
export const RULE_FILE_MAX_BYTES = 30 * 1024 * 1024;
/** Backend `RULE_FILE_MAX_COUNT`-ийн ихэр. */
export const RULE_FILE_MAX_COUNT = 20;

export const RULE_FILE_ACCEPT = RULE_FILE_EXTS.map((e) => `.${e}`).join(',');

export function ruleFileExt(name: string): string {
  return /\.([a-z0-9]{1,5})$/i.exec(name.trim())?.[1]?.toLowerCase() ?? '';
}

export function isAllowedRuleFile(name: string): boolean {
  return (RULE_FILE_EXTS as readonly string[]).includes(ruleFileExt(name));
}

export type RuleFileKind = 'pdf' | 'image' | 'docx' | 'xlsx' | 'text' | 'other';

/** Урьдчилан харах арга.  SVG зориуд зураг биш (`AttachmentPreviews`-ийн бодлого). */
export function ruleFileKind(name: string, contentType = ''): RuleFileKind {
  const ext = ruleFileExt(name);
  const ct = contentType.toLowerCase();
  if (ext === 'pdf' || ct === 'application/pdf') return 'pdf';
  if (['png', 'jpg', 'jpeg', 'webp', 'gif'].includes(ext)) return 'image';
  if (ext === 'docx') return 'docx';
  if (ext === 'xlsx') return 'xlsx';
  if (ext === 'txt' || ext === 'csv') return 'text';
  return 'other';
}

export function isPreviewable(kind: RuleFileKind): boolean {
  return kind !== 'other';
}

/** `1.4 MB` маягийн богино хэмжээ. */
export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Blob-ийг файлаар хадгална (`downloadPdf`-ийн ижил anchor арга, нэр нь бидний мэдэх кирилл нэр). */
export function saveBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Зарим хөтөч click-ийн дараа шууд revoke хийвэл татахаа тасалдаг.
  window.setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/* ------------------------------------------------------------------ */
/*  0330-ийн markdown → засварлагчийн HTML                             */
/* ------------------------------------------------------------------ */

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function inline(text: string): string {
  // `**тод**`-оос бусад бүх зүйл энгийн текст — handbook `markdown.tsx`-тэй ижил дүрэм.
  return escapeHtml(text).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
}

/**
 * Хуучин (0330) markdown журмыг засварлагчид нээхэд HTML болгоно.  Синтакс нь
 * handbook-ийн жижиг рендерлэгчийнх ЯГ (`## `, `### `, `- `, `1. `, `**тод**`,
 * хоосон мөр = догол мөр) — уншигчид харагдаж байсан бүтэц алдагдахгүй.
 * Хадгалмагц `body_format = 'html'` болно.
 */
export function markdownToHtml(md: string): string {
  const out: string[] = [];
  let para: string[] = [];
  let listTag: 'ul' | 'ol' | null = null;
  let listItems: string[] = [];
  const flushPara = () => {
    if (para.length) out.push(`<p>${para.map(inline).join('<br>')}</p>`);
    para = [];
  };
  const flushList = () => {
    if (listTag) out.push(`<${listTag}>${listItems.map((i) => `<li>${inline(i)}</li>`).join('')}</${listTag}>`);
    listTag = null;
    listItems = [];
  };
  for (const raw of md.replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.trimEnd();
    const heading = /^(#{2,3})\s+(.*)$/.exec(line);
    const bullet = /^\s*[-*•]\s+(.*)$/.exec(line);
    const ordered = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (heading) {
      flushPara();
      flushList();
      const tag = heading[1] === '###' ? 'h3' : 'h2';
      out.push(`<${tag}>${inline(heading[2] ?? '')}</${tag}>`);
    } else if (bullet || ordered) {
      flushPara();
      const tag = bullet ? 'ul' : 'ol';
      if (listTag !== tag) {
        flushList();
        listTag = tag;
      }
      listItems.push((bullet ?? ordered)?.[1] ?? '');
    } else if (line.trim() === '') {
      flushPara();
      flushList();
    } else {
      flushList();
      para.push(line);
    }
  }
  flushPara();
  flushList();
  return out.join('');
}
