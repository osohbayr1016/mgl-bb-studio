import type { ProjectIdentity } from '@/shared/lib/projectIdentity';

/* =============================================================
 * ProjectDocumentHeader — төслийн баримтын ТОЛГОЙ
 * -------------------------------------------------------------
 * Багийн «Тайлбар бичиг» (8 дисциплин) болон түүнтэй ижил цаасан
 * гаралт бүрийн ДЭЭД талд суух нэг мөрийн танилцуулга: албан ёсны
 * гарчиг, богино нэр, зургийн шифр, Doc. No., хугацаа, дисциплин.
 *
 * ⚠️ ЯАГААД ЭНЭ ШИНЭ ФАЙЛ ВЭ:
 *   2026-07-д багуудын загвар (`team-reports/<баг>/template.ts`) дотор
 *   давхардаж бичигдсэн толгойн талбарууд УСТГАГДСАН бөгөөд «өгөгдөл нь
 *   паспортаас уншигдана» гэсэн тайлбар үлдсэн — гэтэл УНШИХ КОД
 *   ХЭЗЭЭ Ч БИЧИГДЭЭГҮЙ.  Тиймээс өнөөдөр 8 баримт бүгд төслийн НЭРГҮЙ,
 *   ШИФРГҮЙ, ОГНООГҮЙ хэвлэгддэг.  Энэ бүрэлдэхүүн нь тэр нүхийг НЭГ
 *   газраас нөхөж байгаа тул загварын файлуудыг нээх шаардлагагүй.
 *
 * ⚠️ ШАТЛАЛЫГ ЭНД ЗОХИОГООГҮЙ.  Гарчиг → шифр → огноо шийдэх ганц
 * resolver нь `@/shared/lib/projectIdentity`.  Энд ЗӨВХӨН харагдац
 * байна — нөхөх дараалал (`full_title` → `display_title` → `name` гэх
 * мэт) битгий давт.
 *
 * ⚠️ ХАРИЛЦАГЧИД ЮУ ХАРАГДАХ ВЭ (`audience='client'`):
 *   Багийн PDF-ийн ЯГ ЭНЭ хуудсыг сервер `?mode=client`-аар
 *   (`backend/src/routes/projects.ts` → `/:id/team-reports/:teamCode/pdf`,
 *   `project_members`-ээр шалгагдсан харилцагчид) рендэрлэдэг.  Тиймээс
 *   ДОТООД талбарууд — паспортын `notes`, `director`, мөн АЖИЛТНЫ НЭР
 *   агуулсан юу ч (багийн ахлах, хариуцсан мэргэжилтэн) — client горимд
 *   ГАРАХГҮЙ.  Эс бөгөөс энэ өөрчлөлт нь дотоод мэдээллийг захиалагчийн
 *   баримтад АНХ УДАА гаргана.  `ProjectIdentity`-д `notes` талбар огт
 *   байхгүй (`resolveProjectIdentity` буцаадаггүй) тул тэр нь бүтцээрээ
 *   аюулгүй; `director` нь ЗӨВХӨН доорх `audience === 'internal'`
 *   салаагаар хамгаалагдана.
 *
 * ⚠️ ХЭВЛЭХЭД АЮУЛГҮЙ БАЙХ ГУРВАН ДҮРЭМ (зөрчвөл PDF эвдэрнэ):
 *   1) `position: fixed/absolute` БАЙХГҮЙ — Chromium нь хуудасны
 *      хүрээнээс гарсан fixed элементийг тайрдаг (AsrDocument.tsx:60-64
 *      дээрх туршилтыг үз), PDF-д толгой бүрмөсөн алга болно.
 *   2) Өнгө нь ЦААСНЫ өнгө — dark горимын хувьсагч (`--foreground` гэх
 *      мэт) хэрэглэхгүй.  Энэ маршрут нь цагаан дэвсгэр дээр хэвлэгддэг.
 *   3) `break-inside: avoid` нь толгойг хоёр хуудас хооронд ТАСЛАХГҮЙ
 *      боловч ШИНЭ ХУУДАС ЭХЛҮҮЛЭХГҮЙ — баримтын одоогийн хуудас
 *      хуваалтад нөлөөлөхгүй.
 *
 * i18n: энэ хэвлэх гадаргуу (toolbar, 8 баримт, ASR) БҮХЭЛДЭЭ шууд
 * монгол мөртэй — `T`/`useTranslation` дуудлага нэг ч байхгүй.  Тиймээс
 * шинэ түлхүүр НЭМЭЭГҮЙ, эргэн тойрны хэв маягийг барив.
 * ============================================================= */

export interface ProjectDocumentHeaderProps {
  identity: ProjectIdentity;
  audience: 'internal' | 'client';
  /** Энэ баримтын дисциплин («БА · Барилга архитектур»).
   *
   *  ⚠️ ЗААВАЛ БИШ бөгөөд `ProjectIdentity`-д БАЙХГҮЙ нь санаатай:
   *  «хувийн мэдээлэл» нь ТӨСЛИЙНХ, харин дисциплин нь ЭНЭ БАРИМТЫНХ
   *  (нэг төсөл 8 өөр баримт гаргана).  Дуудагч нь өөрийн `teamCode`-оос
   *  гаргаж өгнө; төслийн түвшний баримтууд (НОРМ, ГАЛ …) хоосон
   *  үлдээж болно. */
  discipline?: string;
}

