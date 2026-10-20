/**
 * ЗХ-ийн НЭГТГЭЛ ТАЙЛАН — хэвлэх / PDF баримт (A4 босоо).
 *
 * Бүтэц (эзний сонгосон «хүснэгт + гол агуулга», зураггүй):
 *   толгой  — гарчиг + лого, шүүлтийн мета (хугацаа, төсөл, төрөл, төлөв)
 *   1       — хураангуй тоо + төрлөөр
 *   2       — төслөөр (бүх төслийн нэгтгэлд), багаар, хүнээр
 *   3       — тайлан бүр НЭГ мөр + доор нь гол агуулга (тайлан бүр өөрийн
 *             <tbody> — хуудасны хил дээр мөр, агуулга хоёр тасрахгүй)
 *
 * ⚠️ Хуудасны зай: `@page` margin 0 + давтагдах thead/tfoot зай (ЗХ-ийн
 *    тайлангийн `asrPrintStyles.ts`-ийн ижил арга) — браузерын хэвлэлт
 *    огноо/URL/«1/2» зурах зайгүй болно; серверийн PDF ч margin 0.
 */
import { Fragment } from 'react';
import { formatDateTime } from '@/shared/lib/time';
import { formatDisplayName } from '@/shared/lib/formatting';
import {
  dotDate,
  entryBlocks,
  entryMeta,
  isMultiProject,
  kpiRows,
  metaRows,
  peopleOf,
  projectLabel,
  redBookLabel,
  statusLabel,
  teamsOf,
  typeLabel,
  typeRows,
  type T,
} from './summaryContent';
import type { AsrSummaryResponse } from './summaryTypes';

const PAGE_TOP_MM = 12;
const PAGE_BOTTOM_MM = 13;
const PAGE_SIDE_MM = 12;

export const ASR_SUMMARY_STYLES = `
@import url('https://fonts.googleapis.com/css2?family=Arimo:ital,wght@0,400;0,700;1,400;1,700&display=swap');

@page { size: A4 portrait; margin: 0; }

.sum-doc {
  font-family: Arimo, Arial, Helvetica, sans-serif;
  color: #111;
  font-size: 9pt;
  line-height: 1.35;
  background: #fff;
  width: 210mm;
  margin: 0 auto;
  box-sizing: border-box;
  padding: 0 ${PAGE_SIDE_MM}mm;
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}
.sum-doc *, .sum-doc *::before, .sum-doc *::after { box-sizing: border-box; }
.sum-page { width: 100%; border-collapse: collapse; }
.sum-page > thead > tr > td { height: ${PAGE_TOP_MM}mm; padding: 0; }
.sum-page > tfoot > tr > td { height: ${PAGE_BOTTOM_MM}mm; padding: 0; }
.sum-page > tbody > tr > td { padding: 0; vertical-align: top; }

@media screen {
  .sum-doc { box-shadow: 0 1px 3px rgba(0,0,0,.12), 0 0 0 1px rgba(0,0,0,.06); }
}
@media print {
  /* index.css нь \`body *\`-ийг бүгдийг нууж зөвхөн .print-area-г харуулдаг —
     энэ мөргүйгээр БҮРЭН ХООСОН хуудас хэвлэгдэнэ (asrPrintStyles.ts-ийн ижил). */
  body, body * { visibility: visible !important; }
  .sum-toolbar { display: none !important; }
}

.sum-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 6mm;
  border-bottom: 1.2pt solid #0F243E; padding-bottom: 2.5mm; margin-bottom: 3mm; }
.sum-title { font-size: 14pt; font-weight: 700; color: #0F243E; letter-spacing: .2pt; margin: 0; }
.sum-sub { font-size: 8.5pt; color: #555; font-style: italic; margin-top: .6mm; }
/* logo.svg-ийн 76% нь хоосон зай (ink 455×349 / viewBox 1920×1080) — томсгоод тайрна (AsrDocKit DocLogo). */
.sum-logo-box { flex: 0 0 auto; width: 26.07mm; height: 20mm; overflow: hidden; position: relative; }
.sum-logo { position: absolute; max-width: none; width: 110.03mm; height: 61.89mm; left: -41.98mm; top: -20.95mm; opacity: .55; }

.sum-meta { width: 100%; border-collapse: collapse; margin-bottom: 4mm; }
.sum-meta td { border: .6pt solid #9aa3ad; padding: 1.2mm 2mm; vertical-align: top; }
.sum-meta td.k { width: 26mm; background: #0F243E; color: #fff; font-weight: 700; font-size: 8pt; }

.sum-h2 { font-size: 10.5pt; font-weight: 700; color: #0F243E; margin: 5mm 0 2mm;
  padding-bottom: .8mm; border-bottom: .6pt solid #c5ccd4; break-after: avoid; }

.sum-kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 2mm; margin-bottom: 2.5mm; }
.sum-kpi { border: .6pt solid #c5ccd4; border-radius: 1.2mm; padding: 1.8mm 2.2mm; break-inside: avoid; }
.sum-kpi .v { font-size: 15pt; font-weight: 700; color: #0F243E; line-height: 1.1; }
.sum-kpi .l { font-size: 7.5pt; color: #555; margin-top: .5mm; }
.sum-types { font-size: 8.5pt; color: #333; }
.sum-types b { color: #0F243E; }

.sum-t { width: 100%; border-collapse: collapse; font-size: 8.5pt; }
.sum-t th { background: #0F243E; color: #fff; font-weight: 700; font-size: 7.8pt; text-align: left;
  padding: 1.2mm 1.5mm; border: .6pt solid #0F243E; }
.sum-t td { border: .6pt solid #c5ccd4; padding: 1.1mm 1.5mm; vertical-align: top; }
.sum-t td.n, .sum-t th.n { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
.sum-t td.nw { white-space: nowrap; }
.sum-t tbody tr:nth-child(even) td { background: #f7f9fb; }
.sum-t thead { display: table-header-group; }
.sum-t tr { break-inside: avoid; }

.sum-two { display: grid; grid-template-columns: 1fr 1fr; gap: 4mm; }

.sum-reg { width: 100%; border-collapse: collapse; font-size: 8.5pt; }
.sum-reg th { background: #0F243E; color: #fff; font-weight: 700; font-size: 7.8pt; text-align: left;
  padding: 1.2mm 1.5mm; border: .6pt solid #0F243E; }
.sum-reg thead { display: table-header-group; }
.sum-reg > tbody { break-inside: avoid; }
.sum-reg td { border: .6pt solid #c5ccd4; padding: 1.1mm 1.5mm; vertical-align: top; }
.sum-reg tr.row td { background: #eef2f6; font-weight: 700; }
.sum-reg td.n { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
.sum-reg td.nw { white-space: nowrap; }
.sum-reg td.body { padding: 1.5mm 2.5mm 2mm; }
.sum-meta-line { color: #555; font-size: 8pt; margin-bottom: 1mm; }
.sum-block { margin-top: 1mm; }
.sum-block .bl { font-weight: 700; font-style: italic; color: #0F243E; }
.sum-block .bt { white-space: pre-wrap; }
.sum-none { color: #888; font-style: italic; }
.sum-badge { display: inline-block; padding: 0 1.4mm; border-radius: 1mm; font-size: 7.5pt; font-weight: 700; }
.sum-badge.ok { background: #dcfce7; color: #166534; }
.sum-badge.wait { background: #fef3c7; color: #92400e; }

.sum-note { font-size: 7.5pt; color: #666; margin-top: 4mm; }
.sum-empty { padding: 8mm 0; text-align: center; color: #666; font-style: italic; }
.sum-warn { border: .6pt solid #d97706; background: #fffbeb; color: #92400e; padding: 1.5mm 2.5mm; margin-bottom: 3mm; }
`;

