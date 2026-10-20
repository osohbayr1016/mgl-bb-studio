import { useEffect, useState } from 'react';

/**
 * Утгыг ХОЙШЛУУЛЖ буцаана — хэрэглэгч бичихээ зогсоосны дараа л шинэ утга
 * гарч ирнэ.
 *
 * ⚠️ ЯАГААД ХЭРЭГТЭЙ ВЭ: sidebar-ын хайлт нь товчлуур дарах БҮРТ дахин
 * render хийдэг.  Серверийн хайлтыг (`GET /api/search`) шууд тэр мөрөнд
 * холбовол «Хөшигтийн» гэж бичихэд ~10 хүсэлт үүсч, сүүлийнхээс өмнөх
 * бүгд нь дэмий (мөн хариу нь дараалал алдаж ирж болно).  250мс нь
 * хүний бичих хурдны завсарлагаас арай урт — нэг л хүсэлт үлдэнэ.
 *
 * ⚠️ Энэ hook нь `enabled`-ийг ОРЛОХГҮЙ.  Дуудагч нь «хайж байгаа эсэх»-ийг
 * ХОЙШЛООГҮЙ утгаар (`q`) шалгах ёстой — эс бөгөөс хэрэглэгч талбараа
 * цэвэрлэсний дараа ч 250мс турш хуучин мөрөөр хүсэлт явуулна.
 */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [settled, setSettled] = useState<T>(value);

  useEffect(() => {
    const timer = window.setTimeout(() => setSettled(value), delayMs);
    return () => window.clearTimeout(timer);
  }, [value, delayMs]);

  return settled;
}

export default useDebouncedValue;
