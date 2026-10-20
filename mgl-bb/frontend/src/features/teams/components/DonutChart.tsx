import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { ExternalLink } from 'lucide-react';
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/i18n';
import { MUTED_OPACITY, type DonutSlice, type RosterGroup } from '../lib/donut';
import { RosterList } from './RosterList';

export type { DonutSlice } from '../lib/donut';

/**
 * Багууд хуудасны график хэлбэрүүд — НЭГ файлд.
 *
 * Эзний хүсэлт (2026-09-14): «дугуй диаграм, график хараад л бүх мэдээллийг
 * авдаг байх; олон нэр, текст биш».  Тиймээс энд гурван хэлбэр байна:
 *
 *   • `DonutChart`  — хэсэг-бүхэл (баг/төслийн хуваарилалт).  Голд нь ТОМ тоо
 *                     (заавал биш), хажууд нь домог (өнгө · нэр · тоо · %).
 *   • `RingMeter`   — нэг харьцаа (явц %, ирц %).  Нэг өнгө + саарал үлдэгдэл;
 *                     хоёр зүсэмтэй «pie» БИШ — тоо нь өөрөө диаграм.
 *   • `SplitBar`    — хэвтээ хоёр өнгийн тууз (багийн хүн: төсөлтэй / төсөлгүй).
 *
 * Дүрмүүд (dataviz):
 *   – утга ХЭЗЭЭ Ч зөвхөн өнгөөр илэрхийлэгдэхгүй: домог + тоо үргэлж хамт;
 *   – хүн бүр ЯГ НЭГ зүсэмд (үндсэн төслөөрөө) — зүсмүүдийн нийлбэр = голын тоо;
 *   – зүсмүүдийн хооронд 2px гадаргуун зай (`stroke = card`), хүрээ биш;
 *   – текст нь текстийн өнгөөр, цувааны өнгөөр БИШ.
 *
 * НЭРСИЙН САМБАР (2026-09-15, эзний хүсэлт): зүсэм эсвэл домгийн мөр дээр
 * хулганаа аваачихад тэр баг/төсөл дээр ажиллаж буй БҮХ хүний нэр гарна
 * (`slice.roster`).  Зөвхөн HOVER — «тогтоох» товч 2026-09-16-нд эзний
 * хүсэлтээр хасагдсан.  Хулгана самбар дотор орвол самбар үлдэнэ (урт
 * жагсаалтыг гүйлгэж болно).  Хүнтэй холбогдох ямар ч товч БАЙХГҮЙ.
 *
 * ⚠️ Самбар нь `createPortal`-аар `body`-д: карт бүр `overflow-y-auto`
 * тул дотор нь зурвал тасарна (recharts-ийн Tooltip яг тэгж тасардаг).
 *
 * ⚠️ ХӨВӨГЧ ДАВХАРГА = `bg-popover`, `bg-background` БИШ (2026-09-16).
 * «Дундаж» theme дээр `--background` = `--card` тул tooltip картаас
 * ялгарахгүй, «нэвт харагдаж байна» гэсэн гомдол гарсан.  Мөн голын тоо
 * (`center`) нь `ResponsiveContainer`-ийн ДАРАА байрлах absolute div тул
 * recharts-ийн tooltip-ийн ДЭЭР зурагдаж «54» нь tooltip дундуур гарч
 * байв — tooltip wrapper-т `zIndex` өгч тэр давхарлалтыг засав.
 */

const pct = (v: number, total: number) => (total > 0 ? Math.round((v / total) * 100) : 0);

