/* ==========================================================================
   SourceProjectPicker — «Бүтэц татах»-ын ЭХ ТӨСЛИЙН сонгогч
   ==========================================================================

   Засварын (ЗА) төсөл нь бараг үргэлж ӨМНӨ нь зурсан барилгын дахин ажил
   тул зөв эх төслийг олох нь хамгийн их цаг иддэг алхам.  Тиймээс энэ
   сонгогч нь хоёр дохиогоор нэр дэвшигчдийг ДЭЭШ гаргана:

     1. Паспортын ШИФР яг таарах  (`drawing_no`) — хамгийн хүчтэй дохио.
     2. Нэрэн дэх `MGL-<код>` угтвар таарах — тусгаарлагчийг (зай / `-` /
        `_`) болон араас нь залгагдах мэргэжлийн дагаварыг («…_AZ») үл
        тоомсорлож харьцуулна.

   ⚠️ АВТОМАТААР ХЭЗЭЭ Ч СОНГОХГҮЙ.  Продакшн дахь ЗА төслүүдийн ойролцоогоор
   тал нь хосгүй — чимээгүйгээр БУРУУ төсөл сонгочихвол админ анзааралгүй
   бүтэн бүтэц хуулчихна.  Санал бол зөвхөн эрэмбэ + шошго.
   ========================================================================== */
import { useMemo, useState, type JSX } from 'react';
import { ChevronsUpDown, Search } from 'lucide-react';

import { useApiQuery } from '@/shared/api/useApi';
import { useLanguage } from '@/shared/i18n';
import { cn } from '@/shared/lib/utils';
import type { ProjectWithProgress } from '@/shared/types';
import { Badge } from '@/ui/badge';
import { Button } from '@/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/ui/popover';

/** Нэрнээс `MGL-<код>`-ийн ТООН хэсгийг гаргана.  Тусгаарлагч нь зай, `-`
 *  эсвэл `_` аль нь ч байж болно; ард нь юу залгагдсан нь хамаагүй тул
 *  мэргэжлийн дагавар («_AZ», «-ZA») өөрөө унана. */
function mglCode(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const m = /MGL[\s\-_]*(\d{3,})/i.exec(raw);
  return m ? (m[1] ?? null) : null;
}

function normShifr(raw: string | null | undefined): string | null {
  const v = (raw ?? '').trim().toUpperCase();
  return v.length > 0 ? v : null;
}

type MatchReason = 'shifr' | 'code' | null;

interface Candidate {
  project: ProjectWithProgress;
  reason: MatchReason;
}

