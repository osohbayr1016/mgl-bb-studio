/** «Миний ажлууд»-ын төслийн нэр дээр дарж `?mine=1`-ээр орсон үед таскийн
 *  хэсэг рүү ШУУД гүйлгэнэ — хэрэглэгч hero карт, блокийн картуудыг гүйлгэж
 *  өөрийн ажлаа хайх ёсгүй.  Өгөгдөл ачаалагдтал (`ready`) хүлээж, төсөл бүрт
 *  НЭГ л удаа ажиллана: дараа нь хэрэглэгч «Бүгд» руу сэлгэж, гүйлгэж явахад
 *  хуудас буцаж үсрэхгүй. */
import { useEffect, useRef } from 'react';

export function useScrollToMyTasks({
  enabled,
  ready,
  projectId,
  targetRef,
}: {
  /** `?mine=1` байгаа эсэх. */
  enabled: boolean;
  /** Төслийн өгөгдөл ачаалагдаж, таскийн хэсэг DOM-д орсон эсэх. */
  ready: boolean;
  projectId: string | undefined;
  targetRef: React.RefObject<HTMLElement | null>;
}) {
  const doneFor = useRef<string | null>(null);

  useEffect(() => {
    if (!enabled || !ready || !projectId || doneFor.current === projectId) return;
    // Hero/блокийн картын зураг ачаалагдахад байрлал хэд хэдэн frame шилжиж
    // болох тул `useProjectOverviewState`-ийн block-select гүйлгэлттэй адил
    // богино саатал өгнө.
    const timer = window.setTimeout(() => {
      const el = targetRef.current;
      if (!el) return;
      doneFor.current = projectId;
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 120);
    return () => window.clearTimeout(timer);
  }, [enabled, ready, projectId, targetRef]);
}
