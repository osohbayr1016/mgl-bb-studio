/**
 * Тоймын дунд хэсгүүд: гол тоонууд, «таны анхаарал», мэргэжлийн хэсгийн явц.
 */
import { ArrowRight, PenLine } from 'lucide-react';

import { Button } from '@/ui/button';
import { useLanguage } from '@/shared/i18n';
import { formatDate } from '@/shared/lib/time';
import { teamHex } from '@/shared/lib/team-colors';
import type { CorrespondenceEntry } from '@/shared/types';

import type { ClientDashboardTab, DisciplineRow, OverviewResponse } from '../client-dashboard.types';
import { Figure, ProgressLine, SubHeader } from '../components/primitives';
import { pctInt } from '../lib/clientFormat';
import { disciplineName, countLabel } from '../lib/labels';

/* ------------------------------------------------------------------ */
/*  Гол тоонууд                                                        */
/* ------------------------------------------------------------------ */

export function KeyFigures({ overview }: { overview: OverviewResponse }) {
  const { t } = useLanguage();
  const c = overview.counts;
  const items: { label: string; value: number | string; unit?: string }[] = [
    { label: t('clientRoom.figures.blocks'), value: c.blocks },
    { label: t('clientRoom.figures.drawings'), value: c.drawings },
    { label: t('clientRoom.figures.tasks'), value: c.tasks },
    { label: t('clientRoom.figures.disciplines'), value: c.active_disciplines },
    { label: t('clientRoom.figures.people'), value: c.team_members },
    {
      label: t('clientRoom.figures.duration'),
      value: typeof overview.duration_days === 'number' ? overview.duration_days : '—',
      unit: typeof overview.duration_days === 'number' ? t('clientRoom.figures.days') : undefined,
    },
  ];

  return (
    <section aria-label={t('clientRoom.figures.title')}>
      <ul className="grid grid-cols-2 gap-px border-y border-foreground/10 bg-foreground/10 sm:grid-cols-3 lg:grid-cols-6">
        {items.map((it) => (
          <li key={it.label} className="bg-background px-4 py-6 sm:px-6 max-sm:[&:nth-child(odd)]:pl-0 sm:max-lg:[&:nth-child(3n+1)]:pl-0 lg:first:pl-0">
            <Figure label={it.label} value={it.value} unit={it.unit} />
          </li>
        ))}
      </ul>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/*  Таны анхаарал шаардлагатай — гарын үсэг хүлээж буй RFI/CR          */
/* ------------------------------------------------------------------ */

export function AttentionPanel({
  signatures,
  onNavigate,
}: {
  signatures: CorrespondenceEntry[];
  onNavigate: (tab: ClientDashboardTab) => void;
}) {
  const { t } = useLanguage();
  if (signatures.length === 0) return null;

  return (
    <section
      aria-labelledby="client-attention-title"
      className="border border-brand-copper/40"
      data-testid="client-attention"
    >
      <div className="flex items-center gap-3 border-b border-brand-copper/30 bg-brand-copper/[0.06] px-5 py-3 md:px-6">
        <span aria-hidden className="h-2 w-2 rounded-full bg-brand-copper motion-safe:animate-pulse" />
        <h2
          id="client-attention-title"
          className="font-mono text-label uppercase tracking-[0.16em] text-foreground"
        >
          {t('clientRoom.attention.title')}
        </h2>
        <span className="ml-auto font-mono text-label tabular-nums text-muted-foreground">
          {signatures.length}
        </span>
      </div>
      <ul className="divide-y divide-foreground/10">
        {signatures.map((e) => (
          <li
            key={e.id}
            className="grid gap-4 px-5 py-5 md:grid-cols-12 md:items-center md:gap-6 md:px-6"
          >
            <div className="md:col-span-2">
              <span className="font-mono text-micro uppercase tracking-[0.08em] text-foreground">
                {e.ref_no || (e.doc_type ?? '').toUpperCase() || '—'}
              </span>
            </div>
            <div className="min-w-0 md:col-span-6 lg:col-span-7">
              <p className="text-base leading-snug text-foreground">{e.subject}</p>
              <p className="mt-1 text-micro text-muted-foreground">
                {t('clientRoom.attention.signature')}
                {e.sign_requested_at
                  ? ` · ${t('clientRoom.attention.requestedOn', { date: formatDate(e.sign_requested_at) })}`
                  : ''}
              </p>
            </div>
            <div className="md:col-span-4 md:text-right lg:col-span-3">
              <Button
                size="sm"
                onClick={() => onNavigate('mail')}
                className="rounded-none bg-foreground text-background hover:bg-foreground/85"
              >
                <PenLine className="h-4 w-4" strokeWidth={1.75} />
                {t('clientRoom.attention.signCta')}
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/*  Мэргэжлийн хэсгүүдийн явц                                          */
/* ------------------------------------------------------------------ */

export function DisciplineLedger({
  disciplines,
  onMore,
}: {
  disciplines: DisciplineRow[];
  onMore: () => void;
}) {
  const { t } = useLanguage();
  const rows = disciplines.filter((d) => d.active);

  return (
    <section aria-labelledby="client-disciplines-title">
      <SubHeader
        title={<span id="client-disciplines-title">{t('clientRoom.disciplines.title')}</span>}
        meta={rows.length > 0 ? String(rows.length).padStart(2, '0') : undefined}
        action={
          <Button
            variant="link"
            size="sm"
            onClick={onMore}
            className="h-auto pointer-coarse:h-auto gap-1.5 px-0 has-[>svg]:px-0 text-body text-foreground"
          >
            {t('clientRoom.disciplines.more')}
            <ArrowRight className="h-3.5 w-3.5" strokeWidth={1.5} />
          </Button>
        }
      />
      {rows.length === 0 ? (
        <p className="py-10 text-sm text-muted-foreground">{t('clientRoom.disciplines.empty')}</p>
      ) : (
        <ul className="divide-y divide-foreground/10">
          {rows.map((d) => (
            <li
              key={d.code}
              className="grid grid-cols-[4.25rem_minmax(0,1fr)_4.5rem] items-center gap-x-4 gap-y-3 py-4 md:grid-cols-[4.25rem_minmax(0,1fr)_minmax(0,1.15fr)_4.5rem]"
            >
              <span className="flex items-center gap-2 font-mono text-micro text-foreground">
                <span
                  aria-hidden
                  className="h-2 w-2 shrink-0"
                  style={{ backgroundColor: teamHex(d.code) }}
                />
                {d.code}
              </span>
              <span className="min-w-0">
                <span className="block truncate text-sm text-foreground">
                  {disciplineName(t, d.code, d.label_mn)}
                </span>
                <span className="mt-0.5 block font-mono text-micro text-muted-foreground">
                  {countLabel(t, 'clientRoom.disciplines.drawings', d.drawing_count)}
                </span>
              </span>
              <ProgressLine
                value={d.progress}
                className="col-span-3 row-start-2 md:col-span-1 md:row-start-auto"
              />
              <span className="text-right font-display text-2xl font-light tabular-nums tracking-[-0.03em] text-foreground">
                {pctInt(d.progress)}
                <span className="text-sm text-muted-foreground">%</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
