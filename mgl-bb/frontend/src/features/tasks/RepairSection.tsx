import { useState, useMemo, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useLanguage } from '@/shared/i18n';
import { useAuth } from '@/shared/context/AuthContext';
import { apiFetch, ApiError } from '@/shared/api/client';
import { useApiQuery } from '@/shared/api/useApi';
import type {
  ProjectWithProgress,
  RepairEntry,
  RepairProject,
  RepairRateInfo,
} from '@/shared/types';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import { Textarea } from '@/ui/textarea';
import { Label } from '@/ui/label';
import { Card, CardContent } from '@/ui/card';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/ui/dialog';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/ui/select';
import {
  Wrench,
  Loader2,
  Plus,
  Trash2,
  Clock,
  Building2,
  ListChecks,
  X,
  History,
  AlertTriangle,
  Gauge,
} from 'lucide-react';
import { toast } from '@/shared/components/Toast';
import { confirmDialog } from '@/shared/components/ConfirmDialog';
import { formatDate } from '@/shared/lib/time';
import { formatPoints } from '@/shared/lib/score';

/**
 * Засвар (repair / extra work) хэсэг — my-tasks хуудсанд.
 *
 * ⚠️ 2026-10-08: «Засвар бүртгэх» цонх ХУУЧИН ЛОГИКТ буцсан (эзний хүсэлт) —
 * ажилтан төсөл + «Хийсэн засвар» тайлбар + цагаа өөрөө оруулж, өдрийн хувь /
 * авах хувийн урьдчилсан харалтыг харна (`POST /repair` `hours`-тэй = гар
 * бүртгэл, `hours_source='manual'`).  Доорх 0348-ын «Ажилласан» тэмдэглэгээ
 * зөвхөн My Tasks-ийн hours мөрийн товчинд үлдсэн.
 *
 * ЦАГИЙГ СИСТЕМ БОДНО (эзний шийдвэр 2026-09-25, миграц 0348).  Ажилтан
 * цаг БИЧИХГҮЙ — «өнөөдөр үүн дээр ажилласан» гэж л тэмдэглэнэ (`POST
 * /repair` = тэмдэглэгээ).  Сервер тухайн өдрийн бүх бөглөлтөөс цагийг
 * хуваарилна (backend lib/repairDay.ts): өдөр = ээлж − цай = 8 цаг, нэг
 * суултаар бөглөсөн бүх ажилд тэнцүү, өдрийн дундуур өөр ажлаа бөглөсөн бол
 * засвар тэр цагаас эхэлнэ.  Тиймээс нэг тэмдэглэгээний цаг ӨДРИЙН ТУРШ
 * ӨӨРЧЛӨГДӨЖ болно (2 дахь ажлаа тэмдэглэхэд 8 → 4) — түүх нь серверийн
 * одоогийн утгыг харуулна.  Оноо ба явц сервер дээр (30 хоногийн өдрийн дундаж
 * × цаг / 8) — ажилтанд хувь ХАРАГДАХГҮЙ, зөвхөн цаг (2026-09-24-ний шийдвэр).
 *
 * Түүхийн гурван төрөл (`hours_source`): 'manual' — 0348-аас өмнө гараар
 * бичсэн; 'auto' — тэмдэглэгээнээс; 'backfill' — засварын төсөл цагаар
 * шилжихээс өмнөх хувийн бөглөлтөөс систем нөхсөн (устгахгүй).  `kind:
 * 'mark'` = 0 цаг ногдсон тэмдэглэгээ (мөр нь байхгүй, id нь тэмдэглэгээнийх).
 *
 * Сонголт нь ХОЁР эх сурвалжтай (миграци 0194):
 *   • «Төсөл»       — жинхэнэ `projects` мөр (өмнө хийсэн ажлаа засах);
 *   • «Дотоод ажил» — админы гараар үүсгэсэн `repair_projects` мөр.  Бүх төсөл
 *     эзэнтэй болчихсон үед ажилтан компанийн дотоод ажил хийж цагаа бүртгэх
 *     сав.  Эдгээр нь `projects`-т ОРДОГГҮЙ тул Төслүүд хуудас, хянах самбар,
 *     Timeline, хайлт зэрэгт хаана ч гарахгүй.
 *
 * ⚠️ Хоёр хүснэгтийн `id` нь ӨӨР орон зайд байна (тус тусдаа AUTOINCREMENT)
 *    тул нэг жагсаалтад хольж үзүүлэхдээ `p:<id>` / `r:<id>` гэсэн ХОСОЛСОН
 *    түлхүүр хэрэглэнэ.  Цэвэр тоон id хэрэглэвэл 7 дугаартай төсөл ба 7
 *    дугаартай дотоод ажил хоёр чимээгүй нийлнэ.
 *
 * ЯВЦ (миграци 0339): дотоод ажил ба `progress_mode = 'hours'` төслийн явц
 * нь цагаас л өснө — сервер тал бодно.  `openRequest` нь цонхыг тухайн төсөл
 * + ТАСКААР (0341) урьдчилан сонгож нээнэ (ZA таскийн мөр нь өөрийн
 * «Ажилласан» товчтой — MyTasksPage).
 */

