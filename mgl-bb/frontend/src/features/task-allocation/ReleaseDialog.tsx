/* Үлдсэн ажлаа БУЦААХ / ШИЛЖҮҮЛЭХ (2026-10-02).
 *
 *   • Миний ирээдүйн ажил (T − D) чөлөөлөгдөнө — өөр оролцогчид шилжүүлж болно, эсвэл чөлөөт ажилд орно.
 *   • Миний ХИЙСЭН хэсэг (D) ХЭЗЭЭ Ч бусдад шилжихгүй: би түүхтэй оролцогч хэвээр, оноо, цаг хөндөгдөхгүй.
 *   • Энэ таск дээр явж буй миний цаг зогсоно (ирээдүйн ажилгүй болсон тул).
 *   • Дараа нь дахин авах боломжтой (чөлөөт ажил байвал) — хийсэн хэмжээнээс үргэлжилнэ, тэгээс эхлэхгүй. */
import { useState } from 'react';
import { Loader2 } from 'lucide-react';

import { Button } from '@/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/ui/dialog';
import { toast } from '@/shared/components/Toast';
import { useAuth } from '@/shared/context/AuthContext';
import { useLanguage } from '@/shared/i18n';

import { postRelease, toFailure } from './api';
import { useAllocationOverview, useNameMap } from './hooks';
import { invalidateAfterProgress } from './ownProgressStore';
import { useAttempt } from './useAttempt';
import { formatUnits } from './units';

const POOL = 'pool';

export function ReleaseDialog({
  task,
  onClose,
}: {
  task: { id: number; name: string };
  onClose: () => void;
}) {
  const { t } = useLanguage();
  const { user } = useAuth();
  const overview = useAllocationOverview(task.id);
  const data = overview.data;
  const names = useNameMap(data?.task.project_id ?? null);
  const attempt = useAttempt();
  const [to, setTo] = useState<string>(POOL);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const me = data?.me ?? null;
  const root = data?.root ?? null;
  const others = (root?.participants ?? []).filter((p) => p.user_id !== user?.id && p.future_units > 0);
  const ready = !!me && !!root && me.future_units > 0;

  const submit = async () => {
    if (!root || !me) return;
    const toUserId = to === POOL ? null : Number(to);
    setBusy(true);
    setError(null);
    try {
      const id = attempt(JSON.stringify([root.revision, toUserId]));
      const res = await postRelease(task.id, { requestId: id, expectedRevision: root.revision }, toUserId);
      invalidateAfterProgress();
      toast.success(
        toUserId === null
          ? t('taskAlloc.release.donePool', { x: formatUnits(res.released_units) })
          : t('taskAlloc.release.doneTransfer', {
              x: formatUnits(res.released_units),
              name: names.get(toUserId) ?? `#${toUserId}`,
            }),
      );
      onClose();
    } catch (err) {
      const f = toFailure(err);
      setError(f.code === 'STALE_REVISION' ? t('taskAlloc.editor.srv.stale') : f.message || t('taskAlloc.err.generic'));
      if (f.code === 'STALE_REVISION') void overview.refetch();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className="sm:max-w-md" onClick={(e) => e.stopPropagation()}>
        <DialogHeader>
          <DialogTitle>{t('taskAlloc.release.title')}</DialogTitle>
          <DialogDescription>{task.name}</DialogDescription>
        </DialogHeader>
        {!data ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
          </div>
        ) : !ready || !me ? (
          <p className="py-2 text-sm text-muted-foreground" data-testid="release-nothing">
            {t('taskAlloc.release.nothing')}
          </p>
        ) : (
          <div className="space-y-3 text-sm">
            <p data-testid="release-summary">
              {t('taskAlloc.release.summary', {
                future: formatUnits(me.future_units),
                done: formatUnits(me.done_units),
              })}
            </p>
            <ul className="list-disc space-y-1 pl-5 text-xs text-muted-foreground">
              <li>{t('taskAlloc.release.keepsDone')}</li>
              <li>{t('taskAlloc.release.stopsTimer')}</li>
              <li>{t('taskAlloc.release.canRetake')}</li>
            </ul>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-foreground">{t('taskAlloc.release.toLabel')}</label>
              <Select value={to} onValueChange={setTo} disabled={busy}>
                <SelectTrigger className="w-full" data-testid="release-to">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={POOL}>{t('taskAlloc.release.toPool')}</SelectItem>
                  {others.map((p) => (
                    <SelectItem key={p.user_id} value={String(p.user_id)}>
                      {t('taskAlloc.release.toPerson', { name: names.get(p.user_id) ?? `#${p.user_id}` })}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {error && (
              <p className="text-xs text-destructive" role="alert">
                {error}
              </p>
            )}
          </div>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            {t('common.cancel')}
          </Button>
          <Button onClick={() => void submit()} disabled={busy || !ready} data-testid="release-confirm">
            {busy && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
            {t('taskAlloc.release.confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default ReleaseDialog;
