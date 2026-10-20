/**
 * Бүтэн ажлын дэвтрийг тооцоолох React дэгээ — `WorkbookDoc` → хуудас бүрийн
 * нүдний УТГА (хөндлөн лавлагаа `=ИГС!G17`-ийг оролцуулан).
 *
 * `useQuoteSheet`-ийн олон-хуудаст хувилбар: тарифын каталог (Хүснэгт 9, ~353
 * мөр) нь улсын норматив тул `staleTime: Infinity`-ээр НЭГ л удаа татагдаад бүх
 * хуудсанд дахин ашиглагдана. Ачаалж дуустал `tariff` нь `#ТАРИФ!` буцаадаг stub
 * байх тул `TARIF(...)`-тай нүднүүд түр алдаа харагдаад, өгөгдөл ирмэгц
 * АВТОМАТААР зөв болно (memo-ийн хамаарал `tariffFn` дээр байгаа тул дахин
 * тооцоолол өөрөө өрнөнө).
 *
 * Хэрэглээ (засварлагч ба хэвлэх хуудас ХОЁУЛАА үүнийг дуудна — нэг хөдөлгүүр):
 *   const { bySheet } = useQuoteWorkbook(workbook);
 *   const sheetEval = bySheet.get(activeSheet.id);
 *   <SheetGrid sheet={activeSheet} values={sheetEval?.values ?? EMPTY} … />
 */
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';

import { TARIFFS_KEY, listTariffs } from '../api/quotes';
import { evaluateWorkbook, type WorkbookEvalResult } from '../lib/formula';
import { numberToEnglish } from '../lib/numberToEnglish';
import { numberToMongolian } from '../lib/numberToMongolian';
import { makeTariffFn } from '../lib/tariffLookup';
import type { QuoteLang, WorkbookDoc } from '../types/quotes';

const HOUR_MS = 60 * 60 * 1000;

/** Тариф ачаалагдаагүй үеийн stub — бүх `TARIF()` дуудалт `#ТАРИФ!` болно. */
const NO_TARIFF = (): number | null => null;

export interface QuoteWorkbookEval {
  /** Хуудасны `id` → тухайн хуудасны утга/алдаа. Байхгүй хуудас = хоосон Map. */
  bySheet: WorkbookEvalResult['bySheet'];
  /** Тарифын каталог ачаалж байгаа эсэх (нүднүүд түр `#ТАРИФ!` харагдана). */
  tariffsLoading: boolean;
}

export function useQuoteWorkbook(workbook: WorkbookDoc, lang: QuoteLang = 'mn'): QuoteWorkbookEval {
  const { data: tariffs, isLoading } = useQuery({
    queryKey: TARIFFS_KEY,
    queryFn: listTariffs,
    // Хүснэгт 9 нь улсын норматив — сесс дундуур өөрчлөгдөхгүй.
    staleTime: Infinity,
    gcTime: 24 * HOUR_MS,
  });

  const tariff = useMemo(
    () => (tariffs && tariffs.length > 0 ? makeTariffFn(tariffs) : NO_TARIFF),
    [tariffs],
  );

  // Хэлээс хамаарсан тарилга: «дүн үсгээр» хөрвүүлэгч ба `TEXT()`-ийн locale.
  // Томьёо нь `USGEER(...)` хэвээр — зөвхөн хэрэгжилт нь солигдоно.
  const { bySheet } = useMemo(
    () =>
      evaluateWorkbook(workbook, {
        tariff,
        usgeer: lang === 'en' ? numberToEnglish : numberToMongolian,
        locale: lang === 'en' ? 'en-US' : 'mn-MN',
      }),
    [workbook, tariff, lang],
  );

  return { bySheet, tariffsLoading: isLoading };
}
