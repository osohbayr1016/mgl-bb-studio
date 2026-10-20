import { useLanguage } from '@/shared/i18n';
import { formatHoursDec } from '@/features/attendance/admin/utils/format';
import type { GroupTotals } from '@/features/attendance/admin/utils/totals';

/** Subtotal row rendered at the end of each employee group inside the
 *  daily grid.  Mirrors the XLSX layout (НИЙТ row underneath each block)
 *  so HR can read "ажилсан цаг нийт" / late / leave without
 *  totting the columns by hand. */
export default function DailyGridSubtotalRow({
  label,
  labelTitle,
  totals,
}: {
  label: string;
  /** Шошгын тайлбар (hover) — амралтаар ажилласан өдрийн тухай. */
  labelTitle?: string;
  totals: GroupTotals;
}) {
  const { t } = useLanguage();
  return (
    <tr className="bg-muted/60 border-t border-border font-semibold text-xs">
      <td className="px-2 py-1.5 text-center" />
      <td className="px-3 py-1.5 text-right" colSpan={7}>
        <span className="text-muted-foreground italic" title={labelTitle}>
          {label}
        </span>
      </td>
      <td className="px-2 py-1.5 text-center tabular-nums bg-rose-100/40 dark:bg-rose-900/20 text-rose-700 dark:text-rose-300">
        {totals.lateMinutes > 0 ? totals.lateMinutes : ''}
      </td>
      <td className="px-2 py-1.5 text-center tabular-nums text-sky-700">
        {totals.leaveDays > 0 ? totals.leaveDays : ''}
      </td>
      <td className="px-2 py-1.5 text-center tabular-nums text-sky-700 dark:text-sky-300">
        {totals.leaveMinutes > 0 ? formatHoursDec(totals.leaveMinutes) : ''}
      </td>
      <td className="px-2 py-1.5 text-center tabular-nums text-teal-700 dark:text-teal-300">
        {totals.outOfOfficeMinutes > 0 ? formatHoursDec(totals.outOfOfficeMinutes) : ''}
      </td>
      <td className="px-2 py-1.5 text-center tabular-nums text-destructive">
        {totals.absentDays > 0 ? totals.absentDays : ''}
      </td>
      <td
        className="px-2 py-1.5 text-center tabular-nums"
        title={`${t('attendanceAdminPage.tipActual')}: ${formatHoursDec(totals.workMinutes)}\n${t('attendanceAdminPage.tipTotal')}: ${formatHoursDec(totals.totalMinutes)}`}
      >
        {formatHoursDec(totals.workedEffectiveMinutes)}
      </td>
    </tr>
  );
}
