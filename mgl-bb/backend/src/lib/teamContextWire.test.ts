/**
 * БАГИЙН КОНТЕКСТИЙН УТСАН ГЭРЭЭ — СЕРВЕР ↔ C# ADD-IN.
 *
 * Run with:  node --test src/lib/teamContextWire.test.ts
 *
 * ⚠️ ЯАГААД ЭНЭ ФАЙЛ БАЙНА ВЭ.  `2-1-team-context` сесс СЕРВЕРИЙН талыг
 *    (`lib/teamContext.ts`, `routes/revit.ts`-ийн хоёр handler, `TeamContext.cs`)
 *    бичээд КЛИЕНТИЙН талыг ДУУСГААГҮЙ: `grep -c "RefreshTeamContextSoon"
 *    AssistantPane.xaml.cs` нь **0** байв.  Үр дүнд нь `TeamContext.Current`-ыг
 *    хэн ч бичдэггүй, `%APPDATA%\RevitMcpAddin\team-context.json` ХЭЗЭЭ Ч
 *    үүсдэггүй, `ChipText` / `IsUncertain` / `ShouldRefresh` / `IsStale` /
 *    `FromResult` бүгд ҮХМЭЛ код байлаа.
 *
 * ⚠️ ЭНЭ ТЕСТ КОД АЖИЛЛУУЛДАГГҮЙ — C# нь `node --test` дор ажиллахгүй, мөн
 *    add-in-д C# тест ТЭГ.  Тиймээс энэ нь ЭХ КОДЫН ГЭРЭЭГ барина: JSON
 *    талбарын нэр, дуудлагын цэгийн ТОО, ба thread-ийн ⛔ хоригууд.  Ийм
 *    тест нь ЯГ ТЭР УНАЛТЫГ барина: сервер талбараа сольбол `[JsonPropertyName]`
 *    нь чимээгүй `null` болж, chip хоосон үлдэнэ — задлах алдаа ГАРАХГҮЙ.
 *
 * ⚠️ `registerHooks` — `src/lib/*.ts` нь өргөтгөлгүй харьцангуй импорт
 *    хэрэглэдэг тул `node --test` дор шууд `import` УНАНА (tsc ногоон хэвээр).
 *    `bimEvents.test.ts` / `rulePackWire.test.ts`-ийн ЯГ ИЖИЛ хэв маяг.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (/^\.{1,2}\//.test(specifier) && !/\.[cm]?[jt]s$/.test(specifier)) {
      return nextResolve(`${specifier}.ts`, context);
    }
    return nextResolve(specifier, context);
  },
});

const TC = await import('./teamContext.ts');

const HERE = dirname(fileURLToPath(import.meta.url));
const ADDIN = join(HERE, '..', '..', '..', 'revit-mcp', 'addin');
const ROUTES = join(HERE, '..', 'routes');

const read = (dir: string, file: string): string => readFileSync(join(dir, file), 'utf8');

/**
 * C# тайлбарыг хасна.
 *
 * ⚠️ ЗААВАЛ.  Энэ файлын ⛔ хоригууд нь `SetBusy`, `MGMT`, `.Show()` гэх
 *    мэт тэмдэгт мөрийг ХАЙДАГ, гэтэл ЯГ ТЭР үгс нь add-in дотор
 *    «БҮҮ ХЭРЭГЛЭ» гэсэн тайлбарт бичигдсэн байдаг.  Тайлбарыг хасахгүй
 *    бол тест нь өөрийнхөө анхааруулгыг зөрчил гэж уншина.
 * ⚠️ `//`-ыг ЗӨВХӨН `:` эсвэл хашилтын АРД БИШ үед л таслана — эс бөгөөс
 *    `"https://..."` мөрийг тайлбар гэж үзээд араас нь ирэх кодыг НУУНА.
 */
function stripCs(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:"'])\/\/.*/g, '$1');
}

const REVIT_API = read(ADDIN, 'RevitApi.cs');
const QTO_DTOS = read(ADDIN, 'QtoDtos.cs');
const API_CLIENT = read(ADDIN, 'ApiClient.cs');
const PANE_CS = read(ADDIN, 'AssistantPane.xaml.cs');
const PANE_XAML = read(ADDIN, 'AssistantPane.xaml');
const TEAM_CONTEXT_CS = read(ADDIN, 'TeamContext.cs');
const REVIT_ROUTE = read(ROUTES, 'revit.ts');

/**
 * `class <name> { ... }`-ийн БИЕ (эхний тэнцүү хаалт хүртэл).
 * ⚠️ Регексээр бүхэл файлаас `JsonPropertyName` түүх нь ХОЁР ӨӨР DTO-г
 *    хольж, зөрсөн нэрийг барихгүй өнгөрөөнө.
 */
