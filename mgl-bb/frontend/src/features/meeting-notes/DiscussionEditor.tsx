import { Input } from '@/ui/input';
import { Button } from '@/ui/button';
import { Textarea } from '@/ui/textarea';
import { Plus, Trash2, ListPlus, Building2 } from 'lucide-react';
import { useLanguage } from '@/shared/i18n';
import type { DiscussionSection } from './types';

/** Протоколд байнга ордог талуудын стандарт гарчгууд — нэг товчоор нэмэгдэнэ.
 *  Хэвлэгдэх баримт монголоор тул i18n-гүй (ParticipantsEditor-ийн org-той адил
 *  чөлөөт текст хэвээр — хүссэн гарчгаа бичиж болно). */
const PRESET_HEADINGS = [
  'Захиалагч',
  'Захиалагчийн хяналтын газар',
  'Гүйцэтгэгч',
  'Гүйцэтгэгчийн зөвлөх',
];

/** Editor for the "Хэлэлцсэн асуудал" sections: each section prints as a
 *  numbered "1.N <heading>" table (№ / Хүсэлт гаргагч / Тайлбар) on the minutes
 *  PDF — see MeetingPrintPage.  The parent owns the state (same contract as
 *  ParticipantsEditor). */
export function DiscussionEditor({
  value,
  onChange,
}: {
  value: DiscussionSection[];
  onChange: (next: DiscussionSection[]) => void;
}) {
  const { t, lang } = useLanguage();

  const patchSection = (si: number, patch: Partial<DiscussionSection>) =>
    onChange(value.map((s, i) => (i === si ? { ...s, ...patch } : s)));

  const addSection = (heading: string) =>
    onChange([...value, { heading, org: '', items: [''] }]);
  const removeSection = (si: number) => onChange(value.filter((_, i) => i !== si));

  const addItem = (si: number) => patchSection(si, { items: [...value[si]!.items, ''] });
  const removeItem = (si: number, ii: number) =>
    patchSection(si, { items: value[si]!.items.filter((_, i) => i !== ii) });
  const patchItem = (si: number, ii: number, text: string) =>
    patchSection(si, { items: value[si]!.items.map((x, i) => (i === ii ? text : x)) });

  const usedHeadings = new Set(value.map((s) => s.heading));

  return (
    <div className="space-y-3">
      {value.map((section, si) => (
        <div key={si} className="rounded-lg border border-border p-3 space-y-2 bg-muted/20">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-muted-foreground flex-shrink-0 w-7">
              1.{si + 1}
            </span>
            <Input
              value={section.heading}
              onChange={(e) => patchSection(si, { heading: e.target.value })}
              placeholder={t('meetingNotes.sectionHeadingPlaceholder')}
              className="h-8"
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-muted-foreground hover:text-destructive flex-shrink-0"
              onClick={() => removeSection(si)}
              title={t('meetingNotes.removeSection')}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>

          <div className="flex items-center gap-2 pl-9">
            <Building2 className="h-4 w-4 text-muted-foreground flex-shrink-0" />
            <Input
              value={section.org}
              onChange={(e) => patchSection(si, { org: e.target.value })}
              placeholder={t('meetingNotes.requesterPlaceholder')}
              className="h-8"
            />
          </div>

          <div className="space-y-1.5 pl-9">
            {section.items.map((item, ii) => (
              <div key={ii} className="flex items-start gap-2">
                <span className="text-xs text-muted-foreground mt-2 w-4 text-right flex-shrink-0">
                  {ii + 1}
                </span>
                <Textarea
                  value={item}
                  onChange={(e) => patchItem(si, ii, e.target.value)}
                  placeholder={t('meetingNotes.discussionItemPlaceholder')}
                  rows={2}
                  className="text-sm min-h-0"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-muted-foreground hover:text-destructive flex-shrink-0"
                  onClick={() => removeItem(si, ii)}
                  aria-label={lang === 'mn' ? 'Мөр устгах' : 'Remove item'}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 text-xs text-muted-foreground"
              onClick={() => addItem(si)}
            >
              <ListPlus className="h-3.5 w-3.5 mr-1.5" /> {t('meetingNotes.addDiscussionItem')}
            </Button>
          </div>
        </div>
      ))}

      <div className="flex flex-wrap gap-2">
        {PRESET_HEADINGS.filter((h) => !usedHeadings.has(h)).map((h) => (
          <Button key={h} type="button" variant="outline" size="sm" onClick={() => addSection(h)}>
            <Plus className="h-4 w-4 mr-2" /> {h}
          </Button>
        ))}
        <Button type="button" variant="ghost" size="sm" onClick={() => addSection('')}>
          <Plus className="h-4 w-4 mr-2" /> {t('meetingNotes.addSection')}
        </Button>
      </div>
    </div>
  );
}
