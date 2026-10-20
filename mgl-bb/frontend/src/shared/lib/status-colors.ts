/**
 * Статусын өнгө — нэг эх үүсвэр (single source of truth).
 *
 * Доорх className газрын зургууд нь semantic статус token
 * (`--success` / `--warning` / `--info` / `--danger`, `index.css`-д
 * тодорхойлсон) дээр тулгуурлана. Тэдгээр нь light/dark-д дасан зохицож,
 * хэрэглэгчийн accent override-той (зөвхөн `--primary` / `--ring` /
 * `--sidebar-*`-д хүрдэг) огт мөргөлдөхгүй. Raw Tailwind палитр
 * (`bg-emerald-500/10` гэх мэт)-ийн оронд эдгээрийг хэрэглэснээр нэг
 * статус хаана ч ижил харагдана.
 *
 * Зөөлөн (soft) badge → `bg-success/10 text-success border-success/30`.
 * Дүүрэн (solid) badge → `bg-success text-success-foreground`.
 *
 * `*_HEX` газрын зургууд нь Tailwind класс хэрэглэх боломжгүй орчинд
 * зориулагдсан — canvas / SVG / recharts / puppeteer-аар render-лэгддэг
 * PDF. Тэдний утга нь `index.css`-ийн `.light` scope-ийн token утгатай
 * нүдээр таарч байх ёстой ("Status colors (light scope)" блок).
 */

import type { LeaveType, ProjectStatus } from '@/shared/types';

// Статусын төлөвүүдийн нэрс — shared модулийг feature-ээс хараат бус
// байлгахын тулд локал union (quote-ийн төрөл features дотор амьдардаг,
// эдгээр нь түүнтэй бүтцийн хувьд таарна).
type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';
type AttendanceStatus = 'on_time' | 'late' | 'on_leave' | 'absent';
type LeaderboardTier = 'top' | 'mid' | 'low';
type QuoteStatus = 'draft' | 'sent' | 'active' | 'lost';

/* ─────────────── Зөөлөн badge / chip (tinted bg + token text) ─────────────── */

export const APPROVAL_STATUS_TONE: Record<ApprovalStatus, string> = {
  pending: 'bg-warning/10 text-warning border-warning/30',
  approved: 'bg-success/10 text-success border-success/30',
  rejected: 'bg-danger/10 text-danger border-danger/30',
  cancelled: 'bg-muted text-muted-foreground border-border',
};

/** Дүүрэн pill (идэвхтэй фильтр): bg + foreground. */
export const APPROVAL_STATUS_SOLID: Record<ApprovalStatus, string> = {
  pending: 'bg-warning text-warning-foreground border-warning',
  approved: 'bg-success text-success-foreground border-success',
  rejected: 'bg-danger text-danger-foreground border-danger',
  cancelled: 'bg-muted text-muted-foreground border-muted',
};

/** Ирц / өдрийн тайлангийн статус. on_time→success, late→warning,
 *  on_leave→info, absent→danger. */
export const ATTENDANCE_STATUS_TONE: Record<AttendanceStatus, string> = {
  on_time: 'bg-success/10 text-success border-success/30',
  late: 'bg-warning/10 text-warning border-warning/30',
  on_leave: 'bg-info/10 text-info border-info/30',
  absent: 'bg-danger/10 text-danger border-danger/30',
};

export const PROJECT_STATUS_TONE: Record<ProjectStatus, string> = {
  active: 'bg-info/10 text-info border-info/30',
  completed: 'bg-success/10 text-success border-success/30',
  archived: 'bg-muted text-muted-foreground border-border',
};

/** Үнийн саналын борлуулалтын юүлүүрийн шат (migration 0168).
 *  Өнгө нь юүлүүрийн УТГААР: draft→neutral (юүлүүрт хараахан ороогүй),
 *  sent→info (хүлээгдэж буй), active→success (гэрээ болсон), lost→danger.
 *  Шатны багц нь `features/quotes/types/quotes.ts`-ийн `QUOTE_STATUSES` ба
 *  серверийн `routes/quotes.ts`-ийн ижил нэртэй тогтмолтой хамт өөрчлөгдөнө. */
export const QUOTE_STATUS_TONE: Record<QuoteStatus, string> = {
  draft: 'bg-muted text-muted-foreground border-border',
  sent: 'bg-info/10 text-info border-info/30',
  active: 'bg-success/10 text-success border-success/30',
  lost: 'bg-danger/10 text-danger border-danger/30',
};

