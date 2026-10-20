/**
 * Middle pane of the admin landing editor — vertical list of block
 * cards with drag-to-reorder, an inline accordion editor when a card
 * is expanded, a "+" affordance between cards (and at the bottom)
 * that opens the block picker, and a per-card 3-dot menu with
 * Duplicate / Hide / Delete.
 *
 * Drag reorder uses `@dnd-kit/sortable`. On drop the client PUTs the
 * new id array to /reorder; the server rewrites positions in a batch
 * and returns the canonical block list which we drop into the cache.
 *
 * The expanded editor is the per-type `BlockEditor` (from
 * `blockEditors.tsx`) bound to a `useBlockEditState` hook — that's
 * where the autosave lives.
 */

import { useEffect, useState } from 'react';
import {
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  EyeOff,
  GripVertical,
  Loader2,
  MoreHorizontal,
  Plus,
  Save,
  Trash2,
} from 'lucide-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { DndContext, closestCenter, type DragEndEvent } from '@dnd-kit/core';
import { useAppDndSensors } from '@/shared/lib/dndSensors';
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

import {
  adminLandingKeys,
  createBlock,
  deleteBlock,
  reorderBlocks,
  updateBlock,
} from '@/features/landing/components/admin/api';
import { BlockEditor } from '@/features/landing/components/admin/blockEditors';
import { BlockPickerModal } from '@/features/landing/components/admin/BlockPickerModal';
import { useBlockEditState, type DraftMirror } from '@/features/landing/components/admin/saveState';
import { Button } from '@/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/ui/dropdown-menu';
import { confirmDialog } from '@/shared/components/ConfirmDialog';
import { toast } from '@/shared/components/Toast';
import { cn } from '@/shared/lib/utils';
import {
  BLOCK_DEFAULTS,
  BLOCK_TYPE_META,
  pickLang,
  type BlockType,
  type LandingBlock,
} from '@/features/landing/types/landingBlocks';

interface BlockListEditorProps {
  pageId: number;
  pageKind: 'home' | 'project';
  blocks: LandingBlock[];
  lang: 'mn' | 'en';
  /** When provided, every draft change is mirrored here so the
   *  PreviewPane can subscribe and re-render live. */
  draftMirror?: DraftMirror;
}

