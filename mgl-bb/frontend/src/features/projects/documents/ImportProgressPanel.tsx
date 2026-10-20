import { CheckCircle2, Loader2, XCircle } from 'lucide-react';
import { Button } from '@/ui/button';
import { useLanguage } from '@/shared/i18n';
import type { ImportProgress } from './types';

const PHASE_KEY: Record<ImportProgress['phase'], string> = {
  scanning: 'documentsPage.importScanning',
  folders: 'documentsPage.importFolders',
  checking: 'documentsPage.importChecking',
  uploading: 'documentsPage.importUploading',
  done: 'documentsPage.importDone',
};

/** Импортын явц ба төгсгөлийн тайлан — нэг л хайрцаг. */
export function ImportProgressPanel({
  progress,
  onCancel,
  onClose,
}: {
  progress: ImportProgress;
  onCancel: () => void;
  onClose: () => void;
}) {
  const { t } = useLanguage();
  const running = progress.phase !== 'done';
  const pct = progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;

  return (
    <div className="rounded-2xl border border-border bg-card p-4 shadow-apple">
      <div className="flex items-center gap-3">
        {running ? (
          <Loader2 className="h-5 w-5 shrink-0 animate-spin text-primary" />
        ) : progress.failed.length > 0 ? (
          <XCircle className="h-5 w-5 shrink-0 text-amber-500" />
        ) : (
          <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-500" />
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-foreground">
            {t(PHASE_KEY[progress.phase])}
          </p>
          <p className="truncate text-xs text-muted-foreground">
            {running && progress.currentName
              ? progress.currentName
              : t('documentsPage.importSummary', {
                  created: progress.created,
                  replaced: progress.replaced,
                  skipped: progress.skipped,
                })}
          </p>
        </div>
        {running ? (
          <>
            <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
              {progress.done}/{progress.total}
            </span>
            <Button size="sm" variant="ghost" onClick={onCancel}>
              {t('common.cancel')}
            </Button>
          </>
        ) : (
          <Button size="sm" variant="ghost" onClick={onClose}>
            {t('documentsPage.importClose')}
          </Button>
        )}
      </div>

      {progress.total > 0 ? (
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-primary transition-[width] duration-300"
            style={{ width: `${running ? pct : 100}%` }}
          />
        </div>
      ) : null}

      {progress.failed.length > 0 ? (
        <ul className="mt-3 max-h-32 space-y-0.5 overflow-auto rounded-lg bg-muted/40 p-2 text-xs">
          {progress.failed.slice(0, 30).map((f, i) => (
            <li key={`${f.name}-${i}`} className="flex gap-2 truncate">
              <span className="min-w-0 flex-1 truncate font-mono">{f.name}</span>
              <span className="shrink-0 text-muted-foreground">
                {t(
                  f.reason === 'bad_file_type'
                    ? 'documentsPage.reasonBadType'
                    : f.reason === 'upload'
                      ? 'documentsPage.reasonUpload'
                      : 'documentsPage.reasonRegister',
                )}
              </span>
            </li>
          ))}
          {progress.failed.length > 30 ? (
            <li className="text-muted-foreground">
              {t('documentsPage.conflictMore', { count: progress.failed.length - 30 })}
            </li>
          ) : null}
        </ul>
      ) : null}
    </div>
  );
}