/** Leaderboard зэрэглэл — зүүн талын зураас + мөрийн tint. */
export const LEADERBOARD_TIER_TONE: Record<LeaderboardTier, string> = {
  top: 'border-l-4 border-l-success bg-success/10 hover:bg-success/15',
  mid: 'border-l-4 border-l-info bg-info/10 hover:bg-info/15',
  low: 'border-l-4 border-l-danger bg-danger/10 hover:bg-danger/15',
};

/** Чөлөөний төрөл — статус биш, категори. Гэхдээ AttendanceAdminPage +
 *  MyLeavesCard хоёр нэг эх үүсвэр хуваалцахын тулд энд нэгтгэв.
 *  sick→danger, unpaid→warning, annual→info; `remote` нь violet хэвээр
 *  (semantic token-гүй — категорийн онцгой тохиолдол), `other` → neutral. */
export const LEAVE_TYPE_TONE: Record<LeaveType, string> = {
  annual: 'border-info/30 bg-info/10 text-info',
  sick: 'border-danger/30 bg-danger/10 text-danger',
  unpaid: 'border-warning/30 bg-warning/10 text-warning',
  remote:
    'border-violet-300 bg-violet-50 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300',
  other: 'border-border bg-muted text-muted-foreground',
};

/* ─────────────── Хэрэглэгчийн дүрийн badge (нэг эх үүсвэр) ───────────────
 * Өмнө нь ChatPage / UsersPage / ProfilePage / DashboardPage / CompanyDashboard
 * зэрэг 5+ файлд тус тусын raw палитртайгаар (нэг дүр өөр өөр өнгөтэй) гараар
 * бичигдсэн байсныг энд нэгтгэв. admin→danger, senior→warning, architect→info,
 * engineer→primary, client→neutral. */
export const ROLE_BADGE_TONE: Record<string, string> = {
  admin: 'bg-danger/10 text-danger border-danger/30',
  senior: 'bg-warning/10 text-warning border-warning/30',
  architect: 'bg-info/10 text-info border-info/30',
  engineer: 'bg-primary/10 text-primary border-primary/30',
  client: 'bg-muted text-muted-foreground border-border',
};

/** Дүрийн зөөлөн badge класс. Тодорхойгүй дүр → neutral. */
export function roleBadgeTone(role: string | null | undefined): string {
  return ROLE_BADGE_TONE[(role ?? '').toLowerCase()] ?? 'bg-muted text-muted-foreground border-border';
}

/* ─────────────── Прогрессын хувь → tone (нэг эх үүсвэр) ───────────────
 * `progressTone`/`progressBar` нь өмнө нь TeamsPage / TeamDetailPage /
 * CompanyDashboard-д ялгаатай threshold + өнгөний системтэйгээр
 * хуулагдсан байв. Нэг bucket-ийн дүрэм: <34 danger, <67 warning, <100 info,
 * =100 success — статус token дээр тулгуурлана. */
export function progressTone(pct: number): string {
  if (pct >= 100) return 'text-success';
  if (pct >= 67) return 'text-info';
  if (pct >= 34) return 'text-warning';
  return 'text-danger';
}

/** Прогресс баарны дүүргэлтийн өнгө — `progressTone`-той ижил bucket. */
export function progressBarClass(pct: number): string {
  if (pct >= 100) return 'bg-success';
  if (pct >= 67) return 'bg-info';
  if (pct >= 34) return 'bg-warning';
  return 'bg-danger';
}

/* ─────────────── HEX (зөвхөн canvas / SVG / recharts / PDF) ───────────────
 * CSS var нь recharts/canvas/PDF орчинд найдвартай уншигддаггүй тул JS
 * талын канон hex эх үүсвэр. Утга нь дээрх token-ийн `.light`-scope
 * сүүдэртэй НҮДЭЭР таарна. */

export const ATTENDANCE_STATUS_HEX: Record<AttendanceStatus, string> = {
  on_time: '#10b981',
  late: '#f59e0b',
  on_leave: '#0ea5e9',
  absent: '#f43f5e',
};

export const PROJECT_STATUS_HEX: Record<ProjectStatus, string> = {
  active: '#0ea5e9',
  completed: '#10b981',
  archived: '#6b7280',
};
