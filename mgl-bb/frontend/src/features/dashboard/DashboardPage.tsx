import { useEffect, useMemo, useState } from 'react';
import { useReducedMotion } from 'motion/react';
import { useAuth } from '@/shared/context/AuthContext';
import { apiFetch, MEDIA_BASE_URL } from '@/shared/api/client';
import { useApiQuery } from '@/shared/api/useApi';
import type {
  DashboardOverview,
  CalendarEvent,
  CalendarPriority,
  ProjectWithProgress,
} from '@/shared/types';
import { Link } from 'react-router-dom';
import { cn } from '@/shared/lib/utils';
import { roleLabelKey } from '@/shared/lib/roles';
import { useLanguage } from '@/shared/i18n';
import type { TranslationKey, TParams } from '@/shared/i18n';
import { formatDisplayName } from '@/shared/lib/formatting';
import { Button } from '@/ui/button';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  CheckSquare,
  ChevronLeft,
  ChevronRight,
  Clock as ClockIcon,
  FolderKanban,
  ListCheck,
  Megaphone,
  Moon,
  Pause,
  Play,
  Sun,
  Sunrise,
  Sunset,
} from 'lucide-react';
import AttendanceWidget from '@/features/attendance/components/AttendanceWidget';
import { DashboardDeadlinesCard } from '@/features/deadlines/DashboardDeadlinesCard';
import { DeadlineStrip } from '@/features/deadlines/DeadlineStrip';
import { PendingRulesBanner } from '@/features/internal-rules/components/PendingRulesBanner';
import { PendingAnnouncementsBanner } from '@/features/announcements/components/PendingAnnouncementsBanner';
import { PendingDocSignBanner } from '@/features/projects/drive/signing/PendingDocSignBanner';
import DailyScoreChart from '@/features/leaderboard/components/DailyScoreChart';
import GoogleCalendarEmbed from './GoogleCalendarEmbed';
import ManageCalendarEventsDialog from './ManageCalendarEventsDialog';
import { CardContent, CardHeader, CardTitle } from '@/ui/card';
import { AppleCard } from '@/ui/apple-card';
import LightRays from '@/shared/components/LightRays';
import { Progress } from '@/ui/progress';
import { Badge } from '@/ui/badge';
import { teamChipClass } from '@/shared/lib/team-colors';
import { roleBadgeTone } from '@/shared/lib/status-colors';
import { Avatar, AvatarImage, AvatarFallback } from '@/ui/avatar';
import { formatDate, todayUB } from '@/shared/lib/time';
import { toast } from '@/shared/components/Toast';
import { ErrorState } from '@/shared/components/ErrorState';
import TaskTimerControl from '@/features/task-timer/TaskTimerControl';
import { useOfficialTimer } from '@/features/task-timer/useOfficialTimer';

/**
 * Mongolia (Ulaanbaatar) is UTC+8 year-round (no DST).  We compute the
 * Mongolian hour from the user's clock so the dashboard gradient + greeting
 * match the actual time-of-day in UB regardless of where the user is.
 */
function getUlaanbaatarHour(): number {
  // Ask Intl for the UB hour directly rather than doing offset arithmetic off
  // `getTimezoneOffset()`: that offset is sampled at the *current* instant and
  // was then applied to a *shifted* instant, which drifts by an hour around the
  // viewer's own DST transitions.  Same approach as `nowTimeUB()` in shared/lib/time.
  const hour = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Ulaanbaatar',
    hour: '2-digit',
    hour12: false,
  }).format(new Date());
  return Number(hour) % 24; // en-GB renders midnight as "24"
}

type TimeOfDay = 'dawn' | 'morning' | 'day' | 'evening' | 'night';

function getTimeOfDay(): TimeOfDay {
  const h = getUlaanbaatarHour();
  if (h >= 5 && h < 8) return 'dawn';
  if (h >= 8 && h < 12) return 'morning';
  if (h >= 12 && h < 17) return 'day';
  if (h >= 17 && h < 20) return 'evening';
  return 'night';
}

/** Per-time-of-day visual & copy palette for the welcome hero card.
 *  Picks a card gradient + accent strip that visually reads as
 *  sunrise / midday / sunset / night and pairs it with a Mongolian
 *  greeting that matches the bucket. */
const TIME_PALETTE: Record<
  TimeOfDay,
  {
    greetingKey: TranslationKey; // i18n key for the time-of-day greeting
    card: string; // background gradient on the Card itself
    strip: string; // thin accent strip at the top
    iconBg: string; // small chip behind the time icon
    icon: typeof Sun;
    rays: string; // hex tint for the LightRays hero backdrop
  }
> = {
  dawn: {
    greetingKey: 'dashboardPage.greetingMorning',
    card: 'bg-gradient-to-br from-rose-100 via-orange-50 to-amber-50 dark:from-rose-950/60 dark:via-orange-900/40 dark:to-amber-800/30',
    strip: 'bg-gradient-to-r from-rose-400 via-orange-400 to-amber-300',
    iconBg: 'bg-orange-500/15 text-orange-700 dark:bg-orange-500/20 dark:text-orange-200',
    icon: Sunrise,
    rays: '#ff9e64',
  },
  morning: {
    greetingKey: 'dashboardPage.greetingMorning',
    card: 'bg-gradient-to-br from-sky-100 via-cyan-50 to-amber-50 dark:from-sky-950/60 dark:via-cyan-900/40 dark:to-amber-700/20',
    strip: 'bg-gradient-to-r from-sky-400 via-cyan-300 to-amber-200',
    iconBg: 'bg-amber-400/20 text-amber-700 dark:text-amber-200',
    icon: Sun,
    rays: '#7dd3fc',
  },
  day: {
    greetingKey: 'dashboardPage.greetingDay',
    card: 'bg-gradient-to-br from-sky-100 via-blue-50 to-indigo-50 dark:from-sky-900/60 dark:via-blue-900/40 dark:to-indigo-900/30',
    strip: 'bg-gradient-to-r from-sky-400 via-blue-400 to-indigo-300',
    iconBg: 'bg-sky-400/25 text-sky-700 dark:text-sky-100',
    icon: Sun,
    rays: '#60a5fa',
  },
  evening: {
    greetingKey: 'dashboardPage.greetingEvening',
    card: 'bg-gradient-to-br from-fuchsia-100 via-orange-50 to-amber-50 dark:from-fuchsia-950/60 dark:via-orange-900/40 dark:to-amber-900/30',
    strip: 'bg-gradient-to-r from-fuchsia-500 via-rose-400 to-amber-300',
    iconBg: 'bg-rose-500/20 text-rose-700 dark:bg-rose-500/25 dark:text-rose-100',
    icon: Sunset,
    rays: '#f0a6ff',
  },
  night: {
    greetingKey: 'dashboardPage.greetingEvening',
    card: 'bg-gradient-to-br from-slate-200 via-indigo-100 to-violet-100 dark:from-slate-950 dark:via-slate-900 dark:to-indigo-950/70',
    strip: 'bg-gradient-to-r from-indigo-500 via-violet-500 to-blue-500',
    iconBg: 'bg-indigo-500/20 text-indigo-700 dark:bg-indigo-500/25 dark:text-indigo-100',
    icon: Moon,
    rays: '#a78bfa',
  },
};

