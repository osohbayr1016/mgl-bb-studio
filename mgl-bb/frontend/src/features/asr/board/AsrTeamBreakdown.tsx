import { UsersRound } from 'lucide-react';
import { pickLocalized, useLanguage } from '@/shared/i18n';
import { teamChipClass, teamHex } from '@/shared/lib/team-colors';
import { cn } from '@/shared/lib/utils';
import { Button } from '@/ui/button';
import type { AsrTeamOption } from '@/features/projects/asr/types';
import type { AsrBoardTeam } from '../lib/asrBoard';

/**
 * Сонгосон хугацааны талбайн очилт БАГААР — багийн өнгөтэй хэвтээ зурвас
 * (урт = очилтын тоо), хэдэн хүн явсан, хамгийн сүүлд хэзээ.  Баг дээр
 * дарахад доорх жагсаалт тэр багаар шүүгдэнэ.
 */
export function AsrTeamBreakdown({
  rows,
  teams,
  totalSite,
  activeCode,
  onSelect,
  className,
}: {
  rows: AsrBoardTeam[];
  teams: AsrTeamOption[];
  /** Хугацааны нийт талбайн очилт — баг хоорондын давхцлыг тайлбарлахад. */
  totalSite: number;
  activeCode: string | null;
  onSelect: (code: string | null) => void;
  className?: string;
}) {
  const { t, lang } = useLanguage();
  const max = rows.reduce((m, r) => Math.max(m, r.site), 0);
  const overlap = rows.reduce((n, r) => n + r.site, 0) > totalSite;

  return (
    <section
      id="sec-asr-project-teams"
      className={cn('scroll-mt-24 rounded-xl border border-border bg-card', className)}
      data-testid="asr-team-breakdown"
    >
      <div className="px-4 pb-2 pt-4 sm:px-5">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <UsersRound className="h-4 w-4 text-muted-foreground" aria-hidden />
          {t('asr.viewByTeam')}
        </h2>
        <p className="mt-0.5 text-xs text-muted-foreground">{t('asr.board.teamsHint')}</p>
      </div>

      {rows.length === 0 ? (
        <p className="px-4 pb-5 pt-2 text-sm text-muted-foreground sm:px-5">{t('asr.board.teamsEmpty')}</p>
      ) : (
        <ul className="space-y-1 px-2 pb-3 sm:px-3">
          {rows.map((row) => {
            const team = teams.find((o) => o.code === row.code);
            const name = team ? pickLocalized(lang, team.name_mn, team.name_en) : '';
            const active = activeCode === row.code;
            const width = max > 0 ? Math.max(4, (row.site / max) * 100) : 0;
            return (
              <li key={row.code}>
                <Button
                  type="button"
                  variant="ghost"
                  aria-pressed={active}
                  onClick={() => onSelect(active ? null : row.code)}
                  className={cn(
                    'flex w-full flex-col items-stretch justify-start gap-0 rounded-lg px-2 py-2 text-left hover:text-foreground',
                    'h-auto whitespace-normal font-normal pointer-coarse:h-auto motion-safe:active:scale-100',
                    active && 'bg-primary/10 ring-1 ring-primary/40',
                  )}
                  data-testid="asr-team-row"
                  data-team={row.code}
                >
                  <div className="flex items-center gap-2">
                    <span
                      className={cn(
                        'shrink-0 rounded-full border px-2 py-0.5 text-xs font-semibold',
                        teamChipClass(row.code),
                      )}
                    >
                      {row.code}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                      {name && name !== row.code ? name : ''}
                    </span>
                    <span className="shrink-0 text-sm font-semibold tabular-nums">
                      {t('asr.board.visitsShort', { n: row.site })}
                    </span>
                  </div>
                  <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-muted" aria-hidden>
                    <div
                      className="h-full rounded-full"
                      style={{ width: `${width}%`, backgroundColor: teamHex(row.code) }}
                    />
                  </div>
                  <div className="mt-1 flex justify-between gap-2 text-micro text-muted-foreground tabular-nums">
                    <span>{t('asr.board.teamPeople', { n: row.people })}</span>
                    {row.last && <span>{t('asr.visitsLast', { date: row.last })}</span>}
                  </div>
                </Button>
              </li>
            );
          })}
        </ul>
      )}

      {overlap && (
        <p className="px-4 pb-4 text-micro text-muted-foreground sm:px-5">{t('asr.board.teamsOverlap')}</p>
      )}
    </section>
  );
}
