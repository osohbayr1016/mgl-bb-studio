import { useState } from 'react';
import { Download, Eye, Loader2, Paperclip } from 'lucide-react';

import { useLanguage } from '@/shared/i18n';
import { toast } from '@/shared/components/Toast';
import { Button } from '@/ui/button';

import { fetchRuleFile } from '../api';
import type { RuleAttachmentInfo } from '../api';
import { formatFileSize, isPreviewable, ruleFileKind, saveBlob } from '../lib/ruleFiles';
import { RuleFileIcon } from './RuleFileIcon';
import { RuleFilePreview, RuleFilePreviewDialog } from './RuleFilePreview';

/**
 * Ажилтны уншигч хуудсан дахь хавсралтын жагсаалт (одоогийн хувилбарынх).
 * `inlineFirst` — журмын бие хоосон (журам нь ганц PDF/Word файл) үед эхний
 * харагдах файлыг хуудсан дотор нь шууд нээнэ: ажилтан «уншиж танилцсан»
 * гэж баталгаажуулахын өмнө баримтыг өөрөө харж байх ёстой.
 */
export function RuleAttachmentList({
  ruleId,
  attachments,
  inlineFirst = false,
}: {
  ruleId: number;
  attachments: RuleAttachmentInfo[];
  inlineFirst?: boolean;
}) {
  const { t } = useLanguage();
  const [preview, setPreview] = useState<RuleAttachmentInfo | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  if (attachments.length === 0) return null;
  const inline = inlineFirst
    ? attachments.find((a) => isPreviewable(ruleFileKind(a.name, a.content_type)))
    : undefined;

  const download = async (a: RuleAttachmentInfo) => {
    setBusyId(a.id);
    try {
      saveBlob(await fetchRuleFile(ruleId, a.id), a.name);
    } catch (err) {
      toast.error(t('rules.files.loadFailed'), err instanceof Error ? err.message : undefined);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-3" data-testid="rule-attachments">
      <div className="flex items-center gap-2 text-sm font-medium text-foreground">
        <Paperclip className="h-4 w-4 text-muted-foreground" aria-hidden />
        {t('rules.files.title')} ({attachments.length})
      </div>
      <ul className="divide-y divide-border rounded-md border border-border">
        {attachments.map((a) => {
          const canPreview = isPreviewable(ruleFileKind(a.name, a.content_type));
          return (
            <li key={a.id} className="flex flex-wrap items-center gap-3 px-3 py-2">
              <RuleFileIcon name={a.name} className="h-5 w-5 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm text-foreground" title={a.name}>
                  {a.name}
                </div>
                <div className="text-micro text-muted-foreground">{formatFileSize(a.size)}</div>
              </div>
              <div className="flex items-center gap-1.5">
                {canPreview && (
                  <Button variant="ghost" size="sm" onClick={() => setPreview(a)} data-testid="rule-file-view">
                    <Eye className="mr-1.5 h-3.5 w-3.5" aria-hidden />
                    {t('rules.files.view')}
                  </Button>
                )}
                <Button variant="outline" size="sm" onClick={() => void download(a)} disabled={busyId === a.id}>
                  {busyId === a.id ? (
                    <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden />
                  ) : (
                    <Download className="mr-1.5 h-3.5 w-3.5" aria-hidden />
                  )}
                  {t('rules.files.download')}
                </Button>
              </div>
            </li>
          );
        })}
      </ul>

      {inline && (
        <RuleFilePreview
          key={inline.id}
          name={inline.name}
          contentType={inline.content_type}
          load={() => fetchRuleFile(ruleId, inline.id)}
        />
      )}

      <RuleFilePreviewDialog
        file={preview}
        load={() => (preview ? fetchRuleFile(ruleId, preview.id) : Promise.reject(new Error('no file')))}
        onOpenChange={(v) => !v && setPreview(null)}
      />
    </div>
  );
}
