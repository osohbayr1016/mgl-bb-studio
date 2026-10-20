/**
 * «Баримт бичиг» жагсаалтын мөрөн дэх гарын үсгийн тэмдэг — `POST …/signing/statuses`
 * (зөвхөн D1).  Хүсэлтгүй ч ERP-ээр зурсан гарын үсэгтэй бол «N гарын үсэг».
 * CR: захирал баталсан ч захиалагч зураагүй бол «Захиалагчийн гарын үсэг дутуу» (RFI-д шаардахгүй)
 * (2026-10-19) — «Батлагдсан» нь захиалагч зурсны дараа л.
 */
import { BadgeCheck, Clock3, Link2, PenLine, Undo2, UserRoundPen } from 'lucide-react';
import { useLanguage } from '@/shared/i18n';
import { cn } from '@/shared/lib/utils';
import { awaitingClient, type FileSignStatus } from './types';

export function SigningBadge({ status }: { status: FileSignStatus | undefined }) {
  const { t } = useLanguage();
  if (!status) return null;
  const base = 'inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-px text-label normal-case tracking-normal';
  if (awaitingClient(status.request_status, status.client)) {
    const linkSent = (status.links_pending ?? 0) > 0;
    return (
      <span
        className={cn(base, 'bg-warning/15 text-warning')}
        title={linkSent ? `${t('docSign.badgeClientMissingHint')} · ${t('docSign.statusClientLinkSent')}` : t('docSign.badgeClientMissingHint')}
        data-testid="doc-sign-badge"
        data-state="client-missing"
      >
        {linkSent ? <Link2 className="h-3 w-3" /> : <UserRoundPen className="h-3 w-3" />} {t('docSign.badgeClientMissing')}
      </span>
    );
  }
  if (status.request_status === 'pending') {
    return (
      <span className={cn(base, 'bg-warning/15 text-warning')} title={t('docSign.badgePendingHint')} data-testid="doc-sign-badge">
        <Clock3 className="h-3 w-3" /> {t('docSign.badgePending')}
      </span>
    );
  }
  if (status.request_status === 'approved') {
    return (
      <span className={cn(base, 'bg-success/15 text-success')} data-testid="doc-sign-badge">
        <BadgeCheck className="h-3 w-3" /> {t('docSign.badgeApproved')}
      </span>
    );
  }
  if (status.request_status === 'returned') {
    return (
      <span className={cn(base, 'bg-danger/15 text-danger')} data-testid="doc-sign-badge">
        <Undo2 className="h-3 w-3" /> {t('docSign.badgeReturned')}
      </span>
    );
  }
  // Гаднын хүнд (захиалагч) илгээсэн link гарын үсэг хүлээж байна (0397).
  if ((status.links_pending ?? 0) > 0) {
    return (
      <span className={cn(base, 'bg-primary/10 text-primary')} title={t('docSign.badgeLinkHint')} data-testid="doc-sign-badge">
        <Link2 className="h-3 w-3" /> {t('docSign.badgeLink')}
      </span>
    );
  }
  if (status.signatures > 0) {
    return (
      <span className={cn(base, 'bg-muted text-muted-foreground')} data-testid="doc-sign-badge">
        <PenLine className="h-3 w-3" /> {t('docSign.badgeSigned', { n: status.signatures })}
      </span>
    );
  }
  return null;
}
