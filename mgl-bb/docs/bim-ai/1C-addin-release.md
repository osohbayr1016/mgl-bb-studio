# 1C-addin-release — Add-in-ийн НЭГ релиз — хэмжилт, урьдчилан халаалт, busy guard, хувилбар, allowlist

> **Track:** 1C (+ 1A, 1B-ийн C# тал) · **Хамаарал:** `1B-3 assistant_logs provenance` (ЗААВАЛ ӨМНӨ deploy хийгдсэн байх), `1A-5 local agent auth (Python)` (ЯГ ЭНЭ цонхонд), `1A-6 QTO/batch privilege` (nonce — эхлээд ТЭВЧИНЭ) · **Блоклож буй:** Track C (typed BIM intent, инференс) — бүх C# өөрчлөлт энэ релизээр гарна · **Хөндөх файлууд:** `revit-mcp/addin/*.cs`, `revit-mcp/addin/RevitMcpAddin.csproj`, `revit-mcp/scripts/package-addin.ps1` (+ **зөвхөн 1B-3-д багтаагүй бол** `backend/src/routes/revit.ts`-ийн нэг хуучирсан тайлбар) · **Deploy тоо:** add-in **1** (нэг zip багц, 4 Revit хувилбар), backend **0** (энэ сесс backend deploy хийхгүй)

---

## 0. ЭНЭ СЕССИЙН ДҮРЭМ

**ЭНЭ БОЛ НЭГ РЕЛИЗ. Доорх БҮХ зүйл ХАМТДАА гарна.**

Ажилтны компьютер дээр **албадан шинэчлэх механизм БАЙХГҮЙ**. Тараалт бүр = ~20 компьютер, `Install.bat`, Revit хаалттай, хүн бүр дээр гар ажиллагаа. Энэ хөтөлбөрийн цорын ганц үнэхээр үнэтэй ажиллагаа. Тиймээс:

- Доорх 10 зүйлийн **аль нэгийг нь ч** «дараагийн релизэд» гэж хойшлуулж болохгүй. Хойшлуулбал энэ бүх өртөг **хоёр дахин** гарна.
- Хэрэв ямар нэг зүйл бэлэн биш байвал — **бүхэл релизийг хойшлуул**, хагасыг нь бүү гарга.

**Хамрах хүрээ (scope).** Зөвхөн `revit-mcp/addin/`, `revit-mcp/scripts/package-addin.ps1`. Backend-ийн ганц зөвшөөрөгдсөн засвар нь `backend/src/routes/revit.ts:1703` дэх **хуучирсан тайлбарын мөр** (доор §3.11) — код БИШ, зөвхөн тайлбар; хэрэв 1B-3 сесс аль хэдийн засчихсан бол огт хөндөхгүй.

**Бусад агентын ажил.** Энэ репод хэд хэдэн хөгжүүлэгч ЗЭРЭГ ажилладаг. Ажлын мод дээр өөр хүний **дуусаагүй, эмхэтгэгдэхгүй** файл байж болно.
- Даалгаварт хамааралгүй файлыг **үүсгэхгүй, засахгүй, устгахгүй** — «илт эвдэрсэн» харагдсан ч бүү хүр.
- `git restore`, `git checkout --`, өөрийн биш файлыг `git add` — **ХЭЗЭЭ Ч БИШ**.
- `dotnet build` эсвэл `npm run build` бүхэлдээ унасан нь **автоматаар таных биш**. Алдаанууд зөвхөн танд хамааралгүй файлд байгааг батал, дараа нь блокерыг эзэнд нь мэдэгд — өөрөө хөөцөлдөхгүй.

**Хориглох зүйлс.**

| ⛔ | Дүрэм |
|---|---|
| 1 | `backend/src/middleware/auth.ts` эсвэл `backend/src/lib/jwt.ts`-д `purpose === 'mcp'`-ийг **татгалзуулах шалгалт нэмэхгүй**. Add-in бүх REST дуудлагаа тэр токеноор хийдэг, refresh урсгал байхгүй. Алсаас сэргээх боломжгүй ЦОРЫН ГАНЦ өөрчлөлт |
| 2 | **Инференс (LLM дуудлага) НЭМЭХГҮЙ.** Энэ сесс зөвхөн байрлалын дүрмийг **тайлбар болгож** бичнэ (§3.10) |
| 3 | `ApiClient.cs:73`-ын `UserAgent` мөрийг **устгахгүй** — угтварыг хадгална (§3.5) |
| 4 | Миграц үүсгэхгүй, D1 хөндөхгүй, backend deploy хийхгүй |
| 5 | `IntentModel.Preprocess()` / `TextFold.Fold()` / `PreprocessContract` **хөндөхгүй** — Python-тай хосолсон гэрээ |

**Deploy хийж болох уу:** Энэ сесс **deploy ХИЙХГҮЙ**. Зөвхөн build + zip багц бэлдэж, `revit-mcp/dist/`-д гаргаад эзэнд өгнө. Тараалт нь гар ажиллагаа.

---

## 1. КОНТЕКСТ

### Систем (хүйтэн сесст)

| Хэсэг | Юу |
|---|---|
| `backend/` | Cloudflare Worker — Hono, `@cloudflare/workers-oauth-provider`-оор ороосон. D1 (SQLite) + R2 (`MEDIA_BUCKET` нийтийн / `MEETING_BUCKET` хаалттай) + KV + нэг Durable Object (`MglMcpAgent`) |
| `frontend/` | Vite + React 19 SPA, Cloudflare Pages, төсөл нэр **`mgl-design-system`** (`--project-name mgl-design-system`-ийг ил бичнэ) |
| `revit-mcp/addin/` | Revit 2024–2027 add-in, C#/WPF, процессын дотор. **43 `.cs` файл, 13,463 мөр** (XAML-тай нийлээд 49 файл / 14,421 мөр). **Тест ТЭГ.** Ажилтны PC дээр автомат шинэчлэл БАЙХГҮЙ |
| `revit-mcp/training/` | Python intent-classifier сургалтын шугам, git-д хянагддаг |
| `revit-mcp/server/`, `revit-mcp/agent/` | Python MCP гүүр ба бие даасан локал агент (`agent/mgl_agent.py`) |
| Хэмжээ | ~49 идэвхтэй мэдлэгийн ажилтан. Продакшн D1 = 45 MB / 114 хүснэгт; хамгийн том нь `progress_entries` 8,062 мөр |

### Тавцангийн хатуу хязгаарлалт (энэ даалгаварт хамаарах)

- **D1: нэг statement-д 100 bind.** Тохируулсан жишээ: `routes/qto.ts:832` (21 bind × 4 мөр = 84), `routes/revit.ts:58-59` (13 × 7 = 91). ⚠️ `routes/revit.ts:1703`-ын тайлбар нь тогтмолтойгоо **зөрчилддөг** — §2.16.
- **Миграц нь append-only.** 190 файл, хамгийн өндөр нь `0200_assistant_feedback_note.sql`. Хэрэгжсэн файлыг засах нь продакшн дээр **чимээгүй no-op**. **Энэ сесс миграц үүсгэхгүй.**
- **Deploy нь локал wrangler, CI БИШ.** GitHub-ийн хоёр workflow хоёулаа үхмэл. `npx wrangler deploy --config wrangler.toml` — `--config` нь ЗААВАЛ (репо root-д `wrangler.jsonc` өөр worker зарладаг). `wrangler deploy` нь **typecheck ХИЙХГҮЙ** — `tsc --noEmit`-ыг өөрөө ажиллуул.
- **`wrangler pages` дэд команд бүрийг `npx -y wrangler@latest`-ээр** ажиллуулна.

### Add-in-ийн бүтэц (энэ даалгаварт хамаарах хэсэг)

```
AssistantPane.xaml.cs (2113 мөр)  — WPF dockable самбар, UI thread
   ├─ SendBtn_Click ──> IntentRouter.Route ──> [keyword | model | fallback]
   │                        │                       │
   │                        │                       └─ IntentModel.Predict ──> EnsureLoaded()  (918 KB JSON parse)
   │                        └─ ExecuteIntentAsync ──> RunToolAsync / IsolateAsync / MakeDraftAsync
   │                                                       └─ RevitApi.CallTool ──> RevitToolBus.Call
   ├─ AskAgentAsync (⚠️ ДУУДАГЧГҮЙ — доор §2.9) ──> AgentChat.RunAsync
   └─ FlushLogsSoon ──> AssistantLog.FlushAsync ──> POST /api/revit/assistant/logs

RevitToolBus.cs  — SemaphoreSlim + ConcurrentQueue + ExternalEvent → Revit-ийн ҮНДСЭН thread
RevitTools.cs    — 10 typed хэрэгслийн switch (жинхэнэ dispatcher)
ChangeTracker.cs — app.DocumentChanged (8 үйл явдал) + 3 сек debounce Timer
IntentModel.cs   — офлайн logistic-regression ангилагч, char 3-5-gram
```

### Яагаад энэ даалгавар байна вэ

1. **Хэмжилт байхгүй.** Add-in-д end-to-end latency-ийн хэмжилт **ТЭГ**. «250 мс» гэдэг нь шаардлага биш — хэн ч хэмжээгүй тоо. Юуг оптимизац хийхээ мэдэхгүй байгаад **инференс нэмэх нь сохроор нэмэх** гэсэн үг.
2. **Загварын ачаалалт хүйтэн ба уралдаантай.** 918 KB JSON parse нь хэрэглэгчийн ЭХНИЙ мессежийн UI thread дээр унадаг; давхар нь `_loadAttempted` тугийн **publication hazard** — өнөөдөр унтаа, урьдчилан халаалт нэмбэл СЭРНЭ.
3. **Кэшийн параметр хэзээ ч ажилладаггүй** — сесс бүрт 918 KB дахин татагдана.
4. **Busy guard нүх.** Enter товч нь товчны `IsEnabled`-ыг тойрч, `SendBtn_Click`-д busy шалгалт байхгүй атал **бүртгэл `acted: true` бичигддэг** — сургалтын багц хордоно.
5. **Build танигдахгүй.** DLL бүр `1.0.0.0`. Аль ажилтан аль build-тай явж байгааг мэдэх арга байхгүй.
6. **Хэрэгслийн allowlist серверт л байна**, клиент талд байхгүй.

---

## 2. БАТАЛГААЖСАН ОДООГИЙН ЗАН ТӨЛӨВ

> Доорх мөр бүрийг энэ сесс **файл нээж баталсан** (2026-08-27). Спекийн зөрсөн газруудыг ⚠️-ээр тэмдэглэв.

### 2.1 Хэмжилт байхгүй нь — батлагдсан

`revit-mcp/addin`-д `Stopwatch` / `ElapsedMilliseconds`-ийн **бүх** тохиолдол:

| Файл:мөр | Юу хийж байна | Латентын хэмжилт мөн үү |
|---|---|---|
| `ChangeReport.cs:591` | `FindViewShowing(..., Stopwatch.StartNew(), ...)` | ❌ төсвийн **хязгаарлагч** |
| `ChangeReport.cs:664, 683` | `sw.ElapsedMilliseconds > budgetMs` | ❌ хязгаарлагч, утга нь **хаягддаг** |
| `ChangeReport.cs:793, 798, 802` | `sw.ElapsedMilliseconds > DigestBudgetMs` | ❌ хязгаарлагч, утга нь **хаягддаг** |
| `BatchQto.cs:103` → `:155` | `result.DurationSec = Math.Round(watch.Elapsed.TotalSeconds, 1)` | ⚠️ ЦОРЫН ГАНЦ бодит хугацаа — **толгойгүй batch** горимын нэг файлын нийт хугацаа, интерактив урсгалтай ямар ч холбоогүй |

**Дүгнэлт: интерактив урсгалд end-to-end латентын хэмжилт ТЭГ.** Спекийн нэхэмжлэл 100% зөв.

### 2.2 Илгээх handler ба busy guard — батлагдсан

```
AssistantPane.xaml.cs:1325   private void InputBox_KeyDown(object sender, KeyEventArgs e)
AssistantPane.xaml.cs:1328       if (e.Key == Key.Enter &&
AssistantPane.xaml.cs:1329           (Keyboard.Modifiers & ModifierKeys.Shift) != ModifierKeys.Shift)
AssistantPane.xaml.cs:1331           e.Handled = true;
AssistantPane.xaml.cs:1332           SendBtn_Click(sender, null);        // ← товчны IsEnabled-ыг ТОЙРНО
```

```
AssistantPane.xaml.cs:1336   private async void SendBtn_Click(object sender, RoutedEventArgs e)
AssistantPane.xaml.cs:1339       if (string.IsNullOrWhiteSpace(text)) return;   // ← ЦОРЫН ГАНЦ эрт гарц
```

**`SendBtn_Click`-д `_busy` шалгалт БАЙХГҮЙ.** `_busy` нь `AssistantPane.xaml.cs:219`-д зарлагдаж, `SetBusy` (`:331-342`) дотор тавигддаг ба `SendBtn.IsEnabled = !busy` (`:335`) нь **зөвхөн хулганы товшилтыг** хаадаг.

Гэтэл handler нь бүртгэлийг **үйлдэл хийсэн гэж** бичдэг:

| Мөр | Бичилт |
|---|---|
| `:1366` | `_lastLogId = AssistantLog.Record(route, text, acted: true);` (хүлээгдэж буй асуултын хариу) |
| `:1377` | `_lastLogId = AssistantLog.Record(route, text, acted: false);` (fallback — зөв) |
| `:1386` | `_lastLogId = AssistantLog.Record(route, text, acted: true);` (ердийн зам) |

Харин бодит гүйцэтгэгч нь чимээгүй буцдаг:

```
AssistantPane.xaml.cs:1398   private async Task RunToolAsync(string tool, object args, string okMessage)
AssistantPane.xaml.cs:1400       if (_busy) return;              // ← юу ч хийхгүй, ХЭЛЭХГҮЙ
```

**Үр дүн:** завгүй үед Enter дарахад `assistant_logs`-д `acted = 1` мөр орж, бодитоор ЮУ Ч болохгүй. Тэр мөр `assistant_examples` руу шошголж орох тул **сургалтын багц хордоно**.

**Тусгаарлах зам мөн адил нүхтэй** — `IsolateAsync` (`:1427`):

```
AssistantPane.xaml.cs:1437   JsonElement sheets = await Task.Run(() => RevitApi.CallTool("list_sheets"));
```

Энэ нь **busy шалгалтгүйгээр** жинхэнэ хэрэгслийн дуудлага хийнэ (`RevitToolBus.Call` → Revit-ийн үндсэн thread), дараа нь `:1516` дээрх `RunToolAsync` нь `_busy` дээр чимээгүй унана. Өөрөөр хэлбэл **үнэтэй ажил хийгээд үр дүнг нь хаяна**.

`AskAgentAsync` (`:2035`) **нь** `if (_busy) return;`-тэй (`:2037`) — гэвч түүнийг дуудагч байхгүй (§2.9).

### 2.3 `IntentModel` ачаалалт — publication hazard батлагдсан

```
IntentModel.cs:89    private static IntentModelData _model;
IntentModel.cs:90    private static bool _loadAttempted;              // ← volatile БИШ
IntentModel.cs:91    private static readonly object Gate = new object();
IntentModel.cs:94    public static string LoadedVersion => _model?.Version;   // ← EnsureLoaded ДУУДАХГҮЙ
IntentModel.cs:107   private static void EnsureLoaded()
IntentModel.cs:109       if (_loadAttempted) return;                  // ← ТҮГЖЭЭНЭЭС ГАДНА уншина
IntentModel.cs:110       lock (Gate)
IntentModel.cs:112           if (_loadAttempted) return;
IntentModel.cs:113           _loadAttempted = true;                   // ← _model-ЫГ ОНООХООС ӨМНӨ
IntentModel.cs:119               _model = Parse(File.ReadAllText(LocalModelPath, Encoding.UTF8));
IntentModel.cs:123               _model = LoadEmbedded();
```

**Уралдаан:** thread A `:113`-д тугийг `true` болгоод `:119`-ийн 918 KB parse дээр байх зуур, thread B нь `:109`-д `_loadAttempted == true` уншаад **буцна**; `Predict`-ийн `:237-240`:

```
IntentModel.cs:237       EnsureLoaded();
IntentModel.cs:238       IntentModelData m = _model;
IntentModel.cs:239       if (m == null) return none;                  // ← ЧИМЭЭГҮЙ fallback
```

→ `Intent = null` → `IntentRouter.Route` нь `DecidedBy.Fallback` руу унана (`IntentRouter.cs:192`) → `AssistantPane.xaml.cs:1377` нь тэр мөрийг **сургалтын логд** бичнэ. Загвар бүрэн ажиллаж байхад «ойлгосонгүй» гэсэн мөр гарна.

**Өнөөдөр энэ уралдаан УНТАА** — `EnsureLoaded` руу зэрэг орох дуудагч байхгүй (`Predict` зөвхөн UI thread-ээс). **Урьдчилан халаалт нэмэх нь яг түүнийг сэрээх үйлдэл.**

**Thread affinity нь АЮУЛГҮЙ — батлагдсан.** `EnsureLoaded` / `LoadEmbedded` / `Parse` (`IntentModel.cs:107-166`) нь зөвхөн `File`, `Assembly.GetExecutingAssembly()`, `StreamReader`, `JsonSerializer`, статик талбартай ажиллана. `Autodesk.Revit.*` төрөл, `Document`, UI-д холбогдсон төлөв **нэг ч байхгүй** (файлын `using`-ууд: `System`, `System.Collections.Generic`, `System.Globalization`, `System.IO`, `System.Text`, `System.Text.Json`, `System.Text.Json.Serialization` — Revit-ийн ямар ч namespace байхгүй).

**Мөн ЯГ ИЖИЛ parse аль хэдийн арын thread дээр ажилладаг:**

```
AssistantPane.xaml.cs:1730   _ = Task.Run(async () => {
AssistantPane.xaml.cs:1731       string ver = await ApiClient.SyncIntentModelAsync(st.ApiHost, st.Token, have)
ApiClient.cs:168             if (!IntentModel.SaveDownloaded(w.GetRawText())) return null;
IntentModel.cs:173               if (Parse(json) == null) return false;      // ← арын thread дээрх parse
```

**Reload зам нь UI dispatcher дээр — батлагдсан:**

```
AssistantPane.xaml.cs:1735   await Dispatcher.InvokeAsync(() => {
AssistantPane.xaml.cs:1737       IntentModel.Reload();
```

`Reload()` (`IntentModel.cs:102-105`) нь `lock (Gate)` дотор зөвхөн хоёр талбарыг null болгоно — хямд. **Гэхдээ жинхэнэ 918 KB parse нь дараагийн `Predict`-д хойшлогдоно**, тэр нь `SendBtn_Click:1351` → `IntentRouter.Route` → `IntentModel.Predict` → `EnsureLoaded` замаар **UI thread дээр** унана. Хэрэглэгчийн хувьд: «загвар шинэчлэгдлээ» гэсэн мөрийн дараах ЭХНИЙ мессеж хөлддөг.

⚠️ **Спекийн нэг зүйлийг нарийсгах шаардлагатай:** «a background pre-warm holding the lock would move the freeze rather than remove it» — тийм, ГЭХДЭЭ зөвхөн `Predict` нь халаалт дуусахаас өмнө ирвэл. `Gate` дээр хүлээх нь UI thread-ийг блоклоно. Тиймээс §3.1-ийн шийдэл нь хурдан замд **талбарыг** шалгадаг: халаагаагүй байхад `Predict` нь өнөөгийн замаараа явна, түгжээ нь зөвхөн давхар parse-аас хамгаална.

### 2.4 Кэшийн `?have=` параметр хэзээ ч ажилладаггүй — батлагдсан

```
AssistantPane.xaml.cs:256    public AssistantPane()
AssistantPane.xaml.cs:276        Loaded += async (s, e) => {
AssistantPane.xaml.cs:278            ResizeBubbles();
AssistantPane.xaml.cs:279            SyncIntentModelSoon();          // ← ямар ч Predict-ээс ӨМНӨ
AssistantPane.xaml.cs:280            await ReloadAsync(silent: true);
...
AssistantPane.xaml.cs:1728       string have = IntentModel.LoadedVersion;   // ← _model null тул null
```

`LoadedVersion` (`IntentModel.cs:94`) нь `_model?.Version` — **`EnsureLoaded()` дуудахгүй**. Самбар нээгдэх үед хараахан нэг ч `Predict` ажиллаагүй тул `_model == null` → `have == null`.

```
ApiClient.cs:144         if (!string.IsNullOrEmpty(have)) path += "?have=" + Uri.EscapeDataString(have);
```

→ параметр **огт нэмэгдэхгүй**. Серверийн богиносгол хэзээ ч ажиллахгүй:

```
backend/src/routes/revit.ts:1766     if (have && have === row.version) {
backend/src/routes/revit.ts:1767         return c.json({ version: row.version, unchanged: true });
```

→ `:1774` дээрх `weights: JSON.parse(row.weights_json)` **бүтэн блоб** сесс бүрт татагдана.

**Файлын бодит хэмжээ: `revit-mcp/addin/Resources/intent-model.json` = 940,283 байт (≈918 KB).**

⚠️ Хоёр тайлбар **буруу тоо** хэлдэг: `ApiClient.cs:136` «~400 KB», `backend/src/routes/revit.ts:1746` «~500 KB». Хоёулаа бодит хэмжээнээс **2× бага**. Энэ релизэд `ApiClient.cs`-ийнхийг засна (§3.3).

### 2.5 Хэрэгслийн allowlist — гурван түвшний зөрүү батлагдсан

| Түвшин | Файл | Тоо | Багц |
|---|---|---|---|
| **Add-in зарладаг** (`ToolSpecs()`) | `AgentChat.cs:86-130` | **8** | `get_document_context`, `list_sheets`, `capture_baseline`, `diff_since_baseline`, `list_changes`, `goto_element`, `isolate_sheet_elements`, `reset_isolation` |
| **Сервер зөвшөөрдөг** (`ALLOWED_TOOLS`) | `backend/src/lib/revitAgent.ts:48-63` | **9** | дээрх 8 + `capture_view_image` |
| **Add-in ГҮЙЦЭТГЭЖ ЧАДДАГ** (`switch`) | `RevitTools.cs:57-73` | **10** | дээрх 9 + **`change_digest`** |

`AgentChat.Labels` (`AgentChat.cs:71-83`) нь 9 бичлэгтэй — `capture_view_image` тэнд БАЙГАА ч `ToolSpecs()`-д БАЙХГҮЙ.

**Сервер юуг шүүдэг вэ:**

- **Схемийг** гарахдаа шүүнэ: `revitAgent.ts:189` — `if (!ALLOWED_TOOLS.includes(t.name)) { dropped.push(t.name); continue; }`
- **Workers AI-ийн tool_calls-ыг** шүүнэ: `revitAgent.ts:378` — `.filter((c) => c && typeof c.name === 'string' && ALLOWED_TOOLS.includes(c.name))`
- **Anthropic-ийн tool_use блокуудыг ШҮҮХГҮЙ:**

```
backend/src/lib/revitAgent.ts:317   export function shapeAnthropic(
backend/src/lib/revitAgent.ts:328       else if (b?.type === 'tool_use') {
backend/src/lib/revitAgent.ts:329           toolUses.push({ id: ..., name: String(b.name ?? ''), input: ... });
backend/src/lib/revitAgent.ts:343       assistantContent: content,          // ← түүхий, шүүгээгүй
```

Нэр дээр ямар ч шалгалт байхгүй.

**Add-in клиент талд allowlist БАЙХГҮЙ:**

```
AgentChat.cs:380       ToolCall call = await Task.Run(
AgentChat.cs:381           () => RevitToolBus.Call(tu.Name, argsJson));
```

`tu.Name` шууд шатаж орно. **Бодит allowlist = `RevitTools.Run`-ий switch (10 хэрэгсэл), энэ нь серверийн 9-ийн ХАТУУ дээд олонлог.**

**Зөрүү (delta):** Anthropic загвар хийсвэрлэн `change_digest` (эсвэл зарлагдаагүй `capture_view_image`) гэж нэрлэвэл — сервер түүнийг хаяхгүй, add-in гүйцэтгэнэ. Хоёулаа зөвхөн УНШИНА, тиймээс өнөөдөр эрсдэл нь **бага** — гэхдээ хилийг клиент талд **давхарлах** нь энэ релизийн зорилго.

### 2.6 Build identity — батлагдсан

`RevitMcpAddin.csproj`-д `<Version>`, `<AssemblyVersion>`, `<FileVersion>`, `<InformationalVersion>` **нэг ч байхгүй** (`grep -n "Version" RevitMcpAddin.csproj` — бүх таарц нь `RevitVersion` (Revit он) эсвэл `PackageReference Version`).

Үүсгэгдсэн `obj/x64/Release R27/RevitMcpAddin.AssemblyInfo.cs`:

```
[assembly: System.Reflection.AssemblyFileVersionAttribute("1.0.0.0")]
[assembly: System.Reflection.AssemblyVersionAttribute("1.0.0.0")]
[assembly: System.Reflection.AssemblyInformationalVersionAttribute("1.0.0+4b605cad8657eb48c040ef0de24a7e874c34d259")]
```

→ Файлын хувилбар нь **үргэлж `1.0.0.0`**. (SourceLink-ийн `+<sha>` нь `InformationalVersion`-д ирдэг ч түүнийг хаана ч уншдаггүй, бүртгэлд ч илгээдэггүй.)

**User-Agent угтвар — ЗААВАЛ хадгална:**

```
ApiClient.cs:73          c.DefaultRequestHeaders.UserAgent.ParseAdd("MglRevitAddin/1.0");
```

`:58-72`-ын тайлбар нь 2026-08-25-нд **хэмжиж** баталсныг тэмдэглэсэн: UA-гүй → Cloudflare Browser Integrity Check **403, error code 1010**, Worker-т хүрэхээс нь ӨМНӨ; UA-тай → 401 (жинхэнэ алдаа). «⚠️ Үйлчлүүлэгч бүрийн deployment Cloudflare-ийн ард байх тул энэ мөрийг ХЭЗЭЭ Ч БҮҮ УСТГА.»

**Савлагааны скрипт манифест үүсгэдэггүй:** `revit-mcp/scripts/package-addin.ps1:217-223` нь зөвхөн `Compress-Archive` + MB хэвлэнэ. `sha256`, хувилбарын манифест **байхгүй**. (Скрипт дэх `$manifest` хувьсагч нь `RevitMcpAddin.addin` файл — релизийн манифест БИШ.)

**`dist/` нь git-д ороогүй — батлагдсан:** `revit-mcp/.gitignore:13` → `dist/`. Одоо байгаа zip-үүд **2026-08-24**-ний огноотой, өөрөөр хэлбэл 08-25/08-26-ны бүх ажлаас ӨМНӨХ. Аль инженер дээр аль build суусныг **репо хэлж чадахгүй**.

**`backend/src`-д суулгацын R2 түлхүүр бичдэг код БАЙХГҮЙ** — `grep -rn "addin|installer|RevitMcpAddin|\.zip" backend/src --include=*.ts` нь зөвхөн `/api/revit-addin` route mount (`index.ts:213-218`, `lib/modules.ts:135,224`) болон `revitAgent.ts:43`-ын тайлбарыг олно. Тараалт нь бүрэн гар ажиллагаа.

### 2.7 Локал агент — токен уншигч байхгүй

```
revit-mcp/agent/mgl_agent.py:61     PORT = int(os.environ.get("MGL_AGENT_PORT", "5099"))
revit-mcp/agent/mgl_agent.py:294    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
```

`Authorization` шалгалт **байхгүй** (`grep -n "token|Authorization|auth"` нь тэр файлд аутентикацийн код олохгүй).

⚠️ **Спекийн «The shipped DLLs contain no client for that port today» гэдэг НАРИЙВЧЛАЛГҮЙ.** Клиент **БАЙНА**:

```
AgentChat.cs:174-176   public static string LocalUrl => ... ?? "http://127.0.0.1:5099";
AgentChat.cs:185-206   public static async Task<bool> IsLocalAvailableAsync()   // GET /health
AgentChat.cs:217-273   private static async Task RunLocalAsync(...)             // POST /chat, NDJSON
```

Байхгүй нь **токен уншигч**: `AgentChat.cs:220-223` нь `/chat` руу `Authorization` толгойгүй илгээдэг, `AgentChat.cs:196-197` нь `/health`-д мөн адил. Мөн `BridgeAuth` (порт 5005-ын bridge токен) нь `%APPDATA%\RevitMcpAddin\bridge.json`-д бичигддэг (`BridgeAuth.cs:49-71`) — тэр нь **өөр порт, өөр зориулалт**, агентын 5099-д огт хамааралгүй.

### 2.8 Batch queue — nonce байхгүй, тэвчээр аль хэдийн бий

```
BatchQto.cs:33     private static string QueuePath => Path.Combine(Dir, "batch-queue.json");
BatchQto.cs:64     File.Move(QueuePath, ProcessingPath);
BatchQto.cs:66     queue = JsonSerializer.Deserialize<BatchQueue>(File.ReadAllText(ProcessingPath));
BatchQto.cs:201-208   class BatchQueue { [exit] bool Exit = true; [files] List<BatchFile> Files; }
BatchQto.cs:210-217   class BatchFile { [path] string Path; [project_id] int ProjectId; }
```

`nonce` талбар **байхгүй**. `Deserialize` нь **анхдагч** `JsonSerializerOptions`-той (тохиргоо дамжуулаагүй) тул `UnmappedMemberHandling` нь `Skip` — **танихгүй талбар чимээгүй алгасагдана**. Өөрөөр хэлбэл **nonce-той queue файлыг өнөөдрийн add-in аль хэдийн тэвчинэ**; гэхдээ түүнийг ил тод болгож, DTO-д нэмэх ёстой (§3.8).

### 2.9 ⚠️ ШИНЭ ОЛОЛТ — AI агентын зам ДУУДАГЧГҮЙ

`grep -rn "AskAgentAsync|AgentChat\." revit-mcp/addin --include=*.cs --include=*.xaml` (obj-гүй) бүх таарц:

```
AssistantPane.xaml.cs:195    (зөвхөн тайлбар)
AssistantPane.xaml.cs:2035   private async Task AskAgentAsync(string text)   ← ТОДОРХОЙЛОЛТ
AssistantPane.xaml.cs:2044   bool localUp = await AgentChat.IsLocalAvailableAsync();
AssistantPane.xaml.cs:2085   await AgentChat.RunAsync(...)
```

**`AskAgentAsync`-ыг дуудах ганц ч мөр байхгүй.** `ExecuteIntentAsync` (`:1758-…`) нь түүнийг дуудахгүй; `SendBtn_Click`-ийн fallback салаа (`:1375-1384`) нь зөвхөн сонголт харуулна.

**Үр дагавар:** `AgentChat.cs` (448 мөр), серверийн `/api/revit/agent/turn` (`routes/revit.ts:1499`), `lib/revitAgent.ts` (бүхэлдээ) — эдгээр нь **өнөөдөр гүйцэтгэгдэхгүй**. §2.5-ын allowlist зөрүү, §3.6-ын клиент талын allowlist нь **урьдчилан сэргийлэлт**, амьд эмзэг байдал БИШ. Энэ бол сайн мэдээ: хилийг **инференс асахаас ӨМНӨ** засах цонх бидэнд байна. Эзэнд заавал мэдэгд (§9-ийн 8).

### 2.10 Tool bus — задлах зургаан хэсэг батлагдсан

```
RevitToolBus.cs:89    public static ToolCall Call(string tool, string argsJson, int timeoutSeconds = 120)
RevitToolBus.cs:108       int deadline = Environment.TickCount + Math.Max(1, timeoutSeconds) * 1000;
RevitToolBus.cs:110       if (!Gate.Wait(Math.Max(1, timeoutSeconds) * 1000)) { ... }     ← ДАРААЛЛЫН ХҮЛЭЭЛТ
RevitToolBus.cs:120       Queue.Enqueue(call);                                            ← ENQUEUE
RevitToolBus.cs:122       ExternalEventRequest raised = _event.Raise();
RevitToolBus.cs:132       while (!call.Done.IsSet) { if (call.Done.Wait(50)) break; ... } ← EXTERNAL EVENT ХҮЛЭЭЛТ
RevitToolBus.cs:143           call.Abandoned = true;                                      ← ХУГАЦАА ДУУСАЛТ
RevitToolBus.cs:151       return call;                                                    ← ХАРИУ
RevitToolBus.cs:155       Gate.Release();

RevitToolBus.cs:182   public void Execute(UIApplication app)          ← Revit-ийн ҮНДСЭН thread
RevitToolBus.cs:180       private const int MaxPerSlice = 4;
RevitToolBus.cs:185       while (done < MaxPerSlice && _queue.TryDequeue(out ToolCall call))
RevitToolBus.cs:190           if (call.Abandoned) { call.Done.Set(); continue; }
RevitToolBus.cs:199           call.ResultJson = RevitTools.Run(app, call.Tool, call.ArgsJson);   ← REVIT ГҮЙЦЭТГЭЛ + СЕРИАЛЧЛАЛ
RevitToolBus.cs:210           call.Done.Set();
RevitToolBus.cs:217       if (!_queue.IsEmpty) RevitToolBus.RaiseAgain();
```

`RevitApi.CallTool` (`RevitApi.cs:516-526`) нь `TimeoutFor(tool)`-оор хугацаа өгдөг (`:489-512`: 15/25/30/45 сек). ⚠️ Харин `AgentChat.cs:381` нь **`TimeoutFor`-ыг ашигладаггүй** — анхдагч 120 секунд. (Хамрах хүрээнээс гадуур, гэхдээ хэмжилтийн тайлбарт хэрэгтэй.)

### 2.11 DocumentChanged handler ба flush timer

```
ChangeTracker.cs:292   public static void Init(ControlledApplication app)
ChangeTracker.cs:296       app.DocumentChanged += OnDocumentChanged;
ChangeTracker.cs:297       app.DocumentClosing += OnDocumentClosing;
ChangeTracker.cs:303       app.DocumentOpened += OnDocumentOpened;
ChangeTracker.cs:304       app.DocumentCreated += OnDocumentCreated;
ChangeTracker.cs:306       app.DocumentSynchronizingWithCentral += OnSuppressStart;
ChangeTracker.cs:307       app.DocumentSynchronizedWithCentral += OnSuppressEnd;
ChangeTracker.cs:308       app.DocumentReloadingLatest += OnSuppressStart;
ChangeTracker.cs:309       app.DocumentReloadedLatest += OnSuppressEnd;
ChangeTracker.cs:313       _flushTimer = new Timer(_ => FlushDirty(), null, FlushIntervalMs, FlushIntervalMs);   // 3000 мс
```

**Найман захиалга + нэг таймер.**

```
ChangeTracker.cs:701   private static void OnDocumentChanged(object sender, DocumentChangedEventArgs e)
ChangeTracker.cs:710       string opName = OpNameOf(e);        // ТҮГЖЭЭНЭЭС ГАДНА — Revit API-ийн цорын ганц хүрэлт
ChangeTracker.cs:713       lock (Gate) { ... }                 // олонлогийн алгебр, диск ХӨНДӨХГҮЙ
```

Энэ нь **Revit-ийн үндсэн thread дээр, гүйлгээ бүрийн дараа** ажилладаг — хэрэглэгчийн зурж буй үйлдэл бүрийг удаашруулна.

```
ChangeTracker.cs:473   private static void FlushDirty()
ChangeTracker.cs:479       lock (Gate) {                       ← ТҮГЖЭЭ БАРИХ ХЭСЭГ ЭНД ЭХЭЛНЭ
ChangeTracker.cs:481           if (Dirty.Count == 0) return;
ChangeTracker.cs:483-499       ... ToArray(c.Added/Deleted/Modified), MetaToArray(c.Meta) ...
ChangeTracker.cs:500           Dirty.Clear();
ChangeTracker.cs:501       }                                   ← ТҮГЖЭЭ СУЛРАНА
ChangeTracker.cs:503       Directory.CreateDirectory(Dir);     ← диск бичилт ТҮГЖЭЭНЭЭС ГАДНА (зөв)
```

**Түгжээ барих хэсэг нь олонлогуудыг массив болгож хуулах явц** — 500 k id хүртэл өсч болно (`MaxTrackedIds = 500000`, `:63`). Тэр хугацаанд `OnDocumentChanged` нь Revit-ийн үндсэн thread дээр `lock (Gate)` (`:715`) дээр **хүлээнэ**. Энэ бол хэмжих ёстой цорын ганц бодит блоклолт.

### 2.12 Унтраалт нь юуг ч сулладаггүй

```
App.cs:141   public Result OnShutdown(UIControlledApplication application)
App.cs:143   #if MCP_EXECUTOR
App.cs:144       try { _server?.Stop(); } catch { }
App.cs:147       try { BridgeAuth.Revoke(); } catch { }
App.cs:148   #endif
App.cs:149       return Result.Succeeded;
```

- `DocumentChanged` ба бусад **7 захиалга унтраагдахгүй**.
- `_flushTimer` **Dispose хийгдэхгүй**.
- Бүх бие нь `#if MCP_EXECUTOR` дотор → **net48 (Revit 2024)-д `OnShutdown` бүрэн хоосон**. Тэр target-д алдагдал **болзолгүй**.

`ChangeTracker`-т `Dispose` / `Shutdown` / unsubscribe хийх нийтийн арга **байхгүй**.

### 2.13 Тохиргоо мессеж бүрт дискнээс уншигдаж, DPAPI-аар тайлагддаг

```
AssistantPane.xaml.cs:284   private AddinSettings Settings => SettingsStore.Load();     ← property, кэш БИШ
SettingsStore.cs:25         public static AddinSettings Load()
SettingsStore.cs:29             if (File.Exists(SettingsPath))
SettingsStore.cs:32                 JsonSerializer.Deserialize<AddinSettings>(File.ReadAllText(SettingsPath));
SettingsStore.cs:44                 settings.Token = Unprotect(settings.TokenEnc);       ← DPAPI Unprotect
SettingsStore.cs:117            ProtectedData.Unprotect(enc, null, DataProtectionScope.CurrentUser);
```

Самбар дотор `Settings`-ыг уншдаг мөрүүд: `:360, 459, 493, 563, 611, 1012, 1155, 1272, 1725, 1747, 2038`. Нэг мессеж илгээхэд **дор хаяж хоёр** удаа ажиллана — ноорог бэлдэх зам (`:1012` эсвэл `:563`) ба `FlushLogsSoon` (`:1747`). Репо даяар `SettingsStore.Load()`-ыг **16 газраас** дууддаг.

Локал SSD дээр хор хоргүй; **roaming profile** (домэйны хэрэглэгч, сүлжээний `%APPDATA%`) дээр энэ нь **хязгааргүй сааталт** — сүлжээ удаашрахад мессеж бүр хөлдөнө.

### 2.14 Ганц `HttpClient`, cancellation байхгүй

```
ApiClient.cs:52    internal static readonly HttpClient Http = CreateClient();
ApiClient.cs:56        var c = new HttpClient { Timeout = TimeSpan.FromSeconds(180) };
```

`:45-51`-ын тайлбар: 180 секунд нь **20,000 мөрийн QTO payload ба хэдэн MB PDF байршуулалтад** зориулагдсан.

Репо даяар `new HttpClient` нь **зөвхөн энэ нэг газар**. `CancellationToken` нь **бүх add-in-д ганц удаа** гарна: `AgentChat.cs:195` (локал `/health` probe-ийн 5 секунд). `PostTurnAsync` (`AgentChat.cs:442`), `RunLocalAsync` (`AgentChat.cs:225-227`), `AssistantLog.FlushAsync` (`AssistantLog.cs:298`) — **нэг ч токен байхгүй**.

Самбарт **цуцлах товч БАЙХГҮЙ** (`grep -n "Cancel|Зогсоо|StopBtn" AssistantPane.xaml AssistantPane.xaml.cs` → таарц тэг).

### 2.15 Сервер `model_version`-ийг чимээгүй хаядаг — 1B-3-ын хамаарлын баталгаа

Add-in илгээдэг:

```
AssistantLog.cs:41     [JsonPropertyName("model_version")] public string ModelVersion { get; set; }
AssistantLog.cs:185        ModelVersion = IntentModel.LoadedVersion,
```

Сервер хүлээж авдаг талбарууд (`backend/src/routes/revit.ts:1679-1697` дэх `.map(...)`): `id, text, predicted, confidence, decided_by, corrected, feedback_note, feedback, acted, doc_uid, revit_version, project_id`. **`model_version` БАЙХГҮЙ.**

INSERT-ийн баганууд (`revit.ts:1722-1726`): `user_id, project_id, doc_uid, revit_version, text, predicted, confidence, decided_by, corrected, feedback, acted, client_id, feedback_note` — **13 багана, `model_version` БАЙХГҮЙ.**

Хүснэгтийн схем (`backend/migrations/0195_assistant_learning.sql:70-101`) — **`model_version` багана огт байхгүй**.

**⇒ Хэмжилтийн шинэ талбарууд ч ЯГ ИЖИЛ хаягдана.** `1B-3` нь баганууд ба серверийн уншилтыг нэмэх ёстой, ЭНЭ РЕЛИЗЭЭС ӨМНӨ deploy хийгдсэн байх ЁСТОЙ.

### 2.16 D1-ийн bind тайлбарын зөрүү — батлагдсан

```
backend/src/routes/revit.ts:1703   // 12 bind/мөр → floor(100/12) = 8 мөр/statement (D1-ийн 100 bind хязгаар).
backend/src/routes/revit.ts:1704   // ⚠️ БАГАНА НЭМБЭЛ ЭНЭ ТООГ ЗАСАХ ЁСТОЙ.  D1-ийн нэг statement 100
backend/src/routes/revit.ts:1705   // bind-аар хязгаарлагдана; 13 × 7 = 91 ≤ 100.
backend/src/routes/revit.ts:1706   const BINDS = 13;
backend/src/routes/revit.ts:1707   const PER = Math.floor(100 / BINDS);
```

**Мөр 1703 нь ХУУЧИРСАН** (12/8) — тогтмол нь 13, `PER` нь 7. Мөр 1705 зөв. Энэ бол спекийн дурдсан drift.

Харьцуулах зөв жишээнүүд: `revit.ts:58-59` (`BINDS_PER_BINDING_ROW = 13`, `BINDING_ROWS_PER_STATEMENT = 7`, тайлбар нь тохирсон), `routes/qto.ts:832` («4 мөр/statement (21 bind × 4 = 84 ≤ D1-ийн 100 bind хязгаар)» — зөв).

---

## 3. ХИЙХ АЖИЛ

> Дараалал нь чухал: **§3.1 (publication safety) → §3.2 (pre-warm)**. Урвуулбал §2.3-ын уралдааныг үйлдвэрлэлд гаргана.

### 3.1 `IntentModel`-ийн ачаалалтыг publication-safe болгох — ЭХЛЭЭД

`revit-mcp/addin/IntentModel.cs`. Гурван боломжийн аль нэгийг сонгоно; **зөвлөх нь (a)** — хамгийн бага гадаргуу.

**(a) Хурдан замд ТУГ БИШ, ТАЛБАРЫГ шалгах:**

```csharp
private static volatile IntentModelData _model;     // ← volatile болов
private static bool _loadAttempted;
private static readonly object Gate = new object();

private static void EnsureLoaded()
{
    // ⚠️ ХУРДАН ЗАМД ТАЛБАРЫГ шалгана, тугийг БИШ.  Туг нь _model-ыг
    // оноохоос ӨМНӨ true болдог тул түүн дээр эрт гарвал зэрэгцээ
    // дуудагч null загвар хараад ЧИМЭЭГҮЙ fallback руу унана — тэр мөр
    // сургалтын логд «ойлгосонгүй» гэж бичигдэнэ (§2.3).
    if (_model != null) return;
    lock (Gate)
    {
        if (_loadAttempted) return;
        _loadAttempted = true;
        ...
    }
}
```

⚠️ Анхаар: загвар үнэхээр байхгүй (файл ч, embedded ч алга) үед `_model` мөнхөд null тул хурдан зам түгжээнд орох болно — гэхдээ `_loadAttempted` дотор шалгагдаж шууд буцна. Хямд.

**(b) Хувилбар:** `_loadAttempted`-ыг `volatile` болгож, `_model` оноосны **ДАРАА** тавих. Илүү нарийн ойлголт шаардана, `try/catch`-ийн бүх салаанд тавихаа мартвал мөнхийн давталт үүснэ.

**(c) Хувилбар:** `Lazy<IntentModelData>(LoadCore, LazyThreadSafetyMode.ExecutionAndPublication)`. Хамгийн цэвэр, гэхдээ `Reload()` нь `Lazy`-г солих ёстой тул `volatile Lazy<>` талбар болно.

`Reload()` (`:102-105`) нь `_model = null; _loadAttempted = false;`-ыг **түгжээн дотор** хийж байгаа тул хэвээр зөв.

### 3.2 Загварыг арын дэвсгэрт урьдчилан халаах

`revit-mcp/addin/IntentModel.cs`-д нийтийн арга нэмнэ:

```csharp
/// <summary>
/// Загварыг АРЫН thread дээр урьдчилан ачаална.  ХЭЗЭЭ Ч алдаа шидэхгүй.
///
/// ⚠️ ЯАГААД АЮУЛГҮЙ ВЭ: ачаалах зам нь File / Assembly / StreamReader /
/// JsonSerializer + статик талбар л хөнддөг — Autodesk.Revit-ийн ямар ч
/// төрөл, Document, UI-д холбогдсон төлөв ОРОХГҮЙ (§2.3).  Мөн ЯГ ИЖИЛ
/// parse нь `SaveDownloaded` дотор аль хэдийн Task.Run дээр ажилладаг.
///
/// ⚠️ ЭНЭ НЬ §3.1-ИЙН ДАРАА л нэмэгдэнэ.  Түүнээс өмнө нэмбэл `_model`
/// оноогдохоос өмнө тугийг уншсан зэрэгцээ `Predict` нь null загвар
/// хараад чимээгүй fallback руу унана.
/// </summary>
public static void PrewarmAsync()
{
    System.Threading.Tasks.Task.Run(() => { try { EnsureLoaded(); } catch { } });
}
```

Дуудах цэг — `AssistantPane.xaml.cs:276-281`-ийн `Loaded` салаанд, `SyncIntentModelSoon()`-оос **ӨМНӨ**:

```csharp
Loaded += async (s, e) =>
{
    ResizeBubbles();
    // ⚠️ ЭХЛЭЭД халаана: (1) 918 KB parse нь хэрэглэгчийн ЭХНИЙ мессежийн
    // UI thread дээр биш арын thread дээр унана; (2) `LoadedVersion` нь
    // утгатай болох тул доорх sync нь `?have=` илгээж чадна (§3.3).
    IntentModel.PrewarmAsync();
    SyncIntentModelSoon();
    await ReloadAsync(silent: true);
};
```

⚠️ **Уралдааны цонх үлдэнэ:** `PrewarmAsync` нь async тул `SyncIntentModelSoon` мөрөнд `LoadedVersion` **нь бас null байж болно**. Тиймээс §3.3 нь халаалтад найдахгүй, тусдаа засвартай.

⚠️ **Reload-ын дараа ч халаана.** `AssistantPane.xaml.cs:1737`-ын `IntentModel.Reload();`-ын **дараа** `IntentModel.PrewarmAsync();` нэмнэ — эс бөгөөс §2.3-д тайлбарласнаар шинэчлэлтийн дараах ЭХНИЙ мессеж хөлдөнө.

### 3.3 `?have=` кэшийн параметрийг үнэхээр ажиллуулах

`revit-mcp/addin/IntentModel.cs` — ачаалалтыг **хүчлэх** хувилбар нэмнэ:

```csharp
/// <summary>Ачаалагдсан загварын хувилбар, эсвэл null.  ⚠️ Ачаалахыг ХҮЧЛЭХГҮЙ.</summary>
public static string LoadedVersion => _model?.Version;

/// <summary>
/// Ачаалалтыг ХҮЧЛЭЭД хувилбарыг буцаана.
///
/// ⚠️ `LoadedVersion` нь `EnsureLoaded()` дууддаггүй.  Самбар нээгдэх үед
/// нэг ч `Predict` ажиллаагүй байдаг тул `_model` нь null, `?have=`
/// параметр ОГТ илгээгддэггүй, улмаас 918 KB жин СЕСС БҮРТ дахин
/// татагддаг байв (2026-08-27-нд батлагдсан).
/// ⚠️ ЗААВАЛ АРЫН THREAD-ЭЭС дууд — UI дээр 918 KB parse унана.
/// </summary>
public static string VersionForSync()
{
    try { EnsureLoaded(); } catch { }
    return _model?.Version;
}
```

`revit-mcp/addin/AssistantPane.xaml.cs:1723-1742` — `have`-ыг **`Task.Run` дотор** тооц:

```csharp
private void SyncIntentModelSoon()
{
    AddinSettings st = Settings;
    if (string.IsNullOrEmpty(st.Token)) return;

    _ = Task.Run(async () =>
    {
        // ⚠️ `have`-ыг ЭНД, арын thread дээр тооцно — `VersionForSync()` нь
        // ачаалалтыг хүчлэх тул UI thread дээр 918 KB parse хийхгүй.
        string have = IntentModel.VersionForSync();
        string ver = await ApiClient.SyncIntentModelAsync(st.ApiHost, st.Token, have)
                                    .ConfigureAwait(false);
        if (string.IsNullOrEmpty(ver)) return;
        await Dispatcher.InvokeAsync(() =>
        {
            IntentModel.Reload();
            IntentModel.PrewarmAsync();      // §3.2
            Say(ChatKind.System, Lang.T(...));
        });
    });
}
```

**Хуучирсан тайлбар засах:** `ApiClient.cs:136` — «~400 KB» → бодит хэмжээ **918 KB (940,283 байт)**.

### 3.4 Busy guard

`revit-mcp/addin/AssistantPane.xaml.cs:1336`, `SendBtn_Click`-ийн ЭХНИЙ мөр:

```csharp
private async void SendBtn_Click(object sender, RoutedEventArgs e)
{
    // ⚠️ ЗААВАЛ ЭНД.  Enter товч нь `InputBox_KeyDown:1332`-оос ШУУД энэ
    // handler-ыг дууддаг тул `SendBtn.IsEnabled = !busy` (SetBusy:335) нь
    // зөвхөн ХУЛГАНЫГ хаадаг.  Шалгалтгүй үед доорх `AssistantLog.Record(
    // ..., acted: true)` (1366 / 1386) нь ХИЙГДЭЭГҮЙ үйлдлийг «хийсэн» гэж
    // бичиж, сургалтын багцыг хордуулна — `RunToolAsync:1400` нь чимээгүй
    // буцдаг.  Инференс нэмэгдэхэд busy цонх миллисекундээс СЕКУНД болно.
    if (_busy)
    {
        Say(ChatKind.System, Lang.T("Өмнөх үйлдэл дуусаагүй байна — түр хүлээнэ үү.",
                                    "Still working on the previous request — one moment."));
        return;
    }

    string text = InputBox.Text?.Trim();
    ...
}
```

**Тусгаарлах зам** (`IsolateAsync`, `:1427`) — эхний мөрөнд ижил хамгаалалт:

```csharp
private async Task IsolateAsync(string raw)
{
    // ⚠️ Доорх `RevitApi.CallTool("list_sheets")` (:1437) нь busy шалгалтгүйгээр
    // Revit-ийн үндсэн thread дээр жинхэнэ ажил хийдэг, дараа нь `RunToolAsync`
    // (:1516) нь `_busy` дээр чимээгүй унадаг — үнэтэй ажил хийгээд үр дүнг хаяна.
    if (_busy) return;
    ...
}
```

**Шалгах ёстой бусад цэг:** `_busy`-тэй нь: `:356, 610, 758, 944, 1071, 1400, 1799, 1867, 2037`. **Байхгүй нь: `SendBtn_Click` (1336) ба `IsolateAsync` (1427).** Хоёуланг нь энэ релизэд нөх; өөрийг нь бүү хөнд.

### 3.5 Build identity

**(a) `revit-mcp/addin/RevitMcpAddin.csproj`** — эхний `<PropertyGroup>`-д (мөр 13-33 хооронд):

```xml
<!--
  ⚠️ РЕЛИЗИЙН ХУВИЛБАР.  Хувилбаргүй үед бүх DLL `1.0.0.0` тамгатай гардаг
  тул аль ажилтан аль build-тай явж байгааг МЭДЭХ АРГАГҮЙ (dist/ нь git-д
  ороогүй — revit-mcp/.gitignore:13).  Релиз бүрт ЭНЭ ТООГ өсгө.
  `AssemblyVersion`-ыг 1.0.0.0-д ХӨЛДӨӨНӨ: тэр нь binding identity бөгөөд
  өсгөвөл Revit-ийн assembly resolve-д нөлөөлж болзошгүй.
-->
<Version>1.1.0</Version>
<FileVersion>1.1.0.0</FileVersion>
<AssemblyVersion>1.0.0.0</AssemblyVersion>
<InformationalVersion>1.1.0</InformationalVersion>
```

(Бодит дугаарыг эзэнтэй тохирно — §9-ийн 7.)

**(b) Хувилбарыг уншиж, дамжуулах.** Шинэ жижиг файл `revit-mcp/addin/BuildInfo.cs`:

```csharp
using System.Reflection;

namespace RevitMcpAddin
{
    /// <summary>Энэ build-ийн таних тэмдэг.  Бүртгэл ба User-Agent-д ордог.</summary>
    internal static class BuildInfo
    {
        private static string _v;

        /// <summary>ж: "1.1.0".  Тодорхойлох боломжгүй бол "0".</summary>
        public static string Version
        {
            get
            {
                if (_v != null) return _v;
                try
                {
                    Assembly a = typeof(BuildInfo).Assembly;
                    string s = a.GetCustomAttribute<AssemblyInformationalVersionAttribute>()
                                ?.InformationalVersion
                               ?? a.GetName().Version?.ToString();
                    // SourceLink нь "+<sha>" залгадаг — тэрийг таслана.
                    int plus = s?.IndexOf('+') ?? -1;
                    _v = plus > 0 ? s.Substring(0, plus) : (s ?? "0");
                }
                catch { _v = "0"; }
                return _v;
            }
        }
    }
}
```

**(c) User-Agent — УГТВАРЫГ ХАДГАЛНА.** `revit-mcp/addin/ApiClient.cs:73`:

```csharp
// ⚠️ УГТВАР `MglRevitAddin/` ЗААВАЛ ХЭВЭЭР.  UA-гүй хүсэлтийг Cloudflare-ийн
// Browser Integrity Check 403 (error code 1010)-аар Worker-т ХҮРЭХЭЭС нь ӨМНӨ
// хаадаг (2026-08-25-нд хэмжиж баталсан, дээрх тайлбарыг үз).  Хувилбарыг
// ЗАЛГАЖ болно — угтварыг УСТГАЖ БОЛОХГҮЙ.
c.DefaultRequestHeaders.UserAgent.ParseAdd("MglRevitAddin/" + BuildInfo.Version);
```

**(d) Бүртгэлийн мөр бүрт хувилбар.** `revit-mcp/addin/AssistantLog.cs`:

```csharp
[JsonPropertyName("addin_version")] public string AddinVersion { get; set; }
```

`Record(...)`-д (`:173-186`): `AddinVersion = BuildInfo.Version,`

⚠️ **1B-3 нь `assistant_logs.addin_version` баганыг нэмж, `routes/revit.ts`-ийн `.map(...)` ба INSERT-д оруулсан байх ЁСТОЙ**, эс бөгөөс энэ нь `model_version`-тэй яг адил чимээгүй хаягдана (§2.15).

**(e) Савлагааны манифест.** `revit-mcp/scripts/package-addin.ps1`, `:219-223`-ын `Compress-Archive`-ийн дараа:

```powershell
$hash = (Get-FileHash -Algorithm SHA256 $zip).Hash.ToLower()
$mf = @{
    version  = $Version                      # шинэ параметр эсвэл csproj-оос уншина
    revit    = $year
    zip      = (Split-Path $zip -Leaf)
    sha256   = $hash
    bytes    = (Get-Item $zip).Length
    built_at = (Get-Date).ToUniversalTime().ToString('o')
    git_sha  = (git -C $repoRoot rev-parse HEAD)
}
$mfPath = Join-Path $distDir ("RevitMcpAddin-Revit{0}.manifest.json" -f $year)
$mf | ConvertTo-Json -Depth 4 | Out-File -FilePath $mfPath -Encoding utf8
Write-Host ("-> {0}  sha256={1}" -f $mfPath, $hash) -ForegroundColor Green
```

Манифест нь zip-ийн **хажууд** `dist/`-д (git-д ороогүй) — репод commit хийхгүй.

### 3.6 Клиент талын хэрэгслийн allowlist

`revit-mcp/addin/AgentChat.cs` — `ToolSpecs()`-ийн ойролцоо:

```csharp
/// <summary>
/// КЛИЕНТ ТАЛЫН ЗӨВШӨӨРӨГДСӨН ХЭРЭГСЭЛ — `backend/src/lib/revitAgent.ts`-ийн
/// `ALLOWED_TOOLS`-ийн ХОСЛОЛ (twin).  Гурвуулаа зэрэг өөрчлөгдөнө:
///   1. `AgentChat.ToolSpecs()`       — add-in ЗАРЛАДАГ (одоо 8)
///   2. `revitAgent.ts ALLOWED_TOOLS` — сервер ЗӨВШӨӨРДӨГ (одоо 9)
///   3. `RevitTools.Run` switch       — add-in ГҮЙЦЭТГЭДЭГ (одоо 10)
///
/// ⚠️ ЯАГААД КЛИЕНТ ТАЛД БАС ХЭРЭГТЭЙ ВЭ: сервер нь Anthropic-ийн
/// `tool_use` блокуудыг ШҮҮДЭГГҮЙ (`revitAgent.ts:317-345` — Workers AI-ийн
/// зам нь :378-д шүүдэг, Anthropic-ийнх нь ҮГҮЙ).  Тиймээс хийсвэрлэсэн
/// нэр (`change_digest`, `capture_view_image`) энэ хүртэл хүрч, `RevitTools`-
/// ийн switch түүнийг гүйцэтгэнэ.  Хоёулаа зөвхөн УНШИНА тул өнөөдөр
/// эрсдэл бага — гэхдээ хилийг ЭНД ч барина.
/// </summary>
private static readonly HashSet<string> ClientAllowedTools =
    new HashSet<string>(StringComparer.Ordinal)
    {
        "get_document_context", "list_sheets", "capture_baseline",
        "diff_since_baseline", "list_changes", "goto_element",
        "isolate_sheet_elements", "reset_isolation",
    };
```

`RunAsync`-ийн хэрэгслийн давталтад (`AgentChat.cs:367` дэх `foreach`-ийн эхэнд):

```csharp
foreach (AgentToolUse tu in res.ToolUses)
{
    if (!ClientAllowedTools.Contains(tu.Name))
    {
        // ⚠️ Тайван татгалзана — тэр нь ярианы түүхэнд `tool_result`-ээр
        // буцаж, загвар «энэ хэрэгсэл байхгүй» гэдгийг ойлгоно.  Чимээгүй
        // алгасвал `tool_use_id` хариугүй үлдэж, дараагийн хүсэлт 400 өгнө.
        ev?.OnToolDone?.Invoke(tu.Name, false);
        results.Add(new
        {
            type = "tool_result",
            tool_use_id = tu.Id,
            is_error = true,
            content = new object[] { new { type = "text",
                text = "{\"error\":\"tool_not_allowed\"}" } },
        });
        continue;
    }
    ...
}
```

⚠️ **`tool_use_id` бүрт `tool_result` ЗААВАЛ буцаана** — Anthropic-ийн Messages API нь хариугүй `tool_use`-ыг 400 өгдөг.

**Зөрүүний бүртгэл (delta) — тайлбарт бич:**

| Хэрэгсэл | `ToolSpecs` | `ALLOWED_TOOLS` | `RevitTools` switch | `ClientAllowedTools` (шинэ) |
|---|:-:|:-:|:-:|:-:|
| `get_document_context` | ✔ | ✔ | ✔ | ✔ |
| `list_sheets` | ✔ | ✔ | ✔ | ✔ |
| `capture_baseline` | ✔ | ✔ | ✔ | ✔ |
| `diff_since_baseline` | ✔ | ✔ | ✔ | ✔ |
| `list_changes` | ✔ | ✔ | ✔ | ✔ |
| `goto_element` | ✔ | ✔ | ✔ | ✔ |
| `isolate_sheet_elements` | ✔ | ✔ | ✔ | ✔ |
| `reset_isolation` | ✔ | ✔ | ✔ | ✔ |
| `capture_view_image` | ✘ | **✔** | ✔ | ✘ |
| `change_digest` | ✘ | ✘ | **✔** | ✘ |

### 3.7 Локал агентын токен уншигч (1A-5-тай ЯГ НЭГ ЦОНХОНД)

`revit-mcp/addin/AgentChat.cs`. 1A-5 нь `agent/mgl_agent.py`-д токен нэвтрэлт нэмнэ; уншигч нь **энэ релизэд** гарах ёстой, эс бөгөөс машин бүр дээр lockstep шинэчлэл болно.

```csharp
/// <summary>
/// Локал агентын session токен.  `%APPDATA%\RevitMcpAddin\agent.json`-оос
/// уншина (агент өөрөө асахдаа бичнэ — 1A-5).
///
/// ⚠️ null буцаах нь ХЭВИЙН: агент хуучин хувилбар (токенгүй) байж болно.
/// Тэр үед толгойг ОГТ НЭМЭХГҮЙ — эс бөгөөс хуучин агент 400 өгнө.
/// ⚠️ БҮХ дуудлагад (`/health` БОЛОН `/chat`) нэмнэ.
/// ⚠️ КЭШЛЭХГҮЙ — агент дахин асахад токен солигдоно.
/// </summary>
private static string LocalToken()
{
    try
    {
        string p = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
            "RevitMcpAddin", "agent.json");
        if (!File.Exists(p)) return null;
        using JsonDocument d = JsonDocument.Parse(File.ReadAllText(p, Encoding.UTF8));
        return d.RootElement.TryGetProperty("token", out JsonElement t) ? t.GetString() : null;
    }
    catch { return null; }
}