export function BlockListEditor({
  pageId,
  pageKind,
  blocks,
  lang,
  draftMirror,
}: BlockListEditorProps) {
  const queryClient = useQueryClient();
  const [expandedId, setExpandedId] = useState<number | null>(null);

  // Modal state. We track the insertion index so the new block lands
  // exactly where the admin clicked the "+", not always at the end.
  const [pickerOpen, setPickerOpen] = useState(false);
  const [insertAt, setInsertAt] = useState<number>(blocks.length);

  const sensors = useAppDndSensors();

  /* ------ Reorder ------ */
  const reorderMutation = useMutation({
    mutationFn: (ids: number[]) => reorderBlocks(pageId, ids),
    onError: (err) =>
      toast.error('Дарааллыг хадгалж чадсангүй', err instanceof Error ? err.message : undefined),
    onSuccess: (next) => {
      queryClient.setQueryData(
        adminLandingKeys.page(pageId),
        (prev: { page: unknown; blocks: LandingBlock[] } | undefined) => {
          if (!prev) return prev;
          return { ...prev, blocks: next };
        },
      );
    },
  });

  const handleDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const oldIdx = blocks.findIndex((b) => String(b.id) === active.id);
    const newIdx = blocks.findIndex((b) => String(b.id) === over.id);
    if (oldIdx < 0 || newIdx < 0) return;
    const next = arrayMove(blocks, oldIdx, newIdx);
    // Optimistic
    queryClient.setQueryData(
      adminLandingKeys.page(pageId),
      (prev: { page: unknown; blocks: LandingBlock[] } | undefined) => {
        if (!prev) return prev;
        return { ...prev, blocks: next };
      },
    );
    reorderMutation.mutate(next.map((b) => b.id));
  };

  /* ------ Insert ------ */
  const insertMutation = useMutation({
    mutationFn: async ({ type, atIndex }: { type: BlockType; atIndex: number }) => {
      const next = await createBlock(pageId, { type, content: BLOCK_DEFAULTS[type] });
      // After insert, reorder so the new block sits at `atIndex`.
      const currentIds = blocks.map((b) => b.id);
      currentIds.splice(atIndex, 0, next.id);
      const reordered = await reorderBlocks(pageId, currentIds);
      return reordered;
    },
    onSuccess: (next) => {
      queryClient.setQueryData(
        adminLandingKeys.page(pageId),
        (prev: { page: unknown; blocks: LandingBlock[] } | undefined) => {
          if (!prev) return prev;
          return { ...prev, blocks: next };
        },
      );
      // Expand the new card so the admin lands in its editor.
      const newest = [...next].sort((a, b) => b.id - a.id)[0];
      if (newest) setExpandedId(newest.id);
    },
    onError: (err) =>
      toast.error('Шинэ блок үүсгэж чадсангүй', err instanceof Error ? err.message : undefined),
  });

  /* ------ Duplicate ------ */
  const duplicateMutation = useMutation({
    mutationFn: async (block: LandingBlock) => {
      const next = await createBlock(pageId, {
        type: block.type,
        content: block.content,
        hidden: block.hidden === 1 ? 1 : 0,
      });
      const idx = blocks.findIndex((b) => b.id === block.id);
      const currentIds = blocks.map((b) => b.id);
      currentIds.splice(idx + 1, 0, next.id);
      const reordered = await reorderBlocks(pageId, currentIds);
      return reordered;
    },
    onSuccess: (next) => {
      queryClient.setQueryData(
        adminLandingKeys.page(pageId),
        (prev: { page: unknown; blocks: LandingBlock[] } | undefined) => {
          if (!prev) return prev;
          return { ...prev, blocks: next };
        },
      );
    },
    onError: (err) =>
      toast.error('Хуулж чадсангүй', err instanceof Error ? err.message : undefined),
  });

  /* ------ Hide / show ------ */
  const toggleHiddenMutation = useMutation({
    mutationFn: ({ block, hidden }: { block: LandingBlock; hidden: 0 | 1 }) =>
      updateBlock(block.id, { hidden }),
    onSuccess: (updated) => {
      queryClient.setQueryData(
        adminLandingKeys.page(pageId),
        (prev: { page: unknown; blocks: LandingBlock[] } | undefined) => {
          if (!prev) return prev;
          return { ...prev, blocks: prev.blocks.map((b) => (b.id === updated.id ? updated : b)) };
        },
      );
    },
  });

  /* ------ Delete ------ */
  const deleteMutation = useMutation({
    mutationFn: (id: number) => deleteBlock(id),
    onSuccess: (_, id) => {
      queryClient.setQueryData(
        adminLandingKeys.page(pageId),
        (prev: { page: unknown; blocks: LandingBlock[] } | undefined) => {
          if (!prev) return prev;
          return { ...prev, blocks: prev.blocks.filter((b) => b.id !== id) };
        },
      );
      if (expandedId === id) setExpandedId(null);
      toast.success('Блок устгагдлаа');
    },
    onError: (err) =>
      toast.error('Устгаж чадсангүй', err instanceof Error ? err.message : undefined),
  });

  return (
    <div className="flex h-full w-full flex-col">
      <div className="border-b border-border px-4 py-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        Хуудасны хэсгүүд
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext
            items={blocks.map((b) => String(b.id))}
            strategy={verticalListSortingStrategy}
          >
            <div className="space-y-1">
              <InsertSlot
                onClick={() => {
                  setInsertAt(0);
                  setPickerOpen(true);
                }}
              />
              {blocks.map((block, idx) => (
                <div key={block.id}>
                  <BlockCard
                    block={block}
                    pageId={pageId}
                    lang={lang}
                    draftMirror={draftMirror}
                    expanded={expandedId === block.id}
                    onToggle={() => setExpandedId(expandedId === block.id ? null : block.id)}
                    onDuplicate={() => duplicateMutation.mutate(block)}
                    onToggleHidden={() =>
                      toggleHiddenMutation.mutate({ block, hidden: block.hidden === 1 ? 0 : 1 })
                    }
                    onDelete={async () => {
                      if (await confirmDialog({ description: 'Энэ блокийг устгах уу?', variant: 'destructive' })) deleteMutation.mutate(block.id);
                    }}
                  />
                  <InsertSlot
                    onClick={() => {
                      setInsertAt(idx + 1);
                      setPickerOpen(true);
                    }}
                  />
                </div>
              ))}
              {blocks.length === 0 && (
                <div className="rounded-lg border border-dashed border-border px-6 py-12 text-center text-sm text-muted-foreground">
                  Энэ хуудсанд блок байхгүй байна. Дээрх "+" товч дээр дарж эхний хэсгийг нэмнэ үү.
                </div>
              )}
            </div>
          </SortableContext>
        </DndContext>
      </div>

      <BlockPickerModal
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        pageKind={pageKind}
        onPick={(type) => {
          setPickerOpen(false);
          insertMutation.mutate({ type, atIndex: insertAt });
        }}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Insertion slot — invisible until hovered, then shows a "+" line.   */
/* ------------------------------------------------------------------ */

function InsertSlot({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group relative block h-3 w-full"
      aria-label="Шинэ хэсэг нэмэх"
    >
      <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 inline-flex items-center gap-2 rounded-full bg-primary px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-primary-foreground opacity-0 transition-opacity group-hover:opacity-100">
        <Plus className="h-3 w-3" /> Нэмэх
      </span>
      <span
        className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-primary/50 opacity-0 transition-opacity group-hover:opacity-100"
        aria-hidden
      />
    </button>
  );
}

/* ------------------------------------------------------------------ */
/*  Block card — sortable, expandable                                  */
/* ------------------------------------------------------------------ */

interface BlockCardProps {
  block: LandingBlock;
  pageId: number;
  lang: 'mn' | 'en';
  draftMirror?: DraftMirror;
  expanded: boolean;
  onToggle: () => void;
  onDuplicate: () => void;
  onToggleHidden: () => void;
  onDelete: () => void;
}

function BlockCard({
  block,
  pageId,
  lang,
  draftMirror,
  expanded,
  onToggle,
  onDuplicate,
  onToggleHidden,
  onDelete,
}: BlockCardProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: String(block.id),
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };
  const meta = BLOCK_TYPE_META[block.type];
  const friendly = lang === 'mn' ? meta.friendly_mn : meta.friendly_en;
  const preview = buildPreview(block, lang);

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        'rounded-lg border bg-background shadow-sm transition-shadow',
        expanded ? 'border-primary' : 'border-border',
        block.hidden === 1 ? 'opacity-70' : '',
      )}
    >
      <div className="flex items-center gap-2 px-3 py-2.5">
        <button
          type="button"
          aria-label="Чирж шилжүүлэх"
          className="cursor-grab text-muted-foreground hover:text-foreground active:cursor-grabbing"
          {...attributes}
          {...listeners}
        >
          <GripVertical className="h-4 w-4" />
        </button>

        <button
          type="button"
          onClick={onToggle}
          className="flex flex-1 items-center gap-3 text-left"
        >
          <div className="text-xs font-mono font-semibold uppercase tracking-wider text-muted-foreground tabular-nums">
            {String(block.position).padStart(2, '0')}
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium">{friendly}</div>
            <div className="truncate text-xs text-muted-foreground">{preview}</div>
          </div>
        </button>

        {block.hidden === 1 && (
          <span className="inline-flex items-center gap-1 rounded-sm bg-muted px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wider text-muted-foreground">
            <EyeOff className="h-3 w-3" /> hidden
          </span>
        )}

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="h-8 w-8">
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={onDuplicate}>
              <Copy className="mr-2 h-4 w-4" /> Хуулах
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onToggleHidden}>
              <EyeOff className="mr-2 h-4 w-4" />
              {block.hidden === 1 ? 'Харуулах' : 'Нуух'}
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={onDelete}
              className="text-destructive focus:text-destructive"
            >
              <Trash2 className="mr-2 h-4 w-4" /> Устгах
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onToggle}>
          {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </Button>
      </div>

      {expanded && (
        <div className="border-t border-border bg-muted/10 p-4">
          <ExpandedBlockEditor block={block} pageId={pageId} draftMirror={draftMirror} />
        </div>
      )}
    </div>
  );
}

