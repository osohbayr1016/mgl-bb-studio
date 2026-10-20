import { useCallback, useState } from 'react';

import { downloadPdf } from '@/shared/api/client';
import { toast } from '@/shared/components/Toast';
import { useLanguage } from '@/shared/i18n';

/**
 * `downloadPdf` нь API-ийн суурийг (`…/api`) ӨӨРӨӨ угтварлана.  Гэтэл порталын
 * backend файлын холбоосыг `/api/client-files/…`, `/api/projects/…/client-pdf`
 * гэж БҮТЭН замаар буцаадаг (routes/clientPortal.ts) — шууд дамжуулбал хүсэлт
 * `/api/api/…` руу очиж 404/403 өгдөг байв (2026-09-23-нд илэрсэн: захиалагч
 * материалаа порталаас огт татаж чаддаггүй байсан).  Эхний `/api`-г хасна.
 */
export function apiRelative(url: string): string {
  return url.replace(/^\/api(?=\/)/, '');
}

/**
 * Портал доторх бүх татах товчны нэгдсэн төлөв.
 *
 * `downloadPdf` нь нэвтрэлтийн толгойтой fetch → blob → `<a download>` хийдэг
 * тул файлын төрлөөс үл хамаарна (PDF, DWG, ZIP …).  Аль нь явж байгааг
 * `busyKey`-ээр харуулна.
 */
export function useDownloader() {
  const { t } = useLanguage();
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const download = useCallback(
    async (url: string, fileName: string, key: string = url) => {
      setBusyKey(key);
      try {
        await downloadPdf(apiRelative(url), fileName);
      } catch (err) {
        toast.error(
          t('clientRoom.materials.downloadFailed'),
          err instanceof Error ? err.message : undefined,
        );
      } finally {
        setBusyKey(null);
      }
    },
    [t],
  );

  return { busyKey, download };
}
