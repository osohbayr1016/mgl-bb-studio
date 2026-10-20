import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo } from 'react';
import { Loader2 } from 'lucide-react';

import { useLanguage } from '@/shared/i18n';
import { fetchSignatureImage, ruleKeys } from '../api';

/**
 * Зурсан гарын үсгийн зураг — ХУВИЙН bucket-ээс authed зам
 * (`/internal-rules/signatures/:id/image`) татаж `blob:` URL-ээр харуулна.
 * `<img src="…/api/…">` шууд ажиллахгүй: Bearer толгой явдаггүй.
 */
export function SignatureImage({ signatureId, className }: { signatureId: number; className?: string }) {
  const { t } = useLanguage();
  const q = useQuery({
    queryKey: ruleKeys.image(signatureId),
    queryFn: () => fetchSignatureImage(signatureId),
    staleTime: Infinity,
    retry: false,
  });
  const url = useMemo(() => (q.data ? URL.createObjectURL(q.data) : null), [q.data]);
  useEffect(() => {
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [url]);

  if (q.isLoading) return <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-hidden />;
  if (!url) return null;
  return (
    <div className={className ?? 'inline-block max-w-full rounded-md border border-border bg-white p-2'}>
      <img src={url} alt={t('common.signature')} className="h-16 max-w-full object-contain" />
    </div>
  );
}
