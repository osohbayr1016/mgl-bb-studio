/**
 * «Захиалагч» самбар — Баримт бичиг табын ажилтны тал (миграц 0327).
 *
 * 2026-09-21-ний эзний шийдвэр: төсөлд эрхтэй байгууллагын захиалагч төслийн
 * Drive хавтсыг БҮХЭЛД НЬ view-only харна, ЗӨВХӨН «09 ЗАХИАЛАГЧААС ИРСЭН
 * МАТЕРИАЛ» хавтсанд (contributor/approver түвшин) байршуулна.  Тиймээс энд
 * «юу нээгдсэн» жагсаалт, мөр бүрийн нээх/хаах товч БАЙХГҮЙ БОЛСОН
 * (`client_drive_shares` цаашид харагдацыг шийддэггүй — `backend/src/routes/clientDrive.ts`);
 * самбар нь: аль байгууллага ямар түвшний эрхтэй, 09 хавтас Drive-д байгаа
 * эсэх, байгууллага/хүн урих, захиалагчийн хандалтын бүртгэл.
 *
 * Эрх олгох (`project_client_access`) нь төслийн «Захиалагч» табд хэвээр —
 * энд зөвхөн шууд урих богино зам.
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Download, Eye, FolderUp, Loader2, UserPlus } from 'lucide-react';
import { Button } from '@/ui/button';
import { formatDateTime } from '@/shared/lib/time';
import { useLanguage } from '@/shared/i18n';
import { clientShareLogKey, clientSharesKey, fetchClientShareLog, fetchClientShares } from './clientShareApi';
import { useDriveStatus } from './useDriveFolder';

export function ClientSharePanel({
  projectId,
  onInvite,
  onOpenFolder,
}: {
  projectId: number;
  onInvite: () => void;
  /** 09 хавтас руу жагсаалтаар очих. */
  onOpenFolder: (folderId: string) => void;
}) {
  const { t } = useLanguage();
  const [logOpen, setLogOpen] = useState(false);
  const shares = useQuery({
    queryKey: clientSharesKey(projectId),
    queryFn: () => fetchClientShares(projectId),
    staleTime: 15_000,
  });
  // Захиалагчийн замын төлөв — admin/senior «захиалагчийн нүдээр» уншиж болно;
  // `upload_folder` = 09 хавтас олдсон эсэх (сервер нэрээр таньдаг).
  const clientStatus = useDriveStatus('client', projectId);
  const log = useQuery({
    queryKey: clientShareLogKey(projectId),
    queryFn: () => fetchClientShareLog(projectId, 50),
    enabled: logOpen,
    staleTime: 15_000,
  });

  const orgs = shares.data?.orgs ?? [];
  const uploadFolder = clientStatus.data?.upload_folder ?? null;

  return (
    <div className="space-y-3 rounded-xl border border-border bg-card p-4" data-testid="client-share-panel">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold">{t('projectDrive.clientShare.panelTitle')}</h3>
          <p className="text-[11px] text-muted-foreground">{t('projectDrive.clientShare.panelHint')}</p>
        </div>
        <div className="flex items-center gap-1">
          <Button size="sm" variant={logOpen ? 'secondary' : 'ghost'} onClick={() => setLogOpen((v) => !v)} aria-pressed={logOpen}>
            <Eye className="h-4 w-4" /> {t('projectDrive.clientShare.log')}
          </Button>
          <Button size="sm" variant="outline" onClick={onInvite}>
            <UserPlus className="h-4 w-4" /> {t('projectDrive.clientShare.invite')}
          </Button>
        </div>
      </div>

      {/* 09 хавтас — захиалагчийн байршуулах газар */}
      {clientStatus.data?.linked && (
        uploadFolder ? (
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border/70 px-3 py-2 text-[12px]">
            <FolderUp className="h-4 w-4 shrink-0 text-primary" />
            <span className="min-w-0 flex-1">
              {t('projectDrive.clientShare.uploadFolder')}{' '}
              <button type="button" className="font-medium hover:underline" onClick={() => onOpenFolder(uploadFolder.id)}>
                {uploadFolder.name}
              </button>
            </span>
          </div>
        ) : (
          <div className="flex items-start gap-2 rounded-lg border border-amber-300/60 bg-amber-50 px-3 py-2 text-[12px] text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{t('projectDrive.clientShare.uploadFolderMissing')}</span>
          </div>
        )
      )}

      {shares.isPending ? (
        <div className="flex h-16 items-center justify-center text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      ) : shares.isError ? (
        <p className="text-sm text-destructive">{shares.error.message}</p>
      ) : orgs.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
          {t('projectDrive.clientShare.noOrgs')}
        </p>
      ) : (
        <ul className="divide-y divide-border/50 rounded-lg border border-border/70">
          {orgs.map((o) => (
            <li key={o.org_id} className="flex items-center justify-between gap-2 px-3 py-2">
              <div className="min-w-0">
                <span className="block truncate text-sm font-medium">{o.org_name}</span>
                <span className="text-[11px] text-muted-foreground">
                  {t('projectDrive.clientShare.contactCount', { count: o.contact_count })}
                </span>
              </div>
              <span
                className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground"
                title={t('projectDrive.clientShare.levelHint')}
              >
                {o.access_level === 'viewer'
                  ? t('projectDrive.clientShare.levelViewer')
                  : t('projectDrive.clientShare.levelUploader')}
              </span>
            </li>
          ))}
        </ul>
      )}

      {logOpen && (
        <div className="rounded-lg border border-border/70">
          <div className="border-b border-border/60 px-3 py-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            {t('projectDrive.clientShare.logTitle')}
          </div>
          {log.isPending ? (
            <div className="flex h-12 items-center justify-center text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
            </div>
          ) : (log.data?.log ?? []).length === 0 ? (
            <p className="px-3 py-2 text-[12px] text-muted-foreground">{t('projectDrive.clientShare.logEmpty')}</p>
          ) : (
            <ul className="divide-y divide-border/50">
              {(log.data?.log ?? []).map((r) => (
                <li key={r.id} className="flex items-center gap-2 px-3 py-1.5 text-[12px]">
                  {r.action === 'download' ? (
                    <Download className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  ) : (
                    <Eye className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  )}
                  <span className="min-w-0 flex-1 truncate">
                    <span className="font-medium">{r.user_name ?? '—'}</span>
                    {r.org_name ? <span className="text-muted-foreground"> · {r.org_name}</span> : null}
                    <span className="text-muted-foreground"> — {r.item_name}</span>
                  </span>
                  <span className="shrink-0 text-muted-foreground">{formatDateTime(r.created_at)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
