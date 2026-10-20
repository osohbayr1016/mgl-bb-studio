/**
 * Санал хүсэлт — ажилтан санал илгээж явцаа дагадаг, admin хүлээн авч
 * шийдвэрлэдэг хуудас (header «Дүрэм» товчийг орлуулсан).
 *
 *   - Бүх staff:  «+ Шинэ санал хүсэлт» + өөрийн илгээсэн жагсаалт (timeline-тай).
 *   - Admin:      «Бүх санал» таб — хүлээн авах → хэлэлцэх → тийм/үгүй шийдвэрлэх.
 */
import { useEffect, useState } from 'react';
import { useActionParam } from '@/shared/hooks/useActionParam';
import { apiFetch, MEDIA_BASE_URL } from '@/shared/api/client';
import { useApiQuery } from '@/shared/api/useApi';
import { useAuth } from '@/shared/context/AuthContext';
import { useLanguage } from '@/shared/i18n';
import { confirmDialog } from '@/shared/components/ConfirmDialog';
import { toast } from '@/shared/components/Toast';
import { PageContainer } from '@/shared/components/PageContainer';
import { PageHeader } from '@/shared/components/PageHeader';
import { Card, CardContent } from '@/ui/card';
import { Button } from '@/ui/button';
import { Badge } from '@/ui/badge';
import { Textarea } from '@/ui/textarea';
import { Avatar, AvatarFallback, AvatarImage } from '@/ui/avatar';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/ui/tabs';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/ui/dialog';
import {
  Lightbulb,
  Plus,
  Loader2,
  Trash2,
  MessagesSquare,
  Check,
  X,
  UserRound,
  Inbox,
  Gavel,
} from 'lucide-react';
import type { Suggestion } from '@/shared/types';
import { cn } from '@/shared/lib/utils';
import { APPROVAL_STATUS_TONE } from '@/shared/lib/status-colors';
import { formatDisplayName } from '@/shared/lib/formatting';
import { formatDateTime } from '@/shared/lib/time';
import { SuggestionTimeline } from '@/features/suggestions/SuggestionTimeline';
import { SuggestionFormDialog } from '@/features/suggestions/SuggestionFormDialog';
import { SuggestionImageGrid } from '@/features/suggestions/SuggestionImageGrid';

type AdminCounts = { received: number; discussing: number; resolved: number };

