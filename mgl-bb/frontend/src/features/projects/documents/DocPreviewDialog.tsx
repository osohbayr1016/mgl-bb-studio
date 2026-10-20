/**
 * Баримт нээх цонх — ХАРАХ нь хуудсан дотор, ЗАСАХ нь шинэ табанд.
 *
 * Эзний шийдвэр (2026-09-07): «файлыг хөтөч дотроо засваргүй хараад, засах
 * бол шинэ таб нээж Google дээр бусад ажилтантай зэрэг ажиллана».
 *
 * ⚠️ Яагаад Google-ийг ЭНД iframe-д оруулдаггүй вэ — хоёр бие даасан хориг:
 *   1. Google Docs/Sheets-ийн `/edit` хуудас өөрийгөө frame-д оруулахыг
 *      хориглодог (зөвхөн `/preview` нь уншихад нээлттэй).
 *   2. Манай origin нь COOP `same-origin` + COEP `credentialless` (APS 3D
 *      үзүүлэгч, push service worker хоёрт шаардлагатай).  `credentialless`
 *      горимд гадаад iframe КҮҮКИГҮЙ ачаалагддаг тул хэрэглэгч Google дотор
 *      «нэвтрээгүй» болж харагдана.
 * Тиймээс засах товч нь ҮРГЭЛЖ `window.open(..., '_blank')`.
 *
 * ⚠️ PDF-ийг ЗААВАЛ `blob:` -ээр үзүүлнэ.  Ижил cross-origin isolation-ы
 * улмаас HTTP хаягаар ачаалсан PDF iframe дотор Chrome-ийн үзүүлэгч
 * ажиллахгүй — 2026-09-07-нд production дээр хэмжсэн
 * (`features/email/components/AttachmentPreviews.tsx`).
 */
import { useCallback, useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  Download,
  ExternalLink,
  FileWarning,
  Loader2,
  RefreshCw,
  SquareCheckBig,
} from 'lucide-react';
import { Button } from '@/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/ui/dialog';
import { ApiError, mediaUrl } from '@/shared/api/client';
import { useApiQuery } from '@/shared/api/useApi';
import { toast } from '@/shared/components/Toast';
import { useLanguage } from '@/shared/i18n';
import {
  closeGoogleApi,
  fetchOfficePreview,
  officeStatusKey,
  officeStatusPath,
  openInGoogleApi,
  syncFromGoogleApi,
  type OfficeStatus,
} from './api';
import { officeKind, previewKind } from './officeKind';
import type { DocumentItem } from '@/shared/types';

type Busy = 'open' | 'sync' | 'close' | null;

/**
 * Хуудсан доторх харагдац нь Google-ээр PDF болгож гаргахыг шаарддаг бөгөөд
 * `files.export` нь 10 MB-д хатуу хязгаарлагдана.  Тэр хязгаарыг СЕРВЕР рүү
 * очиж байж мэдэх нь хамгийн муу хэлбэр: хэрэглэгч хөрвүүлэлт дуустал хэдэн
 * секунд хүлээгээд эцэст нь бүтэлгүйтдэг.  Файлын хэмжээг бид жагсаалтаас
 * аль хэдийн мэддэг тул ЭНД шалгаад шууд хэлнэ — сүлжээний дуудлага огт
 * хийхгүй.  (Сервер тал нь мөн ижил шалгалттай — `file_size` хоосон байж
 * болох тул тэр нь эцсийн эрх мэдэлтэн.)
 */
const PREVIEW_MAX_BYTES = 10 * 1024 * 1024;

