/**
 * ЗОХИОГЧИЙН ХЯНАЛТЫН НЭГТГЭЛ ТАЙЛАН — Word (.docx) + бичвэрийн шалгалт.
 *
 *   node scripts/check-asr-summary.mjs        (frontend/ хавтаснаас)
 *
 * `features/asr/summary/buildAsrSummaryDocx.ts` нь загваргүй, гараар угсарсан
 * OOXML — Word нь XML-ийн тэнцвэр алдагдсан, эсвэл хүснэгтийн мөрийн нүднүүдийн
 * өргөн (gridSpan тооцсон) `tblGrid`-тэй таарахгүй файлыг «эвдэрсэн» гэж нээхгүй.
 * Ийм регресс нь кодын түвшинд чимээгүй (tsc ногоон) тул энд барина.  Мөн
 * `summaryContent.ts`-ийн агуулгын дүрэм (хоосон хэсэг орохгүй, оффис уулзалтын
 * хэсэг, улаан дэвтэр зөвхөн талбайд).
 */
import { registerHooks } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, '..', 'src');

function tsPath(base) {
  for (const cand of [`${base}.ts`, `${base}.tsx`, join(base, 'index.ts')]) {
    if (existsSync(cand)) return cand;
  }
  return null;
}

// `shared/config/brand.ts` нь Vite-ийн `import.meta.env`-ийг уншдаг — Node дээр
// хоосон stub (`check-passport-doc.mjs`-ийн ижил арга).
const BRAND_STUB = 'mgl-stub:brand';

registerHooks({
  load(url, context, nextLoad) {
    if (url === BRAND_STUB) {
      return {
        format: 'module',
        shortCircuit: true,
        source: "export const brand = () => ({ name: 'MGL', nameShort: 'MGL', projectCodePrefix: 'MGL', timezone: 'Asia/Ulaanbaatar' });",
      };
    }
    return nextLoad(url, context);
  },
  resolve(specifier, context, nextResolve) {
    if (specifier === '@/shared/config/brand') return { url: BRAND_STUB, shortCircuit: true };
    if (specifier.startsWith('@/')) {
      const p = tsPath(join(SRC, specifier.slice(2)));
      if (p) return nextResolve(pathToFileURL(p).href, context);
    }
    if (/^\.{1,2}\//.test(specifier) && !/\.[cm]?[jt]sx?$/.test(specifier)) {
      const base = context.parentURL ? dirname(fileURLToPath(context.parentURL)) : SRC;
      const p = tsPath(join(base, specifier));
      if (p) return nextResolve(pathToFileURL(p).href, context);
    }
    return nextResolve(specifier, context);
  },
});

const D = await import(pathToFileURL(join(SRC, 'features', 'asr', 'summary', 'buildAsrSummaryDocx.ts')).href);
const C = await import(pathToFileURL(join(SRC, 'features', 'asr', 'summary', 'summaryContent.ts')).href);
const P = await import(pathToFileURL(join(SRC, 'features', 'asr', 'summary', 'summaryTypes.ts')).href);

let passed = 0;
function check(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    console.error(`  ✗ ${name}`);
    throw err;
  }
}

/** Түлхүүрээ буцаадаг t — бичвэр биш бүтэц шалгана. */
const t = (k, params) => (params ? `${k}${JSON.stringify(params)}` : k);

function entry(over) {
  return {
    id: 1,
    project_id: 1,
    project_name: 'MGL-251006_EVERGREEN',
    shifr: 'MEC-25/21',
    contract_no: null,
    doc_no: 'DASR-BB-001',
    report_date: '2026-09-03',
    report_type: 'site',
    meeting_platform: null,
    meeting_place: null,
    meeting_start: null,
    meeting_end: null,
    meeting_parties: null,
    meeting_purpose: null,
    status: 'approved',
    description: 'Суурийн арматур',
    work_report: null,
    site_tasks: 'Арматурын холбоос <шалгах> & засах',
    defects: 'Бетон\nхэвний ан цав',
    red_book_status: 'signed',
    author_id: 10,
    author_name: 'Батболд Билгүүн',
    companions: ['Дорж Ганбат'],
    teams: [{ code: 'BB', name: 'Барилга', work_note: null }],
    resolutions: [],
    reviewer_name: 'Захирал Нэг',
    reviewed_at: '2026-09-04',
    photo_count: 3,
    ...over,
  };
}

