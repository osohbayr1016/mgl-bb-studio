/**
 * Хавсралтын УРЬДЧИЛСАН ХАРАГДАЦ — захидлыг нээхэд зураг болон PDF нь шууд
 * харагдана, бусад төрөл нь хуучин шигээ татах чип хэвээр үлдэнэ.
 *
 * ⚠️ Яагаад заавал `blob:` вэ — хоёр шалтгаан, аль аль нь заавал:
 *
 *  1. `/api/email/attachments/:id` нь `Authorization` толгой шаарддаг
 *     (мэйлийн агуулга authentication-ы цаана байх ёстой) тул түүхий URL-ыг
 *     `<img>`/`<iframe>`-д өгөх БОЛОМЖГҮЙ — эхлээд authed fetch хийнэ.
 *  2. Манай origin нь cross-origin isolated (COOP `same-origin` + COEP
 *     `credentialless`, APS viewer-т шаардлагатай).  Ийм нөхцөлд Chrome-ийн
 *     PDF viewer нь HTTP хаягаар ачаалсан iframe дотор АЖИЛЛАХГҮЙ.
 *     2026-09-07-нд production-ы яг тэр толгойтойгоор хэмжсэн:
 *       • `<iframe src="/x.pdf">`   → «уншиж чадсангүй» дүрс
 *       • `<iframe src={blob:…}>`   → бүрэн уншина ✓
 *       • `<object data={blob:…}>`  → хоосон
 *     Тиймээс PDF-ийг ЗӨВХӨН blob: iframe-ээр үзүүлнэ.  (Ижил хязгаарлалтыг
 *     `features/qto/components/dashboard/ViewExports.tsx` тэмдэглэсэн бөгөөд
 *     тэнд шинэ таб руу нээж тойрсон.)
 *
 * PDF-ийн iframe-д `sandbox` ЗОРИУДААР тавихгүй — Chrome-ийн PDF үзүүлэгч
 * унтардаг.  HTML биетээс ялгаатай нь (тэр нь `sandbox=""` iframe дотор
 * ордог) PDF нь өөрийн plugin-ий sandbox дотор ажилладаг тул манай origin
 * дээр скрипт ажиллуулах гарц нээхгүй.
 *
 * SVG-г зориудаар зураг гэж үзэхгүй — `AttachmentsPopover`-той ижил бодлого.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Download, FileText, Loader2, Maximize2, Paperclip } from 'lucide-react';
import { Button } from '@/ui/button';
import { Dialog, DialogContent, DialogTitle } from '@/ui/dialog';
import { fetchAttachmentObjectUrl, openAttachment } from '@/features/email/api/email';
import type { EmailAttachment } from '@/features/email/types/email';
import { toast } from '@/shared/components/Toast';
import { useLanguage } from '@/shared/i18n';

/** Үүнээс том хавсралтыг автоматаар татахгүй — гараар «Харах» дарна.
 *  (Сервер талд хадгалагдах дээд хэмжээ нь 25 MB — `emailSync.ts`.) */
const AUTO_PREVIEW_MAX_BYTES = 12 * 1024 * 1024;

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|avif|bmp)$/i;

type Kind = 'image' | 'pdf' | 'other';

function kindOf(att: EmailAttachment): Kind {
  const mime = (att.mime_type ?? '').toLowerCase();
  const name = att.filename ?? '';
  if (mime === 'application/pdf' || /\.pdf$/i.test(name)) return 'pdf';
  if (mime.includes('svg')) return 'other';
  if (mime.startsWith('image/') || IMAGE_EXT.test(name)) return 'image';
  return 'other';
}