/** `2026-01-05` → `2026.01.05`.  Бусад бүхэн ХЭВЭЭР буцна.
 *  ⚠️ `resolveProjectIdentity` нь огноог аль хэдийн цэвэрлэсэн
 *  (`normalisePassportDate`) тул энд ЗӨВХӨН харагдацын цэг тавина —
 *  дахин баталгаажуулах шаардлагагүй. */
function dot(iso: string | null): string {
  if (!iso) return '';
  return iso.replace(/-/g, '.');
}

/** Эхлэх–дуусах.  Ганц тал нь мэдэгдэж байвал зураасгүйгээр ганц огноо;
 *  хоёулаа хоосон бол хоосон мөр (мөр огт үүсэхгүй). */
function periodOf(identity: ProjectIdentity): string {
  const a = dot(identity.startDate);
  const b = dot(identity.finishDate);
  if (a && b) return `${a} – ${b}`;
  return a || b;
}

export function ProjectDocumentHeader({
  identity,
  audience,
  discipline,
}: ProjectDocumentHeaderProps) {
  const period = periodOf(identity);
  const extension = dot(identity.extensionDate);
  /* Албан ёсны гарчиг нь `projects.name`-тэй яг таарч болно (паспортгүй
   * төсөл дээр resolver нь `name` рүү бууна) — тэр үед богино нэрийг
   * ДАВХАР хэвлэхгүй. */
  const showShortName = identity.shortName.trim() !== identity.title.trim();

  const rows: Array<{ label: string; value: string }> = [];
  if (identity.drawingNo) rows.push({ label: 'Зургийн шифр', value: identity.drawingNo });
  if (identity.docNo) rows.push({ label: 'Doc. No.', value: identity.docNo });
  if (discipline) rows.push({ label: 'Хэсэг', value: discipline });
  if (identity.clientName) rows.push({ label: 'Захиалагч', value: identity.clientName });
  if (identity.location) rows.push({ label: 'Байршил', value: identity.location });
  if (period) rows.push({ label: 'Хугацаа', value: period });
  if (extension) rows.push({ label: 'Сунгалт', value: extension });
  /* ⚠️ ЗӨВХӨН ДОТООД.  Дээрх «ХАРИЛЦАГЧИД ЮУ ХАРАГДАХ ВЭ» тайлбарыг үз. */
  if (audience === 'internal' && identity.director) {
    rows.push({ label: 'Захирал', value: identity.director });
  }

  return (
    <header className="proj-doc-head">
      <div className="proj-doc-head__title">{identity.title}</div>
      {showShortName && <div className="proj-doc-head__short">{identity.shortName}</div>}
      {rows.length > 0 && (
        <div className="proj-doc-head__grid">
          {rows.map((r) => (
            <div className="proj-doc-head__row" key={r.label}>
              <span className="proj-doc-head__lbl">{r.label}:</span>
              <span className="proj-doc-head__val">{r.value}</span>
            </div>
          ))}
        </div>
      )}
    </header>
  );
}

/** Хэвлэх маршрутын `<style>`-д НЭМЭГДЭНЭ (баримт бүрийн `*_STYLES`-ийн
 *  хэв маягтай ижил).  Tailwind БИШ: энэ хуудсыг сервер талын Browser
 *  Rendering ч рендэрлэдэг тул style нь баримттайгаа хамт явах ёстой. */
export const PROJECT_DOC_HEADER_STYLES = `
.proj-doc-head {
  font-family: ui-sans-serif, system-ui, -apple-system, sans-serif;
  color: #111827;
  background: #ffffff;
  border: 1px solid #cbd0d6;
  padding: 10px 12px;
  margin: 0 0 16px;
  /* Толгой хоёр хуудас хооронд ТАСРАХГҮЙ, гэхдээ шинэ хуудас ЭХЛҮҮЛЭХГҮЙ. */
  break-inside: avoid;
  page-break-inside: avoid;
}
.proj-doc-head__title {
  font-size: 13.5px;
  font-weight: 700;
  line-height: 1.35;
  text-transform: uppercase;
}
.proj-doc-head__short {
  margin-top: 2px;
  font-size: 11px;
  color: #4b5563;
}
.proj-doc-head__grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 1px 18px;
  margin-top: 8px;
  padding-top: 7px;
  border-top: 1px solid #e3e6ea;
}
.proj-doc-head__row {
  display: flex;
  gap: 6px;
  font-size: 11px;
  line-height: 1.5;
}
.proj-doc-head__lbl { color: #6b7280; white-space: nowrap; }
.proj-doc-head__val { color: #111827; font-weight: 600; word-break: break-word; }

@media print {
  /* Хэвлэгч нь сул саарлыг иддэг тул хүрээг бага зэрэг тодруулна. */
  .proj-doc-head { border-color: #9aa1a9; }
}
`;
