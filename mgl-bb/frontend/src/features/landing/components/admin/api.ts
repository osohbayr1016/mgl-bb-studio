/**
 * API helpers and admin-only types for the block-based landing CMS.
 *
 * Wraps `/api/landing/v2/admin/*` with TanStack Query keys and small
 * fetch functions. Block content is always shipped through
 * `parseBlockContent()` here so callers never touch raw `unknown`.
 */

import { apiFetch } from '@/shared/api/client';
import {
  BLOCK_DEFAULTS,
  parseBlockContent,
  type BlockContentByType,
  type BlockType,
  type LandingBlock,
  type LandingPage,
} from '@/features/landing/types/landingBlocks';

/* ------------------------------------------------------------------ */
/*  Wire types                                                         */
/* ------------------------------------------------------------------ */

/** What the server returns — block.content is parsed JSON but untyped. */
interface BlockApiRow {
  id: number;
  page_id: number;
  type: string;
  position: number;
  content: unknown;
  hidden: number;
  created_at: string;
  updated_at: string;
}

interface PageDetailApi {
  page: LandingPage;
  blocks: BlockApiRow[];
}

interface PagesListApi {
  pages: LandingPage[];
}

interface SingleBlockApi {
  block: BlockApiRow;
}

interface SinglePageApi {
  page: LandingPage;
}

/* ------------------------------------------------------------------ */
/*  Coercion                                                           */
/* ------------------------------------------------------------------ */

function isKnownBlockType(t: string): t is BlockType {
  return (BLOCK_DEFAULTS as Record<string, unknown>)[t] !== undefined;
}

function normalizeBlock(raw: BlockApiRow): LandingBlock {
  const type: BlockType = isKnownBlockType(raw.type) ? raw.type : 'rich-text';
  return {
    id: raw.id,
    page_id: raw.page_id,
    type,
    position: raw.position,
    content: parseBlockContent(type, raw.content) as BlockContentByType[BlockType],
    hidden: raw.hidden,
    created_at: raw.created_at,
    updated_at: raw.updated_at,
  };
}

/* ------------------------------------------------------------------ */
/*  Query keys                                                         */
/* ------------------------------------------------------------------ */

export const adminLandingKeys = {
  pages: () => ['landing-admin', 'pages'] as const,
  page: (id: number) => ['landing-admin', 'page', id] as const,
};

/* ------------------------------------------------------------------ */
/*  Fetchers                                                           */
/* ------------------------------------------------------------------ */

export async function fetchAdminPages(): Promise<LandingPage[]> {
  const res = await apiFetch<PagesListApi>('/landing/v2/admin/pages');
  return res.pages ?? [];
}

export interface AdminPageDetail {
  page: LandingPage;
  blocks: LandingBlock[];
}

export async function fetchAdminPage(id: number): Promise<AdminPageDetail> {
  const res = await apiFetch<PageDetailApi>(`/landing/v2/admin/pages/${id}`);
  return {
    page: res.page,
    blocks: (res.blocks ?? []).map(normalizeBlock),
  };
}

export async function createPage(input: {
  title_mn: string;
  title_en: string;
}): Promise<LandingPage> {
  const res = await apiFetch<SinglePageApi>('/landing/v2/admin/pages', {
    method: 'POST',
    data: { ...input, kind: 'project' },
  });
  return res.page;
}

export async function updatePage(
  id: number,
  patch: Partial<{
    title_mn: string;
    title_en: string;
    published: 0 | 1;
  }>,
): Promise<LandingPage> {
  const res = await apiFetch<SinglePageApi>(`/landing/v2/admin/pages/${id}`, {
    method: 'PATCH',
    data: patch,
  });
  return res.page;
}

export async function deletePage(id: number): Promise<void> {
  await apiFetch<{ ok: true }>(`/landing/v2/admin/pages/${id}`, { method: 'DELETE' });
}

export async function createBlock<T extends BlockType>(
  pageId: number,
  input: { type: T; content?: BlockContentByType[T]; position?: number; hidden?: 0 | 1 },
): Promise<LandingBlock<T>> {
  const res = await apiFetch<SingleBlockApi>(`/landing/v2/admin/pages/${pageId}/blocks`, {
    method: 'POST',
    data: {
      type: input.type,
      content: input.content ?? BLOCK_DEFAULTS[input.type],
      position: input.position,
      hidden: input.hidden,
    },
  });
  return normalizeBlock(res.block) as LandingBlock<T>;
}

export async function updateBlock<T extends BlockType>(
  id: number,
  patch: { type?: BlockType; content?: BlockContentByType[T]; hidden?: 0 | 1 },
): Promise<LandingBlock> {
  const res = await apiFetch<SingleBlockApi>(`/landing/v2/admin/blocks/${id}`, {
    method: 'PATCH',
    data: patch,
  });
  return normalizeBlock(res.block);
}

export async function deleteBlock(id: number): Promise<void> {
  await apiFetch<{ ok: true }>(`/landing/v2/admin/blocks/${id}`, { method: 'DELETE' });
}

export async function reorderBlocks(pageId: number, blockIds: number[]): Promise<LandingBlock[]> {
  const res = await apiFetch<{ blocks: BlockApiRow[] }>(
    `/landing/v2/admin/pages/${pageId}/reorder`,
    { method: 'PUT', data: { block_ids: blockIds } },
  );
  return (res.blocks ?? []).map(normalizeBlock);
}
