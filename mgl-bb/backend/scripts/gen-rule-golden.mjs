/**
 * gen-rule-golden.mjs — `rule_test_cases` → `revit-mcp/eval/golden/rules.json`
 * ---------------------------------------------------------------------------
 * v2 §70: «дүрэм тус бүрд баталгаажсан туршилтын кейс».  `2-2`-ын
 * `rule_test_cases` (миграц 0222) нь регрессийн тест БАС golden корпус
 * ХОЁУЛАА болно.  Хоёр дахь хурсанд БАРИХГҮЙ — `revit-mcp/eval/` аль хэдийн
 * байгаа (6 хуваарь, `manifest.json`, `run_golden.py`, `freeze.py`,
 * `assert_no_leak.py`).  Энэ скрипт нь ЗӨВХӨН МӨР БИЧИХ ЗАМ.
 *
 * Ажиллуулах:
 *   node scripts/gen-rule-golden.mjs --remote            # ЗӨВХӨН УНШИНА
 *   node scripts/gen-rule-golden.mjs --local             # локал miniflare D1
 *   node scripts/gen-rule-golden.mjs --remote --write    # файл бичнэ
 *
 * ---------------------------------------------------------------------------
 * ⛔ ХЭЗЭЭ Ч БИЧИХГҮЙ
 *
 *  · `verified = 0` мөр.  «Verified = TRUE» нь v2 §70-ийн жишээнд ЗААВАЛ
 *    талбар — баталгаажаагүй тохиолдол `rule_test_cases`-д ХАДГАЛАГДАНА ч
 *    golden-д ОРОХГҮЙ.  SQL нь `WHERE verified = 1` (0222-ийн хэсэгчилсэн
 *    индекс `idx_rule_tests_verified` тэрийг үйлчлүүлнэ).
 *  · `revit-mcp/CLAUDE.md:59-116`-ийн тоог ГАРААР.  Тэр файл өөрөө
 *    «design-guidance, албан ёсны БНбД-тэй тулгаагүй» гэж бичдэг ба
 *    `eval/golden/rules.json`-ийн `_note` түүнийг golden болгохыг ИЛЭЭР
 *    ХОРИГЛОДОГ.  БУРУУ доод хэмжээг албан ёсны шошготой инженерийн өмнө
 *    тавих нь энэ бүх системийн ХАМГИЙН МУУ гаралт.
 *  · `manifest.json`-ийн `sha256`-ыг ГАРААР.  `freeze.py refresh` бичнэ.
 *
 * ---------------------------------------------------------------------------
 * ⚠️ ХООСОН БАЙХ НЬ ЗӨВ ХАРИУ, АЛДАА БИШ.
 *
 * `verified = 1` мөр ТЭГ байвал энэ скрипт `rows: []`-ыг ХЭВЭЭР үлдээж
 * `exit 0` өгнө.  Тэгэхээр `run_golden.py --kind rules` нь `sys.exit(2)`
 * («БЛОКЛОВ: rules») өгсөөр байх бөгөөд ТЭР НЬ ЗӨВ: хоосон шаардлагатай
 * хуваарь = ХАТУУ БЛОК нь «хараахан хэмжээгүй» ба «хэмжих шаардлагагүй»
 * хоёрыг ялгах ЦОРЫН ГАНЦ механизм.  Түүнийг «алгасах» болговол
 * хэмжигдээгүй дүрмийн хөдөлгүүр ногоон харагдана.
 *
 * ⚠️ ЭНЭ ХООСОН БАЙДЛЫГ ЭНЭ РЕЛИЗЭД ЗАСАХ БОЛОМЖГҮЙ.  `rules` хүснэгт
 * ХООСОН нийлүүлэгдэнэ (эзэн БНбД баримтуудаа өөрөө өгнө), тиймээс
 * `rule_test_cases` ч хоосон, тиймээс энэ скриптийн бодит гаралт нь эзэн
 * эхний багцаа өгсний ДАРАА л гарна.  Хүлээгдэх эхний баг: **BA**
 * (Барилга архитектур) — эзэн 2026-08-30-нд баталсан.  Ганц түлхүүртэй
 * `per_team` нь алдаа БИШ.
 *
 * ---------------------------------------------------------------------------
 * ⛔⛔ ХАРНАСС ХАРААХАН ДҮРМИЙН МӨРИЙГ ОНООЖ ЧАДАХГҮЙ — ХЭМЖСЭН, 2026-08-31
 *
 * `eval/run_golden.py` ба `eval/freeze.py` хоёул САНАА ТАНИХ хэлбэртэй:
 *   · `freeze.py::stamp_ids`  → `row_id(r["text"], r["intent"])` гэж мөр
 *     БҮРЭЭС `text`/`intent` шаарддаг.  Дүрмийн мөрөнд тэдгээр БАЙХГҮЙ ⇒
 *     `freeze.py refresh` нь KeyError өгнө.
 *   · `run_golden.py::score`  → бүх мөрийн `text`-ийг САНААНЫ загвараар
 *     таамаглаж оноодог.  Дүрмийн вердикт нь санааны ангилал БИШ.
 *   · `freeze.py::load_partition_doc` нь `_note`-ыг `PARTITION_NOTE`-оос
 *     ДАРЖ БИЧДЭГ ⇒ `golden/rules.json`-д бичсэн тайлбар нь `refresh`
 *     хийхэд АЛГА БОЛНО.  Тайлбарын БАЙНГЫН гэр нь `freeze.PARTITION_NOTE`.
 * Тиймээс дүрмийн хуваарийг БОДИТООР гүйлгэхийн тулд харнассыг өргөтгөх
 * ажил ҮЛДЭЖ БАЙНА — тэр нь `2-7-readiness-and-quality`-ийн хамрах хүрээ
 * (§66-ийн худал эерэг / худал сөрөгийн метрик мөн ЭНЭ хүснэгтийг уншина).
 * Энэ скрипт мөр гаргах бэлэн боловч, мөр ГАРСАН өдөр `--write` нь тэр
 * блокерыг ЧАНГААР сануулна.
 */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { wranglerNames } from './wranglerNames.mjs';

