import { CheckCircle2 } from 'lucide-react';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/ui/card';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/i18n';
import type { AssessmentAnswers, AssessmentIntroBlock, AssessmentSection } from '../types';
import { sectionItems } from '../lib/score';
import { pageProgress } from '../lib/progress';
import { RatingRow } from './RatingRow';

/**
 * Wizard-ын нэг хуудасны тодорхойлолт (AssessmentFillPage схемээс бүтээнэ).
 *
 * Хоёр төрөл: ТАНИЛЦУУЛГА (асуултгүй, зөвхөн уншина — эхний хуудас) ба
 * ердийн асуултын хуудас.  Хоёул `sections` талбартай (танилцуулга дээр
 * хоосон) — ингэснээр `lib/progress.ts` ба `useUnansweredJump` нь хуудасны
 * төрлийг мэдэх шаардлагагүй, аль хэдийн бичигдсэн логик хэвээр ажиллана.
 */
export interface AssessmentIntroPageDef {
  kind: 'intro';
  key: string;
  blocks: AssessmentIntroBlock[];
  sections: [];
}

export interface AssessmentSectionsPageDef {
  kind: 'sections';
  key: string;
  part: import('../types').AssessmentPart;
  scale: import('../types').AssessmentScale;
  sections: AssessmentSection[];
}

export type AssessmentPageDef = AssessmentIntroPageDef | AssessmentSectionsPageDef;

interface Props {
  page: AssessmentSectionsPageDef;
  answers: AssessmentAnswers;
  disabled?: boolean;
  onChange: (itemId: string, value: number) => void;
  onCommit?: () => void;
  highlightUnanswered?: boolean;
  spotlightItemId?: string | null;
  className?: string;
}

export function SectionPage({
  page,
  answers,
  disabled,
  onChange,
  onCommit,
  highlightUnanswered,
  spotlightItemId,
  className,
}: Props) {
  const { t } = useLanguage();
  const { part, scale, sections } = page;
  const { remaining } = pageProgress(page, answers);

  return (
    <div className={cn('space-y-6 pt-4', className)}>
      <div className="space-y-1">
        <p className="text-label font-semibold uppercase tracking-wide text-primary">
          {part.title}
        </p>
        {part.intro && (
          <p className="text-body text-muted-foreground">{part.intro}</p>
        )}
        {!disabled && highlightUnanswered && (
          <p
            className={cn(
              'flex items-center gap-1.5 text-micro font-medium',
              remaining > 0 ? 'text-warning-foreground' : 'text-success',
            )}
          >
            {remaining > 0 ? (
              t('assessments.pageRemaining', { n: remaining })
            ) : (
              <>
                <CheckCircle2 className="h-3.5 w-3.5 shrink-0" aria-hidden />
                {t('assessments.pageComplete')}
              </>
            )}
          </p>
        )}
      </div>

      {sections.map((section) => {
        const total = sectionItems(section).length;
        let counter = 0;

        return (
          <section key={section.id} className="space-y-3">
            <header className="space-y-1">
              <h2 className="text-lg font-semibold leading-tight text-foreground">
                {section.title}
              </h2>
              {section.subtitle && (
                <p className="text-sm font-medium text-muted-foreground">{section.subtitle}</p>
              )}
              {section.description && (
                <p className="text-sm leading-relaxed text-muted-foreground">
                  {section.description}
                </p>
              )}
            </header>

            {section.groups.map((group) => (
              <Card key={group.id} className="border-border bg-card/60">
                {(group.title || group.hint) && (
                  <CardHeader className="pb-2">
                    {group.title && (
                      <CardTitle className="text-base leading-tight">{group.title}</CardTitle>
                    )}
                    {group.hint && (
                      <CardDescription className="leading-snug">{group.hint}</CardDescription>
                    )}
                  </CardHeader>
                )}
                <CardContent className="divide-y divide-border/60 py-1">
                  {group.items.map((item) => {
                    counter += 1;
                    return (
                      <RatingRow
                        key={item.id}
                        item={item}
                        index={counter}
                        options={scale.options}
                        value={answers[item.id]}
                        disabled={disabled}
                        onChange={(v) => onChange(item.id, v)}
                        onCommit={onCommit}
                        highlightUnanswered={highlightUnanswered}
                        spotlight={spotlightItemId === item.id}
                      />
                    );
                  })}
                </CardContent>
              </Card>
            ))}

            {total === 0 && (
              <p className="rounded-md border border-dashed border-border p-4 text-sm text-muted-foreground">
                —
              </p>
            )}
          </section>
        );
      })}
    </div>
  );
}

export default SectionPage;
