/** Хувийн хавсралтыг (reviewer) анхны нэрээр нь татах — authed blob → `blob:` → `<a download>`. */
import { fetchAttachmentBlob, type EfReviewerAttachment } from '../api';

export async function downloadAttachment(requestId: string, a: EfReviewerAttachment): Promise<void> {
  const blob = await fetchAttachmentBlob(requestId, a.id, false);
  const url = URL.createObjectURL(blob);
  try {
    const link = document.createElement('a');
    link.href = url;
    link.download = a.name;
    document.body.appendChild(link);
    link.click();
    link.remove();
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
  }
}
