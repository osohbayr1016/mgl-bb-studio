import { useEffect, useState } from 'react';
import { FileDown, FileSignature, Paperclip, PenLine, Undo2 } from 'lucide-react';
import { mediaUrl } from '@/shared/api/client';
import type { CorrespondenceEntry } from '@/shared/types';
import { Badge } from '@/ui/badge';
import { Button } from '@/ui/button';
import { cn } from '@/shared/lib/utils';
import { formatDateTime } from '@/shared/lib/time';
import { useLanguage } from '@/shared/i18n';
import {
  DOC_TYPE_LABEL_KEYS,
  DOC_TYPE_SHORT,
  DOC_TYPE_TONE,
  SIGN_STATUS_LABEL_KEYS,
  SIGN_STATUS_TONE,
  isSignableDocType,
} from '@/features/projects/components/correspondenceConstants';
import { fetchClientSignatureBlob } from '@/features/projects/components/correspondenceSignatureApi';
import type { CorrespondenceSignActions } from '@/features/projects/components/CorrespondenceTable';
import { SigningLinkButton } from '@/features/signing/SigningLinkButton';

/** Захиалагчийн гарын үсэг хувийн bucket-д — `<img src>` шууд болохгүй, blob-оор. */
function ClientSignatureImage({ entryId, alt }: { entryId: number; alt: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let objectUrl: string | null = null;
    let cancelled = false;
    fetchClientSignatureBlob(entryId)
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch(() => {
        /* зураг алга — хэсэг нэргүй үлдэнэ */
      });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [entryId]);
  if (!url) return <div className="h-16 w-32 animate-pulse rounded bg-muted/40" />;
  return <img src={url} alt={alt} className="h-16 max-w-full object-contain" data-testid="client-signature-img" />;
}

function DetailField({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="min-w-0">
      <div className="mb-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      {value ? (
        <div className="font-mono text-[11px] whitespace-pre-line [overflow-wrap:anywhere] text-foreground/85">
          {value}
        </div>
      ) : (
        <span className="text-muted-foreground/60 italic text-[11px]">—</span>
      )}
    </div>
  );
}

