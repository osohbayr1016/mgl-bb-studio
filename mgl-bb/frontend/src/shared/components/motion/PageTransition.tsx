/**
 * PageTransition — route солих болгонд агуулгыг fade + бага slide-аар сольж
 * харуулна. `/app/*` Outlet-ийг тойруулж байрлуулна. `key={pathname}` нь
 * замыг солих бүрд дотоод агуулгыг remount хийж enter-animation-ийг дахин
 * тоглуулна. reduced-motion үед provider transform-ийг унтрааж opacity л үлдээнэ.
 */
import type { ReactNode } from 'react';
import { m } from 'motion/react';
import { useLocation } from 'react-router-dom';

import { EASE_OUT } from '@/shared/lib/motion';

export function PageTransition({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  return (
    <m.div
      key={pathname}
      // flex-1/min-h-0/flex-col дамжуулагч: full-bleed хуудсанд (main нь
      // `flex flex-col`) дотоод `overflow-y-auto` scroll контейнер өндрөө авч
      // гүйлгэдэг болно. Энгийн (block main) хуудсанд flex-1 хүчингүй тул
      // нөлөөгүй — main өөрөө гүйлгэнэ.
      className="flex min-h-0 flex-1 flex-col"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: EASE_OUT }}
    >
      {children}
    </m.div>
  );
}
