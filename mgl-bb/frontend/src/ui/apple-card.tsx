/**
 * AppleCard — the Apple-Health-inspired card surface used across the
 * staff portal. Mirrors the look pioneered on the Client Dashboard:
 * a single rounded surface (no harsh border), `bg-card` so it adapts
 * to both light and dark modes, and the layered `shadow-apple` lift
 * declared in `index.css`.
 *
 * The subcomponents (`AppleCardHeader`, `AppleCardTitle`, `AppleCardContent`)
 * preserve the same internal API as the shadcn `Card` so callers can
 * swap `<Card>` → `<AppleCard>` with minimal churn. Defaults to a
 * 24px (`p-6`) interior — override per page when you need a denser
 * or roomier layout (e.g. `sm:p-8`).
 */
import * as React from 'react';
import { cn } from '@/shared/lib/utils';

function AppleCard({ className, ...props }: React.ComponentProps<'div'>) {
  // Drop-in shape compatible with shadcn `Card` — same `flex flex-col gap-6
  // py-6` so existing `<CardHeader>` / `<CardContent>` children render
  // identically. The Apple-style changes are: softer 28px corners, no
  // border, and the layered `shadow-apple` lift.
  return (
    <div
      data-slot="apple-card"
      className={cn(
        'flex flex-col gap-6 rounded-[1.75rem] bg-card py-6 text-card-foreground shadow-apple overflow-hidden',
        className,
      )}
      {...props}
    />
  );
}

function AppleCardHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="apple-card-header"
      className={cn('flex items-start justify-between gap-4 px-6 pt-6 pb-4 sm:px-7', className)}
      {...props}
    />
  );
}

function AppleCardTitle({ className, ...props }: React.ComponentProps<'h3'>) {
  return (
    <h3
      data-slot="apple-card-title"
      className={cn('text-section font-semibold tracking-tight text-foreground', className)}
      {...props}
    />
  );
}

function AppleCardContent({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div data-slot="apple-card-content" className={cn('px-6 pb-6 sm:px-7', className)} {...props} />
  );
}

export { AppleCard, AppleCardHeader, AppleCardTitle, AppleCardContent };
