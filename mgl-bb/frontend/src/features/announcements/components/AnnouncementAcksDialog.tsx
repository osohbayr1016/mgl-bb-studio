import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BellRing, CheckCircle2, Clock, Copy, Loader2, Search, Users } from 'lucide-react';

import { useLanguage } from '@/shared/i18n';
import { formatDateTime } from '@/shared/lib/time';
import { toast } from '@/shared/components/Toast';
import { cn } from '@/shared/lib/utils';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/ui/select';
import { Badge } from '@/ui/badge';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import { Progress } from '@/ui/progress';

import { announcementKeys, fetchAnnouncementAcks, remindAnnouncement } from '../api';
import type { AdminAnnouncement, RosterRow } from '../api';
import { filterRoster, pendingNames } from '../lib/rosterFilter';
import type { RosterFilter } from '../lib/rosterFilter';
import { roleLabelKey } from '@/shared/lib/roles';
import { AckSignatureImage } from './AckSignatureImage';

/**
 * Админ — «хэн баталгаажуулсан / хэзээ / хэн ҮГҮЙ» (одоогийн эсвэл сонгосон
 * хувилбар).  Зөвхөн admin (эзний шийдвэр 2026-09-21); сервер `requireAdmin()`.
 *
 * Баталгаажуулаагүй мөрөнд «өмнөх хувилбарт баталгаажуулсан» / «огт үгүй»
 * ялгаатай.  «Нэр хуулах» нь хүлээгдэж буй хүмүүсийн жагсаалтыг чат/имэйлд
 * наах, «Сануулах» нь тэдэнд дахин мэдэгдэл илгээх.  Идэвхгүй болсон ч
 * баталгаажуулсан хүмүүс `extra` хэсэгт — түүх алдагдахгүй.
 */
