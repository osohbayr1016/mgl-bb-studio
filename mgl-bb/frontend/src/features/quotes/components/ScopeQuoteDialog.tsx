/**
 * «Хэсэгчилсэн санал» диалог — «зөвхөн эскиз зураг хийлгэвэл хэд болох вэ?»
 *
 * Хамрах хүрээг тэмдэглэхэд ШИНЭ НИЙТ ДҮН нь тэр дороо гарч ирнэ: диалог нь
 * хумигдсан дэвтрийг бодитоор угсраад (`applyScope`) баримттай ЯГ ИЖИЛ
 * хөдөлгүүрээр (`useQuoteWorkbook`) тооцоолж, `resolveAnchor`-оор дүнг уншина.
 * Тиймээс дэлгэц дээрх тоо нь үүсэх баримтын тоотой БАЙТ БҮРЭЭРЭЭ ижил —
 * PM ихэнхдээ баримт үүсгэлгүйгээр л асуултад хариулж чадна.
 *
 * ⚠️ ЗАСВАРЛАЖ БУЙ БАРИМТ ХЭВЭЭР ҮЛДЭНЭ. «Үүсгэх» нь ШИНЭ, тусдаа санал
 * (`POST /api/quotes/:id/scope`) бөгөөд эх санал огт хөндөгдөхгүй — тиймээс
 * бүтэн саналаа алдах вий гэсэн айдасгүйгээр туршиж болно.
 */
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';

import { toast } from '@/shared/components/Toast';
import { useLanguage } from '@/shared/i18n';
import { Button } from '@/ui/button';
import { Checkbox } from '@/ui/checkbox';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/ui/dialog';
import { Label } from '@/ui/label';

import { QUOTES_FUNNEL_KEY, QUOTES_LIST_KEY, createScopeQuote } from '../api/quotes';
import { useQuoteWorkbook } from '../hooks/useQuoteWorkbook';
import { resolveAnchor } from '../lib/resolveTotal';
import {
  AZ_SCOPE_KEY,
  applyScope,
  readScope,
  scopeTitle,
  scopeVariantKeys,
  type ScopeItem,
} from '../lib/scopeQuote';
import type { Quote, WorkbookDoc } from '../types/quotes';

/**
 * «Зөвхөн эскиз» товшилтын түлхүүр — `STANDARD_COST_LINES`-ийн эскизийн мөртэй
 * ижил (`lib/addons.ts`). Тэр түлхүүрийг өөрчилвөл энэ товч чимээгүй ажиллахаа
 * болино (мөр олдохгүй тул харагдахгүй).
 */
const SKETCH_KEY = 'sketch';

