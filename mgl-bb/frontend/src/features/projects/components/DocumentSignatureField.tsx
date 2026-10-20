import { Button } from '@/ui/button';
import { Label } from '@/ui/label';
import { SignatureCapture } from '@/shared/components/SignatureCapture';
import { useAuth } from '@/shared/context/AuthContext';
import { useLanguage } from '@/shared/i18n';
import { toast } from '@/shared/components/Toast';
import { UserCheck } from 'lucide-react';

/** CR/RFI бүртгэлд гарын үсэг — зурах, upload, эсвэл профайлын хадгалсан. */
export function DocumentSignatureField({
  value,
  onChange,
  disabled,
}: {
  value: string | null;
  onChange: (url: string | null) => void;
  disabled?: boolean;
}) {
  const { t } = useLanguage();
  const { user } = useAuth();
  const savedUrl = user?.signature_url ?? null;

  const useSaved = () => {
    if (!savedUrl) {
      toast.warn(t('correspondenceLogTab.noSavedSignature'));
      return;
    }
    onChange(savedUrl);
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Label className="text-xs">{t('correspondenceLogTab.signatureLabel')}</Label>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-7 text-xs"
          disabled={disabled || !savedUrl}
          onClick={useSaved}
        >
          <UserCheck className="h-3.5 w-3.5 mr-1.5" />
          {t('correspondenceLogTab.useMySignature')}
        </Button>
      </div>
      <SignatureCapture value={value} onChange={onChange} disabled={disabled} />
    </div>
  );
}
