import type { ReactNode } from 'react';
import { cn } from '@/shared/lib/utils';

interface PageContainerProps {
  children: ReactNode;
  /**
   * `default` — Layout-ийн төвлөрсөн max-w-[1600px] + padding-ийг бүтнээр нь эзэлнэ.
   * `narrow`  — max-w-2xl mx-auto, тохиргоо/профайл маягийн форм хуудсуудад.
   */
  width?: 'default' | 'narrow';
  /** Шууд хүүхдүүдийн хоорондын босоо зай. Default 6 (1.5rem). */
  gap?: 6 | 8;
  className?: string;
}

const GAP = { 6: 'space-y-6', 8: 'space-y-8' } as const;

/**
 * Хуудасны стандарт босоо хэмнэл + нэвтрэлтийн анимэйшнийг нэгтгэх wrapper.
 * Өргөнийг Layout эзэмшдэг тул энэ нь зөвхөн зай (+ optional narrow) хариуцна.
 */
export function PageContainer({
  children,
  width = 'default',
  gap = 6,
  className,
}: PageContainerProps) {
  return (
    <div
      className={cn(
        GAP[gap],
        'animate-in fade-in duration-500',
        width === 'narrow' && 'mx-auto max-w-2xl',
        className,
      )}
    >
      {children}
    </div>
  );
}