function csClassBody(src: string, name: string): string {
  const at = src.indexOf(`class ${name}`);
  assert.notEqual(at, -1, `C# анги олдсонгүй: ${name}`);
  const open = src.indexOf('{', at);
  assert.notEqual(open, -1, `${name}-ийн бие олдсонгүй`);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') {
      depth--;
      if (depth === 0) return src.slice(open, i);
    }
  }
  assert.fail(`${name}-ийн хаалт тэнцээгүй`);
}

/** Тухайн ангийн бүх `[JsonPropertyName("x")]`. */
function jsonNames(src: string, cls: string): string[] {
  const body = csClassBody(src, cls);
  return [...body.matchAll(/JsonPropertyName\("([^"]+)"\)/g)].map((m) => m[1] as string);
}

/* ================================================================== */
/*  1. GET /team-context — хариу ба C# DTO нь ИЖИЛ нэртэй              */
/* ================================================================== */

/**
 * Серверийн `TeamContextView` нь `routes/revit.ts`-д ЗАРЛАГДСАН interface.
 * Түүнээс талбарын нэрсийг гаргаж, C#-ийн `TeamContextResult`-той тулгана.
 */
function serverViewFields(): string[] {
  const at = REVIT_ROUTE.indexOf('interface TeamContextView');
  assert.notEqual(at, -1, 'routes/revit.ts дотор TeamContextView алга');
  const open = REVIT_ROUTE.indexOf('{', at);
  const close = REVIT_ROUTE.indexOf('\n}', open);
  const body = REVIT_ROUTE.slice(open, close);
  // Тайлбаруудыг хаяад л «нэр:» хэлбэрийн мөрүүдийг цуглуулна.
  return body
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => !l.startsWith('*') && !l.startsWith('/'))
    .map((l) => /^([a-z_]+)\s*:/.exec(l))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => m[1] as string);
}

test('TeamContextResult нь серверийн TeamContextView-ийн БҮХ талбарыг бинддэг', () => {
  const server = serverViewFields();
  // Гэрээ бодитой эсэхийг эхлээд өөрийг нь батал — хоосон жагсаалт бүх
  // зүйлийг «даруй ногоон» болгоно.
  assert.ok(server.length >= 9, `TeamContextView-ээс ${server.length} талбар л уншигдав`);
  assert.ok(server.includes('team_code'));
  assert.ok(server.includes('scopes'));

  const client = jsonNames(REVIT_API, 'TeamContextResult');
  for (const f of server) {
    assert.ok(
      client.includes(f),
      `RevitApi.TeamContextResult нь "${f}"-ыг биндэхгүй — chip чимээгүй хоосон болно`,
    );
  }
});

test('TeamContextResult нь АМЬД РОСТЕР ба verify-ийн хоёр талбарыг мөн биндэнэ', () => {
  const client = jsonNames(REVIT_API, 'TeamContextResult');
  // `teams` нь `teamView`-д БАЙХГҮЙ — handler нь тусад нь залгадаг
  // (`{ ...teamView(...), teams: res.teams }`).  Клиент багийн ТООГ хатуу
  // бичихгүйн тулд ЗААВАЛ энэ жагсаалтаас сонгогчоо барина (⛔ хориг 11).
  assert.ok(client.includes('teams'));
  assert.ok(client.includes('verified_via'));
  assert.ok(client.includes('sticky'));
  assert.ok(REVIT_ROUTE.includes('teams: res.teams'), 'сервер `teams`-ыг залгахаа больжээ');
});

test('TeamRosterDto нь TeamRosterRow-ийн гурван талбартай ЯГ таарна', () => {
  const client = jsonNames(REVIT_API, 'TeamRosterDto');
  assert.deepEqual(client.sort(), ['code', 'name_mn', 'sort_order']);
});

test('TeamCandidateDto нь candidates[]-ийн гурван талбартай ЯГ таарна', () => {
  const client = jsonNames(REVIT_API, 'TeamCandidateDto');
  assert.deepEqual(client.sort(), ['confidence', 'source', 'team_code']);
});

/* ================================================================== */
/*  2. Шатны НЭР — сервер нэмбэл chip «тодорхойгүй» гэж ХУДЛАА хэлнэ    */
/* ================================================================== */

test('TeamContext.SourceLabel нь TEAM_SOURCES-ийн БҮХ утгыг мэднэ', () => {
  for (const src of TC.TEAM_SOURCES) {
    assert.ok(
      TEAM_CONTEXT_CS.includes(`case "${src}":`),
      `SourceLabel нь "${src}"-ыг мэдэхгүй — шинэ шат нэмэгдвэл chip «тодорхойгүй» гэж ХУДЛАА хэлнэ`,
    );
  }
});

