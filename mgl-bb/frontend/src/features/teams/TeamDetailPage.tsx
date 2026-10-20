import { lazy, Suspense, useCallback, useMemo, useState } from 'react';
import { useApiQuery } from '@/shared/api/useApi';
import { useQueryClient } from '@tanstack/react-query';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { apiFetch } from '@/shared/api/client';
import { useLanguage } from '@/shared/i18n';
import { EmptyState } from '@/shared/components/EmptyState';
import { useAuth } from '@/shared/context/AuthContext';
import type { TeamOverview } from '@/shared/types';
import { Button } from '@/ui/button';
import { Skeleton } from '@/ui/skeleton';
import { ArrowLeft, Building2, LayoutDashboard, Loader2, TrendingUp } from 'lucide-react';
import { cn } from '@/shared/lib/utils';
import { confirmDialog } from '@/shared/components/ConfirmDialog';
import { toast } from '@/shared/components/Toast';
import { AddTeamMembersDialog } from './components/AddTeamMembersDialog';
import { TeamHeaderBar } from './components/board/TeamHeaderBar';
import { ProjectsToday } from './components/board/ProjectsToday';
import { TeamRoster } from './components/board/TeamRoster';
import { RecentProgress } from './components/board/RecentProgress';
import type { BoardFocus } from './components/board/boardFocus';
import { indexDayWork, type DayWorkPayload } from './lib/currentWork';
import { buildTeamBoard } from './lib/teamBoard';
import { seesAllTeams } from './lib/teamAccess';

/** «Бүтээмж» харагдац — recharts-тай тул зөвхөн харах эрхтэй хүнд ачаална. */
const ProductivityTab = lazy(() =>
  import('./productivity/ProductivityTab').then((m) => ({ default: m.ProductivityTab })),
);

/** `/teams/:id/overview` + өнөөдрийн төслийн бус ажил / засварын цаг (backend
 *  `lib/teamDayWorkStore.ts` — `/teams/allocation`-тэй ижил хэлбэр). */
type TeamOverviewWithWork = TeamOverview & { day_work?: DayWorkPayload };

/**
 * Багийн дэлгэрэнгүй — «нэг дэлгэцийн самбар» (2026-09-30 бүрэн дахин зохиов).
 *
 * Өмнөх хуудас: ~300px hero + 4 таб (Өнөөдөр / Бүтээмж / Төсөл / Гишүүд).  Хэн аль
 * төсөл дээр ажиллаж байгааг харахад доош гүйлгэж, табаар сэлгэх хэрэгтэй байв
 * (1440×900 дээр 1200px өндөртэй, гишүүд нь өөр таб).  Одоо ТАБГҮЙ, дэлгэц дүүрэн:
 *
 *   ┌ толгой: баг + өнөөдөр ажиллаж буй · төсөл · ажлын задаргаа · дундаж явц ┐
 *   ├ ТӨСӨЛ БҮР НЭГ МӨР: явц, хоцролт │ өнөөдөр хэн ажиллаж байна ┬ ГИШҮҮД ┤
 *   └ сүүлийн үйл ажиллагаа (тогтмол туузан) ─────────────────────┴ (бүгд) ┘
 *
 * Хуудас өөрөө гүйлгэгдэхгүй (`Layout` full-bleed) — олон төсөлтэй/гишүүнтэй
 * баг л зөвхөн ӨӨРИЙН хайрцагт гүйлгэгдэнэ.  Самбар ↔ жагсаалт хоёр талдаа
 * онцлогддог (`BoardFocus`).  «Бүтээмж» нь хуучин табын оронд харагдацын сэлгүүр
 * (`?view=productivity`, хуучин `?tab=productivity` холбоос ч хэвээр).
 * Багийн гишүүдээс өөр хэн ч энд орохгүй — хаалт `TeamDetailRoute` + сервер.
 */
