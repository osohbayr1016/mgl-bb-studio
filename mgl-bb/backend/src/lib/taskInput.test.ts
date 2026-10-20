import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isCalendarDate, validateNewTask, TASK_NAME_MAX } from './taskInput.ts';

const base = { component_id: 7, name: 'Шинэ ажил', weight_percent: 0 };

test('valid body → trimmed name, null dates', () => {
  const r = validateNewTask({ ...base, name: '  Фасад  ' });
  assert.ok(r.ok);
  assert.deepEqual(r.value, { component_id: 7, name: 'Фасад', weight_percent: 0, due_date: null, start_date: null });
});

test('weight: string / NaN / negative / Infinity / too large → BAD_WEIGHT', () => {
  for (const w of ['50', Number.NaN, -1, Number.POSITIVE_INFINITY, 100_001, null, undefined]) {
    const r = validateNewTask({ ...base, weight_percent: w });
    assert.equal(r.ok, false, String(w));
    if (!r.ok) assert.equal(r.code, 'BAD_WEIGHT');
  }
  assert.ok(validateNewTask({ ...base, weight_percent: 12.5 }).ok);
});

test('name: empty, whitespace, non-string, too long → BAD_NAME', () => {
  for (const n of ['', '   ', 42, null, 'x'.repeat(TASK_NAME_MAX + 1)]) {
    const r = validateNewTask({ ...base, name: n });
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.code, 'BAD_NAME');
  }
  assert.ok(validateNewTask({ ...base, name: 'x'.repeat(TASK_NAME_MAX) }).ok);
});

test('component_id must be a positive integer', () => {
  for (const id of ['7', 0, -3, 1.5, undefined]) {
    const r = validateNewTask({ ...base, component_id: id });
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.code, 'BAD_COMPONENT');
  }
});

test('dates: YYYY-MM-DD calendar days only, start ≤ due', () => {
  assert.ok(isCalendarDate('2026-02-28'));
  assert.equal(isCalendarDate('2026-02-30'), false);
  assert.equal(isCalendarDate('2026-2-3'), false);
  assert.ok(validateNewTask({ ...base, due_date: '', start_date: null }).ok);
  const bad = validateNewTask({ ...base, due_date: 'tomorrow' });
  assert.equal(bad.ok, false);
  const order = validateNewTask({ ...base, start_date: '2026-10-20', due_date: '2026-10-10' });
  assert.equal(order.ok, false);
  const good = validateNewTask({ ...base, start_date: '2026-10-01', due_date: '2026-10-10' });
  assert.ok(good.ok && good.value.due_date === '2026-10-10');
});

test('non-object body → BAD_BODY', () => {
  for (const b of [null, 'x', [], 5]) {
    const r = validateNewTask(b);
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.code, 'BAD_BODY');
  }
});
