/* ──────────────────────────────────────────────────────────────────────
 * Хугацааны тэнхлэг — портфелийн Gantt-ийн дээд мөр.
 *
 * Гүйдэг талбайн ДЭЭД талд наалддаг (`sticky top-0`), зүүн талын нэрийн
 * баганы толгой нь мөн ХЭВТЭЭ чиглэлд наалддаг (`sticky left-0`) — нэг
 * элемент хоёр тэнхлэгт зэрэг наалдах нь CSS-ийн хувьд хууль ёсны.
 *
 * ХОЁР ДАВХАР ТЭНХЛЭГ (2026-08, биржийн чартын зохион байгуулалт):
 *
 *   ┌──────────── 2026 7-р сар ───────────┬───── 2026 8-р сар ─────┐  ← зурвас (h-5)
 *   │ 23  24 │25│ 26  27  28  29  30  31 │ 1   2 │ 3 │ 4   5   6  │  ← тэмдэг (h-6)
 *              ▲ амралтын өдөр сүүдэртэй      ▲ Даваа = major
 *
 * Өмнө нь тэмдэг бүр «7/16» гэж бичигдэж, 26px тутамд давтагдан саарал
 * түрхэс болж уншигдахгүй байсан. Одоо САР/ЖИЛийг дээд зурвас үүрч,
 * доод мөрөнд зөвхөн САРЫН ӨДӨР үлдэв. Нягтралыг `tierFor(pxPerDay)`
 * шийднэ (`lib/timeScale.ts`) — энэ бүрэлдэхүүн зөвхөн ЗУРНА.
 *
 * Хэрэв хоёр тэмдгийн зай `MIN_LABEL_GAP`-аас нягт бол minor шошгыг нуух —
 * ингэснээр хамгийн жижиг томруулалт дээр ч шошго давхцахгүй (тэмдгийн
 * зураас хэвээр үлдэнэ).
 * ────────────────────────────────────────────────────────────────── */

import { useLanguage } from '@/shared/i18n';
import { cn } from '@/shared/lib/utils';

import type { AxisBand, AxisTick } from '../lib/timeScale';

/** Хоёр шошгын хоорондох хамгийн бага зай (px). Үүнээс нягт бол
 *  зөвхөн `major` шошго үлдэнэ. */
const MIN_LABEL_GAP = 22;

export interface TimeAxisProps {
  /** `buildTicks(...)`-ийн үр дүн — x нь chart талбайн дотоод координат. */
  ticks: AxisTick[];
  /** `buildBands(...)` — дээд мөрийн сар/жилийн зурвас. */
  bands: AxisBand[];
  /** `buildWeekendSpans(...)` — Бя/Ням баганууд. `day` шатнаас бусад үед хоосон. */
  weekends: { x: number; width: number }[];
  /** Баруун (гүйдэг) талбайн өргөн — `totalDays * pxPerDay`. */
  chartWidth: number;
  /** Зүүн наалт баганын өргөн (px). */
  nameWidth: number;
  /** «Өнөөдөр»-ийн x координат chart талбайн дотор. */
  todayX: number;
  /** Зүүн баганын толгойн бичиг — «12 төсөл». */
  nameHeader: string;
  /**
   * Баганын өргөн өөрчлөх бариул (Excel маягийн чирэлт).  Байрлал нь энэ
   * файлын хэрэг — нэрийн нүдний БАРУУН ирмэг дээр наалдана — харин
   * pointer-ийн логик нь `GanttChart`-д, учир нь өргөний төлөв тэнд байна.
   */
  resizeHandle?: React.ReactNode;
}

export function TimeAxis({
  ticks,
  bands,
  weekends,
  chartWidth,
  nameWidth,
  todayX,
  nameHeader,
  resizeHandle,
}: TimeAxisProps) {
  const { t } = useLanguage();
  const todayVisible = todayX >= 0 && todayX <= chartWidth;

  return (
    <div className="sticky top-0 z-30 flex border-b border-border bg-card">
      {/* Хоёр тэнхлэгт наалддаг булан — мөрүүдийн нэрийн баганы толгой. */}
      <div
        className="sticky left-0 z-40 flex h-11 shrink-0 items-center border-r border-border bg-card px-3"
        style={{ width: nameWidth }}
      >
        <span className="text-label truncate text-muted-foreground">{nameHeader}</span>
        {resizeHandle}
      </div>

      <div className="relative h-11 shrink-0" style={{ width: chartWidth }}>
        {/* ── 1. Зурвасын мөр — сар (эсвэл жил) ────────────────────── */}
        <div className="absolute inset-x-0 top-0 h-5 border-b border-border/60">
          {bands.map((band) => (
            <div
              key={band.iso}
              className="absolute inset-y-0 overflow-hidden border-l border-border/70"
              style={{ left: band.x, width: band.width }}
            >
              {/* Зурвас нь харагдах хэсгээс зүүн тийш эхэлсэн ч шошго нь
                  түүний ЗҮҮН ирмэгт наалдана — `truncate` нь нарийн
                  зурвасын нэрийг эвлэгхэн тайрна. */}
              {/* `text-label` нь UPPERCASE тул сарын нэрэнд тохирохгүй
                  («7-Р САР» гэж хашгирна) — зурвасын гарчигт `text-micro`. */}
              <span className="text-micro block truncate px-1.5 leading-5 font-medium text-foreground">
                {band.label}
              </span>
            </div>
          ))}
        </div>

        {/* ── 2. Тэмдэглэгээний мөр — өдөр/долоо хоног/сар ──────────── */}
        <div className="text-label absolute inset-x-0 bottom-0 h-6">
          {/* Амралтын өдрийн багана — тэмдгээс ДООР. Мөрүүдийн талбайд ч
              ижил багана зурагдана (`GanttChart`), тул баганa нь чартаар
              тасралтгүй уншигдана. */}
          {weekends.map((span) => (
            <span
              key={`we-${span.x}`}
              aria-hidden
              className="absolute inset-y-0 bg-muted/40"
              style={{ left: span.x, width: span.width }}
            />
          ))}

          {ticks.map((tick, i) => {
            const next: AxisTick | undefined = ticks[i + 1];
            // Дараагийн тэмдэг байхгүй бол шошгыг үргэлж үзүүлнэ.
            const gap = next ? next.x - tick.x : MIN_LABEL_GAP;
            const showLabel = tick.major || gap >= MIN_LABEL_GAP;
            return (
              <div key={tick.iso} className="absolute inset-y-0" style={{ left: tick.x }}>
                <span
                  aria-hidden
                  className={cn(
                    'absolute bottom-0 w-px',
                    tick.major ? 'h-2.5 bg-border' : 'h-1.5 bg-border/60',
                  )}
                />
                {showLabel && (
                  <span
                    className={cn(
                      'absolute top-0.5 left-1 whitespace-nowrap tabular-nums',
                      tick.major ? 'text-foreground' : 'font-normal text-muted-foreground',
                    )}
                  >
                    {tick.label}
                  </span>
                )}
              </div>
            );
          })}

          {/* «Өнөөдөр» чип — улаан босоо шугамын толгой. Шугам өөрөө
              `GanttChart`-ийн торны давхаргад (баараас ДООР) зурагдана. */}
          {todayVisible && (
            <span
              className="absolute top-0.5 z-10 -translate-x-1/2 rounded-full bg-danger px-1.5 py-0.5 text-danger-foreground"
              style={{ left: todayX }}
            >
              {t('timelinePage.today')}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

export default TimeAxis;