const backendDir = dirname(dirname(fileURLToPath(import.meta.url)));
const goldenPath = join(backendDir, '..', 'revit-mcp', 'eval', 'golden', 'rules.json');

const argv = process.argv.slice(2);
const write = argv.includes('--write');
const local = argv.includes('--local');
const remote = argv.includes('--remote');

if (local === remote) {
  console.error('Заавал НЭГ л зорилго: --remote эсвэл --local');
  process.exit(1);
}

/* ------------------------------------------------------------------ */
/*  D1 уншилт                                                          */
/* ------------------------------------------------------------------ */

/**
 * ⚠️ ЗӨВХӨН УНШИНА.  `wrangler d1 execute --json` нь массив буцаадаг;
 *    эхний элементийн `results` нь мөрүүд.  `--config wrangler.toml` нь
 *    ЗААВАЛ — репогийн үндэсд байгаа `wrangler.jsonc` нь ӨӨР worker
 *    зарладаг ба wrangler-ийн config хайлт түүнийг сонгож болно.
 */
function query(sql) {
  const { databaseName } = wranglerNames();
  const args = [
    'wrangler', 'd1', 'execute', databaseName,
    local ? '--local' : '--remote',
    '--config', 'wrangler.toml',
    '--json',
    '--command', process.platform === 'win32' ? `"${sql.replace(/"/g, '\\"')}"` : `'${sql}'`,
  ];
  const res = spawnSync('npx', args, { cwd: backendDir, shell: true, encoding: 'utf8' });
  if (res.status !== 0) {
    console.error(res.stderr || res.stdout);
    throw new Error(`d1 execute унав (exit ${res.status})`);
  }
  // wrangler нь JSON-ы өмнө хэд хэдэн мэдээллийн мөр хэвлэдэг.
  const text = res.stdout;
  const start = text.indexOf('[');
  if (start < 0) throw new Error('d1 execute JSON буцаасангүй');
  const parsed = JSON.parse(text.slice(start));
  return parsed[0]?.results ?? [];
}

/* ------------------------------------------------------------------ */
/*  row_id                                                             */
/* ------------------------------------------------------------------ */

