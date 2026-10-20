import { useState } from 'react';
import { FileDown, FileSpreadsheet, FileText, Loader2 } from 'lucide-react';
import { MEDIA_BASE_URL } from '@/shared/api/client';
import { toast } from '@/shared/components/Toast';
import { useLanguage } from '@/shared/i18n';
import { Button } from '@/ui/button';
import { summaryQueryString, type AsrSummaryParams, type AsrSummaryResponse } from './summaryTypes';

type Kind = 'pdf' | 'xlsx' | 'docx';

function saveBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/**
 * Серверийн PDF (`GET /author-supervision/summary/pdf`) — `downloadAsrPdf`-ийн
 * жор: хоёртын хариу тул шууд `fetch`, токен header + cookie хоёулаа.
 */
async function downloadSummaryPdf(params: AsrSummaryParams, fallbackStem: string) {
  const qs = summaryQueryString(params);
  const token = localStorage.getItem('auth_token');
  const res = await fetch(`${MEDIA_BASE_URL}/api/author-supervision/summary/pdf${qs ? `?${qs}` : ''}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    credentials: 'include',
  });
  if (!res.ok) {
    const msg = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(msg.error ?? `PDF (${res.status})`);
  }
  const cd = res.headers.get('content-disposition') ?? '';
  const star = cd.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  const plain = cd.match(/filename="?([^";]+)"?/i)?.[1];
  const name = star ? decodeURIComponent(star) : (plain ?? `${fallbackStem}.pdf`);
  saveBlob(await res.blob(), name);
}

/**
 * Нэгтгэл тайланг PDF / Excel / Word болгон татах товчнууд.  Excel, Word нь
 * хөтөч дээр ЭНЭ `data`-аас угсрагдана (тоо дахин бодогдохгүй); PDF нь
 * серверийн Browser Rendering (хэвлэх хуудастай ЯГ ижил харагдац).
 */
export function AsrSummaryExportButtons({
  params,
  data,
  className,
}: {
  params: AsrSummaryParams;
  data: AsrSummaryResponse | null | undefined;
  className?: string;
}) {
  const { t } = useLanguage();
  const [busy, setBusy] = useState<Kind | null>(null);
  const disabled = !data || data.entries.length === 0 || busy != null;

  const run = async (kind: Kind) => {
    if (!data) return;
    setBusy(kind);
    try {
      if (kind === 'pdf') {
        await downloadSummaryPdf(params, data.file_stem);
      } else if (kind === 'xlsx') {
        const { buildAsrSummaryWorkbook } = await import('./exportAsrSummaryXlsx');
        const { downloadWorkbook } = await import('@/features/attendance/admin/lib/excel');
        const wb = await buildAsrSummaryWorkbook(data, t);
        await downloadWorkbook(wb, `${data.file_stem}.xlsx`);
      } else {
        const { buildAsrSummaryDocx } = await import('./buildAsrSummaryDocx');
        saveBlob(await buildAsrSummaryDocx(data, t), `${data.file_stem}.docx`);
      }
    } catch (err) {
      toast.error(t('asr.summary.exportFailed'), err instanceof Error ? err.message : undefined);
    } finally {
      setBusy(null);
    }
  };

  const items: { kind: Kind; label: string; Icon: typeof FileDown }[] = [
    { kind: 'pdf', label: t('asr.summary.pdf'), Icon: FileDown },
    { kind: 'xlsx', label: t('asr.summary.excel'), Icon: FileSpreadsheet },
    { kind: 'docx', label: t('asr.summary.word'), Icon: FileText },
  ];

  return (
    <div className={className ?? 'flex flex-wrap gap-2'}>
      {items.map(({ kind, label, Icon }) => (
        <Button
          key={kind}
          type="button"
          variant="outline"
          size="sm"
          className="gap-2"
          disabled={disabled}
          onClick={() => void run(kind)}
          data-testid={`asr-summary-export-${kind}`}
        >
          {busy === kind ? <Loader2 className="h-4 w-4 animate-spin" /> : <Icon className="h-4 w-4" />}
          {label}
        </Button>
      ))}
    </div>
  );
}
