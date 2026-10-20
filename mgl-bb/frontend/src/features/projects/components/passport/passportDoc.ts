/* =============================================================
 * Паспорт (DB мөр) ⇄ «PROJECT DESCRIPTION» баримтын draft
 * -------------------------------------------------------------
 * Байгаа төслийн «Мэдээлэл» таб нь паспортыг Word баримт шиг
 * (`PassportDocumentEditor` → `ProjectIntroPage`) үзүүлж, тэр дээр
 * нь шууд засварлуулдаг.  Баримтын талбарууд (`IntroAuto`-гийн
 * түлхүүрүүд) ба `project_passport`-ын баганууд хоорондоо НЭГ-НЭГ
 * биш — гурван зөрүү энд Л шийдэгдэнэ:
 *
 *   • `location` нь паспортад БИШ, `projects`-д амьдардаг → баримт дээр
 *     ТҮГЖИГДЭНЭ (`LOCKED_FIELDS`).  `clientName` нь 2026-09-28-аас
 *     засагдана: паспортын Хадгалах нь `client_name` илгээж сервер
 *     `project_clients`-д бичнэ (`backend/src/lib/passportClient.ts`) —
 *     энэ файлын `docPatchToPassport` түүнийг ХӨНДӨХГҮЙ (`ProjectInfoTab`).
 *   • `ceo` нь `client_contacts[0]` (нэр + албан тушаал) — баримт дээр
 *     «Нэр Овог (Албан тушаал)» гэж харагдаж, эргэж бичихэд тэр хоёр
 *     талбар руу задарна (`lib/introAuto.ts`-ийн харагдацтай ижил).
 *   • «Бичиг баримт» хүснэгт нь `project_client_documents` мөрүүд —
 *     паспортын JSON биш, тусдаа CRUD.  Баримт дээрх засвар Хадгалах
 *     хүртэл локал байж, дараа нь `diffDocRows` → POST / PUT / DELETE.
 *
 * Бүгд ЦЭВЭР функц — `scripts/check-passport-doc.mjs` тестлэнэ.
 * ============================================================= */

import type { IntroDocRow, IntroOverride } from '@/features/performance-reports/types/introOverride';
import type { ScalarKey } from '@/features/performance-reports/components/ProjectIntroPage';
import type { PassportDocDraft } from '@/features/projects/components/passport/PassportDocumentEditor';
import type { ClientContact, ProjectClientDocument, ProjectPassport } from '@/shared/types';
import { formatDisplayName, toStoredName } from '@/shared/lib/formatting';

/** Баримт дээр зөвхөн уншигдах нүднүүд (эх сурвалж нь паспорт биш).
 *  «Client» 2026-09-28-аас засагдана (эзний хүсэлт) — толгойн тайлбарыг үз. */
export const LOCKED_FIELDS: readonly ScalarKey[] = ['location'];

/** Байгаа `project_client_documents` мөрийн баримт дээрх id.
 *  ⚠️ `cd-` угтвар ЗОРИУД `rowId('doc')`-оос ялгаатай: шинэ мөрийн санамсаргүй
 *  base36 id нь бүхэлдээ цифр байж болох тул `doc-<тоо>` хэлбэрээр ялгавал
 *  хааяа шинэ мөрийг «байгаа» гэж андуурна. */
const EXISTING_PREFIX = 'cd-';

export function docRowId(id: number): string {
  return `${EXISTING_PREFIX}${id}`;
}

/** Байгаа мөрийн DB id, шинэ мөрөнд `null`. */
export function existingDocId(rowId: string): number | null {
  if (!rowId.startsWith(EXISTING_PREFIX)) return null;
  const n = Number(rowId.slice(EXISTING_PREFIX.length));
  return Number.isInteger(n) && n > 0 ? n : null;
}

export function docRowsFromClientDocs(docs: readonly ProjectClientDocument[]): IntroDocRow[] {
  return docs.map((d) => ({
    id: docRowId(d.id),
    name: d.doc_name ?? '',
    no: d.doc_no ?? '',
    date: d.doc_date ?? '',
    /* `lib/introAuto.ts`-тэй ижил: тайлбар байхгүй бол эх сурвалж. */
    description: d.description ?? d.source ?? '',
  }));
}

/* ---------------- CEO ⇄ client_contacts[0] ---------------- */

/** «Нэр Овог (Албан тушаал)» — `lib/introAuto.ts`-ийн `ceo`-той ҮГЧЛЭН ижил. */
export function ceoDisplay(contacts: readonly ClientContact[] | null | undefined): string {
  const c = contacts?.[0];
  if (!c) return '';
  return [formatDisplayName(c.full_name), c.position ? `(${c.position})` : '']
    .filter(Boolean)
    .join(' ');
}

/** Баримт дээр бичсэн CEO мөрийг `client_contacts` руу буцаана.
 *
 *  Сүүлийн «(…)» хаалт = албан тушаал; хаалтгүй бол албан тушаал ХООСОН
 *  (хэрэглэгч устгасан гэж үзнэ — эс бөгөөс устгасан хаалт дараагийн
 *  уншилтад буцаж гарна).  Утас / имэйл ХЭВЭЭР — тэдгээр нь маягтын
 *  хүснэгтэд л засагдана.  Хоосон мөр → эхний харилцагчийг хасна. */
