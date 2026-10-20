/**
 * Байршуулалтын явцын самбар — жагсаалтын дээр гарч, файл бүрийн төлөв
 * (хүлээж буй / явж буй / дууссан / алдаа / цуцлагдсан), нийт явц, цуцлах
 * товч.  Дууссаны дараа «Хаах» дартал үлдэнэ — алдаатай мөр харагдах ёстой.
 */
import { AlertCircle, CheckCircle2, Loader2, RefreshCw, X } from 'lucide-react';
import { Button } from '@/ui/button';
import { Progress } from '@/ui/progress';
import { useLanguage } from '@/shared/i18n';
import { cn } from '@/shared/lib/utils';
import { formatBytes } from '@/features/projects/documents/fileTypes';
import type { UploadItem } from './driveUpload';

export function DriveUploadPanel({
  items,
  running,
  onCancel,
  onClose,
}: {
  items: UploadItem[];
  running: boolean;
  onCancel: () => void;
  onClose: () => void;
}) {
  const { t } = useLanguage();
  const total = items.reduce((a, i) => a + i.size, 0);
  const loaded = items.reduce((a, i) => a + (i.status === 'done' ? i.size : i.loaded), 0);
  const pct = total > 0 ? Math.round((loaded / total) * 100) : 0;
  const done = items.filter((i) => i.status === 'done').length;
  const failed = items.filter((i) => i.status === 'error').length;

  return (
    <div className="rounded-xl border border-border bg-card" role="status" aria-live="polite">
      <div className="flex items-center gap-3 border-b border-border/60 px-4 py-2.5">
        {running ? (
          <Loader2 className="h-4 w-4 shrink-0 animate-spin text-primary" />
        ) : failed > 0 ? (
          <AlertCircle className="h-4 w-4 shrink-0 text-destructive" />
        ) : (
          <CheckCircle2 className="h-4 w-4 shrink-0 text-success" />
        )}
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-foreground">
            {running ? t('projectDrive.uploadingTitle') : t('projectDrive.uploadDoneTitle')}
          </p>
          <p className="text-xs text-muted-foreground">
            {t('projectDrive.uploadProgress', { done: String(done), total: String(items.length), pct: String(pct) })}
          </p>
        </div>
        {running ? (
          <Button size="sm" variant="outline" onClick={onCancel}>
            <X className="h-4 w-4" /> {t('projectDrive.uploadCancel')}
          </Button>
        ) : (
          <Button size="sm" variant="ghost" onClick={onClose}>
            {t('projectDrive.uploadClose')}
          </Button>
        )}
      </div>
      <Progress value={pct} className="h-1 rounded-none" />
      <ul className="max-h-56 divide-y divide-border/40 overflow-y-auto text-sm">
        {items.map((it) => (
          <li key={it.id} className="flex items-center gap-3 px-4 py-1.5">
            <StatusIcon status={it.status} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-foreground">
                {it.path ? <span className="text-muted-foreground">{it.path}/</span> : null}
                {it.name}
                {it.replaced && it.status === 'done' ? (
                  <span className="ml-2 text-[11px] text-muted-foreground">· {t('projectDrive.uploadReplaced')}</span>
                ) : null}
              </p>
              {it.status === 'error' && it.errorKey ? (
                <>
                  <p className="text-xs text-destructive">{t(it.errorKey)}</p>
                  {it.errorDetail ? (
                    <p className="break-words text-[11px] text-muted-foreground">{it.errorDetail}</p>
                  ) : null}
                </>
              ) : it.status === 'uploading' ? (
                <Progress value={it.size > 0 ? (it.loaded / it.size) * 100 : 0} className="mt-1 h-1" />
              ) : null}
            </div>
            <span
              className={cn(
                'shrink-0 text-xs tabular-nums',
                it.status === 'error' ? 'text-destructive' : 'text-muted-foreground',
              )}
            >
              {it.status === 'uploading' && it.size > 0
                ? `${formatBytes(it.loaded)} / ${formatBytes(it.size)}`
                : formatBytes(it.size)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function StatusIcon({ status }: { status: UploadItem['status'] }) {
  switch (status) {
    case 'uploading':
      return <Loader2 className="h-4 w-4 shrink-0 animate-spin text-primary" />;
    case 'done':
      return <CheckCircle2 className="h-4 w-4 shrink-0 text-success" />;
    case 'error':
      return <AlertCircle className="h-4 w-4 shrink-0 text-destructive" />;
    case 'cancelled':
      return <X className="h-4 w-4 shrink-0 text-muted-foreground" />;
    default:
      return <RefreshCw className="h-4 w-4 shrink-0 text-muted-foreground/60" />;
  }
}