function summary(over = {}) {
  const entries = over.entries ?? [
    entry({}),
    entry({
      id: 2,
      project_id: 2,
      project_name: 'MGL-250101_TENNIS',
      report_date: '2026-09-10',
      report_type: 'office',
      status: 'submitted',
      description: null,
      site_tasks: null,
      defects: null,
      meeting_place: 'Оффис',
      meeting_start: '13:00',
      meeting_end: '15:30',
      meeting_purpose: 'Зургийн өөрчлөлт',
      meeting_parties: 'Захиалагч',
      work_report: 'Агуулга\u0007 (удирдах тэмдэгт)',
      companions: [],
      teams: [
        { code: 'BA', name: 'Архитектур', work_note: 'тэмдэглэл' },
        { code: 'BB', name: 'Барилга', work_note: null },
      ],
      resolutions: [
        { prev_doc_no: 'DASR-BA-001', prev_report_date: '2026-08-20', issue_text: 'Ан цав', resolution_text: 'Зассан' },
      ],
    }),
  ];
  return {
    filters: { from: '2026-09-01', to: '2026-09-30', projectId: null, reportType: null, status: 'counted' },
    period: { from: '2026-09-01', to: '2026-09-30' },
    totals: {
      reports: entries.length,
      site_visits: 1,
      projects: 2,
      people: 2,
      by_type: { site: 1, office: 1, drawing_change: 0, online: 0 },
      by_status: { submitted: 1, approved: 1 },
      red_book: { missing: 0, absent: 0, signed: 1, verified: 0 },
      with_defects: 1,
      with_tasks: 1,
      photos: 3,
    },
    by_project: [
      { project_id: 2, name: 'MGL-250101_TENNIS', shifr: null, contract_no: null, reports: 1, site_visits: 0, by_type: { site: 0, office: 1, drawing_change: 0, online: 0 }, approved: 0, with_defects: 0, people: 1, first_date: '2026-09-10', last_date: '2026-09-10' },
      { project_id: 1, name: 'MGL-251006_EVERGREEN', shifr: 'MEC-25/21', contract_no: null, reports: 1, site_visits: 1, by_type: { site: 1, office: 0, drawing_change: 0, online: 0 }, approved: 1, with_defects: 1, people: 2, first_date: '2026-09-03', last_date: '2026-09-03' },
    ],
    by_team: [{ code: 'BB', name: 'Барилга', reports: 2, site_visits: 1 }],
    by_person: [{ user_id: 10, name: 'Батболд Билгүүн', reports: 2, site_visits: 1, authored: 2 }],
    entries,
    truncated: false,
    project: null,
    file_stem: 'DASR_Negtgel_2026-09-01_2026-09-30',
    generated_at: '2026-10-01T03:00:00.000Z',
    generated_by: 1,
    ...over,
  };
}

