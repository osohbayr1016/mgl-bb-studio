import { ArrowUpRight } from 'lucide-react';

import { brand } from '@/shared/config/brand';
import { useLanguage } from '@/shared/i18n';
import { todayUB } from '@/shared/lib/time';
import { cn } from '@/shared/lib/utils';

import { Eyebrow } from '../components/primitives';
import { CLIENT_CONTAINER } from '../lib/layout';

/** Порталын хөл — холбоо барих мэдээлэл (брэндийн тохиргооноос). */
export function ClientFooter() {
  const { t, lang } = useLanguage();
  const b = brand();
  const year = todayUB().slice(0, 4);
  const site = b.websiteUrl.replace(/^https?:\/\//, '').replace(/\/$/, '');

  return (
    <footer className="mt-24 border-t border-foreground/15">
      <div className={cn(CLIENT_CONTAINER, 'grid gap-10 py-12 md:grid-cols-12 md:gap-8')}>
        <div className="md:col-span-5">
          <p className="font-display text-2xl font-light tracking-[-0.02em] text-foreground">{b.name}</p>
          <p className="mt-2 max-w-sm text-body text-muted-foreground">
            {lang === 'en' ? b.taglineEn : b.taglineMn}
          </p>
        </div>
        <div className="flex flex-col gap-3 md:col-span-4">
          <Eyebrow>{t('clientRoom.footerContact')}</Eyebrow>
          {b.contactEmail ? (
            <a
              href={`mailto:${b.contactEmail}`}
              className="w-fit text-sm text-foreground underline-offset-4 hover:underline"
            >
              {b.contactEmail}
            </a>
          ) : null}
          {b.websiteUrl ? (
            <a
              href={b.websiteUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex w-fit items-center gap-1 text-sm text-foreground underline-offset-4 hover:underline"
            >
              {site}
              <ArrowUpRight className="h-3.5 w-3.5" strokeWidth={1.5} />
            </a>
          ) : null}
        </div>
        <div className="flex flex-col gap-2 md:col-span-3 md:items-end md:text-right">
          <p className="font-mono text-micro tabular-nums text-muted-foreground">
            © {year} {b.legalNameEn}
          </p>
          <p className="max-w-xs text-micro text-muted-foreground">{t('clientRoom.footerNote')}</p>
        </div>
      </div>
    </footer>
  );
}
