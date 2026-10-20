import type { LucideIcon } from 'lucide-react';
import { Building2, HardHat, PencilRuler, ShieldCheck, Video } from 'lucide-react';
import { useLanguage } from '@/shared/i18n';
import { Button } from '@/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/ui/dialog';
import { ASR_REPORT_TYPES, REPORT_TYPE_KEY, type AsrReportType } from './types';

const ICON: Record<AsrReportType, LucideIcon> = {
  site: HardHat,
  online: Video,
  drawing_change: PencilRuler,
  office: Building2,
};

/** Сонголт бүрийн доорх тайлбарын i18n түлхүүр. */
const HINT_KEY: Record<AsrReportType, string> = {
  site: 'asr.type.siteHint',
  online: 'asr.type.onlineHint',
  drawing_change: 'asr.type.drawingChangeHint',
  office: 'asr.type.officeHint',
};

/**
 * «Шинэ тайлан»-гийн ЭХНИЙ алхам — тайлангийн төрөл (миграц 0362, эзний
 * шийдвэр 2026-09-29).  Нэг тайлан ЯГ НЭГ төрөлтэй.
 *
 * Дараагийн алхмыг төрөл шийднэ (`useAsrSafetyGate`): «Талбайн хяналт» бол
 * ХАБ-ын танилцсан баталгаа → засварлагч; бусад гурав нь шууд засварлагч.
 * Тиймээс энэ цонх ХАБ-ын цонхноос ӨМНӨ — талбайд очоогүй хүнээс гарын
 * үсэг авах утгагүй.
 */
export function AsrReportTypeDialog({
  open,
  onOpenChange,
  onPicked,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onPicked: (type: AsrReportType) => void;
}) {
  const { t } = useLanguage();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg" data-testid="asr-type-dialog">
        <DialogHeader>
          <DialogTitle>{t('asr.type.pickTitle')}</DialogTitle>
          <DialogDescription>{t('asr.type.pickHint')}</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {ASR_REPORT_TYPES.map((type) => {
            const Icon = ICON[type];
            return (
              <Button
                key={type}
                type="button"
                variant="outline"
                onClick={() => onPicked(type)}
                data-testid={`asr-type-${type}`}
                className="h-auto flex-col items-start gap-1.5 whitespace-normal px-4 py-3 text-left pointer-coarse:h-auto"
              >
                <span className="flex items-center gap-2 text-sm font-semibold">
                  <Icon className="h-5 w-5 shrink-0 text-primary" aria-hidden />
                  {t(REPORT_TYPE_KEY[type])}
                </span>
                <span className="text-xs font-normal leading-snug text-muted-foreground">
                  {t(HINT_KEY[type])}
                </span>
                {type === 'site' && (
                  <span className="inline-flex items-center gap-1 text-micro font-normal text-muted-foreground">
                    <ShieldCheck className="h-3.5 w-3.5 shrink-0" aria-hidden />
                    {t('asr.type.siteSafetyNote')}
                  </span>
                )}
              </Button>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}
