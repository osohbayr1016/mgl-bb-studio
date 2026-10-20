/* ──────────────────────────────────────────────────────────────────────
 * Портфелийн Gantt — НЭГ мөр = НЭГ төсөл.
 *
 * Гараар угсарсан: CSS grid/flex + абсолют байрлалтай div. Gantt номын сан
 * ЗОРИУДААР нэмээгүй (энд SVAR байсныг устгасан — түүний үнэгүй хувилбар
 * хуваарьгүй мөрийг зурахгүй, CSS нь энэ аппын урвуу сэдэвтэй нийцэхгүй).
 * Огнооны номын сан ч байхгүй — бүх тооцоо `lib/timeScale.ts`-д.
 *
 * Бүтэц (ганц гүйлгэх сав, хоёр тэнхлэгт наалт):
 *
 *   scrollRef (overflow-auto)
 *   └─ content (w-max)
 *      ├─ TimeAxis            ← sticky top-0  (дотор нь sticky left-0 булан)
 *      └─ rows (relative)
 *         ├─ торны давхарга    ← z-0: амралтын багана + major шугам + «өнөөдөр»
 *         └─ GanttRow[]        ← z-10: наалт нэрийн нүд + баарууд
 *
 * z-давхаргын дараалал нь заавал ийм байх ёстой: «өнөөдөр»-ийн шугам нь
 * торноос ДЭЭР, гэхдээ баараас ДООР байна.
 *
 * ХАРИЛЦАН ҮЙЛДЭЛ (2026-08, TradingView маяг):
 *   • Ctrl/⌘ + дугуй → ТАСРАЛТГҮЙ томруулалт, ХУЛГАНЫ ДООРХ ӨДРИЙГ БАРИНА.
 *   • Чирэх         → хэвтээ/босоо гүйлгэлт (grab / grabbing).
 *   • Ердийн дугуй  → хөндөхгүй, хуудас/сав хэвийн гүйнэ.
 *
 * Виртуалчлал ОРУУЛААГҮЙ — бодит амьдрал дээр 10–100 мөр. (`@tanstack/
 * react-virtual` суусан ч энэ репод хаана ч ашиглагдаагүй; тэр хэвээр байг.)
 * ────────────────────────────────────────────────────────────────── */

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { useReducedMotion } from 'motion/react';

import { useLanguage } from '@/shared/i18n';
import { cn } from '@/shared/lib/utils';

import {
  barGeometry,
  buildBands,
  buildRange,
  buildTicks,
  buildWeekendSpans,
  clampPxPerDay,
  xForDate,
} from '../lib/timeScale';
import type { TimelineProject } from '../types';
import type { DeadlinePoint } from '@/features/deadlines/types';
import { GanttRow } from './GanttRow';
import { TimeAxis } from './TimeAxis';

/** Зүүн наалт баганын АНХДАГЧ өргөн (≥640px дэлгэц; утсан дээр
 *  `NAME_WIDTH_NARROW`).  Хэрэглэгч чирж өөрчилж болох ба сонголт нь
 *  `timeline_name_width`-д хадгалагдана — энэ нь зөвхөн эхлэх утга.
 *
 *  240 биш 300 байгаа шалтгаан: төслийн нэр «MGL-240904_ХӨШИГТИЙН ХӨНДИЙ_
 *  Захиргааны барилга» хэлбэртэй байдаг тул 240px дээр код + 6 үсэг л
 *  багтаж, мөр бүр «MGL-240904_ХӨШИГТИЙ…» болж ялгагдахаа больдог.  300px
 *  нь код + утга бүхий хэсгийг үзүүлнэ.  Чирэлтийн хязгаар: MIN 120 … MAX 560. */
const NAME_WIDTH_WIDE = 300;
const NAME_WIDTH_NARROW = 200;

/** Хэрэглэгчийн чирэлтийн хязгаар.  Доод хязгаар нь ангиллын шошго + нэрний
 *  эхний үеийг багтаах хамгийн бага зай; дээд хязгаар нь хуанлид зай
 *  үлдээхийн тулд. */
