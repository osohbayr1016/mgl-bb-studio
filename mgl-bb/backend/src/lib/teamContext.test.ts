/**
 * `lib/teamContext.ts` — §48-ын багийн шатны ЦЭВЭР логикийн тест.
 *
 * Run with:  node --test src/lib/teamContext.test.ts
 *
 * ХАМГИЙН ЧУХАЛ ГУРВАН БҮЛЭГ:
 *   1. ШАТНЫ ДАРААЛАЛ — `project_shares` (0.75) нь `user_primary` (0.85)-аас
 *      ӨМНӨ шалгагдана.  Энэ бол ИТГЭЛЦЛИЙН уралдаан БИШ, v2 §48-ын
 *      «preferred hierarchy».
 *   2. ЗӨРЧЛИЙН ДҮРЭМ — хүнээс гараагүй шат ба `user_primary` зөрвөл
 *      UNCERTAIN, өндөр шат БИШ (R5 / §48-R6-ийн эвдрэл).
 *   3. `BB`-ИЙН ФОЛДЫН ГЭМТЭЛ — `foldText('BB') === 'b'` тул хуудасны
 *      угтвар дангаараа BB-г ХЭЗЭЭ Ч шийдэж чадахгүй.  BB нь эзний
 *      баталсан НАЙМЫН нэг тул энэ нь БОДИТ багийг буруу чиглүүлэх алдаа.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

// ⚠️ Эх код нь өргөтгөлгүй харьцангуй импорт бичдэг; Node-ийн ESM loader
//    түүнийг шийддэггүй (`webPush.test.ts:18-28`-ын ижил заль).  Энгийн
//    статик импорт нь ЗӨВХӨН `node --test` дор унана — `tsc` ногоон хэвээр.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (/^\.{1,2}\//.test(specifier) && !/\.[cm]?[jt]s$/.test(specifier)) {
      return nextResolve(`${specifier}.ts`, context);
    }
    return nextResolve(specifier, context);
  },
});

const T = await import('./teamContext.ts');
const { foldText } = await import('./textFold.ts');
const { codePrefix } = await import('./revitMatch.ts');
const M = await import('./bimEvents.ts');

type TeamSource = (typeof T.TEAM_SOURCES)[number];

/** Шатны анхдагч итгэлцэлтэй нэр дэвшигч. */
function cand(source: TeamSource, code: string, confidence?: number): T.TeamCandidate {
  return {
    team_code: code,
    source,
    confidence: confidence ?? T.TIER_CONFIDENCE[source],
  };
}

/** Эзэн баталсан НАЙМ — ЗӨВХӨН ТЕСТИЙН фикстур, кодод хатуу бичигдээгүй. */
const PACKED_EIGHT: ReadonlySet<string> = new Set([
  'BA',
  'BB',
  'HAS',
  'TSBU',
  'TSAH',
  'HD',
  'AU',
  'IZ',
]);

/* ================================================================== */
/*  1..4  ГАНЦ ШИЙДВЭРЛЭГЧ ШАТ                                         */
/* ================================================================== */

test('1. зөвхөн binding = BA', () => {
  const d = T.decideTeam([cand('binding', 'BA')]);
  assert.equal(d.team_code, 'BA');
  assert.equal(d.team_confidence, 1.0);
  assert.equal(d.team_source, 'binding');
  assert.equal(d.conflict, null);
});

test('2. зөвхөн document = IZ', () => {
  const d = T.decideTeam([cand('document', 'IZ')]);
  assert.equal(d.team_code, 'IZ');
  assert.equal(d.team_confidence, 0.95);
  assert.equal(d.team_source, 'document');
});

test('3. зөвхөн project_shares = HAS', () => {
  const d = T.decideTeam([cand('project_shares', 'HAS')]);
  assert.equal(d.team_code, 'HAS');
  assert.equal(d.team_confidence, 0.75);
  assert.equal(d.team_source, 'project_shares');
});

test('4. зөвхөн user_primary = TSAH', () => {
  const d = T.decideTeam([cand('user_primary', 'TSAH')]);
  assert.equal(d.team_code, 'TSAH');
  assert.equal(d.team_confidence, 0.85);
  assert.equal(d.team_source, 'user_primary');
});

