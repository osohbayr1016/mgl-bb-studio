/**
 * НОРМЫН ХӨРВҮҮЛЭГЧ — БД 21-101-12 адаптер + үүсгэсэн бүртгэлийн ХУУЧИРСАН ЭСЭХ.
 *
 * ⚠️ Багц (`data-train-files`) энэ машинд байхгүй бол адаптерын тестүүд
 *    алгасна — гэвч `--check`-тэй тэнцэх drift тест нь багц БАЙГАА газар
 *    (хөгжүүлэгчийн PC) заавал ажиллана: үүсгэсэн файл гараар засагдсан
 *    эсвэл багц шинэчлэгдсэн атлаа дахин үүсгээгүй бол улаан.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { compileBd, BD_IDENTITY_FILES, toPredicate, proseComparator, boundaryConflicts } from '../src/adapters/bd-21-101-12.ts';
import { compileTargets, discoverTargets, checkFiles, validateVerificationStatuses, executableWithoutWhitelist } from '../src/compile.ts';
import { emitDocument, contentSha256 } from '../src/emit.ts';
import { FIRE_HAZARD_IDENTITY_FILES } from '../../retrieval/src/ingest.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const DATASETS = join(HERE, '..', '..', 'data-train-files');
const BD = join(DATASETS, 'MGL_AI_BD_21_101_12_dataset');
const OUT = join(HERE, '..', '..', '..', 'backend', 'src', 'lib', 'mglai', 'norm', 'generated');
const skipBd = existsSync(join(BD, 'v_subcategory_rules.jsonl')) ? false : 'БД 21-101-12 багц олдсонгүй';

test('identity файлын жагсаалт · хөрвүүлэгч ба локал шингээлт ЯГ ИЖИЛ (Amendment A)', () => {
  assert.deepEqual([...BD_IDENTITY_FILES].sort(), [...FIRE_HAZARD_IDENTITY_FILES].sort());
});

test('toPredicate · nested any/all, enum, тоо, min/max, туг, not_category', () => {
  const p = toPredicate({ any: [{ all: [{ medium: ['a', 'b'] }, { flash_point_c: { lte: 28 } }, { explosion_overpressure_kpa: { gt: 5 } }] }, { all: [{ not_category: ['А', 'Б'] }, { combustible_material_present: true }] }] });
  assert.equal(p?.kind, 'any');
  assert.deepEqual(toPredicate({ g_mj_m2: { min: 1401, max: 2200 } }), { kind: 'number', field: 'g_mj_m2', op: 'between', value: [1401, 2200], unit: null });
  assert.deepEqual(toPredicate({ g_mj_m2: { gt: 2200 } }), { kind: 'number', field: 'g_mj_m2', op: '>', value: 2200, unit: null });
  assert.deepEqual(toPredicate({ x: true }), { kind: 'flag', field: 'x', value: true });
});

test('proseComparator · «28°C-аас бага» = <, «28°C-аас их» = >, «-аас багагүй» = >=', () => {
  assert.equal(proseComparator('авалцан асах хэм 28°C-аас бага шатамхай хий', 28), '<');
  assert.equal(proseComparator('авалцан асах хэм 28°C-аас их хялбар', 28), '>');
  assert.equal(proseComparator('10 м²-аас багагүй', 10), '>=');
  assert.equal(proseComparator('тоо байхгүй', 28), null);
});

test('boundaryConflicts · lte 28 vs проз «бага» → 28 дээр зөрчил; gt 28 vs «их» → зөрчилгүй (Amendment C)', () => {
  const a = boundaryConflicts(toPredicate({ flash_point_c: { lte: 28 } }), 'авалцан асах хэм 28°C-аас бага');
  assert.equal(a.length, 1);
  assert.equal(a[0]?.value, 28);
  assert.equal(a[0]?.executableOp, '<=');
  assert.equal(a[0]?.proseOp, '<');
  assert.equal(a[0]?.reason, 'source_boundary_conflict');
  assert.equal(boundaryConflicts(toPredicate({ flash_point_c: { gt: 28 } }), '28°C-аас их').length, 0);
});

test('compileBd · дүрэм, томьёо, кейс, аль тоо ч ЗОХИОГДООГҮЙ (файлаас), 28 °C зөрчил бүртгэгдэнэ', { skip: skipBd }, () => {
  const d = compileBd(BD);
  assert.equal(d.documentCode, 'БД 21-101-12');
  assert.equal(d.currentness, 'CURRENT_BUT_LATER_AMENDMENTS_NOT_VERIFIED');
  assert.equal(d.formulas.length, 38);
  assert.equal(d.clauses.length, 80);
  assert.equal(d.cases.length, 14);
  assert.match(d.datasetSha256, /^[0-9a-f]{64}$/);
  assert.ok(d.codeAliases.includes('BD 21-101-12') && d.codeAliases.includes('21-101-12'));
  const by = (id: string) => d.rules.find((r) => r.ruleId.endsWith(id));
  assert.equal(by('room:A:gas_liquid')?.boundaryConflicts[0]?.value, 28);
  assert.equal(by('room:B:dust_liquid')?.boundaryConflicts.length, 0);
  assert.equal(by('clause:4.4')?.value, 0.8);
  assert.equal(by('clause:4.2.valve:manual')?.value, 300);
  assert.equal(by('clause:4.2.valve:auto_no_redundancy')?.value, 120);
  assert.equal(by('clause:4.20.b4:default')?.value, 12);
  assert.equal(by('room:V2:g')?.predicate?.kind, 'number');
  assert.equal(by('building:A')?.executable, false, 'needs_human_review барилгын дүрэм гүйцэтгэхгүй');
  assert.equal(by('building:D')?.executable, true);
  // томьёо: гүйцэтгэх боломжтой нь зөвхөн баталгаажсан
  const f7 = d.formulas.find((f) => f.formulaId.endsWith(':4.8:7'));
  assert.equal(f7?.executable, true);
  assert.equal(f7?.provenance.page, 8);
  assert.equal(d.formulas.find((f) => f.formulaId.endsWith(':4.6:4'))?.executable, false);
  // хэсгийн python-repr цэвэрлэгдсэн
  assert.ok(!d.clauses.find((c) => c.chunkId.endsWith('room:V2:g'))!.textMn.includes("{'min'"));
});

test('compileBd · ДЕТЕРМИНИСТ — хоёр удаа хөрвүүлэхэд байт бүрээрээ ижил', { skip: skipBd }, () => {
  const a = emitDocument(compileBd(BD));
  const b = emitDocument(compileBd(BD));
  assert.equal(a, b);
  assert.equal(contentSha256(compileBd(BD)), contentSha256(compileBd(BD)));
});

test('--check · үүсгэсэн бүртгэл багцтай ЯГ таарна (хуучирсан бол `npm run ai:norm:generate`)', { skip: skipBd }, () => {
  const { targets } = discoverTargets(DATASETS);
  assert.ok(targets.length >= 1, 'адаптер таарах багц олдох ёстой');
  const { files } = compileTargets(targets, OUT);
  const r = checkFiles(files);
  assert.deepEqual({ stale: r.stale, missing: r.missing }, { stale: [], missing: [] }, 'үүсгэсэн файл хуучирсан/байхгүй');
});

test('үүсгэсэн файлын толгой нь гараар засахгүй гэж хэлдэг ба dataset sha агуулна', () => {
  const p = join(OUT, 'bd-21-101-12-2012.generated.ts');
  assert.ok(existsSync(p));
  const head = readFileSync(p, 'utf8').slice(0, 600);
  assert.match(head, /ГАРААР ЗАСАХГҮЙ/);
  assert.match(head, /dataset sha256 [0-9a-f]{64}/);
});

test('GAP-025 · танигдаагүй баталгаажилтын төлөв → хөрвүүлэгч ЗОГСОНО; бүртгэлтэй гүйцэтгэгдэхгүй нь зөвшөөрөгдөнө', { skip: skipBd }, () => {
  const d = compileBd(BD);
  assert.deepEqual(validateVerificationStatuses(d), [], 'БД 21-101-12-ийн бүх төлөв бүртгэлтэй');
  assert.deepEqual(executableWithoutWhitelist(d), []);
  // Нэг дүрмийн төлөвийг танигдахгүй нэрээр солив — executable биш болно, хөрвүүлэгч алдаа заана.
  const rule = d.rules[0]!;
  const tampered = { ...d, rules: [{ ...rule, executable: false, provenance: { ...rule.provenance, verificationStatus: 'mystery_status' } }, ...d.rules.slice(1)] };
  assert.deepEqual(validateVerificationStatuses(tampered), ['«mystery_status» ×1']);
  assert.throws(
    () => compileTargets([{ folder: BD, adapter: { id: 'x', detect: () => true, compile: () => tampered } }], OUT),
    /mystery_status/,
  );
  // Бүртгэлтэй гүйцэтгэгдэхгүй төлөв (needs_human_review) executable:false байвал хэвийн …
  const reviewed = { ...d, rules: [{ ...rule, executable: false, provenance: { ...rule.provenance, verificationStatus: 'needs_human_review' } }, ...d.rules.slice(1)] };
  assert.deepEqual(validateVerificationStatuses(reviewed), []);
  // … харин executable:true гэж тэмдэглэвэл ГООЖИЛТ — зогсоно.
  const leak = { ...d, rules: [{ ...rule, executable: true, provenance: { ...rule.provenance, verificationStatus: 'verified_content_extract' } }, ...d.rules.slice(1)] };
  assert.deepEqual(executableWithoutWhitelist(leak), [rule.ruleId]);
  assert.throws(() => compileTargets([{ folder: BD, adapter: { id: 'x', detect: () => true, compile: () => leak } }], OUT), /цагаан жагсаалтгүй/);
});

