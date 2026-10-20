import { useMemo } from 'react';
import { useLanguage } from '@/shared/i18n';
import { formatDuration } from '@/features/non-project-work/lib';
import type { AllocationModel } from './allocation';
import { hoursToMinutes } from './currentWork';
import { buildRosterContext, type RosterContext, type RosterLabels } from './roster';

/**
 * Нэрсийн самбарын контекст — таб бүрд НЭГ удаа угсарна (хүн/ажлын
 * индекс нь моделоос гардаг тул зүсэм бүрд дахин тоолохгүй).
 */
export function useRosterContext(
  model: AllocationModel,
  primary: Map<number, number>,
  colorOfProject: (projectId: number) => string,
): RosterContext {
  const { t } = useLanguage();
  const labels: RosterLabels = useMemo(
    () => ({
      // «Төсөлгүй» гэдэг нь «ирцээр төсөл сонгоогүй» гэсэн үг.
      idle: t('teams.rosterIdleActive'),
      alsoOn: (projects) => t('teams.rosterAlsoOn', { projects: projects.join(', ') }),
      earlierOn: (projects) => t('teams.rosterEarlierOn', { projects: projects.join(', ') }),
      dayCount: (count) => t('teams.dayCount', { count }),
      duration: (hours) => formatDuration(hoursToMinutes(hours), t),
    }),
    [t],
  );
  return useMemo(
    () => buildRosterContext({ model, primary, colorOfProject, labels }),
    [model, primary, colorOfProject, labels],
  );
}
