/**
 * «Чөлөө нөхөж бүртгэх» диалог (админ / ахлах).
 *
 * Ажилтан ӨНГӨРСӨН огноогоор чөлөөний хүсэлт илгээж чадахгүй
 * (`backend/src/lib/leaveWindow.ts` — бүтэн өдрийн чөлөө хамгийн эрт
 * маргаашаас эхэлнэ).  Тэр өдрөө амаар/утсаар чөлөө авсан ажилтан
 * админд хэлж, админ энэ цонхоор нөхөж бүртгэнэ.  Хүсэлт «Хүлээгдэж
 * буй» төлөвтэй үүсч (`submit_as_pending: true`), жагсаалтаас энгийн
 * батлах урсгалаар зөвшөөрөгдөнө — ингэснээр «хэн бүртгэсэн»
 * (created_by) ба «хэн зөвшөөрсөн» (reviewer_id) хоёр тусдаа үлдэнэ.
 *
 * Талбарууд нь ажилтны `MyLeavesCard` дахь хүсэлтийн формтой ЗОРИУД
 * ижил — журмын код (`reason_code`), үргэлжлэх хугацаа (бүтэн / хагас /
 * 4ц / 2ц / цагийн хүрээ), хавсралт.  Ялгаа нь ганцхан: цагийн цонхны
 * хязгаарлалт байхгүй, учир нь сервер adminGrant замыг `leaveWindow`-оос
 * бүрэн чөлөөлдөг.  Ирээдүйн огноог мөн зөвшөөрнө — утсаар ирсэн
 * маргаашийн яаралтай чөлөөг мөн энэ цонхоор бүртгэдэг.
 */
import { useEffect, useMemo, useState } from 'react';
import { AlertCircle, CalendarRange, History, Paperclip, X } from 'lucide-react';
import { apiFetch, uploadFile } from '@/shared/api/client';
import { useLanguage } from '@/shared/i18n';
import { cn } from '@/shared/lib/utils';
import type { LeaveTypeKey } from '@/features/attendance/leavePolicy';
import {
  CEO_APPROVAL_DAY_THRESHOLD,
  POLICY_BY_CODE,
  groupPolicy,
  policyLimitSummary,
} from '@/features/attendance/leavePolicy';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/ui/dialog';
import { Badge } from '@/ui/badge';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import { Label } from '@/ui/label';
import { Textarea } from '@/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/ui/select';
import { LEAVE_TYPE_META } from '@/features/attendance/admin/constants';
import { todayInUB } from '@/features/attendance/admin/utils/dates';
import type { LeaveActionsState } from '@/features/attendance/admin/hooks/useLeaveActions';
import type { StaffOption } from '@/features/attendance/admin/hooks/useStaffOptions';
import EmployeeSelect from '@/features/attendance/admin/components/EmployeeSelect';
import {
  addLeaveWorkHours,
  leaveRangeHours,
  lunchFromWire,
  minutesToHhmm,
  rangeTouchesLunch,
  type LeaveLunch,
  type LeaveLunchWire,
} from '@/features/attendance/leaveHours';

const STD_DAY = 8;

type DurationMode = 'full' | 'half' | 'h4' | 'h2' | 'range';

/** `hours = null` бол «бүтэн өдөр (огнооны хүрээгээр)». */
const DURATION_OPTIONS: { id: DurationMode; labelKey: string; hours: number | null }[] = [
  { id: 'full', labelKey: 'attendanceAdminPage.grantDurFull', hours: null },
  { id: 'half', labelKey: 'attendanceAdminPage.grantDurHalf', hours: 4 },
  { id: 'h4', labelKey: 'attendanceAdminPage.grantDur4h', hours: 4 },
  { id: 'h2', labelKey: 'attendanceAdminPage.grantDur2h', hours: 2 },
  { id: 'range', labelKey: 'attendanceAdminPage.grantDurRange', hours: null },
];

function diffDays(from: string, to: string): number {
  const a = new Date(from + 'T00:00:00Z').getTime();
  const b = new Date(to + 'T00:00:00Z').getTime();
  return Math.max(1, Math.round((b - a) / 86_400_000) + 1);
}

