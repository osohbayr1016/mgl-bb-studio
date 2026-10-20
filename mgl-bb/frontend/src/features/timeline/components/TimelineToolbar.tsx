/* ─────────────────────────────────────────────────────────────────────────
 * Төслийн хуваарь — хяналтын мөр (toolbar)
 * -------------------------------------------------------------------------
 * Бүх төлөв нь `TimelinePage`-д локал `useState`-ээр амьдардаг; энэ компонент
 * зөвхөн харуулах + callback дуудах үүрэгтэй (controlled).  Шүүлт/эрэмбэ нь
 * `TimelinePage`-ийн `useMemo` дотор нэг удаа хийгдэж Gantt рүү очно
 * (2026-08-наас хуудсанд ЗӨВХӨН Gantt үлдсэн — Анхаарах / Хуваарьгүй
 * жагсаалт хоёр устсан).
 *
 * Томруулалт нь ҮРГЭЛЖИЛСЭН (px/хоног) — чартын дээр Ctrl + дугуй эргүүлэхэд
 * шууд өөрчлөгддөг (TradingView загвар).  Энд байгаа дөрвөн товч нь зөвхөн
 * ХУРДАН ҮСРЭХ цэгүүд, − / + нь 1.4 дахин алхана.  Тиймээс «идэвхтэй» товч
 * гэдэг нь ойролцоо утга — яг таарахгүй бол АЛЬ Ч товчийг тодруулахгүй
 * (буруу мэдээлэл өгөхөөс тодруулахгүй байх нь дээр).
 *
 * Багаар шүүх хэсэг 2026-08-д АВЧ ХАЯГДСАН: хуваарийн хуудас нэг л өнгөний
 * хэлтэй болсон — эрсдэл.  Баг нь энд утгагүй байсан.
 * ───────────────────────────────────────────────────────────────────────── */
import { CalendarCheck, Search, ZoomIn, ZoomOut } from 'lucide-react';

import { useLanguage } from '@/shared/i18n';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/ui/select';

import type { RiskState, Zoom } from '../types';
import { RISK_ORDER, riskLabelKey } from '../lib/riskDisplay';
import { ZOOM_PRESETS, clampPxPerDay } from '../lib/timeScale';

/** Төлөвийн шүүлтүүр — «бүгд» / «зөвхөн анхаарах» / тодорхой нэг төлөв. */
export type StateFilter = 'all' | 'attention' | RiskState;

const ZOOMS: { value: Zoom; labelKey: string }[] = [
  { value: 'day', labelKey: 'timelinePage.zoomDay' },
  { value: 'week', labelKey: 'timelinePage.zoomWeek' },
  { value: 'month', labelKey: 'timelinePage.zoomMonth' },
  { value: 'quarter', labelKey: 'timelinePage.zoomQuarter' },
];

/** − / + товчны алхам (үржвэр). */
const ZOOM_STEP = 1.4;
/** Товчийг «идэвхтэй» гэж үзэх хамгийн их хазайлт (харьцангуй). */
const PRESET_TOLERANCE = 0.15;

/**
 * Одоогийн нягтралд ХАМГИЙН ОЙР товчлуурыг олно — зөвхөн ±15%-ийн дотор
 * байвал.  Үргэлжилсэн zoom дээр «Сар» товч байнга асаалттай байвал
 * хэрэглэгчид худал мэдээлэл өгнө, тул хол зөрсөн үед null.
 */
function activePreset(pxPerDay: number): Zoom | null {
  let best: Zoom | null = null;
  let bestDelta = Number.POSITIVE_INFINITY;
  for (const zoom of ZOOMS) {
    const preset = ZOOM_PRESETS[zoom.value];
    const delta = Math.abs(pxPerDay - preset) / preset;
    if (delta < bestDelta) {
      bestDelta = delta;
      best = zoom.value;
    }
  }
  return bestDelta <= PRESET_TOLERANCE ? best : null;
}
// EXPECT: activePreset(ZOOM_PRESETS.month) === 'month'
// EXPECT: activePreset(ZOOM_PRESETS.week) === 'week'
// EXPECT: activePreset(ZOOM_PRESETS.week * 1.1) === 'week'    (10% зөрүү → тэвчинэ)
// EXPECT: activePreset(ZOOM_PRESETS.week * 1.6) === null      (60% зөрүү → аль нь ч биш)
// EXPECT: activePreset(ZOOM_PRESETS.quarter) === 'quarter'

