import { useLanguage } from '@/shared/i18n';
import { formatHoursDec, formatMnt } from '@/features/attendance/admin/utils/format';
import type { SummaryDisplayTotals } from '@/features/attendance/admin/hooks/useAttendanceSummary';

const FOOT = 'px-2 py-2 text-center font-bold tabular-nums';

/** Харагдаж буй (шүүсэн) мөрүүдийн НИЙТ дүн. */
export default function SummaryTableFoot({
  totals,
  rowCount,
}: {
  totals: SummaryDisplayTotals;
  rowCount: number;
}) {
  const { t } = useLanguage();
  return (
    <tfoot>
      <tr className="bg-primary/10 border-t-2 border-primary/40 text-xs">
        <td className="px-2 py-2 text-center font-bold" colSpan={2}>
          {t('attendanceAdminPage.totalEmployees', { count: rowCount })}
        </td>
        {/* Ажиллах өдөр */}
        <td className={FOOT}>{totals.expected_days}</td>
        {/* Ажилласан өдөр */}
        <td className={FOOT}>{totals.present_days}</td>
        {/* Ажиллах цаг */}
        <td className={FOOT}>{formatHoursDec(totals.expected_minutes)}</td>
        {/* Ажилласан цаг */}
        <td className={FOOT}>{formatHoursDec(totals.worked_effective_minutes)}</td>
        {/* Чөлөө */}
        <td className={`${FOOT} text-sky-700 dark:text-sky-300`}>
          {totals.leave_minutes > 0 ? formatHoursDec(totals.leave_minutes) : ''}
        </td>
        {/* Ээлжийн амралт */}
        <td className={`${FOOT} text-violet-700 dark:text-violet-300`}>
          {totals.annual_leave_days > 0
            ? t('attendanceAdminPage.daysShort', { count: totals.annual_leave_days })
            : ''}
        </td>
        {/* Гадуур ажлын цаг */}
        <td className={`${FOOT} text-teal-700 dark:text-teal-300`}>
          {totals.out_of_office_minutes > 0 ? formatHoursDec(totals.out_of_office_minutes) : ''}
        </td>
        {/* Хоцролт / торгууль */}
        <td
          className={`${FOOT} bg-rose-100/60 dark:bg-rose-900/30 text-rose-700 dark:text-rose-300`}
        >
          {totals.late_minutes > 0 ? (
            <div className="leading-tight">
              <div>{t('attendanceAdminPage.minutesShort', { minutes: totals.late_minutes })}</div>
              <div className="text-[10px]">{formatMnt(totals.late_penalty)}</div>
            </div>
          ) : (
            ''
          )}
        </td>
        {/* Нийт цаг */}
        <td className={`${FOOT} bg-primary/10 text-primary`}>
          {formatHoursDec(totals.total_minutes)}
        </td>
      </tr>
    </tfoot>
  );
}
