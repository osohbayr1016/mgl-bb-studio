/* ТАСК ХУВААРИЛАХ / ЗАСАХ — хуучин «Таск хуваах» (`TaskSplitDialog`)-ийг СОЛЬСОН (2026-10-02).
 *
 * Шинэ таск ҮҮСЭХГҮЙ, дотоод жин `W` багасахгүй — НЭГ үндсэн ажил (100%) дотор хүн бүрт хуваарилалт (T) үүснэ.
 *   • 2026-10-09 (эзэн): мөр бүр = ДЭД ТАСК — нэрээ шууд бичиж (0393 `label`), хүнд оноож, ⧉-ээр хуулна (хуулсан мөрөнд өөр
 *     хүн сонгомогц ирээдүйн ажил хоёр хуваагдана).  Нэг үндсэн таскт нэг хүн НЭГ дэд таск — хоёр хэрэгтэй бол ✂-ээр
 *     үндсэн таскууд болгон хуваана.  Ctrl+Z / Ctrl+Y цонх доторх алхмыг буцаана, хадгалсны дараа toast-ын «Буцаах».
 *   • Хийсэн хэсэг түгжигдэнэ: «80% хийсэн» хүн үргэлжлүүлбэл 80 / 90 болно, хийсэн нь бусдад шилжихгүй.
 *   • Нэг мөрийг засахад гараар засаагүй мөрүүд үлдэгдлийг ТЭНЦҮҮ хуваана (50/50 → 40 бол 60; гурван хүнд 60 бол 20/20).
 *   • Хоёр ӨӨР горим: «Нийт зорилт» (хүн бүрийн T) ба «Үлдсэн ажлын хувь» (A=50%, B=25%, C=25% → үлдсэн 20-ын 10/5/5).
 *   • «Авч эхлэх» урсгал: өөр хүн ажиллаж буй таск дээр ▶ дарахад нээгдэнэ; хадгалсны дараа таны цаг эхэлнэ.
 * Дүрэм `allocationEditor.ts` (цэвэр), эцсийн шийдвэр СЕРВЕР (`POST /tasks/:id/allocation/split`). */
import { useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Copy, Loader2, Lock, Redo2, RotateCcw, Undo2, UserPlus, X } from 'lucide-react';

import { Avatar, AvatarFallback } from '@/ui/avatar';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/ui/dialog';
import { toast } from '@/shared/components/Toast';
import { useAuth } from '@/shared/context/AuthContext';
import { useUndoHistory, useUndoHotkeys } from '@/shared/hooks/useUndoHistory';
import { cn } from '@/shared/lib/utils';
import { formatDisplayName } from '@/shared/lib/formatting';
import { useLanguage, type TranslationKey } from '@/shared/i18n';

import {
  ALLOCATION_PREFIX,
  CONTRIBUTORS_PREFIX,
  newRequestId,
  postSplit,
  postUnsplit,
  putAllocationLabel,
  toFailure,
} from './api';
import {
  addWorker,
  initEditor,
  isChanged,
  planOf,
  remainingOf,
  removeWorker,
  resetEqual,
  setRowValue,
  sumLine,
  toTargets,
  type EditorModel,
} from './allocationEditor';
import { MAX_ACTIVE_ALLOCATIONS, SHARE_TOTAL_UNITS, type RootAllocState } from './allocation';
import { useAllocationOverview, useCandidates, useProjectContributors } from './hooks';
import { invalidateAfterProgress } from './ownProgressStore';
import type { AllocationOverview, CandidateUser, SplitResult } from './types';
import { ROOT_TOTAL_UNITS, formatUnits, parseUnits } from './units';

export interface AllocationTarget {
  id: number;
  name: string;
}

/** Серверийн төлөв (managed) эсвэл seed-ийн урьдчилсан төлөвөөс засварлагчийн суурь.  Хүнгүй хэсгүүд (0394) нь U-ийн доторх
 *  НӨӨЦ — хүмүүст хуваарилагдахгүй тул сервертэй ИЖИЛ аргаар «түгжигдсэн» (B) гэж тооцно (`applyAllocation`). */
function reservedOf(o: AllocationOverview): number {
  return (o.root?.parts ?? []).reduce((s, p) => s + p.units, 0);
}

