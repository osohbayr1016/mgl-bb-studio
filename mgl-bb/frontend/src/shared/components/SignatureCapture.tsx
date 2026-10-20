import { useEffect, useRef, useState } from 'react';
import { Button } from '@/ui/button';
import { uploadFile, MEDIA_BASE_URL } from '@/shared/api/client';
import { cropCanvasToInk, cropInkFile } from '@/shared/lib/trimInk';
import { useLanguage } from '@/shared/i18n';
import { toast } from '@/shared/components/Toast';
import { Pencil, Upload, Trash2, Eraser, Loader2, Check, PenLine } from 'lucide-react';

/**
 * Capture / manage a saved signature image.  Two ways to set it (both enabled):
 *   - Draw on a canvas (pointer/touch) → PNG.
 *   - Upload an image file.
 * Either way it uploads to R2 via the shared upload endpoint and reports the
 * resulting `/media/<key>` URL through `onChange`.  The parent persists it
 * (PATCH /auth/profile for self, PUT /api/users/:id for admin).
 */
export function SignatureCapture({
  value,
  onChange,
  disabled,
  allowDraw = true,
  alt = 'signature',
  savedUrl = null,
}: {
  value: string | null;
  onChange: (url: string | null) => void;
  disabled?: boolean;
  /**
   * Хэрэглэгчийн профайлд хадгалсан гарын үсэг (`users.signature_url`).
   * Өгвөл «Гарын үсэг ашиглах» товч гарч, дахин зурах/байршуулахгүйгээр
   * шууд тэр зургийг сонгоно.  Сонголт нь ЗӨВХӨН энэ талбарт хамаарна —
   * профайлын мөрийг хөнддөггүй.
   */
  savedUrl?: string | null;
  /**
   * Гараар ЗУРАХ горимыг зөвшөөрөх эсэх. ТАМГА зурдаг зүйл БИШ — тэр нь
   * сканнердсан/зурагласан дүрс тул зөвхөн файл оруулна (`allowDraw={false}`).
   */
  allowDraw?: boolean;
  alt?: string;
}) {
  const { t } = useLanguage();
  const [mode, setMode] = useState<'idle' | 'draw'>('idle');
  const [busy, setBusy] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const drawing = useRef(false);
  const dirty = useRef(false);

  const resetCanvas = () => {
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.strokeStyle = '#111';
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    dirty.current = false;
  };

  useEffect(() => {
    if (mode === 'draw') resetCanvas();
  }, [mode]);

  const at = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const c = canvasRef.current!;
    const r = c.getBoundingClientRect();
    return { x: (e.clientX - r.left) * (c.width / r.width), y: (e.clientY - r.top) * (c.height / r.height) };
  };
  const onDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    drawing.current = true;
    const ctx = canvasRef.current!.getContext('2d')!;
    const { x, y } = at(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    const ctx = canvasRef.current!.getContext('2d')!;
    const { x, y } = at(e);
    ctx.lineTo(x, y);
    ctx.stroke();
    dirty.current = true;
  };
  const onUp = () => {
    drawing.current = false;
  };

  const saveDrawing = async () => {
    const c = canvasRef.current;
    if (!c || !dirty.current) {
      setMode('idle');
      return;
    }
    setBusy(true);
    try {
      cropCanvasToInk(c);
      const blob = await new Promise<Blob | null>((res) => c.toBlob(res, 'image/png'));
      if (!blob) throw new Error('toBlob failed');
      const file = new File([blob], `signature-${blob.size}.png`, { type: 'image/png' });
      const url = await uploadFile(file);
      onChange(url);
      setMode('idle');
    } catch (err) {
      console.error('[signature] save failed', err);
      toast.error(t('signature.saveFailed'), err instanceof Error ? err.message : undefined);
    } finally {
      setBusy(false);
    }
  };

  const handleUpload = async (file: File | null) => {
    if (!file) return;
    setBusy(true);
    try {
      const url = await uploadFile(await cropInkFile(file));
      onChange(url);
    } catch (err) {
      console.error('[signature] upload failed', err);
      toast.error(t('signature.uploadFailed'), err instanceof Error ? err.message : undefined);
    } finally {
      setBusy(false);
    }
  };

  if (mode === 'draw') {
    return (
      <div className="space-y-2">
        <canvas
          ref={canvasRef}
          width={500}
          height={160}
          aria-label={t('signature.draw')}
          className="w-full rounded-md border border-border bg-white touch-none"
          style={{ aspectRatio: '500 / 160' }}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerLeave={onUp}
        />
        {/* Доорх `idle` төлөвийн мөртэй ижил — 3 монгол шошготой товч нарийн
            дэлгэцэд нэг мөрөнд багтахгүй. */}
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" onClick={saveDrawing} disabled={busy}>
            {busy ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Check className="h-4 w-4 mr-2" />}
            {t('common.save')}
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={resetCanvas} disabled={busy}>
            <Eraser className="h-4 w-4 mr-2" /> {t('signature.clear')}
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setMode('idle')} disabled={busy}>
            {t('common.cancel')}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {/* ⚠️ Урьдчилан харагдацын өргөнийг ЗААВАЛ хязгаарлана.  `h-20
          object-contain` дан байхад өргөн нь зургийн харьцаагаар
          тодорхойлогдоно: гараар зурсан 500×160 нь ~250px болж багтдаг ч,
          ХЭРЭГЛЭГЧИЙН БАЙРШУУЛСАН өргөн зураг (ж: 3000×200) 1200px болж,
          багтаж байсан диалогийг хажуу тийш гүйлгэдэг. */}
      {value ? (
        <div className="inline-block max-w-full rounded-md border border-border bg-white p-2">
          <img
            src={`${MEDIA_BASE_URL}${value}`}
            alt={alt}
            className="h-20 max-w-full object-contain"
          />
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">{t('signature.none')}</p>
      )}
      <div className="flex flex-wrap gap-2">
        {savedUrl && savedUrl !== value && (
          <Button
            type="button"
            size="sm"
            onClick={() => onChange(savedUrl)}
            disabled={disabled || busy}
            data-testid="signature-use-saved"
          >
            <PenLine className="h-4 w-4 mr-2" /> {t('signature.useSaved')}
          </Button>
        )}
        {allowDraw && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => setMode('draw')}
            disabled={disabled || busy}
          >
            <Pencil className="h-4 w-4 mr-2" /> {t('signature.draw')}
          </Button>
        )}
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => handleUpload(e.target.files?.[0] ?? null)}
        />
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => fileRef.current?.click()}
          disabled={disabled || busy}
        >
          {busy ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Upload className="h-4 w-4 mr-2" />}
          {t('signature.upload')}
        </Button>
        {value && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="text-destructive"
            onClick={() => onChange(null)}
            disabled={disabled || busy}
          >
            <Trash2 className="h-4 w-4 mr-2" /> {t('signature.remove')}
          </Button>
        )}
      </div>
    </div>
  );
}
