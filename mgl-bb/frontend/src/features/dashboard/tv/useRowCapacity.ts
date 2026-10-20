/**
 * Жагсаалтад ХЭДЭН МӨР БОДИТООР БАГТАХЫГ хэмжиж өгөх hook.
 *
 * ЯАГААД ХЭРЭГТЭЙ ВЭ (2026-08-25-ны эвдрэл): мөрийн тоог гараар `slice(0, 9)`
 * гэж тогтоосон байсан бөгөөд мөрийн бодит өндөр нь дэлгэцийн өндөр, фонтын
 * vw хэмжээ, бичвэр мөр таслагдсан эсэх, удирдлагын мөр гарсан эсэх — эдгээр
 * бүгдээс хамаардаг.  Тааруулсан тоо буруу болмогц жагсаалт нь `flex-1
 * justify-center` савнаасаа ХОЁР ТИЙШ халиад хүснэгтийн толгой ба доод
 * тайлбарын ДЭЭГҮҮР давхарлаж, хуудас бүхэлдээ эвдэрсэн харагддаг байв.
 *
 * ⇒ Тоог хэмжилтээс гаргана: савны өндөр ÷ ЭХНИЙ МӨРИЙН бодит өндөр.  Хагас
 *   мөрийн нөөц үлдээдэг тул 1px-ийн зөрүү хэзээ ч давхцал болж хувирахгүй.
 *
 * ХЭРЭГЛЭХ ГУРВАН АЛХАМ:
 *   1. `const { ref, capacity } = useRowCapacity(MAX_ROWS)`
 *   2. Савандаа `ref` + `overflow-hidden` (эхний кадрын хэмжилт хийгдэх хүртэл
 *      бүх мөр зурагдана — таслагдах нь давхарлахаас дээр).
 *   3. Мөр бүр дээр `data-tv-row` — хэмжигдэх мөрийг ингэж олно.
 */
import { useLayoutEffect, useRef, useState } from 'react';

export function useRowCapacity(max: number, min = 3) {
  const ref = useRef<HTMLDivElement>(null);
  const [capacity, setCapacity] = useState(max);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    let raf = 0;

    const measure = () => {
      const row = el.querySelector<HTMLElement>('[data-tv-row]');
      const rowH = row?.getBoundingClientRect().height ?? 0;
      const boxH = el.clientHeight;
      if (rowH <= 0 || boxH <= 0) return;
      const fits = Math.floor((boxH - rowH * 0.5) / rowH);
      const next = Math.max(min, Math.min(max, fits));
      // rAF-аар хойшлуулсан нь ЗОРИУД: effect дотор шууд setState хийвэл
      // React каскад дүрслэл өгөх бөгөөд сав нь `flex-1` тул хэмжээ нь
      // өөрчлөгдөхгүй — давталт үүсэхгүй.
      raf = requestAnimationFrame(() => setCapacity((prev) => (prev === next ? prev : next)));
    };

    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [max, min]);

  return { ref, capacity };
}
