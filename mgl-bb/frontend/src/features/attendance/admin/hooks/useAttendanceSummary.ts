import { useCallback, useMemo, useState } from 'react';
import { useApiQuery } from '@/shared/api/useApi';
import { useLanguage } from '@/shared/i18n';
import { formatDisplayName } from '@/shared/lib/formatting';
import type { AttendanceSummaryResponse, AttendanceSummaryRow } from '@/shared/types';
import type {
  AttendanceAdminTab,
  SummarySort,
  SummarySortKey,
} from '@/features/attendance/admin/constants';
import { daysAgo, todayStr } from '@/features/attendance/admin/utils/dates';
import { nameMatchesQuery } from '@/features/attendance/admin/utils/format';
import { exportSummaryXlsx } from '@/features/attendance/admin/lib/exportSummaryXlsx';

const EMPTY_TOTALS = {
  expected_days: 0,
  expected_minutes: 0,
  present_days: 0,
  late_minutes: 0,
  late_penalty: 0,
  credited_minutes: 0,
  worked_effective_minutes: 0,
  leave_minutes: 0,
  annual_leave_days: 0,
  out_of_office_minutes: 0,
  total_minutes: 0,
};

/** Хураангуй тайлан (per-employee period rollup) — муж, эрэмбэ, нэрийн шүүлт. */
export function useAttendanceSummary(tab: AttendanceAdminTab) {
  const { t } = useLanguage();

  const [summaryFrom, setSummaryFrom] = useState(daysAgo(29));
  const [summaryTo, setSummaryTo] = useState(todayStr());
  // Хураангуй хүснэгтийн эрэмбэлэлт — нэрээр өсөхөөр эхэлнэ.
  const [summarySort, setSummarySort] = useState<SummarySort>({ key: 'name', dir: 'asc' });
  // Хураангуй дээр нэрээр шүүх.
  const [summaryNameQuery, setSummaryNameQuery] = useState('');

  const summaryQuery = useApiQuery<AttendanceSummaryResponse>(
    ['/attendance/summary', summaryFrom, summaryTo],
    `/attendance/summary?from=${summaryFrom}&to=${summaryTo}`,
    { enabled: tab === 'summary' },
  );
  const summary = summaryQuery.data ?? null;

  const loadSummary = useCallback(() => {
    summaryQuery.refetch();
  }, [summaryQuery]);

  // Багана дээр дарахад эрэмбэ солих — ижил баганыг дарвал чиглэл солигдоно,
  // өөр баганыг дарвал тоонуудыг ихээс бага (буурахаар), нэрийг А→Я-аар эхэлнэ.
  const handleSummarySort = useCallback((key: SummarySortKey) => {
    setSummarySort((prev) =>
      prev.key === key
        ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
        : { key, dir: key === 'name' ? 'asc' : 'desc' },
    );
  }, []);

  // Эрэмбэлсэн мөрүүд — backend нэрээр эрэмбэлж өгдөг ч UI талд нэрээр шүүгээд
  // сонгосон баганаар дахин эрэмбэлнэ.
  const sortedSummaryRows = useMemo(() => {
    const rows = (summary?.rows ?? []).filter((r) =>
      nameMatchesQuery(r.full_name, summaryNameQuery),
    );
    const { key, dir } = summarySort;
    const mul = dir === 'asc' ? 1 : -1;
    const valueOf = (r: AttendanceSummaryRow): number | string => {
      switch (key) {
        case 'name':
          return formatDisplayName(r.full_name).toLowerCase();
        case 'expected_days':
          return r.expected_days;
        case 'present_days':
          return r.present_days;
        case 'expected_minutes':
          return r.expected_minutes;
        case 'credited_minutes':
          return r.worked_effective_minutes;
        case 'leave_minutes':
          return r.leave_minutes;
        case 'annual_leave_days':
          return r.annual_leave_days;
        case 'out_of_office_minutes':
          return r.out_of_office_minutes;
        case 'late_minutes':
          return r.late_minutes;
        case 'total_minutes':
          return r.total_minutes;
      }
    };
    return [...rows].sort((a, b) => {
      const va = valueOf(a);
      const vb = valueOf(b);
      if (typeof va === 'string' || typeof vb === 'string') {
        return String(va).localeCompare(String(vb)) * mul;
      }
      return (va - vb) * mul;
    });
  }, [summary, summarySort, summaryNameQuery]);

  // Харагдаж буй (шүүсэн) мөрүүдийн нийлбэр — нэрээр хайхад НИЙТ мөр тухайн
  // хүний дүнг тусгана.  Шүүлтгүй үед backend-ийн totals-той ижил гарна.
  const summaryDisplayTotals = useMemo(
    () =>
      sortedSummaryRows.reduce(
        (acc, r) => ({
          expected_days: acc.expected_days + r.expected_days,
          expected_minutes: acc.expected_minutes + r.expected_minutes,
          present_days: acc.present_days + r.present_days,
          late_minutes: acc.late_minutes + r.late_minutes,
          late_penalty: acc.late_penalty + r.late_penalty,
          credited_minutes: acc.credited_minutes + r.credited_minutes,
          worked_effective_minutes: acc.worked_effective_minutes + r.worked_effective_minutes,
          leave_minutes: acc.leave_minutes + r.leave_minutes,
          annual_leave_days: acc.annual_leave_days + r.annual_leave_days,
          out_of_office_minutes: acc.out_of_office_minutes + r.out_of_office_minutes,
          total_minutes: acc.total_minutes + r.total_minutes,
        }),
        { ...EMPTY_TOTALS },
      ),
    [sortedSummaryRows],
  );

  // `.catch` ЗААВАЛ хэрэгтэй: экспорт нь `onClick`-д шууд холбогдсон async
  // функц тул шидэлт нь unhandled rejection болж, хэрэглэгчид ЮУ Ч харагдахгүй
  // (React-ийн error boundary event handler-ийн rejection-ыг барихгүй).  Яг
  // ийм болж «XLSX татах» товч 2026-08-10-аас хойш чимээгүй ажиллахгүй байсан.
  const exportXlsx = () => {
    exportSummaryXlsx(summary, sortedSummaryRows, summaryDisplayTotals, t).catch((err) => {
      console.error('[attendance] Хураангуй XLSX экспорт амжилтгүй', err);
    });
  };

  return {
    summary,
    summaryFrom,
    setSummaryFrom,
    summaryTo,
    setSummaryTo,
    summaryNameQuery,
    setSummaryNameQuery,
    summarySort,
    handleSummarySort,
    sortedSummaryRows,
    summaryDisplayTotals,
    loadSummary,
    exportXlsx,
  };
}

export type AttendanceSummaryState = ReturnType<typeof useAttendanceSummary>;
export type SummaryDisplayTotals = AttendanceSummaryState['summaryDisplayTotals'];
