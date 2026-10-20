import { useEffect, useState, useCallback, useMemo } from 'react';
import { useApiQuery } from '@/shared/api/useApi';
import { Link } from 'react-router-dom';
import { ApiError, apiFetch } from '@/shared/api/client';
import type {
  AttendanceCheckpointType,
  AttendanceProjectCheckpoint,
  RepairProjectOption,
  AttendanceSession,
  PgpPlan,
  ProjectOption,
} from '@/shared/types';
import { Card, CardContent } from '@/ui/card';
import { Button } from '@/ui/button';
import {
  Clock,
  LogIn,
  LogOut,
  Timer,
  RefreshCw,
  Wifi,
  WifiOff,
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  FolderOpen,
  Smartphone,
} from 'lucide-react';
import {
  shiftOptions,
  shiftLabel,
  afternoonAutoPromptEndsAt,
  ubMinutesNow,
  type ScheduleKey,
} from '@/features/attendance/shifts';
import { cn } from '@/shared/lib/utils';
import { useAttendanceUnrestricted } from '@/features/attendance/attendanceExempt';
import { getHardwareProfile, isPhoneDevice } from '@/shared/lib/device';
import { useLanguage } from '@/shared/i18n';
import { isPgpFilled } from '@/features/pgp';
import AttendanceProjectDialog from '@/features/attendance/components/AttendanceProjectDialog';
import { ScheduleLockedNotice } from '@/features/attendance/components/ScheduleLockedNotice';
import OpenSessionBlockDialog from '@/features/attendance/components/OpenSessionBlockDialog';
import ClockOutBlockedDialog from '@/features/attendance/components/ClockOutBlockedDialog';
import { useClockOutFlow } from '@/features/attendance/useClockOutFlow';
import { hhmmOf } from '@/features/attendance/clockOutFlow';
import { confirmDialog } from '@/shared/components/ConfirmDialog';
import { toast } from '@/shared/components/Toast';
import {
  isOpenSessionBlock,
  openSessionFromError,
  type BlockedOpenSession,
} from '@/features/attendance/openSessionBlock';
import type { NonProjectPick, NonProjectWorkToday } from '@/features/non-project-work/types';
import { categoryLabel } from '@/features/non-project-work/lib';
import { announceClockIn } from '@/features/attendance/monthConfirm';

/* ---------------------------------------------------------------- *
 *  AttendanceWidget — compact dashboard surface for the daily
 *  irts (attendance) flow.  Lets the user:
 *    • see their current clock-in status + live elapsed timer
 *    • clock-in / clock-out from the dashboard (no need to hop
 *      to /attendance for the most common action)
 *    • flip between the two work shifts (08–17 vs 09–18) — the
 *      backend uses this to compute lateness penalties
 *  Mirrors the heavier /attendance page but trimmed to fit a
 *  side card on the dashboard's TODAY row.
 * ---------------------------------------------------------------- */

/** ⚠️ Ээлжийн хүснэгт `features/attendance/shifts.ts`-д НЭГ хувь (2026-08-26) —
 *  урьд нь энэ файлд тусдаа бичигдсэн байв. */
type Shift = ScheduleKey;

