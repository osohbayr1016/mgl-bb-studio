import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Mic } from 'lucide-react';
import { apiFetch } from '@/shared/api/client';
import { PageContainer } from '@/shared/components/PageContainer';
import { PageHeader } from '@/shared/components/PageHeader';
import { useLanguage } from '@/shared/i18n';
import { MeetingProjectGrid } from './MeetingProjectGrid';
import {
  COMPANY_MEETINGS,
  MeetingProjectWorkspace,
  UNASSIGNED_PROJECT,
} from './MeetingProjectWorkspace';
import { UploadMeetingDialog } from './UploadMeetingDialog';
import {
  buildMeetingProjectRows,
  companyMeetingStats,
} from './meetingProjectStats';
import type { MeetingListItem } from './types';

interface ProjectRow {
  id: number;
  name: string;
  status?: string;
}

function parseProjectParam(raw: string | null): { id: number | null; param: string | null } {
  if (!raw) return { id: null, param: null };
  // `none` = 0333-аас өмнөх «төсөлгүй» холбоосын alias → компанийн хурал.
  if (raw === COMPANY_MEETINGS || raw === UNASSIGNED_PROJECT) return { id: null, param: COMPANY_MEETINGS };
  const parsed = Number(raw);
  if (Number.isFinite(parsed) && parsed > 0) return { id: parsed, param: String(parsed) };
  return { id: null, param: null };
}

export default function MeetingNotesPage() {
  const { t } = useLanguage();
  const [searchParams, setSearchParams] = useSearchParams();
  const projectRaw = searchParams.get('project');
  const { id: selectedProjectId, param: projectParam } = parseProjectParam(projectRaw);
  const showProjectList = projectParam == null;

  const projectsQuery = useQuery({
    queryKey: ['projects-min'],
    queryFn: () => apiFetch<{ projects: ProjectRow[] }>('/projects'),
  });

  const meetingsQuery = useQuery({
    queryKey: ['meetings', 'all-for-grid'],
    queryFn: () => apiFetch<{ meetings: MeetingListItem[] }>('/meetings'),
    enabled: showProjectList,
  });

  const projects = useMemo(
    () => (projectsQuery.data?.projects ?? []).filter((p) => p.status !== 'archived'),
    [projectsQuery.data],
  );

  const gridProjects = useMemo(
    () => buildMeetingProjectRows(projects, meetingsQuery.data?.meetings ?? []),
    [projects, meetingsQuery.data?.meetings],
  );

  const company = useMemo(
    () => companyMeetingStats(meetingsQuery.data?.meetings ?? []),
    [meetingsQuery.data?.meetings],
  );

  const projectName = useMemo(() => {
    if (projectParam === COMPANY_MEETINGS) return t('meetingNotes.companyMeetings');
    return projects.find((p) => p.id === selectedProjectId)?.name ?? t('meetingNotes.title');
  }, [projectParam, projects, selectedProjectId, t]);

  const selectProject = useCallback(
    (id: number) => setSearchParams({ project: String(id) }, { replace: false }),
    [setSearchParams],
  );

  const selectCompany = useCallback(
    () => setSearchParams({ project: COMPANY_MEETINGS }, { replace: false }),
    [setSearchParams],
  );

  const backToProjects = useCallback(() => setSearchParams({}, { replace: false }), [setSearchParams]);

  const gridLoading = projectsQuery.isLoading || meetingsQuery.isLoading;

  return (
    <PageContainer>
      <PageHeader
        title={t('meetingNotes.title')}
        description={showProjectList ? t('meetingNotes.projectListHint') : undefined}
        icon={Mic}
        actions={showProjectList ? <UploadMeetingDialog /> : undefined}
      />

      {showProjectList ? (
        <MeetingProjectGrid
          projects={gridProjects}
          companyCount={company.count}
          companyLastDate={company.lastDate}
          loading={gridLoading}
          onSelect={selectProject}
          onSelectCompany={selectCompany}
        />
      ) : (
        <MeetingProjectWorkspace
          projectId={projectParam === COMPANY_MEETINGS ? null : selectedProjectId}
          projectName={projectName}
          projectParam={projectParam!}
          onBack={backToProjects}
        />
      )}
    </PageContainer>
  );
}