private static void AddLocalAuth(HttpRequestMessage req)
{
    string t = LocalToken();
    if (!string.IsNullOrEmpty(t))
        req.Headers.Authorization =
            new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", t);
}
```

- `IsLocalAvailableAsync` (`:196-197`) нь `GetAsync`-ыг ашигладаг тул `HttpRequestMessage`-тай хувилбар руу солино, дараа нь `AddLocalAuth(req)`.
- `RunLocalAsync` (`:220-223`) — `req` үүсгэсний дараа `AddLocalAuth(req)`.

⚠️ Файлын нэр (`agent.json`) ба талбарын нэр (`token`) нь **1A-5-тай яг таарах ёстой** — §9-ийн 5.

### 3.8 Batch queue nonce — ТЭВЧИНЭ, ШААРДАХГҮЙ

`revit-mcp/addin/BatchQto.cs:201-208`:

```csharp
public class BatchQueue
{
    [JsonPropertyName("exit")]
    public bool Exit { get; set; } = true;

    [JsonPropertyName("files")]
    public List<BatchFile> Files { get; set; } = new List<BatchFile>();

    /// <summary>
    /// 1A-6-ын nonce.  ⚠️ ЭНЭ РЕЛИЗ ҮҮНИЙГ ЗӨВХӨН УНШИНА, ШААРДАХГҮЙ.
    ///
    /// Урвуулбал (эхлээд шаардвал) шөнийн QTO батч нь nonce бичдэг болоогүй
    /// scheduler-тай тааралдаж ЧИМЭЭГҮЙ ЗОГСОНО — хэн ч өглөө хүртэл
    /// мэдэхгүй.  Шаардлагыг ЗӨВХӨН ДАРААГИЙН релизэд нэмнэ, түүнээс өмнө
    /// scheduler-ийн бүх машин nonce бичдэг болсныг батал.
    /// </summary>
    [JsonPropertyName("nonce")]
    public string Nonce { get; set; }
}
```

`BatchFileResult`-д `[JsonPropertyName("nonce")] public string Nonce { get; set; }` нэмж, `batch-result.json`-д цуурайтуулна — тэгснээр scheduler нь өөрийн бичсэн queue-ийн үр дүнг таньж чадна.

⚠️ **Одоо ч тэвчээр бий:** `BatchQto.cs:66`-ын `JsonSerializer.Deserialize<BatchQueue>` нь анхдагч тохиргоотой тул танихгүй `nonce` талбарыг **аль хэдийн чимээгүй алгасдаг**. DTO-д нэмэх нь тэр зан төлөвийг **ил тод, зориудын** болгож, дараагийн релизэд шаардлага нэмэх суурийг тавьж байгаа хэрэг.

### 3.9 Хоёр хямд зөв байдлын засвар

**(a) Тохиргоог кэшлэх** — `revit-mcp/addin/SettingsStore.cs`:

```csharp
private static AddinSettings _cache;
private static readonly object CacheGate = new object();

