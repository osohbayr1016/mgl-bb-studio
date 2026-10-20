# 1B-3-assistant-log-provenance — assistant_logs provenance — model_version, addin_version, client_ts

> **Track:** 1B — Өгөгдлийн бүрэн бүтэн байдал (Data Integrity), зүйл 3
> **Хамаарал (depends on):** Байхгүй. Энэ бол 1B-ийн бие даасан эхлэл. Зөвхөн migration дугаарыг **1B-1 ба 1B-7**-тай зөвшилцөнө.
> **Блоклож буй (blocks):** **1C БҮХЭЛДЭЭ** (latency instrumentation — ямар хувилбар ямар хугацаа зарцуулсныг ялгах багана байхгүй), **1B-4** (offline cross-validation-ийн хазайлт), мөн ямар ч A/B, drift detection, «шинэ загвар бодит урсгал дээр мууджээ юу?» гэсэн асуулт.
> **Хөндөх файлууд:**
> `backend/migrations/0201_assistant_log_provenance.sql` (ШИНЭ) ·
> `backend/src/lib/assistantLogInsert.ts` (ШИНЭ) ·
> `backend/src/lib/assistantLogInsert.test.ts` (ШИНЭ) ·
> `backend/src/routes/revit.ts` (mapper + INSERT + bind арифметик, мөр 1652–1740)
> **Deploy тоо:** **2** — (1) `d1 migrations apply --remote`, (2) `wrangler deploy`. Эдгээрийг НЭГ алхам болгож нэгтгэхийг ХОРИГЛОНО.

---

## 0. ЭНЭ СЕССИЙН ДҮРЭМ

**Хамрах хүрээ (scope).** Дээрх 4 файлаас өөр ЮУГ Ч бүү үүсгэ, засах, устга. C# add-in-д (`revit-mcp/addin/**`) энэ сесс **нэг ч мөр бичихгүй** — тэр бүхэн 1C-ийн нэг цулгуй add-in гаралтад багтана. Frontend-д ажил байхгүй.

**Бусад агентуудтай зэрэгцэн ажиллах.** Энэ repo дээр олон хөгжүүлэгч ЗЭРЭГ ажиллана. Working tree-д яг одоо өөр хүний дуусаагүй, эмхэтгэгдэхгүй байж болох өөрчлөлт байж болно.

- `git restore`, `git checkout --`, `git stash`, өөрийн биш файлыг `git add` — **ХЭЗЭЭ Ч БҮҮ ХИЙ.**
- `tsc --noEmit` бүтэн repo-г шалгадаг тул чиний хөндөөгүй файл дээр унаж болно. Алдаанууд **зөвхөн хамааралгүй файлд** байгааг баталж, тэр саадыг **эзэнд мэдэгд** — өөрөө бүү зас.
- Хэрэв чиний хамаарах файл (жишээ нь `routes/revit.ts`) өөр агентын WIP-ээс болж эвдэрсэн бол **зогсоод асуу**, өөрөө «дуусгах» гэж бүү оролд.

**Deploy хийж болох уу?** Тийм — гэхдээ ЗӨВХӨН §5-ийн дарааллаар, ба зөвхөн эзэн зөвшөөрсний дараа. Deploy нь CI биш, ЛОКАЛ wrangler.

**ХӨНДӨХГҮЙ (programme-wide, энэ сессэд шууд хамаарна):**

- `verifyToken` / `authMiddleware`-ийг `purpose === 'mcp'` татгалзахаар **ХЭЗЭЭ Ч БҮҮ чангатга.** Add-in бүх REST дуудлагаа тэр токеноор хийдэг, refresh урсгал БАЙХГҮЙ. Энэ бол алсаас сэргээх боломжгүй ГАНЦ өөрчлөлт (~20 PC, `Install.bat`, Revit хаалттай).
- `users` ба `projects` хүснэгтийг `migrations apply`-аар **ХЭЗЭЭ Ч БҮҮ дахин бүтээ** (27 ба 38 CASCADE хүүхэдтэй). Энэ ажилд шаардлагагүй.
- Шинэ багана нь түүнийг УНШИХ кодоос **ХАТУУ ӨМНӨХ** deploy-д гарах ёстой.

---

## 1. КОНТЕКСТ

### Системийн товч (хүйтэн сессэд хангалттай)

| Хэсэг | Юу вэ |
|---|---|
| `backend/` | Cloudflare Worker. Default export нь **`@cloudflare/workers-oauth-provider`**, Hono нь түүний `defaultHandler`. D1 (SQLite) + R2 (`MEDIA_BUCKET` нийтийн / `MEETING_BUCKET` хаалттай) + KV + нэг Durable Object (`MglMcpAgent`). |
| `frontend/` | Vite + React 19 SPA, Cloudflare Pages төсөл **`mgl-design-system`** (`--project-name mgl-design-system` ЗААВАЛ ил дамжуулна). Энэ ажилд хамааралгүй. |
| `revit-mcp/addin/` | Revit 2024–2027 add-in, C#/WPF, in-process, 47 файл ~16k мөр, **тест ТЭГ**, ажилтны PC дээр **автомат шинэчлэлт БАЙХГҮЙ**. |
| `revit-mcp/training/` | Python intent-classifier сургалтын pipeline (`train_intent.py`, `pull_and_retrain.py`), git-д хянагддаг. |
| `revit-mcp/server/`, `revit-mcp/agent/` | Python MCP bridge ба бие даасан локал агент. Энэ ажилд хамааралгүй. |
| Хэмжээ | ~49 идэвхтэй мэдлэгийн ажилтан. Продакшн D1 = 45 MB / 114 хүснэгт; хамгийн том нь `progress_entries` 8,062 мөр. |

### Платформын ХАТУУ хязгаарлалт (энэ ажилд шууд хамаарах нь)

1. **D1: нэг statement-д дээд тал нь 100 bind параметр.** Тохируулсан жишээ: `backend/src/routes/qto.ts:832` — `// Fact insert — 4 мөр/statement (21 bind × 4 = 84 ≤ D1-ийн 100 bind хязгаар)`.
2. **Migration нь ЗӨВХӨН НЭМЭГДЭНЭ (append-only).** `backend/migrations/`-д 190 файл, хамгийн өндөр нь `0200_assistant_feedback_note.sql`. Хэрэглэгдсэн файлыг засах нь продакшн дээр **чимээгүй no-op**. Дундуур унасан миграци сан-г хагас байдалд үлдээх ба цорын ганц хууль ёсны засвар нь **ШИНЭ дугаар**.
3. Бүх `CREATE TABLE` / `CREATE INDEX` нь `IF NOT EXISTS`-тэй байх ёстой.
4. **БАЙГАА хүснэгт дээрх `ALTER`-ыг migration блокийн ЭХЭНД** тавь — унавал хоосон хүснэгт үүсэхээс өмнө таслагдана.
5. D1 нь runtime дээр FK-г **хэрэгжүүлдэггүй**, ГЭВЧ `wrangler d1 migrations apply` файл бүрийг транзакцид ороодог ба тэнд `ON DELETE CASCADE` **АЖИЛЛАНА**.
6. wrangler нь нийлмэл statement-ийг **том/жижиг ялгадаг** төгсгөгчөөр таслах ба өмнө нь хоосон зай шаардана: `END;` гэж ТОМ үсгээр, өөрийн мөрөнд бич. (Энэ ажилд шаардлагагүй — trigger бичихгүй.)
7. **190 migration файлд `CREATE TRIGGER`, `CREATE VIEW`, `GENERATED ALWAYS`, `json_extract` нь ТЭГ удаа** тааралдана (баталгаажсан: `grep -rlin` хоосон буцав). Эдгээрийн аль нэгийг ашиглах бол эхлээд хаягдах remote D1 дээр батал.
8. **Deploy нь ЛОКАЛ wrangler, CI биш** — GitHub workflow хоёулаа үхсэн. `npx wrangler deploy --config wrangler.toml`; `--config` нь ЗААВАЛ (repo root дээрх төөрөгдүүлсэн `wrangler.jsonc` өөр worker зарладаг). `wrangler deploy` нь typecheck **ХИЙХГҮЙ** — `tsc --noEmit`-ыг өөрөө ажиллуул.
9. Бүх `wrangler pages` дэд командыг `npx -y wrangler@latest`-аар ажиллуул (энэ ажилд шаардлагагүй).

