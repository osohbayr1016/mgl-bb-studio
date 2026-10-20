import { useLanguage } from '@/shared/i18n';

const TH = 'px-2 py-2 font-medium text-center border-b border-border';

/** Тайлангийн grid-ийн толгой мөр (наалдамхай). */
export default function DailyGridHead() {
  const { t } = useLanguage();
  return (
    <thead className="bg-muted/40 sticky top-0 z-10">
      <tr className="text-xs">
        <th className={`${TH} w-12`}>{t('attendanceAdminPage.colNu')}</th>
        <th className="px-3 py-2 font-medium text-left border-b border-border min-w-[180px]">
          {t('common.name')}
        </th>
        <th className="px-2 py-2 font-medium text-left border-b border-border w-28">
          {t('attendanceAdminPage.colDate')}
        </th>
        <th className={`${TH} w-24`}>{t('attendanceAdminPage.colSchedule')}</th>
        <th className={`${TH} w-20`}>{t('attendanceAdminPage.colPlannedIn')}</th>
        <th className={`${TH} w-20`}>{t('attendanceAdminPage.colPlannedOut')}</th>
        <th className={`${TH} w-20`}>{t('attendanceAdminPage.colActualIn')}</th>
        <th className={`${TH} w-20`}>{t('attendanceAdminPage.colActualOut')}</th>
        <th
          className={`${TH} w-20 bg-rose-100/70 dark:bg-rose-900/30 text-rose-700 dark:text-rose-300`}
        >
          {t('attendanceAdminPage.colLateShort')}
        </th>
        <th className={`${TH} w-32`}>{t('attendanceAdminPage.colLeave')}</th>
        {/* Цагийн нүднүүд `formatMinutesAsHm` — ЦАГ:МИНУТ, аравтын бутархай БИШ. */}
        <th className={`${TH} w-20`}>
          {t('attendanceAdminPage.colLeaveHours')} ({t('attendanceAdminPage.unitHm')})
        </th>
        <th className={`${TH} w-20`}>
          {t('attendanceAdminPage.colOutOfOfficeHours')} ({t('attendanceAdminPage.unitHm')})
        </th>
        <th className={`${TH} w-16`}>{t('attendanceAdminPage.colAbsent')}</th>
        <th className={`${TH} w-20`}>
          {t('attendanceAdminPage.colWorkHours')} ({t('attendanceAdminPage.unitHm')})
        </th>
      </tr>
    </thead>
  );
}