export function ScopeQuoteDialog({
  quote,
  workbook,
  open,
  onOpenChange,
  onBeforeCreate,
}: {
  quote: Quote;
  /** Засварлагчийн ОДООГИЙН (хадгалагдаагүй ч) дэвтэр. */
  workbook: WorkbookDoc;
  open: boolean;
  onOpenChange: (next: boolean) => void;
  /** Шинэ баримт руу шилжихийн өмнө эх ноорогийг батлах (autosave commit). */
  onBeforeCreate?: () => void;
}) {
  const { t } = useLanguage();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>{t('quotes.scope.title')}</DialogTitle>
        </DialogHeader>
        {/*
          ⚠️ `key` нь ЗОРИУДЫН (`QuoteStatusDialog`-той ижил хэв маяг): анхны
          тэмдэглэгээ нь дэвтрээс гардаг тул диалогийг дахин нээхэд шинээр
          угсарна — өмнөх сонголт «наалдаж» үлдэх ёсгүй.
        */}
        {open && (
          <ScopeForm
            key={quote.id}
            quote={quote}
            workbook={workbook}
            onDone={() => onOpenChange(false)}
            onBeforeCreate={onBeforeCreate}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function ScopeForm({
  quote,
  workbook,
  onDone,
  onBeforeCreate,
}: {
  quote: Quote;
  workbook: WorkbookDoc;
  onDone: () => void;
  onBeforeCreate?: () => void;
}) {
  const { t } = useLanguage();
  const qc = useQueryClient();
  const navigate = useNavigate();

  const scope = useMemo(() => readScope(workbook, t('quotes.variant.design')), [workbook, t]);
  // ⚠️ ТУСДАА memo: `scope?.items ?? []` нь рендэр бүрд ШИНЭ массив үүсгэдэг тул
  // доорх `useMemo`-нуудын хамаарал байнга шинэчлэгдэж, дэвтэр дахин тооцоологдоно.
  const items: ScopeItem[] = useMemo(() => scope?.items ?? [], [scope]);

  /**
   * Анхдагч тэмдэглэгээ — ЭСКИЗ (байвал) ганцаараа.
   *
   * Яагаад «бүгд» биш: бүгдийг тэмдэглэх нь эх саналын ХУУЛБАР болно, тэр нь
   * энэ товчны зорилго биш. Хэрэглэгчийн бодит асуулт «зөвхөн эскиз бол хэд
   * вэ?» тул тэр хариулт диалог нээмэгц бэлэн байна — үлдсэн нь нэг товшилт.
   */
  const [selected, setSelected] = useState<string[]>(() => {
    const hasSketch = items.some((x) => x.key === SKETCH_KEY);
    return hasSketch ? [SKETCH_KEY] : items.slice(0, 1).map((x) => x.key);
  });

  const toggle = (key: string) =>
    setSelected((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));

  // Хумигдсан дэвтэр + түүний ЖИНХЭНЭ дүн (баримттай ижил хөдөлгүүрээр).
  const preview = useMemo(
    () => applyScope(workbook, selected, quote.lang),
    [workbook, selected, quote.lang],
  );
  const { bySheet, tariffsLoading } = useQuoteWorkbook(preview, quote.lang);
  const resolved = useMemo(() => resolveAnchor(preview, 'total', bySheet), [preview, bySheet]);
  const total = resolved.value;

  // Сонгосон зүйлсийн шошго — гарчгийн дагавар ба хураангуй мөрөнд.
  const selectedLabels = useMemo(
    () => items.filter((x) => selected.includes(x.key)).map((x) => x.label),
    [items, selected],
  );

  const mutation = useMutation({
    mutationFn: () =>
      createScopeQuote(quote.id, {
        workbook: preview,
        title: scopeTitle(quote.title, selectedLabels),
        variant_keys: scopeVariantKeys(selected),
        // ⚠️ Тариф ачаалагдаж дуустал бүх `TARIF()` `#ТАРИФ!` тул дүн худал 0
        // байна — тэр агшинд кэш бичихгүй, NULL илгээнэ (засварлагч нээгдэхдээ
        // өөрөө нөхнө). `QuoteEditorPage`-ийн `totalRef`-тэй ижил хамгаалалт.
        total_amount: tariffsLoading ? null : total,
      }),
    onSuccess: (created) => {
      qc.invalidateQueries({ queryKey: QUOTES_LIST_KEY });
      qc.invalidateQueries({ queryKey: QUOTES_FUNNEL_KEY });
      onDone();
      toast.success(t('quotes.scope.created'));
      navigate(`/app/quotes/${created.id}`);
    },
    onError: (err) => {
      toast.error(t('quotes.scope.failed'), err instanceof Error ? err.message : undefined);
    },
  });

  if (!scope) {
    return <p className="text-sm text-muted-foreground">{t('quotes.scope.unavailable')}</p>;
  }

  const handleCreate = () => {
    if (selected.length === 0 || mutation.isPending) return;
    onBeforeCreate?.();
    mutation.mutate();
  };

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">{t('quotes.scope.hint')}</p>

      <div className="space-y-1.5">
        <div className="flex items-center justify-between gap-2">
          <Label className="text-xs text-muted-foreground">{t('quotes.scope.include')}</Label>
          <div className="flex gap-1">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-6 px-2 text-micro"
              onClick={() => setSelected([SKETCH_KEY])}
              disabled={!items.some((x) => x.key === SKETCH_KEY)}
            >
              {t('quotes.scope.presetSketch')}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-6 px-2 text-micro"
              onClick={() => setSelected(items.map((x) => x.key))}
            >
              {t('quotes.scope.presetAll')}
            </Button>
          </div>
        </div>

        <div className="max-h-[46vh] space-y-0.5 overflow-y-auto rounded-md border border-border p-1.5">
          {items.map((item) => {
            const checked = selected.includes(item.key);
            return (
              <label
                key={item.key}
                className="flex cursor-pointer items-start gap-2 rounded px-2 py-1.5 text-sm hover:bg-muted/40"
              >
                <Checkbox
                  className="mt-0.5"
                  checked={checked}
                  onCheckedChange={() => toggle(item.key)}
                />
                <span className="min-w-0 flex-1">
                  {item.label}
                  {item.kind === 'az' && (
                    <span className="ml-1.5 text-micro text-muted-foreground">
                      {t('quotes.scope.azHint')}
                    </span>
                  )}
                </span>
              </label>
            );
          })}
        </div>
        {/*
          Ажлын зураг хасагдвал хүснэгт нь баримтад ҮЛДЭНЭ (эскизийн үнэ түүнээс
          гардаг) — зөвхөн ДҮН-гээс хасагдана. Үүнийг ил хэлэхгүй бол PM «яагаад
          хүснэгт нь байсаар байна?» гэж эргэлзэнэ.
        */}
        {!selected.includes(AZ_SCOPE_KEY) && (
          <p className="text-micro text-muted-foreground">{t('quotes.scope.azExcluded')}</p>
        )}
      </div>

      {/* Шинэ НИЙТ ДҮН — асуултын ЖИНХЭНЭ хариулт. */}
      <div className="flex items-center justify-between gap-2 rounded-md border border-border bg-muted/30 px-3 py-2">
        <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          {t('quotes.scope.newTotal')}
        </span>
        <span className="flex items-center gap-2 text-base font-semibold tabular-nums">
          {tariffsLoading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          {total === null ? '—' : `${Math.round(total).toLocaleString('mn-MN')}₮`}
        </span>
      </div>

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone} disabled={mutation.isPending}>
          {t('common.cancel')}
        </Button>
        <Button
          type="button"
          onClick={handleCreate}
          disabled={selected.length === 0 || mutation.isPending}
        >
          {mutation.isPending && <Loader2 className="animate-spin" />}
          {t('quotes.scope.create')}
        </Button>
      </DialogFooter>
    </div>
  );
}
