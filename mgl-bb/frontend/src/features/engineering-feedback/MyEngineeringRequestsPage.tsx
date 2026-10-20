/**
 * «Миний програмын хүсэлт» — илгээгч өөрийн хүсэлтүүдийн дугаар, НИЙТИЙН төлөв, reviewer-ийн хариуг хардаг;
 * «Засвар бэлэн» болсон хүсэлтийг шалгаад «Ажиллаж байна» / «Засагдаагүй» гэж хариулна.
 *
 * Сервер зөвхөн ӨӨРИЙН мөрийг (`/mine`) буцаадаг: дотоод тэмдэглэл, ач холбогдол, commit/PR, бусдын хүсэлт,
 * нийт тоо ЭНД ХЭЗЭЭ Ч ирэхгүй.  `?id=` = сонгосон хүсэлт (мэдэгдлийн холбоос), `?action=new` = илгээх цонх.
 */
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Bug, ChevronLeft, FileText, Inbox, Loader2, Plus, RotateCcw, ThumbsUp } from 'lucide-react';
import { useLanguage } from '@/shared/i18n';
import { useActionParam } from '@/shared/hooks/useActionParam';
import { toast } from '@/shared/components/Toast';
import { PageContainer } from '@/shared/components/PageContainer';
import { PageHeader } from '@/shared/components/PageHeader';
import { Card, CardContent } from '@/ui/card';
import { Button } from '@/ui/button';
import { Badge } from '@/ui/badge';
import { Textarea } from '@/ui/textarea';
import { Skeleton } from '@/ui/skeleton';
import { cn } from '@/shared/lib/utils';
import { formatDateTime } from '@/shared/lib/time';
import { efKeys, fetchMine, fetchMineDetail, retest, type EfMineItem, type EfStatus } from './api';
import { formatBytes, newClientId, sourceKey, STATUS_TONE, typeKey } from './labels';
import { SubmitRequestDialog } from './SubmitRequestDialog';
import { useEfCapabilities } from './useEfCapabilities';
import { errorText } from './upload';

function StatusPill({ status, label }: { status: EfStatus; label: string }) {
  return (
    <Badge variant="outline" className={cn('border font-medium', STATUS_TONE[status])}>
      {label}
    </Badge>
  );
}

