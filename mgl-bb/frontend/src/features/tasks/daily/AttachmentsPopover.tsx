import { useState } from 'react';
import { Paperclip, Loader2, X, FileText, ImageIcon, File as FileIcon } from 'lucide-react';
import { Button } from '@/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/ui/popover';
import { uploadFile, MEDIA_BASE_URL } from '@/shared/api/client';
import { toast } from '@/shared/components/Toast';
import { useLanguage } from '@/shared/i18n';
import { cn } from '@/shared/lib/utils';
import { formatFileSize, isImageAttachment, type ReportAttachment } from './types';

/**
 * Нэг мөрийн ОЛОН хавсралт — зураг, PDF, DWG, скриншот.
 *
 * Урьд нь ганцхан зураг ("image_url") байсан тул PDF-ээр ирсэн зөвлөмж,
 * DWG snapshot, эсвэл хоёр экран зургийг хамт өгөх боломжгүй байв.
 *
 * ⚠️ SVG-г ЗОРИУДААР хүлээж авахгүй: `/media/<key>` нь `/api/*`-тай ижил
 * гарал дээр нийтэд НЭЭЛТТЭЙ (CLAUDE.md, аюулгүй байдлын #2) тул
 * `image/svg+xml` нь итгэмжлэгдсэн домэйн дээр скрипт ажиллуулах гарц
 * болно.  Энэ нь зөвхөн клиент талын шүүлт — сервер талын бодит хамгаалалт
 * биш — гэхдээ энэ формоор шинэ цоорхой НЭЭХГҮЙ байх нь бидний хариуцлага.
 */

const ACCEPT =
  'image/png,image/jpeg,image/gif,image/webp,image/avif,application/pdf,.dwg,.dxf,.rvt,.doc,.docx,.xls,.xlsx,.zip,.txt';

const MAX_ATTACHMENTS = 10;
/** Worker-ийн санах ойн хязгаараас доогуур — 50 MiB-аас дээшийг
 *  `uploadFile` өөрөө multipart руу шилжүүлдэг тул зөвхөн эрүүл ухааны тааз. */
const MAX_FILE_BYTES = 100 * 1024 * 1024;

function isBlockedType(file: File): boolean {
  const type = (file.type || '').toLowerCase();
  return type.includes('svg') || /\.svgz?$/i.test(file.name);
}

