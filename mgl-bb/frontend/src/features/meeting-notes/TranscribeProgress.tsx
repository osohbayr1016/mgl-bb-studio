import { useEffect, useState } from 'react';

function fmt(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** D1 `datetime('now')` returns "YYYY-MM-DD HH:MM:SS" in UTC. Parse as UTC. */
function parseUtc(ts: string | null | undefined): number {
  if (!ts) return Date.now();
  const ms = Date.parse(ts.replace(' ', 'T') + 'Z');
  return Number.isFinite(ms) ? ms : Date.now();
}

/**
 * Time-based progress for an unknown-duration job (Speechmatics gives no
 * percentage).  Shows elapsed mm:ss and an asymptotic bar that creeps toward
 * ~95% — it decelerates over time so it never looks "stuck" and never claims
 * 100% before the job actually finishes.
 */
export function TranscribeProgress({
  startedAt,
  estimateSeconds,
  label,
  compact,
}: {
  startedAt: string | null | undefined;
  estimateSeconds?: number | null;
  label?: string;
  compact?: boolean;
}) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const startMs = parseUtc(startedAt);
    const tick = () => setElapsed(Math.max(0, (Date.now() - startMs) / 1000));
    tick();
    const h = setInterval(tick, 1000);
    return () => clearInterval(h);
  }, [startedAt]);

  // tau controls how fast the bar fills: ~63% at elapsed=tau, ~86% at 2·tau.
  // Scale it to the audio length when we know it; otherwise a sane default.
  const tau = Math.max(15, (estimateSeconds ?? 150) * 0.4);
  const pct = Math.min(96, 95 * (1 - Math.exp(-elapsed / tau)));

  return (
    <div className={compact ? 'space-y-1' : 'space-y-2'}>
      {!compact && label && (
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">{label}</span>
          <span className="tabular-nums text-muted-foreground">{fmt(elapsed)}</span>
        </div>
      )}
      <div
        className={`w-full rounded-full bg-muted overflow-hidden ${compact ? 'h-1' : 'h-2'}`}
      >
        <div
          className="h-full rounded-full bg-primary transition-[width] duration-1000 ease-linear"
          style={{ width: `${pct}%` }}
        />
      </div>
      {compact && (
        <span className="tabular-nums text-micro text-muted-foreground">{fmt(elapsed)}</span>
      )}
    </div>
  );
}
