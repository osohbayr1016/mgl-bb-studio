/* ──────────────────────────────────────────────────────────────────────
 * Gantt-ийн НЭГ мөр = НЭГ төсөл (даалгавар БИШ).
 *
 * Мөр хоёр хэсэгтэй:
 *   • Зүүн наалт нүд (`sticky left-0`) — ангилал, нэр, эрсдэлийн чип,
 *     мөрөн дээр хулгана очиход гарах үйлдлийн бөөгнөрөл.
 *   • Баруун талбай — `barGeometry(...)`-ийн өгсөн байрлалтай баар.
 *
 * ӨНГӨНИЙ ДҮРЭМ (2026-08-ны цэгцлэлт — ЭНЭ ХУУДАС НЭГ Л ӨНГӨНИЙ ХЭЛТЭЙ):
 * баарны ӨНГӨ = ЭРСДЭЛ (`RISK_TONE[risk_state].bar`), баарны ДҮҮРГЭЛТ = ЯВЦ
 * (саармаг `bg-foreground/25` давхарга). Өмнө нь баар нь БАГИЙН таних өнгийг
 * авдаг байсан тул чип нь семантик, баар нь багийн гэсэн хоёр өөр хэл нэг
 * дэлгэцэнд зэрэг ярьж, уншигчийг төөрөгдүүлж байв. Хуваарийн хуудсанд баг
 * гэсэн ойлголт ОГТ байхгүй болсон (`team-colors.ts`-ийг энэ фичээс
 * бүрмөсөн салгав) — хариуцагч хүн (`leads`) л үлдсэн.
 *
 * ⚠ Өнгө дангаараа мэдээлэл дамжуулахгүй: төлөвийн ТЕКСТ шошго зүүн нүдэнд
 * үргэлж хамт харагдана.
 *
 * `risk_state === 'unscheduled'` үед баар ОГТ зурагдахгүй: төлөвлөх огноо
 * байхгүй тул зурах юм ч байхгүй. Оронд нь зүүн нүдэнд «Хуваарьгүй»
 * товч гарч `onSchedule`-ыг дуудна.
 * ────────────────────────────────────────────────────────────────── */

import { useCallback, useMemo } from 'react';
import {
  BellRing,
  CalendarPlus,
  CalendarRange,
  ExternalLink,
  Handshake,
  Info,
  Users,
} from 'lucide-react';

import { useLanguage } from '@/shared/i18n';
import { cn } from '@/shared/lib/utils';
import { APPROVAL_STATUS_TONE } from '@/shared/lib/status-colors';
import { Badge } from '@/ui/badge';
import { Button } from '@/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/tooltip';

import { barGeometry, xForDate } from '../lib/timeScale';
import { RISK_TONE, riskDetail, riskLabelKey } from '../lib/riskDisplay';
import type { TimelineProject } from '../types';
import type { DeadlinePoint } from '@/features/deadlines/types';

/** Баарны өндөр (px). Мөр нь `h-11` (44px) тул баар босоогоор голлоно. */
const BAR_HEIGHT = 20;

/** Хугацааны тэмдэглэгээний өргөн (px) — босоо зураас.  Баараас 4px өндөр
 *  тул баарны ирмэгээс дээш/доош цухуйж, дүүргэлтийн давхаргад
 *  «уусахгүй». */
const MARK_WIDTH = 3;
const MARK_OVERHANG = 4;

/** Хоёр тэмдэглэгээ энэ пикселээс ойрхон бол ганцхныг нь зурна.  Бага
 *  томруулалт дээр (1 хоног = 1.6px) хөрш хугацаанууд нэг дээрээ нэгдэж
 *  тасархай шугам мэт харагдахаас сэргийлнэ — tooltip нь бүгдийг ЖАГСААХ
 *  тул мэдээлэл алдагдахгүй. */
const MARK_MIN_GAP = 5;

/** Tooltip-д хамгийн ихдээ хэдэн хугацаа жагсаах.  Үүнээс олбол «+N»
 *  болно — бүтэн жагсаалт нь төслийн «Хугацаа» табанд байна. */
const TOOLTIP_MAX_POINTS = 12;

/** Нээлттэй үзүүрийн бүдгэрэлтийн урт (px). */
const FADE_PX = 26;

/** Явцын хувийг баарны баруун талд бичих зай (px). */
const PCT_LABEL_WIDTH = 34;

