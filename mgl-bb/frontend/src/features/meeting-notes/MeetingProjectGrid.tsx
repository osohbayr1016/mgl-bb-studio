import { Building2, ChevronRight, Loader2, Mic } from 'lucide-react';
import { useLanguage } from '@/shared/i18n';
import { formatDate } from '@/shared/lib/time';
import { cn } from '@/shared/lib/utils';
import { EmptyState } from '@/shared/components/EmptyState';
import type { MeetingProjectRow } from './types';

export function MeetingProjectGrid({
  projects,
  companyCount,
  companyLastDate,
  loading,
  onSelect,
  onSelectCompany,
}: {
  projects: MeetingProjectRow[];
  companyCount: number;
  companyLastDate: string | null;
  loading: boolean;
  onSelect: (id: number) => void;
  /** Компанийн хурлын карт ҮРГЭЛЖ харагдана (0 байсан ч — тэндээс үүсгэнэ). */
  onSelectCompany: () => void;
}) {
  const { t } = useLanguage();

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (projects.length === 0 && companyCount === 0) {
    return (
      <EmptyState
        icon={Mic}
        title={t('meetingNotes.projectListEmpty')}
        description={t('meetingNotes.projectListEmptyHint')}
      />
    );
  }

  return (
    <ul className="grid gap-2 sm:grid-cols-2">
      <li>
        <button
          type="button"
          onClick={onSelectCompany}
          data-testid="meeting-company-card"
          className={cn(
            'flex w-full items-center gap-3 rounded-lg border border-primary/30 bg-primary/5 px-4 py-3 text-left',
            'transition-colors hover:border-primary/60 hover:bg-primary/10',
          )}
        >
          <Building2 className="h-5 w-5 shrink-0 text-primary" />
          <div className="min-w-0 flex-1">
            <div className="truncate font-medium">{t('meetingNotes.companyMeetings')}</div>
            <div className="mt-0.5 flex flex-wrap gap-x-2 text-xs text-muted-foreground">
              <span className="tabular-nums">
                {t('meetingNotes.projectMeetingMeta', { count: companyCount })}
              </span>
              {companyLastDate && (
                <span className="tabular-nums">
                  {t('meetingNotes.lastMeeting', { date: formatDate(companyLastDate) })}
                </span>
              )}
            </div>
          </div>
          <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
        </button>
      </li>
      {projects.map((p) => (
        <li key={p.id}>
          <button
            type="button"
            onClick={() => onSelect(p.id)}
            className={cn(
              'flex w-full items-center gap-3 rounded-lg border bg-card px-4 py-3 text-left',
              'transition-colors hover:border-primary/40 hover:bg-accent/30',
            )}
          >
            <div className="min-w-0 flex-1">
              <div className="truncate font-medium">{p.name}</div>
              <div className="mt-0.5 flex flex-wrap gap-x-2 text-xs text-muted-foreground">
                <span className="tabular-nums">
                  {t('meetingNotes.projectMeetingMeta', { count: p.meeting_count })}
                </span>
                {p.last_meeting_date && (
                  <span className="tabular-nums">
                    {t('meetingNotes.lastMeeting', { date: formatDate(p.last_meeting_date) })}
                  </span>
                )}
              </div>
            </div>
            <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
          </button>
        </li>
      ))}
    </ul>
  );
}
