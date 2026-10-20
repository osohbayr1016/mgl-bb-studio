/**
 * Тарифын каталог — БД 81-16-20/2020, заалт 4.20, Хүснэгт 9.
 *
 * Сервер тарифыг ХАВТГАЙ мөрөөр хадгална (`(area_max, complexity) → rate`,
 * 353 мөр). Гэвч эх сурвалж нь ПИВОТ хүснэгт: мөр = талбайн дээд хязгаар,
 * багана = төвөгшлийн 5 зэрэг. PM эх номтойгоо нүд нүдээр нь тулгадаг тул
 * энэ хуудас яг тэр пивот хэлбэрээр л харуулна (`buildPivot`).
 *
 * ⚠️ Хайлтын логикийг ЭНД ДАХИН БИЧЭЭГҮЙ: тохирох м² үнэ нь томьёоны хөдөлгүүр
 * `TARIF(...)`-д ашигладаг ЯГ ТЭР `makeTariffFn`-ээс ирнэ. Энэ хуудас зөвхөн
 * буцаж ирсэн үнэ хүснэгтийн аль нүдэнд байгааг олж тодруулна — ингэснээр
 * «хуудсан дээр өөр, хайлтад өөр» гэсэн зөрүү үүсэх боломжгүй.
 *
 * Виртуалчлал ХЭРЭГЛЭЭГҮЙ: 353 хавтгай мөр нь пивотлоход 110 л мөр болно
 * (`ondor` 110, `ontsgoi` 107, `dund` 90, `baga` 40, `zovshoorolgui` 6 —
 * бүгд ижил талбайн шатлалууд дээр суудаг). 110 мөр × 6 багана нь браузерт
 * ямар ч асуудалгүй бөгөөд `sticky` толгой, засварын `<input>`-ууд,
 * хөтөчийн Ctrl+F хайлт виртуалчлалтай зөрчилдөхгүй.
 */
import { memo, useCallback, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus, Ruler, Save, Search, Trash2, X } from 'lucide-react';

import { confirmDialog } from '@/shared/components/ConfirmDialog';
import { EmptyState } from '@/shared/components/EmptyState';
import { PageContainer } from '@/shared/components/PageContainer';
import { PageHeader } from '@/shared/components/PageHeader';
import { toast } from '@/shared/components/Toast';
import { useLanguage } from '@/shared/i18n';
import { cn } from '@/shared/lib/utils';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import { Label } from '@/ui/label';

import { TARIFFS_KEY, listTariffs, replaceTariffs } from '../api/quotes';
import { formatValue, parseInput } from '../lib/format';
import { makeTariffFn } from '../lib/tariffLookup';
import { COMPLEXITY_LABEL_MN, type TariffComplexity, type TariffRow } from '../types/quotes';

/* ------------------------------------------------------------------ */
/*  Тогтмолууд                                                          */
/* ------------------------------------------------------------------ */

/** Хүснэгт 9-ийн баганы дараалал (зүүнээс баруун тийш). */
const ORDER: readonly TariffComplexity[] = [
  'zovshoorolgui',
  'baga',
  'dund',
  'ondor',
  'ontsgoi',
];

const HOUR_MS = 60 * 60 * 1000;

/* ------------------------------------------------------------------ */
/*  Пивот загвар                                                        */
/* ------------------------------------------------------------------ */

interface PivotRow {
  area: number;
  rates: Partial<Record<TariffComplexity, number>>;
}

/** Хавтгай мөрүүдийг «талбай × төвөгшил» пивот болгоно (талбай өсөхөөр). */
function buildPivot(rows: TariffRow[]): PivotRow[] {
  const byArea = new Map<number, PivotRow>();
  for (const row of rows) {
    const area = Number(row.area_max);
    const rate = Number(row.rate);
    if (!Number.isFinite(area) || !Number.isFinite(rate)) continue;
    const entry = byArea.get(area) ?? { area, rates: {} };
    entry.rates[row.complexity] = rate;
    byArea.set(area, entry);
  }
  return [...byArea.values()].sort((a, b) => a.area - b.area);
}

