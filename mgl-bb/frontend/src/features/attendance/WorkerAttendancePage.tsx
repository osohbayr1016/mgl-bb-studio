/**
 * Цэвэрлэгч (`worker` role) -ийн ирцийн хуудас — УТСАНД зориулсан.
 *
 * Яагаад тусдаа хуудас вэ:  `AttendancePage` нь инженерүүдэд зориулагдсан —
 * төсөл сонгох popup, хоцролтын торгууль, 7 хоногийн график, PGP хаалт,
 * checkpoint зэрэг зүйлс цэвэрлэгчид огт хамаагүй бөгөөд түүний хэрэглэдэг
 * `/projects`, `/pgp/my` API-ууд нь серверийн зүгээс ч хаалттай (403 —
 * backend `lib/workerScope.ts`).  Тиймээс энд ганцхан асуултад хариулна:
 * «Одоо ирсэн үү, эсвэл явж байна уу?»
 *
 * Дизайны зарчим (mobile-first):
 *   • нэг багана, том үсэг, ганц ГОЛ товч — уншихад амархан
 *   • товч бүр min 56px өндөр (pointer-coarse-аас ч том) — оносон дарагдана
 *   • өнгө нь төлөвийг илэрхийлнэ: ногоон = ажил дээрээ, саарал = ороогүй
 *   • ямар ч алдаа ЯАХ ЁСТОЙГ нь монголоор шууд хэлнэ (IP биш, «Wi-Fi»)
 *
 * Хязгаарлалт:  ирцээ ЗӨВХӨН ажлын Wi-Fi-д холбогдсон үедээ бүртгэнэ.  Браузер
 * Wi-Fi-ийн нэрийг уншиж чаддаггүй тул сервер нь хүсэлтийн IP-г `office_ips`
 * цагаан жагсаалттай тулгадаг (`require_office_ip` глобал унтраалттай байсан ч
 * worker-т үргэлж шалгагдана).  Утасны дата дээр байвал IP таарахгүй → хориглоно.
 */
import { useCallback, useEffect, useState } from 'react';
import {
  AlertCircle,
  CalendarDays,
  CheckCircle2,
  Clock,
  LogIn,
  LogOut,
  RefreshCw,
  Timer,
  Wifi,
  WifiOff,
} from 'lucide-react';
import { apiFetch } from '@/shared/api/client';
import { useApiQuery } from '@/shared/api/useApi';
import { useAuth } from '@/shared/context/AuthContext';
import { useLanguage } from '@/shared/i18n';
import { cn } from '@/shared/lib/utils';
import { formatDisplayName } from '@/shared/lib/formatting';
import { Button } from '@/ui/button';
import { Card, CardContent } from '@/ui/card';
import MyLeavesCard from '@/features/attendance/components/MyLeavesCard';
import MyOvertimeCard from '@/features/attendance/components/MyOvertimeCard';
import ClockOutRuleNotice from '@/features/attendance/components/ClockOutRuleNotice';
import OpenSessionBlockDialog from '@/features/attendance/components/OpenSessionBlockDialog';
import ClockOutBlockedDialog from '@/features/attendance/components/ClockOutBlockedDialog';
import {
  hhmmOf,
  resolveClockOutError,
  type ClockOutBlock,
  type ClockOutStatus,
} from '@/features/attendance/clockOutFlow';
import { confirmDialog } from '@/shared/components/ConfirmDialog';
import {
  isOpenSessionBlock,
  openSessionFromError,
  type BlockedOpenSession,
} from '@/features/attendance/openSessionBlock';
import type { AttendanceSession } from '@/shared/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** ISO → "HH:mm" (утасны цагийн бүсээр; ажилтан UB-д байна). */
function hhmm(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });
}

/** Минутыг «8 ц 30 м» болгож харуулна (0 бол «0 м»). */
function humanDuration(totalMinutes: number, t: (k: string) => string): string {
  const mins = Math.max(0, Math.round(totalMinutes));
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h === 0) return `${m} ${t('workerAttendance.minuteShort')}`;
  if (m === 0) return `${h} ${t('workerAttendance.hourShort')}`;
  return `${h} ${t('workerAttendance.hourShort')} ${m} ${t('workerAttendance.minuteShort')}`;
}

