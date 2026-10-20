import { useState, useMemo, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useLanguage, type TranslationKey, type TParams } from '@/shared/i18n';
import { useAuth } from '@/shared/context/AuthContext';
import { apiFetch, ApiError } from '@/shared/api/client';
import { formatDisplayName } from '@/shared/lib/formatting';
import { PageContainer } from '@/shared/components/PageContainer';
import { useApiQuery } from '@/shared/api/useApi';
import { Card, CardContent } from '@/ui/card';
import { Button } from '@/ui/button';
import { Badge } from '@/ui/badge';
import { Input } from '@/ui/input';
import { PercentStepper } from '@/shared/components/PercentStepper';
import { Checkbox } from '@/ui/checkbox';
import { Textarea } from '@/ui/textarea';
import { Progress } from '@/ui/progress';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/ui/dialog';
import { Popover, PopoverContent, PopoverTrigger } from '@/ui/popover';
import {
  ListCheck,
  CheckCircle2,
  Loader2,
  Search,
  ArrowUp,
  ArrowDown,
  Send,
  FolderOpen,
  ArrowUpRight,
  BookmarkMinus,
  ChevronRight,
  CalendarClock,
  AlertTriangle,
  MessageSquare,
  Sparkles,
  History,
  CheckSquare,
  Clock,
  Undo2,
} from 'lucide-react';
import { cn } from '@/shared/lib/utils';
import { toast } from '@/shared/components/Toast';
import { todayUB, todayBannerUB, formatDate } from '@/shared/lib/time';
import RepairSection from './RepairSection';
import NonProjectWorkSection from '@/features/non-project-work/NonProjectWorkSection';
import AttachmentsPopover from './daily/AttachmentsPopover';
import TaskChecklistPopover from './daily/TaskChecklistPopover';
import TaskTimerControl from '@/features/task-timer/TaskTimerControl';
import OfficialTimerBanner from '@/features/task-timer/OfficialTimerBanner';
import { useOfficialTimer } from '@/features/task-timer/useOfficialTimer';
import { OFFICIAL_TIMER_STATE_KEY } from '@/features/task-timer/officialTimer';
import { invalidateAttendanceStatus } from '@/features/attendance/attendanceStatus';
import { useProjectPermissions } from '@/features/projects/detail/useProjectPermissions';
import { useTakeTask } from '@/features/projects/detail/useTakeTask';
import { OwnProgressControl } from '@/features/task-allocation/OwnProgressControl';
import { ManagedRowActions } from '@/features/task-allocation/ManagedRowActions';
import { TakeFlowDialogs } from '@/features/task-allocation/TakeFlowDialogs';
import { ownProgressStore } from '@/features/task-allocation/ownProgressStore';
import type { OwnBase } from '@/features/task-allocation/ownProgress';
import type { MyTaskAllocation } from '@/features/task-allocation/types';
import { confirmDialog } from '@/shared/components/ConfirmDialog';
import { invalidateMyList, retractMyTask, setInMyList, useMyListWorkers } from './myTaskList';
import { CONTRIBUTORS_PREFIX } from '@/features/task-allocation/api';
import PreviousReportsCard from './daily/PreviousReportsCard';
import BulkReportBar from './daily/BulkReportBar';
import { useDailyDrafts } from './daily/useDailyDrafts';
import type { DailyDraft, RecentReport, RecentReportsResponse } from './daily/types';

interface MyTaskItem {
  id: number;
  name: string;
  weight_percent: number;
  /** Always 'task' after the subtask layer was dropped. Kept on the type so
   *  we don't break older callers, but the value is fixed in current data. */
  item_type: 'task';
  current_progress: number;
  project_id: number;
  project_name: string;
  block_name: string;
  drawing_name: string;
  component_name: string;
  due_date: string | null;
  start_date: string | null;
  reported_today: boolean;
  reported_today_rest: boolean;
  /** True when today's row is "Маргааш хийнэ" (counts as filed, no % change). */
  reported_today_deferred?: boolean;
  /** Project's per-task completion questions (defaults applied server-side). */
  completion_questions: CompletionQuestion[];
  ai_completion_summary: string | null;
  ai_completion_summary_at: string | null;
  /** Хувийн checklist-ийн тоолол (migration 0177).  ЗӨВХӨН харагдац —
   *  ямар ч rollup энэ тоог уншдаггүй. */
  checklist: { total: number; done: number };
  /** 'AZ' | 'ZA' | 'ET' | 'EZ' | 'IZ' | null.  Зөвхөн 'ZA' (Засвар) дээр
   *  «Миний хийх ажил дууссан» тэмдэглэгээ боломжтой. */
  project_category: string | null;
  /** Төслийн явцын горим (0339).  'hours' = засварын цагийн бүртгэлээс — энэ
   *  мөрөнд % бичих маягт БАЙХГҮЙ (сервер 403), оронд нь «Цаг бүртгэх». */
  project_progress_mode?: 'tasks' | 'hours' | null;
  /** Цагаар бодогддог мөрийн АЖИЛЛАСАН ЦАГ (2026-09-24, `repair_entries.task_id`
   *  0341): миний ба нийт.  Бусад мөрөнд null.  Энэ мөрөнд ХУВЬ харагдахгүй. */
  repair_hours?: { mine: number; total: number } | null;
  /** Өнөөдөр «Ажилласан» гэж тэмдэглэсэн бол тэмдэглэгээ + систем хуваарилсан
   *  цаг (0348).  Өдрийн турш өөрчлөгдөж болно (2 дахь таскийг тэмдэглэхэд 8 → 4). */
  repair_today?: { mark_id: number; hours: number } | null;
  /** Хэрэглэгч өөрөө «миний хэсэг дууссан» гэж тэмдэглэсэн эсэх (0253).
   *  Хувь БИЧИГДЭХГҮЙ — зөвхөн энэ хүний жагсаалтаас мөрийг нууна. */
  self_done: boolean;
  self_done_at: string | null;
  /** Хамтарсан ажлын оноо хуваах (migration 0322) — мөргүй бол null.
   *  ЗӨВХӨН харагдац: явцын %-д нөлөөлөхгүй, зөвхөн оноо хуваагдана. */
  share: { my_percent: number | null; people: number; is_owner: boolean } | null;
  /** 2026-10-01: хувь оруулах эрх — энэ таск дээр миний албан цаг эхэлж байсан (таймерын
   *  сэшнтэй).  false бол мөр дээрх «Эхлүүлэх»-ээр эхлүүлнэ.  undefined = хуучин сервер. */
  can_report?: boolean;
  /** Өнөөдөр (УБ) энэ таск дээр миний таймер явсан — «өнөөдрийн тайлан» хүлээгдэнэ. */
  worked_today?: boolean;
  /** ОДОО энэ таск дээр ажиллаж буй хүмүүс (би байж ч болно) — нэр л. */
  working?: Array<{ user_id: number; full_name: string | null }>;
  /** Хуваарилагдсан («managed») үндсэн ажил (2026-10-02): revision, root-ийн нийт хийгдсэн, МИНИЙ хэсэг (T/D/L).
   *  null/undefined = ердийн таск (хуучин % маягт).  `current_progress` нь ҮНДСЭН АЖЛЫН хувь. */
  allocation?: MyTaskAllocation | null;
}

interface CompletionQuestion {
  id: string;
  text: string;
}

type TFn = (key: TranslationKey, params?: TParams) => string;

function dueMeta(due: string | null, done: boolean, t?: TFn) {
  if (!due || done) return null;
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const d = new Date(due);
  const dayMs = 24 * 60 * 60 * 1000;
  const days = Math.round((d.getTime() - today.getTime()) / dayMs);
  const tr: TFn = t ?? ((key) => key);
  if (days < 0)
    return { tone: 'overdue' as const, label: tr('myTasksPage.dueOverdue', { days: -days }), days };
  if (days === 0) return { tone: 'today' as const, label: tr('myTasksPage.dueToday'), days };
  if (days <= 7)
    return { tone: 'soon' as const, label: tr('myTasksPage.dueInDays', { days }), days };
  return { tone: 'future' as const, label: formatDate(d), days };
}

interface Summary {
  total: number;
  completed: number;
  in_progress: number;
  not_started: number;
  /** «Би дуусгасан» гэж тэмдэглэсэн мөрийн тоо (зөвхөн засварын төсөл). */
  self_done?: number;
  today?: string;
  reported_today?: number;
  pending_today?: number;
}

// 'active'  = tasks belonging to the projects the user picked for today
//             via the AttendanceWidget (today's actual workload).
// 'started' = anything I haven't finished yet (was previously "In Progress" +
//             "Upcoming"; we merged the two on user request).
type FilterTab = 'all' | 'active' | 'started' | 'completed' | 'overdue';
type SortKey = 'name' | 'project_name' | 'current_progress' | 'due_date';
type SortDir = 'asc' | 'desc';

function ProgressCell({ value }: { value: number }) {
  const color =
    value >= 100 ? 'text-success' : value > 0 ? 'text-primary' : 'text-muted-foreground';
  return (
    <div className="flex items-center gap-2.5 min-w-[130px]">
      <Progress value={Math.min(value, 100)} className="h-1.5 flex-1" />
      <span className={cn('text-xs font-semibold tabular-nums w-9 text-right', color)}>
        {value}%
      </span>
    </div>
  );
}

/** Ажилтан өөрөө «дууссан» гэж хааж болох мөр үү?  ЗӨВХӨН засварын
 *  төсөл ('ZA') — бусад ангилалд сервер 403 өгнө. */
function canSelfClose(item: MyTaskItem) {
  return item.project_category === 'ZA' && item.current_progress < 100;
}

/** Явц нь цагийн бүртгэлээс бодогддог төслийн мөр үү (0339; 0348-аас хойш
 *  БҮХ ZA төсөл)?  Тийм бол % бичих маягт, олноор илгээх сонголт хоёулаа
 *  байхгүй — «Ажилласан» гэж тэмдэглэнэ, цагийг сервер бодно. */