function SliceTooltip({
  active,
  payload,
  total,
}: {
  active?: boolean;
  payload?: Array<{ payload: DonutSlice }>;
  total: number;
}) {
  const s = payload?.[0]?.payload;
  // Нэрсийн самбартай зүсэмд энгийн tooltip давхардуулахгүй.
  if (!active || !s || s.roster) return null;
  return (
    <div className="rounded-lg border border-border bg-popover px-2.5 py-1.5 text-xs text-popover-foreground shadow-xl">
      <div className="flex items-center gap-1.5">
        <span
          className="h-2.5 w-2.5 shrink-0 rounded-[2px]"
          style={{ backgroundColor: s.color, opacity: s.muted ? MUTED_OPACITY : 1 }}
        />
        {s.code && <span className="font-mono font-semibold">{s.code}</span>}
        <span className="font-medium">{s.label}</span>
      </div>
      <div className="mt-0.5 text-muted-foreground">
        <span className="font-semibold tabular-nums text-foreground">{s.value}</span> ·{' '}
        {pct(s.value, total)}%
      </div>
      {s.hint && <div className="mt-0.5 max-w-[220px] text-[10px] text-muted-subtle">{s.hint}</div>}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Нэрсийн самбар                                                       */

const POPOVER_WIDTH = 360;
const POPOVER_GAP = 8;
const EDGE = 8;
/** Хулгана цагирагаас самбар руу шилжих зай — тэр хооронд самбар алга болохгүй. */
const HIDE_DELAY_MS = 180;

function RosterPopover({
  slice,
  total,
  anchorRef,
  onEnter,
  onLeave,
}: {
  slice: DonutSlice;
  total: number;
  anchorRef: RefObject<HTMLElement | null>;
  onEnter: () => void;
  onLeave: () => void;
}) {
  const { t } = useLanguage();
  const ref = useRef<HTMLDivElement>(null);

  // Байрлал: цагирагийн БАРУУН талд; багтахгүй бол зүүн талд; дэлгэцийн
  // дээд/доод хилээс хальж болохгүй.  Самбарын өндөр рендерийн дараа л
  // мэдэгдэх тул layout effect — зурагдахаас өмнө байрлана (үсрэлтгүй).
  // DOM-д шууд бичнэ (state биш): байрлал нь рендерийн гаралт биш, гадаад
  // системийн (viewport) синхрончлол.
  useLayoutEffect(() => {
    const el = ref.current;
    const anchor = anchorRef.current;
    if (!el || !anchor) return;
    const r = anchor.getBoundingClientRect();
    const h = el.offsetHeight;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let left = r.right + POPOVER_GAP;
    if (left + POPOVER_WIDTH > vw - EDGE) left = r.left - POPOVER_GAP - POPOVER_WIDTH;
    if (left < EDGE) left = Math.max(EDGE, Math.min(vw - EDGE - POPOVER_WIDTH, r.left));
    let top = r.top;
    if (top + h > vh - EDGE) top = Math.max(EDGE, vh - EDGE - h);
    el.style.top = `${top}px`;
    el.style.left = `${left}px`;
    el.style.visibility = 'visible';
    // `anchorRef` нь ref объект — мутаци нь рендер үүсгэдэггүй тул dep биш
    // (оруулбал lint «unnecessary», хасвал «missing» гэдэг — хоёр тал нь зөрдөг).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slice]);

  const groups: RosterGroup[] = slice.roster ?? [];
  const count = groups.reduce((s, g) => s + g.people.length, 0);

  return createPortal(
    <div
      ref={ref}
      role="dialog"
      aria-label={slice.label}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        width: POPOVER_WIDTH,
        maxWidth: `calc(100vw - ${EDGE * 2}px)`,
        visibility: 'hidden',
      }}
      className="z-50 flex max-h-[80vh] flex-col rounded-xl border border-border bg-popover text-xs text-popover-foreground shadow-2xl"
    >
      <header className="flex shrink-0 items-start gap-2 border-b border-border/60 px-3 py-2">
        <span
          className="mt-1 h-2.5 w-2.5 shrink-0 rounded-[2px]"
          style={{ backgroundColor: slice.color, opacity: slice.muted ? MUTED_OPACITY : 1 }}
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-1.5">
            {slice.code && <span className="font-mono font-semibold">{slice.code}</span>}
            <span className="min-w-0 truncate text-sm font-semibold">{slice.label}</span>
            {slice.href && (
              <Link
                to={slice.href}
                className="shrink-0 text-muted-foreground transition-colors hover:text-primary"
                title={t('teams.rosterOpen')}
              >
                <ExternalLink className="h-3.5 w-3.5" />
              </Link>
            )}
          </div>
          <div className="text-muted-foreground">
            <span className="font-semibold tabular-nums text-foreground">{slice.value}</span> ·{' '}
            {pct(slice.value, total)}%
            {count !== slice.value && (
              <>
                {' · '}
                {t('teams.rosterNamesCount', { count })}
              </>
            )}
          </div>
          {slice.hint && (
            <div className="mt-0.5 text-[10px] leading-snug text-muted-subtle">{slice.hint}</div>
          )}
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
        <RosterList groups={groups} sliceLabel={slice.label} />
      </div>
    </div>,
    document.body,
  );
}

/* ------------------------------------------------------------------ */

/**
 * Донат.  `center` нь голын том тоо + доорх жижиг шошго (заавал биш).
 * `legend` нь баруун талд (өгөгдмөл) эсвэл доор; `none` бол зөвхөн цагираг
 * (жижиг карт дотор хэрэглэнэ — тэнд нэр нь картын гарчигт байдаг).
 *
 * `roster`-тэй зүсэм: hover → нэрсийн самбар; дарвал `onSelect` (байвал).
 * `roster`-гүй зүсэм: энгийн tooltip; дарвал `onSelect` (байвал).
 */
export function DonutChart({
  slices,
  total,
  size = 150,
  thickness = 0.3,
  center,
  legend = 'right',
  legendMax = 7,
  className,
  emptyLabel,
  onSelect,
}: {
  slices: DonutSlice[];
  /** Хувийн суурь.  Өгөхгүй бол зүсмүүдийн нийлбэр. */
  total?: number;
  size?: number;
  /** Цагирагийн зузаан — радиусын хувь (0.3 = 30%). */
  thickness?: number;
  center?: { value: string | number; label?: string };
  legend?: 'right' | 'bottom' | 'none';
  legendMax?: number;
  className?: string;
  emptyLabel?: string;
  onSelect?: (slice: DonutSlice) => void;
}) {
  const id = useId();
  const visible = slices.filter((s) => s.value > 0);
  const sum = visible.reduce((s, x) => s + x.value, 0);
  const base = total ?? sum;
  const empty = visible.length === 0;
  const outer = size / 2;
  const inner = Math.round(outer * (1 - thickness));

  /* ── Нэрсийн самбарын төлөв ── */
  const ringRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const [hovered, setHovered] = useState<DonutSlice | null>(null);
  const hideTimer = useRef<number | undefined>(undefined);

  const cancelHide = useCallback(() => {
    if (hideTimer.current) window.clearTimeout(hideTimer.current);
    hideTimer.current = undefined;
  }, []);
  // Дарсны дараа хулгана зүсэм дээрээ байсаар байхад самбар БУЦАЖ гарахгүй:
  // recharts зүсмийг дахин зурахад mouseenter шинээр үүсдэг (хэмжсэн — эс
  // тэгвэл дарсан ч самбар үлддэг).  Хулгана гарч (scheduleHide) л дахин зөвшөөрнө.
  const suppressed = useRef(false);
  const show = useCallback(
    (s: DonutSlice) => {
      cancelHide();
      if (suppressed.current) return;
      if (s.roster) setHovered(s);
    },
    [cancelHide],
  );
  const scheduleHide = useCallback(() => {
    cancelHide();
    suppressed.current = false;
    hideTimer.current = window.setTimeout(() => setHovered(null), HIDE_DELAY_MS);
  }, [cancelHide]);
  useEffect(() => cancelHide, [cancelHide]);

  // Дарахад hover самбар ТЭР ДАРУЙ алга болно (2026-09-16, эзний хүсэлт) —
  // мэдээлэл нь баруун талын самбарт очих тул давхар харуулахгүй.
  const activate = useCallback(
    (s: DonutSlice) => {
      cancelHide();
      suppressed.current = true;
      setHovered(null);
      onSelect?.(s);
    },
    [cancelHide, onSelect],
  );

  // Өгөгдөл солигдоход (огноо, хэмжүүр) хөндсөн зүсэм хуучирна — хаана.
  // ⚠️ `slices` массивын identity-гаар биш — Багаар таб зүсмээ рендер
  // бүрд шинээр угсардаг тул identity-гаар бол самбар дараагийн рендерт л
  // алга болно.  Тиймээс түлхүүр+тоо гарын үсгээр.
  const signature = visible.map((s) => `${String(s.key)}=${s.value}`).join('|');
  const [prevSignature, setPrevSignature] = useState(signature);
  if (prevSignature !== signature) {
    setPrevSignature(signature);
    setHovered(null);
  }

  const shown = hovered;
  const clickable = Boolean(onSelect);

  const ring = (
    <div ref={ringRef} className="relative shrink-0" style={{ width: size, height: size }}>
      {empty ? (
        <div className="absolute inset-0 rounded-full border-[10px] border-muted" aria-hidden />
      ) : (
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={visible}
              dataKey="value"
              nameKey="label"
              innerRadius={inner}
              outerRadius={outer}
              startAngle={90}
              endAngle={-270}
              /* 2px-ийн гадаргуун зай — зэргэлдээ зүсмүүд уусахгүй.
                 ⚠️ `var(--card)` нь HSL гурвал, `--color-card` нь бүрэн өнгө. */
              stroke="var(--color-card)"
              strokeWidth={2}
              isAnimationActive={false}
              onClick={clickable ? (_, i) => visible[i] && activate(visible[i]) : undefined}
              onMouseEnter={(_, i) => visible[i] && show(visible[i])}
              onMouseLeave={scheduleHide}
              className={clickable ? 'cursor-pointer' : undefined}
            >
              {visible.map((s) => (
                <Cell
                  key={String(s.key)}
                  fill={s.color}
                  fillOpacity={s.muted ? MUTED_OPACITY : 1}
                  /* Хөндсөн зүсэм бусдаасаа ялгарна — самбар аль зүсмийнх
                     болохыг өнгөөр биш, тодролоор хэлнэ. */
                  opacity={shown && shown.key !== s.key ? 0.45 : 1}
                />
              ))}
            </Pie>
            <Tooltip
              content={<SliceTooltip total={base} />}
              /* zIndex: голын тоо (`center`) нь дараагийн absolute div тул
                 үгүй бол tooltip-ийн ДЭЭР зурагдана. */
              wrapperStyle={{ outline: 'none', zIndex: 10 }}
              isAnimationActive={false}
            />
          </PieChart>
        </ResponsiveContainer>
      )}
      {center && (
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
          <span
            className="font-semibold leading-none"
            style={{ fontSize: Math.max(16, Math.round(size * 0.2)) }}
          >
            {center.value}
          </span>
          {center.label && (
            <span className="mt-1 max-w-[70%] text-[10px] leading-tight text-muted-foreground">
              {center.label}
            </span>
          )}
        </div>
      )}
    </div>
  );

  const popover = shown && shown.roster && (
    <RosterPopover
      slice={shown}
      total={base}
      anchorRef={ringRef}
      onEnter={cancelHide}
      onLeave={scheduleHide}
    />
  );

  if (legend === 'none') {
    return (
      <div ref={rootRef} className={className}>
        {ring}
        {popover}
      </div>
    );
  }

  const rows = visible.slice(0, legendMax);

  return (
    <div
      ref={rootRef}
      className={cn(
        'flex min-w-0 gap-3',
        legend === 'right' ? 'flex-row items-center' : 'flex-col items-center',
        className,
      )}
      data-donut={id}
    >
      {ring}
      {empty ? (
        <p className="text-xs italic text-muted-foreground">{emptyLabel}</p>
      ) : (
        <ul className={cn('min-w-0 flex-1 space-y-1', legend === 'bottom' && 'w-full')}>
          {rows.map((s) => (
            <li key={String(s.key)}>
              <button
                type="button"
                onClick={clickable ? () => activate(s) : undefined}
                onMouseEnter={() => show(s)}
                onMouseLeave={scheduleHide}
                className={cn(
                  'flex w-full items-center gap-2 rounded-md px-1 py-0.5 text-left',
                  clickable && 'transition-colors hover:bg-muted/60',
                )}
                title={s.roster ? undefined : s.hint ? `${s.label} — ${s.hint}` : s.label}
              >
                <span
                  className="h-2.5 w-2.5 shrink-0 rounded-[2px]"
                  style={{ backgroundColor: s.color, opacity: s.muted ? MUTED_OPACITY : 1 }}
                />
                <span className="min-w-0 flex-1 truncate text-xs">
                  {s.code && <span className="mr-1 font-mono font-semibold">{s.code}</span>}
                  <span className={s.code ? 'text-muted-foreground' : undefined}>{s.label}</span>
                </span>
                <span className="shrink-0 text-xs font-semibold tabular-nums">{s.value}</span>
                <span className="w-9 shrink-0 text-right text-[10px] tabular-nums text-muted-foreground">
                  {pct(s.value, base)}%
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {popover}
    </div>
  );
}

/**
 * Нэг харьцааны цагираг (явц, ирц).  SVG — recharts хэрэггүй, 4 KB-ийн
 * түүхий тойрог.  Өнгө нь НЭГ (утга) + саарал зам; тоо нь голд.
 */
export function RingMeter({
  value,
  max = 100,
  size = 64,
  stroke = 7,
  color = 'var(--color-primary)',
  label,
  className,
}: {
  value: number;
  max?: number;
  size?: number;
  stroke?: number;
  color?: string;
  /** Голд гарах бичвэр; өгөхгүй бол `${хувь}%`. */
  label?: string;
  className?: string;
}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const frac = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
  return (
    <div className={cn('relative shrink-0', className)} style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="var(--color-muted)"
          strokeWidth={stroke}
        />
        {/* 0 бол зурахгүй — дугуй үзүүр (`round`) нь тэг урттай ч цэг үлдээдэг. */}
        {frac > 0 && (
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke={color}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={`${c * frac} ${c}`}
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
          />
        )}
      </svg>
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
        <span className="font-semibold leading-none" style={{ fontSize: Math.round(size * 0.24) }}>
          {label ?? `${Math.round(frac * 100)}%`}
        </span>
      </div>
    </div>
  );
}

/**
 * Хоёр хэсэгт хуваасан хэвтээ тууз — «N-ийн M» хэлбэрийн харьцаа.
 * Эхний хэсэг нь утгын өнгө, үлдсэн нь саарал.  Тоо нь баруун талд.
 */
export function SplitBar({
  value,
  total,
  color,
  label,
  caption,
  className,
}: {
  value: number;
  total: number;
  color: string;
  label?: string;
  caption?: string;
  className?: string;
}) {
  const p = total > 0 ? Math.min(100, (value / total) * 100) : 0;
  return (
    <div className={cn('flex items-center gap-2', className)}>
      {label && <span className="w-12 shrink-0 truncate text-xs">{label}</span>}
      <div className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full" style={{ width: `${p}%`, backgroundColor: color }} />
      </div>
      <span className="w-14 shrink-0 text-right text-xs tabular-nums">
        <span className="font-semibold">{value}</span>
        <span className="text-muted-foreground">/{total}</span>
      </span>
      {caption && <span className="shrink-0 text-[10px] text-muted-foreground">{caption}</span>}
    </div>
  );
}
