/**
 * Хуудсыг тооцоолох React дэгээ — `SheetDoc` → нүд бүрийн УТГА.
 *
 * Тарифын каталог (353 мөр) нь бараг өөрчлөгддөггүй тул `staleTime: Infinity`-
 * тэй нэг л удаа татагдаад бүх хуудсанд дахин ашиглагдана. Ачаалж дуустал
 * `tariff` нь үргэлж `null` буцаадаг stub байх тул `TARIF(...)`-тай нүднүүд
 * түр `#ТАРИФ!` харагдаад, өгөгдөл ирмэгц АВТОМАТААР зөв болно (memo-ийн
 * хамаарал `tariffFn` дээр байгаа тул дахин тооцоолол өөрөө өрнөнө).
 *
 * Хэрэглээ (засварлагч ба хэвлэх хуудас ХОЁУЛАА үүнийг дуудна — нэг хөдөлгүүр):
 *   const { values } = useQuoteSheet(sheet);
 *   <SheetGrid sheet={sheet} values={values} onChange={setSheet} />
 */
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';

import { TARIFFS_KEY, listTariffs } from '../api/quotes';
import { evaluateSheet, type CellValue, type FormulaError } from '../lib/formula';
import { numberToEnglish } from '../lib/numberToEnglish';
import { numberToMongolian } from '../lib/numberToMongolian';
import { makeTariffFn } from '../lib/tariffLookup';
import type { CellRef, QuoteLang, SheetDoc } from '../types/quotes';

const HOUR_MS = 60 * 60 * 1000;

/** Тариф ачаалагдаагүй үеийн stub — бүх `TARIF()` дуудалт `#ТАРИФ!` болно. */
const NO_TARIFF = (): number | null => null;

export interface QuoteSheetEval {
  /** Утгатай бүх нүд. Байхгүй түлхүүр = хоосон нүд. */
  values: Map<CellRef, CellValue | FormulaError>;
  /** `values`-ийн алдаатай дэд олонлог — засварлагчид тодруулахад. */
  errors: Map<CellRef, FormulaError>;
  /** Тарифын каталог ачаалж байгаа эсэх (нүднүүд түр `#ТАРИФ!` харагдана). */
  tariffsLoading: boolean;
}

export function useQuoteSheet(sheet: SheetDoc, lang: QuoteLang = 'mn'): QuoteSheetEval {
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
  const { values, errors } = useMemo(
    () =>
      evaluateSheet(sheet, {
        tariff,
        usgeer: lang === 'en' ? numberToEnglish : numberToMongolian,
        locale: lang === 'en' ? 'en-US' : 'mn-MN',
      }),
    [sheet, tariff, lang],
  );

  return { values, errors, tariffsLoading: isLoading };
}
