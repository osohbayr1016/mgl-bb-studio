import { Fragment, memo, useMemo } from 'react';
import { useLanguage } from '@/shared/i18n';
import { formatDisplayName } from '@/shared/lib/formatting';
import type { DailyAttendanceRow } from '@/shared/types';
import { formatHoursDec } from '@/features/attendance/admin/utils/format';
import {
  accumulateTotals,
  emptyTotals,
  type GroupTotals,
} from '@/features/attendance/admin/utils/totals';
import { useDailyGridEditor } from '@/features/attendance/admin/hooks/useDailyGridEditor';
import DailyGridRow from '@/features/attendance/admin/components/DailyGridRow';
import DailyGridSubtotalRow from '@/features/attendance/admin/components/DailyGridSubtotalRow';
import DailyGridHead from '@/features/attendance/admin/components/DailyGridHead';

type Group = {
  user_id: number;
  full_name: string;
  team_code: string | null;
  rows: DailyAttendanceRow[];
  totals: GroupTotals;
};

/* =============================================================================
 *  DailyAttendanceGrid — XLSX layout (one row per employee per workday).
 * -----------------------------------------------------------------------------
 *  Replaces the legacy `TimesheetTable` summary.  Approved leave / гадуур ажил
 *  flow into this grid automatically via the `/attendance/daily-grid`
 *  endpoint, so once a manager hits "Зөвшөөрсөн" on a leave request the
 *  Чөлөө cell starts showing a chip + tooltip with the employee's reason.
 *
 *  Memoised so the table only re-renders when the underlying `rows`
 *  reference actually changes; the parent re-renders on every filter/UI
 *  state tweak, which previously cost O(rows) work each time.
 * ===========================================================================*/
const DailyAttendanceGrid = memo(function DailyAttendanceGrid({
  rows,
  onSaved,
}: {
  rows: DailyAttendanceRow[];
  /** Ирц нөхөж/засаж амжилттай хадгалсны дараа grid-ийг дахин татах. */
  onSaved: () => void | Promise<void>;
}) {
  const { t } = useLanguage();
  const editor = useDailyGridEditor(onSaved);

  // Stable per-employee group order: keep the backend's full_name sort but
  // bucket consecutive rows by user_id so the first row of each block is the
  // only one that displays the name (mirrors the XLSX merged-cell look).
  // Totals are computed once per group + once across the whole period so HR
  // can read "ажилсан цаг нийт" without doing the math by hand.
  const { grouped, grandTotal } = useMemo(() => {
    const groups: Group[] = [];
    const grand = emptyTotals();
    for (const r of rows) {
      const last = groups[groups.length - 1];
      let target = last && last.user_id === r.user_id ? last : null;
      if (!target) {
        target = {
          user_id: r.user_id,
          full_name: formatDisplayName(r.full_name),
          team_code: r.team_code,
          rows: [],
          totals: emptyTotals(),
        };
        groups.push(target);
      }
      target.rows.push(r);
      accumulateTotals(target.totals, r);
      accumulateTotals(grand, r);
    }
    return { grouped: groups, grandTotal: grand };
  }, [rows]);

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm border-separate border-spacing-0">
        <DailyGridHead />
        <tbody>
          {grouped.map((group) => (
            <Fragment key={group.user_id}>
              {group.rows.map((r, idx) => (
                <DailyGridRow
                  key={`${r.user_id}-${r.date}`}
                  row={r}
                  index={idx}
                  groupName={group.full_name}
                  groupTeamCode={group.team_code}
                  editor={editor}
                />
              ))}
              <DailyGridSubtotalRow
                label={t(
                  group.totals.extraDays > 0
                    ? 'attendanceAdminPage.subtotalLabelExtra'
                    : 'attendanceAdminPage.subtotalLabel',
                  {
                    days: group.totals.workingDays,
                    present: group.totals.presentDays,
                    extra: group.totals.extraDays,
                  },
                )}
                labelTitle={
                  group.totals.extraDays > 0 ? t('attendanceAdminPage.extraDaysHint') : undefined
                }
                totals={group.totals}
              />
            </Fragment>
          ))}
        </tbody>
        <tfoot>
          <tr className="bg-primary/10 border-t-2 border-primary/40 text-xs">
            <td className="px-2 py-2 text-center font-bold" colSpan={8}>
              {t('attendanceAdminPage.gridGrandTotal', {
                employees: grouped.length,
                days: grandTotal.workingDays,
              })}
            </td>
            <td className="px-2 py-2 text-center font-bold tabular-nums bg-rose-100/60 dark:bg-rose-900/30 text-rose-700 dark:text-rose-300">
              {grandTotal.lateMinutes > 0 ? grandTotal.lateMinutes : ''}
            </td>
            <td className="px-2 py-2 text-center font-bold tabular-nums text-sky-700">
              {grandTotal.leaveDays > 0 ? grandTotal.leaveDays : ''}
            </td>
            <td className="px-2 py-2 text-center font-bold tabular-nums text-sky-700 dark:text-sky-300">
              {grandTotal.leaveMinutes > 0 ? formatHoursDec(grandTotal.leaveMinutes) : ''}
            </td>
            <td className="px-2 py-2 text-center font-bold tabular-nums text-teal-700 dark:text-teal-300">
              {grandTotal.outOfOfficeMinutes > 0
                ? formatHoursDec(grandTotal.outOfOfficeMinutes)
                : ''}
            </td>
            <td className="px-2 py-2 text-center font-bold tabular-nums text-destructive">
              {grandTotal.absentDays > 0 ? grandTotal.absentDays : ''}
            </td>
            <td
              className="px-2 py-2 text-center font-bold tabular-nums"
              title={`${t('attendanceAdminPage.tipActual')}: ${formatHoursDec(grandTotal.workMinutes)}\n${t('attendanceAdminPage.tipTotal')}: ${formatHoursDec(grandTotal.totalMinutes)}`}
            >
              {formatHoursDec(grandTotal.workedEffectiveMinutes)}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
});

export default DailyAttendanceGrid;