/**
 * ⚠️ ЭНЭ БОЛ `eval/manifest.json`-ийн `row_id.formula`-ААС ЯЛГААТАЙ —
 *    ИЛ, БҮРТГЭГДСЭН ХАЗАЙЛТ, нуугдмал БИШ.
 *
 *    Санааны хуваарийн томьёо нь `sha256(preprocess(text) + '\x00' +
 *    intent)` бөгөөд `preprocess` (fold-v1) нь ХЭРЭГЛЭГЧИЙН БИЧСЭН
 *    текстийн кирилл/латин хувилбарыг нэг болгодог — «ЦБУ-05» ба «cbu 05»
 *    НЭГ id авах ёстой, эс бөгөөс үсгийн хувилбараар батламжийг тойрно.
 *
 *    Дүрмийн кейст тэр асуудал ОРШИН БАЙХГҮЙ: `rule_uid` ба `case_uid` нь
 *    МАШИНЫ таних тэмдэг (0222: `case_uid` нь ДЭЛХИЙ ДАЯАР UNIQUE), хүн
 *    бичдэггүй, орфографийн хувилбаргүй.  Тиймээс fold ХЭРЭГГҮЙ.
 *
 * ⛔ ЯАГААД `foldText`-ийг ЭНД ХУУЛБАРЛААГҮЙ ВЭ: `preprocess`/`foldText`
 *    нь ДӨРВӨН ИХРИЙН нэг (backend TS `lib/textFold.ts`, frontend
 *    `shared/lib/search/normalize.ts`, Python `training/textfold.py`,
 *    C# `TextFold.cs`).  Тав дахийг үүсгэх нь вэбийн хайлт ба Revit-ийн
 *    хуудас таарцыг ЧИМЭЭГҮЙ доройтуулах эрсдэл — тэр нь энэ скриптийн
 *    авах ёсгүй эрсдэл.
 *
 * ⚠️ ҮЛДСЭН АЖИЛ (2-7): `manifest.json`-ийн `row_id` блокт дүрмийн
 *    хуваарийн томьёог ИЛЭЭР бүртгэх — эс бөгөөс «нэг файлд хоёр томьёо
 *    БАЙХГҮЙ» гэсэн тэндхийн `_why` нь бодит байдалтай зөрнө.
 */
function ruleRowId(ruleUid, caseUid) {
  return createHash('sha256').update(`${ruleUid} ${caseUid}`, 'utf8').digest('hex').slice(0, 16);
}

/* ------------------------------------------------------------------ */
/*  Гол урсгал                                                         */
/* ------------------------------------------------------------------ */

// ⚠️ `WHERE verified = 1` — 0222-ийн `idx_rule_tests_verified` хэсэгчилсэн
//    индекс ЯГ ЭНЭ асуулгад зориулагдсан.  `LIKE '%…%'` БАЙХГҮЙ (алсын D1
//    том TEXT багана дээр түүнийг татгалздаг).
// ⚠️ `team_code` нь `rules`-ээс ирнэ, `rule_test_cases` дээр БАЙХГҮЙ —
//    LEFT JOIN, учир нь кейс нь дүрмээсээ ӨМНӨ бичигдсэн байж болно
//    (`rule_uid` дээр FK ЗОРИУД ТАВИАГҮЙ).  Дүрэмгүй кейсийн баг нь NULL.
const SQL = `SELECT tc.case_uid, tc.rule_uid, tc.rule_version, tc.case_class,
       tc.inputs_json, tc.expect_verdict, tc.expect_value,
       tc.source_kind, tc.source_note, tc.verified_by, tc.verified_at,
       r.team_code AS team_code, r.severity AS severity
  FROM rule_test_cases tc
  LEFT JOIN rules r ON r.rule_uid = tc.rule_uid AND r.version = tc.rule_version
 WHERE tc.verified = 1
 ORDER BY tc.rule_uid, tc.case_uid`;

const rows = query(SQL);

const perTeam = {};
const perClass = {};
const out = [];
for (const r of rows) {
  const teamCode = r.team_code ?? null;
  const key = teamCode ?? '(none)';
  perTeam[key] = (perTeam[key] ?? 0) + 1;
  perClass[r.case_class] = (perClass[r.case_class] ?? 0) + 1;

  let inputs = {};
  try {
    inputs = JSON.parse(r.inputs_json ?? '{}');
  } catch {
    // ⚠️ 0222-ийн CHECK нь `json_valid` тул энд хүрэх ЁСГҮЙ.  Хүрсэн бол
    //    мөрийг ЧИМЭЭГҮЙ ХАЯХГҮЙ — golden-д хог оруулахаас илүү унасан нь
    //    дээр (§70-ийн бүх утга нь «энэ жагсаалт ҮНЭН» гэдэгт байна).
    console.error(`❌ ${r.case_uid}: inputs_json задлагдахгүй`);
    process.exit(3);
  }

  out.push({
    row_id: ruleRowId(r.rule_uid, r.case_uid),
    rule_uid: r.rule_uid,
    rule_version: r.rule_version,
    case_uid: r.case_uid,
    case_class: r.case_class,
    team_code: teamCode,
    severity: r.severity ?? null,
    inputs,
    expect: {
      verdict: r.expect_verdict,
      value: r.expect_value ?? null,
    },
    source_kind: r.source_kind,
    source_note: r.source_note ?? null,
    // ⚠️ ҮРГЭЛЖ `true` — SQL нь `verified = 1`-ээр шүүсэн.  Талбарыг ил
    //    үлдээв: v2 §70-ийн жишээнд тэр ЗААВАЛ талбар, ба уншигч файлыг
    //    гараар шалгахдаа тэрийг хайна.
    verified: true,
    verified_by: r.verified_by ?? null,
    verified_at: r.verified_at ?? null,
  });
}