/**
 * Зүүн нүдний баруун ирмэгт үйлдлийн бөөгнөрөлд НӨӨЦЛӨХ зай.
 *
 * Бөөгнөрөл нь `absolute right-1 bottom-0.5` — тайван үед ч ҮРГЭЛЖ
 * харагддаг тул доод ХОЁР мөр (эрсдэл, төслийн мэдээлэл) хоёул түүн доогуур
 * тайрагдахгүйн тулд ижил зай нөөцөлнө.  Эс бөгөөс `truncate` нь товчнуудын
 * `bg-card` далдлагын доогуур тасарч, «21 хоног хөдөлгөөнгүй» гэх мэт
 * тайлбар хагас алга болно.
 *
 * ЗАСАХ эрхтэй үед 5 товч (гэрээний шат · дэлгэрэнгүй · нээх · хуваарь ·
 * сануулга), эрхгүй үед 2 (дэлгэрэнгүй · нээх) — тиймээс нарийн баганад
 * ажилтанд текст илүү үлдэнэ.
 */
const ACTION_RESERVE = { edit: 'pr-[9rem]', view: 'pr-[4rem]' } as const;

export interface GanttRowProps {
  project: TimelineProject;
  /**
   * Энэ уншигч хуваарийг ЗАСАХ эрхтэй эсэх (сервер талын `can_edit`, admin).
   *
   * Худал үед хуваарь тавих / сануулга / гэрээний шатны товч ОГТ зурагдахгүй
   * — «дараад 403 авах» товч байхаас байхгүй нь дээр.  Уншиж болох бүхэн
   * (нээх, дэлгэрэнгүй) хэвээр үлдэнэ.
   */
  canEdit: boolean;
  /** Энэ төслийн хугацааны цэгүүд (`project_milestones`).  Хоосон массив =
   *  хугацаа тавиагүй; `undefined` = хараахан ачаалагдаагүй.  Хоёуланд нь
   *  тэмдэглэгээ зурагдахгүй тул тусад нь ялгах шаардлагагүй. */
  points?: DeadlinePoint[];
  /** Тэнхлэгийн эхлэл — `buildRange(...)`-ийн `origin`. */
  origin: string;
  /** Нэг хоногийн өргөн (px) — тасралтгүй томруулалт. */
  pxPerDay: number;
  /** Баруун талбайн өргөн (px). */
  chartWidth: number;
  /** Зүүн наалт баганын өргөн (px). */
  nameWidth: number;
  /** Хуудаснаас ирсэн фокус — мөрийг зөөлөн тодруулна. */
  focused?: boolean;
  onOpenProject: (id: number) => void;
  /** Дэлгэрэнгүй самбарыг нээнэ (төслийн мэдээлэл + эцсийн хугацааны CRUD).
   *  Мөрийн үндсэн үйлдэл — баар дарахад ч энэ дуудагдана. */
  onOpenDetails: (p: TimelineProject) => void;
  onSchedule: (p: TimelineProject) => void;
  /** Гэрээний шатны тэмдгийг сэлгэнэ.  ЗӨВХӨН admin-д дамжуулагдана —
   *  endpoint нь requireAdmin тул senior дарвал 403 болно.  Өгөгдөөгүй бол
   *  товч огт зурагдахгүй. */
  onTogglePending?: (p: TimelineProject) => void;
  onNudge: (p: TimelineProject) => void;
}

