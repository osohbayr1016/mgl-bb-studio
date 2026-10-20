import { useState } from 'react';
import { CheckCircle2, ClipboardList, Loader2, RefreshCw, XCircle } from 'lucide-react';
import { ApiError, mediaUrl } from '@/shared/api/client';
import { useLanguage } from '@/shared/i18n';
import { cn } from '@/shared/lib/utils';
import { formatDate, formatDateTime } from '@/shared/lib/time';
import { formatDisplayName } from '@/shared/lib/formatting';
import { teamChipClass } from '@/shared/lib/team-colors';
import { toast } from '@/shared/components/Toast';
import { Avatar, AvatarFallback, AvatarImage } from '@/ui/avatar';
import { Badge } from '@/ui/badge';
import { Button } from '@/ui/button';
import { Card, CardContent } from '@/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/ui/dialog';
import LeaveFilterPill from '@/features/attendance/admin/components/LeaveFilterPill';
import { OptionalNoteField } from '@/features/attendance/admin/components/DialogFields';
import { STAGE_TONE, categoryLabel, entryTimeLabel } from '@/features/non-project-work/lib';
import { useDecideNonProjectWork, useNonProjectReview } from '../api';
import type { NonProjectReviewFilter, NonProjectReviewItem } from '../types';
import { fmtPts } from '../lib/format';

type Action = 'approve' | 'reject';

/** Шүүлтийн товч бүрийн өнгө — `LeaveFilterPill`-ийн tone (чөлөө/OOO-той ижил семантик). */
const PILLS: { value: NonProjectReviewFilter; tone: 'yellow' | 'slate' | 'emerald' | 'rose' | 'muted' }[] = [
  { value: 'awaiting_review', tone: 'yellow' },
  { value: 'needs_report', tone: 'slate' },
  { value: 'approved', tone: 'emerald' },
  { value: 'rejected', tone: 'rose' },
  { value: 'all', tone: 'muted' },
];

/**
 * «Төслийн бус ажлын тайлан» таб — ажилтны ИЛГЭЭСЭН төслийн бус ажлыг админ
 * шалгаж батлах / татгалзах (`/api/reports/non-project-work`).
 *
 * Урсгал: ажилтан бүртгэнэ → хийнэ → «юу хийсэн» тайлбараа бичиж илгээнэ →
 * ЭНД шалгана.  Өгөгдмөл шүүлт нь шалгалт хүлээж буй ажил, хамгийн удаан
 * хүлээсэн нь дээрээ.  «Тайлбар бичээгүй» нь ажилтан хараахан илгээгээгүй
 * ажил — зөвхөн харагдана, шийдвэр гаргах боломжгүй (сервер ч 409).
 *
 * Батлахад оноо (засвартай ижил: өдрийн дундаж × цаг / 8) бүтээмжид орно;
 * хүлээгдэж буй / татгалзсан ажил орохгүй.
 */
