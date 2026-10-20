import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/shared/lib/utils';

interface EmptyStateProps {
  icon?: LucideIcon;
  title: string;
  description?: string;
  /** Ихэвчлэн <Button>. */
  action?: ReactNode;
  /** Картын дотор багтаах бол — босоо зайг багасгана. */
  compact?: boolean;
  className?: string;
}

/**
 * Өгөгдөл байхгүй / хоосон төлвийг харуулах нэгдсэн төвлөрсөн блок.
 *
 * ХОСоо `ErrorState`-ТЭЙ ЯЛГА: энэ нь хүсэлт АМЖИЛТТАЙ болсон ч үр дүн
 * хоосон гэсэн үг. Хүсэлт бүтээгүй бол `ErrorState`. Хоёрын байрлал,
 * хэмжээ санаатайгаар ижил тул сольж харуулахад агуулга үсрэхгүй.
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  compact,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center px-4 text-center',
        compact ? 'py-8' : 'py-16',
        className,
      )}
    >
      {/* `text-muted-foreground/40` байсан = 1.92:1, өөрөөр хэлбэл бараг
          үл үзэгдэх. `--muted-subtle` нь чимэглэлийн 3:1-ийг хангана. */}
      {Icon && <Icon className="mb-4 h-10 w-10 text-muted-subtle" aria-hidden />}
      <h3 className="text-section text-foreground">{title}</h3>
      {description && (
        <p className="text-body mt-1.5 max-w-sm text-muted-foreground">{description}</p>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
