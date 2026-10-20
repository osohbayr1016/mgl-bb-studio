# 1B-1-event-store-schema — Event store схем — артефакт бүртгэл ба learning_events

> **Track:** 1B · DATA INTEGRITY (item 1)
> **Хамаарал:** 1A бүрэн дууссан байх (1A-1 … 1A-6). Энэ сесс 1A-гийн ямар ч файлыг хөндөхгүй.
> **Блоклож буй:** 1B-2 (event ingest + bind test), 1B-4 (training integrity), 1B-5 (golden datasets), 1B-6 (curation UI), 1B-7 (trust taxonomy). Схемгүйгээр эдгээрийн аль нь ч эхлэхгүй.
> **Хөндөх файлууд:** `backend/migrations/0201_bim_artifacts.sql` (ШИНЭ), `backend/migrations/0202_learning_events.sql` (ШИНЭ). **ӨӨР ФАЙЛ БАЙХГҮЙ.**
> **Deploy тоо:** 1 (зөвхөн `d1 migrations apply --remote`). Worker deploy ХИЙХГҮЙ — уншигч код энэ сесст бичигдэхгүй.

---

## 0. ЭНЭ СЕССИЙН ДҮРЭМ

| # | Дүрэм |
|---|---|
| 1 | **Зөвхөн хоёр ШИНЭ migration файл үүсгэнэ.** `backend/src/**` дэх нэг ч мөр өөрчлөгдөхгүй. Route, тест, тип, frontend — юу ч биш. |
| 2 | **Энэ репод хэд хэдэн агент зэрэг ажилладаг.** Working tree дотор чиний ажилтай огт хамаагүй, эмхэтгэгдэхгүй байж болох дуусаагүй өөрчлөлт байж болно. Тэднийг **бүү зас, бүү форматла, бүү цэвэрлэ**. |
| 3 | **`git restore`, `git checkout --`, `git stash`, өөрийн үүсгээгүй файлыг `git add` — ХЭЗЭЭ Ч ҮГҮЙ.** |
| 4 | **Бүтэн build унасан нь автоматаар таных биш.** `tsc -b` бүх апп-ыг эмхэтгэдэг тул чиний хөндөөгүй файл дээр унаж болно. Алдаанууд ӨӨР файлд байгаа эсэхийг батлаад, эзэнд нь хэл — араас нь бүү хөө. Энэ сесс TypeScript огт хөндөхгүй тул `tsc` алдаа 100% чинийх БИШ. |
| 5 | **Deploy хийж болох уу:** ТИЙМ, гэхдээ **зөвхөн `d1 migrations apply --remote`**. `wrangler deploy` (worker) ХИЙХГҮЙ. |
| 6 | **`purpose === 'mcp'` токеныг `/api/*`-д татгалзуулах өөрчлөлт энэ сесст ОГТ хамаагүй.** Хэрэв ямар нэг байдлаар тийм санаа гарвал — зогс. Add-in бүх REST дуудлагаа тэр токеноор хийдэг, refresh урсгал байхгүй, ~20 компьютер дээр `Install.bat`, Revit хаалттай. Алсаас сэргээх боломжгүй цорын ганц өөрчлөлт. |
| 7 | **`users` эсвэл `projects`-ыг `migrations apply`-аар дахин барихгүй.** Энэ сессийн миграцууд тэдгээрийг огт хөндөхгүй, `ALTER` ч хийхгүй. |
| 8 | **Миграцын дугаар авахын өмнө `ls backend/migrations \| tail -3` заавал ажиллуул.** Ах дүү сессүүд ч дугаар авч байгаа. Доор бичсэн 0201/0202 нь энэ бичиг бичигдэх үеийн (2026-08-27) чөлөөт дугаар — баталгаа биш. |

---

## 1. КОНТЕКСТ

### 1.1 Систем (хүйтэн сессэд хангалттай хэмжээгээр)

| Хэсэг | Юу вэ |
|---|---|
| `backend/` | Cloudflare Worker. Hono, `@cloudflare/workers-oauth-provider`-оор ороосон. D1 (SQLite) + R2 (`MEDIA_BUCKET` = **нийтэд нээлттэй**, `MEETING_BUCKET` = **хувийн**) + KV + нэг Durable Object (`MglMcpAgent`). |
| `frontend/` | Vite + React 19 SPA, Cloudflare Pages, төсөл нь **`mgl-design-system`** (`--project-name mgl-design-system`-ийг ЗААВАЛ илт дамжуулна). |
| `revit-mcp/addin/` | Revit 2024–2027 add-in. C#/WPF, процесс дотор. **43 `.cs` файл, 13,463 мөр** (өмнөх аудитын «47 файл / ~16k мөр» нь бага зэрэг хэтрүүлэг — `find revit-mcp/addin -name "*.cs" -not -path "*/obj/*" -not -path "*/bin/*"`-аар шалгав). Тест **тэг**. Албадан шинэчлэх механизм **байхгүй**. |
| `revit-mcp/training/` | Python-ий санаа таних ангилагчийн сургалтын урсгал, git-д хянагддаг. |
| `revit-mcp/server/`, `revit-mcp/agent/` | Python MCP гүүр ба бие даасан локал агент. |
| Хүн хүч | Идэвхтэй `engineer` 15 + `architect` 22 + `senior` 12 = **49 мэдлэгийн ажилтан** (локал прод хуулбар дээр `SELECT role, status, COUNT(*) FROM users GROUP BY 1,2`). Нэмээд `admin` 8, `client` 7. |
| Прод D1 | `mgl-progress-db-v3`, `database_id = 03167f58-753b-4f99-a6f9-fb361bf2a453` (`backend/wrangler.toml:49-50`). Локал хуулбар: **45,191,168 байт (≈43 МиБ), 112 хүснэгт, нийт 70,706 мөр**. Хамгийн том хүснэгт `progress_entries = 8,062` мөр. |

### 1.2 Яагаад энэ ажил байгаа вэ — ДАРААЛАЛ бол гол цэг

Сурах гогцооны суурь нь «юу болсон бэ»-г **дарааллаар нь** мэдэх явдал. Өнөөдөр систем үүнийг **мэдэхгүй**, архитектурын хувьд мэдэх ч боломжгүй. Дэлгэрэнгүйг §2.1-ээс уншина уу: `revit-mcp/addin/ChangeTracker.cs` бол **хувьсагч хуримтлуулагч (mutable accumulator)**, үйл явдлын бүртгэл БИШ.

«хана үүсгэв → зөөв → хаалга нэмэв → senior залруулав → батлав» гэсэн гинж бол зан төлөв, залруулга, санаа, ажлын урсгал, шалтгаан-үр дагаврын сургалт **бүгдийн суурь**. Тэр гинж өнөөдөр хадгалагдахгүй.

### 1.3 Схем нь ЦЭВЭР ЗАГВАР БИШ, СИНТЕЗ — үүнийг шударгаар мэдэж ав

Гурван хэлбэр үнэлэгдсэн:

| Хэлбэр | Operability | Privacy | ML-utility |
|---|---|---|---|
| **SPINE** — нэг append-only `learning_events` + R2 артефакт + generated VIRTUAL багана | **7.5** | **7** | 6 |
| **SATELLITES** — төрөл тус бүрд тусдаа хүснэгт | доогуур | доогуур | **9** |

**Шийдвэр: SPINE-ыг суурь болгож, SATELLITES-аас тодорхой залгаас (graft) авна.** SPINE 3 линзийн 2-т ялсан ч ML-ийн ашиг тусаар 6 : 9-ээр ХОЖИГДСОН. Тэр зөрүүг хаах залгаас нь **generated VIRTUAL багана**: `payload_json`-оос гаргасан индекслэгдэх багана нь satellite хүснэгтүүдийн өгдөг «шууд шүүх, шууд JOIN хийх» чадварыг schema-migration-гүйгээр өгнө (§2.5-д хэмжигдсэн).

Хэрэгжүүлж буй сесс үүнийг мэдэх ёстой: **энэ бол буулт**. Хэрэв ирээдүйд нэг төрөл (жишээ нь `REVIT_STATE`) satellite хүснэгт үнэхээр шаардвал, тэр нь энэ схемийн бүтэлгүйтэл биш — урьдчилан төлөвлөсөн өргөтгөл. `learning_events.id` нь тэр хүснэгтийн гадаад холбоос болно.

### 1.4 Схем ЭХНИЙ ӨДРӨӨС илэрхийлж чадах ёстой зүйлс

**Есөн төрөл, бүгд `kind` баганад:** `TEXT`, `IMAGE`, `SKETCH`, `REVIT_STATE`, `USER_ACTION`, `AI_ACTION`, `HUMAN_CORRECTION`, `RULE_VALIDATION`, `FINAL_APPROVAL`.

Мөн: **дараалал** (`stream_id` + `seq` + глобал `id`), **эцгийн заагч** (`parent_event_id`), **шалтгааны заагч** (`causal_event_id`).

⚠️ **Схем нь системийг «text → intent → label» хэлбэрт ТҮГЖИХ ЁСГҮЙ.** Одоогийн `assistant_logs` (миграц 0195) яг тэр хэлбэртэй: `text` / `predicted` / `corrected`. Тэр нь өнөөгийн ангилагчид тохирсон, гэхдээ зураг, ноорог, загварын төлөв, дүрмийн шалгалт, батлалтыг илэрхийлж **чадахгүй**. `learning_events`-ийн `payload_json` + `kind` + артефакт заагч гурав нь тэр хязгаарлалтыг арилгана. `assistant_logs`-ыг **бүү устга, бүү нүүлгэ** — тэр нь 1B-3-ын ажил.

---

## 2. БАТАЛГААЖСАН ОДООГИЙН ЗАН ТӨЛӨВ

> Доорх `file:line` бүрийг энэ сесс өөрөө нээж баталгаажуулав (2026-08-27).

### 2.1 `ChangeTracker` бол үйл явдлын бүртгэл БИШ — хувьсагч хуримтлуулагч

**`revit-mcp/addin/ChangeTracker.cs`, 819 мөр.** Элемент тус бүрийн мэдээлэл `Dictionary<long, Touch> Meta` дотор (`ChangeTracker.cs:138`).

**(a) `Note` нь үйлдлийн индекс ба цагийг ДАРЖ БИЧНЭ** — `ChangeTracker.cs:167-183`:

```csharp
public void Note(long id, int opIdx, long sec)
{
    Touch prev;
    bool known = Meta.TryGetValue(id, out prev);
    int hits = known ? prev.Hits : 0;
    int depth = known ? prev.Depth : 0;

    if (Meta.Count >= MaxMetaEntries && !known)
    {
        MetaTruncated = true;
        return;
    }
    // ⚠️ Хэт өсөхөөс сэргийлнэ — 65535 удаа хөндсөн нь скрипт л байна.
    if (hits < 65535) hits++;
    if (depth < 65535) depth++;
    Meta[id] = new Touch { Op = opIdx, Sec = sec, Hits = hits, Depth = depth };   // ← :182
}
```

`ChangeTracker.cs:182` — `Op` ба `Sec` нь **шинэ утгаараа солигдоно**. Өмнөх утга хадгалагдах газар байхгүй. Элемент дээр «Move» → «Change Wall Type» → «Delete» гэсэн гурван үйлдэл хийвэл **зөвхөн сүүлийнх нь** үлдэнэ.

| Юу СЭРГЭЭГДЭХ вэ | Юу СЭРГЭЭГДЭХГҮЙ вэ |
|---|---|
| `Hits` — нийт хэдэн удаа хөндсөн (тоо) | Үйлдлүүдийн **дараалал** |
| `Depth` — undo-гүй цэвэр өөрчлөлтийн гүн | Эхний ба завсрын timestamp |
| **Сүүлийн** үйлдлийн нэр (`Ops` индексээр) | Аль нь AI, аль нь хүний үйлдэл байсан |
| **Сүүлийн** timestamp (секундийн нарийвчлал) | Элементүүд хоорондын шалтгаан холбоо |

