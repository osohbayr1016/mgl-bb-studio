import { useEffect, useState } from 'react';
import { FileEdit } from 'lucide-react';
import { apiFetch } from '@/shared/api/client';
import { useLanguage } from '@/shared/i18n';
import { Button } from '@/ui/button';

/* =============================================================
 * Stirling-PDF action for the performance-report editor.
 * Renders a single "PDF засах" button that opens the Stirling
 * web editor (for manual sign / stamp / redact / reorder).
 * Hidden unless a Stirling instance is configured with a
 * public editor URL (GET /api/pdf-tools/config).
 * ============================================================= */

interface StirlingPdfActionsProps {
  projectId: number;
  reportId: number;
  reportNo: number | string;
}

interface PdfToolsConfig {
  enabled: boolean;
  editorUrl: string | null;
}

export function StirlingPdfActions(_props: StirlingPdfActionsProps) {
  const { t } = useLanguage();
  const [config, setConfig] = useState<PdfToolsConfig | null>(null);

  useEffect(() => {
    let alive = true;
    apiFetch<PdfToolsConfig>('/pdf-tools/config')
      .then((cfg) => {
        if (alive) setConfig(cfg);
      })
      .catch(() => {
        if (alive) setConfig({ enabled: false, editorUrl: null });
      });
    return () => {
      alive = false;
    };
  }, []);

  if (!config?.enabled || !config.editorUrl) return null;
  const editorUrl = config.editorUrl;

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={() => window.open(editorUrl, '_blank', 'noopener')}
    >
      <FileEdit className="w-4 h-4 mr-1.5" /> {t('stirlingPdf.openEditor')}
    </Button>
  );
}
