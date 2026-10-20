/**
 * Хэсгийн навигаци — дугаарласан текстэн таб, идэвхтэйн доор бэхэн зураас.
 *
 * Radix `Tabs.List/Trigger` тул сум товчоор шилжих, `aria-selected`,
 * `aria-controls` бүгд үнэгүй.  Утсан дээр хөндлөн гүйлгэгдэж, идэвхтэй таб
 * үргэлж харагдах хэсэгт гүйлгэгдэнэ.
 */
import { useEffect, useRef } from 'react';
import { m } from 'motion/react';
import { Tabs as TabsPrimitive } from 'radix-ui';

import { useLanguage, type TranslationKey } from '@/shared/i18n';
import { cn } from '@/shared/lib/utils';

import { CLIENT_TABS, type ClientDashboardTab } from '../client-dashboard.types';
import { LiveIndicator } from '../components/primitives';
import { CLIENT_CONTAINER } from '../lib/layout';
import { countLabel } from '../lib/labels';

const NAV_LABEL: Record<ClientDashboardTab, TranslationKey> = {
  overview: 'clientRoom.nav.overview',
  progress: 'clientRoom.nav.progress',
  materials: 'clientRoom.nav.materials',
  documents: 'clientRoom.nav.documents',
  submit: 'clientRoom.nav.submit',
  mail: 'clientRoom.nav.mail',
  info: 'clientRoom.nav.info',
  model: 'clientRoom.nav.model',
};

export function ClientSectionNav({
  tab,
  live,
  badges,
}: {
  tab: ClientDashboardTab;
  live: boolean;
  /** Хэсэг бүрийн «анхаарах» тоо (жнь гарын үсэг хүлээж буй захидал). */
  badges?: Partial<Record<ClientDashboardTab, number>>;
}) {
  const { t } = useLanguage();
  const listRef = useRef<HTMLDivElement | null>(null);

  // Утсан дээр идэвхтэй табыг харагдах хэсэгт авчирна (хуудас босоо
  // чиглэлд хөдлөхгүй — `block: 'nearest'`).
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>('[data-state="active"]');
    el?.scrollIntoView({ inline: 'center', block: 'nearest' });
  }, [tab]);

  return (
    <div className="sticky top-16 z-30 border-b border-foreground/10 bg-background/90 backdrop-blur-md">
      <div className={cn(CLIENT_CONTAINER, 'relative flex items-center gap-6')}>
        <TabsPrimitive.List
          ref={listRef}
          aria-label={t('clientRoom.sectionsLabel')}
          className="-mb-px flex min-w-0 flex-1 items-stretch gap-6 overflow-x-auto [scrollbar-width:none] lg:gap-9 [&::-webkit-scrollbar]:hidden"
        >
          {CLIENT_TABS.map((id, i) => {
            const count = badges?.[id] ?? 0;
            return (
              <TabsPrimitive.Trigger
                key={id}
                value={id}
                data-testid={`client-tab-${id}`}
                className="group relative flex h-12 shrink-0 items-center gap-2 whitespace-nowrap text-sm text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:text-foreground focus-visible:underline focus-visible:underline-offset-8 data-[state=active]:text-foreground"
              >
                <span className="font-mono text-label tabular-nums text-muted-subtle transition-colors group-data-[state=active]:text-brand-copper">
                  {String(i + 1).padStart(2, '0')}
                </span>
                <span>{t(NAV_LABEL[id])}</span>
                {count > 0 ? (
                  <span className="inline-flex h-[1.125rem] min-w-[1.125rem] items-center justify-center rounded-full bg-brand-copper px-1 font-mono text-label leading-none text-background">
                    <span aria-hidden>{count}</span>
                    {/* `aria-label` энгийн span дээр уншигддаггүй — дэлгэц уншигчид бичвэрээр. */}
                    <span className="sr-only">{countLabel(t, 'clientRoom.attention.badge', count)}</span>
                  </span>
                ) : null}
                {tab === id ? (
                  <m.span
                    layoutId="client-section-underline"
                    className="absolute inset-x-0 bottom-0 h-0.5 bg-foreground"
                    transition={{ type: 'spring', stiffness: 520, damping: 42 }}
                  />
                ) : null}
              </TabsPrimitive.Trigger>
            );
          })}
        </TabsPrimitive.List>
        <LiveIndicator live={live} className="hidden shrink-0 md:inline-flex" />
        <span
          aria-hidden
          className="pointer-events-none absolute inset-y-0 right-0 w-10 bg-gradient-to-l from-background to-transparent md:hidden"
        />
      </div>
    </div>
  );
}
