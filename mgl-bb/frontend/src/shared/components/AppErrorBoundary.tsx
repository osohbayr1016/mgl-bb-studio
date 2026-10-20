import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, RotateCw } from 'lucide-react';
import { useLanguage } from '@/shared/i18n';
import { cn } from '@/shared/lib/utils';
import { isChunkLoadError } from '@/shared/lib/chunkLoadError';
import { Button } from '@/ui/button';

/**
 * App-wide error boundary. Without it, any render error — or a stale lazy
 * chunk 404 after a fresh deploy (the SPA still references the previous
 * build's hashed chunk URLs) — white-screens the entire app with a blank
 * page and no way out.
 *
 * Two behaviours:
 *  - Dynamic-import / chunk-load failures (the deploy-skew case) trigger a
 *    one-time hard reload so the browser fetches the new index.html + chunk
 *    map. A sessionStorage guard prevents a reload loop if it's a genuine
 *    persistent failure.
 *  - Any other error renders a localized fallback with a reload button.
 */
const RELOAD_GUARD_KEY = 'app_chunk_reloaded_at';

interface Props {
  children: ReactNode;
  /**
   * `app` (анхдагч) — бүтэн дэлгэцийн fallback, аппын язгуурт.
   * `route` — зөвхөн агуулгын хэсэгт багтах fallback. Layout-ийн sidebar,
   * header, доод navbar амьд үлдэнэ; хэрэглэгч өөр хуудас руу шилжиж
   * гарах боломжтой. Энэ boundary нь `PageTransition`-ий ДОТОР байрлах
   * ёстой — тэр нь pathname-ээр key авдаг тул шилжихэд remount болж
   * төлөв нь өөрөө цэвэрлэгдэнэ.
   */
  scope?: 'app' | 'route';
}
interface State {
  hasError: boolean;
}

export class AppErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    if (isChunkLoadError(error)) {
      // Reload once to pick up the new build; don't loop if it keeps failing.
      const last = Number(sessionStorage.getItem(RELOAD_GUARD_KEY) ?? '0');
      const now = Date.now();
      if (now - last > 10_000) {
        sessionStorage.setItem(RELOAD_GUARD_KEY, String(now));
        window.location.reload();
        return;
      }
    }
    console.error('[app-error-boundary]', error, info.componentStack);
  }

  handleReset = () => {
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      return <ErrorFallback onReset={this.handleReset} scope={this.props.scope ?? 'app'} />;
    }
    return this.props.children;
  }
}

function ErrorFallback({ onReset, scope }: { onReset: () => void; scope: 'app' | 'route' }) {
  const { t } = useLanguage();
  return (
    <div
      role="alert"
      className={cn(
        'flex flex-col items-center justify-center gap-4 px-6 text-center',
        scope === 'app' ? 'min-h-screen' : 'py-16',
      )}
    >
      <AlertTriangle className="h-10 w-10 text-warning" aria-hidden="true" />
      <div className="space-y-1">
        <p className="text-section text-foreground">{t('errorBoundary.title')}</p>
        <p className="text-body max-w-sm text-muted-foreground">{t('errorBoundary.body')}</p>
      </div>
      <Button onClick={onReset} size="sm">
        <RotateCw className="h-4 w-4" aria-hidden="true" />
        {t('errorBoundary.reload')}
      </Button>
    </div>
  );
}
