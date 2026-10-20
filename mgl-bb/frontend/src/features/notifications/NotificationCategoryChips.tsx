import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/i18n';
import { NOTIFICATION_UI_CATEGORIES, UI_CATEGORY_I18N, type UiCategory } from './notificationCategories';

type Props = {
  value: UiCategory;
  onChange: (next: UiCategory) => void;
};

export function NotificationCategoryChips({ value, onChange }: Props) {
  const { t } = useLanguage();

  return (
    <div className="flex gap-1.5 overflow-x-auto pb-0.5 snap-x snap-mandatory scroll-px-1 [scrollbar-width:thin]">
      {NOTIFICATION_UI_CATEGORIES.map((cat) => (
        <button
          key={cat}
          type="button"
          onClick={() => onChange(cat)}
          className={cn(
            'shrink-0 snap-start px-3 py-1.5 text-xs font-medium rounded-full border transition-colors',
            value === cat
              ? 'bg-primary text-primary-foreground border-primary'
              : 'bg-background text-muted-foreground border-border hover:text-foreground',
          )}
        >
          {t(UI_CATEGORY_I18N[cat])}
        </button>
      ))}
    </div>
  );
}
