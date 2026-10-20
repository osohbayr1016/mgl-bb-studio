import { useState } from 'react';
import { DndContext, closestCenter, type DragEndEvent } from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { useAppDndSensors } from '@/shared/lib/dndSensors';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical, ChevronDown, ChevronUp, Eye, EyeOff, Trash2 } from 'lucide-react';
import { Button } from '@/ui/button';
import { confirmDialog } from '@/shared/components/ConfirmDialog';
import { useLanguage } from '@/shared/i18n';
import { cn } from '@/shared/lib/utils';
import {
  BLOCK_TYPE_META,
  type BlockType,
} from '@/features/performance-reports/types/performanceReportBlocks';
import type {
  ReportBlock,
  BlockContentMap,
} from '@/features/performance-reports/types/performanceReportBlocks';
import type { PerformanceReport } from '@/features/performance-reports/types/performanceReport';
import { BlockEditor } from '@/features/performance-reports/components/blocks/BlockEditors';
import { blockHasOverride } from '@/features/performance-reports/lib/blockContentResolve';

/* =============================================================
 * Sortable list of blocks with per-row accordion editor.
 * Mirrors the landing CMS `BlockListEditor`.
 * ============================================================= */

export interface BlockListEditorProps {
  blocks: ReportBlock[];
  report: PerformanceReport;
  readOnly?: boolean;
  /** Блокийн авто render model-ийг буцаана (override editor-д урьдчилан
   *  дүүргэх). Дэмжигдээгүй блокт `null`. */
  autoModelFor?: (block: ReportBlock) => unknown;
  onReorder: (blockIds: number[]) => Promise<void>;
  onPatch: (blockId: number, patch: { content?: unknown; hidden?: boolean }) => Promise<void>;
  onDelete: (blockId: number) => Promise<void>;
}

export function BlockListEditor({
  blocks,
  report,
  readOnly = false,
  autoModelFor,
  onReorder,
  onPatch,
  onDelete,
}: BlockListEditorProps) {
  const { t } = useLanguage();
  const sensors = useAppDndSensors();
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  const handleDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const oldIdx = blocks.findIndex((b) => b.id === Number(active.id));
    const newIdx = blocks.findIndex((b) => b.id === Number(over.id));
    if (oldIdx < 0 || newIdx < 0) return;
    const next = arrayMove(blocks, oldIdx, newIdx);
    void onReorder(next.map((b) => b.id));
  };

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={blocks.map((b) => b.id)} strategy={verticalListSortingStrategy}>
        <div className="space-y-2">
          {blocks.map((b) => (
            <SortableRow
              key={b.id}
              block={b}
              report={report}
              expanded={expanded.has(b.id)}
              readOnly={readOnly}
              autoModel={autoModelFor?.(b) ?? null}
              onToggle={() =>
                setExpanded((s) => {
                  const next = new Set(s);
                  if (next.has(b.id)) next.delete(b.id);
                  else next.add(b.id);
                  return next;
                })
              }
              onPatch={(patch) => onPatch(b.id, patch)}
              onDelete={() => onDelete(b.id)}
            />
          ))}
          {blocks.length === 0 && (
            <p className="text-sm text-muted-foreground italic">
              {t('blockListEditor.empty')}
            </p>
          )}
        </div>
      </SortableContext>
    </DndContext>
  );
}

function SortableRow({
  block,
  report,
  expanded,
  readOnly,
  autoModel,
  onToggle,
  onPatch,
  onDelete,
}: {
  block: ReportBlock;
  report: PerformanceReport;
  expanded: boolean;
  readOnly: boolean;
  autoModel: unknown;
  onToggle: () => void;
  onPatch: (patch: { content?: unknown; hidden?: boolean }) => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  const { t } = useLanguage();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: block.id,
    disabled: readOnly,
  });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const meta = BLOCK_TYPE_META[block.type as BlockType];
  const label = meta?.label_mn ?? block.type;
  const teamCodeNote = (() => {
    if (block.type === 'team-narrative' || block.type === 'team-stats') {
      const code = (block.content as BlockContentMap['team-narrative']).team_code;
      return code ? ` · ${code}` : ` · ${t('blockListEditor.noTeamSelected')}`;
    }
    return '';
  })();

  return (
    <div ref={setNodeRef} style={style} className="border rounded-md bg-card">
      <div className="flex items-center gap-2 p-2.5">
        <button
          type="button"
          className={cn(
            'text-muted-foreground hover:text-foreground cursor-grab active:cursor-grabbing',
            readOnly && 'opacity-30 cursor-not-allowed',
          )}
          {...attributes}
          {...listeners}
          aria-label={t('blockListEditor.dragToReorder')}
        >
          <GripVertical className="w-4 h-4" />
        </button>
        <button
          type="button"
          onClick={onToggle}
          className="flex-1 text-left text-sm font-medium hover:text-primary transition-colors"
        >
          {label}
          <span className="text-muted-foreground font-normal">{teamCodeNote}</span>
        </button>
        {blockHasOverride(block) && (
          <span className="text-[10px] uppercase tracking-wide text-primary">
            {t('blockListEditor.overridden')}
          </span>
        )}
        {block.hidden && (
          <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{t('blockListEditor.hidden')}</span>
        )}
        {!readOnly && (
          <>
            <button
              type="button"
              onClick={() => onPatch({ hidden: !block.hidden })}
              className="text-muted-foreground hover:text-foreground p-1"
              title={block.hidden ? t('blockListEditor.show') : t('blockListEditor.hide')}
            >
              {block.hidden ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
            <button
              type="button"
              onClick={async () => {
                if (await confirmDialog({ description: t('blockListEditor.deleteConfirm', { label }), variant: 'destructive' })) void onDelete();
              }}
              className="text-muted-foreground hover:text-destructive p-1"
              title={t('common.delete')}
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </>
        )}
        <button
          type="button"
          onClick={onToggle}
          className="text-muted-foreground hover:text-foreground p-1"
        >
          {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </button>
      </div>
      {expanded && (
        <div className="border-t p-3">
          <BlockEditor
            type={block.type as BlockType}
            content={block.content}
            autoModel={autoModel}
            onChange={(next) => {
              if (readOnly) return;
              void onPatch({ content: next });
            }}
            report={report}
          />
        </div>
      )}
    </div>
  );
}

// Re-export so consumers (the editor page) can show the picker action
// next to the list without separately wiring the Button.
export function AddBlockButton({ onClick, disabled }: { onClick: () => void; disabled?: boolean }) {
  const { t } = useLanguage();
  return (
    <Button type="button" variant="outline" size="sm" onClick={onClick} disabled={disabled}>
      {t('blockListEditor.addBlock')}
    </Button>
  );
}
