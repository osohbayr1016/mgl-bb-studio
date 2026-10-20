/**
 * «Баримт бичиг» таб — төслийн Google Drive хавтсыг хуудсан дотор үзэх.
 *
 * Google Drive нь ЭХ СУРВАЛЖ: файл тэнд л байна, ERP нь зөвхөн хавтасны
 * холбоосыг хадгалж (`projects.google_drive_folder_id`), агуулгыг серверээр
 * дамжуулан Drive API-аас уншина.  Хавтас солих бүрт ЗӨВХӨН тэр хавтасны
 * шууд хүүхдүүд татагдана (§11); одоогийн хавтас нь `?folder=` URL параметр
 * тул «буцах» товч, хуваалцах холбоос хоёулаа ажиллана.
 *
 * Төлөвүүд (§10): ачаалж байна (skeleton) · холбогдоогүй (админд холбох маягт,
 * бусдад тайлбар) · байршуулалтад тохируулаагүй · хоосон хавтас · Drive-ын
 * алдаа (хавтас устсан, эрхгүй, Google унасан) · хуудаслалт («Цааш»).
 *
 * Байршуулах (2026-09-17, 2026-09-18-нд бүс болсон): жагсаалтын дээрх
 * `DriveUploadZone` (чирж тавих + файл / хавтас сонгох), «Шинэ хавтас» тусдаа
 * товч, мөн жагсаалт өөрөө drop зорилт.  Файл ОДОО ХАРЖ БУЙ хавтсанд очно — ажилтан
 * хавтсаа сонгоод оруулна (эзний шийдвэр).  Ижил нэртэй файл байвал нэг удаа
 * асууна (шинэ хувилбар / хоёуланг үлдээх).  Явц `DriveUploadPanel`-д;
 * дуусахад жагсаалт + «Түүх» шинэчлэгдэнэ (`driveUpload.ts`).
 *
 * Гарын үсэг (2026-10-01): Word баримтын цонхонд «Гарын үсэг» самбар
 * (`signing/`); мэдэгдлийн холбоос `?file=<id>&sign=1` нь тэр файлыг самбартай нь
 * шууд нээнэ; жагсаалтын мөрөнд «Батлах хүлээгдэж буй / Батлагдсан» тэмдэг.
 */
