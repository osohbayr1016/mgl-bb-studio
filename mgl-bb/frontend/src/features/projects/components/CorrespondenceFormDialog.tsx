import { useEffect, useState } from 'react';
import { apiFetch, uploadFile } from '@/shared/api/client';
import type { CorrespondenceEntry } from '@/shared/types';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import { Label } from '@/ui/label';
import { Textarea } from '@/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/ui/dialog';
import {
  Mail,
  ArrowUpRight,
  ArrowDownLeft,
  Loader2,
  Paperclip,
  CheckCircle2,
  AlertCircle,
} from 'lucide-react';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/i18n';
import { DocumentSignatureField } from '@/features/projects/components/DocumentSignatureField';
import {
  CORRESPONDENCE_DOC_TYPES,
  DOC_TYPE_LABEL_KEYS,
  DOC_TYPE_SHORT,
  DOC_TYPE_TONE,
  todayIso,
  type CorrespondenceDocType,
} from '@/features/projects/components/correspondenceConstants';

export function CorrespondenceFormDialog({
  open,
  projectId,
  editing,
  onClose,
  onSaved,
}: {
  open: boolean;
  projectId: number;
  editing: CorrespondenceEntry | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useLanguage();
  const [logDate, setLogDate] = useState(todayIso());
  const [direction, setDirection] = useState<'sent' | 'received'>('received');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [fromEmail, setFromEmail] = useState('');
  const [toEmail, setToEmail] = useState('');
  const [ccEmails, setCcEmails] = useState('');
  const [docType, setDocType] = useState<CorrespondenceDocType | ''>('');
  const [refNo, setRefNo] = useState('');
  const [attachment, setAttachment] = useState('');
  const [attachName, setAttachName] = useState('');
  const [signatureUrl, setSignatureUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    if (editing) {
      setLogDate(editing.log_date);
      setDirection(editing.direction);
      setSubject(editing.subject);
      setBody(editing.body ?? '');
      setFromEmail(editing.from_email ?? '');
      setToEmail(editing.to_email ?? '');
      setCcEmails(editing.cc_emails ?? '');
      setDocType(editing.doc_type ?? '');
      setRefNo(editing.ref_no ?? '');
      setAttachment(editing.attachment_url ?? '');
      setAttachName(editing.attachment_url ? t('correspondenceLogTab.savedFile') : '');
      setSignatureUrl(editing.signature_url ?? null);
    } else {
      setLogDate(todayIso());
      setDirection('received');
      setSubject('');
      setBody('');
      setFromEmail('');
      setToEmail('');
      setCcEmails('');
      setDocType('');
      setRefNo('');
      setAttachment('');
      setAttachName('');
      setSignatureUrl(null);
    }
    setError(null);
  }, [open, editing, t]);

  const handleAttachment = async (file: File | null) => {
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const url = await uploadFile(file);
      setAttachment(url);
      setAttachName(file.name);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('correspondenceLogTab.uploadFailed'));
    } finally {
      setUploading(false);
    }
  };

  const submit = async () => {
    if (!subject.trim()) {
      setError(t('correspondenceLogTab.subjectRequired'));
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(logDate)) {
      setError(t('correspondenceLogTab.invalidDate'));
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const payload = {
        log_date: logDate,
        direction,
        subject: subject.trim(),
        body: body.trim() || null,
        from_email: fromEmail.trim() || null,
        to_email: toEmail.trim() || null,
        cc_emails: ccEmails.trim() || null,
        doc_type: docType || null,
        ref_no: refNo.trim() || null,
        attachment_url: attachment || null,
        signature_url: signatureUrl,
      };
      if (editing) {
        await apiFetch(`/correspondence/${editing.id}`, { method: 'PATCH', data: payload });
      } else {
        await apiFetch(`/correspondence/projects/${projectId}`, { method: 'POST', data: payload });
      }
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('correspondenceLogTab.saveFailed'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Mail className="h-5 w-5 text-primary" />
            {editing
              ? t('correspondenceLogTab.editDialogTitle')
              : t('correspondenceLogTab.newDialogTitle')}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {error && (
            <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-destructive/10 border border-destructive/30 text-destructive text-sm">
              <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" /> {error}
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">{t('correspondenceLogTab.colDate')}</Label>
              <Input type="date" value={logDate} onChange={(e) => setLogDate(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">{t('correspondenceLogTab.direction')}</Label>
              <div className="grid grid-cols-2 gap-1">
                {(['received', 'sent'] as const).map((d) => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => setDirection(d)}
                    className={cn(
                      'text-[11px] py-2 px-1 rounded-md border font-medium transition-colors text-center inline-flex items-center justify-center gap-1',
                      direction === d
                        ? d === 'sent'
                          ? 'bg-primary text-primary-foreground border-primary'
                          : 'bg-emerald-600 text-white border-emerald-600'
                        : 'border-border bg-muted/30 hover:bg-muted text-foreground',
                    )}
                  >
                    {d === 'sent' ? (
                      <ArrowUpRight className="h-3 w-3" />
                    ) : (
                      <ArrowDownLeft className="h-3 w-3" />
                    )}
                    {d === 'sent' ? t('correspondenceLogTab.sent') : t('correspondenceLogTab.received')}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">{t('correspondenceLogTab.docType')}</Label>
              <div className="grid grid-cols-2 gap-1 sm:grid-cols-4">
                {CORRESPONDENCE_DOC_TYPES.map((dt) => (
                  <button
                    key={dt}
                    type="button"
                    onClick={() => setDocType((cur) => (cur === dt ? '' : dt))}
                    title={t(DOC_TYPE_LABEL_KEYS[dt])}
                    className={cn(
                      'text-[11px] py-2 rounded-md border font-semibold transition-colors',
                      docType === dt
                        ? DOC_TYPE_TONE[dt]
                        : 'border-border bg-muted/30 hover:bg-muted text-muted-foreground',
                    )}
                  >
                    {DOC_TYPE_SHORT[dt]}
                  </button>
                ))}
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">{t('correspondenceLogTab.refNo')}</Label>
              <Input
                value={refNo}
                onChange={(e) => setRefNo(e.target.value)}
                placeholder={t('correspondenceLogTab.refNoPlaceholder')}
                className="w-[120px]"
                title={t('correspondenceLogTab.refNoHint')}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">
              {t('correspondenceLogTab.colSubject')} <span className="text-destructive">*</span>
            </Label>
            <Input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder={t('correspondenceLogTab.subjectPlaceholder')}
              autoFocus={!editing}
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs inline-flex items-center gap-1">
                <ArrowUpRight className="h-3 w-3 text-primary" />
                {t('correspondenceLogTab.senderLabel')}
              </Label>
              <Textarea
                rows={2}
                autoComplete="off"
                placeholder={
                  direction === 'sent'
                    ? t('correspondenceLogTab.senderPlaceholderSent')
                    : t('correspondenceLogTab.senderPlaceholderReceived')
                }
                value={fromEmail}
                onChange={(e) => setFromEmail(e.target.value)}
                className="font-mono text-[12px]"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs inline-flex items-center gap-1">
                <ArrowDownLeft className="h-3 w-3 text-emerald-600" />
                {t('correspondenceLogTab.recipientLabel')}
              </Label>
              <Textarea
                rows={2}
                autoComplete="off"
                placeholder={t('correspondenceLogTab.recipientPlaceholder')}
                value={toEmail}
                onChange={(e) => setToEmail(e.target.value)}
                className="font-mono text-[12px]"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">{t('correspondenceLogTab.ccLabel')}</Label>
            <Textarea
              rows={2}
              autoComplete="off"
              placeholder={t('correspondenceLogTab.ccPlaceholder')}
              value={ccEmails}
              onChange={(e) => setCcEmails(e.target.value)}
              className="font-mono text-[12px]"
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">{t('correspondenceLogTab.summaryLabel')}</Label>
            <Textarea
              rows={4}
              placeholder={t('correspondenceLogTab.summaryPlaceholder')}
              value={body}
              onChange={(e) => setBody(e.target.value)}
            />
          </div>

          <DocumentSignatureField
            value={signatureUrl}
            onChange={setSignatureUrl}
            disabled={submitting || uploading}
          />

          <div className="space-y-1.5">
            <Label className="text-xs flex items-center gap-1">
              <Paperclip className="h-3 w-3" />
              {t('correspondenceLogTab.gmailScreenshot')}{' '}
              <span className="text-muted-foreground font-normal">({t('common.optional')})</span>
            </Label>
            {attachment ? (
              <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400 text-xs">
                <CheckCircle2 className="h-3.5 w-3.5" />
                <span className="truncate flex-1">{attachName}</span>
                <button
                  type="button"
                  className="text-emerald-700 hover:text-emerald-900"
                  onClick={() => {
                    setAttachment('');
                    setAttachName('');
                  }}
                >
                  ✕
                </button>
              </div>
            ) : (
              <Input
                type="file"
                accept="image/*"
                disabled={uploading}
                onChange={(e) => handleAttachment(e.target.files?.[0] ?? null)}
              />
            )}
            <p className="text-[10px] text-muted-foreground">
              {t('correspondenceLogTab.screenshotHint')}
            </p>
            {uploading && (
              <p className="text-[11px] text-muted-foreground flex items-center gap-1.5">
                <Loader2 className="h-3 w-3 animate-spin" /> {t('correspondenceLogTab.uploading')}
              </p>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={submitting}>
            {t('common.cancel')}
          </Button>
          <Button onClick={submit} disabled={submitting || uploading}>
            {submitting ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> {t('common.saving')}
              </>
            ) : (
              <>{editing ? t('correspondenceLogTab.saveEdit') : t('correspondenceLogTab.register')}</>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
