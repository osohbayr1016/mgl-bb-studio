import type { TodayAttendance } from '@/features/attendance/admin/hooks/useTodayAttendance';
import type { SessionEditingState } from '@/features/attendance/admin/hooks/useSessionEditing';
import type { LeaveActionsState } from '@/features/attendance/admin/hooks/useLeaveActions';
import type { StaffOption } from '@/features/attendance/admin/hooks/useStaffOptions';
import TodayStatCards from '@/features/attendance/admin/components/TodayStatCards';
import PresentTodayCard from '@/features/attendance/admin/components/PresentTodayCard';
import AbsentLateCard from '@/features/attendance/admin/components/AbsentLateCard';
import ClockOutFixDialog from '@/features/attendance/admin/components/ClockOutFixDialog';
import ManualSessionDialog from '@/features/attendance/admin/components/ManualSessionDialog';

/** «Өнөөдөр» таб — тоолуурууд, ирсэн/ирээгүй жагсаалт, ирц засах диалогууд. */
export default function TodayTab({
  today,
  editing,
  leaveActions,
  staffOptions,
}: {
  today: TodayAttendance;
  editing: SessionEditingState;
  leaveActions: LeaveActionsState;
  staffOptions: StaffOption[];
}) {
  return (
    <>
      <TodayStatCards todaySessions={today.todaySessions} stats={today.stats} />

      {/* Албан ёсны таскийн цаг (0361) 2026-09-30-аас Тайлан → «Таскийн цаг» табад
          (`/app/reports?tab=tasktime`) — энд давхар харуулахгүй. */}
      <div className="grid gap-6 lg:grid-cols-5">
        <PresentTodayCard
          todaySessions={today.todaySessions}
          onFixClockOut={editing.openClockOutFix}
          onDeleteManual={editing.deleteManualSession}
        />
        <AbsentLateCard
          stats={today.stats}
          cancellingLeaveId={leaveActions.cancellingLeaveId}
          onBackfill={editing.openManualSession}
          onCancelLeave={leaveActions.cancelLeaveFromToday}
        />
      </div>

      <ClockOutFixDialog editing={editing} />
      <ManualSessionDialog editing={editing} staffOptions={staffOptions} />
    </>
  );
}
