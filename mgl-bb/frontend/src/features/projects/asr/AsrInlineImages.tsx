import { useRef, useState } from 'react';
import { ImagePlus, Loader2, X } from 'lucide-react';
import { mediaUrl, uploadFile } from '@/shared/api/client';
import { toast } from '@/shared/components/Toast';
import { useLanguage } from '@/shared/i18n';
import { downscaleImage, UnsupportedImageError } from '@/shared/lib/imageDownscale';
import { MEETING_ITEM_MAX_IMAGES } from './meetingDoc';

/**
 * Оффис уулзалтын мөр / «Тайлбар»-ын ард хавсаргах зураг (эзэн 2026-10-12: «бичсэн
 * зүйл бүрийнхээ ард зураг оруулж болох»).  Тайлангийн хавсралт зурагтай ижил:
 * хөтөч дээр жижигрүүлээд (`downscaleImage`) нийтийн `/media/<key>`-д байршуулна;
 * хадгалалт нь эцэг бүтцийн `images: string[]` (autosave-аар PATCH).
 *
 * `onChange` нь UPDATER — хэд хэдэн зураг зэрэг байршихад бие биенийхээ үр дүнг
 * дарахгүй (`AsrDocPhotos`-ийн сургамж).
 */
export function AsrInlineImages({
  images,
  onChange,
  readOnly,
  label,
}: {
  images: string[];
  onChange: (updater: (prev: string[]) => string[]) => void;
  readOnly: boolean;
  /** Товчны aria-label-д — аль мөрийн зураг болохыг дэлгэц уншигчид хэлнэ. */
  label: string;
}) {
  const { t } = useLanguage();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(0);

  const add = async (files: FileList | null) => {
    if (!files?.length) return;
    const room = MEETING_ITEM_MAX_IMAGES - images.length - busy;
    const list = Array.from(files).slice(0, Math.max(0, room));
    if (list.length < files.length) {
      toast.error(t('asr.meeting.imagesMax', { n: MEETING_ITEM_MAX_IMAGES }));
    }
    setBusy((n) => n + list.length);
    await Promise.all(
      list.map(async (file) => {
        try {
          const url = await uploadFile(await downscaleImage(file));
          onChange((prev) =>
            prev.includes(url) || prev.length >= MEETING_ITEM_MAX_IMAGES ? prev : [...prev, url],
          );
        } catch (err) {
          toast.error(
            err instanceof UnsupportedImageError ? t('asr.unsupportedImage') : t('asr.meeting.imageFailed'),
          );
        } finally {
          setBusy((n) => n - 1);
        }
      }),
    );
  };

  if (readOnly && images.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-1.5 px-3 pb-2">
      {images.map((url) => (
        <div key={url} className="group relative">
          <a href={mediaUrl(url)} target="_blank" rel="noreferrer">
            <img
              src={mediaUrl(url)}
              alt=""
              loading="lazy"
              className="h-16 w-auto max-w-32 rounded border border-foreground/20 object-cover"
            />
          </a>
          {!readOnly && (
            <button
              type="button"
              onClick={() => onChange((prev) => prev.filter((u) => u !== url))}
              aria-label={t('asr.meeting.imageRemove')}
              title={t('asr.meeting.imageRemove')}
              className="absolute -right-1.5 -top-1.5 rounded-full border bg-background p-0.5 text-muted-foreground shadow-sm hover:text-foreground"
            >
              <X className="size-3" />
            </button>
          )}
        </div>
      ))}
      {Array.from({ length: busy }, (_, i) => (
        <div
          key={`busy-${i}`}
          className="flex h-16 w-20 items-center justify-center rounded border border-dashed border-foreground/25"
        >
          <Loader2 className="size-4 animate-spin text-muted-foreground" />
        </div>
      ))}
      {!readOnly && images.length + busy < MEETING_ITEM_MAX_IMAGES && (
        <>
          <button
            type="button"
            onClick={() => input.current?.click()}
            aria-label={`${label} — ${t('asr.meeting.imageAdd')}`}
            title={t('asr.meeting.imageAdd')}
            className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <ImagePlus className="size-3.5" />
            {images.length === 0 && busy === 0 && t('asr.meeting.imageAdd')}
          </button>
          <input
            ref={input}
            type="file"
            accept="image/*"
            multiple
            hidden
            onChange={(e) => {
              void add(e.target.files);
              e.target.value = '';
            }}
          />
        </>
      )}
    </div>
  );
}
