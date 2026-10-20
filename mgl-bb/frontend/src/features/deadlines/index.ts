/** «Хугацаа» (deadline харагдац) — нийтийн гарц.
 *
 *  Хүнд компонентуудыг (`ProjectDeadlinesTab`, `DashboardDeadlinesCard`)
 *  дуудагч тал `React.lazy`-ээр татдаг тул ЭНД re-export ХИЙХГҮЙ —
 *  барrel-ээр гаргавал lazy хил эвдэрч, төслийн хуудасны chunk-д шууд
 *  ороод ирнэ (`vite.config.ts`-ийн manualChunks-ийн зарчим). */
export { DeadlineChip } from './DeadlineChip';
export { DeadlineList } from './DeadlineList';
export { DeadlineRow } from './DeadlineRow';
export * from './types';
export {
  DEADLINES_KEY,
  invalidateDeadlines,
  useCalendarDeadlines,
  useDeadlineSummary,
  useProjectDeadlines,
  useUpcomingDeadlines,
} from './api';
