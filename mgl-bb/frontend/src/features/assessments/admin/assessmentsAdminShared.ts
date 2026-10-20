import type { RoundStatus } from '../types';

export const USERS_ASSESSMENTS_TAB = '/app/users?tab=assessments';

export const ASSESSMENTS_ADMIN_TABS = ['rounds', 'templates'] as const;
export type AssessmentsAdminTabId = (typeof ASSESSMENTS_ADMIN_TABS)[number];

export const TEMPLATES_ROUTE = '/app/admin/assessments/templates';

export const STATUS_VARIANT: Record<RoundStatus, 'default' | 'secondary' | 'outline'> = {
  draft: 'outline',
  open: 'default',
  closed: 'secondary',
};