/** Pull a short friendly preview string from the block's content — what
 *  the card row shows next to the friendly type name. Keep it cheap
 *  (no regex over long fields). */
function buildPreview(block: LandingBlock, lang: 'mn' | 'en'): string {
  // The discriminated content type means we'd need a per-type cast to
  // pick out the right preview field. Reach in defensively: cast through
  // unknown to a permissive shape and look for likely keys.
  const c = block.content as unknown as Record<string, unknown>;
  const grab = (key: string): string | null => {
    const v = c[key];
    return typeof v === 'string' && v.trim() ? v : null;
  };
  const titleMn =
    grab('title_mn') ?? grab('heading_mn') ?? grab('name_mn') ?? grab('section_label_mn') ?? '';
  const titleEn =
    grab('title_en') ?? grab('heading_en') ?? grab('name_en') ?? grab('section_label_en') ?? '';
  const body = grab('body_mn') ?? grab('body_en') ?? grab('intro_mn') ?? grab('intro_en') ?? '';
  const fallback = pickLang(titleMn, titleEn, lang) || body;
  return fallback.length > 80 ? `${fallback.slice(0, 77)}…` : fallback;
}

function ExpandedBlockEditor({
  block,
  pageId,
  draftMirror,
}: {
  block: LandingBlock;
  pageId: number;
  draftMirror?: DraftMirror;
}) {
  // The discriminated union flows through useBlockEditState typed by
  // block.type, but the JSX dispatch in BlockEditor takes the literal
  // type at runtime.
  const state = useBlockEditState(block as LandingBlock<BlockType>, pageId, draftMirror);
  return (
    <div className="space-y-4">
      <SaveBar status={state.status} dirty={state.isDirty} onSave={state.forceCommit} />
      <BlockEditor state={state} type={block.type} />
      <SaveFooter status={state.status} dirty={state.isDirty} onSave={state.forceCommit} />
    </div>
  );
}

