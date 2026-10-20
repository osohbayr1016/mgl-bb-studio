/**
 * Төслийн ЖАГСААЛТ хуудасны явцын баар дээрх хугацааны хөзөр.
 *
 * ЯАГААД ЭНЭ БАЙНА ВЭ: хүмүүс өдөр бүр `/app/projects`-ыг л ашигладаг ба
 * хуваарийн хуудас руу ордоггүй.  Тиймээс «энэ төсөлд ямар хугацаанууд
 * байна вэ» гэдгийг тэдний аль хэдийн хардаг газарт нь авчирна.
 *
 * ⚠️ ЗӨВХӨН УНШИНА.  Нэмэх / засах / устгах / «биелсэн» гэж тэмдэглэх
 *    бүгд `/app/timeline`-ийн мөрийн дэлгэрэнгүй самбарт (эсвэл төслийн
 *    «Эцсийн хугацаа» табанд) үлдэнэ.  Хөзөр дотор товч тавьж болохгүй:
 *    hover хөзөр нь хулгана тийш очих замд хаагдаж, дарагдахгүй.  Мөн
 *    хоёр газарт хоёр засварлагч гарвал эрхийн дүрэм чимээгүй зөрнө.
 *
 * ⚠️ Хүсэлт НЭМЭХГҮЙ.  Бүх өгөгдөл нь `ProjectsPage`-ийн аль хэдийн
 *    татсан `GET /api/deadlines/summary` (нэг хүсэлтээр бүх төсөл)-ээс
 *    ирнэ.  Хөзөр бүр өөрөө дуудвал жагсаалт N+1 хүсэлт болно.
 *
 * ─── ХЭЛБЭРИЙН ГУРВАН ДҮРЭМ (2026-08-12-нд хэрэглэгчийн засвараар) ────
 *
 * 1. ӨРГӨН НЬ ТРИГГЕРТЭЙ ЯГ ТЭНЦҮҮ.  `w-(--radix-…-trigger-width)` нь
 *    хөзрийг явцын баарны мужид тулгана.  Тогтмол `w-80` үед хөзөр нь
 *    баарнаас нарийн, баруун тийш шахагдаж, «огт хамааралгүй цонх» шиг
 *    уншигдаж байв.  Энэ хувьсагчийг ХАСВАЛ тэр алдаа шууд эргэж ирнэ.
 *
 * 2. МӨР БҮР НЭГ ЛӨӨР.  Өргөн нь бэлэн болсон тул огноо, гарчиг, хүн,
 *    явц, төлөв бүгд НЭГ мөрөнд багтана — өндөр нь намхан үлдэж, хөзөр
 *    баарны «үргэлжлэл» шиг харагдана.  Мөр доор нэмэлт мөр (тэмдэглэл,
 *    мета) бичвэл хөзөр өндөрсөж, дүрэм 1-ийн үр нөлөө алдагдана.
 *    Тэмдэглэл нь `title=` атрибутад орно — өндөр иддэггүй.
 *
 *    ⚠️ Дүрэм 1-ийн ХАРИУЦЛАГА: хөзөр нь дэлгэц биш, СҮЛЖЭЭНИЙ 5 БАГАНЫН
 *       өргөнтэй (1024px дэлгэцэд ≈250px).  Тиймээс мөрийн сонголтот
 *       баганууд нь `@container` гохоор (`@[26rem]`, `@[30rem]`) нээгдэнэ
 *       — дэлгэцийн `sm:`-ээр биш.  `sm:` (640px) нь 1280px дэлгэцэд аль
 *       хэдийн идэвхтэй байх тул тэр гохтой үед 250-360px хөзөрт бүх
 *       багана зэрэг нээгдэж, ГАРЧГИЙГ 0px болгож дардаг байв.
 *
 * 3. КУРСОР ӨӨРЧЛӨГДӨХГҮЙ.  `cursor-help` (асуултын тэмдэг) нь энэ блокийг
 *    дарж болох мэт сэтгэгдэл төрүүлдэг байв — hover нь өөрөө хангалттай
 *    дохио.
 *
 * ⚠ Өнгө ганцаараа мэдээлэл дамжуулахгүй (`riskDisplay.ts`-ийн дүрэм):
 *   мөр бүр огноо + «N хоног» текстээ авч явна.
 */
