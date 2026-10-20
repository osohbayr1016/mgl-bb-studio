import { useCallback, useEffect, useState } from 'react';
import { todayUB } from '@/shared/lib/time';

/**
 * УБ-ын «өнөөдөр», шөнө дундыг давахад шинэчлэгдэнэ (минут тутам + таб руу
 * буцахад).  Хуудсыг шөнөжин нээлттэй орхисон менежер маргааш өглөө бичсэн
 * ажлаа ӨЧИГДРИЙН тайланд оруулахгүй.  `sync()` — яг одоогийн огноог шууд
 * буцаана (бичих агшинд дуудна).
 */
export function useUbToday(): [string, () => string] {
  const [today, setToday] = useState(todayUB);
  const sync = useCallback(() => {
    const d = todayUB();
    setToday(d);
    return d;
  }, []);
  useEffect(() => {
    const id = window.setInterval(sync, 60_000);
    const onVisible = () => {
      if (document.visibilityState === 'visible') sync();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [sync]);
  return [today, sync];
}
