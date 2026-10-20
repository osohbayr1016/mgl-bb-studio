import { Check } from 'lucide-react';
import { useLanguage } from '@/shared/i18n';
import { cn } from '@/shared/lib/utils';
import { formatDisplayName } from '@/shared/lib/formatting';
import { Button } from '@/ui/button';
import { SHIFT_TONE } from '@/features/attendance/admin/lib/shiftTone';
import type {
  ShiftRosterRow,
  ShiftRosterState,
} from '@/features/attendance/admin/hooks/useShiftRoster';

/**
 * «Ажлын цаг» хүснэгтийн нэг мөрийн ээлжийг засах popover-ийн агуулга —
 * `DailyGridEditPopover`-ийн (ирсэн цаг засах) ижил хэлбэр.
 *
 * Сонголт нь ГУРВАН товч (radio маягаар), шошго нь серверийн
 * `schedule_options`-оос (`state.options`) — «Хэрэглэгчид → засах» цонхны
 * dropdown-той ижил утгууд, харин энд popover дотор dropdown давхарлахгүйн
 * тулд шууд жагсаана.
 */
export default function ShiftEditPopover({
  row,
  state,
}: {
  row: ShiftRosterRow;
  state: ShiftRosterState;
}) {
  const { t } = useLanguage();
  const { options, editValue, setEditValue, editSaving, editErr, closeEditor, saveEdit } = state;

  return (
    <>
      <p className="text-xs font-semibold">{formatDisplayName(row.full_name)}</p>
      <div className="space-y-1" role="radiogroup">
        {options.map((o) => {
          const active = o.key === editValue;
          const Icon = o.icon;
          return (
            <button
              key={o.key}
              type="button"
              role="radio"
              aria-checked={active}
              disabled={editSaving}
              onClick={() => setEditValue(o.key)}
              className={cn(
                'flex w-full items-center gap-2 rounded-md border px-2 py-1.5 text-left text-xs transition-colors',
                active
                  ? SHIFT_TONE[o.key].chip
                  : 'border-border/60 text-foreground hover:bg-muted/60',
              )}
            >
              <Icon className="h-3.5 w-3.5 shrink-0" />
              <span className="flex-1 font-medium tabular-nums">{o.label}</span>
              {active && <Check className="h-3.5 w-3.5 shrink-0" />}
            </button>
          );
        })}
      </div>
      {/* Хүчинтэй огноог СЕРВЕР шийднэ (маргааш / зунаар 9-р сарын 1) —
          хадгалсны дараа амжилтын мөрөнд бодит огноо гарна. */}
      <p className="text-[11px] text-muted-foreground">{t('attendanceShift.adminHelp')}</p>
      {editErr && <p className="text-[11px] text-rose-600">{editErr}</p>}
      <div className="flex justify-end gap-2 pt-0.5">
        <Button size="sm" variant="ghost" onClick={closeEditor} disabled={editSaving}>
          {t('common.cancel')}
        </Button>
        <Button size="sm" onClick={() => saveEdit(row)} disabled={editSaving}>
          {editSaving ? t('common.saving') : t('common.save')}
        </Button>
      </div>
    </>
  );
}
