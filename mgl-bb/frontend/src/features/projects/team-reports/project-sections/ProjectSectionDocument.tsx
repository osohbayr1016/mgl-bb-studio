import type { ReactNode } from 'react';
import { useApiQuery } from '@/shared/api/useApi';
import { T } from '@/features/performance-reports/lib/reportText';
import type { FieldDef, SectionDef, TeamReportAnswers } from '@/features/projects/team-reports/types';

/* =============================================================
 * ProjectSectionDocument — ерөнхий project-level хэвлэх харагдац.
 * -------------------------------------------------------------
 * Өгсөн SectionDef[]-ийг answers-ээс уншиж, бөглөгдсөн талбарыг
 * section гарчигтайгаар хэвлэнэ (checkbox → bullet, бусад → "шошго:
 * утга"). ProjectCorrespondencePanel/NormDocument-тэй ижил: project-
 * level, өөрөө fetch хийдэг эсвэл `answers` prop-оор шууд авна
 * (cold-render-ийн уралдааныг тойрох). Юу ч бөглөөгүй бол `null`.
 *
 * A4 ХУУДАСЛАЛТ (`data-a4-item`)
 * -------------------------------------------------------------
 * Гүйцэтгэлийн тайлангийн `A4Paginator` нь `[data-a4-item]` элемент
 * бүрийг хэмжиж, хуудасны заагт унасныг нь дараагийн хуудас руу
 * түлхдэг.  Энд item-ийн ТҮВШИН нь:
 *   • `.psec-doc__head` — (эхний бүлэгт) doc гарчиг + ангиллын нэр +
 *     жагсаалтын ЭХНИЙ мөр.  Гарчиг/ангилал ганцаараа хуудасны ёроолд
 *     үлдэхээс сэргийлнэ (хэвлэлийн `break-after: avoid`-ийн дэлгэц
 *     дэх хос).
 *   • Үлдсэн `<li>` бүр ТУС ТУСДАА.  Бүлгийг бүхэлд нь нэг item
 *     болговол нэг A4-ээс урт жагсаалт бүхэлдээ дараагийн хуудас руу
 *     үсэрч, өмнөх хуудсыг хоосон орхино.
 * ⚠️ Үүрлэсэн item хийхгүй: `.psec-doc__group` өөрөө item БИШ.
 *
 * `<T>` нь ЗАСВАРЛАГДАХ статик текст (провайдергүй үед — Багийн
 * тайлангийн таб — энгийн текст рүү унаж, харагдац хэвээр үлдэнэ).
 * ============================================================= */

interface SectionReportResponse {
  report: { answers: TeamReportAnswers | null } | null;
}

function fieldText(field: FieldDef, value: unknown): string | null {
  if (field.kind === 'checkbox') {
    return value === true ? field.label : null;
  }
  if (value == null) return null;
  const raw = typeof value === 'string' ? value.trim() : String(value);
  if (!raw) return null;
  let display = raw;
  if (field.kind === 'select' && field.options) {
    const opt = field.options.find((o) => o.value === raw);
    if (opt) display = opt.label;
  }
  if (field.suffix) display = `${display} ${field.suffix}`;
  return `${field.label}: ${display}`;
}