export default function AttachmentsPopover({
  attachments,
  onChange,
  disabled,
}: {
  attachments: ReportAttachment[];
  onChange: (next: ReportAttachment[]) => void;
  disabled?: boolean;
}) {
  const { t } = useLanguage();
  const [uploading, setUploading] = useState(0);

  const handlePick = async (files: FileList) => {
    const picked = Array.from(files);
    const room = MAX_ATTACHMENTS - attachments.length;
    if (room <= 0) {
      toast.warn(t('dailyReport.attachLimitTitle'), t('dailyReport.attachLimitBody', { max: MAX_ATTACHMENTS }));
      return;
    }
    const batch = picked.slice(0, room);
    if (picked.length > room) {
      toast.warn(t('dailyReport.attachLimitTitle'), t('dailyReport.attachLimitBody', { max: MAX_ATTACHMENTS }));
    }

    setUploading((n) => n + batch.length);
    const uploaded: ReportAttachment[] = [];
    for (const file of batch) {
      if (isBlockedType(file)) {
        toast.error(t('dailyReport.attachBlockedTitle'), t('dailyReport.attachBlockedBody'));
        setUploading((n) => n - 1);
        continue;
      }
      if (file.size > MAX_FILE_BYTES) {
        toast.error(file.name, t('dailyReport.attachTooBig'));
        setUploading((n) => n - 1);
        continue;
      }
      try {
        const url = await uploadFile(file);
        uploaded.push({
          url,
          name: file.name,
          type: file.type || undefined,
          size: file.size,
        });
      } catch (err) {
        console.error(err);
        toast.error(file.name, t('common.actionFailed'));
      } finally {
        setUploading((n) => n - 1);
      }
    }
    if (uploaded.length > 0) onChange([...attachments, ...uploaded]);
  };

  const remove = (url: string) => onChange(attachments.filter((a) => a.url !== url));

  const count = attachments.length;
  const busy = uploading > 0;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          size="sm"
          variant="outline"
          disabled={disabled}
          className={cn('h-8 w-8 p-0 relative', count > 0 && 'border-success/50 text-success')}
          title={t('dailyReport.attachTitle')}
          aria-label={t('dailyReport.attachTitle')}
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Paperclip className="h-3.5 w-3.5" />}
          {count > 0 && (
            <span
              className="absolute -top-1.5 -right-1.5 h-4 min-w-4 px-1 rounded-full bg-success
                         text-success-foreground text-[9px] font-semibold leading-4 tabular-nums"
            >
              {count}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-3 space-y-2" align="end">
        <div className="flex items-center justify-between">
          <p className="text-xs font-medium text-foreground">{t('dailyReport.attachTitle')}</p>
          <span className="text-[10px] text-muted-foreground tabular-nums">
            {count}/{MAX_ATTACHMENTS}
          </span>
        </div>

        {count > 0 && (
          <ul className="space-y-1.5 max-h-56 overflow-y-auto">
            {attachments.map((a) => (
              <li
                key={a.url}
                className="flex items-center gap-2 rounded-md border border-border bg-muted/20 p-1.5"
              >
                {isImageAttachment(a) ? (
                  <img
                    src={`${MEDIA_BASE_URL}${a.url}`}
                    alt={a.name}
                    className="h-9 w-9 rounded object-cover shrink-0"
                    loading="lazy"
                  />
                ) : (
                  <span className="h-9 w-9 rounded bg-muted flex items-center justify-center shrink-0">
                    {a.type === 'application/pdf' ? (
                      <FileText className="h-4 w-4 text-destructive" />
                    ) : (
                      <FileIcon className="h-4 w-4 text-muted-foreground" />
                    )}
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  <a
                    href={`${MEDIA_BASE_URL}${a.url}`}
                    target="_blank"
                    rel="noreferrer"
                    className="block text-xs text-foreground truncate hover:underline"
                    title={a.name}
                  >
                    {a.name}
                  </a>
                  <span className="text-[10px] text-muted-foreground">{formatFileSize(a.size)}</span>
                </div>
                <button
                  type="button"
                  onClick={() => remove(a.url)}
                  className="h-6 w-6 rounded-full hover:bg-destructive/10 flex items-center justify-center shrink-0"
                  aria-label={t('common.delete')}
                >
                  <X className="h-3 w-3 text-muted-foreground" />
                </button>
              </li>
            ))}
          </ul>
        )}

        <label
          className={cn(
            'flex items-center justify-center gap-2 h-16 rounded-md',
            'border border-dashed border-border hover:border-primary/50 hover:bg-primary/5',
            'text-xs text-muted-foreground hover:text-foreground transition-colors',
            busy || count >= MAX_ATTACHMENTS ? 'pointer-events-none opacity-60' : 'cursor-pointer',
          )}
        >
          {busy ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" /> {t('dailyReport.uploadingN', { count: uploading })}
            </>
          ) : (
            <>
              <ImageIcon className="h-4 w-4" /> {t('dailyReport.attachCta')}
            </>
          )}
          <input
            type="file"
            multiple
            accept={ACCEPT}
            className="hidden"
            onChange={(e) => {
              const files = e.target.files;
              if (files && files.length > 0) handlePick(files);
              e.target.value = '';
            }}
          />
        </label>
        <p className="text-[10px] text-muted-foreground leading-snug">
          {t('dailyReport.attachHint')}
        </p>
      </PopoverContent>
    </Popover>
  );
}
