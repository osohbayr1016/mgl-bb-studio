import { CalendarRange, Search } from 'lucide-react';
import { useLanguage } from '@/shared/i18n';
import { Card, CardContent } from '@/ui/card';
import type { LeavesQueryState } from '@/features/attendance/admin/hooks/useLeavesQuery';
import type { LeaveActionsState } from '@/features/attendance/admin/hooks/useLeaveActions';
import type { StaffOption } from '@/features/attendance/admin/hooks/useStaffOptions';
import LeaveToolbar from '@/features/attendance/admin/components/LeaveToolbar';
import LeaveDateFilters from '@/features/attendance/admin/components/LeaveDateFilters';
import LeaveListItem from '@/features/attendance/admin/components/LeaveListItem';
import LeaveReviewDialog from '@/features/attendance/admin/components/LeaveReviewDialog';
import LeaveGrantDialog from '@/features/attendance/admin/components/LeaveGrantDialog';

/** «Чөлөө» таб — хүсэлтийн жагсаалт, шийдвэрлэх, админаар нөхөж бүртгэх. */
export default function LeavesTab({
  leaves,
  actions,
  staffOptions,
}: {
  leaves: LeavesQueryState;
  actions: LeaveActionsState;
  staffOptions: StaffOption[];
}) {
  const { t } = useLanguage();
  const { filteredLeaves } = leaves;

  return (
    <>
      <LeaveToolbar leaves={leaves} onGrant={actions.openLeaveGrant} />
      <LeaveDateFilters leaves={leaves} />

      {/* List */}
      <Card className="border-border bg-card/60 backdrop-blur">
        <CardContent className="p-0">
          {filteredLeaves.length === 0 ? (
            <div className="p-10 text-center text-muted-foreground">
              {leaves.leaves.length === 0 ? (
                <>
                  <CalendarRange className="h-8 w-8 mx-auto mb-2 opacity-30" />
                  <p className="text-sm">{t('attendanceAdminPage.noRequestsInCategory')}</p>
                </>
              ) : (
                <>
                  <Search className="h-8 w-8 mx-auto mb-2 opacity-30" />
                  <p className="text-sm">{t('attendanceAdminPage.searchNoMatch')}</p>
                </>
              )}
            </div>
          ) : (
            <ul className="divide-y divide-border/40">
              {filteredLeaves.map((l) => (
                <LeaveListItem
                  key={l.id}
                  leave={l}
                  onReview={actions.startReview}
                  onDelete={actions.deleteLeave}
                  deleting={actions.deletingLeaveId === l.id}
                />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <LeaveReviewDialog actions={actions} />
      {/* Шинэ мөр нь ЗААВАЛ 'pending' төлөвтэй үүсдэг тул шүүлтийг тэр
          рүү нь эргүүлнэ — эс бөгөөс «Зөвшөөрөгдсөн» шүүлт дээр байсан
          админд юу ч болоогүй мэт харагдана.  Ээлжийн амралт нь тусдаа
          дэд табтай учир төрлийг нь мөн дагуулна. */}
      <LeaveGrantDialog
        actions={actions}
        staffOptions={staffOptions}
        onCreated={(leaveType) => {
          leaves.setLeaveStatusFilter('pending');
          leaves.setLeaveTypeTab(leaveType === 'annual' ? 'annual' : 'other');
        }}
      />
    </>
  );
}
