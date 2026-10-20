import { Pencil } from 'lucide-react';
import { useLanguage } from '@/shared/i18n';
import { cn } from '@/shared/lib/utils';
import { teamChipClass } from '@/shared/lib/team-colors';
import type { DailyAttendanceRow } from '@/shared/types';
import { Popover, PopoverTrigger, PopoverContent } from '@/ui/popover';
import DayLeaveChips from '@/features/attendance/components/DayLeaveChips';
import { todayStr } from '@/features/attendance/admin/utils/dates';
import { formatGridDate, formatHoursDec } from '@/features/attendance/admin/utils/format';
import type { DailyGridEditor } from '@/features/attendance/admin/hooks/useDailyGridEditor';
import DailyGridEditPopover from '@/features/attendance/admin/components/DailyGridEditPopover';

const CELL = 'px-2 py-1.5 text-center text-xs tabular-nums border-b border-border/40';

/** Тайлангийн grid дэх нэг ажилтан-нэг өдрийн мөр. */
export default function DailyGridRow({
  row: r,
  index,
  groupName,
  groupTeamCode,
  editor,
}: {
  row: DailyAttendanceRow;
  index: number;
  groupName: string;
  groupTeamCode: string | null;
  editor: DailyGridEditor;
}) {
  const { t } = useLanguage();
  const isFirst = index === 0;
  const isWeekend = false; // backend already strips weekends
  const isToday = r.date === todayStr();
  const rowKey = `${r.user_id}-${r.date}`;

  return (
    <tr
      className={cn(
        'hover:bg-muted/30 transition-colors',
        r.is_absent && 'bg-destructive/5',
        r.is_on_leave && 'bg-sky-50/60 dark:bg-sky-900/15',
        isToday && 'bg-emerald-50/40 dark:bg-emerald-900/10',
        isWeekend && 'bg-muted/40',
      )}
    >
      <td className="px-2 py-1.5 text-center text-xs text-muted-foreground border-b border-border/40 tabular-nums">
        {index + 1}
      </td>
      <td className="px-3 py-1.5 border-b border-border/40">
        {isFirst ? (
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium truncate">{groupName}</span>
            {groupTeamCode && (
              <span
                className={cn(
                  'font-mono text-[10px] px-1 rounded border',
                  teamChipClass(groupTeamCode),
                )}
              >
                {groupTeamCode}
              </span>
            )}
          </div>
        ) : null}
      </td>
      <td className="px-2 py-1.5 text-xs tabular-nums border-b border-border/40">
        {formatGridDate(r.date)}
      </td>
      <td className="px-2 py-1.5 text-center text-xs font-mono border-b border-border/40">
        {r.schedule_label}
      </td>
      <td className={cn(CELL, 'text-muted-foreground')}>{r.planned_in}</td>
      <td className={cn(CELL, 'text-muted-foreground')}>{r.planned_out}</td>
      <td className={cn(CELL, 'font-medium', r.late_minutes > 0 && 'text-rose-600')}>
        <Popover
          open={editor.editKey === rowKey}
          onOpenChange={(o) => (o ? editor.openEditor(r) : editor.setEditKey(null))}
        >
          <PopoverTrigger asChild>
            <button
              type="button"
              title={t('attendanceAdminPage.editArrivalTooltip')}
              className="group inline-flex items-center gap-1 rounded px-1 hover:bg-muted/60"
            >
              {r.actual_in ?? <span className="text-muted-foreground">—</span>}
              <Pencil className="h-2.5 w-2.5 opacity-0 group-hover:opacity-50" />
            </button>
          </PopoverTrigger>
          <PopoverContent align="center" className="w-64 space-y-2">
            <DailyGridEditPopover row={r} editor={editor} />
          </PopoverContent>
        </Popover>
      </td>
      <td className={cn(CELL, 'font-medium')}>
        {r.actual_out ?? <span className="text-muted-foreground">—</span>}
      </td>
      <td
        className={cn(
          CELL,
          r.late_minutes > 0
            ? 'bg-rose-50 dark:bg-rose-900/20 text-rose-700 dark:text-rose-300 font-semibold'
            : 'text-muted-foreground',
        )}
      >
        {r.late_minutes > 0 ? r.late_minutes : ''}
      </td>
      <td className="px-2 py-1.5 text-center border-b border-border/40">
        <DayLeaveChips row={r} chipClassName="text-[10px]" />
      </td>
      <td
        className={cn(
          CELL,
          r.leave_minutes > 0 ? 'text-sky-700 dark:text-sky-300' : 'text-muted-foreground',
        )}
      >
        {r.leave_minutes > 0 ? formatHoursDec(r.leave_minutes) : ''}
      </td>
      <td
        className={cn(
          CELL,
          r.out_of_office_minutes > 0
            ? 'text-teal-700 dark:text-teal-300 font-medium'
            : 'text-muted-foreground',
        )}
      >
        {r.out_of_office_minutes > 0 ? formatHoursDec(r.out_of_office_minutes) : ''}
      </td>
      <td className="px-2 py-1.5 text-center text-[11px] border-b border-border/40">
        {r.is_absent ? (
          <span className="font-semibold text-destructive">
            {t('attendanceAdminPage.absentTrue')}
          </span>
        ) : (
          ''
        )}
      </td>
      {/* Нөхцөл нь ХЭВЛЭГДЭХ талбарыг өөрийг нь шалгана: гадуур ажилтай өдөр
          `credited_minutes` нь null боловч `worked_effective_minutes` > 0 —
          урьд нь нүд «—» гарч, дэд дүнд нь тоологддог байв. */}
      <td className={cn(CELL, 'font-medium')}>
        {r.credited_minutes != null || r.worked_effective_minutes > 0 ? (
          <div
            className="flex flex-col items-center gap-0.5 leading-tight"
            title={[
              `${t('attendanceAdminPage.tipActual')}: ${r.work_minutes != null ? formatHoursDec(r.work_minutes) : '—'}`,
              (r.non_project_credit_minutes ?? 0) > 0
                ? `${t('attendanceAdminPage.tipNonProjectCredit')}: ${formatHoursDec(r.non_project_credit_minutes ?? 0)}`
                : null,
              `${t('attendanceAdminPage.tipExpected')}: ${formatHoursDec(r.expected_minutes)}`,
              `${t('attendanceAdminPage.tipLate')}: ${t('attendanceAdminPage.minutesShort', { minutes: r.late_minutes ?? 0 })}`,
              `${t('attendanceAdminPage.tipCredited')}: ${formatHoursDec(r.credited_minutes)}`,
              r.total_minutes != null
                ? `${t('attendanceAdminPage.tipTotal')}: ${formatHoursDec(r.total_minutes)}`
                : null,
            ]
              .filter(Boolean)
              .join('\n')}
          >
            <span>{formatHoursDec(r.worked_effective_minutes)}</span>
          </div>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </td>
    </tr>
  );
}
