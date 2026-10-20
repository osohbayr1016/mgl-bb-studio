import { useState, useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useLanguage } from '@/shared/i18n';
import { apiFetch } from '@/shared/api/client';
import { PageContainer } from '@/shared/components/PageContainer';
import { useApiQuery } from '@/shared/api/useApi';
import type {
  ProjectWithProgress,
  ClientInput,
  ClientType,
  ProjectCategory,
  ProjectDetailResponse,
  ProjectMeetingRow,
  ProjectScopeRow,
  ProjectTimelineRow,
} from '@/shared/types';
/* «Эх төсөл» сонгогч — «Бүтэц татах»-тай НЭГ л хэрэгжүүлэлт (migration
 * 0254).  Энэ хуудсанд зөвхөн МЕТА-г урьдчилан бөглөхөд, тохиргооны
 * хуудсанд бүтцийг хуулахад ижил компонент ажиллана. */
import { SourceProjectPicker } from '@/features/projects/setup/copy/SourceProjectPicker';
import {
  formatTemplateShares,
  templateFor,
  useCategoryTemplates,
  type TemplateApplyResult,
} from '@/features/projects/categoryTemplates';
import { Checkbox } from '@/ui/checkbox';
import {
  cleanProjectBaseName,
  cleanProjectCode,
  composeProjectName,
  projectDateCode,
} from '@/features/projects/lib/projectName';
/* «PROJECT DESCRIPTION» Word загварын хэсгүүд — төслийн «Мэдээлэл»
 * хуудастай ЯГ ижил бүрэлдэхүүн хэсгүүдийг хуваалцана (2 газарт
 * хуулбарлавал жагсаалт, анхдагч мөр нь зөрнө). */
import {
  PassportDocumentEditor,
  type PassportDocDraft,
} from '@/features/projects/components/passport/PassportDocumentEditor';
import type {
  IntroDocRow,
  IntroOverride,
} from '@/features/performance-reports/types/introOverride';
import {
  buildScopeFileName,
  defaultMeetingRows,
  defaultScopeRows,
  dropUntouchedPrefill,
  prefilledTimelineRows,
  seedScopeRows,
  toIsoDate,
} from '@/features/projects/components/passport/passportSections';
import { todayDotted } from '@/shared/lib/dottedDate';
import { toStoredName } from '@/shared/lib/formatting';
import {
  DEFAULT_COMPLEXITY_PCT,
  clampComplexityPct,
  complexityPctColor,
  defaultComplexityPctFor,
} from '@/shared/lib/complexity';
import { ComplexityPicker } from '@/features/projects/components/ComplexityPicker';
// Шууд файлаас — barrel (`@/features/deadlines`) нь DeadlineList зэрэг
// хүнд компонентуудыг дагуулж энэ хуудасны chunk-д оруулна.
import { useDeadlineSummary } from '@/features/deadlines/api';
import { DeadlineBarMarks } from '@/features/deadlines/DeadlineBarMarks';
import { ProjectDeadlineChip } from '@/features/deadlines/ProjectDeadlineChip';
import { ProjectDeadlineHover } from '@/features/deadlines/ProjectDeadlineHover';
import type { DeadlinePoint, DeadlineSummary } from '@/features/deadlines/types';
import {
  PROJECT_CATEGORIES,
  PROJECT_CATEGORY_CODES,
  categoryName,
} from '@/shared/lib/project-categories';
import { Card, CardContent, CardTitle, CardDescription } from '@/ui/card';
import { toast } from '@/shared/components/Toast';
import { confirmDialog } from '@/shared/components/ConfirmDialog';
import { Progress } from '@/ui/progress';
import { Button } from '@/ui/button';
import { Badge } from '@/ui/badge';
import { Input } from '@/ui/input';
import { Label } from '@/ui/label';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/ui/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
  DialogClose,
} from '@/ui/dialog';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '@/shared/context/AuthContext';
import {
  FolderKanban,
  Plus,
  Sparkles,
  MoreHorizontal,
  Loader2,
  Search,
  ArrowUpDown,
  FolderOpen,
  Trash2,
  Building2,
  User as UserIcon,
  AlertTriangle,
  Activity,
  CalendarClock,
  GripVertical,
  Pin,
  PinOff,
  RotateCcw,
  Link2,
  Link2Off,
  LayoutTemplate,
} from 'lucide-react';
import { cn } from '@/shared/lib/utils';
import { DndContext, closestCenter, type DragEndEvent } from '@dnd-kit/core';
import { useAppDndSensors } from '@/shared/lib/dndSensors';
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
  arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { DraggableAttributes } from '@dnd-kit/core';

import { formatDate } from '@/shared/lib/time';
type ClientDraft = ClientInput & { _key: string };

const mkClient = (type: ClientType = 'company'): ClientDraft => ({
  _key: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
  type,
  name: '',
  share_percent: 0,
});

/** `activity` — ӨГӨГДМӨЛ (2026-09-18, эзний хүсэлт): хамгийн олон хүн
 *  оролцсон / ирцээ бүртгүүлсэн / явц бичсэн төсөл дээр.  Оноог сервер
 *  тооцно (`lib/projectActivity.ts`), энд зөвхөн харьцуулна. */
type SortKey = 'manual' | 'activity' | 'name' | 'progress' | 'created_at';

type SortableHandle = {
  attributes: DraggableAttributes;
  listeners: ReturnType<typeof useSortable>['listeners'];
};

/** Drag-reorder wrapper for a project row.  Provides the grip-handle props via
 *  render-prop (null when not draggable) so the rich card JSX stays inline. */
function SortableProjectItem({
  id,
  disabled,
  children,
}: {
  id: string;
  disabled: boolean;
  children: (handle: SortableHandle | null) => React.ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
    disabled,
  });
  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.5 : 1,
        zIndex: isDragging ? 20 : undefined,
      }}
    >
      {children(disabled ? null : { attributes, listeners })}
    </div>
  );
}
type SortDir = 'asc' | 'desc';
type StatusFilter = 'assigned' | 'all' | 'active' | 'completed' | 'archived';

const STATUS_CONFIG = {
  active: { labelKey: 'projectsPage.statusActive', class: 'bg-primary/10 text-primary border-primary/20' },
  completed: {
    labelKey: 'projectsPage.statusCompleted',
    class: 'bg-success/10 text-success border-success/20',
  },
  archived: { labelKey: 'projectsPage.statusArchived', class: 'bg-muted text-muted-foreground border-border' },
};

const startOfLocalDay = (date: Date) =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate());

function parseDateOnly(value: string | null | undefined) {
  if (!value) return null;
  const [year, month, day] = value.slice(0, 10).split('-').map(Number);
  if (!year || !month || !day) return null;
  const date = new Date(year, month - 1, day);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatPercent(value: number | null | undefined) {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n)) return '0';
  return n.toFixed(2).replace(/\.?0+$/, '');
}

function getScheduleProgress(project: ProjectWithProgress) {
  const start = parseDateOnly(project.start_date);
  const finish = parseDateOnly(project.finish_date);
  if (!start || !finish || finish.getTime() < start.getTime()) return null;

  const today = startOfLocalDay(new Date()).getTime();
  const startMs = start.getTime();
  const finishMs = finish.getTime();
  if (finishMs === startMs) return today >= finishMs ? 100 : 0;

  const elapsed = ((today - startMs) / (finishMs - startMs)) * 100;
  return Math.max(0, Math.min(100, elapsed));
}

