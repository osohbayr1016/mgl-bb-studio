/**
 * Block-based landing CMS — admin editor.
 *
 * Three-pane layout:
 *   ┌──────────┬─────────────────────┬────────────────────────┐
 *   │ Pages    │ Block list          │ Live preview           │
 *   │ sidebar  │ (sortable cards +   │ (same BlockRenderer    │
 *   │ (200px)  │  inline editors)    │  as public site)       │
 *   └──────────┴─────────────────────┴────────────────────────┘
 *
 * Draft state is mirrored from the expanded block editor into a shared
 * Map here, so the preview pane stays live as the admin types. The
 * draggable splitter between the middle and right pane lets admins
 * widen the preview when they want a fuller-bleed look.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, ExternalLink, GripVertical } from 'lucide-react';

import {
  adminLandingKeys,
  fetchAdminPage,
  fetchAdminPages,
} from '@/features/landing/components/admin/api';
import { PageSidebar } from '@/features/landing/components/admin/PageSidebar';
import { BlockListEditor } from '@/features/landing/components/admin/BlockListEditor';
import { PreviewPane } from '@/features/landing/components/admin/PreviewPane';
import { useLanguage } from '@/shared/i18n';
import { DesktopOnlyNotice } from '@/shared/components/DesktopOnlyNotice';
import { useWebFont, MANROPE_HREF } from '@/shared/hooks/useWebFont';
import { Button } from '@/ui/button';
import type { DraftMirror } from '@/features/landing/components/admin/saveState';

export default function AdminLandingPage() {
  // PreviewPane нь BlockRenderer-ээр landing блокуудыг үзүүлдэг тул энэ
  // засварлагч ч Manrope-г шаардана — эс тэгвэл preview буруу фонттой гарна.
  useWebFont(MANROPE_HREF);
  const { lang } = useLanguage();
  const [activeId, setActiveId] = useState<number | null>(null);

  const pagesQuery = useQuery({
    queryKey: adminLandingKeys.pages(),
    queryFn: fetchAdminPages,
  });

  useEffect(() => {
    if (activeId != null) return;
    const home = pagesQuery.data?.find((p) => p.slug === 'home');
    if (home) setActiveId(home.id);
  }, [activeId, pagesQuery.data]);

  const pageQuery = useQuery({
    queryKey:
      activeId != null ? adminLandingKeys.page(activeId) : ['landing-admin', 'page', 'none'],
    queryFn: () => fetchAdminPage(activeId!),
    enabled: activeId != null,
  });

  const activePage = pageQuery.data?.page ?? null;
  const blocks = pageQuery.data?.blocks ?? [];

  /* ------ Draft mirror so the preview sees in-flight edits ------ */
  // We hold the drafts in a Map mutated in-place and bump a version
  // counter to trigger renders. Keeps re-renders cheap when typing —
  // only the preview subtree updates, not every editor input.
  const draftsRef = useRef<Map<number, unknown>>(new Map());
  const [draftVersion, setDraftVersion] = useState(0);
  const draftMirror: DraftMirror = useMemo(
    () => ({
      set: (blockId, content) => {
        draftsRef.current.set(blockId, content);
        setDraftVersion((v) => v + 1);
      },
      clear: (blockId) => {
        if (!draftsRef.current.has(blockId)) return;
        draftsRef.current.delete(blockId);
        setDraftVersion((v) => v + 1);
      },
    }),
    [],
  );

  // Clear drafts when switching pages so a stale draft from page A
  // doesn't bleed into page B's preview.
  useEffect(() => {
    draftsRef.current.clear();
    setDraftVersion((v) => v + 1);
  }, [activeId]);

  // Memoise the drafts snapshot the preview reads. We snapshot by
  // building a fresh Map on each version bump — the preview reference-
  // equality compares against this and re-renders.
  const draftsSnapshot = useMemo(() => new Map(draftsRef.current), [draftVersion]);

  /* ------ Splitter between editor and preview ------ */
  const [previewPct, setPreviewPct] = useState(38);
  const draggingRef = useRef(false);
  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    draggingRef.current = true;
    (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
  }, []);
  const handlePointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    const container = (e.currentTarget as HTMLDivElement).parentElement;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const pct = ((rect.right - e.clientX) / rect.width) * 100;
    setPreviewPct(Math.min(70, Math.max(20, pct)));
  }, []);
  const handlePointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    draggingRef.current = false;
    (e.currentTarget as HTMLDivElement).releasePointerCapture(e.pointerId);
  }, []);

  return (
    <div className="flex h-screen w-full flex-col bg-background text-foreground">
      <DesktopOnlyNotice feature="Landing CMS" />
      <EditorTopBar />
      <div className="flex min-h-0 flex-1">
        <div className="w-[220px] flex-shrink-0">
          {pagesQuery.isLoading ? (
            <SidebarSkeleton />
          ) : (
            <PageSidebar
              pages={pagesQuery.data ?? []}
              activeId={activeId}
              onSelect={setActiveId}
              lang={lang}
            />
          )}
        </div>

        <div className="flex min-w-0 flex-1">
          {/* Editor column — flex-1 so it fills the middle gap. */}
          <div
            className="flex min-w-0 flex-col border-r border-border"
            style={{ width: `${100 - previewPct}%` }}
          >
            {activePage ? (
              <>
                <PageHeader pageSlug={activePage.slug} />
                <div className="flex-1 overflow-hidden">
                  <BlockListEditor
                    pageId={activePage.id}
                    pageKind={activePage.kind}
                    blocks={blocks}
                    lang={lang}
                    draftMirror={draftMirror}
                  />
                </div>
              </>
            ) : (
              <EditorSkeleton />
            )}
          </div>

          {/* Draggable splitter — large hit area, small visual line. */}
          <div
            role="separator"
            aria-orientation="vertical"
            className="group relative hidden w-1 cursor-col-resize bg-border hover:bg-primary/40 lg:block"
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
          >
            <div className="pointer-events-none absolute left-1/2 top-1/2 hidden -translate-x-1/2 -translate-y-1/2 rounded-md bg-muted px-1.5 py-1 text-muted-foreground opacity-0 group-hover:opacity-100 group-active:opacity-100 lg:block">
              <GripVertical className="h-3 w-3" />
            </div>
          </div>

          {/* Preview column. */}
          <div className="hidden flex-shrink-0 lg:block" style={{ width: `${previewPct}%` }}>
            {activePage ? (
              <PreviewPane blocks={blocks} drafts={draftsSnapshot} pageKind={activePage.kind} />
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                …
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function EditorTopBar() {
  return (
    <div className="flex h-12 flex-shrink-0 items-center justify-between border-b border-border bg-muted/30 px-4">
      <Link
        to="/app"
        className="inline-flex items-center gap-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        Аппликэйшн руу буцах
      </Link>
      <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
        Landing CMS
      </div>
    </div>
  );
}

function PageHeader({ pageSlug }: { pageSlug: string }) {
  const publicHref = pageSlug === 'home' ? '/' : `/${pageSlug}`;
  return (
    <div className="flex items-center justify-between border-b border-border px-4 py-3">
      <div>
        <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
          Засаж байгаа хуудас
        </div>
        <div className="mt-0.5 font-mono text-sm">{pageSlug}</div>
      </div>
      <a href={publicHref} target="_blank" rel="noreferrer noopener">
        <Button variant="outline" size="sm">
          <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
          Шууд харах
        </Button>
      </a>
    </div>
  );
}

function SidebarSkeleton() {
  return (
    <aside className="flex h-full w-full flex-col border-r border-border bg-muted/20 p-3">
      <div className="space-y-2">
        <div className="h-9 animate-pulse rounded-md bg-muted/60" />
        <div className="h-9 animate-pulse rounded-md bg-muted/60" />
        <div className="h-9 animate-pulse rounded-md bg-muted/60" />
      </div>
    </aside>
  );
}

function EditorSkeleton() {
  return (
    <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
      Ачаалж байна…
    </div>
  );
}
