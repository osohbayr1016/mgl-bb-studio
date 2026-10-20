/**
 * Захиалагчийн илгээсэн файлын НЭРИЙГ систем өөрөө үүсгэнэ.
 *
 * ⚠️ ЗАРЧИМ: захиалагчаас файлаа зөв нэрлэхийг ХЭЗЭЭ Ч шаардахгүй.
 *    «Нэрлэх заавар»-ыг PDF-ээр илгээгээд «дагана уу» гэвэл 100% зөрчигдөж,
 *    эцэст нь бидэн рүү залгах болно — тэр дуудлагыг арилгах гэж энэ бүхнийг
 *    хийж байгаа юм.  Оронд нь маягтын талбаруудыг аваад нэрийг СЕРВЕР
 *    үүсгэнэ, анхны нэрийг `original_name`-д хадгална.
 *
 * Загварын токенууд (`client_submission_templates.filename_pattern`):
 *   {project_code}  төслийн код       MGL-251222
 *   {doc_type}      маягтын code      DAALGAVAR
 *   {discipline}    чиглэл            BA
 *   {yyyymmdd}      илгээсэн огноо    20260907
 *   {seq3}          дараалал          001
 *   {rev}           хувилбар          A
 *   {orig}          анхны нэр         geologi_tailan
 *
 * Хоосон токен нь ГАНЦААРАА алга болдоггүй — түүний өмнөх зураас хамт
 * арилна, эс тэгвэл `MGL-251222--20260907-001` шиг давхар зураас үлдэнэ.
 */

/** Кирилл → латин.  Файлын нэр ASCII байх нь DWG/RVT-ийн хуучин хэрэгслүүд
 *  болон R2 түлхүүрийн хувьд аюулгүй. */
const CYR: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'yo', ж: 'j', з: 'z',
  и: 'i', й: 'i', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', ө: 'o', п: 'p',
  р: 'r', с: 's', т: 't', у: 'u', ү: 'u', ф: 'f', х: 'h', ц: 'ts', ч: 'ch',
  ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
};

export function translit(input: string): string {
  let out = '';
  for (const ch of input) {
    const lower = ch.toLowerCase();
    const mapped = CYR[lower];
    if (mapped === undefined) {
      out += ch;
      continue;
    }
    // Том үсгийг том үсгээр (Ө → O, Ц → Ts).
    out += ch === lower ? mapped : mapped.charAt(0).toUpperCase() + mapped.slice(1);
  }
  return out;
}

/** Файлын нэрэнд зөвшөөрөгдөх тэмдэгт рүү буулгана. */
export function slugPart(raw: string, maxLen = 40): string {
  const ascii = translit(String(raw ?? ''));
  const cleaned = ascii
    .replace(/[^A-Za-z0-9._-]+/g, '_')
    .replace(/_{2,}/g, '_')
    .replace(/^[_.-]+|[_.-]+$/g, '');
  return cleaned.slice(0, maxLen);
}

/** Өргөтгөл (цэггүй, жижиг үсгээр). */
export function fileExt(fileName: string): string {
  const i = fileName.lastIndexOf('.');
  return i > 0 ? fileName.slice(i + 1).toLowerCase() : '';
}

/** Өргөтгөлгүй үндсэн нэр. */
export function baseName(fileName: string): string {
  const i = fileName.lastIndexOf('.');
  return i > 0 ? fileName.slice(0, i) : fileName;
}

/**
 * Төслийн нэрнээс кодыг гаргана.
 *
 * Бодит нэр: `MGL-251222-МАКС ӨРГӨӨ-ДАХИН ТӨЛӨВЛӨЛТ_AZ` → `MGL-251222`.
 * Загварт нийцэхгүй нэрийг эхний хэсгээр нь товчилно.
 */
export function projectCode(projectName: string): string {
  const name = String(projectName ?? '').trim();
  const m = /^([A-Za-z]{2,5}-\d{4,10})/.exec(name);
  if (m && m[1]) return m[1].toUpperCase();
  const first = slugPart(name.split(/[\s_/-]+/)[0] ?? '', 12);
  return first || 'PROJECT';
}

export interface FileNameTokens {
  project_code: string;
  doc_type: string;
  discipline?: string | null;
  /** `YYYY-MM-DD` (UB огноо) — доторх зураасыг өөрөө арилгана. */
  date: string;
  seq: number;
  rev?: string | null;
  original: string;
}

const TOKEN_RE = /\{(project_code|doc_type|discipline|yyyymmdd|seq3|rev|orig)\}/g;

/**
 * Загварыг утгуудаар дүүргэж, өргөтгөлийг нь залгана.
 *
 * Буцаах утга нь өргөтгөлтэй БҮТЭН нэр.  Өргөтгөл нь анхны файлынхаа
 * өргөтгөл хэвээр үлдэнэ — өргөтгөл солих нь файлыг эвдэнэ.
 */
export function buildFileName(pattern: string, tokens: FileNameTokens, originalName: string): string {
  const values: Record<string, string> = {
    project_code: slugPart(tokens.project_code, 24),
    doc_type: slugPart(tokens.doc_type, 20).toUpperCase(),
    discipline: slugPart(tokens.discipline ?? '', 8).toUpperCase(),
    yyyymmdd: String(tokens.date ?? '').replace(/-/g, '').slice(0, 8),
    seq3: String(Math.max(0, Math.trunc(tokens.seq))).padStart(3, '0'),
    rev: slugPart(tokens.rev ?? '', 6).toUpperCase(),
    orig: slugPart(baseName(tokens.original || originalName), 40),
  };

  let out = String(pattern ?? '').replace(TOKEN_RE, (_all, key: string) => values[key] ?? '');

  // Хоосон токеноос үлдсэн давхар/эцсийн зураасыг цэвэрлэнэ.
  out = out
    .replace(/-{2,}/g, '-')
    .replace(/_{2,}/g, '_')
    .replace(/^[-_]+|[-_]+$/g, '');

  if (!out) out = values.orig || 'file';

  const ext = fileExt(originalName);
  return ext ? `${out}.${ext}` : out;
}

/**
 * Нэг илгээмжид олон файл орвол нэр давхардана.  Хоёр дахиас нь эхлэн
 * `-2`, `-3` дугаар нэмнэ (өргөтгөлийн ӨМНӨ).
 */
export function dedupeNames(names: string[]): string[] {
  const seen = new Map<string, number>();
  return names.map((name) => {
    const key = name.toLowerCase();
    const n = (seen.get(key) ?? 0) + 1;
    seen.set(key, n);
    if (n === 1) return name;
    const ext = fileExt(name);
    const base = baseName(name);
    return ext ? `${base}-${n}.${ext}` : `${base}-${n}`;
  });
}
