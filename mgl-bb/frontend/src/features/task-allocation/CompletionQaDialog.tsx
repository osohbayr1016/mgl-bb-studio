/* Дуусгах асуулт — НЭГ цонх, ХОЁР хүрээ (2026-10-02).
 *
 * Өөрийн хэсэг зорилтод хүрэх (`own`) ЭСВЭЛ үндсэн ажил 100% болох (`root`) үед — хоёулаа нэг дор болж болно —
 * ноорог хадгалагдахаас ӨМНӨ нэг л удаа асуулт асууна.  Хариулт нь тайлан болж хадгалагдана (AI хураангуйн эх).
 * «Болих» нь зорилтод хүргэсэн өөрчлөлтийг л буцаана — өмнөх ноорог хэвээр. */
import { useState } from 'react';
import { CheckCircle2, Loader2, Sparkles } from 'lucide-react';

import { Button } from '@/ui/button';
import { Textarea } from '@/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/ui/dialog';
import { useLanguage } from '@/shared/i18n';

import { formatUnits } from './units';
import type { QaQuestion } from './types';

export function CompletionQaDialog({
  taskName,
  targetUnits,
  scopes,
  questions,
  busy = false,
  onConfirm,
  onCancel,
}: {
  taskName: string;
  /** Миний нийт зорилт (нэгжээр) — «өөрийн хэсгээ (5%)» мөрөнд. */
  targetUnits: number;
  scopes: { own: boolean; root: boolean };
  questions: QaQuestion[];
  busy?: boolean;
  onConfirm: (answers: Record<string, string>) => void;
  onCancel: () => void;
}) {
  const { t } = useLanguage();
  const [answers, setAnswers] = useState<Record<string, string>>(() =>
    Object.fromEntries(questions.map((q) => [q.id, ''])),
  );
  const [showMissing, setShowMissing] = useState(false);
  const missing = questions.filter((q) => !(answers[q.id] ?? '').trim());

  const submit = () => {
    if (missing.length > 0) {
      setShowMissing(true);
      return;
    }
    onConfirm(answers);
  };

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onCancel()}>
      <DialogContent className="sm:max-w-lg" onClick={(e) => e.stopPropagation()}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-success" />
            {t('taskAlloc.qa.title')}
          </DialogTitle>
          <DialogDescription className="sr-only">{t('taskAlloc.qa.sr')}</DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <p className="text-sm font-medium text-foreground">{taskName}</p>
          <ul className="space-y-1.5 text-sm" data-testid="qa-scopes">
            {scopes.own && (
              <li className="flex items-start gap-2" data-testid="qa-scope-own">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" />
                <span>{t('taskAlloc.qa.scopeOwn', { target: formatUnits(targetUnits) })}</span>
              </li>
            )}
            {scopes.root && (
              <li className="flex items-start gap-2" data-testid="qa-scope-root">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" />
                <span>{t('taskAlloc.qa.scopeRoot')}</span>
              </li>
            )}
          </ul>
          <p className="text-xs text-muted-foreground">{t('taskAlloc.qa.instruction')}</p>

          <div className="max-h-[48vh] space-y-3 overflow-y-auto pr-1">
            {questions.map((q) => {
              const empty = showMissing && !(answers[q.id] ?? '').trim();
              return (
                <div key={q.id} className="space-y-1.5">
                  <label htmlFor={`qa-${q.id}`} className="text-xs font-medium text-foreground">
                    {q.text}
                  </label>
                  <Textarea
                    id={`qa-${q.id}`}
                    value={answers[q.id] ?? ''}
                    onChange={(e) => setAnswers((prev) => ({ ...prev, [q.id]: e.target.value }))}
                    rows={3}
                    className={empty ? 'border-destructive text-sm' : 'text-sm'}
                    placeholder={t('taskAlloc.qa.placeholder')}
                    disabled={busy}
                  />
                </div>
              );
            })}
          </div>
          {showMissing && missing.length > 0 && (
            <p className="text-xs text-destructive">{t('taskAlloc.qa.answerAll', { count: missing.length })}</p>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onCancel} disabled={busy} data-testid="qa-cancel">
            {t('taskAlloc.qa.cancel')}
          </Button>
          <Button onClick={submit} disabled={busy} data-testid="qa-confirm">
            {busy && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
            {t('taskAlloc.qa.confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default CompletionQaDialog;
