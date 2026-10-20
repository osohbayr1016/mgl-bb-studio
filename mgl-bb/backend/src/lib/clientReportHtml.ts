/* =============================================================
 * Client-facing AEC design-progress report — HTML renderer.
 * -------------------------------------------------------------
 * Builds ONE self-contained bilingual (MN primary / EN secondary) HTML
 * document from a ClientReportData bundle. The same output feeds:
 *   - WeasyPrint (mode:'pdf')  — no JS; fonts installed in the container.
 *   - the on-site web view (mode:'web') — adds Google-Fonts @import + Paged.js
 *     for on-screen pagination.
 * Every chart is static SVG / pure CSS — WeasyPrint runs no JavaScript.
 * The "норм дүрэм" section is deliberately omitted (client request).
 * ============================================================= */
import type { ClientReportData, Rag } from './clientReport';
import { orgConfig } from './orgConfig';
import { resolveProjectIdentity } from './projectIdentity';

interface HtmlOpts {
  mode: 'pdf' | 'web';
  /** Inlined data-URI for the MGL logo (cover + footer). */
  logoDataUri?: string | null;
  /** Inlined data-URI for the project key image (cover). */
  keyImageDataUri?: string | null;
}

/* ---- escapers ---- */
function esc(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
/** Escape a string for use inside a CSS `content: "…"` declaration. */
function cssStr(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\r?\n/g, ' ');
}

const RAG_HEX: Record<Rag, string> = {
  green: '#16a34a',
  amber: '#d97706',
  red: '#dc2626',
  unknown: '#94a3b8',
};
const RAG_CHIP: Record<Rag, { bg: string; fg: string }> = {
  green: { bg: '#dcfce7', fg: '#166534' },
  amber: { bg: '#fef3c7', fg: '#92400e' },
  red: { bg: '#fee2e2', fg: '#991b1b' },
  unknown: { bg: '#f1f5f9', fg: '#475569' },
};

