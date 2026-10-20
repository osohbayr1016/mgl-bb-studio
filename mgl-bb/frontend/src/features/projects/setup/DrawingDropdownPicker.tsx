/* ==========================================================================
   DrawingDropdownPicker — mobile fallback for the desktop tab strip.
   ==========================================================================

   Moved verbatim out of `AdminProjectSetupPage.tsx` when that ~5 700-line
   module was split up — no behavioural change.
*/
import { ChevronDown } from 'lucide-react';

import { Badge } from '@/ui/badge';
import { Button } from '@/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/ui/dropdown-menu';
import { cn } from '@/shared/lib/utils';

import { drawingTeamCode } from './teamMeta';
import type { Comp, Drawing, Task } from './types';
import { drawingTaskCount, num } from './weights';

export function DrawingDropdownPicker({
  blockId: _blockId,
  drawings,
  components,
  tasks,
  activeId,
  onPick,
}: {
  blockId: number;
  drawings: Drawing[];
  components: Comp[];
  tasks: Task[];
  activeId: string;
  onPick: (id: string) => void;
}) {
  const active = drawings.find((d) => String(d.id) === activeId) ?? drawings[0];
  if (!active) return null;
  const tCode = drawingTeamCode(active.name);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" className="w-full justify-between h-9 text-sm">
          <span className="flex items-center gap-2 min-w-0">
            {tCode && (
              <Badge
                variant="secondary"
                className="bg-primary/15 text-primary border-primary/30 text-micro font-bold flex-shrink-0"
              >
                {tCode}
              </Badge>
            )}
            <span className="truncate">{active.name}</span>
          </span>
          <ChevronDown className="h-4 w-4 text-muted-foreground flex-shrink-0" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="w-[calc(100vw-3rem)] max-w-md max-h-72 overflow-y-auto"
      >
        {drawings.map((dr) => {
          const code = drawingTeamCode(dr.name);
          const w = num(dr.weight_percent);
          const tCount = drawingTaskCount(dr.id, components, tasks);
          return (
            <DropdownMenuItem
              key={dr.id}
              onClick={() => onPick(String(dr.id))}
              className={cn('flex items-center gap-2', String(dr.id) === activeId && 'bg-accent')}
            >
              {code && (
                <Badge
                  variant="secondary"
                  className="bg-primary/15 text-primary border-primary/30 text-micro font-bold flex-shrink-0"
                >
                  {code}
                </Badge>
              )}
              <span className="truncate flex-1">{dr.name}</span>
              <span className="text-micro text-muted-foreground tabular-nums flex-shrink-0">
                {w.toFixed(0)}% · {tCount}
              </span>
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export default DrawingDropdownPicker;
