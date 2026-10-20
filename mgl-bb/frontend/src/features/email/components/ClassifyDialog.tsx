/**
 * ClassifyDialog — read a message + classify it into a project + doc_type,
 * writing a correspondence_log row.  Moved verbatim out of the old
 * MailTriagePage so the Gmail-style inbox can reuse it unchanged (launched
 * from the reading pane's «Ангилах» button).
 */
import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import {
  Loader2,
  Tag,
  Paperclip,
  FileText,
  CheckCircle2,
  ArrowDownLeft,
  ArrowUpRight,
} from 'lucide-react';
import { useApiQuery } from '@/shared/api/useApi';
import { classifyMessage, openAttachment, getBodyHtml } from '@/features/email/api/email';
import {
  DOC_TYPES,
  DOC_TYPE_SHORT,
  type DocType,
  type EmailAttachment,
  type EmailMessageDetail,
} from '@/features/email/types/email';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import { Label } from '@/ui/label';
import { Checkbox } from '@/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/ui/dialog';
import { toast } from '@/shared/components/Toast';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/i18n';

const DOC_TYPE_HELP: Record<DocType, string> = {
  rfi: 'Request for Information',
  cr: 'Change Request',
  official: 'Official Letter',
  mr: 'Meeting Report',
};

export function ClassifyDialog({
  messageId,
  projects,
  onClose,
  onDone,
}: {
  messageId: number;
  projects: { id: number; name: string }[];
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useLanguage();
  const { data, isLoading } = useApiQuery<{
    message: EmailMessageDetail;
    attachments: EmailAttachment[];
  }>(['/email/messages', messageId], `/email/messages/${messageId}`);
  const message = data?.message;
  const attachments = data?.attachments ?? [];

  const [projectId, setProjectId] = useState('');
  const [docType, setDocType] = useState<DocType | ''>('');
  const [direction, setDirection] = useState<'sent' | 'received'>('received');
  const [logDate, setLogDate] = useState('');
  const [refNo, setRefNo] = useState('');
  const [markRead, setMarkRead] = useState(true);
  const [primed, setPrimed] = useState(false);
  // Email HTML body — rendered inline in a sandboxed iframe (a blob: in a new
  // tab is blocked/blank under the Pages COOP/COEP headers).
  const [htmlBody, setHtmlBody] = useState<string | null>(null);
  const [htmlOpen, setHtmlOpen] = useState(false);
  const [htmlLoading, setHtmlLoading] = useState(false);

  const toggleHtml = async () => {
    if (htmlOpen) {
      setHtmlOpen(false);
      return;
    }
    setHtmlOpen(true);
    if (htmlBody === null) {
      setHtmlLoading(true);
      try {
        setHtmlBody(await getBodyHtml(messageId));
      } catch (e) {
        toast.error(e instanceof Error ? e.message : t('mailTriagePage.htmlLoadFailed'));
        setHtmlOpen(false);
      } finally {
        setHtmlLoading(false);
      }
    }
  };

  // Prime direction + date from the message once it loads.
  if (message && !primed) {
    setDirection(message.direction === 'out' ? 'sent' : 'received');
    setLogDate((message.internal_date ?? '').slice(0, 10) || new Date().toISOString().slice(0, 10));
    setPrimed(true);
  }

  const classify = useMutation({
    mutationFn: () =>
      classifyMessage(messageId, {
        project_id: Number(projectId),
        doc_type: docType as DocType,
        direction,
        log_date: logDate,
        ref_no: refNo.trim() || undefined,
        mark_read: markRead,
      }),
    onSuccess: () => {
      toast.success(t('mailTriagePage.savedToLedger'));
      onDone();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const canSubmit = !!projectId && !!docType && /^\d{4}-\d{2}-\d{2}$/.test(logDate);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Tag className="h-5 w-5 text-primary" /> {t('mailTriagePage.classifyMail')}
          </DialogTitle>
        </DialogHeader>

        {isLoading || !message ? (
          <div className="py-10 text-center">
            <Loader2 className="h-5 w-5 animate-spin mx-auto" />
          </div>
        ) : (
          <div className="space-y-4 py-1">
            {/* Message preview */}
            <div className="rounded-lg border border-border/60 bg-muted/20 p-3 space-y-1.5 text-sm">
              <div className="font-medium">{message.subject || t('mailTriagePage.noSubject')}</div>
              <div className="grid grid-cols-[64px_1fr] gap-x-2 gap-y-0.5 text-xs font-mono text-foreground/80">
                <span className="text-muted-foreground">{t('mailTriagePage.sender')}</span>
                <span className="break-all">{message.from_addr || '—'}</span>
                <span className="text-muted-foreground">{t('mailTriagePage.recipient')}</span>
                <span className="break-all">{message.to_addrs || '—'}</span>
                {message.cc_addrs && (
                  <>
                    <span className="text-muted-foreground">CC</span>
                    <span className="break-all">{message.cc_addrs}</span>
                  </>
                )}
              </div>
              {message.body_text && (
                <p className="text-xs text-muted-foreground whitespace-pre-wrap line-clamp-6 pt-1">
                  {message.body_text}
                </p>
              )}
              <div className="flex flex-wrap items-center gap-2 pt-1">
                {message.body_html_r2_key && (
                  <Button size="sm" variant="outline" className="h-7 text-xs" onClick={toggleHtml}>
                    <FileText className="h-3 w-3" />{' '}
                    {htmlOpen ? t('mailTriagePage.hideHtml') : t('mailTriagePage.viewHtml')}
                  </Button>
                )}
                {attachments.map((att) => (
                  <Button
                    key={att.id}
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs"
                    onClick={() =>
                      openAttachment(att.id, att.filename ?? undefined).catch((e) =>
                        toast.error(String(e)),
                      )
                    }
                  >
                    <Paperclip className="h-3 w-3" /> {att.filename || t('mailTriagePage.attachment')}
                  </Button>
                ))}
              </div>
              {htmlOpen && (
                <div className="pt-1">
                  {htmlLoading ? (
                    <div className="py-6 text-center text-muted-foreground">
                      <Loader2 className="mx-auto h-4 w-4 animate-spin" />
                    </div>
                  ) : (
                    <iframe
                      title="email-html"
                      sandbox=""
                      srcDoc={htmlBody ?? ''}
                      className="h-72 w-full rounded-md border border-border/60 bg-white"
                    />
                  )}
                </div>
              )}
            </div>

            {/* Classification form */}
            <div className="grid gap-3 sm:grid-cols-2 [&>*]:min-w-0">
              <div className="space-y-1.5">
                <Label className="text-xs">
                  {t('mailTriagePage.project')} <span className="text-destructive">*</span>
                </Label>
                <Select value={projectId} onValueChange={setProjectId}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder={t('mailTriagePage.selectProject')} />
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
              <div className="space-y-1.5">
                <Label className="text-xs">{t('mailTriagePage.date')}</Label>
                <Input type="date" value={logDate} onChange={(e) => setLogDate(e.target.value)} />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">
                {t('mailTriagePage.docType')} <span className="text-destructive">*</span>
              </Label>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {DOC_TYPES.map((dt) => (
                  <button
                    key={dt}
                    type="button"
                    onClick={() => setDocType(dt)}
                    className={cn(
                      'rounded-lg border p-2 text-center transition-colors',
                      docType === dt
                        ? 'bg-primary text-primary-foreground border-primary'
                        : 'border-border bg-muted/30 hover:bg-muted text-foreground',
                    )}
                  >
                    <div className="text-sm font-bold">{DOC_TYPE_SHORT[dt]}</div>
                    <div
                      className={cn(
                        'text-micro mt-0.5',
                        docType === dt ? 'text-primary-foreground/80' : 'text-muted-foreground',
                      )}
                    >
                      {DOC_TYPE_HELP[dt]}
                    </div>
                  </button>
                ))}
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 [&>*]:min-w-0">
              <div className="space-y-1.5">
                <Label className="text-xs">{t('mailTriagePage.direction')}</Label>
                <div className="grid grid-cols-2 gap-1">
                  {(['received', 'sent'] as const).map((d) => (
                    <button
                      key={d}
                      type="button"
                      onClick={() => setDirection(d)}
                      className={cn(
                        'text-micro py-2 rounded-md border font-medium inline-flex items-center justify-center gap-1',
                        direction === d
                          ? d === 'sent'
                            ? 'bg-primary text-primary-foreground border-primary'
                            : 'bg-success text-white border-success'
                          : 'border-border bg-muted/30 hover:bg-muted',
                      )}
                    >
                      {d === 'sent' ? (
                        <ArrowUpRight className="h-3 w-3" />
                      ) : (
                        <ArrowDownLeft className="h-3 w-3" />
                      )}
                      {d === 'sent' ? t('mailTriagePage.outgoing') : t('mailTriagePage.incoming')}
                    </button>
                  ))}
                </div>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">{t('mailTriagePage.refNo')}</Label>
                <Input
                  value={refNo}
                  onChange={(e) => setRefNo(e.target.value)}
                  placeholder={t('mailTriagePage.refNoPlaceholder')}
                />
              </div>
            </div>

            <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
              <Checkbox checked={markRead} onCheckedChange={(v) => setMarkRead(!!v)} />
              {t('mailTriagePage.markReadOnGmail')}
            </label>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={classify.isPending}>
            {t('common.cancel')}
          </Button>
          <Button onClick={() => classify.mutate()} disabled={!canSubmit || classify.isPending}>
            {classify.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <CheckCircle2 className="h-4 w-4" />
            )}
            {t('mailTriagePage.saveToLedger')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