/* ================================================================== */
/*  3. Клиентийн хоёр гарц ба тэдгээрийн ХУГАЦАА                        */
/* ================================================================== */

test('RevitApi нь team-context-ийн хоёр гарцтай', () => {
  assert.ok(REVIT_API.includes('GetTeamContextAsync'));
  assert.ok(REVIT_API.includes('VerifyTeamAsync'));
  assert.ok(REVIT_API.includes('"/api/revit/team-context?doc_uid="'));
  assert.ok(REVIT_API.includes('"/api/revit/team-context/verify"'));
});

test('⛔ team-context нь 180 секундын ApiClient.Http дээр ЯВАХГҮЙ', () => {
  const at = REVIT_API.indexOf('private static async Task<T> SendShortAsync');
  assert.notEqual(at, -1, 'SendShortAsync алга');
  const body = REVIT_API.slice(at, REVIT_API.indexOf('GetTeamContextAsync'));
  assert.ok(body.includes('AiHttp.Http'), '20 секундын тээвэр хэрэглэгдээгүй');
  assert.ok(body.includes('CancellationTokenSource'), '5 секундын таслалт алга');
  assert.ok(!body.includes('ApiClient.Http'), 'chip нь гурван минут дүүжлэгдэж болно');
  // ⚠️ `RequestTimeoutSec = 5` нь ХОЁР дуудлагад ХОЁУЛАА өгөгдсөн байх ёстой.
  const uses = [...REVIT_API.matchAll(/,\s*TeamContext\.RequestTimeoutSec\)/g)].length;
  assert.equal(uses, 2, 'GET ба verify хоёулаа 5 секундын хувингаар явах ёстой');
});

/* ================================================================== */
/*  4. Самбарын утас — 2-1-ийн хүлээн авах шалгуур                      */
/* ================================================================== */

test('AssistantPane нь RefreshTeamContextSoon-ыг зарлаж БАС дууддаг', () => {
  const n = [...PANE_CS.matchAll(/RefreshTeamContextSoon/g)].length;
  // 2-1 §5-ийн шалгуур: тодорхойлолт + ЯГ нэг дуудлагын цэг.
  assert.equal(n, 2, `RefreshTeamContextSoon нь ${n} удаа таарлаа, 2 байх ёстой`);
  assert.ok(PANE_CS.includes('private void SetTeamChip(TeamContext.State s)'));
  assert.ok(PANE_XAML.includes('x:Name="TeamChip"'));
  assert.ok(PANE_XAML.includes('x:Name="TeamChipText"'));
});

test('TeamContext.Current ба кэш нь самбараас БОДИТООР бичигдэнэ', () => {
  assert.ok(PANE_CS.includes('TeamContext.Current = fresh'));
  assert.ok(PANE_CS.includes('TeamContext.SaveCache(fresh)'));
  assert.ok(PANE_CS.includes('TeamContext.FromResult('));
});

test('дүрмийн багцтай эсэх нь СЕРВЕРИЙН scopes-оос гарна, багцын ЖАГСААЛТААС БИШ', () => {
  assert.ok(PANE_CS.includes('r.Scopes != null && r.Scopes.Contains("TEAM")'));
  // ⛔ хориг 11 — багийн код клиентэд ХАТУУ бичигдэхгүй.
  const code_ = stripCs(PANE_CS);
  for (const code of ['MGMT', '"EZ"', '"GT"', '"BA"']) {
    assert.ok(
      !code_.includes(code),
      `AssistantPane.xaml.cs-д багийн код (${code}) хатуу бичигджээ — ростер серверээс ирнэ`,
    );
  }
});

/* ================================================================== */
/*  5. ⛔ THREADING — 2-1-ийн 7/8/9/10-р хоригууд                       */
/* ================================================================== */

/** `RefreshTeamContextSoon`-оос эхлээд chip-ийн бүх хэсэг. */
function teamRegion(): string {
  const at = PANE_CS.indexOf('private void SetTeamChip');
  assert.notEqual(at, -1);
  const end = PANE_CS.indexOf('Жагсаалт хоосон байх ГУРВАН өөр шалтгааныг', at);
  assert.notEqual(end, -1, 'багийн блокийн төгсгөл олдсонгүй');
  return stripCs(PANE_CS.slice(at, end));
}

