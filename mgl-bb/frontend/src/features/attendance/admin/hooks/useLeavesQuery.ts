import { useCallback, useMemo, useState } from 'react';
import { useApiQuery } from '@/shared/api/useApi';
import { useTabParam } from '@/shared/hooks/useTabParam';
import type { LeaveRequest } from '@/shared/types';
import { LEAVE_TYPE_TABS, type AttendanceAdminTab } from '@/features/attendance/admin/constants';
import { nameMatchesQuery } from '@/features/attendance/admin/utils/format';

export type LeaveStatusFilter = 'pending' | 'approved' | 'rejected' | 'cancelled' | 'all';

/** Чөлөөний жагсаалт + шүүлтүүд.  Backend нь [from, to]-той огтлолцох
 *  хүсэлтийг буцаадаг (overlap); нэрээр шүүх нь client талд. */
export function useLeavesQuery(tab: AttendanceAdminTab) {
  const [leaveStatusFilter, setLeaveStatusFilter] = useState<LeaveStatusFilter>('pending');
  // Төрлийн дэд таб: 'other' = ээлжийн амралтаас бусад бүх чөлөө, 'annual' =
  // зөвхөн ээлжийн амралт.  Статусын шүүлт хоёуланд нь хэвээр ажиллана.
  const [leaveTypeTab, setLeaveTypeTab] = useTabParam(LEAVE_TYPE_TABS, 'other', 'leaveType');
  const [leaveFrom, setLeaveFrom] = useState('');
  const [leaveTo, setLeaveTo] = useState('');
  // Чөлөөг ажилтны нэрээр шүүх (client талд, латин/кирилл аль алинаар).
  const [leaveNameQuery, setLeaveNameQuery] = useState('');

  const leavesQueryString = (() => {
    const p = new URLSearchParams();
    if (leaveStatusFilter !== 'all') p.set('status', leaveStatusFilter);
    if (leaveFrom) p.set('from', leaveFrom);
    if (leaveTo) p.set('to', leaveTo);
    p.set('leave_type', leaveTypeTab);
    const s = p.toString();
    return s ? `?${s}` : '';
  })();

  const leavesQuery = useApiQuery<{
    leaves: LeaveRequest[];
    counts: { pending: number; approved: number; rejected: number; cancelled: number };
  }>(
    ['/leaves', leaveStatusFilter, leaveFrom, leaveTo, leaveTypeTab],
    `/leaves${leavesQueryString}`,
    { enabled: tab === 'leaves' },
  );

  const leaves = leavesQuery.data?.leaves ?? [];
  // Нэрээр шүүсэн жагсаалт — латин/кирилл аль алинаар тааруулна.
  const filteredLeaves = useMemo(
    () => leaves.filter((l) => nameMatchesQuery(l.full_name ?? '', leaveNameQuery)),
    [leaves, leaveNameQuery],
  );
  const leaveCounts = leavesQuery.data?.counts ?? {
    pending: 0,
    approved: 0,
    rejected: 0,
    cancelled: 0,
  };

  const loadLeaves = useCallback(() => {
    leavesQuery.refetch();
  }, [leavesQuery]);

  return {
    leaves,
    filteredLeaves,
    leaveCounts,
    loadLeaves,
    leaveStatusFilter,
    setLeaveStatusFilter,
    leaveTypeTab,
    setLeaveTypeTab,
    leaveFrom,
    setLeaveFrom,
    leaveTo,
    setLeaveTo,
    leaveNameQuery,
    setLeaveNameQuery,
  };
}

export type LeavesQueryState = ReturnType<typeof useLeavesQuery>;
