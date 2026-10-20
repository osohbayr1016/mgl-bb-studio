/**
 * `/quotes/:id/print` — үнийн саналын ХЭВЛЭХ хуудас.
 *
 * Хоёр хэрэглэгчтэй бөгөөд ХОЁУЛАНД НЬ ИЖИЛ харагдах ёстой:
 *   1. Сервер талын PDF — `GET /api/quotes/:id/pdf` нь 60 секундын JWT-г
 *      `?t=` -ээр дамжуулж headless Chromium-аар энэ хуудсыг нээгээд
 *      `page.pdf({ format:'A4', landscape:true })` авна.
 *   2. Хэрэглэгч өөрөө — доорх «Хэвлэх» товч `window.print()` дуудна
 *      (товч нь `no-print` тул цаасан дээр гарахгүй).
 *
 * v3 — ОЛОН ХУУДАСТ. Ажлын дэвтэр (`WorkbookDoc`) доторх хуудас БҮРИЙГ дараалан
 * зурна: хуудас хооронд `break-before: page` (printStyles) тул тус бүр шинэ цаасан
 * дээр эхэлнэ. Хуудас бүрийн дээр MGL толгой + огноо гарна.
 *
 * Баримтыг `SheetGrid`-ийн ЗӨВХӨН УНШИХ горим (onChange өгөхгүй) зурна —
 * засварлагчтай ЯГ нэг компонент, нэг `cellClass`, нэг томьёоны хөдөлгүүр
 * (`useQuoteWorkbook` — хөндлөн лавлагаа `=ИГС!G17`-ийг оролцуулан). Тиймээс
 * «дэлгэц дээр өөр, PDF дээр өөр» гэдэг алдаа боломжгүй.
 *
 * ── ЗОХИОМЖИЙГ ХЭМЖИЖ ТААРУУЛНА (2026-08-17) ───────────────────────────────
 * Хуудас нь ХОЁР тааруулалт хийнэ, хоёулаа ЗУРАХААС ӨМНӨ/ДАРАА нь бодогдоно:
 *
 *   • ХӨНДЛӨН — `lib/printFit.ts` нь нүд бүрийн бодит текстийг canvas-аар
 *     хэмжиж, бүх «таслах боломжгүй» агуулга багтах хамгийн том үсгийн хэмжээ
 *     ба баганы өргөнийг тооцно. Энэ нь синхрон тул нэмэлт зураалт шаардахгүй.
 *   • БОСОО — зурсны дараа бодит өндрийг хэмжиж, баримт хуудсанд «арай
 *     багтахгүй» байвал үсгийн хэмжээг тэр харьцаагаар буулгана (≤3 давталт).
 *     Мөр шилжүүлэлт нь текстээс хамаарсан ШУГАМАН БУС функц тул үүнийг
 *     урьдчилан тооцох боломжгүй — зөвхөн хэмжиж мэдэж болно.
 *
 * ⚠️ `data-print-ready` нь ХОЁУЛАНГ нь дуустал тавигдахгүй — эс бөгөөс
 * Browser Rendering тааруулалтын дунд зураг авч, тасарсан баримт гаргана.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { nanoid } from 'nanoid';
import { brand } from '@/shared/config/brand';

import { MEDIA_BASE_URL } from '@/shared/api/client';
import { HandSignature, whenHandSignsReady } from '@/shared/components/HandSignature';
import { useDocumentTitle } from '@/shared/hooks/useDocumentTitle';
import { useForceLightTheme } from '@/shared/hooks/useForceLightTheme';
import { useLanguage } from '@/shared/i18n';
import { bridgePrintToken } from '@/shared/lib/printAuth';
import { Button } from '@/ui/button';

import { getQuote, quoteKey } from './api/quotes';
import { SheetGrid } from './components/SheetGrid';
import {
  DEFAULT_COL_W,
  FIT_OPTIONS,
  PRINT_CONTENT_H_PX,
  printHiddenCols,
  printVisibleCols,
  quotePrintCss,
} from './components/printStyles';
import { useQuoteWorkbook } from './hooks/useQuoteWorkbook';
import type { CellValue, FormulaError } from './lib/formula';
import { fitColumns, measureSheetDemand, type FitResult } from './lib/printFit';
import { resolveAnchor } from './lib/resolveTotal';
import { detectSignatureBlock } from './lib/signatureBlock';
import { normalizeWorkbook } from './lib/workbook';
import type { CellRef } from './types/quotes';

// `?t=<jwt>`-г React mount хийхээс ӨМНӨ localStorage руу шилжүүлнэ — эхний
// apiFetch аль хэдийн токентой явна. (main.tsx мөн эрт bridge хийдэг тул энэ
// нь ихэвчлэн no-op, гэхдээ хуудсыг өөрөө дангаар нь ачаалахад хэрэгтэй.)
bridgePrintToken();

/** Табын дараалал өөрчлөгдсөн ч эвдрэхгүй тогтвортой id (workbookOps-той нэг). */
const makeSheetId = (): string => nanoid(8);

