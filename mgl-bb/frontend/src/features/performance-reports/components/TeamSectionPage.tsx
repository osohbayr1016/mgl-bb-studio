import type { ReactNode } from 'react';
import type { TeamSnapshotItem } from '@/features/performance-reports/types/performanceReport';
import { PageHeader, PageFooter } from '@/features/performance-reports/components/TableOfContents';
import { T } from '@/features/performance-reports/lib/reportText';

/* Per-team narrative + progress chip. The narrative body is the
 * existing team document component (BaReportDocument, etc.) passed
 * in as `children` from the parent page, so we don't duplicate the
 * per-team formatting that already ships for the per-team print
 * route.
 *
 * If no team report has been filled in yet, callers pass `null` for
 * children and we render a placeholder line so the section still
 * appears in the TOC and the page numbers stay deterministic.
 *
 * Rendered as a plain block `.perf-page` (NOT a <table>): Chromium's
 * print engine bleeds <table> content into the @page margins when a
 * table spans A4 sheets, which collided with the repeating
 * puppeteer header/footer. Block flow respects the @page margins, so
 * a long ТАЙЛБАР БИЧИГ paginates cleanly across A4s and never overlaps
 * the header/footer band. The team heading shows once at the top of
 * the section; the puppeteer header carries the report title on every
 * sheet.
 *
 * ---------------------------------------------------------------
 * ТҮЛХҮҮР (`team.*`) — БАГИЙН КОДООР ДАГАВАРЛАНА
 * ---------------------------------------------------------------
 * Энэ компонент нэг баримт дотор БАГ БҮРД дахин render хийгддэг тул
 * тогтмол түлхүүр нь `data-editkey`-г давхардуулж, 3 дахь багийн
 * шошгод бичихэд `restoreCaret()` курсорыг 1-р баг руу үсэргэнэ.
 * Иймд түлхүүр бүр `….<TEAM_CODE>`-оор төгсөнө.  (Блок бүр өөрийн
 * `textOverrides`-той тул энэ нь ямар ч зүйлийг гээхгүй.) */
export interface TeamSectionPageProps {
  reportNo: number;
  reportDocNo: string | null;
  reportDate: string;
  team: TeamSnapshotItem;
  /** Index within the team list — used for the section number. */
  index: number;
  /** Render the client sign-off table after the content (used on the
   *  last page of a team's section). */
  signoff?: boolean;
  /** TOC anchor id — stamped as `data-toc` so the contents page can map
   *  this section to its physical PDF page. */
  tocId?: string;
  /** Team narrative document. `null` when no team_report row exists. */
  children: ReactNode | null;
}

/* Client approval / sign-off table — matches the paper template:
 * a navy "Захиалагчаас баталсан" label spanning the two rows, navy
 * column headers, and one empty white row to fill by hand. */
function SignoffBlock({ kp }: { kp: string }) {
  return (
    <table className="perf-signoff" data-a4-item>
      <tbody>
        <tr>
          <td className="perf-signoff__role" rowSpan={2}>
            <T k={`${kp}.lbl.approved`}>Захиалагчаас баталсан:</T>
            <br />
            <em>
              (<T k={`${kp}.lbl.approved.en`}>Approved by client</T>)
            </em>
          </td>
          <th>
            <T k={`${kp}.col.position`}>Албан тушаал:</T>
            <br />
            <em>
              (<T k={`${kp}.col.position.en`}>Position</T>)
            </em>
          </th>
          <th>
            <T k={`${kp}.col.name`}>Овог нэр:</T>
            <br />
            <em>
              (<T k={`${kp}.col.name.en`}>Prepared by</T>)
            </em>
          </th>
          <th>
            <T k={`${kp}.col.sign`}>Гарын үсэг:</T>
            <br />
            <em>
              (<T k={`${kp}.col.sign.en`}>Sign</T>)
            </em>
          </th>
          <th>
            <T k={`${kp}.col.date`}>Огноо:</T>
            <br />
            <em>
              (<T k={`${kp}.col.date.en`}>Date</T>)
            </em>
          </th>
        </tr>
        <tr>
          <td className="perf-signoff__fill" />
          <td className="perf-signoff__fill" />
          <td className="perf-signoff__fill" />
          <td className="perf-signoff__fill" />
        </tr>
      </tbody>
    </table>
  );
}

export function TeamSectionPage({
  reportNo,
  reportDocNo,
  reportDate,
  team,
  index,
  signoff = false,
  tocId,
  children,
}: TeamSectionPageProps) {
  const kp = `team.${team.team_code}`;
  return (
    <div className="perf-page perf-page--flow" data-toc={tocId}>
      <PageHeader reportNo={reportNo} reportDocNo={reportDocNo} reportDate={reportDate} />
      {/* Гарчиг — бие даасан нэгж (динамик текст тул `<T>`-д ороогүй). */}
      <h2 className="perf-team__heading" data-a4-item>
        {index} {team.team_name_mn} /{team.team_code}/ –{' '}
        <mark>{Number(team.progress).toFixed(2)}%</mark>
      </h2>
      {/* ⚠️ `.perf-team__body` дээр `data-a4-item` ТАВИХГҮЙ — доторх багийн
          ТАЙЛБАР БИЧИГ-үүд (Ba/Bb/Has/…Document) өөрсдөө тэмдэглэгээтэй тул
          пагинатор тэдгээр рүү рекурс хийж нарийвчилж хуваана.  Энд бүрхвэл
          бүхэл баримт нэг нэгж болж хуудсаа давна. */}
      <div className="perf-team__body">
        {children ?? (
          <p className="perf-team__empty" data-a4-item>
            <T k={`${kp}.txt.empty`}>Тайлбар бичиг бөглөгдөөгүй байна.</T>
          </p>
        )}
      </div>
      {signoff && <SignoffBlock kp={kp} />}
      <PageFooter />
    </div>
  );
}
