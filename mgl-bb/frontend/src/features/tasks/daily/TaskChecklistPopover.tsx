import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ListChecks, Loader2, Plus, Trash2, Percent } from 'lucide-react';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import { Checkbox } from '@/ui/checkbox';
import { Popover, PopoverContent, PopoverTrigger } from '@/ui/popover';
import { apiFetch } from '@/shared/api/client';
import { useApiQuery } from '@/shared/api/useApi';
import { toast } from '@/shared/components/Toast';
import { useLanguage } from '@/shared/i18n';
import { cn } from '@/shared/lib/utils';
import type { ChecklistItem } from './types';

/**
 * Ажилтны ХУВИЙН checklist — «би энэ ажлаа юу юу болгож задлав».
 *
 * ⚠️ Энэ нь subtask давхарга БИШ (migration 0177-ийн толгойг үз).
 * Ямар ч жин байхгүй, ямар ч rollup үүнийг уншихгүй.  Цорын ганц
 * холбоос нь доорх «{done}/{total} → N% болгох» товч: тэр нь зүгээр л
 * тухайн мөрийн ХУВИЙН талбарыг дүүргэнэ — ажилтан өөрөө Send дарж
 * байж л жинхэнэ `progress_entries` бичигдэнэ.
 *
 * Жагсаалтыг popover НЭЭГДСЭН үед л татна (`enabled: open`) — 15 мөр
 * бүрд урьдчилж query явуулбал хуудас нээгдэх бүрд 15 нэмэлт хүсэлт
 * болно; мөрийн тоолол `/progress/my-tasks`-аас нэг GROUP BY-аар ирдэг.
 */
