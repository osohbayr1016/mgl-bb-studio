import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Building2 } from 'lucide-react';
import { apiFetch } from '@/shared/api/client';
import { useLanguage } from '@/shared/i18n';
import { Button } from '@/ui/button';
import { MeetingListTable } from './MeetingListTable';
import { UploadMeetingDialog } from './UploadMeetingDialog';
import { isMeetingBusy } from './MeetingStatusBadge';
import type { MeetingListItem } from './types';

/** `?project=company` — компанийн (төсөлтэй холбоогүй) хурлын жагсаалт.
 *  Хуучин `none` утгыг MeetingNotesPage alias болгож хүлээн авдаг. */
export const COMPANY_MEETINGS = 'company';
/** @deprecated 0333-аас хойш `COMPANY_MEETINGS`; хуучин холбоосын alias. */
export const UNASSIGNED_PROJECT = 'none';

export function meetingNotesListPath(projectParam: string | null): string {
  if (!projectParam) return '/app/meeting-notes';
  return `/app/meeting-notes?project=${projectParam}`;
}

export function meetingDetailPath(meetingId: number, projectParam: string | null): string {
  const base = `/app/meeting-notes/${meetingId}`;
  if (!projectParam) return base;
  return `${base}?project=${projectParam}`;
}

export function MeetingProjectWorkspace({
  projectId,
  projectName,
  projectParam,
  onBack,
}: {
  projectId: number | null;
  projectName: string;
  projectParam: string;
  onBack: () => void;
}) {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const isCompany = projectParam === COMPANY_MEETINGS;

  const { data, isLoading } = useQuery({
    queryKey: ['meetings', isCompany ? 'company' : projectId],
    queryFn: () =>
      apiFetch<{ meetings: MeetingListItem[] }>(
        isCompany ? '/meetings?kind=company' : `/meetings?project_id=${projectId}`,
      ),
    refetchInterval: (q) => {
      const rows = q.state.data?.meetings ?? [];
      return rows.some((m) => isMeetingBusy(m.status)) ? 5000 : false;
    },
  });

  const meetings = data?.meetings ?? [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" variant="ghost" size="sm" className="gap-1" onClick={onBack}>
          <ArrowLeft className="h-4 w-4" />
          {t('meetingNotes.backToProjects')}
        </Button>
        <h3 className="text-base font-semibold flex-1 min-w-0 truncate flex items-center gap-2">
          {isCompany && <Building2 className="h-4 w-4 text-muted-foreground shrink-0" />}
          {projectName}
        </h3>
        <UploadMeetingDialog
          defaultProjectId={isCompany ? null : projectId}
          defaultKind={isCompany ? 'company' : 'project'}
        />
      </div>

      <MeetingListTable
        meetings={meetings}
        isLoading={isLoading}
        emptyMessage={isCompany ? t('meetingNotes.emptyForCompany') : t('meetingNotes.emptyForProject')}
        // Олон төсөлтэй хурал энэ жагсаалтад бусад төслөө ч харуулна.
        showProjectName={!isCompany}
        currentProjectId={projectId}
        onOpen={(id) => navigate(meetingDetailPath(id, projectParam))}
      />
    </div>
  );
}
