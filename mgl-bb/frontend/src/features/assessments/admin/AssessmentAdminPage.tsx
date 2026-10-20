import { Navigate, useSearchParams } from 'react-router-dom';

import { ASSESSMENTS_ADMIN_TABS } from './AssessmentsAdminTab';

/** Хуучин `/app/admin/assessments` → Хэрэглэгчид таб руу шилжүүлнэ. */
export default function AssessmentAdminPage() {
  const [searchParams] = useSearchParams();
  const legacyTab = searchParams.get('tab');
  const qs = new URLSearchParams({ tab: 'assessments' });
  if (
    legacyTab &&
    (ASSESSMENTS_ADMIN_TABS as readonly string[]).includes(legacyTab) &&
    legacyTab !== 'rounds'
  ) {
    qs.set('assessTab', legacyTab);
  }
  return <Navigate to={`/app/users?${qs.toString()}`} replace />;
}
