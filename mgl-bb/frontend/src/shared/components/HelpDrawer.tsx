import { useState } from 'react';
import {
  HelpCircle,
  Layers3,
  FileText,
  Boxes,
  Target,
  Info,
  UsersRound,
  Calculator,
} from 'lucide-react';
import { useLanguage } from '@/shared/i18n';
import { Button } from '@/ui/button';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetTrigger,
} from '@/ui/sheet';
import { Badge } from '@/ui/badge';

/**
 * HelpDrawer — collapsible reference for the project setup hierarchy.
 *
 * The setup page used to inline a 4-sentence explanation right under
 * the header.  Empirically nobody reads walls of Cyrillic text, so we
 * collapse it behind a "Тусламж" affordance that opens a side sheet
 * with a visual schema, rules per level, and a worked example.  The
 * page header keeps a single one-liner pointer to this drawer so new
 * admins can still discover it.
 */
export default function HelpDrawer() {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="outline" size="sm" className="h-9 gap-1.5">
          <HelpCircle className="w-4 h-4" />
          {t('helpDrawer.help')}
        </Button>
      </SheetTrigger>
      <SheetContent side="right" className="w-full sm:max-w-md overflow-y-auto overflow-x-hidden p-0">
        <SheetHeader className="border-b">
          <SheetTitle className="flex items-center gap-2 text-lg">
            <HelpCircle className="w-5 h-5 text-primary" />
            {t('helpDrawer.guideTitle')}
          </SheetTitle>
          <SheetDescription>{t('helpDrawer.guideSubtitle')}</SheetDescription>
        </SheetHeader>

        <div className="p-5 space-y-5">
          {/* Visual schema */}
          <section className="space-y-2">
            <h3 className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">
              {t('helpDrawer.hierarchyTitle')}
            </h3>
            <div className="rounded-lg border border-border bg-muted/20 p-3 space-y-2 text-sm">
              <SchemaRow
                icon={<Layers3 className="w-4 h-4 text-primary" />}
                label={t('helpDrawer.levelBlock')}
                value={t('helpDrawer.levelBlockValue')}
                color="primary"
              />
              <Connector />
              <SchemaRow
                icon={<FileText className="w-4 h-4 text-sky-500" />}
                label={t('helpDrawer.levelDrawing')}
                value={t('helpDrawer.levelDrawingValue')}
                color="sky"
                indent={1}
              />
              <Connector indent={1} />
              <SchemaRow
                icon={<Boxes className="w-4 h-4 text-emerald-500" />}
                label={t('helpDrawer.levelComponent')}
                value={t('helpDrawer.levelComponentValue')}
                color="emerald"
                indent={2}
              />
              <Connector indent={2} />
              <SchemaRow
                icon={<Target className="w-4 h-4 text-amber-500" />}
                label={t('helpDrawer.levelTask')}
                value={t('helpDrawer.levelTaskValue')}
                color="amber"
                indent={3}
              />
            </div>
          </section>

          {/* Rules */}
          <section className="space-y-2">
            <h3 className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">
              {t('helpDrawer.rulesTitle')}
            </h3>
            <ul className="space-y-2 text-sm">
              <Rule>
                <strong>{t('helpDrawer.rule1Strong')}</strong> {t('helpDrawer.rule1Rest')}
              </Rule>
              <Rule>
                {t('helpDrawer.rule2Pre')} <strong>{t('helpDrawer.rule2Strong')}</strong>{' '}
                {t('helpDrawer.rule2Rest')}
              </Rule>
              <Rule>
                {t('helpDrawer.rule3Pre')} <strong>{t('helpDrawer.rule3Strong')}</strong>{' '}
                {t('helpDrawer.rule3Rest')}
              </Rule>
              <Rule>
                <strong>{t('helpDrawer.rule4Strong')}</strong> {t('helpDrawer.rule4Rest')}
              </Rule>
            </ul>
          </section>

          {/* Worked example */}
          <section className="space-y-2">
            <h3 className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">
              {t('helpDrawer.exampleTitle')}
            </h3>
            <div className="rounded-lg border border-border bg-card p-3 space-y-2 text-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-1.5">
                  <Badge className="bg-primary/20 text-primary">{t('helpDrawer.blockBadge')}</Badge>
                  <span className="font-medium">{t('helpDrawer.exampleBlockName')}</span>
                </span>
                <span className="text-xs tabular-nums font-semibold">100%</span>
              </div>
              <div className="pl-4 space-y-1.5">
                <ExampleLine code="BA" name={t('helpDrawer.exArchitecture')} pct="35%" tone="sky" />
                <div className="pl-4 space-y-1 text-xs text-muted-foreground">
                  <ExampleLine
                    code=""
                    name={t('helpDrawer.exMasterPlan')}
                    pct="15%"
                    tone="emerald"
                    inner
                  />
                  <ExampleLine code="" name={t('helpDrawer.exElevation')} pct="3%" tone="amber" inner />
                  <ExampleLine code="" name={t('helpDrawer.exCartogram')} pct="5%" tone="amber" inner />
                  <ExampleLine code="" name={t('helpDrawer.exRedLine')} pct="7%" tone="amber" inner />
                  <ExampleLine code="" name={t('helpDrawer.exSection')} pct="20%" tone="emerald" inner />
                </div>
                <ExampleLine code="BB" name={t('helpDrawer.exStructure')} pct="65%" tone="sky" />
              </div>
            </div>
          </section>

          {/* ──────────────────────────────────────────────────────────
              Багийн хуваарь (project_team_shares)
              ────────────────────────────────────────────────────────── */}
          <section className="space-y-2 pt-2 border-t border-border/60">
            <h3 className="text-xs uppercase tracking-wider text-muted-foreground font-semibold flex items-center gap-1.5">
              <UsersRound className="w-3.5 h-3.5" /> {t('helpDrawer.teamShareTitle')}
            </h3>
            <p className="text-xs text-muted-foreground leading-relaxed">
              {t('helpDrawer.teamShareIntroPre')}{' '}
              <strong className="text-foreground">{t('helpDrawer.teamShareIntroStrong')}</strong>
              {t('helpDrawer.teamShareIntroMid')}{' '}
              <strong className="text-foreground">100%</strong> {t('helpDrawer.teamShareIntroEnd')}
            </p>

            <div className="rounded-lg border border-border bg-muted/20 p-3 space-y-1.5 text-xs">
              <div className="font-semibold text-foreground flex items-center gap-1.5">
                <Calculator className="w-3 h-3" /> {t('helpDrawer.defaultValues')}
              </div>
              <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 tabular-nums text-muted-foreground">
                <span>BA — {t('helpDrawer.teamArchitecture')}</span>
                <span className="text-right text-foreground">30%</span>
                <span>BB — {t('helpDrawer.teamStructure')}</span>
                <span className="text-right text-foreground">32%</span>
                <span>HAS — {t('helpDrawer.teamHeating')}</span>
                <span className="text-right text-foreground">11%</span>
                <span>TSBU — {t('helpDrawer.teamWaterSupply')}</span>
                <span className="text-right text-foreground">8%</span>
                <span>TSAH — {t('helpDrawer.teamElectric')}</span>
                <span className="text-right text-foreground">10%</span>
                <span>HD — {t('helpDrawer.teamComms')}</span>
                <span className="text-right text-foreground">5%</span>
                <span>AU — {t('helpDrawer.teamAutomation')}</span>
                <span className="text-right text-foreground">4%</span>
                <span className="font-semibold text-foreground border-t border-border/60 pt-1 mt-1">
                  {t('helpDrawer.total')}
                </span>
                <span className="text-right font-semibold text-foreground border-t border-border/60 pt-1 mt-1">
                  100%
                </span>
              </div>
            </div>
          </section>

          {/* ──────────────────────────────────────────────────────────
              Олон блоктой төслийн жишээ (5 блок, баг 2 / 1 блок дээр)
              ────────────────────────────────────────────────────────── */}
          <section className="space-y-2">
            <h3 className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">
              {t('helpDrawer.multiBlockTitle')}
            </h3>
            <p className="text-xs text-muted-foreground leading-relaxed">
              {t('helpDrawer.multiBlockIntro')}
            </p>

            <div className="rounded-lg border border-border bg-card p-3 space-y-3 text-xs">
              {/* Step 1 */}
              <div>
                <div className="font-semibold text-foreground mb-1">
                  {t('helpDrawer.step1Title')}
                </div>
                <div className="rounded-md border border-border/60 bg-muted/30 p-2 space-y-0.5 tabular-nums">
                  <div className="flex justify-between">
                    <span>{t('helpDrawer.step1Block1')}</span>
                    <span className="text-muted-foreground">→ BA, BB</span>
                  </div>
                  <div className="flex justify-between">
                    <span>{t('helpDrawer.step1Block2')}</span>
                    <span className="text-muted-foreground">→ BA, BB</span>
                  </div>
                  <div className="flex justify-between">
                    <span>{t('helpDrawer.step1Block3')}</span>
                    <span className="text-muted-foreground">→ BB, HAS</span>
                  </div>
                  <div className="flex justify-between">
                    <span>{t('helpDrawer.step1Block4')}</span>
                    <span className="text-muted-foreground">→ TSAH</span>
                  </div>
                  <div className="flex justify-between">
                    <span>{t('helpDrawer.step1Block5')}</span>
                    <span className="text-muted-foreground">→ TSBU</span>
                  </div>
                </div>
              </div>

              {/* Step 2 */}
              <div>
                <div className="font-semibold text-foreground mb-1">
                  {t('helpDrawer.step2Title')}
                </div>
                <p className="text-muted-foreground leading-relaxed">
                  {t('helpDrawer.step2IntroPre')}{' '}
                  <span className="font-mono text-foreground">20%</span>
                  {t('helpDrawer.step2IntroEnd')}
                </p>
                <div className="rounded-md border border-border/60 bg-muted/30 p-2 mt-1.5 space-y-1 tabular-nums">
                  <BagFormulaRow
                    code="BA"
                    formula={t('helpDrawer.step2FormulaBA')}
                    total="40%"
                  />
                  <BagFormulaRow code="BB" formula={t('helpDrawer.step2FormulaBB')} total="60%" />
                  <BagFormulaRow code="HAS" formula={t('helpDrawer.step2FormulaHAS')} total="10%" />
                  <BagFormulaRow code="TSAH" formula={t('helpDrawer.step2FormulaTSAH')} total="20%" />
                  <BagFormulaRow code="TSBU" formula={t('helpDrawer.step2FormulaTSBU')} total="20%" />
                  <div className="flex justify-between border-t border-border/60 pt-1 mt-1 font-semibold text-foreground">
                    <span>{t('helpDrawer.step2SumLabel')}</span>
                    <span>150%</span>
                  </div>
                </div>
                <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-2 mt-2 text-amber-600 dark:text-amber-400 leading-relaxed">
                  <strong>{t('helpDrawer.noteLabel')}</strong> {t('helpDrawer.step2Note')}
                </div>
              </div>

              {/* Step 3 */}
              <div>
                <div className="font-semibold text-foreground mb-1">
                  {t('helpDrawer.step3Title')}
                </div>
                <p className="text-muted-foreground leading-relaxed">
                  {t('helpDrawer.step3Intro')}
                </p>
                <div className="rounded-md border border-border/60 bg-muted/30 p-2 mt-1.5 space-y-1 tabular-nums">
                  <BagFormulaRow code="BA" formula="20%×0.6 + 20%×0.6" total="24%" />
                  <BagFormulaRow code="BB" formula="20%×0.4 + 20%×0.4 + 20%×0.5" total="26%" />
                  <BagFormulaRow code="HAS" formula="20%×0.5" total="10%" />
                  <BagFormulaRow code="TSAH" formula="20%×1.0" total="20%" />
                  <BagFormulaRow code="TSBU" formula="20%×1.0" total="20%" />
                  <div className="flex justify-between border-t border-border/60 pt-1 mt-1 font-semibold text-foreground">
                    <span>{t('helpDrawer.sum')}</span>
                    <span className="text-emerald-500">100% ✓</span>
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* ──────────────────────────────────────────────────────────
              Төгсгөлийн зөвлөгөө + товчлуурын тайлбар
              ────────────────────────────────────────────────────────── */}
          <section className="rounded-lg border border-blue-500/40 bg-blue-500/5 p-3 flex gap-2">
            <Info className="w-4 h-4 text-blue-700 dark:text-blue-400 shrink-0 mt-0.5" />
            <div className="text-xs leading-relaxed text-muted-foreground space-y-1.5">
              <p>
                <strong className="text-foreground">{t('helpDrawer.tipLabel')}</strong>{' '}
                {t('helpDrawer.tipPre')} <span className="font-mono">0%</span>
                {t('helpDrawer.tipEnd')}
              </p>
              <p>
                {t('helpDrawer.tipSplitPre')}{' '}
                <strong className="text-foreground">{t('helpDrawer.btnSplitEqually')}</strong>{' '}
                {t('helpDrawer.tipSplitEnd')}
              </p>
              <p className="border-t border-border/60 pt-1.5 mt-1.5">
                <strong className="text-foreground">{t('helpDrawer.teamShareButtons')}</strong>
              </p>
              <ul className="space-y-0.5 list-none ml-1">
                <li>
                  <span className="font-mono text-foreground">{t('helpDrawer.btnAddTeam')}</span>{' '}
                  {t('helpDrawer.btnAddTeamDesc')}
                </li>
                <li>
                  <span className="font-mono text-foreground">{t('helpDrawer.btnSplitEqually')}</span>{' '}
                  {t('helpDrawer.btnSplitEquallyDescPre')}{' '}
                  <span className="font-mono">100/N</span>{t('helpDrawer.btnSplitEquallyDescEnd')}
                </li>
                <li>
                  <span className="font-mono text-foreground">{t('helpDrawer.btnNormalize')}</span>{' '}
                  {t('helpDrawer.btnNormalizeDesc')}
                </li>
              </ul>
            </div>
          </section>
        </div>
      </SheetContent>
    </Sheet>
  );
}

