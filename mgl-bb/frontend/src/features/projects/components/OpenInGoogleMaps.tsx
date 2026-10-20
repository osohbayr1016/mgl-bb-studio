/* «Google Maps дээр нээх» / «Зам заах» — төслийн байршлыг НЭГ товчоор нээх.
 *
 * href-ийн дүрэм бүхэлдээ `shared/lib/mapsLink.ts` (пин → буулгасан
 * холбоос → хаягаар хайх); энэ компонент зөвхөн зурна.  `target="_blank"`
 * + `rel="noopener noreferrer"`: PWA (standalone) дотор ч системийн
 * хөтөч/Google Maps апп руу гарна, ERP таб хэвээр үлдэнэ.  Android дээр
 * `google.com/maps/...` нь Maps апп-ын intent, iOS дээр universal link —
 * төхөөрөмж тус бүрд өөр URL хэрэггүй. */
import { ExternalLink, Navigation } from 'lucide-react';
import { Button } from '@/ui/button';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/i18n';
import {
  projectDirectionsHref,
  projectMapsHref,
  type ProjectLocationLike,
} from '@/shared/lib/mapsLink';

interface Props {
  project: ProjectLocationLike;
  /** `buttons` — хоёр outline товч (Мэдээлэл таб); `overlay` — газрын зураг
   *  дээрх хар хагас тунгалаг жижиг товч; `toolbar` — газрын зургийн хар
   *  toolbar ДОТОРХ ghost товч (өөрийн дэвсгэргүй); `inline` — бичвэрийн
   *  доторх холбоос. */
  variant?: 'buttons' | 'overlay' | 'toolbar' | 'inline';
  className?: string;
}

export function OpenInGoogleMaps({ project, variant = 'buttons', className }: Props) {
  const { t } = useLanguage();
  const open = projectMapsHref(project);
  if (!open) return null;
  const dir = projectDirectionsHref(project);
  const hint =
    open.kind === 'pin'
      ? t('projectMap.openHintPin')
      : open.kind === 'link'
        ? t('projectMap.openHintLink')
        : t('projectMap.openHintAddress');

  if (variant === 'inline') {
    return (
      <a
        href={open.href}
        target="_blank"
        rel="noopener noreferrer"
        title={hint}
        data-maps-kind={open.kind}
        className={cn('inline-flex items-center gap-1 underline-offset-2 hover:underline', className)}
      >
        {t('projectMap.openInGoogleMaps')}
        <ExternalLink className="h-3 w-3" />
      </a>
    );
  }

  if (variant === 'overlay' || variant === 'toolbar') {
    return (
      <Button
        asChild
        size="sm"
        variant="ghost"
        className={cn(
          'h-7 px-2 gap-1 rounded-md text-white hover:text-white',
          variant === 'overlay'
            ? 'bg-slate-900/80 backdrop-blur-sm border border-white/10 shadow-lg hover:bg-slate-900/90'
            : 'hover:bg-white/10',
          className,
        )}
      >
        <a
          href={open.href}
          target="_blank"
          rel="noopener noreferrer"
          title={hint}
          data-maps-kind={open.kind}
        >
          <ExternalLink className="h-3.5 w-3.5" />
          <span className="text-micro font-medium">Google Maps</span>
        </a>
      </Button>
    );
  }

  return (
    <div className={cn('flex flex-wrap items-center gap-1.5', className)}>
      <Button asChild size="xs" variant="outline" className="gap-1">
        <a
          href={open.href}
          target="_blank"
          rel="noopener noreferrer"
          title={hint}
          data-maps-kind={open.kind}
        >
          <ExternalLink className="h-3 w-3" />
          {t('projectMap.openInGoogleMaps')}
        </a>
      </Button>
      {dir && (
        <Button asChild size="xs" variant="ghost" className="gap-1 text-muted-foreground">
          <a href={dir} target="_blank" rel="noopener noreferrer" title={t('projectMap.directionsHint')}>
            <Navigation className="h-3 w-3" />
            {t('projectMap.directions')}
          </a>
        </Button>
      )}
      {open.kind === 'address' && (
        <span className="text-micro text-muted-foreground">{t('projectMap.openHintAddress')}</span>
      )}
    </div>
  );
}

export default OpenInGoogleMaps;
