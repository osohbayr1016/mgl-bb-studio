import type { ComponentType } from 'react';
import type { LeaveRequest, LeaveType, OutOfOfficeCategory } from '@/shared/types';
import type { TranslationKey, TParams } from '@/shared/i18n';
import { APPROVAL_STATUS_TONE, LEAVE_TYPE_TONE } from '@/shared/lib/status-colors';
import {
  Plane,
  Stethoscope,
  Wallet,
  Laptop,
  FileText,
  Hourglass,
  CheckCircle2,
  XCircle,
  Trash2,
  Eye,
  Users,
  Ruler,
  GraduationCap,
  MoreHorizontal,
} from 'lucide-react';

/** `useLanguage().t`-ийн гарын үсэг — hook бус (component-гүй) туслахуудад дамжуулна. */
export type TFn = (key: TranslationKey, params?: TParams) => string;

type IconType = ComponentType<{ className?: string }>;

// ---------------------------------------------------------------------------
// Leave-type / status decoration shared between today / leaves tabs.
// Mirrors MyLeavesCard so visual language stays consistent.
// ---------------------------------------------------------------------------
export const LEAVE_TYPE_META: Record<
  LeaveType,
  { labelKey: string; icon: IconType; tone: string }
> = {
  annual: {
    labelKey: 'attendanceAdminPage.leaveTypeAnnual',
    icon: Plane,
    tone: LEAVE_TYPE_TONE.annual,
  },
  sick: {
    labelKey: 'attendanceAdminPage.leaveTypeSick',
    icon: Stethoscope,
    tone: LEAVE_TYPE_TONE.sick,
  },
  unpaid: {
    labelKey: 'attendanceAdminPage.leaveTypeUnpaid',
    icon: Wallet,
    tone: LEAVE_TYPE_TONE.unpaid,
  },
  remote: {
    labelKey: 'attendanceAdminPage.leaveTypeRemote',
    icon: Laptop,
    tone: LEAVE_TYPE_TONE.remote,
  },
  other: {
    labelKey: 'attendanceAdminPage.leaveTypeOther',
    icon: FileText,
    tone: LEAVE_TYPE_TONE.other,
  },
};

export const LEAVE_STATUS_META: Record<
  LeaveRequest['status'],
  { labelKey: string; className: string; icon: IconType }
> = {
  pending: {
    labelKey: 'attendanceAdminPage.statusPending',
    icon: Hourglass,
    className: APPROVAL_STATUS_TONE.pending,
  },
  approved: {
    labelKey: 'attendanceAdminPage.statusApproved',
    icon: CheckCircle2,
    className: APPROVAL_STATUS_TONE.approved,
  },
  rejected: {
    labelKey: 'attendanceAdminPage.statusRejected',
    icon: XCircle,
    className: APPROVAL_STATUS_TONE.rejected,
  },
  cancelled: {
    labelKey: 'attendanceAdminPage.statusCancelled',
    icon: Trash2,
    className: APPROVAL_STATUS_TONE.cancelled,
  },
};

// Ажлаас гадуурх цагийн шалтгааны ангилал — MyOutOfOfficeCard-тай ижил.
export const OOO_CATEGORY_META: Record<OutOfOfficeCategory, { labelKey: string; icon: IconType }> =
  {
    author_supervision: { labelKey: 'attendanceAdminPage.oooAuthorSupervision', icon: Eye },
    meeting: { labelKey: 'attendanceAdminPage.oooMeeting', icon: Users },
    documents: { labelKey: 'attendanceAdminPage.oooDocuments', icon: FileText },
    drawings: { labelKey: 'attendanceAdminPage.oooDrawings', icon: Ruler },
    class: { labelKey: 'attendanceAdminPage.oooClass', icon: GraduationCap },
    other: { labelKey: 'attendanceAdminPage.oooOther', icon: MoreHorizontal },
  };

// ---------------------------------------------------------------------------
// Хураангуй хүснэгтийн эрэмбэлэлт (sortable columns)
// ---------------------------------------------------------------------------
export type SummarySortKey =
  | 'name'
  | 'expected_days'
  | 'present_days'
  | 'expected_minutes'
  | 'credited_minutes'
  | 'leave_minutes'
  | 'annual_leave_days'
  | 'out_of_office_minutes'
  | 'late_minutes'
  | 'total_minutes';

export type SummarySort = { key: SummarySortKey; dir: 'asc' | 'desc' };

/** Ирцийн самбарын табууд — `?tab=` параметрийн зөвшөөрөгдөх утгууд.
 *
 *  ⚠️ Эдгээр таб утгууд БОЛОН `sec-att-admin-*` id-ууд нь глобал хайлтын гүн
 *  холбоосын (deep-link) зорилтууд бөгөөд
 *  `frontend/src/shared/lib/search/sections.ts`-д давхардаж бичигдсэн —
 *  нэгийг нь өөрчилвөл нөгөөг нь заавал дагуулж засна. */
export const ATTENDANCE_ADMIN_TABS = [
  'today',
  'open',
  'reports',
  'summary',
  'leaves',
  'outofoffice',
  'shifts',
  'ips',
] as const;
export type AttendanceAdminTab = (typeof ATTENDANCE_ADMIN_TABS)[number];

// ---------------------------------------------------------------------------
// «Ажлын цаг» табын эрэмбэлэлт — хэн аль ээлжийг сонгосон бэ.
// ---------------------------------------------------------------------------

/** ⚠️ `shift` нь ЦАГААР эрэмбэлнэ (08:00 → 08:30 → 09:00), цагаан толгойгоор
 *  БИШ.  Эзний шаардлага нь яг «8-17, 8:30-17:30, 9-18-аар нь эрэмбэлэх» тул
 *  дараалал нь `SHIFT_KEYS`-ийн индекс (`features/attendance/shifts.ts`). */
export type ShiftSortKey = 'name' | 'team' | 'shift' | 'chosen';

export type ShiftSort = { key: ShiftSortKey; dir: 'asc' | 'desc' };

/** Чөлөөний дэд таб — `?leaveType=` параметрийн утгууд. */
export const LEAVE_TYPE_TABS = ['other', 'annual'] as const;

/** Хаагдаагүй бүртгэлийн хуудаслалтын хэмжээ. */
export const OPEN_PAGE_SIZE = 20;
