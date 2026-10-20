import { useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';

/** Мөр гарч ирэхийг хүлээх дээд хугацаа — хүйтэн ачаалалд төслийн мод хэдэн секунд. */
const WAIT_MS = 10_000;
const RETRY_MS = 300;

/** Scroll to and flash a task row when `?task=` is present (notification deep link,
 *  «Миний ажлууд» → «Төсөл дээр авах»).  Төслийн өгөгдөл ачаалагдаж мөр DOM-д орох
 *  хүртэл давтан оролдоно (өмнө нь 0 ба 400 мс-д л — хүйтэн ачаалалд мөр олдохгүй
 *  гүйлгэлт алгасагддаг байв). */
export function useTaskDeepLinkFlash() {
  const [searchParams, setSearchParams] = useSearchParams();
  const handledRef = useRef<number | null>(null);
  const taskParam = searchParams.get('task');
  const taskId = taskParam ? parseInt(taskParam, 10) : NaN;

  useEffect(() => {
    if (!Number.isFinite(taskId) || handledRef.current === taskId) return;
    let cancelled = false;
    let timer = 0;
    const startedAt = Date.now();

    const run = () => {
      if (cancelled) return;
      const el = document.querySelector(`[data-task-id="${taskId}"]`);
      if (!el) {
        if (Date.now() - startedAt < WAIT_MS) timer = window.setTimeout(run, RETRY_MS);
        return;
      }
      handledRef.current = taskId;
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.setAttribute('data-section-flash', 'true');
      window.setTimeout(() => el.removeAttribute('data-section-flash'), 2400);
      const next = new URLSearchParams(searchParams);
      next.delete('task');
      setSearchParams(next, { replace: true });
    };

    run();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [taskId, searchParams, setSearchParams]);
}
