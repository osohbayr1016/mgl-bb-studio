/**
 * Drive файлыг хуудсан дотор харах цонх.  Файл Drive дээрээ ҮЛДЭНЭ — энд
 * зөвхөн серверээр дамжсан байтууд `blob:`-оор харагдана, засах бол
 * «Эх файлыг нээх» нь Google-ийн засварлагчийг ШИНЭ табанд нээнэ (§14).
 *
 * Сервер файл бүрд `preview` төлөвлөгөө өгдөг (`lib/projectDrive.ts`):
 *   pdf / google → blob: iframe (Chrome-ийн PDF үзүүлэгч; Google формат нь
 *                  Drive-аар PDF болж ЭКСПОРТЛОГДОНО, хуулбар үүсэхгүй)
 *   image        → <img>
 *   video        → <video controls> (mp4/webm; blob:)
 *   text         → <pre>
 *   docx / xlsx  → эх байтыг хөтөч дээр render (docx-preview / exceljs); .docx-ийн
 *                  navy дэвсгэр дээрх «Автомат» текстийг Word шиг цагаан болгоно
 *                  (`docxAutoText.ts` — эх файл Drive дээр ХӨНДӨГДӨХГҮЙ)
 *   thumbnail    → Drive-ын үүсгэсэн эхний хуудасны зураг (PowerPoint, .doc/.xls г.м.)
 *   none         → зөвхөн «Эх файлыг нээх» / татах
 *
 * «Эх файлыг нээх» (.docx, ажилтан): Google дээр нээхээс өмнө ИЖИЛ файлыг Word-той
 * ижил харагдахаар засна (navy бичвэр цагаан, нуусан navy хэлбэр, AGFutura → Calibri —
 * `openInGoogle.ts`, `docxGoogleReady.ts`).  «Google Docs болгох» товч 2026-09-30-нд
 * хасагдсан: дарах бүрт хавтсанд ижил нэртэй Google Doc нэмэгддэг байв.
 *
 * «Гарын үсэг» (2026-10-01, эзний хүсэлт): Word баримтад баруун талд самбар
 * (`signing/DriveSigningPanel.tsx`) — ажилтан профайлын гарын үсгээрээ нэг товчоор
 * зурж, захирал нэг товчоор батална; гарын үсэг ФАЙЛ ДЭЭР суугаад Drive-д шинэ
 * хувилбар болж зүүн талын харагдац дахин ачаалагдана.  «Хэвлэх / PDF» нь
 * `/app/drive-print/…` хуудсыг шинэ табанд нээж хөтчийн хэвлэх цонхыг дуудна.
 *
 * Татах явц: компанийн бодит тайлангууд 50–110 MB (2026-09-21) тул байт
 * бүрийг урсгалаар уншиж «{loaded} / {total}» харуулна — өмнө нь зөвхөн
 * эргэлдэгч байсан нь ажилтанд «ажиллахгүй байна» гэж ойлгогдож байв.
 *
 * ⚠️ PDF-ийг ЗААВАЛ `blob:`-оор: cross-origin isolation (COEP credentialless)
 * дор HTTP хаягаар ачаалсан PDF iframe ажилладаггүй (AttachmentPreviews.tsx).
 * Google-ийн `/preview` iframe-ийг ч ашиглаж болохгүй — credentialless
 * горимд күүкигүй ачаалагдаж хуваалцаагүй файл «нэвтрээгүй» гэж гарна.
 */
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { Download, ExternalLink, FileWarning, Link2, Loader2, PenLine, Printer, RefreshCw } from 'lucide-react';
import { Button } from '@/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/ui/dialog';
import { toast } from '@/shared/components/Toast';
import { useAuth } from '@/shared/context/AuthContext';
import { useLanguage } from '@/shared/i18n';
import { formatDateTime } from '@/shared/lib/time';
import { formatBytes } from '@/features/projects/documents/fileTypes';
import { downloadDriveFile, fetchDrivePreviewBlob, fetchDriveThumbnailBlob } from './api';
import { describeDriveError, type DriveErrorView } from './driveErrors';
import { downloadName, driveFileKind, isDocxFile } from './fileKind';
import type { DriveItem, DriveScope } from './types';
import { PreviewErrorBoundary } from './preview/PreviewErrorBoundary';
import { drivePrintUrl } from './signing/api';