export function ProjectSectionDocument({
  projectId,
  code,
  docTitle,
  sections,
  answers,
  wrap,
}: {
  projectId: number;
  /** Синтетик team_code (self-fetch-д хэрэглэнэ). */
  code: string;
  /** Хэвлэх гарчиг (ИХ ҮСГЭЭР). */
  docTitle: string;
  sections: SectionDef[];
  /** Шууд өгвөл fetch хийхгүй (бие даасан print route энэ замаар дамжуулна). */
  answers?: TeamReportAnswers;
  /** Агуулгатай үед л дуудагдах боож өгөгч (ж: performance-report-ийн
   *  page chrome). Хоосон үед doc нь `null` буцаах тул хоосон хуудас үүсэхгүй. */
  wrap?: (content: ReactNode) => ReactNode;
}) {
  const query = useApiQuery<SectionReportResponse>(
    ['/projects/team-reports', projectId, code] as const,
    `/projects/${projectId}/team-reports/${code}`,
    { enabled: answers === undefined && !!projectId },
  );

  if (answers === undefined && query.isLoading && !query.data) {
    return (
      <div className="psec-doc psec-doc--placeholder">
        <T k="psec.txt.loading">Ачаалж байна…</T>
      </div>
    );
  }

  const resolved: TeamReportAnswers = answers ?? (query.data?.report?.answers ?? {});

  const groups = sections
    .map((section) => {
      const items = section.fields
        .filter((f) => !f.visibleIf || f.visibleIf(resolved))
        .map((f) => fieldText(f, resolved[f.key]))
        .filter((t): t is string => t !== null);
      return { section, items };
    })
    .filter((g) => g.items.length > 0);

  if (groups.length === 0) return null;

  const article = (
    <article className="psec-doc">
      {groups.map((g, gi) => {
        /* `groups` нь items.length > 0-оор шүүгдсэн тул эхний мөр үргэлж бий. */
        const [firstItem, ...restItems] = g.items;
        return (
          <div key={g.section.id} className="psec-doc__group">
            <div className="psec-doc__head" data-a4-item>
              {gi === 0 ? <h2 className="psec-doc__title">{docTitle}</h2> : null}
              <div className="psec-doc__cat">{g.section.title}</div>
              <ul className="psec-doc__list psec-doc__list--head">
                <li>{firstItem}</li>
              </ul>
            </div>
            {restItems.length > 0 && (
              <ul className="psec-doc__list">
                {restItems.map((t, i) => (
                  /* Индекс нь эх жагсаалтын 1-ээс хойших байрлал. */
                  <li key={i + 1} data-a4-item>
                    {t}
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      })}
    </article>
  );
  return wrap ? <>{wrap(article)}</> : article;
}

/* Styles — NormDocument/ProjectCorrespondencePanel-тэй ижил (navy #0F243E). */
export const PROJECT_SECTION_DOC_STYLES = `
.psec-doc { font-family: "Arial", Helvetica, sans-serif; color: #111; line-height: 1.5; max-width: 760px; margin: 18px auto; padding: 0 16px; }
.psec-doc--placeholder { font-style: italic; color: #888; padding: 20px 16px; text-align: center; }
.psec-doc__title {
  text-align: center;
  font-size: 15pt;
  font-weight: 700;
  margin: 0 0 14px;
  letter-spacing: 0.04em;
  color: #0F243E;
  border-bottom: 2px solid #0F243E;
  padding-bottom: 6px;
}
.psec-doc__group { margin-bottom: 10px; break-inside: avoid; }
/* Гарчиг + ангилал + эхний мөр — таслагдашгүй нэгж (A4 item-ийн хос). */
.psec-doc__head { break-inside: avoid; page-break-inside: avoid; }
/* margin-top нь бүлэг хоорондын БАЙГАЛИЙН зайтай (10px) тэнцүү байх ёстой.
 * A4Paginator нь el.style.marginTop = natMt + push гэж бичдэг тул нэгжийн
 * ӨӨРИЙН margin-top өмнөх бүлгийн margin-bottom-оос бага бол margin
 * collapsing үүсэж түлхэлт тэр зөрүүгээр дутаж, гарчиг цаасны дээд захын
 * маск дор орж таслагдана.  Зай нь max(10px, 10px) = 10px тул харагдац
 * (Багийн тайлангийн таб) хуучинтай ЯГ ИЖИЛ хэвээр. */
.psec-doc__head { margin-top: 10px; }
.psec-doc__cat {
  font-weight: 700;
  font-size: 10.5pt;
  color: #0F243E;
  margin-bottom: 3px;
  break-after: avoid;
}
.psec-doc__list { margin: 0 0 4px; padding-left: 22px; font-size: 10pt; }
/* Эхний мөрийн жагсаалт нь үлдсэн мөрүүдтэйгээ ЗАЛГАА — доод зайг
   хасаж, хуваахаас өмнөх нэг ul-ийн хэмжээсийг яг хэвээр хадгална. */
.psec-doc__list--head { margin-bottom: 0; }
/* Зургийн нэр урт байвал хоёр талаар тэгшилнэ; «text-align-last: left»
 * нь сүүлийн мөрийг сунгахгүй. */
.psec-doc__list li { margin: 2px 0; text-align: justify; text-align-last: left; overflow-wrap: break-word; }

@media print {
  .psec-doc { max-width: none; padding: 0; }
  .psec-doc__title {
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
}
`;