export default function MyEngineeringRequestsPage() {
  const { t } = useLanguage();
  const caps = useEfCapabilities();
  const [params, setParams] = useSearchParams();
  const selectedId = params.get('id');
  const [formOpenedLocally, setFormOpen] = useState(false);
  // Доод navbar / AccountMenu-ийн `?action=new` — URL-ыг local state руу хуулахгүй, гаргаж авна.
  const [wantsNew, clearNew] = useActionParam('new');
  const formOpen = formOpenedLocally || wantsNew;
  const onFormOpenChange = (open: boolean) => {
    setFormOpen(open);
    if (!open && wantsNew) clearNew();
  };

  const list = useQuery({ queryKey: efKeys.mine, queryFn: fetchMine, enabled: caps.canSubmit, refetchOnWindowFocus: true });
  const items = list.data?.items ?? [];

  const select = (id: string | null) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (id) next.set('id', id);
        else next.delete('id');
        return next;
      },
      { replace: false },
    );

  if (!caps.loading && !caps.canSubmit) {
    return (
      <PageContainer>
        <PageHeader title={t('pageTitle.myEngineeringRequests')} icon={Bug} />
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">{t('engFeedback.notAllowed')}</CardContent>
        </Card>
      </PageContainer>
    );
  }

  return (
    <PageContainer>
      <PageHeader
        title={t('pageTitle.myEngineeringRequests')}
        description={t('engFeedback.mineDescription')}
        icon={Bug}
        actions={
          <Button onClick={() => setFormOpen(true)} disabled={!caps.canSubmit} data-testid="ef-new">
            <Plus className="h-4 w-4" aria-hidden />
            {t('engFeedback.newButton')}
          </Button>
        }
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
        <Card className={cn(selectedId && 'hidden lg:block')}>
          <CardContent className="p-0">
            {list.isPending || caps.loading ? (
              <div className="space-y-2 p-4">
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
              </div>
            ) : items.length === 0 ? (
              <div className="flex flex-col items-center gap-2 px-4 py-10 text-center text-sm text-muted-foreground">
                <Inbox className="h-8 w-8" aria-hidden />
                {t('engFeedback.mineEmpty')}
              </div>
            ) : (
              <ul className="divide-y divide-border" data-testid="ef-mine-list">
                {items.map((it: EfMineItem) => (
                  <li key={it.id}>
                    <button
                      type="button"
                      onClick={() => select(it.id)}
                      className={cn(
                        'flex w-full flex-col gap-1 px-4 py-3 text-left transition-colors hover:bg-muted/50',
                        selectedId === it.id && 'bg-muted',
                      )}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono text-xs text-muted-foreground">{it.display_number ?? t('engFeedback.draftLabel')}</span>
                        <StatusPill status={it.status} label={it.status_label} />
                      </div>
                      <span className="line-clamp-2 text-sm font-medium">{it.title || t('engFeedback.untitled')}</span>
                      <span className="text-micro text-muted-foreground">
                        {t(typeKey(it.type))} · {formatDateTime(it.submitted_at ?? it.created_at)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <div className={cn(!selectedId && 'hidden lg:block')}>
          {selectedId ? (
            <MineDetail id={selectedId} onBack={() => select(null)} />
          ) : (
            <Card>
              <CardContent className="py-16 text-center text-sm text-muted-foreground">{t('engFeedback.pickOne')}</CardContent>
            </Card>
          )}
        </div>
      </div>

      <SubmitRequestDialog open={formOpen} onOpenChange={onFormOpenChange} onSubmitted={(r) => select(r.id)} />
    </PageContainer>
  );
}

function MineDetail({ id, onBack }: { id: string; onBack: () => void }) {
  const { t } = useLanguage();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: efKeys.mineDetail(id), queryFn: () => fetchMineDetail(id), refetchOnWindowFocus: true, retry: false });
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<null | 'works' | 'still_broken' | 'info'>(null);
  // Нэг үйлдэл = нэг client_event_id (давхар товшилт / timeout-ийн дараах давталт НЭГ үйл явдал).
  const [eventId, setEventId] = useState(() => newClientId('ret'));

  const act = async (action: 'works' | 'still_broken' | 'info') => {
    if (action === 'info' && !note.trim()) {
      toast.error(t('engFeedback.noteRequired'));
      return;
    }
    setBusy(action);
    try {
      const res = await retest(id, action, note.trim(), eventId);
      toast.success(t('engFeedback.retestSent'), res.status_label);
      setNote('');
      setEventId(newClientId('ret'));
      await Promise.all([qc.invalidateQueries({ queryKey: efKeys.mineDetail(id) }), qc.invalidateQueries({ queryKey: efKeys.mine })]);
    } catch (err) {
      toast.error(t('engFeedback.retestFailed'), errorText(err, ''));
    } finally {
      setBusy(null);
    }
  };

  if (q.isPending) {
    return (
      <Card>
        <CardContent className="space-y-3 p-6">
          <Skeleton className="h-6 w-1/2" />
          <Skeleton className="h-24 w-full" />
        </CardContent>
      </Card>
    );
  }
  if (q.isError || !q.data) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-sm text-muted-foreground">{t('engFeedback.notFound')}</CardContent>
      </Card>
    );
  }
  const { request: r, events, can_retest, can_reply } = q.data;
  const field = (label: string, value: string | null) =>
    value ? (
      <div className="space-y-1">
        <p className="text-label text-muted-foreground">{label}</p>
        <p className="whitespace-pre-wrap break-words text-sm">{value}</p>
      </div>
    ) : null;

  return (
    <Card data-testid="ef-mine-detail">
      <CardContent className="space-y-6 p-4 sm:p-6">
        <div className="space-y-2">
          <Button variant="ghost" size="sm" className="-ml-2 lg:hidden" onClick={onBack}>
            <ChevronLeft className="h-4 w-4" aria-hidden />
            {t('common.back')}
          </Button>
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-sm text-muted-foreground">{r.display_number ?? t('engFeedback.draftLabel')}</span>
            <StatusPill status={r.status} label={r.status_label} />
            <Badge variant="outline">{t(typeKey(r.type))}</Badge>
            <Badge variant="outline">{t(sourceKey(r.source))}</Badge>
          </div>
          <h2 className="text-lg font-semibold break-words">{r.title}</h2>
          <p className="text-micro text-muted-foreground">
            {t('engFeedback.submittedAt')}: {formatDateTime(r.submitted_at ?? r.created_at)}
            {r.tool_id ? ` · ${r.tool_id}` : ''}
          </p>
        </div>

        <div className="space-y-4">
          {field(t('engFeedback.fieldDescription'), r.description)}
          {field(t('engFeedback.fieldSteps'), r.steps)}
          {field(t('engFeedback.fieldExpected'), r.expected)}
          {field(t('engFeedback.fieldActual'), r.actual)}
          {field(t('engFeedback.fieldSuggestion'), r.suggestion)}
          {field(t('engFeedback.fieldImpact'), r.impact)}
        </div>

        {r.attachments.length > 0 && (
          <div className="space-y-2">
            <p className="text-label text-muted-foreground">{t('engFeedback.attachments')}</p>
            <ul className="space-y-1 text-sm">
              {r.attachments
                .filter((a) => a.state === 'ready')
                .map((a) => (
                  <li key={a.id} className="flex items-center gap-2">
                    <FileText className="h-4 w-4 text-muted-foreground" aria-hidden />
                    <span className="truncate">{a.name}</span>
                    <span className="text-micro text-muted-foreground">{formatBytes(a.size)}</span>
                  </li>
                ))}
            </ul>
          </div>
        )}

        {(can_retest || can_reply) && (
          <div className="space-y-3 rounded-lg border border-warning/30 bg-warning/5 p-4" data-testid="ef-retest">
            <p className="text-sm font-medium">{can_reply ? t('engFeedback.replyNeeded') : t('engFeedback.retestPrompt')}</p>
            <Textarea
              value={note}
              rows={3}
              onChange={(e) => setNote(e.target.value)}
              placeholder={can_reply ? t('engFeedback.replyPlaceholder') : t('engFeedback.retestNotePlaceholder')}
            />
            <div className="flex flex-wrap gap-2">
              {can_reply && (
                <Button onClick={() => void act('info')} disabled={!!busy} data-testid="ef-reply">
                  {busy === 'info' && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
                  {t('engFeedback.sendInfo')}
                </Button>
              )}
              {can_retest && r.status === 'ready_for_retest' && (
                <Button onClick={() => void act('works')} disabled={!!busy} data-testid="ef-works">
                  {busy === 'works' ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <ThumbsUp className="h-4 w-4" aria-hidden />}
                  {t('engFeedback.itWorks')}
                </Button>
              )}
              {can_retest && (
                <Button variant="outline" onClick={() => void act('still_broken')} disabled={!!busy} data-testid="ef-still-broken">
                  {busy === 'still_broken' ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <RotateCcw className="h-4 w-4" aria-hidden />}
                  {t('engFeedback.stillBroken')}
                </Button>
              )}
            </div>
          </div>
        )}

        <div className="space-y-3">
          <p className="text-label text-muted-foreground">{t('engFeedback.history')}</p>
          <ol className="space-y-3 border-l border-border pl-4">
            {events.map((e) => (
              <li key={e.id} className="relative space-y-1 text-sm">
                <span className="absolute -left-[1.3rem] top-1.5 h-2 w-2 rounded-full bg-border" aria-hidden />
                <p className="text-micro text-muted-foreground">
                  {formatDateTime(e.created_at)} · {t(`engFeedback.actor.${e.by}`)}
                </p>
                <p>
                  {e.kind === 'release'
                    ? t('engFeedback.releaseLine', { version: e.fixed_version ?? '', year: e.revit_year ?? t('engFeedback.allYears') })
                    : e.status
                      ? t('engFeedback.statusLine', { status: e.status })
                      : t(`engFeedback.event.${e.kind}`)}
                </p>
                {e.body && <p className="whitespace-pre-wrap break-words rounded-md bg-muted px-3 py-2">{e.body}</p>}
              </li>
            ))}
          </ol>
        </div>
      </CardContent>
    </Card>
  );
}
