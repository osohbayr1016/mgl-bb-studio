import { cn } from '@/shared/lib/utils';
import { getInitials, avatarStyle } from '@/shared/lib/avatarColor';

/** Colored-initials bubble for a mail sender.  The hue is stable per name, so
 *  a sender keeps the same colour across the inbox (reuses the same helper as
 *  AssigneeAvatarStack). */
export function SenderAvatar({
  name,
  size = 'default',
  className,
}: {
  name: string;
  size?: 'sm' | 'default';
  className?: string;
}) {
  const label = name.trim() || '?';
  const sz = size === 'sm' ? 'h-7 w-7 text-micro' : 'h-9 w-9 text-xs';
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white select-none',
        sz,
        className,
      )}
      style={avatarStyle(label)}
      title={label}
      aria-hidden="true"
    >
      {getInitials(label)}
    </span>
  );
}