export function AsrSummaryDocument({ data, t }: { data: AsrSummaryResponse; t: T }) {
  const multi = isMultiProject(data);
  const showProjects = multi && data.by_project.length > 0;
  const regCols = multi ? 8 : 7;

  return (
    <div className="sum-doc" data-testid="asr-summary-doc">
      <table className="sum-page">
        <thead>
          <tr>
            <td />
          </tr>
        </thead>
        <tfoot>
          <tr>
            <td />
          </tr>
        </tfoot>
        <tbody>
          <tr>
            <td>
              <div className="sum-head">
                <div>
                  <h1 className="sum-title">{t('asr.summary.docTitle')}</h1>
                  <div className="sum-sub">
                    {t('asr.summary.docSubtitle')} · {t('asr.summary.generated', { date: formatDateTime(data.generated_at) })}
                  </div>
                </div>
                <div className="sum-logo-box">
                  <img className="sum-logo" src="/logo.svg" alt="MGL E&C" />
                </div>
              </div>

              <table className="sum-meta">
                <tbody>
                  {metaRows(data, t).map(([k, v]) => (
                    <tr key={k}>
                      <td className="k">{k}</td>
                      <td>{v}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {data.truncated && (
                <div className="sum-warn">{t('asr.summary.truncated', { n: data.entries.length })}</div>
              )}

              {data.entries.length === 0 ? (
                <div className="sum-empty">{t('asr.summary.empty')}</div>
              ) : (
                <>
                  <h2 className="sum-h2">{t('asr.summary.secOverview')}</h2>
                  <div className="sum-kpis">
                    {kpiRows(data, t).map(([l, v]) => (
                      <div key={l} className="sum-kpi">
                        <div className="v">{v}</div>
                        <div className="l">{l}</div>
                      </div>
                    ))}
                  </div>
                  <div className="sum-types">
                    {typeRows(data, t).map(([l, v], i) => (
                      <Fragment key={l}>
                        {i > 0 && ' · '}
                        {l} <b>{v}</b>
                      </Fragment>
                    ))}
                  </div>

                  {showProjects && (
                    <>
                      <h2 className="sum-h2">{t('asr.summary.secProjects')}</h2>
                      <table className="sum-t">
                        <thead>
                          <tr>
                            <th className="n">№</th>
                            <th>{t('asr.summary.col.project')}</th>
                            <th>{t('asr.summary.col.shifr')}</th>
                            <th className="n">{t('asr.summary.col.reports')}</th>
                            <th className="n">{t('asr.summary.col.siteVisits')}</th>
                            <th className="n">{t('asr.summary.col.approved')}</th>
                            <th className="n">{t('asr.summary.col.defects')}</th>
                            <th className="n">{t('asr.summary.col.peopleCount')}</th>
                            <th>{t('asr.summary.col.lastDate')}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {data.by_project.map((p, i) => (
                            <tr key={p.project_id}>
                              <td className="n">{i + 1}</td>
                              <td>{projectLabel(p.name)}</td>
                              <td className="nw">{p.shifr ?? ''}</td>
                              <td className="n">{p.reports}</td>
                              <td className="n">{p.site_visits}</td>
                              <td className="n">{p.approved}</td>
                              <td className="n">{p.with_defects}</td>
                              <td className="n">{p.people}</td>
                              <td className="nw">{dotDate(p.last_date)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </>
                  )}

                  <div className="sum-two">
                    <div>
                      <h2 className="sum-h2">{t('asr.summary.secTeams')}</h2>
                      <table className="sum-t">
                        <thead>
                          <tr>
                            <th>{t('asr.summary.col.team')}</th>
                            <th className="n">{t('asr.summary.col.reports')}</th>
                            <th className="n">{t('asr.summary.col.siteVisits')}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {data.by_team.map((x) => (
                            <tr key={x.code}>
                              <td>
                                <b>{x.code}</b>
                                {x.name ? ` · ${x.name}` : ''}
                              </td>
                              <td className="n">{x.reports}</td>
                              <td className="n">{x.site_visits}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <div>
                      <h2 className="sum-h2">{t('asr.summary.secPeople')}</h2>
                      <table className="sum-t">
                        <thead>
                          <tr>
                            <th>{t('asr.summary.col.name')}</th>
                            <th className="n">{t('asr.summary.col.reports')}</th>
                            <th className="n">{t('asr.summary.col.siteVisits')}</th>
                            <th className="n">{t('asr.summary.col.authored')}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {data.by_person.map((x) => (
                            <tr key={x.user_id}>
                              <td>{formatDisplayName(x.name)}</td>
                              <td className="n">{x.reports}</td>
                              <td className="n">{x.site_visits}</td>
                              <td className="n">{x.authored}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  <h2 className="sum-h2">{t('asr.summary.secReports')}</h2>
                  <table className="sum-reg">
                    <thead>
                      <tr>
                        <th>№</th>
                        <th>{t('asr.summary.col.date')}</th>
                        <th>{t('asr.summary.col.docNo')}</th>
                        {multi && <th>{t('asr.summary.col.project')}</th>}
                        <th>{t('asr.summary.col.type')}</th>
                        <th>{t('asr.summary.col.teams')}</th>
                        <th>{t('asr.summary.col.people')}</th>
                        <th>{t('asr.summary.col.status')}</th>
                      </tr>
                    </thead>
                    {data.entries.map((e, i) => {
                      const blocks = entryBlocks(e, t);
                      const meta = entryMeta(e, t);
                      if (e.report_type === 'site') {
                        meta.unshift(`${t('asr.summary.col.redBook')}: ${redBookLabel(e, t)}`);
                      }
                      return (
                        <tbody key={e.id} data-testid="asr-summary-entry">
                          <tr className="row">
                            <td className="n">{i + 1}</td>
                            <td className="nw">{dotDate(e.report_date)}</td>
                            <td className="nw">{e.doc_no ?? '—'}</td>
                            {multi && <td>{projectLabel(e.project_name)}</td>}
                            <td>{typeLabel(e, t)}</td>
                            <td>{teamsOf(e) || '—'}</td>
                            <td>{peopleOf(e).join(', ') || '—'}</td>
                            <td className="nw">
                              <span className={`sum-badge ${e.status === 'approved' ? 'ok' : 'wait'}`}>
                                {statusLabel(e.status, t)}
                              </span>
                            </td>
                          </tr>
                          <tr>
                            <td />
                            <td className="body" colSpan={regCols - 1}>
                              {meta.length > 0 && <div className="sum-meta-line">{meta.join(' · ')}</div>}
                              {blocks.length === 0 ? (
                                <div className="sum-none">{t('asr.summary.noContent')}</div>
                              ) : (
                                blocks.map((b) => (
                                  <div key={b.label} className="sum-block">
                                    <span className="bl">{b.label}: </span>
                                    <span className="bt">{b.text}</span>
                                  </div>
                                ))
                              )}
                            </td>
                          </tr>
                        </tbody>
                      );
                    })}
                  </table>

                  <p className="sum-note">{t('asr.summary.countedNote')}</p>
                </>
              )}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
