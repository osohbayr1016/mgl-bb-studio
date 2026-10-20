# 2-3-compliance-engine — өсөлтөт хөдөлгүүр, амьд төслийн төлөв, олдворын амьдралын мөчлөг, хуучирсан олдворын хамгаалалт

> **Track:** 2 · COMPLIANCE ENGINE (эзний шаардлага R2 — «workflow-г нь илрүүлж, цоорхойг нь хараад, барилгын алдааг ӨНДӨР БАРИЛГЫН норм дүрмээр буцаана»)
> **v2 хэсэг:** §51 (passive real-time), §52 (incremental engine), §56 (compliance as live state), §57 (finding lifecycle), §58 (stale-finding protection), §63 (edge case protection) · §83-ын СУУРЬ 7 (incremental compliance engine) ба СУУРЬ 9 (finding lifecycle)
> **Хамаарал (depends on):** `2-2-rule-model` (`rules`, `rule_deps`, `verification_state` clamp, `RuleEngine`/`RuleFacts`/`Units` — цэвэр, Revit-гүй үнэлэгч) · `2-1-team-context` (`bim_sessions.team_code`, `owner_team_code`-ийн эх сурвалж) · `2-4-nonblocking-runtime` (`RawRing`, `ChangeSetCoalescer`, `ComplianceScheduler`-ийн THREAD ба `TryCall`)
> **Блоклож буй (blocks):** `2-5-finding-surface` (override ба root-cause граф нь ЭНЭ хүснэгтүүд дээр наалддаг) · `2-7-readiness-and-quality` (§69-ийн тоолуур ба §66-ийн FP/FN нь ЭНЭ мөрүүдийг уншина)
> **Хөндөх файлууд:** `backend/migrations/0224_compliance_findings.sql` (ШИНЭ), `backend/migrations/0225_finding_links.sql` (ШИНЭ), `backend/migrations/0229_rule_run_ledger.sql` (ШИНЭ), `backend/src/lib/complianceModel.ts`, `backend/src/routes/compliance.ts` (ШИНЭ), `backend/src/index.ts`, `backend/src/lib/modules.ts`, `revit-mcp/addin/ComplianceScheduler.cs` (ШИНЭ), `revit-mcp/addin/ComplianceState.cs` (ШИНЭ), `revit-mcp/addin/RuleFactExtractor.cs` (ШИНЭ), `revit-mcp/addin/RevitTools.cs`, `revit-mcp/addin/RevitApi.cs`, `revit-mcp/addin/App.cs`. **ӨӨР ФАЙЛ БАЙХГҮЙ.** ⚠️ `complianceModel.ts` нь **ШИНЭ БИШ** — түүнийг `2-2` §3.6 үүсгэнэ; энэ сесс зөвхөн ӨӨРИЙН экспортоо ТӨГСГӨЛД НЬ НЭМНЭ (§3.1).
> **Deploy тоо:** 2 (1 × `d1 migrations apply` → 1 × `wrangler deploy`). Migration 3 (0224, 0225, 0229). Add-in (C#) нь **НЭГ РЕЛИЗИД** — тусад нь тараахгүй. Frontend deploy ШААРДЛАГАГҮЙ.

---

## 0. ЭНЭ СЕССИЙН ДҮРЭМ

**Хамрах хүрээ (scope).** Дээрх «Хөндөх файлууд» жагсаалтаас гарахгүй. Энэ сесс нь **өгөгдлийн загвар + сервер маршрут + add-in-ий хуваарилагчийн БИЕ**. Дүрмийн ФОРМАТ, дүрмийн ҮНЭЛЭГЧ (`RuleEngine`), pack татах суваг нь `2-2`-ынх; RawRing, коалесцер ба хуваарилагчийн THREAD нь `2-4`-ийнх; override ба root-cause UI нь `2-5`-ынх. Тэдгээрийн файлд ХҮРЭХГҮЙ.

**Бусад агентуудтай зэрэг ажиллаж байна.** Энэ репод хэд хэдэн агент ЗЭРЭГ ажиллаж байгаа тул working tree-д таны даалгавартай огт хамааралгүй, дуусаагүй, магадгүй **компайл болдоггүй** өөрчлөлт байж болно.

- Өөрийн даалгаварт хэрэгтэй файлыг Л үүсгэ/зас. Хамааралгүй файлыг «засах», reformat хийх, revert хийх ЗӨВШӨӨРӨГДӨХГҮЙ.
- **`git restore`, `git checkout --`, `git stash`, `git reset` хэзээ ч бүү ажиллуул.** **`git add -A` БҮҮ ХЭРЭГЛЭ** — файл бүрийг нэрээр нь нэм.
- **Унасан build автоматаар танийх биш.** `tsc --noEmit` бүх воркерийг компайлдаг тул таны хөндөөгүй файлаас унаж болно. Алдаа ЗӨВХӨН хамааралгүй файлд байгааг батал, дараа нь эзэнд мэдэгд.
- Migration дугаар нь ХАМТРАН эзэмшдэг нөөц. `2-1` (0217–0219), `2-2` (0220–0223) ба `2-4` (0226–0228) зэрэг дугаар авч байна — §3.0-г алгасах ЭРХГҮЙ.

**Deploy хийж болох уу?** Тийм, гэхдээ ЗӨВХӨН эзний зөвшөөрлөөр ба **энэ дарааллаар**: `npx wrangler d1 migrations apply mgl-progress-db-v3 --remote --config wrangler.toml` → дараа нь `npx wrangler deploy --config wrangler.toml`. `--config` **заавал**: репогийн язгуурт хэвтэх `wrangler.jsonc` нь өөр воркер (`name: "mgl"`) зарладаг. `wrangler deploy` нь typecheck ХИЙХГҮЙ — `npx tsc --noEmit`-ыг ӨӨРӨӨ ажиллуул.

**ЭНЭ СЕССИД ХЭЗЭЭ Ч ХИЙЖ БОЛОХГҮЙ:**

| ⛔ | Хориотой | Яагаад — бодит үр дагавар |
|---|---|---|
| 1 | `/api/*`-г `purpose === 'mcp'` токен татгалзахаар чангатгах | Add-in REST дуудлага бүрээ ЯГ тэр 365 хоногийн токеноор баталгаажуулдаг, refresh урсгал БАЙХГҮЙ. Алсаас сэргээх БОЛОМЖГҮЙ цорын ганц өөрчлөлт: ~20 PC, `Install.bat`, Revit хаалттай. Түгжигдсэн нь `middleware/auth.ts:101-102`, `types.ts:209-212`, `lib/tokenValidity.ts:30-34` |
| 2 | `users` / `projects`-ыг `migrations apply`-аар дахин барих | `migrations apply` нь файл бүрийг ГҮЙЛГЭЭНД ороодог ба тэнд `ON DELETE CASCADE` АЖИЛЛАДАГ. `users`-д 19, `projects`-д 33 каскад хүүхэд байна — эцгийг унагаах нь бүх хүүхдийг устгана |
| 3 | Хэрэгжсэн migration файлыг засах | Продакшн дээр **ЧИМЭЭГҮЙ NO-OP**. Ганц хууль ёсны засвар нь ШИНЭ ДУГААР |
| 4 | Trigger дотор `end;` жижиг үсгээр, эсвэл өөрийн мөрөнд биш | wrangler-ийн задлагч нь ТОМ ҮСГЭЭР `END;`-г л таньдаг. Буруу бол файл ХАГАС хэрэгжиж, `d1_migrations` мөр БИЧИГДЭХГҮЙ |
| 5 | Нэг migration файлд 7-оос олон **өөрийн** statement | Задлагч нь файлыг `d1_migrations`-ийн INSERT-тэй залгаж НЭГ `--command` болгодог (`0209:6-12` дээр хэмжсэн). Хэтэрвэл хагас хэрэгжинэ |
| 6 | Инференс (LLM, сүлжээ) `RevitToolEventHandler.Execute`, `ChangeTracker.OnDocumentChanged`, эсвэл найдвартай зам дээр тавих | `RevitToolBus.cs:442-454` ба `ChangeTracker.cs:764-775` дээр ⛔ гэрээ бичээстэй. Revit-ийн мессежийн давталт баригдаж програм БҮХЭЛДЭЭ хөлддөг |
| 7 | `DocumentChanged`-ийн дотор гүйлгээ нээх, элемент өөрчлөх, `Regenerate()` дуудах, ФАЙЛ БИЧИХ, сүлжээ хөндөх | Revit тэр үед баримтыг УНШИХ горимд барина. Энэ handler-ыг орлуулсан хуучин сканнер 120+ секунд авдаг байсан (`ChangeTracker.cs:17-45`) |
| 8 | `ChangeTracker.Gate`-ийг tool bus дуудлага / диск бичилт / await-аар дамжуулан барих | `OnDocumentChanged` нь ГҮЙЛГЭЭ БҮРТ Revit-ийн үндсэн thread дээр `lock (Gate)` авна (`:798`). Хуваарилагч Gate барьчихаад bus-д хүлээвэл хэрэглэгчийн ДАРААГИЙН чирэлт tool-ийн бүтэн deadline хүлээнэ |
| 9 | `DockablePane.Show()` дуудах | Add-in дахь ЦОРЫН ГАНЦ `Show()` нь хэрэглэгчийн өөрийн ribbon товч (`AssistantPaneProvider.cs:47-54`). Автоматаар нээх нь ~300 px ба фокусыг булаана — R7-ийн шууд зөрчил |
| 10 | Түгжээ барьж болох thread-ээс `Dispatcher.Invoke` хийх | UI thread нь өөрөө `lock (Gate)`-д хүлээж байж болно — хоёр thread-ийн deadlock, хэрэглэгчид Revit гацсан мэт харагдана |
| 11 | Дүрмийн үнэлгээ / олдворын мөрийг `_flushTimer`-ийн callback дээр тавих | `:313` нь ДАВТАМЖИТ `Timer` — өмнөх callback дуусаагүй байхад дахин галладаг. Хоёр `FlushDirty` нэг `path + ".tmp"`-д мөргөлдөж (`:577`), хоёр дахь `File.Move` нь `:583`-ын залгидаг catch руу шидэгдэнэ, харин `Dirty.Clear()` (`:558`) аль хэдийн ажилласан тул **тэр өдрийн өөрчлөлт диск рүү ХЭЗЭЭ Ч хүрэхгүй** |
| 12 | Өөр агентын хийж дуусаагүй ажилд хүрэх | Дээрх «Бусад агентуудтай» блокийг үз |

**Энэ сессийн БҮТЭЭГДЭХҮҮНИЙ хатуу дүрэм:** үнэлж ЧАДААГҮЙ дүрэм нь **ХЭЗЭЭ Ч `VIOLATION` буцаахгүй** — `UNCERTAIN` буцаана. Оролт дутуу, нэгж холилдсон, тэг ба «байхгүй» ялгагдахгүй, төслийн контекст алга — эдгээр бүгд `UNCERTAIN`. §3.9-ийг үз.

---

## 1. КОНТЕКСТ

### Систем (хүйтэн сессид хангалттай хэмжээгээр)

| Хэсэг | Юу вэ |
|---|---|
| `backend/` | Cloudflare Worker. `index.ts`-ийн default export нь **`@cloudflare/workers-oauth-provider`**, Hono нь түүний `defaultHandler`. D1 + R2 + KV + Durable Object + Workers AI |
| `frontend/` | Vite + React 19 SPA, Cloudflare Pages төсөл **`mgl-design-system`**. Энэ даалгаварт ХАМААРАХГҮЙ |
| `revit-mcp/addin/` | Revit 2024–2027 C#/WPF add-in, 46 `.cs` файл, **ТЕСТ ТЭГ**, ~20 ажилтны PC дээр, **АВТО ШИНЭЧЛЭЛТ БАЙХГҮЙ** — `Install.bat`, Revit хаалттай |
| D1 | `mgl-progress-db-v3`. Migration хавтас нь схем БИШ (4 хоосон файл, 6 давхардсан дугаар) — шинэ орчныг `wrangler d1 export`-оос босго |
| Аль хэдийн ирсэн | 0201–0210 үйл явдлын агуулах (5 хүснэгт, 8 append-only trigger, 9 GENERATED VIRTUAL багана), `lib/bimEvents.ts` бичих ГАНЦ гарц, `POST /api/learning/events` (`learning.ts:279`) |

### Платформын хатуу хязгаарууд (энэ даалгаварт хамаарах хэсэг)

- **D1-ийн 100 bind таг.** `rowsPerStatement(binds) = floor(100 / (binds + 1))` (`bimEvents.ts:327`). `EVENT_BINDS = 23` → 4 мөр/statement (`:502-503`). Энэ даалгавар `learning_events`-д **бодит багана нэмэхгүй** — хэрэв нэмбэл 23→25 болж 4→3 буурч, хамгийн их урсгалтай хүснэгтийн ingest-ийн хүчин чадал 25% алдагдана.
- **`migrations apply` тээвэрлэлт.** Файл бүр ≤ 7 өөрийн statement, блок тайлбаргүй (`/* */`), мөрөн дотор `;`-гүй, trigger дотор `END;` ТОМ ҮСГЭЭР өөрийн мөрөнд.
- **D1 нь ажиллах үед FK-г хэрэгжүүлдэггүй**, харин `migrations apply` нь гүйлгээнд ороодог тул каскад ТЭНД ажиллана. Тиймээс BIM хүснэгтүүдийн хажууд `REFERENCES` **ЗАРЛАХГҮЙ** (1B-1 §2.6-д хэмжсэн: `ON DELETE SET NULL` нь хүүхдийн UPDATE болж, append-only trigger-ийг галлаж, ЭЦГИЙН DELETE-ийг БҮХЭЛД НЬ ABORT хийнэ).
- **Revit API.** `DocumentChanged` дотор баримт УНШИХ горимд. Revit-ийн үндсэн thread рүү орох ЦОРЫН ГАНЦ зам нь `RevitToolBus`-ийн `ExternalEvent`. UI thread-ээс `RevitToolBus.Call` дуудах нь **deadlock**.

### Яагаад энэ даалгавар байна вэ

1. **§51-ийн 3–7-р шат ОГТ БАЙХГҮЙ.** «Өөрчлөлт илэрлээ» (шат 2) хүртэл ирсэн; «нөлөөлсөн элемент → нөлөөлж болох дүрэм → зөвхөн хамааралтай шалгалт → олдвор → мэдэгдэл» гэсэн үлдсэн тав нь кодод нэг ч мөргүй (§2.12-ын grep).
2. **Олдворын хүснэгт байхгүй.** `grep -rn "compliance\|_findings\|finding_" backend/migrations backend/src` тэг буцаана. §57-ын 7 төлөв, §57-ын 13 хадгалах талбар нь хаана ч хадгалагдахгүй.
3. **Хуучирсан олдворын хамгаалалт байхгүй** (§58). Загвар өөрчлөгдсөний дараа ч хуучин дүгнэлт үнэн мэт харагдана — энэ бол инженерийн итгэлийг нэг удаад устгадаг алдаа.
4. **«Юу өөрчлөгдөв» ба «бид дөнгөж хармагцаа» ялгагдахгүй** (§56-ын 2–4 асуулт). `scan_generation` тоолуургүйгээр «ШИНЭ гарсан зөрчил» гэж хэлэх ямар ч арга байхгүй.
5. **Тэг ба «байхгүй» ялгагдахгүй байх эрсдэл аль хэдийн репод бий.** `QtoExtractor.cs:528-534`-ийн `Round3OrNull` нь бодит тэгийг NULL болгодог — §63 нь `zero` ба `missing input`-ыг ТУСДАА шаарддаг тул тэр функцийг ДАХИН АШИГЛАХГҮЙ.
6. **Add-in-д авто шинэчлэлт байхгүй** тул C# өөрчлөлт бүр ~20 PC-ийн гар ажил. Тиймээс энэ хөдөлгүүр НЭГ релизид, бүрэн (үнэлэгч + хуваарилагч + төлөв + илгээгч) орох ёстой; хагасаар нь тараах нь өртгийг хоёр дахин төлнө.

---

## 2. БАТАЛГААЖСАН ОДООГИЙН ЗАН ТӨЛӨВ

> Доорх `file:line` бүрийг энэ сесс өөрөө нээж баталгаажуулав (**2026-08-30**, commit `6a8e4f5`). Мөрийн дугаар буруу байвал хүйтэн сесс худал зам руу орно — иймд эшлэл бүрийг ДАХИН нээж шалга.

### 2.1 `DocumentChanged` нь УНШИХ горим — гэрээ нь эх кодод бичээстэй

`ChangeTracker.cs:17-51`-ийн ангийн `<summary>` нь хуучин сканнерын өртгийг ба одоогийн хоригийг ГАРААС нь бичсэн:

```
ChangeTracker.cs:22     ///     new FilteredElementCollector(doc, viewId)
ChangeTracker.cs:23     /// хийдэг байв.  Энэ бол Revit API-ийн ХАМГИЙН ҮНЭТЭЙ хэлбэр: харагдацын
ChangeTracker.cs:24     /// хамрах хүрээтэй collector нь тухайн харагдацыг REGENERATE хийлгэж,
ChangeTracker.cs:26     /// 100 хуудас × 2 харагдац = 200 удаагийн regenerate
ChangeTracker.cs:37     ///     хуучин:  O(хуудас × харагдац × харагдах элемент)   ≈ 120 сек+
ChangeTracker.cs:38     ///     шинэ:    O(өөрчлөгдсөн элемент)                     ≈ 0 мс
ChangeTracker.cs:44     /// Гүйлгээ нээх, элемент өөрчлөх, `Regenerate()` дуудах нь онцгой байдал
ChangeTracker.cs:45     /// үүсгэнэ.  Мөн ФАЙЛ БИЧИЖ БОЛОХГҮЙ — хэрэглэгчийн зурж байгаа үйлдэл
ChangeTracker.cs:49     /// хийж, «бохирдсон» гэж тэмдэглэнэ; бичилтийг таймер арын thread дээр
ChangeTracker.cs:50     /// ЖИГДРҮҮЛЖ (debounce) хийнэ.
```

Мөн handler-ийн дээрх ⛔ гэрээ (`:764-775`) нь инференсийн ганц зөвшөөрөгдсөн суулгацыг нэрлэнэ: `AssistantPane`-ийн `DecidedBy.Fallback` салаа.

### 2.2 Handler-ийн БҮТЭН бие — юу хийдэг ба юу ХИЙДЭГГҮЙ

| Баримт | file:line | Бодит код / текст |
|---|---|---|
| Түүвэрлэсэн Stopwatch, 64 гүйлгээ тутамд НЭГ | `ChangeTracker.cs:783` | `if (System.Threading.Interlocked.Increment(ref _dcCounter) % DcSampleEvery == 0)` |
| `DcSampleEvery` | `ChangeTracker.cs:369` | `private const int DcSampleEvery = 64;` |
| Revit API-д хандах ЦОРЫН ГАНЦ дуудлага, ТҮГЖЭЭНЭЭС ГАДНА | `ChangeTracker.cs:795` | `string opName = OpNameOf(e);` |
| … тэр нь `GetTransactionNames()` | `ChangeTracker.cs:743` | `IList<string> names = e.GetTransactionNames();` |
| Түгжээ нээгдэнэ | `ChangeTracker.cs:798` | `lock (Gate)` |
| Sync/reload идэвхтэй бол ЭРТ БУЦНА | `ChangeTracker.cs:801` | `if (Suppressed.Contains(key)) return;` |
| Олонлогийн алгебр — үүсгээд устгасан нь ТЭГ | `ChangeTracker.cs:846` | `if (c.Added.Remove(v)) { c.Meta.Remove(v); continue; }` |
| Бохирдлыг тэмдэглэнэ (энэ л бүхэн) | `ChangeTracker.cs:~893` | `Dirty.Add(key);` |
| Нүцгэн `catch` — АЛДАА ГАРГАЖ БОЛОХГҮЙ | `ChangeTracker.cs:895-900` | «Үйл явдлын боловсруулагчаас шидэгдсэн алдаа нь хэрэглэгчийн ЗУРЖ БАЙГАА гүйлгээг тасалж болно» |

**Дүгнэлт:** handler нь id-г олонлогт хийж, түлхүүрийг бохирдсон гэж тэмдэглээд гардаг. Дүрэм ГҮЙЦЭТГЭДЭГГҮЙ, элемент УНШДАГГҮЙ, категори ч МЭДДЭГГҮЙ.

### 2.3 Add-in дахь ЦОРЫН ГАНЦ таймер ба түүний ДАВТАМЖИТ шинж

```
ChangeTracker.cs:55     private const int FlushIntervalMs = 3000;
ChangeTracker.cs:280    private static Timer _flushTimer;
ChangeTracker.cs:313    _flushTimer = new Timer(_ => FlushDirty(), null, FlushIntervalMs, FlushIntervalMs);
```

⚠️ Гурав дахь аргумент нь `Timeout.Infinite` **БИШ**, `FlushIntervalMs` — өөрөөр хэлбэл `Timer` нь ДАВТАМЖИТ бөгөөд өмнөх callback дуусаагүй байхад шинэ threadpool thread дээр дахин галладаг. `FlushDirty` нь:

```
ChangeTracker.cs:533        lock (Gate)
ChangeTracker.cs:558            Dirty.Clear();
ChangeTracker.cs:563        Metrics.FlushLock.Add(lockSw.Elapsed.TotalMilliseconds);
ChangeTracker.cs:570        // ⚠️ ДИСК БИЧИЛТ ТҮГЖЭЭНЭЭС ГАДНА.
ChangeTracker.cs:577            string tmp = path + ".tmp";
ChangeTracker.cs:580            if (File.Exists(path)) File.Delete(path);
ChangeTracker.cs:581            File.Move(tmp, path);
ChangeTracker.cs:583    catch
ChangeTracker.cs:585        // Диск дүүрсэн / эрх байхгүй — мөрдөлт санах ойд үргэлжилнэ.
```

Түр файлын нэр нь ПРОЦЕСС ба CALLBACK-ээс ҮЛ ХАМААРНА. Өнөөдөр callback нь миллисекундын ажил тул давхцал үүсэхгүй; **2 секундын дүрмийн үнэлгээ эсвэл 20 секундын POST-ыг энэ callback дээр тавибал давхцал ХЭВИЙН БОЛНО** ба `Dirty.Clear()` аль хэдийн ажилласан тул алдагдал ЧИМЭЭГҮЙ. Иймд §0-ын 11-р хориг.

⚠️ **Тайлбарын зөрүү.** Хэд хэдэн урьдчилсан төлөвлөгөө «энэ бол add-in дахь цорын ганц таймер тул түүн дээр ажлаа тавь» гэж уншсан. «Цорын ганц таймер» гэдэг нь ҮНЭН (`grep -c "new Timer\|DispatcherTimer" *.cs` → зөвхөн `ChangeTracker.cs:313`) ба тэр нь `Metrics.FlushLock` (`Percentiles.cs:143`) яагаад үндсэн thread-ийн бодит блоклолтыг хэмждэг гол шалтгаан. Гэвч тэр нь **аюулгүй байдлын шинж чанар БИШ**. Дүрмийн үнэлгээ нь `2-4`-ийн зориулалтын `IsBackground` thread дээр ажиллана.

### 2.4 `TryGetByKey` — thread-ээс гадуур уншихад ЗОРИУЛСАН, гэхдээ ГҮНЗГИЙ ХУУЛНА

```
ChangeTracker.cs:405    /// ажиллана.  Тэндээс `Document`-д хүрэх нь хориотой.
ChangeTracker.cs:411    /// гацах эрсдэл тэг, ExternalEvent хэрэггүй.
ChangeTracker.cs:412    public static bool TryGetByKey(string key, out Change copy)
ChangeTracker.cs:417        lock (Gate)
ChangeTracker.cs:429            Added = new HashSet<long>(c.Added),
ChangeTracker.cs:430            Deleted = new HashSet<long>(c.Deleted),
ChangeTracker.cs:431            Modified = new HashSet<long>(c.Modified),
ChangeTracker.cs:438            Ops = new List<string>(c.Ops),
ChangeTracker.cs:439            Meta = new Dictionary<long, Touch>(c.Meta),
```

Хуулбар нь `Gate`-ийн ДОТОР хийгддэг ба хамгийн муу тохиолдолд гурван `HashSet` × `MaxTrackedIds` (`:63` = **500000**) дээр нэмээд `Meta` × `MaxMetaEntries` (`:74` = **20000**) байна. Одоо түүнийг дуудагч нь зөвхөн хэрэглэгчийн санаачилсан ХОВОР зам: `ChangeReport.cs:274`, `ChangeReport.cs:729`, `RevitTools.cs:315`.

**Тиймээс энэ даалгавар `TryGetByKey`-г 3 секунд тутмын мөчлөгт ХЭРЭГЛЭХГҮЙ** — тэр нь `Metrics.FlushLock`-ийг өсгөж, гүйлгээ бүр өрсөлдөөн төлнө. Мөчлөгийн уншилт нь `2-4`-ийн `RawRing` (хязгаартай, зөвхөн-нэмэгддэг дельта). `TryGetByKey` нь **зөвхөн БҮТЭН СКАН** ба `Truncated`/`MetaTruncated` тугийг унших ховор замд үлдэнэ (§3.11).

### 2.5 Undo/redo нь БЭЛЭН дохио — `Depth` ба нэрийн угтвар

```
ChangeTracker.cs:100        public int Hits;
ChangeTracker.cs:114        public int Depth;
ChangeTracker.cs:195        public bool UndoTouch(long id, long sec)
ChangeTracker.cs:204            if (t.Depth <= 0) return true;
ChangeTracker.cs:753            case UndoOperation.TransactionUndone: return "undo:" + name;
```

`Depth` 0 болоход элемент жагсаалтаас БҮРЭН хасагдана — өөрөөр хэлбэл «энэ элемент суурьдаа буцаж ирлээ» гэсэн дохио ҮНЭГҮЙ бий. `op_name` нь `undo:` / `redo:` угтвартай ирдэг (`0203:113-114` мөн үүнийг тэмдэглэсэн). §58-ын хуучруулах хоёр дахь гох ба §5.1-ийн undo-тэсрэлтийн дарангуйлал ЭНЭ ХОЁРООС гарна.

⚠️ `Hits` нь **ахлагчийн тайланд ХЭЗЭЭ Ч ОРОХГҮЙ** (`:88-99`-ийн шийдвэр). Олдворын самбар ч мөн адил хүн нэрлэсэн тоо гаргахгүй.

### 2.6 `Suppressed` — бусдын sync нь ЭНЭ хэрэглэгчийн ажил биш

```
ChangeTracker.cs:273    private static readonly HashSet<string> Suppressed = new HashSet<string>(StringComparer.Ordinal);
ChangeTracker.cs:622        lock (Gate) { Suppressed.Add(key); }
ChangeTracker.cs:633        lock (Gate) { Suppressed.Remove(key); }
ChangeTracker.cs:715            Suppressed.Remove(key);
ChangeTracker.cs:801        if (Suppressed.Contains(key)) return;
```

Өөрчлөлт мэдээлэхэд энэ нь ЗӨВ. Хуучруулахад энэ нь **ҮХЛИЙН** — BB баг хананы байрлалыг зөөж sync хийхэд, BA «Reload Latest» дархад тэр элементүүд Suppressed цонхон дотор ирж ХАЯГДАНА, тэгээд BA нь аль хэдийн зассан хонгил дээр `VIOLATION`-ыг (эсвэл бүр аюултай нь — аль хэдийн эвдэрсэн хонгил дээр `PASS`-ыг) харсаар байна. `bim_sessions.central_path_hash` (`0202:62`) нь энэ нь worksharing загвар гэдгийг аль хэдийн хэлдэг.

### 2.7 ЭСРЭГ-ЗАГВАР: харагдацын хамрах хүрээтэй collector

`ChangeReport.cs`-ийн ангийн гурван зарчим:

```
ChangeReport.cs:27      ///   1. СУУРЬ ЖАГСААЛТ НЬ ХАРАГДАЦЫГ ХӨНДӨХГҮЙ.  `doc.GetElement(id)` нь
ChangeReport.cs:28      ///      индексийн лавлагаа — regenerate үүсгэхгүй.
ChangeReport.cs:34      ///      («IsElementVisibleInView» гэж байхгүйг реф ассемблиэс шалгасан).
ChangeReport.cs:36      ///      2026-08-25-ны 120 секундын гацааг үүсгэсэн.
ChangeReport.cs:39      ///   3. `ShowElements` ХЭЗЭЭ Ч ДУУДАХГҮЙ.  (модаль TaskDialog)
```

Хэрэв үнэтэй зам ЗААВАЛ хэрэгтэй бол ЦАГИЙН ТӨСӨВТЭЙ:

```
ChangeReport.cs:64      private const int MaxItems = 5000;
ChangeReport.cs:70      private const int SearchBudgetMs = 2500;
ChangeReport.cs:82      private const int DigestBudgetMs = 4000;
ChangeReport.cs:663     private static View FindViewShowing(
ChangeReport.cs:691         int n = new FilteredElementCollector(doc, v.Id)
```

**Энэ загварт уншсан баримт бүр нь `doc.GetElement(id)` эсвэл БАРИМТЫН ХАМРАХ ХҮРЭЭТЭЙ collector.** Харагдацын хамрах хүрээтэй collector нь `RuleFactExtractor`-т ХОРИОТОЙ.

### 2.8 Tool bus — нэг эгнээ, зүсэлтийн хязгаар, хаягдлын протокол

| Баримт | file:line | Бодит код |
|---|---|---|
| Глобал нэг-урсгал семафор (чат + QTO хамт) | `RevitToolBus.cs:134` | `private static readonly SemaphoreSlim Gate = new SemaphoreSlim(1, 1);` |
| deadline нь `Gate.Wait`-аас ӨМНӨ эхэлдэг | `RevitToolBus.cs:266` | `if (!Gate.Wait(Math.Max(1, timeoutSeconds) * 1000))` |
| Нэг зүсэлтэд дээд тал нь 4 дуудлага | `RevitToolBus.cs:440` | `private const int MaxPerSlice = 4;` |
| … давталт ба дахин Raise | `RevitToolBus.cs:458`, `:512` | `while (done < MaxPerSlice && _queue.TryDequeue(...))` / `if (!_queue.IsEmpty) RevitToolBus.RaiseAgain();` |
| Хаягдлын туг | `RevitToolBus.cs:32` | `public volatile bool Abandoned;` |
| … дуудагч тавина | `RevitToolBus.cs:309` | `call.Abandoned = true;` |
| … ЦОРЫН ГАНЦ шалгалт, ГҮЙЦЭТГЭХИЙН ӨМНӨ | `RevitToolBus.cs:474-478` | `if (call.Abandoned) { call.Done.Set(); continue; }` |

⚠️ `:474`-ийн шалгалт нь dequeue дээр, гүйцэтгэлийн ӨМНӨ. `RevitTools.Run` эхэлсэн бол **цуцлалт БАЙХГҮЙ** — дуудагчийн timeout нь ДУУДАГЧИЙГ хамгаална, Revit-ийг БИШ. Иймд 40 секундын дуудлага нь хэмжилтэд цэвэрхэн 5 секундын timeout бичиж, Revit нь 40 секунд хөлдөнө. **Хамгаалалт нь зөвхөн хэрэгслийн ДОТООД төсөв.** Репод бэлэн жишээ: `RevitApi.cs:489-514`-ийн `change_digest` = 30 с гадаад / 4 с дотоод, `goto_element` = 45 с гадаад / 2.5 с дотоод.

### 2.9 Append-only trigger-үүд — олдворын төлөв ТЭНД амьдарч ЧАДАХГҮЙ

`0206_bim_append_only.sql` нь ЯГ 8 trigger, 4 хүснэгт дээр:

```
0206:1    CREATE TRIGGER IF NOT EXISTS bim_artifacts_append_only
0206:8    CREATE TRIGGER IF NOT EXISTS bim_artifacts_redact_once
0206:15   CREATE TRIGGER IF NOT EXISTS revit_transactions_append_only
0206:22   CREATE TRIGGER IF NOT EXISTS revit_transactions_redact_once
0206:29   CREATE TRIGGER IF NOT EXISTS revit_element_touches_append_only
0206:36   CREATE TRIGGER IF NOT EXISTS revit_element_touches_redact_once
0206:43   CREATE TRIGGER IF NOT EXISTS learning_events_append_only
0206:50   CREATE TRIGGER IF NOT EXISTS learning_events_redact_once
0206:5      SELECT RAISE(ABORT, 'bim_artifacts is append-only — only redaction may UPDATE');
```

`bim_sessions` нь энэ жагсаалтад БАЙХГҮЙ — `check-bim-events.mjs:35` дээр `IMMUTABLE = TABLES.filter(t => t !== 'bim_sessions')` гэж бичээстэй. §57-ын `OPEN → ACKNOWLEDGED → FIXED → REOPENED` шилжилтүүд нь UPDATE тул дөрвөн хамгаалагдсан хүснэгтийн аль нэгэнд байрлуулбал ABORT авна. **Иймд `compliance_findings` нь ХУВИРАМТГАЙ, эдгээр trigger-ээс ГАДНА.** Нөхөн төлбөр нь §3.4-т.

### 2.10 ҮНЭГҮЙ ХОЖИЛ: дүгнэлтийн үйл явдал АЛЬ ХЭДИЙН боломжтой

| Баримт | file:line | Бодит код |
|---|---|---|
| `RULE_VALIDATION` нь хаалттай багцад БИЙ | `bimEvents.ts:168` | `'RULE_VALIDATION',` |
| Шаардах хиймэл дагуул | `bimEvents.ts:232` | `RULE_VALIDATION: ['RULE_VERDICT'],` |
| Бит нь `rule_id` + `passed` байвал л тавигдана | `bimEvents.ts:741` | `if (has(input.payload, 'rule_id') && has(input.payload, 'passed')) present.add(part);` |
| `rule_id` нь GENERATED VIRTUAL багана | `0209:27-28` | `ALTER TABLE learning_events ADD COLUMN rule_id TEXT GENERATED ALWAYS AS (json_extract(payload_json, '$.rule_id')) VIRTUAL` |
| … индекстэй | `0210:20-21` | `CREATE INDEX IF NOT EXISTS idx_le_rule ON learning_events (rule_id, occurred_at) WHERE rule_id IS NOT NULL` |
| Сургалтад орох ЭРХИЙН ЦОРЫН ГАНЦ тодорхойлолт | `bimEvents.ts:144` | `export const DATASET_ELIGIBLE_SQL = 'parts_missing = 0';` |
| Гэрээний шошго | `bimEvents.ts:302-306` | `v${CONTRACT_VERSION}:${kind}+${parts.join('+')}` → `v1:RULE_VALIDATION+RULE_VERDICT` |

**Дүгнэлт: дүгнэлтийг мөнхийн бүртгэлд бичихэд migration ХЭРЭГГҮЙ, `bimEvents.ts`-ийн үгсийн санд ЗАСВАР ХЭРЭГГҮЙ.** Зөвхөн `payload_json`-д `rule_id` ба `passed` тавина.

⚠️ Энэ нь мөн **хордуулах суваг**: бит тавигдмагц `parts_missing = 0` болж, мөр `DATASET_ELIGIBLE_SQL`-ээр АВТОМАТААР сургалтад тэнцэнэ. Тиймээс §3.4-ийн payload нь `verification_state`, `rule_version`, `ruleset_version`, `pack_sha256`, `team_code` зэргийг БИЧИХ ҮЕДЭЭ ХӨЛДӨӨНӨ. Тэдгээрийг ямар VIRTUAL багана болгохыг `2-1` (0219) эзэмшинэ — энэ файл зөвхөн **payload-ийн хэлбэрийг** тогтооно.

### 2.11 Элементийн ТОГТВОРТОЙ түлхүүр

```
0204:104      element_id    INTEGER NOT NULL,      -- ElementId.Value — ТОГТВОРГҮЙ
0204:105      element_uid   TEXT,                  -- Element.UniqueId — ТОГТВОРТОЙ, хожуу
0204:150  CREATE INDEX IF NOT EXISTS idx_ret_elem_uid
0204:151    ON revit_element_touches (element_uid, occurred_at)
```

Олдвор нь **`element_uid`-д зангуулагдана**. `element_id` нь зөвхөн энэ сессийн доторх хурдан хайлтад (`doc.GetElement`) хадгалагдана — тойрог хийсний дараа өөр элемент рүү заана.

### 2.12 ЮУ БАЙХГҮЙ — grep-ээр батлав (2026-08-30)

```bash
grep -rn "compliance\|_findings\|finding_\|rule_run\|stale_at" backend/migrations backend/src --include=*.sql --include=*.ts | wc -l
# Хэмжсэн гаралт:
```
```
0
```

```bash
grep -rln "RuleEngine\|ComplianceScheduler\|RuleFactExtractor\|collect_rule_inputs" revit-mcp/addin/*.cs | wc -l
# Хэмжсэн гаралт:
```
```
0
```

`RevitTools.ToolNames` нь ЯГ 10 хэрэгсэл (`RevitTools.cs:54-65`): `get_document_context`, `list_sheets`, `capture_baseline`, `diff_since_baseline`, `list_changes`, `change_digest`, `goto_element`, `isolate_sheet_elements`, `reset_isolation`, `capture_view_image`. Нэг ч нь параметрийн утга, өргөн, өндөр, налуу буцаадаггүй.

**Дүгнэлт: §55-ийн 1→2 шат (debounce) ИРСЭН. §51-ийн 3–7 шат, §52, §56, §57, §58, §63 нь ХЭРЭГЖИЛТГҮЙ.**

---

## 3. ХИЙХ АЖИЛ

### 3.0 Дугаар авах

```bash
ls backend/migrations | tail -5
# 2026-08-30-нд хэмжсэн гаралт:
```
```
0212_assistant_log_provenance.sql
0213_assistant_model_eval.sql
0214_assistant_review.sql
0215_assistant_trust_taxonomy.sql
0216_assistant_log_timing.sql
```

Энэ баримтын НӨӨЦЛӨСӨН блок нь **0224, 0225** ба нэмж **0229**. `2-1` нь 0217–0219, `2-2` нь 0220–0223, `2-4` нь 0226–0228, `2-5` нь 0237, `2-6` нь 0238–0240, `2-8` нь 0241–0242 авна (`docs/bim-ai/README.md:133-142`). ⚠️ Сесс эхлэхийн ӨМНӨ дээрх командыг ДАХИН ажиллуул — ах дүү агентууд зэрэг дугаар шаардаж байна, репод аль хэдийн зургаан давхардсан дугаар бий (0002, 0060, 0080, 0110, 0120, 0121).

⚠️ **0229-ыг ЭНЭ БАРИМТ ЗАРЛАН АВЛАА.** README-ийн нөөц блок нь **0229–0236** (`README.md:142`); эндээс ХАМГИЙН ЭХНИЙГ нь, ЯГ НЭГИЙГ авна. Шалтгаан: `rule_run_ledger` нь `2-5` ба `2-7`-ийн толгойд «`2-3` үүсгэнэ» гэж бичигдсэн атлаа `0224`/`0225` хоёулаа аль хэдийн 7 statement дүүрсэн, `2-7` нь **дугаар огт авдаггүй** (`README.md:139` «Migration БАЙХГҮЙ — зөвхөн УНШИНА»). Эзэнгүй үлдээвэл репогийн `project_threads`-ийн алдаа давтагдана: зөвхөн продакшн дээр оршдог, дискэн дээр `CREATE TABLE` нь БАЙХГҮЙ хүснэгт. DDL нь §3.3-т.

### 3.1 Гурван ТЭНХЛЭГ, долоон ТӨЛӨВ — `backend/src/lib/complianceModel.ts` (`2-2`-ынх, ЭНД ЗӨВХӨН НЭМНЭ)

⚠️ **ГУРВАН ТЭНХЛЭГИЙГ ХЭЗЭЭ Ч НЭГТГЭХГҮЙ.** Тэд өөр өөр асуултад хариулна: *дүгнэлт* = «энэ шалгалт юу гэж хэлэв», *ангилал* = «энэ нь ямар төрлийн асуудал вэ», *нотолгооны түвшин* = «бид үүнийг хэр сайн мэдэж байна вэ». Нэг `status` багана болгон нурааж болохгүй: тэгвэл `TEAM_STANDARD` нь зохицуулалтын зөрчлөөс ялгагдахаа болино — тэр нь эзний R3-ийн үндэс.

⚠️ **ЭНЭ ФАЙЛЫГ `2-2` §3.6 ҮҮСГЭНЭ, ЭНЭ СЕСС БИШ.** `VERDICTS` (§40-R2, 4 утга), `ISSUE_CLASSES` (§59-R3, 5 утга), `EVIDENCE_LEVELS` (§65-R2, 5 утга), `SEVERITIES` (§67, 5 утга), `VERIFICATION_STATES`, `SEVERITY_RANK` ба баталгааны ХАВЧААР нь **`2-2` §3.6-д тодорхойлогдсон — энд ДАХИН БИЧИХГҮЙ.** Нэг модульд ижил `export const` хоёр удаа зарлавал TypeScript `duplicate identifier` алдаа өгч файл КОМПАЙЛ БОЛОХГҮЙ. Энэ сесс дараах блокыг файлын **ТӨГСГӨЛД НЭМНЭ** ба өмнөх экспортыг ХӨНДӨХГҮЙ. `2-5` (эрхийн түвшин) ба `2-7` (§59-ийн толь) ч мөн адил зөвхөн нэмнэ.

```ts
// backend/src/lib/complianceModel.ts  — ЭНЭ СЕССИЙН НЭМЭЛТ (файлын ТӨГСГӨЛД)
//
// ⚠️ ЭНЭ ФАЙЛ SQL БИЧИХГҮЙ.  Хаалттай үгсийн сан + цэвэр функцууд ЗӨВХӨН.
//    `routes/compliance.ts` нь эндээс УГТВАРУУДЫГ авна.
//
// ⚠️ Verdict / IssueClass / EvidenceLevel / Severity төрлүүд нь ЭНЭ ФАЙЛЫН
//    ДЭЭД хэсэгт (2-2 §3.6) аль хэдийн зарлагдсан — доор ЗӨВХӨН лавлана.

/** §57-R1 — ЯГ ДОЛОО.  ⚠️ `STALE` нь ЭНД БАЙХГҮЙ: §57-д тоологдоогүй ба
 *  §58 нь түүнийг «түр тэмдэг → дахин тооцоолол» гэж тодорхойлдог.
 *  `stale_at` / `stale_reason` багана нь тэр тэмдэг. */
export const LIFECYCLE_STATES = [
  'OPEN', 'ACKNOWLEDGED', 'FIXED', 'REOPENED', 'DISMISSED', 'INVALIDATED', 'UNCERTAIN',
] as const;
export type LifecycleState = (typeof LIFECYCLE_STATES)[number];

/** §58 — хуучруулах ГУРВАН гох.  §3.10-ийг үз. */
export const STALE_REASONS = ['sync', 'edit', 'ruleset', 'central'] as const;

/** §63-ийн шалтгаанууд.  `UNCERTAIN` мөр бүр ЭНЭ УТГЫН НЭГИЙГ авна —
 *  «яагаад мэдэхгүй байгаа» гэдэг нь тухайн дүрмийг засах ЦОРЫН ГАНЦ мөр. */
export const UNCERTAIN_REASONS = [
  'missing_input', 'zero_vs_missing', 'invalid_input', 'mixed_units',
  'mixed_provenance', 'missing_context', 'conflict', 'budget_abort',
  'not_extractable', 'boundary_location',
] as const;

/** Хууль ёсны шилжилтүүд.  ⚠️ Бүрэн `Record<>` — шинэ төлөв нэмбэл
 *  компайлын алдаа гарна (`REQUIRED_PARTS_OF`-ийн заншил). */
export const ALLOWED_TRANSITIONS: Record<LifecycleState, readonly LifecycleState[]> = {
  OPEN:         ['ACKNOWLEDGED', 'FIXED', 'DISMISSED', 'INVALIDATED', 'UNCERTAIN'],
  ACKNOWLEDGED: ['FIXED', 'DISMISSED', 'INVALIDATED', 'REOPENED', 'UNCERTAIN'],
  FIXED:        ['REOPENED', 'INVALIDATED'],
  REOPENED:     ['ACKNOWLEDGED', 'FIXED', 'DISMISSED', 'INVALIDATED', 'UNCERTAIN'],
  DISMISSED:    ['REOPENED'],           // §68 — override нь НЭМЭЛТ, устгалт БИШ
  INVALIDATED:  [],                     // эцсийн: дүрэм татагдсан / хамрахаа больсон
  UNCERTAIN:    ['OPEN', 'FIXED', 'INVALIDATED', 'ACKNOWLEDGED'],
};

/** §61-R3 — хамаарал нь дүрэм ГҮЙЦЭТГЭХЭЭС ӨМНӨ тогтоогддог.  Тиймээс
 *  `NOT_APPLICABLE` нь ХАМААРЛЫН ҮР ДҮН бөгөөд МӨР БОЛЖ ХЭЗЭЭ Ч ХУВИРАХГҮЙ.
 *  Энэ нь §11-ийн 5 утга ба §40-R2-ийн 4 утгын зөрүүг шийднэ.
 *  ⚠️ Мөр үлдээхгүй тул «хэзээ ч ажиллаагүй дүрэм» ба «бүрэн нийцсэн загвар»
 *  хоёр ЯГ ИЖИЛ харагдана — гүйлтийн бүртгэл (`rule_run_ledger`, §3.3-ийн
 *  0229; payload нь §3.12) энэ нүхийг хаана. */
export const NOT_APPLICABLE_IS_NOT_A_ROW = true as const;
```

### 3.2 Migration `0224_compliance_findings.sql` (ШИНЭ) — 7 statement

```sql
-- =============================================================
-- 0224_compliance_findings.sql — v2 §56/§57/§58-ын ОЛДВОРЫН ХҮСНЭГТ
-- =============================================================
-- ЗОРИЛГО: нэг дүрэм × нэг элемент дээрх ХАМГИЙН СҮҮЛИЙН дүгнэлтийг
-- АМЬД ТӨЛӨВ болгож барих.  §56 нь долоон асуултад УНШИХ үед хариулахыг
-- шаарддаг тул энэ нь үйл явдлын урсгалаас гаргаж авдаг дүн БИШ, БОДИТ
-- мөр байх ёстой: D1 дээр гаргаж авбал бэлэн байдлын хаалт нь бүтэн
-- хүснэгтийн скан болно.
--
-- ⚠️ ЭНЭ ХҮСНЭГТ ХУВИРАМТГАЙ — 0206-ийн НАЙМАН trigger нь ЯГ дөрвөн
--    хүснэгтийг нэрлэдэг (bim_artifacts, revit_transactions,
--    revit_element_touches, learning_events).  §57-ын OPEN→ACKNOWLEDGED→
--    FIXED→REOPENED нь UPDATE тул тэдний аль нэгэнд байрлуулбал
--    RAISE(ABORT) авна.  Аудитын мөрийг ХОЁР аргаар нөхнө:
--      (1) `finding_overrides` — өөрийн trigger-тэй, зөвхөн-нэмэгддэг (2-5),
--      (2) ТӨЛӨВ ӨӨРЧЛӨГДӨХ БҮРТ нэг `learning_events` RULE_VALIDATION мөр.
--
-- ⚠️ REFERENCES ЗАРЛАХГҮЙ.  1B-1 §2.6-д хэмжсэн: ON DELETE SET NULL нь
--    хүүхдийн UPDATE болж, хөрш append-only trigger-ийг галлаж, ЭЦГИЙН
--    DELETE-ийг БҮХЭЛД НЬ ABORT хийнэ.
--
-- ⚠️ ЗӨВХӨН ӨӨРИЙГӨӨ ХАРАХ.  `detected_by` нь 0201/0203/0205-ын толгойд
--    дөрвөн удаа давтагдсан үл хөдлөх дүрмийн зангуу: уншилтын маршрут бүр
--    (а) detected_by = viewer.sub, эсвэл (б) ЗӨВХӨН НЭГТГЭСЭН тоо.
--
-- ⚠️ ТЭЭВРИЙН ДҮРЭМ (0209:6-12-т хэмжсэн): файл бүр <= 7 өөрийн statement,
--    блок тайлбаргүй, мөрөн дотор цэг таслалгүй (энэ мөр өөрөө түүнийг
--    зөрчихгүйн тулд тэмдгийг нь БИЧСЭНГҮЙ — задлагч тайлбар доторх
--    тэмдгийг ч ялгадаггүй).  Энэ файл: 1 хүснэгт + 6 индекс.

CREATE TABLE IF NOT EXISTS compliance_findings (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,

  -- Клиентийн GUID.  Idempotency: сүлжээ тасарч дахин илгээвэл давхардахгүй.
  finding_uid         TEXT    NOT NULL,

  -- ХААНА.  doc_uid нь ProjectInformation.UniqueId (0187-ийн орон зай).
  project_id          INTEGER,
  doc_uid             TEXT    NOT NULL,
  session_id          INTEGER,

  -- ХЭН.  §57 «team» + өөрийгөө харах зангуу.
  detected_by         INTEGER NOT NULL,
  owner_team_code     TEXT,

  -- ЮУ.  §57 rule_id + rule version + ямар багцаар шалгав.
  rule_uid            TEXT    NOT NULL,
  rule_version        INTEGER NOT NULL DEFAULT 1,
  ruleset_version     TEXT    NOT NULL DEFAULT '',
  pack_sha256         TEXT,
  semantic_hash       TEXT,

  -- ГУРВАН ЗЭРЭГЦЭЭ ТЭНХЛЭГ.  ХЭЗЭЭ Ч нэгтгэхгүй (complianceModel.ts).
  verdict             TEXT    NOT NULL CHECK (verdict IN ('PASS','WARNING','VIOLATION','UNCERTAIN')),
  issue_class         TEXT    NOT NULL CHECK (issue_class IN ('REGULATORY_VIOLATION','MODEL_QUALITY','PROJECT_INCOMPLETENESS','TEAM_STANDARD','UNKNOWN_NEEDS_REVIEW')),
  evidence_level      TEXT    NOT NULL CHECK (evidence_level IN ('RULE_BACKED','MODEL_DERIVED','HUMAN_VERIFIED','AI_INFERRED','UNKNOWN')),
  severity            TEXT    NOT NULL CHECK (severity IN ('CRITICAL','HIGH','MEDIUM','LOW','INFO')),

  -- §57 амьдралын мөчлөг.  STALE нь ЭНД БАЙХГҮЙ — доорх stale_at.
  lifecycle_state     TEXT    NOT NULL DEFAULT 'OPEN' CHECK (lifecycle_state IN ('OPEN','ACKNOWLEDGED','FIXED','REOPENED','DISMISSED','INVALIDATED','UNCERTAIN')),

  -- sha256(rule_uid || 0x00 || element_uid)[:16].
  -- ⚠️ ruleset_version ЭНД ОРОХГҮЙ.  Оруулбал pack дахин нийтлэх бүрт
  --    компани даяар бүх acknowledgement өнчирч, §76-ийн ядаргаа нь
  --    яг л засвар үйлчилгээний үйлдлээс үүснэ.
  -- ⚠️ detected_by ч бас ЭНД ОРОХГҮЙ — тэр нь ТУСДАА багана ба АМЬД
  --    ТӨЛӨВИЙН ИНДЕКСИЙН гишүүн (доорх idx_cf_dedup-ийг үз).  Түлхүүр
  --    дотор нь оруулбал `2-4`-ийн compliance_notice_state.dedup_key
  --    (нэг хэрэглэгч — нэг түлхүүр) хоёр талдаа өөр утга болно.
  dedup_key           TEXT    NOT NULL,

  -- §63 / §64.  Яагаад мэдэхгүй байна, ямар дүрмүүд зөрчилдөв.
  coverage            TEXT    NOT NULL DEFAULT 'full' CHECK (coverage IN ('full','partial')),
  uncertain_reason    TEXT,
  conflict_rule_uids_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(conflict_rule_uids_json)),

  -- §57 «calculation» — оролт бүр НЭГЖ ба ГАРАЛ ҮҮСЛИЙН хамт (§62/§4.4).
  calc_json           TEXT    NOT NULL DEFAULT '{}' CHECK (json_valid(calc_json)),
  -- §57 «evidence» + «source» — document_uid, clause, edition, effective_from,
  -- boundary_location, түвшний нэрс.  ⚠️ UNVERIFIED дүрэм код ХЭВЛЭХГҮЙ (2-2).
  evidence_json       TEXT    NOT NULL DEFAULT '{}' CHECK (json_valid(evidence_json)),
  -- §57 «recommended correction».
  recommendation_mn   TEXT,

  -- §57 «model state» + §56-ийн 2-4 асуулт.
  model_state_hash    TEXT,
  scan_generation     INTEGER NOT NULL DEFAULT 0,

  first_detected_at   TEXT    NOT NULL,
  last_evaluated_at   TEXT    NOT NULL,
  resolved_at         TEXT,

  -- §58.  Найман дахь төлөв БИШ — түр тэмдэг.
  stale_at            TEXT,
  stale_reason        TEXT,
  ack_rule_version    INTEGER,

  updated_at          TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_cf_uid
  ON compliance_findings (finding_uid);

-- ⚠️ АМЬД ТӨЛӨВИЙН ТҮЛХҮҮР.  Нэг баримт дээр нэг ИЛРҮҮЛЭГЧ × нэг дүрэм ×
-- нэг элемент = НЭГ мөр.  Дахин үнэлгээ нь INSERT биш UPSERT — тиймээс
-- §56-ын «одоо юу буруу байна» нь бүлэглэлгүй энгийн SELECT болно.
--
-- ⚠️ `detected_by` нь ТҮЛХҮҮРИЙН ГИШҮҮН, ба энэ нь ЗААВАЛ.  Шалтгаан нь
--    хэмжигдсэн: `RevitTools.DocUid` (`RevitTools.cs:134-138`) нь
--    `doc.ProjectInformation.UniqueId`-ыг буцаадаг ба тэр нь ТӨВ загварын
--    ЛОКАЛ ХУУЛБАР БҮРТ ИЖИЛ (`:128-133`-ын өөрийнх нь сануулгыг үз).
--    Тиймээс нэг төв файл дээр ажиллаж буй ХОЁР BA инженер ижил дүрмийг
--    ижил элемент дээр үнэлэхэд `(doc_uid, dedup_key)` нь ЯГ ИЖИЛ болно:
--    UPSERT нь НЭГ мөрийг булаацалдаж, `detected_by` нь сүүлд илгээсэн
--    хүн рүү шилжиж, нөгөө инженерийн `detected_by = viewer.sub`
--    жагсаалтаас олдвор нь ЧИМЭЭГҮЙ АЛГА БОЛНО.  §2.6-д тэмдэглэсэнчлэн
--    worksharing нь ЭНЭ фирмийн ХЭВИЙН горим, ирмэгийн тохиолдол БИШ.
--
-- ⚠️ ҮР ДАГАВАР, УНШИГЧДАД: нэг элемент дээр хоёр хүний ижил олдвор нь
--    ХОЁР мөр болно.  (а) `GET /state` ба ribbon-ы тоолуур нь өөрийгөө
--    харах тул зөв, (б) `2-7` §3.3-ын БАГИЙН асуулга нь `dedup_key`-ээр
--    НЭГТГЭХ ёстой (§3.12-ын тэмдэглэлийг үз), (в) сервер нь тэдгээрийг
--    `finding_edges(kind='duplicates')`-ээр холбоно (§3.12).
CREATE UNIQUE INDEX IF NOT EXISTS idx_cf_dedup
  ON compliance_findings (doc_uid, detected_by, dedup_key);

CREATE INDEX IF NOT EXISTS idx_cf_open
  ON compliance_findings (project_id, lifecycle_state, severity)
  WHERE lifecycle_state IN ('OPEN','REOPENED','UNCERTAIN');

CREATE INDEX IF NOT EXISTS idx_cf_self
  ON compliance_findings (detected_by, last_evaluated_at);

CREATE INDEX IF NOT EXISTS idx_cf_stale
  ON compliance_findings (doc_uid, stale_at) WHERE stale_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_cf_rule
  ON compliance_findings (rule_uid, ruleset_version);
```

### 3.3 Migration `0225_finding_links.sql` (7 statement) ба `0229_rule_run_ledger.sql` (4 statement) — ХОЁУЛАА ШИНЭ

```sql
-- =============================================================
-- 0225_finding_links.sql — олдвор ↔ элемент / баг / олдвор холбоосууд
-- =============================================================
-- ЗОРИЛГО: §57 «affected element(s)» ОЛОН тоо, §60-R3 «affected teams»
-- ОЛОН тоо, §77 root-cause ГРАФ.  Гурвуулаа ОЛОН-ОЛОН харьцаа тул
-- багана биш ХОЛБОХ ХҮСНЭГТ.
--
-- ⚠️ REFERENCES ЗАРЛАХГҮЙ (0224-ийн шалтгаан).  Хүүхдийг ГАРААР устгана —
--    repo-ийн заншил (email.ts, calendar.ts, pgp.ts, repair.ts).
-- ⚠️ ТЭЭВЭР: 3 хүснэгт + 4 индекс = 7 statement.
--
-- ⚠️ ГУРВУУЛАНГИЙН ҮЙЛДВЭРЛЭГЧ НЬ `POST /api/compliance/findings` (§3.12).
--    Хүснэгт үүсгээд бичигчийг нь нэрлэхгүй орхивол `2-7` §3.3-ын
--    `INNER JOIN finding_teams` нь ЭЗЭМШИГЧ БАГТ Ч ХООСОН буцаана, §77-ийн
--    граф МӨНХ ХООСОН үлдэнэ, `2-0` §3.4-ийн 9-р шалгуур хангагдахгүй.
--    Аль мөрийг ХЭЗЭЭ бичихийг §3.12-ын «ЗААВАЛ бичих холбоос» хэсэг ЯГ
--    тодорхойлов — тэр нь энэ файлын гэрээний салшгүй хэсэг.

CREATE TABLE IF NOT EXISTS finding_elements (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  finding_id    INTEGER NOT NULL,
  -- ⚠️ ТОГТВОРТОЙ түлхүүр (0204:105).  element_id нь ТОГТВОРГҮЙ.
  element_uid   TEXT    NOT NULL,
  -- Зөвхөн ЭНЭ сессийн доторх хурдан `doc.GetElement` хайлтад.
  element_id    INTEGER,
  category      TEXT    NOT NULL DEFAULT '',
  level_name    TEXT    NOT NULL DEFAULT '',
  -- subject = дүрэм үүн дээр ажилласан, context = хэмжилтэд оролцсон
  -- (ж: хонгилын өргөнийг тодорхойлсон хоёр ханын хос).
  role          TEXT    NOT NULL DEFAULT 'subject' CHECK (role IN ('subject','context')),
  created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS finding_teams (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  finding_id    INTEGER NOT NULL,
  -- ⚠️ КОД, id БИШ (0069-ийн заншил: баг дахин үрлэгдэхэд мөр амьд үлдэнэ).
  team_code     TEXT    NOT NULL,
  relation      TEXT    NOT NULL CHECK (relation IN ('owner','affected','responsible')),
  created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS finding_edges (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  from_finding_id  INTEGER NOT NULL,
  to_finding_id    INTEGER NOT NULL,
  -- §77 root-cause, §76-R3 бүлэглэл, §64 зөрчил.
  kind             TEXT    NOT NULL CHECK (kind IN ('causes','duplicates','conflicts_with')),
  created_at       TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_fe_uniq
  ON finding_elements (finding_id, element_uid);

CREATE INDEX IF NOT EXISTS idx_fe_elem
  ON finding_elements (element_uid);

CREATE UNIQUE INDEX IF NOT EXISTS idx_ft_uniq
  ON finding_teams (finding_id, team_code, relation);

CREATE UNIQUE INDEX IF NOT EXISTS idx_fedge_uniq
  ON finding_edges (from_finding_id, to_finding_id, kind);
```

**ХОЁР ДАХЬ ФАЙЛ — `0229_rule_run_ledger.sql`.** ЯАГААД ТУСДАА ФАЙЛ ВЭ: 0225 нь аль хэдийн ЯГ 7 statement, өөрөөр хэлбэл тээврийн дүрмийн ХЯЗГААР ДЭЭР. Нэг индекс нэмэхэд л файл хагас хэрэгжиж, `d1_migrations` мөр БИЧИГДЭХГҮЙ.

```sql
-- =============================================================
-- 0229_rule_run_ledger.sql — §61-ийн ГҮЙЛТИЙН БҮРТГЭЛ
-- =============================================================
-- ЗОРИЛГО: «энэ дүрэм ҮНЭХЭЭР ажиллав уу» гэдгийг ХАДГАЛАХ.
--
-- ⚠️ ЯАГААД ЭНЭ ХҮСНЭГТ ЗААВАЛ ВЭ: `NOT_APPLICABLE` нь ОЛДВОРЫН МӨР
--    БОЛЖ ХЭЗЭЭ Ч ХУВИРАХГҮЙ (§3.1-ийн `NOT_APPLICABLE_IS_NOT_A_ROW`).
--    Тиймээс «хэзээ ч ажиллаагүй дүрэм» ба «бүрэн нийцсэн загвар» хоёр
--    ЯГ ИЖИЛ харагдана: тэг олдвор, ногоон хаалт.  BA-гийн хонгилын
--    дүрэм өрөө хиллээгүйгээс `clear_width_mm`-ыг уншиж чадалгүй чимээгүй
--    унтарвал инженер «хянахад бэлэн» гэж тэмдэглэнэ.  Энэ хүснэгт бол
--    §69-ийн ногоон-ыг ТАТГАЛЗАХ цорын ганц нотолгоо.
--
-- ⚠️ ЗӨВХӨН НЭГТГЭСЭН.  Элементийн id, өрөөний нэр, ХЭРЭГЛЭГЧИЙН id
--    ЭНД БАЙХГҮЙ — 0201:23-32 / 0203:27 / 0205:44-ийн «зөвхөн өөрийгөө
--    харах» дүрэм.  Тоолуурууд нь дүрэм × сессийн НЭГТГЭЛ.
--
-- ⚠️ REFERENCES ЗАРЛАХГҮЙ (0224-ийн шалтгаан).
-- ⚠️ ТЭЭВЭР: 1 хүснэгт + 3 индекс = 4 statement.

CREATE TABLE IF NOT EXISTS rule_run_ledger (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,

  -- ХААНА.  ⚠️ `project_id` нь ЗААВАЛ: `2-7` §3.6-ийн гурван SQL бүгд
  -- `WHERE project_id = ?1` гэж шүүнэ.  `session_id`-аар `bim_sessions`
  -- руу JOIN хийвэл унших маршрут бүр нэмэлт холболт төлнө.
  project_id       INTEGER,
  doc_uid          TEXT    NOT NULL DEFAULT '',
  session_id       INTEGER,
  scan_generation  INTEGER NOT NULL DEFAULT 0,

  -- ЮУ.  `rule_uid` нь `rules.rule_uid` (2-2)-тай нэрээр холбогдоно.
  rule_uid         TEXT    NOT NULL,
  ruleset_version  TEXT    NOT NULL DEFAULT '',
  pack_sha256      TEXT,

  -- ГУРВАН ТООЛУУР.  considered >= applicable >= evaluated ҮРГЭЛЖ.
  considered       INTEGER NOT NULL DEFAULT 0,
  applicable       INTEGER NOT NULL DEFAULT 0,
  evaluated        INTEGER NOT NULL DEFAULT 0,

  -- ⚠️ `applicable = 0` бол ЯАГААД гэдгийг ЭНД бичнэ, эс тэгвээс §69
  -- «хэзээ ч ажиллаагүй»-г ялгаж чадахгүй.  Утгууд: no_category,
  -- missing_params, missing_context, boundary_location, budget_abort.
  skipped_reason   TEXT,

  -- Үнэлгээ ХАТУУ таслагдсан удаа (EvalAbortMs).  > 0 бол §69 НОГООН БИШ.
  aborted          INTEGER NOT NULL DEFAULT 0,

  created_at       TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_rrl_project
  ON rule_run_ledger (project_id, rule_uid, id DESC);

CREATE INDEX IF NOT EXISTS idx_rrl_rule
  ON rule_run_ledger (rule_uid, ruleset_version, id DESC);

CREATE INDEX IF NOT EXISTS idx_rrl_skipped
  ON rule_run_ledger (project_id, skipped_reason) WHERE skipped_reason IS NOT NULL;
```

⚠️ **ЭНЭ ХҮСНЭГТИЙГ УНШИГЧИД:** `2-7` §3.6-ийн гурван SQL (`rows_total`, `expected_but_inapplicable`, `aborted`), §60-ийн цоорхойн жагсаалт (`skipped_reason = 'no_category' | 'missing_params'`) ба §69-ийн «Team checks: n/n». `2-7` нь ямар ч migration АВАХГҮЙ тул хүснэгт ЭНД төрөх ёстой; ногоон/улаан ШИЙДВЭР нь `2-7`-ынх.

⚠️ **§69-ийн «Team checks: n/n»-ийн ХУВААРЬ нь ТУХАЙН ТӨСӨЛ ДЭЭРХ баг × pack БАЙГАА, литерал 8 БИШ** (**ЭЗЭН БАТАЛСАН, 2026-08-30**). Эзний баталсан найман дисциплин Л pack авна (`MGMT` / `EZ` / `GT` авахгүй — v2 §46, §3.5), ба тэдгээр нь BA-гаас эхлэн ЭЭЛЖЛЭН бичигдэнэ. Иймд хуваарь нь **төсөл дээр ажиллаж буй багуудаас pack бичигдсэн нь** — pack хүлээж буй баг нь хуваарь БОЛОН хүртвэр ХОЁУЛАНГААС нь гарна. Хуваарийг 8 гэж хатуу бичвэл BA л бэлэн байхад төсөл бүр мөнхийн «1/8» харуулж, хаалт ХЭЗЭЭ Ч ногоон болохгүй. `rule_run_ledger`-т мөр огт үлдээгээгүй баг нь тоологдохгүй; ШИЙДВЭР нь `2-7`-ынх, энэ баримт зөвхөн тэр гэрээг тогтоов.

### 3.4 Хувирамтгай байдлын НӨХӨН ТӨЛБӨР — дүгнэлт бүр үйл явдал болно

§2.9-д батлагдсанчлан `compliance_findings` нь UPDATE-тэй. Аудитын мөрийг хоёр аргаар нөхнө, **хоёулаа ЗААВАЛ**:

1. `finding_overrides` — өөрийн append-only trigger-тэй, `2-5` эзэмшинэ.
2. **Дүгнэлт ӨӨРЧЛӨГДӨХ БҮРТ** нэг `learning_events` мөр, `kind = 'RULE_VALIDATION'`.

⚠️ **«ҮНЭЛГЭЭ БҮРТ» БИШ, «ТӨЛӨВ ӨӨРЧЛӨГДӨХ БҮРТ».** Ижил дүгнэлтийг дахин үйлдвэрлэсэн үнэлгээ нь ЮУ Ч БИЧИХГҮЙ. Шалтгаан нь арифметик: 2000 элементийн буулгалт × 5 хамаарах BA дүрэм = нэг цонхонд 10 000 мөр → `txn_batch_max = 200` (`0208:27`) тул 50 POST → `EVENT_ROWS_PER_STATEMENT = 4` (`bimEvents.ts:503`) тул ~2 500 INSERT statement; дөчин удаа Ctrl+Z дарвал ижил элементүүд дахин бохирдож үүнийг дөч дахин давтана. Хэмжигдээгүй үйл явдлын хурд ба бүх ERP-тэй хуваалцсан 10 ГБ D1 дээр энэ нь зөвшөөрөгдөхгүй.

Payload-ийн ЯГ хэлбэр (`v1:RULE_VALIDATION+RULE_VERDICT`):

```jsonc
{
  "rule_id":            "BA-HR-CORRIDOR-W-001",   // ⚠️ ЗААВАЛ — 0209:27-ын VIRTUAL багана
  "passed":             false,                     // ⚠️ ЗААВАЛ — bimEvents.ts:741-ийн хоёр дахь нөхцөл
  "finding_uid":        "…",
  "verdict":            "VIOLATION",
  "prev_verdict":       "PASS",                    // null бол ШИНЭ олдвор
  "lifecycle_state":    "OPEN",
  "issue_class":        "REGULATORY_VIOLATION",
  "evidence_level":     "MODEL_DERIVED",
  "severity":           "HIGH",
  "coverage":           "full",
  "uncertain_reason":   null,
  "scan_generation":    41,

  // ⚠️ БИЧИХ ҮЕДЭЭ ХӨЛДӨӨНӨ.  learning_events нь UPDATE хийж БОЛОХГҮЙ тул
  //    (0206:43-55) эдгээрийг хожим JOIN-оор шийдэх нь түүхийг ЧИМЭЭГҮЙ
  //    дахин шошголно.  2-1 нь эдгээрийг VIRTUAL багана болгоно.
  "verification_state": "UNVERIFIED",
  "rule_version":       1,
  "ruleset_version":    "2026-09-01.1",
  "pack_sha256":        "…",
  "team_code":          "BA",
  "team_source":        "binding",
  "attribution_id":     123,

  "element_uid":        "…",
  "doc_uid":            "…"
}
```

⚠️ `verification_state = 'UNVERIFIED'` (2-2-ийн clamp) нь дүгнэлтийг дээд тал нь `WARNING` болгож, `evidence_level`-ийг `MODEL_DERIVED` болгож, **эшлэлийг далдална**. Тиймээс энэ payload-ийн `verdict` нь `2-2`-ийн clamp-ийг ДАМЖИЖ ГАРСАН утга байх ёстой — clamp-ийг энд ДАХИН хэрэгжүүлэхгүй.

### 3.5 §52 — ДҮРМИЙН ГОХНЫ ИНДЕКС (§51-R3-ийн механик хариу)

§51-R3: «Revit-ийн үйл явдал бүрийн дараа зохицуулалтын БҮХ дүрмийн санг ажиллуулж БОЛОХГҮЙ». Механик хариу нь pack ачаалахад НЭГ УДАА баригддаг индекс:

```csharp
// revit-mcp/addin/ComplianceScheduler.cs  (ШИНЭ) — индексийн хэсэг

/// <summary>
/// Дүрмийн ГОХНЫ ИНДЕКС — «энэ категорийн энэ өөрчлөлт ямар дүрмийг
/// ХӨДӨЛГӨЖ БОЛОХ вэ» гэдгийг ХАЙЛТ болгоно (§52-R3/R4).
///
/// ⚠️ ЯАГААД ИНДЕКС ВЭ: 8 багийн pack × ~40 дүрэм = ~320 дүрэм.  Бохирдсон
/// элемент бүрд бүх дүрмийг тойрвол 400 элемент × 320 = 128 000 хамаарлын
/// шалгалт болно — §51-R3-ийн шууд зөрчил.  Индекстэй бол элемент бүр НЭГ
/// толь бичгийн хайлт: ихэвчлэн 0-3 нэр дэвшигч.
///
/// ⚠️ НЭГ УДАА баригдана — pack солигдоход л дахин.  Индекс барих нь
/// Revit-ийн API-д ХҮРЭХГҮЙ (`RuleDef` нь цэвэр өгөгдөл).
///
/// ⚠️ PACK БАЙХГҮЙ БАГ = ТЭГ ДҮРЭМ.  `Build` нь ЗӨВХӨН тухайн сессийн
/// багийн pack-ыг авна.  Pack ирээгүй бол индекс ХООСОН үлдэж,
/// `Candidates` нь үргэлж хоосон буцаана — өөр багийн pack, «компани
/// даяарын» нэгтгэсэн pack, эсвэл ямар нэг ӨГӨГДМӨЛ дүрмийн багц руу
/// ХЭЗЭЭ Ч ШИЛЖИХГҮЙ.  §3.6-ийн ШАТ 0-ийн хаалтыг үз.
/// </summary>
internal sealed class RuleTriggerIndex
{
    // (Revit категорийн ЭХ нэр, change) → нэр дэвшигч дүрмүүд.
    // ⚠️ Категорийн нэр нь Revit-ийн ХЭЛНЭЭС хамаарна (0204:110-ийн дүрэм) —
    //    орчуулахгүй, ЭХ хэлбэрээр нь түлхүүрлэнэ.
    private readonly Dictionary<(string Category, string Change), List<RuleDef>> _byTrigger
        = new Dictionary<(string, string), List<RuleDef>>();

    // Гох зарлаагүй дүрэм — ЗӨВХӨН бүтэн скан дээр ажиллана.
    private readonly List<RuleDef> _fullScanOnly = new List<RuleDef>();

    public string PackSha256 { get; private set; }
    public string RulesetVersion { get; private set; }

    public static RuleTriggerIndex Build(RulePack pack)
    {
        var ix = new RuleTriggerIndex
        {
            PackSha256 = pack.PackSha256,
            RulesetVersion = pack.RulesetVersion,
        };
        foreach (RuleDef r in pack.Rules)
        {
            // `requires.triggered_by` = [{category, change}]  (2-2-ийн формат)
            if (r.TriggeredBy == null || r.TriggeredBy.Count == 0)
            {
                ix._fullScanOnly.Add(r);
                continue;
            }
            foreach (RuleTrigger t in r.TriggeredBy)
            {
                var k = (t.Category ?? "", t.Change ?? "modify");
                if (!ix._byTrigger.TryGetValue(k, out List<RuleDef> list))
                {
                    list = new List<RuleDef>();
                    ix._byTrigger[k] = list;
                }
                list.Add(r);
            }
        }
        return ix;
    }

    /// <summary>Бохирдсон элементийн (категори, өөрчлөлт) → нэр дэвшигчид.</summary>
    public IReadOnlyList<RuleDef> Candidates(string category, string change)
    {
        return _byTrigger.TryGetValue((category ?? "", change ?? "modify"), out List<RuleDef> list)
            ? list
            : (IReadOnlyList<RuleDef>)Array.Empty<RuleDef>();
    }

    public IReadOnlyList<RuleDef> FullScanOnly => _fullScanOnly;

    /// <summary>Гох ба бүтэн-скан хоёулаа хоосон = ЭНЭ багт pack БАЙХГҮЙ
    /// (§3.6-ийн ШАТ 0, §3.11-ийн NO-OP).  «Дүрэм тэг» ба «pack тэг» хоёрыг
    /// ялгах ЦОРЫН ГАНЦ туг.</summary>
    public bool IsEmpty => _byTrigger.Count == 0 && _fullScanOnly.Count == 0;
}
```

⚠️ **«8 багийн pack» нь ТӨЛӨВЛӨЛТИЙН тоо, КОДОД БИЧИГДЭХ тоо БИШ** (**ЭЗЭН БАТАЛСАН, 2026-08-30**). Эзэн pack бичих багуудыг ЭЦЭСЛЭВ: «MGMT-ийг хасаад үлдсэн 8-н багийг оруулна». `teams.sort_order`-ийн дарааллаар: **BA** Барилга архитектур · **BB** Барилга бүтээц · **HAS** Халаалт агаар сэлгэлт · **TSBU** Цэвэр бохир ус · **TSAH** Цахилгаан · **HD** Холбоо дохиолол · **AU** Автомат удирдлага · **IZ** Интерьер зураг (v2 §46). Гэвч `teams` хүснэгтэд **АРВАН НЭГ** мөр байна: `0007_teams.sql:39-47` нь энэ наймыг + `MGMT`-ыг үрлэдэг, `0074_seed_ez_gt_teams.sql:12-14` нь блок-угтварын хоёр баг `EZ` (Эскиз зураг) ба `GT` (Гадна тохижилт) нэмнэ. Баталгаажсан найм нь `frontend/src/features/projects/team-reports/TeamReportsTab.tsx:52-61`-ийн `IMPLEMENTED_TEAMS`-тэй ЯГ ИЖИЛ олонлог — өөрөөр хэлбэл нийлүүлэгдсэн UI үүнийг аль хэдийн хэрэгжүүлсэн. **`MGMT`, `EZ`, `GT` нь pack АВАХГҮЙ ба нийцлийн шалгалт ХИЙГДЭХГҮЙ**: `teams`-д байгаа боловч pack-ийн бүртгэлд байхгүй баг нь `TEAM = UNCERTAIN` (v2 §48) болж, **ЮУГААР Ч** шалгагдахгүй — өөр багийн дүрмээр ХЭЗЭЭ Ч БИШ. ⚠️ Иймд наймыг `ComplianceScheduler`, `routes/compliance.ts`, эсвэл ямар нэг SQL `CHECK`-т ХАТУУ БИЧИХГҮЙ: `owner_team_code` нь ажиллах үедээ `teams.code`-оос уншигдана (§9.2 №5).

⚠️ **BA нь ЭХНИЙ БҮРЭН PACK** (**ЭЗЭН БАТАЛСАН, 2026-08-30**) ба үлдсэн долоог түүний бүтцээр бичнэ. Шалтгаан нь хэмжигдсэн: `frontend/src/features/projects/team-reports/ba/` хавтас нь **12 БНбД эшлэл** агуулна (`template.ts`, `types.ts`, `BaDocument.tsx`) — аль ч салбарынхаас том бэлэн үр, тиймээс ажиллагаатай pack хүртэлх ХАМГИЙН БОГИНО зам. **IZ нь эзний дараалалд ХОЁРДУГААРТ** (эзэн нэрлэсэн), гэвч `iz/` хавтасд БНбД эшлэл **ТЭГ** (`template.ts`, `types.ts`, `IzPanel.tsx`, `IzDocument.tsx` — дөрвүүлээ 0) тул IZ-ийн pack нь загвараас ХУРААГДАХГҮЙ, норм каталогоос ШИНЭЭР бичигдэнэ. Энэ бол pack хөтөлбөрийн ГОЛ хуваарийн эрсдэл. **Энэ хөдөлгүүрт үзүүлэх шууд үр дагавар:** эхний релизүүдэд ЗӨВХӨН BA сессид pack байх ба бусад бүх багийн сесс ХУУЛЬ ЁСООР тэг дүрэм үнэлнэ — тэр нь алдаа БИШ.

**§52-R3-ийн зургаан зарлалт ба энэ загварт хаана нь очих:**

| §52-R3 зарлалт | Хаана | Хэрхэн ашиглагдана |
|---|---|---|
| required element types | `rules.applicability_json` `element.category` (2-2) | `RuleTriggerIndex` барихад түлхүүр |
| required parameters | `rules.requires_json.params` (2-2) | `collect_rule_inputs`-ийн нэхэмжлэл — байхгүй бол `UNCERTAIN(missing_input)` |
| required relationships | `requires_json.relations` (2-2) — ж: `host`, `boundary` | `RuleFactExtractor` нь `host_uid`, `GetBoundarySegments` |
| required project context | `requires_context` (2-2, `project.height_m` г.м.) | pack-тай хамт ирдэг `project_build_context`; байхгүй бол `PROJECT_INCOMPLETENESS` |
| triggering changes | `requires_json.triggered_by` | ЭНЭ индексийн түлхүүр |
| dependencies | `rule_deps` (2-2, 0224-ээс өмнөх migration) | §3.10-ийн хуучруулах шалтгаан `ruleset` |

### 3.6 `ComplianceScheduler.RunPass` — өсөлтөт МӨЧЛӨГИЙН БИЕ

⚠️ **THREAD нь `2-4`-ийнх.** Энэ метод нь `2-4`-ийн зориулалтын `IsBackground` ажилчин thread дээр, коалесцерийн хаасан `LogicalChangeSet`-ээр дуудагдана. `_flushTimer`-ийн callback дээр **ХЭЗЭЭ Ч** дуудагдахгүй (§0 №11).

```csharp
// revit-mcp/addin/ComplianceScheduler.cs  (ШИНЭ)

/// <summary>
/// НЭГ өсөлтөт мөчлөг.  §51-ийн 3-7-р шат.
///
/// ⚠️ ЭНЭ МЕТОД REVIT-ИЙН API-Д ХҮРЭХГҮЙ.  `Autodesk.Revit` төрлийг
/// НЭГ Ч удаа дурдахгүй — иймд `dotnet run`-аар Revit-гүйгээр тестлэгдэнэ
/// (`check_nudge.py` / `check_parity.py`-ийн заншил).  Revit-д хүрэх цорын
/// ганц хэсэг нь `collect_rule_inputs` хэрэгсэл, тэр нь ХҮЙТЭН эгнээгээр
/// Revit-ийн үндсэн thread рүү явна.
///
/// ⚠️ `ChangeTracker.Gate`-ийг ЭНД БАРИХГҮЙ.  `2-4` нь POCO хэлбэрээр
/// хуулбарыг өгсөн байна; энэ метод түгжээ хөндөхгүй (§0 №8).
///
/// ⚠️ `TryGetByKey` ЭНД ДУУДАГДАХГҮЙ — тэр нь 500 000 id-г `Gate` дотор
/// гүнзгий хуулна (`ChangeTracker.cs:412-443`, `:63`, `:74`) ба гүйлгээ
/// бүр өрсөлдөөн төлнө.  Тэр нь ЗӨВХӨН бүтэн скан (§3.11)-д.
/// </summary>
internal static class ComplianceScheduler
{
    /// <summary>Нэг мөчлөгт үнэлэх элементийн ДЭЭД тоо.</summary>
    /// <remarks>
    /// ⚠️ ЯАГААД 400 ВЭ: `collect_rule_inputs` нь дуудлага тутам <= 150
    /// элемент (§3.7) тул 400 нь ХАМГИЙН ИХ гурван зүсэлт.  `MaxPerSlice = 4`
    /// (`RevitToolBus.cs:440`) тул тэр гурав нь хэрэглэгчийн дуудлагатай
    /// ЭЭЛЖЛЭН орно.  Илүү нь дараагийн мөчлөгт үлдэнэ — алдагдахгүй,
    /// зөвхөн хойшилно (ХҮЙТЭН эгнээ нь ХАМГИЙН САЙН ХИЧЭЭХ).
    /// </remarks>
    private const int MaxDirtyPerPass = 400;

    /// <summary>Нэг мөчлөгийн үнэлгээний ЗӨӨЛӨН төсөв (мс).</summary>
    private const int EvalSoftBudgetMs = 250;
    /// <summary>Нэг мөчлөгийн үнэлгээний ХАТУУ таслалт (мс) → coverage=partial.</summary>
    private const int EvalAbortMs = 2000;

    internal static PassResult RunPass(LogicalChangeSet set, RuleTriggerIndex index,
                                       ComplianceState state, ProjectBuildContext ctx)
    {
        var result = new PassResult { ScanGeneration = state.NextScanGeneration() };

        // ── ШАТ 0.  PACK БАЙХГҮЙ БАГ → ТЭГ ДҮРЭМ ──────────────────────
        // v2 §46-ийн найман дисциплин Л pack авна (MGMT / EZ / GT авахгүй)
        // ба тэдгээр нь BA-гаас эхлэн ЭЭЛЖЛЭН бичигдэнэ.  Индекс хоосон бол
        // ЯМАР Ч дүрэм ажиллуулахгүй: ӨӨР БАГИЙН pack, «компани даяарын»
        // нэгтгэсэн pack, эсвэл BA-г ӨГӨГДМӨЛ болгох нь ГУРВУУЛАА ХОРИОТОЙ.
        // `ledger` нь ХООСОН явна (мөр огт БИЧИГДЭХГҮЙ) — `rule_run_ledger`-т
        // тэр багийн мөр байхгүй нь «энэ багт pack БАЙХГҮЙ» гэдгийг §69-д ил
        // гаргах дохио (§3.3-ийн уншигчийн тэмдэглэл).  `NoPack` нь КЛИЕНТИЙН
        // талын туг: ribbon-ы бичээс тоо БИШ, «дүрмийн багц бэлэн болоогүй»
        // гэж хэлнэ (§3.11) — чимээгүй тэг нь эвдэрсэн мэт харагдана.
        if (index == null || index.IsEmpty) { result.NoPack = true; return result; }

        // ── ШАТ 3.  НӨЛӨӨЛСӨН ЭЛЕМЕНТ ────────────────────────────────
        // ⚠️ `set` нь 2-4-ийн коалесцерээс ирсэн ХУУЛБАР.  Энд Revit-д
        //    хандахгүй: категори/түвшин нь HOT замд аль хэдийн бичигдсэн.
        IReadOnlyList<DirtyElement> dirty = set.Elements;
        if (dirty.Count > MaxDirtyPerPass)
        {
            dirty = Slice(dirty, MaxDirtyPerPass);
            result.Coverage = "partial";      // §56-ийн «дутуу шалгасан»
            state.CarryOver(set, MaxDirtyPerPass);
        }
        // `ChangeTracker`-ийн хязгаар хэтэрсэн бол ҮНЭН нь МЭДЭГДЭХГҮЙ.
        if (set.Truncated || set.MetaTruncated) result.Coverage = "partial";

        // ── ШАТ 4.  НӨЛӨӨЛЖ БОЛОХ ДҮРЭМ (индексийн хайлт, скан БИШ) ───
        var work = new Dictionary<string, List<RuleDef>>(StringComparer.Ordinal);
        foreach (DirtyElement d in dirty)
        {
            IReadOnlyList<RuleDef> cands = index.Candidates(d.Category, d.Change);
            if (cands.Count == 0) continue;

            foreach (RuleDef r in cands)
            {
                // ⚠️ §61-R3 — ХАМААРЛЫГ ГҮЙЦЭТГЭХЭЭС ӨМНӨ тогтооно.  Хамаарахгүй
                //    бол МӨР ҮҮСГЭХГҮЙ (NOT_APPLICABLE нь мөр биш) — гэхдээ
                //    бүртгэлд «considered» гэж тоологдоно (§3.12).
                result.Ledger.Considered(r.RuleUid);
                if (!RuleApplicability.MayApply(r, d, ctx, out string skip))
                {
                    result.Ledger.Skipped(r.RuleUid, skip);
                    continue;
                }
                result.Ledger.Applicable(r.RuleUid);
                Add(work, d.ElementUid, r);
            }
        }
        if (work.Count == 0) return result;   // ХЭВИЙН тохиолдол, алдаа БИШ

        // ── ШАТ 5а.  ХҮЙТЭН: баримт цуглуулах (Revit-ийн үндсэн thread) ──
        // ⚠️ `TryCall` (2-4) нь `Gate.Wait(0)` — өрсөлдөөн бол SKIP.
        //    Skip нь ХЭВИЙН: хэрэглэгч ажиллаж байна, дараагийн мөчлөгт авна.
        FactSet facts = RuleInputs.CollectViaBus(work, out bool skipped, out bool morePending);
        if (skipped) { result.Skipped = true; return result; }
        if (morePending) result.Coverage = "partial";

        // ── ШАТ 5б.  ҮНЭЛГЭЭ (цэвэр, Revit-гүй — 2-2-ийн хөдөлгүүр) ─────
        var sw = System.Diagnostics.Stopwatch.StartNew();
        foreach (KeyValuePair<string, List<RuleDef>> kv in work)
        {
            if (sw.ElapsedMilliseconds > EvalAbortMs)
            {
                result.Coverage = "partial";
                result.Ledger.Aborted();
                break;
            }
            foreach (RuleDef r in kv.Value)
            {
                RuleOutcome o = RuleEngine.Evaluate(r, facts.For(kv.Key));   // 2-2
                result.Ledger.Evaluated(r.RuleUid);

                // ── ШАТ 6.  ОЛДВОР (зөвхөн ТӨЛӨВ ӨӨРЧЛӨГДВӨЛ) ──────────
                state.Apply(kv.Key, r, o, result.ScanGeneration, result);
            }
        }
        Metrics.RuleEval.Add(sw.Elapsed.TotalMilliseconds);

        // ── ШАТ 7.  МЭДЭГДЭЛ — ЗӨВХӨН RIBBON-Ы БИЧЭЭС.  Push БАЙХГҮЙ. ──
        // ⚠️ `DockablePane.Show()` ХЭЗЭЭ Ч дуудагдахгүй (§0 №9).
        //    `Dispatcher.Invoke` ХЭЗЭЭ Ч дуудагдахгүй (§0 №10) — тоо нь
        //    ХҮЙТЭН эгнээгээр `set_compliance_badge` хэрэгслээр очно (2-4).
        result.BadgeCount = state.OpenCount();
        return result;
    }
}
```

⚠️ **ШАТ 0 нь §46-ийн шууд үр дагавар, оптимизаци БИШ** (**ЭЗЭН БАТАЛСАН, 2026-08-30**). Сессийн баг нь `teams`-д байгаа боловч pack бичигдээгүй (`MGMT`, `EZ`, `GT`, эсвэл дараалалдаа хүрээгүй дисциплин) бол энэ мөчлөг **ТЭГ дүрэм** үнэлж, **тэг олдвор** гаргана. ⚠️ **Энэ нь `TEAM = UNCERTAIN` (v2 §48) БИШ** — канон тодорхойлолт нь `2-1 §3.4`. Тэнд илрүүлэлт УНАСАН (`team_code = NULL`) байдаг; ЭНД илрүүлэлт **амжилттай**, баг нь ТОДОРХОЙ, `team_code` нь бодит `MGMT`/`EZ`/`GT` бөгөөд `learning_events` тэр кодоор шошгологдоно. Өөрөөр хэлбэл «мэдэхгүй» биш — **мэдэж байгаа, гэхдээ тулгах дүрэм нь бичигдээгүй**. Хэрэглэгчээс ЮУ Ч шаардахгүй (залруулах зүйл алга), зөвхөн шалгалт алгасагдана. ХОРИОТОЙ гурван «засвар»: (1) өөр багийн pack-аар унших, (2) бүх дүрмийг нэгтгэсэн «компани даяарын» pack, (3) BA-г ӨГӨГДМӨЛ болгох. Гуравуулаа нэг л зүйл үйлдвэрлэнэ — цахилгаанчинд архитектурын хонгилын дүрмээр гаргасан `VIOLATION` — ба тэр нь §58-ын хуучирсан олдвортой ЯГ ижил байдлаар инженерийн итгэлийг нэг удаад устгана.

**ЯАГААД «алгасах» нь хэвийн вэ.** `RevitToolBus.Gate` (`:134`) нь чат, QTO ба энэ хөдөлгүүрийн ХАМТЫН семафор, ба `CallCore` нь deadline-ийг `Gate.Wait`-ийн ӨМНӨ эхлүүлдэг (`:266`). Хэрэв дэвсгэрийн дуудлага түгжээг бүтэн deadline-ээрээ барьвал хэрэглэгчийн дараагийн «Зураг холбох» (`list_sheets`, 30 с) нь `:288`-ын «өмнөх үйлдэл дуусаагүй байна» гэсэн алдаа авна. **Хэн ч гуйгаагүй боломж нь хүмүүсийн хэрэглэдэг боломжийг ХЭЗЭЭ Ч эвдэж болохгүй.** 90 секунд хоцорсон олдвор нь хүлээн зөвшөөрөгдөнө.

### 3.7 `collect_rule_inputs` — ЦОРЫН ГАНЦ Revit-д хүрэх хэрэгсэл

`RevitTools.cs`-д хоёр цэгийн засвар:

| # | Файл:мөр | Өөрчлөлт |
|---|---|---|
| 1 | `RevitTools.cs:54-65` | `ToolNames` массивт `"collect_rule_inputs"` нэмнэ (11 дэх) |
| 2 | `RevitTools.cs:76-93` | `switch`-д `case "collect_rule_inputs": return RuleFactExtractor.Collect(doc, args);` |
| 3 | `RevitApi.cs:489-514` | `TimeoutFor`-д `case "collect_rule_inputs": return 10;` — **гадаад** timeout |

⚠️ `RevitTools.cs:33-52`-ын TWIN сануулгыг дага: `AgentChat.ToolSpecs()` / `ClientAllowedTools` / `lib/revitAgent.ts ALLOWED_TOOLS` / `mgl_agent.py ALLOWED` нь ХЭРЭГЛЭГЧИЙН чатын гарц. **`collect_rule_inputs` нь тэдгээрийн АЛЬ НЬ Ч ОРОХГҮЙ** — энэ бол дотоод, машины хэрэгсэл; LLM-д нээвэл хэрэглэгчийн нэрийн өмнөөс дурын элемент уншина.

```csharp
// revit-mcp/addin/RuleFactExtractor.cs  (ШИНЭ)

/// <summary>
/// Дүрмийн ОРОЛТЫГ Revit-ээс уншина.  ЦОРЫН ГАНЦ Revit-д хүрэх хэсэг.
///
/// ⚠️ ХАРАГДАЦЫН ХАМРАХ ХҮРЭЭТЭЙ COLLECTOR ХОРИОТОЙ.  `ChangeReport.cs:31-38`
/// нь Revit-д «энэ элемент энэ харагдацад харагдаж байна уу» гэж хямдхан
/// асуух API БАЙХГҮЙ гэдгийг реф ассемблиэс шалгаж тэмдэглэсэн ба тэр нь
/// 2026-08-25-ны 120 секундын гацааны шалтгаан.  Энд ЗӨВХӨН
/// `doc.GetElement(uid/id)` ба БАРИМТЫН хамрах хүрээтэй collector.
///
/// ⚠️ ДОТООД ТӨСӨВ ЗААВАЛ.  `RevitToolBus.cs:474`-ийн `Abandoned` шалгалт нь
/// ГҮЙЦЭТГЭХИЙН ӨМНӨ л ажилладаг — `RevitTools.Run` эхэлмэгц цуцлалт
/// БАЙХГҮЙ.  Дуудагчийн timeout нь ДУУДАГЧИЙГ хамгаална, Revit-ийг БИШ.
/// Иймд `change_digest` (4 с) ба `goto_element` (2.5 с)-ийн заншлаар
/// ДОТООД `Stopwatch` deadline тавина.
/// </summary>
internal static class RuleFactExtractor
{
    /// <summary>Нэг дуудлагад уншиж болох элементийн ХАТУУ дээд тоо.</summary>
    private const int MaxElementsPerCall = 150;
    /// <summary>Дотоод deadline (мс).  Хэтэрвэл ХЭСЭГЧИЛСЭН үр дүн + курсор.</summary>
    private const int InternalBudgetMs = 1500;

    /// <summary>
    /// args: { "items": [ { "uid": "...", "facts": ["clear_width_mm","length_m"] } ],
    ///         "cursor": 0 }
    /// буцаах: { "facts": { "<uid>": { "<name>": {v, unit, src, spec, missing} } },
    ///           "doc": { "room_boundary_location": "Finish" },
    ///           "more": true, "cursor": 150, "checked": 150 }
    /// </summary>
    internal static string Collect(Document doc, JsonElement args)
    {
        var sw = System.Diagnostics.Stopwatch.StartNew();
        // ... (2-2-ийн `Quantity` бүтэц: Value / Unit / Missing / Source / SpecId)
        //
        // ⚠️ `Round3OrNull` (`QtoExtractor.cs:528-534`) ДАХИН АШИГЛАХГҮЙ —
        //    тэр нь бодит ТЭГИЙГ NULL болгодог ба §63 нь `zero` ба
        //    `missing input`-ыг ТУСДАА шалгуур болгож нэрлэдэг.
        //
        // ⚠️ Уншиж ЧАДААГҮЙ баримт нь `missing = true` гэж БУЦНА — таамаглал
        //    БАЙХГҮЙ.  Хөдөлгүүр түүнийг `UNCERTAIN` болгоно, `PASS` БИШ.
        //
        // ⚠️ Өрөөний геометр: `AreaVolumeSettings`-ийн хилийн байрлалыг УНШИЖ
        //    `doc.room_boundary_location` баримт болгоно.  «Finish» биш бол
        //    өрөөний геометрийн дүрэм ХАМААРАХГҮЙ (2-2-ийн applicability) —
        //    ХУДАЛ PASS гаргахаас хамаагүй дээр.
        //
        // ⚠️ Холбоос (RevitLinkInstance) дотор геометрийн дүрэм АЖИЛЛАХГҮЙ:
        //    `GetTotalTransform()` нь add-in-ийн 46 файлын АЛЬ НЬ Ч БАЙХГҮЙ
        //    (шалгасан) тул шилжсэн/эргэсэн холбоос чимээгүй буруу тоо өгнө.
        //
        // Давталт бүрийн эхэнд: if (sw.ElapsedMilliseconds > InternalBudgetMs)
        //                          → { more = true, cursor = i } гэж БУЦНА.
        return "";  // бодит хэрэгжилт: §6-ийн шалгуурыг хангах
    }
}
```

### 3.8 §3.9-ийн ДҮРЭМ: үнэлж чадаагүй нь ХЭЗЭЭ Ч зөрчил биш

`RuleEngine.Evaluate` (2-2) нь `RuleOutcome`-ыг буцаана. Энэ хөдөлгүүрийн хатуу дүрэм:

| Нөхцөл | `verdict` | `issue_class` | `uncertain_reason` |
|---|---|---|---|
| Оролт байхгүй (параметр олдсонгүй) | `UNCERTAIN` | `UNKNOWN_NEEDS_REVIEW` | `missing_input` |
| Утга нь бодит 0 (хэмжсэн тэг) | ердийн харьцуулалт | дүрмээр | — |
| Утга байхгүй ба 0 ялгагдахгүй | `UNCERTAIN` | `UNKNOWN_NEEDS_REVIEW` | `zero_vs_missing` |
| Параметр төрөлгүй (`untyped_param`) | `UNCERTAIN` | `MODEL_QUALITY` | `mixed_provenance` |
| Нэгж таарахгүй (`Quantity.RequireSame` шидэв) | `UNCERTAIN` | `UNKNOWN_NEEDS_REVIEW` | `mixed_units` |
| Төслийн контекст дутуу (`project.height_m` алга) | `UNCERTAIN` | `PROJECT_INCOMPLETENESS` | `missing_context` |
| Хоёр хамаарах дүрэм зөрчилдөв (§64) | `UNCERTAIN` | `UNKNOWN_NEEDS_REVIEW` | `conflict` (+`conflict_rule_uids_json`) |
| Өрөөний хилийн байрлал «Finish» биш | мөр ҮҮСГЭХГҮЙ | — | бүртгэлд `boundary_location` |
| Үнэлгээний төсөв дуусав | мөр ҮҮСГЭХГҮЙ | — | бүртгэлд `budget_abort`, `coverage=partial` |
| Бүх оролт бүрэн, нөхцөл хангагдав | `PASS` | дүрмээр | — |
| Бүх оролт бүрэн, нөхцөл ЗӨРЧИГДӨВ, дүрэм `HUMAN_VERIFIED`/`CLAUSE_CITED` | `VIOLATION` | `REGULATORY_VIOLATION` | — |
| … дүрэм `UNVERIFIED` | `WARNING` (2-2-ийн clamp) | `TEAM_STANDARD` | — |

### 3.9 `ComplianceState` — амьд төлөв, dedup, төлөв ӨӨРЧЛӨГДӨХ илрүүлэлт

```csharp
// revit-mcp/addin/ComplianceState.cs  (ШИНЭ)

/// <summary>
/// НЭГ БАРИМТЫН амьд нийцлийн төлөв (§56).  Санах ойд, дискэнд толин
/// тусгалтай, серверт илгээгддэг.
///
/// ⚠️ Дискний бичилт нь `ChangeTracker.FlushDirty`-ийн ЗАНШЛЫГ дагана:
/// түр файл → `File.Move` (`ChangeTracker.cs:577-581`).  ГЭХДЭЭ түр файлын
/// нэрэнд ПРОЦЕССЫН id нэмнэ (`<key>.<pid>.json.tmp`): нэг PC дээр Revit
/// 2024 ба 2027 зэрэг нээлттэй байвал `%APPDATA%` ХУВААЛЦАГДДАГ ба
/// детерминист нэр нь хоёр процессыг мөргөлдүүлнэ.
/// </summary>
internal sealed class ComplianceState
{
    /// <summary>dedup_key → одоогийн олдвор.  §56-ийн «одоо юу буруу байна».</summary>
    private readonly Dictionary<string, FindingRow> _live =
        new Dictionary<string, FindingRow>(StringComparer.Ordinal);

    private int _scanGeneration;

    /// <summary>
    /// §56-ийн 2-4 асуултын ЦОРЫН ГАНЦ механизм.
    ///
    /// ⚠️ ЯАГААД ЦАГ ХАНГАЛТГҮЙ ВЭ: «шинээр гарсан зөрчил» ба «бид дөнгөж
    /// хармагцаа анх удаа харагдсан зөрчил» хоёрыг timestamp ЯЛГАЖ ЧАДАХГҮЙ.
    /// Үеийн тоолуур нь «энэ мөр аль сканд төрөв» гэдгийг хэлнэ.
    /// </summary>
    public int NextScanGeneration() => ++_scanGeneration;

    /// <summary>
    /// Дүгнэлт хүлээж авна.  ⚠️ ТӨЛӨВ ӨӨРЧЛӨГДСӨН, ҮҮССЭН, эсвэл
    /// ШИЙДЭГДСЭН үед Л мөр илгээнэ (§3.4).  Ижил дүгнэлт → ЮУ Ч БИШ.
    /// </summary>
    public void Apply(string elementUid, RuleDef rule, RuleOutcome o,
                      int generation, PassResult result)
    {
        string key = DedupKey(rule.RuleUid, elementUid);   // sha256(uid \0 elem)[:16]

        if (!_live.TryGetValue(key, out FindingRow prev))
        {
            if (o.Verdict == Verdict.Pass) return;         // PASS дээр мөр үүсгэхгүй
            FindingRow row = FindingRow.Create(key, elementUid, rule, o, generation);
            _live[key] = row;
            result.Emit(row, prevVerdict: null);            // ҮҮССЭН
            return;
        }

        // §58 — хуучирсан тэмдгийг үргэлж арилгана: дахин тооцоолол дууслаа.
        prev.StaleAt = null;
        prev.StaleReason = null;
        prev.LastEvaluatedAt = Iso.Now();
        prev.ScanGeneration = generation;

        if (prev.Verdict == o.Verdict && prev.Severity == o.Severity)
        {
            // ⚠️ ИЖИЛ ДҮГНЭЛТ — сервер рүү ЮУ Ч ЯВАХГҮЙ.  Энэ нь мөрийн
            //    тэсрэлтээс хамгаалах ГОЛ хамгаалалт (§3.4-ийн арифметик).
            return;
        }

        Verdict was = prev.Verdict;
        prev.Verdict = o.Verdict;
        prev.Severity = o.Severity;

        if (o.Verdict == Verdict.Pass)
        {
            // §56 «аль нь засагдав».  Мөрийг УСТГАХГҮЙ — түүхээ хадгална.
            prev.LifecycleState = LifecycleState.Fixed;
            prev.ResolvedAt = Iso.Now();
        }
        else if (prev.LifecycleState == LifecycleState.Fixed)
        {
            prev.LifecycleState = LifecycleState.Reopened;   // §57 REOPENED
            prev.ResolvedAt = null;
        }
        result.Emit(prev, prevVerdict: was);                 // ӨӨРЧЛӨГДСӨН
    }

    /// <summary>
    /// §58 — ХУУЧРУУЛАХ.  ГУРВАН гох (§3.10), гурвуулаа ЗААВАЛ.
    /// Хуучирсан мөр нь «одоогийн дүгнэлт» гэж ХЭЗЭЭ Ч харагдахгүй ба
    /// бэлэн байдлын хаалтад ТООЛОГДОХГҮЙ.
    /// </summary>
    public void MarkStale(Func<FindingRow, bool> predicate, string reason)
    {
        string now = Iso.Now();
        foreach (FindingRow r in _live.Values)
        {
            if (!predicate(r)) continue;
            r.StaleAt = now;
            r.StaleReason = reason;      // sync | edit | ruleset | central
        }
    }

    public int OpenCount()
    {
        int n = 0;
        foreach (FindingRow r in _live.Values)
        {
            if (r.StaleAt != null) continue;                       // хуучирсан нь тоологдохгүй
            if (r.LifecycleState == LifecycleState.Open ||
                r.LifecycleState == LifecycleState.Reopened) n++;
        }
        return n;
    }
}
```

### 3.10 §58 — хуучруулах ГУРВАН гох, гурвуулаа ЗААВАЛ

| # | Гох | Хаанаас | `stale_reason` | Яагаад ЗААВАЛ |
|---|---|---|---|---|
| 1 | `Suppressed.Remove(key)` — sync / reload-latest дууслаа | `ChangeTracker.cs:633`, `:715` | `sync` | `OnDocumentChanged` нь Suppressed цонхонд `:801` дээр ЭРТ БУЦДАГ тул бусад багийн өөрчлөлт бохирдсон олонлогт ХЭЗЭЭ Ч ОРОХГҮЙ. Энэ гохгүйгээр BA нь BB-ийн аль хэдийн зассан хонгил дээр `VIOLATION` (эсвэл BB-ийн дөнгөж эвдсэн хонгил дээр `PASS`) харсаар байна |
| 2 | Олдворын элемент коалесцлагдсан олонлогт ДАХИН гарч ирэв | `2-4`-ийн `LogicalChangeSet` | `edit` | Хэрэглэгчийн өөрийн засвар. `ChangeTracker` үүнийг ҮНЭГҮЙ өгнө: `Depth` 0 болоход элемент хасагдана (`:195-206`) ба `op_name` нь `undo:` угтвартай (`:753`) |
| 3 | Сервер: `ruleset_version` / дүрмийн `semantic_hash` / `central_path_hash`-ийн үе өөрчлөгдөв | `routes/compliance.ts` | `ruleset` / `central` | Дүрэм өөрөө өөрчлөгдвөл өмнөх дүгнэлт нь ӨӨР асуултын хариу |

⚠️ **ГОХ БҮРИЙН ГҮЙЦЭТГЭГЧ — нэрлээгүй бол хэрэгжихгүй.** `ComplianceState.MarkStale` (§3.9) нь ЗӨВХӨН САНАХ ОЙД тэмдэглэдэг; тэр нь D1 дээрх `stale_at`-д ХЭЗЭЭ Ч хүрэхгүй. Тиймээс:

| Гох | Клиент талд ХЭН дуудна | Сервер рүү ЮУГААР хүрнэ |
|---|---|---|
| 1 `sync` | `ComplianceScheduler`-ийн мөчлөг → `state.MarkStale(r => r.DocKey == key, "sync")`. ⚠️ Дохиог `2-4` ӨГӨХ ЁСТОЙ: `Suppressed.Add`/`Remove` нь `ChangeTracker.cs:622/:633/:715`-д, тэр файл нь **`2-4`-ийн харьяа** ба өнөөгийн `LogicalChangeSet` (`2-4` §3.8) дээр ийм туг БАЙХГҮЙ — §9.5 №16 | `POST /api/compliance/findings/stale` `{doc_uid, reason:'sync'}` — `dedup_keys` ҮГҮЙ, өөрөөр хэлбэл ТЭР БАРИМТЫН БҮГД (§3.12) |
| 2 `edit` | Ижил мөчлөг, коалесцлагдсан олонлогийн элемент нь `_live`-ийн олдворын элементтэй таарвал. ⚠️ Тааруулалт нь `element_uid`-ээр явна, харин `LogicalChangeSet.ElementIds` нь `long[]` — §9.5 №14-ийн гэрээ ЭНД ЧУХАЛ | Ижил маршрут, `{reason:'edit', dedup_keys:[…]}` — ЗӨВХӨН таарсан түлхүүрүүд |
| 3 `ruleset` / `central` | Клиент ОГТ оролцохгүй | `GET /projects/:id/state`-ийн УНШИХ ҮЕИЙН харьцуулалт (§3.12). Cron БИШ |

⚠️ **Undo-ийн тэсрэлт.** `op_name`-ийн `undo:` угтвар байх зуур дахин үнэлгээ ХОЙШЛОГДОНО; тэсрэлт тогтворжсоны дараа НЭГ УДАА үнэлнэ. Үгүй бол дөчин Ctrl+Z нь дөчин дахин үнэлгээ болно.

### 3.11 БҮТЭН СКАН — хэзээ ажиллах вэ

Өсөлтөт скан нь §52-R2-ийн ӨГӨГДМӨЛ. Бүтэн скан нь **ЗӨВХӨН ДӨРВӨН нөхцөлд**, бүгд нь хэрэглэгчийн санаачилсан эсвэл өдөрт нэг удаагийн:

| # | Гох | Яагаад |
|---|---|---|
| 1 | Хэрэглэгч «Нийцлийг бүрэн шалгах» товч дарав | Тодорхой хүсэлт — хүлээхийг мэдэж байна |
| 2 | Pack-ийн `ruleset_version` өөрчлөгдөв | Шинэ дүрэм нь өмнө нь хөндөгдөөгүй элементэд хамаарч болно |
| 3 | `RuleTriggerIndex.FullScanOnly` хоосон биш ба энэ баримт дээр хэзээ ч ажиллаагүй | Гох зарлаагүй дүрэм өсөлтөт замд ХЭЗЭЭ Ч ажиллахгүй |
| 4 | `2-7`-ийн бэлэн байдлын хаалт нээгдэв | §69-ийн тоолуур бүтэн хамралт шаардана |

⚠️ **Pack байхгүй бол ДӨРВҮҮЛЭЭ NO-OP.** Бүтэн скан ч §3.6-ийн ШАТ 0-ийн хаалтыг дамжина: `RuleTriggerIndex.IsEmpty` үед «Нийцлийг бүрэн шалгах» товч ч тэг дүрэм ажиллуулж, тэг олдвор гаргана — өөр багийн pack руу ШИЛЖИХГҮЙ. Гох №3 (`FullScanOnly` хоосон биш) ба гох №2 (`ruleset_version` солигдов) хоёр нь pack ОРШИН БАЙХЫГ шаарддаг тул pack-гүй багт ГАЛЛАХ ЁСГҮЙ. ⚠️ Товч нь **алга болохгүй** — хэрэглэгчид «Энэ багт дүрмийн багц хараахан бэлэн болоогүй» гэж ХЭЛНЭ; чимээгүй юу ч болохгүй байх нь эвдэрсэн мэт харагдана (v2 §46-ийн pack дараалал: BA эхлээд, IZ хоёрдугаарт).

**Файл нээх үед бүтэн скан ХЭЗЭЭ Ч АЖИЛЛАХГҮЙ.** `AutoBaseline` (`ChangeTracker.cs:669`) нь `DocumentOpened` дээр аль хэдийн баримтын хамрах хүрээтэй collector (`RevitTools.ElementCount`) БОЛОН синхрон `FlushDirty` ажиллуулдаг; тэнд нийцлийн скан нэмэх нь шууд файл нээх хугацаан дээр буух ба §53-ын хамгийн харагдах зөрчил болно.

Бүтэн скан нь **ЦОРЫН ГАНЦ** `TryGetByKey` дуудагч (§2.4): нэг удаа гүнзгий хуулбар аваад, `Truncated` / `MetaTruncated` тугийг `coverage`-д тусгаад, `MaxDirtyPerPass` зүсэлтээр гүйнэ.

### 3.12 §56 — АМЬД ТӨЛӨВИЙН УНШИХ API

`backend/src/routes/compliance.ts` (ШИНЭ), угтвар `/api/compliance`.

⚠️ **Бүртгэл:** `lib/modules.ts`-д `API_PREFIXES`-т `'/api/compliance'`, `MODULE_OF`-д `'/api/compliance': 'learning'` нэмнэ (`:122`, `:246`-ийн заншил). Ангилаагүй угтвар нь `entitlementGuard`-ыг ШАЛГАЛТГҮЙ дамждаг. `lib/workerScope.ts`-ийн `WORKER_ALLOWED_PREFIXES` (`:18-33`) -д **НЭМЭХГҮЙ** — тэр нь хаалттай-анхдагч цагаан жагсаалт тул `worker` автоматаар 403 авна. `index.ts`-д `app.route('/api/compliance', compliance);` (`:217`-ийн `/api/learning`-ийн хажууд).

⚠️ **MCP twin ХИЙХГҮЙ.** `learning.ts:37-58` нь `/mcp` нь `workerScopeGuard`, `entitlementGuard` ба tenant `tid` шалгалтыг ЗЭРЭГ тойрдог тул энэ гэр бүлийг тэнд гаргахыг ХОРИГЛОДОГ.

Эрх: `requireRole('engineer','architect','senior','admin')` — `learning.ts:83`-ийн `LEARNING_ROLES`-той ЯГ ИЖИЛ.

**§56-ийн долоон асуулт → нэг хариу:**

```
GET /api/compliance/projects/:id/state?doc_uid=…&since_generation=N
```

```jsonc
{
  "scan_generation": 41,
  "as_of": "2026-08-30T09:12:03Z",

  // 1. Одоо юу буруу байна?  (өөрөө харах эсвэл НЭГТГЭСЭН — §2.9-ийн дүрэм)
  "open": { "CRITICAL": 0, "HIGH": 2, "MEDIUM": 5, "LOW": 1, "INFO": 0 },

  // 2. Сүүлийн скангаас хойш юу өөрчлөгдөв?
  "changed_since": 6,

  // 3. Аль нь ШИНЭЭР гарав?   first_detected_at-ийн scan_generation > since
  "newly_introduced": [ { "finding_uid": "…", "rule_uid": "…", "severity": "HIGH" } ],

  // 4. Аль нь ЗАСАГДАВ?       lifecycle_state = 'FIXED' AND scan_generation > since
  "fixed": [ { "finding_uid": "…", "rule_uid": "…" } ],

  // 5. Аль нь ҮЛДСЭН?         OPEN|REOPENED, scan_generation <= since
  "remaining": 3,

  // 6. Аль хэсэг нь ТОДОРХОЙГҮЙ хэвээр?
  "uncertain": [ { "finding_uid": "…", "reason": "missing_context", "rule_uid": "…" } ],

  // 7. Дотоод хяналтад бэлэн үү?  ⚠️ 2-7 эзэмшинэ — энд зөвхөн ТҮҮХИЙ оролт.
  //    «баталгаажлаа» гэсэн үг ХЭЗЭЭ Ч БИЧИГДЭХГҮЙ (§69-R3).
  "readiness_inputs": {
    "stale_count": 0,
    "partial_coverage_passes": 1,
    "rules_considered": 84, "rules_applicable": 31, "rules_evaluated": 31,
    "unpublished_pack": false,
    // ⚠️ Баг ШИЙДЭГДЭЭГҮЙ (uncertain) сессээс ирсэн, тиймээс `finding_teams`-д
    //    `owner` мөргүй олдворууд.  Тэднийг багийн харагдац ХЭЗЭЭ Ч харуулахгүй —
    //    ЭНЭ тоолуур нь тэдгээрийг ЧИМЭЭГҮЙ АЛГА БОЛОХООС хамгаална (§3.12).
    "unattributed_findings": 0
  }
}
```

⚠️ **`readiness_inputs.rules_*` нь ГҮЙЛТИЙН БҮРТГЭЛЭЭС ирнэ.** `NOT_APPLICABLE` нь мөр үлдээдэггүй тул «хэзээ ч ажиллаагүй дүрэм» ба «бүрэн нийцсэн загвар» ялгагдахгүй. Хуваарилагч мөчлөг бүрд НЭГТГЭСЭН (элементийн id-гүй) бүртгэл гаргана — `POST /api/compliance/findings`-ийн `ledger` блок дотор:

```jsonc
"ledger": [
  { "rule_uid": "BA-HR-CORRIDOR-W-001",
    "considered": 12, "applicable": 4, "evaluated": 4,
    "skipped_reason": null, "aborted": 0 },
  { "rule_uid": "IZ-HR-CEIL-H-001",
    "considered": 9, "applicable": 0, "evaluated": 0,
    "skipped_reason": "boundary_location", "aborted": 0 }
]
```

Энэ payload-ийн ХЭЛБЭР **ба түүнийг хадгалах `rule_run_ledger` хүснэгт (§3.3, `0229`) хоёулаа ЭНЭ баримтынх.** `POST /api/compliance/findings` нь `ledger` блок бүрийг тэр хүснэгтэд НЭГТГЭСЭН мөр болгон INSERT хийнэ — элементийн id, хэрэглэгчийн id БАЙХГҮЙ. §69-ийн ногоон/улаан ШИЙДВЭР нь `2-7`-ынх; тэр сесс дугаар авдаггүй тул хүснэгтийг ЭНД үүсгэхээс өөр газар байхгүй.

**Бусад маршрут:**

| Маршрут | Эрх | Тайлбар |
|---|---|---|
| `POST /api/compliance/findings` | LEARNING_ROLES | Add-in-ээс багц UPSERT (`ON CONFLICT (doc_uid, detected_by, dedup_key)`) + `finding_elements` + `finding_teams` + `finding_edges` + `ledger` + `learning_events` мөр. Багц дээд тал нь 200 (`0208:27`-ийн `txn_batch_max`-тай нэг мөр), payload дээд тал нь 16 КБ/мөр |
| `POST /api/compliance/findings/stale` | LEARNING_ROLES | §58-ын 1 ба 2-р гохын СЕРВЕР ТАЛ. `{doc_uid, reason, dedup_keys?}` → `stale_at` бөглөнө. Доорхыг үз |
| `GET /api/compliance/findings` | LEARNING_ROLES | **ЗӨВХӨН `detected_by = viewer.sub`** — ЭЛЕМЕНТИЙН ТҮВШНИЙ жагсаалт. Өөр хүний олдвор ХЭЗЭЭ Ч |
| `PATCH /api/compliance/findings/:finding_uid` | LEARNING_ROLES | `lifecycle_state` шилжилт. `ALLOWED_TRANSITIONS`-оор шалгана, зөрчвөл 409. `DISMISSED` рүү шилжих нь `2-5`-ийн override-гүйгээр ХОРИОТОЙ (400) |
| `GET /api/compliance/projects/:id/state` | LEARNING_ROLES | Дээрх. Клиент бол `project_members` шалгана |

⚠️ `POST /findings` дээр серверийн ЗААВАЛ хийх ажил:
1. `detected_by` нь **токеноос** (`c.get('user').sub`), клиентээс ХЭЗЭЭ Ч (`learning.ts:338-340`-ийн заншил).
2. `dedup_key`-г сервер ДАХИН тооцоолж, клиентийнхтэй таарахгүй бол 400.
3. Дүгнэлт өөрчлөгдсөн мөр бүрд `learning_events` мөр — `lib/bimEvents.ts`-ийн бичих гарцаар. **`compliance.ts` нь `learning_events`-д ШУУД SQL БИЧИХГҮЙ** (`backend/scripts/check-bim-events.mjs` grep-ээр барина).
4. **Гурван холбоос хүснэгтэд бичих** — доорх «ЗААВАЛ бичих холбоос».

**Хүсэлтийн БИЕ (`POST /findings`) — холбоосын хэсэг нь СОНГОЛТ БИШ:**

```jsonc
{
  "doc_uid": "…", "project_id": 12, "session_id": 88,
  "scan_generation": 41,
  "team_code": "BA",                       // сессийн ШИЙДЭГДСЭН баг (2-1)
  "items": [
    {
      "finding_uid": "…", "dedup_key": "…", "rule_uid": "BA-HR-CORRIDOR-W-001",
      "verdict": "VIOLATION", "prev_verdict": "PASS",
      // ⚠️ ОЛОН ТООГООР.  §57 «affected element(s)» нь ганц тоо БИШ.
      //    subject = дүрэм үүн дээр ажилласан (>= 1 ЗААВАЛ),
      //    context = хэмжилтэд оролцсон (хонгилын өргөнийг тодорхойлсон
      //    ханын хос, өрөөг хиллэсэн хана, түвшин).
      "elements": [
        { "element_uid": "…", "element_id": 918273, "category": "Rooms",
          "level_name": "3", "role": "subject" },
        { "element_uid": "…", "category": "Walls", "role": "context" },
        { "element_uid": "…", "category": "Walls", "role": "context" }
      ]
    }
  ],
  "ledger": [ /* §3.12-ын дээрх блок */ ]
}
```

⚠️ **`elements[]` ХООСОН бол 400.** `role='subject'` мөргүй олдвор нь `goto_element` хийх юмгүй, хуучруулах гох №2 (§3.10) нь тааруулах элементгүй, `2-5`-ийн жагсаалт нь заах юмгүй болно. Клиент нь `calc_json`-д оролцсон бүх элементийг аль хэдийн барьдаг тул энэ нь нэмэлт Revit уншилт ҮҮСГЭХГҮЙ.

**ЗААВАЛ бичих холбоос — сервер, ижил багц гүйлгээнд:**

| Хүснэгт | Хэзээ | Юу | Хэн тооцоолов |
|---|---|---|---|
| `finding_elements` | олдвор бүрд | `items[].elements[]`-ийг мөр мөрөөр, `INSERT OR IGNORE` (`idx_fe_uniq`) | КЛИЕНТ өгнө, сервер шалгана |
| `finding_teams` `relation='owner'` | баг ШИЙДЭГДСЭН олдвор бүрд, ЯГ НЭГ | `(finding_id, <сессийн team_code>, 'owner')`. `team_code` нь `bim_sessions`-оос (`2-1`), клиентийн мэдүүлгээс БИШ | СЕРВЕР |
| `finding_teams` `relation='affected'` | салбар хоорондын зөрчил илрэхэд | Зөрчилдөгч ДҮРМИЙН баг (`rules.team_code`, `2-2`) — ХОЁУЛАА мөр авна | СЕРВЕР |
| `finding_teams` `relation='responsible'` | `rule_conflicts.precedence` нь `a_wins`/`b_wins` үед Л | ЯЛСАН дүрмийн баг. `precedence IS NULL` эсвэл `'unknown'` бол мөр БИЧИХГҮЙ — v2 §64 «hierarchy IF KNOWN» | СЕРВЕР |
| `finding_edges` `kind='causes'` | доорх дүрмээр | `(from = ҮНДЭС, to = ҮР ДАГАВАР)` | СЕРВЕР |
| `finding_edges` `kind='conflicts_with'` | доорх дүрмээр | Хоёр чиглэлд НЭГ мөр (a→b) | СЕРВЕР |
| `finding_edges` `kind='duplicates'` | доорх дүрмээр | Нэг төв загвар дээрх хоёр инженерийн ижил олдвор | СЕРВЕР |

⚠️ **`owner` мөр нь баг ШИЙДЭГДСЭН олдвор бүрд ЯМАР Ч НӨХЦӨЛГҮЙ бичигдэнэ.** Хэрэв сессийн баг `uncertain` (`team_code IS NULL`, `2-1` §3.1) бол `owner` мөр БИЧИГДЭХГҮЙ ба тэр нь **ЗӨВ**: буруу багт хамааруулснаас харагдахгүй нь дээр. Гэхдээ энэ тохиолдол `readiness_inputs`-д `unattributed_findings` тоолуураар ИЛ гарна — «баг тодорхойгүй» нь ЧИМЭЭГҮЙ БАЙЖ БОЛОХГҮЙ.

**Ирмэг ГАРГАЖ АВАХ гурван дүрэм** (бүгд ДЕТЕРМИНИСТ, LLM БАЙХГҮЙ, багц бичигдсэний ДАРАА нэг удаа ажиллана). ⚠️ **Хамрах хүрээ:** ирмэг тус бүрийн НЭГ тал нь ЭНЭ багцад ирсэн олдвор байх ЁСТОЙ, нөгөө тал нь ижил `doc_uid` доторх аль ч олдвор байж болно. Ингэснээр өртөг нь `багцын хэмжээ × индексийн хайлт` (≤ 200 × 3) болно, бүтэн баримтын хөндлөн үржвэр БИШ — ба хоёр дахь инженер хожим илгээхэд ирмэг нь ХОЙШ БУС, тэр мөчид үүснэ. Бүгд `INSERT OR IGNORE` (`idx_fedge_uniq`) тул давтан илгээлт мөр НЭМЭХГҮЙ:

| Ирмэг | Предикат | Эх өгөгдөл |
|---|---|---|
| `causes` | Олдвор A-ийн `role='subject'` элемент нь олдвор B-ийн `role='context'` элементүүдийн дунд байвал → `(from=A, to=B)`. Хонгил→хаалга→өрөөний §77 гинж нь ЯГ ЭНЭ ХЭЛБЭР: хаалганы олдвор нь хонгилын өрөөг контекст болгон хэмжсэн байдаг | `finding_elements` (`idx_fe_elem`) |
| `conflicts_with` | Ижил `doc_uid` + ижил `element_uid` дээрх хоёр олдворын `rule_uid` хос нь `rule_conflicts`-д бүртгэлтэй (`scope` аль нь ч байсан) | `rule_conflicts` (`2-2`, 0222) |
| `duplicates` | Ижил `doc_uid` + ижил `dedup_key`, ӨӨР `detected_by` | `idx_cf_dedup`-ийн шинэ гурван баганат түлхүүр |

⚠️ **`causes` нь ХЭЗЭЭ Ч LLM-ээр таамаглагдахгүй.** Элементийн хамаарлаас гарахгүй ирмэг нь МӨР БОЛОХГҮЙ — граф хоосон байх нь буруу ирмэгээс дээр. §77-ийн бүрэн гүнзгий гинж (дүрэм → дүрэм зарлагдсан шалтгаан) нь `2-2`-ийн pack-д `caused_by_rule_uids` талбар нэмэхийг шаардана; тэр нь ЭНЭ сессийн хамрах хүрээнд БАЙХГҮЙ ба §9.5-д асуулт болж үлдэв.

⚠️ **Чиглэл нь уншигчдаар тогтоогдсон:** `2-7` §3.3 нь `COUNT(*) … WHERE e.to_finding_id = f.id AND e.kind='causes'`-ыг `caused_by_count` гэж уншина, `2-5` §3.3 нь `causes`-ийн дээгүүр ДЭЭШ явж үндсийг олно (`GET /findings/:id` → `root`), §3.4-ийн `FindingFeed` нь тэрхүү үндсээр бүлэглэнэ. Тиймээс **`from` = ҮНДЭС, `to` = ҮР ДАГАВАР.** Урвуулбал хоёулаа чимээгүй буруу болно.

**§58-ын СЕРВЕР ТАЛ — `POST /api/compliance/findings/stale`:**

```jsonc
// body: { "doc_uid": "…", "reason": "sync",            // STALE_REASONS-ийн нэг
//         "dedup_keys": ["…"] }                        // СОНГОЛТ; байхгүй бол
//                                                      // тухайн БАРИМТЫН БҮГД
// →  200 { "staled": 37 }
//
// UPDATE compliance_findings
//    SET stale_at = datetime('now'), stale_reason = ?2
//  WHERE doc_uid = ?1
//    AND detected_by = ?3            -- ⚠️ ЗААВАЛ: өөрийн мөрөө Л хуучруулна
//    AND stale_at IS NULL
//    AND lifecycle_state IN ('OPEN','REOPENED','UNCERTAIN','ACKNOWLEDGED')
```

⚠️ **ЯАГААД ТУСДАА МАРШРУТ ВЭ.** `POST /findings` нь ЗӨВХӨН клиентийн ДАХИН ИЛГЭЭСЭН мөрийг хөндөнө, харин хуучруулалтын БҮХ УТГА нь клиент яг одоо үнэлээгүй байгаа мөрүүдэд байна: BB нь sync хийхэд BA-ийн олдвор нь дахин үнэлэгдээгүй ЧИГЭЭРЭЭ эргэлзээтэй болно. UPSERT-ээр үүнийг илэрхийлэх арга БАЙХГҮЙ. Энэ маршрутгүйгээр `compliance_findings.stale_at` ба `idx_cf_stale` нь БИЧИГЧГҮЙ үлдэж, `2-7` §3.3-ын `AND f.stale_at IS NULL` шүүлт нь NO-OP болж, `2-0` §3.4-ийн 8-р шалгуур хангагдахгүй.

⚠️ **`detected_by = viewer.sub` шүүлт нь ЗААВАЛ** — эс тэгвээс нэг инженерийн «Reload Latest» нь тэр төв загвар дээр ажиллаж буй БҮХ хүний олдворыг саарал болгоно.

**Гурав дахь гох (`ruleset` / `central`) нь CRON БИШ, УНШИХ ҮЕД.** `GET /projects/:id/state` нь буцаахаасаа өмнө сонгосон мөрүүдийн `ruleset_version` / `semantic_hash` / `pack_sha256`-ыг ОДООГИЙН нийтлэгдсэн багцтай (`rule_pack_versions`, `2-2`) харьцуулж, зөрсөн мөрийг тэр газартаа `stale_reason='ruleset'` болгож UPDATE хийнэ. `central` нь `bim_sessions.central_path_hash` (`0202:62`) солигдоход ижил замаар. **Cron нэмэхгүй** — `wrangler.toml`-ийн `crons` дээр гурав дахь илэрхийлэл нэмбэл `index.ts`-ийн `scheduled` салаа нь дөрвөн ажлыг ДАВХАР ажиллуулна.

⚠️ **ӨӨРИЙГӨӨ ХАРАХ ба БАГИЙН ХАРАГДАЦ — хоёулаа хууль ёсны, ХИЛ НЬ ТОДОРХОЙ.** `GET /api/compliance/findings` (энэ файл) нь ЭЛЕМЕНТИЙН ТҮВШНИЙ жагсаалт тул `detected_by = viewer.sub`-ээр ХАТУУ хязгаарлагдана — `0201:23-32` / `0203:27` / `0205:44` ба `revitNoteAi.test.ts:262`-ын үл хөдлөх дүрэм. `2-7` §3.3-ын `GET /api/compliance/projects/:id/findings?team=<code>` нь ЗӨВШӨӨРӨГДӨНӨ, гэхдээ ГУРВАН нөхцөлтэй: (1) SELECT-д `detected_by` / `user_id` ОГТ БАЙХГҮЙ (`2-7` §3.3 үүнийг аль хэдийн зарласан), (2) хамрах хүрээ нь `finding_teams.team_code`, хүн БИШ, (3) **гишүүнчлэлийн хаалт**: `user_teams`-д тухайн `team_code` байх, эс бөгөөс `requireManager()` — эс тэгвээс аль ч инженер аль ч багийн олдворыг уншина (`2-0` §3.4-ийн 4-р шалгуурын зөрчил). Мөн тэр асуулга нь **`dedup_key`-ээр НЭГТГЭНЭ** (`idx_cf_dedup` нь одоо `detected_by`-г агуулна, §3.2), эс тэгвээс нэг төв загвар дээрх хоёр инженерийн ижил олдвор багийн жагсаалтад ХОЁР удаа гарна.

### 3.13 §63 — АРВАН ХОЁР ИРМЭГИЙН АНГИ (ЗӨВХӨН ТОДОРХОЙЛОЛТ, энэ сессид ХЭРЭГЖҮҮЛЭХГҮЙ)

§63 нь ӨНДӨР ҮНЭ ЦЭНЭТЭЙ дүрэм бүрд арван хоёр тест шаардана. Тэдгээр нь ГАРААР бичих зүйл БИШ — `rule_test_cases` (2-2-ийн хүснэгт) дээрх ГЕНЕРАТОРЫН БАЙГУУЛАМЖ. Ангиуд ба хүлээгдэх үр дүн:

| # | Анги (`rule_test_cases.case_class`) | Оролт | Хүлээгдэх |
|---|---|---|---|
| 1 | `threshold_minus` | 1499 мм, босго 1500 | `VIOLATION` (эсвэл clamp-аар `WARNING`) |
| 2 | `threshold` | 1500 мм | `PASS` (`gte` тул) |
| 3 | `threshold_plus` | 1501 мм | `PASS` |
| 4 | `zero` | 0 мм, ХЭМЖСЭН | `VIOLATION` — ⚠️ `UNCERTAIN` БИШ |
| 5 | `missing_input` | параметр байхгүй | `UNCERTAIN(missing_input)` |
| 6 | `invalid_input` | сөрөг өргөн, NaN | `UNCERTAIN(invalid_input)` |
| 7 | `min_max` | 1 мм ба 1e9 мм | Хэвийн дүгнэлт, онцгой байдал БИШ |
| 8 | `mixed_units` | м-ээр өгсөн утга мм босготой | `UNCERTAIN(mixed_units)` — `RequireSame` ШИДНЭ |
| 9 | `exception` | applicability-ийн үл хамаарах салаа | Мөр ҮҮСГЭХГҮЙ + бүртгэлд `skipped_reason` |
| 10 | `multi_rule` | нэг элемент, 2 хамаарах дүрэм, зөрчилгүй | ХОЁР тусдаа мөр |
| 11 | `conflict` | нэг элемент, 2 зөрчилдөх дүрэм | НЭГ мөр, `UNCERTAIN(conflict)`, `conflict_rule_uids_json` >= 2 |
| 12 | `no_context` | `project.height_m` байхгүй | `UNCERTAIN(missing_context)`, `PROJECT_INCOMPLETENESS` |
| +1 | `mixed_provenance` | `untyped_param` (Number storage) | `UNCERTAIN(mixed_provenance)` — **13 дахь, ЗААВАЛ** |

⚠️ **«Анги» багана нь `2-2`-ийн `0222_rule_conflicts_tests.sql`-ийн `rule_test_cases.case_class` CHECK-ийн БАЙТ ХҮРТЭЛ ИЖИЛ ТӨРӨӨС гарсан үгс**, ба `2-2` §3.11-ийн `REQUIRED_CASE_CLASSES = ['threshold_minus','threshold','threshold_plus','zero','missing_input']`-тэй мөн ижил. Бүтэн үгсийн сан (14): `threshold_minus`, `threshold`, `threshold_plus`, `zero`, `missing_input`, `invalid_input`, `min_max`, `mixed_units`, `mixed_provenance`, `exception`, `multi_rule`, `conflict`, `no_context`, `ordinary`. **Гурвуулаа ХАМТ хөдөлнө** — энд `threshold_minus_1` эсвэл `conflicting_rules` гэж бичих нь SQLite-ийн CHECK-т татгалзагдах мөр үйлдвэрлэдэг генератор бичихэд хүргэнэ, ба заавал ёстой таван анги ХЭЗЭЭ Ч таарахгүй.

⚠️ **`case_class` ба `uncertain_reason` нь ХОЁР ӨӨР үгсийн сан.** 12-р мөрийг үз: анги нь `no_context` (`2-2`-ынх), гарц нь `missing_context` (`complianceModel.ts`-ийн `UNCERTAIN_REASONS`, §3.1). Хоёрыг нэгтгэх гэж оролдвол аль нэг нь CHECK-ээ зөрчинө.

⚠️ **ЯАГААД ЭНЭ СЕССИД ХЭРЭГЖҮҮЛЭХГҮЙ ВЭ:**
1. Харнесс нь `RuleEngine`-ийг дуудна, тэр нь `2-2`-ынх — түүний гарын үсэг тогтоогүй байхад тест бичих нь хоёр удаа бичих ажил.
2. `rule_test_cases` хүснэгт нь `2-2`-ынх; түүнгүйгээр генераторт эх сурвалж алга.
3. Гэйтийн скрипт (`revit-mcp/training/check_rules.py`) нь энэ баримтын «Хөндөх файлууд»-д БАЙХГҮЙ. **Эзэмшигч нь `2-7` БИШ, `2-2`** — тэр файл нь `2-2`-ийн толгойн жагсаалтад бий, түүний §3.13 нь `Units.cs` + `RuleFacts.cs` + `RuleEngine.cs` гурвыг Revit-гүйгээр compile хийх харшийг тодорхойлсон, ба `2-2` §6-д «`python revit-mcp/training/check_rules.py` → 12/12» гэсэн хүлээн авах шалгуур аль хэдийн бий. `2-7` баримтад «§63» гэсэн үг НЭГ Ч удаа гардаггүй ба тэр сесс ЗӨВХӨН УНШИНА (migration авдаггүй) — тийш заавал энэ ажил ЭЗЭНГҮЙ үлдэнэ. Генераторыг (`rule_test_cases` руу 13 ангийг цацах) `2-2` бичнэ, `case_class` үгсийн сан нь түүнийх учраас.

Энэ сессийн үүрэг нь **ангиудыг ба хүлээгдэх үр дүнг ТОГТООХ** (дээрх хүснэгт) ба `uncertain_reason`-ийн хаалттай багцыг `complianceModel.ts`-д хадгалах — ингэснээр гэйт бичих үед маргах зүйл үлдэхгүй.

### 3.14 `App.cs` — залгуур

| # | Файл:мөр | Өөрчлөлт |
|---|---|---|
| 1 | `App.cs:70`-ийн ДАРАА | `ComplianceScheduler.Init(...)` — ⚠️ ЗӨВХӨН `2-4`-ийн thread үүссэний дараа, өөрийн `try/catch`-тай (нэг дэд системийн уналт add-in-ийг бүхэлд нь унагаахгүй) |
| 2 | `App.cs:144`-ийн ХАЖУУ | `if (BatchQto.IsBatch) ComplianceScheduler.Disable();` — шөнийн багц host нь 50 файлыг detached нээж, өөр хүмүүсийн байрлуулалтаас баг тодорхойлж, мянга мянган олдвор гаргана. `BatchQto` нь `Process.GetCurrentProcess().Kill()`-ээр төгсдөг |
| 3 | `App.cs:163`-ийн ӨМНӨ | `ComplianceScheduler.Cancel();` — ЗӨВХӨН дохио, ХҮЛЭЭХГҮЙ. ⚠️ `ChangeTracker.Shutdown` нь ЭХЭНД (`:163`), `RevitToolBus.Shutdown` нь ХАМГИЙН СҮҮЛД (`:194`) ажилладаг тул тэдний ХООРОНД thread join хийвэл Revit-ийн хаагдалт tool-ийн бүтэн deadline хүлээж гацна |
| 4 | `App.cs:192`-ийн ӨМНӨ | `ComplianceScheduler.Join(400);` — хязгаартай. Thread нь `IsBackground = true` тул гацсан ч процессыг барихгүй |

---

## 4. ХӨНДӨЖ БОЛОХГҮЙ (load-bearing)

| Юу | Хаана (баталгаажсан) | Яагаад эвдрэх вэ |
|---|---|---|
| `purpose === 'mcp'` токеныг `/api/*`-д зөвшөөрөх | `middleware/auth.ts:101-102`, `types.ts:209-212`, `lib/tokenValidity.ts:30-34` | Add-in REST дуудлага бүрээ тэр токеноор хийдэг, refresh БАЙХГҮЙ. Татгалзвал ~20 PC гар суулгалтаар л сэргэнэ — алсаас сэргээх БОЛОМЖГҮЙ ЦОРЫН ГАНЦ өөрчлөлт |
| `users` / `projects` хүснэгтийг дахин барих | 19 ба 33 каскад хүүхэд | `migrations apply` нь гүйлгээнд каскадыг ГАЛЛУУЛНА — бүх хүүхэд мөр устана |
| `OnDocumentChanged`-ийн бие | `ChangeTracker.cs:776-899` | Мөр НЭМЭХГҮЙ. Тэнд гүйлгээ/`Regenerate`/диск/сүлжээ/инференс тавих нь 120 секундын гацааг сэргээнэ (`:17-45`). `GetTransactionNames()` нь handler-ийн ГАНЦ Revit API дуудлага хэвээр (`:795`) |
| `_flushTimer` дээр ажил нэмэх | `ChangeTracker.cs:313`, `:558`, `:577`, `:583` | ДАВТАМЖИТ таймер + хуваалцсан `.tmp` + `Dirty.Clear()` = өдрийн ажил ЧИМЭЭГҮЙ алдагдана |
| `ChangeTracker.Gate`-ийг гадагш барих | `ChangeTracker.cs:798` (гүйлгээ бүрт), `:570-572` (одоогийн сахилга) | Хуваарилагч Gate барьчихаад bus-д хүлээвэл хэрэглэгчийн зурах үйлдэл tool-ийн бүтэн deadline хүлээнэ |
| Мөчлөг бүрд `TryGetByKey` дуудах | `ChangeTracker.cs:412-443`, `:63` (500000), `:74` (20000) | `Gate` дотор гурван `HashSet` + `Meta` гүнзгий хуулна. `Metrics.FlushLock` (`Percentiles.cs:143`) шууд өснө — тэр нь үндсэн thread-ийн бодит блоклолтыг хэмждэг цорын ганц тоолуур |
| Харагдацын хамрах хүрээтэй collector | `ChangeReport.cs:34` («`IsElementVisibleInView` гэж БАЙХГҮЙ»), `:691` | Regenerate. `RuleFactExtractor`-т ХОРИОТОЙ; хуудас хайх нь зөвхөн хэрэглэгч дархад, төсөвтэй |
| `Abandoned` протокол | `RevitToolBus.cs:32`, `:309`, `:474-478` | Хэрэгжүүлэхгүй бол хугацаа дууссан дуудлага «сүнс» болж Revit-ийг барина, дараагийн бодит дуудлага БАТАЛГААТАЙ унана — хэрэглэгч байнгын гацаа гэж уншина |
| `MaxPerSlice = 4` + `RaiseAgain` | `RevitToolBus.cs:440`, `:458`, `:512` | Зүсэлт дотор эгнээг бүрэн шавхвал Revit мессежийн давталтаа эргүүлж чадахгүй — програм БҮХЭЛДЭЭ хөлдөнө |
| `DockablePane.Show()` | `AssistantPaneProvider.cs:47-54` (ГАНЦ `Show()`) | Автоматаар нээх нь ~300 px ба фокус булаана. Тоо нь ribbon-ы бичээсээр очно |
| `Dispatcher.Invoke` түгжээнээс | §0 №10 | UI thread `lock (Gate)`-д хүлээж байж болно → хоёр thread deadlock |
| 0206-ийн найман trigger | `0206:1-55` | Тэдгээр хүснэгтэд олдворын төлөв тавивал UPDATE бүр `RAISE(ABORT)` |
| `bimEvents.ts` нь ЦОРЫН ГАНЦ бичих гарц | `learning.ts:74-77`, `backend/scripts/check-bim-events.mjs` | `compliance.ts` нь `learning_events` рүү шууд SQL бичвэл `npm run verify` дотор grep-ээр унана |
| `learning_events`-д БОДИТ багана нэмэх | `bimEvents.ts:502-503` (23 bind → 4 мөр/statement) | 25 bind → 3 мөр/statement, хамгийн их урсгалтай хүснэгтэд 25% ingest алдагдал — R7-ийн шууд зөрчил |
| BIM хүснэгтүүдийн хажууд `REFERENCES` | 1B-1 §2.6-ийн хэмжилт | `ON DELETE SET NULL` → хүүхдийн UPDATE → append-only trigger → ЭЦГИЙН DELETE БҮХЭЛДЭЭ ABORT |
| ЗӨВХӨН ӨӨРИЙГӨӨ ХАРАХ — ЭЛЕМЕНТИЙН ТҮВШИНД | `0201:23-32`, `0203:27`, `0205:44`, `revitNoteAi.test.ts:262` | Нэр заасан «хэн хамгийн олон алдаа гаргав» самбар нь дөрвөн удаа баримтжуулсан дүрмийг зөрчинө. ⚠️ Энэ нь `2-7` §3.3-ын БАГИЙН асуулгыг ХОРИГЛОХГҮЙ — тэр нь `detected_by`-г буцаадаггүй ба `finding_teams.team_code`-оор хамрах хүрээгээ тогтоодог (§3.12-ын хилийн тодорхойлолт). Хоёрыг андуурч НЭГ маршрут болговол аль нэг нь заавал эвдэрнэ |
| `idx_cf_dedup`-д `detected_by` байх | §3.2, `RevitTools.cs:134-138` (`DocUid` = `ProjectInformation.UniqueId`) | Төв загварын локал хуулбар бүр ИЖИЛ `doc_uid`-тай. Хаявал хоёр инженер нэг мөрийг булаацалдаж, нэгнийх нь олдвор `detected_by = viewer.sub` жагсаалтаас ЧИМЭЭГҮЙ АЛГА БОЛНО |
| `finding_edges`-ийн ЧИГЛЭЛ (`from` = ҮНДЭС, `to` = ҮР ДАГАВАР) | `2-7` §3.3 (`to_finding_id` = `caused_by_count`), `2-5` §3.3 (`causes`-ийн дээгүүр ДЭЭШ) ба §3.4-ийн `FindingFeed` | Урвуулбал §77-ийн «1 үндсэн + N үр дагавар» нь толин тусгал болж, ХЭН Ч алдааг нь анзаарахгүй — хоёр уншигч хоёулаа мөр буцаана |
| `finding_elements` / `finding_teams`-ийн ҮЙЛДВЭРЛЭГЧ | §3.12-ын «ЗААВАЛ бичих холбоос» | Бичигчгүй бол `2-7` §3.3-ын `INNER JOIN finding_teams` нь ЭЗЭМШИГЧ БАГТ Ч тэг мөр буцаана — §60 БҮХЭЛДЭЭ хэрэгжихгүй, гэхдээ 500 биш 200 буцаах тул алдаа нь ХАРАГДАХГҮЙ |
| `POST /findings/stale` маршрут | §3.10, §3.12 | Байхгүй бол `stale_at` нь БИЧИГЧГҮЙ багана болж, §58 бүхэлдээ санах ойд үлдэнэ. Revit хаагдмагц бүх хуучруулалт АЛГА БОЛНО |
| `Round3OrNull` дахин ашиглах | `QtoExtractor.cs:528-534` | Бодит тэгийг NULL болгодог; §63 нь `zero` ба `missing input`-ыг ТУСДАА шаардана |

---

## 5. ДАРААЛАЛ БА ХАМААРАЛ

**Урьдчилсан нөхцөл:**

| # | Нөхцөл | Хэрхэн шалгах |
|---|---|---|
| 1 | `2-2` нь `rules`, `rule_deps`, `RuleDef`, `RuleEngine.Evaluate` гарын үсгийг тогтоосон | `ls backend/migrations \| grep 022` дээр 0223 харагдана; `RuleEngine.cs` компайл болно |
| 2 | `2-1` нь `bim_sessions.team_code` нэмсэн | `wrangler d1 execute … --command "PRAGMA table_info(bim_sessions)" \| grep team_code` |
| 3 | `2-4` нь `RawRing`, `ChangeSetCoalescer`, хуваарилагчийн thread, `TryCall`-ыг өгсөн | `grep -n "TryCall\|RawRing" revit-mcp/addin/*.cs` |
| 4 | 0212–0216 нь продакшн дээр хэрэгжсэн | §7-ийн 1-р команд. ⚠️ Хэрэгжээгүй бол `assistant_logs` дээрх нэмэлт багана байхгүй ба ЭНЭ файлын migration-ууд ажиллах боловч ах дүү файлууд унана |

**Deploy-ийн дараалал:**

```
1.  cd backend
2.  npx wrangler d1 migrations apply mgl-progress-db-v3 --remote --config wrangler.toml
        └─ 0224_compliance_findings.sql   (1 хүснэгт + 6 индекс)
        └─ 0225_finding_links.sql         (3 хүснэгт + 4 индекс)
        └─ 0229_rule_run_ledger.sql       (1 хүснэгт + 3 индекс)
        ▼
3.  npx tsc --noEmit          (АЛДАА ЗӨВХӨН хамааралгүй файлд байгааг батал)
        ▼
4.  npx wrangler deploy --config wrangler.toml
        └─ routes/compliance.ts, lib/complianceModel.ts, index.ts, lib/modules.ts
        ▼
5.  C# — ТУСДАА ТАРААХГҮЙ.  Track 2-ийн БҮХ C# өөрчлөлт НЭГ релизэд
    (2-1 + 2-3 + 2-4 + 2-8) багцлагдана.  ~20 PC × Install.bat × Revit хаалттай.
```

**Шинэ багана нь түүнийг уншдаг кодоос ХАТУУ ӨМНӨХ deploy-д гарна.** Урвуулбал воркер нь байхгүй хүснэгт рүү INSERT хийж, add-in нь 500 авч, `POST /api/compliance/findings` нь чимээгүй хоосон болно.

**ЗЭРЭГЦЭЭ ХЭРЭГЖИЖ БОЛОХ БАРИМТУУД** (эзэн хурдыг хүссэн):

| Баримт | Зэрэг ажиллаж БОЛОХ уу | Яагаад |
|---|---|---|
| `2-1-team-context` | ✅ ТИЙМ | Өөр migration блок (0217–0219), өөр файл. Зөвхөн `owner_team_code`-ийн УТГЫГ өгнө — багана нь энэ файлын өөрийн DDL-д бий |
| `2-2-rule-model` | ⚠️ ТИЙМ, ГЭХДЭЭ | Өөр блок (0220–0223). Гэрээ нь `RuleDef` + `RuleEngine.Evaluate` — хоёр талаас нь зэрэг бичиж, интеграцийг сүүлд хийнэ. **ГЭХДЭЭ `complianceModel.ts` нь ХАМТЫН ФАЙЛ**: `2-2` нь `VERDICTS`/`ISSUE_CLASSES`/`EVIDENCE_LEVELS`/`SEVERITIES`-ыг эзэмшинэ, энэ сесс ЗӨВХӨН §3.1-ийн блокыг ТӨГСГӨЛД нэмнэ. Ижил `export const`-ыг хоёр удаа зарлавал файл КОМПАЙЛ БОЛОХГҮЙ |
| `2-4-nonblocking-runtime` | ✅ ТИЙМ | Өөр блок (0226–0228). Гэрээ нь `LogicalChangeSet` + `TryCall` + thread |
| `2-8-install-and-health` | ✅ ТИЙМ | Огт хамааралгүй хүснэгт (0241–0242) |
| `2-6-team-training` | ✅ ТИЙМ | `assistant_*` хүснэгтүүд, огт өөр гэр бүл |
| `2-5-finding-surface` | ❌ ҮГҮЙ | `finding_overrides` нь `compliance_findings.id`-д наалддаг — хүснэгт байхгүй байхад бичиж болохгүй |
| `2-7-readiness-and-quality` | ❌ ҮГҮЙ | §69-ийн тоолуур ба §66-ийн FP/FN нь ЭНЭ мөрүүдийг уншина |

### Дараа нь юу ирэх вэ

| Баримт | Эндээс юу авах вэ |
|---|---|
| `2-5-finding-surface` | `compliance_findings.id`, `lifecycle_state`, `ALLOWED_TRANSITIONS`, `finding_edges` |
| `2-7-readiness-and-quality` | `rule_run_ledger` ХҮСНЭГТ (0229), `readiness_inputs`, `ledger` payload-ийн хэлбэр, `coverage`, `uncertain_reason`, ба `finding_teams` / `finding_edges`-ийн ҮЙЛДВЭРЛЭГЧ (§3.12) |

⚠️ **`2-7`-д ЗААВАЛ дамжуулах ХОЁР нөхцөл** (§3.12-ын хилийн тодорхойлолт): (1) `GET /api/compliance/projects/:id/findings?team=<code>` нь **гишүүнчлэлийн хаалттай** байх ёстой — `user_teams`-д тухайн `team_code`, эс бөгөөс `requireManager()`; (2) тэр асуулга нь `dedup_key`-ээр **НЭГТГЭНЭ**, учир нь `idx_cf_dedup` нь одоо `detected_by`-г агуулдаг (§3.2) ба нэг төв загвар дээрх хоёр инженерийн ижил олдвор ХОЁР мөр болно. Хоёулаа `2-7`-ийн код дээр хийгдэнэ; энэ файл зөвхөн гэрээг тогтоов.
| `2-6-team-training` | `RULE_VALIDATION` payload-ийн хөлдөөсөн талбарууд (§3.4) |

---

## 6. ХҮЛЭЭН АВАХ ШАЛГУУР

### Схем

- [ ] `PRAGMA table_info(compliance_findings)` → мөр тоо **>= 32**, `verdict`, `issue_class`, `evidence_level`, `severity`, `lifecycle_state`, `stale_at`, `stale_reason`, `scan_generation`, `coverage`, `uncertain_reason` БҮГД бий
- [ ] `SELECT sql FROM sqlite_master WHERE name='compliance_findings'` → `CHECK (verdict IN ('PASS','WARNING','VIOLATION','UNCERTAIN'))` ЯГ дөрвөн утга, `NOT_APPLICABLE` **БАЙХГҮЙ**
- [ ] Тэр SQL дотор `lifecycle_state` CHECK нь ЯГ 7 утга, `'STALE'` **БАЙХГҮЙ**
- [ ] `SELECT COUNT(*) FROM sqlite_master WHERE type='index' AND tbl_name='compliance_findings'` → **6** (+ автомат PK индекс)
- [ ] `SELECT sql FROM sqlite_master WHERE name='idx_cf_dedup'` → баганын жагсаалт нь **`(doc_uid, detected_by, dedup_key)`** — `detected_by` БАЙХГҮЙ бол төв загвар дээр хоёр инженерийн олдвор нэг мөрийг булаацалдана (§3.2)
- [ ] `SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name IN ('finding_elements','finding_teams','finding_edges')` → **3**
- [ ] `SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='rule_run_ledger'` → **1** (⚠️ `2-5` ба `2-7` хоёулаа энэ хүснэгтийг ЭНЭ баримт үүсгэнэ гэж толгойдоо бичсэн)
- [ ] `PRAGMA table_info(rule_run_ledger)` → `project_id`, `session_id`, `rule_uid`, `ruleset_version`, `considered`, `applicable`, `evaluated`, `skipped_reason`, `aborted` БҮГД бий; `user_id`/`detected_by`/`element_uid` **АЛЬ НЬ Ч БАЙХГҮЙ** (нэгтгэсэн-ээс өөр юм хадгалахгүй)
- [ ] `SELECT COUNT(*) FROM sqlite_master WHERE type='index' AND tbl_name='rule_run_ledger' AND name LIKE 'idx_rrl_%'` → **3**
- [ ] `SELECT COUNT(*) FROM sqlite_master WHERE type='trigger' AND tbl_name='compliance_findings'` → **0** (хувирамтгай байх ЁСТОЙ)
- [ ] `grep -c "REFERENCES" backend/migrations/0224_compliance_findings.sql backend/migrations/0225_finding_links.sql backend/migrations/0229_rule_run_ledger.sql` → **0 0 0**
- [ ] `node backend/scripts/check-bim-events.mjs` → exit 0 (bind арифметик хэвээр: `EVENT_BINDS = 23`, 4 мөр/statement)
- [ ] `node --test src/lib/migrationSchema.test.ts` (backend/-ээс) → ногоон

### Сервер

- [ ] `curl -s -o /dev/null -w '%{http_code}' …/api/compliance/projects/1/state` токенгүйгээр → **401**
- [ ] `client` үүрэгтэй токеноор → **403**
- [ ] `worker` үүрэгтэй токеноор → **403** (`workerScope`-ийн хаалттай-анхдагч, ЭНЭ файл түүнд НЭМЭХГҮЙ)
- [ ] `engineer` токеноор → **200**, JSON нь `scan_generation`, `open`, `newly_introduced`, `fixed`, `remaining`, `uncertain`, `readiness_inputs` талбартай
- [ ] `GET /api/compliance/findings` нь ӨӨР хэрэглэгчийн `detected_by` мөрийг **БУЦААХГҮЙ** (хоёр токеноор шалгана, тоо нь давхцахгүй)
- [ ] `PATCH …/findings/:uid` `{"lifecycle_state":"FIXED"}` `INVALIDATED` мөр дээр → **409** (`ALLOWED_TRANSITIONS.INVALIDATED = []`)
- [ ] `PATCH …/findings/:uid` `{"lifecycle_state":"DISMISSED"}` → **400** («override шаардлагатай»)
- [ ] `POST /api/compliance/findings` нь дүгнэлт өөрчлөгдсөн мөр бүрд ЯГ НЭГ `learning_events` мөр бичнэ: `SELECT COUNT(*) FROM learning_events WHERE kind='RULE_VALIDATION' AND rule_id IS NOT NULL` нь илгээсэн өөрчлөлтийн тоотой ТЭНЦҮҮ
- [ ] Тэдгээр мөрийн `parts_missing` → **0** (өөрөөр хэлбэл `rule_id` + `passed` хоёулаа payload-д байгаа)
- [ ] Ижил дүгнэлтийг ХОЁР удаа илгээхэд `learning_events`-ийн тоо **ӨСӨХГҮЙ** (§3.4-ийн төлөв-өөрчлөгдөх дүрэм)
- [ ] `POST /api/compliance/findings`-ийн `ledger` блок дахь мөр бүр `rule_run_ledger`-т **ЯГ НЭГ** мөр үлдээнэ: `SELECT COUNT(*) FROM rule_run_ledger` нь илгээсэн `ledger[]`-ийн уртаар өснө
- [ ] `SELECT COUNT(*) FROM rule_run_ledger WHERE considered < applicable OR applicable < evaluated` → **0** (тоолуурын дараалал зөрчигдөхгүй)
- [ ] `SELECT COUNT(*) FROM rule_run_ledger WHERE applicable = 0 AND skipped_reason IS NULL` → **0** (хамаарахгүй болсон ШАЛТГААН нь ҮРГЭЛЖ бичигдэнэ — «хэзээ ч ажиллаагүй» нь ЧИМЭЭГҮЙ БАЙЖ БОЛОХГҮЙ)
- [ ] `grep -n "INSERT INTO learning_events" backend/src/routes/compliance.ts` → **тэг мөр**

### Сервер — холбоос хүснэгтүүд ба хуучруулалт (§3.12-ын ҮЙЛДВЭРЛЭГЧ)

- [ ] НЭГ олдворыг `elements[]` дотор 1 `subject` + 2 `context`-той илгээнэ → `SELECT COUNT(*) FROM finding_elements` нь **3-аар** өснө; `SELECT COUNT(*) FROM finding_elements WHERE role='subject'` нь **1-ээр** өснө
- [ ] `elements[]`-гүй (эсвэл `subject`-гүй) олдвор илгээнэ → **400**, `compliance_findings`-д мөр НЭМЭГДЭХГҮЙ
- [ ] Тэр нэг олдворын дараа `SELECT COUNT(*) FROM finding_teams WHERE relation='owner'` нь **ЯГ 1-ээр** өснө, `team_code` нь `bim_sessions`-ийн шийдэгдсэн баг (клиентийн мэдүүлгээс БИШ — өөр `team_code` мэдүүлж илгээгээд хадгалагдсаныг шалга)
- [ ] Баг нь `uncertain` сессээс олдвор илгээнэ → `finding_teams`-д мөр **НЭМЭГДЭХГҮЙ**, харин `GET /state`-ийн `readiness_inputs.unattributed_findings` нь **1-ээр** өснө (ЧИМЭЭГҮЙ АЛГА БОЛОХГҮЙ)
- [ ] **ХОЁР олдворын фикстур**: A нь `element_uid = X`-ийг `subject`, B нь ижил `X`-ийг `context` болгож нэг багцад илгээнэ → `SELECT COUNT(*) FROM finding_edges WHERE kind='causes'` нь **ЯГ 1-ээр** өснө, ба `from_finding_id` нь **A** (`SELECT from_finding_id = (SELECT id FROM compliance_findings WHERE finding_uid='A')`)
- [ ] Ижил багцыг ДАХИН илгээнэ → `finding_edges`-ийн тоо **ӨСӨХГҮЙ** (`idx_fedge_uniq` + `INSERT OR IGNORE`)
- [ ] `rule_conflicts`-д бүртгэлтэй хос дүрмийг нэг элемент дээр илгээнэ → `kind='conflicts_with'` мөр **1**, ба хоёр дүрмийн багт `finding_teams … relation='affected'` мөр **тус бүр 1**
- [ ] Хоёр өөр токеноор ижил `(doc_uid, dedup_key)` илгээнэ → `compliance_findings`-д **ХОЁР** мөр (409/дарагдалт БАЙХГҮЙ), ба `SELECT COUNT(*) FROM finding_edges WHERE kind='duplicates'` → **1**
- [ ] `POST /api/compliance/findings/stale` `{doc_uid, reason:'sync'}` → **200**, `SELECT COUNT(*) FROM compliance_findings WHERE doc_uid=? AND stale_at IS NOT NULL AND stale_reason='sync'` нь тэр хэрэглэгчийн НЭЭЛТТЭЙ олдворын тоотой ТЭНЦҮҮ
- [ ] … ба ӨӨР хэрэглэгчийн ижил `doc_uid` дээрх олдвор нь `stale_at IS NULL` **ХЭВЭЭР** (`detected_by` шүүлт ажиллаж байна)
- [ ] `POST …/stale` дээр `reason` нь `STALE_REASONS`-д байхгүй утга → **400**
- [ ] Дүгнэлт дахин үнэлэгдэж `POST /findings`-ээр ирэхэд тэр мөрийн `stale_at` → **NULL болно** (§3.9-ийн `Apply`)
- [ ] Багц нийтлэгдэж `ruleset_version` солигдсоны дараа `GET /projects/:id/state` дуудахад хуучин багцын мөрүүд `stale_reason='ruleset'` авна — **cron ХЭРЭГГҮЙ** (`grep -n 'crons' backend/wrangler.toml` → `:192` дээр `crons = ["*/2 * * * *", "* * * * *"]` — ЯГ ХОЁР илэрхийлэл ХЭВЭЭР. Гуравдугаарыг нэмбэл `index.ts`-ийн `scheduled` салаа нь дөрвөн ажлыг ДАВХАР ажиллуулна)

### Add-in (Revit нээлттэй, гараар)

- [ ] Гараар: 20 хана зурна → `%APPDATA%\RevitMcpAddin\timing.log`-ийн `doc.changed` p95 нь өмнөх ажиллагаатай **ижил дараалалд** (хоёр дахин өсөхгүй)
- [ ] Гараар: нэг хана зурсны дараа **~2 секундын дотор** (`bim.compliance.settle_ms = 1200` үед) ribbon-ы товчны бичээс дээр тоо гарна. **Ямар ч цонх нээгдэхгүй**, фокус булаагдахгүй, курсор завгүй болохгүй, `MGL туслах` самбар өөрөө нээгдэхгүй
- [ ] Гараар: `MGL туслах` дээр урт асуулт бичиж байх зуур нийцлийн мөчлөг явна → чат нь «Хугацаа дууслаа … өмнөх үйлдэл дуусаагүй байна» **ХЭЗЭЭ Ч харуулахгүй** (`TryCall`-ийн `Gate.Wait(0)` алгасалт)
- [ ] Гараар: 2000 элемент буулгана → Revit-ийн ribbon/viewport/курсор **гацахгүй**; `timing.log`-д `input.collect` p95 < 400 мс, олдвор нь хэдэн мөчлөгөөр хуваагдан ирнэ
- [ ] Гараар: 20 удаа Ctrl+Z дарна → `POST /api/compliance/findings` нь 20 дахин ажиллахгүй (сүлжээний хэрэгслээр эсвэл `learning_events` тоогоор шалгана)
- [ ] Гараар: «Synchronize with Central» → дараа нь тэр баримтын БҮХ олдвор `stale_at` авна (`GET /state` дээр `readiness_inputs.stale_count > 0`)
- [ ] Гараар: сервер унтраасан үед (api_host буруу) Revit **хэвийн ажиллана**, зурах удаашрахгүй, ямар ч алдааны цонх гарахгүй
- [ ] Гараар: параметргүй өрөө дээр дүрэм ажиллуулна → олдвор нь `UNCERTAIN` / `missing_input`, **ХЭЗЭЭ Ч `VIOLATION` БИШ**
- [ ] Гараар: **pack БАЙХГҮЙ багийн** сессээр (`MGMT` / `EZ` / `GT`, эсвэл BA-гаас хойш дараалалдаа хүрээгүй дисциплин — v2 §46, §3.5) хана зурна → `POST /api/compliance/findings` **ХЭЗЭЭ Ч дуудагдахгүй**, `SELECT COUNT(*) FROM rule_run_ledger` **ӨСӨХГҮЙ**, ribbon нь тоо биш «дүрмийн багц бэлэн болоогүй» гэж харуулна (§3.6-ийн ШАТ 0, §3.11)
- [ ] … ба ӨӨР БАГИЙН дүрмээр гарсан олдвор НЭГ Ч БАЙХГҮЙ: `SELECT COUNT(*) FROM compliance_findings WHERE rule_uid NOT LIKE '<сессийн team_code>-%'` → **0** (өгөгдмөл / компани даяарын pack руу шилжээгүй)
- [ ] `grep -c "FilteredElementCollector(doc, " revit-mcp/addin/RuleFactExtractor.cs` → харагдацтай хувилбар (`, v.Id`) **тэг**
- [ ] `grep -c "DockablePane\|Dispatcher.Invoke\|ChangeTracker.Gate" revit-mcp/addin/ComplianceScheduler.cs revit-mcp/addin/ComplianceState.cs` → **0 0**
- [ ] `grep -c "Autodesk.Revit" revit-mcp/addin/ComplianceScheduler.cs revit-mcp/addin/ComplianceState.cs` → **0 0** (Revit-гүйгээр тестлэгдэх нөхцөл)
- [ ] `grep -n "collect_rule_inputs" revit-mcp/addin/AgentChat.cs backend/src/lib/revitAgent.ts revit-mcp/agent/mgl_agent.py` → **тэг мөр** (LLM-д нээхгүй)

### Хамрах хүрээ

- [ ] `git status --short` нь ЗӨВХӨН §0-ийн жагсаалтын файлыг харуулна
- [ ] `git diff --stat` дээр өөр агентын файл БАЙХГҮЙ

---

## 7. ШАЛГАХ КОМАНД

```bash
# --- 1. УРЬДЧИЛСАН НӨХЦӨЛ: 0212-0216 продакшн дээр хэрэгжсэн үү ---
cd backend
npx wrangler d1 execute mgl-progress-db-v3 --remote --config wrangler.toml \
  --command "SELECT name FROM d1_migrations ORDER BY id DESC LIMIT 20"
# Хүлээгдэх: 0216_assistant_log_timing.sql жагсаалтад БАЙНА.
# БАЙХГҮЙ бол ЗОГС — ах дүү баримтууд байхгүй багана руу бичнэ.

# --- 2. ДУГААР АВАХ (заавал, бичихийн ЯГ ӨМНӨ) ---
# ⚠️ cwd нь `backend/` — доорх зам бүр түүнээс ХАМААРНА.
ls migrations | tail -5
# Хүлээгдэх: хамгийн өндөр нь 0216 (эсвэл ах дүү агентын аль хэдийн
# нэмсэн 0217-0228).  0224/0225/0229 ЭЗЭНГҮЙ байх ЁСТОЙ.

# --- 3. ТЭЭВРИЙН ДҮРЭМ: statement тоолох ---
grep -c ';' migrations/0224_compliance_findings.sql
grep -c ';' migrations/0225_finding_links.sql
# Хүлээгдэх: ХОЁУЛАА 7.  8 ба түүнээс дээш бол ХУВАА.
grep -c ';' migrations/0229_rule_run_ledger.sql
# Хүлээгдэх: 4
grep -c '/\*' migrations/0224_compliance_findings.sql migrations/0225_finding_links.sql \
              migrations/0229_rule_run_ledger.sql
# Хүлээгдэх: 0 0 0  (блок тайлбар задлагчийг унагана)
grep -n 'END;' migrations/0224_compliance_findings.sql migrations/0225_finding_links.sql \
               migrations/0229_rule_run_ledger.sql
# Хүлээгдэх: ХООСОН — энэ гурван файлд trigger байхгүй

# --- 4. FK ХОРИГ ---
grep -c 'REFERENCES' migrations/0224_compliance_findings.sql \
                     migrations/0225_finding_links.sql \
                     migrations/0229_rule_run_ledger.sql
# Хүлээгдэх: 0 0 0

# --- 5. MIGRATION ХЭРЭГЖҮҮЛЭХ (ЭХЛЭЭД, воркероос ӨМНӨ) ---
npx wrangler d1 migrations apply mgl-progress-db-v3 --remote --config wrangler.toml
# Хүлээгдэх: 0224, 0225, 0229 гурвуулаа applied

# --- 6. СХЕМ БАТАЛГААЖУУЛАХ ---
npx wrangler d1 execute mgl-progress-db-v3 --remote --config wrangler.toml \
  --command "SELECT COUNT(*) AS cols FROM pragma_table_info('compliance_findings')"
# Хүлээгдэх: cols >= 32
npx wrangler d1 execute mgl-progress-db-v3 --remote --config wrangler.toml \
  --command "SELECT COUNT(*) AS idx FROM sqlite_master WHERE type='index' AND tbl_name='compliance_findings' AND name LIKE 'idx_cf_%'"
# Хүлээгдэх: idx = 6
npx wrangler d1 execute mgl-progress-db-v3 --remote --config wrangler.toml \
  --command "SELECT COUNT(*) AS trg FROM sqlite_master WHERE type='trigger' AND tbl_name='compliance_findings'"
# Хүлээгдэх: trg = 0  (ХУВИРАМТГАЙ байх ЁСТОЙ)
npx wrangler d1 execute mgl-progress-db-v3 --remote --config wrangler.toml \
  --command "SELECT COUNT(*) AS idx FROM sqlite_master WHERE type='index' AND tbl_name='rule_run_ledger' AND name LIKE 'idx_rrl_%'"
# Хүлээгдэх: idx = 3  (хүснэгт нь ҮҮССЭН — 2-5 ба 2-7 хоёулаа үүнээс хамаарна)

# --- 7. ХАМГААЛАГДСАН ХҮСНЭГТҮҮД ХЭВЭЭР ---
npx wrangler d1 execute mgl-progress-db-v3 --remote --config wrangler.toml \
  --command "SELECT COUNT(*) AS trg FROM sqlite_master WHERE type='trigger' AND name LIKE '%append_only%' AND tbl_name IN ('bim_artifacts','revit_transactions','revit_element_touches','learning_events')"
# Хүлээгдэх: trg = 4  (0206-ийн дөрвөн append_only trigger хэвээр)
# ⚠️ `tbl_name` шүүлт нь ЗААВАЛ.  `2-1`-ийн 0218 нь `team_attributions_append_only`
#    нэртэй ТАВ ДАХЬ trigger нэмдэг (2-1 §3.2), ба README-ийн долгион хүснэгтээр
#    `2-1` нь ЭНЭ баримтаас ӨМНӨ шипнэ.  Шүүлтгүй бол хариу нь 5 болж, «хамгаалагдсан
#    trigger устсан» гэж ХУДЛАА уншигдана.

# --- 8. TYPECHECK + ТЕСТ ---
npx tsc --noEmit
# ⚠️ Бүх воркерийг компайлдаг.  Алдаа гарвал ЗӨВХӨН таны хөндөөгүй файлд
# байгаа эсэхийг батал — дараа нь эзэнд мэдэгд, араас нь бүү хөө.
npm test
node scripts/check-bim-events.mjs
node --test src/lib/migrationSchema.test.ts
# Хүлээгдэх: бүгд ногоон

# --- 9. WORKER DEPLOY (migration-ы ДАРАА) ---
npx wrangler deploy --config wrangler.toml

# --- 10. ЭРХИЙН ХИЛ ---
API=https://<worker-host>
curl -s -o /dev/null -w '%{http_code}\n' "$API/api/compliance/projects/1/state"
# Хүлээгдэх: 401
curl -s -o /dev/null -w '%{http_code}\n' -H "Authorization: Bearer $CLIENT_TOKEN" \
  "$API/api/compliance/projects/1/state"
# Хүлээгдэх: 403
curl -s -o /dev/null -w '%{http_code}\n' -H "Authorization: Bearer $ENGINEER_TOKEN" \
  "$API/api/compliance/projects/1/state"
# Хүлээгдэх: 200

# --- 11. ҮНЭГҮЙ ХОЖЛЫГ БАТАЛГААЖУУЛАХ (нэг дүгнэлт илгээсний дараа) ---
npx wrangler d1 execute mgl-progress-db-v3 --remote --config wrangler.toml \
  --command "SELECT rule_id, parts_missing, payload_contract FROM learning_events WHERE kind='RULE_VALIDATION' ORDER BY id DESC LIMIT 3"
# Хүлээгдэх: rule_id БӨГЛӨГДСӨН, parts_missing = 0,
#            payload_contract = 'v1:RULE_VALIDATION+RULE_VERDICT'

# --- 12. ХОЛБООС ХҮСНЭГТҮҮД ҮНЭХЭЭР БИЧИГДЭВ ҮҮ (§3.12-ын ҮЙЛДВЭРЛЭГЧ) ---
# ⚠️ Нэг олдвор илгээсний ДАРАА ажиллуулна.  Гурвуулаа ХООСОН байвал
#    хүснэгт нь бий, бичигч нь БАЙХГҮЙ — §60 ба §77 чимээгүй үхсэн байна.
npx wrangler d1 execute mgl-progress-db-v3 --remote --config wrangler.toml \
  --command "SELECT (SELECT COUNT(*) FROM finding_elements) AS elems, (SELECT COUNT(*) FROM finding_teams WHERE relation='owner') AS owners, (SELECT COUNT(*) FROM finding_edges) AS edges"
# Хүлээгдэх: elems >= 1, owners >= 1.  edges нь 0 байж БОЛНО (гинж үүсээгүй),
#            гэхдээ §6-ийн хоёр олдворын фикстур дээр ЯГ 1 байх ЁСТОЙ.
npx wrangler d1 execute mgl-progress-db-v3 --remote --config wrangler.toml \
  --command "SELECT COUNT(*) AS orphans FROM compliance_findings f WHERE NOT EXISTS (SELECT 1 FROM finding_elements e WHERE e.finding_id = f.id)"
# Хүлээгдэх: orphans = 0  (subject элементгүй олдвор БАЙЖ БОЛОХГҮЙ)

# --- 12б. ХУУЧРУУЛАЛТЫН СЕРВЕР ТАЛ ---
curl -s -X POST -H "Authorization: Bearer $ENGINEER_TOKEN" \
  -H 'content-type: application/json' \
  -d '{"doc_uid":"<doc>","reason":"sync"}' \
  "$API/api/compliance/findings/stale"
# Хүлээгдэх: 200 { "staled": N }, N >= 1
npx wrangler d1 execute mgl-progress-db-v3 --remote --config wrangler.toml \
  --command "SELECT stale_reason, COUNT(*) AS n FROM compliance_findings WHERE stale_at IS NOT NULL GROUP BY stale_reason"
# Хүлээгдэх: sync мөр бий.  ⚠️ ХООСОН бол §58 нь зөвхөн санах ойд байна.
grep -n 'crons' wrangler.toml
# Хүлээгдэх: crons = ["*/2 * * * *", "* * * * *"] — ЯГ ХОЁР илэрхийлэл.
# Гурав дахийг нэмбэл scheduled-ийн дөрвөн ажил ДАВХАР ажиллана.

# --- 13. C#: REVIT-ГҮЙ ЦЭВЭР БАЙДАЛ ---
cd ../revit-mcp/addin
grep -c 'Autodesk.Revit' ComplianceScheduler.cs ComplianceState.cs
# Хүлээгдэх: 0 0   (Revit суулгалтгүйгээр `dotnet run`-аар тестлэгдэнэ)
grep -c 'FilteredElementCollector(doc, v' RuleFactExtractor.cs
# Хүлээгдэх: 0     (харагдацын хамрах хүрээтэй collector ХОРИОТОЙ)
grep -n 'DockablePane\|Dispatcher.Invoke' ComplianceScheduler.cs ComplianceState.cs
# Хүлээгдэх: ХООСОН

# --- 14. BUILD (Windows дээр, дөрвөн Revit хувилбар) ---
# dotnet build RevitMcpAddin.csproj -c "Release R27" -p:Platform=x64
# ⚠️ Revit нээлттэй бол -p:AddinDeployDir=C:\Temp\x -p:DeployToRevit=true

# --- 15. ХАМРАХ ХҮРЭЭНИЙ ХЯНАЛТ ---
cd ../..
git status --short
git diff --stat
# Зөвшөөрөгдсөн зам ЗӨВХӨН:
#   backend/migrations/0224_compliance_findings.sql
#   backend/migrations/0225_finding_links.sql
#   backend/migrations/0229_rule_run_ledger.sql
#   backend/src/lib/complianceModel.ts   (2-2 үүсгэсэн — ЗӨВХӨН НЭМЭЛТ)
#   backend/src/routes/compliance.ts
#   backend/src/index.ts
#   backend/src/lib/modules.ts
#   revit-mcp/addin/ComplianceScheduler.cs
#   revit-mcp/addin/ComplianceState.cs
#   revit-mcp/addin/RuleFactExtractor.cs
#   revit-mcp/addin/RevitTools.cs
#   revit-mcp/addin/RevitApi.cs
#   revit-mcp/addin/App.cs
#   docs/bim-ai/2-3-compliance-engine.md
# git add -A БҮҮ хэрэглэ — файл бүрийг нэрээр нь нэм.
```

**Гар туршилт (Revit нээлттэй, автоматжуулах боломжгүй):**

1. Дунд зэргийн загвар нээж, 20 хана зур. `timing.log`-ийн `doc.changed` p95-ыг өмнөх ажиллагаатай харьцуул — ЯГ ижил дараалалд байх ёстой.
2. Хонгилын өрөөний өргөнийг 1400 мм болго. **~2 секундын дараа** (`settle_ms = 1200` + планировщикийн ≤250 мс сэрэлт + bus + үнэлгээ) ribbon-ы товчны бичээс дээр тоо гарна. Ямар ч цонх нээгдэхгүй.
3. Өргөнийг 1600 мм болго. Дараагийн мөчлөгт тоо буурна (`FIXED`).
4. Ctrl+Z ×20. Add-in гацахгүй, сервер рүү 20 багц явахгүй.
5. Тэр өрөөний хилийн байрлалыг «Wall Centre» болго. Дүрэм ХАМААРАХГҮЙ болно — олдвор алга болж, `readiness_inputs`-д `skipped_reason='boundary_location'` гарна. **PASS гэж ХУДЛАА хэлэхгүй.**
6. LAN-аа сал. Зурах хэвийн, олдвор нь эргэж ирэхэд илгээгдэнэ.
7. «Synchronize with Central». Бүх олдвор саарал болж «дахин шалгах шаардлагатай» гэж харагдана.
8. Хоёр Revit хувилбарыг (2024 ба 2027) нэг PC дээр зэрэг нээ. Хоёулаа ажиллана, `%APPDATA%`-д мөргөлдөөн гарахгүй (pid дагавартай `.tmp`).

---

## 8. ROLLBACK

### 8.1 Migration хэрэгжүүлэхийн ӨМНӨ

Файлыг устгаад дуусав. **Өгөгдлийн эрсдэл: ТЭГ.**

### 8.2 Migration хэрэгжсэний ДАРАА

| Юу | Хэрхэн буцаах |
|---|---|
| `compliance_findings`, `finding_elements`, `finding_teams`, `finding_edges`, `rule_run_ledger` | ⚠️ **ШИНЭ ДУГААРТАЙ** migration-д `DROP TABLE IF EXISTS …`. Тавуулаа ШИНЭ хүснэгт, эцэг БИШ, каскад хүүхэдгүй тул `migrations apply`-аар DROP хийх нь АЮУЛГҮЙ (0206-ийн дөрвөн хамгаалагдсан хүснэгтийн аль нь ч энд ХАМААРАХГҮЙ). ⚠️ `rule_run_ledger`-ыг унагаавал `2-5` ба `2-7` хоёулаа компайл болох ч ГҮЙХ үедээ `no such table` авна — тэднийг мөн буцаа |
| `learning_events`-ийн `RULE_VALIDATION` мөрүүд | **БУЦААХ БОЛОМЖГҮЙ.** `0206:43-48` нь UPDATE-ыг ABORT хийнэ; DELETE нь trigger-т баригдахгүй ч 0205-ын append-only гэрээг зөрчинө. Тэдгээр мөр ҮЛДЭНЭ — тэд `parts_missing = 0` тул сургалтад тэнцэнэ. Хэрэв хордуулах эрсдэлтэй бол `redacted_at` замаар (нэг удаагийн redaction) далдал |
| Воркер | `npx wrangler deploy --config wrangler.toml` өмнөх commit-оос. `/api/compliance` алга болно; add-in 404 авч чимээгүй алгасана |
| Add-in | ⚠️ **АВТОМАТ БУЦААЛТ БАЙХГҮЙ.** ~20 PC × өмнөх zip × `Install.bat` × Revit хаалттай. Тиймээс тараахын ӨМНӨ өмнөх zip-ийг АРХИВЛАСАН байх ЁСТОЙ |

**⚠️ ШИНЭ ДУГААР ЗААВАЛ** — хэрэгжсэн 0224/0225/0229-ийг засах нь продакшн дээр **ЧИМЭЭГҮЙ NO-OP**.

### 8.3 Хагас хэрэгжсэн файл

Тээврийн дүрмийг зөрчвөл (>7 statement, блок тайлбар, мөрөн доторх `;`) файл ХАГАС хэрэгжиж, `d1_migrations` мөр БИЧИГДЭХГҮЙ. Тэгвэл:

1. `SELECT name FROM sqlite_master WHERE name LIKE 'compliance%' OR name LIKE 'finding%' OR name LIKE 'rule_run%'` — юу үүссэнийг тодорхойл.
2. Үүссэн объектуудыг ШИНЭ ДУГААРТАЙ файлд `DROP` хий.
3. Дараагийн ШИНЭ ДУГААРТАЙ файлд бүгдийг ДАХИН үүсгэ, statement-ийг 7-оос доош хуваа.
4. Хуучин 0224/0225/0229-ийг **БҮҮ ЗАС** — тэдгээрийг дараагийн `apply` ДАХИН ажиллуулна.

Бүх statement нь `IF NOT EXISTS` тул хагас хэрэгжсэн файлыг шинэ дугаараар ДАХИН ажиллуулах нь аюулгүй.

### 8.4 Rollback-ийн шалгуур

Дараах шинж тэмдгийн АЛЬ НЭГ нь гарвал add-in-ийг буцаа:

- Гүйлгээ бүрийн дараа Revit нүдэнд харагдахуйц гацна (`doc.changed` p95 хоёр дахин өссөн).
- Хэрэглэгч чатын дуудлага дээр «Хугацаа дууслаа … өмнөх үйлдэл дуусаагүй байна» гэж давтан хардаг (`Gate` өрсөлдөөн).
- `%APPDATA%\RevitMcpAddin\changes\*.json` шинэчлэгдэхээ больсон (`FlushDirty`-ийн `.tmp` мөргөлдөөн).
- Revit хаагдахдаа хэдэн секунд гацна (shutdown-д join хийсэн).
- Нэг өдөрт нэг инженерээс 2000-аас олон `RULE_VALIDATION` мөр ирж байна (мөрийн тэсрэлт, §3.4-ийн дүрэм ажиллаагүй).

Воркерийг буцаах шалгуур: `POST /api/compliance/findings` дээр 5xx > 1%, эсвэл `learning_events`-ийн өдрийн өсөлт хэвийнхээс 10 дахин их.

---

## 9. ЭХЛЭХИЙН ӨМНӨ ТОДРУУЛАХ

> Эдгээрийг репогоос ХАРИУЛАХ БОЛОМЖГҮЙ — эзэн, зохицуулагч эсвэл продакшны асуулга шаардана.

### 9.1 Зохицуулагчийн шийдвэр — инженерийн биш

| # | Асуулт | Яагаад чухал | Хэрхэн олох |
|---|---|---|---|
| 1 | **0229-ыг ӨӨР агент аль хэдийн аваагүй эсэх** (ХЭРЭГЖҮҮЛЭХИЙН ЯГ ӨМНӨ) | `README.md:142` нь 0229–0236-ыг НӨӨЦ гэж зарласан ба энэ баримт эхнийхийг нь авлаа (§3.0). Хоёр агент нэг дугаар авбал migration хагас хэрэгжинэ, `d1_migrations` мөр бичигдэхгүй | `ls backend/migrations \| tail -5`. Эзэнтэй бол дараагийн чөлөөт нөөц дугаарыг ав (0230…) ба §3.0, §5, §7-ийн зам БҮГДИЙГ шинэчил |
| 2 | ~~`rule_run_ledger`-ийг хэн эзэмших вэ~~ — **ШИЙДЭГДСЭН: ЭНЭ БАРИМТ, `0229`-т (§3.3).** | `2-5:5` ба `2-7:5` хоёулаа «`2-3` үүсгэнэ» гэж бичсэн, `2-7` нь migration ОГТ АВДАГГҮЙ (`README.md:139`), `0224`/`0225` хоёулаа 7 statement дүүрсэн. Эзэнгүй үлдвэл `project_threads`-ийн алдаа давтагдана: продакшн дээр л оршдог, дискэн дээр `CREATE TABLE` нь байхгүй хүснэгт | Асуулт үлдээгүй. Зөвхөн №1-ийн дугаарын мөргөлдөөнийг шалга |
| 3 | **`ComplianceScheduler`-ийн THREAD-ыг `2-4` өгөх нь батлагдсан уу?** | Урьдчилсан төлөвлөгөөний нэг уншлага «одоо байгаа 3 секундын таймер дээр» гэсэн. §2.3-т хэмжсэнээр тэр таймер ДАВТАМЖИТ ба ажил нэмбэл өдрийн өөрчлөлт ЧИМЭЭГҮЙ алдагдана. Энэ баримт `2-4`-ийн зориулалтын thread-ийг сонгосон | `2-4`-ийн зохиогчоос |

### 9.2 Техникийн — прод/алсын D1 дээр л шалгагдана

| # | Асуулт | Яагаад чухал | Хэрхэн олох |
|---|---|---|---|
| 4 | **0212–0216 продакшн дээр хэрэгжсэн үү?** | ТААМАГ: энэ машинаас алсын D1-д хүрэх боломжгүй байсан (Cloudflare API алдаа **7403 not authorized**). Хэрэгжээгүй бол add-in аль хэдийн байхгүй багана руу бичиж байна | §7 №1 |
| 5 | ~~**Амьд `teams` бүртгэл юу вэ?**~~ — **ШИЙДЭГДСЭН: ЭЗЭН БАТАЛСАН, 2026-08-30.** | Эзэн: «MGMT-ийг хасаад үлдсэн 8-н багийг оруулна». Pack авах дисциплинүүд нь `teams.sort_order`-ийн дарааллаар **BA · BB · HAS · TSBU · TSAH · HD · AU · IZ** (v2 §46). `teams` хүснэгтэд АРВАН НЭГ мөр: `0007_teams.sql:39-47` нь энэ найм + `MGMT`, `0074_seed_ez_gt_teams.sql:12-14` нь `EZ` + `GT`. Баталгаажсан найм = `TeamReportsTab.tsx:52-61`-ийн `IMPLEMENTED_TEAMS`. **`MGMT` / `EZ` / `GT` нь pack АВАХГҮЙ ба ЮУГААР Ч шалгагдахгүй** — `TEAM = UNCERTAIN` (v2 §48), §3.5 ба §3.6-ийн ШАТ 0. ⚠️ **Наймыг код руу ХАТУУ БИЧИХГҮЙ нь ХЭВЭЭР** — `owner_team_code` нь ажиллах үедээ `teams.code`-оос ирнэ; найм нь ТӨЛӨВЛӨЛТИЙН тоо (хэдэн pack бичих вэ), компайлд орох литерал БИШ. ⚠️ Багийн **ГИШҮҮНИЙ ТОО** нь ШИЙДЭГДЭЭГҮЙ ХЭВЭЭР — энэ машинаас алсын D1-д хүрэхгүй (Cloudflare **7403**) | Бүртгэл: эзний баталгаа (2026-08-30), асуулт үлдээгүй. Гишүүний тоо, продакшны мөрийн тоо: `SELECT code, name_mn, sort_order FROM teams ORDER BY sort_order` — алсын D1 нээгдэх үед |
| 6 | **`bim_sessions` дээр одоо хэдэн мөр байна вэ?** | Үйл явдлын агуулагт ҮЙЛДВЭРЛЭГЧ БАЙХГҮЙ (`grep 'api/learning' revit-mcp/addin/*.cs` хоосон). Хоосон бол олдворын хэмжээний тооцоо бүр таамаг | `SELECT COUNT(*) FROM bim_sessions` |

### 9.3 Хэмжигдээгүй — хэн ч тоолоогүй

| # | Асуулт | Яагаад чухал | Хэрхэн олох |
|---|---|---|---|
| 7 | **Нэг инженер өдөрт хэдэн Revit гүйлгээ хийдэг вэ?** | 1B-1 §9 нь 40–200/өдөр гэдгийг ТОДОРХОЙ ТААМАГ гэж бичсэн. `MaxDirtyPerPass = 400`, `EvalAbortMs = 2000`, мөчлөгийн давтамж — бүгд энэ тооноос хамаарна | Нэг өдөр багажлаад `%APPDATA%\RevitMcpAddin\timing.log` унших |
| 8 | **`collect_rule_inputs` нь 150 элемент дээр ХЭДЭН миллисекунд авах вэ?** | ТААМАГ: 400 мс p95. Хэмжээгүй. Хэрэв 2000 мс бол дуудлага тутмын хязгаарыг бууруулна | Нэг PC дээр `timing.log`-ийн `input.collect` |
| 9 | **Нэг олдвор гарахад хүлээн зөвшөөрөгдөх ХОЦРОЛТ хэд вэ?** | Энэ загварын БҮТЦИЙН доод хязгаар нь **~1.5–2 секунд**: `bim.compliance.settle_ms` = 1200 мс нэгтгэл + планировщикийн ≤250 мс сэрэлт + ~50 мс bus poll + үнэлгээ. ⚠️ `ChangeTracker.FlushIntervalMs` = 3000 (`ChangeTracker.cs:55`, `:313`) нь ЭНЭ ЗАМД БАЙХГҮЙ — `2-4` §3.14 нь планировщикийг өөрийн `IsBackground` thread дээр («ШИНЭ Timer БАЙХГҮЙ») тавьсан, ба §0 №11 нь тэр таймер дээр ажил нэмэхийг ХОРИГЛОНО. Тоо нь `app_settings`-аас ирдэг тул DLL-гүйгээр тохируулагдана. `Gate.Wait(0)` алгасалт ба defer-хаалт нь завгүй машин дээр түүнийг хэдэн арван секунд болгож БОЛНО — САНААТАЙ. §30 нь 250 мс-ыг ерөнхий SLO болгохыг ХОРИГЛОДОГ | Эзнээс |

### 9.4 Эзний шийдвэр

| # | Асуулт | Яагаад чухал | Хэрхэн олох |
|---|---|---|---|
| 10 | **Ажилтны мэдэгдэл, гэрээ ШИНЭЧЛЭГДСЭН үү?** | Commit `9fe82a0` нь 0195-ын «геометр, файлын агуулга ОГТ ОРОХГҮЙ» амлалт ЦУЦЛАГДСАН, «Ажилтны мэдэгдэл, гэрээ ЗААВАЛ шинэчлэгдэнэ» гэж бичсэн. `bim.capture.notice_version` нь **2026-09-01** — ИРЭЭДҮЙН огноо. Олдвор нь элементийн id, өрөөний нэр, хэмжээг агуулна — үйл явдлын агуулгаас ЧАНГА. Энэ бол deploy-ийн УРЬДЧИЛСАН НӨХЦӨЛ | Эзнээс |
| 11 | **Олдворыг зөвхөн үүсгэсэн хүн харах уу, эсвэл багийн ахлагч төслийн олдворыг харах уу?** | ЗӨВХӨН ӨӨРИЙГӨӨ ХАРАХ дүрэм нь дөрвөн migration-ийн толгойд бичигдэж, `revitNoteAi.test.ts:262`-оор түгжигдсэн. Энэ загвар нь НЭГТГЭСЭН-ийг өгөгдмөл болгосон. Илүү ихийг нээх нь дөрвөн удаа баримтжуулсан дүрмийг өөрчилнө | Эзнээс |
| 12 | **Шөнийн бүтэн скан хүсэж байна уу, тийм бол аль машин дээр?** | `BatchQto` нь бэлэн, хараа хяналтгүй detached host өгдөг. Энэ релиз тэнд нийцлийг ЗОРИУДААР унтраасан (§3.14 №2). Асуудал нь хуваарь ба тооцоолол — инженерийн биш | Эзнээс |

### 9.5 `2-2` / `2-4`-ээс тодруулах гэрээ

| # | Асуулт | Яагаад чухал |
|---|---|---|
| 13 | `RuleEngine.Evaluate(RuleDef, FactSet)` нь `RuleOutcome`-ыг ЯГ ямар талбартай буцаах вэ? | §3.6-ийн `state.Apply` нь `Verdict`, `Severity`, `IssueClass`, `EvidenceLevel`, `UncertainReason`, `CalcJson`, `EvidenceJson` шаардана |
| 14 | `LogicalChangeSet.Elements` нь `Category`, `Change`, `ElementUid` талбарыг агуулах уу? | ⚠️ `ChangeTracker` нь `long` id Л хадгалдаг — категори нь HOT замд бичигдэх ёстой, эс тэгвээс энэ хөдөлгүүр бүр элемент дээр `doc.GetElement` дуудаж, ХҮЙТЭН эгнээ рүү нэмэлт тойрог үүсгэнэ |
| 15 | `RulePack`-ийн `PackSha256` ба `RulesetVersion` нь `RuleTriggerIndex.Build`-д ирэх үү? | Тэдгээр нь олдвор бүрд хөлдөж, хуучруулах гох №3-д хэрэгтэй |
| 16 | **`2-4` нь SYNC ДУУССАН дохиог ХЭРХЭН өгөх вэ?** (`LogicalChangeSet` дээрх туг уу, эсвэл `ChangeTracker`-ийн callback уу) | `Suppressed.Add`/`Remove` нь `ChangeTracker.cs:622/:633/:715`-д ба тэр файл нь **`2-4`-ийн харьяа** — энэ сессийн «Хөндөх файлууд»-д БАЙХГҮЙ. Одоогийн `LogicalChangeSet` (`2-4` §3.8: `DocKey`, `FirstSeq`, `LastSeq`, `ElementIds`, `CloseReason`, `MayCollect`, `Coarse`, `UndoBurst`) дээр ийм туг БАЙХГҮЙ. Дохиогүй бол §58-ын НЭГДҮГЭЭР гох — worksharing-ийн цорын ганц гох — хэрэгжихгүй ба BA нь BB-ийн аль хэдийн зассан хонгил дээр `VIOLATION` харсаар байна (§2.6) |
| 17 | **Дүрэм → дүрмийн ШАЛТГААНЫ зарлалт pack-д орох уу?** (`caused_by_rule_uids`) | §3.12-ын `causes` ирмэг нь ЗӨВХӨН элементийн хамаарлаас (`subject` ⊂ өөр олдворын `context`) гардаг — детерминист, гэхдээ ХЭСЭГЧИЛСЭН. §77-ийн бүтэн гинж (хонгил → хүртээмж → хаалга → өрөө) нь дүрэм өөрөө шалтгаанаа зарлахыг шаардаж болно. `rule_deps` (`2-2`, 0221) нь дүрэм → (категори / параметр / контекст / хамаарал) л зарладаг, дүрэм → дүрэм БИШ; `rule_conflicts` нь ЗӨРЧИЛ л зарладаг. Хэрэв бүтэн гинж хэрэгтэй бол шийдвэр нь `2-2`-ынх, ЭНЭ сессийнх БИШ |

### Хавсралт — ЭНЭ СЕССЭД БАТАЛГААЖУУЛААГҮЙ (ТААМАГ)

| Мэдэгдэл | Төлөв |
|---|---|
| 0212–0216 продакшн дээр хэрэгжсэн | **ТААМАГ** — алсын D1-д хүрэх боломжгүй (Cloudflare 7403) |
| Pack авах багуудын БҮРТГЭЛ — найм: BA · BB · HAS · TSBU · TSAH · HD · AU · IZ | **ТААМАГ БИШ: ЭЗЭН БАТАЛСАН, 2026-08-30** (v2 §46, §3.5, §9.2 №5). `teams`-ийн 11 мөр нь migration-оос уншигдсан (`0007:39-47` + `0074:12-14`) ба `TeamReportsTab.tsx:52-61`-тэй тааруулж шалгасан |
| `teams`-ийн ПРОДАКШНЫ мөрийн тоо ба багийн ГИШҮҮНИЙ тоо | **ТААМАГ ХЭВЭЭР** — алсын D1-д хүрэх боломжгүй (Cloudflare 7403). Бүртгэл нь шийдэгдсэн, тоонууд нь ҮГҮЙ |
| `collect_rule_inputs`-ийн 400 мс p95 төсөв | **ТААМАГ** — хэмжээгүй. `revit-mcp/dist/` байхгүй, add-in-ийг CI хэзээ ч барьж байгаагүй |
| `MaxDirtyPerPass = 400`, `EvalAbortMs = 2000`, `EvalSoftBudgetMs = 250` | **ТААМАГ** — үйл явдлын хурд хэмжигдээгүй. 30 хоногийн өгөгдлийн дараа л ЭЦСИЙН SLO болно |
| Нэг өдөрт 2000 олдвор нь дээд хязгаар байх нь зөв | **ТААМАГ** — `bim.capture.elements_per_session = 4000` (`0208:20`)-ийн толин тусгал, бие даасан үндэслэлгүй |
| `AreaVolumeSettings` нь бодит MGL төсөлд «Finish» уу | **ТААМАГ** — нэг ч бодит өндөр барилгын загвар нээгээгүй. Хэрэв «Wall Centre» бол өрөөний геометрийн дүрэм ХЭВЛЭГДЭХГҮЙ (2-2-ийн асуудал) |
