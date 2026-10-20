import { RefreshCw, Shield } from 'lucide-react';
import { useLanguage } from '@/shared/i18n';
import { useTabParam } from '@/shared/hooks/useTabParam';
import { Button } from '@/ui/button';
import { KeepAliveTabs, KeepAliveTabsPanel } from '@/ui/keep-alive-tabs';
import {
  ATTENDANCE_ADMIN_TABS,
  type AttendanceAdminTab,
} from '@/features/attendance/admin/constants';
import { useAdminFeedback } from '@/features/attendance/admin/hooks/useAdminFeedback';
import { useTodayAttendance } from '@/features/attendance/admin/hooks/useTodayAttendance';
import { useOpenSessions } from '@/features/attendance/admin/hooks/useOpenSessions';
import { useSessionEditing } from '@/features/attendance/admin/hooks/useSessionEditing';
import { useLeavesQuery } from '@/features/attendance/admin/hooks/useLeavesQuery';
import { useLeaveActions } from '@/features/attendance/admin/hooks/useLeaveActions';
import { useOutOfOfficeAdmin } from '@/features/attendance/admin/hooks/useOutOfOfficeAdmin';
import { useAttendanceReports } from '@/features/attendance/admin/hooks/useAttendanceReports';
import { useAttendanceSummary } from '@/features/attendance/admin/hooks/useAttendanceSummary';
import { useAttendanceSettings } from '@/features/attendance/admin/hooks/useAttendanceSettings';
import { useOfficeIps } from '@/features/attendance/admin/hooks/useOfficeIps';
import { useStaffOptions } from '@/features/attendance/admin/hooks/useStaffOptions';
import { useShiftRoster } from '@/features/attendance/admin/hooks/useShiftRoster';
import StatusAlerts from '@/features/attendance/admin/components/StatusAlerts';
import AttendanceAdminTabsList from '@/features/attendance/admin/components/AttendanceAdminTabsList';
import TodayTab from '@/features/attendance/admin/tabs/TodayTab';
import OpenSessionsTab from '@/features/attendance/admin/tabs/OpenSessionsTab';
import ReportsTab from '@/features/attendance/admin/tabs/ReportsTab';
import SummaryTab from '@/features/attendance/admin/tabs/SummaryTab';
import LeavesTab from '@/features/attendance/admin/tabs/LeavesTab';
import OutOfOfficeTab from '@/features/attendance/admin/tabs/OutOfOfficeTab';
import ShiftsTab from '@/features/attendance/admin/tabs/ShiftsTab';
import IpsTab from '@/features/attendance/admin/tabs/IpsTab';

/**
 * Ирцийн админ самбар — 8 таб.  Энэ файл нь зөвхөн НИЙЛҮҮЛЭГЧ: төлөв нь
 * `admin/hooks/*`-д, дүрслэл нь `admin/tabs/*` + `admin/components/*`-д амьдарна.
 *
 * ⚠️ Табны утга БОЛОН `sec-att-admin-*` id-ууд нь глобал хайлтын гүн холбоосын
 * зорилтууд бөгөөд `shared/lib/search/sections.ts`-д давхардаж бичигдсэн —
 * нэгийг нь өөрчилвөл нөгөөг нь заавал дагуулж засна.
 */
export default function AttendanceAdminPage() {
  const { t } = useLanguage();
  const [tab, setTab] = useTabParam(ATTENDANCE_ADMIN_TABS, 'today');

  const feedback = useAdminFeedback();

  // Дараалал нь хамааралтай: today → open → session засвар → чөлөө.
  const today = useTodayAttendance(tab);
  const openSessions = useOpenSessions(feedback, today.loadToday);
  const editing = useSessionEditing(feedback, today.loadToday, openSessions.refetch);
  const leaves = useLeavesQuery(tab);
  const leaveActions = useLeaveActions({
    feedback,
    tab,
    loadLeaves: leaves.loadLeaves,
    loadToday: today.loadToday,
  });
  const outOfOffice = useOutOfOfficeAdmin(feedback, tab);
  const reports = useAttendanceReports(tab);
  const summary = useAttendanceSummary(tab);
  const settings = useAttendanceSettings(feedback);
  const ips = useOfficeIps(feedback);
  // «Ажлын цаг» — хэн аль ээлжийг сонгосон бэ (таб нээгдэх үед л ачаална).
  const shifts = useShiftRoster(tab, feedback);

  // Ажилтны сонгогчийг зөвхөн диалог нээгдэх үед ачаална.
  const staffOptions = useStaffOptions(editing.manualOpen || leaveActions.grantOpen);

  // Initial-load gating: while the eager queries are still in-flight we
  // show the same spinner the old `setLoading(true)` produced.
  if (today.isLoading || ips.isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <RefreshCw className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <StatusAlerts feedback={feedback} />

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-foreground flex items-center gap-2">
            <Shield className="h-6 w-6 text-primary" />
            {t('attendanceAdminPage.title')}
          </h2>
          <p className="text-sm text-muted-foreground mt-1">{t('attendanceAdminPage.subtitle')}</p>
        </div>
        <Button variant="outline" size="sm" className="gap-2" onClick={today.loadToday}>
          <RefreshCw className="h-3.5 w-3.5" />
          {t('attendanceAdminPage.refresh')}
        </Button>
      </div>

      <KeepAliveTabs value={tab} onValueChange={(v) => setTab(v as AttendanceAdminTab)}>
        <AttendanceAdminTabsList
          openCount={openSessions.openSessions.length}
          leavePendingCount={leaves.leaveCounts.pending}
          oooPendingCount={outOfOffice.oooCounts.pending}
        />

        <KeepAliveTabsPanel value="today" className="space-y-6 mt-6">
          <TodayTab
            today={today}
            editing={editing}
            leaveActions={leaveActions}
            staffOptions={staffOptions}
          />
        </KeepAliveTabsPanel>

        <KeepAliveTabsPanel value="open" className="space-y-6 mt-6">
          <OpenSessionsTab open={openSessions} onFixClockOut={editing.openClockOutFix} />
        </KeepAliveTabsPanel>

        <KeepAliveTabsPanel value="reports" className="space-y-6 mt-6">
          <ReportsTab reports={reports} feedback={feedback} />
        </KeepAliveTabsPanel>

        <KeepAliveTabsPanel value="summary" className="space-y-6 mt-6">
          <SummaryTab state={summary} />
        </KeepAliveTabsPanel>

        <KeepAliveTabsPanel value="leaves" className="space-y-6 mt-6">
          <LeavesTab leaves={leaves} actions={leaveActions} staffOptions={staffOptions} />
        </KeepAliveTabsPanel>

        <KeepAliveTabsPanel value="outofoffice" className="space-y-6 mt-6">
          <OutOfOfficeTab state={outOfOffice} />
        </KeepAliveTabsPanel>

        <KeepAliveTabsPanel value="shifts" className="space-y-6 mt-6">
          <ShiftsTab state={shifts} />
        </KeepAliveTabsPanel>

        <KeepAliveTabsPanel value="ips" className="space-y-6 mt-6">
          <IpsTab settings={settings} ips={ips} />
        </KeepAliveTabsPanel>
      </KeepAliveTabs>
    </div>
  );
}
