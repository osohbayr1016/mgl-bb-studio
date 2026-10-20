import { useCallback, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2, Upload } from 'lucide-react';
import { useApiQuery } from '@/shared/api/useApi';
import { PageContainer } from '@/shared/components/PageContainer';
import { PageHeader } from '@/shared/components/PageHeader';
import { useLanguage } from '@/shared/i18n';
import { ACCEPT_DOCS } from './fileTypes';
import {
  browseKey,
  browsePath,
  renameFileApi,
  renameFolderApi,
  restoreFileApi,
  restoreFolderApi,
  trashFileApi,
  trashFolderApi,
} from './api';
import { ConflictDialog } from './ConflictDialog';
import { DocPreviewDialog } from './DocPreviewDialog';
import { ExplorerBreadcrumb } from './ExplorerBreadcrumb';
import { ExplorerList } from './ExplorerList';
import { ExplorerToolbar } from './ExplorerToolbar';
import { EmptyFolderHint } from './EmptyFolderHint';
import { ImportProgressPanel } from './ImportProgressPanel';
import { NameDialog } from './NameDialog';
import { fromFileList, hasFolders, scanDataTransfer } from './folderScan';
import { useExplorerUndo } from './useExplorerUndo';
import { useExplorerHandlers } from './useExplorerHandlers';
import { useExplorerDrop } from './useExplorerDrop';
import { useFolderImport } from './useFolderImport';
import type { BrowseResponse, BrowseTrail, ExplorerSelection } from './types';
import type { DocumentItem } from '@/shared/types';

function backTo(archiveId: number, trail: BrowseTrail[]): string {
  if (trail.length === 0) return '/app/documents';
  const parent = trail[trail.length - 2];
  return parent ? `/app/documents/${archiveId}?folder=${parent.id}` : `/app/documents/${archiveId}`;
}

