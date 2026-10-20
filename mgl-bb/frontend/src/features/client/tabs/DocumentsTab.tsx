/**
 * 04 — Баримт бичиг.  Захиалагчийн портал (миграц 0327, 2026-09-18; эрхийн
 * дүрэм 2026-09-21-нд эзний шийдвэрээр өөрчлөгдсөн).
 *
 * Төсөлд эрхтэй байгууллагын захиалагч төслийн Drive хавтсыг БҮХЭЛД НЬ харж,
 * татна (view-only).  Байршуулах нь ЗӨВХӨН «09 ЗАХИАЛАГЧААС ИРСЭН МАТЕРИАЛ»
 * хавтас + түүний дэд мод, зөвхөн `contributor`/`approver` түвшний хүнд.  Юу
 * харагдах, хаана байршуулж болохыг СЕРВЕР шийднэ
 * (`backend/src/routes/clientDrive.ts`: төлөвийн `upload_folder`/`can_upload`,
 * хуудас бүрийн `can_upload`) — энд дүрэм давхардуулаагүй; товч нуух нь зөвхөн
 * UX, 09-өөс гадуур байршуулах оролдлогыг сервер 403 өгнө.
 *
 * Ажилтны «Баримт бичиг» табын ижил компонентууд (`DriveItemList`, `DriveBreadcrumb`,
 * `DriveFilePreviewDialog`, `DriveUploadZone`, `DriveUploadPanel`, `runDriveUploads`,
 * `useDriveFolder`, `useDriveDragSession`) `scope = 'client'`-ээр.  Нэр солих,
 * зөөх, хувилбар, «эх файлыг нээх» — БАЙХГҮЙ (сервер `open_url`-ыг ч буцаадаггүй).
 *
 * 2026-09-23: порталын шинэ дизайнд зөвхөн ХҮРЭЭ (толгой, хүрээ, төлөв)
 * өөрчлөгдсөн — Drive-ийн логик өмнөхтэй байт-ижил.
 */
import { lazy, Suspense, useCallback, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, FolderUp, Loader2, RefreshCw, Upload } from 'lucide-react';
import { Button } from '@/ui/button';
import { toast } from '@/shared/components/Toast';
import { useLanguage } from '@/shared/i18n';
import { cn } from '@/shared/lib/utils';
import { downloadDriveFile, driveFolderKey } from '@/features/projects/drive/api';
import { DriveBreadcrumb } from '@/features/projects/drive/DriveBreadcrumb';
import { describeDriveError } from '@/features/projects/drive/driveErrors';
import { DriveItemList } from '@/features/projects/drive/DriveItemList';
import { DriveEmptyFolder, DriveErrorState, DriveListSkeleton } from '@/features/projects/drive/DriveStates';
import { DriveUploadConflictDialog } from '@/features/projects/drive/DriveUploadDialogs';
import { DriveUploadPanel } from '@/features/projects/drive/DriveUploadPanel';
import { DriveUploadZone } from '@/features/projects/drive/DriveUploadZone';
import {
  entriesFromDataTransfer,
  findNameConflicts,
  runDriveUploads,
  type UploadEntry,
  type UploadItem,
} from '@/features/projects/drive/driveUpload';
import { downloadName, driveFileKind } from '@/features/projects/drive/fileKind';
import type { DriveItem, DriveUploadConflict } from '@/features/projects/drive/types';
import { useDriveDragSession } from '@/features/projects/drive/useDriveDragSession';
import { useDriveFolder, useDriveStatus } from '@/features/projects/drive/useDriveFolder';

import { EmptyState, SectionHeader, SkeletonBar } from '../components/primitives';

const DriveFilePreviewDialog = lazy(() =>
  import('@/features/projects/drive/DriveFilePreviewDialog').then((m) => ({ default: m.DriveFilePreviewDialog })),
);

const SCOPE = 'client' as const;

