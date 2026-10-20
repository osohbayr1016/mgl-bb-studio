import {
  Bell,
  BellRing,
  ClipboardCheck,
  ClipboardX,
  ClipboardList,
  UserPlus,
  CalendarCheck,
  CalendarClock,
  CalendarX,
  CalendarOff,
  Timer,
  Lightbulb,
  MessageSquareText,
  Sprout,
  HardHat,
  Megaphone,
  Inbox,
  FileCheck2,
  PenLine,
  Building2,
  TrendingDown,
  Move3d,
  LifeBuoy,
  Bug,
} from 'lucide-react';
import type { NotificationType } from '@/shared/types';

/**
 * Мэдэгдлийн төрөл → icon.
 *
 * Толгойн bell (`NotificationBell`) болон `/app/notifications` хуудас
 * хоёулаа эндээс уншина — ингэснээр шинэ төрөл нэмэхэд хоёр газар
 * зассан эсэхээ санах шаардлагагүй.
 */
export function iconFor(type: NotificationType) {
  switch (type) {
    case 'progress_pending':
      return <ClipboardList className="h-4 w-4 text-warning" />;
    case 'progress_approved':
      return <ClipboardCheck className="h-4 w-4 text-success" />;
    case 'progress_rejected':
      return <ClipboardX className="h-4 w-4 text-danger" />;
    case 'task_assigned':
      return <UserPlus className="h-4 w-4 text-primary" />;
    case 'leave_requested':
      return <CalendarClock className="h-4 w-4 text-warning" />;
    case 'leave_approved':
      return <CalendarCheck className="h-4 w-4 text-success" />;
    case 'leave_rejected':
      return <CalendarX className="h-4 w-4 text-danger" />;
    case 'leave_cancelled':
      return <CalendarOff className="h-4 w-4 text-muted-foreground" />;
    case 'attendance_adjusted':
      return <Timer className="h-4 w-4 text-primary" />;
    case 'attendance_confirm_requested':
      return <ClipboardList className="h-4 w-4 text-warning" />;
    case 'attendance_confirm_responded':
      return <ClipboardCheck className="h-4 w-4 text-success" />;
    // Удирдлагаас бүх ажилтанд цацсан ирцийн журмын зарлал.
    case 'attendance_announcement':
      return <Megaphone className="h-4 w-4 text-warning" />;
    // Нийтийн мэдээлэл — нийтлэгдэв / дахин баталгаажуулна уу / сануулга.
    case 'announcement_published':
      return <Megaphone className="h-4 w-4 text-primary" />;
    // Ур чадварын үнэлгээ — бөглөх ёстой маягт.
    case 'assessment_assigned':
      return <ClipboardList className="h-4 w-4 text-primary" />;
    case 'assessment_submitted':
      return <ClipboardCheck className="h-4 w-4 text-primary" />;
    case 'suggestion_submitted':
      return <Lightbulb className="h-4 w-4 text-warning" />;
    case 'suggestion_updated':
      return <MessageSquareText className="h-4 w-4 text-primary" />;
    case 'suggestion_resolved':
      return <Lightbulb className="h-4 w-4 text-success" />;
    case 'pgp_feedback':
      return <Sprout className="h-4 w-4 text-success" />;
    case 'asr_submitted':
      return <HardHat className="h-4 w-4 text-warning" />;
    case 'asr_approved':
      return <HardHat className="h-4 w-4 text-success" />;
    case 'asr_rejected':
      return <HardHat className="h-4 w-4 text-danger" />;
    // Зохиогчийн хяналтын хуваарь — «чи талбайд явна» / хуваарь цуцлагдав.
    case 'asr_visit_assigned':
      return <HardHat className="h-4 w-4 text-primary" />;
    case 'asr_visit_cancelled':
      return <CalendarX className="h-4 w-4 text-muted-foreground" />;
    // Төслийн хугацаа дөхсөн/хэтэрсэн сануулга.
    case 'project_deadline':
      return <CalendarClock className="h-4 w-4 text-warning" />;
    // Удирдлагаас «хөдөл» гэж түлхсэн сануулга.
    case 'project_nudge':
      return <BellRing className="h-4 w-4 text-primary" />;
    // Захиалагчийн портал — ирсэн материал / хянасан хариу / нийтлэл / чат,
    // RFI·CR-ийн гарын үсгийн хүсэлт ба зурагдсан баримт (0335).  Урьд нь
    // зургаа нь ерөнхий хонх байсан — бусад бүх төрөл өөрийн дүрстэй атлаа.
    case 'client_submission_received':
      return <Inbox className="h-4 w-4 text-primary" />;
    case 'client_submission_reviewed':
      return <FileCheck2 className="h-4 w-4 text-success" />;
    case 'client_publication':
      return <Building2 className="h-4 w-4 text-primary" />;
    case 'client_message':
      return <MessageSquareText className="h-4 w-4 text-primary" />;
    case 'client_signature_requested':
      return <PenLine className="h-4 w-4 text-warning" />;
    case 'client_signed':
      return <PenLine className="h-4 w-4 text-success" />;
    // Word баримтын гарын үсэг — «зурна уу / батлана уу» ба захирлын шийдвэр.
    case 'doc_sign_requested':
      return <PenLine className="h-4 w-4 text-warning" />;
    case 'doc_sign_decided':
      return <PenLine className="h-4 w-4 text-success" />;
    // Захирлаас багийн ахлах руу — гишүүдийн бүтээмжийн зөрүү босгоос их.
    case 'team_gap_warning':
      return <TrendingDown className="h-4 w-4 text-danger" />;
    // Revit «Өөрчлөхөөс өмнө» — элемент зөөгдөж таны элементтэй огтлолцов.
    case 'revit_change_notice':
      return <Move3d className="h-4 w-4 text-warning" />;
    // Програмын хүсэлт — reviewer-т шинэ хүсэлт / илгээгчийн хариу; илгээгчид төлөвийн шинэчлэл.
    case 'engineering_request_new':
      return <LifeBuoy className="h-4 w-4 text-primary" />;
    case 'engineering_request_activity':
      return <LifeBuoy className="h-4 w-4 text-warning" />;
    case 'engineering_request_update':
      return <Bug className="h-4 w-4 text-primary" />;
    default:
      return <Bell className="h-4 w-4 text-muted-foreground" />;
  }
}