/* ================================================================== */
/*  5..6б  ЗӨРЧЛИЙН ДҮРЭМ                                              */
/* ================================================================== */

test('5. project_shares=HAS + user_primary=BA → UNCERTAIN, conflict [HAS, BA]', () => {
  // ⚠️ `project_shares` нь ХҮНЭЭС ГАРААГҮЙ тул `user_primary`-г ЧИМЭЭГҮЙ
  //    дарж чадахгүй.  MGMT-гүй ганц хуваарьтай төсөл (интерьер-л ажил, ZA
  //    засвар) дээр BA-гийн архитектор HAS-ийн багц авах байв.
  const d = T.decideTeam([cand('project_shares', 'HAS'), cand('user_primary', 'BA')]);
  assert.equal(d.team_code, null);
  assert.equal(d.team_source, 'uncertain');
  assert.equal(d.team_confidence, 0);
  assert.deepEqual(d.conflict, ['HAS', 'BA']);
});

test('5б. project_shares=HAS, user_primary нэр дэвшигчГҮЙ → HAS', () => {
  const d = T.decideTeam([cand('project_shares', 'HAS')]);
  assert.equal(d.team_code, 'HAS');
  assert.equal(d.team_source, 'project_shares');
  assert.equal(d.conflict, null);
});

test('5в. project_shares=HAS + user_primary=HAS (санал нийлэв) → HAS', () => {
  const d = T.decideTeam([cand('project_shares', 'HAS'), cand('user_primary', 'HAS')]);
  assert.equal(d.team_code, 'HAS');
  assert.equal(d.team_source, 'project_shares');
  assert.equal(d.conflict, null);
});

test('6. binding=BA + user_primary=IZ → UNCERTAIN, conflict [BA, IZ]', () => {
  const d = T.decideTeam([cand('binding', 'BA'), cand('user_primary', 'IZ')]);
  assert.equal(d.team_code, null);
  assert.deepEqual(d.conflict, ['BA', 'IZ']);
});

test('6б. document=IZ + user_primary=BA → UNCERTAIN, conflict [IZ, BA]', () => {
  const d = T.decideTeam([cand('document', 'IZ'), cand('user_primary', 'BA')]);
  assert.equal(d.team_code, null);
  assert.deepEqual(d.conflict, ['IZ', 'BA']);
});

test('6в. binding=BA + project_shares=HAS + user_primary=BA → BA (ялагчтай л харьцуулна)', () => {
  // ⚠️ Хамгийн хүчтэй хүнээс гараагүй шат (binding) ба хүн САНАЛ НИЙЛЖ
  //    байна.  Сул шатны (project_shares) зөрүүгээр UNCERTAIN болгох нь
  //    §76-ын ядаргааны төсвийг дэмий зарцуулна.
  const d = T.decideTeam([
    cand('binding', 'BA'),
    cand('project_shares', 'HAS'),
    cand('user_primary', 'BA'),
  ]);
  assert.equal(d.team_code, 'BA');
  assert.equal(d.team_source, 'binding');
  assert.equal(d.conflict, null);
});

/* ================================================================== */
/*  7  ХОЁРДОГЧ ГИШҮҮНЧЛЭЛИЙН ГЭМТЭЛ (§2.6, 42 → 242)                  */
/* ================================================================== */

test('7. хоёрдогч харьяалал нэр дэвшигч ҮҮСГЭХГҮЙ', () => {
  // `resolveTeamContext`-ийн SQL нь `is_primary = 1`-ээр ШҮҮДЭГ тул IZ, EZ
  //    хоёр НЭР ДЭВШИГЧ БОЛЖ ХҮРЭЛЦЭЖ ИРДЭГГҮЙ.  Энэ бол тэр гэрээний
  //    цэвэр логик талын илэрхийлэл: зөвхөн НЭГ `user_primary` нэр дэвшигч.
  const d = T.decideTeam([cand('user_primary', 'BA')]);
  assert.equal(d.team_code, 'BA');
  assert.equal(d.candidates.filter((c) => c.source === 'user_primary').length, 1);
});

