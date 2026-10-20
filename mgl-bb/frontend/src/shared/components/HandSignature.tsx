import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { cropInkUrl, fitInkDisplayMm, signatureDisplayMm } from '@/shared/lib/trimInk';

export type FitToInkOpts = {
  maxHeightMm: number;
  maxWidthMm: number;
  pxPerMm?: number;
};

function measureInkStyle(
  img: HTMLImageElement,
  fitToInk: FitToInkOpts | 'document',
): CSSProperties | undefined {
  if (fitToInk === 'document') {
    const n = signatureDisplayMm(img.naturalWidth, img.naturalHeight);
    return n ? { height: `${n.heightMm}mm`, width: `${n.widthMm}mm` } : undefined;
  }
  const fit = fitInkDisplayMm(
    img.naturalWidth,
    img.naturalHeight,
    fitToInk.maxHeightMm,
    fitToInk.maxWidthMm,
    fitToInk.pxPerMm,
  );
  return fit ? { height: `${fit.heightMm}mm`, width: 'auto' } : undefined;
}

/**
 * Баримтын гарын үсэг — цагаан хүрээг тайрч, бэхийг нүдэнд дүүргэнэ.
 * `fitToInk` өгвөл зурсан бэхний жинхэнэ хэмжээг mm-ээр тооцож харуулна.
 */
export function HandSignature({
  src,
  className,
  alt = '',
  fitToInk,
}: {
  src: string;
  className?: string;
  alt?: string;
  /**
   * `'document'` — A4 баримтын жигд хэмжээ (`signatureDisplayMm`: өндөр ≈ 12 мм,
   * өргөн ≤ 44 мм), пикселийн нягтаас үл хамаарна.  Объект — хуучин «бодит
   * хэмжээ, хайрцгаас том бол л багасгах» горим.
   */
  fitToInk?: FitToInkOpts | 'document';
}) {
  const [href, setHref] = useState(src);
  const [phase, setPhase] = useState<'pending' | 'ready'>('pending');
  const [inkStyle, setInkStyle] = useState<CSSProperties | undefined>();
  const imgRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
    let dead = false;
    setHref(src);
    setPhase('pending');
    setInkStyle(undefined);
    if (!src) {
      setPhase('ready');
      return;
    }
    void cropInkUrl(src)
      .then((next) => {
        if (dead) return;
        if (next) setHref(next);
        setPhase('ready');
      })
      .catch(() => {
        if (!dead) setPhase('ready');
      });
    return () => {
      dead = true;
    };
  }, [src]);

  useEffect(() => {
    if (!fitToInk || phase !== 'ready') return;
    const img = imgRef.current;
    if (img?.complete && img.naturalWidth > 0) {
      setInkStyle(measureInkStyle(img, fitToInk));
    }
  }, [href, phase, fitToInk]);

  const onLoad = useCallback(
    (e: React.SyntheticEvent<HTMLImageElement>) => {
      if (!fitToInk) return;
      setInkStyle(measureInkStyle(e.currentTarget, fitToInk));
    },
    [fitToInk],
  );

  if (!src) return null;
  return (
    <img
      ref={imgRef}
      src={href}
      alt={alt}
      className={className}
      style={inkStyle}
      data-hand-sign={phase}
      onLoad={onLoad}
    />
  );
}

/** PDF/print: тайралт дуустал хүлээнэ. Байхгүй бол шууд дуусна. */
export function whenHandSignsReady(ms = 6000): Promise<void> {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const tick = () => {
      if (!document.querySelector('[data-hand-sign="pending"]') || Date.now() - t0 > ms) {
        resolve();
        return;
      }
      requestAnimationFrame(tick);
    };
    tick();
  });
}
