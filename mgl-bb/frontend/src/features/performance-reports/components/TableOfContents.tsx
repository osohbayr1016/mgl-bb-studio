import { createContext, useContext, Fragment, type ReactNode } from 'react';
import type { TeamSnapshotItem } from '@/features/performance-reports/types/performanceReport';
import { T } from '@/features/performance-reports/lib/reportText';
import { brand } from '@/shared/config/brand';

/* Provides the brand logo URL to every PageFooter without prop-drilling
 * through TableOfContents, ProjectIntroPage, SummaryNotesPage,
 * TeamSectionPage, ProgressSummarySection, and the rich-text /
 * MissingTeamPage shells. The print + preview pages wrap their tree
 * in this provider. */
export interface ReportBrand {
  logoUrl: string | null;
  clientLogoUrl: string | null;
  /** БАЙГУУЛЛАГЫН тамга — `app_settings.report_stamp_url` (migration 0197).
   *  «Баталгаажуулалт» хуудсанд гарна.  Хэрэглэгчийн `users.stamp_url` БИШ:
   *  тамга компанийнх, гарын үсэг хүнийх.  Аль хэдийн `mediaUrl()`-ээр
   *  бүтэн зам болгосон байх ЁСТОЙ (эх сурвалж нь `/media/<key>`). */
  stampUrl: string | null;
}

export const ReportBrandContext = createContext<ReportBrand>({
  logoUrl: null,
  clientLogoUrl: null,
  stampUrl: null,
});

/* Maps a section anchor id (the `data-toc` attribute on each section's
 * start element) to its physical PDF page. Filled by the print/preview
 * page after layout via computeTocPages(); empty during the first render
 * pass (rows then show a blank page slot until the measurement commits). */
export const TocPageContext = createContext<Record<string, number>>({});

/* Table of contents — generated from the live teams list and stamped
 * with best-effort physical page numbers (see computeTocPages / the
 * print page's ready gate). Each row carries the same `tocId` as the
 * `data-toc` anchor on its section so the page map lines up. */
export interface TableOfContentsProps {
  reportNo: number;
  reportDocNo: string | null;
  reportDate: string;
  teams: TeamSnapshotItem[];
  /** Header for "Ажлын зургийн явцын тайлан" group. */
  showTeamsHeading?: boolean;
}

/* One contents row: label + dotted leader + (best-effort) page number.
 *
 * ⚠️ `data-a4-item` — мөр БҮР бие даасан нэгж.  `.perf-toc__row` нь
 * `display:flex` (блок урсгалд) тул A4Paginator түүнийг margin-оор
 * дараагийн хуудас руу түлхэж чадна; `<ol>` дээр тэмдэглэвэл БҮХ
 * агуулга нэг нэгж болж, багийн жагсаалт уртсахад бүхэлдээ 2 дахь
 * хуудас руу үсэрч эхний хуудсыг хоосон үлдээнэ. */
function TocRow({
  label,
  level,
  tocId,
  topGap,
}: {
  label: ReactNode;
  level: 'top' | 'sub' | 'subsub';
  tocId?: string;
  topGap?: boolean;
}) {
  const pages = useContext(TocPageContext);
  const page = tocId ? pages[tocId] : undefined;
  return (
    <li
      data-a4-item
      className={`perf-toc__row perf-toc__row--${level}`}
      style={topGap ? { marginTop: '6mm' } : undefined}
    >
      <span className="perf-toc__label">{label}</span>
      <span className="perf-toc__dots" />
      <span className="perf-toc__page">{page ?? ''}</span>
    </li>
  );
}

