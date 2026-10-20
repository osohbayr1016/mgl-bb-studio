/**
 * «Дараагийн түвшинд хүрэх зам» — үнэлгээний хамгийн үйлдэлд ойр хэсэг.
 *
 * Өмнө нь ажилтан «Senior түвшинд хүрэхэд 7.7% дутуу» гэсэн ГАНЦ тоо хардаг
 * байсан — тэр нь юу хийхийг огт хэлдэггүй.  Энэ карт түүнийг мөр түвшний
 * тодорхой жагсаалт болгоно: «Detail Drawing-ийн 24 мөрийг 10-19 төслөөс 20+
 * төсөл болго = +2.7%».
 *
 * ⚠️ ТООГ ЭНД БОДДОГГҮЙ.  Бүх зөвлөмж, хөшүүрэг, эрэмбэ нь серверийн
 *    `lib/assessmentGap.ts`-ээс бэлэн ирнэ (`LevelUpPart`).  Клиент дээр
 *    дахин бодвол ажилтан админаас өөр зөвлөмж хардаг болно.
 *
 * ⚠️ ДЭЭД ТҮВШИН.  `at_top_level` үед «0% дутуу» гэж ХЭЗЭЭ Ч харуулахгүй —
 *    тэнд дараагийн түвшин гэж БАЙХГҮЙ учраас зөрүү нь утгагүй.  Оронд нь
 *    магтаалын мөр гарна (`NextLevelHint`-ийн ижил зарчим).
 */
import { useState } from 'react';
import { ChevronDown, Sparkles, TrendingUp } from 'lucide-react';

import { useLanguage } from '@/shared/i18n';
import { Card, CardContent, CardHeader, CardTitle } from '@/ui/card';
import { Progress } from '@/ui/progress';

import type { LevelUpPart, LevelUpStep, LevelUpTarget } from '../api';
import { LevelBadge } from './LevelBadge';

/** `unit`-ийн дагуу тоог форматлана — хувь vs 1.0–5.0 дундаж (I5). */
function fmt(value: number | null | undefined, unit: 'pct' | 'mean'): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
  return unit === 'pct' ? `${value.toFixed(1)}%` : value.toFixed(2);
}

/**
 * Шатлалын нэг цэгийн хүний уншиж ойлгох нэр.
 *
 * Тайлбар (`caption`) нь схемээс ирдэг ЖИНХЭНЭ утга — «10-19 хүртлэх төсөлд
 * тухайн ажлыг хийж гүйцэтгэсэн».  Тиймээс энд ямар ч домэйн үг hardcode
 * хийхгүй: асуулга солигдвол текст нь дагаад солигдоно.  `value === 0` нь
 * шатлалд байхгүй утга — «хариулаагүй» гэсэн үг.
 */
function stopText(
  stop: LevelUpStep['from'],
  t: (k: string, v?: Record<string, string | number>) => string,
): string {
  if (stop.value === 0) return t('assessments.levelUpUnanswered');
  return stop.caption || stop.label || String(stop.value);
}

export function LevelUpPlanCard({ part }: { part: LevelUpPart }) {
  const { t } = useLanguage();

  // Ур чадварын part → нийт зорилт нэг ширхэг.
  // Зан чанарын part → нийт зорилт БАЙХГҮЙ (I5), хэсэг тус бүр өөрийн шатлалтай.
  const targets: { key: string; label: string | null; target: LevelUpTarget }[] = part.overall
    ? [{ key: part.part_id, label: null, target: part.overall }]
    : part.sections.map((s) => ({ key: s.section_id, label: s.title, target: s }));

  if (targets.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <TrendingUp className="size-4 text-muted-foreground" aria-hidden />
          {t('assessments.levelUpTitle')}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        {targets.map(({ key, label, target }) => (
          <TargetBlock key={key} label={label} target={target} />
        ))}
      </CardContent>
    </Card>
  );
}

