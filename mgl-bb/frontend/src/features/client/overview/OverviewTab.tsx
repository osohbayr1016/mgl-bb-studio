/**
 * 01 — Тойм.  Захиалагчийн хамгийн эхний асуулт «төсөл маань хаана явж
 * байна вэ?»-д нэг дэлгэцээр хариулна: нэр + зураг + нийт гүйцэтгэл +
 * хугацаа → гол тоо → хүлээгдэж буй үйлдэл → мэргэжлийн хэсгүүд + сүүлийн
 * шинэчлэлт → шинэ материал.  Дэлгэрэнгүй мод («Явц») тусдаа хэсэгт.
 */
import type { CorrespondenceEntry } from '@/shared/types';

import type { ClientDashboardTab, OverviewResponse } from '../client-dashboard.types';
import type { ClientEvent, ClientPortalProject } from '../portalApi';
import { ErrorState, SkeletonBar } from '../components/primitives';
import { ActivityJournal } from './ActivityJournal';
import { LatestMaterials } from './LatestMaterials';
import { AttentionPanel, DisciplineLedger, KeyFigures } from './OverviewSections';
import { HeroHeading, ProjectHero } from './ProjectHero';

export function OverviewTab({
  project,
  overview,
  loading,
  error,
  retrying,
  onRetry,
  events,
  live,
  signatures,
  onNavigate,
}: {
  project: ClientPortalProject;
  overview: OverviewResponse | null;
  loading: boolean;
  error: string | null;
  retrying: boolean;
  onRetry: () => void;
  events: ClientEvent[];
  live: boolean;
  signatures: CorrespondenceEntry[];
  onNavigate: (tab: ClientDashboardTab) => void;
}) {
  if (loading) return <OverviewSkeleton />;

  return (
    <div className="flex flex-col gap-16 md:gap-24">
      {overview ? (
        <>
          <ProjectHero project={project} overview={overview} />
          <KeyFigures overview={overview} />
        </>
      ) : (
        <section aria-labelledby="client-hero-title" className="flex flex-col gap-10 pt-10 md:pt-14">
          <div>
            <HeroHeading project={project} />
          </div>
          <ErrorState message={error} onRetry={onRetry} retrying={retrying} />
        </section>
      )}

      <AttentionPanel signatures={signatures} onNavigate={onNavigate} />

      <div className="grid gap-16 lg:grid-cols-12 lg:gap-12">
        <div className="lg:col-span-7">
          {overview ? (
            <DisciplineLedger
              disciplines={overview.disciplines}
              onMore={() => onNavigate('progress')}
            />
          ) : null}
        </div>
        <div className={overview ? 'lg:col-span-5' : 'lg:col-span-12'}>
          <ActivityJournal events={events} live={live} onNavigate={onNavigate} />
        </div>
      </div>

      <LatestMaterials projectId={project.id} onNavigate={onNavigate} />
    </div>
  );
}

function OverviewSkeleton() {
  return (
    <div aria-busy className="flex flex-col gap-10 pt-10 md:pt-14">
      <SkeletonBar className="h-4 w-48" />
      <SkeletonBar className="h-20 w-3/4 md:h-28" />
      <SkeletonBar className="h-4 w-72" />
      <div className="grid gap-px border border-foreground/10 lg:grid-cols-12">
        <SkeletonBar className="aspect-[16/10] lg:col-span-8" />
        <div className="flex flex-col gap-6 p-8 lg:col-span-4">
          <SkeletonBar className="h-3 w-32" />
          <SkeletonBar className="h-24 w-40" />
          <SkeletonBar className="h-1.5 w-full" />
        </div>
      </div>
    </div>
  );
}