export function AnnouncementAcksDialog({
  item,
  open,
  onOpenChange,
}: {
  item: AdminAnnouncement | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useLanguage();
  const queryClient = useQueryClient();
  const [version, setVersion] = useState<number | null>(null);
  const [filter, setFilter] = useState<RosterFilter>('all');
  const [query, setQuery] = useState('');
  const id = item?.id ?? 0;

  const q = useQuery({
    queryKey: announcementKeys.acks(id, version),
    queryFn: () => fetchAnnouncementAcks(id, version),
    enabled: open && id > 0,
  });

  const remind = useMutation({
    mutationFn: () => remindAnnouncement(id),
    onSuccess: (r) => toast.success(t('announcements.remindDone', { count: r.reminded })),
    onError: (err: unknown) => toast.error(t('common.saveFailed'), err instanceof Error ? err.message : undefined),
  });

  const data = q.data;
  const rows = useMemo(() => data?.rows ?? [], [data]);
  const summary = data?.summary ?? { acked: 0, pending: 0, total: 0 };
  const visible = useMemo(() => filterRoster(rows, filter, query), [rows, filter, query]);
  const viewingCurrent = !data || data.viewing_version === data.ack_version;

  const roleLabel = (role: string | null) => (role ? t(roleLabelKey(role)) : '');

  const copyPending = async () => {
    const names = pendingNames(rows);
    if (names.length === 0) return;
    try {
      await navigator.clipboard.writeText(names.join('\n'));
      toast.success(t('announcements.copyPendingDone', { count: names.length }));
    } catch {
      toast.error(t('common.saveFailed'));
    }
  };

  const reset = () => {
    setVersion(null);
    setFilter('all');
    setQuery('');
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) {
          reset();
          void queryClient.invalidateQueries({ queryKey: announcementKeys.admin });
        }
        onOpenChange(v);
      }}
    >
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl" data-testid="acks-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Users className="h-5 w-5 text-primary" aria-hidden />
            {t('announcements.acksTitle')}
            {item && <span className="truncate text-muted-foreground">— {item.title}</span>}
          </DialogTitle>
        </DialogHeader>

        {q.isLoading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-hidden />
          </div>
        ) : !data || data.ack_mode === 'none' ? (
          <p className="py-6 text-center text-sm text-muted-foreground">{t('announcements.noAckRequired')}</p>
        ) : (
          <div className="space-y-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="space-y-1">
                <div className="text-sm" data-testid="acks-summary">
                  {t('announcements.ackedProgress', { acked: summary.acked, total: summary.total })}
                </div>
                <Progress value={summary.total ? (summary.acked / summary.total) * 100 : 0} className="h-2 w-56" />
                <div className={cn('text-micro', summary.pending > 0 ? 'text-warning' : 'text-success')}>
                  {summary.pending > 0 ? t('announcements.pendingCount', { count: summary.pending }) : t('announcements.allAcked')}
                </div>
              </div>
              {data.versions.length > 1 || data.ack_version > 1 ? (
                <Select value={String(data.viewing_version)} onValueChange={(v) => setVersion(Number(v) === data.ack_version ? null : Number(v))}>
                  <SelectTrigger className="h-8 w-44 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Array.from({ length: data.ack_version }, (_, i) => data.ack_version - i).map((v) => {
                      const info = data.versions.find((x) => x.ack_version === v);
                      return (
                        <SelectItem key={v} value={String(v)}>
                          v{v} · {info?.acked_count ?? 0}
                          {v === data.ack_version ? ` (${t('announcements.currentVersion')})` : ''}
                        </SelectItem>
                      );
                    })}
                  </SelectContent>
                </Select>
              ) : null}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="relative flex-1 min-w-40">
                <Search className="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
                <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('common.search')} className="h-8 pl-8 text-sm" />
              </div>
              <div className="flex gap-1">
                {(['all', 'acked', 'pending'] as RosterFilter[]).map((f) => (
                  <Button key={f} type="button" size="sm" variant={filter === f ? 'default' : 'outline'} className="h-8" onClick={() => setFilter(f)}>
                    {f === 'all' ? t('common.all') : f === 'acked' ? t('announcements.filterAcked') : t('announcements.filterPending')}
                  </Button>
                ))}
              </div>
              <Button type="button" size="sm" variant="outline" className="h-8" onClick={() => void copyPending()} disabled={summary.pending === 0}>
                <Copy className="mr-1.5 h-3.5 w-3.5" aria-hidden />
                {t('announcements.copyPending')}
              </Button>
              {viewingCurrent && item?.status === 'published' && (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-8"
                  onClick={() => remind.mutate()}
                  disabled={summary.pending === 0 || remind.isPending}
                  data-testid="remind-button"
                >
                  {remind.isPending ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden /> : <BellRing className="mr-1.5 h-3.5 w-3.5" aria-hidden />}
                  {t('announcements.remind')}
                </Button>
              )}
            </div>

            <ul className="divide-y divide-border rounded-md border border-border" data-testid="acks-rows">
              {visible.length === 0 && <li className="px-3 py-4 text-center text-sm text-muted-foreground">{t('announcements.noRows')}</li>}
              {visible.map((r) => (
                <RosterLine key={r.user_id} row={r} roleLabel={roleLabel} />
              ))}
            </ul>

            {data.extra.length > 0 && (
              <div className="space-y-1">
                <div className="text-micro font-medium uppercase tracking-wide text-muted-foreground">{t('announcements.extraTitle')}</div>
                <ul className="divide-y divide-border rounded-md border border-dashed border-border">
                  {data.extra.map((r) => (
                    <RosterLine key={`x-${r.user_id}`} row={r} roleLabel={roleLabel} muted />
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function RosterLine({ row, roleLabel, muted }: { row: RosterRow; roleLabel: (r: string | null) => string; muted?: boolean }) {
  const { t } = useLanguage();
  const acked = row.ack_id !== null;
  return (
    <li className={cn('flex flex-wrap items-center gap-3 px-3 py-2', muted && 'opacity-70')} data-acked={acked ? '1' : '0'}>
      {acked ? <CheckCircle2 className="h-4 w-4 shrink-0 text-success" aria-hidden /> : <Clock className="h-4 w-4 shrink-0 text-warning" aria-hidden />}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium text-foreground">{row.full_name ?? row.username ?? `#${row.user_id}`}</span>
          {row.team_code && (
            <Badge variant="outline" className="font-mono text-micro">
              {row.team_code}
            </Badge>
          )}
          <span className="text-micro text-muted-foreground">{roleLabel(row.role)}</span>
        </div>
        <div className="text-micro text-muted-foreground">
          {acked
            ? t('announcements.ackedAt', { date: formatDateTime(row.acked_at) })
            : row.previous
              ? t('announcements.previousVersionAcked', { version: row.previous.ack_version, date: formatDateTime(row.previous.acked_at) })
              : t('announcements.neverAcked')}
        </div>
      </div>
      {acked && row.ack_kind === 'signature' && row.ack_id !== null && <AckSignatureImage ackId={row.ack_id} className="inline-block rounded-md border border-border bg-white p-1" />}
    </li>
  );
}
