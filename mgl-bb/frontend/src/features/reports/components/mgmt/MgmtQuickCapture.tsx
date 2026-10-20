import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, m } from 'motion/react';
import { Check, History, Loader2, Pencil, Plus, RotateCcw, Trash2, Undo2 } from 'lucide-react';
import { useLanguage } from '@/shared/i18n';
import { apiFetch, ApiError } from '@/shared/api/client';
import { useApiQuery } from '@/shared/api/useApi';
import { toast } from '@/shared/components/Toast';
import { cn } from '@/shared/lib/utils';
import { SPRING } from '@/shared/lib/motion';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import { textToItems } from '@/features/daily-log/lib';
import { MGMT_LOGS_KEY } from '../../api';
import { applyReplace, locateBlock, type ReplaceOp } from '../../lib/mgmtFeed';

/**
 * «Өдрийн тайлан» хадгалах ЦОРЫН ГАНЦ газар хэвээр — `/daily-work-logs/:date`
 * (миграц 0345).  Энд шинэ хадгалалт БАЙХГҮЙ: нэмэх, засах, устгах, буцаах нь
 * бүгд «өдрийн жагсаалтын нэг хэсгийг солих» үйлдэл (`ReplaceOp`) бөгөөд
 * серверийн ХАМГИЙН СҮҮЛИЙН жагсаалт дээр хэрэгжиж ижил PUT-аар хадгалагдана —
 * өмнөх хувилбар `daily_work_log_revisions`-д үлдэх, «нөхөж бичсэн» тэмдэг,
 * засах тоолуур бүгд хэвээр.  Профайлын засварлагчтай ИЖИЛ query key
 * (`['/daily-work-logs', 'day', date]`) тул нэг газар хадгалсан нь нөгөөд харагдана.
 *
 * Үйлдлүүд ДАРААЛЛААР явна; дэлгэц = серверийн хадгалсан жагсаалт + хүлээгдэж
 * буй үйлдлүүд (optimistic).  Алдаа гарвал тэр үйлдэл л хасагдаж, өдрийн
 * жагсаалтыг серверээс дахин уншина.  Өдрийн СҮҮЛИЙН мөрийг устгахгүй — сервер
 * хоосон тайланг хүлээж авдаггүй (`EMPTY`), өдрийн тайлан устгах зам ч байхгүй.
 */
const LOG_KEY = '/daily-work-logs';
/** backend `lib/dailyWorkLog.ts MAX_ITEMS`. */
const MAX_ITEMS = 50;
const UNDO_MS = 8000;

interface DayResponse {
  log: { items: string[]; updated_at: string; edit_count: number } | null;
}

interface Job {
  id: number;
  /** Үйлдэл үүссэн агшны УБ огноо — шөнө дунд давсан ч зөв өдөрт бичнэ. */
  day: string;
  kind: 'add' | 'edit' | 'remove' | 'undo';
  op: ReplaceOp;
}

interface Row {
  text: string;
  pending: boolean;
}

function applyRows(rows: Row[], op: ReplaceOp): Row[] {
  const i = locateBlock(
    rows.map((r) => r.text),
    op.index,
    op.expected,
  );
  if (i == null) return rows;
  return [
    ...rows.slice(0, i),
    ...op.next.map((text) => ({ text, pending: true })),
    ...rows.slice(i + op.expected.length),
  ];
}

