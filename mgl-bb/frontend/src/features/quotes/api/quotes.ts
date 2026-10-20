/**
 * Үнийн санал v2 — API давхарга.
 *
 * Бүх маршрут сервер талдаа `requireAdmin`-тэй (backend/src/routes/quotes.ts).
 * Хэлбэрүүд нь `../types/quotes`-той нэг гэрээтэй — сервер тэдгээрийг гараар
 * дагаж барьдаг (энэ репо тип автоматаар үүсгэдэггүй).
 */
import { apiFetch } from '@/shared/api/client';
import type {
  Quote,
  QuoteFunnel,
  QuoteListItem,
  QuoteSavePayload,
  QuoteStatus,
  QuoteStatusHistoryRow,
  QuoteTemplate,
  TariffRow,
  WorkbookDoc,
} from '../types/quotes';

/* ---------------- Үнийн санал ---------------- */

export function listQuotes(limit = 100, status?: QuoteStatus | null): Promise<QuoteListItem[]> {
  const qs = new URLSearchParams({ limit: String(limit) });
  if (status) qs.set('status', status);
  return apiFetch<QuoteListItem[]>(`/quotes?${qs.toString()}`);
}

/**
 * Борлуулалтын юүлүүр. `from`/`to` нь `doc_date`-ээр шүүнэ (баримтын огноо),
 * `created_at` биш — өнгөрсөн оны буцаан бүртгэсэн санал өнөөдрийн улиралд
 * орох ёсгүй.
 */
export function getQuoteFunnel(range?: { from?: string; to?: string }): Promise<QuoteFunnel> {
  const qs = new URLSearchParams();
  if (range?.from) qs.set('from', range.from);
  if (range?.to) qs.set('to', range.to);
  const suffix = qs.toString();
  return apiFetch<QuoteFunnel>(`/quotes/funnel${suffix ? `?${suffix}` : ''}`);
}

/**
 * Юүлүүрийн шат солих. Статусыг ЗӨВХӨН энэ гарцаар солино — `saveQuote`
 * (autosave) нь статус хөнддөггүй, эс бөгөөс дэвтэр хадгалах бүрд юүлүүр
 * чимээгүйхэн хөдөлнө. Ижил статус руу шилжүүлбэл сервер 409 буцаана.
 */
export function setQuoteStatus(
  id: number,
  body: { status: QuoteStatus; note?: string | null; contract_amount?: number | null },
): Promise<{ ok: true; status: QuoteStatus; contract_amount: number | null }> {
  return apiFetch(`/quotes/${id}/status`, { method: 'PATCH', data: body });
}

export function getQuoteStatusHistory(id: number): Promise<QuoteStatusHistoryRow[]> {
  return apiFetch<QuoteStatusHistoryRow[]>(`/quotes/${id}/status-history`);
}

export function getQuote(id: number): Promise<Quote> {
  return apiFetch<Quote>(`/quotes/${id}`);
}

/**
 * `variant_keys` — саналын ТӨРӨЛ, ОЛОН байж болно («эскиз + ажлын зураг»).
 * Сервер тэдгээрийг каталогт цэвэрлээд `quotes.variant_key` баганад таслалаар
 * тусгаарлан хадгална (`backend/src/lib/quoteVariants.ts`). Хуучин ганц
 * түлхүүрт `variant_key`-г сервер одоо ч хүлээж авдаг ч клиент илгээхээ больсон.
 */
export function createQuote(body: {
  template_id?: number;
  variant_keys: string[];
  title?: string;
  project_id?: number | null;
}): Promise<Quote> {
  return apiFetch<Quote>('/quotes', { method: 'POST', data: body });
}

/**
 * «Хурдан нэмэх» — Excel дээр, апп-аас ГАДУУР хийгдсэн өмнөх саналыг буцаан
 * бүртгэнэ. Загвар/дэвтэр барихгүй, зөвхөн тоон баримт. Сервер `source`-ыг
 * 'manual' болгож, `quote_status_history`-д мөр ҮҮСГЭХГҮЙ (жинхэнэ шилжилт
 * биш — гарал үүслийг `source` өөрөө тайлбарлана).
 */
export function createManualQuote(body: {
  title: string;
  client_name?: string | null;
  project_id?: number | null;
  doc_date?: string;
  total_amount?: number | null;
  contract_amount?: number | null;
  status?: QuoteStatus;
  variant_keys?: string[];
}): Promise<Quote> {
  return apiFetch<Quote>('/quotes/manual', { method: 'POST', data: body });
}

/**
 * Англи хувилбар үүсгэх — `POST /api/quotes/:id/translate`.
 *
 * Сервер ШИНЭ, холбоотой мөр (`lang='en'`, `source_quote_id=id`) үүсгээд
 * `POST /quotes`-той ижил хэлбэрээр буцаана. Аль хэдийн англи хувилбартай бол
 * 409 `{error:'EXISTS', existing_id}` — `apiFetch` тэр биеийг `ApiError.payload`
 * дотор хадгалдаг тул дуудагч `err.payload.existing_id`-ээр байгаа хувилбар руу
 * шилжиж чадна.
 */
