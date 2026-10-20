import type { ReactNode } from 'react';
import { AlertTriangle, Lock, SearchX, WifiOff, type LucideIcon } from 'lucide-react';

import { ApiError } from '@/shared/api/client';
import { useLanguage } from '@/shared/i18n';
import { cn } from '@/shared/lib/utils';
import { Button } from '@/ui/button';

interface ErrorStateProps {
  /**
   * TanStack Query-гийн `error`. `useApiQuery` нь үүнийг `ApiError` гэж
   * төрөлжүүлдэг тул статус кодоор ялгаж мессеж сонгоно. Сүлжээний
   * доголдол нь `ApiError` БИШ түүхий `TypeError` байдаг (`apiFetch` нь
   * `fetch()`-ийн reject-ийг ороодоггүй) — тэрийг тусад нь таньдаг.
   */
  error?: unknown;
  /** Статусаас гарах анхдагч гарчгийг дарна. */
  title?: string;
  /** Анхдагч тайлбарыг дарна. */
  description?: string;
  /** Ихэвчлэн `refetch`. Өгвөл «Дахин оролдох» товч гарна. */
  onRetry?: () => void;
  icon?: LucideIcon;
  /** Нэмэлт үйлдэл (жишээ нь «Буцах» холбоос). */
  action?: ReactNode;
  /** Картын дотор багтаах бол — босоо зайг багасгана. */
  compact?: boolean;
  className?: string;
}

type Shape = { icon: LucideIcon; titleKey: string; bodyKey: string };

/**
 * `apiFetch` нь `fetch()`-ийн reject-ийг ороодоггүй тул сүлжээ тасрахад
 * `ApiError` биш түүхий `TypeError` («Failed to fetch» / «NetworkError…»)
 * ирнэ. Мессежийн текст browser бүрд өөр тул зөвхөн түүнд найдахгүй —
 * `navigator.onLine`-ыг нэгдүгээрт шалгана.
 */
function isNetworkError(error: unknown): boolean {
  if (error instanceof ApiError) return false;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return true;
  return error instanceof TypeError && /fetch|network|load failed/i.test(error.message);
}

/** Алдааны төрлөөс хамааруулж хүнд ойлгомжтой хэлбэр сонгоно. */
function shapeFor(error: unknown): Shape {
  if (isNetworkError(error)) {
    return { icon: WifiOff, titleKey: 'common.errorOffline', bodyKey: 'common.errorOfflineBody' };
  }
  if (error instanceof ApiError) {
    if (error.status === 401 || error.status === 403) {
      return {
        icon: Lock,
        titleKey: 'common.errorForbidden',
        bodyKey: 'common.errorForbiddenBody',
      };
    }
    if (error.status === 404) {
      return {
        icon: SearchX,
        titleKey: 'common.errorNotFound',
        bodyKey: 'common.errorNotFoundBody',
      };
    }
  }
  return { icon: AlertTriangle, titleKey: 'common.error', bodyKey: 'common.errorBody' };
}

/**
 * Өгөгдөл ачаалж чадаагүй үеийн нэгдсэн блок — `EmptyState`-ийн хос.
 * Байрлал / хэмжээ нь `EmptyState`-тэй адил тул нэг хуудсанд хоёулаа
 * гарахад үсрэлт үүсэхгүй.
 *
 * ХОЁРЫГ ЯЛГАХ ДҮРЭМ: `EmptyState` = хүсэлт АМЖИЛТТАЙ болсон ч үр дүн
 * хоосон. `ErrorState` = хүсэлт БҮТЭЭГҮЙ. Хоёрыг хольж хэрэглэвэл
 * хэрэглэгч сүлжээний асуудлыг «мэдээлэл алга» гэж ойлгоно.
 */
export function ErrorState({
  error,
  title,
  description,
  onRetry,
  icon,
  action,
  compact,
  className,
}: ErrorStateProps) {
  const { t } = useLanguage();
  const shape = shapeFor(error);
  const Icon = icon ?? shape.icon;

  // Дотоод хэрэглээний багаж тул серверийн жинхэнэ мессежийг нуухгүй —
  // «Алдаа гарлаа» гэдэг ганцаараа хэнд ч тус болохгүй.
  const detail =
    error instanceof Error && error.message && error.message !== t(shape.bodyKey)
      ? error.message
      : null;

  return (
    <div
      role="alert"
      className={cn(
        'flex flex-col items-center justify-center px-4 text-center',
        compact ? 'py-8' : 'py-16',
        className,
      )}
    >
      <Icon className="mb-4 h-10 w-10 text-muted-subtle" aria-hidden />
      <h3 className="text-section text-foreground">{title ?? t(shape.titleKey)}</h3>
      <p className="text-body mt-1.5 max-w-sm text-muted-foreground">
        {description ?? t(shape.bodyKey)}
      </p>
      {detail && <p className="text-micro mt-2 max-w-md break-words text-muted-subtle">{detail}</p>}
      {(onRetry || action) && (
        <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
          {onRetry && (
            <Button variant="outline" size="sm" onClick={onRetry}>
              {t('common.retry')}
            </Button>
          )}
          {action}
        </div>
      )}
    </div>
  );
}
