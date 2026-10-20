import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react';
import { useLocation, useNavigationType } from 'react-router-dom';

/** POP (буцах) үед агуулга ачаалагдтал сэргээхийг оролдох хугацаа. */
const RESTORE_WINDOW_MS = 600;

/**
 * Гүйлгэлтийн байрлалыг жинхэнэ аппын дүрмээр удирдана.
 *
 *   • Шинэ хуудас руу орох (PUSH/REPLACE) → үргэлж ДЭЭРЭЭС эхэлнэ.
 *   • Буцах (POP)                          → өмнөх байрлалыг сэргээнэ.
 *
 * Яагаад заавал өөрсдөө хийх ёстой вэ: браузерын өөрийн сэргээлт нь
 * ДОКУМЕНТ гүйлгэгддэг гэж үздэг.  Энэ аппын Layout нь `h-dvh
 * overflow-hidden` бүрхүүл дотор `<main>`-ыг ганц гүйлгэгч болгодог тул
 * документ хэзээ ч гүйлгэгддэггүй — өөрөөр хэлбэл браузер юу ч сэргээх
 * боломжгүй бөгөөд гүйлгэгч нь маршрут солигдоход хуучин байрлалаа
 * хэвээр хадгалдаг.  Үүнээс болж урт жагсаалтыг гүйлгээд ямар нэг зүйл
 * дарахад шинэ хуудас дунднаасаа нээгддэг байсан.
 *
 * Хадгалалт нь `scroll` эвентээр (passive) явагдана — cleanup дээр
 * уншвал DOM аль хэдийн шинэ, богино агуулгаар солигдсон байх тул
 * `scrollTop` шахагдаад буруу утга гарна.
 */
export function useScrollRestoration(ref: RefObject<HTMLElement | null>) {
  const location = useLocation();
  const navigationType = useNavigationType();
  const positions = useRef(new Map<string, number>());
  const prevPathname = useRef(location.pathname);

  // 1) Одоогийн хуудсын байрлалыг тасралтгүй тэмдэглэнэ.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const key = location.key;
    const onScroll = () => positions.current.set(key, el.scrollTop);
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, [ref, location.key]);

  // 2) Маршрут солигдоход байрлалыг тавина.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;

    // ⚠️ Зөвхөн ЗАМ солигдоход дээрээс эхэлнэ, `location.key` солигдох болгонд
    // биш.  `setSearchParams()` (шүүлтүүр, таб, `?action=` арчих) нь шинэ key
    // үүсгэдэг тул key-ээр шалгавал шүүлтүүр солих бүрд хуудас дээшээ үсэрнэ.
    const pathChanged = prevPathname.current !== location.pathname;
    prevPathname.current = location.pathname;

    if (navigationType !== 'POP' && !pathChanged) return;

    const target = navigationType === 'POP' ? (positions.current.get(location.key) ?? 0) : 0;

    if (target === 0) {
      el.scrollTop = 0;
      return;
    }

    // Маршрутууд нь lazy — сэргээх мөчид агуулга хараахан ирээгүй байвал
    // `scrollTop` нь одоогийн (богино) өндөрт шахагдана.  Агуулга томрох
    // хүртэл богино хугацаанд дахин оролдоно.
    let cancelled = false;
    const deadline = performance.now() + RESTORE_WINDOW_MS;

    const attempt = () => {
      if (cancelled) return;
      el.scrollTop = target;
      // Хүссэн байрлалдаа хүрсэн, эсвэл хугацаа дууссан бол зогсоно.
      if (Math.abs(el.scrollTop - target) < 2 || performance.now() > deadline) return;
      requestAnimationFrame(attempt);
    };
    attempt();

    return () => {
      cancelled = true;
    };
  }, [ref, location.key, location.pathname, navigationType]);
}
