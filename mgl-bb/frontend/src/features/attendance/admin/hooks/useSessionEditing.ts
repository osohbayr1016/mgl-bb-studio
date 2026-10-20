import { useState } from 'react';
import { apiFetch } from '@/shared/api/client';
import { useLanguage } from '@/shared/i18n';
import { confirmDialog } from '@/shared/components/ConfirmDialog';
import { formatDisplayName } from '@/shared/lib/formatting';
import type { AttendanceSession } from '@/shared/types';
import { nowHmInUB, TIME_RE, todayStr } from '@/features/attendance/admin/utils/dates';
import { formatTime } from '@/features/attendance/admin/utils/format';
import type { AdminFeedback } from '@/features/attendance/admin/hooks/useAdminFeedback';

/**
 * Ирц гараар засах хоёр урсгал:
 *
 *  • Гарах цаг нөхөх (clock-out backfill) — ажилтан орой цагаа хаалгүй
 *    тарсан үед админ бодит тарсан цагийг нь гараар бичнэ.
 *  • Ирц нөхөж бүртгэх (manual session) — огт ирц бүртгээгүй (чөлөөтэй ч
 *    ажилласан, мартсан г.м.) хүнд ирсэн+гарсан цагийг бүхэлд нь бичнэ.
 */
export function useSessionEditing(
  feedback: AdminFeedback,
  loadToday: () => void,
  refetchOpenSessions: () => void,
) {
  const { t } = useLanguage();
  const { setError, setSuccess } = feedback;

  // ── Гарах цаг нөхөх ──
  const [fixingSession, setFixingSession] = useState<AttendanceSession | null>(null);
  const [fixTime, setFixTime] = useState('18:00');
  // Шөнө дөлөөр (00:00-аас хойш) тарсан — гарах цаг дараагийн өдөрт бичигдэнэ.
  const [fixNextDay, setFixNextDay] = useState(false);
  const [fixNote, setFixNote] = useState('');
  const [fixSaving, setFixSaving] = useState(false);
  // ⚠️ Алдааг ЦОНХ ДОТОР харуулна.  Өмнө нь `setError` (хуудасны дээд
  // тал) ашигладаг байсан тул мессеж цонхны бүрхүүлийн ард нуугдаж, админ
  // «Батлах» дарахад юу ч болохгүй мэт харагддаг байв (2026-10-12: 18:25-д
  // дахин ирсэн бүртгэлд өгөгдмөл 18:00 → сервер 400, харагдаагүй).
  const [fixError, setFixError] = useState<string | null>(null);

  const openClockOutFix = (s: AttendanceSession) => {
    setFixingSession(s);
    // Залруулга бол одоогийн утгыг, өнгөрсөн өдрийн нээлттэй session-д
    // 18:00-г, өнөөдрийнхөд одоогийн цагийг default болгоно (server
    // ирээдүйн цагийг хориглодог тул 18:00 default нь үдээс өмнө 400 өгнө).
    // 18:00-ээс хойш ирсэн (оройн дахин ирэлт) бүртгэлд 18:00 нь ирсэн
    // цагаас өмнө тул ирсэн цагийг өгөгдмөл болгоно — админ засна.
    const inHm = formatTime(s.clock_in);
    const fallback = TIME_RE.test(inHm) && inHm >= '18:00' ? inHm : '18:00';
    setFixTime(
      s.clock_out ? formatTime(s.clock_out) : s.date === todayStr() ? nowHmInUB() : fallback,
    );
    setFixNextDay(false);
    setFixNote('');
    setFixError(null);
  };

  const submitClockOutFix = async () => {
    if (!fixingSession) return;
    if (!TIME_RE.test(fixTime)) {
      setFixError(t('attendanceAdminPage.fixClockOutInvalidTime'));
      return;
    }
    // Серверийн «гарах > ирсэн» дүрмийг урьдчилан шалгана (HH:mm мөр
    // харьцуулалт хоёулаа UB цаг тул зөв; дараагийн өдөр бол үргэлж хойш).
    const inHm = formatTime(fixingSession.clock_in);
    if (!fixNextDay && TIME_RE.test(inHm) && fixTime <= inHm) {
      setFixError(t('attendanceAdminPage.fixClockOutBeforeIn', { in: inHm }));
      return;
    }
    setFixError(null);
    setFixSaving(true);
    try {
      await apiFetch(`/attendance/sessions/${fixingSession.id}/clock-out`, {
        data: { time: fixTime, note: fixNote.trim() || null, next_day: fixNextDay },
      });
      setSuccess(t('attendanceAdminPage.clockOutFixed'));
      setFixingSession(null);
      loadToday();
      refetchOpenSessions();
    } catch (err) {
      setFixError(err instanceof Error ? err.message : t('common.error'));
    } finally {
      setFixSaving(false);
    }
  };

  // ── Ирц нөхөж бүртгэх ──
  const [manualOpen, setManualOpen] = useState(false);
  const [manualUserId, setManualUserId] = useState('');
  const [manualDate, setManualDate] = useState(todayStr());
  const [manualIn, setManualIn] = useState('09:00');
  const [manualOut, setManualOut] = useState('');
  const [manualNextDay, setManualNextDay] = useState(false);
  const [manualNote, setManualNote] = useState('');
  const [manualSaving, setManualSaving] = useState(false);

  const openManualSession = (userId?: number) => {
    setManualUserId(userId ? String(userId) : '');
    setManualDate(todayStr());
    setManualIn('09:00');
    setManualOut('');
    setManualNextDay(false);
    setManualNote('');
    setManualOpen(true);
  };

  const submitManualSession = async () => {
    if (!manualUserId) {
      setError(t('attendanceAdminPage.manualSelectUser'));
      return;
    }
    if (!TIME_RE.test(manualIn)) {
      setError(t('attendanceAdminPage.fixClockOutInvalidTime'));
      return;
    }
    setManualSaving(true);
    try {
      await apiFetch('/attendance/sessions/manual', {
        data: {
          user_id: parseInt(manualUserId, 10),
          date: manualDate,
          clock_in: manualIn,
          clock_out: manualOut || undefined,
          next_day: manualNextDay,
          note: manualNote.trim() || null,
        },
      });
      setSuccess(t('attendanceAdminPage.manualSessionSaved'));
      setManualOpen(false);
      loadToday();
      refetchOpenSessions();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('common.error'));
    } finally {
      setManualSaving(false);
    }
  };

  // Зөвхөн админ нөхөж үүсгэсэн (created_by NOT NULL) бичлэгийг устгана —
  // organic бүртгэлд server тал 409 буцаадаг тул товч нь ч харагдахгүй.
  const deleteManualSession = async (s: AttendanceSession) => {
    if (
      !(await confirmDialog({
        description: t('attendanceAdminPage.deleteManualConfirm', {
          name: formatDisplayName(s.full_name ?? ''),
          date: s.date,
        }),
        variant: 'destructive',
      }))
    )
      return;
    try {
      await apiFetch(`/attendance/sessions/${s.id}`, { method: 'DELETE' });
      setSuccess(t('attendanceAdminPage.manualSessionDeleted'));
      loadToday();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('common.error'));
    }
  };

  return {
    fixingSession,
    setFixingSession,
    fixTime,
    setFixTime,
    fixNextDay,
    setFixNextDay,
    fixNote,
    setFixNote,
    fixSaving,
    fixError,
    setFixError,
    openClockOutFix,
    submitClockOutFix,
    manualOpen,
    setManualOpen,
    manualUserId,
    setManualUserId,
    manualDate,
    setManualDate,
    manualIn,
    setManualIn,
    manualOut,
    setManualOut,
    manualNextDay,
    setManualNextDay,
    manualNote,
    setManualNote,
    manualSaving,
    openManualSession,
    submitManualSession,
    deleteManualSession,
  };
}

export type SessionEditingState = ReturnType<typeof useSessionEditing>;
