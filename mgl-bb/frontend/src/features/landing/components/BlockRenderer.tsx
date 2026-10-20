/**
 * Dispatch a `LandingBlock` to its renderer based on `block.type`.
 *
 * This is the single source of truth used by both the public marketing
 * site (`LandingPage`, `LandingProjectDetailPage`) and the admin's live
 * preview pane (Phase 3). If a block renders red here it renders red on
 * the public site, automatically — no preview/prod divergence.
 *
 * Every block is wrapped in `BlockErrorBoundary`. In `mode='preview'`
 * the boundary shows an inline error card so the admin can fix it;
 * in `mode='live'` it renders nothing so public visitors never see a
 * broken block.
 */

import type { BlockType, LandingBlock } from '@/features/landing/types/landingBlocks';
import { parseBlockContent } from '@/features/landing/types/landingBlocks';
import { BlockErrorBoundary } from '@/features/landing/components/shared';
import {
  AboutBlock,
  AwardsBlock,
  CtaBlock,
  ContactBlock,
  DividerBlock,
  HeroBlock,
  ImageBlock,
  ImageGalleryBlock,
  NewsBlock,
  PartnersBlock,
  ProjectCreditsBlock,
  ProjectGridBlock,
  RichTextBlock,
  ServicesBlock,
  StatsBlock,
  ImageComparisonBlock,
  type BlockMode,
  type Lang,
  type ProjectCard,
} from '@/features/landing/components/sections';

export type { BlockMode, Lang, ProjectCard } from '@/features/landing/components/sections';

interface BlockRendererProps {
  block: LandingBlock<BlockType>;
  lang: Lang;
  mode?: BlockMode;
  /** Hydrated card data for project-grid blocks. Required if the page
   *  contains a project-grid; safe to pass an empty object otherwise. */
  projectCards?: Record<number, ProjectCard>;
}

export function BlockRenderer({ block, lang, mode = 'live', projectCards }: BlockRendererProps) {
  // Re-validate at render time — the API hands us `unknown`, and even if
  // the backend round-trip was clean the in-memory editor draft may have
  // drifted (Phase 3). Cheap; runs in micro-µs.
  const content = parseBlockContent(block.type, block.content as unknown);

  return (
    <BlockErrorBoundary blockType={block.type} mode={mode}>
      {renderByType(block.type, content, lang, mode, projectCards ?? {})}
    </BlockErrorBoundary>
  );
}

function renderByType(
  type: BlockType,
  content: ReturnType<typeof parseBlockContent>,
  lang: Lang,
  mode: BlockMode,
  projectCards: Record<number, ProjectCard>,
) {
  // The type switch keeps `content` narrowed to the right shape; no `as`
  // gymnastics because each branch references the per-type parse output.
  switch (type) {
    case 'hero':
      return (
        <HeroBlock
          content={content as ReturnType<typeof parseBlockContent<'hero'>>}
          lang={lang}
          mode={mode}
        />
      );
    case 'project-grid':
      return (
        <ProjectGridBlock
          content={content as ReturnType<typeof parseBlockContent<'project-grid'>>}
          lang={lang}
          mode={mode}
          projectCards={projectCards}
        />
      );
    case 'services':
      return (
        <ServicesBlock
          content={content as ReturnType<typeof parseBlockContent<'services'>>}
          lang={lang}
          mode={mode}
        />
      );
    case 'about':
      return (
        <AboutBlock
          content={content as ReturnType<typeof parseBlockContent<'about'>>}
          lang={lang}
          mode={mode}
        />
      );
    case 'stats':
      return (
        <StatsBlock
          content={content as ReturnType<typeof parseBlockContent<'stats'>>}
          lang={lang}
          mode={mode}
        />
      );
    case 'awards':
      return (
        <AwardsBlock
          content={content as ReturnType<typeof parseBlockContent<'awards'>>}
          lang={lang}
          mode={mode}
        />
      );
    case 'partners':
      return (
        <PartnersBlock
          content={content as ReturnType<typeof parseBlockContent<'partners'>>}
          lang={lang}
          mode={mode}
        />
      );
    case 'news':
      return (
        <NewsBlock
          content={content as ReturnType<typeof parseBlockContent<'news'>>}
          lang={lang}
          mode={mode}
        />
      );
    case 'contact':
      return (
        <ContactBlock
          content={content as ReturnType<typeof parseBlockContent<'contact'>>}
          lang={lang}
          mode={mode}
        />
      );
    case 'rich-text':
      return (
        <RichTextBlock
          content={content as ReturnType<typeof parseBlockContent<'rich-text'>>}
          lang={lang}
          mode={mode}
        />
      );
    case 'image':
      return (
        <ImageBlock
          content={content as ReturnType<typeof parseBlockContent<'image'>>}
          lang={lang}
          mode={mode}
        />
      );
    case 'image-gallery':
      return (
        <ImageGalleryBlock
          content={content as ReturnType<typeof parseBlockContent<'image-gallery'>>}
          lang={lang}
          mode={mode}
        />
      );
    case 'divider':
      return (
        <DividerBlock
          content={content as ReturnType<typeof parseBlockContent<'divider'>>}
          lang={lang}
          mode={mode}
        />
      );
    case 'cta':
      return (
        <CtaBlock
          content={content as ReturnType<typeof parseBlockContent<'cta'>>}
          lang={lang}
          mode={mode}
        />
      );
    case 'project-credits':
      return (
        <ProjectCreditsBlock
          content={content as ReturnType<typeof parseBlockContent<'project-credits'>>}
          lang={lang}
          mode={mode}
        />
      );
    case 'image-comparison':
      return (
        <ImageComparisonBlock
          content={content as ReturnType<typeof parseBlockContent<'image-comparison'>>}
          lang={lang}
          mode={mode}
        />
      );
    default: {
      const _exhaustive: never = type;
      return _exhaustive;
    }
  }
}
