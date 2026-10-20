import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, ChevronDown } from 'lucide-react';
import { getBodyHtml } from '@/features/email/api/email';
import { AttachmentPreviews } from './AttachmentPreviews';
import type { EmailAttachment, EmailMessageDetail } from '@/features/email/types/email';
import { cn } from '@/shared/lib/utils';
import { formatDateTime } from '@/shared/lib/time';
import { useLanguage } from '@/shared/i18n';
import { SenderAvatar } from './SenderAvatar';
import { displaySender } from './senderName';

/** Имэйлийн HTML биетийг ороох бүрхүүл.  Захидлын өөрийнх нь загварыг
 *  дарахгүй — зөвхөн (1) хүрээний зайг тэглэж, (2) зургийг самбарын өргөнөөс
 *  хэтрэхгүй болгож, (3) урт үгийг таслана. */
function wrapHtml(html: string): string {
  return `<!doctype html><meta charset="utf-8"><base target="_blank">
<style>
  html,body{margin:0;padding:0;background:#fff;color:#111;
    font:14px/1.55 system-ui,'Segoe UI',Arial,sans-serif}
  body{overflow-wrap:break-word}
  img,video{max-width:100%;height:auto}
</style>
${html}`;
}

/** One message inside a thread stack — collapsed summary ↔ expanded body. */
export function ThreadMessage({
  message,
  attachments,
  expanded,
  onToggle,
}: {
  message: EmailMessageDetail;
  attachments: EmailAttachment[];
  expanded: boolean;
  onToggle: () => void;
}) {
  const { t } = useLanguage();
  const senderName = displaySender(message.from_addr) || message.from_addr || '—';
  const hasHtml = Boolean(message.body_html_r2_key);

  const [htmlBody, setHtmlBody] = useState<string | null>(null);
  const [htmlFailed, setHtmlFailed] = useState(false);
  const [htmlHeight, setHtmlHeight] = useState(240);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const fetchedRef = useRef(false);

  // HTML биетийг захидлыг задлангуут ШУУД татна — урьд нь «Эх HTML харах»
  // товчны цаана нуугдаж, ихэнх захидал зөвхөн текстээрээ харагддаг байв.
  // Нэг л удаа (`fetchedRef`); задлаад хаагаад байхад дахин татахгүй.
  useEffect(() => {
    if (!expanded || !hasHtml || fetchedRef.current) return;
    fetchedRef.current = true;
    getBodyHtml(message.id)
      .then(setHtmlBody)
      // Уналт нь чимээгүй — оронд нь энгийн текст биет харагдана.
      .catch(() => setHtmlFailed(true));
  }, [expanded, hasHtml, message.id]);

  /**
   * iframe-ийг агуулгынх нь ЖИНХЭНЭ хэмжээгээр тохируулна: дотроо гүйлгэдэг
   * 18rem-ийн хайрцаг байхаа болиод, бүтэн захидал уншигдана (гүйлгэлт нь
   * зөвхөн уншлагын самбарт үлдэнэ).
   *
   * `sandbox="allow-same-origin"` — скрипт ЗӨВШӨӨРӨХГҮЙ (`allow-scripts`
   * алга) тул захидлын HTML идэвхгүй хэвээр; гэхдээ баримт нь ижил
   * гарлынх болсноор эцэг нь өндөр/өргөнийг нь хэмжиж чадна.  Хоёуланг нь
   * зөвшөөрвөл л sandbox-оос мултарч болно — тэгэхгүй.
   *
   * Имэйлүүд ихэвчлэн 600–800px тогтмол өргөнтэй хүснэгт ашигладаг тул
   * самбар нарийн үед `zoom`-оор багасгаж өргөнд нь багтаана — хэвтээ
   * гүйлгэлт гарахгүй.
   */
  const fitFrame = useCallback(() => {
    const el = frameRef.current;
    const doc = el?.contentDocument;
    const root = doc?.documentElement;
    if (!el || !doc || !root) return;
    // Эхлээд zoom-гүйгээр жинхэнэ хэмжээг нь ав — дараа нь масштабыг
    // өөрсдөө үржүүлнэ (zoom дээр scrollHeight-ийн утга тодорхойгүй).
    root.style.zoom = '';
    const avail = el.clientWidth;
    const naturalW = Math.max(root.scrollWidth, doc.body?.scrollWidth ?? 0);
    const naturalH = Math.max(root.scrollHeight, doc.body?.scrollHeight ?? 0);
    const scale = avail > 0 && naturalW > avail ? avail / naturalW : 1;
    if (scale < 1) root.style.zoom = String(scale);
    if (naturalH > 0) setHtmlHeight(Math.ceil(naturalH * scale) + 8);
  }, []);

  // Ачаалсны дараа зураг оройтож ирвэл өндөр өөрчлөгддөг тул хоёр удаа
  // дахин хэмжинэ; самбарын өргөн өөрчлөгдөхөд бас.
  useEffect(() => {
    if (!htmlBody) return;
    const timers = [setTimeout(fitFrame, 300), setTimeout(fitFrame, 1200)];
    window.addEventListener('resize', fitFrame);
    return () => {
      for (const id of timers) clearTimeout(id);
      window.removeEventListener('resize', fitFrame);
    };
  }, [htmlBody, fitFrame]);

  return (
    <div className="rounded-lg border border-border/60 bg-card">
      {/* Header (always visible, toggles collapse) */}
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-3 px-3 py-2.5 text-left"
      >
        <SenderAvatar name={senderName} size="sm" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-medium">{senderName}</span>
            {message.from_addr && (
              <span className="hidden truncate text-xs text-muted-foreground sm:inline">
                {message.from_addr}
              </span>
            )}
          </div>
          {!expanded && message.snippet && (
            <p className="truncate text-xs text-muted-foreground">{message.snippet}</p>
          )}
        </div>
        <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
          {message.internal_date ? formatDateTime(new Date(message.internal_date)) : ''}
        </span>
        <ChevronDown
          className={cn(
            'h-4 w-4 shrink-0 text-muted-foreground transition-transform',
            expanded && 'rotate-180',
          )}
        />
      </button>

      {expanded && (
        <div className="space-y-2 border-t border-border/60 px-3 py-3">
          <div className="grid grid-cols-[48px_1fr] gap-x-2 gap-y-0.5 font-mono text-[11px] text-foreground/80">
            <span className="text-muted-foreground">{t('mailTriagePage.recipient')}</span>
            <span className="break-all">{message.to_addrs || '—'}</span>
            {message.cc_addrs && (
              <>
                <span className="text-muted-foreground">CC</span>
                <span className="break-all">{message.cc_addrs}</span>
              </>
            )}
          </div>

          {/* Биет — HTML байвал ХАМГИЙН ЭХЭНД, бүтэн хэмжээгээрээ. */}
          {hasHtml && !htmlFailed ? (
            htmlBody === null ? (
              <div className="py-6 text-center text-muted-foreground">
                <Loader2 className="mx-auto h-4 w-4 animate-spin" />
              </div>
            ) : (
              <iframe
                ref={frameRef}
                title={`email-html-${message.id}`}
                sandbox="allow-same-origin"
                srcDoc={wrapHtml(htmlBody)}
                onLoad={fitFrame}
                style={{ height: htmlHeight }}
                className="w-full rounded-md border border-border/60 bg-white"
              />
            )
          ) : (
            message.body_text && (
              <p className="whitespace-pre-wrap break-words text-sm text-foreground/90">
                {message.body_text}
              </p>
            )
          )}

          {/* Зураг + PDF нь шууд харагдана; бусад төрөл нь татах чип хэвээр. */}
          <AttachmentPreviews attachments={attachments} />
        </div>
      )}
    </div>
  );
}