export function SourceProjectPicker({
  value,
  onChange,
  excludeProjectId,
  targetName,
  targetShifr,
  disabled,
}: {
  value: number | null;
  onChange: (id: number | null) => void;
  excludeProjectId?: number;
  targetName?: string;
  targetShifr?: string | null;
  disabled?: boolean;
}): JSX.Element {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');

  const projectsQuery = useApiQuery<{ projects: ProjectWithProgress[] }>('/projects', {
    staleTime: 30_000,
  });

  const targetCode = useMemo(() => mglCode(targetName), [targetName]);
  const targetShifrNorm = useMemo(() => normShifr(targetShifr), [targetShifr]);

  /* Нэр дэвшигчид: саналтай нь эхэнд, дотор нь серверийн эрэмбэ хэвээр. */
  const candidates = useMemo<Candidate[]>(() => {
    const all = projectsQuery.data?.projects ?? [];
    const scored: Candidate[] = [];
    for (const p of all) {
      if (excludeProjectId != null && p.id === excludeProjectId) continue;
      let reason: MatchReason = null;
      const shifr = normShifr(p.drawing_no);
      if (targetShifrNorm != null && shifr === targetShifrNorm) reason = 'shifr';
      else if (targetCode != null && mglCode(p.name) === targetCode) reason = 'code';
      scored.push({ project: p, reason });
    }
    const rank = (r: MatchReason) => (r === 'shifr' ? 0 : r === 'code' ? 1 : 2);
    // ⚠️ Тогтвортой эрэмбэ: зөвхөн саналын зэрэглэлээр л дараална, үлдсэнийг
    // нь серверийн (is_asap → sort_order → created_at) дараалалд үлдээнэ.
    return scored
      .map((c, i) => ({ c, i }))
      .sort((a, b) => rank(a.c.reason) - rank(b.c.reason) || a.i - b.i)
      .map((x) => x.c);
  }, [projectsQuery.data, excludeProjectId, targetCode, targetShifrNorm]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return candidates;
    return candidates.filter(({ project: p }) =>
      [p.name, p.display_title, p.drawing_no, p.doc_no, p.full_title]
        .filter((s): s is string => typeof s === 'string' && s.length > 0)
        .some((s) => s.toLowerCase().includes(needle)),
    );
  }, [candidates, q]);

  const suggested = filtered.filter((c) => c.reason !== null);
  const others = filtered.filter((c) => c.reason === null);

  const selected = candidates.find((c) => c.project.id === value)?.project ?? null;

  const renderRow = ({ project: p, reason }: Candidate) => (
    <button
      key={p.id}
      type="button"
      onClick={() => {
        onChange(p.id);
        setOpen(false);
      }}
      className={cn(
        'flex w-full items-center gap-2 px-3 py-2 text-left text-xs transition-colors hover:bg-accent',
        p.id === value && 'bg-accent',
      )}
    >
      <span className="min-w-0 flex-1 truncate">{p.name}</span>
      {p.drawing_no && (
        <span className="flex-shrink-0 font-mono text-micro text-muted-foreground">
          {p.drawing_no}
        </span>
      )}
      {p.category && (
        <Badge
          variant="outline"
          className="flex-shrink-0 border-primary/30 py-0 font-mono text-micro text-primary"
        >
          {p.category}
        </Badge>
      )}
      {reason && (
        <Badge
          variant="outline"
          className="flex-shrink-0 border-success/40 bg-success/10 py-0 text-micro text-success"
        >
          {reason === 'shifr'
            ? t('copyStructure.suggestSameShifr')
            : t('copyStructure.suggestSameCode')}
        </Badge>
      )}
    </button>
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          disabled={disabled}
          className="h-9 w-full justify-between gap-2 px-3 text-xs font-normal"
        >
          <span className={cn('min-w-0 truncate', !selected && 'text-muted-foreground')}>
            {selected ? selected.name : t('copyStructure.sourcePlaceholder')}
          </span>
          <ChevronsUpDown className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={4}
        className="w-[min(32rem,90vw)] overflow-hidden p-0"
      >
        <div className="flex items-center gap-2 border-b border-border/60 p-2">
          <Search className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t('common.searchPlaceholder')}
            aria-label={t('common.search')}
            className="flex-1 rounded-sm bg-transparent text-xs outline-none placeholder:text-muted-foreground focus-visible:ring-1 focus-visible:ring-ring"
          />
        </div>

        <div className="max-h-80 overflow-y-auto overscroll-contain">
          {projectsQuery.isLoading && (
            <div className="px-3 py-6 text-center text-xs text-muted-foreground">
              {t('common.loading')}
            </div>
          )}
          {!projectsQuery.isLoading && filtered.length === 0 && (
            <div className="px-3 py-6 text-center text-xs text-muted-foreground">
              {t('common.noResults')}
            </div>
          )}

          {suggested.length > 0 && (
            <>
              <div className="bg-muted/40 px-3 py-1 text-micro font-semibold tracking-wide text-muted-foreground uppercase">
                {t('copyStructure.suggested')}
              </div>
              {suggested.map(renderRow)}
            </>
          )}
          {others.length > 0 && (
            <>
              {suggested.length > 0 && (
                <div className="bg-muted/40 px-3 py-1 text-micro font-semibold tracking-wide text-muted-foreground uppercase">
                  {t('copyStructure.allProjects')}
                </div>
              )}
              {others.map(renderRow)}
            </>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

export default SourceProjectPicker;
