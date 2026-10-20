/**
 * Live preview pane — right column of the admin landing editor.
 *
 * Mounts the same `BlockRenderer` components the public site uses,
 * fed by the page's saved blocks plus any in-flight drafts coming from
 * `useBlockEditState`. Wrapped in a CSS container so the full-bleed
 * hero, 1600px gutters, and other viewport-sensitive bits resolve
 * against the pane's own width rather than the document's.
 *
 * The preview language toggle is independent from the admin UI
 * language — admins editing in MN can flip the preview to EN to verify
 * the English fields without changing their entire workspace language.
 */

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Globe } from 'lucide-react';

import { apiFetch } from '@/shared/api/client';
import { BlockRenderer, type ProjectCard } from '@/features/landing/components/BlockRenderer';
import type { BlockType, LandingBlock } from '@/features/landing/types/landingBlocks';
import { cn } from '@/shared/lib/utils';

interface PreviewPaneProps {
  /** Saved blocks from the server (TanStack Query cache). */
  blocks: LandingBlock[];
  /** Drafts mirrored from active block editors — keyed by block id. */
  drafts: Map<number, unknown>;
  /** Which page is being previewed — drives the hero anchor + hidden filter. */
  pageKind: 'home' | 'project';
}

interface ProjectCardsPayload {
  cards: Record<number, ProjectCard>;
}

export function PreviewPane({ blocks, drafts, pageKind: _pageKind }: PreviewPaneProps) {
  const [previewLang, setPreviewLang] = useState<'mn' | 'en'>('mn');

  // Project-grid blocks (and the home page in general) need the hydrated
  // project-card map. Cheap to fetch — single round trip, edge cached.
  const cardsQuery = useQuery({
    queryKey: ['landing-public', 'project-cards'],
    queryFn: () => apiFetch<ProjectCardsPayload>('/landing/v2/public/project-cards?preview=1'),
    staleTime: 30_000,
  });
  const cards = cardsQuery.data?.cards ?? {};

  // Overlay drafts on saved blocks. Hidden blocks are filtered for live
  // visitors but admins want to see them in preview with a muted ribbon —
  // we let them through and tag the renderer with mode='preview'.
  const previewBlocks = useMemo(() => {
    return blocks.map((b) => {
      const draft = drafts.get(b.id);
      if (draft === undefined) return b;
      return { ...b, content: draft } as LandingBlock<BlockType>;
    });
  }, [blocks, drafts]);

  return (
    <div className="flex h-full w-full flex-col bg-background">
      <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
        <div className="text-xs font-mono uppercase tracking-wider text-muted-foreground">
          Урьдчилан харах
        </div>
        <div className="flex items-center gap-1.5 rounded-md border border-border bg-background px-2 py-1 text-[10px] font-medium">
          <Globe className="h-3 w-3 text-muted-foreground" />
          <button
            type="button"
            onClick={() => setPreviewLang('mn')}
            className={cn(
              'uppercase tracking-wider transition-colors',
              previewLang === 'mn'
                ? 'text-foreground'
                : 'text-muted-foreground hover:text-foreground',
            )}
            aria-pressed={previewLang === 'mn'}
          >
            MN
          </button>
          <span className="text-muted-foreground/40" aria-hidden>
            ·
          </span>
          <button
            type="button"
            onClick={() => setPreviewLang('en')}
            className={cn(
              'uppercase tracking-wider transition-colors',
              previewLang === 'en'
                ? 'text-foreground'
                : 'text-muted-foreground hover:text-foreground',
            )}
            aria-pressed={previewLang === 'en'}
          >
            EN
          </button>
        </div>
      </div>

      {/* The container query wrapper. `container-type: size` enables both
          inline-size and block-size queries so the hero can ask for the
          pane's actual height via `100cqh`. `contain: layout style`
          insulates the public-site CSS from the admin's layout. */}
      <div
        className="flex-1 overflow-y-auto bg-white text-brand-navy [container-type:size]"
        style={{ contain: 'layout style' }}
      >
        <div className="light min-h-full">
          {previewBlocks.length === 0 ? (
            <div className="flex h-full items-center justify-center px-6 py-12 text-center text-sm text-muted-foreground">
              Энэ хуудсанд блок байхгүй байна.
            </div>
          ) : (
            previewBlocks.map((block) => (
              <div key={block.id} className={cn(block.hidden === 1 ? 'opacity-40' : '')}>
                <BlockRenderer
                  block={block}
                  lang={previewLang}
                  mode="preview"
                  projectCards={cards}
                />
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
