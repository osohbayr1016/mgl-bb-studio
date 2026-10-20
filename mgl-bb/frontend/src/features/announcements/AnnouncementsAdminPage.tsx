import { useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Archive,
  ArchiveRestore,
  Eye,
  EyeOff,
  Loader2,
  Megaphone,
  MoreHorizontal,
  Pencil,
  Pin,
  Plus,
  Send,
  Trash2,
  Users,
} from 'lucide-react';

import { useLanguage } from '@/shared/i18n';
import { useApiQuery } from '@/shared/api/useApi';
import { ApiError } from '@/shared/api/client';
import { useTabParam } from '@/shared/hooks/useTabParam';
import { PageContainer } from '@/shared/components/PageContainer';
import { PageHeader } from '@/shared/components/PageHeader';
import { EmptyState } from '@/shared/components/EmptyState';
import { ErrorState } from '@/shared/components/ErrorState';
import { confirmDialog } from '@/shared/components/ConfirmDialog';
import { toast } from '@/shared/components/Toast';
import { formatDateTime } from '@/shared/lib/time';
import { cn } from '@/shared/lib/utils';
import type { Team } from '@/shared/types';
import { Badge } from '@/ui/badge';
import { Button } from '@/ui/button';
import { Card, CardContent } from '@/ui/card';
import { Progress } from '@/ui/progress';
import { Tabs, TabsList, TabsTrigger } from '@/ui/tabs';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/ui/dropdown-menu';

import {
  announcementKeys,
  archiveAnnouncement,
  deleteAnnouncement,
  fetchAnnouncementsAdmin,
  publishAnnouncement,
  unarchiveAnnouncement,
  unpublishAnnouncement,
} from './api';
import type { AdminAnnouncement, AnnouncementStatus } from './api';
import { AnnouncementAcksDialog } from './components/AnnouncementAcksDialog';
import { ACK_MODE_I18N, KIND_I18N, audienceLabel } from './lib/labels';

const STATUS_TABS = ['all', 'published', 'draft', 'archived'] as const;
type StatusTab = (typeof STATUS_TABS)[number];

const STATUS_I18N: Record<AnnouncementStatus, string> = {
  draft: 'announcements.status.draft',
  published: 'announcements.status.published',
  archived: 'announcements.status.archived',
};

/**
 * Админ — мэдээ, зарлалын удирдлага.
 * Жагсаалт (бүх төлөв) + мөр бүрд: засах (тусдаа хуудас — засварлагч зурагтай
 * тул диалогт багтахгүй), нийтлэх / нуух / архивлах / устгах, баталгааны
 * статистик (dialog).  Сервер `requireAdmin()`.
 *
 * `embedded` — «Нийтийн мэдээлэл → Удирдлага» (`PublicInfoAdminPage`,
 * `/app/admin/announcements`)-ын «Мэдээ, зарлал» таб дотор: тэр бүрхүүл өөрийн
 * `PageHeader`-тэй тул энд гарчгийг ДАВХАРДУУЛАХГҮЙ, «Шинэ мэдээлэл» товч
 * төлөвийн шүүлтийн мөрөнд баруун талд гарна.  Төлөвийн шүүлт `?status=` —
 * `?tab=` нь бүрхүүлийнх.
 */
