import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch, ApiError } from '@/shared/api/client';
import { useLanguage } from '@/shared/i18n';
import { toast } from '@/shared/components/Toast';
import {
  OFFICIAL_TIMER_STATE_KEY,
  OFFICIAL_TIMER_WORKING_KEY,
  timerErrorKey,
  type NotAllocatedInfo,
  type OfficialTimerState,
  type TakeOccupied,
  type TakeResult,
} from './officialTimer';
import {
  countedMs,
  effectiveTimer,
  keepClickStart,
  lunchRuleOf,
  type LunchRule,
  type OptimisticAction,
} from './stopwatch';
import { serverNowMs, syncLunch, syncServerClock } from './timerClock';

/** Нэг хөтчийн олон таб хооронд шууд мэдээлэх суваг (поллингоос гадна). */
const CHANNEL = 'mgl-official-task-timer';

/** Сервертэй тулгах давтамж — секунд бүр ХҮСЭЛТ явуулахгүй (харагдах тоо нь
 *  локал тооцоо).  Далд табд react-query өөрөө зогсооно. */
const RECONCILE_MS = 15_000;

/** Энэ табд ▶ дарсан агшин (сэшн → серверийн мс) — дэлгэц хойш үсрэхгүйн тулд.
 *  Модулийн түвшинд: хуудас солиход ч (хяналтын самбар ↔ Миний ажлууд) хэвээр. */
const clickStarts = new Map<number, number>();

/** Энэ хөтчийн бусад табуудад (болон энэ табын бусад hook-д) «төлөв өөрчлөгдлөө». */
export function notifyOtherTabs(): void {
  try {
    const ch = new BroadcastChannel(CHANNEL);
    ch.postMessage('changed');
    ch.close();
  } catch {
    /* BroadcastChannel байхгүй хөтөч — поллинг хангалттай */
  }
}

async function fetchState(path: string, init?: Parameters<typeof apiFetch>[1]) {
  const res = await apiFetch<OfficialTimerState>(path, init);
  syncServerClock(res.server_now);
  syncLunch(res.lunch);
  return res;
}

export interface OfficialTimerApi {
  /** Серверийн төлөв ирээгүй (ачаалж буй / алдаа) бол undefined — товч нуугдана. */
  state: OfficialTimerState | undefined;
  /** Дэлгэц дээр одоо явж буй таск (товч дармагц шууд) ба түүний эхлэл. */
  running: { task_id: number; since: number; task_name: string | null; project_name: string | null } | null;
  /** Таскийн ДУУССАН албан цаг (мс) — дөнгөж ⏸/сэлгэсэн таскийн хөлдсөн хэсэг орно. */
  closedMs: (taskId: number) => number;
  /** Өнөөдрийн ДУУССАН нийлбэр (мс) ба өнөөдрийн эхлэл (серверийн мс). */
  todayClosedMs: number;
  dayStartMs: number;
  /** Цайны цонх (ирцийн тохиргоо) — энэ хооронд албан цаг тоологдохгүй; null = унтраасан. */
  lunch: LunchRule | null;
  start: (taskId: number, taskName?: string, projectName?: string) => void;
  pause: (taskId?: number) => void;
  /**
   * «Өөртөө авах» (төслийн хуудас) — optimistic БИШ: эзлэгдсэн таск дээр тоолуур
   * хуурамчаар эхлэхгүйн тулд серверийн хариуг хүлээнэ.  Бусад үйлдэлтэй ижил
   * дараалалд (▶/⏸-ийн дунд буруу дараалал үүсэхгүй).  Алдаа нь toast БИШ —
   * дуудагч шийднэ (TASK_OCCUPIED → хуваах цонх).
   */
  take: (taskId: number) => Promise<TakeResult>;
}

/**
 * Ажилтны албан таймерын ганц эх сурвалж (хуудас/карт бүрт нэг удаа).
 * Товч дармагц тоолуур ШУУД эхэлнэ/зогсоно (серверийн хариуг хүлээхгүй);
 * хүсэлтүүд ДАРААЛЛААР явна (▶ ба ⏸ хурдан дарахад сервер буруу дарааллаар
 * авахгүй); хариу ирэхэд серверийн төлөвөөр солигдоно, алдаа гарвал буцна.
 */
