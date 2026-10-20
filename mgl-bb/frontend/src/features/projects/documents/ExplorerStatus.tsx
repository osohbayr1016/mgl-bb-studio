import { useLanguage } from '@/shared/i18n';
import type { ExplorerSelection } from './types';

export function ExplorerStatus({
  count,
  selection,
}: {
  count: number;
  selection: ExplorerSelection;
}) {
  const { t } = useLanguage();
  return (
    <div className="flex h-8 items-center gap-3 border-t border-border/60 px-3 text-micro text-muted-foreground">
      <span>{t('documentsPage.itemCount', { count })}</span>
      {selection ? <span>{t('documentsPage.selectedOne')}</span> : null}
    </div>
  );
}
