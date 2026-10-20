import { useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ClipboardEdit, Save, Sparkles, RefreshCw } from 'lucide-react';
import { apiFetch } from '@/shared/api/client';
import { useLanguage } from '@/shared/i18n';
import { useApiQuery } from '@/shared/api/useApi';
import { toast } from '@/shared/components/Toast';
import { Card, CardContent, CardHeader, CardTitle } from '@/ui/card';
import { Badge } from '@/ui/badge';
import { Button } from '@/ui/button';
import { Textarea } from '@/ui/textarea';
import { Label } from '@/ui/label';
import { Tabs, TabsContent } from '@/ui/tabs';
import { teamChipClass } from '@/shared/lib/team-colors';
import { cn } from '@/shared/lib/utils';
import { formatDate } from '@/shared/lib/time';
import { TeamRadixTabsStrip } from '@/shared/components/TeamTabsStrip';
import type { ProjectTeamShare } from '@/shared/types';

/* =============================================================
 * TeamNotesTab — "Тэмдэглэл" sub-tab of the Тайлан tab.
 * -------------------------------------------------------------
 * Per-team progress-note checkpoint, mirroring the Тайлбар бичиг
 * layout: one sub-tab per discipline assigned to the project,
 * each with a fixed 4-question form whose answers feed an AI
 * summary cached on the row server-side (see
 * backend/src/lib/teamNotesAi.ts).
 *
 * The four questions are the canonical project-management
 * checkpoint:
 *   1. client document delivery
 *   2. architectural plan / inter-team dependencies
 *   3. blocker resolution
 *   4. schedule adherence + resource gaps
 * They live as a constant on the server (TEAM_NOTE_QUESTIONS) and
 * are echoed back on the GET response so this component doesn't
 * have to keep its own copy in sync.
 * ============================================================= */

interface TeamNotesTabProps {
  projectId: number;
  teamShares: ProjectTeamShare[];
  readOnly?: boolean;
}

interface TeamNoteQuestion {
  id: string;
  text: string;
}

interface TeamNoteResource {
  project_id: number;
  team_code: string;
  answers: Record<string, string>;
  ai_summary: string | null;
  ai_summary_at: string | null;
  updated_at: string;
  updated_by_id: number | null;
}

interface TeamNotesListResponse {
  notes: TeamNoteResource[];
  questions: TeamNoteQuestion[];
}

export function TeamNotesTab({ projectId, teamShares, readOnly = false }: TeamNotesTabProps) {
  const { t } = useLanguage();
  // Same dedupe pattern as TeamReportsTab — a project should never have
  // two share rows for the same team_code, but legacy data sometimes does.
  const teams = useMemo(() => {
    const seen = new Set<string>();
    return teamShares
      .filter((s) => {
        const code = (s.team_code ?? '').toUpperCase();
        if (!code || seen.has(code)) return false;
        seen.add(code);
        return true;
      })
      .map((s) => ({
        code: (s.team_code ?? '').toUpperCase(),
        name_mn: s.team_name_mn,
        share: s.share_percent,
      }));
  }, [teamShares]);

  if (teams.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <ClipboardEdit className="w-4 h-4 text-primary" /> {t('teamNotesTab.title')}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">{t('teamNotesTab.noTeamsAssigned')}</p>
        </CardContent>
      </Card>
    );
  }

  const defaultTeam = teams.find((t) => t.code === 'BA')?.code ?? teams[0]!.code;

  return (
    <NotesListBadges projectId={projectId}>
      {({ filled, questions }) => (
        <Tabs defaultValue={defaultTeam} className="space-y-4">
          <TeamRadixTabsStrip
            teams={teams.map((t) => ({
              code: t.code,
              name: t.name_mn,
              indicator: filled.has(t.code) ? 'filled' : 'empty',
            }))}
          />

          {teams.map((t) => (
            <TabsContent key={t.code} value={t.code} className="space-y-4">
              <TeamNotePanel
                projectId={projectId}
                teamCode={t.code}
                teamNameMn={t.name_mn}
                questions={questions}
                readOnly={readOnly}
              />
            </TabsContent>
          ))}
        </Tabs>
      )}
    </NotesListBadges>
  );
}

/** Wraps children with the per-team filled/empty Set + the canonical
 *  question list, fetched once from /team-notes (the GET list endpoint
 *  echoes the questions so the form doesn't have to hard-code them). */
function NotesListBadges({
  projectId,
  children,
}: {
  projectId: number;
  children: (data: { filled: Set<string>; questions: TeamNoteQuestion[] }) => React.ReactNode;
}) {
  const q = useApiQuery<TeamNotesListResponse>(
    ['/projects/team-notes', projectId] as const,
    `/projects/${projectId}/team-notes`,
  );
  const filled = useMemo(() => {
    const s = new Set<string>();
    // A row counts as "filled" if at least one answer is non-empty —
    // an empty form lying in the table after a clear shouldn't still
    // show the green checkmark.
    for (const n of q.data?.notes ?? []) {
      if (Object.values(n.answers ?? {}).some((v) => (v ?? '').trim().length > 0)) {
        s.add(n.team_code.toUpperCase());
      }
    }
    return s;
  }, [q.data]);
  const questions = q.data?.questions ?? [];
  return <>{children({ filled, questions })}</>;
}

interface TeamNotePanelProps {
  projectId: number;
  teamCode: string;
  teamNameMn: string;
  questions: TeamNoteQuestion[];
  readOnly: boolean;
}

