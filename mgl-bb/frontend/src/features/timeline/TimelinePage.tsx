/* ─────────────────────────────────────────────────────────────────────────
 * Төслийн хуваарь — портфолиогийн Gantt + эрсдэлийн жагсаалт
 * -------------------------------------------------------------------------
 * Нэг МӨР = нэг ТӨСӨЛ (даалгавар биш).  Хуудсанд ЗӨВХӨН Gantt график байна.
 *
 * 2026-08-ны цэгцлэлт: «Анхаарах жагсаалт» болон «Хуваарьгүй жагсаалт» хоёр
 * УСТГАГДСАН.  Хоёулаа чартын ДООР давхардсан мэдээлэл харуулж (ижил төсөл,
 * ижил эрсдэлийн чип, ижил Schedule/Nudge товч) хуудсыг гурав дахин уртасгаж
 * байв.  Тэдний ганц өвөрмөц үүрэг — хуваарь тавих / сануулга илгээх — одоо
 * чартын МӨР ДЭЭР шууд байна (`GanttRow`-ийн үйлдлийн бөөгнөрөл), тул
 * жагсаалтууд зөвхөн уртыг нэмж байсан.
 *
 * Эрэмбэ: ХУВААРЬГҮЙ нь ҮРГЭЛЖ хамгийн доор (баар зурагдахгүй тул чартын
 * дунд хоосон мөр болж бодит бааруудыг доош түлхэж байсан) → эрсдэлийн зэрэг
 * → ASAP → дуусах огноо (хоосон нь сүүлд) → нэр.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * 2026-08-13: ЭНЭ ХУУДАС НЬ ЭЦСИЙН ХУГАЦААНЫ ЦОРЫН ГАНЦ ХӨНДЛӨН ГАДАРГУУ.
 * ═════════════════════════════════════════════════════════════════════════
 * `/app/deadlines` (тусдаа «Хугацаа» хуудас) УСТСАН.  Түүний үүрэг —
 * хугацаа үүсгэх / засах / устгах / чагтлах — одоо мөрийн ДЭЛГЭРЭНГҮЙ
 * САМБАРТ (`ProjectDetailPanel`) бөгөөд тэр нь `MilestoneManager`-ийг
 * хэвээр нь дахин ашиглана.  Толгойн «+» товч нь төсөл сонгох шаттай
 * `MilestoneDialog`-ыг нээнэ (хуучин хуудасны цонх).
 *
 * ХАНДАХ ЭРХ (backend нь жинхэнэ гэрч, энэ нь зөвхөн UX):
 *   УНШИХ — admin · senior · engineer · architect.  Ажилтан өөрийн ажлын
 *           хугацааг хаанаас ч харахгүй болохоос сэргийлж хуудсыг нээв.
 *   БИЧИХ — ЗӨВХӨН admin.  Дүрийн жагсаалтыг ЭНД дахин бичихгүй: сервер
 *           `can_edit` тугийг өөрөө буцаана (`GET /api/timeline`), учир нь
 *           бичих замууд `requireAdmin()`-ээр хаалттай бөгөөд хоёр газар
 *           жагсаалт бичвэл нэг өдөр зөрнө.
 * ───────────────────────────────────────────────────────────────────────── */
import { useCallback, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CalendarRange, Handshake, Lock, Plus } from 'lucide-react';

import { useLanguage } from '@/shared/i18n';
import { useAuth } from '@/shared/context/AuthContext';
import { apiFetch } from '@/shared/api/client';
import { toast } from '@/shared/components/Toast';
import { PageContainer } from '@/shared/components/PageContainer';
import { PageHeader } from '@/shared/components/PageHeader';
import { Button } from '@/ui/button';
import { Card, CardContent } from '@/ui/card';
import { Skeleton } from '@/ui/skeleton';

import type { TimelineProject } from './types';
// Шууд файлаас — barrel нь DeadlineList зэрэг хүнд компонентуудыг
// дагуулж хуваарийн chunk-д оруулна.
import { useDeadlineSummary } from '@/features/deadlines/api';
import { MilestoneDialog } from '@/features/deadlines/MilestoneDialog';
import type { DeadlinePoint } from '@/features/deadlines/types';
import { TIMELINE_KEY, useTimeline } from './api';
import { ATTENTION_STATES, riskRank } from './lib/riskDisplay';
import { ZOOM_PRESETS, clampPxPerDay } from './lib/timeScale';
import { GanttChart } from './components/GanttChart';
import { ProjectDetailPanel } from './components/ProjectDetailPanel';
import { ScheduleDialog } from './components/ScheduleDialog';
// Шууд файлаас — barrel нь хугацааны хүнд компонентуудыг дагуулна.
import { ExtensionDialog } from '@/features/deadlines/ExtensionDialog';
import { NudgeDialog } from './components/NudgeDialog';
import { AddPendingDialog } from './components/AddPendingDialog';
import { TimelineToolbar, type StateFilter } from './components/TimelineToolbar';

