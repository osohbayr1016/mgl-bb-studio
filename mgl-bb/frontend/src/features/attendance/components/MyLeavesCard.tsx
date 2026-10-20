/**
 * Чөлөөний хуудас дээрх жагсаалт + хүсэлт оруулах modal-ыг
 * багтаасан reusable section.
 *
 * AttendancePage (ажилтны тал)-д шууд цохилгоор оруулсан тул `My
 * leaves` card болон Шинэ хүсэлт modal хоёрыг хооронд нь холбоход
 * хялбар. Админ тал нь /attendance/admin doторх "Чөлөө" tab-аас
 * approve/reject хийнэ.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useActionParam } from '@/shared/hooks/useActionParam';
import { apiFetch, uploadFile } from '@/shared/api/client';
import { confirmDialog } from '@/shared/components/ConfirmDialog';
import type { LeaveRequest, LeaveType, LeaveWindow, LeaveWindowForDate } from '@/shared/types';
import {
  addLeaveWorkHours,
  leaveRangeHours,
  lunchFromWire,
  minutesToHhmm,
  rangeTouchesLunch,
  type LeaveLunch,
  type LeaveLunchWire,
} from '@/features/attendance/leaveHours';
import {
  POLICY_BY_CODE,
  CEO_APPROVAL_DAY_THRESHOLD,
  groupPolicy,
  policyLimitSummary,
  findLeavePolicy,
  fallbackCodeFromType,
} from '@/features/attendance/leavePolicy';
import { Button } from '@/ui/button';
import { Badge } from '@/ui/badge';
import { Input } from '@/ui/input';
import { Label } from '@/ui/label';
import { Textarea } from '@/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/ui/select';
import {
  Plane,
  Stethoscope,
  Wallet,
  Laptop,
  FileText,
  CheckCircle2,
  Clock,
  CalendarDays,
  Trash2,
  Paperclip,
  AlertCircle,
  Loader2,
  Lock,
  // BookOpen — журамтай танилцах товч/dialog түр идэвхгүй (доор үзнэ үү)
} from 'lucide-react';
import { cn } from '@/shared/lib/utils';
import { APPROVAL_STATUS_TONE, LEAVE_TYPE_TONE } from '@/shared/lib/status-colors';
import { RequestCardShell, RequestStatusBadge } from '@/features/attendance/components/RequestCardKit';
import { useLanguage } from '@/shared/i18n';

import { formatDate } from '@/shared/lib/time';
import LeaveArrivalCutNote from '@/features/attendance/components/LeaveArrivalCutNote';

const TYPE_META: Record<
  LeaveType,
  {
    labelKey: string;
    icon: React.ComponentType<{ className?: string }>;
    tone: string;
  }
> = {
  annual: {
    labelKey: 'myLeavesCard.typeAnnual',
    icon: Plane,
    tone: LEAVE_TYPE_TONE.annual,
  },
  sick: {
    labelKey: 'myLeavesCard.typeSick',
    icon: Stethoscope,
    tone: LEAVE_TYPE_TONE.sick,
  },
  unpaid: {
    labelKey: 'myLeavesCard.typeUnpaid',
    icon: Wallet,
    tone: LEAVE_TYPE_TONE.unpaid,
  },
  remote: {
    labelKey: 'myLeavesCard.typeRemote',
    icon: Laptop,
    tone: LEAVE_TYPE_TONE.remote,
  },
  other: {
    labelKey: 'myLeavesCard.typeOther',
    icon: FileText,
    tone: LEAVE_TYPE_TONE.other,
  },
};

function fmtDate(iso: string): string {
  return formatDate(new Date(iso + 'T00:00:00'));
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/** YYYY-MM-DD дээр өдөр нэмнэ (цагийн бүсээс хамаарахгүй). */
function addDaysIso(date: string, days: number): string {
  return new Date(new Date(date + 'T00:00:00Z').getTime() + days * 86_400_000)
    .toISOString()
    .slice(0, 10);
}

function diffDays(from: string, to: string): number {
  const a = new Date(from + 'T00:00:00Z').getTime();
  const b = new Date(to + 'T00:00:00Z').getTime();
  return Math.max(1, Math.round((b - a) / 86_400_000) + 1);
}

const STD_DAY = 8;

/** Дотоод журам MGL-HR/0124, "АРВАН НЭГ. ЧӨЛӨӨ ОЛГОХ ЖУРАМ".
 *  Чөлөөний хүсэлт явуулахаас өмнө ажилтан энэ заалттай танилцаж
 *  "Зөвшөөрөх" сонголт хийсэн байх ёстой — зөвхөн UI-ийн talaarх consent
 *  gate, backend дээр одоогоор тусгай хадгалалт байхгүй. */
