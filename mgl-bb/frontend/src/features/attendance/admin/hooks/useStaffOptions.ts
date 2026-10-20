import { useApiQuery } from '@/shared/api/useApi';

export type StaffOption = { id: number; full_name: string; role: string; status: string };

/** Ажилтны сонгогч (ирц нөхөх / чөлөө бүртгэх dialog) — идэвхтэй,
 *  client бус хэрэглэгчид.  Dialog нээгдэх үед л ачаална. */
export function useStaffOptions(enabled: boolean): StaffOption[] {
  const staffQuery = useApiQuery<{ users: StaffOption[] }>(['/users'], '/users', { enabled });
  return (staffQuery.data?.users ?? []).filter((u) => u.status === 'active' && u.role !== 'client');
}
