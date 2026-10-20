/* ✂ ТАСКИЙГ ҮНДСЭН ТАСКУУД БОЛГОН ХУВААХ (эзэн 2026-10-09, migration 0395).
 *
 *   17  Фасад                       →   17  Фасад — хойд        60%
 *                                        18  Фасад — урд         40%
 *
 * Мөр бүр ЖИНХЭНЭ шинэ үндсэн таск болно (өөрийн ▶ цаг, хувь, дэд таск/хуваарилалттай).  Мөрийг хуулж (⧉), нэрийг шууд
 * бичиж, хувийг тохируулна.  Явцтай таскийн хийгдсэн хэсэг «… (хийгдсэн X%)» таск болж хаагдана, үлдсэнийг хуваана.
 * Ctrl+Z / Ctrl+Y — цонх доторх алхмыг буцаах/давтах.  Хадгалсны дараа «Буцаах» (toast), эсвэл энэ цонхны
 * «Хуваалтыг буцаах» — шинэ таскууд дээр ажил эхлээгүй үед бүгдийг анхны байдалд нь.
 * Дүрэм `rootSplitEditor.ts` (цэвэр), эцсийн шийдвэр СЕРВЕР (`POST /tasks/:id/root-split`). */
import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Copy, Loader2, Plus, Redo2, RotateCcw, Trash2, Undo2 } from 'lucide-react';

import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/ui/dialog';
import { confirmDialog } from '@/shared/components/ConfirmDialog';
import { toast } from '@/shared/components/Toast';
import { useUndoHistory, useUndoHotkeys } from '@/shared/hooks/useUndoHistory';
import { cn } from '@/shared/lib/utils';
import { useLanguage, type TranslationKey } from '@/shared/i18n';

import { fetchRootSplit, newRequestId, postRootSplit, postRootSplitUndo, rootSplitKey, toFailure } from './api';
import {
  MAX_ROOT_SPLIT_NAME,
  MAX_ROOT_SPLIT_PARTS,
  addRow,
  checkSplit,
  duplicateRow,
  equalize,
  initSplit,
  removeRow,
  setName,
  setUnits,
  toSplitBody,
} from './rootSplitEditor';
import type { RootSplitInfo, RootSplitResult } from './types';
import { ROOT_TOTAL_UNITS, formatUnits, parseUnits } from './units';

export function RootSplitDialog({
  task,
  onSaved,
  onUndone,
  onClose,
}: {
  task: { id: number; name: string };
  /** Амжилттай хуваасны дараа (эцэг нь «Буцаах» toast харуулна). */
  onSaved: (res: RootSplitResult) => void;
  /** Хуваалтыг энэ цонхноос буцаасны дараа. */
  onUndone: () => void;
  onClose: () => void;
}) {
  const { t } = useLanguage();
  const info = useQuery({ queryKey: rootSplitKey(task.id), queryFn: () => fetchRootSplit(task.id), staleTime: 0 });
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-xl" onClick={(e) => e.stopPropagation()} data-testid="root-split-dialog">
        <DialogHeader>
          <DialogTitle>{t('taskAlloc.rootSplit.title')}</DialogTitle>
          <DialogDescription>{task.name}</DialogDescription>
        </DialogHeader>
        {info.isError ? (
          <div className="space-y-3 py-4 text-sm">
            <p className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="h-4 w-4" />
              {toFailure(info.error).message || t('common.loadFailed')}
            </p>
            <Button variant="outline" size="sm" onClick={() => void info.refetch()}>
              {t('common.retry')}
            </Button>
          </div>
        ) : !info.data ? (
          <div className="flex items-center justify-center py-10">
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
          </div>
        ) : (
          <SplitBody key={info.dataUpdatedAt} info={info.data} onSaved={onSaved} onUndone={onUndone} onClose={onClose} />
        )}
      </DialogContent>
    </Dialog>
  );
}

