/**
 * Reviewer-ийн хүсэлтийн дэлгэрэнгүй: тайлан, оношилгоо, хавсралт, түүх, триаж (төлөв / ач холбогдол /
 * давхардал), дотоод тэмдэглэл ↔ илгээгчид хариу (ТУСДАА), засварын хувилбар (Revit он тус бүрд).
 *
 * • Төлөвийн шилжилтийг сервер шийднэ (`next_statuses`) — UI зөвхөн тэр жагсаалтыг санал болгоно.
 * • Бүх засвар `version`-оор (optimistic) — хуучирсан таб 409 авч дахин уншина, түүх дарагдахгүй.
 * • Дотоод тэмдэглэл илгээгчид хэзээ ч очихгүй (сервер `visibility='private'`); хариу нь мэдэгдэлтэй.
 * • Хэрэглэгчийн бичвэр бүр React-ийн текст зангилаа (`whitespace-pre-wrap`) — HTML болж хэзээ ч орохгүй.
 */
import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, Copy, Download, Eye, FileText, Link2, Loader2, Lock, MessageSquare, Trash2 } from 'lucide-react';
import { useLanguage } from '@/shared/i18n';
import { toast } from '@/shared/components/Toast';
import { confirmDialog } from '@/shared/components/ConfirmDialog';
import { ApiError } from '@/shared/api/client';
import { Card, CardContent } from '@/ui/card';
import { Button } from '@/ui/button';
import { Badge } from '@/ui/badge';
import { Input } from '@/ui/input';
import { Textarea } from '@/ui/textarea';
import { Skeleton } from '@/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/ui/select';
import { cn } from '@/shared/lib/utils';
import { formatDateTime } from '@/shared/lib/time';
import {
  addEvent,
  addFix,
  efKeys,
  fetchInbox,
  fetchInboxDetail,
  markRead,
  removeFix,
  triage,
  type EfInboxDetail,
  type EfPriority,
  type EfReviewerAttachment,
  type EfStatus,
  type TriageBody,
} from '../api';
import { EF_PRIORITIES, formatBytes, PRIORITY_TONE, priorityKey, sourceKey, STATUS_TONE, statusKey, typeKey } from '../labels';
import { errorText } from '../upload';
import { AttachmentPreviewDialog } from './AttachmentPreview';
import { downloadAttachment } from './download';

const REVIT_YEARS = [2024, 2025, 2026, 2027];

function copy(text: string, done: string) {
  void navigator.clipboard?.writeText(text).then(() => toast.success(done));
}

