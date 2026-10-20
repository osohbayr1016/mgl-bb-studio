import type { AssessmentAnswers, AssessmentSection } from '../types';
import type { AssessmentPageDef } from '../components/SectionPage';
import { sectionItems } from './score';

export interface PagedSections {
  sections: AssessmentSection[];
}

export function isAnswered(v: number | undefined): v is number {
  return typeof v === 'number' && v > 0;
}

function pageItems(page: AssessmentPageDef): string[] {
  const ids: string[] = [];
  for (const section of page.sections) {
    for (const item of sectionItems(section)) {
      ids.push(item.id);
    }
  }
  return ids;
}

export function pageProgress(
  page: AssessmentPageDef,
  answers: AssessmentAnswers,
): { answered: number; total: number; remaining: number } {
  const ids = pageItems(page);
  const answered = ids.filter((id) => isAnswered(answers[id])).length;
  return { answered, total: ids.length, remaining: ids.length - answered };
}

export function firstUnansweredOnPage(
  page: AssessmentPageDef,
  answers: AssessmentAnswers,
): string | null {
  for (const id of pageItems(page)) {
    if (!isAnswered(answers[id])) return id;
  }
  return null;
}

export function nextUnansweredFrom(
  pages: AssessmentPageDef[],
  answers: AssessmentAnswers,
  fromPage: number,
): { pageIndex: number; itemId: string } | null {
  if (pages.length === 0) return null;

  for (let offset = 0; offset < pages.length; offset += 1) {
    const pageIndex = (fromPage + offset) % pages.length;
    const page = pages[pageIndex];
    if (!page) continue;
    const itemId = firstUnansweredOnPage(page, answers);
    if (itemId) return { pageIndex, itemId };
  }
  return null;
}

export const ROW_ATTR = 'data-item-id';

export function rowSelector(itemId: string): string {
  return `[${ROW_ATTR}="${itemId}"]`;
}