### Яагаад энэ ажил байх ёстой вэ

Revit туслахын санаа таних ангилагч (intent classifier) нь API/LLM/интернэтгүйгээр add-in дотор ажиллана. Түүний **цорын ганц** сайжруулах гогцоо нь: add-in → `assistant_logs` → шошголох → `assistant_examples` → Python сургалт → `assistant_models`.

**Гогцоо тасарсан.** `assistant_logs` мөр нь **аль загвар түүнийг гаргасныг МЭДЭХГҮЙ.** Үр дагавар:

- **A/B боломжгүй.** Хоёр загварыг бодит урсгал дээр харьцуулах арга байхгүй.
- **Drift илрүүлэх боломжгүй.** «Энэ 7 хоногт `unknown` руу унах хувь өссөн үү?» гэдгийг хувилбараар задалж чадахгүй.
- **Регрессийг олж чадахгүй.** Шинэ загвар идэвхжүүлсний дараа муудсан эсэхэд хариулах өгөгдөл байхгүй.

Өнөөдөр загварын чанарын **ЦОРЫН ГАНЦ** тоо нь `assistant_models.accuracy` — `revit-mcp/training/train_intent.py:269-276`-ийн офлайн cross-validation (`RepeatedStratifiedKFold(n_splits=n_splits, n_repeats=5, random_state=42)` + `cross_val_score`, гаралт `:307-308`). Тэр тоо нь **өөрөө хазайлттай** (шалтгааныг 1B-4 үзнэ үү: сургалтын багц нь шошголсон бодит хэрэглээнээс бүрддэг, шошголох сонголт нь өөрөө шүүлт). Тиймээс бодит урсгал дээрх ганц ч бодитой чанарын хэмжүүр байхгүй.

**Хамгийн онцлох баримт: add-in АЛЬ ХЭДИЙН `model_version`-ыг ИЛГЭЭЖ БАЙНА.** Сервер түүнийг унших ч үгүй, багана ч байхгүй тул өгөгдөл нь **өдөр бүр хаягдаж байна**. Энэ бол хөтөлбөрийн хамгийн бага өртөгтэй, хамгийн өндөр өгөөжтэй схемийн засвар.

---

## 2. БАТАЛГААЖСАН ОДООГИЙН ЗАН ТӨЛӨВ

> Доорх мөр бүрийг 2026-08-27-нд файлыг нээж баталсан.

### 2.1 Add-in АЛЬ ХЭДИЙН `model_version` ба клиентийн цагийг илгээдэг

`revit-mcp/addin/AssistantLog.cs`, `AssistantLogEntry` DTO:

| Мөр | Код |
|---|---|
| 18 | `[JsonPropertyName("ts")] public string Ts { get; set; }` |
| 41 | `[JsonPropertyName("model_version")] public string ModelVersion { get; set; }` |
| 43 | `[JsonIgnore] public bool Sent { get; set; }` |

Хаана дүүргэгддэг — `AssistantLog.Record(...)`, мөр 173–186:

```csharp
var e = new AssistantLogEntry
{
    Id = Guid.NewGuid().ToString("N").Substring(0, 16),   // 175
    Ts = DateTime.UtcNow.ToString("o"),                   // 176  ← ISO-8601 UTC, клиентийн цаг
    Text = text ?? string.Empty,                          // 177
    Predicted = route?.Intent,                            // 178
    Confidence = route?.Confidence ?? 0,                  // 179
    DecidedBy = IntentRouter.DecidedByTag(route?.By ?? DecidedBy.Fallback), // 180
    Acted = acted,                                        // 181
    DocUid = DocUid,                                      // 182
    RevitVersion = RevitVersion,                          // 183
    ProjectId = ProjectId,                                // 184
    ModelVersion = IntentModel.LoadedVersion,             // 185  ← БАЙНА, илгээгддэг
};
```

`IntentModel.LoadedVersion` — `revit-mcp/addin/IntentModel.cs:94`:
`public static string LoadedVersion => _model?.Version;` (шигтгэсэн эсвэл серверээс татсан загварын `version` талбар; `assistant_models.version`-той нэг нэрийн орон зай).

Илгээлт — `AssistantLog.FlushAsync`, мөр 276–315; POST `/api/revit/assistant/logs`, body `new { entries = batch }` (мөр 293), `BatchSize = 100` (мөр 68), локал дээд хэмжээ `MaxEntries = 3000` (мөр 65).

### 2.2 Сервер mapper тэр хоёрыг УНШИХГҮЙ

`backend/src/routes/revit.ts:1680-1699` — mapper-ийн БҮТЭН талбарын жагсаалт:

```ts
1680  const rows = (body.entries as Array<Record<string, unknown>>)
1681    .filter((e) => e && typeof e === 'object' && typeof e.text === 'string')
1682    .map((e) => ({
1683      id: str(e.id, 40),
1684      text: str(e.text, MAX_LOG_TEXT),
1685      predicted: isIntent(e.predicted) ? String(e.predicted) : null,
1686      confidence: Number.isFinite(Number(e.confidence)) ? Number(e.confidence) : null,
1687      decided_by: str(e.decided_by, 16) || null,
1688      corrected: isIntent(e.corrected) ? String(e.corrected) : null,
...
1692      feedback_note: str(e.feedback_note, 500) || null,
1693      feedback: e.feedback === 1 || e.feedback === -1 ? Number(e.feedback) : null,
1694      acted: e.acted === true ? 1 : 0,
1695      doc_uid: str(e.doc_uid, 128) || null,
1696      revit_version: str(e.revit_version, 16) || null,
1697      project_id: Number.isInteger(Number(e.project_id)) ? Number(e.project_id) : null,
1698    }))
1699    .filter((e) => e.id.length > 0 && e.text.length > 0);
```

**`e.model_version` ба `e.ts` ХАМААГҮЙ. Мөр бүр серверт хүрч, чимээгүй хаягдана.**

### 2.3 Схемд ийм багана БАЙХГҮЙ

`backend/migrations/0195_assistant_learning.sql:70-103` — `assistant_logs`-ийн БҮТЭН багана:
`id, user_id, project_id, doc_uid, revit_version, text, client_id, predicted, confidence, decided_by, corrected, feedback, acted, curated, created_at`.

`assistant_logs`-д хүрсэн ганцхан өөр DDL нь `backend/migrations/0200_assistant_feedback_note.sql:19`:
`ALTER TABLE assistant_logs ADD COLUMN feedback_note TEXT;`

Баталгаа: `grep -rn "assistant_logs" backend/migrations/*.sql | grep -i "alter\|create table"` → яг 2 үр дүн (`0195:70`, `0200:19`). **`model_version`, `addin_version`, `client_ts` гурав нь схемд ОГТ байхгүй.**

`created_at TEXT NOT NULL DEFAULT (datetime('now'))` — `0195:102`. Энэ нь **серверийн INSERT-ийн UTC цаг**.

### 2.4 `created_at`-аар эрэмбэлэх нь БУРУУ

Бүртгэл нь локал JSONL-д бичигдээд (`%APPDATA%\RevitMcpAddin\assistant-log.jsonl`, `AssistantLog.cs:79`) **БАГЦААР, дараа нь** илгээгддэг. Тиймээс дахин холбогдсоны дараа 100 мөр НЭГ INSERT-ээр орж, бүгд бараг ижил `created_at` авна — үйл явдлын жинхэнэ дараалал, тэдгээрийн хоорондох ЗАЙ (latency-ийн суурь) устана. Энэ нь **1C**-д (хугацааны хэмжилт) үхлийн асуудал.

Илгээлт олон газраас өдөөгддөг — `revit-mcp/addin/AssistantPane.xaml.cs`-ийн `FlushLogsSoon()` (тодорхойлолт мөр **1745**) нь мөр **1368, 1382, 1395, 1625, 1635, 1671, 1693, 1700**-аас дуудагдана.