/** The Ulaanbaatar business day — the same day attendance, my-tasks and the
 *  calendar are keyed to.  Deliberately NOT the browser's local date, which
 *  names a different day for anyone outside UB. */
function formatToday() {
  return todayUB();
}

export default function DashboardPage() {
  const { user } = useAuth();
  const { t } = useLanguage();
  // Клиент дүр өөрийн shell-тэй (`ClientDashboardPage`) тул энд ирэх ёсгүй —
  // гэхдээ хугацааны карт нь дотоод мэдээлэл учир давхар хамгаалалт үлдээв.
  const isClient = user?.role === 'client';

  const overviewQuery = useApiQuery<DashboardOverview>('/dashboard/overview');
  const overview = overviewQuery.data ?? null;
  const loadingOverview = overviewQuery.isPending;

  const todayQuery = useApiQuery<{ events: CalendarEvent[] }>('/calendar/today');
  // Keep the raw (possibly undefined) arrays — React Query hands back the
  // SAME reference until a refetch lands, whereas a `?? []` fallback here
  // would mint a fresh array every render and permanently bust the
  // `headlineEvents` memo below.  The defaulting happens inside the memo.
  const todayEvents = todayQuery.data?.events;

  // 90-day window — captured once on mount so the cache key is stable
  // across re-renders (otherwise every render computes a new ISO string
  // and busts the cache).  Anchored on the UB day, not the browser's, so
  // the window still *starts* today for a viewer outside Mongolia.
  const upcomingRange = useMemo(() => {
    const from = todayUB();
    const future = new Date(`${from}T00:00:00Z`);
    future.setUTCDate(future.getUTCDate() + 90);
    return { from, to: future.toISOString().slice(0, 10) };
  }, []);
  const upcomingQuery = useApiQuery<{ events: CalendarEvent[] }>(
    ['/calendar/events', upcomingRange.from, upcomingRange.to],
    `/calendar/events?from=${upcomingRange.from}&to=${upcomingRange.to}`,
  );
  const upcomingEvents = upcomingQuery.data?.events;
  // Only an INITIAL load failure blanks the hero — TanStack keeps the last good
  // `data` across a failed refetch — but that's exactly when the user has no
  // announcements on screen and no reason to suspect any exist.
  const eventsFailed =
    (todayQuery.isError && !todayEvents) || (upcomingQuery.isError && !upcomingEvents);

  const displayName = formatDisplayName(user?.full_name);
  const initials = displayName ? displayName.substring(0, 2).toUpperCase() : '??';
  const avatarSrc = user?.profile_image ? `${MEDIA_BASE_URL}${user.profile_image}` : undefined;

  // Headline carousel — instead of pinning a single "most important"
  // event, we surface ALL today + soonest upcoming events in priority
  // order and rotate through them inside the welcome card so the user
  // never misses the rest while still seeing one at a time.  Same
  // priority-then-date sort as before; today-unack first, then future,
  // then acknowledged today items as a calm fallback at the tail.
  const headlineEvents = useMemo<CalendarEvent[]>(() => {
    const todayIso = todayUB();
    const PRIORITY_RANK: Record<CalendarPriority, number> = { urgent: 0, high: 1, normal: 2 };

    // Union both feeds (deduped by id) BEFORE deciding what "today" means.
    // `/calendar/today` selects its rows by the *UTC* day — see `todayIso()` in
    // backend/src/routes/calendar.ts — so between 00:00 and 08:00 Ulaanbaatar it
    // returns yesterday's announcements and omits today's entirely.  The 90-day
    // window starts at the UB day and therefore does carry them, and both
    // endpoints return the same `acknowledged` flag, so re-deriving the day here
    // makes the hero correct no matter which feed an event arrived on.
    // Today's feed is inserted first so its fresher ack state wins on overlap.
    const byId = new Map<number, CalendarEvent>();
    for (const e of todayEvents ?? []) byId.set(e.id, e);
    for (const e of upcomingEvents ?? []) if (!byId.has(e.id)) byId.set(e.id, e);
    const all = [...byId.values()];

    const byPriority = (a: CalendarEvent, b: CalendarEvent) =>
      PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];

    const todayUnack = all
      .filter((e) => e.event_date === todayIso && !e.acknowledged)
      .sort(byPriority);
    const todayAcked = all
      .filter((e) => e.event_date === todayIso && e.acknowledged)
      .sort(byPriority);
    // Same-date events arrive in the backend's `ORDER BY e.priority DESC`, which
    // is a LEXICOGRAPHIC sort on a TEXT column — 'urgent' > 'normal' > 'high' —
    // so without this tiebreak a `high` notice trails a routine `normal` one.
    const future = all
      .filter((e) => e.event_date > todayIso)
      .sort((a, b) => a.event_date.localeCompare(b.event_date) || byPriority(a, b));

    // Past-dated rows (what the stale UTC day yields) are dropped: they can no
    // longer be acknowledged and would render stamped with a bygone date.
    return [...todayUnack, ...future, ...todayAcked];
  }, [todayEvents, upcomingEvents]);

  // Time-of-day theming for the hero — recomputed every minute so the
  // gradient + greeting stay accurate even if the user keeps the tab
  // open across the dawn/morning/day/evening/night boundaries.
  const [timeOfDay, setTimeOfDay] = useState<TimeOfDay>(() => getTimeOfDay());
  useEffect(() => {
    const timer = setInterval(() => setTimeOfDay(getTimeOfDay()), 60_000);
    return () => clearInterval(timer);
  }, []);
  const palette = TIME_PALETTE[timeOfDay];
  const TimeIcon = palette.icon;

  const ackEvent = async (id: number) => {
    try {
      await apiFetch(`/calendar/events/${id}/ack`, { data: {} });
      // BOTH feeds have to be refetched, not just today's: during the UB/UTC
      // skew window a genuinely-today event is only present in the upcoming
      // window, and refreshing today's feed alone would leave the acked row's
      // stale `acknowledged: 0` in place so the chip never flips to «Уншсан».
      void todayQuery.refetch();
      void upcomingQuery.refetch();
    } catch (e) {
      console.error(e);
      toast.error(t('common.error'));
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      {/* `sec-dashboard-*` id-нууд нь глобал хайлтын гүн холбоосын бай
          (`?section=<id>`) — `shared/lib/search/sections.ts`-тэй ижил байлгана. */}
      {/* ═════════════════════════════════════════════════════════════════
          ТОЛГОЙ — мэндчилгээний hero (аватар · нэр · role · @хэрэглэгч) ба
          өнөөдрийн зарын карусель.  Хуудасны ХАМГИЙН ДЭЭД мөр (2026-08-12,
          эзний шийдвэрээр хөлнөөс буцаан авчирсан).
          ⚠️ Урьд нь энэ нь хөлд байсан шалтгаан нь хүчинтэй хэвээр: hero нь
          өндөр (LightRays + 6-8 padding) тул доорх ажлын картуудыг (оноо ·
          хуанли · даалгавар · ирц · хугацаанууд) дэлгэцээс доош түлхэнэ.
          Өндрийг нэмэх ямар ч өөрчлөлт тэр зардлыг ГҮНЗГИЙРҮҮЛНЭ.
          ⚠️ Доторх `HeadlineEventCarousel` нь өнөөдрийн зарыг «уншсан»
          болгох ЦОРЫН ГАНЦ гарц (`ackEvent`) — устгаж болохгүй.
          ═════════════════════════════════════════════════════════════════ */}
      <AppleCard
        id="sec-dashboard-hero"
        className={cn(
          'relative overflow-hidden gap-0 border-border py-0 transition-colors duration-700 scroll-mt-24',
          palette.card,
        )}
      >
        {/* Time-of-day accent strip pinned to the very top edge. */}
        <div className={cn('relative z-20 h-1 transition-colors duration-700', palette.strip)} />

        {/* Atmosphere — volumetric WebGL light rays cast from the top.  The
            rays use a saturated time-of-day colour (`palette.rays`), so normal
            alpha-compositing keeps them visible — and animated — in BOTH light
            and dark mode (no longer gated to dark). */}
        <div className="pointer-events-none absolute inset-0 z-0">
          <LightRays
            raysOrigin="top-center"
            raysColor={palette.rays}
            raysSpeed={1.1}
            lightSpread={0.85}
            rayLength={1.4}
            fadeDistance={1.2}
            followMouse
            mouseInfluence={0.12}
            noiseAmount={0.06}
            distortion={0.04}
          />
        </div>
        {/* Soft radial bloom tinted to the time-of-day ray colour — visible in
            both light and dark, so the hero keeps its "light source" in light mode. */}
        <div
          className="pointer-events-none absolute inset-x-0 -top-10 z-0 h-48"
          style={{
            background: `radial-gradient(ellipse 55% 100% at 50% 0%, ${palette.rays}33, transparent 70%)`,
          }}
        />
        {/* Fine film grain — a hint of premium texture in both themes. */}
        <div
          className="pointer-events-none absolute inset-0 z-0 opacity-[0.12] mix-blend-overlay"
          style={{
            backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='140' height='140'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")`,
          }}
        />

        <CardContent className="relative z-10 p-6 md:p-8">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
            {/* ── Greeting block ── */}
            <div className="flex min-w-0 items-center gap-4 md:gap-5">
              <div className="relative shrink-0">
                <Avatar className="h-16 w-16 shadow-lg shadow-black/20 ring-2 ring-foreground/10">
                  {avatarSrc && <AvatarImage src={avatarSrc} alt={displayName} />}
                  <AvatarFallback className="bg-primary/20 text-primary text-xl font-bold">
                    {initials}
                  </AvatarFallback>
                </Avatar>
                <span className="absolute -bottom-0.5 -right-0.5 h-4 w-4 rounded-full border-2 border-background bg-emerald-500" />
              </div>

              <div className="min-w-0">
                {/* eyebrow pill — live status + today's date */}
                <div className="mb-2 inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground backdrop-blur-sm">
                  <span className="relative flex h-1.5 w-1.5">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400/70" />
                    <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-400" />
                  </span>
                  {formatToday()}
                </div>

                {/* greeting prefix */}
                <p className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                  <span
                    className={cn(
                      'inline-flex h-5 w-5 items-center justify-center rounded-md',
                      palette.iconBg,
                    )}
                  >
                    <TimeIcon className="h-3 w-3" />
                  </span>
                  {t(palette.greetingKey)},
                </p>

                {/* name — oversized, tight, gradient-clipped */}
                <h1 className="mt-0.5 flex flex-wrap items-baseline gap-x-3 text-2xl font-bold leading-[1.05] tracking-tight md:text-3xl lg:text-[2.5rem]">
                  <span className=" from-foreground via-foreground to-violet-400 bg-clip-text text-transparent">
                    {displayName}
                  </span>
                  <span className="text-2xl md:text-3xl" aria-hidden>
                    👋
                  </span>
                </h1>

                {/* tagline */}
                <p className="mt-1.5 max-w-md text-sm text-muted-foreground/90">
                  {t('dashboardPage.heroTagline')}
                </p>

                {/* meta row */}
                <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <Badge
                    variant="outline"
                    className={cn('font-medium capitalize', roleBadgeTone(user?.role))}
                  >
                    {t(roleLabelKey(user?.role))}
                  </Badge>
                  <span className="text-muted-foreground/40">·</span>
                  <span className="font-medium text-foreground/80">@{user?.username}</span>
                </div>
              </div>
            </div>

            {/* ── Headline event carousel — rotates through today/upcoming
                 events so each is read in turn. ── */}
            {headlineEvents.length > 0 ? (
              <div className="w-full shrink-0 lg:w-auto lg:max-w-sm">
                <HeadlineEventCarousel events={headlineEvents} onAck={(id) => ackEvent(id)} />
              </div>
            ) : eventsFailed ? (
              // A dead feed must not look like "no announcements today" — this
              // carousel is the only surface in the app where today's events
              // can be acknowledged, and a missed one can't be acked later.
              <div className="w-full shrink-0 lg:w-auto lg:max-w-sm">
                <div className="flex items-center gap-3 rounded-2xl bg-background/40 px-4 py-3 ring-1 ring-amber-500/40 backdrop-blur-sm">
                  <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-300" />
                  <p className="min-w-0 flex-1 text-xs text-muted-foreground">
                    {t('dashboardPage.eventsLoadFailed')}
                  </p>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 shrink-0 px-2 text-xs"
                    onClick={() => {
                      void todayQuery.refetch();
                      void upcomingQuery.refetch();
                    }}
                  >
                    {t('common.retry')}
                  </Button>
                </div>
              </div>
            ) : null}
          </div>
        </CardContent>
      </AppleCard>

      {/* Дотоод журам — гарын үсэг зураагүй журам байвал л зурвас (үгүй бол null).
          Hero-гийн доор, ажлын картуудын дээр: HR-ийн заавал үйлдэл тул нүдэнд
          эхэлж тусах ёстой, гэхдээ hero-гийн өндөрт нэмэгдэхгүй. */}
      {!isClient && <PendingRulesBanner />}
      {/* Нийтийн мэдээлэл — баталгаажуулаагүй (чагт/гарын үсэг) мэдээлэл байвал л. */}
      {!isClient && <PendingAnnouncementsBanner />}
      {/* Word баримтын гарын үсэг — захиралд «баталгаажуулах», ажилтанд «зурна уу». */}
      {!isClient && <PendingDocSignBanner />}

      {/* ═════════════════════════════════════════════════════════════════
          ROW 1 — SCORE + CALENDAR, split 6/6.
          The personal earnings chart sits on the left where the eye
          lands first, paired with the monthly calendar on the right.
          Both cards are the data-densest things on the page and
          benefit from being above the fold.
          ═════════════════════════════════════════════════════════════════ */}
      <div className="grid gap-4 lg:grid-cols-12 items-stretch">
        <div id="sec-dashboard-score" className="lg:col-span-6 min-h-0 scroll-mt-24">
          <DailyScoreChart />
        </div>
        <div className="flex min-h-0 flex-col gap-2 lg:col-span-6">
          {/* ManageCalendarEventsDialog renders null for non-admins, so
              this toolbar row collapses to nothing for everyone else. */}
          <div className="flex justify-end empty:hidden">
            <ManageCalendarEventsDialog
              onChanged={() => {
                void todayQuery.refetch();
                void upcomingQuery.refetch();
              }}
            />
          </div>
          {/* Хугацааны зурвас нь хуанлийн ЯГ ДЭЭР — Google-ийн embed нь
              гадаад iframe тул түүн рүү мөр нэмэх боломжгүй, оронд нь
              дээр нь тавьж «юу яаралтай вэ» → «сар ямар байна» гэсэн
              дарааллаар уншуулна.  Клиент дүр өөр shell хэрэглэдэг. */}
          {!isClient && (
            <div id="sec-dashboard-deadline-strip" className="scroll-mt-24">
              <DeadlineStrip />
            </div>
          )}
          <div id="sec-dashboard-calendar" className="min-h-0 flex-1 scroll-mt-24">
            <GoogleCalendarEmbed />
          </div>
        </div>
      </div>

      {/* ═════════════════════════════════════════════════════════════════
          ROW 2 — TASKS + PROJECTS + ATTENDANCE in three equal columns.
          This is the "what should I do right now" strip: open tasks
          first (left, where the eye lands), then active projects in
          the middle for context, then attendance on the right where
          clock-in/out is closest to thumb on most screens.
          ═════════════════════════════════════════════════════════════════ */}
      <div className="grid gap-4 lg:grid-cols-3 items-stretch">
        <ActiveTasksCard />

        <ActiveProjectsCard
          projects={overview?.active_projects ?? []}
          total={overview?.stats.active_projects}
          loading={loadingOverview}
          // `&& !overview` so a failed *background* refetch never replaces
          // rows that are already on screen with an error panel.
          error={overviewQuery.isError && !overview ? overviewQuery.error : null}
          onRetry={() => void overviewQuery.refetch()}
        />

        <div id="sec-dashboard-attendance" className="min-h-0 scroll-mt-24">
          <AttendanceWidget />
        </div>
      </div>

      {/* ═════════════════════════════════════════════════════════════════
          ROW 3 — ОЙРЫН ХУГАЦААНУУД, бүтэн өргөнтэй.
          ROW 2 нь яг гурван тэнцүү багана; дөрөв дэх картыг тэнд шахвал
          гар утсан дээр уншигдахгүй болно, тиймээс өөрийн мөрөнд гарав.
          Жагсаалт нь төслийн эцсийн хугацаа + таскийн огноо + дэд шалгах
          цэгүүдийг нэгтгэнэ (features/deadlines).  Клиент дүр өөр shell
          (`ClientDashboardPage`) хэрэглэдэг тул энд гарахгүй.
          ═════════════════════════════════════════════════════════════════ */}
      {!isClient && (
        <div id="sec-dashboard-deadlines" className="scroll-mt-24">
          <DashboardDeadlinesCard />
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ActiveTasksCard — the worker's open task list, surfaced on the
// dashboard so they don't have to navigate to /my-tasks just to see
// what's in front of them.  Sort priority (most-urgent first):
//   1. Overdue (due_date < today)
//   2. Due today
//   3. Due within 7 days
//   4. Everything else by least progress
// Show top 6 with a footer link to the full list.
// ---------------------------------------------------------------------------

interface DashTaskItem {
  id: number;
  name: string;
  weight_percent: number;
  current_progress: number;
  project_id: number;
  project_name: string;
  block_name: string;
  drawing_name: string;
  component_name: string;
  due_date: string | null;
  start_date: string | null;
  reported_today: boolean;
  /** Ажилтан өөрөө «миний хэсэг дууссан» гэж хаасан мөр (зөвхөн засварын
   *  төсөл, migration 0253).  Хувь нь 100% болоогүй ч энэ самбарт
   *  ГАРАХГҮЙ — тэр нь энэ боломжийн гол утга. */
  self_done?: boolean;
  /** 'AZ' | 'ZA' | 'ET' | 'EZ' | 'IZ' | null.  Зөвхөн 'ZA' (Засвар) дээр
   *  «дуусгасан» товч гарна — сервер тал мөн адил шалгана. */
  project_category?: string | null;
  /** Цагаар бодогддог засварын төсөл (0339) — хувь биш ажилласан цаг. */
  project_progress_mode?: 'tasks' | 'hours' | null;
  /** Зөвхөн 'hours' мөрөнд (0341) — My Tasks-тай ижил «Би N цаг». */
  repair_hours?: { mine: number; total: number } | null;
}

interface DashTaskSummary {
  total: number;
  completed: number;
  in_progress: number;
  not_started: number;
}

function dashDueMeta(
  due: string | null,
  t: (key: TranslationKey, params?: TParams) => string,
  /** UB day to measure against.  Passed in (not read from the clock here) so
   *  the per-row chips, the overdue badge and the sort order are all computed
   *  against the SAME day — otherwise a tab left open past midnight re-renders
   *  fresh chips beside a stale, memoised badge. */
  todayIso: string,
) {
  if (!due) return null;
  // Both sides must be parsed with the SAME midnight semantics.  `new Date('2026-08-18')`
  // is UTC midnight, which lands on the previous calendar day everywhere west of
  // UTC — so the 'future' chip printed a deadline one day early, and the tier
  // arithmetic only survived because Math.round happened to absorb the offset.
  const today = new Date(`${todayIso}T00:00:00`);
  const d = /^\d{4}-\d{2}-\d{2}$/.test(due) ? new Date(`${due}T00:00:00`) : new Date(due);
  const days = Math.round((d.getTime() - today.getTime()) / 86_400_000);
  if (days < 0)
    return {
      tone: 'overdue' as const,
      label: t('dashboardPage.daysOverdue', { days: -days }),
      days,
    };
  if (days === 0) return { tone: 'today' as const, label: t('dashboardPage.today'), days };
  if (days <= 7)
    return { tone: 'soon' as const, label: t('dashboardPage.daysLeft', { days }), days };
  return { tone: 'future' as const, label: formatDate(d), days };
}

// ---------------------------------------------------------------------------
// ActiveProjectsCard — slim list of active projects pinned to the left of
// the calendar.  Each row links straight into the project so users can
// jump from "what's the date" → "what's running" in one click.  Falls
// back to a friendly empty state when there's nothing active so the card
// doesn't collapse the layout.
// ---------------------------------------------------------------------------
function ActiveProjectsCard({
  projects,
  total,
  loading,
  error,
  onRetry,
}: {
  projects: ProjectWithProgress[];
  /** True active-project count. `projects` is capped at LIMIT 10 by
   *  /dashboard/overview, so its length is a page size, not a total. */
  total?: number;
  loading: boolean;
  error?: unknown;
  onRetry?: () => void;
}) {
  const { t } = useLanguage();
  return (
    <AppleCard id="sec-dashboard-projects" className="h-full scroll-mt-24">
      <CardHeader className="flex flex-row items-center justify-between pb-3 ">
        <CardTitle className="flex items-center gap-2 text-base">
          <FolderKanban className="h-4 w-4 text-brand-copper" />
          {t('dashboardPage.activeProjects')}
          {!loading && !error && (
            <Badge variant="secondary" className="h-5 px-1.5 text-[10px] tabular-nums">
              {total ?? projects.length}
            </Badge>
          )}
        </CardTitle>
        <Link
          to="/app/projects"
          className="text-xs text-brand-copper hover:underline flex items-center gap-1"
        >
          {t('dashboardPage.allLink')} <ArrowRight className="w-3.5 h-3.5" />
        </Link>
      </CardHeader>
      <CardContent className="flex-1 min-h-0 overflow-y-auto pt-0">
        {/* Error branch FIRST: without it a failed /dashboard/overview fell
            through to the empty state and told the user there were no active
            projects, when the truth was that the request never succeeded. */}
        {error ? (
          <ErrorState error={error} onRetry={onRetry} compact />
        ) : loading ? (
          <div className="space-y-2">
            {[1, 2, 3].map((i) => (
              <div key={i} className="space-y-1.5 animate-pulse">
                <div className="h-3 bg-muted rounded w-2/3" />
                <div className="h-1.5 bg-muted rounded" />
              </div>
            ))}
          </div>
        ) : projects.length === 0 ? (
          <div className="text-center py-8">
            <FolderKanban className="h-8 w-8 text-muted-foreground/40 mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">{t('dashboardPage.noActiveProjects')}</p>
          </div>
        ) : (
          <div className="space-y-2.5">
            {projects.slice(0, 8).map((project) => (
              <Link
                key={project.id}
                to={`/app/projects/${project.id}`}
                className="block rounded-2xl bg-muted/40 px-3 py-2 hover:bg-muted/70 transition-colors group"
              >
                <div className="flex items-center justify-between gap-2 mb-1.5">
                  <span className="text-sm font-medium truncate group-hover:text-brand-copper">
                    {project.name}
                  </span>
                  <span className="text-xs text-muted-foreground font-medium tabular-nums">
                    {Math.round(project.progress ?? 0)}%
                  </span>
                </div>
                <Progress value={project.progress ?? 0} className="h-1.5" />
              </Link>
            ))}
          </div>
        )}
      </CardContent>
    </AppleCard>
  );
}

function ActiveTasksCard({ className }: { className?: string }) {
  const { t } = useLanguage();
  const query = useApiQuery<{ items: DashTaskItem[]; summary: DashTaskSummary }>(
    '/progress/my-tasks',
  );
  // `null` = still loading (renders skeletons); `[]` = genuinely empty.
  // A FAILED request must NOT collapse to `[]` — that rendered the cheerful
  // "бүх даалгавар дууссан" state to someone whose overdue tasks simply
  // failed to load.  Errors get their own branch below.
  // Memoised so the derived `active` / `overdueCount` memos below aren't
  // invalidated on every render by a fresh `[]` literal.
  const { data, isError, error, refetch } = query;
  const items = useMemo<DashTaskItem[] | null>(() => (data ? (data.items ?? []) : null), [data]);
  /** Албан ёсны таскийн таймер (0361) — «Миний ажлууд»-тай ижил эх сурвалж (зөвхөн «Зогсоох»). */
  const timer = useOfficialTimer();
  const runningId = timer.running?.task_id ?? null;
  const summary: DashTaskSummary | null = data ? (data.summary ?? null) : null;

  // «Миний ажил дууссан» — ЗӨВХӨН засварын төсөл (ZA), migration 0253.
  // Хувь БИЧИХГҮЙ: төслийн явц, оноо хэвээрээ, зөвхөн энэ жагсаалтаас
  // мөр нуугдана.  Буцаах товч нь «Миний ажлууд» → «Дууссан» табд байна.
  const [closingId, setClosingId] = useState<number | null>(null);
  const closeMyPart = async (taskId: number) => {
    setClosingId(taskId);
    try {
      await apiFetch(`/progress/my-tasks/${taskId}/self-done`, { method: 'POST' });
      toast.success(t('myTasksPage.selfDoneMarked'));
      void refetch();
    } catch (err) {
      console.error(err);
      toast.error(t('common.error'), t('common.saveFailed'));
    } finally {
      setClosingId(null);
    }
  };

  // The tiers below depend on the wall clock, not only on `items`.  Without a
  // ticking day stamp, a tab left open past midnight re-rendered fresh per-row
  // chips (recomputed inline) beside a stale memoised overdue badge and sort
  // order — the card visibly contradicting itself.  Note nothing else wakes it:
  // TanStack's focusManager only listens to `visibilitychange`, so a dashboard
  // left visible overnight never refetches.
  const [dayIso, setDayIso] = useState(todayUB);
  useEffect(() => {
    const timer = setInterval(() => {
      const next = todayUB();
      setDayIso((prev) => (prev === next ? prev : next));
    }, 60_000);
    return () => clearInterval(timer);
  }, []);

  // Active = not yet at 100%.  Sorted by urgency tier (overdue → today
  // → soon → future/no-due) then by least progress so the longest-
  // outstanding work bubbles up.
  const active = useMemo(() => {
    const list = (items ?? []).filter((t) => t.current_progress < 100 && !t.self_done);
    const tierRank: Record<string, number> = { overdue: 0, today: 1, soon: 2, future: 3, none: 4 };
    return list
      .sort((a, b) => {
        const ma = dashDueMeta(a.due_date, t, dayIso);
        const mb = dashDueMeta(b.due_date, t, dayIso);
        const ra = tierRank[ma?.tone ?? 'none'];
        const rb = tierRank[mb?.tone ?? 'none'];
        if (ra !== rb) return ra - rb;
        // Within same urgency, push the LEAST-completed first so the
        // user attacks fresh work before nearly-done items.
        return a.current_progress - b.current_progress;
      })
      // Явж буй таймертай таск үргэлж хамгийн дээр (6-д багтаагүй байсан ч).
      .sort((a, b) => Number(b.id === runningId) - Number(a.id === runningId))
      .slice(0, 6);
  }, [items, t, dayIso, runningId]);

  const overdueCount = useMemo(
    () =>
      (items ?? []).filter((task) => {
        const m = dashDueMeta(task.due_date, t, dayIso);
        return task.current_progress < 100 && !task.self_done && m?.tone === 'overdue';
      }).length,
    [items, t, dayIso],
  );

  return (
    <AppleCard id="sec-dashboard-tasks" className={cn('h-full scroll-mt-24', className)}>
      <CardHeader className="flex flex-row items-center justify-between pb-3 ">
        <CardTitle className="flex items-center gap-2 text-base">
          <ListCheck className="h-4 w-4 text-brand-copper" />
          {t('dashboardPage.myTasks')}
          {summary && summary.total > 0 && (
            <Badge
              variant="outline"
              className="text-[10px] ml-1 bg-brand-copper/10 text-brand-copper border-brand-copper/30"
            >
              {t('dashboardPage.activeCount', {
                count: summary.in_progress + summary.not_started,
              })}
            </Badge>
          )}
          {overdueCount > 0 && (
            <Badge
              variant="outline"
              className="text-[10px] bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/40"
            >
              {t('dashboardPage.overdueCount', { count: overdueCount })}
            </Badge>
          )}
        </CardTitle>
        <Link
          to="/app/my-tasks"
          className="text-xs text-brand-copper hover:underline flex items-center gap-1"
        >
          {t('dashboardPage.allLink')} <ArrowRight className="w-3.5 h-3.5" />
        </Link>
      </CardHeader>
      <CardContent className="flex-1 min-h-0 overflow-y-auto pt-0">
        {/* `!data` so a failed background refetch keeps the list already on
            screen rather than swapping it for an error panel. */}
        {isError && !data ? (
          <ErrorState error={error} onRetry={() => void refetch()} compact />
        ) : items === null ? (
          <div className="space-y-2">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-12 rounded-md bg-muted/40 animate-pulse" />
            ))}
          </div>
        ) : active.length === 0 ? (
          <div className="text-center py-6 flex flex-col items-center gap-2 text-muted-foreground">
            <CheckCircle2 className="h-7 w-7 text-emerald-500/60" />
            <p className="text-sm">{t('dashboardPage.noActiveTasks')}</p>
            <p className="text-[11px]">{t('dashboardPage.noActiveTasksHint')}</p>
          </div>
        ) : (
          // `grid-cols-1` = minmax(0,1fr): урт нэр картыг хэвтээ чиглэлд тэлэхгүй, тасарна.
          <div className="grid grid-cols-1 gap-2">
            {active.map((task) => {
              const due = dashDueMeta(task.due_date, t, dayIso);
              const dueChip =
                due?.tone === 'overdue'
                  ? 'bg-danger/15 text-danger border-danger/40'
                  : due?.tone === 'today'
                    ? 'bg-warning/15 text-warning border-warning/40'
                    : due?.tone === 'soon'
                      ? 'bg-warning/10 text-warning border-warning/30'
                      : 'bg-muted/40 text-muted-foreground border-border/40';
              return (
                <Link
                  key={task.id}
                  to="/app/my-tasks"
                  className={cn(
                    'block rounded-2xl p-2.5 transition-colors space-y-1.5 group',
                    task.id === runningId
                      ? 'bg-success/10 ring-1 ring-success/40 hover:bg-success/15'
                      : 'bg-muted/40 hover:bg-muted/70',
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[10px] uppercase tracking-wider text-muted-foreground truncate flex-1">
                      {task.project_name}
                    </span>
                    {/* Албан таймер (0361) — картын баруун дээд буланд.  2026-10-01:
                        эндээс ЭХЛҮҮЛЭХГҮЙ (таскийг төслийн хуудаснаас «Өөртөө авах»),
                        явж буйг «Зогсоох», бусад нь миний нийт цаг. */}
                    <TaskTimerControl
                      timer={timer}
                      taskId={task.id}
                      taskName={task.name}
                      projectName={task.project_name}
                      canRun={false}
                      size="sm"
                    />
                    {task.project_category === 'ZA' && (
                      <button
                        type="button"
                        onClick={(e) => {
                          // Мөр бүхэлдээ <Link> тул үүнгүйгээр /app/my-tasks руу
                          // үсэрч, тэмдэглэгээ нь хуудас солигдох дунд хийгдэнэ.
                          e.preventDefault();
                          e.stopPropagation();
                          void closeMyPart(task.id);
                        }}
                        disabled={closingId === task.id}
                        title={t('myTasksPage.selfDoneActionTitle')}
                        aria-label={t('myTasksPage.selfDoneAction')}
                        className="shrink-0 inline-flex h-6 w-6 items-center justify-center rounded-md border border-success/40 text-success hover:bg-success/10 disabled:opacity-50"
                      >
                        <CheckSquare className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium truncate flex-1 group-hover:text-brand-copper">
                      {task.name}
                    </span>
                    <span className="text-xs text-muted-foreground font-semibold tabular-nums shrink-0">
                      {/* Засварын (цагаар бодогддог) таск — ХУВЬ биш ажилласан цаг,
                          My Tasks-тай ижил (2026-09-24). */}
                      {task.project_progress_mode === 'hours'
                        ? t('myTasksPage.hoursMine', { hours: task.repair_hours?.mine ?? 0 })
                        : `${task.current_progress}%`}
                    </span>
                  </div>
                  {task.project_progress_mode !== 'hours' && (
                    <Progress value={task.current_progress} className="h-1.5" />
                  )}
                  {due && (
                    <div className="flex items-center justify-between gap-2 pt-0.5">
                      <span
                        className={cn(
                          'inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded border',
                          dueChip,
                        )}
                      >
                        <ClockIcon className="w-2.5 h-2.5" />
                        {due.label}
                      </span>
                    </div>
                  )}
                </Link>
              );
            })}
          </div>
        )}
      </CardContent>
    </AppleCard>
  );
}

// ---------------------------------------------------------------------------
// HeadlineEventCarousel — rotates through every today/upcoming event,
// reusing HeadlineEventPin for the actual card.  Auto-advances every 5s —
// paused on hover, on keyboard focus, and entirely for viewers who asked for
// reduced motion — and exposes prev/next + paginator dots so the user can also
// drive it manually.  Replaces the previous "single most important event" pin
// which silently hid everything else.
// ---------------------------------------------------------------------------
function HeadlineEventCarousel({
  events,
  onAck,
}: {
  events: CalendarEvent[];
  onAck: (id: number) => void;
}) {
  const { t } = useLanguage();
  // Байрлалыг МАССИВЫН ИНДЕКСЭЭР биш, эвентийн id-гаар барина.  Уншсан гэж
  // баталгаажуулахад `headlineEvents` дахин эрэмбэлэгдэж (баталгаажсан нь
  // сүүлд шилждэг) индекс тогтмол хэвээр үлдвэл хэрэглэгчийн уншаагүй ӨӨР
  // зар гэнэт гарч ирдэг байсан — товч нь мөн байрандаа үлддэг тул дахин
  // дарахад огт уншаагүй зарыг баталгаажуулах эрсдэлтэй.  id-гаар барихад
  // жагсаалт богиносох/эрэмбэлэгдэхэд ч сонголт нааралдсан хэвээр байна.
  const [activeId, setActiveId] = useState<number | null>(() => events[0]?.id ?? null);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  // Explicit pause — hover doesn't exist on touch and focus only applies while
  // a control inside the card holds it, so neither is a usable "stop" for
  // someone simply reading on a phone (WCAG 2.2.2 wants a real mechanism).
  const [userPaused, setUserPaused] = useState(false);
  const reduceMotion = useReducedMotion();

  const found = events.findIndex((e) => e.id === activeId);
  const idx = found >= 0 ? found : 0; // устсан/шүүгдсэн эвент → эхнийх рүү
  const goTo = (next: number) => {
    const n = ((next % events.length) + events.length) % events.length;
    setActiveId(events[n]?.id ?? null);
  };

  // Auto-rotate.  Skipped for a single event, while the user is reading
  // (hover OR keyboard focus — tracked separately so a stray mouse-leave
  // can't resume rotation under a focused control), and when the viewer
  // asked for reduced motion (WCAG 2.2.2 — same signal LightRays honours).
  const rotating = events.length > 1 && !hovered && !focused && !userPaused && !reduceMotion;
  useEffect(() => {
    if (!rotating) return;
    const timer = setInterval(() => {
      // Functional updater keyed off the CURRENT list, so a refetch that
      // reorders `events` can never advance from a stale position.
      setActiveId((cur) => {
        const i = events.findIndex((e) => e.id === cur);
        return events[((i < 0 ? 0 : i) + 1) % events.length]?.id ?? null;
      });
    }, 5000);
    return () => clearInterval(timer);
  }, [rotating, events]);

  const event = events[idx];
  if (!event) return null;
  const go = (delta: number) => goTo(idx + delta);

  return (
    <div
      className="flex flex-col gap-1.5 max-w-md"
      role="group"
      aria-roledescription="carousel"
      aria-label={t('dashboardPage.announcements')}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      // Keyboard users get the same reading grace as mouse users —
      // without this the rotation yanks the focused dot out from
      // under them mid-tab.
      onFocusCapture={() => setFocused(true)}
      onBlurCapture={() => setFocused(false)}
    >
      <HeadlineEventPin event={event} onAck={onAck} />
      {events.length > 1 && (
        <div className="flex items-center justify-between gap-2 px-1">
          <button
            type="button"
            onClick={() => go(-1)}
            className="text-muted-foreground hover:text-foreground transition-colors p-0.5"
            aria-label={t('common.prev')}
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </button>
          {/* Only meaningful while something is actually rotating — hidden
              when the OS already asked for reduced motion. */}
          {!reduceMotion && (
            <button
              type="button"
              onClick={() => setUserPaused((p) => !p)}
              className="text-muted-foreground hover:text-foreground transition-colors p-0.5"
              aria-pressed={userPaused}
              aria-label={t(
                userPaused ? 'dashboardPage.resumeRotation' : 'dashboardPage.pauseRotation',
              )}
            >
              {userPaused ? <Play className="h-3 w-3" /> : <Pause className="h-3 w-3" />}
            </button>
          )}
          {/* Pagination dots — clickable, with the active dot widened
              into a pill so the user can see the position at a glance
              even without counting.  `aria-current` carries that same
              "you are here" signal to screen readers, which can't see
              the width change. */}
          <div className="flex items-center gap-1">
            {events.map((e, i) => (
              <button
                key={e.id}
                type="button"
                onClick={() => setActiveId(e.id)}
                aria-current={i === idx ? 'true' : undefined}
                aria-label={t('dashboardPage.goToEvent', { n: i + 1, total: events.length })}
                className={cn(
                  'h-1.5 rounded-full transition-all',
                  i === idx
                    ? 'w-4 bg-foreground/80'
                    : 'w-1.5 bg-foreground/20 hover:bg-foreground/40',
                )}
              />
            ))}
          </div>
          <span className="text-[10px] tabular-nums text-muted-foreground">
            {idx + 1}/{events.length}
          </span>
          <button
            type="button"
            onClick={() => go(1)}
            className="text-muted-foreground hover:text-foreground transition-colors p-0.5"
            aria-label={t('common.next')}
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// HeadlineEventPin — single event card used as the visual atom for the
// carousel above.  Owns its own priority-tone styling and ack button.
// ---------------------------------------------------------------------------
function HeadlineEventPin({ event, onAck }: { event: CalendarEvent; onAck: (id: number) => void }) {
  const { t } = useLanguage();
  // Keyed to the Ulaanbaatar business day, matching `headlineEvents`.  Using the
  // browser's local date here hid the Acknowledge button for hours every day.
  const todayIso = todayUB();
  const isToday = event.event_date === todayIso;

  const dayLabel = (() => {
    if (isToday) return t('dashboardPage.today');
    // Parse BOTH sides as local midnight.  `new Date('YYYY-MM-DD')` is UTC
    // midnight, so the previous `setHours(0,0,0,0)` snapped it back a day in any
    // negative-offset timezone and every relative label came out one day early.
    const today = new Date(`${todayIso}T00:00:00`);
    const ev = new Date(`${event.event_date}T00:00:00`);
    const diff = Math.round((ev.getTime() - today.getTime()) / 86_400_000);
    if (diff === 1) return t('dashboardPage.tomorrow');
    if (diff > 1 && diff <= 6) return t('dashboardPage.daysFromNow', { days: diff });
    // Pass the raw string so formatDate takes its guarded YYYY-MM-DD path.
    return formatDate(event.event_date);
  })();

  const TONE: Record<
    CalendarPriority,
    { ring: string; text: string; chip: string; icon: typeof AlertTriangle }
  > = {
    urgent: {
      ring: 'ring-red-500/50',
      text: 'text-red-700 dark:text-red-300',
      chip: 'bg-red-500/20 text-red-700 dark:text-red-300 border-red-500/40',
      icon: AlertTriangle,
    },
    high: {
      ring: 'ring-amber-500/50',
      text: 'text-amber-700 dark:text-amber-200',
      chip: 'bg-amber-500/20 text-amber-700 dark:text-amber-200 border-amber-500/40',
      icon: Megaphone,
    },
    normal: {
      ring: 'ring-emerald-500/50',
      text: 'text-emerald-700 dark:text-emerald-200',
      chip: 'bg-emerald-500/20 text-emerald-700 dark:text-emerald-200 border-emerald-500/40',
      icon: Megaphone,
    },
  };
  const tone = TONE[event.priority];
  const Icon = tone.icon;
  const isAcked = !!event.acknowledged;

  return (
    <div
      className={cn(
        'flex items-center gap-3.5 rounded-2xl bg-background/40 backdrop-blur-sm px-4 py-4 ring-1',
        isAcked ? 'ring-emerald-500/30' : tone.ring,
      )}
    >
      <div
        className={cn(
          'h-12 w-12 rounded-xl flex items-center justify-center shrink-0',
          isAcked
            ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400'
            : event.priority === 'urgent'
              ? 'bg-red-500/20 text-red-700 dark:text-red-300 animate-pulse'
              : event.priority === 'high'
                ? 'bg-amber-500/20 text-amber-700 dark:text-amber-300'
                : 'bg-emerald-500/20 text-emerald-700 dark:text-emerald-300',
        )}
      >
        <Icon className="h-5 w-5" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 mb-0.5">
          <span
            className={cn(
              'text-[9px] uppercase tracking-wider font-bold px-1.5 py-0.5 rounded border',
              tone.chip,
            )}
          >
            {dayLabel}
          </span>
          {/* Team-scope chips — one per targeted team.  Broadcast events
              (no teams) show none, keeping the chip row uncluttered. */}
          {event.team_codes &&
            event.team_codes.split(',').map((code) => (
              <span
                key={code}
                className={cn(
                  'text-[9px] uppercase tracking-wider font-bold px-1.5 py-0.5 rounded border',
                  teamChipClass(code),
                )}
              >
                {code}
              </span>
            ))}
          {isAcked && (
            <span className="text-[9px] uppercase tracking-wider font-bold px-1.5 py-0.5 rounded border bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 border-emerald-500/40 inline-flex items-center gap-0.5">
              <CheckCircle2 className="h-2.5 w-2.5" /> {t('dashboardPage.read')}
            </span>
          )}
        </div>
        <p className="text-base font-semibold text-foreground leading-tight truncate">
          {event.title}
        </p>
        {event.message && (
          <p className="mt-1 text-xs text-muted-foreground leading-snug line-clamp-2">
            {event.message}
          </p>
        )}
      </div>
      {!isAcked && isToday && (
        <Button
          size="sm"
          className="h-8 text-xs px-3 bg-amber-600 hover:bg-amber-700 text-white shrink-0"
          onClick={() => onAck(event.id)}
        >
          {t('dashboardPage.acknowledge')}
        </Button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// (TodayEventsFeed was removed — same data already lives in the headline
//  carousel inside the welcome hero, so the standalone "Өнөөдөр" card
//  was duplicating content without adding value.)
// ---------------------------------------------------------------------------
