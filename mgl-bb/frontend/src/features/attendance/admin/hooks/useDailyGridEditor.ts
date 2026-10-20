import { useState } from 'react';
import { apiFetch } from '@/shared/api/client';
import { useLanguage } from '@/shared/i18n';
import type { DailyAttendanceRow } from '@/shared/types';
import { TIME_RE } from '@/features/attendance/admin/utils/dates';

/**
 * Inline ирц нөхөх/засах popover-ийн төлөв.  Нэг л мөрийн цонх нээгдэнэ
 * (key = `${user_id}-${date}`).  `/attendance/sessions/upsert` нь 0/1/2+
 * session-ийг сервер талд шийднэ.
 */
export function useDailyGridEditor(onSaved: () => void | Promise<void>) {
  const { t } = useLanguage();

  const [editKey, setEditKey] = useState<string | null>(null);
  const [editIn, setEditIn] = useState('');
  const [editOut, setEditOut] = useState('');
  const [editNextDay, setEditNextDay] = useState(false);
  const [editNote, setEditNote] = useState('');
  const [editSaving, setEditSaving] = useState(false);
  const [editErr, setEditErr] = useState<string | null>(null);

  const openEditor = (r: DailyAttendanceRow) => {
    setEditKey(`${r.user_id}-${r.date}`);
    setEditIn(r.actual_in ?? r.planned_in);
    setEditOut(r.actual_out ?? '');
    setEditNextDay(false);
    setEditNote('');
    setEditErr(null);
  };

  const saveEdit = async (r: DailyAttendanceRow) => {
    if (!TIME_RE.test(editIn)) {
      setEditErr(t('attendanceAdminPage.editTimeInvalid'));
      return;
    }
    setEditSaving(true);
    setEditErr(null);
    try {
      await apiFetch('/attendance/sessions/upsert', {
        data: {
          user_id: r.user_id,
          date: r.date,
          clock_in: editIn,
          clock_out: editOut || undefined,
          next_day: editNextDay || undefined,
          note: editNote.trim() || undefined,
        },
      });
      setEditKey(null);
      await onSaved();
    } catch (e) {
      setEditErr(e instanceof Error ? e.message : t('common.error'));
    } finally {
      setEditSaving(false);
    }
  };

  return {
    editKey,
    setEditKey,
    editIn,
    setEditIn,
    editOut,
    setEditOut,
    editNextDay,
    setEditNextDay,
    editNote,
    setEditNote,
    editSaving,
    editErr,
    openEditor,
    saveEdit,
  };
}

export type DailyGridEditor = ReturnType<typeof useDailyGridEditor>;