export function translateQuote(id: number): Promise<Quote> {
  return apiFetch<Quote>(`/quotes/${id}/translate`, { method: 'POST' });
}

/**
 * ХЭСЭГЧИЛСЭН САНАЛ үүсгэх — `POST /api/quotes/:id/scope`.
 *
 * «Зөвхөн эскиз зураг хийлгэвэл хэд болох вэ?» гэсэн асуултад нэг товчоор
 * хариулна: сонгосон хамрах хүрээгээр ХУМИГДСАН дэвтрийг клиент бэлдээд
 * (`lib/scopeQuote.ts` → `applyScope`) сервер рүү илгээхэд ШИНЭ, БИЕЭ ДААСАН
 * санал болж хадгалагдана.
 *
 * ⚠️ Дэвтрийг СЕРВЕР БҮТЭЭХГҮЙ — хумилт нь бүхэлдээ клиентийн ажил. Учир нь
 * `addons` spec-ийн семантик (`removeCostLine`, томьёоны шилжилт) frontend-д
 * амьдардаг ба сервер томьёо ХЭЗЭЭ Ч тооцоолдоггүй. Сервер зөвхөн эх саналын
 * толгойн талбаруудыг өвлүүлж мөр бичнэ (`PUT /:id`-тэй ижил гэрээ).
 *
 * ⚠️ Орчуулгаас ЯЛГААТАЙ: `source_quote_id` тавигдахгүй — хэсэгчилсэн санал нь
 * өөрөө явах ТУСДАА хэлцэл (юүлүүрт орно, төлөв нь өөрөө солигдоно).
 */
export function createScopeQuote(
  id: number,
  body: {
    workbook: WorkbookDoc;
    title: string;
    variant_keys: string[];
    total_amount: number | null;
  },
): Promise<Quote> {
  return apiFetch<Quote>(`/quotes/${id}/scope`, { method: 'POST', data: body });
}

export function saveQuote(
  id: number,
  payload: QuoteSavePayload,
): Promise<{ ok: true; updated_at: string }> {
  return apiFetch(`/quotes/${id}`, { method: 'PUT', data: payload });
}

export function deleteQuote(id: number): Promise<{ ok: true }> {
  return apiFetch(`/quotes/${id}`, { method: 'DELETE' });
}

/* ---------------- Тарифын каталог ---------------- */

export function listTariffs(): Promise<TariffRow[]> {
  return apiFetch<TariffRow[]>('/quotes/tariffs');
}

export function replaceTariffs(rows: TariffRow[]): Promise<{ ok: true; count: number }> {
  return apiFetch('/quotes/tariffs', { method: 'PUT', data: { rows } });
}

/* ---------------- Template ---------------- */

export function listTemplates(): Promise<Array<Omit<QuoteTemplate, 'workbook' | 'variants'>>> {
  return apiFetch('/quotes/templates');
}

export function getTemplate(id: number): Promise<QuoteTemplate> {
  return apiFetch<QuoteTemplate>(`/quotes/templates/${id}`);
}

export function saveTemplate(
  id: number,
  body: Pick<QuoteTemplate, 'workbook' | 'variants'> & { name?: string },
): Promise<{ ok: true; version: number }> {
  return apiFetch(`/quotes/templates/${id}`, { method: 'PUT', data: body });
}

/* ---------------- TanStack Query түлхүүрүүд ---------------- */

export const QUOTES_KEY = ['quotes'] as const;
export const quoteKey = (id: number) => ['quotes', id] as const;

/**
 * Жагсаалтын түлхүүр — шүүлтүүрийг АГУУЛНА (`['quotes','list',status]`).
 *
 * ⚠️ `QUOTES_LIST_KEY` / `QUOTES_FUNNEL_KEY` нь `invalidateQueries`-д зориулсан
 * PREFIX. Хадгалсны дараа `QUOTES_KEY`-г бүхэлд нь invalidate хийж БОЛОХГҮЙ:
 * тэр нь `quoteKey(id)` дэлгэрэнгүйг ч цэвэрлэж, засварлагч нээлттэй байхад
 * дэвтрийг сервер талын хуулбараар дарж бичих эрсдэлтэй. Тэдгээр нь `'list'` /
 * `'funnel'` гэсэн МӨР агуулдаг тул дугаартай дэлгэрэнгүй түлхүүртэй хэзээ ч
 * давхцахгүй.
 */
export const QUOTES_LIST_KEY = ['quotes', 'list'] as const;
export const QUOTES_FUNNEL_KEY = ['quotes', 'funnel'] as const;
export const quoteListKey = (status: string) => [...QUOTES_LIST_KEY, status] as const;
export const quoteFunnelKey = (from?: string, to?: string) =>
  [...QUOTES_FUNNEL_KEY, from ?? null, to ?? null] as const;
export const quoteHistoryKey = (id: number) => ['quotes', id, 'status-history'] as const;
/** Тариф бараг өөрчлөгддөггүй тул `staleTime: Infinity`-ээр хэрэглэнэ. */
export const TARIFFS_KEY = ['quotes', 'tariffs'] as const;
export const TEMPLATES_KEY = ['quotes', 'templates'] as const;
export const templateKey = (id: number) => ['quotes', 'templates', id] as const;
