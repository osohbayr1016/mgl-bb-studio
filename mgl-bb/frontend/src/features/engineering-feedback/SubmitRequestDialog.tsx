/**
 * «Програмын хүсэлт илгээх» — ERP-ээс (Revit add-in-тэй ИЖИЛ гэрээгээр): ноорог → хавсралт → атом submit.
 *
 * • `client_request_id` нь цонх нээгдэх бүрт нэг удаа үүснэ — давхар товшилт, timeout-ийн дараах «Дахин илгээх»
 *   нь сервер дээр НЭГ хүсэлт хэвээр (idempotent).
 * • Файлын байт ХУВИЙН bucket руу шууд (XHR явцтай); амжилттай болсон хавсралтыг дахин илгээхгүй.
 * • Reviewer-ийн дотоод мэдээлэл энд хэзээ ч ирэхгүй — илгээгч зөвхөн өөрийн дугаар, нийтийн төлөвийг хардаг.
 */
import { useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, FileText, Loader2, Paperclip, Trash2, Upload } from 'lucide-react';
import { ApiError } from '@/shared/api/client';
import { useLanguage } from '@/shared/i18n';
import { toast } from '@/shared/components/Toast';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import { Textarea } from '@/ui/textarea';
import { Field } from '@/ui/field';
import { Progress } from '@/ui/progress';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/ui/dialog';
import { cn } from '@/shared/lib/utils';
import { createDraft, efKeys, submitDraft, type DraftBody, type EfReceipt, type EfSource, type EfType } from './api';
import { EF_SOURCES, EF_TYPES, extensionOf, formatBytes, newClientId, sourceKey, typeKey } from './labels';
import { errorText, uploadAttachment, type UploadState } from './upload';
import { useEfCapabilities } from './useEfCapabilities';

interface PickedFile {
  key: string;
  file: File;
  clientId: string;
  state: UploadState;
  attachmentId?: string;
}

const DEFAULT_LIMITS = {
  max_attachments: 5,
  max_total_bytes: 100 * 1024 * 1024,
  max_ordinary_bytes: 25 * 1024 * 1024,
  extensions: {} as Record<string, { large: boolean; preview: string | null }>,
};

function browserDiagnostics(): Record<string, unknown> {
  const script = document.querySelector<HTMLScriptElement>('script[type="module"][src*="/assets/index-"]');
  return {
    schema: 'mgl-diag/1',
    channel: 'erp',
    app: { page: window.location.pathname, bundle: script?.getAttribute('src') ?? null },
    browser: {
      user_agent: navigator.userAgent,
      language: navigator.language,
      viewport: `${window.innerWidth}x${window.innerHeight}`,
      device_pixel_ratio: window.devicePixelRatio,
      online: navigator.onLine,
    },
    captured_at: new Date().toISOString(),
  };
}

