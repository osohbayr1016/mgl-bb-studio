/* Хуучин бүлгийн хөрвүүлэлт — нэр дэвшигчид, хөрвүүлэлтийн журнал, буцаалт (2026-10-05).
 *
 * Ангилал нь НОТОЛГООНЫ түвшин (нэр, зэрэгцээ байрлал нотолгоо БИШ):
 *   proven_split — системийн бичсэн бүлэг (`tasks.group_id`) → менежер баталгаажуулж хөрвүүлнэ
 *   ambiguous    — нэрийн хэв маяг/гараар → ИЛ баталгаа + шалтгаан
 *   organizational — нэгтгэх боломжгүй бүтэц (өөр зураг, нэг гишүүн, жингүй)
 *   already_managed — аль хэдийн хөрвүүлсэн/managed */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { GitMerge, Loader2, RefreshCw, Undo2 } from 'lucide-react';

import { Alert, AlertDescription, AlertTitle } from '@/ui/alert';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/ui/alert-dialog';
import { Badge } from '@/ui/badge';
import { Button } from '@/ui/button';
import { Card } from '@/ui/card';
import { ResponsiveTable } from '@/ui/responsive-table';
import { Textarea } from '@/ui/textarea';
import { toast } from '@/shared/components/Toast';
import { useLanguage } from '@/shared/i18n';

import { useAttempt } from '../useAttempt';
import { adminErrorText, adminKeys, fetchCandidates, fetchConversionHistory, revertConversion, type CandidateGroup, type ConversionRow, type GroupClass } from './adminApi';
import { ConversionDialog } from './ConversionDialog';
import { invalidateAfterProgress } from '../ownProgressStore';
import { useCodeText } from './useCodeText';
import { dateTime } from './format';

const CLASS_VARIANT: Record<GroupClass, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  proven_split: 'default',
  ambiguous: 'destructive',
  organizational: 'secondary',
  already_managed: 'outline',
};

function CandidateCard({ group, onOpen }: { group: CandidateGroup; onOpen: () => void }) {
  const { t } = useLanguage();
  const codeText = useCodeText();
  const c = group.classification;
  return (
    <Card className="space-y-2 p-3" data-testid="conv-candidate" data-class={c.classification} data-evidence={group.evidence}>
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={CLASS_VARIANT[c.classification]}>{t(`taskAllocAdmin.conv.class.${c.classification}`)}</Badge>
        <Badge variant="outline">{t(`taskAllocAdmin.conv.evidence.${group.evidence}`)}</Badge>
        {group.project_id !== null && <span className="text-xs text-muted-foreground">{t('taskAllocAdmin.conv.projectN', { n: String(group.project_id) })}</span>}
      </div>
      <ul className="space-y-0.5 text-sm">
        {group.members.map((m) => (
          <li key={m.task_id} className="flex justify-between gap-3">
            <span className="min-w-0 truncate">
              #{m.task_id} · {m.name}
            </span>
            <span className="shrink-0 tabular-nums text-muted-foreground">
              w{m.weight} · {m.latest_pct}%
            </span>
          </li>
        ))}
      </ul>
      {c.blockers.length > 0 && <p className="text-xs text-destructive">{c.blockers.map((b) => codeText('taskAllocAdmin.conv.blocker', b)).join(' · ')}</p>}
      {c.warnings.length > 0 && <p className="text-xs text-muted-foreground">{c.warnings.map((w) => codeText('taskAllocAdmin.conv.warning', w)).join(' · ')}</p>}
      <div className="flex justify-end">
        <Button type="button" size="sm" variant="outline" onClick={onOpen} disabled={!c.convertible && c.classification !== 'ambiguous' && c.classification !== 'proven_split'} data-testid="conv-open">
          <GitMerge aria-hidden />
          {t('taskAllocAdmin.conv.openPlan')}
        </Button>
      </div>
    </Card>
  );
}