**(b) `UndoTouch` нь гүн тэг болоход бичлэгийг БҮРЭН УСТГАНА** — `ChangeTracker.cs:195-207`, дуудагч нь `ChangeTracker.cs:790-797`:

```csharp
if (c.UndoTouch(v, sec))
{
    c.Modified.Remove(v);
    c.Meta.Remove(v);        // ← :795
}
```

Мөн `ChangeTracker.cs:766` — энэ сесст **үүсгээд дараа нь устгасан** элемент:

```csharp
if (c.Added.Remove(v)) { c.Meta.Remove(v); continue; }   // ← :766
```

ба `ChangeTracker.cs:749` — устгалыг undo-гоор буцаасан тохиолдол: `if (c.Deleted.Remove(v)) c.Meta.Remove(v);`

**Үр дүн: ОРХИГДСОН ОРОЛДЛОГО ЯМАР Ч УЛ МӨР ҮЛДЭЭХГҮЙ.** Инженер хана байрлуулж, буруу гэж үзээд Ctrl+Z дарвал — тэр шийдвэр, тэр эргэлзээ, тэр сурах боломж **бүрмөсөн алга болно**. Сургалтын өгөгдлийн хувьд орхигдсон оролдлого нь батлагдсан үр дүнгээс дутуугүй үнэ цэнтэй.

**(c) `capture_baseline` нь хянаж буй олонлогийг тэглэнэ** — `ChangeTracker.cs:325-341`:

```csharp
public static void Reset(Document doc, int elementCount)
{
    ...
    States[key] = new Change
    {
        BaselineAtUtc = DateTime.UtcNow,
        BaselineElementCount = elementCount,
    };
    ...
}
```

`States[key]` нь **шинэ `Change` объектоор солигдоно** — `Added`/`Deleted`/`Modified`/`Meta`/`Ops` бүгд хоосон болно. Дуудлагын гинж:

| Байрлал | Юу |
|---|---|
| `revit-mcp/addin/RevitTools.cs:258` | `CaptureBaseline(doc)` → `ChangeTracker.Reset(doc, count)` |
| `revit-mcp/addin/RevitTools.cs:298` | `DiffSinceBaseline` — суурь олдоогүй бол мөн `Reset` |
| `revit-mcp/addin/AssistantPane.xaml.cs:1295` | **Илгээсний ДАРАА:** `try { await Task.Run(() => RevitApi.CallTool("capture_baseline")); } catch { }` |
| `revit-mcp/addin/BindingCommand.cs:112` | `RevitTools.Run(..., "capture_baseline", "{}")` |
| `revit-mcp/addin/ChangeTracker.cs:626` | Баримт нээгдэхэд, дискэн дээр төлөв байхгүй бол |

`AssistantPane.xaml.cs:1293-1294`-ийн тайлбар зорилгыг илт хэлнэ:

```csharp
// Илгээсний дараа суурийг ДАХИН тавина: маргаашийн «юу
// өөрчлөгдсөн» нь өнөөдрөөс эхэлж тоологдоно.
```

**Тоон дүгнэлт.** Нэг илгээлтийн дараа тухайн өдрийн бүх элемент-түвшний ул мөр **устана**. Үлдэх зүйл нь `revit_submissions`-д хадгалагдсан нэгтгэсэн `change_json` (§2.3) — үүнийг элементийн гинж рүү задлах боломжгүй.

**Хязгаарууд:** `MaxMetaEntries = 20000` (`ChangeTracker.cs:74`) — түүнээс дээш шинэ элемент **чимээгүй хаягдана** (`MetaTruncated = true`). `MaxOpNames = 200` (`ChangeTracker.cs:77`).

### 2.2 Дөрвөн механизм 190 миграцын АЛИНД Ч БАЙХГҮЙ

```
$ ls backend/migrations | wc -l
190
$ ls backend/migrations | tail -5
0196_repair_daily_basis.sql
0197_company_stamp_setting.sql
0198_attendance_clockout_announcement.sql
0199_user_work_schedules.sql
0200_assistant_feedback_note.sql
$ grep -rilE "CREATE TRIGGER|CREATE VIEW|GENERATED ALWAYS|json_extract" backend/migrations | wc -l
0
```

**Тэг файл.** `json_valid` ч мөн адил тэг. Энэ схем **дөрвүүлэнг нь нэг дор** ашиглах гэж байгаа тул репогийн хамгийн эрсдэлтэй миграц болно. §3.1-ийн урьдчилсан баталгаажуулалт **заавал**.

⚠️ Сонирхолтой ул мөр: `backend/migrations/0195_assistant_learning.sql:138`-ийн тайлбар «ЗӨВХӨН НЭГ загвар идэвхтэй байна (**доорх trigger барина**)» гэж бичсэн атлаа доор нь **хэсэгчилсэн UNIQUE индекс** байна (`idx_assistant_model_active`). Trigger хэзээ ч бичигдээгүй. Энэ нь «тайлбар нь кодоо гүйцэхгүй» гэсэн репогийн ердийн зан төлөв — доорх бүх тайлбарыг өөрөө шалга.

### 2.3 Одоо байгаа Revit хүснэгтүүд (хамаарал тогтооход хэрэгтэй)

| Хүснэгт | Хамааралтай тал |
|---|---|
| `revit_documents` | `doc_uid`, `project_id`, `team_code`. `learning_events.doc_uid` эндхийн утгыг давтана. `project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE`. |
| `revit_sheet_bindings` | Хуудас ↔ ажлын холбоос. `routes/revit.ts:58-59`-ийн bind тааруулга үүнд хамаарна. |
| `revit_submissions` | `change_json TEXT NOT NULL DEFAULT '{}'`, `evidence_json TEXT NOT NULL DEFAULT '[]'`, `sheet_uids_json` — **НЭГТГЭСЭН агшин**, гинж биш. |
| `revit_agent_turns` (миграц 0193) | LLM эргэлт бүрийн токен/провайдер. `user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE` (`0193_revit_agent_turns.sql:19`). |
| `assistant_logs`, `assistant_examples`, `assistant_models` (миграц 0195) | Санаа таних сурах гогцоо. **1B-3-ын нутаг — бүү хөнд.** |

### 2.4 D1 / wrangler-ийн БАТАЛГААЖСАН хязгаарууд

**(a) 100 bind параметр / statement.** Одоо байгаа тааруулгууд:

| Байршил | Утга | Тэмдэглэл |
|---|---|---|
| `backend/src/routes/qto.ts:860-861` | `for (let i = 0; i < facts.length; i += 4)` — **21 багана × 4 мөр = 84** | `INSERT INTO qto_facts` 21 багана жагсаана |
| `backend/src/routes/qto.ts:873-880` | 6 bind × 16 = 96. Тайлбар зөв: `// 6 bind/мөр × 16 = 96 ≤ 100.` | |
| `backend/src/routes/revit.ts:58-59` | `const BINDS_PER_BINDING_ROW = 13;` / `Math.floor(100 / BINDS_PER_BINDING_ROW); // = 7` | Тайлбар зөв |
| `backend/src/routes/revit.ts:1929-1930` | `const BINDS = 7;` тайлбар `// 7 bind/мөр → 14 мөр/statement.` | Зөв |

⚠️ **БАТАЛГААЖСАН ЗӨРҮҮ.** `backend/src/routes/revit.ts:1702-1707`:

```ts
  // 12 bind/мөр → floor(100/12) = 8 мөр/statement (D1-ийн 100 bind хязгаар).
  // ⚠️ БАГАНА НЭМБЭЛ ЭНЭ ТООГ ЗАСАХ ЁСТОЙ.  D1-ийн нэг statement 100
  // bind-аар хязгаарлагдана; 13 × 7 = 91 ≤ 100.
  const BINDS = 13;
  const PER = Math.floor(100 / BINDS);
```

Тайлбарын **эхний мөр (12 → 8) нь буруу**; хоёр дахь мөр (13 × 7 = 91) ба тогтмол (`13`) нь зөв. Ажиллаж буй утга нь `PER = 7`. **Аль нэгийг нь бүү хуул — тогтмолыг нь уншиж, тайлбарт нь бүү итгэ.** (Энэ сесс кодыг зассангүй: хамрах хүрээнээс гадуур. 1B-2-т мэдэгд.)

**(b) Миграц нь append-only.** Хэрэгжсэн файлыг засах нь продакшн дээр **чимээгүй no-op** (`d1_migrations` дахь нэрээр шалгагддаг). Дунд нь унасан файл нь санг **хагас нүүлгэсэн** байдалд орхино; хууль ёсны цорын ганц засвар нь **ШИНЭ дугаар**.

**(c) `CREATE TABLE` / `CREATE INDEX` / `CREATE TRIGGER` бүр `IF NOT EXISTS`-тэй.**

**(d) Байгаа хүснэгт дээрх `ALTER` нь блокийн ЭХЭНД** — бүтэлгүйтэл нь хоосон хүснэгт үүсэхээс өмнө таслах ёстой. Энэ сессийн хоёр миграц аль нь ч байгаа хүснэгтийг `ALTER` хийхгүй тул энд хоосон дүрэм; 1B-2 дээр хүчинтэй.

**(e) D1 нь runtime дээр гадаад түлхүүрийг ХЭРЭГЖҮҮЛДЭГГҮЙ, ГЭВЧ `migrations apply` нь файл бүрийг гүйлгээнд ороодог бөгөөд тэнд `ON DELETE CASCADE` АЖИЛЛАДАГ.** Локал прод хуулбар дээр `PRAGMA foreign_key_list`-аар хэмжсэн:

```
projects <- CASCADE: 38 ,  SET NULL: 3 ,  NO ACTION: 1
users    <- CASCADE: 25 ,  SET NULL: 12,  NO ACTION: 63
```

⚠️ Локал хуулбарт `0194`/`0195` хэрэгжээгүй (`assistant_logs`, `assistant_examples`, `assistant_models`, `repair_projects` **алга**), тиймээс `users`-ийн бодит тоо прод дээр **27** байх нь нийцтэй (`0195_assistant_learning.sql:72`-ийн `assistant_logs.user_id … ON DELETE CASCADE` гэх мэт). `projects = 38` яг таарч байна. **Хоёуланг нь `migrations apply`-аар дахин бүү бари.**

**(f) wrangler-ийн compound statement задлагч ҮСЭГ ЯЛГАНА.** `backend/node_modules/wrangler/wrangler-dist/cli.js:182776-182781`-ийн ЯГ код:

```js
function isCompoundStatementStart(str) {
  return /\s(BEGIN|CASE)\s$/i.test(str);      // ← үсэг ЯЛГАХГҮЙ, хоёр талдаа зайтай
}
function isCompoundStatementEnd(str) {
  return /\sEND[;\s]$/.test(str);             // ← `i` тугГҮЙ = ТОМ ҮСЭГ ЗААВАЛ, өмнө нь зай ЗААВАЛ
}
```

Эдгээр регексийг задлагчийн жинхэнэ гогцоотой (`cli.js:182690-182752`) хамт симуляц хийсэн үр дүн:

| Бичсэн хэлбэр | Гарсан statement |
|---|---|
| `\nEND;` өөрийн мөрөнд, ТОМ үсгээр | **3** — `CREATE TABLE`, `CREATE TRIGGER`, `CREATE INDEX` ✅ |
| `\nend;` жижиг үсгээр | **2** — араас нь ирэх `CREATE INDEX` нь trigger дотор **залгигдана** ❌ |
| `RAISE(...);END;` (өмнө нь зайгүй) | **2** — мөн адил залгигдана ❌ |

