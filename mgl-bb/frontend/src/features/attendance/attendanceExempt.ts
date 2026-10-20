import { useAuth } from '@/shared/context/AuthContext';
import { isAdminTier } from '@/shared/lib/score';

/**
 * Ирц бүртгэлийн хязгаарлалтаас бүрэн чөлөөлөгдөх ажилтны кодууд.
 *
 * Admin tier (admin) нь аль хэдийн чөлөөтэй —
 * төсөл заавал сонгох, утаснаас хориглох, нэг төхөөрөмжид холбох гэсэн
 * хязгаарлалтуудаас.  Энд нэмсэн хүмүүс ролио ӨӨРЧЛӨХГҮЙГЭЭР admin-тэй
 * ижил эрхтэй болж, төсөл сонгохгүйгээр болон утаснаас ч ирцээ бүртгэнэ.
 *
 * Backend талд `backend/src/routes/attendance.ts`-д ижил жагсаалт бий —
 * хоёр талыг үргэлж ижил байлгана.
 */
export const ATTENDANCE_UNRESTRICTED_EMPLOYEE_IDS = ['ERD'];

/** Нэвтэрсэн хэрэглэгч ирцийн хязгаарлалтаас чөлөөтэй эсэх — admin tier
 *  эсвэл {@link ATTENDANCE_UNRESTRICTED_EMPLOYEE_IDS}-д байгаа ажилтны код. */
export function useAttendanceUnrestricted(): boolean {
  const { user } = useAuth();
  if (!user) return false;
  if (isAdminTier(user.role)) return true;
  // Admin UsersPage-аас тавьсан per-user flag (redeploy-гүйгээр).
  if (user.attendance_unrestricted) return true;
  return !!user.employee_id && ATTENDANCE_UNRESTRICTED_EMPLOYEE_IDS.includes(user.employee_id);
}
