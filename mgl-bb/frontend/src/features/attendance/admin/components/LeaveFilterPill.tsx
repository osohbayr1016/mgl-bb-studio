import { cn } from '@/shared/lib/utils';
import { APPROVAL_STATUS_SOLID } from '@/shared/lib/status-colors';

// Идэвхтэй (solid) төлөв нь нийтлэг APPROVAL_STATUS_SOLID-аас; idle нь
// ижил semantic token-ийн зөөлөн хувилбар. `muted` нь pill-ийн өвөрмөц
// хатуу тодосгогчийг хадгална.
const TONE: Record<string, { active: string; idle: string }> = {
  yellow: {
    active: APPROVAL_STATUS_SOLID.pending,
    idle: 'border-warning/30 text-warning hover:bg-warning/10',
  },
  emerald: {
    active: APPROVAL_STATUS_SOLID.approved,
    idle: 'border-success/30 text-success hover:bg-success/10',
  },
  rose: {
    active: APPROVAL_STATUS_SOLID.rejected,
    idle: 'border-danger/30 text-danger hover:bg-danger/10',
  },
  slate: {
    active: APPROVAL_STATUS_SOLID.cancelled,
    idle: 'border-border text-muted-foreground hover:bg-muted/40',
  },
  muted: {
    active: 'bg-foreground text-background border-foreground',
    idle: 'border-border text-muted-foreground hover:bg-muted/40',
  },
};

/** Статусаар шүүх pill (тоолууртай) — Чөлөө / Гадуур ажил хоёулаа хэрэглэнэ. */
export default function LeaveFilterPill({
  label,
  count,
  active,
  tone,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  tone: 'yellow' | 'emerald' | 'rose' | 'slate' | 'muted';
  onClick: () => void;
}) {
  const t = TONE[tone];
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs font-medium transition-colors',
        active ? t.active : t.idle,
      )}
    >
      {label}
      <span
        className={cn(
          'inline-flex items-center justify-center min-w-[18px] h-4 px-1 rounded-full text-[10px] font-bold tabular-nums',
          active ? 'bg-white/25' : 'bg-current/10',
        )}
      >
        {count}
      </span>
    </button>
  );
}
