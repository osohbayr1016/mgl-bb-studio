import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, RotateCcw, Upload, ZoomIn, ZoomOut } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/ui/dialog';
import { Button } from '@/ui/button';
import { useLanguage } from '@/shared/i18n';
import { cn } from '@/shared/lib/utils';

/* =============================================================
 * ImageCropDialog
 * -------------------------------------------------------------
 * A dependency-free image cropper used for avatars and cover
 * photos.  The interaction model:
 *   • viewport is a fixed-size box (square for circular crops,
 *     16:9 for cover photos) showing the cropped region
 *   • the source image starts scaled to *cover* the viewport, so
 *     you never see whitespace edges
 *   • drag to pan inside the viewport
 *   • wheel / pinch / slider to zoom (clamped so the image always
 *     covers the viewport)
 *   • "Засаж байршуулах" exports a fixed-size PNG (default 512×512
 *     for avatars) which keeps server-side storage predictable
 *
 * Implementation notes:
 *   • Pan is stored in *image* coordinates so it remains stable
 *     when zooming around the viewport center.
 *   • We re-clamp the offset on every change so the user can never
 *     drag the image off the viewport edges.
 * ============================================================= */

export type CropShape = 'circle' | 'rectangle';

interface Props {
  open: boolean;
  file: File | null;
  /** 'circle' renders a circular preview mask (good for avatars).
   *  'rectangle' is plain — used for cover photos. */
  shape?: CropShape;
  /** Aspect ratio of the OUTPUT image (width / height).
   *  1 for avatars, 16/9 for covers, etc. */
  aspect?: number;
  /** Width of the rendered output PNG.  Height is derived from
   *  aspect.  Defaults to 512 (px). */
  outputWidth?: number;
  title?: string;
  description?: string;
  uploading?: boolean;
  onCancel: () => void;
  onConfirm: (cropped: File) => void;
}

/**
 * Тайрах цонхны ХАМГИЙН ИХ өргөн.  Бодит өргөнийг эцэг элементээс хэмжинэ.
 *
 * ⚠️ Урьд нь энэ нь хатуу `width: 360` болж inline style-аар тавигдаж, ЗЭРЭГ
 * тайралтын математикт эх сурвалж болж байсан.  360px дэлгэц дээр диалогийн
 * агуулгын хэсэг ердөө 328px (p-4 × 2) тул: (1) цонх хоёр талаараа 16px-ээр
 * халина, (2) хамаагүй ноцтой нь — хэрэглэгч 328px-ийг харж байхад экспорт нь
 * 360px-ийн хэсгийг зурдаг байсан, өөрөөр хэлбэл ЖААХАН БОДИТ БУС хүрээ.
 * WYSIWYG нь 392px-ээс нарийн бүх утсан дээр эвдэрсэн байв.
 */
const VIEWPORT_MAX_W = 360;

