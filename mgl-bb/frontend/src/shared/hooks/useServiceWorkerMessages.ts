import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useInvalidateNotifications } from '@/shared/api/notifications';

/**
 * Service worker → апп-ын гүүр.
 *
 *   `mgl:push`     — push ирлээ.  Мэдэгдлийн кэшийг тэр дороо хүчингүй
 *                    болгоно, эс тэгвэл badge 60 секунд хүртэл хоцорно.
 *   `mgl:navigate` — хэрэглэгч мэдэгдэл дээр дарлаа.  SW нь `client.navigate()`
 *                    биш postMessage ашигладаг тул React Router зөөлөн
 *                    шилжилт хийж, TanStack-ийн кэш амьд үлдэнэ.
 */
export function useServiceWorkerMessages() {
  const navigate = useNavigate();
  const invalidate = useInvalidateNotifications();

  useEffect(() => {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;

    const onMessage = (event: MessageEvent) => {
      const data = event.data as { type?: string; link?: string } | null;
      if (!data || typeof data.type !== 'string') return;

      if (data.type === 'mgl:push') {
        invalidate();
        return;
      }
      if (data.type === 'mgl:navigate' && typeof data.link === 'string') {
        // Зөвхөн аппын дотоод замыг хүлээж авна — гадаад URL руу шилжүүлэхгүй.
        if (data.link.startsWith('/')) navigate(data.link);
      }
    };

    navigator.serviceWorker.addEventListener('message', onMessage);
    return () => navigator.serviceWorker.removeEventListener('message', onMessage);
  }, [navigate, invalidate]);
}
