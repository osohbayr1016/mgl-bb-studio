/**
 * ComposeWindow — a Gmail-style docked compose window (NOT a centered modal).
 * Non-modal: sits at the bottom-right on desktop (full-screen on mobile), can
 * minimize to a title bar and close.  Sends through Gmail with a rich-text
 * (HTML) body + To/Cc/Bcc, and optionally logs to a project's ledger.
 */
import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Loader2, Send, Paperclip, X, Minus } from 'lucide-react';
import { useApiQuery } from '@/shared/api/useApi';
import { sendEmail } from '@/features/email/api/email';
import {
  DOC_TYPES,
  DOC_TYPE_LABELS,
  type ComposeDraft,
  type DocType,
  type AliasListResponse,
  type EmailAccount,
} from '@/features/email/types/email';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import { Label } from '@/ui/label';
import { Checkbox } from '@/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/ui/select';
import { uploadFile } from '@/shared/api/client';
import { toast } from '@/shared/components/Toast';
import { useMediaQuery } from '@/shared/hooks/useMediaQuery';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/i18n';
import { RichTextEditor } from './RichTextEditor';
import { sanitizeHtml, htmlToText } from '../lib/htmlToText';
import { wrapMailBody } from '../lib/mailTypography';

export function ComposeWindow({
  open,
  minimized,
  accounts,
  projects,
  draft,
  onClose,
  onMinimize,
  onSent,
}: {
  open: boolean;
  minimized: boolean;
  accounts: EmailAccount[];
  projects: { id: number; name: string }[];
  /** Prefill for reply / reply-all / forward.  The parent remounts this
   *  component (via `key`) whenever a new draft is started, so these are
   *  read once as the initial state. */
  draft?: ComposeDraft | null;
  onClose: () => void;
  onMinimize: () => void;
  onSent: () => void;
}) {
  const { t } = useLanguage();
  const isDesktop = useMediaQuery('(min-width: 1024px)');

  const [accountId, setAccountId] = useState(draft?.account_id ? String(draft.account_id) : '');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState(draft?.to ?? '');
  const [cc, setCc] = useState(draft?.cc ?? '');
  const [bcc, setBcc] = useState('');
  const [showCc, setShowCc] = useState(!!draft?.cc);
  const [showBcc, setShowBcc] = useState(false);
  const [subject, setSubject] = useState(draft?.subject ?? '');
  const [bodyHtml, setBodyHtml] = useState(draft?.bodyHtml ?? '');
  const [editorKey, setEditorKey] = useState(0);
  const [files, setFiles] = useState<File[]>([]);
  const [logToLedger, setLogToLedger] = useState(false);
  const [projectId, setProjectId] = useState('');
  const [docType, setDocType] = useState<DocType | ''>('');

  const selectedAddr = accounts.find((a) => String(a.id) === accountId)?.address ?? '';
  const { data: fromAliasData } = useApiQuery<AliasListResponse>(
    ['/email/aliases', 'compose', accountId],
    `/email/aliases?account_id=${accountId}`,
    { enabled: !!accountId },
  );
  const fromAliases = (fromAliasData?.aliases ?? []).filter((a) => a !== selectedAddr.toLowerCase());

  const reset = () => {
    setAccountId('');
    setFrom('');
    setTo('');
    setCc('');
    setBcc('');
    setShowCc(false);
    setShowBcc(false);
    setSubject('');
    setBodyHtml('');
    setEditorKey((k) => k + 1);
    setFiles([]);
    setLogToLedger(false);
    setProjectId('');
    setDocType('');
  };

  const send = useMutation({
    mutationFn: async () => {
      let attachments: { r2_key: string; filename: string; mime_type: string }[] | undefined;
      if (files.length) {
        attachments = [];
        for (const f of files) {
          const url = await uploadFile(f); // returns '/media/<key>'
          attachments.push({
            r2_key: url.replace(/^\/media\//, ''),
            filename: f.name,
            mime_type: f.type || 'application/octet-stream',
          });
        }
      }
      return sendEmail({
        account_id: Number(accountId),
        from: from || undefined,
        to: to.trim(),
        cc: cc.trim() || undefined,
        bcc: bcc.trim() || undefined,
        subject: subject.trim(),
        // Хүлээн авагчийн клиент бидний CSS-ийг мэдэхгүй тул үндсэн хэлбэрийг
        // (Arial 11 налуу) inline style болгож ороож илгээнэ.
        body_html: wrapMailBody(sanitizeHtml(bodyHtml)),
        body_text: htmlToText(bodyHtml),
        // Threading refs from a reply draft keep the mail in its conversation.
        ...(draft?.thread_id ? { thread_id: draft.thread_id } : {}),
        ...(draft?.in_reply_to ? { in_reply_to: draft.in_reply_to } : {}),
        ...(draft?.references ? { references: draft.references } : {}),
        ...(attachments ? { attachments } : {}),
        ...(logToLedger && projectId && docType
          ? { project_id: Number(projectId), doc_type: docType }
          : {}),
      });
    },
    onSuccess: () => {
      toast.success(t('mailTriagePage.mailSent'));
      reset();
      onSent();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const bodyHasText = htmlToText(bodyHtml).trim().length > 0;
  const canSend =
    !!accountId &&
    !!to.trim() &&
    !!subject.trim() &&
    bodyHasText &&
    (!logToLedger || (!!projectId && !!docType));

  const handleClose = () => {
    reset();
    onClose();
  };

  if (!open) return null;

  const shellBase = 'fixed z-50 flex flex-col border border-border bg-card shadow-2xl';
  const shell = isDesktop
    ? cn(shellBase, 'bottom-0 right-4 w-[min(32rem,calc(100vw-2rem))] rounded-t-lg')
    : cn(shellBase, 'inset-0 rounded-none');

  // Minimized → just the header strip.
  if (minimized) {
    return (
      <div
        className={cn(
          'fixed z-50 border border-border bg-card shadow-lg',
          // Утсан дээр z-50 нь доод navbar (z-40)-ыг халхалдаг тул түүнээс
          // дээгүүр, safe-area-г тооцож байрлана (StickySaveBar-тай ижил хэв).
          isDesktop
            ? 'bottom-0 right-4 w-72 rounded-t-lg'
            : 'bottom-[calc(var(--app-bottom-nav-h)+env(safe-area-inset-bottom))] inset-x-0 rounded-none',
        )}
      >
        <Header
          title={subject.trim() || t('mailInbox.compose')}
          minimized
          onMinimize={onMinimize}
          onClose={handleClose}
          minimizeLabel={t('mailInbox.restore')}
          closeLabel={t('common.close')}
        />
      </div>
    );
  }

  return (
    <div className={shell} role="dialog" aria-label={t('mailInbox.compose')}>
      <Header
        title={subject.trim() || t('mailInbox.compose')}
        onMinimize={onMinimize}
        onClose={handleClose}
        minimizeLabel={t('mailInbox.minimize')}
        closeLabel={t('common.close')}
      />

      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto overflow-x-hidden p-3">
        {/* Mailbox — which connected Gmail account actually sends. */}
        <div className="flex items-center gap-2 border-b border-border/60 pb-1.5">
          <span className="w-14 shrink-0 text-xs text-muted-foreground">
            {t('mailInbox.mailbox')}
          </span>
          <Select
            value={accountId}
            onValueChange={(v) => {
              setAccountId(v);
              setFrom('');
            }}
          >
            <SelectTrigger className="h-7 flex-1 border-0 bg-transparent px-0 text-sm shadow-none focus:ring-0">
              <SelectValue placeholder={t('mailTriagePage.selectMailbox')} />
            </SelectTrigger>
            <SelectContent position="popper">
              {accounts
                .filter((a) => a.is_active === 1)
                .map((a) => (
                  <SelectItem key={a.id} value={String(a.id)}>
                    {a.address}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
        </div>

        {/* From — the address recipients see; pick an in-domain alias here. */}
        {accountId && (
          <div className="flex items-center gap-2 border-b border-border/60 pb-1.5">
            <span className="w-14 shrink-0 text-xs text-muted-foreground">
              {t('mailInbox.from')}
            </span>
            {fromAliases.length > 0 ? (
              <Select
                value={from || '__default'}
                onValueChange={(v) => setFrom(v === '__default' ? '' : v)}
              >
                <SelectTrigger className="h-7 flex-1 border-0 bg-transparent px-0 font-mono text-sm shadow-none focus:ring-0">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent position="popper">
                  <SelectItem value="__default">
                    {t('mailTriagePage.defaultFrom', { address: selectedAddr })}
                  </SelectItem>
                  {fromAliases.map((a) => (
                    <SelectItem key={a} value={a}>
                      {a}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <span className="flex-1 truncate font-mono text-sm text-muted-foreground">
                {selectedAddr}
              </span>
            )}
          </div>
        )}

        {/* To + Cc/Bcc toggles */}
        <div className="flex items-center gap-2 border-b border-border/60 pb-1.5">
          <span className="w-14 shrink-0 text-xs text-muted-foreground">
            {t('mailTriagePage.toLabel')}
          </span>
          <Input
            value={to}
            onChange={(e) => setTo(e.target.value)}
            placeholder="name@example.com"
            className="h-7 flex-1 border-0 bg-transparent px-0 font-mono text-sm shadow-none focus-visible:ring-0"
          />
          {!showCc && (
            <button
              type="button"
              onClick={() => setShowCc(true)}
              className="shrink-0 text-xs text-muted-foreground hover:text-foreground"
            >
              {t('mailInbox.cc')}
            </button>
          )}
          {!showBcc && (
            <button
              type="button"
              onClick={() => setShowBcc(true)}
              className="shrink-0 text-xs text-muted-foreground hover:text-foreground"
            >
              {t('mailInbox.bcc')}
            </button>
          )}
        </div>
        {showCc && (
          <div className="flex items-center gap-2 border-b border-border/60 pb-1.5">
            <span className="w-14 shrink-0 text-xs text-muted-foreground">{t('mailInbox.cc')}</span>
            <Input
              value={cc}
              onChange={(e) => setCc(e.target.value)}
              placeholder="cc@example.com"
              className="h-7 flex-1 border-0 bg-transparent px-0 font-mono text-sm shadow-none focus-visible:ring-0"
            />
          </div>
        )}
        {showBcc && (
          <div className="flex items-center gap-2 border-b border-border/60 pb-1.5">
            <span className="w-14 shrink-0 text-xs text-muted-foreground">{t('mailInbox.bcc')}</span>
            <Input
              value={bcc}
              onChange={(e) => setBcc(e.target.value)}
              placeholder="bcc@example.com"
              className="h-7 flex-1 border-0 bg-transparent px-0 font-mono text-sm shadow-none focus-visible:ring-0"
            />
          </div>
        )}

        {/* Subject */}
        <div className="flex items-center gap-2 border-b border-border/60 pb-1.5">
          <span className="w-14 shrink-0 text-xs text-muted-foreground">
            {t('mailTriagePage.subject')}
          </span>
          <Input
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            className="h-7 flex-1 border-0 bg-transparent px-0 text-sm shadow-none focus-visible:ring-0"
          />
        </div>

        {/* Rich-text body */}
        <RichTextEditor
          key={editorKey}
          defaultHtml={bodyHtml}
          onChange={setBodyHtml}
          placeholder={t('mailTriagePage.bodyContent')}
        />

        {/* Attachments */}
        <div className="space-y-1.5">
          <Input
            type="file"
            multiple
            onChange={(e) => {
              const picked = Array.from(e.target.files ?? []);
              if (picked.length) setFiles((prev) => [...prev, ...picked]);
              e.currentTarget.value = '';
            }}
            className="h-8 text-xs"
          />
          {files.length > 0 && (
            <div className="space-y-1">
              {files.map((f, i) => (
                <div
                  key={`${f.name}-${i}`}
                  className="flex items-center gap-2 rounded-md border border-border/60 bg-muted/30 px-2 py-1 text-xs"
                >
                  <Paperclip className="h-3 w-3 shrink-0 text-muted-foreground" />
                  <span className="flex-1 truncate">{f.name}</span>
                  <span className="shrink-0 tabular-nums text-muted-foreground">
                    {(f.size / 1024).toFixed(0)}KB
                  </span>
                  <button
                    type="button"
                    onClick={() => setFiles(files.filter((_, j) => j !== i))}
                    className="shrink-0 text-muted-foreground hover:text-destructive"
                    aria-label={t('mailTriagePage.removeAttachment')}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Log to ledger */}
        <label className="flex items-center gap-2 text-xs cursor-pointer">
          <Checkbox checked={logToLedger} onCheckedChange={(v) => setLogToLedger(!!v)} />
          {t('mailTriagePage.saveToProjectLedger')}
        </label>
        {logToLedger && (
          <div className="grid gap-2 rounded-lg border border-border/60 p-2 sm:grid-cols-2 [&>*]:min-w-0">
            <div className="space-y-1">
              <Label className="text-xs">{t('mailTriagePage.project')}</Label>
              <Select value={projectId} onValueChange={setProjectId}>
                <SelectTrigger className="h-8 w-full text-xs">
                  <SelectValue placeholder={t('mailTriagePage.projectPlaceholder')} />
                </SelectTrigger>
                <SelectContent position="popper">
                  {projects.map((p) => (
                    <SelectItem key={p.id} value={String(p.id)}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">{t('mailTriagePage.type')}</Label>
              <Select value={docType} onValueChange={(v) => setDocType(v as DocType)}>
                <SelectTrigger className="h-8 w-full text-xs">
                  <SelectValue placeholder={t('mailTriagePage.typePlaceholder')} />
                </SelectTrigger>
                <SelectContent position="popper">
                  {DOC_TYPES.map((dt) => (
                    <SelectItem key={dt} value={dt}>
                      {DOC_TYPE_LABELS[dt]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="flex shrink-0 items-center gap-2 border-t border-border/60 p-2.5">
        <Button onClick={() => send.mutate()} disabled={!canSend || send.isPending}>
          {send.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          {t('mailTriagePage.send')}
        </Button>
      </div>
    </div>
  );
}

function Header({
  title,
  minimized,
  onMinimize,
  onClose,
  minimizeLabel,
  closeLabel,
}: {
  title: string;
  minimized?: boolean;
  onMinimize: () => void;
  onClose: () => void;
  minimizeLabel: string;
  closeLabel: string;
}) {
  return (
    <div className="flex h-10 shrink-0 items-center gap-2 rounded-t-lg bg-foreground px-3 text-background">
      <button
        type="button"
        onClick={onMinimize}
        className="min-w-0 flex-1 truncate text-left text-sm font-medium"
        title={minimized ? minimizeLabel : undefined}
      >
        {title}
      </button>
      <button
        type="button"
        onClick={onMinimize}
        aria-label={minimizeLabel}
        title={minimizeLabel}
        className="shrink-0 rounded p-1 hover:bg-background/20"
      >
        <Minus className="h-4 w-4" />
      </button>
      <button
        type="button"
        onClick={onClose}
        aria-label={closeLabel}
        title={closeLabel}
        className="shrink-0 rounded p-1 hover:bg-background/20"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
