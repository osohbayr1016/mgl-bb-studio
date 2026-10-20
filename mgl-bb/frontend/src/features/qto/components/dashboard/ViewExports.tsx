import { ExternalLink, FileText, Trash2 } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';

import { apiFetch, mediaUrl } from '@/shared/api/client';
import { useApiQuery } from '@/shared/api/useApi';
import { useLanguage } from '@/shared/i18n';
import { confirmDialog } from '@/shared/components/ConfirmDialog';
import { toast } from '@/shared/components/Toast';
import { Button } from '@/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/ui/card';
import { formatDate } from '@/shared/lib/time';

import type { QtoViewExport } from '../../lib/types';

/**
 * Төслийн план PDF-үүд — add-in-ий «PDF план» товчоор R2-д орж бүртгэгдсэн
 * хуудсууд. Карт дарахад PDF ШИНЭ ТАБ-д нээгдэнэ: манай origin COOP/COEP-той
 * (cross-origin isolated — APS viewer + email OAuth-д хэрэгтэй) тул
 * cross-origin iframe доторх Chrome-ийн PDF viewer ажилладаггүй; top-level
 * табэд энэ хязгаарлалт үйлчилдэггүй.
 */
export function ViewExports({
  projectId,
  allowed,
  isAdmin,
}: {
  projectId: number;
  allowed: boolean;
  isAdmin: boolean;
}) {
  const { t } = useLanguage();
  const queryClient = useQueryClient();

  const viewsQuery = useApiQuery<{ views: QtoViewExport[] }>(
    ['/qto/projects', projectId, 'views'],
    `/qto/projects/${projectId}/views`,
    { enabled: allowed },
  );
  const views = viewsQuery.data?.views ?? [];

  const handleDelete = async (id: number) => {
    const ok = await confirmDialog({
      description: t('qtoPage.viewExportDeleteConfirm'),
      variant: 'destructive',
    });
    if (!ok) return;
    try {
      await apiFetch(`/qto/view-exports/${id}`, { method: 'DELETE' });
      toast.success(t('qtoPage.viewExportDeleted'));
      await queryClient.invalidateQueries({ queryKey: ['/qto/projects', projectId, 'views'] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('qtoPage.deleteFailed'));
    }
  };

  // Хоосон бол хэсэг бүхэлдээ далд — самбарыг бөглөрүүлэхгүй.
  if (viewsQuery.isLoading || views.length === 0) return null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">{t('qtoPage.viewExportsTitle')}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {views.map((v) => (
            <div
              key={v.id}
              className="flex items-center gap-2 rounded-md border p-2.5 text-sm transition-colors hover:bg-muted/40"
            >
              <FileText className="h-4 w-4 shrink-0 text-primary" />
              <a
                href={mediaUrl(v.media_url)}
                target="_blank"
                rel="noopener noreferrer"
                className="group min-w-0 flex-1"
              >
                <span className="flex items-center gap-1.5 font-medium">
                  <span className="truncate group-hover:underline">{v.view_name}</span>
                  <ExternalLink className="h-3 w-3 shrink-0 text-muted-foreground" />
                </span>
                <span className="block truncate text-xs text-muted-foreground">
                  {v.file_name ?? '—'} · {formatDate(v.created_at)}
                </span>
              </a>
              {isAdmin && (
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7 shrink-0 text-muted-foreground hover:text-danger"
                  onClick={() => void handleDelete(v.id)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              )}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
