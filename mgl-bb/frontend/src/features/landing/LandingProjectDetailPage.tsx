import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import { brand } from '@/shared/config/brand';

import { apiFetch, ApiError } from '@/shared/api/client';
import { THEME_CLASSES, currentThemeClass } from '@/shared/lib/theme';
import { useLanguage } from '@/shared/i18n';
import { cn } from '@/shared/lib/utils';
import { BlockRenderer, type ProjectCard } from '@/features/landing/components/BlockRenderer';
import { mediaUrl, useScrollProgress } from '@/features/landing/components/shared';
import { useWebFont, MANROPE_HREF } from '@/shared/hooks/useWebFont';
import { pickLang } from '@/features/landing/types/landingBlocks';
import type {
  BlockType,
  HeroContent,
  LandingBlock,
  LandingPage as LandingPageRow,
} from '@/features/landing/types/landingBlocks';

/* ------------------------------------------------------------------ */
/*  API payloads                                                       */
/* ------------------------------------------------------------------ */

interface PagePayload {
  page: LandingPageRow;
  blocks: LandingBlock[];
}

interface ProjectIndexEntry {
  id: number;
  slug: string;
  title_mn: string;
  title_en: string;
}

interface ProjectIndexPayload {
  project_pages: ProjectIndexEntry[];
}

interface ProjectCardsPayload {
  cards: Record<number, ProjectCard>;
}

/* ------------------------------------------------------------------ */
/*  Top nav — slim variant for detail pages (back link + lang toggle)   */
/* ------------------------------------------------------------------ */

function DetailNav({ lang, setLang }: { lang: 'mn' | 'en'; setLang: (l: 'mn' | 'en') => void }) {
  const [scrolled, setScrolled] = useState(false);
  const progress = useScrollProgress();
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);
  const onDarkStage = !scrolled;

  return (
    <header
      className={cn(
        'fixed inset-x-0 top-0 z-50 transition-all duration-300',
        onDarkStage
          ? 'bg-gradient-to-b from-black/55 via-black/20 to-transparent'
          : 'bg-white border-b border-brand-stone/50',
      )}
    >
      <div className="mx-auto flex h-16 max-w-[1600px] items-center gap-8 px-5 lg:px-12">
        <Link
          to="/"
          className={cn(
            'flex items-center gap-3 transition-colors',
            onDarkStage ? 'text-white' : 'text-brand-navy',
          )}
        >
          <img
            src="/logo.svg"
            alt={brand().nameShort}
            className={cn('h-6 w-auto', onDarkStage ? '[filter:brightness(0)_invert(1)]' : '')}
            draggable={false}
          />
          <span className="font-semibold tracking-[0.22em] text-[11px] uppercase">{brand().name}</span>
        </Link>

        <Link
          to="/#projects"
          className={cn(
            'hidden sm:inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.24em] transition-colors',
            onDarkStage
              ? 'text-white/70 hover:text-white'
              : 'text-brand-blue/60 hover:text-brand-navy',
          )}
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          {lang === 'mn' ? 'Бүх төслүүд' : 'All projects'}
        </Link>

        <div className="flex-1" />

        <div
          role="group"
          aria-label="Language"
          className={cn(
            'hidden sm:flex items-center gap-2 text-[11px] font-medium',
            onDarkStage ? 'text-white/65' : 'text-brand-blue/60',
          )}
        >
          <button
            type="button"
            onClick={() => setLang('mn')}
            aria-pressed={lang === 'mn'}
            className={cn(
              'uppercase tracking-wider transition-colors',
              lang === 'mn' ? (onDarkStage ? 'text-white' : 'text-brand-navy') : '',
            )}
          >
            MN
          </button>
          <span className={onDarkStage ? 'text-white/30' : 'text-brand-stone'} aria-hidden>
            ·
          </span>
          <button
            type="button"
            onClick={() => setLang('en')}
            aria-pressed={lang === 'en'}
            className={cn(
              'uppercase tracking-wider transition-colors',
              lang === 'en' ? (onDarkStage ? 'text-white' : 'text-brand-navy') : '',
            )}
          >
            EN
          </button>
        </div>

        <Link
          to="/login"
          className={cn(
            'hidden sm:inline-flex items-center gap-1.5 px-4 py-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] transition-colors',
            onDarkStage
              ? 'border border-white/35 text-white/90 hover:bg-white hover:text-black'
              : 'border border-brand-navy text-brand-navy hover:bg-brand-navy hover:text-white',
          )}
        >
          {lang === 'mn' ? 'Нэвтрэх' : 'Sign in'}
          <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </div>

      <div
        className={cn(
          'pointer-events-none absolute inset-x-0 bottom-0 h-px',
          onDarkStage ? 'bg-white/10' : 'bg-brand-stone/50',
        )}
        aria-hidden
      >
        <div
          className={cn(
            'h-full origin-left transition-[transform,background-color] duration-100 ease-out',
            onDarkStage ? 'bg-white' : 'bg-brand-copper',
          )}
          style={{ transform: `scaleX(${progress})` }}
        />
      </div>
    </header>
  );
}

