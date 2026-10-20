/**
 * МАРШРУТЫН ХААЛГАНУУДЫН ТЕСТ — `routes/compliance.ts` (F1 / F2 / F3 / F7 / F12).
 *
 * Run with:  node --test src/lib/complianceGates.test.ts
 *
 * ⚠️ ЯАГААД ЭНЭ ФАЙЛ БАЙНА ВЭ.  Репо дахь бусад `2-x` тестүүд нь ЦЭВЭР
 *    функцүүдийг л барьдаг («ЭНЭ ФАЙЛ D1-Д ХҮРЭХГҮЙ»).  Гэвч эндхийн ТАВАН
 *    алдааны ГУРАВ нь цэвэр функцэд ОГТ БАЙГААГҮЙ — тэд МАРШРУТЫН УТСАНД
 *    амьдарч байсан:
 *      · F3 — асуулгын параметрийн НЭР зөрсөн (`state` ↔ `review_state`),
 *      · F7 — багийн гишүүнчлэлийн шалгалт ОГТ БАЙХГҮЙ,
 *      · F12 — уншилтын хавчаар дуудагдаагүй.
 *    Тиймээс энэ файл нь Hono-гийн дэд аппыг ХУУРАМЧ D1-тэй ажиллуулна.
 *    Хуурамч D1 нь SQL-ийг ГҮЙЦЭТГЭХГҮЙ — асуулга бүрийг таньж, БЭЛЭН мөр
 *    буцаана; ингэснээр «маршрут ЯМАР асуулга, ЯМАР bind-аар илгээв, юу
 *    буцаав» гэдгийг ЯГ хэмжинэ.  Жинхэнэ SQL-ийн семантик нь энд
 *    шалгагдахгүй (тэр нь D1-ийн ажил) — ХААЛГЫН ЛОГИК шалгагдана.
 *
 * ⚠️ `registerHooks` — `src/lib` ба `src/routes` нь өргөтгөлгүй харьцангуй импорт
 *    хэрэглэдэг тул `node --test` дор шууд `import` УНАНА (tsc ногоон
 *    хэвээр).  `bimEvents.test.ts` / `readiness.test.ts`-ийн ЯГ ИЖИЛ хэв маяг.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { Hono } from 'hono';

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (/^\.{1,2}\//.test(specifier) && !/\.[cm]?[jt]s$/.test(specifier)) {
      return nextResolve(`${specifier}.ts`, context);
    }
    return nextResolve(specifier, context);
  },
});

const complianceRoutes = (await import('../routes/compliance.ts')).default;

/* ================================================================== */
/*  0. ХУУРАМЧ D1 + ХУУРАМЧ АУТЕНТИКАЦ                                 */
/* ================================================================== */

type Row = Record<string, unknown>;
/** Асуулгын текст + bind-ууд → буцаах мөрүүд.  Танихгүй асуулга нь ХООСОН. */
type Reply = (sql: string, binds: unknown[]) => Row[];

interface Call {
  sql: string;
  binds: unknown[];
}

function fakeDb(reply: Reply): { db: unknown; calls: Call[] } {
  const calls: Call[] = [];
  const db = {
    prepare(sql: string) {
      let binds: unknown[] = [];
      const stmt = {
        bind(...b: unknown[]) {
          binds = b;
          return stmt;
        },
        async all() {
          calls.push({ sql, binds });
          return { results: reply(sql, binds), success: true, meta: {} };
        },
        async first() {
          calls.push({ sql, binds });
          return reply(sql, binds)[0] ?? null;
        },
        async run() {
          calls.push({ sql, binds });
          return { success: true, meta: { changes: 0 } };
        },
      };
      return stmt;
    },
    async batch(stmts: unknown[]) {
      return stmts.map(() => ({ results: [], success: true, meta: {} }));
    },
  };
  return { db, calls };
}

interface Viewer {
  sub: number;
  role: string;
}

