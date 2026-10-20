import { useEffect, useRef } from 'react';
import { useLocation, useSearchParams } from 'react-router-dom';

/** Элемент DOM-д гарч ирэхийг хэдэн удаа шалгах вэ (≈ 2.4 секунд). */
const MAX_TRIES = 20;
const RETRY_MS = 120;
/** Гэрэлтүүлгийн үргэлжлэх хугацаа — `index.css`-ийн `--animate-section-flash`. */
const FLASH_MS = 1700;

/*
 * Гэрэлтүүлгийн төлөв нь МОДУЛЬ түвшинд, hook-ийн effect-ээс ГАДУУР байна.
 *
 * ⚠️ Энэ нь чухал: `attempt()` нь элементээ олмогцоо `?section=`-ийг арчина,
 * тэр нь effect-ийн хамаарлыг өөрчилж, React нь өмнөх effect-ийн ЦЭВЭРЛЭГЭЭГ
 * тэр дороо ажиллуулна.  Хэрэв гэрэлтүүлгийг цэвэрлэгээнд байрлуулбал тэр нь
 * харагдахаасаа өмнө устана — өөрөөр хэлбэл анимаци хэзээ ч харагдахгүй.
 * Тиймээс гэрэлтүүлэг өөрийн таймертай, effect-ийн амьдралын мөчлөгөөс
 * хамааралгүй байна.
 */
let flashTimer = 0;
let flashEl: HTMLElement | null = null;

function flashSection(el: HTMLElement): void {
  // Хоёр хэсэг зэрэг гэрэлтэх нь төөрөгдөл — өмнөхийг нь таслана.
  if (flashEl && flashEl !== el) flashEl.removeAttribute('data-section-flash');
  window.clearTimeout(flashTimer);

  // Нэг элементийг дараалан хоёр удаа гэрэлтүүлэхэд CSS анимаци дахин
  // эхлэхгүй (шинж нь нэг кадрын дотор хасагдаад буцаж нэмэгддэг тул).
  // Албадсан reflow нь браузерыг анимацийг шинээр эхлүүлэхэд хүргэнэ.
  el.removeAttribute('data-section-flash');
  void el.offsetWidth;
  el.setAttribute('data-section-flash', '');

  flashEl = el;
  flashTimer = window.setTimeout(() => {
    flashEl?.removeAttribute('data-section-flash');
    flashEl = null;
  }, FLASH_MS);
}

/**
 * `?section=<dom-id>` — хуудасны ДОТООД хэсэг рүү шууд үсрэх нэгдсэн механизм.
 *
 * Хэрэглэгч «илүү цаг» гэж хайхад бид түүнийг `/app/attendance` руу авчраад
 * ҮЛДЭЭДЭГ байсан — цааш нь өөрөө гүйлгэж олох ёстой байв.  Одоо хайлт нь
 * `/app/attendance?section=sec-attendance-overtime` руу шилжүүлж, энэ hook нь
 * зорилтот блокийг гүйлгэн авчирч, хоромхон гэрэлтүүлээд параметрээ арчина.
 *
 * ⚠️ Энэ hook `LayoutShell`-д ГАНЦ УДАА суурилдаг — тиймээс `id` бүхий ямар ч
 * элемент нэмэлт код бичихгүйгээр шууд хаяг болно.  Шинэ хэсгийг хайлтад
 * оруулах бүтэн жор:
 *   1. блокийн гадуур `<div id="…" className="scroll-mt-24">` тавих;
 *   2. `shared/lib/search/sections.ts`-д НЭГ мөр нэмэх.
 * Гуравдугаар алхам БАЙХГҮЙ.
 *
 * Хойшлуулсан (retry) шалгалт зайлшгүй: хуудсууд `lazy()` тул шилжсэн
 * хормын дараа зорилтот `id` DOM-д хараахан байхгүй, мөн өгөгдөл ирэх хүртэл
 * skeleton харагдаж байдаг.  Олдохгүй бол (эрхээр нуугдсан таб гэх мэт)
 * чимээгүй бууж өгнө — хэрэглэгч зөв хуудсан дээрээ аль хэдийн байгаа.
 */
export function useSectionAnchor(): void {
  const [searchParams, setSearchParams] = useSearchParams();
  const { pathname } = useLocation();
  const section = searchParams.get('section');

  // `setSearchParams` нь router-ийн хувилбараас хамааран рендер бүрт шинэ
  // байж болно.  Хамаарлын жагсаалтад оруулбал effect давтагдан ажиллаж,
  // хайлт нь дуусашгүй давталтад орох эрсдэлтэй — тиймээс ref-ээр барина.
  const setParamsRef = useRef(setSearchParams);
  useEffect(() => {
    setParamsRef.current = setSearchParams;
  });

  useEffect(() => {
    if (!section) return;

    let cancelled = false;
    let tries = 0;
    let timer = 0;

    /** Параметрийг ЗАМААС арчина — сэргээж ачаалах / буцах товч цэвэр байна,
     *  мөн ИЖИЛ хэсгийг дахин хайхад effect дахин ажиллах боломж үүснэ. */
    const clearParam = () =>
      setParamsRef.current(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.delete('section');
          return next;
        },
        { replace: true },
      );

    const attempt = () => {
      if (cancelled) return;

      const el = document.getElementById(section);
      if (!el) {
        if (tries >= MAX_TRIES) {
          clearParam();
          return;
        }
        tries += 1;
        timer = window.setTimeout(attempt, RETRY_MS);
        return;
      }

      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      flashSection(el);
      clearParam();
    };

    timer = window.setTimeout(attempt, 0);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
    // `pathname` нь dep-д БАЙХ ёстой: ижил `?section=` утгатай ч өөр хуудас
    // руу шилжвэл дахин ажиллана.
  }, [section, pathname]);
}