function LastSplitNotice({ info, onUndone }: { info: RootSplitInfo; onUndone: () => void }) {
  const { t } = useLanguage();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const last = info.last_split;
  if (!last) return null;
  const parts = last.members.filter((m) => m.role === 'part');
  const undo = async () => {
    const ok = await confirmDialog({
      title: t('taskAlloc.rootSplit.undoTitle'),
      description: t('taskAlloc.rootSplit.undoConfirm', { name: last.orig_name, n: parts.length }),
      confirmText: t('taskAlloc.rootSplit.undo'),
      variant: 'destructive',
    });
    if (!ok) return;
    setBusy(true);
    try {
      await postRootSplitUndo(last.id, newRequestId());
      toast.success(t('taskAlloc.rootSplit.undone', { name: last.orig_name }));
      void qc.invalidateQueries({ queryKey: ['/tasks/root-split'] });
      onUndone();
    } catch (err) {
      toast.error(t('taskAlloc.rootSplit.undoFailed'), toFailure(err).message || undefined);
      void qc.invalidateQueries({ queryKey: ['/tasks/root-split'] });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-1.5 rounded-md border border-border bg-muted/30 px-3 py-2 text-xs" data-testid="root-split-last">
      <p className="text-foreground">
        {t('taskAlloc.rootSplit.lastSplit', { name: last.orig_name, n: parts.length })}
      </p>
      <p className="text-muted-foreground">{parts.map((p) => p.name).join(' · ')}</p>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-7 gap-1 px-2 text-xs"
          disabled={busy || !last.undoable}
          onClick={() => void undo()}
          data-testid="root-split-undo"
        >
          {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Undo2 className="h-3 w-3" />}
          {t('taskAlloc.rootSplit.undo')}
        </Button>
        {!last.undoable && last.blocked_message && <span className="text-muted-foreground">{last.blocked_message}</span>}
      </div>
    </div>
  );
}

function SplitBody({
  info,
  onSaved,
  onUndone,
  onClose,
}: {
  info: RootSplitInfo;
  onSaved: (res: RootSplitResult) => void;
  onUndone: () => void;
  onClose: () => void;
}) {
  const { t } = useLanguage();
  const qc = useQueryClient();
  const history = useUndoHistory(() => initSplit(info.task.name, info.prefill));
  const model = history.state;
  const [typing, setTyping] = useState<{ key: string; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const attempt = useRef<{ id: string; key: string } | null>(null);
  // ⧉ хуулсан мөр = шинэ үндсэн таск: нэрийн талбарт шууд фокус + бүтэн сонголт, бичмэгц нэр солигдоно.
  const [renameKey, setRenameKey] = useState<string | null>(null);
  const nameInputs = useRef(new Map<string, HTMLInputElement>());
  useEffect(() => {
    if (!renameKey) return;
    const el = nameInputs.current.get(renameKey);
    if (el) {
      el.focus();
      el.select();
    }
    setRenameKey(null);
  }, [renameKey]);
  // Ctrl+Z / Ctrl+Y — бичиж буй % талбарын түр бичвэр буцаасан загварыг дарахгүй.
  useUndoHotkeys(history.undo, history.redo, () => setTyping(null), !saving);

  const progress = info.task.progress;
  const remainder = progress > 0;
  const minParts = remainder ? 1 : 2;
  const check = checkSplit(model, minParts);
  const locked = saving || !info.can_split;

  const errorText = check.error
    ? t(`taskAlloc.rootSplit.err.${check.error}` as TranslationKey, {
        sum: formatUnits(check.sum),
        max: MAX_ROOT_SPLIT_PARTS,
        min: minParts,
      })
    : null;

  const submit = async () => {
    if (!check.ok || locked) return;
    const body = toSplitBody(model);
    const key = JSON.stringify(body);
    // Ижил ачааллын сүлжээний давталт ижил `request_id` — өөр ачаалал шинэ id.
    if (!attempt.current || attempt.current.key !== key) attempt.current = { id: newRequestId(), key };
    setSaving(true);
    setServerError(null);
    try {
      const res = await postRootSplit(info.task.id, attempt.current.id, body);
      void qc.invalidateQueries({ queryKey: ['/tasks/root-split'] });
      onSaved(res);
      onClose();
    } catch (err) {
      const f = toFailure(err);
      setServerError(f.message || t('taskAlloc.err.generic'));
      if (f.code === 'STALE') void qc.invalidateQueries({ queryKey: rootSplitKey(info.task.id) });
    } finally {
      setSaving(false);
    }
  };

  const onType = (key: string, text: string) => {
    setTyping({ key, text });
    const parsed = parseUnits(text, ROOT_TOTAL_UNITS);
    if (parsed.ok) history.set((m) => setUnits(m, key, parsed.units), { coalesce: `units:${key}` });
  };
  const act = (fn: Parameters<typeof history.set>[0]) => {
    setTyping(null);
    history.set(fn);
  };

  return (
    <div className="space-y-3" data-testid="root-split-body">
      <LastSplitNotice info={info} onUndone={onUndone} />

      {info.block ? (
        <p
          className="flex items-start gap-1.5 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive"
          role="alert"
          data-testid="root-split-blocked"
        >
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {info.block.message}
        </p>
      ) : (
        <p className="text-xs text-muted-foreground">
          {remainder
            ? t('taskAlloc.rootSplit.introRemainder', { done: Math.round(progress * 100) / 100, rest: Math.round((100 - progress) * 100) / 100 })
            : t('taskAlloc.rootSplit.intro')}
        </p>
      )}
      {info.prefill.length > 0 && !info.block && (
        <p className="text-xs text-muted-foreground" data-testid="root-split-prefill">
          {t('taskAlloc.rootSplit.fromParts')}
        </p>
      )}

      <div className="max-h-[46vh] space-y-1.5 overflow-y-auto pr-1" data-testid="root-split-rows">
        {model.rows.map((r, i) => {
          const bad = check.rowErrors[r.key];
          const text = typing?.key === r.key ? typing.text : formatUnits(r.units);
          return (
            <div key={r.key} className="flex items-center gap-1.5" data-testid="root-split-row">
              <span className="w-6 shrink-0 text-right text-[11px] tabular-nums text-muted-foreground">{i + 1}.</span>
              <Input
                ref={(el) => {
                  if (el) nameInputs.current.set(r.key, el);
                  else nameInputs.current.delete(r.key);
                }}
                value={r.name}
                maxLength={MAX_ROOT_SPLIT_NAME}
                placeholder={t('taskAlloc.rootSplit.namePlaceholder')}
                aria-label={t('taskAlloc.rootSplit.namePlaceholder')}
                aria-invalid={bad === 'EMPTY_NAME' || bad === 'LONG_NAME'}
                disabled={locked}
                className={cn('h-8 min-w-0 flex-1 text-sm', (bad === 'EMPTY_NAME' || bad === 'LONG_NAME') && 'border-destructive')}
                onChange={(e) => {
                  const v = e.target.value;
                  history.set((m) => setName(m, r.key, v), { coalesce: `name:${r.key}` });
                }}
                data-testid="root-split-name"
              />
              <Input
                inputMode="decimal"
                value={text}
                aria-label={t('taskAlloc.rootSplit.pctLabel')}
                aria-invalid={bad === 'ZERO'}
                disabled={locked}
                className={cn(
                  'h-8 w-20 shrink-0 text-right tabular-nums',
                  r.fixed ? 'font-semibold' : 'text-muted-foreground',
                  bad === 'ZERO' && 'border-destructive text-destructive',
                )}
                onFocus={(e) => {
                  setTyping({ key: r.key, text: formatUnits(r.units) });
                  e.currentTarget.select();
                }}
                onChange={(e) => onType(r.key, e.target.value)}
                onBlur={() => setTyping(null)}
                data-testid="root-split-units"
              />
              <span className="text-sm text-muted-foreground">%</span>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="h-7 w-7 shrink-0 text-muted-foreground hover:text-foreground"
                disabled={locked || model.rows.length >= MAX_ROOT_SPLIT_PARTS}
                title={t('taskAlloc.rootSplit.duplicate')}
                aria-label={t('taskAlloc.rootSplit.duplicate')}
                onClick={() => {
                  const newKey = `n${model.seq}`;
                  act((m) => duplicateRow(m, r.key));
                  setRenameKey(newKey);
                }}
                data-testid="root-split-duplicate"
              >
                <Copy className="h-3.5 w-3.5" />
              </Button>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive"
                disabled={locked || model.rows.length <= 1}
                title={t('taskAlloc.rootSplit.remove')}
                aria-label={t('taskAlloc.rootSplit.remove')}
                onClick={() => act((m) => removeRow(m, r.key))}
                data-testid="root-split-remove"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={locked || model.rows.length >= MAX_ROOT_SPLIT_PARTS}
            onClick={() => {
              const newKey = `n${model.seq}`;
              act((m) => addRow(m));
              setRenameKey(newKey);
            }}
            data-testid="root-split-add"
          >
            <Plus className="h-3.5 w-3.5" />
            {t('taskAlloc.rootSplit.add')}
          </Button>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="h-8 w-8"
            disabled={locked || !history.canUndo}
            title={t('taskAlloc.history.undo')}
            aria-label={t('taskAlloc.history.undo')}
            onClick={() => {
              setTyping(null);
              history.undo();
            }}
            data-testid="root-split-history-undo"
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
              setTyping(null);
              history.redo();
            }}
            data-testid="root-split-history-redo"
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
            disabled={locked || model.rows.length < 2}
            onClick={() => act((m) => equalize(m))}
            data-testid="root-split-equalize"
          >
            <RotateCcw className="mr-1 h-3 w-3" />
            {t('taskAlloc.rootSplit.equalize')}
          </Button>
          <span
            className={cn('tabular-nums', check.sum === ROOT_TOTAL_UNITS ? 'text-muted-foreground' : 'font-semibold text-destructive')}
            data-testid="root-split-sum"
          >
            {t('taskAlloc.rootSplit.sum', { sum: formatUnits(check.sum) })}
          </span>
        </div>
      </div>

      {(errorText || serverError) && !info.block && (
        <p className="flex items-start gap-1.5 text-xs text-destructive" role="alert" data-testid="root-split-error">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {serverError ?? errorText}
        </p>
      )}
      <p className="text-[11px] text-muted-foreground">{t('taskAlloc.history.hint')}</p>

      <DialogFooter className="gap-2">
        <Button type="button" variant="ghost" onClick={onClose} disabled={saving}>
          {t('common.cancel')}
        </Button>
        <Button type="button" onClick={() => void submit()} disabled={!check.ok || locked} data-testid="root-split-save">
          {saving && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
          {t('taskAlloc.rootSplit.save', { n: model.rows.length })}
        </Button>
      </DialogFooter>
    </div>
  );
}

export default RootSplitDialog;
