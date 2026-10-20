/**
 * «Түүх» самбар — төслийн хавтасны СҮҮЛИЙН ӨӨРЧЛӨЛТҮҮД (бүх файл, шинэ нь
 * эхэнд): хэн, хэзээ, аль файл, юу.  Мөр дарахад тэр файлын хувилбарын цонх.
 * Эх сурвалж нь ledger (`GET …/drive/activity`), Drive руу дуудахгүй — тиймээс
 * хурдан, харин сонсогч 2 минут тутам + 3 минут «тогтох» хүлээлттэй тул
 * хамгийн сүүлийн засвар хэдэн минутын дараа л гарна (`pending` тоо үүнийг
 * ил хэлнэ).
 *
 * Админд: «Эхний хуулбар авах» — сонсогч зөвхөн ирээдүйн өөрчлөлтийг өгдөг тул
 * холбосны дараа нэг удаа дарж одоо байгаа файл бүрийн анхны хуулбарыг авна.
 */
import { useQuery } from '@tanstack/react-query';
import { Camera, History, Loader2, RefreshCw } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/ui/button';
import { confirmDialog } from '@/shared/components/ConfirmDialog';
import { toast } from '@/shared/components/Toast';
import { useLanguage } from '@/shared/i18n';
import { formatDateTime } from '@/shared/lib/time';
import { driveActivityKey, enqueueDriveBaseline, fetchDriveActivity } from './api';
import { describeDriveError } from './driveErrors';
import { DriveFileIcon } from './DriveFileIcon';
import { DriveListSkeleton } from './DriveStates';
import { ChangeKindBadge } from './DriveVersionsDialog';
import { driveFileKind } from './fileKind';
import type { DriveScope, DriveVersion } from './types';
import { versionActorKey } from './versionLabels';

export function DriveActivityPanel({
  scope,
  id,
  isAdmin,
  onOpenVersions,
}: {
  scope: DriveScope;
  id: number;
  isAdmin: boolean;
  onOpenVersions: (file: { id: string; name: string }) => void;
}) {
  const { t } = useLanguage();
  const [baselining, setBaselining] = useState(false);
  const q = useQuery({
    queryKey: driveActivityKey(scope, id),
    queryFn: () => fetchDriveActivity(scope, id),
    staleTime: 30_000,
    refetchInterval: 60_000,
    retry: false,
  });
  const items = q.data?.items ?? [];
  const pending = q.data?.pending ?? 0;

  const baseline = async () => {
    const ok = await confirmDialog({
      title: t('projectDrive.baselineTitle'),
      description: t('projectDrive.baselineConfirm'),
      confirmText: t('projectDrive.baseline'),
    });
    if (!ok) return;
    setBaselining(true);
    try {
      const res = await enqueueDriveBaseline(scope, id);
      toast.success(
        t(res.truncated ? 'projectDrive.baselineQueuedTruncated' : 'projectDrive.baselineQueued', {
          files: String(res.files),
        }),
      );
      await q.refetch();
    } catch (err) {
      toast.error(t(describeDriveError(err).key));
    } finally {
      setBaselining(false);
    }
  };

  return (
    <div className="rounded-xl border border-border bg-card">
      <div className="flex flex-wrap items-center gap-2 border-b border-border/60 px-4 py-2.5">
        <History className="h-4 w-4 text-muted-foreground" />
        <h3 className="text-sm font-semibold text-foreground">{t('projectDrive.activityTitle')}</h3>
        {pending > 0 && (
          <span className="text-xs text-muted-foreground">{t('projectDrive.activityPending', { n: String(pending) })}</span>
        )}
        <span className="ml-auto flex items-center gap-1">
          {isAdmin && (
            <Button size="sm" variant="ghost" onClick={() => void baseline()} disabled={baselining} title={t('projectDrive.baselineHint')}>
              {baselining ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />}
              {t('projectDrive.baseline')}
            </Button>
          )}
          <Button size="icon-sm" variant="ghost" onClick={() => void q.refetch()} disabled={q.isFetching} title={t('projectDrive.refresh')}>
            {q.isFetching ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          </Button>
        </span>
      </div>

      {q.isPending ? (
        <DriveListSkeleton rows={4} />
      ) : q.isError ? (
        <p className="px-4 py-3 text-sm text-destructive">{t(describeDriveError(q.error).key)}</p>
      ) : items.length === 0 ? (
        <p className="px-4 py-6 text-center text-sm text-muted-foreground">{t('projectDrive.activityEmpty')}</p>
      ) : (
        <ol className="max-h-96 divide-y divide-border/50 overflow-y-auto">
          {items.map((v) => (
            <ActivityRow key={v.id} v={v} onOpen={() => onOpenVersions({ id: v.file_id, name: v.file_name })} />
          ))}
        </ol>
      )}
      <p className="border-t border-border/60 px-4 py-2 text-[11px] text-muted-foreground">{t('projectDrive.activityNote')}</p>
    </div>
  );
}

function ActivityRow({ v, onOpen }: { v: DriveVersion; onOpen: () => void }) {
  const { t } = useLanguage();
  const actor = versionActorKey(v);
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 text-left text-sm transition-colors hover:bg-muted/40"
      >
        <span className="tabular-nums text-xs text-muted-foreground">{formatDateTime(v.drive_modified_at ?? v.created_at)}</span>
        <ChangeKindBadge kind={v.change_kind} />
        <span className="flex min-w-0 flex-1 items-center gap-2">
          <DriveFileIcon kind={driveFileKind(v.mime_type, v.file_name)} />
          <span className="truncate font-medium text-foreground">{v.file_name}</span>
        </span>
        <span className="truncate text-xs text-muted-foreground">{t(actor.key, actor.params)}</span>
      </button>
    </li>
  );
}
