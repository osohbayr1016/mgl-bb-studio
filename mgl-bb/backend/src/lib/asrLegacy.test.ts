/**
 * `lib/asrLegacy.ts` — хуучин ЗХ файлын нэрийг задлах, бүлэглэх, зорилтот
 * төсөл санал болгох, зөөлөн давхардал.  Нэрний жишээ бүр 2026-09-21-нд
 * прод Drive-ын ledger-ээс (`project_drive_versions`) ШУУД авсан.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (/^\.{1,2}\//.test(specifier) && !/\.[cm]?[jt]s$/.test(specifier)) {
      return nextResolve(`${specifier}.ts`, context);
    }
    return nextResolve(specifier, context);
  },
});

const {
  parseLegacyAsrFileName,
  groupLegacyFiles,
  suggestTargetProject,
  softDuplicateOf,
  normalizeTeamCode,
  legacyDocNo,
  matchLegacyAuthor,
} = await import('./asrLegacy.ts');

/* ---------------- parseLegacyAsrFileName ---------------- */

test('баг + дугаартай стандарт нэр', () => {
  const p = parseLegacyAsrFileName('250710_LUXWOOD_ASR_BB_001.docx');
  assert.equal(p.kind, 'report');
  assert.equal(p.date, '2025-07-10');
  assert.equal(p.projectTag, 'LUXWOOD');
  assert.equal(p.teamCode, 'BB');
  assert.equal(p.seq, 1);
  assert.equal(p.ext, 'docx');
  assert.equal(p.legacyDocNo, 'ASR-BB-001');
});

test('PDF, дугаар 005', () => {
  const p = parseLegacyAsrFileName('260519_EVGR_ASR_BB_005.pdf');
  assert.equal(p.kind, 'report');
  assert.equal(p.date, '2026-05-19');
  assert.equal(p.teamCode, 'BB');
  assert.equal(p.seq, 5);
  assert.equal(p.ext, 'pdf');
  assert.equal(p.legacyDocNo, 'ASR-BB-005');
});

test('дугааргүй, кирилл нэртэй төсөл', () => {
  const p = parseLegacyAsrFileName('260428_ТЕННИСНИЙ ОРДОН_ASR_BB.docx');
  assert.equal(p.kind, 'report');
  assert.equal(p.date, '2026-04-28');
  assert.equal(p.projectTag, 'ТЕННИСНИЙ ОРДОН');
  assert.equal(p.teamCode, 'BB');
  assert.equal(p.seq, null);
  assert.equal(p.legacyDocNo, 'ASR-BB');
});

test('баггүй, дугаартай', () => {
  const p = parseLegacyAsrFileName('260429_LUXWOOD_ASR_001.pdf');
  assert.equal(p.kind, 'report');
  assert.equal(p.teamCode, null);
  assert.equal(p.seq, 1);
  assert.equal(p.legacyDocNo, 'ASR-001');
});

test('шифр-тэй нэр (зураастай)', () => {
  const p = parseLegacyAsrFileName('260911_MEC-23-09_ASR_001.docx');
  assert.equal(p.kind, 'report');
  assert.equal(p.projectTag, 'MEC-23-09');
  assert.equal(p.date, '2026-09-11');
  assert.equal(p.seq, 1);
});

test('загварын «PROJECT ID» нэрийг солиогүй ч огноотой бол тайлан', () => {
  const p = parseLegacyAsrFileName('250910_PROJECT ID_ASR_TSBU_002.docx');
  assert.equal(p.kind, 'report');
  assert.equal(p.projectTag, 'PROJECT ID');
  assert.equal(p.teamCode, 'TSBU');
  assert.equal(p.seq, 2);
});

test('TSAH / HAS / HD / AU кодууд', () => {
  assert.equal(parseLegacyAsrFileName('260402_INDPRK_ASR_TSAH_001.docx').teamCode, 'TSAH');
  assert.equal(parseLegacyAsrFileName('260402_INDPRK_ASR_HAS_001.docx').teamCode, 'HAS');
  assert.equal(parseLegacyAsrFileName('260519_EVGR_ASR_HD_001.pdf').teamCode, 'HD');
  assert.equal(parseLegacyAsrFileName('YYMMDD_TOYOTA SERVICE_ASR_AU_001.docx').kind, 'template');
});

test('Word-ийн «(1)» хуулбарын залгавар', () => {
  const p = parseLegacyAsrFileName('260519_EVGR_ASR_BA_001 (1).pdf');
  assert.equal(p.kind, 'report');
  assert.equal(p.teamCode, 'BA');
  assert.equal(p.seq, 1);
});