/* 2026-06: Чөлөө олгох журам формоос бүрэн арилсан — гарчиг (доорх 2 const),
   "Танилцах" dialog болон бүтэн журмын текст.  Журам шинэчлэгдэх хүртэл
   comment хэлбэрээр үлдээв — сэргээхдээ энэ блок, доорх LeavePolicyDialog
   функц болон холбогдох usage-уудыг буцааж нээнэ.
const LEAVE_POLICY_DOC_LABEL = 'Дотоод журам MGL-HR/0124';
const LEAVE_POLICY_SECTION_TITLE = 'АРВАН НЭГ. ЧӨЛӨӨ ОЛГОХ ЖУРАМ';
const LEAVE_POLICY_RULES: Array<{
  id: string;
  text: string;
  children?: Array<{ id: string; text: string }>;
}> = [
  {
    id: '11.1',
    text: 'Ажилтны хүсэлтээр цалинтай болон цалингүй чөлөө олгоно. Чөлөөг дараах байдлаар зохицуулна:',
  },
  {
    id: '11.2',
    text: 'Ажилтны хүсэлт, өргөдөл, харгалзах баримт бичгийг үндэслэн 1 сараас доош хугацааны чөлөөг удирдлага зөвшөөрөн баталгаажуулна.',
  },
  { id: '11.3', text: 'Нэг сараас дээш хугацааны чөлөөг Ерөнхий захирлын тушаалаар олгоно.' },
  {
    id: '11.4',
    text: 'Ажилтан 1 сараас дээш чөлөө авах болон жирэмсний болон хүүхэд асарсны амралт эдлэх тохиолдолд тойрох хуудсаар ажил хүлээлцэнэ.',
  },
  {
    id: '11.5',
    text: 'Дараах тохиолдолд цалинтай чөлөө олгоно:',
    children: [
      { id: '11.5.1', text: 'Хурим хийхэд ажлын 3 хүртэлх өдөр.' },
      { id: '11.5.2', text: 'Ажилтны эхнэр төрсөн бол ажлын 10 өдөр.' },
      {
        id: '11.5.3',
        text: 'Байгууллагын нэр хүндийг сурталчлах зорилгоор улсын болон олон улсын чанартай спорт, урлаг соёлын арга хэмжээ, уралдаан тэмцээнд оролцоход зориулж 3-аас илүүгүй ажлын өдөр.',
      },
      {
        id: '11.5.4',
        text: 'Дээд боловсролын сургалтын байгууллагад эчнээ, оройн хэлбэрээр суралцаж буй ажилтанд улирлын болон төгсөлтийн шалгалт өгөхөд зориулж ажлын 3 өдөр, дипломын ажил бичиж хамгаалахад зориулж ажлын 3 өдөр.',
      },
      {
        id: '11.5.5',
        text: 'Улиралд 1 удаа ажилтан өөрөө болон 16 нас хүртэлх хүүхдээ эмнэлгийн шинжилгээ хийлгэхэд 4 хүртэлх цаг — "Шинжилгээний хуудас"-ыг чөлөөний хуудаст хавсаргасан байх.',
      },
      {
        id: '11.5.6',
        text: 'Сургуулийн орчинд "School police" эргүүлийн үүрэг гүйцэтгэж байгаа иргэнд ажил олгогч байгууллага хагас өдрийн цалинтай чөлөө олгоно.',
      },
      {
        id: '11.5.7',
        text: 'Ажилтны анкетад бичигдсэн төрсөн эцэг, эх, хадам эцэг, эх, эхнэр, нөхөр, хүүхэд, ах, эгч, дүү, эмээ, өвөө нас нөгчвөл Улаанбаатар хотод ажлын 3 өдөр, орон нутагт ажлын 5 өдөр.',
      },
      {
        id: '11.5.8',
        text: 'Ажилтны эцэг, эх, эхнэр, нөхөр, хүүхэд байгалийн гамшиг, гал усны аюул зэрэг давагдашгүй хүчин зүйлд өртсөн, хүнд өвчнөөр өвчилсөн бол ажлын 3 өдөр, уг шалтгаанаар хөдөө орон нутаг болон гадаад улс руу явах тохиолдолд ажлын 10 хүртэл өдөр.',
      },
    ],
  },
  {
    id: '11.6',
    text: 'Журмын 11.5-т зааснаас бусад шалтгаанаар ажилтанд тодорхой хугацаагаар цалингүй чөлөө олгоно.',
  },
  {
    id: '11.7',
    text: 'Ажилтанд олгох цалингүй чөлөө нь хоногоор болон цагаар олгогдох бөгөөд тухайн ажилтны сард авах цалингүй чөлөөний нийт хэмжээ 3 (гурав) хүртэл хоног байна. Нэг удаагийн чөлөөний үргэлжлэх хугацаа болон олгох нөхцөлийг ажилтны хүсэлт, байгууллагын үйл ажиллагааны хэвийн нөхцөл, ажлын шаардлагыг харгалзан ажил олгогч тухай бүр шийдвэрлэнэ.',
  },
  {
    id: '11.8',
    text: 'Хүндэтгэн үзэх шалтгаан, хүсэлт, нотлох баримт бичгийг харгалзан урт хугацааны цалингүй чөлөөг тухай бүр нь шийдвэрлэн ерөнхий захирлын тушаалаар олгоно.',
  },
  {
    id: '11.9',
    text: 'Жирэмсний болон амаржсаны амралтаа эдэлсэн ажилтан хүүхэд асрах чөлөө авах хүсэлтээ бичгээр гаргаж шийдвэрлүүлнэ.',
  },
  { id: '11.10', text: 'Зөвшөөрөл өгөөгүй байхад ажилдаа ирээгүй ажилтныг ажил тасалсанд тооцно.' },
  {
    id: '11.11',
    text: 'Түүнчлэн энэхүү хэсэгт заасан чөлөөний тогтоосон хэмжээг хэтрүүлсэн тохиолдолд сахилгын зөрчилд тооцож, дотоод журмын дагуу хариуцлага хүлээлгэнэ.',
  },
];
*/

/** Чөлөөний урт сонголтыг товч UI-д буулгасан байдлаар хадгална.
 *  `hours` нь `null` бол "бүтэн өдөр (огнооны хүрээгээр)" гэж үзнэ. */
