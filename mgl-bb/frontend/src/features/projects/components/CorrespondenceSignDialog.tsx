import { useEffect, useRef, useState } from 'react';
import { Eraser, Loader2, PenLine, Check } from 'lucide-react';
import { Button } from '@/ui/button';
import { Badge } from '@/ui/badge';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/ui/dialog';
import { cropCanvasToInk } from '@/shared/lib/trimInk';
import { useLanguage } from '@/shared/i18n';
import { toast } from '@/shared/components/Toast';
import { cn } from '@/shared/lib/utils';
import type { CorrespondenceEntry } from '@/shared/types';
import { signCorrespondence } from '@/features/projects/components/correspondenceSignatureApi';
import {
  DOC_TYPE_SHORT,
  DOC_TYPE_TONE,
} from '@/features/projects/components/correspondenceConstants';

/**
 * ЗАХИАЛАГЧИЙН гарын үсгийн цонх — эзний хүсэлт (2026-09-21): «зөвхөн энгийн
 * гарын үсгийн талбар».  Нэг canvas, «Арилгах», «Баталгаажуулах» — өөр юу ч
 * үгүй.  Зураг нь `/api/upload` (нийтийн /media) руу ЯВАХГҮЙ: PNG data URL
 * болгож `POST /correspondence/:id/sign`-д өгнө, сервер хувийн bucket-д
 * хадгална.  `SignatureCapture`-ийг дахин ашиглаагүй нь тэр л шалтгаан —
 * тэр нь нийтийн bucket руу байршуулдаг.
 */
export function CorrespondenceSignDialog({
  open,
  entry,
  onClose,
  onSigned,
}: {
  open: boolean;
  entry: CorrespondenceEntry | null;
  onClose: () => void;
  onSigned: (entry: CorrespondenceEntry) => void;
}) {
  const { t } = useLanguage();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawing = useRef(false);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);

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
    setDirty(false);
  };

  // Цонх нээгдэх бүрд цэвэр canvas.
  useEffect(() => {
    if (open) {
      // canvas нь Dialog-ийн portal-д дараагийн frame-д гарна.
      const id = requestAnimationFrame(() => resetCanvas());
      return () => cancelAnimationFrame(id);
    }
  }, [open, entry?.id]);

  const at = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const c = canvasRef.current!;
    const r = c.getBoundingClientRect();
    return {
      x: (e.clientX - r.left) * (c.width / r.width),
      y: (e.clientY - r.top) * (c.height / r.height),
    };
  };
  const onDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (busy) return;
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
    if (!dirty) setDirty(true);
  };
  const onUp = () => {
    drawing.current = false;
  };

  const confirm = async () => {
    const c = canvasRef.current;
    if (!c || !dirty || !entry) return;
    setBusy(true);
    try {
      // Тайрсан хуулбар дээр ажиллана — хэрэглэгчийн canvas хэвээр (алдаа
      // гарвал дахин зурахгүйгээр давтан илгээж болно).
      const copy = document.createElement('canvas');
      copy.width = c.width;
      copy.height = c.height;
      copy.getContext('2d')!.drawImage(c, 0, 0);
      cropCanvasToInk(copy);
      const dataUrl = copy.toDataURL('image/png');
      const res = await signCorrespondence(entry.id, dataUrl);
      toast.success(t('correspondenceSign.signedToast'));
      onSigned(res.entry);
    } catch (err) {
      toast.error(
        t('correspondenceSign.signFailed'),
        err instanceof Error ? err.message : undefined,
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="sm:max-w-md" data-testid="correspondence-sign-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <PenLine className="h-5 w-5 text-primary" />
            {t('correspondenceSign.title')}
          </DialogTitle>
        </DialogHeader>

        {entry && (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            {entry.doc_type && (
              <Badge
                variant="outline"
                className={cn('h-5 px-1.5 text-[10px] font-semibold', DOC_TYPE_TONE[entry.doc_type])}
              >
                {DOC_TYPE_SHORT[entry.doc_type]}
              </Badge>
            )}
            {entry.ref_no && <span className="font-mono text-xs text-muted-foreground">{entry.ref_no}</span>}
            <span className="font-medium break-words">{entry.subject}</span>
          </div>
        )}

        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">{t('correspondenceSign.hint')}</p>
          <div className="rounded-md border border-border bg-white p-1">
            <canvas
              ref={canvasRef}
              width={800}
              height={280}
              data-testid="signature-canvas"
              className="w-full h-[140px] touch-none cursor-crosshair rounded"
              onPointerDown={onDown}
              onPointerMove={onMove}
              onPointerUp={onUp}
              onPointerLeave={onUp}
            />
          </div>
          <div className="flex justify-end">
            <Button type="button" size="sm" variant="ghost" onClick={resetCanvas} disabled={busy || !dirty}>
              <Eraser className="h-3.5 w-3.5 mr-1.5" /> {t('correspondenceSign.clear')}
            </Button>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            {t('common.cancel')}
          </Button>
          <Button onClick={confirm} disabled={!dirty || busy} data-testid="signature-confirm">
            {busy ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
            ) : (
              <Check className="h-3.5 w-3.5 mr-1.5" />
            )}
            {t('correspondenceSign.confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