test('хоосон загвар ба түгжээний файл нэр дэвшигч БИШ', () => {
  assert.equal(parseLegacyAsrFileName('YYMMDD_PROJECT ID_ASR_BA_001.docx').kind, 'template');
  assert.equal(parseLegacyAsrFileName('YYMMDD_PROJECT ID_ASR_BA_001 - Copy.docx').kind, 'template');
  assert.equal(parseLegacyAsrFileName('~$0910_PROJECT ID_ASR_TSBU_001.docx').kind, 'lock');
  assert.equal(parseLegacyAsrFileName('~$MMDD_PROJECT ID_ASR_TSAH_001.docx').kind, 'lock');
});

test('ASR/хяналт үгтэй ч огноо/бүтэцгүй → танигдаагүй (гараар)', () => {
  assert.equal(parseLegacyAsrFileName('ASR-001 (1).pdf').kind, 'unrecognized');
  assert.equal(
    parseLegacyAsrFileName(
      '260430_TOYOTA_SERVICE CENTER_Зохиогчийн хяналтын 2.шатны санхүүжилт хүсэх.pdf',
    ).kind,
    'unrecognized',
  );
  assert.equal(
    parseLegacyAsrFileName('220218_EVGR_Мэргэжлийн хяналтын дүгнэлт А6 А7 А8.pdf').kind,
    'unrecognized',
  );
});

test('хамааралгүй файл', () => {
  assert.equal(parseLegacyAsrFileName('Гэрээ 2026.pdf').kind, 'none');
  assert.equal(parseLegacyAsrFileName('260519_EVGR_BA_001.dwg').kind, 'none');
});

test('буруу огноо → танигдаагүй', () => {
  assert.equal(parseLegacyAsrFileName('261340_EVGR_ASR_BB_001.pdf').kind, 'unrecognized');
  assert.equal(parseLegacyAsrFileName('260231_EVGR_ASR_BB_001.pdf').kind, 'unrecognized');
});

test('танигдаагүй үсгэн код баг биш — тагт үлдэнэ', () => {
  const p = parseLegacyAsrFileName('260519_EVGR_ASR_FINAL_001.pdf');
  assert.equal(p.teamCode, null);
  assert.equal(p.projectTag, 'EVGR FINAL');
  assert.equal(p.seq, 1);
});

test('normalizeTeamCode: кирилл, жижиг үсэг', () => {
  assert.equal(normalizeTeamCode('цбу'), 'TSBU');
  assert.equal(normalizeTeamCode('БА'), 'BA');
  assert.equal(normalizeTeamCode('AУ'), 'AU');
  assert.equal(normalizeTeamCode('ХТ'), null);
  assert.equal(normalizeTeamCode(''), null);
});

test('legacyDocNo хэлбэрүүд', () => {
  assert.equal(legacyDocNo('BB', 5), 'ASR-BB-005');
  assert.equal(legacyDocNo(null, 12), 'ASR-012');
  assert.equal(legacyDocNo('BA', null), 'ASR-BA');
  assert.equal(legacyDocNo(null, null), null);
});

/* ---------------- groupLegacyFiles ---------------- */

function f(name: string, id = name) {
  return { file_id: id, file_name: name, mime_type: null, modified_at: null, parsed: parseLegacyAsrFileName(name) };
}

test('docx + pdf ижил огноо/баг/дугаар → НЭГ нэр дэвшигч, огноогоор эрэмбэлэгдэнэ', () => {
  const groups = groupLegacyFiles([
    f('260519_EVGR_ASR_BB_005.pdf'),
    f('260519_EVGR_ASR_BB_005.docx'),
    f('251028_EVGR_ASR_BB_001.docx'),
    f('YYMMDD_PROJECT ID_ASR_BA_001.docx'),
    f('~$0910_PROJECT ID_ASR_TSBU_001.docx'),
    f('260519_EVGR_ASR_BA_001.pdf'),
  ]);
  assert.deepEqual(
    groups.map((g) => g.key),
    ['2025-10-28|BB|1', '2026-05-19|BA|1', '2026-05-19|BB|5'],
  );
  const bb5 = groups[2]!;
  assert.equal(bb5.files.length, 2);
  assert.equal(bb5.has_docx, true);
  assert.equal(bb5.legacy_doc_no, 'ASR-BB-005');
  assert.equal(groups[1]!.has_docx, false);
});

