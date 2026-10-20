import { useEffect, useRef, useState, type RefObject } from 'react';

/** Сэргээлт эхлэхэд шаардагдах татах зай (px). */
const THRESHOLD = 70;
/** Хамгийн ихдээ ийш татагдана — цаашаа сунахгүй. */
const MAX_PULL = 110;
/** Хурууны зам → индикаторын зам харьцаа (эсэргүүцлийн мэдрэмж). */
const DAMPING = 0.5;
/** Эргэлдэгч хэт богино анивчихгүй байх доод хугацаа. */
const MIN_SPIN_MS = 550;

interface PullToRefreshResult {
  /** Индикаторын элементэд залгана. */
  indicatorRef: RefObject<HTMLDivElement | null>;
  refreshing: boolean;
}

/**
 * Аппын ӨӨРИЙН «доош татаад сэргээх».
 *
 * Яагаад браузерынхыг ашиглаагүй вэ: `index.css`-д `overscroll-behavior: none`
 * тавьж браузерын pull-to-refresh-ийг зориуд унтраасан — ажил дунд санамсаргүй
 * татахад ХУУДАС БҮХЭЛДЭЭ дахин ачаалагдаж, бөглөж байсан маягт алдагддаг.
 * Энэ хувилбар нь хуудсыг огт дахин ачаалахгүй, зөвхөн `onRefresh`-ыг дуудна
 * (өгөгдлөө дахин татах) — жинхэнэ утасны аппууд яг ингэдэг.
 *
 * Гүйцэтгэл: татах явцад React дахин render хийхгүй.  Индикаторын
 * `transform`-ыг шууд DOM дээр бичнэ — ингэснээр хуруу дагасан хөдөлгөөн
 * кадр алдахгүй.  `refreshing` төлөв нь зөвхөн эхлэх/дуусах 2 мөчид солигдоно.
 */
export function usePullToRefresh(
  scrollerRef: RefObject<HTMLElement | null>,
  onRefresh: () => Promise<unknown>,
  enabled: boolean,
): PullToRefreshResult {
  const indicatorRef = useRef<HTMLDivElement>(null);
  const [refreshing, setRefreshing] = useState(false);

  // Сүүлийн callback-ийг ref-ээр барина — эс тэгвэл эцэг нь шинэ функц
  // дамжуулах болгонд listener-ууд салж, дахин холбогдоно.
  const onRefreshRef = useRef(onRefresh);
  useEffect(() => {
    onRefreshRef.current = onRefresh;
  });

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el || !enabled) return;

    const indicator = indicatorRef.current;
    let startY = 0;
    let pull = 0;
    let tracking = false;
    let busy = false;

    const paint = (y: number, spinning: boolean) => {
      if (!indicator) return;
      const progress = Math.min(1, y / THRESHOLD);
      indicator.style.transform = `translate3d(-50%, ${y}px, 0)`;
      indicator.style.opacity = String(progress);
      // Босгонд хүрэхээс өмнө эргэлдэхгүй — хуруу дагаж эргэнэ.
      indicator.style.setProperty('--ptr-rotate', `${y * 3}deg`);
      indicator.dataset.spinning = spinning ? 'true' : 'false';
    };

    const reset = (animated: boolean) => {
      pull = 0;
      tracking = false;
      if (indicator) {
        indicator.style.transition = animated ? 'transform 200ms ease-out, opacity 200ms ease-out' : '';
        paint(0, false);
      }
    };

    // Эхний утгыг inline-аар нэг удаа тавина.  Үүнээс хойш `transform`/
    // `opacity`-г ЗӨВХӨН энэ hook бичнэ — React тэднийг мэдэхгүй тул
    // дахин render хийхэд хөндөгдөхгүй.
    paint(0, false);

    const onTouchStart = (e: TouchEvent) => {
      if (busy || e.touches.length !== 1) return;
      // Зөвхөн ЖИНХЭНЭ дээд захаас эхэлсэн татах нь тоологдоно.
      if (el.scrollTop > 0) return;
      const touch = e.touches[0];
      if (!touch) return;
      startY = touch.clientY;
      tracking = true;
      if (indicator) indicator.style.transition = '';
    };

    const onTouchMove = (e: TouchEvent) => {
      if (!tracking || busy) return;
      const touch = e.touches[0];
      if (!touch) return;
      // Хэрэглэгч татах дундаа доош гүйлгэвэл татахаа болино.
      if (el.scrollTop > 0) {
        reset(false);
        return;
      }
      const dy = touch.clientY - startY;
      if (dy <= 0) {
        pull = 0;
        paint(0, false);
        return;
      }
      pull = Math.min(MAX_PULL, dy * DAMPING);
      paint(pull, false);
    };

    const onTouchEnd = () => {
      if (!tracking || busy) return;
      tracking = false;
      if (pull < THRESHOLD) {
        reset(true);
        return;
      }
      busy = true;
      setRefreshing(true);
      if (indicator) {
        indicator.style.transition = 'transform 160ms ease-out';
        paint(THRESHOLD, true);
      }
      const startedAt = Date.now();
      void Promise.resolve(onRefreshRef.current())
        .catch(() => undefined)
        .then(() => {
          // Хэт хурдан дуусвал эргэлдэгч анивчаад л алга болно.
          const wait = Math.max(0, MIN_SPIN_MS - (Date.now() - startedAt));
          return new Promise((r) => setTimeout(r, wait));
        })
        .then(() => {
          busy = false;
          setRefreshing(false);
          reset(true);
        });
    };

    // Бүгд passive: `overscroll-behavior: none` тул `scrollTop === 0` дээр
    // доош чирэхэд браузер юу ч гүйлгэхгүй — preventDefault шаардлагагүй.
    el.addEventListener('touchstart', onTouchStart, { passive: true });
    el.addEventListener('touchmove', onTouchMove, { passive: true });
    el.addEventListener('touchend', onTouchEnd, { passive: true });
    el.addEventListener('touchcancel', onTouchEnd, { passive: true });
    return () => {
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMove);
      el.removeEventListener('touchend', onTouchEnd);
      el.removeEventListener('touchcancel', onTouchEnd);
    };
  }, [scrollerRef, enabled]);

  return { indicatorRef, refreshing };
}
