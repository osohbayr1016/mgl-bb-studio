import { CalendarRange, ClipboardList, Search } from 'lucide-react';
import { useLanguage } from '@/shared/i18n';
import { Card, CardContent, CardHeader, CardTitle } from '@/ui/card';
import type { AttendanceSummaryState } from '@/features/attendance/admin/hooks/useAttendanceSummary';
import SummaryRangeControls from '@/features/attendance/admin/components/SummaryRangeControls';
import SummaryTableHead from '@/features/attendance/admin/components/SummaryTableHead';
import SummaryTableRow from '@/features/attendance/admin/components/SummaryTableRow';
import SummaryTableFoot from '@/features/attendance/admin/components/SummaryTableFoot';

/** «Хураангуй» таб — ажилтан тус бүрийн хугацааны нэгтгэл. */
export default function SummaryTab({ state }: { state: AttendanceSummaryState }) {
  const { t } = useLanguage();
  const { summary, sortedSummaryRows, summarySort, handleSummarySort, summaryDisplayTotals } =
    state;

  return (
    <Card
      id="sec-att-admin-summary"
      className="border-border bg-card/60 backdrop-blur scroll-mt-24"
    >
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center gap-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <ClipboardList className="h-4 w-4 text-primary" />
            {t('attendanceAdminPage.summaryReport')}
          </CardTitle>
          {summary && (
            <span className="text-xs text-muted-foreground">
              {summary.period.from} → {summary.period.to} ·{' '}
              {t('attendanceAdminPage.workingDays', { count: summary.period.working_days })} ·{' '}
              {t('attendanceAdminPage.employeeCount', { count: summary.rows.length })}
            </span>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <SummaryRangeControls state={state} />

        {!summary ? (
          <div className="text-center py-12 text-muted-foreground">
            <CalendarRange className="h-8 w-8 mx-auto mb-2 opacity-30" />
            <p className="text-sm">{t('attendanceAdminPage.selectRangeAndView')}</p>
          </div>
        ) : summary.rows.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            <CalendarRange className="h-8 w-8 mx-auto mb-2 opacity-30" />
            <p className="text-sm">{t('attendanceAdminPage.noRecordsInRange')}</p>
          </div>
        ) : sortedSummaryRows.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            <Search className="h-8 w-8 mx-auto mb-2 opacity-30" />
            <p className="text-sm">{t('attendanceAdminPage.searchNoMatch')}</p>
          </div>
        ) : (
          <>
            <p className="md:hidden text-[11px] text-muted-foreground italic mb-2">
              {t('attendanceAdminPage.scrollTableHint')}
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-separate border-spacing-0">
                <SummaryTableHead sort={summarySort} onSort={handleSummarySort} />
                <tbody>
                  {sortedSummaryRows.map((r, idx) => (
                    <SummaryTableRow key={r.user_id} row={r} index={idx} />
                  ))}
                </tbody>
                <SummaryTableFoot
                  totals={summaryDisplayTotals}
                  rowCount={sortedSummaryRows.length}
                />
              </table>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
