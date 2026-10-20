/**
 * Үндсэн төсөл (main project, migration 0281) — бодит төслийн бүртгэл.
 *
 * `projects`-ын мөр нь бодит төслийн НЭГ ангилал (AZ/ZA/EZ/ET/IZ); нэг барилга
 * хэд хэдэн мөртэй («MGL-251006 EVERGREEN» = AZ #41 + ZA #37).  Үндсэн төсөл
 * нь тэднийг нэгтгэж, баримт бичгийн Drive хавтсыг НЭГ газар холбоно.
 *
 * Энэ файлын цэвэр хэсэг (нэрээс код/суурь нэрийг ялгах) нь `mainProjects.test.ts`-д
 * тестлэгддэг; D1 хэсэг нь routes/mainProjects.ts + routes/projectDrive.ts-д.
 */
import { PROJECT_CATEGORY_CODES, type ProjectCategory } from './projectCategories';

/** Компанийн төслийн кодын хэлбэр — «MGL-251222».  Бүх 27 продакшны нэр
 *  үүгээр эхэлдэг (2026-09-11-нд хэмжсэн). */
const CODE_RE = /^(MGL-\d{6})/i;
const SEP = '[\\s_\\-–—:]+';
const CATEGORY_RE = new RegExp(`${SEP}(${PROJECT_CATEGORY_CODES.join('|')})$`, 'i');

export interface ParsedProjectName {
  /** «MGL-251222» эсвэл null. */
  code: string | null;
  /** Код ба ангиллын залгаваргүй, `_`-ийг зайгаар сольсон суурь нэр. */
  base: string;
  /** Нэрний төгсгөлийн ангиллын залгавар (`_AZ`, `-ZA`, ` IZ`). */
  category: ProjectCategory | null;
}

/**
 * «MGL-251222-МАКС ӨРГӨӨ-ДАХИН ТӨЛӨВЛӨЛТ_AZ» → { code: 'MGL-251222',
 * base: 'МАКС ӨРГӨӨ-ДАХИН ТӨЛӨВЛӨЛТ', category: 'AZ' }.
 *
 * Суурь нэрийн дотоод зураас хэвээр (нэрийн хэсэг байж болно); зөвхөн код ба
 * ангиллын хоорондох тусгаарлагч, `_` нь зай болно.
 */
export function parseProjectName(raw: string): ParsedProjectName {
  let s = raw.trim();
  let code: string | null = null;
  const cm = CODE_RE.exec(s);
  if (cm) {
    code = cm[1]!.toUpperCase();
    s = s.slice(cm[0].length);
  }
  let category: ProjectCategory | null = null;
  const catm = CATEGORY_RE.exec(s);
  if (catm) {
    category = catm[1]!.toUpperCase() as ProjectCategory;
    s = s.slice(0, catm.index);
  }
  const base = s
    .replace(/_/g, ' ')
    .replace(/^[\s\-–—:]+|[\s\-–—:]+$/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
  return { code, base, category };
}

/** Үндсэн төслийн санал болгох нэр — код + суурь нэр. */
export function suggestMainProjectName(p: ParsedProjectName): string {
  if (p.code && p.base) return `${p.code} ${p.base}`;
  return p.base || p.code || '';
}

/** Бүлэглэлтийн түлхүүр: код байвал код, эс бөгөөс суурь нэр (жижиг үсгээр). */
export function groupingKey(p: ParsedProjectName): string | null {
  if (p.code) return p.code;
  const b = p.base.toLowerCase();
  return b || null;
}

/* ------------------------------------------------------------------ */
/*  D1                                                                 */
/* ------------------------------------------------------------------ */

export interface MainProjectRow {
  id: number;
  code: string | null;
  name: string;
  google_drive_folder_id: string | null;
  google_drive_folder_name: string | null;
  created_at: string;
  updated_at: string;
}

export interface MemberProjectRow {
  id: number;
  name: string;
  display_title: string | null;
  category: string | null;
  status: string;
  is_pending: number | null;
  main_project_id: number | null;
  google_drive_folder_id: string | null;
  google_drive_folder_name: string | null;
}

/** Бүх үндсэн төсөл + гишүүн ангиллын төслүүд (хоёр асуулга, нэг удаа). */
export async function loadMainProjects(
  db: D1Database,
  opts: { seesPending: boolean },
): Promise<{ mains: MainProjectRow[]; members: MemberProjectRow[] }> {
  const { results: mains } = await db
    .prepare(`SELECT * FROM main_projects ORDER BY name COLLATE NOCASE`)
    .all<MainProjectRow>();
  const { results: members } = await db
    .prepare(
      `SELECT id, name, display_title, category, status, is_pending, main_project_id,
              google_drive_folder_id, google_drive_folder_name
         FROM projects
        WHERE COALESCE(asr_only, 0) = 0
          ${opts.seesPending ? '' : 'AND COALESCE(is_pending, 0) = 0'}
        ORDER BY name COLLATE NOCASE`,
    )
    .all<MemberProjectRow>();
  return { mains, members };
}
