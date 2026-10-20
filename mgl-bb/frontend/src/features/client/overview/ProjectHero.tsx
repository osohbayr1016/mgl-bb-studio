/**
 * Тоймын нүүр — төслийн нэр ХАМГИЙН ТОМ бичвэр, доор нь төслийн зураг ба
 * гүйцэтгэл/хугацааны самбар.  Зураг байхгүй бол архитектурын зургийн
 * тэнхлэгийн тор (A-B-C / 1-2-3) бүхий «хавтан» зурна — хоосон саарал хайрцаг
 * БИШ.
 */
import { useId, useState } from 'react';
import { MapPin } from 'lucide-react';

import { mediaUrl } from '@/shared/api/client';
import { useLanguage } from '@/shared/i18n';
import { locationDisplayText } from '@/shared/lib/mapsLink';
import { categoryName } from '@/shared/lib/project-categories';
import { todayUB } from '@/shared/lib/time';
import { cn } from '@/shared/lib/utils';
import { OpenInGoogleMaps } from '@/features/projects/components/OpenInGoogleMaps';

import type { OverviewResponse } from '../client-dashboard.types';
import type { ClientPortalProject } from '../portalApi';
import { Eyebrow, ProgressLine } from '../components/primitives';
import { pctOne, scheduleState, splitProjectTitle, isoDay } from '../lib/clientFormat';
import { PROJECT_STATUS_LABEL, countLabel } from '../lib/labels';

/**
 * Нэр + ангилал/код + төлөв + байршил.  Тойм (`overview`) ачаалагдаагүй /
 * алдаатай үед ч төслийн жагсаалтын өгөгдлөөр ганцаараа зурагдана — захиалагч
 * алдааны хайрцгийг ямар төслийнх болохыг мэдэхгүйгээр харахгүй.
 */
export function HeroHeading({
  project,
  latitude = null,
  longitude = null,
}: {
  project: ClientPortalProject;
  latitude?: number | null;
  longitude?: number | null;
}) {
  const { t, lang } = useLanguage();
  const parts = splitProjectTitle(project.name, project.display_title);
  const eyebrow = [parts.category ? categoryName(parts.category, lang) : null, parts.code]
    .filter(Boolean)
    .join(' · ');
  const location = project.location;
  const locationText = location ? locationDisplayText(location) || location : '';

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-foreground/10 pb-4">
        <Eyebrow index="01">{eyebrow || t('clientRoom.nav.overview')}</Eyebrow>
        <StatusMark status={project.status} />
      </div>

      <h1
        id="client-hero-title"
        title={project.name}
        className="mt-8 max-w-[18ch] break-words font-display text-[clamp(2.6rem,7vw,6.5rem)] font-light leading-[0.94] tracking-[-0.045em] text-foreground md:mt-12"
      >
        {parts.title}
      </h1>

      <div className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-3 text-sm text-muted-foreground">
        {locationText ? (
          <span className="inline-flex min-w-0 items-center gap-2">
            <MapPin className="h-4 w-4 shrink-0" strokeWidth={1.5} />
            <span className="min-w-0 break-words">{locationText}</span>
          </span>
        ) : null}
        <OpenInGoogleMaps
          variant="inline"
          className="text-foreground underline-offset-4 hover:underline"
          project={{ location, latitude, longitude }}
        />
      </div>
    </>
  );
}

