/**
 * Захиалагчийн портал — `/client` (2026-09-23-нд эхнээс нь дахин зохиосон).
 *
 * Дизайны хэл: том архитектурын товчооны вэбийн editorial хэв маяг —
 *   • төслийн нэр нь хуудасны ХАМГИЙН ТОМ бичвэр (Inter Tight 300),
 *   • 12 баганат тор, 1px шугам, хурц өнцөг, сүүдэргүй,
 *   • цаасан дэвсгэр + бэхэн бичвэр + ганц зэс өнгө (явц, шууд холболт),
 *   • дугаарласан хэсгүүд (01 Тойм … 08 3D загвар).
 *
 * Бүтэц: толгой (брэнд · төсөл солих · хэл · бүртгэл) → наалттай хэсгийн
 * навигаци → хэсэг → хөл.  Төсөл ба хэсэг нь URL-д (`?project=37&tab=materials`)
 * — хавчуулж, хуваалцаж, сэргээхэд буцаж ирнэ.
 *
 * `ProtectedRoute` нь `client` role-ийг энд барьж, ажилтныг `/app` руу
 * буцаадаг — энэ хуудас ажилтны `Layout`-аас ГАДУУР.
 */
import { useCallback, useRef, type ReactNode } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';

import { KeepAliveTabs, KeepAliveTabsPanel } from '@/ui/keep-alive-tabs';
import { useApiQuery } from '@/shared/api/useApi';
import { useAuth } from '@/shared/context/AuthContext';
import { useForceLightTheme } from '@/shared/hooks/useForceLightTheme';
import { useTabParam } from '@/shared/hooks/useTabParam';
import { INTER_TIGHT_HREF, useWebFont } from '@/shared/hooks/useWebFont';
import { brand } from '@/shared/config/brand';
import { useLanguage } from '@/shared/i18n';
import { cn } from '@/shared/lib/utils';
import type { CorrespondenceEntry } from '@/shared/types';

import { CLIENT_TABS, type ClientDashboardTab, type OverviewResponse } from './client-dashboard.types';
import type { ClientPortalProject } from './portalApi';
import { EmptyState, ErrorState, SkeletonBar } from './components/primitives';
import { useClientRealtime } from './hooks/useClientRealtime';
import { CLIENT_CONTAINER, CLIENT_HEADER_PX } from './lib/layout';
import { OverviewTab } from './overview/OverviewTab';
import { ProgressTab } from './progress/ProgressTab';
import { ClientFooter } from './shell/ClientFooter';
import { ClientHeader } from './shell/ClientHeader';
import { ClientSectionNav } from './shell/ClientSectionNav';
import { DocumentsTab } from './tabs/DocumentsTab';
import { InfoSection, MailSection, ModelSection } from './tabs/EmbeddedSections';
import { MaterialsTab } from './tabs/MaterialsTab';
import { SubmitTab } from './tabs/SubmitTab';

export default function ClientDashboardPage() {
  // ThemeProvider-ийн `dark` классыг энэ маршрутад ГЭРЭЛ болгоно (буцахад сэргээнэ).
  useForceLightTheme();
  useWebFont(INTER_TIGHT_HREF);

  const { t } = useLanguage();
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  // `/client/projects` — эрх нь байгууллагаар (`lib/clientAccess.ts`), материал
  // илгээх түвшинтэй хамт.
  const projectsQuery = useApiQuery<{ projects: ClientPortalProject[] }>('/client/projects');
  const projects = projectsQuery.data ? (projectsQuery.data.projects ?? []) : null;
  const requestedId = Number(searchParams.get('project'));
  const active = projects ? (projects.find((p) => p.id === requestedId) ?? projects[0] ?? null) : null;

  // Төсөл солиход хэсэг нь «Тойм» руу буцна (хуучин порталын зан төлөв).
  const selectProject = useCallback(
    (id: number) => {
      setSearchParams(() => new URLSearchParams({ project: String(id) }));
      window.scrollTo({ top: 0 });
    },
    [setSearchParams],
  );

  const handleLogout = async () => {
    await logout();
    navigate('/login', { replace: true });
  };

  let body: ReactNode;
  if (!projects) {
    body = projectsQuery.isError ? (
      <div className={cn(CLIENT_CONTAINER, 'pt-14')}>
        <ErrorState
          message={projectsQuery.error?.message}
          onRetry={() => void projectsQuery.refetch()}
          retrying={projectsQuery.isFetching}
        />
      </div>
    ) : (
      <PageSkeleton />
    );
  } else if (projects.length === 0 || !active) {
    const email = brand().contactEmail;
    body = (
      <div className={cn(CLIENT_CONTAINER, 'pt-14 md:pt-20')}>
        <EmptyState
          title={t('clientRoom.noProjectsTitle')}
          body={t('clientRoom.noProjectsBody')}
          action={
            email ? (
              <a
                href={`mailto:${email}`}
                className="font-mono text-label uppercase tracking-[0.14em] text-foreground underline underline-offset-4"
              >
                {email}
              </a>
            ) : null
          }
        />
      </div>
    );
  } else {
    body = <ClientProjectRoom key={active.id} project={active} />;
  }

  return (
    <div className="light client-dashboard-root flex min-h-screen flex-col bg-background font-sans text-foreground antialiased selection:bg-brand-copper/25">
      <a
        href="#client-main"
        className="sr-only z-50 bg-foreground px-4 py-2 text-background focus:not-sr-only focus:fixed focus:left-4 focus:top-4"
      >
        {t('clientRoom.skipToContent')}
      </a>
      <ClientHeader
        projects={projects}
        activeId={active?.id ?? null}
        onSelectProject={selectProject}
        userName={user?.full_name}
        userLogin={user?.username}
        onLogout={() => void handleLogout()}
      />
      <main id="client-main" className="flex-1">
        {body}
      </main>
      <ClientFooter />
    </div>
  );
}

