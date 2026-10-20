import type { ParticipantResult } from '../api';

/** Багийн шүүлтүүрийн тусгай утгууд — «бүгд» ба «баггүй». */
export const ALL_TEAMS = '__all__';
export const NO_TEAM = '__none__';

export type SubFilter = 'all' | 'complete' | 'missingSelf' | 'missingSenior' | 'none';

export interface TeamOption {
  code: string;
  label: string;
}

export function matchesSubFilter(r: ParticipantResult, filter: SubFilter): boolean {
  switch (filter) {
    case 'complete':
      return r.self_submitted && r.senior_submitted;
    case 'missingSelf':
      return !r.self_submitted;
    case 'missingSenior':
      return !r.senior_submitted;
    case 'none':
      return !r.self_submitted && !r.senior_submitted;
    default:
      return true;
  }
}
