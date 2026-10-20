/** One selectable staff row inside the "add members" dialog.
 *  Extracted verbatim from `ProjectDetailPage.tsx` (`AddMembersDialog`) when
 *  that file was split into per-component modules — no behavioural change. */
import { Check } from 'lucide-react';

import type { User } from '@/shared/types';
import { Avatar, AvatarFallback } from '@/ui/avatar';
import { Badge } from '@/ui/badge';
import { cn } from '@/shared/lib/utils';
import { formatDisplayName } from '@/shared/lib/formatting';

export function AddMemberRow({
  user,
  selected,
  onToggle,
}: {
  user: User;
  selected: boolean;
  onToggle: (id: number) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onToggle(user.id)}
      className={cn(
        'w-full flex items-center gap-3 p-2 rounded-lg border text-left transition-colors',
        selected ? 'bg-primary/10 border-primary/40' : 'border-border/60 hover:bg-muted/50',
      )}
    >
      <Avatar className="h-9 w-9">
        <AvatarFallback className="bg-primary/15 text-primary text-xs font-semibold">
          {formatDisplayName(user.full_name)
            .split(' ')
            .map((p) => p[0])
            .slice(0, 2)
            .join('')
            .toUpperCase()}
        </AvatarFallback>
      </Avatar>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium truncate">{formatDisplayName(user.full_name)}</div>
        <div className="text-[11px] text-muted-foreground truncate">
          @{user.username}
          {user.position ? ` · ${user.position}` : ''}
        </div>
      </div>
      <Badge variant="outline" className="capitalize text-[10px]">
        {user.role}
      </Badge>
      <div
        className={cn(
          'h-5 w-5 rounded-md border flex items-center justify-center flex-shrink-0',
          selected ? 'bg-primary border-primary' : 'border-border',
        )}
      >
        {selected && <Check className="h-3 w-3 text-primary-foreground" />}
      </div>
    </button>
  );
}

export default AddMemberRow;
