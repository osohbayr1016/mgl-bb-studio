import { FileAudio, FileText, Loader2, Users } from 'lucide-react';
import { useLanguage } from '@/shared/i18n';
import { Card } from '@/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/ui/table';
import { MeetingStatusBadge } from './MeetingStatusBadge';
import { TranscribeProgress } from './TranscribeProgress';
import type { MeetingListItem } from './types';

function formatDuration(sec: number | null): string {
  if (!sec || sec <= 0) return '—';
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function MeetingListTable({
  meetings,
  isLoading,
  emptyMessage,
  showProjectName = false,
  currentProjectId = null,
  onOpen,
}: {
  meetings: MeetingListItem[];
  isLoading: boolean;
  emptyMessage: string;
  /** Төслийн нэрсийг мөрийн доор харуулна (олон төсөлтэй хурал — бүгдийг). */
  showProjectName?: boolean;
  /** Одоо харж буй төсөл — түүнийг нэрсээс хасч, «бусад» төслүүдийг л үлдээнэ. */
  currentProjectId?: number | null;
  onOpen: (id: number) => void;
}) {
  const { t } = useLanguage();

  if (isLoading) {
    return (
      <div role="status" className="py-10 text-center text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin mx-auto" />
        <span className="sr-only">{t('common.loading')}</span>
      </div>
    );
  }

  if (meetings.length === 0) {
    return (
      <Card className="border-dashed border-2 bg-muted/20">
        <div className="py-12 text-center text-muted-foreground flex flex-col items-center gap-3">
          <FileAudio className="h-10 w-10 opacity-20" />
          <p>{emptyMessage}</p>
        </div>
      </Card>
    );
  }

  return (
    <Card className="overflow-hidden">
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('meetingNotes.meetingTitle')}</TableHead>
              <TableHead>{t('meetingNotes.meetingDate')}</TableHead>
              <TableHead className="text-right">{t('meetingNotes.attendeeCount')}</TableHead>
              <TableHead>{t('meetingNotes.duration')}</TableHead>
              <TableHead>{t('common.status')}</TableHead>
              <TableHead>{t('meetingNotes.uploadedBy')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {meetings.map((m) => (
              <TableRow
                key={m.id}
                role="button"
                tabIndex={0}
                className="cursor-pointer hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                onClick={() => onOpen(m.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onOpen(m.id);
                  }
                }}
              >
                <TableCell>
                  <div className="font-medium flex items-center gap-2">
                    {m.duration_seconds || m.status !== 'draft' ? (
                      <FileAudio className="h-4 w-4 text-primary flex-shrink-0" />
                    ) : (
                      <FileText className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                    )}
                    {m.title}
                  </div>
                  {showProjectName && (() => {
                    const others = (m.projects ?? []).filter((p) => p.id !== currentProjectId);
                    if (!others.length) return null;
                    const names = others.map((p) => p.name).join(' · ');
                    return (
                      <div className="text-xs text-muted-foreground mt-1 truncate max-w-[420px]">
                        {currentProjectId != null ? `+ ${names}` : names}
                      </div>
                    );
                  })()}
                </TableCell>
                <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                  {m.meeting_date || '—'}
                  {m.meeting_time ? <span className="ml-1">{m.meeting_time}</span> : null}
                </TableCell>
                <TableCell className="text-sm tabular-nums text-muted-foreground text-right">
                  {m.attendee_count > 0 ? (
                    <span className="inline-flex items-center gap-1" title={t('meetingNotes.attendeeCount')}>
                      <Users className="h-3.5 w-3.5" />
                      {m.attendee_count}
                    </span>
                  ) : (
                    '—'
                  )}
                </TableCell>
                <TableCell className="text-sm tabular-nums text-muted-foreground">
                  {formatDuration(m.duration_seconds)}
                </TableCell>
                <TableCell onClick={(e) => e.stopPropagation()}>
                  <div className="space-y-1 min-w-[120px]">
                    <MeetingStatusBadge status={m.status} />
                    {m.status === 'transcribing' && (
                      <TranscribeProgress
                        compact
                        startedAt={m.submitted_at}
                        estimateSeconds={m.duration_seconds}
                      />
                    )}
                    {m.status === 'analyzing' && (
                      <TranscribeProgress
                        compact
                        startedAt={m.updated_at}
                        estimateSeconds={m.duration_seconds ? m.duration_seconds * 0.25 : 40}
                      />
                    )}
                  </div>
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {m.created_by_name || '—'}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </Card>
  );
}
