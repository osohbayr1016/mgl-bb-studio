/**
 * «Нийтийн мэдээлэл» — УДИРДЛАГА (`/app/admin/announcements`), зөвхөн admin.
 *
 * Sidebar-ийн «Нийтийн мэдээлэл» бүлэг (2026-09-23-наас) гурван хуудастай:
 *   • «Мэдээ, зарлал»  `/app/announcements` — системийн шинэчлэлт, компанийн
 *     мэдээлэл, чухал дотоод зарлал (миграц 0338);
 *   • «Дотоод журам»   `/app/rules` — уншиж, профайлын гарын үсгээр танилцсанаа
 *     баталгаажуулах (миграц 0330; өмнө нь «Хүн хүчин» бүлэгт тусдаа байв);
 *   • «Удирдлага»      ЭНЭ хуудас — хоёуланг нь НЭГ газраас удирдана.
 *
 *   ?tab=announcements (өгөгдмөл) — мэдээ, зарлал бичих, нийтлэх, баталгааны статистик
 *   ?tab=rules                   — журам бичих, хувилбар нийтлэх, гарын үсгийн жагсаалт
 *
 * Таб бүр тухайн модулийн өмнөх админ хуудсыг `embedded` горимоор (гарчиггүй)
 * рендэрлэнэ — `QuotesPage`-ийн ижил хэв маяг: `KeepAliveTabs` + `lazy()`, тиймээс
 * нээгээгүй табын chunk ч, хүсэлт ч явахгүй.  Хоёр модуль СЕРВЕР талдаа тусдаа
 * хэвээр (`/api/announcements`, `/api/internal-rules`, хоёулаа `requireAdmin`) —
 * энэ хуудас зөвхөн UI-г нэгтгэнэ.  Хуучин `/app/admin/rules` нь `routes.tsx`-д
 * `?tab=rules` руу redirect хийгддэг (хадгалсан хавчуурга эвдрэхгүй).
 *
 * ⚠️ `?tab=` нь ЭНЭ хуудасных — мэдээний табын төлөвийн шүүлт `?status=`
 *    (`AnnouncementsAdminPage`).  Нэрийг нь бүү нийлүүл.
 */
import { lazy, Suspense } from 'react';
import { Navigate } from 'react-router-dom';
import { Megaphone, ScrollText } from 'lucide-react';

import { useAuth } from '@/shared/context/AuthContext';
import { useLanguage } from '@/shared/i18n';
import { useTabParam } from '@/shared/hooks/useTabParam';
import { PageContainer } from '@/shared/components/PageContainer';
import { PageHeader } from '@/shared/components/PageHeader';
import { ListSkeleton } from '@/shared/components/skeletons';
import { TabsList, TabsTrigger } from '@/ui/tabs';
import { KeepAliveTabs, KeepAliveTabsPanel } from '@/ui/keep-alive-tabs';

const AnnouncementsAdminPage = lazy(() => import('./AnnouncementsAdminPage'));
const InternalRulesAdminPage = lazy(() => import('@/features/internal-rules/InternalRulesAdminPage'));

const TABS = ['announcements', 'rules'] as const;
type AdminTab = (typeof TABS)[number];

export default function PublicInfoAdminPage() {
  const { t } = useLanguage();
  const { user } = useAuth();
  const [tab, setTab] = useTabParam<AdminTab>(TABS, 'announcements');

  // Сервер тал `requireAdmin()` — энэ бол зөвхөн UX: admin бус хүнийг тухайн
  // табын УНШИХ хуудас руу буцаана (хуучин `/app/admin/rules`-ийн зан төлөв).
  if (user && user.role !== 'admin') {
    return <Navigate to={tab === 'rules' ? '/app/rules' : '/app/announcements'} replace />;
  }

  return (
    <PageContainer>
      <PageHeader
        icon={Megaphone}
        title={t('announcements.adminTitle')}
        description={t('announcements.adminDesc')}
        bare
      />

      <KeepAliveTabs value={tab} onValueChange={(v) => setTab(v as AdminTab)} className="gap-4">
        <TabsList>
          <TabsTrigger value="announcements" data-testid="admin-tab-announcements">
            <Megaphone aria-hidden />
            {t('nav.announcementsNews')}
          </TabsTrigger>
          <TabsTrigger value="rules" data-testid="admin-tab-rules">
            <ScrollText aria-hidden />
            {t('nav.rules')}
          </TabsTrigger>
        </TabsList>

        <KeepAliveTabsPanel value="announcements">
          <Suspense fallback={<ListSkeleton rows={4} />}>
            <AnnouncementsAdminPage embedded />
          </Suspense>
        </KeepAliveTabsPanel>
        <KeepAliveTabsPanel value="rules">
          <Suspense fallback={<ListSkeleton rows={4} />}>
            <InternalRulesAdminPage embedded />
          </Suspense>
        </KeepAliveTabsPanel>
      </KeepAliveTabs>
    </PageContainer>
  );
}
