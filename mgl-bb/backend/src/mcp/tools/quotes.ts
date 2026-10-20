import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { Env } from '../../types';
import { isAdminRole } from '../../types';
import { variantLabelsMn } from '../../lib/quoteVariants';
import type { McpProps } from '../MglMcpAgent';

/* =============================================================
 * Үнийн санал (Quote v2) — MCP tool-ууд
 * -------------------------------------------------------------
 * Баримт нь ЧӨЛӨӨТ ХУУДАС (SheetDoc): нүд бүр литерал утга (`v`) эсвэл
 * томьёо (`f`) агуулна.  Тооцоог зөвхөн КЛИЕНТ-ийн `lib/formula` хөдөлгүүр
 * гүйцэтгэдэг тул серверт томьёоны ҮР ДҮН БАЙХГҮЙ (routes/quotes.ts-ийн
 * PUT /:id-ийн тайлбарыг үз).  Иймд `get_quote` нь томьёотой нүдийг ТОМЬЁОГ
 * НЬ өөрийг нь харуулж, зөвхөн `quotes.total_amount` кэшээс нийт дүнг өгнө.
 *
 * D1 схем: migration 0128 (quotes / quote_templates / quote_tariffs).
 * Эрх: ХОЁУЛАА admin-only — routes/quotes.ts-ийн `requireAdmin()`-ийн MCP
 * дүйцэл (үнэ, тариф нь нууц тул `senior` ч ОРОХГҮЙ).  MglMcpAgent.init()-ийн
 * admin блокт бүртгэгдэнэ, дээрээс нь tool дотор давхар шалгана.
 * ============================================================= */

/** MCP tool-ийн стандарт JSON хариу (бусад tool-уудтай ижил). */
const txt = (data: unknown) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }],
});

/** Түүхий текст хариу — TSV хүснэгтийг JSON-д escape хийлгүй харуулахад. */
const raw = (text: string) => ({ content: [{ type: 'text' as const, text }] });

/** Хуудсыг хэт том хариу болгохгүйн тулд таслах хязгаар. */
const MAX_TSV_ROWS = 300;
const MAX_TSV_COLS = 40;

/* ---------- Гэрээний хэлбэрүүд (frontend types-ийн толь) ----------
 * frontend/src/features/quotes/types/quotes.ts — backend тусдаа багц тул
 * импортлохгүй, routes/quotes.ts-ийн адилаар ХЭЛБЭРИЙГ давтав. */

interface SheetCell {
  v?: string | number | null;
  f?: string;
  fmt?: string;
  s?: Record<string, unknown>;
}

interface SheetMerge {
  r: number;
  c: number;
  rs: number;
  cs: number;
}

interface SheetDoc {
  rows: number;
  cols: number;
  merges: SheetMerge[];
  cells: Record<string, SheetCell>;
  anchors: Record<string, string | undefined>;
}

/** Нэртэй хуудас — workbook (v3) доторх нэг таб. */
interface NamedSheet extends SheetDoc {
  id: string;
  name: string;
}

/** Workbook түвшний anchor: аль хуудасны (`sheet` = sheetId) аль нүд. */
interface WorkbookAnchor {
  sheet: string;
  ref: string;
}

type WorkbookAnchors = Record<string, WorkbookAnchor | undefined>;

/** Олон хуудаст ажлын дэвтэр (v3). Хуучин ганц SheetDoc-ийг 1-табт болгоно. */
interface WorkbookDoc {
  sheets: NamedSheet[];
  anchors: WorkbookAnchors;
}

interface QuoteListRow {
  id: number;
  title: string;
  client_name: string | null;
  variant_key: string;
  doc_date: string;
  /** 'mn' | 'en' (migration 0181) — 'en' = эх саналын англи хувилбар. */
  lang: string;
  total_amount: number | null;
  created_by_name: string | null;
  updated_at: string;
}

interface QuoteFullRow extends QuoteListRow {
  prepared_by: string | null;
  project_id: number | null;
  project_name: string | null;
  template_id: number | null;
  template_version: number | null;
  sheet_json: string;
  created_at: string;
}

/* ---------- Жижиг туслахууд ---------- */

/** 0 → 'A', 25 → 'Z', 26 → 'AA'. */
function colToName(c: number): string {
  let s = '';
  let n = c;
  while (n >= 0) {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  }
  return s;
}

