/* Хуучин бүлгийг хуваарилалт руу ХӨРВҮҮЛЭХ — төлөвлөгөө харах + хэрэгжүүлэх (2026-10-05).
 *
 *   1. Төлөвлөгөө (preview) — юу ч бичихгүй: root, хэсэг бүрийн T/D, хэнд хийсэн нь нотолгоотой оноогдсон, эзэнгүй B, ирээдүйн
 *      ажил U, төслийн явц өмнө/хойно.
 *   2. Хэрэгжүүлэх — төлөвлөгөөний `plan_hash` + шалтгаан (+ нотолгоо сул бол ИЛ баталгаа).  Сервер төлөвлөгөөг дахин
 *      тооцож, preview-ээс хойш юу ч өөрчлөгдөөгүй бол л атом бичнэ (PLAN_STALE бол дахин preview). */
import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';

import { Alert, AlertDescription, AlertTitle } from '@/ui/alert';
import { Badge } from '@/ui/badge';
import { Button } from '@/ui/button';
import { Checkbox } from '@/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/ui/dialog';
import { Input } from '@/ui/input';
import { ResponsiveTable } from '@/ui/responsive-table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/ui/select';
import { Textarea } from '@/ui/textarea';
import { toast } from '@/shared/components/Toast';
import { formatDisplayName } from '@/shared/lib/formatting';
import { useLanguage } from '@/shared/i18n';

import { fetchCandidates as fetchUserCandidates } from '../api';
import { useAttempt } from '../useAttempt';
import { adminErrorText, adminKeys, applyConversion, previewConversion, type CandidateGroup, type PlannedMember } from './adminApi';
import { invalidateAfterProgress } from '../ownProgressStore';
import { shortHash, unitsPct } from './format';
import { useCodeText } from './useCodeText';

const NONE = 'none';

