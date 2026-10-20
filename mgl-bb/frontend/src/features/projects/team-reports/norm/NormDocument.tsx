import type { ReactNode } from 'react';
import { useApiQuery } from '@/shared/api/useApi';
import { T } from '@/features/performance-reports/lib/reportText';
import {
  NORM_CATALOG_KEY,
  type NormCatalogCategory,
  type NormCatalogResponse,
} from '@/features/projects/team-reports/norm/catalogApi';
import type { NormAnswers } from '@/features/projects/team-reports/norm/NormPanel';

/* =============================================================
 * NormDocument — "Норм дүрэм"-ийн хэвлэх/тайлангийн харагдац.
 * -------------------------------------------------------------
 * ProjectCorrespondencePanel-тэй ижил зарчим: project-level, өөрөө
 * fetch хийдэг (эсвэл `answers` prop-оор шууд авна — cold-render-ийн
 * уралдааныг тойрох). Каталогийг мөн prop-оор авах боломжтой — print
 * route (TeamReportPrintPage) readiness-д тооцохын тулд каталогийг өөрөө
 * fetch хийж дамжуулна. Юу ч сонгоогүй бол `null` (хэсгийг нуух).
 *
 * A4 ХУУДАСЛАЛТ (`data-a4-item`)
 * -------------------------------------------------------------
 * `A4Paginator` нь `[data-a4-item]` бүрийг хэмжиж, хуудасны заагт
 * унасныг дараагийн хуудас руу түлхдэг.  Норм дүрмийн жагсаалт нь
 * НЭГ A4-ЭЭС УРТ байж болох тул item-ийн түвшин нь:
 *   • `.norm-doc__head`     — гарчиг + удиртгал өгүүлбэр (хамт).
 *   • `.norm-doc__cat-head` — ангиллын нэр + жагсаалтын ЭХНИЙ мөр
 *     (ангилал ганцаараа хуудасны ёроолд үлдэхээс сэргийлнэ).
 *   • Үлдсэн `<li>` бүр ТУС ТУСДАА — бүлгийг бүхэлд нь нэг item
 *     болговол урт жагсаалт бүхэлдээ үсэрч, өмнөх хуудсыг хоосон
 *     орхино.
 *   • «Бусад» нь ангилал + нэг догол мөр учир бүхэлдээ нэг item.
 * ⚠️ Үүрлэсэн item хийхгүй: `.norm-doc__group` өөрөө item БИШ
 *    (зөвхөн «Бусад»-ын хувьд item — дотроо item агуулаагүй).
 *
 * `<T>` нь ЗАСВАРЛАГДАХ статик текст (провайдергүй үед — Багийн
 * тайлангийн таб — энгийн текст рүү унаж, харагдац хэвээр үлдэнэ).
 * ============================================================= */

interface NormReportResponse {
  report: { answers: NormAnswers | null } | null;
}

