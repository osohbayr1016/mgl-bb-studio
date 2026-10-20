import { useCallback, useState } from 'react';
import { apiFetch } from '@/shared/api/client';
import { useApiQuery } from '@/shared/api/useApi';
import { useLanguage } from '@/shared/i18n';
import type { OutOfOfficeRequest } from '@/shared/types';
import type { AttendanceAdminTab } from '@/features/attendance/admin/constants';
import type { AdminFeedback } from '@/features/attendance/admin/hooks/useAdminFeedback';

export type OooStatusFilter = 'pending' | 'approved' | 'rejected' | 'all';

/** Ажлаас гадуурх цаг (гадуур ажил) — жагсаалт + шийдвэрлэх. */
export function useOutOfOfficeAdmin(feedback: AdminFeedback, tab: AttendanceAdminTab) {
  const { t } = useLanguage();
  const { setError, setSuccess } = feedback;

  const [oooStatusFilter, setOooStatusFilter] = useState<OooStatusFilter>('pending');
  const [reviewingOoo, setReviewingOoo] = useState<{
    req: OutOfOfficeRequest;
    action: 'approved' | 'rejected';
  } | null>(null);
  const [reviewOooNote, setReviewOooNote] = useState('');

  const oooQuery = useApiQuery<{
    requests: OutOfOfficeRequest[];
    counts: { pending: number; approved: number; rejected: number };
  }>(
    ['/out-of-office', oooStatusFilter],
    `/out-of-office${oooStatusFilter === 'all' ? '' : `?status=${oooStatusFilter}`}`,
    { enabled: tab === 'outofoffice' },
  );
  const outOfOffice = oooQuery.data?.requests ?? [];
  const oooCounts = oooQuery.data?.counts ?? { pending: 0, approved: 0, rejected: 0 };

  const loadOutOfOffice = useCallback(() => {
    oooQuery.refetch();
  }, [oooQuery]);

  /** Жагсаалтын мөрөөс шийдвэрийн цонхыг нээх. */
  const startOooReview = (req: OutOfOfficeRequest, action: 'approved' | 'rejected') => {
    setReviewingOoo({ req, action });
    setReviewOooNote('');
  };

  const submitOooReview = async () => {
    if (!reviewingOoo) return;
    try {
      await apiFetch(
        `/out-of-office/${reviewingOoo.req.id}/${reviewingOoo.action === 'approved' ? 'approve' : 'reject'}`,
        { data: { note: reviewOooNote.trim() || null } },
      );
      setSuccess(
        reviewingOoo.action === 'approved'
          ? t('attendanceAdminPage.statusApproved')
          : t('attendanceAdminPage.statusRejected'),
      );
      setReviewingOoo(null);
      setReviewOooNote('');
      loadOutOfOffice();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('common.error'));
    }
  };

  return {
    outOfOffice,
    oooCounts,
    oooStatusFilter,
    setOooStatusFilter,
    loadOutOfOffice,
    reviewingOoo,
    setReviewingOoo,
    reviewOooNote,
    setReviewOooNote,
    startOooReview,
    submitOooReview,
  };
}

export type OutOfOfficeState = ReturnType<typeof useOutOfOfficeAdmin>;
