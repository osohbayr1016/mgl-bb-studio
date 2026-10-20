/**
 * Санал хүсэлтэд зураг хавсаргах талбар — ЧИРЖ ХАЯХ (drag & drop) эсвэл
 * файл сонгох (choose file) хоёулаа.
 *
 * ⚠️ Зураг бүр БИЕ ДААН байршина (`AsrPhotoGrid`-ийн батлагдсан хэв маяг).
 *    Бүх файлыг цуглуулаад амжилттай дуусмагц л state-д бичдэг байсан бол
 *    сүүлийн зураг унахад өмнөх бүгд хаягдаж, R2-д өнчин үлддэг.  Энд
 *    амжилттай бүрийг тэр дор нь `onChange`-ээр гаргаж, унасныг «Дахин
 *    оролдох» товчтой үлдээнэ.
 *
 * ⚠️ SVG-г ЗОРИУДААР хүлээж авахгүй: `/media/<key>` нь `/api/*`-тай ижил
 *    гарал дээр нийтэд нээлттэй (CLAUDE.md, аюулгүй байдлын #2) тул
 *    `image/svg+xml` нь итгэмжлэгдсэн домэйн дээр скрипт ажиллуулах гарц
 *    болно.  Энэ бол зөвхөн клиент талын шүүлт — гэхдээ энэ формоор шинэ
 *    цоорхой НЭЭХГҮЙ байх нь бидний хариуцлага.
 */
import { useCallback, useEffect, useRef, useState, type DragEvent } from 'react';
import { ImagePlus, Loader2, RotateCw, UploadCloud, X } from 'lucide-react';
import { uploadFile, mediaUrl } from '@/shared/api/client';
import { toast } from '@/shared/components/Toast';
import { useLanguage } from '@/shared/i18n';
import { downscaleImage, UnsupportedImageError } from '@/shared/lib/imageDownscale';
import { cn } from '@/shared/lib/utils';
import { Button } from '@/ui/button';
import { SUGGESTION_MAX_IMAGES, type SuggestionImage } from '@/shared/types';

/** Декодлохоос өмнөх эрүүл ухааны тааз — доройтуулах нь браузерын санах ойд
 *  бүтэн зургийг тавьдаг тул хэт том файлыг оруулахгүй. */
const MAX_FILE_BYTES = 30 * 1024 * 1024;

interface PendingUpload {
  id: string;
  file: File;
  previewUrl: string;
  failed: boolean;
}

function isImageFile(file: File): boolean {
  if (/\.svgz?$/i.test(file.name) || (file.type || '').includes('svg')) return false;
  if (file.type.startsWith('image/')) return true;
  // iOS/Android заримдаа хоосон MIME өгдөг — өргөтгөлөөр нь ч танина.
  return /\.(png|jpe?g|gif|webp|avif|heic|heif|bmp|tiff?)$/i.test(file.name);
}

