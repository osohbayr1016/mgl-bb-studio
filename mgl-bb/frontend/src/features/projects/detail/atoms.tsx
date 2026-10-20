/** Small presentational atoms shared across the ProjectDetailPage tree.
 *  Extracted verbatim from `ProjectDetailPage.tsx` when that file was split
 *  into per-component modules — no behavioural change. */
import { cn } from '@/shared/lib/utils';

export function StatusDot({ progress }: { progress: number }) {
  let cls = 'bg-muted-foreground/40';
  if (progress >= 100) cls = 'bg-green-500';
  else if (progress > 0) cls = 'bg-primary';
  return <span className={cn('w-2 h-2 rounded-full shrink-0', cls)} />;
}

export function EmptyState({
  icon,
  title,
  description,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <div className="text-center py-16 border border-dashed border-border rounded-lg">
      <div className="mx-auto w-16 h-16 rounded-full bg-muted/50 flex items-center justify-center text-muted-foreground mb-3">
        {icon}
      </div>
      <h3 className="font-medium text-foreground">{title}</h3>
      <p className="text-sm text-muted-foreground mt-1 max-w-sm mx-auto">{description}</p>
    </div>
  );
}

export function BlockRing({ value }: { value: number }) {
  const v = Math.max(0, Math.min(100, value));
  const r = 30;
  const c = 2 * Math.PI * r;
  const offset = c - (v / 100) * c;
  return (
    <div className="relative w-20 h-20 flex-shrink-0">
      <svg viewBox="0 0 80 80" className="w-full h-full -rotate-90">
        <circle cx="40" cy="40" r={r} stroke="hsl(var(--muted))" strokeWidth="7" fill="none" />
        <circle
          cx="40"
          cy="40"
          r={r}
          stroke="hsl(var(--primary))"
          strokeWidth="7"
          fill="none"
          strokeDasharray={c}
          strokeDashoffset={offset}
          strokeLinecap="round"
          style={{ transition: 'stroke-dashoffset 0.6s ease' }}
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="text-lg font-bold tabular-nums text-primary">{v.toFixed(0)}%</span>
      </div>
    </div>
  );
}

export function TimingTile({
  icon,
  label,
  value,
  sub,
  tone = 'default',
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
  tone?: 'default' | 'primary' | 'warning' | 'destructive';
}) {
  const toneCls =
    tone === 'primary'
      ? 'bg-primary/10 border-primary/30 text-primary'
      : tone === 'warning'
        ? 'bg-amber-500/10 border-amber-500/30 text-amber-500'
        : tone === 'destructive'
          ? 'bg-destructive/10 border-destructive/30 text-destructive'
          : 'bg-card/60 border-border/60 text-foreground';
  return (
    <div className={cn('p-3 rounded-lg border', toneCls)}>
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider opacity-80">
        {icon}
        {label}
      </div>
      <div className="text-base font-bold tabular-nums mt-1">{value}</div>
      {sub && <div className="text-[10px] opacity-70 mt-0.5 truncate">{sub}</div>}
    </div>
  );
}

export function StatTile({
  icon,
  label,
  value,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  tone: 'default' | 'success' | 'info' | 'muted';
}) {
  const toneCls =
    tone === 'success'
      ? 'text-emerald-500'
      : tone === 'info'
        ? 'text-primary'
        : tone === 'muted'
          ? 'text-muted-foreground'
          : 'text-foreground';
  return (
    <div className="p-3 rounded-lg border border-border/60 bg-card/40">
      <div
        className={cn('flex items-center gap-1.5 text-[10px] uppercase tracking-wider', toneCls)}
      >
        {icon}
        {label}
      </div>
      <div className={cn('text-2xl font-bold tabular-nums mt-1', toneCls)}>{value}</div>
    </div>
  );
}