Залгигдсан statement нь SQLite-д синтаксын алдаа өгч, файл **дунджаа унана** → §2.4(b)-ийн хагас нүүлгэсэн байдал. **`END;` — ТОМ үсгээр, өөрийн мөрөнд.**

**(g) Deploy нь ЛОКАЛ wrangler, CI БИШ.** `.github/workflows/deploy-*.yml` хоёул үхмэл. `--config wrangler.toml`-ийг **заавал** илт дамжуулна: репогийн үндэсд байгаа `wrangler.jsonc` өөр worker зарладаг бөгөөд wrangler-ийн config хайлт түүнийг сонгож болно. `wrangler deploy` нь **typecheck хийхгүй**. `wrangler pages *` бүрийг `npx -y wrangler@latest`-ээр ажиллуулна.

### 2.5 Механизмуудын ЛОКАЛ БАТАЛГААЖУУЛАЛТ (node:sqlite 3.53.1)

Дараах бүгдийг энэ сесс `node:sqlite`-аар ажиллуулж баталгаажуулав. **D1-ийн SQLite build өөр байж болно — §3.1-ийн алсын баталгаажуулалт заавал.**

| # | Шалгалт | Үр дүн |
|---|---|---|
| 1 | `ALTER TABLE … ADD COLUMN … GENERATED ALWAYS AS (…) STORED` | ❌ `cannot add a STORED column` |
| 2 | `ALTER TABLE … ADD COLUMN … GENERATED ALWAYS AS (…) VIRTUAL` | ✅ зөвшөөрөгдөнө |
| 3 | VIRTUAL багана дээр `CREATE INDEX` | ✅ ба `EXPLAIN QUERY PLAN` → `SEARCH … USING INDEX` |
| 4 | Индекстэй байхад `ALTER TABLE … DROP COLUMN` | ❌ `error in index …: no such column` |
| 5 | `DROP INDEX` хийсний **дараа** `DROP COLUMN` | ✅ |

⚠️ **«Нэг чиглэлтэй (one-way)» гэдэг нь бага зэрэг хатуу тодорхойлолт.** Индекс/view байхад `DROP COLUMN` татгалзана, гэхдээ **индексийг эхлээд устгавал багана устна**. Практикт энэ нь «нэг чиглэлтэй» биш, харин «**хоёр алхам, өөрөөр хэлбэл дараагийн миграц**» гэсэн үг. Ямар ч тохиолдолд буцаах нь үнэгүй биш — VIRTUAL багана нэмэхээсээ өмнө бодох ёстой хэвээр.

**Generated VIRTUAL баганын жинхэнэ давуу тал:** bind ЗАРЦУУЛАХГҮЙ (`INSERT`-д огт бичигдэхгүй) бөгөөд **индекслэгдэнэ**. §2.4(a)-ийн 100 bind хязгаарын дор энэ нь чухал: `payload_json`-оос 5 талбар гаргаж авахад bind-ийн төсөв нэг ч нэмэгдэхгүй.

### 2.6 БЛОКЛОГЧ АЛДАА — `BEFORE UPDATE OF` + `ON DELETE SET NULL` = эцгийн DELETE бүхэлдээ унана

Энэ загварын анхны төсөлд байсан алдаа. **Дахин үйлдсэн код (node:sqlite, `PRAGMA foreign_keys = ON`):**

```js
db.exec(`PRAGMA foreign_keys = ON;`);
db.exec(`
CREATE TABLE users (id INTEGER PRIMARY KEY);
CREATE TABLE learning_events (
  id INTEGER PRIMARY KEY,
  actor_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,   -- ← гэм буруутан
  payload_json TEXT NOT NULL,
  redacted_at TEXT
);
CREATE TRIGGER learning_events_immutable
BEFORE UPDATE OF actor_user_id, payload_json ON learning_events    -- ← тодорхой баганын жагсаалт
BEGIN
  SELECT RAISE(ABORT, 'learning_events is append-only');
END;
`);
db.exec(`INSERT INTO users (id) VALUES (1);`);
db.exec(`INSERT INTO learning_events (id, actor_user_id, payload_json) VALUES (1, 1, '{}');`);
db.exec(`DELETE FROM users WHERE id = 1;`);
```

**Гарсан үр дүн:**

```
A) parent DELETE ABORTED -> learning_events is append-only
   users left = 1 , events left = 1
```

**Механизм:** `SET NULL` каскад нь хүүхэд мөрийн **UPDATE** болж гүйцэтгэгддэг. Тэр UPDATE нь `actor_user_id` баганад хамаарах тул `BEFORE UPDATE OF actor_user_id` trigger ажиллаж `ABORT` өгнө. Үр дүнд нь **эцэг мөрийг устгах ямар ч оролдлого унана** — хэрэглэгч устгах, төсөл устгах, бүгд.

**Яагаад энэ нь аппликейшнд ҮЛ ҮЗЭГДЭХ вэ:** D1 нь runtime дээр FK хэрэгжүүлдэггүй тул `DELETE FROM users …` энгийн worker дуудлагаар унахгүй. **ГЭВЧ `d1 execute --remote --file` нь pragma-г хүндэтгэдэг** — тэр нь `users`/`projects`-ыг дахин барих **path-B runbook**-ийн яг тэр зам. Өөрөөр хэлбэл алдаа нь хамгийн эмзэг, хамгийн ховор, хамгийн эргэлт буцалтгүй үйлдлийн дундуур л илэрнэ.

**ШИЙДВЭР: `REFERENCES` зарлалтуудыг БҮРЭН ХАСНА, энгийн `INTEGER` багана болгоно.** D1 runtime дээр юу ч хэрэгжүүлдэггүй тул багана нь **юу ч алдахгүй**, харин энэ бүхэл ангийн харилцан үйлчлэл алга болно. Баталгаажуулалт:

```
B) REFERENCES-гүй parent DELETE: OK
   actor_user_id = 1        ← утга хэвээр үлдэв (өнчирсөн заагч, зориудаар)
```

Өнчирсөн заагч нь **зөв зан төлөв**: сурах гогцоонд «энэ үйл явдлыг хийсэн хэрэглэгчийн бүртгэл дараа нь устсан» гэдэг нь үйл явдлыг устгах шалтгаан биш.

### 2.7 Trigger-ийн ХОЁР ДАХЬ алдаа — тодорхой баганын жагсаалт ирээдүйг хамгаалахгүй

Баталгаажуулсан:

```
CREATE TRIGGER f_imm BEFORE UPDATE OF payload_json ON f BEGIN SELECT RAISE(ABORT,'append-only'); END;
ALTER TABLE f ADD COLUMN sequence_no INTEGER;
UPDATE f SET sequence_no = 999 WHERE id = 1;
→ OF жагсаалт: шинэ багана ЧӨЛӨӨТЭЙ засагдлаа (алдаа батлагдав)
```

Энэ бол **энэ репогийн гарын үсэг болсон бүтэлгүйтлийн хэлбэр жижигрүүлсэн байдлаар**: жагсаалт бичээд, дараа нь нэмэгдсэн зүйл жагсаалтад орохгүй, хэн ч анзаарахгүй (`CLAUDE.md` дахь «11 хуулбар», «5 файлын sandbox», «гурван twin surface» бүгд ижил хэлбэр).

**ШИЙДВЭР: `BEFORE UPDATE` (баганын жагсаалтГҮЙ) + `WHEN` заалт нь ОНЦГОЙ ТОХИОЛДЛЫГ нэрлэнэ.**

### 2.8 Хувийн нууцын үл хөдлөх дүрэм — элементийн үйл ажиллагаа нь ЗӨВХӨН ӨӨРИЙГӨӨ ХАРАХАД

`backend/src/lib/revitNoteAi.ts:144-154`:

```ts
/**
 * AI-ийн бичвэрт зөвшөөрөгдөх «N ширхэг» тоонууд.
 *
 * ⚠️ ОДОО ҮРГЭЛЖ ХООСОН.  Тайланд элементийн тоо байх ЁСГҮЙ тул хоосон
 * жагсаалт нь `isAcceptableNote`-д «ямар ч ширхэгийн тоо хориотой» гэсэн
 * үг болно — AI өөрөө тоо нэмж оруулбал бичвэр бүхэлдээ хаягдана.
 * Функцийг УСТГААГҮЙ: дүрэм өөрчлөгдвөл энэ нэг цэгээс залгагдана.
 */
export function allowedCountsOf(_f: NoteFacts): number[] {
  return [];
}
```

Дуудагдах газар: `backend/src/lib/revitNoteAi.ts:308` — `if (!isAcceptableNote(raw, facts.percent, allowedCountsOf(facts))) return base;`
Тестээр түгжигдсэн: `backend/src/lib/revitNoteAi.test.ts:262-263` — `test('allowedCountsOf: ЯМАР Ч тоо зөвшөөрөгдөхгүй', () => { assert.deepEqual(allowedCountsOf(digestFacts), []); });`

**Энэ бол шипсэн бүтээгдэхүүний шийдвэр, санамсаргүй зүйл биш: ҮЙЛДЛИЙН ТОО БҮТЭЭМЖ БИШ. Элемент түвшний үйл ажиллагаа нь зөвхөн өөрийгөө хараханд зориулагдана, ахлагчийн тайланд ХЭЗЭЭ Ч хүрэхгүй.** `learning_events` нь яг тэр өгөгдлийг эрэмбэлж, дараалалтайгаар хадгалах гэж байгаа тул энэ дүрмийг схемийн түвшинд авч явах ёстой (§3.3).

### 2.9 Артефактын түлхүүр — одоогийн схемийг ӨВЛӨЖ БОЛОХГҮЙ

`backend/src/routes/upload.ts:33` ба `:136`:

```ts
const fileName = `${user.sub}-${Date.now()}-${file.name.replace(/[^a-zA-Z0-9.-]/g, '_')}`;
```

`backend/src/routes/upload.ts:13-16`:

```ts
function pickBucket(env: Env, raw: unknown): { bucket: R2Bucket; name: 'media' | 'meeting' } {
  if (raw === 'meeting' && env.MEETING_BUCKET) return { bucket: env.MEETING_BUCKET, name: 'meeting' };
  return { bucket: env.MEDIA_BUCKET, name: 'media' };
}
```

Гурван асуудал: (1) түлхүүр нь **агуулгаас хамаардаггүй** тул ижил байт хоёр удаа хадгалагдана; (2) `user.sub` нь түлхүүрт **шингэсэн** — `GET /media/:key` нь **баталгаажуулалтгүй, дэлхийд нээлттэй** тул түлхүүр өөрөө мэдээлэл алдагдуулна; (3) анхдагч нь **нийтэд нээлттэй** `MEDIA_BUCKET`.

`backend/src/routes/media.ts:55` — `media.get('/:key', …)` нь **нэг л замын хэсэгтэй** таарна. Энэ нь нэгэн зэрэг аюулгүй байдлын хяналт ба алдааны эх сурвалж; `MEDIA_BUCKET`-д хувийн объект **хэзээ ч** тавихгүй.

`backend/src/` дотор агуулгын хэш (`crypto.subtle.digest('SHA-256', bytes)`) **байхгүй** — `SHA-256` зөвхөн HMAC/ECDSA/HKDF-д гарна (`lib/jwt.ts:10`, `lib/webPush.ts:201,236`, `lib/google/googleAuth.ts:99`). Өөрөөр хэлбэл контент-хаягтай хадгалалт нь **шинэ** чадвар.

---

## 3. ХИЙХ АЖИЛ