export function ProjectHero({
  project,
  overview,
}: {
  project: ClientPortalProject;
  overview: OverviewResponse;
}) {
  const { t } = useLanguage();
  const parts = splitProjectTitle(project.name, project.display_title);
  const imageSrc = project.key_image_url ? mediaUrl(project.key_image_url) : '';
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const showImage = Boolean(imageSrc) && failedSrc !== imageSrc;

  return (
    <section aria-labelledby="client-hero-title" className="pt-10 md:pt-14">
      <HeroHeading
        project={{ ...project, location: project.location ?? overview.project.location }}
        latitude={overview.project.latitude ?? null}
        longitude={overview.project.longitude ?? null}
      />

      <div className="mt-10 grid border border-foreground/10 md:mt-14 lg:grid-cols-12">
        <figure className="relative border-b border-foreground/10 lg:col-span-8 lg:border-b-0 lg:border-r">
          {showImage ? (
            <img
              src={imageSrc}
              alt={t('clientRoom.hero.imageAlt', { name: parts.title })}
              className="aspect-[16/10] h-full w-full object-cover"
              decoding="async"
              onError={() => setFailedSrc(imageSrc)}
            />
          ) : (
            <BlueprintPlate />
          )}
          <figcaption className="pointer-events-none absolute bottom-0 left-0 flex items-center gap-2 bg-background/90 px-3 py-1.5 font-mono text-label uppercase tracking-[0.14em] text-muted-foreground">
            {showImage ? parts.code || parts.title : t('clientRoom.hero.noImage')}
          </figcaption>
        </figure>
        <div className="p-6 md:p-8 lg:col-span-4">
          <ProgressPanel overview={overview} />
        </div>
      </div>
    </section>
  );
}

function StatusMark({ status }: { status: string | null }) {
  const { t } = useLanguage();
  if (!status) return null;
  const key = PROJECT_STATUS_LABEL[status];
  return (
    <span className="inline-flex items-center gap-2 font-mono text-label uppercase tracking-[0.14em] text-foreground">
      <span
        aria-hidden
        className={cn(
          'h-2 w-2 rounded-full',
          status === 'active' ? 'bg-brand-copper' : status === 'completed' ? 'bg-success' : 'bg-muted-subtle',
        )}
      />
      {key ? t(key) : status}
    </span>
  );
}

/** Нийт гүйцэтгэл + хугацааны шугам. */
function ProgressPanel({ overview }: { overview: OverviewResponse }) {
  const { t } = useLanguage();
  const today = todayUB();
  const sched = scheduleState(overview.project.start_date, overview.project.finish_date, today);

  return (
    <div className="flex h-full flex-col justify-between gap-12">
      <div>
        <Eyebrow>{t('clientRoom.progress.overall')}</Eyebrow>
        <p
          className="mt-6 font-display text-[clamp(4.25rem,8vw,7.5rem)] font-light leading-[0.82] tracking-[-0.06em] tabular-nums text-foreground"
          data-testid="client-overall-progress"
        >
          {pctOne(overview.overall_progress)}
          <span className="ml-1 align-top text-3xl tracking-normal text-muted-foreground">%</span>
        </p>
        <ProgressLine
          value={overview.overall_progress}
          size="bold"
          tone="copper"
          className="mt-8"
          label={t('clientRoom.progress.overall')}
        />
        <p className="mt-3 text-micro text-muted-foreground">{t('clientRoom.progress.overallHint')}</p>
      </div>

      <div>
        <Eyebrow>{t('clientRoom.schedule.title')}</Eyebrow>
        {sched ? (
          <div className="mt-5">
            <div className="relative h-10">
              <div className="absolute inset-x-0 bottom-2 h-px bg-foreground/25" />
              <div
                className="absolute bottom-2 left-0 h-px bg-foreground"
                style={{ width: `${sched.elapsedPct}%` }}
              />
              <span className="absolute bottom-0 left-0 h-[9px] w-px bg-foreground" />
              <span className="absolute bottom-0 right-0 h-[9px] w-px bg-foreground" />
              {sched.phase === 'running' ? (
                <span
                  className={cn(
                    'absolute bottom-0 flex flex-col items-center gap-1',
                    sched.elapsedPct < 14
                      ? 'items-start'
                      : sched.elapsedPct > 86
                        ? '-translate-x-full items-end'
                        : '-translate-x-1/2',
                  )}
                  style={{ left: `${sched.elapsedPct}%` }}
                >
                  <span className="font-mono text-label uppercase tracking-[0.12em] text-brand-copper">
                    {t('clientRoom.schedule.today')}
                  </span>
                  <span className="h-[13px] w-px bg-brand-copper" />
                </span>
              ) : null}
            </div>
            <div className="mt-2 flex justify-between gap-4 font-mono text-micro tabular-nums">
              <span className="flex flex-col">
                <span className="text-foreground">{isoDay(sched.start)}</span>
                <span className="text-muted-foreground">{t('clientRoom.schedule.start')}</span>
              </span>
              <span className="flex flex-col text-right">
                <span className="text-foreground">{isoDay(sched.finish)}</span>
                <span className="text-muted-foreground">{t('clientRoom.schedule.finish')}</span>
              </span>
            </div>
            <p className="mt-4 text-body text-muted-foreground">
              {countLabel(t, 'clientRoom.schedule.totalDays', sched.totalDays)}
              {sched.phase === 'running'
                ? ` · ${countLabel(t, 'clientRoom.schedule.daysLeft', sched.daysLeft)}`
                : sched.phase === 'upcoming'
                  ? ` · ${countLabel(t, 'clientRoom.schedule.startsIn', sched.daysToStart)}`
                  : ''}
            </p>
          </div>
        ) : (
          <p className="mt-4 text-body text-muted-foreground">
            {typeof overview.duration_days === 'number'
              ? countLabel(t, 'clientRoom.schedule.totalDays', overview.duration_days)
              : t('clientRoom.schedule.notSet')}
          </p>
        )}
      </div>
    </div>
  );
}