type Status = 'idle' | 'saving' | 'saved' | 'error';

/** Top-of-form status pill — at-a-glance state for the currently
 *  edited block. Mirrors the bottom Save button so admins always see
 *  where they stand. */
function SaveBar({
  status,
  dirty,
  onSave,
}: {
  status: Status;
  dirty: boolean;
  onSave: () => void;
}) {
  // Auto-fade "Saved" after a couple of seconds so the pill doesn't
  // sit stale while the admin moves on.
  const [showSaved, setShowSaved] = useState(false);
  useEffect(() => {
    if (status === 'saved' && !dirty) {
      setShowSaved(true);
      const t = setTimeout(() => setShowSaved(false), 2200);
      return () => clearTimeout(t);
    }
    setShowSaved(false);
  }, [status, dirty]);

  let label: string;
  let cls: string;
  let icon: React.ReactNode;
  if (status === 'saving') {
    label = 'Хадгалж байна…';
    cls = 'bg-blue-50 text-blue-700 border-blue-200';
    icon = <Loader2 className="h-3 w-3 animate-spin" />;
  } else if (status === 'error') {
    label = 'Хадгалж чадсангүй';
    cls = 'bg-destructive/10 text-destructive border-destructive/30';
    icon = <Save className="h-3 w-3" />;
  } else if (dirty) {
    label = 'Хадгалаагүй';
    cls = 'bg-amber-50 text-amber-700 border-amber-200';
    icon = <Save className="h-3 w-3" />;
  } else if (showSaved) {
    label = 'Хадгалагдсан';
    cls = 'bg-emerald-50 text-emerald-700 border-emerald-200';
    icon = <Check className="h-3 w-3" />;
  } else {
    label = 'Шинэчлэгдсэн';
    cls = 'bg-muted text-muted-foreground border-border';
    icon = <Check className="h-3 w-3" />;
  }

  return (
    <div className="flex items-center justify-between gap-2">
      <span
        className={cn(
          'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-medium uppercase tracking-wider',
          cls,
        )}
      >
        {icon}
        {label}
      </span>
      <Button
        type="button"
        size="sm"
        variant={dirty || status === 'error' ? 'default' : 'outline'}
        onClick={onSave}
        disabled={status === 'saving' || (!dirty && status !== 'error')}
        className="h-7 text-xs"
      >
        <Save className="mr-1 h-3 w-3" />
        Хадгалах
      </Button>
    </div>
  );
}

/** Footer companion to SaveBar — explicit Save button below the form so
 *  first-time admins don't miss it. Hidden when there's nothing to do. */
function SaveFooter({
  status,
  dirty,
  onSave,
}: {
  status: Status;
  dirty: boolean;
  onSave: () => void;
}) {
  if (status === 'saving') {
    return (
      <div className="border-t border-border pt-3 text-[11px] text-muted-foreground">
        <Loader2 className="mr-1 inline h-3 w-3 animate-spin align-text-bottom" />
        Хадгалж байна…
      </div>
    );
  }
  if (status === 'error') {
    return (
      <div className="flex items-center justify-between border-t border-destructive/30 pt-3">
        <div className="text-[11px] text-destructive">Хадгалж чадсангүй. Дахин оролдоно уу.</div>
        <Button
          type="button"
          size="sm"
          variant="destructive"
          onClick={onSave}
          className="h-7 text-xs"
        >
          <Save className="mr-1 h-3 w-3" /> Дахин хадгалах
        </Button>
      </div>
    );
  }
  if (!dirty) return null;
  return (
    <div className="flex items-center justify-between border-t border-border pt-3">
      <div className="text-[11px] text-muted-foreground">
        Tab дарвал автоматаар хадгална, эсвэл товч дарж шууд хадгална.
      </div>
      <Button type="button" size="sm" onClick={onSave} className="h-7 text-xs">
        <Save className="mr-1 h-3 w-3" /> Хадгалах
      </Button>
    </div>
  );
}