import type { KeyboardEvent, ReactNode } from 'react';
import { CalendarClock, CheckCircle2, Flag } from 'lucide-react';
import { Link } from 'react-router-dom';

import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/i18n';
import { formatDisplayName } from '@/shared/lib/formatting';
import { useMediaQuery } from '@/shared/hooks/useMediaQuery';
import { RISK_TONE, riskDetail, riskLabelKey } from '@/features/timeline/lib/riskDisplay';
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/ui/hover-card';
import { Popover, PopoverContent, PopoverTrigger } from '@/ui/popover';

import type { DeadlinePoint, DeadlineSummary } from './types';

/** Мөрийн баруун захын төлөвийн чагт — «12 хоног хэтэрсэн» гэх мэт.
 *  Текст гаргаж чадахгүй бол төлөвийн нэрэнд шилжинэ (хоосон чип үлдээхгүй). */
function RiskChip({
  state,
  daysLeft,
}: {
  state: DeadlinePoint['risk_state'];
  daysLeft: number | null;
}) {
  const { t } = useLanguage();
  const detail = riskDetail(t, state, daysLeft, null, null);
  return (
    <span
      className={cn(
        'flex-none whitespace-nowrap rounded border px-1 py-px text-[10px] font-medium',
        RISK_TONE[state].chip,
      )}
    >
      {detail || t(riskLabelKey(state))}
    </span>
  );
}

/**
 * Нэг milestone — ЯГ НЭГ МӨР.
 *
 * Багана бүр тогтмол өргөнтэй (`w-*` + `flex-none`) тул мөрүүд нүдээр
 * босоо баганад эрэмбэлэгдэн уншигдана; зөвхөн гарчиг л уян (`flex-1`)
 * бөгөөд тасарна.  Хүн/явц/тоо нь `hidden … sm:flex` — нарийн дэлгэцэд
 * мөрийг таслахын оронд ХАСНА (мөр таслах нь өндөр нэмнэ).
 */
function PointRow({ point }: { point: DeadlinePoint }) {
  const { t } = useLanguage();
  const tone = RISK_TONE[point.done ? 'done' : point.risk_state];

  // Мөрөнд багтахгүй бүх зүйл — hover title.  Ингэснээр мэдээлэл
  // алдагдахгүй ч хөзөр өндөрсөхгүй.
  const people =
    point.people.length > 0
      ? point.people.map((p) => formatDisplayName(p.full_name)).join(', ')
      : t('deadlines.groupNoPerson');
  const fullTitle = [
    point.title,
    people,
    point.link_name ? `${t('deadlines.detailLink')}: ${point.link_name}` : null,
    point.task_count > 0 ? t('deadlines.rowTasks', { n: point.task_count }) : null,
    point.note ? `${t('deadlines.detailNote')}: ${point.note}` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <div
      title={fullTitle}
      className={cn(
        'flex items-center gap-2 rounded px-1.5 py-1 text-[11px] leading-none',
        point.is_sub && 'ml-2 border-l border-border/60 pl-2',
        point.done && 'opacity-55',
      )}
    >
      <span className={cn('h-1.5 w-1.5 flex-none rounded-full', tone.dot)} aria-hidden="true" />

      <span className="w-9 flex-none tabular-nums text-muted-foreground">
        {point.due_date.slice(5)}
      </span>

      <span className={cn('min-w-0 flex-1 truncate font-medium', point.done && 'line-through')}>
        {point.title}
      </span>

      {/* Хариуцагч — «хэн барих вэ».  Бүтэн жагсаалт нь мөрийн `title`-д.
          ⚠️ Гох нь ХӨЗРИЙН өргөн (`@[…]`), дэлгэцийнх (`sm:`) БИШ.  Хөзрийн
             өргөн нь триггерийнхтэй тэнцүү буюу 12 баганат сүлжээний 5
             багана ≈ 250-420px — 1280px дэлгэц дээр ч `sm:` (640px) нь
             аль хэдийн идэвхтэй байдаг тул эдгээр багана нь ЯГ зай
             байхгүй үед нээгдэж, гарчгийг 0px болгож дардаг байв. */}
      <span className="hidden w-24 flex-none truncate text-right text-muted-foreground @[26rem]:block">
        {people}
      </span>

      {/* Холбоосон ажлын явц — «хугацаа дөхөж байхад ажил хаана байна вэ».
          Хамгийн бага мэдээлэлтэй багана (холбоосгүй мөрөнд хоосон) тул
          хамгийн сүүлд нээгдэнэ. */}
      <span className="hidden w-16 flex-none items-center gap-1 @[30rem]:flex">
        {point.work_progress != null && (
          <>
            <span className="h-1 min-w-0 flex-1 overflow-hidden rounded-full bg-muted">
              <span
                className="block h-full rounded-full bg-primary/70"
                style={{ width: `${Math.max(0, Math.min(100, point.work_progress))}%` }}
              />
            </span>
            <span className="w-7 flex-none text-right tabular-nums text-muted-foreground">
              {Math.round(point.work_progress)}%
            </span>
          </>
        )}
      </span>

      {point.done ? (
        // Тогтмол `w-16` БИШ: дууссан мөр нь нээлттэй мөрүүдийн саяхан
        // чөлөөлсөн 64px-ыг эргүүлэн эзэлж, гарчгийг дахин дарах болно.
        <span className="flex flex-none items-center gap-0.5 text-[10px] font-medium text-success">
          <CheckCircle2 className="h-3 w-3 flex-none" aria-hidden="true" />
          {t('deadlines.detailDone')}
        </span>
      ) : (
        <RiskChip state={point.risk_state} daysLeft={point.days_left} />
      )}
    </div>
  );
}

