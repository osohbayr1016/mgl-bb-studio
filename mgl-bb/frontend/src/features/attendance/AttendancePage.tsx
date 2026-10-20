import { useEffect, useState, useCallback, useMemo } from 'react';
import { ApiError, apiFetch } from '@/shared/api/client';
import { PageContainer } from '@/shared/components/PageContainer';
import { PageHeader } from '@/shared/components/PageHeader';
import { useApiQuery } from '@/shared/api/useApi';
import type {
  AttendanceCheckpointType,
  AttendanceProjectCheckpoint,
  AttendanceSession,
  AttendanceWeekSummary,
  PgpPlan,
  ProjectOption,
  RepairProjectOption,
} from '@/shared/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/ui/card';
import { Button } from '@/ui/button';
import { Badge } from '@/ui/badge';
import {
  Clock,
  LogIn,
  LogOut,
  Timer,
  CalendarDays,
  TrendingUp,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  Wifi,
  WifiOff,
  Sunrise,
  FolderOpen,
  Smartphone,
} from 'lucide-react';
import MyLeavesCard from '@/features/attendance/components/MyLeavesCard';
import MyOvertimeCard from '@/features/attendance/components/MyOvertimeCard';
import MyDailyAttendanceCard from '@/features/attendance/components/MyDailyAttendanceCard';
import MyOutOfOfficeCard from '@/features/attendance/components/MyOutOfOfficeCard';
import AttendanceProjectDialog from '@/features/attendance/components/AttendanceProjectDialog';
import { ScheduleLockedNotice } from '@/features/attendance/components/ScheduleLockedNotice';
import ClockOutRuleNotice from '@/features/attendance/components/ClockOutRuleNotice';
import OpenSessionBlockDialog from '@/features/attendance/components/OpenSessionBlockDialog';
import ClockOutBlockedDialog from '@/features/attendance/components/ClockOutBlockedDialog';
import { useClockOutFlow } from '@/features/attendance/useClockOutFlow';
import { hhmmOf } from '@/features/attendance/clockOutFlow';
import { confirmDialog } from '@/shared/components/ConfirmDialog';
import {
  isOpenSessionBlock,
  openSessionFromError,
  type BlockedOpenSession,
} from '@/features/attendance/openSessionBlock';
import { cn } from '@/shared/lib/utils';
import { useAttendanceUnrestricted } from '@/features/attendance/attendanceExempt';
import { getHardwareProfile, isPhoneDevice } from '@/shared/lib/device';
import { useLanguage } from '@/shared/i18n';
import { useAuth } from '@/shared/context/AuthContext';
import { isCeo } from '@/shared/lib/ceo';
import { isPgpFilled } from '@/features/pgp';
import type { NonProjectPick, NonProjectWorkToday } from '@/features/non-project-work/types';
import { categoryLabel } from '@/features/non-project-work/lib';

import { formatDate } from '@/shared/lib/time';
import {
  shiftOptions,
  shiftLabel,
  formatShiftDate,
  afternoonAutoPromptEndsAt,
  ubMinutesNow,
  type ScheduleKey,
} from '@/features/attendance/shifts';
import { announceClockIn } from '@/features/attendance/monthConfirm';
// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function formatHours(h: number | null): string {
  if (h === null) return '—';
  const hrs = Math.floor(h);
  const mins = Math.round((h - hrs) * 60);
  return `${hrs}h ${mins}m`;
}

function getElapsedTime(clockIn: string): string {
  const ms = Date.now() - new Date(clockIn).getTime();
  const totalMins = Math.floor(ms / 60_000);
  const hrs = Math.floor(totalMins / 60);
  const mins = totalMins % 60;
  return `${hrs}h ${mins}m`;
}

/** Suggest a /24 CIDR for an IPv4 address — what most office routers need. */
function ipToCidr24(ip: string): string {
  const m = ip.match(/^(\d{1,3}\.\d{1,3}\.\d{1,3})\.\d{1,3}$/);
  return m ? `${m[1]}.0/24` : ip;
}

/** ⚠️ Ээлжийн хүснэгт `features/attendance/shifts.ts`-д НЭГ хувь болов
 *  (2026-08-26).  Урьд нь энэ файл, `AttendanceWidget`, `AttendanceProjectDialog`,
 *  `useWorkStartReminder` дөрвүүлэнд тус тусдаа бичигдсэн байв. */
type Shift = ScheduleKey;

function formatMnt(amount: number): string {
  return new Intl.NumberFormat('mn-MN').format(amount) + '₮';
}

const WEEKDAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;

