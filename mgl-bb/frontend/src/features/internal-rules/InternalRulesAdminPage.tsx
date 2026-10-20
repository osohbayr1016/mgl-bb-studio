import { useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Archive,
  ArchiveRestore,
  Eye,
  Loader2,
  Paperclip,
  Pencil,
  Plus,
  ScrollText,
  Send,
  Trash2,
  Users,
} from 'lucide-react';

import { useAuth } from '@/shared/context/AuthContext';
import { useLanguage, pickLocalized } from '@/shared/i18n';
import { ApiError } from '@/shared/api/client';
import { PageContainer } from '@/shared/components/PageContainer';
import { PageHeader } from '@/shared/components/PageHeader';
import { EmptyState } from '@/shared/components/EmptyState';
import { ErrorState } from '@/shared/components/ErrorState';
import { toast } from '@/shared/components/Toast';
import { confirmDialog } from '@/shared/components/ConfirmDialog';
import { formatDateTime } from '@/shared/lib/time';
import { Card, CardContent } from '@/ui/card';
import { Badge } from '@/ui/badge';
import { Button } from '@/ui/button';

import { archiveRule, deleteRule, fetchRulesAdmin, publishRule, ruleKeys, unarchiveRule } from './api';
import type { AdminRule } from './api';
import { RuleSignaturesDialog } from './components/RuleSignaturesDialog';

/**
 * Дотоод журам — админ.  2026-09-23-наас «Нийтийн мэдээлэл → Удирдлага»
 * (`PublicInfoAdminPage`, `/app/admin/announcements?tab=rules`)-ын «Дотоод
 * журам» таб дотор `embedded` горимоор рендэрлэгдэнэ — гарчгийг бүрхүүл
 * эзэмшинэ, энд тайлбар + «Шинэ журам» товчтой мөр л үлдэнэ.  Хуучин
 * `/app/admin/rules` зам тэр таб руу redirect хийгддэг.
 *
 * Хоёр төлөвтэй баримт:
 *   • АЖЛЫН ХУВЬ — «Засах»-аар чөлөөтэй өөрчилнө, ажилтанд харагдахгүй.
 *   • НИЙТЛЭГДСЭН ХУВИЛБАР — «Нийтлэх» дарахад ажлын хувь агшин болж
 *     хадгалагдана (v1, v2 …).  Ажилтан бүр хувилбар бүрд ДАХИН гарын үсэг
 *     зурна — тиймээс нийтлэх нь confirm-тэй, ижил бичвэрийг дахин нийтлэх
 *     боломжгүй (сервер 409 UNCHANGED).
 *
 * Гарын үсэгтэй журмыг устгахгүй (409) — архивлана.  Сервер тал
 * `requireAdmin()`; энд бас шалгана (HandbookAdminPage-ийн ижил шалтгаан).
 *
 * Бичих/засах нь 2026-09-25-наас тусдаа ХУУДАС (`InternalRuleEditorPage`,
 * `/app/admin/rules/:id`) — «Мэдээ, зарлал»-ын засварлагч + файл хавсралт.
 * Өмнөх dialog-ийн markdown textarea-аар Word баримт оруулах арга байгаагүй.
 */