### 2.5 ⚠️ BIND АРИФМЕТИК — ЦОРЫН ГАНЦ БОДИТ ЭРСДЭЛ

`backend/src/routes/revit.ts`-д **ХОЁР** тусдаа bind тогтмол байна. Тэдгээрийг бүү андуур:

| Байршил | Тогтмол | Хамаарах INSERT |
|---|---|---|
| мөр 58–59 | `const BINDS_PER_BINDING_ROW = 13;` / `const BINDING_ROWS_PER_STATEMENT = Math.floor(100 / BINDS_PER_BINDING_ROW); // = 7` | `revit_sheet_bindings` — **ЭНЭ АЖИЛД ХАМААРАЛГҮЙ, БҮҮ ХӨНД** |
| мөр 1706–1707 | `const BINDS = 13;` / `const PER = Math.floor(100 / BINDS);` | `assistant_logs` — **энэ ажлын бай** |

**Баталгаажсан drift.** Мөр 1703–1705-ийн тайлбар өөртэйгөө зөрчилддөг:

```ts
1703  // 12 bind/мөр → floor(100/12) = 8 мөр/statement (D1-ийн 100 bind хязгаар).
1704  // ⚠️ БАГАНА НЭМБЭЛ ЭНЭ ТООГ ЗАСАХ ЁСТОЙ.  D1-ийн нэг statement 100
1705  // bind-аар хязгаарлагдана; 13 × 7 = 91 ≤ 100.
1706  const BINDS = 13;
```

Эхний мөр **12 / 8** гэж, гурав дахь мөр **13 × 7 = 91** гэж, тогтмол нь **13** гэж хэлж байна. Кодтой нийцэж байгаа нь **13 × 7 = 91**; эхний мөр нь `feedback_note` (0200) нэмэгдэхээс өмнөх хуучирсан үлдэгдэл. **Аль ч тоог хуулж бүү ав — 13 нь зөв.**

Бодит VALUES кортеж — мөр 1711, `?` тэмдэг **13**:

```ts
1711  const values = chunk.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').join(', ');
```

Bind дараалал — мөр 1714–1718 (13 утга):

```ts
        user.sub, r.project_id, r.doc_uid, r.revit_version, r.text,
        r.predicted, r.confidence, r.decided_by, r.corrected, r.feedback,
        r.acted, r.id, r.feedback_note,
```

Багана жагсаалт — мөр 1723–1725 (13 нэр):

```sql
(user_id, project_id, doc_uid, revit_version, text,
 predicted, confidence, decided_by, corrected, feedback, acted, client_id,
 feedback_note)
```

Гурвуулаа өнөөдөр 13 дээр нийлж байна, **ГЭХДЭЭ тэднийг холбосон ЯМАР Ч механизм байхгүй** — `tsc` энэ зөрүүг барихгүй, тест ч байхгүй. Багана нэмээд `BINDS`-ыг мартвал **эхний БҮТЭН багц (>PER мөр) runtime дээр bind-count алдаагаар унана**, эмхэтгэл ногоон хэвээр байна.

### 2.6 `Sent` тугийг локалд хадгалдаггүй → Revit асах бүрд бүтэн backlog дахин илгээгддэг

- `AssistantLog.cs:43` — `[JsonIgnore] public bool Sent { get; set; }` — JSONL-д **бичигдэхгүй**.
- `EnsureLoaded()` (мөр 88–117) файлыг дахин уншихад мөр бүр `Sent = false` (bool-ийн анхдагч) утгатай ирнэ.
- `PendingCount` (мөр 260–270) = `_entries.Count(e => !e.Sent)` — тиймээс Revit дахин ассаны дараа **локал дахь БҮХ мөр** (дээд тал нь `MaxEntries = 3000`) дахин «илгээгээгүй» болно.
- `FlushAsync` (мөр 284) нэг удаад `BatchSize = 100` авна.

**Үр дагавар:** мөр гэмтэхгүй — серверийн `ON CONFLICT (user_id, client_id) DO UPDATE` (мөр 1727) идэмпотент. ГЭВЧ Revit сесс бүрд ~3000 хүртэл дэмий D1 бичилт зарцуулна.

**Энэ бол C# алдаа тул 1C-ийн add-in гаралтад засагдана.** Энд зөвхөн бүртгэв — хоёр сесс нэг зурагтай байх ёстой. Засвар нь `[JsonIgnore]`-ыг хасаж `[JsonPropertyName("sent")]` болгох, эсвэл сүүлд илгээсэн `id`-г тусдаа жижиг файлд хадгалах.

### 2.7 `addin_version` ОГТ БАЙХГҮЙ, DLL бүр `1.0.0.0` гэж тамгалагдана

Баталгаа: `grep -rn "addin_version\|AddinVersion" --include=*.cs --include=*.ts --include=*.sql --include=*.py --include=*.csproj .` → **үр дүн тэг**.

`revit-mcp/addin/RevitMcpAddin.csproj` (150 мөр, бүтнээр уншсан) — `<Version>`, `<AssemblyVersion>`, `<FileVersion>`, `<InformationalVersion>` **ганц ч байхгүй**. `AssemblyInfo.cs` файл байхгүй, `Directory.Build.props` repo-д **огт байхгүй** (`find . -name "Directory.Build.props"` → хоосон). Тиймээс SDK анхдагч **`1.0.0.0`**-ыг тамгалдаг ба **8 Configuration** (`Debug/Release R24..R27`, `csproj:13`) бүгд ялгаагүй ижил тоо гаргана.

**Үр дагавар:** ажилтны компьютер дээр ямар build ажиллаж байгааг ялгах арга ОДООГООР БАЙХГҮЙ. `revit_version` (`2024`..`2027`, `csproj:36-51`) нь **Revit-ийн он**, add-in-ий хувилбар БИШ. `revit_version` нь бүртгэгддэг — `AssistantLog.cs:39, 183`, сервер mapper `revit.ts:1696`.

### 2.8 `confidence` нь мөр мөрөнд ӨӨР ХЭМЖИГДЭХҮҮН — мөрүүд хооронд ХАРЬЦУУЛАХ БОЛОМЖГҮЙ

`revit-mcp/addin/IntentRouter.cs`, `Route(string text)`:

| Мөр | Салаа | `Confidence`-д юу бичигдэнэ |
|---|---|---|
| 147–152 | хоосон текст | `r.Confidence` хөндөгдөхгүй → **0.0**, `By = Fallback`, `Intent = null` |
| 155–164 | **түлхүүр үг** (`IntentParser.Parse`) | `r.Confidence = 1.0;` (мөр **159**) — **ХАТУУ БИЧСЭН ТОГТМОЛ**, ямар ч магадлал биш |
| 181–188 | **загвар** (итгэлтэй ба үйлдэлд тохирсон) | `r.Confidence = p.Confidence;` (мөр **184**) — top-1 магадлал |
| 191–196 | **fallback** | `r.Confidence = p?.Confidence ?? 0;` (мөр **193**) — **эрэмбийн 1-рийн** магадлал, тэр нь ихэвчлэн `unknown` |

`unknown` нь жинхэнэ ангилал:

- `IntentModel.cs:68` — `public const string UnknownIntent = "unknown";`
- `IntentRouter.cs:179` — `bool actionable = p.Intent != IntentModel.UnknownIntent;` (мөр 177–178-ийн тайлбар: «`unknown` нь ЖИНХЭНЭ ангилал — загвар "энэ бол миний ажил биш" гэж СУРСАН»).
- `IntentPrediction.Confidence` = `ranked[0].Value` (`IntentModel.cs:311`); `IntentPrediction.Ranked` нь `List<KeyValuePair<string,double>>` (`IntentModel.cs:17`).
- Серверийн `ASSISTANT_INTENTS`-д `'unknown'` багтдаг (`revit.ts:1644`), тиймээс `predicted = 'unknown'` мөрүүд DB-д ордог.