export function GanttRow({
  project,
  canEdit,
  points,
  origin,
  pxPerDay,
  chartWidth,
  nameWidth,
  focused,
  onOpenProject,
  onOpenDetails,
  onSchedule,
  onNudge,
  onTogglePending,
}: GanttRowProps) {
  const { t } = useLanguage();

  const state = project.risk_state;
  const tone = RISK_TONE[state];
  const unscheduled = state === 'unscheduled';
  const geo = unscheduled
    ? null
    : barGeometry(project.start_date, project.finish_date, origin, pxPerDay);

  const title = project.display_title?.trim() || project.name;
  // Бичигдэх тоо жинхэнэ (засварын төсөл 100%-аас давж болно), дүүргэлт 100-д таслагдана.
  const progress = Math.max(0, Math.round(project.progress));
  const progressFill = Math.min(100, progress);
  const detail = riskDetail(t, state, project.days_left, project.stale_days, project.days_to_start);
  const stateLabel = t(riskLabelKey(state));

  const open = useCallback(() => onOpenProject(project.id), [onOpenProject, project.id]);
  const details = useCallback(() => onOpenDetails(project), [onOpenDetails, project]);
  const schedule = useCallback(() => onSchedule(project), [onSchedule, project]);
  const togglePending = useCallback(() => onTogglePending?.(project), [onTogglePending, project]);
  const nudge = useCallback(() => onNudge(project), [onNudge, project]);

  /** Хуваарьгүй мөрийн чип/товчны үйлдэл.  Засах эрхтэй бол ХУВААРЬ ТАВИХ
   *  (тэр л дутагдаж байгаа зүйл), эрхгүй бол дэлгэрэнгүй самбар — эс
   *  бөгөөс ажилтан 403 өгөх цонх нээнэ. */
  const scheduleOrDetails = canEdit ? schedule : details;

  // ── Баарны геометр ────────────────────────────────────────────────
  // `barGeometry` нь өргөнийг аль хэдийн 6px-ээс доош унагахгүй (хамгийн
  // жижиг томруулалт дээр 1 хоног = 1.6px тул ганц өдрийн ажил алга болохгүй).
  const barWidth = geo ? geo.width : 0;
  // Зөвхөн НЭГ огноо мэдэгдэж байвал тэр үзүүр таглаагүй — бөөрөнхий
  // таглааны оронд бүдгэрч дуусна.
  const radius = geo
    ? [
        geo.openStart ? '2px' : '9999px',
        geo.openEnd ? '2px' : '9999px',
        geo.openEnd ? '2px' : '9999px',
        geo.openStart ? '2px' : '9999px',
      ].join(' ')
    : undefined;
  const maskImage =
    geo && (geo.openStart || geo.openEnd)
      ? `linear-gradient(to right, ${geo.openStart ? `transparent 0, black ${FADE_PX}px` : 'black 0'}, ${
          geo.openEnd ? `black calc(100% - ${FADE_PX}px), transparent 100%` : 'black 100%'
        })`
      : undefined;
  const showPct = geo ? geo.left + barWidth + PCT_LABEL_WIDTH <= chartWidth : false;

  const leadsText = project.leads.length
    ? project.leads.map((l) => l.full_name).join(', ')
    : t('timelinePage.leadsNone');
  const rangeText = `${project.start_date || '—'} – ${project.finish_date || '—'}`;

  // ── Хугацааны тэмдэглэгээ (project_milestones) ────────────────────
  // Огноо → x пиксел.  Цэгүүд серверээс аль хэдийн огноогоор эрэмбэлэгдэж
  // ирдэг тул x нь өсөх дараалалтай — хөрш цэгүүдийн зайг шалгахад
  // ганц гүйлт хангалттай.
  //
  // ⚠️ Хэт ойрхон цэгүүдийг НУГАЛНА (`MARK_MIN_GAP`).  Эрэмбэ нь огноогоор
  //    тул үлдэх нь ҮРГЭЛЖ хамгийн эрт буюу хамгийн яаралтай нь болно —
  //    нуугдсан цэгүүд tooltip-ийн жагсаалтад бүтнээрээ гарна.
  const marks = useMemo(() => {
    if (!points || points.length === 0) return [];
    const out: { point: DeadlinePoint; x: number }[] = [];
    let lastX = Number.NEGATIVE_INFINITY;
    for (const p of points) {
      const x = xForDate(p.due_date, origin, pxPerDay);
      if (x < 0 || x > chartWidth) continue;
      if (x - lastX < MARK_MIN_GAP) continue;
      lastX = x;
      out.push({ point: p, x });
    }
    return out;
  }, [points, origin, pxPerDay, chartWidth]);

  const openPoints = points?.filter((p) => !p.done) ?? [];

  return (
    <div
      // `GanttChart` фокуслэх мөрөө DOM-оос үүгээр олно (ref-ийн газрын
      // зураг барихаас илүү энгийн — мөр бүр өвөрмөц id-тай).
      data-project-id={project.id}
      className={cn(
        // h-11 → h-14 (2026-08-13): зүүн нүд ГУРВАН мөр болов (нэр →
        // эрсдэл → төслийн мэдээлэл).  «Хугацаа» хуудас устсаны дараа энэ
        // хуудас нь төслийн жагсаалттай ижил мэдээллийг өөрөө хэлэх ёстой
        // болсон — 44px-д гурав дахь мөр багтахгүй.
        'group relative z-10 flex h-14 items-stretch border-b border-border/60 transition-colors hover:bg-muted/20',
        // Гэрээ хэлэлцээрийн шатанд — бүтэн мөр шаравтар.  `--warning` нь
        // семантик токен (`status-colors.ts`-ийн гэрээ), түүхий палитр биш.
        // `focused`-аас ӨМНӨ тавьсан нь санаатай: фокус нь давамгайлна.
        project.is_pending === 1 && 'bg-warning/10 hover:bg-warning/15',
        focused && 'bg-primary/5',
      )}
    >
      {/* ── Зүүн наалт нүд ─────────────────────────────────────────── */}
      <div
        className="text-label sticky left-0 z-20 flex shrink-0 flex-col justify-center gap-0.5 border-r border-border bg-card px-3"
        style={{ width: nameWidth }}
      >
        {/* Мөрийн hover-ийн өнгө. Наалт нүд нь торны шугамыг халхлахын
            тулд бүрэн тунгалаггүй `bg-card`-тай тул тэмдэглэгээг ТУСДАА
            давхаргаар тавина. */}
        <span
          aria-hidden
          className={cn(
            'pointer-events-none absolute inset-0 transition-colors group-hover:bg-muted/20',
            project.is_pending === 1 && 'bg-warning/10 group-hover:bg-warning/15',
            focused && 'bg-primary/5',
          )}
        />
        {/* Гэрээний шатны зүүн ирмэгийн зурвас.  Өнгө ГАНЦААРАА мэдээлэл
            дамжуулж БОЛОХГҮЙ (WCAG 1.4.1) тул доор шошго ч бас гарна;
            энэ зурвас нь зөвхөн мөрийг хурдан олоход туслана. */}
        {project.is_pending === 1 && (
          <span aria-hidden className="pointer-events-none absolute inset-y-0 left-0 w-[3px] bg-warning" />
        )}

        <div className="relative flex min-w-0 items-center gap-1.5">
          {project.category && (
            <Badge variant="outline" className="shrink-0 px-1 py-0 font-mono">
              {project.category}
            </Badge>
          )}
          {/* «Яаралтай» — төслийн ЖАГСААЛТ хуудас үүнийг улаан картаар
              хэлдэг; хуваарь дээр бүтэн мөрийг будвал эрсдэлийн өнгөний
              хэлтэй зөрчилдөх тул зөвхөн тэмдэг.  Эрэмбэд аль хэдийн
              нөлөөлдөг байсан ч ямар ч тэмдэг байгаагүй. */}
          {project.is_asap === 1 && (
            <Badge
              variant="outline"
              className="shrink-0 border-danger/40 bg-danger/10 px-1 py-0 font-mono text-danger"
            >
              ASAP
            </Badge>
          )}
          {/* Өнгөнөөс ГАДНА текст шошго — өнгө ялгах чадваргүй хэрэглэгчид
              мөрийн шаравтар өнгийг огт мэдэрэхгүй (WCAG 1.4.1). */}
          {project.is_pending === 1 && (
            <Badge
              variant="outline"
              // ⚠ `text-warning-foreground` БИШ: гэрэл горимд тэр нь ЦАГААН
              // (`0 0% 100%`) бөгөөд цайвар шар дэвсгэр дээр уншигдахгүй.
              // Зөөлөн badge-ийн репогийн жишиг нь `bg-…/10 text-…` —
              // `APPROVAL_STATUS_TONE.pending`-тэй яг ижил.
              className={cn('shrink-0 px-1 py-0', APPROVAL_STATUS_TONE.pending)}
              title={t('timelinePage.pendingHint')}
            >
              {t('timelinePage.pendingBadge')}
            </Badge>
          )}
          {/* Хугацаа сунгагдсан төсөл (migration 0337) — баар аль хэдийн
              ШИНЭ хугацаагаар зурагдана; анхны огноо title-д. */}
          {project.extension_count > 0 && (
            <Badge
              variant="outline"
              className="shrink-0 border-warning/40 bg-warning/10 px-1 py-0 text-warning"
              title={
                project.original_finish_date
                  ? `${t('deadlineExt.original')}: ${project.original_finish_date}`
                  : undefined
              }
            >
              {t('deadlineExt.countBadge', { n: project.extension_count })}
            </Badge>
          )}
          <span className="text-body truncate font-medium text-foreground" title={title}>
            {title}
          </span>
        </div>

        {/* `pr-…` — доорх үйлдлийн бөөгнөрөл ҮРГЭЛЖ харагддаг тул түүнд зай
            ЗААВАЛ нөөцлөнө.  Эс бөгөөс `truncate` нь товчнуудын `bg-card`
            далдлагын ДООГУУР тайрч, «21 хоног хөдөлгөөнгүй» гэх мэт тайлбар
            хагас алга болно.  Эрхгүй уншигчид товч 2 л байдаг тул нөөц зай
            бага — нарийн баганад текст илүү үлдэнэ. */}
        <div
          className={cn(
            'relative flex min-w-0 items-center gap-1.5',
            canEdit ? ACTION_RESERVE.edit : ACTION_RESERVE.view,
          )}
        >
          {unscheduled ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={scheduleOrDetails}
                  className={cn('rounded-full border', tone.chip)}
                >
                  <CalendarPlus aria-hidden />
                  {stateLabel}
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                {canEdit ? t('timelinePage.scheduleTitle') : t('timelinePage.details')}
              </TooltipContent>
            </Tooltip>
          ) : (
            <span
              className={cn(
                'inline-flex shrink-0 items-center gap-1 rounded-full border px-1.5 py-px',
                tone.chip,
              )}
            >
              <span aria-hidden className={cn('size-1.5 rounded-full', tone.dot)} />
              {stateLabel}
            </span>
          )}
          {detail && <span className="truncate text-muted-foreground">{detail}</span>}
        </div>

        {/* ── Гурав дахь мөр: ТӨСЛИЙН МЭДЭЭЛЭЛ ───────────────────────
            `/app/projects` жагсаалтын карт юу хэлдэг, мөр мөн адилыг товчхон
            хэлнэ: явц, гишүүдийн тоо, хариуцагч.  Дэлгэрэнгүй нь самбарт
            (`ProjectDetailPanel`) — энэ мөр зөвхөн «аль төсөл болохыг
            танихад» хангалттай байх ёстой. */}
        <div
          className={cn(
            'text-micro relative flex min-w-0 items-center gap-2 text-muted-foreground',
            canEdit ? ACTION_RESERVE.edit : ACTION_RESERVE.view,
          )}
        >
          <span className="shrink-0 tabular-nums font-medium text-foreground/80">{progress}%</span>
          <span className="inline-flex shrink-0 items-center gap-0.5 tabular-nums">
            <Users aria-hidden className="size-3" />
            {project.member_count}
          </span>
          <span className="truncate" title={leadsText}>
            {leadsText}
          </span>
        </div>

        {/* Үйлдлийн бөөгнөрөл — Дэлгэрэнгүй / Нээх (+ admin-д Хуваарь,
            Сануулга, Гэрээний шат).
            2026-08: ҮРГЭЛЖ харагдана.  Өмнө нь `sm:opacity-0` байсан бөгөөд
            зөвхөн hover дээр гарч ирдэг байв — тэр үед доор нь Анхаарах
            жагсаалт байсан тул үйлдэлд өөр зам байсан.  Тэр жагсаалт устсан
            учир ЭНЭ БӨӨГНӨРӨЛ нь хуваарь тавих / сануулга илгээх ЦОРЫН ГАНЦ
            хурдан гарц болсон — нуувал хэрэглэгч олохгүй.

            ⚠️ Бичих товч бүр `canEdit`-ээр хаагдана.  Эрхгүй хүнд ажиллахгүй
               товч үзүүлэх нь 403-ын алдааны цонхыг хэвийн зүйл болгоно. */}
        <div className="absolute right-1 bottom-0.5 z-10 flex items-center gap-0.5 rounded-md bg-card pl-2">
          {canEdit && onTogglePending && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  onClick={togglePending}
                  aria-pressed={project.is_pending === 1}
                  className={cn(project.is_pending === 1 && 'text-warning')}
                >
                  <Handshake aria-hidden />
                  <span className="sr-only">{t('timelinePage.pendingToggle')}</span>
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t('timelinePage.pendingToggle')}</TooltipContent>
            </Tooltip>
          )}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon-xs" onClick={details}>
                <Info aria-hidden />
                <span className="sr-only">{t('timelinePage.details')}</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t('timelinePage.details')}</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon-xs" onClick={open}>
                <ExternalLink aria-hidden />
                <span className="sr-only">{t('timelinePage.openProject')}</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t('timelinePage.openProject')}</TooltipContent>
          </Tooltip>
          {canEdit && (
            <>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon-xs" onClick={schedule}>
                    <CalendarRange aria-hidden />
                    <span className="sr-only">{t('timelinePage.schedule')}</span>
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{t('timelinePage.schedule')}</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon-xs" onClick={nudge}>
                    <BellRing aria-hidden />
                    <span className="sr-only">{t('timelinePage.nudge')}</span>
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{t('timelinePage.nudge')}</TooltipContent>
              </Tooltip>
            </>
          )}
        </div>
      </div>

      {/* ── Баруун талбай ──────────────────────────────────────────── */}
      <div className="relative shrink-0" style={{ width: chartWidth }}>
        {geo && (
          <Tooltip>
            <TooltipTrigger asChild>
              <div
                role="button"
                tabIndex={0}
                aria-label={`${title} — ${stateLabel}`}
                // Баар дарах = ДЭЛГЭРЭНГҮЙ САМБАР (өмнө нь төслийн хуудас
                // руу шилждэг байсан).  Хуваарийн хуудсанд байгаа хүн
                // ихэвчлэн «энэ ямар төсөл вэ, хугацаа нь юу вэ» гэдгийг
                // мэдэхийг хүсдэг болохоос хуудсаа орхихыг биш; төслийн
                // хуудас руу очих зам нь самбарт болон мөрийн ↗ товчинд
                // хэвээр байна.
                onClick={details}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    details();
                  }
                }}
                className={cn(
                  'absolute top-1/2 -translate-y-1/2 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
                  // Баарны дэвсгэр = ЭРСДЭЛ. `stale` нь дэвсгэргүй, зөвхөн
                  // тасархай хүрээтэй — доорх дүүргэлт нь `inset-y-0` тул
                  // хүрээний ДОТОР суух ба тасархай ирмэг халхлагдахгүй.
                  tone.bar,
                )}
                style={{
                  left: geo.left,
                  width: barWidth,
                  height: BAR_HEIGHT,
                  borderRadius: radius,
                  maskImage,
                  WebkitMaskImage: maskImage,
                }}
              >
                {/* Явцын дүүргэлт — СААРМАГ давхарга. Өнгө нь эрсдэлийг
                    хэлдэг тул явц нь зөвхөн ГЭРЭЛТҮҮЛГЭЭР ялгарна. */}
                <span
                  aria-hidden
                  className="absolute inset-y-0 left-0 bg-foreground/25"
                  style={{ width: `${progressFill}%`, borderRadius: radius }}
                />
              </div>
            </TooltipTrigger>
            <TooltipContent side="top" className="max-w-xs space-y-0.5">
              <p className="font-semibold">{title}</p>
              <p className="tabular-nums">{rangeText}</p>
              {detail && <p>{detail}</p>}
              <p className="tabular-nums">
                {t('timelinePage.progress')}: {progress}%
                {project.manual_progress != null ? ` · ${t('timelinePage.manualProgress')}` : ''}
              </p>
              {!project.has_breakdown && <p>{t('timelinePage.noBreakdown')}</p>}
              {/* Хариуцагч хүн — «сануулга» яг эдэн рүү очно. */}
              <p>
                {t('timelinePage.leads')}: {leadsText}
              </p>

              {/* ── Хугацаанууд ────────────────────────────────────────
                  Баар дээрх цэгүүд нь зөвхөн БАЙРЛАЛ хэлнэ; НЭР, огноо,
                  холбоос ажил нь энд гарна.  Нугалагдсан (хэт ойрхон)
                  цэгүүд ч энд БҮТНЭЭР жагсана — тиймээс `marks` биш
                  `points`-ыг уншина. */}
              {points && points.length > 0 && (
                <div className="mt-1 space-y-0.5 border-t border-border/40 pt-1">
                  <p className="font-medium">
                    {t('timelinePage.deadlinesTitle', { n: openPoints.length })}
                  </p>
                  {points.slice(0, TOOLTIP_MAX_POINTS).map((p) => (
                    <p
                      key={p.id}
                      className={cn(
                        'flex items-baseline gap-1.5',
                        p.done && 'line-through opacity-60',
                      )}
                    >
                      <span className="shrink-0 tabular-nums">{p.due_date}</span>
                      <span className="truncate">
                        {p.is_sub ? '· ' : ''}
                        {p.title}
                      </span>
                      {p.link_name && (
                        <span className="shrink-0 opacity-70">({p.link_name})</span>
                      )}
                    </p>
                  ))}
                  {points.length > TOOLTIP_MAX_POINTS && (
                    <p className="opacity-70">
                      {t('timelinePage.deadlinesMore', {
                        n: points.length - TOOLTIP_MAX_POINTS,
                      })}
                    </p>
                  )}
                </div>
              )}
            </TooltipContent>
          </Tooltip>
        )}

        {/* Хуваарьгүй мөрийн ХООСОН төмсөг.  Баар зурах өгөгдөл байхгүй тул
            энэ талбай урьд нь бүрэн хоосон байсан — 24 төслийн 12 нь ийм
            байсан учир чартын тал хувь нь цагаан зай байв.  Одоо тэр зайг
            үйлдэл болгов: «Хуваарь тавих» нь устгасан UnscheduledList-ийн
            үүргийг чарт өөрөө авч байгаа хэлбэр.

            ⚠️ `sticky` ЗОРИУДААР БИШ: наалдуулбал зүүн талын нэрийн нүд
            (`sticky left-0 z-20`) дор гулсаж алга болно.  Хөндлөн гүйлгэхэд
            энэ товч дэлгэцээс гарна — гэхдээ нэрийн нүдэн дэх «Хуваарьгүй»
            чип нь өөрөө мөн `onSchedule`-ыг дууддаг бөгөөд ТЭР наалддаг тул
            үйлдэл ямар ч гүйлтийн байрлалд хүрэх боломжтой хэвээр. */}
        {unscheduled && (
          <div className="absolute inset-y-0 left-0 flex items-center pl-3">
            <Button
              variant="outline"
              size="xs"
              onClick={scheduleOrDetails}
              className="border-dashed text-muted-foreground"
            >
              <CalendarPlus aria-hidden />
              {canEdit ? t('timelinePage.schedule') : t('timelinePage.details')}
            </Button>
          </div>
        )}

        {/* ── Хугацааны тэмдэглэгээ ──────────────────────────────────
            Баарнаас ДЭЭР (`z-20`) босоо зураас.  Баар байхгүй (хуваарьгүй)
            төсөл дээр ч зурагдана — хугацаа нь төслийн огноонооос
            хамааралгүй оршдог.

            ⚠️ Radix `<Tooltip>` ЗОРИУДААР ХЭРЭГЛЭЭГҮЙ: 24 мөр × 15 цэг =
               ~360 нэмэлт portal компонент болж хуудсыг хүндрүүлнэ.  Цэг
               бүр төрөлх `title`-тэй (нарийн заалт хэрэгтэй үед), харин
               БҮТЭН жагсаалт нь баарны tooltip дотор гарна. */}
        {marks.length > 0 && (
          <div aria-hidden className="pointer-events-none absolute inset-0 z-20">
            {marks.map(({ point, x }) => {
              const markTone = RISK_TONE[point.risk_state];
              // Дэд хугацаа = богино зураас (эцгээсээ бага жинтэй гэдгийг
              // ХЭМЖЭЭГЭЭР ялгана, өнгөөр биш — өнгө нь эрсдэлийнх).
              const h = point.is_sub ? BAR_HEIGHT : BAR_HEIGHT + MARK_OVERHANG * 2;
              return (
                <span
                  key={point.id}
                  title={`${point.due_date} · ${point.title}${
                    point.link_name ? ` (${point.link_name})` : ''
                  }`}
                  className={cn(
                    'pointer-events-auto absolute top-1/2 -translate-y-1/2 rounded-full',
                    // Дууссан хугацаа — тайван, бүдэг.  Эрсдэлийн өнгө нь
                    // зөвхөн ХИЙГДЭЭГҮЙ мөрөнд утгатай.
                    point.done ? 'bg-success/60' : markTone.bar,
                    point.done && 'opacity-70',
                  )}
                  style={{
                    left: x - MARK_WIDTH / 2,
                    width: MARK_WIDTH,
                    height: h,
                  }}
                />
              );
            })}
          </div>
        )}

        {/* Явцын хувь — баарны баруун талд, зай хүрэлцэх үед. */}
        {geo && showPct && (
          <span
            className="text-label absolute top-1/2 -translate-y-1/2 tabular-nums text-muted-foreground"
            style={{ left: geo.left + barWidth + 6 }}
          >
            {progress}%
          </span>
        )}
      </div>
    </div>
  );
}

export default GanttRow;
