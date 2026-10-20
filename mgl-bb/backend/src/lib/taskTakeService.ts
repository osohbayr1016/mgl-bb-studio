/**
 * «Өөртөө авах» — нэг урсгал (эзэн 2026-10-01).  `POST /api/tasks/:id/claim` ба
 * `POST /api/task-timer/start` хоёулаа ЭНИЙГ дууддаг (давтагдсан дүрэм байхгүй).
 *
 *   1. Баримт (`loadTaskForTake`) + ирц (`isAtWork`) + CEO.
 *   2. Саад (`takeDenial`): эрх → таск → төсөл → дууссан → ирц.
 *   3. Хуваагдах таск дээр ӨӨР хүн ажиллаж байвал → TASK_OCCUPIED + хуваах цонхны
 *      өгөгдмөл (50/50, явцтай бол зөвхөн үлдсэнийг).  Юу ч бичигдэхгүй — хэрэглэгчийн
 *      өмнөх таймер ч зогсохгүй.
 *   4. `startOfficialTimer` (атом: өөрийн өмнөх таймер зогсож, энэ таск дээр
 *      эхэлнэ, ажилласан хүмүүсийн бүртгэлд мөр).  Зэрэг ирсэн өөр хүний «авах»
 *      ялсан бол (inserted = 0, гэхдээ миний сэшн биш) мөн TASK_OCCUPIED.
 *
 * Цэвэр дүрэм `taskTake.ts`, SQL `taskTimerStore.ts`.
 */
import { isCeo } from './ceo';
import { isAtWork } from './attendanceUnrestricted';
import { todayInUB } from './time';
import { splitDefaults } from './taskSplit';
import { TAKE_DENIAL_MESSAGE, TAKE_DENIAL_STATUS, takeDenial, type TakeError } from './taskTake';
import { loadTaskForTake, startOfficialTimer, type TaskWorker } from './taskTimerStore';
import type { OfficialTimerStartOutcome } from './taskTimer';
import { unhideOnTake } from './myTaskList';
import { loadGate } from './taskAllocGate';

/** 409 `TASK_OCCUPIED` (`reason: 'progress'`) — өөр хүн аль хэдийн хувь оруулсан таск. */
const TAKE_PROGRESS_MESSAGE =
  'Энэ таск дээр өөр хүн аль хэдийн хувь оруулсан байна — өмнөх хүний хийсэн хувь түүнд хэвээр; үлдсэнийг хэн хэдэн хувиар авахаа хуваарилна уу.';

export interface OccupiedInfo {
  /** Яагаад хуваах цонх гарсан: `working` = өөр хүн ОДОО ажиллаж байна; `progress` = өөр хүн аль хэдийн хувь оруулсан
   *  (одоо ажиллаж байгаа эсэхээс үл хамаарна — эзэн 2026-10-06). */
  reason: 'working' | 'progress';
  /** Одоо ажиллаж буй хүмүүс (хуваагдах таскт ихэвчлэн нэг; `progress` үед хоосон байж болно). */
  workers: TaskWorker[];
  /** Хуваах цонхны өгөгдмөл — явцтай бол хийгдсэн хэсэг хэвээр, үлдсэнийг 50/50. */
  split: {
    weight_percent: number;
    progress: number;
    done_weight: number;
    split_total: number;
    default_weights: number[];
  };
}

export type TakeResult =
  | {
      ok: true;
      outcome: OfficialTimerStartOutcome;
      task_id: number;
      task_name: string | null;
      project_id: number | null;
      /** Өөр хүний хийсэн явцаас үргэлжлүүлж байгаа бол тэр хувь (UI мэдэгдэл). */
      progress: number;
    }
  | {
      ok: false;
      code: TakeError;
      status: 403 | 404 | 409;
      message: string;
      occupied?: OccupiedInfo;
      /** NOT_ALLOCATED: хуваарилагдсан (managed) таск дээр миний ирээдүйн ажил алга — чөлөөт ажил, миний түүх. */
      allocation?: { available_units: number; my_done_units: number; released_units: number; has_row: boolean };
    };

function occupiedInfo(
  weight: number,
  progress: number,
  workers: TaskWorker[],
  reason: OccupiedInfo['reason'] = 'working',
): OccupiedInfo {
  const d = splitDefaults(weight, progress);
  return {
    reason,
    workers,
    split: {
      weight_percent: weight,
      progress,
      done_weight: d.doneWeight,
      split_total: d.splitTotal,
      default_weights: d.defaultHalves,
    },
  };
}

