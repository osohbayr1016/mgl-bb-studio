import { type ReactNode, useId } from 'react';
import { m } from 'motion/react';
import { TabsList, TabsTrigger } from '@/ui/tabs';
import { Badge } from '@/ui/badge';
import { teamChipClass } from '@/shared/lib/team-colors';
import { cn } from '@/shared/lib/utils';
import { SPRING } from '@/shared/lib/motion';
import { useLanguage } from '@/shared/i18n';
import { TeamIcon } from '@/shared/components/TeamIcon';

/* =============================================================
 * Shared team-tabs strip — one design, used everywhere a row of
 * discipline codes appears (Тайлан, Тэмдэглэл, project block
 * filter, approvals queue, admin setup, client dashboard,
 * project chat threads).  Three exports:
 *
 *   • <TeamChip>          — atomic chip element. Render anywhere.
 *   • <TeamTabsStrip>     — controlled button strip with onChange.
 *                           Use OUTSIDE a Radix Tabs context.
 *   • <TeamRadixTabsStrip> — same look, but emits <TabsTrigger>s.
 *                           Use INSIDE a <Tabs> provider.
 *
 * Design principles (post user feedback "remove buten ner"):
 *   - Compact chips: only the colored team code + optional
 *     count badge + optional fill-state dot.
 *   - Full discipline name in `title` tooltip on hover, never
 *     inline (the strip stayed on one row even with 7+ teams).
 *   - Active state: primary accent ring + soft tint.
 * ============================================================= */

export interface TeamChipItem {
  /** Canonical team short code (e.g. 'BA', 'TSBU'). Drives the
   *  colored badge class and is what the strip reports back via
   *  onChange. */
  code: string;
  /** Full Mongolian discipline name. Shown only in the hover
   *  tooltip — not inline. */
  name?: string;
  /** Optional count badge to the right of the code (block count,
   *  unread messages, etc.). Hidden when undefined. */
  count?: number;
  /** Optional fill indicator dot. 'filled' = green check,
   *  'empty' = soft outline circle. */
  indicator?: 'filled' | 'empty';
}

/** Atomic chip — just the visual. The strip components wrap this
 *  in either a <button> or <TabsTrigger>. */
function TeamChip({ item, active }: { item: TeamChipItem; active: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <Badge
        variant="outline"
        className={cn(
          teamChipClass(item.code),
          'text-micro font-semibold px-2 py-0.5',
          active && 'ring-1 ring-offset-1 ring-offset-background ring-primary/30',
        )}
      >
        <TeamIcon code={item.code} className="size-3" />
        {item.code}
      </Badge>
      {typeof item.count === 'number' && (
        <span
          className={cn(
            'inline-flex items-center justify-center min-w-4 h-4 text-micro font-medium tabular-nums rounded-full px-1',
            active ? 'bg-primary/15 text-primary' : 'bg-muted text-muted-foreground',
          )}
        >
          {item.count}
        </span>
      )}
      {item.indicator === 'filled' && <span className="w-1.5 h-1.5 rounded-full bg-success" />}
      {item.indicator === 'empty' && (
        <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/40" />
      )}
    </span>
  );
}

/* ───── Shared strip styles ───── */
const STRIP_CLASS = 'flex flex-wrap items-center gap-1.5 bg-muted/30 p-1.5 rounded-lg w-full';

/** Variant used inside narrow strips (e.g. chat header) where
 *  wrapping to a second line would steal too much vertical space.
 *  Horizontal scroll instead of wrap; content uses `w-max` so the
 *  strip can grow past its container and overflow-x kicks in. */
const STRIP_CLASS_SCROLL =
  'flex items-center gap-1.5 bg-muted/30 p-1.5 rounded-lg w-max max-w-full overflow-x-auto';

const ITEM_CLASS =
  'flex-none h-auto gap-1.5 px-2 py-1 rounded-md border border-border/40 bg-background/40 ' +
  'data-[state=active]:bg-primary/10 data-[state=active]:text-primary data-[state=active]:border-primary/30 data-[state=active]:shadow-none ' +
  'transition-colors';

const BUTTON_ITEM_CLASS =
  'flex-none inline-flex items-center h-auto gap-1.5 px-2 py-1 rounded-md border border-border/40 bg-background/40 ' +
  'hover:bg-muted/60 ' +
  'aria-pressed:bg-primary/10 aria-pressed:text-primary aria-pressed:border-primary/30 ' +
  'transition-colors';

// Sliding-indicator variant — active bg/ring-ийг layoutId indicator өгдөг тул
// энд background/border-ийг ил гаргалгүй зөвхөн active текст-өнгийг сольж,
// indicator-тэй давхар background үүсэхээс сэргийлнэ.
const BUTTON_ITEM_CLASS_SLIDE =
  'relative flex-none inline-flex items-center h-auto gap-1.5 px-2 py-1 rounded-md border border-transparent bg-transparent ' +
  'hover:bg-muted/40 ' +
  'aria-pressed:text-primary ' +
  'transition-colors';

