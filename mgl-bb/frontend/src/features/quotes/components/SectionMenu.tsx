/**
 * «Хэсэг» цэс — БД 81-16-20/2020 (заалт 4.22.1, Хүснэгт 10)-ийн зураг төслийн
 * ажлын хэсгүүдийг асаах/унтраах.
 *
 * «Нэмэгдэл» цэстэй ижил зарчим, гэхдээ өөр давхарга: нэмэгдэл нь БАГАНА нэмж
 * мөрийн үнийг өсгөдөг бол хэсэг нь АЗ-ийн үнийг мэргэжлээр нь МӨР болгон
 * задалдаг. Хэсэг бүрийн хувь нь ЗАСАГДАХ нүдэнд сууна — Хүснэгт 10 нь мужаар
 * (20–30% г.м.) өгдөг тул PM өөрөө сонгоно.
 *
 * ⚠️ Нийлбэр 100% байх ШААРДЛАГАГҮЙ — гэрээнд хамрагдах хэсгүүдийг л сонгодог
 * тул 100%-иас бага байх нь хэвийн. Нийлбэрийг зөвхөн МЭДЭЭЛЭЛ болгож үзүүлнэ,
 * хаана ч анхааруулга өгөхгүй.
 *
 * Зөвхөн `sheet.addons.sections` (SectionSpec) тодорхойлогдсон хуудсанд харагдана.
 */
import { useState } from 'react';
import { Check, Plus, Rows3 } from 'lucide-react';

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

import {
  STANDARD_SECTIONS,
  addSection,
  isSectionActive,
  itemLabel,
  sectionPctTotal,
  setSectionPct,
  toggleSection,
} from '../lib/addons';
import type { QuoteLang, SectionItem, SheetDoc } from '../types/quotes';

/**
 * Нэг хэсгийн мөр — чагт + нэр + ЗАСАГДАХ хувь.
 *
 * ⚠️ Хувь нь баганын томьёонд шингэдэг (мөр бүрд нүд байхгүй) тул засварыг
 * ЭНДЭЭС хийнэ. `onBlur`/Enter дээр commit — товшилт бүрд бүх баганыг дахин
 * бичих нь илүүц.
 */
function SectionRow({
  item,
  lang,
  active,
  pct,
  onToggle,
  onPct,
}: {
  item: SectionItem;
  lang: QuoteLang;
  active: boolean;
  pct: number;
  onToggle: () => void;
  onPct: (n: number) => void;
}) {
  const [draft, setDraft] = useState(String(pct));

  const commit = () => {
    const n = Number(draft.replace(',', '.').replace('%', '').trim());
    if (!Number.isFinite(n) || n === pct) {
      setDraft(String(pct));
      return;
    }
    onPct(n);
  };

  return (
    <div className="flex items-center gap-1.5 px-2 py-1 text-xs">
      <button
        type="button"
        onClick={onToggle}
        className="flex min-w-0 flex-1 items-center gap-1.5 text-left hover:underline"
      >
        <Check className={`size-3.5 shrink-0 ${active ? 'opacity-100' : 'opacity-0'}`} />
        <span className="truncate">{itemLabel(item, lang)}</span>
        {item.code !== undefined && (
          <span className="shrink-0 text-muted-foreground">/{item.code}/</span>
        )}
      </button>
      <Input
        value={draft}
        disabled={!active}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
          // Цэс нь сумтай навигацлахыг оролддог — оролтод саад болохгүй.
          e.stopPropagation();
        }}
        inputMode="decimal"
        aria-label={itemLabel(item, lang)}
        className="h-6 w-12 shrink-0 px-1 text-right text-xs tabular-nums"
      />
      <span className="w-2 shrink-0 text-muted-foreground">%</span>
    </div>
  );
}

export interface SectionMenuProps {
  sheet: SheetDoc;
  onChange: (next: SheetDoc) => void;
  /** Баримтын хэл — англи хуудсанд цэс `labelEn`-ээр бичнэ/харуулна. */
  lang?: QuoteLang;
}