export function InboxDetail({ id, onBack, onSelect }: { id: string; onBack: () => void; onSelect: (id: string) => void }) {
  const { t } = useLanguage();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: efKeys.detail(id), queryFn: () => fetchInboxDetail(id), retry: false, refetchOnWindowFocus: true });
  const [preview, setPreview] = useState<EfReviewerAttachment | null>(null);

  const refresh = async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: efKeys.detail(id) }),
      qc.invalidateQueries({ queryKey: efKeys.inboxAll }),
      qc.invalidateQueries({ queryKey: efKeys.count }),
    ]);
  };

  // Нээгдмэгц «уншсан» болгоно (илгээгчийн шинэ үйлдэл ирэхэд дахин уншаагүй болдог — сервер).
  const unread = q.data?.request.unread;
  useEffect(() => {
    if (!unread) return;
    void markRead(id)
      .then(() => Promise.all([qc.invalidateQueries({ queryKey: efKeys.inboxAll }), qc.invalidateQueries({ queryKey: efKeys.count })]))
      .catch(() => undefined);
  }, [id, unread, qc]);

  if (q.isPending) {
    return (
      <Card>
        <CardContent className="space-y-3 p-6">
          <Skeleton className="h-6 w-2/3" />
          <Skeleton className="h-32 w-full" />
        </CardContent>
      </Card>
    );
  }
  if (q.isError || !q.data) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-sm text-muted-foreground">{t('engFeedback.notFound')}</CardContent>
      </Card>
    );
  }
  const d = q.data;
  const r = d.request;

  return (
    <Card data-testid="ef-inbox-detail">
      <CardContent className="space-y-6 p-4 sm:p-6">
        <div className="space-y-2">
          <Button variant="ghost" size="sm" className="-ml-2 xl:hidden" onClick={onBack}>
            <ChevronLeft className="h-4 w-4" aria-hidden />
            {t('common.back')}
          </Button>
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-sm text-muted-foreground">{r.display_number}</span>
            <Badge variant="outline" className={cn('border', STATUS_TONE[r.status])}>
              {t(statusKey(r.status))}
            </Badge>
            <Badge variant="outline" className={cn('border', PRIORITY_TONE[r.priority])}>
              {t(priorityKey(r.priority))}
            </Badge>
            <Badge variant="outline">{t(typeKey(r.type))}</Badge>
            <Badge variant="outline">{t(sourceKey(r.source))}</Badge>
            {r.channel === 'revit' && <Badge variant="outline">Revit</Badge>}
          </div>
          <h2 className="break-words text-lg font-semibold">{r.title}</h2>
          <p className="text-micro text-muted-foreground">
            {d.submitter ? `${d.submitter.full_name || d.submitter.username}${d.submitter.employee_id ? ` (${d.submitter.employee_id})` : ''}` : '—'} ·{' '}
            {formatDateTime(r.submitted_at)}
            {r.tool_id ? ` · ${r.tool_id}` : ''}
          </p>
        </div>

        <TriagePanel detail={d} onSaved={refresh} />

        <ReportSection detail={d} />

        <EnvironmentSection detail={d} />

        {d.attachments.length > 0 && (
          <section className="space-y-2">
            <h3 className="text-label text-muted-foreground">{t('engFeedback.attachments')}</h3>
            <ul className="divide-y divide-border rounded-md border border-border" data-testid="ef-attachments">
              {d.attachments.map((a) => (
                <li key={a.id} className="flex flex-wrap items-center gap-3 px-3 py-2 text-sm">
                  <FileText className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                  <div className="min-w-0 flex-1">
                    <p className="truncate" title={a.name}>
                      {a.name}
                    </p>
                    <p className="text-micro text-muted-foreground">
                      {formatBytes(a.size)} ·{' '}
                      {a.integrity.mode === 'server_sha256'
                        ? `SHA-256 ${a.integrity.server_sha256?.slice(0, 12) ?? '—'}…${a.integrity.client_sha256 ? ` (${t('engFeedback.hashMatched')})` : ''}`
                        : t('engFeedback.multipartIntegrity')}
                    </p>
                  </div>
                  {a.preview && (
                    <Button size="sm" variant="outline" onClick={() => setPreview(a)}>
                      <Eye className="h-4 w-4" aria-hidden />
                      {t('engFeedback.preview')}
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      void downloadAttachment(r.id, a).catch((err) => toast.error(t('engFeedback.downloadFailed'), errorText(err, '')))
                    }
                    aria-label={t('engFeedback.download')}
                  >
                    <Download className="h-4 w-4" aria-hidden />
                  </Button>
                </li>
              ))}
            </ul>
          </section>
        )}

        <FixesSection detail={d} onSaved={refresh} />

        <RelatedSection detail={d} onSelect={onSelect} />

        <CommentBox requestId={r.id} onSaved={refresh} />

        <Timeline detail={d} />
      </CardContent>
      <AttachmentPreviewDialog requestId={r.id} attachment={preview} onClose={() => setPreview(null)} />
    </Card>
  );
}