test('дугааргүй файлууд тус тусдаа үлдэнэ', () => {
  const groups = groupLegacyFiles([f('260505_WISDOM TOWER_ASR_BB.docx'), f('260511_WISDOM TOWER_ASR_BB_002.docx')]);
  assert.equal(groups.length, 2);
});

/* ---------------- suggestTargetProject ---------------- */

test('идэвхтэй ZA түрүүлнэ (EVERGREEN: ZA #37 active, AZ #41 archived+10 тайлан)', () => {
  assert.equal(
    suggestTargetProject([
      { id: 41, category: 'AZ', status: 'archived', report_count: 10 },
      { id: 37, category: 'ZA', status: 'active', report_count: 3 },
    ]),
    37,
  );
});

test('ZA байхгүй бол тайлантай гишүүн, дараа нь ганц гишүүн, эс бөгөөс null', () => {
  assert.equal(
    suggestTargetProject([
      { id: 31, category: 'IZ', status: 'archived', report_count: 0 },
      { id: 36, category: 'AZ', status: 'active', report_count: 2 },
    ]),
    36,
  );
  assert.equal(suggestTargetProject([{ id: 35, category: 'EZ', status: 'archived', report_count: 0 }]), 35);
  assert.equal(
    suggestTargetProject([
      { id: 1, category: 'AZ', status: 'active', report_count: 0 },
      { id: 2, category: 'IZ', status: 'active', report_count: 0 },
    ]),
    null,
  );
  assert.equal(suggestTargetProject([]), null);
});

/* ---------------- softDuplicateOf ---------------- */

const existing = [
  { id: 60, doc_no: 'ASR-004', report_date: '2026-09-14', team_codes: 'HD' },
  { id: 61, doc_no: 'ASR-005', report_date: '2026-09-14', team_codes: 'HAS' },
  { id: 70, doc_no: 'ASR-003', report_date: '2026-09-20', team_codes: null },
];

test('ижил огноо + ижил баг → давхардал; өөр баг → биш', () => {
  assert.equal(softDuplicateOf(existing, '2026-09-14', ['HAS'])?.id, 61);
  assert.equal(softDuplicateOf(existing, '2026-09-14', ['BB']), null);
  assert.equal(softDuplicateOf(existing, '2026-09-15', ['HD']), null);
});

test('баггүй нэр дэвшигч, эсвэл баггүй тайлан → тэр өдрийн дурын тайлан давхардал', () => {
  assert.equal(softDuplicateOf(existing, '2026-09-14', [])?.id, 60);
  assert.equal(softDuplicateOf(existing, '2026-09-20', ['BA'])?.id, 70);
});

/* ---------------- matchLegacyAuthor ---------------- */

const users = [
  { id: 1, full_name: 'Амаржаргал Ананд', username: 'A.Anand' },
  { id: 2, full_name: 'Бат-Өлзий Билгүүн', username: 'B.Bilguun' },
  { id: 3, full_name: 'Уртнаст Ганбат', username: 'U.Ganbat' },
  { id: 4, full_name: 'Бээжин Ганбат', username: 'B.Ganbat' },
];

test('matchLegacyAuthor: овгийн үсэг + нэр, бүтэн нэр, username, урвуу', () => {
  assert.equal(matchLegacyAuthor('Б.Билгүүн', users), 2);
  assert.equal(matchLegacyAuthor('б. билгүүн', users), 2);
  assert.equal(matchLegacyAuthor('Бат-Өлзий Билгүүн', users), 2);
  assert.equal(matchLegacyAuthor('Билгүүн Бат-Өлзий', users), 2);
  assert.equal(matchLegacyAuthor('B.Bilguun', users), 2);
  assert.equal(matchLegacyAuthor('Б.Билгүүн / MGL ENC Захирал', users), 2);
  assert.equal(matchLegacyAuthor('Ананд', users), 1);
});

test('matchLegacyAuthor: хоёрдмол / олдохгүй → null', () => {
  assert.equal(matchLegacyAuthor('Ганбат', users), null); // хоёр Ганбат
  assert.equal(matchLegacyAuthor('У.Ганбат', users), 3);
  assert.equal(matchLegacyAuthor('Б.Ганбат', users), 4);
  assert.equal(matchLegacyAuthor('Д.Дорж', users), null);
  assert.equal(matchLegacyAuthor('', users), null);
  assert.equal(matchLegacyAuthor(null, users), null);
  assert.equal(matchLegacyAuthor('Х.Билгүүн', users), null); // овгийн үсэг зөрнө
});