test('⛔ багийн блок нь Dispatcher.Invoke (синхрон) ХЭРЭГЛЭХГҮЙ', () => {
  const region = teamRegion();
  // `Dispatcher.Invoke(` нь түгжээ барьсан thread-ээс дуудагдвал deadlock;
  // зөвхөн `InvokeAsync` (галт-мартах) зөвшөөрөгдөнө.
  assert.ok(!/Dispatcher\.Invoke\s*\(/.test(region), 'синхрон marshalling = deadlock');
  assert.ok(region.includes('Dispatcher.InvokeAsync('));
});

test('⛔ багийн блок нь SetBusy, DockablePane.Show, ChangeTracker.Gate-д ХҮРЭХГҮЙ', () => {
  const region = teamRegion();
  assert.ok(!region.includes('SetBusy'), 'Mouse.OverrideCursor нь АППЛИКЕЙШН ДАМЖСАН');
  assert.ok(!region.includes('DockablePane'), 'автомат нээлт = R7-ийн эвдрэл');
  assert.ok(!region.includes('.Show()'), 'ЦОРЫН ГАНЦ Show() нь ribbon команд');
  assert.ok(!region.includes('ChangeTracker'), 'Gate-ийг арын thread барих ЁСГҮЙ');
});

test('багийн контекст нь DocumentChanged-ээс БИШ, ReloadAsync-аас дуудагдана', () => {
  const at = PANE_CS.indexOf('RefreshTeamContextSoon(docUid);');
  assert.notEqual(at, -1, 'дуудлагын цэг алга');
  const reload = PANE_CS.indexOf('private async Task ReloadAsync');
  const setBusyFalse = PANE_CS.indexOf('SetBusy(false);', reload);
  assert.ok(reload !== -1 && at > reload && at < setBusyFalse,
    'дуудлага нь ReloadAsync-ийн ДОТОР байх ёстой');
});

/* ================================================================== */
/*  6. authority_level — үхмэл дугуй байсныг барина                     */
/* ================================================================== */

test('POST /api/revit/health нь authority_level-ыг ИЛГЭЭНЭ (сервер түүнийг bind-даг)', () => {
  // Сервер тал: багана ба bind нь ҮНЭХЭЭР байна.
  assert.ok(REVIT_ROUTE.includes('authority_level = excluded.authority_level'));
  assert.ok(REVIT_ROUTE.includes('str(b.authority_level, 8)'));
  // Клиент тал: 2026-08-31 хүртэл ЭНЭ МӨР БАЙГААГҮЙ тул багана бүр NULL байв.
  const at = API_CLIENT.indexOf('PostHealthAsync');
  assert.notEqual(at, -1);
  const body = API_CLIENT.slice(at);
  assert.ok(
    body.includes('authority_level = CachedAuthorityLevel()'),
    'PostHealthAsync нь authority_level илгээхгүй — addin_installs.authority_level мөнхөд NULL',
  );
});

test('AddinSettings нь authority_level ба team_override хоёрыг хадгална', () => {
  const names = jsonNames(QTO_DTOS, 'AddinSettings');
  assert.ok(names.includes('authority_level'));
  assert.ok(names.includes('team_override'));
});

test('эрхийн түвшний кэшийг ҮНЭХЭЭР дүүргэдэг бичигч байна', () => {
  assert.ok(API_CLIENT.includes('RefreshAuthorityLevelAsync'));
  assert.ok(API_CLIENT.includes('"/api/learning/settings"'));
  // Сервер тэр талбарыг ҮНЭХЭЭР гаргадаг эсэх — суваг хоёр талдаа бүтэн үү.
  const learning = read(ROUTES, 'learning.ts');
  assert.ok(learning.includes('authority_level: cc.authorityLevel'));
  // Дуудагдаж байгаа эсэх: бичигчгүй кэш нь `null`-ээс ялгаагүй.
  assert.ok(PANE_CS.includes('RefreshAuthorityLevelAsync(st.ApiHost, st.Token)'));
});

test('CachedAuthorityLevel нь НЭГ ЦЭВЭР ЦИФРЭЭС өөр юуг ч илгээхгүй', () => {
  const at = API_CLIENT.indexOf('private static string CachedAuthorityLevel');
  assert.notEqual(at, -1);
  const body = API_CLIENT.slice(at, API_CLIENT.indexOf('RefreshAuthorityLevelAsync', at));
  // '0x2' → 2 (RECOMMEND) гэж гулсахаас сэргийлсэн хамгаалалт.
  assert.ok(body.includes("raw.Length != 1"), 'урт мөр шүүгдэхгүй байна');
  assert.ok(body.includes("raw[0] < '0' || raw[0] > '5'"), '0..5-ийн хязгаар алга');
  // Хог утга нь 0 (OBSERVE) БИШ, `null` (мэдэгдэхгүй) руу унана.
  assert.ok(body.includes('return null;'));
});