/** Хуудсыг УНШИХ эрхтэй дүрүүд.  `client` нь өөрийн shell-тэй тул ороогүй;
 *  `worker` нь `lib/workerScope.ts`-ийн allowlist-д `timeline` байхгүй тул
 *  API түвшинд 403 авна (энд бас хаачихвал хоёр давхар).  Backend-ийн
 *  `requireRole('admin','senior','engineer','architect')`-тай ИЖИЛ. */
const VIEW_ROLES = ['admin', 'senior', 'engineer', 'architect'] as const;

export default function TimelinePage() {
  const { t } = useLanguage();
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  // Өөрөө хаалт тавина — backend нь жинхэнэ гэрч.
  const allowed = (VIEW_ROLES as readonly string[]).includes(user?.role ?? '');
  const timelineQuery = useTimeline(allowed);

  // Томруулалт нь ҮРГЭЛЖИЛСЭН (px/хоног).  Анхны утга нь хуучин «Сар»
  // түвшин — портфолиогийн ерөнхий зураг харагдах нягтрал.
  const [pxPerDay, setPxPerDay] = useState<number>(ZOOM_PRESETS.month);
  const [stateFilter, setStateFilter] = useState<StateFilter>('all');
  const [search, setSearch] = useState('');
  const [scrollToTodayToken, setScrollToTodayToken] = useState(0);
  const [scheduleTarget, setScheduleTarget] = useState<TimelineProject | null>(null);
  /** «Хуваарь» цонхноос хойшлуулсан огноог сунгалт болгож бүртгэх (0337). */
  const [extendTarget, setExtendTarget] = useState<{ project: TimelineProject; date: string } | null>(null);
  const [nudgeTarget, setNudgeTarget] = useState<TimelineProject | null>(null);
  const [addPendingOpen, setAddPendingOpen] = useState(false);
  /** Дэлгэрэнгүй самбарын бай — `null` = хаалттай. */
  const [detailTarget, setDetailTarget] = useState<TimelineProject | null>(null);
  /** Толгойн «+ Эцсийн хугацаа» цонх (төсөл сонгох шаттай). */
  const [milestoneOpen, setMilestoneOpen] = useState(false);

  const data = timelineQuery.data;
  const projects = useMemo(() => data?.projects ?? [], [data]);

  /** Бичих эрх — СЕРВЕР шийдсэн (`admin`).  Хариу ирэхээс өмнө `false` тул
   *  ачаалж байх зуур засварын товч анивчиж гарч ирэхгүй. */
  const canEdit = data?.can_edit === true;

  // Гантт болон chip-үүд ЗӨВХӨН эрсдэлийн өнгөөр ярина — багийн шүүлт,
  // багийн өнгө 2026-08-д хасагдсан (нэг хуудсанд хоёр өнгөний хэл байсныг
  // хэрэглэгч төөрөгдөл гэж мэдээлсэн).
  const filtered = useMemo(() => {
    let list = projects.slice();

    if (stateFilter === 'attention') {
      list = list.filter((project) => ATTENTION_STATES.includes(project.risk_state));
    } else if (stateFilter !== 'all') {
      list = list.filter((project) => project.risk_state === stateFilter);
    }
    const query = search.trim().toLowerCase();
    if (query) {
      list = list.filter(
        (project) =>
          project.name.toLowerCase().includes(query) ||
          (project.display_title ?? '').toLowerCase().includes(query),
      );
    }

    list.sort((a, b) => {
      // Хуваарьгүй нь ҮРГЭЛЖ хамгийн доор — `riskRank`-ийг өөрчилсөнгүй,
      // тэр нь backend-ийн RISK_ORDER-тэй ижил байх ёстой (шүүлтүүрийн
      // жагсаалтын дараалал ч түүнээс гардаг).
      const byUnscheduled =
        (a.risk_state === 'unscheduled' ? 1 : 0) - (b.risk_state === 'unscheduled' ? 1 : 0);
      if (byUnscheduled !== 0) return byUnscheduled;
      const byRisk = riskRank(a.risk_state) - riskRank(b.risk_state);
      if (byRisk !== 0) return byRisk;
      const byAsap = (b.is_asap ? 1 : 0) - (a.is_asap ? 1 : 0);
      if (byAsap !== 0) return byAsap;
      // Дуусах огноо өсөхөөр; хоосон нь ҮРГЭЛЖ сүүлд (ISO мөр нь
      // лексикографоор зөв эрэмбэлэгддэг).
      if (a.finish_date && b.finish_date) {
        if (a.finish_date !== b.finish_date) return a.finish_date < b.finish_date ? -1 : 1;
      } else if (a.finish_date) {
        return -1;
      } else if (b.finish_date) {
        return 1;
      }
      return a.name.localeCompare(b.name);
    });

    return list;
  }, [projects, stateFilter, search]);

  // ── Хугацааны цэгүүд (project_milestones) ─────────────────────────
  // `/api/timeline`-ын хариуг ӨРГӨТГӨӨГҮЙ, тусдаа хүсэлтээр авна:
  //   · хуваарь нь хугацаа ачаалагдахыг ХҮЛЭЭХГҮЙ (баарууд шууд гарна,
  //     цэгүүд бэлэн болмогц дээр нь нэмэгдэнэ),
  //   · төслийн жагсаалтын chip-тэй ИЖИЛ кэшийг хуваалцана
  //     (`deadlineSummaryKey` нь id-уудаар түлхүүрлэгддэг).
  //
  // ⚠️ `filtered` БИШ `projects`-оос id авна: шүүлтүүр солих бүрд түлхүүр
  //    өөрчлөгдвөл кэш алдагдаж шинэ хүсэлт явна.  Бүх төслийн цэгийг нэг
  //    удаа татаад шүүлтийг харагдац дээр л хийнэ.
  const projectIds = useMemo(() => projects.map((p) => p.id), [projects]);
  const deadlineSummaryQuery = useDeadlineSummary(projectIds);
  const deadlinePoints = useMemo(() => {
    const map = new Map<number, DeadlinePoint[]>();
    for (const s of deadlineSummaryQuery.data?.items ?? []) map.set(s.project_id, s.points);
    return map;
  }, [deadlineSummaryQuery.data]);

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: TIMELINE_KEY });
  };

  /** «Гэрээ хэлэлцээрийн шатанд» тэмдгийг сэлгэнэ (admin).
   *
   *  Optimistic шинэчлэлт хийхгүй — сэлгэлт ховор бөгөөд Timeline-ийн хариу
   *  нь эрсдэлийн төлөв зэрэг серверт бодогддог талбартай тул хагас
   *  шинэчилсэн кэш төөрөгдүүлнэ.  Хариу ирмэгц бүтнээр нь дахин татна. */
  const togglePending = useCallback(
    (p: TimelineProject) => {
      void apiFetch(`/projects/${p.id}/pending`, {
        method: 'PATCH',
        data: { is_pending: p.is_pending !== 1 },
      })
        .then(() => queryClient.invalidateQueries({ queryKey: TIMELINE_KEY }))
        .catch(() => toast.error(t('timelinePage.pendingFailed')));
    },
    [queryClient, t],
  );

  /** Гэрээний шатны САНУУЛГА төслийг ЗӨВХӨН нэрээр үүсгэнэ.
   *
   *  `POST /projects` нь `name`-ээс өөр юу ч шаарддаггүй — нарийн төвөгтэй
   *  байдал, ангилал, байршил зэрэг бүх талбар серверийн анхдагчаар
   *  бөглөгдөнө.  Ийм төсөл `is_pending = 1`-тэй үүсэх тул инженер,
   *  архитектор, харилцагчийн жагсаалтад ОГТ гарахгүй.
   *
   *  Гэрээ байгуулагдвал мөрний 🤝 товчоор тэмдгийг арилгахад ердийн төсөл
   *  болно — өгөгдөл нь аль хэдийн байрандаа байгаа тул дахин үүсгэх
   *  шаардлагагүй. */
  const createPending = useCallback(
    async (name: string) => {
      try {
        await apiFetch('/projects', { method: 'POST', data: { name, is_pending: true } });
        await queryClient.invalidateQueries({ queryKey: TIMELINE_KEY });
        toast.success(t('timelinePage.addPendingDone'));
      } catch {
        toast.error(t('timelinePage.addPendingFailed'));
      }
    },
    [queryClient, t],
  );

  // Нягтралыг өөрчлөх ЦОРЫН ГАНЦ хаалга — toolbar-ийн товч ч, чартын дээрх
  // Ctrl + дугуй ч энд ирнэ, тул clamp нэг л газар байна.  Иш нь тогтвортой
  // байх ёстой (GanttChart нь wheel listener-ээ энэ дээр бүртгэдэг).
  const handlePxPerDayChange = useCallback((next: number) => {
    setPxPerDay(clampPxPerDay(next));
  }, []);

  const openProject = (projectId: number) => navigate(`/app/projects/${projectId}`);
  const openSchedule = (project: TimelineProject) => setScheduleTarget(project);
  const openNudge = (project: TimelineProject) => setNudgeTarget(project);
  const openDetails = useCallback((project: TimelineProject) => setDetailTarget(project), []);

  /** Самбарт үзүүлэх мөрийг ҮРГЭЛЖ ШИНЭ жагсаалтаас олно.
   *
   *  `detailTarget` нь дарсан агшны хуулбар — хуваарь хадгалах, гэрээний
   *  шат сэлгэх зэрэг үйлдлийн дараа `TIMELINE_KEY` дахин татагдахад тэр
   *  хуулбар хуучирна.  Id-гаар нь дахин олбол самбар шинэ огноо, шинэ
   *  эрсдэлийн төлвөө шууд харуулна.  Жагсаалтаас алга болсон (архивласан)
   *  тохиолдолд хуучин хуулбар руу эвтэйхэн унана. */
  const detailProject = useMemo(
    () => (detailTarget ? (projects.find((p) => p.id === detailTarget.id) ?? detailTarget) : null),
    [detailTarget, projects],
  );

  /* ── Эрхгүй хэрэглэгч ── */
  if (!allowed) {
    return (
      <PageContainer>
        <Card className="border border-border bg-card/60">
          <CardContent className="flex flex-col items-center justify-center gap-3 py-16 text-center">
            <Lock className="h-10 w-10 text-muted-foreground/50" />
            <p className="text-body text-muted-foreground">{t('timelinePage.forbidden')}</p>
          </CardContent>
        </Card>
      </PageContainer>
    );
  }

  const isLoading = timelineQuery.isPending;
  const isError = timelineQuery.isError;

  return (
    <PageContainer>
      {/* ── Толгой ── (шүүлтийн үр дүнгийн тоо нь toolbar дээр, шүүлтүүрийн хажууд).
             Гараар бичсэн `<h1>`-ийн оронд `PageHeader` — аппын «хуудсанд ЯГ
             нэг h1» хэвшил + `text-title`/`text-body` шатлал эндээс гарна. */}
      <PageHeader
        icon={CalendarRange}
        title={t('timelinePage.title')}
        description={t('timelinePage.subtitle')}
        actions={
          canEdit ? (
            <div className="flex flex-wrap items-center gap-2">
              {/* «Хугацаа» хуудас устсаны дараа хугацаа ҮҮСГЭХ хөндлөн зам
                  энэ товч болсон — самбар нээхгүйгээр аль ч төсөл дээр
                  нэмнэ (цонх нь төсөл сонгох шаттай). */}
              <Button size="sm" onClick={() => setMilestoneOpen(true)}>
                <Plus aria-hidden className="mr-1.5 size-4" />
                {t('deadlines.addMilestone')}
              </Button>
              <Button size="sm" variant="outline" onClick={() => setAddPendingOpen(true)}>
                <Handshake aria-hidden className="mr-1.5 size-4" />
                {t('timelinePage.addPendingButton')}
              </Button>
            </div>
          ) : undefined
        }
      />

      {isError ? (
        <Card className="border border-danger/30 bg-card/60">
          <CardContent className="flex flex-col items-center justify-center gap-3 py-16 text-center">
            <AlertTriangle className="h-10 w-10 text-danger/40" />
            <p className="text-body font-medium text-foreground">{t('timelinePage.loadError')}</p>
            <Button variant="outline" size="sm" onClick={() => void timelineQuery.refetch()}>
              {t('timelinePage.retry')}
            </Button>
          </CardContent>
        </Card>
      ) : isLoading ? (
        <div className="space-y-4">
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="hidden h-72 w-full lg:block" />
          <Skeleton className="h-32 w-full" />
        </div>
      ) : projects.length === 0 ? (
        <Card className="border border-border bg-card/60">
          <CardContent className="flex flex-col items-center justify-center gap-2 py-16 text-center">
            <CalendarRange className="h-10 w-10 text-muted-foreground/40" />
            <p className="text-body text-muted-foreground">{t('timelinePage.empty')}</p>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* ── 1. Хяналтын мөр ──
                `sec-timeline-*` id-нууд нь глобал хайлтын гүн холбоосын бай
                (`?section=<id>`) — `shared/lib/search/sections.ts`-тэй ижил байлгана. */}
          <div id="sec-timeline-toolbar" className="scroll-mt-24">
            <TimelineToolbar
              pxPerDay={pxPerDay}
              onPxPerDayChange={handlePxPerDayChange}
              stateFilter={stateFilter}
              onStateFilterChange={setStateFilter}
              search={search}
              onSearchChange={setSearch}
              onToday={() => setScrollToTodayToken((token) => token + 1)}
              projectCount={filtered.length}
            />
          </div>

          {filtered.length === 0 ? (
            <Card className="border border-border bg-card/60">
              <CardContent className="py-12 text-center text-body text-muted-foreground">
                {t('timelinePage.noMatches')}
              </CardContent>
            </Card>
          ) : (
            /* ── 2. Gantt — БҮХ дэлгэц дээр.  Утсанд хөндлөн гүйлгэж хардаг
                  (чирэх удирдлага аль хэдийн pointer-event дээр бичигдсэн);
                  өмнө нь `hidden lg:block` байсан ба Анхаарах жагсаалт нь
                  утасны хуудас болдог байв — тэр жагсаалт устсан тул чартыг
                  нуувал утсанд хоосон хуудас үлдэнэ. ── */
            <Card
              id="sec-timeline-gantt"
              className="overflow-hidden border border-border bg-card/60 scroll-mt-24"
            >
              <CardContent className="px-0">
                <GanttChart
                  projects={filtered}
                  canEdit={canEdit}
                  deadlinePoints={deadlinePoints}
                  today={data?.today ?? ''}
                  pxPerDay={pxPerDay}
                  onPxPerDayChange={handlePxPerDayChange}
                  onOpenProject={openProject}
                  onOpenDetails={openDetails}
                  onSchedule={openSchedule}
                  onNudge={openNudge}
                  onTogglePending={canEdit ? togglePending : undefined}
                  scrollToTodayToken={scrollToTodayToken}
                />
              </CardContent>
            </Card>
          )}

          <p className="text-micro text-muted-foreground">{t('timelinePage.calendarDaysNote')}</p>
        </>
      )}

      {/* ── Мөрийн дэлгэрэнгүй самбар ──
             Төслийн мэдээлэл (жагсаалтын карттай ижил) + тухайн төслийн
             эцсийн хугацааны БҮРЭН CRUD.  Эрхгүй уншигчид зөвхөн харна. */}
      <ProjectDetailPanel
        project={detailProject}
        canEdit={canEdit}
        onOpenChange={(open) => {
          if (!open) setDetailTarget(null);
        }}
        onSchedule={openSchedule}
        onNudge={openNudge}
        onTogglePending={togglePending}
      />

      <ScheduleDialog
        project={scheduleTarget}
        onOpenChange={(open) => {
          if (!open) setScheduleTarget(null);
        }}
        onSaved={refresh}
        onExtend={(project, date) => setExtendTarget({ project, date })}
      />
      <ExtensionDialog
        open={extendTarget !== null}
        onOpenChange={(open) => {
          if (!open) setExtendTarget(null);
        }}
        projectId={extendTarget?.project.id ?? 0}
        projectTitle={extendTarget ? extendTarget.project.display_title?.trim() || extendTarget.project.name : ''}
        currentFinishDate={extendTarget?.project.finish_date ?? null}
        extensionCount={extendTarget?.project.extension_count ?? 0}
        initialDate={extendTarget?.date ?? null}
        onSaved={refresh}
      />
      <NudgeDialog
        project={nudgeTarget}
        onOpenChange={(open) => {
          if (!open) setNudgeTarget(null);
        }}
        onSent={refresh}
      />
      {canEdit && (
        <>
          <AddPendingDialog
            open={addPendingOpen}
            onOpenChange={setAddPendingOpen}
            onSubmit={createPending}
          />
          {/* Хуучин «Хугацаа» хуудсын үүсгэх цонх — төсөл сонгох шаттай.
              Хадгалсны дараа `invalidateDeadlines()` нь баарны тэмдэглэгээ
              (`/deadlines/summary`) болон нээлттэй самбарын жагсаалтыг
              хоёуланг нь шинэчилнэ. */}
          <MilestoneDialog open={milestoneOpen} onOpenChange={setMilestoneOpen} />
        </>
      )}
    </PageContainer>
  );
}
