/**
 * 05 — Илгээх.  Захиалагч маягтаар материалаа өгнө («transmittal»).
 *
 * ⚠️ ГОЛ ЗАРЧИМ: захиалагчаас файлаа зөв нэрлэхийг ШААРДАХГҮЙ.  Файл бүр
 *    ямар нэрээр хадгалагдахыг баруун талын самбарт ШУУД харуулна
 *    (`POST /client/preview-name`) — нэрлэх заавар унших шаардлагагүй.
 *
 * Логик (байршуулалт → урьдчилсан нэр → илгээх → түүх) өмнөхтэй ижил;
 * дизайн нь 3 алхамт маягт + нэрийн самбар + түүхийн бүртгэл болж өөрчлөгдсөн.
 */
import { useCallback, useEffect, useRef, useState, type DragEvent, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowRight, Check, ChevronDown, Download, FileUp, Loader2, X } from 'lucide-react';

import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import { Label } from '@/ui/label';
import { Textarea } from '@/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/ui/select';
import { uploadClientFile } from '@/shared/api/client';
import { useApiQuery } from '@/shared/api/useApi';
import { toast } from '@/shared/components/Toast';
import { useLanguage } from '@/shared/i18n';
import { formatDate } from '@/shared/lib/time';
import { cn } from '@/shared/lib/utils';

import {
  previewNames,
  submitMaterial,
  type ClientSubmission,
  type SubmissionTemplate,
} from '../portalApi';
import { EmptyState, Eyebrow, SectionHeader, SkeletonBar, SubHeader } from '../components/primitives';
import { useDownloader } from '../hooks/useDownloader';
import { formatBytes } from '../lib/clientFormat';
import { countLabel } from '../lib/labels';

const MAX_FILES = 20;

interface PendingFile {
  uid: number;
  file: File;
  key?: string;
  uploading: boolean;
  error?: string;
}

const FIELD_CLASS = 'rounded-none border-foreground/20 bg-background shadow-none focus-visible:border-foreground';

