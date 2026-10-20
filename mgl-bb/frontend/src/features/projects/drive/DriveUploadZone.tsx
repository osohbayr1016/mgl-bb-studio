/**
 * «Байршуулах» бүс — жагсаалтын ДЭЭР байнга харагдах чирж тавих талбар +
 * файл / хавтас сонгох.  Эзний хүсэлт (2026-09-18): «Байршуулах» нь dropdown
 * товч биш, нээлттэй drag-and-drop хэсэг байх ёстой.
 *
 * Бүс өөрөө `data-drop-kind="zone"` зорилт — `useDriveDragSession`
 * (document-түвшин) чирэлтийг барьж, тавихад дуудагч `onDropFiles`-ээр
 * одоо харж буй хавтсанд байршуулна; энд drag үйл явдал огт боловсруулахгүй.
 * Далд `<input type=file>` хоёр: нэг нь олон файл, нөгөө нь `webkitdirectory`
 * (хавтас бүхэлдээ, дэд хавтастай нь — `file.webkitRelativePath`-аар).
 * Сонголт бүр `entriesFromFileList` → дуудагчийн `onEntries`.
 */
import { useRef } from 'react';
import { FolderUp, Upload, FileUp } from 'lucide-react';
import { Button } from '@/ui/button';
import { useLanguage } from '@/shared/i18n';
import { cn } from '@/shared/lib/utils';
import { entriesFromFileList, type UploadEntry } from './driveUpload';

export function DriveUploadZone({
  disabled,
  folderId,
  folderName,
  over,
  dragging,
  onEntries,
}: {
  disabled?: boolean;
  /** Одоо харж буй хавтас — тавихад очих газар ('root' байж болно). */
  folderId: string;
  folderName: string;
  /** Чирж буй зүйл яг энэ бүсийн дээр байна. */
  over: boolean;
  /** Ямар нэг чирэлт явж байна (бүсийг тодруулна). */
  dragging: boolean;
  onEntries: (entries: UploadEntry[]) => void;
}) {
  const { t } = useLanguage();
  const fileRef = useRef<HTMLInputElement>(null);
  const dirRef = useRef<HTMLInputElement>(null);

  const handleChange = (input: HTMLInputElement) => {
    if (input.files && input.files.length > 0) onEntries(entriesFromFileList(input.files));
    // Ижил файлыг дахин сонгоход `change` гарахын тулд хоослоно.
    input.value = '';
  };

  return (
    <>
      <div
        className={cn(
          'flex flex-wrap items-center gap-3 rounded-xl border-2 border-dashed px-4 py-3 transition-colors',
          disabled
            ? 'border-border/60 opacity-60'
            : over
              ? 'border-primary bg-primary/10 ring-2 ring-primary/30'
              : dragging
                ? 'border-primary/60 bg-primary/5'
                : 'border-primary/40 bg-primary/5 hover:border-primary hover:bg-primary/10',
        )}
        data-drop-kind={disabled ? undefined : 'zone'}
        data-drop-id={disabled ? undefined : folderId}
        data-drop-name={disabled ? undefined : folderName}
        title={t('projectDrive.uploadHint')}
      >
        <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary">
          <Upload className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-foreground">{t('projectDrive.zoneTitle')}</div>
          <div className="text-xs text-muted-foreground">{t('projectDrive.zoneTarget', { name: folderName })}</div>
        </div>
        <div className="flex items-center gap-1.5">
          <Button size="sm" disabled={disabled} onClick={() => fileRef.current?.click()}>
            <FileUp className="h-4 w-4" /> {t('projectDrive.uploadFiles')}
          </Button>
          <Button size="sm" variant="outline" disabled={disabled} onClick={() => dirRef.current?.click()}>
            <FolderUp className="h-4 w-4" /> {t('projectDrive.uploadFolder')}
          </Button>
        </div>
      </div>
      <input
        ref={fileRef}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => handleChange(e.currentTarget)}
        aria-hidden
        tabIndex={-1}
      />
      <input
        ref={dirRef}
        type="file"
        multiple
        className="hidden"
        // React-ийн төрөлд байхгүй атрибут — бүх Chromium/Firefox/Safari ойлгодог.
        {...({ webkitdirectory: '', directory: '' } as Record<string, string>)}
        onChange={(e) => handleChange(e.currentTarget)}
        aria-hidden
        tabIndex={-1}
      />
    </>
  );
}