export function buildClientReportHtml(data: ClientReportData, opts: HtmlOpts): string {
  const en = data.lang === 'en';
  /** lang-based label. */
  const L = (mn: string, eng: string): string => (en ? eng : mn);
  const ragWord = (r: Rag): string =>
    L(
      { green: 'Хэвийн', amber: 'Анхаарах', red: 'Хоцорч буй', unknown: 'Тодорхойгүй' }[r],
      { green: 'On track', amber: 'At risk', red: 'Behind', unknown: 'N/A' }[r],
    );
  const fmtDate = (s: string | null | undefined): string =>
    s && /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10).replace(/-/g, '.') : '—';
  const fmtPct = (n: number | null | undefined): string =>
    n === null || n === undefined ? '—' : `${Math.round(n)}%`;
  const fmtSigned = (n: number | null | undefined): string =>
    n === null || n === undefined ? '—' : `${n >= 0 ? '+' : ''}${n.toFixed(1)}`;

  const ragChip = (r: Rag): string => {
    const c = RAG_CHIP[r];
    return `<span class="chip" style="background:${c.bg};color:${c.fg};">● ${esc(ragWord(r))}</span>`;
  };
  // Risk-impact chip — same colors, severity wording (Low/Medium/High).
  const impactWord = (r: Rag): string =>
    L(
      { green: 'Бага', amber: 'Дунд', red: 'Өндөр', unknown: '—' }[r],
      { green: 'Low', amber: 'Medium', red: 'High', unknown: '—' }[r],
    );
  const impactChip = (r: Rag): string => {
    const c = RAG_CHIP[r];
    return `<span class="chip" style="background:${c.bg};color:${c.fg};">● ${esc(impactWord(r))}</span>`;
  };
  const bar = (pct: number, color = '#0ea5e9'): string => {
    const p = Math.max(0, Math.min(100, Math.round(pct)));
    return `<span class="bar"><span class="bar-fill" style="width:${p}%;background:${color};"></span></span>`;
  };

  const section = (mn: string, eng: string, body: string, opt: { avoid?: boolean } = {}): string =>
    `<section class="sec${opt.avoid ? ' avoid' : ''}">
       <div class="sec-h"><h2>${esc(mn)}</h2><span>${esc(eng)}</span></div>
       ${body}
     </section>`;

  /* ---- charts ---- */
  const overallRing = (pct: number, rag: Rag): string => {
    const size = 132;
    const stroke = 14;
    const r = (size - stroke) / 2;
    const c = 2 * Math.PI * r;
    const dash = (Math.max(0, Math.min(100, pct)) / 100) * c;
    const color = RAG_HEX[rag] === RAG_HEX.unknown ? '#0ea5e9' : RAG_HEX[rag];
    return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" class="ring">
      <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="#e2e8f0" stroke-width="${stroke}"/>
      <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${color}" stroke-width="${stroke}"
        stroke-linecap="round" stroke-dasharray="${dash.toFixed(2)} ${c.toFixed(2)}"
        transform="rotate(-90 ${size / 2} ${size / 2})"/>
      <text x="50%" y="50%" text-anchor="middle" dominant-baseline="central"
        font-size="30" font-weight="700" fill="#0f172a">${Math.round(pct)}%</text>
    </svg>`;
  };

  const sCurve = (): string => {
    const W = 540;
    const H = 250;
    const padL = 38;
    const padR = 16;
    const padT = 16;
    const padB = 34;
    const plotW = W - padL - padR;
    const plotH = H - padT - padB;
    const mapX = (t: number) => padL + (Math.max(0, Math.min(100, t)) / 100) * plotW;
    const mapY = (p: number) => padT + plotH - (Math.max(0, Math.min(100, p)) / 100) * plotH;
    const grid = [0, 25, 50, 75, 100]
      .map((g) => {
        const y = mapY(g);
        return `<line x1="${padL}" y1="${y.toFixed(1)}" x2="${(W - padR).toFixed(1)}" y2="${y.toFixed(1)}" stroke="#eef2f7"/>
        <text x="${padL - 6}" y="${(y + 3).toFixed(1)}" text-anchor="end" font-size="9" fill="#94a3b8">${g}</text>`;
      })
      .join('');
    const toPts = (arr: Array<{ x: number; y: number }>) =>
      arr.map((p) => `${mapX(p.x).toFixed(1)},${mapY(p.y).toFixed(1)}`).join(' ');
    const expected = data.chart.expected.length
      ? `<polyline fill="none" stroke="#94a3b8" stroke-width="1.8" stroke-dasharray="5 4" points="${toPts(
          data.chart.expected,
        )}"/>`
      : '';
    const actualPts = data.chart.actual;
    const actualLine =
      actualPts.length > 1
        ? `<polyline fill="none" stroke="#0ea5e9" stroke-width="2.4" points="${toPts(actualPts)}"/>`
        : '';
    const actualDots = actualPts
      .map((p) => `<circle cx="${mapX(p.x).toFixed(1)}" cy="${mapY(p.y).toFixed(1)}" r="3.4" fill="#0ea5e9"/>`)
      .join('');
    const todayLine =
      data.chart.today_x !== null
        ? `<line x1="${mapX(data.chart.today_x).toFixed(1)}" y1="${padT}" x2="${mapX(
            data.chart.today_x,
          ).toFixed(1)}" y2="${padT + plotH}" stroke="#dc2626" stroke-width="1" stroke-dasharray="3 3"/>`
        : '';
    return `<svg width="100%" viewBox="0 0 ${W} ${H}" class="scurve" preserveAspectRatio="xMidYMid meet">
      ${grid}
      <line x1="${padL}" y1="${padT + plotH}" x2="${W - padR}" y2="${padT + plotH}" stroke="#cbd5e1"/>
      ${expected}${actualLine}${actualDots}${todayLine}
      <text x="${padL}" y="${H - 8}" font-size="9" fill="#94a3b8">0%</text>
      <text x="${(W - padR).toFixed(1)}" y="${H - 8}" text-anchor="end" font-size="9" fill="#94a3b8">${L(
        'хугацаа 100%',
        'time 100%',
      )}</text>
    </svg>
    <div class="legend">
      <span><i style="background:#94a3b8"></i>${esc(L('Төлөвлөгөө (50/70)', 'Planned (50/70)'))}</span>
      <span><i style="background:#0ea5e9"></i>${esc(L('Гүйцэтгэл', 'Actual'))}</span>
      <span><i style="background:#dc2626"></i>${esc(L('Өнөөдөр', 'Today'))}</span>
    </div>`;
  };

  /* ---- cover ---- */
  const p = data.passport;

  /* ⚠️ ТӨСЛИЙН «ХУВИЙН МЭДЭЭЛЛИЙН» ШАТЛАЛЫГ ЭНД ГАРААР БҮҮ БИЧ.
   *  Гарчиг → шифр → Doc. No. → цар хүрээ → захирал → мэргэжлүүд бүгд
   *  `lib/projectIdentity.ts`-ийн ЦОРЫН ГАНЦ resolver-ээр дамжина.  Урьд нь
   *  энэ файл `full_title || display_title || name` гэсэн ТАВ ДАХЬ хуулбарыг
   *  авч явсан бөгөөд `introAuto.ts`-ийн вэб хувилбартай зөрөх боломжтой
   *  байсан (эзний 2026-09-02-ны гомдол яг тэр).
   *
   *  ⚠️ ЗӨВХӨН СКАЛЯР талбаруудыг уншина.  Resolver-ийн үлдсэн гаралт нь
   *  ЭНД ЗОРИУД ХЭРЭГЛЭГДЭХГҮЙ, учир нь захиалагчийн PDF-ийн дүрэм өөр:
   *    • `clientName`   — resolver нь `project_clients`-ээс гаргадаг; тайлан
   *      нь паспортын `client_contacts[0]`-ийг хэвлэдэг (өөр эх сурвалж) ба
   *      `ClientReportData`-д `project_clients` БАЙХГҮЙ.
   *    • `location`     — `ClientReportData.project`-д тийм талбар байхгүй.
   *    • `scopeRows`    — resolver нь паспорт хоосон үед багийн хуваарьнаас
   *      НӨХДӨГ; захиалагчийн хувилбарт ажилтны нэр гарах ёсгүй тул
   *      `data` дотор багийн ахлахын нэр ч байдаггүй.
   *    • `timeline` / `meetings` / `startDate…` — `normalisePassportDate` нь
   *      танихгүй огноог `null` болгож ХАЯДАГ атал доорх `freeDate` нь
   *      гараар бичсэн текстийг ХЭВЭЭР хэвлэдэг (продакшнд «2026.07.09»,
   *      «-» хоёул бий).  Тэднийг resolver рүү шилжүүлбэл одоо хэвлэгдэж
   *      байгаа огноонууд PDF-ээс алга болно.
   *  Эдгээрийг resolver руу татах нь ТУСДАА шийдвэр — гаралт өөрчлөгдөнө. */
  const identity = resolveProjectIdentity({ project: data.project, passport: p });
  const title = identity.title;
  const clientName = (() => {
    const cc = p?.client_contacts?.[0];
    return cc?.full_name || '';
  })();
  const cover = `
    <section class="cover">
      ${opts.keyImageDataUri ? `<div class="cover-img" style="background-image:url('${opts.keyImageDataUri}')"></div>` : ''}
      <div class="cover-body">
        <div class="cover-top">
          ${opts.logoDataUri ? `<img src="${opts.logoDataUri}" class="cover-logo" alt="${esc(orgConfig().nameShort)}"/>` : `<span class="wordmark">${esc(orgConfig().name)}</span>`}
          <span class="cover-kind">${esc(L('Зураг төслийн явцын тайлан', 'Design Progress Report'))}</span>
        </div>
        <h1>${esc(title)}</h1>
        ${identity.drawingNo ? `<div class="cover-dno">${esc(L('Зургийн шифр', 'Drawing No.'))}: <b>${esc(identity.drawingNo)}</b></div>` : ''}
        <div class="cover-grid">
          <div class="cover-ring">${overallRing(data.overall_progress, data.schedule.rag)}
            <div class="cover-ring-lbl">${esc(L('Нийт явц', 'Overall progress'))}</div>
          </div>
          <div class="cover-meta">
            ${clientName ? `<div><span>${esc(L('Захиалагч', 'Client'))}</span><b>${esc(clientName)}</b></div>` : ''}
            ${data.report ? `<div><span>${esc(L('Тайлан №', 'Report No.'))}</span><b>${esc(String(data.report.report_no).padStart(2, '0'))}</b></div>` : ''}
            <div><span>${esc(L('Огноо', 'Date'))}</span><b>${esc(fmtDate(data.generated_at))}</b></div>
            ${
              data.report
                ? `<div><span>${esc(L('Хамрах хугацаа', 'Period'))}</span><b>${esc(fmtDate(data.report.period_start))} – ${esc(fmtDate(data.report.period_end))}</b></div>`
                : ''
            }
            <div class="cover-rag"><span>${esc(L('Хуваарийн төлөв', 'Schedule status'))}</span> ${ragChip(data.schedule.rag)}</div>
          </div>
        </div>
      </div>
    </section>`;

  /* ---- passport ---- */
  /* ⚠️ Паспортын огноонууд нь ШАЛГАГДААГҮЙ чөлөөт текст — продакшн дээр
   *  '2026.07.09' ба '-' хоёул тааралддаг.  ISO бол цэгтэй хэлбэрт хөрвүүлж,
   *  бусдыг нь бичсэн чигээр нь үзүүлнэ; зураас бол огноо БИШ тул хоосон
   *  буцааж, тухайн мөрийг огт хэвлэхгүй.  (`fmtDate` нь ISO биш бүхнийг '—'
   *  болгодог тул гараар бичсэн огноог устгах байсан.) */
  const freeDate = (s: string | null | undefined): string => {
    const t = (s ?? '').trim();
    if (!t || t === '-' || t === '–' || t === '—') return '';
    return /^\d{4}-\d{2}-\d{2}/.test(t) ? t.slice(0, 10).replace(/-/g, '.') : t;
  };

  /* «1.3 Төслийн хугацаа» — эх сурвалж нь `timeline`, тэр хоосон бол
   *  паспортын start/finish/extension БАГАНУУД.  Паспортын засварлагч 1.3-ын
   *  огноог багана руу давхар бичдэг тул timeline бол багануудын ДЭЭД олонлог.
   *  Хоёулаа хоосон бол хүснэгт огт гарахгүй. */
  const timelineRows: Array<{ label: string; date: string }> = [];
  if (p) {
    if (p.timeline.length) {
      for (const t of p.timeline) {
        const label = en ? t.labelEn || t.labelMn : t.labelMn || t.labelEn;
        const date = freeDate(t.date);
        if (label || date) timelineRows.push({ label, date });
      }
    } else {
      const cols: Array<[string, string | null]> = [
        [L('Эхлэх', 'Start'), p.start_date],
        [L('Дуусах', 'Finish'), p.finish_date],
        [L('Сунгалт', 'Extension'), p.extension_date],
      ];
      for (const [label, raw] of cols) {
        const date = freeDate(raw);
        if (date) timelineRows.push({ label, date });
      }
    }
  }

  const passportRows: Array<[string, string]> = [];
  if (p) {
    /* ⚠️ ЭНЭ МӨР нь ПАСПОРТЫН ӨӨРИЙНХ НЬ `full_title` талбар — `identity.title`
     *  БИШ.  Хүснэгт нь «паспортад юу бичигдсэн»-ийг харуулдаг тул хоосон
     *  `full_title`-ыг `display_title`-ээр НӨХӨХ ЁСГҮЙ: тэгвэл засварлагч дээр
     *  хоосон харагдах талбар PDF дээр дүүрэн харагдаж, «би юу ч бичээгүй
     *  атлаа хаанаас гарав?» гэсэн зөрүү үүснэ.  Нүүрэн талын гарчиг (дээрх
     *  `identity.title`) л шатлалаар нөхөгдөнө. */
    if (p.full_title) passportRows.push([L('Төслийн нэр', 'Project title'), p.full_title]);
    if (identity.drawingNo) passportRows.push([L('Зургийн шифр', 'Drawing No.'), identity.drawingNo]);
    /* «Doc. No.» нь `drawing_no` (Зургийн шифр)-ээс ӨӨР талбар — бүхэлдээ
     *  гараар бичигдэх баримтын дугаар, тайланд хоёулаа хэвлэгдэнэ. */
    if (identity.docNo) passportRows.push([L('Баримтын дугаар (Doc. No.)', 'Doc. No.'), identity.docNo]);
    if (identity.scope) passportRows.push([L('Ажлын цар хүрээ', 'Scope'), identity.scope]);
    if (identity.director) passportRows.push([L('Захирал', 'Director'), identity.director]);
    /* Гэрээний огноо ЭНД БАЙХГҮЙ БОЛСОН: бүх огноо «1.3 Төслийн хугацаа»
     *  хүснэгтээр дамжина (мөн «Хуваарь ба үе шатууд» хэсэгт давхар гарна).
     *  Хуучин хувилбар нь огноогүй паспорт дээр «Гэрээний эхлэл: —» гэсэн
     *  хоосон мөр хэвлэдэг байсан — 1.3 нь эх сурвалж хоосон үед бүрэн
     *  унадаг тул давхардлыг ч, хоосон мөрийг ч нэг дор арилгав. */
    if (identity.disciplines.length)
      passportRows.push([L('Мэргэжлүүд', 'Disciplines'), identity.disciplines.join(', ')]);
  }

  /* «1.2 Хамрах хүрээ» — ЗАХИАЛАГЧИЙН хувилбарт «Team leader» ба «Хариуцсан
   *  мэргэжилтэн» БАГАНА БАЙХГҮЙ (эзний шийдвэр 2026-09-03): захиалагч ямар
   *  мэргэжлүүд хамрагдсаныг харах ёстой ч ажилтны нэрийг ХЭЗЭЭ Ч харахгүй.
   *  `clientReport.ts` нь audience:'client' үед «Сүүлийн үйл ажиллагаа»-ны
   *  «Хэн» баганыг аль хэдийн хасдаг — энэ хүснэгт хүний нэрийг өөр хаалгаар
   *  буцааж оруулах ёсгүй.  Дотоод хувилбарт нэр хэрэгтэй болбол
   *  `data.audience === 'internal'` дээр ШИНЭ багана нэмнэ; `leader` /
   *  `specialist`-ыг энд болзолгүйгээр БҮҮ сэргээ. */
  const scopeRows = (p?.scope_rows ?? []).filter(
    (s) => s.code || s.codeLabel || s.identification || s.fileName,
  );
  const scopeTable = scopeRows.length
    ? `<h3 class="sub">${esc(L('1.2 Хамрах хүрээ', '1.2 Scope of work'))}</h3>
       <table class="tbl"><thead><tr>
         <th class="num">№</th><th>${esc(L('А/хэсэг', 'Dic.'))}</th>
         <th>${esc(L('Тодорхойлолт', 'Identification'))}</th>
         <th>${esc(L('Файлын нэр', 'File name'))}</th></tr></thead><tbody>
       ${scopeRows
         .map(
           (s, i) =>
             `<tr><td class="num">${i + 1}</td><td>${esc(s.codeLabel || s.code)}</td><td>${esc(s.identification)}</td><td>${esc(s.fileName)}</td></tr>`,
         )
         .join('')}</tbody></table>`
    : '';

  const timelineTable = timelineRows.length
    ? `<h3 class="sub">${esc(L('1.3 Төслийн хугацаа', '1.3 Project timeline'))}</h3>
       <table class="tbl"><thead><tr>
         <th class="num">№</th><th>${esc(L('Үе шат', 'Milestone'))}</th>
         <th>${esc(L('Огноо', 'Date'))}</th></tr></thead><tbody>
       ${timelineRows
         .map(
           (r, i) =>
             `<tr><td class="num">${i + 1}</td><td>${esc(r.label)}</td><td>${r.date ? esc(r.date) : '—'}</td></tr>`,
         )
         .join('')}</tbody></table>`
    : '';

  /* Уулзалтын хуваарь — паспортын 1.3-ын баруун хүснэгт.  Тайлангийн
   *  «Хуваарь ба үе шатууд» дахь `status_meetings`-тэй ХОЛБООГҮЙ: тэр нь
   *  системд бүртгэгдсэн явцын уулзалт, энэ нь гэрээний паспортад бичигдсэн
   *  товлол. */
  const meetingRows = (p?.meetings ?? [])
    .map((m) => ({ label: m.label.trim(), date: freeDate(m.date) }))
    .filter((m) => m.label || m.date);
  const meetingsTable = meetingRows.length
    ? `<h3 class="sub">${esc(L('Уулзалтын хуваарь', 'Meeting schedule'))}</h3>
       <table class="tbl"><thead><tr>
         <th class="num">№</th><th>${esc(L('Уулзалт', 'Meeting'))}</th>
         <th>${esc(L('Огноо', 'Date'))}</th></tr></thead><tbody>
       ${meetingRows
         .map(
           (m, i) =>
             `<tr><td class="num">${i + 1}</td><td>${esc(m.label)}</td><td>${m.date ? esc(m.date) : '—'}</td></tr>`,
         )
         .join('')}</tbody></table>`
    : '';

  const contactsTable = p?.client_contacts?.length
    ? `<table class="tbl"><thead><tr>
         <th>${esc(L('Нэр', 'Name'))}</th><th>${esc(L('Албан тушаал', 'Position'))}</th>
         <th>${esc(L('Утас', 'Phone'))}</th><th>${esc(L('И-мэйл', 'Email'))}</th></tr></thead><tbody>
       ${p.client_contacts
         .map(
           (cc) =>
             `<tr><td>${esc(cc.full_name)}</td><td>${esc(cc.position)}</td><td>${esc(cc.phone)}</td><td>${esc(cc.email)}</td></tr>`,
         )
         .join('')}</tbody></table>`
    : '';
  /* Дэд блокууд баримтын дугаарлалтаараа эрэмбэлэгдэнэ (1.2 → 1.3 → уулзалт):
   *  гарчигт нь дугаар нь бичигдсэн тул урвуу дараалал захиалагчид алдаа мэт
   *  харагдана.  Эх сурвалж нь хоосон блок БҮРЭН унана — тайланд хоосон
   *  гарчиг гарч болохгүй. */
  const passportBody = `${
    passportRows.length
      ? `<table class="tbl kv">${passportRows
          .map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`)
          .join('')}</table>`
      : ''
  }${scopeTable}${timelineTable}${meetingsTable}${
    contactsTable
      ? `<h3 class="sub">${esc(L('Захиалагчийн төлөөлөл', 'Client contacts'))}</h3>${contactsTable}`
      : ''
  }`;
  const passportSec =
    p && passportBody ? section('Төслийн танилцуулга', 'Project passport', passportBody) : '';

  /* ---- executive summary ---- */
  const dash = `
    <div class="chips4">
      <div class="kpi"><b>${fmtPct(data.overall_progress)}</b><span>${esc(L('Нийт явц', 'Overall'))}</span></div>
      <div class="kpi"><b>${ragChip(data.schedule.rag)}</b><span>${esc(L('Хуваарь', 'Schedule'))}</span></div>
      <div class="kpi"><b>${esc(fmtSigned(data.schedule.variance))}</b><span>${esc(L('Хуваарийн зөрүү', 'Schedule variance'))}</span></div>
      <div class="kpi"><b>${data.disciplines.length}</b><span>${esc(L('Мэргэжил', 'Disciplines'))}</span></div>
    </div>`;
  const summaryText = data.authored.summary_md?.trim();
  const execSec = section(
    'Гүйцэтгэх удирдлагын хураангуй',
    'Executive summary',
    `${dash}${
      summaryText
        ? `<div class="prose">${esc(summaryText).replace(/\r?\n/g, '<br/>')}</div>`
        : `<p class="muted">${esc(
            L(
              'Энэ хэсэгт төслийн ахлах удирдагчийн бичсэн товч дүгнэлт орно.',
              'A short narrative from the project lead goes here.',
            ),
          )}</p>`
    }`,
    { avoid: true },
  );

  /* ---- overall dashboard (ring + s-curve + variance) ---- */
  const varianceNote =
    data.schedule.variance !== null
      ? L(
          `Хугацааны ${fmtPct(data.schedule.elapsed_pct)} өнгөрсөн; төлөвлөснөөр ${fmtPct(
            data.schedule.expected_pct,
          )} байх ёстой, гүйцэтгэл ${fmtPct(data.overall_progress)} — зөрүү ${fmtSigned(
            data.schedule.variance,
          )} нэгж.`,
          `${fmtPct(data.schedule.elapsed_pct)} of time elapsed; plan expects ${fmtPct(
            data.schedule.expected_pct,
          )}, actual is ${fmtPct(data.overall_progress)} — variance ${fmtSigned(
            data.schedule.variance,
          )} pts.`,
        )
      : L('Гэрээний огноо дутуу тул хуваарийн зөрүү тооцоогүй.', 'Contract dates missing — schedule variance not computed.');
  const dashSec = section(
    'Нийт явцын самбар',
    'Overall progress dashboard',
    `<div class="dash2">
       <div class="dash-ring">${overallRing(data.overall_progress, data.schedule.rag)}</div>
       <div class="dash-curve">${sCurve()}</div>
     </div>
     <div class="callout rag-${data.schedule.rag}">${ragChip(data.schedule.rag)} ${esc(varianceNote)}</div>
     <p class="fine">${esc(
       L(
         `RAG босго: Хэвийн ≥ ${data.rag_thresholds.green}; Анхаарах ${data.rag_thresholds.green}…${data.rag_thresholds.amber}; Хоцорч буй < ${data.rag_thresholds.amber}. Хүлээгдэх явц 50/70 S-муруйгаар.`,
         `RAG thresholds: On track ≥ ${data.rag_thresholds.green}; At risk ${data.rag_thresholds.green}…${data.rag_thresholds.amber}; Behind < ${data.rag_thresholds.amber}. Expected progress via the 50/70 S-curve.`,
       ),
     )}</p>`,
  );

  /* ---- disciplines ---- */
  const discRows = data.disciplines
    .map((d) => {
      const name = en ? d.team_name_en || d.team_name_mn : d.team_name_mn;
      return `<tr>
        <td><b>${esc(d.team_code)}</b> ${esc(name)}</td>
        <td class="num">${d.share_percent}%</td>
        <td class="barcell">${bar(d.progress, RAG_HEX[d.rag])}<span class="num">${fmtPct(d.progress)}</span></td>
        <td class="num">${d.task_count}</td>
        <td>${ragChip(d.rag)}</td>
      </tr>`;
    })
    .join('');
  const discSec = section(
    'Мэргэжил тус бүрийн явц',
    'Discipline-by-discipline progress',
    `<table class="tbl"><thead><tr>
       <th>${esc(L('Мэргэжил', 'Discipline'))}</th><th class="num">${esc(L('Эзлэх %', 'Share'))}</th>
       <th>${esc(L('Явц', 'Progress'))}</th><th class="num">${esc(L('Таск', 'Tasks'))}</th>
       <th>${esc(L('Төлөв', 'Status'))}</th></tr></thead><tbody>${discRows}</tbody></table>`,
  );

  /* ---- heat map (optional) ---- */
  const heatColor = (v: number | null): string => {
    if (v === null) return '#f8fafc';
    const t = Math.max(0, Math.min(100, v)) / 100;
    // red(0) -> amber(0.5) -> green(1)
    const hue = 0 + t * 130;
    return `hsl(${hue.toFixed(0)} 70% 86%)`;
  };
  const heatSec = data.heatmap
    ? section(
        'Блок × мэргэжлийн дулааны зураг',
        'Block × discipline heat map',
        `<table class="tbl heat"><thead><tr><th></th>${data.heatmap.zones
          .map((z) => `<th>${esc(z)}</th>`)
          .join('')}</tr></thead><tbody>${data.heatmap.disciplines
          .map(
            (code, i) =>
              `<tr><th>${esc(code)}</th>${(data.heatmap?.cells[i] ?? [])
                .map(
                  (v) =>
                    `<td class="heatcell" style="background:${heatColor(v)}">${v === null ? '' : `${Math.round(v)}%`}</td>`,
                )
                .join('')}</tr>`,
          )
          .join('')}</tbody></table>
        <p class="fine">${esc(L('Утга нь блокийн нэрнээс гаргасан бүс тус бүрийн дундаж явц.', 'Cells show average progress per zone parsed from block names.'))}</p>`,
      )
    : '';

  /* ---- drawing register ---- */
  const statusWord = (s: 'not_started' | 'in_progress' | 'complete'): string =>
    L(
      { not_started: 'Эхлээгүй', in_progress: 'Хийгдэж буй', complete: 'Дууссан' }[s],
      { not_started: 'Not started', in_progress: 'In progress', complete: 'Complete' }[s],
    );
  const registerBody = data.register.length
    ? data.register
        .map(
          (b) => `<div class="reg-block">
            <div class="reg-head"><b>${esc(b.block_name)}</b>${b.team_code ? `<span class="tag">${esc(b.team_code)}</span>` : ''}<span class="num">${fmtPct(b.progress)}</span></div>
            <table class="tbl"><thead><tr>
              <th>${esc(L('Зураг', 'Drawing'))}</th><th class="num">${esc(L('Жин %', 'Weight'))}</th>
              <th>${esc(L('Явц', 'Progress'))}</th><th>${esc(L('Төлөв', 'Status'))}</th></tr></thead><tbody>
              ${b.drawings
                .map(
                  (d) =>
                    `<tr><td>${esc(d.name)}</td><td class="num">${d.weight_percent}%</td>
                       <td class="barcell">${bar(d.progress)}<span class="num">${fmtPct(d.progress)}</span></td>
                       <td>${esc(statusWord(d.status))}</td></tr>`,
                )
                .join('')}
            </tbody></table>
          </div>`,
        )
        .join('')
    : `<p class="muted">${esc(L('Бүртгэл хоосон.', 'No drawings registered.'))}</p>`;
  const registerSec = section('Зургийн бүртгэл', 'Drawing register', registerBody);

  /* ---- schedule & milestones ---- */
  const milestoneBody = data.status_meetings.length
    ? `<table class="tbl"><thead><tr>
         <th>${esc(L('Үе шат', 'Milestone'))}</th><th class="num">%</th>
         <th>${esc(L('Товлосон', 'Scheduled'))}</th><th>${esc(L('Биелсэн', 'Completed'))}</th></tr></thead><tbody>
       ${data.status_meetings
         .map(
           (m) =>
             `<tr><td>${esc(m.label)}</td><td class="num">${esc(String(m.percent))}%</td><td>${esc(fmtDate(m.scheduled_at))}</td><td>${m.completed_at ? esc(fmtDate(m.completed_at)) : '—'}</td></tr>`,
         )
         .join('')}</tbody></table>`
    : '';
  const scheduleSec = section(
    'Хуваарь ба үе шатууд',
    'Schedule & milestones',
    `<table class="tbl kv">
       <tr><th>${esc(L('Гэрээний эхлэл', 'Contract start'))}</th><td>${esc(fmtDate(data.schedule.start_date))}</td></tr>
       <tr><th>${esc(L('Гэрээний дуусах', 'Contract finish'))}</th><td>${esc(fmtDate(data.schedule.finish_date))}</td></tr>
       <tr><th>${esc(L('Хугацаа өнгөрсөн', 'Time elapsed'))}</th><td>${esc(fmtPct(data.schedule.elapsed_pct))}</td></tr>
       <tr><th>${esc(L('Гүйцэтгэл', 'Actual progress'))}</th><td>${esc(fmtPct(data.overall_progress))}</td></tr>
       <tr><th>${esc(L('Хуваарийн зөрүү', 'Schedule variance'))}</th><td>${esc(fmtSigned(data.schedule.variance))} ${ragChip(data.schedule.rag)}</td></tr>
     </table>
     ${
       data.schedule.finish_passed && data.overall_progress < 100
         ? `<div class="callout rag-red">${esc(L('Анхаар: гэрээний дуусах хугацаа өнгөрсөн боловч ажил дуусаагүй байна.', 'Note: the contract finish date has passed but the work is not complete.'))}</div>`
         : ''
     }
     ${milestoneBody}`,
  );

  /* ---- recent activity ---- */
  const recentSec = data.recent.length
    ? section(
        'Сүүлийн үйл ажиллагаа',
        'Recent activity',
        `<table class="tbl"><thead><tr>
           <th>${esc(L('Огноо', 'Date'))}</th><th>${esc(L('Блок', 'Block'))}</th>
           <th>${esc(L('Таск', 'Task'))}</th><th class="num">%</th>
           ${data.audience === 'internal' ? `<th>${esc(L('Хэн', 'By'))}</th>` : ''}</tr></thead><tbody>
         ${data.recent
           .map(
             (r) =>
               `<tr><td>${esc(fmtDate(r.date))}</td><td>${esc(r.block ?? '—')}</td><td>${esc(r.task ?? '—')}</td><td class="num">${fmtPct(r.percentage)}</td>${
                 data.audience === 'internal' ? `<td>${esc(r.user ?? '—')}</td>` : ''
               }</tr>`,
           )
           .join('')}</tbody></table>`,
      )
    : '';

  /* ---- risks ---- */
  const risksSec = section(
    'Эрсдэл ба бууруулах арга',
    'Risks & mitigations',
    data.authored.risks.length
      ? `<table class="tbl"><thead><tr>
           <th>${esc(L('Эрсдэл', 'Risk'))}</th><th>${esc(L('Нөлөө', 'Impact'))}</th>
           <th>${esc(L('Хариуцагч', 'Owner'))}</th><th>${esc(L('Бууруулах арга', 'Mitigation'))}</th></tr></thead><tbody>
         ${data.authored.risks
           .map(
             (r) =>
               `<tr><td>${esc(r.risk)}</td><td>${impactChip(r.impact)}</td><td>${esc(r.owner)}</td><td>${esc(r.mitigation)}</td></tr>`,
           )
           .join('')}</tbody></table>`
      : `<p class="muted">${esc(L('Бүртгэгдсэн эрсдэл алга.', 'No risks recorded.'))}</p>`,
  );

  /* ---- next-period plan ---- */
  const nextSec = section(
    'Дараагийн үеийн төлөвлөгөө',
    'Next-period plan',
    data.authored.next_plan.length
      ? `<ul class="plan">${data.authored.next_plan.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>`
      : `<p class="muted">${esc(L('Төлөвлөгөө бичигдээгүй байна.', 'No plan entries yet.'))}</p>`,
  );

  /* ---- sign-off ---- */
  const signSec = section(
    'Баталгаажуулалт',
    'Sign-off',
    `<div class="sign">
       <div class="sign-box"><div class="sign-line"></div><span>${esc(L(`${orgConfig().name} — Захирал`, `${orgConfig().name} — Director`))}</span></div>
       <div class="sign-box"><div class="sign-line"></div><span>${esc(L('Захиалагчийн төлөөлөл', 'Client representative'))}</span></div>
     </div>`,
    { avoid: true },
  );

  /* ---- assemble ---- */
  const headerStr = cssStr(`${data.project.name}${data.report ? ` — №${String(data.report.report_no).padStart(2, '0')}` : ''}`);
  const footerStr = cssStr(`${orgConfig().name} · ${fmtDate(data.generated_at)}`);

  const webHead =
    opts.mode === 'web'
      ? `<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
         <link href="https://fonts.googleapis.com/css2?family=Noto+Sans:wght@400;600;700&family=Noto+Serif:wght@600;700&display=swap" rel="stylesheet">`
      : '';
  const pagedScript =
    opts.mode === 'web'
      ? `<script src="https://unpkg.com/pagedjs/dist/paged.polyfill.js"></script>`
      : '';

  const css = `
    * { box-sizing: border-box; }
    html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    body { font-family: 'Noto Sans','DejaVu Sans',sans-serif; color:#0f172a; font-size:10.5pt; line-height:1.5; margin:0; }
    h1,h2,h3 { font-family:'Noto Serif','DejaVu Serif',serif; margin:0; }
    @page {
      size: A4; margin: 18mm 14mm 16mm 14mm;
      @top-right { content: "${headerStr}"; font-size:8pt; color:#94a3b8; }
      @bottom-left { content: "${footerStr}"; font-size:8pt; color:#94a3b8; }
      @bottom-right { content: "${cssStr(L('Хуудас', 'Page'))} " counter(page) " / " counter(pages); font-size:8pt; color:#94a3b8; }
    }
    @page :first { @top-right { content: none; } }
    .sec { margin: 0 0 14px; }
    .sec.avoid { break-inside: avoid; }
    .sec-h { border-bottom:2px solid #0f243e; padding-bottom:3px; margin-bottom:8px; display:flex; align-items:baseline; gap:8px; }
    .sec-h h2 { font-size:13pt; color:#0f243e; }
    .sec-h span { font-size:8.5pt; color:#94a3b8; font-style:italic; }
    h3.sub { font-size:10.5pt; margin:10px 0 4px; color:#334155; }
    .muted { color:#94a3b8; font-style:italic; }
    .fine { font-size:8pt; color:#94a3b8; margin:6px 0 0; }
    .prose { white-space:normal; }
    .tbl { width:100%; border-collapse:collapse; font-size:9.5pt; }
    .tbl th, .tbl td { border:1px solid #e2e8f0; padding:4px 7px; text-align:left; vertical-align:top; }
    .tbl thead th { background:#f1f5f9; color:#334155; font-weight:600; }
    .tbl.kv th { width:34%; background:#f8fafc; color:#475569; font-weight:600; }
    .tbl .num { text-align:right; white-space:nowrap; font-variant-numeric:tabular-nums; }
    .barcell { min-width:120px; }
    .bar { display:inline-block; width:78px; height:8px; background:#e2e8f0; border-radius:5px; overflow:hidden; vertical-align:middle; margin-right:6px; }
    .bar-fill { display:block; height:100%; border-radius:5px; }
    .chip { display:inline-block; padding:1px 8px; border-radius:10px; font-size:8.5pt; font-weight:600; white-space:nowrap; }
    /* cover */
    .cover { break-after: page; }
    .cover-img { height:150px; background-size:cover; background-position:center; border-radius:8px; margin-bottom:14px; }
    .cover-top { display:flex; justify-content:space-between; align-items:center; margin-bottom:18px; }
    .cover-logo { height:40px; }
    .wordmark { font-weight:800; color:#0f243e; letter-spacing:1px; font-size:16pt; }
    .cover-kind { font-size:10pt; color:#64748b; text-transform:uppercase; letter-spacing:2px; }
    .cover h1 { font-size:22pt; color:#0f243e; line-height:1.25; margin-bottom:6px; }
    .cover-dno { color:#64748b; margin-bottom:18px; }
    .cover-grid { display:flex; gap:26px; align-items:center; margin-top:10px; }
    .cover-ring { text-align:center; }
    .cover-ring-lbl { font-size:9pt; color:#64748b; margin-top:4px; }
    .cover-meta { flex:1; display:grid; grid-template-columns:1fr 1fr; gap:8px 18px; }
    .cover-meta > div { border-bottom:1px solid #eef2f7; padding-bottom:4px; }
    .cover-meta span { display:block; font-size:8pt; color:#94a3b8; text-transform:uppercase; letter-spacing:.5px; }
    .cover-meta b { font-size:11pt; color:#0f172a; }
    .cover-rag { grid-column:1 / -1; }
    /* exec dashboard */
    .chips4 { display:flex; gap:10px; margin-bottom:10px; }
    .kpi { flex:1; border:1px solid #e2e8f0; border-radius:8px; padding:8px 10px; text-align:center; background:#f8fafc; }
    .kpi b { display:block; font-size:15pt; color:#0f243e; }
    .kpi span { font-size:8pt; color:#64748b; }
    .dash2 { display:flex; gap:18px; align-items:center; }
    .dash-ring { flex:0 0 auto; }
    .dash-curve { flex:1; min-width:0; }
    .legend { display:flex; gap:14px; font-size:8.5pt; color:#64748b; margin-top:2px; }
    .legend i { display:inline-block; width:10px; height:10px; border-radius:2px; margin-right:4px; vertical-align:middle; }
    .callout { margin:8px 0; padding:7px 10px; border-radius:6px; font-size:9.5pt; background:#f1f5f9; border-left:4px solid #94a3b8; }
    .callout.rag-green { border-color:#16a34a; background:#f0fdf4; }
    .callout.rag-amber { border-color:#d97706; background:#fffbeb; }
    .callout.rag-red { border-color:#dc2626; background:#fef2f2; }
    /* heat */
    .heat td, .heat th { text-align:center; }
    .heatcell { font-size:8.5pt; font-weight:600; }
    /* register */
    .reg-block { margin-bottom:10px; break-inside:avoid; }
    .reg-head { display:flex; align-items:center; gap:8px; background:#0f243e; color:#fff; padding:4px 9px; border-radius:5px 5px 0 0; }
    .reg-head .num { margin-left:auto; }
    .reg-head .tag { background:rgba(255,255,255,.18); padding:0 6px; border-radius:8px; font-size:8pt; }
    /* misc */
    ul.plan { margin:4px 0; padding-left:20px; }
    ul.plan li { margin-bottom:4px; }
    .sign { display:flex; gap:40px; margin-top:24px; }
    .sign-box { flex:1; text-align:center; }
    .sign-line { border-top:1px solid #475569; margin-bottom:5px; height:34px; }
    .sign-box span { font-size:9pt; color:#475569; }
  `;

  return `<!doctype html>
<html lang="${en ? 'en' : 'mn'}">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${esc(title)}</title>
${webHead}
<style>${css}</style>
</head>
<body>
${cover}
${passportSec}
${execSec}
${dashSec}
${discSec}
${heatSec}
${registerSec}
${scheduleSec}
${recentSec}
${risksSec}
${nextSec}
${signSec}
${pagedScript}
</body>
</html>`;
}
