import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useApiQuery } from '@/shared/api/useApi';
import { apiFetch } from '@/shared/api/client';
import { useAuth } from '@/shared/context/AuthContext';
import { useLanguage } from '@/shared/i18n';
import type {
  DailyAttendanceGridResponse,
  AttendanceConfirmation,
} from '@/shared/types';
import { Card, CardHeader, CardTitle, CardContent } from '@/ui/card';
import { Button } from '@/ui/button';
import { Badge } from '@/ui/badge';
import { Input } from '@/ui/input';
import { Textarea } from '@/ui/textarea';
import { toast } from '@/shared/components/Toast';
import { todayUB } from '@/shared/lib/time';
import { cn } from '@/shared/lib/utils';
import { MONTH_CONFIRM_DUE_KEY, monthLabel } from '@/features/attendance/monthConfirm';
import DayLeaveChips from '@/features/attendance/components/DayLeaveChips';
import { hasWorkActivity, isExpectedWorkDay } from '@/features/attendance/admin/utils/totals';
import { CalendarRange, CheckCircle2, AlertTriangle, Loader2, Sun } from 'lucide-react';

/** Хамгийн эрт батлагдах сар — backend-ийн EARLIEST_MONTH-тэй ижил. */
const EARLIEST_MONTH = '2026-06';

/**
 * Дуусаагүй ч батлахыг ГАРААР нээсэн сарууд — backend-ийн
 * `attendanceConfirmations.ts` дахь OPEN_UNFINISHED_MONTHS-тэй ИЖИЛ байх ёстой.
 * 2026-08: цалин сар дуусахаас өмнө бодогдож эхэлсэн тул урьдчилж батална.
 */
const OPEN_UNFINISHED_MONTHS = new Set(['2026-08']);

function pad(n: number): string {
  return String(n).padStart(2, '0');
}
/**
 * Аравтын бутархай цаг — админ Тайлан таб болон цалингийн XLSX-тэй ЯГ ижил
 * (6400 мин → "106.67").  Энэ картад ЗӨВХӨН туслах (тайлбар) утга.
 */
function hoursDec(min: number | null | undefined): string {
  if (min == null || min <= 0) return '—';
  return (Math.round((min / 60) * 100) / 100).toFixed(2);
}

/**
 * Ажилтанд харагдах ҮНДСЭН цаг — нэгжтэй «цаг, минут» (478 мин → «7ц 58м»).
 *
 * ⚠️ Хоёр бичиглэл хоёулаа буруу уншигдаж байсан: 2026-08 хүртэл «106:40»-ийг
 *    106.40 гэж, 2026-08-26-аас хойш «7.97»-г «7 цаг 97 мин» гэж уншиж
 *    «хоцролтыг 60-аас биш 100-аас хассан» гэсэн гомдол ирсэн (2026-10-01,
 *    ажилтан 2 минут хоцорсон өдрөө «7:58 байх ёстой» гэсэн — систем 478 мин,
 *    яг 7ц 58м).  Нэгжтэй бичвэрийг аль ч талаар андуурах аргагүй.  Тооцоо
 *    өөрчлөгдөөгүй, зөвхөн харагдац.
 */
function useHoursMinutes() {
  const { t } = useLanguage();
  return (min: number | null | undefined): string => {
    if (min == null || min <= 0) return '—';
    const total = Math.round(min);
    const h = Math.floor(total / 60);
    const m = total % 60;
    if (h === 0) return t('myAttendance.durMinutes', { m });
    if (m === 0) return t('myAttendance.durHours', { h });
    return t('myAttendance.durHoursMinutes', { h, m });
  };
}