### 3.0 Дугаар авах

```bash
ls backend/migrations | tail -3
```

Энэ бичиг бичигдэх үед сүүлийнх нь `0200_assistant_feedback_note.sql`. Тиймээс:

| Файл | Агуулга |
|---|---|
| `backend/migrations/0201_bim_artifacts.sql` | Артефактын бүртгэл |
| `backend/migrations/0202_learning_events.sql` | Үйл явдлын нуруу |

**Ах дүү сессүүд ч дугаар авч байгаа.** `tail -3` өөр зүйл харуулбал дараагийн чөлөөт хосыг ав.

**Хоёр файл болгосон шалтгаан:** `learning_events.artifact_id` нь `bim_artifacts`-ыг заана. `REFERENCES` бичихгүй (§2.6) тул техникийн хамаарал байхгүй ч, унших дараалал ба rollback-ийн нэгж болгож салгах нь зөв (§8).

### 3.1 ⚠️ ЭХЛЭЭД: ХАЯГДАХ АЛСЫН D1 ДЭЭР МЕХАНИЗМЫГ БАТАЛ

Дөрвөн механизм (`CREATE TRIGGER`, `GENERATED ALWAYS`, `json_extract`, `json_valid`) 190 миграцын **аль нь ч байхгүй** (§2.2). Локал `node:sqlite` (3.53.1) дээр ажилласан нь D1-ийн SQLite build дээр ажиллана гэсэн **баталгаа биш** — D1 нь өөрийн build-тэй, `SQLITE_OMIT_*` тохиргоо нь баримтжаагүй.

**Миграц бичихийн ӨМНӨ:**

```bash
npx wrangler d1 create bimai-probe --config backend/wrangler.toml
npx wrangler d1 execute bimai-probe --remote --config backend/wrangler.toml --file=probe.sql

npx wrangler d1 execute bimai-probe --remote --config backend/wrangler.toml \
  --command "SELECT id, intent, sheet_uid FROM probe_events"
npx wrangler d1 execute bimai-probe --remote --config backend/wrangler.toml \
  --command "UPDATE probe_events SET payload_json='{}' WHERE id=1"    # ← ABORT ӨГӨХ ЁСТОЙ
npx wrangler d1 execute bimai-probe --remote --config backend/wrangler.toml \
  --command "EXPLAIN QUERY PLAN SELECT id FROM probe_events WHERE intent='x'"   # ← USING INDEX

npx wrangler d1 delete bimai-probe --config backend/wrangler.toml
```

`probe.sql`:

```sql
CREATE TABLE IF NOT EXISTS probe_events (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  payload_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(payload_json)),
  redacted_at  TEXT,
  intent       TEXT GENERATED ALWAYS AS (json_extract(payload_json, '$.intent'))    VIRTUAL,
  sheet_uid    TEXT GENERATED ALWAYS AS (json_extract(payload_json, '$.sheet_uid')) VIRTUAL
);

CREATE INDEX IF NOT EXISTS idx_probe_intent ON probe_events(intent) WHERE intent IS NOT NULL;

CREATE TRIGGER IF NOT EXISTS probe_append_only
BEFORE UPDATE ON probe_events
WHEN NEW.redacted_at IS NULL
BEGIN
  SELECT RAISE(ABORT, 'probe is append-only');
END;

INSERT INTO probe_events (payload_json) VALUES ('{"intent":"x","sheet_uid":"БА-01"}');
```

⚠️ Probe-ыг `--file`-ээр нэг удаа, дараа нь **`migrations apply`-аар** дахин ажиллуулж давхар шалга — задлагчийн зан төлөв хоёр замд ижил эсэхийг батлах цорын ганц арга.

**⚠️ FALLBACK-ыг УРЬДЧИЛАН БИЧ.** Хэрэв аль нэг механизм D1 дээр ажиллахгүй бол — миграц хэрэгжсэний ДАРАА мэдэх нь **засвар биш, ХОЁР ДАХЬ МИГРАЦ** (§2.4(b)). Probe-ын дүнгээс хамаарч аль хувилбарыг бичихээ **урьдчилан** шийд:

| Механизм ажиллахгүй бол | Fallback |
|---|---|
| `GENERATED ALWAYS … VIRTUAL` | Энгийн `TEXT NULL` багана (`intent`, `sheet_uid`, `rule_id`). Ingest (1B-2) утгыг илт бичнэ. **bind төсөв: багана тус бүрд +1** — §2.4(a)-г дахин тооц. |
| `json_extract` / `json_valid` | Generated багана огт байхгүй, `CHECK (json_valid(...))` хасагдана. Сервер тал JSON-ыг өөрөө шалгана. |
| `CREATE TRIGGER` | Trigger огт байхгүй. Append-only нь **зөвхөн серверийн код + code review**-ээр барина. Энэ нь сул хамгаалалт — эзэнд илт мэдэгд. |

**Нэг ч механизм байхгүй бол ч схем хэрэгжинэ** — бүгд нь хатуулаг/тав тух, суурь бүтэц биш. Энэ нь зориудын загвар.

### 3.2 `0201_bim_artifacts.sql`

```sql
-- =============================================================
-- 0201_bim_artifacts.sql — BIM сурах гогцооны АРТЕФАКТЫН БҮРТГЭЛ
-- =============================================================
--
-- ЗОРИЛГО: `learning_events` (0202) нь зураг, ноорог, загварын төлөв,
-- урт бичвэр зэрэг ЖИНХЭНЭ АГУУЛГЫГ D1-д хадгалахгүй.  D1 бол дараалал ба
-- метадатаны газар; байт нь R2-д байна.  Энэ хүснэгт хоёрын хооронд гүүр.
--
-- ⚠️ ХУВИЙН НУУЦЫН ҮЛ ХӨДЛӨХ ДҮРЭМ (backend/src/lib/revitNoteAi.ts:144-154
--    дэх шипсэн шийдвэртэй НЭГ):
--    ЭЛЕМЕНТ ТҮВШНИЙ ҮЙЛ АЖИЛЛАГАА НЬ ЗӨВХӨН ӨӨРИЙГӨӨ ХАРАХАД ЗОРИУЛАГДАНА.
--    Энэ хүснэгт болон 0202-ын дээгүүр бичигдэх УНШИХ route бүр нь заавал
--      (а) өөрийн мөрөөр хязгаарлагдсан (`actor_user_id = viewer.sub`), эсвэл
--      (б) зөвхөн НЭГТГЭСЭН (aggregate)
--    байх ёстой.  Нэг хүний нэрлэсэн үйл ажиллагааны жагсаалтыг ӨӨР хүнд
--    ХЭЗЭЭ Ч буцаахгүй.  `allowedCountsOf` тестээр түгжигдсэн шиг
--    (revitNoteAi.test.ts:262), энэ нь хэрэгжүүлэгчийн дур зоргын асуудал БИШ.
--
-- ⚠️ ЯАГААД `REFERENCES` БАЙХГҮЙ ВЭ:
--    D1 нь runtime дээр FK-г ХЭРЭГЖҮҮЛДЭГГҮЙ тул зарлал нь ямар ч
--    хамгаалалт өгдөггүй.  Харин `d1 execute --remote --file` (path-B
--    runbook) нь `PRAGMA foreign_keys`-ыг ХҮНДЭТГЭДЭГ бөгөөд тэнд
--    `ON DELETE SET NULL` каскад нь хүүхэд мөрийн UPDATE болж хувирч,
--    0202-ын өөрчлөгдөшгүй байдлын trigger-ийг асаана — үр дүнд нь
--    ЭЦГИЙН DELETE БҮХЭЛДЭЭ УНАНА.  Тиймээс REFERENCES-ийг БҮРЭН хассан.
--    `uploaded_by` нь өнчирч болно — тэр нь ЗӨВ: хэрэглэгчийн бүртгэл
--    устсан нь артефактыг устгах шалтгаан биш.
--
-- ⚠️ BUCKET: `MEDIA_BUCKET` нь `GET /media/:key`-ээр ДЭЛХИЙД НЭЭЛТТЭЙ,
--    баталгаажуулалтгүй (`backend/src/routes/media.ts:55`).  Тиймээс энд
--    ЗӨВХӨН ХУВИЙН bucket зөвшөөрөгдөнө.  'shared' / 'global' гэх мэт
--    түрээслэгч хооронд нийтлэг утга ЗОРИУДААР байхгүй: `types.ts`-ийн
--    түрээслэгчийн чиглүүлэгч нь `MEDIA_BUCKET`/`MEETING_BUCKET` binding-ийг
--    компани тус бүрээр СОЛИДОГ тул нийтлэг утга нь түрээслэгчийн хилийг
--    даван гарах цорын ганц зам болно.
--
-- ⚠️ ТҮЛХҮҮР НЬ АГУУЛГААС ХАМААРНА (content-addressed).
--    `routes/upload.ts:33`-ийн `${user.sub}-${Date.now()}-${file.name}`
--    схемийг ЭНД ӨВЛӨХГҮЙ: тэр нь (1) ижил байтыг олон удаа хадгалдаг,
--    (2) хэрэглэгчийн id-г дэлхийд нээлттэй түлхүүрт шингээдэг.
--    `r2_key` = 'bim/' || substr(sha256,1,2) || '/' || sha256
--    ⚠️ `sha256`-ыг СЕРВЕР нь БАЙТААС ӨӨРӨӨ тооцоолж, клиентийн зарласантай
--    тааруулж шалгана; таарахгүй бол 400.  Клиентийн зарласан хэш бол
--    чимэглэл.  Энэ нь 1B-2-ын ХҮЛЭЭН АВАХ ШАЛГУУР.

CREATE TABLE IF NOT EXISTS bim_artifacts (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,

  -- 64 тэмдэгт hex.  СЕРВЕР тооцоолсон.  Давхардлыг бүрэн хаана.
  sha256       TEXT    NOT NULL UNIQUE
                       CHECK (length(sha256) = 64),

  -- ЗӨВХӨН хувийн bucket.  Дээрх тайлбарыг үз.
  bucket       TEXT    NOT NULL DEFAULT 'meeting'
                       CHECK (bucket IN ('meeting')),

  r2_key       TEXT    NOT NULL UNIQUE,

  media_type   TEXT    NOT NULL,                       -- MIME
  kind         TEXT    NOT NULL
                       CHECK (kind IN ('IMAGE','SKETCH','REVIT_STATE','TEXT','AUDIO','OTHER')),
  byte_size    INTEGER NOT NULL CHECK (byte_size > 0),

  -- REFERENCES-ГҮЙ.  Өнчирч болно.
  uploaded_by  INTEGER,
  created_at   TEXT    NOT NULL DEFAULT (datetime('now')),

  -- Redaction: байтыг R2-оос устгасны дараа энд тэмдэглэнэ.
  redacted_at  TEXT,
  redacted_by  INTEGER
);

CREATE INDEX IF NOT EXISTS idx_bim_artifacts_kind
  ON bim_artifacts (kind, created_at DESC);
```

**Тайлбар:** `sha256` дээр тусад нь индекс **хэрэггүй** — `UNIQUE` нь өөрөө индекс үүсгэнэ. `r2_key` мөн адил.

### 3.3 `0202_learning_events.sql`

