import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, ChevronRight, Clock, Loader2, Megaphone, PenLine, Pin, Settings2 } from 'lucide-react';

import { useAuth } from '@/shared/context/AuthContext';
import { useLanguage } from '@/shared/i18n';
import { useTabParam } from '@/shared/hooks/useTabParam';
import { PageContainer } from '@/shared/components/PageContainer';
import { PageHeader } from '@/shared/components/PageHeader';
import { EmptyState } from '@/shared/components/EmptyState';
import { ErrorState } from '@/shared/components/ErrorState';
import { formatDateTime } from '@/shared/lib/time';
import { cn } from '@/shared/lib/utils';
import { Card, CardContent } from '@/ui/card';
import { Badge } from '@/ui/badge';
import { Button } from '@/ui/button';
import { Tabs, TabsList, TabsTrigger } from '@/ui/tabs';

import { ANNOUNCEMENT_KINDS, announcementKeys, fetchAnnouncements } from './api';
import type { AnnouncementKind, AnnouncementListItem } from './api';
import { KIND_I18N } from './lib/labels';

const KIND_TABS = ['all', ...ANNOUNCEMENT_KINDS] as const;
type KindTab = (typeof KIND_TABS)[number];

/**
 * «Мэдээ, зарлал» — жагсаалт (`/app/announcements`), sidebar-ийн «Нийтийн
 * мэдээлэл» бүлгийн эхний хуудас.  Нийтлэгдсэн, надад хамаарах мэдээлэл бүр
 * нэг мөр: төрөл · гарчиг · товч агуулга · миний баталгааны төлөв.  Уншиж,
 * баталгаажуулах нь `/app/announcements/:id`.  Админд «Удирдах» —
 * «Нийтийн мэдээлэл → Удирдлага» (`/app/admin/announcements`).
 *
 * `?tab=<kind>` — төрлөөр шүүлт (`useTabParam`, хайлтын хэв маяг).
 */
export default function AnnouncementsPage() {
  const { t } = useLanguage();
  const { user } = useAuth();
  const [tab, setTab] = useTabParam<KindTab>(KIND_TABS, 'all');
  const q = useQuery({ queryKey: announcementKeys.list, queryFn: fetchAnnouncements, retry: false });

  const header = (
    <PageHeader
      icon={Megaphone}
      title={t('announcements.pageTitle')}
      description={t('announcements.pageDesc')}
      actions={
        user?.role === 'admin' ? (
          <Button asChild variant="outline" size="sm">
            <Link to="/app/admin/announcements">
              <Settings2 className="mr-1.5 h-4 w-4" aria-hidden />
              {t('announcements.manage')}
            </Link>
          </Button>
        ) : undefined
      }
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

  const { announcements, pending_count } = q.data;
  const visible = tab === 'all' ? announcements : announcements.filter((a) => a.kind === tab);

  return (
    <PageContainer>
      {header}
      {pending_count > 0 && (
        <div className="rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-warning" data-testid="pending-banner">
          {t('announcements.pendingBanner', { count: pending_count })}
        </div>
      )}
      <Tabs value={tab} onValueChange={(v) => setTab(v as KindTab)}>
        <TabsList>
          {KIND_TABS.map((k) => (
            <TabsTrigger key={k} value={k}>
              {k === 'all' ? t('common.all') : t(KIND_I18N[k as AnnouncementKind])}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      {visible.length === 0 ? (
        <EmptyState icon={Megaphone} title={t('announcements.empty')} description={t('announcements.emptyHint')} />
      ) : (
        <Card className="border-border bg-card/60 backdrop-blur">
          <CardContent className="divide-y divide-border p-0">
            {visible.map((a) => (
              <AnnouncementRow key={a.id} item={a} />
            ))}
          </CardContent>
        </Card>
      )}
    </PageContainer>
  );
}

function AnnouncementRow({ item }: { item: AnnouncementListItem }) {
  const { t } = useLanguage();
  const needsAck = item.ack_mode !== 'none' && item.in_audience;
  const acked = item.my_ack !== null;
  const StatusIcon = !needsAck ? Megaphone : acked ? CheckCircle2 : item.ack_mode === 'signature' ? PenLine : Clock;
  return (
    <Link
      to={`/app/announcements/${item.id}`}
      className="flex items-start gap-3 px-4 py-3 transition-colors hover:bg-muted/40"
      data-testid="announcement-row"
    >
      <StatusIcon
        className={cn('mt-0.5 h-5 w-5 shrink-0', !needsAck ? 'text-muted-foreground' : acked ? 'text-success' : 'text-warning')}
        aria-hidden
      />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          {item.pinned && <Pin className="h-3.5 w-3.5 text-primary" aria-label={t('announcements.pinned')} />}
          <span className="font-medium text-foreground">{item.title}</span>
          <Badge variant="outline" className="text-micro">
            {t(KIND_I18N[item.kind])}
          </Badge>
        </div>
        {item.excerpt && <p className="mt-0.5 line-clamp-2 text-sm text-muted-foreground">{item.excerpt}</p>}
        <div className="mt-1 text-micro text-muted-foreground">
          {formatDateTime(item.published_at)}
          {item.published_by_name ? ` · ${item.published_by_name}` : ''}
        </div>
      </div>
      {needsAck &&
        (acked ? (
          <Badge variant="outline" className="border-success/30 bg-success/10 text-micro text-success">
            {t('announcements.statusAcked')}
          </Badge>
        ) : (
          <Badge variant="outline" className="border-warning/30 bg-warning/10 text-micro text-warning">
            {item.ack_mode === 'signature' ? t('announcements.statusNeedsSignature') : t('announcements.statusNeedsConfirm')}
          </Badge>
        ))}
      <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
    </Link>
  );
}
