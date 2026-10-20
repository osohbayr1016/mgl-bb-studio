/** Day-grouped feed of progress reports for a project.
 *  Extracted verbatim from `ProjectDetailPage.tsx` when that file was split
 *  into per-component modules — no behavioural change. */
import { useMemo } from 'react';
import { Calendar as CalendarIcon } from 'lucide-react';

import { formatDate } from '@/shared/lib/time';
import { useLanguage } from '@/shared/i18n';

import { ActivityRow } from './ActivityRow';
import type { ActivityEntry } from './types';

export function ActivityFeed({ entries }: { entries: ActivityEntry[] }) {
  const { t } = useLanguage();
  /* Group by calendar day so the feed scans like a journal. Day is
     derived from the entry's `date` (the day the work happened) rather
     than `created_at` (when the report was filed) — operators care more
     about the work day. */
  const groups = useMemo(() => {
    const map = new Map<string, ActivityEntry[]>();
    for (const e of entries) {
      const key = e.date;
      const arr = map.get(key) ?? [];
      arr.push(e);
      map.set(key, arr);
    }
    return Array.from(map.entries()).sort(([a], [b]) => (a < b ? 1 : -1));
  }, [entries]);

  const today = new Date().toISOString().slice(0, 10);
  const yest = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);

  return (
    <div className="space-y-5">
      {groups.map(([day, list]) => {
        const label =
          day === today
            ? t('projectDetailPage.today')
            : day === yest
              ? t('projectDetailPage.yesterday')
              : formatDate(new Date(day));
        return (
          <div key={day} className="space-y-1.5">
            <div className="flex items-center gap-2 px-1">
              <CalendarIcon className="h-3 w-3 text-muted-foreground" />
              <span className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">
                {label}
              </span>
              <span className="text-[10px] text-muted-foreground/60">· {list.length}</span>
              <div className="flex-1 h-px bg-border/40 ml-2" />
            </div>
            <div className="divide-y divide-border/40 rounded-lg border border-border/40 bg-muted/10">
              {list.map((e) => (
                <ActivityRow key={e.id} entry={e} />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default ActivityFeed;
