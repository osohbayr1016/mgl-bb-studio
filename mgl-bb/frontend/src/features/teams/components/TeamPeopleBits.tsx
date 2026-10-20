import { MEDIA_BASE_URL } from '@/shared/api/client';
import { Avatar, AvatarFallback, AvatarImage } from '@/ui/avatar';
import { avatarStyle } from '@/shared/lib/avatarColor';
import { formatDisplayName } from '@/shared/lib/formatting';
import { cn } from '@/shared/lib/utils';
import { initials, type TeamMember } from '../lib/teamView';

/**
 * Хүний avatar — зураггүй бол нэрээс гарсан тогтвортой өнгөөр (`avatarStyle`),
 * тиймээс нэг хүн бүх хуудсанд ижил өнгөтэй, олон хүний жагсаалтад нүд
 * танихад амархан.  `presence` өгвөл баруун доод буланд «өнөөдөр ажиллаж байна»
 * цэг (ногоон) / «чөлөөтэй» цэг (саарал).
 */
export function PersonAvatar({
  member,
  size = 'md',
  presence,
  className,
}: {
  member: Pick<TeamMember, 'full_name' | 'profile_image'>;
  /** `row` = 24px — олон гишүүнтэй нягт жагсаалтын мөр (Багийн самбар). */
  size?: 'xs' | 'row' | 'sm' | 'md' | 'lg';
  presence?: 'working' | 'idle';
  className?: string;
}) {
  const name = formatDisplayName(member.full_name);
  const box = { xs: 'size-5', row: 'size-6', sm: 'size-7', md: 'size-9', lg: 'size-11' }[size];
  const text = { xs: 'text-label', row: 'text-label', sm: 'text-micro', md: 'text-micro', lg: 'text-body' }[size];
  const dot = { xs: 'size-1.5', row: 'size-2', sm: 'size-2', md: 'size-2.5', lg: 'size-3' }[size];
  return (
    <span className={cn('relative inline-flex shrink-0', className)}>
      <Avatar className={box}>
        {member.profile_image && (
          <AvatarImage src={`${MEDIA_BASE_URL}${member.profile_image}`} alt={name} />
        )}
        <AvatarFallback
          className={cn('font-semibold normal-case tracking-normal text-white', text)}
          style={avatarStyle(member.full_name)}
        >
          {initials(name)}
        </AvatarFallback>
      </Avatar>
      {presence && (
        <span
          aria-hidden
          className={cn(
            'absolute -right-px -bottom-px rounded-full ring-2 ring-card',
            dot,
            presence === 'working' ? 'bg-success' : 'bg-muted-subtle',
          )}
        />
      )}
    </span>
  );
}
