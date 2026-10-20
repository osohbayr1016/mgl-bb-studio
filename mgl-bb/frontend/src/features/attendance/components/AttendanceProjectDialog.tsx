import { useMemo, useState, type AnimationEvent } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  ChevronUp,
  ClipboardList,
  FolderOpen,
  Loader2,
  Wrench,
} from 'lucide-react';
import { Button } from '@/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/ui/dialog';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/i18n';
import type { AttendanceCheckpointType, ProjectOption, RepairProjectOption } from '@/shared/types';
/** ⚠️ Ээлжийн хүснэгт `features/attendance/shifts.ts`-д НЭГ хувь (2026-08-26). */
import { shiftOptions, formatShiftDate, type ScheduleKey } from '@/features/attendance/shifts';
import NonProjectPicker, { type PickState } from '@/features/non-project-work/NonProjectPicker';
import { useCanLogNonProjectWork } from '@/features/non-project-work/useNonProjectWork';
import { initialPicks, toWirePicks } from '@/features/non-project-work/lib';
import type { NonProjectPick, NonProjectWorkToday } from '@/features/non-project-work/types';

type Shift = ScheduleKey;

const COPY: Record<
  AttendanceCheckpointType,
  { titleKey: string; descriptionKey: string; actionKey: string }
> = {
  morning: {
    titleKey: 'attendanceProjectDialog.morningTitle',
    descriptionKey: 'attendanceProjectDialog.morningDescription',
    actionKey: 'attendanceProjectDialog.morningAction',
  },
  afternoon: {
    titleKey: 'attendanceProjectDialog.afternoonTitle',
    descriptionKey: 'attendanceProjectDialog.afternoonDescription',
    actionKey: 'attendanceProjectDialog.afternoonAction',
  },
  clock_out: {
    titleKey: 'attendanceProjectDialog.clockOutTitle',
    descriptionKey: 'attendanceProjectDialog.clockOutDescription',
    actionKey: 'attendanceProjectDialog.clockOutAction',
  },
};

/**
 * Popup-ийн ХОЁР хуудас (2026-09-17, миграц 0324).
 *
 *   `projects` — жинхэнэ төслүүд (өмнөх popup бүхэлдээ);
 *   `repairs`  — ЗАСВАРЫН төслүүд (`repair_projects`): Projects хуудсанд
 *                байхгүй жижиг/дотоод засварын ажил.  Админ үүсгэнэ
 *                (Зөвшөөрөл → Засвар).
 *
 * Хоёр хуудсыг НЭГ dialog дотор хоёр хэсэг болгож ХАВСРААГҮЙ (эзэн: «нэг
 * цонхонд хоёр хуваах нь төөрөгдүүлнэ») — оронд нь дэвсгэр дээш гулсаж,
 * шинэ хуудас доороос гарч ирнэ.  Хоёр хуудасны сонголт НЭГ л олонлог:
 * footer-ийн тоо, «дор хаяж нэг» шалгалт хоёрын нийлбэрээр.
 *
 * ⚠️ `projects.id` ба `repair_projects.id` ДАВХЦДАГ (хоёулаа AUTOINCREMENT)
 *    тул сонголт ХОЁР тусдаа Set-д, сервер рүү ХОЁР тусдаа массиваар
 *    (`project_ids` / `repair_project_ids`).  Нэг массивт хэзээ ч бүү нийлүүл.
 *
 * Гурав дахь хуудас `nonProject` — ТӨСЛИЙН БУС АЖИЛ (0342; 2026-09-28-наас
 * 0357).  Төсөл шиг СОНГОЛТ, ЗӨВХӨН ХЯНАЛТ (эзний шийдвэр): сонголт нь ирцийн
 * хүсэлттэй ХАМТ `non_project` болж явна — «одоо юу хийж байна»-г тэмдэглэнэ,
 * цаг/хувь бодогдохгүй, гарах үед ч «юу хийсэн» асуухгүй.  Урьдчилсан сонголт
 * нь өмнөх цэгийнх (`active`).  Ажилтан ажлаа дуусгасны дараа «Миний
 * ажлууд»-аас юу хийснээ, эхэлсэн/дууссан цагаа оруулна.
 */