export function NonProjectWorkTab() {
  const { t } = useLanguage();
  const [filter, setFilter] = useState<NonProjectReviewFilter>('awaiting_review');
  const query = useNonProjectReview(filter);
  const decide = useDecideNonProjectWork();
  const [reviewing, setReviewing] = useState<{ item: NonProjectReviewItem; action: Action } | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const counts = query.data?.counts ?? { awaiting_review: 0, needs_report: 0, approved: 0, rejected: 0 };
  const total = counts.awaiting_review + counts.needs_report + counts.approved + counts.rejected;
  const items = query.data?.items ?? [];

  const open = (item: NonProjectReviewItem, action: Action) => {
    setReviewing({ item, action });
    setNote('');
  };

  const submit = async () => {
    if (!reviewing || busy) return;
    setBusy(true);
    try {
      const item = await decide(reviewing.item.id, reviewing.action, note.trim() || null);
      toast.success(
        reviewing.action === 'approve'
          ? t('reportsPage.npwApprovedToast', { pct: fmtPts(item?.computed_pct ?? 0) })
          : t('reportsPage.npwRejectedToast'),
      );
      setReviewing(null);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t('common.error'));
      // Өөр админ түрүүлж шийдсэн байж болно — жагсаалтыг шинэчилнэ.
      void query.refetch();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        {PILLS.map((p) => (
          <LeaveFilterPill
            key={p.value}
            label={p.value === 'all' ? t('common.all') : t(`nonProjectWork.stage.${p.value}`)}
            count={p.value === 'all' ? total : counts[p.value]}
            active={filter === p.value}
            tone={p.tone}
            onClick={() => setFilter(p.value)}
          />
        ))}
        <Button
          size="sm"
          variant="ghost"
          className="ml-auto gap-1.5"
          disabled={query.isFetching}
          onClick={() => void query.refetch()}
        >
          <RefreshCw className={cn('h-3.5 w-3.5', query.isFetching && 'animate-spin')} />
          {t('attendanceAdminPage.refresh')}
        </Button>
      </div>

      <p className="text-xs text-muted-foreground">{t('reportsPage.npwHint')}</p>

      <Card className="border-border bg-card/60">
        <CardContent className="p-0">
          {query.isLoading && !query.data ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            </div>
          ) : query.isError && !query.data ? (
            <div className="p-10 text-center text-sm text-danger">{t('common.error')}</div>
          ) : items.length === 0 ? (
            <div className="p-10 text-center text-muted-foreground">
              <ClipboardList className="mx-auto mb-2 h-8 w-8 opacity-30" />
              <p className="text-sm">{t('reportsPage.npwEmpty')}</p>
            </div>
          ) : (
            <ul className="divide-y divide-border/50" data-testid="npw-review-list">
              {items.map((item) => (
                <ReviewRow key={item.id} item={item} onDecide={open} />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
      {query.data?.truncated && <p className="text-xs text-muted-foreground">{t('reportsPage.npwTruncated')}</p>}

      <Dialog open={!!reviewing} onOpenChange={(o) => !o && !busy && setReviewing(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {reviewing?.action === 'approve' ? (
                <CheckCircle2 className="h-5 w-5 text-success" />
              ) : (
                <XCircle className="h-5 w-5 text-destructive" />
              )}
              {reviewing?.action === 'approve' ? t('reportsPage.npwApproveTitle') : t('reportsPage.npwRejectTitle')}
            </DialogTitle>
            <DialogDescription>
              {reviewing?.action === 'approve' ? t('reportsPage.npwApproveHint') : t('reportsPage.npwRejectHint')}
            </DialogDescription>
          </DialogHeader>
          {reviewing && (
            <div className="space-y-3 py-1">
              <div className="text-sm">
                <span className="font-medium">{formatDisplayName(reviewing.item.user.full_name ?? reviewing.item.user.username)}</span>
                {' · '}
                <span className="text-muted-foreground">
                  {categoryLabel(reviewing.item.category, reviewing.item.category_label, t)}
                  {reviewing.item.note && ` · ${reviewing.item.note}`}
                </span>
              </div>
              <div className="text-xs tabular-nums text-muted-foreground">
                {formatDate(new Date(reviewing.item.date))} · {entryTimeLabel(reviewing.item, t)}
              </div>
              {reviewing.item.report && (
                <p className="whitespace-pre-wrap break-words rounded border border-border/50 bg-muted/50 px-3 py-2 text-xs">
                  {reviewing.item.report}
                </p>
              )}
              <OptionalNoteField rows={3} value={note} onChange={setNote} />
            </div>
          )}
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" disabled={busy} onClick={() => setReviewing(null)}>
              {t('common.cancel')}
            </Button>
            <Button
              variant={reviewing?.action === 'reject' ? 'destructive' : 'default'}
              className="gap-1.5"
              disabled={busy}
              onClick={() => void submit()}
              data-testid="npw-review-confirm"
            >
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              {reviewing?.action === 'approve' ? t('reportsPage.npwApprove') : t('reportsPage.npwReject')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** Нэг бүртгэл: хэн, ямар ажил, хэзээ, хэдэн цаг, юу хийсэн, төлөв, шийдвэр. */
function ReviewRow({ item, onDecide }: { item: NonProjectReviewItem; onDecide: (item: NonProjectReviewItem, action: Action) => void }) {
  const { t } = useLanguage();
  const name = item.user.full_name ?? item.user.username;
  return (
    <li className="flex items-start gap-3 px-4 py-3" data-testid="npw-review-row" data-stage={item.stage} data-id={item.id}>
      <Avatar className="h-9 w-9 shrink-0">
        {item.user.profile_image && <AvatarImage src={mediaUrl(item.user.profile_image)} alt="" />}
        <AvatarFallback className="bg-primary/15 text-micro font-semibold text-primary">{name.slice(0, 2).toUpperCase()}</AvatarFallback>
      </Avatar>

      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-sm font-medium text-foreground">{formatDisplayName(name)}</span>
          {item.user.team_code && (
            <Badge variant="outline" className={cn('font-mono text-micro', teamChipClass(item.user.team_code))}>
              {item.user.team_code}
            </Badge>
          )}
          <Badge variant="outline" className={cn('text-micro', STAGE_TONE[item.stage])}>
            {t(`nonProjectWork.stage.${item.stage}`)}
          </Badge>
        </div>
        <div className="text-sm text-foreground">
          {categoryLabel(item.category, item.category_label, t)}
          {item.note && <span className="text-muted-foreground"> · {item.note}</span>}
        </div>
        <div className="text-xs tabular-nums text-muted-foreground">
          {formatDate(new Date(item.date))} ·{' '}
          <span className="font-medium text-foreground">{entryTimeLabel(item, t)}</span>
        </div>
        {item.report ? (
          <p className="whitespace-pre-wrap break-words rounded-md bg-muted/40 px-2 py-1 text-xs text-foreground">{item.report}</p>
        ) : (
          <p className="text-xs italic text-muted-foreground">{t('reportsPage.npwNoReport')}</p>
        )}

        {item.stage === 'approved' && item.computed_pct != null && (
          <p className="text-xs text-success" data-testid="npw-earned">
            {t('reportsPage.npwEarned', {
              rate: fmtPts(item.daily_rate ?? 0),
              hours: Math.round((item.minutes / 60) * 100) / 100,
              pct: fmtPts(item.computed_pct),
            })}
          </p>
        )}
        {item.reviewer && (
          <p className="text-micro text-muted-foreground">
            {t('reportsPage.npwDecidedBy', {
              name: formatDisplayName(item.reviewer.full_name ?? '—'),
              at: formatDateTime(item.reviewed_at),
            })}
          </p>
        )}
        {item.review_note && (
          <p className="rounded-md border border-border/50 bg-muted/50 px-2 py-1 text-micro">
            {t('nonProjectWork.reviewNote', { note: item.review_note })}
          </p>
        )}
      </div>

      {item.stage === 'awaiting_review' && (
        <div className="flex shrink-0 flex-col gap-1.5 sm:flex-row">
          <Button size="sm" className="h-8 gap-1" onClick={() => onDecide(item, 'approve')} data-testid="npw-approve">
            <CheckCircle2 className="h-3.5 w-3.5" />
            {t('reportsPage.npwApprove')}
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-8 gap-1 text-danger hover:text-danger"
            onClick={() => onDecide(item, 'reject')}
            data-testid="npw-reject"
          >
            <XCircle className="h-3.5 w-3.5" />
            {t('reportsPage.npwReject')}
          </Button>
        </div>
      )}
    </li>
  );
}
