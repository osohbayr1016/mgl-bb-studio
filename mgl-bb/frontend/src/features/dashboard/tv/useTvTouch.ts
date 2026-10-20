/**
 * TV самбарын хүрэлтийн удирдлага (touch screen kiosk).
 *
 * ЗАГВАРЫН ГОЛ ШИЙДВЭР — самбар нь ЛОББИД байрлана, зочид хүрэх боломжтой.
 * Иймд:
 *
 *   • Нэг хүрэлт (tap) нь кадрыг СОЛИХГҮЙ — зөвхөн удирдлагын мөрийг гаргана.
 *     Хажуугаар өнгөрөх хүн санамсаргүй мөргөхөд дэлгэц үсрэхгүй.
 *   • Шудрах (swipe) нь кадр солино — энэ бол зориудын хөдөлгөөн.
 *   • Удирдлага харагдаж байх үед автомат эргэлт ЗОГСОНО.  Хүн үзэж байхад
 *     кадрыг булаах нь хамгийн эвгүй зан.
 *   • 20 секунд хүрэлтгүй бол удирдлага өөрөө нуугдаж, эргэлт үргэлжилнэ —
 *     хэн нэгэн дундаа орхиод явбал самбар өөрөө хэвэндээ ордог.
 *
 * Pointer Event ашигласан (touch/mouse нэг замаар).  Зөвхөн `touchstart`
 * ашиглавал хулгана залгасан тохиолдолд удирдлага үхнэ; зөвхөн `click`
 * ашиглавал шудралт таних боломжгүй.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

/** Шудрахад шаардлагатай хэвтээ зам (px).  TV-д хуруу том тул өгөөмөр. */
const SWIPE_MIN_PX = 70;
/** Шудралт нь хэвтээ байх ёстой — босоо хөдөлгөөнөөс энэ дахин их. */
const SWIPE_AXIS_RATIO = 1.4;
/** Үүнээс удаан бол шудралт биш, чирэлт гэж үзнэ. */
const SWIPE_MAX_MS = 900;
/** Энэ радиусаас бага хөдөлгөөн бол «хүрэлт». */
const TAP_MAX_PX = 14;
/** Удирдлага хэдэн мс хүрэлтгүй байвал нуугдах вэ. */
const CONTROLS_IDLE_MS = 20_000;

export interface TvTouch {
  /** Үндсэн бүрхүүлд тараах pointer боловсруулагчид. */
  rootHandlers: {
    onPointerDown: (e: React.PointerEvent) => void;
    onPointerUp: (e: React.PointerEvent) => void;
    onPointerCancel: () => void;
  };
  controlsVisible: boolean;
  /** Удирдлагыг гаргаад хугацааг тэглэнэ (товч дарах бүрт дуудна). */
  wake: () => void;
  /** Удирдлагыг шууд нуух. */
  dismiss: () => void;
}

export function useTvTouch({
  onSwipeLeft,
  onSwipeRight,
}: {
  /** Зүүн тийш шудрав → дараагийн кадр. */
  onSwipeLeft: () => void;
  /** Баруун тийш шудрав → өмнөх кадр. */
  onSwipeRight: () => void;
}): TvTouch {
  const [controlsVisible, setControlsVisible] = useState(false);
  // `onPointerUp` нь тогтвортой (deps багатай) байх ёстой тул одоогийн
  // харагдах төлөвийг ref-ээр уншина — эс бөгөөс handler бүр render-т
  // шинэчлэгдэж, хүрэлт дунд солигдоно.
  const visibleRef = useRef(false);
  visibleRef.current = controlsVisible;
  const start = useRef<{ x: number; y: number; t: number } | null>(null);
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Callback-ууд render бүрт шинэ функц байж болзошгүй тул ref-д барина —
  // эс бөгөөс `wake`/`onPointerUp` тогтворгүй болж дахин холбогдоно.
  const swipeLeftRef = useRef(onSwipeLeft);
  const swipeRightRef = useRef(onSwipeRight);
  swipeLeftRef.current = onSwipeLeft;
  swipeRightRef.current = onSwipeRight;

  const clearIdle = () => {
    if (idleTimer.current) clearTimeout(idleTimer.current);
    idleTimer.current = null;
  };

  const wake = useCallback(() => {
    setControlsVisible(true);
    clearIdle();
    idleTimer.current = setTimeout(() => setControlsVisible(false), CONTROLS_IDLE_MS);
  }, []);

  const dismiss = useCallback(() => {
    clearIdle();
    setControlsVisible(false);
  }, []);

  useEffect(() => clearIdle, []);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    // Удирдлагын товчин дээрх хүрэлтийг шудралт гэж тооцохгүй — товч өөрөө
    // үйлдлээ хийж, `wake`-ээ дуудна.
    if (isControl(e.target)) {
      start.current = null;
      return;
    }
    start.current = { x: e.clientX, y: e.clientY, t: e.timeStamp };
  }, []);

  const onPointerUp = useCallback(
    (e: React.PointerEvent) => {
      const s = start.current;
      start.current = null;
      if (!s) return;

      const dx = e.clientX - s.x;
      const dy = e.clientY - s.y;
      const dt = e.timeStamp - s.t;
      const ax = Math.abs(dx);
      const ay = Math.abs(dy);

      const swiped =
        ax >= SWIPE_MIN_PX && ax > ay * SWIPE_AXIS_RATIO && dt <= SWIPE_MAX_MS;

      if (swiped) {
        // Шудралт нь кадрыг сольж, удирдлагыг мөн гаргана — хүн одоо
        // удирдаж байгаа тул эргэлт зогсох ёстой.
        if (dx < 0) swipeLeftRef.current();
        else swipeRightRef.current();
        wake();
        return;
      }

      // Богино, бараг хөдөлгөөнгүй хүрэлт → удирдлагыг ТОГГЛ хийнэ.
      // Дахин хүрэхэд нуугдах нь хүлээгдэж буй зан: хэрэглэгч дуусмагц
      // 20 секунд хүлээх шаардлагагүй, шууд самбар руу буцна.
      if (ax <= TAP_MAX_PX && ay <= TAP_MAX_PX) {
        if (visibleRef.current) dismiss();
        else wake();
      }
    },
    [wake, dismiss],
  );

  const onPointerCancel = useCallback(() => {
    start.current = null;
  }, []);

  return {
    rootHandlers: { onPointerDown, onPointerUp, onPointerCancel },
    controlsVisible,
    wake,
    dismiss,
  };
}

/** Хүрэлт удирдлагын элемент дээр болсон эсэх. */
function isControl(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest('[data-tv-control]') !== null;
}
