import { Download, RefreshCw, Search } from 'lucide-react';
import { useLanguage } from '@/shared/i18n';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import { Label } from '@/ui/label';
import { daysAgo, getLastMonthRange, todayStr } from '@/features/attendance/admin/utils/dates';
import type { AttendanceSummaryState } from '@/features/attendance/admin/hooks/useAttendanceSummary';
import RangePresetButton from '@/features/attendance/admin/components/RangePresetButton';

/** Хураангуй табын огнооны муж, товчлолууд, XLSX татах, нэрээр хайх. */
export default function SummaryRangeControls({ state }: { state: AttendanceSummaryState }) {
  const { t } = useLanguage();
  const {
    summary,
    summaryFrom,
    setSummaryFrom,
    summaryTo,
    setSummaryTo,
    summaryNameQuery,
    setSummaryNameQuery,
    loadSummary,
    exportXlsx,
  } = state;

  return (
    <>
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <Label className="text-xs">{t('attendanceAdminPage.startShort')}</Label>
          <Input
            type="date"
            value={summaryFrom}
            onChange={(e) => setSummaryFrom(e.target.value)}
            className="h-9 w-36"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">{t('attendanceAdminPage.endShort')}</Label>
          <Input
            type="date"
            value={summaryTo}
            onChange={(e) => setSummaryTo(e.target.value)}
            className="h-9 w-36"
          />
        </div>
        <Button onClick={loadSummary} size="sm" className="gap-1.5">
          <RefreshCw className="h-3.5 w-3.5" />
          {t('attendanceAdminPage.view')}
        </Button>
        <Button
          onClick={exportXlsx}
          size="sm"
          variant="outline"
          className="gap-1.5"
          disabled={!summary}
        >
          <Download className="h-3.5 w-3.5" />
          {t('attendanceAdminPage.downloadXlsx')}
        </Button>
      </div>
      <div className="flex flex-wrap gap-1.5">
        <RangePresetButton
          label={t('attendanceAdminPage.presetLast7')}
          onClick={() => {
            setSummaryFrom(daysAgo(6));
            setSummaryTo(todayStr());
          }}
        />
        <RangePresetButton
          label={t('attendanceAdminPage.presetLast15')}
          onClick={() => {
            setSummaryFrom(daysAgo(14));
            setSummaryTo(todayStr());
          }}
        />
        <RangePresetButton
          label={t('attendanceAdminPage.presetLast30')}
          onClick={() => {
            setSummaryFrom(daysAgo(29));
            setSummaryTo(todayStr());
          }}
        />
        <RangePresetButton
          label={t('attendanceAdminPage.presetLastMonth')}
          onClick={() => {
            const [s, e] = getLastMonthRange();
            setSummaryFrom(s);
            setSummaryTo(e);
          }}
        />
      </div>

      {summary && summary.rows.length > 0 && (
        <div className="relative max-w-xs">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
          <Input
            value={summaryNameQuery}
            onChange={(e) => setSummaryNameQuery(e.target.value)}
            placeholder={t('attendanceAdminPage.searchByName')}
            className="h-9 pl-8"
          />
        </div>
      )}
    </>
  );
}
