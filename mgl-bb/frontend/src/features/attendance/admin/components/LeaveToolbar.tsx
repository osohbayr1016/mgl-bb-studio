import { Plus, RefreshCw } from 'lucide-react';
import { useLanguage } from '@/shared/i18n';
import { cn } from '@/shared/lib/utils';
import { Button } from '@/ui/button';
import type { LeavesQueryState } from '@/features/attendance/admin/hooks/useLeavesQuery';
import LeaveFilterPill from '@/features/attendance/admin/components/LeaveFilterPill';

/** Чөлөөний төрлийн дэд таб + статусын шүүлт + «Чөлөө нөхөж бүртгэх» товч. */
export default function LeaveToolbar({
  leaves,
  onGrant,
}: {
  leaves: LeavesQueryState;
  onGrant: () => void;
}) {
  const { t } = useLanguage();
  const {
    leaveTypeTab,
    setLeaveTypeTab,
    leaveStatusFilter,
    setLeaveStatusFilter,
    leaveCounts,
    loadLeaves,
  } = leaves;

  const subTab = (value: 'other' | 'annual', label: string) => (
    <button
      type="button"
      onClick={() => setLeaveTypeTab(value)}
      className={cn(
        'rounded-md px-3.5 py-1.5 text-sm font-medium transition-colors',
        leaveTypeTab === value
          ? 'bg-background text-foreground shadow-sm'
          : 'text-muted-foreground hover:text-foreground',
      )}
    >
      {label}
    </button>
  );

  return (
    <>
      {/* Төрлийн дэд таб — Ээлжийн амралтыг бусад чөлөөнөөс тусад нь харна.
          Статусын шүүлт (доор) хоёуланд нь хэвээр ажиллана. */}
      <div className="inline-flex rounded-lg border border-border bg-muted/40 p-0.5">
        {subTab('other', t('attendanceAdminPage.leaveTabOther'))}
        {subTab('annual', t('attendanceAdminPage.leaveTypeAnnual'))}
      </div>

      {/* Filter pills */}
      <div className="flex flex-wrap items-center gap-2">
        <LeaveFilterPill
          label={t('attendanceAdminPage.statusPending')}
          count={leaveCounts.pending}
          active={leaveStatusFilter === 'pending'}
          tone="yellow"
          onClick={() => setLeaveStatusFilter('pending')}
        />
        <LeaveFilterPill
          label={t('attendanceAdminPage.statusApproved')}
          count={leaveCounts.approved}
          active={leaveStatusFilter === 'approved'}
          tone="emerald"
          onClick={() => setLeaveStatusFilter('approved')}
        />
        <LeaveFilterPill
          label={t('attendanceAdminPage.statusRejected')}
          count={leaveCounts.rejected}
          active={leaveStatusFilter === 'rejected'}
          tone="rose"
          onClick={() => setLeaveStatusFilter('rejected')}
        />
        <LeaveFilterPill
          label={t('attendanceAdminPage.statusCancelled')}
          count={leaveCounts.cancelled}
          active={leaveStatusFilter === 'cancelled'}
          tone="slate"
          onClick={() => setLeaveStatusFilter('cancelled')}
        />
        <LeaveFilterPill
          label={t('common.all')}
          count={
            leaveCounts.pending +
            leaveCounts.approved +
            leaveCounts.rejected +
            leaveCounts.cancelled
          }
          active={leaveStatusFilter === 'all'}
          tone="muted"
          onClick={() => setLeaveStatusFilter('all')}
        />
        {/* Чөлөө нөхөж бүртгэх — ажилтан өнгөрсөн огноогоор өөрөө хүсэлт
            илгээж чадахгүй тул (lib/leaveWindow.ts) амаар/утсаар мэдэгдсэн
            чөлөөг админ энд бүртгэнэ.  Хүсэлт 'pending' төлөвтэй үүсч,
            дараа нь энэ жагсаалтаас батлагдана
            (server: POST /leaves + user_id + submit_as_pending). */}
        <Button size="sm" className="ml-auto gap-1.5" onClick={onGrant}>
          <Plus className="h-3.5 w-3.5" />
          {t('attendanceAdminPage.grantLeave')}
        </Button>
        <Button size="sm" variant="ghost" className="gap-1.5" onClick={loadLeaves}>
          <RefreshCw className="h-3.5 w-3.5" />
          {t('attendanceAdminPage.refresh')}
        </Button>
      </div>
    </>
  );
}
