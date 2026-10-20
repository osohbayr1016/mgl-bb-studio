/**
 * ЗХ-ийн нэгтгэл тайлан — Word (.docx), хөтөч дээр `fflate`-ээр угсарна.
 *
 * Бүтэц нь хэвлэх хуудастай ИЖИЛ (`AsrSummaryDocument.tsx`): гарчиг, шүүлтийн
 * мета, хураангуй тоо, төрлөөр, төслөөр, багаар, хүнээр, тайлан бүр НЭГ мөр
 * + доор нь гол агуулга (бүтэн өргөнтэй нэгтгэсэн нүд).  Бичвэр, шошго бүгд
 * `summaryContent.ts`-ээс.
 *
 * ⚠️ Загвар файлгүй, хамгийн бага OOXML (document + styles + footer + rels):
 *    ЗХ-ийн нэг тайлангийн Word (`buildAsrDocx.ts`) нь эзний загварыг
 *    (`asr-template.docx`) бөглөдөг бол нэгтгэлд тийм загвар байхгүй.
 *    Хүснэгт бүрийн `gridCol`-ын нийлбэр = мөр бүрийн нүдний өргөн (gridSpan
 *    тооцсон) — эс бөгөөс Word «эвдэрсэн» гэнэ.
 */
import { formatDisplayName } from '@/shared/lib/formatting';
import { formatDateTime } from '@/shared/lib/time';
import {
  dotDate,
  entryBlocks,
  entryMeta,
  isMultiProject,
  kpiRows,
  metaRows,
  peopleOf,
  projectLabel,
  redBookLabel,
  statusLabel,
  teamsOf,
  typeLabel,
  typeRows,
  type T,
} from './summaryContent';
import type { AsrSummaryResponse } from './summaryTypes';

const NAVY = '0F243E';
const GREY = '555555';
const LINE = 'C5CCD4';
const ROW_FILL = 'EEF2F6';
/** A4 өргөн 11906 twip − 2 × 680 (12 мм) зай. */
const TEXT_W = 10546;
const MARGIN = 680;

/* ------------------------------------------------------------------ */
/*  OOXML-ийн жижиг туслахууд                                          */
/* ------------------------------------------------------------------ */

// XML 1.0-д хориотой удирдах тэмдэгт (tab, мөр таслалтаас бусад).
// eslint-disable-next-line no-control-regex
const BAD_XML = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g;