function CompactProgressLine({
  icon: Icon,
  value,
  title,
  caption,
  tone = 'primary',
  overlay,
}: {
  icon: React.ComponentType<{ className?: string }>;
  value: number | null | undefined;
  title: string;
  caption?: string;
  tone?: 'primary' | 'muted';
  /** Баарны ДЭЭР нэмж зурах давхарга (жнь хугацааны тэмдэглэгээ).
   *  `Progress` нь `overflow-hidden` тул түүний ДОТОР тавьсан цухуйсан
   *  зүйл тасарна — иймд ороогч `relative` блокт ах дүү болгож тавина. */
  overlay?: React.ReactNode;
}) {
  const hasValue = value != null && Number.isFinite(Number(value));
  const pct = hasValue ? Math.max(0, Math.min(100, Number(value))) : 0;
  // Баар 100-д таслагдана, бичигдэх тоо — ЖИНХЭНЭ (засварын төсөл 100%-аас давж болно, 2026-09-29).
  const shown = hasValue ? Math.max(0, Number(value)) : 0;

  const bar = (
    <div className="relative min-w-0 flex-1">
      <Progress value={pct} className={cn('h-1.5 w-full', !hasValue && 'opacity-30')} />
      {overlay}
    </div>
  );

  if (caption) {
    return (
      <div className="w-full space-y-1 text-micro leading-none">
        <div className="text-micro font-semibold tracking-wide text-muted-foreground">
          {caption}
        </div>
        <div className="flex items-center gap-2">
          <Icon
            className={cn(
              'h-3.5 w-3.5 shrink-0',
              tone === 'primary' ? 'text-primary' : 'text-muted-foreground',
            )}
            aria-label={title}
          />
          {bar}
          <span className="w-14 text-right font-semibold tabular-nums text-muted-foreground">
            {hasValue ? `${formatPercent(shown)}%` : '—'}
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex w-full items-center gap-2 text-micro leading-none">
      <Icon
        className={cn(
          'h-3.5 w-3.5 shrink-0',
          tone === 'primary' ? 'text-primary' : 'text-muted-foreground',
        )}
        aria-label={title}
      />
      {bar}
      <span className="w-14 text-right font-semibold tabular-nums text-muted-foreground">
        {hasValue ? `${formatPercent(shown)}%` : '—'}
      </span>
    </div>
  );
}

/**
 * «Төслийн хугацаа» — цаг хугацааны баар (0% = эхлэх огноо, 100% = дуусах
 * огноо, дүүргэлтийн ирмэг = өнөөдөр).
 *
 * Эцсийн хугацаанууд нь ЯГ ЭНЭ баар дээр тэмдэглэгдэнэ: тэнхлэг нь огноо
 * тул байрлал нь үнэн утгатай.  Дүүргэлтийн ирмэгээс зүүн талын зураас =
 * хугацаа нь өнгөрсөн, баруун талынх = хараахан болоогүй.  «Нийт ажлын
 * явц» баарны тэнхлэг нь хувь тул тэнд огноо байрлуулах боломжгүй —
 * `DeadlineBarMarks`-ийн толгойг үз.
 */
function ScheduleProgress({
  project,
  points,
}: {
  project: ProjectWithProgress;
  points: DeadlinePoint[] | undefined;
}) {
  const { t } = useLanguage();
  const scheduleProgress = getScheduleProgress(project);

  return (
    <CompactProgressLine
      icon={CalendarClock}
      value={scheduleProgress}
      title={t('projectsPage.scheduleProgress')}
      caption={t('projectsPage.scheduleProgress')}
      tone="muted"
      overlay={
        <DeadlineBarMarks
          points={points}
          startDate={project.start_date}
          finishDate={project.finish_date}
        />
      }
    />
  );
}

/** Шинэ төслийн 1.3-ын өнөөдрөөр бөглөсөн ч хэрэглэгч хараахан засаагүй мөрүүд. */
const PREFILL_UNTOUCHED: ReadonlySet<string> = new Set(['tl-finish', 'tl-ext']);
const NO_IDS: ReadonlySet<string> = new Set();

export default function ProjectsPage() {
  const { t } = useLanguage();
  const navigate = useNavigate();
  /* Баримтын «Project title» ба «Drawing No. (Зургийн шифр)» нь дээрх нэр,
   * кодоос АВТОМАТААР бөглөгдөж, бичих бүрт дагаж шинэчлэгдэнэ (эзний
   * хүсэлт 2026-09-28: «нэг удаа бичээд хоёр газарт зэрэг»).  `null` =
   * холбоотой (утгыг `docTitle` / `docDrawingNo` гаргана).  Баримт дээр
   * тусад нь засвал тэр утга ЭНД хадгалагдаж холбоо салана — харин ТӨСЛИЙН
   * НЭР, КОДЫГ ХЭЗЭЭ Ч өөрчлөхгүй: бодит паспортуудад «Project title» нь
   * «“АЧИД-ОРГ” ХХК-ИЙН …» гэх мэт урт албан нэр, шифр нь «MEC-25/21» —
   * нэр/кодоос ялгаатай байдаг (прод хуулбар дээр хэмжсэн), тиймээс баримт
   * → нэр чиглэлд бичвэл төсөл «MGL-260928-“АЧИД-ОРГ” ХХК-ИЙН …-AZ» болно. */
  const [newFullTitle, setNewFullTitle] = useState<string | null>(null);
  const [newDrawingNo, setNewDrawingNo] = useState<string | null>(null);
  const [newScopeText, setNewScopeText] = useState('');
  const [newDirector, setNewDirector] = useState('');
  const [newDisciplines, setNewDisciplines] = useState<string[]>([]);
  /** «Client Project manager / Төслийн менежер» — баримтын 1.1-ийн мөр.
   *  Хадгалахдаа `client_contacts[0].full_name` болно. */
  const [newCeo, setNewCeo] = useState('');
  /** 1.1-ийн доорх «Бичиг баримт» хүснэгт.  Төсөл үүссэний ДАРАА мөр
   *  тус бүрээр `POST /:id/client-documents` руу явна. */
  const [newDocuments, setNewDocuments] = useState<IntroDocRow[]>([]);
  /* 1.2 — `null` = хэрэглэгч хүснэгтэд хүрээгүй: БҮХ дисциплин (ЕТ-г
   * оролцуулан) автоматаар харагдана, файлын нэр нь төслийн нэр/эхлэх огноог
   * дагана.  Нэг нүд засмагц тэр үеийн мөрүүд state болж цаашид хөдлөхгүй. */
  const [newScopeRows, setNewScopeRows] = useState<ProjectScopeRow[] | null>(null);
  /* 1.2-ын «File name»-ийг ГАРААР засварласан мөрүүдийн id.  Бусад мөрийн
   * файлын нэр нь хүснэгтийн өөр нүд (ахлах, мэргэжилтэн) засагдсан ч төслийн
   * нэр / эхлэх огноог үргэлж дагана — урьд нь ганц нүд засмагц бүх файлын
   * нэр хуучин нэрээрээ хөлддөг байсан тул дээр нэр солиход баримт дагадаггүй. */
  const [scopeFileManual, setScopeFileManual] = useState<ReadonlySet<string>>(NO_IDS);
  /* 1.3 — гурван мөр өнөөдрөөр бөглөгдөнө.  `tlUntouched`-д байгаа
   * Дуусах/Сунгалт нь ЗӨВХӨН харагдах утга, хадгалахад хоосон явна
   * (`dropUntouchedPrefill` — эзний шийдвэр 2026-09-25). */
  const [newTimeline, setNewTimeline] = useState<ProjectTimelineRow[]>(() =>
    prefilledTimelineRows(todayDotted()),
  );
  const [tlUntouched, setTlUntouched] = useState<ReadonlySet<string>>(PREFILL_UNTOUCHED);
  /* Уулзалтын хуваарийг 10/40/80/100 %-иар ХАРУУЛНА (баримт дээр
   * тэдгээр мөр байдаг тул хэрэглэгч огноог нь шууд бөглөнө).  Хадгалахдаа
   * ЗӨВХӨН огноотой мөрийг илгээнэ — хоосон шошго DB рүү орохгүй. */
  const [newMeetings, setNewMeetings] = useState<ProjectMeetingRow[]>(defaultMeetingRows());
  /* POST /projects амжилттай болоод паспортын PUT унавал ЭНД id үлдэнэ:
   * дахин «Үүсгэх» дарахад ХОЁР ДАХЬ төсөл үүсэхгүй, зөвхөн паспорт
   * дахин бичигдэнэ. */
  const [createdId, setCreatedId] = useState<number | null>(null);
  const { user } = useAuth();
  const canConfigureProjects =
    user?.role === 'admin' ||
    user?.role === 'senior';
  // Complexity weight нь дотоод оноо/үнэлгээний үзүүлэлт — аппын бусад
  // газартай (Хувь нэмэр карт, leaderboard) ижил, зөвхөн admin-tier харна.
  // Инженер, архитектор, ахлах (senior), харилцагчид харагдахгүй.
  const isAdminTier = user?.role === 'admin';
  const queryClient = useQueryClient();
  const projectsQuery = useApiQuery<{ projects: ProjectWithProgress[] }>('/projects');
  const projects = projectsQuery.data?.projects ?? [];
  const loading = projectsQuery.isPending;
  const isError = projectsQuery.isError;
  const refetchProjects = () => queryClient.invalidateQueries({ queryKey: ['/projects'] });
  // «Дээр бэхлэх» — ХЭРЭГЛЭГЧ ТУС БҮРИЙН хувийн хавчуурга (migration 0178).
  //
  // ЗОРИУД тусдаа хүсэлт болгосон: `/projects` бол аппын хамгийн хүнд асуулга
  // (`PROJECT_LIST_SQL`) бөгөөд түүнийг дөрвөн газраас БАЙРЛАЛААР нь bind
  // хийдэг тул SELECT-д нэг багана нэмэх нь MCP, харилцагчийн PDF, Timeline
  // гуравт нэгэн зэрэг гар хүрэхийг шаардана.  Энд ердөө id-уудын жагсаалт
  // ирнэ — эрэмбэлэлт нь доорх `filtered`-д client талдаа болно (ASAP-ыг ч
  // мөн адил энэ хуудас өөрөө дахин эрэмбэлдэг).
  const pinsQuery = useApiQuery<{ project_ids: number[] }>('/projects/pins');
  const pinnedIds = useMemo(
    () => new Set(pinsQuery.data?.project_ids ?? []),
    [pinsQuery.data],
  );
  /* Нэрийн ЗӨВХӨН суурь хэсэг («ABC»).  Бүтэн нэр «MGL-260925-ABC-AZ»-ийг
   * `newFullName` угсарна — код нь өнөөдрийн огноо, залгавар нь ангилал
   * (эзний шийдвэр 2026-09-25, `lib/projectName.ts`). */
  const [newName, setNewName] = useState('');
  const [newLocation, setNewLocation] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [newComplexityPct, setNewComplexityPct] = useState<number>(DEFAULT_COMPLEXITY_PCT);
  /* Төвөгшлийг admin гараар (эсвэл эх төслөөс) тогтоосон эсэх.  Тогтоогоогүй
   * үед ангилал сонгоход өгөгдмөл нь ангиллаас гарна (EZ → 10%) — гараар
   * оруулсан утгыг ангилал солих нь ХЭЗЭЭ Ч дарахгүй. */
  const [complexityTouched, setComplexityTouched] = useState(false);
  const setComplexityByHand = (pct: number) => {
    setNewComplexityPct(pct);
    setComplexityTouched(true);
  };
  const pickCategory = (code: ProjectCategory) => {
    setNewCategory(code);
    if (!complexityTouched) setNewComplexityPct(defaultComplexityPctFor(code));
  };
  // Category drives both the project type label and the backend's
  // auto-seeded project_team_shares roster. Required at create time.
  const [newCategory, setNewCategory] = useState<ProjectCategory | null>(null);
  /* Код нь өгөгдмөлөөр өнөөдрийн огноо («MGL-260928»), гэхдээ дарж засаж
   * болно (эзний хүсэлт 2026-09-28).  `null` = автомат — өдөр солигдоход
   * ч дагаж шинэчлэгдэнэ; хэрэглэгч бичсэн бол тэр утга хэвээр үлдэнэ. */
  const [newCodeOverride, setNewCodeOverride] = useState<string | null>(null);
  const autoCode = projectDateCode();
  const newCode = newCodeOverride ?? autoCode;
  const codeEdited = newCodeOverride !== null && cleanProjectCode(newCodeOverride) !== autoCode;
  const newFullName = composeProjectName(newName, newCategory, newCode);
  /* Баримт дээр харагдах утга: холбоотой үед дээрх талбараас (гарчиг = суурь
   * нэр, шифр = код — нэг ажлын AZ/ZA хоёр ижил шифртэй байдаг тул ангиллын
   * залгаваргүй), салсан үед баримт дээр бичсэн нь. */
  const linkedTitle = cleanProjectBaseName(newName);
  const linkedDrawingNo = cleanProjectCode(newCode);
  const docTitle = newFullTitle ?? linkedTitle;
  const docDrawingNo = newDrawingNo ?? linkedDrawingNo;
  const [newClients, setNewClients] = useState<ClientDraft[]>([mkClient()]);
  const [creating, setCreating] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  /* ---- «Эх төсөл» (migration 0254 · `projects.source_project_id`) ----
   * Засварын (ЗА) төсөл нь бараг үргэлж ӨМНӨ нь зурсан барилгын дахин
   * ажил.  Эх төслийг ЭНД сонгосноор хоёр зүйл болно:
   *   1. МЕТА (нарийвчлал, зургийн шифр, захиалагч) урьдчилан бөглөгдөнө —
   *      ИЛ, ЗАСВАРЛАГДАХУЙЦ, өөрөөр хэлбэл сервер тал чимээгүй хуулахгүй;
   *   2. Үүсгэсний дараа тохиргооны хуудас руу `?copyFrom=<id>`-тэй
   *      шилжинэ, тэнд «Бүтэц татах» цонх өөрөө нээгдэнэ.
   *
   * ⚠️ ОГНООГ ХЭЗЭЭ Ч урьдчилан бөглөхгүй (эхлэх/дуусах/сунгалт).
   * Хуулагдсан өнгөрсөн дуусах огноо нь `lib/projectRisk.ts`-д төслийг
   * ШУУД «хугацаа хэтэрсэн» болгож, өдөр тутмын `lib/deadlineSweep.ts`
   * cron нь багийн ахлагч нар руу БОДИТ мэдэгдэл илгээнэ.
   *
   * ⚠️ `canCreate`-д ОРОХГҮЙ: эх төсөл нь заавал биш. */
  const [newSourceId, setNewSourceId] = useState<number | null>(null);
  const [sourcePrefilled, setSourcePrefilled] = useState(false);
  const [sourceLoading, setSourceLoading] = useState(false);
  /* Баримтын хэсэг хумигдсан эсэх — эх төсөл урьдчилан бөглөхөд нээнэ. */
  const [docOpen, setDocOpen] = useState(false);
  /* ---- Ангиллын ЗАГВАР (2026-10-06, `features/projects/categoryTemplates.ts`) ----
   * Сонгосон ангилалд загвар төсөл тохируулсан бол (EZ → төсөл 75) сервер
   * түүний бүтэц, ажлын хуваарилалтыг шинэ төсөлд АВТОМАТААР хуулна.  Энд
   * зөвхөн юу хуулагдахыг ИЛ харуулж, хүсвэл унтраах боломж өгнө.  Эх төсөл
   * сонгосон бол сервер загварыг алгасна (бүтэц эх төслөөс татагдана). */
  const [useTemplate, setUseTemplate] = useState(true);
  const templatesQuery = useCategoryTemplates(isAdminTier && dialogOpen);
  const newTemplate = templateFor(templatesQuery.data?.templates, newCategory);

  // Table controls
  const [search, setSearch] = useState('');
  // Өгөгдмөл таб = «Хариуцсан» (эзэн 2026-09-28).
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('assigned');
  const [categoryFilter, setCategoryFilter] = useState<ProjectCategory | 'all'>('all');
  const [sortKey, setSortKey] = useState<SortKey>('activity');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  // Эрэмбэлэх горим — «Засах» товчоор асаахад картууд улаан болж, чирч болно.
  const [editMode, setEditMode] = useState(false);
  const toggleEditMode = () => {
    setEditMode((on) => {
      const next = !on;
      if (next) {
        // Эрэмбэлэхэд бүх төслийг гар дарааллаар (шүүлтгүй) харуулна.
        setSortKey('manual');
        setStatusFilter('all');
        setCategoryFilter('all');
        setSearch('');
      }
      return next;
    });
  };

  const fetchProjects = refetchProjects;

  // Sum of all non-empty client shares. When clients are specified we expect
  // this to equal 100, but we don't block saving — the UI just warns.
  const clientShareTotal = useMemo(
    () =>
      newClients.reduce((sum, c) => sum + (c.name.trim() ? Number(c.share_percent || 0) : 0), 0),
    [newClients],
  );
  const hasAnyClient = useMemo(
    () => newClients.some((c) => c.name.trim().length > 0),
    [newClients],
  );
  const shareStatus: 'ok' | 'off' | 'idle' = !hasAnyClient
    ? 'idle'
    : Math.abs(clientShareTotal - 100) < 0.01
      ? 'ok'
      : 'off';

  const resetCreateForm = () => {
    setNewName('');
    setNewCodeOverride(null);
    setNewLocation('');
    setNewDesc('');
    setNewComplexityPct(DEFAULT_COMPLEXITY_PCT);
    setComplexityTouched(false);
    setNewCategory(null);
    setNewClients([mkClient()]);
    setNewFullTitle(null);
    setNewDrawingNo(null);
    setNewScopeText('');
    setNewDirector('');
    setNewDisciplines([]);
    setNewCeo('');
    setNewDocuments([]);
    setNewScopeRows(null);
    setScopeFileManual(NO_IDS);
    setNewTimeline(prefilledTimelineRows(todayDotted()));
    setTlUntouched(PREFILL_UNTOUCHED);
    setNewMeetings(defaultMeetingRows());
    setCreatedId(null);
    setNewSourceId(null);
    setSourcePrefilled(false);
    setSourceLoading(false);
    setDocOpen(false);
    setUseTemplate(true);
  };

  /* Эх төсөл сонгох → МЕТА-г урьдчилан бөглөх.
   *
   * ⚠️ НЭГ дуудлага: `GET /api/projects/:id` нь төслийн мөр (нарийвчлал),
   * `clients` ба `passport`-ыг ХАМТ буцаадаг тул гурван эцсийн цэг рүү
   * тусад нь очих шаардлагагүй.
   *
   * ⚠️ Зөвхөн эх төсөл дээр УТГА БАЙВАЛ дарж бичнэ — эс бөгөөс сонголт нь
   * хэрэглэгчийн аль хэдийн бичсэн шифр/захиалагчийг ХООСОН болгоно. */
  const pickSourceProject = async (sid: number | null) => {
    setNewSourceId(sid);
    if (sid == null) {
      setSourcePrefilled(false);
      return;
    }
    setSourceLoading(true);
    try {
      const res = await apiFetch<ProjectDetailResponse>(`/projects/${sid}`);
      const cpx = Number(res?.project?.complexity_pct);
      if (Number.isFinite(cpx)) setComplexityByHand(clampComplexityPct(cpx));
      const shifr = (res?.passport?.drawing_no ?? '').trim();
      if (shifr) setNewDrawingNo(shifr);
      const srcClients = (res?.clients ?? []).filter((c) => (c.name ?? '').trim().length > 0);
      if (srcClients.length > 0) {
        setNewClients(
          srcClients.map((c) => ({
            ...mkClient(c.type === 'individual' ? 'individual' : 'company'),
            name: c.name.trim(),
            share_percent: Number(c.share_percent || 0),
          })),
        );
      }
      setSourcePrefilled(true);
      setDocOpen(true);
    } catch (e: unknown) {
      setSourcePrefilled(false);
      toast.error(
        t('projectsPage.sourceProjectLabel'),
        e instanceof Error ? e.message : t('common.error'),
      );
    } finally {
      setSourceLoading(false);
    }
  };

  /* ---- Баримтын хэлбэрийн 2 дахь алхам ----
   * Түлхүүрүүд нь `IntroAuto`-гийнхтэй ижил тул `ProjectIntroPage`-ийн
   * патчийг хөрвүүлэлгүйгээр шууд тарааж болно.  Захиалагч ба байршил нь
   * 1-р алхмын state-тэй ХОЛБОГДОНО — өөрөөр хэлбэл баримт дээр бичсэн нь
   * `POST /projects`-ийн ачаалалд шууд очно. */
  const tlStart = newTimeline.find((r) => r.id === 'tl-start')?.date || null;
  /* Файлын нэр нь код + нэртэй (автомат) мөрүүд төслийн нэр / эхлэх огноог
   * ҮРГЭЛЖ дагана; гараар бичсэн, эсвэл хоосон нэртэй мөр хөндөгдөхгүй. */
  /* ⚠️ Файлын нэрийн дунд ЗӨВХӨН суурь нэр («TEST») орно — бүтэн нэр
   * («MGL-261005-test») биш: огнонд аль хэдийн `261005_` угтвар байгаа тул бүтэн
   * нэр орвол код давхарддаг («261005_MGL_261005_TEST_EZ_A»). */
  const scopeRowsView = (newScopeRows ?? defaultScopeRows(linkedTitle, tlStart)).map((r) =>
    r.code && r.fileName && !scopeFileManual.has(r.id)
      ? { ...r, fileName: buildScopeFileName(tlStart, linkedTitle, r.code) }
      : r,
  );
  const docDraft: PassportDocDraft = {
    projectTitle: docTitle,
    clientName: newClients[0]?.name ?? '',
    drawingNo: docDrawingNo,
    scope: newScopeText,
    location: newLocation,
    director: newDirector,
    ceo: newCeo,
    disciplines: newDisciplines,
    documents: newDocuments,
    scopeRows: scopeRowsView,
    timeline: newTimeline,
    meetings: newMeetings,
  };

  const applyDocPatch = (patch: Partial<IntroOverride>) => {
    /* Баримт дээр бичсэн утга дээрхтэй ижил болж буцвал холбоо дахин
     * сэргэнэ — эс бөгөөс тусдаа утга болж хадгалагдана (нэр/кодыг хөндөхгүй). */
    if (patch.projectTitle !== undefined) {
      const v = patch.projectTitle;
      setNewFullTitle(v.trim() === linkedTitle ? null : v);
    }
    if (patch.clientName !== undefined) {
      const v = patch.clientName;
      /* ⚠️ Шинэ мөрд `share_percent: 100` — `mkClient()` нь 0 өгдөг тул
       * баримтын Client нүдэнд нэр бичмэгц `shareStatus` «off» болж,
       * Үүсгэх дарахад «хувь 100% болоогүй» гэсэн асуулт гардаг байв.  Тэр
       * хувийн талбар нь «Нэмэлт тохиргоо» дотор хаалттай байдаг тул
       * хэрэглэгч ХАРАГДАХГҮЙ талбарын тухай асуулгад хариулах болно. */
      setNewClients((prev) =>
        prev.length
          ? prev.map((c, i) => (i === 0 ? { ...c, name: v } : c))
          : [{ ...mkClient(), name: v, share_percent: 100 }],
      );
    }
    if (patch.drawingNo !== undefined) {
      const v = patch.drawingNo;
      setNewDrawingNo(v.trim() === linkedDrawingNo ? null : v);
    }
    if (patch.scope !== undefined) setNewScopeText(patch.scope);
    if (patch.location !== undefined) setNewLocation(patch.location);
    if (patch.director !== undefined) setNewDirector(patch.director);
    if (patch.ceo !== undefined) setNewCeo(patch.ceo);
    if (patch.disciplines !== undefined) setNewDisciplines(patch.disciplines);
    if (patch.documents !== undefined) setNewDocuments(patch.documents);
    if (patch.scopeRows !== undefined) {
      const next = patch.scopeRows;
      /* Харагдаж байсан файлын нэрээс өөр болсон мөр = хэрэглэгч гараар
       * бичсэн → тэр мөр цаашид нэрийг дагахгүй. */
      const shown = new Map(scopeRowsView.map((r) => [r.id, r.fileName]));
      const edited = next
        .filter((r) => shown.has(r.id) && shown.get(r.id) !== r.fileName)
        .map((r) => r.id);
      if (edited.length) setScopeFileManual((prev) => new Set([...prev, ...edited]));
      setNewScopeRows(next);
    }
    if (patch.timeline !== undefined) {
      const next = patch.timeline;
      // Огноог нь өөрчилсөн мөр «хэрэглэгч бичсэн» болж хадгалагдана.
      setTlUntouched((prev) => {
        const keep = new Set(
          [...prev].filter((id) => {
            const before = newTimeline.find((r) => r.id === id)?.date;
            const after = next.find((r) => r.id === id)?.date;
            return after !== undefined && before === after;
          }),
        );
        return keep.size === prev.size ? prev : keep;
      });
      setNewTimeline(next);
    }
    if (patch.meetings !== undefined) setNewMeetings(patch.meetings);
  };

  /* Үүсгэхийн ӨМНӨ заавал бөглөх зүйлс: ЗӨВХӨН нэр + ангилал + төвөгшил
   * (эзний шийдвэр 2026-09-15: «гурвыг нь сонгоод төслөө нээж болдог болго,
   * шифр гэх мэт мэдээллийг дараа нь оруулна»).  Төвөгшил нь өгөгдмөл
   * утгатай (`DEFAULT_COMPLEXITY_PCT`) тул үргэлж хангагдсан.  Баримтын
   * талбарууд (шифр, цар хүрээ, ажлын хэсэг) нь төслийн «Мэдээлэл» табаас
   * дараа нь бөглөгдөнө. */
  const canCreate = !!newFullName && !!newCategory;

  /* Паспортыг ЗӨВХӨН ямар нэг талбар бөглөсөн үед л бичнэ — хоосон
   * паспорт мөр үүсгэх нь «Мэдээлэл» таб дээр `passport` байхгүй
   * төслөөс ямар ч ялгаагүй атлаа нэг илүү хүсэлт. */
  const hasPassportInput =
    !!docTitle.trim() ||
    !!docDrawingNo.trim() ||
    !!newScopeText.trim() ||
    !!newDirector.trim() ||
    !!newCeo.trim() ||
    newDisciplines.length > 0 ||
    scopeRowsView.length > 0 ||
    newTimeline.some((r) => r.date) ||
    newMeetings.some((r) => r.date);

  const handleCreate = async () => {
    if (!newFullName) return;
    if (!newCategory) {
      toast.error(t('projectsPage.pickCategoryAlert'));
      return;
    }

    // Clients with an empty name are dropped; anything with a name is sent.
    const validClients: ClientInput[] = newClients
      .filter((c) => c.name.trim().length > 0)
      .map((c) => ({
        type: c.type,
        name: c.name.trim(),
        share_percent: Number(c.share_percent || 0),
      }));

    // Soft 100% validation — warn but still allow saving.
    if (validClients.length > 0 && shareStatus === 'off') {
      const total = clientShareTotal.toFixed(2).replace(/\.00$/, '');
      const ok = await confirmDialog({ description: t('projectsPage.shareNot100Confirm', { total }) });
      if (!ok) return;
    }

    /* ⚠️ 1.3-ын огооны нүд нь баримтын доторх чөлөөт текст (`EditableText`),
     * `<input type="date">` БИШ.  Сервер `normaliseTimeline` дээр зөвхөн
     * `trim()` хийгээд `start_date`/`finish_date` БАГАНАД шууд бичдэг —
     * тэдгээрийг `company.ts`-ийн хугацаа хэтэрсэн жагсаалт, `deadlineSweep`,
     * графикууд, захиалагчийн PDF уншина.  «2026 оны 9 сарын 1» гэх мэт мөр
     * орвол `' ' < '-'` тул төсөл шууд «хугацаа хэтэрсэн» болно.  Иймд энд
     * ISO болгож нормчилж, хөрвүүлж чадаагүйг нь БЛОКЛОНО. */
    const tlRows = dropUntouchedPrefill(newTimeline, tlUntouched).map((r) => ({
      ...r,
      date: toIsoDate(r.date),
    }));
    const mtRows = newMeetings.map((r) => ({ ...r, date: toIsoDate(r.date) }));
    const badDate = [...tlRows, ...mtRows].find(
      (r) => r.date && !/^\d{4}-\d{2}-\d{2}$/.test(r.date),
    );
    if (badDate) {
      toast.error(t('projectsPage.badDate'), badDate.date);
      return;
    }

    setCreating(true);
    try {
      // Backend auto-seeds project_team_shares from the category's
      // default roster — we intentionally don't send team_shares here.
      /* ⚠️ ХОЁР дараалсан хүсэлт, транзакцгүй.  Паспорт нь `project_id`-д
       * түлхүүрлэгддэг тул төслийн мөр ҮҮССЭНИЙ дараа л бичигдэнэ.
       * Тиймээс:
       *   • Маягтыг ХОЁУЛАА амжилттай болтол ЦЭВЭРЛЭХГҮЙ — эс бөгөөс
       *     паспорт унахад 1.2-ын мөрүүд, 1.3-ын огноо бүгд алга болж,
       *     скан хийсэн Word-оос дахин бичихээс өөр арга үлдэхгүй.
       *   • `createdId` нь дахин оролдоход ХОЁР ДАХЬ төсөл үүсгэхээс сэргийлнэ.
       *   • `navigate` нь ЗӨВХӨН бүрэн амжилттай үед — эс бөгөөс удаан
       *     хариу ирэхэд хэрэглэгчийг өөрийнх нь сонгосон хуудаснаас
       *     чирч аваачна. */
      let pid = createdId;
      if (pid == null) {
        // Backend auto-seeds project_team_shares from the category's
        // default roster — we intentionally don't send team_shares here.
        const created = await apiFetch<{
          project?: { id?: number };
          template?: TemplateApplyResult | null;
        }>('/projects', {
          data: {
            name: newFullName,
            description: newDesc,
            location: newLocation,
            complexity_pct: newComplexityPct,
            category: newCategory,
            clients: validClients,
            /* Эх төслийн холбоо (0254).  ⚠️ Сонгоогүй үед талбарыг ОГТ
             * илгээхгүй — `null` илгээх нь тэр багана байхгүй хуучин
             * сервер дээр шаардлагагүй эрсдэл. */
            ...(newSourceId != null ? { source_project_id: newSourceId } : {}),
            /* Ангиллын загвар — `false` үед л сервер хуулахгүй. */
            use_template: useTemplate,
          },
        });
        const nid = created?.project?.id;
        fetchProjects();
        if (typeof nid !== 'number') {
          // 2xx атал биет ирээгүй (apiFetch нь задлагдахгүй хариуг `{}`
          // болгодог) — паспортыг бичих id алга.  Маягтыг хэвээр үлдээнэ.
          toast.error(t('projectsPage.passportSaveFailed'), t('projectsPage.createdNoId'));
          setCreating(false);
          return;
        }
        pid = nid;
        setCreatedId(nid);
        const tpl = created?.template;
        if (tpl?.applied) {
          toast.success(
            t('projectsPage.templateApplied'),
            `${tpl.source_name} · ${t('projectsPage.templateCounts', tpl.counts)}`,
          );
        } else if (tpl && !tpl.applied) {
          toast.error(t('projectsPage.templateFailed'), t('projectsPage.templateFailedHint'));
        }
      }

      if (hasPassportInput) await apiFetch(`/projects/${pid}/passport`, {
        method: 'PUT',
        data: {
          full_title: docTitle.trim() || null,
          drawing_no: docDrawingNo.trim() || null,
          /* «Doc. No.» мөр 2026-09-28-нд хасагдсан — үргэлж хоосон. */
          doc_no: null,
          scope: newScopeText.trim() || null,
          director: newDirector.trim() || null,
          client_pm: null,
          disciplines: newDisciplines,
          /* «Chief executive officer / Гүйцэтгэх захирал» мөр нь паспортад
             ТУСДАА багана БИШ — `client_contacts[0]`-оос гардаг
             (`lib/introAuto.ts`).  Цуглуулаад илгээхгүй бол хэрэглэгчийн
             баримт дээр бичсэн нэр чимээгүй алга болно. */
          client_contacts: newCeo.trim()
            ? [{ full_name: toStoredName(newCeo), position: '', phone: '', email: '' }]
            : [],
          scope_rows: scopeRowsView,
          /* ⚠️ Огноогүй хүснэгтийг БҮҮ илгээ.  `normaliseTimeline` нь
           * шошготой мөрийг хадгалдаг тул хоосон 3 мөр ч `timeline_json`-ыг
           * NOT NULL болгож, дараа нь «Хуваарь» цонхноос тавьсан
           * `start_date`/`finish_date`-ыг паспорт хадгалахад NULL болгодог. */
          timeline: tlRows.some((r) => r.date) ? tlRows : [],
          meetings: mtRows.some((r) => r.date) ? mtRows : [],
          notes: null,
        },
      });

      /* Бичиг баримтын хүснэгт — багц route БАЙХГҮЙ тул мөр тус бүрээр.
       * Паспорт аль хэдийн хадгалагдсан тул энэ алхам унасан ч төсөл ба
       * тодорхойлолт бүрэн үлдэнэ: тусад нь мэдэгдээд үргэлжлүүлнэ. */
      /* ⚠️ Мөр бүрийг ТУСАД нь оролдоно.  Нэг `try` дотор давталт хийвэл
       * дунд нь унасан үед үлдсэн мөрүүд ОГТ илгээгдэхгүй атлаа доорх
       * `resetCreateForm()` тэднийг устгаж, диалог хаагдана — сканаас
       * буулгасан 5 мөрөөс 3 нь сэргээх боломжгүй алга болно. */
      const docRows = newDocuments.filter((d) => d.name.trim());
      const failedDocs: IntroDocRow[] = [];
      for (const [i, d] of docRows.entries()) {
        try {
          await apiFetch(`/projects/${pid}/client-documents`, {
            data: {
              doc_name: d.name.trim(),
              doc_no: d.no.trim() || null,
              doc_date: d.date.trim() || null,
              description: d.description.trim() || null,
              sort_order: i + 1,
            },
          });
        } catch {
          failedDocs.push(d);
        }
      }
      if (failedDocs.length) {
        /* Диалогийг НЭЭЛТТЭЙ үлдээнэ: `createdId` тавигдсан тул «Үүсгэх»-ийг
         * дахин дарахад ХОЁР ДАХЬ төсөл үүсэхгүй, зөвхөн унасан мөр дахин явна. */
        setNewDocuments(failedDocs);
        toast.error(
          t('projectsPage.docsSaveFailed'),
          failedDocs.map((d) => d.name).join(', '),
        );
        fetchProjects();
        setCreating(false);
        return;
      }

      /* ⚠️ `resetCreateForm()` нь `newSourceId`-ыг ЦЭВЭРЛЭНЭ — шилжих
       * хаягийг түүнээс ӨМНӨ барьж авна. */
      const srcId = newSourceId;
      resetCreateForm();
      setDialogOpen(false);
      fetchProjects();
      /* Эх төсөлтэй бол ШУУД тохиргооны хуудас руу: `?copyFrom=` нь «Бүтэц
       * татах» цонхыг өөрөө нээж, эх төслийг нь сонгосон байдлаар эхлүүлнэ
       * (`AdminProjectSetupPage` үүнийг `useSearchParams`-аар уншина,
       * `useState`-ээр БИШ).
       * `?tab=info` нь ProjectDetailPage-ийн PROJECT_TABS-ийн утга — мөн
       * адил URL-аас уншигддаг тул хоёулаа найдвартай холбоос. */
      navigate(
        srcId != null
          ? `/app/projects/${pid}/setup?copyFrom=${srcId}`
          : `/app/projects/${pid}?tab=info`,
      );
    } catch (e: unknown) {
      toast.error(
        createdId == null ? t('common.error') : t('projectsPage.passportSaveFailed'),
        e instanceof Error ? e.message : t('common.error'),
      );
    }
    setCreating(false);
  };

  const updateClient = (key: string, patch: Partial<ClientDraft>) => {
    setNewClients((prev) => prev.map((c) => (c._key === key ? { ...c, ...patch } : c)));
  };
  const addClientRow = (type: ClientType) => setNewClients((prev) => [...prev, mkClient(type)]);
  const removeClient = (key: string) => setNewClients((prev) => prev.filter((c) => c._key !== key));

  const handleArchive = async (id: number) => {
    if (!(await confirmDialog({ description: t('projectsPage.archiveConfirm'), variant: 'destructive' }))) return;
    try {
      await apiFetch(`/projects/${id}`, { method: 'PUT', data: { status: 'archived' } });
      fetchProjects();
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : t('common.error'));
    }
  };

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setSortKey(key);
      // Идэвх — их нь дээр байх нь л утгатай тул эхлээд буурахаар.
      setSortDir(key === 'activity' ? 'desc' : 'asc');
    }
  };

  const filtered = useMemo(() => {
    let list = [...projects];
    if (statusFilter === 'assigned') {
      // "Assigned" surfaces only the projects where the current logged-in
      // user is a project_member (signal comes from the backend's
      // `is_member` column on /api/projects). Admin/engineer/architect/
      // senior callers see every project by default, so this client-side
      // filter is the only way to narrow the list down to "what's mine".
      list = list.filter((p) => p.is_member === 1);
    } else if (statusFilter !== 'all') {
      list = list.filter((p) => p.status === statusFilter);
    }
    if (categoryFilter !== 'all') {
      list = list.filter((p) => p.category === categoryFilter);
    }
    if (search) list = list.filter((p) => p.name.toLowerCase().includes(search.toLowerCase()));
    list.sort((a, b) => {
      // Бэхэлсэн төсөл ХАМГИЙН дээр — ASAP-аас ч дээр.  Бэхлэлт бол хувь
      // хүний сонголт тул тухайн хэрэглэгчийн жагсаалтад л нөлөөлнө.
      //
      // ⚠ «Эрэмбэ засах» горимд ЗОРИУД алгасна: тэнд чирсэн дараалал нь
      //   ГЛОБАЛ `sort_order` болж бүх хүнд бичигддэг (`handleDragEnd`), тул
      //   нэг админы хувийн бэхлэлт компанийн дарааллыг дарж бичих ёсгүй.
      if (!editMode) {
        const aPin = pinnedIds.has(a.id) ? 1 : 0;
        const bPin = pinnedIds.has(b.id) ? 1 : 0;
        if (aPin !== bPin) return bPin - aPin;
      }
      // ASAP/яаралтай төсөл аль ч эрэмбэд ҮРГЭЛЖ хамгийн дээр.
      const aAsap = a.is_asap ? 1 : 0;
      const bAsap = b.is_asap ? 1 : 0;
      if (aAsap !== bAsap) return bAsap - aAsap;
      // Гар эрэмбэ — sort_order ASC (бага = дээр); ижил үед шинэ нь дээр.
      // sortDir-ийн нөлөөгүй (үргэлж тогтоосон дараалал).
      if (sortKey === 'manual') {
        const ao = a.sort_order ?? 0;
        const bo = b.sort_order ?? 0;
        if (ao !== bo) return ao - bo;
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      }
      let cmp = 0;
      if (sortKey === 'name') cmp = a.name.localeCompare(b.name);
      else if (sortKey === 'progress') cmp = a.progress - b.progress;
      else if (sortKey === 'activity') {
        // Оноо → сүүлийн үйл ажиллагаа (шинэ нь дээр) → гар дараалал.
        // Оноогүй (хуучин клиент / серверийн хариу дутуу) төсөл 0 гэж тооцно.
        cmp = (a.activity?.score ?? 0) - (b.activity?.score ?? 0);
        if (cmp === 0) {
          const al = a.activity?.last_activity_at ?? '';
          const bl = b.activity?.last_activity_at ?? '';
          cmp = al < bl ? -1 : al > bl ? 1 : 0;
        }
        if (cmp === 0) cmp = (b.sort_order ?? 0) - (a.sort_order ?? 0);
      } else cmp = new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return list;
  }, [projects, statusFilter, categoryFilter, search, sortKey, sortDir, pinnedIds, editMode]);

  // Хугацааны chip — БҮХ харагдаж буй төслийг НЭГ хүсэлтээр (N+1-ээс
  // сэргийлнэ).  Сервер тал 60 төслөөр таслах тул урт жагсаалтын сүүлийн
  // картуудад chip гарахгүй — энэ нь хоосон харагдацаас өөрөөр эвдрэхгүй.
  const visibleIds = useMemo(() => filtered.map((p) => p.id), [filtered]);
  const deadlineSummaryQuery = useDeadlineSummary(visibleIds);
  const deadlineByProject = useMemo(() => {
    const map = new Map<number, DeadlineSummary>();
    for (const s of deadlineSummaryQuery.data?.items ?? []) map.set(s.project_id, s);
    return map;
  }, [deadlineSummaryQuery.data]);

  // Гар эрэмбэ (drag-reorder) — зөвхөн admin + «Засах» горим идэвхтэй үед.
  const dragEnabled = isAdminTier && editMode;
  const dndSensors = useAppDndSensors();
  const handleDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const oldIdx = filtered.findIndex((p) => String(p.id) === active.id);
    const newIdx = filtered.findIndex((p) => String(p.id) === over.id);
    if (oldIdx < 0 || newIdx < 0) return;
    const ids = arrayMove(filtered, oldIdx, newIdx).map((p) => p.id);
    const orderMap = new Map(ids.map((id, i) => [id, (i + 1) * 10]));
    // Optimistic — бүх төслийн sort_order-ийг шинэ дарааллаар cache-д бичнэ.
    queryClient.setQueryData<{ projects: ProjectWithProgress[] }>(['/projects'], (prev) =>
      prev
        ? {
            projects: prev.projects.map((p) =>
              orderMap.has(p.id) ? { ...p, sort_order: orderMap.get(p.id)! } : p,
            ),
          }
        : prev,
    );
    apiFetch('/projects/reorder', { method: 'PUT', data: { project_ids: ids } }).catch(() => {
      toast.error(t('projectsPage.reorderFailed'));
      refetchProjects();
    });
  };

  // ASAP/яаралтай тэмдгийг асаах/унтраах — optimistic, дараа нь сервер рүү.
  const toggleAsap = (project: ProjectWithProgress) => {
    const next = project.is_asap ? 0 : 1;
    queryClient.setQueryData<{ projects: ProjectWithProgress[] }>(['/projects'], (prev) =>
      prev
        ? {
            projects: prev.projects.map((p) =>
              p.id === project.id ? { ...p, is_asap: next } : p,
            ),
          }
        : prev,
    );
    apiFetch(`/projects/${project.id}/asap`, { method: 'PATCH', data: { is_asap: !!next } }).catch(
      () => {
        toast.error(t('projectsPage.asapFailed'));
        refetchProjects();
      },
    );
  };

  // Бэхлэлтийг асаах/унтраах — optimistic, дараа нь сервер рүү (toggleAsap-тай
  // ижил загвар).  ЗӨВХӨН `/projects/pins` кэш өөрчлөгдөнө: төслийн мөр өөрөө
  // бэхлэлтийн мэдээлэл агуулдаггүй тул `/projects`-ыг дахин татах шаардлагагүй.
  const togglePin = (project: ProjectWithProgress) => {
    const next = !pinnedIds.has(project.id);
    queryClient.setQueryData<{ project_ids: number[] }>(['/projects/pins'], (prev) => {
      const ids = (prev?.project_ids ?? []).filter((id) => id !== project.id);
      return { project_ids: next ? [project.id, ...ids] : ids };
    });
    apiFetch(`/projects/${project.id}/pin`, { method: 'PATCH', data: { is_pinned: next } }).catch(
      () => {
        toast.error(t('projectsPage.pinFailed'));
        queryClient.invalidateQueries({ queryKey: ['/projects/pins'] });
      },
    );
  };

  // Яаралтай (ASAP) төслүүд — таб/шүүлтээс үл хамааран толгойд үргэлж харагдана.
  const asapProjects = projects.filter((p) => p.is_asap);

  // "Архив" таб — зөвхөн админ (2026-09-28).  Backend ч `GET /projects`-оос
  // архивласан төслийг админ бусад хүнд хасдаг (`lib/archivedProjects.ts`).
  const canSeeArchive = isAdminTier;
  const statusTabs: { key: StatusFilter; label: string }[] = [
    { key: 'assigned', label: t('projectsPage.tabAssigned') },
    { key: 'active', label: t('projectsPage.tabActive') },
    ...(canSeeArchive
      ? [{ key: 'archived' as StatusFilter, label: t('projectsPage.tabArchived') }]
      : []),
    { key: 'all', label: t('projectsPage.tabAll') },
  ];

  return (
    <PageContainer>
      {/* Яаралтай (ASAP) төслүүд — хуудасны хамгийн дээр, толгойн өмнө */}
      {asapProjects.length > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-danger/50 bg-danger/15 px-3 py-2.5 text-sm">
          <AlertTriangle className="h-4 w-4 shrink-0 text-danger" />
          <span className="font-semibold text-danger">
            {t('projectsPage.asapHeader')}:
          </span>
          {asapProjects.map((p) => (
            <Link
              key={p.id}
              to={`/app/projects/${p.id}`}
              className="rounded bg-danger/20 px-2 py-0.5 text-xs font-medium text-danger hover:bg-danger/30"
            >
              {p.name}
            </Link>
          ))}
        </div>
      )}
      {/* Page header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-b border-border pb-5">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight text-foreground">{t('projects')}</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            {t('projectsPage.subtitle')}
          </p>
        </div>
        {user?.role === 'admin' && (
          <Dialog
            open={dialogOpen}
            onOpenChange={(v) => {
              setDialogOpen(v);
              if (!v) resetCreateForm();
            }}
          >
            <DialogTrigger asChild>
              <Button size="sm" className="shadow-lg shadow-primary/20">
                <Plus className="mr-2 h-4 w-4" /> {t('projectsPage.newProject')}
              </Button>
            </DialogTrigger>
            <DialogContent
              /* ⚠️ `sm:` угтвар ЗААВАЛ: ui/dialog.tsx-ийн суурь класст
                 `sm:max-w-lg` байдаг бөгөөд угтваргүй `max-w-*` нь twMerge-д
                 ӨӨР түлхүүр тул дарагддаггүй — media query-ийн улмаас ≥sm
                 дэлгэц дээр үргэлж 512px хэвээр үлддэг.  Баримт нь A4 (794px)
                 өргөнтэй тул тэр хэмжээнд баруун тал нь тасарна. */
              className="sm:max-w-[min(96vw,1120px)] max-h-[92vh] overflow-y-auto"
            >
              <DialogHeader>
                <DialogTitle>{t('projectsPage.createDialogTitle')}</DialogTitle>
              </DialogHeader>

              {/* Эзний шийдвэр (2026-09-15): төсөл үүсгэхэд ЗӨВХӨН нэр +
                  ангилал + төвөгшил гурвыг л сонгоно.  Баримт (шифр, цар
                  хүрээ, ажлын хэсэг …) нь ЗААВАЛ БИШ — доор хумигдсан
                  байдалтай, үүсгэсний дараа «Мэдээлэл» табаас бөглөгдөнө.
                  Урьд нь (2026-09-02) баримт нь энэ цонхны гол гадаргуу
                  байсан бөгөөд шифр/цар хүрээ/ажлын хэсэг заавал байв. */}
              <div className="space-y-4 py-3">
                <div className="grid gap-3 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
                  <div className="space-y-1.5">
                    <Label className="text-xs font-medium">
                      {t('projectsPage.projectName')} <span className="text-destructive">*</span>
                    </Label>
                    {/* Код ба ангилал нь автомат: хэрэглэгч дунд хэсгийг бичнэ.
                        Код нь өгөгдмөл утгатай ч дарж засаж болно; ангилал
                        нь сонгосон товчноос л ирнэ. */}
                    <div className="flex h-9 items-stretch overflow-hidden rounded-md border border-input bg-transparent shadow-xs transition-[color,box-shadow] focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50 dark:bg-input/30">
                      <label
                        className={cn(
                          'flex shrink-0 cursor-text items-center bg-muted/50 pl-2.5 font-mono text-xs tabular-nums transition-colors hover:bg-muted focus-within:bg-muted',
                          codeEdited ? 'font-semibold text-primary' : 'text-muted-foreground',
                        )}
                        title={t('projectsPage.projectCodeEditHint')}
                      >
                        <input
                          value={newCode}
                          onChange={(e) => setNewCodeOverride(e.target.value)}
                          onBlur={() => {
                            const clean = cleanProjectCode(newCode);
                            /* Хоосон эсвэл өнөөдрийнхтэй ижил → автомат руу буцна. */
                            setNewCodeOverride(!clean || clean === autoCode ? null : clean);
                          }}
                          onFocus={(e) => e.currentTarget.select()}
                          spellCheck={false}
                          autoComplete="off"
                          maxLength={40}
                          aria-label={t('projectsPage.projectCode')}
                          style={{ width: `${Math.max(newCode.length, 6)}ch` }}
                          className="min-w-0 bg-transparent outline-none"
                        />
                        <span className="select-none pr-2.5">-</span>
                      </label>
                      <input
                        value={newName}
                        onChange={(e) => setNewName(e.target.value)}
                        placeholder={t('projectsPage.projectNamePlaceholder')}
                        aria-label={t('projectsPage.projectName')}
                        className="min-w-0 flex-1 bg-transparent px-2 text-base outline-none placeholder:text-muted-foreground md:text-sm"
                      />
                      <span
                        className={cn(
                          'flex shrink-0 select-none items-center bg-muted/50 px-2.5 font-mono text-xs tabular-nums',
                          newCategory ? 'font-semibold text-primary' : 'text-muted-foreground/60',
                        )}
                        title={newCategory ? undefined : t('projectsPage.projectNameCategoryHint')}
                      >
                        -{newCategory ?? '··'}
                      </span>
                    </div>
                    <p className="text-micro text-muted-foreground">
                      {newFullName ? (
                        <>
                          {t('projectsPage.projectNamePreview')}{' '}
                          <span className="font-mono font-medium text-foreground">{newFullName}</span>
                        </>
                      ) : (
                        t('projectsPage.projectNameHint')
                      )}
                    </p>
                    {codeEdited && (
                      <button
                        type="button"
                        onClick={() => setNewCodeOverride(null)}
                        className="inline-flex items-center gap-1 text-micro text-primary hover:underline"
                      >
                        <RotateCcw className="h-3 w-3" />
                        {t('projectsPage.projectCodeReset', { code: autoCode })}
                      </button>
                    )}
                    {/* Баримт (доорх Word хэлбэр) руу юу автоматаар очиж
                        байгааг ИЛ харуулна — хумигдсан хэсгийг нээхгүйгээр
                        шифр харагдана.  Баримт дээр тусад нь засагдсан бол
                        дарж дахин холбоно. */}
                    <div className="flex flex-wrap items-center gap-1.5 text-micro text-muted-foreground">
                      <span>{t('projectsPage.docLinkLead')}</span>
                      {(
                        [
                          ['title', t('projectsPage.docLinkTitle'), docTitle, newFullTitle === null, () => setNewFullTitle(null)],
                          ['shifr', t('projectsPage.docLinkShifr'), docDrawingNo, newDrawingNo === null, () => setNewDrawingNo(null)],
                        ] as const
                      ).map(([key, label, value, linked, relink]) => {
                        const body = (
                          <>
                            {linked ? (
                              <Link2 className="h-3 w-3 shrink-0" />
                            ) : (
                              <Link2Off className="h-3 w-3 shrink-0" />
                            )}
                            <span className="shrink-0">{label}:</span>
                            <span className="truncate font-mono">{value.trim() || '—'}</span>
                          </>
                        );
                        return linked ? (
                          <span
                            key={key}
                            data-doc-link={key}
                            className="inline-flex h-6 min-w-0 max-w-[16rem] items-center gap-1 rounded-md bg-primary/10 px-1.5 text-primary"
                          >
                            {body}
                          </span>
                        ) : (
                          <Button
                            key={key}
                            type="button"
                            variant="ghost"
                            size="xs"
                            data-doc-link={key}
                            onClick={relink}
                            title={t('projectsPage.docLinkRelinkHint')}
                            className="min-w-0 max-w-[20rem] bg-warning/10 text-micro font-normal text-warning hover:bg-warning/20 hover:text-warning dark:hover:bg-warning/20"
                          >
                            {body}
                            <span className="shrink-0 underline">{t('projectsPage.docLinkRelink')}</span>
                          </Button>
                        );
                      })}
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs font-medium">
                      {t('projectsPage.category')} <span className="text-destructive">*</span>
                    </Label>
                    <div className="flex flex-wrap gap-1.5">
                      {PROJECT_CATEGORY_CODES.map((code) => {
                        const def = PROJECT_CATEGORIES[code];
                        const active = newCategory === code;
                        return (
                          <button
                            key={code}
                            type="button"
                            title={`${def.name_mn} · ${t('projectsPage.teamCount', { count: def.teamCodes.length })}`}
                            onClick={() => pickCategory(code)}
                            className={cn(
                              'rounded-md border px-2.5 py-1.5 text-xs transition-colors',
                              active
                                ? 'bg-primary/10 text-primary border-primary/40 ring-2 ring-primary/30'
                                : 'border-border hover:bg-muted/40',
                            )}
                          >
                            <span className="font-semibold tabular-nums">{def.code}</span>
                            <span className="ml-1.5 text-micro opacity-70">{def.name_mn}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  <div className="space-y-1.5 lg:col-span-2">
                    <Label htmlFor="new-project-complexity" className="text-xs font-medium">
                      {t('projectsPage.complexityWeight')} <span className="text-destructive">*</span>
                    </Label>
                    <ComplexityPicker
                      inputId="new-project-complexity"
                      value={newComplexityPct}
                      onChange={setComplexityByHand}
                    />
                    <p className="text-micro text-muted-foreground">
                      {t('projectsPage.complexityWeightHint')}
                    </p>
                  </div>
                </div>

                {/* Ангиллын ЗАГВАР — сонгосон ангилалд загвар төсөл байвал
                    түүний бүтэц, ажлын хуваарилалт автоматаар хуулагдана.
                    Эх төсөл сонгосон бол загвар алгасагдана (сервер ч мөн). */}
                {newTemplate && (
                  <div className="space-y-1 rounded-md border border-primary/30 bg-primary/5 px-3 py-2">
                    <div className="flex items-start gap-2">
                      <Checkbox
                        id="new-project-use-template"
                        checked={useTemplate && newSourceId == null}
                        disabled={creating || newSourceId != null}
                        onCheckedChange={(v) => setUseTemplate(v === true)}
                        className="mt-0.5"
                      />
                      <Label
                        htmlFor="new-project-use-template"
                        className="flex min-w-0 flex-1 items-start gap-1.5 text-xs font-medium leading-snug"
                      >
                        <LayoutTemplate className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
                        <span className="min-w-0 break-words">
                          {t('projectsPage.templateUse', { name: newTemplate.name })}
                        </span>
                      </Label>
                    </div>
                    <p className="pl-6 text-micro text-muted-foreground tabular-nums">
                      {t('projectsPage.templateCounts', newTemplate.counts)}
                      {newTemplate.team_shares.length > 0 && (
                        <>
                          {' · '}
                          {t('projectsPage.templateShares', {
                            shares: formatTemplateShares(newTemplate),
                          })}
                        </>
                      )}
                    </p>
                    <p
                      className={cn(
                        'pl-6 text-micro',
                        newSourceId != null ? 'text-warning' : 'text-muted-foreground',
                      )}
                    >
                      {newSourceId != null
                        ? t('projectsPage.templateSkippedBySource')
                        : t('projectsPage.templateNote')}
                    </p>
                  </div>
                )}

                {/* «Эх төсөл» — ЗААВАЛ БИШ.  Сонгосон үед нарийвчлал,
                    зургийн шифр, захиалагч урьдчилан бөглөгдөнө (доорх
                    талбарууд дээр ИЛ харагдана, засаж болно), үүсгэсний
                    дараа «Бүтэц татах» цонх өөрөө нээгдэнэ.
                    ⚠️ ОГНОО хуулагдахгүй — тайлбарыг `newSourceId`-гийн
                    зарлалтаас үз. */}
                <div className="space-y-1.5 rounded-md border border-border/60 bg-muted/20 px-3 py-2">
                  <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-3">
                    <Label className="text-xs font-medium sm:w-32 sm:shrink-0">
                      {t('projectsPage.sourceProjectLabel')}
                    </Label>
                    <div className="min-w-0 flex-1">
                      <SourceProjectPicker
                        value={newSourceId}
                        onChange={(sid) => {
                          void pickSourceProject(sid);
                        }}
                        targetName={newName}
                        targetShifr={docDrawingNo}
                        disabled={creating || sourceLoading}
                      />
                    </div>
                    {sourceLoading && (
                      <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground" />
                    )}
                  </div>
                  <p className="text-micro text-muted-foreground">
                    {t('projectsPage.sourceProjectHint')}
                  </p>
                  {sourcePrefilled && (
                    <p className="flex items-center gap-1.5 text-micro text-success">
                      <Sparkles className="h-3 w-3 shrink-0" />
                      {t('projectsPage.sourceProjectPrefilled')}
                    </p>
                  )}
                </div>

                {/* Баримт — ЗААВАЛ БИШ, өгөгдмөлөөр хумигдсан; эх төсөл
                    сонгож урьдчилан бөглөгдсөн бол нээлттэй харуулна. */}
                <details
                  open={docOpen}
                  onToggle={(e) => setDocOpen((e.currentTarget as HTMLDetailsElement).open)}
                  className="rounded-md border border-border/60 bg-muted/10 px-3 py-2"
                >
                  <summary className="cursor-pointer text-xs font-medium text-muted-foreground">
                    {t('projectsPage.docOptional')}
                  </summary>
                  <div className="space-y-4 pt-3">
                <div className="flex flex-wrap items-center gap-2 rounded-md border border-border/60 bg-muted/20 px-3 py-2 text-micro">
                  <span className="text-muted-foreground">{t('projectsPage.docFillHint')}</span>
                  {/* «Багуудаас бөглөх» — 1.2-ыг тэмдэглэсэн ажлын хэсгээс нэг
                      дарж бөглөнө.  Баримтын дотор товч байрлуулах газар
                      байхгүй тул энд. */}
                  {newDisciplines.length > 0 && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="ml-auto h-7 text-micro"
                      onClick={() =>
                        setNewScopeRows(
                          seedScopeRows({
                            existing: scopeRowsView,
                            disciplines: newDisciplines,
                            teamShares: [],
                            projectName: linkedTitle,
                            startDate:
                              newTimeline.find((r) => r.id === 'tl-start')?.date || null,
                          }),
                        )
                      }
                    >
                      <Sparkles className="h-3 w-3 mr-1.5" />
                      {t('projectInfoTab.scopeRowsSeed')}
                    </Button>
                  )}
                </div>

                <PassportDocumentEditor value={docDraft} onChange={applyDocPatch} />
                  </div>
                </details>

                <details className="rounded-md border border-border/60 bg-muted/10 px-3 py-2">
                  <summary className="cursor-pointer text-xs font-medium text-muted-foreground">
                    {t('projectsPage.moreSettings')}
                  </summary>
                  <div className="grid gap-4 sm:grid-cols-2 pt-3">
                  <div className="space-y-1.5 sm:col-span-2">
                    <Label className="text-xs font-medium">{t('common.description')}</Label>
                    <Input
                      value={newDesc}
                      onChange={(e) => setNewDesc(e.target.value)}
                      placeholder={t('projectsPage.descPlaceholder')}
                    />
                  </div>
                </div>

                {/* Clients section */}
                <div className="pt-1 space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <Label className="text-xs font-semibold text-foreground">{t('projectsPage.client')}</Label>
                      <p className="text-micro text-muted-foreground mt-0.5">
                        {t('projectsPage.clientHint')}
                      </p>
                    </div>
                    <div
                      className={cn(
                        'text-micro font-semibold tabular-nums rounded-md px-2 py-1 border',
                        shareStatus === 'ok'
                          ? 'text-success bg-success/10 border-success/20'
                          : shareStatus === 'off'
                            ? 'text-warning bg-warning/10 border-warning/20'
                            : 'text-muted-foreground bg-muted/40 border-border',
                      )}
                    >
                      {hasAnyClient
                        ? t('projectsPage.shareTotal', {
                            total: clientShareTotal.toFixed(2).replace(/\.00$/, ''),
                          })
                        : t('projectsPage.noClient')}
                    </div>
                  </div>

                  <div className="space-y-2">
                    {newClients.map((cl) => (
                      <div
                        key={cl._key}
                        className="flex items-start gap-2 p-2 rounded-lg border border-border/60 bg-card/40"
                      >
                        {/* Type toggle */}
                        <div className="flex flex-col gap-1 pt-0.5">
                          <button
                            type="button"
                            onClick={() => updateClient(cl._key, { type: 'company' })}
                            className={cn(
                              'h-7 w-7 rounded-md flex items-center justify-center border transition-colors',
                              cl.type === 'company'
                                ? 'bg-primary/15 text-primary border-primary/30'
                                : 'text-muted-foreground border-border hover:text-foreground',
                            )}
                            title={t('projectsPage.company')}
                          >
                            <Building2 className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => updateClient(cl._key, { type: 'individual' })}
                            className={cn(
                              'h-7 w-7 rounded-md flex items-center justify-center border transition-colors',
                              cl.type === 'individual'
                                ? 'bg-primary/15 text-primary border-primary/30'
                                : 'text-muted-foreground border-border hover:text-foreground',
                            )}
                            title={t('projectsPage.individual')}
                          >
                            <UserIcon className="h-3.5 w-3.5" />
                          </button>
                        </div>

                        <div className="flex-1 grid grid-cols-[1fr_90px] gap-2">
                          <Input
                            value={cl.name}
                            onChange={(e) => updateClient(cl._key, { name: e.target.value })}
                            placeholder={
                              cl.type === 'company'
                                ? t('projectsPage.companyNamePlaceholder')
                                : t('projectsPage.individualNamePlaceholder')
                            }
                            className="h-9"
                          />
                          <div className="relative">
                            <Input
                              type="number"
                              min={0}
                              max={100}
                              step="0.01"
                              value={cl.share_percent ?? 0}
                              onChange={(e) =>
                                updateClient(cl._key, {
                                  share_percent: e.target.value === '' ? 0 : Number(e.target.value),
                                })
                              }
                              className="h-9 pr-7 tabular-nums"
                              placeholder="0"
                            />
                            <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground pointer-events-none">
                              %
                            </span>
                          </div>
                        </div>

                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-9 w-9 text-muted-foreground hover:text-destructive"
                          onClick={() => removeClient(cl._key)}
                          disabled={newClients.length === 1}
                          title={t('common.delete')}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    ))}
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-8 text-xs"
                      onClick={() => addClientRow('company')}
                    >
                      <Building2 className="h-3.5 w-3.5 mr-1.5" /> {t('projectsPage.addCompany')}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-8 text-xs"
                      onClick={() => addClientRow('individual')}
                    >
                      <UserIcon className="h-3.5 w-3.5 mr-1.5" /> {t('projectsPage.addIndividual')}
                    </Button>
                  </div>

                  {shareStatus === 'off' && (
                    <div className="flex items-start gap-2 p-2.5 rounded-md bg-warning/10 border border-warning/20 text-micro text-warning">
                      <AlertTriangle className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
                      <span>{t('projectsPage.shareWarning')}</span>
                    </div>
                  )}
                </div>
                </details>
              </div>

              <DialogFooter>
                <DialogClose asChild>
                  <Button variant="outline">{t('common.cancel')}</Button>
                </DialogClose>
                <Button onClick={handleCreate} disabled={creating || !canCreate}>
                  {creating ? (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  ) : (
                    <Plus className="w-4 h-4 mr-2" />
                  )}
                  {t('common.create')}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}
      </div>

      {/* Controls: search + status tabs + sorting
          `sec-projects-*` id-нууд нь глобал хайлтын гүн холбоосын бай
          (`?section=<id>`) — `shared/lib/search/sections.ts`-тэй ижил байлгана. */}
      <div
        id="sec-projects-controls"
        className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between scroll-mt-24"
      >
        <div className="flex gap-1 bg-muted/40 p-1 rounded-lg flex-wrap">
          {statusTabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setStatusFilter(tab.key)}
              className={cn(
                'px-3 py-1.5 rounded-md text-sm font-medium transition-all',
                statusFilter === tab.key
                  ? 'bg-primary text-primary-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted/60',
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <div className="flex gap-1 bg-muted/40 p-1 rounded-lg flex-wrap">
          <button
            onClick={() => setCategoryFilter('all')}
            className={cn(
              'px-2.5 py-1 rounded-md text-xs font-medium transition-all',
              categoryFilter === 'all'
                ? 'bg-primary text-primary-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground hover:bg-muted/60',
            )}
          >
            {t('projectsPage.allCategories')}
          </button>
          {PROJECT_CATEGORY_CODES.map((code) => {
            const def = PROJECT_CATEGORIES[code];
            const active = categoryFilter === code;
            return (
              <button
                key={code}
                onClick={() => setCategoryFilter(code)}
                title={def.name_mn}
                className={cn(
                  'px-2.5 py-1 rounded-md text-xs font-medium transition-all tabular-nums',
                  active
                    ? 'bg-primary text-primary-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground hover:bg-muted/60',
                )}
              >
                {def.code}
              </button>
            );
          })}
        </div>
        <div className="flex flex-wrap gap-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              aria-label={t('common.search')}
              placeholder={t('projectsPage.searchPlaceholder')}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-8 w-48 h-9"
            />
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="h-9 gap-2">
                <ArrowUpDown className="h-4 w-4" />
                {t('projectsPage.sort')}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => toggleSort('activity')}>
                {t('projectsPage.sortActivity')}
              </DropdownMenuItem>
              {isAdminTier && (
                <DropdownMenuItem onSelect={() => setSortKey('manual')}>
                  {t('projectsPage.sortManual')}
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onSelect={() => toggleSort('created_at')}>
                {t('projectsPage.sortDate')}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => toggleSort('name')}>
                {t('common.name')}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => toggleSort('progress')}>
                {t('projectsPage.sortProgress')}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))}>
                {sortDir === 'asc' ? t('projectsPage.ascending') : t('projectsPage.descending')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          {isAdminTier && (
            <Button
              variant={editMode ? 'destructive' : 'outline'}
              size="sm"
              className="h-9 gap-2"
              onClick={toggleEditMode}
            >
              <GripVertical className="h-4 w-4" />
              {editMode ? t('projectsPage.reorderDone') : t('projectsPage.reorderEdit')}
            </Button>
          )}
        </div>
      </div>

      {/* Эрэмбэлэх горимын анхааруулга (амбер — улаан нь ASAP-д зориулна) */}
      {dragEnabled && (
        <div className="flex items-center gap-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-warning">
          <GripVertical className="h-4 w-4 shrink-0" />
          {t('projectsPage.reorderHint')}
        </div>
      )}

      {/* Content */}
      {loading ? (
        <div className="flex items-center justify-center min-h-[300px]">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      ) : isError ? (
        <Card className="border-danger/30 bg-card/60">
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <AlertTriangle className="h-12 w-12 text-danger/40 mb-4" />
            <p className="font-medium text-foreground">{t('common.loadFailed')}</p>
            <Button
              variant="outline"
              size="sm"
              className="mt-4"
              onClick={() => projectsQuery.refetch()}
            >
              {t('common.retry')}
            </Button>
          </CardContent>
        </Card>
      ) : filtered.length === 0 ? (
        <Card className="border-border bg-card/60">
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <FolderOpen className="h-12 w-12 text-muted-subtle mb-4" />
            <p className="font-medium text-muted-foreground">
              {statusFilter === 'assigned' && !search
                ? t('projectsPage.noAssignedProjects')
                : t('projectsPage.noProjectsFound')}
            </p>
            <p className="text-sm text-muted-subtle mt-1">
              {search
                ? t('projectsPage.noResultsFor', { search })
                : statusFilter === 'assigned'
                  ? t('projectsPage.assignedHint')
                  : t('projectsPage.getStartedHint')}
            </p>
          </CardContent>
        </Card>
      ) : (
        /* ── LIST VIEW ── one project per row, full available width.
           On <lg the row stacks vertically (header → status/date →
           progress).  On lg+ the inner content becomes a 12-col grid
           so name/description/status/progress sit side-by-side and
           use the wider canvas. */
        <DndContext sensors={dndSensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext
            items={filtered.map((p) => String(p.id))}
            strategy={verticalListSortingStrategy}
          >
            <div id="sec-projects-list" className="flex flex-col gap-3 scroll-mt-24">
              {filtered.map((project) => (
                <SortableProjectItem key={project.id} id={String(project.id)} disabled={!dragEnabled}>
                  {(handle) => (
                    <Card
                      className={cn(
                        'relative py-0 backdrop-blur transition-colors group overflow-hidden',
                        project.is_asap
                          ? 'border-danger bg-danger/15 ring-2 ring-danger/60'
                          : handle
                            ? 'border-warning bg-warning/10 ring-1 ring-warning/50'
                            : pinnedIds.has(project.id)
                              ? 'border-primary/50 bg-primary/5 ring-1 ring-primary/25 hover:bg-primary/10'
                              : 'border-border bg-card/60 hover:bg-card/80',
                      )}
                    >
                      {handle && (
                        <button
                          type="button"
                          {...handle.attributes}
                          {...handle.listeners}
                          onClick={(e) => e.stopPropagation()}
                          className="absolute left-1 top-1 z-10 cursor-grab touch-none rounded p-1 text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                          aria-label={t('projectsPage.dragToReorder')}
                        >
                          <GripVertical className="h-4 w-4" />
                        </button>
                      )}
                      <CardContent
                        className={cn(
                          'p-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:gap-4',
                          handle && 'pl-9',
                        )}
                      >
                <div className="flex-1 min-w-0 lg:grid lg:grid-cols-12 lg:items-center lg:gap-6 flex flex-col gap-3">
                  {/* ── Left: folder icon + name + description ── */}
                  <div className="flex items-start gap-3 min-w-0 lg:col-span-5">
                    <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                      <FolderKanban className="h-4 w-4 text-primary" />
                    </div>
                    <div className="min-w-0">
                      <CardTitle className="text-base leading-snug flex min-w-0 items-center gap-1.5">
                        {pinnedIds.has(project.id) && (
                          <span
                            className="shrink-0 text-primary"
                            title={t('projectsPage.pinnedTitle')}
                            aria-label={t('projectsPage.pinnedBadge')}
                          >
                            <Pin className="h-3.5 w-3.5 fill-current" />
                          </span>
                        )}
                        <Link
                          to={`/app/projects/${project.id}`}
                          className="truncate hover:text-primary transition-colors"
                        >
                          {project.name}
                        </Link>
                      </CardTitle>
                      <CardDescription className="line-clamp-1 mt-0.5 text-xs">
                        {project.description || t('projectsPage.noDescription')}
                      </CardDescription>
                    </div>
                  </div>

                  {/* ── Middle: status badge + created date ── */}
                  <div className="flex items-center gap-3 text-xs text-muted-foreground lg:col-span-2 lg:flex-col lg:items-start lg:gap-1.5">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <Badge
                        variant="outline"
                        className={cn('capitalize', STATUS_CONFIG[project.status]?.class)}
                      >
                        {(() => {
                          const labelKey = STATUS_CONFIG[project.status]?.labelKey;
                          return labelKey ? t(labelKey) : project.status;
                        })()}
                      </Badge>
                      {project.category && (
                        <Badge
                          variant="outline"
                          className="text-micro py-0 bg-primary/10 text-primary border-primary/30 tabular-nums"
                          title={categoryName(project.category)}
                        >
                          {project.category}
                        </Badge>
                      )}
                      {/* Complexity weight — зөвхөн admin-tier-д (инженер,
                          архитектор, ахлах, харилцагчид харагдахгүй). */}
                      {isAdminTier &&
                        (() => {
                          const pct = clampComplexityPct(
                            project.complexity_pct ?? DEFAULT_COMPLEXITY_PCT,
                          );
                          return (
                            <Badge
                              variant="outline"
                              className={cn(
                                'text-micro py-0 tabular-nums',
                                complexityPctColor(pct),
                              )}
                              title={t('projectsPage.complexityBadgeTitle', { pct })}
                            >
                              {pct}%
                            </Badge>
                          );
                        })()}
                    </div>
                    <span className="tabular-nums">{formatDate(new Date(project.created_at))}</span>
                  </div>

                  {/* ── Right area: progress mini-block ──
                      Хулгана ойртоход энэ төслийн БҮХ эцсийн хугацаа
                      (хариуцагч, холбоосон ажлын явц, тэмдэглэлтэй нь)
                      хөзөр болж нээгдэнэ.  ЗӨВХӨН УНШИНА — нэмэх/засах нь
                      «Эцсийн хугацаа» хуудсандаа үлдэнэ.  Нэмэлт хүсэлт
                      явуулахгүй: `deadlineSummaryQuery`-ийн өгөгдлийг л
                      дахин ашиглана. */}
                  <ProjectDeadlineHover
                    summary={deadlineByProject.get(project.id)}
                    projectId={project.id}
                    className="space-y-1.5 min-w-0 lg:col-span-5"
                  >
                    <CompactProgressLine
                      icon={Activity}
                      value={project.progress ?? 0}
                      title={t('projectsPage.totalProgress')}
                      caption={t('projectsPage.totalProgress')}
                    />
                    <ScheduleProgress
                      project={project}
                      points={deadlineByProject.get(project.id)?.points}
                    />
                    {/* Дараагийн хугацаа + хэтэрсэн тоо.  Хугацаа тавиагүй
                        төсөл дээр өөрөө null буцаана (хоосон мөр үлдээхгүй). */}
                    <ProjectDeadlineChip summary={deadlineByProject.get(project.id)} />
                  </ProjectDeadlineHover>
                </div>

                {/* ── Per-row action menu (far right) ── */}
                <div className="flex justify-end lg:flex-shrink-0">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        className="h-8 w-8 p-0 lg:opacity-0 lg:group-hover:opacity-100 transition-opacity flex-shrink-0"
                      >
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      {/* Бэхлэлт — РОЛЬ ХАМААРАЛГҮЙ.  Зөвхөн тухайн хэрэглэгчийн
                          өөрийнх нь жагсаалтын эрэмбэд нөлөөлнө (доорх ASAP
                          нь эсрэгээрээ бүх хүнд харагддаг тул admin-only). */}
                      <DropdownMenuItem onClick={() => togglePin(project)}>
                        {pinnedIds.has(project.id) ? (
                          <PinOff className="mr-2 h-4 w-4" />
                        ) : (
                          <Pin className="mr-2 h-4 w-4" />
                        )}
                        {pinnedIds.has(project.id)
                          ? t('projectsPage.pinUnmark')
                          : t('projectsPage.pinMark')}
                      </DropdownMenuItem>
                      {user?.role === 'admin' && (
                        <DropdownMenuItem
                          className={project.is_asap ? 'text-warning' : 'text-danger'}
                          onClick={() => toggleAsap(project)}
                        >
                          <AlertTriangle className="mr-2 h-4 w-4" />
                          {project.is_asap
                            ? t('projectsPage.asapUnmark')
                            : t('projectsPage.asapMark')}
                        </DropdownMenuItem>
                      )}
                      <DropdownMenuItem asChild>
                        <Link to={`/app/projects/${project.id}`}>{t('projectsPage.viewDetails')}</Link>
                      </DropdownMenuItem>
                      {canConfigureProjects && (
                        <>
                          <DropdownMenuItem asChild>
                            <Link to={`/app/projects/${project.id}/setup`}>{t('projectsPage.configure')}</Link>
                          </DropdownMenuItem>
                          {user?.role === 'admin' && (
                            <DropdownMenuItem
                              className="text-destructive"
                              onClick={() => handleArchive(project.id)}
                            >
                              {t('projectsPage.archive')}
                            </DropdownMenuItem>
                          )}
                        </>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
                      </CardContent>
                    </Card>
                  )}
                </SortableProjectItem>
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}
    </PageContainer>
  );
}
