import { createPortal } from 'react-dom';
import { useLanguage } from '@/shared/i18n';
import { cn } from '@/shared/lib/utils';
import { weekdayOf } from './lib';
import type { DayHover } from './useDayHover';

/**
 * Өдөр дээр hover хийхэд тэр өдрийн ажлыг харуулах хөвөгч карт (эзний хүсэлт
 * 2026-10-07 — GitHub contribution-ий tooltip шиг).  Heatmap, календарь,
 * менежментийн матриц гурвуулаа ЭНЭ компонентыг хэрэглэнэ.
 *
 * Нүд бүрт Radix tooltip зурвал 371 trigger болно — тиймээс эцэг элемент
 * `onMouseMove`-оор `[data-date]`-тай нүдийг олж (`./useDayHover`), ганц карт
 * `body`-д portal-аар зурагдана (`backdrop-blur`-тай карт `position: fixed`-ийн
 * containing block болдог тул portal заавал).
 */

const CARD_W = 288;
const MAX_ITEMS = 10;

export function DayHoverCard({
  hover,
  count,
  items,
  title,
  dateLabel,
  note,
}: {
  hover: DayHover | null;
  count: number;
  /** undefined = бичвэр ачаалаагүй (зөвхөн тоо харагдана). */
  items?: readonly string[];
  /** Жишээ нь матрицад гишүүний нэр. */
  title?: string;
  /** Огноо + гарагийн оронд (жишээ нь долоо хоногийн муж). */
  dateLabel?: string;
  /** Нэмэлт мөр (жишээ нь «3 өдөр бичсэн»). */
  note?: string;
}) {
  const { t } = useLanguage();
  if (!hover || typeof document === 'undefined') return null;

  const { rect, date } = hover;
  const vw = window.innerWidth;
  const half = Math.min(CARD_W, vw - 16) / 2;
  const cx = Math.min(Math.max(rect.left + rect.width / 2, half + 8), vw - half - 8);
  const above = rect.top > 240;
  const style = {
    left: cx,
    top: above ? rect.top - 8 : rect.bottom + 8,
    width: Math.min(CARD_W, vw - 16),
    transform: above ? 'translate(-50%, -100%)' : 'translate(-50%, 0)',
  } as const;

  const shown = items?.slice(0, MAX_ITEMS) ?? [];
  const rest = (items?.length ?? 0) - shown.length;

  return createPortal(
    <div
      role="tooltip"
      style={style}
      className="pointer-events-none fixed z-50 rounded-lg border border-border bg-popover p-3 text-popover-foreground shadow-lg"
    >
      {title && <p className="mb-0.5 truncate text-sm font-semibold">{title}</p>}
      <p className="flex flex-wrap items-baseline gap-x-1.5 text-micro text-muted-foreground">
        <span className="tabular-nums font-medium text-foreground">{dateLabel ?? date}</span>
        {!dateLabel && <span>{t(`dailyLog.weekday${weekdayOf(date)}`)}</span>}
        <span aria-hidden>·</span>
        <span className={cn(count > 0 && 'font-medium text-success')}>
          {count > 0 ? t('dailyLog.itemCount', { count }) : t('dailyLog.notWritten')}
        </span>
      </p>
      {note && <p className="mt-0.5 text-micro text-muted-foreground">{note}</p>}
      {shown.length > 0 && (
        <ol className="mt-2 space-y-0.5 text-sm">
          {shown.map((it, i) => (
            <li key={i} className="flex gap-1.5">
              <span className="shrink-0 tabular-nums text-muted-foreground">{i + 1}.</span>
              <span className="line-clamp-2 min-w-0 break-words">{it}</span>
            </li>
          ))}
        </ol>
      )}
      {rest > 0 && (
        <p className="mt-1 text-micro text-muted-foreground">
          {t('dailyLog.moreItems', { count: rest })}
        </p>
      )}
    </div>,
    document.body,
  );
}