/// <summary>
/// Тохиргоог кэшээс уншина.
///
/// ⚠️ ЯАГААД: `Load()` нь дуудлага БҮРТ файл уншиж, DPAPI `Unprotect`
/// хийдэг (:32, :44).  `AssistantPane.Settings` (:284) нь PROPERTY тул
/// нэг мессежид ДОР ХАЯЖ ХОЁР удаа ажилладаг (:1012/:563 ба :1747).
/// Локал SSD дээр хор хоргүй; ROAMING PROFILE (сүлжээний %APPDATA%) дээр
/// энэ нь ХЯЗГААРГҮЙ сааталт — мессеж бүр сүлжээ хүлээнэ.
///
/// ⚠️ `Save()` нь кэшийг ЗААВАЛ хүчингүй болгоно, эс бөгөөс Тохиргоо
/// цонхноос шинэ токен бичсний дараа самбар ХУУЧИН токеноор явна.
/// </summary>
public static AddinSettings Load()
{
    lock (CacheGate)
    {
        if (_cache != null) return _cache;
        _cache = LoadFromDisk();
        return _cache;
    }
}

/// <summary>Кэшийг хаяна — дараагийн `Load()` дискнээс уншина.</summary>
public static void Invalidate()
{
    lock (CacheGate) { _cache = null; }
}
```

- Одоогийн `Load()`-ийн бие (`:27-54`) нь `private static AddinSettings LoadFromDisk()` болно.
- `Save(...)` (`:70-91`)-ийн `finally` блокийн дараа `Invalidate();` дуудна.
- ⚠️ Буцаж ирсэн объектыг дуудагчид **өөрчилдөг** эсэхийг шалга (`grep -n "settings\.\w* =" revit-mcp/addin/*.cs`). Олдвол `Load()`-ыг **хуулбар** буцаадаг болго (`AddinSettings`-ийн `MemberwiseClone`), эс бөгөөс нэг дуудагчийн өөрчлөлт бүх дуудагчид тархана.

**(b) Унтраалтын цэвэрлэгээ** — `revit-mcp/addin/ChangeTracker.cs`-д нийтийн арга нэмнэ:

```csharp
/// <summary>
/// Захиалгуудыг салгаж, таймерыг сулласнаар алдагдлыг зогсооно.
/// ⚠️ Салгахаас ӨМНӨ сүүлийн удаа бичнэ — эс бөгөөс сүүлийн 3 секундын
/// өөрчлөлт диск хүрэхгүй.  ХЭЗЭЭ Ч алдаа шидэхгүй.
/// </summary>
public static void Shutdown(ControlledApplication app)
{
    if (!_started) return;
    _started = false;
    try { FlushDirty(); } catch { }
    try { _flushTimer?.Dispose(); } catch { }
    _flushTimer = null;
    if (app == null) return;
    try { app.DocumentChanged -= OnDocumentChanged; } catch { }
    try { app.DocumentClosing -= OnDocumentClosing; } catch { }
    try { app.DocumentOpened  -= OnDocumentOpened;  } catch { }
    try { app.DocumentCreated -= OnDocumentCreated; } catch { }
    try { app.DocumentSynchronizingWithCentral -= OnSuppressStart; } catch { }
    try { app.DocumentSynchronizedWithCentral  -= OnSuppressEnd;   } catch { }
    try { app.DocumentReloadingLatest -= OnSuppressStart; } catch { }
    try { app.DocumentReloadedLatest  -= OnSuppressEnd;   } catch { }
}
```

`revit-mcp/addin/App.cs:141-150`:

```csharp
public Result OnShutdown(UIControlledApplication application)
{
    // ⚠️ ЭНЭ БЛОК `#if MCP_EXECUTOR`-ЫН ГАДНА байх ЁСТОЙ.  Урьд нь бүх бие
    // нь тэр дотор байсан тул net48 (Revit 2024) build дээр `OnShutdown` нь
    // БҮРЭН ХООСОН байв — `DocumentChanged`-ийн 8 захиалга ба flush таймер
    // БОЛЗОЛГҮЙ алдагддаг байсан.
    try { ChangeTracker.Shutdown(application?.ControlledApplication); }
    catch { /* унтраалт дээр чимээгүй */ }

