import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '@/shared/context/AuthContext';
import { BrandLoader } from '@/shared/components/BrandLoader';
import { ConnectionError } from '@/shared/components/ConnectionError';
import { isWorkerRole, isWorkerAllowedPath, WORKER_HOME } from '@/shared/lib/roles';

/** Auth gate for every protected route. While `useAuth()` is verifying the
 *  cookie / token we render a full-screen brand loader so unauthenticated
 *  flicker is impossible. After auth resolves we either:
 *    - bounce to `/login` (no user)
 *    - sandbox `client` users into `/client/*` (and staff out of it)
 *    - sandbox `worker` (цэвэрлэгч) into the attendance-only surface
 *    - enforce optional per-route role allowlist
 *  …and finally render the matched child route via `<Outlet />`. */
export const ProtectedRoute = ({ allowedRoles }: { allowedRoles?: string[] }) => {
  const { user, loading, authError, retryAuth } = useAuth();
  const location = useLocation();

  if (loading) {
    return <BrandLoader />;
  }

  /* Сервер дуугарсангүй — «нэвтрээгүй» гэж БҮҮ ойлго.
   *
   * ⚠️ Энэ шалгалт `!user`-ээс ӨМНӨ байх ёстой.  Сүлжээний алдааны үед
   * `user` нь бас `null` байдаг тул дараалал буруу байвал хэрэглэгчийг
   * /login руу шидэж, тэнд ч мөн адил унана — гэхдээ энэ удаад ямар
   * алдаа болсон нь ойлгомжгүй болно. */
  if (authError) {
    return <ConnectionError detail={authError} onRetry={retryAuth} />;
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  /* Client persona is sandboxed under `/client/*`. If a client lands anywhere
   * else (typing `/app` in the URL bar, an old bookmark, etc.) we bounce them
   * into their own dashboard so they never see the staff sidebar — and so
   * they can't poke around the engineer-only pages even by URL. Conversely,
   * staff who try `/client` get pushed back to `/app`. */
  const isClientRoute = location.pathname === '/client' || location.pathname.startsWith('/client/');
  if (user.role === 'client' && !isClientRoute) {
    return <Navigate to="/client" replace />;
  }
  if (user.role !== 'client' && isClientRoute) {
    return <Navigate to="/app" replace />;
  }

  /* Цэвэрлэгч (`worker`) — ирцээс өөр юу ч байхгүй.  Зөвшөөрөгдсөн цөөн
   * замаас гадуур хаашаа ч (URL бичсэн, хуучин bookmark) орох гэвэл шууд
   * ирцийн хуудсанд буцаана.  Сервер тал нь `lib/workerScope.ts`-ээр мөн
   * 403 өгдөг тул энэ нь зөвхөн UX-ийн давхарга. */
  if (isWorkerRole(user.role) && !isWorkerAllowedPath(location.pathname)) {
    return <Navigate to={WORKER_HOME} replace />;
  }

  if (allowedRoles && !allowedRoles.includes(user.role)) {
    return <Navigate to="/app" replace />;
  }

  return <Outlet />;
};
