import { Link } from 'react-router-dom';
import { Compass } from 'lucide-react';

import { useLanguage } from '@/shared/i18n';
import { cn } from '@/shared/lib/utils';
import { Button } from '@/ui/button';

/**
 * 404. Өмнө нь аппад ямар ч catch-all маршрут байгаагүй тул таарахгүй
 * замд React ЮУ Ч рендерддэггүй байсан — хэрэглэгч бүрэн хоосон дэлгэц
 * хараад гацдаг байв.
 *
 * Хоёр байрлалд хэрэглэгдэнэ:
 *  · `/app/*` доторх catch-all — `inShell` (Layout доторх, зайг багасгана)
 *  · дээд түвшний `*` — бүтэн дэлгэц
 */
export function NotFoundPage({ inShell }: { inShell?: boolean }) {
  const { t } = useLanguage();
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-4 px-6 text-center',
        inShell ? 'py-20' : 'min-h-dvh',
      )}
    >
      <Compass className="h-10 w-10 text-muted-subtle" aria-hidden />
      <div className="space-y-1">
        <p className="text-title text-foreground">{t('notFound.title')}</p>
        <p className="text-body max-w-sm text-muted-foreground">{t('notFound.body')}</p>
      </div>
      <Button asChild size="sm" variant="outline">
        <Link to={inShell ? '/app' : '/'}>
          {inShell ? t('notFound.backToApp') : t('notFound.backHome')}
        </Link>
      </Button>
    </div>
  );
}
