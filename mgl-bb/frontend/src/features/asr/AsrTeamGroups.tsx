import { useMemo, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { useLanguage, pickLocalized } from '@/shared/i18n';
import { formatDate } from '@/shared/lib/time';
import { teamChipClass } from '@/shared/lib/team-colors';
import { cn } from '@/shared/lib/utils';
import { Button } from '@/ui/button';
import { AsrList } from '@/features/projects/asr/AsrList';
import { ASR_STATUS_LABEL, ASR_STATUS_TONE } from '@/features/projects/asr/asrStatusStyle';
import type { AsrReport, AsrStatus, AsrTeamOption } from '@/features/projects/asr/types';
import { groupReportsByTeam } from './lib/groupReportsByTeam';

const STATUS_ORDER: AsrStatus[] = ['approved', 'submitted', 'rejected', 'draft'];

/**
 * Зохиогчийн хяналтын тайлангийн БАГААР нэгтгэл — админ / захирал нэг хуудсан дээр
 * баг бүрийн DASR-ыг (тоо, төлөв, сүүлийн огноо + тайлангийн жагсаалт) харна.
 *
 * Бүлэглэлт `lib/groupReportsByTeam.ts`-д; энд зөвхөн дүрслэл.  Тайлан нээх /
 * устгах нь дуудагчийн (`AsrProjectWorkspace`, `AsrTab`) үйлдэл — жагсаалтын
 * мөр яг хавтгай харагдацтай ижил `AsrList`.
 */
export function AsrTeamGroups({
  entries,
  teams,
  onlyTeam = null,
  onOpen,
  onDelete,
}: {
  entries: AsrReport[];
  teams: AsrTeamOption[];
  /** Баг сонгосон шүүлт идэвхтэй бол тэр багийн код — зөвхөн тэр бүлэг харагдана. */
  onlyTeam?: string | null;
  onOpen: (row: AsrReport) => void;
  onDelete?: (row: AsrReport) => void;
}) {
  const { t, lang } = useLanguage();
  const groups = useMemo(
    () => groupReportsByTeam(entries, teams, onlyTeam),
    [entries, teams, onlyTeam],
  );
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());

  const allCollapsed = groups.length > 0 && groups.every((g) => collapsed.has(g.key));
  const overlap = groups.reduce((sum, g) => sum + g.counts.total, 0) > entries.length;

  const toggle = (key: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  return (
    <div className="space-y-3" data-testid="asr-team-groups">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground tabular-nums">
          {t('asr.teamGroupsTotal', { n: entries.length, teams: groups.length })}
        </p>
        {groups.length > 1 && (
          <Button
            type="button"
            variant="ghost"
            size="xs"
            className="text-muted-foreground"
            onClick={() => setCollapsed(allCollapsed ? new Set() : new Set(groups.map((g) => g.key)))}
          >
            {allCollapsed ? t('asr.teamGroupsExpandAll') : t('asr.teamGroupsCollapseAll')}
          </Button>
        )}
      </div>

      {groups.map((g) => {
        const open = !collapsed.has(g.key);
        const bodyId = `asr-team-group-${g.key.replace(/[^\w-]/g, '_')}`;
        const name = g.team ? pickLocalized(lang, g.team.name_mn, g.team.name_en) : '';
        return (
          <section
            key={g.key}
            data-testid="asr-team-group"
            data-team={g.team?.code ?? 'none'}
            className="overflow-hidden rounded-lg border"
          >
            {/* Дэлгэх/хураах толгой.  `Button`-ийн суурь хэмжээг дарахдаа `pointer-coarse:h-auto`
                ба `has-[>svg]:px-3`-ийг ХАМТ бичнэ — tailwind-merge variant-тай классыг дардаггүй. */}
            <Button
              type="button"
              variant="ghost"
              aria-expanded={open}
              aria-controls={bodyId}
              onClick={() => toggle(g.key)}
              className="h-auto w-full flex-wrap justify-start gap-x-3 gap-y-2 rounded-none bg-muted/20 px-3 py-2.5 text-left font-normal whitespace-normal hover:bg-muted/40 pointer-coarse:h-auto has-[>svg]:px-3 motion-safe:active:scale-100"
            >
              <ChevronDown
                className={cn(
                  'h-4 w-4 shrink-0 text-muted-foreground transition-transform',
                  !open && '-rotate-90',
                )}
              />
              {g.team ? (
                <>
                  <span
                    className={cn(
                      'rounded-full border px-2 py-0.5 text-xs font-semibold',
                      teamChipClass(g.team.code),
                    )}
                  >
                    {g.team.code}
                  </span>
                  {name && name !== g.team.code && (
                    <span className="min-w-0 truncate text-xs text-muted-foreground">{name}</span>
                  )}
                </>
              ) : (
                <span className="text-sm font-medium text-muted-foreground">
                  {t('asr.teamGroupsNoTeam')}
                </span>
              )}

              <span className="ml-auto flex flex-wrap items-center justify-end gap-1.5">
                {STATUS_ORDER.filter((s) => g.counts[s] > 0).map((s) => (
                  <span
                    key={s}
                    className={cn(
                      'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-micro font-medium whitespace-nowrap',
                      ASR_STATUS_TONE[s],
                    )}
                  >
                    {t(ASR_STATUS_LABEL[s])}
                    <span className="tabular-nums">{g.counts[s]}</span>
                  </span>
                ))}
                <span className="shrink-0 pl-1 text-sm font-semibold tabular-nums">
                  {t('asr.teamGroupsCount', { n: g.counts.total })}
                </span>
              </span>

              {g.lastDate && (
                <span className="basis-full pl-7 text-micro text-muted-foreground tabular-nums">
                  {t('asr.visitsLast', { date: formatDate(g.lastDate) })}
                </span>
              )}
            </Button>

            {open && (
              <div id={bodyId} className="border-t">
                <AsrList entries={g.reports} onOpen={onOpen} onDelete={onDelete} empty={null} />
              </div>
            )}
          </section>
        );
      })}

      {overlap && (
        <p className="text-micro text-muted-foreground">{t('asr.teamGroupsOverlapNote')}</p>
      )}
    </div>
  );
}
