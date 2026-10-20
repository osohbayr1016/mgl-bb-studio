import type { ParticipantResult } from '../api';
import type { ResultPart } from './aggregate';
import { partMean } from './behaviorScale';

/** Зан чанарын part (`weighted: false`, ихэвчлэн `behavior`). */
export function findBehaviorPart(parts: ResultPart[] | undefined): ResultPart | null {
  if (!parts?.length) return null;
  return parts.find((p) => !p.weighted || p.part_id === 'behavior') ?? null;
}

/** Хэсгүүдийн дундаж (1.0–5.0) — хэсэг бүр ижил жинтэй. */
export function behaviorMean(part: ResultPart | null | undefined): number | null {
  return partMean(part ?? null);
}

export function behaviorPartFromResult(result: ParticipantResult): ResultPart | null {
  return findBehaviorPart(result.parts);
}
