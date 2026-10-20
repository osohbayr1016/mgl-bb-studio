import { Navigate } from 'react-router-dom';
import { Wrench } from 'lucide-react';
import { PageContainer } from '@/shared/components/PageContainer';
import { useAuth } from '@/shared/context/AuthContext';
import { useLanguage } from '@/shared/i18n';
import { RepairHistoryTab } from '@/features/approvals/RepairHistoryTab';

/** Admin-only засварын төсөл удирдах хуудас. Sidebar-аас хассан — Settings
 *  эсвэл хайлтаар (`/app/approvals?view=repair`) нээгдэнэ. */
export default function ApprovalsPage() {
  const { t } = useLanguage();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';

  if (!isAdmin) {
    return <Navigate to="/app/settings" replace />;
  }

  return (
    <PageContainer gap={6}>
      <div className="flex items-start gap-3 border-b border-border pb-5">
        <Wrench className="h-6 w-6 shrink-0 text-primary mt-0.5" />
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t('repair.adminTabTitle')}</h1>
          <p className="text-sm text-muted-foreground mt-1">{t('repair.adminTabSubtitle')}</p>
        </div>
      </div>
      <div id="sec-approvals-repair" className="scroll-mt-24">
        <RepairHistoryTab />
      </div>
    </PageContainer>
  );
}
