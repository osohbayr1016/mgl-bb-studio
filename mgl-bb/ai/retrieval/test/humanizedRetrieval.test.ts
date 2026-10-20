/**
 * MGL AI retrieval · ХҮНИЙ ЯРИАНЫ ХЭЛБЭРТЭЙ АСУУЛТЫН ХАЙЛТ — цэвэр туслахууд (2026-09-23).
 *
 * Run with:  node --test retrieval/test/humanizedRetrieval.test.ts
 *
 * Эзний HL01–HL10 (прод, 0/10) хайлтын шалтгаанууд:
 *   · эгшиг гээгдэл / тохиолын залгавар — «даамлыг», «даамлаар» ↔ «даамал»; 4.3/4.4-ийн сэдэв гарчигт «даамлын эрх»;
 *   · асуултын хэлбэр → заалтын төрөл («…чадах уу» → эрх, «…үүрэг» → үүрэг, «болж чадах» → шаардлага);
 *   · хүсэлтийн үг («энгийн үгээр тайлбарлаад өгөөч») BM25-ыг бохирдуулна.
 * Бүтэн корпус дээрх хэмжилт: `npm run ai:eval:norm` (Recall@5 94.8 → 95.4 %, дүрмийн таарц хэвээр, алтан +1).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stemVariants } from '../src/stem.ts';
import { actionPrefix, cuedRuleKinds } from '../src/questionKind.ts';
import { foreignOrgExpansion, isInstructionWord } from '../src/normalize.ts';

test('stemVariants: сул эгшиг, тохиолын залгавар (кирилл + латин)', () => {
  assert.deepEqual(stemVariants('даамал'), ['даамл']);
  assert.deepEqual(stemVariants('даамлыг'), ['даамл', 'даам']);
  assert.deepEqual(stemVariants('Даамлаар'), ['даамл', 'даам']);
  assert.deepEqual(stemVariants('зогсоож'), ['зогсоо']);
  assert.deepEqual(stemVariants('zogsooj'), ['zogsoo']);
  assert.deepEqual(stemVariants('зураг'), ['зург'], '«-г» залгавар гэж язгуурыг таслахгүй');
  assert.deepEqual(stemVariants('үүрэг'), ['үүрг']);
  assert.deepEqual(stemVariants('zahialagchiin'), ['zahialagch'], '«ch» нэг гийгүүлэгч — таслахгүй');
  assert.deepEqual(stemVariants('ажлыг'), [], 'богино язгуур (<4) гаргахгүй');
  assert.deepEqual(stemVariants('2026'), []);
  assert.deepEqual(stemVariants('нар'), []);
});

test('cuedRuleKinds: асуултын хэлбэр → заалтын төрөл', () => {
  const k = (q: string) => [...cuedRuleKinds(q)].sort().join(',');
  assert.equal(k('daamal barilgiin ajliig zogsooj chadah uu'), 'right');
  assert.equal(k('Захиалагч ямар эрхтэй вэ?'), 'right');
  assert.equal(k('bi zahialagch minii gol uureg yu ve'), 'obligation');
  assert.equal(k('Даамал ямар хариуцлага хүлээх вэ?'), 'responsibility');
  assert.equal(k('bi 2 jil ajillasan engineer. daamal bolj chadah uu?'), 'requirement', '«болж чадах» нь эрх БИШ');
  assert.equal(k('Даамлын өгсөн үүрэг даалгавар ажилчдад заавал биелүүлэх үү?'), '', '«үүрэг даалгавар» нь үүрэг биш');
  assert.equal(k('БНбД 11-08-23-ийн 4.20 заалт юу шаарддаг вэ?'), '', '«шаарддаг» ерөнхий хэлбэр');
  assert.equal(k('Энэ ажил эрхэлдэг байгууллага'), '', '«эрхэлдэг» ≠ эрх');
  assert.equal(k('SNiP II-97-76 odoo ch hereglegdej bgaa yum uu? manai tosold ashiglaj boloh uu'), '', 'хүчин төгөлдөр байдлын асуулт');
  assert.equal(k('Цэцэрлэг хэдэн давхар байж болох вэ'), '', '«байж болох» — хэмжээ');
});

test('actionPrefix: «X-ийг ЗОГСООЖ чадах уу» → асуусан үйлдэл', () => {
  assert.equal(actionPrefix('daamal barilgiin ajliig zogsooj chadah uu'), 'zogs');
  assert.equal(actionPrefix('Захиалагч санхүүжилтийг зогсоох эрхтэй юу?'), 'zogs');
  assert.equal(actionPrefix('solongos kompani manai tosliin zurgiig hiij boloh uu'), 'zurg', '«хийж» ерөнхий үйл үг');
  assert.equal(actionPrefix('Сайн байна уу'), null);
});

test('isInstructionWord: хариултын хэлбэрийг хүссэн үг хайлтад орохгүй', () => {
  for (const w of ['tailbarlaad', 'тайлбарлаад', 'engiin', 'ugeer', 'ogooch', 'өгөөч', 'udahgui', 'bna']) assert.equal(isInstructionWord(w), true, w);
  for (const w of ['даамал', 'zogsooj', 'тайлан', 'barilga']) assert.equal(isInstructionWord(w), false, w);
});

test('foreignOrgExpansion: улсын нэр + байгууллага → «гадаадын» (HL05); дангаараа улсын нэр хөндөгдөхгүй', () => {
  assert.deepEqual(foreignOrgExpansion('solongos kompani manai tosliin zurgiig hiij boloh uu'), ['гадаадын']);
  assert.deepEqual(foreignOrgExpansion('Хятадын компани барилгын ажил гүйцэтгэж болох уу'), ['гадаадын']);
  assert.deepEqual(foreignOrgExpansion('Can a Korean company do our design?'), ['гадаадын']);
  assert.deepEqual(foreignOrgExpansion('Орос норм одоо хүчинтэй юу'), [], 'байгууллагын үггүй');
  assert.deepEqual(foreignOrgExpansion('англи хэл дээр баримт бичиг'), []);
  assert.deepEqual(foreignOrgExpansion('gadaadyn kompani zurag hiij boloh uu'), [], 'аль хэдийн «гадаадын»');
});
