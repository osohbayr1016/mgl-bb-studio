import { MEDIA_BASE_URL } from '@/shared/api/client';
import { useLanguage } from '@/shared/i18n';
import { cn } from '@/shared/lib/utils';
import { teamChipClass } from '@/shared/lib/team-colors';
import { formatDisplayName } from '@/shared/lib/formatting';
import type { AttendanceSummaryRow } from '@/shared/types';
import { Avatar, AvatarImage, AvatarFallback } from '@/ui/avatar';
import {
  formatHoursDec,
  formatMinutesAsHm,
  formatMnt,
  formatShortDate,
  minutesToHoursDec,
} from '@/features/attendance/admin/utils/format';

const CELL = 'px-2 py-1.5 text-center text-xs tabular-nums border-b border-border/40';

/** Хураангуй хүснэгтийн нэг ажилтны мөр. */
export default function SummaryTableRow({
  row: r,
  index,
}: {
  row: AttendanceSummaryRow;
  index: number;
}) {
  const { t } = useLanguage();
  return (
    <tr className="hover:bg-muted/30 transition-colors">
      <td className="px-2 py-1.5 text-center text-xs text-muted-foreground border-b border-border/40 tabular-nums">
        {index + 1}
      </td>
      <td className="px-3 py-1.5 border-b border-border/40">
        <div className="flex items-center gap-2">
          <Avatar className="h-7 w-7">
            {r.profile_image && (
              <AvatarImage
                src={`${MEDIA_BASE_URL}${r.profile_image}`}
                alt={formatDisplayName(r.full_name)}
              />
            )}
            <AvatarFallback className="text-[10px]">
              {formatDisplayName(r.full_name).slice(0, 2).toUpperCase()}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium truncate">{formatDisplayName(r.full_name)}</span>
              {r.team_code && (
                <span
                  className={cn(
                    'font-mono text-[10px] px-1 rounded border',
                    teamChipClass(r.team_code),
                  )}
                >
                  {r.team_code}
                </span>
              )}
            </div>
            {r.position && <span className="text-[10px] text-muted-foreground">{r.position}</span>}
          </div>
        </div>
      </td>
      {/* Ажиллах өдөр */}
      <td className={cn(CELL, 'text-muted-foreground')}>{r.expected_days}</td>
      {/* Ажилласан өдөр */}
      <td className={CELL}>
        {r.present_days}
        {(r.extra_days ?? 0) > 0 && (
          // Амралт/баярын өдөр ажилласан — хүлээгдэх өдрийн тоонд ордоггүй тул
          // `ирсэн` дүнг хөөргөхгүй, зэрэгцээ жижиг тэмдэглэнэ.
          <span
            className="ml-1 text-[10px] font-medium text-teal-700 dark:text-teal-300"
            title={t('attendanceAdminPage.extraDaysHint')}
          >
            +{r.extra_days}
          </span>
        )}
      </td>
      {/* Ажиллах цаг */}
      <td className={cn(CELL, 'text-muted-foreground')}>{formatHoursDec(r.expected_minutes)}</td>
      {/* Ажилласан цаг */}
      <td
        className={cn(CELL, 'font-semibold')}
        title={`${t('attendanceAdminPage.tipCredited')}: ${formatHoursDec(r.credited_minutes)}\n${t('attendanceAdminPage.tipTotal')}: ${formatHoursDec(r.total_minutes)}`}
      >
        {formatHoursDec(r.worked_effective_minutes)}
      </td>
      {/* Чөлөө (цаг) */}
      <td
        className={cn(
          CELL,
          r.leave_minutes > 0 ? 'text-sky-700 dark:text-sky-300' : 'text-muted-foreground',
        )}
      >
        {r.leave_minutes > 0 ? formatHoursDec(r.leave_minutes) : ''}
      </td>
      {/* Ээлжийн амралт (өдөр + огноо) */}
      <td className="px-2 py-1.5 text-center text-xs border-b border-border/40">
        {r.annual_leave_days > 0 ? (
          <div className="leading-tight">
            <div className="font-semibold tabular-nums text-violet-700 dark:text-violet-300">
              {t('attendanceAdminPage.daysShort', { count: r.annual_leave_days })}
            </div>
            <div className="text-[10px] text-muted-foreground">
              {r.annual_leave_dates.map(formatShortDate).join(', ')}
            </div>
          </div>
        ) : (
          ''
        )}
      </td>
      {/* Гадуур ажлын цаг */}
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
      {/* Хоцролт / торгууль */}
      <td
        className={cn(
          CELL,
          r.late_minutes > 0 ? 'bg-rose-50 dark:bg-rose-900/20' : 'text-muted-foreground',
        )}
      >
        {r.late_minutes > 0 ? (
          <div className="leading-tight">
            <div className="font-semibold text-rose-700 dark:text-rose-300">
              {t('attendanceAdminPage.minutesShort', { minutes: r.late_minutes })}
            </div>
            <div className="text-[10px] text-rose-600 dark:text-rose-400">
              {formatMnt(r.late_penalty)}
            </div>
          </div>
        ) : (
          ''
        )}
      </td>
      {/* Нийт цаг = `worked_effective_minutes` — өдөр бүр 8ц-аар ТАГЛАГДСАН дүн,
          задаргааны багануудын шууд НИЙЛБЭР БИШ (backend `/summary`-ийн
          тайлбарыг үз).  Tooltip нь урьд «Ажилласан + Чөлөө + Гадуур» гэж
          буруу томьёо зарладаг байсан тул задаргааг зөвхөн лавлагаа болгож,
          аравтын эквивалентыг нэмж харуулна. */}
      <td
        className={cn(CELL, 'font-semibold bg-primary/5 text-primary')}
        title={`${formatMinutesAsHm(r.total_minutes)} = ${minutesToHoursDec(r.total_minutes).toFixed(2)} ${t('attendanceAdminPage.unitHoursDec')}\n${t('attendanceAdminPage.colWorkedHours')}: ${formatMinutesAsHm(r.credited_minutes)}\n${t('attendanceAdminPage.colLeaveHours')}: ${formatMinutesAsHm(r.leave_minutes)}\n${t('attendanceAdminPage.colOutOfOfficeHours')}: ${formatMinutesAsHm(r.out_of_office_minutes)}`}
      >
        {formatHoursDec(r.total_minutes)}
      </td>
    </tr>
  );
}