import { lazy, Suspense, useCallback, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { FolderInput, FolderPlus, History, Loader2, RefreshCw, Settings2, Upload, Users } from 'lucide-react';
import { Button } from '@/ui/button';
import { toast } from '@/shared/components/Toast';
import { useLanguage } from '@/shared/i18n';
import { useAuth } from '@/shared/context/AuthContext';
import { cn } from '@/shared/lib/utils';
import { downloadDriveFile, driveActivityKey, driveFolderKey, fetchDriveFile, fetchDriveFolder, moveDriveItem } from './api';
import { fetchSigningStatuses, signingStatusesKey } from './signing/api';
import { DriveBreadcrumb } from './DriveBreadcrumb';
import { describeDriveError } from './driveErrors';
import { DriveFolderForm } from './DriveFolderForm';
import { DriveItemList } from './DriveItemList';
import { DriveSharingForm } from './DriveSharingForm';
import { DriveEmptyFolder, DriveErrorState, DriveListSkeleton } from './DriveStates';
import { DriveNewFolderDialog, DriveRenameDialog, DriveUploadConflictDialog } from './DriveUploadDialogs';
import { DriveUploadZone } from './DriveUploadZone';
import { DriveUploadPanel } from './DriveUploadPanel';
import {
  entriesFromDataTransfer,
  findNameConflicts,
  runDriveUploads,
  type UploadEntry,
  type UploadItem,
} from './driveUpload';
import { downloadName, driveFileKind, isDocxFile } from './fileKind';
import type { DriveDragPayload, DriveItem, DriveScope, DriveUploadConflict } from './types';
import { useDriveDragSession, type DropTarget } from './useDriveDragSession';
import { useDriveFolder, useDriveStatus } from './useDriveFolder';
import { openDriveFileInGoogle } from './openInGoogle';

const DriveFilePreviewDialog = lazy(() =>
  import('./DriveFilePreviewDialog').then((m) => ({ default: m.DriveFilePreviewDialog })),
);
// Хувилбарын түүх (миграц 0300) — «Түүх» самбар + файл бүрийн цонх.  Lazy:
// зөвхөн тэр товч дарахад ачаалагдана.
const DriveVersionsDialog = lazy(() =>
  import('./DriveVersionsDialog').then((m) => ({ default: m.DriveVersionsDialog })),
);
const DriveActivityPanel = lazy(() =>
  import('./DriveActivityPanel').then((m) => ({ default: m.DriveActivityPanel })),
);
// Захиалагч (миграц 0327) — самбар + урих цонх, зөвхөн төслийн scope.  2026-09-21-ээс
// захиалагч төслийн хавтсыг БҮХЭЛД НЬ view-only харж, зөвхөн «09» хавтсанд байршуулдаг
// тул мөр бүрийн «Захиалагчид нээх» товч, нээлтийн тэмдэг, `ClientShareDialog` энд
// АШИГЛАГДАХАА больсон (`backend/src/routes/clientDrive.ts`); самбар нь эрхтэй
// байгууллага, урилга, хандалтын лог л харуулна.
const ClientSharePanel = lazy(() => import('./ClientSharePanel').then((m) => ({ default: m.ClientSharePanel })));
const ClientInviteDialog = lazy(() => import('./ClientInviteDialog').then((m) => ({ default: m.ClientInviteDialog })));

const FOLDER_PARAM = 'folder';
/** Мэдэгдлийн холбоос: `?file=<Drive id>` тэр файлыг нээнэ, `&sign=1` гарын үсгийн самбартай. */
const FILE_PARAM = 'file';
const SIGN_PARAM = 'sign';

export default function DriveBrowser({
  scope,
  id,
  isAdmin,
}: {
  /** 'project' = ангиллын төсөл, 'main' = үндсэн төсөл — серверийн ижил handler. */
  scope: DriveScope;
  id: number;
  isAdmin: boolean;
}) {
  const { t } = useLanguage();
  const qc = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const folderId = searchParams.get(FOLDER_PARAM) || 'root';
  const [previewFile, setPreviewFile] = useState<DriveItem | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [versionsFile, setVersionsFile] = useState<{ id: string; name: string } | null>(null);
  const [activityOpen, setActivityOpen] = useState(false);

  // Захиалагчийн самбар — эрх нь БАЙГУУЛЛАГА × ТӨСӨЛ тул зөвхөн ангиллын төслийн
  // хуудсанд (үндсэн төслийн scope-д аль төсөл гэдэг нь тодорхойгүй).  2026-09-24-нөөс
  // энэ табыг бүх ажилтан хардаг тул `/api/client-admin` (`requireManager`)-ийн
  // admin + senior хосоор хаана — эс бөгөөс engineer самбар нээгээд 403 авна.
  const { user } = useAuth();
  const clientMode = scope === 'project' && (user?.role === 'admin' || user?.role === 'senior');
  const [clientOpen, setClientOpen] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);

  // Байршуулалт
  const [uploadItems, setUploadItems] = useState<UploadItem[] | null>(null);
  const [uploading, setUploading] = useState(false);
  const uploadAbort = useRef<AbortController | null>(null);
  const [pendingEntries, setPendingEntries] = useState<{
    entries: UploadEntry[];
    conflicts: string[];
    target: string;
  } | null>(null);
  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const [renameItem, setRenameItem] = useState<DriveItem | null>(null);

  const status = useDriveStatus(scope, id);
  const linked = status.data?.linked === true;
  const folder = useDriveFolder(scope, id, folderId, linked);

  // Мэдэгдлийн холбоосоор ирсэн файл (`?file=`) — жагсаалтад хайхгүй, шууд мета.
  const fileParam = searchParams.get(FILE_PARAM);
  const signParam = searchParams.get(SIGN_PARAM) === '1';
  const deepLink = useQuery({
    queryKey: ['project-drive', scope, id, 'file', fileParam],
    queryFn: () => fetchDriveFile(scope, id, fileParam ?? ''),
    enabled: linked && !!fileParam,
    retry: false,
    staleTime: Infinity,
  });
  const dialogFile = previewFile ?? (fileParam ? (deepLink.data?.item ?? null) : null);
  const closePreview = useCallback(() => {
    setPreviewFile(null);
    if (searchParams.has(FILE_PARAM) || searchParams.has(SIGN_PARAM)) {
      const next = new URLSearchParams(searchParams);
      next.delete(FILE_PARAM);
      next.delete(SIGN_PARAM);
      setSearchParams(next, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  // Word баримтын гарын үсгийн тэмдэг — зөвхөн D1 (Drive руу дуудахгүй).
  const docxIds = useMemo(
    () => folder.items.filter((i) => i.kind === 'file' && isDocxFile(i.mime_type, i.name)).map((i) => i.id),
    [folder.items],
  );
  const signStatuses = useQuery({
    queryKey: signingStatusesKey(scope, id, docxIds),
    queryFn: () => fetchSigningStatuses(scope, id, docxIds),
    enabled: linked && scope !== 'client' && docxIds.length > 0,
    staleTime: 30_000,
    retry: false,
  });

  const navigate = useCallback(
    (nextFolderId: string) => {
      const next = new URLSearchParams(searchParams);
      if (nextFolderId === 'root') next.delete(FOLDER_PARAM);
      else next.set(FOLDER_PARAM, nextFolderId);
      setSearchParams(next);
    },
    [searchParams, setSearchParams],
  );

  const handleDownload = async (item: DriveItem) => {
    try {
      await downloadDriveFile(scope, id, item.id, downloadName(item.name, driveFileKind(item.mime_type, item.name)));
    } catch (err) {
      toast.error(t(describeDriveError(err).key));
    }
  };

  /* ---- Байршуулах ------------------------------------------------------ */

  /** Байршуулалт/зөөлтийн дараа: одоогийн хавтас + (өөр байвал) зорилтот хавтас + «Түүх». */
  const afterChange = useCallback(
    async (targetFolderId?: string) => {
      await folder.refresh();
      if (targetFolderId && targetFolderId !== folderId) {
        await qc.invalidateQueries({ queryKey: driveFolderKey(scope, id, targetFolderId) });
      }
      await qc.invalidateQueries({ queryKey: driveActivityKey(scope, id) });
    },
    [folder, qc, scope, id, folderId],
  );

  /** «Эх файлыг нээх» — .docx-ийг Google-д Word-той ижил харагдахаар бэлтгээд нээнэ (шинэ
   *  хувилбар байршвал жагсаалт + «Түүх» шинэчлэгдэнэ). */
  const openOriginal = useCallback(
    (item: DriveItem) => openDriveFileInGoogle({ scope, id, item, t, onFixed: () => void afterChange() }),
    [scope, id, t, afterChange],
  );

  const runUploads = useCallback(
    async (entries: UploadEntry[], conflict: DriveUploadConflict, targetFolderId: string) => {
      const ac = new AbortController();
      uploadAbort.current = ac;
      setUploading(true);
      try {
        const summary = await runDriveUploads(entries, {
          scope,
          id,
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
        if (summary.done > 0) await afterChange(targetFolderId);
      } finally {
        setUploading(false);
        uploadAbort.current = null;
      }
    },
    [scope, id, t, afterChange],
  );

  /**
   * Сонгосон/чирсэн бичлэгүүд — ижил нэртэй файл байвал эхлээд асууна.
   * `target` = харж буй хавтас (өгөгдмөл) эсвэл чирж тавьсан хавтас; сүүлийнх нь
   * жагсаалтад байхгүй тул давхардлыг мэдэхийн тулд эхний хуудсыг нь уншина.
   */
  const beginUpload = useCallback(
    async (entries: UploadEntry[], target: string = folderId) => {
      if (uploading) return;
      if (entries.length === 0) {
        toast.info(t('projectDrive.uploadNothing'));
        return;
      }
      let existing: DriveItem[] = folder.items;
      if (target !== folderId) {
        try {
          existing = (await fetchDriveFolder(scope, id, target)).items;
        } catch (err) {
          toast.error(t(describeDriveError(err).key));
          return;
        }
      }
      const conflicts = findNameConflicts(entries, existing);
      if (conflicts.length > 0) {
        setPendingEntries({ entries, conflicts, target });
        return;
      }
      void runUploads(entries, 'replace', target);
    },
    [uploading, folder.items, folderId, scope, id, runUploads, t],
  );

  const onConflictChoice = (choice: DriveUploadConflict | null) => {
    const pending = pendingEntries;
    setPendingEntries(null);
    if (!pending || !choice) return;
    void runUploads(pending.entries, choice, pending.target);
  };

  const cancelUploads = () => uploadAbort.current?.abort();

  /* ---- Зөөх (жагсаалтын мөрийг чирж хавтас / breadcrumb дээр тавих) ---- */

  /** Зорилтын Drive id — бүс = харж буй хавтас, мөр/breadcrumb = өөрийн id ('root' байж болно). */
  const dropFolderId = (target: DropTarget) => (target.kind === 'zone' ? folderId : target.id);

  const moveItem = useCallback(
    async (payload: DriveDragPayload, target: { id: string; name: string }) => {
      try {
        const res = await moveDriveItem(scope, id, payload.id, target.id);
        if (!res.moved) {
          toast.info(t('projectDrive.moveSame'));
          return;
        }
        toast.success(t('projectDrive.movedToast', { name: payload.name }));
        await afterChange(target.id);
      } catch (err) {
        toast.error(t(describeDriveError(err).key));
      }
    },
    [scope, id, t, afterChange],
  );

  // Чирж тавих — ГАНЦ document-түвшний session (`useDriveDragSession`): хөтчийн
  // default (файл нээх) хаагдана, Esc/цонхноос гарах/буух бүр цэвэрлэнэ, зорилтыг
  // `data-drop-*` атрибутаар олно.  Байршуулалт явж байхад шинэ чирэлт хүлээж авахгүй.
  const canDrop = linked && !uploading;
  const drag = useDriveDragSession(canDrop, {
    onDropFiles: (dt, target) => {
      void entriesFromDataTransfer(dt).then((entries) => beginUpload(entries, dropFolderId(target)));
    },
    onDropItem: (payload, target) => void moveItem(payload, { id: dropFolderId(target), name: target.name }),
    onSpringOpen: (folderId) => navigate(folderId),
  });
  const dragging = drag.active !== null;
  const overZone = drag.over?.kind === 'zone';
  const overFolderId = drag.over?.kind === 'folder' ? drag.over.id : null;
  const overCrumbId = drag.over?.kind === 'crumb' ? drag.over.id : null;

  /* ---- Тохиргооны төлөв ------------------------------------------------ */

  if (status.isLoading) {
    return (
      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <DriveListSkeleton />
      </div>
    );
  }

  if (status.isError) {
    return (
      <div className="rounded-xl border border-border bg-card">
        <DriveErrorState
          view={describeDriveError(status.error)}
          isAdmin={isAdmin}
          onRetry={() => void status.refetch()}
          retrying={status.isFetching}
        />
      </div>
    );
  }

  if (!linked) {
    return (
      <div className="rounded-xl border border-border bg-card p-5">
        <h3 className="text-sm font-semibold text-foreground">{t('projectDrive.notLinkedTitle')}</h3>
        {isAdmin ? (
          <div className="mt-3">
            <DriveFolderForm scope={scope} id={id} />
          </div>
        ) : (
          <p className="mt-1 text-sm text-muted-foreground">{t('projectDrive.notLinkedBody')}</p>
        )}
      </div>
    );
  }

  /* ---- Хавтас --------------------------------------------------------- */

  const { query, first, items } = folder;
  const rootName = first?.root.name ?? status.data?.folder_name ?? '';
  const errorView = query.isError ? describeDriveError(query.error) : null;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-0 flex-1">
          <DriveBreadcrumb
            path={first?.path ?? []}
            rootName={rootName}
            onNavigate={navigate}
            dropTargets={canDrop}
            overId={overCrumbId}
          />
        </div>
        <div className="flex items-center gap-1">
          <Button
            size="sm"
            variant="outline"
            onClick={() => void folder.refresh()}
            disabled={query.isFetching}
            title={t('projectDrive.refreshHint')}
          >
            {folder.isRefreshing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            {t('projectDrive.refresh')}
          </Button>
          {/* «Шинэ хавтас» нь байршуулахаас ТУСДАА (эзний хүсэлт 2026-09-18) —
              байршуулах нь доорх `DriveUploadZone` бүс.  «Drive дээр нээх» энэ
              мөрөөс хасагдсан: Drive руу гарах нь тохиргооны картанд
              (DriveFolderForm) л үлдэнэ. */}
          <Button
            size="sm"
            variant="outline"
            onClick={() => setNewFolderOpen(true)}
            disabled={uploading || query.isError}
            title={t('projectDrive.newFolderHint')}
          >
            <FolderPlus className="h-4 w-4" /> {t('projectDrive.newFolder')}
          </Button>
          <Button
            size="sm"
            variant={activityOpen ? 'secondary' : 'ghost'}
            onClick={() => setActivityOpen((v) => !v)}
            title={t('projectDrive.activityHint')}
            aria-pressed={activityOpen}
          >
            <History className="h-4 w-4" /> {t('projectDrive.activity')}
          </Button>
          {clientMode && (
            <Button
              size="sm"
              variant={clientOpen ? 'secondary' : 'ghost'}
              onClick={() => setClientOpen((v) => !v)}
              title={t('projectDrive.clientShare.toggleHint')}
              aria-pressed={clientOpen}
            >
              <Users className="h-4 w-4" /> {t('projectDrive.clientShare.toggle')}
            </Button>
          )}
          {isAdmin && (
            <Button
              size="icon-sm"
              variant="ghost"
              onClick={() => setSettingsOpen((v) => !v)}
              title={t('projectDrive.settings')}
              aria-label={t('projectDrive.settings')}
              aria-pressed={settingsOpen}
            >
              <Settings2 className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>

      {/* Байршуулах бүс — хэсгийн ДЭЭД талд байнга (эзний хүсэлт 2026-09-18:
          dropdown биш, нээлттэй чирж тавих талбар + файл/хавтас сонгох). */}
      <DriveUploadZone
        disabled={!canDrop || query.isError}
        folderId={folderId}
        folderName={first?.folder.name ?? rootName}
        over={overZone}
        dragging={dragging}
        onEntries={(entries) => void beginUpload(entries)}
      />

      {isAdmin && settingsOpen && (
        <div className="space-y-4 rounded-xl border border-border bg-card p-4">
          <DriveFolderForm scope={scope} id={id} onLinked={() => navigate('root')} compact />
          <div className="border-t border-border/60 pt-4">
            <DriveSharingForm scope={scope} id={id} />
          </div>
        </div>
      )}

      {activityOpen && (
        <Suspense fallback={<div className="h-40 rounded-xl bg-muted/40 animate-pulse" />}>
          <DriveActivityPanel scope={scope} id={id} isAdmin={isAdmin} onOpenVersions={setVersionsFile} />
        </Suspense>
      )}

      {clientMode && clientOpen && (
        <Suspense fallback={<div className="h-32 rounded-xl bg-muted/40 animate-pulse" />}>
          <ClientSharePanel projectId={id} onInvite={() => setInviteOpen(true)} onOpenFolder={navigate} />
        </Suspense>
      )}

      {fileParam && deepLink.isError && (
        <div className="flex items-center justify-between gap-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-foreground">
          <span>{t('docSign.deepLinkMissing')}</span>
          <Button size="sm" variant="ghost" onClick={closePreview}>
            {t('common.close')}
          </Button>
        </div>
      )}

      {uploadItems && uploadItems.length > 0 && (
        <DriveUploadPanel
          items={uploadItems}
          running={uploading}
          onCancel={cancelUploads}
          onClose={() => setUploadItems(null)}
        />
      )}

      {dragging && (
        // Чирэлтийн турш тогтмол зөвлөмж — юу болох, яаж болих.  `pointer-events-none`:
        // чирэлтийн зорилтыг халхлахгүй.
        <div className="pointer-events-none fixed inset-x-0 bottom-6 z-50 flex justify-center">
          <div className="flex items-center gap-2 rounded-full border border-border bg-card/95 px-4 py-1.5 text-xs text-foreground shadow-lg">
            {overFolderId ? <FolderInput className="h-4 w-4 text-primary" /> : <Upload className="h-4 w-4 text-primary" />}
            <span>
              {overFolderId
                ? t('projectDrive.dropIntoFolder', { name: drag.over?.name ?? '' })
                : drag.active === 'item'
                  ? t('projectDrive.dragMoveHint')
                  : t('projectDrive.dragFilesHint')}
            </span>
            <span className="text-muted-foreground">· {t('projectDrive.dragCancelHint')}</span>
          </div>
        </div>
      )}

      <div
        className={cn(
          'relative overflow-hidden rounded-xl border bg-card transition-colors',
          overZone ? 'border-primary ring-2 ring-primary/30' : dragging ? 'border-primary/40 border-dashed' : 'border-border',
        )}
        data-drop-kind={canDrop ? 'zone' : undefined}
        data-drop-id={canDrop ? folderId : undefined}
        data-drop-name={canDrop ? (first?.folder.name ?? rootName) : undefined}
      >
        {overZone && (
          // Backdrop-blur ЗОРИУД байхгүй — dragover бүрд дахин будагддаг тул гацаадаг байв.
          <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-primary/10">
            <div className="flex items-center gap-2 rounded-lg bg-card px-4 py-2 text-sm font-medium text-foreground shadow">
              <Upload className="h-4 w-4 text-primary" /> {t('projectDrive.dropHere')}
            </div>
          </div>
        )}
        {query.isPending ? (
          <DriveListSkeleton />
        ) : errorView ? (
          <DriveErrorState
            view={errorView}
            isAdmin={isAdmin}
            onRetry={() => void folder.refresh()}
            retrying={query.isFetching}
            extra={
              // Хавтас устсан/эрх алга бол дэд хавтаснаас үндэс рүү буцах зам үлдээнэ.
              folderId !== 'root' ? (
                <Button size="sm" variant="ghost" onClick={() => navigate('root')}>
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
              onOpenFolder={(item) => navigate(item.id)}
              onPreview={setPreviewFile}
              onDownload={handleDownload}
              onVersions={(item) => setVersionsFile({ id: item.id, name: item.name })}
              onRename={setRenameItem}
              onOpenOriginal={openOriginal}
              draggable={canDrop}
              overId={overFolderId}
              signStatuses={signStatuses.data?.statuses}
            />
            {query.hasNextPage && (
              <div className="flex justify-center border-t border-border/50 p-2">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => void query.fetchNextPage()}
                  disabled={query.isFetchingNextPage}
                >
                  {query.isFetchingNextPage ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  {t('projectDrive.loadMore')}
                </Button>
              </div>
            )}
          </>
        )}
      </div>

      {first && (
        <p className="text-[11px] text-muted-foreground">
          {scope === 'project' && status.data?.folder_scope === 'main' && status.data.main_project_id != null ? (
            <>
              {t('projectDrive.viaMainNote', { name: status.data.main_project_name ?? '' })}{' '}
              <Link to={`/app/documents/main/${status.data.main_project_id}`} className="underline hover:text-foreground">
                {t('mainProject.openMain')}
              </Link>
              {' · '}
            </>
          ) : null}
          {t('projectDrive.sourceNote')}
        </p>
      )}

      <DriveNewFolderDialog
        scope={scope}
        id={id}
        parentId={folderId}
        open={newFolderOpen}
        onClose={() => setNewFolderOpen(false)}
        onCreated={() => folder.refresh()}
      />
      <DriveUploadConflictDialog names={pendingEntries?.conflicts ?? []} onChoose={onConflictChoice} />
      <DriveRenameDialog
        scope={scope}
        id={id}
        item={renameItem}
        onClose={() => setRenameItem(null)}
        onRenamed={() => afterChange()}
      />

      <Suspense fallback={null}>
        {dialogFile && (
          <DriveFilePreviewDialog
            scope={scope}
            id={id}
            file={dialogFile}
            onClose={closePreview}
            onOpenOriginal={openOriginal}
            signing={scope !== 'client'}
            signingOpenInitially={signParam && dialogFile.id === fileParam}
            onDocumentChanged={() => void afterChange()}
          />
        )}
        {versionsFile && (
          <DriveVersionsDialog
            scope={scope}
            id={id}
            file={versionsFile}
            onClose={() => setVersionsFile(null)}
            onRestored={() => folder.refresh()}
          />
        )}
        {clientMode && inviteOpen && (
          <ClientInviteDialog
            projectId={id}
            open={inviteOpen}
            onClose={() => setInviteOpen(false)}
            onInvited={() => setClientOpen(true)}
          />
        )}
      </Suspense>
    </div>
  );
}