export function ExplorerPane({ archiveId, folderId }: { archiveId: number; folderId: number | null }) {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const [selection, setSelection] = useState<ExplorerSelection>(null);
  const [dialog, setDialog] = useState<'new' | 'rename' | null>(null);
  const [conflicts, setConflicts] = useState<string[] | null>(null);
  // Нээсэн файл — харах цонх.  Өмнө нь шинэ табанд `/media/<key>` рүү
  // үсэрдэг байсан бөгөөд .docx/.xlsx нь зүгээр л ТАТАГДДАГ байлаа.
  const [preview, setPreview] = useState<DocumentItem | null>(null);
  const decide = useRef<((c: 'replace' | 'skip' | 'cancel') => void) | null>(null);
  const q = useApiQuery<BrowseResponse>(browseKey(archiveId, folderId), browsePath(archiveId, folderId));
  const { push, undo, canUndo } = useExplorerUndo(
    {
      trashFolder: trashFolderApi,
      trashFile: trashFileApi,
      restoreFolder: restoreFolderApi,
      restoreFile: restoreFileApi,
      renameFolder: renameFolderApi,
      renameFile: renameFileApi,
    },
    () => q.refetch(),
  );
  const h = useExplorerHandlers(archiveId, folderId, selection, push);
  const { progress, run, cancel, clear } = useFolderImport();

  const askConflict = useCallback((names: string[]) => {
    setConflicts(names);
    return new Promise<'replace' | 'skip' | 'cancel'>((resolve) => {
      decide.current = (choice) => {
        setConflicts(null);
        decide.current = null;
        resolve(choice);
      };
    });
  }, []);

  /**
   * Чирсэн зүйлд хавтас байвал БҮТЭН модыг энэ хавтас дотор давхарлаж
   * үүсгэнэ, зөвхөн файл байвал өмнөх энгийн зам (нэг нэгээр нь).
   */
  const onDropped = useCallback(
    async (dt: DataTransfer) => {
      const tree = await scanDataTransfer(dt);
      if (!hasFolders(tree)) {
        await h.onFiles(dt.files);
        return;
      }
      await run(archiveId, folderId, tree, askConflict);
      h.refresh();
    },
    [archiveId, folderId, askConflict, h, run],
  );

  const { dragging, dropProps } = useExplorerDrop(h.onFiles, onDropped);
  const data = q.data;
  const trail = data?.trail ?? [];
  const folders = data?.folders ?? [];
  const files = data?.files ?? [];
  const empty = folders.length === 0 && files.length === 0;

  return (
    <PageContainer>
      <PageHeader
        bare
        title={data?.folder?.name ?? data?.archive.name ?? t('nav.projectDocuments')}
        eyebrow={data?.folder ? data.archive.name : t('nav.projectDocuments')}
        description={t('documentsPage.openHint')}
        backTo={backTo(archiveId, trail)}
      />
      {progress ? (
        <ImportProgressPanel progress={progress} onCancel={cancel} onClose={clear} />
      ) : null}
      <div
        className="relative overflow-hidden rounded-2xl border border-border bg-card shadow-apple"
        {...dropProps}
      >
        <ExplorerBreadcrumb archiveId={archiveId} archiveName={data?.archive.name ?? ''} trail={trail} />
        <ExplorerToolbar
          archiveId={archiveId}
          selection={selection}
          canUndo={canUndo}
          onNewFolder={() => setDialog('new')}
          onUpload={() => h.fileRef.current?.click()}
          onUploadFolder={() => h.dirRef.current?.click()}
          onRename={() => selection && setDialog('rename')}
          onDelete={() => void h.remove().then((ok) => ok && setSelection(null))}
          onUndo={() => void undo()}
        />
        <input
          ref={h.fileRef}
          type="file"
          multiple
          accept={ACCEPT_DOCS}
          className="hidden"
          onChange={(e) => void h.onFiles(e.target.files)}
        />
        <input
          ref={h.dirRef}
          type="file"
          multiple
          className="hidden"
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          {...({ webkitdirectory: '', directory: '' } as any)}
          onChange={(e) => {
            const tree = fromFileList(e.target.files);
            const input = e.target;
            void run(archiveId, folderId, tree, askConflict).then(() => {
              h.refresh();
              input.value = '';
            });
          }}
        />
        {q.isLoading ? (
          <div className="flex justify-center py-16">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <>
            <EmptyFolderHint code={data?.folder?.code} isEmpty={empty} />
            {!empty && (
              <ExplorerList
                folders={folders}
                files={files}
                selection={selection}
                onSelect={setSelection}
                onOpenFolder={(id) => navigate(`/app/documents/${archiveId}?folder=${id}`)}
                onOpenFile={(f) => f.file_url && setPreview(f)}
              />
            )}
          </>
        )}
        {/* pointer-events-none — эс бөгөөс оверлэй өөрөө курсорыг барьж
            dragleave/dragenter анивчина. */}
        {dragging || h.uploading ? (
          <div className="pointer-events-none absolute inset-0 z-20 flex flex-col items-center justify-center gap-2 border-2 border-dashed border-primary bg-background/85 text-center backdrop-blur-sm">
            {h.uploading ? (
              <>
                <Loader2 className="h-7 w-7 animate-spin text-primary" />
                <p className="text-sm font-medium text-foreground">
                  {t('documentsPage.uploading', {
                    done: h.uploading.done,
                    total: h.uploading.total,
                  })}
                </p>
              </>
            ) : (
              <>
                <Upload className="h-7 w-7 text-primary" />
                <p className="text-sm font-medium text-foreground">
                  {t('documentsPage.dropHere', {
                    folder: data?.folder?.name ?? data?.archive.name ?? '',
                  })}
                </p>
                <p className="text-xs text-muted-foreground">{t('documentsPage.dropTypes')}</p>
              </>
            )}
          </div>
        ) : null}
      </div>
      <DocPreviewDialog
        file={preview}
        onClose={() => setPreview(null)}
        onChanged={() => void q.refetch()}
      />
      <ConflictDialog
        open={conflicts != null}
        names={conflicts ?? []}
        onDecide={(choice) => decide.current?.(choice)}
      />
      <NameDialog
        open={dialog === 'new'}
        title={t('documentsPage.newFolder')}
        initial=""
        onClose={() => setDialog(null)}
        onSubmit={(name) => {
          setDialog(null);
          void h.createFolder(name);
        }}
      />
      <NameDialog
        open={dialog === 'rename'}
        title={t('documentsPage.rename')}
        initial={selection?.name ?? ''}
        onClose={() => setDialog(null)}
        onSubmit={(name) => {
          setDialog(null);
          void h.rename(name);
        }}
      />
    </PageContainer>
  );
}
