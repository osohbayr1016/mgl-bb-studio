import { lazy } from 'react';
import { useAuth } from '@/shared/context/AuthContext';
import { isWorkerRole } from '@/shared/lib/roles';

/**
 * `/app/attendance` -ийн role-оор салаалдаг оролт.
 *
 * Цэвэрлэгч (`worker`) утсаараа хэрэглэдэг тул түүнд хөнгөн, mobile-first
 * `WorkerAttendancePage` -ийг өгнө; бусад ажилтан бүрэн `AttendancePage`-ийг
 * авна.  Хоёулаа `lazy` тул зөвхөн СОНГОГДСОН нь сүлжээгээр татагдана —
 * цэвэрлэгчийн утас recharts/төслийн кодыг огт татахгүй.
 *
 * Энэ dispatcher нь өөрөө lazy БИШ (хэдхэн мөр) — routes.tsx-д шууд импортлоно,
 * ингэснээр нэмэлт round-trip үүсэхгүй.
 */
const AttendancePage = lazy(() => import('@/features/attendance/AttendancePage'));
const WorkerAttendancePage = lazy(() => import('@/features/attendance/WorkerAttendancePage'));

export default function AttendanceRoute() {
  const { user } = useAuth();
  return isWorkerRole(user?.role) ? <WorkerAttendancePage /> : <AttendancePage />;
}
