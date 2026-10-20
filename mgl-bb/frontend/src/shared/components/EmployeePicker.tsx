import { useMemo, useRef, useState } from 'react';
import { Search, X, Check } from 'lucide-react';
import { Popover, PopoverAnchor, PopoverContent } from '@/ui/popover';
import { Input } from '@/ui/input';
import { Avatar, AvatarFallback, AvatarImage } from '@/ui/avatar';
import { Badge } from '@/ui/badge';
import { mediaUrl } from '@/shared/api/client';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/i18n';
import { teamChipClass } from '@/shared/lib/team-colors';
import { formatDisplayName } from '@/shared/lib/formatting';
import { findHighlight } from '@/shared/lib/search/rank';
import { rankUsers, type PickableUser } from '@/shared/lib/search/rankUsers';

/**
 * Ажилтан сонгогч — Хэрэглэгчид хуудасны «50 хүнийг нэг хүснэгтэд» гэсэн
 * асуудлын хариу.  Нэр / баг / албан тушаал / кодоор бичихэд (кирилл, латин
 * аль ч бичиглэлээр) ≤ `limit` мөр л гарна, ↑↓ Enter Esc ажиллана.
 * Хоосон хайлтад «сүүлд харсан» (localStorage) + цагаан толгойн эхний хэсэг.
 *
 * Өгөгдлийг өөрөө татахгүй — дуудагч `GET /api/users`-ийн жагсаалтаа өгнө,
 * ингэснээр UsersPage, Тайлан хоёулаа нэг кэшлэгдсэн query хэрэглэнэ.
 */

const RECENT_KEY = 'reports.recentEmployees';
const RECENT_MAX = 5;

function readRecent(): number[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    const arr = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(arr) ? arr.filter((x): x is number => typeof x === 'number') : [];
  } catch {
    return [];
  }
}

function pushRecent(id: number) {
  try {
    const next = [id, ...readRecent().filter((x) => x !== id)].slice(0, RECENT_MAX);
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    /* localStorage хаалттай — сүүлд харсан жагсаалт л алга болно */
  }
}

function Highlight({ text, query }: { text: string; query: string }) {
  const h = findHighlight(text, query);
  if (!h) return <>{text}</>;
  return (
    <>
      {text.slice(0, h.at)}
      <mark className="rounded-sm bg-primary/20 px-0 text-inherit">{text.slice(h.at, h.at + h.len)}</mark>
      {text.slice(h.at + h.len)}
    </>
  );
}

export interface EmployeePickerProps<T extends PickableUser> {
  users: T[];
  value: number | null;
  onChange: (id: number, user: T) => void;
  placeholder?: string;
  limit?: number;
  className?: string;
  /** Сонгосны дараа хайлтын талбарт нэрийг харуулах уу (default true). */
  showSelected?: boolean;
  autoFocus?: boolean;
}

export function EmployeePicker<T extends PickableUser>({
  users,
  value,
  onChange,
  placeholder,
  limit = 8,
  className,
  showSelected = true,
  autoFocus,
}: EmployeePickerProps<T>) {
  const { t } = useLanguage();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const selected = useMemo(() => users.find((u) => u.id === value) ?? null, [users, value]);

  const { items, recentMode } = useMemo(() => {
    const q = query.trim();
    if (q) return { items: rankUsers(users, q, limit), recentMode: false };
    const recent = readRecent()
      .map((id) => users.find((u) => u.id === id))
      .filter((u): u is T => !!u);
    const rest = [...users]
      .filter((u) => !recent.includes(u))
      .sort((a, b) => a.full_name.localeCompare(b.full_name));
    return { items: [...recent, ...rest].slice(0, limit), recentMode: recent.length > 0 };
  }, [users, query, limit]);

  const pick = (u: T) => {
    pushRecent(u.id);
    onChange(u.id, u);
    setQuery('');
    setOpen(false);
    inputRef.current?.blur();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!open && (e.key === 'ArrowDown' || e.key === 'Enter')) {
      setOpen(true);
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, items.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === 'Enter') {
      const u = items[active];
      if (u) {
        e.preventDefault();
        pick(u);
      }
    } else if (e.key === 'Escape') {
      setOpen(false);
      inputRef.current?.blur();
    }
  };

  const display = !open && showSelected && selected && !query ? formatDisplayName(selected.full_name) : query;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverAnchor asChild>
        <div className={cn('relative', className)}>
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            ref={inputRef}
            value={display}
            autoFocus={autoFocus}
            placeholder={placeholder ?? t('reportsPage.searchEmployee')}
            className={cn('pl-8', (query || (selected && showSelected)) && 'pr-8')}
            onFocus={() => {
              setActive(0);
              setOpen(true);
            }}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
              setOpen(true);
            }}
            onKeyDown={onKeyDown}
            role="combobox"
            aria-expanded={open}
            aria-autocomplete="list"
          />
          {(query || (selected && showSelected)) && (
            <button
              type="button"
              aria-label="clear"
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:text-foreground"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                setQuery('');
                setOpen(true);
                inputRef.current?.focus();
              }}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </PopoverAnchor>
      <PopoverContent
        align="start"
        className="w-[var(--radix-popover-trigger-width)] min-w-[280px] p-1"
        onOpenAutoFocus={(e) => e.preventDefault()}
        onCloseAutoFocus={(e) => e.preventDefault()}
        onInteractOutside={(e) => {
          if (e.target === inputRef.current) e.preventDefault();
        }}
      >
        {items.length === 0 ? (
          <div className="px-3 py-4 text-center text-sm text-muted-foreground">{t('reportsPage.noResults')}</div>
        ) : (
          <ul role="listbox" className="max-h-80 overflow-y-auto">
            {recentMode && !query && (
              <li className="px-2 pb-1 pt-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                {t('reportsPage.recent')}
              </li>
            )}
            {items.map((u, i) => {
              const teamCode = u.team_code ?? u.teams?.[0]?.code ?? null;
              const isActive = i === active;
              const isSelected = u.id === value;
              return (
                <li
                  key={u.id}
                  role="option"
                  aria-selected={isSelected}
                  className={cn(
                    'flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-sm',
                    isActive ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/60',
                  )}
                  onMouseEnter={() => setActive(i)}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => pick(u)}
                >
                  <Avatar className="h-7 w-7 shrink-0">
                    {u.profile_image && <AvatarImage src={mediaUrl(u.profile_image)} alt="" />}
                    <AvatarFallback className="bg-primary/15 text-[10px] font-semibold text-primary">
                      {u.full_name.slice(0, 2).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium leading-tight">
                      <Highlight text={formatDisplayName(u.full_name)} query={query} />
                    </div>
                    {(u.position || u.employee_id) && (
                      <div className="truncate text-xs text-muted-foreground">
                        {[u.employee_id, u.position].filter(Boolean).join(' · ')}
                      </div>
                    )}
                  </div>
                  {teamCode && (
                    <Badge variant="outline" className={cn('shrink-0 font-mono text-[10px]', teamChipClass(teamCode))}>
                      {teamCode}
                    </Badge>
                  )}
                  {isSelected && <Check className="h-4 w-4 shrink-0 text-primary" />}
                </li>
              );
            })}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}

export default EmployeePicker;