export function MgmtQuickCapture({
  today,
  syncToday,
  variant = 'inline',
}: {
  today: string;
  /** Яг одоогийн УБ огноо (шөнө дунд давсан бол «өнөөдөр»-ийг шинэчилнэ). */
  syncToday: () => string;
  /**
   * `inline` — Тайлан хуудасны толгой (оролт дээр, жагсаалт доор).
   * `note` — баруун доод булангийн тэмдэглэл (жагсаалт дээр гүйлгэгдэнэ, оролт доор, шууд фокус).
   */
  variant?: 'inline' | 'note';
}) {
  const { t } = useLanguage();
  const qc = useQueryClient();
  const dayQuery = useApiQuery<DayResponse>([LOG_KEY, 'day', today], `/daily-work-logs/${today}`, {
    retry: false,
  });

  const [text, setText] = useState('');
  const [jobs, setJobs] = useState<Job[]>([]);
  /** Сая хадгалагдсан мөрүүд — түр тодорно. */
  const [flash, setFlash] = useState<{ from: number; n: number } | null>(null);
  const [justSaved, setJustSaved] = useState(false);
  /** Сүүлд нэмсэн мөрүүдийг буцаах боломж (UNDO_MS хугацаанд). */
  const [undo, setUndo] = useState<{ day: string; index: number; texts: string[] } | null>(null);
  const [editing, setEditing] = useState<{ index: number; orig: string; value: string } | null>(
    null,
  );
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const chain = useRef<Promise<void>>(Promise.resolve());
  const inflight = useRef(0);
  const nextId = useRef(1);

  useEffect(() => {
    if (flash == null) return;
    const id = window.setTimeout(() => setFlash(null), 1400);
    return () => window.clearTimeout(id);
  }, [flash]);
  useEffect(() => {
    if (!justSaved) return;
    const id = window.setTimeout(() => setJustSaved(false), 1200);
    return () => window.clearTimeout(id);
  }, [justSaved]);
  useEffect(() => {
    if (!undo) return;
    const id = window.setTimeout(() => setUndo(null), UNDO_MS);
    return () => window.clearTimeout(id);
  }, [undo]);

  const saved = useMemo(() => dayQuery.data?.log?.items ?? [], [dayQuery.data]);
  const rows = useMemo(
    () =>
      jobs
        .filter((j) => j.day === today)
        .reduce<Row[]>(
          (acc, j) => applyRows(acc, j.op),
          saved.map((s) => ({ text: s, pending: false })),
        ),
    [jobs, saved, today],
  );
  const busy = jobs.length > 0;
  const savedCount = rows.filter((r) => !r.pending).length;

  const persist = async (job: Job) => {
    const url = `/daily-work-logs/${job.day}`;
    // Өөр таб/профайлаас нэмсэн мөрийг дарахгүйн тулд ХАМГИЙН СҮҮЛИЙН хувилбар дээр хэрэгжүүлнэ.  Уншсанаас хойш
    // өөр газраас хадгалсан бол сервер 409 STALE_LOG (`base_edit_count`) → дахин уншиж op-оо шинэ хувилбар дээр давтана.
    for (let attempt = 0; ; attempt++) {
      const freshLog = (await apiFetch<DayResponse>(url)).log ?? null;
      const fresh = freshLog?.items ?? [];
      const next = applyReplace(fresh, job.op);
      if (!next) throw new ApiError(409, t('mgmtLogs.captureConflict'));
      if (next.length === 0) throw new ApiError(400, t('mgmtLogs.captureLastItem'));
      if (next.length > MAX_ITEMS) {
        throw new ApiError(400, t('mgmtLogs.captureTooMany', { max: MAX_ITEMS }));
      }
      try {
        const res = await apiFetch<DayResponse>(url, {
          method: 'PUT',
          data: { items: next, base_edit_count: freshLog ? freshLog.edit_count : null },
        });
        qc.setQueryData<DayResponse>([LOG_KEY, 'day', job.day], (old) => ({
          ...(old ?? {}),
          log: res.log,
        }));
        return { at: locateBlock(fresh, job.op.index, job.op.expected) ?? fresh.length };
      } catch (e) {
        const stale = e instanceof ApiError && e.status === 409 && e.code === 'STALE_LOG';
        if (!stale || attempt >= 2) throw stale ? new ApiError(409, t('mgmtLogs.captureConflict')) : e;
      }
    }
  };

  const enqueue = (job: Omit<Job, 'id'>, onFail?: () => void) => {
    const full: Job = { ...job, id: nextId.current++ };
    setJobs((js) => [...js, full]);
    inflight.current++;
    chain.current = chain.current.then(async () => {
      try {
        const { at } = await persist(full);
        if (full.kind === 'add' || full.kind === 'edit') {
          setFlash({ from: at, n: full.op.next.length });
        }
        if (full.kind === 'add') {
          setUndo({ day: full.day, index: at, texts: [...full.op.next] });
        }
        setJustSaved(true);
      } catch (err) {
        toast.error(t('mgmtLogs.captureFailed'), err instanceof ApiError ? err.message : undefined);
        onFail?.();
        void qc.invalidateQueries({ queryKey: [LOG_KEY, 'day', full.day] });
      } finally {
        setJobs((js) => js.filter((x) => x.id !== full.id));
        inflight.current--;
        // Дараалал хоосорсон үед л бусад кэшийг сэргээнэ — дунд нь хуучин хариу
        // optimistic мөрийг түр арилгахгүй.
        if (inflight.current === 0) {
          void qc.invalidateQueries({ queryKey: [LOG_KEY] });
          void qc.invalidateQueries({ queryKey: [...MGMT_LOGS_KEY] });
        }
      }
    });
  };

  const add = (e?: FormEvent) => {
    e?.preventDefault();
    const texts = textToItems(text);
    if (texts.length === 0) {
      inputRef.current?.focus();
      return;
    }
    if (rows.length + texts.length > MAX_ITEMS) {
      toast.error(t('mgmtLogs.captureTooMany', { max: MAX_ITEMS }));
      return;
    }
    // Бичих агшны огноо: шөнө дунд давсан бол «өнөөдөр» мөн шинэчлэгдэнэ.
    const day = syncToday();
    setText('');
    setUndo(null);
    inputRef.current?.focus();
    enqueue({ day, kind: 'add', op: { index: Infinity, expected: [], next: texts } }, () =>
      // Буцаалт: бичсэн бичвэр алдагдахгүй — оролт хоосон бол буцааж тавина.
      setText((cur) => (cur.trim() === '' ? texts.join('\n') : cur)),
    );
  };

  const remove = (index: number) => {
    const row = rows[index];
    if (!row || row.pending || savedCount <= 1) return;
    setUndo(null);
    enqueue({ day: today, kind: 'remove', op: { index, expected: [row.text], next: [] } });
  };

  const commitEdit = () => {
    if (!editing) return;
    const { index, orig, value } = editing;
    setEditing(null);
    const next = textToItems(value);
    if (next.length === 1 && next[0] === orig) return;
    if (next.length === 0) {
      if (savedCount <= 1) {
        toast.error(t('mgmtLogs.captureLastItem'));
        return;
      }
      enqueue({ day: today, kind: 'remove', op: { index, expected: [orig], next: [] } });
      return;
    }
    setUndo(null);
    enqueue({ day: today, kind: 'edit', op: { index, expected: [orig], next } });
  };

  const undoLast = () => {
    if (!undo) return;
    const u = undo;
    setUndo(null);
    enqueue({ day: u.day, kind: 'undo', op: { index: u.index, expected: u.texts, next: [] } });
  };

  const onEditKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing) return;
    if (e.key === 'Enter') {
      e.preventDefault();
      commitEdit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setEditing(null);
    }
  };

  // Сүүлд нэмсэн мөрүүд ӨӨР өдрийн бол, эсвэл бүх мөрийг арилгах бол буцаах товч гарахгүй.
  const canUndo = !!undo && undo.day === today && savedCount > undo.texts.length && !busy;
  const disabled = dayQuery.isLoading || dayQuery.isError;

  // Тэмдэглэл: шинэ мөр нэмэгдэхэд хамгийн доод мөр харагдана; нээгдмэгц шууд бичнэ.
  const rowCount = rows.length;
  useEffect(() => {
    if (variant !== 'note') return;
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [variant, rowCount]);
  useEffect(() => {
    if (variant === 'note' && !disabled) inputRef.current?.focus();
  }, [variant, disabled]);

  const formEl = (
      <form onSubmit={add} className="flex items-center gap-2">
        <label htmlFor="mgmt-capture" className="sr-only">
          {t('mgmtLogs.captureTitle')}
        </label>
        <div className="relative min-w-0 flex-1">
          <Input
            id="mgmt-capture"
            ref={inputRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={t('mgmtLogs.capturePlaceholder')}
            maxLength={2000}
            autoComplete="off"
            enterKeyHint="send"
            disabled={disabled}
            className="h-11 rounded-xl border-border/70 bg-background/70 pr-10 text-base shadow-sm backdrop-blur transition-shadow focus-visible:shadow-md md:text-sm"
          />
          <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center">
            <AnimatePresence mode="wait" initial={false}>
              {busy ? (
                <m.span
                  key="busy"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                >
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-hidden />
                </m.span>
              ) : justSaved ? (
                <m.span
                  key="ok"
                  initial={{ opacity: 0, scale: 0.6 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0 }}
                  transition={SPRING.bouncy}
                >
                  <Check className="h-4 w-4 text-success" aria-hidden />
                </m.span>
              ) : null}
            </AnimatePresence>
          </span>
        </div>
        <Button type="submit" className="h-11 shrink-0 rounded-xl px-4" disabled={disabled}>
          <Plus className="h-4 w-4" aria-hidden />
          <span className="hidden sm:inline">{t('mgmtLogs.captureAdd')}</span>
          <span className="sr-only sm:hidden">{t('mgmtLogs.captureAdd')}</span>
        </Button>
      </form>
  );

  const statusEl = (
      <div className="flex min-h-6 flex-wrap items-center justify-between gap-x-3 gap-y-1 text-micro text-muted-foreground">
        <span className="flex items-center gap-2" aria-live="polite">
          {busy
            ? t('mgmtLogs.captureSaving')
            : rows.length > 0
              ? t('mgmtLogs.captureTodayCount', { count: rows.length })
              : t('mgmtLogs.captureHint')}
          <AnimatePresence>
            {canUndo && (
              <m.span
                key="undo"
                initial={{ opacity: 0, x: -4 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.15 }}
              >
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  onClick={undoLast}
                  className="text-primary hover:text-primary"
                >
                  <Undo2 aria-hidden />
                  {t('mgmtLogs.captureUndo')}
                </Button>
              </m.span>
            )}
          </AnimatePresence>
        </span>
        <Link
          to="/app/profile?tab=worklog"
          className="inline-flex items-center gap-1 rounded-md hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
        >
          <History className="h-3.5 w-3.5" aria-hidden />
          {t('mgmtLogs.captureEdit')}
        </Link>
      </div>

  );

  const listEl = dayQuery.isError ? (
        <div className="flex items-center gap-2 text-sm text-destructive">
          {t('mgmtLogs.captureLoadFailed')}
          <Button type="button" variant="ghost" size="xs" onClick={() => void dayQuery.refetch()}>
            <RotateCcw /> {t('mgmtLogs.captureRetry')}
          </Button>
        </div>
      ) : dayQuery.isLoading ? (
        <div className="space-y-1.5" aria-hidden>
          {[0, 1].map((i) => (
            <div key={i} className="h-5 w-2/3 animate-pulse rounded bg-muted/60" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('mgmtLogs.captureEmpty')}</p>
      ) : (
        <ol className="space-y-0.5">
          <AnimatePresence initial={false}>
            {rows.map((r, i) => {
              const isFlash = flash != null && i >= flash.from && i < flash.from + flash.n;
              const isEditing = editing?.index === i;
              const lastOne = savedCount <= 1;
              return (
                // Түлхүүр = байрлал + бичвэр: хадгалагдсан мөр pending-ээс saved руу шилжихэд
                // дахин орж ирэх animation тоглохгүй, зөвхөн өнгө нь солигдоно.
                <m.li
                  key={`${i}|${r.text}`}
                  layout="position"
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: r.pending ? 0.6 : 1, y: 0 }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.2 }}
                  className={cn(
                    'group/item flex items-center gap-2 rounded-md px-2 py-1 text-sm transition-colors duration-700',
                    isFlash ? 'bg-success/10' : r.pending ? 'bg-primary/5' : 'hover:bg-muted/40',
                  )}
                >
                  <span className="w-5 shrink-0 self-start pt-px text-right tabular-nums text-muted-foreground">
                    {i + 1}.
                  </span>
                  {isEditing ? (
                    <Input
                      autoFocus
                      aria-label={t('mgmtLogs.captureEditItem')}
                      value={editing?.value ?? ''}
                      maxLength={2000}
                      onChange={(e) =>
                        setEditing((ed) => (ed ? { ...ed, value: e.target.value } : ed))
                      }
                      onKeyDown={onEditKey}
                      onBlur={commitEdit}
                      className="h-8 min-w-0 flex-1 text-sm"
                    />
                  ) : (
                    <span className="min-w-0 flex-1 break-words">{r.text}</span>
                  )}
                  {isFlash && !isEditing && (
                    <Check className="h-3.5 w-3.5 shrink-0 text-success" aria-hidden />
                  )}
                  {!r.pending && !isEditing && (
                    <span className="flex shrink-0 items-center opacity-0 transition-opacity group-hover/item:opacity-100 focus-within:opacity-100 pointer-coarse:opacity-100">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-xs"
                        title={t('mgmtLogs.captureEditItem')}
                        aria-label={t('mgmtLogs.captureEditItem')}
                        disabled={busy}
                        onClick={() => setEditing({ index: i, orig: r.text, value: r.text })}
                      >
                        <Pencil />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-xs"
                        title={
                          lastOne ? t('mgmtLogs.captureLastItem') : t('mgmtLogs.captureRemoveItem')
                        }
                        aria-label={t('mgmtLogs.captureRemoveItem')}
                        disabled={busy || lastOne}
                        onClick={() => remove(i)}
                        className="hover:text-destructive"
                      >
                        <Trash2 />
                      </Button>
                    </span>
                  )}
                </m.li>
              );
            })}
          </AnimatePresence>
        </ol>
      );

  if (variant === 'note') {
    return (
      <div className="flex min-h-0 flex-col gap-2">
        <div ref={listRef} className="max-h-[min(50vh,22rem)] min-h-16 overflow-y-auto overscroll-contain pr-1">
          {listEl}
        </div>
        {statusEl}
        {formEl}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {formEl}
      {statusEl}
      {listEl}
    </div>
  );
}