console.log(`rule_test_cases (verified = 1): ${out.length} мөр`);
console.log(`  per_team  : ${JSON.stringify(perTeam)}`);
console.log(`  per_class : ${JSON.stringify(perClass)}`);

if (!write) {
  console.log('\n(--write өгөөгүй — файл БИЧСЭНГҮЙ)');
  process.exit(0);
}

if (!existsSync(goldenPath)) {
  console.error(`❌ ${goldenPath} байхгүй — eval мод бүрэн эсэхийг шалга.`);
  process.exit(3);
}
const doc = JSON.parse(readFileSync(goldenPath, 'utf8'));

if (out.length === 0) {
  // ⚠️ ХООСОН ⇒ ФАЙЛЫГ ХӨНДӨХГҮЙ.  Дахин бичих нь sha256-г өөрчилж
  //    `run_golden.py`-ийн бүрэн бүтэн байдлын шалгалтыг (`exit 3`) ажиллуулна
  //    — тэр нь БЛОКЛОСОН (`exit 2`) гэсэн ЗӨВ хариуг НУУНА.
  console.log('\nБаталгаажсан кейс АЛГА — `rows: []` ХЭВЭЭР, файл хөндөгдсөнгүй.');
  console.log('`run_golden.py --kind rules` нь exit 2 өгсөөр байх нь ЗӨВ ХАРИУ.');
  process.exit(0);
}

doc.rows = out;
// ⚠️ ФОРМАТ НЬ ГЭРЭЭ — `freeze.py::write_json`-той ЯГ ИЖИЛ: `indent=1`,
//    `ensure_ascii=False`, төгсгөлийн мөр шилжилт.  Зөрвөл sha256 давтагдахгүй.
writeFileSync(goldenPath, `${JSON.stringify(doc, null, 1)}\n`, 'utf8');
console.log(`\n✔ ${out.length} мөр бичив → revit-mcp/eval/golden/rules.json`);

console.log(`
⛔ ДАРААГИЙН АЛХАМУУД — ЭНЭ ХУВААРЬ ХАРААХАН ГҮЙХГҮЙ:
   1. \`eval/freeze.py::stamp_ids\` нь мөр бүрээс \`text\`/\`intent\` шаарддаг
      тул \`freeze.py refresh\` нь ЭДГЭЭР мөр дээр УНАНА.  Дүрмийн хуваарийн
      \`row_id\`-г хэвээр нь үлдээх салаа хэрэгтэй (2-7).
   2. \`eval/run_golden.py::score\` нь мөр бүрийн \`text\`-ийг САНААНЫ загвараар
      таамагладаг.  Дүрмийн вердиктийг оноох салаа хэрэгтэй (2-7).
   3. \`eval/manifest.json\`-ийн \`golden.rules.sha256\` ба \`.rows\` нь
      ХОЦОРЧ БАЙНА.  \`freeze.py refresh\` бичнэ — sha256-г ГАРААР БИЧИХГҮЙ.
   4. \`freeze.py::load_partition_doc\` нь \`_note\`-ыг \`PARTITION_NOTE\`-оос
      дарж бичдэг тул тайлбарын БАЙНГЫН гэр нь тэр толь (2-7).
   Хүртэл: \`run_golden.py --kind rules\` нь бүрэн бүтэн байдлын алдаагаар
   (exit 3) унана — БЛОКЛОСОН (exit 2) БИШ.  Хоёулаа улаан, шалтгаан нь өөр.
`);