export function useOfficialTimer(enabled = true): OfficialTimerApi {
  const { t } = useLanguage();
  const qc = useQueryClient();
  // ⚠️ `useQuery`-ээс ӨМНӨ: react-query `refetchInterval`-ийг рендерийн үед дууддаг.
  const seqRef = useRef(0);
  const chainRef = useRef<Promise<unknown>>(Promise.resolve());
  const chainBusy = useRef(0);
  const query = useQuery<OfficialTimerState, ApiError>({
    queryKey: OFFICIAL_TIMER_STATE_KEY,
    queryFn: () => fetchState('/task-timer/state'),
    enabled,
    // Хүсэлт явж байхад поллинг зогсооно — хуучин хариу шинийг дарахгүй.
    refetchInterval: () => (chainBusy.current > 0 ? false : RECONCILE_MS),
    refetchOnWindowFocus: true,
    staleTime: 5_000,
    retry: false,
  });
  const [pending, setPending] = useState<
    (OptimisticAction & { taskName?: string; projectName?: string }) | null
  >(null);

  useEffect(() => {
    if (!enabled || typeof BroadcastChannel === 'undefined') return;
    let ch: BroadcastChannel;
    try {
      ch = new BroadcastChannel(CHANNEL);
    } catch {
      return;
    }
    ch.onmessage = () => {
      void qc.invalidateQueries({ queryKey: OFFICIAL_TIMER_STATE_KEY });
      void qc.invalidateQueries({ queryKey: [OFFICIAL_TIMER_WORKING_KEY] });
      void qc.invalidateQueries({ queryKey: ['/tasks/contributors'] });
    };
    return () => ch.close();
  }, [enabled, qc]);

  const state = query.data;
  const view = effectiveTimer(state?.running ?? null, pending, clickStarts);
  const dayStartMs = state ? Date.parse(state.day_start) : 0;
  const lunchWire = state?.lunch;
  const lunch = useMemo(() => lunchRuleOf(lunchWire), [lunchWire]);

  const closedByTask = useMemo(
    () => new Map((state?.tasks ?? []).map((r) => [r.task_id, r.official_closed_ms])),
    [state],
  );
  const stopped = view.stopped;
  // Товч дармагц хөлдсөн хэсэг — серверийнхтэй ИЖИЛ дүрмээр (цайны цаг хассан).
  const closedMs = useCallback(
    (taskId: number) =>
      (closedByTask.get(taskId) ?? 0) +
      (stopped && stopped.task_id === taskId ? countedMs(stopped.since, stopped.until, lunch) : 0),
    [closedByTask, stopped, lunch],
  );
  const todayClosedMs =
    (state?.official_today_closed_ms ?? 0) +
    (stopped ? countedMs(Math.max(stopped.since, dayStartMs), stopped.until, lunch) : 0);

  const running = view.running
    ? {
        ...view.running,
        task_name:
          state?.running?.task_id === view.running.task_id
            ? state.running.task_name
            : (pending?.taskName ?? null),
        project_name:
          state?.running?.task_id === view.running.task_id
            ? state.running.project_name
            : (pending?.projectName ?? null),
      }
    : null;

  /** Хүсэлтийг өмнөхийн ДАРАА илгээнэ; хариуг хамгийн сүүлийн үйлдэл л «цэвэрлэнэ». */
  const enqueue = useCallback(
    (action: OptimisticAction & { taskName?: string; projectName?: string }, path: string, body: object) => {
      setPending(action);
      chainBusy.current += 1;
      // Дарахаас ӨМНӨ эхэлсэн поллингийн хариуг хаяна.
      void qc.cancelQueries({ queryKey: OFFICIAL_TIMER_STATE_KEY });
      const run = async () => {
        try {
          const res = await fetchState(path, { method: 'POST', data: body });
          await qc.cancelQueries({ queryKey: OFFICIAL_TIMER_STATE_KEY });
          if (
            action.taskId !== null &&
            res.running &&
            res.running.task_id === action.taskId &&
            res.outcome !== 'already_running' &&
            keepClickStart(res.running.started_at, action.atMs)
          ) {
            clickStarts.set(res.running.session_id, action.atMs);
          }
          qc.setQueryData(OFFICIAL_TIMER_STATE_KEY, res);
          notifyOtherTabs();
          // Төслийн хуудасны «Одоо хийж буй» нэр шууд шинэчлэгдэнэ (мөн хувь нэмэрчийн цаг).
          void qc.invalidateQueries({ queryKey: [OFFICIAL_TIMER_WORKING_KEY] });
          void qc.invalidateQueries({ queryKey: ['/tasks/contributors'] });
          if (res.outcome === 'switched' && action.taskId !== null) {
            toast.success(t('taskTimer.toastSwitched', { to: res.running?.task_name ?? `#${action.taskId}` }));
          }
        } catch (err) {
          const code = err instanceof ApiError ? (err.payload.error as string | undefined) : undefined;
          toast.error(t('taskTimer.errTitle'), t(timerErrorKey(code)));
          void qc.invalidateQueries({ queryKey: OFFICIAL_TIMER_STATE_KEY });
        } finally {
          chainBusy.current -= 1;
          setPending((cur) => (cur?.seq === action.seq ? null : cur));
        }
      };
      chainRef.current = chainRef.current.then(run, run);
    },
    [qc, t],
  );

  const start = useCallback(
    (taskId: number, taskName?: string, projectName?: string) => {
      seqRef.current += 1;
      enqueue({ seq: seqRef.current, taskId, atMs: serverNowMs(), taskName, projectName }, '/task-timer/start', {
        task_id: taskId,
      });
    },
    [enqueue],
  );

  const pause = useCallback(
    (taskId?: number) => {
      seqRef.current += 1;
      enqueue(
        { seq: seqRef.current, taskId: null, atMs: serverNowMs() },
        '/task-timer/pause',
        taskId === undefined ? {} : { task_id: taskId },
      );
    },
    [enqueue],
  );

  const take = useCallback(
    (taskId: number): Promise<TakeResult> =>
      new Promise<TakeResult>((resolve) => {
        chainBusy.current += 1;
        void qc.cancelQueries({ queryKey: OFFICIAL_TIMER_STATE_KEY });
        const run = async () => {
          try {
            const res = await fetchState('/task-timer/start', { method: 'POST', data: { task_id: taskId } });
            await qc.cancelQueries({ queryKey: OFFICIAL_TIMER_STATE_KEY });
            qc.setQueryData(OFFICIAL_TIMER_STATE_KEY, res);
            notifyOtherTabs();
            void qc.invalidateQueries({ queryKey: [OFFICIAL_TIMER_WORKING_KEY] });
            void qc.invalidateQueries({ queryKey: ['/tasks/contributors'] });
            const progress = Number((res as OfficialTimerState & { progress?: number }).progress) || 0;
            resolve({ ok: true, outcome: res.outcome, progress });
          } catch (err) {
            const payload = err instanceof ApiError ? err.payload : {};
            resolve({
              ok: false,
              code: typeof payload.error === 'string' ? payload.error : undefined,
              message: typeof payload.message === 'string' ? payload.message : undefined,
              occupied: (payload.occupied as TakeOccupied | null | undefined) ?? null,
              allocation: (payload.allocation as NotAllocatedInfo | null | undefined) ?? null,
            });
            void qc.invalidateQueries({ queryKey: OFFICIAL_TIMER_STATE_KEY });
            void qc.invalidateQueries({ queryKey: [OFFICIAL_TIMER_WORKING_KEY] });
          } finally {
            chainBusy.current -= 1;
          }
        };
        chainRef.current = chainRef.current.then(run, run);
      }),
    [qc],
  );

  return { state, running, closedMs, todayClosedMs, dayStartMs, lunch, start, pause, take };
}
