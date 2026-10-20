import { useEffect, useState } from 'react';
import { apiFetch } from '@/shared/api/client';
import { useApiQuery } from '@/shared/api/useApi';
import { useLanguage } from '@/shared/i18n';
import type { AttendanceSettings } from '@/shared/types';
import { TIME_RE } from '@/features/attendance/admin/utils/dates';
import type { AdminFeedback } from '@/features/attendance/admin/hooks/useAdminFeedback';

/** Хоцролт / цайны цаг / оффисын IP шалгалтын тохиргоо (admin-only).
 *  `attSettings === null` бол хэрэглэгчийн эрх хүрэхгүй гэж үзээд UI нь
 *  холбогдох картуудыг нууна. */
export function useAttendanceSettings(feedback: AdminFeedback) {
  const { t } = useLanguage();
  const { setError, setSuccess } = feedback;

  const [attSettings, setAttSettings] = useState<AttendanceSettings | null>(null);
  const [graceInput, setGraceInput] = useState<string>('');
  const [penaltyInput, setPenaltyInput] = useState<string>('');
  const [lunchEnabled, setLunchEnabled] = useState<boolean>(true);
  const [lunchStartInput, setLunchStartInput] = useState<string>('12:00');
  const [lunchEndInput, setLunchEndInput] = useState<string>('13:00');
  const [savingSettings, setSavingSettings] = useState(false);

  // Settings query: seed form values once the response arrives.
  const attSettingsQuery = useApiQuery<AttendanceSettings>('/settings/attendance', {
    retry: false,
  });
  useEffect(() => {
    const res = attSettingsQuery.data;
    if (!res) return;
    setAttSettings(res);
    setGraceInput(String(res.late_grace_minutes));
    setPenaltyInput(String(res.late_penalty_per_minute));
    setLunchEnabled(res.lunch_enabled ?? true);
    setLunchStartInput(res.lunch_start ?? '12:00');
    setLunchEndInput(res.lunch_end ?? '13:00');
  }, [attSettingsQuery.data]);

  const saveAttSettings = async () => {
    const grace = parseInt(graceInput, 10);
    const penalty = parseInt(penaltyInput, 10);
    if (!Number.isFinite(grace) || grace < 0 || grace > 60) {
      setError(t('attendanceAdminPage.graceRangeError'));
      return;
    }
    if (!Number.isFinite(penalty) || penalty < 0 || penalty > 100_000) {
      setError(t('attendanceAdminPage.penaltyRangeError'));
      return;
    }
    if (lunchEnabled && (!TIME_RE.test(lunchStartInput) || !TIME_RE.test(lunchEndInput))) {
      setError(t('attendanceAdminPage.lunchTimeInvalid'));
      return;
    }
    if (lunchEnabled && lunchEndInput <= lunchStartInput) {
      setError(t('attendanceAdminPage.lunchEndBeforeStart'));
      return;
    }
    setSavingSettings(true);
    try {
      const res = await apiFetch<AttendanceSettings>('/settings/attendance', {
        method: 'PUT',
        data: {
          late_grace_minutes: grace,
          late_penalty_per_minute: penalty,
          lunch_enabled: lunchEnabled,
          lunch_start: lunchStartInput,
          lunch_end: lunchEndInput,
        },
      });
      setAttSettings(res);
      setSuccess(t('attendanceAdminPage.settingsSaved'));
    } catch (err) {
      setError(err instanceof Error ? err.message : t('common.error'));
    } finally {
      setSavingSettings(false);
    }
  };

  // Оффисын IP шалгалтыг асаах/унтраах.  ON (require_office_ip=true) бол зөвхөн
  // office_ips жагсаалтаас бүртгэнэ; OFF бол хаанаас ч (дурын сүлжээ) бүртгэнэ.
  const setRequireOfficeIp = async (next: boolean) => {
    setSavingSettings(true);
    try {
      const res = await apiFetch<AttendanceSettings>('/settings/attendance', {
        method: 'PUT',
        data: { require_office_ip: next },
      });
      setAttSettings(res);
      setSuccess(t('attendanceAdminPage.settingsSaved'));
    } catch (err) {
      setError(err instanceof Error ? err.message : t('common.error'));
    } finally {
      setSavingSettings(false);
    }
  };

  // Ижил компьютерийн шинэ браузерыг автоматаар таних (0328).  OFF бол зөвхөн
  // яг таарсан браузер — ижил загварын компьютертэй оффист хамгаалалт чангарна,
  // харин браузер солих бүрд admin reset хэрэгтэй болно.
  const setDeviceHwMatch = async (next: boolean) => {
    setSavingSettings(true);
    try {
      const res = await apiFetch<AttendanceSettings>('/settings/attendance', {
        method: 'PUT',
        data: { device_hw_match: next },
      });
      setAttSettings(res);
      setSuccess(t('attendanceAdminPage.settingsSaved'));
    } catch (err) {
      setError(err instanceof Error ? err.message : t('common.error'));
    } finally {
      setSavingSettings(false);
    }
  };

  return {
    attSettings,
    setDeviceHwMatch,
    graceInput,
    setGraceInput,
    penaltyInput,
    setPenaltyInput,
    lunchEnabled,
    setLunchEnabled,
    lunchStartInput,
    setLunchStartInput,
    lunchEndInput,
    setLunchEndInput,
    savingSettings,
    saveAttSettings,
    setRequireOfficeIp,
  };
}

export type AttendanceSettingsState = ReturnType<typeof useAttendanceSettings>;
