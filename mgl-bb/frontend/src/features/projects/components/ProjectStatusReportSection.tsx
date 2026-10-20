import { useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  ClipboardList,
  Save,
  Loader2,
  Plus,
  Trash2,
  Pencil,
  X,
  CalendarRange,
  Wallet,
  ChevronDown,
  ChevronRight,
  Paperclip,
  Clock,
  Check,
  FileText,
} from 'lucide-react';

import { apiFetch, uploadFile, MEDIA_BASE_URL } from '@/shared/api/client';
import { useApiQuery } from '@/shared/api/useApi';
import { Card, CardContent, CardHeader, CardTitle } from '@/ui/card';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import { Label } from '@/ui/label';
import { Textarea } from '@/ui/textarea';
import { Avatar, AvatarFallback, AvatarImage } from '@/ui/avatar';
import { toast } from '@/shared/components/Toast';
import { confirmDialog } from '@/shared/components/ConfirmDialog';
import { useLanguage } from '@/shared/i18n';
import type {
  ProjectStatusReport,
  ProjectProgressNote,
  ProgressNoteAttachment,
  FundingMilestone,
  ProjectWithProgress,
} from '@/shared/types';

/* =============================================================
 * ProjectStatusReportSection
 * -------------------------------------------------------------
 * Барилгын төслийн тогтмол тайлагнах хуудас.  Хоёр хэсэгтэй:
 *
 *   1)  ☝ Header (1:1) — холбогдох хүн / гэрээ / явц / санхүүжилт /
 *       гадаад байгууллагуудтай харилцсан тэмдэглэлүүд.  Нэг л row
 *       тул "edit ↔ save" логик; хоосон бол шууд edit-mode-оор нээнэ.
 *   2)  📝 Notes (1:N) — "Явцын мэдээ" бичлэгүүд.  Гарчиг + бичвэр +
 *       зураг/файл хавсралт.  Хадгалсан үе нэгшил тэмдэглэгддэг,
 *       collapsed list-р харагдаад дарвал дэлгэрэнгүй нээнэ.
 *
 * Зөвхөн дотоодын ажилтан үздэг — `readOnly` prop-ыг хүлээж авдаг
 * боловч энэ хуудаст зөвхөн staff л ордог тул бараг үргэлж засна. */

interface Props {
  projectId: number;
  /** Зөвхөн харах горим — `editing` боломжгүй болгоно. */
  readOnly?: boolean;
  /**
   * 'mgl'    — MGL ажлын явц: header card (contract/funding/agencies) + notes
   * 'client' — Захиалагч / Бусад: notes only (header card нуугдана)
   * Default: 'mgl'
   */
  category?: 'mgl' | 'client';
  /** When true, hides the contract/funding/agencies header card so only the
   * notes ("Явцын мэдээ" / "Захиалагч / Бусад тэмдэглэл") list is shown.
   * Used on the Тайлан tab where the contract metadata already lives under
   * Мэдээлэл and the report surface should focus on the running log. */
  notesOnly?: boolean;
  /** When true, hides the notes ("Явцын мэдээ" / "Захиалагч / Бусад
   * тэмдэглэл") list so only the contract/funding/agencies header card
   * is shown.  Used on the Мэдээлэл tab where notes already live under
   * Тайлан and the metadata view should stay scannable. */
  headerOnly?: boolean;
  /** Optional pre-fetched project record. When provided, the PDF report
   *  modal skips the redundant `/projects/:id` round-trip. */
  project?: ProjectWithProgress;
}

const EMPTY_REPORT: ProjectStatusReport = {
  project_id: 0,
  contact_name: null,
  contact_phone: null,
  contact_email: null,
  contract_start: null,
  contract_end: null,
  funding_milestones: [],
  nema_note: null,
  health_note: null,
  bdc_experts_note: null,
  bdc_review_note: null,
  nema_done: false,
  health_done: false,
  bdc_experts_done: false,
  bdc_review_done: false,
  notes: null,
  updated_at: '',
  updated_by_id: null,
};

function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  // SQLite "datetime('now')" нь "YYYY-MM-DD HH:MM:SS" UTC-аар хадгалдаг —
  // browser нь local timezone руу хөрвүүлж харуулна.
  const normalized = iso.includes('T') ? iso : iso.replace(' ', 'T') + 'Z';
  const d = new Date(normalized);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('mn-MN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function fileFromUrl(url: string): string {
  try {
    return new URL(url).pathname.split('/').pop() ?? url;
  } catch {
    return url;
  }
}

