/**
 * Сургалтын түгжээ (§2): амьд pid → түгжээ; үхсэн pid / эвдэрсэн файл / байхгүй → null.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { readTrainingLock, TRAINING_LOCK_MESSAGE } from '../src/trainingLock.ts';

const dir = mkdtempSync(join(tmpdir(), 'mglai-lock-'));
const path = join(dir, 'training.lock');

test('байхгүй файл → null', () => {
  assert.equal(readTrainingLock(join(dir, 'none.lock')), null);
});

test('амьд pid (өөрийн) → түгжээ, мессеж нь run нэрийг агуулна', () => {
  writeFileSync(path, JSON.stringify({ pid: process.pid, run: 'mgl-adapter-0.3', since: '2026-09-11T09:00:00' }));
  const l = readTrainingLock(path);
  assert.ok(l);
  assert.equal(l.pid, process.pid);
  assert.equal(l.run, 'mgl-adapter-0.3');
  assert.match(TRAINING_LOCK_MESSAGE(l), /TRAINING_IN_PROGRESS/);
  assert.match(TRAINING_LOCK_MESSAGE(l), /mgl-adapter-0\.3/);
});

test('үхсэн pid → хоцорсон түгжээ, null', () => {
  // 2^22-1 нь Windows/Linux-д бодитоор оноогдох магадлал маш бага pid.
  writeFileSync(path, JSON.stringify({ pid: 4194303, run: 'x', since: 'y' }));
  assert.equal(readTrainingLock(path), null);
});

test('эвдэрсэн JSON / pid-гүй → null', () => {
  writeFileSync(path, '{not json');
  assert.equal(readTrainingLock(path), null);
  writeFileSync(path, JSON.stringify({ run: 'x' }));
  assert.equal(readTrainingLock(path), null);
  rmSync(dir, { recursive: true, force: true });
});