export function SectionMenu({ sheet, onChange, lang = 'mn' }: SectionMenuProps) {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState('');

  const spec = sheet.addons?.sections;
  if (!spec) return null;

  /**
   * ⚠️ Энэ баримт дээр хэсэг нь ДҮН-г ЖОЛООДОХ эсэх.
   *
   * Хэсгийн блок 2026-08-05-нд эхлээд зөвхөн ЗАДАРГАА болж гарсан — тэр үеийн
   * загвараас үүссэн саналуудад ДҮН нь бүтэн АЗ-ээс (`R9`) тооцогдсоор байдаг
   * тул хэсэг унтраахад үнэ 0%-иар өөрчлөгдөнө. Дараагийн загварт ДҮН нь
   * хэсгүүдийн нийлбэрээс гардаг болсон ⇒ `costLines.baseRef === sections.sumRef`
   * нь тэр хоёрыг ялгах найдвартай тэмдэг. Хуучин баримт дээр цэсийг идэвхгүй
   * болгоно — ажиллаж байгаа мэт харагдаад үнэ хөдөлдөггүй нь хамгийн муу.
   */
  const drivesTotal = typeof spec.baseCol === 'number' && typeof spec.sumRow === 'number';

  const activeCount = spec.items.length;
  const pctTotal = sectionPctTotal(sheet);

  const addCustom = () => {
    const name = label.trim();
    if (name === '') return;
    // Тогтвортой түлхүүр — стандартуудтай мөргөлдөхгүй.
    const key = `custom-${name.toLowerCase().replace(/\s+/g, '-')}`;
    onChange(addSection(sheet, { key, label: name }, lang));
    setLabel('');
    setOpen(false);
  };

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-7 gap-1 px-2 text-xs"
          disabled={!drivesTotal}
          title={drivesTotal ? undefined : t('quotes.section.inert')}
        >
          <Rows3 className="size-3.5" />
          {t('quotes.section.menu')}
          {activeCount > 0 && (
            <span className="ml-0.5 rounded bg-muted px-1 tabular-nums">{activeCount}</span>
          )}
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="start" className="w-72">
        <DropdownMenuLabel className="text-xs font-normal whitespace-normal text-muted-foreground">
          {t('quotes.section.hint')}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />

        {/* Стандарт + гараар нэмсэн бүх хэсэг, стандарт нь эхэлж. */}
        {[
          ...STANDARD_SECTIONS,
          ...spec.items.filter((x) => !STANDARD_SECTIONS.some((s) => s.key === x.key)),
        ].map((item) => {
          const live = spec.items.find((x) => x.key === item.key);
          return (
            <SectionRow
              key={item.key}
              item={item}
              lang={lang}
              active={isSectionActive(sheet, item.key)}
              pct={live?.pct ?? item.pct ?? 0}
              onToggle={() =>
                onChange(toggleSection(sheet, { ...item, pct: live?.pct ?? item.pct }, lang))
              }
              onPct={(n) => onChange(setSectionPct(sheet, item.key, n, lang))}
            />
          );
        })}

        {activeCount > 0 && (
          <>
            <DropdownMenuSeparator />
            {/* Зөвхөн мэдээлэл — 100%-иас бага байх нь ХЭВИЙН, анхааруулга биш. */}
            <div className="flex items-center justify-between px-2 py-1.5 text-xs">
              <span className="text-muted-foreground">{t('quotes.section.pctTotal')}</span>
              <span className="font-medium tabular-nums">
                {Number.isInteger(pctTotal) ? pctTotal : pctTotal.toFixed(1)}%
              </span>
            </div>
          </>
        )}

        <DropdownMenuSeparator />
        <div className="px-2 py-1.5">
          <p className="mb-1.5 text-micro text-muted-foreground">
            {t('quotes.section.customTitle')}
          </p>
          <div className="flex items-center gap-1.5">
            <Input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder={t('quotes.section.customName')}
              className="h-7 flex-1 text-xs"
              onKeyDown={(e) => e.key === 'Enter' && addCustom()}
            />
            <Button
              type="button"
              size="icon"
              variant="outline"
              className="size-7 shrink-0"
              title={t('quotes.section.customAdd')}
              aria-label={t('quotes.section.customAdd')}
              onClick={addCustom}
            >
              <Plus className="size-3.5" />
            </Button>
          </div>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export default SectionMenu;
