import { SearchCode } from 'lucide-react';

import { useLanguage } from '@/shared/i18n';
import { cn } from '@/shared/lib/utils';
import { fmtNum } from '../../lib/pivots';

import type { QtoDashboardFile } from '../../lib/types';

export interface DisciplineGroup {
  label: string;
  files: QtoDashboardFile[];
}

/**
 * Файлын toggle chip-үүд — САЛБАРААР бүлэглэгдсэн (БА / ББ / Интерьер / ХАС /
 * ЦБУ / ЦАХ / ХД / АУ...). Chip дарахад нэгтгэлээс хасна/нэмнэ (client-side,
 * refetch-гүй); «Дэлгэрэнгүй» icon нь тухайн run-ы type-түвшний pivot руу
 * (Ангилал таб) үсэргэнэ.
 */
export function FileChips({
  groups,
  excluded,
  onToggle,
  onDrill,
  labelOf,
}: {
  groups: DisciplineGroup[];
  excluded: Set<number>;
  onToggle: (runId: number) => void;
  onDrill: (runId: number) => void;
  labelOf: (f: QtoDashboardFile) => string;
}) {
  const { t } = useLanguage();

  return (
    <div className="space-y-2">
      {groups.map((group) => (
        <div key={group.label} className="flex flex-wrap items-center gap-1.5">
          <span className="w-24 shrink-0 text-xs font-semibold text-muted-foreground">
            {group.label}
          </span>
          {group.files.map((f) => {
            const off = excluded.has(f.run_id);
            return (
              <span
                key={f.run_id}
                className={cn(
                  'inline-flex items-center gap-1 rounded-full border py-1 pl-3 pr-1.5 text-xs transition-colors',
                  off
                    ? 'border-dashed text-muted-foreground opacity-60'
                    : 'border-primary/40 bg-primary/10 text-foreground',
                )}
              >
                <button
                  type="button"
                  onClick={() => onToggle(f.run_id)}
                  className="max-w-[14rem] truncate font-medium"
                  title={f.file_name ?? undefined}
                >
                  {labelOf(f)}
                </button>
                <span className="tabular-nums text-muted-foreground">
                  · {fmtNum(f.element_count, 0)}
                </span>
                <button
                  type="button"
                  onClick={() => onDrill(f.run_id)}
                  title={t('qtoPage.dashDrill')}
                  className="rounded-full p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  <SearchCode className="h-3.5 w-3.5" />
                </button>
              </span>
            );
          })}
        </div>
      ))}
      <p className="text-xs text-muted-foreground">{t('qtoPage.dashFilterHint')}</p>
    </div>
  );
}