export function DocPreviewDialog({
  file,
  onClose,
  onChanged,
}: {
  file: DocumentItem | null;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { t } = useLanguage();
  const qc = useQueryClient();
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Дахин оролдоод ялгаагүй алдаа (жишээ нь хэт том файл) — «Дахин оролдох»
  // товч гаргах нь хэрэглэгчийг дэмий давтуулна.
  const [retryable, setRetryable] = useState(true);
  const [busy, setBusy] = useState<Busy>(null);

  const open = file != null;
  const name = file?.file_name ?? file?.title ?? '';
  const rawKind = previewKind(name);
  const isOffice = officeKind(name) != null;

  const status = useApiQuery<OfficeStatus>(
    officeStatusKey(file?.id ?? 0),
    officeStatusPath(file?.id ?? 0),
    { enabled: open && isOffice },
  );
  const session = status.data?.edit_url ?? null;
  const driveReady = status.data?.drive_enabled ?? null;
  const canEdit = Boolean(isOffice && driveReady);
  // Drive-ын тохиргоо ирэхийг хүлээнэ (null), ирээд УНТРААЛТТАЙ бол харагдац
  // огт боломжгүй тул 'none' болгож татах зөвлөмж үзүүлнэ.
  const kind = rawKind === 'office' && driveReady === false ? 'none' : rawKind;
  const oversize = rawKind === 'office' && (file?.file_size ?? 0) > PREVIEW_MAX_BYTES;

  /* --- Урьдчилан харах эх сурвалжийг бэлдэх ------------------------------ */
  const loadPreview = useCallback(async () => {
    if (!file) return;
    setError(null);
    setRetryable(true);
    if (kind === 'none' || kind === 'image') return;
    // Хэт том файл дээр Drive рүү огт хандахгүй — хүлээлгэх утгагүй.
    if (oversize) return;
    if (kind === 'office' && driveReady !== true) return;
    setLoading(true);
    try {
      let blob: Blob;
      if (kind === 'office') {
        blob = await fetchOfficePreview(file.id);
      } else {
        const res = await fetch(mediaUrl(file.file_url));
        if (!res.ok) throw new Error(t('documentsPage.previewFailed'));
        blob = await res.blob();
      }
      setBlobUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return URL.createObjectURL(blob);
      });
    } catch (err) {
      // 413 = хэт том.  Сервер ижил шалгалт хийдэг тул front-end-ийн
      // `file_size` хоосон байсан ч энэ салаа зөв ажиллана.
      if (err instanceof ApiError && err.status === 413) setRetryable(false);
      setError(err instanceof Error ? err.message : t('documentsPage.previewFailed'));
    } finally {
      setLoading(false);
    }
  }, [file, kind, oversize, driveReady, t]);

  useEffect(() => {
    if (!open) return;
    void loadPreview();
  }, [open, loadPreview]);

  // Цонх хаагдахад blob-ыг чөлөөлнө — эс бөгөөс таб хаагдтал санах ойд үлдэнэ.
  useEffect(() => {
    if (open) return;
    setBlobUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
    setError(null);
  }, [open]);

  /* --- Google-ийн табаас буцаж ирэхэд ------------------------------------
   * Ажилтан нөгөө табдаа засаад эргэж ирэхэд урьдчилан харагдац хуучирсан
   * байна.  Cron нь 5 минут чимээгүй болсны дараа татдаг тул энд ЗӨВХӨН
   * төлөвөө сэргээнэ — автоматаар татахгүй (тэгвэл бичиж байх зуур нь
   * хагас дутуу хувилбар үүсгэнэ).                                        */
  const refetchStatus = status.refetch;
  useEffect(() => {
    if (!open || !session) return;
    const onFocus = () => void refetchStatus();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [open, session, refetchStatus]);

  /* --- Үйлдлүүд ---------------------------------------------------------- */
  const handleOpenGoogle = async () => {
    if (!file) return;
    setBusy('open');
    try {
      const url = session ?? (await openInGoogleApi(file.id));
      await qc.invalidateQueries({ queryKey: officeStatusKey(file.id) });
      window.open(url, '_blank', 'noopener');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('documentsPage.googleOpenFailed'));
    } finally {
      setBusy(null);
    }
  };

  const handleSync = async () => {
    if (!file) return;
    setBusy('sync');
    try {
      await syncFromGoogleApi(file.id);
      toast.success(t('documentsPage.syncedFromGoogle'));
      await qc.invalidateQueries({ queryKey: officeStatusKey(file.id) });
      await loadPreview();
      onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('documentsPage.syncFailed'));
    } finally {
      setBusy(null);
    }
  };

  const handleFinish = async () => {
    if (!file) return;
    setBusy('close');
    try {
      await closeGoogleApi(file.id);
      toast.success(t('documentsPage.editingFinished'));
      await qc.invalidateQueries({ queryKey: officeStatusKey(file.id) });
      await loadPreview();
      onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('documentsPage.syncFailed'));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      {/* ⚠️ Бүх хэмжээ `sm:` УГТВАРТАЙ байх ЁСТОЙ.  `ui/dialog.tsx`-ийн суурь нь
          ≥640px дээр `sm:max-w-lg` + `sm:h-auto` өгдөг бөгөөд tailwind-merge нь
          угтвартай/угтваргүй ангиудыг ӨӨР бүлэг гэж үздэг тул угтваргүй
          `max-w-5xl`/`h-[88vh]` нь ЯЛАГДАЖ, цонх жижигхэн хэвээр гардаг байв.
          Баримт уншихад зориулсан гадаргуу учир бараг дэлгэц дүүрэн авна. */}
      <DialogContent className="flex flex-col gap-3 sm:h-[92vh] sm:max-h-[92vh] sm:w-[96vw] sm:max-w-[1500px]">
        <DialogHeader className="shrink-0">
          <DialogTitle className="truncate pr-8 text-base">{name}</DialogTitle>
        </DialogHeader>

        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {canEdit ? (
            <Button size="sm" onClick={handleOpenGoogle} disabled={busy !== null}>
              {busy === 'open' ? (
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
              ) : (
                <ExternalLink className="mr-1.5 h-4 w-4" />
              )}
              {session ? t('documentsPage.continueInGoogle') : t('documentsPage.editInGoogle')}
            </Button>
          ) : null}
          {session ? (
            <>
              <Button size="sm" variant="outline" onClick={handleSync} disabled={busy !== null}>
                {busy === 'sync' ? (
                  <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="mr-1.5 h-4 w-4" />
                )}
                {t('documentsPage.pullFromGoogle')}
              </Button>
              <Button size="sm" variant="outline" onClick={handleFinish} disabled={busy !== null}>
                {busy === 'close' ? (
                  <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                ) : (
                  <SquareCheckBig className="mr-1.5 h-4 w-4" />
                )}
                {t('documentsPage.finishEditing')}
              </Button>
            </>
          ) : null}
          <Button size="sm" variant="ghost" asChild>
            <a href={mediaUrl(file?.file_url)} download={name} target="_blank" rel="noreferrer">
              <Download className="mr-1.5 h-4 w-4" />
              {t('documentsPage.download')}
            </a>
          </Button>
          {session ? (
            <span className="ml-auto text-xs text-muted-foreground">
              {t('documentsPage.googleSessionOpen')}
            </span>
          ) : null}
        </div>

        <div className="min-h-0 flex-1 overflow-hidden rounded-xl border border-border bg-muted/30">
          <PreviewBody
            kind={kind}
            oversize={oversize}
            retryable={retryable}
            loading={loading}
            error={error}
            blobUrl={blobUrl}
            imageSrc={mediaUrl(file?.file_url)}
            name={name}
            onRetry={loadPreview}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}