interface StatusResponse {
  clocked_in: boolean;
  on_office_ip: boolean;
  require_office_ip?: boolean;
  client_ip?: string;
  session: AttendanceSession | null;
  today: string;
  work_schedule?: Shift;
  schedule_label?: string;
  schedule_locked?: boolean;
  summer_forced?: boolean;
  schedule_selected?: Shift;
  schedule_effective_from?: string;
  schedule_change?: { schedule: Shift; date: string; label: string } | null;
  schedule_options?: Array<{ key: Shift; label: string; start: string; end: string }>;
  late_penalty_per_minute?: number;
  active_project_ids?: number[];
  /** Ирцээр сонгосон засварын төслүүд (0324) — `projects.id`-тэй ХОЛИХГҮЙ. */
  active_repair_project_ids?: number[];
  repair_projects?: RepairProjectOption[];
  /** Өнөөдрийн төслийн бус ажил + маягтын мэдээлэл (0342). */
  non_project_work?: NonProjectWorkToday;
  checkpoints?: AttendanceProjectCheckpoint[];
  next_checkpoint_prompt?: AttendanceCheckpointType | null;
  /** Өнөөдөр ажлын явц (task хувь) бүртгэсэн эсэх — гарах товчийг
   *  идэвхжүүлэхэд ашиглана. */
  progress_logged_today?: boolean;
  /** Өмнөх өдөр гарах бүртгэлээ хийгээгүй бол ирэх бүртгэл хаалттай.
   *  Дэлгэрэнгүйг `features/attendance/openSessionBlock.ts`-ээс үз. */
  blocked_open_session?: BlockedOpenSession | null;
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function getElapsed(clockIn: string): { h: number; m: number; text: string } {
  const ms = Date.now() - new Date(clockIn).getTime();
  const totalMins = Math.max(0, Math.floor(ms / 60_000));
  const h = Math.floor(totalMins / 60);
  const m = totalMins % 60;
  return { h, m, text: `${h}ц ${String(m).padStart(2, '0')}м` };
}

export default function AttendanceWidget() {
  const { t } = useLanguage();
  // Admin tier + онцгойлсон ажилтнууд (attendanceExempt) төсөл сонгох болон
  // утас/төхөөрөмжийн хязгаарлалтгүй — popup-гүйгээр шууд ирцээ бүртгэнэ.
  const unrestricted = useAttendanceUnrestricted();
  // Ирсэн бүртгэл зөвхөн компьютероос — утаснаас хориглоно (admin хасагдана).
  const isPhone = isPhoneDevice();
  const [acting, setActing] = useState(false);
  const [savingShift, setSavingShift] = useState(false);
  const [elapsed, setElapsed] = useState('');
  const [error, setError] = useState<string | null>(null);

  const [activeIds, setActiveIds] = useState<Set<number>>(new Set());
  const [activeRepairIds, setActiveRepairIds] = useState<Set<number>>(new Set());
  const [dialogType, setDialogType] = useState<AttendanceCheckpointType | null>(null);
  const [seenPrompt, setSeenPrompt] = useState<AttendanceCheckpointType | null>(null);
  // Өмнөх өдрийн хаагдаагүй бүртгэлийн хаалтыг тайлбарлах цонх.
  const [blockedDialog, setBlockedDialog] = useState<{
    session: BlockedOpenSession | null;
  } | null>(null);

  const statusQuery = useApiQuery<StatusResponse>('/attendance/my-status');
  const status = statusQuery.data ?? null;
  const loading = statusQuery.isLoading;
  // Ирэх бүртгэл хаалттай эсэх — жинхэнэ хаалт сервер дээр, энэ нь UX.
  const blockedOpenSession = status?.blocked_open_session ?? null;
  // Өнөөдрийн гарах бүртгэл хийгдсэн (сүүлийн бүртгэл хаалттай).
  const clockedOutToday = !!status && !status.clocked_in && !!status.session?.clock_out;

  useEffect(() => {
    if (statusQuery.data) {
      setActiveIds(new Set(statusQuery.data.active_project_ids ?? []));
      setActiveRepairIds(new Set(statusQuery.data.active_repair_project_ids ?? []));
    }
  }, [statusQuery.data]);

  // Popup-д дамжуулах массивыг тогтвортой байлгана — `Array.from(activeIds)`-г
  // JSX дотор шууд бичихэд БҮР RENDER-т шинэ массив үүсч, popup дотор сонгосон
  // төслүүд цэвэрлэгдэж байсан (AttendanceProjectDialog дахь тайлбарыг үз).
  const initialProjectIds = useMemo(() => Array.from(activeIds), [activeIds]);
  const initialRepairIds = useMemo(() => Array.from(activeRepairIds), [activeRepairIds]);
  const repairProjects = useMemo(() => status?.repair_projects ?? [], [status?.repair_projects]);
  const nonProjectWork = status?.non_project_work ?? null;
  // Татгалзсан мөр «өнөөдрийн ажил»-д тооцогдохгүй — серверийн дүрэмтэй ижил.
  const nonProjectToday = (nonProjectWork?.today ?? []).filter((e) => e.status !== 'rejected');

  // Load the project list once.  Show EVERY project so people can log
  // attendance against any of them — staff often help on projects their
  // team isn't structurally tagged to, and the old "members/team only"
  // filter hid those from the picker entirely.  The caller's own
  // (member / team-assigned) projects are sorted to the top for
  // convenience; the rest follow in the backend's order.
  const projectsQuery = useApiQuery<{ projects: ProjectOption[] }>('/projects', { retry: false });
  const projects: ProjectOption[] = useMemo(() => {
    // Архивлагдсан төслүүдийг өдрийн ажлын сонголтоос хасна.
    const list = (projectsQuery.data?.projects ?? []).filter((p) => p.status !== 'archived');
    const isMine = (p: ProjectOption) => p.is_member === 1 || p.is_team_assigned === 1;
    // Stable sort keeps each group in the backend's original order.
    return [...list].sort((a, b) => Number(isMine(b)) - Number(isMine(a)));
  }, [projectsQuery.data]);

  // Гарахын өмнө тухайн оны хөгжлийн төлөвлөгөө бөглөсөн байх шаардлага.
  // '/pgp/my' түлхүүр ProfilePage-ийн PGP табтай кэшээ хуваалцана; unrestricted
  // (admin tier/чөлөөлөгдсөн) хэрэглэгчид хаалтад өртөхгүй тул татахгүй.
  const pgpQuery = useApiQuery<{ plans: PgpPlan[] }>('/pgp/my', {
    enabled: !unrestricted,
    retry: false,
  });
  // Хөгжлийн төлөвлөгөө бөглөөгүй бол гарах товч идэвхгүй харагдаж, дарахад
  // төлөвлөгөө рүү чиглүүлнэ. Хариу ирээгүй/алдаатай үед хаалт тавихгүй.
  const pgpMissing =
    !!status?.clocked_in &&
    !unrestricted &&
    !!pgpQuery.data &&
    !isPgpFilled(pgpQuery.data.plans);

  const refresh = useCallback(async () => {
    await statusQuery.refetch();
  }, [statusQuery]);

  // «Гарсан бүртгэл»-ийн нэгдсэн урсгал (Ирц хуудастай ИЖИЛ — `useClockOutFlow`):
  // товч хэзээ ч чимээгүй хаагдахгүй, бүртгэл хийгдээгүй бол шалтгаан нь
  // монголоор цонхонд гарна.
  const clockOut = useClockOutFlow({
    exempt: unrestricted,
    pgpMissing,
    projectsUnavailable: projectsQuery.isError && projects.length === 0,
    refetchStatus: statusQuery.refetch,
    proceed: () => {
      if (unrestricted) void submitCheckpoint([], [], 'clock_out');
      else setDialogType('clock_out');
    },
    onConfirmedOut: (clockOutIso) => {
      setDialogType(null);
      setError(null);
      toast.success(t('clockOutFlow.alreadyOut', { time: hhmmOf(clockOutIso) }));
      void refresh();
    },
  });

  // Live elapsed timer — updates every 30s while clocked in.
  useEffect(() => {
    if (status?.clocked_in && status.session) {
      const update = () => setElapsed(getElapsed(status.session!.clock_in).text);
      update();
      const t = setInterval(update, 30_000);
      return () => clearInterval(t);
    }
    setElapsed('');
  }, [status]);

  useEffect(() => {
    // Admin tier-т popup автоматаар нээгдэхгүй.
    if (unrestricted) return;
    if (!status || projects.length === 0) return;
    // Ирэх бүртгэл хаалттай хүнд төслийн popup-ыг тулгахгүй.
    if (status.blocked_open_session) return;
    const checkpointTypes = new Set((status.checkpoints ?? []).map((c) => c.checkpoint_type));
    const ubHour = (() => {
      const now = new Date();
      const utcMs = now.getTime() + now.getTimezoneOffset() * 60_000;
      return new Date(utcMs + 8 * 60 * 60_000).getHours();
    })();
    let prompt: AttendanceCheckpointType | null = null;
    if (!status.clocked_in && !checkpointTypes.has('morning')) {
      prompt = 'morning';
    } else if (status.clocked_in && ubHour >= 14 && !checkpointTypes.has('afternoon')) {
      prompt = 'afternoon';
    } else if (status.next_checkpoint_prompt) {
      prompt = status.next_checkpoint_prompt;
    }
    // Ажил тарахад ойртсон бол «үдээс хойш» popup-ыг ТУЛГАХГҮЙ — Ирц
    // хуудастай ИЖИЛ дүрэм (`shifts.ts` → `afternoonAutoPromptEndsAt`).
    if (
      prompt === 'afternoon' &&
      ubMinutesNow() >= afternoonAutoPromptEndsAt(status.work_schedule, status.schedule_options)
    ) {
      prompt = null;
    }
    if ((prompt === 'morning' || prompt === 'afternoon') && seenPrompt !== prompt) {
      setDialogType(prompt);
      setSeenPrompt(prompt);
    }
  }, [unrestricted, projects.length, seenPrompt, status]);

  const submitCheckpoint = async (
    projectIds: number[],
    repairProjectIds: number[],
    typeOverride?: AttendanceCheckpointType,
    nonProject?: NonProjectPick[],
  ) => {
    const type = typeOverride ?? dialogType;
    if (!type) return;
    // Popup нээлттэй байх зуур /pgp/my ирж хаалт идэвхжсэн байж болно —
    // чимээгүй шилжүүлэхгүй, «хийгдээгүй» цонхонд шалтгааныг хэлнэ.
    if (type === 'clock_out' && pgpMissing) {
      setDialogType(null);
      clockOut.showBlocks([{ kind: 'pgp' }]);
      return;
    }
    // Давхар илгээлтээс хамгаална (Ирц хуудастай ижил) — `disabled` нь
    // дараагийн render хүртэл хүчингүй тул хоёр дахь дарал энд зогсоно.
    if (acting) return;
    setActing(true);
    setError(null);
    try {
      // `non_project` (0357) — цэгт сонгосон төслийн бус ажил, цаггүй.  Popup-гүй
      // (admin tier) бүртгэлд илгээхгүй — сервер тэр цэгийн сонголтод хүрэхгүй.
      const picks = {
        project_ids: projectIds,
        repair_project_ids: repairProjectIds,
        ...(nonProject ? { non_project: nonProject } : {}),
      };
      if (type === 'morning') {
        await apiFetch('/attendance/clock-in', { data: { ...picks, device: getHardwareProfile() } });
      } else if (type === 'afternoon') {
        await apiFetch('/attendance/checkpoint', {
          data: { checkpoint_type: 'afternoon', ...picks },
        });
        // Ажил тарах цаг ойртсон бол шууд ГАРАХ popup руу дамжуулна —
        // «үдээс хойш» баталгаажуулалтыг гарсан бүртгэл гэж андуурахгүй.
        const chainToClockOut =
          ubMinutesNow() >=
          afternoonAutoPromptEndsAt(status?.work_schedule, status?.schedule_options);
        setDialogType(chainToClockOut ? 'clock_out' : null);
        await refresh();
        return;
      } else {
        const res = await apiFetch<{ clock_out?: string; hours_worked?: number }>(
          '/attendance/clock-out',
          { data: picks },
        );
        // Амжилтыг ИЛ хэлнэ (widget-д амжилтын мөр байхгүй тул toast).
        toast.success(
          t('clockOutFlow.success', {
            time: hhmmOf(res.clock_out) || hhmmOf(new Date().toISOString()),
          }),
        );
      }
      setDialogType(null);
      await refresh();
      // Сарын эхний «ирцээ батал» сануулга (`MonthConfirmPrompt`) — ирсэн
      // бүртгэлийн дараа, төслийн popup хаагдсаны ДАРАА нээгдэнэ.
      if (type === 'morning') announceClockIn();
    } catch (e) {
      // Хаагдаагүй бүртгэлийн хаалт — Ирц хуудастай ижил цонхоор.
      if (isOpenSessionBlock(e)) {
        setDialogType(null);
        setBlockedDialog({ session: openSessionFromError(e) });
        await refresh();
      } else if (type === 'clock_out') {
        // Гарах бүртгэл унасан — шалтгааныг ЗААВАЛ монголоор (Ирц хуудастай ИЖИЛ).
        const inline = await clockOut.handleSubmitError(e);
        if (inline) {
          setError(t('clockOutFlow.notDone', { reason: inline }));
          await refresh();
        } else {
          setDialogType(null);
        }
      } else {
        setError(e instanceof Error ? e.message : t('common.error'));
        // 400 = popup хуучин төлөвөөр шийдсэн (өөр табд төслийн бус ажил
        // нэмсэн/устгасан г.м.) — төлвийг шинэчилбэл цонх «тайлбар бичих»
        // шаардлага, «дор хаяж нэг» тоололоо зөв харуулна.
        if (e instanceof ApiError && e.status === 400) await refresh();
      }
    } finally {
      setActing(false);
    }
  };

  const openActionDialog = () => {
    const type: AttendanceCheckpointType = status?.clocked_in ? 'clock_out' : 'morning';
    // Хаалттай бол сүлжээ рүү явахгүй, шалтгааныг шууд харуулна.
    if (type === 'morning' && blockedOpenSession) {
      setBlockedDialog({ session: blockedOpenSession });
      return;
    }
    if (type === 'clock_out') {
      void clockOut.start();
      return;
    }
    // Өнөөдөр аль хэдийн гарсан хүн дахин орох бол баталгаажуулна — андуурч
    // дарвал шинэ нээлттэй бүртгэл үүсч маргааш ирэх бүртгэл түгжигдэнэ.
    if (clockedOutToday) {
      void confirmDialog({
        title: t('clockOutFlow.reentryTitle'),
        description: t('clockOutFlow.reentryBody', { time: hhmmOf(status?.session?.clock_out) }),
        confirmText: t('clockOutFlow.reentryButton'),
      }).then((ok) => {
        if (!ok) return;
        if (unrestricted) void submitCheckpoint([], [], type);
        else setDialogType(type);
      });
      return;
    }
    // Admin tier бол popup-гүйгээр шууд бүртгэнэ.
    if (unrestricted) void submitCheckpoint([], [], type);
    else setDialogType(type);
  };

  const setShift = async (next: Shift) => {
    // ⚠️ Зуны түгжээ 2026-08-26-нд арилсан — сонголт нь хойшлогдоно
    //    (`schedule_effective_from`), хориглогдохоо больсон.
    if (status?.schedule_locked) return;
    if (savingShift || (status?.schedule_selected ?? status?.work_schedule ?? 'standard') === next)
      return;
    setSavingShift(true);
    setError(null);
    try {
      await apiFetch('/auth/profile', { method: 'PATCH', data: { work_schedule: next } });
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('common.error'));
    } finally {
      setSavingShift(false);
    }
  };

