import { Clock } from 'lucide-react';
import { useLanguage } from '@/shared/i18n';
import { cn } from '@/shared/lib/utils';
import type { ScheduleKey } from '@/shared/types';
import { SHIFT_TONE } from '@/features/attendance/admin/lib/shiftTone';
import type { ShiftFacet } from '@/features/attendance/admin/hooks/useShiftRoster';

/* =============================================================================
 *  Ээлжээр шүүх chip мөр — «Ажлын цаг» табын гол хэрэглүүр.
 * -----------------------------------------------------------------------------
 *  Эзний шаардлага нь «8-17, 9-18, 8:30-17:30 гэдгээр нь ялгаж харах» — тиймээс
 *  шүүлт нь ЦАГААР бичигдсэн байх ёстой, ээлжийн техник нэрээр ('early') БИШ.
 *  Шошгыг сервер өгнө (`schedule_options`), тул `ORG_SHIFT_*` тохиргоо солигдвол
 *  chip нь дагаж өөрчлөгдөнө.
 *
 *  Зан төлөв нь [[TeamFilterChips]]-тэй ЯГ ИЖИЛ (хоёр chip мөр зэрэгцээ зогсох
 *  тул өөр өөрөөр аашилвал эвдэрсэн мэт харагдана):
 *   · «Бүгд» — сонголтыг цэвэрлэнэ;
 *   · ээлжийн chip — дарвал НЭМНЭ, дахин дарвал ХАСНА;
 *   · тоо нь ШҮҮЛТЭЭС ҮЛ ХАМААРАН бүх ажилтнаас тоологдоно.
 *
 *  ⚠️ Хүнгүй (0) ээлжийн chip ч ГАРНА — «энэ ээлжийг хэн ч сонгоогүй» гэдэг нь
 *  эзний хайж буй хариултын нэг хэсэг; chip алга болбол 0 гэдэг харагдахгүй.
 * ===========================================================================*/
export default function ShiftFilterChips({
  facets,
  selected,
  onToggle,
  onClear,
  allCount,
  className,
}: {
  facets: readonly ShiftFacet[];
  /** Сонгосон ээлжүүд.  Хоосон = бүгд. */
  selected: readonly ScheduleKey[];
  onToggle: (key: ScheduleKey) => void;
  onClear: () => void;
  allCount: number;
  className?: string;
}) {
  const { t } = useLanguage();
  const none = selected.length === 0;

  return (
    <div className={cn('flex flex-wrap items-center gap-1.5 pt-2', className)}>
      <Clock className="h-3.5 w-3.5 text-muted-foreground" />
      <button
        type="button"
        aria-pressed={none}
        onClick={onClear}
        className={cn(
          'rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors tabular-nums',
          none
            ? 'bg-primary text-primary-foreground border-primary'
            : 'border-border text-muted-foreground hover:bg-muted',
        )}
      >
        {t('attendanceAdminPage.openTeamAll')} <span className="opacity-70">{allCount}</span>
      </button>
      {facets.map((f) => {
        const active = selected.includes(f.key);
        const tone = SHIFT_TONE[f.key];
        return (
          <button
            key={f.key}
            type="button"
            title={f.label}
            aria-pressed={active}
            onClick={() => onToggle(f.key)}
            className={cn(
              'rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors tabular-nums',
              active ? tone.chipSolid : tone.chip,
              active
                ? 'ring-1 ring-offset-1 ring-offset-background ring-current'
                : 'opacity-80 hover:opacity-100',
            )}
          >
            {/* Эзний өөрийнх нь хэлсэн бичиглэл: «8-17, 8:30-17:30, 9-18».
                Бүтэн цаг нь `title`-д (hover) үлдэнэ. */}
            {f.short} <span className="opacity-75">{f.count}</span>
          </button>
        );
      })}
    </div>
  );
}
