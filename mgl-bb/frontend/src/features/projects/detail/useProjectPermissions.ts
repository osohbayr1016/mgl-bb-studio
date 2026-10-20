/** Role gates for the project detail page.
 *
 *  2026-10-01: хүнд оноох сонгогч (`assignablePool`, `/users` асуулга)
 *  ХАСАГДСАН — таскийг ажилтан өөрөө «Өөртөө авах»-аар авна (`taskLive.tsx`). */
import { useAuth } from '@/shared/context/AuthContext';
import { isCeo } from '@/shared/lib/ceo';

export function useProjectPermissions() {
  const { user } = useAuth();

  const isAdmin = user?.role === 'admin';
  const canManageProjectWork = isAdmin || user?.role === 'senior';
  // BA team can author the Тайлбар бичиг (architectural explanatory note);
  // architects + seniors edit, admins always edit, everyone else read-only.
  const canEditBaReport = isAdmin || user?.role === 'architect' || user?.role === 'senior';

  // Таск «Өөртөө авах» (= албан таймер эхлүүлэх) ролиуд — engineer / architect /
  // senior + CEO (admin боловч ажил авдаг, hardcode id 2).  Сервер дахин шалгана.
  const canClaimRole =
    user?.role === 'engineer' ||
    user?.role === 'architect' ||
    user?.role === 'senior' ||
    isCeo(user);

  return {
    isAdmin: !!isAdmin,
    canManageProjectWork: !!canManageProjectWork,
    canEditBaReport: !!canEditBaReport,
    canClaimRole,
  };
}
