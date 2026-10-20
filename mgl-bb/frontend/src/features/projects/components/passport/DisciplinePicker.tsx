/* =============================================================
 * «Discipline / Ажлын хэсэг» — 1.1-ийн checkbox мөр.
 * -------------------------------------------------------------
 * ProjectInfoTab-аас САЛГАЖ авав: төсөл ҮҮСГЭХ шидтэн ч мөн адил
 * энэ мөрийг харуулах ёстой бөгөөд хоёр газарт хуулбарлавал
 * жагсаалт нь зөрнө (эзний шийдвэрээр 10 код хэвээр).
 * ============================================================= */

import { Check } from 'lucide-react';
import { useLanguage } from '@/shared/i18n';
import { Label } from '@/ui/label';
import { PASSPORT_DISCIPLINES } from './passportSections';

export function DisciplinePicker({
  value,
  onChange,
  readOnly = false,
  label,
}: {
  value: string[];
  onChange: (next: string[]) => void;
  readOnly?: boolean;
  label?: string;
}) {
  const { t } = useLanguage();
  const toggle = (code: string) => {
    if (readOnly) return;
    onChange(value.includes(code) ? value.filter((c) => c !== code) : [...value, code]);
  };

  return (
    <div>
      <Label className="text-xs flex items-center gap-1.5 mb-2">
        {label ?? t('projectInfoTab.disciplinesLabel')}
      </Label>
      <div className="flex flex-wrap gap-2">
        {PASSPORT_DISCIPLINES.map((d) => {
          const on = value.includes(d.code);
          return (
            <button
              key={d.code}
              type="button"
              disabled={readOnly}
              onClick={() => toggle(d.code)}
              className={
                on
                  ? 'inline-flex items-center gap-1.5 rounded-full border border-primary/40 bg-primary/10 px-3 py-1 text-micro font-medium text-primary disabled:cursor-default'
                  : 'inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-3 py-1 text-micro text-muted-foreground hover:text-foreground hover:border-primary/40 disabled:cursor-default disabled:hover:border-border disabled:hover:text-muted-foreground'
              }
            >
              {on && <Check className="w-3 h-3" />}
              <span className="font-mono text-micro opacity-70">{d.code}</span>
              <span>{t(`projectInfoTab.discipline.${d.code}`)}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