test('7б. `is_primary = 1` шүүлт SQL-д БАЙНА', async () => {
  const { readFileSync } = await import('node:fs');
  const { dirname, join } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const src = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), 'teamContext.ts'),
    'utf8',
  );
  assert.match(src, /ut\.is_primary = 1/);
});

/* ================================================================== */
/*  8..11  БАТАЛГААЖУУЛАГЧ ШАТ ДАНГААРАА ШИЙДЭХГҮЙ                     */
/* ================================================================== */

test('8. зөвхөн sheet_prefix = BA → UNCERTAIN', () => {
  const d = T.decideTeam([cand('sheet_prefix', 'BA')]);
  assert.equal(d.team_code, null);
  assert.equal(d.team_source, 'uncertain');
  assert.equal(d.conflict, null);
});

test('9. зөвхөн behavior = HAS → UNCERTAIN', () => {
  const d = T.decideTeam([cand('behavior', 'HAS')]);
  assert.equal(d.team_code, null);
});

test('10. sheet_prefix=BA + behavior=BA → UNCERTAIN, гэхдээ candidates-д хоёулаа', () => {
  const d = T.decideTeam([cand('sheet_prefix', 'BA'), cand('behavior', 'BA')]);
  assert.equal(d.team_code, null);
  assert.equal(d.candidates.length, 2);
  assert.deepEqual(
    d.candidates.map((c) => c.source).sort(),
    ['behavior', 'sheet_prefix'],
  );
});

test('11. нэр дэвшигч огт байхгүй → UNCERTAIN, candidates = []', () => {
  const d = T.decideTeam([]);
  assert.equal(d.team_code, null);
  assert.equal(d.team_confidence, 0);
  assert.equal(d.team_source, 'uncertain');
  assert.deepEqual(d.candidates, []);
});

/* ================================================================== */
/*  12..13  ФОЛДЫН ГЭМТЭЛ — `BB`                                       */
/* ================================================================== */

test('12. foldableTeamCodes нь BB-г ХАЯНА (фолд нь ганц үсэг)', () => {
  const map = T.foldableTeamCodes(['BA', 'BB', 'HAS', 'TSBU', 'IZ']);
  assert.deepEqual(
    [...map.values()].includes('BB'),
    false,
    'BB нь 4-р шатны зураглалд БАЙХ ЁСГҮЙ',
  );
  // Үлдсэн дөрөв нь БАЙНА — хасалт нь хэт өргөн байж болохгүй.
  assert.equal(map.get('ba'), 'BA');
  assert.equal(map.get('has'), 'HAS');
  assert.equal(map.get('cbu'), 'TSBU'); // ц → ts → c
  assert.equal(map.get('iz'), 'IZ');
});

test('13. foldText("BB") нь ганц үсэг — угтвар дангаараа BB-г шийдэж ЧАДАХГҮЙ', () => {
  // ⚠️ `textFold.ts:51`-ийн `([a-z])\1+ → $1` дүрэм.  BB нь эзний баталсан
  //    НАЙМЫН нэг тул энэ нь БОДИТ багийг буруу чиглүүлэх алдаа.
  assert.equal(foldText('BB'), 'b');
  assert.equal(foldText('Б'), 'b');
  assert.equal(foldText('BB'), foldText('Б'));
  assert.equal(codePrefix('ББ-01'), 'b');
  assert.equal(codePrefix('Б-101'), 'b');
  // ⛔ ЗАСВАР НЬ `foldText`-ийг өөрчлөх БИШ (дөрвөн ихэр) — BB-г 4-р
  //    шатнаас ХАСАХ.
  assert.equal(T.foldableTeamCodes(['BB']).size, 0);
});

