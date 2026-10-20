/**
 * Админ: төслийн үндэс хавтасны «холбоостой хэн ч» эрх (Google Drive-ын
 * `anyone` permission).  Эзний 2026-09-15-ны шийдвэр: ERP дотор зөвхөн senior
 * харна, харин Drive дээр холбоостой хэн ч (Google акаунтгүй гүйцэтгэгч ч)
 * ЗАСВАРЛАЖ болно — систем хадгалагдсан хувилбар бүрийг өөртөө хуулбарлаж
 * авдаг тул буруу засварыг буцаах боломжтой.
 *
 * Хавтас дээр тавьсан эрх бүх дэд хавтас, файлд өвлөгдөнө.  Сервер SA-ийн
 * бичих scope-оор тавьдаг тул хавтас SA-д «Засварлагч» эрхээр хуваалцагдсан
 * байх ёстой — «Үзэгч» бол Google 403 өгнө (тайлбар доор).
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Globe, Loader2, Lock } from 'lucide-react';
import { Button } from '@/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/ui/select';
import { confirmDialog } from '@/shared/components/ConfirmDialog';
import { toast } from '@/shared/components/Toast';
import { useLanguage } from '@/shared/i18n';
import { driveSharingKey, fetchDriveSharing, setDriveSharing } from './api';
import { describeDriveError } from './driveErrors';
import type { DriveAnyoneRole, DriveScope } from './types';

const NONE = 'none';
type Choice = DriveAnyoneRole | typeof NONE;

export function DriveSharingForm({ scope, id }: { scope: DriveScope; id: number }) {
  const { t } = useLanguage();
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: driveSharingKey(scope, id),
    queryFn: () => fetchDriveSharing(scope, id),
    staleTime: 30_000,
    retry: false,
  });

  const mutation = useMutation({
    mutationFn: (role: DriveAnyoneRole | null) => setDriveSharing(scope, id, role),
    onSuccess: (state) => {
      qc.setQueryData(driveSharingKey(scope, id), state);
      toast.success(t(state.anyone ? 'projectDrive.sharingSavedOn' : 'projectDrive.sharingSavedOff'));
    },
    onError: (err) => toast.error(t(describeDriveError(err).key)),
  });

  const current: Choice = q.data?.anyone ?? NONE;

  const change = async (next: Choice) => {
    if (next === current) return;
    if (next === 'writer') {
      const ok = await confirmDialog({
        title: t('projectDrive.sharingConfirmTitle'),
        description: t('projectDrive.sharingConfirmWriter'),
        confirmText: t('projectDrive.sharingEnable'),
        variant: 'destructive',
      });
      if (!ok) return;
    }
    mutation.mutate(next === NONE ? null : next);
  };

  if (q.isPending) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> {t('common.loading')}
      </div>
    );
  }
  if (q.isError) {
    return (
      <div className="space-y-1 text-xs">
        <p className="text-destructive">{t(describeDriveError(q.error).key)}</p>
        <p className="text-muted-foreground">{t('projectDrive.sharingNeedsEditor')}</p>
        <Button size="xs" variant="ghost" onClick={() => void q.refetch()}>
          {t('common.retry')}
        </Button>
      </div>
    );
  }

  const isOpen = current !== NONE;
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        {isOpen ? <Globe className="h-4 w-4 text-warning" /> : <Lock className="h-4 w-4 text-muted-foreground" />}
        <span className="text-sm font-medium text-foreground">{t('projectDrive.sharingLabel')}</span>
        <Select value={current} onValueChange={(v) => void change(v as Choice)} disabled={mutation.isPending}>
          <SelectTrigger className="h-8 w-56 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>{t('projectDrive.sharingNone')}</SelectItem>
            <SelectItem value="reader">{t('projectDrive.sharingReader')}</SelectItem>
            <SelectItem value="commenter">{t('projectDrive.sharingCommenter')}</SelectItem>
            <SelectItem value="writer">{t('projectDrive.sharingWriter')}</SelectItem>
          </SelectContent>
        </Select>
        {mutation.isPending && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
      </div>
      <p className="text-xs text-muted-foreground">
        {isOpen ? t('projectDrive.sharingOpenNote') : t('projectDrive.sharingClosedNote')}
      </p>
      {current === 'writer' && (
        <p className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-foreground">
          {t('projectDrive.sharingWriterWarning')}
        </p>
      )}
    </div>
  );
}
