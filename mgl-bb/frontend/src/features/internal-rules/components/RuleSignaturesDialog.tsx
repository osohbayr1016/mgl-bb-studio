import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, Clock, Copy, Loader2, Search, Users } from 'lucide-react';

import { useLanguage, pickLocalized } from '@/shared/i18n';
import { roleLabelKey } from '@/shared/lib/roles';
import { formatDateTime } from '@/shared/lib/time';
import { toast } from '@/shared/components/Toast';
import { cn } from '@/shared/lib/utils';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/ui/select';
import { Badge } from '@/ui/badge';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import { Progress } from '@/ui/progress';

import { fetchRuleSignatures, ruleKeys } from '../api';
import type { AdminRule, RosterRow } from '../api';
import { filterRoster, pendingNames } from '../lib/rosterFilter';
import type { RosterFilter } from '../lib/rosterFilter';
import { SignatureImage } from './SignatureImage';

/**
 * Админ — «хэн зурсан / хэзээ / хэн зураагүй» (одоогийн эсвэл сонгосон хувилбар).
 * Зөвхөн admin (эзний шийдвэр 2026-09-21); сервер `requireAdmin()`, энэ dialog
 * зөвхөн admin хуудаснаас нээгдэнэ.
 *
 * Зураагүй мөрөнд «өмнөх хувилбарт зурсан» / «огт зураагүй» ялгаатай —
 * «шинэ бичвэрийг л уншаагүй» хүн ба «журамд огт хүрээгүй» хүн хоёр өөр
 * хөөцөлдөлт.  «Нэр хуулах» нь зураагүй хүмүүсийн жагсаалтыг чат/имэйлд
 * наах зориулалттай.  Идэвхгүй болсон ч зурсан хүмүүс `extra` хэсэгт —
 * HR-ийн түүх алдагдахгүй.
 */
