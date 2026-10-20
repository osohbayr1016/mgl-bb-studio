/**
 * «Гарах бүртгэл хийгдээгүй байна» цонх — гарах бүртгэл яагаад хийгдсэнгүйг
 * шалтгаан тус бүрээр энгийн монгол хэлээр хэлж, шийдэх товчийг өгнө.
 *
 * Эзний шаардлага (2026-10-19): бүртгэл хийгдээгүй бол шалтгаан нь ТЭР
 * агшинд харагдах ёстой — ажилтан «дарсан» гэж бодоод компьютераа унтрааж
 * явах ёсгүй.  Тиймээс гарчиг нь «хийгдээгүй» гэдгийг ил хэлж, доод мөр нь
 * үр дагаврыг (маргааш ирэх бүртгэл хаалттай) сануулна.  Шалтгааныг
 * `useClockOutFlow` → `clockOutFlow.ts` гаргана.
 */
import { AlertTriangle, FileText, ListChecks, RefreshCw, ServerCrash, UserX, WifiOff } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useLanguage } from '@/shared/i18n';
import { Button } from '@/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/ui/dialog';
import type { ClockOutBlock } from '@/features/attendance/clockOutFlow';

interface Props {
  blocks: ClockOutBlock[] | null;
  onClose: () => void;
  /** Сүлжээ/сервертэй холбоотой шалтгааны «Дахин оролдох» — `useClockOutFlow.start`. */
  onRetry: () => void;
}

type Row = {
  icon: LucideIcon;
  text: string;
  action?: { label: string; run: () => void; icon?: LucideIcon };
};

export default function ClockOutBlockedDialog({ blocks, onClose, onRetry }: Props) {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const go = (path: string) => {
    onClose();
    navigate(path);
  };
  const retry = () => {
    onClose();
    onRetry();
  };

  const rowOf = (b: ClockOutBlock): Row => {
    switch (b.kind) {
      case 'progress':
        return {
          icon: ListChecks,
          text: t('clockOutFlow.reasonProgress'),
          action: { label: t('clockOutFlow.actionMyTasks'), run: () => go('/app/my-tasks'), icon: ListChecks },
        };
      case 'pgp':
        return {
          icon: FileText,
          text: t('clockOutFlow.reasonPgp'),
          action: { label: t('clockOutFlow.actionPgp'), run: () => go('/app/profile?tab=pgp'), icon: FileText },
        };
      case 'network':
        return {
          icon: WifiOff,
          text: b.ip
            ? t('clockOutFlow.reasonNetworkIp', { ip: b.ip })
            : t('clockOutFlow.reasonNetwork'),
          action: { label: t('clockOutFlow.actionRetry'), run: retry, icon: RefreshCw },
        };
      case 'offline':
        return {
          icon: ServerCrash,
          text: t('clockOutFlow.reasonOffline'),
          action: { label: t('clockOutFlow.actionRetry'), run: retry, icon: RefreshCw },
        };
      case 'projects_unavailable':
        return {
          icon: RefreshCw,
          text: t('clockOutFlow.reasonProjects'),
          action: {
            label: t('clockOutFlow.actionReload'),
            run: () => window.location.reload(),
            icon: RefreshCw,
          },
        };
      case 'not_clocked_in':
        return { icon: UserX, text: t('clockOutFlow.reasonNotClockedIn') };
      case 'server':
        return {
          icon: AlertTriangle,
          text: b.message,
          action: { label: t('clockOutFlow.actionRetry'), run: retry, icon: RefreshCw },
        };
    }
  };

  const rows = (blocks ?? []).map(rowOf);
  const many = rows.length > 1;

  return (
    <Dialog open={!!blocks && blocks.length > 0} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg" mobileFullScreen={false}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 shrink-0 text-warning" />
            {t('clockOutFlow.blockedTitle')}
          </DialogTitle>
          <DialogDescription>
            {many ? t('clockOutFlow.blockedIntroMany') : t('clockOutFlow.blockedIntroOne')}
          </DialogDescription>
        </DialogHeader>

        <ul className="space-y-2" data-testid="clock-out-blocks">
          {rows.map((r, i) => (
            <li
              key={i}
              className="rounded-lg border border-warning/30 bg-warning/10 px-3 py-2.5"
            >
              <p className="flex items-start gap-2 text-sm leading-relaxed text-foreground">
                <r.icon className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
                <span>
                  {many ? `${i + 1}. ` : ''}
                  {r.text}
                </span>
              </p>
              {r.action && (
                <div className="mt-2 flex justify-end">
                  <Button size="sm" onClick={r.action.run} className="gap-1.5">
                    {r.action.icon && <r.action.icon className="h-4 w-4" />}
                    {r.action.label}
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>

        <p className="text-xs leading-relaxed text-muted-foreground">
          {t('clockOutFlow.blockedFooter')}
        </p>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} className="w-full sm:w-auto">
            {t('common.close')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