#if MCP_EXECUTOR
    try { _server?.Stop(); } catch { }
    try { BridgeAuth.Revoke(); } catch { }
#endif
    return Result.Succeeded;
}
```

⚠️ **`UIControlledApplication.ControlledApplication` нь `OnShutdown`-д хүчинтэй эсэхийг шалга** — Revit-ийн бүх target дээр батал (§9-ийн 4). null ирвэл дээрх код `if (app == null) return;`-ээр аюулгүй зогсох ба таймер нь ямар ч тохиолдолд Dispose хийгдэнэ.

### 3.10 Инференсийн байрлалын дүрэм — ЗӨВХӨН ТАЙЛБАР

**Код бичихгүй. Инференс нэмэхгүй.** Дараах гурван газарт **тайлбар** тавина:

**(a) `revit-mcp/addin/RevitToolBus.cs`, `RevitToolEventHandler.Execute`-ийн (`:182`) дээр:**

```csharp
/// ⛔ ИНФЕРЕНС ЭНД ХЭЗЭЭ Ч БАЙХГҮЙ.
/// Энэ арга нь Revit-ийн ҮНДСЭН thread дээр, `ExternalEvent`-ийн зүсэлт
/// дотор ажиллана.  Сүлжээний дуудлага (LLM) нь Revit-ийн мессежийн
/// давталтыг бүхэлд нь барих тул програм ХӨЛДӨНӨ — `MaxPerSlice` хязгаар
/// нь яг тэр шалтгаанаар оршдог.  Хэрэгслийн үр дүнг ЭНДЭЭС гаргаж, LLM-
/// ийн дуудлагыг `AgentChat.RunAsync`-ийн давталт дотор (арын thread) хий.
```

**(b) `revit-mcp/addin/ChangeTracker.cs`, `OnDocumentChanged`-ийн (`:701`) толгойн тайлбарт залгана:**

```csharp
/// ⛔ ИНФЕРЕНС ЭНД ХЭЗЭЭ Ч БАЙХГҮЙ.  Энэ handler нь ГҮЙЛГЭЭ БҮРИЙН дараа
/// дуудагдана — хэрэглэгч хана зурах бүрт.  Одоо энд диск ч хөндөхгүй
/// (:44-50); сүлжээ хөндөх нь тэрнээс хэдэн зуу дахин дор.
```

**(c) `revit-mcp/addin/AssistantPane.xaml.cs`, fallback салааны (`:1375`) дээр — ЦОРЫН ГАНЦ ЗӨВШӨӨРӨГДСӨН СУУЛГАЦ:**

```csharp
// ✅ ИНФЕРЕНСИЙН ЦОРЫН ГАНЦ ЗӨВШӨӨРӨГДСӨН СУУЛГАЦ (seam).
//
// Хоёр детерминистик давхарга (түлхүүр үг → сургасан ангилагч,
// `IntentRouter.Route:154-189`) АЛЬ АЛЬ НЬ ТАТГАЛЗСАН цэг.  Зөвхөн энд:
//   • итгэлтэй зам (Keyword / Model) руу ХЭЗЭЭ Ч LLM оруулахгүй — тэр нь
//     0-1 мс, офлайн, суудал тутмын өртөг ТЭГ; LLM түүнийг зөвхөн
//     удаашруулж, үнэ нэмж, найдваргүй болгоно
//   • tool-bus-ийн handler ба `DocumentChanged` дотор ХЭЗЭЭ Ч биш
//
// Хэрэгжүүлэхдээ ЗААВАЛ: тусдаа `HttpClient` (`ApiClient.Http` нь 180 сек
// хугацаатай — тэр нь 20k мөрийн QTO ба MB-ийн PDF-д зориулагдсан,
// чатад тэвчихгүй), богино хугацаа, `CancellationToken`, ба хэрэглэгчид
// ХАРАГДАХ цуцлах товч (одоо самбарт цуцлах товч БАЙХГҮЙ).
if (route.By == DecidedBy.Fallback)
{
    ...
}
```

**HTTP-ийн бодит байдал (тайлбарт тэмдэглэ):** репо даяар `new HttpClient` нь **ганц** — `ApiClient.cs:52,56`, `Timeout = 180 сек`. `CancellationToken` нь **ганц** газар — `AgentChat.cs:195` (`/health` probe 5 сек). `PostTurnAsync` (`AgentChat.cs:442`), `RunLocalAsync` (`:225`), `AssistantLog.FlushAsync` (`AssistantLog.cs:298`) — токенгүй.

### 3.11 Backend-ийн хуучирсан тайлбар (зөвхөн 1B-3 засаагүй бол)

`backend/src/routes/revit.ts:1703`:

```diff
-  // 12 bind/мөр → floor(100/12) = 8 мөр/statement (D1-ийн 100 bind хязгаар).
+  // 13 bind/мөр → floor(100/13) = 7 мөр/statement (D1-ийн 100 bind хязгаар).
```

Код өөрчлөхгүй; deploy шаардахгүй. **1B-3 сесс аль хэдийн засчихсан бол огт бүү хүр.**

### 3.12 ЗУРГААН ХЭМЖИЛТИЙН ЦЭГ (Track 1C)

> ⚠️ **1B-3-ЫН ХАМААРАЛ ХАТУУ.** Доорх бүх талбар `AssistantLogEntry`-д **nullable тоо** болж ордог. `assistant_logs`-д тохирох багана БАЙХГҮЙ бол сервер тэднийг `model_version`-тэй **ЯГ АДИЛ** чимээгүй хаяна (§2.15). 1B-3 deploy хийгдсэнийг **баталсны дараа** л энэ хэсгийг бич.

**Нийтлэг дэд бүтэц.** Шинэ файл `revit-mcp/addin/Timing.cs`:

```csharp
using System;
using System.Collections.Generic;
using System.Diagnostics;