/* ------------------------------------------------------------------ */
/*  Засварын ноорог                                                     */
/* ------------------------------------------------------------------ */

/** Засварлах үед бүх нүд ТЕКСТ — хагас бичсэн тоо ('1,2') алга болохгүй. */
interface DraftRow {
  id: number;
  area: string;
  rates: Record<TariffComplexity, string>;
}

function emptyRates(): Record<TariffComplexity, string> {
  return { zovshoorolgui: '', baga: '', dund: '', ondor: '', ontsgoi: '' };
}

/** `parseInput`-ийг дахин ашиглана — Excel-ээс хуулсан '1,200 ₮' ч уншигдана. */
function toNumber(raw: string): number | null {
  const cell = parseInput(raw);
  return typeof cell?.v === 'number' && Number.isFinite(cell.v) ? cell.v : null;
}

interface FlattenError {
  key: string;
  params?: Record<string, string | number>;
}

/**
 * Ноорог пивотыг сервер хүлээж авдаг хавтгай мөр болгоно.
 * Хоосон нүд огт мөр үүсгэхгүй (тэр төвөгшилд уг шатлал байхгүй гэсэн үг).
 */
function flattenDraft(
  draft: DraftRow[],
  sourceOf: (area: number, cx: TariffComplexity) => string,
): { rows: TariffRow[]; error: null } | { rows: null; error: FlattenError } {
  const out: TariffRow[] = [];
  const seen = new Set<number>();

  for (const row of draft) {
    const area = toNumber(row.area);
    if (area === null || area <= 0) return { rows: null, error: { key: 'quotes.tariff.invalidArea' } };
    if (seen.has(area)) {
      return { rows: null, error: { key: 'quotes.tariff.duplicateArea', params: { area } } };
    }
    seen.add(area);

    for (const cx of ORDER) {
      const raw = row.rates[cx].trim();
      if (raw === '') continue;
      const rate = toNumber(raw);
      if (rate === null || rate < 0 || !Number.isInteger(rate)) {
        return { rows: null, error: { key: 'quotes.tariff.invalidRate' } };
      }
      out.push({ area_max: area, complexity: cx, rate, source_ref: sourceOf(area, cx) });
    }
  }

  return { rows: out, error: null };
}

/* ------------------------------------------------------------------ */
/*  Засварын мөр (memo — 110 мөрийн аль нэгэнд бичихэд бусад нь дахин
 *  зурагдахгүй)                                                        */
/* ------------------------------------------------------------------ */

interface EditRowProps {
  row: DraftRow;
  deleteLabel: string;
  onArea: (id: number, value: string) => void;
  onRate: (id: number, cx: TariffComplexity, value: string) => void;
  onDelete: (id: number) => void;
}

const TariffEditRow = memo(function TariffEditRow({
  row,
  deleteLabel,
  onArea,
  onRate,
  onDelete,
}: EditRowProps) {
  return (
    <tr className="border-b border-border last:border-0">
      <td className="sticky left-0 z-10 bg-card p-1">
        <Input
          value={row.area}
          inputMode="decimal"
          className="h-8 text-right tabular-nums"
          onChange={(e) => onArea(row.id, e.target.value)}
        />
      </td>
      {ORDER.map((cx) => (
        <td key={cx} className="p-1">
          <Input
            value={row.rates[cx]}
            inputMode="numeric"
            className="h-8 text-right tabular-nums"
            onChange={(e) => onRate(row.id, cx, e.target.value)}
          />
        </td>
      ))}
      <td className="p-1 text-center">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="text-danger"
          title={deleteLabel}
          aria-label={deleteLabel}
          onClick={() => onDelete(row.id)}
        >
          <Trash2 />
        </Button>
      </td>
    </tr>
  );
});

/* ------------------------------------------------------------------ */
/*  Хуудас                                                              */
/* ------------------------------------------------------------------ */

