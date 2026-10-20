import { cn } from '@/shared/lib/utils';
import { initialsOf } from '../../lib/mgmtJournal';

/** Хүн бүрд тогтмол өнгө (id-аар) — нэг хүн хаана ч ижил өнгөтэй. */
const TONES = [
  'bg-primary/15 text-primary',
  'bg-success/15 text-success',
  'bg-warning/15 text-warning',
  'bg-info/15 text-info',
  'bg-chart-4/15 text-chart-4',
  'bg-chart-5/15 text-chart-5',
];

function toneOf(userId: number): string {
  return TONES[Math.abs(userId) % TONES.length]!;
}

export function MgmtAvatar({
  userId,
  name,
  size = 'md',
  className,
}: {
  userId: number;
  name: string;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        'grid shrink-0 place-items-center rounded-full font-semibold select-none',
        size === 'sm' && 'size-6 text-micro',
        size === 'md' && 'size-9 text-sm',
        size === 'lg' && 'size-11 text-base',
        toneOf(userId),
        className,
      )}
    >
      {initialsOf(name)}
    </span>
  );
}