function isHoursRow(item: MyTaskItem) {
  return item.project_progress_mode === 'hours';
}

/** Цагийг «8», «2.67» гэж харуулна. */
const hoursText = (h: number) => Math.round(h * 100) / 100;

/** Хуваарилагдсан таск дээрх миний хэсэг → өөрийн явцын удирдлагын суурь.  Ирээдүйн ажилгүй, засах зүйлгүй бол null. */
function ownBaseOf(item: MyTaskItem, userId: number | undefined): OwnBase | null {
  const a = item.allocation;
  const my = a?.my;
  if (!a || !my || !userId || my.target_units <= 0) return null;
  if (!(my.target_units > my.done_units || my.done_units > my.floor_units)) return null;
  return {
    taskId: item.id,
    userId,
    revision: a.revision,
    rootDone: a.root_done_units,
    done: my.done_units,
    floor: my.floor_units,
    target: my.target_units,
  };
}

/** Энгийн (хуваарилаагүй) таскийн −/+ алхам: таскийн нийт хувийн 10% (өмнө нь тогтмол 5%; эзэн 2026-10-05).
 *  Хуваарилагдсан таск `OwnProgressControl`-ын өөрийн 10% / 1% алхамтай. */
const PLAIN_TASK_STEP_PCT = 10;

const SORT_OPTIONS: { key: SortKey; labelKey: string }[] = [
  { key: 'current_progress', labelKey: 'myTasksPage.sortProgress' },
  { key: 'due_date', labelKey: 'myTasksPage.sortDue' },
  { key: 'name', labelKey: 'myTasksPage.sortName' },
  { key: 'project_name', labelKey: 'myTasksPage.sortProject' },
];

