/**
 * «Нэмэгдэл» цэс — БД 81-16-20/2020 (4.19, 4.21)-ийн хувийн нэмэгдэл багануудыг
 * асаах/унтраах.
 *
 * Төсөл бүрт өөр багц хэрэгтэй (жишээ нь агуулахад хөргөлт байхгүй) тул
 * загварт бүгдийг хатуу суулгахын оронд PM эндээс сонгоно. Асаахад багана
 * бүх өгөгдлийн мөрөнд томьёотой орж, бүлгийн толгой ба «Нийт үнэ» автоматаар
 * дагана; унтраахад бүрэн арилна.
 *
 * Зөвхөн `sheet.addons` (AddonSpec) тодорхойлогдсон хуудсанд харагдана.
 */
import { useState } from 'react';
import { Check, Plus, SlidersHorizontal } from 'lucide-react';

import { useLanguage } from '@/shared/i18n';
import { Button } from '@/ui/button';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/ui/dropdown-menu';
import { Input } from '@/ui/input';

import {
  STANDARD_ADDONS,
  STANDARD_COST_LINES,
  STANDARD_LINE_ADDONS,
  addAddon,
  isAddonActive,
  isCostLineActive,
  isLineAddonActive,
  itemLabel,
  setAddonPct,
  toggleAddon,
  toggleCostLine,
  toggleLineAddon,
} from '../lib/addons';
import { syncNotes } from '../lib/quoteNotes';
import {
  OPTIONAL_COL_GROUPS,
  groupApplies,
  groupCols,
  groupLabel,
  isGroupVisible,
  toggleGroup,
} from '../lib/optionalCols';
import type { AddonItem, CostLineItem, QuoteLang, SheetDoc } from '../types/quotes';

/**
 * Зардлын мөрийн ард гарах төрлийн зөвлөмж: хувь бол «15%», тоо хэмжээ бол
 * нэгж («га»), шууд дүн (`flat`) бол юу ч биш — PM дүнг гараар бичнэ.
 */
function costLineHint(item: CostLineItem): string {
  if (item.kind === 'percent') return item.pct === undefined ? '' : `${item.pct}%`;
  if (item.kind === 'qty') return item.unit ?? '';
  return '';
}

/**
 * Нэмэгдлийн мөр — асаах/унтраах + ХУВЬ засах.
 *
 * `SectionMenu`-гийн `SectionRow`-той зориуд ижил бүтэцтэй: PM хоёр цэсийг
 * дараалан хэрэглэдэг тул зан төлөв нь адил байх ёстой.
 *
 * ⚠️ Хувийн оролт нь ИДЭВХГҮЙ нэмэгдэл дээр disabled: багана нь хуудсанд
 * байхгүй үед бичих томьёо ч байхгүй. Эхлээд асаагаад дараа нь хувийг соль.
 */