/* ------------------------------------------------------------------ */
/*  Prev / next pager — page chrome, not a block.                       */
/*  Driven by /api/landing/v2/public/index so the order matches the     */
/*  home page's project-grid.                                           */
/* ------------------------------------------------------------------ */

function PagerCard({
  entry,
  lang,
  direction,
  fallbackLabel,
  cards,
}: {
  entry?: ProjectIndexEntry;
  lang: 'mn' | 'en';
  direction: 'prev' | 'next';
  fallbackLabel: string;
  cards: Record<number, ProjectCard>;
}) {
  const card = entry ? cards[entry.id] : undefined;
  const img = mediaUrl(card?.hero?.image_url ?? undefined);
  const title = entry ? pickLang(entry.title_mn, entry.title_en, lang) : '';
  const arrow =
    direction === 'prev' ? <ArrowLeft className="h-4 w-4" /> : <ArrowRight className="h-4 w-4" />;
  const label =
    direction === 'prev'
      ? lang === 'mn'
        ? 'Өмнөх'
        : 'Previous'
      : lang === 'mn'
        ? 'Дараах'
        : 'Next';

  if (!entry) {
    return (
      <Link
        to="/#projects"
        className="group flex items-center justify-between gap-4 rounded-xl border border-brand-stone/60 bg-white px-6 py-6 text-brand-navy transition-colors hover:border-brand-copper"
      >
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.24em] text-brand-blue/60">
            {label}
          </div>
          <div className="mt-2 font-grotesk text-lg font-semibold tracking-[-0.01em]">
            {fallbackLabel}
          </div>
        </div>
        {arrow}
      </Link>
    );
  }
  return (
    <Link
      to={`/${entry.slug}`}
      className="group grid grid-cols-[120px_1fr_auto] items-center gap-6 rounded-xl border border-brand-stone/60 bg-white p-3 pr-6 text-brand-navy transition-colors hover:border-brand-copper"
    >
      <div className="aspect-[4/3] h-full w-full overflow-hidden rounded-lg bg-brand-cloud">
        {img && (
          <img
            src={img}
            alt={title}
            loading="lazy"
            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
          />
        )}
      </div>
      <div className="min-w-0">
        <div className="font-mono text-[10px] uppercase tracking-[0.24em] text-brand-blue/60">
          {label}
        </div>
        <div className="mt-2 font-grotesk text-lg font-semibold tracking-[-0.01em] truncate">
          {title}
        </div>
      </div>
      {arrow}
    </Link>
  );
}

