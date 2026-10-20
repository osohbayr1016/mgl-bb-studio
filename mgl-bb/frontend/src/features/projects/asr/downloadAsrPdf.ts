import { MEDIA_BASE_URL } from '@/shared/api/client';

/**
 * Зохиогчийн хяналтын тайланг PDF болгож татна.
 *
 * `apiFetch` нь JSON-д зориулагдсан тул шууд `fetch` — хариу нь хоёртын
 * PDF.  Токеныг header-ээр БОЛОН cookie-гоор хоёуланг нь явуулна
 * (`TeamReportShell`-ийн татах урсгалтай ижил): Worker хоёуланг нь хүлээж
 * авдаг ч, зарим төхөөрөмжид localStorage хоосон байж болно.
 *
 * Файлын нэрийг серверийн `Content-Disposition`-оос авна — нэрлэлтийн
 * дүрэм (`260728_MEC-25-21_ASR_001.pdf`) backend дээр ганц газар байна.
 */
export async function downloadAsrPdf(reportId: number, fallbackName = 'DASR.pdf'): Promise<void> {
  const token = localStorage.getItem('auth_token');
  const res = await fetch(`${MEDIA_BASE_URL}/api/author-supervision/${reportId}/pdf`, {
    method: 'GET',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    credentials: 'include',
  });

  if (!res.ok) {
    const msg = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(msg.error ?? `PDF (${res.status})`);
  }

  const blob = await res.blob();
  const cd = res.headers.get('content-disposition') ?? '';
  const name = cd.match(/filename="?([^";]+)"?/i)?.[1] ?? fallbackName;

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