function AddonRow({
  item,
  lang,
  active,
  pct,
  onToggle,
  onPct,
}: {
  item: AddonItem;
  lang: QuoteLang;
  active: boolean;
  pct: number;
  onToggle: () => void;
  onPct: (n: number) => void;
}) {
  const [draft, setDraft] = useState(String(pct));

  const commit = () => {
    const n = Number(draft.replace(',', '.').replace('%', '').trim());
    // Хоосон / утгагүй / өөрчлөгдөөгүй бол хуучин утгыг сэргээгээд чимээгүй гарна.
    if (!Number.isFinite(n) || n < 0 || n === pct) {
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

export interface AddonMenuProps {
  sheet: SheetDoc;
  onChange: (next: SheetDoc) => void;
  /** Баримтын хэл — англи хуудсанд цэс `labelEn`-ээр бичнэ/харуулна. */
  lang?: QuoteLang;
}

export function AddonMenu({ sheet, onChange, lang = 'mn' }: AddonMenuProps) {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState('');
  const [pct, setPct] = useState('');

  // ⚠️ hook-ийн дараалал тасрахгүйн тулд ЭРТ БУЦААХААС ӨМНӨ бодно.
  const applicableGroups = OPTIONAL_COL_GROUPS.filter((g) => groupApplies(sheet, g));

  const spec = sheet.addons;
  if (!spec) return null;

  const activeCount = spec.items.length;

  const addCustom = () => {
    const name = label.trim();
    const n = Number(pct.replace(',', '.'));
    if (name === '' || !Number.isFinite(n) || n <= 0) return;
    // Тогтвортой түлхүүр — стандартуудтай мөргөлдөхгүй.
    const key = `custom-${name.toLowerCase().replace(/\s+/g, '-')}-${n}`;
    onChange(syncNotes(addAddon(sheet, { key, label: name, pct: n }, lang), lang));
    setLabel('');
    setPct('');
    setOpen(false);
  };

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button type="button" size="sm" variant="outline" className="h-7 gap-1 px-2 text-xs">
          <SlidersHorizontal className="size-3.5" />
          {t('quotes.addon.menu')}
          {activeCount > 0 && (
            <span className="ml-0.5 rounded bg-muted px-1 tabular-nums">{activeCount}</span>
          )}
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="start" className="w-72">
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
          {t('quotes.addon.hint')}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />

        {/* Стандарт + гараар нэмсэн бүх нэмэгдэл, стандарт нь эхэлж. */}
        {[
          ...STANDARD_ADDONS,
          ...spec.items.filter((x) => !STANDARD_ADDONS.some((s) => s.key === x.key)),
        ].map((item) => {
          // Хуудсан дээрх БОДИТ утга (PM хувийг нь өөрчилсөн байж болно) —
          // загварын анхны утга нь зөвхөн нөөц.
          const live = spec.items.find((x) => x.key === item.key);
          const pct = live?.pct ?? item.pct;
          return (
            <AddonRow
              // ⚠️ Түлхүүрт хувийг оруулсан нь ЗОРИУД: хувь гаднаас өөрчлөгдвөл
              // мөр дахин mount хийгдэж, оролтын ноорог шинэ утгатай синклэнэ.
              key={`${item.key}:${pct}`}
              item={item}
              lang={lang}
              active={isAddonActive(sheet, item.key)}
              pct={pct}
              // ⚠️ Унтраагаад дахин асаахад PM-ийн засварласан хувь ХАДГАЛАГДАНА
              // (стандарт утга руу буцахгүй) — `SectionMenu`-тэй ижил.
              onToggle={() => onChange(syncNotes(toggleAddon(sheet, { ...item, pct }, lang), lang))}
              onPct={(n) => onChange(syncNotes(setAddonPct(sheet, item.key, n), lang))}
            />
          );
        })}

        {/* ДҮН-д ордог ЗАРДЛЫН мөрүүд (эскиз, ерөнхий төлөвлөгөө, геологи г.м.) —
            ажлын зургийн үнийн дараа, ДҮН-гийн ӨМНӨ мөрөөр нэмэгдэнэ. */}
        {spec.costLines && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-micro font-normal text-muted-foreground">
              {t('quotes.addon.costTitle')}
            </DropdownMenuLabel>
            {STANDARD_COST_LINES.map((item) => {
              const hint = costLineHint(item);
              return (
                <DropdownMenuCheckboxItem
                  key={item.key}
                  checked={isCostLineActive(sheet, item.key)}
                  onSelect={(e) => {
                    e.preventDefault();
                    onChange(syncNotes(toggleCostLine(sheet, item, lang), lang));
                  }}
                  className="text-xs"
                >
                  {itemLabel(item, lang)}
                  {hint !== '' && <span className="ml-1 text-muted-foreground">({hint})</span>}
                </DropdownMenuCheckboxItem>
              );
            })}
          </>
        )}

        {/* Баримтын доод хэсгийн МӨРИЙН нэмэгдэл (хөнгөлөлт г.м.) — НИЙТ ДҮН-гийн
            дээр орж, хувь нь ЗАСАГДАХ нүдэнд сууна. */}
        {spec.lines && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-micro font-normal text-muted-foreground">
              {t('quotes.addon.lineTitle')}
            </DropdownMenuLabel>
            {STANDARD_LINE_ADDONS.map((item) => (
              <DropdownMenuCheckboxItem
                key={item.key}
                checked={isLineAddonActive(sheet, item.key)}
                onSelect={(e) => {
                  e.preventDefault();
                  onChange(toggleLineAddon(sheet, item, lang));
                }}
                className="text-xs"
              >
                {itemLabel(item, lang)} ({item.sign === -1 ? '−' : ''}
                {item.pct}%)
              </DropdownMenuCheckboxItem>
            ))}
          </>
        )}

        {/* СОНГОМОЛ БАГАНЫ БҮЛЭГ («Өндөр» г.м.) — харуулах / нуух.
            ⚠️ Дээрх бүх мөрөөс ЗАРЧМЫН ХУВЬД ӨӨР: эдгээр нь багана УСТГАХГҮЙ,
            зөвхөн нууна — тиймээс ҮНЭ ХЭЗЭЭ Ч ӨӨРЧЛӨГДӨХГҮЙ. Тэмдэг тавигдсан
            = ХАРАГДАНА (бусад мөртэй ижил уншигдана).
            Зөвхөн тухайн хуудсанд ХАМААРАЛТАЙ (толгой нь олдсон) бүлэг гарна. */}
        {applicableGroups.length > 0 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-micro font-normal text-muted-foreground">
              {t('quotes.addon.colsTitle')}
            </DropdownMenuLabel>
            {applicableGroups.map((group) => (
              <DropdownMenuCheckboxItem
                key={group.key}
                checked={isGroupVisible(sheet, group.key)}
                onSelect={(e) => {
                  e.preventDefault();
                  onChange(toggleGroup(sheet, group.key));
                }}
                className="text-xs"
              >
                {groupLabel(group, lang)}
                <span className="ml-1 text-muted-foreground">
                  ({groupCols(sheet, group).length})
                </span>
              </DropdownMenuCheckboxItem>
            ))}
          </>
        )}

        <DropdownMenuSeparator />
        <div className="px-2 py-1.5">
          <p className="mb-1.5 text-micro text-muted-foreground">{t('quotes.addon.customTitle')}</p>
          <div className="flex items-center gap-1.5">
            <Input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder={t('quotes.addon.customName')}
              className="h-7 flex-1 text-xs"
              onKeyDown={(e) => e.key === 'Enter' && addCustom()}
            />
            <Input
              value={pct}
              onChange={(e) => setPct(e.target.value)}
              placeholder="%"
              inputMode="decimal"
              className="h-7 w-14 text-xs"
              onKeyDown={(e) => e.key === 'Enter' && addCustom()}
            />
            <Button
              type="button"
              size="icon"
              variant="outline"
              className="size-7 shrink-0"
              title={t('quotes.addon.customAdd')}
              aria-label={t('quotes.addon.customAdd')}
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

export default AddonMenu;