export default function LeaveGrantDialog({
  actions,
  staffOptions,
  onCreated,
}: {
  actions: LeaveActionsState;
  staffOptions: StaffOption[];
  /** Амжилттай бүртгэсний дараа — жагсаалтын шүүлтийг шинэ мөр рүү
   *  чиглүүлэхэд (`LeavesTab`). */
  onCreated?: (leaveType: LeaveTypeKey) => void;
}) {
  const { t } = useLanguage();
  const { grantOpen, setGrantOpen, onLeaveGranted } = actions;

  const today = todayInUB();
  const [userId, setUserId] = useState('');
  const [reasonCode, setReasonCode] = useState('annual_vacation');
  const [duration, setDuration] = useState<DurationMode>('full');
  const [start, setStart] = useState(today);
  const [end, setEnd] = useState(today);
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [reason, setReason] = useState('');
  const [attachment, setAttachment] = useState('');
  const [attachName, setAttachName] = useState('');
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Цайны цонх — чөлөөний цагаас хасна (сервер `leaveRangeHours`-тэй ижил). */
  const [lunch, setLunch] = useState<LeaveLunch>(null);

  useEffect(() => {
    if (!grantOpen) return;
    let cancelled = false;
    apiFetch<{ lunch?: LeaveLunchWire }>('/leaves/window')
      .then((res) => {
        if (!cancelled) setLunch(lunchFromWire(res.lunch));
      })
      .catch(() => {
        // Уншиж чадаагүй ч формыг хаахгүй — эцсийн цагийг сервер бодно.
      });
    return () => {
      cancelled = true;
    };
  }, [grantOpen]);

  // Цонх нээгдэх бүрт форм цоо шинэ.  Анхдагч огноо нь ӨНӨӨДӨР — «нөхөх»
  // гэдэг нь практикт ихэвчлэн өнөөдөр эсвэл өчигдрийн чөлөө.
  useEffect(() => {
    if (!grantOpen) return;
    setUserId('');
    setReasonCode('annual_vacation');
    setDuration('full');
    setStart(today);
    setEnd(today);
    setStartTime('');
    setEndTime('');
    setReason('');
    setAttachment('');
    setAttachName('');
    setError(null);
    // `today` нь мөчлөгийн турш тогтмол — хамааралд оруулах шаардлагагүй.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [grantOpen]);

  const selectedPolicy = POLICY_BY_CODE[reasonCode] ?? null;
  const groupedPolicy = useMemo(() => groupPolicy(), []);

  /** Нэг өдрөөс бага чөлөөнд эхлэх/дуусах огноо нэг өдөр болно. */
  const isSubDay = duration !== 'full';
  const spanDays = diffDays(start, isSubDay ? start : end);

  let finalHours: number | null;
  if (duration === 'full') {
    finalHours = spanDays * STD_DAY;
  } else if (duration === 'range') {
    // Цайны цаг тооцогдохгүй — серверийн `leaveRangeHours`-тэй ижил.
    finalHours = startTime && endTime ? leaveRangeHours(startTime, endTime, lunch) : null;
  } else {
    finalHours = DURATION_OPTIONS.find((o) => o.id === duration)?.hours ?? null;
  }
  const finalDays = finalHours == null ? spanDays : Math.round((finalHours / STD_DAY) * 100) / 100;

  const isPast = start < today;
  const isFuture = start > today;

  // «Цагийн хүрээ» горимд цаг сонгоогүй бол `finalHours` нь null — тэр үед
  // огнооны хүрээгээр «1 өдөр» гэж харуулбал ХУДАЛ (хагас өдрийн чөлөө
  // бүтэн өдөр мэт уншигдана), тиймээс зурааснаар орхино.
  const totalLabel =
    finalHours == null
      ? isSubDay
        ? '—'
        : t('attendanceAdminPage.grantDaysLabel', { days: spanDays })
      : finalHours >= STD_DAY
        ? t('attendanceAdminPage.grantDaysHoursLabel', {
            days: Math.round((finalHours / STD_DAY) * 10) / 10,
            hours: finalHours,
          })
        : t('attendanceAdminPage.grantHoursLabel', { hours: finalHours });

  // Журмын зөөлөн сэрэмжлүүлэг — сервер сар/улирлын ашиглалтыг нэмж
  // тооцох тул энд зөвхөн нэг удаагийн хязгаарыг харуулна.
  const warnings: string[] = [];
  if (selectedPolicy?.day_cap !== undefined && finalDays > selectedPolicy.day_cap) {
    warnings.push(
      t('attendanceAdminPage.grantWarnDayCap', {
        rule: selectedPolicy.rule_id,
        label: selectedPolicy.label,
        cap: selectedPolicy.day_cap,
        requested: finalDays,
      }),
    );
  }
  if (
    selectedPolicy?.hour_cap !== undefined &&
    finalHours !== null &&
    finalHours > selectedPolicy.hour_cap
  ) {
    warnings.push(
      t('attendanceAdminPage.grantWarnHourCap', {
        rule: selectedPolicy.rule_id,
        label: selectedPolicy.label,
        cap: selectedPolicy.hour_cap,
        requested: finalHours,
      }),
    );
  }
  const ceoRequired = finalDays >= CEO_APPROVAL_DAY_THRESHOLD;

  const handleAttachment = async (file: File | null) => {
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const url = await uploadFile(file);
      setAttachment(url);
      setAttachName(file.name);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('attendanceAdminPage.grantUploadFailed'));
    } finally {
      setUploading(false);
    }
  };

  const submit = async () => {
    if (!userId) {
      setError(t('attendanceAdminPage.manualSelectUser'));
      return;
    }
    if (!start || (!isSubDay && !end)) {
      setError(t('attendanceAdminPage.grantErrEnterDate'));
      return;
    }
    if (!isSubDay && end < start) {
      setError(t('attendanceAdminPage.grantInvalidRange'));
      return;
    }
    if (isSubDay && !startTime) {
      setError(t('attendanceAdminPage.grantErrSelectStartTime'));
      return;
    }
    if (duration === 'range' && !endTime) {
      setError(t('attendanceAdminPage.grantErrSelectEndTime'));
      return;
    }
    if (duration === 'range' && (!finalHours || finalHours <= 0)) {
      setError(t('attendanceAdminPage.grantErrEndTimeAfterStart'));
      return;
    }
    if (duration === 'range' && finalHours && finalHours > STD_DAY) {
      setError(t('attendanceAdminPage.grantErrMax8h'));
      return;
    }
    if (!reason.trim()) {
      setError(t('attendanceAdminPage.grantErrReason'));
      return;
    }

    setSaving(true);
    setError(null);
    try {
      await apiFetch('/leaves', {
        data: {
          user_id: parseInt(userId, 10),
          // Хүсэлт «хүлээгдэж буй» төлөвтэй үүснэ — админ дараа нь
          // жагсаалтаас батална (server: routes/leaves.ts `grantPending`).
          submit_as_pending: true,
          // `leave_type` нь policy-аас уламжлагдана; сервер reason_code-оос
          // дахин тогтоох ч давхар илгээж back-compat нөхөрсөг байлгана.
          leave_type: selectedPolicy?.leave_type ?? 'other',
          reason_code: reasonCode,
          start_date: start,
          end_date: isSubDay ? start : end,
          hours: finalHours ?? undefined,
          days: finalDays,
          start_time: isSubDay ? startTime : null,
          end_time: isSubDay
            ? duration === 'range'
              ? endTime
              : finalHours != null
                ? addLeaveWorkHours(startTime, finalHours, lunch)
                : null
            : null,
          reason: reason.trim(),
          attachment_url: attachment || null,
        },
      });
      onCreated?.(selectedPolicy?.leave_type ?? 'other');
      onLeaveGranted();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('common.error'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={grantOpen} onOpenChange={setGrantOpen}>
      <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CalendarRange className="h-5 w-5 text-primary" />
            {t('attendanceAdminPage.grantLeave')}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {error && (
            <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-destructive/10 border border-destructive/30 text-destructive text-sm">
              <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" /> {error}
            </div>
          )}

          <p className="text-micro text-muted-foreground rounded-lg border border-border/60 bg-muted/30 px-3 py-2">
            {t('attendanceAdminPage.grantHint')}
          </p>

          <EmployeeSelect value={userId} onChange={setUserId} options={staffOptions} />

          <div className="space-y-1.5">
            <Label className="text-xs">{t('attendanceAdminPage.grantPolicyReason')}</Label>
            <Select value={reasonCode} onValueChange={setReasonCode}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="max-h-80">
                {groupedPolicy.map((g) => (
                  <div key={g.group} className="py-1">
                    <p className="px-2 pt-1 pb-1 text-label text-muted-foreground font-medium">
                      {g.label}
                    </p>
                    {g.items.map((p) => {
                      const Icon = LEAVE_TYPE_META[p.leave_type].icon;
                      return (
                        <SelectItem key={p.code} value={p.code}>
                          <span className="flex items-center gap-2">
                            <Icon className="h-3.5 w-3.5" />
                            <span>{p.label}</span>
                            <span className="ml-1 text-micro font-mono text-muted-foreground">
                              {p.rule_id}
                            </span>
                          </span>
                        </SelectItem>
                      );
                    })}
                  </div>
                ))}
              </SelectContent>
            </Select>
            {selectedPolicy && (
              <div className="flex flex-wrap items-center gap-1.5 pt-1">
                <Badge
                  variant="outline"
                  className={cn(
                    'text-micro',
                    selectedPolicy.is_paid
                      ? 'border-success/30 text-success bg-success/10'
                      : 'border-warning/30 text-warning bg-warning/10',
                  )}
                >
                  {selectedPolicy.is_paid
                    ? t('attendanceAdminPage.grantPaid')
                    : t('attendanceAdminPage.grantUnpaid')}
                </Badge>
                <Badge variant="outline" className="text-micro font-mono">
                  {selectedPolicy.rule_id}
                </Badge>
                <span className="text-micro text-muted-foreground">
                  {policyLimitSummary(selectedPolicy)}
                </span>
              </div>
            )}
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">{t('attendanceAdminPage.grantDuration')}</Label>
            <div className="grid grid-cols-3 gap-1.5">
              {DURATION_OPTIONS.map((o) => (
                <button
                  key={o.id}
                  type="button"
                  onClick={() => setDuration(o.id)}
                  className={cn(
                    'text-micro py-2 px-1 rounded-md border font-medium transition-colors text-center',
                    duration === o.id
                      ? 'bg-primary text-primary-foreground border-primary'
                      : 'border-border bg-muted/30 hover:bg-muted text-foreground',
                  )}
                >
                  {t(o.labelKey)}
                </button>
              ))}
            </div>
          </div>

          {!isSubDay ? (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">{t('attendanceAdminPage.startDate')}</Label>
                <Input
                  type="date"
                  value={start}
                  className="tabular-nums"
                  onChange={(e) => {
                    setStart(e.target.value);
                    if (end < e.target.value) setEnd(e.target.value);
                  }}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">{t('attendanceAdminPage.endDate')}</Label>
                <Input
                  type="date"
                  value={end}
                  min={start}
                  className="tabular-nums"
                  onChange={(e) => setEnd(e.target.value)}
                />
              </div>
            </div>
          ) : (
            <div className="space-y-1.5">
              <Label className="text-xs">{t('attendanceAdminPage.grantDate')}</Label>
              <Input
                type="date"
                value={start}
                className="tabular-nums"
                onChange={(e) => {
                  setStart(e.target.value);
                  setEnd(e.target.value);
                }}
              />
              <div className="grid grid-cols-2 gap-3 pt-1">
                <div className="space-y-1.5">
                  <Label className="text-xs">
                    {t('attendanceAdminPage.grantStartTime')}{' '}
                    <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    type="time"
                    value={startTime}
                    onChange={(e) => setStartTime(e.target.value)}
                    className={cn('tabular-nums', !startTime && 'border-destructive/60')}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">
                    {t('attendanceAdminPage.grantEndTime')}
                    {duration === 'range' && <span className="text-destructive"> *</span>}
                  </Label>
                  {duration === 'range' ? (
                    <Input
                      type="time"
                      value={endTime}
                      min={startTime}
                      onChange={(e) => setEndTime(e.target.value)}
                      className={cn('tabular-nums', !endTime && 'border-destructive/60')}
                    />
                  ) : (
                    <Input
                      type="time"
                      value={
                        startTime && finalHours != null
                          ? addLeaveWorkHours(startTime, finalHours, lunch)
                          : ''
                      }
                      readOnly
                      disabled
                      placeholder="--:--"
                      className="bg-muted/40 cursor-not-allowed tabular-nums"
                    />
                  )}
                </div>
              </div>
              <p className="text-micro text-muted-foreground">
                {duration === 'range'
                  ? t('attendanceAdminPage.grantRangeHint')
                  : t('attendanceAdminPage.grantAutoEndHint')}
              </p>
              {lunch &&
                startTime &&
                rangeTouchesLunch(
                  startTime,
                  duration === 'range'
                    ? endTime
                    : finalHours != null
                      ? addLeaveWorkHours(startTime, finalHours, lunch)
                      : null,
                  lunch,
                ) && (
                  <p className="text-micro text-muted-foreground">
                    {t('myLeavesCard.lunchExcluded', {
                      start: minutesToHhmm(lunch.start),
                      end: minutesToHhmm(lunch.end),
                    })}
                  </p>
                )}
            </div>
          )}

          {/* Огнооны контекст — «нөхөж бүртгэж байна» гэдгийг тодоор
              харуулж, санамсаргүй өнөөдрийн огноогоор бүртгэхээс сэргийлнэ. */}
          {(isPast || isFuture) && (
            <div
              className={cn(
                'flex items-start gap-2 rounded-lg border px-3 py-2 text-micro',
                isPast
                  ? 'border-info/30 bg-info/10 text-info'
                  : 'border-warning/30 bg-warning/10 text-amber-800 dark:text-amber-300',
              )}
            >
              <History className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>
                {isPast
                  ? t('attendanceAdminPage.grantPastNotice', { date: start })
                  : t('attendanceAdminPage.grantFutureNotice', { date: start })}
              </span>
            </div>
          )}

          <div className="rounded-lg border border-primary/20 bg-primary/5 px-3 py-2 text-xs flex items-center justify-between">
            <span className="text-muted-foreground">{t('attendanceAdminPage.grantTotal')}</span>
            <span className="font-semibold text-primary tabular-nums">{totalLabel}</span>
          </div>

          {(ceoRequired || warnings.length > 0) && (
            <div className="space-y-1.5">
              {ceoRequired && (
                <div className="flex items-start gap-2 rounded-lg border border-violet-300 bg-violet-50 dark:bg-violet-900/20 px-3 py-2 text-micro text-violet-800 dark:text-violet-300">
                  <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span>{t('attendanceAdminPage.grantCeoWarn')}</span>
                </div>
              )}
              {warnings.map((w) => (
                <div
                  key={w}
                  className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-micro text-amber-800 dark:text-amber-300"
                >
                  <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span>{w}</span>
                </div>
              ))}
            </div>
          )}

          <div className="space-y-1.5">
            <Label className="text-xs">
              {t('attendanceAdminPage.grantReason')} <span className="text-destructive">*</span>
            </Label>
            <Textarea
              rows={2}
              placeholder={t('attendanceAdminPage.grantReasonPlaceholder')}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">
              {t('attendanceAdminPage.grantAttachment')}{' '}
              <span className="text-muted-foreground">
                {t('attendanceAdminPage.grantAttachmentHint')}
              </span>
            </Label>
            {attachment ? (
              <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2 text-xs">
                <Paperclip className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span className="truncate">{attachName}</span>
                <button
                  type="button"
                  className="ml-auto text-muted-foreground hover:text-destructive"
                  onClick={() => {
                    setAttachment('');
                    setAttachName('');
                  }}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ) : (
              <Input
                type="file"
                disabled={uploading}
                onChange={(e) => handleAttachment(e.target.files?.[0] ?? null)}
                className="text-xs file:mr-2 file:text-xs"
              />
            )}
            {uploading && (
              <p className="text-micro text-muted-foreground">
                {t('attendanceAdminPage.grantUploading')}
              </p>
            )}
          </div>
        </div>

        <div className="flex gap-2 justify-end pt-2">
          <Button variant="outline" onClick={() => setGrantOpen(false)}>
            {t('common.cancel')}
          </Button>
          <Button onClick={submit} disabled={saving || uploading}>
            {saving ? t('common.saving') : t('attendanceAdminPage.grantSubmit')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
