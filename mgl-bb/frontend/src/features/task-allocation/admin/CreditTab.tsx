/* Жин/төвөгшлийн өөрчлөлтийн дараах оноо тулгалт (2026-10-05).  Managed таскийн оноо ЖУРНАЛААС одоогийн коэффициентээр дахин
 * тулгагдана (хуучин replay БИШ).  Ихэвчлэн жин засах үед АВТОМАТААР хийгддэг — энэ нь автомат тулгалт алдсан үед гараар
 * ажиллуулах зам: эхлээд ТӨЛӨВЛӨГӨӨ (юу ч бичихгүй), дараа нь хэрэгжүүлнэ (зөрүүгүй бол юу ч бичихгүй). */
import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Loader2, Scale } from 'lucide-react';

import { Alert, AlertDescription, AlertTitle } from '@/ui/alert';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/ui/alert-dialog';
import { Button } from '@/ui/button';
import { Card } from '@/ui/card';
import { Input } from '@/ui/input';
import { ResponsiveTable } from '@/ui/responsive-table';
import { toast } from '@/shared/components/Toast';
import { useLanguage } from '@/shared/i18n';

import { invalidateAfterProgress } from '../ownProgressStore';
import { adminErrorText, applyReweight, fetchReweightPreview, type ReweightPreview } from './adminApi';

type Scope = { taskId?: number; projectId?: number };

export function CreditTab({ canWrite }: { canWrite: boolean }) {
  const { t } = useLanguage();
  const [kind, setKind] = useState<'project' | 'task'>('project');
  const [raw, setRaw] = useState('');
  // Урьдчилан харсан хүрээг preview-тэй НЭГ дор хадгална: Apply нь ЗААВАЛ харсан хүрээгээ (одоогийн талбарыг БИШ) хэрэгжүүлнэ,
  // хүрээ өөрчлөгдсөн бол preview нуугдана — өөр id-г харж байгаад А-г хэрэгжүүлэх боломжгүй.
  const [shown, setShown] = useState<{ data: ReweightPreview; scope: Scope } | null>(null);
  const [confirm, setConfirm] = useState(false);
  const id = /^[0-9]+$/.test(raw.trim()) ? Number(raw.trim()) : null;
  const scope: Scope | null = id === null ? null : kind === 'task' ? { taskId: id } : { projectId: id };
  const scopeKey = scope === null ? '' : JSON.stringify(scope);
  const preview = shown && JSON.stringify(shown.scope) === scopeKey ? shown : null;
  const scopeLabel = preview
    ? preview.scope.taskId
      ? t('taskAllocAdmin.credit.task') + ' #' + String(preview.scope.taskId)
      : t('taskAllocAdmin.credit.project') + ' #' + String(preview.scope.projectId)
    : '';

  const check = useMutation({
    mutationFn: (s: Scope) => fetchReweightPreview(s),
    onSuccess: (data, s) => setShown({ data, scope: s }),
  });
  const apply = useMutation({
    mutationFn: (s: Scope) => applyReweight(s),
    onSuccess: () => {
      toast.success(t('taskAllocAdmin.credit.applied'));
      setShown(null);
      setConfirm(false);
      invalidateAfterProgress();
    },
    onError: (err) => {
      setConfirm(false);
      toast.error(t('taskAllocAdmin.credit.failed'), adminErrorText(err, ''));
    },
  });

  return (
    <div className="space-y-4" data-testid="alloc-admin-credit">
      <Card className="space-y-3 p-4">
        <p className="text-sm text-muted-foreground">{t('taskAllocAdmin.credit.intro')}</p>
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex gap-2" role="group" aria-label={t('taskAllocAdmin.credit.scope')}>
            {(['project', 'task'] as const).map((k) => (
              <Button key={k} type="button" size="sm" variant={kind === k ? 'default' : 'outline'} aria-pressed={kind === k} onClick={() => setKind(k)}>
                {t(`taskAllocAdmin.credit.${k}`)}
              </Button>
            ))}
          </div>
          <div className="space-y-1.5">
            <label htmlFor="credit-id" className="block text-xs font-medium">
              {t('taskAllocAdmin.credit.id')}
            </label>
            <Input id="credit-id" inputMode="numeric" value={raw} onChange={(e) => setRaw(e.target.value)} className="w-36" data-testid="credit-id" />
          </div>
          <Button type="button" onClick={() => scope && check.mutate(scope)} disabled={scope === null || check.isPending} data-testid="credit-preview">
            {check.isPending ? <Loader2 className="animate-spin" aria-hidden /> : <Scale aria-hidden />}
            {t('taskAllocAdmin.credit.preview')}
          </Button>
        </div>
      </Card>
      {check.isError && (
        <Alert variant="destructive">
          <AlertTitle>{t('taskAllocAdmin.credit.failed')}</AlertTitle>
          <AlertDescription>{adminErrorText(check.error, '')}</AlertDescription>
        </Alert>
      )}
      {preview && (
        <Card className="space-y-3 p-4" data-testid="credit-result">
          <p className="text-sm font-medium">{t('taskAllocAdmin.credit.summary', { tasks: String(preview.data.tasks), drifting: String(preview.data.drifting) })}</p>
          {preview.data.truncated && <p className="text-xs text-muted-foreground">{t('taskAllocAdmin.credit.truncated')}</p>}
          {preview.data.drifting === 0 ? (
            <p className="text-sm text-muted-foreground">{t('taskAllocAdmin.credit.none')}</p>
          ) : (
            <>
              <ResponsiveTable
                rows={preview.data.previews}
                rowKey={(p) => p.task_id}
                columns={[
                  { id: 'task', header: t('taskAllocAdmin.col.task'), cell: (p) => `#${p.task_id}` },
                  { id: 'slices', header: t('taskAllocAdmin.credit.slices'), align: 'right', cell: (p) => p.items },
                  { id: 'amount', header: t('taskAllocAdmin.credit.amountDelta'), align: 'right', cell: (p) => <span className="tabular-nums">{p.totals.amountDelta.toFixed(4)}</span> },
                ]}
              />
              <div className="flex justify-end">
                <Button type="button" onClick={() => setConfirm(true)} disabled={!canWrite || apply.isPending || preview.data.truncated} data-testid="credit-apply">
                  {apply.isPending && <Loader2 className="animate-spin" aria-hidden />}
                  {canWrite ? t('taskAllocAdmin.credit.apply') : t('taskAllocAdmin.adminOnly')}
                </Button>
              </div>
            </>
          )}
        </Card>
      )}
      <AlertDialog open={confirm && !!preview} onOpenChange={(o) => !o && !apply.isPending && setConfirm(false)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('taskAllocAdmin.credit.confirmTitle')}</AlertDialogTitle>
            <AlertDialogDescription>{t('taskAllocAdmin.credit.confirmBody', { scope: scopeLabel, drifting: String(preview?.data.drifting ?? 0) })}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={apply.isPending}>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              disabled={apply.isPending || !preview}
              data-testid="credit-confirm"
              onClick={(e) => {
                e.preventDefault();
                if (preview) apply.mutate(preview.scope);
              }}
            >
              {apply.isPending && <Loader2 className="animate-spin" aria-hidden />}
              {t('taskAllocAdmin.credit.confirmGo')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export default CreditTab;