/** Админ Тайлан grid-тэй ижил "M/D/YYYY" огноо. */
function formatGridDate(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${parseInt(m!, 10)}/${parseInt(d!, 10)}/${y}`;
}

/** Одоогийн UB сар 'YYYY-MM' (naive new Date() биш, UB timezone-оор). */
function ubMonthNow(): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ulaanbaatar',
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(new Date());
  const y = parts.find((p) => p.type === 'year')?.value ?? '2026';
  const m = parts.find((p) => p.type === 'month')?.value ?? '01';
  return `${y}-${m}`;
}
/** `?month=` параметрийн хэлбэр 'YYYY-MM'. */
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

/**
 * Ажилтны ӨӨРИЙН сарын ирц — Тайлан (өдрийн хүснэгт) + Хураангуй (нийлбэр).
 * Ажилтан сар бүр ирцээ ӨӨРӨӨ батална: "Батлах" эсвэл "Зөрчилтэй" (шалтгаантай).
 * 2026-06-аас одоогийн сар хүртэл сонгогдоно (default = одоогийн сар); батлах нь
 * зөвхөн ДУУССАН сард.  Backend self-scope хийдэг тул зөвхөн өөрийн мөр харагдана.
 */
export default function MyDailyAttendanceCard() {
  const { t, lang } = useLanguage();
  const hm = useHoursMinutes();
  /** «7ц 58м (7.97)» — tooltip-д: цалингийн хүснэгтийн аравтын утгатай тулгахад. */
  const hmDec = (min: number | null | undefined) =>
    min == null || min <= 0 ? '—' : `${hm(min)} (${hoursDec(min)})`;
  const { user } = useAuth();
  const myId = user?.id;
  const queryClient = useQueryClient();

  // Явагдаж буй сар — DEFAULT (эзэн 2026-10-19: «default нь өмнөх сар биш одоогийн
  // сар»).  Батлах үйлдэл доор зөвхөн дууссан сард гарна (сервер ч мөн
  // 'Дуусаагүй сарыг батлах боломжгүй' гэж хориглодог).
  const currentMonth = useMemo(() => {
    const cur = ubMonthNow();
    return cur < EARLIEST_MONTH ? EARLIEST_MONTH : cur;
  }, []);
  // Сонгосон сар = `?month=YYYY-MM` (байхгүй/буруу бол одоогийн сар).  Сарын
  // эхний «ирцээ батал» цонх (`MonthConfirmPrompt`) өмнөх сарыг энэ параметрээр
  // нээдэг — карт аль хэдийн нээлттэй байсан ч (Ирц хуудсан дээр ирсэн бүртгэл
  // хийсний дараа) батлах ёстой сар руу шилжинэ.
  const [searchParams, setSearchParams] = useSearchParams();
  const monthParam = searchParams.get('month');
  const month =
    monthParam && MONTH_RE.test(monthParam) && monthParam >= EARLIEST_MONTH && monthParam <= currentMonth
      ? monthParam
      : currentMonth;
  const setMonth = (next: string) =>
    setSearchParams(
      (prev) => {
        const params = new URLSearchParams(prev);
        if (next === currentMonth) params.delete('month');
        else params.set('month', next);
        return params;
      },
      { replace: true },
    );
  const isCompletedMonth = month < ubMonthNow();
  /** Явагдаж буй сар боловч гараар нээгдсэн (цалингийн эрт тооцоо). */
  const isEarlyOpenMonth = month === ubMonthNow() && OPEN_UNFINISHED_MONTHS.has(month);
  const canApproveMonth = isCompletedMonth || isEarlyOpenMonth;

  const { from, to } = useMemo(() => {
    const [y, m] = month.split('-').map(Number);
    const lastDay = new Date(y!, m!, 0).getDate();
    const monthEnd = `${month}-${pad(lastDay)}`;
    // Явагдаж буй сард ирээдүйн өдрүүд "тас" мэт харагдахгүйн тулд өнөөдрөөр таслана.
    const today = todayUB();
    return { from: `${month}-01`, to: monthEnd > today ? today : monthEnd };
  }, [month]);

  // Зөвхөн ӨӨРИЙН ирц.  `user_id` — одоогийн backend эрхтэй хэрэглэгчийг ч
  // хүлээн авдаг; `mine=1` — ирээдүйн backend дээр эрхээс үл хамааран албадна.
  const gridQuery = useApiQuery<DailyAttendanceGridResponse>(
    ['/attendance/daily-grid', 'mine', myId, from, to],
    `/attendance/daily-grid?from=${from}&to=${to}&mine=1&user_id=${myId ?? ''}`,
    { retry: false, enabled: myId != null },
  );
  const mineQuery = useApiQuery<{ confirmations: AttendanceConfirmation[] }>(
    ['/attendance-confirmations/mine'],
    '/attendance-confirmations/mine',
    { retry: false },
  );

  const rows = gridQuery.data?.rows ?? [];

  // Сонгосон сарын батлалт (date === `${month}-01`).
  const monthApproval = useMemo(() => {
    const key = `${month}-01`;
    return (mineQuery.data?.confirmations ?? []).find((cf) => cf.date === key) ?? null;
  }, [mineQuery.data, month]);

  // Client-side Хураангуй — grid мөрүүдийг нэгтгэнэ (сервер summary-тэй ижил
  // формул тул мөр тутмынхтай тохирно).  ⚠️ Мөр бүр ажлын өдөр БИШ: ажилтан
  // Бямба/Ням эсвэл баярын өдөр ажилласан бол сервер нэмэлт мөр үүсгэдэг.
  // "Ажлын өдөр" = амралт (Бя/Ня) ч, баяр ч БИШ өдөр (`isExpectedWorkDay`);
  // амралтаар ажилласан өдөр `extraDays`-д тусдаа, цаг нь л нийт дүнд орно.
  // Чөлөө авсан өдрийг ажлын өдрөөс ХАСАХГҮЙ (сервер summary-ийн workingDays-тэй ижил).
  const summary = useMemo(() => {
    const s = {
      workDays: 0,
      presentDays: 0,
      extraDays: 0,
      worked: 0,
      late: 0,
      leave: 0,
      leaveDays: 0,
      outOfOffice: 0,
      absentDays: 0,
      workMin: 0,
      totalMin: 0,
    };
    for (const r of rows) {
      if (isExpectedWorkDay(r)) {
        s.workDays += 1;
        if (r.actual_in != null) s.presentDays += 1;
      } else if (hasWorkActivity(r)) {
        s.extraDays += 1;
      }
      if (r.is_on_leave) s.leaveDays += 1;
      if (r.is_absent) s.absentDays += 1;
      // "Ажилласан цаг" = бодит ажилласан + цалинтай чөлөө + гадуур ажил.
      s.worked += r.worked_effective_minutes ?? 0;
      s.late += r.late_minutes ?? 0;
      s.leave += r.leave_minutes ?? 0;
      s.outOfOffice += r.out_of_office_minutes ?? 0;
      s.workMin += r.work_minutes ?? 0;
      s.totalMin += r.total_minutes ?? 0;
    }
    return s;
  }, [rows]);

  const [reporting, setReporting] = useState(false);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async (status: 'confirmed' | 'disputed') => {
    setSaving(true);
    try {
      const data: Record<string, unknown> = { month, status };
      if (status === 'disputed') data.note = note.trim();
      await apiFetch('/attendance-confirmations/approve-month', { data });
      setReporting(false);
      setNote('');
      mineQuery.refetch();
      // Сарын эхний «ирцээ батал» цонх (`MonthConfirmPrompt`) шууд алга болно.
      void queryClient.invalidateQueries({ queryKey: MONTH_CONFIRM_DUE_KEY });
      toast.success(
        status === 'confirmed' ? t('myAttendance.approvedToast') : t('myAttendance.disputedToast'),
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('common.error'));
    } finally {
      setSaving(false);
    }
  };

  // Хариулсны ДАРАА админ ирц/чөлөө засвал (0403) — хуучин хариулт хүчингүй, дахин шалгаж батлана.
  const changedAfterAnswer = monthApproval?.changed_since_answer === true;
  const monthStatusBadge = changedAfterAnswer ? (
      <Badge
        variant="outline"
        className="text-micro bg-warning/10 text-warning border-warning/30"
        title={t('myAttendance.changedHint')}
        data-testid="month-changed-badge"
      >
        <AlertTriangle className="h-3 w-3 mr-1" />
        {t('myAttendance.changedBadge')}
      </Badge>
    ) : monthApproval?.status === 'confirmed' ? (
      <Badge
        variant="outline"
        className="text-micro bg-success/10 text-success border-success/30"
      >
        <CheckCircle2 className="h-3 w-3 mr-1" />
        {t('myAttendance.approvedBadge')}
      </Badge>
    ) : monthApproval?.status === 'disputed' ? (
      <Badge
        variant="outline"
        className="text-micro bg-danger/10 text-danger border-danger/30"
        title={monthApproval.response_note ?? ''}
      >
        <AlertTriangle className="h-3 w-3 mr-1" />
        {t('myAttendance.disputedBadge')}
      </Badge>
    ) : (
      <Badge variant="outline" className="text-micro bg-muted text-muted-foreground">
        {t('myAttendance.notApproved')}
      </Badge>
    );

  // `dec` — цалингийн хүснэгт (аравтын бутархай цаг)-тэй тулгах туслах мөр.
  // `note` — «= … цаг» хүрээгүй, шууд харуулах тэмдэглэл.
  const stats: Array<{ label: string; value: string; dec?: string; note?: string }> = [
    {
      label: t('myAttendance.metricDays'),
      value: `${summary.presentDays} / ${summary.workDays}`,
      note:
        summary.extraDays > 0
          ? t('myAttendance.metricDaysExtra', { count: summary.extraDays })
          : undefined,
    },
    {
      label: t('myAttendance.metricWorked'),
      value: hm(summary.worked),
      dec: summary.worked > 0 ? hoursDec(summary.worked) : undefined,
    },
    {
      label: t('myAttendance.metricLate'),
      value: summary.late > 0 ? t('myAttendance.durMinutes', { m: summary.late }) : '—',
    },
    {
      label: t('myAttendance.metricLeave'),
      value: summary.leave > 0 ? hm(summary.leave) : '—',
      dec: summary.leave > 0 ? hoursDec(summary.leave) : undefined,
    },
  ];

  const loading = myId == null || gridQuery.isLoading;
  // Батлах ёстой сар хариултгүй байна — карт руу сарын эхний цонхоор ирсэн
  // хүнд батлах товч ХАМГИЙН ДООР гэдгийг дээд талд нь хэлнэ.
  const awaitingAnswer =
    canApproveMonth &&
    mineQuery.isSuccess &&
    ((monthApproval?.status !== 'confirmed' && monthApproval?.status !== 'disputed') || changedAfterAnswer);

  return (
    <Card
      id="sec-attendance-monthly"
      className="border-border bg-card/60 backdrop-blur scroll-mt-24"
    >
      <CardHeader className="flex flex-row items-center justify-between gap-2 pb-3">
        <CardTitle className="flex flex-wrap items-center gap-2 text-base">
          <CalendarRange className="h-4 w-4 text-primary" />
          {t('myAttendance.title')}
          {canApproveMonth && monthStatusBadge}
        </CardTitle>
        <Input
          type="month"
          value={month}
          min={EARLIEST_MONTH}
          max={currentMonth}
          onChange={(e) => setMonth(e.target.value || currentMonth)}
          className="h-8 w-auto text-sm"
        />
      </CardHeader>
      <CardContent className="p-0">
        {awaitingAnswer && !loading && (
          <div className="mx-3 mb-3 flex gap-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-foreground">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
            <p className="leading-relaxed">
              {t('myAttendance.pendingCallout', { month: monthLabel(month, lang) })}
            </p>
          </div>
        )}
        {loading ? (
          <div className="flex justify-center py-10">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          </div>
        ) : (
          <>
            {/* Сарын хураангуй (client-side нэгтгэл) */}
            <div className="border-b border-border/60 px-3 pb-3 pt-1">
              <p className="mb-2 text-xs font-medium text-muted-foreground">
                {t('myAttendance.summaryTitle')}
              </p>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
                {stats.map((s) => (
                  <div
                    key={s.label}
                    className="rounded-lg border border-border/60 bg-background/40 px-3 py-2"
                  >
                    <div className="text-micro text-muted-foreground">{s.label}</div>
                    <div className="text-sm font-semibold tabular-nums">{s.value}</div>
                    {s.dec && (
                      <div className="text-micro tabular-nums text-muted-foreground">
                        {t('myAttendance.decimalEq', { hours: s.dec })}
                      </div>
                    )}
                    {s.note && (
                      <div
                        className="text-micro text-muted-foreground"
                        title={t('attendanceAdminPage.extraDaysHint')}
                      >
                        {s.note}
                      </div>
                    )}
                  </div>
                ))}
              </div>
              <p className="mt-2 text-micro leading-relaxed text-muted-foreground">
                {t('myAttendance.hoursFormatNote')}
              </p>
            </div>

            {/* Тайлан — админ Тайлан grid-тэй ижил XLSX-загварын өдрийн хүснэгт */}
            {rows.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                {t('myAttendance.empty')}
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm border-separate border-spacing-0">
                  <thead className="bg-muted/40">
                    <tr className="text-xs">
                      <th className="px-3 py-2 font-medium text-left border-b border-border w-24 whitespace-nowrap">
                        {t('myAttendance.colDate')}
                      </th>
                      <th className="px-2 py-2 font-medium text-center border-b border-border w-20">
                        {t('attendanceAdminPage.colSchedule')}
                      </th>
                      <th className="px-2 py-2 font-medium text-center border-b border-border w-16">
                        {t('attendanceAdminPage.colPlannedIn')}
                      </th>
                      <th className="px-2 py-2 font-medium text-center border-b border-border w-16">
                        {t('attendanceAdminPage.colPlannedOut')}
                      </th>
                      <th className="px-2 py-2 font-medium text-center border-b border-border w-16">
                        {t('attendanceAdminPage.colActualIn')}
                      </th>
                      <th className="px-2 py-2 font-medium text-center border-b border-border w-16">
                        {t('attendanceAdminPage.colActualOut')}
                      </th>
                      <th className="px-2 py-2 font-medium text-center border-b border-border w-16 bg-danger/70 text-danger">
                        {t('attendanceAdminPage.colLateShort')}
                      </th>
                      <th className="px-2 py-2 font-medium text-center border-b border-border w-28">
                        {t('attendanceAdminPage.colLeave')}
                      </th>
                      <th className="px-2 py-2 font-medium text-center border-b border-border w-16">
                        {t('attendanceAdminPage.colLeaveHours')}
                      </th>
                      <th className="px-2 py-2 font-medium text-center border-b border-border w-16">
                        {t('attendanceAdminPage.colOutOfOfficeHours')}
                      </th>
                      <th className="px-2 py-2 font-medium text-center border-b border-border w-14">
                        {t('attendanceAdminPage.colAbsent')}
                      </th>
                      <th className="px-2 py-2 font-medium text-center border-b border-border w-20">
                        {t('attendanceAdminPage.colWorkHours')}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => {
                      const isToday = r.date === todayUB();
                      return (
                        <tr
                          key={r.date}
                          className={cn(
                            'hover:bg-muted/30 transition-colors',
                            r.is_absent && 'bg-destructive/5',
                            r.is_on_leave && 'bg-info/60',
                            r.is_holiday && 'bg-danger/50',
                            isToday && 'bg-success/40',
                          )}
                        >
                          <td className="px-3 py-1.5 text-xs tabular-nums whitespace-nowrap border-b border-border/40">
                            {formatGridDate(r.date)}
                          </td>
                          <td className="px-2 py-1.5 text-center text-xs font-mono border-b border-border/40">
                            {r.schedule_label}
                          </td>
                          <td className="px-2 py-1.5 text-center text-xs tabular-nums text-muted-foreground border-b border-border/40">
                            {r.planned_in}
                          </td>
                          <td className="px-2 py-1.5 text-center text-xs tabular-nums text-muted-foreground border-b border-border/40">
                            {r.planned_out}
                          </td>
                          <td
                            className={cn(
                              'px-2 py-1.5 text-center text-xs tabular-nums border-b border-border/40 font-medium',
                              r.late_minutes > 0 && 'text-danger',
                            )}
                          >
                            {r.actual_in ?? <span className="text-muted-foreground">—</span>}
                          </td>
                          <td className="px-2 py-1.5 text-center text-xs tabular-nums border-b border-border/40 font-medium">
                            {r.actual_out ?? <span className="text-muted-foreground">—</span>}
                          </td>
                          <td
                            className={cn(
                              'px-2 py-1.5 text-center text-xs tabular-nums border-b border-border/40',
                              r.late_minutes > 0
                                ? 'bg-danger/10 text-danger font-semibold'
                                : 'text-muted-foreground',
                            )}
                          >
                            {r.late_minutes > 0 ? r.late_minutes : ''}
                          </td>
                          <td className="px-2 py-1.5 text-center border-b border-border/40">
                            {r.is_holiday ? (
                              <span className="inline-flex items-center gap-1 rounded border border-danger/30 bg-danger/10 px-1.5 py-0.5 text-micro text-danger">
                                <Sun className="h-3 w-3" />
                                {t('myAttendance.holiday')}
                              </span>
                            ) : (
                              <DayLeaveChips row={r} chipClassName="text-micro" />
                            )}
                          </td>
                          <td
                            className={cn(
                              'px-2 py-1.5 text-center text-xs tabular-nums border-b border-border/40',
                              r.leave_minutes > 0
                                ? 'text-info'
                                : 'text-muted-foreground',
                            )}
                          >
                            <span title={r.leave_minutes > 0 ? hoursDec(r.leave_minutes) : undefined}>
                              {r.leave_minutes > 0 ? hm(r.leave_minutes) : ''}
                            </span>
                          </td>
                          <td
                            className={cn(
                              'px-2 py-1.5 text-center text-xs tabular-nums border-b border-border/40',
                              r.out_of_office_minutes > 0
                                ? 'text-success font-medium'
                                : 'text-muted-foreground',
                            )}
                          >
                            <span
                              title={r.out_of_office_minutes > 0 ? hoursDec(r.out_of_office_minutes) : undefined}
                            >
                              {r.out_of_office_minutes > 0 ? hm(r.out_of_office_minutes) : ''}
                            </span>
                          </td>
                          <td className="px-2 py-1.5 text-center text-micro border-b border-border/40">
                            {r.is_absent ? (
                              <span className="font-semibold text-destructive">
                                {t('attendanceAdminPage.absentTrue')}
                              </span>
                            ) : (
                              ''
                            )}
                          </td>
                          <td className="px-2 py-1.5 text-center text-xs tabular-nums font-medium border-b border-border/40">
                            {/* Нөхцөл нь ХЭВЛЭГДЭХ талбараар — гадуур ажилтай
                                өдөр credited нь null, worked_effective > 0. */}
                            {r.credited_minutes != null || r.worked_effective_minutes > 0 ? (
                              <div
                                className="flex flex-col items-center gap-0.5 leading-tight"
                                title={[
                                  `${t('attendanceAdminPage.tipActual')}: ${r.work_minutes != null ? hmDec(r.work_minutes) : '—'}`,
                                  (r.non_project_credit_minutes ?? 0) > 0
                                    ? `${t('attendanceAdminPage.tipNonProjectCredit')}: ${hmDec(r.non_project_credit_minutes ?? 0)}`
                                    : null,
                                  `${t('attendanceAdminPage.tipExpected')}: ${hmDec(r.expected_minutes)}`,
                                  `${t('attendanceAdminPage.tipLate')}: ${t('attendanceAdminPage.minutesShort', { minutes: r.late_minutes ?? 0 })}`,
                                  `${t('attendanceAdminPage.tipCredited')}: ${hmDec(r.credited_minutes)}`,
                                  r.total_minutes != null
                                    ? `${t('attendanceAdminPage.tipTotal')}: ${hmDec(r.total_minutes)}`
                                    : null,
                                  `${t('myAttendance.colWorked')}: ${hmDec(r.worked_effective_minutes)}`,
                                ]
                                  .filter(Boolean)
                                  .join('\n')}
                              >
                                <span className="whitespace-nowrap">{hm(r.worked_effective_minutes)}</span>
                              </div>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr className="bg-primary/10 border-t-2 border-primary/40 text-xs">
                      <td className="px-3 py-2 text-right font-bold" colSpan={6}>
                        <span
                          title={
                            summary.extraDays > 0 ? t('attendanceAdminPage.extraDaysHint') : undefined
                          }
                        >
                          {t(
                            summary.extraDays > 0
                              ? 'attendanceAdminPage.subtotalLabelExtra'
                              : 'attendanceAdminPage.subtotalLabel',
                            {
                              days: summary.workDays,
                              present: summary.presentDays,
                              extra: summary.extraDays,
                            },
                          )}
                        </span>
                      </td>
                      <td className="px-2 py-2 text-center font-bold tabular-nums bg-danger/60 text-danger">
                        {summary.late > 0 ? summary.late : ''}
                      </td>
                      <td className="px-2 py-2 text-center font-bold tabular-nums text-info">
                        {summary.leaveDays > 0 ? summary.leaveDays : ''}
                      </td>
                      <td
                        className="px-2 py-2 text-center font-bold tabular-nums text-info whitespace-nowrap"
                        title={summary.leave > 0 ? hoursDec(summary.leave) : undefined}
                      >
                        {summary.leave > 0 ? hm(summary.leave) : ''}
                      </td>
                      <td
                        className="px-2 py-2 text-center font-bold tabular-nums text-success whitespace-nowrap"
                        title={summary.outOfOffice > 0 ? hoursDec(summary.outOfOffice) : undefined}
                      >
                        {summary.outOfOffice > 0 ? hm(summary.outOfOffice) : ''}
                      </td>
                      <td className="px-2 py-2 text-center font-bold tabular-nums text-destructive">
                        {summary.absentDays > 0 ? summary.absentDays : ''}
                      </td>
                      <td
                        className="px-2 py-2 text-center font-bold tabular-nums whitespace-nowrap"
                        title={`${t('attendanceAdminPage.tipActual')}: ${hmDec(summary.workMin)}\n${t('attendanceAdminPage.tipTotal')}: ${hmDec(summary.totalMin)}`}
                      >
                        <div className="flex flex-col items-center leading-tight">
                          <span>{hm(summary.worked)}</span>
                          {summary.worked > 0 && (
                            <span className="text-micro font-normal text-muted-foreground">
                              {t('myAttendance.decimalEq', { hours: hoursDec(summary.worked) })}
                            </span>
                          )}
                        </div>
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}

            {/* Сарын батлалтын үйлдэл — ДУУССАН сард, эсвэл гараар нээсэн
                явагдаж буй сард (сервер бусад дуусаагүй сарыг 400-аар
                хориглосон хэвээр). */}
            {!canApproveMonth ? (
              <div className="border-t border-border/60 p-3">
                <p className="text-xs text-muted-foreground">
                  {t('myAttendance.monthInProgress')}
                </p>
              </div>
            ) : (
            <div className="space-y-3 border-t border-border/60 p-3">
              {changedAfterAnswer && (
                <p className="flex items-start gap-1.5 text-xs text-warning" role="status">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  {t('myAttendance.changedHint')}
                </p>
              )}
              {monthApproval?.status === 'disputed' && monthApproval.response_note && (
                <p className="text-xs text-danger">
                  {t('myAttendance.disputedBadge')}: {monthApproval.response_note}
                </p>
              )}
              {reporting ? (
                <div className="space-y-2">
                  <Textarea
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder={t('myAttendance.issueNotePlaceholder')}
                    className="h-16 w-full text-sm"
                  />
                  <div className="flex justify-end gap-2">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-8 text-xs"
                      onClick={() => {
                        setReporting(false);
                        setNote('');
                      }}
                    >
                      {t('common.cancel')}
                    </Button>
                    <Button
                      size="sm"
                      className="h-8 text-xs"
                      disabled={!note.trim() || saving}
                      onClick={() => submit('disputed')}
                    >
                      {t('myAttendance.sendIssue')}
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-xs text-muted-foreground">
                    {isEarlyOpenMonth
                      ? t('myAttendance.earlyApproveHint')
                      : t('myAttendance.approveHint')}
                  </p>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      className="h-8 gap-1 text-xs bg-success hover:bg-success text-white"
                      disabled={saving}
                      onClick={() => submit('confirmed')}
                    >
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      {t('myAttendance.approve')}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8 gap-1 text-xs"
                      disabled={saving}
                      onClick={() => {
                        setReporting(true);
                        setNote('');
                      }}
                    >
                      <AlertTriangle className="h-3.5 w-3.5" />
                      {t('myAttendance.reportIssue')}
                    </Button>
                  </div>
                </div>
              )}
            </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
