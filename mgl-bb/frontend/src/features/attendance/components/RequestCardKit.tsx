/**
 * Shared building blocks for the three "my request" cards on the attendance
 * page — leave (MyLeavesCard) and out-of-office
 * (MyOutOfOfficeCard). These were near-identical structural triplicates that
 * had drifted apart visually; this kit single-sources the parts that drifted:
 *
 *   - RequestStatusBadge — the approval-status pill (icon + APPROVAL_STATUS_TONE).
 *   - RequestCardShell    — the Card frame: header (icon + title + badges + a
 *                           "new request" button), error banner, loading
 *                           spinner, empty state, and the <ul> list wrapper.
 *
 * The entity-specific bits (list-item rows + the request dialog) stay in each
 * card, since the fields genuinely differ (leave types/balance vs
 * hours vs out-of-office categories).
 */
import type { ComponentType, ReactNode } from 'react';
import { CheckCircle2, XCircle, Trash2, Hourglass, Plus, AlertCircle, Loader2 } from 'lucide-react';
import { Badge } from '@/ui/badge';
import { Button } from '@/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/ui/card';
import { cn } from '@/shared/lib/utils';
import { APPROVAL_STATUS_TONE } from '@/shared/lib/status-colors';
import { useLanguage } from '@/shared/i18n';

type IconType = ComponentType<{ className?: string }>;
export type RequestStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';

const STATUS_ICON: Record<RequestStatus, IconType> = {
  pending: Hourglass,
  approved: CheckCircle2,
  rejected: XCircle,
  cancelled: Trash2,
};

const STATUS_LABEL_SUFFIX: Record<RequestStatus, string> = {
  pending: 'statusPending',
  approved: 'statusApproved',
  rejected: 'statusRejected',
  cancelled: 'statusCancelled',
};

/**
 * Approval-status pill. `labelPrefix` is the consumer card's i18n namespace
 * (e.g. 'myLeavesCard') — the label resolves to
 * `<labelPrefix>.status{Pending|Approved|Rejected|Cancelled}`, which all three
 * cards already define.
 */
export function RequestStatusBadge({
  status,
  labelPrefix,
}: {
  status: RequestStatus;
  labelPrefix: string;
}) {
  const { t } = useLanguage();
  const Icon = STATUS_ICON[status];
  return (
    <Badge variant="outline" className={cn('text-micro gap-1', APPROVAL_STATUS_TONE[status])}>
      <Icon className="h-3 w-3" /> {t(`${labelPrefix}.${STATUS_LABEL_SUFFIX[status]}`)}
    </Badge>
  );
}

/**
 * The Card frame shared by the three request cards. Renders the list `<ul>`
 * around `children` when not loading/empty; the caller maps its own items into
 * `<li>` rows.
 */
export function RequestCardShell({
  id,
  icon: Icon,
  iconClassName,
  title,
  headerBadges,
  onNew,
  newLabel,
  loading,
  error,
  isEmpty,
  emptyIcon: EmptyIcon,
  emptyText,
  emptyHint,
  children,
}: {
  /**
   * Глобал хайлтын deep-link (`?section=<id>`) онилох DOM id.  Заавал биш —
   * өгвөл гадна `<Card>` дээр суух ба наалт header-т далдлагдахгүйн тулд
   * `scroll-mt-24` нэмэгдэнэ.
   */
  id?: string;
  icon: IconType;
  iconClassName?: string;
  title: ReactNode;
  /** Extra badges next to the title (pending count, approved hours, …). */
  headerBadges?: ReactNode;
  onNew: () => void;
  newLabel: ReactNode;
  loading: boolean;
  error?: string | null;
  isEmpty: boolean;
  emptyIcon: IconType;
  emptyText: ReactNode;
  emptyHint?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Card id={id} className={cn('border-border bg-card/60 backdrop-blur', id && 'scroll-mt-24')}>
      <CardHeader className="pb-3 flex flex-row flex-wrap items-center justify-between gap-2">
        <CardTitle className="flex items-center flex-wrap gap-2 text-base min-w-0">
          <Icon className={cn('h-4 w-4 shrink-0', iconClassName)} />
          {title}
          {headerBadges}
        </CardTitle>
        <Button size="sm" className="gap-1.5 shrink-0 ml-auto" onClick={onNew}>
          <Plus className="h-3.5 w-3.5" />
          {newLabel}
        </Button>
      </CardHeader>
      <CardContent>
        {error && (
          <div className="flex items-center gap-2 mb-3 px-3 py-2 rounded-lg bg-destructive/10 border border-destructive/30 text-destructive text-sm">
            <AlertCircle className="h-4 w-4" /> {error}
          </div>
        )}
        {loading ? (
          <div className="py-8 text-center text-muted-foreground text-sm">
            <Loader2 className="h-5 w-5 animate-spin mx-auto" />
          </div>
        ) : isEmpty ? (
          <div className="text-center py-8 text-muted-foreground">
            <EmptyIcon className="h-8 w-8 mx-auto mb-2 opacity-30" />
            <p className="text-sm">{emptyText}</p>
            {emptyHint && <p className="text-xs mt-1">{emptyHint}</p>}
          </div>
        ) : (
          <ul className="divide-y divide-border/40">{children}</ul>
        )}
      </CardContent>
    </Card>
  );
}
