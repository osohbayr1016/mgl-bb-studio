/**
 * Public renderers for every landing-block type. Each component takes
 * a typed `content` payload + `lang` + an optional `mode` flag, and
 * renders exactly what visitors see on the marketing site.
 *
 * Conventions:
 *   - Inputs are already-validated content (via parseBlockContent), so
 *     renderers don't defend against missing fields beyond null images.
 *   - `mode === 'preview'` is a no-op in Phase 1; Phase 3 wires it to
 *     swap full-viewport effects (100svh hero, doc-scroll scale) for
 *     container-query equivalents inside the admin preview pane.
 *   - These components are the single source of truth — both the public
 *     page and the admin's live preview mount them.
 */
import React, { useState, useRef } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight,
  ArrowUpRight,
  Award,
  Building2,
  HardHat,
  Handshake,
  KanbanSquare,
  Layers3,
  Mail,
  MapPin,
  Phone,
  Split,
} from 'lucide-react';
import { brand } from '@/shared/config/brand';

import type {
  AboutContent,
  AwardsContent,
  ContactContent,
  CtaContent,
  DividerContent,
  HeroContent,
  ImageContent,
  ImageGalleryContent,
  NewsContent,
  PartnersContent,
  ProjectCreditsContent,
  ProjectGridContent,
  RichTextContent,
  ServicesContent,
  StatsContent,
  ImageComparisonContent,
} from '@/features/landing/types/landingBlocks';
import { pickLang } from '@/features/landing/types/landingBlocks';
import { cn } from '@/shared/lib/utils';
import {
  DisplayHeading,
  FacebookGlyph,
  InstagramGlyph,
  LinkedinGlyph,
  SectionMarker,
  mediaUrl,
  useHeroScale,
  useReveal,
  useScrollScale,
} from '@/features/landing/components/shared';

/* ------------------------------------------------------------------ */
/*  Lookup tables                                                      */
/* ------------------------------------------------------------------ */

type IconComponent = typeof Layers3;

const SERVICE_ICONS: Record<string, IconComponent> = {
  Layers3,
  Building2,
  HardHat,
  KanbanSquare,
};

const HERO_FALLBACK = '/landing/hero-mak.jpg';
const ABOUT_FALLBACK = '/landing/stage-admin-office.jpg';

export type BlockMode = 'live' | 'preview';
export type Lang = 'mn' | 'en';

/** Hydrated card payload the home-page project-grid needs to render
 *  tiles. Comes from `GET /api/landing/v2/public/project-cards`. */
export interface ProjectCard {
  id: number;
  slug: string;
  title_mn: string;
  title_en: string;
  hero: HeroContent | null;
  credits: ProjectCreditsContent | null;
}

/* ------------------------------------------------------------------ */
/*  Hero                                                                */
/* ------------------------------------------------------------------ */

