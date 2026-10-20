import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Image as ImageIcon, Loader2, Upload, X } from 'lucide-react';
import { apiFetch, uploadFile, mediaUrl } from '@/shared/api/client';
import { useApiQuery } from '@/shared/api/useApi';
import { useLanguage } from '@/shared/i18n';
import { toast } from '@/shared/components/Toast';
import { Button } from '@/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/ui/card';

/* Per-project client logo. Stored via the app_settings-backed endpoint
 * (GET/PUT /api/projects/:id/client-logo) and rendered on report covers.
 * Self-contained: owns its own query + mutation so the big ProjectInfoTab
 * passport form doesn't have to change. */
export function ClientLogoUpload({
  projectId,
  readOnly = false,
}: {
  projectId: number;
  readOnly?: boolean;
}) {
  const { t } = useLanguage();
  const qc = useQueryClient();
  const key = ['/projects/client-logo', projectId] as const;
  const q = useApiQuery<{ logo_url: string | null }>(
    key,
    `/projects/${projectId}/client-logo`,
    { retry: false },
  );
  const logoUrl = q.data?.logo_url ?? null;
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const save = async (url: string | null) => {
    setBusy(true);
    try {
      await apiFetch<{ logo_url: string | null }>(`/projects/${projectId}/client-logo`, {
        method: 'PUT',
        data: { logo_url: url },
      });
      qc.setQueryData(key, { logo_url: url });
    } catch (e) {
      toast.error(t('clientLogo.saveFailed'), e instanceof Error ? e.message : t('common.error'));
    } finally {
      setBusy(false);
    }
  };

  const onPick = async (file: File) => {
    if (!file.type.startsWith('image/')) {
      toast.error(t('clientLogo.imageOnly'));
      return;
    }
    setBusy(true);
    try {
      const url = await uploadFile(file);
      await save(url);
      toast.success(t('clientLogo.saved'));
    } catch (e) {
      toast.error(t('clientLogo.uploadFailed'), e instanceof Error ? e.message : t('common.error'));
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">{t('clientLogo.title')}</CardTitle>
      </CardHeader>
      <CardContent className="flex items-center gap-4 flex-wrap">
        <div className="w-28 h-16 rounded border bg-muted/30 flex items-center justify-center overflow-hidden shrink-0">
          {logoUrl ? (
            <img src={mediaUrl(logoUrl)} alt="" className="max-w-full max-h-full object-contain" />
          ) : (
            <ImageIcon className="w-6 h-6 text-muted-subtle" />
          )}
        </div>
        {!readOnly && (
          <div className="flex items-center gap-2">
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void onPick(f);
                e.target.value = '';
              }}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => fileRef.current?.click()}
            >
              {busy ? (
                <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
              ) : (
                <Upload className="w-4 h-4 mr-1.5" />
              )}
              {t('clientLogo.upload')}
            </Button>
            {logoUrl && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={busy}
                onClick={() => void save(null)}
              >
                <X className="w-4 h-4 mr-1.5" /> {t('clientLogo.remove')}
              </Button>
            )}
          </div>
        )}
        <p className="text-xs text-muted-foreground basis-full sm:basis-auto">
          {t('clientLogo.hint')}
        </p>
      </CardContent>
    </Card>
  );
}
