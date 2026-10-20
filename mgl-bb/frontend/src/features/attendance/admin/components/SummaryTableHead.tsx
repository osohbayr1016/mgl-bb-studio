import { useLanguage } from '@/shared/i18n';
import type { SummarySort, SummarySortKey } from '@/features/attendance/admin/constants';
import SortableTh from '@/features/attendance/admin/components/SortableTh';

// `hm: true` — нүд нь `formatMinutesAsHm` (ЦАГ:МИНУТ, ж: `106:40`) буцаадаг тул
// толгойд нэгжийг ил бичнэ.  «Ажилласан цаг» гэсэн шошгын дор `106:40` гарахад
// уншигч аравтын бутархай гэж андуурч 106.40 (=106ц 24м) гэж уншдаг байсан —
// бодит утга нь 106ц 40м буюу аравтаар 106.67.  XLSX экспорт нь мөн адил
// баганыг АРАВТААР бичдэг тул хоёр гадаргуу хоёулаа нэгжээ зарлана.
type Col = { labelKey: string; key: SummarySortKey; className?: string; hm?: boolean };

const COLS: Col[] = [
  { labelKey: 'attendanceAdminPage.colWorkDays', key: 'expected_days', className: 'w-20' },
  { labelKey: 'attendanceAdminPage.colPresentDays', key: 'present_days', className: 'w-20' },
  {
    labelKey: 'attendanceAdminPage.colExpectedHours',
    key: 'expected_minutes',
    className: 'w-24',
    hm: true,
  },
  {
    labelKey: 'attendanceAdminPage.colWorkedHours',
    key: 'credited_minutes',
    className: 'w-24',
    hm: true,
  },
  {
    labelKey: 'attendanceAdminPage.colLeaveHours',
    key: 'leave_minutes',
    className: 'w-24',
    hm: true,
  },
  { labelKey: 'attendanceAdminPage.colAnnualLeave', key: 'annual_leave_days', className: 'w-40' },
  {
    labelKey: 'attendanceAdminPage.colOutOfOfficeHours',
    key: 'out_of_office_minutes',
    className: 'w-24',
    hm: true,
  },
  {
    labelKey: 'attendanceAdminPage.colLatePenalty',
    key: 'late_minutes',
    className: 'w-32 bg-rose-100/70 dark:bg-rose-900/30 text-rose-700 dark:text-rose-300',
  },
  {
    labelKey: 'attendanceAdminPage.colTotalHours',
    key: 'total_minutes',
    className: 'w-28 bg-primary/10 text-primary',
    hm: true,
  },
];

/** Хураангуй хүснэгтийн эрэмбэлэгддэг толгой мөр. */
export default function SummaryTableHead({
  sort,
  onSort,
}: {
  sort: SummarySort;
  onSort: (key: SummarySortKey) => void;
}) {
  const { t } = useLanguage();
  return (
    <thead className="bg-muted/40">
      <tr className="text-xs">
        <th className="px-2 py-2 font-medium text-center border-b border-border w-10">
          {t('attendanceAdminPage.colNoShort')}
        </th>
        <SortableTh
          label={t('common.name')}
          sortKey="name"
          sort={sort}
          onSort={onSort}
          align="left"
          className="px-3"
        />
        {COLS.map((c) => (
          <SortableTh
            key={c.key}
            label={
              c.hm ? `${t(c.labelKey)} (${t('attendanceAdminPage.unitHm')})` : t(c.labelKey)
            }
            sortKey={c.key}
            sort={sort}
            onSort={onSort}
            className={c.className}
          />
        ))}
      </tr>
    </thead>
  );
}
