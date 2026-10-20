import { useContext } from 'react';
import type { PerformanceReport } from '@/features/performance-reports/types/performanceReport';
import { ReportBrandContext } from '@/features/performance-reports/components/TableOfContents';
import { T } from '@/features/performance-reports/lib/reportText';
import { formatPeriodRange } from '@/features/performance-reports/lib/formatPeriod';

/* Cover page — full-bleed navy. Always the first page of the PDF.
 * Mirrors the user's reference mockup.
 *
 * ⚠️ `data-a4-item` ЭНД ХЭРЭГГҮЙ — зориудынх:
 *   • `.perf-cover` нь A4Paginator-ийн 1-р дүрмээр аль хэдийн ХЭСЭГ
 *     (шинэ хуудаснаас эхэлнэ), бөгөөд өндөр нь яг 297mm = нэг цаас.
 *   • Дотоод элементүүд (`__title-wrap`, `__meta`, `__logo`) бүгд
 *     `position:absolute` тул 2-р дүрмээр хэмжилтээс хасагдана —
 *     margin-оор түлхэх боломжгүй, тэмдэглэгээ тавих нь утгагүй. */
export interface CoverPageProps {
  reportNo: number;
  periodStart: string;
  periodEnd: string;
  projectFullTitle: string | null;
  projectName: string;
  clientName: string | null;
  drawingNo: string | null;
}

export function CoverPage(props: CoverPageProps) {
  const numFmt = String(props.reportNo).padStart(2, '0');
  const { logoUrl, clientLogoUrl } = useContext(ReportBrandContext);
  /* Аль нэг тал нь хоосон бол зураасгүйгээр ганц огноо гарна;
   * хоёулаа хоосон бол мөр огт үүсэхгүй. */
  const period = formatPeriodRange(props.periodStart, props.periodEnd, '–');
  return (
    <div className="perf-cover">
      {clientLogoUrl && (
        <img
          src={clientLogoUrl}
          alt=""
          style={{ maxHeight: '64px', maxWidth: '240px', objectFit: 'contain', marginBottom: '16px' }}
        />
      )}
      <div className="perf-cover__title-wrap">
        {/* «№» ба дугаар нь ЗААВАЛ нэг мөрөнд байна.
            Урьд нь шошго нь «…Тайлан №» гэж дуусаад дугаар нь тусдаа
            текст зангилаа байсан.  Засварлах горимд `T` нь
            `display:inline-block` болдог (EditableText) тул хөтөч түүнийг
            атом хайрцаг гэж үзээд ЗААГ нь дээр мөр тасалдаг — үр дүнд нь
            «№» нэг мөрөнд, «05» дараагийн мөрөнд буудаг байв.
            Одоо шошгоос «№»-г салгаж, «№05»-ыг `nowrap` нэг зангилаа
            болгосон тул хэзээ ч салахгүй. */}
        <h1 className="perf-cover__title">
          <T k="cover.h.report">Гүйцэтгэлийн Тайлан</T>{' '}
          <span className="perf-cover__title-no">№{numFmt}</span>
        </h1>
        {period && <div className="perf-cover__period">{period}</div>}
      </div>
      <div className="perf-cover__meta">
        {props.clientName && (
          <div>
            <strong>"{props.clientName}"</strong>{' '}
          </div>
        )}
        <div>{props.projectFullTitle ?? props.projectName}</div>
        {props.drawingNo && (
          <div className="perf-cover__doc-no">
            {/* ⚠️ Энэ утга нь ҮРГЭЛЖ `passport.drawing_no` (Зургийн шифр).
                Хуудасны толгойд жинхэнэ `doc_no` нэмэгдсэн тул нүүрэн дээр
                «Doc. No.» гэж нэрлэвэл нэг баримт дотор нэг шошго хоёр өөр
                утгатай болно. */}
            <T k="cover.lbl.shifr">Шифр:</T> {props.drawingNo}
          </div>
        )}
      </div>
      {logoUrl && <img src={logoUrl} alt="" className="perf-cover__logo" />}
    </div>
  );
}

export function CoverPageFromReport({
  report,
  projectName,
  fullTitle,
  clientName,
  drawingNo,
}: {
  report: PerformanceReport;
  projectName: string;
  fullTitle: string | null;
  clientName: string | null;
  drawingNo: string | null;
}) {
  return (
    <CoverPage
      reportNo={report.report_no}
      periodStart={report.period_start}
      periodEnd={report.period_end}
      projectFullTitle={fullTitle}
      projectName={projectName}
      clientName={clientName}
      drawingNo={drawingNo}
    />
  );
}
