/**
 * Админ: Google Drive хавтас холбох / салгах.
 *
 * Хэрэглэгддэг газрууд: «Баримт бичиг» табын «холбогдоогүй» төлөв, төслийн
 * засах цонх (`ProjectEditDialog`), үндсэн төслийн засах цонх (Documents
 * хуудас).  Хадгалах бүрт сервер Drive-аас хавтсыг ҮНЭХЭЭР уншиж
 * баталгаажуулдаг (`PUT …/drive-folder`) тул буруу id, хуваалцаагүй хавтас
 * энд л илэрнэ — таб хоосон гарахгүй.
 *
 * `scope='project'` дээр төсөл нь ҮНДСЭН ТӨСӨЛТЭЙ бол сервер холбоосыг үндсэн
 * төсөлд бичдэг (AZ/ZA хоёулаа нэг хавтас) — маягт үүнийг ил хэлнэ.
 *
 * Хуваалцах хаяг (service account-ийн email) нь нууц биш; админ хавтсаа тэр
 * хаягтай «Үзэгч» эрхээр хуваалцана.  Нууц түлхүүр хөтөчид хэзээ ч ирэхгүй.
 */
import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Check, Copy, ExternalLink, FolderOpen, Link2, Loader2, Unlink } from 'lucide-react';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import { toast } from '@/shared/components/Toast';
import { useLanguage } from '@/shared/i18n';
import { setDriveFolder } from './api';
import { describeDriveError } from './driveErrors';
import type { DriveScope } from './types';
import { useDriveStatus } from './useDriveFolder';

export function DriveFolderForm({
  scope,
  id,
  onLinked,
  compact = false,
}: {
  scope: DriveScope;
  id: number;
  /** Холбосон/салгасны дараа — дуудагч мэдээллээ дахин уншина. */
  onLinked?: () => void | Promise<void>;
  /** Засах цонх дотор — гарчиггүй, нягт хэлбэр. */
  compact?: boolean;
}) {
  const { t } = useLanguage();
  const qc = useQueryClient();
  const status = useDriveStatus(scope, id);
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState<'link' | 'unlink' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const linked = status.data?.linked ?? false;
  const serviceEmail = status.data?.service_email ?? null;
  const configured = status.data?.configured ?? true;
  const mainName = scope === 'project' ? (status.data?.main_project_name ?? null) : null;

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(t);
  }, [copied]);

  const invalidate = async () => {
    // Төлөв, жагсаалт, үндсэн төслийн хуудас — бүгд `project-drive` угтвартай.
    await qc.invalidateQueries({ queryKey: ['project-drive'] });
    await onLinked?.();
  };

  const link = async () => {
    const folder = value.trim();
    if (!folder) return;
    setBusy('link');
    setError(null);
    try {
      const res = await setDriveFolder(scope, id, folder);
      toast.success(t('projectDrive.linkedToast', { name: res.folder_name ?? '' }));
      setValue('');
      await invalidate();
    } catch (err) {
      setError(t(describeDriveError(err).key));
    } finally {
      setBusy(null);
    }
  };

  const unlink = async () => {
    setBusy('unlink');
    setError(null);
    try {
      await setDriveFolder(scope, id, null);
      toast.success(t('projectDrive.unlinkedToast'));
      await invalidate();
    } catch (err) {
      setError(t(describeDriveError(err).key));
    } finally {
      setBusy(null);
    }
  };

  const copyEmail = async () => {
    if (!serviceEmail) return;
    try {
      await navigator.clipboard.writeText(serviceEmail);
      setCopied(true);
    } catch {
      /* clipboard хаалттай орчин — хэрэглэгч гараар хуулна */
    }
  };

  if (status.isLoading) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> {t('common.loading')}
      </div>
    );
  }

  return (
    <div className={compact ? 'space-y-2' : 'space-y-3'}>
      {!compact && <p className="text-sm text-muted-foreground">{t('projectDrive.linkIntro')}</p>}

      {mainName && (
        <p className="rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-xs text-foreground">
          {t('projectDrive.linksToMain', { name: mainName })}
        </p>
      )}

      {!configured ? (
        <p className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-foreground">
          {t('projectDrive.errNotConfigured')}
        </p>
      ) : (
        <>
          {linked && status.data && (
            <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-muted/30 px-3 py-2 text-sm">
              <FolderOpen className="h-4 w-4 shrink-0 text-primary" />
              <span className="min-w-0 truncate font-medium">{status.data.folder_name ?? status.data.folder_id}</span>
              <span className="truncate font-mono text-[11px] text-muted-foreground">{status.data.folder_id}</span>
              {status.data.folder_id && (
                <Button size="xs" variant="ghost" asChild>
                  <a
                    href={`https://drive.google.com/drive/folders/${status.data.folder_id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <ExternalLink className="h-3 w-3" /> {t('projectDrive.openInDrive')}
                  </a>
                </Button>
              )}
              <Button
                size="xs"
                variant="ghost"
                className="ml-auto text-destructive hover:text-destructive"
                onClick={unlink}
                disabled={busy !== null}
              >
                {busy === 'unlink' ? <Loader2 className="h-3 w-3 animate-spin" /> : <Unlink className="h-3 w-3" />}
                {t('projectDrive.unlink')}
              </Button>
            </div>
          )}

          <div className="space-y-1.5">
            <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              {linked ? t('projectDrive.changeFolderLabel') : t('projectDrive.folderLabel')}
            </label>
            <div className="flex gap-2">
              <Input
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder={t('projectDrive.folderPlaceholder')}
                spellCheck={false}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    void link();
                  }
                }}
              />
              <Button onClick={link} disabled={busy !== null || value.trim().length === 0}>
                {busy === 'link' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />}
                {linked ? t('projectDrive.relink') : t('projectDrive.link')}
              </Button>
            </div>
            {error && <p className="text-xs text-destructive">{error}</p>}
          </div>

          {serviceEmail && (
            <div className="rounded-md border border-dashed border-border px-3 py-2 text-xs text-muted-foreground">
              <p>{t('projectDrive.shareHint')}</p>
              <div className="mt-1 flex items-center gap-2">
                <code className="min-w-0 truncate rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-foreground">
                  {serviceEmail}
                </code>
                <Button size="icon-xs" variant="ghost" onClick={copyEmail} title={t('common.copy')}>
                  {copied ? <Check className="h-3 w-3 text-success" /> : <Copy className="h-3 w-3" />}
                </Button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
