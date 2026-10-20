/**
 * Autosave hook for block editors.
 *
 * Each expanded block-editor instance calls `useBlockEditState(block)` to
 * get a draft of its content plus a `commitIfDirty()` to call from input
 * `onBlur`. The draft is local to the editor (one block expanded at a
 * time in the UI), and is also mirrored into the optional `editorDrafts`
 * argument so the live-preview pane can read it.
 *
 * The status of in-flight PATCHes feeds a small inline indicator below
 * the form so the admin sees "Saving…" / "Saved" / error.
 */

import { useCallback, useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { adminLandingKeys, updateBlock } from '@/features/landing/components/admin/api';
import { toast } from '@/shared/components/Toast';
import type {
  BlockContentByType,
  BlockType,
  LandingBlock,
} from '@/features/landing/types/landingBlocks';

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

export interface BlockEditState<T extends BlockType> {
  /** Current draft (what the form binds to). */
  draft: BlockContentByType[T];
  /** Replace the entire draft with a new content object. */
  setDraft: (next: BlockContentByType[T]) => void;
  /** Update one field of the draft via a partial patch. */
  patch: (partial: Partial<BlockContentByType[T]>) => void;
  /** Fire a save if the draft has changed since the last commit. Call
   *  from input `onBlur`. */
  commitIfDirty: () => void;
  /** Immediately fire a save regardless of dirty state — used by toggle
   *  controls (hidden flag, divider style) that should persist on click. */
  forceCommit: () => void;
  status: SaveStatus;
  isDirty: boolean;
}

/** Shape of the draft mirror the preview pane reads. Optional: when
 *  the editor isn't paired with a preview (e.g. Phase 2-only consumers
 *  in tests), pass undefined and the draft stays purely local. */
export interface DraftMirror {
  /** Push the latest draft for a block. Called on every patch/setDraft. */
  set: (blockId: number, content: unknown) => void;
  /** Remove a draft for a block — called on commit success so the preview
   *  falls back to the now-saved server state. */
  clear: (blockId: number) => void;
}

export function useBlockEditState<T extends BlockType>(
  block: LandingBlock<T>,
  pageId: number,
  mirror?: DraftMirror,
): BlockEditState<T> {
  const [draft, setDraftState] = useState<BlockContentByType[T]>(block.content);
  const [committed, setCommitted] = useState<BlockContentByType[T]>(block.content);
  const queryClient = useQueryClient();

  // Push the initial draft into the mirror so the preview starts in sync
  // when an admin first expands a card. On unmount we clear so the
  // preview falls back to saved state.
  useEffect(() => {
    if (!mirror) return;
    mirror.set(block.id, draft);
    return () => mirror.clear(block.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const mutation = useMutation({
    mutationFn: async (content: BlockContentByType[T]) => {
      return await updateBlock<T>(block.id, { content });
    },
    onSuccess: (updated) => {
      // Patch the cached page so the BlockListEditor row stays in sync
      // (thumbnail, friendly preview, hidden badge) without forcing a
      // full refetch — that would flash the editor's expanded state.
      queryClient.setQueryData(
        adminLandingKeys.page(pageId),
        (prev: { page: unknown; blocks: LandingBlock[] } | undefined) => {
          if (!prev) return prev;
          return {
            ...prev,
            blocks: prev.blocks.map((b) => (b.id === updated.id ? updated : b)),
          };
        },
      );
    },
    onError: (err) => {
      toast.error('Хадгалж чадсангүй', err instanceof Error ? err.message : undefined);
    },
  });

  const setDraft = useCallback(
    (next: BlockContentByType[T]) => {
      setDraftState(next);
      if (mirror) mirror.set(block.id, next);
    },
    [block.id, mirror],
  );

  const patch = useCallback(
    (partial: Partial<BlockContentByType[T]>) => {
      setDraftState((prev) => {
        const next = { ...prev, ...partial };
        if (mirror) mirror.set(block.id, next);
        return next;
      });
    },
    [block.id, mirror],
  );

  const isDirty = !shallowEqual(draft, committed);

  const commitIfDirty = useCallback(() => {
    if (!isDirty) return;
    setCommitted(draft);
    mutation.mutate(draft);
  }, [draft, isDirty, mutation]);

  const forceCommit = useCallback(() => {
    setCommitted(draft);
    mutation.mutate(draft);
  }, [draft, mutation]);

  let status: SaveStatus = 'idle';
  if (mutation.isPending) status = 'saving';
  else if (mutation.isError) status = 'error';
  else if (mutation.isSuccess) status = 'saved';

  return { draft, setDraft, patch, commitIfDirty, forceCommit, status, isDirty };
}

/* ------------------------------------------------------------------ */
/*  Shallow-equality for block content                                 */
/* ------------------------------------------------------------------ */

function shallowEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || a === null || typeof b !== 'object' || b === null) return false;
  // Round-trip JSON — block content is plain JSON-serialisable so this
  // catches deep-array/object equality cheaply. The objects are small
  // (a dozen fields), so JSON cost is negligible compared to a fetch.
  return JSON.stringify(a) === JSON.stringify(b);
}
