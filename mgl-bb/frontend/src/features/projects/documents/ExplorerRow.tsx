import { TableCell, TableRow } from '@/ui/table';
import { cn } from '@/shared/lib/utils';
import type { ReactNode } from 'react';

export function ExplorerRow({
  selected,
  onSelect,
  onOpen,
  icon,
  name,
  modified,
  type,
  size,
}: {
  selected: boolean;
  onSelect: () => void;
  onOpen: () => void;
  icon: ReactNode;
  name: string;
  modified: string;
  type: string;
  size: string;
}) {
  return (
    <TableRow
      className={cn(
        'cursor-pointer border-border/50 transition-colors hover:bg-muted/40',
        selected && 'bg-primary/8 hover:bg-primary/12',
      )}
      onClick={onSelect}
      onDoubleClick={onOpen}
    >
      <TableCell className="py-3 pl-4">
        <div className="flex min-w-0 items-center gap-3">
          {icon}
          <span className="truncate font-medium text-foreground">{name}</span>
        </div>
      </TableCell>
      <TableCell className="py-3 text-muted-foreground">{modified}</TableCell>
      <TableCell className="py-3 text-muted-foreground">{type}</TableCell>
      <TableCell className="py-3 pr-4 text-right tabular-nums text-muted-foreground">{size}</TableCell>
    </TableRow>
  );
}