export interface RepairOpenRequest {
  /** `p:<projects.id>` / `r:<repair_projects.id>` — сонголтын токен. */
  pick: string;
  /** Цагаар бодогддог төслийн таскийн мөрөөс нээсэн бол таск (0341). */
  task?: { id: number; name: string } | null;
  /** Ижил төслийг дахин дарахад ч нээгдэхийн тулд өсөх тоо. */
  nonce: number;
}

type PickKind = 'project' | 'repair';
type Pick = { kind: PickKind; id: number; name: string };

const tokenOf = (p: Pick) => `${p.kind === 'repair' ? 'r' : 'p'}:${p.id}`;

/** Цагийг «8», «9.5» гэж харуулна (хөвөгч цэгийн үлдэгдэлгүй). */
const hoursText = (h: number) => Math.round(h * 100) / 100;

/** Суурь ханш аль шатнаас гарсныг тайлбарлах i18n түлхүүрүүд. */
const RATE_SOURCE_KEY: Record<string, string> = {
  self7: 'repair.rateSourceSelf7',
  self30: 'repair.rateSourceSelf30',
  self90: 'repair.rateSourceSelf90',
  team30: 'repair.rateSourceTeam30',
  company30: 'repair.rateSourceCompany30',
  none: 'repair.rateSourceNone',
};

/** Түүхийн анхдагч мөрийн тоо.  Хуучин ZA бөглөлтийн нөхөлтөөс (0348) хойш
 *  ZA дээр их ажилладаг хүний түүх 100 мөр болж, таскуудын жагсаалтыг хуудасны
 *  доош түлхдэг байсан — үлдсэнийг «Бүгдийг харах»-аар нээнэ. */
const HISTORY_PREVIEW = 8;

