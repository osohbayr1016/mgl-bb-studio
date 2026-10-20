/**
 * Motion design tokens — аппын бүх "амьд" animation-ий ганц эх үүсвэр.
 *
 * Spring preset + variants-ийг эндээс импортолж, дараа аппын аяыг нэг
 * газраас тааруулна. `motion` (framer-motion) дээр суурилсан; LazyMotion +
 * `m` компонентоор ачаалдаг тул эхний bundle хөнгөн (providers.tsx-ийг үз).
 */
import type { Transition, Variants } from 'motion/react';

/** Spring preset-үүд. Эрчмээ эндээс авна. */
export const SPRING = {
  /** товч/таб — хурдан, тогтвортой */
  snappy: { type: 'spring', stiffness: 400, damping: 30 },
  /** celebration/badge — overshoot bounce */
  bouncy: { type: 'spring', stiffness: 500, damping: 18 },
  /** card/layout — зөөлөн, жигд */
  smooth: { type: 'spring', stiffness: 250, damping: 32 },
} satisfies Record<string, Transition>;

export const DURATION = { fast: 0.15, base: 0.2, slow: 0.5 } as const;

/** Одоогийн CSS аястай нийцсэн ease-out (cubic-bezier). */
export const EASE_OUT = [0.16, 1, 0.3, 1] as const;

/** viewport-д орвол доороос дээш fade-up. */
export const fadeUp: Variants = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0, transition: SPRING.smooth },
};

/** scale-аар pop-in (bounce). */
export const popIn: Variants = {
  hidden: { opacity: 0, scale: 0.9 },
  show: { opacity: 1, scale: 1, transition: SPRING.bouncy },
};

/** Хүүхдүүдээ дараалан reveal хийх контейнер (StaggerItem-тэй хослоно). */
export const staggerContainer: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.05, delayChildren: 0.02 } },
};
