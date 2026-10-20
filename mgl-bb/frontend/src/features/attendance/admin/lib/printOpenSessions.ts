import type { AttendanceSession } from '@/shared/types';
import type { TFn } from '@/features/attendance/admin/constants';
import { formatDateTime } from '@/features/attendance/admin/utils/format';
import {
  buildOpenSessionRows,
  openRangeLabel,
} from '@/features/attendance/admin/lib/openSessionRows';
import { brand } from '@/shared/config/brand';

/* =============================================================================
 *  Хаагдаагүй бүртгэл → ХЭВЛЭХ (A4).
 * -----------------------------------------------------------------------------
 *  ⚠️ ЯАГААД ШИНЭ ЦОНХ, `index.css`-ийн `.print-area` БИШ ВЭ:
 *
 *   1. Дэлгэц дээрх жагсаалт нь ХУУДАСЛАГДСАН (20 мөр) бөгөөд `max-h` +
 *      `overflow-y` дотор сууна.  DOM-оос хэвлэвэл зөвхөн одоогийн хуудас,
 *      бүр тайрагдсанаар гарна.  Шинэ цонх нь ШҮҮЛТЭД ТОХИРСОН БҮХ мөрийг
 *      авна — «би 47 хүнийг хэвлэлээ» гэдэг нь үнэн байх ёстой.
 *   2. `.print-area` нь `position: absolute` — аппын бүрхүүлийн `relative`/
 *      `overflow` эцгүүдээс болж байрлал нь найдваргүй.
 *   3. Шинэ цонх нь өөрийн `@page`-тэй тул `thead` хуудас бүрт давтагдана.
 *
 *  `ReadingPane`-ийн (мэйл хэвлэх) хэв маягийг дагасан: `document.write` →
 *  `close()` → `print()`.  COOP `same-origin` нь
 *  `about:blank`-ийн handle-ыг тасалдаггүй (тэр нь нээгчийнхээ origin-ыг
 *  өвлөнө) тул энэ нь энэ аппад ажилладаг нь батлагдсан.
 * ===========================================================================*/

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const PRINT_CSS = `
@page { size: A4 portrait; margin: 12mm 10mm; }
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; background: #fff; color: #000; }
body {
  font: 11px/1.45 "Segoe UI", "Noto Sans", system-ui, -apple-system, sans-serif;
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}
header { margin-bottom: 8px; }
h1 { font-size: 15px; margin: 0 0 2px; letter-spacing: .01em; }
.org { font-size: 10px; color: #444; margin: 0 0 6px; }
.meta {
  display: flex; flex-wrap: wrap; gap: 4px 18px;
  font-size: 10px; color: #333;
  border-top: 1px solid #000; border-bottom: 1px solid #000;
  padding: 4px 0; margin-bottom: 8px;
}
.meta b { font-weight: 600; }
table { width: 100%; border-collapse: collapse; table-layout: fixed; }
/* Баганы өргөн бол ГАРААР тогтоосон: автомат өргөн нь багана бүрийг
   агуулгаар нь хуваадаг тул ХООСОН «Тарсан» багана хамгийн нарийн
   болдог — харин цаасан дээр ЯГ ТЭР нүдэнд цаг бичих болно. */
col.nu { width: 4%; }
col.date { width: 12%; }
col.name { width: 18%; }
col.emp { width: 6%; }
col.team { width: 6%; }
col.in { width: 7%; }
col.out { width: 10%; }
col.late { width: 9%; }
col.days { width: 6%; }
col.note { width: 22%; }
/* Толгойг хуудас бүрт давтана — олон хуудастай жагсаалтын гол нөхцөл. */
thead { display: table-header-group; }
tr { break-inside: avoid; page-break-inside: avoid; }
th, td { border: 1px solid #000; padding: 3px 5px; vertical-align: top; overflow-wrap: anywhere; }
th { background: #e5e7eb; font-weight: 600; text-align: center; font-size: 10px; }
td.c { text-align: center; font-variant-numeric: tabular-nums; }
td.late { color: #b91c1c; font-weight: 600; }
/* Гарах цагийг цаасан дээр ГАРААР бөглөнө — нүдийг нь ялгаж харуулна. */
td.fill { background: #fff7ed; }
.sign { margin-top: 16px; display: flex; gap: 48px; font-size: 10px; }
.sign span { display: inline-block; min-width: 190px; border-bottom: 1px solid #000; }
@media screen { body { padding: 24px; } }
`;