export default function TaskChecklistPopover({
  taskId,
  done,
  total,
  onApplyPercent,
  onCountsChanged,
  disabled,
}: {
  taskId: number;
  done: number;
  total: number;
  onApplyPercent: (pct: number) => void;
  onCountsChanged: () => void;
  disabled?: boolean;
}) {
  const { t } = useLanguage();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);

  const queryKey = ['/tasks', taskId, 'checklist'];
  const listQuery = useApiQuery<{ items: ChecklistItem[] }>(
    queryKey,
    `/tasks/${taskId}/checklist`,
    { enabled: open },
  );
  const items = listQuery.data?.items ?? [];

  /** Popover хаагдахад л эцэг рүү мэдэгдэнэ.  Товчлол бүр дээр
   *  `/progress/my-tasks`-ыг дахин татвал (тэр нь таск бүрд 4 query
   *  явуулдаг N+1) 5 удаа дарахад бүх жагсаалт 5 удаа дахин ачаалагдана
   *  — badge-ийн тоо тэр болтол popover доторх амьд тооноос харагдана. */
  const dirtyRef = useRef(false);

  const runMutation = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
      dirtyRef.current = true;
      await qc.invalidateQueries({ queryKey });
    } catch (err) {
      console.error(err);
      toast.error(t('common.error'), t('common.saveFailed'));
    } finally {
      setBusy(false);
    }
  };

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (!next && dirtyRef.current) {
      dirtyRef.current = false;
      onCountsChanged();
    }
  };

  const addItem = async () => {
    const value = text.trim();
    if (!value) return;
    setText('');
    await runMutation(() =>
      apiFetch(`/tasks/${taskId}/checklist`, { method: 'POST', data: { text: value } }),
    );
  };

  const toggleItem = (item: ChecklistItem) =>
    runMutation(() =>
      apiFetch(`/tasks/checklist/${item.id}`, {
        method: 'PATCH',
        data: { is_done: item.is_done === 1 ? false : true },
      }),
    );

  const removeItem = (item: ChecklistItem) =>
    runMutation(() => apiFetch(`/tasks/checklist/${item.id}`, { method: 'DELETE' }));

  // Popover нээлттэй үед шинэ тоог жагсаалтаас, хаалттай үед
  // `/progress/my-tasks`-ийн тооллоос харуулна.
  const liveTotal = open && listQuery.data ? items.length : total;
  const liveDone = open && listQuery.data ? items.filter((i) => i.is_done === 1).length : done;
  const suggested = liveTotal > 0 ? Math.round((liveDone / liveTotal) * 100) : null;

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button
          size="sm"
          variant="outline"
          disabled={disabled}
          className={cn('h-8 w-8 p-0 relative', total > 0 && 'border-primary/40 text-primary')}
          title={t('dailyReport.checklistTitle')}
          aria-label={t('dailyReport.checklistTitle')}
        >
          <ListChecks className="h-3.5 w-3.5" />
          {total > 0 && (
            <span
              className="absolute -top-1.5 -right-1.5 h-4 min-w-4 px-1 rounded-full bg-primary
                         text-primary-foreground text-[9px] font-semibold leading-4 tabular-nums"
            >
              {done}/{total}
            </span>
          )}
        </Button>
      </PopoverTrigger>

      <PopoverContent className="w-80 p-3 space-y-2" align="end">
        <div className="flex items-center justify-between">
          <p className="text-xs font-medium text-foreground">{t('dailyReport.checklistTitle')}</p>
          {liveTotal > 0 && (
            <span className="text-[10px] text-muted-foreground tabular-nums">
              {liveDone}/{liveTotal}
            </span>
          )}
        </div>
        <p className="text-[10px] leading-snug text-muted-foreground">
          {t('dailyReport.checklistHint')}
        </p>

        {listQuery.isLoading ? (
          <div className="flex justify-center py-4">
            <Loader2 className="h-4 w-4 animate-spin text-primary" />
          </div>
        ) : items.length > 0 ? (
          <ul className="space-y-1 max-h-56 overflow-y-auto">
            {items.map((item) => (
              <li key={item.id} className="flex items-start gap-2 group/ci">
                <Checkbox
                  checked={item.is_done === 1}
                  onCheckedChange={() => toggleItem(item)}
                  disabled={busy}
                  className="mt-0.5"
                  aria-label={item.text}
                />
                <span
                  className={cn(
                    'flex-1 text-xs leading-snug break-words',
                    item.is_done === 1 ? 'text-muted-foreground line-through' : 'text-foreground',
                  )}
                >
                  {item.text}
                </span>
                <button
                  type="button"
                  onClick={() => removeItem(item)}
                  disabled={busy}
                  className="opacity-0 group-hover/ci:opacity-100 focus:opacity-100 transition-opacity
                             h-5 w-5 rounded flex items-center justify-center hover:bg-destructive/10"
                  aria-label={t('common.delete')}
                >
                  <Trash2 className="h-3 w-3 text-muted-foreground" />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-muted-foreground py-2">{t('dailyReport.checklistEmpty')}</p>
        )}

        <div className="flex items-center gap-1.5">
          <Input
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                addItem();
              }
            }}
            placeholder={t('dailyReport.checklistPlaceholder')}
            className="h-8 text-xs"
            disabled={busy}
          />
          <Button
            size="sm"
            variant="outline"
            className="h-8 w-8 p-0 shrink-0"
            onClick={addItem}
            disabled={busy || !text.trim()}
            aria-label={t('dailyReport.checklistAdd')}
          >
            <Plus className="h-3.5 w-3.5" />
          </Button>
        </div>

        {suggested !== null && (
          <Button
            size="sm"
            variant="secondary"
            className="w-full h-8 text-xs"
            onClick={() => {
              onApplyPercent(suggested);
              handleOpenChange(false);
            }}
          >
            <Percent className="h-3.5 w-3.5 mr-1.5" />
            {t('dailyReport.checklistApply', { done: liveDone, total: liveTotal, pct: suggested })}
          </Button>
        )}
      </PopoverContent>
    </Popover>
  );
}
