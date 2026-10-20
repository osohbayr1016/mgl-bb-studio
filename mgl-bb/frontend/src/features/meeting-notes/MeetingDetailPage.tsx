import { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate, Link, useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch, downloadPdf, MEDIA_BASE_URL } from '@/shared/api/client';
import { confirmDialog } from '@/shared/components/ConfirmDialog';
import { useLanguage } from '@/shared/i18n';
import { Card, CardContent, CardHeader, CardTitle } from '@/ui/card';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import { Textarea } from '@/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/ui/select';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/ui/dialog';
import { Checkbox } from '@/ui/checkbox';
import { toast } from '@/shared/components/Toast';
import type { Employee } from './ParticipantsEditor';
import {
  ArrowLeft,
  Loader2,
  Sparkles,
  RefreshCw,
  Trash2,
  ListChecks,
  CheckSquare,
  AlertTriangle,
  Copy,
  Check,
  Pencil,
  X,
  FileDown,
  Plus,
  ExternalLink,
  Users,
  Building2,
} from 'lucide-react';
import { MeetingStatusBadge, isMeetingBusy } from './MeetingStatusBadge';
import { TranscribeProgress } from './TranscribeProgress';
import { MeetingMetaForm } from './MeetingMetaForm';
import { MeetingRecorderCard } from './MeetingRecorderCard';
import { FinalTextEditor } from './FinalTextEditor';
import {
  EMPTY_META,
  type MeetingMeta,
  type MeetingKind,
  type MeetingProjectRef,
  type ActionItem,
  type ParticipantGroup,
  type DiscussionSection,
} from './types';
import { meetingNotesListPath } from './MeetingProjectWorkspace';

interface MeetingDetail {
  meeting: {
    id: number;
    title: string;
    meeting_date: string | null;
    meeting_time: string | null;
    location: string | null;
    purpose: string | null;
    conclusion: string | null;
    project_id: number | null;
    project_name: string | null;
    kind: MeetingKind;
    projects: MeetingProjectRef[];
    attendee_count: number;
    participants: ParticipantGroup[];
    discussion: DiscussionSection[];
    next_meeting_date: string | null;
    next_meeting_time: string | null;
    attendees: string | null;
    language: string;
    status: string;
    error: string | null;
    final_text: string | null;
    final_text_updated_at: string | null;
    final_text_updated_by_name: string | null;
    created_by_name: string | null;
    created_at: string;
    updated_at: string;
  };
  recording: {
    duration_seconds: number | null;
    content_type: string | null;
    stt_status: string | null;
    submitted_at: string | null;
  } | null;
  transcript: {
    language: string | null;
    transcript_text: string | null;
    speaker_count: number | null;
    word_count: number | null;
  } | null;
  analysis: {
    summary: string | null;
    decisions: unknown[];
    action_items: unknown[];
    model: string | null;
    created_at: string;
  } | null;
  audio_url: string | null;
}

function toActionItem(a: unknown): ActionItem | null {
  if (typeof a === 'string') return a.trim() ? { text: a } : null;
  if (a && typeof a === 'object') {
    const o = a as Record<string, unknown>;
    const text = typeof o.text === 'string' ? o.text : '';
    if (!text.trim()) return null;
    return {
      text,
      owner: typeof o.owner === 'string' && o.owner.trim() ? o.owner : undefined,
      due: typeof o.due === 'string' && o.due.trim() ? o.due : undefined,
    };
  }
  return null;
}