/** Дэд аппыг ГАНЦААР нь ажиллуулна — `authMiddleware` нь энд ХЭРЭГГҮЙ. */
async function call(
  viewer: Viewer,
  path: string,
  reply: Reply,
): Promise<{ status: number; body: Record<string, unknown>; calls: Call[] }> {
  const { db, calls } = fakeDb(reply);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const app = new Hono<any>();
  app.use('*', async (c, next) => {
    c.set('user', viewer);
    await next();
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  app.route('/', complianceRoutes as any);
  const res = await app.request(path, {}, { DB: db } as never);
  let body: Record<string, unknown> = {};
  const text = await res.text();
  try {
    body = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    body = { __raw: text };
  }
  return { status: res.status, body, calls };
}

const ENGINEER: Viewer = { sub: 11, role: 'engineer' };
const ADMIN: Viewer = { sub: 2, role: 'admin' };
const SENIOR: Viewer = { sub: 7, role: 'senior' };

/** Компанид байгаа бүх багийн код — `knownTeamCodes`-ын хариу. */
const ALL_TEAMS: Row[] = [{ code: 'BA' }, { code: 'BB' }, { code: 'IZ' }];

/** ⚠️ Дуудагч нь ЗӨВХӨН BA-д харьяалагдана — IZ рүү орох эрхгүй. */
const MY_TEAMS: Row[] = [{ code: 'BA' }];

const isTeamsQuery = (sql: string) => /FROM teams\b/.test(sql) && !/user_teams/.test(sql);
const isMembershipQuery = (sql: string) => /FROM user_teams/.test(sql);

/** Ямар ч багийн асуулгыг хариулж, бусдыг ХООСОН буцаах суурь. */
const baseReply: Reply = (sql) => {
  if (isMembershipQuery(sql)) return MY_TEAMS;
  if (isTeamsQuery(sql)) return ALL_TEAMS;
  return [];
};

/* ================================================================== */
/*  1–6. F7 — §82-4 ХӨНДЛӨН-БАГИЙН ДҮРМИЙН БАГЦ                        */
/*                                                                     */
/*  ⚠️ ХЭМЖСЭН УНАЛТ: `/pack`, `/rules`, `/rule-scope` нь ЗӨВХӨН        */
/*     `knownTeamCodes`-ыг шалгадаг байсан тул дурын инженер            */
/*     `?team=IZ` гэж бичээд IZ-ийн БҮТЭН багц, түүний дотор            */
/*     `source_kind = 'company_practice'` ба ЧӨЛӨӨТ БИЧВЭР              */
/*     `practice_origin` бүхий `team_rule_scope` мөрүүдийг татаж        */
/*     чаддаг байв.  `2-0-OWNER-BRIEF.md:439` («шинэ гадаргуу бүр       */
/*     ӨӨРИЙН багийн хамрах хүрээг шалгана») нь `2-2:1273`-ыг ДАРНА.    */
/* ================================================================== */

test('1. F7: гишүүн БИШ багийн `/pack` → 403', async () => {
  const r = await call(ENGINEER, '/pack?team=IZ', baseReply);
  assert.equal(r.status, 403);
  assert.equal(r.body['error'], 'team_not_member');
  // ⚠️ Дүрмийн МӨР рүү ХҮРЭЭГҮЙ байх ёстой — 403 нь асуулгын ДАРАА гарвал
  //    хариу нууц ч, лог нь ил болно.
  assert.ok(
    !r.calls.some((c) => /FROM rules\b/.test(c.sql)),
    '403 өгөхөөс өмнө дүрмийн хүснэгт УНШИГДАЖ БОЛОХГҮЙ',
  );
});

test('2. F7: гишүүн БИШ багийн `/rule-scope` → 403', async () => {
  const r = await call(ENGINEER, '/rule-scope?team=IZ', baseReply);
  assert.equal(r.status, 403);
  assert.ok(
    !r.calls.some((c) => /team_rule_scope/.test(c.sql)),
    '`practice_origin` бүхий мөр УНШИГДАХ ЁСГҮЙ',
  );
});

test('3. F7: гишүүн БИШ багийн `/rules` → 403', async () => {
  const r = await call(ENGINEER, '/rules?team=IZ', baseReply);
  assert.equal(r.status, 403);
});

test('4. F7: ӨӨРИЙН баг нь ХЭВЭЭР ажиллана (add-in эвдэрсэнгүй)', async () => {
  // ⚠️ ЭНЭ ТЕСТ НЬ ЗАСВАРЫН ЭРСДЭЛИЙГ барина: `/pack` нь ~20 Revit
  //    компьютерийн ЦОРЫН ГАНЦ багц татах зам.  Хэт хатуу хаалга нь
  //    нийцлийн шалгалтыг ЧИМЭЭГҮЙ унтраана.
  const r = await call(ENGINEER, '/pack?team=BA', baseReply);
  assert.notEqual(r.status, 403);
  assert.equal(r.status, 200);
});

test('5. F7: ахлагч / админ нь БҮХ багийг харна (аудитын хэрэгцээ)', async () => {
  for (const viewer of [ADMIN, SENIOR]) {
    const r = await call(viewer, '/rule-scope?team=IZ', baseReply);
    assert.notEqual(r.status, 403, `${viewer.role} нь хаагдав`);
  }
});

test('6. F7: `?team=` ӨГӨӨГҮЙ `/rules` нь БҮХ КОМПАНИЙГ цацахгүй', async () => {
  // Хоёр дахь гоожилт: `team` байхгүй үед асуулга нь `WHERE status = ?1`
  //  Л байсан тул НЭГ хүсэлтээр бүх багийн бүх дүрэм гардаг байв.
  const eng = await call(ENGINEER, '/rules', baseReply);
  assert.equal(eng.status, 200);
  const rulesCall = eng.calls.find((c) => /FROM rules\b/.test(c.sql));
  assert.ok(rulesCall, 'дүрмийн асуулга огт хийгдсэнгүй');
  assert.ok(
    /team_code IN \(/.test(rulesCall.sql) || /team_code IS NULL/.test(rulesCall.sql),
    'ахлагч биш дуудагчийн асуулга нь багаар хязгаарлагдаагүй',
  );
  assert.ok(rulesCall.binds.includes('BA'), 'дуудагчийн ӨӨРИЙН баг bind болоогүй');
  assert.ok(!rulesCall.binds.includes('IZ'), 'өөр багийн код bind-д орох ЁСГҮЙ');

  // Ахлагч нь хязгаарлагдахгүй — аудит нь бүтэн харагдацтай.
  const mgr = await call(ADMIN, '/rules', baseReply);
  const mgrCall = mgr.calls.find((c) => /FROM rules\b/.test(c.sql));
  assert.ok(mgrCall);
  assert.equal(mgrCall.binds.length, 1, 'админд багийн шүүлт нэмэгдэх ЁСГҮЙ');
});

/* ================================================================== */
/*  7–10. F3 — ХЯНАЛТЫН ДАРААЛЛЫН ШҮҮЛТ                                */
/*                                                                     */
/*  ⚠️ ХЭМЖСЭН УНАЛТ: `OverridesTab.tsx:213` нь `?state=` илгээдэг,     */
/*     маршрут `?review_state=`-ыг Л уншдаг байсан тул `isReviewState`  */
/*     ХЭЗЭЭ Ч үнэн болохгүй, `WHERE` нь `1 = 1` хэвээр үлдэж, ДӨРВӨН   */
/*     дэд таб ЯГ ИЖИЛ жагсаалт харуулдаг байв — §68-R4-ийн сургалтын   */
/*     хаалганы дараалал нь ДАРААЛАЛ БИШ байлаа.                       */
/* ================================================================== */

const OVERRIDE_ROWS: Row[] = [
  { id: 1, review_state: 'pending', override_kind: 'FALSE_POSITIVE' },
  { id: 2, review_state: 'reviewed', override_kind: 'RULE_WRONG' },
  { id: 3, review_state: 'verified', override_kind: 'FALSE_POSITIVE' },
  { id: 4, review_state: 'rejected', override_kind: 'ACCEPTED_RISK' },
  { id: 5, review_state: 'pending', override_kind: 'DUPLICATE' },
];

/** `o.review_state = ?N` предикатыг ҮНЭХЭЭР хэрэгжүүлдэг хуурамч D1. */
const overrideReply: Reply = (sql, binds) => {
  if (isMembershipQuery(sql)) return MY_TEAMS;
  if (isTeamsQuery(sql)) return ALL_TEAMS;
  if (!/FROM finding_overrides o/.test(sql)) return [];
  const m = /o\.review_state = \?(\d+)/.exec(sql);
  if (!m) return OVERRIDE_ROWS;
  const want = binds[Number(m[1]) - 1];
  return OVERRIDE_ROWS.filter((r) => r['review_state'] === want);
};

const idsOf = (body: Record<string, unknown>): number[] =>
  ((body['overrides'] as Row[] | undefined) ?? []).map((r) => Number(r['id'])).sort();

test('7. F3: ДӨРВӨН дэд таб ДӨРВӨН ӨӨР мөрийн багц буцаана', async () => {
  const seen = new Map<string, string>();
  for (const state of ['pending', 'reviewed', 'verified', 'rejected']) {
    const r = await call(ADMIN, `/overrides?state=${state}`, overrideReply);
    assert.equal(r.status, 200, `${state} таб унав`);
    assert.equal(r.body['applied_review_state'], state, `${state} шүүлт хэрэгжсэнгүй`);
    seen.set(state, JSON.stringify(idsOf(r.body)));
  }
  assert.deepEqual(JSON.parse(seen.get('pending')!), [1, 5]);
  assert.deepEqual(JSON.parse(seen.get('reviewed')!), [2]);
  assert.deepEqual(JSON.parse(seen.get('verified')!), [3]);
  assert.deepEqual(JSON.parse(seen.get('rejected')!), [4]);
  // ⚠️ ГОЛ БАТАЛГАА: дөрвүүлэн нь ЯЛГААТАЙ.  Алдаа давтагдвал дөрвүүлэн
  //    ижил болно (`1 = 1` → бүх мөр).
  assert.equal(new Set(seen.values()).size, 4, 'дэд табууд ИЖИЛ жагсаалт буцаав');
});

test('8. F3: хуучин `?review_state=` нэр ХЭВЭЭР ажиллана', async () => {
  const r = await call(ADMIN, '/overrides?review_state=verified', overrideReply);
  assert.equal(r.body['applied_review_state'], 'verified');
  assert.deepEqual(idsOf(r.body), [3]);
});

test('9. F3: буруу утга нь ЧИМЭЭГҮЙ БҮХ мөр биш — ил `null` гэж хэлнэ', async () => {
  const r = await call(ADMIN, '/overrides?state=хог', overrideReply);
  assert.equal(r.status, 200);
  assert.equal(r.body['applied_review_state'], null, 'хэрэгжээгүй шүүлт нь ИЛ байх ёстой');
  assert.deepEqual(idsOf(r.body), [1, 2, 3, 4, 5]);
});

test('10. F3: `?limit=200` нь ЧИМЭЭГҮЙ таслагдахгүй — хоёр тоо ил гарна', async () => {
  const r = await call(ADMIN, '/overrides?limit=200', overrideReply);
  assert.equal(r.body['limit_requested'], 200);
  assert.equal(r.body['limit'], r.body['limit_max']);
  assert.ok(Number(r.body['limit']) < 200, 'таслалт болоогүй бол тест утгагүй');
});

/* ================================================================== */
/*  11–14. F12 — `GET /findings` ДЭЭР §65-ИЙН ХАВЧААР                  */
/*                                                                     */
/*  ⚠️ ХЭМЖСЭН УНАЛТ: `POST /findings` нь `verdict`-ыг ҮГЧЛЭН хадгалдаг */
/*     тул D1 нь `evidence_level = 'MODEL_DERIVED'` + `verdict =        */
/*     'VIOLATION'` мөр агуулж БОЛНО.  `GET /findings` нь `SELECT` -ийн */
/*     баганыг ШУУД цацдаг байсан тул `2-5` §6-ийн ХОЁР шалгуур унана:  */
/*       · `AI_INFERRED` мөр дээр `citation` нь `null` байх ЁСТОЙ,      */
/*       · `MODEL_DERIVED` мөр дээр `VIOLATION` ХЭЗЭЭ Ч буцахгүй.       */
/* ================================================================== */

const CITATION = JSON.stringify({
  document_uid: 'BNbD-21-01-20',
  clause: '4.2.1',
  edition: '2020',
});

const FINDING_ROWS: Row[] = [
  {
    id: 101,
    finding_uid: 'f-model',
    severity: 'CRITICAL',
    verdict: 'VIOLATION',
    evidence_level: 'MODEL_DERIVED',
    evidence_json: CITATION,
    recommendation_mn: 'Хаалганы өргөнийг ихэсгэ',
    lifecycle_state: 'OPEN',
  },
  {
    id: 102,
    finding_uid: 'f-ai',
    severity: 'HIGH',
    verdict: 'VIOLATION',
    evidence_level: 'AI_INFERRED',
    evidence_json: CITATION,
    recommendation_mn: 'Магадгүй ийм байх',
    lifecycle_state: 'OPEN',
  },
  {
    id: 103,
    finding_uid: 'f-rule',
    severity: 'HIGH',
    verdict: 'VIOLATION',
    evidence_level: 'RULE_BACKED',
    evidence_json: CITATION,
    recommendation_mn: 'Заалтын дагуу засна уу',
    lifecycle_state: 'OPEN',
  },
];

/** LEVEL 2 (RECOMMEND) — `explain` ба `recommend` хоёулаа асаалттай. */
const findingsReply: Reply = (sql) => {
  if (isMembershipQuery(sql)) return MY_TEAMS;
  if (isTeamsQuery(sql)) return ALL_TEAMS;
  if (/FROM app_settings/.test(sql)) {
    return [{ key: 'bim.compliance.authority_level', value: '2' }];
  }
  if (/FROM compliance_findings/.test(sql)) return FINDING_ROWS;
  return [];
};

const byUid = (body: Record<string, unknown>, uid: string): Row => {
  const rows = (body['findings'] as Row[] | undefined) ?? [];
  const hit = rows.find((r) => r['finding_uid'] === uid);
  assert.ok(hit, `${uid} хариултад алга`);
  return hit;
};

test('11. F12: `MODEL_DERIVED` мөр `VIOLATION` гэж ХЭЗЭЭ Ч буцахгүй', async () => {
  const r = await call(ENGINEER, '/findings?project_id=30', findingsReply);
  assert.equal(r.status, 200);
  const row = byUid(r.body, 'f-model');
  assert.notEqual(row['verdict'], 'VIOLATION');
  assert.equal(row['verdict'], 'WARNING', '`MODEL_DERIVED`-ийн тааз нь WARNING');
  // ⚠️ Хадгалагдсан мөр ХӨНДӨГДӨӨГҮЙ — §68-ийн аудитын үндэс ил явна.
  assert.equal(row['raw_verdict'], 'VIOLATION');
  assert.equal(row['verdict_clamped'], true);
});

test('12. F12: `AI_INFERRED` мөрөөс НОРМЫН ЭШЛЭЛ БҮРМӨСӨН хасагдана', async () => {
  const r = await call(ENGINEER, '/findings?project_id=30', findingsReply);
  const ai = byUid(r.body, 'f-ai');
  assert.equal(ai['citation'], null, '`citation` нь `null` байх ЁСТОЙ');
  assert.equal(ai['verdict'], 'UNCERTAIN', 'AI-ийн таамаг нь мэдэгдэл гаргах эрхгүй');
  // ⚠️ ТҮҮХИЙ `evidence_json` нь ХАРИУЛТАД ОРОХГҮЙ.  Илгээгээд «бүү харуул»
  //    гэж хэлэх нь нууц БИШ — хөтчийн сүлжээний таб түүнийг харна.
  for (const row of (r.body['findings'] as Row[]) ?? []) {
    assert.equal(row['evidence_json'], undefined, 'түүхий нотолгоо цацагдав');
  }
});

test('13. F12: `RULE_BACKED` мөр нь эшлэлээ ХЭВЭЭР авна (хавчаар хэт хатуу биш)', async () => {
  const r = await call(ENGINEER, '/findings?project_id=30', findingsReply);
  const ok = byUid(r.body, 'f-rule');
  assert.equal(ok['verdict'], 'VIOLATION');
  assert.equal(ok['verdict_clamped'], false);
  const cite = ok['citation'] as Record<string, unknown> | null;
  assert.ok(cite, 'норм эх сурвалжтай мөрийн эшлэл хасагдав');
  assert.equal(cite['clause'], '4.2.1');
});

test('14. F12: эрхийн түвшин 0 (OBSERVE) үед эшлэл ба зөвлөмж хоёулаа хаагдана', async () => {
  const observeReply: Reply = (sql) => {
    if (/FROM app_settings/.test(sql)) return [];
    return findingsReply(sql, []);
  };
  const r = await call(ENGINEER, '/findings?project_id=30', observeReply);
  const ok = byUid(r.body, 'f-rule');
  assert.equal(ok['citation'], null, 'LEVEL 0 дээр тайлбарлах эрхгүй');
  assert.equal(ok['recommendation_mn'], null);
  assert.equal(ok['recommendation_withheld'], true, 'чимээгүй `null` нь «зөвлөмж алга» гэж уншигдана');
});

/* ================================================================== */
/*  15–18. F1 + F2 — §69-ИЙН ХААЛГА, МАРШРУТЫН УТАС                    */
/*                                                                     */
/*  ⚠️ ХЭМЖСЭН УНАЛТ (F1): `evaluation_state: 'partial'` + бусад бүх    */
/*     зүйл цэвэр → `{"status":"READY","blockers":[]}`.                */
/*  ⚠️ ХЭМЖСЭН УНАЛТ (F2): `evaluationStateFor(db, viewer.sub, …)` нь   */
/*     `detected_by`-оор шүүдэг тул ТӨСЛИЙН хаалганы өнгө ХЭН ХАРЖ      */
/*     БУЙГААС хамаардаг байв.                                         */
/* ================================================================== */

/** Гурван CRITICAL нь ХУУЧИРСАН; бусад бүх зүйл «төгс». */
function staleProjectReply(opts: { staleOwner: number }): Reply {
  return (sql, binds) => {
    if (isMembershipQuery(sql)) return MY_TEAMS;
    if (isTeamsQuery(sql) && /project_team_shares/.test(sql)) {
      return [{ team_code: 'BA', ran: 1 }];
    }
    if (isTeamsQuery(sql)) return ALL_TEAMS;
    if (/GROUP BY severity, verdict/.test(sql)) {
      return [{ severity: 'CRITICAL', verdict: 'VIOLATION', is_stale: 1, n: 3 }];
    }
    // Бүртгэлийн эрүүл мэнд — бүх зүйл цэвэр.
    if (/rows_total/.test(sql)) {
      return [
        {
          rows_total: 40,
          expected_but_inapplicable: 0,
          aborted: 0,
          applicable: 12,
          evaluated: 12,
          unpublished_pack_sessions: 0,
        },
      ];
    }
    // Төслийн үнэлгээний төлөв — `detected_by` ОГТ БАЙХ ЁСГҮЙ.
    if (/rules_published/.test(sql) && /stale_findings/.test(sql)) {
      const scopedToViewer = /detected_by/.test(sql);
      const viewerId = Number(binds[1] ?? 0);
      return [
        {
          rules_published: 12,
          packs_published: 1,
          ledger_rows: 40,
          aborted: 0,
          partial_findings: 0,
          // Хэрэв маршрут ХАРАГЧААР шүүсэн бол зөвхөн эзэн нь 3 харна.
          stale_findings: scopedToViewer ? (viewerId === opts.staleOwner ? 3 : 0) : 3,
        },
      ];
    }
    if (/rule_pack_versions/.test(sql)) {
      return [{ ruleset_version: 'r12.abc123def456', rule_count: 12 }];
    }
    return [];
  };
}

test('15. F1: БҮХ нотолгоо хуучирсан төсөл НОГООН болохгүй', async () => {
  const r = await call(ENGINEER, '/projects/30/readiness', staleProjectReply({ staleOwner: 11 }));
  assert.equal(r.status, 200);
  assert.notEqual(r.body['status'], 'READY', 'гурван хуучирсан CRITICAL дээр «бэлэн» гэв');
  assert.equal(r.body['status'], 'UNKNOWN');
  const blockers = (r.body['blockers'] as { key: string; count: number }[]) ?? [];
  assert.ok(blockers.length > 0, '`blockers[]` ХООСОН үлдэв');
  const stale = blockers.find((b) => b.key === 'readiness.blocker.staleFindings');
  assert.ok(stale, 'хуучирсан нотолгооны хаалт алга');
  assert.equal(stale.count, 3);
});

test('16. F1: хуучирсан ГУРВАН CRITICAL нь тоолуураас ЧИМЭЭГҮЙ алга болохгүй', async () => {
  const r = await call(ENGINEER, '/projects/30/readiness', staleProjectReply({ staleOwner: 11 }));
  // `open_by_severity` нь ШИНЭ мөрийн тоолуур — тэнд 0 байх нь ЗӨВ.
  const open = r.body['open_by_severity'] as Record<string, number>;
  assert.equal(open['CRITICAL'], 0);
  // ⚠️ Гэвч тэдгээр нь ТУСДАА тоолуураар ИЛ гарах ЁСТОЙ.
  const stale = r.body['stale_by_severity'] as Record<string, number>;
  assert.equal(stale['CRITICAL'], 3, 'хуучирсан ноцтой байдал хариултаас алга болов');
  assert.equal(r.body['stale_open_total'], 3);
  assert.equal(r.body['evaluation_state'], 'partial');
});

test('17. F2: хаалганы төлөв ХЭН ХАРЖ БУЙГААС хамаарахгүй', async () => {
  // Хуучирсан мөрүүдийг эзэмшигч (11) ба эзэмшдэггүй ахлах (7) — ХОЁУЛАА
  // ИЖИЛ хариу авах ЁСТОЙ.  Хуучин код `detected_by = ?2` гэж шүүдэг байсан
  // тул 7 нь `checked` → `READY` харж, 11 нь `partial` харна.
  const reply = staleProjectReply({ staleOwner: 11 });
  const owner = await call({ sub: 11, role: 'engineer' }, '/projects/30/readiness', reply);
  const other = await call({ sub: 7, role: 'senior' }, '/projects/30/readiness', reply);
  assert.equal(owner.body['status'], other.body['status'], 'хаалганы өнгө харагчаас хамаарав');
  assert.equal(owner.body['evaluation_state'], other.body['evaluation_state']);
  assert.deepEqual(owner.body['blockers'], other.body['blockers']);
});

test('18. F2: бэлэн байдлын үнэлгээний асуулга `detected_by`-г ОГТ ХЭРЭГЛЭХГҮЙ', async () => {
  const r = await call(ENGINEER, '/projects/30/readiness', staleProjectReply({ staleOwner: 11 }));
  // ⚠️ БҮТЦИЙН БАТАЛГАА.  Дээрх зан үйлийн тест нь өгөгдлөөр тойрч болно;
  //    энэ нь маршрутын БҮХ асуулгыг шалгана: төслийн хаалганы оролт бүр
  //    төсөлд хамаарна, хэрэглэгчид БИШ.
  const leaky = r.calls.filter((c) => /detected_by/.test(c.sql));
  assert.deepEqual(
    leaky.map((c) => c.sql),
    [],
    'бэлэн байдлын хаалганд ХАРАГЧААР шүүсэн асуулга үлдэв',
  );
});

/* ================================================================== */
/*  19–20. §66 — `fp_rate` НЬ 1-ЭЭС ХЭТЭРЧ БОЛОХГҮЙ                     */
/*                                                                     */
/*  ⚠️ ХЭМЖСЭН УНАЛТ: хүртвэр нь `finding_overrides.created_at >=       */
/*     <цонх>` (ХААСАН хугацаа), хуваарь нь                            */
/*     `compliance_findings.first_detected_at >= <цонх>` (ИЛРҮҮЛСЭН     */
/*     хугацаа) байсан тул 40 хоногийн өмнөх олдворыг ӨНӨӨДӨР хаахад   */
/*     тэр нь ЗӨВХӨН ХҮРТВЭРТ орж, самбар «худал дохио 150%» гэж бичнэ. */
/* ================================================================== */

/** Хуурамч D1: хүртвэр нь хуваарийн ХЯЗГААРЫГ дагасан эсэхээр хариулна. */
const qualityReply: Reply = (sql) => {
  if (isMembershipQuery(sql)) return MY_TEAMS;
  if (isTeamsQuery(sql)) return ALL_TEAMS;
  // Хуваарь: цонх дотор илэрсэн, `PASS` биш HIGH олдвор — ХОЁР.
  if (/GROUP BY severity, issue_class/.test(sql)) {
    return [{ severity: 'HIGH', issue_class: 'geometry', n: 2 }];
  }
  if (/FROM finding_overrides o/.test(sql) && /JOIN compliance_findings/.test(sql)) {
    // Холбоос ба цонх байгаа тул ЗӨВХӨН хуваарьт байгаа мөр тоологдоно.
    const scoped =
      /f\.first_detected_at >= datetime\('now', \?1\)/.test(sql) &&
      /COUNT\(DISTINCT o\.finding_id\)/.test(sql) &&
      /f\.verdict <> 'PASS'/.test(sql);
    return [{ severity: 'HIGH', n: scoped ? 1 : 3 }];
  }
  // Хуучин (засваргүй) хэлбэр — холбоосгүй.  Тест унах ЁСТОЙ.
  if (/FROM finding_overrides/.test(sql) && /FALSE_POSITIVE/.test(sql)) {
    return [{ severity: 'HIGH', n: 3 }];
  }
  return [];
};

test('19. §66: `fp_rate` нь 1-ээс ХЭТЭРЭХГҮЙ', async () => {
  const r = await call(ADMIN, '/quality?days=30', qualityReply);
  assert.equal(r.status, 200);
  const rates = r.body['fp_rate'] as Record<string, { value: number | null; measured: boolean }>;
  const high = rates['HIGH'];
  assert.ok(high, 'HIGH харьцаа алга');
  assert.equal(high.measured, true);
  assert.ok(high.value !== null && high.value <= 1, `худал дохионы харьцаа ${high.value} > 1`);
});

test('20. §66: худал дохионы асуулга нь ХУВААРИЙН олонлогт ХАЗААРЛАГДСАН', async () => {
  // ⚠️ БҮТЦИЙН БАТАЛГАА — зан үйлийн тест нь өгөгдлөөр тойрч болно.
  const r = await call(ADMIN, '/quality?days=30', qualityReply);
  const fpCall = r.calls.find(
    (c) => /FROM finding_overrides/.test(c.sql) && /FALSE_POSITIVE/.test(c.sql) && /GROUP BY/.test(c.sql),
  );
  assert.ok(fpCall, 'худал дохионы асуулга хийгдсэнгүй');
  assert.ok(/JOIN compliance_findings/.test(fpCall.sql), 'хүртвэр нь олдвортой холбогдоогүй');
  assert.ok(
    /f\.first_detected_at >= datetime\('now', \?1\)/.test(fpCall.sql),
    'хүртвэр нь ХУВААРИЙН цонхыг дагаагүй',
  );
  assert.ok(
    /COUNT\(DISTINCT o\.finding_id\)/.test(fpCall.sql),
    'нэг олдворыг хоёр удаа хаасан нь ХОЁР худал дохио БИШ',
  );
});
