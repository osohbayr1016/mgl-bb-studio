import { useLanguage } from '@/shared/i18n';
import { Label } from '@/ui/label';
import { Textarea } from '@/ui/textarea';
import { cn } from '@/shared/lib/utils';
import { PGP_SECTIONS, pgpSelectLabelKey, type PgpField } from './pgpFields';

interface PgpFormProps {
  answers: Record<string, string>;
  /** true бол зөвхөн харах (админ/senior тал) — засах боломжгүй. */
  readOnly?: boolean;
  onChange?: (key: string, value: string) => void;
  /** blur дээр autosave flush хийхэд (засварлах горим). */
  onBlur?: () => void;
}

/**
 * PGP маягтыг PGP_SECTIONS схемээс рендерлэнэ. `readOnly` үед утгыг текстээр
 * харуулна (админ тал), эс бөгөөс textarea/select-ээр засварлана (ажилтан).
 */
export function PgpForm({ answers, readOnly = false, onChange, onBlur }: PgpFormProps) {
  const { t } = useLanguage();

  const renderReadOnly = (field: PgpField, value: string) => {
    if (field.type === 'select') {
      const labelKey = pgpSelectLabelKey(field, value);
      const text = labelKey ? t(labelKey) : '';
      return <p className="text-sm text-foreground">{text || t('pgp.notFilled')}</p>;
    }
    return value.trim() ? (
      <p className="text-sm text-foreground whitespace-pre-wrap">{value}</p>
    ) : (
      <p className="text-sm italic text-muted-foreground">{t('pgp.notFilled')}</p>
    );
  };

  const renderEditable = (field: PgpField, value: string) => {
    if (field.type === 'select') {
      return (
        <select
          value={value}
          onChange={(e) => onChange?.(field.key, e.target.value)}
          onBlur={onBlur}
          className={cn(
            'flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none',
            'focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:bg-input/30',
          )}
        >
          {field.options?.map((o) => (
            <option key={o.value} value={o.value}>
              {t(o.labelKey)}
            </option>
          ))}
        </select>
      );
    }
    return (
      <Textarea
        value={value}
        rows={field.rows ?? 3}
        placeholder={field.placeholderKey ? t(field.placeholderKey) : ''}
        onChange={(e) => onChange?.(field.key, e.target.value)}
        onBlur={onBlur}
      />
    );
  };

  return (
    <div className="space-y-6">
      {PGP_SECTIONS.map((section) => (
        <div key={section.titleKey} className="space-y-4">
          <h4 className="text-sm font-semibold text-foreground border-b border-border/60 pb-1">
            {t(section.titleKey)}
          </h4>
          {section.fields.map((field) => {
            const value = answers[field.key] ?? '';
            return (
              <div key={field.key} className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">{t(field.labelKey)}</Label>
                {readOnly ? renderReadOnly(field, value) : renderEditable(field, value)}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
