import { Monitor } from 'lucide-react';
import { useLanguage } from '@/shared/i18n';

interface DesktopOnlyNoticeProps {
  feature: string;
  description?: string;
}

/**
 * Mobile дээр гарч ирээд "компьютер дээр нээ" гэсэн зөвлөмж харуулна.
 * `lg:hidden` тул desktop рендерт ямар ч өөрчлөлт оруулахгүй.
 */
export function DesktopOnlyNotice({ feature, description }: DesktopOnlyNoticeProps) {
  const { t } = useLanguage();
  const resolvedDescription = description ?? t('desktopOnlyNotice.defaultDescription');
  return (
    <div className="lg:hidden fixed inset-0 z-[100] flex items-center justify-center bg-background p-6">
      <div className="max-w-sm space-y-4 text-center">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 text-primary">
          <Monitor className="h-7 w-7" />
        </div>
        <h2 className="text-lg font-semibold text-foreground">
          {t('desktopOnlyNotice.heading', { feature })}
        </h2>
        <p className="text-sm text-muted-foreground">{resolvedDescription}</p>
      </div>
    </div>
  );
}