function TriagePanel({ detail, onSaved }: { detail: EfInboxDetail; onSaved: () => Promise<void> }) {
  const { t } = useLanguage();
  const r = detail.request;
  const [status, setStatus] = useState<EfStatus>(r.status);
  const [priority, setPriority] = useState<EfPriority>(r.priority);
  const [dupNumber, setDupNumber] = useState('');
  const [reply, setReply] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  // Өөр хүсэлт рүү шилжих / серверээс шинэ хувилбар ирэхэд маягтыг шинэчилнэ.
  useEffect(() => {
    setStatus(r.status);
    setPriority(r.priority);
    setDupNumber('');
  }, [r.id, r.status, r.priority, r.version]);

  const options = useMemo(() => [r.status, ...r.next_statuses.filter((s) => s !== r.status)], [r.status, r.next_statuses]);
  const dirty = status !== r.status || priority !== r.priority || reply.trim() !== '' || note.trim() !== '';

  const resolveDuplicate = async (): Promise<string | null> => {
    const m = /^(?:пх-?)?0*(\d{1,7})$/i.exec(dupNumber.trim());
    if (!m) {
      toast.error(t('engFeedback.duplicateNumberInvalid'));
      return null;
    }
    const n = Number(m[1]);
    const found = await fetchInbox({ q: String(n), status: '', page_size: 10 });
    const hit = found.items.find((x) => x.number === n);
    if (!hit) {
      toast.error(t('engFeedback.duplicateNotFound'));
      return null;
    }
    return hit.id;
  };

  const save = async () => {
    setBusy(true);
    try {
      const body: TriageBody = { version: r.version };
      if (status !== r.status) body.status = status;
      if (priority !== r.priority) body.priority = priority;
      if (status === 'duplicate' && r.status !== 'duplicate') {
        const target = await resolveDuplicate();
        if (!target) return;
        body.duplicate_of = target;
      }
      if (reply.trim()) body.reply = reply.trim();
      if (note.trim()) body.note = note.trim();
      await triage(r.id, body);
      toast.success(t('engFeedback.saved'));
      setReply('');
      setNote('');
      await onSaved();
    } catch (err) {
      if (err instanceof ApiError && err.code === 'STALE_VERSION') {
        toast.warn(t('engFeedback.staleVersion'));
        await onSaved();
      } else {
        toast.error(t('engFeedback.saveFailed'), errorText(err, ''));
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="space-y-3 rounded-lg border border-border bg-muted/30 p-4" data-testid="ef-triage">
      <h3 className="text-label text-muted-foreground">{t('engFeedback.triage')}</h3>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <p className="text-micro text-muted-foreground">{t('engFeedback.fieldStatus')}</p>
          <Select value={status} onValueChange={(v) => setStatus(v as EfStatus)} disabled={busy}>
            <SelectTrigger data-testid="ef-status-select">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {options.map((s) => (
                <SelectItem key={s} value={s}>
                  {t(statusKey(s))}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <p className="text-micro text-muted-foreground">{t('engFeedback.fieldPriority')}</p>
          <Select value={priority} onValueChange={(v) => setPriority(v as EfPriority)} disabled={busy}>
            <SelectTrigger data-testid="ef-priority-select">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {EF_PRIORITIES.map((p) => (
                <SelectItem key={p} value={p}>
                  {t(priorityKey(p))}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      {status === 'duplicate' && r.status !== 'duplicate' && (
        <div className="space-y-1.5">
          <p className="text-micro text-muted-foreground">{t('engFeedback.duplicateOf')}</p>
          <Input value={dupNumber} onChange={(e) => setDupNumber(e.target.value)} placeholder="ПХ-0012" data-testid="ef-duplicate-input" />
        </div>
      )}
      <div className="grid gap-3 lg:grid-cols-2">
        <div className="space-y-1.5">
          <p className="flex items-center gap-1 text-micro text-muted-foreground">
            <MessageSquare className="h-3.5 w-3.5" aria-hidden />
            {t('engFeedback.replyToSender')}
          </p>
          <Textarea value={reply} rows={2} onChange={(e) => setReply(e.target.value)} disabled={busy} placeholder={t('engFeedback.replyHint')} />
        </div>
        <div className="space-y-1.5">
          <p className="flex items-center gap-1 text-micro text-muted-foreground">
            <Lock className="h-3.5 w-3.5" aria-hidden />
            {t('engFeedback.privateNote')}
          </p>
          <Textarea value={note} rows={2} onChange={(e) => setNote(e.target.value)} disabled={busy} placeholder={t('engFeedback.privateNoteHint')} />
        </div>
      </div>
      <div className="flex justify-end">
        <Button onClick={() => void save()} disabled={busy || !dirty} data-testid="ef-triage-save">
          {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
          {t('common.save')}
        </Button>
      </div>
    </section>
  );
}

function ReportSection({ detail }: { detail: EfInboxDetail }) {
  const { t } = useLanguage();
  const r = detail.request;
  const field = (label: string, value: string | null) =>
    value ? (
      <div className="space-y-1">
        <p className="text-label text-muted-foreground">{label}</p>
        <p className="whitespace-pre-wrap break-words text-sm">{value}</p>
      </div>
    ) : null;
  return (
    <section className="space-y-4">
      {field(t('engFeedback.fieldDescription'), r.description)}
      {field(t('engFeedback.fieldSteps'), r.steps)}
      <div className="grid gap-4 lg:grid-cols-2">
        {field(t('engFeedback.fieldExpected'), r.expected)}
        {field(t('engFeedback.fieldActual'), r.actual)}
      </div>
      {field(t('engFeedback.fieldSuggestion'), r.suggestion)}
      {field(t('engFeedback.fieldImpact'), r.impact)}
      {field(t('engFeedback.sourceContext'), r.source_context)}
    </section>
  );
}

function EnvironmentSection({ detail }: { detail: EfInboxDetail }) {
  const { t } = useLanguage();
  const r = detail.request;
  const [open, setOpen] = useState(false);
  const facts: Array<[string, string | null]> = [
    [t('engFeedback.revitYear'), r.revit_year ? String(r.revit_year) : null],
    [t('engFeedback.revitBuild'), r.revit_build],
    [t('engFeedback.addinVersion'), r.addin_version],
    [t('engFeedback.addinHash'), r.addin_sha256],
    [t('engFeedback.diagnosticsSchema'), r.diagnostics_schema],
  ];
  return (
    <section className="space-y-2">
      <h3 className="text-label text-muted-foreground">{t('engFeedback.environment')}</h3>
      <dl className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[auto_minmax(0,1fr)]">
        {facts.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-muted-foreground">{k}</dt>
            <dd className="flex min-w-0 items-center gap-1 font-mono text-xs">
              <span className="truncate" title={v ?? ''}>
                {v ?? '—'}
              </span>
              {v && v.length > 16 && (
                <button type="button" className="text-muted-foreground hover:text-foreground" onClick={() => copy(v, t('engFeedback.copied'))} aria-label={t('engFeedback.copy')}>
                  <Copy className="h-3.5 w-3.5" aria-hidden />
                </button>
              )}
            </dd>
          </div>
        ))}
      </dl>
      {r.diagnostics && (
        <div>
          <Button variant="ghost" size="sm" className="-ml-2" onClick={() => setOpen((o) => !o)} data-testid="ef-diagnostics-toggle">
            {open ? t('engFeedback.hideDiagnostics') : t('engFeedback.showDiagnostics')}
          </Button>
          {open && (
            <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-md border border-border bg-muted p-3 text-xs" data-testid="ef-diagnostics">
              {JSON.stringify(r.diagnostics, null, 2)}
            </pre>
          )}
        </div>
      )}
    </section>
  );
}

function FixesSection({ detail, onSaved }: { detail: EfInboxDetail; onSaved: () => Promise<void> }) {
  const { t } = useLanguage();
  const r = detail.request;
  const [year, setYear] = useState<string>(r.revit_year ? String(r.revit_year) : 'all');
  const [version, setVersion] = useState('');
  const [commit, setCommit] = useState('');
  const [pr, setPr] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const add = async () => {
    setBusy(true);
    try {
      await addFix(r.id, {
        revit_year: year === 'all' ? null : Number(year),
        fixed_version: version.trim() || undefined,
        commit_sha: commit.trim() || undefined,
        pr_url: pr.trim() || undefined,
        note: note.trim() || undefined,
      });
      setVersion('');
      setCommit('');
      setPr('');
      setNote('');
      toast.success(t('engFeedback.fixLinked'));
      await onSaved();
    } catch (err) {
      toast.error(t('engFeedback.saveFailed'), errorText(err, ''));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (fixId: number) => {
    const ok = await confirmDialog({ description: t('engFeedback.fixRemoveConfirm'), variant: 'destructive' });
    if (!ok) return;
    try {
      await removeFix(r.id, fixId);
      await onSaved();
    } catch (err) {
      toast.error(t('engFeedback.saveFailed'), errorText(err, ''));
    }
  };

  return (
    <section className="space-y-3" data-testid="ef-fixes">
      <h3 className="text-label text-muted-foreground">{t('engFeedback.fixes')}</h3>
      {detail.fixes.length > 0 ? (
        <ul className="space-y-1 text-sm">
          {detail.fixes.map((f) => (
            <li key={f.id} className="flex flex-wrap items-center gap-2 rounded-md border border-border px-3 py-2">
              <Badge variant="outline">{f.revit_year ?? t('engFeedback.allYears')}</Badge>
              {f.fixed_version && <span className="font-medium">{f.fixed_version}</span>}
              {f.commit_sha && <span className="font-mono text-xs">{f.commit_sha.slice(0, 10)}</span>}
              {f.pr_url && (
                <a href={f.pr_url} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 text-primary underline-offset-4 hover:underline">
                  <Link2 className="h-3.5 w-3.5" aria-hidden />
                  PR
                </a>
              )}
              {f.note && <span className="text-muted-foreground">— {f.note}</span>}
              <span className="ml-auto text-micro text-muted-foreground">{formatDateTime(f.linked_at)}</span>
              <Button size="icon" variant="ghost" onClick={() => void remove(f.id)} aria-label={t('engFeedback.fixRemove')}>
                <Trash2 className="h-4 w-4" aria-hidden />
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-micro text-muted-foreground">{t('engFeedback.noFixes')}</p>
      )}
      <div className="grid gap-2 sm:grid-cols-[8rem_minmax(0,1fr)_minmax(0,1fr)]">
        <Select value={year} onValueChange={setYear}>
          <SelectTrigger aria-label={t('engFeedback.revitYear')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('engFeedback.allYears')}</SelectItem>
            {REVIT_YEARS.map((y) => (
              <SelectItem key={y} value={String(y)}>
                Revit {y}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input value={version} onChange={(e) => setVersion(e.target.value)} placeholder={t('engFeedback.fixedVersionPlaceholder')} />
        <Input value={commit} onChange={(e) => setCommit(e.target.value)} placeholder={t('engFeedback.commitPlaceholder')} />
        <Input className="sm:col-span-2" value={pr} onChange={(e) => setPr(e.target.value)} placeholder="https://github.com/…/pull/123" />
        <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('engFeedback.fixNotePlaceholder')} />
      </div>
      <div className="flex items-center justify-between gap-2">
        <p className="text-micro text-muted-foreground">{t('engFeedback.fixHint')}</p>
        <Button size="sm" variant="outline" onClick={() => void add()} disabled={busy || (!version.trim() && !commit.trim() && !pr.trim())} data-testid="ef-fix-add">
          {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
          {t('engFeedback.fixAdd')}
        </Button>
      </div>
    </section>
  );
}

function RelatedSection({ detail, onSelect }: { detail: EfInboxDetail; onSelect: (id: string) => void }) {
  const { t } = useLanguage();
  if (!detail.duplicate_of && detail.duplicates.length === 0 && detail.related.length === 0) return null;
  const row = (x: { id: string; display_number: string; title: string; status: EfStatus; revit_year?: number | null; revit_build?: string | null; addin_version?: string | null }) => (
    <li key={x.id}>
      <button type="button" onClick={() => onSelect(x.id)} className="flex w-full flex-wrap items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted">
        <span className="font-mono text-xs text-muted-foreground">{x.display_number}</span>
        <span className="min-w-0 flex-1 truncate">{x.title}</span>
        {x.revit_year && <Badge variant="outline">Revit {x.revit_year}</Badge>}
        {x.addin_version && <span className="text-micro text-muted-foreground">{x.addin_version}</span>}
        <Badge variant="outline" className={cn('border', STATUS_TONE[x.status])}>
          {t(statusKey(x.status))}
        </Badge>
      </button>
    </li>
  );
  return (
    <section className="space-y-3" data-testid="ef-related">
      {detail.duplicate_of && (
        <div className="space-y-1">
          <h3 className="text-label text-muted-foreground">{t('engFeedback.duplicateOfTitle')}</h3>
          <ul>{row(detail.duplicate_of)}</ul>
        </div>
      )}
      {detail.duplicates.length > 0 && (
        <div className="space-y-1">
          <h3 className="text-label text-muted-foreground">{t('engFeedback.duplicatesTitle', { n: detail.duplicates.length })}</h3>
          <ul>{detail.duplicates.map((x) => row(x))}</ul>
        </div>
      )}
      {detail.related.length > 0 && (
        <div className="space-y-1">
          <h3 className="text-label text-muted-foreground">{t('engFeedback.relatedTitle')}</h3>
          <ul>{detail.related.map((x) => row(x))}</ul>
        </div>
      )}
    </section>
  );
}

function CommentBox({ requestId, onSaved }: { requestId: string; onSaved: () => Promise<void> }) {
  const { t } = useLanguage();
  const [kind, setKind] = useState<'note' | 'reply'>('note');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const send = async () => {
    if (!text.trim()) return;
    setBusy(true);
    try {
      await addEvent(requestId, kind, text.trim());
      setText('');
      toast.success(kind === 'reply' ? t('engFeedback.replySent') : t('engFeedback.noteSaved'));
      await onSaved();
    } catch (err) {
      toast.error(t('engFeedback.saveFailed'), errorText(err, ''));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="space-y-2">
      <div className="inline-flex rounded-md border border-border p-0.5 text-sm" role="tablist">
        {(['note', 'reply'] as const).map((k) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={kind === k}
            onClick={() => setKind(k)}
            className={cn('inline-flex items-center gap-1 rounded px-3 py-1', kind === k ? 'bg-muted font-medium' : 'text-muted-foreground')}
          >
            {k === 'note' ? <Lock className="h-3.5 w-3.5" aria-hidden /> : <MessageSquare className="h-3.5 w-3.5" aria-hidden />}
            {k === 'note' ? t('engFeedback.privateNote') : t('engFeedback.replyToSender')}
          </button>
        ))}
      </div>
      <Textarea
        value={text}
        rows={3}
        onChange={(e) => setText(e.target.value)}
        placeholder={kind === 'note' ? t('engFeedback.privateNoteHint') : t('engFeedback.replyHint')}
        data-testid="ef-comment"
      />
      <div className="flex justify-end">
        <Button size="sm" onClick={() => void send()} disabled={busy || !text.trim()} data-testid="ef-comment-send">
          {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
          {kind === 'reply' ? t('engFeedback.sendReply') : t('engFeedback.saveNote')}
        </Button>
      </div>
    </section>
  );
}

function Timeline({ detail }: { detail: EfInboxDetail }) {
  const { t } = useLanguage();
  return (
    <section className="space-y-3">
      <h3 className="text-label text-muted-foreground">{t('engFeedback.history')}</h3>
      <ol className="space-y-3 border-l border-border pl-4" data-testid="ef-timeline">
        {detail.events.map((e) => {
          const line =
            e.kind === 'status' || e.kind === 'duplicate' || e.kind === 'reopen' || e.kind === 'submitted' || e.kind === 'retest'
              ? `${t(`engFeedback.event.${e.kind}`)}: ${e.from_value ? `${t(statusKey(e.from_value as EfStatus))} → ` : ''}${e.to_value ? t(statusKey(e.to_value as EfStatus)) : ''}`
              : e.kind === 'priority'
                ? `${t('engFeedback.event.priority')}: ${t(priorityKey((e.from_value ?? 'normal') as EfPriority))} → ${t(priorityKey((e.to_value ?? 'normal') as EfPriority))}`
                : e.kind === 'release'
                  ? `${t('engFeedback.event.release')}: ${e.to_value ?? ''}`
                  : t(`engFeedback.event.${e.kind}`);
          return (
            <li key={e.id} className="relative space-y-1 text-sm">
              <span className={cn('absolute -left-[1.3rem] top-1.5 h-2 w-2 rounded-full', e.visibility === 'private' ? 'bg-muted-foreground/40' : 'bg-primary')} aria-hidden />
              <p className="flex flex-wrap items-center gap-2 text-micro text-muted-foreground">
                {formatDateTime(e.created_at)} · {t(`engFeedback.actor.${e.actor_role === 'reviewer' ? 'reviewer' : e.actor_role === 'system' ? 'system' : 'sender'}`)}
                <Badge variant="outline" className="text-micro">
                  {e.visibility === 'private' ? t('engFeedback.visibilityPrivate') : t('engFeedback.visibilitySender')}
                </Badge>
              </p>
              <p>{line}</p>
              {e.body && (
                <p className={cn('whitespace-pre-wrap break-words rounded-md px-3 py-2', e.visibility === 'private' ? 'border border-dashed border-border' : 'bg-muted')}>{e.body}</p>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
