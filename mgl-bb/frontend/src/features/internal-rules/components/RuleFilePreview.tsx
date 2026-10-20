import { lazy, Suspense, useEffect, useState } from 'react';
import { Download, FileText, Loader2 } from 'lucide-react';

import { useLanguage } from '@/shared/i18n';
import { toast } from '@/shared/components/Toast';
import { cn } from '@/shared/lib/utils';
import { Button } from '@/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/ui/dialog';

import { formatFileSize, ruleFileKind, saveBlob } from '../lib/ruleFiles';

// Word/Excel-ийн хөтөч дээрх рендерлэгч — Drive-ийн preview-тэй ИЖИЛ (lazy, ~1 MB).
const DocxPreview = lazy(() => import('@/features/projects/drive/preview/DocxPreview'));
const XlsxPreview = lazy(() => import('@/features/projects/drive/preview/XlsxPreview'));

/**
 * Дотоод журмын хавсралтыг хуудсан дотор харуулна.
 *
 * Файл нь ХУВИЙН bucket-д тул `load()` нь authed blob татна (эсвэл админы
 * дөнгөж байршуулсан локал `File`).  PDF-ийг ЗААВАЛ `blob:` iframe-ээр — манай
 * origin cross-origin isolated (COEP), HTTP-ээр ачаалсан PDF iframe дотор
 * Chrome-ийн үзүүлэгч ажиллахгүй (`features/email/components/AttachmentPreviews.tsx`).
 * Word/Excel нь Drive-ийн `DocxPreview`/`XlsxPreview`-г дахин ашиглана.
 */
export function RuleFilePreview({
  name,
  contentType,
  load,
  className,
}: {
  name: string;
  contentType: string;
  load: () => Promise<Blob>;
  className?: string;
}) {
  const { t } = useLanguage();
  const kind = ruleFileKind(name, contentType);
  const [state, setState] = useState<
    { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; blob: Blob; url: string; text?: string }
  >({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    let url: string | null = null;
    // Анхны төлөв 'loading'; өөр файл руу шилжихэд эцэг `key`-ээр дахин
    // mount хийнэ — effect дотор синхрон setState хэрэггүй.
    void (async () => {
      try {
        const raw = await load();
        // Локал File-ийн төрөл хоосон байж болно — PDF iframe-д төрөл заавал.
        const blob = kind === 'pdf' && raw.type !== 'application/pdf' ? new Blob([raw], { type: 'application/pdf' }) : raw;
        const text = kind === 'text' ? await blob.text() : undefined;
        if (cancelled) return;
        url = URL.createObjectURL(blob);
        setState({ status: 'ready', blob, url, text });
      } catch (err) {
        if (!cancelled) setState({ status: 'error', message: err instanceof Error ? err.message : String(err) });
      }
    })();
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
    // `load` нь эцгийн inline функц — файл өөрчлөгдөхөд л дахин татна.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name, contentType, kind]);

  const frame = cn('h-[75vh] w-full overflow-hidden rounded-md border border-border bg-muted/30', className);

  if (state.status === 'loading') {
    return (
      <div className={cn(frame, 'flex items-center justify-center')}>
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-hidden />
      </div>
    );
  }
  if (state.status === 'error') {
    return (
      <div className={cn(frame, 'flex items-center justify-center p-6 text-center text-sm text-destructive')}>
        {t('rules.files.loadFailed')} — {state.message}
      </div>
    );
  }

  if (kind === 'pdf') {
    return <iframe src={state.url} title={name} className={frame} data-testid="rule-file-pdf" />;
  }
  if (kind === 'image') {
    return (
      <div className={cn(frame, 'flex items-center justify-center overflow-auto p-2')}>
        <img src={state.url} alt={name} className="max-h-full max-w-full object-contain" />
      </div>
    );
  }
  if (kind === 'docx' || kind === 'xlsx') {
    return (
      <div className={frame} data-testid={`rule-file-${kind}`}>
        <Suspense
          fallback={
            <div className="flex h-full items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-hidden />
            </div>
          }
        >
          {kind === 'docx' ? <DocxPreview blob={state.blob} name={name} /> : <XlsxPreview blob={state.blob} name={name} />}
        </Suspense>
      </div>
    );
  }
  if (kind === 'text') {
    return (
      <pre className={cn(frame, 'overflow-auto whitespace-pre-wrap p-4 font-mono text-xs text-foreground')}>{state.text}</pre>
    );
  }
  return (
    <div className={cn(frame, 'flex h-auto flex-col items-center justify-center gap-3 p-8 text-center text-sm text-muted-foreground')}>
      <FileText className="h-8 w-8" aria-hidden />
      {t('rules.files.noPreview')}
      <Button size="sm" variant="outline" onClick={() => saveBlob(state.blob, name)}>
        <Download className="mr-1.5 h-4 w-4" aria-hidden />
        {t('rules.files.download')}
      </Button>
    </div>
  );
}

/** Хавсралтыг том цонхонд — толгойд нэр, хэмжээ, «Татах». */
export function RuleFilePreviewDialog({
  file,
  load,
  onOpenChange,
}: {
  file: { id: string; name: string; content_type: string; size: number } | null;
  load: () => Promise<Blob>;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useLanguage();
  const [downloading, setDownloading] = useState(false);
  const download = async () => {
    if (!file) return;
    setDownloading(true);
    try {
      saveBlob(await load(), file.name);
    } catch (err) {
      toast.error(t('rules.files.loadFailed'), err instanceof Error ? err.message : undefined);
    } finally {
      setDownloading(false);
    }
  };
  return (
    <Dialog open={file !== null} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[95vh] flex-col gap-3 sm:max-w-5xl">
        <DialogHeader className="flex-row items-center justify-between gap-3 space-y-0 pr-8">
          <div className="min-w-0">
            <DialogTitle className="truncate text-section">{file?.name}</DialogTitle>
            <DialogDescription className="text-micro">{file ? formatFileSize(file.size) : ''}</DialogDescription>
          </div>
          <Button size="sm" variant="outline" onClick={() => void download()} disabled={downloading}>
            {downloading ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden /> : <Download className="mr-1.5 h-4 w-4" aria-hidden />}
            {t('rules.files.download')}
          </Button>
        </DialogHeader>
        {file && <RuleFilePreview key={file.id} name={file.name} contentType={file.content_type} load={load} />}
      </DialogContent>
    </Dialog>
  );
}