export function HeroBlock({
  content,
  lang,
  mode = 'live',
}: {
  content: HeroContent;
  lang: Lang;
  mode?: BlockMode;
}) {
  const title = pickLang(content.title_mn, content.title_en, lang);
  const subtitle = pickLang(content.subtitle_mn, content.subtitle_en, lang);
  const bg = mediaUrl(content.image_url ?? undefined) ?? HERO_FALLBACK;
  const video = mediaUrl(content.video_url ?? undefined);
  const ctaLabel = pickLang(content.cta_label_mn, content.cta_label_en, lang);
  // In preview mode the hero sits inside a constrained pane — fix its
  // height to a container-query unit (~80% of pane height) and skip the
  // doc-scroll-driven dolly because the doc scroll doesn't belong to it.
  const heroScale = useHeroScale(1.18);
  const isPreview = mode === 'preview';

  return (
    <section
      id="top"
      className={
        isPreview
          ? 'relative h-[min(80cqh,640px)] w-full overflow-hidden bg-black text-white'
          : 'relative h-[100svh] min-h-[640px] w-full overflow-hidden bg-black text-white'
      }
    >
      {video ? (
        <video
          autoPlay
          loop
          muted
          playsInline
          poster={bg}
          className="absolute inset-0 h-full w-full object-cover will-change-transform"
          style={{ transform: isPreview ? undefined : `scale(${heroScale})` }}
        >
          <source src={video} />
        </video>
      ) : (
        <img
          src={bg}
          alt=""
          className="absolute inset-0 h-full w-full object-cover will-change-transform"
          style={{ transform: isPreview ? undefined : `scale(${heroScale})` }}
        />
      )}

      <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/35 via-transparent to-black/85" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[55%] bg-gradient-to-t from-black/80 to-transparent" />

      <div className="relative z-10 mx-auto flex h-full max-w-[1600px] flex-col justify-between px-5 pt-24 pb-12 lg:px-12 lg:pb-20">
        <div className="flex items-center gap-4 font-mono text-[10px] uppercase tracking-[0.32em] text-white/75">
          <span className="font-semibold">Stage 01</span>
          <span className="h-px w-12 bg-white/40" aria-hidden />
          <span>
            {lang === 'mn'
              ? `${brand().name} — ${brand().taglineMn}`
              : `${brand().name} — ${brand().taglineEn}`}
          </span>
        </div>

        <div>
          <div className="text-[11px] font-mono uppercase tracking-[0.4em] text-white/65 mb-5">
            {brand().legalNameEn} · EST. {brand().foundedYear}
          </div>
          <h1 className="font-grotesk font-extrabold leading-[0.92] tracking-[-0.045em] text-5xl sm:text-7xl lg:text-[8rem] xl:text-[9.5rem] max-w-6xl">
            {title}
          </h1>
          {subtitle && (
            <p className="mt-7 max-w-2xl text-base sm:text-lg text-white/80 leading-relaxed">
              {subtitle}
            </p>
          )}
          {(ctaLabel || content.cta_anchor) && (
            <div className="mt-10 flex flex-wrap items-center gap-x-8 gap-y-4">
              {ctaLabel && (
                <button
                  type="button"
                  onClick={() => {
                    const anchor = content.cta_anchor || 'projects';
                    document.getElementById(anchor)?.scrollIntoView({ behavior: 'smooth' });
                  }}
                  className="group inline-flex items-center gap-3 border-b border-white pb-1 text-[12px] font-semibold uppercase tracking-[0.24em] text-white"
                >
                  {ctaLabel}
                  <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
                </button>
              )}
              <button
                type="button"
                onClick={() =>
                  document.getElementById('contact')?.scrollIntoView({ behavior: 'smooth' })
                }
                className="text-[12px] font-medium uppercase tracking-[0.24em] text-white/75 hover:text-white transition-colors"
              >
                {lang === 'mn' ? 'Холбоо барих →' : 'Get in touch →'}
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="absolute right-5 bottom-12 z-10 hidden lg:flex items-center gap-3 [writing-mode:vertical-rl] rotate-180 font-mono text-[10px] uppercase tracking-[0.32em] text-white/55">
        <span className="h-px w-10 bg-white/35" aria-hidden />
        <span>
          {brand().nameShort}.OS / {new Date().getFullYear()}
        </span>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/*  Project grid                                                       */
/* ------------------------------------------------------------------ */

function ProjectRow({ card, lang, index }: { card: ProjectCard; lang: Lang; index: number }) {
  const { ref, visible } = useReveal<HTMLDivElement>();
  const { ref: frameRef, scale } = useScrollScale<HTMLDivElement>({ min: 0.94, max: 1.06 });
  const title = pickLang(
    card.hero?.title_mn ?? card.title_mn,
    card.hero?.title_en ?? card.title_en,
    lang,
  );
  const subtitle = pickLang(card.hero?.subtitle_mn ?? '', card.hero?.subtitle_en ?? '', lang);
  const category = pickLang(card.credits?.category_mn ?? '', card.credits?.category_en ?? '', lang);
  const location = pickLang(card.credits?.location_mn ?? '', card.credits?.location_en ?? '', lang);
  const year = card.credits?.year ?? '';
  const img = mediaUrl(card.hero?.image_url ?? undefined);

  return (
    <article
      ref={ref}
      className={cn(
        'group relative transition-all duration-700 ease-out',
        visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8',
      )}
    >
      <Link to={`/${card.slug}`} aria-label={title} className="block">
        <div
          ref={frameRef}
          className="relative aspect-[16/10] w-full overflow-hidden rounded-2xl bg-brand-cloud"
        >
          {img ? (
            <img
              src={img}
              alt={title}
              loading="lazy"
              className="h-full w-full object-cover will-change-transform"
              style={{ transform: `scale(${scale})`, transformOrigin: 'center' }}
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-brand-blue/45">
              <Building2 className="h-14 w-14" />
            </div>
          )}

          <div className="absolute left-6 top-6 z-10 flex items-center gap-3 font-mono text-[10px] uppercase tracking-[0.28em] text-white/85 lg:left-8 lg:top-8">
            <span className="font-semibold tabular-nums">{String(index + 1).padStart(2, '0')}</span>
            <span className="h-px w-8 bg-white/40" aria-hidden />
            <span>{category || (lang === 'mn' ? 'Төсөл' : 'Project')}</span>
          </div>

          <div className="absolute right-6 top-6 z-10 inline-flex h-10 w-10 items-center justify-center rounded-full bg-white/12 text-white opacity-0 backdrop-blur-md transition-opacity duration-300 group-hover:opacity-100 lg:right-8 lg:top-8">
            <ArrowUpRight className="h-4 w-4" />
          </div>

          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-3/5 bg-gradient-to-t from-black/85 via-black/30 to-transparent" />

          <div className="absolute inset-x-0 bottom-0 p-6 text-white sm:p-8 lg:p-10">
            <h3 className="font-grotesk text-3xl font-bold leading-[0.96] tracking-[-0.03em] sm:text-4xl lg:text-5xl xl:text-6xl">
              {title}
            </h3>
            {subtitle && (
              <p className="mt-3 max-w-2xl text-[14px] leading-relaxed text-white/85 sm:text-[15px] lg:text-base">
                {subtitle}
              </p>
            )}
            <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[10px] uppercase tracking-[0.24em] text-white/75">
              {year && <span className="tabular-nums">{year}</span>}
              {year && location && (
                <span className="text-white/30" aria-hidden>
                  ·
                </span>
              )}
              {location && <span>{location}</span>}
              {(year || location) && category && (
                <span className="text-white/30" aria-hidden>
                  ·
                </span>
              )}
              {category && <span>{category}</span>}
            </div>
          </div>
        </div>
      </Link>
    </article>
  );
}

function OverflowCard({ card, lang }: { card: ProjectCard; lang: Lang }) {
  const { ref, scale } = useScrollScale<HTMLDivElement>({ min: 0.96, max: 1.04 });
  const title = pickLang(
    card.hero?.title_mn ?? card.title_mn,
    card.hero?.title_en ?? card.title_en,
    lang,
  );
  const category = pickLang(card.credits?.category_mn ?? '', card.credits?.category_en ?? '', lang);
  const location = pickLang(card.credits?.location_mn ?? '', card.credits?.location_en ?? '', lang);
  const year = card.credits?.year ?? '';
  const img = mediaUrl(card.hero?.image_url ?? undefined);
  return (
    <Link to={`/${card.slug}`} className="group block">
      <div ref={ref} className="aspect-[4/3] w-full overflow-hidden rounded-xl bg-brand-cloud">
        {img ? (
          <img
            src={img}
            alt={title}
            loading="lazy"
            className="h-full w-full object-cover will-change-transform"
            style={{ transform: `scale(${scale})`, transformOrigin: 'center' }}
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-brand-stone">
            <Building2 className="h-10 w-10" />
          </div>
        )}
      </div>
      <div className="mt-3 flex items-baseline justify-between gap-4">
        <div>
          <div className="font-grotesk text-sm font-semibold tracking-[-0.01em] text-brand-navy group-hover:underline underline-offset-[5px] decoration-1">
            {title}
          </div>
          <div className="mt-0.5 font-mono text-[10px] uppercase tracking-[0.22em] text-brand-blue/60">
            {[category, location, year].filter(Boolean).join(' · ')}
          </div>
        </div>
        <ArrowUpRight className="h-4 w-4 text-brand-blue/45 group-hover:text-brand-copper transition-colors" />
      </div>
    </Link>
  );
}

export function ProjectGridBlock({
  content,
  lang,
  projectCards,
}: {
  content: ProjectGridContent;
  lang: Lang;
  projectCards: Record<number, ProjectCard>;
  mode?: BlockMode;
}) {
  // Resolve ids → hydrated cards in the admin-set order. Drop ids that
  // resolve to nothing (deleted/unpublished pages) silently — the admin
  // sees the orphan in their editor, the public visitor sees no gap.
  const ordered = content.project_page_ids
    .map((id) => projectCards[id])
    .filter((c): c is ProjectCard => !!c);
  const featured = ordered.slice(0, 6);
  const overflow = ordered.slice(6);

  return (
    <section id="projects" className="bg-white text-brand-navy">
      <div className="mx-auto max-w-[1600px] px-5 py-24 lg:px-12 lg:py-36">
        <SectionMarker
          number="01"
          label={
            pickLang(content.section_label_mn, content.section_label_en, lang) ||
            (lang === 'mn' ? 'Сонгомол төслүүд' : 'Selected projects')
          }
        />
        <div className="mt-8 flex flex-col gap-10 lg:flex-row lg:items-end lg:justify-between">
          <DisplayHeading className="max-w-4xl">
            {pickLang(content.heading_mn, content.heading_en, lang)}
          </DisplayHeading>
          {(content.intro_mn || content.intro_en) && (
            <p className="max-w-md text-[15px] text-brand-blue/75 leading-relaxed">
              {pickLang(content.intro_mn, content.intro_en, lang)}
            </p>
          )}
        </div>

        {ordered.length === 0 ? (
          <div className="mt-16 border border-dashed border-brand-stone/70 px-10 py-16 text-center font-mono text-[11px] uppercase tracking-[0.22em] text-brand-blue/60">
            {lang === 'mn' ? 'Одоогоор төсөл нэмэгдээгүй байна.' : 'No projects yet.'}
          </div>
        ) : (
          <>
            <div className="mt-16 flex flex-col gap-6 lg:gap-8">
              {featured.map((c, i) => (
                <ProjectRow key={c.id} card={c} lang={lang} index={i} />
              ))}
            </div>

            {overflow.length > 0 && (
              <div className="mt-24 border-t border-brand-stone/50 pt-12">
                <SectionMarker
                  number="01.b"
                  label={lang === 'mn' ? 'Бусад төслүүд' : 'Further work'}
                />
                <div className="mt-8 grid grid-cols-1 gap-x-8 gap-y-6 sm:grid-cols-2 lg:grid-cols-3">
                  {overflow.map((c) => (
                    <OverflowCard key={c.id} card={c} lang={lang} />
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/*  Services / Capabilities                                            */
/* ------------------------------------------------------------------ */

export function ServicesBlock({
  content,
  lang,
}: {
  content: ServicesContent;
  lang: Lang;
  mode?: BlockMode;
}) {
  return (
    <section
      id="capabilities"
      className="bg-brand-cloud text-brand-navy border-t border-brand-stone/50"
    >
      <div className="mx-auto max-w-[1600px] px-5 py-24 lg:px-12 lg:py-36">
        <SectionMarker
          number="02"
          label={
            pickLang(content.section_label_mn, content.section_label_en, lang) ||
            (lang === 'mn' ? 'Чадавхи' : 'Capabilities')
          }
        />
        <div className="mt-8 flex flex-col gap-10 lg:flex-row lg:items-end lg:justify-between">
          <DisplayHeading className="max-w-3xl">
            {pickLang(content.heading_mn, content.heading_en, lang)}
          </DisplayHeading>
          {(content.intro_mn || content.intro_en) && (
            <p className="max-w-md text-[15px] text-brand-blue/75 leading-relaxed">
              {pickLang(content.intro_mn, content.intro_en, lang)}
            </p>
          )}
        </div>

        {content.items.length > 0 && (
          <div className="mt-16 border-t border-brand-stone/70">
            {content.items.map((s, i) => {
              const Icon = (s.icon && SERVICE_ICONS[s.icon]) || Layers3;
              const title = pickLang(s.title_mn, s.title_en, lang);
              const body = pickLang(s.body_mn, s.body_en, lang);
              return (
                <div
                  key={i}
                  className="group grid grid-cols-12 items-start gap-6 border-b border-brand-stone/70 py-8 transition-colors hover:bg-white"
                >
                  <div className="col-span-12 lg:col-span-1 font-mono text-[10px] uppercase tracking-[0.22em] text-brand-blue/60 tabular-nums">
                    {String(i + 1).padStart(2, '0')}
                  </div>
                  <div className="col-span-12 lg:col-span-4 flex items-start gap-4">
                    <span className="mt-0.5 inline-flex h-9 w-9 items-center justify-center border border-brand-stone/70 text-brand-blue/85 group-hover:border-brand-copper group-hover:text-brand-copper transition-colors">
                      <Icon className="h-4 w-4" strokeWidth={1.6} />
                    </span>
                    <h3 className="font-grotesk text-xl lg:text-2xl font-bold tracking-[-0.02em] leading-tight text-brand-navy">
                      {title}
                    </h3>
                  </div>
                  <p className="col-span-12 lg:col-span-7 text-[15px] leading-relaxed text-brand-blue/75">
                    {body}
                  </p>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/*  About + (optional) stats below                                     */
/* ------------------------------------------------------------------ */

export function AboutBlock({
  content,
  lang,
}: {
  content: AboutContent;
  lang: Lang;
  mode?: BlockMode;
}) {
  const { ref, visible } = useReveal<HTMLDivElement>();
  const { ref: imgRef, scale } = useScrollScale<HTMLDivElement>({ min: 0.94, max: 1.06 });
  const heading = pickLang(content.heading_mn, content.heading_en, lang);
  const body = pickLang(content.body_mn, content.body_en, lang);
  const img = mediaUrl(content.image_url ?? undefined) ?? ABOUT_FALLBACK;

  return (
    <section id="about" className="bg-white text-brand-navy border-t border-brand-stone/50">
      <div className="mx-auto max-w-[1600px] px-5 py-24 lg:px-12 lg:py-36">
        <SectionMarker
          number="03"
          label={
            pickLang(content.section_label_mn, content.section_label_en, lang) ||
            (lang === 'mn' ? 'Бидний тухай' : 'About')
          }
        />
        <div
          ref={ref}
          className={cn(
            'mt-8 grid grid-cols-1 gap-10 lg:grid-cols-12 lg:gap-16 transition-all duration-700',
            visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-6',
          )}
        >
          <div className="lg:col-span-7">
            <DisplayHeading className="max-w-3xl">{heading}</DisplayHeading>
            <p className="mt-8 max-w-2xl text-base lg:text-lg text-brand-blue/85 leading-relaxed whitespace-pre-line">
              {body}
            </p>
          </div>
          <div className="lg:col-span-5">
            <div
              ref={imgRef}
              className="aspect-[4/5] w-full overflow-hidden rounded-2xl bg-brand-cloud"
            >
              <img
                src={img}
                alt=""
                loading="lazy"
                className="h-full w-full object-cover will-change-transform"
                style={{ transform: `scale(${scale})`, transformOrigin: 'center' }}
              />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

export function StatsBlock({
  content,
  lang,
}: {
  content: StatsContent;
  lang: Lang;
  mode?: BlockMode;
}) {
  if (!content.tiles.length) return null;
  return (
    <section className="bg-white text-brand-navy">
      <div className="mx-auto max-w-[1600px] px-5 pb-20 lg:px-12 lg:pb-28">
        <dl className="grid grid-cols-2 border-t border-brand-stone/50 lg:grid-cols-4">
          {content.tiles.map((s, i) => (
            <div
              key={i}
              className="border-b border-brand-stone/50 px-1 py-8 lg:border-b-0 lg:border-r lg:border-brand-stone/50 lg:last:border-r-0 lg:px-6"
            >
              <dd className="font-grotesk font-extrabold tracking-[-0.04em] text-5xl lg:text-7xl text-brand-navy tabular-nums">
                {s.value}
              </dd>
              <dt className="mt-3 font-mono text-[10px] uppercase tracking-[0.24em] text-brand-blue/60">
                {pickLang(s.label_mn, s.label_en, lang)}
              </dt>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/*  Awards                                                             */
/* ------------------------------------------------------------------ */

function AwardCard({ img, title, tag }: { img: string | null; title: string; tag: string }) {
  const { ref, scale } = useScrollScale<HTMLDivElement>({ min: 0.94, max: 1.06 });
  return (
    <figure className="group relative overflow-hidden rounded-2xl bg-black">
      <div ref={ref} className="aspect-[4/5] w-full overflow-hidden">
        {img ? (
          <img
            src={img}
            alt={title}
            loading="lazy"
            className="h-full w-full object-cover will-change-transform"
            style={{ transform: `scale(${scale})`, transformOrigin: 'center' }}
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-white/40">
            <Award className="h-12 w-12" />
          </div>
        )}
      </div>
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/80 via-black/15 to-transparent" />
      <figcaption className="absolute inset-x-0 bottom-0 p-6">
        <div className="font-mono text-[10px] uppercase tracking-[0.24em] text-white/70">{tag}</div>
        <div className="mt-2 font-grotesk text-2xl font-bold tracking-[-0.025em] text-white">
          {title}
        </div>
      </figcaption>
    </figure>
  );
}

export function AwardsBlock({
  content,
  lang,
}: {
  content: AwardsContent;
  lang: Lang;
  mode?: BlockMode;
}) {
  if (!content.items.length) return null;
  return (
    <section id="recognition" className="bg-brand-navy text-white border-t border-white/10">
      <div className="mx-auto max-w-[1600px] px-5 py-24 lg:px-12 lg:py-36">
        <SectionMarker
          number="04"
          tone="dark"
          label={
            pickLang(content.section_label_mn, content.section_label_en, lang) ||
            (lang === 'mn' ? 'Шагнал, хүлээн зөвшөөрөл' : 'Recognition')
          }
        />
        <div className="mt-8 flex flex-col gap-10 lg:flex-row lg:items-end lg:justify-between">
          <DisplayHeading className="max-w-3xl text-white">
            {pickLang(content.heading_mn, content.heading_en, lang)}
          </DisplayHeading>
          {(content.intro_mn || content.intro_en) && (
            <p className="max-w-md text-[15px] text-white/70 leading-relaxed">
              {pickLang(content.intro_mn, content.intro_en, lang)}
            </p>
          )}
        </div>
        <div className="mt-16 grid grid-cols-1 gap-4 md:grid-cols-3">
          {content.items.map((a, i) => (
            <AwardCard
              key={i}
              img={mediaUrl(a.image_url ?? undefined) ?? null}
              title={pickLang(a.title_mn, a.title_en, lang)}
              tag={pickLang(a.tag_mn, a.tag_en, lang)}
            />
          ))}
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/*  Partners                                                           */
/* ------------------------------------------------------------------ */

export function PartnersBlock({
  content,
  lang,
}: {
  content: PartnersContent;
  lang: Lang;
  mode?: BlockMode;
}) {
  if (!content.items.length) return null;
  return (
    <section className="bg-white text-brand-navy border-t border-brand-stone/50">
      <div className="mx-auto max-w-[1600px] px-5 py-20 lg:px-12 lg:py-28">
        <SectionMarker
          number="05"
          label={
            pickLang(content.section_label_mn, content.section_label_en, lang) ||
            (lang === 'mn' ? 'BIM түншүүд' : 'BIM toolchain')
          }
        />
        <div className="mt-8 grid grid-cols-1 gap-10 lg:grid-cols-12 lg:gap-16">
          <div className="lg:col-span-5">
            <h2 className="font-grotesk text-3xl lg:text-5xl font-bold tracking-[-0.03em] leading-[0.96]">
              {pickLang(content.heading_mn, content.heading_en, lang)}
            </h2>
            {(content.intro_mn || content.intro_en) && (
              <p className="mt-6 max-w-md text-[15px] text-brand-blue/75 leading-relaxed">
                {pickLang(content.intro_mn, content.intro_en, lang)}
              </p>
            )}
          </div>
          <div className="lg:col-span-7 flex flex-wrap items-center justify-start gap-x-12 gap-y-8 lg:justify-end">
            {content.items.map((p, i) => {
              const src = mediaUrl(p.image_url ?? undefined);
              const inner = src ? (
                <img
                  src={src}
                  alt={p.name}
                  loading="lazy"
                  className="h-9 w-auto max-w-full opacity-70 grayscale transition hover:opacity-100 hover:grayscale-0"
                />
              ) : (
                <span className="inline-flex h-9 items-center px-3 border border-brand-stone/70 text-[11px] uppercase tracking-[0.2em] text-brand-blue/75">
                  <Handshake className="mr-2 h-4 w-4" /> {p.name}
                </span>
              );
              return p.link_url ? (
                <a
                  key={i}
                  href={p.link_url}
                  target="_blank"
                  rel="noreferrer noopener"
                  aria-label={p.name}
                >
                  {inner}
                </a>
              ) : (
                <span key={i} aria-label={p.name}>
                  {inner}
                </span>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/*  News                                                               */
/* ------------------------------------------------------------------ */

function NewsCard({ item: n, lang }: { item: NewsContent['items'][number]; lang: Lang }) {
  const { ref, scale } = useScrollScale<HTMLDivElement>({ min: 0.96, max: 1.04 });
  const title = pickLang(n.title_mn, n.title_en, lang);
  const excerpt = pickLang(n.excerpt_mn, n.excerpt_en, lang);
  const img = mediaUrl(n.image_url ?? undefined);
  const date = new Date(n.published_at);
  const dateStr = isNaN(date.getTime())
    ? n.published_at
    : date.toLocaleDateString(lang === 'mn' ? 'mn-MN' : 'en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      });
  const inner = (
    <article className="group">
      <div ref={ref} className="aspect-[16/10] w-full overflow-hidden rounded-xl bg-white">
        {img ? (
          <img
            src={img}
            alt=""
            loading="lazy"
            className="h-full w-full object-cover will-change-transform"
            style={{ transform: `scale(${scale})`, transformOrigin: 'center' }}
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-brand-stone">
            <Building2 className="h-12 w-12" />
          </div>
        )}
      </div>
      <div className="mt-4">
        <div className="font-mono text-[10px] uppercase tracking-[0.24em] text-brand-blue/60">
          {dateStr}
        </div>
        <h3 className="mt-2 font-grotesk text-xl font-bold tracking-[-0.02em] text-brand-navy">
          {title}
        </h3>
        {excerpt && (
          <p className="mt-2 text-sm text-brand-blue/75 leading-relaxed line-clamp-3">{excerpt}</p>
        )}
      </div>
    </article>
  );
  return n.link_url ? (
    <a href={n.link_url} target="_blank" rel="noreferrer noopener" className="block">
      {inner}
    </a>
  ) : (
    inner
  );
}

export function NewsBlock({
  content,
  lang,
}: {
  content: NewsContent;
  lang: Lang;
  mode?: BlockMode;
}) {
  if (!content.items.length) return null;
  return (
    <section id="news" className="bg-brand-cloud text-brand-navy border-t border-brand-stone/50">
      <div className="mx-auto max-w-[1600px] px-5 py-24 lg:px-12 lg:py-36">
        <SectionMarker
          number="06"
          label={
            pickLang(content.section_label_mn, content.section_label_en, lang) ||
            (lang === 'mn' ? 'Мэдээ, эссэ' : 'Newsroom')
          }
        />
        <DisplayHeading className="mt-8 max-w-3xl">
          {pickLang(content.heading_mn, content.heading_en, lang)}
        </DisplayHeading>

        <div className="mt-16 grid grid-cols-1 gap-x-8 gap-y-12 sm:grid-cols-2 lg:grid-cols-3">
          {content.items.map((n, i) => (
            <NewsCard key={i} item={n} lang={lang} />
          ))}
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/*  Contact                                                            */
/* ------------------------------------------------------------------ */

function ContactRow({
  icon,
  label,
  href,
}: {
  icon: React.ReactNode;
  label: string;
  href?: string;
}) {
  const inner = (
    <>
      <span className="inline-flex h-9 w-9 items-center justify-center border border-brand-stone/70 text-brand-blue/85 group-hover:border-brand-copper group-hover:text-brand-copper transition-colors">
        {icon}
      </span>
      <span className="text-base text-brand-navy/90 group-hover:text-brand-navy">{label}</span>
    </>
  );
  const cls = 'group flex items-center gap-5 border-b border-brand-stone/50 px-1 py-5';
  return href ? (
    <a href={href} className={cls}>
      {inner}
    </a>
  ) : (
    <div className={cls}>{inner}</div>
  );
}

export function ContactBlock({
  content,
  lang,
}: {
  content: ContactContent;
  lang: Lang;
  mode?: BlockMode;
}) {
  const address = pickLang(content.address_mn ?? '', content.address_en ?? '', lang);
  const intro = pickLang(content.intro_mn, content.intro_en, lang);
  return (
    <section id="contact" className="bg-white text-brand-navy border-t border-brand-stone/50">
      <div className="mx-auto max-w-[1600px] px-5 py-24 lg:px-12 lg:py-36">
        <SectionMarker
          number="07"
          label={
            pickLang(content.section_label_mn, content.section_label_en, lang) ||
            (lang === 'mn' ? 'Холбоо барих' : 'Contact')
          }
        />
        <div className="mt-8 grid grid-cols-1 gap-12 lg:grid-cols-12 lg:gap-16">
          <div className="lg:col-span-7">
            <DisplayHeading className="max-w-3xl">
              {pickLang(content.heading_mn, content.heading_en, lang)}
            </DisplayHeading>
            {intro && (
              <p className="mt-8 max-w-xl text-base lg:text-lg text-brand-blue/85 leading-relaxed">
                {intro}
              </p>
            )}
          </div>

          <div className="lg:col-span-5">
            <div className="border-t border-brand-stone/50">
              {content.email && (
                <ContactRow
                  icon={<Mail className="h-4 w-4" />}
                  label={content.email}
                  href={`mailto:${content.email}`}
                />
              )}
              {content.phone && (
                <ContactRow
                  icon={<Phone className="h-4 w-4" />}
                  label={content.phone}
                  href={`tel:${content.phone.replace(/\s+/g, '')}`}
                />
              )}
              {address && <ContactRow icon={<MapPin className="h-4 w-4" />} label={address} />}
            </div>

            <div className="mt-8 flex items-center gap-3">
              {content.facebook_url && (
                <a
                  href={content.facebook_url}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="inline-flex h-10 w-10 items-center justify-center border border-brand-stone/70 text-brand-blue/75 hover:border-brand-copper hover:text-brand-copper transition-colors"
                >
                  <FacebookGlyph className="h-4 w-4" />
                </a>
              )}
              {content.linkedin_url && (
                <a
                  href={content.linkedin_url}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="inline-flex h-10 w-10 items-center justify-center border border-brand-stone/70 text-brand-blue/75 hover:border-brand-copper hover:text-brand-copper transition-colors"
                >
                  <LinkedinGlyph className="h-4 w-4" />
                </a>
              )}
              {content.instagram_url && (
                <a
                  href={content.instagram_url}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="inline-flex h-10 w-10 items-center justify-center border border-brand-stone/70 text-brand-blue/75 hover:border-brand-copper hover:text-brand-copper transition-colors"
                >
                  <InstagramGlyph className="h-4 w-4" />
                </a>
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/*  Free-form blocks                                                   */
/* ------------------------------------------------------------------ */

export function RichTextBlock({
  content,
  lang,
}: {
  content: RichTextContent;
  lang: Lang;
  mode?: BlockMode;
}) {
  const body = pickLang(content.body_mn, content.body_en, lang);
  if (!body.trim()) return null;
  return (
    <section className="bg-white text-brand-navy">
      <div className="mx-auto max-w-3xl px-5 py-12 lg:px-12 lg:py-16">
        <div className="prose prose-neutral max-w-none text-base lg:text-lg text-brand-blue/85 leading-relaxed whitespace-pre-line">
          {body}
        </div>
      </div>
    </section>
  );
}

const IMAGE_ASPECT_CLS: Record<ImageContent['aspect'], string> = {
  '16/10': 'aspect-[16/10]',
  '4/5': 'aspect-[4/5]',
  '1/1': 'aspect-square',
};

export function ImageBlock({
  content,
  lang,
}: {
  content: ImageContent;
  lang: Lang;
  mode?: BlockMode;
}) {
  const img = mediaUrl(content.image_url ?? undefined);
  const caption = pickLang(content.caption_mn, content.caption_en, lang);
  if (!img) return null;
  return (
    <section className="bg-white">
      <div className="mx-auto max-w-[1400px] px-5 py-10 lg:px-12 lg:py-14">
        <figure>
          <div
            className={cn(
              'w-full overflow-hidden rounded-xl bg-brand-cloud',
              IMAGE_ASPECT_CLS[content.aspect],
            )}
          >
            <img src={img} alt={caption} loading="lazy" className="h-full w-full object-cover" />
          </div>
          {caption && (
            <figcaption className="mt-3 font-mono text-[11px] uppercase tracking-[0.2em] text-brand-blue/60">
              {caption}
            </figcaption>
          )}
        </figure>
      </div>
    </section>
  );
}

export function ImageGalleryBlock({
  content,
  lang,
}: {
  content: ImageGalleryContent;
  lang: Lang;
  mode?: BlockMode;
}) {
  const items = content.images.filter((i) => !!i.image_url);
  if (items.length === 0) return null;

  // Editorial mosaic: feature image, then alternating 2-up rows. Mirrors
  // the old LandingProjectDetailPage gallery rhythm.
  const rows: Array<
    | { kind: 'feature'; img: (typeof items)[number] }
    | { kind: 'pair'; a: (typeof items)[number]; b: (typeof items)[number] }
  > = [];
  let i = 0;
  if (items.length) {
    rows.push({ kind: 'feature', img: items[0]! });
    i = 1;
  }
  while (i < items.length) {
    const a = items[i]!;
    const b = items[i + 1];
    if (b) {
      rows.push({ kind: 'pair', a, b });
      i += 2;
    } else {
      rows.push({ kind: 'feature', img: a });
      i += 1;
    }
  }

  return (
    <section className="bg-white">
      <div className="mx-auto max-w-[1400px] px-5 py-12 lg:px-12 lg:py-16 space-y-8">
        {rows.map((row, idx) => {
          if (row.kind === 'feature') {
            const caption = pickLang(row.img.caption_mn, row.img.caption_en, lang);
            return (
              <figure key={idx}>
                <div className="aspect-[16/10] w-full overflow-hidden rounded-xl bg-brand-cloud">
                  <img
                    src={mediaUrl(row.img.image_url ?? undefined)}
                    alt={caption}
                    loading="lazy"
                    className="h-full w-full object-cover"
                  />
                </div>
                {caption && (
                  <figcaption className="mt-3 font-mono text-[11px] uppercase tracking-[0.2em] text-brand-blue/60">
                    {caption}
                  </figcaption>
                )}
              </figure>
            );
          }
          const capA = pickLang(row.a.caption_mn, row.a.caption_en, lang);
          const capB = pickLang(row.b.caption_mn, row.b.caption_en, lang);
          return (
            <div key={idx} className="grid grid-cols-1 gap-8 md:grid-cols-2">
              <figure>
                <div className="aspect-[4/5] w-full overflow-hidden rounded-xl bg-brand-cloud">
                  <img
                    src={mediaUrl(row.a.image_url ?? undefined)}
                    alt={capA}
                    loading="lazy"
                    className="h-full w-full object-cover"
                  />
                </div>
                {capA && (
                  <figcaption className="mt-3 font-mono text-[11px] uppercase tracking-[0.2em] text-brand-blue/60">
                    {capA}
                  </figcaption>
                )}
              </figure>
              <figure>
                <div className="aspect-[4/5] w-full overflow-hidden rounded-xl bg-brand-cloud">
                  <img
                    src={mediaUrl(row.b.image_url ?? undefined)}
                    alt={capB}
                    loading="lazy"
                    className="h-full w-full object-cover"
                  />
                </div>
                {capB && (
                  <figcaption className="mt-3 font-mono text-[11px] uppercase tracking-[0.2em] text-brand-blue/60">
                    {capB}
                  </figcaption>
                )}
              </figure>
            </div>
          );
        })}
      </div>
    </section>
  );
}

export function DividerBlock({
  content,
}: {
  content: DividerContent;
  lang: Lang;
  mode?: BlockMode;
}) {
  if (content.style === 'section-break') {
    return (
      <section className="bg-white">
        <div className="mx-auto max-w-[1600px] px-5 py-12 lg:px-12 lg:py-20">
          <div className="h-px bg-brand-stone/60" />
        </div>
      </section>
    );
  }
  return (
    <div className="mx-auto max-w-[1600px] px-5 lg:px-12">
      <div className="h-px bg-brand-stone/50" />
    </div>
  );
}

export function CtaBlock({ content, lang }: { content: CtaContent; lang: Lang; mode?: BlockMode }) {
  const eyebrow = pickLang(content.eyebrow_mn, content.eyebrow_en, lang);
  const heading = pickLang(content.heading_mn, content.heading_en, lang);
  const body = pickLang(content.body_mn, content.body_en, lang);
  const buttonLabel = pickLang(content.button_label_mn, content.button_label_en, lang);
  if (!heading && !body && !buttonLabel) return null;
  return (
    <section className="bg-brand-navy text-white">
      <div className="mx-auto max-w-[1200px] px-5 py-20 lg:px-12 lg:py-28 text-center">
        {eyebrow && (
          <div className="font-mono text-[10px] uppercase tracking-[0.32em] text-white/65">
            {eyebrow}
          </div>
        )}
        {heading && (
          <h2 className="mt-5 font-grotesk text-4xl lg:text-6xl font-bold tracking-[-0.03em] leading-[0.96]">
            {heading}
          </h2>
        )}
        {body && (
          <p className="mx-auto mt-6 max-w-xl text-[15px] lg:text-base text-white/80 leading-relaxed">
            {body}
          </p>
        )}
        {buttonLabel && content.button_href && (
          <div className="mt-10">
            <a
              href={content.button_href}
              className="inline-flex items-center gap-2 border border-white px-6 py-3 text-[12px] font-semibold uppercase tracking-[0.24em] text-white hover:bg-white hover:text-brand-navy transition-colors"
            >
              {buttonLabel}
              <ArrowRight className="h-4 w-4" />
            </a>
          </div>
        )}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/*  Project credits (project-detail pages only)                        */
/* ------------------------------------------------------------------ */

export function ProjectCreditsBlock({
  content,
  lang,
}: {
  content: ProjectCreditsContent;
  lang: Lang;
  mode?: BlockMode;
}) {
  const philosophy = pickLang(content.philosophy_mn, content.philosophy_en, lang);

  // Editorial 8-cell credits ledger — typology, location, year, status,
  // size, client, design_team + project name. Empty cells are dropped so
  // partially-filled projects still look intentional.
  const rows: Array<{ label: string; value: string }> = [];
  const push = (label_mn: string, label_en: string, value: string | null | undefined) => {
    const v = (value ?? '').trim();
    if (!v) return;
    rows.push({ label: lang === 'mn' ? label_mn : label_en, value: v });
  };
  const name = pickLang(content.name_mn, content.name_en, lang);
  if (name) rows.push({ label: lang === 'mn' ? 'Төсөл' : 'Project', value: name });
  push(
    'Барилгын төрөл',
    'Typology',
    pickLang(content.typology_mn ?? '', content.typology_en ?? '', lang),
  );
  push('Байршил', 'Location', pickLang(content.location_mn ?? '', content.location_en ?? '', lang));
  push('Он', 'Year', content.year ?? '');
  push('Статус', 'Status', pickLang(content.status_mn ?? '', content.status_en ?? '', lang));
  push('Хэмжээ', 'Size', pickLang(content.size_mn ?? '', content.size_en ?? '', lang));
  push('Захиалагч', 'Client', pickLang(content.client_mn ?? '', content.client_en ?? '', lang));
  push(
    'Дизайны баг',
    'Design team',
    pickLang(content.design_team_mn ?? '', content.design_team_en ?? '', lang),
  );

  return (
    <section className="bg-white text-brand-navy">
      <div className="mx-auto max-w-[1400px] px-5 py-16 lg:px-12 lg:py-24">
        {philosophy && (
          <p className="mx-auto max-w-3xl text-center text-lg lg:text-xl text-brand-blue/85 leading-relaxed whitespace-pre-line">
            {philosophy}
          </p>
        )}

        {rows.length > 0 && (
          <dl className="mt-16 grid grid-cols-2 gap-y-8 border-t border-brand-stone/50 pt-10 lg:grid-cols-4">
            {rows.map((r, i) => (
              <div key={i} className="px-1">
                <dt className="font-mono text-[10px] uppercase tracking-[0.24em] text-brand-blue/60">
                  {r.label}
                </dt>
                <dd className="mt-2 font-grotesk text-base lg:text-lg text-brand-navy tracking-[-0.01em]">
                  {r.value}
                </dd>
              </div>
            ))}
          </dl>
        )}
      </div>
    </section>
  );
}

export function ImageComparisonBlock({
  content,
  lang,
}: {
  content: ImageComparisonContent;
  lang: Lang;
  mode?: BlockMode;
}) {
  const [sliderPosition, setSliderPosition] = useState(50); // percentage 0...100
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const imgLeft = mediaUrl(content.image_left_url ?? undefined);
  const imgRight = mediaUrl(content.image_right_url ?? undefined);

  // If one of the images is missing, we render a regular full-width image or nothing
  if (!imgLeft && !imgRight) return null;

  const sectionLabel = pickLang(content.section_label_mn, content.section_label_en, lang);
  const heading = pickLang(content.heading_mn, content.heading_en, lang);
  const intro = pickLang(content.intro_mn, content.intro_en, lang);

  const labelLeft =
    pickLang(content.label_left_mn, content.label_left_en, lang) ||
    (lang === 'mn' ? 'Эскиз зураг' : 'Plan / Blueprint');
  const labelRight =
    pickLang(content.label_right_mn, content.label_right_en, lang) ||
    (lang === 'mn' ? 'Бодит гүйцэтгэл' : 'Realization / Photo');

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!isDragging || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const percentage = Math.max(0, Math.min(100, (x / rect.width) * 100));
    setSliderPosition(percentage);
  };

  const handlePointerDown = (e: React.PointerEvent) => {
    setIsDragging(true);
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handlePointerUp = () => {
    setIsDragging(false);
  };

  return (
    <section className="bg-white text-brand-navy border-t border-brand-stone/50">
      <div className="mx-auto max-w-[1600px] px-5 py-24 lg:px-12 lg:py-36">
        {/* Header fields */}
        {(sectionLabel || heading || intro) && (
          <div className="mb-16">
            {sectionLabel && <SectionMarker number="07" label={sectionLabel} />}
            <div className="mt-8 flex flex-col gap-10 lg:flex-row lg:items-end lg:justify-between">
              {heading && <DisplayHeading className="max-w-4xl">{heading}</DisplayHeading>}
              {intro && (
                <p className="max-w-md text-[15px] text-brand-blue/75 leading-relaxed">{intro}</p>
              )}
            </div>
          </div>
        )}

        {/* Comparison Slider */}
        {!imgLeft || !imgRight ? (
          <div className="relative overflow-hidden rounded-2xl bg-brand-cloud aspect-[16/10] w-full">
            <img
              src={imgLeft || imgRight}
              alt={heading || 'Comparison'}
              loading="lazy"
              className="h-full w-full object-cover"
            />
          </div>
        ) : (
          <div
            ref={containerRef}
            className="relative overflow-hidden rounded-2xl bg-brand-cloud aspect-[16/10] w-full select-none touch-none border border-brand-stone/40 cursor-ew-resize"
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
          >
            {/* Right Image (Realization) */}
            <img
              src={imgRight}
              alt={labelRight}
              loading="lazy"
              className="absolute inset-0 h-full w-full object-cover pointer-events-none"
            />

            {/* Left Image (Plan / Blueprint) */}
            <img
              src={imgLeft}
              alt={labelLeft}
              loading="lazy"
              className="absolute inset-0 h-full w-full object-cover pointer-events-none"
              style={{
                clipPath: `polygon(0 0, ${sliderPosition}% 0, ${sliderPosition}% 100%, 0 100%)`,
              }}
            />

            {/* Slider Divider Bar */}
            <div
              className={cn(
                'absolute top-0 bottom-0 w-0.5 transition-colors pointer-events-none',
                isDragging ? 'bg-brand-copper' : 'bg-white/80',
              )}
              style={{ left: `${sliderPosition}%` }}
            >
              {/* Grab handle */}
              <div
                className={cn(
                  'absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 flex h-11 w-11 items-center justify-center rounded-full border border-white/50 bg-brand-navy/80 text-white backdrop-blur-md shadow-2xl transition-all pointer-events-none',
                  isDragging
                    ? 'border-brand-copper bg-brand-copper scale-110 shadow-brand-copper/30'
                    : 'hover:scale-105 active:scale-95',
                )}
              >
                <Split className="h-4 w-4 rotate-90" />
              </div>
            </div>

            {/* Floating indicator labels */}
            {/* Left Label */}
            <div
              className="absolute bottom-4 left-4 pointer-events-none select-none backdrop-blur-md bg-brand-navy/60 border border-white/10 text-white text-[10px] uppercase font-mono tracking-[0.18em] px-3 py-1.5 rounded-md transition-opacity duration-300"
              style={{ opacity: sliderPosition > 15 ? 1 : 0 }}
            >
              {labelLeft}
            </div>

            {/* Right Label */}
            <div
              className="absolute bottom-4 right-4 pointer-events-none select-none backdrop-blur-md bg-brand-navy/60 border border-white/10 text-white text-[10px] uppercase font-mono tracking-[0.18em] px-3 py-1.5 rounded-md transition-opacity duration-300"
              style={{ opacity: sliderPosition < 85 ? 1 : 0 }}
            >
              {labelRight}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