function PrevNextPager({
  prev,
  next,
  lang,
  cards,
}: {
  prev?: ProjectIndexEntry;
  next?: ProjectIndexEntry;
  lang: 'mn' | 'en';
  cards: Record<number, ProjectCard>;
}) {
  return (
    <section className="bg-brand-cloud border-t border-brand-stone/50">
      <div className="mx-auto max-w-[1600px] px-5 py-20 lg:px-12 lg:py-28">
        <div className="font-mono text-[10px] uppercase tracking-[0.28em] text-brand-blue/60">
          {lang === 'mn' ? 'Үргэлжлүүлэх' : 'Continue'}
        </div>
        <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-2">
          <PagerCard
            entry={prev}
            lang={lang}
            direction="prev"
            fallbackLabel={lang === 'mn' ? 'Эхэнд' : 'Start of list'}
            cards={cards}
          />
          <PagerCard
            entry={next}
            lang={lang}
            direction="next"
            fallbackLabel={lang === 'mn' ? 'Бүх төслүүд' : 'All projects'}
            cards={cards}
          />
        </div>
      </div>
    </section>
  );
}

function Footer({ lang }: { lang: 'mn' | 'en' }) {
  const year = new Date().getFullYear();
  return (
    <footer className="bg-white text-brand-blue/60 border-t border-brand-stone/50">
      <div className="mx-auto flex max-w-[1600px] flex-col items-start justify-between gap-4 px-5 py-10 sm:flex-row sm:items-center lg:px-12">
        <div className="flex items-center gap-3">
          <img src="/logo.svg" alt={brand().nameShort} className="h-6 w-auto" draggable={false} />
          <span className="text-[11px] tracking-[0.24em] uppercase font-semibold text-brand-blue/85">
            {brand().legalNameEn}
          </span>
        </div>
        <div className="font-mono text-[11px] uppercase tracking-[0.2em]">
          © {year} · {lang === 'mn' ? 'Бүх эрх хуулиар хамгаалагдсан' : 'All rights reserved'}
        </div>
        <Link
          to="/login"
          className="text-[11px] uppercase tracking-[0.2em] hover:text-brand-navy transition-colors"
        >
          {lang === 'mn' ? 'Ажилтны нэвтрэлт →' : 'Staff sign in →'}
        </Link>
      </div>
    </footer>
  );
}

/* ------------------------------------------------------------------ */
/*  Page                                                                */
/* ------------------------------------------------------------------ */

