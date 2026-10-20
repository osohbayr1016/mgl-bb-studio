/** The per-block drawing switcher: a dropdown on mobile, a colour-coded
 *  draggable tab strip on desktop.
 *
 *  Each discipline gets its own accent so the eye can jump between BA / BB /
 *  HAS without reading text; the full name + weight live in the toolbar below
 *  for the active drawing.
 *
 *  Extracted verbatim from `AdminProjectSetupPage.tsx` — no behavioural
 *  change. */
import { DndContext, closestCenter } from '@dnd-kit/core';
import { SortableContext, horizontalListSortingStrategy } from '@dnd-kit/sortable';

import { TabsList, TabsTrigger } from '@/ui/tabs';
import { cn } from '@/shared/lib/utils';

import { DrawingDropdownPicker } from './DrawingDropdownPicker';
import { SortableDrawingTabShell } from './SortableShells';
import { FALLBACK_TAB_COLOR, TEAM_COLORS, drawingTeamCode } from './teamMeta';
import type { Comp, Drawing, Task } from './types';
import type { SetupApi } from './useProjectSetup';

export function DrawingTabStrip({
  blockId,
  blockDrawings,
  components,
  tasks,
  activeId,
  onPick,
  dndSensors,
  handleDrawingDragEnd,
  t,
}: {
  blockId: number;
  blockDrawings: Drawing[];
  components: Comp[];
  tasks: Task[];
  activeId: string;
  onPick: (drawingId: string) => void;
  dndSensors: SetupApi['dndSensors'];
  handleDrawingDragEnd: SetupApi['handleDrawingDragEnd'];
  t: SetupApi['t'];
}) {
  return (
    <>
      {/* Mobile: drawings rendered as a dropdown picker instead of a
          wrapping tab strip — saves the entire small viewport from being
          eaten by tabs. */}
      <div className="md:hidden">
        <DrawingDropdownPicker
          blockId={blockId}
          drawings={blockDrawings}
          components={components}
          tasks={tasks}
          activeId={activeId}
          onPick={onPick}
        />
      </div>

      <div className="hidden md:block overflow-x-auto -mx-1 px-1 pb-0.5">
        <DndContext
          sensors={dndSensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDrawingDragEnd}
        >
          <SortableContext
            items={blockDrawings.map((d) => `drawing-${d.id}`)}
            strategy={horizontalListSortingStrategy}
          >
            <TabsList className="!h-auto bg-transparent p-0 gap-1.5 justify-start w-max min-w-full flex-nowrap">
              {blockDrawings.map((dr) => {
                const tCode = drawingTeamCode(dr.name);
                const isActive = String(dr.id) === activeId;
                const palette = (tCode && TEAM_COLORS[tCode]) || FALLBACK_TAB_COLOR;
                const label = tCode ?? dr.name;
                return (
                  <SortableDrawingTabShell key={dr.id} drawingId={dr.id}>
                    {(dragHandle) => (
                      <TabsTrigger
                        value={String(dr.id)}
                        className={cn(
                          // Force override of shadcn TabsTrigger built-ins
                          // (flex-1 / h-[calc(100%-1px)] / data-[state=active]:bg-background)
                          // so each tab is a fixed-width pill in a horizontally
                          // scrolling row, with our palette colour winning even
                          // when active.
                          '!flex-none !h-8 !px-3 !rounded-md !border-0',
                          'font-bold text-xs tracking-wide whitespace-nowrap',
                          'transition-all duration-150 touch-none cursor-grab active:cursor-grabbing',
                          isActive
                            ? cn(palette.active, '!shadow-md ring-1 ring-white/10 scale-[1.02]')
                            : palette.inactive,
                        )}
                        title={t('adminProjectSetupPage.drawingDraggable', { name: dr.name })}
                        {...dragHandle.attributes}
                        {...dragHandle.listeners}
                      >
                        {label}
                      </TabsTrigger>
                    )}
                  </SortableDrawingTabShell>
                );
              })}
            </TabsList>
          </SortableContext>
        </DndContext>
      </div>
    </>
  );
}

export default DrawingTabStrip;