type Page = 'projects' | 'repairs' | 'nonProject';

/**
 * Нэг цэгт сонгох төслийн ДЭЭД хязгаар (эзэн 2026-09-29).  Жинхэнэ төсөл +
 * засварын төсөл НИЙЛЭЭД тоологдоно; төслийн бус ажил тоологдохгүй.
 * ⚠️ Серверийн ихэр: `backend/src/routes/attendance.ts` `MAX_ATTENDANCE_PROJECTS`
 *    (сервер 400 `TOO_MANY_PROJECTS` өгнө — энэ нь зөвхөн UX).
 */
export const MAX_ATTENDANCE_PROJECTS = 2;

interface AttendanceProjectDialogProps {
  open: boolean;
  checkpointType: AttendanceCheckpointType;
  projects: ProjectOption[];
  initialProjectIds: number[];
  /** Засварын төслүүд (`my-status.repair_projects`, зөвхөн идэвхтэй нь). */
  repairProjects?: RepairProjectOption[];
  initialRepairProjectIds?: number[];
  /** Өнөөдрийн төслийн бус ажил + маягтын мэдээлэл (`my-status.non_project_work`).
   *  Байхгүй бол «Төслийн бус ажил» товч гарахгүй. */
  nonProjectWork?: NonProjectWorkToday | null;
  submitting?: boolean;
  onOfficeIp?: boolean;
  workSchedule?: Shift;
  onWorkScheduleChange?: (next: Shift) => Promise<void> | void;
  savingSchedule?: boolean;
  /** ⚠️ 2026-08-26-аас ХЭРЭГЛЭГДЭХГҮЙ: зуны түгжээ арилсан (сонголт нь
   *  хойшилдог болсон).  Prop нь дуудагчийн код эвдэхгүйн тулд үлдэв. */
  scheduleLocked?: boolean;
  /** Ажилтны СОНГОСОН ээлж — picker-ийн идэвхтэй товч (`workSchedule` нь
   *  зуны албадлагаар дарагдсан БОДИТ ээлж). */
  selectedShift?: Shift;
  /** Сонголт хэзээнээс хүчинтэй болох вэ (YYYY-MM-DD). */
  scheduleEffectiveFrom?: string;
  /** ⚠️ 2026-09-17-оос ХЭРЭГЛЭГДЭХГҮЙ: «{огноо}-нээс таны ажил … болно» сануулга
   *  эзний хүсэлтээр хасагдсан.  Prop нь дуудагчийн код эвдэхгүйн тулд үлдэв. */
  scheduleChange?: { schedule: Shift; date: string; label: string } | null;
  /** Серверээс ирсэн ээлжийн жагсаалт (шошго нь тохиргоог дагана). */
  scheduleOptions?: Array<{ key: Shift; label: string; start: string; end: string }>;
  /**
   * Серверийн татгалзал (403 — төхөөрөмж бүртгэлгүй, утас, оффисын сүлжээ
   * г.м.).  Дуудагч үүнийг зөвхөн өөрийн картан дээр харуулдаг байсан тул
   * modal-ын АРД үлдэж, ажилтанд «товч дарахад юу ч болохгүй» мэт харагдаж
   * байв (2026-09-17, D.Bayarchimeg).  Popup дотор нь заавал харуулна.
   */
  error?: string | null;
  onOpenChange: (open: boolean) => void;
  /** `nonProject` — энэ цэгт сонгосон төслийн бус ажил (0357); бүртгэх эрхгүй бол хоосон. */
  onSubmit: (
    projectIds: number[],
    repairProjectIds: number[],
    nonProject: NonProjectPick[],
  ) => Promise<void> | void;
}

