/**
 * AnimatedNumber — тоог өмнөх утгаас зорилтот утга руу count-up хийнэ
 * (KPI tile, leaderboard оноо г.м.). reduced-motion үед шууд эцсийн утга.
 * Screen-reader-т `aria-label`-аар эцсийн утгыг шууд өгнө.
 */
import { useEffect } from 'react';
import { m, useMotionValue, useTransform, animate, useReducedMotion } from 'motion/react';

import { EASE_OUT } from '@/shared/lib/motion';

export function AnimatedNumber({
  value,
  decimals = 0,
  durationSec = 0.8,
  className,
}: {
  value: number;
  decimals?: number;
  durationSec?: number;
  className?: string;
}) {
  const reduce = useReducedMotion();
  const mv = useMotionValue(reduce ? value : 0);
  const text = useTransform(mv, (v) => v.toFixed(decimals));

  useEffect(() => {
    if (reduce) {
      mv.set(value);
      return;
    }
    const controls = animate(mv, value, { duration: durationSec, ease: EASE_OUT });
    return () => controls.stop();
  }, [value, reduce, durationSec, mv]);

  return (
    <m.span className={className} aria-label={value.toFixed(decimals)}>
      {text}
    </m.span>
  );
}
