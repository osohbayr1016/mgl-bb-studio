import { Download, RefreshCw } from 'lucide-react';
import { useLanguage } from '@/shared/i18n';
import { Card, CardContent } from '@/ui/card';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import { Label } from '@/ui/label';
import {
  daysAgo,
  getLastMonthRange,
  getMonthStart,
  getWeekStart,
  todayStr,
} from '@/features/attendance/admin/utils/dates';
import type { AttendanceReportsState } from '@/features/attendance/admin/hooks/useAttendanceReports';
import RangePresetButton from '@/features/attendance/admin/components/RangePresetButton';
import TeamFilterChips from '@/features/attendance/admin/components/TeamFilterChips';

/** Тайлангийн огнооны муж + товчлолууд + XLSX татах. */
export default function ReportRangeCard({ reports }: { reports: AttendanceReportsState }) {
  const { t } = useLanguage();
  const {
    reportFrom,
    setReportFrom,
    reportTo,
    setReportTo,
    loadReport,
    exportXlsx,
    dailyGrid,
    reportTeams,
    reportTeamFacets,
    reportEmployeeCount,
    toggleReportTeam,
    clearReportTeams,
  } = reports;

  return (
    <Card className="border-border bg-card/60 backdrop-blur">
      <CardContent className="pt-6 space-y-3">
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1.5">
            <Label className="text-xs">{t('attendanceAdminPage.startDate')}</Label>
            <Input
              type="date"
              value={reportFrom}
              onChange={(e) => setReportFrom(e.target.value)}
              className="w-40"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">{t('attendanceAdminPage.endDate')}</Label>
            <Input
              type="date"
              value={reportTo}
              onChange={(e) => setReportTo(e.target.value)}
              className="w-40"
            />
          </div>
          <Button onClick={loadReport} className="gap-2">
            <RefreshCw className="h-3.5 w-3.5" />
            {t('attendanceAdminPage.viewReport')}
          </Button>
          <Button onClick={exportXlsx} variant="outline" className="gap-2" disabled={!dailyGrid}>
            <Download className="h-3.5 w-3.5" />
            {t('attendanceAdminPage.downloadXlsx')}
          </Button>
        </div>
        <div className="flex flex-wrap gap-1.5 pt-1">
          <RangePresetButton
            label={t('attendanceAdminPage.presetThisWeek')}
            onClick={() => {
              setReportFrom(getWeekStart());
              setReportTo(todayStr());
            }}
          />
          <RangePresetButton
            label={t('attendanceAdminPage.presetThisMonth')}
            onClick={() => {
              setReportFrom(getMonthStart());
              setReportTo(todayStr());
            }}
          />
          <RangePresetButton
            label={t('attendanceAdminPage.presetLastMonth')}
            onClick={() => {
              const [s, e] = getLastMonthRange();
              setReportFrom(s);
              setReportTo(e);
            }}
          />
          <RangePresetButton
            label={t('attendanceAdminPage.presetLast30')}
            onClick={() => {
              setReportFrom(daysAgo(29));
              setReportTo(todayStr());
            }}
          />
        </div>

        {/* Багийн шүүлт — цагийн хүснэгт БОЛОН «Excel татах» ХОЁУЛАНД нь
            нөлөөлнө (`filteredGridRows` дундаа).  «Хаагдаагүй» табынхтай ЯГ
            ижил бүрэлдэхүүн: олон баг сонгож болно, сонгосон дээрээ дахин
            дарвал тайлагдана. */}
        <TeamFilterChips
          facets={reportTeamFacets}
          selected={reportTeams}
          onToggle={toggleReportTeam}
          onClear={clearReportTeams}
          allCount={reportEmployeeCount}
          className="pt-0"
        />
      </CardContent>
    </Card>
  );
}
