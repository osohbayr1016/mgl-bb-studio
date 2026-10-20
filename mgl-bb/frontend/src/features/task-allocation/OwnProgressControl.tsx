/* ӨӨРИЙН ЯВЦЫН УДИРДЛАГА — төслийн хуудас БА «Миний ажлууд»-д НЭГ компонент (2026-10-02).
 *
 *   [ − ] [ 2.5 / 5 ] [ + ]  [💾 Хадгалах] [↶]     (2026-10-06: алхам ҮРГЭЛЖ 10%; 10%/1% ба «дуусгах» товч хасагдсан)
 *   ▬▬▬▬▬▬▬▬▬▬▬▬ (миний хэсгийн явц)
 *   2026-10-06 (эзэн): АВТОМАТ ХАДГАЛАЛТ БАЙХГҮЙ — −/+ / тоо бичих нь ноорог л өөрчилнө (төслийн хуудасны явцын bar
 *   урьдчилан хөдөлнө), хувь «Хадгалах» дарсны дараа л бодогдоно.  Дуусгах асуулт ч «Хадгалах» дарахад нээгдэнэ.
 *   Доорх «ШУУД нэмэгдэнэ / 0.6 сек» мөр нь түүх.
 *
 *   • `−` / `+` = таны НИЙТ зорилтын 10% (5-ын зорилтод 0.5; 90-д 9).  Хязгаарт тулбал сүүлийн алхам богиноно
 *     (зорилтоос хэтрэхгүй).
 *   • Тоо бичих — ХАТУУ: 2.5 → 2.5/5.  Хэт олон орон, зорилтоос их, доод хязгаараас бага бол ноорог өөрчлөгдөхгүй.
 *   • −/+ ба тоо бичих нь ЗӨВХӨН ноорог хөдөлгөнө — сервер рүү «Хадгалах» дарахад НЭГ хүсэлт явна.
 *   • Зорилтод хүрэх / ажлыг 100% болгох үед ЭХЛЭЭД дуусгах асуулт (`CompletionQaDialog`) — хариулсны дараа л хадгална.
 *
 * Ноорог, сервер: `ownProgressStore.ts`; цэвэр дүрэм: `ownProgress.ts`. */
import { memo, useCallback, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { Loader2, Minus, Plus, RotateCcw, Save, Undo2 } from 'lucide-react';

import { Button } from '@/ui/button';
import { Progress } from '@/ui/progress';
import { toast } from '@/shared/components/Toast';
import { cn } from '@/shared/lib/utils';
import { useLanguage, type TranslationKey } from '@/shared/i18n';

import { CompletionQaDialog } from './CompletionQaDialog';
import { type OwnBase } from './ownProgress';
import { ownProgressStore } from './ownProgressStore';
import type { QaQuestion } from './types';
import { useOwnProgress } from './useOwnProgress';
import { formatUnits, stepUnits, type StepMode } from './units';
import { useTaskAllocGate } from './useTaskAllocGate';

/** «Хадгалагдлаа» тэмдэглэгээг хэдэн мс харуулах вэ. */
const SAVED_VISIBLE_MS = 6000;
/** −/+ алхам = таны нийт зорилтын 10% (сонголтгүй, 2026-10-06). */
const OWN_STEP_PCT: StepMode = 10;
const HOLD_DELAY_MS = 450;
const HOLD_REPEAT_MS = 140;

/** Дарж барихад давтагдана (1% алхамаар олон дарах хэрэггүй).  `enabled` false болмогц давталт зогсоно. */
function useHoldRepeat(action: () => void, enabled: boolean) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const actionRef = useRef(action);
  const enabledRef = useRef(enabled);
  useEffect(() => {
    actionRef.current = action;
    enabledRef.current = enabled;
  });
  const stop = useCallback(() => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
  }, []);
  useEffect(() => stop, [stop]);
  const start = useCallback(() => {
    stop();
    actionRef.current();
    const repeat = () => {
      if (!enabledRef.current) {
        stop();
        return;
      }
      actionRef.current();
      timer.current = setTimeout(repeat, HOLD_REPEAT_MS);
    };
    timer.current = setTimeout(repeat, HOLD_DELAY_MS);
  }, [stop]);
  return {
    onPointerDown: (e: PointerEvent) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      start();
    },
    onPointerUp: stop,
    onPointerLeave: stop,
    onPointerCancel: stop,
    // Гарнаас (Enter/Space) pointer үйл явдал ирэхгүй — нэг дарахад нэг алхам.
    onKeyDown: (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        actionRef.current();
      }
    },
  };
}

