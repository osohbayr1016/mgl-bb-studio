import { useCallback, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { History, Info, Loader2, Lock } from 'lucide-react';
import { Button } from '@/ui/button';
import { toast } from '@/shared/components/Toast';
import { useLanguage } from '@/shared/i18n';
import { todayUB } from '@/shared/lib/time';
import { PRODUCTIVITY_KEY, saveGapThreshold, useTeamProductivity } from './api';
import { PERIOD_KINDS, type PeriodKind } from './types';
import { PeriodBar } from './PeriodBar';
import { SummaryTiles } from './SummaryTiles';
import { GapCard } from './GapCard';
import { MemberRanking } from './MemberRanking';
import { HistoryChart } from './HistoryChart';
import { AsrCard, ProjectsCard } from './ActivityCards';
import { WarningHistory } from './WarningHistory';
import { WarnLeadDialog } from './WarnLeadDialog';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DEFAULT_KIND: PeriodKind = 'week';

/**
 * Багийн профайл — «Бүтээмж» таб (2026-09-24, эзний хүсэлт).  Хугацаа нь URL-д
 * (`?period=day|week|month&date=`) тул ахлах руу очсон мэдэгдлийн холбоос яг
 * тэр хугацааг нээнэ.  Харах эрх: захирал (admin) бүх баг, багийн ахлах өөрийн
 * баг (ахлахгүй багт — тухайн багийн senior-ууд); бусад нь серверээс 403.
 */
export function ProductivityTab({ teamId }: { teamId: number }) {
  const { t } = useLanguage();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const today = todayUB();

  const kindRaw = searchParams.get('period');
  const kind: PeriodKind = (PERIOD_KINDS as readonly string[]).includes(kindRaw ?? '')
    ? (kindRaw as PeriodKind)
    : DEFAULT_KIND;
  const dateRaw = searchParams.get('date');
  const date = dateRaw && DATE_RE.test(dateRaw) && dateRaw <= today ? dateRaw : today;

  const setParams = useCallback(
    (next: { period?: PeriodKind; date?: string }) => {
      setSearchParams(
        (prev) => {
          const p = new URLSearchParams(prev);
          if (next.period) {
            if (next.period === DEFAULT_KIND) p.delete('period');
            else p.set('period', next.period);
          }
          if (next.date !== undefined) {
            if (next.date === today) p.delete('date');
            else p.set('date', next.date);
          }
          return p;
        },
        { replace: true },
      );
    },
    [setSearchParams, today],
  );

  const q = useTeamProductivity(teamId, kind, date);
  const [warnOpen, setWarnOpen] = useState(false);
  const refresh = useCallback(
    () => queryClient.invalidateQueries({ queryKey: [PRODUCTIVITY_KEY] }),
    [queryClient],
  );

  if (q.error && !q.data) {
    const forbidden = q.error.status === 403;
    return (
      <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border/60 py-14 text-center">
        {forbidden ? <Lock className="h-7 w-7 text-muted-foreground" /> : <Info className="h-7 w-7 text-danger" />}
        <p className="max-w-md text-sm text-muted-foreground">
          {forbidden ? t('teamProductivity.forbidden') : t('teamProductivity.loadFailed')}
        </p>
        {!forbidden && (
          <Button size="sm" variant="outline" onClick={() => void q.refetch()}>
            {t('teamProductivity.retry')}
          </Button>
        )}
      </div>
    );
  }

  const d = q.data;
  const belowCount = d ? d.members.filter((m) => m.below_line).length : 0;

  return (
    <div className="space-y-4" data-testid="tp-root">
      <PeriodBar
        kind={kind}
        period={d?.period ?? null}
        fetching={q.isFetching}
        onKind={(k) => setParams({ period: k })}
        onDate={(nd) => setParams({ date: nd })}
        onToday={() => setParams({ date: today })}
      />

      {!d ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      ) : d.summary.members === 0 ? (
        <div className="rounded-xl border border-dashed border-border/60 py-12 text-center text-sm text-muted-foreground">
          {d.summary.other_members > 0
            ? t('teamProductivity.noEligibleMembers', { n: d.summary.other_members })
            : t('teamProductivity.noMembers')}
        </div>
      ) : (
        <>
          <SummaryTiles s={d.summary} kind={d.period.kind} />

          <GapCard
            gap={d.gap}
            members={d.members}
            kind={d.period.kind}
            canWarn={d.viewer.can_warn}
            belowCount={belowCount}
            onWarn={() => setWarnOpen(true)}
            onSaveThreshold={async (v) => {
              try {
                const res = await saveGapThreshold(v);
                toast.success(t('teamProductivity.thresholdSaved', { v: `${res.threshold_pct}%` }));
                await refresh();
              } catch (err) {
                toast.error(t('common.saveFailed'), err instanceof Error ? err.message : undefined);
                throw err;
              }
            }}
          />

          <MemberRanking members={d.members} gap={d.gap} kind={d.period.kind} />

          <div className="grid gap-4 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] xl:items-start">
            <section id="sec-team-productivity-history" className="scroll-mt-24 rounded-xl border border-border/60 bg-card">
              <header className="flex items-center gap-2 border-b border-border/50 px-4 py-3">
                <History className="h-4 w-4 text-primary" />
                <h3 className="text-sm font-semibold">{t(`teamProductivity.historyTitle_${d.period.kind}`)}</h3>
              </header>
              <div className="p-3">
                <HistoryChart history={d.history} kind={d.period.kind} threshold={d.threshold_pct} />
              </div>
            </section>
            <div className="space-y-4">
              <ProjectsCard projects={d.projects} members={d.members} />
              <AsrCard asr={d.asr} />
            </div>
          </div>

          <WarningHistory warnings={d.warnings} />

          <details className="rounded-xl border border-border/60 bg-card px-4 py-3 text-xs text-muted-foreground">
            <summary className="cursor-pointer font-medium text-foreground">{t('teamProductivity.howTitle')}</summary>
            <ul className="mt-2 list-disc space-y-1 pl-4">
              <li>{t('teamProductivity.howAvg')}</li>
              <li>{t('teamProductivity.howLeave')}</li>
              <li>{t('teamProductivity.howDidWork')}</li>
              <li>{t('teamProductivity.howProjects')}</li>
              <li>{t('teamProductivity.howAsr')}</li>
              <li>{t('teamProductivity.howGap')}</li>
              <li>{t('teamProductivity.howMembers')}</li>
            </ul>
            {d.summary.other_members > 0 && (
              <p className="mt-2">{t('teamProductivity.otherMembers', { n: d.summary.other_members })}</p>
            )}
          </details>

          {warnOpen && (
            <WarnLeadDialog
              open
              onOpenChange={setWarnOpen}
              team={d.team}
              period={d.period}
              gap={d.gap}
              members={d.members}
              candidates={d.warning_candidates}
              onSent={refresh}
            />
          )}
        </>
      )}
    </div>
  );
}