function attachmentFullUrl(url: string): string {
  if (/^https?:\/\//i.test(url)) return url;
  return `${MEDIA_BASE_URL}${url.startsWith('/') ? '' : '/'}${url}`;
}

function isImage(att: ProgressNoteAttachment): boolean {
  const u = att.url.toLowerCase();
  return /\.(png|jpe?g|gif|webp|bmp|svg)(\?|#|$)/.test(u) || u.includes('image');
}

export function ProjectStatusReportSection({
  projectId,
  readOnly = false,
  category = 'mgl',
  notesOnly = false,
  headerOnly = false,
  project,
}: Props) {
  const { t } = useLanguage();
  const queryClient = useQueryClient();
  // Tuple cache key — the same endpoint serves both `mgl` and `client`
  // category report variants and they must NOT share a slot.
  const statusReportKey = ['/projects/status-report', projectId, category] as const;
  const statusReportEndpoint = `/projects/${projectId}/status-report?category=${category}`;

  const statusReportQuery = useApiQuery<{
    report: ProjectStatusReport | null;
    notes: ProjectProgressNote[];
  }>(statusReportKey, statusReportEndpoint);

  const [report, setReport] = useState<ProjectStatusReport>(EMPTY_REPORT);
  const [notes, setNotes] = useState<ProjectProgressNote[]>([]);
  const [editingHeader, setEditingHeader] = useState(false);
  const [draft, setDraft] = useState<ProjectStatusReport>(EMPTY_REPORT);
  const [saving, setSaving] = useState(false);
  const loading = statusReportQuery.isLoading;

  // ───────── Note composer ─────────
  const [composerOpen, setComposerOpen] = useState(false);
  const [draftTitle, setDraftTitle] = useState('');
  const [draftBody, setDraftBody] = useState('');
  const [draftAtt, setDraftAtt] = useState<ProgressNoteAttachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const [posting, setPosting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // ───────── Expanded notes ─────────
  const [openIds, setOpenIds] = useState<Set<number>>(new Set());

  // ───────── PDF report modal ─────────
  const [pdfLoading, setPdfLoading] = useState(false);

  // Trigger the server-side PDF (Cloudflare Browser Rendering). The
  // worker takes ~3-8s for a cold render so we surface a spinner on
  // the button. Bearer token is read by the helper to authenticate.
  async function downloadPdf() {
    if (pdfLoading) return;
    setPdfLoading(true);
    try {
      const token = localStorage.getItem('auth_token');
      const res = await fetch(`${MEDIA_BASE_URL}/api/projects/${projectId}/pdf`, {
        method: 'GET',
        credentials: 'include',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) {
        let msg = t('projectStatusReportSection.pdfFailed');
        try {
          const j = (await res.json()) as { error?: string };
          if (j?.error) msg = j.error;
        } catch {
          /* keep default */
        }
        throw new Error(msg);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const safeName =
        (project?.name ?? 'project')
          .normalize('NFKD')
          .replace(/[^\p{L}\p{N}\s_-]/gu, '')
          .trim()
          .replace(/\s+/g, '_')
          .slice(0, 80) || 'project';
      a.href = url;
      a.download = `${safeName}_tailan.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      toast.error('PDF', e instanceof Error ? e.message : t('projectStatusReportSection.errorOccurred'));
    } finally {
      setPdfLoading(false);
    }
  }

  // Mirror server data into local state so the existing editing
  // workflow (draft/save) keeps working without churn. We deliberately
  // re-run on every query data identity change rather than on
  // projectId/category alone so a `queryClient.invalidate(...)` after a
  // mutation picks up the fresh row.
  useEffect(() => {
    const res = statusReportQuery.data;
    if (!res) return;
    const initial: ProjectStatusReport = res.report
      ? {
          ...res.report,
          funding_milestones: res.report.funding_milestones ?? [],
          nema_done: !!res.report.nema_done,
          health_done: !!res.report.health_done,
          bdc_experts_done: !!res.report.bdc_experts_done,
          bdc_review_done: !!res.report.bdc_review_done,
        }
      : { ...EMPTY_REPORT, project_id: projectId };
    setReport(initial);
    setDraft(initial);
    setNotes(res.notes ?? []);
    // Хэрэв толгой хэсэг хоосон бол шууд edit-mode-оор нээж өгнө —
    // ингэснээр анхны удаа орсон ажилтан "юу бөглөх вэ" гэдэг нь шууд
    // нүднийх нь өмнө гарна.
    if (!res.report && !readOnly) setEditingHeader(true);
  }, [statusReportQuery.data, projectId, readOnly]);

  useEffect(() => {
    const err = statusReportQuery.error;
    if (err) {
      toast.error(err instanceof Error ? err.message : t('projectStatusReportSection.reportLoadFailed'));
    }
  }, [statusReportQuery.error, t]);

  const lastUpdated = useMemo(() => formatDateTime(report.updated_at), [report.updated_at]);

  const saveHeader = async () => {
    setSaving(true);
    try {
      const res = await apiFetch<{ report: ProjectStatusReport }>(
        `/projects/${projectId}/status-report`,
        { method: 'PUT', data: draft },
      );
      const fresh: ProjectStatusReport = {
        ...res.report,
        funding_milestones: res.report.funding_milestones ?? [],
        nema_done: !!res.report.nema_done,
        health_done: !!res.report.health_done,
        bdc_experts_done: !!res.report.bdc_experts_done,
        bdc_review_done: !!res.report.bdc_review_done,
      };
      setReport(fresh);
      setDraft(fresh);
      setEditingHeader(false);
      // Push the freshly-saved row into the cache so any other consumer
      // of the same query key (e.g. the sibling `category="client"` view
      // or a future re-mount) sees the new data without a refetch.
      queryClient.setQueryData(
        statusReportKey,
        (
          prev: { report: ProjectStatusReport | null; notes: ProjectProgressNote[] } | undefined,
        ) => ({
          report: fresh,
          notes: prev?.notes ?? notes,
        }),
      );
      toast.success(t('projectStatusReportSection.headerSaved'));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('common.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  const cancelEdit = () => {
    setDraft(report);
    setEditingHeader(false);
  };

  const handleUpload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploading(true);
    try {
      const uploaded: ProgressNoteAttachment[] = [];
      for (const f of Array.from(files)) {
        const url = await uploadFile(f);
        uploaded.push({ url, name: f.name });
      }
      setDraftAtt((prev) => [...prev, ...uploaded]);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('projectStatusReportSection.uploadFailed'));
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const submitNote = async () => {
    if (!draftTitle.trim()) {
      toast.error(t('projectStatusReportSection.titleRequired'));
      return;
    }
    setPosting(true);
    try {
      const res = await apiFetch<{ note: ProjectProgressNote }>(
        `/projects/${projectId}/progress-notes`,
        {
          method: 'POST',
          data: {
            title: draftTitle.trim(),
            body: draftBody.trim() || null,
            attachments: draftAtt,
            category,
          },
        },
      );
      setNotes((prev) => [res.note, ...prev]);
      setOpenIds((prev) => new Set(prev).add(res.note.id));
      setDraftTitle('');
      setDraftBody('');
      setDraftAtt([]);
      setComposerOpen(false);
      queryClient.setQueryData(
        statusReportKey,
        (
          prev: { report: ProjectStatusReport | null; notes: ProjectProgressNote[] } | undefined,
        ) => ({
          report: prev?.report ?? report,
          notes: [res.note, ...(prev?.notes ?? notes)],
        }),
      );
      toast.success(t('projectStatusReportSection.noteAdded'));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('projectStatusReportSection.sendFailed'));
    } finally {
      setPosting(false);
    }
  };

  const deleteNote = async (n: ProjectProgressNote) => {
    if (!(await confirmDialog({ description: t('projectStatusReportSection.confirmDeleteNote', { title: n.title }), variant: 'destructive' }))) return;
    try {
      await apiFetch(`/projects/progress-notes/${n.id}`, { method: 'DELETE' });
      setNotes((prev) => prev.filter((x) => x.id !== n.id));
      queryClient.setQueryData(
        statusReportKey,
        (
          prev: { report: ProjectStatusReport | null; notes: ProjectProgressNote[] } | undefined,
        ) => ({
          report: prev?.report ?? report,
          notes: (prev?.notes ?? notes).filter((x) => x.id !== n.id),
        }),
      );
      toast.success(t('common.deleted'));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('common.deleteFailed'));
    }
  };

  const toggleNote = (id: number) => {
    setOpenIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  if (loading) {
    return (
      <Card className="border-border bg-card/60 backdrop-blur">
        <CardContent className="p-10 flex items-center justify-center text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin mr-2" /> {t('common.loading')}
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* ─────────── Header card — MGL only ─────────── */}
      {category === 'mgl' && !notesOnly && (
        <Card className="border-border bg-card/60 backdrop-blur">
          <CardHeader className="pb-3 flex flex-row items-start justify-between gap-2">
            <div className="space-y-1">
              <CardTitle className="flex items-center gap-2 text-base">
                <ClipboardList className="h-4 w-4 text-primary" />
                {t('projectStatusReportSection.progressReport')}
              </CardTitle>
              <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                <Clock className="h-3 w-3" />
                {t('projectStatusReportSection.lastUpdated')}: <span className="text-foreground font-medium">{lastUpdated}</span>
              </p>
            </div>
            <div className="flex items-center gap-1.5">
              <Button size="sm" variant="outline" onClick={downloadPdf} disabled={pdfLoading}>
                {pdfLoading ? (
                  <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                ) : (
                  <FileText className="h-3.5 w-3.5 mr-1" />
                )}
                {pdfLoading ? t('projectStatusReportSection.generating') : t('projectStatusReportSection.pdfReport')}
              </Button>
              {!readOnly &&
                (editingHeader ? (
                  <>
                    <Button size="sm" variant="ghost" onClick={cancelEdit} disabled={saving}>
                      <X className="h-3.5 w-3.5 mr-1" /> {t('common.cancel')}
                    </Button>
                    <Button size="sm" onClick={saveHeader} disabled={saving}>
                      {saving ? (
                        <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                      ) : (
                        <Save className="h-3.5 w-3.5 mr-1" />
                      )}
                      {t('common.save')}
                    </Button>
                  </>
                ) : (
                  <Button size="sm" variant="outline" onClick={() => setEditingHeader(true)}>
                    <Pencil className="h-3.5 w-3.5 mr-1" /> {t('common.edit')}
                  </Button>
                ))}
            </div>
          </CardHeader>

          <CardContent className="space-y-5">
            {/* Гэрээ — Холбогдох хүний мэдээлэл нь паспорт руу зөөгдсөн. */}
            <Section title={t('projectStatusReportSection.contractPeriod')} icon={<CalendarRange className="h-3.5 w-3.5" />}>
              <Field
                label={t('projectStatusReportSection.started')}
                value={report.contract_start}
                editing={editingHeader}
                draft={draft.contract_start}
                onChange={(v) => setDraft({ ...draft, contract_start: v })}
                type="date"
              />
              <Field
                label={t('projectStatusReportSection.ends')}
                value={report.contract_end}
                editing={editingHeader}
                draft={draft.contract_end}
                onChange={(v) => setDraft({ ...draft, contract_end: v })}
                type="date"
              />
            </Section>

            {/* Санхүүжилт — table format */}
            <FundingTable
              milestones={editingHeader ? draft.funding_milestones : report.funding_milestones}
              editing={editingHeader}
              onChange={(rows) => setDraft({ ...draft, funding_milestones: rows })}
            />

            {/* Гадаад байгууллагуудтай харилцсан тэмдэглэл нь "Тайлбар бичиг"
                хэсгийн "Гадны байгууллага" таб руу зөөгдсөн. */}
          </CardContent>
        </Card>
      )}

      {/* PDF generation now happens server-side via Cloudflare Browser
          Rendering — see `downloadPdf` above. No client-side modal. */}

      {/* ─────────── Progress notes ─────────── *
       * Захиалагч (readOnly) -д харагдахгүй.
       * `headerOnly` горимд нуугдана (Мэдээлэл таб). */}
      {!readOnly && !headerOnly && (
        <Card className="border-border bg-card/60 backdrop-blur">
          <CardHeader className="pb-3 flex flex-row items-center justify-between gap-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <ClipboardList className="h-4 w-4 text-primary" />
              {category === 'client'
                ? t('projectStatusReportSection.clientNotes')
                : t('projectStatusReportSection.progressNotes')}
              <span className="text-xs font-normal text-muted-foreground">({notes.length})</span>
            </CardTitle>
            {!readOnly && !composerOpen && (
              <Button size="sm" onClick={() => setComposerOpen(true)}>
                <Plus className="h-3.5 w-3.5 mr-1" /> {t('projectStatusReportSection.newNote')}
              </Button>
            )}
          </CardHeader>

          <CardContent className="space-y-3">
            {/* Composer */}
            {composerOpen && (
              <div className="rounded-lg border border-primary/30 bg-primary/5 p-4 space-y-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">{t('projectStatusReportSection.titleLabel')}</Label>
                  <Input
                    placeholder={
                      category === 'client'
                        ? t('projectStatusReportSection.titlePlaceholderClient')
                        : t('projectStatusReportSection.titlePlaceholderMgl')
                    }
                    value={draftTitle}
                    onChange={(e) => setDraftTitle(e.target.value)}
                    autoFocus
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">{t('projectStatusReportSection.detailLabel')}</Label>
                  <Textarea
                    rows={5}
                    placeholder={t('projectStatusReportSection.bodyPlaceholder')}
                    value={draftBody}
                    onChange={(e) => setDraftBody(e.target.value)}
                  />
                </div>

                {/* Attachments */}
                <div className="space-y-2">
                  <Label className="text-xs flex items-center gap-1">
                    <Paperclip className="h-3 w-3" />
                    {t('projectStatusReportSection.attachment')}{' '}
                    <span className="text-muted-foreground font-normal">{t('projectStatusReportSection.attachmentHint')}</span>
                  </Label>
                  {draftAtt.length > 0 && (
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
                      {draftAtt.map((a, i) => (
                        <div
                          key={i}
                          className="relative group rounded-lg border border-border overflow-hidden bg-muted/40"
                        >
                          {isImage(a) ? (
                            <img
                              src={attachmentFullUrl(a.url)}
                              alt={a.name}
                              className="w-full h-24 object-cover"
                            />
                          ) : (
                            <div className="h-24 flex flex-col items-center justify-center text-muted-foreground p-2">
                              <Paperclip className="h-5 w-5 mb-1" />
                              <span className="text-micro truncate w-full text-center">
                                {a.name || fileFromUrl(a.url)}
                              </span>
                            </div>
                          )}
                          <button
                            type="button"
                            onClick={() => setDraftAtt((prev) => prev.filter((_, j) => j !== i))}
                            className="absolute top-1 right-1 h-6 w-6 rounded-full bg-black/60 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                            title={t('common.delete')}
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="flex items-center gap-2">
                    <Input
                      ref={fileRef}
                      type="file"
                      multiple
                      accept="image/*,application/pdf"
                      disabled={uploading}
                      onChange={(e) => handleUpload(e.target.files)}
                      className="text-xs"
                    />
                    {uploading && (
                      <Loader2 className="h-4 w-4 animate-spin text-muted-foreground shrink-0" />
                    )}
                  </div>
                </div>

                <div className="flex items-center justify-end gap-2 pt-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setComposerOpen(false);
                      setDraftTitle('');
                      setDraftBody('');
                      setDraftAtt([]);
                    }}
                    disabled={posting}
                  >
                    {t('common.cancel')}
                  </Button>
                  <Button
                    size="sm"
                    onClick={submitNote}
                    disabled={posting || uploading || !draftTitle.trim()}
                  >
                    {posting ? (
                      <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                    ) : (
                      <Save className="h-3.5 w-3.5 mr-1" />
                    )}
                    {t('common.save')}
                  </Button>
                </div>
              </div>
            )}

            {/* List */}
            {notes.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border/60 px-4 py-10 text-center text-sm text-muted-foreground">
                {category === 'client'
                  ? t('projectStatusReportSection.emptyClientNotes')
                  : t('projectStatusReportSection.emptyProgressNotes')}
              </div>
            ) : (
              <div className="rounded-lg border border-border divide-y divide-border overflow-hidden">
                {notes.map((n) => {
                  const open = openIds.has(n.id);
                  return (
                    <div key={n.id} className="bg-card">
                      <button
                        type="button"
                        onClick={() => toggleNote(n.id)}
                        className="w-full flex items-start gap-3 px-4 py-3 hover:bg-muted/40 transition-colors text-left"
                      >
                        <div className="mt-0.5 text-muted-foreground">
                          {open ? (
                            <ChevronDown className="h-4 w-4" />
                          ) : (
                            <ChevronRight className="h-4 w-4" />
                          )}
                        </div>
                        <Avatar className="h-8 w-8 shrink-0">
                          {n.author_image && (
                            <AvatarImage
                              src={attachmentFullUrl(n.author_image)}
                              alt={n.author_name ?? ''}
                            />
                          )}
                          <AvatarFallback className="text-micro">
                            {(n.author_name ?? '?').substring(0, 2).toUpperCase()}
                          </AvatarFallback>
                        </Avatar>
                        <div className="flex-1 min-w-0">
                          <div className="font-medium text-sm text-foreground truncate">
                            {n.title}
                          </div>
                          <div className="text-micro text-muted-foreground flex items-center gap-2 mt-0.5 flex-wrap">
                            <span className="flex items-center gap-1">
                              <Clock className="h-3 w-3" />
                              {formatDateTime(n.created_at)}
                            </span>
                            {n.author_name && <span>· {n.author_name}</span>}
                            {n.attachments.length > 0 && (
                              <span className="flex items-center gap-1">
                                · <Paperclip className="h-3 w-3" /> {n.attachments.length}
                              </span>
                            )}
                          </div>
                        </div>
                      </button>

                      {open && (
                        <div className="px-4 pb-4 pl-14 space-y-3">
                          {n.body && (
                            <div className="text-sm whitespace-pre-wrap text-foreground/90">
                              {n.body}
                            </div>
                          )}
                          {n.attachments.length > 0 && (
                            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
                              {n.attachments.map((a, i) => (
                                <a
                                  key={i}
                                  href={attachmentFullUrl(a.url)}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="rounded-lg border border-border overflow-hidden bg-muted/40 hover:border-primary/60 transition-colors"
                                >
                                  {isImage(a) ? (
                                    <img
                                      src={attachmentFullUrl(a.url)}
                                      alt={a.name}
                                      className="w-full h-28 object-cover"
                                    />
                                  ) : (
                                    <div className="h-28 flex flex-col items-center justify-center text-muted-foreground p-2">
                                      <Paperclip className="h-6 w-6 mb-1" />
                                      <span className="text-micro truncate w-full text-center">
                                        {a.name || fileFromUrl(a.url)}
                                      </span>
                                    </div>
                                  )}
                                </a>
                              ))}
                            </div>
                          )}
                          {!readOnly && (
                            <div className="flex items-center justify-end pt-1">
                              <Button
                                size="sm"
                                variant="ghost"
                                className="text-destructive hover:text-destructive"
                                onClick={() => deleteNote(n)}
                              >
                                <Trash2 className="h-3.5 w-3.5 mr-1" /> {t('common.delete')}
                              </Button>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

/* ──────────────── small UI helpers (kept inline) ──────────────── */

function Section({
  title,
  icon,
  children,
}: {
  title: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5 text-label text-muted-foreground font-semibold">
        {icon}
        {title}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">{children}</div>
    </div>
  );
}

function Field({
  label,
  value,
  editing,
  draft,
  onChange,
  placeholder,
  type,
  icon,
}: {
  label: string;
  value: string | null;
  editing: boolean;
  draft: string | null;
  onChange: (v: string | null) => void;
  placeholder?: string;
  type?: string;
  icon?: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-micro text-muted-foreground flex items-center gap-1">
        {icon}
        {label}
      </Label>
      {editing ? (
        <Input
          type={type ?? 'text'}
          placeholder={placeholder}
          value={draft ?? ''}
          onChange={(e) => onChange(e.target.value || null)}
        />
      ) : (
        <div className="text-sm text-foreground">
          {value || <span className="text-muted-foreground italic">—</span>}
        </div>
      )}
    </div>
  );
}

function FundingTable({
  milestones,
  editing,
  onChange,
}: {
  milestones: FundingMilestone[];
  editing: boolean;
  onChange: (rows: FundingMilestone[]) => void;
}) {
  const { t } = useLanguage();
  const total = milestones.reduce((s, m) => s + (m.percent ?? 0), 0);
  const totalDone = milestones.reduce((s, m) => s + (m.done ? (m.percent ?? 0) : 0), 0);

  const update = (i: number, patch: Partial<FundingMilestone>) => {
    onChange(milestones.map((m, idx) => (idx === i ? { ...m, ...patch } : m)));
  };
  const remove = (i: number) => onChange(milestones.filter((_, idx) => idx !== i));
  const add = () =>
    onChange([...milestones, { label: '', percent: null, done: false, received_at: null }]);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-label text-muted-foreground font-semibold">
          <Wallet className="h-3.5 w-3.5" />
          {t('projectStatusReportSection.funding')}
        </div>
        <div className="flex items-center gap-3 text-micro text-muted-foreground">
          <span>
            {t('projectStatusReportSection.total')}:{' '}
            <span className="font-semibold text-foreground tabular-nums">{total.toFixed(0)}%</span>
          </span>
          <span>
            {t('projectStatusReportSection.received')}:{' '}
            <span className="font-semibold text-success tabular-nums">
              {totalDone.toFixed(0)}%
            </span>
          </span>
        </div>
      </div>

      <div className="rounded-lg border border-border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/40">
            <tr className="text-left text-xs text-muted-foreground">
              <th className="px-3 py-2 font-medium">{t('projectStatusReportSection.paymentCondition')}</th>
              <th className="px-3 py-2 font-medium text-right w-28">{t('projectStatusReportSection.percent')}</th>
              <th className="px-3 py-2 font-medium text-center w-28">{t('projectStatusReportSection.receivedQ')}</th>
              {editing && <th className="px-2 py-2 w-10" />}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {milestones.length === 0 && (
              <tr>
                <td
                  colSpan={editing ? 4 : 3}
                  className="px-3 py-6 text-center text-xs text-muted-foreground italic"
                >
                  {t('projectStatusReportSection.noFundingRows')}
                  {editing && <> {t('projectStatusReportSection.useAddRowHint')}</>}
                </td>
              </tr>
            )}
            {milestones.map((m, i) => (
              <tr key={i} className={m.done ? 'bg-success/5' : ''}>
                <td className="px-3 py-2 align-middle">
                  {editing ? (
                    <Input
                      placeholder={t('projectStatusReportSection.milestoneLabelPlaceholder')}
                      value={m.label}
                      onChange={(e) => update(i, { label: e.target.value })}
                    />
                  ) : (
                    <span className={m.done ? 'text-foreground' : 'text-foreground'}>
                      {m.label || <span className="text-muted-foreground italic">—</span>}
                    </span>
                  )}
                </td>
                <td className="px-3 py-2 align-middle text-right">
                  {editing ? (
                    <Input
                      type="number"
                      min={0}
                      max={100}
                      step="0.01"
                      className="text-right tabular-nums"
                      placeholder="0"
                      value={m.percent ?? ''}
                      onChange={(e) => {
                        const v = e.target.value;
                        update(i, { percent: v === '' ? null : Number(v) });
                      }}
                    />
                  ) : (
                    <span className="font-semibold tabular-nums">
                      {m.percent != null ? `${m.percent}%` : '—'}
                    </span>
                  )}
                </td>
                <td className="px-3 py-2 align-middle text-center">
                  <button
                    type="button"
                    disabled={!editing}
                    onClick={() => editing && update(i, { done: !m.done })}
                    className={
                      'inline-flex items-center justify-center h-6 w-6 rounded-md border-2 transition-colors ' +
                      (m.done
                        ? 'bg-success border-success text-white'
                        : 'border-border bg-background ' +
                          (editing ? 'hover:border-success' : '')) +
                      (editing ? ' cursor-pointer' : ' cursor-default')
                    }
                    title={m.done ? t('projectStatusReportSection.received') : t('projectStatusReportSection.notReceived')}
                  >
                    {m.done && <Check className="h-3.5 w-3.5" />}
                  </button>
                </td>
                {editing && (
                  <td className="px-2 py-2 align-middle text-right">
                    <button
                      type="button"
                      onClick={() => remove(i)}
                      className="h-7 w-7 inline-flex items-center justify-center rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                      title={t('projectStatusReportSection.deleteRow')}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editing && (
        <Button size="sm" variant="outline" onClick={add} className="w-full">
          <Plus className="h-3.5 w-3.5 mr-1" /> {t('projectStatusReportSection.addRow')}
        </Button>
      )}
    </div>
  );
}

