/**
 * «Төрөл» сонгогч — ОЛОН сонголттой checkbox бүлэг.
 *
 * ЯАГААД dropdown БИШ: нэг санал ихэвчлэн хэд хэдэн ажлыг хамардаг («эскиз
 * + ажлын зураг» хамт явах нь MGL-д түгээмэл), тиймээс ганц сонголттой
 * `Select` нь баримтыг буруу ангилдаг байв (2026-08-17).
 *
 * Дор хаяж НЭГ төрөл заавал сонгогдоно — «төрөлгүй» санал жагсаалт болон
 * тайланд утгагүй. Сүүлчийн тэмдэглэгээг авах гэсэн товшилтыг үл тоомсорлоно
 * (алдааны мессеж шаардахаас илүү нам гүм).
 */
import { Check } from 'lucide-react';

import { useLanguage } from '@/shared/i18n';
import { cn } from '@/shared/lib/utils';
import { Label } from '@/ui/label';

import { QUOTE_VARIANT_KEYS, variantLabel, type QuoteVariantKey } from '../lib/quoteVariants';

export function VariantPicker({
  value,
  onChange,
  disabled = false,
  id = 'quote-variants',
}: {
  value: readonly QuoteVariantKey[];
  onChange: (next: QuoteVariantKey[]) => void;
  disabled?: boolean;
  id?: string;
}) {
  const { t } = useLanguage();

  const toggle = (key: QuoteVariantKey) => {
    if (value.includes(key)) {
      // Сүүлчийнхийг нь авахыг зөвшөөрөхгүй.
      if (value.length === 1) return;
      onChange(value.filter((k) => k !== key));
    } else {
      // Каталогийн дарааллыг хадгална — товшсон дарааллыг биш.
      onChange(QUOTE_VARIANT_KEYS.filter((k) => k === key || value.includes(k)));
    }
  };

  return (
    <div className="space-y-2">
      <Label id={`${id}-label`}>{t('quotes.col.type')}</Label>
      <div
        role="group"
        aria-labelledby={`${id}-label`}
        className="grid grid-cols-1 gap-2 sm:grid-cols-2"
      >
        {QUOTE_VARIANT_KEYS.map((key) => {
          const checked = value.includes(key);
          return (
            <button
              key={key}
              type="button"
              role="checkbox"
              aria-checked={checked}
              disabled={disabled}
              onClick={() => toggle(key)}
              className={cn(
                'flex items-center gap-2 rounded-md border px-3 py-2 text-left text-xs transition-colors',
                'focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none',
                'disabled:cursor-not-allowed disabled:opacity-50',
                checked
                  ? 'border-primary/60 bg-primary/10 text-foreground'
                  : 'border-border bg-background/40 text-foreground hover:bg-muted/40',
              )}
            >
              <span
                className={cn(
                  'flex h-4 w-4 flex-shrink-0 items-center justify-center rounded border',
                  checked ? 'border-primary bg-primary' : 'border-border',
                )}
              >
                {checked && <Check className="h-2.5 w-2.5 text-primary-foreground" />}
              </span>
              <span className="min-w-0 flex-1 whitespace-normal">{variantLabel(t, key)}</span>
            </button>
          );
        })}
      </div>
      <p className="text-micro text-muted-foreground">{t('quotes.field.typeHint')}</p>
    </div>
  );
}