/** Утгагүй хуудсанд өгөх ТОГТМОЛ хоосон Map — рендэрийн бүрд шинэ Map үүсгэхгүй. */
const EMPTY_VALUES: Map<CellRef, CellValue | FormulaError> = new Map();

/**
 * Хамгийн олон тааруулах давталт — хязгааргүй гогцооны хамгаалалт.
 *
 * ⚠️ 2026-08-19: 3 → 5. Шахалтын хүрээ `MIN_FONT_PT`-оос `FLOOR_FONT_PT` руу
 * өргөссөн (доорх `scaleFloor`-ыг үз) тул туулах зам урт болов — 3 давталт
 * шалан дээрээ хүрч амжихгүй зогсдог байв.
 *
 * ⚠️ Өмнө нь энд `NEAR_MISS = 1.35` гэсэн ХАМРАХ ХҮРЭЭ байсныг ХАСАВ. Тэр нь
 * «баримт хуудаснаас 1.35 дахин их бол шахах нь утгагүй» гэсэн таамаг дээр
 * тогтсон боловч бодит хяналтын төсвүүд яг 1.4–1.6× гардаг — өөрөөр хэлбэл
 * хаалт нь ЯГ ТУСЛАХ ЁСТОЙ баримтууд дээр гогцоог унтраадаг байв. Шахалтын
 * бодит хязгаарлагч нь `scaleFloor` (үсэг `FLOOR_FONT_PT`-оос доош унахгүй)
 * бөгөөд тэр нь хамаагүй найдвартай: хэт урт баримт зүгээр л шалан дээрээ
 * тулаад 2 хуудас хэвээр үлдэнэ, харин «арай ядан» баримтууд одоо багтана.
 */
const MAX_FIT_PASSES = 5;

/** 'YYYY-MM-DD' → 'YYYY.MM.DD'. Таарахгүй бол ирсэн хэвээр нь буцаана. */
function dotDate(iso: string | null | undefined): string {
  if (!iso) return '';
  return /^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso.replace(/-/g, '.') : iso;
}

