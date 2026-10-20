import { useLayoutEffect, useMemo, useRef } from 'react';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/i18n';
import { countedMs, formatStopwatch, msUntilNextChange } from './stopwatch';
import { currentLunch, serverNowMs, subscribeFrame } from './timerClock';

/**
 * Apple-ийн секундомер шиг тоолуур: 1 цагаас доош `07:43.21 м`, дээш `1:05 ц`.
 *
 * Гөлгөр: явж байх үед React дахин рендерлэхгүй — нэг хуваалцсан
 * requestAnimationFrame давталт DOM-ын бичвэрийг шууд солино (өөрчлөгдсөн үед л).
 * 1 цагаас дээш бол минутын хил хүртэл дахин бичихгүй.
 * Нарийвчлал: `base` (серверийн дууссан нийлбэр) + (серверийн одоо − `since`) −
 * цайны цаг (2026-10-01: цонхонд тоолуур хөлдөж, дуусахад өөрөө үргэлжилнэ).
 * `since` нь олон эхлэл авч болно (2026-10-08: үндсэн таскийн НИЙТ цаг — хэд хэдэн хүн зэрэг ажиллаж байхад).
 */
export default function StopwatchText({
  baseMs,
  since,
  className,
  fracClassName,
  unitClassName,
  testId,
}: {
  /** Дууссан хэсгүүдийн нийлбэр (мс). */
  baseMs: number;
  /** Явж байвал дэлгэцийн эхлэл (серверийн цагаар, мс); олон хүн зэрэг бол эхлэл бүр; зогссон бол null. */
  since: number | readonly number[] | null;
  className?: string;
  fracClassName?: string;
  unitClassName?: string;
  testId?: string;
}) {
  const { t } = useLanguage();
  const mainRef = useRef<HTMLSpanElement>(null);
  const fracRef = useRef<HTMLSpanElement>(null);
  const unitRef = useRef<HTMLSpanElement>(null);
  // Массив дуудагч бүрд шинэ лавлагаа өгдөг — утгаар нь тогтворжуулна (эс бөгөөс рендер бүрд дахин бүртгэнэ).
  const sinceKey = since === null ? '' : typeof since === 'number' ? String(since) : since.join(',');
  const starts = useMemo(
    () => (sinceKey === '' ? [] : sinceKey.split(',').map(Number)),
    [sinceKey],
  );
  const hoursLabel = t('taskTimer.unitHours');
  const minutesLabel = t('taskTimer.unitMinutes');

  useLayoutEffect(() => {
    let nextAt = 0;
    const paint = (now: number) => {
      const lunch = currentLunch();
      let ms = baseMs;
      for (const s of starts) ms += countedMs(s, now, lunch);
      if (starts.length > 0 && now < nextAt) return;
      const p = formatStopwatch(ms);
      nextAt = now + msUntilNextChange(ms);
      const set = (el: HTMLSpanElement | null, text: string) => {
        if (el && el.textContent !== text) el.textContent = text;
      };
      set(mainRef.current, p.main);
      set(fracRef.current, p.frac);
      set(unitRef.current, p.unit === 'h' ? hoursLabel : minutesLabel);
    };
    paint(serverNowMs());
    if (starts.length === 0) return;
    return subscribeFrame(paint);
  }, [baseMs, starts, hoursLabel, minutesLabel]);

  return (
    <span
      role="timer"
      className={cn('inline-block whitespace-nowrap tabular-nums', className)}
      data-testid={testId}
    >
      <span ref={mainRef} />
      <span ref={fracRef} className={cn('empty:hidden opacity-60', fracClassName)} />
      <span ref={unitRef} className={cn('empty:hidden ml-0.5 opacity-60', unitClassName)} />
    </span>
  );
}