// Office render-үүд том сантай (docx-preview ~1 MB, exceljs ~900 kB) тул зөвхөн
// тийм файл нээгдэхэд л ачаалагдана.
const DocxPreview = lazy(() => import('./preview/DocxPreview'));
const XlsxPreview = lazy(() => import('./preview/XlsxPreview'));
// Гарын үсгийн самбар — зөвхөн Word баримт дээр «Гарын үсэг» нээгдэхэд.
const DriveSigningPanel = lazy(() =>
  import('./signing/DriveSigningPanel').then((m) => ({ default: m.DriveSigningPanel })),
);

/** Үүнээс дээш файлд «бүтнээр татсаны дараа харагдана» гэсэн тайлбар нэмнэ. */
const LARGE_FILE_BYTES = 20 * 1024 * 1024;

/** navy текстийн засвар ZIP-ийг бүтнээр задалж дахин хийдэг (санах ой ×2) —
 *  үүнээс том .docx (зурагтай тайлан) эх байтаараа харагдана. */
const DOCX_FIX_MAX_BYTES = 80 * 1024 * 1024;

/** .docx-ийн navy дэвсгэр дээрх «Автомат» текстийг Word шиг цагаан болгоно;
 *  юу ч засах шаардлагагүй / алдвал ЭХ blob. */
async function whitenDocx(blob: Blob): Promise<Blob> {
  if (blob.size > DOCX_FIX_MAX_BYTES) return blob;
  try {
    const { fixDocxBlob } = await import('./docxAutoText');
    return (await fixDocxBlob(blob)).blob;
  } catch (err) {
    console.error('[drive-preview] docx auto-text fix failed', err);
    return blob;
  }
}