const NAME_WIDTH_MIN = 120;
const NAME_WIDTH_MAX = 560;

/** Сонгосон өргөнийг хадгалах түлхүүр — theme/хэл шиг localStorage-д.
 *  Хэрэглэгч нэг л удаа тохируулаад дараа бүр дахин чирэх ёсгүй. */
const NAME_WIDTH_KEY = 'timeline_name_width';

function clampNameWidth(v: number): number {
  if (!Number.isFinite(v)) return NAME_WIDTH_WIDE;
  return Math.round(Math.max(NAME_WIDTH_MIN, Math.min(NAME_WIDTH_MAX, v)));
}

/** Анхдагч өргөн — дэлгэцийн өргөнөөс. */
function defaultNameWidth(): number {
  return window.matchMedia('(min-width: 640px)').matches ? NAME_WIDTH_WIDE : NAME_WIDTH_NARROW;
}

/** Хадгалсан өргөн. Тохируулаагүй эсвэл хог утга бол `null`.
 *  localStorage нь private горимд шидэж болзошгүй тул хамгаалав. */
function storedNameWidth(): number | null {
  try {
    const raw = localStorage.getItem(NAME_WIDTH_KEY);
    if (raw === null) return null;
    const n = Number(raw);
    return Number.isFinite(n) ? clampNameWidth(n) : null;
  } catch {
    return null;
  }
}

/** Дугуйны нэг «клик» хэдэн хувиар томруулах вэ (экспоненциал).
 *  0.0015 нь хулганы 100px-ийн алхмыг ~16%, trackpad-ийн жижиг алхмыг
 *  мэдрэгдэхүйц боловч зөөлөн болгоно. */
const ZOOM_WHEEL_FACTOR = 0.0015;

/** Хулганы товч дарж энэ хэмжээнээс хол хөдөлбөл «чирэлт» гэж үзнэ (px). */
const DRAG_THRESHOLD = 4;

/** Чирэлт эхлэхийг ЗӨВШӨӨРӨХГҮЙ элементүүд — товч/холбоос нь ажлаа хийг. */
const INTERACTIVE_SELECTOR =
  'button,a,input,select,textarea,[role="button"],[data-resize-handle]';

export interface GanttChartProps {
  /** Хуудсаар аль хэдийн шүүгдэж, эрэмбэлэгдсэн жагсаалт. */
  projects: TimelineProject[];
  /** Сервер талын `can_edit` (admin).  Мөр бүрд дамжина — засварын товч
   *  зөвхөн үнэн үед зурагдана. */
  canEdit: boolean;
  /** Төслийн id → түүний хугацааны цэгүүд (`project_milestones`).
   *  Тусдаа хүсэлтээс (`/api/deadlines/summary`) ирдэг тул `/api/timeline`
   *  хариу нь ӨӨРЧЛӨГДӨӨГҮЙ — хуваарь нь хугацаа ачаалагдахыг хүлээхгүй,
   *  цэгүүд бэлэн болмогц дээр нь нэмэгдэнэ. */
  deadlinePoints?: Map<number, DeadlinePoint[]>;
  today: string;
  /** Нэг хоногийн өргөн (px) — тасралтгүй томруулалт. */
  pxPerDay: number;
  /** Чарт өөрөө томруулалт хүсэх суваг (ctrl+дугуй). */
  onPxPerDayChange: (next: number) => void;
  onOpenProject: (id: number) => void;
  /** Мөрийн дэлгэрэнгүй самбарыг нээнэ (төслийн мэдээлэл + хугацааны CRUD). */
  onOpenDetails: (p: TimelineProject) => void;
  onSchedule: (p: TimelineProject) => void;
  onNudge: (p: TimelineProject) => void;
  /** ЗӨВХӨН admin-д өгөгдөнө; өгөгдөөгүй бол мөрөнд товч гарахгүй. */
  onTogglePending?: (p: TimelineProject) => void;
  /** Өөрчлөгдөх бүрд тухайн мөрийг харагдах хэсэгт гүйлгэнэ. */
  focusProjectId?: number | null;
  /** «Өнөөдөр» товч дарагдах бүрд хуудас энэ тоог нэмэгдүүлнэ. */
  scrollToTodayToken?: number;
}