/** `1.4 MB` маягийн богино хэмжээ. */
function fileSize(bytes: number | null): string {
  if (bytes === null || !Number.isFinite(bytes)) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function AttachmentPreviews({ attachments }: { attachments: EmailAttachment[] }) {
  const { t } = useLanguage();
  const [urls, setUrls] = useState<Record<number, string>>({});
  const [failed, setFailed] = useState<Record<number, true>>({});
  const [manual, setManual] = useState<Record<number, true>>({});
  const [zoomId, setZoomId] = useState<number | null>(null);

  // Татсан blob-уудын толь.  `urls` state нь дүрслэлд, ref нь давхардлыг
  // таслах ба unmount дээр цэвэрлэхэд хэрэгтэй.
  const urlsRef = useRef<Record<number, string>>({});

  // Урьдчилан харуулж болох (R2-д байгаа) хавсралтууд.  `r2_key` null бол
  // байтууд нь огт хадгалагдаагүй — сервер 404 өгнө.
  const previews = useMemo(
    () => attachments.filter((a) => a.r2_key && kindOf(a) !== 'other'),
    [attachments],
  );
  const others = useMemo(
    () => attachments.filter((a) => !a.r2_key || kindOf(a) === 'other'),
    [attachments],
  );

  // Хэт томыг автоматаар татахгүй; «Харах» дарсан бол `manual`-д орж ирнэ.
  const wantedIds = useMemo(() => {
    const s = new Set<number>();
    for (const a of previews) {
      if (manual[a.id] || (a.size_bytes ?? 0) <= AUTO_PREVIEW_MAX_BYTES) s.add(a.id);
    }
    return s;
  }, [previews, manual]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      for (const att of previews) {
        if (cancelled) return;
        if (!wantedIds.has(att.id) || urlsRef.current[att.id]) continue;
        try {
          const url = await fetchAttachmentObjectUrl(att.id, att.mime_type);
          if (cancelled) {
            URL.revokeObjectURL(url);
            return;
          }
          urlsRef.current[att.id] = url;
          setUrls((m) => ({ ...m, [att.id]: url }));
        } catch {
          if (!cancelled) setFailed((m) => ({ ...m, [att.id]: true }));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [previews, wantedIds]);

  // Санах ойг ЗӨВХӨН unmount дээр сулла.  Дээрх effect дахин ажиллах бүрт
  // revoke хийвэл аль хэдийн харагдаж буй зураг/PDF хоосорно.
  useEffect(
    () => () => {
      for (const url of Object.values(urlsRef.current)) URL.revokeObjectURL(url);
      urlsRef.current = {};
    },
    [],
  );

  if (attachments.length === 0) return null;

  const images = previews.filter((a) => kindOf(a) === 'image');
  const pdfs = previews.filter((a) => kindOf(a) === 'pdf');
  const zoomed = zoomId === null ? undefined : previews.find((a) => a.id === zoomId);

  const name = (att: EmailAttachment) => att.filename || t('mailTriagePage.attachment');
  const download = (att: EmailAttachment) =>
    openAttachment(att.id, att.filename ?? undefined).catch((e) => toast.error(String(e)));

  /** Татагдаж дуусаагүй / бүтэлгүйтсэн / хэт том үеийн орлуулагч.  Энгийн
   *  функц — доторх компонент болговол React бүр рендерт шинэ төрөл болгож
   *  дахин холбодог. */
  const placeholder = (att: EmailAttachment) => {
    if (failed[att.id]) {
      return (
        <div className="grid h-full w-full place-items-center px-2 text-center text-[11px] text-muted-foreground">
          {t('mailInbox.previewFailed')}
        </div>
      );
    }
    if (!wantedIds.has(att.id)) {
      return (
        <div className="grid h-full w-full place-content-center justify-items-center gap-1 px-2 text-center">
          <span className="text-[11px] text-muted-foreground">{fileSize(att.size_bytes)}</span>
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs"
            onClick={() => setManual((m) => ({ ...m, [att.id]: true }))}
          >
            {t('mailInbox.showPreview')}
          </Button>
        </div>
      );
    }
    return (
      <div className="grid h-full w-full place-items-center">
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      </div>
    );
  };

  return (
    <div className="space-y-2">
      {images.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {images.map((att) => (
            <figure
              key={att.id}
              className="w-48 overflow-hidden rounded-md border border-border/60"
            >
              <button
                type="button"
                onClick={() => urls[att.id] && setZoomId(att.id)}
                title={name(att)}
                className="block h-32 w-full bg-muted/30 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {urls[att.id] ? (
                  <img src={urls[att.id]} alt={name(att)} className="h-32 w-full object-contain" />
                ) : (
                  placeholder(att)
                )}
              </button>
              <figcaption className="flex items-center gap-1 border-t border-border/60 bg-muted/20 px-1.5 py-1">
                <span className="min-w-0 flex-1 truncate text-[11px]" title={name(att)}>
                  {name(att)}
                </span>
                <button
                  type="button"
                  onClick={() => download(att)}
                  aria-label={t('mailInbox.downloadAttachment')}
                  className="shrink-0 rounded p-0.5 text-muted-foreground hover:text-foreground"
                >
                  <Download className="h-3.5 w-3.5" />
                </button>
              </figcaption>
            </figure>
          ))}
        </div>
      )}

      {pdfs.map((att) => (
        <div key={att.id} className="overflow-hidden rounded-md border border-border/60">
          <div className="flex items-center gap-1.5 border-b border-border/60 bg-muted/20 px-2 py-1.5">
            <FileText className="h-3.5 w-3.5 shrink-0 text-primary" />
            <span className="min-w-0 flex-1 truncate text-xs font-medium" title={name(att)}>
              {name(att)}
            </span>
            <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
              {fileSize(att.size_bytes)}
            </span>
            <button
              type="button"
              onClick={() => urls[att.id] && setZoomId(att.id)}
              disabled={!urls[att.id]}
              aria-label={t('mailInbox.expandPreview')}
              className="shrink-0 rounded p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-40"
            >
              <Maximize2 className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => download(att)}
              aria-label={t('mailInbox.downloadAttachment')}
              className="shrink-0 rounded p-0.5 text-muted-foreground hover:text-foreground"
            >
              <Download className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="h-80 bg-muted/10">
            {urls[att.id] ? (
              // `#navpanes=0&view=FitH` — Chrome-ийн PDF үзүүлэгч анхдагчаар
              // хуудасны жижиг самбарыг нээж, 37% масштабаар үзүүлдэг нь
              // 320px-ийн зурваст уншигдахгүй.  Fragment нь blob-ыг хайхад
              // нөлөөлөхгүй тул blob: URL дээр ажиллана.
              <iframe
                title={name(att)}
                src={`${urls[att.id]}#navpanes=0&view=FitH`}
                className="h-full w-full border-0"
              />
            ) : (
              placeholder(att)
            )}
          </div>
        </div>
      ))}

      {others.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          {others.map((att) => (
            <Button
              key={att.id}
              size="sm"
              variant="outline"
              className="h-7 text-xs"
              onClick={() => download(att)}
            >
              <Paperclip className="h-3 w-3" /> {name(att)}
            </Button>
          ))}
        </div>
      )}

      {/* Томруулж харах — зураг бол <img>, PDF бол мөн адил blob: iframe. */}
      <Dialog open={zoomed !== undefined} onOpenChange={(o) => !o && setZoomId(null)}>
        <DialogContent className="sm:max-w-5xl">
          <DialogTitle className="truncate pr-10 text-sm font-medium">
            {zoomed ? name(zoomed) : ''}
          </DialogTitle>
          {zoomed && urls[zoomed.id] && kindOf(zoomed) === 'image' && (
            <img
              src={urls[zoomed.id]}
              alt={name(zoomed)}
              className="max-h-[78vh] w-auto max-w-full self-center rounded-lg object-contain"
            />
          )}
          {zoomed && urls[zoomed.id] && kindOf(zoomed) === 'pdf' && (
            <iframe
              title={name(zoomed)}
              src={urls[zoomed.id]}
              className="h-[78vh] w-full rounded-lg border-0"
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
