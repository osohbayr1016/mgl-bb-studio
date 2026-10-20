import { useRef, useState } from 'react';
import { Camera, ImagePlus, Loader2, RefreshCw, X } from 'lucide-react';
import { mediaUrl, uploadFile } from '@/shared/api/client';
import { toast } from '@/shared/components/Toast';
import { useLanguage } from '@/shared/i18n';
import { downscaleImage, UnsupportedImageError } from '@/shared/lib/imageDownscale';
import { Button } from '@/ui/button';
import {
  useAsrCompanionRedBook,
  useAsrCompanionRedBookRevoke,
  useAsrCompanionRedBookVerify,
} from './api';
import type { AsrReport } from './types';

/** Нэг хамт явсан хүний улаан дэвтрийн зураг. */
export function AsrCompanionPhoto({
  entry,
  userId,
  photoUrl,
  verified,
  canAttach,
  canReview,
  onChanged,
}: {
  entry: AsrReport;
  userId: number;
  photoUrl: string | null;
  verified: boolean;
  canAttach: boolean;
  canReview: boolean;
  onChanged?: (id: number) => void;
}) {
  const { t } = useLanguage();
  const photo = useAsrCompanionRedBook();
  const verify = useAsrCompanionRedBookVerify();
  const revoke = useAsrCompanionRedBookRevoke();
  const [uploading, setUploading] = useState(false);
  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);
  const busy = uploading || photo.isPending || verify.isPending || revoke.isPending;

  const attach = async (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const url = await uploadFile(await downscaleImage(file));
      await photo.mutateAsync({ id: entry.id, user_id: userId, photo_url: url });
      onChanged?.(entry.id);
    } catch (err) {
      const msg = err instanceof UnsupportedImageError ? t('asr.unsupportedImage') : t('asr.saveFailed');
      toast.error(msg);
    } finally {
      setUploading(false);
    }
  };

  const clear = () => {
    void photo.mutateAsync({ id: entry.id, user_id: userId, photo_url: null }).then(() => onChanged?.(entry.id));
  };

  const canEdit = canAttach && !verified;

  return (
    <div className="space-y-2">
      {/* Файл сонгогч — хавсаргах БА солих хоёулаа (зураг байхад ч render-лэгдэнэ). */}
      {canEdit && (
        <>
          <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => { void attach(e.target.files); e.target.value = ''; }} />
          <input ref={galleryRef} type="file" accept="image/*" className="hidden" onChange={(e) => { void attach(e.target.files); e.target.value = ''; }} />
        </>
      )}
      {photoUrl && (
        <img
          src={mediaUrl(photoUrl)}
          alt=""
          className={'max-h-48 w-full rounded-md border object-contain' + (uploading ? ' opacity-50' : '')}
        />
      )}
      {canEdit && !photoUrl && (
        <div className="flex gap-2">
          <Button type="button" variant="outline" size="sm" className="flex-1 gap-2" disabled={busy} onClick={() => cameraRef.current?.click()}>
            {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />}
            {t('asr.camera')}
          </Button>
          <Button type="button" variant="outline" size="sm" className="flex-1 gap-2" disabled={busy} onClick={() => galleryRef.current?.click()}>
            <ImagePlus className="h-4 w-4" /> {t('asr.gallery')}
          </Button>
        </div>
      )}
      {/* Зураг байвал ШУУД солих — устгаад дахин оруулах шаардлагагүй. */}
      {canEdit && photoUrl && (
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" size="sm" className="flex-1 gap-2" disabled={busy} onClick={() => cameraRef.current?.click()}>
            {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />}
            {t('asr.photoReplaceCamera')}
          </Button>
          <Button type="button" variant="outline" size="sm" className="flex-1 gap-2" disabled={busy} onClick={() => galleryRef.current?.click()}>
            <RefreshCw className="h-4 w-4" /> {t('asr.photoReplace')}
          </Button>
          <Button type="button" variant="ghost" size="sm" className="gap-1.5 text-danger" disabled={busy} onClick={clear}>
            <X className="h-3.5 w-3.5" /> {t('asr.photoRemove')}
          </Button>
        </div>
      )}
      {canReview && entry.status !== 'draft' && !verified && (
        <Button type="button" size="sm" disabled={busy || !photoUrl} onClick={() => void verify.mutateAsync({ id: entry.id, user_id: userId }).then(() => onChanged?.(entry.id))}>
          {t('asr.redBookVerify')}
        </Button>
      )}
      {canReview && verified && (
        <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => void revoke.mutateAsync({ id: entry.id, user_id: userId }).then(() => onChanged?.(entry.id))}>
          {t('asr.redBookRevoke')}
        </Button>
      )}
    </div>
  );
}