  if (loading) {
    return (
      <Card className="border-border bg-card/60 backdrop-blur shadow-sm h-full">
        <CardContent className="p-4">
          <div className="h-32 rounded bg-muted/40 animate-pulse" />
        </CardContent>
      </Card>
    );
  }

  const isIn = !!status?.clocked_in;
  const onOffice = !!status?.on_office_ip;
  // Админ оффисын IP шалгалтыг унтраасан бол (require_office_ip === false)
  // хаанаас ч бүртгэхийг зөвшөөрнө.
  const ipCheckOn = status?.require_office_ip !== false;
  const canClock = onOffice || !ipCheckOn;
  const lateMin = status?.session?.late_minutes ?? 0;
  // БОДИТ ээлж (өнөөдөр хүчинтэй) ба СОНГОЛТ — хоёр өөр зүйл.
  const currentShift: Shift = status?.work_schedule ?? 'standard';
  const selectedShift: Shift = status?.schedule_selected ?? currentShift;
  const scheduleChange = status?.schedule_change ?? null;
  const shiftOpts = shiftOptions(status?.schedule_options);
  // Төсөл + засварын төсөл нэг мөрөнд — засварынх нь «Засвар:» угтвартай
  // (нэр нь төслийн нэртэй төстэй байж болно, ялгаа нь ил байх ёстой).
  const activeProjectNames = [
    ...projects.filter((project) => activeIds.has(project.id)).map((project) => project.name),
    ...repairProjects
      .filter((rp) => activeRepairIds.has(rp.id))
      .map((rp) => `${t('attendanceWidget.repairPrefix')} ${rp.name}`),
    // Төслийн бус ажил (0342) — «Төслийн бус:» угтвартай, засвараас ялгагдана.
    ...nonProjectToday.map(
      (e) =>
        `${t('attendanceWidget.nonProjectPrefix')} ${e.note ?? categoryLabel(e.category, e.category_label, t)}`,
    ),
  ];
  const activeCount = activeIds.size + activeRepairIds.size + nonProjectToday.length;
  const checkpointTypes = new Set((status?.checkpoints ?? []).map((cp) => cp.checkpoint_type));
  const ubHourNow = (() => {
    const now = new Date();
    const utcMs = now.getTime() + now.getTimezoneOffset() * 60_000;
    return new Date(utcMs + 8 * 60 * 60_000).getHours();
  })();
  const afternoonUnlocked = ubHourNow >= 14;
  const afternoonMissing = isIn && afternoonUnlocked && !checkpointTypes.has('afternoon');

