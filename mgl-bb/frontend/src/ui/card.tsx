import * as React from 'react';

import { cn } from '@/shared/lib/utils';

function Card({
  className,
  interactive = false,
  ...props
}: React.ComponentProps<'div'> & {
  /** Hover-д өргөгдөх (lift + shadow) интерактив card. reduced-motion үед
   *  зөвхөн shadow үлдэж transform унтарна. Spring hover хүсвэл MotionCard. */
  interactive?: boolean;
}) {
  return (
    <div
      data-slot="card"
      className={cn(
        'flex flex-col gap-6 rounded-2xl bg-card py-6 text-card-foreground shadow-apple',
        interactive &&
          'cursor-pointer transition-all duration-200 hover:-translate-y-1 hover:shadow-lift motion-reduce:hover:translate-y-0',
        className,
      )}
      {...props}
    />
  );
}

function CardHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="card-header"
      className={cn(
        '@container/card-header grid auto-rows-min grid-rows-[auto_auto] items-start gap-2 px-6 has-data-[slot=card-action]:grid-cols-[1fr_auto] [.border-b]:pb-6',
        className,
      )}
      {...props}
    />
  );
}

function CardTitle({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    // Өмнө нь `leading-none font-semibold` — ХЭМЖЭЭ огт заагаагүй тул
    // body-гоос өвлөж 16px болдог байсан. Аппын 84 картын гарчиг бүхэлдээ
    // типографийн шатлалаас гадуур байсан гэсэн үг. `text-section` = 15/600.
    <div data-slot="card-title" className={cn('text-section', className)} {...props} />
  );
}

function CardDescription({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="card-description"
      className={cn('text-body text-muted-foreground', className)}
      {...props}
    />
  );
}

function CardAction({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="card-action"
      className={cn('col-start-2 row-span-2 row-start-1 self-start justify-self-end', className)}
      {...props}
    />
  );
}

function CardContent({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="card-content" className={cn('px-6', className)} {...props} />;
}

function CardFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="card-footer"
      className={cn('flex items-center px-6 [.border-t]:pt-6', className)}
      {...props}
    />
  );
}

export { Card, CardHeader, CardFooter, CardTitle, CardAction, CardDescription, CardContent };