namespace RevitMcpAddin
{
    /// <summary>
    /// ЛАТЕНТЫН ХЭМЖИЛТ.
    ///
    /// ⚠️ ЯАГААД p95 ГАНЦААРАА ХАНГАЛТГҮЙ ВЭ: p95 нь «20 удаагийн 1-д ямар
    /// байсан» гэдгийг л хэлнэ.  p50 нь ердийн туршлага, p99 ба max нь
    /// хэрэглэгч «хөлдлөө» гэж гомдох мөч, алдааны хувь нь «хэмжилт огт
    /// дуусаагүй» тохиолдол.  Тавуулаа хэрэггүй бол дүгнэлт худал гарна.
    ///
    /// ⚠️ ЭНЭ НЬ ХЭМЖИНЭ, ХЯЗГААРЛАХГҮЙ.  `ChangeReport.cs`-ийн Stopwatch-
    /// ууд нь төсвийн ХЯЗГААРЛАГЧ — тэдний утга хаягддаг.  Энд эсрэгээрээ:
    /// утга нь ЦОРЫН ГАНЦ бүтээгдэхүүн.
    ///
    /// ⚠️ Загварын геометр, элементийн нэр, файлын агуулга ОРОХГҮЙ —
    /// `AssistantLog`-ийн нууцлалын хилтэй ижил.
    /// ⚠️ Autodesk.Revit-ийн ямар ч төрөл ХЭРЭГЛЭХГҮЙ — net48 (R24) build
    /// дээр ч эмхэтгэгдэх ёстой.
    /// </summary>
    internal sealed class Timing
    {
        private readonly Stopwatch _sw = Stopwatch.StartNew();
        private long _last;
        private readonly Dictionary<string, double> _marks =
            new Dictionary<string, double>(StringComparer.Ordinal);

