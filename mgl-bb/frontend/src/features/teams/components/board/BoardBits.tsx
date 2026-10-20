import { Link } from 'react-router-dom';
import { cn } from '@/shared/lib/utils';
import { formatDisplayName } from '@/shared/lib/formatting';
import { progressTone, TONE_BG, TONE_TEXT, type TeamMember } from '../../lib/teamView';
import { PersonAvatar } from '../TeamPeopleBits';

/** Явцын зурвас + хувь.  Өнгө нь `progressTone`-оос (бусад хуудсуудтай ижил). */
export function MiniProgress({
  value,
  barClass = 'w-12',
}: {
  value: number;
  barClass?: string;
}) {
  const v = Math.min(100, Math.max(0, value));
  const tone = progressTone(value);
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={cn('h-1.5 overflow-hidden rounded-full bg-muted', barClass)} aria-hidden>
        <span
          className={cn('block h-full rounded-full transition-[width] duration-700', TONE_BG[tone])}
          style={{ width: `${v}%` }}
        />
      </span>
      <span className={cn('text-micro font-semibold tabular-nums', TONE_TEXT[tone])}>{Math.round(value)}%</span>
    </span>
  );
}

/** Нэг хүн — avatar + нэр (+ сонголттой дагавар).  Мөр бүр дэх «хэн ажиллаж байна» чип. */
export function PersonChip({
  member,
  href,
  suffix,
  now,
  highlighted,
  detail,
}: {
  member: Pick<TeamMember, 'id' | 'full_name' | 'profile_image'>;
  href: string;
  suffix?: string | null;
  /** Одоо үргэлжилж буй (жишээ нь цагийн муж одоог хамарсан) — ногоон цэг. */
  now?: boolean;
  highlighted?: boolean;
  /** Tooltip-ийн нэмэлт мөр(үүд) — албан тушаал, төслийн бус ажлын цаг г.м. */
  detail?: string;
}) {
  const name = formatDisplayName(member.full_name);
  return (
    <Link
      to={href}
      title={detail ? `${name}\n${detail}` : name}
      className={cn(
        'inline-flex max-w-[11.5rem] items-center gap-1.5 rounded-full border bg-background/70 py-0.5 pr-2 pl-0.5 text-micro transition-colors',
        'hover:border-primary/50 hover:bg-primary/5 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none',
        highlighted ? 'border-primary/60 bg-primary/10' : 'border-border/70',
      )}
    >
      <PersonAvatar member={member} size="xs" />
      <span className="truncate">{name}</span>
      {suffix && <span className="shrink-0 font-medium tabular-nums text-warning">· {suffix}</span>}
      {now && <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-success" />}
    </Link>
  );
}