type DurationMode = 'full' | 'am' | 'half' | 'h2' | 'h4' | 'range';
const DURATION_OPTIONS: { id: DurationMode; labelKey: string; hours: number | null }[] = [
  { id: 'full', labelKey: 'myLeavesCard.durFull', hours: null }, // огнооны хүрээгээр
  // Цагийг СЕРВЕР тухайн өдрийн ээлжээс тооцно (`day_part: 'am'`).
  { id: 'am', labelKey: 'myLeavesCard.durAm', hours: null },
  { id: 'half', labelKey: 'myLeavesCard.durHalf', hours: 4 },
  { id: 'h4', labelKey: 'myLeavesCard.dur4h', hours: 4 },
  { id: 'h2', labelKey: 'myLeavesCard.dur2h', hours: 2 },
  { id: 'range', labelKey: 'myLeavesCard.durRange', hours: null },
];

function fmtTimeRange(
  start: string | null | undefined,
  end: string | null | undefined,
): string | null {
  if (!start || !end) return null;
  return `${start.slice(0, 5)}–${end.slice(0, 5)}`;
}

function fmtHoursLabel(
  hours: number | null,
  days: number,
  t: (key: string, params?: Record<string, string | number>) => string,
): string {
  if (hours == null) return t('myLeavesCard.daysLabel', { days });
  if (hours >= STD_DAY) {
    const d = Math.round((hours / STD_DAY) * 10) / 10;
    return t('myLeavesCard.daysHoursLabel', { days: d, hours });
  }
  return t('myLeavesCard.hoursLabel', { hours });
}

