/**
 * Судалгааны ТАНИЛЦУУЛГА хуудас — wizard-ын хамгийн эхний хуудас.
 *
 * Word-оос ирсэн оноо өгөх мөргүй хэсгүүд («СУДАЛГААНЫ АГУУЛГА», «СУДАЛГАА
 * НЬ ҮНДСЭН 2 ХЭСЭГТ ХУВААГДАНА») энд гарна: ажилтан бөглөж эхлэхийн ӨМНӨ
 * уншина.  Асуулт байхгүй тул явцын тоололд огт нөлөөлөхгүй
 * (`sections: []` — `lib/progress.ts` үүнийг өөрөө зөв тоолно).
 */
import { BookOpen } from 'lucide-react';

import { useLanguage } from '@/shared/i18n';
import { cn } from '@/shared/lib/utils';
import { Card, CardContent } from '@/ui/card';

import type { AssessmentIntroBlock } from '../types';

interface Props {
  blocks: AssessmentIntroBlock[];
  className?: string;
}

export function IntroPage({ blocks, className }: Props) {
  const { t } = useLanguage();

  return (
    <div className={cn('space-y-4 pt-4', className)}>
      <div className="flex items-center gap-2">
        <BookOpen className="size-4 shrink-0 text-primary" aria-hidden />
        <p className="text-label font-semibold uppercase tracking-wide text-primary">
          {t('assessments.introPageTitle')}
        </p>
      </div>

      {blocks.map((block) => (
        <Card key={block.id} className="border-border bg-card/60">
          <CardContent className="space-y-2 py-4">
            {block.heading && (
              <h2 className="text-lg font-semibold leading-tight text-foreground">
                {block.heading}
              </h2>
            )}
            {block.body && (
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">
                {block.body}
              </p>
            )}
          </CardContent>
        </Card>
      ))}

      <p className="text-sm text-muted-foreground">{t('assessments.introPageFooter')}</p>
    </div>
  );
}

export default IntroPage;
