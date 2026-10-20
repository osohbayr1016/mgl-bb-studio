import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ClipboardList, Wrench } from 'lucide-react';
import { useLanguage } from '@/shared/i18n';
import { Avatar, AvatarFallback, AvatarImage } from '@/ui/avatar';
import { mediaUrl } from '@/shared/api/client';
import { cn } from '@/shared/lib/utils';
import type { AllocPerson } from '../lib/allocation';

/**
 * «Засвар» шошго — ирцээр сонгосон ЗАСВАРЫН төслийн мөр (`kind = 'repair'`,
 * миграц 0324).  Нэр нь жинхэнэ төслийнхтэй төстэй байж болох тул матриц,
 * самбар бүрт нэг л шошгоор ялгана.
 */
export function RepairTag({ className, title }: { className?: string; title?: string }) {
  const { t } = useLanguage();
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-0.5 rounded border border-warning/40 bg-warning/10 px-1 py-px text-[9px] font-semibold uppercase leading-tight tracking-wide text-warning',
        className,
      )}
      title={title ?? t('teams.repairTagHint')}
    >
      <Wrench className="h-2.5 w-2.5" />
      {t('teams.repairTag')}
    </span>
  );
}

/**
 * «Төслийн бус» шошго — ирцийн цонхноос бүртгэсэн төслийн бус ажил (0342:
 * зохиогчийн хяналт, цаас наах, баримт бичиг янзлах, бусад).  `RepairTag`-тай
 * ижил хэлбэр, өөр өнгө — нэг мөрөнд хоёулаа гарч болно.
 */
export function NonProjectTag({ className }: { className?: string }) {
  const { t } = useLanguage();
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-0.5 rounded border border-info/40 bg-info/10 px-1 py-px text-[9px] font-semibold uppercase leading-tight tracking-wide text-info',
        className,
      )}
      title={t('teams.nonProjectTagHint')}
    >
      <ClipboardList className="h-2.5 w-2.5" />
      {t('teams.nonProjectTag')}
    </span>
  );
}

/** «Одоо» тэмдэг — ОДОО энэ ажил дээр (ирцийн сонголт эсвэл төслийн бус ажил). */
export function NowBadge() {
  const { t } = useLanguage();
  return (
    <span className="inline-flex shrink-0 items-center gap-0.5 rounded-sm bg-emerald-500/15 px-1 text-[9px] font-semibold uppercase tracking-wide text-emerald-600 dark:text-emerald-400">
      <span className="h-1 w-1 rounded-full bg-emerald-500" />
      {t('teams.rosterNow')}
    </span>
  );
}

/** Хоёр үсгийн товчлол — зураггүй хүний avatar-ын нөөц. */
function initials(name: string): string {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase() ?? '')
    .join('');
}

/**
 * Давхарлан харуулах avatar-ууд.  `limit`-ээс хэтэрсэн хүмүүсийг «+N»
 * дугуйгаар хураана — 13 хүнтэй нүд мөрөө тасалж болохгүй.
 */
export function PeopleStack({
  people,
  limit = 8,
  size = 'sm',
}: {
  people: AllocPerson[];
  limit?: number;
  size?: 'xs' | 'sm';
}) {
  if (people.length === 0) return null;
  const shown = people.slice(0, limit);
  const rest = people.length - shown.length;
  const box = size === 'xs' ? 'h-5 w-5 text-[8px]' : 'h-6 w-6 text-[9px]';

  return (
    <div className="flex flex-wrap items-center -space-x-1.5">
      {shown.map((p) => (
        <Link
          key={p.user_id}
          to={`/app/users/${p.user_id}`}
          title={p.full_name}
          className="transition-transform hover:z-10 hover:scale-110"
        >
          <Avatar className={cn(box, 'ring-2 ring-background')}>
            {p.profile_image && <AvatarImage src={mediaUrl(p.profile_image)} alt="" />}
            <AvatarFallback className={cn(box, 'text-[9px]')}>
              {initials(p.full_name)}
            </AvatarFallback>
          </Avatar>
        </Link>
      ))}
      {rest > 0 && (
        <span
          className={cn(
            box,
            'z-10 flex items-center justify-center rounded-full bg-muted font-semibold tabular-nums text-muted-foreground ring-2 ring-background',
          )}
          title={people
            .slice(limit)
            .map((p) => p.full_name)
            .join(', ')}
        >
          +{rest}
        </span>
      )}
    </div>
  );
}

/** Гарчиг + тоо — KPI мөр болон дэлгэрэнгүй картад хамт хэрэглэнэ. */
export function StatPill({
  label,
  value,
  tone,
}: {
  label: string;
  value: string | number;
  tone?: 'default' | 'warn';
}) {
  return (
    <div className="rounded-lg border border-border/60 bg-muted/30 px-2.5 py-1.5">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div
        className={cn(
          'text-sm font-semibold tabular-nums',
          tone === 'warn' && Number(value) > 0 && 'text-destructive',
        )}
      >
        {value}
      </div>
    </div>
  );
}

/**
 * Хэмжээний туузан диаграм — нэг мөрд нэг утга.
 *
 * Багийн нэг өнгөөр дүүргэнэ (нэг цуваа = нэг өнгө), утга нь баруун талд
 * тоогоор бичигдэнэ, тул хэмжээ хэзээ ч зөвхөн өнгөөр илэрхийлэгдэхгүй.
 */
export function ValueBar({
  value,
  max,
  color,
  label,
  to,
  meta,
  tag,
}: {
  value: number;
  max: number;
  color: string;
  label: string;
  to?: string;
  meta?: string;
  /** Нэрийн ард гарах шошго (жишээ нь `<RepairTag />`). */
  tag?: ReactNode;
}) {
  const pct = max > 0 ? Math.max(3, (value / max) * 100) : 0;
  return (
    <div className="group flex items-center gap-2">
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          {to ? (
            <Link to={to} className="truncate text-[13px] hover:text-primary" title={label}>
              {label}
            </Link>
          ) : (
            <span className="truncate text-[13px]" title={label}>
              {label}
            </span>
          )}
          {tag}
          {meta && <span className="shrink-0 text-[10px] text-muted-foreground">{meta}</span>}
        </div>
        <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full transition-all duration-300"
            style={{ width: `${pct}%`, backgroundColor: color }}
          />
        </div>
      </div>
      <span className="w-6 shrink-0 text-right text-[13px] font-semibold tabular-nums">
        {value}
      </span>
    </div>
  );
}