```sql
-- =============================================================
-- 0202_learning_events.sql — Сурах гогцооны НУРУУ (append-only)
-- =============================================================
--
-- ЗОРИЛГО: «хана үүсгэв → зөөв → хаалга нэмэв → senior залруулав → батлав»
-- гэсэн ГИНЖИЙГ бүрэн, дараалалтай, эцэг ба шалтгааны заагчтайгаар
-- хадгалах.  Өнөөдөр энэ гинж ХАДГАЛАГДДАГГҮЙ:
--   • `revit-mcp/addin/ChangeTracker.cs:182` нь элемент тус бүрийн үйлдэл ба
--     цагийг ДАРЖ БИЧДЭГ тул зөвхөн СҮҮЛИЙНХ нь үлддэг;
--   • `ChangeTracker.cs:766` ба `:795` нь орхигдсон оролдлогын бичлэгийг
--     БҮРЭН УСТГАДАГ тул Ctrl+Z дарсан шийдвэр ямар ч ул мөр үлдээхгүй;
--   • `AssistantPane.xaml.cs:1295` нь илгээлт бүрийн дараа `capture_baseline`
--     дуудаж хянаж буй олонлогийг ТЭГЛЭДЭГ.
--
-- ЗАГВАРЫН ГАРАЛ: гурван хэлбэрээс SPINE (нэг append-only хүснэгт + R2
-- артефакт + generated VIRTUAL багана) нь operability 7.5 / privacy 7-оор
-- ялсан ч ML-ийн ашиг тусаар 6 : 9-ээр SATELLITES-т хожигдсон.  Энэ файл нь
-- SPINE + тодорхой залгаас — ЦЭВЭР ЗАГВАР БИШ, СИНТЕЗ.  Тэр зөрүүг хаах
-- залгаас нь generated VIRTUAL багана: тэдгээр нь bind ЗАРЦУУЛАХГҮЙ
-- (INSERT-д огт бичигдэхгүй) бөгөөд ИНДЕКСЛЭГДЭНЭ.
--
-- ⚠️ ХУВИЙН НУУЦЫН ҮЛ ХӨДЛӨХ ДҮРЭМ — 0201-ийнхтэй ИЖИЛ, зориуд дахин бичив:
--    ЭЛЕМЕНТ ТҮВШНИЙ ҮЙЛ АЖИЛЛАГАА НЬ ЗӨВХӨН ӨӨРИЙГӨӨ ХАРАХАД.
--    Энэ хүснэгтийн дээгүүр бичигдэх УНШИХ route бүр нь заавал
--      (а) `actor_user_id = viewer.sub`-ээр хязгаарлагдсан, эсвэл
--      (б) зөвхөн НЭГТГЭСЭН
--    байх ёстой.  Нэг хүний нэрлэсэн үйл ажиллагааны жагсаалт ХЭЗЭЭ Ч
--    ахлагчийн тайланд орохгүй.  Энэ нь шипсэн бүтээгдэхүүний шийдвэр:
--    `backend/src/lib/revitNoteAi.ts:152-154`-ийн `allowedCountsOf` нь
--    болзолгүйгээр хоосон жагсаалт буцаадаг ба `revitNoteAi.test.ts:262`-оор
--    ТҮГЖИГДСЭН.
--    ⚠️ `idx_le_actor` индекс нь энэ дүрмийг ЗӨРЧИХ БОЛОМЖИЙГ бий болгодог
--    (ажиглалтын гадаргуу).  Тэр нь ЗӨВХӨН өөрийгөө харах асуулгын
--    гүйцэтгэлд зориулагдсан — D1 нь УНШСАН МӨРӨӨР төлбөр авдаг тул
--    индексгүй бол өөрийгөө харах ч бүтэн хүснэгт скан хийнэ.  Индекс
--    БАЙГАА нь route-ыг зөвшөөрөгдсөн гэсэн үг БИШ.
--
-- ⚠️ REFERENCES ЗАРЛАЛ БҮРЭН БАЙХГҮЙ.  Шалтгаан нь 0201-д бичигдсэн:
--    `ON DELETE SET NULL` каскад нь UPDATE болж хувирч өөрчлөгдөшгүй
--    байдлын trigger-ийг асаадаг тул ЭЦГИЙН DELETE БҮХЭЛДЭЭ УНАНА
--    (`d1 execute --remote --file` = path-B runbook дээр).  D1 runtime дээр
--    юу ч хэрэгжүүлдэггүй тул багана нь ЮУ Ч АЛДАХГҮЙ.
--
-- ⚠️ ЭНД CURRENT-STATE VIEW БАЙХГҮЙ — ЗОРИУДААР.  Мөр тус бүрд гурван
--    хамаарсан дэд асуулга шаардах view нь сая мөрөөр төлөвлөгдсөн
--    хүснэгтэн дээр, УНШСАН МӨРӨӨР төлбөр авдаг D1 дээр, төлж
--    барагдашгүй болно.  Одоогийн төлөвийг СЕРВЕР талд, тодорхой
--    `stream_id`-ээр хязгаарласан асуулгаар гаргана.
--
-- ⚠️ ӨСӨЛТ.  Одоогийн бүх сан 45 МБ / 112 хүснэгт / 70,706 мөр; хамгийн том
--    хүснэгт `progress_entries = 8,062`.  D1-ийн НЭГ САНГИЙН ТААЗ нь 10 ГБ
--    бөгөөд тэр нь энэ түрээслэгчийн БУСАД БҮХ ЗҮЙЛТЭЙ ХУВААЛЦСАН.
--    49 инженер × 250 ажлын өдөр × (өдөрт 40…200 үйл явдал)
--       = ЖИЛД 490,000 … 2,450,000 мөр.  ~300 байт/мөр (payload дунджаар)
--       = ЖИЛД 150 МБ … 750 МБ, индексгүйгээр.
--    Өөрөөр хэлбэл ЭХНИЙ ЖИЛД одоогийн бүх сангаас 3…17 дахин том.
--    ⚠️ ӨДРИЙН БОДИТ ХЭМЖЭЭГ ХЭН Ч ХЭМЖЭЭГҮЙ.  Харьцуулах цорын ганц тоо:
--       `progress_entries` сүүлийн 30 хоногт 472 мөр = өдөрт ~16.
--    НЯГТРУУЛАЛТЫН ТӨЛӨВЛӨГӨӨ (1B-2-т төлөвлөгдөнө, ЭНД ХЭРЭГЖИХГҮЙ):
--       гаргаж авсан ХУРААНГУЙ мөр бичих (kind='STREAM_DIGEST'),
--       ЭХ МӨРҮҮДИЙГ ХЭВЭЭР ҮЛДЭЭХ, зөвхөн ИНДЕКСИЙН мөрийг хаях.
--       УСТГАХ БИШ.  Устгал нь `ChangeTracker`-ийн яг тэр алдаа, зөвхөн
--       өөр давхаргад.

CREATE TABLE IF NOT EXISTS learning_events (
  -- Глобал дараалал.  AUTOINCREMENT нь id дахин ашиглагдахгүйг баталгаажуулна.
  id              INTEGER PRIMARY KEY AUTOINCREMENT,

  /* --- ДАРААЛАЛ ------------------------------------------------- */
  -- Логик хэлхээ: нэг баримт + нэг ажлын сесс.  Add-in үүсгэнэ.
  stream_id       TEXT    NOT NULL,
  -- Урсгал доторх монотон дугаар.  Клиент өгнө; сүлжээ тасарсан ч
  -- ДАРААЛАЛ сэргээгдэнэ.
  seq             INTEGER NOT NULL,
  -- Add-in-ий локал UUID.  Idempotency-ийн түлхүүр (доорх UNIQUE индекс).
  event_uid       TEXT    NOT NULL,

  /* --- ЮУ БОЛСОН ------------------------------------------------ */
  kind            TEXT    NOT NULL CHECK (kind IN (
                    'TEXT','IMAGE','SKETCH','REVIT_STATE','USER_ACTION',
                    'AI_ACTION','HUMAN_CORRECTION','RULE_VALIDATION','FINAL_APPROVAL')),

  -- Бүтцийн эцэг (ж: HUMAN_CORRECTION → түүний засаж буй AI_ACTION).
  parent_event_id INTEGER,
  -- Шалтгаан: «энэ юунаас үүдэв».  Эцгээс ӨӨР байж болно.
  causal_event_id INTEGER,

  /* --- ХЭН ------------------------------------------------------ */
  actor_kind      TEXT    NOT NULL CHECK (actor_kind IN ('human','ai','rule','system')),
  actor_user_id   INTEGER,          -- REFERENCES-ГҮЙ, өнчирч болно
  project_id      INTEGER,          -- REFERENCES-ГҮЙ
  task_id         INTEGER,          -- REFERENCES-ГҮЙ
  doc_uid         TEXT,             -- `revit_documents.doc_uid`-ийн утга

  /* --- АГУУЛГА -------------------------------------------------- */
  -- Байт нь R2-д; энд зөвхөн заагч.  `bim_artifacts.id`, REFERENCES-ГҮЙ.
  artifact_id     INTEGER,
  -- ⚠️ Энэ багана нь ЖИЖИГ бүтэцтэй метадата.  ЗУРАГ, ЗАГВАРЫН ГЕОМЕТР,
  --    ФАЙЛЫН АГУУЛГА ЭНД ОРОХГҮЙ — тэр нь артефакт.
  payload_json    TEXT    NOT NULL DEFAULT '{}'
                          CHECK (json_valid(payload_json)),

  /* --- ГАРАЛ ҮҮСЭЛ (1B-4 / 1B-7 энэ гурвыг ашиглана) ------------- */
  provenance      TEXT    NOT NULL DEFAULT 'UNVERIFIED'
                          CHECK (provenance IN (
                            'UNVERIFIED','MACHINE_GENERATED','RULE_VERIFIED',
                            'HUMAN_VERIFIED','HUMAN_CORRECTED')),
  model_version   TEXT,
  dataset_version TEXT,
  prompt_version  TEXT,

  /* --- ЦАГ ------------------------------------------------------ */
  -- КЛИЕНТИЙН цаг (UTC ISO).  Add-in офлайн байж болно.
  occurred_at     TEXT    NOT NULL,
  -- СЕРВЕРИЙН цаг.  Хоёрын зөрүү нь офлайн хугацааг хэмжинэ.
  received_at     TEXT    NOT NULL DEFAULT (datetime('now')),

  /* --- REDACTION (цорын ганц зөвшөөрөгдсөн UPDATE) --------------- */
  redacted_at      TEXT,
  redacted_by      INTEGER,
  redaction_reason TEXT,

  /* --- ЗАЛГААС: generated VIRTUAL багана ------------------------ */
  -- bind ЗАРЦУУЛАХГҮЙ (INSERT-д огт бичигдэхгүй), ИНДЕКСЛЭГДЭНЭ.
  -- ⚠️ Хожим НЭМЖ болно (`ALTER … ADD COLUMN … VIRTUAL` ажилладаг; STORED
  --    ажиллахгүй), гэхдээ ХАСАХАД индексийг нь ЭХЛЭЭД устгах шаардлагатай
  --    — өөрөөр хэлбэл дараагийн миграц.  Нэмэхээсээ өмнө бод.
  intent          TEXT GENERATED ALWAYS AS (json_extract(payload_json, '$.intent'))    VIRTUAL,
  sheet_uid       TEXT GENERATED ALWAYS AS (json_extract(payload_json, '$.sheet_uid')) VIRTUAL,
  rule_id         TEXT GENERATED ALWAYS AS (json_extract(payload_json, '$.rule_id'))   VIRTUAL
);

/* ---- Idempotency: дахин илгээлт ДАВХАРДАЛ үүсгэхгүй ------------- */
-- ⚠️ Trigger нь UPDATE-ыг хаадаг тул ingest нь INSERT OR IGNORE байх ЁСТОЙ,
--    upsert БИШ.  (1B-2-ын гэрээ.)
CREATE UNIQUE INDEX IF NOT EXISTS idx_le_uid
  ON learning_events (stream_id, event_uid);

/* ---- Дараалал сэргээх ГОЛ индекс -------------------------------- */
CREATE UNIQUE INDEX IF NOT EXISTS idx_le_seq
  ON learning_events (stream_id, seq);

/* ---- Нэгтгэсэн тайлан (төслөөр, хугацаагаар) -------------------- */
CREATE INDEX IF NOT EXISTS idx_le_project
  ON learning_events (project_id, occurred_at)
  WHERE project_id IS NOT NULL;

/* ---- Курацийн дараалал (1B-6): шошголоогүй мөрүүд ---------------- */
CREATE INDEX IF NOT EXISTS idx_le_curation
  ON learning_events (provenance, id)
  WHERE provenance IN ('UNVERIFIED','MACHINE_GENERATED');

/* ---- Санаагаар шүүх (generated багана дээр) ---------------------- */
CREATE INDEX IF NOT EXISTS idx_le_intent
  ON learning_events (intent)
  WHERE intent IS NOT NULL;

/* ---- ЗӨВХӨН ӨӨРИЙГӨӨ ХАРАХ асуулгын гүйцэтгэлд.  Дээрх хувийн
        нууцын үл хөдлөх дүрмийг үз — энэ индекс байгаа нь ахлагчийн
        тайлан бичихийг ЗӨВШӨӨРСӨН гэсэн үг БИШ. ------------------- */
CREATE INDEX IF NOT EXISTS idx_le_actor
  ON learning_events (actor_user_id, id)
  WHERE actor_user_id IS NOT NULL;

/* ================================================================ */
/*  ӨӨРЧЛӨГДӨШГҮЙ БАЙДАЛ — ХОЁР TRIGGER                             */
/* ================================================================ */
--
-- ⚠️ `BEFORE UPDATE OF <баганын жагсаалт>` хэлбэрийг ХЭРЭГЛЭХГҮЙ.  Хоёр
--    шалтгаан, хоёулаа хэмжигдсэн:
--    1) Жагсаалтад орсон багана `ON DELETE SET NULL`-тэй байвал каскад нь
--       UPDATE болж trigger-ийг асааж ЭЦГИЙН DELETE-ийг унагаана.  (Энэ
--       схемд REFERENCES огт байхгүй тул одоо боломжгүй — гэхдээ хэлбэр нь
--       дахин орж ирэх ёсгүй.)
--    2) Жагсаалт нь ХОЖИМ НЭМЭГДСЭН баганыг хамгаалахгүй.  Батлагдсан:
--       `BEFORE UPDATE OF payload_json` + `ALTER TABLE ADD COLUMN sequence_no`
--       → `UPDATE … SET sequence_no = 999` ЧӨЛӨӨТЭЙ гарч ирнэ.
--    Иймд `BEFORE UPDATE` (жагсаалтГҮЙ) + `WHEN` заалт нь ОНЦГОЙ
--    ТОХИОЛДЛЫГ нэрлэнэ.  Ингэснээр хожим нэмэгдэх БҮХ багана
--    автоматаар хамгаалагдана.
--
-- ⚠️ `END;` — ТОМ ҮСГЭЭР, ӨӨРИЙН МӨРӨНД.  wrangler-ийн задлагч
--    `/\sEND[;\s]$/` (`i` тугГҮЙ) регекс хэрэглэдэг; `end;` гэж бичвэл
--    дараагийн statement нь trigger дотор ЗАЛГИГДАЖ файл дунджаа унана
--    → сан ХАГАС НҮҮЛГЭГДЭНЭ → цорын ганц засвар нь ШИНЭ ДУГААР.

-- 1) Цорын ганц зөвшөөрөгдсөн UPDATE нь redaction.
CREATE TRIGGER IF NOT EXISTS learning_events_append_only
BEFORE UPDATE ON learning_events
WHEN NEW.redacted_at IS NULL
BEGIN
  SELECT RAISE(ABORT, 'learning_events is append-only; only redaction may UPDATE');
END;

-- 2) Redaction нь НЭГ УДАА.  Дахин засах, буцаах боломжгүй.
CREATE TRIGGER IF NOT EXISTS learning_events_redact_once
BEFORE UPDATE ON learning_events
WHEN OLD.redacted_at IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'learning_events: row already redacted');
END;
```