export function CorrespondenceDetail({
  entry,
  author,
  dateStr,
  attachmentHref,
  sign,
}: {
  entry: CorrespondenceEntry;
  author: string;
  dateStr: string;
  attachmentHref: string | null;
  sign?: CorrespondenceSignActions;
}) {
  const { t } = useLanguage();
  const signable = isSignableDocType(entry.doc_type);
  const signStatus = entry.sign_status ?? 'none';

  return (
    <div className="space-y-3 rounded-lg border border-border/60 bg-background/60 p-3 text-[12px]">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
        <span className="tabular-nums text-foreground/80">{dateStr}</span>
        <span className="opacity-50">·</span>
        <span>{author}</span>
        {entry.doc_type && (
          <Badge
            variant="outline"
            className={cn('h-5 px-1.5 text-[10px] font-semibold', DOC_TYPE_TONE[entry.doc_type])}
            title={t(DOC_TYPE_LABEL_KEYS[entry.doc_type])}
          >
            {DOC_TYPE_SHORT[entry.doc_type]}
          </Badge>
        )}
        {entry.ref_no && <span className="font-mono text-foreground/70">{entry.ref_no}</span>}
      </div>

      <div className="font-medium text-foreground whitespace-pre-line break-words">
        {entry.subject}
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <DetailField label={t('correspondenceLogTab.colSender')} value={entry.from_email} />
        <DetailField label={t('correspondenceLogTab.colRecipient')} value={entry.to_email} />
        <DetailField label="CC / BCC" value={entry.cc_emails} />
      </div>

      {entry.body && (
        <div className="space-y-1">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
            {t('correspondenceLogTab.summaryLabel')}
          </div>
          <div className="max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-md border border-border/50 bg-muted/20 p-3 text-foreground/90">
            {entry.body}
          </div>
        </div>
      )}

      {entry.signature_url && (
        <div className="space-y-1">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
            {t('correspondenceLogTab.signatureLabel')}
          </div>
          <div className="inline-block rounded-md border border-border bg-white p-2">
            <img
              src={mediaUrl(entry.signature_url)}
              alt={t('correspondenceLogTab.signatureLabel')}
              className="h-16 max-w-full object-contain"
            />
          </div>
        </div>
      )}

      {/* Захиалагчийн гарын үсэг — зөвхөн RFI/CR (migration 0335). */}
      {signable && (
        <div className="space-y-2 rounded-md border border-border/50 bg-muted/10 p-3" data-testid="sign-section">
          <div className="flex flex-wrap items-center gap-2">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
              {t('correspondenceSign.sectionTitle')}
            </div>
            <Badge
              variant="outline"
              className={cn('h-5 px-1.5 text-[10px] font-medium', SIGN_STATUS_TONE[signStatus])}
            >
              {t(SIGN_STATUS_LABEL_KEYS[signStatus])}
            </Badge>
            {signStatus === 'pending' && entry.sign_requested_at && (
              <span className="text-[11px] text-muted-foreground">
                {t('correspondenceSign.requestedAt', { date: formatDateTime(entry.sign_requested_at) })}
              </span>
            )}
            {signStatus === 'signed' && entry.client_signed_at && (
              <span className="text-[11px] text-muted-foreground">
                {t('correspondenceSign.signedBy', {
                  name: entry.client_signer_name ?? '—',
                  date: formatDateTime(entry.client_signed_at),
                })}
              </span>
            )}
          </div>

          {signStatus === 'signed' && (
            <div className="inline-block rounded-md border border-border bg-white p-2">
              <ClientSignatureImage entryId={entry.id} alt={t('correspondenceSign.clientSignatureAlt')} />
            </div>
          )}

          {sign && (
            <div className="flex flex-wrap items-center gap-2">
              {sign.canSign && signStatus === 'pending' && (
                <Button size="sm" className="h-7 gap-1.5 text-[11px]" onClick={() => sign.onSign(entry)}>
                  <PenLine className="h-3.5 w-3.5" /> {t('correspondenceSign.signButton')}
                </Button>
              )}
              <Button
                size="sm"
                variant="outline"
                className="h-7 gap-1.5 text-[11px]"
                onClick={() => sign.onDownloadPdf(entry)}
              >
                <FileDown className="h-3.5 w-3.5" /> {t('correspondenceSign.downloadPdf')}
              </Button>
              {sign.canWrite && signStatus !== 'signed' && (
                <SigningLinkButton
                  kind="correspondence"
                  entityId={entry.id}
                  buttonLabel="Client link"
                  options={[
                    {
                      slot: 'client',
                      label: 'Захиалагч / хүлээн авагч',
                      roleLabel: 'Захиалагч / хүлээн авагч',
                    },
                  ]}
                  onCreated={sign.onChanged}
                />
              )}
              {sign.canWrite && signStatus === 'none' && (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 gap-1.5 text-[11px]"
                  onClick={() => sign.onRequestSignature(entry)}
                >
                  <FileSignature className="h-3.5 w-3.5" /> {t('correspondenceSign.requestButton')}
                </Button>
              )}
              {sign.canWrite && signStatus === 'pending' && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 gap-1.5 text-[11px] text-amber-700"
                  onClick={() => sign.onCancelSignature(entry)}
                >
                  <Undo2 className="h-3.5 w-3.5" /> {t('correspondenceSign.cancelButton')}
                </Button>
              )}
            </div>
          )}
        </div>
      )}

      {attachmentHref && (
        <a
          href={attachmentHref}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-[11px] text-primary hover:underline"
          title={t('correspondenceLogTab.openGmailScreenshot')}
        >
          <Paperclip className="h-3.5 w-3.5" /> {t('correspondenceLogTab.image')}
        </a>
      )}
    </div>
  );
}