/** One row inside the "Багийн хуваарь" worked example: team code badge,
 *  human-readable formula, and the resulting percentage. Pure layout —
 *  no business logic, the numbers come hard-coded from the help copy. */
function BagFormulaRow({ code, formula, total }: { code: string; formula: string; total: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="flex items-center gap-1.5 min-w-0">
        <Badge
          variant="outline"
          className="text-[9px] h-4 px-1 bg-primary/10 text-primary border-primary/30 font-mono"
        >
          {code}
        </Badge>
        <span className="text-muted-foreground truncate">{formula}</span>
      </span>
      <span className="font-semibold text-foreground tabular-nums shrink-0">{total}</span>
    </div>
  );
}

function SchemaRow({
  icon,
  label,
  value,
  indent = 0,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  color: string;
  indent?: number;
}) {
  return (
    <div className="flex items-center gap-2" style={{ paddingLeft: `${indent * 16}px` }}>
      {icon}
      <span className="font-semibold">{label}</span>
      <span className="text-xs text-muted-foreground">— {value}</span>
    </div>
  );
}

function Connector({ indent = 0 }: { indent?: number }) {
  return (
    <div
      className="border-l-2 border-dashed border-border/60 h-2 ml-2"
      style={{ marginLeft: `${indent * 16 + 8}px` }}
    />
  );
}

function Rule({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex gap-2 leading-relaxed">
      <span className="text-primary text-xs mt-0.5">●</span>
      <span>{children}</span>
    </li>
  );
}

function ExampleLine({
  code,
  name,
  pct,
  tone,
  inner = false,
}: {
  code: string;
  name: string;
  pct: string;
  tone: 'sky' | 'emerald' | 'amber';
  inner?: boolean;
}) {
  const toneCls =
    tone === 'sky'
      ? 'bg-sky-500/15 text-sky-700 dark:text-sky-400 border-sky-500/30'
      : tone === 'emerald'
        ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30'
        : 'bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30';
  return (
    <div
      className={
        inner
          ? 'flex items-center justify-between gap-2 text-xs'
          : 'flex items-center justify-between gap-2'
      }
    >
      <span className="flex items-center gap-1.5 min-w-0">
        {code && (
          <Badge variant="outline" className={`text-[9px] h-4 px-1 ${toneCls}`}>
            {code}
          </Badge>
        )}
        <span className="truncate">{name}</span>
      </span>
      <span className="text-xs tabular-nums shrink-0">{pct}</span>
    </div>
  );
}
