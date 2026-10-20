/* ХУВААЛТЫГ ЦУЦЛАХ — таскийг «огт хуваагаагүй, юу ч хийгээгүй» анхны байдалд буцаах (эзэн 2026-10-06).
 *
 *   • 26.1, 26.2 … хуваарилалт бүгд арилж, таск нэг мөр болно;
 *   • хуваалтаас хойш оруулсан хувь, түүнээс олгосон оноо УСТАНА — хуваахаас ӨМНӨХ хувь, оноо хэвээр;
 *   • явж буй цаг зогсоно, цагийн бүртгэл устахгүй (зөвхөн хуваалтаас хойш оролцсон хүмүүсийн цаг таск дээр нуугдана).
 * Шийдвэр, эрх серверт (`POST /tasks/:id/allocation/unsplit`). */
import { useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';

import { Button } from '@/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/ui/dialog';
import { toast } from '@/shared/components/Toast';
import { useLanguage } from '@/shared/i18n';

import { newRequestId, postUnsplit, toFailure } from './api';
import { invalidateAfterProgress } from './ownProgressStore';

export function UnsplitDialog({
  task,
  onClose,
}: {
  task: { id: number; name: string };
  onClose: () => void;
}) {
  const { t } = useLanguage();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Сүлжээний давталт ижил request_id-тай (сервер идемпотент).
  const requestId = useRef(newRequestId());

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await postUnsplit(task.id, requestId.current);
      invalidateAfterProgress();
      toast.success(
        t('taskAlloc.unsplit.done', { name: task.name }),
        t('taskAlloc.unsplit.doneHint', { pct: Math.round(res.progress_after * 100) / 100 }),
      );
      onClose();
    } catch (err) {
      const f = toFailure(err);
      setError(f.message || t('taskAlloc.err.generic'));
      // Серверийн шийдвэр гарсан (403/409) — дахин дарахад шинэ хүсэлт.
      if (!f.network) requestId.current = newRequestId();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className="sm:max-w-md" onClick={(e) => e.stopPropagation()}>
        <DialogHeader>
          <DialogTitle>{t('taskAlloc.unsplit.title')}</DialogTitle>
          <DialogDescription>{task.name}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <p>{t('taskAlloc.unsplit.summary')}</p>
          <ul className="list-disc space-y-1 pl-5 text-xs text-muted-foreground">
            <li>{t('taskAlloc.unsplit.removesRows')}</li>
            <li>{t('taskAlloc.unsplit.removesProgress')}</li>
            <li>{t('taskAlloc.unsplit.keepsOld')}</li>
            <li>{t('taskAlloc.unsplit.stopsTimer')}</li>
          </ul>
          {error && (
            <p className="text-xs text-destructive" role="alert" data-testid="unsplit-error">
              {error}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            {t('common.cancel')}
          </Button>
          <Button variant="destructive" onClick={() => void submit()} disabled={busy} data-testid="unsplit-confirm">
            {busy && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
            {t('taskAlloc.unsplit.confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default UnsplitDialog;
