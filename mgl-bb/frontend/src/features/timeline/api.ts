/**
 * `/api/timeline` — «Төслийн хуваарь» хуудасны API давхарга.
 *
 * Бүх дуудлага энд төвлөрнө (компонент бүр өөрийн fetch бичихгүй), query
 * түлхүүр мөн энд — бичих үйлдлүүд ижил түлхүүрээр invalidate хийнэ.
 *
 * Backend нь module түвшинд `requireRole('admin','senior','engineer','architect')`
 * -оор УНШИХЫГ нээсэн; доорх ГУРВАН БИЧИЛТ (`saveSchedule`,
 * `saveManualProgress`, `sendNudge`) нь route талдаа `requireAdmin()`-ээр
 * хаалттай.  Хуудсан дээрх дүрийн шалгалт нь зөвхөн UX (ажиллахгүй товч
 * харуулахгүйн тулд) — жинхэнэ хаалт нь сервер тал.  Дуудагч UI нь
 * `GET /api/timeline`-ын буцаадаг `can_edit` тугийг дагана.
 */

import type { UseQueryResult } from '@tanstack/react-query';
import { apiFetch, type ApiError } from '@/shared/api/client';
import { queryClient } from '@/shared/api/queryClient';
import { useApiQuery } from '@/shared/api/useApi';
import type { TimelineLead, TimelineResponse } from './types';

const BASE = '/timeline';

/** TanStack Query түлхүүр — invalidate хийхэд эндээс авна. */
export const TIMELINE_KEY = ['/timeline'] as const;

/** Төслийн жагсаалтын түлхүүр (`ProjectsPage`). Хуваарийн огноо + прогресс
 *  тэнд БАС харагддаг тул бичилт бүрийн дараа хамт шинэчилнэ. */
const PROJECTS_KEY = ['/projects'] as const;

/** Бичилтийн дараа хоёр жагсаалтыг зэрэг шинэчилнэ. */
async function invalidateTimeline(): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: TIMELINE_KEY }),
    queryClient.invalidateQueries({ queryKey: PROJECTS_KEY }),
  ]);
}

/** Тэнхлэгийн бүх өгөгдөл — нэг дуудлагаар (сервер тал эрсдэлийг бодсон).
 *  `enabled=false` үед (жишээ нь дүр зөвшөөрөхгүй) огт дуудахгүй. */
export function useTimeline(enabled: boolean): UseQueryResult<TimelineResponse, ApiError> {
  return useApiQuery<TimelineResponse>(TIMELINE_KEY, BASE, { enabled });
}

export interface ScheduleBody {
  /** 'YYYY-MM-DD' эсвэл null (цэвэрлэх). */
  start_date: string | null;
  finish_date: string | null;
  /** Дуусах огноог хойшлуулах нь өгөгдмөлөөр 409 `EXTENSION_REQUIRED`
   *  (сунгалт = `features/deadlines` `createExtension`).  `'correction'` =
   *  буруу бичсэн огноог залруулж байна — сервер зөвшөөрч, түүхэнд
   *  «засвар» гэж бичнэ (migration 0337). */
  change_kind?: 'correction';
  note?: string;
}

export interface ScheduleResult {
  success: true;
  start_date: string | null;
  finish_date: string | null;
}

/** Эхлэх / дуусах огноо хадгалах (`project_passport` upsert).
 *  Сервер тал огноог шалгаж 400 буцаана — дуудагч тал `ApiError.message`-ийг
 *  шууд харуулж болно. */
export async function saveSchedule(id: number, body: ScheduleBody): Promise<ScheduleResult> {
  const res = await apiFetch<ScheduleResult>(`${BASE}/projects/${id}/schedule`, {
    method: 'PUT',
    data: body,
  });
  await invalidateTimeline();
  return res;
}

export interface ManualProgressResult {
  success: true;
  manual_progress: number | null;
}

/** Гараар тавьсан прогресс (задаргаагүй жижиг ажилд). null → цэвэрлэнэ,
 *  тэгэхэд автомат тооцоо руу буцна. */
export async function saveManualProgress(
  id: number,
  manual_progress: number | null,
): Promise<ManualProgressResult> {
  const res = await apiFetch<ManualProgressResult>(`${BASE}/projects/${id}/manual-progress`, {
    method: 'PUT',
    data: { manual_progress },
  });
  await invalidateTimeline();
  return res;
}

export interface NudgeResult {
  success: true;
  /** Бодитоор мэдэгдэл хүрсэн хүмүүс. Хариуцагч олдоогүй бол хоосон. */
  notified: TimelineLead[];
}

/** «Сануулах» — төслийн хариуцагч(ид) руу мэдэгдэл илгээнэ.
 *  Нэг илгээгч нэг төслийг өдөрт нэг л удаа сануулж болно (сервер 409). */
export async function sendNudge(id: number, note: string): Promise<NudgeResult> {
  const res = await apiFetch<NudgeResult>(`${BASE}/projects/${id}/nudge`, {
    method: 'POST',
    data: { note },
  });
  await invalidateTimeline();
  return res;
}