/** Зураггүй төслийн «хавтан» — барилгын тэнхлэгийн тор, чимэглэл. */
function BlueprintPlate() {
  const uid = useId().replace(/:/g, '');
  const letters = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];
  const xs = [260, 440, 620, 800, 980, 1160, 1340];
  const ys = [250, 430, 610, 790];
  return (
    <div aria-hidden className="relative aspect-[16/10] w-full overflow-hidden text-foreground">
      <svg
        viewBox="0 0 1600 1000"
        preserveAspectRatio="xMidYMid slice"
        className="absolute inset-0 h-full w-full"
      >
        <defs>
          <pattern id={`grid-${uid}`} width="30" height="30" patternUnits="userSpaceOnUse">
            <path d="M30 0H0V30" fill="none" stroke="currentColor" strokeOpacity="0.05" />
          </pattern>
          <pattern
            id={`hatch-${uid}`}
            width="14"
            height="14"
            patternUnits="userSpaceOnUse"
            patternTransform="rotate(45)"
          >
            <line x1="0" y1="0" x2="0" y2="14" stroke="currentColor" strokeOpacity="0.14" />
          </pattern>
        </defs>
        <rect width="1600" height="1000" fill={`url(#grid-${uid})`} />
        {xs.map((x, i) => (
          <g key={x}>
            <line
              x1={x}
              y1={150}
              x2={x}
              y2={900}
              stroke="currentColor"
              strokeOpacity="0.22"
              strokeDasharray="28 8 4 8"
            />
            <circle cx={x} cy={110} r={24} fill="none" stroke="currentColor" strokeOpacity="0.45" />
            <text
              x={x}
              y={118}
              textAnchor="middle"
              fontSize="22"
              fontFamily="JetBrains Mono, monospace"
              fill="currentColor"
              fillOpacity="0.6"
            >
              {letters[i]}
            </text>
          </g>
        ))}
        {ys.map((y, i) => (
          <g key={y}>
            <line
              x1={200}
              y1={y}
              x2={1420}
              y2={y}
              stroke="currentColor"
              strokeOpacity="0.22"
              strokeDasharray="28 8 4 8"
            />
            <circle cx={150} cy={y} r={24} fill="none" stroke="currentColor" strokeOpacity="0.45" />
            <text
              x={150}
              y={y + 8}
              textAnchor="middle"
              fontSize="22"
              fontFamily="JetBrains Mono, monospace"
              fill="currentColor"
              fillOpacity="0.6"
            >
              {i + 1}
            </text>
          </g>
        ))}
        {/* Барилгын ул мөр — L хэлбэрийн төлөвлөгөө. */}
        <path
          d="M440 250 H1160 V610 H980 V790 H440 Z"
          fill={`url(#hatch-${uid})`}
          stroke="currentColor"
          strokeOpacity="0.75"
          strokeWidth="3"
        />
        <path d="M620 430 H980" stroke="currentColor" strokeOpacity="0.5" strokeWidth="1.5" />
        <path d="M800 250 V610" stroke="currentColor" strokeOpacity="0.5" strokeWidth="1.5" />
      </svg>
    </div>
  );
}
