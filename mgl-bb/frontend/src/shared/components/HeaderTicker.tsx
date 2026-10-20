import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { useReducedMotion } from 'motion/react';

import { apiFetch } from '@/shared/api/client';
import { useAuth } from '@/shared/context/AuthContext';
import { interpolate, pickLocalized, useLanguage } from '@/shared/i18n';
import { isWorkerRole } from '@/shared/lib/roles';
import { cn } from '@/shared/lib/utils';
import { Announcement, AnnouncementTag, AnnouncementTitle } from '@/ui/announcement';
import { Marquee, MarqueeContent, MarqueeFade, MarqueeItem } from '@/ui/marquee';

/**
 * Толгойн гүйдэг мэдээллийн зурвас.
 *
 * `GET /api/ticker` нь дуудагчийн ролийг харгалзан бэлэн мөрүүд буцаана
 * (эрсдэлийн мөрүүд зөвхөн admin + senior).  Сервер ӨГҮҮЛБЭР биш,
 * `textKey` + `params` буцаадаг тул орчуулга энд хийгдэнэ.
 *
 * ⚠️ ХОЁР ЭХ СУРВАЛЖ (migration 0255).  Админ Тохиргоо → «Гүйдэг мэдээ»-ээс
 *    өөрийн мэдээ нэмэх ба суурин мөрийн текстийг дарж бичих боломжтой.
 *    Тэр тохиолдолд мөр нь орчуулгын түлхүүр биш, ХОЁР ХЭЛНИЙ бэлэн
 *    өгүүлбэртэй (`text` / `textEn`) ирнэ — түүнийг `pickLocalized`-оор
 *    сонгоод `interpolate`-аар `{placeholder}`-уудыг нь бөглөнө.
 *
 * ЧИМЭЭГҮЙ УНАНА: энэ бол чимэглэл — өгөгдөл ирээгүй, хоосон, эсвэл
 * алдаа гарсан бол `null` рендэрлэж толгойг хэвийн үлдээнэ.  Толгой нь
 * `/app/*` бүх хуудсанд байдаг тул энд гарсан алдаа аппыг бүхэлд нь
 * эвдэх ёсгүй.
 *
 * ⚠️ ЦЭВЭРЛЭГЧ (`worker`): `lib/workerScope.ts`-ийн цагаан жагсаалтад
 *    `ticker` ОРООГҮЙ тул түүнд 403 буцна.  Жагсаалтыг өргөтгөхийн оронд
 *    (тэр бол санаатай тавьсан хамгаалалтын хил) энд огт асуухгүй.
 *
 * ⚠️ ХӨДӨЛГӨӨН: `react-fast-marquee` нь `prefers-reduced-motion`-ыг өөрөө
 *    хүндэтгэдэггүй — тиймээс `play={!reduce}` заавал дамжуулна.  Хөдөлгөөн
 *    унтарсан үед мөрүүд зүгээр л зогсож харагдана (мэдээлэл алдагдахгүй).
 */

type TickerTone = 'danger' | 'warning' | 'success' | 'info' | 'default';

interface TickerItem {
  id: string;
  tone: TickerTone;
  tagKey: string;
  textKey: string;
  params?: Record<string, string | number>;
  href?: string;
  /* Админаас бичсэн шууд текст — байвал түлхүүрийн ОРОНД хэрэглэнэ. */
  text?: string;
  textEn?: string;
  tag?: string;
  tagEn?: string;
}

/** Шошгын өнгө — семантик токен дээр (`status-colors.ts`-ийн гэрийн стиль).
 *  Админы хуудас (`features/ticker`) урьдчилсан харагдацдаа ЭНЭ хүснэгтийг
 *  импортолдог тул хоёр газар өнгө зөрөх боломжгүй. */
export const TICKER_TONE_TAG: Record<TickerTone, string> = {
  danger: 'bg-danger/15 text-danger',
  warning: 'bg-warning/15 text-warning',
  success: 'bg-success/15 text-success',
  info: 'bg-info/15 text-info',
  default: 'bg-foreground/5 text-muted-foreground',
};

/** Гүйх хурд (px/сек).  Уншиж амжихаар удаан, гэхдээ зогссон мэт биш. */
const SPEED = 26;

export function HeaderTicker({ className }: { className?: string }) {
  const { t, lang } = useLanguage();
  const { user } = useAuth();
  const reduce = useReducedMotion();

  const enabled = !!user && !isWorkerRole(user.role);

  const { data } = useQuery({
    queryKey: ['/ticker'],
    queryFn: () => apiFetch<{ items: TickerItem[] }>('/ticker'),
    enabled,
    // Толгой нь хуудас бүрт mount-лагддаг — 60 сек дотор дахин татахгүй.
    staleTime: 60_000,
    // Ажлын өдрийн турш нээлттэй байдаг таб дээр 5 минут тутам сэргээнэ.
    refetchInterval: 5 * 60_000,
  });

  const items = data?.items ?? [];
  if (items.length === 0) return null;

  return (
    <Marquee className={cn('h-8', className)}>
      {/* Ирмэгийн бүдгэрэл нь толгойн `bg-chrome` дэвсгэртэй тааруулав —
          өгөгдмөл `from-background` нь энд өөр өнгө болно. */}
      <MarqueeFade side="left" className="w-8 from-chrome" />
      <MarqueeContent speed={SPEED} gradient={false} play={!reduce} pauseOnHover autoFill>
        {items.map((item) => {
          const body = (
            <Announcement
              className={cn(
                'border-chrome-border bg-chrome-hover/60 shadow-none',
                item.href && 'hover:border-primary/40',
              )}
            >
              <AnnouncementTag className={TICKER_TONE_TAG[item.tone]}>
                {item.tag ? pickLocalized(lang, item.tag, item.tagEn) : t(item.tagKey)}
              </AnnouncementTag>
              <AnnouncementTitle className="text-micro text-foreground">
                {item.text
                  ? interpolate(pickLocalized(lang, item.text, item.textEn), item.params)
                  : t(item.textKey, item.params)}
              </AnnouncementTitle>
            </Announcement>
          );
          return (
            <MarqueeItem key={item.id} className="mx-1.5 flex items-center">
              {item.href ? (
                <Link
                  to={item.href}
                  className="rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                >
                  {body}
                </Link>
              ) : (
                body
              )}
            </MarqueeItem>
          );
        })}
      </MarqueeContent>
      <MarqueeFade side="right" className="w-8 from-chrome" />
    </Marquee>
  );
}

export default HeaderTicker;