export default function InternalRulesAdminPage({ embedded = false }: { embedded?: boolean }) {
  const { t, lang } = useLanguage();
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const [rosterFor, setRosterFor] = useState<AdminRule | null>(null);

  const q = useQuery({ queryKey: ruleKeys.admin, queryFn: fetchRulesAdmin, retry: false });

  const invalidateAll = () => {
    void queryClient.invalidateQueries({ queryKey: ruleKeys.admin });
    void queryClient.invalidateQueries({ queryKey: ruleKeys.list });
  };

  const actionMutation = useMutation({
    mutationFn: async (a: { kind: 'publish' | 'archive' | 'unarchive' | 'delete'; id: number }) => {
      if (a.kind === 'publish') return publishRule(a.id);
      if (a.kind === 'archive') return archiveRule(a.id);
      if (a.kind === 'unarchive') return unarchiveRule(a.id);
      return deleteRule(a.id);
    },
    onSuccess: (_res, a) => {
      invalidateAll();
      if (a.kind === 'publish') toast.success(t('rules.published'));
    },
    onError: (err: unknown) => {
      const code = err instanceof ApiError ? err.code : undefined;
      if (code === 'UNCHANGED') toast.warn(t('rules.unchanged'));
      else if (code === 'HAS_SIGNATURES') toast.warn(t('rules.hasSignaturesDelete'));
      else toast.error(t('common.saveFailed'), err instanceof Error ? err.message : undefined);
    },
  });

  if (user && user.role !== 'admin') return <Navigate to="/app/rules" replace />;

  const publish = async (r: AdminRule) => {
    const ok = await confirmDialog({
      title: t('rules.publishConfirmTitle'),
      description: r.current_version
        ? t('rules.publishConfirmAgain', { version: r.current_version + 1 })
        : t('rules.publishConfirmFirst'),
      confirmText: t('rules.publish'),
    });
    if (ok) actionMutation.mutate({ kind: 'publish', id: r.id });
  };
  const remove = async (r: AdminRule) => {
    const ok = await confirmDialog({
      description: t('rules.deleteConfirm', { title: pickLocalized(lang, r.title_mn, r.title_en) }),
      variant: 'destructive',
      confirmText: t('common.delete'),
    });
    if (ok) actionMutation.mutate({ kind: 'delete', id: r.id });
  };

  const newButton = (
    <Button asChild size="sm" data-testid="new-rule">
      <Link to="/app/admin/rules/new">
        <Plus className="mr-1.5 h-4 w-4" aria-hidden />
        {t('rules.newRule')}
      </Link>
    </Button>
  );

  const header = embedded ? (
    <div className="flex flex-wrap items-center gap-3">
      <p className="min-w-0 flex-1 text-sm text-muted-foreground">{t('rules.adminDesc')}</p>
      {newButton}
    </div>
  ) : (
    <PageHeader
      icon={ScrollText}
      backTo="/app/rules"
      title={t('rules.adminTitle')}
      description={t('rules.adminDesc')}
      actions={newButton}
    />
  );

  if (q.isLoading) {
    return (
      <PageContainer>
        {header}
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-hidden />
        </div>
      </PageContainer>
    );
  }
  if (q.isError || !q.data) {
    return (
      <PageContainer>
        {header}
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      </PageContainer>
    );
  }

  const rules = q.data.rules;
  const busy = actionMutation.isPending;

  return (
    <PageContainer>
      {header}

      {rules.length === 0 ? (
        <EmptyState icon={ScrollText} title={t('rules.empty')} description={t('rules.adminEmptyHint')} />
      ) : (
        <Card className="border-border bg-card/60 backdrop-blur">
          <CardContent className="divide-y divide-border p-0">
            {rules.map((r) => (
              <div key={r.id} className="flex flex-col gap-3 p-4 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0 space-y-1.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-section text-foreground">{r.title_mn}</span>
                    <StatusBadge rule={r} />
                    {r.status !== 'draft' && r.has_unpublished_changes && (
                      <Badge variant="outline" className="border-warning/30 bg-warning/10 text-micro text-warning">
                        {t('rules.unpublishedChanges')}
                      </Badge>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-micro text-muted-foreground">
                    {r.current_version !== null && (
                      <span>
                        v{r.current_version} · {formatDateTime(r.published_at)}
                      </span>
                    )}
                    {r.current_version_id !== null && (
                      <span>{t('rules.signedProgress', { signed: r.signed_count, total: r.roster_count })}</span>
                    )}
                    {r.attachments.length > 0 && (
                      <span className="inline-flex items-center gap-1">
                        <Paperclip className="h-3 w-3" aria-hidden />
                        {t('rules.files.count', { count: r.attachments.length })}
                      </span>
                    )}
                    <span>
                      {t('rules.sortOrder')}: {r.sort_order}
                    </span>
                    {r.title_en && <span>{r.title_en}</span>}
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {r.status === 'published' && (
                    <Button asChild variant="ghost" size="sm">
                      <Link to={`/app/rules/${r.id}`}>
                        <Eye className="mr-1.5 h-3.5 w-3.5" aria-hidden />
                        {t('rules.view')}
                      </Link>
                    </Button>
                  )}
                  {r.current_version_id !== null && (
                    <Button variant="outline" size="sm" onClick={() => setRosterFor(r)}>
                      <Users className="mr-1.5 h-3.5 w-3.5" aria-hidden />
                      {t('rules.signatures')}
                    </Button>
                  )}
                  <Button asChild variant="outline" size="sm" data-testid="edit-rule">
                    <Link to={`/app/admin/rules/${r.id}`}>
                      <Pencil className="mr-1.5 h-3.5 w-3.5" aria-hidden />
                      {t('common.edit')}
                    </Link>
                  </Button>
                  {r.status !== 'archived' && (
                    <Button
                      size="sm"
                      disabled={busy || (r.status === 'published' && !r.has_unpublished_changes)}
                      onClick={() => void publish(r)}
                    >
                      <Send className="mr-1.5 h-3.5 w-3.5" aria-hidden />
                      {r.status === 'published' ? t('rules.publishNewVersion') : t('rules.publish')}
                    </Button>
                  )}
                  {r.status === 'published' && (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={busy}
                      onClick={() => actionMutation.mutate({ kind: 'archive', id: r.id })}
                    >
                      <Archive className="mr-1.5 h-3.5 w-3.5" aria-hidden />
                      {t('rules.archive')}
                    </Button>
                  )}
                  {r.status === 'archived' && (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={busy}
                      onClick={() => actionMutation.mutate({ kind: 'unarchive', id: r.id })}
                    >
                      <ArchiveRestore className="mr-1.5 h-3.5 w-3.5" aria-hidden />
                      {t('rules.unarchive')}
                    </Button>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-destructive hover:text-destructive"
                    disabled={busy || r.total_signatures > 0}
                    title={r.total_signatures > 0 ? t('rules.hasSignaturesDelete') : undefined}
                    onClick={() => void remove(r)}
                  >
                    <Trash2 className="h-3.5 w-3.5" aria-hidden />
                  </Button>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <RuleSignaturesDialog rule={rosterFor} open={rosterFor !== null} onOpenChange={(v) => !v && setRosterFor(null)} />
    </PageContainer>
  );
}

function StatusBadge({ rule }: { rule: AdminRule }) {
  const { t } = useLanguage();
  if (rule.status === 'draft') {
    return (
      <Badge variant="outline" className="border-warning/30 bg-warning/10 text-micro text-warning">
        {t('rules.statusDraft')}
      </Badge>
    );
  }
  if (rule.status === 'archived') {
    return (
      <Badge variant="outline" className="text-micro text-muted-foreground">
        {t('rules.statusArchived')}
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="border-success/30 bg-success/10 text-micro text-success">
      {t('rules.statusPublished')}
    </Badge>
  );
}
