import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, ChevronRight, Clock, Loader2, Paperclip, ScrollText, Settings2 } from 'lucide-react';

import { useAuth } from '@/shared/context/AuthContext';
import { useLanguage, pickLocalized } from '@/shared/i18n';
import { PageContainer } from '@/shared/components/PageContainer';
import { PageHeader } from '@/shared/components/PageHeader';
import { EmptyState } from '@/shared/components/EmptyState';
import { ErrorState } from '@/shared/components/ErrorState';
import { formatDateTime } from '@/shared/lib/time';
import { Card, CardContent } from '@/ui/card';
import { Badge } from '@/ui/badge';
import { Button } from '@/ui/button';

import { fetchRules, ruleKeys } from './api';

/**
 * Дотоод журам — жагсаалт (`/app/rules`).  Нийтлэгдсэн журам бүр нэг мөр:
 * гарчиг · хувилбар · миний төлөв (зурсан / хүлээгдэж буй).  Уншиж, гарын
 * үсэг зурах нь `/app/rules/:id`.  Sidebar-т «Нийтийн мэдээлэл» бүлгийн дэд
 * хуудас; админд «Удирдах» товч — «Нийтийн мэдээлэл → Удирдлага»-ын «Дотоод
 * журам» таб (`/app/admin/announcements?tab=rules`).
 */
export default function InternalRulesPage() {
  const { t, lang } = useLanguage();
  const { user } = useAuth();
  const q = useQuery({ queryKey: ruleKeys.list, queryFn: fetchRules, retry: false });

  const header = (
    <PageHeader
      icon={ScrollText}
      title={t('rules.pageTitle')}
      description={t('rules.pageDesc')}
      actions={
        user?.role === 'admin' ? (
          <Button asChild variant="outline" size="sm">
            <Link to="/app/admin/announcements?tab=rules">
              <Settings2 className="mr-1.5 h-4 w-4" aria-hidden />
              {t('rules.manage')}
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

  const { rules, pending_count } = q.data;
  if (rules.length === 0) {
    return (
      <PageContainer>
        {header}
        <EmptyState icon={ScrollText} title={t('rules.empty')} description={t('rules.emptyHint')} />
      </PageContainer>
    );
  }

  return (
    <PageContainer>
      {header}
      {pending_count > 0 && (
        <div className="rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-warning">
          {t('rules.pendingBanner', { count: pending_count })}
        </div>
      )}
      <Card className="border-border bg-card/60 backdrop-blur">
        <CardContent className="divide-y divide-border p-0">
          {rules.map((r) => {
            const signed = r.signature_id !== null;
            return (
              <Link
                key={r.id}
                to={`/app/rules/${r.id}`}
                className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/40"
              >
                {signed ? (
                  <CheckCircle2 className="h-5 w-5 shrink-0 text-success" aria-hidden />
                ) : (
                  <Clock className="h-5 w-5 shrink-0 text-warning" aria-hidden />
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-foreground">
                      {pickLocalized(lang, r.title_mn, r.title_en)}
                    </span>
                    <Badge variant="outline" className="text-micro">
                      v{r.version}
                    </Badge>
                    {r.attachment_count > 0 && (
                      <span
                        className="inline-flex items-center gap-0.5 text-micro text-muted-foreground"
                        title={t('rules.files.count', { count: r.attachment_count })}
                      >
                        <Paperclip className="h-3 w-3" aria-hidden />
                        {r.attachment_count}
                      </span>
                    )}
                  </div>
                  <div className="text-micro text-muted-foreground">
                    {signed
                      ? t('rules.signedAt', { date: formatDateTime(r.signed_at) })
                      : t('rules.publishedAt', { date: formatDateTime(r.published_at) })}
                  </div>
                </div>
                {signed ? (
                  <Badge variant="outline" className="border-success/30 bg-success/10 text-micro text-success">
                    {t('rules.statusSigned')}
                  </Badge>
                ) : (
                  <Badge variant="outline" className="border-warning/30 bg-warning/10 text-micro text-warning">
                    {t('rules.statusPending')}
                  </Badge>
                )}
                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
              </Link>
            );
          })}
        </CardContent>
      </Card>
    </PageContainer>
  );
}