/** `embedded` — `QuotesPage`-ийн таб дотор (гарчиггүй). Дэлгэрэнгүйг QuoteListPage-ээс үз. */
export default function QuoteTariffPage({ embedded = false }: { embedded?: boolean }) {
  const { t } = useLanguage();
  const queryClient = useQueryClient();

  const tariffQuery = useQuery({
    queryKey: TARIFFS_KEY,
    // Улсын норматив — сесс дундуур өөрчлөгддөггүй (`useQuoteSheet`-тэй ижил).
    queryFn: listTariffs,
    staleTime: Infinity,
    gcTime: 24 * HOUR_MS,
  });

  const tariffs = useMemo(() => tariffQuery.data ?? [], [tariffQuery.data]);
  const pivot = useMemo(() => buildPivot(tariffs), [tariffs]);
  const tariffFn = useMemo(() => makeTariffFn(tariffs), [tariffs]);

  /** Мөр бүрийн эх сурвалжийн ишлэлийг засвар дундуур алдахгүйн тулд. */
  const sourceRefs = useMemo(() => {
    const map = new Map<string, string>();
    for (const row of tariffs) map.set(`${row.area_max}|${row.complexity}`, row.source_ref);
    return map;
  }, [tariffs]);
  const defaultSource = tariffs[0]?.source_ref ?? '';
  const sourceOf = useCallback(
    (area: number, cx: TariffComplexity) => sourceRefs.get(`${area}|${cx}`) ?? defaultSource,
    [sourceRefs, defaultSource],
  );

  /* ---------------- Талбайгаар шалгах ---------------- */

  const [lookupRaw, setLookupRaw] = useState('');

  const lookup = useMemo(() => {
    const area = toNumber(lookupRaw);
    if (area === null || area <= 0) return null;

    // Үнэ нь `makeTariffFn`-ээс (цорын ганц эх сурвалж). Дараа нь тэр үнэ
    // хүснэгтийн аль мөрөнд байгааг л олно — шатлалын дүрмийг дахин бичихгүй.
    const cells = new Map<TariffComplexity, number>();
    for (const cx of ORDER) {
      const rate = tariffFn(area, cx);
      if (rate === null) continue;
      let idx = pivot.findIndex((row) => row.area >= area && row.rates[cx] === rate);
      // Каталогийн дээд шатлалаас давсан талбай: `makeTariffFn` нь сүүлийн
      // шатлалын ханшаар тооцдог тул тэр мөрийг нь олж тодруулна — эс бөгөөс
      // хайлт үнэ буцаагаад хүснэгтэд юу ч тодрохгүй болно.
      if (idx < 0) {
        for (let i = pivot.length - 1; i >= 0; i -= 1) {
          if (pivot[i].rates[cx] !== undefined) {
            idx = i;
            break;
          }
        }
      }
      if (idx >= 0) cells.set(cx, idx);
    }

    const rowIdx = new Set(cells.values());
    let bracket: number | null = null;
    for (const idx of rowIdx) {
      const row = pivot[idx];
      if (row && (bracket === null || row.area < bracket)) bracket = row.area;
    }
    return { area, cells, rowIdx, bracket };
  }, [lookupRaw, tariffFn, pivot]);

  /* ---------------- Засварын горим ---------------- */

  const [draft, setDraft] = useState<DraftRow[] | null>(null);
  const idRef = useRef(0);
  const nextId = useCallback(() => {
    idRef.current += 1;
    return idRef.current;
  }, []);

  const startEdit = () => {
    setDraft(
      pivot.map((row) => {
        const rates = emptyRates();
        for (const cx of ORDER) {
          const rate = row.rates[cx];
          if (rate !== undefined) rates[cx] = String(rate);
        }
        return { id: nextId(), area: String(row.area), rates };
      }),
    );
  };

  const setArea = useCallback((id: number, value: string) => {
    setDraft((prev) => prev && prev.map((r) => (r.id === id ? { ...r, area: value } : r)));
  }, []);

  const setRate = useCallback((id: number, cx: TariffComplexity, value: string) => {
    setDraft(
      (prev) =>
        prev && prev.map((r) => (r.id === id ? { ...r, rates: { ...r.rates, [cx]: value } } : r)),
    );
  }, []);

  const deleteRow = useCallback((id: number) => {
    setDraft((prev) => prev && prev.filter((r) => r.id !== id));
  }, []);

  const addRow = () => {
    setDraft((prev) => [...(prev ?? []), { id: nextId(), area: '', rates: emptyRates() }]);
  };

  const saveMutation = useMutation({
    mutationFn: (rows: TariffRow[]) => replaceTariffs(rows),
    onSuccess: (res) => {
      setDraft(null);
      void queryClient.invalidateQueries({ queryKey: TARIFFS_KEY });
      toast.success(t('quotes.tariff.saved', { count: res.count }));
    },
    onError: (err: Error) => toast.error(t('common.saveFailed'), err.message),
  });

  const handleSave = async () => {
    if (!draft) return;
    const flat = flattenDraft(draft, sourceOf);
    if (flat.rows === null) {
      toast.error(t(flat.error.key, flat.error.params));
      return;
    }
    const ok = await confirmDialog({
      description: t('quotes.tariff.confirmSave', { count: flat.rows.length }),
    });
    if (!ok) return;
    saveMutation.mutate(flat.rows);
  };

  /* ---------------- Рендэр ---------------- */

  const editing = draft !== null;
  const headCell =
    'sticky top-0 z-20 border-b border-border bg-muted/70 px-2 py-2 text-xs font-medium ' +
    'text-muted-foreground backdrop-blur';

  const actions = editing ? (
    <>
      <Button
        type="button"
        variant="ghost"
        onClick={() => setDraft(null)}
        disabled={saveMutation.isPending}
      >
        <X /> {t('quotes.tariff.exitEdit')}
      </Button>
      <Button type="button" onClick={() => void handleSave()} disabled={saveMutation.isPending}>
        <Save /> {saveMutation.isPending ? t('common.saving') : t('quotes.tariff.saveTable')}
      </Button>
    </>
  ) : (
    <Button type="button" variant="outline" onClick={startEdit} disabled={tariffQuery.isLoading}>
      <Pencil /> {t('quotes.tariff.editMode')}
    </Button>
  );

  return (
    <PageContainer>
      {embedded ? (
        // Эх сурвалжийн ишлэл нь PageHeader-ийн `description`-оор гардаг байсан —
        // таб дотор гарчиггүй тул үйлдлийн эгнээний зүүн талд үлдээв.
        <div className="flex flex-wrap items-center justify-end gap-2">
          <span className="mr-auto text-xs text-muted-foreground">
            {t('quotes.tariff.source')}
          </span>
          {actions}
        </div>
      ) : (
        <PageHeader
          title={t('quotes.tariff.pageTitle')}
          eyebrow={t('nav.quotes')}
          description={t('quotes.tariff.source')}
          icon={Ruler}
          actions={actions}
        />
      )}

      {/* Шатлалын дүрэм — PM-ийн хамгийн олон асуудаг зүйл тул ил байрлана. */}
      <div className="rounded-md border border-border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
        {t('quotes.tariff.roundUpHint')}
      </div>

      {/* Талбайгаар шалгах — засварын горимд хадгалагдсан өгөгдөлтэй зөрөх тул нуугдана. */}
      {!editing && (
        <div className="flex flex-col gap-2 rounded-md border border-border bg-card p-3 sm:flex-row sm:items-end">
          <div className="sm:w-64">
            <Label htmlFor="tariff-lookup" className="mb-1.5 text-xs">
              {t('quotes.tariff.lookupLabel')}
            </Label>
            <div className="relative">
              <Search className="pointer-events-none absolute top-1/2 left-2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="tariff-lookup"
                value={lookupRaw}
                inputMode="decimal"
                className="pl-8 tabular-nums"
                placeholder={t('quotes.tariff.lookupPlaceholder')}
                onChange={(e) => setLookupRaw(e.target.value)}
              />
            </div>
          </div>
          {lookup && (
            <p className="pb-2 text-sm">
              {lookup.bracket === null ? (
                <span className="text-danger">
                  {t('quotes.tariff.lookupNone', { area: formatValue(lookup.area, '#,##0') })}
                </span>
              ) : (
                <span className="text-foreground">
                  {t('quotes.tariff.lookupResult', {
                    area: formatValue(lookup.area, '#,##0'),
                    bracket: formatValue(lookup.bracket, '#,##0'),
                  })}
                </span>
              )}
            </p>
          )}
          <span className="ml-auto pb-2 text-xs text-muted-foreground tabular-nums">
            {t('quotes.tariff.rowCount', { brackets: pivot.length, rows: tariffs.length })}
          </span>
        </div>
      )}

      {tariffQuery.isLoading ? (
        <p className="py-16 text-center text-sm text-muted-foreground">{t('common.loading')}</p>
      ) : tariffQuery.isError ? (
        <EmptyState title={t('common.loadFailed')} description={tariffQuery.error.message} />
      ) : !editing && pivot.length === 0 ? (
        <EmptyState
          icon={Ruler}
          title={t('quotes.tariff.emptyTable')}
          description={t('quotes.tariff.source')}
          action={
            <Button type="button" variant="outline" onClick={startEdit}>
              <Pencil /> {t('quotes.tariff.editMode')}
            </Button>
          }
        />
      ) : (
        <div className="overflow-auto rounded-md border border-border bg-card">
          <table className="w-full min-w-[720px] border-collapse text-sm">
            <thead>
              <tr>
                <th className={cn(headCell, 'sticky left-0 z-30 text-left')}>
                  {t('quotes.tariff.area')}
                </th>
                {ORDER.map((cx) => (
                  <th key={cx} className={cn(headCell, 'text-right')}>
                    {/* Эх номын зэрэглэлийн нэрс — PM `TARIF(...)`-д ЯГ эдгээр
                        үгсийг бичдэг тул орчуулахгүй. */}
                    {COMPLEXITY_LABEL_MN[cx]}
                  </th>
                ))}
                {editing && <th className={cn(headCell, 'w-12 text-center')} />}
              </tr>
              <tr>
                <th className="border-b border-border px-2 py-1 text-left text-micro font-normal text-muted-foreground">
                  м²
                </th>
                {ORDER.map((cx) => (
                  <th
                    key={cx}
                    className="border-b border-border px-2 py-1 text-right text-micro font-normal text-muted-foreground"
                  >
                    {t('quotes.tariff.rate')}
                  </th>
                ))}
                {editing && <th className="border-b border-border" />}
              </tr>
            </thead>

            <tbody>
              {editing
                ? draft.map((row) => (
                    <TariffEditRow
                      key={row.id}
                      row={row}
                      deleteLabel={t('quotes.tariff.deleteRow')}
                      onArea={setArea}
                      onRate={setRate}
                      onDelete={deleteRow}
                    />
                  ))
                : pivot.map((row, idx) => {
                    const hit = lookup?.rowIdx.has(idx) ?? false;
                    return (
                      <tr
                        key={row.area}
                        className={cn(
                          'border-b border-border last:border-0',
                          hit ? 'bg-primary/10' : 'even:bg-muted/20',
                        )}
                      >
                        <th
                          scope="row"
                          className={cn(
                            'sticky left-0 z-10 px-2 py-1.5 text-left font-medium tabular-nums',
                            hit ? 'bg-primary/15' : 'bg-card',
                          )}
                        >
                          {formatValue(row.area, '#,##0')}
                        </th>
                        {ORDER.map((cx) => {
                          const rate = row.rates[cx];
                          const matched = lookup?.cells.get(cx) === idx;
                          return (
                            <td
                              key={cx}
                              className={cn(
                                'px-2 py-1.5 text-right tabular-nums',
                                rate === undefined && 'text-muted-subtle',
                                matched && 'bg-primary/25 font-semibold text-foreground',
                              )}
                            >
                              {rate === undefined ? '—' : formatValue(rate, '#,##0')}
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
            </tbody>
          </table>

          {editing && (
            <div className="border-t border-border p-2">
              <Button type="button" variant="outline" size="sm" onClick={addRow}>
                <Plus /> {t('quotes.tariff.addRow')}
              </Button>
            </div>
          )}
        </div>
      )}
    </PageContainer>
  );
}
