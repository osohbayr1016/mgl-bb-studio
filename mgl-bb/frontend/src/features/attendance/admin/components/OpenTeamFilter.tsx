import { Users } from 'lucide-react';
import { useLanguage } from '@/shared/i18n';
import { cn } from '@/shared/lib/utils';
import { teamTone } from '@/shared/lib/team-colors';
import { NO_TEAM } from '@/features/attendance/admin/lib/openSessionRows';
import type { OpenSessionsState } from '@/features/attendance/admin/hooks/useOpenSessions';

/* =============================================================================
 *  Багийн шүүлт — «Хаагдаагүй» табын гол хэрэглээ.
 * -----------------------------------------------------------------------------
 *  Админ 500 мөрийг нэг дор харах нь хэрэггүй: тэр эдгээрийг БАГААР нь
 *  салгаж, тухайн багийн сениорт «эдгээр нь таны багийнхны хаагдаагүй цаг»
 *  гэж өгөх баримт болгодог.  Тиймээс шүүлт нь дэлгэц, ХЭВЛЭХ, EXCEL
 *  гуравт нь адилхан нөлөөлнө (`filteredOpenSessions` дундаа).
 *
 *  Идэвхтэй chip нь `chipSolid`, идэвхгүй нь `chip` — багийн өнгө нь
 *  аппын бусад хэсэг (чөлөө, хураангуй, гадуур ажил)-тэй ижил тонтой.
 * ===========================================================================*/
export default function OpenTeamFilter({ open }: { open: OpenSessionsState }) {
  const { t } = useLanguage();
  const { openSessions, openTeamFacets, openTeam, setOpenTeam } = open;

  // Ганц баг (эсвэл огт баггүй) үед шүүлт нь утгагүй — зай эзлэхгүй.
  if (openTeamFacets.length < 2) return null;

  return (
    <div className="flex flex-wrap items-center gap-1.5 pt-2">
      <Users className="h-3.5 w-3.5 text-muted-foreground" />
      <button
        type="button"
        aria-pressed={!openTeam}
        onClick={() => setOpenTeam('')}
        className={cn(
          'rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors tabular-nums',
          !openTeam
            ? 'bg-primary text-primary-foreground border-primary'
            : 'border-border text-muted-foreground hover:bg-muted',
        )}
      >
        {t('attendanceAdminPage.openTeamAll')}{' '}
        <span className="opacity-70">{openSessions.length}</span>
      </button>
      {openTeamFacets.map((f) => {
        const active = openTeam === f.code;
        const tone = teamTone(f.code === NO_TEAM ? null : f.code);
        return (
          <button
            key={f.code}
            type="button"
            title={f.name}
            aria-pressed={active}
            // Дахин дарвал шүүлт тайлагдана — сонгосон багаа хаах хамгийн
            // хурдан зам (бүгд рүү очих товч руу заваарах шаардлагагүй).
            onClick={() => setOpenTeam(active ? '' : f.code)}
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