export default function RepairSection({ openRequest }: { openRequest?: RepairOpenRequest | null } = {}) {
  const { t } = useLanguage();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  /** My Tasks-ийн цагийн мөр («Би N цаг») ба төслийн «Ажилласан цаг» карт
   *  нь өөр query — бүртгэл/устгалын дараа тэднийг ч шинэчилнэ.  Ирцийн
   *  төлөв ч: засварын бүртгэл «Гарах»-ын `progress_logged_today`-ийг хангадаг. */
  const refreshHourViews = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ['/progress/my-tasks'] }),
      queryClient.invalidateQueries({ queryKey: ['/attendance/my-status'] }),
      queryClient.invalidateQueries({
        predicate: (q) => typeof q.queryKey[0] === 'string' && q.queryKey[0].startsWith('/repair/hours'),
      }),
    ]);
  // Засварын төслийг ЗӨВХӨН админ үүсгэнэ (`POST /api/repair/projects` нь
  // `requireAdmin()`).  Бусад ролийн хувьд энэ талбар огт харагдахгүй — тэд
  // зөвхөн дээрх жагсаалтаас сонгоно.
  const isAdmin = user?.role === 'admin';
  /**
   * Засвар БҮРТГЭХ эрх — сервер тал `POST /api/repair`-ыг
   * `engineer|architect|senior`-ээр хаадаг тул админ (CEO ч мөн адил, тэр
   * `admin` роль) бүртгэж ЧАДАХГҮЙ.  Түүнгүйгээр админд `/repair/my` ба
   * `/repair/weekly-average` хоёул 403 өгч, цонх нь «ирцийн бүртгэл алга»
   * гэсэн БУРУУ шалтгаан харуулдаг байв — бодит шалтгаан нь эрх.
   */
  const canLogRepairs =
    user?.role === 'engineer' || user?.role === 'architect' || user?.role === 'senior';

  // 403 өгөх нь тодорхой асуулгыг админд огт явуулахгүй.
  const myRepairsQuery = useApiQuery<{ items: RepairEntry[] }>('/repair/my', {
    enabled: canLogRepairs,
  });
  const rateQuery = useApiQuery<RepairRateInfo>('/repair/rate', {
    enabled: canLogRepairs,
  });
  const projectsQuery = useApiQuery<{ projects: ProjectWithProgress[] }>('/projects', {
    retry: false,
  });
  const repairProjectsQuery = useApiQuery<{ items: RepairProject[] }>('/repair/projects', {
    retry: false,
  });

  const repairs = myRepairsQuery.data?.items ?? [];
  const dailyRate = rateQuery.data?.daily_rate ?? 0;
  const progressRate = rateQuery.data?.progress_rate ?? 0;
  const progressRateSource = rateQuery.data?.progress_rate_source ?? 'none';
  const workDayHours = rateQuery.data?.work_day_hours ?? 8;
  const rateSource = rateQuery.data?.rate_source ?? 'none';
  /** Өдрийн нийлбэрийн дээд хязгаар — ИРЦЭЭС ХАМААРАХГҮЙ тогтмол (сервер 12 ц). */
  const dailyCap = rateQuery.data?.daily_cap ?? 12;
  const dailyLogged = rateQuery.data?.daily_logged ?? 0;
  const hoursLeftToday = Math.max(0, dailyCap - dailyLogged);

  const [open, setOpen] = useState(false);
  const [pick, setPick] = useState<string>('');
  /** Таскийн мөрөөс нээсэн бол таск — төсөл солиход арилна. */
  const [task, setTask] = useState<{ id: number; name: string } | null>(null);
  const [description, setDescription] = useState('');
  const [hours, setHours] = useState('');
  const [submitting, setSubmitting] = useState(false);
  /** Устгаж буй мөрийн түлхүүр (`kind-id` — тэмдэглэгээ ба мөрийн id давхцдаг). */
  const [deletingKey, setDeletingKey] = useState<string | null>(null);
  const [showAllHistory, setShowAllHistory] = useState(false);
  const visibleRepairs = showAllHistory ? repairs : repairs.slice(0, HISTORY_PREVIEW);
  const [newProjectName, setNewProjectName] = useState('');
  const [creatingProject, setCreatingProject] = useState(false);

  // My Tasks-ийн мөрөөс ирсэн хүсэлт: тухайн төслийг сонгоод цонхыг нээнэ.
  useEffect(() => {
    if (!openRequest) return;
    setPick(openRequest.pick);
    setTask(openRequest.task ?? null);
    setOpen(true);
  }, [openRequest]);

  /** Өөр төсөл сонговол таскийн холбоос утгаа алдана (таск тэр төслийнх). */
  const changePick = (next: string) => {
    if (next !== pick) setTask(null);
    setPick(next);
  };

  const projectPicks = useMemo<Pick[]>(
    () =>
      (projectsQuery.data?.projects ?? []).map((p) => ({
        kind: 'project' as const,
        id: p.id,
        name: p.name,
      })),
    [projectsQuery.data],
  );
  const repairPicks = useMemo<Pick[]>(
    () =>
      (repairProjectsQuery.data?.items ?? []).map((p) => ({
        kind: 'repair' as const,
        id: p.id,
        name: p.name,
      })),
    [repairProjectsQuery.data],
  );

  /** Сонгосон зорилтын явц цагаар бодогддог уу (0339): дотоод ажил үргэлж,
   *  жинхэнэ төсөл зөвхөн `progress_mode === 'hours'`. */
  const pickAffectsProgress = useMemo(() => {
    const [kind, rawId] = pick.split(':');
    if (kind === 'r') return true;
    if (kind !== 'p') return false;
    const id = Number(rawId);
    return (projectsQuery.data?.projects ?? []).some((p) => p.id === id && p.progress_mode === 'hours');
  }, [pick, projectsQuery.data]);

  const hoursNum = Number(hours);
  const hoursValid = Number.isFinite(hoursNum) && hoursNum > 0 && hoursNum <= dailyCap;
  // Өдрийн хувь (8 цаг = 100%) — цагаас автоматаар.
  const dayPct = hoursValid ? Math.round((hoursNum / workDayHours) * 100) : 0;
  // Сервер талын томьёотой ЯГ ижил: өдрийн дундаж хувь × (цаг / 8).
  const computedPct = hoursValid ? dailyRate * (hoursNum / workDayHours) : 0;
  // Төслийн явцад нэмэгдэх хувь (0339) — серверийн `progress_rate × цаг/8`-тай ижил.
  const progressPct = hoursValid ? progressRate * (hoursNum / workDayHours) : 0;
  /** Өдрийн хязгаараас хэтэрсэн эсэх — сервер 400 өгөхөөс өмнө товчийг хаана. */
  const overCap = hoursValid && dailyLogged + hoursNum > dailyCap + 0.01;

  // ГАРААР бүртгэх хуучин логик (2026-10-08 сэргээсэн): төсөл + тайлбар + цаг.
  const canSubmit =
    !!pick && description.trim().length > 0 && hoursValid && !overCap && !submitting;

  const resetForm = () => {
    setPick('');
    setTask(null);
    setDescription('');
    setHours('');
    setNewProjectName('');
  };

  /**
   * Админ нээлттэй талбарт бичсэн нэрээр шинэ ЗАСВАРЫН ТӨСӨЛ үүсгэнэ.
   * Энэ нь `projects`-т мөр НЭМДЭГГҮЙ — `repair_projects` хүснэгтэд л ордог
   * тул Төслүүд хуудсанд гарч ирэхгүй.  Үүсмэгц доорх сонголтод нэмэгдэж,
   * бусад ажилтан цагаа түүн рүү холбож бүртгэнэ.
   */
  const createProject = async () => {
    const name = newProjectName.trim();
    if (!name || creatingProject) return;
    setCreatingProject(true);
    try {
      const res = await apiFetch<{ project: RepairProject }>('/repair/projects', {
        method: 'POST',
        data: { name },
      });
      const created = res?.project;
      setNewProjectName('');
      toast.success(t('repair.projectCreated', { name }));
      await repairProjectsQuery.refetch();
      if (created?.id) setPick(tokenOf({ kind: 'repair', id: created.id, name }));
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : t('repair.projectCreateFailed');
      toast.error(msg);
    } finally {
      setCreatingProject(false);
    }
  };

  const submit = async () => {
    if (!canSubmit) return;
    const [kind, rawId] = pick.split(':');
    const id = Number(rawId);
    if (!Number.isInteger(id) || id <= 0) return;
    setSubmitting(true);
    try {
      await apiFetch('/repair', {
        method: 'POST',
        data: {
          // Сервер тал нь ЯГ НЭГ нь ирсэн эсэхийг шалгана (0194-ийн CHECK-ийн
          // хос) — тиймээс нөгөөг нь огт илгээхгүй.
          ...(kind === 'r' ? { repair_project_id: id } : { project_id: id }),
          // Таск (0341) — зөвхөн цагаар бодогддог төслийн таскийн мөрөөс.
          ...(kind === 'p' && task ? { task_id: task.id } : {}),
          description: description.trim(),
          hours: hoursNum,
        },
      });
      toast.success(t('repair.created'));
      resetForm();
      setOpen(false);
      await Promise.all([myRepairsQuery.refetch(), rateQuery.refetch(), refreshHourViews()]);
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : t('repair.createFailed');
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  };

  /** Тэмдэглэгээнээс бодсон мөр (эсвэл 0 цагийн тэмдэглэгээ) бол тэмдэглэгээг
   *  болиулна — тэр өдрийн цаг бусад ажилд дахин хуваагдана.  Гараар бичсэн
   *  хуучин мөр бол мөрийг устгана. */
  const remove = async (r: RepairEntry) => {
    const markId = r.kind === 'mark' ? r.id : (r.mark_id ?? null);
    if (
      !(await confirmDialog({
        description: markId ? t('repair.unmarkConfirm') : t('repair.deleteConfirm'),
        variant: 'destructive',
        confirmText: t('common.delete'),
      }))
    )
      return;
    const key = `${r.kind ?? 'entry'}-${r.id}`;
    setDeletingKey(key);
    try {
      await apiFetch(markId ? `/repair/marks/${markId}` : `/repair/${r.id}`, { method: 'DELETE' });
      toast.success(t('repair.deleted'));
      await Promise.all([myRepairsQuery.refetch(), refreshHourViews()]);
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : t('repair.createFailed');
      toast.error(msg);
    } finally {
      setDeletingKey(null);
    }
  };

  return (
    <Card className="border-border bg-card/60 backdrop-blur overflow-hidden">
      <CardContent className="p-4">
        {/* Header */}
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2 min-w-0">
            <Wrench className="h-4 w-4 text-primary shrink-0" />
            <div className="min-w-0">
              <h2 className="text-sm font-semibold text-foreground">
                {t('repair.myRepairsTitle')}
              </h2>
              <p className="text-xs text-muted-foreground">
                {canLogRepairs ? t('repair.sectionHint') : t('repair.adminSectionHint')}
              </p>
            </div>
          </div>
          <Button size="sm" className="gap-1.5 shrink-0" onClick={() => setOpen(true)}>
            <Plus className="h-4 w-4" />
            {canLogRepairs ? t('repair.addButton') : t('repair.addInternalButton')}
          </Button>
        </div>

        {/* History list */}
        {!canLogRepairs ? (
          // Админд өөрийн засварын түүх гэж байхгүй — оронд нь удирдах хэсэг рүү
          // чиглүүлнэ (Баталгаажуулах → Засвар).
          <p className="py-6 text-center text-sm text-muted-foreground">
            {t('repair.adminManagePointer')}
          </p>
        ) : myRepairsQuery.isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
          </div>
        ) : repairs.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-6">{t('repair.noRepairs')}</p>
        ) : (
          <>
          <ul className="mt-3 divide-y divide-border/60">
            {visibleRepairs.map((r) => {
              const key = `${r.kind ?? 'entry'}-${r.id}`;
              const isBackfill = r.hours_source === 'backfill';
              const zeroMark = r.kind === 'mark';
              return (
                <li key={key} className="flex items-center gap-3 py-2.5" data-testid="repair-history-row">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium text-foreground truncate">
                        {r.project_name}
                      </span>
                      {/* Дотоод ажлыг жинхэнэ төслөөс нүдээр ялгана. */}
                      {r.is_repair_project === 1 && (
                        <span className="inline-flex items-center gap-1 rounded-full border border-border px-1.5 py-0.5 text-micro text-muted-foreground">
                          <Building2 className="h-3 w-3" />
                          {t('repair.internalBadge')}
                        </span>
                      )}
                      {/* Засварын төсөл цагаар шилжихээс өмнөх хувийн бөглөлтөөс
                          систем нөхсөн цаг (0348) — ажилтан устгахгүй. */}
                      {isBackfill && (
                        <span
                          className="inline-flex items-center gap-1 rounded-full border border-border px-1.5 py-0.5 text-micro text-muted-foreground"
                          title={t('repair.backfillBadgeTitle')}
                        >
                          <History className="h-3 w-3" />
                          {t('repair.backfillBadge')}
                        </span>
                      )}
                      <span className="text-micro text-muted-foreground tabular-nums">
                        {formatDate(new Date(r.date))}
                      </span>
                    </div>
                    {/* Таск (0341) ба ХУУЧИН бүртгэлийн тайлбар — байгаа үед л.
                        Шинэ бүртгэлд тайлбар байхгүй (2026-09-24). */}
                    {r.task_name && (
                      <p className="flex items-center gap-1 text-xs text-muted-foreground truncate">
                        <ListChecks className="h-3 w-3 shrink-0" />
                        <span className="truncate">{r.task_name}</span>
                      </p>
                    )}
                    {r.description && (
                      <p className="text-xs text-muted-foreground truncate">{r.description}</p>
                    )}
                  </div>
                  {/* Зөвхөн АЖИЛЛАСАН ЦАГ — өдрийн % ба авах % ЗОРИУД харагдахгүй.
                      Цагийг систем бодно; 0 бол тэр өдрийн цагийг бусад бөглөлт авсан. */}
                  <div
                    className="flex items-center gap-1.5 text-sm font-semibold text-foreground tabular-nums shrink-0"
                    data-testid="repair-entry-hours"
                    title={zeroMark ? t('repair.zeroHoursTitle') : undefined}
                  >
                    <Clock className={zeroMark ? 'h-3.5 w-3.5 text-muted-foreground' : 'h-3.5 w-3.5 text-primary'} />
                    {t('repair.hoursValue', { hours: hoursText(r.hours) })}
                  </div>
                  {isBackfill ? (
                    <span className="h-7 w-7 shrink-0" aria-hidden />
                  ) : (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-muted-foreground hover:text-destructive shrink-0"
                      onClick={() => void remove(r)}
                      disabled={deletingKey === key}
                      aria-label={t('common.delete')}
                    >
                      {deletingKey === key ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Trash2 className="h-3.5 w-3.5" />
                      )}
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
          {repairs.length > HISTORY_PREVIEW && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="mt-1 h-8 w-full text-xs text-muted-foreground"
              onClick={() => setShowAllHistory((v) => !v)}
              data-testid="repair-history-toggle"
            >
              {showAllHistory
                ? t('repair.historyShowLess')
                : t('repair.historyShowAll', { count: repairs.length })}
            </Button>
          )}
          </>
        )}
      </CardContent>

      {/* Create dialog */}
      <Dialog open={open} onOpenChange={(o) => (o ? setOpen(true) : (setOpen(false), resetForm()))}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {canLogRepairs ? t('repair.dialogTitle') : t('repair.adminDialogTitle')}
            </DialogTitle>
            <DialogDescription>
              {canLogRepairs ? t('repair.dialogDesc') : t('repair.adminDialogDesc')}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {/* Project — бүртгэх эрхгүй хэрэглэгчид сонголт утгагүй тул нуана. */}
            <div className="space-y-1.5">
              {canLogRepairs && (
                <>
                  <Label>{t('repair.projectLabel')}</Label>
                  <Select value={pick} onValueChange={changePick}>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder={t('repair.projectPlaceholder')} />
                    </SelectTrigger>
                    <SelectContent>
                      {repairPicks.length > 0 && (
                        <SelectGroup>
                          <SelectLabel>{t('repair.internalGroup')}</SelectLabel>
                          {repairPicks.map((p) => (
                            <SelectItem key={tokenOf(p)} value={tokenOf(p)}>
                              {p.name}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      )}
                      {projectPicks.length > 0 && (
                        <SelectGroup>
                          <SelectLabel>{t('repair.projectGroup')}</SelectLabel>
                          {projectPicks.map((p) => (
                            <SelectItem key={tokenOf(p)} value={tokenOf(p)}>
                              {p.name}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      )}
                    </SelectContent>
                  </Select>
                  {/* Таскийн мөрөөс нээсэн бол аль таск дээр цаг бүртгэхийг
                      харуулна (0341) — арилгавал төслийн түвшинд бүртгэнэ. */}
                  {task && (
                    <div
                      className="flex items-center gap-1.5 rounded-md border border-border bg-muted/30 px-2 py-1 text-xs"
                      data-testid="repair-task-chip"
                    >
                      <ListChecks className="h-3.5 w-3.5 shrink-0 text-primary" />
                      <span className="text-muted-foreground shrink-0">{t('repair.taskLabel')}:</span>
                      <span className="min-w-0 flex-1 truncate font-medium text-foreground">{task.name}</span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-xs"
                        onClick={() => setTask(null)}
                        className="text-muted-foreground hover:text-foreground"
                        aria-label={t('repair.taskClear')}
                        title={t('repair.taskClear')}
                      >
                        <X />
                      </Button>
                    </div>
                  )}
                </>
              )}

              {/* Зөвхөн админ: жагсаалтад байхгүй ДОТООД АЖЛЫГ эндээс шууд
                  үүсгэнэ.  Энэ нь `projects`-т мөр нэмдэггүй тул Төслүүд
                  хуудсанд гарч ирэхгүй — зөвхөн энэ сонголтод л нэмэгдэнэ. */}
              {isAdmin && (
                <div className="rounded-lg border border-dashed border-border bg-muted/20 p-2.5 space-y-1.5">
                  <Label className="text-xs text-muted-foreground">
                    {t('repair.newProjectLabel')}
                  </Label>
                  <div className="flex items-center gap-2">
                    <Input
                      value={newProjectName}
                      onChange={(e) => setNewProjectName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          void createProject();
                        }
                      }}
                      placeholder={t('repair.newProjectPlaceholder')}
                      className="h-9"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="shrink-0 gap-1.5"
                      onClick={() => void createProject()}
                      disabled={!newProjectName.trim() || creatingProject}
                    >
                      {creatingProject ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Plus className="h-4 w-4" />
                      )}
                      {t('repair.newProjectAdd')}
                    </Button>
                  </div>
                  <p className="text-micro text-muted-foreground">{t('repair.newProjectHint')}</p>
                </div>
              )}
            </div>

            {/* Бүртгэх эрхгүй хэрэглэгчид (админ) доорх бүх талбар утгагүй —
                тэр зөвхөн дотоод ажлын САВ үүсгэдэг, цаг бүртгэдэггүй. */}
            {canLogRepairs && (
              <>
                {/* Description */}
                <div className="space-y-1.5">
                  <Label>{t('repair.descriptionLabel')}</Label>
                  <Textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder={t('repair.descriptionPlaceholder')}
                    rows={3}
                  />
                </div>

                {/* Hours — ажилтан ӨӨРӨӨ оруулна. */}
                <div className="space-y-1.5">
                  <Label>{t('repair.hoursLabel')}</Label>
                  <Input
                    type="number"
                    min={0}
                    max={dailyCap}
                    step={0.5}
                    inputMode="decimal"
                    value={hours}
                    onChange={(e) => setHours(e.target.value)}
                    placeholder="0"
                  />
                  <div className="flex flex-wrap gap-1.5 pt-0.5">
                    {[1, 2, 4, 8].map((h) => (
                      <Button
                        key={h}
                        type="button"
                        variant={hoursNum === h ? 'default' : 'outline'}
                        size="sm"
                        className="h-7 px-2.5 text-xs tabular-nums"
                        onClick={() => setHours(String(h))}
                      >
                        {t('repair.hoursValue', { hours: h })}
                      </Button>
                    ))}
                  </div>
                  <p className="text-micro text-muted-foreground">{t('repair.hoursOwnHint')}</p>
                </div>

                {/* Live preview */}
                <div className="rounded-lg border border-border bg-muted/30 p-3 space-y-1 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">{t('repair.percentOfDayLabel')}</span>
                    <span className="font-medium tabular-nums">{dayPct}%</span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="min-w-0 text-muted-foreground">
                      {t('repair.dailyAvgLabel')}
                      <span className="ml-1 text-micro opacity-70">
                        {t(RATE_SOURCE_KEY[rateSource] ?? 'repair.rateSourceNone')}
                      </span>
                    </span>
                    <span className="shrink-0 font-medium tabular-nums">
                      {formatPoints(dailyRate)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">{t('repair.computedLabel')}</span>
                    <span className="font-semibold text-primary tabular-nums">
                      {formatPoints(computedPct)}
                    </span>
                  </div>
                  {pickAffectsProgress && (
                    <div className="flex items-center justify-between gap-2" data-testid="repair-progress-preview">
                      <span className="min-w-0 text-muted-foreground">
                        <Gauge className="mr-1 inline h-3.5 w-3.5" aria-hidden />
                        {t('repair.progressAddLabel')}
                        <span className="ml-1 text-micro opacity-70">
                          {t(RATE_SOURCE_KEY[progressRateSource] ?? 'repair.rateSourceNone')}
                        </span>
                      </span>
                      <span className="shrink-0 font-semibold tabular-nums">
                        +{(Math.round(progressPct * 100) / 100).toLocaleString('mn-MN', { maximumFractionDigits: 2 })}%
                      </span>
                    </div>
                  )}
                  {dailyLogged > 0 && (
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">{t('repair.hoursLoggedLabel')}</span>
                      <span className="font-medium tabular-nums">
                        {t('repair.hoursValue', { hours: hoursText(dailyLogged) })}
                      </span>
                    </div>
                  )}
                  {overCap && (
                    <div className="flex items-start gap-1.5 text-xs text-warning pt-1">
                      <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                      <span>
                        {t('repair.overCap', {
                          cap: dailyCap,
                          hours: Math.round(hoursLeftToday * 10) / 10,
                        })}
                      </span>
                    </div>
                  )}
                </div>
              </>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => (setOpen(false), resetForm())}>
              {canLogRepairs ? t('common.cancel') : t('common.close')}
            </Button>
            {canLogRepairs && (
              <Button onClick={submit} disabled={!canSubmit} className="gap-1.5">
                {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
                {t('repair.submit')}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
