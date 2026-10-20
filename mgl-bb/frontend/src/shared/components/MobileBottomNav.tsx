import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard,
  FolderKanban,
  Bell,
  Plus,
  Clock,
  type LucideIcon,
} from 'lucide-react';
import { useAuth } from '@/shared/context/AuthContext';
import { isWorkerRole } from '@/shared/lib/roles';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/i18n';
import { Avatar, AvatarImage, AvatarFallback } from '@/ui/avatar';
import { formatDisplayName } from '@/shared/lib/formatting';
import { MEDIA_BASE_URL } from '@/shared/api/client';
import { useVirtualKeyboardOpen } from '@/shared/hooks/useVirtualKeyboard';

type Slot =
  | { kind: 'link'; to: string; icon: LucideIcon; labelKey: string; end?: boolean; badge?: boolean }
  | { kind: 'center' }
  | { kind: 'avatar'; to: string; labelKey: string };

const STAFF_SLOTS: Slot[] = [
  { kind: 'link', to: '/app', icon: LayoutDashboard, labelKey: 'mobileBottomNav.home', end: true },
  { kind: 'link', to: '/app/projects', icon: FolderKanban, labelKey: 'mobileBottomNav.projects' },
  { kind: 'center' },
  { kind: 'link', to: '/app/notifications', icon: Bell, labelKey: 'mobileBottomNav.alerts', badge: true },
  { kind: 'avatar', to: '/app/profile', labelKey: 'mobileBottomNav.me' },
];

// Цэвэрлэгч (`worker`) — ирцээс өөр юу ч байхгүй тул 3 үүр, төв ⊕-гүй.
// Утас нь түүний ЦОРЫН ГАНЦ төхөөрөмж тул энэ мөр л түүний бүх навигаци.
const WORKER_SLOTS: Slot[] = [
  {
    kind: 'link',
    to: '/app/attendance',
    icon: Clock,
    labelKey: 'mobileBottomNav.attendance',
  },
  {
    kind: 'link',
    to: '/app/notifications',
    icon: Bell,
    labelKey: 'mobileBottomNav.alerts',
    badge: true,
  },
  { kind: 'avatar', to: '/app/profile', labelKey: 'mobileBottomNav.me' },
];

// Харилцагчид төв ⊕ байхгүй (тэдэнд илгээх ажлын үйлдэл байхгүй) — 4 үүр.
const CLIENT_SLOTS: Slot[] = [
  { kind: 'link', to: '/client', icon: LayoutDashboard, labelKey: 'mobileBottomNav.dashboard', end: true },
  { kind: 'link', to: '/app/projects', icon: FolderKanban, labelKey: 'mobileBottomNav.projects' },
  { kind: 'link', to: '/app/notifications', icon: Bell, labelKey: 'mobileBottomNav.alerts', badge: true },
  { kind: 'avatar', to: '/app/profile', labelKey: 'mobileBottomNav.me' },
];

interface MobileBottomNavProps {
  /** Sidebar drawer-ийг нээнэ (Миний таб дээр удаан дарах). */
  onOpenMore: () => void;
  /** Төв ⊕ — түргэн үйлдлийн sheet. */
  onOpenQuickActions: () => void;
  /** Уншаагүй мэдэгдлийн тоо (Layout-ээс — bell-тэй ижил эх сурвалж). */
  unreadCount?: number;
}

/**
 * Утасны доод таб мөр (`lg:hidden`).
 *
 * Instagram-ын бүтэц: 4 таб + төвд өргөгдсөн дугуй үйлдлийн товч.
 *
 * ⚠️ Багануудын тоог `slots.length`-ээс гаргаж байгаа нь санаатай.  Өмнө нь
 * `grid-cols-5` гэж хатуу бичээд ердөө 4 элемент байрлуулсан тул баруун талд
 * хоосон багана үлдэж, табууд зүүн тийш шахагдсан байсан.
 *
 * ⚠️ `pb-[env(safe-area-inset-bottom)]` нь `<nav>`-т, өргөгдсөн дугуй нь
 * `<li>`-д — тэр хоёр огт огтлолцохгүй.  Мөн `overflow-visible` заавал:
 * ямар нэг эцэг элемент `overflow-hidden` тавибал дугуйн дээд хэсэг тасарна.
 */
