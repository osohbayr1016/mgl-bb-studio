import { Input } from '@/ui/input';
import { Label } from '@/ui/label';
import { Textarea } from '@/ui/textarea';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/i18n';
import type { EmailAccount } from '@/features/email/types/email';
import { ClientContactChips } from '@/features/projects/components/ClientContactChips';
import {
  CORRESPONDENCE_DOC_TYPES,
  DOC_TYPE_LABEL_KEYS,
  DOC_TYPE_SHORT,
  DOC_TYPE_TONE,
  type CorrespondenceDocType,
} from '@/features/projects/components/correspondenceConstants';
import type { ClientContact } from '@/shared/types';
import { CorrespondenceSendMailboxFields } from '@/features/projects/components/CorrespondenceSendMailboxFields';

type Props = {
  accounts: EmailAccount[];
  clientContacts: ClientContact[];
  accountId: string;
  fromAddr: string;
  fromAliases: string[];
  to: string;
  cc: string;
  subject: string;
  body: string;
  docType: CorrespondenceDocType | '';
  refNo: string;
  onAccountChange: (id: string) => void;
  onFromChange: (v: string) => void;
  onToChange: (v: string) => void;
  onCcChange: (v: string) => void;
  onSubjectChange: (v: string) => void;
  onBodyChange: (v: string) => void;
  onDocTypeChange: (v: CorrespondenceDocType | '') => void;
  onRefNoChange: (v: string) => void;
  onPickContact: (email: string) => void;
};

export function CorrespondenceSendFields(p: Props) {
  const { t } = useLanguage();

  return (
    <div className="space-y-4 py-2">
      <CorrespondenceSendMailboxFields
        accounts={p.accounts}
        accountId={p.accountId}
        fromAddr={p.fromAddr}
        fromAliases={p.fromAliases}
        onAccountChange={p.onAccountChange}
        onFromChange={p.onFromChange}
      />
      <ClientContactChips contacts={p.clientContacts} onPick={p.onPickContact} />
      <div className="space-y-1.5">
        <Label className="text-xs">{t('correspondenceLogTab.recipientLabel')}</Label>
        <Textarea
          rows={2}
          value={p.to}
          onChange={(e) => p.onToChange(e.target.value)}
          placeholder={t('correspondenceLogTab.recipientPlaceholder')}
          className="font-mono text-[12px]"
        />
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs">{t('correspondenceLogTab.ccLabel')}</Label>
        <Textarea
          rows={2}
          value={p.cc}
          onChange={(e) => p.onCcChange(e.target.value)}
          placeholder={t('correspondenceLogTab.ccPlaceholder')}
          className="font-mono text-[12px]"
        />
      </div>
      <DocTypeAndRef
        docType={p.docType}
        refNo={p.refNo}
        onDocTypeChange={p.onDocTypeChange}
        onRefNoChange={p.onRefNoChange}
      />
      <div className="space-y-1.5">
        <Label className="text-xs">
          {t('correspondenceLogTab.colSubject')} <span className="text-destructive">*</span>
        </Label>
        <Input value={p.subject} onChange={(e) => p.onSubjectChange(e.target.value)} autoFocus />
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs">{t('correspondenceLogTab.summaryLabel')}</Label>
        <Textarea
          rows={5}
          value={p.body}
          onChange={(e) => p.onBodyChange(e.target.value)}
          placeholder={t('correspondenceLogTab.summaryPlaceholder')}
        />
      </div>
    </div>
  );
}

function DocTypeAndRef({
  docType,
  refNo,
  onDocTypeChange,
  onRefNoChange,
}: {
  docType: CorrespondenceDocType | '';
  refNo: string;
  onDocTypeChange: (v: CorrespondenceDocType | '') => void;
  onRefNoChange: (v: string) => void;
}) {
  const { t } = useLanguage();
  return (
    <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-3">
      <div className="space-y-1.5">
        <Label className="text-xs">{t('correspondenceLogTab.docType')}</Label>
        <div className="grid grid-cols-2 gap-1 sm:grid-cols-4">
          {CORRESPONDENCE_DOC_TYPES.map((dt) => (
            <button
              key={dt}
              type="button"
              onClick={() => onDocTypeChange(docType === dt ? '' : dt)}
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
          onChange={(e) => onRefNoChange(e.target.value)}
          placeholder={t('correspondenceLogTab.refNoPlaceholder')}
          className="w-[120px]"
        />
      </div>
    </div>
  );
}
