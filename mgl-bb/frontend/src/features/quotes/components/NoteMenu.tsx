/**
 * «Тайлбар» цэс — баримтын ДООД ХЭСГИЙН өгүүлбэрүүдийг удирдана.
 *
 * Өгүүлбэр бүр нь ХУУДАСНЫ БОДИТ АГУУЛГААС автоматаар үүсдэг («Төсөв 8%»
 * нэмэгдэл унтарвал 4.19-ийн өгүүлбэрээс тэр хэсэг арилна, инженер геологийн
 * тоо хэмжээ хоосон бол БД 81-117-13-ийн өгүүлбэр огт гарахгүй г.м. —
 * `lib/quoteNotes.ts`). Энэ цэс нь тэр автоматыг ХАРУУЛЖ, шаардвал ДАРНА:
 *
 *   • тэмдэг — тухайн өгүүлбэрийг хүчээр асаах / унтраах;
 *   • харандаа — өгүүлбэрийн бичвэрийг гараар бичих (хоосон болговол
 *     автомат бичвэр рүү буцна);
 *   • доод хэсгийн талбар — өөрийн шинэ тайлбар нэмэх.
 *
 * ⚠️ `AddonMenu`/`SectionMenu`-тэй ЗОРИУД ижил бүтэцтэй: PM гурвыг дараалан
 * хэрэглэдэг тул зан төлөв нь адил байх ёстой.
 */
import { useState } from 'react';
import { Check, MessageSquareText, Pencil, Plus, X } from 'lucide-react';

import { useLanguage } from '@/shared/i18n';
import { Button } from '@/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/ui/dropdown-menu';
import { Input } from '@/ui/input';
import { Textarea } from '@/ui/textarea';

import {
  NOTE_RULES,
  addCustomNote,
  contractActiveText,
  customNotes,
  hasNoteBlocks,
  isContractNoteActive,
  isNoteActive,
  noteCtx,
  noteMenuLabel,
  noteText,
  removeCustomNote,
  setContractNoteText,
  setNoteText,
  toggleContractNote,
  toggleNote,
} from '../lib/quoteNotes';
import type { QuoteLang, SheetDoc } from '../types/quotes';

/**
 * Нэг тайлбарын мөр.
 *
 * ⚠️ Оролт дотор `stopPropagation` ЗААВАЛ — dropdown нь товчлуурын сумаар
 * навигацлахыг оролддог тул эс бөгөөс бичих боломжгүй болно (`AddonRow`-той
 * ижил шалтгаан).
 */
function NoteRow({
  label,
  active,
  text,
  manual,
  onToggle,
  onText,
}: {
  /** Цэсэнд харагдах нэр. `NoteRule`-ээс ХАМААРАХГҮЙ — гэрээний хамрах
   *  хүрээний өгүүлбэр нь дүрмийн жагсаалтад ордоггүй, гэвч ижил мөр хэрэгтэй. */
  label: string;
  active: boolean;
  text: string;
  manual: boolean;
  onToggle: () => void;
  onText: (s: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(text);

  const commit = () => {
    setEditing(false);
    if (draft.trim() === text.trim()) return;
    onText(draft);
  };

  return (
    <div className="px-2 py-1 text-xs">
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={onToggle}
          className="flex min-w-0 flex-1 items-center gap-1.5 text-left hover:underline"
        >
          <Check className={`size-3.5 shrink-0 ${active ? 'opacity-100' : 'opacity-0'}`} />
          <span className="truncate">{label}</span>
        </button>
        <Button
          type="button"
          size="icon"
          variant={manual ? 'secondary' : 'ghost'}
          disabled={!active}
          className="size-6 shrink-0"
          onClick={() => {
            setDraft(text);
            setEditing((v) => !v);
          }}
        >
          <Pencil className="size-3" />
        </Button>
      </div>
      {/* Идэвхтэй өгүүлбэрийн БОДИТ бичвэрийг үргэлж харуулна — PM «юу хэвлэгдэх
          вэ»-г цэснээс шууд уншина, баримт руу гүйлгэх шаардлагагүй. */}
      {active && !editing && (
        <p className="mt-0.5 pl-5 text-micro leading-snug text-muted-foreground">{text}</p>
      )}
      {editing && (
        <Textarea
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              setEditing(false);
              setDraft(text);
            }
            e.stopPropagation();
          }}
          rows={3}
          className="mt-1 text-xs"
        />
      )}
    </div>
  );
}

export interface NoteMenuProps {
  sheet: SheetDoc;
  onChange: (next: SheetDoc) => void;
  /** Баримтын хэл — англи хуудсанд цэс ч, бичигдэх өгүүлбэр ч англиар. */
  lang?: QuoteLang;
}

