import { useCallback, useEffect, useMemo, useState } from 'react';
import { useApiQuery } from '@/shared/api/useApi';
import { useLanguage } from '@/shared/i18n';
import type { AttendanceStats, DailyAttendanceGridResponse } from '@/shared/types';
import type { AttendanceAdminTab } from '@/features/attendance/admin/constants';
import { getWeekStart, todayStr } from '@/features/attendance/admin/utils/dates';
import { nameMatchesQuery } from '@/features/attendance/admin/utils/format';
import { exportTimesheetXlsx } from '@/features/attendance/admin/lib/exportTimesheetXlsx';
import {
  buildTeamFacets,
  matchesTeams,
  pruneTeams,
  teamSelectionLabel,
  toggleTeam,
} from '@/features/attendance/admin/lib/teamFacets';

type DailyBreakdownRow = {
  date: string;
  employees_present: number;
  avg_hours: number;
  total_hours: number;
};

/** Тайлан таб — огнооны муж, өдөр тутмын задаргаа, XLSX-загварын grid. */
export function useAttendanceReports(tab: AttendanceAdminTab) {
  const { t } = useLanguage();

  // Reports date range drives cache keys, so it is declared before the
  // queries that consume it.
  const [reportFrom, setReportFrom] = useState(getWeekStart());
  const [reportTo, setReportTo] = useState(todayStr());
  // Тайлан (daily-grid) дээр нэрээр шүүх.
  const [reportNameQuery, setReportNameQuery] = useState('');
  // Багийн шүүлт — ХООСОН массив бол бүх баг.  «Хаагдаагүй» табтай ЯГ ижил
  // механик (`lib/teamFacets.ts`): олон баг сонгож болно, сонгосон chip дээр
  // дахин дарвал ТУХАЙН баг сонголтоос хасагдана.
  //
  // ⚠️ Шүүлт нь дэлгэцийн grid БОЛОН XLSX экспорт ХОЁУЛАНД нь нөлөөлнө —
  // хоёулаа `filteredGridRows` дундаа авдаг.  Экспорт нь шүүлтгүй бүтэн
  // жагсаалт татдаг байсан алдаа урьд нь гарч байсан тул энэ нь зориуд.
  const [reportTeams, setReportTeams] = useState<string[]>([]);

  const enabled = tab === 'reports';

  const reportStatsQuery = useApiQuery<AttendanceStats>(
    ['/attendance/stats', reportFrom, reportTo],
    `/attendance/stats?from=${reportFrom}&to=${reportTo}`,
    { enabled },
  );
  const reportDailyQuery = useApiQuery<{ daily: DailyBreakdownRow[] }>(
    ['/attendance/report', reportFrom, reportTo],
    `/attendance/report?from=${reportFrom}&to=${reportTo}`,
    { enabled },
  );
  const dailyGridQuery = useApiQuery<DailyAttendanceGridResponse>(
    ['/attendance/daily-grid', reportFrom, reportTo],
    `/attendance/daily-grid?from=${reportFrom}&to=${reportTo}`,
    { enabled },
  );

  const reportDaily = reportDailyQuery.data?.daily ?? [];
  const dailyGrid = dailyGridQuery.data ?? null;

  // Багийн chip-үүд.  Мөр нь «ажилтан × өдөр» тул `user_id`-аар ДАВХАРДАЛГҮЙ
  // тоолно — chip дээр 21 хоногийн мөрийн тоо биш, АЖИЛТНЫ тоо гарах ёстой.
  // Тоолол нь багийн шүүлтээс ҮЛ ХАМААРНА (бүх мөрөөс), эс тэгвэл нэгийг
  // сонгомогц бусад chip 0 болно.
  const reportTeamFacets = useMemo(
    () => buildTeamFacets(dailyGrid?.rows ?? [], t, (r) => r.user_id),
    [dailyGrid, t],
  );
  const reportEmployeeCount = useMemo(
    () => reportTeamFacets.reduce((n, f) => n + f.count, 0),
    [reportTeamFacets],
  );

  // Огнооны муж солигдоход ачаалагдсан өгөгдөлд байхгүй болсон багийг
  // сонголтоос өөрөө хасна — үгүй бол хоосон хүснэгт дээр «олдсонгүй» гэж
  // гарч, хэрэглэгч яагаад гэдгийг ойлгохгүй.  `pruneTeams` нь юу ч
  // хасагдаагүй үед ЯГ ТЭР массивыг буцаадаг тул давталт үүсэхгүй.
  useEffect(() => {
    setReportTeams((prev) => pruneTeams(prev, reportTeamFacets));
  }, [reportTeamFacets]);

  /** «BB (Барилга бүтээц)» / «BA, BB» — идэвхтэй шүүлтийг ХҮСНЭГТИЙН дэргэд
   *  харуулахад.  Огнооны мужийн карт дэлгэц дээрээс гүйлгэгдэн алга болдог тул
   *  зөвхөн chip дээр найдвал «би бүх компанийг харж байна» гэж андуурна. */
  const reportTeamLabel = useMemo(
    () => teamSelectionLabel(reportTeams, reportTeamFacets),
    [reportTeams, reportTeamFacets],
  );

  const toggleReportTeam = useCallback((code: string) => {
    setReportTeams((prev) => toggleTeam(prev, code));
  }, []);
  const clearReportTeams = useCallback(() => setReportTeams([]), []);

  // Тайлангийн grid-ийг нэрээр шүүх — бүтэн ажилтны бүлгийг (бүх өдрийн мөр)
  // хадгална.  DailyAttendanceGrid нь дэд/нийт дүнг шүүсэн мөрөөс дахин боддог.
  const filteredGridRows = useMemo(() => {
    const rows = dailyGrid?.rows ?? [];
    return rows.filter(
      (r) => matchesTeams(r.team_code, reportTeams) && nameMatchesQuery(r.full_name, reportNameQuery),
    );
  }, [dailyGrid, reportTeams, reportNameQuery]);

  const loadReport = useCallback(() => {
    reportStatsQuery.refetch();
    reportDailyQuery.refetch();
    dailyGridQuery.refetch();
  }, [reportStatsQuery, reportDailyQuery, dailyGridQuery]);

  const refetchGrid = useCallback(() => dailyGridQuery.refetch(), [dailyGridQuery]);

  // ⚠️ ШҮҮСЭН мөрүүдийг явуулна.  Урьд нь түүхий `dailyGrid` дамждаг байсан тул
  //    админ нэг ажилтныг шүүж хараад экспортлоход файлд БҮХ ажилтан ордог байв
  //    — дотроо зөв тул илрүүлэхэд бараг боломжгүй.  `.catch` нь мөн заавал:
  //    `onClick`-д шууд холбогдсон async функцийн шидэлт нь unhandled rejection
  //    болж чимээгүй алга болдог (энэ механизм «Хураангуй»-н экспортын алдааг
  //    16 хоног нуусан).
  const exportXlsx = () => {
    if (!dailyGrid) return;
    exportTimesheetXlsx({ ...dailyGrid, rows: filteredGridRows }, t).catch((err) => {
      console.error('[attendance] Цагийн хүснэгт XLSX экспорт амжилтгүй', err);
    });
  };

  return {
    reportFrom,
    setReportFrom,
    reportTo,
    setReportTo,
    reportNameQuery,
    setReportNameQuery,
    reportTeams,
    reportTeamFacets,
    reportEmployeeCount,
    reportTeamLabel,
    toggleReportTeam,
    clearReportTeams,
    reportDaily,
    dailyGrid,
    filteredGridRows,
    loadReport,
    refetchGrid,
    exportXlsx,
  };
}

export type AttendanceReportsState = ReturnType<typeof useAttendanceReports>;
