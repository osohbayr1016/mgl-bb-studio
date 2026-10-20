import { Search, Users } from 'lucide-react';
import { useLanguage } from '@/shared/i18n';
import { Card, CardContent, CardHeader, CardTitle } from '@/ui/card';
import { Badge } from '@/ui/badge';
import { Input } from '@/ui/input';
import type { AttendanceReportsState } from '@/features/attendance/admin/hooks/useAttendanceReports';
import DailyAttendanceGrid from '@/features/attendance/admin/components/DailyAttendanceGrid';

/** Daily attendance grid — XLSX layout (one row per employee per day). */
export default function ReportTimesheetCard({
  reports,
  onSaved,
}: {
  reports: AttendanceReportsState;
  onSaved: () => Promise<void>;
}) {
  const { t } = useLanguage();
  const { dailyGrid, filteredGridRows, reportNameQuery, setReportNameQuery, reportTeamLabel } =
    reports;

  if (!dailyGrid || dailyGrid.rows.length === 0) return null;

  return (
    <Card
      id="sec-att-admin-timesheet"
      className="border-border bg-card/60 backdrop-blur scroll-mt-24"
    >
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Users className="h-4 w-4 text-primary" />
            {t('attendanceAdminPage.timesheet')}
            <Badge variant="outline" className="text-[10px] ml-1">
              {dailyGrid.period.from} → {dailyGrid.period.to} ·{' '}
              {t('attendanceAdminPage.workingDays', { count: dailyGrid.period.working_days })}
            </Badge>
            {reportTeamLabel && (
              <Badge variant="secondary" className="text-[10px] gap-1">
                <Users className="h-3 w-3" />
                {reportTeamLabel}
              </Badge>
            )}
          </CardTitle>
          <div className="relative w-full max-w-xs">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
            <Input
              value={reportNameQuery}
              onChange={(e) => setReportNameQuery(e.target.value)}
              placeholder={t('attendanceAdminPage.searchByName')}
              className="h-9 pl-8"
            />
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {filteredGridRows.length > 0 ? (
          <DailyAttendanceGrid rows={filteredGridRows} onSaved={onSaved} />
        ) : (
          <div className="text-center py-12 text-muted-foreground">
            <Search className="h-8 w-8 mx-auto mb-2 opacity-30" />
            <p className="text-sm">{t('attendanceAdminPage.searchNoMatch')}</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