function TeamNotePanel({
  projectId,
  teamCode,
  teamNameMn,
  questions,
  readOnly,
}: TeamNotePanelProps) {
  const { t } = useLanguage();
  const queryClient = useQueryClient();
  const queryKey = ['/projects/team-notes', projectId, teamCode] as const;

  const noteQuery = useApiQuery<{ note: TeamNoteResource | null; questions: TeamNoteQuestion[] }>(
    queryKey,
    `/projects/${projectId}/team-notes/${teamCode}`,
  );

  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [aiSummary, setAiSummary] = useState<string | null>(null);
  const [aiSummaryAt, setAiSummaryAt] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const n = noteQuery.data?.note;
    if (!n || dirty) return;
    setAnswers(n.answers ?? {});
    setAiSummary(n.ai_summary);
    setAiSummaryAt(n.ai_summary_at);
  }, [noteQuery.data, dirty]);

  useEffect(() => {
    if (noteQuery.error) {
      toast.error(t('teamNotesTab.loadFailed'), noteQuery.error.message);
    }
  }, [noteQuery.error, t]);

  const onChange = (id: string, value: string) => {
    setAnswers((prev) => ({ ...prev, [id]: value }));
    setDirty(true);
  };

  const save = async () => {
    setSaving(true);
    try {
      const res = await apiFetch<{ note: TeamNoteResource; message: string }>(
        `/projects/${projectId}/team-notes/${teamCode}`,
        { method: 'PUT', data: { answers } },
      );
      if (res.note) {
        setAnswers(res.note.answers ?? {});
        // AI summary is regenerated async, so this is usually still the
        // previous value here.  The UI shows a "boловсруулагдаж байна"
        // hint and the next refetch will pick up the new one.
        setAiSummary(res.note.ai_summary);
        setAiSummaryAt(res.note.ai_summary_at);
      }
      setDirty(false);
      queryClient.setQueryData(queryKey, { note: res.note, questions });
      queryClient.invalidateQueries({ queryKey: ['/projects/team-notes', projectId] });
      toast.success(res.message ?? t('common.saved'));
    } catch (e) {
      const msg = e instanceof Error ? e.message : t('common.error');
      toast.error(t('common.saveFailed'), msg);
    } finally {
      setSaving(false);
    }
  };

  const refreshSummary = () => {
    // Re-fetch the row — the server regenerated the summary in
    // waitUntil after our last save, so this picks up the new text.
    queryClient.invalidateQueries({ queryKey });
  };

  // Sort questions by id so we always render q1..q4 in order, even if
  // the API returned them out of order in a future migration.
  const sortedQuestions = useMemo(
    () => questions.slice().sort((a, b) => a.id.localeCompare(b.id)),
    [questions],
  );

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <CardTitle className="text-base flex items-center gap-2">
              <Badge variant="outline" className={teamChipClass(teamCode)}>
                {teamCode}
              </Badge>
              <span>{t('teamNotesTab.panelTitle', { team: teamNameMn })}</span>
            </CardTitle>
            {!readOnly && (
              <Button size="sm" onClick={save} disabled={saving || !dirty}>
                <Save className="w-4 h-4 mr-1" />
                {saving ? t('common.saving') : t('common.save')}
              </Button>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-1">{t('teamNotesTab.formHint')}</p>
        </CardHeader>
        <CardContent className="pt-0 space-y-4">
          {sortedQuestions.length === 0 ? (
            <p className="text-sm text-muted-foreground italic">
              {t('teamNotesTab.questionsLoading')}
            </p>
          ) : (
            sortedQuestions.map((q, idx) => (
              <div key={q.id} className="space-y-1.5">
                <Label htmlFor={`${teamCode}-${q.id}`} className="text-sm leading-snug">
                  <span className="text-muted-foreground mr-1">{idx + 1}.</span>
                  {q.text}
                </Label>
                <Textarea
                  id={`${teamCode}-${q.id}`}
                  rows={3}
                  value={answers[q.id] ?? ''}
                  onChange={(e) => onChange(q.id, e.target.value)}
                  disabled={readOnly}
                  placeholder={t('teamNotesTab.answerPlaceholder')}
                  className="resize-y"
                />
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <CardTitle className="text-base flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-primary" /> {t('teamNotesTab.aiSummary')}
            </CardTitle>
            <Button
              variant="outline"
              size="sm"
              onClick={refreshSummary}
              disabled={noteQuery.isFetching}
            >
              <RefreshCw
                className={cn('w-3.5 h-3.5 mr-1', noteQuery.isFetching && 'animate-spin')}
              />
              {t('teamNotesTab.refresh')}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground mt-1">{t('teamNotesTab.aiSummaryHint')}</p>
        </CardHeader>
        <CardContent className="pt-0">
          {aiSummary ? (
            <div className="rounded-lg border border-border/60 bg-muted/20 p-3">
              <p className="text-sm whitespace-pre-wrap leading-relaxed text-foreground/90">
                {aiSummary}
              </p>
              {aiSummaryAt && (
                <div className="text-micro text-muted-foreground mt-2">
                  {t('teamNotesTab.updatedAt', { date: formatDate(aiSummaryAt) })}
                </div>
              )}
            </div>
          ) : dirty ? (
            <p className="text-sm text-muted-foreground italic">
              {t('teamNotesTab.summaryAfterSave')}
            </p>
          ) : Object.values(answers).some((v) => (v ?? '').trim().length > 0) ? (
            <p className="text-sm text-muted-foreground italic">
              {t('teamNotesTab.summaryProcessing')}
            </p>
          ) : (
            <p className="text-sm text-muted-foreground italic">
              {t('teamNotesTab.answerFirst')}
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
