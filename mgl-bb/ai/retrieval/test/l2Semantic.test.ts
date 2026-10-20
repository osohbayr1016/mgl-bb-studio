/**
 * L2.1 · семантик шалгагч (`norm-dataset/tools/l2-semantic.mjs`) + нэр томьёоны холбоос (`l2-terms.mjs`) + ишлэлийн
 * хамрах хүрээ — БОДИТ БНбД 31-17-10 бичлэг дээр.
 *
 * Шалгах зүйл: утгын урвуулалт бүр (үгүйсгэл, заавал↔зөвшөөрөл↔хориглол↔зөвлөмж), нөхцөл/онцгой нөхцөл алдагдах–зохиогдох,
 * хамрах хүрээ тэлэх/нарийсах, тоо/нэгж/харьцуулалт зөрөх, үндэслэл/төлөв зохиох, батлагдаагүй мэдэгдэл, асуулт → FAIL;
 * эхийн өгүүлбэр, детерминист fallback (593-уулаа), типографийн л ялгаа → PASS.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
// @ts-expect-error — .mjs модуль (JS), төрлийн тодорхойлолтгүй
import { verifyExplanation, numericFacts, modalityOf } from '../../norm-dataset/tools/l2-semantic.mjs';
// @ts-expect-error — .mjs модуль (JS)
import { wordMatches, linkTerms } from '../../norm-dataset/tools/l2-terms.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const L2 = join(HERE, '..', '..', 'norm-dataset', 'documents', 'BNbD_31-17-10', 'l2', 'clause_explanations.jsonl');
type Rec = { clause_uid: string; norm_code: string; source_text: string; plain_mn_fallback: string; semantic_frame: { subject: string[]; cross_references: Array<{ kind: string; target: string; resolution: string; target_uid: string | null; target_scope: string | null; alternatives: string[] }> }; scope: string; appendix: string | null };
const recs = new Map<string, Rec>(readFileSync(L2, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l) as Rec).map((r) => [r.clause_uid, r]));
const rec = (uid: string): Rec => { const r = recs.get(uid); if (!r) throw new Error(`алга: ${uid}`); return r; };
type Verdict = { verdict: 'PASS' | 'FAIL'; failures: Array<{ code: string; detail: string }>; claims: Array<{ claim: string; verdict: string; supported_by: Array<{ clause_uid: string; source_span: string }> }> };
const verify = (uid: string, candidate: string): Verdict => {
  const r = rec(uid);
  return verifyExplanation({ sourceText: r.source_text, candidate, clauseUid: uid, subject: r.semantic_frame.subject, normCode: r.norm_code }) as Verdict;
};
const codes = (v: Verdict): string[] => [...new Set(v.failures.map((f) => f.code))];

test('verifier · утгын урвуулалт бүр FAIL (2026-09-18-ны бодит загварын алдаа орно)', () => {
  const cases: Array<[string, string, string, string]> = [
    // [нэр, uid, нэр дэвшигч, хүлээгдэх код]
    ['2.2 загварын урвуулалт (бодит)', 'БНбД 31-17-10#2.2', 'Ишлэл авсан баримт бичгийн нэмэлт, өөрчлөлт шинэчлэл нь зөвхөн эхэд байгаа хэлбэрээр хэрэгжинэ.', 'UNSUPPORTED_CLAIM'],
    ['1.1 асуултын хэлтэрхий (бодит)', 'БНбД 31-17-10#1.1', 'Зураг төсөл зохиогчид энэ нормыг дагана; хоёр дахь хэсэг вэ?', 'QUESTION_FRAGMENT'],
    ['1.2 үгүйсгэл урвуу (хэрэглэхгүй → хэрэглэнэ)', 'БНбД 31-17-10#1.2', 'Өндөр барилгад шинэчлэлт, өөрчлөлт, их засвар хийхэд энэхүү норм ба дүрмийг хэрэглэнэ.', 'REVERSED_NEGATION'],
    ['8.3 зөвшөөрөл → заавал', 'БНбД 31-17-10#8.3', 'Дамжуулах гол шугамын босоо шугамуудыг 2 болон түүнээс олон бүсэд зориулж заавал төлөвлөх ёстой.', 'PERMISSION_TO_REQUIREMENT'],
    ['12.5 заавал → зөвшөөрөл', 'БНбД 31-17-10#12.5', 'Дулаан зогсоолын цахилгаан хангамжийг барилгын сууцны ба сууцны бус хэсгүүдийнхээс тусдаа байлгаж болно.', 'REQUIREMENT_TO_PERMISSION'],
    ['12.5 заавал → зөвлөмж', 'БНбД 31-17-10#12.5', 'Дулаан зогсоолын цахилгаан хангамжийг барилгын сууцны ба сууцны бус хэсгүүдийнхээс тусдаа байлгах нь зүйтэй.', 'REQUIREMENT_TO_RECOMMENDATION'],
    ['8.13 хориглол → зөвшөөрөл', 'БНбД 31-17-10#8.13', 'Хүйтэн, халуун усны гол түгээх шугам, галын босоо шугам болон цагираг шугамын холболтыг айлын өрөөний дундуур угсрахыг зөвшөөрнө.', 'REVERSED_PROHIBITION'],
    ['14.3 нөхцөл алдагдав', 'БНбД 31-17-10#14.3', 'Өндөр барилгын байрлалыг галын депогоос 2 километрээс ихгүй байхаар зөвшөөрнө.', 'LOST_CONDITION'],
    ['14.3 харьцуулалт зөрөв (ихгүй → багагүй)', 'БНбД 31-17-10#14.3', 'Өндөр барилгын байрлалыг галын депогоос 2 километрээс багагүй байх тохиолдолд зөвшөөрнө.', 'WRONG_OPERATOR'],
    ['14.3 тоо зөрөв', 'БНбД 31-17-10#14.3', 'Өндөр барилгын байрлалыг галын депогоос 3 километрээс ихгүй байх тохиолдолд зөвшөөрнө.', 'WRONG_NUMBER'],
    ['1.1 хамрах хүрээ тэлэв («бүх»)', 'БНбД 31-17-10#1.1', 'Монгол Улсын нутаг дэвсгэрт баригдах бүх барилгын зураг төсөл зохиоход энэхүү норм ба дүрмийг мөрдөнө.', 'SCOPE_WIDENED'],
    ['1.1 хамрах хүрээ нарийсав («зөвхөн»)', 'БНбД 31-17-10#1.1', 'Зөвхөн 35 давхар /150м/ хүртэлх өндөр барилгын зураг төсөл зохиоход энэхүү норм ба дүрмийг мөрдөнө.', 'SCOPE_NARROWED'],
    ['1.1 онцгой нөхцөл урвуу (оруулахгүй → оруулна)', 'БНбД 31-17-10#1.1', 'Техникийн давхрын нийт талбай нь барилгажих талбайн 1/8-ээс хэтрэхгүй, өндөр нь 6м-ээс ихгүй байвал барилгын нийт өндрийн хэмжээ болон давхрын тоонд оруулна.', 'REVERSED_NEGATION'],
    ['1.1 үндэслэл зохиов', 'БНбД 31-17-10#1.1', '17 давхар /51м/-ээс 35 давхар /150м/ хүртэлх өндөр барилгын зураг төсөл зохиоход энэхүү норм ба дүрмийг мөрдөнө, учир нь өндөр барилга галын аюул ихтэй.', 'UNSUPPORTED_RATIONALE'],
    ['1.1 хүчинтэй төлөв зохиов', 'БНбД 31-17-10#1.1', 'Энэхүү норм ба дүрэм одоо хүчинтэй бөгөөд 17 давхар /51м/-ээс 35 давхар /150м/ хүртэлх өндөр барилгад мөрдөнө.', 'UNSUPPORTED_STATUS'],
    ['4.6 нэгж алдагдав (секунд)', 'БНбД 31-17-10#4.6', 'Өндөр барилгын гол орцын хөлийн өрөөний талбайг оргил ачаалалын үед олон нийтийн барилгад цахилгаан шат хүлээх хугацаа 30-35, орон сууц, зочид буудалд 40-60 байхаар тооцон тогтооно.', 'WRONG_UNIT'],
    ['4.6 аравтын орон өөрчлөгдөв (30.0)', 'БНбД 31-17-10#4.6', 'Өндөр барилгын гол орцын хөлийн өрөөний талбайг оргил ачаалалын үед цахилгаан шат хүлээх хугацаа 30.0-35 секунд байхаар тооцон тогтооно.', 'WRONG_NUMBER'],
    ['5.2 нөхцөл зохиов + харьцуулалт («-аас их бол», бодит загварын ноорог)', 'БНбД 31-17-10#5.2', 'Орон сууцны өрөөний түр хамар ханын жин 1,0 кПа (100 кгс/м²)-аас их бол түүнд тэнцүү жигд тархсан нэмэлт ачаа гажуулна.', 'WRONG_OPERATOR'],
    ['12.5 зохиомол агуулга', 'БНбД 31-17-10#12.5', 'Дулаан зогсоолын цахилгаан хангамжийг нарны хавтан, дизель генератороор нөөцлөх шаардлагатай.', 'UNSUPPORTED_CLAIM'],
    ['12.5 өөр баримтын код зохиов', 'БНбД 31-17-10#12.5', 'Дулаан зогсоолын цахилгаан хангамж нь БНбД 43-101-03-ын дагуу тусдаа байх ёстой.', 'FOREIGN_CODE'],
    ['12.5 субъект солигдов', 'БНбД 31-17-10#12.5', 'Лифтний цахилгаан хангамж нь найдваржилтын I зэргийн дагуу барилгын сууцны ба сууцны бус хэсгүүдийнхээс тусдаа байх ёстой.', 'WRONG_SUBJECT'],
  ];
  for (const [name, uid, cand, code] of cases) {
    const v = verify(uid, cand);
    assert.equal(v.verdict, 'FAIL', `${name}: PASS болов`);
    assert.ok(codes(v).includes(code), `${name}: ${code} хүлээсэн, ирсэн ${codes(v).join(',')}`);
  }
});

test('verifier · үнэнч найруулга PASS: эхийн өгүүлбэр, типографийн ялгаа (м² ≡ м2, зай), нөхцөлтэй хураангуй', () => {
  for (const [uid, cand] of [
    ['БНбД 31-17-10#8.3', 'Дамжуулах гол шугамын босоо шугамуудыг усан хангамжийн сонгосон схемээс хамаарч 2 болон түүнээс олон бүсэд зориулж төлөвлөж болно.'],
    ['БНбД 31-17-10#2.2', 'Ишлэл авсан баримт бичгүүдэд нэмэлт эсвэл өөрчлөлт хийсэн бол тус баримт бичгийг мөрдөнө.'],
    ['БНбД 31-17-10#1.2', 'Өндөр барилгын шинэчлэлт, өөрчлөлт, их засвар хийхэд энэ заалтыг хэрэглэхгүй.'],
    ['БНбД 31-17-10#5.2', 'Орон сууцны өрөөний түр хамар ханын жингээс үүсэх төвлөрсөн ачааллын хэмжээт утгыг 1,0 кПа (100 кгс/м²)-аас багагүй жигд тархсан нэмэлт ачаа болгон тооцохыг зөвшөөрнө.'],
    ['БНбД 31-17-10#14.3', 'Өндөр барилгын байрлалыг галын депогоос 2 километрээс ихгүй байх тохиолдолд зөвшөөрнө.'],
  ] as const) {
    const v = verify(uid, cand);
    assert.equal(v.verdict, 'PASS', `${uid}: ${codes(v).join(',')} ${v.failures.map((f) => f.detail).join(' | ')}`);
  }
});

test('verifier · детерминист fallback 593-уулаа PASS (эхийн өгүүлбэрүүд); claim бүр эх өгүүлбэртэй холбогдоно', () => {
  let claims = 0;
  let supported = 0;
  for (const r of recs.values()) {
    const v = verify(r.clause_uid, r.plain_mn_fallback);
    assert.equal(v.verdict, 'PASS', `${r.clause_uid}: ${codes(v).join(',')}`);
    // Толгой шошго («Энэ заалт … тогтоосон.») агуулгагүй — эх өгүүлбэртэй холбогдох шаардлагагүй; бусад мэдэгдэл бүр холбогдоно.
    for (const c of v.claims) { if (/^Энэ заалт /u.test(c.claim)) continue; claims += 1; if (c.supported_by.length > 0) supported += 1; }
  }
  assert.ok(claims >= 593);
  assert.ok(supported / claims > 0.9, `supported ${supported}/${claims}`);
});

test('verifier · тоо: харьцуулалт, нэгжийн жигдрэл, хаяг (5.1-р хүснэгт, 14-р хүснэгт, БНбД код) тоо биш', () => {
  const f = numericFacts('Хучилтын ачааллыг 5.1-р хүснэгтийн дагуу 1,0кпа(100кгс/м2)-аас багагүй, 14-р хүснэгт, БНбД 40-05-98, өндөр 6м-ээс ихгүй.') as Array<{ number: string; unit: string | null; comparators: string[] }>;
  assert.deepEqual(f.map((x) => [x.number, x.unit, x.comparators]), [['1,0', 'кпа', ['>=']], ['100', 'кгс/м2', ['>=']], ['6', 'м', ['<=']]]);
  assert.equal(modalityOf('… хориглоно.'), 'prohibition');
  assert.equal(modalityOf('… төлөвлөж болно.'), 'permission');
  assert.equal(modalityOf('… байх ёстой.'), 'obligation');
  assert.equal(modalityOf('… байх нь зүйтэй.'), 'recommendation');
});

test('terms · консерватив залгавар: «бүс»→«бүсэд», «хэрэгсэл»→«хэрэгслийн» тулна; «аюулын»≠«аюулгүйн», «өргөжсөн»≠«өргөжин» тулахгүй', () => {
  assert.equal(wordMatches('бүс', 'бүсэд'), 'stem_suffix');
  assert.equal(wordMatches('хэрэгсэл', 'хэрэгслийн'), 'stem_suffix');
  assert.equal(wordMatches('аюулын', 'аюулын'), 'exact');
  assert.equal(wordMatches('аюулын', 'аюулгүйн'), null);
  assert.equal(wordMatches('өргөжсөн', 'өргөжин'), null);
  assert.equal(wordMatches('нуралт', 'нуралтын'), 'stem_suffix');
  const defs = [{ term: 'Аюулын бүс', definition_id: 'd1', definition: 'x' }, { term: 'Хамгаалалтын хаалт', definition_id: 'd2', definition: 'y' }];
  const links = linkTerms('Барилгын аюулын бүсэд хамгаалалтын хаалтыг төлөвлөнө; аюулгүйн бүс тусдаа.', defs) as Array<{ term: string; matched_surface: string; match_method: string; confidence: number }>;
  // exact + stem_suffix холимог → 'mixed' (0.8); бүх үг залгавартай → 'stem_suffix' (0.9); бүгд яг → 'exact' (1.0).
  assert.deepEqual(links.map((l) => [l.term, l.matched_surface, l.match_method, l.confidence]), [['Аюулын бүс', 'аюулын бүсэд', 'mixed', 0.8], ['Хамгаалалтын хаалт', 'хамгаалалтын хаалтыг', 'mixed', 0.8]]);
  assert.equal((linkTerms('аюулын бүс', defs) as Array<{ match_method: string }>)[0]?.match_method, 'exact');
  assert.deepEqual(linkTerms('аюулгүйн бүс', defs), []);
  // Бодит 31-17-10: 22 тодорхойлолтын нэг нь ч заалтад давтагддаггүй (хэмжсэн) — 0 холбоос нь ЗӨВ, зохиомол холбоос биш.
  let linked = 0;
  for (const r of recs.values()) linked += (r as unknown as { context: { definitions: unknown[] } }).context.definitions.length;
  assert.equal(linked, 0);
});

test('xref · хамрах хүрээ: хавсралтын заалт өөрийн хавсралтад, шийдэгдээгүй 6 нь UNRESOLVED (таамаглал үгүй), буруу холбоос 0', () => {
  const all = [...recs.values()].flatMap((r) => r.semantic_frame.cross_references.map((x) => ({ from: r, x })));
  const unresolved = all.filter(({ x }) => x.resolution === 'unresolved');
  // 2026-09-23: 5.6-ийн «2-р хүснэгт» нь «БНбД 22-01-01*/2006/-ийн 2-р хүснэгт» — ӨӨР баримтынх (external), шийдэгдээгүй биш.
  assert.equal(unresolved.length, 6);
  assert.deepEqual(unresolved.map(({ from, x }) => `${from.clause_uid}→${x.kind}:${x.target}`).sort(), [
    'БНбД 31-17-10#A14.4:14.4.2→table:1', 'БНбД 31-17-10#A16.2:16.2.4→table:16.2.2', 'БНбД 31-17-10#A16.2:16.2.7→table:16.2.2',
    'БНбД 31-17-10#A5.1:5.1.14→clause:5.1.15', 'БНбД 31-17-10#A6.3:6.3.34→table:14.2', 'БНбД 31-17-10#A7.1:7.1.1→table:2',
  ].sort());
  const ext56 = rec('БНбД 31-17-10#5.6').semantic_frame.cross_references.find((x) => x.kind === 'table' && x.target === '2') as { resolution?: string; document?: string } | undefined;
  assert.equal(ext56?.resolution, 'external');
  assert.equal(ext56?.document, 'БНбД 22-01-01*/2006');
  for (const { from, x } of all.filter(({ x }) => x.kind === 'clause' && x.resolution === 'resolved')) {
    assert.ok(recs.has(x.target_uid!), `${from.clause_uid} → ${x.target_uid} байхгүй заалт руу холбогдов`);
    // Хавсралтын заалтын ишлэл ӨӨРИЙН хавсралтад байвал тэнд л (үндсэн хэсгийн ижил дугаар руу биш).
    if (from.scope === 'appendix' && recs.has(`${from.norm_code}#A${from.appendix}:${x.target}`)) assert.equal(x.target_uid, `${from.norm_code}#A${from.appendix}:${x.target}`);
  }
  // 14.4.2 → «14.25-р заалт» үндсэн хэсэгт resolved; хүснэгт 1 нь unresolved.
  const r1442 = rec('БНбД 31-17-10#A14.4:14.4.2');
  assert.ok(r1442.semantic_frame.cross_references.some((x) => x.kind === 'clause' && x.target === '14.25' && x.resolution === 'resolved' && x.target_uid === 'БНбД 31-17-10#14.25'));
});
