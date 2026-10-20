/**
 * `revitWorkContext.ts` — «MGL ажил» самбарын контекстын цэвэр дүрэм.
 * Гол инвариант: ТӨСЛИЙГ ТААХГҮЙ — бүртгэлгүй / хоёрдмол үед сонголтыг хүнд үлдээнэ.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  isOpenTask,
  mglCodeIn,
  pickRegistration,
  suggestProjects,
  type ProjectCandidate,
  type WorkRegistration,
} from './revitWorkContext.ts';

const reg = (project_id: number, id = project_id * 10): WorkRegistration => ({
  revit_document_id: id,
  project_id,
  project_name: `P${project_id}`,
  project_status: 'active',
});

test('бүртгэлгүй файл — сонголтгүй, хоёрдмол ч биш', () => {
  const p = pickRegistration([], 41, new Set([41]));
  assert.deepEqual(p, { registration: null, source: null, ambiguous: false });
});

test('ганц бүртгэл — баталгаатай (single)', () => {
  const p = pickRegistration([reg(41)], null, new Set());
  assert.equal(p.source, 'single');
  assert.equal(p.registration?.project_id, 41);
});

test('санасан төсөл (hint) бүртгэлүүдийн дунд байвал түүнийг авна', () => {
  const p = pickRegistration([reg(41), reg(37)], 37, new Set([41]));
  assert.equal(p.source, 'hint');
  assert.equal(p.registration?.project_id, 37, 'hint нь «миний таск»-аас давуу');
});

test('hint нь бүртгэлд БАЙХГҮЙ бол үл тоомсорлоно (хуурамч hint эрх нээхгүй)', () => {
  const p = pickRegistration([reg(41)], 99, new Set());
  assert.equal(p.source, 'single');
  assert.equal(p.registration?.project_id, 41);
});

test('олон бүртгэл — зөвхөн нэг дээр нь миний таск бол түүнийг (my_tasks)', () => {
  const p = pickRegistration([reg(41), reg(37)], null, new Set([37, 99]));
  assert.equal(p.source, 'my_tasks');
  assert.equal(p.registration?.project_id, 37);
});

test('олон бүртгэл, нотолгоогүй — ТААМАГЛАХГҮЙ (ambiguous)', () => {
  for (const mine of [new Set<number>(), new Set([41, 37])]) {
    const p = pickRegistration([reg(41), reg(37)], null, mine);
    assert.equal(p.registration, null);
    assert.equal(p.ambiguous, true);
  }
});

test('MGL код — файлын нэрийн янз бүрийн бичлэгээс хэвийн хэлбэрт', () => {
  assert.equal(mglCodeIn('MGL-251006_EVERGREEN_AZ.rvt'), 'MGL-251006');
  assert.equal(mglCodeIn('mgl_251006 evergreen'), 'MGL-251006');
  assert.equal(mglCodeIn('MGL251006'), 'MGL-251006');
  assert.equal(mglCodeIn(null, '', 'Tennis_Hall_Floor1'), null);
  assert.equal(mglCodeIn(null, 'MGL 240506 FURNITURE'), 'MGL-240506', 'эхний хоосон утгыг алгасна');
  assert.equal(mglCodeIn('MGL-25100'), null, '5 оронтой нь код биш');
});

const cand = (project_id: number, open_tasks: number, code: string | null, name = `P${project_id}`): ProjectCandidate => ({
  project_id,
  project_name: name,
  open_tasks,
  code,
});

test('санал: код таарсан нь эхэнд, дараа нь миний таск олонтой нь', () => {
  const s = suggestProjects('MGL-251006', [
    cand(1, 5, 'MGL-111111'),
    cand(41, 0, 'MGL-251006', 'EVERGREEN AZ'),
    cand(37, 2, 'MGL-251006', 'EVERGREEN ZA'),
    cand(2, 1, null),
  ]);
  assert.deepEqual(
    s.map((x) => [x.project_id, x.reason]),
    [
      [37, 'code'],
      [41, 'code'],
      [1, 'my_tasks'],
      [2, 'my_tasks'],
    ],
  );
});

test('санал: код ч, таск ч байхгүй төсөл ОРОХГҮЙ; давхардалгүй; хязгаартай', () => {
  const s = suggestProjects(null, [cand(1, 0, null), cand(2, 3, 'MGL-000001'), cand(3, 1, null)]);
  assert.deepEqual(s.map((x) => x.project_id), [2, 3]);
  const many = Array.from({ length: 30 }, (_, i) => cand(i + 1, 1, null));
  assert.equal(suggestProjects(null, many, 5).length, 5);
});

test('нээлттэй таск: хувиар <100, цагаар ҮРГЭЛЖ, self_done хэзээ ч', () => {
  assert.equal(isOpenTask({ current_progress: 99, progress_mode: 'tasks', self_done: false }), true);
  assert.equal(isOpenTask({ current_progress: 100, progress_mode: 'tasks', self_done: false }), false);
  assert.equal(isOpenTask({ current_progress: null, progress_mode: null, self_done: false }), true);
  assert.equal(isOpenTask({ current_progress: 100, progress_mode: 'hours', self_done: false }), true);
  assert.equal(isOpenTask({ current_progress: 10, progress_mode: 'hours', self_done: true }), false);
});