export default function SuggestionsPage() {
  const { t } = useLanguage();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';

  const [formOpenedLocally, setShowForm] = useState(false);
  const [resolveTarget, setResolveTarget] = useState<Suggestion | null>(null);

  // Доод navbar-ын ⊕ → «Санал хүсэлт» (`/app/suggestions?action=new`).
  // URL-ыг local state руу хуулахгүй, гаргаж авна.
  const [wantsNewForm, clearNewAction] = useActionParam('new');
  const showForm = formOpenedLocally || wantsNewForm;
  const closeForm = () => {
    setShowForm(false);
    if (wantsNewForm) clearNewAction();
  };

  const myQuery = useApiQuery<{ suggestions: Suggestion[] }>('/suggestions/my');
  const adminQuery = useApiQuery<{ suggestions: Suggestion[]; counts: AdminCounts }>(
    ['/suggestions', 'admin'],
    '/suggestions',
    { enabled: isAdmin, refetchInterval: isAdmin ? 15_000 : false },
  );

  const mine = myQuery.data?.suggestions ?? [];
  const all = adminQuery.data?.suggestions ?? [];
  const counts = adminQuery.data?.counts;

  const reloadAll = () => {
    void myQuery.refetch();
    if (isAdmin) void adminQuery.refetch();
  };

  // ---- mutations --------------------------------------------------------
  const startDiscuss = async (id: number) => {
    try {
      await apiFetch(`/suggestions/${id}`, { method: 'PATCH', data: { status: 'discussing' } });
      toast.success(t('suggestionsPage.discussStarted'));
      reloadAll();
    } catch (e) {
      toast.error(t('common.error'), e instanceof Error ? e.message : '');
    }
  };

  const withdraw = async (id: number) => {
    const ok = await confirmDialog({
      description: t('suggestionsPage.withdrawConfirm'),
      variant: 'destructive',
    });
    if (!ok) return;
    try {
      await apiFetch(`/suggestions/${id}`, { method: 'DELETE' });
      reloadAll();
    } catch (e) {
      toast.error(t('common.error'), e instanceof Error ? e.message : '');
    }
  };

  // ---- render helpers ---------------------------------------------------
  const renderCard = (s: Suggestion, admin: boolean) => {
    const anon = s.is_anonymous === 1;
    const name = anon ? t('suggestionsPage.anonymous') : formatDisplayName(s.full_name ?? '');
    const avatarSrc = !anon && s.profile_image ? `${MEDIA_BASE_URL}${s.profile_image}` : undefined;
    const initials = name ? name.substring(0, 2).toUpperCase() : '?';

    return (
      <Card key={s.id} className="border-border bg-card/60 backdrop-blur">
        <CardContent className="p-4 space-y-3">
          <div className="flex items-start gap-3">
            {admin &&
              (anon ? (
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                  <UserRound className="h-4 w-4" />
                </div>
              ) : (
                <Avatar className="h-8 w-8 shrink-0">
                  {avatarSrc && <AvatarImage src={avatarSrc} alt={name} />}
                  <AvatarFallback className="bg-primary/20 text-primary text-micro font-semibold">
                    {initials}
                  </AvatarFallback>
                </Avatar>
              ))}
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-semibold text-foreground">{s.title}</span>
                {s.status === 'resolved' && (
                  <Badge
                    variant="outline"
                    className={cn(
                      'text-micro gap-1',
                      APPROVAL_STATUS_TONE[s.resolution === 'approved' ? 'approved' : 'rejected'],
                    )}
                  >
                    {s.resolution === 'approved' ? (
                      <Check className="h-3 w-3" />
                    ) : (
                      <X className="h-3 w-3" />
                    )}
                    {s.resolution === 'approved'
                      ? t('suggestionsPage.outcomeApproved')
                      : t('suggestionsPage.outcomeRejected')}
                  </Badge>
                )}
              </div>
              <p className="text-micro text-muted-foreground mt-0.5">
                {admin && <span className="font-medium">{name} · </span>}
                {formatDateTime(s.created_at)}
              </p>
            </div>
            {/* Ажилтан өөрийн хэлэлцэж эхлээгүй саналаа татаж болно. */}
            {!admin && s.status === 'received' && (
              <Button
                size="icon"
                variant="ghost"
                className="h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive"
                onClick={() => withdraw(s.id)}
                title={t('suggestionsPage.withdraw')}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>

          <p className="text-sm text-muted-foreground whitespace-pre-wrap break-words">
            {s.description}
          </p>

          {/* Хуучин бичлэгт `images` байхгүй тул `?? []` — 0179-аас өмнөх
              мөрүүд серверээс `[]` ирдэг ч кэшлэгдсэн хариу дээр `undefined`
              байж болно. */}
          <SuggestionImageGrid images={s.images ?? []} />

          <SuggestionTimeline status={s.status} className="pt-1 pb-0.5" />

          {s.reviewer_note && (
            <p className="text-micro mt-1 px-2.5 py-1.5 rounded bg-muted/50 border border-border/50">
              <span className="font-medium">
                {s.reviewer_name ?? t('suggestionsPage.admin')}:
              </span>{' '}
              {s.reviewer_note}
            </p>
          )}

          {/* Admin үйлдлүүд */}
          {admin && s.status !== 'resolved' && (
            <div className="flex flex-wrap gap-2 pt-1">
              {s.status === 'received' && (
                <Button size="sm" variant="outline" className="gap-1.5" onClick={() => startDiscuss(s.id)}>
                  <MessagesSquare className="h-3.5 w-3.5" />
                  {t('suggestionsPage.startDiscuss')}
                </Button>
              )}
              <Button size="sm" className="gap-1.5" onClick={() => setResolveTarget(s)}>
                <Gavel className="h-3.5 w-3.5" />
                {t('suggestionsPage.resolve')}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    );
  };

  const emptyState = (text: string) => (
    <div className="text-center py-12 text-muted-foreground">
      <Inbox className="h-9 w-9 mx-auto mb-2 opacity-30" />
      <p className="text-sm">{text}</p>
    </div>
  );

  const myList = myQuery.isLoading ? (
    <div className="py-12 text-center">
      <Loader2 className="h-6 w-6 animate-spin mx-auto text-primary" />
    </div>
  ) : mine.length === 0 ? (
    emptyState(t('suggestionsPage.emptyMine'))
  ) : (
    <div className="grid gap-3 sm:grid-cols-2">{mine.map((s) => renderCard(s, false))}</div>
  );

  const adminList = adminQuery.isLoading ? (
    <div className="py-12 text-center">
      <Loader2 className="h-6 w-6 animate-spin mx-auto text-primary" />
    </div>
  ) : all.length === 0 ? (
    emptyState(t('suggestionsPage.emptyAll'))
  ) : (
    <div className="grid gap-3 sm:grid-cols-2">{all.map((s) => renderCard(s, true))}</div>
  );

  return (
    <PageContainer>
      <PageHeader
        title={t('suggestionsPage.title')}
        description={t('suggestionsPage.subtitle')}
        icon={Lightbulb}
        actions={
          <Button className="gap-1.5" onClick={() => setShowForm(true)}>
            <Plus className="h-4 w-4" />
            {t('suggestionsPage.newRequest')}
          </Button>
        }
      />

      {isAdmin ? (
        <Tabs defaultValue="review" className="mt-2">
          <TabsList>
            <TabsTrigger value="review" className="gap-1.5">
              {t('suggestionsPage.tabReview')}
              {counts && counts.received > 0 && (
                <Badge
                  variant="outline"
                  className={cn('text-micro', APPROVAL_STATUS_TONE.pending)}
                >
                  {counts.received}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="mine">{t('suggestionsPage.tabMine')}</TabsTrigger>
          </TabsList>
          <TabsContent value="review" className="mt-4">
            {adminList}
          </TabsContent>
          <TabsContent value="mine" className="mt-4">
            {myList}
          </TabsContent>
        </Tabs>
      ) : (
        <div className="mt-4">{myList}</div>
      )}

      <SuggestionFormDialog
        open={showForm}
        onClose={closeForm}
        onCreated={reloadAll}
      />
      <ResolveDialog
        suggestion={resolveTarget}
        onClose={() => setResolveTarget(null)}
        onDone={reloadAll}
      />
    </PageContainer>
  );
}

/** Admin тийм/үгүй шийдвэрлэх dialog (заавал бус тэмдэглэлтэй). */
function ResolveDialog({
  suggestion,
  onClose,
  onDone,
}: {
  suggestion: Suggestion | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useLanguage();
  const [choice, setChoice] = useState<'approved' | 'rejected' | null>(null);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setChoice(null);
    setNote('');
  }, [suggestion?.id]);

  const submit = async () => {
    if (!suggestion || !choice) return;
    setSaving(true);
    try {
      await apiFetch(`/suggestions/${suggestion.id}`, {
        method: 'PATCH',
        data: { status: 'resolved', resolution: choice, note: note.trim() || undefined },
      });
      toast.success(t('suggestionsPage.resolveDone'));
      onDone();
      onClose();
    } catch (e) {
      toast.error(t('common.error'), e instanceof Error ? e.message : '');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={suggestion !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Gavel className="h-5 w-5 text-primary" />
            {t('suggestionsPage.resolveTitle')}
          </DialogTitle>
        </DialogHeader>

        {suggestion && (
          <div className="space-y-4 py-2">
            <p className="text-sm font-medium text-foreground line-clamp-2">{suggestion.title}</p>

            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setChoice('approved')}
                className={cn(
                  'flex items-center justify-center gap-2 rounded-lg border-2 py-3 text-sm font-medium transition-colors',
                  choice === 'approved'
                    ? 'border-success bg-success/10 text-success'
                    : 'border-border hover:border-success/40 text-foreground',
                )}
              >
                <Check className="h-4 w-4" />
                {t('suggestionsPage.resolveApprove')}
              </button>
              <button
                type="button"
                onClick={() => setChoice('rejected')}
                className={cn(
                  'flex items-center justify-center gap-2 rounded-lg border-2 py-3 text-sm font-medium transition-colors',
                  choice === 'rejected'
                    ? 'border-danger bg-danger/10 text-danger'
                    : 'border-border hover:border-danger/40 text-foreground',
                )}
              >
                <X className="h-4 w-4" />
                {t('suggestionsPage.resolveReject')}
              </button>
            </div>

            <Textarea
              rows={3}
              maxLength={1000}
              placeholder={t('suggestionsPage.notePlaceholder')}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            {t('common.cancel')}
          </Button>
          <Button onClick={submit} disabled={saving || !choice}>
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : null}
            {t('suggestionsPage.confirmResolve')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
