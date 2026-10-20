import { Link } from 'react-router-dom';
import { Activity } from 'lucide-react';
import { useLanguage } from '@/shared/i18n';
import { cn } from '@/shared/lib/utils';
import { formatDisplayName, formatProjectShortName } from '@/shared/lib/formatting';
import type { TeamOverview } from '@/shared/types';
import { progressTone, TONE_TEXT } from '../../lib/teamView';
import { PersonAvatar } from '../TeamPeopleBits';
import { focusHandlers, type BoardFocus } from './boardFocus';

/** Самбарын доод туузанд харагдах бичлэгийн дээд тоо (2 багана × 2 мөр). */
const MAX_ITEMS = 4;

/**
 * «Сүүлийн үйл ажиллагаа» — гишүүдийн баталгаажсан сүүлийн ахиц.  Төслийн жагсаалтын
 * доор тогтмол өндөртэй туузаар байрлана (жагсаалт гүйлгэгдсэн ч алга болохгүй).
 */
export function RecentProgress({
  items,
  hrefOf,
  focus,
  onFocus,
}: {
  items: TeamOverview['recent_progress'];
  hrefOf: (userId: number) => string;
  focus: BoardFocus;
  onFocus: (f: BoardFocus) => void;
}) {
  const { t } = useLanguage();
  const shown = items.slice(0, MAX_ITEMS);

  return (
    <section
      className="shrink-0 overflow-hidden rounded-xl border border-border/60 bg-card lg:[@media(max-height:820px)]:hidden"
      aria-labelledby="team-recent-title"
      data-testid="team-recent-progress"
    >
      <header className="flex items-center gap-2 border-b border-border/60 px-4 py-1.5">
        <Activity className="size-3.5 text-primary" aria-hidden />
        <h2 id="team-recent-title" className="text-label text-muted-foreground uppercase">
          {t('teamDetailPage.recentActivity')}
        </h2>
      </header>
      {shown.length === 0 ? (
        <p className="px-4 py-3 text-micro text-muted-foreground">{t('teamDetailPage.noRecentActivity')}</p>
      ) : (
        <ul className="m-0 grid list-none gap-x-6 p-0 px-3 py-1 md:grid-cols-2">
          {shown.map((r) => {
            const name = formatDisplayName(r.full_name);
            const what = [r.item_name || t('teamDetailPage.taskFallback'), r.project_name && formatProjectShortName(r.project_name)]
              .filter(Boolean)
              .join(' · ');
            const tone = progressTone(r.percentage);
            const highlighted = focus?.kind === 'person' && focus.id === r.user_id;
            return (
              <li
                key={r.id}
                {...focusHandlers({ kind: 'person', id: r.user_id }, onFocus)}
                className={cn('rounded-md px-1', highlighted && 'bg-primary/10')}
              >
                <Link
                  to={r.project_id ? `/app/projects/${r.project_id}` : hrefOf(r.user_id)}
                  title={`${name}\n${what}${r.notes ? `\n${r.notes}` : ''}`}
                  className="flex items-center gap-2 py-1 text-micro focus-visible:outline-none focus-visible:underline"
                >
                  <PersonAvatar member={r} size="xs" />
                  <span className="w-28 shrink-0 truncate font-medium">{name}</span>
                  <span className={cn('w-10 shrink-0 text-right font-semibold tabular-nums', TONE_TEXT[tone])}>
                    {Math.round(r.percentage)}%
                  </span>
                  <span className="min-w-0 flex-1 truncate text-muted-foreground">{what}</span>
                  <span className="shrink-0 text-muted-subtle tabular-nums">{r.date.slice(5).replace('-', '.')}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