export default function TeamDetailPage() {
  const { t } = useLanguage();
  const { id } = useParams<{ id: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const { user } = useAuth();
  const isAdmin = seesAllTeams(user?.role);
  const queryClient = useQueryClient();
  const overviewKey = useMemo(() => ['/teams/overview', id] as const, [id]);
  const overviewQuery = useApiQuery<TeamOverviewWithWork>(overviewKey, `/teams/${id}/overview`, {
    enabled: !!id,
  });
  const data = overviewQuery.data ?? null;

  // Өнөөдрийн төслийн бус ажил + засварын цаг — Багууд хуудастай ижил хэлбэр.
  const dayWork = useMemo(() => indexDayWork(data?.day_work), [data?.day_work]);
  // Толгой, төслийн мөр, гишүүдийн жагсаалт ГУРВУУЛАА НЭГ тооллого ашиглана.
  const board = useMemo(
    () => buildTeamBoard(data?.members ?? [], data?.projects ?? [], dayWork),
    [data?.members, data?.projects, dayWork],
  );

  const [focus, setFocus] = useState<BoardFocus>(null);

  // `?add=1` (жагсаалтаас шууд «гишүүн нэмэх») — dialog нээлттэй, хаахад параметрыг арилгана.
  const [addOpen, setAddOpen] = useState(false);
  const addParam = isAdmin && searchParams.get('add') === '1';
  const dialogOpen = addOpen || addParam;
  const setDialogOpen = useCallback(
    (next: boolean) => {
      setAddOpen(next);
      if (!next && searchParams.get('add') === '1') {
        const params = new URLSearchParams(searchParams);
        params.delete('add');
        setSearchParams(params, { replace: true });
      }
    },
    [searchParams, setSearchParams],
  );

  const reload = useCallback(async () => {
    if (!id) return;
    await queryClient.invalidateQueries({ queryKey: overviewKey });
  }, [id, queryClient, overviewKey]);

  // «Бүтээмж» харагдацыг хэн харах вэ (эзний шийдвэр 2026-09-24): захирал (admin)
  // бүх баг; багийн ахлах өөрийн баг; ахлах тохируулаагүй багт тухайн баг
  // үндсэн баг нь болох senior-ууд.  Сервер (`lib/teamProductivityStore.ts`
  // `loadTeamAccess`) ижил дүрмээр 403 өгдөг — энэ нь зөвхөн UX.
  const canSeeProductivity =
    !!user &&
    !!data &&
    (user.role === 'admin' ||
      (user.role === 'senior' &&
        (data.team.lead_user_id === user.id ||
          (data.team.lead_user_id == null && data.members.some((m) => m.id === user.id)))));

  // Харагдац URL-ээс (deep-link, буцах товч зөв ажиллана).  `?tab=productivity`
  // нь ахлах руу очих мэдэгдлийн холбоос (хуучин таб) — тэр хэвээр ажиллана.
  const wantsProductivity =
    searchParams.get('view') === 'productivity' || searchParams.get('tab') === 'productivity';
  const view: 'board' | 'productivity' = wantsProductivity && canSeeProductivity ? 'productivity' : 'board';
  const setView = useCallback(
    (next: 'board' | 'productivity') => {
      const params = new URLSearchParams(searchParams);
      params.delete('tab');
      if (next === 'productivity') params.set('view', 'productivity');
      else params.delete('view');
      setSearchParams(params, { replace: true });
    },
    [searchParams, setSearchParams],
  );

  const removeMember = useCallback(
    async (userId: number, name?: string) => {
      if (!id) return;
      if (!(await confirmDialog({ description: t('teamDetailPage.removeMemberConfirm'), variant: 'destructive' }))) return;
      try {
        await apiFetch(`/teams/${id}/members/${userId}`, { method: 'DELETE' });
        await reload();
        toast.success(
          t('teamDetailPage.memberRemoved'),
          name ? t('teamDetailPage.memberRemovedDetail', { name }) : undefined,
        );
      } catch (err) {
        console.error(err);
        toast.error(t('teamDetailPage.removeFailed'), err instanceof Error ? err.message : undefined);
      }
    },
    [id, reload, t],
  );

  // Багийн баталгаажуулагчийг тохируулах / цуцлах.  Backend нэр дэвшигч нь энэ
  // багийн senior гишүүн эсэхийг шалгана; 400 бол toast-оор гарна.
  const setLead = useCallback(
    async (userId: number | null, name?: string) => {
      if (!id) return;
      try {
        await apiFetch(`/teams/${id}`, { method: 'PUT', data: { lead_user_id: userId } });
        await reload();
        toast.success(
          userId ? t('teamDetailPage.leadSet') : t('teamDetailPage.leadCleared'),
          userId && name ? t('teamDetailPage.leadSetDetail', { name }) : undefined,
        );
      } catch (err) {
        toast.error(t('common.saveFailed'), err instanceof Error ? err.message : undefined);
      }
    },
    [id, reload, t],
  );

  if (overviewQuery.isLoading) return <TeamPageSkeleton />;

  if (!data) {
    return (
      <div className="mx-auto w-full max-w-2xl py-16">
        <EmptyState
          icon={Building2}
          title={t('teamDetailPage.teamNotFound')}
          action={
            <Button asChild variant="outline" size="sm" className="gap-1.5">
              <Link to="/app/teams">
                <ArrowLeft className="size-4" /> {t('common.back')}
              </Link>
            </Button>
          }
        />
      </div>
    );
  }

  const hrefOf = (uid: number) => (uid === user?.id ? '/app/profile' : `/app/users/${uid}`);
  const canSeeArchive = user?.role === 'admin';

  const addAction =
    isAdmin && id ? (
      <AddTeamMembersDialog
        teamId={Number(id)}
        teamName={data.team.name_mn}
        existingMemberIds={new Set(data.members.map((m) => m.id))}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onAdded={reload}
      />
    ) : null;

  return (
    <div
      className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 py-3 motion-safe:animate-in motion-safe:fade-in-0 duration-300 lg:overflow-hidden lg:px-6 lg:py-4"
      data-testid="team-detail"
    >
      <TeamHeaderBar
        data={data}
        activeToday={board.activeCount}
        leading={
          isAdmin ? (
            <Button
              asChild
              variant="ghost"
              size="icon-sm"
              className="relative -ml-1.5 shrink-0 text-muted-foreground"
            >
              <Link to="/app/teams" aria-label={t('teamDetailPage.teams')} title={t('teamDetailPage.teams')}>
                <ArrowLeft />
              </Link>
            </Button>
          ) : null
        }
        trailing={
          canSeeProductivity ? (
            <div
              className="relative inline-flex shrink-0 gap-0.5 rounded-lg bg-muted p-0.5"
              role="group"
              aria-label={t('teamBoard.viewLabel')}
            >
              {(
                [
                  { key: 'board', label: t('teamBoard.viewBoard'), icon: LayoutDashboard },
                  { key: 'productivity', label: t('teamProductivity.tabTitle'), icon: TrendingUp },
                ] as const
              ).map((v) => (
                <Button
                  key={v.key}
                  type="button"
                  size="sm"
                  variant="ghost"
                  title={v.label}
                  aria-label={v.label}
                  aria-pressed={view === v.key}
                  data-testid={`team-view-${v.key}`}
                  onClick={() => setView(v.key)}
                  className={cn(
                    'h-7 gap-1.5 px-2 text-micro font-medium pointer-coarse:h-9',
                    view === v.key
                      ? 'bg-background text-foreground shadow-sm hover:bg-background'
                      : 'text-muted-foreground',
                  )}
                >
                  <v.icon className="size-3.5" aria-hidden />
                  <span className="hidden 2xl:inline">{v.label}</span>
                </Button>
              ))}
            </div>
          ) : null
        }
      />

      {view === 'productivity' && id ? (
        <div className="min-h-0 lg:flex-1 lg:overflow-y-auto">
          <Suspense
            fallback={
              <div className="flex justify-center py-16">
                <Loader2 className="h-6 w-6 animate-spin text-primary" />
              </div>
            }
          >
            <ProductivityTab teamId={Number(id)} />
          </Suspense>
        </div>
      ) : (
        <div className="flex flex-col gap-3 lg:min-h-0 lg:flex-1 lg:flex-row">
          <div className="flex flex-col gap-3 lg:min-h-0 lg:min-w-0 lg:flex-1">
            <ProjectsToday
              board={board}
              total={data.members.length}
              dayWork={dayWork}
              hrefOf={hrefOf}
              focus={focus}
              onFocus={setFocus}
              canSeeArchive={canSeeArchive}
            />
            <RecentProgress items={data.recent_progress} hrefOf={hrefOf} focus={focus} onFocus={setFocus} />
          </div>
          <TeamRoster
            data={data}
            board={board}
            hrefOf={hrefOf}
            focus={focus}
            onFocus={setFocus}
            isAdmin={isAdmin}
            onSetLead={(uid, name) => void setLead(uid, name)}
            onRemove={(uid, name) => void removeMember(uid, name)}
            addAction={addAction}
            onAddFirst={() => setDialogOpen(true)}
          />
        </div>
      )}
    </div>
  );
}

/** Ачаалж байх үеийн араг яс — хуудасны бодит бүтэцтэй ижил тул агуулга үсрэхгүй. */
function TeamPageSkeleton() {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden px-4 py-3 lg:px-6 lg:py-4">
      <Skeleton className="h-5 w-40 shrink-0" />
      <Skeleton className="h-[4.75rem] w-full shrink-0 rounded-xl" />
      <div className="flex min-h-0 flex-1 flex-col gap-3 lg:flex-row">
        <div className="flex min-h-0 flex-1 flex-col gap-3">
          <Skeleton className="min-h-[16rem] flex-1 rounded-xl" />
          <Skeleton className="h-28 shrink-0 rounded-xl" />
        </div>
        <Skeleton className="min-h-[16rem] rounded-xl lg:w-[23rem] lg:shrink-0" />
      </div>
    </div>
  );
}