const CHECKPOINT_LABEL_KEYS: Record<AttendanceCheckpointType, string> = {
  morning: 'attendancePage.checkpointMorning',
  afternoon: 'attendancePage.checkpointAfternoon',
  clock_out: 'attendancePage.checkpointClockOut',
};

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------
export default function AttendancePage() {
  const { t, lang } = useLanguage();
  const { user } = useAuth();
  // CEO (top-of-admin, hardcode id 2) ирцээс бүрэн чөлөөлөгдсөн — цаг бүртгэх
  // шаардлагагүй тул "ороогүй" сануулга харуулахгүй.
  const isCeoUser = isCeo(user);
  // Admin tier + онцгойлсон ажилтнууд (attendanceExempt) ирц бүртгэхдээ
  // төсөл сонгох болон утас/төхөөрөмжийн хязгаарлалтгүй — popup-гүйгээр
  // шууд бүртгэнэ.
  const unrestricted = useAttendanceUnrestricted();
  // Ирсэн бүртгэл (clock-in) зөвхөн компьютероос — утаснаас хориглоно
  // (admin хасагдана).  Гарсан бүртгэл/checkpoint хязгаарлалтгүй.
  const isPhone = isPhoneDevice();
  const [status, setStatus] = useState<{
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
    active_repair_project_ids?: number[];
    repair_projects?: RepairProjectOption[];
    non_project_work?: NonProjectWorkToday;
    checkpoints?: AttendanceProjectCheckpoint[];
    next_checkpoint_prompt?: AttendanceCheckpointType | null;
    progress_logged_today?: boolean;
    // Өмнөх өдрийн хаагдаагүй бүртгэл — бөглөгдсөн бол ирэх бүртгэл хаалттай.
    blocked_open_session?: BlockedOpenSession | null;
  } | null>(null);
  const [savingSchedule, setSavingSchedule] = useState(false);
  const [dialogType, setDialogType] = useState<AttendanceCheckpointType | null>(null);
  const [seenPrompt, setSeenPrompt] = useState<AttendanceCheckpointType | null>(null);
  const [submittingCheckpoint, setSubmittingCheckpoint] = useState(false);
  // Аль checkpoint бүртгэгдэж байгааг хадгална — тухайн товчийг л идэвхгүй болгоно.
  const [submittingType, setSubmittingType] = useState<AttendanceCheckpointType | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [elapsedTime, setElapsedTime] = useState('');
  // Өмнөх өдрийн хаагдаагүй бүртгэлээс болж ирэх бүртгэл хаагдсаныг
  // мэдэгдэх цонх (улаан мөр биш — хүн рүү очих ёстой асуудал).
  // `null` = хаалттай.  `{ session }` = нээлттэй; `session` нь аль өдрийнх
  // болохыг мэдэж байвал бөглөгдөнө.
  const [blockedDialog, setBlockedDialog] = useState<{
    session: BlockedOpenSession | null;
  } | null>(null);

  type MyStatus = {
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
    active_repair_project_ids?: number[];
    repair_projects?: RepairProjectOption[];
    /** Өнөөдрийн төслийн бус ажил + маягтын мэдээлэл (0342). */
    non_project_work?: NonProjectWorkToday;
    checkpoints?: AttendanceProjectCheckpoint[];
    next_checkpoint_prompt?: AttendanceCheckpointType | null;
    progress_logged_today?: boolean;
    blocked_open_session?: BlockedOpenSession | null;
  };

  // `/attendance/my-status` is shared with AttendanceWidget — using the
  // same query key means the two surfaces deduplicate the request.
  const statusQuery = useApiQuery<MyStatus>('/attendance/my-status');
  const sessionsQuery = useApiQuery<{
    sessions: AttendanceSession[];
    week_summary: AttendanceWeekSummary;
  }>(['/attendance/my-sessions'], '/attendance/my-sessions?limit=14');
  const projectsQuery = useApiQuery<{ projects: ProjectOption[] }>('/projects', { retry: false });
  // Гарахын өмнө тухайн оны хөгжлийн төлөвлөгөө бөглөсөн байх шаардлага —
  // '/pgp/my' түлхүүр ProfilePage-ийн PGP таб/AttendanceWidget-тэй кэшээ
  // хуваалцана; unrestricted хэрэглэгчид хаалтад өртөхгүй тул татахгүй.
  const pgpQuery = useApiQuery<{ plans: PgpPlan[] }>('/pgp/my', {
    enabled: !unrestricted,
    retry: false,
  });

  useEffect(() => {
    if (statusQuery.data) setStatus(statusQuery.data);
  }, [statusQuery.data]);
  const sessions: AttendanceSession[] = sessionsQuery.data?.sessions ?? [];
  const weekSummary: AttendanceWeekSummary | null = sessionsQuery.data?.week_summary ?? null;
  const loading = statusQuery.isLoading || sessionsQuery.isLoading;
  // Өмнөх өдөр гарах бүртгэлээ хийгээгүй → ирэх бүртгэл хаалттай.
  // Сервер тал `POST /attendance/clock-in`-д мөн шалгадаг тул энэ нь
  // зөвхөн UX (товчийг урьдчилан түгжих) — жинхэнэ хаалт сервер дээр.
  const blockedOpenSession = status?.blocked_open_session ?? null;
  // Өнөөдрийн гарах бүртгэл хийгдсэн (сүүлийн бүртгэл хаалттай).
  const clockedOutToday = !!status && !status.clocked_in && !!status.session?.clock_out;

  // Match AttendanceWidget: include any project where one of the
  // caller's teammates is assigned a task, not only their personal
  // assignments.
  const projects: ProjectOption[] = useMemo(() => {
    // Архивлагдсан төслүүдийг өдрийн ажлын сонголтоос хасна.
    const list = (projectsQuery.data?.projects ?? []).filter((p) => p.status !== 'archived');
    const mine = list.filter((p) => p.is_member === 1 || p.is_team_assigned === 1);
    return mine.length > 0 ? mine : list;
  }, [projectsQuery.data]);

  const refresh = useCallback(async () => {
    await Promise.all([statusQuery.refetch(), sessionsQuery.refetch()]);
  }, [statusQuery, sessionsQuery]);

  // Хөгжлийн төлөвлөгөө бөглөөгүй бол гарах товч идэвхгүй харагдаж, дарахад
  // төлөвлөгөө рүү чиглүүлнэ. Хариу ирээгүй/алдаатай үед хаалт тавихгүй.
  const pgpMissing =
    !!status?.clocked_in &&
    !unrestricted &&
    !!pgpQuery.data &&
    !isPgpFilled(pgpQuery.data.plans);

  // «Гарсан бүртгэл»-ийн нэгдсэн урсгал (`useClockOutFlow`): товч хэзээ ч
  // чимээгүй хаагдахгүй; дарахад төлвийг серверээс шинээр уншиж, хийгдэх
  // боломжгүй бол «Гарах бүртгэл хийгдээгүй байна» цонхонд шалтгааныг
  // монголоор хэлнэ; хариу алдагдсан амжилттай бүртгэлийг амжилт гэж таньна.
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
      setSuccess(t('clockOutFlow.alreadyOut', { time: hhmmOf(clockOutIso) }));
      void refresh();
    },
  });

  // Picker-ийн идэвхтэй товч = СОНГОЛТ (сервер `schedule_selected`).  Хуучин
  // код `work_schedule` (бодит ээлж) уншдаг байсан тул зуны үед сонголт
  // буруу харагддаг байв.
  const selectedShift: Shift = status?.schedule_selected ?? status?.work_schedule ?? 'standard';
  const scheduleChange = status?.schedule_change ?? null;

  const setSchedule = async (next: Shift) => {
    // ⚠️ Зуны түгжээ 2026-08-26-нд АРИЛСАН: ажилтан ХЭЗЭЭ Ч сонгож болно,
    //    зүгээр л сонголт нь `schedule_effective_from`-оос (зуны үед 9-р
    //    сарын 1) эхэлж хүчин төгөлдөр болно.  Түгжихийн оронд УРЬДЧИЛЖ
    //    МЭДЭГДЭНЭ — доорх «schedule_change» самбарыг үз.
    if (status?.schedule_locked) return;
    if (next === selectedShift) return;
    setSavingSchedule(true);
    try {
      await apiFetch('/auth/profile', { method: 'PATCH', data: { work_schedule: next } });
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('common.saveFailed'));
    } finally {
      setSavingSchedule(false);
    }
  };

  

  useEffect(() => {
    // Admin tier-т popup автоматаар нээгдэхгүй — тэд төсөлгүйгээр бүртгэнэ.
    if (unrestricted) return;
    if (!status || projects.length === 0) return;
    // Ирэх бүртгэл хаалттай хүнд төслийн popup-ыг тулгаж, сонгуулаад
    // эцэст нь татгалзах нь утгагүй — хаалтын цонх нь өөрөө хариултыг
    // хэлнэ (товч дарахад `handleCheckpoint` нээнэ).
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
    // Ажил тарахад ойртсон бол «үдээс хойш» popup-ыг ТУЛГАХГҮЙ — гарах гэж
    // орж ирсэн хүн түүнийг гарсан бүртгэл гэж андуурдаг байсан
    // (`shifts.ts` → `afternoonAutoPromptEndsAt`-ийн тайлбар).
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

  // Live elapsed time for the active session.
  useEffect(() => {
    if (status?.clocked_in && status.session) {
      setElapsedTime(getElapsedTime(status.session.clock_in));
      const t = setInterval(() => {
        setElapsedTime(getElapsedTime(status.session!.clock_in));
      }, 30_000);
      return () => clearInterval(t);
    }
    setElapsedTime('');
  }, [status]);

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
    // Давхар илгээлтээс хамгаална — нэгэнт бүртгэж эхэлсэн бол дахин эхлэхгүй.
    if (submittingCheckpoint) return;
    setSubmittingCheckpoint(true);
    setSubmittingType(type);
    setError(null);
    setSuccess(null);
    try {
      // `non_project` (0357) — цэгт сонгосон төслийн бус ажил, цаггүй.  Popup-гүй
      // (admin tier) бүртгэлд илгээхгүй — сервер тэр цэгийн сонголтод хүрэхгүй.
      const picks = {
        project_ids: projectIds,
        repair_project_ids: repairProjectIds,
        ...(nonProject ? { non_project: nonProject } : {}),
      };
      if (type === 'morning') {
        // `device` — ижил компьютерийн шинэ браузерыг сервер таних профайл
        // (`shared/lib/device.ts`); зөвхөн ирсэн бүртгэлд явна.
        const res = await apiFetch<{ message: string }>('/attendance/clock-in', {
          data: { ...picks, device: getHardwareProfile() },
        });
        setSuccess(res.message);
      } else if (type === 'afternoon') {
        const res = await apiFetch<{ message: string }>('/attendance/checkpoint', {
          data: { checkpoint_type: 'afternoon', ...picks },
        });
        // Энэ нь ГАРСАН бүртгэл биш гэдгийг ил хэлнэ — ажилтнууд
        // «амжилттай» гэдгийг хараад гарлаа гэж ойлгож явдаг байсан.
        setSuccess(`${res.message}. ${t('attendancePage.afternoonNotClockOut')}`);
        // Ажил тарах цаг ойртсон бол шууд гарах popup руу дамжуулна:
        // хоёр дахь «амжилттай»-г хүлээлгүй ГАРСАН бүртгэлээ хийг.
        const chainToClockOut =
          ubMinutesNow() >=
          afternoonAutoPromptEndsAt(status?.work_schedule, status?.schedule_options);
        setDialogType(chainToClockOut ? 'clock_out' : null);
        await refresh();
        return;
      } else {
        const res = await apiFetch<{
          message: string;
          clock_out?: string;
          hours_worked: number;
          non_project_credit_hours?: number;
        }>('/attendance/clock-out', { data: picks });
        const credit = res.non_project_credit_hours ?? 0;
        // Амжилтыг ИЛ хэлнэ: цаг + «маргааш хэвийн» — ажилтан гарлаа гэдэгтээ
        // эргэлзэхгүй байх ёстой.
        setSuccess(
          t('clockOutFlow.successHours', {
            time: hhmmOf(res.clock_out) || formatTime(new Date().toISOString()),
            hours: formatHours(res.hours_worked),
          }) +
            (credit > 0
              ? ` (${t('attendancePage.nonProjectCreditNote', { hours: formatHours(credit) })})`
              : ''),
        );
      }
      setDialogType(null);
      await refresh();
      // Сарын эхний «ирцээ батал» сануулга (`MonthConfirmPrompt`) — ирсэн
      // бүртгэлийн дараа, төслийн popup хаагдсаны ДАРАА нээгдэнэ.
      if (type === 'morning') announceClockIn();
    } catch (err) {
      // Өмнөх өдрийн хаагдаагүй бүртгэлийн хаалт — улаан мөр биш, цонх.
      // ⚠️ Төслийн popup-ыг ЭХЛЭЭД хаана: алдаа гарахад дээрх
      // `setDialogType(null)` ажиллахгүй үлддэг тул хоёр цонх давхарлана.
      if (isOpenSessionBlock(err)) {
        setDialogType(null);
        setBlockedDialog({ session: openSessionFromError(err) });
        // `blocked_open_session` талбарыг шинэчилж, товчийг түгжинэ.
        await refresh();
      } else if (type === 'clock_out') {
        // Гарах бүртгэл унасан — шалтгааныг ЗААВАЛ монголоор хэлнэ.  Popup
        // дотор засаж болох (төсөл сонгох г.м.) бол тэнд нь; бусад үед popup
        // хаагдаж «Гарах бүртгэл хийгдээгүй байна» цонх; хариу алдагдсан ч
        // сервер дээр амжилттай болсон бол амжилт (`useClockOutFlow`).
        const inline = await clockOut.handleSubmitError(err);
        if (inline) {
          setError(t('clockOutFlow.notDone', { reason: inline }));
          await refresh();
        } else {
          setDialogType(null);
        }
      } else {
        setError(err instanceof Error ? err.message : t('common.error'));
        // 400 = popup хуучин төлөвөөр шийдсэн (өөр табд төслийн бус ажил
        // нэмсэн/устгасан г.м.) — төлвийг шинэчилбэл цонх «тайлбар бичих»
        // шаардлага, «дор хаяж нэг» тоололоо зөв харуулна.
        if (err instanceof ApiError && err.status === 400) await refresh();
      }
    } finally {
      setSubmittingCheckpoint(false);
      setSubmittingType(null);
    }
  };

  // Admin tier бол popup-гүйгээр шууд бүртгэнэ; бусад нь төсөл сонгох
  // popup-ийг нээнэ.
  const handleCheckpoint = (type: AttendanceCheckpointType) => {
    // Сервер хаалттайг аль хэдийн хэлсэн бол сүлжээ рүү огт явахгүй —
    // төсөл сонгуулаад дараа нь татгалзах нь хэрэглэгчийг чирэгдүүлнэ.
    if (type === 'morning' && blockedOpenSession) {
      setBlockedDialog({ session: blockedOpenSession });
      return;
    }
    if (type === 'clock_out') {
      void clockOut.start();
      return;
    }
    if (unrestricted) {
      void submitCheckpoint([], [], type);
    } else {
      setDialogType(type);
    }
  };

  /** Өнөөдөр аль хэдийн гарсан хүн «Ирсэн бүртгэл» дарвал — андуурч дахин
   *  ороход шинэ нээлттэй бүртгэл үүсч маргааш нь түгжих тул баталгаажуулна. */
  const handleReentry = async () => {
    const out = hhmmOf(status?.session?.clock_out);
    const ok = await confirmDialog({
      title: t('clockOutFlow.reentryTitle'),
      description: t('clockOutFlow.reentryBody', { time: out }),
      confirmText: t('clockOutFlow.reentryButton'),
    });
    if (ok) handleCheckpoint('morning');
  };

  const weekChartData = (() => {
    if (!weekSummary) return [];
    // week_start нь UB-ийн YYYY-MM-DD.  Огноог ЦЭВЭР UTC-midnight дээр
    // нэмж тооцоолно — өмнө нь '...T00:00:00+08:00' (UB шөнө дунд) дээр
    // `toISOString()` хийхэд UTC өдөр буцаж, огноо 1-ээр ухарч баганууд
    // буруу өдөр дээр (мөн "өнөөдөр" тэмдэглэгээ буруу) зурагдаж байсан.
    const parts = weekSummary.week_start.split('-');
    const base = Date.UTC(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
    const days: { label: string; date: string; hours: number; target: number }[] = [];
    for (let i = 0; i < 7; i++) {
      const dateStr = new Date(base + i * 86_400_000).toISOString().slice(0, 10);
      const daySession = sessions.filter((s) => s.date === dateStr);
      const totalHours = daySession.reduce((sum, s) => sum + (s.hours_worked ?? 0), 0);
      days.push({
        label: t(`attendancePage.weekday.${WEEKDAY_KEYS[i]!}`),
        date: dateStr,
        hours: Math.round(totalHours * 100) / 100,
        // Зорилт = ажлын 8 цаг (цайны цаг хасагдсаны дараах net бүтэн өдөр).
        target: i < 5 ? 8 : 0,
      });
    }
    return days;
  })();

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <RefreshCw className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  const onOfficeIp = !!status?.on_office_ip;
  // Админ оффисын IP шалгалтыг унтраасан бол (require_office_ip === false)
  // хаанаас ч бүртгэхийг зөвшөөрнө — товч идэвхтэй байна.
  const ipCheckOn = status?.require_office_ip !== false;
  const canClock = onOfficeIp || !ipCheckOn;
  const activeIds = status?.active_project_ids ?? [];
  const activeRepairIds = status?.active_repair_project_ids ?? [];
  const repairProjects = status?.repair_projects ?? [];
  const nonProjectWork = status?.non_project_work ?? null;
  // Татгалзсан мөр «өнөөдрийн ажил»-д тооцогдохгүй — серверийн дүрэмтэй ижил.
  const nonProjectToday = (nonProjectWork?.today ?? []).filter((e) => e.status !== 'rejected');
  // Төсөл + засварын төсөл (0324) + төслийн бус ажил (0342) нэг мөрөнд;
  // засварынх «Засвар:», төслийн бус нь «Төслийн бус:» угтвартай.
  const activeProjectNames = [
    ...projects.filter((p) => activeIds.includes(p.id)).map((p) => p.name),
    ...repairProjects
      .filter((rp) => activeRepairIds.includes(rp.id))
      .map((rp) => `${t('attendanceWidget.repairPrefix')} ${rp.name}`),
    ...nonProjectToday.map(
      (e) =>
        `${t('attendanceWidget.nonProjectPrefix')} ${e.note ?? categoryLabel(e.category, e.category_label, t)}`,
    ),
  ];
  const activeCount = activeIds.length + activeRepairIds.length + nonProjectToday.length;
  /** Checkpoint-ийн сонголтуудыг нэг мөр болгоно — төсөл + засварын төсөл. */
  const checkpointPickNames = (cp: AttendanceProjectCheckpoint) => [
    ...cp.projects.map((p) => p.name),
    ...(cp.repairs ?? []).map((r) => `${t('attendanceWidget.repairPrefix')} ${r.name}`),
  ];
  const checkpointMap = new Map((status?.checkpoints ?? []).map((cp) => [cp.checkpoint_type, cp]));
  const checkpointTypes: AttendanceCheckpointType[] = ['morning', 'afternoon', 'clock_out'];
  const ubHourNow = (() => {
    const now = new Date();
    const utcMs = now.getTime() + now.getTimezoneOffset() * 60_000;
    return new Date(utcMs + 8 * 60 * 60_000).getHours();
  })();
  const afternoonUnlocked = ubHourNow >= 14;

  return (
    <PageContainer>
      <PageHeader title={t('attendancePage.title')} description={t('attendancePage.subtitle')} />

      {/* Ирцийн журмын байнгын анхааруулга — түр зуурын алдаа/амжилтын
          мөрөөс ДЭЭР.  Дүрэм нь эвент биш, үргэлж хүчинтэй. */}
      <ClockOutRuleNotice id="sec-attendance-notice" />

      {/* Status alerts */}
      {error && (
        <div className="flex items-center gap-3 bg-destructive/10 border border-destructive/30 text-destructive rounded-xl px-4 py-3 text-sm">
          <AlertCircle className="h-4 w-4 flex-shrink-0" />
          <span>{error}</span>
          <button
            onClick={() => setError(null)}
            className="ml-auto text-destructive/60 hover:text-destructive"
          >
            ✕
          </button>
        </div>
      )}
      {success && (
        <div className="flex items-center gap-3 bg-emerald-500/10 border border-emerald-500/30 text-emerald-600 rounded-xl px-4 py-3 text-sm">
          <CheckCircle2 className="h-4 w-4 flex-shrink-0" />
          <span>{success}</span>
          <button
            onClick={() => setSuccess(null)}
            className="ml-auto text-emerald-500/60 hover:text-emerald-600"
          >
            ✕
          </button>
        </div>
      )}

      {/* `sec-attendance-*` id-ууд нь глобал хайлтын deep-link (`?section=<id>`)
          онилох цэгүүд — өөрчлөх/устгах бол `shared/lib/search/sections.ts`-ийг
          зэрэг шинэчилнэ. */}

      {/* ROW 1 — Clock status (live timer + clock-in/out CTA, 7/12) +
          Schedule picker (early/standard shift, 5/12).  These two
          belong together because the user's selected shift is what
          drives the late-penalty calculation visible in the clock card,
          and pairing them removes ~400px of vertical scrolling. */}
      <div className="grid gap-6 lg:grid-cols-12 items-stretch">
        <Card
          id="sec-attendance-today"
          className="lg:col-span-7 border-border bg-card/60 backdrop-blur overflow-hidden scroll-mt-24"
        >
          <div
            className={`h-1.5 ${status?.clocked_in ? 'bg-gradient-to-r from-emerald-500 via-emerald-400 to-emerald-600' : 'bg-gradient-to-r from-primary via-primary/60 to-transparent'}`}
          />
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2">
              <Clock className="h-5 w-5 text-primary" />
              {t('attendancePage.todayAttendance')}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            {/* Current status */}
            <div className="flex items-center gap-4">
              <div
                className={`h-16 w-16 rounded-2xl flex items-center justify-center ${
                  status?.clocked_in
                    ? 'bg-emerald-500/10 border-2 border-emerald-500/30'
                    : 'bg-muted border-2 border-border'
                }`}
              >
                {status?.clocked_in ? (
                  <Timer className="h-7 w-7 text-emerald-500" />
                ) : clockedOutToday ? (
                  <CheckCircle2 className="h-7 w-7 text-success" />
                ) : (
                  <Clock className="h-7 w-7 text-muted-foreground" />
                )}
              </div>
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <Badge
                    variant="outline"
                    data-testid="attendance-day-badge"
                    className={
                      status?.clocked_in
                        ? 'bg-emerald-500/10 text-emerald-600 border-emerald-500/30'
                        : clockedOutToday
                          ? 'bg-success/10 text-success border-success/30'
                          : 'bg-muted text-muted-foreground'
                    }
                  >
                    {status?.clocked_in
                      ? `● ${t('attendancePage.working')}`
                      : clockedOutToday
                        ? `✓ ${t('clockOutFlow.doneBadge', { time: hhmmOf(status?.session?.clock_out) })}`
                        : isCeoUser
                          ? t('attendancePage.exempt')
                          : `○ ${t('attendancePage.notClockedIn')}`}
                  </Badge>
                </div>
                {/* Гарсан хүнд «Бүртгэгдээгүй» гэж харуулахгүй — өнөөдрийн ирц
                    бүрэн гэдгийг цагтай нь ил хэлнэ. */}
                {clockedOutToday && status?.session && (
                  <p className="text-sm text-success font-medium" data-testid="clocked-out-summary">
                    {t('clockOutFlow.doneSummary', {
                      in: hhmmOf(status.session.clock_in),
                      out: hhmmOf(status.session.clock_out),
                    })}
                  </p>
                )}
                {status?.clocked_in && status.session && (
                  <div className="space-y-0.5">
                    <p className="text-sm text-muted-foreground">
                      {t('attendancePage.clockedInAt')}{' '}
                      <span className="font-semibold text-foreground">
                        {formatTime(status.session.clock_in)}
                      </span>
                    </p>
                    <p className="text-2xl font-bold text-emerald-600">{elapsedTime}</p>
                  </div>
                )}
                {!status?.clocked_in && !isCeoUser && (
                  <p className="text-sm text-muted-foreground mt-1">
                    {t('attendancePage.workHours')}{' '}
                    {shiftLabel(status?.work_schedule, status?.schedule_options)}
                  </p>
                )}
                {status?.session && (status.session.late_minutes ?? 0) > 0 && (
                  <p className="text-xs text-yellow-700 dark:text-yellow-400 mt-1 flex items-center gap-1">
                    <AlertCircle className="h-3 w-3" />
                    {t('attendancePage.latePenalty', {
                      minutes: status.session.late_minutes ?? 0,
                      amount: formatMnt(
                        (status.session.late_minutes ?? 0) *
                          (status.late_penalty_per_minute ?? 500),
                      ),
                    })}
                  </p>
                )}
              </div>
            </div>

            {/* Office network indicator — also exposes the user's current IP
              so they (or an admin) can ask IT to whitelist the right
              subnet when DHCP keeps shifting the last octet. */}
            <div
              className={`flex items-start gap-3 rounded-lg px-3 py-2 border ${
                canClock
                  ? 'bg-success/10 border-success/30 text-success'
                  : 'bg-warning/10 border-warning/30 text-warning'
              }`}
            >
              {canClock ? (
                <Wifi className="h-4 w-4 flex-shrink-0 mt-0.5" />
              ) : (
                <WifiOff className="h-4 w-4 flex-shrink-0 mt-0.5" />
              )}
              <div className="flex-1 min-w-0 space-y-1">
                <p className="text-xs">
                  {!ipCheckOn
                    ? t('attendancePage.ipCheckDisabled')
                    : onOfficeIp
                      ? t('attendancePage.onOfficeNetwork')
                      : t('attendancePage.offOfficeNetwork')}
                </p>
                {status?.client_ip && status.client_ip !== 'unknown' && (
                  <p className="text-[11px] opacity-80">
                    {t('attendancePage.yourCurrentIp')}{' '}
                    <code className="font-mono">{status.client_ip}</code>
                    {ipCheckOn && !onOfficeIp && (
                      <span className="ml-1">
                        {t('attendancePage.whitelistHintBefore')}{' '}
                        <code className="font-mono">{ipToCidr24(status.client_ip)}</code>{' '}
                        {t('attendancePage.whitelistHintAfter')}
                      </span>
                    )}
                  </p>
                )}
              </div>
            </div>

            {/* Утаснаас ирсэн бүртгэл хийх боломжгүй (admin хасагдана).
              Login болон бусад үйлдэл хэвээр ажиллана. */}
            {isPhone && !unrestricted && (
              <div className="flex items-start gap-3 rounded-lg px-3 py-2 border bg-yellow-500/10 border-yellow-500/30 text-yellow-700 dark:text-yellow-500">
                <Smartphone className="h-4 w-4 flex-shrink-0 mt-0.5" />
                <p className="text-xs">{t('attendancePage.phoneClockInBlocked')}</p>
              </div>
            )}

            {/* Action buttons */}
            <div className="rounded-xl border border-border/60 bg-background/40 p-3 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-sm font-semibold">
                  <FolderOpen className="h-4 w-4 text-primary" />
                  {t('attendancePage.dailyCheckpoints')}
                </div>
                <Badge variant="outline" className="text-xs">
                  {t('attendancePage.activeCount', { count: activeCount })}
                </Badge>
              </div>
              <div className="grid gap-2 sm:grid-cols-3">
                {checkpointTypes.map((type) => {
                  const checkpoint = checkpointMap.get(type);
                  return (
                    <button
                      key={type}
                      type="button"
                      onClick={() => {
                        if (type === 'morning' && status?.clocked_in) return;
                        if (type === 'morning' && isPhone && !unrestricted) return;
                        if (type === 'clock_out' && !status?.clocked_in) return;
                        if (type === 'afternoon' && !afternoonUnlocked) return;
                        handleCheckpoint(type);
                      }}
                      // «Тарах үе» tile нь доорх том товчтой ИЖИЛ урсгал
                      // (`clockOut.start`) — сүлжээ/PGP/явц дутуу бол чимээгүй
                      // хаагдахгүй, дарахад шалтгааныг цонхоор хэлнэ.
                      disabled={
                        type === 'clock_out'
                          ? submittingCheckpoint || clockOut.checking || !status?.clocked_in
                          : submittingCheckpoint ||
                            !canClock ||
                            (type === 'morning' && (!!status?.clocked_in || (isPhone && !unrestricted))) ||
                            (type === 'afternoon' && (!status?.clocked_in || !afternoonUnlocked))
                      }
                      className={cn(
                        'rounded-lg border px-3 py-2 text-left transition-colors',
                        checkpoint
                          ? 'border-emerald-500/30 bg-emerald-500/10'
                          : 'border-border bg-background/40 hover:border-primary/40',
                      )}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-medium">{t(CHECKPOINT_LABEL_KEYS[type])}</span>
                        {submittingType === type ? (
                          <RefreshCw className="h-4 w-4 animate-spin text-primary" />
                        ) : (
                          checkpoint && <CheckCircle2 className="h-4 w-4 text-success" />
                        )}
                      </div>
                      <p className="mt-1 truncate text-xs text-muted-foreground">
                        {checkpoint
                          ? checkpointPickNames(checkpoint).join(', ')
                          : type === 'afternoon'
                            ? afternoonUnlocked
                              ? t('attendancePage.confirmProjects')
                              : t('attendancePage.opensAfterTwo')
                            : t('attendancePage.pending')}
                      </p>
                    </button>
                  );
                })}
              </div>
              <p
                className="truncate text-xs text-muted-foreground"
                title={activeProjectNames.join(', ')}
              >
                {t('attendancePage.currentActive')}{' '}
                {activeProjectNames.length > 0
                  ? activeProjectNames.join(', ')
                  : t('attendancePage.notSelected')}
              </p>
            </div>

            <div className="flex gap-3">
              {!status?.clocked_in && clockedOutToday && !blockedOpenSession ? (
                // Өнөөдөр аль хэдийн гарсан — дахин орох нь ХОЁРДОГЧ үйлдэл,
                // баталгаажуулалттай (андуурч дарвал маргааш түгжигдэнэ).
                <Button
                  variant="outline"
                  onClick={() => void handleReentry()}
                  disabled={submittingCheckpoint || !canClock || (isPhone && !unrestricted)}
                  className="flex-1 h-12 text-base gap-2"
                  data-testid="attendance-reentry"
                >
                  {submittingCheckpoint ? (
                    <RefreshCw className="h-4 w-4 animate-spin" />
                  ) : (
                    <LogIn className="h-5 w-5" />
                  )}
                  {t('clockOutFlow.reentryButton')}
                </Button>
              ) : !status?.clocked_in ? (
                <Button
                  onClick={() => handleCheckpoint('morning')}
                  // Хаалттай үед товч ДАРАГДАНА (pgpMissing-тэй ижил заншил):
                  // `handleCheckpoint` тайлбарын цонхыг нээнэ.  Түгжвэл
                  // (ялангуяа төсөлгүй/оффисын сүлжээнд биш үед) хэрэглэгч
                  // шалтгаанаа хэзээ ч мэдэхгүй үлдэнэ.
                  disabled={
                    blockedOpenSession
                      ? false
                      : submittingCheckpoint ||
                        !canClock ||
                        (isPhone && !unrestricted) ||
                        (!unrestricted && projects.length === 0)
                  }
                  className={cn(
                    'flex-1 h-12 text-base gap-2 bg-emerald-600 hover:bg-emerald-700',
                    blockedOpenSession && 'opacity-50 saturate-50 hover:bg-emerald-600',
                  )}
                >
                  {submittingCheckpoint ? (
                    <RefreshCw className="h-4 w-4 animate-spin" />
                  ) : (
                    <LogIn className="h-5 w-5" />
                  )}
                  {t('attendancePage.clockIn')}
                </Button>
              ) : (
                <Button
                  onClick={() => handleCheckpoint('clock_out')}
                  aria-describedby={pgpMissing ? 'attendance-page-pgp-hint' : undefined}
                  // ⚠️ ГАРАХ ТОВЧИЙГ ЯМАР Ч НӨХЦӨЛӨӨР ЧИМЭЭГҮЙ ХААХГҮЙ (2026-10-19).
                  // Явц/PGP/сүлжээ/төслийн жагсаалт — бүгдийг `clockOut.start`
                  // серверээс шинээр шалгаад «Гарах бүртгэл хийгдээгүй байна»
                  // цонхонд шалтгаанаар нь хэлнэ.  Өмнө нь кэшийн хуучирсан
                  // утгаар идэвхгүй болж, дарахад юу ч болдоггүй байсан тул
                  // ажилтан «дарсан» гэж бодоод тардаг байв (прод 2026-10-16).
                  disabled={submittingCheckpoint || clockOut.checking}
                  data-testid="attendance-clock-out"
                  className="flex-1 h-12 text-base gap-2 bg-blue-600 hover:bg-blue-700 text-white"
                >
                  {submittingCheckpoint || clockOut.checking ? (
                    <RefreshCw className="h-4 w-4 animate-spin" />
                  ) : (
                    <LogOut className="h-5 w-5" />
                  )}
                  {t('attendancePage.clockOut')}
                </Button>
              )}
            </div>
            {/* Өмнөх өдрийн хаагдаагүй бүртгэл — товчны яг доор шалтгааныг
                хэлнэ (цонх нь зөвхөн дарсан үед гарна). */}
            {!status?.clocked_in && blockedOpenSession && (
              <p className="mt-2 flex items-start gap-1.5 text-xs text-destructive">
                <AlertCircle className="h-3.5 w-3.5 flex-shrink-0 mt-0.5" />
                {t('attendancePage.blockedHint', { date: blockedOpenSession.date })}
              </p>
            )}
            {/* Гарахын өмнө өнөөдөр ажлын явц (task хувь) оруулсан байх шаардлага. */}
            {status?.clocked_in &&
              !unrestricted &&
              status?.progress_logged_today === false && (
                <p className="mt-2 flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-400">
                  <AlertCircle className="h-3.5 w-3.5 flex-shrink-0 mt-0.5" />
                  {t('attendancePage.logProgressBeforeClockOut')}
                </p>
              )}
            {/* Гарахын өмнө хөгжлийн төлөвлөгөө бөглөсөн байх шаардлага. */}
            {pgpMissing && (
              <p
                id="attendance-page-pgp-hint"
                className="mt-2 flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-400"
              >
                <AlertCircle className="h-3.5 w-3.5 flex-shrink-0 mt-0.5" />
                {t('attendancePage.fillPgpBeforeClockOut')}
              </p>
            )}
          </CardContent>
        </Card>

        {/* Цагийн хуваарийн сонголт — энд сонгосон шифтээр хоцролт тооцогдоно */}
        <Card
          id="sec-attendance-schedule"
          className="lg:col-span-5 border-border bg-card/60 backdrop-blur scroll-mt-24"
        >
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Clock className="h-4 w-4 text-primary" />
              {t('attendancePage.myWorkSchedule')}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {/* «{огноо}-нээс таны ажил … болно» сануулга 2026-09-17-нд эзний
                хүсэлтээр ХАСАГДСАН (гурван газраас: энд, виджет, popup). */}
            {status?.summer_forced && !status?.schedule_locked && (
              <div className="flex items-start gap-2 text-[11px] text-muted-foreground bg-muted/40 border border-border rounded-lg px-3 py-2">
                <Sunrise className="h-3.5 w-3.5 text-primary shrink-0 mt-0.5" />
                <span>
                  {t('attendanceShift.summerNote', {
                    label: shiftLabel('early', status?.schedule_options),
                  })}
                </span>
              </div>
            )}
            {status?.schedule_locked ? (
              <ScheduleLockedNotice scheduleLabel={status.schedule_label} />
            ) : (
            <div className="grid gap-3 sm:grid-cols-3">
              {shiftOptions(status?.schedule_options).map((opt) => {
                // ⚠️ СОНГОЛТ (`schedule_selected`) дээр тулгуурлана, БОДИТ
                //    ээлж (`work_schedule`) дээр БИШ — эс бөгөөс зуны үед
                //    бүх хүнд 08:00–17:00 идэвхтэй харагдана.
                const active = selectedShift === opt.key;
                const Icon = opt.icon;
                return (
                  <button
                    key={opt.key}
                    type="button"
                    disabled={savingSchedule}
                    onClick={() => setSchedule(opt.key)}
                    className={cn(
                      'flex items-start gap-3 p-3 rounded-lg border-2 text-left transition-colors disabled:opacity-60',
                      active
                        ? 'border-primary bg-primary/5'
                        : 'border-border hover:border-primary/40 hover:bg-muted/30',
                    )}
                  >
                    <div
                      className={cn(
                        'h-9 w-9 rounded-lg flex items-center justify-center shrink-0',
                        active
                          ? 'bg-primary text-primary-foreground'
                          : 'bg-muted text-muted-foreground',
                      )}
                    >
                      <Icon className="h-4 w-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold tabular-nums">{opt.label}</div>
                      <div className="text-[11px] text-muted-foreground mt-0.5">
                        {t(opt.subKey)}
                      </div>
                    </div>
                    {active && <CheckCircle2 className="h-4 w-4 text-primary shrink-0" />}
                  </button>
                );
              })}
            </div>
            )}
            {!status?.schedule_locked && status?.schedule_effective_from && (
              <p className="text-[11px] text-muted-foreground">
                {t('attendanceShift.effectiveFrom', {
                  date: formatShiftDate(status.schedule_effective_from, lang),
                })}
              </p>
            )}
            <div className="flex items-start gap-2 text-[11px] text-muted-foreground bg-yellow-500/5 border border-yellow-500/20 rounded-lg px-3 py-2">
              <AlertCircle className="h-3.5 w-3.5 text-yellow-600 shrink-0 mt-0.5" />
              <span>
                {t('attendancePage.penaltyNoticeBefore')}{' '}
                <span className="font-semibold text-yellow-700 dark:text-yellow-400">
                  {t('attendancePage.penaltyPerMinute', {
                    amount: formatMnt(status?.late_penalty_per_minute ?? 500),
                  })}{' '}
                </span>
                {t('attendancePage.penaltyNoticeAfter')}
              </span>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ROW 2 — Weekly bar chart (7/12) + Recent session list (5/12).
          The chart and the underlying session log are two views of the
          same data, so pairing them lets the user cross-reference a bar
          with the matching log row at a glance instead of scrolling
          back-and-forth between two full-width cards. */}
      <div className="grid gap-6 lg:grid-cols-12 items-stretch">
        <Card
          id="sec-attendance-weekly"
          className="lg:col-span-7 border-border bg-card/60 backdrop-blur scroll-mt-24"
        >
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2">
              <TrendingUp className="h-5 w-5 text-primary" />
              {t('attendancePage.weeklyHours')}
              {weekSummary && (
                <Badge
                  variant="outline"
                  className="ml-2 bg-primary/10 text-primary border-primary/20 text-xs"
                >
                  {t('attendancePage.hoursDays', {
                    hours: formatHours(weekSummary.total_hours),
                    days: weekSummary.days_present,
                  })}
                </Badge>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-end gap-2 h-36">
              {weekChartData.map((day) => {
                const maxH = 12;
                const barPct = Math.min((day.hours / maxH) * 100, 100);
                const targetPct = (day.target / maxH) * 100;
                const isToday = day.date === status?.today;
                return (
                  <div key={day.date} className="flex-1 flex flex-col items-center gap-1">
                    <span className="text-[10px] text-muted-foreground font-medium">
                      {day.hours > 0 ? `${day.hours}h` : ''}
                    </span>
                    <div className="w-full relative" style={{ height: '100px' }}>
                      {day.target > 0 && (
                        <div
                          className="absolute left-0 right-0 border-t border-dashed border-primary/30"
                          style={{ bottom: `${targetPct * 0.83}%` }}
                        />
                      )}
                      <div
                        className={`absolute bottom-0 left-1 right-1 rounded-t-md transition-all duration-500 ${
                          day.hours === 0
                            ? 'bg-muted/50'
                            : day.hours >= day.target && day.target > 0
                              ? 'bg-emerald-500/70'
                              : day.hours >= 7 && day.target > 0
                                ? 'bg-yellow-500/70'
                                : day.target > 0
                                  ? 'bg-orange-500/70'
                                  : 'bg-muted/50'
                        }`}
                        style={{ height: `${day.hours > 0 ? Math.max(barPct * 0.83, 4) : 4}%` }}
                      />
                    </div>
                    <span
                      className={`text-[10px] font-medium ${isToday ? 'text-primary font-bold' : 'text-muted-foreground'}`}
                    >
                      {day.label}
                    </span>
                  </div>
                );
              })}
            </div>
            <div className="flex items-center gap-4 mt-3 text-[10px] text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <span className="w-3 h-2 rounded-sm bg-emerald-500/70" /> {t('attendancePage.legendNineOrMore')}
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-3 h-2 rounded-sm bg-yellow-500/70" /> {t('attendancePage.legendSevenToNine')}
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-3 h-2 rounded-sm bg-orange-500/70" /> {t('attendancePage.legendLessThanSeven')}
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-3 h-2 border-t border-dashed border-primary/50" /> {t('attendancePage.legendTarget')}
              </span>
            </div>
          </CardContent>
        </Card>

        {/* Recent session log — sits next to the weekly chart so the
          user can cross-reference a bar with its underlying clock-in
          / clock-out times.  Capped at ~10 rows tall and scrolls
          inside the card so big history dumps don't blow the layout. */}
        <Card
          id="sec-attendance-recent"
          className="lg:col-span-5 border-border bg-card/60 backdrop-blur flex flex-col scroll-mt-24"
        >
          <CardHeader className="pb-3 flex-shrink-0">
            <CardTitle className="flex items-center gap-2">
              <CalendarDays className="h-5 w-5 text-primary" />
              {t('attendancePage.recentSessions')}
            </CardTitle>
          </CardHeader>
          <CardContent className="flex-1 min-h-0">
            {sessions.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <Clock className="h-8 w-8 mx-auto mb-2 opacity-30" />
                <p className="text-sm">{t('attendancePage.noSessions')}</p>
              </div>
            ) : (
              <div className="space-y-2 max-h-[420px] overflow-y-auto overflow-x-hidden pr-1 -mr-1">
                {sessions.map((s) => (
                  <div
                    key={s.id}
                    className="flex items-center gap-3 p-2.5 rounded-lg border border-border/60 hover:bg-muted/30 transition-colors"
                  >
                    <div
                      className={`h-8 w-8 rounded-full flex items-center justify-center flex-shrink-0 ${
                        s.clock_out ? 'bg-emerald-500/10' : 'bg-yellow-500/10'
                      }`}
                    >
                      {s.clock_out ? (
                        <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                      ) : (
                        <Timer className="h-4 w-4 text-yellow-500" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground truncate">
                        {formatDate(s.date)}
                      </p>
                      <p className="text-xs text-muted-foreground truncate">
                        {formatTime(s.clock_in)}
                        {s.clock_out
                          ? ` → ${formatTime(s.clock_out)}`
                          : ` → ${t('attendancePage.inProgress')}`}
                      </p>
                      {(s.late_minutes ?? 0) > 0 && (
                        <p className="text-[11px] text-yellow-700 dark:text-yellow-400 flex items-center gap-1 mt-0.5">
                          <AlertCircle className="h-3 w-3 flex-shrink-0" />
                          {t('attendancePage.latePenalty', {
                            minutes: s.late_minutes ?? 0,
                            amount: formatMnt(
                              (s.late_minutes ?? 0) * (status?.late_penalty_per_minute ?? 500),
                            ),
                          })}
                        </p>
                      )}
                    </div>
                    <div className="text-right">
                      <p
                        className={`text-sm font-semibold tabular-nums ${
                          s.hours_worked && s.hours_worked >= 8
                            ? 'text-emerald-600'
                            : s.hours_worked && s.hours_worked >= 7
                              ? 'text-yellow-600'
                              : 'text-muted-foreground'
                        }`}
                      >
                        {formatHours(s.hours_worked)}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ROW 2.5 — Миний өдрийн ирцийн хураангуй + админаас ирсэн
          баталгаажуулах хүсэлтэд Зөв/Буруу гэж хариулах.  CEO ирцээс бүрэн
          чөлөөлөгдсөн тул энэ хураангуй/баталгаажуулалтыг харуулахгүй. */}
      {!isCeoUser && <MyDailyAttendanceCard />}

      {/* ROW 3 — Чөлөө + Илүү цаг + Ажлаас гадуурх цаг зэрэгцээд.  Чөлөө ба
          гадуур ажил нь хүсэлт илгээх карт; Илүү цаг нь ЗӨВХӨН МЭДЭЭЛЛИЙН
          карт — хүсэлтийн урсгал нь 0171-д хасагдсан тул сервер тал байхгүй,
          зөвхөн «бичгээр гаргаж Захирлаар зөвшөөрүүл» гэсэн журам харуулна.
          Sidebar-ын мөр ба `/app/overtime` хуудас хасагдсан тул энэ карт нь
          уг журмыг хэрэглэгчид хүргэх ЦОРЫН ГАНЦ цэг. */}
      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3 items-stretch">
        <MyLeavesCard />
        <MyOvertimeCard />
        <MyOutOfOfficeCard />
      </div>
      <AttendanceProjectDialog
        open={dialogType !== null}
        checkpointType={dialogType ?? 'morning'}
        projects={projects}
        initialProjectIds={activeIds}
        repairProjects={repairProjects}
        initialRepairProjectIds={activeRepairIds}
        nonProjectWork={nonProjectWork}
        submitting={submittingCheckpoint}
        onOfficeIp={canClock}
        workSchedule={status?.work_schedule ?? 'standard'}
        onWorkScheduleChange={status?.schedule_locked ? undefined : setSchedule}
        savingSchedule={savingSchedule}
        scheduleLocked={!!status?.schedule_locked}
        selectedShift={selectedShift}
        scheduleEffectiveFrom={status?.schedule_effective_from}
        scheduleChange={scheduleChange}
        scheduleOptions={status?.schedule_options}
        error={error}
        onOpenChange={(open) => {
          if (!open) setDialogType(null);
        }}
        onSubmit={(projectIds, repairIds, nonProject) =>
          submitCheckpoint(projectIds, repairIds, undefined, nonProject)
        }
      />
      <ClockOutBlockedDialog
        blocks={clockOut.blocks}
        onClose={clockOut.dismiss}
        onRetry={() => void clockOut.start()}
      />
      <OpenSessionBlockDialog
        open={blockedDialog !== null}
        session={blockedDialog?.session ?? blockedOpenSession}
        onOpenChange={(open) => {
          if (!open) setBlockedDialog(null);
        }}
      />
    </PageContainer>
  );
}
