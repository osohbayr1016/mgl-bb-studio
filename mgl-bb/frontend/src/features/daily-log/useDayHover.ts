import { useCallback, useEffect, useState, type MouseEvent } from 'react';

/**
 * `DayHoverCard`-ын төлөв: эцэг элементийн `onMouseMove` нь `[data-date]`-тай
 * нүдийг олж байрлалыг нь санана (нүд бүрт listener тавихгүй).  `mouseover`
 * БИШ `mousemove`: гүйлгэхэд карт нуугдах ба тэр үед заагч аль хэдийн ижил
 * нүдэн дээр байвал `mouseover` дахин ирэхгүй — `mousemove` нь хулгана бага
 * зэрэг хөдөлмөгц картыг буцаана.  Ижил нүдэн дээр төлөв солигдохгүй тул
 * дахин рендер үүсгэхгүй.
 */
export interface DayHover {
  date: string;
  /** Нүдний `data-hover-key` (жишээ нь матрицын хэрэглэгчийн id). */
  key: string | null;
  rect: DOMRect;
}

export function useDayHover() {
  const [hover, setHover] = useState<DayHover | null>(null);

  const onMouseMove = useCallback((e: MouseEvent) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-date]');
    const date = el?.dataset.date;
    if (!el || !date) {
      setHover(null);
      return;
    }
    const key = el.dataset.hoverKey ?? null;
    setHover((h) =>
      h && h.date === date && h.key === key ? h : { date, key, rect: el.getBoundingClientRect() },
    );
  }, []);

  const onMouseLeave = useCallback(() => setHover(null), []);

  /** Гарын курсорт: элементийн байрлалаар картыг харуулна. */
  const showAt = useCallback(
    (el: Element | null, date: string | null, key: string | null = null) => {
      setHover(el && date ? { date, key, rect: el.getBoundingClientRect() } : null);
    },
    [],
  );

  // Гүйлгэхэд нүдний байрлал өөрчлөгдөнө — хуучин байрлалд үлдэхээс нууна.
  useEffect(() => {
    if (!hover) return;
    const hide = () => setHover(null);
    window.addEventListener('scroll', hide, true);
    window.addEventListener('resize', hide);
    return () => {
      window.removeEventListener('scroll', hide, true);
      window.removeEventListener('resize', hide);
    };
  }, [hover]);

  return { hover, onMouseMove, onMouseLeave, showAt };
}