function esc(s: string): string {
  return s
    .replace(BAD_XML, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

interface RunOpts {
  bold?: boolean;
  italic?: boolean;
  color?: string;
  /** pt */
  size?: number;
}

/** Нэг run — мөр таслалт (`\n`) нь `<w:br/>`. */
function run(text: string, o: RunOpts = {}): string {
  const rPr = [
    o.bold ? '<w:b/>' : '',
    o.italic ? '<w:i/>' : '',
    o.color ? `<w:color w:val="${o.color}"/>` : '',
    o.size ? `<w:sz w:val="${Math.round(o.size * 2)}"/><w:szCs w:val="${Math.round(o.size * 2)}"/>` : '',
  ].join('');
  const parts = text.replace(/\r\n?/g, '\n').split('\n');
  const body = parts
    .map((p, i) => `${i > 0 ? '<w:br/>' : ''}<w:t xml:space="preserve">${esc(p)}</w:t>`)
    .join('');
  return `<w:r>${rPr ? `<w:rPr>${rPr}</w:rPr>` : ''}${body}</w:r>`;
}

interface ParaOpts {
  align?: 'left' | 'center' | 'right';
  /** twip */
  after?: number;
  before?: number;
  keepNext?: boolean;
  /** Доод хүрээ (гарчгийн зураас). */
  bottomRule?: string;
}

function para(runs: string | string[], o: ParaOpts = {}): string {
  const pPr = [
    o.keepNext ? '<w:keepNext/>' : '',
    o.bottomRule
      ? `<w:pBdr><w:bottom w:val="single" w:sz="8" w:space="2" w:color="${o.bottomRule}"/></w:pBdr>`
      : '',
    `<w:spacing w:before="${o.before ?? 0}" w:after="${o.after ?? 0}"/>`,
    o.align && o.align !== 'left' ? `<w:jc w:val="${o.align}"/>` : '',
  ].join('');
  return `<w:p><w:pPr>${pPr}</w:pPr>${Array.isArray(runs) ? runs.join('') : runs}</w:p>`;
}

interface CellOpts {
  width: number;
  span?: number;
  fill?: string;
  align?: 'left' | 'center' | 'right';
}

/** Нүд — `content` нь бэлэн `<w:p>`-ууд (хоосон бол хоосон догол мөр). */
function cell(content: string, o: CellOpts): string {
  const tcPr = [
    `<w:tcW w:w="${o.width}" w:type="dxa"/>`,
    o.span && o.span > 1 ? `<w:gridSpan w:val="${o.span}"/>` : '',
    o.fill ? `<w:shd w:val="clear" w:color="auto" w:fill="${o.fill}"/>` : '',
  ].join('');
  return `<w:tc><w:tcPr>${tcPr}</w:tcPr>${content || '<w:p/>'}</w:tc>`;
}

function textCell(text: string, o: CellOpts & RunOpts): string {
  return cell(para(run(text, o), { align: o.align }), o);
}

function row(cells: string[], o: { header?: boolean; cantSplit?: boolean } = {}): string {
  const trPr = [o.header ? '<w:tblHeader/>' : '', o.cantSplit ? '<w:cantSplit/>' : ''].join('');
  return `<w:tr>${trPr ? `<w:trPr>${trPr}</w:trPr>` : ''}${cells.join('')}</w:tr>`;
}

function table(widths: number[], rows: string[]): string {
  const total = widths.reduce((a, b) => a + b, 0);
  const b = (side: string) => `<w:${side} w:val="single" w:sz="4" w:space="0" w:color="${LINE}"/>`;
  return (
    `<w:tbl><w:tblPr><w:tblW w:w="${total}" w:type="dxa"/>` +
    `<w:tblBorders>${['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map(b).join('')}</w:tblBorders>` +
    `<w:tblLayout w:type="fixed"/>` +
    `<w:tblCellMar><w:top w:w="40" w:type="dxa"/><w:left w:w="80" w:type="dxa"/>` +
    `<w:bottom w:w="40" w:type="dxa"/><w:right w:w="80" w:type="dxa"/></w:tblCellMar>` +
    `</w:tblPr><w:tblGrid>${widths.map((w) => `<w:gridCol w:w="${w}"/>`).join('')}</w:tblGrid>` +
    rows.join('') +
    '</w:tbl>'
  );
}

/** Толгой мөр — хар-хөх дүүргэлт, цагаан тод (хуудас бүрт давтагдана). */
function headRow(labels: string[], widths: number[], rightCols: number[] = []): string {
  return row(
    labels.map((l, i) =>
      textCell(l, {
        width: widths[i] ?? 0,
        fill: NAVY,
        color: 'FFFFFF',
        bold: true,
        size: 8,
        align: rightCols.includes(i) ? 'right' : 'left',
      }),
    ),
    { header: true, cantSplit: true },
  );
}

const heading = (text: string) =>
  para(run(text, { bold: true, color: NAVY, size: 11 }), { before: 240, after: 100, keepNext: true, bottomRule: LINE });

/** Хүснэгтийн дараах зай (хоёр хүснэгт наалдвал Word нэгтгэдэг). */
const gap = () => para('', { after: 60 });

/* ------------------------------------------------------------------ */
/*  Баримт                                                             */
/* ------------------------------------------------------------------ */

function buildBody(d: AsrSummaryResponse, t: T): string {
  const out: string[] = [];
  const multi = isMultiProject(d);

  out.push(
    para(run(t('asr.summary.docTitle'), { bold: true, color: NAVY, size: 15 }), { after: 40 }),
    para(
      run(`${t('asr.summary.docSubtitle')} · ${t('asr.summary.generated', { date: formatDateTime(d.generated_at) })}`, {
        italic: true,
        color: GREY,
        size: 8.5,
      }),
      { after: 120, bottomRule: NAVY },
    ),
  );

  const metaW = [1800, TEXT_W - 1800];
  out.push(
    table(
      metaW,
      metaRows(d, t).map(([k, v]) =>
        row([
          textCell(k, { width: metaW[0]!, fill: NAVY, color: 'FFFFFF', bold: true, size: 8 }),
          textCell(v, { width: metaW[1]! }),
        ]),
      ),
    ),
    gap(),
  );

  if (d.truncated) {
    out.push(para(run(t('asr.summary.truncated', { n: d.entries.length }), { bold: true, color: '92400E' }), { after: 120 }));
  }

  if (d.entries.length === 0) {
    out.push(para(run(t('asr.summary.empty'), { italic: true, color: GREY }), { before: 240, align: 'center' }));
    return out.join('');
  }

  // 1. Хураангуй — 4 × 2 нүд (том тоо + шошго).
  out.push(heading(t('asr.summary.secOverview')));
  const kpi = kpiRows(d, t);
  const kw = [2636, 2636, 2637, 2637];
  const kpiCell = ([l, v]: [string, number], i: number) =>
    cell(
      para(run(String(v), { bold: true, color: NAVY, size: 15 })) + para(run(l, { color: GREY, size: 7.5 })),
      { width: kw[i] ?? 2636 },
    );
  out.push(
    table(kw, [row(kpi.slice(0, 4).map(kpiCell), { cantSplit: true }), row(kpi.slice(4, 8).map(kpiCell), { cantSplit: true })]),
    para(
      typeRows(d, t).flatMap(([l, v], i) => [
        ...(i > 0 ? [run(' · ', { color: GREY })] : []),
        run(`${l} `),
        run(String(v), { bold: true, color: NAVY }),
      ]),
      { before: 80, after: 60 },
    ),
  );

  // 2. Төслөөр (бүх төслийн нэгтгэлд).
  if (multi && d.by_project.length > 0) {
    out.push(heading(t('asr.summary.secProjects')));
    const w = [400, 2900, 1400, 800, 800, 1150, 1000, 700, 1396];
    out.push(
      table(w, [
        headRow(
          [
            '№',
            t('asr.summary.col.project'),
            t('asr.summary.col.shifr'),
            t('asr.summary.col.reports'),
            t('asr.summary.col.siteVisits'),
            t('asr.summary.col.approved'),
            t('asr.summary.col.defects'),
            t('asr.summary.col.peopleCount'),
            t('asr.summary.col.lastDate'),
          ],
          w,
          [0, 3, 4, 5, 6, 7],
        ),
        ...d.by_project.map((p, i) =>
          row(
            [
              String(i + 1),
              projectLabel(p.name),
              p.shifr ?? '',
              String(p.reports),
              String(p.site_visits),
              String(p.approved),
              String(p.with_defects),
              String(p.people),
              dotDate(p.last_date),
            ].map((v, j) => textCell(v, { width: w[j]!, align: [0, 3, 4, 5, 6, 7].includes(j) ? 'right' : 'left' })),
            { cantSplit: true },
          ),
        ),
      ]),
      gap(),
    );
  }

  // Багаар.
  out.push(heading(t('asr.summary.secTeams')));
  const tw = [3500, 1200, 1200];
  out.push(
    table(tw, [
      headRow([t('asr.summary.col.team'), t('asr.summary.col.reports'), t('asr.summary.col.siteVisits')], tw, [1, 2]),
      ...d.by_team.map((x) =>
        row([
          cell(para([run(x.code, { bold: true }), run(x.name ? ` · ${x.name}` : '')]), { width: tw[0]! }),
          textCell(String(x.reports), { width: tw[1]!, align: 'right' }),
          textCell(String(x.site_visits), { width: tw[2]!, align: 'right' }),
        ]),
      ),
    ]),
    gap(),
  );

  // Хүнээр.
  out.push(heading(t('asr.summary.secPeople')));
  const pw = [400, 3500, 1100, 1100, 1300];
  out.push(
    table(pw, [
      headRow(
        ['№', t('asr.summary.col.name'), t('asr.summary.col.reports'), t('asr.summary.col.siteVisits'), t('asr.summary.col.authored')],
        pw,
        [0, 2, 3, 4],
      ),
      ...d.by_person.map((x, i) =>
        row(
          [String(i + 1), formatDisplayName(x.name), String(x.reports), String(x.site_visits), String(x.authored)].map((v, j) =>
            textCell(v, { width: pw[j]!, align: j === 1 ? 'left' : 'right' }),
          ),
        ),
      ),
    ]),
    gap(),
  );

  // 3. Тайлангууд — мөр + агуулга.
  out.push(heading(t('asr.summary.secReports')));
  // Огноо «2026.09.03», дугаар «DASR-TSAH-001» тод бичгээр нэг мөрөнд багтана.
  const rw = multi ? [400, 1150, 1500, 2100, 1200, 650, 2346, 1200] : [450, 1150, 1600, 1600, 900, 3546, 1300];
  const labels = [
    '№',
    t('asr.summary.col.date'),
    t('asr.summary.col.docNo'),
    ...(multi ? [t('asr.summary.col.project')] : []),
    t('asr.summary.col.type'),
    t('asr.summary.col.teams'),
    t('asr.summary.col.people'),
    t('asr.summary.col.status'),
  ];
  const restW = rw.slice(1).reduce((a, b) => a + b, 0);
  const rows: string[] = [headRow(labels, rw, [0])];
  d.entries.forEach((e, i) => {
    const values = [
      String(i + 1),
      dotDate(e.report_date),
      e.doc_no ?? '—',
      ...(multi ? [projectLabel(e.project_name)] : []),
      typeLabel(e, t),
      teamsOf(e) || '—',
      peopleOf(e).join(', ') || '—',
      statusLabel(e.status, t),
    ];
    rows.push(
      row(
        values.map((v, j) =>
          textCell(v, {
            width: rw[j]!,
            fill: ROW_FILL,
            bold: true,
            align: j === 0 ? 'right' : 'left',
            color: j === values.length - 1 ? (e.status === 'approved' ? '166534' : '92400E') : undefined,
          }),
        ),
        { cantSplit: true },
      ),
    );

    const meta = entryMeta(e, t);
    if (e.report_type === 'site') meta.unshift(`${t('asr.summary.col.redBook')}: ${redBookLabel(e, t)}`);
    const blocks = entryBlocks(e, t);
    const paras = [
      ...(meta.length ? [para(run(meta.join(' · '), { color: GREY, size: 8 }), { after: 40 })] : []),
      ...(blocks.length === 0
        ? [para(run(t('asr.summary.noContent'), { italic: true, color: '888888' }))]
        : blocks.map((b) =>
            para([run(`${b.label}: `, { bold: true, italic: true, color: NAVY }), run(b.text)], { after: 40 }),
          )),
    ].join('');
    rows.push(row([cell('', { width: rw[0]! }), cell(paras, { width: restW, span: rw.length - 1 })]));
  });
  out.push(table(rw, rows));

  out.push(para(run(t('asr.summary.countedNote'), { italic: true, color: '666666', size: 7.5 }), { before: 200 }));
  return out.join('');
}

const W_NS =
  'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ' +
  'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';

function documentXml(d: AsrSummaryResponse, t: T): string {
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<w:document ${W_NS}><w:body>${buildBody(d, t)}` +
    `<w:sectPr><w:footerReference w:type="default" r:id="rId2"/>` +
    `<w:pgSz w:w="11906" w:h="16838"/>` +
    `<w:pgMar w:top="${MARGIN}" w:right="${MARGIN}" w:bottom="${MARGIN}" w:left="${MARGIN}" w:header="360" w:footer="360" w:gutter="0"/>` +
    `</w:sectPr></w:body></w:document>`
  );
}

const STYLES_XML =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
  `<w:docDefaults><w:rPrDefault><w:rPr>` +
  `<w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial" w:eastAsia="Arial"/>` +
  `<w:sz w:val="18"/><w:szCs w:val="18"/><w:lang w:val="mn-MN"/>` +
  `</w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="0" w:line="252" w:lineRule="auto"/></w:pPr></w:pPrDefault>` +
  `</w:docDefaults>` +
  `<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>` +
  `<w:style w:type="table" w:default="1" w:styleId="TableNormal"><w:name w:val="Normal Table"/>` +
  `<w:tblPr><w:tblInd w:w="0" w:type="dxa"/><w:tblCellMar><w:top w:w="0" w:type="dxa"/>` +
  `<w:left w:w="108" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/><w:right w:w="108" w:type="dxa"/>` +
  `</w:tblCellMar></w:tblPr></w:style>` +
  `</w:styles>`;

/** Хөл — хуудасны дугаар «3 / 12». */
const FOOTER_XML =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<w:ftr ${W_NS}><w:p><w:pPr><w:jc w:val="center"/></w:pPr>` +
  `<w:r><w:rPr><w:color w:val="888888"/><w:sz w:val="16"/></w:rPr><w:fldChar w:fldCharType="begin"/></w:r>` +
  `<w:r><w:rPr><w:color w:val="888888"/><w:sz w:val="16"/></w:rPr><w:instrText xml:space="preserve"> PAGE </w:instrText></w:r>` +
  `<w:r><w:rPr><w:color w:val="888888"/><w:sz w:val="16"/></w:rPr><w:fldChar w:fldCharType="separate"/></w:r>` +
  `<w:r><w:rPr><w:color w:val="888888"/><w:sz w:val="16"/></w:rPr><w:t>1</w:t></w:r>` +
  `<w:r><w:rPr><w:color w:val="888888"/><w:sz w:val="16"/></w:rPr><w:fldChar w:fldCharType="end"/></w:r>` +
  `<w:r><w:rPr><w:color w:val="888888"/><w:sz w:val="16"/></w:rPr><w:t xml:space="preserve"> / </w:t></w:r>` +
  `<w:r><w:rPr><w:color w:val="888888"/><w:sz w:val="16"/></w:rPr><w:fldChar w:fldCharType="begin"/></w:r>` +
  `<w:r><w:rPr><w:color w:val="888888"/><w:sz w:val="16"/></w:rPr><w:instrText xml:space="preserve"> NUMPAGES </w:instrText></w:r>` +
  `<w:r><w:rPr><w:color w:val="888888"/><w:sz w:val="16"/></w:rPr><w:fldChar w:fldCharType="separate"/></w:r>` +
  `<w:r><w:rPr><w:color w:val="888888"/><w:sz w:val="16"/></w:rPr><w:t>1</w:t></w:r>` +
  `<w:r><w:rPr><w:color w:val="888888"/><w:sz w:val="16"/></w:rPr><w:fldChar w:fldCharType="end"/></w:r>` +
  `</w:p></w:ftr>`;

const CONTENT_TYPES =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
  `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
  `<Default Extension="xml" ContentType="application/xml"/>` +
  `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>` +
  `<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>` +
  `<Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>` +
  `</Types>`;

const ROOT_RELS =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
  `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>` +
  `</Relationships>`;

const DOC_RELS =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
  `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
  `<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/>` +
  `</Relationships>`;

/** OOXML-ийн бүх хэсэг — тестэд (XML-ийн тэнцвэр, gridSpan) шалгахад ил. */
export function asrSummaryDocxParts(d: AsrSummaryResponse, t: T): Record<string, string> {
  return {
    '[Content_Types].xml': CONTENT_TYPES,
    '_rels/.rels': ROOT_RELS,
    'word/document.xml': documentXml(d, t),
    'word/styles.xml': STYLES_XML,
    'word/footer1.xml': FOOTER_XML,
    'word/_rels/document.xml.rels': DOC_RELS,
  };
}

export async function buildAsrSummaryDocx(d: AsrSummaryResponse, t: T): Promise<Blob> {
  const { zipSync, strToU8 } = await import('fflate');
  const parts = asrSummaryDocxParts(d, t);
  const files: Record<string, Uint8Array> = {};
  for (const [k, v] of Object.entries(parts)) files[k] = strToU8(v);
  const zipped = zipSync(files, { level: 6 });
  return new Blob([zipped as BlobPart], {
    type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  });
}