export function NormDocument({
  projectId,
  answers,
  catalog: catalogProp,
  wrap,
}: {
  projectId: number;
  /** Шууд өгвөл fetch хийхгүй (бие даасан print route энэ замаар дамжуулна). */
  answers?: NormAnswers;
  /** Каталогийг гаднаас өгвөл fetch хийхгүй (print readiness-д). */
  catalog?: NormCatalogCategory[];
  /** Агуулгатай үед л дуудагдах боож өгөгч (ж: performance-report page chrome).
   *  Хоосон үед doc `null` буцаах тул хоосон хуудас үүсэхгүй. */
  wrap?: (content: ReactNode) => ReactNode;
}) {
  const query = useApiQuery<NormReportResponse>(
    ['/projects/team-reports', projectId, 'NORM'] as const,
    `/projects/${projectId}/team-reports/NORM`,
    { enabled: answers === undefined && !!projectId },
  );
  const catalogQuery = useApiQuery<NormCatalogResponse>(NORM_CATALOG_KEY, '/norm-catalog', {
    staleTime: Infinity,
    retry: false,
    enabled: catalogProp === undefined,
  });

  if (answers === undefined && query.isLoading && !query.data) {
    return (
      <div className="norm-doc norm-doc--placeholder">
        <T k="norm.txt.loading">Ачаалж байна…</T>
      </div>
    );
  }

  const resolved: NormAnswers = answers ?? (query.data?.report?.answers ?? {});
  const checked = resolved.checked ?? {};
  const other = (resolved.other ?? '').trim();

  const catalog = catalogProp ?? catalogQuery.data?.catalog ?? [];
  const groups = catalog
    .map((cat) => ({
      category: cat.title,
      items: cat.items.filter((it) => checked[it.key]),
    }))
    .filter((g) => g.items.length > 0);

  // Юу ч сонгоогүй бол хэсгийг бүхэлд нь нуух.
  if (groups.length === 0 && !other) return null;

  const article = (
    <article className="norm-doc">
      <div className="norm-doc__head" data-a4-item>
        <h2 className="norm-doc__title">
          <T k="norm.h.title">МӨРДСӨН НОРМ ДҮРЭМ</T>
        </h2>
        <p className="norm-doc__lead">
          <T k="norm.txt.lead">Энэхүү зургийг дараах хүчин төгөлдөр норм, дүрмийн дагуу боловсруулсан:</T>
        </p>
      </div>

      {groups.map((g) => {
        /* `groups` нь items.length > 0-оор шүүгдсэн тул эхний мөр үргэлж бий. */
        const [firstItem, ...restItems] = g.items;
        return (
          <div key={g.category} className="norm-doc__group">
            <div className="norm-doc__cat-head" data-a4-item>
              <div className="norm-doc__cat">{g.category}</div>
              <ul className="norm-doc__list norm-doc__list--head">
                <li key={firstItem.key}>
                  <b>{firstItem.code}</b> — {firstItem.title}
                </li>
              </ul>
            </div>
            {restItems.length > 0 && (
              <ul className="norm-doc__list">
                {restItems.map((it) => (
                  <li key={it.key} data-a4-item>
                    <b>{it.code}</b> — {it.title}
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      })}

      {other && (
        <div className="norm-doc__group" data-a4-item>
          <div className="norm-doc__cat">
            <T k="norm.cat.other">Бусад</T>
          </div>
          <p className="norm-doc__other">{other}</p>
        </div>
      )}
    </article>
  );
  return wrap ? <>{wrap(article)}</> : article;
}

/* =============================================================
 * Styles — TeamComponentStatsPanel / ProjectCorrespondencePanel-тэй
 * ижил зарчмаар экспортолж, print хуудас / preview <style>-даа
 * inject хийнэ. Navy #0F243E.
 * ============================================================= */
export const NORM_DOC_STYLES = `
.norm-doc { font-family: "Arial", Helvetica, sans-serif; color: #111; line-height: 1.5; max-width: 760px; margin: 18px auto; padding: 0 16px; }
.norm-doc--placeholder { font-style: italic; color: #888; padding: 20px 16px; text-align: center; }
.norm-doc__title {
  text-align: center;
  font-size: 15pt;
  font-weight: 700;
  margin: 0 0 14px;
  letter-spacing: 0.04em;
  color: #0F243E;
  border-bottom: 2px solid #0F243E;
  padding-bottom: 6px;
}
.norm-doc__lead { margin: 0 0 10px; font-size: 10.5pt; }
/* Гарчиг+удиртгал, ангилал+эхний мөр — таслагдашгүй нэгжүүд (A4 item-ийн хос). */
.norm-doc__head,
.norm-doc__cat-head { break-inside: avoid; page-break-inside: avoid; }
/* margin-top нь ЗААВАЛ бүлгийн БАЙГАЛИЙН зайтай (10px) тэнцүү байх ёстой.
 * A4Paginator нь el.style.marginTop = natMt + push гэж бичдэг тул, хэрэв
 * нэгжийн ӨӨРИЙН margin-top нь өмнөх ах дүүгийн margin-bottom-оос БАГА
 * бол хоёр margin залгирч (collapsing) түлхэлт тэр зөрүүгээр ДУТАЖ
 * хэрэгжинэ — нэгж цаасны дээд захын маск дор орж таслагдана.
 * Зай нь max(10px, 10px) = 10px тул харагдац хуучинтай ЯГ ИЖИЛ. */
.norm-doc__cat-head { margin-top: 10px; }
.norm-doc__group { margin-top: 10px; margin-bottom: 10px; break-inside: avoid; }
.norm-doc__cat {
  font-weight: 700;
  font-size: 10.5pt;
  color: #0F243E;
  margin-bottom: 3px;
  break-after: avoid;
}
.norm-doc__list { margin: 0 0 4px; padding-left: 22px; font-size: 10pt; }
/* Эхний мөрийн жагсаалт нь үлдсэн мөрүүдтэйгээ ЗАЛГАА — доод зайг
   хасаж, хуваахаас өмнөх нэг ul-ийн хэмжээсийг яг хэвээр хадгална. */
.norm-doc__list--head { margin-bottom: 0; }
.norm-doc__list li { margin: 2px 0; }
.norm-doc__other { margin: 0; font-size: 10pt; white-space: pre-line; }

@media print {
  .norm-doc { max-width: none; padding: 0; }
  .norm-doc__title {
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
}
`;
