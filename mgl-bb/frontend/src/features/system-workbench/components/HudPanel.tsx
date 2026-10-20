import type { ReactNode } from 'react';
import { cn } from '@/shared/lib/utils';

/** HUD хүрээ — булангийн хаалт + жижиг гарчиг. */
export function HudPanel({
  title,
  right,
  className,
  children,
}: {
  title?: string;
  right?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section
      className={cn(
        'relative rounded-md border border-cyan-400/15 bg-[#060b12]/85 shadow-[inset_0_0_40px_rgba(34,211,238,.035)] backdrop-blur-sm',
        className,
      )}
    >
      <span className="pointer-events-none absolute -left-px -top-px size-3 border-l-2 border-t-2 border-cyan-300/60" />
      <span className="pointer-events-none absolute -right-px -top-px size-3 border-r-2 border-t-2 border-cyan-300/60" />
      <span className="pointer-events-none absolute -bottom-px -left-px size-3 border-b-2 border-l-2 border-cyan-300/60" />
      <span className="pointer-events-none absolute -bottom-px -right-px size-3 border-b-2 border-r-2 border-cyan-300/60" />
      {(title || right) && (
        <header className="flex items-center justify-between gap-2 border-b border-cyan-400/10 px-3 py-1.5">
          <h3 className="font-mono text-[10px] font-medium uppercase tracking-[0.3em] text-cyan-300/70">{title}</h3>
          {right}
        </header>
      )}
      {children}
    </section>
  );
}
