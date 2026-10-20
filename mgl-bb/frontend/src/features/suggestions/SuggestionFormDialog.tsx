/**
 * Шинэ санал хүсэлт илгээх dialog — гарчиг + тайлбар + зураг + «Нэрээ нууцлах».
 * MyLeavesCard-ийн LeaveRequestDialog-ийн хялбаршуулсан хувилбар.
 *
 * Зураг нь илгээхээс ӨМНӨ R2 руу байршиж, энд зөвхөн `/media/<key>`
 * лавлагаа хадгалагдана (`SuggestionImagesField`-ийг үз).  Тиймээс dialog-ыг
 * хаахад аль хэдийн байршсан зураг R2-д өнчин үлдэж болно — өгөгдлийн
 * бүрэн бүтэн байдалд нөлөөлөхгүй, репо даяарх бусад хавсралттай ижил зан.
 */
import { useEffect, useState } from 'react';
import { apiFetch } from '@/shared/api/client';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import { Label } from '@/ui/label';
import { Textarea } from '@/ui/textarea';
import { Checkbox } from '@/ui/checkbox';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/ui/dialog';
import { Lightbulb, AlertCircle, Loader2, Send } from 'lucide-react';
import { useLanguage } from '@/shared/i18n';
import type { SuggestionImage } from '@/shared/types';
import { SuggestionImagesField } from '@/features/suggestions/SuggestionImagesField';

export function SuggestionFormDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const { t } = useLanguage();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [anonymous, setAnonymous] = useState(false);
  const [images, setImages] = useState<SuggestionImage[]>([]);
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setTitle('');
      setDescription('');
      setAnonymous(false);
      setImages([]);
      setUploading(false);
      setError(null);
    }
  }, [open]);

  const submit = async () => {
    if (!title.trim()) {
      setError(t('suggestionsPage.errTitle'));
      return;
    }
    if (!description.trim()) {
      setError(t('suggestionsPage.errDescription'));
      return;
    }
    // Байршиж дуусаагүй зураг байвал хүлээнэ — эс бөгөөс тэр зураг
    // хавсралтгүйгээр илгээгдэж, R2-д өнчин үлдэнэ.
    if (uploading) {
      setError(t('suggestionsPage.imageWait'));
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await apiFetch('/suggestions', {
        data: {
          title: title.trim(),
          description: description.trim(),
          is_anonymous: anonymous,
          images,
        },
      });
      onCreated();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('suggestionsPage.submitFailed'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Lightbulb className="h-5 w-5 text-primary" />
            {t('suggestionsPage.dialogTitle')}
          </DialogTitle>
        </DialogHeader>

        {/* Зураг нэмэгдэхэд өндөр нь ургадаг тул бага дэлгэцэнд гүйлгэнэ. */}
        <div className="max-h-[65vh] space-y-4 overflow-y-auto py-2 pr-0.5">
          {error && (
            <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-destructive/10 border border-destructive/30 text-destructive text-sm">
              <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" /> {error}
            </div>
          )}

          <div className="space-y-1.5">
            <Label className="text-xs">
              {t('suggestionsPage.titleLabel')} <span className="text-destructive">*</span>
            </Label>
            <Input
              value={title}
              maxLength={200}
              placeholder={t('suggestionsPage.titlePlaceholder')}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">
              {t('suggestionsPage.descriptionLabel')} <span className="text-destructive">*</span>
            </Label>
            <Textarea
              rows={5}
              maxLength={4000}
              placeholder={t('suggestionsPage.descriptionPlaceholder')}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          <SuggestionImagesField
            images={images}
            onChange={setImages}
            onBusyChange={setUploading}
            disabled={submitting}
          />

          <div className="rounded-lg border border-border/60 bg-muted/30 px-3 py-2.5 space-y-1.5">
            <label className="flex items-center gap-2.5 cursor-pointer">
              <Checkbox
                checked={anonymous}
                onCheckedChange={(v) => setAnonymous(v === true)}
              />
              <span className="text-sm font-medium">{t('suggestionsPage.anonymousLabel')}</span>
            </label>
            <p className="text-micro text-muted-foreground pl-[26px]">
              {t('suggestionsPage.anonymousHint')}
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={submitting}>
            {t('common.cancel')}
          </Button>
          <Button onClick={submit} disabled={submitting || uploading}>
            {submitting ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
                {t('suggestionsPage.submitting')}
              </>
            ) : (
              <>
                <Send className="h-3.5 w-3.5 mr-1.5" />
                {t('suggestionsPage.submit')}
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