export default function MyLeavesCard() {
  const { t } = useLanguage();
  const [leaves, setLeaves] = useState<LeaveRequest[]>([]);
  const [loading, setLoading] = useState(true);
  // Хүсэлт илгээх ажлын цагийн цонх — амралтын өдөр `holidays` хүснэгтэд
  // байдаг тул серверээс уншина (клиент дангаараа тооцох боломжгүй).
  const [leaveWindow, setLeaveWindow] = useState<LeaveWindow | null>(null);
  const [windowMessage, setWindowMessage] = useState<string | null>(null);
  /** Цайны цонх — чөлөөний цагаас хасна (сервертэй ижил тоо харуулахад). */
  const [lunch, setLunch] = useState<LeaveLunch>(null);
  const [formOpenedLocally, setShowForm] = useState(false);
  // const [showPolicy, setShowPolicy] = useState(false); // журамтай танилцах dialog түр идэвхгүй
  const [error, setError] = useState<string | null>(null);

  // Доод navbar-ын ⊕ → «Чөлөө хүсэх» нь `/app/attendance?action=leave` руу
  // шилжүүлдэг.  URL-ыг effect-ээр local state руу ХУУЛАХГҮЙ — хоёрын
  // аль нэг нь үнэн бол нээлттэй гэж гаргаж авна (эс тэгвэл нэмэлт
  // render давалгаа үүсгэнэ).
  const [wantsLeaveForm, clearLeaveAction] = useActionParam('leave');
  const showForm = formOpenedLocally || wantsLeaveForm;
  const closeForm = () => {
    setShowForm(false);
    if (wantsLeaveForm) clearLeaveAction();
  };

  /** Цонхыг серверээс дахин уншина.  Хуудас удаан нээлттэй байсны дараа
   *  18:00 өнгөрсөн байж мэдэх тул форм нээх бүрд шинэчилнэ. */
  const refreshWindow = async () => {
    try {
      const res = await apiFetch<{
        window: LeaveWindow;
        message: string | null;
        lunch?: LeaveLunchWire;
      }>('/leaves/window');
      setLeaveWindow(res.window);
      setWindowMessage(res.message);
      setLunch(lunchFromWire(res.lunch));
    } catch {
      // Цонхыг тодорхойлж чадаагүй бол формыг хаахгүй — хатуу шалгалт
      // серверийн POST дээр хэвээр байгаа тул хүсэлт тэндээ таслагдана.
      setLeaveWindow(null);
      setWindowMessage(null);
    }
  };

  const refresh = async () => {
    try {
      const res = await apiFetch<{ leaves: LeaveRequest[] }>('/leaves/my');
      setLeaves(res.leaves);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('myLeavesCard.loadFailed'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
    refreshWindow();
  }, []);

  // Форм нээгдэх агшинд цонхыг дахин шалгана.
  useEffect(() => {
    if (showForm) refreshWindow();
  }, [showForm]);

  const cancel = async (id: number) => {
    if (!(await confirmDialog({ description: t('myLeavesCard.cancelConfirm'), variant: 'destructive' }))) return;
    try {
      await apiFetch(`/leaves/${id}`, { method: 'DELETE' });
      refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('myLeavesCard.cancelFailed'));
    }
  };

  return (
    <>
      <RequestCardShell
        id="sec-attendance-leaves"
        icon={CalendarDays}
        iconClassName="text-primary"
        title={t('myLeavesCard.title')}
        headerBadges={
          leaves.filter((l) => l.status === 'pending').length > 0 && (
            <Badge variant="outline" className={cn('text-micro', APPROVAL_STATUS_TONE.pending)}>
              {t('myLeavesCard.pendingCount', {
                count: leaves.filter((l) => l.status === 'pending').length,
              })}
            </Badge>
          )
        }
        onNew={() => setShowForm(true)}
        newLabel={t('myLeavesCard.newRequest')}
        loading={loading}
        error={error}
        isEmpty={leaves.length === 0}
        emptyIcon={CalendarDays}
        emptyText={t('myLeavesCard.emptyTitle')}
        emptyHint={t('myLeavesCard.emptyHint')}
      >
        {leaves.map((l) => {
          const typeMeta = TYPE_META[l.leave_type];
          const Icon = typeMeta.icon;
          // Хэрэв reason_code хадгалагдсан бол түүний label-ийг нарийвчилж
          // харуулна — хуучин бичлэгүүдийн хувьд leave_type-ийн ерөнхий нэр хэвээр.
          const policy = findLeavePolicy(l.reason_code ?? fallbackCodeFromType(l.leave_type));
          const displayLabel = policy?.label ?? t(typeMeta.labelKey);
          const isPaid = l.is_paid !== null ? l.is_paid === 1 : policy?.is_paid ?? null;
          return (
            <li key={l.id} className="py-3 flex items-start gap-3">
              <div
                className={cn(
                  'h-9 w-9 rounded-lg flex items-center justify-center border shrink-0',
                  typeMeta.tone,
                )}
              >
                <Icon className="h-4 w-4" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-medium">{displayLabel}</span>
                  {isPaid !== null && (
                    <Badge
                      variant="outline"
                      className={cn(
                        'text-micro',
                        isPaid
                          ? 'border-success/30 text-success bg-success/10'
                          : 'border-warning/30 text-warning bg-warning/10',
                      )}
                    >
                      {isPaid ? t('myLeavesCard.paid') : t('myLeavesCard.unpaidBadge')}
                    </Badge>
                  )}
                  {policy && (
                    <Badge variant="outline" className="text-micro font-mono">
                      {policy.rule_id}
                    </Badge>
                  )}
                  {l.requires_ceo_approval && (
                    <Badge
                      variant="outline"
                      className="text-micro border-violet-300 text-violet-700 bg-violet-50 dark:bg-violet-900/20"
                    >
                      {t('myLeavesCard.ceoOrder')}
                    </Badge>
                  )}
                  <RequestStatusBadge status={l.status} labelPrefix="myLeavesCard" />
                  <span className="text-micro text-muted-foreground tabular-nums ml-auto">
                    {fmtHoursLabel(l.hours, l.days, t)}
                  </span>
                </div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  {fmtDate(l.start_date)} → {fmtDate(l.end_date)}
                  {fmtTimeRange(l.start_time, l.end_time) && (
                    <span className="ml-1.5 tabular-nums">
                      · {fmtTimeRange(l.start_time, l.end_time)}
                    </span>
                  )}
                </div>
                <LeaveArrivalCutNote leave={l} />
                {l.reason && (
                  <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{l.reason}</p>
                )}
                {l.reviewer_note && (
                  <p className="text-micro mt-1 px-2 py-1 rounded bg-muted/50 border border-border/50">
                    <span className="font-medium">
                      {l.reviewer_name ?? t('myLeavesCard.management')}:
                    </span>{' '}
                    {l.reviewer_note}
                  </p>
                )}
                {l.policy_warnings && l.policy_warnings.length > 0 && (
                  <ul className="mt-1 space-y-0.5">
                    {l.policy_warnings.map((w, i) => (
                      <li
                        key={i}
                        className="flex items-start gap-1.5 text-micro text-warning"
                      >
                        <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />
                        <span>{w}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              {l.status === 'pending' && (
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7 text-muted-foreground hover:text-destructive shrink-0"
                  onClick={() => cancel(l.id)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              )}
            </li>
          );
        })}
      </RequestCardShell>

      <LeaveRequestDialog
        open={showForm}
        onClose={closeForm}
        onCreated={refresh}
        leaveWindow={leaveWindow}
        windowMessage={windowMessage}
        lunch={lunch}
      />
      {/* <LeavePolicyDialog open={showPolicy} onClose={() => setShowPolicy(false)} /> — журам түр идэвхгүй */}
    </>
  );
}

function LeaveRequestDialog({
  open,
  onClose,
  onCreated,
  leaveWindow,
  windowMessage,
  lunch,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
  /** `GET /leaves/window`-ийн үр дүн.  `null` бол уншиж чадаагүй — формыг
   *  хаахгүй, сервер POST дээр шалгана. */
  leaveWindow: LeaveWindow | null;
  windowMessage: string | null;
  /** Цайны цонх (`/leaves/window`) — цагтай чөлөөнөөс хасагдана. */
  lunch: LeaveLunch;
}) {
  const { t } = useLanguage();
  // `reason_code` нь шинэ нарийвчилсан таксоном (Дотоод журам 11.5.x / 11.7).
  // `type` (leave_type) нь үүнээс автоматаар уламжлагдана.
  const [reasonCode, setReasonCode] = useState<string>('annual_vacation');
  const [start, setStart] = useState(() => addDaysIso(todayIso(), 1));
  const [end, setEnd] = useState(() => addDaysIso(todayIso(), 1));
  const [reason, setReason] = useState('');
  /** Шалтгааныг АВТОМАТААР бөглөсөн бол түүний утга — ажилтны гараар
   *  бичсэн текстийг санамсаргүй дарж бичихээс сэргийлнэ. */
  const autoReasonRef = useRef('');
  const [duration, setDuration] = useState<DurationMode>('full');
  const [startTime, setStartTime] = useState<string>('13:00');
  const [endTime, setEndTime] = useState<string>('15:00');
  const [attachment, setAttachment] = useState<string>('');
  const [attachName, setAttachName] = useState<string>('');
  // `day_part='am'` үед сервер цагийг ЭЭЛЖЭЭС гаргана — ажилтан илгээхээсээ
  // өмнө ЯГ ямар цаг болохыг харах ёстой (одоогийн default нь 13:00 тул
  // «4 цаг» сонгоход ҮДЭЭС ХОЙШ бичигдэх эрсдэлтэй байсан).
  const [forDate, setForDate] = useState<LeaveWindowForDate | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // const [policyOpen, setPolicyOpen] = useState(false); // "Танилцах" dialog түр идэвхгүй

  // Огнооны доод хязгаар — бүтэн өдрийн чөлөө хамгийн эрт МАРГААШ,
  // цагаар авах чөлөө өнөөдөр (гэхдээ одооноос хойш) эхэлж болно.
  const serverToday = leaveWindow?.today ?? todayIso();
  const minFullDayDate = leaveWindow?.min_full_day_date ?? addDaysIso(serverToday, 1);

  // Reset on open.  Огноог браузерын "маргааш"-аар л эхлүүлнэ — серверийн
  // цонх ирэхэд доорх clamp effect үүнийг зөв өдөр рүү өргөнө (браузерын
  // UTC огноо UB-гээс хэзээ ч ХОЖУУ байхгүй тул зөвхөн өргөх л хэрэгтэй).
  // Тиймээс энэ effect `minFullDayDate`-аас САНААТАЙГААР хамаарахгүй —
  // цонх ирэх агшинд хэрэглэгчийн бөглөсөн формыг арчихгүйн тулд.
  useEffect(() => {
    if (open) {
      setReasonCode('annual_vacation');
      setStart(addDaysIso(todayIso(), 1));
      setEnd(addDaysIso(todayIso(), 1));
      setReason('');
      setDuration('full');
      setStartTime('');
      setEndTime('');
      setAttachment('');
      setAttachName('');
      setError(null);
      autoReasonRef.current = '';
    }
  }, [open]);

  // `fixed_day_part`-тэй кодыг сонгоход хугацааны сонголтыг цоожилно —
  // `hour_cap` нь ХЭЗЭЭ Ч хориглодоггүй тул «Бүтэн өдөр» сонгосон цалинтай
  // код бүтэн өдрийн цалин болж бичигдэх эрсдэлтэй.  Сервер ч мөн адил
  // дардаг (`policy.fixed_day_part`), энэ нь зөвхөн UI-ийн тольдолт.
  useEffect(() => {
    const fp = POLICY_BY_CODE[reasonCode]?.fixed_day_part;
    if (fp) setDuration(fp);
  }, [reasonCode]);

  // Шалтгаан нь кодоороо тодорхой үед («Хүүхдийн хичээлийн нээлт») заавал
  // бичүүлэх нь утгагүй — автоматаар бөглөнө.  `autoReasonRef` нь ЗӨВХӨН
  // өөрийн бичсэн утгыг дарж бичихийг зөвшөөрнө: ажилтан гараар нэмсэн
  // тайлбарыг код солиход АРЧИХГҮЙ.
  useEffect(() => {
    const p = POLICY_BY_CODE[reasonCode];
    if (p?.fixed_event) {
      setReason((prev) => (!prev.trim() || prev === autoReasonRef.current ? p.label : prev));
      autoReasonRef.current = p.label;
    } else if (autoReasonRef.current) {
      const prevAuto = autoReasonRef.current;
      autoReasonRef.current = '';
      setReason((prev) => (prev === prevAuto ? '' : prev));
    }
  }, [reasonCode]);

  const selectedPolicy = POLICY_BY_CODE[reasonCode] ?? null;
  const groupedPolicy = useMemo(() => groupPolicy(), []);
  // Тогтмол өдрийн хэсэгтэй код — өөр хугацаа сонгох боломжгүй.  Мөн
  // «4 цаг» гэсэн гурван ижил товчны эндүү дарах эрсдэлийг арилгана.
  // Тогтсон өдрийн арга хэмжээ (хичээлийн нээлт г.м): огноо цоожтой,
  // шалтгаан нь кодын нэрээр автоматаар бөглөгдөнө.
  const isFixedEvent = !!selectedPolicy?.fixed_event;
  const durationOptions = selectedPolicy?.fixed_day_part
    ? DURATION_OPTIONS.filter((o) => o.id === selectedPolicy.fixed_day_part)
    : DURATION_OPTIONS;

  const computedDays = diffDays(start, end);

  // Сонгосон duration-аас "хүсэлтийн хүчин зүйл"-ийг тооцъё.
  // - full: end-start + 1 өдөр × 8 цаг
  // - half/h4/h2: яг 4/4/2 цаг (нэг өдөрт ноогдуулна)
  let finalHours: number | null;
  if (duration === 'full') {
    finalHours = computedDays * STD_DAY;
  } else if (duration === 'range') {
    // Цайны цаг тооцогдохгүй — серверийн `leaveRangeHours`-тэй ижил.
    finalHours = startTime && endTime ? leaveRangeHours(startTime, endTime, lunch) : null;
  } else if (duration === 'am') {
    // Цонх нь ээлж эхлэхээс 12:00 хүртэл тул урт нь ээлжээс хамаарна
    // (08:00→4ц, 08:30→3.5ц, 09:00→3ц).  Серверээс уншсан утгыг харуулна;
    // ирээгүй бол тоо ЗОХИОХГҮЙ — эцсийн тооцоог сервер хийнэ.
    finalHours = forDate?.am.hours ?? null;
  } else {
    finalHours = DURATION_OPTIONS.find((o) => o.id === duration)?.hours ?? null;
  }
  const finalDays =
    finalHours == null ? computedDays : Math.round((finalHours / STD_DAY) * 100) / 100;
  // Нэг өдрөөс бага цагтай хүсэлтэд эхлэх ба дуусах огноог нэг өдөр болгоно.
  const isSubDay = duration !== 'full';

  // Сонгож болох хамгийн эрт огноо.  Цагаар авах чөлөө өнөөдөр байж
  // болох тул `serverToday`, бүтэн өдрийнх маргаашаас.
  // 'am' нь ЯГ ээлжийн эхлэлээс эхэлдэг тул тухайн өдөр нь аль хэдийн
  // өнгөрсөн байна — бүтэн өдрийн адил хамгийн эрт МАРГААШ.
  const minDate = isSubDay && duration !== 'am' ? serverToday : minFullDayDate;
  // Өнөөдрийн цагийн чөлөө одоогийн цагаас хойш эхэлнэ.
  const minTimeToday = start === serverToday ? leaveWindow?.min_time_today ?? null : null;
  /** Цонх хаалттай (ажлын бус цаг / амралтын өдөр) — формыг харуулахгүй. */
  const windowClosed = !!leaveWindow && !leaveWindow.open;

  // Цонх серверээс ирэх эсвэл хугацааны горим солигдоход огноог доод
  // хязгаар руу ӨРГӨНӨ (хэзээ ч буулгахгүй — хэрэглэгчийн сонголт хэвээр).
  useEffect(() => {
    if (!open) return;
    setStart((prev) => (prev < minDate ? minDate : prev));
    setEnd((prev) => (prev < minDate ? minDate : prev));
  }, [open, minDate]);

  // Сонгосон ӨДРИЙН ээлжийг серверээс уншина.  `leaveWindow` нь ӨНӨӨДРИЙН
  // цонх тул ирээдүйн чөлөөнд ашиглаж БОЛОХГҮЙ (зун бүгдийг 08:00 болгодог).
  useEffect(() => {
    if (!open || duration !== 'am' || !start) {
      setForDate(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await apiFetch<{ for_date: LeaveWindowForDate | null }>(
          `/leaves/window?date=${start}`,
        );
        if (!cancelled) setForDate(res.for_date);
      } catch {
        // Уншиж чадаагүй ч формыг хаахгүй — цагийг СЕРВЕР эцэслэн шийднэ.
        if (!cancelled) setForDate(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, duration, start]);

  const handleAttachment = async (file: File | null) => {
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const url = await uploadFile(file);
      setAttachment(url);
      setAttachName(file.name);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('myLeavesCard.uploadFailed'));
    } finally {
      setUploading(false);
    }
  };

  const submit = async () => {
    if (!start || !end) {
      setError(t('myLeavesCard.errEnterDate'));
      return;
    }
    if (end < start) {
      setError(t('myLeavesCard.errEndBeforeStart'));
      return;
    }
    // Ажлын цагийн цонхны толин шалгалт — эцсийн шийдвэрийг сервер
    // (`lib/leaveWindow.ts`) гаргана, энд зөвхөн шуурхай хариу өгнө.
    if (leaveWindow && !leaveWindow.open) {
      setError(windowMessage ?? t('myLeavesCard.windowClosedShort'));
      return;
    }
    if ((!isSubDay || duration === 'am') && start < minFullDayDate) {
      setError(t('myLeavesCard.errFullDayMinDate', { date: minFullDayDate }));
      return;
    }
    if (isSubDay && duration !== 'am' && start < serverToday) {
      setError(t('myLeavesCard.errPastDate'));
      return;
    }
    if (isSubDay && duration !== 'am' && !startTime) {
      setError(t('myLeavesCard.errSelectStartTime'));
      return;
    }
    if (isSubDay && duration !== 'am' && minTimeToday && startTime < minTimeToday) {
      setError(t('myLeavesCard.errTimeInPast', { now: minTimeToday }));
      return;
    }
    if (duration === 'range' && !endTime) {
      setError(t('myLeavesCard.errSelectEndTime'));
      return;
    }
    if (duration === 'range' && (!finalHours || finalHours <= 0)) {
      setError(t('myLeavesCard.errEndTimeAfterStart'));
      return;
    }
    if (duration === 'range' && finalHours && finalHours > STD_DAY) {
      setError(t('myLeavesCard.errMax8h'));
      return;
    }
    if (!reason.trim() && !isFixedEvent) {
      setError(t('myLeavesCard.errEnterReason'));
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      // Нэг өдрөөс бага хүсэлтийг яг тэр өдөрт ногдуулах тул
      // start = end болгож илгээе.
      const startD = isSubDay ? start : start;
      const endD = isSubDay ? start : end;
      await apiFetch('/leaves', {
        data: {
          // `leave_type` нь policy-аас уламжлагдсан (сервер reason_code-оос
          // дахин тогтоох ч давхар илгээж back-compat нөхөрсөг байлгана).
          leave_type: selectedPolicy?.leave_type ?? 'other',
          reason_code: reasonCode,
          start_date: startD,
          end_date: endD,
          hours: finalHours ?? undefined,
          days: finalDays,
          // `day_part` илгээвэл сервер цагийг ЭЭЛЖЭЭС гаргаад hours/days-ыг
          // дахин тооцно — тиймээс цагийг ЗААВАЛ null-аар илгээнэ, эс тэгвэл
          // хуучин бичсэн утга үлдэж хоёр эх сурвалж зөрөх эрсдэлтэй.
          day_part: duration === 'am' ? 'am' : undefined,
          start_time: duration === 'am' ? null : isSubDay ? startTime : null,
          end_time:
            duration === 'am'
              ? null
              : isSubDay
                ? duration === 'range'
                  ? endTime
                  : finalHours != null
                    ? addLeaveWorkHours(startTime, finalHours, lunch)
                    : null
                : null,
          reason: reason.trim() || (isFixedEvent ? selectedPolicy?.label ?? null : null),
          attachment_url: attachment || null,
        },
      });
      onCreated();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('myLeavesCard.submitFailed'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CalendarDays className="h-5 w-5 text-primary" />
            {t('myLeavesCard.dialogTitle')}
          </DialogTitle>
        </DialogHeader>

        {windowClosed ? (
          /* Ажлын бус цаг / амралтын өдөр — вэбээр хүсэлт авахгүй.
             Утсаар залгах дугаар эсвэл message бичих сонголтыг ЗОРИУДААР
             харуулахгүй (шийдвэр 2026-08-13). */
          <>
            <div className="space-y-3 py-2">
              <div className="flex items-start gap-3 rounded-lg border border-warning/30 bg-warning/10 px-3 py-3">
                <Lock className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
                <div className="space-y-1">
                  <p className="text-sm font-medium">{t('myLeavesCard.windowClosedTitle')}</p>
                  <p className="text-xs text-muted-foreground">
                    {windowMessage ?? t('myLeavesCard.windowClosedShort')}
                  </p>
                </div>
              </div>
              <p className="text-micro text-muted-foreground">
                {t('myLeavesCard.windowClosedHint')}
              </p>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={onClose}>
                {t('common.close')}
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
        <div className="space-y-4 py-2">
          {error && (
            <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-destructive/10 border border-destructive/30 text-destructive text-sm">
              <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" /> {error}
            </div>
          )}

          {/* Урьдчилан мэдэгдэх дүрэм — бүтэн өдрийн чөлөө маргаашаас. */}
          <p className="text-micro text-muted-foreground rounded-lg border border-border/60 bg-muted/30 px-3 py-2">
            {t('myLeavesCard.advanceNoticeHint', { date: minFullDayDate })}
          </p>

          <div className="space-y-1.5">
            <Label className="text-xs">{t('myLeavesCard.reasonLabel')}</Label>
            <Select value={reasonCode} onValueChange={(v) => setReasonCode(v)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="max-h-80">
                {groupedPolicy.map((g) => (
                  <div key={g.group} className="py-1">
                    <p className="px-2 pt-1 pb-1 text-label text-muted-foreground font-medium">
                      {g.label}
                    </p>
                    {g.items.map((p) => {
                      // leave_type-аас тохирох icon-ийг авъя (хуучин TYPE_META reused).
                      const Icon = TYPE_META[p.leave_type].icon;
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
                  {selectedPolicy.is_paid ? t('myLeavesCard.paid') : t('myLeavesCard.unpaidBadge')}
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
            <Label className="text-xs">{t('myLeavesCard.durationLabel')}</Label>
            <div className="grid grid-cols-3 gap-1.5">
              {durationOptions.map((o) => (
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
                <Label className="text-xs">{t('myLeavesCard.startDate')}</Label>
                <Input
                  type="date"
                  value={start}
                  min={minDate}
                  onChange={(e) => setStart(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">{t('myLeavesCard.endDate')}</Label>
                <Input
                  type="date"
                  value={end}
                  min={start}
                  onChange={(e) => setEnd(e.target.value)}
                />
              </div>
            </div>
          ) : (
            <div className="space-y-1.5">
              <Label className="text-xs">{t('myLeavesCard.dateLabel')}</Label>
              <Input
                type="date"
                value={start}
                min={minDate}
                disabled={isFixedEvent}
                className={cn(isFixedEvent && 'bg-muted/40 cursor-not-allowed')}
                onChange={(e) => {
                  if (isFixedEvent) return;
                  setStart(e.target.value);
                  setEnd(e.target.value);
                }}
              />
              {isFixedEvent && (
                <p className="text-micro text-muted-foreground">
                  {t('myLeavesCard.dateLockedHint')}
                </p>
              )}
              {duration !== 'am' && (
              <div className="grid grid-cols-2 gap-3 pt-1">
                <div className="space-y-1.5">
                  <Label className="text-xs">
                    {t('myLeavesCard.startTime')} <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    type="time"
                    required
                    value={startTime}
                    min={minTimeToday ?? undefined}
                    onChange={(e) => setStartTime(e.target.value)}
                    className={cn(
                      (!startTime || (minTimeToday && startTime < minTimeToday)) &&
                        'border-destructive/60',
                    )}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">
                    {t('myLeavesCard.endTime')}
                    {duration === 'range' && <span className="text-destructive"> *</span>}
                  </Label>
                  {duration === 'range' ? (
                    <Input
                      type="time"
                      required
                      value={endTime}
                      min={startTime}
                      onChange={(e) => setEndTime(e.target.value)}
                      className={cn(!endTime && 'border-destructive/60')}
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
                      className="bg-muted/40 cursor-not-allowed"
                    />
                  )}
                </div>
              </div>
              )}
              {duration === 'am' && (
                <div className="rounded-lg border border-border/60 bg-muted/30 px-3 py-2">
                  <p className="text-xs font-medium tabular-nums">
                    {forDate
                      ? t('myLeavesCard.amWindow', {
                          start: forDate.am.start_time,
                          end: forDate.am.end_time,
                          hours: forDate.am.hours,
                        })
                      : t('myLeavesCard.amResolving')}
                  </p>
                </div>
              )}
              <p className="text-micro text-muted-foreground">
                {duration === 'am'
                  ? t('myLeavesCard.amHint')
                  : duration === 'range'
                    ? t('myLeavesCard.rangeHint')
                    : t('myLeavesCard.autoEndHint')}
              </p>
              {lunch &&
                duration !== 'am' &&
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

          <div className="rounded-lg border border-primary/20 bg-primary/5 px-3 py-2 text-xs flex items-center justify-between">
            <span className="text-muted-foreground">{t('myLeavesCard.totalRequest')}</span>
            <span className="font-semibold text-primary tabular-nums">
              {finalHours != null
                ? fmtHoursLabel(finalHours, finalDays, t)
                : duration === 'am'
                  ? '…'
                  : t('myLeavesCard.daysLabel', { days: computedDays })}
            </span>
          </div>

          {/* Журмын зөөлөн сэрэмжлүүлэг — серверт нэмэлт сар/улирлын
              сэрэмжлүүлэг тооцох тул, энд UI-д шуурхай зөвлөмж л харуулна. */}
          {(() => {
            const p = selectedPolicy;
            const warnings: string[] = [];
            if (p?.day_cap !== undefined && finalDays > p.day_cap) {
              warnings.push(
                t('myLeavesCard.warnDayCap', {
                  rule: p.rule_id,
                  label: p.label,
                  cap: p.day_cap,
                  requested: finalDays,
                }),
              );
            }
            if (p?.hour_cap !== undefined && finalHours !== null && finalHours > p.hour_cap) {
              warnings.push(
                t('myLeavesCard.warnHourCap', {
                  rule: p.rule_id,
                  label: p.label,
                  cap: p.hour_cap,
                  requested: finalHours,
                }),
              );
            }
            const ceoRequired = finalDays >= CEO_APPROVAL_DAY_THRESHOLD;
            if (!warnings.length && !ceoRequired) return null;
            return (
              <div className="space-y-1.5">
                {ceoRequired && (
                  <div className="flex items-start gap-2 rounded-lg border border-violet-300 bg-violet-50 dark:bg-violet-900/20 px-3 py-2 text-micro text-violet-800 dark:text-violet-300">
                    <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    <span>{t('myLeavesCard.ceoRequiredWarn')}</span>
                  </div>
                )}
                {warnings.map((w, i) => (
                  <div
                    key={i}
                    className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-micro text-amber-800 dark:text-amber-300"
                  >
                    <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    <span>{w}</span>
                  </div>
                ))}
                <p className="text-micro text-muted-foreground">
                  {t('myLeavesCard.warnButCanSubmit')}
                </p>
              </div>
            );
          })()}

          <div className="space-y-1.5">
            <Label className="text-xs">
              {t('myLeavesCard.reasonFieldLabel')}
              {!isFixedEvent && <span className="text-destructive"> *</span>}
            </Label>
            <Textarea
              rows={3}
              placeholder={t('myLeavesCard.reasonPlaceholder')}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className={cn(!reason.trim() && !isFixedEvent && 'border-destructive/60')}
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs flex items-center gap-1">
              <Paperclip className="h-3 w-3" />
              {t('myLeavesCard.attachment')}{' '}
              <span className="text-muted-foreground font-normal">
                {t('myLeavesCard.attachmentHint')}
              </span>
            </Label>
            {attachment ? (
              <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-success/10 border border-success/30 text-success text-xs">
                <CheckCircle2 className="h-3.5 w-3.5" />
                <span className="truncate flex-1">{attachName}</span>
                <button
                  type="button"
                  className="text-success hover:text-emerald-900"
                  onClick={() => {
                    setAttachment('');
                    setAttachName('');
                  }}
                >
                  ✕
                </button>
              </div>
            ) : (
              <Input
                type="file"
                accept="image/*,application/pdf"
                disabled={uploading}
                onChange={(e) => handleAttachment(e.target.files?.[0] ?? null)}
              />
            )}
            {uploading && (
              <p className="text-micro text-muted-foreground flex items-center gap-1.5">
                <Loader2 className="h-3 w-3 animate-spin" /> {t('myLeavesCard.uploading')}
              </p>
            )}
          </div>

        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={submitting}>
            {t('common.cancel')}
          </Button>
          <Button onClick={submit} disabled={submitting || uploading}>
            {submitting ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> {t('myLeavesCard.submitting')}
              </>
            ) : (
              <>
                <Clock className="h-3.5 w-3.5 mr-1.5" /> {t('myLeavesCard.submitRequest')}
              </>
            )}
          </Button>
        </DialogFooter>
          </>
        )}
      </DialogContent>
      {/* <LeavePolicyDialog open={policyOpen} onClose={() => setPolicyOpen(false)} /> — журам түр идэвхгүй */}
    </Dialog>
  );
}

/* 2026-06: LeavePolicyDialog түр идэвхгүй — журам шинэчлэгдэх хүртэл.
   Чөлөө олгох журмыг бүтэн харуулах modal байсан ("Танилцах" болон
   толгойн "Журамтай танилцах" товчоор нээгддэг).  Сэргээхдээ дээрх
   LEAVE_POLICY_RULES блок, BookOpen import, холбогдох товч/state-уудтай
   хамт буцааж нээнэ.
function LeavePolicyDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <BookOpen className="h-5 w-5 text-primary" />
            {LEAVE_POLICY_SECTION_TITLE}
          </DialogTitle>
          <p className="text-[11px] text-muted-foreground font-mono">{LEAVE_POLICY_DOC_LABEL}</p>
        </DialogHeader>
        <div className="max-h-[60vh] overflow-y-auto rounded border border-border/60 bg-background px-4 py-3 space-y-2 text-[12px] leading-relaxed">
          {LEAVE_POLICY_RULES.map((rule) => (
            <div key={rule.id}>
              <p>
                <span className="font-semibold tabular-nums mr-1.5">{rule.id}</span>
                {rule.text}
              </p>
              {rule.children && rule.children.length > 0 ? (
                <ul className="mt-1 ml-5 space-y-1">
                  {rule.children.map((sub) => (
                    <li key={sub.id} className="text-muted-foreground">
                      <span className="font-mono tabular-nums mr-1.5">{sub.id}</span>
                      {sub.text}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ))}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Хаах
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
*/