test('13б. sheetPrefixCandidate нь BB-ийн угтвараар ХЭЗЭЭ Ч дуугарахгүй', () => {
  const foldMap = T.foldableTeamCodes(['BA', 'BB', 'HAS', 'TSBU', 'TSAH', 'HD', 'AU', 'IZ']);
  // Бүтээцийн хуудсууд — «ББ-01..05».  Фолд нь `b`, зураглалд байхгүй.
  const bb = T.sheetPrefixCandidate(['ББ-01', 'ББ-02', 'ББ-03', 'ББ-04'], foldMap);
  assert.equal(bb, null);
  // Харин BA нь хэвийн ажиллана.
  const ba = T.sheetPrefixCandidate(['БА-01', 'БА-02', 'БА-03'], foldMap);
  assert.equal(ba?.team_code, 'BA');
  assert.equal(ba?.source, 'sheet_prefix');
  assert.equal(ba?.confidence, 0.65);
  // Гурваас цөөн хуудас → дохио БАЙХГҮЙ.
  assert.equal(T.sheetPrefixCandidate(['БА-01', 'БА-02'], foldMap), null);
});

/* ================================================================== */
/*  14..15  КОДЫН ХЭЛБЭР                                               */
/* ================================================================== */

test('14. isTeamCodeShape("NORM") = false (нөөцлөгдсөн)', () => {
  assert.equal(T.isTeamCodeShape('NORM'), false);
  for (const r of T.RESERVED_TEAM_CODES) assert.equal(T.isTeamCodeShape(r), false);
});

test('15. isTeamCodeShape нь ТОМ үсэг шаардана; багцгүй код ХҮЧИНТЭЙ хэвээр', () => {
  assert.equal(T.isTeamCodeShape('ba'), false);
  assert.equal(T.isTeamCodeShape('B'), false);
  assert.equal(T.isTeamCodeShape('BA'), true);
  // ⚠️ MGMT / EZ / GT нь дүрмийн багцгүй, ГЭВЧ ХҮЧИНГҮЙ БИШ — эс бөгөөс
  //    `POST /team-context/verify` тэдгээр багийн гишүүдэд эвдэрнэ.
  for (const code of ['MGMT', 'EZ', 'GT']) assert.equal(T.isTeamCodeShape(code), true);
});

/* ================================================================== */
/*  16..18  ХАМРАХ ХҮРЭЭ БА БОСГО                                      */
/* ================================================================== */

test('16. scopesFor(UNCERTAIN) нь TEAM-гүй', () => {
  const d = T.decideTeam([]);
  assert.deepEqual(T.scopesFor(d), ['GLOBAL', 'COMPANY', 'PROJECT']);
  assert.deepEqual(T.scopesFor(d, PACKED_EIGHT), ['GLOBAL', 'COMPANY', 'PROJECT']);
});

test('17. баталгаажуулагч шатны итгэлцэл нь босгоос ДООГУУР', () => {
  assert.equal(T.TIER_CONFIDENCE.sheet_prefix > T.TEAM_ACCEPT_CONFIDENCE, false);
  assert.equal(T.TIER_CONFIDENCE.behavior > T.TEAM_ACCEPT_CONFIDENCE, false);
  for (const s of T.CORROBORATING_SOURCES) {
    assert.ok(
      T.TIER_CONFIDENCE[s] <= T.TEAM_ACCEPT_CONFIDENCE,
      `${s} нь босгыг давсан — дангаараа шийдэх эрсдэлтэй`,
    );
  }
  for (const s of T.RESOLVING_SOURCES) {
    assert.ok(
      T.TIER_CONFIDENCE[s] > T.TEAM_ACCEPT_CONFIDENCE,
      `${s} нь шийдвэрлэгч атлаа босгыг давахгүй`,
    );
  }
});

test('18. босгын харьцуулалт нь ХАТУУ >', () => {
  // Яг 0.70 нь ХҮРЭЛЦЭХГҮЙ.
  const eq = T.decideTeam([cand('project_shares', 'HAS', T.TEAM_ACCEPT_CONFIDENCE)]);
  assert.equal(eq.team_code, null);
  assert.equal(eq.team_source, 'uncertain');
  // Үл ялиг дээш нь ХҮРЭЛЦЭНЭ.
  const gt = T.decideTeam([cand('project_shares', 'HAS', T.TEAM_ACCEPT_CONFIDENCE + 0.01)]);
  assert.equal(gt.team_code, 'HAS');
});

/* ================================================================== */
/*  19..20  ДҮРМИЙН БАГЦГҮЙ БАГ ≠ UNCERTAIN                            */
/* ================================================================== */