**Дүгнэлт:** `assistant_logs.confidence` баганын УТГА нь `decided_by`-аас хамаарч өөр өөр зүйл заана:

- `decided_by='keyword'` → үргэлж `1.0`, магадлал БИШ.
- `decided_by='model'` → үйлдэлд тохирсон шошгын top-1 магадлал.
- `decided_by='fallback'` → эрэмбийн эхний шошгын магадлал, тэр шошго нь **ихэвчлэн `unknown`**.

**Зөвлөмж.** Ирээдүйд «итгэл багатай мөрүүд дээр дахин сургах» гэсэн эвристик бичвэл **буруу мөрүүдийг сонгоно**: `keyword` мөрүүд 1.0-оороо хэзээ ч сонгогдохгүй (гэтэл түлхүүр үгийн дүрэм ч БУРУУ байж болно), `fallback` мөрүүд `unknown`-ы магадлалаараа эрэмбэлэгдэнэ (санаа таних чанарын хэмжүүр БИШ). Хоёр гарц:

1. **Дээд (зөвлөж байна):** эрэмбийн **эхний 3**-ыг `ranked_json` баганад хадгална (§3.1-ийн сонголт, §9 #4). Тэгвэл `confidence` нь зөвхөн товчлол болж, жинхэнэ хэмжигдэхүүн нь эрэмбэ болно.
2. **Доод:** `confidence`-ыг **зөвхөн `decided_by='model'` мөрөнд утгатай** гэж бичгээр тогтоож, аливаа шинжилгээ `WHERE decided_by = 'model'` шүүлттэй байх.

### 2.9 Бусад холбогдох, баталгаажсан жижиг баримт

| Баримт | Байршил |
|---|---|
| Route-ийн эрх: `revit.use('*', requireRole(...REVIT_ROLES))`, `REVIT_ROLES = ['engineer','architect','senior','admin']` | `revit.ts:79`, `:43` |
| Mount: `app.route('/api/revit', revit)` | `backend/src/index.ts:216` |
| `MAX_LOG_BATCH = 200`, `MAX_LOG_TEXT = 500` | `revit.ts:1628`, `:1630` |
| `assistant.logging` унтарсан бол 200-аар чимээгүй хүлээж авсан мэт хариулна | `revit.ts:1672-1678` |
| `str(v, max)` — trim + slice, `MAX_STR = 256` анхдагч | `revit.ts:85-88`, `:50` |
| `assistant_logs` уншдаг ГАНЦ өөр газар: `GET /assistant/pending` (admin/senior) | `revit.ts:1863-1893` (`SELECT` жагсаалт мөр 1870-1872) |
| `curated = 1` бичдэг газар | `revit.ts:1959` |
| **Frontend-д `assistant_logs` уншдаг код БАЙХГҮЙ** (`grep -rln` → зөвхөн `frontend/src/shared/config/modules.ts`, тэр нь модулийн нэр л) | — |
| Python сургалт нь DB-д ШУУД хүрдэггүй; `pull_and_retrain.py:182` зөвхөн `/assistant/pending`-ийг дурддаг | `revit-mcp/training/pull_and_retrain.py` |
| D1: `database_name = "mgl-progress-db-v3"`, `database_id = "03167f58-753b-4f99-a6f9-fb361bf2a453"`, worker `name = "mgl-progress-api"` | `backend/wrangler.toml:1, 49, 50` |
| Backend тест: `"test": "node --test \"src/**/*.test.ts\""`, `src/lib/`-д 17 тест файл | `backend/package.json:17` |

**Тайлбарын алдаа (мэдээллийн зорилгоор, засах шаардлагагүй):**

- `revit.ts:1654-1656` тайлбар «`INSERT OR IGNORE` + өвөрмөц индекс» гэж бичсэн боловч бодит код нь `ON CONFLICT ... DO UPDATE` (мөр 1727). Хуучирсан тайлбар.
- `0195_assistant_learning.sql:138` «доорх trigger барина» гэж бичсэн боловч trigger байхгүй — 147-148-д **хэсэгчилсэн ӨВӨРМӨЦ ИНДЕКС** байна (repo-д trigger ТЭГ).

---

## 3. ХИЙХ АЖИЛ

### 3.1 Migration — `backend/migrations/0201_assistant_log_provenance.sql`

**Дугаар:** `ls backend/migrations | tail -3` → `0198_attendance_clockout_announcement.sql`, `0199_user_work_schedules.sql`, `0200_assistant_feedback_note.sql`. Дараагийн сул нь **0201**.

⚠️ **1B-1 ба 1B-7 мөн дугаар авна** — эхлэхээсээ өмнө тэдгээрийн brief-ийг харж, эсвэл эзнээс блок хуваарилалт аваад, зөрчилдвөл өөрийн файлыг **0202/0203** болго. Дугаар давхардвал wrangler-ийн bookkeeping эвдэрнэ (repo-д аль хэдийн 6 давхардсан дугаар байгаа — 0002, 0060, 0080, 0110, 0120, 0121).

```sql
-- 0201 — `assistant_logs`-ийн ГАРАЛ ҮҮСЭЛ (provenance).
--
-- ⚠️ ЯАГААД: мөр бүр АЛЬ загвар, АЛЬ add-in build-аас, ХЭЗЭЭ гарсныг
-- өнөөдөр хадгалдаггүй.  Тиймээс A/B, drift илрүүлэлт, «шинэ загвар
-- бодит урсгал дээр муудсан уу?» гэсэн асуултад хариулах БОЛОМЖГҮЙ.
-- Add-in нь `model_version`-ыг АЛЬ ХЭДИЙН илгээж байна (AssistantLog.cs:41,185)
-- — сервер уншдаггүй тул өдөр бүр хаягдаж байсан.
--
-- ⚠️ `client_ts` ЯАГААД ХЭРЭГТЭЙ: `created_at` нь СЕРВЕРИЙН INSERT цаг.
-- Бүртгэл локалд бичигдээд БАГЦААР илгээгддэг тул дахин холбогдсоны
-- дараа 100 мөр бараг ижил `created_at` авна — үйл явдлын дараалал ба
-- хоорондын ЗАЙ устана.  Хугацааны хэмжилт (1C) үүнгүйгээр утгагүй.
--
-- ⚠️ `addin_version` нь ОДООГООР ХООСОН ирнэ: csproj хувилбар зарладаггүй
-- тул DLL бүр 1.0.0.0.  C# тал нь 1C-ийн add-in гаралтад ирнэ; багана нь
-- утга буух ГАЗРЫГ урьдчилж бэлдэж байна.  Багана нь түүнийг УНШИХ кодоос
-- ХАТУУ ӨМНӨХ deploy-д гарах ёстой — энэ бол тэр deploy.
--
-- ⚠️ БАЙГАА хүснэгт дээрх ALTER тул блокийн ЭХЭНД.  Шинэ хүснэгт үүсгэхгүй.
-- Бүх багана NULLable — 0201-ээс өмнөх мөрүүд болон хуучин add-in-аас
-- ирэх мөрүүд хоосон утгатай байх нь ХЭВИЙН, зориудынх.

ALTER TABLE assistant_logs ADD COLUMN model_version TEXT;
ALTER TABLE assistant_logs ADD COLUMN addin_version TEXT;
ALTER TABLE assistant_logs ADD COLUMN client_ts     TEXT;

-- Гол шинжилгээний хэлбэр: «хувилбар X дээр fallback-ийн хувь хэд байв».
CREATE INDEX IF NOT EXISTS idx_assistant_logs_model
  ON assistant_logs (model_version, created_at DESC);
```

**Анхаар:** SQLite-ийн `ALTER TABLE ... ADD COLUMN` нь `IF NOT EXISTS`-ыг ДЭМЖДЭГГҮЙ (0200 ч дэмждэггүйг харуулсан). Тиймээс энэ файлыг **хоёр удаа ажиллуулж БОЛОХГҮЙ** — `duplicate column name` алдаа өгнө. Migration bookkeeping үүнээс хамгаална; гараар `d1 execute --file` бүү ажиллуул.

**`ranked_json` (ЗӨВЛӨМЖ — §9 #4-д шийдвэр шаардана).** §2.8-ийн `confidence` асуудлыг үндсээр нь засах цорын ганц зам бол эрэмбийн эхний 3-ыг хадгалах. Хэрэв эзэн зөвшөөрвөл ижил migration-д нэмнэ:

```sql
-- Эрэмбийн эхний 3 — `[["isolate_sheet",0.61],["list_sheets",0.22],["unknown",0.08]]`.
-- `confidence` дангаараа ХАРЬЦУУЛАХ БОЛОМЖГҮЙ (IntentRouter.cs:159 нь
-- түлхүүр үгэнд 1.0-ыг ХАТУУ бичдэг, :193 нь ихэвчлэн `unknown`-ы
-- магадлалыг бичдэг) — эрэмбэ л жинхэнэ хэмжигдэхүүн.
-- ⚠️ JSON-ыг SQL-ээс УНШИХГҮЙ (repo-д `json_extract` ТЭГ удаа тааралдана);
-- шинжилгээг код талд хийнэ.
ALTER TABLE assistant_logs ADD COLUMN ranked_json TEXT;
```

### 3.2 Шинэ модуль — `backend/src/lib/assistantLogInsert.ts`

Bind арифметикийг **баганын жагсаалтаас гаралтай** болгож, гар тоолол дахин хэзээ ч зөрөхгүй болгоно. Импортгүй, цэвэр модуль (тестээс шууд статик импорт хийх боломжтой — `lib/leaveOverlap.ts`-тэй ижил хэв маяг).

```ts
/**
 * `assistant_logs`-ийн багц INSERT-ийн ГЭРЭЭ.
 *
 * ⚠️ ЯАГААД ТУСДАА ФАЙЛ ВЭ: өмнө нь баганын жагсаалт, `?` кортеж ба bind
 * тоо гурав нь `routes/revit.ts`-д ГУРВАН тусдаа газар ГАРААР бичигдэж
 * байсан бөгөөд тэднийг холбосон юу ч байгаагүй.  Тайлбар нь тогтмолоосоо
 * ӨӨР тоо хэлж байсан (`12 → 8` гэж бичээд `BINDS = 13` байсан).  `tsc`
 * зөрүүг барихгүй; алдаа нь ЭХНИЙ БҮТЭН БАГЦ дээр runtime-ийн bind-count
 * алдаа болж гарна.  Одоо гурвуулаа ЭНЭ жагсаалтаас гарна.
 */

/** INSERT-ийн багана, ЯГ ЭНЭ дарааллаар.  Bind мөн ЭНЭ дарааллаар. */
export const ASSISTANT_LOG_COLUMNS = [
  'user_id',
  'project_id',
  'doc_uid',
  'revit_version',
  'text',
  'predicted',
  'confidence',
  'decided_by',
  'corrected',
  'feedback',
  'acted',
  'client_id',
  'feedback_note',
  // --- 0201 ---
  'model_version',
  'addin_version',
  'client_ts',
] as const;

/** Нэг мөрөнд ногдох bind. */
export const ASSISTANT_LOG_BINDS = ASSISTANT_LOG_COLUMNS.length;

/**
 * Нэг statement-д багтах мөр.  D1-ийн хатуу хязгаар нь 100 bind/statement.
 * ⚠️ Багана нэмэхэд ЭНЭ ТОО ӨӨРӨӨ буурна — гараар засах зүйл БАЙХГҮЙ.
 */
export const ASSISTANT_LOG_ROWS_PER_STATEMENT =
  Math.floor(100 / ASSISTANT_LOG_BINDS);

/** `(?, ?, …)` — уртыг нь баганын тооноос гаргана. */
export const ASSISTANT_LOG_TUPLE =
  `(${ASSISTANT_LOG_COLUMNS.map(() => '?').join(', ')})`;

export const ASSISTANT_LOG_COLUMN_SQL = ASSISTANT_LOG_COLUMNS.join(', ');
```

### 3.3 `backend/src/routes/revit.ts` — mapper

Мөр **1697**-ийн дараа (`project_id`-ийн дараа, `}))`-ээс өмнө) нэм:

```ts
      // ⚠️ Add-in эдгээрийг ЭНЭ ӨӨРЧЛӨЛТӨӨС ӨМНӨӨС илгээж байсан; сервер
      // уншдаггүй байсан тул ХАЯГДАЖ байв.  `AssistantLog.cs:41` (model_version),
      // `:18` (ts).  `addin_version`-ыг add-in ОДООГООР илгээхгүй (csproj
      // хувилбар зарладаггүй, DLL бүр 1.0.0.0) — 1C-ийн гаралтад ирнэ.
      model_version: str(e.model_version, 64) || null,
      addin_version: str(e.addin_version, 32) || null,
      // ⚠️ ISO-8601 UTC, КЛИЕНТИЙН цаг.  `created_at` нь СЕРВЕРИЙН INSERT
      // цаг бөгөөд багц илгээлтийн улмаас дараалал заахад ТОХИРОХГҮЙ.
      client_ts: isoTs(e.ts),
```

Туслах функц — `str()`-ийн хажууд (`revit.ts:88`-ийн дараа) нэм:

```ts
/**
 * Клиентийн ISO-8601 цаг.  Хэлбэр буруу бол NULL — хог утга DB-д оруулахгүй.
 * ⚠️ Утгыг ЗАСАХГҮЙ (clamp хийхгүй): ажилтны PC-ийн цаг буруу байх нь
 * ӨӨРӨӨ мэдэх ёстой баримт.  `created_at` үргэлж найдвартай хэвээр байна.
 */
function isoTs(v: unknown): string | null {
  const s = str(v, 40);
  if (!s) return null;
  const t = Date.parse(s);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}
```

### 3.4 `backend/src/routes/revit.ts` — INSERT ба bind арифметик

Мөр **1703–1735**-ыг бүхэлд нь солино. Гар тоолол бүрийг устгана:

```ts
  // ⚠️ Bind арифметик нь `lib/assistantLogInsert.ts`-ийн БАГАНЫН ЖАГСААЛТААС
  // гарна — энд ГАРААР тоолох зүйл БАЙХГҮЙ.  (Урьд нь энэ тайлбар «12 bind
  // → 8 мөр» гэж бичигдээд тогтмол нь 13 байсан; тэр төрлийн зөрүү дахин
  // үүсэхгүй.)  `assistantLogInsert.test.ts` гурвалсан нийцлийг барина.
  const PER = ASSISTANT_LOG_ROWS_PER_STATEMENT;
  const stmts: D1PreparedStatement[] = [];
  for (let i = 0; i < rows.length; i += PER) {
    const chunk = rows.slice(i, i + PER);
    const values = chunk.map(() => ASSISTANT_LOG_TUPLE).join(', ');
    const binds: unknown[] = [];
    for (const r of chunk) {
      binds.push(
        user.sub, r.project_id, r.doc_uid, r.revit_version, r.text,
        r.predicted, r.confidence, r.decided_by, r.corrected, r.feedback,
        r.acted, r.id, r.feedback_note,
        r.model_version, r.addin_version, r.client_ts,
      );
    }
    stmts.push(
      db.prepare(
        `INSERT INTO assistant_logs
           (${ASSISTANT_LOG_COLUMN_SQL})
         VALUES ${values}
         ON CONFLICT (user_id, client_id) DO UPDATE SET
           corrected     = COALESCE(excluded.corrected, assistant_logs.corrected),
           feedback      = COALESCE(excluded.feedback,  assistant_logs.feedback),
           acted         = MAX(excluded.acted, assistant_logs.acted),
           feedback_note = COALESCE(excluded.feedback_note, assistant_logs.feedback_note),
           -- ⚠️ ГАРАЛ ҮҮСЛИЙГ ХОЖИМ ИРСЭН УТГААР ДАРЖ БОЛОХГҮЙ.  Мөр нь
           -- 👍/👎 ирэхэд ДАХИН илгээгддэг; тэр үед add-in аль хэдийн ӨӨР
           -- загвар татсан байж болно.  Анхны шийдвэрийг гаргасан хувилбар
           -- л зөв хариулт — тиймээс `COALESCE(assistant_logs.x, excluded.x)`,
           -- ЭСРЭГЭЭР нь БИШ.
           model_version = COALESCE(assistant_logs.model_version, excluded.model_version),
           addin_version = COALESCE(assistant_logs.addin_version, excluded.addin_version),
           client_ts     = COALESCE(assistant_logs.client_ts,     excluded.client_ts)`,
      ).bind(...binds),
    );
  }
  await db.batch(stmts);
```

⚠️ **`COALESCE`-ийн дараалал энд 0200-ийнхтэй ЗОРИУД ЭСРЭГ.** `feedback_note` нь 👎-ээс ХОЙШ ирдэг тул шинэ нь үргэлж зөв (`excluded` түрүүнд — `revit.ts:1731-1733`-ийн тайлбар үүнийг тайлбарладаг). Гарал үүсэл нь ЭХНИЙ шийдвэрийн шинж чанар тул хуучин нь үргэлж зөв (`assistant_logs` түрүүнд). Хоёрыг андуурвал дахин илгээлт бүр `model_version`-ыг тухайн үеийн хувилбараар дарж, A/B-ийн өгөгдлийг чимээгүй бохирдуулна.

### 3.5 Bind арифметикийн ХҮСНЭГТ (шалгаж баталсан тоо)

| Багана | Bind/мөр | `floor(100/binds)` | Хамгийн их bind/statement | Add-in-ийн 100 мөрд ногдох statement |
|---|---|---|---|---|
| Одоогийн (13) | 13 | **7** | 91 ✅ | 15 |
| **+3** (`model_version`, `addin_version`, `client_ts`) | **16** | **6** | **96 ≤ 100 ✅** | **17** |
| +4 (`ranked_json` нэмбэл) | **17** | **5** | **85 ≤ 100 ✅** | 20 |

⚠️ **Хоёрдогч эрсдэл:** нэг `db.batch()`-д орох statement-ийн тоо өснө. `MAX_LOG_BATCH = 200` (`revit.ts:1628`) дээр 29 → **34** (эсвэл 40). Бодит add-in нэг удаад 100 мөр илгээдэг (`AssistantLog.cs:68`) тул бодит дээд утга **17 statement**. Өнөөдөр асуудал үүсгэхгүй, гэхдээ `MAX_LOG_BATCH`-ыг цаашид өсгөх бол дахин бодох ёстой.

### 3.6 Шинэ тест — `backend/src/lib/assistantLogInsert.test.ts`

```ts
/**
 * ⚠️ ЭНЭ ТЕСТИЙН ГАНЦ ЗОРИЛГО: bind арифметикийг барих.
 * `routes/revit.ts`-ийн `assistant_logs` INSERT нь урьд нь баганын жагсаалт,
 * `?` кортеж ба bind тоог ГУРВАН тусдаа газар гараар бичдэг байв; тайлбар нь
 * тогтмолоосоо ӨӨР тоо хэлж байсан.  Зөрүүг `tsc` барихгүй — эхний БҮТЭН
 * багц дээр D1 bind-count алдаа өгнө.
 *
 * Модуль нь импортгүй цэвэр тул `registerHooks` шаардлагагүй
 * (`leaveOverlap.test.ts`-тэй ижил хэв маяг).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ASSISTANT_LOG_COLUMNS,
  ASSISTANT_LOG_BINDS,
  ASSISTANT_LOG_ROWS_PER_STATEMENT,
  ASSISTANT_LOG_TUPLE,
  ASSISTANT_LOG_COLUMN_SQL,
} from './assistantLogInsert.ts';

test('bind тоо нь баганын тоотой ЯГ тэнцүү', () => {
  assert.equal(ASSISTANT_LOG_BINDS, ASSISTANT_LOG_COLUMNS.length);
});

test('VALUES кортежийн `?` тоо нь bind тоотой ЯГ тэнцүү', () => {
  const marks = ASSISTANT_LOG_TUPLE.split('?').length - 1;
  assert.equal(marks, ASSISTANT_LOG_BINDS);
});

test('багана SQL нь мөн адил тооны нэртэй', () => {
  assert.equal(ASSISTANT_LOG_COLUMN_SQL.split(',').length, ASSISTANT_LOG_BINDS);
});

test('нэг statement D1-ийн 100 bind хязгаарт БАГТАНА', () => {
  const worst = ASSISTANT_LOG_ROWS_PER_STATEMENT * ASSISTANT_LOG_BINDS;
  assert.ok(worst <= 100, `${worst} bind > 100`);
  assert.ok(ASSISTANT_LOG_ROWS_PER_STATEMENT >= 1, 'нэг мөр ч багтахгүй байна');
});

test('баганын нэр давхардаагүй', () => {
  assert.equal(new Set(ASSISTANT_LOG_COLUMNS).size, ASSISTANT_LOG_COLUMNS.length);
});
```

### 3.7 `GET /assistant/pending`-д гарал үүслийг харуулах (сонголт, зөвлөмжтэй)

`revit.ts:1870-1872`-ийн `SELECT` жагсаалтад `l.model_version, l.client_ts` нэмбэл шошголж буй хүн «энэ мөрийг аль загвар гаргасан бэ» гэдгийг харна. Frontend талд энэ өгөгдлийг уншдаг код БАЙХГҮЙ (§2.9) тул нэмэлт талбар юуг ч эвдэхгүй. **Зөвхөн §5-ийн 2-р deploy-д, migration хэрэглэгдсэний ДАРАА.**

---

## 4. ХӨНДӨЖ БОЛОХГҮЙ (load-bearing)

| Зүйл | Яагаад |
|---|---|
| `const BINDS_PER_BINDING_ROW = 13` / `BINDING_ROWS_PER_STATEMENT` (`revit.ts:58-59`) | **ӨӨР INSERT-ийнх** (`revit_sheet_bindings`). Нэрний төстэй байдал нь урхи. Хөндвөл хуудасны холбоосын upsert унана. |
| `CREATE UNIQUE INDEX idx_assistant_logs_client ON assistant_logs(user_id, client_id)` (`0195:106-107`) | `ON CONFLICT (user_id, client_id)` тулгуурладаг. Add-in дахин илгээхийг ХЭВИЙН гэж үздэг (§2.6) тул энэ индекс алга болвол давхардал үүснэ. |
| `feedback_note = COALESCE(excluded.…, assistant_logs.…)`-ийн ДАРААЛАЛ (`revit.ts:1733`) | Тайлбар нь 👎-ээс ХОЙШ ирдэг тул шинэ нь зөв. Гарал үүслийн 3 баганад ЭСРЭГ дараалал хэрэгтэй (§3.4). Хоёрыг нэг загварт оруулах гэж бүү оролд. |
| `acted = MAX(excluded.acted, assistant_logs.acted)` (`revit.ts:1730`) | «нэг удаа гүйцэтгэсэн бол үүрд гүйцэтгэсэн» — засвар ирэхэд `Acted = true` болдог (`AssistantLog.cs:249`). |
| `assistant.logging = 'off'` үед 200 буцаах зан (`revit.ts:1672-1678`) | Add-in дахин дахин оролдохоос сэргийлнэ. Шинэ багана энэ салааг хөндөх ёсгүй. |
| Бүх шинэ багана **NULLable** байх | 0201-ээс өмнөх мөрүүд ба 1C-ийн өмнөх бүх add-in build хоосон утга илгээнэ. `NOT NULL` тавих нь эдгээр мөрийг татгалзаж, **бүртгэлийн урсгалыг бүхэлд нь тасална** — «бүртгэл нь чат ажиллахад саад болох ёсгүй» гэсэн `AssistantLog.cs:58-60`-ийн зарчмыг зөрчинө. |
| `client_ts`-ийг `created_at`-ыг СОЛЬЖ бүү хэрэглэ | `created_at` нь серверийн итгэмжлэгдсэн цаг; `client_ts` нь ажилтны PC-ийн цаг (буруу байж болно). Хоёулаа хэрэгтэй — `idx_assistant_logs_curate` ба `idx_assistant_logs_user` (`0195:110-113`) `created_at`-д тулгуурладаг. |
| `revit.use('*', requireRole(...REVIT_ROLES))` (`revit.ts:79`) | `worker` ба `client` энд хүрэхгүй (`lib/workerScope.ts` нь хаалттай-анхдагч allowlist). Бүү сулруул. |
| `verifyToken` / `authMiddleware` | §0 үзнэ үү. Add-in нь `purpose:'mcp'` токеноор REST дуудна. Алсаас сэргээх боломжгүй. |
| `assistant_logs` нь `users`-ийн `ON DELETE CASCADE` хүүхэд (`0195:72`) | Хүснэгтийг дахин бүтээх (path B) шаардлагатай ямар ч замыг бүү сонго. `ADD COLUMN` нь дахин бүтээлт биш — аюулгүй. |

---

## 5. ДАРААЛАЛ БА ХАМААРАЛ

### Урьдчилсан нөхцөл

1. Migration дугаарыг **1B-1, 1B-7**-той зөвшилцөх (§3.1).
2. `ranked_json` нэмэх эсэхийг эзэнтэй шийдэх (§9 #4).
3. `git status` — өөр агентын WIP `routes/revit.ts`-д байгаа эсэхийг шалгах. Байвал **зогсоод асуу**.

### Deploy дараалал — ХАТУУ

| # | Алхам | Команд | Яагаад тусад нь |
|---|---|---|---|
| **1** | Migration | `cd backend && npx wrangler d1 migrations apply mgl-progress-db-v3 --remote --config wrangler.toml` | **Шинэ багана нь түүнийг УНШИХ/БИЧИХ кодоос ХАТУУ ӨМНӨХ deploy-д гарна.** Эсрэгээр хийвэл шинэ worker `no such column: model_version` өгч, бүх бүртгэл илгээлт 500 болно. |
| **2** | Worker | `cd backend && npx wrangler deploy --config wrangler.toml` | 1-ийн дараа. `--config` ЗААВАЛ. |

Хоёрын хооронд **шалга**:
`npx wrangler d1 execute mgl-progress-db-v3 --remote --config wrangler.toml --command "PRAGMA table_info(assistant_logs)"` — гурван шинэ багана харагдах ёстой.

### Энэ ажлын ДАРАА

- **1C (Хэмжилт)** — `client_ts`-гүйгээр latency-ийн суурь тавих боломжгүй, `model_version`-гүйгээр хувилбар хооронд харьцуулах боломжгүй. **Энэ бол блокчлогч.** «250 ms» гэдэг нь шаардлага БИШ, хэн ч хийгээгүй ХЭМЖИЛТ.
- **1C-ийн add-in гаралт** — C# өөрчлөлт БҮГД нэг DLL-д: (а) `addin_version` илгээх + `csproj`-д `<Version>` зарлах, (б) `Sent` тугийг локалд хадгалах (§2.6), (в) `ranked` илгээх (хэрэв §9 #4-д зөвшөөрвөл). Add-in-д **албадан шинэчлэлт БАЙХГҮЙ** тул нэг л боломж.
- **1B-4** — офлайн cross-validation-ийн хазайлт. `model_version` байсны дараа л бодит урсгалтай тулгаж болно.

### Урвуу нийцтэй байдал

Хуучин add-in (шинэчлэгдээгүй ~20 PC) `model_version`-ыг илгээсээр байх ба `addin_version`-гүй, `ts`-тэй мөр илгээнэ. Бүх шинэ багана NULLable тул **эдгээр мөр хэвийн орно**. Add-in талд ямар ч өөрчлөлт **шаардагдахгүй**, зөвхөн `addin_version` баганын утга NULL байна.

---

## 6. ХҮЛЭЭН АВАХ ШАЛГУУР

- [ ] `backend/migrations/0201_assistant_log_provenance.sql` үүссэн; `ALTER` мөрүүд файлын **ЭХЭНД**, `CREATE INDEX`-ээс өмнө.
- [ ] Migration дугаар нь `ls backend/migrations | tail -1`-ээс өндөр, 1B-1/1B-7-тэй давхардаагүй. Байгаа ямар ч migration файл **өөрчлөгдөөгүй** (`git diff --stat backend/migrations` — зөвхөн шинэ файл).
- [ ] `PRAGMA table_info(assistant_logs)` remote дээр `model_version`, `addin_version`, `client_ts` гурвыг харуулна (`notnull = 0` бүгдэд).
- [ ] `backend/src/lib/assistantLogInsert.ts` үүссэн; **ямар ч импортгүй**.
- [ ] `routes/revit.ts`-д `const BINDS = 13` ба `const PER = Math.floor(100 / BINDS)` **устсан**; `ASSISTANT_LOG_ROWS_PER_STATEMENT`-аар солигдсон.
- [ ] `routes/revit.ts:1703`-ийн хуучирсан «12 bind → 8 мөр» тайлбар **устсан**.
- [ ] `revit.ts:58-59`-ийн `BINDS_PER_BINDING_ROW` **хөндөгдөөгүй** (`git diff` дээр харагдахгүй).
- [ ] mapper-т `model_version`, `addin_version`, `client_ts` гурав нэмэгдсэн; `client_ts` нь буруу хэлбэрийг NULL болгоно.
- [ ] `ON CONFLICT DO UPDATE`-д гурван шинэ багана `COALESCE(assistant_logs.x, excluded.x)` (**хуучин нь тэргүүнд**) — `feedback_note`-ынхтой ЭСРЭГ.
- [ ] `cd backend && npm test` — бүх тест ногоон, шинэ `assistantLogInsert.test.ts` 5 тесттэй ажиллана.
- [ ] `cd backend && npx tsc --noEmit` — алдаа ЗӨВХӨН хамааралгүй файлд (өөрийн 3 файлд ТЭГ).
- [ ] `git status --porcelain` — яг **4 файл** (3 шинэ + `routes/revit.ts`). Өөр ямар ч файл staged/modified биш.
- [ ] Deploy-ийн дараа: бодит Revit add-in-аас нэг мессеж бичээд, `SELECT model_version, client_ts, created_at FROM assistant_logs ORDER BY id DESC LIMIT 5` — `model_version` **хоосон биш**, `client_ts` утгатай.
- [ ] Багц илгээлтийн нотолгоо: `SELECT COUNT(*) FROM assistant_logs WHERE client_ts IS NOT NULL AND substr(client_ts,1,10) <> substr(created_at,1,10)` — офлайн үе байсан бол > 0 гарна.

---

## 7. ШАЛГАХ КОМАНД

```bash
# --- 0. Хамрах хүрээ ба бусад агент ---
git status --porcelain
git diff --stat

# --- 1. Migration дугаар сул эсэх ---
ls backend/migrations | tail -3
ls backend/migrations | grep -c '^0201' || echo "0201 сул"

# --- 2. Одоогийн зан төлөвийг ДАХИН батлах (өөрчлөхийн өмнө) ---
grep -n "" backend/src/routes/revit.ts | sed -n '1680,1740p'
grep -n "BINDS" backend/src/routes/revit.ts
grep -rn "assistant_logs" backend/migrations/*.sql | grep -i "alter\|create table"
grep -n "model_version\|JsonPropertyName(\"ts\")\|JsonIgnore" revit-mcp/addin/AssistantLog.cs
grep -n "Confidence = " revit-mcp/addin/IntentRouter.cs
grep -rn "AssemblyVersion\|<Version>" revit-mcp/addin/RevitMcpAddin.csproj || echo "хувилбар зарлаагүй — баталгаажлаа"

# --- 3. Локал шалгалт ---
cd backend
npm test                    # шинэ assistantLogInsert.test.ts багтана
npx tsc --noEmit            # алдаа ЗӨВХӨН хамааралгүй файлд байх ёстой

# --- 4. Локал D1 дээр migration турших (продакшнд хүрэхээс ӨМНӨ) ---
npm run db:migrate:all:local
node scripts/d1.mjs execute --local --command "PRAGMA table_info(assistant_logs)"

# --- 5. Deploy 1: migration (ЭХЛЭЭД) ---
npx wrangler d1 migrations apply mgl-progress-db-v3 --remote --config wrangler.toml
npx wrangler d1 execute mgl-progress-db-v3 --remote --config wrangler.toml \
  --command "PRAGMA table_info(assistant_logs)"

# --- 6. Deploy 2: worker (ЗӨВХӨН 5 амжилттай бол) ---
npx wrangler deploy --config wrangler.toml

# --- 7. Deploy-ийн дараах баталгаа (Revit-ээс нэг мессеж бичсэний дараа) ---
npx wrangler d1 execute mgl-progress-db-v3 --remote --config wrangler.toml \
  --command "SELECT id, model_version, addin_version, client_ts, created_at, decided_by
             FROM assistant_logs ORDER BY id DESC LIMIT 10"
npx wrangler d1 execute mgl-progress-db-v3 --remote --config wrangler.toml \
  --command "SELECT model_version, COUNT(*) n, SUM(decided_by='fallback') fb
             FROM assistant_logs GROUP BY model_version"
```

⚠️ Windows дээр `wrangler` бүрийг Bash sandbox идэвхгүйгээр ажиллуулна (OAuth token хэрэгтэй; сесс дундуур хугацаа нь дуусаж болно).

---

## 8. ROLLBACK

| Юу буцаах | Хэрхэн |
|---|---|
| **Кодын өөрчлөлт (deploy 2)** | Хамгийн сүүлийн ажилладаг commit-оос `npx wrangler deploy --config wrangler.toml`. Шинэ багана DB-д үлдэнэ — хуучин код тэднийг мэдэхгүй, `INSERT`-д оруулахгүй, NULLable тул **юу ч эвдрэхгүй**. Энэ бол аюулгүй, шууд буцаалт. |
| **Багана (deploy 1)** | ⚠️ **БУЦААХГҮЙ БАЙХЫГ ЗӨВЛӨЖ БАЙНА.** Хоосон, NULLable багана ямар ч хохирол учруулахгүй ба буцаах нь буцаахгүй байхаас илүү эрсдэлтэй. |
| Хэрэв ЗААВАЛ хасах бол | Эхлээд `DROP INDEX IF EXISTS idx_assistant_logs_model;` дараа нь `ALTER TABLE assistant_logs DROP COLUMN model_version;` гэх мэт. **ШИНЭ migration дугаар (0202/0203) ЗААВАЛ** — 0201-ийг засах нь продакшнд чимээгүй no-op. Хүснэгтийг дахин бүтээх (path B) хувилбарыг бүү сонго: `assistant_logs` нь `users`-ийн CASCADE хүүхэд. `DROP COLUMN`-ыг эхлээд хаягдах remote D1 дээр батал (repo-д ийм жишиг байхгүй). |
| Migration дундуур унасан | Файлд 3 `ALTER` + 1 `CREATE INDEX` байгаа тул хэсэгчлэн хэрэгжсэн байж болно. `PRAGMA table_info(assistant_logs)`-аар аль нь орсныг тодруулж, **ШИНЭ дугаартай** файлд ЗӨВХӨН дутууг нь бич. 0201-ийг ХЭЗЭЭ Ч бүү зас. |
| Тест унасан | `assistantLogInsert.test.ts` унах нь **үргэлж бодит алдаа** — тестийг сулруулж бүү зас, баганын жагсаалтыг зас. |

---

## 9. ЭХЛЭХИЙН ӨМНӨ ТОДРУУЛАХ

| # | Асуулт | Хэрхэн олох / хэнээс |
|---|---|---|
| 1 | **Продакшнд `assistant_logs`-д хэдэн мөр байна вэ?** Хэдэн ялгаатай хэрэглэгч, хэдэн хоногийн өгөгдөл вэ? Тэг эсвэл маш бага бол багана нэмэх нь өчүүхэн; хэдэн арван мянга бол `CREATE INDEX` хугацаа шаардана. **Repo-оос хариулах БОЛОМЖГҮЙ — продакшн асуулга.** | `npx wrangler d1 execute mgl-progress-db-v3 --remote --config wrangler.toml --command "SELECT COUNT(*) rows, COUNT(DISTINCT user_id) users, MIN(created_at) first, MAX(created_at) last, SUM(curated) curated FROM assistant_logs"` |
| 2 | **`assistant.logging` асаалттай юу?** `'off'` бол add-in бүртгэл илгээхгүй ба §6-ийн deploy-ийн дараах баталгаа ХООСОН гарна — тэр нь алдаа биш. `0195:162-167` нь `assistant.min_confidence='0.45'` ба `assistant.logging='on'`-ыг `INSERT OR IGNORE`-оор тавьдаг, гэхдээ түүнээс хойш гараар унтраасан байж болно. | `--command "SELECT key, value FROM app_settings WHERE key LIKE 'assistant.%'"` |
| 3 | **`assistant_models`-д хэдэн хувилбар байна, аль нь идэвхтэй, add-in-ууд түүнийг татсан уу?** Бүх мөр ижил `model_version` авах юм бол A/B-ийн үнэ цэн хойшилно. | `--command "SELECT id, version, is_active, accuracy, example_count, created_at FROM assistant_models ORDER BY id"` |
| 4 | **`ranked_json` баганыг ОДОО нэмэх үү, эсвэл 1C-д хойшлуулах уу?** (§2.8, §3.1). ОДОО нэмэх давуу тал: нэг migration, C# тал 1C-ийн ижил гаралтад багтана, bind 17 → 5 мөр/statement (85 ≤ 100, аюулгүй). Хойшлуулах давуу тал: энэ ажил бага, эрсдэл бага. **Эзний/tech lead-ийн шийдвэр.** | Эзэн / tech lead |
| 5 | Хэрэв 4-т «үгүй» гэвэл: **`confidence`-ыг зөвхөн `decided_by='model'` мөрөнд утгатай гэж үзэх бичигдсэн дүрэм** хэрэгтэй юу? Тэгэхгүй бол ирээдүйн «итгэл багатайг дахин сурга» эвристик буруу мөр сонгоно (§2.8). | Эзэн / tech lead |
| 6 | **`addin_version`-ийн ХЭЛБЭР ямар байх вэ?** Санал: `<SemVer>+<RevitYear>` (ж: `1.4.0+2027`) эсвэл git short SHA. Энэ нь 1C-ийн csproj `<Version>` зарлалтыг тодорхойлно. Багана нь `TEXT`, 32 тэмдэгтээр таслагдана — шийдвэр гарахаас өмнө хэлбэрийг барих код бичихгүй. | Эзэн / 1C сесс |
| 7 | **Migration дугаарын блок.** 1B-1 ба 1B-7 мөн дугаар авна. 0201 надад оногдсон уу, эсвэл өөр дугаар авах уу? | Хөтөлбөрийн зохион байгуулагч |
| 8 | **`client_ts` дээр `Date.parse` бүтэлгүйтвэл NULL болгох нь зөв үү, эсвэл мөрийг бүхэлд нь татгалзах уу?** Зөвлөмж: NULL (бүртгэл алдагдах ёсгүй — `AssistantLog.cs:49-52`). Батлуулах. | Эзэн |
| 9 | **`Sent` тугийн засвар (§2.6) 1C-ийн add-in гаралтад ЗААВАЛ орох уу?** Хоёр сесс нэг зурагтай байхын тулд бичгээр батлуулах. Одоогоор Revit сесс тутам хэрэглэгч бүрд 3000 хүртэл дэмий D1 бичилт. | 1C сесс / эзэн |
| 10 | **Retention.** `0195:17-20` нь «шошголсон мөрийг 90 хоногийн дараа гараар цэвэрлэж болно» гэсэн боловч **автомат цэвэрлэгээ БАЙХГҮЙ**. Гарал үүслийн багана нэмснээр өгөгдөл илүү үнэ цэнтэй болно — retention бодлогыг одоо тогтоох уу? | Эзэн |