export interface TimelineToolbarProps {
  /** Нэг хоногийн өргөн (px) — үргэлжилсэн утга. */
  pxPerDay: number;
  onPxPerDayChange: (next: number) => void;
  stateFilter: StateFilter;
  onStateFilterChange: (value: StateFilter) => void;
  search: string;
  onSearchChange: (value: string) => void;
  /** «Өнөөдөр» — Gantt-ийг өнөөдрийн багана руу гүйлгэнэ. */
  onToday: () => void;
  /** Шүүлтэд тохирсон төслийн тоо. */
  projectCount: number;
}

export function TimelineToolbar({
  pxPerDay,
  onPxPerDayChange,
  stateFilter,
  onStateFilterChange,
  search,
  onSearchChange,
  onToday,
  projectCount,
}: TimelineToolbarProps) {
  const { t } = useLanguage();

  const active = activePreset(pxPerDay);
  // Хязгаарт хүрсэн эсэхийг clamp-аар шалгана — MIN/MAX-ийг хоёр удаа
  // тайлбарлахгүйн тулд.
  const canZoomIn = clampPxPerDay(pxPerDay * ZOOM_STEP) > pxPerDay;
  const canZoomOut = clampPxPerDay(pxPerDay / ZOOM_STEP) < pxPerDay;

  return (
    <div className="flex flex-col gap-3 lg:flex-row lg:flex-wrap lg:items-center lg:justify-between">
      {/* ── Томруулалт.  Чарт 2026-08-наас БҮХ дэлгэцэнд харагддаг болсон
             (Анхаарах жагсаалт устсан) тул энэ бүлэг ч нуугдахаа больсон —
             утсан дээр нягтралыг өөрчлөх нь ялангуяа хэрэгтэй. ── */}
      <div
        role="group"
        aria-label={t('timelinePage.zoomLevel')}
        className="flex items-center gap-1"
      >
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t('timelinePage.zoomOut')}
          title={t('timelinePage.zoomOut')}
          disabled={!canZoomOut}
          onClick={() => onPxPerDayChange(clampPxPerDay(pxPerDay / ZOOM_STEP))}
        >
          <ZoomOut className="h-4 w-4" />
        </Button>

        <div className="inline-flex items-center gap-1 rounded-lg bg-muted/40 p-1">
          {ZOOMS.map((z) => (
            <Button
              key={z.value}
              size="sm"
              variant={active === z.value ? 'default' : 'ghost'}
              className="text-micro h-7 px-3"
              aria-pressed={active === z.value}
              onClick={() => onPxPerDayChange(clampPxPerDay(ZOOM_PRESETS[z.value]))}
            >
              {t(z.labelKey)}
            </Button>
          ))}
        </div>

        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t('timelinePage.zoomIn')}
          title={t('timelinePage.zoomIn')}
          disabled={!canZoomIn}
          onClick={() => onPxPerDayChange(clampPxPerDay(pxPerDay * ZOOM_STEP))}
        >
          <ZoomIn className="h-4 w-4" />
        </Button>

        {/* Ctrl + дугуй / чирэх заавар — нарийн дэлгэцэнд орон зай эзлэхгүй. */}
        <span className="ml-1 hidden text-micro text-muted-foreground xl:inline">
          {t('timelinePage.zoomHint')}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {/* ── Төлөвөөр шүүх ── */}
        <Select
          value={stateFilter}
          onValueChange={(value) => onStateFilterChange(value as StateFilter)}
        >
          <SelectTrigger size="sm" className="w-44" aria-label={t('timelinePage.filterState')}>
            <SelectValue placeholder={t('timelinePage.filterState')} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('timelinePage.filterStateAll')}</SelectItem>
            <SelectItem value="attention">{t('timelinePage.filterStateAttention')}</SelectItem>
            {RISK_ORDER.map((state) => (
              <SelectItem key={state} value={state}>
                {t(riskLabelKey(state))}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* ── Нэрээр хайх ── */}
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            aria-label={t('timelinePage.searchPlaceholder')}
            placeholder={t('timelinePage.searchPlaceholder')}
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            className="h-9 w-48 pl-8"
          />
        </div>

        {/* ── Өнөөдөр рүү гүйлгэх ── */}
        <Button
          variant="outline"
          size="sm"
          className="h-9 gap-2"
          title={t('timelinePage.scrollToToday')}
          onClick={onToday}
        >
          <CalendarCheck className="h-4 w-4" />
          {t('timelinePage.today')}
        </Button>

        {/* ── Шүүлтийн үр дүнгийн тоо — шүүлтүүрийн ХАЖУУД байх нь утгатай ── */}
        <span className="text-micro tabular-nums text-muted-foreground">
          {t('timelinePage.projectCount', { n: projectCount })}
        </span>
      </div>
    </div>
  );
}

export default TimelineToolbar;