export function SubmitTab({ projectId, canSubmit }: { projectId: number; canSubmit: boolean }) {
  const { t } = useLanguage();

  const historyQuery = useApiQuery<{ submissions: ClientSubmission[] }>(
    `/client/submissions?project_id=${projectId}`,
  );

  return (
    <div className="flex flex-col gap-16 pt-10 md:gap-20 md:pt-14">
      <SectionHeader
        index="05"
        eyebrow={t('clientRoom.nav.submit')}
        title={t('clientRoom.submit.title')}
        description={t('clientRoom.submit.description')}
      />

      {canSubmit ? (
        <SubmitForm projectId={projectId} />
      ) : (
        <EmptyState title={t('clientRoom.submit.noRightTitle')} body={t('clientRoom.submit.noRight')} />
      )}

      <History
        submissions={historyQuery.data?.submissions ?? []}
        loading={historyQuery.isLoading}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Маягт                                                              */
/* ------------------------------------------------------------------ */

function SubmitForm({ projectId }: { projectId: number }) {
  const { t } = useLanguage();
  const qc = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const uidRef = useRef(0);

  const templatesQuery = useApiQuery<{ templates: SubmissionTemplate[] }>('/client/templates');
  const templates = templatesQuery.data?.templates ?? [];

  const [templateId, setTemplateId] = useState<number | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [title, setTitle] = useState('');
  const [files, setFiles] = useState<PendingFile[]>([]);
  const [preview, setPreview] = useState<{ key: string; names: string[] } | null>(null);
  const [sending, setSending] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  // Сонголтгүй бол эхний маягт — effect-гүйгээр гаргаж авна.
  const template = templates.find((x) => x.id === templateId) ?? templates[0] ?? null;
  const discipline = fields.discipline ?? null;
  const fileNames = files.map((f) => f.file.name);
  const previewKey = template ? JSON.stringify([template.id, discipline, fileNames]) : '';
  const names = preview && preview.key === previewKey ? preview.names : [];

  // Маягт/чиглэл/файл өөрчлөгдөх бүрд хадгалагдах нэрийг серверээс асууна.
  // Оролт нь бүхэлдээ `previewKey`-д (JSON) — массив шинээр үүсэх бүрд
  // дахин асуухгүйн тулд утгаар нь харьцуулна.
  useEffect(() => {
    if (!previewKey) return;
    const [tplId, disc, list] = JSON.parse(previewKey) as [number, string | null, string[]];
    if (list.length === 0) return;
    let cancelled = false;
    void previewNames({ project_id: projectId, template_id: tplId, discipline: disc, file_names: list })
      .then((res) => {
        if (!cancelled) setPreview({ key: previewKey, names: res.names });
      })
      .catch(() => {
        if (!cancelled) setPreview({ key: previewKey, names: [] });
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, previewKey]);

  const addFiles = useCallback(async (list: FileList | File[] | null) => {
    if (!list || list.length === 0) return;
    const picked = Array.from(list)
      .slice(0, MAX_FILES)
      .map((file) => ({ uid: ++uidRef.current, file, uploading: true }) satisfies PendingFile);
    setFiles((prev) => [...prev, ...picked].slice(0, MAX_FILES));

    // Байршуулалт нь ХУВИЙН bucket руу — зөвхөн түлхүүр буцна.
    await Promise.all(
      picked.map(async (p) => {
        try {
          const key = await uploadClientFile(p.file);
          setFiles((prev) => prev.map((f) => (f.uid === p.uid ? { ...f, key, uploading: false } : f)));
        } catch (err) {
          setFiles((prev) =>
            prev.map((f) =>
              f.uid === p.uid
                ? {
                    ...f,
                    uploading: false,
                    error: err instanceof Error ? err.message : 'Upload failed',
                  }
                : f,
            ),
          );
        }
      }),
    );
  }, []);

  const removeFile = (uid: number) => setFiles((prev) => prev.filter((f) => f.uid !== uid));

  const requiredMissing = (template?.fields ?? []).some(
    (f) => f.required && (fields[f.key] ?? '').trim().length === 0,
  );
  const uploadedCount = files.filter((f) => f.key && !f.uploading && !f.error).length;
  const ready =
    template != null && files.length > 0 && uploadedCount === files.length && !requiredMissing;

  const send = async () => {
    if (!template || !ready || sending) return;
    setSending(true);
    try {
      const res = await submitMaterial({
        project_id: projectId,
        template_id: template.id,
        title: title.trim() || undefined,
        discipline,
        fields,
        files: files.map((f) => ({
          key: f.key!,
          name: f.file.name,
          size: f.file.size,
          type: f.file.type || null,
        })),
      });
      toast.success(`${t('clientRoom.submit.submitted')} · ${res.submission.ref_no}`);
      setFiles([]);
      setFields({});
      setTitle('');
      setPreview(null);
      void qc.invalidateQueries({ queryKey: [`/client/submissions?project_id=${projectId}`] });
    } catch (err) {
      toast.error(t('clientRoom.submit.failed'), err instanceof Error ? err.message : undefined);
    } finally {
      setSending(false);
    }
  };

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragOver(false);
    void addFiles(e.dataTransfer.files);
  };

  if (templatesQuery.isLoading) {
    return (
      <div className="grid gap-6 lg:grid-cols-12">
        <SkeletonBar className="h-72 lg:col-span-7" />
        <SkeletonBar className="h-72 lg:col-span-5" />
      </div>
    );
  }

  return (
    <div className="grid gap-12 lg:grid-cols-12 lg:gap-10">
      <form
        className="flex flex-col gap-12 lg:col-span-7"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
        data-testid="client-submit-form"
      >
        <Step index="01" title={t('clientRoom.submit.step1')}>
          <div
            role="radiogroup"
            aria-label={t('clientRoom.submit.step1')}
            className="grid gap-px border border-foreground/10 bg-foreground/10 sm:grid-cols-2"
          >
            {templates.map((tpl) => {
              const selected = template?.id === tpl.id;
              return (
                <Button
                  key={tpl.id}
                  type="button"
                  variant="ghost"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => {
                    setTemplateId(tpl.id);
                    setFields({});
                  }}
                  className={cn(
                    'flex h-auto pointer-coarse:h-auto flex-col items-start justify-start gap-2 whitespace-normal rounded-none bg-background p-5 text-left font-normal hover:bg-background',
                    selected ? 'ring-1 ring-inset ring-foreground' : 'hover:ring-1 hover:ring-inset hover:ring-foreground/30',
                  )}
                >
                  <span className="flex w-full items-start justify-between gap-3">
                    <span className="text-sm font-medium leading-snug text-foreground">{tpl.name_mn}</span>
                    <span
                      aria-hidden
                      className={cn(
                        'mt-0.5 h-4 w-4 shrink-0 rounded-full border',
                        selected ? 'border-[5px] border-foreground' : 'border-foreground/40',
                      )}
                    />
                  </span>
                  {tpl.description_mn ? (
                    <span className="text-micro leading-relaxed text-muted-foreground">{tpl.description_mn}</span>
                  ) : null}
                </Button>
              );
            })}
          </div>
        </Step>

        <Step index="02" title={t('clientRoom.submit.step2')}>
          <div className="grid gap-5 sm:grid-cols-2">
            <div className="flex flex-col gap-2 sm:col-span-2">
              <Label htmlFor="client-submit-title" className="font-mono text-label uppercase tracking-[0.12em] text-muted-foreground">
                {t('clientRoom.submit.titleLabel')}
              </Label>
              <Input
                id="client-submit-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={template?.name_mn ?? ''}
                className={FIELD_CLASS}
              />
            </div>
            {(template?.fields ?? []).map((f) => {
              const id = `client-field-${f.key}`;
              return (
                <div key={f.key} className={cn('flex flex-col gap-2', f.type === 'textarea' && 'sm:col-span-2')}>
                  <Label htmlFor={id} className="font-mono text-label uppercase tracking-[0.12em] text-muted-foreground">
                    {f.label_mn}
                    {f.required ? <span className="text-danger"> *</span> : null}
                  </Label>
                  {f.type === 'select' ? (
                    <Select
                      value={fields[f.key] ?? ''}
                      onValueChange={(v) => setFields((prev) => ({ ...prev, [f.key]: v }))}
                    >
                      <SelectTrigger id={id} className={cn('w-full', FIELD_CLASS)}>
                        <SelectValue placeholder="—" />
                      </SelectTrigger>
                      <SelectContent className="rounded-none">
                        {(f.choices ?? []).map((choice) => (
                          <SelectItem key={choice} value={choice}>
                            {choice}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : f.type === 'textarea' ? (
                    <Textarea
                      id={id}
                      rows={3}
                      value={fields[f.key] ?? ''}
                      onChange={(e) => setFields((prev) => ({ ...prev, [f.key]: e.target.value }))}
                      className={FIELD_CLASS}
                    />
                  ) : (
                    <Input
                      id={id}
                      type={f.type === 'date' ? 'date' : 'text'}
                      value={fields[f.key] ?? ''}
                      onChange={(e) => setFields((prev) => ({ ...prev, [f.key]: e.target.value }))}
                      className={FIELD_CLASS}
                    />
                  )}
                </div>
              );
            })}
          </div>
          {(template?.fields ?? []).some((f) => f.required) ? (
            <p className="mt-3 text-micro text-muted-foreground">{t('clientRoom.submit.requiredHint')}</p>
          ) : null}
        </Step>

        <Step index="03" title={t('clientRoom.submit.step3')}>
          <div
            onDragOver={(e) => {
              e.preventDefault();
              if (!dragOver) setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDrop}
            className={cn(
              'flex flex-col items-center justify-center gap-4 border border-dashed px-6 py-12 text-center transition-colors',
              dragOver ? 'border-foreground bg-foreground/[0.04]' : 'border-foreground/25',
            )}
            data-testid="client-submit-dropzone"
          >
            <FileUp className="h-6 w-6 text-muted-foreground" strokeWidth={1.25} />
            <p className="font-display text-xl font-light tracking-[-0.015em] text-foreground">
              {t('clientRoom.submit.dropTitle')}
            </p>
            <p className="text-micro text-muted-foreground">{t('clientRoom.submit.dropHint')}</p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => inputRef.current?.click()}
              className="rounded-none border-foreground/30 bg-transparent"
            >
              {t('clientRoom.submit.pickFiles')}
            </Button>
            <input
              ref={inputRef}
              type="file"
              multiple
              className="hidden"
              data-testid="client-submit-input"
              onChange={(e) => {
                const list = e.target.files ? Array.from(e.target.files) : null;
                e.target.value = '';
                void addFiles(list);
              }}
            />
          </div>

          {files.length > 0 ? (
            <ul className="mt-5 divide-y divide-foreground/10 border-y border-foreground/10">
              {files.map((f) => (
                <li key={f.uid} className="flex items-center gap-4 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-body text-foreground" title={f.file.name}>
                      {f.file.name}
                    </p>
                    <p className="mt-0.5 font-mono text-micro tabular-nums">
                      <span className="text-muted-foreground">{formatBytes(f.file.size)}</span>
                      {' · '}
                      {f.uploading ? (
                        <span className="text-muted-foreground">{t('clientRoom.submit.uploading')}</span>
                      ) : f.error ? (
                        <span className="text-danger">{f.error}</span>
                      ) : (
                        <span className="text-success">{t('clientRoom.submit.uploaded')}</span>
                      )}
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className="shrink-0 rounded-none"
                    disabled={f.uploading}
                    onClick={() => removeFile(f.uid)}
                    aria-label={`${t('clientRoom.submit.removeFile')} — ${f.file.name}`}
                  >
                    {f.uploading ? (
                      <Loader2 className="h-3.5 w-3.5 motion-safe:animate-spin" />
                    ) : (
                      <X className="h-3.5 w-3.5" />
                    )}
                  </Button>
                </li>
              ))}
            </ul>
          ) : null}
        </Step>

        <div className="flex flex-col gap-4 border-t border-foreground pt-6 sm:flex-row sm:items-center sm:justify-between">
          <p className="font-mono text-micro tabular-nums text-muted-foreground">
            {files.length > 0
              ? t('clientRoom.submit.readyCount', { done: uploadedCount, total: files.length })
              : requiredMissing
                ? t('clientRoom.submit.missingRequired')
                : ' '}
          </p>
          <Button
            type="submit"
            size="lg"
            disabled={!ready || sending}
            className="rounded-none bg-foreground px-8 text-background hover:bg-foreground/85"
            data-testid="client-submit-send"
          >
            {sending ? <Loader2 className="h-4 w-4 motion-safe:animate-spin" /> : null}
            {sending ? t('clientRoom.submit.sending') : t('clientRoom.submit.send')}
            {sending ? null : <ArrowRight className="h-4 w-4" strokeWidth={1.5} />}
          </Button>
        </div>
      </form>

      <aside className="lg:col-span-5">
        <div className="border border-foreground/15 bg-card p-6 md:p-8 lg:sticky lg:top-36">
          <Eyebrow>{t('clientRoom.submit.namingTitle')}</Eyebrow>
          <p className="mt-4 text-body leading-relaxed text-muted-foreground">{t('clientRoom.submit.namingBody')}</p>
          {files.length === 0 ? (
            <p className="mt-8 border-t border-foreground/10 pt-6 font-display text-lg font-light text-muted-foreground">
              {t('clientRoom.submit.namingEmpty')}
            </p>
          ) : (
            <ol className="mt-8 flex flex-col divide-y divide-foreground/10 border-t border-foreground/10" data-testid="client-naming-preview">
              {files.map((f, i) => (
                <li key={f.uid} className="py-4">
                  <p className="truncate text-micro text-muted-foreground" title={f.file.name}>
                    {f.file.name}
                  </p>
                  <p className="mt-1.5 break-all font-mono text-micro text-foreground">
                    <span className="text-brand-copper">→ </span>
                    {names[i] ?? '…'}
                  </p>
                </li>
              ))}
            </ol>
          )}
        </div>
      </aside>
    </div>
  );
}

function Step({ index, title, children }: { index: string; title: string; children: ReactNode }) {
  const id = `client-step-${index}`;
  return (
    <section
      aria-labelledby={id}
      className="grid gap-5 border-t border-foreground/15 pt-5 md:grid-cols-[4.5rem_minmax(0,1fr)] md:gap-6"
    >
      <span className="font-mono text-label tabular-nums text-brand-copper">{index}</span>
      <div className="min-w-0">
        <h3 id={id} className="font-display text-xl font-light tracking-[-0.015em] text-foreground md:text-2xl">
          {title}
        </h3>
        <div className="mt-5">{children}</div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/*  Илгээсэн түүх                                                      */
/* ------------------------------------------------------------------ */

const STATUS_TONE: Record<ClientSubmission['status'], string> = {
  submitted: 'bg-warning/10 text-warning',
  accepted: 'bg-success/10 text-success',
  rejected: 'bg-danger/10 text-danger',
};

function History({ submissions, loading }: { submissions: ClientSubmission[]; loading: boolean }) {
  const { t } = useLanguage();
  return (
    <section aria-labelledby="client-history-title">
      <SubHeader
        title={<span id="client-history-title">{t('clientRoom.submit.historyTitle')}</span>}
        meta={submissions.length > 0 ? String(submissions.length).padStart(2, '0') : undefined}
      />
      {loading ? (
        <div className="flex flex-col gap-3 py-6">
          <SkeletonBar className="h-12" />
          <SkeletonBar className="h-12" />
        </div>
      ) : submissions.length === 0 ? (
        <p className="py-10 text-sm text-muted-foreground">{t('clientRoom.submit.historyEmpty')}</p>
      ) : (
        <>
          <div
            aria-hidden
            className="hidden grid-cols-12 gap-6 border-b border-foreground/10 py-2.5 font-mono text-label uppercase tracking-[0.12em] text-muted-foreground md:grid"
          >
            <span className="col-span-2">{t('clientRoom.submit.colRef')}</span>
            <span className="col-span-5">{t('clientRoom.submit.colTitle')}</span>
            <span className="col-span-2">{t('clientRoom.submit.colDate')}</span>
            <span className="col-span-2">{t('clientRoom.submit.colStatus')}</span>
            <span className="col-span-1" />
          </div>
          <ul className="divide-y divide-foreground/10 border-b border-foreground/10">
            {submissions.map((s) => (
              <SubmissionRow key={s.id} submission={s} />
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

function SubmissionRow({ submission: s }: { submission: ClientSubmission }) {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const filesQuery = useApiQuery<{ files: { id: number; canonical_name: string; url: string }[] }>(
    `/client/submissions/${s.id}/files`,
    { enabled: open },
  );
  const { busyKey, download } = useDownloader();
  const panelId = `submission-${s.id}-files`;

  return (
    <li className="grid gap-3 py-5 md:grid-cols-12 md:items-center md:gap-6">
      <span className="font-mono text-micro text-foreground md:col-span-2">{s.ref_no}</span>
      <div className="min-w-0 md:col-span-5">
        <p className="text-sm leading-snug text-foreground">{s.title}</p>
        <p className="mt-0.5 text-micro text-muted-foreground">{s.template_name}</p>
        {s.review_note ? (
          <p className="mt-2 border-l-2 border-foreground/20 pl-3 text-micro leading-relaxed text-muted-foreground">
            {s.review_note}
          </p>
        ) : null}
      </div>
      <span className="font-mono text-micro tabular-nums text-muted-foreground md:col-span-2">
        {formatDate(s.submitted_at)}
        {s.file_count > 0 ? ` · ${countLabel(t, 'clientRoom.files', s.file_count)}` : ''}
      </span>
      <span className="md:col-span-2">
        <span
          className={cn(
            'inline-flex items-center gap-1.5 px-2 py-1 font-mono text-label uppercase tracking-[0.1em]',
            STATUS_TONE[s.status] ?? 'bg-muted text-muted-foreground',
          )}
        >
          {s.status === 'accepted' ? <Check className="h-3 w-3" strokeWidth={2} /> : null}
          {t(`clientRoom.submit.status_${s.status}`)}
        </span>
      </span>
      <span className="md:col-span-1 md:text-right">
        {s.file_count > 0 ? (
          <Button
            variant="ghost"
            size="icon-sm"
            className="rounded-none"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-controls={panelId}
            aria-label={t('clientRoom.submit.showFiles')}
          >
            <ChevronDown className={cn('h-4 w-4 transition-transform', open && 'rotate-180')} strokeWidth={1.5} />
          </Button>
        ) : null}
      </span>
      {open ? (
        <div id={panelId} className="md:col-span-10 md:col-start-3">
          {filesQuery.isLoading ? (
            <SkeletonBar className="h-8" />
          ) : (
            <ul className="divide-y divide-foreground/10 border-y border-foreground/10">
              {(filesQuery.data?.files ?? []).map((f) => (
                <li key={f.id} className="flex items-center gap-3 py-2">
                  <span className="min-w-0 flex-1 truncate font-mono text-micro text-foreground" title={f.canonical_name}>
                    {f.canonical_name}
                  </span>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="shrink-0 rounded-none"
                    disabled={busyKey === f.url}
                    onClick={() => void download(f.url, f.canonical_name)}
                    aria-label={`${t('clientRoom.materials.download')} — ${f.canonical_name}`}
                  >
                    {busyKey === f.url ? (
                      <Loader2 className="h-3.5 w-3.5 motion-safe:animate-spin" />
                    ) : (
                      <Download className="h-3.5 w-3.5" strokeWidth={1.75} />
                    )}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </li>
  );
}

export default SubmitTab;
