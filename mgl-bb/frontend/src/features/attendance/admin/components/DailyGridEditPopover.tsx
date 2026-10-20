import { useLanguage } from '@/shared/i18n';
import { formatDisplayName } from '@/shared/lib/formatting';
import type { DailyAttendanceRow } from '@/shared/types';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import { Label } from '@/ui/label';
import { Checkbox } from '@/ui/checkbox';
import { Textarea } from '@/ui/textarea';
import { formatGridDate } from '@/features/attendance/admin/utils/format';
import type { DailyGridEditor } from '@/features/attendance/admin/hooks/useDailyGridEditor';

/** Тайлангийн grid дэх нэг мөрийн ирсэн/гарсан цагийг засах popover-ийн агуулга. */
export default function DailyGridEditPopover({
  row,
  editor,
}: {
  row: DailyAttendanceRow;
  editor: DailyGridEditor;
}) {
  const { t } = useLanguage();
  const {
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
    saveEdit,
  } = editor;

  return (
    <>
      <p className="text-xs font-semibold">
        {formatDisplayName(row.full_name)} · {formatGridDate(row.date)}
      </p>
      {row.session_count > 1 ? (
        <p className="text-[11px] text-rose-600">{t('attendanceAdminPage.editMultiWarn')}</p>
      ) : (
        <>
          <div className="space-y-1">
            <Label className="text-[11px]">{t('attendanceAdminPage.colActualIn')}</Label>
            <Input
              type="time"
              value={editIn}
              onChange={(e) => setEditIn(e.target.value)}
              className="h-8"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-[11px]">{t('attendanceAdminPage.colActualOut')}</Label>
            <Input
              type="time"
              value={editOut}
              onChange={(e) => setEditOut(e.target.value)}
              className="h-8"
            />
          </div>
          <label className="flex items-center gap-2 text-[11px] text-muted-foreground">
            <Checkbox checked={editNextDay} onCheckedChange={(v) => setEditNextDay(v === true)} />
            {t('attendanceAdminPage.editNextDay')}
          </label>
          <Textarea
            value={editNote}
            onChange={(e) => setEditNote(e.target.value)}
            placeholder={t('attendanceAdminPage.editNotePlaceholder')}
            className="min-h-[44px] text-xs"
          />
          {editErr && <p className="text-[11px] text-rose-600">{editErr}</p>}
          <div className="flex justify-end gap-2 pt-0.5">
            <Button size="sm" variant="ghost" onClick={() => setEditKey(null)}>
              {t('common.cancel')}
            </Button>
            <Button size="sm" onClick={() => saveEdit(row)} disabled={editSaving}>
              {editSaving ? t('common.saving') : t('common.save')}
            </Button>
          </div>
        </>
      )}
    </>
  );
}