export function DocumentsTab({
  projectId,
  active = true,
}: {
  projectId: number;
  /** Таб ил байна уу — keep-alive таб далд байхад document-түвшний чирэлтийг асаахгүй. */
  active?: boolean;
}) {
  const { t } = useLanguage();
  const qc = useQueryClient();
  const [folderId, setFolderId] = useState('root');
  const [previewFile, setPreviewFile] = useState<DriveItem | null>(null);

  const status = useDriveStatus(SCOPE, projectId);
  const linked = status.data?.linked === true;
  const folder = useDriveFolder(SCOPE, projectId, folderId, linked);
  const { query, first, items } = folder;
  const rootName = status.data?.project_name ?? '';
  const errorView = query.isError ? describeDriveError(query.error) : null;

  // Байршуулах эрх: түвшин (төлөв) + ЭНЭ хавтас 09-ийн дотор (хуудас).
  const uploadFolder = status.data?.upload_folder ?? null;
  const hasUploadLevel = status.data?.can_upload === true;
  const canUploadHere = hasUploadLevel && first?.can_upload === true;

  /* ---- Байршуулах (зөвхөн 09) --------------------------------------- */

  const [uploadItems, setUploadItems] = useState<UploadItem[] | null>(null);
  const [uploading, setUploading] = useState(false);
  const uploadAbort = useRef<AbortController | null>(null);
  const [pendingEntries, setPendingEntries] = useState<{ entries: UploadEntry[]; conflicts: string[] } | null>(null);

  const runUploads = useCallback(
    async (entries: UploadEntry[], conflict: DriveUploadConflict, targetFolderId: string) => {
      const ac = new AbortController();
      uploadAbort.current = ac;
      setUploading(true);
      try {
        const summary = await runDriveUploads(entries, {
          scope: SCOPE,
          id: projectId,
          folderId: targetFolderId,
          conflict,
          signal: ac.signal,
          onUpdate: setUploadItems,
        });
        if (summary.failed === 0 && summary.cancelled === 0) {
          toast.success(t('projectDrive.uploadSummaryOk', { n: String(summary.done) }));
        } else if (summary.done > 0 || summary.failed > 0) {
          toast.info(
            t('projectDrive.uploadSummaryPartial', { ok: String(summary.done), failed: String(summary.failed) }),
          );
        }
        if (summary.done > 0) {
          await folder.refresh();
          if (targetFolderId !== folderId) {
            await qc.invalidateQueries({ queryKey: driveFolderKey(SCOPE, projectId, targetFolderId) });
          }
        }
      } finally {
        setUploading(false);
        uploadAbort.current = null;
      }
    },
    [projectId, t, folder, folderId, qc],
  );

  /** Сонгосон/чирсэн бичлэгүүд — зөвхөн ХАРЖ БУЙ хавтсанд (09 дотор); ижил нэртэй файл байвал асууна. */
  const beginUpload = useCallback(
    async (entries: UploadEntry[]) => {
      if (uploading || !canUploadHere) return;
      if (entries.length === 0) {
        toast.info(t('projectDrive.uploadNothing'));
        return;
      }
      const conflicts = findNameConflicts(entries, folder.items);
      if (conflicts.length > 0) {
        setPendingEntries({ entries, conflicts });
        return;
      }
      void runUploads(entries, 'replace', folderId);
    },
    [uploading, canUploadHere, folder.items, folderId, runUploads, t],
  );

  const onConflictChoice = (choice: DriveUploadConflict | null) => {
    const pending = pendingEntries;
    setPendingEntries(null);
    if (!pending || !choice) return;
    void runUploads(pending.entries, choice, folderId);
  };

  const cancelUploads = () => uploadAbort.current?.abort();

  // Чирж тавих — зөвхөн энэ таб ил + 09 дотор + байршуулалт явахгүй үед; зорилт нь
  // зөвхөн байршуулах бүс (мөрүүд чирэгддэггүй, зөөх байхгүй).
  const canDrop = active && canUploadHere && !uploading && !query.isError;
  const drag = useDriveDragSession(canDrop, {
    onDropFiles: (dt, target) => {
      if (target.kind !== 'zone') return;
      void entriesFromDataTransfer(dt).then((entries) => beginUpload(entries));
    },
    onDropItem: () => {},
    onSpringOpen: () => {},
  });
  const dragging = drag.active === 'files';
  const overZone = dragging && drag.over?.kind === 'zone';

  /* ---- Төлөв ----------------------------------------------------------- */

  const handleDownload = async (item: DriveItem) => {
    try {
      await downloadDriveFile(SCOPE, projectId, item.id, downloadName(item.name, driveFileKind(item.mime_type, item.name)));
    } catch (err) {
      toast.error(t(describeDriveError(err).key));
    }
  };

  const header = (
    <SectionHeader
      index="04"
      eyebrow={t('clientRoom.nav.documents')}
      title={t('clientRoom.documents.title')}
      description={linked ? (hasUploadLevel ? t('clientRoom.documents.hintUpload') : t('clientRoom.documents.hint')) : undefined}
      aside={
        linked ? (
          <>
            {/* Байршуулах эрхтэй ч 09-ийн гадна байгаа бол — 09 руу очих богино зам. */}
            {hasUploadLevel && uploadFolder && !canUploadHere ? (
              <Button
                size="sm"
                onClick={() => setFolderId(uploadFolder.id)}
                data-testid="client-go-upload-folder"
                className="rounded-none bg-foreground text-background hover:bg-foreground/85"
              >
                <FolderUp className="h-4 w-4" strokeWidth={1.75} /> {t('clientRoom.documents.goToUpload')}
              </Button>
            ) : null}
            <Button
              size="sm"
              variant="outline"
              onClick={() => void folder.refresh()}
              disabled={query.isFetching}
              className="rounded-none border-foreground/25 bg-transparent"
            >
              {folder.isRefreshing ? (
                <Loader2 className="h-4 w-4 motion-safe:animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4" strokeWidth={1.75} />
              )}
              {t('projectDrive.refresh')}
            </Button>
          </>
        ) : null
      }
    />
  );

  if (status.isPending) {
    return (
      <div className="flex flex-col gap-12 pt-10 md:pt-14">
        {header}
        <SkeletonBar className="h-64" />
      </div>
    );
  }

  if (!linked) {
    return (
      <div className="flex flex-col gap-12 pt-10 md:pt-14">
        {header}
        <EmptyState title={t('clientRoom.documents.emptyTitle')} body={t('clientRoom.documents.empty')} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-10 pt-10 md:gap-12 md:pt-14">
      {header}

      <div className="flex flex-col gap-4">
        <div className="border-y border-foreground/10 py-3">
          <DriveBreadcrumb path={first?.path ?? []} rootName={rootName} onNavigate={setFolderId} />
        </div>

        {/* Байршуулах бүс — ЗӨВХӨН 09 хавтас (эсвэл түүний дэд хавтас) дотор. */}
        {canUploadHere && (
          <DriveUploadZone
            disabled={!canDrop}
            folderId={folderId}
            folderName={first?.folder.name ?? rootName}
            over={overZone}
            dragging={dragging}
            onEntries={(entries) => void beginUpload(entries)}
          />
        )}

        {/* Байршуулах эрхтэй атлаа 09 хавтас Drive-д байхгүй — ил хэлнэ (менежер хавтас үүсгэнэ). */}
        {hasUploadLevel && !uploadFolder && (
          <div
            className="flex items-start gap-3 border border-warning/40 bg-warning/5 px-5 py-4 text-body text-foreground"
            data-testid="client-upload-folder-missing"
          >
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" strokeWidth={1.75} />
            <span>{t('clientRoom.documents.uploadFolderMissing')}</span>
          </div>
        )}

        {uploadItems && uploadItems.length > 0 && (
          <DriveUploadPanel items={uploadItems} running={uploading} onCancel={cancelUploads} onClose={() => setUploadItems(null)} />
        )}

        {dragging && (
          <div className="pointer-events-none fixed inset-x-0 bottom-6 z-50 flex justify-center">
            <div className="flex items-center gap-2 border border-foreground/15 bg-background/95 px-4 py-2 text-micro text-foreground shadow-lg">
              <Upload className="h-4 w-4" strokeWidth={1.75} />
              <span>{t('projectDrive.dragFilesHint')}</span>
              <span className="text-muted-foreground">· {t('projectDrive.dragCancelHint')}</span>
            </div>
          </div>
        )}

        <div
          className={cn(
            'overflow-hidden border border-foreground/10 bg-card transition-colors',
            overZone && 'ring-2 ring-foreground/30',
          )}
          data-drop-kind={canDrop ? 'zone' : undefined}
          data-drop-id={canDrop ? folderId : undefined}
          data-drop-name={canDrop ? (first?.folder.name ?? rootName) : undefined}
        >
          {query.isPending ? (
            <DriveListSkeleton />
          ) : errorView ? (
            <DriveErrorState
              view={errorView}
              isAdmin={false}
              onRetry={() => void folder.refresh()}
              retrying={query.isFetching}
              extra={
                folderId !== 'root' ? (
                  <Button size="sm" variant="ghost" onClick={() => setFolderId('root')}>
                    {t('projectDrive.backToRoot')}
                  </Button>
                ) : null
              }
            />
          ) : items.length === 0 ? (
            <DriveEmptyFolder />
          ) : (
            <>
              <DriveItemList
                items={items}
                onOpenFolder={(item) => setFolderId(item.id)}
                onPreview={setPreviewFile}
                onDownload={handleDownload}
              />
              {query.hasNextPage && (
                <div className="flex justify-center border-t border-foreground/10 p-2">
                  <Button size="sm" variant="ghost" onClick={() => void query.fetchNextPage()} disabled={query.isFetchingNextPage}>
                    {query.isFetchingNextPage ? <Loader2 className="h-4 w-4 motion-safe:animate-spin" /> : null}
                    {t('projectDrive.loadMore')}
                  </Button>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      <DriveUploadConflictDialog names={pendingEntries?.conflicts ?? []} onChoose={onConflictChoice} />

      <Suspense fallback={null}>
        {previewFile && (
          <DriveFilePreviewDialog scope={SCOPE} id={projectId} file={previewFile} onClose={() => setPreviewFile(null)} />
        )}
      </Suspense>
    </div>
  );
}

export default DocumentsTab;
