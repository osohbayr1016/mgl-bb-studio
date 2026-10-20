import { useRef, useState } from 'react';
import { Eye, Loader2, Paperclip, Upload, X } from 'lucide-react';

import { useLanguage } from '@/shared/i18n';
import { cn } from '@/shared/lib/utils';
import { Button } from '@/ui/button';

import { fetchRuleFile } from '../api';
import type { AdminRuleAttachment } from '../api';
import {
  RULE_FILE_ACCEPT,
  RULE_FILE_MAX_BYTES,
  RULE_FILE_MAX_COUNT,
  formatFileSize,
  isPreviewable,
  ruleFileKind,
} from '../lib/ruleFiles';
import { RuleFileIcon } from './RuleFileIcon';
import { RuleFilePreviewDialog } from './RuleFilePreview';

/**
 * Админы хавсралтын карт — жагсаалт, урьдчилан харах, хасах, файл
 * сонгох/чирж тавих.  Өөрчлөлт нь «Хадгалах» хүртэл зөвхөн маягтад;
 * ажилтан нийтлэгдсэн хувилбарын файлыг л харна.
 */
export function RuleAttachmentsEditor({
  ruleId,
  attachments,
  uploading,
  getLocalFile,
  onAddFiles,
  onRemove,
  disabled,
}: {
  ruleId: number | null;
  attachments: AdminRuleAttachment[];
  uploading: string[];
  /** Энэ сессэд байршуулсан эх файл (хадгалаагүй журамд урьдчилан харах). */
  getLocalFile: (key: string) => File | undefined;
  onAddFiles: (files: File[]) => void;
  onRemove: (key: string) => void;
  disabled?: boolean;
}) {
  const { t } = useLanguage();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [preview, setPreview] = useState<AdminRuleAttachment | null>(null);

  const load = (a: AdminRuleAttachment): Promise<Blob> => {
    const local = getLocalFile(a.key);
    if (local) return Promise.resolve(local);
    if (ruleId) return fetchRuleFile(ruleId, a.id);
    return Promise.reject(new Error(t('rules.files.loadFailed')));
  };

  return (
    <div className="space-y-3" data-testid="rule-attachments-editor">
      {attachments.length > 0 && (
        <ul className="divide-y divide-border rounded-md border border-border">
          {attachments.map((a) => (
            <li key={a.key} className="flex items-center gap-3 px-3 py-2" data-testid="rule-attachment-row">
              <RuleFileIcon name={a.name} className="h-5 w-5 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm text-foreground" title={a.name}>
                  {a.name}
                </div>
                <div className="text-micro text-muted-foreground">{formatFileSize(a.size)}</div>
              </div>
              {isPreviewable(ruleFileKind(a.name, a.content_type)) && (
                <Button type="button" variant="ghost" size="sm" onClick={() => setPreview(a)}>
                  <Eye className="mr-1.5 h-3.5 w-3.5" aria-hidden />
                  {t('rules.files.view')}
                </Button>
              )}
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-muted-foreground hover:text-destructive"
                title={t('rules.files.remove')}
                aria-label={t('rules.files.remove')}
                onClick={() => onRemove(a.key)}
                disabled={disabled}
              >
                <X className="h-4 w-4" aria-hidden />
              </Button>
            </li>
          ))}
        </ul>
      )}

      {uploading.length > 0 && (
        <ul className="space-y-1">
          {uploading.map((name, i) => (
            <li key={`${name}-${i}`} className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              <span className="truncate">{name}</span>
            </li>
          ))}
        </ul>
      )}

      <div
        role="button"
        tabIndex={0}
        onClick={() => !disabled && inputRef.current?.click()}
        onKeyDown={(e) => {
          if ((e.key === 'Enter' || e.key === ' ') && !disabled) {
            e.preventDefault();
            inputRef.current?.click();
          }
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          const files = Array.from(e.dataTransfer?.files ?? []);
          if (files.length > 0 && !disabled) onAddFiles(files);
        }}
        className={cn(
          'flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-md border border-dashed border-border px-4 py-5 text-center text-sm text-muted-foreground transition-colors hover:border-primary/50 hover:bg-muted/40',
          dragOver && 'border-primary bg-primary/5',
          disabled && 'pointer-events-none opacity-60',
        )}
        data-testid="rule-attachments-drop"
      >
        {attachments.length === 0 ? <Paperclip className="h-5 w-5" aria-hidden /> : <Upload className="h-5 w-5" aria-hidden />}
        <span className="font-medium text-foreground">{t('rules.files.dropTitle')}</span>
        <span className="text-micro">
          {t('rules.files.dropHint', { mb: Math.round(RULE_FILE_MAX_BYTES / (1024 * 1024)), max: RULE_FILE_MAX_COUNT })}
        </span>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={RULE_FILE_ACCEPT}
          className="hidden"
          data-testid="rule-attachments-input"
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            e.target.value = '';
            if (files.length > 0) onAddFiles(files);
          }}
        />
      </div>

      <RuleFilePreviewDialog
        file={preview ? { ...preview } : null}
        load={() => (preview ? load(preview) : Promise.reject(new Error('no file')))}
        onOpenChange={(v) => !v && setPreview(null)}
      />
    </div>
  );
}