export default function QuotePrintPage() {
  const { id: raw } = useParams<{ id: string }>();
  const id = Number(raw);
  const validId = Number.isInteger(id) && id > 0;
  const { t } = useLanguage();

  // Хэвлэх гадаргуу нь Layout-аас ГАДНА зурагддаг ба цайвар палитраар
  // зохиомжлогдсон. Browser Rendering-ийн шинэ сесст хадгалсан theme байхгүй
  // тул үүнгүйгээр PDF бараан гарна.
  useForceLightTheme();

  const {
    data: quote,
    isLoading,
    isError,
  } = useQuery({
    queryKey: [...quoteKey(id), 'print'],
    queryFn: () => getQuote(id),
    enabled: validId,
    retry: false,
  });

  // Хуучин ганц-хуудаст санал ч, шинэ WorkbookDoc ч `normalizeWorkbook`-оор
  // үргэлж олон-хуудаст дэвтэр болно (буцаад нийцтэй). `quote` ирэхээс өмнө ч
  // hook-ийн дараалал тасрахгүйн тулд undefined-ийг зөвшөөрнө.
  const workbook = useMemo(
    () => normalizeWorkbook(quote?.workbook, makeSheetId),
    [quote?.workbook],
  );

  // Засварлагчтай ЯГ ижил хөдөлгүүр — тарифын каталог ачаалагдсаны дараа
  // `TARIF(...)`-тай нүднүүд өөрөө зөв утга руу шилжинэ. `bySheet` нь хуудасны
  // `id`-аар индекслэгдэнэ. Хэл нь `USGEER()`/`TEXT()`-ийн хэрэгжилтийг сонгоно
  // — засварлагчид харагдсан «дүн үсгээр» мөр PDF дээр ч мөн ижил гарна.
  const { bySheet, tariffsLoading } = useQuoteWorkbook(workbook, quote?.lang ?? 'mn');

  useDocumentTitle(quote?.title || t('pageTitle.quotes'));

  const stamp = (quote as { stamp_url?: string | null } | undefined)?.stamp_url ?? null;
  const q = (quote ?? {}) as {
    author_signature?: string | null;
    created_by_name?: string | null;
    prepared_by?: string | null;
  };
  /** Боловсруулсан — `prepared_by` (гараар бичсэн) давуу, эс бөгөөс үүсгэгчийн нэр. */
  const authorName = q.prepared_by?.trim() || q.created_by_name || '';
  const hasSign = Boolean(stamp || q.author_signature || authorName);

  /** Захиалагч байгууллагын нэр — толгойд, гарчгийн ЯГ ДЭЭР гарна. */
  const clientName = (quote?.client_name ?? '').trim();

  /**
   * Баримтын БОДИТ НИЙТ ДҮН — гурван шатлалт шийдэгчээр (`lib/resolveTotal.ts`).
   * ⚠️ Зөвхөн «дүн үсгээр» өгүүлбэрийн НӨӨЦ зам ашиглана: хуудсан дээрх
   * `="Тайлбар: … ₮"&TEXT(…)` томьёо байвал тэр нь ҮРГЭЛЖ давуу.
   */
  const totalAmount = useMemo(
    () => (tariffsLoading ? null : resolveAnchor(workbook, 'total', bySheet).value),
    [workbook, bySheet, tariffsLoading],
  );

  /**
   * Гарын үсгийн ШОШГЫН мөрүүд — СҮҮЛИЙН хуудсаас таана. Тэдгээрийг хэвлэмэлээс
   * нуугаад доорх голлосон блокт дахин зурна (`lib/signatureBlock.ts`).
   */
  const lastSheet = workbook.sheets[workbook.sheets.length - 1];
  const lastSheetValues = bySheet.get(lastSheet?.id)?.values;
  const quoteLang = quote?.lang ?? 'mn';
  const signBlock = useMemo(
    () => detectSignatureBlock(lastSheet, lastSheetValues, { totalAmount, lang: quoteLang }),
    [lastSheet, lastSheetValues, totalAmount, quoteLang],
  );

  /* ── ВЭБ ФОНТ АЧААЛАГДСАН УУ? ───────────────────────────────────────────
   * ⚠️⚠️ 2026-08-19-Д ЗАССАН НОЦТОЙ АЛДАА — «хэвлэхэд багтдаг атлаа PDF дээр
   * багтдаггүй»-гийн ШАЛТГААН. БУЦААЖ БҮҮ ЭВД.
   *
   * `lib/printFit.ts` нь баганы өргөнийг canvas `measureText`-ээр, `FONT_STACK`
   * (`Arimo`…) -ээр хэмждэг. Гэтэл `Arimo` нь Google Fonts-оос `@import`-оор
   * ирдэг ВЭБ ФОНТ. Хэрэв хэмжилт түүнийг ачаалагдахаас ӨМНӨ ажиллавал canvas
   * чимээгүйгээр FALLBACK гарнитураар (Helvetica/DejaVu) хэмжинэ — дараа нь
   * хуудас Arimo-гоор зурагдаж, ХЭМЖСЭН ба ЗУРАГДСАН өргөн ЗӨРНӨ.
   *
   * Яагаад зөвхөн PDF дээр илэрдэг вэ: хөгжүүлэгчийн хөтөч дээр фонт кэштэй
   * тул хэдэн миллисекундэд ирдэг ба уралдааныг ялдаг. Cloudflare Browser
   * Rendering нь ХҮЙТЭН контейнер — Google Fonts руу шинээр сүлжээгээр очдог
   * тул хэмжилт бараг ҮРГЭЛЖ фонтоос түрүүлж, баганууд буруу өргөнтэй
   * тооцогдож баримт 2 дахь хуудас руу халдаг байв.
   *
   * ⚠️ Хамгаалалт: фонт ирэхгүй бол ч (сүлжээгүй / Google хаагдсан) 8 секундын
   * дараа ЗААВАЛ үргэлжилнэ. Эс бөгөөс `data-print-ready` хэзээ ч тавигдахгүй
   * бөгөөд серверийн `waitForSelector` 25 секунд хүлээгээд БҮРЭН УНАНА. Тэр
   * тохиолдолд хэмжилт ба зураалт ХОЁУЛАА fallback фонтоор явах тул хоорондоо
   * зөрөхгүй — баримт бага зэрэг өөр харагдана, гэхдээ БҮТЭН гарна. */
  const [fontsReady, setFontsReady] = useState(false);
  useEffect(() => {
    let done = false;
    const finish = () => {
      if (!done) {
        done = true;
        setFontsReady(true);
      }
    };
    const timer = setTimeout(finish, 8000);
    const fonts = document.fonts;
    if (!fonts) {
      finish();
    } else {
      // ⚠️ `fonts.ready` дангаараа хангалтгүй: тэр нь ХҮЛЭЭГДЭЖ БУЙ ачаалалт
      // дуусахыг л хэлнэ, харин хэрэглэгдээгүй гарнитур огт хүсэгдээгүй байж
      // болно. Тиймээс хэмжилтэд ашиглагдах ЯГ тэр жингүүдийг тодорхой нэхнэ
      // (`printFit.cellShape`: 400 ердийн · 600 тод · 700 толгой).
      Promise.all([
        fonts.load('400 12px Arimo'),
        fonts.load('600 12px Arimo'),
        fonts.load('700 12px Arimo'),
      ])
        .catch(() => undefined)
        .then(() => fonts.ready)
        .then(finish, finish);
    }
    return () => clearTimeout(timer);
  }, []);

  /* ── ТОВЧЛОЛ БҮРМӨСӨН ХАСАГДСАН (2026-09-09, эзний шийдвэр) ────────────
   * ⚠️ БУЦААЖ БҮҮ НЭМ.  Хуудсан дээр гарах шошго нь ХЭРЭГЛЭГЧИЙН нүдэнд
   * бичсэн БҮТЭН үг байх ЁСТОЙ: «Усаар гал унтраах систем 4%» гэж бичсэн
   * зүйл цаасан дээр «Усан гал 4%» болж хувирахыг эзэн ХОЁР УДАА
   * татгалзсан (2026-09-09).
   *
   * Өмнө нь `lib/printAbbr.ts` гэсэн товчлолын толь энэ хуудсанд БОЛЗОЛГҮЙ
   * хэрэглэгддэг байсан; дараа нь «зөвхөн баримт хуудас хэтэрвэл» гэсэн
   * шатлах логик болгосон ч тэр нь ижил гэмтлийг ХААЯА давтах эрсдэлтэй
   * хэвээр байв.  Одоо толь нь бүхэлдээ УСТГАГДСАН.
   *
   * Багтаах ажил бүхэлдээ хэмжилтэд суурилсан хоёр тааруулагчийнх:
   *   • хөндлөн — `lib/printFit.ts` (багана өргөсгөх · мөр шилжүүлэх),
   *   • босоо   — доорх `fontScale` гогцоо (үсэг 5.5pt хүртэл жижигрүүлэх).
   * Хэрэв баримт нэг хуудсанд багтахгүй бол ХОЁР ХУУДАС болно — шошгыг
   * богиносгохгүй.  Энэ бол ил шийдвэр: албан баримт дээрх нэр томьёо нь
   * цаас хэмнэхээс чухал. */

  /* ── ХӨНДЛӨН ТААРУУЛАЛТ ─────────────────────────────────────────────────
   * Багана бүрийн хэрэгцээг БОДИТ агуулгаас хэмжинэ. `tariffsLoading` үед
   * бүх `TARIF()` нүд `#ТАРИФ!` харагддаг тул хэмжилт худал болно — каталог
   * ирсний дараа л хэмжинэ (тэр үед `useMemo` өөрөө дахин бодогдоно).
   * `fontsReady`-г мөн хүлээнэ — дээрх тайлбарыг үз. */
  const fits = useMemo(() => {
    const map = new Map<string, FitResult>();
    if (!quote || tariffsLoading || !fontsReady) return map;
    for (const sheet of workbook.sheets) {
      const visible = printVisibleCols(sheet);
      if (visible.length === 0) continue;
      const values = bySheet.get(sheet.id)?.values ?? EMPTY_VALUES;

      /* Нүдэнд бичигдсэн БҮТЭН текстээр хэмжиж, ЯГ ТЭР ХЭВЭЭР нь зурна —
       * `measureSheetDemand`-д `transform` өгөхгүй, `SheetGrid`-т
       * `printText` өгөхгүй.  Хоёулаа НЭГ ижил (хувиргалтгүй) текстээр
       * ажиллах нь заавал биелэх нөхцөл: зөрвөл хэмжсэн өргөн ба зурагдсан
       * текст зөрж, нүд ТАСАРНА. */
      const fit = fitColumns(
        measureSheetDemand(sheet, values, visible, DEFAULT_COL_W),
        FIT_OPTIONS,
      );
      if (fit.clipped) {
        // Чимээгүй тасрах нь хамгийн муу — наад зах нь мөрд үлдээнэ.
        console.warn(
          `[quote-print] «${sheet.name}» хуудас ${FIT_OPTIONS.floorFontPt}pt дээр ч багтсангүй — текст тасарч болзошгүй.`,
        );
      }
      map.set(sheet.id, fit);
    }
    return map;
  }, [quote, workbook, bySheet, tariffsLoading, fontsReady]);

  /* ── БОСОО ТААРУУЛАЛТ ──────────────────────────────────────────────────── */
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [fontScale, setFontScale] = useState(1);
  const passRef = useRef(0);
  const [fitSettled, setFitSettled] = useState(false);

  // Шинэ баримт/шинэ хэмжилт ирвэл тааруулалтыг ЭХНЭЭС нь.
  useEffect(() => {
    passRef.current = 0;
    setFontScale(1);
    setFitSettled(false);
  }, [fits]);

  const css = useMemo(
    () => quotePrintCss(workbook, { fits, hasSign, fontScale, hasClient: !!clientName }),
    [workbook, fits, hasSign, fontScale, clientName],
  );

  const failed = !validId || isError || (!isLoading && !quote);
  // ⚠️ `fontsReady` МӨН орно: түүнгүйгээр `fits` хоосон хэвээр байхад босоо
  // гогцоо `fits.size === 0` дээр эрт гарч, `fitSettled` хэзээ ч үнэн болохгүй
  // → `data-print-ready` тавигдахгүй → серверийн зураг авалт timeout болно.
  const dataReady = !!quote && !tariffsLoading && fontsReady;

  /** Хуудасны БОДИТ агуулгын өндөр (px) — `min-height`-д хууртахгүйн тулд толгой + бие. */
  const measureSheetHeight = useCallback((sheet: Element): number => {
    const head = sheet.querySelector('.quote-print__head') as HTMLElement | null;
    const body = sheet.querySelector('.quote-print__body') as HTMLElement | null;
    const headH = head
      ? head.offsetHeight + parseFloat(getComputedStyle(head).marginBottom || '0')
      : 0;
    return headH + (body ? body.scrollHeight : 0);
  }, []);

  useEffect(() => {
    if (failed) {
      setFitSettled(true);
      return;
    }
    if (!dataReady || fits.size === 0) return;

    let cancelled = false;
    const measure = () => {
      if (cancelled) return;
      const root = rootRef.current;
      if (!root) {
        setFitSettled(true);
        return;
      }
      /* Үсгийн ДООД хязгаар.
       * ⚠️ 2026-08-19: `minFontPt` (6.5) → `floorFontPt` (5.5).
       * Хуучин утга нь энэ гогцоог 7.33pt → 6.5pt буюу ердөө ≈11% буулгалт
       * дээр зогсоодог байв — гэтэл `sheetPrintMetrics` нь 5.5pt-ыг АЛЬ ХЭДИЙН
       * зөвшөөрдөг (`Math.max(FLOOR_FONT_PT, fontPt)`), өөрөөр хэлбэл ганцхан
       * энэ мөр нэмэлт 15%-ийг хааж байсан.
       *
       * ⚠️ Энэ бол «уншигдацыг хуудасны тоогоор худалдах» ил шийдвэр:
       * `MIN_FONT_PT = 6.5` нь `printStyles.ts`-д «албан баримтын хүлээн
       * зөвшөөрөгдөх доод хязгаар» гэж тэмдэглэгдсэн. Гогцоо түүнээс доош
       * зөвхөн ХУУДАС ХЭМНЭХИЙН ТУЛД, ба зөвхөн 5.5pt хүртэл буулгана. */
      const smallestFit = Math.min(...[...fits.values()].map((f) => f.fontPt));
      const scaleFloor = Number.isFinite(smallestFit)
        ? FIT_OPTIONS.floorFontPt / smallestFit
        : 1;

      let want = 1;
      root.querySelectorAll('.quote-print__sheet').forEach((el) => {
        const h = measureSheetHeight(el);
        if (h <= 0) return;
        const pages = Math.max(1, Math.ceil(h / PRINT_CONTENT_H_PX));
        // Одоогийн хуудасны тооноос НЭГЭЭР цөөрөх боломжтой эсэх.
        const target = (pages > 1 ? pages - 1 : 1) * PRINT_CONTENT_H_PX;
        // ⚠️ Дээд хаалтгүй (NEAR_MISS хасагдсан) — `scaleFloor` нь шахалтыг
        // ямар ч байсан хязгаарлана. Хэт урт баримт шалан дээрээ тулаад
        // хуудсаа хэвээр авна, харин «арай ядан» баримтууд одоо багтана.
        if (h > target) {
          want = Math.min(want, (target / h) * 0.995);
        }
      });

      /* ⚠️ «ДЭМИЙ ШАХАЛТ»-ААС ХАМГААЛАХ — 2026-08-19-нд аудитаар илэрсэн.
       *
       * `NEAR_MISS` хаалтыг хассан нь «арай ядан» баримтуудыг багтаасан ч нэг
       * муу салаа нээсэн: баримт ҮНЭХЭЭР урт (≈1.65–2.0 хуудас) үед шаардагдах
       * `want` нь `scaleFloor`-оос ДООШ унана — өөрөөр хэлбэл ШАЛАН ДЭЭР Ч
       * зорилтод хүрэхгүй. Тэр үед доорх `Math.max` нь үсгийг 5.5pt хүртэл
       * буулгаад ЗОГСОНО: баримт уншигдахаа болино, атлаа хуудас нь хэвээр
       * 2 үлдэнэ — цэвэр хохирол.
       *
       * Иймд бүрэн найдваргүй бол ОГТ ШАХАХГҮЙ: урт баримт 9pt-оороо 2 хуудас
       * гарах нь 5.5pt-оор 2 хуудас гарахаас хамаагүй дээр.
       *
       * 3%-ийн нөөц: шаланд БАРАГ хүрч байвал оролдох эрх үлдээнэ — мөр
       * шилжүүлэлт шугаман бус тул бодит өндөр таамгаас арай илүү агшдаг. */
      if (fontScale * want < scaleFloor * 0.97) want = 1;

      const next = Math.max(scaleFloor, fontScale * want);
      if (passRef.current < MAX_FIT_PASSES && next < fontScale - 0.002) {
        passRef.current += 1;
        setFontScale(Number(next.toFixed(4)));
        return; // дахин зурагдаад энэ effect ахин ажиллана
      }

      setFitSettled(true);
    };

    // Фонт ачаалагдсаны дараа хэмжинэ — эс бөгөөс fallback глифийн өндрөөр
    // хэмжиж, буруу масштаб сонгоно.
    const raf = requestAnimationFrame(() => {
      if (document.fonts?.ready) void document.fonts.ready.then(measure);
      else measure();
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
    };
  }, [failed, dataReady, fits, fontScale, measureSheetHeight]);

  // ⚠️ Тариф ачаалагдтал бүх `TARIF()` нүд `#ТАРИФ!` харагдана, тааруулалт
  // дуустал багана буруу өргөнтэй байна — PDF-ийг тэр үед авбал баримт
  // эвдэрнэ. АЛДААНЫ САЛАА ч мөн тэмдэглэнэ, эс бөгөөс puppeteer
  // `waitForSelector` дээр 25 секунд дэмий хүлээнэ.
  const ready = failed || (dataReady && fitSettled);

  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    const markReady = () => {
      if (!cancelled) document.body.setAttribute('data-print-ready', 'true');
    };
    // Вэб фонт (Arimo/Noto — кирилл глиф) ачаалагдсаны дараа тэмдэглэнэ,
    // ингэснээр зураг fallback глифтэйгээр авагдахгүй.
    const afterFonts = () => void whenHandSignsReady().then(markReady);
    if (document.fonts?.ready) void document.fonts.ready.then(afterFonts);
    else afterFonts();
    return () => {
      cancelled = true;
    };
  }, [ready]);

  if (failed) {
    return (
      <>
        <style>{css}</style>
        <div className="quote-print__msg quote-print__msg--error">{t('quotes.err.notFound')}</div>
      </>
    );
  }
  if (!quote) {
    return (
      <>
        <style>{css}</style>
        <div className="quote-print__msg">{t('common.loading')}</div>
      </>
    );
  }

  const docDate = dotDate(quote.doc_date);

  return (
    <>
      <style>{css}</style>
      <div className="quote-print" ref={rootRef}>
        {workbook.sheets.map((sheet, i) => (
          // Хуудас бүр өөрийн толгойтой, шинэ цаасан дээр (printStyles-ийн
          // `.quote-print__sheet + .quote-print__sheet { break-before: page }`).
          // `--${i}` нь баганы % scope-той таарна (printStyles.quotePrintCss).
          <section key={sheet.id} className={`quote-print__sheet quote-print__sheet--${i}`}>
            <header className="quote-print__head">
              <img src="/logo.svg" alt={brand().nameShort} className="quote-print__logo" />
              <div className="quote-print__meta">
                <div className="quote-print__date">{docDate}</div>
                {/* ⚠️ Хуудасны нэр («Нэгтгэл») ХАСАГДСАН (2026-08-12,
                    хэрэглэгчийн шийдвэр) — энэ нь дотоод табын нэр бөгөөд
                    захиалагчид утгагүй. */}
              </div>
            </header>

            {/* ⚠️ Гарын үсэг · тамга нь ЭНЭ БЛОКИЙН (хүснэгтийн) ЁРООЛООС
                байрлана, хуудасны ёроолоос БИШ. Хуудасны ёроолд уясан үед
                богино баримт дээр тамга хүснэгтийн дундуур, тэр дундаа НИЙТ
                ДҮН-гийн мөр дээр буудаг байв (хэмжсэн 2026-08-17). */}
            <div className="quote-print__body">
              {/* ЗАХИАЛАГЧ БАЙГУУЛЛАГА — баримтын ХАМГИЙН ЭХЭНД, гарчгийн (A1)
                  ЯГ ДЭЭР. Хуудасны нүд БИШ, React мөр: `quotes.client_name` нь
                  баримтын толгойн талбар бөгөөд ажлын дэвтэрт хадгалагддаггүй
                  тул хуудаснаас уншигдах боломжгүй. Хоосон үед мөр огт
                  зурагдахгүй (`hasClient` → босоо нөөц ч тавигдахгүй). */}
              {clientName && (
                <div className="quote-print__client">
                  <span className="quote-print__client-label">
                    {quoteLang === 'en' ? 'Client:' : 'Захиалагч:'}
                  </span>{' '}
                  <span className="quote-print__client-name">{clientName}</span>
                </div>
              )}
              {/* Толгойгүй (A/B/C, 1/2/3 үгүй) — баримт өөрөө л харагдана.
                  Торлолт нь `gridLines ?? showHeaders` тул мөн унтарч, зөвхөн
                  `CellStyle.border`-тэй нүд шугамтай гарна. */}
              <SheetGrid
                // ⚠️ Гарын үсгийн ШОШГЫН мөрүүд («БОЛОВСРУУЛСАН:», «…ХХК-ийн»,
                // «Төслийн менежер:») хэвлэмэлээс нуугдаж, доорх ГОЛЛОСОН
                // React блокт дахин зурагдана (`lib/signatureBlock.ts`).
                // Зөвхөн СҮҮЛИЙН хуудсанд — блок ч зөвхөн тэнд гардаг.
                hiddenRows={i === workbook.sheets.length - 1 ? signBlock.hiddenRows : undefined}
                // ⚠️ Хэсгийн багана ХЭВЛЭМЭЛД ҮРГЭЛЖ нуугдана: тэдгээр нь
                // ДОТООД задаргаа (нэг үнийг мэргэжлээр хуваасан) бөгөөд
                // захиалагчид хэрэггүй. Хасагдсан хэсгийг `sections.noteRef`
                // нүдэнд бичдэг тул мэдээлэл алдагдахгүй. Багана УСТГАХГҮЙ —
                // томьёо ажилласаар, ДҮН зөв.
                // ⚠️ ЖАГСААЛТ нь `printStyles`-тэй НЭГ эх сурвалжтай байх ёстой:
                // баганы өргөн, `colspan`, `nth-child` бүгд эндээс хамаарна.
                hiddenCols={printHiddenCols(sheet)}
                sheet={sheet}
                values={bySheet.get(sheet.id)?.values ?? EMPTY_VALUES}
                showHeaders={false}
                className="quote-print__grid"
              />

              {/* ТАЙЛБАР БОЛОН АШИГЛАСАН МАТЕРИАЛ — зөвхөн СҮҮЛИЙН хуудсанд хүснэгтийн доор */}
              {i === workbook.sheets.length - 1 && (
                <div className="quote-print__notes-block">
                  {/* 1. Тайлбар — БД-ийн эшлэлүүд.
                      ⚠️ Шошиг нь ХУУДСААС ирнэ (`signBlock.noteLabel`), энд ХАТУУ
                      бичигдэхээ БОЛЬСОН: англи баримт дээр «Note:» гэж гарах ба
                      жагсаалт хоосон үед (хэрэглэгч бүх тайлбарыг унтраасан —
                      `lib/quoteNotes.ts`) блок бүхэлдээ гарахгүй. Өнчин тод шошиг
                      үлдээх нь захиалагчид «мэдээлэл алга болсон» мэт харагдана. */}
                  {signBlock.bdNotes.length > 0 && (
                    <div className="quote-print__notes-row">
                      <div className="quote-print__notes-label">{signBlock.noteLabel}</div>
                      <div className="quote-print__notes-content">
                        {signBlock.bdNotes.map((note, idx) => (
                          <div key={idx}>{note}</div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* 2. Ашигласан материал */}
                  {signBlock.materialNotes.length > 0 && (
                    <div className="quote-print__notes-row">
                      <div className="quote-print__notes-label">{signBlock.materialLabel}</div>
                      <div className="quote-print__notes-content">
                        {signBlock.materialNotes.map((mat, idx) => (
                          <div key={idx} className="quote-print__notes-material">{mat}</div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* 3. Дүн үсгээр ба гэрээний хөнгөлөлтийн тайлбар (Justified) */}
                  <div className="quote-print__notes-text">
                    {signBlock.totalInWords && (
                      <div className="quote-print__notes-total">{signBlock.totalInWords}</div>
                    )}
                    {signBlock.contractNote && (
                      <div className="quote-print__notes-contract">{signBlock.contractNote}</div>
                    )}
                  </div>
                </div>
              )}

              {/* ТАМГА — зөвхөн СҮҮЛИЙН хуудсанд, хүснэгтийн доор баруун талд.
                  Хуудас бүрд давтвал олон хуудаст баримт дээр тамга олон удаа
                  гарч, хуурамч мэт харагдана. Байхгүй бол блок огт гарахгүй. */}
              {hasSign && i === workbook.sheets.length - 1 && (
                // ⚠️ ЗӨВХӨН боловсруулсан хүн — «Гүйцэтгэсэн / захирал» багана
                // хэрэглэгчийн шийдвэрээр ХАСАГДСАН (2026-08-11).
                //
                // ⚠️ 2026-08-17: блок нь одоо БҮТЭН — «БОЛОВСРУУЛСАН:»,
                // байгууллага ба албан тушаалын мөрүүд хүртэл энд зурагдана
                // (хуудсан дээрх эх нүднүүд нь `hiddenRows`-оор нуугдсан).
                // Шалтгаан: өмнө нь шошго нь хуудасны ЗҮҮН талд, гарын үсэг нь
                // React-ээр БАРУУН талд гарч баримтын ёроол хоёр тийш салдаг
                // байв. Одоо бүгд нэг бүлэг болж хуудасны ГОЛД байрлана
                // (хэрэглэгчийн шийдвэр).
                <div className="quote-print__sign">
                  {/* ⚠️ Гарчиг ба мөрийг НЭГ бүлэгт хийсэн нь ЗОРИУД: бүлэг нь
                      агуулгынхаа өргөнөөр агшдаг тул түүний ЗҮҮН ирмэг нь
                      «…ХХК-ийн» бичвэрийн зүүн ирмэгтэй ЯГ таарна. Ингэснээр
                      «БОЛОВСРУУЛСАН:» тэр бичвэрийн ЭГЦ ДЭЭР буудаг
                      (хэрэглэгчийн шийдвэр 2026-08-19). Бүлэггүй үед гарчиг нь
                      хуудасны зүүн ирмэгт наалдаж, гарын үсгийн блокоос хол
                      тасарч байв. */}
                  <div className="quote-print__sign-group">
                    {signBlock.heading && (
                      <div className="quote-print__sign-head">{signBlock.heading}</div>
                    )}
                    <div className="quote-print__sign-row">
                    {signBlock.org.length > 0 && (
                      <div className="quote-print__sign-org">
                        {signBlock.org.map((line) => (
                          <div key={line}>{line}</div>
                        ))}
                      </div>
                    )}
                    <div className="quote-print__sign-line">
                      {q.author_signature && (
                        <HandSignature
                          className="quote-print__sign-img"
                          src={`${MEDIA_BASE_URL}${q.author_signature}`}
                        />
                      )}
                      {stamp && (
                        <img
                          className="quote-print__sign-stamp"
                          src={`${MEDIA_BASE_URL}${stamp}`}
                          alt=""
                        />
                      )}
                    </div>
                      <div className="quote-print__sign-name">/{authorName}/</div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </section>
        ))}

        <div className="quote-print__actions no-print">
          <Button type="button" variant="outline" onClick={() => window.print()}>
            {t('quotes.action.print')}
          </Button>
        </div>
      </div>
    </>
  );
}
