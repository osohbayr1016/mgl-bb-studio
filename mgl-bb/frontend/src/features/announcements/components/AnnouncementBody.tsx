import { useMemo } from 'react';

import { cn } from '@/shared/lib/utils';

import '../announcement-prose.css';
import { toDisplayHtml } from '../lib/announcementHtml';

/**
 * Мэдээллийн HTML агуулгыг харуулна.  HTML нь СЕРВЕР дээр цагаан жагсаалтаар
 * цэвэрлэгдсэн (`backend/src/lib/announcements.ts sanitizeHtml`) тул
 * `dangerouslySetInnerHTML` энд аюулгүй; хөтөч дээр дахин цэвэрлэхгүй.
 * `/media/<key>` замуудыг Worker-ийн абсолют URL болгоно (`toDisplayHtml`).
 */
export function AnnouncementBody({ html, className }: { html: string; className?: string }) {
  const display = useMemo(() => toDisplayHtml(html), [html]);
  return (
    <div
      className={cn('announcement-prose text-sm', className)}
      data-testid="announcement-body"
      dangerouslySetInnerHTML={{ __html: display }}
    />
  );
}