export function TableOfContents({
  reportNo,
  reportDocNo,
  reportDate,
  teams,
}: TableOfContentsProps) {
  const firstTeam = teams[0]?.team_code;
  return (
    <div className="perf-page">
      <PageHeader reportNo={reportNo} reportDocNo={reportDocNo} reportDate={reportDate} />

      <h2 className="perf-toc__title" data-a4-item>
        <T k="toc.h.title">Агуулга</T>
      </h2>

      <ol className="perf-toc__list">
        {/* ⚠️ Дугаарлалт ба `tocId` нь ProjectIntroPage-ийн `data-toc`
            анкеруудтай ЯГ таарах ёстой (s1.1 / s1.2 / s1.3).  Урьд нь энд
            1.2 нь «Project Timeline» гэж бичээстэй, 1.3 огт байхгүй байсан
            тул «1.2 Scope of work» хэсэг агуулгын жагсаалтад ерөөсөө
            гарахгүй, 1.3-ын хуудасны дугаар буруу хэсэг рүү заадаг байв.
            Багуудын нэгтгэсэн график (`data-toc="charts"`) нь танилцуулгын
            блокийн ДАРАА шууд render хийгддэг тул 1.4 болж шилжив. */}
        <TocRow label={<T k="toc.lbl.intro">1. Төслийн танилцуулга</T>} level="top" tocId="intro" />
        <TocRow
          label={<T k="toc.lbl.s11">1.1. General Information / Төслийн ерөнхий мэдээлэл</T>}
          level="sub"
          tocId="s1.1"
        />
        <TocRow
          label={<T k="toc.lbl.s12">1.2. Scope of work / Хамрах хүрээ</T>}
          level="sub"
          tocId="s1.2"
        />
        <TocRow
          label={<T k="toc.lbl.s13">1.3. Project Timeline / Төслийн хугацаа</T>}
          level="sub"
          tocId="s1.3"
        />
        <TocRow
          label={<T k="toc.lbl.s14">1.4. Багуудын нэгтгэсэн график</T>}
          level="sub"
          tocId="charts"
        />

        <TocRow
          label={<T k="toc.lbl.teams">2. Ажлын зургийн явцын тайлан</T>}
          level="top"
          tocId={firstTeam ? `team-narr-${firstTeam}` : undefined}
          topGap
        />
        {/* ⚠️ Багийн мөрүүд нь ДИНАМИК загвар («2.1. BA. Барилга – 42.00%»).
            `<T>` нь бүхэл литералыг түлхүүрлэдэг тул эдгээрийг оруулбал
            баг нэмэгдэх/хувь өөрчлөгдөх бүрд хадгалагдсан текст хуучирна.
            Загвар-түлхүүр ({n}/{code}/{pct}) нь тусдаа ажил. */}
        {teams.map((t, idx) => (
          <Fragment key={t.team_id}>
            <TocRow
              label={`2.${idx + 1}. ${t.team_code}. ${t.team_name_mn} – ${Number(t.progress).toFixed(2)}%`}
              level="sub"
              tocId={`team-narr-${t.team_code}`}
            />
            <TocRow
              label={`2.${idx + 1}.1. Тайлбар бичиг`}
              level="subsub"
              tocId={`team-narr-${t.team_code}`}
            />
            <TocRow
              label={`2.${idx + 1}.2. Явцын тойм`}
              level="subsub"
              tocId={`team-stats-${t.team_code}`}
            />
          </Fragment>
        ))}
      </ol>

      <PageFooter />
    </div>
  );
}

/* =============================================================
 * Хуудасны толгой — БҮХ .perf-page дээр давтагдана.
 * -------------------------------------------------------------
 * ⚠️ ЭНД `<T>` ХЭРЭГЛЭХГҮЙ — зориудынх.  `EditableText` нь
 * `data-editkey` атрибутаараа caret сэргээдэг бөгөөд `restoreCaret()`
 * нь `document.querySelector` (ЭХНИЙ таарц) ашигладаг.  Толгой нь 10+
 * хуудсанд давтагддаг тул нэг л түлхүүр 10 удаа DOM-д гарч, 7-р
 * хуудасны толгойд бичихэд курсор 1-р хуудас руу үсэрнэ.
 * Иймд хуудасны chrome-ыг литерал хэвээр үлдээв; тайлангийн ДУГААР
 * болон Doc.No нь аль хэдийн өгөгдлөөс ирдэг тул засварлах хэрэгцээ
 * бага.  (Ерөнхий дүрэм: нэг баримтад НЭГЭЭС ОЛОН удаа render хийгддэг
 * текст `<T>`-д орох бол түлхүүрт өвөрмөц дагавар заавал хэрэгтэй.)
 * ============================================================= */
export function PageHeader({
  reportNo,
  reportDocNo,
  reportDate,
}: {
  reportNo: number;
  reportDocNo: string | null;
  reportDate: string;
}) {
  return (
    <div className="perf-page__header" data-a4-item>
      <div className="perf-page__header-title">
        Гүйцэтгэлийн тайлан №{String(reportNo).padStart(2, '0')}
        <div className="perf-page__header-doc">
          {reportDocNo && (
            <>
              Шифр: {reportDocNo}
              <br />
            </>
          )}
          {reportDate}
        </div>
      </div>
    </div>
  );
}

export function PageFooter() {
  const { logoUrl } = useContext(ReportBrandContext);
  /* `position:absolute` тул A4Paginator үүнийг өөрөө алгасна (2-р дүрэм) —
   * `data-a4-item` тавих нь утгагүй. */
  return (
    <div className="perf-page__footer">
      <span className="perf-page__footer-logo">
        {logoUrl ? <img src={logoUrl} alt="" /> : <img src="/logo.svg" alt={brand().name} />}
      </span>
      {/* Page number is rendered via the CSS counter on .perf-shell;
          the span just provides the slot, ::before fills the text. */}
      <span className="perf-page__footer-pageno" />
    </div>
  );
}