export default function MeetingDetailPage() {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const qc = useQueryClient();
  // `?record=1` — үүсгэх dialog-оос ирсэн: бичлэгийг шууд эхлүүлнэ, дараа нь
  // параметрийг URL-ээс арилгана (дахин ачаалахад дахин асуухгүй).
  const autoRecord = searchParams.get('record') === '1';
  const consumeAutoRecord = () => {
    const next = new URLSearchParams(searchParams);
    next.delete('record');
    setSearchParams(next, { replace: true });
  };
  const { id } = useParams<{ id: string }>();
  const meetingId = Number(id);

  const backToList = (meetingProjectId?: number | null) => {
    const projectParam = searchParams.get('project');
    if (projectParam) {
      navigate(meetingNotesListPath(projectParam));
      return;
    }
    if (meetingProjectId) {
      navigate(meetingNotesListPath(String(meetingProjectId)));
      return;
    }
    navigate(meetingNotesListPath(null));
  };
  const [retranscribeLang, setRetranscribeLang] = useState('mn');
  const [copied, setCopied] = useState(false);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [editingMeta, setEditingMeta] = useState(false);
  const [metaDraft, setMetaDraft] = useState<MeetingMeta>(EMPTY_META);
  const [editingAnalysis, setEditingAnalysis] = useState(false);
  const [summaryDraft, setSummaryDraft] = useState('');
  const [decisionsDraft, setDecisionsDraft] = useState<string[]>([]);
  const [actionsDraft, setActionsDraft] = useState<ActionItem[]>([]);

  /** Action item → даалгавар гүүрийн dialog-ийн төлөв.  Мөр бүр нэг хийх
   *  ажил: оруулах эсэх, засварлагдах нэр, нэг хариуцагч, дуусах огноо.
   *  ownerHint нь хурлын шинжилгээний чөлөөт "owner" текст — ажилтантай
   *  автоматаар тааруулахад (доорх effect) ашиглана. */
  type TaskRow = {
    include: boolean;
    text: string;
    assignee_id: number | null;
    due: string;
    ownerHint?: string;
  };
  const [createTasksOpen, setCreateTasksOpen] = useState(false);
  const [taskRows, setTaskRows] = useState<TaskRow[]>([]);
  const [taskProjectId, setTaskProjectId] = useState<number | null>(null);
  const ownerMatchAppliedRef = useRef(false);

  const { data, isLoading } = useQuery({
    queryKey: ['meeting', meetingId],
    queryFn: () => apiFetch<MeetingDetail>(`/meetings/${meetingId}`),
    enabled: Number.isFinite(meetingId),
    refetchInterval: (q) => (isMeetingBusy(q.state.data?.meeting?.status) ? 5000 : false),
  });

  const projectsQuery = useQuery({
    queryKey: ['projects-min'],
    queryFn: () => apiFetch<{ projects: Array<{ id: number; name: string }> }>('/projects'),
    enabled: editingMeta || createTasksOpen,
  });

  // Ажилтны жагсаалт — гүүрийн dialog-ийн хариуцагч сонгогчид (MetaForm-той
  // ижил cache key тул давхар татахгүй).
  const employeesQuery = useQuery({
    queryKey: ['employees-min'],
    queryFn: () => apiFetch<{ users: Employee[] }>('/users'),
    enabled: createTasksOpen,
  });

  // Хурлын "owner" чөлөөт нэрийг ажилтантай тааруулна — нэг л хүн таарвал
  // автоматаар сонгоно; dialog нээгдэх бүрд нэг л удаа хэрэгжинэ, хэрэглэгчийн
  // гар сонголтыг дарж бичихгүй.
  useEffect(() => {
    if (!createTasksOpen || ownerMatchAppliedRef.current) return;
    const employees = employeesQuery.data?.users;
    if (!employees?.length) return;
    ownerMatchAppliedRef.current = true;
    setTaskRows((rows) =>
      rows.map((r) => {
        if (r.assignee_id !== null || !r.ownerHint) return r;
        const needle = r.ownerHint.trim().toLowerCase();
        const hits = employees.filter((e) => {
          const name = e.full_name.toLowerCase();
          // Урвуу чиглэлийг зөвхөн урт (≥6) нэрэнд зөвшөөрнө — богино нэр
          // хамаагүй owner текстээс санамсаргүй таарахаас сэргийлнэ.
          return name.includes(needle) || (name.length >= 6 && needle.includes(name));
        });
        return hits.length === 1 && hits[0] ? { ...r, assignee_id: hits[0].id } : r;
      }),
    );
  }, [createTasksOpen, employeesQuery.data]);

  const createTasksMut = useMutation({
    mutationFn: () => {
      const items = taskRows
        .filter((r) => r.include && r.text.trim())
        .map((r) => ({
          text: r.text.trim(),
          assignee_ids: r.assignee_id ? [r.assignee_id] : [],
          due_date: r.due || null,
        }));
      return apiFetch<{ tasks: Array<{ id: number }>; project_name: string }>(
        `/meetings/${meetingId}/tasks`,
        { method: 'POST', data: { project_id: taskProjectId, items } },
      );
    },
    onSuccess: (res) => {
      toast.success(
        t('meetingNotes.tasksCreated', { count: res.tasks.length }),
        res.project_name,
      );
      setCreateTasksOpen(false);
    },
    onError: () => toast.error(t('meetingNotes.createTasksFailed')),
  });

  const analyzeMut = useMutation({
    mutationFn: () => apiFetch(`/meetings/${meetingId}/analyze`, { method: 'POST', data: {} }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['meeting', meetingId] }),
    onError: () => toast.error(t('common.actionFailed')),
  });
  const retranscribeMut = useMutation({
    mutationFn: () =>
      apiFetch(`/meetings/${meetingId}/retranscribe`, {
        method: 'POST',
        data: { language: retranscribeLang },
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['meeting', meetingId] }),
    onError: () => toast.error(t('common.actionFailed')),
  });
  const deleteMut = useMutation({
    mutationFn: () => apiFetch(`/meetings/${meetingId}`, { method: 'DELETE' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['meetings'] });
      backToList(data?.meeting?.project_id ?? null);
    },
    onError: () => toast.error(t('common.deleteFailed')),
  });
  const saveMetaMut = useMutation({
    mutationFn: () =>
      apiFetch(`/meetings/${meetingId}`, {
        method: 'PUT',
        data: {
          title: metaDraft.title.trim(),
          meeting_date: metaDraft.meeting_date || null,
          meeting_time: metaDraft.meeting_time || null,
          location: metaDraft.location || null,
          purpose: metaDraft.purpose || null,
          conclusion: metaDraft.conclusion || null,
          participants: metaDraft.participants,
          discussion: metaDraft.discussion,
          next_meeting_date: metaDraft.next_meeting_date || null,
          // Огноогүй цаг протоколд хэвлэгдэхгүй тул хамт хоослоно (сервер ч мөн адил).
          next_meeting_time: metaDraft.next_meeting_date
            ? metaDraft.next_meeting_time || null
            : null,
          kind: metaDraft.kind,
          project_ids: metaDraft.kind === 'company' ? [] : metaDraft.project_ids,
          language: metaDraft.language,
        },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['meeting', meetingId] });
      qc.invalidateQueries({ queryKey: ['meetings'] });
      setEditingMeta(false);
    },
    onError: () => toast.error(t('common.saveFailed')),
  });
  const saveAnalysisMut = useMutation({
    mutationFn: () =>
      apiFetch(`/meetings/${meetingId}/analysis`, {
        method: 'PUT',
        data: {
          summary: summaryDraft,
          decisions: decisionsDraft.filter((d) => d.trim()),
          action_items: actionsDraft.filter((a) => a.text.trim()),
        },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['meeting', meetingId] });
      setEditingAnalysis(false);
    },
    onError: () => toast.error(t('common.saveFailed')),
  });

  if (isLoading) {
    return (
      <div className="py-10 text-center" role="status">
        <Loader2 className="h-6 w-6 animate-spin mx-auto" />
        <span className="sr-only">{t('common.loading')}</span>
      </div>
    );
  }
  if (!data) {
    return (
      <div className="space-y-4">
        <Button variant="outline" size="sm" onClick={() => backToList()}>
          <ArrowLeft className="h-4 w-4 mr-2" /> {t('common.back')}
        </Button>
        <p className="text-muted-foreground">{t('meetingNotes.notFound')}</p>
      </div>
    );
  }

  const { meeting, recording, transcript, analysis, audio_url } = data;
  const transcribed = !!transcript?.transcript_text;
  // Шинжилгээ транскрипт ЭСВЭЛ гараар бичсэн эцсийн текстээс ажиллана.
  const analyzable = transcribed || !!meeting.final_text?.trim();
  const decisions = (analysis?.decisions ?? []).filter(
    (d): d is string => typeof d === 'string' && d.trim() !== '',
  );
  const actionItems = (analysis?.action_items ?? [])
    .map(toActionItem)
    .filter((a): a is ActionItem => !!a);

  const startEditMeta = () => {
    setMetaDraft({
      title: meeting.title ?? '',
      meeting_date: meeting.meeting_date ?? '',
      meeting_time: meeting.meeting_time ?? '',
      location: meeting.location ?? '',
      purpose: meeting.purpose ?? '',
      conclusion: meeting.conclusion ?? '',
      language: meeting.language ?? 'mn',
      kind: meeting.kind ?? (meeting.projects?.length ? 'project' : 'company'),
      project_ids: (meeting.projects ?? []).map((p) => p.id),
      participants: Array.isArray(meeting.participants) ? meeting.participants : [],
      discussion: Array.isArray(meeting.discussion) ? meeting.discussion : [],
      next_meeting_date: meeting.next_meeting_date ?? '',
      next_meeting_time: meeting.next_meeting_time ?? '',
    });
    setEditingMeta(true);
  };

  const startEditAnalysis = () => {
    setSummaryDraft(analysis?.summary ?? '');
    setDecisionsDraft(decisions.length ? decisions : ['']);
    setActionsDraft(actionItems.length ? actionItems : [{ text: '' }]);
    setEditingAnalysis(true);
  };

  const openCreateTasks = () => {
    setTaskRows(
      actionItems.map((a) => ({
        include: true,
        text: a.text,
        assignee_id: null,
        // Зөвхөн ISO огноог урьдчилан бөглөнө — "даваа гариг" мэт чөлөөт
        // текстийг хоосон үлдээж хэрэглэгч өөрөө сонгоно.
        due: a.due && /^\d{4}-\d{2}-\d{2}$/.test(a.due) ? a.due : '',
        ownerHint: a.owner,
      })),
    );
    setTaskProjectId(meeting.project_id ?? null);
    ownerMatchAppliedRef.current = false;
    setCreateTasksOpen(true);
  };

  // Хадгалахаас өмнө гарчгийг шалгана — хоосон бол чимээгүй алгасахын оронд
  // анхааруулга харуулна.
  const saveMeta = () => {
    if (!metaDraft.title.trim()) {
      toast.warn(t('common.saveFailed'));
      return;
    }
    if (metaDraft.kind === 'project' && metaDraft.project_ids.length === 0) {
      toast.warn(t('meetingNotes.selectProjects'));
      return;
    }
    saveMetaMut.mutate();
  };

  const includedTaskCount = taskRows.filter((r) => r.include && r.text.trim()).length;

  const patchTaskRow = (idx: number, patch: Partial<TaskRow>) => {
    setTaskRows((rows) => rows.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  };

  const copyMcpPrompt = async () => {
    const prompt = t('meetingNotes.mcpPromptTemplate', { id: meeting.id, title: meeting.title });
    try {
      await navigator.clipboard.writeText(prompt);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard unavailable */
    }
  };

  const handlePdf = async () => {
    setPdfLoading(true);
    try {
      await downloadPdf(`/meetings/${meetingId}/pdf`, `${meeting.title || 'meeting'}.pdf`);
    } catch (err) {
      toast.error(t('common.error'), err instanceof Error ? err.message : 'PDF error');
    } finally {
      setPdfLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-4">
          <Button variant="outline" size="sm" onClick={() => backToList(meeting.project_id)}>
            <ArrowLeft className="h-4 w-4 mr-2" /> {t('common.back')}
          </Button>
          <div>
            <h1 className="text-xl font-bold">{meeting.title}</h1>
            <div className="text-sm text-muted-foreground mt-0.5 flex items-center gap-2 flex-wrap">
              {meeting.meeting_date && <span>{meeting.meeting_date}</span>}
              {meeting.meeting_time && <span>· {meeting.meeting_time}</span>}
              {meeting.created_by_name && <span>· {meeting.created_by_name}</span>}
              <span className="inline-flex items-center gap-1" data-testid="meeting-attendee-count">
                · <Users className="h-3.5 w-3.5" />
                {t('meetingNotes.attendeeCountValue', { count: meeting.attendee_count ?? 0 })}
              </span>
            </div>
            <div className="mt-1.5 flex flex-wrap gap-1.5" data-testid="meeting-project-chips">
              {meeting.kind === 'company' || !(meeting.projects?.length) ? (
                <span className="inline-flex items-center gap-1 rounded-full border border-border bg-muted/40 px-2 py-0.5 text-xs">
                  <Building2 className="h-3 w-3" /> {t('meetingNotes.companyMeeting')}
                </span>
              ) : (
                meeting.projects.map((p) => (
                  <Link
                    key={p.id}
                    to={`/app/projects/${p.id}`}
                    className="inline-flex items-center gap-1 rounded-full border border-border bg-muted/40 px-2 py-0.5 text-xs hover:border-primary/50 hover:text-primary"
                  >
                    {p.name}
                    <ExternalLink className="h-3 w-3" />
                  </Link>
                ))
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <Button variant="outline" size="sm" title={t('meetingNotes.copyMcpPromptHint')} onClick={copyMcpPrompt}>
            {copied ? <Check className="h-4 w-4 mr-2" /> : <Copy className="h-4 w-4 mr-2" />}
            {copied ? t('meetingNotes.copied') : t('meetingNotes.copyMcpPrompt')}
          </Button>
          <Button variant="outline" size="sm" onClick={handlePdf} disabled={pdfLoading}>
            {pdfLoading ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <FileDown className="h-4 w-4 mr-2" />
            )}
            {t('meetingNotes.downloadPdf')}
          </Button>
          <MeetingStatusBadge status={meeting.status} />
        </div>
      </div>

      {meeting.error && (
        <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0" />
          <span>{meeting.error}</span>
        </div>
      )}

      {/* Minutes info */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2">
          <CardTitle className="text-base">{t('meetingNotes.infoTitle')}</CardTitle>
          {editingMeta ? (
            <div className="flex gap-2">
              <Button
                size="sm"
                onClick={saveMeta}
                disabled={saveMetaMut.isPending}
              >
                {saveMetaMut.isPending ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Check className="h-4 w-4 mr-2" />
                )}
                {t('common.save')}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setEditingMeta(false)}>
                <X className="h-4 w-4 mr-2" /> {t('common.cancel')}
              </Button>
            </div>
          ) : (
            <Button size="sm" variant="outline" onClick={startEditMeta}>
              <Pencil className="h-4 w-4 mr-2" /> {t('common.edit')}
            </Button>
          )}
        </CardHeader>
        <CardContent>
          {editingMeta ? (
            <MeetingMetaForm
              value={metaDraft}
              onPatch={(p) => setMetaDraft((m) => ({ ...m, ...p }))}
              projects={projectsQuery.data?.projects ?? []}
            />
          ) : (
            <div className="space-y-4 text-sm">
              <InfoGrid>
                <InfoRow label={t('meetingNotes.meetingDate')} value={meeting.meeting_date} />
                <InfoRow label={t('meetingNotes.meetingTime')} value={meeting.meeting_time} />
                <InfoRow label={t('meetingNotes.location')} value={meeting.location} full />
                <InfoRow
                  label={t('meetingNotes.projects')}
                  full
                  value={
                    meeting.kind === 'company' || !meeting.projects?.length ? (
                      <span className="text-muted-foreground">{t('meetingNotes.companyMeeting')}</span>
                    ) : (
                      <span className="inline-flex flex-wrap gap-x-3 gap-y-1">
                        {meeting.projects.map((p) => (
                          <Link
                            key={p.id}
                            to={`/app/projects/${p.id}`}
                            className="text-primary hover:underline inline-flex items-center gap-1"
                          >
                            {p.name}
                            <ExternalLink className="h-3 w-3" />
                          </Link>
                        ))}
                      </span>
                    )
                  }
                />
                <InfoRow
                  label={t('meetingNotes.attendeeCount')}
                  value={t('meetingNotes.attendeeCountValue', { count: meeting.attendee_count ?? 0 })}
                />
              </InfoGrid>
              {meeting.purpose && (
                <div>
                  <div className="text-xs text-muted-foreground mb-0.5">
                    {t('meetingNotes.purpose')}
                  </div>
                  <p className="whitespace-pre-wrap">{meeting.purpose}</p>
                </div>
              )}
              {Array.isArray(meeting.participants) && meeting.participants.length > 0 && (
                <div>
                  <div className="text-xs text-muted-foreground mb-1">
                    {t('meetingNotes.participants')}
                  </div>
                  <ParticipantsView groups={meeting.participants} />
                </div>
              )}
              {Array.isArray(meeting.discussion) && meeting.discussion.length > 0 && (
                <div>
                  <div className="text-xs text-muted-foreground mb-1">
                    {t('meetingNotes.discussion')}
                  </div>
                  <DiscussionView sections={meeting.discussion} />
                </div>
              )}
              {(meeting.next_meeting_date || meeting.next_meeting_time) && (
                <div>
                  <span className="text-xs text-muted-foreground">
                    {t('meetingNotes.nextMeeting')}:{' '}
                  </span>
                  <span className="text-foreground">
                    {[meeting.next_meeting_date, meeting.next_meeting_time]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                </div>
              )}
              {meeting.conclusion && (
                <div>
                  <div className="text-xs text-muted-foreground mb-0.5">
                    {t('meetingNotes.conclusion')}
                  </div>
                  <p className="whitespace-pre-wrap">{meeting.conclusion}</p>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Дуу бичлэг — хөтчөөр бичих / файл оруулах / тоглуулах */}
      <MeetingRecorderCard
        meetingId={meetingId}
        status={meeting.status}
        language={meeting.language ?? 'mn'}
        recording={recording}
        audioUrl={audio_url}
        autoStart={autoRecord}
        onAutoStartConsumed={consumeAutoRecord}
      />

      {/* Эцсийн (гараар зассан) хурлын текст — том засварлагч */}
      <FinalTextEditor
        meetingId={meetingId}
        finalText={meeting.final_text}
        updatedAt={meeting.final_text_updated_at}
        updatedByName={meeting.final_text_updated_by_name}
        transcriptText={transcript?.transcript_text ?? null}
        transcribing={meeting.status === 'transcribing'}
      />

      {/* Analysis */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" /> {t('meetingNotes.analysisTitle')}
          </CardTitle>
          {editingAnalysis ? (
            <div className="flex gap-2">
              <Button size="sm" onClick={() => saveAnalysisMut.mutate()} disabled={saveAnalysisMut.isPending}>
                {saveAnalysisMut.isPending ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Check className="h-4 w-4 mr-2" />
                )}
                {t('common.save')}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setEditingAnalysis(false)}>
                <X className="h-4 w-4 mr-2" /> {t('common.cancel')}
              </Button>
            </div>
          ) : (
            <div className="flex gap-2">
              {(analysis || analyzable) && (
                <Button size="sm" variant="outline" onClick={startEditAnalysis}>
                  <Pencil className="h-4 w-4 mr-2" /> {t('common.edit')}
                </Button>
              )}
              {analyzable && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => analyzeMut.mutate()}
                  disabled={analyzeMut.isPending || meeting.status === 'analyzing'}
                  title={t('meetingNotes.workersAiHint')}
                >
                  {analyzeMut.isPending || meeting.status === 'analyzing' ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <RefreshCw className="h-4 w-4 mr-2" />
                  )}
                  {analysis ? t('meetingNotes.reanalyze') : t('meetingNotes.analyze')}
                </Button>
              )}
            </div>
          )}
        </CardHeader>
        <CardContent className="space-y-5">
          {editingAnalysis ? (
            <AnalysisEditor
              summary={summaryDraft}
              setSummary={setSummaryDraft}
              decisions={decisionsDraft}
              setDecisions={setDecisionsDraft}
              actions={actionsDraft}
              setActions={setActionsDraft}
            />
          ) : !analysis ? (
            meeting.status === 'analyzing' ? (
              <TranscribeProgress
                startedAt={meeting.updated_at}
                estimateSeconds={recording?.duration_seconds ? recording.duration_seconds * 0.25 : 40}
                label={t('meetingNotes.analyzingHint')}
              />
            ) : (
              <p className="text-sm text-muted-foreground">
                {analyzable ? t('meetingNotes.noAnalysisYet') : t('meetingNotes.waitingTranscript')}
              </p>
            )
          ) : (
            <>
              {analysis.summary && (
                <div>
                  <h4 className="text-sm font-semibold mb-1">{t('meetingNotes.summary')}</h4>
                  <p className="text-sm whitespace-pre-wrap leading-relaxed">{analysis.summary}</p>
                </div>
              )}
              {decisions.length > 0 && (
                <div>
                  <h4 className="text-sm font-semibold mb-1 flex items-center gap-1.5">
                    <CheckSquare className="h-4 w-4 text-primary" /> {t('meetingNotes.decisions')}
                  </h4>
                  <ul className="list-disc pl-5 space-y-1 text-sm">
                    {decisions.map((d, i) => (
                      <li key={i}>{d}</li>
                    ))}
                  </ul>
                </div>
              )}
              {actionItems.length > 0 && (
                <div>
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <h4 className="text-sm font-semibold flex items-center gap-1.5">
                      <ListChecks className="h-4 w-4 text-primary" />{' '}
                      {t('meetingNotes.actionItems')}
                    </h4>
                    <Button size="sm" variant="outline" className="h-7 text-xs" onClick={openCreateTasks}>
                      <Plus className="h-3.5 w-3.5 mr-1" />
                      {t('meetingNotes.createTasks')}
                    </Button>
                  </div>
                  <ul className="space-y-1.5 text-sm">
                    {actionItems.map((a, i) => (
                      <li key={i} className="flex flex-col">
                        <span>{a.text}</span>
                        {(a.owner || a.due) && (
                          <span className="text-xs text-muted-foreground">
                            {a.owner ? `${t('meetingNotes.owner')}: ${a.owner}` : ''}
                            {a.owner && a.due ? ' · ' : ''}
                            {a.due ? `${t('meetingNotes.due')}: ${a.due}` : ''}
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* Transcript */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {t('meetingNotes.transcript')}
            <span className="ml-2 text-xs font-normal text-muted-foreground">{t('meetingNotes.transcriptRawHint')}</span>
            {transcript?.speaker_count ? (
              <span className="ml-2 text-xs font-normal text-muted-foreground">
                {t('meetingNotes.speakers', { count: transcript.speaker_count })}
              </span>
            ) : null}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {transcribed ? (
            <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed text-foreground/90">
              {transcript!.transcript_text}
            </pre>
          ) : meeting.status === 'transcribing' ? (
            <TranscribeProgress
              startedAt={recording?.submitted_at}
              estimateSeconds={recording?.duration_seconds}
              label={t('meetingNotes.transcribingHint')}
            />
          ) : (
            <p className="text-sm text-muted-foreground">
              {meeting.status === 'transcribe_failed'
                ? t('meetingNotes.transcribeFailedHint')
                : t('meetingNotes.noTranscriptYet')}
            </p>
          )}
        </CardContent>
      </Card>

      {/* Admin actions */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('meetingNotes.actions')}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap items-end gap-3">
          <div className="flex items-end gap-2">
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">{t('meetingNotes.language')}</label>
              <Select value={retranscribeLang} onValueChange={setRetranscribeLang}>
                <SelectTrigger className="w-28">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="mn">{t('meetingNotes.lang.mn')}</SelectItem>
                  <SelectItem value="en">{t('meetingNotes.lang.en')}</SelectItem>
                  <SelectItem value="ru">{t('meetingNotes.lang.ru')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button
              variant="outline"
              onClick={() => retranscribeMut.mutate()}
              disabled={retranscribeMut.isPending || meeting.status === 'transcribing' || !recording}
            >
              {retranscribeMut.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4 mr-2" />
              )}
              {t('meetingNotes.retranscribe')}
            </Button>
          </div>

          <Button
            variant="destructive"
            className="ml-auto"
            onClick={async () => {
              if (await confirmDialog({ description: t('meetingNotes.confirmDelete'), variant: 'destructive' })) deleteMut.mutate();
            }}
            disabled={deleteMut.isPending}
          >
            {deleteMut.isPending ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Trash2 className="h-4 w-4 mr-2" />
            )}
            {t('common.delete')}
          </Button>
        </CardContent>
      </Card>

      {/* Action item → даалгавар гүүрийн dialog */}
      <Dialog open={createTasksOpen} onOpenChange={(o) => !o && setCreateTasksOpen(false)}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ListChecks className="h-5 w-5 text-primary" />
              {t('meetingNotes.createTasksTitle')}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-1">
            <p className="text-xs text-muted-foreground">{t('meetingNotes.createTasksHint')}</p>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-foreground">
                {t('meetingNotes.targetProject')}
              </label>
              <Select
                value={taskProjectId !== null ? String(taskProjectId) : 'none'}
                onValueChange={(v) => setTaskProjectId(v === 'none' ? null : Number(v))}
              >
                <SelectTrigger>
                  <SelectValue placeholder={t('meetingNotes.selectProject')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none" disabled>
                    {t('meetingNotes.selectProject')}
                  </SelectItem>
                  {(projectsQuery.data?.projects ?? []).map((p) => (
                    <SelectItem key={p.id} value={String(p.id)}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2 max-h-[45vh] overflow-y-auto overflow-x-hidden pr-1">
              {taskRows.map((row, i) => (
                <div
                  key={i}
                  className="rounded-md border border-border p-2.5 space-y-2 bg-muted/20"
                >
                  <div className="flex items-start gap-2">
                    <Checkbox
                      checked={row.include}
                      onCheckedChange={(v) => patchTaskRow(i, { include: v === true })}
                      className="mt-1.5"
                    />
                    <Input
                      value={row.text}
                      onChange={(e) => patchTaskRow(i, { text: e.target.value })}
                      disabled={!row.include}
                      className="text-sm"
                    />
                  </div>
                  <div className="flex flex-wrap items-center gap-2 pl-7">
                    <Select
                      value={row.assignee_id !== null ? String(row.assignee_id) : 'none'}
                      onValueChange={(v) =>
                        patchTaskRow(i, { assignee_id: v === 'none' ? null : Number(v) })
                      }
                      disabled={!row.include}
                    >
                      <SelectTrigger className="h-8 w-full sm:w-52 text-xs">
                        <SelectValue placeholder={t('meetingNotes.taskAssignee')} />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">{t('meetingNotes.noAssignee')}</SelectItem>
                        {(employeesQuery.data?.users ?? []).map((u) => (
                          <SelectItem key={u.id} value={String(u.id)}>
                            {u.full_name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Input
                      type="date"
                      value={row.due}
                      onChange={(e) => patchTaskRow(i, { due: e.target.value })}
                      disabled={!row.include}
                      className="h-8 w-40 text-xs"
                    />
                    {row.ownerHint && row.assignee_id === null && (
                      <span className="text-[11px] text-muted-foreground">
                        {t('meetingNotes.ownerFromMeeting', { owner: row.ownerHint })}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => setCreateTasksOpen(false)}
              disabled={createTasksMut.isPending}
            >
              {t('common.cancel')}
            </Button>
            <Button
              onClick={() => createTasksMut.mutate()}
              disabled={
                createTasksMut.isPending || taskProjectId === null || includedTaskCount === 0
              }
            >
              {createTasksMut.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Plus className="h-4 w-4 mr-2" />
              )}
              {t('meetingNotes.createTasksSubmit', { count: includedTaskCount })}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ---------------- small view helpers ---------------- */

function InfoGrid({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2">{children}</div>;
}

function InfoRow({
  label,
  value,
  full,
}: {
  label: string;
  value: React.ReactNode;
  full?: boolean;
}) {
  if (value === null || value === undefined || value === '') return null;
  return (
    <div className={full ? 'sm:col-span-2' : undefined}>
      <span className="text-xs text-muted-foreground">{label}: </span>
      <span className="text-foreground">{value}</span>
    </div>
  );
}

function ParticipantsView({ groups }: { groups: ParticipantGroup[] }) {
  return (
    <div className="space-y-2">
      {groups.map((g, i) => (
        <div key={i}>
          {g.org && <div className="font-medium">{g.org}</div>}
          <ul className="pl-4 text-sm text-foreground/90 space-y-0.5">
            {g.members.map((m, mi) => (
              <li key={mi} className="flex items-center gap-2">
                <span>
                  {m.name}
                  {m.position ? (
                    <span className="text-muted-foreground"> — {m.position}</span>
                  ) : null}
                </span>
                {m.signature_url && (
                  <img
                    src={`${MEDIA_BASE_URL}${m.signature_url}`}
                    alt=""
                    className="h-6 max-w-[120px] object-contain"
                  />
                )}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

function DiscussionView({ sections }: { sections: DiscussionSection[] }) {
  return (
    <div className="space-y-3">
      {sections.map((s, si) => (
        <div key={si}>
          <div className="font-medium">
            1.{si + 1} {s.heading}
            {s.org ? <span className="text-muted-foreground font-normal"> — {s.org}</span> : null}
          </div>
          <ol className="pl-5 list-decimal text-sm text-foreground/90 space-y-0.5">
            {s.items.map((item, ii) => (
              <li key={ii} className="whitespace-pre-wrap">
                {item}
              </li>
            ))}
          </ol>
        </div>
      ))}
    </div>
  );
}

/* ---------------- analysis editor ---------------- */

function AnalysisEditor({
  summary,
  setSummary,
  decisions,
  setDecisions,
  actions,
  setActions,
}: {
  summary: string;
  setSummary: (v: string) => void;
  decisions: string[];
  setDecisions: (v: string[]) => void;
  actions: ActionItem[];
  setActions: (v: ActionItem[]) => void;
}) {
  const { t } = useLanguage();
  return (
    <div className="space-y-5">
      <div className="space-y-1.5">
        <h4 className="text-sm font-semibold">{t('meetingNotes.summary')}</h4>
        <Textarea value={summary} onChange={(e) => setSummary(e.target.value)} rows={4} />
      </div>

      <div className="space-y-1.5">
        <h4 className="text-sm font-semibold flex items-center gap-1.5">
          <CheckSquare className="h-4 w-4 text-primary" /> {t('meetingNotes.decisions')}
        </h4>
        {decisions.map((d, i) => (
          <div key={i} className="flex items-center gap-2">
            <Input
              value={d}
              onChange={(e) => setDecisions(decisions.map((x, xi) => (xi === i ? e.target.value : x)))}
              className="h-8"
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-muted-foreground hover:text-destructive flex-shrink-0"
              onClick={() => setDecisions(decisions.filter((_, xi) => xi !== i))}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        ))}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 text-xs text-muted-foreground"
          onClick={() => setDecisions([...decisions, ''])}
        >
          <Plus className="h-3.5 w-3.5 mr-1.5" /> {t('meetingNotes.addDecision')}
        </Button>
      </div>

      <div className="space-y-1.5">
        <h4 className="text-sm font-semibold flex items-center gap-1.5">
          <ListChecks className="h-4 w-4 text-primary" /> {t('meetingNotes.actionItems')}
        </h4>
        {actions.map((a, i) => (
          <div key={i} className="flex items-center gap-2">
            <Input
              value={a.text}
              placeholder={t('meetingNotes.actionText')}
              onChange={(e) =>
                setActions(actions.map((x, xi) => (xi === i ? { ...x, text: e.target.value } : x)))
              }
              className="h-8 flex-[2]"
            />
            <Input
              value={a.owner ?? ''}
              placeholder={t('meetingNotes.owner')}
              onChange={(e) =>
                setActions(actions.map((x, xi) => (xi === i ? { ...x, owner: e.target.value } : x)))
              }
              className="h-8 flex-1"
            />
            <Input
              value={a.due ?? ''}
              placeholder={t('meetingNotes.due')}
              onChange={(e) =>
                setActions(actions.map((x, xi) => (xi === i ? { ...x, due: e.target.value } : x)))
              }
              className="h-8 flex-1"
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-muted-foreground hover:text-destructive flex-shrink-0"
              onClick={() => setActions(actions.filter((_, xi) => xi !== i))}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        ))}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 text-xs text-muted-foreground"
          onClick={() => setActions([...actions, { text: '' }])}
        >
          <Plus className="h-3.5 w-3.5 mr-1.5" /> {t('meetingNotes.addAction')}
        </Button>
      </div>
    </div>
  );
}
