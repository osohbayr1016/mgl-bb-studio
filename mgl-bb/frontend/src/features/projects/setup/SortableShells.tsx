/* ==========================================================================
   Sortable shells — small wrappers that hook into @dnd-kit's useSortable
   and expose the drag-handle props via a render prop, so the host JSX
   places the grip exactly where it belongs (block header, drawing tab,
   component header row) while the shell handles ref + transform.
   ==========================================================================

   Moved verbatim out of `AdminProjectSetupPage.tsx` when that ~5 700-line
   module was split up — no behavioural change.
*/
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

export type SortableHandle = {
  attributes: ReturnType<typeof useSortable>['attributes'];
  listeners: ReturnType<typeof useSortable>['listeners'];
};

export function SortableBlockShell({
  blockId,
  children,
}: {
  blockId: number;
  children: (handle: SortableHandle) => React.ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: `block-${blockId}`,
  });
  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.4 : 1,
      }}
    >
      {children({ attributes, listeners })}
    </div>
  );
}

export function SortableDrawingTabShell({
  drawingId,
  children,
}: {
  drawingId: number;
  children: (handle: SortableHandle) => React.ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: `drawing-${drawingId}`,
  });
  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.4 : 1,
      }}
      className="inline-flex"
    >
      {children({ attributes, listeners })}
    </div>
  );
}

/* Component header sits inside a <TableBody>, so wrapping it in a <div>
 * would break valid table HTML.  This shell calls useSortable and hands
 * the ref / inline-style / drag-handle attrs back through a render prop
 * so the host JSX can apply them directly to the TableRow. */
export function SortableCompShell({
  compId,
  children,
}: {
  compId: number;
  children: (state: {
    setNodeRef: (node: HTMLElement | null) => void;
    style: React.CSSProperties;
    attributes: ReturnType<typeof useSortable>['attributes'];
    listeners: ReturnType<typeof useSortable>['listeners'];
  }) => React.ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: `comp-${compId}`,
  });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };
  return <>{children({ setNodeRef, style, attributes, listeners })}</>;
}
