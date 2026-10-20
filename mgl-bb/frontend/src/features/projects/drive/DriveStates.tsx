import type { ReactNode } from 'react';
import { CloudOff, FolderOpen, Loader2, RefreshCw, ShieldAlert } from 'lucide-react';
import { Button } from '@/ui/button';
import { Skeleton } from '@/ui/skeleton';
import { useLanguage } from '@/shared/i18n';
import type { DriveErrorView } from './driveErrors';

/** Хүснэгтийн мөрүүд ачаалагдтал — хавтас солих бүрт ижил хэлбэр. */
export function DriveListSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="divide-y divide-border/50" aria-busy="true">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 px-4 py-3">
          <Skeleton className="h-8 w-8 rounded-lg" />
          <Skeleton className="h-4 flex-1" style={{ maxWidth: `${38 + ((i * 17) % 40)}%` }} />
          <Skeleton className="hidden h-3 w-28 md:block" />
          <Skeleton className="hidden h-3 w-16 sm:block" />
        </div>
      ))}
    </div>
  );
}

function Centered({ icon, title, body, action }: { icon: ReactNode; title: string; body?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-14 text-center">
      <span className="flex h-10 w-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
        {icon}
      </span>
      <p className="text-sm font-medium text-foreground">{title}</p>
      {body ? <p className="max-w-md text-xs text-muted-foreground">{body}</p> : null}
      {action ? <div className="pt-2">{action}</div> : null}
    </div>
  );
}

export function DriveEmptyFolder() {
  const { t } = useLanguage();
  return (
    <Centered
      icon={<FolderOpen className="h-5 w-5" />}
      title={t('projectDrive.emptyTitle')}
      body={t('projectDrive.emptyBody')}
    />
  );
}

/** Drive/сүлжээ/эрхийн алдаа — нэг хэлбэр, «Дахин оролдох» нь зөвхөн утгатай
 *  үед.  Тохиргооны алдаанд админд зориулсан нэмэлт мөр гарна. */
export function DriveErrorState({
  view,
  isAdmin,
  onRetry,
  retrying,
  extra,
}: {
  view: DriveErrorView;
  isAdmin: boolean;
  onRetry: () => void;
  retrying?: boolean;
  extra?: ReactNode;
}) {
  const { t } = useLanguage();
  const Icon = view.configuration ? ShieldAlert : CloudOff;
  return (
    <Centered
      icon={<Icon className="h-5 w-5" />}
      title={t(view.key)}
      body={view.configuration && isAdmin ? t('projectDrive.errAdminHint') : undefined}
      action={
        <div className="flex flex-col items-center gap-3">
          {view.retryable && (
            <Button size="sm" variant="outline" onClick={onRetry} disabled={retrying}>
              {retrying ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              {t('common.retry')}
            </Button>
          )}
          {extra}
        </div>
      }
    />
  );
}