export default function AttendanceProjectDialog({
  open,
  checkpointType,
  projects,
  initialProjectIds,
  repairProjects = [],
  initialRepairProjectIds = [],
  nonProjectWork = null,
  submitting = false,
  onOfficeIp = true,
  workSchedule,
  onWorkScheduleChange,
  savingSchedule = false,
  scheduleLocked = false,
  selectedShift,
  scheduleEffectiveFrom,
  scheduleOptions,
  error = null,
  onOpenChange,
  onSubmit,
}: AttendanceProjectDialogProps) {
  const { t, lang } = useLanguage();
  const [selected, setSelected] = useState<Set<number>>(new Set(initialProjectIds));
  const [selectedRepairs, setSelectedRepairs] = useState<Set<number>>(
    new Set(initialRepairProjectIds),
  );

  // Хуудасны шилжилт НЭГ төлөвт: `page` = харагдаж буй хуудас, `to` = шилжих
  // гэж буй хуудас (байвал `page` animate-out тоглож байна), `entered` =
  // «өөр хуудаснаас ирсэн» (анхны нээлтэд animate-in тоглуулахгүй — dialog
  // өөрөө zoom-in хийдэг, давхар хөдөлгөөн болно).  Шилжилтийг
  // `onAnimationEnd` дуусгана; ref БИШ, functional setState — render дунд ref
  // уншихгүй (React Compiler-ийн дүрэм), хоцорсон таймер ч буруу хуудас руу
  // үсэргэхгүй (`to` байхгүй бол юу ч хийхгүй).
  const [nav, setNav] = useState<{ page: Page; to: Page | null; entered: Page | null }>({
    page: 'projects',
    to: null,
    entered: null,
  });
  const page = nav.page;
  const leaving: Page | null = nav.to ? nav.page : null;
  const entered = nav.entered;

  // Төслийн бус ажил (0342/0357).  Энэ цэгийн СОНГОЛТ (`npPicks`) нь ирцийн
  // хүсэлттэй хамт явна — зөвхөн хяналт.
  const canLogNonProject = useCanLogNonProjectWork();
  const npToday = nonProjectWork?.today ?? [];
  const npCategories = nonProjectWork?.categories ?? [];
  const isClockOut = checkpointType === 'clock_out';
  const showNonProjectEntry = canLogNonProject && !!nonProjectWork;
  const [npPicks, setNpPicks] = useState<PickState>(() => new Map());
  const requiresNote = (key: string) => npCategories.some((c) => c.key === key && c.requires_note);
  const wirePicks = showNonProjectEntry ? toWirePicks(npPicks, npCategories) : [];
  /** «Бусад» сонгосон атлаа ямар ажил болохыг бичээгүй. */
  const npNoteMissing = wirePicks.some((p) => requiresNote(p.category) && !p.note);
  // Popup НЭЭГДЭХ МӨЧИД л өнөөдрийн идэвхтэй төслүүдээр урьдчилан дүүргэнэ.
  //
  // ⚠️ `initialProjectIds`-ийн ӨӨРЧЛӨЛТӨӨР дахин дүүргэж БОЛОХГҮЙ.  Дуудагч
  // (`AttendanceWidget`) нь `Array.from(activeIds)` гэж БҮР RENDER-т ШИНЭ
  // массив үүсгэдэг тул эцэг компонент дахин render хийх болгонд (мэдэгдлийн
  // 60 сек poll, focus refetch, зэрэгцээ query-нүүд бууж ирэх г.м.) урьдчилсан
  // дүүргэлт дахин ажиллаж, сонгосон төслүүдийг ЦЭВЭРЛЭЖ байв — «Дор хаяж нэг
  // төсөл сонгоно уу» анхааруулга арилдаггүй, товч идэвхгүй хэвээр үлддэг
  // байсны шалтгаан нь яг энэ.  Тиймээс effect биш, `open`-ы false→true
  // ШИЛЖИЛТ дээр л render дотор state тааруулна (React-ийн «adjusting state
  // when a prop changes» загвар — you-might-not-need-an-effect).
  const [openSnapshot, setOpenSnapshot] = useState(open);
  if (open !== openSnapshot) {
    setOpenSnapshot(open);
    if (open) {
      setSelected(new Set(initialProjectIds));
      setSelectedRepairs(new Set(initialRepairProjectIds));
      const picks = initialPicks(npToday, npCategories);
      setNpPicks(picks);
      setNav({ page: 'projects', to: null, entered: null });
    }
  }

  const finish = () => {
    setNav((n) => (n.to ? { page: n.to, to: null, entered: n.to } : n));
  };
  const goTo = (next: Page) => {
    if (leaving || next === page) return;
    setNav((n) => (n.to || n.page === next ? n : { ...n, to: next }));
    // Аюулгүйн тор: `animationend` ямар нэг шалтгаанаар ирэхгүй бол
    // (анимаци унтраасан хөтөч) хуудас гацахгүй — анимацийн уртаас удаан.
    window.setTimeout(finish, 400);
  };
  const finishLeave = (e: AnimationEvent<HTMLDivElement>) => {
    // Хүүхэд элементийн анимаци (spinner г.м.) дээшээ хөвдөг — зөвхөн
    // хуудасны өөрийн анимаци дууссан үед л шилжинэ.
    if (e.target !== e.currentTarget) return;
    finish();
  };

  // ⚠️ Зуны үед picker-ийг НУУХАА БОЛИВ (2026-08-26): ажилтан ХЭЗЭЭ Ч сонгож
  //    болно, сонголт нь `scheduleEffectiveFrom`-оос хүчин төгөлдөр болно.
  const showShiftPicker = checkpointType === 'morning' && !!onWorkScheduleChange && !scheduleLocked;
  const currentShift: Shift = selectedShift ?? workSchedule ?? 'standard';
  const options = shiftOptions(scheduleOptions);

  const copy = COPY[checkpointType];
  const selectedIds = useMemo(() => Array.from(selected), [selected]);
  const selectedRepairIds = useMemo(() => Array.from(selectedRepairs), [selectedRepairs]);
  const totalSelected = selected.size + selectedRepairs.size + wirePicks.length;
  // Төслийн хязгаар (төсөл + засвар).  `overLimit` нь өнөөдөр өмнө нь 2-оос
  // олныг сонгосон хүний урьдчилсан дүүргэлтэд л гарна — илүүг нь болиулахаас
  // нааш илгээх товч идэвхгүй.
  const projectCount = selected.size + selectedRepairs.size;
  const atLimit = projectCount >= MAX_ATTENDANCE_PROJECTS;
  const overLimit = projectCount > MAX_ATTENDANCE_PROJECTS;
  // Засварын хуудас руу орох товч: сонгох зүйл байхгүй бөгөөд юу ч сонгоогүй
  // бол харуулахгүй — хоосон хуудас руу дуудах нь утгагүй.
  const showRepairEntry = repairProjects.length > 0 || selectedRepairs.size > 0;

  // Сонгосныг болиулах нь үргэлж боломжтой; шинээр нэмэх нь хязгаарт хүрээгүй үед л.
  const toggle = (id: number) => {
    if (!selected.has(id) && atLimit) return;
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const toggleRepair = (id: number) => {
    if (!selectedRepairs.has(id) && atLimit) return;
    setSelectedRepairs((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const optionClass = (active: boolean, blocked = false) =>
    cn(
      // ⚠️ `truncate` БАЙСАН нь урт төслийн нэрийг («MGL-251006_EVERGREEN_…»)
      // таслаж, аль төсөл болохыг ялгах боломжгүй болгодог байв.  Хоёр
      // баганат сүлжээнд нэг нүдэнд ~26 тэмдэгт л багтдаг тул нэрийг
      // МӨРӨӨР ЗАДАЛНА (`break-words` нь `_`-тай урт үгийг ч хугална).
      // `items-start` — дугуй сонголт (20px) эхний мөртэй тэгширнэ.
      'flex items-start gap-2 rounded-lg border px-3 py-2 text-left text-sm leading-5 transition-colors',
      active
        ? 'border-primary/60 bg-primary/10 text-primary'
        : blocked
          ? 'cursor-not-allowed border-border bg-background/40 opacity-50'
          : 'border-border bg-background/40 hover:border-primary/40',
    );

  // Хязгаарын мэдэгдэл — төсөл ба засварын хуудсанд ижил.
  const limitNotice = overLimit ? (
    <p className="flex items-start gap-1 text-xs text-warning" data-testid="attendance-too-many-projects">
      <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      {t('attendanceProjectDialog.tooManyProjects', {
        max: MAX_ATTENDANCE_PROJECTS,
        count: projectCount,
      })}
    </p>
  ) : atLimit ? (
    <p className="flex items-start gap-1 text-xs text-muted-foreground" data-testid="attendance-project-limit">
      <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      {t('attendanceProjectDialog.maxProjectsReached', { max: MAX_ATTENDANCE_PROJECTS })}
    </p>
  ) : null;
  const limitHint = (
    <span className="ml-1 text-muted-foreground/80">
      · {t('attendanceProjectDialog.maxProjectsHint', { max: MAX_ATTENDANCE_PROJECTS })}
    </span>
  );
  const checkClass = (active: boolean) =>
    cn(
      'flex h-5 w-5 shrink-0 items-center justify-center rounded-full border',
      active ? 'border-primary bg-primary text-primary-foreground' : 'border-muted-foreground/40',
    );

  const baseSummary =
    selectedRepairs.size > 0
      ? t('attendanceProjectDialog.selectedSummary', {
          projects: selected.size,
          repairs: selectedRepairs.size,
        })
      : wirePicks.length > 0
        ? t('attendanceProjectDialog.summaryProjects', { count: selected.size })
        : t('attendanceProjectDialog.selectedCount', { count: selected.size });
  const selectionSummary =
    wirePicks.length > 0
      ? `${baseSummary} · ${t('attendanceProjectDialog.nonProjectSummary', { count: wirePicks.length })}`
      : baseSummary;

  // Сонголт нь dialog-ийн төлөвт хадгалагдана — хуудас солиход алга болохгүй.
  const leaveToProjects = () => goTo('projects');

  // Хоёр дэд хуудасны (засвар / төслийн бус) ижил «Төслүүд рүү буцах» товч.
  const backToProjects = (
    <button
      type="button"
      onClick={leaveToProjects}
      disabled={submitting}
      className={cn(
        'flex w-full items-center gap-2 rounded-lg border border-dashed px-3 py-2 text-left text-sm transition-colors',
        selected.size > 0
          ? 'border-primary/60 bg-primary/5'
          : 'border-border hover:border-primary/40 hover:bg-muted/30',
      )}
    >
      <ChevronUp className="h-4 w-4 shrink-0 text-muted-foreground" />
      <FolderOpen
        className={cn('h-4 w-4 shrink-0', selected.size > 0 ? 'text-primary' : 'text-muted-foreground')}
      />
      <span className="min-w-0 flex-1">
        <span className="font-medium">{t('attendanceProjectDialog.backToProjects')}</span>
        <span className="ml-2 text-micro text-muted-foreground">
          {t('attendanceProjectDialog.backToProjectsHint')}
        </span>
      </span>
      {selected.size > 0 && (
        <span className="rounded-full bg-primary px-2 py-0.5 text-micro font-semibold tabular-nums text-primary-foreground">
          {selected.size}
        </span>
      )}
    </button>
  );

  const offOfficeNotice = !onOfficeIp && (
    <div className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
      <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <span>{t('attendanceProjectDialog.offOfficeWarning')}</span>
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[min(42rem,calc(100%_-_2rem))]">
        {page === 'projects' ? (
          <div
            key="page-projects"
            onAnimationEnd={finishLeave}
            className={cn(
              'space-y-4',
              leaving === 'projects' &&
                'animate-out fade-out slide-out-to-top-6 fill-mode-forwards duration-200',
              entered === 'projects' && !leaving && 'animate-in fade-in slide-in-from-top-6 duration-300',
            )}
          >
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <FolderOpen className="h-5 w-5 text-primary" />
                {t(copy.titleKey)}
              </DialogTitle>
              <DialogDescription>{t(copy.descriptionKey)}</DialogDescription>
            </DialogHeader>

            {!onOfficeIp && (
              <div className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
                <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>{t('attendanceProjectDialog.offOfficeWarning')}</span>
              </div>
            )}

            {showShiftPicker && (
              <div className="space-y-2">
                <div className="text-xs text-muted-foreground">{t('attendanceProjectDialog.chooseShift')}</div>
                <div className="grid gap-2 sm:grid-cols-3">
                  {options.map((opt) => {
                    const active = currentShift === opt.key;
                    const Icon = opt.icon;
                    return (
                      <button
                        key={opt.key}
                        type="button"
                        disabled={savingSchedule || submitting}
                        onClick={() => {
                          if (active) return;
                          void onWorkScheduleChange?.(opt.key);
                        }}
                        className={cn(
                          'flex items-start gap-3 rounded-lg border-2 p-3 text-left transition-colors',
                          active
                            ? 'border-primary bg-primary/5'
                            : 'border-border hover:border-primary/40 hover:bg-muted/30',
                        )}
                      >
                        <div
                          className={cn(
                            'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg',
                            active
                              ? 'bg-primary text-primary-foreground'
                              : 'bg-muted text-muted-foreground',
                          )}
                        >
                          <Icon className="h-4 w-4" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-semibold tabular-nums">{opt.label}</div>
                          <div className="mt-0.5 text-micro text-muted-foreground">{t(opt.subKey)}</div>
                        </div>
                        {active && <CheckCircle2 className="h-4 w-4 shrink-0 text-primary" />}
                      </button>
                    );
                  })}
                </div>
                {scheduleEffectiveFrom && (
                  <p className="text-micro text-muted-foreground">
                    {t('attendanceShift.effectiveFrom', {
                      date: formatShiftDate(scheduleEffectiveFrom, lang),
                    })}
                  </p>
                )}
              </div>
            )}

            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>
                  {t('attendanceProjectDialog.projectsLabel')}
                  {limitHint}
                </span>
                <span
                  className={cn(
                    'tabular-nums',
                    totalSelected === 0 || overLimit ? 'text-warning' : 'text-success',
                  )}
                >
                  {selectionSummary}
                </span>
              </div>
              {projects.length === 0 ? (
                <div className="rounded-lg border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
                  {t('attendanceProjectDialog.noProjects')}
                </div>
              ) : (
                <div className="grid max-h-72 gap-2 overflow-y-auto pr-1 sm:grid-cols-2">
                  {projects.map((project) => {
                    const active = selected.has(project.id);
                    const blocked = !active && atLimit;
                    return (
                      <button
                        key={project.id}
                        type="button"
                        onClick={() => toggle(project.id)}
                        disabled={blocked}
                        aria-disabled={blocked}
                        className={optionClass(active, blocked)}
                      >
                        <span className={checkClass(active)}>
                          {active && <CheckCircle2 className="h-3.5 w-3.5" />}
                        </span>
                        <span className="min-w-0 flex-1 break-words" title={project.name}>
                          {project.name}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}

              {showRepairEntry && (
                <button
                  type="button"
                  onClick={() => goTo('repairs')}
                  disabled={submitting}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-lg border border-dashed px-3 py-2 text-left text-sm transition-colors',
                    selectedRepairs.size > 0
                      ? 'border-primary/60 bg-primary/5'
                      : 'border-border hover:border-primary/40 hover:bg-muted/30',
                  )}
                >
                  <Wrench
                    className={cn(
                      'h-4 w-4 shrink-0',
                      selectedRepairs.size > 0 ? 'text-primary' : 'text-muted-foreground',
                    )}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="font-medium">{t('attendanceProjectDialog.repairEntry')}</span>
                    <span className="ml-2 text-micro text-muted-foreground">
                      {t('attendanceProjectDialog.repairEntryHint')}
                    </span>
                  </span>
                  {selectedRepairs.size > 0 && (
                    <span className="rounded-full bg-primary px-2 py-0.5 text-micro font-semibold tabular-nums text-primary-foreground">
                      {selectedRepairs.size}
                    </span>
                  )}
                  <ChevronUp className="h-4 w-4 shrink-0 text-muted-foreground" />
                </button>
              )}

              {/* Төслийн бус ажил (0342) — «Засварын төсөл»-ийн яг ижил хэлбэр,
                  харин өөр дүрс/өнгө: засвар ба төслийн бус ажил ялгагдана. */}
              {showNonProjectEntry && (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => goTo('nonProject')}
                  disabled={submitting}
                  data-testid="npw-entry-button"
                  className={cn(
                    // ⚠️ `h-auto` ганцаараа `pointer-coarse:h-11`-ийг дардаггүй (tailwind-merge).
                    'h-auto w-full justify-start gap-2 whitespace-normal rounded-lg border border-dashed px-3 py-2 text-left text-sm font-normal pointer-coarse:h-auto pointer-coarse:min-h-11 has-[>svg]:px-3',
                    wirePicks.length > 0
                      ? 'border-info/60 bg-info/5 hover:bg-info/10'
                      : 'border-border hover:border-info/40 hover:bg-muted/30',
                  )}
                >
                  <ClipboardList
                    className={cn(
                      'h-4 w-4 shrink-0',
                      wirePicks.length > 0 ? 'text-info' : 'text-muted-foreground',
                    )}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="font-medium">{t('attendanceProjectDialog.nonProjectEntry')}</span>
                    <span className="ml-2 text-micro text-muted-foreground">
                      {t('attendanceProjectDialog.nonProjectEntryHint')}
                    </span>
                  </span>
                  {wirePicks.length > 0 && (
                    <span className="rounded-full bg-info px-2 py-0.5 text-micro font-semibold tabular-nums text-info-foreground">
                      {wirePicks.length}
                    </span>
                  )}
                  <ChevronUp className="h-4 w-4 shrink-0 text-muted-foreground" />
                </Button>
              )}

              {limitNotice}
              {totalSelected === 0 && (
                <p className="flex items-center gap-1 text-xs text-warning">
                  <AlertCircle className="h-3.5 w-3.5" />
                  {t('attendanceProjectDialog.selectAtLeastOne')}
                </p>
              )}
            </div>
          </div>
        ) : page === 'repairs' ? (
          <div
            key="page-repairs"
            onAnimationEnd={finishLeave}
            className={cn(
              'space-y-4',
              leaving === 'repairs' &&
                'animate-out fade-out slide-out-to-bottom-6 fill-mode-forwards duration-200',
              entered === 'repairs' && !leaving && 'animate-in fade-in slide-in-from-bottom-6 duration-300',
            )}
          >
            {/* Буцах товч — «Засварын төсөл» товчны яг ижил хэлбэр, дээд талд:
                төслийн хуудас ДЭЭР нь байгаа тул сум дээшээ (эзний хүсэлт 2026-09-17). */}
            {backToProjects}
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Wrench className="h-5 w-5 text-primary" />
                {t('attendanceProjectDialog.repairTitle')}
              </DialogTitle>
              <DialogDescription>{t('attendanceProjectDialog.repairDescription')}</DialogDescription>
            </DialogHeader>

            {!onOfficeIp && (
              <div className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
                <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>{t('attendanceProjectDialog.offOfficeWarning')}</span>
              </div>
            )}

            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>
                  {t('attendanceProjectDialog.repairListLabel')}
                  {limitHint}
                </span>
                <span
                  className={cn(
                    'tabular-nums',
                    totalSelected === 0 || overLimit ? 'text-warning' : 'text-success',
                  )}
                >
                  {selectionSummary}
                </span>
              </div>
              {repairProjects.length === 0 ? (
                <div className="rounded-lg border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
                  {t('attendanceProjectDialog.noRepairProjects')}
                </div>
              ) : (
                <div className="grid max-h-80 gap-2 overflow-y-auto pr-1 sm:grid-cols-2">
                  {repairProjects.map((rp) => {
                    const active = selectedRepairs.has(rp.id);
                    const blocked = !active && atLimit;
                    return (
                      <button
                        key={rp.id}
                        type="button"
                        onClick={() => toggleRepair(rp.id)}
                        disabled={blocked}
                        aria-disabled={blocked}
                        className={optionClass(active, blocked)}
                      >
                        <span className={checkClass(active)}>
                          {active && <CheckCircle2 className="h-3.5 w-3.5" />}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block break-words" title={rp.name}>
                            {rp.name}
                          </span>
                          {rp.description && (
                            <span className="mt-0.5 block text-micro text-muted-foreground">
                              {rp.description}
                            </span>
                          )}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
              {limitNotice}
              {totalSelected === 0 && (
                <p className="flex items-center gap-1 text-xs text-warning">
                  <AlertCircle className="h-3.5 w-3.5" />
                  {t('attendanceProjectDialog.selectAtLeastOne')}
                </p>
              )}
            </div>
          </div>
        ) : (
          <div
            key="page-non-project"
            data-testid="npw-page"
            onAnimationEnd={finishLeave}
            className={cn(
              'space-y-4',
              leaving === 'nonProject' &&
                'animate-out fade-out slide-out-to-bottom-6 fill-mode-forwards duration-200',
              entered === 'nonProject' && !leaving && 'animate-in fade-in slide-in-from-bottom-6 duration-300',
            )}
          >
            {backToProjects}
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <ClipboardList className="h-5 w-5 text-info" />
                {t('attendanceProjectDialog.nonProjectTitle')}
              </DialogTitle>
              <DialogDescription>
                {t(
                  isClockOut
                    ? 'attendanceProjectDialog.nonProjectDescriptionClockOut'
                    : 'attendanceProjectDialog.nonProjectDescription',
                )}
              </DialogDescription>
            </DialogHeader>

            {offOfficeNotice}

            {nonProjectWork && (
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                  <span>{t('attendanceProjectDialog.nonProjectPickLabel')}</span>
                  <span
                    className={cn('tabular-nums', totalSelected === 0 ? 'text-warning' : 'text-success')}
                  >
                    {selectionSummary}
                  </span>
                </div>
                <NonProjectPicker
                  categories={npCategories}
                  value={npPicks}
                  onChange={setNpPicks}
                  disabled={submitting}
                />
                <p className="text-micro text-muted-foreground" data-testid="npw-hours-hint">
                  {t('attendanceProjectDialog.nonProjectHoursHint')}
                </p>
              </div>
            )}

            {npNoteMissing && (
              <p className="flex items-start gap-1 text-xs text-warning" data-testid="npw-note-missing">
                <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                {t('attendanceProjectDialog.nonProjectNoteMissing')}
              </p>
            )}
            {/* Илгээх товч яагаад идэвхгүй болохыг энд ч хэлнэ (хязгаарт хүрсэн нь энд хамаагүй). */}
            {overLimit && limitNotice}
            {totalSelected === 0 && (
              <p className="flex items-center gap-1 text-xs text-warning">
                <AlertCircle className="h-3.5 w-3.5" />
                {t('attendanceProjectDialog.selectAtLeastOne')}
              </p>
            )}
          </div>
        )}

        {error && (
          <p
            role="alert"
            className="flex items-start gap-1.5 rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger"
          >
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span className="break-words">{error}</span>
          </p>
        )}

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
          >
            {t('common.cancel')}
          </Button>
          <Button
            type="button"
            onClick={() =>
              onSubmit(
                selectedIds,
                selectedRepairIds,
                wirePicks.map((p) => ({ ...p, note: p.note || null })),
              )
            }
            disabled={submitting || !onOfficeIp || totalSelected === 0 || npNoteMissing || overLimit}
            className="gap-2"
          >
            {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
            {t(copy.actionKey)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
