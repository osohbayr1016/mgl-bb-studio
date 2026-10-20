/**
 * «Сүүлийн шинэчлэлт» — `client_events`-ийн урсгал (шинэ нь дээр).
 *
 * Өгөгдөл нь `useClientRealtime`-ийнх: хуудас нээхэд сүүлийн 50-ийг REST-ээр
 * татаж, дараа нь WebSocket-оор шинэ мөр нэмэгдэнэ — энд тусдаа хүсэлт
 * БАЙХГҮЙ.  Мөр дээр дарахад холбогдох хэсэг рүү шилжинэ.
 */
import { useState } from 'react';
import { ArrowUpRight } from 'lucide-react';

import { Button } from '@/ui/button';
import { useLanguage } from '@/shared/i18n';
import { formatDateTime, todayUB } from '@/shared/lib/time';
import { cn } from '@/shared/lib/utils';

import type { ClientDashboardTab } from '../client-dashboard.types';
import type { ClientEvent } from '../portalApi';
import { LiveIndicator, SubHeader } from '../components/primitives';
import { EVENT_KIND_LABEL, EVENT_TARGET_TAB } from '../lib/labels';

const COLLAPSED = 6;

export function ActivityJournal({
  events,
  live,
  onNavigate,
}: {
  events: ClientEvent[];
  live: boolean;
  onNavigate: (tab: ClientDashboardTab) => void;
}) {
  const { t } = useLanguage();
  const [expanded, setExpanded] = useState(false);
  const newestFirst = [...events].reverse();
  const shown = expanded ? newestFirst : newestFirst.slice(0, COLLAPSED);
  const today = todayUB();

  return (
    <section aria-labelledby="client-journal-title" data-testid="client-journal">
      <SubHeader
        title={<span id="client-journal-title">{t('clientRoom.journal.title')}</span>}
        action={<LiveIndicator live={live} />}
      />
      {newestFirst.length === 0 ? (
        <p className="py-10 text-sm leading-relaxed text-muted-foreground">
          {t('clientRoom.journal.empty')}
        </p>
      ) : (
        <ol aria-live="polite" className="divide-y divide-foreground/10">
          {shown.map((ev) => {
            const stamp = formatDateTime(ev.created_at);
            const [day = '', time = ''] = stamp.split(' ');
            const target = EVENT_TARGET_TAB[ev.kind];
            const kindKey = EVENT_KIND_LABEL[ev.kind];
            return (
              <li key={ev.id}>
                <Button
                  variant="ghost"
                  disabled={!target}
                  onClick={() => target && onNavigate(target)}
                  className="group grid h-auto pointer-coarse:h-auto w-full grid-cols-[5.25rem_minmax(0,1fr)_1rem] items-start gap-4 whitespace-normal rounded-none px-0 py-4 has-[>svg]:px-0 text-left font-normal hover:bg-transparent disabled:opacity-100"
                >
                  <span className="font-mono text-micro tabular-nums leading-5 text-muted-foreground">
                    <span className={cn('block', day === today && 'text-brand-copper')}>
                      {day === today ? t('clientRoom.schedule.today') : day}
                    </span>
                    <span className="block">{time}</span>
                  </span>
                  <span className="min-w-0">
                    <span className="block font-mono text-label uppercase tracking-[0.14em] text-muted-foreground">
                      {kindKey ? t(kindKey) : t('clientRoom.event.other')}
                    </span>
                    <span className="mt-1.5 block text-sm leading-snug text-foreground underline-offset-4 group-hover:underline">
                      {ev.title_mn}
                    </span>
                  </span>
                  {target ? (
                    <ArrowUpRight
                      className="mt-5 h-4 w-4 text-muted-subtle transition-colors group-hover:text-foreground"
                      strokeWidth={1.5}
                    />
                  ) : (
                    <span />
                  )}
                </Button>
              </li>
            );
          })}
        </ol>
      )}
      {newestFirst.length > COLLAPSED ? (
        <Button
          variant="link"
          size="sm"
          onClick={() => setExpanded((v) => !v)}
          className="mt-2 h-auto pointer-coarse:h-auto px-0 has-[>svg]:px-0 text-body text-foreground"
          aria-expanded={expanded}
        >
          {expanded
            ? t('clientRoom.journal.showLess')
            : t('clientRoom.journal.showAll', { count: newestFirst.length })}
        </Button>
      ) : null}
    </section>
  );
}