const TYPED_ERROR_KEY: Record<string, string> = {
  EMPTY: 'taskAlloc.own.errEmpty',
  FORMAT: 'taskAlloc.own.errFormat',
  PRECISION: 'taskAlloc.own.errPrecision',
  NEGATIVE: 'taskAlloc.own.errNegative',
  RANGE: 'taskAlloc.own.errRange',
  BELOW_FLOOR: 'taskAlloc.own.errBelowFloor',
};

const SERVER_ERROR_KEY: Record<string, string> = {
  NETWORK: 'taskAlloc.err.network',
  TAKE_REQUIRED: 'taskAlloc.err.takeRequired',
  PROJECT_INACTIVE: 'taskAlloc.err.projectInactive',
  TASK_COMPLETED: 'taskAlloc.err.taskCompleted',
  BELOW_FLOOR: 'taskAlloc.err.belowFloor',
  OVER_TARGET: 'taskAlloc.err.overTarget',
  NO_ALLOCATION: 'taskAlloc.err.noAllocation',
  STALE_REVISION: 'taskAlloc.err.stale',
  MANAGED_ROOT: 'taskAlloc.err.generic',
};

export const OwnProgressControl = memo(function OwnProgressControl({
  base,
  questions,
  taskName,
  disabledReason = null,
  compact = false,
  report,
  onSaved,
  className,
}: {
  /** Серверээс мэдэгдэж буй миний хуваарилалт; null бол юу ч харуулахгүй. */
  base: OwnBase | null;
  /** Төслийн «дуусгах асуултууд» (сервер өгнө) — дуусгах цонхонд. */
  questions: QaQuestion[];
  taskName: string;
  /** Өгвөл товчнууд идэвхгүй, шалтгаан харагдана (жишээ нь «Эхлээд цагаа эхлүүлнэ үү»). */
  disabledReason?: string | null;
  compact?: boolean;
  /** Хадгалалтад хавсаргах тэмдэглэл/хавсралт (дуудагчийн ноорог) — «Миний ажлууд»-ын тайлбар, файл. */
  report?: { notes: string; attachments: unknown[] };
  /** Шинэ хадгалалт бүрийн дараа НЭГ удаа (жишээ нь дуудагч ноорогоо цэвэрлэнэ). */
  onSaved?: () => void;
  className?: string;
}) {
  const { t } = useLanguage();
  const api = useOwnProgress(base);
  // 2026-10-06 (эзэн): алхам ҮРГЭЛЖ нийт зорилтын 10% — 10% / 1% сонголт ба «Үлдсэнийг дуусгах» товч хасагдсан.
  const mode = OWN_STEP_PCT;
  const [editing, setEditing] = useState<string | null>(null);
  const [typedError, setTypedError] = useState<string | null>(null);
  // Escape дарахад input устаж blur үүсэх тохиолдолд ноорогт бичихгүй.
  const skipBlur = useRef(false);

  const draft = api?.draft ?? null;
  const view = api?.view ?? null;
  const saving = draft?.phase === 'saving';
  // Удирдлага түр түгжсэн (423) / хуудас хуучирсан (426) үед ч идэвхгүй — шийдвэр серверийнх, энэ нь зөвхөн тодорхой байлгана.
  const gate = useTaskAllocGate();
  const effectiveReason = disabledReason ?? (gate.writable ? null : t('taskAlloc.gate.locked'));
  const locked = effectiveReason !== null || saving;

  const canDown = !!view && !locked && !view.atFloor;
  const canUp = !!view && !locked && !view.atCap;
  const step = api?.step;
  const down = useHoldRepeat(() => step?.('down', mode), canDown);
  const up = useHoldRepeat(() => step?.('up', mode), canUp);

  // Дуусгах асуулт «Хадгалах» дарсны ДАРАА л нээгдэнэ (2026-10-06 — −/+ дарах үед цонх гарахгүй).  Асуулт байхгүй бол
  // (өгөгдмөл нь сервер талд) шууд баталгаажуулна.
  //   `qaFor` = «Хадгалах» дарсан агшны ноорог + сүүлийн хадгалалтын дугаар — ноорог өөрчлөгдөх эсвэл хадгалагдвал цонх хаагдана.
  const [qaFor, setQaFor] = useState<{ desired: number; seq: number } | null>(null);
  const qaNeed = draft?.qaNeed ?? null;
  const qaQuestions = qaNeed?.questions ?? questions;
  const confirmQa = api?.confirmQa;
  const qaOpen =
    !!qaNeed &&
    !!draft &&
    qaFor !== null &&
    qaFor.desired === draft.desired &&
    qaFor.seq === (draft.lastSaved?.seq ?? 0);
  const autoConfirm = qaOpen && qaQuestions.length === 0;
  useEffect(() => {
    if (autoConfirm) confirmQa?.({});
  }, [autoConfirm, confirmQa]);

  // Дуудагчийн тэмдэглэл/хавсралтыг хадгалалтад хавсаргана (ноорог өөрчлөгдөхгүй).
  const reportNotes = report?.notes ?? null;
  const reportFiles = report?.attachments;
  const reportTaskId = base?.taskId ?? 0;
  const hasReport = report !== undefined;
  useEffect(() => {
    if (!hasReport || reportTaskId === 0) return;
    ownProgressStore.setReport(reportTaskId, reportNotes, reportFiles ?? []);
  }, [hasReport, reportTaskId, reportNotes, reportFiles]);

  // «Хадгалагдлаа» тэмдэглэгээ түр харагдаад алга болно (`now` нь таймерын дараа л шинэчлэгдэнэ).
  const [now, setNow] = useState(() => Date.now());
  const savedAt = draft?.lastSaved?.at ?? 0;
  useEffect(() => {
    if (savedAt === 0) return;
    const left = savedAt + SAVED_VISIBLE_MS - Date.now();
    if (left <= 0) return;
    const id = setTimeout(() => setNow(Date.now()), left + 30);
    return () => clearTimeout(id);
  }, [savedAt]);

  // Дуусгасан мэдэгдэл — шинэ хадгалалт тутамд НЭГ удаа.
  const savedSeq = draft?.lastSaved?.seq ?? 0;
  const seenSeq = useRef(savedSeq);
  const lastSaved = draft?.lastSaved ?? null;
  useEffect(() => {
    if (!lastSaved || lastSaved.seq === seenSeq.current) return;
    seenSeq.current = lastSaved.seq;
    onSaved?.();
    if (lastSaved.completedRoot) toast.success(t('taskAlloc.toast.rootDone', { name: taskName }));
    else if (lastSaved.reachedOwnCap) toast.success(t('taskAlloc.toast.ownDone', { name: taskName }));
    else if (lastSaved.reopenedRoot) toast.info(t('taskAlloc.toast.reopened', { name: taskName }));
  }, [lastSaved, t, taskName, onSaved]);

  if (!api || !draft || !view || !base) return null;
  const stepAmount = stepUnits(view.target, mode);

  const commitTyped = () => {
    if (skipBlur.current) {
      skipBlur.current = false;
      return;
    }
    if (editing === null) return;
    const r = api.typed(editing);
    if (r && !r.ok) {
      setTypedError(r.code);
      return;
    }
    setTypedError(null);
    setEditing(null);
  };

  /** «Хадгалах»: дуусгах асуулт шаардлагатай бол ЭХЛЭЭД цонх (хариулсны дараа store өөрөө хадгална). */
  //   Сервер дуусгах асуулт шаардвал (клиентийн таамаг зөрсөн) цонх мөн энэ ноорогт нээгдэнэ.
  const save = () => {
    setQaFor({ desired: draft.desired, seq: draft.lastSaved?.seq ?? 0 });
    if (!(draft.qaNeed && !draft.qa)) api.saveNow();
  };

  const errKey = draft.error ? (SERVER_ERROR_KEY[draft.error.code] ?? null) : null;
  const errText = draft.error
    ? errKey
      ? t(errKey as TranslationKey)
      : draft.error.message || t('taskAlloc.err.generic')
    : null;

  const btn =
    'flex h-full w-7 pointer-coarse:w-9 shrink-0 items-center justify-center text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-40 touch-manipulation select-none';

  return (
    <div
      className={cn('flex min-w-0 flex-col gap-1', className)}
      data-testid="own-progress"
      data-task-id={base.taskId}
      data-phase={draft.phase}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex flex-wrap items-center gap-1.5">
        <div
          role="group"
          aria-label={t('taskAlloc.own.group')}
          title={effectiveReason ?? t('taskAlloc.own.groupTitle')}
          className={cn(
            'inline-flex h-8 pointer-coarse:h-10 items-stretch overflow-hidden rounded-md border bg-transparent shadow-xs dark:bg-input/30',
            draft.phase === 'dirty' ? 'border-warning/60' : draft.phase === 'error' ? 'border-destructive/60' : 'border-input',
            effectiveReason !== null && 'opacity-60',
          )}
        >
          <button
            type="button"
            className={cn(btn, 'border-r border-input')}
            disabled={!canDown}
            aria-label={t('taskAlloc.own.decrease', { step: formatUnits(stepAmount) })}
            data-testid="own-minus"
            {...down}
          >
            <Minus className="h-3.5 w-3.5" />
          </button>
          <div className="flex min-w-[4.75rem] items-center justify-center gap-1 px-1.5 text-xs tabular-nums">
            {editing === null ? (
              <button
                type="button"
                className="rounded px-0.5 font-semibold text-foreground hover:bg-muted disabled:pointer-events-none"
                disabled={locked}
                title={t('taskAlloc.own.editTitle')}
                data-testid="own-value"
                onClick={() => {
                  skipBlur.current = false;
                  setTypedError(null);
                  setEditing(formatUnits(view.done));
                }}
              >
                {formatUnits(view.done)}
              </button>
            ) : (
              <input
                autoFocus
                type="text"
                inputMode="decimal"
                value={editing}
                aria-invalid={typedError !== null}
                aria-label={t('taskAlloc.own.editTitle')}
                data-testid="own-input"
                className={cn(
                  'h-6 w-12 rounded border bg-background px-1 text-right text-xs font-semibold tabular-nums outline-none',
                  typedError ? 'border-destructive' : 'border-input focus:border-ring',
                )}
                onChange={(e) => {
                  setTypedError(null);
                  setEditing(e.target.value);
                }}
                onFocus={(e) => e.currentTarget.select()}
                onBlur={commitTyped}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    commitTyped();
                  } else if (e.key === 'Escape') {
                    e.preventDefault();
                    skipBlur.current = true;
                    setTypedError(null);
                    setEditing(null);
                  }
                }}
              />
            )}
            <span className="text-muted-foreground">/ {formatUnits(view.target)}</span>
          </div>
          <button
            type="button"
            className={cn(btn, 'border-l border-input')}
            disabled={!canUp}
            aria-label={t('taskAlloc.own.increase', { step: formatUnits(stepAmount) })}
            data-testid="own-plus"
            {...up}
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* «Хадгалах» — 2026-10-06 (эзэн): автомат хадгалалт байхгүй, хувь ЗӨВХӨН энэ товчоор бодогдоно. */}
        <Button
          type="button"
          size="sm"
          variant={view.dirty ? 'default' : 'outline'}
          className="h-8 gap-1 px-2.5 text-xs pointer-coarse:h-10"
          disabled={!view.dirty || saving || effectiveReason !== null}
          title={t('taskAlloc.own.saveTitle')}
          data-testid="own-save"
          onClick={save}
        >
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
          {saving ? t('taskAlloc.own.saving') : t('taskAlloc.own.save')}
        </Button>
        {view.dirty && !saving && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-8 w-8 p-0 has-[>svg]:px-0 text-muted-foreground pointer-coarse:h-10 pointer-coarse:w-10"
            title={t('taskAlloc.own.revert')}
            aria-label={t('taskAlloc.own.revert')}
            data-testid="own-revert"
            onClick={api.revert}
          >
            <Undo2 className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>

      {!compact && (
        <Progress value={view.ratioPct} className="h-1 max-w-[16rem]" aria-label={t('taskAlloc.own.barLabel')} />
      )}

      {typedError !== null && (
        <p className="text-xs text-destructive" role="alert" data-testid="own-typed-error">
          {t((TYPED_ERROR_KEY[typedError] ?? 'taskAlloc.own.errFormat') as TranslationKey, {
            max: formatUnits(view.target),
            floor: formatUnits(draft.base.floor),
          })}
        </p>
      )}

      {effectiveReason !== null && <p className="text-[11px] text-muted-foreground">{effectiveReason}</p>}

      {draft.phase === 'error' && errText && (
        <div className="flex flex-wrap items-center gap-1.5 text-[11px]" role="alert" data-testid="own-error">
          <span className="text-destructive">{errText}</span>
          {draft.error?.retryable && (
            <Button type="button" size="sm" variant="ghost" className="h-6 gap-1 px-1.5 text-[11px] pointer-coarse:h-8" onClick={api.retry}>
              <RotateCcw className="h-3 w-3" />
              {t('taskAlloc.own.retry')}
            </Button>
          )}
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-6 gap-1 px-1.5 text-[11px] text-muted-foreground pointer-coarse:h-8"
            onClick={api.revert}
          >
            <Undo2 className="h-3 w-3" />
            {t('taskAlloc.own.revert')}
          </Button>
        </div>
      )}

      {draft.phase === 'clean' && lastSaved && lastSaved.kind !== 'none' && now - lastSaved.at < SAVED_VISIBLE_MS && (
        <p className="text-[11px] text-success" data-testid="own-saved">
          ✓ {t('taskAlloc.own.saved')}
        </p>
      )}

      {qaOpen && qaQuestions.length > 0 && (
        <CompletionQaDialog
          taskName={taskName}
          targetUnits={view.target}
          scopes={qaNeed.scopes}
          questions={qaQuestions}
          busy={saving}
          onConfirm={api.confirmQa}
          onCancel={api.cancelQa}
        />
      )}
    </div>
  );
});

export default OwnProgressControl;
