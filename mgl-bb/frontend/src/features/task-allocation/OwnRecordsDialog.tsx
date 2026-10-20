/* МИНИЙ БҮРТГЭЛ — явцын түүхэн хэсгийг хүчингүй болгох / сэргээх, цагийн сэшнийг хүчингүй болгох / сэргээх (2026-10-02).
 *
 *   Явц:  ердийн «−» нь хуваалтаар түгжигдсэн доод хязгаараас доош орохгүй.  Харин ӨӨРИЙН ТҮҮХЭН бүртгэлийг
 *         (алдаатай бичсэн хэсгийг) ЭНД тусад нь, ИЛ ТАЙЛБАРТАЙ хүчингүй болгоно:
 *           — таны хийсэн хэмжээ буурна; тэр хэсэгт АНХНЫ өдөр олгосон оноо ӨӨРИЙН өдрөөр нь буцаагдана
 *             (өнөөдрийн жин/зорилтоор дахин бодохгүй);
 *           — бусдын хийсэн, оноо, цаг, хуваарилалт ХӨНДӨГДӨХГҮЙ; ажил 100% байсан бол дахин нээгдэнэ;
 *           — бичлэг УСТАХГҮЙ: «Сэргээх»-ээр буцаана (ШИНЭ хуулбар оноо олгогдохгүй).
 *   Цаг:  сэшн УСТАХГҮЙ, аудитад үлдэнэ; тоологдохгүй; «Сэргээх» боломжтой.  Явц, оноо автоматаар устахгүй. */
import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { History, Loader2, RotateCcw, Undo2 } from 'lucide-react';

import { Badge } from '@/ui/badge';
import { Button } from '@/ui/button';
import { Checkbox } from '@/ui/checkbox';
import { Input } from '@/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/ui/dialog';
import { apiFetch, ApiError } from '@/shared/api/client';
import { useApiQuery } from '@/shared/api/useApi';
import { confirmDialog } from '@/shared/components/ConfirmDialog';
import { toast } from '@/shared/components/Toast';
import { useAuth } from '@/shared/context/AuthContext';
import { useLanguage } from '@/shared/i18n';
import { formatDateTime, todayUB } from '@/shared/lib/time';
import { cn } from '@/shared/lib/utils';
import { endNoteKey, OFFICIAL_TIMER_STATE_KEY } from '@/features/task-timer/officialTimer';

import { CompletionQaDialog } from './CompletionQaDialog';
import { newRequestId, postCorrect, postRestore, toFailure } from './api';
import { useAllocationOverview, useOwnRecords } from './hooks';
import { invalidateAfterProgress } from './ownProgressStore';
import type { QaQuestion } from './types';
import { useAttempt } from './useAttempt';
import { formatUnits, parseUnits } from './units';

interface DaysResponse {
  days: Array<{
    sessions: Array<{
      id: number;
      task_id: number;
      started_at: string;
      ended_at: string | null;
      end_reason: string | null;
      end_note?: string | null;
      voided?: boolean;
    }>;
  }>;
}

const DAYS = 14;

function isoAddDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export function OwnRecordsDialog({
  task,
  onClose,
}: {
  task: { id: number; name: string };
  onClose: () => void;
}) {
  const { t } = useLanguage();
  const overview = useAllocationOverview(task.id);
  const records = useOwnRecords(task.id);
  const data = overview.data;
  const rec = records.data;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-xl" onClick={(e) => e.stopPropagation()}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <History className="h-4 w-4 text-primary" />
            {t('taskAlloc.records.title')}
          </DialogTitle>
          <DialogDescription>{task.name}</DialogDescription>
        </DialogHeader>
        {!data || !rec ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
          </div>
        ) : (
          <div className="max-h-[62vh] space-y-5 overflow-y-auto pr-1">
            {data.root && data.me ? (
              <>
                <ProgressSection task={task} overview={data} records={rec} />
                <CorrectionsSection task={task} overview={data} records={rec} />
              </>
            ) : (
              <p className="text-xs text-muted-foreground">{t('taskAlloc.records.notManaged')}</p>
            )}
            <SessionsSection taskId={task.id} />
          </div>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            {t('common.close')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/*  Явцын түүхэн хэсгүүд                                                */
/* ------------------------------------------------------------------ */

type Overview = NonNullable<ReturnType<typeof useAllocationOverview>['data']>;
type Records = NonNullable<ReturnType<typeof useOwnRecords>['data']>;

function ProgressSection({ task, overview, records }: { task: { id: number; name: string }; overview: Overview; records: Records }) {
  const { t } = useLanguage();
  const attempt = useAttempt();
  const root = overview.root!;
  const me = overview.me!;
  // Сонгосон хэсэг → хүчингүй болгох хэмжээ (текст, ХАТУУ задлалт).
  const [picked, setPicked] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const rows = records.slices;
  const items = useMemo(() => {
    const out: Array<{ slice_id: number; units: number; credit: number; ok: boolean }> = [];
    for (const s of rows) {
      const text = picked[s.id];
      if (text === undefined) continue;
      const parsed = parseUnits(text, s.units_open);
      const units = parsed.ok ? parsed.units : 0;
      const credit = s.units_open > 0 ? (s.credit_open_amount * units) / s.units_open : 0;
      out.push({ slice_id: s.id, units, credit, ok: parsed.ok && units > 0 });
    }
    return out;
  }, [rows, picked]);

  const allOk = items.length > 0 && items.every((i) => i.ok);
  const sumUnits = items.reduce((s, i) => s + (i.ok ? i.units : 0), 0);
  const sumCredit = items.reduce((s, i) => s + (i.ok ? i.credit : 0), 0);

  const submit = async () => {
    if (!allOk) return;
    const ok = await confirmDialog({
      title: t('taskAlloc.records.confirmTitle'),
      description: t('taskAlloc.records.confirmBody', {
        units: formatUnits(sumUnits),
        credit: round2(sumCredit),
      }),
      confirmText: t('taskAlloc.records.invalidate'),
      variant: 'destructive',
    });
    if (!ok) return;
    setBusy(true);
    setError(null);
    try {
      const payload = items.map((i) => ({ slice_id: i.slice_id, units: i.units }));
      const id = attempt(JSON.stringify([root.revision, payload]));
      const res = await postCorrect(task.id, { requestId: id, expectedRevision: root.revision }, payload);
      invalidateAfterProgress();
      toast.success(
        t('taskAlloc.records.done', { units: formatUnits(res.reversed_units), credit: round2(res.reversed.amount) }),
      );
      setPicked({});
    } catch (err) {
      const f = toFailure(err);
      setError(f.code === 'STALE_REVISION' ? t('taskAlloc.editor.srv.stale') : f.message || t('taskAlloc.err.generic'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="space-y-2" data-testid="records-progress">
      <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {t('taskAlloc.records.progressHeading')}
      </h4>
      <p className="text-xs text-muted-foreground">
        {t('taskAlloc.records.progressHint', { done: formatUnits(me.done_units), floor: formatUnits(me.floor_units) })}
      </p>
      {rows.length === 0 ? (
        <p className="py-2 text-xs text-muted-foreground">{t('taskAlloc.records.noSlices')}</p>
      ) : (
        <ul className="space-y-1.5">
          {rows.map((s) => {
            const checked = picked[s.id] !== undefined;
            const parsed = checked ? parseUnits(picked[s.id] ?? '', s.units_open) : null;
            const bad = checked && !(parsed?.ok && parsed.units > 0);
            return (
              <li key={s.id} className="flex flex-wrap items-center gap-2 rounded-md border border-border/50 px-2 py-1.5" data-testid="records-slice">
                <Checkbox
                  checked={checked}
                  disabled={busy}
                  aria-label={t('taskAlloc.records.pick')}
                  onCheckedChange={(v) =>
                    setPicked((p) => {
                      const next = { ...p };
                      if (v) next[s.id] = formatUnits(s.units_open);
                      else delete next[s.id];
                      return next;
                    })
                  }
                />
                <span className="text-xs tabular-nums text-muted-foreground">{s.work_date}</span>
                <span className="text-sm font-medium tabular-nums">+{formatUnits(s.units_open)}%</span>
                {s.legacy && (
                  <Badge variant="outline" className="h-4 px-1.5 text-[10px]">
                    {t('taskAlloc.records.legacy')}
                  </Badge>
                )}
                <span className="text-[11px] text-muted-foreground">
                  {t('taskAlloc.records.credit', { credit: round2(s.credit_open_amount) })}
                </span>
                {checked && (
                  <span className="ml-auto flex items-center gap-1">
                    <Input
                      inputMode="decimal"
                      aria-label={t('taskAlloc.records.amount')}
                      aria-invalid={bad}
                      className={cn('h-7 w-20 text-right tabular-nums', bad && 'border-destructive text-destructive')}
                      value={picked[s.id] ?? ''}
                      disabled={busy}
                      onChange={(e) => setPicked((p) => ({ ...p, [s.id]: e.target.value }))}
                    />
                    <span className="text-xs text-muted-foreground">%</span>
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {items.length > 0 && (
        <div className="space-y-1 rounded-md bg-muted/40 px-3 py-2 text-xs" data-testid="records-preview">
          <p>
            {t('taskAlloc.records.preview', {
              from: formatUnits(me.done_units),
              to: formatUnits(Math.max(0, me.done_units - sumUnits)),
              credit: round2(sumCredit),
            })}
          </p>
          {root.complete && <p className="text-warning">{t('taskAlloc.records.reopens')}</p>}
          <p className="text-muted-foreground">{t('taskAlloc.records.othersUntouched')}</p>
        </div>
      )}
      {error && (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      )}
      <div className="flex justify-end">
        <Button
          size="sm"
          variant="outline"
          className="gap-1 border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
          disabled={!allOk || busy}
          onClick={() => void submit()}
          data-testid="records-invalidate"
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Undo2 className="h-3.5 w-3.5" />}
          {t('taskAlloc.records.invalidate')}
        </Button>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/*  Хүчингүй болгосон — сэргээж болох                                   */
/* ------------------------------------------------------------------ */

function CorrectionsSection({ task, overview, records }: { task: { id: number; name: string }; overview: Overview; records: Records }) {
  const { t } = useLanguage();
  const attempt = useAttempt();
  const root = overview.root!;
  const [busyId, setBusyId] = useState<string | null>(null);
  const [qa, setQa] = useState<{ correctionId: string; questions: QaQuestion[]; scopes: { own: boolean; root: boolean } } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async (correctionId: string, answers: Record<string, string> | null) => {
    setBusyId(correctionId);
    setError(null);
    try {
      const id = attempt(JSON.stringify([root.revision, correctionId, answers]));
      const res = await postRestore(
        task.id,
        { requestId: id, expectedRevision: root.revision },
        { correction_request_id: correctionId, completion_qa: answers },
      );
      invalidateAfterProgress();
      setQa(null);
      toast.success(t('taskAlloc.records.restored', { units: formatUnits(res.restored_units) }));
    } catch (err) {
      const f = toFailure(err);
      if (f.code === 'completion_qa required') {
        setQa({
          correctionId,
          questions: f.extra.questions ?? [],
          scopes: f.extra.scopes ?? { own: true, root: false },
        });
      } else {
        setError(
          f.code === 'STALE_REVISION' ? t('taskAlloc.editor.srv.stale') : f.message || t('taskAlloc.err.generic'),
        );
      }
    } finally {
      setBusyId(null);
    }
  };

  if (records.corrections.length === 0) return null;
  return (
    <section className="space-y-2" data-testid="records-corrections">
      <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {t('taskAlloc.records.restoreHeading')}
      </h4>
      <ul className="space-y-1.5">
        {records.corrections.map((c) => (
          <li key={c.request_id} className="flex flex-wrap items-center gap-2 rounded-md border border-border/50 px-2 py-1.5" data-testid="records-correction">
            <span className="text-xs tabular-nums text-muted-foreground">{formatDateTime(c.recorded_at)}</span>
            <span className="text-sm font-medium tabular-nums">−{formatUnits(c.units)}%</span>
            <span className="text-[11px] text-muted-foreground">
              {t('taskAlloc.records.credit', { credit: round2(c.credit_amount) })}
            </span>
            <Button
              size="sm"
              variant="ghost"
              className="ml-auto h-7 gap-1 px-2 text-xs"
              disabled={busyId !== null}
              onClick={() => void run(c.request_id, null)}
              data-testid="records-restore"
            >
              {busyId === c.request_id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
              {t('taskAlloc.records.restore')}
            </Button>
          </li>
        ))}
      </ul>
      {error && (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      )}
      {qa && (
        <CompletionQaDialog
          taskName={task.name}
          targetUnits={overview.me?.target_units ?? 0}
          scopes={qa.scopes}
          questions={qa.questions}
          busy={busyId !== null}
          onConfirm={(answers) => void run(qa.correctionId, answers)}
          onCancel={() => setQa(null)}
        />
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/*  Цагийн сэшн                                                          */
/* ------------------------------------------------------------------ */

function SessionsSection({ taskId }: { taskId: number }) {
  const { t } = useLanguage();
  const { user } = useAuth();
  const qc = useQueryClient();
  const me = user?.id ?? 0;
  const to = todayUB();
  const from = isoAddDays(to, -(DAYS - 1));
  const key = ['/task-timer/days', me, from, to] as const;
  const q = useApiQuery<DaysResponse>(key, `/task-timer/users/${me}/days?from=${from}&to=${to}`, {
    enabled: me > 0,
    retry: false,
  });
  const [busyId, setBusyId] = useState<number | null>(null);

  const sessions = useMemo(() => {
    const seen = new Set<number>();
    const out: DaysResponse['days'][number]['sessions'] = [];
    for (const d of q.data?.days ?? []) {
      for (const s of d.sessions) {
        if (s.task_id !== taskId || seen.has(s.id)) continue;
        seen.add(s.id);
        out.push(s);
      }
    }
    return out.sort((a, b) => (a.started_at < b.started_at ? 1 : -1));
  }, [q.data, taskId]);

  const act = async (id: number, kind: 'void' | 'restore') => {
    if (kind === 'void') {
      const ok = await confirmDialog({
        title: t('taskAlloc.sessions.voidTitle'),
        description: t('taskAlloc.sessions.voidBody'),
        confirmText: t('taskAlloc.sessions.void'),
        variant: 'destructive',
      });
      if (!ok) return;
    }
    setBusyId(id);
    try {
      await apiFetch(`/task-timer/sessions/${id}/${kind}`, { method: 'POST', data: { request_id: newRequestId() } });
      toast.success(kind === 'void' ? t('taskAlloc.sessions.voided') : t('taskAlloc.sessions.restored'));
      void qc.invalidateQueries({ queryKey: ['/task-timer/days'] });
      void qc.invalidateQueries({ queryKey: OFFICIAL_TIMER_STATE_KEY });
      invalidateAfterProgress();
    } catch (err) {
      const msg =
        err instanceof ApiError && typeof err.payload.message === 'string' ? err.payload.message : t('taskAlloc.err.generic');
      toast.error(t('taskTimer.errTitle'), msg);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section className="space-y-2" data-testid="records-sessions">
      <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {t('taskAlloc.sessions.heading')}
      </h4>
      <p className="text-xs text-muted-foreground">{t('taskAlloc.sessions.hint')}</p>
      {q.isLoading ? (
        <Loader2 className="h-4 w-4 animate-spin text-primary" />
      ) : sessions.length === 0 ? (
        <p className="py-1 text-xs text-muted-foreground">{t('taskAlloc.sessions.none')}</p>
      ) : (
        <ul className="space-y-1.5">
          {sessions.map((s) => (
            <li
              key={s.id}
              className={cn('flex flex-wrap items-center gap-2 rounded-md border border-border/50 px-2 py-1.5 text-xs', s.voided && 'opacity-60')}
              data-testid="records-session"
              data-voided={s.voided ? '1' : '0'}
            >
              <span className={cn('font-mono tabular-nums', s.voided && 'line-through')}>
                {formatDateTime(s.started_at).slice(5)} → {s.ended_at ? formatDateTime(s.ended_at).slice(11) : t('taskTimer.dayRunning')}
              </span>
              {s.end_note && endNoteKey(s.end_note) && (
                <span className="text-muted-foreground">· {t(endNoteKey(s.end_note) as string)}</span>
              )}
              {s.voided && (
                <Badge variant="outline" className="h-4 px-1.5 text-[10px]">
                  {t('taskAlloc.sessions.voidedBadge')}
                </Badge>
              )}
              <Button
                size="sm"
                variant="ghost"
                className="ml-auto h-7 px-2 text-xs"
                disabled={busyId !== null}
                onClick={() => void act(s.id, s.voided ? 'restore' : 'void')}
                data-testid={s.voided ? 'session-restore' : 'session-void'}
              >
                {busyId === s.id && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
                {s.voided ? t('taskAlloc.sessions.restore') : t('taskAlloc.sessions.void')}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export default OwnRecordsDialog;
