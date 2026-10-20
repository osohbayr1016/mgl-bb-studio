/**
 * MotionCard — `Card`-тай адил visual, гэхдээ framer-motion spring hover-lift
 * + tap feedback-тэй. Интерактив (товшдог) card-д ашиглана: жагсаалтын мөр,
 * KPI tile, төслийн card. Статик мэдээллийн card-д энгийн `Card`-аа хэрэглэ.
 *
 * reduced-motion-ийг провайдерын `MotionConfig reducedMotion="user"` нэгтгэж
 * зохицуулна — тэр үед transform унтарч opacity л үлдэнэ.
 */
import type { ComponentProps } from 'react';
import { m } from 'motion/react';

import { cn } from '@/shared/lib/utils';
import { SPRING } from '@/shared/lib/motion';

export function MotionCard({
  className,
  children,
  ...props
}: ComponentProps<typeof m.div>) {
  return (
    <m.div
      whileHover={{ y: -4 }}
      whileTap={{ scale: 0.985 }}
      transition={SPRING.smooth}
      className={cn(
        'flex flex-col gap-6 rounded-2xl bg-card py-6 text-card-foreground shadow-apple',
        'cursor-pointer hover:shadow-lift',
        className,
      )}
      {...props}
    >
      {children}
    </m.div>
  );
}
