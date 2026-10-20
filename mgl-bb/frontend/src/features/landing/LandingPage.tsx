import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Menu, X } from 'lucide-react';
import { brand } from '@/shared/config/brand';

import { apiFetch } from '@/shared/api/client';
import { THEME_CLASSES, currentThemeClass } from '@/shared/lib/theme';
import { useLanguage } from '@/shared/i18n';
import { cn } from '@/shared/lib/utils';
import { BlockRenderer, type ProjectCard } from '@/features/landing/components/BlockRenderer';
import { useScrollProgress } from '@/features/landing/components/shared';
import { useWebFont, MANROPE_HREF } from '@/shared/hooks/useWebFont';
import type {
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

interface ProjectCardsPayload {
  cards: Record<number, ProjectCard>;
}

/* ------------------------------------------------------------------ */
/*  Top navigation                                                      */
/*                                                                       */
/*  Anchors are CSS ids set inside the section blocks themselves —      */
/*  if the admin removes a section, its nav link silently stops         */
/*  scrolling. We don't audit blocks to suppress orphaned links because */
/*  the section ids are still semantically meaningful.                  */
/* ------------------------------------------------------------------ */

function TopNav({
  lang,
  setLang,
  onJump,
}: {
  lang: 'mn' | 'en';
  setLang: (l: 'mn' | 'en') => void;
  onJump: (id: string) => void;
}) {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);
  const progress = useScrollProgress();
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const items: { id: string; label: { mn: string; en: string } }[] = [
    { id: 'projects', label: { mn: 'Төслүүд', en: 'Projects' } },
    { id: 'capabilities', label: { mn: 'Үйлчилгээ', en: 'Capabilities' } },
    { id: 'about', label: { mn: 'Бидний тухай', en: 'About' } },
    { id: 'recognition', label: { mn: 'Шагнал', en: 'Recognition' } },
    { id: 'news', label: { mn: 'Мэдээ', en: 'News' } },
    { id: 'contact', label: { mn: 'Холбоо барих', en: 'Contact' } },
  ];

  const jump = (id: string) => {
    setOpen(false);
    onJump(id);
  };
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
        <button
          type="button"
          onClick={() => onJump('top')}
          className={cn(
            'flex items-center gap-3 transition-colors',
            onDarkStage ? 'text-white' : 'text-brand-navy',
          )}
        >
          <img
            src="/logo.svg"
            alt={brand().nameShort}
            className={cn(
              'h-6 w-auto transition-[filter]',
              onDarkStage ? '[filter:brightness(0)_invert(1)]' : '',
            )}
            draggable={false}
          />
          <span className="font-semibold tracking-[0.22em] text-[11px] uppercase">{brand().name}</span>
        </button>

        <nav
          className={cn(
            'ml-6 hidden lg:flex items-center gap-7 text-[13px]',
            onDarkStage ? 'text-white/80' : 'text-brand-blue/75',
          )}
        >
          {items.map((it) => (
            <button
              key={it.id}
              type="button"
              onClick={() => jump(it.id)}
              className={cn(
                'transition-colors',
                onDarkStage ? 'hover:text-white' : 'hover:text-brand-navy',
              )}
            >
              {it.label[lang]}
            </button>
          ))}
        </nav>

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
              lang === 'mn'
                ? onDarkStage
                  ? 'text-white'
                  : 'text-brand-navy'
                : 'hover:opacity-100',
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
              lang === 'en'
                ? onDarkStage
                  ? 'text-white'
                  : 'text-brand-navy'
                : 'hover:opacity-100',
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

        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className={cn('lg:hidden', onDarkStage ? 'text-white' : 'text-brand-navy')}
          aria-label="Toggle menu"
        >
          {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </div>

      {open && (
        <div className="lg:hidden border-t border-brand-stone/50 bg-white">
          <nav className="flex flex-col px-5 py-3">
            {items.map((it) => (
              <button
                key={it.id}
                type="button"
                onClick={() => jump(it.id)}
                className="py-3 text-left text-[15px] text-brand-navy border-b border-brand-stone/40 last:border-none"
              >
                {it.label[lang]}
              </button>
            ))}
            <Link
              to="/login"
              className="mt-4 inline-flex items-center justify-center gap-1.5 border border-brand-navy px-4 py-3 text-sm font-medium text-brand-navy"
            >
              {lang === 'mn' ? 'Нэвтрэх' : 'Sign in'}
              <ArrowRight className="h-4 w-4" />
            </Link>
          </nav>
        </div>
      )}

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

export default function LandingPage() {
  // Manrope (`font-grotesk`) нь landing-ийн display нүүр. index.html-д БИШ,
  // энд ачаална — эс тэгвэл апп руу нэвтэрсэн, энэ хуудсыг хэзээ ч харахгүй
  // хэрэглэгч бүр түүнийг критик замдаа татна.
  useWebFont(MANROPE_HREF);
  const { lang, setLang } = useLanguage();
  const [data, setData] = useState<PagePayload | null>(null);
  const [cards, setCards] = useState<Record<number, ProjectCard>>({});
  const [error, setError] = useState<string | null>(null);

  // Single round trip per visitor — both the page and the project-card
  // map are edge-cached for 60s so concurrent visitors share the same
  // response.
  useEffect(() => {
    let cancelled = false;
    Promise.all([
      apiFetch<PagePayload>('/landing/v2/public?slug=home'),
      apiFetch<ProjectCardsPayload>('/landing/v2/public/project-cards'),
    ])
      .then(([payload, cardPayload]) => {
        if (cancelled) return;
        setData(payload);
        setCards(cardPayload.cards ?? {});
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const scrollTo = useCallback((id: string) => {
    if (id === 'top') {
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    const el = document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: 'smooth' });
  }, []);

  // Force the editorial brand-cloud identity for this view, regardless
  // of the visitor's saved app theme.
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

  const ready = !!data;
  const blocks = data?.blocks ?? [];
  const showError = !!error && !data;

  return (
    <div className="light min-h-screen bg-white font-sans text-brand-navy">
      <TopNav lang={lang} setLang={setLang} onJump={scrollTo} />

      {blocks.map((block) => (
        <BlockRenderer key={block.id} block={block} lang={lang} mode="live" projectCards={cards} />
      ))}

      <Footer lang={lang} />

      {showError && (
        <div className="fixed bottom-5 right-5 z-50 max-w-sm border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800 shadow-lg">
          {lang === 'mn' ? 'Контент ачаалж чадсангүй: ' : 'Failed to load content: '}
          {error}
        </div>
      )}
      {!ready && !showError && (
        <div className="pointer-events-none fixed inset-x-0 top-16 z-40 mx-auto h-0.5 max-w-[1600px]">
          <div className="h-full w-full origin-left animate-pulse bg-brand-navy/30" />
        </div>
      )}
    </div>
  );
}
