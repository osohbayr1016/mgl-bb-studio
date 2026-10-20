import { MapPin, RefreshCw } from 'lucide-react';
import { useLanguage } from '@/shared/i18n';
import { Card, CardContent } from '@/ui/card';
import { Button } from '@/ui/button';
import type { OutOfOfficeState } from '@/features/attendance/admin/hooks/useOutOfOfficeAdmin';
import LeaveFilterPill from '@/features/attendance/admin/components/LeaveFilterPill';
import OutOfOfficeListItem from '@/features/attendance/admin/components/OutOfOfficeListItem';
import OutOfOfficeReviewDialog from '@/features/attendance/admin/components/OutOfOfficeReviewDialog';

/** «Гадуур ажил» таб — хүсэлтийн жагсаалт + шийдвэрлэх. */
export default function OutOfOfficeTab({ state }: { state: OutOfOfficeState }) {
  const { t } = useLanguage();
  const { outOfOffice, oooCounts, oooStatusFilter, setOooStatusFilter, loadOutOfOffice } = state;

  return (
    <>
      {/* Filter pills */}
      <div className="flex flex-wrap items-center gap-2">
        <LeaveFilterPill
          label={t('attendanceAdminPage.statusPending')}
          count={oooCounts.pending}
          active={oooStatusFilter === 'pending'}
          tone="yellow"
          onClick={() => setOooStatusFilter('pending')}
        />
        <LeaveFilterPill
          label={t('attendanceAdminPage.statusApproved')}
          count={oooCounts.approved}
          active={oooStatusFilter === 'approved'}
          tone="emerald"
          onClick={() => setOooStatusFilter('approved')}
        />
        <LeaveFilterPill
          label={t('attendanceAdminPage.statusRejected')}
          count={oooCounts.rejected}
          active={oooStatusFilter === 'rejected'}
          tone="rose"
          onClick={() => setOooStatusFilter('rejected')}
        />
        <LeaveFilterPill
          label={t('common.all')}
          count={oooCounts.pending + oooCounts.approved + oooCounts.rejected}
          active={oooStatusFilter === 'all'}
          tone="muted"
          onClick={() => setOooStatusFilter('all')}
        />
        <Button size="sm" variant="ghost" className="ml-auto gap-1.5" onClick={loadOutOfOffice}>
          <RefreshCw className="h-3.5 w-3.5" />
          {t('attendanceAdminPage.refresh')}
        </Button>
      </div>

      {/* List */}
      <Card className="border-border bg-card/60 backdrop-blur">
        <CardContent className="p-0">
          {outOfOffice.length === 0 ? (
            <div className="p-10 text-center text-muted-foreground">
              <MapPin className="h-8 w-8 mx-auto mb-2 opacity-30" />
              <p className="text-sm">{t('attendanceAdminPage.noRequestsInCategory')}</p>
            </div>
          ) : (
            <ul className="divide-y divide-border/40">
              {outOfOffice.map((o) => (
                <OutOfOfficeListItem key={o.id} request={o} onReview={state.startOooReview} />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <OutOfOfficeReviewDialog state={state} />
    </>
  );
}
