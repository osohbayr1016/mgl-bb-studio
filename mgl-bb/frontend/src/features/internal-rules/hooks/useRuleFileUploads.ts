import { useCallback, useRef, useState } from 'react';

import { useLanguage } from '@/shared/i18n';
import { toast } from '@/shared/components/Toast';

import { uploadRuleFile } from '../api';
import type { AdminRuleAttachment } from '../api';
import { RULE_FILE_MAX_BYTES, RULE_FILE_MAX_COUNT, isAllowedRuleFile } from '../lib/ruleFiles';

/**
 * Журмын засварлагчийн хавсралт байршуулалт — toolbar-ын 📎, засварлагч руу
 * чирсэн файл, хавсралтын картын «Файл сонгох»/drop гурвуулаа ЭНЭ нэг
 * функцээр явна.  Файл бүр дараалан `POST /internal-rules/files` → хувийн
 * bucket; амжилттай бол `onAdded` (журам нь «Хадгалах» хүртэл хуучнаараа).
 *
 * `getLocalFile` — энэ сессэд байршуулсан файлын эх `File` (R2 түлхүүрээр):
 * хадгалаагүй шинэ журамд серверийн татах зам хараахан байхгүй тул
 * урьдчилан харахад локал хувийг ашиглана.
 */
export function useRuleFileUploads({
  getCount,
  onAdded,
}: {
  getCount: () => number;
  onAdded: (attachment: AdminRuleAttachment) => void;
}) {
  const { t } = useLanguage();
  const [uploading, setUploading] = useState<string[]>([]);
  const localFiles = useRef(new Map<string, File>());

  const addFiles = useCallback(
    async (files: File[]) => {
      let count = getCount();
      for (const file of files) {
        if (!isAllowedRuleFile(file.name)) {
          toast.error(t('rules.files.typeNotAllowed', { name: file.name }), t('rules.files.allowedTypes'));
          continue;
        }
        if (file.size > RULE_FILE_MAX_BYTES) {
          toast.error(t('rules.files.tooLarge', { name: file.name, mb: Math.round(RULE_FILE_MAX_BYTES / (1024 * 1024)) }));
          continue;
        }
        if (count >= RULE_FILE_MAX_COUNT) {
          toast.warn(t('rules.files.tooMany', { max: RULE_FILE_MAX_COUNT }));
          break;
        }
        count += 1;
        setUploading((u) => [...u, file.name]);
        try {
          const att = await uploadRuleFile(file);
          localFiles.current.set(att.key, file);
          onAdded(att);
        } catch (err) {
          count -= 1;
          console.error('[rules] file upload failed', err);
          toast.error(t('rules.files.uploadFailed', { name: file.name }), err instanceof Error ? err.message : undefined);
        } finally {
          setUploading((u) => {
            const i = u.indexOf(file.name);
            return i < 0 ? u : [...u.slice(0, i), ...u.slice(i + 1)];
          });
        }
      }
    },
    [getCount, onAdded, t],
  );

  /** Энэ сессэд байршуулсан эх файл — event handler дотор л дуудна. */
  const getLocalFile = useCallback((key: string) => localFiles.current.get(key), []);

  return { uploading, addFiles, getLocalFile };
}
