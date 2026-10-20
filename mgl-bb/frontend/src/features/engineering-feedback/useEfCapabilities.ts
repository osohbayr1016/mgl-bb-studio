/**
 * Програмын хүсэлтийн эрх — sidebar, хуудасны хаалт, AccountMenu, хурдан үйлдэл БҮГД энэ НЭГ hook-оос.
 *
 * Эх сурвалж нь сервер (`GET /api/engineering-feedback/capabilities`): `can_review` = баталгаажсан
 * Өсөхбаяр + идэвхтэй Software Engineer эрх + tenant.  Frontend-ийн хаалт нь UX л — сервер бүх inbox
 * замыг эрхгүй хүнд 404-өөр хаадаг.  Ачаалж байх / алдаа гарах үед ХААЛТТАЙ (fail-closed).
 *
 * `worker` / `client` нь энэ prefix-ийн цагаан жагсаалтад байхгүй (403) тул тэдэнд асуулга огт явахгүй.
 * Түлхүүрт хэрэглэгчийн id орно — нэг хөтчид өөр хүн нэвтрэхэд өмнөх хүний эрх кэшээс гарахгүй.
 */
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/shared/context/AuthContext';
import { efKeys, fetchCapabilities } from './api';

export const EF_SUBMITTER_ROLES: readonly string[] = ['admin', 'engineer', 'architect', 'senior'];

export function useEfCapabilities() {
  const { user } = useAuth();
  const eligible = !!user && EF_SUBMITTER_ROLES.includes(user.role) && user.status !== 'inactive';
  const q = useQuery({
    queryKey: [...efKeys.capabilities, user?.id ?? 0],
    queryFn: fetchCapabilities,
    enabled: eligible,
    staleTime: 60_000,
    refetchOnWindowFocus: true,
    retry: 1,
  });
  return {
    canSubmit: eligible && q.data?.can_submit === true,
    canReview: eligible && q.data?.can_review === true,
    loading: eligible && q.isPending,
    data: q.data,
  };
}
