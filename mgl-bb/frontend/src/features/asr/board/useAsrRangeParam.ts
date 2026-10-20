import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { normalizeRange, type AsrRange } from '../lib/asrRange';

/**
 * Самбарын хугацааг URL-д хадгална (`?from=2026-09-01&to=2026-09-30`) —
 * холбоосоор хуваалцах, хуудас сэргээх, тайлан нээгээд буцахад хугацаа
 * алдагдахгүй.  «Бүх хугацаа» = параметргүй.  Түүх рүү `replace`-ээр бичнэ
 * (хугацаа солих бүр «буцах» товчийг бөглөхгүй) — `useTabParam`-ийн хэв маяг.
 *
 * Төслийн хуудасны «ЗХ» таб дотор өөр табууд ижил URL-ийг хуваалцдаг тул
 * тэнд `asr_from` / `asr_to` гэсэн нэр өгнө.
 */
export function useAsrRangeParam(
  fromKey = 'from',
  toKey = 'to',
): [AsrRange, (next: AsrRange) => void] {
  const [searchParams, setSearchParams] = useSearchParams();
  const rawFrom = searchParams.get(fromKey);
  const rawTo = searchParams.get(toKey);
  const range = useMemo(() => normalizeRange(rawFrom, rawTo), [rawFrom, rawTo]);

  const setRange = useCallback(
    (next: AsrRange) => {
      setSearchParams(
        (prev) => {
          const p = new URLSearchParams(prev);
          if (next.from) p.set(fromKey, next.from);
          else p.delete(fromKey);
          if (next.to) p.set(toKey, next.to);
          else p.delete(toKey);
          return p;
        },
        { replace: true },
      );
    },
    [setSearchParams, fromKey, toKey],
  );

  return [range, setRange];
}
