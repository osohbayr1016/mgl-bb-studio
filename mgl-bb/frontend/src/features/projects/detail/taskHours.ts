/** Цагаар бодогддог засварын төслийн (`progress_mode = 'hours'`) АЖИЛЛАСАН ЦАГИЙН
 *  цэвэр туслахууд (2026-09-24).  Өгөгдөл нь `GET /api/repair/hours` —
 *  backend `lib/repairHours.ts`.  Хувь ЭНД хэзээ ч бодогдохгүй. */
import type { RepairHoursSummary } from '@/shared/types';

import type { TaskHoursInfo } from './types';

/** Хөвөгч цэгийн үлдэгдэлгүй «9.5» хэлбэр (сервер 2 оронтой бөөрөнхийлдөг). */
export function roundHours(h: number): number {
  return Number.isFinite(h) ? Math.round(h * 100) / 100 : 0;
}

/** `summary.tasks` → task_id-аар хайх Map (мөр бүр O(1)). */
export function taskHoursMap(summary: RepairHoursSummary | undefined): Map<number, TaskHoursInfo> {
  const map = new Map<number, TaskHoursInfo>();
  for (const t of summary?.tasks ?? []) {
    map.set(t.task_id, {
      hours: t.hours,
      people: t.people.map((p) => ({ user_id: p.user_id, full_name: p.full_name, hours: p.hours })),
    });
  }
  return map;
}

/** Олон таскийн цагийн нийлбэр (блок / зураг / бүрдлийн толгой). */
export function sumHoursOfTasks(
  taskIds: Iterable<number>,
  map: ReadonlyMap<number, TaskHoursInfo> | undefined,
): number {
  if (!map) return 0;
  let s = 0;
  for (const id of taskIds) s += map.get(id)?.hours ?? 0;
  return roundHours(s);
}
