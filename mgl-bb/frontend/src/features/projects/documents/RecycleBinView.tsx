import { useQueryClient } from '@tanstack/react-query';
import { Loader2, RotateCcw, Trash2 } from 'lucide-react';
import { PageContainer } from '@/shared/components/PageContainer';
import { PageHeader } from '@/shared/components/PageHeader';
import { useApiQuery } from '@/shared/api/useApi';
import { useLanguage } from '@/shared/i18n';
import { confirmDialog } from '@/shared/components/ConfirmDialog';
import { toast } from '@/shared/components/Toast';
import { Button } from '@/ui/button';
import { FileTypeIcon } from './FileTypeIcon';
import { purgeFileApi, purgeFolderApi, restoreFileApi, restoreFolderApi } from './api';
import type { TrashResponse } from './types';

export function RecycleBinView({ archiveId }: { archiveId: number }) {
  const { t } = useLanguage();
  const qc = useQueryClient();
  const q = useApiQuery<TrashResponse>(
    ['/documents/trash', archiveId],
    `/documents/trash?archive_id=${archiveId}`,
  );
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['/documents/trash', archiveId] });
    void qc.invalidateQueries({ queryKey: ['/documents/browse', archiveId] });
  };

  const restore = async (kind: 'folder' | 'file', id: number) => {
    try {
      if (kind === 'folder') await restoreFolderApi(id);
      else await restoreFileApi(id);
      refresh();
    } catch {
      toast.error(t('documentsPage.failed'));
    }
  };
  const purge = async (kind: 'folder' | 'file', id: number) => {
    if (!(await confirmDialog({ description: t('documentsPage.confirmPurge'), variant: 'destructive' })))
      return;
    try {
      if (kind === 'folder') await purgeFolderApi(id);
      else await purgeFileApi(id);
      refresh();
    } catch {
      toast.error(t('documentsPage.failed'));
    }
  };

  const folders = q.data?.folders ?? [];
  const files = q.data?.files ?? [];
  const empty = folders.length === 0 && files.length === 0;
  return (
    <PageContainer>
      <PageHeader
        bare
        title={t('documentsPage.recycleBin')}
        eyebrow={t('nav.projectDocuments')}
        backTo={`/app/documents/${archiveId}`}
        backLabel={t('documentsPage.backToProject')}
      />
      <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-apple">
        {q.isLoading ? (
          <div className="flex justify-center py-16">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : empty ? (
          <p className="px-6 py-14 text-center text-sm text-muted-foreground">
            {t('documentsPage.trashEmpty')}
          </p>
        ) : (
          <ul className="divide-y divide-border/60">
            {folders.map((f) => (
              <BinRow
                key={`f-${f.id}`}
                kind="folder"
                name={f.name}
                onRestore={() => void restore('folder', f.id)}
                onPurge={() => void purge('folder', f.id)}
              />
            ))}
            {files.map((d) => (
              <BinRow
                key={`d-${d.id}`}
                kind={d.file_name || d.title}
                name={d.file_name || d.title}
                onRestore={() => void restore('file', d.id)}
                onPurge={() => void purge('file', d.id)}
              />
            ))}
          </ul>
        )}
      </div>
    </PageContainer>
  );
}

function BinRow({
  kind,
  name,
  onRestore,
  onPurge,
}: {
  kind: 'folder' | string;
  name: string;
  onRestore: () => void;
  onPurge: () => void;
}) {
  const { t } = useLanguage();
  return (
    <li className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/40">
      <FileTypeIcon kind={kind} />
      <span className="min-w-0 flex-1 truncate font-medium">{name}</span>
      <Button size="sm" variant="ghost" onClick={onRestore}>
        <RotateCcw />
        {t('documentsPage.restore')}
      </Button>
      <Button size="sm" variant="ghost" onClick={onPurge}>
        <Trash2 />
        {t('documentsPage.purge')}
      </Button>
    </li>
  );
}
