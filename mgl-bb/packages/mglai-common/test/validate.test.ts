import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hasUnnaturalMongolian, validateAnswer, REPAIR_PROMPT_MN } from '../src/turn/validate.ts';

test('shared validator repairs strong unnatural Mongolian without flagging normal AEC text', () => {
  const bad = [
    'Төсөл нь 53.15% үнэлгээтэй байна.',
    'Энэ нь хамгийн баруун deadline байна.',
    'Төсөл удааширсан нь шалтгаануудын хүчин зүйлсээс болсон.',
  ];
  for (const s of bad) {
    assert.equal(hasUnnaturalMongolian(s), true, s);
    const r = validateAnswer(s, 'mn-Cyrl');
    assert.ok(r.issues.includes('unnatural_mongolian'), s);
    assert.equal(r.needsRepair, true, s);
  }

  const good = 'Төслийн явц 53.2% байна. Deadline ойртсон тул хоцорсон task-уудаа эхэлж шалгана.';
  assert.equal(hasUnnaturalMongolian(good), false);
  assert.equal(validateAnswer(good, 'mn-Cyrl').needsRepair, false);
});

test('repair prompt preserves engineering facts while improving Mongolian', () => {
  assert.match(REPAIR_PROMPT_MN, /БАЙГАЛИЙН МОНГОЛ/);
  assert.match(REPAIR_PROMPT_MN, /тоо, огноо, хувь, нормын код, нэгж, эшлэл/);
  assert.match(REPAIR_PROMPT_MN, /ШИНЭ мэдээлэл/);
});
