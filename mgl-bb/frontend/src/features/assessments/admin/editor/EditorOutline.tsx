/**
 * Зүүн талын хуудасны жагсаалт.
 *
 * Ажилтан ЯГ ийм дараалалтай хуудсуудыг харна — засварлагч дээрх «хуудас 3 /
 * 19» гэдэг нь бөглөгчийн «хуудас 3 / 19»-тэй ижил.  Тиймээс энэ бол зүгээр
 * нэг мод биш, БОДИТ навигаци.
 */
import { AlertTriangle, FileText, Plus } from 'lucide-react';

import { useLanguage } from '@/shared/i18n';
import { cn } from '@/shared/lib/utils';
import { Badge } from '@/ui/badge';
import { Button } from '@/ui/button';

import type { EditorPage } from '../../lib/editorPages';
import { sectionItemCount } from '../../lib/schemaDraft';
import type { SchemaDraft } from '../../lib/schemaDraft';

interface Props {
  draft: SchemaDraft;
  pages: EditorPage[];
  index: number;
  onGo: (index: number) => void;
  onAddPart: () => void;
}

export function EditorOutline({ draft, pages, index, onGo, onAddPart }: Props) {
  const { t } = useLanguage();

  /** Part бүрийн жингийн нийлбэр — 100 биш бол ШАР сэрэмжлүүлэг (зөөлөн). */
  const weightWarn = new Map<string, boolean>();
  for (const part of draft.parts) {
    if (!part.weighted) continue;
    const sum = part.sections.reduce((acc, s) => acc + (s.weight || 0), 0);
    weightWarn.set(part.key, Math.abs(sum - 100) > 0.001);
  }

  // Part солигдох мөрд гарчиг тавина.  Энэ нь JSX-ийн `map` дотор БИШ, урьдчилан
  // энгийн давталтаар бодогдоно — render-ийн дараа хувьсагч дахин олгогдвол
  // дараагийн render дээр таарахгүй байдал үүсдэг (react-hooks/immutability).
  const rows: { page: EditorPage; header: SchemaDraft['parts'][number] | null }[] = [];
  let lastPartKey: string | null = null;
  for (const page of pages) {
    const header = page.kind === 'sections' && page.part.key !== lastPartKey ? page.part : null;
    if (page.kind === 'sections') lastPartKey = page.part.key;
    rows.push({ page, header });
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 space-y-0.5 overflow-y-auto p-2">
        {rows.map(({ page, header }, i) => {
          const active = i === index;

          return (
            <div key={page.key}>
              {header && (
                <div className="mt-3 flex items-center gap-1.5 px-2 pb-1 first:mt-0">
                  <span className="truncate text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {header.title || t('assessments.builder.kind_part')}
                  </span>
                  {weightWarn.get(header.key) && (
                    <AlertTriangle
                      className="size-3 shrink-0 text-amber-500"
                      aria-label={t('assessments.builder.weightWarn')}
                    />
                  )}
                </div>
              )}
              <button
                type="button"
                onClick={() => onGo(i)}
                className={cn(
                  'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors',
                  active ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/50',
                )}
              >
                <span className="w-5 shrink-0 text-right text-micro tabular-nums text-muted-foreground">
                  {i + 1}
                </span>
                {page.kind === 'intro' && <FileText className="size-3.5 shrink-0" aria-hidden />}
                <span className="min-w-0 flex-1 truncate">{page.label}</span>
                {page.kind === 'sections' && (
                  <span className="shrink-0 text-micro tabular-nums text-muted-foreground">
                    {page.sections.reduce((n, s) => n + sectionItemCount(s), 0)}
                  </span>
                )}
              </button>
            </div>
          );
        })}
      </div>

      <div className="border-t p-2">
        <Button variant="ghost" size="sm" className="w-full justify-start" onClick={onAddPart}>
          <Plus /> {t('assessments.builder.addPart')}
        </Button>
        <p className="px-2 pt-1 text-micro text-muted-foreground">
          {t('assessments.editor.outlinePages', { count: pages.length })}
        </p>
      </div>
    </div>
  );
}

/** Ажилтны талд харагдах нийт мөрийн тоо — толгойн товч мэдээлэлд. */
export function TotalRowsBadge({ draft }: { draft: SchemaDraft }) {
  const total = draft.parts.reduce(
    (sum, part) => sum + part.sections.reduce((n, s) => n + sectionItemCount(s), 0),
    0,
  );
  return <Badge variant="secondary">{total}</Badge>;
}

export default EditorOutline;
