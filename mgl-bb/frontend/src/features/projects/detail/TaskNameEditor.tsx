/* ҮНДСЭН таскийн нэр + админы устгах товч — төслийн хуудасны мөр (Flat/Grouped) (эзэн 2026-10-12).
 *
 *   • Нэр: ✂-ээр хуваагдсан үндсэн таск зэргийг төслийн хуудаснаас шууд солино.  Засах эрх = ✂ хуваах эрхтэй ИЖИЛ
 *     (admin/senior/engineer/architect) → `PUT /tasks/:id/name` (зөвхөн нэр; жин, явц, оноо хөндөгдөхгүй).
 *     Харандаа дүрс hover-т гарна, Enter = Хадгалах, Esc = Болих (`AllocationLabelEditor`-ийн ихэр хэлбэр).
 *   • Устгах: ЗӨВХӨН админ → баталгаажуулалт → `DELETE /tasks/:id`.  Хуваарилагдсан, хийсэн ажилтай таскийг сервер
 *     хамгаална (409 ROOT_PROTECTED) — тэр мессеж шууд харагдана.  ✂-ээр хуваагдсан хэсэг бол жин нь хуваалтын үлдсэн
 *     хэсэг рүү БУЦНА (сервер, `findWeightHeir`) — цонх үүнийг `GET /tasks/:id/delete-preview`-ээр урьдчилж хэлнэ. */
import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Check, Loader2, Pencil, Trash2, X } from 'lucide-react';

import { ApiError, apiFetch } from '@/shared/api/client';
import { confirmDialog } from '@/shared/components/ConfirmDialog';
import { toast } from '@/shared/components/Toast';
import { useLanguage } from '@/shared/i18n';
import { cn } from '@/shared/lib/utils';

const MAX_NAME = 200;

interface DeletePreview {
  weight: number;
  weight_merged_into: { id: number; name: string } | null;
}
interface DeleteResult {
  weight_merged_into?: { id: number; name: string; weight: number } | null;
}
const squash = (s: string) => s.trim().replace(/\s+/g, ' ');

export function TaskNameEditor({
  task,
  canRename,
  canDelete,
}: {
  task: { id: number; name: string; leafWeight?: number };
  canRename: boolean;
  canDelete: boolean;
}) {
  const { t } = useLanguage();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(task.name);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!editing) setDraft(task.name);
  }, [task.name, editing]);

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['/projects'] });

  const save = async () => {
    const next = squash(draft);
    if (next === '' || next === task.name) {
      setEditing(false);
      setDraft(task.name);
      return;
    }
    setBusy(true);
    try {
      await apiFetch(`/tasks/${task.id}/name`, { method: 'PUT', data: { name: next } });
      await refresh();
      toast.success(t('projectDetailPage.taskRenamed'));
      setEditing(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('projectDetailPage.taskRenameFailed'));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    // Урьдчилан харах унавал ердийн бичвэр — устгалт өөрөө сервер дээр зөв шийдэгдэнэ.
    const preview = await apiFetch<DeletePreview>(`/tasks/${task.id}/delete-preview`).catch(() => null);
    const weight = (preview?.weight ?? task.leafWeight ?? 0).toFixed(2);
    const heir = preview?.weight_merged_into ?? null;
    const ok = await confirmDialog({
      title: t('projectDetailPage.deleteTask'),
      description: heir
        ? t('projectDetailPage.deleteTaskConfirmMerge', { name: task.name, weight, heir: heir.name })
        : t('projectDetailPage.deleteTaskConfirm', { name: task.name, weight }),
      confirmText: t('common.delete'),
      variant: 'destructive',
    });
    if (!ok) return;
    setBusy(true);
    try {
      const res = await apiFetch<DeleteResult>(`/tasks/${task.id}`, { method: 'DELETE' });
      await refresh();
      const merged = res?.weight_merged_into;
      toast.success(
        merged
          ? t('projectDetailPage.taskDeletedMerged', { heir: merged.name, weight: merged.weight.toFixed(2) })
          : t('projectDetailPage.taskDeleted'),
      );
    } catch (e) {
      // 409 ROOT_PROTECTED (хийсэн ажилтай хуваарилагдсан таск) — серверийн монгол тайлбарыг харуулна, кодыг биш.
      const serverMsg = e instanceof ApiError && typeof e.payload.message === 'string' ? e.payload.message : null;
      toast.error(t('common.deleteFailed'), serverMsg ?? (e instanceof Error ? e.message : undefined));
    } finally {
      setBusy(false);
    }
  };

  if (editing) {
    return (
      <div className="flex min-w-0 items-center gap-1" onClick={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          value={draft}
          maxLength={MAX_NAME}
          disabled={busy}
          autoFocus
          onFocus={(e) => e.currentTarget.select()}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void save();
            else if (e.key === 'Escape') {
              setDraft(task.name);
              setEditing(false);
            }
          }}
          aria-label={t('projectDetailPage.renameTask')}
          data-testid="task-name-input"
          className={cn(
            'h-7 min-w-0 flex-1 rounded border border-ring bg-background px-1.5 text-sm font-medium text-foreground',
            'focus:outline-none',
            busy && 'opacity-60',
          )}
        />
        <button
          type="button"
          onClick={() => void save()}
          disabled={busy}
          title={t('common.save')}
          aria-label={t('common.save')}
          data-testid="task-name-save"
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-emerald-600 hover:bg-emerald-500/10 disabled:opacity-50"
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Check className="h-3.5 w-3.5" aria-hidden />}
        </button>
        <button
          type="button"
          onClick={() => {
            setDraft(task.name);
            setEditing(false);
          }}
          disabled={busy}
          title={t('common.cancel')}
          aria-label={t('common.cancel')}
          data-testid="task-name-cancel"
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted disabled:opacity-50"
        >
          <X className="h-3.5 w-3.5" aria-hidden />
        </button>
      </div>
    );
  }

  return (
    <div className="flex min-w-0 items-start gap-1">
      <div className="min-w-0 font-medium text-sm leading-tight [overflow-wrap:anywhere]">{task.name}</div>
      {canRename && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setDraft(task.name);
            setEditing(true);
          }}
          title={t('projectDetailPage.renameTask')}
          aria-label={t('projectDetailPage.renameTask')}
          data-testid="task-name-edit"
          className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground/60 opacity-0 transition-opacity hover:bg-muted hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100 pointer-coarse:opacity-100"
        >
          <Pencil className="h-3 w-3" aria-hidden />
        </button>
      )}
      {canDelete && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            void remove();
          }}
          disabled={busy}
          title={t('projectDetailPage.deleteTask')}
          aria-label={t('projectDetailPage.deleteTask')}
          data-testid="task-delete"
          className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground/60 opacity-0 transition-opacity hover:bg-destructive/10 hover:text-destructive focus-visible:opacity-100 group-hover:opacity-100 pointer-coarse:opacity-100 disabled:opacity-50"
        >
          {busy ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> : <Trash2 className="h-3 w-3" aria-hidden />}
        </button>
      )}
    </div>
  );
}

export default TaskNameEditor;
