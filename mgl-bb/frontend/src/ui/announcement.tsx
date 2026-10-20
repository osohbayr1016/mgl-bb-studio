import type { ComponentProps, HTMLAttributes } from 'react';

import { Badge } from '@/ui/badge';
import { cn } from '@/shared/lib/utils';

/**
 * Мэдэгдлийн pill — `[ШОШГО] Гарчиг →` хэлбэртэй авсаархан капсул.
 * Kibo UI-ийн `announcement` (https://www.kibo-ui.com/r/announcement.json).
 *
 * ⚠️ ЯАГААД `--path`-аар суулгасан бэ: энэ компонентын `registryDependencies`
 * нь `badge` бөгөөд `shadcn add` нь `src/ui/badge.tsx`-ийг ДАРЖ БИЧИХ гэсэн
 * (`--dry-run` дээр «~1 overwrite» гэж илэрсэн).  Репогийн badge-д нэмэлт
 * `ghost` / `link` variant болон `data-variant` байгаа тул тэдгээр чимээгүй
 * устах байсан.  Түр хавтсанд буулгаад stock badge-ийг нь хаясан.
 *
 * Хөрвүүлэлт: `text-xs` → `text-micro` (төслийн 6 түвшний шатлал).
 * Бусад нь бүхэлдээ семантик токен дээр байсан.
 *
 * ХЭРЭГЛЭЭ:
 *   <Announcement>
 *     <AnnouncementTag>ХОЦРОГДОЛ</AnnouncementTag>
 *     <AnnouncementTitle>MGL-230314 — 47 хоног хөдөлгөөнгүй</AnnouncementTitle>
 *   </Announcement>
 */

export type AnnouncementProps = ComponentProps<typeof Badge> & {
  themed?: boolean;
};

export const Announcement = ({
  variant = 'outline',
  themed = false,
  className,
  ...props
}: AnnouncementProps) => (
  <Badge
    className={cn(
      'group max-w-full gap-2 rounded-full bg-background px-3 py-0.5 font-medium shadow-sm transition-all',
      'hover:shadow-md',
      themed && 'announcement-themed border-foreground/5',
      className,
    )}
    variant={variant}
    {...props}
  />
);

export type AnnouncementTagProps = HTMLAttributes<HTMLDivElement>;

export const AnnouncementTag = ({ className, ...props }: AnnouncementTagProps) => (
  <div
    className={cn(
      'text-micro -ml-2.5 shrink-0 truncate rounded-full bg-foreground/5 px-2.5 py-1',
      'group-[.announcement-themed]:bg-background/60',
      className,
    )}
    {...props}
  />
);

export type AnnouncementTitleProps = HTMLAttributes<HTMLDivElement>;

export const AnnouncementTitle = ({ className, ...props }: AnnouncementTitleProps) => (
  <div className={cn('flex items-center gap-1 truncate py-1', className)} {...props} />
);