export interface OpenPrintMeta {
  from: string;
  to: string;
  /** Нэрээр шүүсэн бол — толгойд дурдана. */
  nameFilter: string;
  /** Багаар шүүсэн бол «BB — Барилга бүтээц» хэлбэртэй шошго, эсвэл `null`.
   *  Энэ баримтыг тухайн багийн сениорт өгдөг тул аль багийнх болох нь
   *  ГАРЧИГТ нь бичигдэх ёстой — цаас гартаа авсан хүн шүүлтийг харахгүй. */
  teamLabel: string | null;
}

/**
 * Хэвлэх цонхыг нээж, тэр даруй хэвлэх харилцах цонхыг гаргана.
 *
 * @returns popup хаагдсан бол `false` — дуудагч тал хэрэглэгчид хэлнэ.
 */
export function printOpenSessions(
  sessions: AttendanceSession[],
  meta: OpenPrintMeta,
  t: TFn,
): boolean {
  const rows = buildOpenSessionRows(sessions);
  if (rows.length === 0) return true;

  const win = window.open('', '_blank');
  if (!win) return false;

  const title = t('attendanceAdminPage.openPrintTitle');
  const b = brand();

  const head = [
    t('attendanceAdminPage.colNoShort'),
    t('attendanceAdminPage.colDate'),
    t('common.name'),
    t('attendanceAdminPage.colNu'),
    t('attendanceAdminPage.colTeam'),
    t('attendanceAdminPage.colActualIn'),
    t('attendanceAdminPage.colActualOut'),
    t('attendanceAdminPage.colLateMin'),
    t('attendanceAdminPage.openColDaysOpen'),
    t('attendanceAdminPage.openColNote'),
  ]
    .map((h) => `<th>${esc(h)}</th>`)
    .join('');

  const body = rows
    .map(
      (r) => `<tr>
        <td class="c">${r.nu}</td>
        <td class="c">${esc(r.date)}</td>
        <td>${esc(r.name)}</td>
        <td class="c">${esc(r.employeeId)}</td>
        <td class="c">${esc(r.teamCode)}</td>
        <td class="c">${esc(r.clockIn)}</td>
        <td class="c fill"></td>
        <td class="c${r.lateMinutes > 0 ? ' late' : ''}">${r.lateMinutes || ''}</td>
        <td class="c">${r.daysOpen}</td>
        <td>${esc(r.note)}</td>
      </tr>`,
    )
    .join('');

  const metaBits = [
    `<div><b>${esc(t('attendanceAdminPage.openPrintRange'))}</b> ${esc(
      openRangeLabel(meta.from, meta.to, t),
    )}</div>`,
    meta.nameFilter.trim()
      ? `<div><b>${esc(t('attendanceAdminPage.openPrintNameFilter'))}</b> ${esc(meta.nameFilter.trim())}</div>`
      : '',
    `<div><b>${esc(t('attendanceAdminPage.openPrintGenerated'))}</b> ${esc(
      formatDateTime(new Date().toISOString()),
    )}</div>`,
    `<div><b>${esc(t('attendanceAdminPage.openPrintTotal', { count: rows.length }))}</b></div>`,
  ]
    .filter(Boolean)
    .join('');

  const html = `<!doctype html><html lang="mn"><head><meta charset="utf-8">
<title>${esc(title)} — ${esc(b.nameShort)}</title>
<style>${PRINT_CSS}</style></head>
<body>
  <header>
    <h1>${esc(meta.teamLabel ? `${title} — ${meta.teamLabel}` : title)}</h1>
    <p class="org">${esc(b.legalNameMn || b.name)}</p>
    <div class="meta">${metaBits}</div>
  </header>
  <table>
    <colgroup>
      <col class="nu"><col class="date"><col class="name"><col class="emp"><col class="team">
      <col class="in"><col class="out"><col class="late"><col class="days"><col class="note">
    </colgroup>
    <thead><tr>${head}</tr></thead>
    <tbody>${body}</tbody>
  </table>
  <div class="sign">
    <div>${esc(t('attendanceAdminPage.openPrintPreparedBy'))} <span></span></div>
    <div>${esc(t('attendanceAdminPage.openPrintApprovedBy'))} <span></span></div>
  </div>
</body></html>`;

  win.document.write(html);
  // `document.close()` нь задалтыг дуусгаж `load`-ыг нь асуулна — буцахад баримт
  // бэлэн.  Гадны фонт/зураг ачаалдаггүй тул хүлээх зүйл үлдэхгүй
  // (`ReadingPane`-ийн мэйл хэвлэхтэй ижил дараалал).
  win.document.close();
  // Хэвлэж дууссаны дараа (цуцалсан байсан ч) цонхоо цэвэрлэнэ —
  // үгүй бол хэвлэх бүрд хоосон цонх нэгээр үлдэнэ.
  win.onafterprint = () => win.close();
  win.focus();
  win.print();
  return true;
}