export function GanttChart({
  projects,
  canEdit,
  deadlinePoints,
  today,
  pxPerDay,
  onPxPerDayChange,
  onOpenProject,
  onOpenDetails,
  onSchedule,
  onNudge,
  onTogglePending,
  focusProjectId,
  scrollToTodayToken,
}: GanttChartProps) {
  const { t, lang } = useLanguage();
  const reduce = useReducedMotion();

  const scrollRef = useRef<HTMLDivElement | null>(null);

  // ── Зүүн баганын өргөн ────────────────────────────────────────────
  // Хэрэглэгч Excel шиг хилээс нь чирж өөрчилнө; хадгалагдана.  Гараар
  // тохируулсан бол дэлгэцийн breakpoint дарж бичихгүй — эс бөгөөс утсаа
  // хэвтээ болгоход хэрэглэгчийн сонголт чимээгүй алга болно.
  const [nameWidth, setNameWidth] = useState<number>(() => storedNameWidth() ?? defaultNameWidth());
  const customWidthRef = useRef(storedNameWidth() !== null);
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 640px)');
    const apply = () => {
      if (customWidthRef.current) return;
      setNameWidth(mq.matches ? NAME_WIDTH_WIDE : NAME_WIDTH_NARROW);
    };
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, []);

  // ── Тэнхлэгийн хүрээ + геометр ────────────────────────────────────
  const range = useMemo(() => buildRange(projects, today), [projects, today]);
  const origin = range.origin;
  const totalDays = Math.max(1, range.totalDays);
  const chartWidth = totalDays * pxPerDay;
  const ticks = useMemo(
    () => buildTicks(origin, totalDays, pxPerDay, lang),
    [origin, totalDays, pxPerDay, lang],
  );
  const bands = useMemo(
    () => buildBands(origin, totalDays, pxPerDay, lang),
    [origin, totalDays, pxPerDay, lang],
  );
  const weekends = useMemo(
    () => buildWeekendSpans(origin, totalDays, pxPerDay),
    [origin, totalDays, pxPerDay],
  );
  const todayX = xForDate(today, origin, pxPerDay);
  const todayVisible = todayX >= 0 && todayX <= chartWidth;

  // ── Гүйлгэлт ──────────────────────────────────────────────────────
  const scrollToX = useCallback(
    (x: number, smooth: boolean) => {
      const el = scrollRef.current;
      if (!el) return;
      // Зорилтот өдрийг харагдах хэсгийн ГОЛД тавина.
      const left = Math.max(0, x + nameWidth - el.clientWidth / 2);
      el.scrollTo({ left, behavior: smooth && !reduce ? 'smooth' : 'auto' });
    },
    [nameWidth, reduce],
  );

  // Анхны render — өнөөдрийг голлуулна (гулсалтгүй).
  const initedRef = useRef(false);
  useEffect(() => {
    if (initedRef.current || projects.length === 0) return;
    initedRef.current = true;
    scrollToX(todayX, false);
  }, [projects.length, scrollToX, todayX]);

  // «Өнөөдөр» товч — хуудас `scrollToTodayToken`-ыг нэмэгдүүлнэ.
  const tokenRef = useRef(scrollToTodayToken);
  useEffect(() => {
    if (tokenRef.current === scrollToTodayToken) return;
    tokenRef.current = scrollToTodayToken;
    scrollToX(todayX, true);
  }, [scrollToTodayToken, scrollToX, todayX]);

  // «Анхаарах» жагсаалтаас мөр сонгоход — босоо + хэвтээ хоёуланг нь.
  useEffect(() => {
    if (focusProjectId == null) return;
    const el = scrollRef.current;
    const row = el?.querySelector<HTMLElement>(`[data-project-id="${focusProjectId}"]`);
    if (!el || !row) return;
    const p = projects.find((x) => x.id === focusProjectId);
    const geo =
      p && p.risk_state !== 'unscheduled'
        ? barGeometry(p.start_date, p.finish_date, origin, pxPerDay)
        : null;
    const x = geo ? geo.left : todayX;
    // `offsetTop` нь эцэг элементээс хамаарах тул rect-ийн зөрүүгээр бодно.
    const rowTop = row.getBoundingClientRect().top - el.getBoundingClientRect().top + el.scrollTop;
    el.scrollTo({
      left: Math.max(0, x + nameWidth - el.clientWidth / 2),
      top: Math.max(0, rowTop - el.clientHeight / 2 + row.offsetHeight / 2),
      behavior: reduce ? 'auto' : 'smooth',
    });
    // ЗӨВХӨН фокус солигдох үед ажиллана — томруулалт өөрчлөгдөх болгонд
    // мөр рүү үсрэх нь ctrl+дугуйны бэхэлгээтэй зөрчилдөнө.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusProjectId]);

  // ── Ctrl/⌘ + дугуй = томруулалт, хулганы доорх өдрийг барина ───────
  //
  // `onWheel` React prop нь PASSIVE-аар бүртгэгддэг тул түүн доторх
  // `preventDefault()` нь ҮЛ ТООГДОНО (браузер бүхэл хуудсыг томруулна).
  // Иймд гараар, `{ passive: false }`-ээр бүртгэнэ.
  const pxRef = useRef(pxPerDay);
  const nameWidthRef = useRef(nameWidth);
  const zoomCbRef = useRef(onPxPerDayChange);
  // Сонсогч НЭГ УДАА бүртгэгддэг (дугуйны хариу бүрд дахин холбовол
  // хэрэглэгчийн эргэлтийн дунд эвдэрч болзошгүй) тул хамгийн сүүлийн
  // утгуудыг ref-ээр дамжуулна. Будалтын ӨМНӨ шинэчлэгдэх ёстой —
  // хэрэглэгчийн үйлдэл хуучин утга уншиж болохгүй.
  useLayoutEffect(() => {
    pxRef.current = pxPerDay;
    nameWidthRef.current = nameWidth;
    zoomCbRef.current = onPxPerDayChange;
  });

  /** Дараагийн layout-д сэргээх бэхэлгээ: хулганы доорх ӨДӨР + курсорын x. */
  const anchorRef = useRef<{ day: number; cursorX: number } | null>(null);
  /** Гүйлгэлтийн сүүлийн утга — зөвхөн layout-ийн ӨМНӨХ төлөвийг барихад
   *  хэрэгтэй (өргөн багасахад браузер `scrollLeft`-ийг чимээгүй хумина). */
  const scrollLeftRef = useRef(0);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const onWheel = (e: WheelEvent) => {
      // Ердийн гүйлгэлтийг ХЭЗЭЭ Ч барихгүй — зөвхөн ctrl/⌘ дарсан үед.
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();

      const current = pxRef.current;
      const next = clampPxPerDay(current * Math.exp(-e.deltaY * ZOOM_WHEEL_FACTOR));
      if (next === current) return;

      const cursorX = e.clientX - el.getBoundingClientRect().left;
      anchorRef.current = {
        day: (el.scrollLeft + cursorX - nameWidthRef.current) / current,
        cursorX,
      };
      zoomCbRef.current(next);
    };

    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  // Томруулалт солигдсоны ДАРАА, будалтын ӨМНӨ гүйлгэлтийг сэргээнэ.
  // Үүнгүйгээр чарт үсэрч, томруулалт эвдэрсэн мэт мэдрэгдэнэ — энэ бол
  // энэ бүрэлдэхүүний хамгийн эмзэг хэсэг.
  const prevPxRef = useRef(pxPerDay);
  useLayoutEffect(() => {
    const el = scrollRef.current;
    const prev = prevPxRef.current;
    prevPxRef.current = pxPerDay;
    if (!el || prev === pxPerDay) return;

    const anchor = anchorRef.current;
    anchorRef.current = null;
    // Товчлуураар (preset / −+) томруулсан үед бэхэлгээ байхгүй — тэр үед
    // харагдах хэсгийн ТӨВД байгаа өдрийг барина.
    const cursorX = anchor
      ? anchor.cursorX
      : nameWidthRef.current + (el.clientWidth - nameWidthRef.current) / 2;
    const day = anchor
      ? anchor.day
      : (scrollLeftRef.current + cursorX - nameWidthRef.current) / prev;

    el.scrollLeft = Math.max(0, day * pxPerDay + nameWidthRef.current - cursorX);
    scrollLeftRef.current = el.scrollLeft;
  }, [pxPerDay]);

  // ── Баганын өргөн чирэх (Excel маягийн) ───────────────────────────
  // Бариул нь тэнхлэгийн нэрийн нүдний баруун ирмэг дээр (TimeAxis-д
  // `resizeHandle`-аар өгнө).  Pointer capture тул хулгана чартаас гарсан ч
  // чирэлт үргэлжилнэ.  `stopPropagation` нь ЗААВАЛ — эс бөгөөс доорх
  // `onPointerDown` (чирж хөдөлгөх) мөн зэрэг ажиллаж, багана өргөсөхийн
  // хажуугаар чарт хажуу тийш гүйнэ.
  const resizeRef = useRef<{ pointerId: number; startX: number; startWidth: number } | null>(null);
  const [resizing, setResizing] = useState(false);

  const onResizeDown = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    resizeRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startWidth: nameWidthRef.current,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
    setResizing(true);
  }, []);

  const onResizeMove = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    const st = resizeRef.current;
    if (!st || st.pointerId !== e.pointerId) return;
    e.stopPropagation();
    setNameWidth(clampNameWidth(st.startWidth + (e.clientX - st.startX)));
  }, []);

  const endResize = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    const st = resizeRef.current;
    if (!st || st.pointerId !== e.pointerId) return;
    e.stopPropagation();
    resizeRef.current = null;
    setResizing(false);
    // Хөдөлгөөнгүй товшилтыг «тохируулга» гэж үзэхгүй — эс бөгөөс бариул
    // дээр санамсаргүй дарахад одоогийн өргөн түгжигдэж, дэлгэцийн хэмжээ
    // солигдоход дасан зохицохоо болино.
    if (nameWidthRef.current === st.startWidth) return;
    customWidthRef.current = true;
    try {
      localStorage.setItem(NAME_WIDTH_KEY, String(nameWidthRef.current));
    } catch {
      // private горимд бичиж чадахгүй — өргөн нь энэ сессид ажиллаад л болно.
    }
  }, []);

  /** Хоёр товшилт → анхдагч өргөн (Excel-ийн «auto fit»-ийн энгийн хувилбар). */
  const onResizeReset = useCallback((e: ReactMouseEvent<HTMLDivElement>) => {
    e.stopPropagation();
    customWidthRef.current = false;
    setNameWidth(defaultNameWidth());
    try {
      localStorage.removeItem(NAME_WIDTH_KEY);
    } catch {
      /* хамаагүй */
    }
  }, []);

  // ── Чирж хөдөлгөх ─────────────────────────────────────────────────
  const panRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    scrollLeft: number;
    scrollTop: number;
    active: boolean;
  } | null>(null);
  const [panning, setPanning] = useState(false);
  /** Жинхэнэ чирэлтийн дараах `click`-ийг залгина (мөр нээгдэх ёсгүй). */
  const suppressClickRef = useRef(false);

  const onPointerDown = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    // Өмнөх чирэлтийн дараа `click` ҮҮСЭЭГҮЙ байж болно (pointer capture-ийн
    // улмаас). Тэр үед туг үлдэж, ДАРААГИЙН хууль ёсны товшилтыг залгих
    // байсан — шинэ харилцан үйлдэл эхлэх бүрд цэвэрлэнэ.
    suppressClickRef.current = false;
    // Мэдрэгчтэй дэлгэц дээр браузерын өөрийн гүйлгэлт аль хэдийн ажиллана —
    // түүнтэй зэрэгцэн гүйлгэвэл хоёр дахин хурдан хөдөлнө.
    if (e.pointerType === 'touch' || e.button !== 0) return;
    if ((e.target as HTMLElement).closest(INTERACTIVE_SELECTOR)) return;
    const el = scrollRef.current;
    if (!el) return;
    panRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      scrollLeft: el.scrollLeft,
      scrollTop: el.scrollTop,
      active: false,
    };
  }, []);

  const onPointerMove = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    const pan = panRef.current;
    const el = scrollRef.current;
    if (!pan || !el || pan.pointerId !== e.pointerId) return;

    const dx = e.clientX - pan.startX;
    const dy = e.clientY - pan.startY;
    if (!pan.active) {
      if (Math.abs(dx) < DRAG_THRESHOLD && Math.abs(dy) < DRAG_THRESHOLD) return;
      pan.active = true;
      setPanning(true);
      el.setPointerCapture(e.pointerId);
      // Босго давахаас өмнө эхэлсэн текст сонголтыг цуцална — эс бөгөөс
      // чирэлт бүр төслийн нэрсийг цэнхэрээр будна.
      window.getSelection()?.removeAllRanges();
    }
    el.scrollLeft = pan.scrollLeft - dx;
    el.scrollTop = pan.scrollTop - dy;
  }, []);

  const endPan = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    const pan = panRef.current;
    if (!pan || pan.pointerId !== e.pointerId) return;
    panRef.current = null;
    const el = scrollRef.current;
    if (el?.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
    if (!pan.active) return;
    suppressClickRef.current = true;
    setPanning(false);
  }, []);

  const onClickCapture = useCallback((e: ReactMouseEvent<HTMLDivElement>) => {
    if (!suppressClickRef.current) return;
    suppressClickRef.current = false;
    e.preventDefault();
    e.stopPropagation();
  }, []);

  return (
    <div className="space-y-1.5">
      <div
        ref={scrollRef}
        onScroll={(e) => {
          scrollLeftRef.current = e.currentTarget.scrollLeft;
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endPan}
        onPointerCancel={endPan}
        onClickCapture={onClickCapture}
        className={cn(
          'relative max-h-[70vh] min-h-[220px] overflow-auto overscroll-x-contain rounded-lg border border-border bg-card',
          // Зөвхөн ЧИРЭХ ҮЕД курсорыг солино. Тайван үед `cursor-grab`
          // тавибал дотор нь байгаа товч/холбоос бүр «атгах» курсортой
          // болж, тэдний өөрсдийн үзүүлбэрийг дарна.
          panning && 'cursor-grabbing select-none',
          // Өргөн чирэх үед курсор бүх талбайд «баганын хил» хэвээр байна —
          // бариулаас гарсан ч чирэлт үргэлжилдэг (pointer capture).
          resizing && 'cursor-col-resize select-none',
        )}
      >
        <div className="relative w-max min-w-full">
          {/* `nameHeader` нь баганын НЭР, төслийн ТОО биш: тоог toolbar аль
              хэдийн хэлж байгаа тул энд давтвал «24 төсөл» гэсэн бичиг хажуу
              хажуугаа хоёр удаа гарна. */}
          <TimeAxis
            ticks={ticks}
            bands={bands}
            weekends={weekends}
            chartWidth={chartWidth}
            nameWidth={nameWidth}
            todayX={todayX}
            nameHeader={t('timelinePage.columnProject')}
            resizeHandle={
              <div
                data-resize-handle
                role="separator"
                aria-orientation="vertical"
                aria-label={t('timelinePage.resizeColumn')}
                title={t('timelinePage.resizeColumn')}
                onPointerDown={onResizeDown}
                onPointerMove={onResizeMove}
                onPointerUp={endResize}
                onPointerCancel={endResize}
                onDoubleClick={onResizeReset}
                // Хилийн ЯГ дээр биш, 3px гадагш нь давуулж байрлуулав —
                // 1px-ийн хүрээ рүү оносон товшилт хэрэглэгчээс хэт их
                // нарийвчлал шаарддаг.  Идэвхгүй үедээ үл үзэгдэнэ.
                className={cn(
                  'absolute inset-y-0 -right-1 z-50 w-2 cursor-col-resize touch-none',
                  'after:absolute after:inset-y-1 after:left-1/2 after:w-0.5 after:-translate-x-1/2',
                  'after:rounded-full after:transition-colors hover:after:bg-primary/60',
                  resizing && 'after:bg-primary',
                )}
              />
            }
          />

          <div className="relative">
            {/* Торны давхарга — баараас ДООР (z-0): амралтын өдрийн багана,
                `major` хилийн шугам, «өнөөдөр». Амралтын багана нь тэнхлэгийн
                тэмдэглэгээний мөрөөс эхлэн доош ТАСРАЛТГҮЙ уншигдана. */}
            <div
              aria-hidden
              className="pointer-events-none absolute inset-y-0 z-0"
              style={{ left: nameWidth, width: chartWidth }}
            >
              {weekends.map((span) => (
                <span
                  key={`we-${span.x}`}
                  className="absolute inset-y-0 bg-muted/40"
                  style={{ left: span.x, width: span.width }}
                />
              ))}
              {ticks.map((tick) =>
                !tick.major ? null : (
                  <span
                    key={tick.iso}
                    className="absolute inset-y-0 w-px bg-border/50"
                    style={{ left: tick.x }}
                  />
                ),
              )}
              {/* «Өнөөдөр» — торноос дээр, DOM дараалалаар. Толгойн чип нь
                  `TimeAxis`-д (наалт мөрөнд) байна. */}
              {todayVisible && (
                <span
                  className="absolute inset-y-0 w-0.5 -translate-x-1/2 bg-danger"
                  style={{ left: todayX }}
                />
              )}
            </div>

            {projects.length === 0 ? (
              <div className="sticky left-0 px-4 py-12 text-center" style={{ width: nameWidth }}>
                <span className="text-body text-muted-foreground">
                  {t('timelinePage.noMatches')}
                </span>
              </div>
            ) : (
              projects.map((p) => (
                <GanttRow
                  key={p.id}
                  project={p}
                  canEdit={canEdit}
                  points={deadlinePoints?.get(p.id)}
                  origin={origin}
                  pxPerDay={pxPerDay}
                  chartWidth={chartWidth}
                  nameWidth={nameWidth}
                  focused={focusProjectId === p.id}
                  onOpenProject={onOpenProject}
                  onOpenDetails={onOpenDetails}
                  onSchedule={onSchedule}
                  onNudge={onNudge}
                  onTogglePending={onTogglePending}
                />
              ))
            )}
          </div>
        </div>
      </div>

      {/* Ctrl+дугуй нь бусад газар байдаггүй тул өөрөө олдохгүй — хэлж өгнө. */}
      <p className="text-micro hidden text-muted-foreground sm:block">
        {t('timelinePage.zoomHint')}
      </p>
      {/* Гар утсан дээр хуанли хэвтээгээр гүйнэ — үүнийг хэлж өгнө. */}
      <p className="text-micro text-muted-foreground sm:hidden">
        {t('timelinePage.mobileChartHint')}
      </p>
    </div>
  );
}

export default GanttChart;
