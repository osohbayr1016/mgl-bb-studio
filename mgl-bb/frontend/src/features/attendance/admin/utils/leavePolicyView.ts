import type { LeaveRequest } from '@/shared/types';
import {
  findLeavePolicy,
  fallbackCodeFromType,
  type LeavePolicyEntry,
} from '@/features/attendance/leavePolicy';

/** Дотоод журмын нарийвчилсан шалтгаан + цалинтай эсэх.
 *  `reason_code` хадгалагдсан бол түүний label-ийг type-н ерөнхий нэрний
 *  оронд харуулна; `is_paid` нь мөрийн утга → журмын утга гэсэн дарааллаар. */
export function resolveLeavePolicy(l: LeaveRequest): {
  policy: LeavePolicyEntry | null;
  isPaid: boolean | null;
} {
  const policy = findLeavePolicy(l.reason_code ?? fallbackCodeFromType(l.leave_type));
  const isPaid = l.is_paid !== null ? l.is_paid === 1 : (policy?.is_paid ?? null);
  return { policy, isPaid };
}
