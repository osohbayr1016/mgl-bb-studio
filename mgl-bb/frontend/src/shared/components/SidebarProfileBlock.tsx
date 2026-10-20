import { NavLink, useLocation } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';

import { Avatar, AvatarFallback, AvatarImage } from '@/ui/avatar';
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from '@/ui/sidebar';
import { useAuth } from '@/shared/context/AuthContext';
import { useLanguage } from '@/shared/i18n';
import { formatDisplayName } from '@/shared/lib/formatting';
import { MEDIA_BASE_URL } from '@/shared/api/client';
import { cn } from '@/shared/lib/utils';

/** Профайлын зам — идэвхтэй эсэхийг шалгах ба холбоосын зорилт. */
const PROFILE_PATH = '/app/profile';

type SidebarProfileBlockProps = {
  /** Утасны drawer-ыг хаах.  Sidebar-ийн бусад холбоостой ЯГ ижил зан төлөв
   *  байхын тулд Layout-ийн `closeDrawer`-ыг шууд дамжуулна. */
  onNavigate: () => void;
};

/**
 * Sidebar-ийн ТОЛГОЙ дахь «Профайл» хэсэг.
 *
 * Өмнө нь хэрэглэгчийн аватар/нэр зөвхөн ХӨЛД (`SidebarFooter`) байсан бөгөөд
 * тэр нь унждаг цэсний товч — товшихоор профайл руу шууд ордоггүй, эхлээд цэс
 * нээгддэг байв.  Мөн `/app/profile` нь `NAV_ITEMS`-д огт байхгүй тул цэснээс
 * шууд орох мөр байгаагүй.  Энэ блок нь тэр хоёрыг залруулна: нэг товшилтоор
 * профайл руу ордог, толгойд байнга харагддаг карт.
 *
 * ⚠️ ХУМИУЛСАН (icon) горим: бүх текстийг НЭГ дараалсан `<span>` дотор хийсэн —
 * `SidebarMenuButton`-ы `overflow-hidden` түүнийг тайрч, зөвхөн 32px аватар
 * үлдэнэ.  `justify-center`-ийг БҮҮ нэм (ui/sidebar.tsx-ийн тайлбарыг үз:
 * тэмдэг + шошго нэг бүлэг болж төвлөрөхөд аватар хайрцгаас гарч зүүн тийш
 * түлхэгдэнэ).  Нэрийг `tooltip`-оор өгсөн тул хумиасан үед ч таних боломжтой.
 */
export function SidebarProfileBlock({ onNavigate }: SidebarProfileBlockProps) {
  const { user } = useAuth();
  const { t } = useLanguage();
  const location = useLocation();

  // Нэвтрэлт шалгагдаж дуусаагүй байхад хоосон карт харуулахгүй.
  if (!user) return null;

  const displayName = formatDisplayName(user.full_name);
  const initials = displayName ? displayName.substring(0, 2).toUpperCase() : '??';
  const avatarSrc = user.profile_image ? `${MEDIA_BASE_URL}${user.profile_image}` : undefined;

  // Хоёрдугаар мөр: албан тушаал (жинхэнэ мэдээлэл) эхэлж, байхгүй бол role.
  // Role нь өгөгдөлд англи, жижиг үсгээр хадгалагддаг тул `capitalize` — хөлийн
  // хэрэглэгчийн цэстэй ижил харагдац.
  const position = user.position?.trim();
  const subtitle = position || user.role;

  // Идэвхтэй эсэх — `renderNavItem`-ийн `matchDepth`-тэй ижил дүрэм: яг таарах
  // эсвэл сегментийн хилээр эхлэх.
  const isActive =
    location.pathname === PROFILE_PATH || location.pathname.startsWith(`${PROFILE_PATH}/`);

  return (
    <div className="flex flex-col gap-1">
      {/* Бүлгийн гарчиг — хумиулсан горимд бүрмөсөн унана (`hidden` нь эцгийн
          `gap`-ыг ч авч явна, `opacity-0` бол зай үлдээх байсан). */}
      <span className="px-2 text-label text-muted-foreground group-data-[collapsible=icon]:hidden">
        {t('sidebar.profileSection')}
      </span>

      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton asChild size="lg" tooltip={displayName} isActive={isActive}>
            <NavLink to={PROFILE_PATH} onClick={onNavigate}>
              <Avatar className="h-8 w-8 shrink-0 rounded-lg">
                {avatarSrc && <AvatarImage src={avatarSrc} alt={displayName} />}
                <AvatarFallback className="rounded-lg bg-primary/20 text-xs font-semibold text-primary">
                  {initials}
                </AvatarFallback>
              </Avatar>
              <span className="grid flex-1 text-left leading-tight">
                {/* Дэлгэц уншигчид зориулсан зорилгын тайлбар — харагдац дээр
                    нэр + албан тушаал л үлдэнэ (`sr-only` нь урсгалаас гардаг
                    тул grid-ийн мөр эзлэхгүй). */}
                <span className="sr-only">{t('sidebar.viewProfile')}</span>
                <span
                  className={cn('truncate font-medium', isActive ? 'text-primary' : 'text-foreground')}
                >
                  {displayName}
                </span>
                <span
                  className={cn(
                    'truncate text-xs text-muted-foreground',
                    !position && 'capitalize',
                  )}
                >
                  {subtitle}
                </span>
              </span>
              <ChevronRight className="ml-auto text-muted-foreground" />
            </NavLink>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
    </div>
  );
}
