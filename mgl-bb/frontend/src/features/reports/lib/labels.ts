import { findLeavePolicy, fallbackCodeFromType } from '@/features/attendance/leavePolicy';
import type { EmployeeLeaveRow, EmployeeSuggestionRow } from '../types';

/** Дэлгэц ба Excel/Google Sheets хоёулаа ЭДГЭЭР шошгыг хэрэглэнэ — хоёр тоо зөрөхгүй. */

/** Чөлөөний журмын нэр (reason_code → leavePolicy), байхгүй бол төрлийн код. */
export function leaveLabel(l: EmployeeLeaveRow): string {
  const policy = findLeavePolicy(l.reason_code ?? fallbackCodeFromType(l.leave_type));
  return policy?.label ?? l.leave_type;
}

export function suggestionStatusLabel(s: EmployeeSuggestionRow, t: (k: string) => string): string {
  if (s.status === 'resolved')
    return t(
      s.resolution === 'approved'
        ? 'reportsPage.suggestionApproved'
        : 'reportsPage.suggestionRejected',
    );
  return t(
    s.status === 'discussing'
      ? 'reportsPage.suggestionDiscussing'
      : 'reportsPage.suggestionReceived',
  );
}