function RevertDialog({ row, onClose }: { row: ConversionRow; onClose: () => void }) {
  const { t } = useLanguage();
  const codeText = useCodeText();
  const qc = useQueryClient();
  const attempt = useAttempt();
  const [reason, setReason] = useState('');
  const [unsafe, setUnsafe] = useState<string[] | null>(null);
  const run = useMutation({
    mutationFn: () => revertConversion(row.id, { request_id: attempt(`${row.id}|${reason.trim()}`), reason: reason.trim() }),
    onSuccess: () => {
      toast.success(t('taskAllocAdmin.conv.reverted'));
      void qc.invalidateQueries({ queryKey: adminKeys.all });
      invalidateAfterProgress();
      onClose();
    },
    onError: (err) => {
      // `extra` талбар нь серверийн fail() дотор — payload.reasons шууд эсвэл payload.extra.reasons.
      const p = (err as { payload?: { error?: string; reasons?: string[]; extra?: { reasons?: string[] } } })?.payload;
      if (p?.error === 'REVERT_UNSAFE') setUnsafe(p.reasons ?? p.extra?.reasons ?? []);
      else {
        toast.error(t('taskAllocAdmin.conv.revertFailed'), adminErrorText(err, ''));
        // ALREADY_REVERTED / CONVERSION_NOT_FOUND — жагсаалт хуучирсан; дахин ачаална.
        void qc.invalidateQueries({ queryKey: adminKeys.history });
      }
    },
  });
  return (
    <AlertDialog open onOpenChange={(o) => !o && !run.isPending && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('taskAllocAdmin.conv.revertTitle')}</AlertDialogTitle>
          <AlertDialogDescription>{t('taskAllocAdmin.conv.revertBody', { id: row.id.slice(0, 12), root: String(row.root_task_id) })}</AlertDialogDescription>
        </AlertDialogHeader>
        <Textarea rows={2} maxLength={200} value={reason} onChange={(e) => setReason(e.target.value)} aria-label={t('taskAllocAdmin.reason')} placeholder={t('taskAllocAdmin.reasonPlaceholder')} data-testid="revert-reason" />
        {unsafe && (
          <Alert variant="destructive" data-testid="revert-unsafe">
            <AlertTitle>{t('taskAllocAdmin.conv.revertUnsafe')}</AlertTitle>
            <AlertDescription>{unsafe.map((r) => codeText('taskAllocAdmin.conv.revertReason', r)).join(' · ')}</AlertDescription>
          </Alert>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={run.isPending}>{t('common.cancel')}</AlertDialogCancel>
          <AlertDialogAction
            disabled={run.isPending || reason.trim().length < 3}
            data-testid="revert-confirm"
            onClick={(e) => {
              e.preventDefault();
              run.mutate();
            }}
          >
            {run.isPending && <Loader2 className="animate-spin" aria-hidden />}
            {t('taskAllocAdmin.conv.revertGo')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export function ConversionTab({ isAdmin }: { isAdmin: boolean }) {
  const { t } = useLanguage();
  const cands = useQuery({ queryKey: adminKeys.candidates, queryFn: fetchCandidates, retry: false });
  const history = useQuery({ queryKey: adminKeys.history, queryFn: fetchConversionHistory, retry: false });
  const [open, setOpen] = useState<CandidateGroup | null>(null);
  const [revert, setRevert] = useState<ConversionRow | null>(null);
  const data = cands.data;

  return (
    <div className="space-y-4" data-testid="alloc-admin-convert">
      <Card className="space-y-2 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">{t('taskAllocAdmin.conv.title')}</h3>
          <Button type="button" size="sm" variant="outline" onClick={() => void cands.refetch()} disabled={cands.isFetching}>
            {cands.isFetching ? <Loader2 className="animate-spin" aria-hidden /> : <RefreshCw aria-hidden />}
            {t('taskAllocAdmin.conv.rescan')}
          </Button>
        </div>
        <p className="text-sm text-muted-foreground">{t('taskAllocAdmin.conv.intro')}</p>
        {data && (
          <div className="flex flex-wrap gap-2" data-testid="conv-counts">
            {(['proven_split', 'ambiguous', 'organizational', 'already_managed'] as const).map((k) => (
              <Badge key={k} variant={CLASS_VARIANT[k]} className="tabular-nums">
                {t(`taskAllocAdmin.conv.class.${k}`)}: {data.counts[k] ?? 0}
              </Badge>
            ))}
          </div>
        )}
        {data && !data.declared_groups_supported && <p className="text-xs text-muted-foreground">{t('taskAllocAdmin.conv.noDeclared')}</p>}
      </Card>

      {cands.isError && (
        <Alert variant="destructive">
          <AlertTitle>{t('taskAllocAdmin.loadFailed')}</AlertTitle>
          <AlertDescription>{adminErrorText(cands.error, '')}</AlertDescription>
        </Alert>
      )}
      {cands.isLoading && (
        <div className="flex items-center justify-center py-6">
          <Loader2 className="h-5 w-5 animate-spin text-primary" />
        </div>
      )}
      {data && data.groups.length === 0 && <p className="py-2 text-sm text-muted-foreground" data-testid="conv-none">{t('taskAllocAdmin.conv.none')}</p>}
      <div className="grid gap-3 lg:grid-cols-2">
        {data?.groups.map((g) => (
          <CandidateCard key={g.key} group={g} onOpen={() => setOpen(g)} />
        ))}
      </div>
      {data?.truncated && <p className="text-xs text-muted-foreground">{t('taskAllocAdmin.conv.truncated')}</p>}

      <Card className="space-y-2 p-4">
        <h3 className="text-sm font-semibold">{t('taskAllocAdmin.conv.historyTitle')}</h3>
        <ResponsiveTable<ConversionRow>
          rows={history.data?.conversions ?? []}
          rowKey={(r) => r.id}
          empty={<p className="py-3 text-sm text-muted-foreground">{t('taskAllocAdmin.empty')}</p>}
          columns={[
            { id: 'at', header: t('taskAllocAdmin.col.time'), cell: (r) => <span className="tabular-nums">{dateTime(r.created_at)}</span> },
            { id: 'root', header: t('taskAllocAdmin.conv.root'), cell: (r) => `#${r.root_task_id}` },
            { id: 'ev', header: t('taskAllocAdmin.conv.col.evidence'), cell: (r) => t(`taskAllocAdmin.conv.evidence.${r.evidence}`), hideOnMobile: true },
            { id: 'status', header: t('taskAllocAdmin.col.status'), cell: (r) => <Badge variant={r.status === 'applied' ? 'default' : 'secondary'}>{t(`taskAllocAdmin.conv.status.${r.status}`)}</Badge> },
            { id: 'reason', header: t('taskAllocAdmin.reason'), cell: (r) => r.reason ?? '—', hideOnMobile: true },
            {
              id: 'act',
              header: '',
              align: 'right',
              cell: (r) =>
                isAdmin && r.status === 'applied' ? (
                  <Button type="button" size="sm" variant="outline" onClick={() => setRevert(r)} data-testid="conv-revert">
                    <Undo2 aria-hidden />
                    {t('taskAllocAdmin.conv.revertGo')}
                  </Button>
                ) : null,
            },
          ]}
        />
      </Card>

      {open && <ConversionDialog group={open} isAdmin={isAdmin} onClose={() => setOpen(null)} />}
      {revert && <RevertDialog row={revert} onClose={() => setRevert(null)} />}
    </div>
  );
}

export default ConversionTab;
