import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Маягтын ноорогийг localStorage-д хадгалах.
 *
 * Яагаад хэрэгтэй: энэ апп-д маягтын ноорогийг диск рүү хадгалдаг
 * механизм өмнө нь БАЙГААГҮЙ.  `useAutosave` бүр серверт PATCH хийдэг,
 * `mutations.retry = false`, service worker нь GET-ээс өөрийг алгасдаг,
 * `apiFetch`-д timeout байхгүй.  Барилгын талбай дээр (муу сүлжээ,
 * камер асаахад iOS фонд байгаа таб-ыг санах ойн дарамтаар хаадаг)
 * энэ нь 15 минутын ажил, хоёр хүний гарын үсэг алдагдана гэсэн үг.
 *
 * ⚠️ ЗӨВХӨН R2 URL хадгална — data URL эсвэл blob хэзээ ч биш.
 *    localStorage ≈5 МБ; base64 зураг тэр квотыг нэг тайлангаар дүүргэнэ.
 */

export interface LocalDraft<T> {
  /** Хадгалагдсан ноорог (сэргээгээгүй байхад ч уншигдана). */
  saved: T | null;
  /** Одоогийн утгыг debounce-оор диск рүү бичнэ. */
  persist: (value: T) => void;
  /** Ноорогийг устгана (амжилттай илгээсэн эсвэл «Хаях» дарсан үед). */
  clear: () => void;
}

export function useLocalDraft<T>(key: string | null, debounceMs = 500): LocalDraft<T> {
  const [saved] = useState<T | null>(() => read<T>(key));
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef<T | null>(null);

  const flush = useCallback(() => {
    if (!key || pending.current === null) return;
    try {
      localStorage.setItem(key, JSON.stringify(pending.current));
    } catch {
      // Квот дүүрсэн / private mode — ноорог бол нэмэлт хамгаалалт тул
      // үндсэн урсгалыг хэзээ ч зогсоохгүй.
    }
    pending.current = null;
  }, [key]);

  const persist = useCallback(
    (value: T) => {
      if (!key) return;
      pending.current = value;
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(flush, debounceMs);
    },
    [key, debounceMs, flush],
  );

  const clear = useCallback(() => {
    if (!key) return;
    if (timer.current) clearTimeout(timer.current);
    pending.current = null;
    try {
      localStorage.removeItem(key);
    } catch {
      /* хамаагүй */
    }
  }, [key]);

  // Таб фон руу орох / хаагдах үед хүлээгдэж буй бичилтийг шууд гүйцээнэ.
  // `beforeunload` дангаараа хангалтгүй: iOS Safari таб-ыг устгахдаа
  // түүнийг ихэвчлэн дуудахгүй, харин `visibilitychange` дуудагддаг.
  useEffect(() => {
    const onHide = () => flush();
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', onHide);
    window.addEventListener('beforeunload', onHide);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', onHide);
      window.removeEventListener('beforeunload', onHide);
      flush();
    };
  }, [flush]);

  return { saved, persist, clear };
}

function read<T>(key: string | null): T | null {
  if (!key) return null;
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}
