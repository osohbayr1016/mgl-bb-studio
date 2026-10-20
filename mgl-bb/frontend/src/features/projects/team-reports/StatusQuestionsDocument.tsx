import {
  TEAM_REPORT_STATUS_QUESTIONS,
  statusFieldKey,
} from '@/features/projects/team-reports/status-questions';
import { T } from '@/features/performance-reports/lib/reportText';

/* =============================================================
 * Print-side render of the universal status block.
 * -------------------------------------------------------------
 * One <section> per question, heading = question text, body =
 * the saved answer (or a parenthesised "(хариулт оруулаагүй)"
 * fallback so the reader can see at a glance which questions
 * went unanswered).
 *
 * Styles are kept in a self-contained class prefix so this
 * component renders correctly even when the page's stylesheet
 * doesn't include any team-specific CSS.
 *
 * -------------------------------------------------------------
 * A4 ХУУДАСЛАЛТ (`data-a4-item`)
 * -------------------------------------------------------------
 * `A4Paginator` нь `[data-a4-item]`-ийг хуудасны заагаас доош
 * түлхдэг.  Энд «хуваагдвал ойлгомжгүй болох хамгийн жижиг бүтэн
 * нэгж» нь АСУУЛТ БҮР — гарчиг + түүний хариулт — тул `<section
 * className="status-doc__item">` бүр НЭГ item.  Гарчиг ганцаараа
 * хуудасны ёроолд үлдэхгүй.  Cover гарчиг + удиртгал догол мөр нь
 * мөн хамтдаа НЭГ item (гарчгаа орхиод удиртгал нь дараагийн
 * хуудсанд гарах ёсгүй).
 * ⚠️ Үүрлэсэн item хийхгүй — `<article>` дээр давхар тавихгүй.
 *
 * Статик текстүүд `<T k="sq.…">`-ээр ороосон тул тайлан засварлах
 * горимд өөрчлөгдөнө; provider байхгүй Багийн тайлангийн таб дээр
 * энгийн текст рүү уначих тул харагдац хэвээр.
 * ============================================================= */

interface StatusQuestionsDocumentProps {
  /** Saved `answers_json` — keys outside `status_q1`…`status_q6`
   *  are ignored.  Free-form Record because the document is
   *  team-agnostic; the per-team typed shapes don't declare
   *  these keys. */
  answers: Record<string, unknown>;
  /** Rendering mode.
   *   - `internal` (default): the existing "Урьдчилан харах" view.
   *     Cover heading + lead paragraph + numbered question text,
   *     unanswered sections show the `(хариулт оруулаагүй)` placeholder
   *     so the writer sees what's missing.
   *   - `client`: the "Тайлан" view shown to the customer.
   *     Cover heading + lead suppressed, headings render the
   *     declarative `q.title`, numbering dropped, and empty-answer
   *     sections are omitted entirely so the doc reads as a polished
   *     deliverable rather than an unfinished form. */
  mode?: 'internal' | 'client';
}

export function StatusQuestionsDocument({
  answers,
  mode = 'internal',
}: StatusQuestionsDocumentProps) {
  const isClient = mode === 'client';

  return (
    <article className="status-doc">
      {!isClient && (
        /* Гарчиг + удиртгал = НЭГ item.  Wrapper нь ямар ч CSS дүрэмгүй
         * цэвэр блок тул margin залгирал өөрчлөгдөхгүй (h1-ийн дээд margin
         * 0, p-ийн доод margin гадагшаа залгирсан хэвээр). */
        <div data-a4-item>
          <h1 className="status-doc__title">
            <T k="sq.h.title">ТАЙЛАНГИЙН ТОВЧ АСУУМЖ</T>
          </h1>
          <p className="status-doc__lead">
            <T k="sq.txt.lead">
              Энэ блок нь бүх багт нийтлэг бөгөөд тухайн тайлангийн хугацаанд гарсан оруулга,
              хүлээгдэж буй зүйл, шийдэгдсэн / шийдэгдээгүй асуудал болон хийгдсэн ажлыг тоймлон
              харуулна.
            </T>
          </p>
        </div>
      )}

      {TEAM_REPORT_STATUS_QUESTIONS.map((q, idx) => {
        const raw = answers[statusFieldKey(q.id)];
        const answer = typeof raw === 'string' ? raw.trim() : '';
        // In client mode, skip questions with no answer — leaving a
        // bare heading would read as a missing deliverable to the
        // customer. Internal mode keeps the placeholder so the writer
        // sees what's left to fill.
        if (isClient && answer.length === 0) return null;
        return (
          <section key={q.id} className="status-doc__item" data-a4-item>
            <h2 className="status-doc__heading">
              {!isClient && <span className="status-doc__num">{idx + 1}.</span>}
              {isClient ? q.title : q.text}
            </h2>
            {answer.length > 0 ? (
              <p className="status-doc__para">{answer}</p>
            ) : (
              <p className="status-doc__para status-doc__para--empty">
                <T k="sq.txt.unanswered">(хариулт оруулаагүй)</T>
              </p>
            )}
          </section>
        );
      })}
    </article>
  );
}

export const STATUS_DOC_STYLES = `
.status-doc { font-family: "Arial", Helvetica, sans-serif; color: #111; line-height: 1.55; max-width: 760px; margin: 0 auto; padding: 0 16px; }
.status-doc__title { text-align: center; font-size: 18pt; font-weight: 700; margin: 0 0 12px; letter-spacing: 0.06em; }
.status-doc__lead { font-size: 10.5pt; color: #444; margin: 0 0 18px; text-align: justify; text-align-last: left; overflow-wrap: break-word; }
.status-doc__item { margin: 14px 0; }
.status-doc__heading { font-size: 11.5pt; font-weight: 700; margin: 0 0 6px; line-height: 1.4; }
.status-doc__num { color: #555; margin-right: 6px; font-weight: 600; }
/* Хоёр талаар тэгшилнэ.  «text-align-last: left» — сүүлийн мөр сунахгүй.
 * «white-space: pre-wrap» тул хэрэглэгчийн өөрийн мөр таслалт хэвээр
 * үлдэж, тэр мөрүүд нь тус тусдаа «сүүлийн мөр» болж сунахгүй. */
.status-doc__para { font-size: 11pt; margin: 0; text-align: justify; text-align-last: left; overflow-wrap: break-word; white-space: pre-wrap; }
.status-doc__para--empty { color: #999; font-style: italic; }

@media print {
  .status-doc { max-width: none; padding: 0; }
  .status-doc__item { break-inside: avoid-page; }
  .status-doc__heading { break-after: avoid; }
}
`;
