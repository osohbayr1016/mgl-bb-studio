import { Search, XCircle } from 'lucide-react';
import { useLanguage } from '@/shared/i18n';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import { Label } from '@/ui/label';
import {
  getLastMonthRange,
  getMonthStart,
  todayStr,
} from '@/features/attendance/admin/utils/dates';
import type { LeavesQueryState } from '@/features/attendance/admin/hooks/useLeavesQuery';
import RangePresetButton from '@/features/attendance/admin/components/RangePresetButton';

/** Нэрээр хайх + хугацааны шүүлт (эхлэх/дуусах огноо, overlap). */
export default function LeaveDateFilters({ leaves }: { leaves: LeavesQueryState }) {
  const { t } = useLanguage();
  const { leaveNameQuery, setLeaveNameQuery, leaveFrom, setLeaveFrom, leaveTo, setLeaveTo } =
    leaves;

  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="relative w-full max-w-xs">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
        <Input
          value={leaveNameQuery}
          onChange={(e) => setLeaveNameQuery(e.target.value)}
          placeholder={t('attendanceAdminPage.searchByName')}
          className="h-9 pl-8"
        />
      </div>
      <div className="space-y-1">
        <Label className="text-xs">{t('attendanceAdminPage.startShort')}</Label>
        <Input
          type="date"
          value={leaveFrom}
          onChange={(e) => setLeaveFrom(e.target.value)}
          className="h-9 w-36"
        />
      </div>
      <div className="space-y-1">
        <Label className="text-xs">{t('attendanceAdminPage.endShort')}</Label>
        <Input
          type="date"
          value={leaveTo}
          onChange={(e) => setLeaveTo(e.target.value)}
          className="h-9 w-36"
        />
      </div>
      <div className="flex flex-wrap gap-1.5">
        <RangePresetButton
          label={t('attendanceAdminPage.presetThisMonth')}
          onClick={() => {
            setLeaveFrom(getMonthStart());
            setLeaveTo(todayStr());
          }}
        />
        <RangePresetButton
          label={t('attendanceAdminPage.presetLastMonth')}
          onClick={() => {
            const [s, e] = getLastMonthRange();
            setLeaveFrom(s);
            setLeaveTo(e);
          }}
        />
      </div>
      {(leaveFrom || leaveTo) && (
        <Button
          size="sm"
          variant="ghost"
          className="gap-1.5 text-muted-foreground"
          onClick={() => {
            setLeaveFrom('');
            setLeaveTo('');
          }}
        >
          <XCircle className="h-3.5 w-3.5" />
          {t('attendanceAdminPage.clearDates')}
        </Button>
      )}
    </div>
  );
}
