/** Key image tile in the project hero, with the admin-only upload control.
 *  Extracted from `ProjectDetailPage.tsx` when that file was split into
 *  per-component modules — the upload handler moved in with the markup it
 *  belongs to, but the behaviour is unchanged. */
import { useState } from 'react';
import { ImagePlus, Loader2, Upload } from 'lucide-react';

import { apiFetch, MEDIA_BASE_URL, uploadFile } from '@/shared/api/client';
import { toast } from '@/shared/components/Toast';
import { useLanguage } from '@/shared/i18n';

export function ProjectKeyImage({
  projectId,
  keyImageUrl,
  isAdmin,
  onUploaded,
}: {
  projectId: number;
  keyImageUrl: string | null | undefined;
  isAdmin: boolean;
  onUploaded: () => Promise<void> | void;
}) {
  const { t } = useLanguage();
  const [uploading, setUploading] = useState(false);

  const handlePick = async (file: File | undefined) => {
    if (!file || !isAdmin || uploading) return;
    if (!file.type.startsWith('image/')) {
      toast.error(t('projectDetailPage.imageOnly'));
      return;
    }
    setUploading(true);
    try {
      const url = await uploadFile(file);
      await apiFetch(`/projects/${projectId}`, {
        method: 'PUT',
        data: { key_image_url: url },
      });
      await onUploaded();
      toast.success(t('projectDetailPage.keyImageUpdated'));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('projectDetailPage.imageSaveFailed'));
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="w-full lg:w-[260px] shrink-0">
      <div className="relative overflow-hidden rounded-lg border border-border/60 bg-muted/30 aspect-[16/9]">
        {keyImageUrl ? (
          <img
            src={`${MEDIA_BASE_URL}${keyImageUrl}`}
            alt={t('projectDetailPage.keyImageAlt')}
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="h-full w-full flex flex-col items-center justify-center text-center px-4 text-muted-foreground">
            <ImagePlus className="w-8 h-8 mb-2 opacity-60" />
            <div className="text-xs font-medium">{t('projectDetailPage.keyImageTitle')}</div>
            <div className="text-[10px] mt-0.5">{t('projectDetailPage.keyImageHint')}</div>
          </div>
        )}
        {isAdmin && (
          <label className="absolute bottom-2 right-2">
            <input
              type="file"
              accept="image/*"
              className="hidden"
              disabled={uploading}
              onChange={(e) => {
                void handlePick(e.target.files?.[0]);
                e.currentTarget.value = '';
              }}
            />
            <span className="inline-flex h-7 items-center gap-1.5 rounded-md bg-background/90 border border-border px-2 text-[11px] font-medium shadow-sm cursor-pointer hover:bg-background">
              {uploading ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : (
                <Upload className="w-3 h-3" />
              )}
              {t('projectDetailPage.upload')}
            </span>
          </label>
        )}
      </div>
    </div>
  );
}

export default ProjectKeyImage;