export function ImageCropDialog({
  open,
  file,
  shape = 'circle',
  aspect = 1,
  outputWidth = 512,
  title,
  description,
  uploading = false,
  onCancel,
  onConfirm,
}: Props) {
  const { t } = useLanguage();

  // Бодит хэмжсэн өргөн — CSS хайрцаг БОЛОН тайралтын математик хоёулаа
  // эндээс уншина, ингэснээр харагдаж байгаа зураг нь экспортлогдох хэсэгтэй
  // яг таарна.
  const viewportRef = useRef<HTMLDivElement>(null);
  const [viewportW, setViewportW] = useState(VIEWPORT_MAX_W);
  useEffect(() => {
    const el = viewportRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w && w > 0) setViewportW(Math.round(w));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [open]);

  const viewportH = Math.round(viewportW / aspect);
  const resolvedTitle = title ?? t('imageCropDialog.title');
  const resolvedDescription = description ?? t('imageCropDialog.description');

  // Source image bitmap (HTMLImageElement) and natural dimensions —
  // we keep the element instance to draw to canvas later.
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [imgUrl, setImgUrl] = useState<string | null>(null);

  // baseScale = the smallest scale at which the image still fully
  // covers the viewport (so the user can never zoom OUT past edges).
  const [zoom, setZoom] = useState(1);
  const [dragging, setDragging] = useState(false);
  // Offset, in CSS pixels, of the image's center relative to the
  // viewport's center.  Positive x = image moved right.
  const [offset, setOffset] = useState({ x: 0, y: 0 });

  const dragRef = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);

  /* ---- load the file as an Image ---- */
  useEffect(() => {
    if (!file || !open) return;
    const url = URL.createObjectURL(file);
    setImgUrl(url);
    const el = new Image();
    el.onload = () => {
      setImg(el);
      setZoom(1);
      setOffset({ x: 0, y: 0 });
    };
    el.src = url;
    return () => {
      URL.revokeObjectURL(url);
      setImg(null);
      setImgUrl(null);
    };
  }, [file, open]);

  /* Cover-fit: цонхыг бүрэн нөхөх хамгийн жижиг масштаб.
   * Зургийн ачаалалтад биш, ГАРГАЖ авна — цонхны өргөн (эргүүлэх, цонх
   * томсгох) өөрчлөгдвөл дахин тооцоологдох ёстой. */
  const baseScale = useMemo(() => {
    if (!img) return 1;
    return Math.max(viewportW / img.naturalWidth, viewportH / img.naturalHeight);
  }, [img, viewportW, viewportH]);

  // Effective scale = baseScale × zoom.  The displayed image always
  // covers the viewport because we clamp `zoom >= 1`.
  const scale = baseScale * zoom;

  /* ---- clamp offset so the image edges never expose viewport bg ---- */
  const clampOffset = useCallback(
    (next: { x: number; y: number }) => {
      if (!img) return next;
      const w = img.naturalWidth * scale;
      const h = img.naturalHeight * scale;
      const maxX = Math.max(0, (w - viewportW) / 2);
      const maxY = Math.max(0, (h - viewportH) / 2);
      return {
        x: Math.min(maxX, Math.max(-maxX, next.x)),
        y: Math.min(maxY, Math.max(-maxY, next.y)),
      };
    },
    [img, scale, viewportW, viewportH],
  );

  // Re-clamp whenever zoom changes (zooming out can leave the image
  // off-center otherwise).
  useEffect(() => {
    setOffset((o) => clampOffset(o));
  }, [zoom, clampOffset]);

  /* ---- pointer drag to pan ---- */
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
    dragRef.current = { x: e.clientX, y: e.clientY, ox: offset.x, oy: offset.y };
    setDragging(true);
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    const dx = e.clientX - dragRef.current.x;
    const dy = e.clientY - dragRef.current.y;
    setOffset(
      clampOffset({
        x: dragRef.current.ox + dx,
        y: dragRef.current.oy + dy,
      }),
    );
  };
  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    (e.currentTarget as HTMLDivElement).releasePointerCapture(e.pointerId);
    dragRef.current = null;
    setDragging(false);
  };

  /* ---- wheel to zoom ---- */
  const onWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    e.preventDefault();
    const next = zoom * (e.deltaY < 0 ? 1.08 : 1 / 1.08);
    setZoom(Math.min(5, Math.max(1, next)));
  };

  const reset = () => {
    setZoom(1);
    setOffset({ x: 0, y: 0 });
  };

  /* ---- export the cropped region as a PNG File ---- */
  const handleConfirm = async () => {
    if (!img || !file) return;

    const outW = outputWidth;
    const outH = Math.round(outW / aspect);

    const canvas = document.createElement('canvas');
    canvas.width = outW;
    canvas.height = outH;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Map viewport (CSS) coords back to source-image coords:
    //   the *viewport center* corresponds to the source pixel
    //   (img.naturalWidth/2 - offset.x/scale, img.naturalHeight/2 - offset.y/scale)
    //   and the viewport spans viewportW/scale source pixels.
    const srcW = viewportW / scale;
    const srcH = viewportH / scale;
    const srcCenterX = img.naturalWidth / 2 - offset.x / scale;
    const srcCenterY = img.naturalHeight / 2 - offset.y / scale;
    const sx = srcCenterX - srcW / 2;
    const sy = srcCenterY - srcH / 2;

    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, outW, outH);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, sx, sy, srcW, srcH, 0, 0, outW, outH);

    const blob: Blob | null = await new Promise((resolve) => {
      canvas.toBlob((b) => resolve(b), 'image/png', 0.92);
    });
    if (!blob) return;

    // Re-wrap as a real File so the upload endpoint sees a sensible name.
    const safeName = file.name.replace(/\.[^.]+$/, '') || 'image';
    const cropped = new File([blob], `${safeName}-cropped.png`, { type: 'image/png' });
    onConfirm(cropped);
  };

  // Image transform — order matters: translate first (in CSS px),
  // then scale around the center.
  const transform = useMemo(
    () => `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
    [offset.x, offset.y, scale],
  );

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) onCancel();
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{resolvedTitle}</DialogTitle>
          <DialogDescription>{resolvedDescription}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col items-center gap-4">
          {/* Viewport — the user-visible crop window. */}
          <div
            ref={viewportRef}
            className={cn(
              'relative overflow-hidden bg-black/80 select-none touch-none',
              shape === 'circle' ? 'rounded-full' : 'rounded-md',
            )}
            style={{
              width: '100%',
              maxWidth: VIEWPORT_MAX_W,
              height: viewportH,
              cursor: dragging ? 'grabbing' : 'grab',
            }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onWheel={onWheel}
          >
            {imgUrl && img ? (
              <img
                src={imgUrl}
                alt={t('imageCropDialog.previewAlt')}
                draggable={false}
                style={{
                  position: 'absolute',
                  left: '50%',
                  top: '50%',
                  width: img.naturalWidth,
                  height: img.naturalHeight,
                  transformOrigin: 'center center',
                  transform: `translate(-50%, -50%) ${transform}`,
                  pointerEvents: 'none',
                }}
              />
            ) : (
              <div className="absolute inset-0 flex items-center justify-center text-white/60 text-sm">
                <Loader2 className="h-5 w-5 animate-spin" />
              </div>
            )}
            {/* Subtle inner ring so the user always sees the crop boundary
                even on a dark image. */}
            <div
              className={cn(
                'absolute inset-0 pointer-events-none ring-1 ring-white/30',
                shape === 'circle' ? 'rounded-full' : 'rounded-md',
              )}
            />
          </div>

          {/* Zoom controls */}
          <div className="w-full flex items-center gap-3">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => setZoom((z) => Math.max(1, z / 1.15))}
              title={t('imageCropDialog.zoomOut')}
            >
              <ZoomOut className="h-4 w-4" />
            </Button>
            <input
              type="range"
              min={1}
              max={5}
              step={0.01}
              value={zoom}
              onChange={(e) => setZoom(Number(e.target.value))}
              className="flex-1 accent-primary"
              aria-label={t('imageCropDialog.zoom')}
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => setZoom((z) => Math.min(5, z * 1.15))}
              title={t('imageCropDialog.zoomIn')}
            >
              <ZoomIn className="h-4 w-4" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={reset}
              title={t('imageCropDialog.reset')}
            >
              <RotateCcw className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onCancel} disabled={uploading}>
            {t('common.cancel')}
          </Button>
          <Button type="button" onClick={handleConfirm} disabled={!img || uploading}>
            {uploading ? (
              <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
            ) : (
              <Upload className="h-4 w-4 mr-1.5" />
            )}
            {t('imageCropDialog.cropAndUpload')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
