/* Хуваарилалтын мөрийн (28.1, 28.2 …) нэр.  Засах эрхтэй хүнд (admin/senior — хэнийг ч; бусад ажилтан —
 * ЗӨВХӨН ӨӨРИЙН мөрийг, 2026-10-08) бичвэрийн ард харандаа (pencil) дүрс гарна; дарахад утга засах болж,
 * «Хадгалах»/«Болих» товч гарна.  Хадгалахад `PUT /tasks/:id/allocation-label` (migration 0393) руу бичнэ.
 * Enter = Хадгалах, Esc = Болих.  Хоосон болгож хадгалвал үндсэн ажлын нэр рүү буцна.  ЗӨВХӨН харагдац:
 * явц, оноо, цаг хөндөгдөхгүй.  ⚠️ Үндсэн (root) таскийн нэрийг ЭНД засахгүй (эзний шийдвэр 2026-10-07). */
import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Check, Loader2, Pencil, X } from 'lucide-react';

import { apiFetch } from '@/shared/api/client';
import { toast } from '@/shared/components/Toast';
import { useLanguage } from '@/shared/i18n';
import { CONTRIBUTORS_PREFIX } from '@/features/task-allocation/api';
import { cn } from '@/shared/lib/utils';

const MAX_LABEL = 120;
const squash = (s: string) => s.trim().replace(/\s+/g, ' ');

export function AllocationLabelEditor({
  taskId,
  userId,
  label,
  fallback,
  canEdit,
  save: saveLabel,
}: {
  taskId: number;
  userId: number;
  /** Хадгалсан нэр (null бол `fallback` — үндсэн ажлын нэр). */
  label: string | null;
  fallback: string;
  canEdit: boolean;
  /** Өөр хадгалагч (хүнгүй хэсэг, 0394) — өгвөл хоосон нэр зөвшөөрөгдөхгүй, `allocation-label` дуудагдахгүй. */
  save?: (label: string) => Promise<void>;
}) {
  const { t } = useLanguage();
  const queryClient = useQueryClient();
  const shown = label?.trim() ? label : fallback;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(shown);
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Серверээс (өөр хүн, дахин ачаалал) ирсэн шинэ утгыг, би засварлаж байхгүй үед л тусгана.
  useEffect(() => {
    if (!editing) setDraft(shown);
  }, [shown, editing]);

  if (!canEdit) {
    return <div className="text-xs leading-tight text-muted-foreground [overflow-wrap:anywhere]">{shown}</div>;
  }

  const startEdit = () => {
    setDraft(shown);
    setEditing(true);
    requestAnimationFrame(() => inputRef.current?.select());
  };

  const cancelEdit = () => {
    setDraft(shown);
    setEditing(false);
  };

  const save = async () => {
    const next = squash(draft);
    // Хоосон эсвэл үндсэн нэртэй ижил → «өөрийн нэргүй» (null).  Хүнгүй хэсэгт нэр заавал — хоосныг болиулна.
    const wanted = saveLabel ? next : next === '' || next === fallback ? null : next;
    const current = saveLabel ? shown : label?.trim() ? label : null;
    if (wanted === current || (saveLabel && wanted === '')) {
      cancelEdit();
      return;
    }
    setSaving(true);
    try {
      if (saveLabel && wanted !== null) {
        await saveLabel(wanted);
      } else {
        await apiFetch(`/tasks/${taskId}/allocation-label`, {
          method: 'PUT',
          data: { user_id: userId, label: wanted },
        });
      }
      await queryClient.invalidateQueries({ queryKey: [...CONTRIBUTORS_PREFIX] });
      toast.success(saveLabel ? t('taskAlloc.parts.renamed') : t('projectDetailPage.taskRenamed'));
      setEditing(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('projectDetailPage.taskRenameFailed'));
    } finally {
      setSaving(false);
    }
  };

  if (!editing) {
    return (
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          startEdit();
        }}
        title={t('projectDetailPage.renameAllocation')}
        aria-label={t('projectDetailPage.renameAllocation')}
        data-testid="alloc-label-start-edit"
        className="group flex w-full min-w-0 items-center gap-1 rounded px-1 -ml-1 text-left hover:bg-muted/60"
      >
        <span className="min-w-0 flex-1 truncate text-xs leading-tight text-muted-foreground [overflow-wrap:anywhere]">
          {shown}
        </span>
        <Pencil
          className="h-3 w-3 shrink-0 text-muted-foreground/50 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
          aria-hidden
        />
      </button>
    );
  }

  return (
    <div className="flex min-w-0 items-center gap-1" onClick={(e) => e.stopPropagation()}>
      <input
        ref={inputRef}
        value={draft}
        maxLength={MAX_LABEL}
        disabled={saving}
        autoFocus
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') void save();
          else if (e.key === 'Escape') cancelEdit();
        }}
        aria-label={t('projectDetailPage.renameAllocation')}
        data-testid="alloc-label-input"
        className={cn(
          'h-6 min-w-0 flex-1 rounded border border-ring bg-background px-1 text-xs text-foreground',
          'focus:outline-none',
          saving && 'opacity-60',
        )}
      />
      <button
        type="button"
        onClick={() => void save()}
        disabled={saving}
        title={t('common.save')}
        aria-label={t('common.save')}
        data-testid="alloc-label-save"
        className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-emerald-600 hover:bg-emerald-500/10 disabled:opacity-50"
      >
        {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Check className="h-3.5 w-3.5" aria-hidden />}
      </button>
      <button
        type="button"
        onClick={cancelEdit}
        disabled={saving}
        title={t('common.cancel')}
        aria-label={t('common.cancel')}
        data-testid="alloc-label-cancel"
        className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted disabled:opacity-50"
      >
        <X className="h-3.5 w-3.5" aria-hidden />
      </button>
    </div>
  );
}

export default AllocationLabelEditor;