export default function LandingProjectDetailPage() {
  // `font-grotesk` (Manrope) — index.html-д биш, маршрут дээрээ ачаална.
  useWebFont(MANROPE_HREF);
  const { lang, setLang } = useLanguage();
  const { id: rawId } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [data, setData] = useState<PagePayload | null>(null);
  const [index, setIndex] = useState<ProjectIndexEntry[]>([]);
  const [cards, setCards] = useState<Record<number, ProjectCard>>({});
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);

  const slug = `work/${rawId}`;

  useEffect(() => {
    let cancelled = false;
    setNotFound(false);
    setError(null);
    setData(null);

    Promise.all([
      apiFetch<PagePayload>(`/landing/v2/public?slug=${encodeURIComponent(slug)}`),
      apiFetch<ProjectIndexPayload>('/landing/v2/public/index'),
      apiFetch<ProjectCardsPayload>('/landing/v2/public/project-cards'),
    ])
      .then(([page, idx, cardPayload]) => {
        if (cancelled) return;
        setData(page);
        setIndex(idx.project_pages ?? []);
        setCards(cardPayload.cards ?? {});
      })
      .catch((e) => {
        if (cancelled) return;
        if (e instanceof ApiError && e.status === 404) {
          setNotFound(true);
        } else {
          setError(e instanceof Error ? e.message : String(e));
        }
      });

    return () => {
      cancelled = true;
    };
  }, [slug]);

  // Force the editorial brand-cloud theme regardless of the user's saved
  // app theme — same as the home page.
  useEffect(() => {
    const root = document.documentElement;
    const previous = currentThemeClass();
    root.classList.remove(...THEME_CLASSES);
    root.classList.add('light');
    const prevBg = document.body.style.backgroundColor;
    document.body.style.backgroundColor = '#ffffff';
    return () => {
      root.classList.remove(...THEME_CLASSES);
      root.classList.add(previous);
      document.body.style.backgroundColor = prevBg;
    };
  }, []);

  // Scroll-restore on /work/3 → /work/4 transitions.
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [rawId]);

  // Resolve prev/next from the index ordering.
  const { prev, next } = useMemo(() => {
    const i = index.findIndex((p) => p.slug === slug);
    if (i < 0) return { prev: undefined, next: undefined };
    return {
      prev: i > 0 ? index[i - 1] : undefined,
      next: i < index.length - 1 ? index[i + 1] : undefined,
    };
  }, [index, slug]);

  // Augment the hero block (if present) with a project-position eyebrow so
  // visitors know "this is project 03 of 08", matching the legacy detail
  // page's masthead. Pure rendering tweak — doesn't mutate stored data.
  const blocks = useMemo(() => {
    const raw = data?.blocks ?? [];
    const i = index.findIndex((p) => p.slug === slug);
    const total = index.length;
    if (i < 0 || total === 0) return raw;
    return raw.map((b) => {
      if (b.type !== 'hero') return b;
      const heroContent = b.content as HeroContent;
      const positionLabel = `${String(i + 1).padStart(2, '0')} / ${String(total).padStart(2, '0')}`;
      // Hero block only honours `cta_anchor` and the bilingual fields it
      // already has — we don't add new fields, just preserve the user's
      // values. The position label sits outside the block.
      return {
        ...b,
        content: { ...heroContent, _detail_position: positionLabel },
      } as LandingBlock<BlockType>;
    });
  }, [data, index, slug]);

  // ---- Loading / error / 404 states ---- //

  if (!data && !error && !notFound) {
    return (
      <div className="light min-h-screen bg-white font-sans text-brand-navy">
        <DetailNav lang={lang} setLang={setLang} />
        <div className="pointer-events-none fixed inset-x-0 top-16 z-40 mx-auto h-0.5 max-w-[1600px]">
          <div className="h-full w-full origin-left animate-pulse bg-brand-navy/30" />
        </div>
      </div>
    );
  }

  if (notFound) {
    return (
      <div className="light min-h-screen bg-white font-sans text-brand-navy">
        <DetailNav lang={lang} setLang={setLang} />
        <main className="mx-auto flex min-h-[80vh] max-w-[1200px] flex-col items-start justify-center px-5 lg:px-12">
          <div className="font-mono text-[10px] uppercase tracking-[0.28em] text-brand-blue/60">
            404
          </div>
          <h1 className="mt-4 font-grotesk text-4xl lg:text-6xl font-bold tracking-[-0.04em]">
            {lang === 'mn' ? 'Төсөл олдсонгүй.' : 'Project not found.'}
          </h1>
          <button
            type="button"
            onClick={() => navigate('/#projects')}
            className="mt-8 inline-flex items-center gap-2 border-b border-brand-copper pb-1 text-[12px] font-semibold uppercase tracking-[0.24em] text-brand-copper hover:border-brand-navy hover:text-brand-navy transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            {lang === 'mn' ? 'Бүх төслүүд' : 'Back to projects'}
          </button>
        </main>
      </div>
    );
  }

  if (error) {
    return (
      <div className="light min-h-screen bg-white font-sans text-brand-navy">
        <DetailNav lang={lang} setLang={setLang} />
        <main className="mx-auto flex min-h-[80vh] max-w-[1200px] flex-col items-start justify-center px-5 lg:px-12">
          <div className="font-mono text-[10px] uppercase tracking-[0.28em] text-brand-blue/60">
            {lang === 'mn' ? 'Алдаа' : 'Error'}
          </div>
          <h1 className="mt-4 font-grotesk text-4xl lg:text-6xl font-bold tracking-[-0.04em]">
            {lang === 'mn' ? 'Контентыг ачаалж чадсангүй.' : 'Failed to load content.'}
          </h1>
          <p className="mt-4 max-w-xl text-brand-blue/75">{error}</p>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white text-brand-navy">
      <DetailNav lang={lang} setLang={setLang} />

      {blocks.map((block) => (
        <BlockRenderer key={block.id} block={block} lang={lang} mode="live" projectCards={cards} />
      ))}

      <PrevNextPager prev={prev} next={next} lang={lang} cards={cards} />
      <Footer lang={lang} />
    </div>
  );
}
