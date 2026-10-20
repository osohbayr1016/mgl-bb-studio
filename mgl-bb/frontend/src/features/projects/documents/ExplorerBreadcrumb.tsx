import { Link } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { useLanguage } from '@/shared/i18n';
import type { BrowseTrail } from './types';

export function ExplorerBreadcrumb({
  archiveId,
  archiveName,
  trail,
}: {
  archiveId: number;
  archiveName: string;
  trail: BrowseTrail[];
}) {
  const { t } = useLanguage();
  const root = `/app/documents/${archiveId}`;
  const current = trail.length > 0 ? trail[trail.length - 1] : undefined;
  return (
    <nav className="flex min-w-0 flex-wrap items-center gap-0.5 px-4 py-2.5 text-xs text-muted-foreground">
      <Link to="/app/documents" className="rounded-md px-1.5 py-0.5 hover:bg-muted hover:text-foreground">
        {t('nav.projectDocuments')}
      </Link>
      <ChevronRight className="h-3 w-3 shrink-0 opacity-50" />
      {trail.length === 0 ? (
        <span className="truncate px-1.5 font-medium text-foreground">{archiveName}</span>
      ) : (
        <>
          <Link to={root} className="truncate rounded-md px-1.5 py-0.5 hover:bg-muted hover:text-foreground">
            {archiveName}
          </Link>
          {trail.map((item) => (
            <span key={item.id} className="flex min-w-0 items-center gap-0.5">
              <ChevronRight className="h-3 w-3 shrink-0 opacity-50" />
              {item.id === current?.id ? (
                <span className="truncate px-1.5 font-medium text-foreground">{item.name}</span>
              ) : (
                <Link
                  to={`${root}?folder=${item.id}`}
                  className="truncate rounded-md px-1.5 py-0.5 hover:bg-muted hover:text-foreground"
                >
                  {item.name}
                </Link>
              )}
            </span>
          ))}
        </>
      )}
    </nav>
  );
}