/** Мянгатын таслалтай тоо.  `toLocaleString`-ийн оронд гараар — Worker дээр
 *  локалиас хамааралгүй, тогтвортой гаралт өгнө. */
function group(n: number, decimals = 0): string {
  const fixed = Math.abs(n).toFixed(decimals);
  const [intPart = '0', frac] = fixed.split('.');
  const sep = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${n < 0 ? '-' : ''}${sep}${frac ? `.${frac}` : ''}`;
}

/**
 * Литерал утгыг харагдах текст болгоно — frontend-ийн
 * `features/quotes/lib/format.ts` → `formatValue`-ийн толь.  `fmt` заагаагүй
 * тоо нь мянгатын таслалтай гарна (үнийн саналын бүх тоо ийм).
 */
function formatValue(value: string | number | null | undefined, fmt?: string): string {
  if (value === null || value === undefined || value === '') return '';
  if (typeof value === 'string') return value;
  if (typeof value !== 'number' || !Number.isFinite(value)) return String(value);
  switch (fmt) {
    case 'text':
      return String(value);
    case '#,##0.00':
      return group(value, 2);
    case '0%':
      return `${Math.round(value * 100)}%`;
    case '0.0%':
      return `${(value * 100).toFixed(1)}%`;
    case '#,##0':
    default:
      return group(Math.round(value));
  }
}

/** Дурын объектыг SheetDoc болгож нормчилно (эвдэрсэн талбар → анхны утга). */
function coerceSheet(raw: unknown): SheetDoc {
  const empty: SheetDoc = { rows: 0, cols: 0, merges: [], cells: {}, anchors: {} };
  if (!raw || typeof raw !== 'object') return empty;
  const o = raw as Partial<SheetDoc>;
  return {
    rows: Number.isFinite(o.rows) ? Math.max(0, Math.trunc(Number(o.rows))) : 0,
    cols: Number.isFinite(o.cols) ? Math.max(0, Math.trunc(Number(o.cols))) : 0,
    merges: Array.isArray(o.merges) ? o.merges : [],
    cells: o.cells && typeof o.cells === 'object' ? o.cells : {},
    anchors: o.anchors && typeof o.anchors === 'object' ? o.anchors : {},
  };
}

/** Workbook түвшний anchors (`{ total: { sheet, ref } }`)-ыг цэвэрлэнэ. */
function coerceWorkbookAnchors(raw: unknown): WorkbookAnchors {
  const out: WorkbookAnchors = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!v || typeof v !== 'object') continue;
    const o = v as Record<string, unknown>;
    if (typeof o.sheet === 'string' && typeof o.ref === 'string' && o.ref) {
      out[k] = { sheet: o.sheet, ref: o.ref };
    }
  }
  return out;
}

/**
 * Хадгалсан JSON → WorkbookDoc.  Хоёр хэлбэрийг уншина (буцаад нийц):
 *   • Шинэ (v3): `{ sheets:[…], anchors:{ key:{ sheet, ref } } }`.
 *   • Хуучин (v2): ганц `SheetDoc` → 1-табт болгож, хуудасны anchors (`{ key: ref }`)
 *     -ыг workbook руу зөөнө.
 * Эвдэрсэн/хоосон бол хоосон 1-табт workbook.
 */
function parseWorkbook(json: string | null | undefined): WorkbookDoc {
  const emptySheet = (): NamedSheet => ({
    id: 'sheet-1',
    name: 'Хуудас1',
    rows: 0,
    cols: 0,
    merges: [],
    cells: {},
    anchors: {},
  });
  const emptyWb = (): WorkbookDoc => ({ sheets: [emptySheet()], anchors: {} });

  if (!json) return emptyWb();
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return emptyWb();
  }
  if (!parsed || typeof parsed !== 'object') return emptyWb();
  const obj = parsed as Record<string, unknown>;

  // Шинэ хэлбэр — sheets массив.
  if (Array.isArray(obj.sheets)) {
    const sheets: NamedSheet[] = (obj.sheets as unknown[]).map((s, i) => {
      const sheet = coerceSheet(s);
      const so = (s && typeof s === 'object' ? s : {}) as Record<string, unknown>;
      return {
        ...sheet,
        id: typeof so.id === 'string' && so.id ? so.id : `sheet-${i + 1}`,
        name: typeof so.name === 'string' && so.name ? so.name : `Хуудас${i + 1}`,
      };
    });
    if (sheets.length === 0) sheets.push(emptySheet());
    return { sheets, anchors: coerceWorkbookAnchors(obj.anchors) };
  }

  // Хуучин ганц хуудас → 1-табт workbook; anchors-ыг хуудсаас workbook руу зөөнө.
  const sheet = coerceSheet(obj);
  const id = 'sheet-1';
  const named: NamedSheet = { ...sheet, id, name: 'Хуудас1' };
  const anchors: WorkbookAnchors = {};
  for (const [k, ref] of Object.entries(sheet.anchors ?? {})) {
    if (typeof ref === 'string' && ref) anchors[k] = { sheet: id, ref };
  }
  return { sheets: [named], anchors };
}

/** 'M13' → { r: 12, c: 12 } (0-ээс эхэлсэн); буруу хаяг бол null. */
function refToCoord(ref: string): { r: number; c: number } | null {
  const m = /^([A-Z]+)(\d+)$/.exec(ref.trim().toUpperCase());
  if (!m || !m[1] || !m[2]) return null;
  let c = 0;
  for (const ch of m[1]) c = c * 26 + (ch.charCodeAt(0) - 64);
  const r = parseInt(m[2], 10);
  if (!Number.isFinite(r) || r < 1) return null;
  return { r: r - 1, c: c - 1 };
}

/** Нүдний харагдах текст: томьёотой бол ТОМЬЁО, эс бөгөөс форматласан утга. */
function cellText(cell: SheetCell | undefined): string {
  if (!cell) return '';
  if (typeof cell.f === 'string' && cell.f) return cell.f;
  return formatValue(cell.v, typeof cell.fmt === 'string' ? cell.fmt : undefined);
}

/** TSV-ийн нэг нүдийг аюулгүй болгоно (tab/шинэ мөр нь баганыг эвддэг). */
const tsvSafe = (s: string) => s.replace(/[\t\r\n]+/g, ' ').trim();

/**
 * SheetDoc → TSV хүснэгт.  Эхний мөр нь баганын үсэг (A, B, C…), мөр бүрийн
 * эхний талбар нь Excel-ийн мөрийн дугаар (1-ээс) — Claude нүдний хаягийг
 * шууд уншиж чадна ('=D4*E4' гэдэг нь ямар нүд рүү заасныг олох).
 */
function sheetToTsv(sheet: SheetDoc): { tsv: string; usedRows: number; usedCols: number; truncated: boolean } {
  // Бодитоор бөглөгдсөн хүрээг олно — sparse тул зарласан rows/cols-оос бага байж болно.
  let maxRow = -1;
  let maxCol = -1;
  for (const [ref, cell] of Object.entries(sheet.cells)) {
    if (!cell || (cellText(cell) === '' && !cell.f)) continue;
    const co = refToCoord(ref);
    if (!co) continue;
    if (co.r > maxRow) maxRow = co.r;
    if (co.c > maxCol) maxCol = co.c;
  }
  for (const m of sheet.merges) {
    if (!m || !Number.isFinite(m.r) || !Number.isFinite(m.c)) continue;
    if (m.r > maxRow) maxRow = Math.trunc(m.r);
    if (m.c > maxCol) maxCol = Math.trunc(m.c);
  }
  const usedRows = Math.min(Math.max(maxRow + 1, 0), Math.max(sheet.rows, maxRow + 1));
  const usedCols = Math.min(Math.max(maxCol + 1, 0), Math.max(sheet.cols, maxCol + 1));

  const rows = Math.min(usedRows, MAX_TSV_ROWS);
  const cols = Math.min(usedCols, MAX_TSV_COLS);
  const truncated = rows < usedRows || cols < usedCols;

  if (rows === 0 || cols === 0) {
    return { tsv: '(хоосон хуудас)', usedRows, usedCols, truncated: false };
  }

  const lines: string[] = [];
  const header: string[] = ['#'];
  for (let c = 0; c < cols; c++) header.push(colToName(c));
  lines.push(header.join('\t'));

  // Бүрэн хоосон мөрийг ч ҮЛДЭЭНЭ — мөрийн дугаар нь томьёоны лавлагаатай
  // таарах ёстой (мөр алгасвал 'D4' ямар мөр болох нь зөрнө).
  for (let r = 0; r < rows; r++) {
    const line: string[] = [String(r + 1)];
    for (let c = 0; c < cols; c++) {
      line.push(tsvSafe(cellText(sheet.cells[`${colToName(c)}${r + 1}`])));
    }
    lines.push(line.join('\t'));
  }
  return { tsv: lines.join('\n'), usedRows, usedCols, truncated };
}

/* =============================================================
 * Бүртгэл
 * ============================================================= */

export function registerQuoteTools(server: McpServer, env: Env, user: McpProps) {
  /** admin блокоос гадуур санамсаргүй бүртгэгдвэл ч хаана — үнэ мэдрэмтгий. */
  const denied = () =>
    txt({ error: 'Үнийн саналын мэдээлэл зөвхөн admin эрхтэй хэрэглэгчид нээлттэй.' });
  const isAdmin = () => isAdminRole(user.role);

  /* ---------------- list_quotes ---------------- */
  server.registerTool(
    'list_quotes',
    {
      title: 'List price quotes (Үнийн санал)',
      description:
        'List the most recent price quotes (Үнийн санал) — id, title, client, ' +
        'variant, document date, cached total amount, author and last-edited time. ' +
        'Sorted by last edit (newest first). The spreadsheet body is NOT included; ' +
        'call get_quote with an id to read the actual table. Use for "what quotes ' +
        'did we send lately", "how much did we quote client X", "find the quote for ' +
        'object Y". Admin only.',
      inputSchema: {
        limit: z
          .number()
          .int()
          .min(1)
          .max(100)
          .optional()
          .describe('Max rows to return (default 20, max 100).'),
      },
    },
    async ({ limit }) => {
      if (!isAdmin()) return denied();
      try {
        const take = limit && Number.isFinite(limit) ? Math.min(100, Math.max(1, Math.trunc(limit))) : 20;
        const { results } = await env.DB.prepare(
          `SELECT q.id, q.title, q.client_name, q.variant_key, q.doc_date,
                  q.lang, q.total_amount, q.updated_at,
                  u.full_name AS created_by_name
             FROM quotes q
             LEFT JOIN users u ON u.id = q.created_by_id
            ORDER BY q.updated_at DESC
            LIMIT ?`,
        )
          .bind(take)
          .all<QuoteListRow>();

        const rows = results ?? [];
        return txt({
          count: rows.length,
          quotes: rows.map((r) => ({
            id: r.id,
            // Англи хувилбарыг (0181) жагсаалтад ялгаж харуулна.
            title: r.lang === 'en' ? `${r.title} (EN)` : r.title,
            client_name: r.client_name,
            variant_key: r.variant_key,
            /** «Ажлын зураг, Эскиз зураг» — `variant_key` нь олон түлхүүртэй байж болно. */
            variant_labels: variantLabelsMn(r.variant_key),
            doc_date: r.doc_date,
            total_amount: r.total_amount,
            total_amount_formatted: r.total_amount === null ? null : `${group(Math.round(r.total_amount))} ₮`,
            created_by_name: r.created_by_name,
            updated_at: r.updated_at,
          })),
          note:
            '`total_amount` нь хуудасны `anchors.total` нүдний КЭШ (клиент сүүлд ' +
            'хадгалахдаа бичсэн). Хэзээ ч нээгээгүй/тооцоологдоогүй бол null байж болно.',
        });
      } catch (err) {
        return txt({ error: err instanceof Error ? err.message : String(err) });
      }
    },
  );

  /* ---------------- get_quote ---------------- */
  server.registerTool(
    'get_quote',
    {
      title: 'Read one price quote as a table (Үнийн саналын дэлгэрэнгүй)',
      description:
        'Read a single price quote (Үнийн санал) — metadata plus the whole ' +
        'multi-sheet workbook. Each sheet is rendered as its own "## Хуудас: <name>" ' +
        'section with a TAB-SEPARATED table using Excel-style row numbers and column ' +
        'letters, so cell addresses in formulas can be followed. Formulas may ' +
        'reference other sheets as "=SheetName!A1" (e.g. "=ИГС!G17"). IMPORTANT: ' +
        'formula results are NOT stored on the server (the browser evaluates them), ' +
        'so a formula cell shows the formula itself (e.g. "=D4*E4"); only literal ' +
        'cells show values. The document total comes from the cached `total_amount` ' +
        'column instead. Use after list_quotes for "what is in quote N", "which ' +
        'coefficients were applied", "what area / rate was used". Admin only.',
      inputSchema: {
        quote_id: z.number().int().positive().describe('Quote id (see list_quotes).'),
      },
    },
    async ({ quote_id }) => {
      if (!isAdmin()) return denied();
      try {
        const row = await env.DB.prepare(
          `SELECT q.id, q.title, q.client_name, q.variant_key, q.doc_date, q.prepared_by,
                  q.project_id, q.template_id, q.template_version, q.sheet_json,
                  q.lang, q.total_amount, q.created_at, q.updated_at,
                  u.full_name AS created_by_name,
                  p.name AS project_name
             FROM quotes q
             LEFT JOIN users u ON u.id = q.created_by_id
             LEFT JOIN projects p ON p.id = q.project_id
            WHERE q.id = ?`,
        )
          .bind(quote_id)
          .first<QuoteFullRow>();
        if (!row) return txt({ error: `Үнийн санал #${quote_id} олдсонгүй.` });

        const wb = parseWorkbook(row.sheet_json);
        const sheets = wb.sheets;

        const sheetById = (id: string): NamedSheet | undefined => sheets.find((s) => s.id === id);
        const anchorLoc = (a: WorkbookAnchor | undefined): string | null =>
          a ? `${sheetById(a.sheet)?.name ?? a.sheet}!${a.ref}` : null;
        const anchorCell = (a: WorkbookAnchor | undefined): SheetCell | undefined =>
          a ? sheetById(a.sheet)?.cells[a.ref] : undefined;

        const totalAnchor = wb.anchors.total;
        const totalCell = anchorCell(totalAnchor);
        const totalLoc = anchorLoc(totalAnchor);
        const subtotalAnchor = wb.anchors.subtotal;
        const subtotalCell = anchorCell(subtotalAnchor);
        const subtotalLoc = anchorLoc(subtotalAnchor);

        // Бүх хуудсаар нэгтгэсэн тоо.
        let filled = 0;
        let formulaCount = 0;
        for (const s of sheets) {
          filled += Object.keys(s.cells).length;
          for (const c of Object.values(s.cells)) {
            if (c && typeof c.f === 'string' && c.f) formulaCount += 1;
          }
        }

        const anchorLine =
          Object.entries(wb.anchors)
            .map(([k, v]) => (v ? `${k}=${anchorLoc(v)}` : null))
            .filter((x): x is string => x !== null)
            .join(' · ') || '(тавигдаагүй)';

        const lines: string[] = [];
        lines.push(`# Үнийн санал #${row.id} — ${row.title || '(гарчиггүй)'}`);
        lines.push('');
        lines.push(`- Захиалагч: ${row.client_name ?? '—'}`);
        // Англи хувилбар (0181) дээр л хэлийг тусгайлан дурдана — 'mn' нь
        // өгөгдмөл тул мөр нэмэхгүй.
        if (row.lang === 'en') lines.push('- Хэл: English');
        // Төрөл нь ОЛОН байж болно ('design,sketch') — түүхий түлхүүрийг
        // үлдээгээд монгол нэрийг нь хажууд нь бичнэ.
        lines.push(`- Төрөл: ${variantLabelsMn(row.variant_key)} (${row.variant_key})`);
        lines.push(`- Баримтын огноо: ${row.doc_date}`);
        lines.push(`- Бэлтгэсэн: ${row.prepared_by ?? '—'}`);
        lines.push(
          `- Төсөл: ${row.project_id ? `#${row.project_id} ${row.project_name ?? ''}`.trim() : '— (холбоогүй)'}`,
        );
        lines.push(
          `- Загвар: ${row.template_id ? `#${row.template_id} (v${row.template_version ?? '?'})` : '—'}`,
        );
        lines.push(`- Үүсгэсэн: ${row.created_by_name ?? '—'} · ${row.created_at}`);
        lines.push(`- Сүүлд зассан: ${row.updated_at}`);
        lines.push('');
        lines.push('## НИЙТ ҮНЭ');
        lines.push(
          row.total_amount === null
            ? '(тооцоологдоогүй — `total_amount` кэш хоосон)'
            : `${group(Math.round(row.total_amount))} ₮  (кэш багана total_amount${
                totalLoc ? `, anchor нүд ${totalLoc}` : ''
              })`,
        );
        if (totalLoc && totalCell?.f) lines.push(`НИЙТ ҮНЭ-ний нүдний томьёо: ${totalCell.f}`);
        if (subtotalLoc) {
          lines.push(
            `ДҮН (subtotal) нүд ${subtotalLoc}: ${
              subtotalCell?.f ? subtotalCell.f : cellText(subtotalCell) || '(хоосон)'
            }`,
          );
        }
        lines.push('');
        lines.push('## Ажлын дэвтэр');
        lines.push(
          `${sheets.length} хуудас (${sheets.map((s) => s.name).join(', ')}); ` +
            `нийт ${filled} нүд (үүнээс ${formulaCount} томьёо).`,
        );
        lines.push(`Anchors: ${anchorLine}`);
        lines.push(
          'TSV формат: мөр бүрийн эхний талбар нь Excel-ийн мөрийн дугаар (1-ээс), ' +
            'толгой мөр нь баганын үсэг (A, B, C…).',
        );
        lines.push('');

        // Хуудас бүрийг тусад нь `## <нэр>` гарчигтай TSV блок болгож гаргана.
        for (const s of sheets) {
          const { tsv, usedRows, usedCols, truncated } = sheetToTsv(s);
          const sFilled = Object.keys(s.cells).length;
          const sFormula = Object.values(s.cells).filter(
            (c) => c && typeof c.f === 'string' && c.f,
          ).length;
          lines.push(`## Хуудас: ${s.name}`);
          lines.push(
            `${s.rows} мөр × ${s.cols} багана (бөглөгдсөн хүрээ ${usedRows}×${usedCols}), ` +
              `${sFilled} нүд (үүнээс ${sFormula} томьёо), ${s.merges.length} нэгтгэл (merge).`,
          );
          if (truncated) {
            lines.push(
              `⚠️ Хүснэгтийг ${MAX_TSV_ROWS} мөр × ${MAX_TSV_COLS} багана болгож таслав.`,
            );
          }
          lines.push('');
          lines.push(tsv);
          lines.push('');
        }

        lines.push('## ⚠️ Хязгаарлалт — заавал уншина уу');
        lines.push(
          '- Томьёоны ҮР ДҮНГ сервер ХАДГАЛДАГГҮЙ: тооцоог зөвхөн клиентийн формул ' +
            'хөдөлгүүр (SUM/TARIF/USGEER…) гүйцэтгэдэг. Тиймээс дээрх хүснэгтэд ' +
            'томьёотой нүд нь ТОМЬЁОГООРОО (жишээ нь `=D4*E4`) харагдана, литерал ' +
            'нүд нь утгаараа.',
        );
        lines.push(
          '- Тооцоолсон дүнгээс зөвхөн НИЙТ ҮНЭ л мэдэгдэнэ (`total_amount` кэш). ' +
            'Бусад томьёоны утгыг мэдэхийн тулд томьёог өөрөө гараар бод.',
        );
        lines.push(
          '- `=TARIF(талбай; "төвөгшил")` нь БД 81-16-20/2020 Хүснэгт 9-ийн ' +
            '`quote_tariffs` каталогоос уншина (area_max нь шатлалын ДЭЭД хязгаар: ' +
            '1,200 м² → 1500-ын мөр). Каталогийн ДЭЭД шатлалаас давсан талбай нь ' +
            'сүүлийн шатлалын ханшаар тооцогдоно (онцгой/өндөр 50,000 м², дунд ' +
            '40,000, бага 15,000, зөвшөөрөлгүй 400 — цаашид ханш тогтмол).',
        );
        lines.push(
          '- Нэгтгэсэн (merge) нүдний утга нь зөвхөн ЭХНИЙ (зүүн дээд) нүдэнд байна; ' +
            'үлдсэн нь хоосон харагдана.',
        );
        lines.push(
          '- Томьёо ӨӨР ХУУДАС руу `=ХуудасНэр!A1` хэлбэрээр лавлаж болно ' +
            '(жишээ `=ИГС!G17`) — тухайн нүдийг дээрх холбогдох хуудасны блокоос ол.',
        );

        return raw(lines.join('\n'));
      } catch (err) {
        return txt({ error: err instanceof Error ? err.message : String(err) });
      }
    },
  );
}