test('19. багцгүй баг: complianceEnabled=false, ГЭВЧ team_code/`source` ХЭВЭЭР', () => {
  const d = T.decideTeam([cand('user_primary', 'EZ')]);
  assert.equal(d.team_code, 'EZ');
  assert.equal(d.team_source, 'user_primary');
  assert.notEqual(d.team_source, 'uncertain');
  assert.equal(d.team_confidence, 0.85);
  assert.equal(T.complianceEnabled(d, PACKED_EIGHT), false);
  // Багцтай баг нь эсрэгээрээ.
  const ba = T.decideTeam([cand('user_primary', 'BA')]);
  assert.equal(T.complianceEnabled(ba, PACKED_EIGHT), true);
  // UNCERTAIN ч мөн false — ГЭХДЭЭ ӨӨР шалтгаанаар.
  assert.equal(T.complianceEnabled(T.decideTeam([]), PACKED_EIGHT), false);
});

test('20. scopesFor нь багцгүй багт TEAM өгөхгүй; багцгүйгээр дуудвал өгнө', () => {
  const d = T.decideTeam([cand('user_primary', 'EZ')]);
  assert.deepEqual(T.scopesFor(d, PACKED_EIGHT), ['GLOBAL', 'COMPANY', 'PROJECT']);
  // ⚠️ `undefined` = «шүүх зүйл алга» (хуучин зан төлөв), хоосон Set БИШ.
  assert.deepEqual(T.scopesFor(d, undefined), ['GLOBAL', 'COMPANY', 'TEAM', 'PROJECT']);
});

/* ================================================================== */
/*  НЭМЭЛТ — ГЭРЭЭНИЙ ИНВАРИАНТУУД                                     */
/* ================================================================== */

test('TIER_CONFIDENCE нь TEAM_SOURCES БҮРИЙГ хамарна', () => {
  for (const s of T.TEAM_SOURCES) {
    assert.equal(typeof T.TIER_CONFIDENCE[s], 'number', `${s} дутуу`);
  }
  assert.equal(Object.keys(T.TIER_CONFIDENCE).length, T.TEAM_SOURCES.length);
});

test('RESOLVING + CORROBORATING нь ШАТНУУДЫГ давхцалгүй хуваана', () => {
  const tiers = new Set<string>([...T.RESOLVING_SOURCES, ...T.CORROBORATING_SOURCES]);
  assert.equal(tiers.size, T.RESOLVING_SOURCES.length + T.CORROBORATING_SOURCES.length);
  // `manual` ба `uncertain` нь шат БИШ — тэд ҮР ДҮНГИЙН төлөв.
  assert.deepEqual(
    T.TEAM_SOURCES.filter((s) => !tiers.has(s)).sort(),
    ['manual', 'uncertain'],
  );
});

test('ШИЙДВЭРЛЭГЧ ДАРААЛАЛ нь итгэлцлийн дараалал БИШ (v2 §48)', () => {
  // `project_shares` (0.75) нь `user_primary` (0.85)-аас ӨМНӨ.
  const i = T.RESOLVING_SOURCES.indexOf('project_shares');
  const j = T.RESOLVING_SOURCES.indexOf('user_primary');
  assert.ok(i >= 0 && j >= 0);
  assert.ok(i < j, 'project_shares нь user_primary-аас ӨМНӨ шалгагдана');
  assert.ok(T.TIER_CONFIDENCE.project_shares < T.TIER_CONFIDENCE.user_primary);
});

test('IMPERSONAL_SOURCES нь `user_primary`-г АГУУЛАХГҮЙ', () => {
  assert.equal(T.IMPERSONAL_SOURCES.includes('user_primary'), false);
  for (const s of T.IMPERSONAL_SOURCES) assert.ok(T.RESOLVING_SOURCES.includes(s));
});