        /// <summary>Эхнээс өнөөг хүртэлх мс.</summary>
        public double TotalMs => _sw.Elapsed.TotalMilliseconds;

        /// <summary>Өмнөх тэмдгээс хойшхи мс-ийг нэрлэж бичнэ (сегмент).</summary>
        public void Mark(string name)
        {
            long now = _sw.ElapsedTicks;
            _marks[name] = (now - _last) * 1000.0 / Stopwatch.Frequency;
            _last = now;
        }

        /// <summary>Үнэмлэхүй утга шууд бичнэ.</summary>
        public void Set(string name, double ms) => _marks[name] = ms;

        public double? Get(string name) =>
            _marks.TryGetValue(name, out double v) ? (double?)v : null;
    }
}
```

Тоонуудыг **бүхэл мс** болгож дугуйлж бичнэ (JSON жижиг байх, нарийвчлал хангалттай).

**Зургаан цэг:**

| # | Хаана | Юу хэмжинэ | Талбар |
|---|---|---|---|
| **a** | `AssistantPane.xaml.cs:1336` `SendBtn_Click` — ЭХНИЙ мөрөнд `var T = new Timing();`, **гарц БҮРД** бичнэ (`:1339` эрт гарц, `:1369`, `:1383`, `:1396`-ийн төгсгөл) | end-to-end | `t_total_ms`, `exit_path` (`empty`/`pending`/`fallback`/`acted`) |
| **b** | `AssistantPane.xaml.cs:1351`-ийн `IntentRouter.Route(text)`-ыг тойруулж | АЛЬ давхарга шийдсэн + чиглүүлэлтийн үнэ | `t_route_ms`, `route_layer` (`keyword`/`model`/`fallback`) |
| **c** | `IntentModel.cs:107` `EnsureLoaded()`-ийн `lock` дотор | загварын ХҮЙТЭН ачаалалт | `t_model_load_ms`, `model_load_source` (`local`/`embedded`/`none`) |
| **d** | `RevitToolBus.cs:89` `Call` + `:182` `Execute` — **зургаан сегмент** | хэрэгслийн шат | доорх |
| **e** | `ChangeTracker.cs:701` `OnDocumentChanged` (**түүвэрлэсэн**) + `:473` `FlushDirty`-ийн **түгжээ барих хэсэг** | зурах явцын саад | `t_docchanged_p95_ms`, `t_flush_lock_ms` |
| **f** | `AgentChat.cs:419` `PostTurnAsync` ба `:217` `RunLocalAsync` | AI тээвэр | `t_agent_ttft_ms`, `t_agent_total_ms` |

**(d) — Tool bus задаргаа. Энэ бол хамгийн чухал хэсэг.** Ганц тоо нь **буруу зүйл оптимизац хийлгэнэ**: 8 секундын дуудлага нь «Revit удаан» гэсэн үг байж болно, эсвэл «өмнөх дуудлага `Gate`-ыг барьсан» байж болно — хоёрын шийдэл нь тэс өөр.

`ToolCall` (`RevitToolBus.cs:9-33`)-д нэмнэ:

```csharp
/// <summary>Хэмжилтийн тэмдэг (мс).  ⚠️ Зөвхөн ХЭМЖИНЭ — зан төлөв өөрчлөхгүй.</summary>
public double MsQueueWait;   // Gate.Wait (:110) — өмнөх дуудлага дуусахыг хүлээсэн
public double MsEnqueue;     // Gate-ээс Queue.Enqueue + Raise хүртэл (:120-122)
public double MsEventWait;   // Raise-ээс Execute нь энэ дуудлагыг dequeue хүртэл (:122 → :185)
public double MsRevitExec;   // RevitTools.Run (:199) — Revit-ийн ажил + сериалчлал
public double MsResponse;    // Done.Set (:210)-ээс Call буцах хүртэл (:151)
public double MsTotal;       // Call-ийн эхнээс төгсгөл хүртэл
public bool   TimedOut;      // :143-ын Abandoned зам
```

- `MsQueueWait` — `Call`-ийн эхэнд Stopwatch эхлүүлж, `:110`-ын `Gate.Wait` буцахад `Mark`.
- `MsEnqueue` — `:120` `Queue.Enqueue` ба `:122` `_event.Raise()` хоёрын хооронд.
- `MsEventWait` — `ToolCall`-д `long EnqueuedTicks` бичиж, `Execute`-ийн `:185` `TryDequeue`-ийн дараа handler нь ялгаврыг бичнэ. ⚠️ `:190`-ын `Abandoned` салаанд ч бич — «хаягдсан дуудлага хэдэн секунд дараалалд байсан» нь өөрөө оношилгоо.
- `MsRevitExec` — `:199`-ийн `RevitTools.Run`-ыг тойруулж. ⚠️ **Сериалчлал үүн дотор** байна (`RevitTools.Run` нь JSON мөр буцаадаг). Тусад нь ялгах бол `RevitTools.cs`-ийн 10 функцийг бүгдийг нь хөндөнө — **эхний релизэд нэгтгэсэн байг**, тайлбарт «сериалчлал үүн дотор» гэж бич.
- `MsResponse` — `:132-149`-ийн `while` давталтаас гарсны дараа `:151`-ийн `return call;`-аас өмнө.
- `MsTotal` — `Call`-ийн бүх гарцад (`:97`, `:115`, `:129`, `:147`, `:151`).

`RevitApi.CallTool` (`:516-526`) ба `AgentChat.cs:380-381` нь `ToolCall`-ыг аль хэдийн барьдаг тул тэднээс `Timing`-д шилжүүлнэ.

**(e) — Түүвэрлэлт ЗААВАЛ.** `OnDocumentChanged` нь гүйлгээ бүрт ажиллана; тэнд `Stopwatch.StartNew()` хийх нь өөрөө нэмэлт ачаа:

```csharp
private static int _dcCounter;
private const int DcSampleEvery = 64;   // 64 гүйлгээ тутамд НЭГ удаа хэмжинэ
```

`FlushDirty`-ийн түгжээ барих хэсэг нь 3 секунд тутамд л ажилладаг тул **түүвэрлэхгүй, бүгдийг хэмжинэ**.

**(f) — TTFT.** `RunLocalAsync` (`:240`)-ийн `while ((line = await reader.ReadLineAsync()...)` давталтын **ЭХНИЙ** мөр ирэх хүртэлх хугацаа = TTFT. `PostTurnAsync` (`:442`) нь streaming БИШ тул TTFT ≡ total; тэр тохиолдолд `t_agent_ttft_ms` нь null үлдэнэ. **Тайлбарт бич**, эс бөгөөс хожим «TTFT яагаад хоосон вэ» гэсэн асуулт төрнө.

**Хуримтлуулагч.** Шинэ статик `revit-mcp/addin/Percentiles.cs` — тогтмол хэмжээтэй тойрог буфер (ж: 512 утга) дээр p50/p95/p99/max ба алдааны хувь. Add-in нь өдөрт хэдэн зуун дуудлага л хийдэг тул **эрэмбэлээд индекс авах нь хангалттай**.

**Хаана бичигдэх вэ.** `AssistantLogEntry`-д (`AssistantLog.cs:15-44`) **nullable** талбарууд:

```csharp
[JsonPropertyName("t_total_ms")]        public double? TotalMs { get; set; }
[JsonPropertyName("t_route_ms")]        public double? RouteMs { get; set; }
[JsonPropertyName("route_layer")]       public string  RouteLayer { get; set; }
[JsonPropertyName("t_model_load_ms")]   public double? ModelLoadMs { get; set; }
[JsonPropertyName("t_tool_total_ms")]   public double? ToolTotalMs { get; set; }
[JsonPropertyName("t_tool_queue_ms")]   public double? ToolQueueMs { get; set; }
[JsonPropertyName("t_tool_event_ms")]   public double? ToolEventMs { get; set; }
[JsonPropertyName("t_tool_exec_ms")]    public double? ToolExecMs { get; set; }
[JsonPropertyName("t_agent_ttft_ms")]   public double? AgentTtftMs { get; set; }
[JsonPropertyName("t_agent_total_ms")]  public double? AgentTotalMs { get; set; }
[JsonPropertyName("addin_version")]     public string  AddinVersion { get; set; }
```

⚠️ `AssistantLog.Record(...)` нь одоо `(RouteResult, string, bool)` гарын үсэгтэй (`:166`). **Хуучин гарын үсгийг хэвээр үлдээж**, `Timing`-тэй хэт ачаалал (overload) нэмнэ.

⚠️ **Сервер тал (1B-3-ын хариуцлага):** `routes/revit.ts:1706`-ын `const BINDS = 13` ба `PER = 7` нь **шинэ баганын тоогоор дахин тооцогдох ЁСТОЙ** (D1 = statement тутам 100 bind). Ж: 13 + 11 = 24 bind/мөр → `floor(100/24) = 4` мөр/statement. Хэрэв 1B-3 үүнийг хийгээгүй бол **энэ релизийн хэмжилтийн хэсгийг бүхэлд нь хойшлуул**.

---

## 4. ХӨНДӨЖ БОЛОХГҮЙ (load-bearing)

| Юу | Хаана | Яагаад |
|---|---|---|
| `UserAgent` угтвар `MglRevitAddin/` | `ApiClient.cs:73` | Cloudflare Browser Integrity Check нь UA-гүй хүсэлтийг **403 error 1010**-аар Worker-т хүрэхээс нь өмнө хаадаг (2026-08-25 хэмжсэн). Хувилбар **залгана**, угтварыг устгахгүй |
| `HttpClient.Timeout = 180` | `ApiClient.cs:56` | 20k мөрийн QTO payload + MB-ийн PDF байршуулалтад зориулагдсан. Богиносговол PDF алдагдана. **Инференсэд тусдаа клиент** ав |
| `IntentModel.PreprocessContract = "fold-v1"` ба `Preprocess()` | `IntentModel.cs:79, 208` | `training/train_intent.py`-ийн `preprocess()`-тэй хосолсон; `training/check_parity.py` барьдаг. Аль нэгийг өөрчилвөл бүх таамаглал `unknown` руу унана |
| `RevitToolBus.MaxPerSlice = 4` | `RevitToolBus.cs:180` | Хязгааргүй `while` нь Revit-ийн мессежийн давталтыг барьж програмыг хөлдөөдөг байсан |
| `ToolCall.Abandoned` | `RevitToolBus.cs:32, 143, 190` | «Сүнс» ажил дараагийн дуудлагыг **баталгаатай** унагадаг байсан («дахин дахин 120 секунд» гомдол). Хэмжилт нэмэхдээ энэ логикийг **хөндөхгүй** |
| Хугацааг `Gate`-ЭЭС ӨМНӨ эхлүүлэх | `RevitToolBus.cs:100-108` | `Gate`-ийн дараа эхлүүлбэл бодит хүлээлт 240 сек болж, алдааны мессеж «120s» гэж **худал** хэлдэг байв |
| `OnDocumentChanged` дотор **диск хөндөхгүй** | `ChangeTracker.cs:44-50, 701-715` | Revit нь тэр үед баримтыг унших горимд барина; гүйлгээ, `Regenerate()`, файл бичилт — бүгд хориотой. Хэмжилт нь зөвхөн `Stopwatch` (түүвэрлэсэн) |
| `FlushDirty`-ийн диск бичилт **түгжээнээс гадна** | `ChangeTracker.cs:501-511` | Дотогш оруулбал `OnDocumentChanged` нь Revit-ийн үндсэн thread дээр дискний I/O хүлээнэ |
| Түр файлаар солих (`.tmp` → `Move`) | `ChangeTracker.cs:507-511` | Revit унавал хагас бичигдсэн JSON өдрийн бүх ажлыг уншигдахгүй болгоно |
| `assistantContent`-ыг **ЯГ ХЭВЭЭР** буцаах | `AgentChat.cs:357-364`, `revitAgent.ts:343` | `text` + `toolUses`-аас дахин бүтээвэл `tool_use.id` алдагдаж дараагийн хүсэлт 400 өгнө. §3.6-ын татгалзал нь **`tool_result` буцаана**, блокыг устгахгүй |
| `BridgeAuth.Revoke()` унтраалтад | `App.cs:147` | Revit хаагдсаны дараа локал bridge токен диск дээр үлдэх ёсгүй |
| `SatelliteResourceLanguages=en`, `#if MCP_EXECUTOR`-ийн файл хасалт | `RevitMcpAddin.csproj:29, 130-135` | net48 (Revit 2024) build нь `HttpServer.cs` / `CodeExecutorEventHandler.cs` / `ScriptGlobals.cs` / `ExecuteRequest.cs`-гүйгээр эмхэтгэгдэнэ. **`Timing.cs` / `BuildInfo.cs` / `Percentiles.cs` нь бүх target дээр эмхэтгэгдэх ёстой** — Revit-ийн ямар ч төрөл бүү хэрэглэ |
| Batch queue nonce-ыг **ШААРДАХГҮЙ** | `BatchQto.cs:201` | Урвуулбал шөнийн QTO батч чимээгүй зогсоно |
| `users` / `projects` табыг `migrations apply`-аар дахин барихгүй | — | 27 ба 38 каскад хүүхэд. Энэ сесс миграц огт үүсгэхгүй |

---

## 5. ДАРААЛАЛ БА ХАМААРАЛ

### Урьдчилсан нөхцөл (ЗААВАЛ БИЕЛСЭН БАЙХ)

| # | Нөхцөл | Хэрхэн батлах |
|---|---|---|
| 1 | **1B-3 deploy хийгдсэн** — `assistant_logs`-д `model_version`, `addin_version` ба §3.12-ын цагийн баганууд бий, `routes/revit.ts`-ийн `.map()` + INSERT тэднийг **уншдаг**, `BINDS` дахин тооцогдсон | `PRAGMA table_info(assistant_logs)` + `grep -n "model_version\|addin_version\|t_total_ms" backend/src/routes/revit.ts` |
| 2 | **1A-5 (Python) энэ цонхонд** — агентын токены **файлын нэр ба талбарын нэр** тохирсон | §9-ийн 5 |
| 3 | **1A-6-ын nonce** — scheduler талын форматыг мэдсэн (add-in зөвхөн тэвчинэ) | §9-ийн 6 |
| 4 | **1A бүхэлдээ дууссан** — аюулгүй байдлын нүх нь AI-ийн замын зураг биш, продакшны асуудал | `docs/bim-ai/README.md`-ийн дараалал |

### Энэ релизийн доторх дараалал

```
§3.1  publication safety        ← ЗААВАЛ ЭХЛЭЭД
   ↓
§3.2  pre-warm                  ← §3.1-гүйгээр уралдаан СЭРНЭ
   ↓
§3.3  ?have= (VersionForSync)   ← §3.2-той хамт нэг асуудлыг хоёр талаас хаана
§3.4  busy guard                ← бие даасан
§3.5  build identity            ← §3.12-ын `addin_version` үүнээс хамаарна
§3.6  client allowlist          ← бие даасан
§3.7  local agent token         ← 1A-5-тай синхрон
§3.8  batch nonce (тэвчинэ)     ← бие даасан
§3.9  settings cache + teardown ← бие даасан
§3.10 инференсийн тайлбар       ← бие даасан
§3.11 backend тайлбар           ← 1B-3 хийгээгүй бол
   ↓
§3.12 ЗУРГААН ХЭМЖИЛТ           ← 1B-3 БАТЛАГДСАНЫ ДАРАА
   ↓
BUILD × 4 (R24/R25/R26/R27) → dist/ zip + manifest → эзэнд өгнө
```

### Энэ релизийн ДАРАА

- Талбараас 1-2 долоо хоногийн хэмжилт цуглана → **тэр үед л** «250 мс» гэдгийг үнэлж болно.
- Зөвхөн **дараагийн** релиз batch nonce-ыг **ШААРДАЖ** эхэлнэ.
- Track C (typed BIM intent, дүрмийн хөдөлгүүр, инференс) нь §3.10-д тэмдэглэсэн fallback суулгац дээр л барина.

### Deploy-ийн дараалал (лавлагаа — энэ сесс ГҮЙЦЭТГЭХГҮЙ)

```bash
# 1) МИГРАЦ ЭХЛЭЭД
cd backend && npx wrangler d1 migrations apply mgl-progress-db-v3 --remote --config wrangler.toml
# 2) typecheck — `wrangler deploy` ҮҮНИЙГ ХИЙХГҮЙ
npx tsc --noEmit
# 3) Worker
npx wrangler deploy --config wrangler.toml      # --config ЗААВАЛ: root-д wrangler.jsonc өөр worker зарладаг
```

Frontend (энэ сессэд хамаарахгүй): `npx -y wrangler@latest pages deploy dist --project-name mgl-design-system --branch main`.

**Шинэ багана нь түүнийг уншдаг кодоос ХАТУУ ӨМНӨХ deploy-д гарна.** Тиймээс 1B-3 → (нэг deploy) → энэ add-in релиз.

---

## 6. ХҮЛЭЭН АВАХ ШАЛГУУР

### Publication safety ба урьдчилан халаалт
- [ ] `IntentModel.EnsureLoaded`-ийн хурдан зам нь `_loadAttempted`-ыг БИШ, `_model`-ыг шалгадаг (эсвэл `Lazy<ExecutionAndPublication>`).
- [ ] `IntentModel.PrewarmAsync()` байгаа, `AssistantPane`-ийн `Loaded`-оос `SyncIntentModelSoon()`-ЫН ӨМНӨ дуудагдана.
- [ ] `IntentModel.Reload()`-ийн дараа (`AssistantPane.xaml.cs:1737`) `PrewarmAsync()` дуудагдана.
- [ ] Revit нээгээд самбарыг нээж, **юу ч бичихгүйгээр 5 секунд хүлээгээд** эхний мессежээ бичихэд мэдэгдэхүйц саатал БАЙХГҮЙ.

### Кэшийн параметр
- [ ] `IntentModel.VersionForSync()` байгаа ба `EnsureLoaded()` дууддаг.
- [ ] `SyncIntentModelSoon` дотор `have` нь **`Task.Run` доторх** мөрөнд тооцогдоно.
- [ ] Сүлжээний хяналт / серверийн лог дээр **хоёр дахь** сесс нь `GET /api/revit/assistant/model?have=<version>` илгээж, `{"unchanged":true}` авдаг.
- [ ] `ApiClient.cs:136`-ын «~400 KB» → бодит хэмжээгээр засагдсан.

### Busy guard
- [ ] `SendBtn_Click`-ийн эхэнд `if (_busy) { ...; return; }` бий.
- [ ] `IsolateAsync`-ийн эхэнд `if (_busy) return;` бий.
- [ ] **Гар туршилт:** удаан хэрэгсэл ажиллаж байх зуур (ж. том загвар дээр «хуудсуудаа харуул») Enter-ийг 5 удаа дар → `%APPDATA%\RevitMcpAddin\assistant-log.jsonl`-д **нэмэлт `"acted":true` мөр НЭГ Ч БИШ**.

### Build identity
- [ ] `RevitMcpAddin.csproj`-д `<Version>` ба `<InformationalVersion>` бий; `AssemblyVersion` нь `1.0.0.0` хэвээр.
- [ ] Барьсан DLL дээр `FileVersion` нь `1.0.0.0` **БИШ**.
- [ ] `BuildInfo.Version` нь бүртгэлийн мөрөнд `addin_version` болж ирнэ (`assistant-log.jsonl`-ээс хар).
- [ ] User-Agent нь `MglRevitAddin/<version>` — **угтвар хэвээр**. Хүсэлт 403/1010 авахгүй.
- [ ] `package-addin.ps1` нь zip тутамд `*.manifest.json` (version + sha256 + git_sha) гаргана; `dist/` git-д ороогүй хэвээр.

### Клиент allowlist
- [ ] `AgentChat.ClientAllowedTools` байгаа, 8 нэртэй, `ToolSpecs()`-тэй **яг таарна**.
- [ ] Зөвшөөрөгдөөгүй нэр ирвэл `is_error: true` **`tool_result` буцаагдана** (алгасагдахгүй).
- [ ] Зөрүүний хүснэгт (§3.6) тайлбар болж кодод байна.

### Локал агент
- [ ] `AgentChat.LocalToken()` байгаа; `/health` ба `/chat` хоёулаа `AddLocalAuth`-ыг дууддаг.
- [ ] Токен файл байхгүй үед `Authorization` толгой **ОГТ нэмэгддэггүй** (хуучин агенттай нийцнэ).
- [ ] 1A-5-ын Python талтай **гар туршилт** амжилттай.

### Batch queue
- [ ] `BatchQueue.Nonce` талбар бий; nonce-той `batch-queue.json` **амжилттай боловсрогддог**.
- [ ] nonce-ГҮЙ `batch-queue.json` мөн **амжилттай боловсрогддог** (шаардлага нэмэгдээгүй).

### Хямд засварууд
- [ ] `SettingsStore.Load()` нь кэшлэгддэг; `Save()` нь `Invalidate()` дууддаг.
- [ ] Тохиргоо цонхноос токен солиход самбар **шинэ токеныг шууд** ашиглана (гар туршилт).
- [ ] `ChangeTracker.Shutdown()` байгаа, 8 захиалгыг салгаж, таймерыг Dispose хийнэ.
- [ ] `App.OnShutdown`-д `ChangeTracker.Shutdown(...)` нь **`#if MCP_EXECUTOR`-ЫН ГАДНА**.
- [ ] R24 (net48) build амжилттай эмхэтгэгдэнэ.

### Инференсийн дүрэм
- [ ] Гурван тайлбар байрандаа: `RevitToolBus.Execute`, `ChangeTracker.OnDocumentChanged`, `AssistantPane` fallback салаа.
- [ ] Энэ релизэд **инференсийн код НЭМЭГДЭЭГҮЙ** (`grep -n "anthropic\|ANTHROPIC\|/messages" revit-mcp/addin/*.cs` → шинэ таарц алга).

### Хэмжилт (1B-3 батлагдсан ҮЕД)
- [ ] `Timing.cs`, `Percentiles.cs` байгаа; Revit-ийн ямар ч төрөл ашиглаагүй.
- [ ] Зургаан цэг бүгд бий; tool bus нь **зургаан сегментэд задарсан**.
- [ ] `OnDocumentChanged` нь **түүвэрлэсэн** (тогтмол харагдана).
- [ ] Бүх цагийн талбар `AssistantLogEntry`-д **nullable**.
- [ ] p50 / p95 / p99 / max / алдааны хувь **тавуулаа** гарна — p95 дангаараа биш.
- [ ] Нэг мессеж илгээгээд D1-д цагийн утга **бодитоор хадгалагдсан** (`SELECT t_total_ms, route_layer FROM assistant_logs ORDER BY id DESC LIMIT 5`).
- [ ] `routes/revit.ts`-ийн `BINDS` нь шинэ баганын тоотой тохирсон (`BINDS × PER ≤ 100`).

---

## 7. ШАЛГАХ КОМАНД

```bash
# --- 0. ХАМРАХ ХҮРЭЭ: зөвхөн өөрийн файл өөрчлөгдсөн эсэх ---
git status --short
git diff --stat
# Гарц нь ЗӨВХӨН revit-mcp/addin/*, revit-mcp/scripts/package-addin.ps1,
# (сонголтоор) backend/src/routes/revit.ts, docs/bim-ai/* байх ЁСТОЙ.

# --- 1. ХЭМЖИЛТ ҮНЭХЭЭР БАЙХГҮЙ БАЙСАН ГЭДГИЙГ ДАХИН БАТЛАХ (өөрчлөхөөс өмнө) ---
grep -rn "Stopwatch\|ElapsedMilliseconds" revit-mcp/addin --include=*.cs
# Хүлээгдэх: ChangeReport.cs:591,664,683,793,798,802 (төсвийн хязгаарлагч)
#            BatchQto.cs:103,155 (толгойгүй батчийн үргэлжлэх хугацаа)

# --- 2. PUBLICATION HAZARD ---
sed -n '86,135p' revit-mcp/addin/IntentModel.cs

# --- 3. BUSY GUARD ---
sed -n '1325,1345p' revit-mcp/addin/AssistantPane.xaml.cs
grep -n "_busy" revit-mcp/addin/AssistantPane.xaml.cs

# --- 4. ЗАГВАРЫН ХЭМЖЭЭ ---
ls -l revit-mcp/addin/Resources/intent-model.json      # 940283 байт ≈ 918 KB

# --- 5. ALLOWLIST-ИЙН ГУРВАН ТҮВШИН ---
grep -c "Tool(\"" revit-mcp/addin/AgentChat.cs                  # 8
sed -n '48,63p' backend/src/lib/revitAgent.ts                   # 9
grep -c "case \"" revit-mcp/addin/RevitTools.cs                 # 10

# --- 6. AGENT ЗАМ ДУУДАГЧГҮЙ ГЭДГИЙГ БАТЛАХ ---
grep -rn "AskAgentAsync" revit-mcp/addin --include=*.cs --include=*.xaml | grep -v "/obj/"
# Хүлээгдэх: ЗӨВХӨН AssistantPane.xaml.cs:2035 (тодорхойлолт) — дуудагч БАЙХГҮЙ

# --- 7. BUILD IDENTITY (өөрчлөхөөс өмнө) ---
grep -n "AssemblyVersion\|FileVersion\|InformationalVersion" \
     "revit-mcp/addin/obj/x64/Release R27/RevitMcpAddin.AssemblyInfo.cs"

# --- 8. HTTP: ганц клиент, cancellation байхгүй ---
grep -rn "new HttpClient\|CancellationToken" revit-mcp/addin --include=*.cs | grep -v "/obj/"

# --- 9. СЕРВЕР model_version-ыг ХАЯДАГ ГЭДГИЙГ БАТЛАХ ---
grep -n "model_version" backend/src/routes/revit.ts backend/migrations/0195_assistant_learning.sql
# Хүлээгдэх (1B-3-аас ӨМНӨ): ТААРЦ АЛГА → хамаарал биелээгүй, §3.12-ыг бүү бич

# --- 10. BINDS ЗӨРҮҮ ---
sed -n '1700,1710p' backend/src/routes/revit.ts

# ================= BUILD (4 target) =================
cd revit-mcp/addin
dotnet build RevitMcpAddin.csproj -c "Release R24" -p:Platform=x64
dotnet build RevitMcpAddin.csproj -c "Release R25" -p:Platform=x64
dotnet build RevitMcpAddin.csproj -c "Release R26" -p:Platform=x64
dotnet build RevitMcpAddin.csproj -c "Release R27" -p:Platform=x64
# ⚠️ R24 = net48.  `Timing.cs` / `BuildInfo.cs` / `Percentiles.cs` нь тэнд ч
#    эмхэтгэгдэх ЁСТОЙ — Autodesk.Revit-ийн ямар ч төрөл бүү хэрэглэ.

# --- ХУВИЛБАР ТАМГАЛАГДСАН ЭСЭХ ---
powershell -Command "(Get-Item 'bin\x64\Release R27\RevitMcpAddin.dll').VersionInfo.FileVersion"
# `1.0.0.0` БИШ байх ЁСТОЙ

# ================= САВЛАХ =================
cd ..
pwsh -File scripts/package-addin.ps1 -Versions 2024,2025,2026,2027
ls -l dist/
# Хүлээгдэх: 4 zip + 4 *.manifest.json (sha256-тай)

# ================= BACKEND (тайлбар засвал) =================
cd ../backend && npx tsc --noEmit
# ⚠️ Алдаа гарвал: тэдгээр нь ЗӨВХӨН таны хөндөөгүй файлд байгааг батал,
#    дараа нь эзэнд мэдэгд — өөрөө засахгүй (§0).
```

**Гар туршилт (Revit нээлттэй, автоматжуулах боломжгүй):**

1. Revit нээх → MGL самбар нээх → **юу ч бичихгүйгээр** 5 сек → мессеж бичих. Хөлдөх ёсгүй.
2. Самбарыг хаах → дахин нээх → сүлжээний хяналт дээр `?have=` параметртэй хүсэлт харагдана.
3. Удаан хэрэгсэл ажиллаж байхад Enter × 5 → `assistant-log.jsonl`-д шинэ `acted:true` мөр нэмэгдэхгүй.
4. Тохиргоо → шинэ токен → самбар шинэ токеноор ажиллана.
5. Revit хаах → процесс цэвэр гарна; `changes\*.json` нь сүүлийн өөрчлөлтийг агуулсан.

---

## 8. ROLLBACK

**Миграц ҮҮСГЭХГҮЙ.** Энэ сесс D1 хөндөхгүй тул **шинэ миграцийн дугаар ШААРДЛАГАГҮЙ**.

| Юу | Хэрхэн буцаах |
|---|---|
| **Код (репо)** | Салбарыг устгах / `git revert <commit>`. Бусад агентын ажилд хүрэхгүй — зөвхөн өөрийн commit-уудыг revert хий. `git restore` / `git checkout --` **ХЭРЭГЛЭХГҮЙ** |
| **Ажилтны компьютер** | ⚠️ **ХАМГИЙН ҮНЭТЭЙ АЛХАМ.** Автомат буцаалт БАЙХГҮЙ. Өмнөх zip-ийг гараар тарааж, `Install.bat`-ыг Revit ХААЛТТАЙ үед ажиллуулна, ~20 машин дээр. **Ийм учраас энэ бол НЭГ релиз** |
| **Өмнөх багц** | `revit-mcp/dist/`-ийн 2026-08-24-ний zip-үүд (`RevitMcpAddin-Revit2024/2025/2026/2027.zip`). ⚠️ `dist/` git-д ороогүй тул **тэдгээр нь ЗӨВХӨН энэ машин дээр** байна — тараахаас ӨМНӨ өөр газар нөөцөл |
| **Тохиргооны кэш (§3.9a)** | `%APPDATA%\RevitMcpAddin\settings.json` нь форматаа өөрчлөөгүй тул хуучин add-in уншина. Буцаалт хэрэггүй |
| **`agent.json` уншигч (§3.7)** | Токен файл байхгүй үед толгой нэмэгддэггүй тул хуучин агенттай нийцтэй. Буцаалт хэрэггүй |
| **`nonce` (§3.8)** | Зөвхөн уншина, шаардахгүй. Буцаалт хэрэггүй |
| **Backend тайлбар (§3.11)** | `git revert` — код өөрчлөгдөөгүй тул deploy шаардахгүй |
| **Хэмжилтийн талбар (§3.12)** | Add-in буцаавал талбарууд илгээгдэхээ болино. **1B-3-ын багана D1-д ХЭВЭЭР ҮЛДЭЭ.** Багана хасах нь `assistant_logs`-ын table rebuild шаардах ба тэр нь миграцийн шинэ дугаар + path-B ажиллагаа. Хоосон багана нь хор хоргүй |

**Онцгой тохиолдол — User-Agent.** Хэрэв `MglRevitAddin/<version>` хэлбэр ямар нэг шалтгаанаар Cloudflare-т хаагдвал (403 / error 1010), тэр нь **бүх REST дуудлагыг алсаас** зогсооно. Ийм үед add-in бүрэн шинэчлэлээс өөр гарц байхгүй. Тиймээс **тараахаас ӨМНӨ нэг машин дээр туршиж**, 401 (403 БИШ) ирж байгааг батал.

---

## 9. ЭХЛЭХИЙН ӨМНӨ ТОДРУУЛАХ

> Эдгээрийг **репогоос шийдэх боломжгүй**. Эзэн, ажиллаж байгаа Revit, эсвэл продакшны асуулга хэрэгтэй.

### Ажиллаж байгаа Revit шаардлагатай

| # | Асуулт | Яагаад чухал | Хэрхэн хариулах |
|---|---|---|---|
| 1 | **918 KB parse нь бодитоор UI thread дээр унадаг уу?** Статик уншилтаар `Predict` → `EnsureLoaded` нь `SendBtn_Click`-ийн UI thread дээр байгаа боловч WPF-ийн `async void` handler дотор өөр байдалтай байж болно | Урьдчилан халаалт нь **энэ таамаг дээр** тогтоно. Худал бол §3.2-ын үнэ цэн буурна | Эхний мессеж илгээхэд UI хөлдөх эсэхийг хэмж; эсвэл `EnsureLoaded`-д `Debug.WriteLine(Thread.CurrentThread.ManagedThreadId)` тавьж, UI thread-ийн id-тай харьцуул |
| 2 | **`isolate_sheet_elements` ба `reset_isolation` нь `DocumentChanged`-ийн өөрчлөгдсөн элементийн олонлогт ГАРЧ ИРДЭГ ҮҮ?** | Гарч ирдэг бол хэрэглэгчийн «юу өөрчлөгдсөн» жагсаалт **өөрийн туслахын үйлдлээр** бохирдоно. Мөн §3.12(e)-ийн түүвэрлэлтийн давтамжид нөлөөлнө | Суурь тавь → «БА-01 тусгаарла» → «юу өөрчлөгдсөн» гэж асуу. Жагсаалтад шинэ мөр гарч ирвэл — тийм |
| 3 | **Самбарын `Loaded` үйл явдал нэг сесст НЭГЭЭС ОЛОН удаа дуудагддаг уу?** WPF-ийн dockable pane-ыг хааж нээхэд `Loaded` дахин гал авдаг | Дахин гал авдаг бол хоёр дахь удаад `_model` ачаалагдсан байх тул `?have=` ажиллана — өөрөөр хэлбэл §2.4-ийн алдаа нь **зөвхөн эхний удаад**. Мөн `PrewarmAsync` давхар дуудагдана (аюулгүй, гэхдээ мэдэж байх ёстой) | `Loaded` дотор `Debug.WriteLine` тавьж, самбарыг хааж нээ |
| 4 | **`UIControlledApplication.ControlledApplication` нь `OnShutdown`-д хүчинтэй юу?** (2024/2025/2026/2027 бүгд дээр) | §3.9b-ийн teardown үүнээс хамаарна. null бол таймер л Dispose хийгдэнэ, захиалга үлдэнэ | Revit-ийн хувилбар бүр дээр `OnShutdown`-д `Debug.WriteLine(application?.ControlledApplication == null)` |

### Эзэн / гадаад тал шаардлагатай

| # | Асуулт | Яагаад чухал |
|---|---|---|
| 5 | **1A-5-ын агентын токены файлын нэр ба талбарын нэр?** (`agent.json` + `token` гэж таамагласан) | Уншигч ба бичигч **нэг релизэд** гарна. Зөрвөл локал AI бүх машин дээр унана, засах нь дахин бүрэн шинэчлэл |
| 6 | **1A-6-ын batch nonce-ын формат ба scheduler талын хуваарь?** Nonce нь зөвхөн `batch-queue.json`-д уу, эсвэл `batch-result.json`-д цуурайтуулах шаардлагатай юу? | Add-in эхлээд **тэвчинэ**, дараа нь шаардана. Хэзээ «дараа нь» болохыг scheduler-ийн бүх машин шинэчлэгдсэн үе тодорхойлно |
| 7 | **Релизийн хувилбарын дугаар?** `1.1.0` уу, `2.0.0` уу | Тогтмол схем хэрэгтэй — дараагийн релизэд «аль нь шинэ вэ» гэдгийг хүн шууд хэлж чадах ёстой |
| 8 | **⚠️ AI агентын зам ДУУДАГЧГҮЙ (§2.9) — санаатай юу, алдаа уу?** `AskAgentAsync` (`AssistantPane.xaml.cs:2035`)-ыг дуудах мөр репод нэг ч байхгүй | Хэрэв **алдаа** бол `/api/revit/agent/turn`, `lib/revitAgent.ts`, `AgentChat.cs` (448 мөр) — бүгд өнөөдөр үхмэл код, эзэн үүнийг мэдэхгүй байж магадгүй. Хэрэв **санаатай** (инференс хараахан асаагаагүй) бол §3.6-ын клиент allowlist нь урьдчилан сэргийлэлт хэвээр — зөв цаг. **Аль нь болохыг мэдэхгүйгээр `AskAgentAsync`-ыг ЗАЛГАЖ БОЛОХГҮЙ** |
| 9 | **Аль инженер дээр аль build суусан бэ?** `revit-mcp/dist/` нь git-д ороогүй (`revit-mcp/.gitignore:13`); одоо байгаа zip-үүд **2026-08-24**-ний огноотой, өөрөөр хэлбэл 08-25/08-26-ны бүх засварын өмнөх | Хэрэв ажилтнууд 08-24-ний build дээр байвал тэдэнд `ChangeTracker`, `Slots.MatchSheet`, `Conversation`, `RevitToolBus`-ийн timeout засвар **байхгүй** — өөрөөр хэлбэл тэд «дахин дахин 120 секунд» гомдлын кодтой явж байна. Энэ релиз тэдгээрийг бүгдийг нь авчирна, тиймээс **яаралтай байдал өндөр** |
| 10 | **`assistant.min_confidence` app_settings мөрийг серверээс уншдаг болгох уу?** `IntentRouter.cs:76-79`-ийн тайлбар: мөр БАЙГАА ч уншдаг код БИЧИГДЭЭГҮЙ; өнөөдөр өөрчлөх ганц арга нь add-in-ыг дахин барих | Хэрэв тийм бол **энэ релизэд орох ёстой** — эс бөгөөс босго өөрчлөх бүрт дахин тараалт хэрэгтэй. Хамрах хүрээ нэмэгдэх тул эзний шийдвэр |

### Продакшны асуулга шаардлагатай (эхлэхээс өмнө нэг удаа)

```bash
# a) 1B-3 биелсэн үү — ХАМГИЙН ЧУХАЛ ХААЛГА
npx wrangler d1 execute mgl-progress-db-v3 --remote --config backend/wrangler.toml \
  --command "PRAGMA table_info(assistant_logs)"
# `model_version`, `addin_version` ба §3.12-ын цагийн баганууд БАЙХГҮЙ бол
# §3.12-ыг БҮҮ БИЧ — хэмжилт чимээгүй хаягдана.

# b) Идэвхтэй загвар байгаа юу — байхгүй бол талбарын бүх add-in зөвхөн түлхүүр үгээр ажиллаж байна
npx wrangler d1 execute mgl-progress-db-v3 --remote --config backend/wrangler.toml \
  --command "SELECT version, accuracy, example_count, created_at FROM assistant_models WHERE is_active=1"

# c) Бүртгэл асаалттай юу + чат ямар provider дээр вэ
npx wrangler d1 execute mgl-progress-db-v3 --remote --config backend/wrangler.toml \
  --command "SELECT key, value FROM app_settings WHERE key IN ('revit.agent_provider','assistant.logging','assistant.min_confidence')"

# d) Талбар дээр аль add-in хувилбарууд явж байна вэ (энэ релизийн ДАРАА л утгатай)
npx wrangler d1 execute mgl-progress-db-v3 --remote --config backend/wrangler.toml \
  --command "SELECT revit_version, COUNT(*) FROM assistant_logs GROUP BY revit_version"
```