  return (
    <Card className="border-border bg-card/60 backdrop-blur shadow-sm h-full overflow-hidden">
      {/* Top accent strip — thin status indicator only.  Card body
          stays neutral so it visually matches the rest of the dashboard
          cards (Өнөөдөр, Calendar, Weather, etc.). */}
      <div
        className={cn(
          'h-1',
          isIn
            ? 'bg-gradient-to-r from-emerald-500 via-emerald-400 to-emerald-600'
            : 'bg-gradient-to-r from-primary/60 to-transparent',
        )}
      />
      <CardContent className="p-4 space-y-3">
        {/* ── Header: title + status pill ── */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <div
              className={cn(
                'h-8 w-8 rounded-md flex items-center justify-center shrink-0',
                isIn
                  ? 'bg-success/15 text-success'
                  : 'bg-muted text-muted-foreground',
              )}
            >
              {isIn ? <Timer className="h-4 w-4" /> : <Clock className="h-4 w-4" />}
            </div>
            <div className="min-w-0">
              <div className="text-sm font-semibold leading-tight">{t('attendanceWidget.title')}</div>
              <div
                data-testid="attendance-widget-state"
                className={cn(
                  'text-label font-medium',
                  isIn || clockedOutToday ? 'text-success' : 'text-muted-foreground',
                )}
              >
                {/* Гарсан хүнд «Бүртгэгдээгүй» гэж харуулахгүй. */}
                {isIn
                  ? `● ${t('attendanceWidget.working')}`
                  : clockedOutToday
                    ? `✓ ${t('clockOutFlow.doneBadge', { time: hhmmOf(status?.session?.clock_out) })}`
                    : `○ ${t('attendanceWidget.notClockedIn')}`}
              </div>
            </div>
          </div>
          <Link
            to="/app/attendance"
            className="text-micro text-primary hover:underline flex items-center gap-0.5"
          >
            {t('attendanceWidget.viewAll')} <ArrowRight className="w-3 h-3" />
          </Link>
        </div>

        {/* ── Live timer / hint ── */}
        {isIn && status?.session ? (
          <div className="rounded-md bg-background/40 border border-border/40 px-3 py-2">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-2xl font-bold text-success tabular-nums leading-none">
                {elapsed || '0ц 00м'}
              </span>
              <span className="text-micro text-muted-foreground">
                {t('attendanceWidget.clockedInAt')}{' '}
                <span className="text-foreground font-medium">
                  {formatTime(status.session.clock_in)}
                </span>
              </span>
            </div>
            {lateMin > 0 && (
              <p className="text-micro text-warning mt-1 flex items-center gap-1">
                <AlertCircle className="h-3 w-3" />
                {t('attendanceWidget.lateMinutes', { minutes: lateMin })}
              </p>
            )}
          </div>
        ) : clockedOutToday && status?.session ? (
          <div className="rounded-md bg-success/10 border border-success/30 px-3 py-2">
            <p className="text-micro text-success font-medium" data-testid="clocked-out-summary">
              {t('clockOutFlow.doneSummary', {
                in: hhmmOf(status.session.clock_in),
                out: hhmmOf(status.session.clock_out),
              })}
            </p>
          </div>
        ) : (
          <div className="rounded-md bg-background/40 border border-border/40 px-3 py-2">
            <p className="text-micro text-muted-foreground">
              {t('attendanceWidget.workHours')}{' '}
              <span className="text-foreground font-semibold">
                {shiftLabel(currentShift, status?.schedule_options)}
              </span>
            </p>
          </div>
        )}

        {/* ── Office network indicator (only when off-network AND IP check on) ── */}
        {!canClock && (
          <div className="flex items-start gap-1.5 text-micro text-warning bg-warning/10 border border-warning/20 rounded-md px-2 py-1.5">
            <WifiOff className="h-3 w-3 shrink-0 mt-0.5" />
            <span>{t('attendanceWidget.offOfficeNetwork')}</span>
          </div>
        )}

        {/* ── Today's latest active projects + checkpoint prompt ── */}
        <div className="space-y-1.5 rounded-md border border-border/50 bg-background/30 px-3 py-2">
          <div className="flex items-center justify-between text-label text-muted-foreground font-medium">
            <span className="flex items-center gap-1">
              <FolderOpen className="h-3 w-3" />
              {t('attendanceWidget.todayProjects')}
            </span>
            <span
              className={cn(
                'tabular-nums normal-case tracking-normal',
                activeCount === 0
                  ? 'text-warning'
                  : 'text-success',
              )}
            >
              {t('attendanceWidget.selectedCount', { count: activeCount })}
            </span>
          </div>
          {activeProjectNames.length === 0 ? (
            <p className="text-micro text-muted-foreground italic">{t('attendanceWidget.noProjects')}</p>
          ) : (
            <p
              className="truncate text-xs font-medium text-foreground"
              title={activeProjectNames.join(', ')}
            >
              {activeProjectNames.join(', ')}
            </p>
          )}
          {afternoonMissing && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 w-full text-micro"
              onClick={() => (unrestricted ? void submitCheckpoint([], [], 'afternoon') : setDialogType('afternoon'))}
              disabled={!canClock}
            >
              {t('attendanceWidget.afternoonNotConfirmed')}
            </Button>
          )}
          {!unrestricted && !isIn && activeCount === 0 && (
            <p className="text-micro text-warning flex items-center gap-1">
              <AlertCircle className="h-3 w-3" />
              {t('attendanceWidget.selectProjectsHint')}
            </p>
          )}
        </div>

        {/* Утаснаас ирсэн бүртгэл хийх боломжгүй (admin хасагдана). Гарсан
          бүртгэл хязгаарлалтгүй тул зөвхөн clock-in үед мэдэгдэнэ. */}
        {isPhone && !unrestricted && !isIn && (
          <p className="flex items-start gap-1.5 text-micro text-warning">
            <Smartphone className="h-3.5 w-3.5 flex-shrink-0 mt-0.5" />
            {t('attendanceWidget.phoneClockInBlocked')}
          </p>
        )}

        {/* Гарахын өмнө өнөөдөр ажлын явц (task хувь) оруулсан байх шаардлага. */}
        {isIn && !unrestricted && status?.progress_logged_today === false && (
          <p className="flex items-start gap-1.5 text-micro text-warning">
            <AlertCircle className="h-3.5 w-3.5 flex-shrink-0 mt-0.5" />
            {t('attendanceWidget.logProgressBeforeClockOut')}
          </p>
        )}

        {/* Гарахын өмнө хөгжлийн төлөвлөгөө бөглөсөн байх шаардлага. */}
        {pgpMissing && (
          <p
            id="attendance-widget-pgp-hint"
            className="flex items-start gap-1.5 text-micro text-warning"
          >
            <AlertCircle className="h-3.5 w-3.5 flex-shrink-0 mt-0.5" />
            {t('attendanceWidget.fillPgpBeforeClockOut')}
          </p>
        )}

        {/* ── Clock-in / clock-out action ── */}
        <Button
          onClick={openActionDialog}
          aria-describedby={pgpMissing ? 'attendance-widget-pgp-hint' : undefined}
          data-testid={isIn ? 'attendance-widget-clock-out' : 'attendance-widget-clock-in'}
          variant={!isIn && clockedOutToday && !blockedOpenSession ? 'outline' : undefined}
          disabled={
            isIn
              ? // ⚠️ ГАРАХ ТОВЧИЙГ ЧИМЭЭГҮЙ ХААХГҮЙ (2026-10-19): явц/PGP/сүлжээ/
                // төслийн жагсаалт — бүгдийг `clockOut.start` серверээс шинээр
                // шалгаад «Гарах бүртгэл хийгдээгүй байна» цонхонд хэлнэ.
                acting || clockOut.checking
              : // Ирсэн бүртгэл: хаалттай үед товч ДАРАГДАНА — тайлбарын цонх нээгдэнэ.
                blockedOpenSession
                ? false
                : acting ||
                  !canClock ||
                  (!unrestricted && projects.length === 0) ||
                  (isPhone && !unrestricted)
          }
          className={cn(
            'w-full h-10 gap-2 font-semibold',
            isIn
              ? 'bg-info hover:bg-info text-white'
              : clockedOutToday && !blockedOpenSession
                ? ''
                : 'bg-success hover:bg-success text-white',
            !isIn && blockedOpenSession && 'opacity-50 saturate-50 hover:bg-success',
          )}
        >
          {acting || clockOut.checking ? (
            <RefreshCw className="h-4 w-4 animate-spin" />
          ) : isIn ? (
            <LogOut className="h-4 w-4" />
          ) : (
            <LogIn className="h-4 w-4" />
          )}
          {isIn
            ? t('attendanceWidget.clockOut')
            : clockedOutToday && !blockedOpenSession
              ? t('clockOutFlow.reentryButton')
              : t('attendanceWidget.clockIn')}
        </Button>

        {/* ── Shift selector — quick toggle between 8-17 and 9-18 ── */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-label text-muted-foreground font-medium">
            <span>{t('attendanceWidget.workHoursLabel')}</span>
            {onOffice && (
              <span className="flex items-center gap-1 text-success normal-case tracking-normal text-micro">
                <Wifi className="h-2.5 w-2.5" /> {t('attendanceWidget.office')}
              </span>
            )}
          </div>
          {status?.schedule_locked ? (
            <ScheduleLockedNotice scheduleLabel={status.schedule_label} compact />
          ) : (
            <>
          <div className="grid grid-cols-3 gap-1.5">
            {shiftOpts.map((opt) => {
              // Идэвхтэй нь СОНГОЛТ — зуны үед бодит ээлж бүгдэд `early`.
              const active = selectedShift === opt.key;
              const Icon = opt.icon;
              return (
                <button
                  key={opt.key}
                  type="button"
                  disabled={savingShift}
                  onClick={() => setShift(opt.key)}
                  className={cn(
                    'flex items-center justify-center gap-1 px-1.5 py-1.5 rounded-md border text-micro font-medium transition-colors disabled:opacity-60',
                    active
                      ? 'border-primary/60 bg-primary/15 text-primary'
                      : 'border-border/60 bg-background/30 text-muted-foreground hover:border-primary/30 hover:text-foreground',
                  )}
                >
                  <Icon className="h-3 w-3 shrink-0" />
                  <span className="tabular-nums">{opt.short}</span>
                  {active && <CheckCircle2 className="h-3 w-3 shrink-0" />}
                </button>
              );
            })}
          </div>
          {/* «{огноо}-нээс таны ажил … болно» сануулга 2026-09-17-нд эзний
              хүсэлтээр ХАСАГДСАН. */}
            </>
          )}
        </div>

        {/* Өмнөх өдрийн хаагдаагүй бүртгэл — ирэх бүртгэл хаалттай. */}
        {!isIn && blockedOpenSession && (
          <p className="flex items-start gap-1.5 text-micro text-danger">
            <AlertCircle className="h-3.5 w-3.5 flex-shrink-0 mt-0.5" />
            {t('attendancePage.blockedHint', { date: blockedOpenSession.date })}
          </p>
        )}

        {error && <p className="text-micro text-danger">{error}</p>}
      </CardContent>
      <AttendanceProjectDialog
        open={dialogType !== null}
        checkpointType={dialogType ?? 'morning'}
        projects={projects}
        initialProjectIds={initialProjectIds}
        repairProjects={repairProjects}
        initialRepairProjectIds={initialRepairIds}
        nonProjectWork={nonProjectWork}
        submitting={acting}
        onOfficeIp={canClock}
        workSchedule={currentShift}
        onWorkScheduleChange={status?.schedule_locked ? undefined : setShift}
        savingSchedule={savingShift}
        scheduleLocked={!!status?.schedule_locked}
        selectedShift={selectedShift}
        scheduleEffectiveFrom={status?.schedule_effective_from}
        error={error}
        scheduleChange={scheduleChange}
        scheduleOptions={status?.schedule_options}
        onOpenChange={(open) => {
          if (!open) setDialogType(null);
        }}
        onSubmit={(projectIds, repairIds, nonProject) =>
          submitCheckpoint(projectIds, repairIds, undefined, nonProject)
        }
      />
      <OpenSessionBlockDialog
        open={blockedDialog !== null}
        session={blockedDialog?.session ?? blockedOpenSession}
        onOpenChange={(open) => {
          if (!open) setBlockedDialog(null);
        }}
      />
      <ClockOutBlockedDialog
        blocks={clockOut.blocks}
        onClose={clockOut.dismiss}
        onRetry={() => void clockOut.start()}
      />
    </Card>
  );
}