function baseOf(o: AllocationOverview): RootAllocState {
  if (o.root) {
    const reserved = reservedOf(o);
    return {
      unattributedUnits: o.root.unattributed_units + reserved,
      unallocatedUnits: Math.max(0, o.root.unallocated_units - reserved),
      rows: o.root.participants.map((p) => ({
        userId: p.user_id,
        doneUnits: p.done_units,
        floorUnits: p.floor_units,
        targetUnits: p.target_units,
      })),
    };
  }
  const prev = o.preview;
  const rows = (prev?.participants ?? []).map((p) => ({
    userId: p.user_id,
    doneUnits: p.done_units,
    floorUnits: p.done_units,
    targetUnits: p.done_units,
  }));
  const done = rows.reduce((s, r) => s + r.doneUnits, 0);
  const unattributed = prev?.unattributed_units ?? 0;
  return {
    unattributedUnits: unattributed,
    unallocatedUnits: Math.max(0, ROOT_TOTAL_UNITS - unattributed - done),
    rows,
  };
}

function initials(name: string): string {
  return name
    .split(' ')
    .map((p) => p[0] ?? '')
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

const PLAN_ERR: Record<string, string> = {
  NO_WORKERS: 'taskAlloc.editor.err.noWorkers',
  DUPLICATE_USER: 'taskAlloc.editor.err.duplicate',
  TOO_MANY: 'taskAlloc.editor.err.tooMany',
  BAD_VALUE: 'taskAlloc.editor.err.badValue',
  BELOW_DONE: 'taskAlloc.editor.err.belowDone',
  SUM_MISMATCH: 'taskAlloc.editor.err.sum',
  OVER_REMAINDER: 'taskAlloc.editor.err.overRemainder',
  NO_FREE_WORK: 'taskAlloc.editor.err.noFreeWork',
  PRECISION: 'taskAlloc.editor.err.precision',
};

const SERVER_ERR: Record<string, string> = {
  STALE_REVISION: 'taskAlloc.editor.srv.stale',
  NETWORK: 'taskAlloc.err.network',
  PROJECT_INACTIVE: 'taskAlloc.err.projectInactive',
  TASK_COMPLETED: 'taskAlloc.err.taskCompleted',
  NOT_SPLITTABLE: 'taskAlloc.editor.srv.notSplittable',
  HOURS_MODE: 'taskAlloc.editor.srv.hoursMode',
  USER_NOT_ELIGIBLE: 'taskAlloc.editor.srv.notEligible',
};

export function AllocationEditorDialog({
  task,
  take = false,
  takeReason = 'working',
  initialWorkerIds = [],
  onSaved,
  onClose,
}: {
  task: AllocationTarget;
  /** «Авч эхлэх» урсгал — өөр хүн ажиллаж буй (эсвэл аль хэдийн хувь оруулсан) таск дээр ▶ дарсан. */
  take?: boolean;
  /** Цонх яагаад гарсан: `working` = өөр хүн одоо ажиллаж байна; `progress` = өөр хүн аль хэдийн хувь оруулсан. */
  takeReason?: 'working' | 'progress';
  /** Өөр хүн одоо ажиллаж байгаа (үргэлжлүүлэх нь өгөгдмөл). */
  initialWorkerIds?: number[];
  /** Амжилттай хадгалсны дараа (жишээ нь «авах» → цаг эхлүүлэх). */
  onSaved?: (res: SplitResult) => void | Promise<void>;
  onClose: () => void;
}) {
  const { t } = useLanguage();
  const overview = useAllocationOverview(task.id);
  const candidates = useCandidates();
  const data = overview.data;
  const people = candidates.data;
  const failed = overview.isError || candidates.isError;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-2xl" onClick={(e) => e.stopPropagation()}>
        <DialogHeader>
          <DialogTitle>{take ? t('taskAlloc.editor.takeTitle') : t('taskAlloc.editor.title')}</DialogTitle>
          <DialogDescription>{task.name}</DialogDescription>
        </DialogHeader>
        {!failed && (!data || !people) ? (
          <div className="flex items-center justify-center py-10">
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
          </div>
        ) : failed || !data || !people ? (
          <div className="space-y-3 py-4 text-sm">
            <p className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="h-4 w-4" />
              {t('common.loadFailed')}
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                void overview.refetch();
                void candidates.refetch();
              }}
            >
              {t('common.retry')}
            </Button>
          </div>
        ) : (
          <EditorBody
            // Серверийн төлөв шинэчлэгдвэл (409-ийн дараа) засварлагч шинээр эхэлнэ.
            key={overview.dataUpdatedAt}
            task={task}
            overview={data}
            candidates={people}
            take={take}
            takeReason={takeReason}
            initialWorkerIds={initialWorkerIds}
            onSaved={onSaved}
            onClose={onClose}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

/** Хуулсан дэд таскийн хүлээгдэж буй мөр — хүн сонгомогц жинхэнэ мөр болно. */
interface PendingRow {
  key: string;
  label: string;
  /** Хуулсан мөрийн хүн — түүний ирээдүйн ажил хоёр хуваагдана. */
  fromUserId: number;
}

/** Цонхны бүх засварлах төлөв (Ctrl+Z түүхэнд НЭГ объект). */
interface EditorState {
  model: EditorModel;
  /** Хэрэглэгчийн өөрчилсөн дэд таскийн нэрс (хүн → нэр); байхгүй бол хадгалсан нэр. */
  labels: Record<number, string>;
  pending: PendingRow[];
  seq: number;
}

const squashLabel = (s: string) => s.trim().replace(/\s+/g, ' ');

function EditorBody({
  task,
  overview,
  candidates,
  take,
  takeReason,
  initialWorkerIds,
  onSaved,
  onClose,
}: {
  task: AllocationTarget;
  overview: AllocationOverview;
  candidates: CandidateUser[];
  take: boolean;
  takeReason: 'working' | 'progress';
  initialWorkerIds: number[];
  onSaved?: (res: SplitResult) => void | Promise<void>;
  onClose: () => void;
}) {
  const { t } = useLanguage();
  const { user } = useAuth();
  const qc = useQueryClient();
  const contributors = useProjectContributors(overview.task.project_id);

  const base = useMemo(() => baseOf(overview), [overview]);
  const R = remainingOf(base);
  const myId = user?.id ?? 0;

  // Ирээдүйн ажил эзлэх эрхтэй хүмүүс (админ/захиалагч биш) — би ЗӨВХӨН эрхтэй бол анхны жагсаалтад орно.
  const eligibleIds = useMemo(() => new Set(candidates.map((u) => u.id)), [candidates]);
  const iAmEligible = eligibleIds.has(myId);

  const history = useUndoHistory<EditorState>(() => {
    const current = base.rows.filter((r) => r.targetUnits > r.doneUnits).map((r) => r.userId);
    let workers: number[];
    if (overview.managed) {
      // Одоогийн идэвхтэй оролцогчид (+ «авч эхлэх» бол би).
      workers = take && iAmEligible && !current.includes(myId) ? [...current, myId] : current;
    } else {
      // Хуваарилагдаагүй таск: ажиллаж буй хүмүүс + би.
      const ids = [...initialWorkerIds];
      if (iAmEligible && !ids.includes(myId)) ids.push(myId);
      workers = ids;
    }
    // Үргэлж «Нийт зорилт» — үндсэн ажлын 100%-ийг хүн бүрт (хийсэн хэсэг нь доод хязгаар).
    return { model: initEditor({ base, mode: 'total', workers }), labels: {}, pending: [], seq: 0 };
  });
  const { model, labels, pending } = history.state;
  const setModel = (f: (m: EditorModel) => EditorModel, coalesce?: string) =>
    history.set((s) => ({ ...s, model: f(s.model) }), coalesce ? { coalesce } : undefined);
  const [editing, setEditing] = useState<{ userId: number; text: string } | null>(null);
  const [invalid, setInvalid] = useState<Set<number>>(() => new Set());
  const [saving, setSaving] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const attempt = useRef<{ id: string; key: string } | null>(null);
  // Ctrl+Z / Ctrl+Y — бичиж буй % талбарын түр бичвэр буцаасан загварыг дарахгүй.
  useUndoHotkeys(
    history.undo,
    history.redo,
    () => {
      setEditing(null);
      setInvalid(new Set());
    },
    !saving,
  );

  // Нэр: нэр дэвшигчид ∪ төслийн хувь нэмэрчид (идэвхгүй болсон хүмүүсийн түүх ч нэртэй).
  const names = useMemo(() => {
    const m = new Map<number, string>();
    for (const rows of contributors.byTask.values()) {
      for (const r of rows) if (r.full_name) m.set(r.user_id, formatDisplayName(r.full_name));
    }
    for (const u of candidates) if (u.full_name) m.set(u.id, formatDisplayName(u.full_name));
    return m;
  }, [contributors.byTask, candidates]);
  const nameOf = (id: number) => names.get(id) ?? `#${id}`;
  // Одоо хадгалагдсан дэд таскийн нэр (0393, хуваарилалтын мөрийн `label`).
  const savedLabels = useMemo(() => {
    const m = new Map<number, string>();
    for (const r of contributors.byTask.get(task.id) ?? []) if (r.ordinal !== null && r.label) m.set(r.user_id, r.label);
    return m;
  }, [contributors.byTask, task.id]);
  const labelOf = (id: number) => labels[id] ?? savedLabels.get(id) ?? '';
  const changedLabels = model.workers.filter(
    (id) => labels[id] !== undefined && squashLabel(labels[id] ?? '') !== (savedLabels.get(id) ?? ''),
  );

  const plan = planOf(model);
  const allocChanged = isChanged(model);
  const changed = allocChanged || changedLabels.length > 0 || pending.length > 0;
  const sums = plan.ok ? sumLine(plan, base, model.mode) : null;
  const max = model.mode === 'total' ? ROOT_TOTAL_UNITS : SHARE_TOTAL_UNITS;

  // Түүхтэй (хийсэн нь > 0) боловч ирээдүйн ажил эзлээгүй хүмүүс.
  const historyRows = base.rows.filter((r) => r.doneUnits > 0 && !model.workers.includes(r.userId));
  const addable = candidates.filter(
    (u) => !model.workers.includes(u.id) && !historyRows.some((h) => h.userId === u.id),
  );

  const blocked = (() => {
    if (!overview.task.splittable) return 'taskAlloc.editor.srv.notSplittable';
    if (overview.task.project_status !== 'active') return 'taskAlloc.err.projectInactive';
    if (overview.root?.complete || (!overview.root && overview.task.latest_pct >= 100)) return 'taskAlloc.err.taskCompleted';
    if (!overview.allowed.edit) return 'taskAlloc.editor.srv.noPermission';
    return null;
  })();
  const locked = saving || blocked !== null;

  const rowValue = (userId: number): { text: string; hard: boolean } => {
    if (editing?.userId === userId) return { text: editing.text, hard: true };
    const hard = model.fixed[userId];
    if (hard !== undefined) return { text: formatUnits(hard), hard: true };
    if (!plan.ok) return { text: '', hard: false };
    const row = plan.rows.find((r) => r.userId === userId);
    if (!row) return { text: '', hard: false };
    return { text: formatUnits(model.mode === 'total' ? row.targetUnits : row.remainderShareUnits), hard: false };
  };

  const onType = (userId: number, text: string) => {
    setEditing({ userId, text });
    const parsed = parseUnits(text, max);
    setInvalid((prev) => {
      const next = new Set(prev);
      if (parsed.ok) next.delete(userId);
      else next.add(userId);
      return next;
    });
    if (parsed.ok) setModel((m) => setRowValue(m, userId, parsed.units), `units:${userId}`);
  };

  /** Дэд таскийг хуулах: ижил нэртэй шинэ мөр — хүнээ сонгомогц ирээдүйн ажил хоёр хуваагдана. */
  const duplicate = (fromUserId: number) => {
    setEditing(null);
    const label = labelOf(fromUserId) || task.name;
    history.set((s) => ({
      ...s,
      pending: [...s.pending, { key: `p${s.seq}`, label, fromUserId }],
      seq: s.seq + 1,
    }));
  };
  const pickPending = (key: string, personId: number) => {
    setEditing(null);
    history.set((s) => {
      const p = s.pending.find((x) => x.key === key);
      if (!p || s.model.workers.includes(personId)) return s;
      const before = planOf(s.model);
      const src = before.ok ? before.rows.find((r) => r.userId === p.fromUserId) : undefined;
      let m = addWorker(s.model, personId);
      if (src && m.mode === 'total') {
        const half = Math.floor((src.targetUnits - src.doneUnits) / 2);
        m = setRowValue(m, p.fromUserId, src.targetUnits - half);
        m = setRowValue(m, personId, half);
      }
      return { ...s, model: m, labels: { ...s.labels, [personId]: p.label }, pending: s.pending.filter((x) => x.key !== key) };
    });
  };

  /** Хадгалсны дараах «Буцаах»: өмнөх хуваарилалт ба нэрс рүү (шинээр хуваагдсан таск бол «огт хуваагаагүй»). */
  const undoSave = (res: SplitResult | null, prevLabels: Array<[number, string | null]>) => {
    const prevTargets = base.rows
      .filter((r) => r.targetUnits > r.doneUnits)
      .map((r) => ({ user_id: r.userId, target_units: r.targetUnits }));
    void (async () => {
      try {
        if (res && !overview.managed) {
          await postUnsplit(task.id, newRequestId());
        } else {
          if (res) {
            await postSplit(
              task.id,
              { requestId: newRequestId(), expectedRevision: res.root.revision },
              { mode: 'total', targets: prevTargets },
            );
          }
          for (const [uid, label] of prevLabels) await putAllocationLabel(task.id, uid, label);
        }
        toast.success(t('taskAlloc.history.undone', { name: task.name }));
      } catch (err) {
        toast.error(t('taskAlloc.history.undoFailed'), toFailure(err).message || undefined);
      } finally {
        void qc.invalidateQueries({ queryKey: ALLOCATION_PREFIX });
        void qc.invalidateQueries({ queryKey: CONTRIBUTORS_PREFIX });
        invalidateAfterProgress();
      }
    })();
  };

  const submit = async () => {
    if (!plan.ok || !changed || blocked || pending.length > 0) return;
    const targets = toTargets(plan);
    const key = JSON.stringify([model.mode, targets, overview.root?.revision ?? null]);
    // Ижил ачааллын сүлжээний давталт ижил `request_id` — өөр ачаалал шинэ id.
    if (!attempt.current || attempt.current.key !== key) attempt.current = { id: newRequestId(), key };
    setSaving(true);
    setServerError(null);
    try {
      let res: SplitResult | null = null;
      if (allocChanged) {
        res = await postSplit(
          task.id,
          { requestId: attempt.current.id, expectedRevision: overview.root?.revision ?? null },
          { mode: model.mode, targets },
        );
      }
      // Дэд таскийн нэрс (зөвхөн харагдац, revision хөдлөхгүй) — хуваарилалт хадгалагдсаны ДАРАА (шинэ мөрүүд бий болсон).
      const prevLabels: Array<[number, string | null]> = [];
      for (const uid of changedLabels) {
        prevLabels.push([uid, savedLabels.get(uid) ?? null]);
        await putAllocationLabel(task.id, uid, squashLabel(labels[uid] ?? '') || null);
      }
      void qc.invalidateQueries({ queryKey: ALLOCATION_PREFIX });
      void qc.invalidateQueries({ queryKey: CONTRIBUTORS_PREFIX });
      invalidateAfterProgress();
      const title = res?.converted
        ? t('taskAlloc.editor.doneConverted', { name: task.name })
        : t('taskAlloc.editor.done', { name: task.name });
      if (take) toast.success(title);
      else toast.successWithAction(title, { label: t('taskAlloc.history.undoSave'), onClick: () => undoSave(res, prevLabels) });
      if (onSaved && res) await onSaved(res);
      onClose();
    } catch (err) {
      const f = toFailure(err);
      const key2 = SERVER_ERR[f.code];
      setServerError(key2 ? t(key2 as TranslationKey) : f.message || t('taskAlloc.err.generic'));
      if (f.code === 'STALE_REVISION') {
        // Шинэ төлөвөөр засварлагч дахин нээгдэнэ.
        void qc.invalidateQueries({ queryKey: ALLOCATION_PREFIX });
      }
    } finally {
      setSaving(false);
    }
  };

  const planError = !plan.ok
    ? t((PLAN_ERR[plan.code] ?? 'taskAlloc.editor.err.badValue') as TranslationKey, {
        name: plan.userId !== undefined ? nameOf(plan.userId) : '',
        max: MAX_ACTIVE_ALLOCATIONS,
      })
    : null;

  const unitLabel = model.mode === 'total' ? t('taskAlloc.editor.unitTotal') : t('taskAlloc.editor.unitShare');
  const done = ROOT_TOTAL_UNITS - R;
  const full = model.workers.length + pending.length >= MAX_ACTIVE_ALLOCATIONS;

  return (
    <div className="space-y-3" data-testid="alloc-editor-body">
      {take && (
        <p className="rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-foreground" data-testid="alloc-take-note">
          {takeReason === 'progress' ? t('taskAlloc.editor.takeNoteProgress') : t('taskAlloc.editor.takeNote')}
        </p>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground" data-testid="alloc-summary">
        <span>{t('taskAlloc.editor.progressLine', { done: formatUnits(done), remaining: formatUnits(R) })}</span>
        {overview.root && (overview.root.free_units ?? overview.root.unallocated_units) > 0 && (
          <span className="text-warning">
            {t('taskAlloc.editor.unallocated', { x: formatUnits(overview.root.free_units ?? overview.root.unallocated_units) })}
          </span>
        )}
      </div>

      {base.unattributedUnits - reservedOf(overview) > 0 && (
        <p className="flex items-start gap-1.5 text-xs text-muted-foreground" data-testid="alloc-unattributed">
          <Lock className="mt-0.5 h-3 w-3 shrink-0" />
          {t('taskAlloc.editor.unattributed', { x: formatUnits(base.unattributedUnits - reservedOf(overview)) })}
        </p>
      )}
      {reservedOf(overview) > 0 && (
        <p className="flex items-start gap-1.5 text-xs text-muted-foreground" data-testid="alloc-parts-reserved">
          <Lock className="mt-0.5 h-3 w-3 shrink-0" />
          {t('taskAlloc.editor.partsReserved', { x: formatUnits(reservedOf(overview)), n: overview.root?.parts?.length ?? 0 })}
        </p>
      )}

      {blocked && (
        <p className="flex items-start gap-1.5 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive" role="alert">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {t(blocked as TranslationKey)}
        </p>
      )}

      {/* «Үлдсэн ажлын хувиар» горим ХАСАГДСАН (эзэн 2026-10-06) — зөвхөн «Нийт зорилт»: үндсэн ажлын 100%-ийг хүн бүрт хуваана. */}
      <p className="text-xs text-muted-foreground">
        {model.mode === 'total'
          ? t('taskAlloc.editor.modeTotalHint')
          : t('taskAlloc.editor.modeRemainderHint', { remaining: formatUnits(R) })}
      </p>

      <div className="max-h-[42vh] space-y-1.5 overflow-y-auto pr-1" data-testid="alloc-rows">
        {historyRows.map((h) => (
          <div key={`h-${h.userId}`} className="flex items-center gap-2 rounded-md bg-muted/40 px-2 py-1.5" data-testid="alloc-history-row">
            <Lock className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate text-sm">
              {nameOf(h.userId)}
              <span className="ml-1 text-[11px] text-muted-foreground">
                · {t('taskAlloc.editor.historyTag', { done: formatUnits(h.doneUnits) })}
              </span>
            </span>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-7 px-2 text-xs"
              disabled={locked || full}
              onClick={() => setModel((cur) => addWorker(cur, h.userId))}
              data-testid="alloc-continue"
            >
              {t('taskAlloc.editor.continue')}
            </Button>
          </div>
        ))}

        {model.workers.map((userId) => {
          const row = plan.ok ? plan.rows.find((r) => r.userId === userId) : undefined;
          const known = base.rows.find((r) => r.userId === userId);
          const doneUnits = row?.doneUnits ?? known?.doneUnits ?? 0;
          const v = rowValue(userId);
          const bad = invalid.has(userId);
          return (
            <div
              key={userId}
              className="flex items-start gap-2 rounded-md border border-border/60 px-2 py-1.5"
              data-testid="alloc-row"
              data-user-id={userId}
            >
              <div className="min-w-0 flex-1 space-y-1">
                <Input
                  value={labelOf(userId)}
                  maxLength={120}
                  placeholder={task.name}
                  aria-label={t('taskAlloc.editor.subtaskName')}
                  disabled={locked}
                  className="h-8 text-sm"
                  onChange={(e) => {
                    const val = e.target.value;
                    history.set((s) => ({ ...s, labels: { ...s.labels, [userId]: val } }), { coalesce: `label:${userId}` });
                  }}
                  data-testid="alloc-label"
                />
                <div className="flex min-w-0 items-center gap-1.5 text-[11px] text-muted-foreground">
                  <Avatar className="h-4 w-4 shrink-0">
                    <AvatarFallback className="bg-primary/10 text-[8px] font-semibold text-primary">{initials(nameOf(userId))}</AvatarFallback>
                  </Avatar>
                  <span className="truncate text-foreground/80">{nameOf(userId)}</span>
                  {userId === myId && <span className="text-primary">· {t('taskAlloc.editor.you')}</span>}
                  {doneUnits > 0 && <span>· {t('taskAlloc.editor.doneTag', { done: formatUnits(doneUnits) })}</span>}
                  {row && (
                    <span className="tabular-nums">
                      ·{' '}
                      {model.mode === 'total'
                        ? t('taskAlloc.editor.futureLine', { x: formatUnits(row.futureUnits) })
                        : t('taskAlloc.editor.targetLine', { x: formatUnits(row.targetUnits) })}
                    </span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-1 pt-0.5">
                <Input
                  inputMode="decimal"
                  aria-label={unitLabel}
                  aria-invalid={bad}
                  data-testid="alloc-input"
                  className={cn(
                    'h-8 w-20 text-right tabular-nums',
                    bad && 'border-destructive text-destructive',
                    v.hard ? 'font-semibold' : 'text-muted-foreground',
                  )}
                  value={v.text}
                  disabled={locked}
                  onFocus={(e) => {
                    setEditing({ userId, text: v.text });
                    e.currentTarget.select();
                  }}
                  onChange={(e) => onType(userId, e.target.value)}
                  onBlur={() => {
                    setEditing(null);
                    setInvalid((prev) => {
                      if (!prev.has(userId)) return prev;
                      const next = new Set(prev);
                      next.delete(userId);
                      return next;
                    });
                  }}
                />
                <span className="text-sm text-muted-foreground">%</span>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7 text-muted-foreground hover:text-foreground"
                  disabled={locked || full || addable.length === 0}
                  title={t('taskAlloc.editor.duplicate')}
                  aria-label={t('taskAlloc.editor.duplicate')}
                  data-testid="alloc-duplicate"
                  onClick={() => duplicate(userId)}
                >
                  <Copy className="h-3.5 w-3.5" />
                </Button>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7 text-muted-foreground hover:text-destructive"
                  disabled={locked}
                  title={doneUnits > 0 ? t('taskAlloc.editor.removeKeepsDone') : t('taskAlloc.editor.remove')}
                  aria-label={t('taskAlloc.editor.remove')}
                  data-testid="alloc-remove"
                  onClick={() => setModel((cur) => removeWorker(cur, userId))}
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          );
        })}

        {pending.map((p) => (
          <div
            key={p.key}
            className="flex items-start gap-2 rounded-md border border-dashed border-primary/40 bg-primary/5 px-2 py-1.5"
            data-testid="alloc-pending-row"
          >
            <div className="min-w-0 flex-1 space-y-1">
              <Input
                value={p.label}
                maxLength={120}
                placeholder={task.name}
                aria-label={t('taskAlloc.editor.subtaskName')}
                disabled={locked}
                className="h-8 text-sm"
                onChange={(e) => {
                  const val = e.target.value;
                  history.set(
                    (s) => ({ ...s, pending: s.pending.map((x) => (x.key === p.key ? { ...x, label: val } : x)) }),
                    { coalesce: `pending:${p.key}` },
                  );
                }}
                data-testid="alloc-pending-label"
              />
              <p className="text-[11px] text-muted-foreground">{t('taskAlloc.editor.pendingHint', { name: nameOf(p.fromUserId) })}</p>
            </div>
            <Select value="" onValueChange={(v) => pickPending(p.key, Number(v))} disabled={locked}>
              <SelectTrigger size="sm" className="w-[11rem]" data-testid="alloc-pending-person">
                <UserPlus className="h-3.5 w-3.5" />
                <SelectValue placeholder={t('taskAlloc.editor.pickPerson')} />
              </SelectTrigger>
              <SelectContent>
                {addable.map((u) => (
                  <SelectItem key={u.id} value={String(u.id)}>
                    {formatDisplayName(u.full_name ?? u.username)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="h-7 w-7 text-muted-foreground hover:text-destructive"
              disabled={locked}
              aria-label={t('taskAlloc.editor.remove')}
              onClick={() => history.set((s) => ({ ...s, pending: s.pending.filter((x) => x.key !== p.key) }))}
              data-testid="alloc-pending-remove"
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
        ))}
        {model.workers.length === 0 && pending.length === 0 && (
          <p className="py-3 text-center text-xs text-muted-foreground">{t('taskAlloc.editor.noWorkers')}</p>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <Select
            value=""
            onValueChange={(v) => {
              const id = Number(v);
              if (Number.isFinite(id)) setModel((cur) => addWorker(cur, id));
            }}
            disabled={locked || full || addable.length === 0}
          >
            <SelectTrigger size="sm" className="w-[13rem]" data-testid="alloc-add">
              <UserPlus className="h-3.5 w-3.5" />
              <SelectValue placeholder={t('taskAlloc.editor.addPerson')} />
            </SelectTrigger>
            <SelectContent>
              {addable.map((u) => (
                <SelectItem key={u.id} value={String(u.id)}>
                  {formatDisplayName(u.full_name ?? u.username)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="h-8 w-8"
            disabled={locked || !history.canUndo}
            title={t('taskAlloc.history.undo')}
            aria-label={t('taskAlloc.history.undo')}
            onClick={() => {
              setEditing(null);
              history.undo();
            }}
            data-testid="alloc-history-undo"
          >
            <Undo2 className="h-3.5 w-3.5" />
          </Button>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="h-8 w-8"
            disabled={locked || !history.canRedo}
            title={t('taskAlloc.history.redo')}
            aria-label={t('taskAlloc.history.redo')}
            onClick={() => {
              setEditing(null);
              history.redo();
            }}
            data-testid="alloc-history-redo"
          >
            <Redo2 className="h-3.5 w-3.5" />
          </Button>
        </div>
        <div className="flex items-center gap-3 text-xs">
          <Button
            type="button"
            variant="link"
            size="xs"
            className="h-auto px-0 has-[>svg]:px-0"
            disabled={locked || model.workers.length < 2}
            onClick={() => {
              setEditing(null);
              setInvalid(new Set());
              setModel((cur) => resetEqual(cur));
            }}
            data-testid="alloc-equalize"
          >
            <RotateCcw className="mr-1 h-3 w-3" />
            {t('taskAlloc.editor.equalize')}
          </Button>
          {sums && (
            <span
              className={cn('tabular-nums', sums.sum === sums.total ? 'text-muted-foreground' : 'text-destructive')}
              data-testid="alloc-sum"
            >
              {t('taskAlloc.editor.sum', { sum: formatUnits(sums.sum), total: formatUnits(sums.total) })}
            </span>
          )}
        </div>
      </div>

      {planError && !blocked && changed && (
        <p className="text-xs text-destructive" role="alert" data-testid="alloc-plan-error">
          {planError}
        </p>
      )}
      {pending.length > 0 && !blocked && (
        <p className="text-xs text-warning" data-testid="alloc-pending-error">
          {t('taskAlloc.editor.pendingNeedsPerson')}
        </p>
      )}
      {serverError && (
        <p className="text-xs text-destructive" role="alert" data-testid="alloc-server-error">
          {serverError}
        </p>
      )}
      <p className="text-xs text-muted-foreground">{t('taskAlloc.editor.note')}</p>
      <p className="text-[11px] text-muted-foreground">{t('taskAlloc.history.hint')}</p>

      <DialogFooter>
        <Button variant="ghost" onClick={onClose} disabled={saving}>
          {t('common.cancel')}
        </Button>
        <Button
          onClick={() => void submit()}
          disabled={saving || !plan.ok || !changed || blocked !== null || pending.length > 0}
          data-testid="alloc-submit"
        >
          {saving && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
          {take ? t('taskAlloc.editor.submitTake') : t('taskAlloc.editor.submit')}
        </Button>
      </DialogFooter>
    </div>
  );
}

export default AllocationEditorDialog;