/**
 * Нэг төслийн «өрөө» — `key={project.id}` тул төсөл солиход бүхэлдээ шинээр
 * mount хийгдэж, realtime сувгийн төлөв хоосноос эхэлнэ.
 */
function ClientProjectRoom({ project }: { project: ClientPortalProject }) {
  const [searchParams] = useSearchParams();
  const [tabParam, setTab] = useTabParam(CLIENT_TABS, 'overview');
  // Хуучин `?tab=report` холбоос → тайлан одоо «Материал» хэсэгт.
  const tab: ClientDashboardTab = searchParams.get('tab') === 'report' ? 'materials' : tabParam;
  const anchorRef = useRef<HTMLDivElement | null>(null);

  // WebSocket — өөрчлөлт гармагц холбогдох query-г л шинэчилнэ; тасарсан
  // хугацааных REST-ээр гүйцэж татагдана.
  const { connected: live, events } = useClientRealtime(project.id);

  const overviewQuery = useApiQuery<OverviewResponse>(
    ['/project-chat/projects/overview', project.id],
    `/project-chat/projects/${project.id}/overview`,
  );
  // Гарын үсэг хүлээж буй RFI/CR — «Таны анхаарал» + навигацын тоолуур.
  const correspondenceQuery = useApiQuery<{ entries: CorrespondenceEntry[]; can_sign?: boolean }>(
    ['/correspondence/projects', project.id],
    `/correspondence/projects/${project.id}`,
  );
  const signatures = correspondenceQuery.data?.can_sign
    ? correspondenceQuery.data.entries.filter((e) => e.sign_status === 'pending')
    : [];

  const goTo = useCallback(
    (next: ClientDashboardTab) => {
      setTab(next);
      // Доош гүйлгэсэн байхад хэсэг солигдвол шинэ хэсгийн ТОЛГОЙ руу.
      const el = anchorRef.current;
      if (el) {
        const top = el.getBoundingClientRect().top + window.scrollY - CLIENT_HEADER_PX;
        if (window.scrollY > top) window.scrollTo({ top });
      }
    },
    [setTab],
  );

  const overview = overviewQuery.data ?? null;
  const overviewProps = {
    overview,
    loading: overviewQuery.isLoading,
    error: overviewQuery.error?.message ?? null,
    retrying: overviewQuery.isFetching,
    onRetry: () => void overviewQuery.refetch(),
  };
  const canSubmit = project.access_level === 'contributor' || project.access_level === 'approver';

  return (
    <KeepAliveTabs
      value={tab}
      onValueChange={(v) => goTo(v as ClientDashboardTab)}
      className="gap-0"
    >
      <div ref={anchorRef} aria-hidden />
      <ClientSectionNav tab={tab} live={live} badges={{ mail: signatures.length }} />

      <div className={CLIENT_CONTAINER}>
        <KeepAliveTabsPanel value="overview">
          <OverviewTab
            project={project}
            {...overviewProps}
            events={events}
            live={live}
            signatures={signatures}
            onNavigate={goTo}
          />
        </KeepAliveTabsPanel>
        <KeepAliveTabsPanel value="progress">
          <ProgressTab {...overviewProps} />
        </KeepAliveTabsPanel>
        <KeepAliveTabsPanel value="materials">
          <MaterialsTab projectId={project.id} live={live} />
        </KeepAliveTabsPanel>
        <KeepAliveTabsPanel value="documents">
          {/* `active`: чирж тавих session нь document-түвшний тул зөвхөн энэ хэсэг ил байхад асна. */}
          <DocumentsTab projectId={project.id} active={tab === 'documents'} />
        </KeepAliveTabsPanel>
        <KeepAliveTabsPanel value="submit">
          <SubmitTab projectId={project.id} canSubmit={canSubmit} />
        </KeepAliveTabsPanel>
        <KeepAliveTabsPanel value="mail">
          <MailSection projectId={project.id} />
        </KeepAliveTabsPanel>
        <KeepAliveTabsPanel value="info">
          <InfoSection projectId={project.id} />
        </KeepAliveTabsPanel>
        <KeepAliveTabsPanel value="model">
          <ModelSection projectId={project.id} />
        </KeepAliveTabsPanel>
      </div>
    </KeepAliveTabs>
  );
}

function PageSkeleton() {
  return (
    <div aria-busy className={cn(CLIENT_CONTAINER, 'flex flex-col gap-10 pt-14')}>
      <SkeletonBar className="h-4 w-56" />
      <SkeletonBar className="h-24 w-2/3" />
      <SkeletonBar className="h-4 w-80" />
      <SkeletonBar className="aspect-[16/7] w-full" />
    </div>
  );
}
