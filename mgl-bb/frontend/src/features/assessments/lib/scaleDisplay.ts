import type { AssessmentScale, AssessmentScaleOption } from '../types';

/** Онооны дарааллыг 1→5 болгож эрэмбэлнэ (хадгалалтын `value` өөрчлөгдөхгүй). */
export function sortedScaleOptions(scale: AssessmentScale): AssessmentScaleOption[] {
  return [...(scale.options ?? [])].sort((a, b) => a.value - b.value);
}

/** Харагдах дарааллыг зассан scale хуулбар буцаана. */
export function displayScale(scale: AssessmentScale): AssessmentScale {
  return { ...scale, options: sortedScaleOptions(scale) };
}
