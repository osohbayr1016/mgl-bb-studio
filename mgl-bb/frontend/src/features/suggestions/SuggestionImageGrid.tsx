/**
 * Санал хүсэлтийн картан дээрх зургийн жижиг галерей + томруулж харах цонх.
 *
 * Дарвал бүтэн хэмжээгээр нээгдэж, олон зурагтай бол ←/→ (эсвэл товчоор)
 * гүйлгэнэ.  Зөвхөн УНШИХ — засварлах талбар нь `SuggestionImagesField`.
 */
import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { mediaUrl } from '@/shared/api/client';
import { useLanguage } from '@/shared/i18n';
import { cn } from '@/shared/lib/utils';
import { Dialog, DialogContent, DialogTitle } from '@/ui/dialog';
import type { SuggestionImage } from '@/shared/types';

/** Картан дээр шууд харагдах зургийн тоо; илүү нь «+N» болно. */
const VISIBLE = 4;

export function SuggestionImageGrid({
  images,
  className,
}: {
  images: SuggestionImage[];
  className?: string;
}) {
  const { t } = useLanguage();
  const [openAt, setOpenAt] = useState<number | null>(null);

  if (images.length === 0) return null;

  const shown = images.slice(0, VISIBLE);
  const extra = images.length - shown.length;

  return (
    <>
      <div className={cn('grid grid-cols-4 gap-1.5', className)}>
        {shown.map((img, i) => {
          const last = i === shown.length - 1;
          return (
            <button
              key={img.url}
              type="button"
              onClick={() => setOpenAt(i)}
              title={img.name}
              aria-label={img.name || t('suggestionsPage.imagesLabel')}
              className="group relative overflow-hidden rounded-md border border-border bg-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <img
                src={mediaUrl(img.url)}
                alt={img.name}
                loading="lazy"
                className="aspect-square w-full object-cover transition-transform group-hover:scale-105"
              />
              {last && extra > 0 && (
                <span className="absolute inset-0 flex items-center justify-center bg-black/55 text-sm font-semibold text-white">
                  +{extra}
                </span>
              )}
            </button>
          );
        })}
      </div>

      <SuggestionImageLightbox
        images={images}
        index={openAt}
        onIndexChange={setOpenAt}
        onClose={() => setOpenAt(null)}
      />
    </>
  );
}

function SuggestionImageLightbox({
  images,
  index,
  onIndexChange,
  onClose,
}: {
  images: SuggestionImage[];
  index: number | null;
  onIndexChange: (i: number) => void;
  onClose: () => void;
}) {
  const { t } = useLanguage();
  const open = index !== null;
  const count = images.length;

  // ←/→ гар товчоор гүйлгэх.  Radix нь Escape-ыг өөрөө барина.
  useEffect(() => {
    if (!open || count < 2 || index === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        onIndexChange((index - 1 + count) % count);
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        onIndexChange((index + 1) % count);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, count, index, onIndexChange]);

  const current = index === null ? undefined : images[index];

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-3xl">
        {/* Radix нь Title-гүй бол a11y анхааруулга өгдөг — нэрийг гарчиг болгоно. */}
        <DialogTitle className="pr-10 truncate text-sm font-medium">
          {current?.name || t('suggestionsPage.imagesLabel')}
        </DialogTitle>

        <div className="relative flex min-h-0 flex-1 items-center justify-center">
          {current && (
            <img
              src={mediaUrl(current.url)}
              alt={current.name}
              className="max-h-[70vh] w-auto max-w-full rounded-lg object-contain"
            />
          )}

          {count > 1 && index !== null && (
            <>
              <button
                type="button"
                onClick={() => onIndexChange((index - 1 + count) % count)}
                aria-label={t('common.prev')}
                className="absolute left-1 grid size-9 place-items-center rounded-full bg-background/80 text-foreground shadow-sm hover:bg-background"
              >
                <ChevronLeft className="h-5 w-5" />
              </button>
              <button
                type="button"
                onClick={() => onIndexChange((index + 1) % count)}
                aria-label={t('common.next')}
                className="absolute right-1 grid size-9 place-items-center rounded-full bg-background/80 text-foreground shadow-sm hover:bg-background"
              >
                <ChevronRight className="h-5 w-5" />
              </button>
            </>
          )}
        </div>

        {count > 1 && index !== null && (
          <p className="text-center text-micro tabular-nums text-muted-foreground">
            {index + 1} / {count}
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}
