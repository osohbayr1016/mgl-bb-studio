/**
 * ТАСКИЙН ХУВААРИЛАЛТ — МЕНЕЖЕРИЙН САМБАР (`/app/admin/task-allocation`, 2026-10-05).
 *
 *   ?tab=state    (өгөгдмөл) — идэвхжүүлэлтийн төлөв (enabled | paused | disabled), root-уудын тойм
 *   ?tab=audit               — өгөгдлийн инвариантын аудит (release-ийн хаалга)
 *   ?tab=convert             — хуучин бүлгийг хуваарилалт руу хөрвүүлэх
 *   ?tab=credit              — жингийн дараах оноо тулгалт
 *
 * Хандалт: admin + senior УНШИНА; зөвхөн admin өөрчилнэ (төлөв солих, хөрвүүлэх, буцаах, оноо тулгах).  Frontend role шалгалт
 * нь UX — жинхэнэ хаалга backend `requireManager()` / `requireAdmin()`.
 * Release-ийн дараалал: миграц → worker → Pages → ЭНД «Түр түгжих» → хөрвүүлэлт → аудит (errors = 0) → «Идэвхжүүлэх».
 */
import { lazy, Suspense } from 'react';
import { Navigate } from 'react-router-dom';
import { Scale, SearchCheck, ShieldCheck, GitMerge, Gauge } from 'lucide-react';

import { PageContainer } from '@/shared/components/PageContainer';
import { PageHeader } from '@/shared/components/PageHeader';
import { ListSkeleton } from '@/shared/components/skeletons';
import { useAuth } from '@/shared/context/AuthContext';
import { useTabParam } from '@/shared/hooks/useTabParam';
import { useLanguage } from '@/shared/i18n';
import { TabsList, TabsTrigger } from '@/ui/tabs';
import { KeepAliveTabs, KeepAliveTabsPanel } from '@/ui/keep-alive-tabs';

const StateTab = lazy(() => import('./admin/StateTab'));
const AuditTab = lazy(() => import('./admin/AuditTab'));
const ConversionTab = lazy(() => import('./admin/ConversionTab'));
const CreditTab = lazy(() => import('./admin/CreditTab'));

const TABS = ['state', 'audit', 'convert', 'credit'] as const;
type Tab = (typeof TABS)[number];

export default function TaskAllocationAdminPage() {
  const { t } = useLanguage();
  const { user } = useAuth();
  const [tab, setTab] = useTabParam<Tab>(TABS, 'state');

  if (user && user.role !== 'admin' && user.role !== 'senior') return <Navigate to="/app" replace />;
  const isAdmin = user?.role === 'admin';

  return (
    <PageContainer>
      <PageHeader icon={Gauge} title={t('taskAllocAdmin.title')} description={t('taskAllocAdmin.desc')} bare />
      <KeepAliveTabs value={tab} onValueChange={(v) => setTab(v as Tab)} className="gap-4">
        <TabsList>
          <TabsTrigger value="state" data-testid="alloc-tab-state">
            <ShieldCheck aria-hidden />
            {t('taskAllocAdmin.tab.state')}
          </TabsTrigger>
          <TabsTrigger value="audit" data-testid="alloc-tab-audit">
            <SearchCheck aria-hidden />
            {t('taskAllocAdmin.tab.audit')}
          </TabsTrigger>
          <TabsTrigger value="convert" data-testid="alloc-tab-convert">
            <GitMerge aria-hidden />
            {t('taskAllocAdmin.tab.convert')}
          </TabsTrigger>
          <TabsTrigger value="credit" data-testid="alloc-tab-credit">
            <Scale aria-hidden />
            {t('taskAllocAdmin.tab.credit')}
          </TabsTrigger>
        </TabsList>
        <KeepAliveTabsPanel value="state">
          <Suspense fallback={<ListSkeleton rows={4} />}>
            <StateTab canWrite={isAdmin} />
          </Suspense>
        </KeepAliveTabsPanel>
        <KeepAliveTabsPanel value="audit">
          <Suspense fallback={<ListSkeleton rows={4} />}>
            <AuditTab />
          </Suspense>
        </KeepAliveTabsPanel>
        <KeepAliveTabsPanel value="convert">
          <Suspense fallback={<ListSkeleton rows={4} />}>
            <ConversionTab isAdmin={isAdmin} />
          </Suspense>
        </KeepAliveTabsPanel>
        <KeepAliveTabsPanel value="credit">
          <Suspense fallback={<ListSkeleton rows={4} />}>
            <CreditTab canWrite={isAdmin} />
          </Suspense>
        </KeepAliveTabsPanel>
      </KeepAliveTabs>
    </PageContainer>
  );
}