/** Хөзрийн агуулга.  Hover болон tap хоёр замд ИЖИЛ самбар гарна. */
function DeadlinePanel({ summary, projectId }: { summary: DeadlineSummary; projectId: number }) {
  const { t } = useLanguage();

  // Дуусаагүйг дээр, дууссаныг тусад нь доор.  Сервер тал аль хэдийн
  // огноогоор эрэмбэлсэн тул энд ЗӨВХӨН хуваана — дахин эрэмбэлбэл
  // Timeline-ийн цэгүүдтэй дараалал зөрнө.
  const open = summary.points.filter((p) => !p.done);
  const done = summary.points.filter((p) => p.done);

  return (
    // `@container` — мөрийн баганууд ЭНЭ хайрцгийн өргөнөөр нээгддэг
    // (`PointRow`-ийн тайлбарыг үз).  Өндрийн хязгаар нь ЭНД БИШ, Radix-ийн
    // контент хайрцаг дээр байна: тэр хайрцаг `available-height`-аар
    // хумигдахад энэ самбар түүнээс өндөр үлдэж, хөл (заавар + холбоосууд)
    // тасарч, гүйлгэх ч аргагүй болж байв.  Одоо хоёр хязгаар НЭГ хайрцаг
    // дээр сууж, зөрүүг зөвхөн дотоод жагсаалт шингээнэ.
    <div className="@container flex min-h-0 flex-1 flex-col text-left">
      {/* ── Толгой: гарчиг зүүн, тоолуурууд баруун — НЭГ мөр ── */}
      <div className="flex flex-none items-center gap-2 border-b border-border/60 px-2.5 py-1.5">
        <CalendarClock className="h-3.5 w-3.5 flex-none text-brand-copper" aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate text-[11px] font-semibold">
          {t('deadlines.relatedProject')}
        </span>
        <span className="inline-flex flex-none items-center gap-1 text-[10px] text-muted-foreground">
          <span className={cn('h-1.5 w-1.5 rounded-full', RISK_TONE.overdue.dot)} aria-hidden="true" />
          <span className="font-semibold tabular-nums text-foreground">
            {summary.overdue_count}
          </span>
          {t('deadlines.countOverdue')}
        </span>
        <span className="inline-flex flex-none items-center gap-1 text-[10px] text-muted-foreground">
          <span className={cn('h-1.5 w-1.5 rounded-full', RISK_TONE.on_track.dot)} aria-hidden="true" />
          <span className="font-semibold tabular-nums text-foreground">{summary.open_count}</span>
          {t('deadlines.countOpen')}
        </span>
      </div>

      {/* ── Гүйлгэх хэсэг ── */}
      {/* `overflow-x-hidden` — CSS-ийн дүрмээр `overflow-y-auto` нь
          `overflow-x`-ыг ч `auto` болгодог тул мөр багтахгүй тохиолдолд
          хөзөр дотор хэвтээ гүйлгүүр ургаж, төлөвийн чагт таслагдана. */}
      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain px-1 py-1">
        {/* Төслийн ӨӨРИЙН эцсийн хугацаа — milestone-уудаас ТУСДАА, дээр.
            `next`-ээс биш `project_due`-ээс уншина: хамгийн ойрын мөр нь
            milestone байхад ч төслийн огноо алга болохгүй. */}
        {summary.project_due && (
          <div className="mb-0.5 flex items-center gap-2 rounded bg-muted/40 px-1.5 py-1 text-[11px] leading-none">
            <Flag className="h-3 w-3 flex-none text-muted-foreground" aria-hidden="true" />
            <span className="min-w-0 flex-1 truncate font-medium">
              {t('deadlines.projectFinish')}
            </span>
            <span className="flex-none tabular-nums text-muted-foreground">
              {summary.project_due.due_date}
            </span>
            <RiskChip
              state={summary.project_due.risk_state}
              daysLeft={summary.project_due.days_left}
            />
          </div>
        )}

        {open.map((p) => (
          <PointRow key={p.id} point={p} />
        ))}

        {done.length > 0 && (
          <>
            <div className="mt-1 border-t border-border/40 px-1.5 pb-0.5 pt-1 text-[10px] font-medium text-muted-foreground">
              {t('deadlines.doneSection', { n: done.length })}
            </div>
            {done.map((p) => (
              <PointRow key={p.id} point={p} />
            ))}
          </>
        )}
      </div>

      {/* ── Хөл: энэ хөзөр уншихад зориулагдсаныг ИЛ хэлж, засах газар руу
             нь чиглүүлнэ.  Хэрэглэгч «яагаад эндээс өөрчилж болохгүй вэ»
             гэж гайхах ёсгүй.  Мөн НЭГ мөр. ── */}
      <div className="flex flex-none items-center gap-2 border-t border-border/60 px-2.5 py-1.5 text-[10px]">
        <span className="min-w-0 flex-1 truncate text-muted-foreground">
          {t('deadlines.hoverManageHint')}
        </span>
        <Link
          to={`/app/projects/${projectId}?tab=deadlines`}
          className="flex-none whitespace-nowrap text-brand-copper hover:underline"
        >
          {t('deadlines.detailOpenTab')}
        </Link>
        <Link
          to="/app/timeline"
          className="flex-none whitespace-nowrap text-muted-foreground hover:underline"
        >
          {t('deadlines.allDeadlines')}
        </Link>
      </div>
    </div>
  );
}