/* ───── Controlled button strip (most common: filter pills) ───── */

interface TeamTabsStripProps {
  teams: TeamChipItem[];
  /** Active team code, or null when the "All" pill is selected. */
  active: string | null;
  /** Fired with the new code, or null when "All" is selected. */
  onChange: (code: string | null) => void;
  /** Show a "Бүгд" pill at the start. */
  showAll?: boolean;
  /** Override the All label (default "Бүгд"). */
  allLabel?: string;
  /** Total count for the All pill (sums across teams by default
   *  when undefined; pass explicitly when the parent has its own
   *  notion of total). */
  allCount?: number;
  /** Extra slot at the end of the strip (e.g. an admin action). */
  trailing?: ReactNode;
  /** layoutId-аар active pill доор гүйдэг motion indicator. Нэг хуудсанд олон
   *  strip байвал layoutId давхцахгүйн тулд instance бүр useId-аар тусгаарлана. */
  sliding?: boolean;
  className?: string;
}

export function TeamTabsStrip({
  teams,
  active,
  onChange,
  showAll = false,
  allLabel,
  allCount,
  trailing,
  sliding = false,
  className,
}: TeamTabsStripProps) {
  const { t } = useLanguage();
  const indicatorId = useId();
  const resolvedAllLabel = allLabel ?? t('common.all');
  const computedAllCount = allCount ?? teams.reduce((n, team) => n + (team.count ?? 0), 0);
  const itemClass = sliding ? BUTTON_ITEM_CLASS_SLIDE : BUTTON_ITEM_CLASS;
  return (
    <div className={cn(STRIP_CLASS, className)}>
      {showAll && (
        <button
          type="button"
          aria-pressed={active === null}
          onClick={() => onChange(null)}
          className={itemClass}
        >
          {sliding && active === null && (
            <m.span
              layoutId={`teamTab-${indicatorId}`}
              className="absolute inset-0 rounded-md bg-primary/10 ring-1 ring-primary/30"
              transition={SPRING.snappy}
              aria-hidden
            />
          )}
          <span className="relative z-10 text-micro font-semibold px-1.5">{resolvedAllLabel}</span>
          {computedAllCount > 0 && (
            <span
              className={cn(
                'relative z-10 inline-flex items-center justify-center min-w-4 h-4 text-micro font-medium tabular-nums rounded-full px-1',
                active === null ? 'bg-primary/15 text-primary' : 'bg-muted text-muted-foreground',
              )}
            >
              {computedAllCount}
            </span>
          )}
        </button>
      )}
      {teams.map((t) => {
        const isActive = active === t.code;
        return (
          <button
            key={t.code}
            type="button"
            title={t.name}
            aria-pressed={isActive}
            onClick={() => onChange(t.code)}
            className={itemClass}
          >
            {sliding && isActive && (
              <m.span
                layoutId={`teamTab-${indicatorId}`}
                className="absolute inset-0 rounded-md bg-primary/10 ring-1 ring-primary/30"
                transition={SPRING.snappy}
                aria-hidden
              />
            )}
            <span className="relative z-10 inline-flex items-center gap-1.5">
              <TeamChip item={t} active={isActive} />
            </span>
          </button>
        );
      })}
      {trailing}
    </div>
  );
}

/* ───── Radix-tabs strip (for panels that switch content) ───── */

interface TeamRadixTabsStripProps {
  teams: TeamChipItem[];
  /** Optional className for the underlying TabsList (e.g. width). */
  className?: string;
  /** Trailing slot rendered after the chips, inside the strip. */
  trailing?: ReactNode;
  /** 'wrap' (default) — chips wrap onto multiple lines when they overflow.
   *  'scroll' — single-row strip with horizontal overflow; pick this for
   *  narrow headers (e.g. chat) where vertical space is precious. */
  layout?: 'wrap' | 'scroll';
}

export function TeamRadixTabsStrip({
  teams,
  className,
  trailing,
  layout = 'wrap',
}: TeamRadixTabsStripProps) {
  return (
    <TabsList
      className={cn(
        'h-auto',
        layout === 'scroll' ? STRIP_CLASS_SCROLL : STRIP_CLASS,
        'justify-start',
        className,
      )}
    >
      {teams.map((t) => (
        <TabsTrigger key={t.code} value={t.code} title={t.name} className={ITEM_CLASS}>
          {/* `active` derives from data-state in Radix; we read it from
              the wrapper via CSS, but TeamChip needs a boolean prop to
              draw the active ring. We hardcode false here since the
              wrapper's data-[state=active] selectors already apply the
              accent — the inner ring would just double up. */}
          <TeamChip item={t} active={false} />
        </TabsTrigger>
      ))}
      {trailing}
    </TabsList>
  );
}
