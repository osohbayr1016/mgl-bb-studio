/**
 * Таскийн хуваарилалтын хаалтын төлөв (React тал) — `shared/api/taskAllocContract.ts`-ийн store-ыг уншина.
 * `writable` = мэдэгдэхгүй (хараахан толгой ирээгүй) эсвэл `enabled`.  Энэ нь ЗӨВХӨН UX: товчийг идэвхгүй болгож шалтгааныг
 * харуулна; шийдвэр серверийнх (423/426).
 */
import { useSyncExternalStore } from 'react';

import {
  isGateWritable,
  taskAllocGateStore,
  type TaskAllocGateSnapshot,
} from '@/shared/api/taskAllocContract';

const SERVER_SNAPSHOT: TaskAllocGateSnapshot = { state: null, block: null };

export function useTaskAllocGate(): TaskAllocGateSnapshot & { writable: boolean } {
  const snap = useSyncExternalStore(taskAllocGateStore.subscribe, taskAllocGateStore.getSnapshot, () => SERVER_SNAPSHOT);
  return { ...snap, writable: isGateWritable(snap) && snap.block?.kind !== 'client_older' };
}