function minutesSince(iso: string): number {
  return (Date.now() - new Date(iso).getTime()) / 60_000;
}

/** "yyyy-mm-dd" → "МM сарын DD" маягийн богино шошго. */
function shortDate(date: string, lang: string): string {
  const [, mo, day] = date.split('-');
  if (!mo || !day) return date;
  return lang === 'en' ? `${mo}/${day}` : `${Number(mo)}-р сар ${Number(day)}`;
}

type MyStatus = {
  clocked_in: boolean;
  on_office_ip: boolean;
  require_office_ip?: boolean;
  client_ip?: string;
  session: AttendanceSession | null;
  today: string;
  // Өмнөх өдөр гарах бүртгэлээ хийгээгүй бол ирэх бүртгэл хаалттай.
  blocked_open_session?: BlockedOpenSession | null;
};

type ClockActionResponse = {
  message: string;
  clock_out?: string;
  hours_worked?: number;
};

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function WorkerAttendancePage() {
  const { t, lang } = useLanguage();
  const { user } = useAuth();

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  // Явж буй session дээр «хэдэн цаг болов» — 30 секунд тутам шинэчлэгдэнэ.
  const [elapsedMinutes, setElapsedMinutes] = useState(0);
  // Өмнөх өдрийн хаагдаагүй бүртгэлийн хаалтыг тайлбарлах цонх
  // (`null` = хаалттай).  Цэвэрлэгчид өөрөө засах арга байхгүй тул
  // «менежментийн багт хандана уу» гэдгийг тодорхой хэлэх ёстой.
  const [blockedDialog, setBlockedDialog] = useState<{
    session: BlockedOpenSession | null;
  } | null>(null);
  // «Гарах бүртгэл хийгдээгүй байна» — шалтгаан бүрээр (`clockOutFlow.ts`).
  const [clockOutBlocks, setClockOutBlocks] = useState<ClockOutBlock[] | null>(null);

  const statusQuery = useApiQuery<MyStatus>('/attendance/my-status');
  const sessionsQuery = useApiQuery<{ sessions: AttendanceSession[] }>(
    ['/attendance/my-sessions'],
    '/attendance/my-sessions?limit=14',
  );

  const status = statusQuery.data ?? null;
  const sessions = sessionsQuery.data?.sessions ?? [];

  const refresh = useCallback(async () => {
    await Promise.all([statusQuery.refetch(), sessionsQuery.refetch()]);
  }, [statusQuery, sessionsQuery]);

  const clockedIn = !!status?.clocked_in;
  const session = status?.session ?? null;
  // Өнөөдрийн гарах бүртгэл хийгдсэн — «бүртгээгүй» гэж харуулахгүй.
  const clockedOutToday = !clockedIn && !!session?.clock_out;

  // Ажил дээрээ байгаа үед «хэр удсан»-ыг тогтмол шинэчилнэ.
  useEffect(() => {
    if (!clockedIn || !session) {
      setElapsedMinutes(0);
      return;
    }
    const update = () => setElapsedMinutes(minutesSince(session.clock_in));
    update();
    const id = setInterval(update, 30_000);
    return () => clearInterval(id);
  }, [clockedIn, session]);

  // Worker-т сервер нь `require_office_ip`-г ҮРГЭЛЖ true болгож буцаадаг тул
  // энэ нь бодит байдалдаа «ажлын Wi-Fi дээр байна уу?» гэсэн асуулт.
  const onWorkWifi = !!status?.on_office_ip;
  const canClock = onWorkWifi && !busy;
  // Өчигдөр гарах бүртгэлээ хийгээгүй → ирэх бүртгэл хаалттай (сервер тал
  // `POST /attendance/clock-in`-д мөн шалгана; энэ нь зөвхөн UX).
  const blockedOpenSession = status?.blocked_open_session ?? null;

  const act = async (kind: 'in' | 'out') => {
    if (busy) return;
    // Хаалттай бол сүлжээ рүү явахгүй, шалтгааныг шууд харуулна.
    if (kind === 'in' && blockedOpenSession) {
      setBlockedDialog({ session: blockedOpenSession });
      return;
    }
    // Өнөөдөр аль хэдийн гарсан бол дахин орохыг баталгаажуулна — андуурч
    // дарвал шинэ нээлттэй бүртгэл үүсч маргааш ирэх бүртгэл түгжигдэнэ.
    if (kind === 'in' && clockedOutToday) {
      const ok = await confirmDialog({
        title: t('clockOutFlow.reentryTitle'),
        description: t('clockOutFlow.reentryBody', { time: hhmmOf(session?.clock_out) }),
        confirmText: t('clockOutFlow.reentryButton'),
      });
      if (!ok) return;
    }
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await apiFetch<ClockActionResponse>(
        kind === 'in' ? '/attendance/clock-in' : '/attendance/clock-out',
        // Цэвэрлэгчид төсөл сонгох шаардлагагүй — хоосон биетэй илгээнэ.
        { data: {} },
      );
      setSuccess(
        kind === 'out'
          ? t('clockOutFlow.successHours', {
              time: hhmmOf(res.clock_out) || hhmmOf(new Date().toISOString()),
              hours: humanDuration((res.hours_worked ?? 0) * 60, t),
            })
          : res.message,
      );
      await refresh();
    } catch (e) {
      // Хаагдаагүй бүртгэлийн хаалт — улаан мөр биш, тайлбарын цонх.
      if (isOpenSessionBlock(e)) {
        setBlockedDialog({ session: openSessionFromError(e) });
        await refresh();
      } else if (kind === 'out') {
        // Гарах бүртгэл унасан — шалтгааныг монголоор; хариу алдагдсан ч
        // сервер дээр гарсан бол амжилт (Ирц хуудастай ИЖИЛ дүрэм).
        const r = resolveClockOutError(e);
        if (r.kind === 'inline') {
          setError(t('clockOutFlow.notDone', { reason: r.message }));
        } else if (r.kind === 'block') {
          setClockOutBlocks([r.block]);
        } else {
          const fresh = await statusQuery
            .refetch()
            .then((q) => (q.isError ? null : ((q.data ?? null) as ClockOutStatus | null)))
            .catch(() => null);
          const out = fresh && !fresh.clocked_in ? fresh.session?.clock_out : null;
          if (out) setSuccess(t('clockOutFlow.alreadyOut', { time: hhmmOf(out) }));
          else setClockOutBlocks([fresh && !fresh.clocked_in ? { kind: 'not_clocked_in' } : r.fallback]);
        }
        await refresh();
      } else {
        setError(e instanceof Error ? e.message : t('common.error'));
      }
    } finally {
      setBusy(false);
    }
  };

  if (statusQuery.isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <RefreshCw className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  return (
    // Утсанд нэг багана; том дэлгэц дээр төвд нь тааруулна.
    <div className="mx-auto w-full max-w-md space-y-4 animate-in fade-in duration-500">
      {/* ---- Мэндчилгээ + өнөөдрийн огноо ---- */}
      <div className="px-1">
        <h1 className="text-2xl font-bold leading-tight text-foreground">
          {t('workerAttendance.greeting')}
          {user?.full_name ? `, ${formatDisplayName(user.full_name)}` : ''}
        </h1>
        <p className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground">
          <CalendarDays className="h-4 w-4" />
          {status?.today ?? ''}
        </p>
      </div>

      {/* ---- Ирцийн журмын байнгын анхааруулга ---- */}
      <ClockOutRuleNotice />

      {/* ---- Wi-Fi төлөв — хамгийн чухал мэдээлэл тул хамгийн дээр ---- */}
      <div
        className={cn(
          'flex items-start gap-3 rounded-2xl border px-4 py-3.5',
          onWorkWifi
            ? 'border-emerald-500/30 bg-emerald-500/10'
            : 'border-amber-500/40 bg-amber-500/10',
        )}
      >
        {onWorkWifi ? (
          <Wifi className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" />
        ) : (
          <WifiOff className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
        )}
        <div className="min-w-0 flex-1">
          <p
            className={cn(
              'text-sm font-semibold',
              onWorkWifi ? 'text-emerald-700 dark:text-emerald-400' : 'text-amber-700 dark:text-amber-400',
            )}
          >
            {onWorkWifi ? t('workerAttendance.wifiOk') : t('workerAttendance.wifiMissing')}
          </p>
          {!onWorkWifi && (
            <>
              <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                {t('workerAttendance.wifiHelp')}
              </p>
              {/* Одоогийн IP — ажилтан админд уншиж хэлэхэд л хэрэгтэй
                  (шинэ Wi-Fi-г цагаан жагсаалтад нэмүүлэх). */}
              {status?.client_ip && (
                <p className="mt-1.5 text-micro tabular-nums text-muted-foreground/70">
                  {t('workerAttendance.yourNetwork')}: {status.client_ip}
                </p>
              )}
            </>
          )}
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={() => void refresh()}
          aria-label={t('workerAttendance.recheck')}
          className="shrink-0"
        >
          <RefreshCw className={cn('h-4 w-4', statusQuery.isFetching && 'animate-spin')} />
        </Button>
      </div>

      {/* ---- Алдаа / амжилт ---- */}
      {error && (
        <div className="flex items-start gap-3 rounded-2xl border border-destructive/30 bg-destructive/10 px-4 py-3.5 text-sm text-destructive">
          <AlertCircle className="mt-0.5 h-5 w-5 shrink-0" />
          <span className="flex-1 leading-relaxed">{error}</span>
          <button
            type="button"
            onClick={() => setError(null)}
            aria-label={t('common.close')}
            className="shrink-0 text-destructive/60 hover:text-destructive"
          >
            ✕
          </button>
        </div>
      )}
      {success && (
        <div className="flex items-start gap-3 rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3.5 text-sm text-emerald-700 dark:text-emerald-400">
          <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0" />
          <span className="flex-1 leading-relaxed">{success}</span>
          <button
            type="button"
            onClick={() => setSuccess(null)}
            aria-label={t('common.close')}
            className="shrink-0 text-emerald-600/60 hover:text-emerald-700"
          >
            ✕
          </button>
        </div>
      )}

      {/* ---- ГОЛ КАРТ — төлөв + ганц том товч ---- */}
      <Card className="overflow-hidden border-border bg-card/70 backdrop-blur">
        <div
          className={cn(
            'h-1.5',
            clockedIn
              ? 'bg-gradient-to-r from-emerald-500 via-emerald-400 to-emerald-600'
              : 'bg-gradient-to-r from-primary via-primary/60 to-transparent',
          )}
        />
        <CardContent className="space-y-5 p-5">
          <div className="flex items-center gap-4">
            <div
              className={cn(
                'flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl border-2',
                clockedIn
                  ? 'border-emerald-500/30 bg-emerald-500/10'
                  : clockedOutToday
                    ? 'border-success/30 bg-success/10'
                    : 'border-border bg-muted',
              )}
            >
              {clockedIn ? (
                <Timer className="h-7 w-7 text-emerald-500" />
              ) : clockedOutToday ? (
                <CheckCircle2 className="h-7 w-7 text-success" />
              ) : (
                <Clock className="h-7 w-7 text-muted-foreground" />
              )}
            </div>
            <div className="min-w-0">
              <p
                className={cn('text-sm', clockedOutToday ? 'font-medium text-success' : 'text-muted-foreground')}
                data-testid="worker-attendance-state"
              >
                {clockedIn
                  ? t('workerAttendance.atWork')
                  : clockedOutToday
                    ? t('clockOutFlow.doneSummary', {
                        in: hhmmOf(session?.clock_in),
                        out: hhmmOf(session?.clock_out),
                      })
                    : t('workerAttendance.notYet')}
              </p>
              <p className="mt-0.5 text-3xl font-bold leading-none tabular-nums text-foreground">
                {clockedIn ? humanDuration(elapsedMinutes, t) : '—'}
              </p>
              {clockedIn && session && (
                <p className="mt-1.5 text-sm text-muted-foreground">
                  {t('workerAttendance.since')} {hhmm(session.clock_in)}
                </p>
              )}
            </div>
          </div>

          {/* Ганц ГОЛ товч — 64px өндөр, дэлгэцийн бүтэн өргөн. */}
          {clockedIn ? (
            <Button
              type="button"
              onClick={() => void act('out')}
              disabled={!canClock}
              className="h-16 w-full rounded-2xl text-lg font-semibold"
              variant="destructive"
            >
              {busy ? (
                <RefreshCw className="h-6 w-6 animate-spin" />
              ) : (
                <LogOut className="h-6 w-6" />
              )}
              {t('workerAttendance.clockOut')}
            </Button>
          ) : (
            <Button
              type="button"
              onClick={() => void act('in')}
              // Хаалттай үед ч ДАРАГДАНА — `act` нь тайлбарын цонхыг
              // нээнэ.  Түгжвэл Wi-Fi-гүй үеийнхтэй ялгагдахгүй болно.
              disabled={blockedOpenSession ? false : !canClock}
              className={cn(
                'h-16 w-full rounded-2xl bg-emerald-600 text-lg font-semibold text-white hover:bg-emerald-600/90',
                blockedOpenSession && 'opacity-50 saturate-50 hover:bg-emerald-600',
              )}
            >
              {busy ? (
                <RefreshCw className="h-6 w-6 animate-spin" />
              ) : (
                <LogIn className="h-6 w-6" />
              )}
              {clockedOutToday && !blockedOpenSession
                ? t('clockOutFlow.reentryButton')
                : t('workerAttendance.clockIn')}
            </Button>
          )}

          {/* Хаалт нь Wi-Fi-гаас ЧУХАЛ — эхэнд, улаанаар. */}
          {!clockedIn && blockedOpenSession && (
            <p className="text-center text-sm leading-relaxed text-destructive">
              {t('attendancePage.blockedHint', { date: blockedOpenSession.date })}
            </p>
          )}
          {!onWorkWifi && !blockedOpenSession && (
            <p className="text-center text-sm leading-relaxed text-muted-foreground">
              {t('workerAttendance.buttonLockedHint')}
            </p>
          )}

          {/* Өнөөдрийн товч дүн — ирсэн / явсан / ажилласан */}
          <div className="grid grid-cols-3 gap-2 border-t border-border pt-4">
            <SummaryTile label={t('workerAttendance.cameIn')} value={hhmm(session?.clock_in)} />
            <SummaryTile label={t('workerAttendance.wentOut')} value={hhmm(session?.clock_out)} />
            <SummaryTile
              label={t('workerAttendance.worked')}
              value={
                session?.hours_worked != null
                  ? humanDuration(session.hours_worked * 60, t)
                  : clockedIn
                    ? humanDuration(elapsedMinutes, t)
                    : '—'
              }
            />
          </div>
        </CardContent>
      </Card>

      {/* ---- Сүүлийн өдрүүд ---- */}
      <Card className="border-border bg-card/70 backdrop-blur">
        <CardContent className="p-5">
          <h2 className="mb-3 text-base font-semibold text-foreground">
            {t('workerAttendance.historyTitle')}
          </h2>
          {sessions.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              {t('workerAttendance.historyEmpty')}
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {sessions.map((s) => (
                <li key={s.id} className="flex items-center gap-3 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-foreground">
                      {shortDate(s.date, lang)}
                    </p>
                    <p className="mt-0.5 text-sm tabular-nums text-muted-foreground">
                      {hhmm(s.clock_in)} – {s.clock_out ? hhmm(s.clock_out) : '…'}
                    </p>
                  </div>
                  <span className="shrink-0 text-sm font-semibold tabular-nums text-foreground">
                    {s.hours_worked != null ? humanDuration(s.hours_worked * 60, t) : '—'}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* ---- Чөлөө — одоо байгаа картыг дахин ашиглана.  Prop-гүй бөгөөд
              зөвхөн /leaves рүү ханддаг тул worker-ийн серверийн цагаан
              жагсаалтад багтана.
              Илүү цаг — зөвхөн мэдээллийн карт, API дуудлагагүй тул
              workerScope-той огт зөрчилдөхгүй. ---- */}
      <MyLeavesCard />
      <MyOvertimeCard />

      <OpenSessionBlockDialog
        open={blockedDialog !== null}
        session={blockedDialog?.session ?? blockedOpenSession}
        onOpenChange={(open) => {
          if (!open) setBlockedDialog(null);
        }}
      />
      <ClockOutBlockedDialog
        blocks={clockOutBlocks}
        onClose={() => setClockOutBlocks(null)}
        onRetry={() => void act('out')}
      />
    </div>
  );
}

function SummaryTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-muted/50 px-2 py-2.5 text-center">
      <p className="text-micro text-muted-foreground">{label}</p>
      <p className="mt-1 text-sm font-semibold tabular-nums text-foreground">{value}</p>
    </div>
  );
}
