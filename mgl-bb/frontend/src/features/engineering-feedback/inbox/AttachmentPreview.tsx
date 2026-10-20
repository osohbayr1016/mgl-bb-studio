/**
 * Хувийн хавсралтыг (reviewer) харах / татах.  Байт нь ХУВИЙН bucket-аас authed route-аар (`apiFetchBlob`) ирж
 * `blob:` URL болно — `/media/` холбоос хэзээ ч үгүй.  Cross-origin isolation (COEP credentialless)-ийн улмаас
 * PDF-ийг HTTP-ээр iframe-д ачаалахад Chrome-ийн үзүүлэгч ажилладаггүй, blob-оор ажилладаг (CLAUDE.md).
 * Бичвэр (`.txt/.log/.json`) нь `<pre>`-д ТЕКСТ болж орно — HTML болж хэзээ ч рендерлэгдэхгүй.
 */
import { useEffect, useState } from 'react';
import { Download, Loader2 } from 'lucide-react';
import { useLanguage } from '@/shared/i18n';
import { toast } from '@/shared/components/Toast';
import { Button } from '@/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/ui/dialog';
import { fetchAttachmentBlob, type EfReviewerAttachment } from '../api';
import { formatBytes } from '../labels';
import { errorText } from '../upload';
import { downloadAttachment } from './download';

const TEXT_PREVIEW_MAX = 512 * 1024;

export function AttachmentPreviewDialog({
  requestId,
  attachment,
  onClose,
}: {
  requestId: string;
  attachment: EfReviewerAttachment | null;
  onClose: () => void;
}) {
  const { t } = useLanguage();
  const [url, setUrl] = useState<string | null>(null);
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    if (!attachment || !attachment.preview) return undefined;
    let cancelled = false;
    let made: string | null = null;
    setUrl(null);
    setText(null);
    setError(null);
    setProgress(0);
    fetchAttachmentBlob(requestId, attachment.id, true, (loaded, total) => {
      if (!cancelled && total) setProgress(Math.round((loaded / total) * 100));
    })
      .then(async (blob) => {
        if (cancelled) return;
        if (attachment.preview === 'text') {
          const raw = await blob.slice(0, TEXT_PREVIEW_MAX).text();
          if (!cancelled) setText(blob.size > TEXT_PREVIEW_MAX ? `${raw}\n…` : raw);
          return;
        }
        made = URL.createObjectURL(blob);
        setUrl(made);
      })
      .catch((err) => {
        if (!cancelled) setError(errorText(err, t('engFeedback.previewFailed')));
      })
      .finally(() => {
        if (!cancelled) setProgress(null);
      });
    return () => {
      cancelled = true;
      if (made) URL.revokeObjectURL(made);
    };
  }, [attachment, requestId, t]);

  const download = async () => {
    if (!attachment) return;
    setDownloading(true);
    try {
      await downloadAttachment(requestId, attachment);
    } catch (err) {
      toast.error(t('engFeedback.downloadFailed'), errorText(err, ''));
    } finally {
      setDownloading(false);
    }
  };

  return (
    <Dialog open={!!attachment} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle className="break-all pr-8">{attachment?.name}</DialogTitle>
          <DialogDescription>
            {attachment ? `${formatBytes(attachment.size)} · ${attachment.extension.toUpperCase()}` : ''}
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-[12rem]" data-testid="ef-preview">
          {progress !== null && (
            <div className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              {t('engFeedback.loadingPreview', { pct: progress })}
            </div>
          )}
          {error && <p className="py-6 text-sm text-destructive-ink">{error}</p>}
          {url && attachment?.preview === 'image' && (
            <img src={url} alt={attachment.name} className="mx-auto max-h-[70vh] max-w-full rounded-md border border-border object-contain" />
          )}
          {url && attachment?.preview === 'pdf' && (
            <iframe src={url} title={attachment.name} className="h-[70vh] w-full rounded-md border border-border" />
          )}
          {text !== null && (
            <pre className="max-h-[70vh] overflow-auto whitespace-pre-wrap break-words rounded-md border border-border bg-muted p-3 text-xs">{text}</pre>
          )}
          {attachment && !attachment.preview && (
            <p className="py-6 text-sm text-muted-foreground">{t('engFeedback.noPreview')}</p>
          )}
        </div>
        <div className="flex justify-end">
          <Button variant="outline" onClick={() => void download()} disabled={downloading}>
            {downloading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Download className="h-4 w-4" aria-hidden />}
            {t('engFeedback.download')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