**Хоёр trigger хамтдаа юуг баталгаажуулдаг вэ** (бүгд `node:sqlite`-аар ажиллуулж баталгаажуулав):

| Үйлдэл | Үр дүн |
|---|---|
| `UPDATE … SET payload_json = '…'` | ❌ `learning_events is append-only` |
| `UPDATE … SET redacted_at='…', redacted_by=2, redaction_reason='…'` | ✅ зөвшөөрөгдөнө |
| Дахин redaction (`redacted_at` аль хэдийн NULL биш) | ❌ `row already redacted` |
| `UPDATE … SET redacted_at = NULL` (буцаах) | ❌ `append-only` |
| ХОЖИМ `ALTER`-ээр нэмсэн баганыг засах | ❌ хамгаалагдсан хэвээр |
| `INSERT OR IGNORE` давхардсан `(stream_id, event_uid)` | ✅ мөрийн тоо өөрчлөгдөхгүй |
| `payload_json` буруу JSON | ❌ `malformed JSON` (`CHECK (json_valid(...))`) |
| Эцэг `users` мөр устгах (`PRAGMA foreign_keys=ON`) | ✅ **амжилттай** — REFERENCES байхгүй тул |

**Санаатайгаар БАЙХГҮЙ зүйл: `BEFORE DELETE` trigger.** Шалтгаан: (а) дээрх нягтруулалтын төлөвлөгөө ирээдүйд мөр хасах шаардлагатай болж болно; (б) хадгалах хугацааны бодлого нь **хөдөлмөрийн харилцааны шийдвэр**, инженерийн биш (§9). Хэрэв эзэн «хэзээ ч устгахгүй» гэж шийдвэл түүнийг **дараагийн миграцаар** нэмнэ — trigger нэмэх нь хүснэгт дахин барихгүй тул хямд.

### 3.4 Есөн төрөл хэрхэн илэрхийлэгдэх вэ (1B-2-т өгөх гэрээ)

| `kind` | `actor_kind` | `artifact_id` | `payload_json` (жишээ түлхүүрүүд) |
|---|---|---|---|
| `TEXT` | `human` | NULL (богино) / артефакт (урт) | `{"text":"…","lang":"mn"}` |
| `IMAGE` | `human` | **заавал** | `{"caption":"…"}` |
| `SKETCH` | `human` | **заавал** | `{"stroke_count":42}` |
| `REVIT_STATE` | `system` | **заавал** (JSON агшин R2-д) | `{"element_count":1240,"doc_uid":"…"}` |
| `USER_ACTION` | `human` | NULL | `{"op":"Move","element_count":7,"sheet_uid":"БА-01"}` |
| `AI_ACTION` | `ai` | NULL | `{"intent":"isolate_sheet","confidence":0.87,"decided_by":"model"}` |
| `HUMAN_CORRECTION` | `human` | NULL | `{"corrected_intent":"…","reason":"…"}` + `parent_event_id` = засагдаж буй `AI_ACTION` |
| `RULE_VALIDATION` | `rule` | NULL | `{"rule_id":"MGL-BA-014","passed":false,"detail":"…"}` |
| `FINAL_APPROVAL` | `human` | NULL | `{"progress_entry_id":123,"percentage":60}` |

**Энэ хүснэгт нь миграцад ОРОХГҮЙ** — 1B-2-ын баримт. Энд байгаа нь схем ес дахь төрлийг бүгдийг илэрхийлж чадаж байгааг ХАРУУЛАХ зорилготой.

⚠️ Схем нь «text → intent → label» хэлбэрт **түгжигдээгүй**: `intent` нь `payload_json`-оос гаргасан generated багана бөгөөд `AI_ACTION`-д л утгатай. `IMAGE`, `SKETCH`, `REVIT_STATE`, `RULE_VALIDATION` мөрүүдэд `intent` нь NULL — тэдгээр нь хэсэгчилсэн индекст ч орохгүй.

---

## 4. ХӨНДӨЖ БОЛОХГҮЙ (load-bearing)

| Юу | Яагаад эвдэрнэ |
|---|---|
| **`purpose === 'mcp'` токен `/api/*`-д ажилладаг байдал** | `backend/src/middleware/auth.ts:55` нь `verifyToken(token, c.env.JWT_SECRET)`-ыг зорилго шалгалгүйгээр дуудна; `backend/src/index.ts:292-296`-ийн `resolveExternalToken` мөн адил (`const payload = await verifyToken(token, env.JWT_SECRET); if (!payload) return null;`). Add-in бүх REST дуудлагаа `POST /api/auth/mcp-token`-оор авсан ~1 жилийн токеноор хийдэг (`revit-mcp/addin/ApiClient.cs:103-120`, дараа нь `:148, :183, :230, :253, :292, :313`; токенд `purpose: 'mcp'` тавигддаг — `backend/src/routes/auth.ts:75`). **Алсаас сэргээх боломжгүй.** Энэ сесс auth-ыг огт хөндөхгүй, гэхдээ дүрмийг мэдэж яв. |
| **`users` / `projects`-ын каскад хүүхдүүд** | Локалд 25 (прод 27) ба 38. `migrations apply` нь гүйлгээнд ороодог тул `DROP TABLE`-ийн каскад ЖИНХЭНЭЭР ажиллана. Энэ сессийн миграцууд тэдгээрийг огт хөндөхгүй. |
| **`GET /media/:key` нэг замын хэсэгтэй таарах байдал** (`backend/src/routes/media.ts:55`) | Энэ нь `authorSupervision.ts`-ийн `isMediaUrl`-ийн үндэс. `bim_artifacts` нь `MEDIA_BUCKET`-ыг ОГТ хэрэглэхгүй тул энэ гадаргууг өргөтгөхгүй. |
| **`allowedCountsOf` → `[]`** (`backend/src/lib/revitNoteAi.ts:152-154`, тест `revitNoteAi.test.ts:262`) | Элементийн тоо тайланд гарахыг хаадаг. `learning_events` нь тэр өгөгдлийг **эрэмбэлж** хадгална — унших route бүр §3.3-ын үл хөдлөх дүрмийг дагах ёстой, эс тэгвээс шипсэн бүтээгдэхүүний шийдвэр тойрч гарна. |
| **`assistant_logs` / `assistant_examples` / `assistant_models`** (миграц 0195) | 1B-3-ын нутаг. `learning_events` нь тэднийг **орлохгүй, нүүлгэхгүй, өөрчлөхгүй**. Хоёр систем зэрэг оршино; нэгтгэх эсэх нь 1B-3/1B-7-ын шийдвэр. |
| **`revit_submissions.change_json` / `evidence_json`** | Илгээлтийн нэгтгэсэн агшин. `learning_events` гарсны дараа ч энэ хэвээр — `revit_submissions` нь явцын бүртгэлийн эх сурвалж, шинэ хүснэгт нь ажлын явцын бүртгэл. |
| **`revit.ts:1702`-ийн буруу тайлбар** | Мэдэгдэж байгаа зөрүү (§2.4(a)). **Энэ сесст засахГҮЙ** — хамрах хүрээнээс гадуур, өөр агентын файл байж болно. 1B-2-т мэдэгд. |
| **Одоо байгаа 190 миграцын аль нь ч** | Append-only. Хэрэгжсэн файлыг засах нь продакшн дээр чимээгүй no-op. |
| **`qto.ts:860` / `:879`-ийн 4 ба 16 мөрийн чанк** | `qto_facts`-д багана нэмэх нь тэр тоог дахин тооцоолохыг шаардана. Энэ сесс `qto_*`-ыг огт хөндөхгүй. |

---

