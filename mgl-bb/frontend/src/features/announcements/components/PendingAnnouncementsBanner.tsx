import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, Megaphone } from 'lucide-react';

import { useAuth } from '@/shared/context/AuthContext';
import { useLanguage } from '@/shared/i18n';
import { canReadAnnouncements } from '@/shared/lib/roles';

import { announcementKeys, fetchAnnouncements } from '../api';

/**
 * Хянах самбарын дээд зурвас — баталгаажуулаагүй (чагт / гарын үсэг) нийтлэгдсэн
 * мэдээлэл байвал.  Байхгүй бол юу ч зурахгүй (null).  Зөвхөн мэдээлэл уншдаг
 * role-д хүсэлт явна.  `PendingRulesBanner`-тай ижил хэлбэр.
 */
export function PendingAnnouncementsBanner() {
  const { t } = useLanguage();
  const { user } = useAuth();
  const q = useQuery({
    queryKey: announcementKeys.list,
    queryFn: fetchAnnouncements,
    enabled: canReadAnnouncements(user?.role),
    retry: false,
    // staleTime ӨГӨХГҮЙ: жагсаалтын хуудастай ижил түлхүүр тул самбарт буцаж
    // ирэхэд дахин татна — эс тэгвэл шинэ мэдээлэл минут хүртэл нуугдана.
  });
  const pending = q.data?.announcements.filter((a) => a.ack_mode !== 'none' && a.my_ack === null && a.in_audience) ?? [];
  if (pending.length === 0) return null;
  const first = pending[0]!;
  const to = pending.length === 1 ? `/app/announcements/${first.id}` : '/app/announcements';
  return (
    <Link
      to={to}
      className="flex items-center gap-3 rounded-xl border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-foreground transition-colors hover:bg-warning/15"
      data-testid="pending-announcements-banner"
    >
      <Megaphone className="h-5 w-5 shrink-0 text-warning" aria-hidden />
      <span className="min-w-0 flex-1">
        <span className="font-medium">{t('announcements.pendingBanner', { count: pending.length })}</span>
        {pending.length === 1 && <span className="text-muted-foreground"> — {first.title}</span>}
      </span>
      <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
    </Link>
  );
}