export async function takeTask(
  db: D1Database,
  user: { sub: number; role: string },
  taskId: number,
  nowIso = new Date().toISOString(),
): Promise<TakeResult> {
  const task = await loadTaskForTake(db, taskId, user.sub);
  const ceo = isCeo(user.sub);
  const atWork = task.exists ? await isAtWork(db, user, todayInUB()) : true;
  const denial = takeDenial(user.role, ceo, {
    exists: task.exists,
    project_active: task.project_active,
    latest_pct: task.latest_pct,
    self_done: task.self_done,
    clocked_in: atWork,
  });
  if (denial) {
    return { ok: false, code: denial, status: TAKE_DENIAL_STATUS[denial], message: TAKE_DENIAL_MESSAGE[denial] };
  }
  const occupied = (reason: OccupiedInfo['reason'] = 'working'): TakeResult => ({
    ok: false,
    code: 'TASK_OCCUPIED',
    status: TAKE_DENIAL_STATUS.TASK_OCCUPIED,
    message: reason === 'progress' ? TAKE_PROGRESS_MESSAGE : TAKE_DENIAL_MESSAGE.TASK_OCCUPIED,
    occupied: occupiedInfo(task.weight_percent, task.latest_pct, task.others, reason),
  });
  // Хуваарилагдсан («managed») үндсэн ажил: олон хүн ЗЭРЭГ (хүн бүр өөрийн хуваарилалт дээр), харин миний
  // ирээдүйн ажил (T − D) байхгүй бол цаг эхлүүлэхгүй — чөлөөт ажил авах эсвэл хуваарилалтыг засах шаардлагатай.
  if (task.managed) {
    const a = task.alloc;
    if (!a || a.my_future_units <= 0) {
      return {
        ok: false,
        code: 'NOT_ALLOCATED',
        status: TAKE_DENIAL_STATUS.NOT_ALLOCATED,
        message: TAKE_DENIAL_MESSAGE.NOT_ALLOCATED,
        allocation: {
          available_units: a?.unallocated_units ?? 0,
          my_done_units: a?.my_done_units ?? 0,
          released_units: a?.my_released_units ?? 0,
          has_row: a?.has_row ?? false,
        },
      };
    }
  } else if (task.splittable && task.others.length > 0 && !task.mine) {
    return occupied();
  } else if (
    task.splittable &&
    task.foreign_progress &&
    !task.mine &&
    task.latest_pct > 0 &&
    task.latest_pct < 100 &&
    (await loadGate(db)).state === 'enabled'
  ) {
    // Өөр хүн аль хэдийн хувь оруулсан таскийг анх авахад (одоо ажиллаж байгаа эсэхээс үл хамааран) хуваах цонх: өмнөх хүний
    // хийсэн хувь түүнд хэвээр, үлдсэнийг (эсвэл бүтэн 100%-ийг) хэн хэдэн хувиар авахаа бичнэ.  ЗӨВХӨН хуваарилалтын систем
    // АСААЛТТАЙ (`task_alloc.state = enabled`) үед — унтарсан үед хуваах цонхны «Хадгалах» 423 өгөх тул хуучин зан төлөв хэвээр.
    return occupied('progress');
  }

  const res = await startOfficialTimer(db, {
    userId: user.sub,
    actorId: user.sub,
    taskId,
    projectId: task.project_id,
    nowIso,
    requestId: crypto.randomUUID(),
    exclusive: task.splittable && !task.managed,
  });
  if (res.inserted === 0) {
    // Миний сэшн аль хэдийн энэ таск дээр явж байна уу, эсвэл зэрэг ирсэн өөр
    // хүн түрүүлсэн үү — дахин уншина.
    const again = await loadTaskForTake(db, taskId, user.sub);
    if (!again.mine && !again.managed) {
      return {
        ok: false,
        code: 'TASK_OCCUPIED',
        status: TAKE_DENIAL_STATUS.TASK_OCCUPIED,
        message: TAKE_DENIAL_MESSAGE.TASK_OCCUPIED,
        occupied: occupiedInfo(again.weight_percent, again.latest_pct, again.others),
      };
    }
  }
  // Цаг эхлүүлсэн таск = «миний ажил»: өмнө нь «Миний ажлаас хасах»-аар нуусан бол буцаана
  // (0370).  Цаг аль хэдийн эхэлсэн — энэ алдаа «авах»-ыг унагахгүй.
  await unhideOnTake(db, user.sub, taskId).catch((err: unknown) =>
    console.error('[my-task-list] unhide on take failed', err),
  );
  return {
    ok: true,
    outcome: res.outcome,
    task_id: taskId,
    task_name: task.task_name,
    project_id: task.project_id,
    progress: task.latest_pct,
  };
}