export function RuleSignaturesDialog({
  rule,
  open,
  onOpenChange,
}: {
  rule: AdminRule | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t, lang } = useLanguage();
  const [versionId, setVersionId] = useState<number | null>(null);
  const [filter, setFilter] = useState<RosterFilter>('all');
  const [query, setQuery] = useState('');
  const ruleId = rule?.id ?? 0;

  const q = useQuery({
    queryKey: ruleKeys.signatures(ruleId, versionId),
    queryFn: () => fetchRuleSignatures(ruleId, versionId),
    enabled: open && ruleId > 0,
  });

  const data = q.data;
  const rows = useMemo(() => data?.rows ?? [], [data]);
  const summary = data?.summary ?? { signed: 0, pending: 0, total: 0 };

  const visible = useMemo(() => filterRoster(rows, filter, query), [rows, filter, query]);

  const roleLabel = (role: string | null) => (role ? t(roleLabelKey(role)) : '');

  const copyPending = async () => {
    const names = pendingNames(rows);
    if (names.length === 0) return;
    try {
      await navigator.clipboard.writeText(names.join('\n'));
      toast.success(t('rules.copyPendingDone', { count: names.length }));
    } catch {
      toast.error(t('common.saveFailed'));
    }
  };

  const reset = () => {
    setVersionId(null);
    setFilter('all');
    setQuery('');
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) reset();
        onOpenChange(v);
      }}
    >
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Users className="h-5 w-5 text-primary" aria-hidden />
            {t('rules.signaturesTitle')}
            {rule && <span className="text-muted-foreground">— {pickLocalized(lang, rule.title_mn, rule.title_en)}</span>}
          </DialogTitle>
        </DialogHeader>

        {q.isLoading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-hidden />
          </div>
        ) : !data || !data.version ? (
          <p className="py-6 text-center text-sm text-muted-foreground">{t('rules.noVersionYet')}</p>
        ) : (
          <div className="space-y-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="space-y-1">
                <div className="text-sm">
                  {t('rules.signedProgress', { signed: summary.signed, total: summary.total })}
                </div>
                <Progress value={summary.total ? (summary.signed / summary.total) * 100 : 0} className="h-2 w-56" />
                <div className={cn('text-micro', summary.pending > 0 ? 'text-warning' : 'text-success')}>
                  {summary.pending > 0
                    ? t('rules.summaryPending', { count: summary.pending })
                    : t('rules.summaryAllSigned')}
                </div>
              </div>
              <div className="space-y-1">
                <div className="text-micro text-muted-foreground">
                  {t('rules.versionMeta', { version: data.version.version, date: formatDateTime(data.version.published_at) })}
                </div>
                {data.versions.length > 1 && (
                  <Select value={String(data.version.id)} onValueChange={(v) => setVersionId(Number(v))}>
                    <SelectTrigger className="w-56" aria-label={t('rules.versionLabel')}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {data.versions.map((v) => (
                        <SelectItem key={v.id} value={String(v.id)}>
                          v{v.version} · {formatDateTime(v.published_at)} · {v.signed_count}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div role="group" aria-label={t('rules.filterAll')} className="flex gap-1">
                <FilterChip active={filter === 'all'} onClick={() => setFilter('all')}>
                  {t('rules.filterAll')} · {summary.total}
                </FilterChip>
                <FilterChip active={filter === 'signed'} onClick={() => setFilter('signed')}>
                  {t('rules.filterSigned')} · {summary.signed}
                </FilterChip>
                <FilterChip active={filter === 'pending'} onClick={() => setFilter('pending')}>
                  {t('rules.filterPending')} · {summary.pending}
                </FilterChip>
              </div>
              <div className="relative min-w-48 flex-1">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
                <Input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={t('rules.searchRoster')}
                  aria-label={t('rules.searchRoster')}
                  className="h-8 pl-8 text-sm"
                />
              </div>
              {summary.pending > 0 && (
                <Button variant="outline" size="sm" onClick={() => void copyPending()}>
                  <Copy className="mr-1.5 h-3.5 w-3.5" aria-hidden />
                  {t('rules.copyPending')}
                </Button>
              )}
            </div>

            <RosterTable
              rows={visible}
              roleLabel={roleLabel}
              emptyText={rows.length > 0 ? t('rules.noMatches') : t('rules.noRoster')}
            />

            {data.extra.length > 0 && (
              <div className="space-y-2">
                <div className="text-label text-muted-foreground">{t('rules.extraSignatures')}</div>
                <RosterTable rows={data.extra} roleLabel={roleLabel} emptyText={t('rules.noRoster')} />
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'rounded-full border px-2.5 py-1 text-micro transition-colors',
        active
          ? 'border-primary bg-primary/10 text-primary'
          : 'border-border text-muted-foreground hover:bg-muted',
      )}
    >
      {children}
    </button>
  );
}

function RosterTable({
  rows,
  roleLabel,
  emptyText,
}: {
  rows: RosterRow[];
  roleLabel: (role: string | null) => string;
  emptyText: string;
}) {
  const { t } = useLanguage();
  const [openSig, setOpenSig] = useState<number | null>(null);
  return (
    <div className="divide-y divide-border rounded-lg border border-border">
      {rows.map((r) => {
        const signed = r.signature_id !== null;
        return (
          <div key={`${r.user_id}-${r.signature_id ?? 'x'}`} className="px-3 py-2">
            <div className="flex items-center gap-3">
              {signed ? (
                <CheckCircle2 className="h-4 w-4 shrink-0 text-success" aria-hidden />
              ) : (
                <Clock className="h-4 w-4 shrink-0 text-warning" aria-hidden />
              )}
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-sm font-medium text-foreground">
                    {r.full_name ?? r.username ?? `#${r.user_id}`}
                  </span>
                  {r.team_code && (
                    <Badge variant="secondary" className="text-micro">
                      {r.team_code}
                    </Badge>
                  )}
                  <span className="text-micro text-muted-foreground">{roleLabel(r.role)}</span>
                </div>
                <div className="text-micro text-muted-foreground">
                  {signed ? (
                    t('rules.signedAt', { date: formatDateTime(r.signed_at) })
                  ) : r.previous ? (
                    <span className="text-warning">
                      {t('rules.previousVersionSigned', {
                        version: r.previous.version,
                        date: formatDateTime(r.previous.signed_at),
                      })}
                    </span>
                  ) : (
                    t('rules.neverSigned')
                  )}
                </div>
              </div>
              {signed && (
                <button
                  type="button"
                  className="text-micro text-primary underline-offset-2 hover:underline"
                  onClick={() => setOpenSig(openSig === r.signature_id ? null : r.signature_id)}
                >
                  {openSig === r.signature_id ? t('common.close') : t('rules.viewSignature')}
                </button>
              )}
            </div>
            {signed && openSig === r.signature_id && (
              <div className="mt-2 pl-7">
                <SignatureImage signatureId={r.signature_id!} />
              </div>
            )}
          </div>
        );
      })}
      {rows.length === 0 && (
        <div className="px-3 py-4 text-center text-sm text-muted-foreground">{emptyText}</div>
      )}
    </div>
  );
}