function PreviewBody({
  kind,
  oversize,
  retryable,
  loading,
  error,
  blobUrl,
  imageSrc,
  name,
  onRetry,
}: {
  kind: ReturnType<typeof previewKind>;
  oversize: boolean;
  retryable: boolean;
  loading: boolean;
  error: string | null;
  blobUrl: string | null;
  imageSrc: string;
  name: string;
  onRetry: () => void;
}) {
  const { t } = useLanguage();

  if (kind === 'image') {
    return (
      <div className="flex h-full items-center justify-center overflow-auto p-4">
        <img src={imageSrc} alt={name} className="max-h-full max-w-full object-contain" />
      </div>
    );
  }

  // «Хэт том» нь алдаа биш, хүлээгдэж буй хязгаарлалт — улаан алдааны хэлбэр
  // биш, тайван тайлбар + дээрх «Google дээр засах» товч руу чиглүүлнэ.
  if (oversize) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
        <FileWarning className="h-6 w-6 text-muted-foreground" />
        <p className="max-w-md text-sm text-muted-foreground">
          {t('documentsPage.previewTooLarge')}
        </p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin" />
        <p className="text-sm">
          {kind === 'office' ? t('documentsPage.converting') : t('common.loading')}
        </p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
        <FileWarning className="h-6 w-6 text-muted-foreground" />
        <p className="max-w-md text-sm text-muted-foreground">{error}</p>
        {retryable ? (
          <Button size="sm" variant="outline" onClick={onRetry}>
            {t('common.retry')}
          </Button>
        ) : null}
      </div>
    );
  }

  if (kind === 'none') {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
        <FileWarning className="h-6 w-6 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">{t('documentsPage.noPreview')}</p>
      </div>
    );
  }

  // Drive-ын төлөв ирэхийг хүлээж байх богино агшин — хоосон дэвсгэрээс
  // эргэлдэгч нь дээр.
  if (!blobUrl) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }
  // `sandbox` ЗОРИУДААР тавихгүй — Chrome-ийн PDF үзүүлэгч түүн дотор унтардаг.
  return <iframe src={blobUrl} title={name} className="h-full w-full border-0" />;
}