/** Энгийн XML тэнцвэр шалгагч — нээх/хаах таг стек. */
function assertBalanced(raw, name) {
  const xml = raw.replace(/^<\?xml[^>]*\?>/, '');
  const re = /<(\/?)([A-Za-z_][\w:.-]*)((?:\s+[\w:.-]+="[^"]*")*)\s*(\/?)>/g;
  const stack = [];
  let m;
  let last = 0;
  while ((m = re.exec(xml))) {
    const between = xml.slice(last, m.index);
    assert.ok(!/[<>]/.test(between), `${name}: escape хийгдээгүй < эсвэл > «${between.slice(0, 40)}»`);
    last = re.lastIndex;
    const [, close, tag, , self] = m;
    if (self) continue;
    if (close) {
      const top = stack.pop();
      assert.equal(top, tag, `${name}: </${tag}> ↔ <${top}>`);
    } else stack.push(tag);
  }
  assert.deepEqual(stack, [], `${name}: хаагдаагүй таг ${stack.join(',')}`);
}

/** Хүснэгт бүрийн мөр бүрийн нүдний өргөн (gridSpan) = tblGrid-ийн багана. */
function assertTables(xml) {
  const tables = xml.split('<w:tbl>').slice(1).map((s) => s.split('</w:tbl>')[0]);
  assert.ok(tables.length >= 4, `хүснэгт ${tables.length}`);
  for (const tbl of tables) {
    const grid = [...tbl.matchAll(/<w:gridCol w:w="(\d+)"\/>/g)].map((m) => Number(m[1]));
    const total = grid.reduce((a, b) => a + b, 0);
    assert.ok(total <= 10546, `хүснэгтийн өргөн ${total} > 10546`);
    const rows = tbl.split('<w:tr>').slice(1);
    for (const r of rows) {
      const cells = [...r.matchAll(/<w:tc><w:tcPr><w:tcW w:w="(\d+)" w:type="dxa"\/>(?:<w:gridSpan w:val="(\d+)"\/>)?/g)];
      const span = cells.reduce((a, m) => a + Number(m[2] ?? 1), 0);
      assert.equal(span, grid.length, 'мөрийн gridSpan нийлбэр ≠ баганын тоо');
      const width = cells.reduce((a, m) => a + Number(m[1]), 0);
      assert.equal(width, total, 'мөрийн нүдний өргөн ≠ хүснэгтийн өргөн');
      // Нүд бүр ядаж нэг догол мөртэй байх ёстой.
      for (const c of r.split('<w:tc>').slice(1)) assert.ok(/<w:p[ />]/.test(c), 'хоосон нүд (w:p байхгүй)');
    }
  }
}

console.log('asr summary — Word');

check('бүх хэсэг XML-ийн тэнцвэртэй, удирдах тэмдэгтгүй', () => {
  const parts = D.asrSummaryDocxParts(summary(), t);
  assert.deepEqual(Object.keys(parts).sort(), [
    '[Content_Types].xml',
    '_rels/.rels',
    'word/_rels/document.xml.rels',
    'word/document.xml',
    'word/footer1.xml',
    'word/styles.xml',
  ]);
  for (const [name, xml] of Object.entries(parts)) {
    assertBalanced(xml, name);
    assert.ok(!/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(xml), `${name}: удирдах тэмдэгт`);
  }
  const doc = parts['word/document.xml'];
  assert.ok(doc.includes('&lt;шалгах&gt; &amp; засах'), 'тусгай тэмдэгт escape');
  assert.ok(doc.includes('<w:br/>'), 'мөр таслалт → w:br');
  assert.ok(doc.includes('r:id="rId2"'), 'хөлийн холбоос');
});

check('хүснэгтүүд: gridSpan + өргөн нийлбэр таарна (олон төсөл)', () => {
  assertTables(D.asrSummaryDocxParts(summary(), t)['word/document.xml']);
});

check('хүснэгтүүд: нэг төслийн нэгтгэл (төслийн багана, «Төслөөр» хэсэггүй)', () => {
  const s = summary({
    filters: { from: '2026-09-01', to: '2026-09-30', projectId: 1, reportType: null, status: 'counted' },
    project: { id: 1, name: 'MGL-251006_EVERGREEN' },
  });
  const doc = D.asrSummaryDocxParts(s, t)['word/document.xml'];
  assertTables(doc);
  assert.ok(!doc.includes('asr.summary.secProjects'));
});

check('хоосон нэгтгэл — хүснэгтгүй ч хүчинтэй баримт', () => {
  const s = summary({ entries: [], by_project: [], by_team: [], by_person: [] });
  const doc = D.asrSummaryDocxParts(s, t)['word/document.xml'];
  assertBalanced(doc, 'document.xml');
  assert.ok(doc.includes('asr.summary.empty'));
});

console.log('asr summary — агуулга');

check('талбайн хяналт: тайлбар, үүрэг даалгавар, алдаа; хоосон хэсэг орохгүй', () => {
  const blocks = C.entryBlocks(entry({}), t).map((b) => b.label);
  assert.deepEqual(blocks, [
    'asr.summary.field.description',
    'asr.summary.field.siteTasks',
    'asr.summary.field.defects',
  ]);
});

check('оффис уулзалт: зорилго, оролцогч тал, агуулга эхэнд; багийн тэмдэглэл, шийдэл', () => {
  const e = summary().entries[1];
  const labels = C.entryBlocks(e, t).map((b) => b.label);
  assert.deepEqual(labels, [
    'asr.summary.field.meetingPurpose',
    'asr.summary.field.meetingParties',
    'asr.summary.field.meetingContent',
    'asr.summary.field.teamNotes',
    'asr.summary.field.resolutions',
  ]);
  const res = C.entryBlocks(e, t).at(-1).text;
  assert.equal(res, 'DASR-BA-001 · 2026.08.20: Ан цав → Зассан');
  const meta = C.entryMeta(e, t);
  assert.ok(meta.includes('asr.summary.field.meetingPlace: Оффис'));
  assert.ok(meta.includes('asr.summary.field.meetingTime: 13:00–15:30'));
  // Батлагдаагүй — баталсан хүн гарахгүй.
  assert.ok(!meta.some((m) => m.startsWith('asr.summary.col.reviewer')));
});

check('улаан дэвтэр зөвхөн талбайн хяналтад; хүмүүс зохиогч эхэнд', () => {
  assert.equal(C.redBookLabel({ report_type: 'office', red_book_status: 'missing' }, t), '—');
  assert.equal(C.redBookLabel({ report_type: 'site', red_book_status: 'missing' }, t), 'asr.summary.redBookMissing');
  assert.equal(C.peopleOf(entry({})).length, 2);
});

check('URL ↔ шүүлт', () => {
  const p = P.summaryParamsFromSearch(new URLSearchParams('from=2026-09-30&to=2026-09-01&project_id=7&report_type=office&status=approved'));
  assert.deepEqual(p, { from: '2026-09-01', to: '2026-09-30', projectId: 7, reportType: 'office', status: 'approved' });
  assert.equal(P.summaryQueryString(p), 'from=2026-09-01&to=2026-09-30&project_id=7&report_type=office&status=approved');
  const bad = P.summaryParamsFromSearch(new URLSearchParams('from=x&project_id=-1&report_type=zzz&status=draft'));
  assert.deepEqual(bad, { from: null, to: null, projectId: null, reportType: null, status: 'counted' });
  assert.equal(P.summaryQueryString(bad), '');
});

check('өгөгдмөл хугацаа: сарын эхний 10 хоногт өмнөх сар', () => {
  assert.deepEqual(P.defaultSummaryRange('2026-10-01'), { from: '2026-09-01', to: '2026-09-30' });
  assert.deepEqual(P.defaultSummaryRange('2026-10-10'), { from: '2026-09-01', to: '2026-09-30' });
  assert.deepEqual(P.defaultSummaryRange('2026-10-11'), { from: '2026-10-01', to: '2026-10-31' });
  assert.deepEqual(P.defaultSummaryRange('2027-01-05'), { from: '2026-12-01', to: '2026-12-31' });
});

console.log(`\n${passed} шалгалт амжилттай.`);
