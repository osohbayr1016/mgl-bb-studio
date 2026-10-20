/* ---------- AI completion summary popover ----------
 * Shows the cached AI-generated review of a finished task. The popover is
 * only mounted when the task is at 100% and the summary column is non-null,
 * so we never show an empty shell while the worker is still pending.
 *
 * Extracted verbatim from `ProjectDetailPage.tsx` when that file was split
 * into per-component modules — no behavioural change. */
import { Sparkles } from 'lucide-react';

import { Button } from '@/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/ui/popover';
import { useLanguage } from '@/shared/i18n';

export function AiSummaryPopover({
  summary,
  at,
  taskName,
}: {
  summary: string;
  at: string | null;
  taskName: string;
}) {
  const { t } = useLanguage();
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          size="sm"
          variant="ghost"
          className="h-6 w-6 p-0 text-primary hover:text-primary"
          title={t('projectDetailPage.aiSummary')}
          onClick={(e) => e.stopPropagation()}
        >
          <Sparkles className="h-3.5 w-3.5" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-80 p-3 space-y-2"
        align="end"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-1.5 text-[11px] font-medium text-primary uppercase tracking-wide">
          <Sparkles className="h-3 w-3" />
          {t('projectDetailPage.aiSummary')}
        </div>
        <p className="text-xs text-muted-foreground truncate" title={taskName}>
          {taskName}
        </p>
        <p className="text-sm leading-relaxed whitespace-pre-wrap text-foreground/90">{summary}</p>
        {at && (
          <p className="text-[10px] text-muted-foreground/70">{new Date(at).toLocaleString()}</p>
        )}
      </PopoverContent>
    </Popover>
  );
}

export default AiSummaryPopover;