export function ceoToContacts(
  input: string,
  contacts: readonly ClientContact[] | null | undefined,
): ClientContact[] {
  const rest = (contacts ?? []).slice(1);
  const s = input.trim();
  if (!s) return rest;
  const m = /^(.*?)\s*\(([^()]*)\)\s*$/.exec(s);
  const displayName = (m ? m[1] : s)!.trim();
  const position = (m ? m[2] : '')!.trim();
  const first: ClientContact = {
    full_name: toStoredName(displayName),
    position,
    phone: contacts?.[0]?.phone ?? '',
    email: contacts?.[0]?.email ?? '',
  };
  return [first, ...rest];
}

/* ---------------- паспорт → draft ---------------- */

export function passportToDocDraft(a: {
  passport: ProjectPassport;
  documents: readonly IntroDocRow[];
  clientName: string;
  location: string;
}): PassportDocDraft {
  const p = a.passport;
  return {
    projectTitle: p.full_title ?? '',
    clientName: a.clientName,
    drawingNo: p.drawing_no ?? '',
    scope: p.scope ?? '',
    location: a.location,
    director: p.director ?? '',
    ceo: ceoDisplay(p.client_contacts),
    disciplines: p.disciplines ?? [],
    documents: a.documents.slice(),
    scopeRows: p.scope_rows ?? [],
    timeline: p.timeline ?? [],
    meetings: p.meetings ?? [],
  };
}

/* ---------------- draft патч → паспорт ---------------- */

/** `ProjectIntroPage`-ийн патчийг паспортын багана руу хөрвүүлнэ.
 *  Түгжсэн ба «Бичиг баримт» талбар энд ОРОХГҮЙ (тэдгээр өөр замаар).
 *  Хоосон мөр → `null` (маягтын `updatePassport(key, v || null)`-тай ижил). */
export function docPatchToPassport(
  patch: Partial<IntroOverride>,
  current: ProjectPassport,
): Partial<ProjectPassport> {
  const out: Partial<ProjectPassport> = {};
  const nul = (v: string) => (v.trim() ? v : null);
  if (patch.projectTitle !== undefined) out.full_title = nul(patch.projectTitle);
  if (patch.drawingNo !== undefined) out.drawing_no = nul(patch.drawingNo);
  if (patch.scope !== undefined) out.scope = nul(patch.scope);
  if (patch.director !== undefined) out.director = nul(patch.director);
  if (patch.ceo !== undefined) out.client_contacts = ceoToContacts(patch.ceo, current.client_contacts);
  if (patch.disciplines !== undefined) out.disciplines = patch.disciplines;
  if (patch.scopeRows !== undefined) out.scope_rows = patch.scopeRows;
  if (patch.timeline !== undefined) out.timeline = patch.timeline;
  if (patch.meetings !== undefined) out.meetings = patch.meetings;
  return out;
}

/* ---------------- «Бичиг баримт» diff ---------------- */

export interface DocRowsDiff {
  /** Шинэ мөр (нэртэй л бол) — `sort_order` нь баримт дээрх байрлал. */
  create: Array<{ row: IntroDocRow; sort_order: number }>;
  /** Байгаа мөр, талбар нь өөрчлөгдсөн. */
  update: Array<{ id: number; row: IntroDocRow; sort_order: number }>;
  /** Баримтаас хасагдсан байгаа мөр. */
  remove: number[];
}

const same = (a: string | null | undefined, b: string) => (a ?? '').trim() === b.trim();

/** Баримт дээрх мөрүүдийг серверийн мөртэй тулгана.
 *  Нэргүй ШИНЭ мөр алгасагдана (сервер `doc_name` шаарддаг); нэргүй БАЙГАА
 *  мөр нь устгах хүсэлт гэж үзэгдэнэ (хэрэглэгч нэрийг нь арилгасан). */
export function diffDocRows(
  before: readonly ProjectClientDocument[],
  after: readonly IntroDocRow[],
): DocRowsDiff {
  const byId = new Map(before.map((d) => [d.id, d]));
  const seen = new Set<number>();
  const diff: DocRowsDiff = { create: [], update: [], remove: [] };
  after.forEach((row, i) => {
    const id = existingDocId(row.id);
    const sort_order = i + 1;
    if (id == null || !byId.has(id)) {
      if (row.name.trim()) diff.create.push({ row, sort_order });
      return;
    }
    seen.add(id);
    if (!row.name.trim()) {
      diff.remove.push(id);
      return;
    }
    const cur = byId.get(id)!;
    const changed =
      !same(cur.doc_name, row.name) ||
      !same(cur.doc_no, row.no) ||
      !same(cur.doc_date, row.date) ||
      !same(cur.description ?? cur.source, row.description) ||
      (cur.sort_order ?? 0) !== sort_order;
    if (changed) diff.update.push({ id, row, sort_order });
  });
  for (const d of before) if (!seen.has(d.id)) diff.remove.push(d.id);
  return diff;
}

/** Серверийн мөр (POST/PUT-ийн хариу) → баримтын мөр.  `docRowsFromClientDocs`
 *  нэг мөрөнд. */
export function docRowFromClientDoc(d: ProjectClientDocument): IntroDocRow {
  return docRowsFromClientDocs([d])[0]!;
}