export function SubmitRequestDialog({
  open,
  onOpenChange,
  defaultSource = 'erp',
  onSubmitted,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultSource?: EfSource;
  onSubmitted?: (r: EfReceipt) => void;
}) {
  const { t } = useLanguage();
  const qc = useQueryClient();
  const caps = useEfCapabilities();
  const limits = caps.data?.limits ?? DEFAULT_LIMITS;
  const fileInput = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const [clientRequestId, setClientRequestId] = useState(() => newClientId('erp'));
  const [type, setType] = useState<EfType>('bug');
  const [source, setSource] = useState<EfSource>(defaultSource);
  const [toolId, setToolId] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [expected, setExpected] = useState('');
  const [actual, setActual] = useState('');
  const [steps, setSteps] = useState('');
  const [suggestion, setSuggestion] = useState('');
  const [impact, setImpact] = useState('');
  const [files, setFiles] = useState<PickedFile[]>([]);
  const [draftId, setDraftId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<EfReceipt | null>(null);
  const [touched, setTouched] = useState(false);

  const totalBytes = useMemo(() => files.reduce((s, f) => s + f.file.size, 0), [files]);

  const reset = () => {
    setClientRequestId(newClientId('erp'));
    setType('bug');
    setSource(defaultSource);
    setToolId('');
    setTitle('');
    setDescription('');
    setExpected('');
    setActual('');
    setSteps('');
    setSuggestion('');
    setImpact('');
    setFiles([]);
    setDraftId(null);
    setError(null);
    setReceipt(null);
    setTouched(false);
  };

  const close = (next: boolean) => {
    if (!next && busy) return;
    onOpenChange(next);
    if (!next) {
      abortRef.current?.abort();
      // Амжилттай илгээсэн бол дараагийн нээлт хоосон маягттай.
      if (receipt) reset();
    }
  };

  const fileProblem = (f: File, current: PickedFile[]): string | null => {
    const ext = extensionOf(f.name);
    const spec = limits.extensions[ext];
    if (caps.data && !spec) return t('engFeedback.fileTypeNotAllowed', { ext: ext || '?' });
    if (current.length >= limits.max_attachments) return t('engFeedback.tooManyFiles', { n: limits.max_attachments });
    if (f.size <= 0) return t('engFeedback.fileEmpty');
    if (!spec?.large && f.size > limits.max_ordinary_bytes) return t('engFeedback.fileTooLarge', { size: formatBytes(limits.max_ordinary_bytes) });
    const used = current.reduce((s, x) => s + x.file.size, 0);
    if (used + f.size > limits.max_total_bytes) return t('engFeedback.totalTooLarge', { size: formatBytes(limits.max_total_bytes) });
    return null;
  };

  const addFiles = (list: FileList | null) => {
    if (!list?.length) return;
    let next = files;
    for (const f of Array.from(list)) {
      const problem = fileProblem(f, next);
      if (problem) {
        toast.error(f.name, problem);
        continue;
      }
      next = [
        ...next,
        { key: `${f.name}-${f.size}-${f.lastModified}-${Math.random()}`, file: f, clientId: newClientId('att'), state: { phase: 'queued', loaded: 0, total: f.size } },
      ];
    }
    setFiles(next);
  };

  const removeFile = (key: string) => setFiles((prev) => prev.filter((f) => f.key !== key));

  const titleError = touched && title.trim().length < 3 ? t('engFeedback.titleRequired') : undefined;
  const descriptionError = touched && description.trim().length < 3 ? t('engFeedback.descriptionRequired') : undefined;
  const storageMissing = !!caps.data && !caps.data.storage_available;

  const body = (): DraftBody => ({
    client_request_id: clientRequestId,
    source,
    tool_id: toolId.trim() || undefined,
    type,
    title: title.trim(),
    description: description.trim(),
    expected: type === 'bug' ? expected.trim() || undefined : undefined,
    actual: type === 'bug' ? actual.trim() || undefined : undefined,
    steps: type === 'bug' ? steps.trim() || undefined : undefined,
    suggestion: type === 'improvement' ? suggestion.trim() || undefined : undefined,
    impact: impact.trim() || undefined,
    diagnostics: browserDiagnostics(),
  });

  const submit = async () => {
    setTouched(true);
    if (title.trim().length < 3 || description.trim().length < 3) return;
    if (files.length && storageMissing) {
      setError(t('engFeedback.storageMissing'));
      return;
    }
    setBusy(true);
    setError(null);
    const ac = new AbortController();
    abortRef.current = ac;
    try {
      const payload = body();
      let id = draftId;
      if (!id) {
        const created = await createDraft(payload);
        id = created.request.id;
        setDraftId(id);
      }
      const ids: string[] = [];
      for (const pf of files) {
        if (pf.state.phase === 'ready' && pf.attachmentId) {
          ids.push(pf.attachmentId);
          continue;
        }
        const att = await uploadAttachment(id, pf.file, pf.clientId, {
          ordinaryMax: limits.max_ordinary_bytes,
          signal: ac.signal,
          onState: (s) => setFiles((prev) => prev.map((x) => (x.key === pf.key ? { ...x, state: s, attachmentId: s.attachmentId ?? x.attachmentId } : x))),
        });
        ids.push(att.id);
      }
      const res = await submitDraft(id, { ...payload, attachment_ids: ids });
      setReceipt(res.receipt);
      onSubmitted?.(res.receipt);
      void qc.invalidateQueries({ queryKey: efKeys.mine });
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        setFiles((prev) => prev.map((x) => (x.state.phase === 'ready' ? x : { ...x, state: { ...x.state, phase: 'cancelled' } })));
        return;
      }
      // Өмнөх оролдлого сервер дээр аль хэдийн амжсан (timeout-ийн дараа агуулгыг засаад дахин дарсан) —
      // давхар хүсэлт үүсгэхгүй, анх хүлээн авсан баримтыг харуулна.
      if (err instanceof ApiError && err.code === 'IDEMPOTENCY_CONFLICT' && err.payload.receipt) {
        setReceipt(err.payload.receipt as EfReceipt);
        toast.info(t('engFeedback.alreadySubmitted'));
        return;
      }
      setFiles((prev) => prev.map((x) => (x.state.phase === 'ready' ? x : { ...x, state: { ...x.state, phase: x.state.phase === 'queued' ? 'queued' : 'failed' } })));
      setError(errorText(err, t('engFeedback.submitFailed')));
    } finally {
      setBusy(false);
      abortRef.current = null;
    }
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t('engFeedback.newTitle')}</DialogTitle>
          <DialogDescription>{t('engFeedback.newDescription')}</DialogDescription>
        </DialogHeader>

        {receipt ? (
          <div className="space-y-4 py-2" data-testid="ef-receipt">
            <div className="flex items-start gap-3 rounded-lg border border-success/30 bg-success/10 p-4">
              <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-success" aria-hidden />
              <div className="space-y-1">
                <p className="font-medium text-foreground">
                  {t('engFeedback.receivedAs', { number: receipt.display_number ?? '' })}
                </p>
                <p className="text-sm text-muted-foreground">{t('engFeedback.receivedHint')}</p>
                {receipt.attachments.length > 0 && (
                  <p className="text-sm text-muted-foreground">
                    {t('engFeedback.receivedFiles', { n: receipt.attachments.length })}
                  </p>
                )}
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => reset()}>
                {t('engFeedback.sendAnother')}
              </Button>
              <Button asChild>
                <Link to={`/app/my-engineering-requests?id=${encodeURIComponent(receipt.id)}`} onClick={() => close(false)}>
                  {t('engFeedback.openMine')}
                </Link>
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t('engFeedback.fieldType')}>
                <Select value={type} onValueChange={(v) => setType(v as EfType)} disabled={busy}>
                  <SelectTrigger data-testid="ef-type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {EF_TYPES.map((x) => (
                      <SelectItem key={x} value={x}>
                        {t(typeKey(x))}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label={t('engFeedback.fieldSource')}>
                <Select value={source} onValueChange={(v) => setSource(v as EfSource)} disabled={busy}>
                  <SelectTrigger data-testid="ef-source">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {EF_SOURCES.map((x) => (
                      <SelectItem key={x} value={x}>
                        {t(sourceKey(x))}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            </div>

            <Field label={t('engFeedback.fieldTitle')} required error={titleError}>
              <Input
                value={title}
                maxLength={200}
                onChange={(e) => setTitle(e.target.value)}
                disabled={busy}
                placeholder={t('engFeedback.titlePlaceholder')}
                data-testid="ef-title"
              />
            </Field>
            <Field label={t('engFeedback.fieldDescription')} required error={descriptionError}>
              <Textarea
                value={description}
                rows={4}
                onChange={(e) => setDescription(e.target.value)}
                disabled={busy}
                placeholder={t('engFeedback.descriptionPlaceholder')}
                data-testid="ef-description"
              />
            </Field>

            {type === 'bug' && (
              <>
                <Field label={t('engFeedback.fieldSteps')}>
                  <Textarea value={steps} rows={3} onChange={(e) => setSteps(e.target.value)} disabled={busy} placeholder={t('engFeedback.stepsPlaceholder')} />
                </Field>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label={t('engFeedback.fieldExpected')}>
                    <Textarea value={expected} rows={2} onChange={(e) => setExpected(e.target.value)} disabled={busy} />
                  </Field>
                  <Field label={t('engFeedback.fieldActual')}>
                    <Textarea value={actual} rows={2} onChange={(e) => setActual(e.target.value)} disabled={busy} />
                  </Field>
                </div>
              </>
            )}
            {type === 'improvement' && (
              <Field label={t('engFeedback.fieldSuggestion')}>
                <Textarea value={suggestion} rows={3} onChange={(e) => setSuggestion(e.target.value)} disabled={busy} />
              </Field>
            )}
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t('engFeedback.fieldImpact')} hint={t('engFeedback.impactHint')}>
                <Input value={impact} maxLength={400} onChange={(e) => setImpact(e.target.value)} disabled={busy} />
              </Field>
              <Field label={t('engFeedback.fieldTool')} hint={t('engFeedback.toolHint')}>
                <Input value={toolId} maxLength={80} onChange={(e) => setToolId(e.target.value.replace(/[^A-Za-z0-9_.:@-]/g, ''))} disabled={busy} />
              </Field>
            </div>

            <div className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-medium">
                  {t('engFeedback.attachments')}{' '}
                  <span className="text-muted-foreground">
                    ({files.length}/{limits.max_attachments} · {formatBytes(totalBytes)} / {formatBytes(limits.max_total_bytes)})
                  </span>
                </p>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={busy || storageMissing || files.length >= limits.max_attachments}
                  onClick={() => fileInput.current?.click()}
                  data-testid="ef-add-file"
                >
                  <Paperclip className="h-4 w-4" aria-hidden />
                  {t('engFeedback.addFile')}
                </Button>
                <input
                  ref={fileInput}
                  type="file"
                  multiple
                  className="hidden"
                  accept={Object.keys(limits.extensions).map((e) => `.${e}`).join(',') || undefined}
                  onChange={(e) => {
                    addFiles(e.target.files);
                    e.target.value = '';
                  }}
                  data-testid="ef-file-input"
                />
              </div>
              {storageMissing ? (
                <p className="text-micro text-warning">{t('engFeedback.storageMissing')}</p>
              ) : (
                <p className="text-micro text-muted-foreground">
                  {t('engFeedback.attachmentsHint', {
                    ordinary: formatBytes(limits.max_ordinary_bytes),
                    total: formatBytes(limits.max_total_bytes),
                  })}
                </p>
              )}
              {files.length > 0 && (
                <ul className="divide-y divide-border rounded-md border border-border">
                  {files.map((f) => {
                    const pct = f.state.total > 0 ? Math.round((f.state.loaded / f.state.total) * 100) : 0;
                    return (
                      <li key={f.key} className="flex items-center gap-3 px-3 py-2 text-sm" data-testid="ef-file-row">
                        <FileText className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                        <div className="min-w-0 flex-1">
                          <p className="truncate" title={f.file.name}>
                            {f.file.name}
                          </p>
                          <div className="flex items-center gap-2 text-micro text-muted-foreground">
                            <span>{formatBytes(f.file.size)}</span>
                            <span
                              className={cn(
                                f.state.phase === 'ready' && 'text-success',
                                f.state.phase === 'failed' && 'text-destructive',
                              )}
                            >
                              {t(`engFeedback.upload.${f.state.phase}`)}
                            </span>
                          </div>
                          {(f.state.phase === 'uploading' || f.state.phase === 'completing') && <Progress value={pct} className="mt-1 h-1.5" />}
                        </div>
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          disabled={busy}
                          onClick={() => removeFile(f.key)}
                          aria-label={t('engFeedback.removeFile')}
                        >
                          <Trash2 className="h-4 w-4" aria-hidden />
                        </Button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            <p className="text-micro text-muted-foreground">{t('engFeedback.diagnosticsNote')}</p>
            {error && (
              <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive-ink" data-testid="ef-error">
                {error}
              </p>
            )}

            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => (busy ? abortRef.current?.abort() : close(false))}
                data-testid="ef-cancel"
              >
                {busy ? t('engFeedback.stopUpload') : t('common.cancel')}
              </Button>
              <Button onClick={() => void submit()} disabled={busy || !caps.canSubmit} data-testid="ef-submit">
                {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Upload className="h-4 w-4" aria-hidden />}
                {error ? t('engFeedback.retrySubmit') : t('engFeedback.submit')}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