export function MobileBottomNav({
  onOpenMore,
  onOpenQuickActions,
  unreadCount = 0,
}: MobileBottomNavProps) {
  const { user } = useAuth();
  const { t } = useLanguage();
  // Гар гарахад таб мөр нь гарын дээр хөвж, бичиж буй талбарыг дардаг.
  // Жинхэнэ утасны аппууд бүгд энэ үед таб мөрөө нууна.
  const keyboardOpen = useVirtualKeyboardOpen();

  const isClient = user?.role === 'client';
  const isWorker = isWorkerRole(user?.role);
  const slots = isWorker ? WORKER_SLOTS : isClient ? CLIENT_SLOTS : STAFF_SLOTS;

  const displayName = formatDisplayName(user?.full_name);
  const initials = displayName ? displayName.substring(0, 2).toUpperCase() : '??';
  const avatarSrc = user?.profile_image ? `${MEDIA_BASE_URL}${user.profile_image}` : undefined;

  // Миний таб дээр удаан дарах → бүх цэс. Утсан дээр contextmenu нь
  // long-press-ээр хөөрдөг тул нэмэлт таймер шаардлагагүй.
  const longPressMore = (e: React.MouseEvent) => {
    e.preventDefault();
    onOpenMore();
  };

  const badge = (
    <span
      aria-hidden="true"
      className="absolute top-1.5 right-[calc(50%-1.25rem)] min-w-[18px] h-[18px] px-1
 bg-destructive text-destructive-foreground text-micro font-semibold
 rounded-full flex items-center justify-center border-2 border-chrome"
    >
      {unreadCount > 99 ? '99+' : unreadCount}
    </span>
  );

  const linkClass = ({ isActive }: { isActive: boolean }) =>
    cn(
      'relative flex min-h-14 flex-col items-center justify-center gap-0.5 px-1 text-micro font-medium transition-colors',
      // Идэвхтэй табын дээд ирмэг дээр богино зураас.
      'after:absolute after:top-0 after:left-1/2 after:h-0.5 after:w-8 after:-translate-x-1/2 after:rounded-full after:transition-colors',
      isActive
        ? 'text-primary after:bg-primary'
        : 'text-muted-foreground hover:text-foreground after:bg-transparent',
    );

  return (
    <nav
      data-slot="mobile-bottom-nav"
      className={cn(
        'lg:hidden fixed bottom-0 inset-x-0 z-40',
        'border-t border-chrome-border bg-chrome/95 backdrop-blur-lg',
        'pb-[env(safe-area-inset-bottom)]',
        // Гар нээгдэхэд доош гулсаж нуугдана.  `hidden` биш transform —
        // ингэснээр буцаж гарахдаа мөн зөөлөн гулсана.
        'transition-transform duration-200 ease-out motion-reduce:transition-none',
        keyboardOpen && 'translate-y-full pointer-events-none',
      )}
      aria-hidden={keyboardOpen || undefined}
      aria-label={t('mobileBottomNav.ariaLabel')}
    >
      <ul
        className="grid overflow-visible"
        style={{ gridTemplateColumns: `repeat(${slots.length}, minmax(0, 1fr))` }}
      >
        {slots.map((slot, i) => {
          if (slot.kind === 'center') {
            return (
              <li key="center" className="relative">
                {/*
                  `ring-4 ring-chrome` нь мөрний өнгөтэй ижил цагираг зурж,
                  навбарын дээд ирмэгээс зүсэгдсэн мэт харагдуулна — SVG mask
                  шаардлагагүй, сэдэв солигдоход автоматаар дагана.
                  `-top-5` = 56px дугуйн 36px нь мөрөн дотор үлдэнэ.
                */}
                <button
                  type="button"
                  onClick={onOpenQuickActions}
                  aria-label={t('mobileBottomNav.quickActions')}
                  className={cn(
                    'absolute left-1/2 -top-5 z-10 grid size-14 -translate-x-1/2 place-items-center',
                    'rounded-full bg-primary text-primary-foreground',
                    'shadow-lg shadow-primary/30 ring-4 ring-chrome',
                    'transition-transform motion-safe:active:scale-95',
                    'focus-visible:outline-none focus-visible:ring-primary/60',
                  )}
                >
                  <Plus className="size-6" />
                </button>
              </li>
            );
          }

          if (slot.kind === 'avatar') {
            return (
              <li key={slot.to}>
                <NavLink
                  to={slot.to}
                  onContextMenu={longPressMore}
                  className={linkClass}
                  title={t('mobileBottomNav.allMenuHint')}
                >
                  {({ isActive }) => (
                    <>
                      <Avatar
                        className={cn(
                          'size-6 shrink-0 transition-shadow',
                          isActive && 'ring-2 ring-primary',
                        )}
                      >
                        {avatarSrc && <AvatarImage src={avatarSrc} alt={displayName} />}
                        <AvatarFallback className="bg-primary/20 text-primary text-micro font-semibold">
                          {initials}
                        </AvatarFallback>
                      </Avatar>
                      <span className="truncate leading-none">{t(slot.labelKey)}</span>
                    </>
                  )}
                </NavLink>
              </li>
            );
          }

          const Icon = slot.icon;
          const showBadge = slot.badge && unreadCount > 0;
          return (
            <li key={`${slot.to}-${i}`}>
              <NavLink
                to={slot.to}
                end={slot.end}
                className={linkClass}
                aria-label={
                  showBadge
                    ? t('notifications.titleWithCount', { count: unreadCount })
                    : undefined
                }
              >
                <Icon className="h-5 w-5 shrink-0" />
                <span className="truncate leading-none">{t(slot.labelKey)}</span>
                {showBadge && badge}
              </NavLink>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
