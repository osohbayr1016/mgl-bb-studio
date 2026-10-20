import { useEffect } from 'react';
import { useAuth } from '@/shared/context/AuthContext';
import { useWorkStartReminder } from '@/shared/hooks/useWorkStartReminder';
import { useServiceWorkerMessages } from '@/shared/hooks/useServiceWorkerMessages';
import { usePushSubscription } from '@/shared/hooks/usePushSubscription';
import { useUnreadCount } from '@/shared/api/notifications';

/**
 * Бүх /app/* хуудсыг хүрээлдэг Layout дотор амьдардаг харагдалтгүй
 * (render = null) менежер.
 *
 * ⚠️ Энд мэдэгдлийн зөвшөөрөл АСУУХГҮЙ.  Урьд нь mount дээр шууд
 * `ensureNotificationPermission()` дууддаг байсан нь Chrome-ын
 * abusive-permission эвристикт блоклогдож, iOS Safari дээр хэрэглэгчийн
 * идэвхжүүлэлтгүй тул чимээгүй татгалздаг байв — хоёулаа нэг удаагийн
 * prompt-ыг ямар ч контекстгүйгээр шатаана.  Зөвшөөрлийг зөвхөн
 * Тохиргоо / Мэдэгдлийн хуудсан дахь товч дарахад асууна
 * ({@link usePushSubscription}).
 */
export default function NotificationsManager() {
  const { user } = useAuth();
  const { data: unreadData } = useUnreadCount();
  const { reconcile } = usePushSubscription();

  useWorkStartReminder();
  useServiceWorkerMessages();

  // Захиалгыг апп нээх бүрд эвлэрүүлнэ. `pushsubscriptionchange` нь SW-д
  // токенгүй хөөрдөг тул найдваргүй — браузер endpoint-оо дур мэдэн
  // эргүүлэхэд энэ л засна.
  useEffect(() => {
    if (!user) return;
    void reconcile();
  }, [user, reconcile]);

  // Аппын иконон дээрх тоо. Push ирэх үед SW тал нь мөн шинэчилдэг тул
  // апп нээлттэй ч хаалттай ч зөв байна.
  useEffect(() => {
    const count = unreadData?.count;
    if (typeof count !== 'number') return;
    try {
      if (count > 0) void navigator.setAppBadge?.(count);
      else void navigator.clearAppBadge?.();
    } catch {
      /* Firefox / standalone бус iOS — дэмжигдэхгүй */
    }
  }, [unreadData?.count]);

  return null;
}