export default function AnnouncementsAdminPage({ embedded = false }: { embedded?: boolean }) {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [tab, setTab] = useTabParam<StatusTab>(STATUS_TABS, 'all', 'status');
  const [acksFor, setAcksFor] = useState<AdminAnnouncement | null>(null);

  const q = useQuery({ queryKey: announcementKeys.admin, queryFn: fetchAnnouncementsAdmin, retry: false });
  const teamsQuery = useApiQuery<{ teams: Team[] }>(['/teams'], '/teams', { retry: false, staleTime: 60_000 });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: announcementKeys.admin });
    void queryClient.invalidateQueries({ queryKey: announcementKeys.list });
  };
  const onError = (err: unknown) => {
    const msg = err instanceof ApiError ? err.message : err instanceof Error ? err.message : undefined;
    toast.error(t('common.saveFailed'), msg);
  };

  const publish = useMutation({
    mutationFn: (id: number) => publishAnnouncement(id, true),
    onSuccess: (r) => {
      toast.success(t('announcements.publishedToast', { count: r.notified }));
      invalidate();
    },
    onError,
  });
  const unpublish = useMutation({ mutationFn: unpublishAnnouncement, onSuccess: invalidate, onError });
  const archive = useMutation({ mutationFn: archiveAnnouncement, onSuccess: invalidate, onError });
  const unarchive = useMutation({ mutationFn: unarchiveAnnouncement, onSuccess: invalidate, onError });
  const remove = useMutation({
    mutationFn: deleteAnnouncement,
    onSuccess: () => {
      toast.success(t('announcements.deletedToast'));
      invalidate();
    },
    onError,
  });

  const newButton = (
    <Button asChild size="sm">
      <Link to="/app/admin/announcements/new" data-testid="new-announcement">
        <Plus className="mr-1.5 h-4 w-4" aria-hidden />
        {t('announcements.new')}
      </Link>
    </Button>
  );

  const header = embedded ? null : (
    <PageHeader
      icon={Megaphone}
      backTo="/app/announcements"
      title={t('announcements.adminTitle')}
      description={t('announcements.adminDesc')}
      actions={newButton}
    />
  );

  /** Шүүлтийн мөр — `embedded` үед «Шинэ мэдээлэл» энд (бүрхүүлийн гарчигт биш),
   *  ачаалж байх үед ч харагдана. */
  const toolbar = (filters: ReactNode) =>
    embedded ? (
      <div className="flex flex-wrap items-center gap-2">
        {filters}
        <div className="ml-auto">{newButton}</div>
      </div>
    ) : (
      filters
    );

  if (q.isLoading) {
    return (
      <PageContainer>
        {header}
        {toolbar(null)}
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
        {toolbar(null)}
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      </PageContainer>
    );
  }

  const all = q.data.announcements;
  const visible = tab === 'all' ? all : all.filter((a) => a.status === tab);
  const count = (s: StatusTab) => (s === 'all' ? all.length : all.filter((a) => a.status === s).length);

  const confirmPublish = async (a: AdminAnnouncement) => {
    const ok = await confirmDialog({
      title: t('announcements.publishConfirmTitle'),
      description: t('announcements.publishConfirmBody', {
        title: a.title,
        audience: audienceLabel(a.audience, t, teamsQuery.data?.teams),
      }),
      confirmText: t('announcements.publish'),
    });
    if (ok) publish.mutate(a.id);
  };
  /** Баталгаатай ч устгана (2026-09-25) — баталгаа, гарын үсэг хамт арилдгийг
   *  цонх ИЛ хэлнэ; хадгалах шаардлагатай бол «Архивлах». */
  const confirmDelete = async (a: AdminAnnouncement) => {
    const ok = await confirmDialog({
      title: t('announcements.deleteConfirmTitle'),
      description:
        a.total_acks > 0
          ? t('announcements.deleteConfirmBodyWithAcks', { title: a.title, count: a.total_acks })
          : t('announcements.deleteConfirmBody', { title: a.title }),
      confirmText: t('common.delete'),
      variant: 'destructive',
    });
    if (ok) remove.mutate(a.id);
  };

  return (
    <PageContainer>
      {header}
      {toolbar(
        <Tabs value={tab} onValueChange={(v) => setTab(v as StatusTab)}>
          <TabsList>
            {STATUS_TABS.map((s) => (
              <TabsTrigger key={s} value={s}>
                {s === 'all' ? t('common.all') : t(STATUS_I18N[s])}
                <span className="ml-1.5 text-micro text-muted-foreground">{count(s)}</span>
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>,
      )}

      {visible.length === 0 ? (
        <EmptyState
          icon={Megaphone}
          title={t('announcements.adminEmpty')}
          description={t('announcements.adminEmptyHint')}
          action={
            <Button asChild size="sm">
              <Link to="/app/admin/announcements/new">
                <Plus className="mr-1.5 h-4 w-4" aria-hidden />
                {t('announcements.new')}
              </Link>
            </Button>
          }
        />
      ) : (
        <Card className="border-border bg-card/60 backdrop-blur">
          <CardContent className="divide-y divide-border p-0">
            {visible.map((a) => {
              const pct = a.roster_count ? Math.round((a.acked_count / a.roster_count) * 100) : 0;
              return (
                <div key={a.id} className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center" data-testid="admin-row" data-status={a.status}>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      {a.pinned && <Pin className="h-3.5 w-3.5 text-primary" aria-label={t('announcements.pinned')} />}
                      <Link to={`/app/admin/announcements/${a.id}`} className="font-medium text-foreground hover:underline">
                        {a.title}
                      </Link>
                      <Badge
                        variant="outline"
                        className={cn(
                          'text-micro',
                          a.status === 'published' && 'border-success/30 bg-success/10 text-success',
                          a.status === 'draft' && 'border-warning/30 bg-warning/10 text-warning',
                        )}
                      >
                        {t(STATUS_I18N[a.status])}
                      </Badge>
                      <Badge variant="outline" className="text-micro">
                        {t(KIND_I18N[a.kind])}
                      </Badge>
                      {a.ack_version > 1 && (
                        <Badge variant="outline" className="text-micro">
                          v{a.ack_version}
                        </Badge>
                      )}
                    </div>
                    <div className="mt-0.5 text-micro text-muted-foreground">
                      {t(ACK_MODE_I18N[a.ack_mode])} · {audienceLabel(a.audience, t, teamsQuery.data?.teams)}
                      {a.published_at ? ` · ${formatDateTime(a.published_at)}` : ` · ${t('announcements.updatedAt', { date: formatDateTime(a.updated_at) })}`}
                    </div>
                    {a.ack_mode !== 'none' && a.status !== 'draft' && (
                      <button
                        type="button"
                        onClick={() => setAcksFor(a)}
                        className="mt-1.5 flex items-center gap-2 text-left text-micro text-muted-foreground hover:text-foreground"
                        data-testid="acks-open"
                      >
                        <Progress value={pct} className="h-1.5 w-32" />
                        <span>
                          {t('announcements.ackedProgress', { acked: a.acked_count, total: a.roster_count })}
                          {a.roster_count > a.acked_count ? ` · ${t('announcements.pendingCount', { count: a.roster_count - a.acked_count })}` : ''}
                        </span>
                      </button>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    {a.status === 'draft' && (
                      <Button size="sm" onClick={() => void confirmPublish(a)} disabled={publish.isPending} data-testid="publish-button">
                        <Send className="mr-1.5 h-3.5 w-3.5" aria-hidden />
                        {t('announcements.publish')}
                      </Button>
                    )}
                    {a.ack_mode !== 'none' && a.status !== 'draft' && (
                      <Button size="sm" variant="outline" onClick={() => setAcksFor(a)}>
                        <Users className="mr-1.5 h-3.5 w-3.5" aria-hidden />
                        {t('announcements.acks')}
                      </Button>
                    )}
                    <Button size="sm" variant="outline" onClick={() => navigate(`/app/admin/announcements/${a.id}`)}>
                      <Pencil className="mr-1.5 h-3.5 w-3.5" aria-hidden />
                      {t('common.edit')}
                    </Button>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button size="sm" variant="ghost" aria-label={t('announcements.moreActions')} data-testid="row-menu">
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        {a.status === 'published' && (
                          <DropdownMenuItem asChild>
                            <Link to={`/app/announcements/${a.id}`}>
                              <Eye className="mr-2 h-4 w-4" aria-hidden />
                              {t('announcements.viewAsEmployee')}
                            </Link>
                          </DropdownMenuItem>
                        )}
                        {a.status === 'published' && (
                          <DropdownMenuItem onSelect={() => unpublish.mutate(a.id)}>
                            <EyeOff className="mr-2 h-4 w-4" aria-hidden />
                            {t('announcements.unpublish')}
                          </DropdownMenuItem>
                        )}
                        {a.status !== 'archived' ? (
                          <DropdownMenuItem onSelect={() => archive.mutate(a.id)}>
                            <Archive className="mr-2 h-4 w-4" aria-hidden />
                            {t('announcements.archive')}
                          </DropdownMenuItem>
                        ) : (
                          <DropdownMenuItem onSelect={() => unarchive.mutate(a.id)}>
                            <ArchiveRestore className="mr-2 h-4 w-4" aria-hidden />
                            {t('announcements.unarchive')}
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          className="text-destructive focus:text-destructive"
                          disabled={remove.isPending}
                          onSelect={() => void confirmDelete(a)}
                          data-testid="delete-announcement"
                        >
                          <Trash2 className="mr-2 h-4 w-4" aria-hidden />
                          {t('common.delete')}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      <AnnouncementAcksDialog item={acksFor} open={acksFor !== null} onOpenChange={(v) => !v && setAcksFor(null)} />
    </PageContainer>
  );
}
