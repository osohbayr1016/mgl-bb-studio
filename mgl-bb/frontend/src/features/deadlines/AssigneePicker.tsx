/**
 * Хариуцагч сонгогч — хайлттай, олон сонголттой.
 *
 * ХОЁР газраас хэрэглэгдэнэ (төслийн «Эцсийн хугацаа» табын мөрөнд суусан
 * форм ба `MilestoneDialog`), тиймээс ТУСАД НЬ.  Хоёр
 * газар хоёр хувилбар бичвэл хайлтын дүрэм, сонгогдсоны эрэмбэ зэрэг
 * чимээгүйхэн зөрнө.
 */
import { useMemo, useState } from 'react';
import { Search, X } from 'lucide-react';

import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/i18n';
import { formatDisplayName } from '@/shared/lib/formatting';
import type { User } from '@/shared/types';

/**
 * Хайлтын тохирол — ОВГООР ч, НЭРЭЭР ч олдоно.
 *
 * `full_name` нь «Овог Нэр» дараалалтай хадгалагддаг ч хүмүүс бие биеэ
 * НЭРЭЭР нь дууддаг.  Тиймээс угтвараар (`startsWith`) биш, нэр бүхэлдээ
 * дотор нь хайна — «бат» гэж бичихэд «Батбаяр Ганбат» хоёул олдоно.
 *
 * `username` (жнь «A.Anand») мөн хамрагдана: дотоод харилцаанд хүмүүсийг
 * түүгээр нэрлэх нь элбэг.
 *
 * Асуулгын үг БҮР таарах ёстой (AND) — «ган бат» гэж бичихэд хоёуланг нь
 * агуулсан хүн л үлдэнэ, дараалал хамаарахгүй.
 */
export function matchesUser(u: User, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const haystack = `${u.full_name ?? ''} ${u.username ?? ''}`.toLowerCase();
  return q.split(/\s+/).every((token) => haystack.includes(token));
}

const inputClass =
  'w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/40';

function UserCheck({
  user,
  checked,
  onToggle,
}: {
  user: User;
  checked: boolean;
  onToggle: () => void;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-sm hover:bg-muted/60">
      <input
        type="checkbox"
        checked={checked}
        onChange={onToggle}
        className="h-3.5 w-3.5 flex-none accent-current"
      />
      <span className="truncate">{formatDisplayName(user.full_name)}</span>
      <span className="ml-auto flex-none truncate text-xs text-muted-foreground">
        {user.username}
      </span>
    </label>
  );
}

export function AssigneePicker({
  users,
  value,
  onChange,
  maxHeight = 'max-h-36',
  label,
}: {
  users: User[];
  value: number[];
  onChange: (ids: number[]) => void;
  maxHeight?: string;
  /** Толгойн шошго — өгөгдмөл «Хариуцагч» (ЗХ-ийн хуваарь «Явах хүмүүс» гэж өгнө). */
  label?: string;
}) {
  const { t } = useLanguage();
  const [query, setQuery] = useState('');

  /** СОНГОГДСОН хүмүүс ҮРГЭЛЖ дээр, шүүлтээс үл хамааран.  Эс бөгөөс
   *  хайлт бичиж эхэлмэгц аль хэдийн сонгосон хүмүүс жагсаалтаас алга
   *  болж, «сонгосон эсэхээ» шалгах боломжгүй болно. */
  const visible = useMemo(() => {
    const selected = users.filter((u) => value.includes(u.id));
    const rest = users.filter((u) => !value.includes(u.id) && matchesUser(u, query));
    return { selected, rest };
  }, [users, value, query]);

  return (
    <div className="space-y-1">
      <span className="text-xs font-medium text-muted-foreground">
        {label ?? t('deadlines.assignees')}
      </span>

      <div className="relative">
        <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('deadlines.assigneeSearch')}
          className={cn(inputClass, 'py-1 pl-7 pr-7 text-xs')}
        />
        {query && (
          <button
            type="button"
            onClick={() => setQuery('')}
            aria-label={t('common.clear')}
            className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:bg-muted"
          >
            <X className="h-3 w-3" />
          </button>
        )}
      </div>

      <div
        className={cn(
          'space-y-0.5 overflow-y-auto rounded-md border border-border bg-background p-1',
          maxHeight,
        )}
      >
        {users.length === 0 ? (
          <p className="px-1.5 py-1 text-xs text-muted-foreground">
            {t('deadlines.ownerNone')}
          </p>
        ) : (
          <>
            {visible.selected.map((u) => (
              <UserCheck
                key={u.id}
                user={u}
                checked
                onToggle={() => onChange(value.filter((id) => id !== u.id))}
              />
            ))}
            {visible.selected.length > 0 && visible.rest.length > 0 && (
              <div className="my-0.5 border-t border-border/50" />
            )}
            {visible.rest.map((u) => (
              <UserCheck
                key={u.id}
                user={u}
                checked={false}
                onToggle={() => onChange([...value, u.id])}
              />
            ))}
            {visible.rest.length === 0 && query.trim() !== '' && (
              <p className="px-1.5 py-1 text-xs text-muted-foreground">
                {t('deadlines.assigneeNoMatch')}
              </p>
            )}
          </>
        )}
      </div>

      {value.length > 0 && (
        <span className="block text-xs text-muted-foreground">
          {t('deadlines.assigneeCount', { n: value.length })}
        </span>
      )}
    </div>
  );
}

export default AssigneePicker;
