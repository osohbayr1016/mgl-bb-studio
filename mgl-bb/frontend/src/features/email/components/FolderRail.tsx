import { Link } from 'react-router-dom';
import {
  Pencil,
  Inbox,
  ArrowDownLeft,
  ArrowUpRight,
  Mail,
  RefreshCw,
  Loader2,
  Settings2,
} from 'lucide-react';
import { Button } from '@/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/ui/select';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/i18n';
import type { EmailAccount } from '@/features/email/types/email';

type TriagedFilter = '0' | 'all';
type DirectionFilter = 'all' | 'in' | 'out';

/** Left rail — Compose + Gmail-style folders + secondary filters. */
export function FolderRail({
  triaged,
  direction,
  accountId,
  addr,
  cat,
  accounts,
  aliases,
  triageCount,
  syncing,
  onCompose,
  onSync,
  onFolder,
  onAccount,
  onAddr,
  onCat,
}: {
  triaged: TriagedFilter;
  direction: DirectionFilter;
  accountId: string;
  addr: string;
  cat: 'all' | 'convo' | 'promo';
  accounts: EmailAccount[];
  aliases: string[];
  triageCount: number;
  syncing: boolean;
  onCompose: () => void;
  onSync: () => void;
  onFolder: (triaged: TriagedFilter, direction: DirectionFilter) => void;
  onAccount: (v: string) => void;
  onAddr: (v: string) => void;
  onCat: (v: 'all' | 'convo' | 'promo') => void;
}) {
  const { t } = useLanguage();

  const folders = [
    {
      key: 'untriaged',
      label: t('mailInbox.untriaged'),
      icon: Inbox,
      triaged: '0' as const,
      direction: 'all' as const,
      badge: triageCount,
    },
    {
      key: 'inbox',
      label: t('mailInbox.inbox'),
      icon: ArrowDownLeft,
      triaged: 'all' as const,
      direction: 'in' as const,
    },
    {
      key: 'sent',
      label: t('mailInbox.sent'),
      icon: ArrowUpRight,
      triaged: 'all' as const,
      direction: 'out' as const,
    },
    {
      key: 'all',
      label: t('mailInbox.allMail'),
      icon: Mail,
      triaged: 'all' as const,
      direction: 'all' as const,
    },
  ];

  return (
    <div className="flex h-full flex-col gap-3 p-3">
      <Button className="w-full justify-start gap-2" onClick={onCompose}>
        <Pencil className="h-4 w-4" /> {t('mailInbox.compose')}
      </Button>

      <nav className="space-y-0.5">
        {folders.map((f) => {
          const active = f.triaged === triaged && f.direction === direction;
          const Icon = f.icon;
          return (
            <button
              key={f.key}
              type="button"
              onClick={() => onFolder(f.triaged, f.direction)}
              className={cn(
                'flex w-full items-center gap-3 rounded-full px-3 py-2 text-sm font-medium transition-colors',
                active
                  ? 'bg-primary/15 text-primary'
                  : 'text-foreground/80 hover:bg-muted/60',
              )}
            >
              <Icon className="h-4 w-4 shrink-0" />
              <span className="flex-1 truncate text-left">{f.label}</span>
              {f.badge !== undefined && f.badge > 0 && (
                <span className="shrink-0 rounded-full bg-primary/20 px-2 text-micro font-semibold tabular-nums text-primary">
                  {f.badge}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      <div className="space-y-2 border-t border-border/60 pt-3">
        <label className="block text-label font-medium text-muted-foreground">
          {t('mailInbox.filters')}
        </label>
        <Select value={accountId} onValueChange={onAccount}>
          <SelectTrigger className="h-8 w-full text-xs">
            <SelectValue placeholder={t('mailTriagePage.allMailboxes')} />
          </SelectTrigger>
          <SelectContent position="popper">
            <SelectItem value="all">{t('mailTriagePage.allMailboxes')}</SelectItem>
            {accounts.map((a) => (
              <SelectItem key={a.id} value={String(a.id)}>
                {a.address}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={addr} onValueChange={onAddr} disabled={aliases.length === 0}>
          <SelectTrigger className="h-8 w-full text-xs">
            <SelectValue placeholder={t('mailTriagePage.allAliases')} />
          </SelectTrigger>
          <SelectContent position="popper">
            <SelectItem value="all">{t('mailTriagePage.allAliases')}</SelectItem>
            {aliases.map((a) => (
              <SelectItem key={a} value={a}>
                {a}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={cat} onValueChange={(v) => onCat(v as 'all' | 'convo' | 'promo')}>
          <SelectTrigger className="h-8 w-full text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent position="popper">
            <SelectItem value="all">{t('mailTriagePage.allCategories')}</SelectItem>
            <SelectItem value="convo">💬 {t('mailTriagePage.conversation')}</SelectItem>
            <SelectItem value="promo">📢 {t('mailTriagePage.promo')}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="mt-auto space-y-1.5 border-t border-border/60 pt-3">
        <Button variant="outline" size="sm" className="w-full justify-start gap-2" onClick={onSync} disabled={syncing}>
          {syncing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          {t('mailTriagePage.sync')}
        </Button>
        <Button variant="ghost" size="sm" className="w-full justify-start gap-2" asChild>
          <Link to="/app/admin/email">
            <Settings2 className="h-4 w-4" /> {t('mailTriagePage.mailboxes')}
          </Link>
        </Button>
      </div>
    </div>
  );
}