export function NoteMenu({ sheet, onChange, lang = 'mn' }: NoteMenuProps) {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');

  // ⚠️ hook-ийн дараалал тасрахгүйн тулд ЭРТ БУЦААХААС ӨМНӨ бодно.
  const ctx = noteCtx(sheet);
  const custom = customNotes(sheet);
  const contractOn = isContractNoteActive(sheet);
  const active =
    NOTE_RULES.filter((r) => isNoteActive(sheet, r.key, ctx)).length +
    custom.length +
    (contractOn ? 1 : 0);

  /* Блок хуудсанд БАЙХГҮЙ байсан ч цэс АЖИЛЛАНА.
   *
   * ⚠️ 0185-аас өмнөх загвараар үүссэн саналуудын хуудсанд «Тайлбар:» блок огт
   * байдаггүй, гэвч тэдний тайлбар нь хэвлэмэл дээр `lib/quoteNotes.ts`-ийн
   * дүрмээр ГАРГАГДДАГ. Төлөв нь мөрөнд БИШ, `sheet.notes`-д ТҮЛХҮҮРЭЭР
   * хадгалагддаг тул хуучин хуудсанд мөр оруулахгүйгээр асаах/унтраах бүрэн
   * ажиллана. Тиймээс шалгуур нь «нэмэгдлийн spec байна уу» (= үнийн саналын
   * хуудас) байхад хангалттай.
   *
   * Блок байгаа үед `syncNotes` нүднүүдийг ч дагуулна (засварлагч, Excel). */
  const blocksExist = hasNoteBlocks(sheet);
  if (!blocksExist && !sheet.addons) return null;

  const addDraft = () => {
    const text = draft.trim();
    if (text === '' || !blocksExist) return; // өөрийн тайлбар нь МӨР шаарддаг
    onChange(addCustomNote(sheet, 'bd', text, lang));
    setDraft('');
  };

  const groups: { group: 'bd' | 'material'; title: string }[] = [
    { group: 'bd', title: t('quotes.note.bdTitle') },
    { group: 'material', title: t('quotes.note.materialTitle') },
  ];

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button type="button" size="sm" variant="outline" className="h-7 gap-1 px-2 text-xs">
          <MessageSquareText className="size-3.5" />
          {t('quotes.note.menu')}
          {active > 0 && (
            <span className="ml-0.5 rounded bg-muted px-1 tabular-nums">{active}</span>
          )}
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="start" className="max-h-[70vh] w-96 overflow-y-auto">
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
          {t('quotes.note.hint')}
        </DropdownMenuLabel>

        {groups.map(({ group, title }) => (
          <div key={group}>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-micro font-normal text-muted-foreground">
              {title}
            </DropdownMenuLabel>
            {NOTE_RULES.filter((r) => r.group === group).map((rule) => (
              <NoteRow
                key={rule.key}
                label={noteMenuLabel(rule, lang)}
                active={isNoteActive(sheet, rule.key, ctx)}
                text={noteText(sheet, rule.key, lang, ctx)}
                manual={sheet.notes?.text?.[rule.key] !== undefined}
                onToggle={() => onChange(toggleNote(sheet, rule.key, lang))}
                onText={(s) => onChange(setNoteText(sheet, rule.key, s, lang))}
              />
            ))}
          </div>
        ))}

        {/* ГЭРЭЭНИЙ ХАМРАХ ХҮРЭЭ — блокийн ГАДНА, ганц мөр (`CONTRACT_NOTE_KEY`).
            ⚠️ 2026-08-25 хүртэл энэ өгүүлбэрт УНТРААХ БОЛОМЖ ОГТ БАЙГААГҮЙ:
            хэвлэмэл нь түүнийг дүрмээр гаргадаг ба цэсэнд мөр нь байхгүй тул PM
            зөвхөн хуудсан дээрх нүдийг устгаж чаддаг байсан — тэр нь төлөвт
            буудаггүй учир PDF дээр өгүүлбэр ХЭВЭЭР гарсаар байв. */}
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-micro font-normal text-muted-foreground">
          {t('quotes.note.contractTitle')}
        </DropdownMenuLabel>
        <NoteRow
          label={t('quotes.note.contractLabel')}
          active={contractOn}
          text={contractActiveText(sheet, lang, ctx)}
          manual={sheet.notes?.text?.contract !== undefined}
          onToggle={() => onChange(toggleContractNote(sheet, lang))}
          onText={(s) => onChange(setContractNoteText(sheet, s, lang))}
        />

        {/* PM-ийн ГАРААР нэмсэн тайлбарууд — дүрэмгүй тул автоматад ороогүй,
            зөвхөн эндээс устгана. */}
        {custom.length > 0 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-micro font-normal text-muted-foreground">
              {t('quotes.note.customList')}
            </DropdownMenuLabel>
            {custom.map((c) => (
              <div key={`${c.group}:${c.text}`} className="flex items-start gap-1.5 px-2 py-1">
                <span className="min-w-0 flex-1 text-micro leading-snug">{c.text}</span>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="size-6 shrink-0"
                  aria-label={t('quotes.note.remove')}
                  onClick={() => onChange(removeCustomNote(sheet, c.group, c.text, lang))}
                >
                  <X className="size-3" />
                </Button>
              </div>
            ))}
          </>
        )}

        {/* «Өөрийн тайлбар» нь хуудсанд МӨР оруулдаг тул блокгүй (хуучин) хуудсанд
            харагдахгүй — тэнд стандарт өгүүлбэрүүдийг асаах/унтраах, гараар
            бичих боломж хэвээр. */}
        {blocksExist && (
          <>
            <DropdownMenuSeparator />
            <div className="px-2 py-1.5">
              <p className="mb-1.5 text-micro text-muted-foreground">
                {t('quotes.note.customTitle')}
              </p>
              <div className="flex items-center gap-1.5">
                <Input
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder={t('quotes.note.customPlaceholder')}
                  className="h-7 flex-1 text-xs"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') addDraft();
                    e.stopPropagation();
                  }}
                />
                <Button
                  type="button"
                  size="icon"
                  variant="outline"
                  className="size-7 shrink-0"
                  title={t('quotes.note.customAdd')}
                  aria-label={t('quotes.note.customAdd')}
                  onClick={addDraft}
                >
                  <Plus className="size-3.5" />
                </Button>
              </div>
            </div>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export default NoteMenu;
