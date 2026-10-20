/**
 * Нэг Drive файлын ХУВИЛБАРУУД — систем Drive-ыг сонсож хадгалагдсан төлөв
 * бүрийг R2-д хуулбарлаж, «хэн, хэзээ, юу» гэж бүртгэсэн ledger
 * (`project_drive_versions`, миграц 0300).  Мөр бүр: төрөл · хэзээ · хэн ·
 * хэмжээ · татах · «Энэ хувилбар руу буцаах».
 *
 * Буцаах нь ЮУ Ч УСТГАДАГГҮЙ: хуулбарыг Drive руу дахин ачаалахад Drive шинэ
 * хувилбар үүсгэж, энд `restored` мөр (ERP-ийн хүн, аль хувилбараас) нэмэгдэнэ
 * — буцаалтыг өөрийг нь ч буцааж болно.  Google Docs/Sheets/Slides нь
 * docx/xlsx/pptx хэлбэрээр хадгалагдаж, тэр хэлбэрээрээ буцаж импортлогдоно;
 * Drawing (PNG) буцаагдахгүй — товч гарахгүй.
 */
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, History, Loader2, RotateCcw } from 'lucide-react';
import { Badge } from '@/ui/badge';
import { Button } from '@/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/ui/dialog';
import { confirmDialog } from '@/shared/components/ConfirmDialog';
import { toast } from '@/shared/components/Toast';
import { useLanguage } from '@/shared/i18n';
import { formatDateTime } from '@/shared/lib/time';
import { cn } from '@/shared/lib/utils';
import { formatBytes } from '@/features/projects/documents/fileTypes';
import { downloadDriveVersion, driveVersionsKey, fetchDriveVersions, restoreDriveVersion } from './api';
import { describeDriveError } from './driveErrors';
import { DriveListSkeleton } from './DriveStates';
import type { DriveScope, DriveVersion } from './types';
import { changeKindLabelKey, changeKindTone, versionActorKey } from './versionLabels';

const TONE_CLASS: Record<ReturnType<typeof changeKindTone>, string> = {
  destructive: 'border-destructive/40 bg-destructive/10 text-destructive',
  success: 'border-success/40 bg-success/10 text-success',
  warning: 'border-warning/50 bg-warning/10 text-foreground',
  neutral: 'border-border bg-muted/40 text-muted-foreground',
};

export function ChangeKindBadge({ kind }: { kind: DriveVersion['change_kind'] }) {
  const { t } = useLanguage();
  return (
    <Badge variant="outline" className={cn('font-normal', TONE_CLASS[changeKindTone(kind)])}>
      {t(changeKindLabelKey(kind))}
    </Badge>
  );
}

export function DriveVersionsDialog({
  scope,
  id,
  file,
  onClose,
  onRestored,
}: {
  scope: DriveScope;
  id: number;
  file: { id: string; name: string } | null;
  onClose: () => void;
  /** Сэргээсний дараа — дуудагч хавтасны жагсаалтаа шинэчилнэ. */
  onRestored?: () => void | Promise<void>;
}) {
  const { t } = useLanguage();
  const qc = useQueryClient();
  const open = file != null;
  const fileId = file?.id ?? '';
  const [busy, setBusy] = useState<number | null>(null);

  const q = useQuery({
    queryKey: driveVersionsKey(scope, id, fileId),
    queryFn: () => fetchDriveVersions(scope, id, fileId),
    enabled: open,
    staleTime: 15_000,
    retry: false,
  });
  const items = q.data?.items ?? [];

  const download = async (v: DriveVersion) => {
    try {
      await downloadDriveVersion(scope, id, v.id, v.file_name);
    } catch (err) {
      toast.error(t(describeDriveError(err).key));
    }
  };

  const restore = async (v: DriveVersion) => {
    const ok = await confirmDialog({
      title: t('projectDrive.restoreTitle'),
      description: t('projectDrive.restoreConfirm', {
        name: v.file_name,
        when: v.drive_modified_at ? formatDateTime(v.drive_modified_at) : formatDateTime(v.created_at),
      }),
      confirmText: t('projectDrive.restore'),
    });
    if (!ok) return;
    setBusy(v.id);
    try {
      await restoreDriveVersion(scope, id, v.id);
      toast.success(t('projectDrive.restoredToast', { name: v.file_name }));
      await qc.invalidateQueries({ queryKey: ['project-drive', scope, id] });
      await onRestored?.();
    } catch (err) {
      toast.error(t(describeDriveError(err).key));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex min-w-0 items-center gap-2">
            <History className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="truncate">{file?.name}</span>
          </DialogTitle>
          <DialogDescription>{t('projectDrive.versionsIntro')}</DialogDescription>
        </DialogHeader>

        {q.isPending ? (
          <DriveListSkeleton rows={4} />
        ) : q.isError ? (
          <p className="text-sm text-destructive">{t(describeDriveError(q.error).key)}</p>
        ) : items.length === 0 ? (
          <p className="rounded-md border border-dashed border-border px-3 py-6 text-center text-sm text-muted-foreground">
            {t('projectDrive.versionsEmpty')}
          </p>
        ) : (
          <ol className="max-h-[60vh] divide-y divide-border/60 overflow-y-auto rounded-md border border-border">
            {items.map((v, i) => {
              const actor = versionActorKey(v);
              return (
                <li key={v.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm">
                  <ChangeKindBadge kind={v.change_kind} />
                  <span className="tabular-nums text-muted-foreground">
                    {formatDateTime(v.drive_modified_at ?? v.created_at)}
                  </span>
                  <span className="min-w-0 flex-1 truncate">
                    {t(actor.key, actor.params)}
                    {v.change_kind === 'renamed' || v.change_kind === 'moved' ? (
                      <span className="text-muted-foreground"> · {v.file_name}</span>
                    ) : null}
                  </span>
                  {v.size != null && (
                    <span className="tabular-nums text-xs text-muted-foreground">{formatBytes(v.size)}</span>
                  )}
                  {i === 0 && (
                    <Badge variant="secondary" className="font-normal">
                      {t('projectDrive.versionCurrent')}
                    </Badge>
                  )}
                  <span className="flex items-center gap-0.5">
                    {v.has_snapshot && (
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        title={t('projectDrive.download')}
                        aria-label={t('projectDrive.download')}
                        onClick={() => void download(v)}
                      >
                        <Download className="h-4 w-4" />
                      </Button>
                    )}
                    {v.restorable && (
                      <Button
                        size="sm"
                        variant={i === 0 ? 'ghost' : 'outline'}
                        disabled={busy !== null}
                        onClick={() => void restore(v)}
                        title={t('projectDrive.restoreHint')}
                      >
                        {busy === v.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
                        {t('projectDrive.restore')}
                      </Button>
                    )}
                  </span>
                </li>
              );
            })}
          </ol>
        )}
        <p className="text-[11px] text-muted-foreground">{t('projectDrive.versionsNote')}</p>
      </DialogContent>
    </Dialog>
  );
}
