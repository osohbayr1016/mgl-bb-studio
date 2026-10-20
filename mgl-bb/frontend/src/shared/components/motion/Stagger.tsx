/**
 * Stagger / StaggerItem — жагсаалт, grid-ийн хүүхдүүдийг viewport-д орох үед
 * дараалан (cascade) reveal хийнэ. Нэг удаа тоглоно.
 *
 * Хэрэглээ:
 *   <Stagger className="grid ...">
 *     {items.map((it) => <StaggerItem key={it.id}>...</StaggerItem>)}
 *   </Stagger>
 */
import type { ComponentProps, ReactNode } from 'react';
import { m } from 'motion/react';

import { staggerContainer, fadeUp } from '@/shared/lib/motion';

type DivProps = ComponentProps<typeof m.div>;

export function Stagger({
  children,
  className,
  ...props
}: { children: ReactNode; className?: string } & DivProps) {
  return (
    <m.div
      variants={staggerContainer}
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

export function StaggerItem({
  children,
  className,
  ...props
}: { children: ReactNode; className?: string } & DivProps) {
  return (
    <m.div variants={fadeUp} className={className} {...props}>
      {children}
    </m.div>
  );
}