/**
 * Явцын блокийг ороож, хугацааны самбарыг нээнэ.
 *
 * Хулгантай төхөөрөмж дээр `HoverCard` (хүрч ойртоход), хүрэлцэх
 * төхөөрөмж дээр `Popover` (дарахад) — Radix-ийн HoverCard нь touch дээр
 * ОГТ нээгддэггүй тул гар утсанд самбар мөнхөд нуугдах байсан.
 */
export function ProjectDeadlineHover({
  summary,
  projectId,
  children,
  className,
}: {
  summary: DeadlineSummary | undefined;
  projectId: number;
  children: ReactNode;
  className?: string;
}) {
  const { t } = useLanguage();
  const canHover = useMediaQuery('(hover: hover) and (pointer: fine)');

  // ⚠️ `className` нь дуудагчийн СҮЛЖЭЭНИЙ байрлалыг (`lg:col-span-5`)
  //    авч явдаг тул ороогч <div> нь БҮХ салаанд заавал зурагдана.  Өгөгдөл
  //    ачаалагдах хүртэл түүнийг алгасвал мөр нэг агшин задарна.
  const wrapper = (extra: string, extraProps: Record<string, unknown> = {}) => (
    <div className={cn(className, extra)} {...extraProps}>
      {children}
    </div>
  );

  // Хөзөр нээхгүй ХОЁР тохиолдол, ижил шалтгаанаар (`ProjectDeadlineChip`
  // -ийн «мэдэгдэх зүйлгүй бол юу ч гаргахгүй» зарчим):
  //   · хураангуй ирээгүй — ачаалж байна, эсвэл сервер 60 төслөөр таслав
  //   · төсөлд эцсийн хугацаа ч, milestone ч огт байхгүй
  // Хоосон хөзөр нээвэл баар бүр дээр хулгана саатах бүрд утгагүй цонх
  // гарч, жагсаалт бүхэлдээ чимээ шуугиантай болно.
  //
  // `!summary.project_due` (`=== null` БИШ): frontend нь backend-ээс өмнө
  // тавигдвал тэр талбар нь `undefined` ирнэ — тэгэхэд `=== null` худал
  // болж, хугацаагүй төсөл дээр хоосон хөзөр нээгдэнэ.
  if (!summary || (!summary.project_due && summary.points.length === 0)) {
    return wrapper('');
  }

  const label = t('deadlines.relatedProject');
  /** Фокусын бөгж — `outline-none`-ыг ганцаар тавьвал гарын хэрэглэгч
   *  триггер хаана байгааг мэдэхээ болино. */
  const focusRing =
    'rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring/40';

  if (!canHover) {
    return (
      <Popover>
        <PopoverTrigger asChild>
          {wrapper(focusRing, {
            role: 'button',
            tabIndex: 0,
            'aria-label': label,
            // ⚠️ `role="button"` бүхий <div> нь Enter/Space-ийг click болгож
            //    ХӨРВҮҮЛДЭГГҮЙ, харин Radix-ийн `PopoverTrigger` нь зөвхөн
            //    `onClick` нийлүүлдэг — гарын идэвхжүүлэлтийг гараар нэмнэ.
            //    (HoverCard салаанд хэрэггүй: тэр фокус дээр өөрөө нээгддэг.)
            //    Жинхэнэ <button> болгож БОЛОХГҮЙ: `wrapper` нь дуудагчийн
            //    сүлжээний ангийг авч явдаг ба дотроо явцын баарууд агуулна.
            onKeyDown: (e: KeyboardEvent<HTMLDivElement>) => {
              if (e.target !== e.currentTarget) return;
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                e.currentTarget.click();
              }
            },
          })}
        </PopoverTrigger>
        {/* HoverCard салаатай ЯГ ижил хэлбэр — тайлбарыг доор нь үз. */}
        <PopoverContent
          side="top"
          align="start"
          sideOffset={6}
          className="flex max-h-[min(13.5rem,var(--radix-popover-content-available-height,13.5rem))] w-(--radix-popover-trigger-width) flex-col overflow-hidden p-0"
        >
          <DeadlinePanel summary={summary} projectId={projectId} />
        </PopoverContent>
      </Popover>
    );
  }

  return (
    <HoverCard openDelay={120} closeDelay={80}>
      <HoverCardTrigger asChild>{wrapper(focusRing, { tabIndex: 0, 'aria-label': label })}</HoverCardTrigger>
      {/* `side/align` нь хөзрийг явцын баарны ЭГЦ ДЭЭР, ЗҮҮН ИРМЭГЭЭР
          нь тулгана.  Өмнөх `align="end"` нь түүнийг баруун дээш шахаж,
          баартай хамаагүй цонх мэт болгож байв.

          ⚠️ ӨНДРИЙН ХЯЗГААР ЭНД БАЙХ ЁСТОЙ, самбар дээр биш.  Примитив нь
             `max-h-(--radix-…-available-height)`-тэй; хэрэв самбар нь
             өөрийн `max-h`-тэй бол богино цонхонд самбар нь энэ хайрцгаас
             өндөр гарч, хөл нь ТАСАРЧ, гүйлгэх ч аргагүй болно.  Тиймээс
             `min(13.5rem, available)`-ыг ЭНД тавьж, `flex flex-col` болгож,
             самбар нь `flex-1 min-h-0`-оор дүүрнэ — зөрүүг зөвхөн дотоод
             жагсаалт шингээж, толгой/хөл наалттай үлдэнэ.
             (`,13.5rem` нөөц утга нь байрлал тооцоологдох эхний хүрээнд
             хувьсагч тодорхойгүй байх агшинг барина.) */}
      <HoverCardContent
        side="top"
        align="start"
        sideOffset={6}
        className="flex max-h-[min(13.5rem,var(--radix-hover-card-content-available-height,13.5rem))] w-(--radix-hover-card-trigger-width) flex-col overflow-hidden p-0"
      >
        <DeadlinePanel summary={summary} projectId={projectId} />
      </HoverCardContent>
    </HoverCard>
  );
}

export default ProjectDeadlineHover;