export default function MyTasksPage() {
  const { t } = useLanguage();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const myTasksQuery = useApiQuery<{ items: MyTaskItem[]; summary: Summary }>('/progress/my-tasks');
  /** Албан ёсны таскийн таймер (0361).  «Миний ажлууд» = ажилласан ∪ төслийн хуудаснаас
   *  «Миний ажилд нэмэх»-ээр нэмсэн таскууд (0370) — мөр бүрээс ШУУД цаг эхлүүлнэ (= «Өөртөө
   *  авах», ижил дүрэм: ирц, эзлэгдсэн бол хувааж авах). */
  const officialTimer = useOfficialTimer();
  const { canClaimRole: canTake } = useProjectPermissions();
  const refetchMyTasks = myTasksQuery.refetch;
  const onTaken = useCallback(() => void refetchMyTasks(), [refetchMyTasks]);
  const { take, takingId, flow, closeFlow } = useTakeTask({ timer: officialTimer, onTaken });
  const items: MyTaskItem[] = myTasksQuery.data?.items ?? [];
  /** Жагсаалтын таскууд дээр ОДОО хэн ажиллаж байна — ~10 сек тутам (нэр л). */
  const liveWorkers = useMyListWorkers(items.length > 0);
  const summary: Summary = myTasksQuery.data?.summary ?? {
    total: 0,
    completed: 0,
    in_progress: 0,
    not_started: 0,
  };
  const loading = myTasksQuery.isLoading;
  const loadError = myTasksQuery.isError;

  const activeProjectsQuery = useApiQuery<{ project_ids: number[] }>('/attendance/active-projects');
  const activeProjectIds: number[] = activeProjectsQuery.data?.project_ids ?? [];

  // Сүүлийн 7 хоногийн МИНИЙ тайлан — нэг query хоёр зүйлд үйлчилнэ:
  // «Өмнөх тайлан» самбар, мөн мөр бүрийн «Өчигдөр 45%» чип.
  const recentQuery = useApiQuery<RecentReportsResponse>('/progress/my-recent?days=7');
  const recentEntries: RecentReport[] = useMemo(
    () => recentQuery.data?.entries ?? [],
    [recentQuery.data],
  );

  const [filter, setFilter] = useState<FilterTab>('active');
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('current_progress');
  const [sortDir, setSortDir] = useState<SortDir>('asc');

  /** Per-row inline edit drafts.  Lazy: a row only shows up here once the
   *  user has typed/touched it; otherwise we render fresh placeholders
   *  derived from `current_progress`.
   *
   *  ⚠️ Хадгалалт localStorage-д цувдаг (`useDailyDrafts`) — хуудас
   *  сэргээх/утас түгжигдэхэд бичсэн тэмдэглэл АЛГА БОЛОХГҮЙ. */
  const today = todayUB();
  const {
    getDraft: getStoredDraft,
    updateDraft,
    clearDrafts,
    bumpValues,
    dirtyCount,
  } = useDailyDrafts(user?.id, today);
  const [submittingId, setSubmittingId] = useState<number | null>(null);
  /** «Би дуусгасан» тэмдэглэгээ илгээгдэж буй мөрийн id. */
  const [selfDoneBusyId, setSelfDoneBusyId] = useState<number | null>(null);
  /** 100% task — read-only "дууссан" summary in a dialog (no daily report). */
  const [doneItem, setDoneItem] = useState<MyTaskItem | null>(null);

  /** Бөөнөөр илгээх сонголт — мөрийн id-ийн олонлог. */
  const [selected, setSelected] = useState<Set<number>>(() => new Set());
  const [bulkSubmitting, setBulkSubmitting] = useState(false);
  /** Сүүлийн бөөн илгээлтэд ХАДГАЛАГДААГҮЙ мөрийн алдаа (таскийн id → серверийн мессеж).  Мөр бүр дээрээ
   *  харагдана — өмнө нь зөвхөн эхний алдаа toast-оор гарч, бусад мөр яагаад үлдсэн нь тодорхойгүй байв.
   *  Тэр мөрийг засах эсвэл амжилттай илгээхэд арилна. */
  const [bulkErrors, setBulkErrors] = useState<Map<number, string>>(() => new Map());

  /** Pending 100% submission — collects completion answers before POSTing. */
  const [completionFor, setCompletionFor] = useState<MyTaskItem | null>(null);
  const [completionAnswers, setCompletionAnswers] = useState<Record<string, string>>({});
  const [completionError, setCompletionError] = useState<string | null>(null);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setSortKey(key);
      setSortDir('asc');
    }
  };

  const changeFilter = (tab: FilterTab) => setFilter(tab);

  const overdueCount = useMemo(
    () =>
      items.filter((i) => {
        if (i.current_progress >= 100 || i.self_done) return false;
        const m = dueMeta(i.due_date, false);
        return m?.tone === 'overdue';
      }).length,
    [items],
  );

  const activeSet = useMemo(() => new Set(activeProjectIds), [activeProjectIds]);

  const filtered = useMemo(() => {
    let list = [...items];
    // «Би дуусгасан» гэж тэмдэглэсэн мөр нь хийх ажлын аль ч табд ГАРАХГҮЙ
    // (энэ хүсэлтийн гол цэг).  «Дууссан» ба «Бүгд» табд харагдана —
    // тэндээс л буцаах товч олдоно, эс тэгвэл алдаатай тэмдэглэгээ
    // сэргээх гарц үлдэхгүй.
    if (filter === 'completed') list = list.filter((i) => i.current_progress >= 100 || i.self_done);
    else if (filter === 'active') {
      list = list.filter(
        (i) => activeSet.has(i.project_id) && i.current_progress < 100 && !i.self_done,
      );
    }
    // "In Progress" merges the old started + not-started — anything I haven't finished.
    else if (filter === 'started')
      list = list.filter((i) => i.current_progress < 100 && !i.self_done);
    else if (filter === 'overdue') {
      list = list.filter((i) => {
        if (i.current_progress >= 100 || i.self_done) return false;
        const m = dueMeta(i.due_date, false);
        return m?.tone === 'overdue';
      });
    }
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(
        (i) =>
          i.name.toLowerCase().includes(q) ||
          i.project_name.toLowerCase().includes(q) ||
          i.block_name.toLowerCase().includes(q) ||
          i.drawing_name.toLowerCase().includes(q),
      );
    }
    list.sort((a, b) => {
      let cmp = 0;
      if (sortKey === 'name') cmp = a.name.localeCompare(b.name);
      else if (sortKey === 'project_name') cmp = a.project_name.localeCompare(b.project_name);
      else if (sortKey === 'current_progress') cmp = a.current_progress - b.current_progress;
      else if (sortKey === 'due_date') {
        const ad = a.due_date ? new Date(a.due_date).getTime() : Number.POSITIVE_INFINITY;
        const bd = b.due_date ? new Date(b.due_date).getTime() : Number.POSITIVE_INFINITY;
        cmp = ad - bd;
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return list;
  }, [items, filter, search, sortKey, sortDir, activeSet]);

  const getDraft = useCallback(
    (item: MyTaskItem): DailyDraft => getStoredDraft(item.id, item.current_progress),
    [getStoredDraft],
  );

  /** Мөрийн ноорогийг ХЭСЭГЧЛЭН засах.
   *
   *  ⚠️ Түүхий `updateDraft`-ыг мөрөөс шууд дуудаж БОЛОХГҮЙ: хараахан
   *  хөндөөгүй мөрийн ноорог байхгүй тул шинээр үүсэхдээ `value: ''`
   *  болж, `current_progress`-оос гаралтай харагдаж байсан хувь
   *  ЦЭВЭРЛЭГДЭНЭ.  (Жишээ: 45%-тай мөрд файл хавсаргамагц % талбар
   *  хоосорно.)  Иймд урьдаас `getDraft`-ийн бүрэн утгыг суурь болгоно. */
  const patchDraft = useCallback(
    (item: MyTaskItem, patch: Partial<DailyDraft>) => {
      setBulkErrors((prev) => {
        if (!prev.has(item.id)) return prev;
        const next = new Map(prev);
        next.delete(item.id);
        return next;
      });
      updateDraft(item.id, { ...getDraft(item), ...patch });
    },
    [getDraft, updateDraft],
  );

  /** Мөр бүрийн ХАМГИЙН СҮҮЛИЙН өмнөх (өнөөдрийнхөөс бусад) тайлан —
   *  «Өчигдөр 45%» чип болон тэмдэглэлээ хуулах товчийг тэжээнэ.
   *  `recentEntries` нь серверээс date DESC-ээр ирдэг тул тухайн таскийн
   *  анх тааралдсан мөр нь хамгийн сүүлийнх. */
  const previousByTask = useMemo(() => {
    const map = new Map<number, RecentReport>();
    for (const e of recentEntries) {
      if (e.date === today) continue;
      if (!map.has(e.task_id)) map.set(e.task_id, e);
    }
    return map;
  }, [recentEntries, today]);

  const refreshAfterWrite = useCallback(() => {
    // Dashboard widgets listen for this so they refetch immediately.
    window.dispatchEvent(new CustomEvent('progress:submitted'));
    myTasksQuery.refetch();
    recentQuery.refetch();
    // 100% хаалт / «миний хэсэг дууссан» нь албан таймерыг сервер дээр зогсооно.
    void queryClient.invalidateQueries({ queryKey: OFFICIAL_TIMER_STATE_KEY });
    // Явц = «Гарах»-ын нөхцөл (`progress_logged_today`) — ирцийн төлвийг ч шинэчилнэ.
    invalidateAttendanceStatus();
  }, [myTasksQuery, recentQuery, queryClient]);

  /** «Миний хийх ажил дууссан» тэмдэглэгээг тавих / авах.
   *
   *  ⚠️ ХУВЬ БИЧИХГҮЙ — `progress_entries` үүсэхгүй, оноо хөдлөхгүй,
   *  төслийн явц хэвээрээ.  Зөвхөн энэ хүний жагсаалтаас мөр нуугдана.
   *  Сервер тал ангиллыг дахин шалгадаг (зөвхөн 'ZA'), тул UI дэх
   *  `canSelfClose` нь гоо сайхны шүүлтүүр, хамгаалалт биш. */
  const toggleSelfDone = useCallback(
    async (item: MyTaskItem, next: boolean) => {
      setSelfDoneBusyId(item.id);
      try {
        await apiFetch(`/progress/my-tasks/${item.id}/self-done`, {
          method: next ? 'POST' : 'DELETE',
        });
        // ⚠️ Bulk сонголтоос ЗААВАЛ хасна.  Мөр нь `filtered`-ээс алга
        // болох ч `selected` нь `items`-ээр ажилладаг тул үлдсэн id нь
        // доод самбарт тоологдож, «Илгээх» дарахад ХАРАГДАХГҮЙ мөрөнд
        // тайлан бичигдэнэ.
        if (next) {
          setSelected((prev) => {
            if (!prev.has(item.id)) return prev;
            const rest = new Set(prev);
            rest.delete(item.id);
            return rest;
          });
        }
        toast.success(next ? t('myTasksPage.selfDoneMarked') : t('myTasksPage.selfDoneReopened'));
        refreshAfterWrite();
      } catch (err) {
        console.error(err);
        toast.error(t('common.error'), t('common.saveFailed'));
      } finally {
        setSelfDoneBusyId(null);
      }
    },
    [refreshAfterWrite, t],
  );

  /** «Миний ажлаас хасах» (0370) — нэмсэн таск ч, ажиллаж байсан таск ч жагсаалтаас нуугдана
   *  (түүх, оноо, явц хөндөгдөхгүй).  Төслийн хуудаснаас дахин нэмэх эсвэл тэр таск дээр цаг
   *  эхлүүлэхэд буцаж гарна. */
  const [removingId, setRemovingId] = useState<number | null>(null);
  const removeFromList = useCallback(
    async (item: MyTaskItem) => {
      const ok = await confirmDialog({
        title: t('myTaskList.removeConfirmTitle'),
        description: t('myTaskList.removeConfirm', { name: item.name }),
        confirmText: t('myTaskList.remove'),
      });
      if (!ok) return;
      setRemovingId(item.id);
      try {
        await setInMyList(item.id, false);
        setSelected((prev) => {
          if (!prev.has(item.id)) return prev;
          const rest = new Set(prev);
          rest.delete(item.id);
          return rest;
        });
        toast.success(t('myTaskList.removed', { name: item.name }), t('myTaskList.removedHint'));
        invalidateMyList(queryClient);
      } catch (err) {
        const message =
          err instanceof ApiError && typeof err.payload.message === 'string'
            ? err.payload.message
            : t('common.saveFailed');
        toast.error(t('myTaskList.errTitle'), message);
      } finally {
        setRemovingId(null);
      }
    },
    [queryClient, t],
  );

  /** «Таскийг буцаах» (эзэн 2026-10-05) — буруу таск авч буруу хувь оруулсан бол тэр таскийг «би үүн дээр юу ч хийгээгүй»
   *  болгоно: миний хувь + оноо устаж, би таскийн нэр / хувь нэмэрчийн жагсаалтаас алга болно.  Албан таймерын цаг
   *  системд хэвээр (харагдахгүй), дахин авбал үргэлжилнэ.  Хуваарилагдсан таскийн бүртгэлийг «⋯ → Миний бүртгэл» засна. */
  const [retractingId, setRetractingId] = useState<number | null>(null);
  const retractTask = useCallback(
    async (item: MyTaskItem) => {
      const ok = await confirmDialog({
        title: t('myTaskRetract.confirmTitle'),
        description: t('myTaskRetract.confirm', { name: item.name }),
        confirmText: t('myTaskRetract.confirmText'),
      });
      if (!ok) return;
      setRetractingId(item.id);
      try {
        await retractMyTask(item.id);
        setSelected((prev) => {
          if (!prev.has(item.id)) return prev;
          const rest = new Set(prev);
          rest.delete(item.id);
          return rest;
        });
        clearDrafts([item.id]);
        toast.success(t('myTaskRetract.done', { name: item.name }), t('myTaskRetract.doneHint'));
        invalidateMyList(queryClient);
        void queryClient.invalidateQueries({ queryKey: OFFICIAL_TIMER_STATE_KEY });
        void queryClient.invalidateQueries({ queryKey: CONTRIBUTORS_PREFIX });
        window.dispatchEvent(new CustomEvent('progress:submitted'));
        void recentQuery.refetch();
      } catch (err) {
        const message =
          err instanceof ApiError && typeof err.payload.message === 'string'
            ? err.payload.message
            : t('common.saveFailed');
        toast.error(t('myTaskRetract.errTitle'), message);
      } finally {
        setRetractingId(null);
      }
    },
    [queryClient, t, clearDrafts, recentQuery],
  );

  const postProgress = async (
    item: MyTaskItem,
    pct: number,
    completionQa?: Record<string, string>,
  ) => {
    const d = getDraft(item);
    setSubmittingId(item.id);
    try {
      await apiFetch('/progress', {
        method: 'POST',
        data: {
          date: today,
          task_id: item.id,
          percentage: pct,
          notes: d.notes || undefined,
          attachments: d.attachments.length > 0 ? d.attachments : undefined,
          completion_qa: completionQa,
        },
      });
      clearDrafts([item.id]);
      setBulkErrors((prev) => {
        if (!prev.has(item.id)) return prev;
        const next = new Map(prev);
        next.delete(item.id);
        return next;
      });
      setSelected((prev) => {
        if (!prev.has(item.id)) return prev;
        const next = new Set(prev);
        next.delete(item.id);
        return next;
      });
      refreshAfterWrite();
      return true;
    } catch (err) {
      if (
        err instanceof ApiError &&
        err.status === 400 &&
        err.payload.error === 'completion_qa required'
      ) {
        return { needsCompletion: true as const };
      }
      // Таск энэ хооронд хуваарилагдсан («managed») болсон — хуучин % маягт хаагдсан; жагсаалтыг шинэчилнэ.
      if (err instanceof ApiError && err.payload.error === 'MANAGED_ROOT') {
        toast.info(t('taskAlloc.own.nowManaged'));
        myTasksQuery.refetch();
        return false;
      }
      console.error(err);
      toast.error(t('common.error'), t('common.saveFailed'));
      return false;
    } finally {
      setSubmittingId(null);
    }
  };

  const submitRow = async (item: MyTaskItem) => {
    const d = getDraft(item);
    const pct = parseFloat(d.value);
    if (isNaN(pct) || pct < 0 || pct > 100) return;

    if (pct >= 100) {
      // Open the Q&A dialog up-front so the worker can answer before the
      // POST. The server also enforces this — the dialog just keeps the UX
      // smooth instead of relying on the 400 round-trip.
      const initial: Record<string, string> = {};
      for (const q of item.completion_questions) initial[q.id] = '';
      setCompletionAnswers(initial);
      setCompletionError(null);
      setCompletionFor(item);
      return;
    }

    await postProgress(item, pct);
  };

  // ─────────────────────── Бөөнөөр илгээх ───────────────────────
  //
  // Мөр бүрд Send дарах нь 15 таск = 15 үйлдэл байсан.  Одоо мөрүүдээ
  // тэмдэглээд «+10%» → «Илгээх» хоёр л үйлдэл.
  //
  // ⚠️ 100%-д хүрэх мөрүүд bulk-д ОРОХГҮЙ: тэдгээр нь дуусгах асуултын
  // хариу шаарддаг тул ганцаарчилсан dialog-оор л илгээгдэнэ.  Тэднийг
  // энд «түгжигдсэн» гэж тоолж, самбарт тодорхой хэлнэ.

  /** Сонгосон мөр бөөнд яг ЯМАР төлөвт байгаа вэ.  Гурван «явахгүй»
   *  шалтгааныг ялгаж хэлэх нь чухал — «хувь бөглөөгүй» ба «100% тул
   *  тусдаа дуусгана» хоёрыг нэг тоо болгочихвол ажилтан яагаад
   *  илгээгдээгүйг ойлгохгүй. */
  type BulkState = 'ok' | 'needsDialog' | 'empty' | 'locked';
  const bulkStateOf = useCallback(
    (item: MyTaskItem): BulkState => {
      if (item.current_progress >= 100) return 'locked';
      const pct = parseFloat(getDraft(item).value);
      if (!Number.isFinite(pct) || pct < 0 || pct > 100) return 'empty';
      // 100% нь дуусгах асуултуудыг шаарддаг — тэр нь ганцаарчилсан dialog.
      return pct >= 100 ? 'needsDialog' : 'ok';
    },
    [getDraft],
  );

  /** Сонгож болох мөрүүд — дууссан ба цагаар бүртгэгддэг (0339) мөрийг оруулахгүй. */
  const selectableItems = useMemo(
    () =>
      filtered.filter(
        (i) =>
          i.current_progress < 100 &&
          !i.self_done &&
          !isHoursRow(i) &&
          i.can_report !== false &&
          // Хуваарилагдсан таск өөрийн хяналтаар (−/+ , 5 сек хадгалалт) хадгалагддаг — бөөнд ОРОХГҮЙ.
          !i.allocation,
      ),
    [filtered],
  );

  /** «Ажилласан» тэмдэглэгээ илгээгдэж буй мөрийн id. */
  const [markingId, setMarkingId] = useState<number | null>(null);

  /** Засварын цонхны түүх нь өөр query — тэмдэглэгээний дараа түүнийг ч
   *  шинэчилнэ (ирцийн «Гарах» төлвийг `refreshAfterWrite` шинэчилнэ). */
  const refreshRepairViews = useCallback(() => {
    refreshAfterWrite();
    void queryClient.invalidateQueries({ queryKey: ['/repair/my'] });
  }, [queryClient, refreshAfterWrite]);

  /** «Өнөөдөр энэ таск дээр ажилласан» (0348) — цаг БИЧИХГҮЙ.  Сервер тухайн
   *  өдрийн бүх бөглөлтөөс цагийг хуваарилдаг тул бусад мөрийн цаг ч
   *  өөрчлөгдөж болно — жагсаалтыг бүхэлд нь шинэчилнэ. */
  const markWorked = useCallback(
    async (item: MyTaskItem) => {
      setMarkingId(item.id);
      try {
        const res = await apiFetch<{ created: boolean; hours: number }>('/repair', {
          method: 'POST',
          data: { project_id: item.project_id, task_id: item.id },
        });
        toast.success(t('myTasksPage.markedToast', { hours: hoursText(Number(res?.hours ?? 0)) }));
        refreshRepairViews();
      } catch (err) {
        toast.error(t('common.error'), err instanceof ApiError ? err.message : t('common.saveFailed'));
      } finally {
        setMarkingId(null);
      }
    },
    [refreshRepairViews, t],
  );

  /** Өнөөдрийн тэмдэглэгээг болиулна — тэр өдрийн цаг бусад ажилд дахин хуваагдана. */
  const unmarkWorked = useCallback(
    async (item: MyTaskItem) => {
      const markId = item.repair_today?.mark_id;
      if (!markId) return;
      setMarkingId(item.id);
      try {
        await apiFetch(`/repair/marks/${markId}`, { method: 'DELETE' });
        toast.success(t('myTasksPage.unmarkedToast'));
        refreshRepairViews();
      } catch (err) {
        toast.error(t('common.error'), err instanceof ApiError ? err.message : t('common.saveFailed'));
      } finally {
        setMarkingId(null);
      }
    },
    [refreshRepairViews, t],
  );

  const selectedItems = useMemo(() => items.filter((i) => selected.has(i.id)), [items, selected]);
  const bulkBuckets = useMemo(() => {
    const ok: MyTaskItem[] = [];
    let needsDialog = 0;
    let empty = 0;
    for (const item of selectedItems) {
      const state = bulkStateOf(item);
      if (state === 'ok') ok.push(item);
      else if (state === 'needsDialog') needsDialog += 1;
      else if (state === 'empty') empty += 1;
    }
    return { ok, needsDialog, empty };
  }, [selectedItems, bulkStateOf]);
  const sendableItems = bulkBuckets.ok;

  const toggleSelected = (id: number) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const selectAllVisible = () => setSelected(new Set(selectableItems.map((i) => i.id)));

  const bumpSelected = (delta: number) => {
    const ids = selectedItems.map((i) => i.id);
    const currentOf = (id: number) => items.find((i) => i.id === id)?.current_progress ?? 0;
    bumpValues(ids, delta, currentOf);
  };

  const submitBulk = async () => {
    if (sendableItems.length === 0) return;
    setBulkSubmitting(true);
    try {
      const payload = sendableItems.map((item) => {
        const d = getDraft(item);
        return {
          date: today,
          task_id: item.id,
          percentage: parseFloat(d.value),
          notes: d.notes || undefined,
          attachments: d.attachments.length > 0 ? d.attachments : undefined,
        };
      });

      const res = await apiFetch<{
        results: Array<{ task_id: number | null; ok: boolean; body: { error?: string } }>;
        saved: number;
        failed: number;
      }>('/progress/bulk', { method: 'POST', data: { entries: payload } });

      // Амжилттай мөрүүдийн ноорогийг л цэвэрлэнэ — амжилтгүй мөр нь
      // бичсэн хэвээрээ үлдэж, ажилтан дахин оролдоно.
      const savedIds = res.results.filter((r) => r.ok && r.task_id !== null).map((r) => r.task_id!);
      clearDrafts(savedIds);
      setBulkErrors((prev) => {
        const next = new Map(prev);
        for (const id of savedIds) next.delete(id);
        for (const r of res.results) {
          if (!r.ok && r.task_id !== null) next.set(r.task_id, r.body?.error ?? t('common.saveFailed'));
        }
        return next;
      });
      setSelected((prev) => {
        const next = new Set(prev);
        for (const id of savedIds) next.delete(id);
        return next;
      });
      refreshAfterWrite();

      if (res.failed > 0) {
        toast.warn(
          t('dailyReport.bulkPartialTitle', { saved: res.saved, failed: res.failed }),
          t('dailyReport.bulkPartialBody'),
        );
      } else {
        toast.success(t('dailyReport.bulkDoneTitle', { count: res.saved }));
      }
    } catch (err) {
      console.error(err);
      toast.error(t('common.error'), t('common.saveFailed'));
    } finally {
      setBulkSubmitting(false);
    }
  };

  /** «Өмнөх тайлан» самбараас тэмдэглэлээ өнөөдрийн ноорог руу хуулах. */
  const reuseNote = (taskId: number, notes: string) => {
    const item = items.find((i) => i.id === taskId);
    if (!item) return;
    patchDraft(item, { notes });
    toast.info(t('dailyReport.previousReusedTitle'), t('dailyReport.previousReusedBody'));
  };

  const submitCompletion = async () => {
    if (!completionFor) return;
    const item = completionFor;
    const missing = item.completion_questions.filter(
      (q) => !(completionAnswers[q.id] ?? '').trim(),
    );
    if (missing.length > 0) {
      setCompletionError(t('myTasksPage.answerAllQuestions', { count: missing.length }));
      return;
    }
    setCompletionError(null);
    const result = await postProgress(item, 100, completionAnswers);
    if (result === true) {
      setCompletionFor(null);
      setCompletionAnswers({});
    }
  };

  const activeCount = useMemo(
    () =>
      items.filter((i) => activeSet.has(i.project_id) && i.current_progress < 100 && !i.self_done)
        .length,
    [items, activeSet],
  );

  const inProgressCount = useMemo(
    () => items.filter((i) => i.current_progress < 100 && !i.self_done).length,
    [items],
  );

  const filterTabs: { key: FilterTab; label: string; count: number; tone?: string }[] = [
    { key: 'started', label: t('myTasksPage.tabInProgress'), count: inProgressCount },
    { key: 'active', label: t('myTasksPage.tabActive'), count: activeCount, tone: 'accent' },
    {
      key: 'overdue',
      label: t('myTasksPage.tabOverdue'),
      count: overdueCount,
      tone: 'destructive',
    },
    {
      key: 'completed',
      label: t('myTasksPage.tabCompleted'),
      count: summary.completed + (summary.self_done ?? 0),
    },
    { key: 'all', label: t('myTasksPage.tabAll'), count: summary.total },
  ];

  return (
    <PageContainer>
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-3 border-b border-border pb-5">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            {t('myTasksPage.title')}
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            {t('myTasksPage.subtitle', { name: formatDisplayName(user?.full_name) })}
          </p>
        </div>
        {/* Today's reporting banner (UB time) */}
        <div
          className={cn(
            'flex items-center gap-3 px-3 py-2 rounded-lg border',
            (summary.pending_today ?? 0) > 0
              ? 'bg-warning/10 border-warning/30'
              : 'bg-success/10 border-success/30',
          )}
        >
          <CalendarClock
            className={cn(
              'h-4 w-4 shrink-0',
              (summary.pending_today ?? 0) > 0 ? 'text-warning' : 'text-success',
            )}
          />
          <div className="text-xs leading-tight">
            <div className="font-medium text-foreground">{todayBannerUB()}</div>
            <div className="text-muted-foreground">
              {summary.pending_today === 0
                ? t('myTasksPage.allReportsSubmitted')
                : t('myTasksPage.reportsPending', {
                    pending: summary.pending_today ?? 0,
                    reported: summary.reported_today ?? 0,
                  })}
            </div>
            {/* Ноорог localStorage-д байгааг ил хэлнэ — эс бөгөөс ажилтан
                хуудсаа хаахаас эмээсээр л байна. */}
            {dirtyCount > 0 && (
              <div className="text-primary font-medium">
                {t('dailyReport.draftsSaved', { count: dirtyCount })}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Албан ёсны таскийн цаг — одоо аль таск явж байгаа, өнөөдрийн нийт, ⏸. */}
      <OfficialTimerBanner timer={officialTimer} />

      {/* Controls
       * `sec-mytasks-*` id-нууд нь глобал хайлтын гүн холбоосын бай
       * (`?section=<id>`) — `shared/lib/search/sections.ts`-тэй ижил байлгана. */}
      <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
        <div
          id="sec-mytasks-filters"
          className="flex gap-1 bg-muted/40 p-1 rounded-lg flex-wrap scroll-mt-24"
        >
          {filterTabs.map((tab) => {
            const active = filter === tab.key;
            const activeBg =
              tab.tone === 'destructive'
                ? 'bg-destructive text-destructive-foreground'
                : tab.tone === 'warn'
                  ? 'bg-warning text-warning-foreground'
                  : tab.tone === 'accent'
                    ? 'bg-info text-info-foreground'
                    : 'bg-primary text-primary-foreground';
            return (
              <button
                key={tab.key}
                onClick={() => changeFilter(tab.key)}
                className={cn(
                  'px-3 py-1.5 rounded-md text-sm font-medium transition-all',
                  active
                    ? `${activeBg} shadow-sm`
                    : 'text-muted-foreground hover:text-foreground hover:bg-muted/60',
                )}
              >
                {tab.label}
                <span
                  className={cn(
                    'ml-1.5 text-xs tabular-nums',
                    active ? 'opacity-80' : 'opacity-50',
                  )}
                >
                  {tab.count}
                </span>
              </button>
            );
          })}
        </div>
        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            aria-label={t('common.search')}
            placeholder={t('myTasksPage.searchPlaceholder')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8 w-52 h-9"
          />
        </div>
      </div>

      {/* Өмнөх тайлан — «өчигдөр би юу бичсэн бэ».  Жагсаалтын ДЭЭР байрлана:
          үргэлжлэл бичихийн өмнө хардаг зүйл. */}
      <PreviousReportsCard
        entries={recentEntries}
        today={today}
        loading={recentQuery.isLoading}
        onReuseNote={reuseNote}
      />

      {/* Засвар — ажилтны өөрөө бүртгэх засвар/нэмэлт ажил (leaderboard-д ордог). */}
      <div id="sec-mytasks-repair" className="scroll-mt-24">
        <RepairSection />
      </div>

      {/* Төслийн бус ажил (0342) — ирцээр бүртгэсэн ажил, «юу хийсэн» тайлбар,
          админы шалгалтын төлөв.  Засвараас ТУСДАА карт. */}
      <div id="sec-mytasks-non-project" className="scroll-mt-24">
        <NonProjectWorkSection />
      </div>

      {/* List
       * Rows are CSS-grid cards instead of a table: the long project title
       * can wrap, the progress + action buttons hug the right edge on wide
       * screens and drop below on narrow ones, so nothing ever forces the
       * page into horizontal scroll. */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      ) : loadError ? (
        <Card className="border-border bg-card/60 backdrop-blur overflow-hidden">
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <AlertTriangle className="h-12 w-12 text-destructive/40 mb-4" />
            <p className="font-medium text-foreground">{t('common.loadFailed')}</p>
            <p className="text-sm text-muted-foreground/60 mt-1">{t('common.errorBody')}</p>
            <Button
              variant="outline"
              size="sm"
              className="mt-4"
              onClick={() => myTasksQuery.refetch()}
            >
              {t('common.retry')}
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Card
          id="sec-mytasks-list"
          className="border-border bg-card/60 backdrop-blur overflow-hidden scroll-mt-24"
        >
          {filtered.length === 0 ? (
            <CardContent className="flex flex-col items-center justify-center py-16 text-center">
              <ListCheck className="h-12 w-12 text-muted-foreground/20 mb-4" />
              <p className="font-medium text-muted-foreground">
                {filter === 'active' && activeProjectIds.length === 0
                  ? t('myTasksPage.noActiveProject')
                  : filter === 'all' && !search
                    ? t('myTasksPage.noTasksAssigned')
                    : t('myTasksPage.noTasksMatchFilter')}
              </p>
              <p className="text-sm text-muted-foreground/60 mt-1">
                {filter === 'active' && activeProjectIds.length === 0
                  ? t('myTasksPage.noActiveProjectHint')
                  : search
                    ? t('myTasksPage.noResultsFor', { query: search })
                    : t('myTasksPage.tasksWillAppear')}
              </p>
            </CardContent>
          ) : (
            <>
              {/* Sort + block filter toolbar */}
              <div className="border-b border-border bg-muted/30">
                {/* Sort row */}
                <div className="px-4 py-2 flex items-center gap-2 flex-wrap">
                  <span className="text-[11px] uppercase tracking-wider text-muted-foreground mr-1">
                    {t('myTasksPage.sortLabel')}
                  </span>
                  {SORT_OPTIONS.map((opt) => {
                    const active = sortKey === opt.key;
                    return (
                      <Button
                        key={opt.key}
                        variant="ghost"
                        size="sm"
                        onClick={() => toggleSort(opt.key)}
                        className={cn(
                          'h-7 gap-1 border border-transparent px-2.5 text-xs',
                          active
                            ? 'border-primary/30 bg-primary/15 text-primary hover:bg-primary/15'
                            : 'text-muted-foreground',
                        )}
                      >
                        {t(opt.labelKey)}
                        {active &&
                          (sortDir === 'asc' ? (
                            <ArrowUp className="h-3 w-3" />
                          ) : (
                            <ArrowDown className="h-3 w-3" />
                          ))}
                      </Button>
                    );
                  })}

                  {/* Бөөнөөр илгээх эхлэл — мөр бүрийн checkbox-ыг олохоос
                      өмнө энэ товч л «сонголтын горим» гэдгийг ойлгуулна. */}
                  {selectableItems.length > 1 && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        selected.size === selectableItems.length
                          ? setSelected(new Set())
                          : selectAllVisible()
                      }
                      className={cn(
                        'ml-auto h-7 gap-1 border border-transparent px-2.5 text-xs',
                        selected.size > 0
                          ? 'border-primary/30 bg-primary/15 text-primary hover:bg-primary/15'
                          : 'text-muted-foreground',
                      )}
                    >
                      <CheckSquare className="h-3 w-3" />
                      {selected.size === selectableItems.length
                        ? t('dailyReport.bulkClear')
                        : t('dailyReport.bulkSelectAll')}
                      <span className="tabular-nums opacity-60">({selectableItems.length})</span>
                    </Button>
                  )}
                </div>
              </div>

              {(() => {
                // Group filtered tasks by project so the project name shows
                // up once as a header instead of repeating on every row.
                // We preserve the post-sort order: a project's first
                // occurrence in `filtered` becomes that group's position.
                const groups: {
                  project_id: number;
                  project_name: string;
                  items: typeof filtered;
                }[] = [];
                const indexByProject = new Map<number, number>();
                for (const it of filtered) {
                  const idx = indexByProject.get(it.project_id);
                  if (idx === undefined) {
                    indexByProject.set(it.project_id, groups.length);
                    groups.push({
                      project_id: it.project_id,
                      project_name: it.project_name,
                      items: [it],
                    });
                  } else {
                    groups[idx]!.items.push(it);
                  }
                }
                return groups.map((g) => (
                  <div key={g.project_id}>
                    <div className="sticky top-0 z-10 px-4 py-2 bg-muted/60 backdrop-blur border-y border-border flex items-center gap-2">
                      {/* Төслийн нэр → төслийн хуудас, ШУУД миний таскийн хэсэгт
                          (`?mine=1`: зөвхөн надад хуваарилагдсан таск + гүйлгэлт). */}
                      <Link
                        to={`/app/projects/${g.project_id}?mine=1`}
                        title={t('myTasksPage.openProject')}
                        className="group/proj -my-1 inline-flex min-w-0 items-center gap-2 rounded py-1 pr-1 text-foreground transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <FolderOpen className="h-3.5 w-3.5 text-primary shrink-0" />
                        <span className="text-xs font-semibold truncate underline-offset-2 group-hover/proj:underline">
                          {g.project_name}
                        </span>
                        <ArrowUpRight className="h-3 w-3 shrink-0 opacity-0 transition-opacity group-hover/proj:opacity-100 group-focus-visible/proj:opacity-100 pointer-coarse:opacity-60" />
                      </Link>
                      <span className="ml-auto text-[10px] text-muted-foreground tabular-nums shrink-0">
                        {t('myTasksPage.taskCount', { count: g.items.length })}
                      </span>
                    </div>
                    <ul className="divide-y divide-border/60">
                      {g.items.map((item) => {
                        const isDone = item.current_progress >= 100;
                        // Ажилтан өөрөө хаасан мөр — таск нь 100% болоогүй ч
                        // энэ хүний хувьд дууссан.  Мөрийг «дууссан» шиг
                        // хураангуй харуулж, өдөр тутмын маягтыг нуулаа.
                        const selfClosed = !isDone && item.self_done;
                        const selfDoneBusy = selfDoneBusyId === item.id;
                        const isActive = item.current_progress > 0 && !isDone && !selfClosed;
                        // Блок › зураг › бүрдэл — блок нь мөрөн дээрээ харагдана; төслийн
                        // нэр нь бүлгийн толгойд.  (Блокийн чип-шүүлтүүр байхгүй —
                        // бүх төслийн ижил нэртэй блокуудыг нэг чип болгож
                        // хольдог байсан.)
                        const breadcrumb = `${item.block_name} › ${item.drawing_name} › ${item.component_name}`;

                        const due = dueMeta(item.due_date, isDone || selfClosed, t);
                        const isOverdue = due?.tone === 'overdue';
                        const rowKey = `${item.item_type}-${item.id}`;
                        const draft = getDraft(item);
                        const submitting = submittingId === item.id;
                        const pctNum = parseFloat(draft.value);
                        const hoursRow = isHoursRow(item);
                        // Хувь оруулах = энэ таск дээр миний цаг эхэлж байсан (сервер 403
                        // TAKE_REQUIRED) — эс бөгөөс мөрийн «Эхлүүлэх».  undefined = хуучин сервер.
                        const canReport = item.can_report !== false;
                        const managed = !!item.allocation;
                        const selectable = !isDone && !selfClosed && !hoursRow && canReport && !managed;
                        // ОДОО хэн ажиллаж байна — ~10 сек тутмын шууд мэдээлэл (ачаалагдаагүй
                        // бол жагсаалтын хариунд ирсэн агшны утга).
                        const workingNow = liveWorkers.loaded
                          ? (liveWorkers.byTask.get(item.id) ?? [])
                          : (item.working ?? []);
                        const othersWorking = workingNow.filter((w) => w.user_id !== user?.id);
                        const runningHere = officialTimer.running?.task_id === item.id;
                        const isSelected = selected.has(item.id);
                        const previous = previousByTask.get(item.id);
                        const canSubmit =
                          !isDone &&
                          !selfClosed &&
                          !hoursRow &&
                          canReport &&
                          !submitting &&
                          !bulkSubmitting &&
                          !isNaN(pctNum) &&
                          pctNum >= 0 &&
                          pctNum <= 100;

                        return (
                          <li
                            key={rowKey}
                            className={cn(
                              'group px-4 py-3 transition-colors',
                              isSelected
                                ? 'bg-primary/5'
                                : officialTimer.running?.task_id === item.id
                                  ? 'bg-success/5 shadow-[inset_3px_0_0_0_var(--color-success)]'
                                  : isOverdue
                                  ? 'bg-destructive/5'
                                  : isDone || selfClosed
                                    ? 'hover:bg-success/5'
                                    : 'hover:bg-muted/20',
                            )}
                          >
                            <div className="grid gap-3 md:gap-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
                              {/* Left: title + meta */}
                              <div className="min-w-0">
                                <div className="flex items-center gap-2 flex-wrap">
                                  {selectable ? (
                                    <Checkbox
                                      checked={isSelected}
                                      onCheckedChange={() => toggleSelected(item.id)}
                                      disabled={bulkSubmitting}
                                      aria-label={t('dailyReport.selectRow', { name: item.name })}
                                      className="flex-shrink-0"
                                    />
                                  ) : (
                                    <div
                                      className={cn(
                                        'h-2 w-2 rounded-full flex-shrink-0',
                                        isDone
                                          ? 'bg-success'
                                          : selfClosed
                                            ? 'bg-success/50'
                                            : isActive
                                              ? 'bg-warning'
                                              : 'bg-muted-foreground/30',
                                      )}
                                    />
                                  )}
                                  <span
                                    className={cn(
                                      'font-medium text-sm break-words',
                                      isDone || selfClosed
                                        ? 'text-muted-foreground line-through'
                                        : 'text-foreground',
                                    )}
                                  >
                                    {item.name}
                                  </span>
                                  <Badge
                                    variant="outline"
                                    className="text-[10px] font-medium capitalize h-5 px-1.5 bg-primary/10 text-primary border-primary/20"
                                  >
                                    {t('myTasksPage.taskBadge')}
                                  </Badge>
                                  {selfClosed && (
                                    <Badge
                                      variant="outline"
                                      className="text-[10px] h-5 gap-1 border-success/40 bg-success/10 text-success"
                                      title={t('myTasksPage.selfDoneBadgeTitle')}
                                    >
                                      <CheckSquare className="h-2.5 w-2.5" />
                                      {t('myTasksPage.selfDoneBadge')}
                                    </Badge>
                                  )}
                                  {/* ОДОО энэ таск дээр өөр хүн ажиллаж байна (нэр л). */}
                                  {othersWorking.length > 0 && !isDone && (
                                    <span
                                      className="inline-flex h-5 items-center gap-1 rounded-md border border-success/30 bg-success/10 px-1.5 text-label normal-case tracking-normal text-success"
                                      data-testid="mytask-working"
                                    >
                                      <span className="h-1.5 w-1.5 rounded-full bg-success" aria-hidden />
                                      {t('myTasksPage.workingNow', {
                                        names: othersWorking
                                          .map((w) => formatDisplayName(w.full_name ?? ''))
                                          .join(', '),
                                      })}
                                    </span>
                                  )}
                                  {due && (
                                    <span
                                      className={cn(
                                        'inline-flex items-center gap-1 text-[11px] font-medium ml-auto md:ml-0',
                                        due.tone === 'overdue'
                                          ? 'text-destructive'
                                          : due.tone === 'today'
                                            ? 'text-warning'
                                            : due.tone === 'soon'
                                              ? 'text-warning'
                                              : 'text-muted-foreground',
                                      )}
                                    >
                                      {due.tone === 'overdue' ? (
                                        <AlertTriangle className="h-3 w-3" />
                                      ) : (
                                        <CalendarClock className="h-3 w-3" />
                                      )}
                                      {due.label}
                                    </span>
                                  )}
                                </div>
                                <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                                  <span className="inline-flex items-center gap-1 min-w-0 flex-wrap">
                                    {breadcrumb.split(' › ').map((part, i, arr) => (
                                      <span key={i} className="inline-flex items-center gap-1">
                                        <span className="truncate max-w-[240px]">{part}</span>
                                        {i < arr.length - 1 && (
                                          <ChevronRight className="h-3 w-3 flex-shrink-0 text-muted-foreground/40" />
                                        )}
                                      </span>
                                    ))}
                                  </span>
                                </div>

                                {/* Өмнөх тайлан — үргэлжлэл бичихэд хэрэгтэй.
                                    Тэмдэглэл нь `title`-д бүтнээрээ, мөрөнд
                                    богиносгож харагдана; дарвал өнөөдрийн
                                    ноорог руу хуулна. */}
                                {previous && !isDone && !selfClosed && !hoursRow && (
                                  <button
                                    type="button"
                                    onClick={() => reuseNote(item.id, previous.notes ?? '')}
                                    disabled={!previous.notes}
                                    title={previous.notes ?? undefined}
                                    className={cn(
                                      'mt-1.5 inline-flex max-w-full items-center gap-1.5 rounded-md border px-1.5 py-1',
                                      'border-border/70 bg-muted/30 text-[11px] text-muted-foreground',
                                      previous.notes
                                        ? 'hover:bg-muted/60 hover:text-foreground transition-colors'
                                        : 'cursor-default',
                                    )}
                                  >
                                    <History className="h-3 w-3 shrink-0" />
                                    <span className="tabular-nums shrink-0">
                                      {previous.date} · {previous.percentage}%
                                    </span>
                                    {previous.notes && (
                                      <span className="truncate text-foreground/70">
                                        {previous.notes}
                                      </span>
                                    )}
                                  </button>
                                )}
                              </div>

                              {/* Right: inline daily-report form (% + note popover + image popover + send).
                            Done rows collapse to a "Дууссан" pill that opens the read-only summary. */}
                              {/* `flex-wrap` заавал: `ui/button.tsx` нь `shrink-0`
                                  болон `whitespace-nowrap`-ыг өгөгдмөлөөр тавьдаг тул
                                  прогресс(160) + % талбар(64) + 3×32px товч ≈ 340px
                                  болж 360px дэлгэцийн ~300px зайд багтахгүй, Layout-ийн
                                  `overflow-x-hidden` нь гүйлгэхийн оронд ТАСЛАНА —
                                  илгээх товч хүрэлцэхгүй болно. */}
                              <div className="flex flex-wrap items-center gap-2 sm:gap-3 md:justify-end">
                                {/* Албан ёсны таймер (0361) — «Миний ажлууд»-аас ШУУД эхлүүлнэ
                                    (= «Өөртөө авах», `useTakeTask`: ирцгүй → алдаа, өөр хүн
                                    ажиллаж буй таск → «Хувааж авах» цонх).  Явж буйг «Зогсоох»;
                                    дууссан мөрөнд миний нийт цаг л. */}
                                <TaskTimerControl
                                  timer={officialTimer}
                                  taskId={item.id}
                                  taskName={item.name}
                                  projectName={item.project_name}
                                  canRun={canTake && !isDone && !selfClosed}
                                  onStart={() =>
                                    take({
                                      id: item.id,
                                      name: item.name,
                                      weight_percent: item.weight_percent,
                                      progress: item.current_progress,
                                    })
                                  }
                                  busy={takingId === item.id}
                                />
                                {hoursRow ? (
                                  /* Засварын (цагаар бодогддог) таск — ХУВЬ биш АЖИЛЛАСАН
                                     ЦАГ (2026-09-24): «Би 3 цаг · нийт 8 цаг». */
                                  <div
                                    className="flex min-w-0 flex-wrap items-center gap-1.5 text-xs tabular-nums"
                                    data-testid="hours-row-worked"
                                  >
                                    {/* Өнөөдрийн систем хуваарилсан цаг (0348) — өдрийн
                                        турш бусад бөглөлтөөр өөрчлөгдөж болно. */}
                                    {item.repair_today && (
                                      <span
                                        className="inline-flex items-center gap-1 rounded-md border border-success/40 bg-success/10 px-1.5 py-0.5 font-semibold text-success whitespace-nowrap"
                                        title={t('myTasksPage.todayHoursTitle')}
                                        data-testid="hours-row-today"
                                      >
                                        <CheckCircle2 className="h-3 w-3 shrink-0" />
                                        {t('myTasksPage.todayHours', { hours: hoursText(item.repair_today.hours) })}
                                      </span>
                                    )}
                                    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                                      <Clock className="h-3.5 w-3.5 shrink-0 text-primary" />
                                      <span className="font-semibold text-foreground">
                                        {t('myTasksPage.hoursMine', {
                                          hours: item.repair_hours?.mine ?? 0,
                                        })}
                                      </span>
                                      {(item.repair_hours?.total ?? 0) > (item.repair_hours?.mine ?? 0) && (
                                        <span className="text-muted-foreground">
                                          · {t('myTasksPage.hoursTotal', { hours: item.repair_hours?.total ?? 0 })}
                                        </span>
                                      )}
                                    </span>
                                  </div>
                                ) : (
                                  <div className="flex min-w-0 max-w-full flex-1 items-center gap-2 sm:min-w-[160px] sm:max-w-[260px]">
                                    <Progress
                                      value={Math.min(item.current_progress, 100)}
                                      className="h-1.5 flex-1"
                                    />
                                    <span className="text-[10px] text-muted-foreground tabular-nums whitespace-nowrap">
                                      {t('myTasksPage.currentPct', { pct: item.current_progress })}
                                    </span>
                                    {item.reported_today && (
                                      <CheckCircle2 className="h-3 w-3 shrink-0 text-success" />
                                    )}
                                  </div>
                                )}

                                {isDone ? (
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    className="h-8 text-xs px-2 text-success"
                                    onClick={() => setDoneItem(item)}
                                    title={t('myTasksPage.doneDetailTitle')}
                                  >
                                    <CheckCircle2 className="h-4 w-4 mr-1" />
                                    {t('myTasksPage.done')}
                                  </Button>
                                ) : hoursRow && !selfClosed ? (
                                  /* Засварын (ZA, цагаар бодогддог) таск: хувь ч, цаг ч
                                     бичихгүй — «Ажилласан» гэж тэмдэглэнэ, цагийг сервер
                                     өдрийн бөглөлтүүдээс бодно (0348). */
                                  <div className="flex items-center gap-1" data-testid="hours-row-actions">
                                    <span className="hidden sm:inline text-[11px] text-muted-foreground">
                                      {t('myTasksPage.hoursModeHint')}
                                    </span>
                                    {item.repair_today ? (
                                      <Button
                                        size="sm"
                                        variant="ghost"
                                        className="h-8 gap-1.5 text-xs text-muted-foreground hover:text-foreground"
                                        onClick={() => void unmarkWorked(item)}
                                        disabled={markingId === item.id || bulkSubmitting}
                                        title={t('myTasksPage.unmarkWorkedTitle')}
                                        data-testid="hours-row-unmark"
                                      >
                                        {markingId === item.id ? (
                                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                        ) : (
                                          <Undo2 className="h-3.5 w-3.5" />
                                        )}
                                        {t('myTasksPage.unmarkWorked')}
                                      </Button>
                                    ) : (
                                      <Button
                                        size="sm"
                                        variant="outline"
                                        className="h-8 gap-1.5 text-xs"
                                        onClick={() => void markWorked(item)}
                                        disabled={markingId === item.id || bulkSubmitting}
                                        title={t('myTasksPage.markWorkedTitle')}
                                        data-testid="hours-row-mark"
                                      >
                                        {markingId === item.id ? (
                                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                        ) : (
                                          <CheckCircle2 className="h-3.5 w-3.5" />
                                        )}
                                        {t('myTasksPage.markWorked')}
                                      </Button>
                                    )}
                                    {canSelfClose(item) && (
                                      <Button
                                        size="sm"
                                        variant="outline"
                                        onClick={() => void toggleSelfDone(item, true)}
                                        disabled={selfDoneBusy || bulkSubmitting}
                                        className="h-8 w-8 p-0 border-success/40 text-success hover:bg-success/10 hover:text-success"
                                        title={t('myTasksPage.selfDoneActionTitle')}
                                        aria-label={t('myTasksPage.selfDoneAction')}
                                      >
                                        {selfDoneBusy ? (
                                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                        ) : (
                                          <CheckSquare className="h-3.5 w-3.5" />
                                        )}
                                      </Button>
                                    )}
                                  </div>
                                ) : item.allocation && !selfClosed ? (
                                  /* Хуваарилагдсан («managed») үндсэн ажил — өөрийн хэсгийн хяналт: −/+ (нийт зорилтын
                                     10% / 1%), «Үлдсэн ажлаа дуусгах», 5 сек хадгалалт; дуусгах асуулт зорилтод хүрэх үед.
                                     Явц нь `current_progress` (үндсэн ажлын хувь) биш — ХҮНИЙ хэсэг (D/T). */
                                  <div
                                    className="flex flex-wrap items-center gap-1.5"
                                    data-testid="managed-row"
                                    data-task-id={item.id}
                                  >
                                    {ownBaseOf(item, user?.id) ? (
                                      <OwnProgressControl
                                        base={ownBaseOf(item, user?.id)}
                                        questions={item.completion_questions}
                                        taskName={item.name}
                                        disabledReason={canReport ? null : t('taskAlloc.own.needTimer')}
                                        report={{ notes: draft.notes, attachments: draft.attachments }}
                                        onSaved={() => clearDrafts([item.id])}
                                      />
                                    ) : (
                                      <span className="text-[11px] text-muted-foreground" data-testid="managed-no-share">
                                        {item.allocation.my
                                          ? t('taskAlloc.own.shareDone')
                                          : t('taskAlloc.own.noShare')}
                                      </span>
                                    )}
                                    {item.allocation.my && ownBaseOf(item, user?.id) && (
                                      <>
                                        {/* Тэмдэглэл */}
                                        <Popover>
                                          <PopoverTrigger asChild>
                                            <Button
                                              size="sm"
                                              variant="outline"
                                              className={cn(
                                                'h-8 w-8 p-0 relative',
                                                draft.notes && 'border-primary/40 text-primary',
                                              )}
                                              title={t('myTasksPage.notesTitle')}
                                            >
                                              <MessageSquare className="h-3.5 w-3.5" />
                                              {draft.notes && (
                                                <span className="absolute top-1 right-1 h-1.5 w-1.5 rounded-full bg-primary" />
                                              )}
                                            </Button>
                                          </PopoverTrigger>
                                          <PopoverContent className="w-72 p-3 space-y-2" align="end">
                                            <p className="text-xs font-medium text-foreground">
                                              {t('myTasksPage.todayNotes')}
                                            </p>
                                            <Textarea
                                              value={draft.notes}
                                              onChange={(e) => patchDraft(item, { notes: e.target.value })}
                                              placeholder={t('myTasksPage.todayNotesPlaceholder')}
                                              rows={4}
                                              className="text-sm"
                                            />
                                          </PopoverContent>
                                        </Popover>
                                        <AttachmentsPopover
                                          attachments={draft.attachments}
                                          onChange={(next) => patchDraft(item, { attachments: next })}
                                          disabled={bulkSubmitting}
                                        />
                                        <TaskChecklistPopover
                                          taskId={item.id}
                                          done={item.checklist?.done ?? 0}
                                          total={item.checklist?.total ?? 0}
                                          disabled={bulkSubmitting}
                                          onApplyPercent={(pct) =>
                                            ownProgressStore.setUnits(
                                              item.id,
                                              Math.round(((item.allocation?.my?.target_units ?? 0) * pct) / 100),
                                            )
                                          }
                                          onCountsChanged={() => myTasksQuery.refetch()}
                                        />
                                      </>
                                    )}
                                    {/* ⋯ Хуваарилалт засах · Үлдсэн ажлаа буцаах · Миний бүртгэл (явц, цаг) */}
                                    <ManagedRowActions
                                      task={{ id: item.id, name: item.name }}
                                      canRelease={(item.allocation.my?.future_units ?? 0) > 0}
                                      canUnsplit
                                      onChanged={() => void refetchMyTasks()}
                                    />
                                  </div>
                                ) : !selfClosed && !canReport ? (
                                  /* Энэ таск дээр миний цаг хараахан эхлээгүй (нэмсэн таск) —
                                     хувь оруулахгүй; мөрийн «Эхлүүлэх»-ээр эхлүүлнэ. */
                                  <span
                                    className="text-[11px] text-muted-foreground"
                                    data-testid="mytask-start-hint"
                                  >
                                    {canTake ? t('myTaskList.startToReport') : t('myTaskList.notStarted')}
                                  </span>
                                ) : selfClosed ? (
                                  /* Буцаах гарц — эндээс өөр хаана ч байхгүй тул
                                     алдаатай тэмдэглэгээг засах цорын ганц зам. */
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    className="h-8 text-xs px-2 text-muted-foreground hover:text-foreground"
                                    onClick={() => void toggleSelfDone(item, false)}
                                    disabled={selfDoneBusy}
                                    title={t('myTasksPage.selfDoneReopenTitle')}
                                  >
                                    {selfDoneBusy ? (
                                      <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                                    ) : (
                                      <History className="h-4 w-4 mr-1" />
                                    )}
                                    {t('myTasksPage.selfDoneReopen')}
                                  </Button>
                                ) : (
                                  <div className="flex items-center gap-1">
                                    <PercentStepper
                                      step={PLAIN_TASK_STEP_PCT}
                                      value={draft.value}
                                      onChange={(v) => patchDraft(item, { value: v })}
                                      onEnter={canSubmit ? () => submitRow(item) : undefined}
                                    />

                                    {/* Notes popover */}
                                    <Popover>
                                      <PopoverTrigger asChild>
                                        <Button
                                          size="sm"
                                          variant="outline"
                                          className={cn(
                                            'h-8 w-8 p-0 relative',
                                            draft.notes && 'border-primary/40 text-primary',
                                          )}
                                          title={t('myTasksPage.notesTitle')}
                                        >
                                          <MessageSquare className="h-3.5 w-3.5" />
                                          {draft.notes && (
                                            <span className="absolute top-1 right-1 h-1.5 w-1.5 rounded-full bg-primary" />
                                          )}
                                        </Button>
                                      </PopoverTrigger>
                                      <PopoverContent className="w-72 p-3 space-y-2" align="end">
                                        <p className="text-xs font-medium text-foreground">
                                          {t('myTasksPage.todayNotes')}
                                        </p>
                                        <Textarea
                                          value={draft.notes}
                                          onChange={(e) =>
                                            patchDraft(item, { notes: e.target.value })
                                          }
                                          placeholder={t('myTasksPage.todayNotesPlaceholder')}
                                          rows={4}
                                          className="text-sm"
                                        />
                                      </PopoverContent>
                                    </Popover>

                                    {/* Олон хавсралт — зураг / PDF / DWG / скриншот */}
                                    <AttachmentsPopover
                                      attachments={draft.attachments}
                                      onChange={(next) =>
                                        patchDraft(item, { attachments: next })
                                      }
                                      disabled={bulkSubmitting}
                                    />

                                    {/* Хувийн checklist — ажлаа задлах (жингүй) */}
                                    <TaskChecklistPopover
                                      taskId={item.id}
                                      done={item.checklist?.done ?? 0}
                                      total={item.checklist?.total ?? 0}
                                      disabled={bulkSubmitting}
                                      onApplyPercent={(pct) =>
                                        patchDraft(item, { value: String(pct) })
                                      }
                                      onCountsChanged={() => myTasksQuery.refetch()}
                                    />

                                    {/* «Миний хийх ажил дууссан» — ЗӨВХӨН
                                        засварын төсөл (ZA).  Хувь БИЧИХГҮЙ:
                                        зөвхөн энэ мөрийг миний жагсаалтаас
                                        нуух бөгөөд «Дууссан» табаас буцаана. */}
                                    {canSelfClose(item) && (
                                      <Button
                                        size="sm"
                                        variant="outline"
                                        onClick={() => void toggleSelfDone(item, true)}
                                        disabled={selfDoneBusy || bulkSubmitting}
                                        className="h-8 w-8 p-0 border-success/40 text-success hover:bg-success/10 hover:text-success"
                                        title={t('myTasksPage.selfDoneActionTitle')}
                                        aria-label={t('myTasksPage.selfDoneAction')}
                                      >
                                        {selfDoneBusy ? (
                                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                        ) : (
                                          <CheckSquare className="h-3.5 w-3.5" />
                                        )}
                                      </Button>
                                    )}

                                    <Button
                                      size="sm"
                                      onClick={() => submitRow(item)}
                                      disabled={!canSubmit}
                                      className="h-8 w-8 p-0"
                                      title={t('myTasksPage.submitReport')}
                                    >
                                      {submitting ? (
                                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                      ) : (
                                        <Send className="h-3.5 w-3.5" />
                                      )}
                                    </Button>
                                  </div>
                                )}

                                {/* «Таскийг буцаах» — миний хувь + оноо устаж, таск дээрээс нэр алга болно (цаг системд хэвээр).
                                    Хуваарилагдсан / цагаар бодогддог таскт байхгүй (тэдгээрийн бүртгэл өөр замаар засагдана). */}
                                {!item.allocation && item.project_progress_mode !== 'hours' && (
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    onClick={() => void retractTask(item)}
                                    disabled={retractingId === item.id || bulkSubmitting}
                                    className="h-8 gap-1 px-2 text-xs text-muted-foreground hover:text-destructive"
                                    title={t('myTaskRetract.title')}
                                    aria-label={t('myTaskRetract.button')}
                                    data-testid="mytask-retract"
                                  >
                                    {retractingId === item.id ? (
                                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                    ) : (
                                      <Undo2 className="h-3.5 w-3.5" />
                                    )}
                                    <span className="hidden xl:inline">{t('myTaskRetract.button')}</span>
                                  </Button>
                                )}

                                {/* «Миний ажлаас хасах» (0370) — явж буй таскаас бусад мөрөнд. */}
                                {!runningHere && (
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    onClick={() => void removeFromList(item)}
                                    disabled={removingId === item.id || bulkSubmitting}
                                    className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive"
                                    title={t('myTaskList.removeTitle')}
                                    aria-label={t('myTaskList.remove')}
                                    data-testid="mytask-remove"
                                  >
                                    {removingId === item.id ? (
                                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                    ) : (
                                      <BookmarkMinus className="h-3.5 w-3.5" />
                                    )}
                                  </Button>
                                )}
                              </div>
                            </div>
                            {bulkErrors.has(item.id) && (
                              <p
                                className="mt-2 flex items-start gap-1.5 text-xs text-destructive"
                                role="alert"
                                data-testid="mytask-bulk-error"
                              >
                                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
                                <span>
                                  {t('dailyReport.bulkRowFailed')}: {bulkErrors.get(item.id)}
                                </span>
                              </p>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ));
              })()}

              <div className="px-4 py-3 border-t border-border flex items-center justify-between text-xs text-muted-foreground">
                <span>{t('myTasksPage.taskCount', { count: filtered.length })}</span>
                <span>
                  {t('myTasksPage.completedOf', {
                    completed: summary.completed,
                    total: summary.total,
                  })}
                  {summary.total > 0 && (
                    <span className="ml-1 text-primary font-medium">
                      ({Math.round((summary.completed / summary.total) * 100)}%)
                    </span>
                  )}
                </span>
              </div>
            </>
          )}
        </Card>
      )}

      {/* Сонгосон мөрүүдийг нэг дор — доод самбар (сонголт хоосон бол нуугдана).
          `pb` нэмэлт зай: самбар байхад жагсаалтын сүүл халхлагдахгүй. */}
      {selected.size > 0 && <div aria-hidden className="h-14" />}
      <BulkReportBar
        selectedCount={selected.size}
        sendableCount={sendableItems.length}
        needsDialogCount={bulkBuckets.needsDialog}
        emptyCount={bulkBuckets.empty}
        submitting={bulkSubmitting}
        onBump={bumpSelected}
        onSelectAll={selectAllVisible}
        onClear={() => setSelected(new Set())}
        onSubmit={submitBulk}
      />

      {/* 100% — completion summary (no daily report required) */}
      <Dialog open={!!doneItem} onOpenChange={(open) => !open && setDoneItem(null)}>
        <DialogContent className="sm:max-w-md" onOpenAutoFocus={(e) => e.preventDefault()}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-success" />
              {t('myTasksPage.taskCompleted')}
            </DialogTitle>
          </DialogHeader>
          {doneItem && (
            <div className="space-y-3 py-1">
              <p className="text-sm text-muted-foreground">
                {t('myTasksPage.completedExplainBefore')}{' '}
                <span className="text-foreground font-medium">100%</span>{' '}
                {t('myTasksPage.completedExplainAfter')}
              </p>
              <div className="p-3 rounded-lg border border-success/25 bg-success/5">
                <p className="font-medium text-foreground">{doneItem.name}</p>
                <p className="text-xs text-muted-foreground mt-1">{doneItem.project_name}</p>
                <div className="mt-2">
                  <ProgressCell value={doneItem.current_progress} />
                </div>
              </div>
              {doneItem.ai_completion_summary ? (
                <div className="rounded-lg border border-primary/20 bg-primary/5 p-3 space-y-1.5">
                  <div className="flex items-center gap-1.5 text-[11px] font-medium text-primary uppercase tracking-wide">
                    <Sparkles className="h-3 w-3" />
                    {t('myTasksPage.aiSummary')}
                  </div>
                  <p className="text-sm leading-relaxed whitespace-pre-wrap text-foreground/90">
                    {doneItem.ai_completion_summary}
                  </p>
                </div>
              ) : (
                <div className="rounded-lg border border-dashed border-border bg-muted/20 p-3 text-xs text-muted-foreground flex items-center gap-2">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  {t('myTasksPage.aiSummaryPreparing')}
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button onClick={() => setDoneItem(null)}>{t('common.close')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 100% completion — Q&A before submitting so the AI summary has substance. */}
      <Dialog
        open={!!completionFor}
        onOpenChange={(open) => {
          if (!open) {
            setCompletionFor(null);
            setCompletionAnswers({});
            setCompletionError(null);
          }
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-success" />
              {t('myTasksPage.finishTask')}
            </DialogTitle>
          </DialogHeader>
          {completionFor && (
            <div className="space-y-4 py-1">
              <div className="text-xs text-muted-foreground">
                <p className="font-medium text-foreground text-sm">{completionFor.name}</p>
                <p className="mt-0.5">{completionFor.project_name}</p>
              </div>
              <p className="text-xs text-muted-foreground">
                {t('myTasksPage.completionInstruction')}
              </p>
              <div className="space-y-3">
                {completionFor.completion_questions.map((q) => (
                  <div key={q.id} className="space-y-1.5">
                    <label className="text-xs font-medium text-foreground">{q.text}</label>
                    <Textarea
                      value={completionAnswers[q.id] ?? ''}
                      onChange={(e) =>
                        setCompletionAnswers((prev) => ({ ...prev, [q.id]: e.target.value }))
                      }
                      rows={3}
                      className="text-sm"
                      placeholder={t('myTasksPage.answerPlaceholder')}
                    />
                  </div>
                ))}
              </div>
              {completionError && <p className="text-xs text-destructive">{completionError}</p>}
            </div>
          )}
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setCompletionFor(null);
                setCompletionAnswers({});
                setCompletionError(null);
              }}
              disabled={submittingId === completionFor?.id}
            >
              {t('myTasksPage.cancel')}
            </Button>
            <Button onClick={submitCompletion} disabled={submittingId === completionFor?.id}>
              {submittingId === completionFor?.id ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> {t('myTasksPage.sending')}
                </>
              ) : (
                <>
                  {t('myTasksPage.finish')} <Send className="h-3.5 w-3.5 ml-1.5" />
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* «Авах» (▶) амжилтгүй болсон үед: өөр хүн ажиллаж буй таск → хуваарилалтын засварлагч («авч эхлэх»),
          ирээдүйн ажилгүй → чөлөөт ажил авах / хуваарилалт засах (`TakeFlowDialogs`, төслийн хуудастай ИЖИЛ). */}
      <TakeFlowDialogs flow={flow} timer={officialTimer} onClose={closeFlow} onDone={() => void refetchMyTasks()} />
    </PageContainer>
  );
}
