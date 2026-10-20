import { AlertTriangle, Lock, RefreshCw, X } from 'lucide-react';

import { Button } from '@/ui/button';
import { dismissGateBlock, type GateBlockKind } from '@/shared/api/taskAllocContract';
import { useLanguage } from '@/shared/i18n';
import { applyUpdate, checkForAppUpdate, updateStore } from '@/shared/lib/serviceWorker';
import { cn } from '@/shared/lib/utils';

import { useTaskAllocGate } from './useTaskAllocGate';

const TEXT_KEY: Record<GateBlockKind, string> = {
  client_older: 'taskAlloc.gate.clientOlder',
  server_older: 'taskAlloc.gate.serverOlder',
  paused: 'taskAlloc.gate.paused',
  disabled: 'taskAlloc.gate.disabled',
  unconfigured: 'taskAlloc.gate.paused',
};

/**
 * Хуваарилалтын 426/423 хариуны ТОДОРХОЙ мэдэгдэл.  Өмнө нь «Алдаа гарлаа» гэсэн ерөнхий мөр гардаг, хуучин PWA-тай хүн
 * юу хийхээ мэдэхгүй байв.  Хуучирсан хуудас (426) → «Шинэчлэх» (SW шинэчлэл + дахин ачаалал); түр түгжээ (423) → зөвхөн
 * мэдээлэл (унших хэвээр).  Layout-д НЭГ удаа mount хийнэ; блок байхгүй үед null.
 */
export function TaskAllocGateBanner({ className }: { className?: string }) {
  const { t } = useLanguage();
  const { block } = useTaskAllocGate();
  if (!block) return null;
  const needsRefresh = block.kind === 'client_older';
  const Icon = needsRefresh ? AlertTriangle : Lock;

  const refresh = async () => {
    await checkForAppUpdate();
    if (updateStore.getSnapshot()) applyUpdate();
    // Шинэ worker суухгүй бол (кэшгүй/бүртгэлгүй) шууд дахин ачаална.
    window.setTimeout(() => window.location.reload(), 1500);
  };

  return (
    <div
      role="alert"
      data-testid="task-alloc-gate-banner"
      data-kind={block.kind}
      className={cn(
        'fixed inset-x-3 z-50 sm:inset-x-auto sm:left-4 sm:max-w-md',
        // <sm: «Шинэчлэх» pill (UpdatePrompt, ижил байрлал)-ыг далдлахгүйн тулд нэг pill-ийн өндрөөр дээш.
        'bottom-[calc(var(--app-bottom-nav-h,3.5rem)+env(safe-area-inset-bottom)+4rem)] sm:bottom-[calc(var(--app-bottom-nav-h,3.5rem)+env(safe-area-inset-bottom)+0.75rem)] lg:bottom-4',
        className,
      )}
    >
      <div
        className={cn(
          'flex items-start gap-3 rounded-xl border bg-card/95 p-3 shadow-2xl shadow-black/40 backdrop-blur-md',
          needsRefresh ? 'border-warning/50' : 'border-border/60',
        )}
      >
        <Icon className={cn('mt-0.5 h-4 w-4 shrink-0', needsRefresh ? 'text-warning' : 'text-muted-foreground')} aria-hidden />
        <div className="min-w-0 flex-1 text-sm">
          <p className="font-medium text-foreground">{t(TEXT_KEY[block.kind])}</p>
          {needsRefresh && (
            <Button type="button" size="sm" className="mt-2" onClick={() => void refresh()} data-testid="task-alloc-gate-refresh">
              <RefreshCw aria-hidden />
              {t('taskAlloc.gate.refresh')}
            </Button>
          )}
        </div>
        <Button type="button" variant="ghost" size="icon" className="shrink-0" onClick={dismissGateBlock} aria-label={t('taskAlloc.gate.dismiss')}>
          <X aria-hidden />
        </Button>
      </div>
    </div>
  );
}

export default TaskAllocGateBanner;
