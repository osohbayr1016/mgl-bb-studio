/* Идэвхжүүлэлтийн төлөв + managed root-уудын тойм (2026-10-05).
 *
 * Төлөв нь СЕРВЕРИЙН хаалга (`app_settings['task_alloc.state']`): enabled | paused | disabled.  Энэ хуудас түүнийг харуулж,
 * зөвхөн admin өөрчилнэ (үндэслэл заавал — түүхэнд хадгалагдана).  `paused` бол ОСЛЫН түгжээ: унших хэвээр, түүх/оноо/цаг устахгүй. */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Lock, Play, ShieldAlert } from 'lucide-react';

import { Alert, AlertTitle } from '@/ui/alert';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/ui/alert-dialog';
import { Badge } from '@/ui/badge';
import { Button } from '@/ui/button';
import { Card } from '@/ui/card';
import { Checkbox } from '@/ui/checkbox';
import { ResponsiveTable } from '@/ui/responsive-table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/ui/select';
import { Textarea } from '@/ui/textarea';
import { toast } from '@/shared/components/Toast';
import { useLanguage } from '@/shared/i18n';

import { adminErrorText, adminKeys, fetchRoots, fetchState, putState, type AllocState, type RootRow } from './adminApi';
import { dateTime, unitsPct } from './format';

const STATES: AllocState[] = ['paused', 'enabled', 'disabled'];
const MIN_REASON = 3;

export function StateBadge({ state }: { state: AllocState }) {
  const { t } = useLanguage();
  const variant = state === 'enabled' ? 'default' : state === 'paused' ? 'destructive' : 'secondary';
  return (
    <Badge variant={variant} data-testid="alloc-state-badge" data-state={state}>
      {t(`taskAllocAdmin.state.${state}`)}
    </Badge>
  );
}

