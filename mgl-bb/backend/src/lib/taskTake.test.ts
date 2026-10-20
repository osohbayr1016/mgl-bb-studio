/**
 * `lib/taskTake.ts` — «Өөртөө авах», онооны хамгийн өндөр хувь (HWM), хуваалтын
 * онооны хуваарилалтын цэвэр дүрэм.  Импортгүй файл тул hook шаардлагагүй.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  canTakeRole,
  distributeByContribution,
  hwmFraction,
  isSplittableTask,
  takeDenial,
  type TakeFacts,
} from './taskTake.ts';

const facts = (over: Partial<TakeFacts> = {}): TakeFacts => ({
  exists: true,
  project_active: true,
  latest_pct: 40,
  self_done: false,
  clocked_in: true,
  ...over,
});

test('авах эрх: инженер/архитектор/ахлах + CEO; энгийн admin, worker, client — үгүй', () => {
  for (const r of ['engineer', 'architect', 'senior']) assert.equal(canTakeRole(r, false), true);
  assert.equal(canTakeRole('admin', false), false);
  assert.equal(canTakeRole('admin', true), true);
  assert.equal(canTakeRole('worker', false), false);
  assert.equal(canTakeRole('client', false), false);
});

test('саадын дараалал: эрх → таск → төсөл → дууссан → ирц', () => {
  assert.equal(takeDenial('admin', false, facts({ exists: false })), 'ROLE_NOT_ALLOWED');
  assert.equal(takeDenial('engineer', false, facts({ exists: false, clocked_in: false })), 'TASK_NOT_FOUND');
  assert.equal(takeDenial('engineer', false, facts({ project_active: false })), 'PROJECT_INACTIVE');
  assert.equal(takeDenial('engineer', false, facts({ latest_pct: 100 })), 'TASK_COMPLETED');
  assert.equal(takeDenial('engineer', false, facts({ self_done: true })), 'TASK_COMPLETED');
  assert.equal(takeDenial('engineer', false, facts({ clocked_in: false })), 'NOT_CLOCKED_IN');
  assert.equal(takeDenial('senior', false, facts()), null);
  assert.equal(takeDenial('admin', true, facts()), null);
});

test('хуваагдах таск = жин > 0 БА цагаар бодогддоггүй', () => {
  assert.equal(isSplittableTask({ progress_mode: 'tasks', weight_percent: 5 }), true);
  assert.equal(isSplittableTask({ progress_mode: null, weight_percent: 5 }), true);
  assert.equal(isSplittableTask({ progress_mode: 'hours', weight_percent: 5 }), false);
  assert.equal(isSplittableTask({ progress_mode: 'tasks', weight_percent: 0 }), false);
});

test('HWM: 77 → 8 (алдаа) → 77 давхар оноо өгөхгүй; 77 → 90 зөвхөн 13', () => {
  assert.equal(hwmFraction(0, 77, 0), 1);
  assert.equal(hwmFraction(77, 8, 77), 0); // бууруулалт
  assert.equal(hwmFraction(8, 77, 77), 0); // дахин өсгөлт — аль хэдийн тооцогдсон
  assert.ok(Math.abs(hwmFraction(8, 90, 77) - 13 / 82) < 1e-12);
  assert.equal(hwmFraction(77, 90, 77), 1);
});

test('HWM: хүн бууруулсныг өөр хүн өсгөхөд зөвхөн шинээр давсан хэсэг', () => {
  // А 75% хийсэн, ахлах 50 болгож зассан, Б 100 хүргэсэн → Б-д 25 (75→100).
  const f = hwmFraction(50, 100, 75);
  assert.ok(Math.abs(f - 25 / 50) < 1e-12);
});

test('хуваалтын оноо өмнөх хувь нэмэрчдэд хувь тэнцүүлэн; хувь нэмэрчгүй бол хоосон', () => {
  const m = new Map([
    [1, 30],
    [2, 10],
  ]);
  const out = distributeByContribution(8, m);
  assert.deepEqual(
    out.map((o) => [o.user_id, o.amount]),
    [
      [1, 6],
      [2, 2],
    ],
  );
  assert.deepEqual(distributeByContribution(8, new Map()), []);
  assert.deepEqual(distributeByContribution(0, m), []);
});
