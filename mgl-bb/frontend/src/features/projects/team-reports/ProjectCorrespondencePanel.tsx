import { useApiQuery } from '@/shared/api/useApi';
import type { CorrespondenceEntry } from '@/shared/types';

/* =============================================================
 * ProjectCorrespondencePanel — захидал харилцааны товч хүснэгт.
 * -------------------------------------------------------------
 * Тухайн төсөлд холбогдсон и-мэйл бүртгэлийг (correspondence_log)
 * багийн client-facing "Тайлан"-д хавсралт хэлбэрээр харуулна.
 * Хоёр газар нэг компонентоор:
 *   - TeamReportShell-ийн "Тайлан" preview drawer.
 *   - TeamReportPrintPage (?mode=client) PDF / window.print().
 *
 * Захидал нь төслийн хэмжээнд тул багаас үл хамааран нэг ижил
 * жагсаалт харагдана. "Товч" — биеийн текст / CC / хавсралтыг
 * харуулахгүй, нэг мөр нэг захидал.
 *
 * Navy brand #0F243E — TeamComponentStatsPanel болон төслийн
 * нэгдсэн Гүйцэтгэлийн тайлан PDF-тэй ижил өнгө.
 * ============================================================= */

export interface ProjectCorrespondencePanelProps {
  projectId: number;
}

interface CorrespondenceListResponse {
  entries: CorrespondenceEntry[];
  can_write: boolean;
}

const DOC_TYPE_SHORT: Record<NonNullable<CorrespondenceEntry['doc_type']>, string> = {
  rfi: 'RFI',
  cr: 'CR',
  official: 'OL',
  mr: 'MR',
};

function fmtDate(s: string): string {
  // log_date нь YYYY-MM-DD. Цэгтэй форматруу хөрвүүлнэ (YYYY.MM.DD).
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10).replace(/-/g, '.') : s;
}

export function ProjectCorrespondencePanel({ projectId }: ProjectCorrespondencePanelProps) {
  const query = useApiQuery<CorrespondenceListResponse>(
    ['/correspondence/projects', projectId] as const,
    `/correspondence/projects/${projectId}`,
    { enabled: !!projectId },
  );

  if (query.isLoading && !query.data) {
    return <div className="correspondence-doc correspondence-doc--placeholder">Ачаалж байна…</div>;
  }
  if (query.error) {
    return (
      <div className="correspondence-doc correspondence-doc--placeholder">
        Захидал харилцааг ачаалж чадсангүй: {query.error.message}
      </div>
    );
  }

  const entries = query.data?.entries ?? [];
  // Захидал байхгүй бол хэсгийг бүхэлд нь нуух — тайланд хоосон хүснэгт нэмэхгүй.
  if (entries.length === 0) return null;

  return (
    <article className="correspondence-doc">
      <h2 className="correspondence-doc__title">ЗАХИДАЛ ХАРИЛЦАА</h2>

      <table className="correspondence-doc__table">
        <colgroup>
          <col className="correspondence-doc__col-no" />
          <col className="correspondence-doc__col-date" />
          <col className="correspondence-doc__col-dir" />
          <col className="correspondence-doc__col-type" />
          <col />
          <col className="correspondence-doc__col-parties" />
        </colgroup>
        <thead>
          <tr>
            <th className="correspondence-doc__col-no">№</th>
            <th className="correspondence-doc__col-date">Огноо</th>
            <th className="correspondence-doc__col-dir">Чиглэл</th>
            <th className="correspondence-doc__col-type">Төрөл / Дугаар</th>
            <th>Гарчиг</th>
            <th className="correspondence-doc__col-parties">Илгээгч → Хүлээн авагч</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((e, idx) => (
            <tr key={e.id} className="correspondence-doc__row">
              <td className="correspondence-doc__col-no">{idx + 1}</td>
              <td className="correspondence-doc__col-date">{fmtDate(e.log_date)}</td>
              <td className="correspondence-doc__col-dir">
                {e.direction === 'sent' ? 'Илгээсэн' : 'Хүлээн авсан'}
              </td>
              <td className="correspondence-doc__col-type">
                {e.doc_type ? DOC_TYPE_SHORT[e.doc_type] : '—'}
                {e.ref_no && <span className="correspondence-doc__ref"> · {e.ref_no}</span>}
              </td>
              <td className="correspondence-doc__subject">{e.subject}</td>
              <td className="correspondence-doc__col-parties">
                <span className="correspondence-doc__addr">{e.from_email || '—'}</span>
                <span className="correspondence-doc__arrow"> → </span>
                <span className="correspondence-doc__addr">{e.to_email || '—'}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </article>
  );
}

/* =============================================================
 * Styles — TeamComponentStatsPanel-тэй ижил зарчмаар экспортолж,
 * print хуудас / preview өөрсдийн <style> tag-даа inject хийнэ
 * (Tailwind print HTML руу дамждаггүй). Navy #0F243E.
 * ============================================================= */
export const PROJECT_CORRESPONDENCE_DOC_STYLES = `
.correspondence-doc { font-family: "Arial", Helvetica, sans-serif; color: #111; line-height: 1.45; max-width: 760px; margin: 18px auto; padding: 0 16px; }
.correspondence-doc--placeholder { font-style: italic; color: #888; padding: 20px 16px; text-align: center; }
.correspondence-doc__title {
  text-align: center;
  font-size: 15pt;
  font-weight: 700;
  margin: 0 0 14px;
  letter-spacing: 0.04em;
  color: #0F243E;
  border-bottom: 2px solid #0F243E;
  padding-bottom: 6px;
}

.correspondence-doc__table { width: 100%; border-collapse: collapse; font-size: 9.5pt; table-layout: fixed; }
.correspondence-doc__table th, .correspondence-doc__table td { padding: 5px 7px; border-bottom: 1px solid #e5e5e5; vertical-align: top; text-align: left; word-wrap: break-word; overflow-wrap: anywhere; }
.correspondence-doc__table th {
  font-weight: 600;
  background: #0F243E;
  color: #fff;
  border-bottom: 1px solid #0F243E;
}

.correspondence-doc__col-no { width: 32px; text-align: center; }
.correspondence-doc__table td.correspondence-doc__col-no { text-align: center; color: #666; font-variant-numeric: tabular-nums; }
.correspondence-doc__col-date { width: 78px; white-space: nowrap; font-variant-numeric: tabular-nums; }
.correspondence-doc__col-dir { width: 80px; }
.correspondence-doc__col-type { width: 96px; }
.correspondence-doc__col-parties { width: 30%; }

.correspondence-doc__subject { font-weight: 600; color: #1a2433; }
.correspondence-doc__ref { font-weight: 400; color: #5a6478; font-size: 8.5pt; }
.correspondence-doc__addr { font-family: "Courier New", monospace; font-size: 8.5pt; color: #333; }
.correspondence-doc__arrow { color: #9aa3b2; }

@media print {
  .correspondence-doc { max-width: none; padding: 0; }
  .correspondence-doc__row { break-inside: avoid; }
  .correspondence-doc__table th {
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
}
`;
