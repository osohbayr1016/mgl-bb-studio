import { useMutation } from '@tanstack/react-query';
import { Mail, Loader2, Send, AlertCircle, Paperclip, PenLine } from 'lucide-react';
import { uploadFile } from '@/shared/api/client';
import { useLanguage } from '@/shared/i18n';
import { toast } from '@/shared/components/Toast';
import { Button } from '@/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/ui/dialog';
import { Checkbox } from '@/ui/checkbox';
import { DocumentSignatureField } from '@/features/projects/components/DocumentSignatureField';
import { CorrespondenceSendFields } from '@/features/projects/components/CorrespondenceSendFields';
import { sendCorrespondenceEmail } from '@/features/projects/components/correspondenceSendApi';
import { useCorrespondenceSendForm } from '@/features/projects/components/useCorrespondenceSendForm';
import {
  isSignableDocType,
  todayIso,
  type CorrespondenceDocType,
} from '@/features/projects/components/correspondenceConstants';

export function CorrespondenceSendDialog({
  open,
  projectId,
  onClose,
  onSent,
}: {
  open: boolean;
  projectId: number;
  onClose: () => void;
  onSent: () => void;
}) {
  const { t } = useLanguage();
  const form = useCorrespondenceSendForm(open, projectId);

  const send = useMutation({
    mutationFn: async () => {
      let attachments: { r2_key: string; filename: string; mime_type: string }[] | undefined;
      if (form.files.length) {
        attachments = [];
        for (const f of form.files) {
          const url = await uploadFile(f);
          attachments.push({
            r2_key: url.replace(/^\/media\//, ''),
            filename: f.name,
            mime_type: f.type || 'application/octet-stream',
          });
        }
      }
      return sendCorrespondenceEmail(projectId, {
        account_id: Number(form.accountId),
        from: form.fromAddr,
        to: form.to.trim(),
        cc: form.cc.trim() || undefined,
        subject: form.subject.trim(),
        body_text: form.body.trim(),
        doc_type: form.docType as CorrespondenceDocType,
        log_date: todayIso(),
        ref_no: form.refNo.trim() || null,
        signature_url: form.signatureUrl,
        attachments,
        request_signature: form.requestSignature && isSignableDocType(form.docType || null),
      });
    },
    onSuccess: (res) => {
      toast.success(t('correspondenceLogTab.sendSuccess'));
      // Имэйл явсан ч гарын үсгийн хүсэлт унасан бол хэлнэ — бүртгэлээс дахин тавьж болно.
      if (res.signature_error) toast.warn(t('correspondenceSign.requestFailed'), res.signature_error);
      onSent();
    },
    onError: (e: Error) => form.setError(e.message || t('correspondenceLogTab.sendFailed')),
  });

  const canSend =
    !!form.accountId &&
    !!form.to.trim() &&
    !!form.subject.trim() &&
    !!form.body.trim() &&
    !!form.docType &&
    !send.isPending;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Mail className="h-5 w-5 text-primary" />
            {t('correspondenceLogTab.sendDialogTitle')}
          </DialogTitle>
        </DialogHeader>

        {form.error && (
          <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-destructive/10 border border-destructive/30 text-destructive text-sm">
            <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" /> {form.error}
          </div>
        )}

        {form.loading ? (
          <div className="py-8 text-center text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin mx-auto" />
          </div>
        ) : form.accounts.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4">
            {t('correspondenceLogTab.noMailboxConfigured')}
          </p>
        ) : (
          <>
            <CorrespondenceSendFields
              accounts={form.accounts}
              clientContacts={form.clientContacts}
              accountId={form.accountId}
              fromAddr={form.fromAddr}
              fromAliases={form.fromAliases}
              to={form.to}
              cc={form.cc}
              subject={form.subject}
              body={form.body}
              docType={form.docType}
              refNo={form.refNo}
              onAccountChange={form.setAccountId}
              onFromChange={form.setFromAddr}
              onToChange={form.setTo}
              onCcChange={form.setCc}
              onSubjectChange={form.setSubject}
              onBodyChange={form.setBody}
              onDocTypeChange={form.setDocType}
              onRefNoChange={form.setRefNo}
              onPickContact={form.appendContact}
            />
            <DocumentSignatureField
              value={form.signatureUrl}
              onChange={form.setSignatureUrl}
              disabled={send.isPending}
            />
            {isSignableDocType(form.docType || null) && (
              <label className="flex items-start gap-2 rounded-md border border-border/60 bg-muted/20 p-2.5 text-xs cursor-pointer">
                <Checkbox
                  checked={form.requestSignature}
                  onCheckedChange={(v) => form.setRequestSignature(v === true)}
                  disabled={send.isPending}
                  className="mt-0.5"
                  data-testid="request-signature-checkbox"
                />
                <span className="space-y-0.5">
                  <span className="flex items-center gap-1 font-medium">
                    <PenLine className="h-3 w-3" /> {t('correspondenceSign.sendRequestLabel')}
                  </span>
                  <span className="block text-muted-foreground">
                    {t('correspondenceSign.sendRequestHint')}
                  </span>
                </span>
              </label>
            )}
            <div className="space-y-1.5">
              <label className="text-xs flex items-center gap-1">
                <Paperclip className="h-3 w-3" />
                {t('correspondenceLogTab.attachments')}
              </label>
              <input
                type="file"
                multiple
                disabled={send.isPending}
                onChange={(e) => form.setFiles(Array.from(e.target.files ?? []))}
                className="text-xs"
              />
            </div>
          </>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={send.isPending}>
            {t('common.cancel')}
          </Button>
          <Button
            onClick={() => send.mutate()}
            disabled={!canSend || form.loading || form.accounts.length === 0}
          >
            {send.isPending ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />{' '}
                {t('correspondenceLogTab.sending')}
              </>
            ) : (
              <>
                <Send className="h-3.5 w-3.5 mr-1.5" /> {t('correspondenceLogTab.send')}
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
