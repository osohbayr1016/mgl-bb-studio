import { CheckCircle2 } from 'lucide-react';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import { Label } from '@/ui/label';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/i18n';
import { categoryLabel } from './lib';
import type { NonProjectCategoryOption } from './types';

/** Ангиллын түлхүүр → «Бусад»-ын тайлбар.  Байгаа түлхүүр = сонгогдсон. */
export type PickState = Map<string, string>;

interface Props {
  categories: NonProjectCategoryOption[];
  value: PickState;
  onChange: (next: PickState) => void;
  disabled?: boolean;
}

/**
 * Ирцийн цонхны төслийн бус ажлын СОНГОГЧ — «одоо юу хийж байна» гэдгийг л
 * тэмдэглэнэ (эзний шийдвэр 2026-09-28): цаг, «юу хийсэн» асуухгүй, цаг/хувь
 * бодогдохгүй.  Ажилтан ажлаа дуусгасны дараа «Миний ажлууд»-аас юу хийснээ,
 * цагаа оруулна.  Сонголт нь ирцийн хүсэлттэй ХАМТ (`non_project`) илгээгдэнэ —
 * энд хадгалах товч байхгүй.
 */
export default function NonProjectPicker({ categories, value, onChange, disabled = false }: Props) {
  const { t } = useLanguage();

  const toggle = (key: string) => {
    const next = new Map(value);
    if (next.has(key)) next.delete(key);
    else next.set(key, '');
    onChange(next);
  };
  const setNote = (key: string, note: string) => {
    if (!value.has(key)) return;
    const next = new Map(value);
    next.set(key, note);
    onChange(next);
  };

  const selected = categories.filter((c) => value.has(c.key));

  return (
    <div className="space-y-3" data-testid="npw-picker">
      <div className="grid gap-2 sm:grid-cols-2">
        {categories.map((c) => {
          const active = value.has(c.key);
          return (
            <Button
              key={c.key}
              type="button"
              variant="ghost"
              disabled={disabled}
              onClick={() => toggle(c.key)}
              data-category={c.key}
              aria-pressed={active}
              className={cn(
                // ⚠️ `h-auto` ганцаараа `pointer-coarse:h-11`-ийг дардаггүй (tailwind-merge).
                'h-auto justify-start gap-2 whitespace-normal rounded-lg border px-3 py-2 text-left text-sm font-normal pointer-coarse:h-auto pointer-coarse:min-h-11',
                active
                  ? 'border-info/60 bg-info/10 text-info hover:bg-info/10 hover:text-info'
                  : 'border-border bg-background/40 hover:border-info/40 hover:bg-background/40',
              )}
            >
              <span
                className={cn(
                  'flex h-5 w-5 shrink-0 items-center justify-center rounded-full border',
                  active ? 'border-info bg-info text-info-foreground' : 'border-muted-foreground/40',
                )}
              >
                {active && <CheckCircle2 className="h-3.5 w-3.5" />}
              </span>
              <span className="min-w-0 flex-1 break-words">{categoryLabel(c.key, c.label, t)}</span>
            </Button>
          );
        })}
      </div>

      {selected
        .filter((c) => c.requires_note)
        .map((c) => (
          <div key={`note-${c.key}`} className="space-y-1.5">
            <Label htmlFor={`npw-pick-note-${c.key}`} className="text-xs text-muted-foreground">
              {t('nonProjectWork.noteLabel')}
            </Label>
            <Input
              id={`npw-pick-note-${c.key}`}
              value={value.get(c.key) ?? ''}
              maxLength={500}
              disabled={disabled}
              onChange={(e) => setNote(c.key, e.target.value)}
              placeholder={t('nonProjectWork.notePlaceholder')}
              data-testid="npw-pick-note"
            />
          </div>
        ))}
    </div>
  );
}
