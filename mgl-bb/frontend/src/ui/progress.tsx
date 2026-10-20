'use client';

import * as React from 'react';
import { Progress as ProgressPrimitive } from 'radix-ui';

import { cn } from '@/shared/lib/utils';

function Progress({
  className,
  value,
  indicatorClassName,
  ...props
}: React.ComponentProps<typeof ProgressPrimitive.Root> & { indicatorClassName?: string }) {
  // Прогрессийн тоо 100-аас давж болно (жингийн нийлбэр 100-аас их төслүүд —
  // rollup нь санаатайгаар таглахгүй, өгөгдлийн алдаа ил байх ёстой).  Гэхдээ
  // МӨРНИЙ ГЕОМЕТРИЙГ таглах ёстой: 120 үед `translateX(20%)` болж мөр баруун
  // тийш гулсан, зүүн талдаа хоосон зай үлдэж 120% нь 80%-иас ДУТУУ дүүрсэн
  // харагдана.  Мөн Radix-ийн `max` (анхдагч 100)-аас давбал `data-state`
  // `indeterminate` болж `aria-valuenow` алга болно.  Хэвлэгдэх ТОО нь
  // дуудагч талдаа жинхэнэ утгаараа үлдэнэ — энд зөвхөн дүрслэл таглагдана.
  const max = typeof props.max === 'number' && props.max > 0 ? props.max : 100;
  const raw = Number(value);
  const shown = Number.isFinite(raw) ? Math.max(0, Math.min(max, raw)) : 0;
  return (
    <ProgressPrimitive.Root
      data-slot="progress"
      className={cn('relative h-2 w-full overflow-hidden rounded-full bg-primary/20', className)}
      value={shown}
      {...props}
    >
      <ProgressPrimitive.Indicator
        data-slot="progress-indicator"
        className={cn('h-full w-full flex-1 bg-primary transition-all', indicatorClassName)}
        style={{ transform: `translateX(-${100 - (shown / max) * 100}%)` }}
      />
    </ProgressPrimitive.Root>
  );
}

export { Progress };
