import { useState } from 'react';
import { Building2, ArrowRight, RefreshCw } from 'lucide-react';
import { useApiQuery } from '@/shared/api/useApi';
import { Card, CardContent } from '@/ui/card';
import { Badge } from '@/ui/badge';
import { cn } from '@/shared/lib/utils';
import { teamChipClass } from '@/shared/lib/team-colors';
import { TeamReportShell } from '@/features/projects/team-reports/TeamReportShell';
import { BaReportDocument, BA_REPORT_STYLES } from '@/features/projects/team-reports/ba/BaDocument';
import { BA_SECTIONS } from '@/features/projects/team-reports/ba/template';
import type { BaBuildingType, BaReportAnswers } from '@/features/projects/team-reports/ba/types';
import type { TeamReportResource } from '@/features/projects/team-reports/types';

/* =============================================================
 * BA (Барилга архитектур) panel.
 * -------------------------------------------------------------
 * BA is structurally different from the other 6 disciplines
 * because it has a building-type variant gate (РЦ vs Металл
 * каркас) which filters which fields render.  Visual chrome
 * still comes from TeamReportShell so the panel reads the same
 * as BB / HAS / ЦБУ / etc. — the variant choice just lives in
 * the header's `headerExtras` slot once selected.
 *
 * Flow:
 *   1. No variant yet → modern picker card (same accent / spacing
 *      as the shell, two big choice tiles).
 *   2. Variant picked → TeamReportShell with the chosen variant
 *      surfaced as a chip + "Солих" link in the header.
 * ============================================================= */

interface BaPanelProps {
  projectId: number;
  readOnly?: boolean;
}

interface BaReportResponse {
  report: TeamReportResource | null;
}

const BUILDING_TYPE_OPTIONS: Array<{ value: BaBuildingType; title: string; subtitle: string }> = [
  {
    value: 'rc',
    title: 'СОНГОЛТ А — Төмөр бетон цутгамал каркас',
    subtitle:
      'Олон давхар орон сууц / оффис, блок-тоосгон өрөг хана, чулуун хөвөн дулаалга, металл / шилэн фасад.',
  },
  {
    value: 'steel',
    title: 'СОНГОЛТ Б — Металл каркас',
    subtitle: 'Нам давхар олон нийтийн / үйлчилгээний барилга, сэндвич хавтан өнгөлгөө.',
  },
];

const TEAM_CODE = 'BA';

export function BaPanel({ projectId, readOnly = false }: BaPanelProps) {
  // The shell owns the answers/save loop, but BA also needs the
  // top-level `building_type` value which lives on its own DB column.
  // We never copy the server value into local state — instead the
  // displayed value is derived from (a) the user's most recent
  // override and (b) the server value as a fallback.  This pattern
  // avoids the "setState inside useEffect" anti-pattern lint rule
  // while still letting the user re-pick the variant via the gate.
  const reportQuery = useApiQuery<BaReportResponse>(
    ['/projects/team-reports', projectId, TEAM_CODE] as const,
    `/projects/${projectId}/team-reports/${TEAM_CODE}`,
  );
  const serverType: BaBuildingType | null = reportQuery.data?.report?.building_type ?? null;

  // `override` carries an explicit user choice when set, the sentinel
  // 'cleared' when the user just clicked "Солих" (so we override the
  // server value back to null and re-show the gate), or null meaning
  // "no override — defer to serverType".
  const [override, setOverride] = useState<BaBuildingType | 'cleared' | null>(null);
  const buildingType: BaBuildingType | null =
    override === 'cleared' ? null : (override ?? serverType);

  if (!buildingType) {
    return <BaVariantPicker readOnly={readOnly} onPick={(v) => setOverride(v)} />;
  }

  const variantChip = (
    <span className="hidden sm:inline-flex items-center gap-2 text-[11px] text-muted-foreground border-l border-border/40 pl-3 ml-1">
      <Badge variant="secondary" className="text-[10px] px-2 py-0">
        {buildingType === 'rc' ? 'СОНГОЛТ А' : 'СОНГОЛТ Б'}
      </Badge>
      <span className="truncate max-w-[180px]">
        {buildingType === 'rc' ? 'Төмөр бетон цутгамал' : 'Металл каркас'}
      </span>
      {!readOnly && (
        <button
          type="button"
          onClick={() => setOverride('cleared')}
          className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground underline-offset-2 hover:underline"
        >
          <RefreshCw className="w-3 h-3" /> солих
        </button>
      )}
    </span>
  );

  return (
    <TeamReportShell<BaReportAnswers>
      teamCode={TEAM_CODE}
      teamLabel="Барилга архитектур"
      subtitle="Архитектурын тайлбар бичиг"
      sections={BA_SECTIONS}
      renderDocument={(a) => <BaReportDocument answers={a} buildingType={buildingType} />}
      documentStyles={BA_REPORT_STYLES}
      projectId={projectId}
      readOnly={readOnly}
      variant={buildingType}
      buildingTypeOnSave={buildingType}
      headerExtras={variantChip}
    />
  );
}

/** Modernized variant picker — same accent bar + card design as the
 *  shell's hero, but the body is two choice tiles instead of the
 *  accordion form.  Lives only at the very start of the BA flow
 *  before any variant has been chosen. */
function BaVariantPicker({
  readOnly,
  onPick,
}: {
  readOnly: boolean;
  onPick: (v: BaBuildingType) => void;
}) {
  return (
    <Card className="overflow-hidden border-border/40 shadow-sm">
      <div className="h-1 w-full bg-sky-500/60" />
      <CardContent className="py-5 sm:py-6 space-y-4">
        <div className="flex items-center gap-3">
          <Badge
            variant="outline"
            className={cn(teamChipClass('BA'), 'text-xs font-semibold px-2.5 py-1')}
          >
            BA
          </Badge>
          <div className="min-w-0">
            <h2 className="text-base font-semibold leading-tight flex items-center gap-2">
              <Building2 className="w-4 h-4 text-primary" />
              Барилга архитектур
            </h2>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              Эхлэхийн тулд барилгын каркасны төрлөө сонгоно уу. Энэ нь дараагийн хэсэг бүрд гарах
              асуултуудыг тодорхойлно.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {BUILDING_TYPE_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => onPick(opt.value)}
              disabled={readOnly}
              className={cn(
                'group text-left rounded-xl border border-border/60 bg-card p-4',
                'hover:border-primary/50 hover:bg-primary/5 transition-colors',
                'disabled:opacity-60 disabled:cursor-not-allowed',
              )}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="text-sm font-semibold leading-snug">{opt.title}</div>
                <ArrowRight className="w-4 h-4 text-muted-foreground group-hover:text-primary flex-shrink-0 mt-0.5" />
              </div>
              <div className="text-xs text-muted-foreground mt-1.5 leading-relaxed">
                {opt.subtitle}
              </div>
            </button>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