test('behaviorCandidate нь 0.60-аас ХЭЗЭЭ Ч ДЭЭШ ГАРАХГҮЙ', () => {
  const pure = T.behaviorCandidate({ Ducts: 40, 'Air Terminals': 10 });
  assert.equal(pure?.team_code, 'HAS');
  assert.ok(pure!.confidence <= T.TIER_CONFIDENCE.behavior);
  assert.ok(pure!.confidence <= T.TEAM_ACCEPT_CONFIDENCE);
  // Дийлэнх биш холимог → дохио БАЙХГҮЙ.
  assert.equal(T.behaviorCandidate({ Ducts: 5, Walls: 6, Furniture: 5 }), null);
  // Танихгүй категори → унахгүй, зүгээр л дохиогүй.
  assert.equal(T.behaviorCandidate({ 'Generic Models': 100 }), null);
  // Профайлын код нь АМЬД ростерт байхгүй бол ХАСАГДАНА.
  assert.equal(T.behaviorCandidate({ Ducts: 40 }, new Set(['BA'])), null);
});

test('evidenceOf нь ЗАМ, ФАЙЛЫН НЭР агуулахгүй, JSON хүчинтэй', () => {
  const d = T.decideTeam([cand('binding', 'BA'), cand('sheet_prefix', 'BA')]);
  const parsed = JSON.parse(T.evidenceOf(d)) as { candidates: unknown[] };
  assert.equal(parsed.candidates.length, 2);
  assert.equal(T.evidenceOf(d).includes('\\'), false);
});

test('SHARES_EXCLUDED нь ЗӨВХӨН MGMT — EZ, GT нь хууль ёсны', () => {
  assert.deepEqual([...T.SHARES_EXCLUDED_TEAM_CODES], ['MGMT']);
  assert.equal(T.SHARES_EXCLUDED_TEAM_CODES.has('EZ'), false);
  assert.equal(T.SHARES_EXCLUDED_TEAM_CODES.has('GT'), false);
});

test('bimEvents-ийн TeamSourceValue нь TEAM_SOURCES-тэй ЯГ таарна', () => {
  // ⚠️ Хоёр модуль хоорондоо схемийн хамааралгүй байхын тулд жагсаалт
  //    ХОЁР ГАЗАР зарлагдсан.  Зөрвөл `stampTeam` нь DB-д мэдэгдэхгүй утга
  //    бичих тул ЭНД тулгана.
  const stamped = M.stampTeam(
    { rule_id: 'x' },
    { team_code: 'BA', team_source: 'binding', team_confidence: 1, attribution_id: 7 },
  );
  assert.deepEqual(stamped, {
    rule_id: 'x',
    team_code: 'BA',
    team_source: 'binding',
    team_confidence: 1,
    attribution_id: 7,
  });
  // Оролт ӨӨРЧЛӨГДӨӨГҮЙ.
  const original = { a: 1 };
  M.stampTeam(original, {
    team_code: null,
    team_source: 'uncertain',
    team_confidence: 0,
    attribution_id: null,
  });
  assert.deepEqual(original, { a: 1 });
});

test('stampTeam нь БАГЦГҮЙ багийн кодыг NULL болгохгүй (§72)', () => {
  const stamped = M.stampTeam(
    {},
    { team_code: 'EZ', team_source: 'user_primary', team_confidence: 0.85, attribution_id: null },
  );
  assert.equal(stamped.team_code, 'EZ');
  assert.equal(stamped.team_source, 'user_primary');
});

test('SESSION bind арифметик — 34 bind, 2 мөр/statement (ЭЗНИЙ ШИЙДВЭР Ш3)', () => {
  // 33 → 34: 0243 нь `client_dropped_count`-ыг нэмсэн (алдагдлын тоолуурыг
  // хоёр эх сурвалж болгон салгав).  `floor(100/35) = 2` тул statement
  // тутмын мөр ӨӨРЧЛӨГДӨӨГҮЙ.
  assert.equal(M.SESSION_BINDS, 34);
  assert.equal(M.SESSION_ROWS_PER_STATEMENT, 2);
  assert.ok(M.SESSION_ROWS_PER_STATEMENT * (M.SESSION_BINDS + 1) <= 100);
  // ⚠️ Өндөр урсгалтай хүснэгт ХӨНДӨГДӨӨГҮЙ — 0219 нь ЗӨВХӨН VIRTUAL.
  assert.equal(M.EVENT_BINDS, 23);
  assert.equal(M.EVENT_ROWS_PER_STATEMENT, 4);
});