export function StateTab({ canWrite }: { canWrite: boolean }) {
  const { t } = useLanguage();
  const qc = useQueryClient();
  const state = useQuery({ queryKey: adminKeys.state, queryFn: fetchState, refetchInterval: 30_000 });
  const [target, setTarget] = useState<AllocState>('paused');
  const [reason, setReason] = useState('');
  const [confirm, setConfirm] = useState(false);
  const [ack, setAck] = useState(false);
  const [onlyOpen, setOnlyOpen] = useState(true);
  const [offset, setOffset] = useState(0);
  const roots = useQuery({ queryKey: adminKeys.roots(offset, onlyOpen), queryFn: () => fetchRoots(offset, onlyOpen) });

  const save = useMutation({
    mutationFn: () => putState({ state: target, reason: reason.trim(), expected_state: state.data!.state }),
    onSuccess: (r) => {
      toast.success(r.changed ? t('taskAllocAdmin.state.changed') : t('taskAllocAdmin.state.unchanged'));
      setConfirm(false);
      setAck(false);
      setReason('');
      void qc.invalidateQueries({ queryKey: adminKeys.all });
    },
    onError: (err) => {
      toast.error(t('taskAllocAdmin.state.failed'), adminErrorText(err, ''));
      setConfirm(false);
      void qc.invalidateQueries({ queryKey: adminKeys.state });
    },
  });

  const cur = state.data;
  const reasonOk = reason.trim().length >= MIN_REASON;
  const sameState = !!cur && cur.configured && cur.state === target;
  const riskier = target === 'enabled'; // идэвхжүүлэхээс өмнө аудит цэвэр эсэхийг заавал баталгаажуулна

  return (
    <div className="space-y-4" data-testid="alloc-admin-state">
      {state.isError && (
        <Alert variant="destructive">
          <AlertTitle>{t('taskAllocAdmin.loadFailed')}</AlertTitle>
        </Alert>
      )}
      <Card className="space-y-4 p-4">
        <div className="flex flex-wrap items-center gap-3">
          {cur ? <StateBadge state={cur.state} /> : <Loader2 className="h-4 w-4 animate-spin text-primary" />}
          {cur && !cur.configured && (
            <Badge variant="outline" className="gap-1">
              <ShieldAlert aria-hidden /> {t('taskAllocAdmin.state.unconfigured')}
            </Badge>
          )}
          {cur && (
            <span className="text-xs text-muted-foreground">
              {t('taskAllocAdmin.state.contract', { v: String(cur.contract), min: String(cur.min_contract) })}
            </span>
          )}
        </div>
        {cur && <p className="text-sm text-muted-foreground">{t(`taskAllocAdmin.state.${cur.state}Desc`)}</p>}
        {cur && (
          <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-6" data-testid="alloc-counts">
            {(
              [
                ['roots', cur.counts.roots],
                ['activeRoots', cur.counts.active_roots],
                ['completeRoots', cur.counts.complete_roots],
                ['participants', cur.counts.participants],
                ['pendingPost', cur.counts.pending_post_commit],
                ['pendingReconcile', (cur.counts.pending_reconcile ?? 0) + (cur.counts.failed_reconcile ?? 0)],
              ] as const
            ).map(([k, v]) => (
              <div key={k} className="rounded-lg border border-border bg-muted/30 p-2.5">
                <dt className="text-xs text-muted-foreground">{t(`taskAllocAdmin.count.${k}`)}</dt>
                <dd className="text-lg font-semibold tabular-nums">{v}</dd>
              </div>
            ))}
          </dl>
        )}
      </Card>

      <Card className="space-y-3 p-4">
        <h3 className="text-sm font-semibold">{t('taskAllocAdmin.state.changeTitle')}</h3>
        {!canWrite && <p className="text-xs text-muted-foreground">{t('taskAllocAdmin.adminOnly')}</p>}
        <div className="grid gap-3 sm:grid-cols-[14rem_1fr]">
          <div className="space-y-1.5">
            <label className="block text-xs font-medium" htmlFor="alloc-target">
              {t('taskAllocAdmin.state.target')}
            </label>
            <Select value={target} onValueChange={(v) => setTarget(v as AllocState)} disabled={!canWrite}>
              <SelectTrigger id="alloc-target" className="w-full" data-testid="alloc-target">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STATES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {t(`taskAllocAdmin.state.${s}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <label className="block text-xs font-medium" htmlFor="alloc-reason">
              {t('taskAllocAdmin.reason')}
            </label>
            <Textarea
              id="alloc-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={200}
              rows={2}
              placeholder={t('taskAllocAdmin.reasonPlaceholder')}
              disabled={!canWrite}
              data-testid="alloc-reason"
            />
          </div>
        </div>
        <p className="text-xs text-muted-foreground">{t(`taskAllocAdmin.state.${target}Desc`)}</p>
        {riskier && (
          <label className="flex items-start gap-2 text-sm">
            <Checkbox checked={ack} onCheckedChange={(v) => setAck(v === true)} disabled={!canWrite} data-testid="alloc-ack" />
            <span>{t('taskAllocAdmin.state.enableAck')}</span>
          </label>
        )}
        <div className="flex justify-end">
          <Button
            type="button"
            onClick={() => setConfirm(true)}
            disabled={!canWrite || !cur || !reasonOk || sameState || (riskier && !ack) || save.isPending}
            data-testid="alloc-state-save"
          >
            {target === 'enabled' ? <Play aria-hidden /> : <Lock aria-hidden />}
            {t('taskAllocAdmin.state.apply')}
          </Button>
        </div>
      </Card>

      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('taskAllocAdmin.state.confirmTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('taskAllocAdmin.state.confirmBody', {
                from: cur ? t(`taskAllocAdmin.state.${cur.state}`) : '—',
                to: t(`taskAllocAdmin.state.${target}`),
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={save.isPending}>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              disabled={save.isPending}
              data-testid="alloc-state-confirm"
              onClick={(e) => {
                e.preventDefault();
                save.mutate();
              }}
            >
              {save.isPending && <Loader2 className="animate-spin" aria-hidden />}
              {t('taskAllocAdmin.state.confirmGo')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Card className="space-y-2 p-4">
        <h3 className="text-sm font-semibold">{t('taskAllocAdmin.state.historyTitle')}</h3>
        <ResponsiveTable
          rows={cur?.history ?? []}
          rowKey={(r) => r.id}
          empty={<p className="py-3 text-sm text-muted-foreground">{t('taskAllocAdmin.empty')}</p>}
          columns={[
            { id: 'at', header: t('taskAllocAdmin.col.time'), cell: (r) => <span className="tabular-nums">{dateTime(r.at)}</span> },
            {
              id: 'change',
              header: t('taskAllocAdmin.col.change'),
              cell: (r) => `${r.from_state ? t(`taskAllocAdmin.state.${r.from_state}`) : '—'} → ${t(`taskAllocAdmin.state.${r.to_state}`)}`,
            },
            { id: 'actor', header: t('taskAllocAdmin.col.actor'), cell: (r) => (r.actor_id ? `#${r.actor_id}` : t('taskAllocAdmin.system')), hideOnMobile: true },
            { id: 'reason', header: t('taskAllocAdmin.reason'), cell: (r) => r.reason ?? '—' },
          ]}
        />
      </Card>

      <Card className="space-y-3 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">{t('taskAllocAdmin.roots.title')}</h3>
          <label className="flex items-center gap-2 text-xs">
            <Checkbox
              checked={onlyOpen}
              onCheckedChange={(v) => {
                setOnlyOpen(v === true);
                setOffset(0);
              }}
            />
            {t('taskAllocAdmin.roots.onlyOpen')}
          </label>
        </div>
        <ResponsiveTable<RootRow>
          rows={roots.data?.rows ?? []}
          rowKey={(r) => r.task_id}
          empty={<p className="py-3 text-sm text-muted-foreground">{roots.isLoading ? t('common.loading') : t('taskAllocAdmin.empty')}</p>}
          columns={[
            { id: 'task', header: t('taskAllocAdmin.col.task'), cell: (r) => <span className="font-medium">{r.task_name}</span> },
            { id: 'project', header: t('taskAllocAdmin.col.project'), cell: (r) => r.project_name, hideOnMobile: true },
            { id: 'done', header: t('taskAllocAdmin.col.done'), align: 'right', cell: (r) => <span className="tabular-nums">{unitsPct(r.sum_done_units + r.unattributed_units)}</span> },
            { id: 'free', header: t('taskAllocAdmin.col.free'), align: 'right', cell: (r) => <span className="tabular-nums">{unitsPct(r.unallocated_units)}</span>, hideOnMobile: true },
            { id: 'people', header: t('taskAllocAdmin.col.people'), align: 'right', cell: (r) => `${r.active_participants}/${r.participants}` },
            { id: 'rev', header: t('taskAllocAdmin.col.revision'), align: 'right', cell: (r) => <span className="tabular-nums">r{r.revision}</span>, hideOnMobile: true },
          ]}
        />
        {roots.data && roots.data.total > 25 && (
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>{t('taskAllocAdmin.roots.range', { from: String(offset + 1), to: String(Math.min(offset + 25, roots.data.total)), total: String(roots.data.total) })}</span>
            <div className="flex gap-2">
              <Button type="button" size="sm" variant="outline" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - 25))}>
                {t('taskAllocAdmin.prev')}
              </Button>
              <Button type="button" size="sm" variant="outline" disabled={offset + 25 >= roots.data.total} onClick={() => setOffset(offset + 25)}>
                {t('taskAllocAdmin.next')}
              </Button>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}

export default StateTab;