## 5. ДАРААЛАЛ БА ХАМААРАЛ

### 5.1 Урьдчилсан нөхцөл

| # | Нөхцөл | Хэрхэн шалгах |
|---|---|---|
| 1 | **1A бүрэн дууссан** (1A-1 … 1A-6) | `docs/bim-ai/README.md`. «Аюулгүй байдлын нүх нь AI-ийн замын зураг биш, продакшны асуудал». |
| 2 | **§3.1-ийн probe АМЖИЛТТАЙ**, эсвэл fallback хувилбар сонгогдсон | Хаягдах D1 дээрх гурван шалгалт |
| 3 | **Миграцын дугаар нөөцлөгдсөн** | `ls backend/migrations \| tail -3` |

### 5.2 Deploy-ийн дараалал

```
[энэ сесс]  0201 + 0202  →  d1 migrations apply --remote      ← БАРИЛГЫН МАТЕРИАЛ ЗӨВХӨН
                                       │
                                       ▼   (ТУСДАА, ДАРААГИЙН deploy)
[1B-2]      ingest route + bind тест  →  wrangler deploy
```

⚠️ **ХАТУУ ДҮРЭМ: шинэ багана нь түүнийг УНШИХ кодоос ХАТУУ ӨМНӨХ deploy-д гарах ёстой.** Тиймээс энэ сесс миграцыг ганцаараа хэрэгжүүлж, worker-ыг **deploy хийхГҮЙ**. `learning_events` руу бичих/уншихыг 1B-2 нэмнэ.

Энэ дараалал нь rollback-ыг ч хямд болгодог: хоосон хүснэгт нь ямар ч кодыг эвдэхгүй.

### 5.3 Дараа нь юу ирэх вэ

| Сесс | Энэ схемээс юу авах |
|---|---|
| **1B-2** | `INSERT OR IGNORE` ingest route; bind төсвийн тооцоо (§6-д); клиентийн зарласан `sha256`-ыг СЕРВЕР дахин тооцоолж шалгах |
| **1B-3** | `assistant_logs`-т `model_version`/`dataset_version`/`prompt_version` нэмэх — энэ схемийн гурван баганыг **нэр нэгтэй** авна. (README: «Сервер одоо `model_version`-ийг чимээгүй хаядаг».) |
| **1B-4** | `dataset_version` + `provenance` дээр тулгуурласан сургалтын манифест |
| **1B-5** | `provenance = 'HUMAN_VERIFIED'` мөрүүдээс хөлдөөсөн holdout |
| **1B-6** | `idx_le_curation`-ыг ашиглах курацийн UI. **README-ийн ①: өнөөдөр `HUMAN_VERIFIED` / `RULE_VERIFIED` / `HUMAN_CORRECTED` гурвуулаа ТЭГ мөр.** Цуглуулах гадаргуу нэмэх бүр курацгүйгээр шошголохгүй мөр нэмнэ. |
| **1B-7** | `provenance` энумын итгэлийн шатлал |
| **1C** | C#-ийн БҮХ өөрчлөлт **НЭГ релизэд**. Add-in дээрх event emitter энэ схемийг унших ёстой; `stream_id`/`seq` үүсгэх дүрэм тэнд шийдэгдэнэ (§9 №12). |

---

## 6. ХҮЛЭЭН АВАХ ШАЛГУУР

- [ ] `git status --short` нь **яг хоёр шинэ файл** харуулна: `backend/migrations/02NN_bim_artifacts.sql`, `backend/migrations/02NN+1_learning_events.sql`. Өөр ямар ч файл өөрчлөгдөөгүй, устгагдаагүй, stage хийгдээгүй.
- [ ] Хоёр файлын дугаар нь `ls backend/migrations | tail -3`-ийн үр дүнгээс **хатуу их**, хоорондоо дараалсан.
- [ ] Аль ч файлд `REFERENCES` гэсэн үг **байхгүй** (`grep -c REFERENCES` → 0).
- [ ] `CREATE TABLE` / `CREATE INDEX` / `CREATE TRIGGER` бүр `IF NOT EXISTS`-тэй.
- [ ] `END;` бүр **том үсгээр**, **өөрийн мөрөнд** (`grep -n "end;" …` → тэг мөр).
- [ ] Аль ч файлд `CREATE VIEW` **байхгүй**.
- [ ] `bucket` баганын `CHECK` нь **зөвхөн** `'meeting'` зөвшөөрнө (`media`, `shared`, `global` — аль нь ч биш).
- [ ] `learning_events.kind`-ийн `CHECK` нь **ес** утга агуулна: `TEXT, IMAGE, SKETCH, REVIT_STATE, USER_ACTION, AI_ACTION, HUMAN_CORRECTION, RULE_VALIDATION, FINAL_APPROVAL`.
- [ ] `parent_event_id` ба `causal_event_id` **хоёулаа** байна.
- [ ] Хувийн нууцын үл хөдлөх дүрэм («элемент түвшний үйл ажиллагаа = зөвхөн өөрийгөө харах, ахлагчийн тайланд хэзээ ч биш») нь **хоёр файлын аль алиных нь ТОЛГОЙН ТАЙЛБАРТ** байгаа бөгөөд `revitNoteAi.ts:152-154`-ийг заасан.
- [ ] Локал replay: хоёр файлыг `node:sqlite`-аар ажиллуулахад алдаагүй.
- [ ] Локал зан төлвийн 8 шалгалт бүгд таарна (§7-ийн скрипт):
      `payload UPDATE` ❌ · `redaction UPDATE` ✅ · дахин redaction ❌ · `redacted_at=NULL` ❌ · `INSERT OR IGNORE` давхардал мөр нэмэхгүй · буруу JSON ❌ · эцэг `users` DELETE (`foreign_keys=ON`) ✅ · generated багана дээр `EXPLAIN QUERY PLAN` нь `USING INDEX` харуулна.
- [ ] Алсын probe (§3.1) дөрвөн механизмыг **D1 дээр** баталсан, эсвэл fallback хувилбар сонгогдож толгойн тайлбарт бичигдсэн.
- [ ] `npx wrangler d1 migrations apply mgl-progress-db-v3 --remote --config wrangler.toml` амжилттай; `d1_migrations`-д хоёр шинэ мөр.
- [ ] Прод дээр `PRAGMA table_info(learning_events)` нь generated багануудыг харуулна (эсвэл fallback тохиолдолд энгийн багана).
- [ ] Прод дээр `SELECT COUNT(*) FROM learning_events` → **0**. Энэ сесс өгөгдөл бичихгүй.
- [ ] Прод дээр `PRAGMA foreign_key_check` хоосон.
- [ ] `wrangler deploy` (worker) **ажиллуулаагүй**.
- [ ] **bind төсөв бичигдсэн ба 1B-2-т дамжуулсан:** generated багануудыг **хасвал** `learning_events`-д илт бичигдэх багана **21** — `stream_id, seq, event_uid, kind, parent_event_id, causal_event_id, actor_kind, actor_user_id, project_id, task_id, doc_uid, artifact_id, payload_json, provenance, model_version, dataset_version, prompt_version, occurred_at, redacted_at, redacted_by, redaction_reason` (`id` ба `received_at` нь анхдагчтай). ⇒ `floor(100 / 21) = 4` мөр / statement — `routes/qto.ts:860`-ийнхтэй **яг ижил** тоо.

---

## 7. ШАЛГАХ КОМАНД

```bash
# --- 0) Дугаар ба хамрах хүрээ -----------------------------------------
ls backend/migrations | tail -3
ls backend/migrations | wc -l                    # 190 → 192
git status --short                               # ЗӨВХӨН хоёр шинэ ?? мөр

# --- 1) Синтаксын хатуу шалгалтууд -------------------------------------
grep -c REFERENCES backend/migrations/02*_bim_artifacts.sql backend/migrations/02*_learning_events.sql   # 0, 0
grep -n "end;"        backend/migrations/02*_learning_events.sql   # тэг мөр
grep -n "CREATE VIEW" backend/migrations/02*.sql                   # тэг мөр
grep -cE "IF NOT EXISTS" backend/migrations/02*_learning_events.sql

# --- 2) Дөрвөн механизм репод ҮНЭХЭЭР шинэ эсэхийг дахин батал ----------
grep -rilE "CREATE TRIGGER|CREATE VIEW|GENERATED ALWAYS|json_extract" backend/migrations | wc -l   # 0 (шинэ файлаа нэмэхээс өмнө)

# --- 3) wrangler-ийн задлагчийн регексүүдийг дахин батал ---------------
grep -n "isCompoundStatementEnd\|isCompoundStatementStart" -A 2 \
  backend/node_modules/wrangler/wrangler-dist/cli.js | head -20
```

**Локал зан төлвийн шалгалт.** Дараах скриптийг scratchpad-д `check.mjs` нэрээр хадгалаад ажиллуул:

```js
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
const db = new DatabaseSync(':memory:');
db.exec('PRAGMA foreign_keys = ON;');
db.exec('CREATE TABLE users (id INTEGER PRIMARY KEY); INSERT INTO users VALUES (1);');
for (const f of process.argv.slice(2)) db.exec(readFileSync(f, 'utf8'));

const ok = (n, fn) => { try { fn(); console.log('OK    ', n); } catch (e) { console.log('ABORT ', n, '->', e.message); } };

db.exec(`INSERT INTO learning_events
  (stream_id,seq,event_uid,kind,actor_kind,actor_user_id,payload_json,occurred_at)
  VALUES ('s1',1,'u1','AI_ACTION','ai',1,'{"intent":"isolate_sheet"}','2026-08-27T01:00:00Z')`);

console.log('intent =', db.prepare('SELECT intent FROM learning_events').get().intent);
console.log('plan   =', db.prepare("EXPLAIN QUERY PLAN SELECT id FROM learning_events WHERE intent='isolate_sheet'").all()[0].detail);

ok('эцэг users DELETE (ЗӨВШӨӨРӨГДӨХ)', () => db.exec('DELETE FROM users WHERE id=1'));
ok('payload UPDATE (ХОРИОТОЙ)',         () => db.exec("UPDATE learning_events SET payload_json='{}' WHERE id=1"));
ok('redaction (ЗӨВШӨӨРӨГДӨХ)',          () => db.exec("UPDATE learning_events SET redacted_at='2026-08-27', redacted_by=2 WHERE id=1"));
ok('дахин redaction (ХОРИОТОЙ)',        () => db.exec("UPDATE learning_events SET redacted_at='2026-08-28' WHERE id=1"));
ok('буруу JSON (ХОРИОТОЙ)',             () => db.exec("INSERT INTO learning_events (stream_id,seq,event_uid,kind,actor_kind,payload_json,occurred_at) VALUES ('s1',9,'u9','TEXT','human','not json','x')"));
```

```bash
node check.mjs backend/migrations/02*_bim_artifacts.sql backend/migrations/02*_learning_events.sql
```