export function DriveFilePreviewDialog({
  scope,
  id,
  file,
  onClose,
  onOpenOriginal,
  signing = false,
  signingOpenInitially = false,
  onDocumentChanged,
}: {
  scope: DriveScope;
  id: number;
  file: DriveItem | null;
  onClose: () => void;
  /** «Эх файлыг нээх» — .docx-ийг Google-д бэлтгээд нээх (`openInGoogle.ts`).  Өгөөгүй
   *  бол (захиалагчийн портал) энгийн холбоос. */
  onOpenOriginal?: (item: DriveItem) => void;
  /** Word баримтад «Гарын үсэг» самбар + «Хэвлэх / PDF» (ажилтны scope). */
  signing?: boolean;
  /** Мэдэгдлийн холбоосоор (`?sign=1`) ирсэн — самбар шууд нээлттэй. */
  signingOpenInitially?: boolean;
  /** Гарын үсэг суусны дараа — жагсаалт (өөрчлөгдсөн огноо) шинэчлэгдэнэ. */
  onDocumentChanged?: () => void;
}) {
  const { t } = useLanguage();
  const open = file != null;
  const kind = file ? driveFileKind(file.mime_type, file.name) : 'other';
  const preview = file?.preview ?? 'none';

  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  // Одоогийн object URL-ын толь — дуудагч цонхыг хаахад unmount хийдэг тул
  // blob-ыг unmount дээр ч чөлөөлнө (state-ийн cleanup тэр үед ажиллахгүй).
  const blobRef = useRef<string | null>(null);
  const replaceBlob = useCallback((next: string | null) => {
    if (blobRef.current) URL.revokeObjectURL(blobRef.current);
    blobRef.current = next;
    setBlobUrl(next);
  }, []);
  useEffect(() => () => replaceBlob(null), [replaceBlob]);
  const [text, setText] = useState<string | null>(null);
  // .docx/.xlsx — эх байтуудыг хөтөч дээр render хийх тул object URL биш, Blob-оор.
  const [officeBlob, setOfficeBlob] = useState<Blob | null>(null);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState<{ loaded: number; total: number | null } | null>(null);
  const [error, setError] = useState<DriveErrorView | null>(null);
  const [downloading, setDownloading] = useState(false);
  const isDocx = file != null && file.kind === 'file' && isDocxFile(file.mime_type, file.name);
  const canSign = signing && isDocx && scope !== 'client';
  const [signOpen, setSignOpen] = useState(signingOpenInitially);
  // «Гарын үсгийн link» (DASR-ынх шиг) — ЗӨВХӨН admin; самбарыг нээж link цонхыг дуудна.
  const { user } = useAuth();
  const canSendLink = canSign && user?.role === 'admin';
  const [linkRequest, setLinkRequest] = useState(0);

  const canDownload =
    file != null &&
    file.kind === 'file' &&
    (!file.mime_type.startsWith('application/vnd.google-apps.') || preview === 'google');

  const load = useCallback(async () => {
    if (!file) return;
    setError(null);
    setText(null);
    setOfficeBlob(null);
    replaceBlob(null);
    if (preview === 'none') return;
    setLoading(true);
    setProgress(null);
    try {
      if (preview === 'thumbnail') {
        const blob = await fetchDriveThumbnailBlob(scope, id, file.id);
        replaceBlob(URL.createObjectURL(blob));
      } else {
        const blob = await fetchDrivePreviewBlob(scope, id, file.id, (loaded, total) =>
          // Сервер `Content-Length` өгөөгүй (Google экспорт) бол жагсаалтын хэмжээгээр.
          setProgress({ loaded, total: total ?? file.size }),
        );
        if (preview === 'text') setText(await blob.text());
        else if (preview === 'docx') setOfficeBlob(await whitenDocx(blob));
        else if (preview === 'xlsx') setOfficeBlob(blob);
        else replaceBlob(URL.createObjectURL(blob));
      }
    } catch (err) {
      setError(describeDriveError(err));
    } finally {
      setLoading(false);
      setProgress(null);
    }
  }, [file, preview, scope, id, replaceBlob]);

  useEffect(() => {
    if (!open) return;
    void load();
  }, [open, load]);

  // Цонх хаагдахад blob-ыг чөлөөлнө — эс бөгөөс таб хаагдтал санах ойд үлдэнэ.
  useEffect(() => {
    if (open) return;
    replaceBlob(null);
    setText(null);
    setOfficeBlob(null);
    setError(null);
  }, [open, replaceBlob]);

  const handleDownload = async () => {
    if (!file) return;
    setDownloading(true);
    try {
      await downloadDriveFile(scope, id, file.id, downloadName(file.name, kind));
    } catch (err) {
      toast.error(t(describeDriveError(err).key));
    } finally {
      setDownloading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      {/* ⚠️ Хэмжээ `sm:` УГТВАРТАЙ — `ui/dialog.tsx`-ийн суурь `sm:max-w-lg`-ийг
          угтваргүй анги дардаггүй (DocPreviewDialog-ийн сургамж). */}
      <DialogContent className="flex flex-col gap-3 sm:h-[92vh] sm:max-h-[92vh] sm:w-[96vw] sm:max-w-[1500px]">
        <DialogHeader className="shrink-0">
          <DialogTitle className="truncate pr-8 text-base">{file?.name ?? ''}</DialogTitle>
          {file && (
            <p className="text-xs text-muted-foreground">
              {file.modified_time ? formatDateTime(file.modified_time) : ''}
              {file.size != null ? ` · ${formatBytes(file.size)}` : ''}
            </p>
          )}
        </DialogHeader>

        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {file?.open_url &&
            (onOpenOriginal && isDocxFile(file.mime_type, file.name) ? (
              <Button size="sm" onClick={() => onOpenOriginal(file)} data-testid="drive-open-original">
                <ExternalLink className="h-4 w-4" />
                {t('projectDrive.openOriginal')}
              </Button>
            ) : (
              <Button size="sm" asChild>
                <a href={file.open_url} target="_blank" rel="noopener noreferrer">
                  <ExternalLink className="h-4 w-4" />
                  {kind === 'gdoc' || kind === 'gsheet' || kind === 'gslides'
                    ? t('projectDrive.openEditor')
                    : t('projectDrive.openOriginal')}
                </a>
              </Button>
            ))}
          {canSign && (
            <Button
              size="sm"
              variant={signOpen ? 'secondary' : 'outline'}
              onClick={() => {
                // Самбар хаагдахад link-ийн хүсэлтийг тэглэнэ — дахин нээхэд цонх өөрөө гарахгүй.
                if (signOpen) setLinkRequest(0);
                setSignOpen(!signOpen);
              }}
              aria-pressed={signOpen}
              data-testid="drive-sign-toggle"
            >
              <PenLine className="h-4 w-4" />
              {t('docSign.toggle')}
            </Button>
          )}
          {canSendLink && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setSignOpen(true);
                setLinkRequest((n) => n + 1);
              }}
              data-testid="drive-sign-link"
            >
              <Link2 className="h-4 w-4" />
              {t('docSign.toolbarLink')}
            </Button>
          )}
          {canSign && file && (
            <Button size="sm" variant="outline" asChild>
              <a href={drivePrintUrl(scope, id, file.id)} target="_blank" rel="noopener noreferrer" data-testid="drive-print">
                <Printer className="h-4 w-4" />
                {t('docSign.printPdf')}
              </a>
            </Button>
          )}
          {canDownload && (
            <Button size="sm" variant="outline" onClick={handleDownload} disabled={downloading}>
              {downloading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
              {t('projectDrive.download')}
            </Button>
          )}
          {preview === 'thumbnail' && !loading && !error && (
            <span className="ml-auto text-xs text-muted-foreground">{t('projectDrive.thumbnailNote')}</span>
          )}
          {(preview === 'docx' || preview === 'xlsx') && !loading && !error && (
            <span className="ml-auto text-xs text-muted-foreground">{t('projectDrive.officeRenderNote')}</span>
          )}
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-3 lg:flex-row">
        <div className="min-h-[50vh] flex-1 overflow-hidden rounded-xl border border-border bg-muted/30 lg:min-h-0">
          <Body
            preview={preview}
            loading={loading}
            progress={progress}
            error={error}
            blobUrl={blobUrl}
            officeBlob={officeBlob}
            text={text}
            name={file?.name ?? ''}
            openUrl={file?.open_url ?? null}
            onOpenOriginal={
              file && onOpenOriginal && isDocxFile(file.mime_type, file.name) ? () => onOpenOriginal(file) : undefined
            }
            onRetry={load}
          />
        </div>
        {canSign && signOpen && file && (
          <aside className="max-h-[60vh] shrink-0 overflow-y-auto rounded-xl border border-border bg-card p-3 lg:max-h-none lg:w-[380px]">
            <Suspense
              fallback={
                <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                </div>
              }
            >
              <DriveSigningPanel
                scope={scope}
                id={id}
                fileId={file.id}
                onDocumentChanged={() => {
                  void load();
                  onDocumentChanged?.();
                }}
                onPrint={() => window.open(drivePrintUrl(scope, id, file.id), '_blank', 'noopener,noreferrer')}
                linkDialogRequest={linkRequest}
              />
            </Suspense>
          </aside>
        )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Body({
  preview,
  loading,
  progress,
  error,
  blobUrl,
  officeBlob,
  text,
  name,
  openUrl,
  onOpenOriginal,
  onRetry,
}: {
  preview: DriveItem['preview'];
  loading: boolean;
  progress: { loaded: number; total: number | null } | null;
  error: DriveErrorView | null;
  blobUrl: string | null;
  officeBlob: Blob | null;
  text: string | null;
  name: string;
  openUrl: string | null;
  onOpenOriginal?: () => void;
  onRetry: () => void;
}) {
  const { t } = useLanguage();
  const renderFallback = (
    <div className="flex h-full flex-col items-center justify-center gap-3 text-muted-foreground">
      <Loader2 className="h-6 w-6 animate-spin" />
      <p className="text-sm">{t('projectDrive.rendering')}</p>
    </div>
  );

  if (loading) {
    const total = progress?.total ?? null;
    const pct = progress && total ? Math.min(100, Math.floor((progress.loaded / total) * 100)) : null;
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin" />
        <p className="text-sm">
          {preview === 'google'
            ? t('projectDrive.exporting')
            : progress && total != null && pct != null
              ? t('projectDrive.downloadingOf', { loaded: formatBytes(progress.loaded), total: formatBytes(total), pct })
              : progress
                ? t('projectDrive.downloading', { loaded: formatBytes(progress.loaded) })
                : t('common.loading')}
        </p>
        {pct != null && (
          <div
            className="h-1.5 w-64 max-w-full overflow-hidden rounded-full bg-muted"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={pct}
          >
            <div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${pct}%` }} />
          </div>
        )}
        {total != null && total > LARGE_FILE_BYTES && (
          <p className="text-xs text-muted-foreground/80">{t('projectDrive.largeFileNote')}</p>
        )}
      </div>
    );
  }

  if (error || preview === 'none') {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
        <FileWarning className="h-6 w-6 text-muted-foreground" />
        <p className="max-w-md text-sm text-muted-foreground">
          {error ? t(error.key) : t('projectDrive.noInlinePreview')}
        </p>
        <div className="flex gap-2">
          {error?.retryable && (
            <Button size="sm" variant="outline" onClick={onRetry}>
              <RefreshCw className="h-4 w-4" /> {t('common.retry')}
            </Button>
          )}
          {openUrl &&
            (onOpenOriginal ? (
              <Button size="sm" variant="outline" onClick={onOpenOriginal}>
                <ExternalLink className="h-4 w-4" /> {t('projectDrive.openOriginal')}
              </Button>
            ) : (
              <Button size="sm" variant="outline" asChild>
                <a href={openUrl} target="_blank" rel="noopener noreferrer">
                  <ExternalLink className="h-4 w-4" /> {t('projectDrive.openOriginal')}
                </a>
              </Button>
            ))}
        </div>
      </div>
    );
  }

  if (preview === 'text' && text != null) {
    return (
      <pre className="h-full overflow-auto whitespace-pre-wrap break-words p-4 font-mono text-xs text-foreground">
        {text}
      </pre>
    );
  }

  // Word / Excel — эх байтуудыг хөтөч дээр render хийнэ (хуулбар, хөрвүүлэлтгүй).
  const renderFailed = (
    <div className="flex h-full items-center justify-center px-6 text-center">
      <p className="max-w-md text-sm text-muted-foreground">{t('projectDrive.renderFailed')}</p>
    </div>
  );
  if (preview === 'docx' && officeBlob) {
    return (
      <PreviewErrorBoundary resetKey={officeBlob} fallback={renderFailed}>
        <Suspense fallback={renderFallback}>
          <DocxPreview blob={officeBlob} name={name} />
        </Suspense>
      </PreviewErrorBoundary>
    );
  }
  if (preview === 'xlsx' && officeBlob) {
    return (
      <PreviewErrorBoundary resetKey={officeBlob} fallback={renderFailed}>
        <Suspense fallback={renderFallback}>
          <XlsxPreview blob={officeBlob} name={name} />
        </Suspense>
      </PreviewErrorBoundary>
    );
  }

  if (!blobUrl) return null;

  if (preview === 'image' || preview === 'thumbnail') {
    return (
      <div className="flex h-full items-start justify-center overflow-auto p-4">
        <img src={blobUrl} alt={name} className="max-w-full rounded shadow-sm" />
      </div>
    );
  }

  if (preview === 'video') {
    return (
      <div className="flex h-full items-center justify-center bg-black/90 p-2">
        {/* Drive файлд хадмал байхгүй тул <track> алга. */}
        <video src={blobUrl} controls className="max-h-full max-w-full" />
      </div>
    );
  }

  // pdf / google → PDF.  `sandbox` ЗОРИУДААР үгүй — Chrome-ийн PDF үзүүлэгч
  // sandbox дотор ажилладаггүй (AttachmentPreviews.tsx-тэй ижил).
  return <iframe title={name} src={`${blobUrl}#navpanes=0&view=FitH`} className="h-full w-full border-0" />;
}
