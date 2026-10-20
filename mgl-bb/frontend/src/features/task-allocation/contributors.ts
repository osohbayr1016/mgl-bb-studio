/**
 * ХУВЬ НЭМЭРЧИЙН ЖАГСААЛТЫН ЦЭВЭР ХЭСЭГ (2026-10-02) — серверийн мөр + «одоо ажиллаж буй»-г нэгтгэнэ.
 * Төлөв: `running` (цаг явж байна) · `paused` (түр зогссон, цагтай) · `history` (хийсэн, ирээдүйн ажилгүй) ·
 * `assigned` (хуваарилагдсан ч нотолгоо алга).  Хүний ТАНИЛТ = хэрэглэгчийн id.
 */
import type { TaskWorker } from '@/features/task-timer/officialTimer';

import type { ContributorRow } from './types';

export type ItemState = 'running' | 'paused' | 'history' | 'assigned';

export interface Item {
  userId: number;
  fullName: string | null;
  ordinal: number | null;
  done: number | null;
  target: number | null;
  state: ItemState;
  closedMs: number;
  /** Серверийн цагаар (мс) — явж буй бол. */
  since: number | null;
  repairHours: number;
  runningWorker: TaskWorker | null;
}

export function stateOf(row: ContributorRow | undefined, runningNow: boolean): ItemState {
  if (runningNow) return 'running';
  if (!row) return 'paused';
  if (row.allocation_status !== null) {
    if (row.allocation_status === 'active') return row.contributor ? 'paused' : 'assigned';
    return 'history';
  }
  // Хуваарилагдаагүй (managed биш) таск: цагтай бол түр зогссон, зөвхөн явцтай бол «хийсэн».
  return row.official_closed_ms > 0 ? 'paused' : 'history';
}

export function buildItems(rows: readonly ContributorRow[], running: readonly TaskWorker[], taskId: number): Item[] {
  const runningBy = new Map(running.map((w) => [w.user_id, w]));
  const seen = new Set<number>();
  const out: Item[] = [];
  for (const r of rows) {
    seen.add(r.user_id);
    const live = runningBy.get(r.user_id) ?? null;
    const runningNow = r.running_since !== null || live !== null;
    // Админ зогсоох товчонд хэрэгтэй `TaskWorker` — «одоо ажиллаж буй» жагсаалт ачаалагдаагүй байсан ч мөрөөс гаргана.
    const worker: TaskWorker | null =
      live ??
      (r.running_since !== null
        ? { task_id: taskId, user_id: r.user_id, full_name: r.full_name, profile_image: r.profile_image }
        : null);
    out.push({
      userId: r.user_id,
      fullName: r.full_name,
      ordinal: r.ordinal,
      done: r.done_units,
      target: r.target_units,
      state: stateOf(r, runningNow),
      closedMs: r.official_closed_ms,
      since: r.running_since ? Date.parse(r.running_since) : null,
      repairHours: r.repair_hours,
      runningWorker: worker,
    });
  }
  // Дөнгөж эхэлсэн (жагсаалт шинэчлэгдээгүй) хүн — нэр л.
  for (const w of running) {
    if (seen.has(w.user_id)) continue;
    out.push({
      userId: w.user_id,
      fullName: w.full_name,
      ordinal: null,
      done: null,
      target: null,
      state: 'running',
      closedMs: 0,
      since: null,
      repairHours: 0,
      runningWorker: w,
    });
  }
  return out;
}