function TargetBlock({ label, target }: { label: string | null; target: LevelUpTarget }) {
  const { t } = useLanguage();

  // ── Дээд түвшин: зөрүү гэж байхгүй ──────────────────────────────────────
  if (target.at_top_level || !target.next_level) {
    return (
      <div className="space-y-1">
        {label && <p className="text-sm font-medium text-foreground">{label}</p>}
        <p className="flex items-center gap-1.5 text-sm font-medium text-success">
          <Sparkles className="size-4 shrink-0" aria-hidden />
          {t('assessments.levelUpAtTop', {
            level: target.current_level?.label ?? '',
            value: fmt(target.current, target.unit),
          })}
        </p>
      </div>
    );
  }

  const next = target.next_level;
  const pctOfWay =
    target.current !== null && next.threshold > 0
      ? Math.min(100, Math.max(0, (target.current / next.threshold) * 100))
      : 0;

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        {label && <p className="text-sm font-medium text-foreground">{label}</p>}
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm tabular-nums text-foreground">
            {fmt(target.current, target.unit)}
          </span>
          {/* ⚠️ Схемийн ТҮҮХИЙ hex-ийг `ui/badge`-ийн дүүргэлт болгож болохгүй:
              `variant="default"` нь `text-primary-foreground`-оо хадгалдаг тул
              текстийн өнгө нь сэдвээс, дэвсгэр нь схемээс гарч контраст
              алдагдана (харанхуй сэдэвт «Суурь хангасан» #e8dfa6 дээр цагаан
              текст = 1.35:1).  `LevelBadge` нь өнгө/дэвсгэр/хүрээг хамт
              alpha-аар барьдаг — assessments дотор түүхий hex харуулах
              КАНОНИК зам тэр. */}
          {target.current_level && <LevelBadge size="sm" level={target.current_level} />}
          <span className="text-muted-foreground" aria-hidden>
            →
          </span>
          <LevelBadge size="sm" level={next} />
          <span className="text-sm tabular-nums text-muted-foreground">
            {fmt(next.threshold, target.unit)}
          </span>
        </div>
        <Progress value={pctOfWay} className="h-1.5" />
        <p className="text-micro text-muted-foreground">
          {t('assessments.levelUpGap', {
            level: next.label,
            gap: fmt(target.gap, target.unit),
          })}
        </p>
      </div>

      {target.steps.length > 0 ? (
        <>
          <p className="text-micro text-muted-foreground">{t('assessments.levelUpHint')}</p>
          <ol className="space-y-2">
            {target.steps.map((step, i) => (
              <StepRow
                key={`${step.section_id}-${step.from.value}-${step.to.value}`}
                step={step}
                index={i}
                unit={target.unit}
              />
            ))}
          </ol>
        </>
      ) : (
        <p className="text-micro text-muted-foreground">{t('assessments.levelUpNoSteps')}</p>
      )}

      {/* ⚠️ Энэ сэрэмжлүүлэг нь `steps.length > 0` салаанаас ГАДНА байх ЁСТОЙ.
          `covered === false`-ийн хамгийн цэвэр тохиолдол нь яг `steps === []`
          — ажилтан ӨӨРИЙН бүх мөрд дээд оноо өгсөн атлаа ахлагчийн үнэлгээ
          хагасыг эзэлдэг тул хүрэхгүй байгаа үе.  Дотор нь үүрлүүлбэл яг тэр
          үед тайлбар нь алга болж, ажилтан «7.0% дутуу» + «ахиулах юм алга»
          гэсэн мухардмал хосыг шалтгаангүй харна (spec §3b). */}
      {!target.covered && (
        <p className="rounded-md border border-warning/30 bg-warning/10 p-2 text-micro text-warning-foreground">
          {t('assessments.levelUpNotCovered', {
            gain: fmt(target.total_gain, target.unit),
            level: next.label,
          })}
        </p>
      )}
    </div>
  );
}

function StepRow({
  step,
  index,
  unit,
}: {
  step: LevelUpStep;
  index: number;
  unit: 'pct' | 'mean';
}) {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);

  return (
    <li className="rounded-lg border border-border">
      <div className="flex flex-wrap items-start gap-2 px-3 py-2">
        <span className="mt-0.5 shrink-0 text-micro font-semibold tabular-nums text-muted-foreground">
          {index + 1}.
        </span>
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-sm font-medium text-foreground">{step.title}</span>
            {step.weight !== null && (
              <span className="text-micro text-muted-foreground">
                {t('assessments.levelUpWeight', { weight: step.weight })}
              </span>
            )}
          </div>
          <p className="text-sm text-muted-foreground">
            {t('assessments.levelUpStep', {
              count: step.item_count,
              from: stopText(step.from, t),
              to: stopText(step.to, t),
            })}
          </p>
          {step.examples.length > 0 && (
            <>
              <button
                type="button"
                onClick={() => setOpen((v) => !v)}
                className="inline-flex items-center gap-1 text-micro text-muted-foreground transition-colors hover:text-foreground"
                aria-expanded={open}
              >
                <ChevronDown
                  className={`size-3 transition-transform ${open ? 'rotate-180' : ''}`}
                  aria-hidden
                />
                {t('assessments.levelUpExamples')}
              </button>
              {open && (
                <ul className="list-disc space-y-0.5 pl-5 text-micro text-muted-foreground">
                  {step.examples.map((ex) => (
                    <li key={ex}>{ex}</li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
        <span className="shrink-0 text-sm font-semibold tabular-nums text-success">
          +{unit === 'pct' ? `${step.gain.toFixed(2)}%` : step.gain.toFixed(2)}
        </span>
      </div>
    </li>
  );
}
