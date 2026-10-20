/* Inline эхлэх/дуусах огноо editor surfaced under the task name in the
 * overview tables. Manager-tier users (canManageProjectWork → `canEdit`)
 * get a date popover that PUTs to /tasks/:id; the very same dates drive the
 * Хуваарь (Gantt) tab, so setting them here is how undated tasks first
 * appear on the timeline (a task only becomes a draggable bar once it has a
 * date). Non-managers see the dates read-only. Self-contained: it owns its
 * mutation + cache invalidation, so no handler has to be threaded through
 * the row components.
 *
 * Extracted verbatim from `ProjectDetailPage.tsx` when that file was split
 * into per-component modules — no behavioural change. */
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Calendar as CalendarIcon } from 'lucide-react';

import { apiFetch } from '@/shared/api/client';
import { toast } from '@/shared/components/Toast';
import { Button } from '@/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/ui/popover';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/i18n';

import type { FlatTask } from './types';

export function TaskDatesEditor({ task, canEdit }: { task: FlatTask; canEdit: boolean }) {
  const { t } = useLanguage();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [startDraft, setStartDraft] = useState('');
  const [dueDraft, setDueDraft] = useState('');

  const start = (task.start_date ?? '').slice(0, 10);
  const due = (task.due_date ?? '').slice(0, 10);
  const hasDates = Boolean(start || due);
  const overdue = Boolean(
    due && task.progress < 100 && new Date(due).getTime() < Date.now() - 86400000,
  );
  const summary = hasDates ? `${start || '…'} → ${due || '…'}` : t('projectDetailPage.assignDates');

  // Read-only for non-managers: show the dates if any, otherwise nothing.
  if (!canEdit) {
    if (!hasDates) return null;
    return (
      <div
        className={cn(
          'mt-0.5 inline-flex items-center gap-1 text-[11px] tabular-nums',
          overdue ? 'text-amber-500' : 'text-muted-foreground',
        )}
      >
        <CalendarIcon className="h-3 w-3" />
        {summary}
      </div>
    );
  }

  const save = async () => {
    setSaving(true);
    try {
      await apiFetch(`/tasks/${task.id}`, {
        method: 'PUT',
        data: { start_date: startDraft || null, due_date: dueDraft || null },
      });
      // Refresh both the overview tree and the Хуваарь (Gantt) timeline —
      // every project-scoped query starts with the '/projects' key.
      await queryClient.invalidateQueries({ queryKey: ['/projects'] });
      toast.success(t('projectDetailPage.datesSaved'));
      setOpen(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('common.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Popover
      open={open}
      onOpenChange={(v) => {
        if (v) {
          setStartDraft(start);
          setDueDraft(due);
        }
        setOpen(v);
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            'mt-0.5 inline-flex items-center gap-1 rounded px-1 -ml-1 text-[11px] tabular-nums transition-colors hover:bg-muted/60',
            hasDates ? (overdue ? 'text-amber-500' : 'text-muted-foreground') : 'text-primary/70',
          )}
          onClick={(e) => e.stopPropagation()}
        >
          <CalendarIcon className="h-3 w-3" />
          {summary}
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="w-60 p-3 space-y-2"
        align="start"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="text-xs font-medium">{t('projectDetailPage.scheduleDates')}</div>
        <label className="block text-[11px] text-muted-foreground">
          {t('projectDetailPage.startDate')}
          <input
            type="date"
            value={startDraft}
            max={dueDraft || undefined}
            onChange={(e) => setStartDraft(e.target.value)}
            className="mt-0.5 w-full rounded border border-border bg-background px-2 py-1 text-sm"
          />
        </label>
        <label className="block text-[11px] text-muted-foreground">
          {t('projectDetailPage.dueDate')}
          <input
            type="date"
            value={dueDraft}
            min={startDraft || undefined}
            onChange={(e) => setDueDraft(e.target.value)}
            className="mt-0.5 w-full rounded border border-border bg-background px-2 py-1 text-sm"
          />
        </label>
        <div className="flex items-center justify-between gap-2 pt-1">
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-xs"
            disabled={saving || (!startDraft && !dueDraft)}
            onClick={() => {
              setStartDraft('');
              setDueDraft('');
            }}
          >
            {t('projectDetailPage.clearDates')}
          </Button>
          <Button size="sm" className="h-7 px-3 text-xs" disabled={saving} onClick={save}>
            {saving ? '…' : t('common.save')}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

export default TaskDatesEditor;
