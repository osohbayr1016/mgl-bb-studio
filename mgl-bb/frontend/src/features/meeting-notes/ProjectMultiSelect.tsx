import { useMemo, useState } from 'react';
import { Check, ChevronsUpDown, Search, X } from 'lucide-react';
import { Badge } from '@/ui/badge';
import { Button } from '@/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/ui/popover';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/i18n';
import type { MeetingProjectRef } from './types';

/**
 * Хурлын олон төслийн сонгогч — popover дотор хайлттай checkbox жагсаалт,
 * сонгосон нь чип болж харагдана (setup-ийн AssigneePicker-ийн загвар).
 * Дараалал хадгалагдана: эхний сонгосон нь «үндсэн» төсөл (сервер
 * `meetings.project_id` тусгалд бичдэг).
 */
export function ProjectMultiSelect({
  projects,
  value,
  onChange,
  disabled,
}: {
  projects: MeetingProjectRef[];
  value: number[];
  onChange: (next: number[]) => void;
  disabled?: boolean;
}) {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');

  const byId = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects]);
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return projects;
    return projects.filter((p) => p.name.toLowerCase().includes(needle));
  }, [projects, q]);

  const toggle = (id: number) =>
    onChange(value.includes(id) ? value.filter((v) => v !== id) : [...value, id]);

  return (
    <div className="space-y-2">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            disabled={disabled}
            className="w-full justify-between font-normal"
            data-testid="meeting-project-select"
          >
            <span className="truncate text-left">
              {value.length === 0
                ? t('meetingNotes.selectProjects')
                : t('meetingNotes.projectsSelected', { count: value.length })}
            </span>
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" sideOffset={4} className="w-[var(--radix-popover-trigger-width)] min-w-64 p-0 overflow-hidden">
          <div className="flex items-center gap-2 border-b border-border px-3 py-2">
            <Search className="h-4 w-4 text-muted-foreground" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={t('common.search')}
              className="h-7 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
              autoFocus
            />
          </div>
          <ul className="max-h-64 overflow-y-auto py-1" role="listbox" aria-multiselectable>
            {filtered.length === 0 && (
              <li className="px-3 py-2 text-sm text-muted-foreground">{t('common.noResults')}</li>
            )}
            {filtered.map((p) => {
              const checked = value.includes(p.id);
              return (
                <li key={p.id}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={checked}
                    onClick={() => toggle(p.id)}
                    className={cn(
                      'flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-accent',
                      checked && 'bg-accent/50',
                    )}
                  >
                    {/* Сонголтын мөр өөрөө <button> тул дотор нь Radix Checkbox
                        (мөн <button>) тавьж болохгүй — энгийн дүрс. */}
                    <span
                      aria-hidden
                      className={cn(
                        'flex h-4 w-4 shrink-0 items-center justify-center rounded-sm border border-primary',
                        checked ? 'bg-primary text-primary-foreground' : 'bg-background',
                      )}
                    >
                      {checked && <Check className="h-3 w-3" />}
                    </span>
                    <span className="flex-1 truncate">{p.name}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </PopoverContent>
      </Popover>

      {value.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {value.map((id, i) => {
            const p = byId.get(id);
            return (
              <Badge key={id} variant={i === 0 ? 'default' : 'secondary'} className="gap-1 pr-1">
                <span className="max-w-[220px] truncate">{p?.name ?? `#${id}`}</span>
                {!disabled && (
                  <button
                    type="button"
                    className="rounded-full p-0.5 hover:bg-background/30"
                    onClick={() => toggle(id)}
                    aria-label={t('common.delete')}
                  >
                    <X className="h-3 w-3" />
                  </button>
                )}
              </Badge>
            );
          })}
        </div>
      )}
    </div>
  );
}
