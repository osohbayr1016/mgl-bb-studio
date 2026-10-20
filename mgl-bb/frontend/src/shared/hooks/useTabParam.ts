import { useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';

/**
 * Табны идэвхтэй утгыг URL-д хадгалах нэгдсэн hook.
 *
 * Урьд нь таб бүр `useState`-д сууж байсан бөгөөд энэ нь гурван зүйлийг
 * үгүй хийдэг байв: (1) табыг хуваалцах / хавчуулах, (2) сэргээж ачаалахад
 * буцаж ирэх, (3) глобал хайлтаас ШУУД табруу үсрэх.  Гуравдахь нь одоо
 * шаардлага болсон — «Хаагдаагүй» гэж хайхад хэрэглэгчийг ирцийн самбарын
 * НЭГДҮГЭЭР таб дээр орхиж болохгүй.
 *
 * Хэв маяг нь `QuotesPage`-ийн аль хэдийн ажиллаж байсан кодоос авсан:
 * ӨГӨГДМӨЛ таб дээр параметрийг АРЧИНА (`?tab=list` гэж бохирдуулахгүй),
 * танигдахгүй утгыг чимээгүй өгөгдмөл рүү буулгана, түүх рүү бичихдээ
 * `replace` (таб солих бүрт «буцах» товч ажиллахгүй болно).
 *
 *   const TABS = ['today', 'open', 'reports'] as const;
 *   const [tab, setTab] = useTabParam(TABS, 'today');
 *   <KeepAliveTabs value={tab} onValueChange={(v) => setTab(v as (typeof TABS)[number])}>
 *
 * @param tabs       Зөвшөөрөгдөх утгууд — бусад бүх зүйл өгөгдмөл рүү унана.
 * @param defaultTab Параметргүй үеийн утга; мөн URL-ээс арчигдах утга.
 * @param param      URL параметрийн нэр.  Нэг хуудсанд ХОЁР бие даасан
 *                   сонголт байвал (жишээ нь таб + дэд таб) өөр нэр өгнө.
 */
export function useTabParam<T extends string>(
  tabs: readonly T[],
  defaultTab: T,
  param = 'tab',
): [T, (next: T) => void] {
  const [searchParams, setSearchParams] = useSearchParams();

  const raw = searchParams.get(param);
  const active = (tabs as readonly string[]).includes(raw ?? '') ? (raw as T) : defaultTab;

  const setActive = useCallback(
    (next: T) => {
      setSearchParams(
        (prev) => {
          const p = new URLSearchParams(prev);
          if (next === defaultTab) p.delete(param);
          else p.set(param, next);
          // Таб солиход хэсгийн анкор утгаа алдана — өөр таб руу гүйлгэх нь
          // утгагүй.  (`useSectionAnchor` өөрөө ч арчдаг ч энд солих үед
          // хоцрогдсон утга үлдэхээс сэргийлнэ.)
          p.delete('section');
          return p;
        },
        { replace: true },
      );
    },
    [setSearchParams, defaultTab, param],
  );

  return [active, setActive];
}
