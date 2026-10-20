import { useQuery } from '@tanstack/react-query';

import { assessmentKeys, fetchMyAssignments } from '../api';

/** Профайлын таб дээрх pending цэг — `status=draft && round_status=open`. */
export function usePendingAssessmentCount(enabled = true) {
  const query = useQuery({
    queryKey: assessmentKeys.my,
    queryFn: fetchMyAssignments,
    enabled,
  });

  const pendingCount =
    query.data?.assignments.filter((a) => a.status === 'draft' && a.round_status === 'open')
      .length ?? 0;

  return { pendingCount, ...query };
}
