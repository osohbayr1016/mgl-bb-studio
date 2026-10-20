import { useState } from 'react';
import { Check, Loader2, Undo2 } from 'lucide-react';
import { useLanguage } from '@/shared/i18n';
import { Button } from '@/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/ui/dialog';
import { Textarea } from '@/ui/textarea';

/**
 * Батлагчийн үйлдлийн мөр.  Зөвхөн `submitted` тайлан дээр,
 * `can_review` эрхтэй хүнд харагдана.
 *
 * «Буцаах» дээр шалтгаан ЗААВАЛ — сервер ч гэсэн хоосон шалтгааныг
 * 400-аар няцаадаг, энд зөвхөн тэр дүрмийг тольдож байна.
 */
export function AsrReviewBar({
  busy,
  onApprove,
  onReject,
}: {
  busy: boolean;
  onApprove: () => void;
  onReject: (note: string) => void;
}) {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  const submitReject = () => {
    const trimmed = note.trim();
    if (!trimmed) {
      setError(t('asr.rejectNoteRequired'));
      return;
    }
    setOpen(false);
    setNote('');
    setError(null);
    onReject(trimmed);
  };

  return (
    <>
      <div className="flex gap-2">
        <Button
          type="button"
          variant="outline"
          className="flex-1 gap-2"
          disabled={busy}
          onClick={() => setOpen(true)}
        >
          <Undo2 className="h-4 w-4" /> {t('asr.reject')}
        </Button>
        <Button type="button" className="flex-1 gap-2" disabled={busy} onClick={onApprove}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
          {t('asr.approve')}
        </Button>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t('asr.rejectTitle')}</DialogTitle>
          </DialogHeader>
          <Textarea
            rows={4}
            autoFocus
            placeholder={t('asr.rejectNote')}
            value={note}
            onChange={(e) => {
              setNote(e.target.value);
              if (error) setError(null);
            }}
          />
          {error && <p className="text-xs text-danger">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="button" variant="destructive" onClick={submitReject}>
              {t('asr.reject')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
