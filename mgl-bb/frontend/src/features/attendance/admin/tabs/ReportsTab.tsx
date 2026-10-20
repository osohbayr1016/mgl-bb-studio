import { useLanguage } from '@/shared/i18n';
import AttendanceApprovalStatusPanel from '@/features/attendance/components/AttendanceApprovalStatusPanel';
import type { AttendanceReportsState } from '@/features/attendance/admin/hooks/useAttendanceReports';
import type { AdminFeedback } from '@/features/attendance/admin/hooks/useAdminFeedback';
import ReportRangeCard from '@/features/attendance/admin/components/ReportRangeCard';
import ReportTimesheetCard from '@/features/attendance/admin/components/ReportTimesheetCard';
import ReportDailyBreakdown from '@/features/attendance/admin/components/ReportDailyBreakdown';

/** «Тайлан» таб — огнооны муж, ажилтны батлалт, XLSX-загварын grid, өдрийн задаргаа. */
export default function ReportsTab({
  reports,
  feedback,
}: {
  reports: AttendanceReportsState;
  feedback: AdminFeedback;
}) {
  const { t } = useLanguage();

  const handleGridSaved = async () => {
    await reports.refetchGrid();
    feedback.setSuccess(t('attendanceAdminPage.editSaved'));
  };

  return (
    <>
      <ReportRangeCard reports={reports} />

      {/* Ажилтны сарын өөрийн батлалтын төлөв (read-only, тусдаа сар сонголттой). */}
      <AttendanceApprovalStatusPanel />

      <ReportTimesheetCard reports={reports} onSaved={handleGridSaved} />

      <ReportDailyBreakdown
        rows={reports.reportDaily}
        teamFiltered={reports.reportTeams.length > 0}
      />
    </>
  );
}
