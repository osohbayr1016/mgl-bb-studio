/**
 * RevealOnView — viewport-д орох үед нэг удаа fade-up. Дан блок (section,
 * card, hero) reveal-д. Олон хүүхдийг дараалуулахдаа `Stagger`-ийг үз.
 */
import type { ComponentProps, ReactNode } from 'react';
import { m } from 'motion/react';

import { fadeUp } from '@/shared/lib/motion';

export function RevealOnView({
  children,
  className,
  ...props
}: { children: ReactNode; className?: string } & ComponentProps<typeof m.div>) {
  return (
    <m.div
      variants={fadeUp}
      initial="hidden"
      whileInView="show"
      viewport={{ once: true, margin: '-10% 0px' }}
      className={className}
      {...props}
    >
      {children}
    </m.div>
  );
}
