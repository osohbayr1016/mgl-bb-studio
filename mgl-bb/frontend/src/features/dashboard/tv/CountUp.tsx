/**
 * Тоо 0-ээс зорилтот утга хүртэл өсөх анимаци.
 *
 * ЯАГААД: одоогийн самбар дээр юу ч хөдөлдөггүй — дата 60 сек тутам чимээгүй
 * солигддог.  Хананд өлгөөтэй хөдөлгөөнгүй кадр нь зурган зураг шиг харагддаг
 * бөгөөд хажуугаар өнгөрөх хүний нүдийг татдаггүй.  Scene солигдох бүрт том
 * тоо өсөж эхэлбэл дэлгэц «амьд» болно.
 *
 * Хэрэгжүүлэлт нь `requestAnimationFrame` дээр, ease-out cubic.  `value`
 * өөрчлөгдвөл ОДООГИЙН харагдаж буй тооноос шинэ утга руу гүйнэ (0-ээс биш) —
 * 60 секундын дата шинэчлэлт бүрт тоо тэг рүү унаад буцаж өгсөх нь эвгүй.
 */
import { useEffect, useRef, useState } from 'react';

/** Хэдэн миллисекундэд гүйцээх вэ. */
const DURATION_MS = 1_600;

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

export function useCountUp(value: number, enabled = true): number {
  const [shown, setShown] = useState(enabled ? 0 : value);
  // Анимаци эхлэх цэг — хамгийн сүүлд ХАРАГДСАН утга.  ref-ээр барьснаар
  // effect нь `shown`-оос хамаарахгүй (эс бөгөөс frame бүрт дахин эхэлнэ).
  const fromRef = useRef(enabled ? 0 : value);

  useEffect(() => {
    if (!enabled) {
      setShown(value);
      fromRef.current = value;
      return;
    }
    const from = fromRef.current;
    const delta = value - from;
    if (delta === 0) return;

    let raf = 0;
    let start: number | null = null;
    const tick = (ts: number) => {
      if (start === null) start = ts;
      const t = Math.min(1, (ts - start) / DURATION_MS);
      const current = from + delta * easeOutCubic(t);
      setShown(current);
      fromRef.current = current;
      if (t < 1) raf = requestAnimationFrame(tick);
      else fromRef.current = value;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, enabled]);

  return shown;
}

export function CountUp({
  value,
  format,
  className,
  style,
}: {
  value: number;
  /** Тоог текст болгох — `tvNumber` эсвэл өөр форматлагч. */
  format: (n: number) => string;
  className?: string;
  style?: React.CSSProperties;
}) {
  const shown = useCountUp(value);
  return (
    <span className={className} style={style}>
      {format(shown)}
    </span>
  );
}
