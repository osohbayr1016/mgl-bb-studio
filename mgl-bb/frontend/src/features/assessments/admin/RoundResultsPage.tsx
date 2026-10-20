import { Navigate, useParams } from 'react-router-dom';

import { useAuth } from '@/shared/context/AuthContext';
import { PageContainer } from '@/shared/components/PageContainer';
import { RoundResultsView } from './RoundResultsView';
import { USERS_ASSESSMENTS_TAB } from './AssessmentsAdminTab';

/** `/app/admin/assessments/:roundId` — ээлжийн үр дүн. */
export default function RoundResultsPage() {
  const { user } = useAuth();
  const { roundId } = useParams<{ roundId: string }>();
  const id = Number(roundId);
  const valid = Number.isInteger(id) && id > 0;
  const isAdmin = user?.role === 'admin';

  if (!isAdmin) return <Navigate to="/app" replace />;
  if (!valid) return <Navigate to={USERS_ASSESSMENTS_TAB} replace />;

  return (
    <PageContainer>
      <RoundResultsView roundId={id} backTo={USERS_ASSESSMENTS_TAB} />
    </PageContainer>
  );
}