export function SuggestionImagesField({
  images,
  onChange,
  onBusyChange,
  disabled,
}: {
  images: SuggestionImage[];
  /**
   * ЗААВАЛ updater хэлбэр.  Хэд хэдэн байршуулалт зэрэг дуусахад
   * `onChange([...images, x])` гэвэл хуучин closure-ийн жагсаалт нь
   * өмнөх амжилтуудыг дардаг.
   */
  onChange: (updater: (prev: SuggestionImage[]) => SuggestionImage[]) => void;
  /** Байршуулалт явж байгаа эсэх — эцэг нь «Илгээх»-ийг түгжинэ. */
  onBusyChange?: (busy: boolean) => void;
  disabled?: boolean;
}) {
  const { t } = useLanguage();
  const [pending, setPending] = useState<PendingUpload[]>([]);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  // `dragenter`/`dragleave` нь ХҮҮХЭД элемент бүр дээр асдаг тул тоолуургүй
  // бол хүрээ анивчина.
  const dragDepth = useRef(0);

  const busy = pending.some((p) => !p.failed);
  useEffect(() => {
    onBusyChange?.(busy);
  }, [busy, onBusyChange]);

  // Dialog хаагдахад амьд байгаа object URL-уудыг чөлөөлнө.  Цэвэрлэгээ нь
  // ЗӨВХӨН unmount дээр ажиллах ёстой тул хамгийн сүүлийн жагсаалтыг ref-ээр
  // барина (`[]` deps дээр closure нь эхний render-ийн хоосон массивыг барьж,
  // юу ч чөлөөлөхгүй байсан).
  const pendingRef = useRef<PendingUpload[]>([]);
  useEffect(() => {
    pendingRef.current = pending;
  }, [pending]);
  useEffect(() => {
    return () => {
      for (const p of pendingRef.current) URL.revokeObjectURL(p.previewUrl);
    };
  }, []);

  const uploadOne = useCallback(
    async (item: PendingUpload) => {
      try {
        const small = await downscaleImage(item.file);
        const url = await uploadFile(small);
        onChange((prev) => [...prev, { url, name: item.file.name }]);
        setPending((p) => p.filter((x) => x.id !== item.id));
        URL.revokeObjectURL(item.previewUrl);
      } catch (err) {
        if (err instanceof UnsupportedImageError) {
          toast.error(item.file.name, t('suggestionsPage.imageUnsupported'));
          setPending((p) => p.filter((x) => x.id !== item.id));
          URL.revokeObjectURL(item.previewUrl);
          return;
        }
        // Сүлжээ унасан — файлыг барьж үлдэж, дахин оролдох боломж өгнө.
        setPending((p) => p.map((x) => (x.id === item.id ? { ...x, failed: true } : x)));
      }
    },
    [onChange, t],
  );

  const addFiles = useCallback(
    (files: FileList | File[] | null) => {
      if (disabled || !files) return;
      const all = Array.from(files);
      if (all.length === 0) return;

      const usable = all.filter((f) => {
        if (!isImageFile(f)) {
          toast.error(f.name, t('suggestionsPage.imageOnly'));
          return false;
        }
        if (f.size > MAX_FILE_BYTES) {
          toast.error(f.name, t('suggestionsPage.imageTooBig'));
          return false;
        }
        return true;
      });
      if (usable.length === 0) return;

      const room = SUGGESTION_MAX_IMAGES - images.length - pending.length;
      if (room <= 0) {
        toast.warn(t('suggestionsPage.imageLimit', { max: SUGGESTION_MAX_IMAGES }));
        return;
      }
      const picked = usable.slice(0, room);
      if (picked.length < usable.length) {
        toast.warn(t('suggestionsPage.imageLimit', { max: SUGGESTION_MAX_IMAGES }));
      }

      const items: PendingUpload[] = picked.map((file, i) => ({
        id: `${Date.now()}-${i}-${file.name}`,
        file,
        previewUrl: URL.createObjectURL(file),
        failed: false,
      }));
      setPending((p) => [...p, ...items]);
      for (const item of items) void uploadOne(item);
    },
    [disabled, images.length, pending.length, t, uploadOne],
  );

  const remove = (url: string) => onChange((prev) => prev.filter((p) => p.url !== url));

  const dropPending = (item: PendingUpload) => {
    setPending((p) => p.filter((x) => x.id !== item.id));
    URL.revokeObjectURL(item.previewUrl);
  };

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    dragDepth.current = 0;
    setDragging(false);
    addFiles(e.dataTransfer.files);
  };

  const total = images.length + pending.length;
  const full = total >= SUGGESTION_MAX_IMAGES;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">{t('suggestionsPage.imagesLabel')}</span>
        <span className="text-micro tabular-nums text-muted-foreground">
          {total}/{SUGGESTION_MAX_IMAGES}
        </span>
      </div>

      {total > 0 && (
        <div className="grid grid-cols-4 gap-2 sm:grid-cols-5">
          {images.map((img) => (
            <figure
              key={img.url}
              className="group relative overflow-hidden rounded-lg border border-border bg-muted"
            >
              <img
                src={mediaUrl(img.url)}
                alt={img.name}
                loading="lazy"
                className="aspect-square w-full object-cover"
              />
              {!disabled && (
                <button
                  type="button"
                  onClick={() => remove(img.url)}
                  aria-label={t('suggestionsPage.imageRemove')}
                  title={t('suggestionsPage.imageRemove')}
                  className="absolute right-1 top-1 rounded-full bg-background/90 p-1 text-foreground shadow-sm"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </figure>
          ))}

          {pending.map((item) => (
            <figure
              key={item.id}
              className="relative overflow-hidden rounded-lg border border-border bg-muted"
            >
              <img
                src={item.previewUrl}
                alt=""
                className="aspect-square w-full object-cover opacity-50"
              />
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-1">
                {item.failed ? (
                  <>
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      className="h-6 gap-1 px-1.5 text-micro"
                      onClick={() => {
                        setPending((p) =>
                          p.map((x) => (x.id === item.id ? { ...x, failed: false } : x)),
                        );
                        void uploadOne(item);
                      }}
                    >
                      <RotateCw className="h-3 w-3" /> {t('suggestionsPage.imageRetry')}
                    </Button>
                    <button
                      type="button"
                      onClick={() => dropPending(item)}
                      className="text-micro text-muted-foreground underline"
                    >
                      {t('suggestionsPage.imageRemove')}
                    </button>
                  </>
                ) : (
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                )}
              </div>
            </figure>
          ))}
        </div>
      )}

      {/* Чирж хаях + дарж сонгох нэг талбар.  `role="button"` + Enter/Space
          нь гар талын хандалтыг хангана. */}
      <div
        role="button"
        tabIndex={disabled || full ? -1 : 0}
        aria-label={t('suggestionsPage.imageChoose')}
        aria-disabled={disabled || full}
        onClick={() => !disabled && !full && inputRef.current?.click()}
        onKeyDown={(e) => {
          if (disabled || full) return;
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            inputRef.current?.click();
          }
        }}
        onDragEnter={(e) => {
          e.preventDefault();
          if (disabled || full) return;
          dragDepth.current += 1;
          setDragging(true);
        }}
        onDragOver={(e) => e.preventDefault()}
        onDragLeave={() => {
          dragDepth.current = Math.max(0, dragDepth.current - 1);
          if (dragDepth.current === 0) setDragging(false);
        }}
        onDrop={onDrop}
        className={cn(
          'flex flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed px-3 py-4 text-center transition-colors',
          disabled || full
            ? 'cursor-not-allowed border-border/60 text-muted-foreground opacity-60'
            : dragging
              ? 'cursor-pointer border-primary bg-primary/10 text-primary'
              : 'cursor-pointer border-input text-muted-foreground hover:border-primary/50 hover:bg-primary/5',
        )}
      >
        {dragging ? (
          <UploadCloud className="h-5 w-5" />
        ) : (
          <ImagePlus className="h-5 w-5" />
        )}
        <p className="text-xs font-medium">
          {full ? t('suggestionsPage.imageFull') : t('suggestionsPage.imageDropzone')}
        </p>
        {!full && <p className="text-micro">{t('suggestionsPage.imageDropzoneHint')}</p>}
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          disabled={disabled || full}
          onChange={(e) => {
            addFiles(e.target.files);
            // Ижил файлыг дахин сонгоход `change` асахын тулд цэвэрлэнэ.
            e.target.value = '';
          }}
        />
      </div>
    </div>
  );
}
