import { useMemo } from 'react';
import { Timer } from 'lucide-react';
import { useLanguage } from '@/shared/i18n';
import { cn } from '@/shared/lib/utils';
import { teamChipClass } from '@/shared/lib/team-colors';
import type { AttendanceSession } from '@/shared/types';
import { Button } from '@/ui/button';
import { Checkbox } from '@/ui/checkbox';
import { OPEN_PAGE_SIZE } from '@/features/attendance/admin/constants';
import { buildOpenSessionRows } from '@/features/attendance/admin/lib/openSessionRows';
import type { OpenSessionsState } from '@/features/attendance/admin/hooks/useOpenSessions';
import OpenSessionsPager from '@/features/attendance/admin/components/OpenSessionsPager';

/* =============================================================================
 *  «Хаагдаагүй» табын EXCEL-МАЯГИЙН ХҮСНЭГТ.
 * -----------------------------------------------------------------------------
 *  Картан жагсаалт нь нэг дор 3–4 мөр л харуулдаг тул «хэн, хэзээ, хэдэн
 *  хоног» гэдгийг НЭГ ХАРЦААР харах боломжгүй байсан.  Энэ хүснэгт нь
 *  `ReportsTab`-ийн XLSX-загварын grid-тэй ижил хэлээр ярина: багана бүр
 *  .xlsx экспорт болон хэвлэсэн хуудасны багануудтай ЯГ ТААРНА
 *  (`buildOpenSessionRows` гурвуулангийнх нь эх сурвалж).
 * ===========================================================================*/

const TH = 'border border-border px-2 py-2 font-medium text-center whitespace-nowrap';
const TD = 'border border-border px-2 py-1.5 align-middle';

export default function OpenSessionsTable({
  open,
  onFixClockOut,
}: {
  open: OpenSessionsState;
  onFixClockOut: (s: AttendanceSession) => void;
}) {
  const { t } = useLanguage();
  const { filteredOpenSessions, openPageSafe, selectedOpen, toggleOpenSelected } = open;

  // Мөрийн дугаар нь ШҮҮЛТИЙН БҮХ мөрөөр тоологдоно (хуудсаар дахин
  // эхлэхгүй) — хэвлэсэн/татсан файлтай дугаарлалт нь таарах ёстой.
  const rows = useMemo(() => buildOpenSessionRows(filteredOpenSessions), [filteredOpenSessions]);
  const sessionById = useMemo(
    () => new Map(filteredOpenSessions.map((s) => [s.id, s])),
    [filteredOpenSessions],
  );

  const start = openPageSafe * OPEN_PAGE_SIZE;
  const pageRows = rows.slice(start, start + OPEN_PAGE_SIZE);

  return (
    <>
      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full text-xs border-collapse">
          <thead className="bg-muted/50 sticky top-0 z-10">
            <tr>
              <th
                className={`${TH} w-9 no-print`}
                aria-label={t('attendanceAdminPage.selectAll')}
              />
              <th className={`${TH} w-10`}>{t('attendanceAdminPage.colNoShort')}</th>
              <th className={`${TH} w-28`}>{t('attendanceAdminPage.colDate')}</th>
              <th className="border border-border px-2 py-2 font-medium text-left min-w-[10rem]">
                {t('common.name')}
              </th>
              <th className={`${TH} w-20`}>{t('attendanceAdminPage.colNu')}</th>
              <th className={`${TH} w-16`}>{t('attendanceAdminPage.colTeam')}</th>
              <th className={`${TH} w-16`}>{t('attendanceAdminPage.colActualIn')}</th>
              <th className={`${TH} w-16`}>{t('attendanceAdminPage.colActualOut')}</th>
              <th className={`${TH} w-24`}>{t('attendanceAdminPage.colLateMin')}</th>
              <th className={`${TH} w-16`}>{t('attendanceAdminPage.openColDaysOpen')}</th>
              <th className="border border-border px-2 py-2 font-medium text-left min-w-[8rem]">
                {t('attendanceAdminPage.openColNote')}
              </th>
              <th className={`${TH} w-32 no-print`}>{t('common.actions')}</th>
            </tr>
          </thead>
          <tbody>
            {pageRows.map((r) => {
              const session = sessionById.get(r.id);
              return (
                <tr key={r.id} className="hover:bg-muted/30">
                  <td className={`${TD} text-center no-print`}>
                    <Checkbox
                      checked={selectedOpen.has(r.id)}
                      onCheckedChange={() => toggleOpenSelected(r.id)}
                    />
                  </td>
                  <td className={`${TD} text-center tabular-nums text-muted-foreground`}>{r.nu}</td>
                  <td className={`${TD} text-center tabular-nums`}>{r.date}</td>
                  <td className={`${TD} font-medium`}>{r.name}</td>
                  <td className={`${TD} text-center tabular-nums text-muted-foreground`}>
                    {r.employeeId || '—'}
                  </td>
                  <td className={`${TD} text-center`}>
                    {r.teamCode ? (
                      <span
                        title={r.teamName}
                        className={cn(
                          'inline-block rounded border px-1.5 py-0.5 text-[10px] font-semibold',
                          teamChipClass(r.teamCode),
                        )}
                      >
                        {r.teamCode}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className={`${TD} text-center tabular-nums`}>{r.clockIn}</td>
                  <td className={`${TD} text-center text-muted-foreground`}>—</td>
                  <td
                    className={`${TD} text-center tabular-nums ${
                      r.lateMinutes > 0 ? 'text-rose-600 dark:text-rose-400 font-semibold' : ''
                    }`}
                  >
                    {r.lateMinutes || ''}
                  </td>
                  <td
                    className={`${TD} text-center tabular-nums ${
                      r.daysOpen >= 7 ? 'text-warning font-semibold' : ''
                    }`}
                  >
                    {r.daysOpen}
                  </td>
                  <td className={`${TD} text-muted-foreground`} title={r.note}>
                    <span className="line-clamp-2">{r.note}</span>
                  </td>
                  <td className={`${TD} text-center no-print`}>
                    {session && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 gap-1.5"
                        onClick={() => onFixClockOut(session)}
                      >
                        <Timer className="h-3.5 w-3.5" />
                        {t('attendanceAdminPage.fixClockOut')}
                      </Button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <OpenSessionsPager open={open} />
    </>
  );
}
