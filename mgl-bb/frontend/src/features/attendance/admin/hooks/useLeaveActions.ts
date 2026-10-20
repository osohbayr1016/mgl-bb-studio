import { useState } from 'react';
import { apiFetch } from '@/shared/api/client';
import { useLanguage } from '@/shared/i18n';
import { confirmDialog } from '@/shared/components/ConfirmDialog';
import { formatDisplayName } from '@/shared/lib/formatting';
import type { LeaveRequest } from '@/shared/types';
import type { AttendanceAdminTab } from '@/features/attendance/admin/constants';
import type { AdminFeedback } from '@/features/attendance/admin/hooks/useAdminFeedback';

type Params = {
  feedback: AdminFeedback;
  tab: AttendanceAdminTab;
  loadLeaves: () => void;
  loadToday: () => void;
};

/** Чөлөөний шийдвэр (зөвшөөрөх / татгалзах / цуцлах), шууд устгах, нөхөж бүртгэх
 *  цонхны нээлт/хаалт, болон Today таб дээрх шуурхай цуцлалт.
 *
 *  ⚠️ Нөхөж бүртгэх ФОРМЫН төлөв энд БАЙХГҮЙ — талбар олонтой (ажилтан,
 *  журмын код, хугацааны горим, цаг, хавсралт) тул `LeaveGrantDialog` дотроо
 *  эзэмшинэ.  Энд зөвхөн цонх нээх/хаах ба амжилтын дараах сэргээлт
 *  үлдэнэ; `AttendanceAdminPage` нь `grantOpen`-оор ажилтны жагсаалтыг
 *  залхуугаар ачаалдаг тул тэр хоёр энд байх ёстой. */
export function useLeaveActions({ feedback, tab, loadLeaves, loadToday }: Params) {
  const { t } = useLanguage();
  const { setError, setSuccess } = feedback;

  const [reviewing, setReviewing] = useState<{
    leave: LeaveRequest;
    action: 'approved' | 'rejected' | 'cancelled';
  } | null>(null);
  const [reviewNote, setReviewNote] = useState('');

  /** Жагсаалтын мөрөөс шийдвэрийн цонхыг нээх. */
  const startReview = (leave: LeaveRequest, action: 'approved' | 'rejected' | 'cancelled') => {
    setReviewing({ leave, action });
    setReviewNote('');
  };

  const submitReview = async () => {
    if (!reviewing) return;
    // Backend ч 400 өгнө; энд барьснаар хоосон хүсэлт явуулахгүй.
    if (reviewing.action === 'rejected' && reviewNote.trim() === '') {
      setError(t('attendanceAdminPage.rejectNoteRequired'));
      return;
    }
    try {
      const endpoint =
        reviewing.action === 'approved'
          ? 'approve'
          : reviewing.action === 'rejected'
            ? 'reject'
            : 'cancel';
      await apiFetch(`/leaves/${reviewing.leave.id}/${endpoint}`, {
        data: { note: reviewNote.trim() || null },
      });
      setSuccess(
        reviewing.action === 'approved'
          ? t('attendanceAdminPage.statusApproved')
          : reviewing.action === 'rejected'
            ? t('attendanceAdminPage.statusRejected')
            : t('attendanceAdminPage.leaveCancelled'),
      );
      setReviewing(null);
      setReviewNote('');
      loadLeaves();
      // Цуцлалт ирц/тайлангийн "чөлөөтэй" тооцоог өөрчилдөг тул
      // өнөөдрийн статистикийг хамт сэргээнэ.
      if (reviewing.action === 'cancelled') loadToday();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('common.error'));
    }
  };

  // ── Today tab-аас чөлөө шууд цуцлах ──
  // Чөлөөтэй мөртлөө ажилдаа ирж цаг бүртгүүлсэн хүний чөлөөг шууд хүчингүй
  // болгоно (диалог дуудалгүйгээр, баталгаажуулалттай).
  const [cancellingLeaveId, setCancellingLeaveId] = useState<number | null>(null);
  const cancelLeaveFromToday = async (leaveId: number, name: string) => {
    if (
      !(await confirmDialog({
        description: t('attendanceAdminPage.cancelLeaveConfirm', { name }),
        variant: 'destructive',
      }))
    )
      return;
    setCancellingLeaveId(leaveId);
    try {
      await apiFetch(`/leaves/${leaveId}/cancel`, {
        data: { note: t('attendanceAdminPage.cancelLeaveNote') },
      });
      setSuccess(t('attendanceAdminPage.leaveCancelled'));
      // Чөлөөний жагсаалт + ирцийн тооцоо өөрчлөгдсөн тул өнөөдрийн статистик,
      // (нээлттэй бол) Чөлөө таб-ыг сэргээнэ.
      loadToday();
      if (tab === 'leaves') loadLeaves();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('common.error'));
    } finally {
      setCancellingLeaveId(null);
    }
  };

  // ── Хүсэлтийг шийдвэрлэлгүй шууд устгах ──
  // Зөвшөөрөх/татгалзахгүйгээр мөрийг бүр мөсөн арилгана (давхар илгээсэн,
  // буруу бөглөсөн хүсэлт).  `DELETE /leaves/:id` менежерт аль ч төлөвт
  // зөвшөөрдөг, audit лог (`leave_delete`) үлдээнэ; ажилтанд мэдэгдэл очихгүй.
  const [deletingLeaveId, setDeletingLeaveId] = useState<number | null>(null);
  const deleteLeave = async (leave: LeaveRequest) => {
    const range =
      leave.start_date === leave.end_date
        ? leave.start_date
        : `${leave.start_date} – ${leave.end_date}`;
    if (
      !(await confirmDialog({
        title: t('attendanceAdminPage.deleteLeaveTitle'),
        description: t('attendanceAdminPage.deleteLeaveConfirm', {
          name: formatDisplayName(leave.full_name),
          range,
        }),
        confirmText: t('common.delete'),
        variant: 'destructive',
      }))
    )
      return;
    setDeletingLeaveId(leave.id);
    try {
      await apiFetch(`/leaves/${leave.id}`, { method: 'DELETE' });
      setSuccess(t('attendanceAdminPage.leaveDeleted'));
      loadLeaves();
      // Зөвшөөрөгдсөн мөр ирцийн «чөлөөтэй» тооцоонд ордог.
      if (leave.status === 'approved') loadToday();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('common.error'));
    } finally {
      setDeletingLeaveId(null);
    }
  };

  // ── Чөлөө нөхөж бүртгэх (admin backfill) ──
  const [grantOpen, setGrantOpen] = useState(false);
  const openLeaveGrant = () => setGrantOpen(true);

  /** `LeaveGrantDialog` амжилттай хадгалсны дараа дуудна.  Мөр нь
   *  «Хүлээгдэж буй» төлөвтэй үүсдэг тул мессеж нь «батлахыг хүлээж
   *  байна» гэдгийг тодотгоно. */
  const onLeaveGranted = () => {
    setSuccess(t('attendanceAdminPage.leaveBackfilled'));
    setGrantOpen(false);
    loadLeaves();
    // Чөлөө нь өнөөдрийн "чөлөөтэй/ирээгүй" тооцоог өөрчилдөг.
    loadToday();
  };

  return {
    reviewing,
    setReviewing,
    reviewNote,
    setReviewNote,
    startReview,
    submitReview,
    cancellingLeaveId,
    cancelLeaveFromToday,
    deletingLeaveId,
    deleteLeave,
    grantOpen,
    setGrantOpen,
    openLeaveGrant,
    onLeaveGranted,
  };
}

export type LeaveActionsState = ReturnType<typeof useLeaveActions>;