```bash
# --- 5) АЛСЫН probe (§3.1) — миграц бичихээс ӨМНӨ ----------------------
npx wrangler d1 create  bimai-probe --config backend/wrangler.toml
npx wrangler d1 execute bimai-probe --remote --config backend/wrangler.toml --file=probe.sql
npx wrangler d1 execute bimai-probe --remote --config backend/wrangler.toml \
  --command "UPDATE probe_events SET payload_json='{}' WHERE id=1"     # ← ABORT ӨГӨХ ЁСТОЙ
npx wrangler d1 delete  bimai-probe --config backend/wrangler.toml

# --- 6) ХЭРЭГЖҮҮЛЭХ (алсад) --------------------------------------------
cd backend
npx wrangler d1 migrations apply mgl-progress-db-v3 --remote --config wrangler.toml

# --- 7) ХЭРЭГЖСЭНИЙ ДАРААХ БАТАЛГАА -------------------------------------
npx wrangler d1 execute mgl-progress-db-v3 --remote --config wrangler.toml \
  --command "SELECT name FROM d1_migrations ORDER BY id DESC LIMIT 3"
npx wrangler d1 execute mgl-progress-db-v3 --remote --config wrangler.toml \
  --command "PRAGMA table_info(learning_events)"
npx wrangler d1 execute mgl-progress-db-v3 --remote --config wrangler.toml \
  --command "SELECT name FROM sqlite_master WHERE name LIKE 'learning_events%' OR name LIKE 'bim_artifacts%'"
npx wrangler d1 execute mgl-progress-db-v3 --remote --config wrangler.toml \
  --command "SELECT COUNT(*) AS events FROM learning_events"          # ← 0
npx wrangler d1 execute mgl-progress-db-v3 --remote --config wrangler.toml \
  --command "PRAGMA foreign_key_check"                                 # ← хоосон
```

⚠️ Санамж: `wrangler` дуудлага бүрд Bash sandbox-ыг унтраах шаардлагатай байж болно, мөн OAuth токен сессийн дунд үхэж болно.

---

## 8. ROLLBACK

### 8.1 Хэрэгжүүлэхээс ӨМНӨ

Файлыг устга. Өөр юу ч байхгүй.

```bash
rm backend/migrations/02*_bim_artifacts.sql backend/migrations/02*_learning_events.sql
```

### 8.2 Хэрэгжсэний ДАРАА — ⚠️ ШИНЭ ДУГААР ЗААВАЛ

**Хэрэгжсэн файлыг засах нь продакшн дээр ЧИМЭЭГҮЙ NO-OP.** `d1_migrations`-д нэр нь бүртгэгдсэн тул wrangler түүнийг дахин ажиллуулахгүй. Буцаах цорын ганц зам нь **ШИНЭ ДУГААРТАЙ миграц**.

Азаар энэ сессийн rollback хямд: **хоёр хүснэгт хоёулаа ХООСОН**, ямар ч код тэднийг уншдаггүй, ямар ч эцэг хүснэгт тэднийг заадаггүй (`REFERENCES` байхгүй — §2.6).

`0203_drop_learning_events.sql` (жишээ):

```sql
-- 0203 — 0201/0202-ыг буцаана.  Хоёр хүснэгт ХООСОН, уншигч код БАЙХГҮЙ.
-- ⚠️ Индексийг эхлээд устгах ШААРДЛАГАГҮЙ: DROP TABLE нь өөрийн индекс,
--    trigger-ыг хамт устгана.  (DROP COLUMN л индексээс болж татгалздаг.)
DROP TRIGGER IF EXISTS learning_events_redact_once;
DROP TRIGGER IF EXISTS learning_events_append_only;
DROP TABLE   IF EXISTS learning_events;
DROP TABLE   IF EXISTS bim_artifacts;
```

⚠️ `DROP TABLE` нь `migrations apply`-ийн гүйлгээнд каскад асаана — **гэхдээ энэ хоёр хүснэгт ямар ч хүүхэдгүй, ямар ч эцэггүй** тул аюулгүй. `users`/`projects`-ыг хөндөх боломжгүй байдлын шалтгаан (§2.4(e)) энд хамаарахгүй.

### 8.3 Хэсэгчилсэн буцаалт (зөвхөн нэг механизм асуудалтай бол)

| Нөхцөл | Засвар | Дугаар |
|---|---|---|
| Trigger буруу зан гаргаж байна | `DROP TRIGGER IF EXISTS …;` + шинэ хувилбар | Шинэ |
| Generated багана D1 дээр ажиллахгүй | Индексийг нь **эхлээд** `DROP INDEX`, дараа нь `ALTER TABLE … DROP COLUMN`, дараа нь энгийн `TEXT` багана нэмэх | Шинэ (нэг файлд дараалуулж болно) |
| Индекс хэт үнэтэй | `DROP INDEX IF EXISTS …;` — хүснэгт хөндөгдөхгүй | Шинэ |
| `bucket` CHECK хэт хатуу | CHECK өөрчлөх нь **хүснэгт дахин барихыг** шаардана. Хүснэгт хоосон байвал `DROP TABLE` + `CREATE TABLE` хамгийн хямд. Мөр байвал path-B. | Шинэ |
| `UNIQUE(stream_id, seq)` хэт хатуу болсон | `DROP INDEX idx_le_seq;` + `CREATE INDEX` (UNIQUE-гүй). **Сулруулах нь хямд, чангаруулах нь давхардсан өгөгдөлтэй бол БОЛОМЖГҮЙ** — §9 №12. | Шинэ |

### 8.4 Файл дунджаа унасан бол (§2.4(f)-ийн `end;` алдаа гэх мэт)

Сан **хагас нүүлгэгдсэн**: эхний хэдэн statement хэрэгжсэн, `d1_migrations`-д мөр **байхгүй**. Хууль ёсны цорын ганц зам:

1. `SELECT name, sql FROM sqlite_master WHERE name LIKE 'learning_events%' OR name LIKE 'bim_artifacts%'` — ЮУ хэрэгжсэнийг тодорхойл.
2. **ШИНЭ дугаартай** миграц бич: `DROP … IF EXISTS`-ээр бүгдийг цэвэрлээд, БҮХЭЛД нь дахин үүсгэ.
3. Унасан файлыг **бүү зас** — тэр нь дараагийн `migrations apply` дээр дахин ажиллах гэж оролдоно (нэр нь `d1_migrations`-д алга). Тиймээс унасан файл нь `IF NOT EXISTS`-ийн ачаар **дахин ажиллуулж болдог** байх ёстой — энэ бол `IF NOT EXISTS` дүрмийн бодит шалтгаан.

---

## 9. ЭХЛЭХИЙН ӨМНӨ ТОДРУУЛАХ

Дараах зүйлүүд **репогоос шийдэгдэхгүй**. Эхлэхийн өмнө хариулт ав.

### 9.1 Техникийн — прод/алсын D1 дээр л шалгагдана

| # | Асуулт | Яагаад локалд шийдэгдэхгүй вэ | Хэрхэн шийдэх |
|---|---|---|---|
| 1 | **`CREATE TRIGGER` D1 дээр ажиллах уу?** | 190 миграцын аль нь ч trigger агуулаагүй. D1 нь өөрийн SQLite build-тэй, `SQLITE_OMIT_TRIGGER` эсэхийг Cloudflare баримтжуулаагүй. Локал `node:sqlite` 3.53.1 ≠ D1. | §3.1-ийн хаягдах D1 probe |
| 2 | **`GENERATED ALWAYS … VIRTUAL` D1 дээр ажиллах уу? Индекслэгдэх үү?** | Мөн адил тэг прецедент | §3.1 probe + `EXPLAIN QUERY PLAN` |
| 3 | **`json_extract` / `json_valid` D1 дээр байгаа юу?** | JSON1 өргөтгөл нь compile-time сонголт | §3.1 probe |
| 4 | **wrangler `migrations apply` нь trigger-тай файлыг зөв задлах уу?** | Задлагчийн регексийг унших нь симуляц, бодит гүйцэтгэл биш | probe D1 дээр `--file` БОЛОН `migrations apply` хоёуланг ажиллуулж давхар шалга |
| 5 | **Прод дээр `users`-ийн каскад хүүхдийн бодит тоо хэд вэ?** | Локал хуулбарт `0194`/`0195` хэрэгжээгүй тул 25 гарч байна; README 27 гэдэг | Алсаас бүх хүснэгт дээр `PRAGMA foreign_key_list` |

### 9.2 Хэмжигдээгүй — хэн ч тоолоогүй

| # | Асуулт | Одоо мэдэгдэж байгаа зүйл |
|---|---|---|
| 6 | **Инженер бүр өдөрт ХЭДЭН үйл явдал үүсгэх вэ?** ⚠️ **ХЭН Ч ХЭМЖЭЭГҮЙ.** | Харьцуулах цорын ганц тоо: `progress_entries` сүүлийн 30 хоногт **472 мөр** ≈ өдөрт 16, 49 хүнд. Гэхдээ `learning_events` нь илгээлт биш **үйлдэл** тутамд бичигдэнэ — 1–2 дараалал өндөр байх магадлалтай. §3.3-ын 40…200/өдөр нь **ТААМАГ**. Хэрэв бодит тоо 1,000/өдөр байвал жилд ~12M мөр = 10 ГБ таазанд ойртоно. **Ingest бичихээс өмнө add-in дээр 1 өдрийн хэмжилт хий** (1B-2-ын эхний ажил). |
| 7 | **Дундаж `payload_json` хэдэн байт вэ?** | Таамаг ~300 байт. `USER_ACTION`-ы элементийн id массив нь үүнийг арав дахин хэтрүүлж болно. Тиймээс §3.4-т `element_count` (тоо) санал болгосон, `element_ids` (массив) биш — гэхдээ энэ нь эцсийн шийдвэр биш. |

### 9.3 Эзний шийдвэр — инженерийн биш

| # | Асуулт | Яагаад эзэн шийдэх ёстой вэ |
|---|---|---|
| 8 | **`learning_events`-ийн хадгалах хугацаа хэд вэ?** | `0195_assistant_learning.sql:18-20` нь `assistant_logs`-д 90 хоног санал болгосон ч «одоохондоо автомат цэвэрлэгээ БАЙХГҮЙ — гараар» гэжээ. `learning_events` нь илүү нарийн (элемент түвшний үйл ажиллагаа) тул **хөдөлмөрийн харилцааны шийдвэр**. README-ийн «Эхлэхийн өмнө» хэсгийн 4 дэх асуулттай нэг. Энэ хариулт нь `BEFORE DELETE` trigger нэмэх эсэхийг шийднэ. |
| 9 | **Ажилтанд юу цуглуулж байгааг МЭДЭГДЭХ үү, зөвшөөрөл авах уу?** | Мөн адил хөдөлмөрийн харилцаа. `learning_events` нь `assistant_logs`-оос **илүү** цуглуулна: орхигдсон оролдлого, залруулга, цагийн дараалал. |
| 10 | **`idx_le_actor` индексийг ЕР НЬ шиплэх үү?** | Энэ нь **ажиглалтын гадаргуу**. Байхгүй бол өөрийгөө харах асуулга бүтэн скан хийж, D1 нь уншсан мөрөөр төлбөр авна. Байгаа бол ахлагчийн тайлан бичих техникийн саад арилж, зөвхөн кодын дүрэм үлдэнэ. **Энэ бичиг индексийг оруулахыг санал болгож, толгойн тайлбарт үл хөдлөх дүрмээр хүлж байгаа — гэхдээ эзний шийдвэр.** |
| 11 | **`REVIT_STATE` артефакт хэр том, хэр олон удаа бичигдэх вэ?** | R2-ийн зардал ба №6/№7-той холбоотой. Загварын бүтэн агшин уу, зөвхөн өөрчлөгдсөн хэсэг үү? |
| 12 | **`stream_id` нь ЮУГААР тодорхойлогдох вэ — баримт уу, өдөр үү, сесс үү?** | Энэ нь `UNIQUE(stream_id, seq)`-ийн зөв эсэхийг шийднэ. Хэрэв add-in дахин эхлэхэд `seq` тэглэгддэг бол давхардал үүснэ. **Add-in дээрх emitter-ийн загвартай нэг дор шийдэгдэх ёстой (1C).** Эргэлзээтэй бол `idx_le_seq`-ыг UNIQUE БИШ болго — сулруулах нь хямд, чангаруулах нь давхардсан өгөгдөлтэй бол БОЛОМЖГҮЙ. |