export function ConversionDialog({ group, isAdmin, onClose }: { group: CandidateGroup; isAdmin: boolean; onClose: () => void }) {
  const { t } = useLanguage();
  const codeText = useCodeText();
  const qc = useQueryClient();
  const attempt = useAttempt();
  const [rootId, setRootId] = useState(group.suggested_root_task_id);
  const [rootName, setRootName] = useState('');
  const [rootNameCommitted, setRootNameCommitted] = useState('');
  const [owners, setOwners] = useState<Record<number, string>>({});
  const [reason, setReason] = useState('');
  // Нотолгоо сул гэсэн ИЛ баталгаа нь ЗӨВХӨН баталгаажуулсан төлөвлөгөөнд хүчинтэй — root/нэр/эзэн өөрчлөгдөж hash солигдвол арилна.
  const [confirmedFor, setConfirmedFor] = useState<string | null>(null);
  const people = useQuery({ queryKey: ['/tasks/allocation-candidates'], queryFn: fetchUserCandidates, staleTime: 60_000 });
  const nameOf = useMemo(() => {
    const m = new Map<number, string>();
    for (const u of people.data ?? []) m.set(u.id, formatDisplayName(u.full_name));
    return (id: number) => m.get(id) ?? `#${id}`;
  }, [people.data]);

  const ownersPayload = useMemo(() => {
    const out: Record<number, number> = {};
    for (const [k, v] of Object.entries(owners)) if (v !== '' && v !== NONE) out[Number(k)] = Number(v);
    return out;
  }, [owners]);
  const ownersKey = JSON.stringify(ownersPayload);

  const preview = useQuery({
    queryKey: [...adminKeys.all, 'preview', group.key, rootId, rootNameCommitted, ownersKey],
    queryFn: () =>
      previewConversion({
        task_ids: group.task_ids,
        root_task_id: rootId,
        ...(rootNameCommitted.trim() ? { root_name: rootNameCommitted.trim() } : {}),
        ...(Object.keys(ownersPayload).length > 0 ? { future_owners: ownersPayload } : {}),
      }),
    staleTime: 0,
    gcTime: 10_000,
    retry: false,
  });
  const pv = preview.data;
  const plan = pv?.plan ?? null;
  const confirmed = confirmedFor !== null && confirmedFor === (pv?.plan_hash ?? null);

  const apply = useMutation({
    mutationFn: () =>
      applyConversion({
        task_ids: group.task_ids,
        root_task_id: rootId,
        ...(rootNameCommitted.trim() ? { root_name: rootNameCommitted.trim() } : {}),
        ...(Object.keys(ownersPayload).length > 0 ? { future_owners: ownersPayload } : {}),
        request_id: attempt(`${pv?.plan_hash}|${reason.trim()}|${confirmed}`),
        plan_hash: pv!.plan_hash!,
        reason: reason.trim(),
        confirm_ambiguous: confirmed,
      }),
    onSuccess: () => {
      toast.success(t('taskAllocAdmin.conv.applied'));
      void qc.invalidateQueries({ queryKey: adminKeys.all });
      invalidateAfterProgress(); // төслийн шатлал, «Миний ажлууд», хувь нэмэрчид, хуваарилалт — хөрвүүлэлтээр өөрчлөгдсөн
      onClose();
    },
    onError: (err) => {
      const code = (err as { payload?: { error?: string } })?.payload?.error;
      toast.error(t('taskAllocAdmin.conv.applyFailed'), code === 'PLAN_STALE' ? t('taskAllocAdmin.conv.stale') : adminErrorText(err, ''));
      if (code === 'PLAN_STALE') void preview.refetch();
    },
  });

  const canApply = isAdmin && !!plan && !!pv?.plan_hash && reason.trim().length >= 3 && (!pv.needs_confirmation || confirmed) && !apply.isPending;

  return (
    <Dialog open onOpenChange={(o) => !o && !apply.isPending && onClose()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-3xl" data-testid="conv-dialog">
        <DialogHeader>
          <DialogTitle>{t('taskAllocAdmin.conv.dialogTitle')}</DialogTitle>
          <DialogDescription>{t('taskAllocAdmin.conv.dialogDesc')}</DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <label className="block text-xs font-medium" htmlFor="conv-root">
              {t('taskAllocAdmin.conv.root')}
            </label>
            <Select value={String(rootId)} onValueChange={(v) => setRootId(Number(v))}>
              <SelectTrigger id="conv-root" className="w-full" data-testid="conv-root">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {group.members.map((m) => (
                  <SelectItem key={m.task_id} value={String(m.task_id)}>
                    #{m.task_id} · {m.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <label className="block text-xs font-medium" htmlFor="conv-name">
              {t('taskAllocAdmin.conv.rootName')}
            </label>
            <Input
              id="conv-name"
              value={rootName}
              onChange={(e) => setRootName(e.target.value)}
              onBlur={() => setRootNameCommitted(rootName)}
              placeholder={plan?.rootNameAfter ?? ''}
              data-testid="conv-name"
            />
          </div>
        </div>

        <div className="space-y-2">
          <p className="block text-xs font-medium">{t('taskAllocAdmin.conv.futureOwners')}</p>
          <p className="text-xs text-muted-foreground">{t('taskAllocAdmin.conv.futureOwnersHint')}</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {group.members.map((m) => (
              <div key={m.task_id} className="space-y-1">
                <span className="block truncate text-xs text-muted-foreground">{m.name}</span>
                <Select value={owners[m.task_id] ?? NONE} onValueChange={(v) => setOwners((o) => ({ ...o, [m.task_id]: v }))}>
                  <SelectTrigger className="w-full" aria-label={`${t('taskAllocAdmin.conv.futureOwners')}: ${m.name}`} data-testid={`conv-owner-${m.task_id}`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>{t('taskAllocAdmin.conv.ownerNone')}</SelectItem>
                    {(people.data ?? []).map((u) => (
                      <SelectItem key={u.id} value={String(u.id)}>
                        {formatDisplayName(u.full_name)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ))}
          </div>
        </div>

        {preview.isLoading && (
          <div className="flex items-center justify-center py-6">
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
          </div>
        )}
        {preview.isError && (
          <Alert variant="destructive">
            <AlertTitle>{t('taskAllocAdmin.conv.previewFailed')}</AlertTitle>
            <AlertDescription>{adminErrorText(preview.error, '')}</AlertDescription>
          </Alert>
        )}
        {pv && !plan && (
          <Alert variant="destructive" data-testid="conv-blocked">
            <AlertTitle>{t('taskAllocAdmin.conv.blocked')}</AlertTitle>
            <AlertDescription>
              {pv.classification.blockers.map((b) => codeText('taskAllocAdmin.conv.blocker', b)).join(' · ') ||
                (pv.plan_failure ? codeText('taskAllocAdmin.conv.failure', pv.plan_failure.code) : '')}
            </AlertDescription>
          </Alert>
        )}

        {plan && pv && (
          <div className="space-y-4" data-testid="conv-plan">
            <dl className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-5">
              {(
                [
                  ['weight', `${plan.weight}`],
                  ['done', unitsPct(plan.rootDoneUnits)],
                  ['unattributed', unitsPct(plan.unattributedUnits)],
                  ['free', unitsPct(plan.unallocatedUnits)],
                  ['slack', unitsPct(plan.slackUnits)],
                ] as const
              ).map(([k, v]) => (
                <div key={k} className="rounded-lg border border-border bg-muted/30 p-2">
                  <dt className="text-micro text-muted-foreground">{t(`taskAllocAdmin.conv.sum.${k}`)}</dt>
                  <dd className="font-semibold tabular-nums">{v}</dd>
                </div>
              ))}
            </dl>
            <p className="text-xs text-muted-foreground" data-testid="conv-rollup">
              {t('taskAllocAdmin.conv.rollup', { before: plan.rollup.before.toFixed(3), after: plan.rollup.after.toFixed(3) })}
            </p>

            <ResponsiveTable<PlannedMember>
              rows={plan.members}
              rowKey={(m) => m.taskId}
              columns={[
                {
                  id: 'name',
                  header: t('taskAllocAdmin.col.task'),
                  cell: (m) => (
                    <span className="flex items-center gap-2">
                      <span className="font-medium">{m.name}</span>
                      <Badge variant={m.role === 'root' ? 'default' : 'secondary'}>{t(`taskAllocAdmin.conv.role.${m.role}`)}</Badge>
                    </span>
                  ),
                },
                { id: 'w', header: t('taskAllocAdmin.conv.col.weight'), align: 'right', cell: (m) => <span className="tabular-nums">{m.weightBefore} → {m.weightAfter}</span> },
                { id: 't', header: 'T', align: 'right', cell: (m) => <span className="tabular-nums">{unitsPct(m.targetUnits)}</span> },
                { id: 'd', header: 'D', align: 'right', cell: (m) => <span className="tabular-nums">{unitsPct(m.doneUnits)}</span> },
                {
                  id: 'attr',
                  header: t('taskAllocAdmin.conv.col.attribution'),
                  cell: (m) => <Badge variant={m.attribution === 'uncertain' ? 'destructive' : 'outline'}>{t(`taskAllocAdmin.conv.attr.${m.attribution}`)}</Badge>,
                  hideOnMobile: true,
                },
              ]}
            />

            <div className="space-y-1">
              <p className="block text-xs font-medium">{t('taskAllocAdmin.conv.allocations')}</p>
              <ul className="space-y-1 text-sm" data-testid="conv-allocations">
                {plan.allocations.map((a) => (
                  <li key={a.userId} className="flex justify-between gap-3 rounded-md border border-border px-2.5 py-1.5">
                    <span>{nameOf(a.userId)}</span>
                    <span className="tabular-nums text-muted-foreground">
                      D {unitsPct(a.doneUnits)} · T {unitsPct(a.targetUnits)}
                    </span>
                  </li>
                ))}
                {plan.allocations.length === 0 && <li className="text-muted-foreground">{t('taskAllocAdmin.conv.noAllocations')}</li>}
              </ul>
            </div>

            {plan.warnings.length > 0 && (
              <Alert data-testid="conv-warnings">
                <AlertTitle>{t('taskAllocAdmin.conv.warnings')}</AlertTitle>
                <AlertDescription>
                  <ul className="list-disc pl-5">
                    {plan.warnings.map((w) => (
                      <li key={w}>{codeText('taskAllocAdmin.conv.warning', w)}</li>
                    ))}
                  </ul>
                </AlertDescription>
              </Alert>
            )}

            <div className="space-y-3 rounded-lg border border-border p-3">
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <Badge variant="outline">{t(`taskAllocAdmin.conv.evidence.${pv.evidence}`)}</Badge>
                <Badge variant={pv.needs_confirmation ? 'destructive' : 'default'}>{t(`taskAllocAdmin.conv.class.${pv.classification.classification}`)}</Badge>
                <span className="font-mono">#{shortHash(pv.plan_hash)}</span>
              </div>
              <div className="space-y-1.5">
                <label htmlFor="conv-reason" className="block text-xs font-medium">
                  {t('taskAllocAdmin.reason')}
                </label>
                <Textarea id="conv-reason" rows={2} maxLength={200} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t('taskAllocAdmin.reasonPlaceholder')} data-testid="conv-reason" />
              </div>
              {pv.needs_confirmation && (
                <label className="flex items-start gap-2 text-sm">
                  <Checkbox checked={confirmed} onCheckedChange={(v) => setConfirmedFor(v === true ? (pv.plan_hash ?? null) : null)} data-testid="conv-confirm" />
                  <span>{t('taskAllocAdmin.conv.confirmAmbiguous')}</span>
                </label>
              )}
            </div>
          </div>
        )}

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose} disabled={apply.isPending}>
            {t('common.cancel')}
          </Button>
          <Button type="button" onClick={() => apply.mutate()} disabled={!canApply} data-testid="conv-apply">
            {apply.isPending && <Loader2 className="animate-spin" aria-hidden />}
            {isAdmin ? t('taskAllocAdmin.conv.apply') : t('taskAllocAdmin.adminOnly')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default ConversionDialog;
