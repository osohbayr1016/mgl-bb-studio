import { useCallback, useEffect, useRef } from 'react';

/**
 * MGL AI · УРСГАЛЫГ ДАГАСАН ГҮЙЛГЭЛТ (§30).
 *
 * ⚠️ ХОЁР ГАЖГИЙН ХООРОНДОХ ЗАМ.
 *
 *    (а) ГҮЙЛГЭЛТГҮЙ.  Токен багцлагдсны дараа `messages` нь урсгал
 *        дундуур ӨӨРЧЛӨГДӨХГҮЙ (текст нь `activeRun`-д амьдарна) тул
 *        `useEffect(..., [messages])` дээр тулгуурласан авто-гүйлгэлт
 *        ХЭЗЭЭ Ч ажиллахгүй — хэрэглэгч хариултаа гараар гүйлгэж
 *        хөөх ёстой болно.
 *
 *    (б) АЛБАДСАН ГҮЙЛГЭЛТ.  Токен бүрд доош үсрэх нь хэрэглэгчийг
 *        ДЭЭШЭЭ гүйлгэж уншихыг БОЛОМЖГҮЙ болгоно — тэр нь §30-ийн
 *        «auto-scroll loops» гэсэн яг тэр гажиг.  Мөн `behavior:
 *        'smooth'`-ыг кадр тутам дуудах нь хөтөчид тасралтгүй
 *        анимаци үүсгэж таталдана.
 *
 * ⚠️ ШИЙДЭЛ: ЗӨВХӨН ЁРООЛД НААЛДСАН ҮЕД ДАГАНА.  Хэрэглэгч дээш
 *    гүйлгэмэгц наалдац ТАСАРНА (`pinned = false`) ба буцаж ёроолд
 *    ирэх хүртэл автоматаар хөдлөхгүй.  Энэ нь чат програмуудын
 *    хүлээгддэг зан төлөв.
 *
 * ⚠️ ЦЭВЭР DOM — React-ийн төлөв ХӨНДӨГДӨХГҮЙ.  Гүйлгэлт нь харагдац
 *    бөгөөд түүнийг `useState`-д барих нь кадр тутам дахин рендер
 *    үүсгэнэ, өөрөөр хэлбэл засаж буй асуудлаа өөрөө хийнэ.
 */
export interface StickyScroll {
  /** Гүйлгэдэг элементэд залгана. */
  containerRef: React.RefObject<HTMLDivElement | null>;
  /** Шинэ агуулга нэмэгдсэнийг мэдэгдэнэ (урсгалын үед кадр тутам). */
  follow: () => void;
  /** «Доош» товч — наалдацыг ХҮЧЭЭР сэргээнэ. */
  jumpToBottom: () => void;
}

/** Ёроолоос энэ хэмжээнд байвал «наалдсан» гэж үзнэ. */
const PIN_THRESHOLD_PX = 80;

export function useStickyScroll(): StickyScroll {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const pinnedRef = useRef(true);
  /** ⚠️ Кадрын товлолт — `follow` нь кадр тутам дуудагдаж болно. */
  const frameRef = useRef<number | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (el === null) return;

    const onScroll = () => {
      const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
      pinnedRef.current = distance <= PIN_THRESHOLD_PX;
    };

    // ⚠️ `passive` — гүйлгэлтийн боловсруулагч нь кадрыг ХОЙШЛУУЛАХ
    //    ЁСГҮЙ.  Энэ нь зөвхөн уншиж байгаа тул passive нь аюулгүй.
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      el.removeEventListener('scroll', onScroll);
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    };
  }, []);

  const follow = useCallback(() => {
    if (!pinnedRef.current) return;
    if (frameRef.current !== null) return;
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null;
      const el = containerRef.current;
      if (el === null || !pinnedRef.current) return;
      // ⚠️ `behavior: 'auto'` — урсгалын үед ЗААВАЛ.  `smooth` нь кадр
      //    тутам шинэ анимаци эхлүүлж, гүйлгэлт нь ард нь хоцорно.
      el.scrollTop = el.scrollHeight;
    });
  }, []);

  const jumpToBottom = useCallback(() => {
    pinnedRef.current = true;
    const el = containerRef.current;
    if (el === null) return;
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, []);

  return { containerRef, follow, jumpToBottom };
}
