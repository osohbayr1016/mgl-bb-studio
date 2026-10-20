import { Users } from 'lucide-react';
import { useLanguage } from '@/shared/i18n';
import { cn } from '@/shared/lib/utils';
import { teamTone } from '@/shared/lib/team-colors';
import { NO_TEAM, type TeamFacet } from '@/features/attendance/admin/lib/teamFacets';

/* =============================================================================
 *  Багийн шүүлтийн chip мөр — «Хаагдаагүй» БА «Тайлан» табын НЭГ БҮРЭЛДЭХҮҮН.
 * -----------------------------------------------------------------------------
 *  Админ бүх ажилтныг нэг дор харах нь ховор: тэр эдгээрийг БАГААР нь салгаж,
 *  тухайн багийн сениорт өгөх баримт болгодог.  Тиймээс шүүлт нь дэлгэц,
 *  ХЭВЛЭХ, EXCEL гуравт нь адилхан нөлөөлнө (дуудагч тал нэг шүүсэн массив
 *  дундаа хуваалцана).
 *
 *  ⚠️ ХОЁР ТАБ ЭНЭ НЭГ ФАЙЛЫГ хуваалцана.  Ижил харагдацтай хоёр chip мөр
 *  өөр өөрөөр аашилвал (нэг нь ганц баг, нөгөө нь олон баг) хэрэглэгч
 *  эвдэрсэн гэж бодно.
 *
 *  Зан төлөв:
 *   · «Бүгд» — сонголтыг бүхэлд нь цэвэрлэнэ (`onClear`).
 *   · Багийн chip — ДАРВАЛ НЭМНЭ, ДАХИН ДАРВАЛ ХАСНА (`onToggle`).  Сонгосон
 *     багаа хаах хамгийн хурдан зам нь өөрөө; «Бүгд» рүү заваарах хэрэггүй.
 *   · Идэвхтэй chip нь `chipSolid`, идэвхгүй нь `chip` — багийн өнгө нь
 *     аппын бусад хэсэг (чөлөө, хураангуй, гадуур ажил)-тэй ижил тонтой.
 * ===========================================================================*/
export default function TeamFilterChips({
  facets,
  selected,
  onToggle,
  onClear,
  allCount,
  className,
}: {
  /** Багийн сонголтууд — тоолуур нь ШҮҮЛТЭЭС ҮЛ ХАМААРАН бүх мөрөөс. */
  facets: readonly TeamFacet[];
  /** Сонгосон багийн кодууд.  Хоосон = бүгд. */
  selected: readonly string[];
  /** Нэг chip дээр дарсан — сонгогдсон байсан бол хасна, үгүй бол нэмнэ. */
  onToggle: (code: string) => void;
  /** «Бүгд» дээр дарсан — сонголтыг цэвэрлэнэ. */
  onClear: () => void;
  /** «Бүгд» chip дээрх тоо (facet-үүдийн нийлбэртэй тэнцүү байх ёстой). */
  allCount: number;
  className?: string;
}) {
  const { t } = useLanguage();

  // Ганц баг (эсвэл огт баггүй) үед шүүлт нь утгагүй — зай эзлэхгүй.
  if (facets.length < 2) return null;

  const none = selected.length === 0;

  return (
    <div className={cn('flex flex-wrap items-center gap-1.5 pt-2', className)}>
      <Users className="h-3.5 w-3.5 text-muted-foreground" />
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
        const active = selected.includes(f.code);
        const tone = teamTone(f.code === NO_TEAM ? null : f.code);
        return (
          <button
            key={f.code}
            type="button"
            title={f.name}
            aria-pressed={active}
            onClick={() => onToggle(f.code)}
            className={cn(
              'rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors tabular-nums',
              active ? tone.chipSolid : tone.chip,
              active
                ? 'ring-1 ring-offset-1 ring-offset-background ring-current'
                : 'opacity-80 hover:opacity-100',
            )}
          >
            {f.label} <span className="opacity-75">{f.count}</span>
          </button>
        );
      })}
    </div>
  );
}
