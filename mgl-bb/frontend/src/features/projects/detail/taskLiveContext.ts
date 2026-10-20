/* «Одоо хийж буй» context-ийн төрөл ба уншигч (`taskLive.tsx` provider).  Тусдаа файл:
 * Хуваарилалтын цонх ↔ provider тойрог импортгүй, react-refresh зөвхөн компонент экспорт. */
import { createContext, useContext } from 'react';

import type { TaskWorker } from '@/features/task-timer/officialTimer';
import type { OfficialTimerApi } from '@/features/task-timer/useOfficialTimer';
import type { ContributorRow, ManagedSummary, QaQuestion } from '@/features/task-allocation/types';

import type { FlatTask } from './types';

export interface TaskLiveValue {
  workersByTask: ReadonlyMap<number, TaskWorker[]>;
  /** task_id → хувь нэмэрчид (нэр + ажилласан албан цаг + хуваарилалт) — `GET /tasks/contributors` (нэг дуудлага/төсөл). */
  contributorsByTask: ReadonlyMap<number, ContributorRow[]>;
  /** task_id → хуваарилагдсан («managed») үндсэн ажлын тойм (revision, нийт хийгдсэн). */
  managedByTask: ReadonlyMap<number, ManagedSummary>;
  /** Төслийн «дуусгах асуултууд» — өөрийн хэсгээ дуусгахад. */
  completionQuestions: QaQuestion[];
  timer: OfficialTimerApi;
  currentUserId: number | null;
  /** engineer / architect / senior / CEO — таск авч ажиллах эрх. */
  canTake: boolean;
  /** admin + senior — өөр хүн ажиллаж буй таскийг шууд хуваах (сервер мөн шалгана). */
  isManager: boolean;
  /** Жинхэнэ admin — бусдын мартсан таймерыг зогсооно. */
  canAdminStop: boolean;
  /** Цагаар бодогддог засварын төсөл — хуваарилах утгагүй, хүмүүс зэрэг ажиллана. */
  hoursMode: boolean;
  /** Хуваарилалтын засварлагчийг нээх (`AllocationEditorDialog`). */
  openAllocation: (task: FlatTask) => void;
  /** ✂ «Хуваах» — таскийг нэр + хувиар ЖИНХЭНЭ үндсэн таскууд болгох / буцаах (`RootSplitDialog`, 0395). */
  openRootSplit: (task: FlatTask) => void;
  takingId: number | null;
  take: (task: FlatTask) => void;
  adminStop: (task: FlatTask, worker: TaskWorker) => void;
  /** «Миний ажилд нэмэх» товч харагдах эсэх (таск авах эрхтэй, жагсаалт ачаалагдсан). */
  canUseMyList: boolean;
  /** Таск «Миний ажлууд»-д байгаа эсэх (ажилласан ∪ нэмсэн − хассан; хүсэлтийн үед шууд). */
  inMyList: (taskId: number) => boolean;
  /** Нэмэх ↔ хасах — ЗӨВХӨН надад харагдана (таск дээрх нэр хөдлөхгүй). */
  toggleMyList: (task: FlatTask) => void;
  /** Энэ таскийн нэмэх/хасах хүсэлт явж байна (таск тус бүрд — бусдыг түгжихгүй). */
  isListBusy: (taskId: number) => boolean;
}

export const TaskLiveContext = createContext<TaskLiveValue | null>(null);

/** Provider-гүй бол null — нэр, «Өөртөө авах» харагдахгүй. */
export function useTaskLive(): TaskLiveValue | null {
  return useContext(TaskLiveContext);
}
