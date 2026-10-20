# 2-4-nonblocking-runtime — халуун/арын замын хуваалт, debounce ба нэгтгэл, доройтсон горим, мэдэгдлийн ядаргаа

> **Track:** 2 · NON-BLOCKING RUNTIME. Эзний R7 шаардлагыг («огт гацалт байхгүй, гараар ym hiih shaardlaguigeer realtime») БҮРЭН эзэмшинэ.
> **v2 хэсэг:** §30 (гүйцэтгэлийн архитектур) · §31 (халуун замд инференс байхгүй) · §32 (арын AI гүйцэтгэл) · §53 (ажлын урсгалыг ХЭЗЭЭ Ч тасалдуулахгүй) · §54 (HOT / BACKGROUND хуваалт) · §55 (debounce / coalesce ба түүхийг хадгалах) · §75 (офлайн / доройтсон горим) · §76 (мэдэгдлийн ядаргаа). Нэмэлтээр §82-ын «bounded AI resource usage» шалгуурыг хэмжигдэхүйц болгоно.
> **Хамаарал (depends on):** `2-1-team-context` — `bim_sessions`-ийн багийн дөрвөн талбар. `BimEmitter` нь тэр талбаруудыг илгээх мөчид ТАМГАЛНА (JOIN-оор БИШ), тиймээс 2-1-ийн миграц ЭНЭ баримтын кодоос ӨМНӨХ deploy-д гарсан байх ёстой. 2-2 (дүрмийн загвар) ба 2-3 (compliance хөдөлгүүр) хоёроос СХЕМИЙН хувьд ХАМААРАХГҮЙ.
> **Блоклож буй (blocks):** `2-3-compliance-engine` (планировщик нь ЭНЭ баримтын thread ба RawRing дээр ажиллана), `2-5-finding-surface` (илрүүлэлт нь FindingFeed ба Nudges-ийн төсвөөр гарна), `2-7-readiness-and-quality` (FP/FN ба бэлэн байдлын хаалга нь ЭНД үүсэх perf ба notice өгөгдлийг уншина).
> **Хөндөх файлууд (17):** `backend/migrations/0226_perf_scalars.sql` (ШИНЭ), `backend/migrations/0227_compliance_notice_state.sql` (ШИНЭ), `backend/migrations/0228_compliance_settings.sql` (ШИНЭ), `backend/migrations/0230_compliance_authority.sql` (ШИНЭ), `backend/src/routes/learning.ts`, `backend/src/lib/bimEvents.ts` (⚠️ `2-1-team-context` МӨН хөнддөг — `SESSION_INSERT_COLUMNS`-д багийн 4 талбарынх нь ДАРАА `perf_json`-ыг ЗАЛГА, дарааллыг БҮҮ өөрчил), `backend/src/routes/compliance.ts` (**ШИНЭ БИШ** — файл, `new Hono()`, файлын түвшний `requireRole` хамгаалалт, `index.ts`-ийн `app.route` ба `lib/modules.ts`-ийн ангилал нь `2-2-rule-model`-ынх; энэ сесс ЗӨВХӨН гурван handler НЭМНЭ), `revit-mcp/addin/ChangeTracker.cs`, `revit-mcp/addin/RevitToolBus.cs` (`TryCall` · `UserBusy` · `CancelAll` — §3.12), `revit-mcp/addin/ChangeSetCoalescer.cs` (ШИНЭ), `revit-mcp/addin/BimEmitter.cs` (ШИНЭ), `revit-mcp/addin/AiHttp.cs` (ШИНЭ), `revit-mcp/addin/Percentiles.cs`, `revit-mcp/addin/App.cs`, `revit-mcp/addin/BatchQto.cs`, `revit-mcp/addin/ApiClient.cs`, `revit-mcp/training/check_changeset.py` (ШИНЭ). **ӨӨР ФАЙЛ БАЙХГҮЙ** — тухайлбал `backend/src/index.ts` ба `backend/src/lib/modules.ts` нь ЭНЭ сессийн харьяа БИШ (`2-2`-ынх).
> **Deploy тоо:** 2 (1 × `d1 migrations apply` → 1 × `wrangler deploy`). Migration 4 файл. Add-in (C#) нь ТУСДАА deploy БИШ — Track 2-ын БҮХ C# өөрчлөлт НЭГ РЕЛИЗИД багцлагдана. Frontend deploy ШААРДЛАГАГҮЙ.

---

## 0. ЭНЭ СЕССИЙН ДҮРЭМ

**Хамрах хүрээ (scope).** Энэ сесс нь ГҮЙЦЭТГЭЛИЙН НУРУУГ барина: халуун замын нэмэлт, өөрчлөлтийн нэгтгэгч, арын thread дээрх бат бөх дараалал, тусдаа HTTP тээвэр, латентын хэмжүүр, доройтсон горимын шат, мэдэгдлийн төсөв. **ЭНЭ СЕСС НЭГ Ч ДҮРЭМ БИЧИХГҮЙ, НЭГ Ч ИЛРҮҮЛЭЛТ ҮҮСГЭХГҮЙ.** Дүрмийн загвар нь 2-2, хөдөлгүүр нь 2-3, гадаргуу нь 2-5-д харьяалагдана. Энэ баримтын үр дүн нь тэднийг ажиллуулах ХӨРС.

**Бусад агентуудтай зэрэг ажиллаж байна.** Ажлын мод дээр өөр агентуудын дуусаагүй, магадгүй ЭМХЭТГЭГДЭХГҮЙ өөрчлөлт байж болно. Зөвхөн дээрх жагсаалтын файлыг хөнд. `npm run build` бүтэлгүйтвэл алдаа ЧИНИЙ файлд байгаа эсэхийг эхлээд шалга — өөрийн биш бол эзэнд мэдэгд, битгий зас.

**Deploy хийж болох уу?** Тийм, гэхдээ ЗӨВХӨН энэ дарааллаар: миграц → worker. C#-ыг ХЭЗЭЭ Ч дангаар нь тараахгүй.

**ЭНЭ СЕССИД ХЭЗЭЭ Ч ХИЙЖ БОЛОХГҮЙ:**

| ⛔ | Дүрэм | Яагаад — бодит үр дагавар |
|---|---|---|
| 1 | `/api/*` дээр `purpose === 'mcp'` токеныг ТАТГАЛЗАХГҮЙ | Add-in нь REST дуудлага бүрийг 365 хоногийн mcp токеноор гарын үсэг зурдаг, сэргээх урсгал БАЙХГҮЙ. ~20 компьютер, `Install.bat`, Revit хаалттай. Энэ бол АЛСААС сэргээх БОЛОМЖГҮЙ цорын ганц өөрчлөлт. `middleware/auth.ts:101-102`, `types.ts:209-212`, `lib/tokenValidity.ts:30-34` гурван газарт бэхлэгдсэн. |
| 2 | `users` (19 cascade хүүхэд) эсвэл `projects` (33) -ийг `migrations apply`-аар ДАХИН БҮТЭЭХГҮЙ | `migrations apply` нь файл бүрийг гүйлгээнд ороодог ба тэнд cascade ФИРНЭ — эцгийг унагаахад бүх хүүхэд мөр устана. Энэ сесс тэр хоёрыг ОГТ хөндөхгүй. |
| 3 | Хэрэгжсэн миграцийг ЗАСАХГҮЙ | Продакшн дээр ЧИМЭЭГҮЙ NO-OP. Бичихийн ӨМНӨ `ls backend/migrations \| tail -5` ажиллуул. |
| 4 | Trigger дотор `END;` нь ТОМ ҮСГЭЭР, ӨӨРИЙН МӨРӨНД | wrangler-ийн задлагчийн regex нь том/жижиг үсэг ЯЛГАНА. Энэ сессэд trigger байхгүй ч дүрэм хүчинтэй. |
| 5 | `OnDocumentChanged`, `RevitToolEventHandler.Execute`, найдвартай (trusted) замд ИНФЕРЕНС ТАВИХГҮЙ | ⛔ гэрээ нь `ChangeTracker.cs:769-775` ба `RevitToolBus.cs:442-454`-д БИЧИГДСЭН. Зөвшөөрөгдсөн цорын ганц суулгац нь `AssistantPane`-ийн `DecidedBy.Fallback` салаа, арын thread дээр. |
| 6 | `DocumentChanged` ДОТОР баримт нь ЗӨВХӨН УНШИХ | Гүйлгээ нээхгүй, элемент өөрчлөхгүй, `Regenerate()` дуудахгүй, **ФАЙЛ БИЧИХГҮЙ**, сүлжээ хөндөхгүй. `ChangeTracker.cs:44-51` энэ дүрмийг өөрөө бичсэн; түүний орлуулсан сканнер 120+ секунд авдаг байв. |
| 7 | `ChangeTracker.Gate`-ийг bus дуудлага, диск бичилт, `await` ДЭЭГҮҮР БАРИХГҮЙ | `OnDocumentChanged` нь ГҮЙЛГЭЭ БҮРТ Revit-ийн үндсэн thread дээр `lock (Gate)` авдаг (`ChangeTracker.cs:798`). Түгжээ барьсан хэвээр `collect_rule_inputs` хүлээх нь хэрэглэгчийн дараагийн хулганы чирэлтийг хэрэгслийн БҮТЭН хугацаанд гацаана. Snapshot ав → тавь → дараа нь дууд. |
| 8 | `DockablePane.Show()`-г АВТОМАТААР ДУУДАХГҮЙ | Add-in дахь цорын ганц `Show()` нь хэрэглэгчийн ribbon товч (`AssistantPaneProvider.cs:54`). Автоматаар нээх нь файл нээх бүрд ~300 px ба фокусыг хулгайлна — R7-ын хамгийн магадлалтай регресс. |
| 9 | `ChangeTracker.Gate` эсвэл bus-ийн `Gate` барьж болох thread-ээс `Dispatcher.Invoke` ХИЙХГҮЙ | UI thread нь өөрөө `lock (Gate)`-д хүлээж байж болно; түгжээ барьсан талаас түүн рүү marshal хийх нь ХОЁР THREAD-ИЙН ГАЦАА бөгөөд хэрэглэгчид «Revit өлгөгдлөө» гэж харагдана. |
| 10 | C#-ийн өөрчлөлт бүр НЭГ РЕЛИЗЭД | Автомат шинэчлэл БАЙХГҮЙ, ~20 компьютер, Revit хаалттай. Юуг ч «дараагийн релиз»-д үлдээж БОЛОХГҮЙ; хагас бэлэн релизийг БҮХЭЛД НЬ хойшлуулна (`1C-addin-release.md:11-14`). |
| 11 | Салбарын тоог (7 / 8 / 9 / 11) ХАТУУ БИЧИХГҮЙ | Ажиллах үед `teams.code`-оос уншина. **ЭЗЭН БАТАЛСАН 2026-08-30:** дүрмийн багц авах салбарын баг нь ЯГ НАЙМ — BA · BB · HAS · TSBU · TSAH · HD · AU · IZ (v2 §46). `teams` нь АРВАН НЭГ мөртэй хэвээр (0007-ийн 9 + 0074-ийн EZ, GT) ба **MGMT · EZ · GT нь багц АВАХГҮЙ**. Тэр найм нь ТӨЛӨВЛӨЛТИЙН баримт — кодод бичих ЛИТЕРАЛ БИШ. Багцтай олонлог нь АРГУМЕНТ, тоо нь ажиллах үед `teams.code`-оос гарна. *Тэмдэглэл (2026-08-30):* эзэнд `0007_teams.sql`-ийн ЕС мөрийг үзүүлж «MGMT-ийг хасаад үлдсэн 8» гэсэн хариу авсан; 0074-өөр НЭМЭГДСЭН EZ ба GT-г нэрээр нь ТУСГАЙЛАН асуугаагүй — тэдгээр нь тэр наймын ГАДНА байгаа ба инженерийн салбар БИШ, төслийн блокийн угтвар баг тул дүгнэлт хүчинтэй. §9.1-c-г үз. |
| 12 | Өөр агентын хадгалаагүй ажлыг ХӨНДӨХГҮЙ | `git restore` / `checkout --` / `stash` / `reset` / `git add -A` — АЛЬ НЬ Ч БАЙХГҮЙ. |

---

## 1. КОНТЕКСТ

### 1.1 НЭРШИЛ — эхлээд үүнийг тогтооно

v2 нь нэг хилийг ХОЁР нэрээр дуудна: §31 нь `FAST PATH` / `AI PATH` (:1039-1051), §54 нь `HOT PATH` / `BACKGROUND PATH` (:1852-1867). **Track 2 нь §54-ийн үгсийг ЗААВАЛ хэрэглэнэ — HOT / BACKGROUND / COLD / REMOTE.** §31-ийн `FAST PATH` / `AI PATH` нэр нь шинэ код, шинэ тайлбар, шинэ метрикийн нэрэнд ХЭЗЭЭ Ч гарахгүй.

Энэ нь дур зоргын сонголт биш: шипсэн монгол тайлбарууд аль хэдийн «халуун зам» гэж бичсэн байна — `ChangeTracker.cs:775` ба `RevitToolBus.cs:442`-ийн ⛔ блокууд. §54-ийг сонгох нь ЗЭРЭГ ЮУ Ч ӨӨРЧЛӨХГҮЙ; §31-ийг сонгох нь одоо байгаа тайлбаруудыг дахин бичихийг шаардана. Хоёр нэр НЭГ ЗЭРЭГ орших нь хамгийн муу: дараагийн хүн `Metrics.FastPath` ба `Metrics.HotPath` хоёрыг өөр өөр зүйл гэж бодно.

**Дөрвөн зам, дөрвөн дүрэм:**

| Зам | Хаана ажиллана | Юу зөвшөөрөгдөнө | Юу ХОРИОТОЙ |
|---|---|---|---|
| **HOT** | `ChangeTracker.OnDocumentChanged`, Revit-ийн ҮНДСЭН thread, гүйлгээ бүрд | Олонлогийн алгебр, `RawRing.Append`, тоолуур | Revit API-ийн НЭМЭЛТ дуудлага, диск, сүлжээ, инференс, дурын хуваарилалт |
| **BACKGROUND** | Өөрийн `IsBackground` worker thread (Coalescer, BimEmitter) | Цэвэр тооцоо, дараалал, JSON, диск, HTTP | `Autodesk.Revit`-ийн ЯМАР Ч төрөл, `Gate` барих, `Dispatcher.Invoke` |
| **COLD** | `RevitToolBus` → `ExternalEvent` зүсэлт, Revit үндсэн thread | Геометр унших, ribbon caption бичих | Инференс, сүлжээ, модаль цонх, дотоод төсөвгүй урт гүйлгэлт |
| **REMOTE** | `AiHttp`-ийн ТУСДАА `HttpClient`, 20 с | Сервер рүү багц илгээх, дүрмийн багц татах | `ApiClient.Http` (180 с)-ыг дахин ашиглах |

### 1.2 Систем (хүйтэн сессид хангалттай хэмжээгээр)

| Хэсэг | Юу вэ |
|---|---|
| Backend | Cloudflare Worker — `@cloudflare/workers-oauth-provider` дотор Hono. D1 + R2 + KV + нэг Durable Object + Workers AI |
| Frontend | Vite + React 19 SPA → Cloudflare Pages, төсөл нь `mgl-design-system` |
| Add-in | `revit-mcp/addin/` — 46 `.cs` файл, ~15 400 мөр, C# ТЕСТ ТЭГ, автомат шинэчлэл БАЙХГҮЙ, ~20 ажилтны компьютер, `Install.bat`, Revit хаалттай байх шаардлагатай |
| Migration | `backend/migrations/` дээрх хамгийн өндөр файл нь **0216_assistant_log_timing.sql** (2026-08-30-нд `ls … \| tail -5`-аар баталсан) |
| BIM бүртгэл | Миграц 0201–0210 бүрэн шипсэн. **ҮЙЛДВЭРЛЭГЧ БАЙХГҮЙ** — `grep -rn 'api/learning' revit-mcp/addin/*.cs` ТЭГ мөр буцаана |

### 1.3 Яагаад энэ даалгавар байна вэ

1. **0201–0210 нь бүрэн баригдсан, бүрэн ХООСОН дэвтэр.** Сервер тал (`POST /api/learning/events`, `learning.ts:279`) хүлээж байна; C# илгээгч БАЙХГҮЙ. R1 («really collect data with no mistake») нь ЯГ ЭНЭ нэг зүйл дээр блоклогдож байна.
2. **Латентын суурь ТЭГ.** `revit-mcp/dist/` байхгүй, CI нэг ч удаа add-in барьж байгаагүй, `timing.log` нь ЗӨВХӨН локал (512 KB, нэг эргэлт). «250 мс» гэсэн шаардлагыг өнөөдөр НОТЛОХ БОЛОМЖГҮЙ.
3. **`_flushTimer` нь ДАВХАЦДАГ.** `ChangeTracker.cs:313` нь ҮЕ ҮЕИЙН (periodic) `Timer` үүсгэдэг. Өнөөдөр callback нь миллисекунд тул давхцахгүй; 2 секундын дүрмийн гүйлгэлт эсвэл 20 секундын POST нэмбэл давхцал ЖИГД болно — үр дүн нь өдрийн бүх өөрчлөлт ЧИМЭЭГҮЙ алдагдах.
4. **`Nudges` нь нэг ч удаа ажиллаагүй.** `grep -rn 'Nudges\.' revit-mcp/addin/*.cs` (өөрийнх нь файлаас гадна) ТЭГ мөр буцаана; цорын ганц дурдлага нь `ChangeTracker.cs:402`-ийн ТАЙЛБАР. §76-ын төсөв нь архитектурын хувьд шийдэгдсэн, ҮЙЛДЛИЙН хувьд ОГТ ажиллаагүй.
5. **Илгээгдээгүй бүртгэл сесс бүрд ДАХИН илгээгддэг.** `AssistantLog.cs:108` нь `Sent`-ийг `[JsonIgnore]` гэж тэмдэглэсэн тул диск дээр хадгалагддаггүй. `BimEmitter` энэ алдааг ДАВТАХГҮЙ.
6. **Офлайн дараалал ХЯЗГААРГҮЙ.** «Queue only» гэдэг нь өнөөдөр ямар ч багтаамж, ямар ч backoff, ямар ч алдагдлын тоолуургүй.

---

## 2. БАТАЛГААЖСАН ОДООГИЙН ЗАН ТӨЛӨВ

> Доорх `file:line` бүрийг энэ сесс өөрөө нээж баталгаажуулав (**2026-08-30**, commit `6a8e4f5`). Мөрийн дугаар буруу байх нь эшлэлгүй байхаас ДОР — хүйтэн сессийг худал зам руу явуулна.

### 2.1 Есөн Revit үйл явдал, ХОЁР бүртгэлийн цэг — батлагдсан

```
ChangeTracker.cs:296   app.DocumentChanged += OnDocumentChanged;
ChangeTracker.cs:302   app.DocumentOpened += OnDocumentOpened;
ChangeTracker.cs:303   app.DocumentCreated += OnDocumentCreated;
ChangeTracker.cs:307   app.DocumentSynchronizingWithCentral += OnSuppressStart;
ChangeTracker.cs:308   app.DocumentSynchronizedWithCentral += OnSuppressEnd;
ChangeTracker.cs:309   app.DocumentReloadingLatest += OnSuppressStart;
ChangeTracker.cs:310   app.DocumentReloadedLatest += OnSuppressEnd;
BatchQto.cs:42         application.ControlledApplication.ApplicationInitialized += OnApplicationInitialized;
```

`Idling`, `ViewActivated`, `SelectionChanged`, `DocumentSaving`, `DialogBoxShowing`, `FailuresProcessing` — **АЛЬ НЬ Ч БАЙХГҮЙ**. Үр дагавар: Revit-ийн үндсэн thread дээр «сул зуур» гэсэн хямд зүсэлт БАЙХГҮЙ, тиймээс геометрийн уншилт бүр `RevitToolBus`-ийн `ExternalEvent`-ээр л явна.

### 2.2 ХАЛУУН ЗАМЫН ГЭРЭЭ — Revit API-д ганц дуудлага

| Баримт | file:line | Бодит код / текст |
|---|---|---|
| ⛔ гэрээ | `ChangeTracker.cs:769-775` | «⛔ ИНФЕРЕНС ЭНД ХЭЗЭЭ Ч БАЙХГҮЙ … Одоо энд диск ч хөндөхгүй; сүлжээ хөндөх нь тэрнээс ХЭДЭН ЗУУ дахин дор.» |
| Уншихад БАРИНА | `ChangeTracker.cs:44-51` | «Revit нь `DocumentChanged`-ийн үед баримтыг УНШИХ горимд барина … Мөн ФАЙЛ БИЧИЖ БОЛОХГҮЙ» |
| Цорын ганц API дуудлага | `ChangeTracker.cs:792-795` | `string opName = OpNameOf(e);` — тайлбар нь «Revit-ийн API-д хандах ЦОРЫН ГАНЦ дуудлага, түгжээнээс ГАДНА» гэж бичсэн |
| Тэр дуудлага ҮНЭГҮЙ | `ChangeTracker.cs:724`, `:743` | «⚠️ ЭНЭ НЬ ҮНЭГҮЙ. `GetTransactionNames()` нь үйл явдлын өгөгдөлд аль хэдийн байгаа» · `IList<string> names = e.GetTransactionNames();` |
| undo/redo угтвар үнэгүй | `ChangeTracker.cs:753` | `case UndoOperation.TransactionUndone: return "undo:" + name;` |
| Түгжээ | `ChangeTracker.cs:798` | `lock (Gate)` — ГҮЙЛГЭЭ БҮРТ, Revit-ийн үндсэн thread дээр |
| Sync/reload эрт гарц | `ChangeTracker.cs:801` | `if (Suppressed.Contains(key)) return;` |
| Алдаа шидэхгүй | `ChangeTracker.cs:891-896` | «Үйл явдлын боловсруулагчаас шидэгдсэн алдаа нь хэрэглэгчийн ЗУРЖ БАЙГАА гүйлгээг тасалж болно» |

**Дүгнэлт:** халуун замд нэмэх боломжтой цорын ганц зүйл бол одоо байгаа гурван давталтын АЛЬ ХЭДИЙН тоолсон утгуудаас бүрдсэн бичлэг. Шинэ Revit API дуудлага НЭМЭХГҮЙ.

### 2.3 ГАЦААНЫ АНГИ 1 — өөрийгөө хүлээх (self-deadlock)

```
RevitToolBus.cs:203-205   (гэхдээ Revit-ийн ҮНДСЭН thread-ээс БИШ — тэгвэл өөрийгөө хүлээж
                           гацна; UI thread-ээс дуудахдаа `Task.Run`-аар оруул)
RevitToolBus.cs:264       int deadline = Environment.TickCount + Math.Max(1, timeoutSeconds) * 1000;
RevitToolBus.cs:266       if (!Gate.Wait(Math.Max(1, timeoutSeconds) * 1000))
```

`Call` нь `ExternalEvent`-ийг хүлээдэг ба түүнийг ЗӨВХӨН Revit-ийн үндсэн thread гүйцэтгэнэ. UI thread-ээс дуудвал Revit нь `timeoutSeconds`-ийн БҮТЭН хугацаанд өлгөгдөнө.

⚠️ **Хамгаалалт нь ЗӨВХӨН ЗАН ЗАНШИЛ.** `grep -rn "CheckAccess\|VerifyAccess" revit-mcp/addin/*.cs` нь ТЭГ мөр буцаана. Ямар ч assert, ямар ч runtime шалгалт байхгүй — зөвхөн дуудагч бүр `Task.Run` бичих дадал. Track 2-ын шинэ дуудагч нэг удаа мартвал ~20 компьютер дээр Revit хөлдөнө.

### 2.4 ГАЦААНЫ АНГИ 2 — түгжээний өрсөлдөөн

```
ChangeTracker.cs:523-527   // ⚠️ ХЭМЖИЛТ (1C): ЗӨВХӨН ТҮГЖЭЭ БАРИХ хэсэг.  Энэ бол add-in-ы
                           // ЦОРЫН ГАНЦ бодит блоклолт — тэр хугацаанд `OnDocumentChanged`
                           // нь Revit-ийн ҮНДСЭН thread дээр `lock (Gate)`-д хүлээнэ.
                           // Олонлогийг массив болгож хуулах явц нь 500,000 id хүртэл өсч
                           // болно (`MaxTrackedIds`).
ChangeTracker.cs:533       lock (Gate)
ChangeTracker.cs:558       Dirty.Clear();
ChangeTracker.cs:563       Metrics.FlushLock.Add(lockSw.Elapsed.TotalMilliseconds);
ChangeTracker.cs:567-570   // ⚠️ ДИСК БИЧИЛТ ТҮГЖЭЭНЭЭС ГАДНА.  Дотогш оруулбал
                           // `OnDocumentChanged` нь Revit-ийн үндсэн thread дээр
                           // дискний I/O хүлээнэ.
ChangeTracker.cs:63        private const int MaxTrackedIds = 500000;
```

`Metrics.FlushLock` (`Percentiles.cs:143`) нь add-in дахь бодит үндсэн-thread блоклолтыг хэмждэг ЦОРЫН ГАНЦ хуримтлуулагч бөгөөд ТҮҮВЭРЛЭГДДЭГГҮЙ (3 секунд тутам л ажилладаг тул бүгдийг хэмжинэ).

### 2.5 ГАЦААНЫ АНГИ 3 — үндсэн thread дээрх хүнд хэрэгслүүд

```
RevitToolBus.cs:440        private const int MaxPerSlice = 4;
RevitToolBus.cs:458        while (done < MaxPerSlice && _queue.TryDequeue(out ToolCall call))
RevitToolBus.cs:512        if (!_queue.IsEmpty) RevitToolBus.RaiseAgain();
RevitToolBus.cs:474        if (call.Abandoned)
RevitToolBus.cs:476        { call.Done.Set(); continue; }
```

⚠️ **`MaxPerSlice` нь НЭГ ЗҮСЭЛТЭД БОЛОВСРУУЛАХ ДУУДЛАГЫН тоог хязгаарладаг, НЭГ ДУУДЛАГЫН ДОТООД АЖЛЫГ БИШ.** Мөн `call.Abandoned` нь **зөвхөн дараалалаас гаргах үед, гүйцэтгэхийн ӨМНӨ** шалгагдана (`:474`). `RevitTools.Run` эхэлмэгц ЦУЦЛАЛТ БАЙХГҮЙ — дуудагчийн хугацаа нь ДУУДАГЧИЙГ хамгаална, Revit-ийг БИШ. 40 секундын дуудлага нь метрикт цэвэрхэн «5 секунд дууслаа» гэж бичигдэх ба Revit 40 секунд хөлдөнө.

Дотоод төсөвтэй байх прецедент нь бий:

```
RevitApi.cs:504-506   // ⚠️ `list_changes` нь ЗӨВХӨН индексийн лавлагаа хийдэг тул
                      // хурдан.  `goto_element` нь харагдац хайх ёстой ба өөрөө 2.5
                      // секундын дотоод төсөвтэй — 45 нь тээглэсэн үед л ажиллана.
ChangeReport.cs:70    private const int SearchBudgetMs = 2500;
ChangeReport.cs:73    private const int MaxViewsChecked = 60;
ChangeReport.cs:82    private const int DigestBudgetMs = 4000;
```

`ShowElements` нь НЭРЭЭР ХОРИГЛОГДСОН, учир нь тэр нь боловсруулагч дотор модаль `TaskDialog` гаргана:

```
RevitTools.cs:408   // ⚠️ `uidoc.ShowElements(ids)` ЭНД БАЙСАН — УСТГАСАН (2026-08-25).
ChangeReport.cs:39  ///   3. `ShowElements` ХЭЗЭЭ Ч ДУУДАХГҮЙ.  Элемент нээлттэй харагдацаас
ChangeReport.cs:934 /// ⚠️ `ShowElements`-ийн ОРЛУУЛАГЧ.  Тэр нь элемент олдохгүй үед модаль
```

### 2.6 ГАЦААНЫ АНГИ 4 — модаль цонх + `UiPump.DoEvents`

```
QtoProgressWindow.xaml.cs:27-29   /// дээр, IExternalCommand.Execute-ийн stack дотор явна. Цонх ShowDialog()-оор
                                  /// … будалтыг UiPump.DoEvents()-ээр хийнэ (задаргааны ~300 элемент тутам,
QtoProgressWindow.xaml.cs:142     UiPump.DoEvents();
QtoProgressWindow.xaml.cs:233     private static T AwaitWithPump<T>(Task<T> task)
QtoProgressWindow.xaml.cs:237     UiPump.DoEvents();
UiPump.cs:11-21                   var frame = new DispatcherFrame(); … Dispatcher.PushFrame(frame);
```

`UiPump` бол add-in дахь ЦОРЫН ГАНЦ «урт ажлын үед будаж бай» хэрэгсэл бөгөөд ЗӨВХӨН энэ нэг газарт хэрэглэгддэг. Тэр нь ХЭРЭГЛЭГЧИЙН ЭХЛҮҮЛСЭН, ил тод модаль багц ажилд зориулагдсан. **Compliance нь үүнийг ХЭЗЭЭ Ч БУУЛГАЖ АВАХГҮЙ.**

### 2.7 ГАЦААНЫ АНГИ 5 — мессеж бүрд UI thread дээрх синхрон диск

```
AssistantLog.cs:153   private static void EnsureLoaded()
AssistantLog.cs:163   foreach (string line in File.ReadAllLines(LogPath, Encoding.UTF8))
AssistantLog.cs:130   private const int MaxEntries = 3000;
AssistantLog.cs:192   private static void AppendOne(AssistantLogEntry e)
AssistantLog.cs:197   File.AppendAllText(LogPath, …)
AssistantLog.cs:211   private static void Save()          // БҮТЭН дахин бичилт
```

`AppendOne`-ийн толгойд алдааны түүх бичигдсэн:

```
AssistantLog.cs:186-190   /// Урьд нь энд `Save()` дуудагдаж, 3000 мөрийн БҮТЭН файлыг дахин
                          /// цувуулж бичдэг байв — тэр нь UI thread дээр, чат мессеж бүрд.
                          /// Бүртгэл өсөх тусам чат удаашрах бөгөөд шалтгаан нь ил биш.
                          /// JSONL нь ЗАЛГАМАЛ формат тул нэг мөр нэмэхэд л хангалттай.
AssistantLog.cs:389-390   // ил биш; roaming profile дээр (§2.13) энэ нь мессеж
                          // бүрт сүлжээ хүлээх шалтгаан болно.
```

`%APPDATA%` нь roaming profile дээр СҮЛЖЭЭНИЙ диск — тэр нь энэ ангийг ноцтой болгодог.

### 2.8 §55-R3-ЫН АСУУДАЛ — олонлогийн алгебр нь ЗОРИУД АЛДАГДАЛТАЙ

```
ChangeTracker.cs:849   if (c.Added.Remove(v)) { c.Meta.Remove(v); continue; }   // ← үүсгээд устгасан = ТЭГ
ChangeTracker.cs:873   if (c.Added.Contains(v)) { c.UndoTouch(v, sec); continue; }
ChangeTracker.cs:875   if (c.UndoTouch(v, sec))
ChangeTracker.cs:877   c.Modified.Remove(v);
ChangeTracker.cs:878   c.Meta.Remove(v);
ChangeTracker.cs:195   public bool UndoTouch(long id, long sec)
ChangeTracker.cs:204   t.Depth--;
ChangeTracker.cs:206   if (t.Depth <= 0) return true;      // ← 0 болбол дуудагч мөрийг ХАСНА
ChangeTracker.cs:167   public void Note(long id, int opIdx, long sec)
ChangeTracker.cs:182   Meta[id] = new Touch { Op = opIdx, Sec = sec, Hits = hits, Depth = depth };  // ← ДАРЖ бичнэ
```

Энэ нь «суурьтай харьцуулахад юу ялгаатай вэ» гэсэн асуултад **ЗӨВ** хариулна. «Хүн юу хийсэн бэ» гэсэн асуултад **БҮРЭН БУРУУ**:

- үүсгээд устгасан элемент нь ТҮҮХЭНД ОГТ БАЙГААГҮЙ мэт харагдана (`:849`);
- `Depth` 0 болмогц мөр БҮРЭН алга болно (`:206` + `:877-878`) — оролдоод буцаасан хүчин чармайлт мөр үлдээхгүй;
- `Note()` нь үйлдлийн индекс ба цагийг ДАРЖ бичнэ (`:182`) — зөвхөн СҮҮЛИЙН үйлдэл амьд үлдэнэ;
- `MaxMetaEntries = 20000` (`:74`) хэтэрвэл META бичихээ болино, `MaxTrackedIds = 500000` (`:63`) хэтэрвэл id хадгалахаа болино — хоёулаа ТООЛОХОО үргэлжлүүлнэ.

**Тиймээс §55-R3 («preserve the ORIGINAL event history for learning while coalescing for real-time analysis») нь одоо байгаа бүтцээр ХАНГАГДАХГҮЙ.** Хоёр өөр хадгалалт хэрэгтэй: одоо байгаа алгебр = ОДООГИЙН ТӨЛӨВ, шинэ `RawRing` = ТҮҮХ. Энэ бол §3.6-д `RawRing` оршин байх ЦОРЫН ГАНЦ шалтгаан.

### 2.9 `_flushTimer` нь ҮЕ ҮЕИЙН — далд өгөгдөл алдагдал

```
ChangeTracker.cs:55    private const int FlushIntervalMs = 3000;
ChangeTracker.cs:280   private static Timer _flushTimer;
ChangeTracker.cs:313   _flushTimer = new Timer(_ => FlushDirty(), null, FlushIntervalMs, FlushIntervalMs);
ChangeTracker.cs:577   string tmp = path + ".tmp";
ChangeTracker.cs:580   if (File.Exists(path)) File.Delete(path);
ChangeTracker.cs:581   File.Move(tmp, path);
ChangeTracker.cs:584   catch
ChangeTracker.cs:586   // Диск дүүрсэн / эрх байхгүй — мөрдөлт санах ойд үргэлжилнэ.
```

Гурав дахь аргумент нь `Timeout.Infinite` БИШ, `FlushIntervalMs` — өөрөөр хэлбэл таймер нь өмнөх callback дууссан эсэхээс ҮЛ ХАМААРАН 3 секунд тутам ДАХИН асна, шинэ threadpool thread дээр. Хоёр `FlushDirty` зэрэг ажиллавал:

1. хоёулаа ИЖИЛ `path + ".tmp"`-д бичнэ (`:577`);
2. хоёр дахь `File.Move` нь шидэгдэж, гадна талын `catch { }`-д (`:584-587`) чимээгүй залгигдана;
3. гэвч `Dirty.Clear()` (`:558`) аль хэдийн түгжээ дотор ажилласан тул тэр өөрчлөлтүүд ДАХИН ДАРААЛАЛД ОРОХГҮЙ, диск рүү ХЭЗЭЭ Ч ХҮРЭХГҮЙ.

Өнөөдөр callback нь миллисекунд тул давхцал тохиолддоггүй. **Compliance-ийн ачааллыг энэ callback дээр тавих нь тэр давхцлыг ЖИГД болгоно.** Тиймээс: (а) хоёр шинэ дэд системийн АЛЬ НЬ Ч энэ таймер дээр суухгүй, (б) таймер өөрөө энэ релизэд засагдана (§3.7).

### 2.10 `TryGetByKey` нь ГҮНЗГИЙ хуулбар — циклийн уншилтад ТОХИРОХГҮЙ

```
ChangeTracker.cs:412   public static bool TryGetByKey(string key, out Change copy)
ChangeTracker.cs:417   lock (Gate)
ChangeTracker.cs:427   Added = new HashSet<long>(c.Added),
ChangeTracker.cs:428   Deleted = new HashSet<long>(c.Deleted),
ChangeTracker.cs:429   Modified = new HashSet<long>(c.Modified),
ChangeTracker.cs:434   Ops = new List<string>(c.Ops),
ChangeTracker.cs:435   Meta = new Dictionary<long, Touch>(c.Meta),
```

`Gate`-ийн ДОТОР 500 000 хүртэл id-тай ГУРВАН `HashSet` ба 20 000 хүртэл мөртэй `Dictionary` гүнзгий хуулна. Өнөөдрийн дуудагч нь ЗӨВХӨН ховор, хэрэглэгчийн эхлүүлсэн замууд: `ChangeReport.cs:274`, `ChangeReport.cs:729`, `RevitTools.cs:315` — гурвуулаа `ChangeTracker.TryGet(doc, …)`-ээр (`:394-397`) ДАМЖИН дуудна, тиймээс `TryGetByKey` гэсэн ТЕКСТ нь `ChangeTracker.cs`-ээс ГАДНА нэг ч файлд ГАРАХГҮЙ (§7-ийн grep-ийн хүлээлт үүнээс гарна). Үүнийг 3 секунд тутмын циклийн уншилт болговол `Metrics.FlushLock` — үндсэн thread-ийн бодит блоклолтыг хэмждэг цорын ганц тоо — шууд өснө.

### 2.11 `Nudges` — бүрэн бэлэн, ҮЙЛДВЭРЛЭЛД ТЭГ дуудагчтай

```
Nudges.cs:34    public const int MaxPerDay = 2;
Nudges.cs:36    public static readonly TimeSpan MinGap = TimeSpan.FromMinutes(90);
Nudges.cs:42    public static readonly TimeSpan QuietAfterTyping = TimeSpan.FromSeconds(90);
Nudges.cs:23-24 /// 8 удаа гарвал хүн add-in-ыг унтраана.  Тиймээс дүрэм ердөө ГУРАВ,
                /// нийт хязгаар нь ӨДӨРТ ХОЁР, хоорондоо 90 минут.
Nudges.cs:119   if (s.SentToday >= MaxPerDay) return null;
Nudges.cs:120   if (c.Busy || c.AwaitingAnswer || c.Suppressed) return null;
Nudges.cs:121   if (c.SecondsSinceTyping < QuietAfterTyping.TotalSeconds) return null;
Nudges.cs:126   if (!c.IsWorkday) return null;
Nudges.cs:129   if (hour < 9 || hour >= 19) return null;
```

`grep -rn "Nudges\." revit-mcp/addin/*.cs` (өөрийнх нь файлаас гадна) → **ТЭГ мөр**. Цорын ганц дурдлага нь `ChangeTracker.cs:402`-ийн тайлбар: «сануулгын хөдөлгүүр (`Nudges`) нь WPF-ийн таймераас … ажиллана». Өөрөөр хэлбэл §76-ын төсөв нь ТӨЛӨВЛӨГДСӨН боловч ХЭЗЭЭ Ч АСААГҮЙ.

`Ctx` нь `Busy`, `AwaitingAnswer`, `Suppressed`, `WebConnected`, `SecondsSinceTyping` шаарддаг (`Nudges.cs:52-73`) — бүгд WPF самбарын төлөв, арын thread аюулгүй уншиж чадахгүй.

### 2.12 `RevitToolBus.Gate` нь ГЛОБАЛ, хугацаа нь `Gate`-ЭЭС ӨМНӨ эхэлдэг

```
RevitToolBus.cs:134   private static readonly SemaphoreSlim Gate = new SemaphoreSlim(1, 1);
RevitToolBus.cs:264   int deadline = Environment.TickCount + Math.Max(1, timeoutSeconds) * 1000;
RevitToolBus.cs:266   if (!Gate.Wait(Math.Max(1, timeoutSeconds) * 1000))
RevitToolBus.cs:271   $"Хугацаа дууслаа ({timeoutSeconds}s) — өмнөх үйлдэл дуусаагүй байна.";
RevitToolBus.cs:300   if (call.Done.Wait(50)) break;
RevitToolBus.cs:313   $"Хугацаа дууслаа ({timeoutSeconds}s). Revit завгүй байх эсвэл модаль цонх нээлттэй байж магадгүй.";
RevitToolBus.cs:126-131  ///  3. НЭГЖ УРСГАЛ (single-flight).  `HttpServer.RunOnRevit` өөрийн
                         ///     `SemaphoreSlim`-тэй; энд БАС хэрэгтэй, эс бөгөөс панель + bridge
                         ///     хоёр зэрэг дуудахад дараалал холилдоно.
```

`Gate` нь чат, QTO ба ирээдүйн compliance-тай ХУВААЛЦСАН. Дарааллын хүлээлт нь дуудагчийн ӨӨРИЙНХ нь хугацаанаас хасагдана (`:264` нь `:266`-ийн ӨМНӨ) — 2026-08-25-ны оношилгооны дараа зориуд ингэсэн. `:313`-ийн текст нь модаль цонх нээлттэй үед `ExternalEvent` гүйцэтгэгддэггүйг ил хэлнэ.

Мөн `Wait(50)` нь хариу өгөх ХУГАЦААНЫ ШАЛ — 50 мс-ээс хурдан «детерминист шалгалт» энэ bus-аар ХҮРГЭГДЭХГҮЙ.

### 2.13 Хугацааны хэрэгслүүд аль хэдийн бэлэн

```
Timing.cs:29     internal sealed class Timing
Timing.cs:36     public double TotalMs => _sw.Elapsed.TotalMilliseconds;
Timing.cs:39     public void Mark(string name)
Timing.cs:47     public void Set(string name, double ms) { _marks[name] = ms; }
Timing.cs:60     public static double? Round(double? ms)     // null нь null хэвээр
Timing.cs:8-12   /// ⚠️ ЯАГААД p95 ГАНЦААРАА ХАНГАЛТГҮЙ ВЭ … Тавуулаа хэрэггүй бол дүгнэлт худал гарна.
Timing.cs:20-21  /// ⚠️ Autodesk.Revit-ийн ямар ч төрөл ХЭРЭГЛЭХГҮЙ — net48 (R24) build дээр ч эмхэтгэгдэх ёстой.
```

`Percentiles.cs`-ийн арван нэгэн хуримтлуулагч ба арын бичигчийн загвар:

```
Percentiles.cs:127  public static readonly Percentiles Total = new Percentiles();
Percentiles.cs:135  public static readonly Percentiles ToolQueue = new Percentiles();
Percentiles.cs:141  public static readonly Percentiles DocChanged = new Percentiles(128);
Percentiles.cs:143  public static readonly Percentiles FlushLock = new Percentiles(128);
Percentiles.cs:244  System.Threading.Interlocked.Increment(ref _dropped);
Percentiles.cs:417  if (System.Threading.Interlocked.CompareExchange(ref _pumpStarted, 1, 0) != 0) return;
Percentiles.cs:421  t.IsBackground = true;
Percentiles.cs:478  System.IO.File.AppendAllText(
Percentiles.cs:493  private static readonly System.Collections.Concurrent.BlockingCollection<string> Pending =
Percentiles.cs:497  private const int MaxPendingLines = 4096;
Percentiles.cs:499  private const int ShutdownJoinMs = 750;
Percentiles.cs:508  private const long MaxLogBytes = 512 * 1024;
Percentiles.cs:509  private const double SummaryEveryMs = 60000;
```

**Энэ бол Track 2-ын арын thread-ийн ЭХ ЗАГВАР:** хязгаартай дараалал + `Interlocked` алдагдлын тоолуур + `IsBackground = true` + `CompareExchange` давхардлын хамгаалалт + хязгаартай `Join`.

Түүврийн тоо:

```
ChangeTracker.cs:369        private const int DcSampleEvery = 64;
ChangeTracker.cs:783        if (System.Threading.Interlocked.Increment(ref _dcCounter) % DcSampleEvery == 0)
ChangeTracker.cs:911        Metrics.DocChanged.Add(dcSw.Elapsed.TotalMilliseconds);
ChangeTracker.cs:363-366    /// ⚠️ ТҮҮВЭРЛЭЛТ ЗААВАЛ.  Энэ handler нь ГҮЙЛГЭЭ БҮРТ ажилладаг тул
                            /// тэнд `Stopwatch.StartNew()` хийх нь ӨӨРӨӨ нэмэлт ачаа
```

⚠️ **64 гүйлгээнд нэг түүвэр гэдэг нь ХОВОР ОРГИЛЫГ СТАТИСТИКААР ҮЛ ҮЗЭГДЭХ болгоно.** §82-ын «bounded AI resource usage» шалгуурыг ЗӨВХӨН `DocChanged`-ээс нотлох БОЛОМЖГҮЙ.

### 2.14 Тээвэр — 180 секундын `HttpClient` ба User-Agent

```
ApiClient.cs:56    var c = new HttpClient { Timeout = TimeSpan.FromSeconds(180) };
ApiClient.cs:58-61 // ⚠️ USER-AGENT ЗААВАЛ … Cloudflare-ийн «Browser Integrity Check»
                   // нь User-Agent-гүй хүсэлтийг **403 (error code 1010)**-аар
                   // Worker-т ХҮРЭХЭЭС нь ӨМНӨ хаадаг.
ApiClient.cs:66-67 //     UA байхгүй        → 403  error code: 1010
                   //     UA "MglRevitAddin/1.0" → 401  {"error":"Invalid or expired token"}
ApiClient.cs:74-75 // ⚠️ УГТВАР `MglRevitAddin/` ЗААВАЛ ХЭВЭЭР.  Хувилбарыг ЗАЛГАЖ
                   // болно — угтварыг УСТГАЖ БОЛОХГҮЙ.
ApiClient.cs:80-81 // ⚠️ ТАРААХААС ӨМНӨ НЭГ МАШИН ДЭЭР ТУРШ: 401 (403 БИШ) ирж
                   // байгааг батал.
ApiClient.cs:84    c.DefaultRequestHeaders.UserAgent.ParseAdd("MglRevitAddin/" + BuildInfo.Version);
```

180 секунд нь 20 000 мөрийн QTO push-д тохируулагдсан. Compliance-ийн багц илгээлтэд түүнийг дахин ашиглах нь §32-ыг зөрчинө («Do not reuse an unrelated 180-second HTTP timeout», v2:1071).

### 2.15 Сервер тал бэлэн — үйлдвэрлэгч л дутуу

```
learning.ts:279    learning.post('/events', …)         (ingest)
learning.ts:299    const cfg = await loadCaptureConfig(db);
learning.ts:304    return c.json({ accepted: null, ingest: 'off' });
learning.ts:307    if (rawTxns.length > cfg.txnBatchMax || rawEvents.length > cfg.txnBatchMax) {
learning.ts:308    return c.json({ error: 'batch_too_large', max: cfg.txnBatchMax }, 413);
learning.ts:311    return c.json({ error: 'touch_batch_too_large', max: MAX_TOUCH_BATCH }, 413);
learning.ts:822    learning.get('/events/head', …)      (RESUME ГАРЦ)
learning.ts:86     const DEFAULT_BATCH_MAX = 200;
learning.ts:88     const MAX_TOUCH_BATCH = 2000;
learning.ts:90     const MAX_PAYLOAD_BYTES = 16 * 1024;
learning.ts:96     const MAX_HEAD_STREAMS = 20;
learning.ts:212    elementsPerTxn: num('bim.capture.elements_per_txn', 24),
learning.ts:213    elementsPerSession: num('bim.capture.elements_per_session', 4000),
```

`grep -rn 'api/learning' revit-mcp/addin/*.cs` → **ТЭГ мөр**. Дэвтэр бүрэн баригдсан, бүрэн хоосон.

⚠️ **ЭНЭ ХООСОН ЧАНАРЫГ ХААХ ГЭРЭЭ НЬ §3.9.a.** Тэнд envelope-ийн ЯГ хэлбэр, `RawEntry` → `TXN` буулгалт, `SESSION_START`/`SESSION_END`-ийн гарах цэг ба `Enqueue`-ийн ДӨРВӨН дуудагч бүрэн бичигдсэн. `BimEmitter`-ийг дараалал болгож зарлаад ДҮҮРГЭГЧИЙГ нь бичихгүй бол энэ мөр релизийн ДАРАА ч «ТЭГ мөр» хэвээр үлдэнэ.

### 2.16 Bind төсөв — `bim_sessions` нь ТЭСВЭРТЭЙ

```
bimEvents.ts:327   function rowsPerStatement(binds: number): number {
bimEvents.ts:384   export const SESSION_BINDS = SESSION_INSERT_COLUMNS.length; // = 27
bimEvents.ts:386   export const SESSION_ROWS_PER_STATEMENT = rowsPerStatement(SESSION_BINDS); // = 3
bimEvents.ts:502   export const EVENT_BINDS = EVENT_INSERT_COLUMNS.length; // = 23
bimEvents.ts:503   export const EVENT_ROWS_PER_STATEMENT = rowsPerStatement(EVENT_BINDS); // = 4
check-bim-events.mjs:35  const IMMUTABLE = TABLES.filter((t) => t !== 'bim_sessions');
```

`floor(100 / (binds + 1))` — нэг баганын ЗОРИУДЫН нөөцтэй. Тооцоо:

- `bim_sessions` = 27 (өнөөдөр) + 4 (2-1-ийн багийн талбарууд) = **31** → +1 (`perf_json`, §3.1) = **32** → `floor(100/33) = 3`. **ӨӨРЧЛӨГДӨХГҮЙ.**
- ⚠️ ЗУРГАА ДАХЬ бодит багана нь 33 болгож `floor(100/34) = 2` руу унагаана. Тиймээс гүйцэтгэлийн БҮХ скаляр нь `perf_json`-ы ДОТОР, `GENERATED … VIRTUAL` байдлаар л гарна.
- `learning_events` = 23, ӨӨРЧЛӨГДӨХГҮЙ — энэ сесс тэр хүснэгтэд бодит багана НЭМЭХГҮЙ.

`bim_sessions` нь 0206-ийн найман trigger-т ОРООГҮЙ цорын ганц хүснэгт (`check-bim-events.mjs:35`), тиймээс `UPDATE` зөвшөөрөгдөнө — `perf_json` нь сессийн төгсгөлд бичигдэх боломжтой.

### 2.17 Унтраалтын дараалал — ЗОРИУД, ба одоо АЮУЛТАЙ

```
App.cs:47    try { Metrics.Start(); } catch { }
App.cs:51    RevitToolBus.Init();
App.cs:70    ChangeTracker.Init(application.ControlledApplication);
App.cs:144   BatchQto.Hook(application);
App.cs:165   try { ChangeTracker.Shutdown(application?.ControlledApplication); }   ← ХАМГИЙН ЭХЭНД
App.cs:185   try { Metrics.EmitSummary(force: true); } catch { }
App.cs:192   try { Metrics.Shutdown(); } catch { }
App.cs:193   try { AssistantLog.Shutdown(); } catch { }
App.cs:194   try { RevitToolBus.Shutdown(); } catch { }                            ← ХАМГИЙН СҮҮЛД
App.cs:167-183  // ⚠️ ДАРААЛАЛ НЬ ЧУХАЛ … 3. `RevitToolBus` — `ExternalEvent` сулалж …
                //    ХАМГИЙН СҮҮЛД
```

`ChangeTracker.Shutdown` нь `FlushDirty()`-г Revit-ийн үндсэн thread дээр СИНХРОНООР дуудна. `RevitToolBus.Shutdown()` — `Call`-д зогссон thread-үүдийг сулладаг ЦОРЫН ГАНЦ зүйл — 29 мөрийн ДАРАА л ажиллана. Тэр хоёрын ХООРОНД `Join` оруулах нь Revit-ийн хаагдалтыг гацаана.

### 2.18 `BatchQto` — хараа хяналтгүй шөнийн хост

```
BatchQto.cs:38   public static void Hook(UIControlledApplication application)
BatchQto.cs:39   if (!File.Exists(QueuePath)) return;
BatchQto.cs:42   application.ControlledApplication.ApplicationInitialized += OnApplicationInitialized;
BatchQto.cs:94   finally
BatchQto.cs:102  Process.GetCurrentProcess().Kill();
BatchQto.cs:181  DetachFromCentralOption = DetachFromCentralOption.DetachAndPreserveWorksets,
ChangeTracker.cs:650  AutoBaseline(e == null ? null : e.Document);
```

`App.OnStartup` нь `ChangeTracker.Init` БА `BatchQto.Hook`-ыг НЭГ процесст бүртгэдэг, `AutoBaseline` нь `DocumentOpened` бүрд — тэр дотор detached багц нээлт ч ордог. `IsBatch` гэсэн туг **өнөөдөр БАЙХГҮЙ**: `grep -rn "IsBatch" revit-mcp/addin/` ТЭГ мөр буцаана.

### 2.19 Дугуй унших хүн байхгүй бол — шипсэн урхи

```
0195_assistant_learning.sql:152-155   -- ⚠️ ЭНЭ МӨРИЙГ ОДООХОНДОО ХЭН Ч УНШИХГҮЙ.  Add-in нь `IntentRouter.
                                      -- MinConfidence`-ийг эмхэтгэлийн үед л авдаг; серверээс татах код БИЧИГДЭЭГҮЙ.
                                      -- Тиймээс энэ утгыг өөрчлөхөд ЮУ Ч БОЛОХГҮЙ
0195_assistant_learning.sql:162-163   INSERT OR IGNORE INTO app_settings (key, value)
                                      VALUES ('assistant.min_confidence', '0.45');
learning.ts:226-232   * ⚠️ УНШИГЧГҮЙ ДУГУЙ БҮҮ ҮЛДЭЭ. `assistant.min_confidence` (0195) нь
                      *    ӨНӨӨДӨР ХЭН Ч УНШДАГГҮЙ түлхүүр … Тохиргооны мөр байгаад уншигдахгүй
                      *    байх нь эзнийг «би унтраасан» гэж бодуулна.
```

**Дүрэм:** §3.3-ын АРВАН дугуй бүр (0228-ийн найм + 0230-ийн хоёр) `GET /api/learning/settings`-ээр гарч, add-in-д кэшлэгдэж, бодит кодод УНШИГДАХ ёстой. Уншигчгүй дугуй нь дугуй байхгүйгээс ДОР.

### 2.20 Гурван шатлалт нөөц — дүрмийн багцад хуулах загвар

```
IntentModel.cs:236   private static bool LoadUnderLock()
IntentModel.cs:249   if (File.Exists(LocalModelPath))
IntentModel.cs:251   _model = Parse(File.ReadAllText(LocalModelPath, Encoding.UTF8));
IntentModel.cs:252   if (_model != null) { _lastLoadSource = "local"; return true; }
IntentModel.cs:255   _model = LoadEmbedded();
IntentModel.cs:256   _lastLoadSource = _model != null ? "embedded" : "none";
IntentModel.cs:259   catch (Exception ex)
IntentModel.cs:261   // Загваргүй ч add-in АЖИЛЛАХ ёстой
IntentModel.cs:308-310  // ⚠️ Гэрээ таарахгүй бол ТАТГАЛЗАНА.
```

татсан → шигтгэсэн → байхгүй. Ямар ч тохиолдолд add-in АЖИЛЛАСААР байна. §75-ын нөөцийн шат нь ЯГ ЭНЭ хэлбэрийг хуулна.

---

## 3. ХИЙХ АЖИЛ

> Дараалал нь ЧУХАЛ: **§3.0 → §3.1-3.3 (миграц) → §3.4-3.5 (сервер) → §3.6-3.13 (C#) → §3.14-3.18 (төсөв, доройтол, ядаргаа, харнесс)**. Урвуулбал шинэ багана уншдаг код нь баганаас ӨМНӨ гарч, `perf_json` ЧИМЭЭГҮЙ хаягдана — 0212 ба 0216-ийн толгойд бичигдсэн ЯГ ТЭР алдаа.

### 3.0 Дугаар авах

```bash
cd backend && ls migrations | tail -5
# 2026-08-30-нд: … 0214_assistant_review.sql · 0215_assistant_trust_taxonomy.sql · 0216_assistant_log_timing.sql
```

Энэ баримт **0226 · 0227 · 0228 · 0230** ДӨРВИЙГ эзэмшинэ. ⚠️ **Хамтран ажиллаж буй Track 2-ын бусад баримтууд дугаарыг ЗЭРЭГ шаардаж байна** (репод 0002, 0060, 0080, 0110, 0120, 0121, 0173, 0176 гэсэн найман давхардсан дугаар аль хэдийн бий). Бичихийн ӨМНӨ дээрх командыг ажиллуулж, өөр агент 0226-г аваагүй эсэхийг батал. Файлын АГУУЛГА нь дугаараас ХАМААРАХГҮЙ — зөрчил гарвал ДӨРВҮҮЛЭЭ НЭГ БҮЛЭГ БАЙДЛААР дараагийн сул блок руу (ж: 0232-0235) шилжинэ, ба энэ §3.0-д шинэ блокоо бич.

⚠️ **0230 нь ЭНЭ ЗАСВАРААР НЭМЭГДСЭН — ЯАГААД ВЭ.** `bim.compliance.authority_level` (v2 §80-ийн LEVEL 0/1/2) ба `bim.compliance.rollout_pct` гэсэн ХОЁР түлхүүрийг Track 2-ын НЭГ Ч баримт үүсгэдэггүй байв: 0228 нь ЯГ найман мөртэй бөгөөд өөрийнхөө толгойд «ЕС ДЭХ дугуй нь ШИНЭ ФАЙЛ, ШИНЭ ДУГААР шаардана» гэж бичсэн; гэтэл `2-5-finding-surface` §3.1 нь `authority_level`-ийг УНШдаг, `2-0-OWNER-BRIEF` §3.2-ийн БҮХ релизийн төлөвлөгөө түүнийг ба `rollout_pct`-ыг `UPDATE` хийхэд тулгуурладаг, `2-8-install-and-health` нь `addin_installs.authority_level`-ыг ЭНЭ баримтаас хүлээж байна. Мөргүй бол `authorityFromSetting(null)` нь ҮҮРД OBSERVE дээр наалдана — дэвшилтийн БҮХ механизм үхмэл. Тиймээс ХОЁР түлхүүр нь тусдаа файл (0230) болж, `COMPLIANCE_KEYS`-д (§3.4) уншигчтай болов.

**Дугаарын зураглал (2026-08-30-ны байдлаар ах дүү баримтуудын «Хөндөх файлууд» мөрөөс уншсан):** 2-1 → 0217-0219 · 2-2 → 0220-0223 · 2-3 → 0224, 0225, 0229 · **2-4 → 0226-0228 + 0230** · 2-5 → 0237 · 2-6 → 0238-0240 · 2-8 → 0241-0242. **0231-0236 нь СУЛ** — 0230 нь хэнтэй ч мөргөлдөхгүй.

Мөн ажиллуул:

```bash
cd backend && node --test src/lib/migrationSchema.test.ts
# ЯАГААД: 0214 ба 0215 хоёр бараг хоёулаа `reviewed_at` нэмж, гүйлгээ дунд унах шахсан.
```

**ТЭЭВРИЙН ДҮРЭМ (0208 ба 0209/0210-ийн толгойд ХЭМЖИГДСЭН):** `migrations apply` нь файлыг `d1_migrations`-ийн INSERT-тэй залгаад НЭГ `--command` болгож илгээдэг; задлагч нь (1) блок тайлбарыг ойлгодоггүй, (2) мөрөн доторх `;`-ээр хуваадаг, (3) олон statement байвал унадаг. Иймд **файл бүр ≤ 9 statement** (`0208` нь 8 INSERT-тэй бөгөөд продакшнд хэрэгжсэн — энэ бол баталгаажсан дээд хязгаар), блок тайлбаргүй, мөрөн дотор `;` байхгүй. Зөрчил нь файлыг ХАГАС хэрэгжүүлээд `d1_migrations`-д мөр ҮЛДЭЭХГҮЙ — цорын ганц хууль ёсны засвар нь ШИНЭ ДУГААР.

### 3.1 `0226_perf_scalars.sql` — гүйцэтгэлийн блоб + дөрвөн халуун скаляр

```sql
-- =============================================================
-- 0226_perf_scalars.sql — `bim_sessions`-д СЕССИЙН ГҮЙЦЭТГЭЛИЙН ХУРААНГУЙ
-- =============================================================
-- ЗОРИЛГО: v2 §30-ын «Measure first» ба §82-ын «bounded AI resource usage»
--   шалгуурыг ХЭМЖИГДЭХҮЙЦ болгох.  Өнөөдөр `Metrics`-ийн 11 хуримтлуулагч
--   нь ЗӨВХӨН `%APPDATA%\RevitMcpAddin\timing.log`-д гардаг (512 KB, нэг
--   эргэлт — `Percentiles.cs:508`), сервер рүү ХҮРДЭГ ЗАМ БАЙХГҮЙ.  Хэмжилт
--   ажилтны компьютерт үлдэж байгаа тохиолдолд «add-in удаан уу» гэсэн
--   асуултад ХЭЗЭЭ Ч хариулж чадахгүй.
--
-- ⚠️ ЯАГААД 11 БАГАНА БИШ, НЭГ `perf_json` ВЭ:
--   `bim_sessions`-ийн bind төсөг: өнөөдөр 27 (`bimEvents.ts:384`), 2-1-ийн
--   багийн 4 талбар нэмэгдээд 31, энэ файлын `perf_json` нэмэгдээд 32.
--     floor(100 / 33) = 3 мөр/statement — 27 дээрхтэй ЯГ АДИЛ.
--   ⚠️ ЗУРГАА ДАХЬ бодит багана нь 33 болгож floor(100/34) = 2 руу унагаана
--   — өөрөөр хэлбэл ingest-ийн бүтээмж 33% буурна.  Тиймээс дараагийн БҮХ
--   гүйцэтгэлийн тоо нь `perf_json`-ы ДОТОР л орно; шинэ түлхүүр нэмэхэд
--   миграц ОГТ ШААРДАХГҮЙ (add-in зүгээр л илгээнэ, SQL нь json_extract-аар
--   уншина).  Энэ бол 0216-ийн `timing_json` дээр продакшнд БАТЛАГДСАН хэв маяг.
--
-- ⚠️ NULL vs '{}' — 0216:29-40-ийн инвариантыг ХУУЛНА:
--     perf_json IS NULL  = ХЭМЖЭЭГҮЙ (энэ файлаас өмнөх бүх сесс, ба
--                          телеметр илгээдэггүй хуучин add-in)
--     объект             = add-in ХЭМЖИЖ ИЛГЭЭСЭН; дутуу түлхүүр нь «тэр үе
--                          шат БОЛООГҮЙ» гэсэн утгатай
--   `BimEmitter` нь БҮХ талбар дутуу үед ХООСОН ОБЪЕКТ БИШ, ЯГ NULL илгээнэ.
--
-- ⚠️ ЦЭВЭР ADDITIVE ALTER.  `bim_sessions`-ыг ДАХИН БҮТЭЭХГҮЙ.
--   `users` / `projects` ХӨНДӨГДӨХГҮЙ.
-- ⚠️ SQLite-ийн ADD COLUMN нь IF NOT EXISTS-ыг ДЭМЖДЭГГҮЙ — энэ файлыг
--   ХОЁР УДАА ажиллуулж БОЛОХГҮЙ.  Гараар `d1 execute --file` БҮҮ ажиллуул.
-- ⚠️ ТЭЭВЭР: 7 statement (<= 9), блок тайлбаргүй, мөрөн дотор ; АЛГА

ALTER TABLE bim_sessions ADD COLUMN perf_json TEXT
  CHECK (perf_json IS NULL
         OR (json_valid(perf_json) AND json_type(perf_json) = 'object'));

-- ХАЛУУН СКАЛЯР 1 — ХАЛУУН замын p95.  R7-ийн ГОЛ тоо.
ALTER TABLE bim_sessions ADD COLUMN p95_doc_changed_ms REAL
  GENERATED ALWAYS AS (json_extract(perf_json, '$.p95_doc_changed_ms')) VIRTUAL;

-- ХАЛУУН СКАЛЯР 2 — үндсэн thread-ийн БОДИТ блоклолт (`Metrics.FlushLock`).
ALTER TABLE bim_sessions ADD COLUMN p95_flush_lock_ms REAL
  GENERATED ALWAYS AS (json_extract(perf_json, '$.p95_flush_lock_ms')) VIRTUAL;

-- ХАЛУУН СКАЛЯР 3 — нэгтгэгчийн хаалт (BACKGROUND).
ALTER TABLE bim_sessions ADD COLUMN p95_coalesce_ms REAL
  GENERATED ALWAYS AS (json_extract(perf_json, '$.p95_coalesce_ms')) VIRTUAL;

-- ХАЛУУН СКАЛЯР 4 — багц илгээлтийн эргэлт (REMOTE).
ALTER TABLE bim_sessions ADD COLUMN p95_emit_post_ms REAL
  GENERATED ALWAYS AS (json_extract(perf_json, '$.p95_emit_post_ms')) VIRTUAL;

-- Шинжилгээ 1: «сүүлийн 30 хоногийн халуун замын хуваарилалт».
-- ⚠️ Хэсэгчилсэн: ХЭМЖЭЭГҮЙ сесс индекст ОРОХГҮЙ.  Covering — сканнер
--   хүснэгт рүү хүрэхгүй.
CREATE INDEX IF NOT EXISTS idx_bim_sessions_perf_hot
  ON bim_sessions (started_at DESC, p95_doc_changed_ms)
  WHERE p95_doc_changed_ms IS NOT NULL;

-- Шинжилгээ 2: «аль машин дээр үндсэн thread хамгийн их блоклогдов».
-- ⚠️ АГРЕГАТ ЗОРИУЛАЛТ.  `machine_hash` нь sha256 (0202:63) — хүн БИШ, МАШИН.
--   Хүн тус бүрийн мөр ХЭЗЭЭ Ч рендерлэгдэхгүй (self-view-only инвариант).
CREATE INDEX IF NOT EXISTS idx_bim_sessions_perf_lock
  ON bim_sessions (machine_hash, p95_flush_lock_ms)
  WHERE p95_flush_lock_ms IS NOT NULL;
```

⚠️ `RuleEval`, `InputCollect`, `EmitQueue` зэрэг 2-3/2-7-ын хэмжүүрүүд нь `perf_json`-ы ДОТОР суух ба скаляр АВАХГҮЙ. Тэднийг `json_extract(perf_json, '$.p95_rule_eval_ms')`-аар шууд уншина — миграц шаардлагагүй. Скаляр (индекслэх боломж) хэрэгтэй болбол ТУСДАА файл, ТУСДАА дугаар.

### 3.2 `0227_compliance_notice_state.sql` — §76-ын төлөв

```sql
-- =============================================================
-- 0227_compliance_notice_state.sql — МЭДЭГДЛИЙН ТӨЛӨВ (dedup / ack / snooze)
-- =============================================================
-- ЗОРИЛГО: v2 §76-ын долоон хяналт (severity threshold, duplicate suppression,
--   repeated-warning suppression, acknowledgement, snooze, grouping, finding
--   deduplication) -ийн ХАДГАЛАЛТЫН тал.  Revit дахин асахад хэрэглэгчийн
--   «ойлголоо» гэсэн хариу АЛГА болох ЁСГҮЙ — тиймээс төлөв нь серверт байна,
--   `%APPDATA%`-д БИШ.
--
-- ⚠️ dedup_key = sha256(rule_uid || '\x00' || element_uid)[:16].
--   `ruleset_version` нь ТҮЛХҮҮРТ ОРОХГҮЙ, ХАЖУУД нь БАГАНА байна.
--   ЯАГААД: багц дахин нийтлэх бүрд түлхүүр өөрчлөгдвөл БҮХ ack компанийн
--   хэмжээнд өнчирч, тоолуур эхний өдрийн утга руугаа буцаж, CRITICAL суваг
--   хүмүүсийн аль хэдийн хаясан мөр дээр ДАХИН асна.  Гэтэл багц дахин
--   нийтлэх нь LEVEL 0 → 1 → 2 ахиулалтын ҮНДСЭН үйлдэл — өөрөөр хэлбэл
--   бүтээгдэхүүнийг ажиллуулах үйлдэл өөрөө §76-ын ядаргааг үүсгэнэ.
--   Ack нь ЗӨВХӨН тухайн дүрмийн `semantic_hash` өөрчлөгдөхөд хүчингүй болно.
--
-- ⚠️ REFERENCES АЛГА.  `user_id` дээр ч гэсэн: BIM-ийн залгамал хүснэгтүүдийн
--   хажууд ON DELETE SET NULL нь хүүхдийн UPDATE болж хувирч, append-only
--   trigger-ийг асааж, ЭЦГИЙН DELETE-ийг БҮХЭЛД НЬ ABORT хийдэг (1B-1 §2.6-д
--   хэмжсэн).  Хүүхдийг гараар устгах нь энэ репогийн уламжлал.
--
-- ⚠️ SELF-VIEW-ONLY.  Мөр бүр `user_id`-тай — унших маршрут бүр
--   `user_id = viewer.sub` эсвэл АГРЕГАТ байна.  Хүн тус бүрийн зөрчлийн
--   тоо ХААНА Ч, АДМИНД Ч рендерлэгдэхгүй.
-- ⚠️ ТЭЭВЭР: 4 statement (<= 9), блок тайлбаргүй, мөрөн дотор ; АЛГА

CREATE TABLE IF NOT EXISTS compliance_notice_state (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id          INTEGER NOT NULL,
  dedup_key        TEXT    NOT NULL,
  state            TEXT    NOT NULL DEFAULT 'new'
                   CHECK (state IN ('new','shown','acknowledged','snoozed','dismissed')),
  severity         TEXT    NOT NULL DEFAULT 'INFO'
                   CHECK (severity IN ('CRITICAL','HIGH','MEDIUM','LOW','INFO')),
  rule_uid         TEXT,
  rule_version     INTEGER,
  ruleset_version  TEXT,
  ack_rule_version INTEGER,
  team_code        TEXT,
  doc_uid          TEXT,
  root_dedup_key   TEXT,
  shown_count      INTEGER NOT NULL DEFAULT 0,
  first_shown_at   TEXT,
  last_shown_at    TEXT,
  ack_at           TEXT,
  snooze_until     TEXT,
  created_at       TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at       TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_cns_user_key
  ON compliance_notice_state (user_id, dedup_key);

CREATE INDEX IF NOT EXISTS idx_cns_user_state
  ON compliance_notice_state (user_id, state, severity);

CREATE INDEX IF NOT EXISTS idx_cns_snooze
  ON compliance_notice_state (snooze_until)
  WHERE snooze_until IS NOT NULL;
```

`root_dedup_key` нь §76-R3-ын «1 primary issue / 9 affected consequences» бүлэглэлийн заагч. Тэр нь 2-3-ийн `finding_edges`-ээс УРСАН ирнэ; энэ хүснэгт зөвхөн ҮЗҮҮЛЭХ шийдвэрийг хадгална.

### 3.3 `0228_compliance_settings.sql` + `0230_compliance_authority.sql` — АРВАН дугуй, арав нь БҮГД уншигдана

```sql
-- =============================================================
-- 0228_compliance_settings.sql — БОДИТ ХУГАЦААНЫ ХӨДӨЛГҮҮРИЙН ДУГУЙНУУД
-- =============================================================
-- ЗОРИЛГО: v2 §53/§75/§76/§82-ын БҮХ тоог deploy-гүйгээр эргүүлэх боломжтой
--   болгох.  Add-in эдгээрийг `GET /api/learning/settings`-ээс асах үедээ
--   татаж локалдаа кэшлэнэ (0203-ын 1C гэрээ, `learning.ts:225-248`).
--
-- ⚠️ УНШИГЧГҮЙ ДУГУЙ БҮҮ ҮЛДЭЭ.  `assistant.min_confidence` (0195:163) бол
--   энэ репогийн шипсэн урхи: мөр байгаа, `IntentRouter.cs:81` нь 0.45-ыг
--   ЭМХЭТГЭЛИЙН үед авдаг, серверээс уншдаг код БИЧИГДЭЭГҮЙ.  Эзэн утгыг
--   өөрчилж «би унтраалаа» гэж боддог; бодитоор ЮУ Ч БОЛОХГҮЙ.  Доорх найман
--   түлхүүр бүрийн УНШИГЧ нь §3.4-т байна — нэг ч дугуйг уншигчгүй үлдээвэл
--   ЭНЭ МИГРАЦ БУРУУ.  (Есдүгээр ба аравдугаар түлхүүр нь 0230-д — доор.)
--
-- ⚠️ INSERT OR IGNORE тул дахин ажиллуулж болно.
-- ⚠️ ТЭЭВЭР: 8 statement (<= 9 — 0208 нь ЯГ ижил 8-тай, продакшнд хэрэгжсэн).
--   ⚠️ НӨӨЦ ТЭГ: ЕС ДЭХ дугуй нь ШИНЭ ФАЙЛ, ШИНЭ ДУГААР шаардана.

-- УНТРААХ ТОВЧ.  off = хөдөлгүүр бүхэлдээ унтарна (§75, §82).
-- off | observe | explain | recommend  (v2 §80-ын LEVEL 0/1/2)
INSERT OR IGNORE INTO app_settings (key, value)
VALUES ('bim.compliance.mode', 'observe');

-- Нэгтгэлийн НАМЖИХ цонх (мс).  1200 = хүний хоёр Revit командын хоорондох
-- дундаж завсраас БАГА, гэвч regenerate-тэй командын дуусалтаас (~1000 мс)
-- ИХ.  ⚠️ ТААМАГ — ХЭМЖИГДЭЭГҮЙ (§9).
INSERT OR IGNORE INTO app_settings (key, value)
VALUES ('bim.compliance.settle_ms', '1200');

-- ХОЙШЛУУЛАЛТЫН дээд хязгаар (мс).  Тасралтгүй загварчлалын үед олонлог
-- эцэст нь хаагдах ёстой.  ⚠️ Хойшлуулалтаар хаагдсан олонлог нь ЦУГЛУУЛАЛТ
-- ЭХЛҮҮЛЭХГҮЙ (§3.8) — хэрэглэгч ЯГ ТЭР мөчид завгүй нь батлагдсан байдаг.
INSERT OR IGNORE INTO app_settings (key, value)
VALUES ('bim.compliance.max_defer_ms', '15000');

-- Нэг логик олонлогийн элементийн дээд тоо.  2000 нь
-- `bim.capture.elements_per_session` = 4000 (0208:20)-ийн ТЭН ХАГАС: түүнээс
-- том наалт нь дизайны шийдвэр биш, БӨӨНИЙ үйлдэл.
INSERT OR IGNORE INTO app_settings (key, value)
VALUES ('bim.compliance.max_elements_per_set', '2000');

-- Түүхийн цагираг (гүйлгээ / баримт).  4000 нь нэг ажилтны нэг өдрийн
-- гүйлгээний дээд таамгаас (1B-1 §9: 40-200/өдөр — ХЭМЖИГДЭЭГҮЙ) 20 дахин их.
INSERT OR IGNORE INTO app_settings (key, value)
VALUES ('bim.compliance.raw_ring_max', '4000');

-- Нэг POST-д багтах гүйлгээ/үйл явдлын дээд тоо.  100 нь серверийн
-- `txn_batch_max` = 200 (0208:27, `learning.ts:307-311` дээр 413)-аас БАГА —
-- дугуйг доош эргүүлэхэд add-in 413 авахгүй.
INSERT OR IGNORE INTO app_settings (key, value)
VALUES ('bim.compliance.emit_batch_max', '100');

-- МЭДЭГДЭХ доод ноцтой байдал (§76, §67).  Үүнээс доогуур нь ЗӨВХӨН
-- самбарын жагсаалтад орно, тоолуурт нөлөөлнө, ХЭЗЭЭ Ч түлхэхгүй.
INSERT OR IGNORE INTO app_settings (key, value)
VALUES ('bim.compliance.min_severity', 'HIGH');

-- «Дараа» дарсан мөрийг хэдэн цаг чимээгүй байлгах вэ (§76 snooze).
INSERT OR IGNORE INTO app_settings (key, value)
VALUES ('bim.compliance.snooze_hours', '24');
```

```sql
-- =============================================================
-- 0230_compliance_authority.sql — ЭРХИЙН ТҮВШИН БА ҮЕ ШАТТАЙ ТАРААЛТ
-- =============================================================
-- ЗОРИЛГО: v2 §80-ийн LEVEL 0 (OBSERVE) → 1 (EXPLAIN) → 2 (RECOMMEND)
--   дэвшилтийг DLL-гүйгээр, НЭГ `UPDATE`-ээр хийх боломжтой болгох.
--
-- ⚠️ ЯАГААД 0228-Д БИШ, ТУСДАА ФАЙЛД ВЭ: 0228 нь ЯГ 8 statement — түүний
--   толгойд «ЕС ДЭХ дугуй нь ШИНЭ ФАЙЛ, ШИНЭ ДУГААР шаардана» гэж бичсэн.
--   Тээврийн задлагч нь нэг `--command`-д хэт олон statement байхад УНАДАГ
--   ба зөрчил нь файлыг ХАГАС хэрэгжүүлээд `d1_migrations`-д мөр
--   ҮЛДЭЭХГҮЙ.  Тиймээс энэ хоёр мөр НЭГ Ч ТОХИОЛДОЛД 0228 руу
--   НЭГТГЭГДЭХГҮЙ.
--
-- ⚠️ ЭНЭ ХОЁР ТҮЛХҮҮРГҮЙГЭЭР TRACK 2 БҮХЭЛДЭЭ OBSERVE ДЭЭР ГАЦНА:
--   `2-5-finding-surface` §3.1-ийн `authorityFromSetting(null)` нь
--   `'OBSERVE'` руу унана (аюулгүй, гэвч ДЭВШИХ БОЛОМЖГҮЙ);
--   `2-0-OWNER-BRIEF` §3.2-ийн релизийн төлөвлөгөө нь ЯГ ЭНЭ хоёр мөрийг
--   `UPDATE` хийхэд тулгуурладаг; `2-8-install-and-health` нь
--   `addin_installs.authority_level`-ыг ЭНДЭЭС хүлээж байна.
--
-- ⚠️ УНШИГЧ: `loadComplianceConfig` (§3.4) — `COMPLIANCE_KEYS` дотор
--   ХОЁУЛАА байна, `GET /api/learning/settings`-ийн `compliance` объектоор
--   add-in руу очно.  Уншигчгүй дугуй нь дугуй байхгүйгээс ДОР (0195:152-155).
-- ⚠️ INSERT OR IGNORE тул дахин ажиллуулж болно.
-- ⚠️ ТЭЭВЭР: 2 statement (<= 9), блок тайлбаргүй, мөрөн дотор ; АЛГА

-- v2 §80.  '0' OBSERVE · '1' EXPLAIN · '2' RECOMMEND (MVP-ийн дээд).
-- ⚠️ '3'+ нь Track 2-ын хамрах хүрээнээс ГАДНА — §40-R4.
-- ⚠️ Релиз N нь ЗААВАЛ '0'-ээр гарна: DLL нь бүрэн хөдөлгүүрийг агуулна,
--    гэвч дүгнэлт ХЭРЭГЛЭГЧИД ХАРАГДАХГҮЙ.
INSERT OR IGNORE INTO app_settings (key, value)
VALUES ('bim.compliance.authority_level', '0');

-- ҮЕ ШАТТАЙ ТАРААЛТ.  `machine_hash` (0202:63, sha256) -ийг 0-99 болгож
-- хэшлээд энэ утгатай харьцуулна: hash < rollout_pct бол ЖИНХЭНЭ багц
-- очно.  ⚠️ Эхний бодит багц 1-2 машинд очих ёстой, 20-д БИШ — автомат
-- шинэчлэл байхгүй тул планировщикийн алдаа 20 компьютерийг НЭГ ЗЭРЭГ
-- цохивол буцаах арга нь ГАРААР суулгах л болно.
INSERT OR IGNORE INTO app_settings (key, value)
VALUES ('bim.compliance.rollout_pct', '0');
```

### 3.4 `backend/src/routes/learning.ts` — арван дугуйн УНШИГЧ

`loadCaptureConfig`-ийн ХАЖУУД, түүнийг ХӨНДӨЛГҮЙ (`learning.ts:191-218` нь bim.capture.* -ыг эзэмшинэ):

```ts
/** v2 §53/§75/§76/§80/§82 — бодит хугацааны хөдөлгүүрийн дугуйнууд (0228 + 0230). */
export interface ComplianceConfig {
  mode: 'off' | 'observe' | 'explain' | 'recommend';
  /** v2 §80.  '0'..'5' тэмдэгт мөрөөс.  0230.  ⚠️ NULL ⇒ 0 (OBSERVE). */
  authorityLevel: 0 | 1 | 2 | 3 | 4 | 5;
  /** 0-100.  `machine_hash` % 100 < rollout_pct бол ЖИНХЭНЭ багц.  0230. */
  rolloutPct: number;
  settleMs: number;
  maxDeferMs: number;
  maxElementsPerSet: number;
  rawRingMax: number;
  emitBatchMax: number;
  minSeverity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO';
  snoozeHours: number;
}

const COMPLIANCE_KEYS = [
  'bim.compliance.mode',
  'bim.compliance.settle_ms',
  'bim.compliance.max_defer_ms',
  'bim.compliance.max_elements_per_set',
  'bim.compliance.raw_ring_max',
  'bim.compliance.emit_batch_max',
  'bim.compliance.min_severity',
  'bim.compliance.snooze_hours',
  'bim.compliance.authority_level',
  'bim.compliance.rollout_pct',
] as const;

/**
 * ⚠️ АРВАН ТҮЛХҮҮР, АРВАН УНШИЛТ.  0228-ийн толгойд бичсэн дүрэм:
 *    уншигчгүй дугуй нь дугуй байхгүйгээс ДОР (`assistant.min_confidence`,
 *    0195:152-155).  Түлхүүр нэмбэл ЭНЭ массивт ба доорх буцаалтад НЭМ.
 * ⚠️ `authority_level` ба `rollout_pct` (0230) нь ЗААВАЛ ЭНД байна — тэднийг
 *    `2-5` (самбарын горим), `2-0` (релизийн төлөвлөгөө) ба `2-8`
 *    (`addin_installs.authority_level`) ГУРВУУЛАА хэрэглэнэ, гэвч add-in
 *    руу хүрэх ЦОРЫН ГАНЦ суваг нь энэ уншигч ба доорх `compliance` объект.
 */
export async function loadComplianceConfig(db: D1Database): Promise<ComplianceConfig> { /* … */ }
```

`GET /api/learning/settings`-ийн буцаалтад НЭМНЭ (одоо байгаа арван талбарыг ХӨНДӨХГҮЙ):

```ts
    compliance: {
      mode: cc.mode,
      authority_level: cc.authorityLevel,
      rollout_pct: cc.rolloutPct,
      settle_ms: cc.settleMs,
      max_defer_ms: cc.maxDeferMs,
      max_elements_per_set: cc.maxElementsPerSet,
      raw_ring_max: cc.rawRingMax,
      emit_batch_max: cc.emitBatchMax,
      min_severity: cc.minSeverity,
      snooze_hours: cc.snoozeHours,
    },
```

`POST /api/learning/events`-д НЭГ талбар нэмнэ — `session.perf_json`:

```ts
// ⚠️ `bim_sessions` бол 0206-ийн trigger-т ОРООГҮЙ ЦОРЫН ГАНЦ хүснэгт
//    (`check-bim-events.mjs:35`) тул UPDATE хууль ёсны.  Гүйцэтгэлийн
//    хураангуй нь сессийн ТӨГСГӨЛД (эсвэл 60 с тутам) шинэчлэгдэнэ.
// ⚠️ БҮХ талбар дутуу бол ЯГ NULL — ХООСОН ОБЪЕКТ БИШ (0216:29-40).
const perfJson = buildPerfJson(rawSession.perf);   // null | JSON string
```

`buildPerfJson` нь `revit.ts`-ийн `buildTimingJson`-ыг ЯГ хуулна: тоон талбар бүрийг `Number.isFinite` шалгаж, бүгд дутуу бол `null` буцаана.

**⚠️ `bimEvents.ts`-ийн `SESSION_INSERT_COLUMNS`-д `perf_json` НЭМЭГДЭНЭ** ⇒ `SESSION_BINDS` 31 → 32, `SESSION_ROWS_PER_STATEMENT` = `floor(100/33)` = **3, өөрчлөгдөхгүй**. Тайлбарын `// = 27` тоог шинэчил. Миграцийн ДАРАА `node backend/scripts/check-bim-events.mjs` ЗААВАЛ ажиллуул.

### 3.5 `backend/src/routes/compliance.ts` — мэдэгдлийн төлөвийн ГУРВАН handler (ФАЙЛ ҮҮСГЭХГҮЙ)

⚠️ **ЭНЭ ФАЙЛЫГ `2-2-rule-model` ҮҮСГЭНЭ, ЭНЭ СЕСС БИШ.** `2-2`-ийн «Хөндөх файлууд» мөрөнд `backend/src/routes/compliance.ts` (ШИНЭ), `backend/src/index.ts` ба `backend/src/lib/modules.ts` ГУРВУУЛАА байгаа ба §3.12 нь `const compliance = new Hono(...)`, `app.route('/api/compliance', compliance)` ба `API_PREFIXES`/`MODULE_OF`-ийн бичилтийг эзэмшинэ. `2-2` ба `2-4` нь **ИЖИЛ ДОЛГИОНД (wave 1)** ажилладаг тул хоёулаа роутер зарлавал НЭГ ФАЙЛЫГ ХОЁР АГЕНТ зэрэг үүсгэх бөгөөд нэг нь нөгөөгийнхөө хамгаалалтыг дарж бичнэ.

**Тиймээс энэ сесс:** `2-2`-ийн үүсгэсэн роутер дээр ГУРВАН handler НЭМНЭ, ӨӨР ЮУ Ч ХИЙХГҮЙ. `new Hono()` бичихгүй, `requireRole` файлын түвшний хамгаалалт тавихгүй (`2-2` тавьсан), `index.ts` ба `lib/modules.ts`-ыг НЭЭХГҮЙ.

```ts
// ⚠️ `2-2`-ийн үүсгэсэн `compliance` роутер дээр ЗӨВХӨН НЭМЭЛТ.
//
// ⚠️ SELF-VIEW-ONLY.  Гурван маршрут бүр `user_id = viewer.sub` эсвэл АГРЕГАТ.
//    0201:23-32, 0203:27, 0205:44-д дөрвөн удаа бичигдсэн, `revitNoteAi.
//    test.ts:262`-оор түгжигдсэн инвариант.
// ⚠️ MCP ТУСГААР ХУВИЛБАР БАЙХГҮЙ.  `/mcp` нь `workerScopeGuard`,
//    `entitlementGuard` ба tenant `tid` шалгалтыг НЭГЭН ЗЭРЭГ тойрдог
//    (`learning.ts:37-58`).

// Миний нээлттэй мэдэгдлүүд (badge-ийн эх сурвалж).  PULL, PUSH БИШ.
compliance.get('/notices', …);          // ?doc_uid=&min_severity=
// Нэг мэдэгдлийн төлөв: shown | acknowledged | snoozed | dismissed
compliance.post('/notices/:dedupKey/state', …);
// Хэдэн мөр байна — самбар ХААЛТТАЙ үед ribbon caption-д зориулав.
compliance.get('/notices/count', …);    // { critical, high, total }
```

⚠️ `lib/workerScope.ts`-ийн `WORKER_ALLOWED_PREFIXES` (:18-33)-д `/api/compliance` **НЭМЭГДЭХГҮЙ** — тэр нь хаалттай-анхдагч жагсаалт тул `worker` дүр автоматаар 403 авна, энэ нь ЗӨВ. (Энэ мөрийг `2-2` МӨН бичсэн; давхардсан баталгаа нь хор хөнөөлгүй, учир нь ЭНД ХИЙХ ЮМ БАЙХГҮЙ гэсэн үг.)

### 3.6 `ChangeTracker.cs` — `RawRing` (халуун замын ЦОРЫН ГАНЦ нэмэлт)

⚠️ **Халуун замын өөрчлөлтийг ҮНЭН ЗӨВӨӨР ТОДОРХОЙЛОХ.** «Нэг мөр нэмнэ» гэж хэлэх нь буруу: `RawRing.Append(key, opName, sec, e.GetAddedElementIds(), …)` гэж бичвэл handler-ийн Revit API ажил ХОЁР ДАХИН нэмэгдэж, `:792-795`-ийн гэрээг зөрчинө (3000 элементийн наалтад гурван цуглуулгын оронд зургаа материалжина).

**Зөв тодорхойлолт:** `OnDocumentChanged` нь **гүйлгээ тутам НЭГ цагирган бичлэг авна; тэр нь одоо байгаа `lock (Gate)`-ийн ДОТОР, одоо байгаа гурван давталтын ДОТОР тоологдсон утгуудаас бүрдэнэ. Шинэ Revit API дуудлага БАЙХГҮЙ. Халуун зам дээр шинэ ХУВААРИЛАЛТ БАЙХГҮЙ.**

⚠️ **ГЭХДЭЭ ТЭР УТГУУД ӨНӨӨДӨР БАЙХГҮЙ — ТЭДНИЙГ ЭНЭ СЕСС НЭМНЭ.** `grep -n "addedN\|deletedN\|modifiedN\|_sample" revit-mcp/addin/ChangeTracker.cs` нь **ТЭГ мөр** буцаана (2026-08-30-нд баталсан): гурван давталт (`:823-889`) нь ЮУ Ч ТООЛДОГГҮЙ, олонлогт нэмээд цааш явдаг. Тиймээс тоолуур нь «үнэгүй дайвар бүтээгдэхүүн» БИШ — тэр нь **давталт тутамд нэг `int` өсгөлт ба хамгийн ихдээ `SamplePerTxn` `long` хуулбар**. Энэ бол ҮНЭН ТӨЛБӨР; түүнийг нуух нь дараагийн хүнийг «нэг мөр л шүү дээ» гэж бодуулна. Доорх diff нь ЯГ ЭНЭ гурван давталтыг харуулна — түүнгүйгээр `AppendRaw`-ийн аргументууд ЭМХЭТГЭГДЭХГҮЙ.

```csharp
        /// <summary>
        /// ТҮҮХИЙН ЦАГИРАГ — §55-R3-ын «preserve the ORIGINAL event history».
        ///
        /// ⚠️ ЯАГААД ХЭРЭГТЭЙ ВЭ: `Change`-ийн олонлогийн алгебр нь ЗОРИУД
        /// АЛДАГДАЛТАЙ.  Үүсгээд устгасан нь тэг болно (`:849`), `Depth` 0
        /// болбол мөр БҮРЭН хасагдана (`UndoTouch`, `:206`), `Note()` нь
        /// үйлдэл ба цагийг ДАРЖ бичнэ (`:182`).  Тэр нь «суурьтай юу
        /// ялгаатай вэ» гэдэгт ЗӨВ, «хүн юу хийсэн бэ» гэдэгт БУРУУ.
        /// Сургалт нь хоёрдахийг шаарддаг.
        ///
        /// ⚠️ ХУВААРИЛАЛТГҮЙ.  Урьдчилан хуваарилсан struct массив + нэг
        /// long буфер.  Халуун зам дээр `new` БАЙХГҮЙ — GC-ийн богино
        /// зогсолт ч гүйлгээ бүрд давтагдвал мэдрэгдэнэ.
        ///
        /// ⚠️ ТООЛУУР НЬ ҮНЭН ЗӨВ, ID НЬ ТҮҮВЭР.  `SamplePerTxn = 24` нь
        /// `bim.capture.elements_per_txn`-ийн анхдагчтай (0208:17,
        /// `learning.ts:212`) ЯГ ТААРНА — сервер түүнээс илүүг хүлээж
        /// авахгүй тул илүү цуглуулах нь дэмий.
        /// </summary>
        internal struct RawEntry
        {
            public long Seq;            // монотон, сесс дотор ХЭЗЭЭ Ч дахин эхлэхгүй
            public long Sec;            // Unix секунд (UTC)
            public int  OpIdx;          // `Change.Ops`-ийн индекс
            public int  Added, Deleted, Modified;   // ҮНЭН ЗӨВ тоо
            public int  SampleOff, SampleLen;       // `_sampleBuf` дэх байрлал
            public bool Undo;

            /// <summary>Баримтын түлхүүр = `RevitTools.DocUid(doc)`
            /// (`ChangeTracker.cs:610-614`).  ⚠️ ЗААВАЛ — үүнгүйгээр
            /// `ChangeSetCoalescer.Feed(…, docKey, …)` (§3.8) эмхэтгэгдэхгүй,
            /// §3.18-ын 5-р дүрэм («хоёр DocKey → хоёр ТУСДАА олонлог»)
            /// хангагдахгүй, ба §3.9.a-ийн envelope нь БАРИМТАА нэрлэж
            /// чадахгүй.  ⚠️ ХУВААРИЛАЛТ БИШ: `key` нь `:788`-д аль хэдийн
            /// байгаа мөр, энд ЗӨВХӨН ишийн хуулбар хийгдэнэ.</summary>
            public string DocKey;

            /// <summary>Revit-ийн ӨӨРИЙНХ нь гүйлгээний нэр (`OpNameOf(e)`,
            /// `:795`).  ⚠️ ЯАГААД `OpIdx`-ЭЭР ЗОГСОХГҮЙ ВЭ: `OpIdx` нь
            /// `Change.Ops`-ийн индекс бөгөөд тэр жагсаалт `Gate`-ийн ДОР
            /// амьдардаг — шавхагч түүнийг тайлахын тулд түгжээг ДАХИН
            /// авах болно (Хориглолт №7-ын эсрэг чиглэл).  Мөрийн ишийг
            /// энд хуулснаар шавхагч `op_name`-ыг ТҮГЖЭЭГҮЙ бөглөнө.
            /// ⚠️ Мөн ХУВААРИЛАЛТ БИШ — ишийн хуулбар.</summary>
            public string OpName;
        }

        private const int RawRingMax   = 4000;   // 0228: bim.compliance.raw_ring_max
        private const int SamplePerTxn = 24;     // 0208:17-той нэг мөр

        private static readonly RawEntry[] _ring      = new RawEntry[RawRingMax];
        private static readonly long[]     _sampleBuf = new long[RawRingMax * SamplePerTxn];
        private static long _ringSeq;        // нийт бичсэн (цагирганаас ИХ байж болно)
        private static long _ringDropped;    // хэтэрсэн тул алдагдсан — `dropped_count`
        /// <summary>Уншигч (`ComplianceScheduler`) хаана хүртэл шавхсан.
        /// ⚠️ ЗӨВХӨН `TryDrain` бичнэ, ЗӨВХӨН `Gate` дотор.</summary>
        private static long _ringDrainedSeq;
        /// <summary>Гүйлгээний түүврийн буфер дэх ОДООГИЙН бичилтийн урт.
        /// Давталтууд дүүргэж, `AppendRaw` уншаад ТЭГЛЭНЭ.</summary>
        private static int _sampleN;
        private static readonly System.Threading.ManualResetEventSlim _wake =
            new System.Threading.ManualResetEventSlim(false);

        /// <summary>Планировщикийн сэрүүлэг — `2-3` эзэмшинэ.</summary>
        internal static System.Threading.ManualResetEventSlim Wake => _wake;
        internal static long RingSeq     => System.Threading.Interlocked.Read(ref _ringSeq);
        internal static long RingDropped => System.Threading.Interlocked.Read(ref _ringDropped);
```

`OnDocumentChanged`-ийн ДОТОР, `lock (Gate)` (`:798`)-ийн ДОТОР. **Гурван давталтын diff нь ЗААВАЛ, учир нь тоолуур ба буфер нь өнөөдөр БАЙХГҮЙ:**

```diff
                     int opIdx = c.OpIndexOf(opName);
                     bool undo = e.Operation == UndoOperation.TransactionUndone;
+
+                    // ⚠️ ТҮҮХИЙН БИЧЛЭГИЙГ УРЬДЧИЛАН БЭЛТГЭНЭ.  `slot`-ыг
+                    //    ДАВТАЛТААС ӨМНӨ тооцно: түүврийн буферийн байрлал нь
+                    //    ЯГ ЭНЭ бичлэгийнх байх ёстой.  Дараа нь тооцвол
+                    //    давталтууд ӨМНӨХ гүйлгээний нүдэнд бичих ба бичлэг
+                    //    бүр өөр гүйлгээний id-г заана (чимээгүй өгөгдөл эвдрэл).
+                    long rawSeq  = _ringSeq;
+                    int  rawSlot = (int)(rawSeq % RawRingMax);
+                    int  sampleOff = rawSlot * SamplePerTxn;
+                    _sampleN = 0;
+                    int addedN = 0, deletedN = 0, modifiedN = 0;

                     foreach (ElementId id in e.GetAddedElementIds())
                     {
                         long v = id.Value;
+                        // ⚠️ ТООЛУУР НЬ ҮНЭН ЗӨВ, ID НЬ ТҮҮВЭР.  Тоолуур нь
+                        //    ОЛОНЛОГИЙН АЛГЕБРААС ӨМНӨ өснө: «хүн юу хийсэн»
+                        //    гэдэг нь «суурьтай юу ялгаатай»-аас ӨӨР (§2.8).
+                        addedN++;
+                        if (_sampleN < SamplePerTxn) _sampleBuf[sampleOff + _sampleN++] = v;

                         if (undo)
```

```diff
                     foreach (ElementId id in e.GetDeletedElementIds())
                     {
                         long v = id.Value;
+                        deletedN++;
+                        if (_sampleN < SamplePerTxn) _sampleBuf[sampleOff + _sampleN++] = v;
```

```diff
                     foreach (ElementId id in e.GetModifiedElementIds())
                     {
                         long v = id.Value;
+                        modifiedN++;
+                        if (_sampleN < SamplePerTxn) _sampleBuf[sampleOff + _sampleN++] = v;
                         if (c.Deleted.Contains(v)) continue;
```

`Dirty.Add(key);` (`:891`)-ийн ЯГ ӨМНӨ, ИЖИЛ түгжээн дотор:

```csharp
                    // ⚠️ ТҮҮХ.  Дээрх гурван давталт `addedN/deletedN/modifiedN`-ыг
                    //    тоолж, `_sampleBuf`-ийн `sampleOff` байрлалд хамгийн ихдээ
                    //    `SamplePerTxn` id хуулсан.  ЭНД Revit-ийн API-д ХҮРЭХГҮЙ.
                    AppendRaw(rawSeq, rawSlot, key, opName, opIdx, sec, undo, addedN, deletedN, modifiedN);
                    Dirty.Add(key);
```

```csharp
        /// <summary>⚠️ ЗӨВХӨН `Gate` барьсан үед дуудна.  Хуваарилалтгүй.
        /// `seq` / `slot` нь ДАВТАЛТААС ӨМНӨ тооцогдсон утгууд.</summary>
        private static void AppendRaw(long seq, int slot, string docKey, string opName,
                                      int opIdx, long sec, bool undo,
                                      int addedN, int deletedN, int modifiedN)
        {
            if (seq - _ringDrainedSeq >= RawRingMax)
            {
                // Цагираг дүүрч, уншигч хоцорсон — ХАМГИЙН ХУУЧНЫГ дарж бичнэ.
                // ⚠️ ЧИМЭЭГҮЙ БИШ: `dropped_count`-д хүрч, «юу ч болоогүй» ба
                //    «алдсан» хоёр ЯЛГАГДАНА (0202:99-ийн зорилго).
                _ringDropped++;
                // Шавхагдаагүй ХАМГИЙН ХУУЧИН бичлэг үнэндээ алга болсон тул
                // курсорыг урагшлуулна — эс бөгөөс `TryDrain` дарагдсан нүдийг
                // ШИНЭ гэж уншиж, нэг гүйлгээ ХОЁР УДАА тоологдоно.
                _ringDrainedSeq = seq - RawRingMax + 1;
            }
            _ring[slot].Seq      = seq;
            _ring[slot].Sec      = sec;
            _ring[slot].DocKey   = docKey;   // ишийн хуулбар, хуваарилалт БИШ
            _ring[slot].OpName   = opName;   // ишийн хуулбар, хуваарилалт БИШ
            _ring[slot].OpIdx    = opIdx;
            _ring[slot].Added    = addedN;
            _ring[slot].Deleted  = deletedN;
            _ring[slot].Modified = modifiedN;
            _ring[slot].Undo     = undo;
            _ring[slot].SampleOff = slot * SamplePerTxn;
            _ring[slot].SampleLen = _sampleN;          // давталтууд дүүргэсэн
            _ringSeq = seq + 1;
            _wake.Set();
        }
```

**УНШИГЧИЙН API — цагирагт хүрэх ЦОРЫН ГАНЦ арга.** ⚠️ `TryDrain`-ийг дуудах ЭРХТЭЙ КОД НЭГ Л БАЙНА: `BimEmitter._pump` thread (§3.9.a). Тэр нь `_ringDrainedSeq`-ийг урагшлуулдаг тул ХОЁР ДАХЬ дуудагч гарвал хоёул бичлэгүүдийг бие биенээсээ ХУЛГАЙЛЖ, гүйлгээний тал нь сургалтын дэвтэрт, нөгөө тал нь дүрмийн үнэлгээнд ЧИМЭЭГҮЙ алга болно. `2-3`-ийн планировщик цагирагт ШУУД ХҮРЭХГҮЙ — тэр нь `_pump`-ийн аль хэдийн шавхаж, коалесцераар хаасан `LogicalChangeSet` POCO-г хүлээж авна (2-3 §3.6-ийн `RunPass(set, …)`). Энэ аргагүйгээр `_ring` ба `_sampleBuf` нь `private static` тул шавхагч СЭРЭХ ба ХЭДЭН БИЧЛЭГ БИЧСЭНИЙГ л мэдэх боловч НЭГ Ч БИЧЛЭГ УНШИЖ ЧАДАХГҮЙ, мөн `_ringDrainedSeq` ХЭЗЭЭ Ч урагшлахгүй тул алдагдлын тооцоо ажиллахгүй:

```csharp
        /// <summary>
        /// Цагирагаас ШИНЭ бичлэгүүдийг хуулж авна.  Буцах утга: хуулсан тоо.
        ///
        /// ⚠️ `Gate.Wait(0)`.  ӨРСӨЛДӨӨН БОЛ 0 БУЦААНА, ХҮЛЭЭХГҮЙ — энэ түгжээг
        /// `OnDocumentChanged` нь ГҮЙЛГЭЭ БҮРТ Revit-ийн үндсэн thread дээр
        /// авдаг (`:798`).  Хүлээх нь хэрэглэгчийн зурлагыг гацаана.
        /// ⚠️ ХУУЛБАР нь ХЯЗГААРТАЙ: `dst.Length` бичлэг, `sampleDst`-д
        /// `dst.Length * SamplePerTxn` long.  `TryGetByKey`-ийн 500 000 id-тай
        /// гүнзгий хуулбартай ЯМАР Ч ХАМААРАЛГҮЙ.
        /// ⚠️ `droppedSinceLast` нь `dropped_count`-д НЭМЭГДЭНЭ — «юу ч
        /// болоогүй» ба «алдсан» хоёрыг ялгах цорын ганц зам (0202:99).
        /// </summary>
        internal static int TryDrain(RawEntry[] dst, long[] sampleDst,
                                     out long fromSeq, out long droppedSinceLast)
        {
            fromSeq = 0; droppedSinceLast = 0;
            if (!System.Threading.Monitor.TryEnter(Gate)) return 0;
            try
            {
                fromSeq = _ringDrainedSeq;
                long avail = _ringSeq - _ringDrainedSeq;
                int n = (int)Math.Min(avail, dst.Length);
                for (int i = 0; i < n; i++)
                {
                    int slot = (int)((_ringDrainedSeq + i) % RawRingMax);
                    dst[i] = _ring[slot];
                    Array.Copy(_sampleBuf, _ring[slot].SampleOff,
                               sampleDst, i * SamplePerTxn, _ring[slot].SampleLen);
                    // Хуулсан бичлэгийн түүвэр нь ОДОО `sampleDst`-д — уншигч
                    // индексийг ДАХИН тооцно, `SampleOff` нь дуудагчийнх.
                    dst[i].SampleOff = i * SamplePerTxn;
                }
                _ringDrainedSeq += n;
                droppedSinceLast = System.Threading.Interlocked.Exchange(ref _ringDropped, 0);
                if (_ringDrainedSeq >= _ringSeq) _wake.Reset();
                return n;
            }
            finally { System.Threading.Monitor.Exit(Gate); }
        }
```

⚠️ **`TryDrain` нь `Gate`-ыг АВААД ШУУД ТАВИНА — bus дуудлага, диск, `await` ХЭЗЭЭ Ч дотор нь ОРОХГҮЙ** (Хориглолт №7). Планировщик нь POCO хуулбараа авсны ДАРАА л `RevitToolBus.TryCall` рүү явна.

⚠️ **`TryGetByKey`-г ЦИКЛИЙН УНШИЛТААР ХЭЗЭЭ Ч ХЭРЭГЛЭХГҮЙ.** Тэр нь `Gate` дотор 500 000 id ба 20 000 META мөрийг гүнзгий хуулна (`:417-437`) — 3 секунд тутмын уншилт болговол `Metrics.FlushLock` гүйлгээ БҮРТ өснө. Планировщик нь **`RawRing`-ийг л уншина**: тэр нь аль хэдийн хязгаартай, залгамал дельта. `TryGetByKey` нь одоогийн гурван ШУУД БУС дуудагчаа (`ChangeReport.cs:274`, `:729`, `RevitTools.cs:315` — гурвуулаа `ChangeTracker.TryGet(doc, …)`-ээр дамжина, `:394-397`) ХЭВЭЭР хадгална, ШИНЭ дуудагч НЭМЭГДЭХГҮЙ.

### 3.7 `ChangeTracker.cs` — `_flushTimer`-ийн ЗАСВАР (энэ релизэд)

```csharp
-           _flushTimer = new Timer(_ => FlushDirty(), null, FlushIntervalMs, FlushIntervalMs);
+           // ⚠️ НЭГ УДААГИЙН, ӨӨРИЙГӨӨ ДАХИН ЗЭВСЭГЛЭДЭГ таймер.
+           // Урьд нь ҮЕ ҮЕИЙН байсан: өмнөх callback дуусаагүй байхад
+           // 3 секунд тутам ШИНЭ threadpool thread дээр ДАХИН асдаг.
+           // Хоёр `FlushDirty` зэрэг ажиллавал ИЖИЛ `path + ".tmp"`-д
+           // бичиж (`:577`), хоёр дахь `File.Move` нь `catch { }`-д
+           // (`:584`) чимээгүй залгигдана — гэтэл `Dirty.Clear()` (`:558`)
+           // аль хэдийн ажилласан тул тэр өөрчлөлт диск рүү ХЭЗЭЭ Ч
+           // ХҮРЭХГҮЙ.  Өнөөдөр callback нь миллисекунд тул тохиолддоггүй;
+           // ачаалал нэмэгдэхэд ЖИГД болно.
+           _flushTimer = new Timer(_ => FlushDirty(), null,
+                                   FlushIntervalMs, System.Threading.Timeout.Infinite);
```

`FlushDirty`-ийн эхэнд давталтын хамгаалалт, төгсгөлд `finally`-д дахин зэвсэглэлт:

```csharp
        private static int _flushBusy;

        private static void FlushDirty()
        {
            // ⚠️ ДАВХАР ОРОЛТЫН ХАМГААЛАЛТ (`Percentiles.cs:417`-ийн хэв маяг).
            if (System.Threading.Interlocked.CompareExchange(ref _flushBusy, 1, 0) != 0) return;
            try { /* … одоо байгаа бие … */ }
            finally
            {
                System.Threading.Interlocked.Exchange(ref _flushBusy, 0);
                try { _flushTimer?.Change(FlushIntervalMs, System.Threading.Timeout.Infinite); }
                catch { /* Dispose хийгдсэн — унтраалт явж байна */ }
            }
        }
```

Мөн түр файлыг процессын id-аар ялгана (§3.13-ын хоёр Revit-ийн тохиолдол):

```csharp
-                    string tmp = path + ".tmp";
+                    // ⚠️ ХОЁР REVIT НЭГ `%APPDATA%`-Г ХУВААЛЦАНА (2024 + 2027
+                    //    зэрэг нээлттэй нь хувилбар шилжилтийн үед ЭНГИЙН).
+                    //    `PathFor` нь детерминист тул түр файлын нэр давхцана.
+                    string tmp = path + "." + _pid + ".tmp";
```

### 3.8 `ChangeSetCoalescer.cs` (ШИНЭ) — §55-ийн 2 → 3 үе шат

⚠️ **`Autodesk.Revit`-ийн ЯМАР Ч төрөл ХЭРЭГЛЭХГҮЙ** — `Nudges.cs:20-23`, `Timing.cs:20-21`, `Percentiles.cs:16-18`-ийн дүрэм. Ингэснээр `check_changeset.py` нь Revit-гүйгээр `dotnet run`-аар тулгаж чадна (§3.17), мөн net48 (R24) build дээр эмхэтгэгдэнэ.

```csharp
    /// <summary>
    /// ТҮҮХИЙ ҮЙЛ ЯВДАЛ → ЛОГИК ӨӨРЧЛӨЛТИЙН ОЛОНЛОГ (v2 §55).
    ///
    /// ⚠️ ЦЭВЭР.  Revit-ийн API-д хүрэхгүй, диск хөндөхгүй, цаг өөрөө
    /// уншихгүй — `nowMs` нь дуудагчаас ирнэ (тестлэх боломжтой байх).
    ///
    /// ⚠️ ХОЁР ХАДГАЛАЛТ, НЭГ УРСГАЛ.  `RawRing` = ТҮҮХ (алдагдалгүй,
    /// сургалтад).  Энэ ангийн гаралт = БОДИТ ХУГАЦААНЫ дүн шинжилгээний
    /// оролт (нэгтгэсэн).  Хоёр нь бие биеэ ОРЛУУЛАХГҮЙ — §55-R3.
    /// </summary>
    internal sealed class ChangeSetCoalescer
    {
        /// <summary>Намжих цонх.  0228: bim.compliance.settle_ms.</summary>
        private readonly int _settleMs;
        /// <summary>Хойшлуулалтын дээд.  0228: bim.compliance.max_defer_ms.</summary>
        private readonly int _maxDeferMs;
        /// <summary>Элементийн дээд.  0228: bim.compliance.max_elements_per_set.</summary>
        private readonly int _maxElements;

        public ChangeSetCoalescer(int settleMs, int maxDeferMs, int maxElements) { … }

        /// <summary>`RawRing`-ийн нэг бичлэгийг нэмнэ.  ХУРДАН, түгжээгүй
        /// (нэг worker thread л дуудна).</summary>
        public void Feed(long seq, long nowMs, string docKey,
                         long[] ids, int idsLen, bool undo);

        /// <summary>
        /// Хаах цаг болсон уу.  `null` = хараахан үгүй.
        ///
        /// ⚠️ ГУРВАН ХААЛТЫН ШАЛТГААН, ГУРАВ НЬ ӨӨР УТГАТАЙ:
        ///   "settle" — жинхэнэ нам гүм цонх өнгөрөв ⇒ ЦУГЛУУЛЖ БОЛНО
        ///   "size"   — элементийн хязгаарт хүрэв      ⇒ ЦУГЛУУЛЖ БОЛНО
        ///   "defer"  — `maxDeferMs` өнгөрөв           ⇒ ОЛОНЛОГ ҮҮСНЭ,
        ///              ГЭХДЭЭ ЦУГЛУУЛАЛТ ЭХЛЭХГҮЙ.
        ///
        /// ⚠️ ЯАГААД "defer" НЬ ЦУГЛУУЛАХГҮЙ ВЭ: `maxDeferMs` нь ЯГ ТЭР
        /// мөчид асдаг — хэрэглэгч хоёр минут тасралтгүй хана зурж, 1200 мс
        /// завсарлаагүй үед.  Тэнд үндсэн thread-ийн ажил төлөвлөх нь
        /// t=15с, 30с, 45с бүрд ил харагдах цочролыг өгнө.  Тэр цочрол нь
        /// хүмүүсийг add-in-ыг устгахад хүргэдэг зүйл (R7).
        /// </summary>
        public LogicalChangeSet TryClose(long nowMs, bool quiet);
    }

    internal sealed class LogicalChangeSet
    {
        public string DocKey;
        public long   FirstSeq, LastSeq;     // `RawRing`-т эргэж холбогдоно
        public long   OpenedMs, ClosedMs;
        public long[] ElementIds;            // ДАВХАРДААГҮЙ
        public string CloseReason;           // settle | size | defer | flush
        public bool   MayCollect;            // defer ⇒ false
        public bool   Coarse;                // хязгаарт хүрч ТАЙРАГДСАН
        public int    UndoBurst;             // undo:/redo: гүйлгээний тоо
    }
```

**`UndoBurst` нь `op_name`-ийн угтвараас ҮНЭГҮЙ гарна** (`ChangeTracker.cs:753`). 2-3 нь undo-ийн шуурга явж байх зуур дахин тооцоог ЗОГСООХ ба шуурга намжсаны дараа НЭГ УДАА л тооцно — 40 удаа Ctrl+Z дарахад 40 удаа дахин үнэлэхгүй.

### 3.9 `BimEmitter.cs` (ШИНЭ) — ХАМГИЙН ӨНДӨР ХӨШҮҮРЭГТЭЙ ЗҮЙЛ

Энэ файл нь 0201-0210-д ҮЙЛДВЭРЛЭГЧ өгнө. R1 нь ЗӨВХӨН энэ дээр блоклогдож байна. ⚠️ **Доорх анги нь ЗӨВХӨН ТЭЭВЭР** — түүнийг ХЭН, ЮУГААР дүүргэхийг **§3.9.a** тогтооно; тэр дэд хэсэггүйгээр энэ анги нь ямар ч дуудагчгүй дараалал бөгөөд R1 ХЭРЭГЖИХГҮЙ.

```csharp
    /// <summary>
    /// BIM ҮЙЛ ЯВДЛЫН БАТ БӨХ ИЛГЭЭГЧ — `POST /api/learning/events`.
    ///
    /// ⚠️ ЛОКАЛ ЭХЛЭЭД.  Мөр нь ЭХЛЭЭД дискэнд (`AppendOne`), ДАРАА НЬ
    /// сүлжээнд.  `AssistantLog.cs:483-487`-ийн батлагдсан хэв маяг:
    /// илгээлт бүтэлгүйтвэл 0 буцаана, мөр локалд үлдэнэ.
    ///
    /// ⚠️ БҮТЭН ДАХИН БИЧИЛТ ХЭЗЭЭ Ч ХИЙХГҮЙ.  `AssistantLog.Save()`
    /// (`:211-220`) нь 3000 мөрийг цувуулж дахин бичдэг; тэр нь мессеж
    /// бүрд дуудагдаж чат удаашруулж байсан (`:186-190`, `:378-401`).
    /// JSONL нь ЗАЛГАМАЛ — `File.AppendAllText` л хангалттай.
    ///
    /// ⚠️ `Sent` ТУГ ЗААВАЛ ХАДГАЛАГДАНА.  `AssistantLog.cs:108` нь түүнийг
    /// `[JsonIgnore]` гэсэн тул Revit асах бүрд БҮХ хуучин мөрийг ДАХИН
    /// илгээдэг.  Сервер `ON CONFLICT`-оор шүүдэг тул хор хөнөөлгүй ч,
    /// бодит хүргэлтийн алдааг НУУНА.  БИД ТҮҮНИЙГ ДАВТАХГҮЙ — гэхдээ
    /// бүтэн дахин бичилтээр ч БИШ: тусдаа КУРСОР файл (`bim-events.cursor`)
    /// нь хамгийн сүүлд баталгаажсан локал дугаарыг хадгална, tmp+move-оор
    /// атомаар.  Нэг флашд НЭГ жижиг бичилт, 3000 мөрийн цувралт БИШ.
    ///
    /// ⚠️ REVIT-ИЙН ЯМАР Ч ТӨРӨЛ ХЭРЭГЛЭХГҮЙ.
    /// </summary>
    internal static class BimEmitter
    {
        private static string Dir => Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
            "RevitMcpAddin");
        private static string LogPath    => Path.Combine(Dir, "bim-events.jsonl");
        private static string CursorPath => Path.Combine(Dir, "bim-events.cursor");

        /// <summary>Санах ойн дараалал.  `Percentiles.cs:493-497` хэв маяг.</summary>
        private const int MaxPending = 4096;
        private static readonly BlockingCollection<string> Pending =
            new BlockingCollection<string>(new ConcurrentQueue<string>(), MaxPending);
        private static long _dropped;      // → `bim_sessions.dropped_count`

        /// <summary>Дараалсан алдааны дараа таслуур.  §32 «bounded retry».</summary>
        private const int BreakerFailures = 5;
        private const int BreakerProbeMs  = 5 * 60 * 1000;
        private static readonly int[] BackoffMs = { 2000, 4000, 8000, 16000, 32000, 60000 };

        /// <summary>Файлын дээд хэмжээ.  Хэтэрвэл ЗӨВХӨН баталгаажсан
        /// мөрийг хаяж НЯГТРУУЛНА (ховор, атомаар, pid-тэй tmp).</summary>
        private const long MaxLogBytes = 2 * 1024 * 1024;

        public static void Start();                 // `App.OnStartup`-аас, `Metrics.Start`-ийн дараа
        public static void Enqueue(string envelopeJson);   // ХЭЗЭЭ Ч блоклохгүй, дүүрвэл `_dropped++`
        public static int  PendingCount { get; }
        public static void Cancel();                // token цуцлана, JOIN ХИЙХГҮЙ
        public static void Join(int ms);            // хязгаартай
        public static int  DrainBlocking(int ms);   // ЗӨВХӨН `BatchQto`-д, `Kill()`-ийн ӨМНӨ
    }
```

**Worker thread-ийн мөчлөг:**

1. `BatchQto.IsBatch` бол ШУУД буцна (§3.13).
2. `Pending`-ээс `emit_batch_max` (0228, анхдагч 100) хүртэл авч, `AppendOne`-оор JSONL-д бичнэ.
3. `GET /api/learning/events/head?stream_ids=<session_uid>` (`learning.ts:822`) → `last_seq`. Локал курсор ба `last_seq`-ийн ИХ нь = баталгаажсан хил.
4. Хилээс ДЭЭШ мөрүүдийг `POST /api/learning/events`-д илгээнэ (`AiHttp`, 20 с, `CancellationToken`).
5. `200` → курсорыг tmp+move-оор бичнэ. `{accepted:null, ingest:'off'}` (`learning.ts:304`) → **дахин оролдохоо БҮРЭН БОЛИНО** энэ сессид. `413` (`:308`, `:311`) → багцыг ХАГАСЛААД дахин оролдоно, багц хэмжээг мөчлөгт хадгална. `401` → `Degraded.Server`, чимээгүй. `5xx` / сүлжээ → backoff.
6. Дараалсан 5 алдаа → таслуур; 5 минут тутам НЭГ шалгах хүсэлт.
7. Файл `MaxLogBytes`-ээс том БА курсор > 0 бол нягтруулна.

**⚠️ `perf_json` НЬ ЭНД БИЧИГДЭНЭ.** `Metrics.Snapshot()` (§3.11) нь `p95_doc_changed_ms`, `p95_flush_lock_ms`, `p95_coalesce_ms`, `p95_emit_post_ms` ба нэмэлт түлхүүрүүдийг өгнө; `BimEmitter` тэдгээрийг сессийн handshake-д 60 секунд тутам ба унтраалтад хавсаргана.

**⚠️ БАГИЙН ТАЛБАРУУДЫГ ИЛГЭЭХ МӨЧИД ТАМГАЛНА** — 2-1-ийн `team_code`, `team_source`, `team_confidence`, `attribution_id` нь envelope-ийн `payload_json`-д ОРНО, JOIN-оор ШИЙДЭГДЭХГҮЙ. Учир нь `learning_events` нь 0206-ийн trigger-т орсон — ирээдүйн засвар түүхэн мөрийн УТГЫГ өөрчлөх БОЛОМЖГҮЙ байх ёстой.

#### 3.9.a ENVELOPE-ИЙН ГЭРЭЭ ба `Enqueue`-ийн ДУУДАХ ЦЭГҮҮД — R1-ийн ЦОРЫН ГАНЦ ХАРИУЛТ

⚠️ **ЭНЭ ДЭД ХЭСЭГГҮЙГЭЭР §3.9 нь ХЭН Ч ДҮҮРГЭХГҮЙ ДАРААЛАЛ юм.** `Enqueue(string envelopeJson)` гэж зарлаад тэр мөрийг ХЭН, ХААНА, ЯМАР ХЭЛБЭРЭЭР үүсгэхийг бичихгүй бол суурь №1 (canonical event model) ба R1 нь «бүх зүйл бэлэн, гэхдээ дэвтэр хоосон» гэсэн байдалд үлдэнэ — өнөөдрийн байдал ЯГ ТЭР (`grep -rn "learning/events" revit-mcp/addin/` нь **ТЭГ мөр**, 2026-08-30-нд баталсан). Доорх нь бүрэн гэрээ: **сесс гэж юу вэ → баримтын баримтуудыг хаанаас авах вэ → `RawEntry` → `TXN` буулгалт → `SESSION_START`/`SESSION_END` → POST-ийн бие → дуудах цэгүүд**.

##### (1) СЕСС ГЭЖ ЮУ ВЭ — `session_uid`-ийн ҮЙЛДВЭРЛЭГЧ

`2-1` §9-ийн 8-р асуулт («СЕСС ГЭЖ ЮУ ВЭ?») нь ЭНЭ баримт хариулна гэж бичсэн. Хариулт:

> **НЭГ СЕСС = НЭГ ПРОЦЕССЫН АЖИЛЛАГАА × НЭГ БАРИМТ (`doc_uid`).**

⚠️ **ЯАГААД ПРОЦЕСС ТУТАМ НЭГ БИШ ВЭ:** `bim_sessions` нь `doc_uid`, `doc_title`, `is_link`, `central_path_hash` БАГАНАТАЙ (`0202_bim_sessions.sql:46-100`, `2-1` §2-т бүтнээр жагсаасан). ⚠️ Энэ нь ТААМАГ БИШ: 0202-ийн ӨӨРИЙНХ НЬ тайлбар `session_uid`-ийн дэргэд «**Revit процесс + баримт тутамд НЭГ**» гэж бичсэн (`0202_bim_sessions.sql:49`) — бид тэр гэрээг зөвхөн ХЭРЭГЖҮҮЛЖ байна, шинээр СОНГОЖ байгаа юм биш. Процесс тутам нэг мөр бичвэл тэр дөрвөн багана нь «аль баримтынх вэ?» гэсэн хариултгүй болно, ба нэгэн зэрэг нээлттэй host + линк бүр ижил мөрөнд холилдоно. Тиймээс сесс нь БАРИМТААР хуваагдана.

```
session_uid = sha256( machine_hash + "|" + processStartUtcTicks + "|" + docKey )  → эхний 32 hex
```

- ⚠️ **ДЕТЕРМИНИСТ.** Нэг процессын ажиллагаа дотор ижил баримт ижил `session_uid` авна — тиймээс сүлжээ тасраад дахин илгээхэд `upsertBimSession` нь ШИНЭ мөр биш, ИЖИЛ мөрийг олно.
- ⚠️ **ПРОЦЕСС ДАХИН АСАХАД ШИНЭ.** `processStartUtcTicks` өөрчлөгдөнө ⇒ шинэ сесс, шинэ `started_at`. Энэ нь ЗӨВ: Revit унасны дараах ажил нь өөр сесс.
- ⚠️ **МӨР НЬ ЗАРЛАГДАХАД БИШ, АЖИЛ ГАРАХАД ҮҮСНЭ.** Сессийн бичлэг нь тэр баримтын ЭХНИЙ `RawEntry` шавхагдах агшинд `_pump` дээр үүснэ. Нээгээд хаагдсан баримт нь `bim_sessions`-д мөр ҮҮСГЭХГҮЙ — «хэрэглэгч ажиллаагүй» ба «бид алдсан» хоёрын ялгаа хадгалагдана.
- `session_uid ≤ 64` тэмдэгт (`str(rawSession.session_uid, 64)`, `learning.ts:321`) — 32 hex нь тавтай багтана.

##### (2) БАРИМТЫН БАРИМТУУДЫГ ХААНА АВАХ ВЭ — `DocFacts`, ҮНДСЭН THREAD ДЭЭР

Шавхагч thread нь Revit-д **ХЭЗЭЭ Ч** хүрэхгүй (`BimEmitter`-ийн `⚠️ REVIT-ИЙН ЯМАР Ч ТӨРӨЛ ХЭРЭГЛЭХГҮЙ` гэрээ). Гэтэл сессийн толгойд `doc_title`, `is_link`, `central_path_hash`, `worksharing`, `revit_version` хэрэгтэй. Тэдгээрийг **`AutoBaseline`-д, `DocumentOpened` дээр, Revit-ийн үндсэн thread дээр НЭГ УДАА** уншиж энгийн мөр болгож хадгална:

```csharp
        /// <summary>Баримтын ТОГТМОЛ баримтууд — ЗӨВХӨН мөр ба bool, Revit-ийн
        /// төрөл БАЙХГҮЙ.  `AutoBaseline` (`ChangeTracker.cs:648-650`,
        /// `DocumentOpened`) бөглөнө; `BimEmitter._pump` УНШИНА.
        ///
        /// ⚠️ `DocumentOpened` нь Revit API уншихад ХУУЛЬ ЁСНЫ газар —
        /// `AutoBaseline` тэнд аль хэдийн бүтэн баримтын цуглуулагч
        /// ажиллуулдаг.  `DocumentChanged` дээр ЭНЭ КОД ХЭЗЭЭ Ч ажиллахгүй
        /// (Хориглолт №6: тэнд баримт ЗӨВХӨН УНШИХ, шинэ API дуудлагагүй).
        /// ⚠️ ЗАМ ХАДГАЛАХГҮЙ.  `central_path_hash` нь ЗӨВХӨН sha256
        /// (0202:39 «ЗАМ, МАШИНЫ НЭР ХАДГАЛАХГҮЙ»).</summary>
        internal sealed class DocFacts
        {
            public string DocUid, Title, CentralPathHash, Worksharing;
            public bool   IsLink;
        }
        private static readonly System.Collections.Concurrent.ConcurrentDictionary<string, DocFacts>
            _docFacts = new System.Collections.Concurrent.ConcurrentDictionary<string, DocFacts>();
        internal static DocFacts FactsOf(string key)
        {
            DocFacts f; return _docFacts.TryGetValue(key, out f) ? f : null;
        }
```

Процессын түвшний тогтмолууд (`revit_version`, `revit_build`, `addin_version`, `addin_channel`, `machine_hash`, `client_tz_offset_min`) нь `App.OnStartup`-д `BimEmitter.Start()` дуудагдах агшинд аргументаар дамжина — тэдгээрийг шавхагч дахин тооцохгүй.

##### (3) `RawEntry` → `TXN` БУУЛГАЛТ — талбар тутмаар

| Envelope талбар | Эх сурвалж | Тэмдэглэл |
|---|---|---|
| `txn_uid` | `session_uid + ":" + Seq` | ⚠️ **ДЕТЕРМИНИСТ.** Уналтын дараа дахин илгээхэд ИЖИЛ uid гарч `ON CONFLICT DO NOTHING` барина (`/events/head`-ийн resume гэрээ, `learning.ts:817-820`). `≤ 64` тэмдэгт |
| `seq` | `RawEntry.Seq` | Сесс дотор монотон, `≥ 0` — эс бөгөөс мөр `rejected.txns`-д унана (`learning.ts:508-509`) |
| `occurred_at` | `Sec` → `DateTime.UnixEpoch.AddSeconds(Sec).ToString("O")` | ⚠️ `isoOrNull` нь мөрийг **ХЭВЭЭР** хадгална (`learning.ts:127-132`), нормчлохгүй — тиймээс UTC «Z»-тэй ISO-8601 ЗААВАЛ |
| `op_name` | `RawEntry.OpName` | `≤ 128`. `undo:` / `redo:` угтвар нь `ChangeTracker.cs:753`-аас ҮНЭГҮЙ ирнэ |
| `op_class` | `OpName`-ийн угтвараас | `undo:` → `undo`, `redo:` → `redo`, эс бөгөөс `edit`. ⚠️ Хүлээн зөвшөөрөгдөх багц нь `OP_CLASSES` (`bimEvents.ts:269-281`); танигдаагүй утга нь `'edit'` рүү унана (`oneOf`) |
| `added_count` / `deleted_count` / `modified_count` | `Added` / `Deleted` / `Modified` | ⚠️ ҮНЭН ЗӨВ тоо, түүвэр БИШ (§3.6) |
| `origin` | `'human'` | ⚠️ Релиз N-д ҮРГЭЛЖ `human`: `Suppressed` цонхны гүйлгээ цагирагт ОГТ ОРДОГГҮЙ (`:801`-ийн эрт буцалт) тул `'sync'` үүсэхгүй, ба багцын хост дээр илгээгч бүхэлдээ унтарсан (§3.13) тул `'script'` ч үүсэхгүй. AI-аас үүдсэн гүйлгээ (`'ai'`) нь `cause_event_uid`-тэй хамт ХОЖМЫН релизийн ажил |
| `touches[]` | `_sampleBuf[SampleOff .. SampleOff+SampleLen)` | Хамгийн ихдээ `SamplePerTxn = 24` мөр. Дэлгэрэнгүйг доор |
| `categories`, `view_uid`, `sheet_uid`, `cause_event_uid`, `parent_txn_uid`, `element_artifact_sha256` | **ИЛГЭЭХГҮЙ** | ⚠️ Халуун зам тэднийг МЭДЭХГҮЙ (шинэ Revit API дуудлагагүй). Байхгүй нь `null`, худал утга БИШ |

**`touches[]`-ийн `change`-ийг ЯАЖ мэдэх вэ.** Түүврийн буфер нь `add → delete → modify` гэсэн ЯГ ТЭР дарааллаар дүүрдэг (§3.6-ийн гурван diff), ба гурван тоолуур нь ҮНЭН ЗӨВ. Тиймээс `i` дэх түүврийн ангилал нь тооцоолж ГАРНА:

```
i <  min(Added, SampleLen)                    → "add"
i <  min(Added + Deleted, SampleLen)          → "delete"
эс бөгөөс                                      → "modify"
```

⚠️ **ЭНЭ ДАРААЛАЛ НЬ ГЭРЭЭ.** Гурван давталтын дарааллыг сольвол `change` нь ЧИМЭЭГҮЙ буруу болно — сургалтын мөр «устгасан»-ыг «нэмсэн» гэж хэлнэ. §3.6-ийн diff-ийн дарааллыг ХЭЗЭЭ Ч бүү сольж бич.

⚠️ **`category` НЬ ХООСОН ҮЛДЭНЭ — ЭНЭ НЬ МЭДЭГДСЭН ХЯЗГААР, АЛДАА БИШ.** Халуун зам категори уншихын тулд `doc.GetElement(id).Category` гэж дуудах ёстой байсан — тэр нь `:792-795`-ийн ⛔ гэрээг зөрчинө. Үр дагавар нь ХЭМЖИГДСЭН: `partsForTxn` (`bimEvents.ts:660-698`) нь `elementTotal > 0` үед `ELEMENT_ATTRS`-ыг ХҮЛЭЭНЭ ба `touchesHaveAttrs` худал тул түүнийг ОЛОХГҮЙ ⇒ `parts_missing > 0` ⇒ **мөр `DATASET_ELIGIBLE_SQL` (`bimEvents.ts:144`)-ийг ДАВАХГҮЙ.** Өөрөөр хэлбэл релиз N-ийн гүйлгээний мөрүүд нь **БҮРТГЭЛД бүрэн, СУРГАЛТАД хараахан биш**. Энэ нь ЗӨВ анхдагч: атрибутыг ХОЖИМ, ХҮЙТЭН эгнээгээр (`collect_rule_inputs` нь категорийг аль хэдийн уншдаг) нэмэх нь ХАЛУУН зам дээр Revit дуудлага нэмэхээс хамаагүй хямд. **`category`-г ХУДЛААР бүү бөглө** — `parts_missing` нь яг энэ асуултыг илэрхийлэхийн тулд байдаг.

##### (4) `SESSION_START` / `SESSION_END` — учир нь дэвтэр «хэн, хэзээ» гэдгээ мэдэх ёстой

Хоёулаа `learning_events`-ийн ЖИНХЭНЭ мөр (`LEARNING_EVENT_KINDS`-ийн 15, 16 дахь утга, `bimEvents.ts:176-177`), `REQUIRED_PARTS_OF` нь хоёуланд нь ХООСОН (`:239-240`) — тиймээс дагалдах хэсэг шаардахгүй, `parts_missing = 0` болно:

```jsonc
{ "event_uid": "<session_uid>:s0",     // SESSION_END бол ":s1"
  "stream_id": "<session_uid>",        // 0205: add-in талд stream_id === session_uid
  "seq": 0,                            // ⚠️ ҮЙЛ ЯВДЛЫН ТУСДАА тоолуур
  "kind": "SESSION_START",
  "actor_kind": "system",              // `DEFAULT_ACTOR_OF` ч ижлийг өгнө (`:205-206`)
  "occurred_at": "2026-09-01T02:11:04.120Z",
  "doc_uid": "<docKey>",
  "provenance": "MACHINE_GENERATED",   // ⚠️ клиентэд зөвшөөрөгдсөн ДЭЭД нь (`ingestProvenance`, `learning.ts:757-761`)
  "payload": { "revit_version": "2027", "addin_version": "…", "is_link": false } }
```

⚠️ **ҮЙЛ ЯВДЛЫН `seq` НЬ ГҮЙЛГЭЭНИЙ `seq`-ЭЭС ТУСДАА ТООЛУУР.** `learning_events` нь `(stream_id, seq)`-ээр өвөрмөц, `revit_transactions` нь `(session_id, seq)`-ээр. Нэг тоолуурыг хуваалцвал үйл явдлын дугаарууд нүхтэй болж `/events/head`-ийн `MAX(seq)` resume нь мөр АЛГАСНА.

**ХААНА ГАРАХ ВЭ:**

| Үйл явдал | Хаана | Яагаад ТЭНД |
|---|---|---|
| `SESSION_START` | `_pump`-д, тухайн `docKey`-ийн ЭХНИЙ `RawEntry` шавхагдах агшинд | ⚠️ `App.OnStartup`-д ГАРГАХ БОЛОМЖГҮЙ — тэр агшинд НЭГ Ч баримт нээгдээгүй тул `doc_uid` / `doc_title` / `is_link` (`0202`-ийн багана) БАЙХГҮЙ, ба ажил хийгээгүй хүн бүрд хоосон сесс үүснэ |
| `SESSION_END` | `BimEmitter.Cancel()`-ийн ДОТОР, нээлттэй сесс БҮРД, дохио өгөхийн ӨМНӨ | `Cancel()` нь `App.OnShutdown`-ийн АЛХАМ 0-д, `ComplianceCts.Cancel()`-ийн ЯГ ДАРАА дуудагдана (§3.12.b). ⚠️ **ЭНД ХҮЛЭЭЛТ БАЙХГҮЙ** — зөвхөн дараалалд хийнэ; илгээх эсэхийг `Join(400)` шийднэ, амжаагүй мөр нь JSONL-д үлдэж ДАРААГИЙН асаалтад илгээгдэнэ (курсорын гэрээ) |
| сессийн толгойн `ended_at` | ижил агшинд | `bumpSessionCounters` нь `ended_at`-ыг сесс дээр бичнэ (`learning.ts:728`) |

##### (5) POST-ИЙН БИЕ — `learning.post('/events')` ХҮЛЭЭН АВАХ ЯГ ТЭР ХЭЛБЭР

Дараалалд ОРОХ мөр (`Enqueue`-ийн аргумент, мөн `bim-events.jsonl`-ийн НЭГ МӨР):

```jsonc
{ "n": 1841,                    // локал мөрийн дугаар — КУРСОР үүн дээр ажиллана
  "s": "<session_uid>",         // аль сессийнх (шавхагч баримтаар бүлэглэнэ)
  "t": "txn",                   // "txn" | "event"
  "b": { /* txn талбарууд + "touches": [ ≤24 ] , эсвэл үйл явдлын талбарууд */ } }
```

⚠️ **ГҮЙЛГЭЭ ба ТҮҮНИЙ `touches` НЬ НЭГ МӨРӨНД.** Салгавал тэдгээр нь өөр өөр POST-д унаж болзошгүй бөгөөд эцэггүй `touches` нь СЕРВЕР ДЭЭР ЧИМЭЭГҮЙ ХАЯГДАНА (`learning.ts:612-616` — «Эцэггүй элементийн мөр — 0204-ийн ЧАНГА БҮТЭЛГҮЙТЭЛ»).

Илгээгч thread нь НЭГ сессийн мөрүүдээс биеийг угсарна:

```jsonc
{ "session": { "session_uid": "…", "started_at": "…Z", "client_now": "…Z",
               "doc_uid": "…", "doc_title": "…", "is_link": false,
               "central_path_hash": "<64 hex|null>", "machine_hash": "<64 hex>",
               "worksharing": "central|local|none", "revit_version": "2027",
               "revit_build": "…", "addin_version": "…", "addin_channel": "prod",
               "capture_schema": 1, "client_tz_offset_min": -480,
               "dropped_count": 12, "ended_at": null,
               "perf": { "p95_doc_changed_ms": 1.4, "…": 0 } },
  "transactions": [ … ], "touches": [ … ], "events": [ … ] }
```

⚠️ **`session` НЬ POST БҮРД ЗААВАЛ.** `session_uid` байхгүй бол `sessionId === null` болж **гүйлгээ БҮР `rejected.txns`-д унана** (`learning.ts:508-509`) — багц 200 буцаах ч НЭГ Ч мөр бичигдэхгүй.

⚠️ **КЛИЕНТ ХЭЗЭЭ Ч ИЛГЭЭХГҮЙ талбарууд:** `user_id` (токеноос, `learning.ts:338-340`), `notice_version` (сервер тавина, «хуучин add-in худал тамгалах боломжгүй байх ёстой»), `capture_policy` (серверийн `bim.capture.mode`). Илгээсэн ч ҮЛ ТООМСОРЛОГДОНО — тэднийг бүү бич, тэгвэл дараагийн хүн буруу ойлгохгүй.

⚠️ **БАГЦЫН АРИФМЕТИК — ГУРВАН ХЯЗГААР, ЭХНИЙХЭЭР НЬ ХААНА:**

| Хязгаар | Утга | Эх сурвалж |
|---|---|---|
| `transactions.length` | `≤ emit_batch_max` (0228, анхдагч **100**) ба ХАТУУ `≤ txn_batch_max` (**200**) | `learning.ts:212`, 413 `:307-308` |
| `touches.length` | **`≤ 2000`** | `MAX_TOUCH_BATCH = 2000`, `learning.ts:88`, 413 `:310-311` |
| `events.length` | `≤ txn_batch_max` (**200**) | 413 `:307-308` |
| нэг үйл явдлын `payload` | `≤ 16 KB` | `MAX_PAYLOAD_BYTES`, `learning.ts:90`; хэтэрвэл мөр БҮТНЭЭР татгалзана `:641` |

⚠️ **100 × 24 = 2400 > 2000.** Тиймээс `emit_batch_max`-ыг ганцаараа шалгах нь ХҮРЭЛЦЭХГҮЙ: бүх гүйлгээ дүүрэн түүвэртэй үед багц нь **~83 гүйлгээн дээр** `touches`-ийн хязгаарт хүрнэ. Угсрагч нь **гурван тоолуурыг ЗЭРЭГ** явуулж, аль нэг нь хязгаарт хүрмэгц багцыг хаана. Үүнгүйгээр эхний том наалт нь 413 авч, §3.9-ийн 5-р алхмын «хагаслаад дахин оролдох» зам руу орох ба тэр нь ажиллах ч ЯЛГААГҮЙ ШУУД АЛДАА — 413-ыг ЗӨВХӨН серверийн тохиргоо гэнэт БУУРСАН үед л харах ёстой.

##### (6) `BimEmitter`-ИЙН ХОЁР THREAD ба `Enqueue`-ИЙН ДУУДАХ ЦЭГҮҮД

```csharp
        // ── ХОЁР THREAD, ХОЁР ӨӨР АЖИЛ.  ХОЁУЛАА `IsBackground = true`
        //    (`Percentiles.cs:336/:421`-ийн хэв маяг) тул гацсан ч
        //    процессыг БАРИХГҮЙ. `Start()` хоёуланг нь асаана,
        //    `Cancel()` хоёуланд нь дохио өгнө, `Join(ms)` хоёуланг нь
        //    ХУВААРИЛСАН хугацаагаар хүлээнэ (нийт `ms`, тус бүр биш).
        private static Thread _pump;   // (1) ШАВХАХ + ENVELOPE ҮҮСГЭХ
        private static Thread _post;   // (2) JSONL + HTTP (§3.9-ийн 7 алхам)

        /// <summary>`2-3` бүртгэдэг сонголтот дэгээ.  ⚠️ NULL БАЙЖ БОЛНО —
        /// тэр үед ч цуглуулга ЯВСААР БАЙНА.  R1 (өгөгдөл цуглуулах) нь
        /// compliance-ийн `authority_level`-ээс ч, дүрмийн багцаас ч,
        /// `ComplianceScheduler` шипсэн эсэхээс ч ХАМААРАХГҮЙ.</summary>
        internal static Action<LogicalChangeSet> ComplianceHook;
```

`_pump`-ийн мөчлөг — **ЦАГИРГИЙГ ШАВХАХ ЦОРЫН ГАНЦ КОД**:

```csharp
            while (!_cts.IsCancellationRequested)
            {
                if (BatchQto.IsBatch) return;                       // §3.13 — шөнийн хостод ТЭГ ажил
                ChangeTracker.Wake.Wait(250, _cts.Token);           // хязгаартай унтралт, ТАЙМЕР БИШ

                long from, dropped;
                int n = ChangeTracker.TryDrain(_buf, _ids, out from, out dropped);
                if (dropped > 0) Interlocked.Add(ref _droppedRing, dropped);   // → dropped_count

                long nowMs = Stopwatch.GetTimestamp() / (Stopwatch.Frequency / 1000);
                for (int i = 0; i < n; i++)
                {
                    RawEntry r = _buf[i];
                    // ⚠️ ДУУДАХ ЦЭГ 2 — тухайн баримтын ЭХНИЙ бичлэг дээр л
                    //    `SESSION_START` гарна (дотроо нэг удаа шалгана).
                    Session ses = SessionOf(r.DocKey, r.Sec);
                    // ⚠️ ДУУДАХ ЦЭГ 1 — гүйлгээ тутам НЭГ envelope.
                    Enqueue(TxnEnvelope(ses, r, _ids));
                    _coalescer.Feed(r.Seq, nowMs, r.DocKey, _ids, r.SampleLen, r.Undo);
                }

                LogicalChangeSet set = _coalescer.TryClose(nowMs, quiet: n == 0);
                if (set != null && set.MayCollect)
                {
                    Action<LogicalChangeSet> hook = ComplianceHook;   // ⚠️ нэг уншилт
                    if (hook != null) { try { hook(set); } catch { } }
                }
            }
```

⚠️ **JSON НЬ ЗӨВХӨН ЭНД ҮҮСНЭ.** Халуун зам дээр `JsonSerializer`, `string.Format`, `+` ХЭЗЭЭ Ч байхгүй — `RawEntry` нь тоо ба хоёр ишийн хуулбар. Envelope нь `_pump` дээр, Revit-ийн үндсэн thread-ээс ГАДНА угсрагдана.

⚠️ **`_pump` НЬ `ChangeTracker.Gate`-ЫГ ЗӨВХӨН `TryDrain`-ИЙН ДОТОР, `Wait(0)`-ЭЭР ХӨНДӨНӨ** (Хориглолт №7). Envelope үүсгэх, дараалалд хийх, коалесцер тэжээх — БҮГД түгжээнээс ГАДНА.

**ДУУДАХ ЦЭГҮҮДИЙН БҮРЭН ЖАГСААЛТ:**

| # | Хаана | Юу дараалалд орох | Эзэн |
|---|---|---|---|
| 1 | `_pump`, шавхсан `RawEntry` тутам | `t:"txn"` — гүйлгээ + түүний `≤24 touches` | **2-4 (энэ баримт)** |
| 2 | `_pump`, `SessionOf(docKey)` шинэ сесс үүсгэх агшинд | `t:"event"`, `kind:"SESSION_START"` | **2-4 (энэ баримт)** |
| 3 | `BimEmitter.Cancel()`, нээлттэй сесс бүрд | `t:"event"`, `kind:"SESSION_END"` | **2-4 (энэ баримт)** |
| 4 | `ComplianceScheduler` — олдворын төлөв ӨӨРЧЛӨГДӨХӨД | `t:"event"`, `kind:"RULE_VALIDATION"` (`payload` дотор `rule_id` + `passed`) | **`2-3`** — энэ баримт ЗӨВХӨН дарааллыг өгнө |

⚠️ **ӨӨР ДУУДАГЧ БАЙХГҮЙ.** `grep -n "BimEmitter.Enqueue" revit-mcp/addin/*.cs` нь релизийн дараа ЯГ ЭДГЭЭР **4** цэгийг л буцаах ёстой (§6-ийн шалгуур). Тав дахь дуудагч гарах нь дэвтэрт ЭЗЭНГҮЙ мөр орж ирснийг хэлнэ.

##### (7) ЭНЭ ГЭРЭЭ НЬ ЮУГ БАТЛАХ БОЛОМЖТОЙ БОЛГОВ

`2-0` §6-ийн релиз N-ийн шалгуур («`learning_events` дээр `kind='SESSION_START'`, `'TXN'` төрлийн бодит мөр бий — дэвтэр хоосон байхаа больсон (R1)») нь одоо ГҮЙЦЭТГЭГДЭХ боллоо. ⚠️ Нэг залруулга: **`TXN` нь `learning_events`-ийн ТӨРӨЛ БИШ** — `LEARNING_EVENT_KINDS` (`bimEvents.ts:159-178`) -д тийм утга БАЙХГҮЙ. Гүйлгээ нь `revit_transactions` хүснэгтэд очно. Тиймээс шалгуурын ЗӨВ хэлбэр нь: `learning_events`-д `SESSION_START` мөр **ба** `revit_transactions`-д мөр (§6, §7-ийн SQL).

### 3.10 `AiHttp.cs` (ШИНЭ) — §32-ын тээвэр

```csharp
    /// <summary>
    /// AI / compliance-ийн ТУСДАА HTTP тээвэр (v2 §32).
    ///
    /// ⚠️ `ApiClient.Http`-ЫГ ДАХИН АШИГЛАХГҮЙ.  Тэр нь 180 секундын
    /// хугацаатай (`ApiClient.cs:56`) ба 20 000 мөрийн QTO push-д
    /// тохируулагдсан.  v2 §32 нь «Do not reuse an unrelated 180-second
    /// HTTP timeout for AI inference» гэж ШУУД хориглосон.
    ///
    /// ⚠️ USER-AGENT-ИЙН УГТВАР `MglRevitAddin/` ЗААВАЛ ХЭВЭЭР.
    /// UA-гүй хүсэлтийг Cloudflare-ийн Browser Integrity Check нь Worker-т
    /// хүрэхээс ӨМНӨ **403 (error code 1010)**-аар хаадаг — 2026-08-25-нд
    /// ХЭМЖИЖ баталсан (`ApiClient.cs:58-84`).  Энэ бол ~20 компьютер дээр
    /// АЛСААС сэргээх БОЛОМЖГҮЙ цорын ганц алдаа.
    /// ⚠️ ТАРААХААС ӨМНӨ НЭГ МАШИН ДЭЭР ТУРШ: 401 (403 БИШ).
    /// </summary>
    internal static class AiHttp
    {
        internal const int TimeoutSeconds = 20;
        internal const int MaxRetries     = 2;     // §32 «bounded retry»
        private  const int MaxConcurrency = 2;     // §32 «bounded concurrency»

        private static readonly SemaphoreSlim Concurrency =
            new SemaphoreSlim(MaxConcurrency, MaxConcurrency);

        internal static readonly HttpClient Http = Create();

        private static HttpClient Create()
        {
            var c = new HttpClient { Timeout = TimeSpan.FromSeconds(TimeoutSeconds) };
            c.DefaultRequestHeaders.UserAgent.ParseAdd("MglRevitAddin/" + BuildInfo.Version);
            c.DefaultRequestHeaders.Accept.ParseAdd("application/json");
            return c;
        }

        /// <summary>⚠️ `ct` нь ЗААВАЛ.  §32: CancellationToken, per-operation
        /// timeout, bounded retry, bounded concurrency, failure state,
        /// observable status.  Хугацаа нь `Metrics.EmitPost`-д бичигдэнэ.</summary>
        public static async Task<HttpResponseMessage> SendAsync(
            Func<HttpRequestMessage> makeRequest, CancellationToken ct);

        /// <summary>Ажиглагдах төлөв (§32 «observable status»).</summary>
        public static DegradeState State { get; }
        public static int ConsecutiveFailures { get; }
    }
```

⚠️ `ApiClient.cs`-д ЗӨВХӨН НЭГ тайлбар нэмнэ (код ӨӨРЧЛӨХГҮЙ):

```diff
     internal static readonly HttpClient Http = CreateClient();
+    // ⚠️ ЭНЭ КЛИЕНТ НЬ 180 СЕКУНДТЭЙ, QTO-д ЗОРИУЛАГДСАН.
+    //    Compliance / AI-ийн дуудлага `AiHttp.Http`-ыг (20 с, cancellation,
+    //    bounded concurrency) хэрэглэнэ — v2 §32.  Энд БҮҮ нэм.
```

### 3.11 `Percentiles.cs` — таван шинэ хуримтлуулагч + `Snapshot()`

Одоо байгаа 11-ийн ХАЖУУД (`:127-147`), ижил хэв маягаар:

```csharp
        /// <summary>Нэгтгэгчийн хаалт (BACKGROUND).</summary>
        public static readonly Percentiles Coalesce = new Percentiles(128);
        /// <summary>Нэг олонлогийн дүрмийн гүйцэтгэлт (BACKGROUND).  2-3 бичнэ.</summary>
        public static readonly Percentiles RuleEval = new Percentiles(128);
        /// <summary>`collect_rule_inputs` (COLD).  2-3 бичнэ.</summary>
        public static readonly Percentiles InputCollect = new Percentiles(128);
        /// <summary>Багц POST (REMOTE).</summary>
        public static readonly Percentiles EmitPost = new Percentiles(128);
        /// <summary>Илгээгчийн дарааллын хүлээлт (REMOTE).</summary>
        public static readonly Percentiles EmitQueue = new Percentiles(128);
```

```csharp
        /// <summary>
        /// Сесс рүү илгээх ХУРААНГУЙ (0226-ийн `perf_json`).
        ///
        /// ⚠️ БҮХ талбар NULL бол ЯГ NULL буцаана, `{}` БИШ — 0216:29-40-ийн
        /// «ХЭМЖЭЭГҮЙ» ба «тэр үе шат болоогүй» ялгаа.
        /// ⚠️ Загварын геометр, элементийн нэр, файлын агуулга ОРОХГҮЙ.
        /// ⚠️ `doc_changed_sampled: true` ЗААВАЛ орно — 1/64 түүвэр
        /// (`ChangeTracker.cs:369`) тул ХОВОР ОРГИЛ энд ХАРАГДАХГҮЙ.
        /// </summary>
        public static string Snapshot();
```

### 3.12 `App.cs` + `RevitToolBus.cs` — ҮЛ БЛОКЛОХ COLD ОРОЛТ ба унтраалтын дараалал

#### 3.12.a `RevitToolBus.cs` — `TryCall` · `UserBusy` · `CancelAll` (ГУРВУУЛАА ШИНЭ)

⚠️ **ЭДГЭЭР ГУРВЫГ ЭНЭ СЕСС БИЧНЭ.** `grep -rn "TryCall\|UserBusy\|CancelAll" revit-mcp/addin/*.cs` нь өнөөдөр **ТЭГ мөр** буцаана (2026-08-30). Гэтэл `2-3-compliance-engine` нь тэднийг ХЭРЭГЛЭНЭ (§3.5-ийн планировщик, §7-ийн `grep -n "TryCall"` хүлээн авах шалгуур) ба `App.OnShutdown`-ийн АЛХАМ 1 нь `CancelAll()`-гүйгээр ажиллахгүй. `revit-mcp/addin/RevitToolBus.cs` нь **ЭНЭ баримтын «Хөндөх файлууд» мөрөнд НЭМЭГДСЭН** — түүнгүйгээр хоёр долгион ЗОГСОНО, эсвэл агент өөрийн хамрах хүрээг ЧИМЭЭГҮЙ зөрчинө, тэгэхдээ ЯГ ТЭР файл дээр (`:442-454`-ийн ⛔ гэрээ нь Revit-ийн мессежийн давталтыг амьд байлгадаг).

⚠️ **Одоо байгаа `Call` / `CallCore` / `Execute` / `MaxPerSlice = 4` / `RaiseAgain` замыг ХӨНДӨХГҮЙ.** Гурвуулаа НЭМЭЛТ гадаргуу.

```csharp
        /// <summary>
        /// ⚠️ ХЭРЭГЛЭГЧ АЖИЛЛАЖ БАЙНА гэсэн туг.  `AssistantPane.SetBusy`
        /// (`AssistantPane.xaml.cs:341-352`) тавьж/буулгана.  Планировщик
        /// үүнийг үнэн үед мөчлөгөө АЛГАСНА.
        ///
        /// ⚠️ Compliance нь `SetBusy`-г ХЭЗЭЭ Ч ДУУДАХГҮЙ — тэр нь
        /// `Mouse.OverrideCursor`-ыг АПП ДАЯАР тавьдаг (`:351`).  Энэ туг нь
        /// ЗӨВХӨН УНШИГДАНА.
        /// </summary>
        public static volatile bool UserBusy;

        /// <summary>
        /// ҮЛ БЛОКЛОХ дуудлага.  Өрсөлдөөн байвал ДАРААЛАЛД ОРУУЛАХГҮЙ,
        /// ХҮЛЭЭХГҮЙ — `Skipped = true` гэж ШУУД буцна.
        ///
        /// ⚠️ ЯАГААД ЭНЭ ХЭРЭГТЭЙ ВЭ: `Gate` нь ЧАТ, QTO ба compliance-тэй
        /// ХУВААЛЦСАН ГЛОБАЛ семафор (`:135`), ба `CallCore` нь deadline-ыг
        /// `Gate.Wait`-ЭЭС ӨМНӨ эхлүүлдэг (`:264` → `:266`).  Модаль цонх
        /// нээлттэй үед `ExternalEvent` гүйцэтгэгддэггүй (`:313`).  Тиймээс
        /// арын мөчлөг энгийн `Call`-ыг хэрэглэвэл `Gate`-ыг өөрийн БҮТЭН
        /// хугацаагаар барьж, хэрэглэгчийн ДАРААГИЙН «Зураг холбох» дуудлага
        /// `:272`-ийн «Хугацаа дууслаа (30s) — өмнөх үйлдэл дуусаагүй байна»
        /// гэсэн мессежийг авна.  ХЭН Ч ХҮСЭЭГҮЙ ФУНКЦ НЬ ХЭРЭГЛЭДЭГ ФУНКЦИЙГ
        /// ЭВДЭХ ЁСГҮЙ (R7).
        ///
        /// ⚠️ АЛГАСАЛТ нь ХЭВИЙН тохиолдол, АЛДАА БИШ.  Дуудагч дараагийн
        /// мөчлөгт дахин оролдоно; COLD эгнээ нь BEST-EFFORT.
        /// ⚠️ Revit-ийн ҮНДСЭН thread-ЭЭС ДУУДАХГҮЙ (`:200-203`-ийн дүрэм
        /// `TryCall`-д ч хамаарна).
        /// </summary>
        public static ToolCall TryCall(string tool, string argsJson, int timeoutSeconds)
        {
            var call = new ToolCall { Tool = tool, ArgsJson = argsJson };
            if (_event == null || _cancelled || UserBusy) { call.Skipped = true; return call; }

            // ⚠️ `Wait(0)` — ХҮЛЭЭЛТГҮЙ.  `Call`-ийн `Wait(timeout*1000)`-ыг
            //    ЭНД ХЭЗЭЭ Ч хэрэглэхгүй.
            if (!Gate.Wait(0)) { call.Skipped = true; return call; }
            try { /* … `CallCore`-ийн `Gate`-ийн ДАРААХ бие ҮГ ҮСГЭЭР ИЖИЛ … */ }
            finally { Gate.Release(); }
            return call;
        }

        /// <summary>
        /// Унтраалтын АЛХАМ 1.  Дараалалд байгаа БҮХ дуудлагыг `Abandoned`
        /// болгож `Done`-ыг тавина, шинэ дуудлагыг хүлээж авахаа болино.
        ///
        /// ⚠️ `ExternalEvent`-ыг DISPOSE ХИЙХГҮЙ — тэр нь `Shutdown()`-ийн
        /// ажил ба `App.cs:167-183` нь яагаад ХАМГИЙН СҮҮЛД байхыг
        /// тайлбарласан.  `CancelAll` бол тэр дарааллыг ӨӨРЧЛӨХГҮЙГЭЭР
        /// хүлээгчдийг сулладаг ХАМГИЙН БАГА примитив.
        /// ⚠️ ХЭЗЭЭ Ч алдаа шидэхгүй (`:164-165`-ийн дүрэм).
        /// </summary>
        public static void CancelAll()
        {
            _cancelled = true;
            ToolCall pending;
            while (Queue.TryDequeue(out pending))
            {
                try { pending.Abandoned = true; pending.Success = false;
                      pending.Error = "Revit хаагдаж байна."; pending.Done.Set(); }
                catch { }
            }
        }
```

`ToolCall`-д НЭГ талбар нэмнэ (`:32`-ийн `Abandoned`-ийн хажууд):

```csharp
        /// <summary>Өрсөлдөөнөөс болж ОГТ ДУУДАГДААГҮЙ.  ⚠️ `TimedOut`-ТОЙ
        /// ХОЛИХГҮЙ: хугацаа дуусах нь АСУУДАЛ, алгасалт нь ХЭВИЙН.</summary>
        public bool Skipped;
```

⚠️ **`[Conditional("DEBUG")]` assert** — `Call` ба `TryCall` ХОЁУЛАНГИЙН оролтод `ChangeTracker.Gate` барьсан эсэхийг шалгана (Хориглолт №7). Барьсан хэвээр bus руу орох нь Revit-ийн үндсэн thread-ийг хэрэгслийн бүтэн хугацаагаар гацаана.

#### 3.12.b `App.cs` — унтраалтын дараалал: ЭХЛЭЭД ДОХИО, ДАРАА НЬ ХҮЛЭЭЛТ

⚠️ `ChangeTracker.Shutdown` нь ХАМГИЙН ЭХЭНД (`App.cs:165`) ба Revit-ийн үндсэн thread дээр `FlushDirty()`-г синхроноор дуудна; `RevitToolBus.Shutdown()` — `Call`-д зогссон thread-ийг сулладаг ЦОРЫН ГАНЦ зүйл — ХАМГИЙН СҮҮЛД (`:194`). Тэр хоёрын хооронд `Join` тавих нь Revit-ийн хаагдалтыг bus-ийн бүтэн хугацаагаар гацаана.

```csharp
        public Result OnShutdown(UIControlledApplication application)
        {
            // ⚠️ АЛХАМ 0 — ЗӨВХӨН ДОХИО.  ХҮЛЭЭХГҮЙ.
            try { ComplianceCts.Cancel(); } catch { }
            // ⚠️ `BimEmitter.Cancel()` нь ДОХИО ӨГӨХИЙН ӨМНӨ нээлттэй сесс
            //    бүрд `SESSION_END` дараалалд хийнэ (§3.9.a-ийн 4-р хэсэг).
            //    Тэр нь ДАРААЛАЛД ХИЙХ л үйлдэл — ХҮЛЭЭЛТГҮЙ; амжаагүй мөр
            //    JSONL-д үлдэж ДАРААГИЙН асаалтад илгээгдэнэ (курсор).
            try { BimEmitter.Cancel(); } catch { }

            // ⚠️ АЛХАМ 1 — ШИНЭ ПРИМИТИВ.  Дараалалд байгаа дуудлага бүрийг
            //    `Abandoned = true` болгож `Done.Set()` хийнэ, шинийг
            //    хүлээж авахаа болино.  `ExternalEvent`-ыг DISPOSE ХИЙХГҮЙ —
            //    тэр нь `RevitToolBus.Shutdown()`-ийн ажил ба `:167-183`-д
            //    яагаад СҮҮЛД байх ёстойг тайлбарласан.
            try { RevitToolBus.CancelAll(); } catch { }

            // ⚠️ АЛХАМ 2 — БАЙРЛАЛ ӨӨРЧЛӨГДӨӨГҮЙ.  Одоо түүний `FlushDirty`
            //    нь `Gate`-ыг чөлөөтэй авна: планировщик хаана ч зогсоогүй.
            try { ChangeTracker.Shutdown(application?.ControlledApplication); } catch { }

            // ⚠️ АЛХАМ 3-4 — ХЯЗГААРТАЙ.  Хоёр thread нь `IsBackground = true`
            //    тул гацсан ч процессыг БАРИХГҮЙ.
            try { ComplianceScheduler.Join(400); } catch { }   // 2-3 эзэмшинэ
            try { BimEmitter.Join(400); } catch { }

            // ⚠️ ДООРХ ДӨРӨВ НЬ ЯГ ХЭВЭЭР — `:167-183`-ийн дараалал.
            try { Metrics.EmitSummary(force: true); } catch { }
            try { Metrics.Shutdown(); } catch { }
            try { AssistantLog.Shutdown(); } catch { }
            try { RevitToolBus.Shutdown(); } catch { }
            …
        }
```

`OnStartup`-д, `Metrics.Start()` (`:47`)-ийн ДАРАА, `ChangeTracker.Init` (`:70`)-ийн ӨМНӨ:

```csharp
            // ⚠️ ТУСДАА try — эндээс шидэгдсэн алдаа add-in-ыг унагаах ЁСГҮЙ.
            try { BimEmitter.Start(); } catch { }
```

### 3.13 `BatchQto.cs` — `IsBatch` ба `DrainBlocking`

`App.OnStartup` нь `ChangeTracker.Init` (`:70`) БА `BatchQto.Hook` (`:144`)-ыг НЭГ процесст бүртгэдэг; `AutoBaseline` нь `DocumentOpened` бүрд асна (`ChangeTracker.cs:650`) — detached багц нээлт ч үүнд орно (`BatchQto.cs:181`). Хэрэв compliance-ийн зам шөнийн хостод ажиллавал 50 файлын хэдэн мянган илрүүлэлт нь `SettingsStore`-т байгаа токены эзэнд хамаарч, нэг инженерийн badge өөрийн нь ОГТ нээгээгүй 50 төслийн мөрийг харуулна — §76-ын мөхлийг эхний өдөр нь.

```csharp
        /// <summary>
        /// БАГЦЫН ГОРИМ асав уу.  `Hook` дотор тавигдана.
        ///
        /// ⚠️ `ComplianceScheduler` ба `BimEmitter` хоёул үүн дээр ШУУД
        /// буцна.  Багцын хост нь хараа хяналтгүй, detached, олон төслийн
        /// файлыг нэг ажилтны токеноор нээдэг — тэнд илрүүлэлт үүсгэх нь
        /// ХАРЬЯАЛЛЫН хувьд буруу.  Энэ бол `BatchQto` линкийн задаргаанд
        /// аль хэдийн хэрэглэдэг ЯГ ИЖИЛ зорилтот хасалт.
        /// </summary>
        internal static bool IsBatch { get; private set; }
```

```diff
         public static void Hook(UIControlledApplication application)
         {
             if (!File.Exists(QueuePath))
                 return;
+            IsBatch = true;
             application.ControlledApplication.ApplicationInitialized += OnApplicationInitialized;
         }
```

`Process.Kill()`-ийн ӨМНӨ (`BatchQto.cs:102`):

```diff
                 // Batch session — ажил дууссан тул Revit-ийг бүхэлд нь унтраана.
                 if (exitWhenDone)
+                {
+                    // ⚠️ УРЬДЧИЛСАН НӨХЦӨЛ ИРЭЭДҮЙД: хэрэв хэзээ нэгэн цагт
+                    //    багцын горимд §52-ын сканнер СОНГОЛТООР асаавал
+                    //    `Kill()`-ийн өмнө дарааллыг ЗААВАЛ шавхана.  Өнөөдөр
+                    //    `IsBatch` нь илгээгчийг унтраасан тул шавхах юм байхгүй,
+                    //    гэвч дуудлага нь ХЭВЭЭР байх ёстой: ирээдүйн хүн
+                    //    `IsBatch`-ийг арилгавал энэ мөр өгөгдлийг аварна.
+                    try { BimEmitter.DrainBlocking(5000); } catch { }
                     Process.GetCurrentProcess().Kill();
+                }
```

### 3.14 БҮРЭН МӨЧЛӨГ ба ЛАТЕНТЫН ТӨСӨВ

```
Revit гүйлгээ
   │
   ▼  [HOT] ChangeTracker.OnDocumentChanged — Revit-ийн ҮНДСЭН thread
   │   · `OpNameOf(e)` — Revit API-ийн ЦОРЫН ГАНЦ дуудлага (:792), ӨӨРЧЛӨГДӨӨГҮЙ
   │   · lock (Gate) (:798) → Suppressed эрт гарц (:801) → олонлогийн алгебр (:823-889)
   │   · гурван давталтад тоолуур + <=24 id түүвэр (ШИНЭ, §3.6-ийн diff)
   │   · AppendRaw(...) — НЭГ бичлэг, ИЖИЛ түгжээ дотор, хуваарилалтгүй, шинэ API дуудлагагүй
   │   · Dirty.Add(key) (:891) → _wake.Set()
   ▼
   │  [BACKGROUND] ComplianceScheduler — ӨӨРИЙН IsBackground thread, ШИНЭ Timer БАЙХГҮЙ
   │   · _wake эсвэл 250 мс-ийн хязгаартай хүлээлт дээр сэрнэ
   │   · ChangeTracker.TryDrain(...) — ХЯЗГААРТАЙ struct хуулбар, Gate.Wait(0),
   │     өрсөлдөөн бол 0 буцна.  TryGetByKey ХЭЗЭЭ Ч БИШ
   ▼
   │  ChangeSetCoalescer.TryClose(nowMs, quiet)
   │   settle 1200 мс / defer 15000 мс / <= 2000 элемент
   │   ⚠️ defer-ээр хаагдсан олонлог: MayCollect = false ⇒ ЦУГЛУУЛАЛТГҮЙ
   ▼
   │  LogicalChangeSet { DocKey, ElementIds, FirstSeq..LastSeq, CloseReason, UndoBurst }
   ▼
   │  ЗОГСОХ ХААЛГА (энэ дөрвийн аль нэг нь үнэн бол ЭНЭ мөчлөгийг АЛГАСНА):
   │     BatchQto.IsBatch  |  RevitToolBus.UserBusy  |  Gate.Wait(0) амжилтгүй  |  MayCollect == false
   │     ⚠️ АЛГАСАХ нь ХЭВИЙН тохиолдол, алдаа БИШ.
   ▼
   │  [COLD] RevitToolBus.TryCall("collect_rule_inputs", <=150 элемент,
   │         дотоод 1500 мс төсөв, { more: true, cursor })  — MaxPerSlice = 4-ийн НЭГ зүсэлт
   ▼
   │  [BACKGROUND] RuleEngine.Evaluate — ЦЭВЭР, Autodesk.Revit-ийн ямар ч төрөлгүй   (2-3)
   ▼
   │  FindingFeed: dedup → snooze → ack → үндэс-нэгтгэл → төсөв                       (2-5)
   ▼
   │  [COLD] set_compliance_badge — ribbon товчны CAPTION.  Dispatcher.Invoke БАЙХГҮЙ,
   │         DockablePane.Show() БАЙХГҮЙ.
   ▼
   │  Самбарын жагсаалт — ШААРДЛАГААР (PULL).
   ▼
      [REMOTE] BimEmitter — ӨӨРИЙН IsBackground thread, BlockingCollection(4096),
               Interlocked алдагдлын тоолуур, backoff, таслуур
               → POST /api/learning/events (AiHttp, 20 с)
```

**ЛАТЕНТЫН ТӨСӨВ.** ⚠️ **МӨР БҮР НЬ PROVISIONAL. ХЭМЖИГДСЭН МӨРИЙН ТОО = ТЭГ.** v2 §30 нь нэгдсэн «250 мс»-ийг ШУУД хориглосон (:994-996) ба эхлээд хэмжихийг шаардсан. Төсөв нь **FINAL SLO** болох нөхцөл: **≥10 өөр `machine_hash`-аас 30 хоногийн өгөгдөл**.

| Үе шат | Хуримтлуулагч | Зам | p95 төсөв | Хязгаарлалтын механизм |
|---|---|---|---|---|
| `OnDocumentChanged`-ийн бие | `DocChanged` (1/64 түүвэр, `Percentiles.cs:141`) | HOT | 2 мс | — (алгебр + нэг цагирган бичлэг) |
| `FlushDirty`-ийн түгжээ барих | `FlushLock` (түүвэрлэгдээгүй, `:143`) | HOT/BG | 15 мс | — (хуулбар түгжээнд, диск гадна) |
| Нэгтгэгчийн хаалт | `Coalesce` (ШИНЭ) | BG | 20 мс | цэвэр тооцоо |
| Нэг олонлогийн дүрмийн гүйцэтгэлт | `RuleEval` (ШИНЭ, 2-3 бичнэ) | BG | 250 мс | 2000 мс → таслана, `coverage='partial'` |
| `collect_rule_inputs` | `InputCollect` (ШИНЭ, 2-3 бичнэ) | COLD | 400 мс | **дотоод 1500 мс `Stopwatch` төсөв, ≤150 элемент, `more:true` курсор** |
| Хэрэгслийн дарааллын хүлээлт | `ToolQueue` (`:135`) | COLD | — | `Gate.Wait(0)` — өрсөлдөөн ⇒ АЛГАСНА, ХҮЛЭЭХГҮЙ |
| Багц POST | `EmitPost` (ШИНЭ) | REMOTE | 1500 мс | 20 с (`AiHttp`), дараа нь backoff + таслуур |
| Илгээгчийн дарааллын хүлээлт | `EmitQueue` (ШИНЭ) | REMOTE | — | `BlockingCollection(4096)`, дүүрвэл `_dropped++` |

⚠️ **«ГАДНЫ ХАТУУ ТАГ» ГЭСЭН БАГАНА БАЙХГҮЙ, ЗОРИУД.** `call.Abandoned` нь зөвхөн дараалалаас гаргах үед шалгагддаг (`RevitToolBus.cs:474`); `RevitTools.Run` эхэлмэгц цуцлалт байхгүй. Дуудагчийн хугацаа нь ДУУДАГЧИЙГ хамгаална, Revit-ийг БИШ. Тиймээс COLD-ийн цорын ганц бодит хамгаалалт нь ХЭРЭГСЛИЙН ДОТООД төсөв — `change_digest` (4 с, `ChangeReport.cs:82`) ба `goto_element` (2.5 с, `:70`)-ийн батлагдсан хэв маяг.

⚠️ **1/64 түүвэр нь ХОВОР ОРГИЛЫГ НУУНА.** `ChangeTracker.cs:369`. §82-ын «bounded AI resource usage»-ийг ЗӨВХӨН `DocChanged`-ээс НОТЛОХ БОЛОМЖГҮЙ. Хамгийн муу тохиолдлын баталгаа хэрэгтэй бол түүврийн давтамжийг өөрчлөх, эсвэл хямд `max`-тракер нэмэх ёстой — §9-ийн асуулт.

### 3.15 §75 — ДОРОЙТЛЫН ТАВАН ШАТ

| Төлөв | Гарааны нөхцөл | Юу ажилласаар байна | Юу зогсоно |
|---|---|---|---|
| `Normal` | бүх зүйл хариулж байна | бүгд | — |
| `Degraded.Ai` | AI хариулахгүй | детерминист дүрэм, цуглуулалт, дараалал | AI тайлбар |
| `Degraded.Server` | 5xx / хугацаа дуусав | детерминист дүрэм, ЛОКАЛ дараалал | илгээлт (backoff + таслуур) |
| `Degraded.Offline` | сүлжээ байхгүй | детерминист дүрэм, ЛОКАЛ дараалал | илгээлт, багц татах |
| `Off` | `bim.compliance.mode = 'off'` эсвэл `{ingest:'off'}` | Revit БҮРЭН хэвийн | БҮГД |

Дүрмийн багцын **гурван шатлалт нөөц** нь `IntentModel.LoadUnderLock` (`IntentModel.cs:236-281`)-ийг ҮГ ҮСГЭЭР хуулна: татсан локал файл → шигтгэсэн нөөц → байхгүй. Багц татахад **404-ийг ТЭВЧИНЭ** — локал хуулбар ХЭВЭЭР үлдэнэ (`revit.ts:2044-2048`-ийн батлагдсан зан төлөв: `activate:false` нь 404 өгдөг ба add-in түүнийг тэвчдэг). Гэрээ таарахгүй бол ТАТГАЛЗАНА (`IntentModel.cs:308-310`), нөхөж таамаглахгүй.

**Хоёр унтраах товч:** `bim.events.logging` (0208:40 — сервер `{accepted:null, ingest:'off'}` буцаана, `learning.ts:304`, тиймээс add-in дахин оролдохоо БОЛИНО) ба шинэ `bim.compliance.mode = 'off'`. Хоёулаа deploy-гүй.

**Алдагдал бүр `bim_sessions.dropped_count`-д хүрнэ** (0202:99) — «юу ч болоогүй» ба «алдсан» хоёрыг ялгах цорын ганц зам.

### 3.16 §76 — МЭДЭГДЛИЙН ЯДАРГААНЫ МАШИН

| §76-ын хяналт | Хэрэгжүүлэлт | Хаана |
|---|---|---|
| severity threshold | `bim.compliance.min_severity` (анхдагч `HIGH`) | 0228 + `FindingFeed` |
| duplicate suppression | `dedup_key = sha256(rule_uid \|\| '\0' \|\| element_uid)[:16]`, `UNIQUE(user_id, dedup_key)` | 0227 |
| repeated-warning suppression | `shown_count` + `MinGap` 90 мин (`Nudges.cs:36`) | 0227 + `Nudges` |
| acknowledgement | `state = 'acknowledged'` — §57-ын ACKNOWLEDGED-тэй ИЖИЛ механизм | 0227 |
| snooze | `snooze_until`, `bim.compliance.snooze_hours` (24) | 0227 + 0228 |
| grouping | `root_dedup_key` — «1 primary / 9 consequences» | 0227 (ирмэг нь 2-3-аас) |
| finding deduplication | `ruleset_version` нь ТҮЛХҮҮРТ БИШ, ХАЖУУД | 0227 |

**ГАДАРГУУ — PULL нь ЗААВАЛ, PUSH нь НӨХЦӨЛТ.**

- **PULL (энэ релизэд ЗААВАЛ):** тоо нь **ribbon товчны caption ба tooltip** дээр гарна, тиймээс самбар ХААЛТТАЙ байхад ч харагдана. `App.cs:376-478` нь `AddItem`-ийн буцах утгыг БҮГДИЙГ хаяж байна — **энэ сесс нэг `PushButton`-ыг барьж статикт хадгална** (`App.cs` нь энэ баримтын харьяа). Caption-ыг `set_compliance_badge` гэсэн өчүүхэн COLD хэрэгсэл бичнэ (хоёр мөр утга оноолт), `TryCall`-аар дамжина. **`Dispatcher.Invoke` БАЙХГҮЙ, `Idling` БАЙХГҮЙ, `DockablePane.Show()` БАЙХГҮЙ.**
  ⚠️ **ХЭРЭГСЛИЙН БҮРТГЭЛ НЬ ЭНЭ СЕССИЙНХ БИШ — `2-3`-ЫНХ.** Revit-ийн хэрэгсэл бүртгэх нь `RevitTools.cs` (`ToolNames` + `:78-89`-ийн `switch`) ба `RevitApi.cs` (`TimeoutFor`) ХОЁРЫГ хөндөнө; тэр хоёр нь `2-3-compliance-engine`-ийн «Хөндөх файлууд»-д байгаа, ЭНЭ баримтынхад БАЙХГҮЙ («ӨӨР ФАЙЛ БАЙХГҮЙ»). `2-3` нь `collect_rule_inputs`-ыг ЯГ тэр гурван алхмаар бүртгэдэг тул `set_compliance_badge` нь тэр хүснэгтийн ДӨРӨВ ДЭХ мөр болно. **Хуваарилалт:** `2-3` = хэрэгслийн бүртгэл + `TimeoutFor` · **`2-4` = `App.cs`-ийн `PushButton` статик + `TryCall`-ийн дуудах цэг** · `2-5` = `FindingFeed.BadgeCaption` (мөрийн АГУУЛГА). ⚠️ `2-8`-ын §7 (:1167) нь энэ ажлыг `2-5`-д оноосон, `2-3` (:810) ба `2-5` (:1604) нь `2-4`-т оноосон — ГУРВУУЛАА ЗӨРЧИЛДӨЖ БАЙНА. Хэрэгжүүлэгч `2-3`-ын хуваарилалтыг баримтална (эзэмшигч файл нь тэнд байна); нөгөө гурван мөрийг ЗАСНА.
- **PUSH (ЗӨВХӨН нөхцөл хангагдвал):** хамгийн ихдээ **`CRITICAL`** түвшний нэг мөр, `Nudges`-ийн ХОЁР слотын **НЭГ**-ийг л эзэлнэ. ⚠️ **`MaxPerDay`-г ӨСГӨХГҮЙ** — `Nudges.cs:23-24` өөрөө «8 удаа гарвал хүн add-in-ыг унтраана» гэж бичсэн, тэр нь R7 үг үсгээрээ.
  **УРЬДЧИЛСАН НӨХЦӨЛ (заавал, тайлбар нь §2.11):** `Nudges.Ctx` нь `Busy`, `AwaitingAnswer`, `Suppressed`, `WebConnected`, `SecondsSinceTyping` шаарддаг — бүгд WPF самбарын төлөв. Хориглолт №9-ийн дагуу түгжээ барьж болох thread-ээс `Dispatcher.Invoke` хийж БОЛОХГҮЙ. Тиймээс жолоодогч нь **зөвхөн** самбар UI үйл явдал бүрд ХӨДЛӨШГҮЙ `Nudges.Ctx` агшинг `volatile` талбарт нийтэлж эхэлсний ДАРАА асна. Хэрэв тэр нөхцөл энэ релизэд хангагдахгүй бол **PUSH нь БҮХЭЛДЭЭ N+1 рүү хойшилно, релиз N нь PULL-ONLY хэвээр гарна** — R2/R6 нь caption-аар хангагдана.
- **ВЭБ PUSH-ААР ХЭЗЭЭ Ч ЯВУУЛАХГҮЙ.** `lib/pushSweep.ts:53`-ийн `CATEGORY_OF` нь `Record<NotificationType, PushCategory>` — ЗОРИУД бүрэн; шинэ төрөл нь эмхэтгэлийн алдаа. Мөн backend↔frontend `NotificationType` хос нь АЛЬ ХЭДИЙН зөрчилдсөн. `VAPID_PUBLIC_KEY` эргүүлэх нь бүх захиалгыг эргэлт буцалтгүй хүчингүй болгоно.

### 3.17 `revit-mcp/training/check_changeset.py` (ШИНЭ) — Revit-гүй харнесс

`check_nudge.py`-ийн (`:29-45`) бүтцийг ҮГ ҮСГЭЭР хуулна: түр `.csproj` үүсгээд ЗӨВХӨН `ChangeSetCoalescer.cs`-ыг `<Compile Include=…>`-ээр оруулж `dotnet run` хийнэ. Add-in-д C# ТЕСТ ТЭГ байгаа тул энэ бол хамрах хүрээ авах ЦОРЫН ГАНЦ арга.

Хамгийн багадаа арван тохиолдол, ихэнх нь «ХААГДАХ ЁСГҮЙ»:

1. Ганц гүйлгээ + 1199 мс → `null` (намжаагүй).
2. Ганц гүйлгээ + 1200 мс → `settle`, `MayCollect = true`.
3. 1100 мс тутам 20 гүйлгээ → 15 000 мс хүртэл `null`; дараа нь `defer`, **`MayCollect = false`**.
4. Нэг гүйлгээнд 2500 элемент → `size`, `Coarse = true`, id тайрагдсан.
5. Хоёр өөр `DocKey` → хоёр ТУСДАА олонлог, ХОЛИЛДОХГҮЙ.
6. Давхардсан id → гаралт ДАВХАРДААГҮЙ.
7. 40 `undo:` гүйлгээ → `UndoBurst = 40`, ганц олонлог.
8. `TryClose(quiet: false)` → `settle` шалгуур хангагдсан ч `MayCollect = false`.
9. `Feed` дуудагдаагүй → `TryClose` нь `null`, онцгой байдал ҮҮСГЭХГҮЙ.
10. `nowMs` буурсан (цагийн шилжилт) → ХАЯГДАХГҮЙ, ХӨЛДӨХГҮЙ, `defer` замаар хаагдана.

`datasets.manifest.json`-ыг ЭНЭ ФАЙЛ ХӨНДӨХГҮЙ (тэр нь 2-6-ын харьяа) — `check_changeset.py` нь ГАНЦААРАА ажилладаг скрипт.

### 3.18 ГАЦААНЫ ХУВИЛБАР БҮР ба түүний ХАМГААЛАЛТ

| # | Хувилбар | Хамгаалалт | Нотолгоо |
|---|---|---|---|
| 1 | 4.9 GB загвар нээв | Эхний БҮРЭН сканнер ХЭЗЭЭ Ч БАЙХГҮЙ. `AutoBaseline` (`ChangeTracker.cs:669`) нь аль хэдийн баримт-хэмжээст цуглуулагч + синхрон flush хийдэг — түүн дээр compliance НЭМЭХГҮЙ. Ажил нь ЗӨВХӨН өөрчлөгдсөн элементээс эхэлнэ | §51-R3, `ChangeTracker.cs:650` |
| 2 | 12 холбоос | Релиз N нь `host_only`. Холбоос доторх геометрийн дүрэм ТАТГАЛЗАНА: `RevitLinkInstance.GetTotalTransform()` нь 46 `.cs`-ийн АЛЬ НЬ Ч хэрэгжүүлээгүй | `LinkEnumerator.cs:48-51`, `QtoExtractor.cs:128` |
| 3 | Copy-paste шуурга (3000 элемент) | HOT нь зөвхөн олонлогийн алгебр + нэг бичлэг. Нэгтгэгч `max_elements_per_set = 2000` дээр `Coarse` болно. `collect_rule_inputs` ≤150 элемент × дотоод 1500 мс | §3.8, §3.14 |
| 4 | Шөнийн багц QTO | `BatchQto.IsBatch` ⇒ планировщик БА илгээгч ХОЁУЛАА no-op. `DrainBlocking(5000)` нь `Kill()`-ийн өмнө ирээдүйн урьдчилсан нөхцөл болж үлдэнэ | §3.13, `BatchQto.cs:102` |
| 5 | Worker 500 / өлгөгдөв | `AiHttp` 20 с (180 с БИШ) + `CancellationToken` + backoff + 5 алдааны таслуур. HOT ба COLD зам ОГТ мэдрэхгүй | §3.10 |
| 6 | Сүлжээ тасрав | `Degraded.Offline`. Мөр нь дискэнд, курсор нь баталгаажсан хилийг хадгална. `BlockingCollection(4096)` дүүрвэл `_dropped++` → `dropped_count` | §3.9, §3.15 |
| 7 | Шалгалтын дунд Revit хаагдав | `ComplianceCts.Cancel()` → `RevitToolBus.CancelAll()` → `ChangeTracker.Shutdown` → 400 мс хязгаартай Join × 2 → одоо байгаа сүүл. Хоёр thread нь `IsBackground` | §3.12, `App.cs:165`, `:194` |
| 8 | Хоёр Revit нэг компьютер дээр | Түр файл бүр `.<pid>.tmp`; дүрмийн багцын кэш нь hash+pid нэртэй; `timing.log`-ийн ЗӨВХӨН ЭРГЭЛТИЙГ нэрлэсэн mutex хамгаална (мөр бүрийг БИШ — 4096 гүн дараалалд мөр тутам kernel дуудлага нь өвчнөөс ДОР эм) | §3.7, `Percentiles.cs:478`, `:508-520` |
| 9 | 40 удаа Ctrl+Z | `op_name` нь `undo:`-оор угтварлагдана (`ChangeTracker.cs:753`) ⇒ `UndoBurst`. Шуурга явж байх зуур дахин үнэлгээ ЗОГСОНО, намжсаны дараа НЭГ УДАА | §3.8 |
| 10 | Модаль цонх нээлттэй (Options) | `ExternalEvent` гүйцэтгэгдэхгүй (`RevitToolBus.cs:313`). `Gate.Wait(0)` амжилтгүй ⇒ мөчлөг АЛГАСНА. Хэрэглэгчийн «Зураг холбох» дуудлага НЭГ Ч секунд хүлээхгүй | §3.14 |
| 11 | Хэрэглэгч чат бичиж байна | `RevitToolBus.UserBusy` (`AssistantPane.SetBusy`, `:341-352`) ⇒ планировщик зогсоно. ⚠️ Compliance нь `SetBusy`-г ХЭЗЭЭ Ч дуудахгүй — тэр нь `Mouse.OverrideCursor`-ыг АПП ДАЯАР тавьдаг (`:351`) | `AssistantPane.xaml.cs:341-352` |
| 12 | Roaming profile (сүлжээний `%APPDATA%`) | Илгээгчийн БҮХ диск бичилт нь өөрийн thread дээр. UI thread дээр СИНХРОН диск БАЙХГҮЙ — `AssistantLog`-ийн `EnsureLoaded` + `AppendOne` загварыг ДАВТАХГҮЙ | §2.7, §3.9 |

---

## 4. ХӨНДӨЖ БОЛОХГҮЙ (load-bearing)

| Юу | Хаана (баталгаажсан) | Яагаад эвдрэх вэ |
|---|---|---|
| `purpose === 'mcp'` токеныг `/api/*` хүлээж авсаар байх | `middleware/auth.ts:101-102`, `types.ts:209-212`, `lib/tokenValidity.ts:30-34` | Add-in-ийн БҮХ REST дуудлага тэр токеноор явна, сэргээх урсгал БАЙХГҮЙ. ~20 компьютер, Revit хаалттай. АЛСААС сэргээх БОЛОМЖГҮЙ |
| `users` / `projects` -ийг `migrations apply`-аар дахин бүтээхгүй | 19 ба 33 cascade хүүхэд | Эцгийг унагаахад бүх хүүхэд мөр устана. Энэ сесс тэднийг хөндөхгүй ч дүрэм хүчинтэй |
| `ChangeTracker.Gate`-ыг bus дуудлага / диск / await дээгүүр БАРИХГҮЙ | `ChangeTracker.cs:798`, `:567-570` | `OnDocumentChanged` нь гүйлгээ бүрд тэр түгжээг авна. Барьсан хэвээр хүлээх нь хэрэглэгчийн дараагийн үйлдлийг хэрэгслийн бүтэн хугацаагаар гацаана |
| `DockablePane.Show()`-г АВТОМАТААР дуудахгүй | `AssistantPaneProvider.cs:54` — цорын ганц `Show()`, хэрэглэгчийн товч | Файл нээх бүрд ~300 px ба фокус хулгайлагдана. R7-ийн хамгийн магадлалтай регресс |
| Түгжээ барьж болох thread-ээс `Dispatcher.Invoke` ХИЙХГҮЙ | `Nudges.cs:52-73`-ийн `Ctx` нь WPF төлөв шаардана | UI thread өөрөө `lock (Gate)`-д хүлээж байж болно ⇒ хоёр thread-ийн ГАЦАА, хэрэглэгчид «Revit өлгөгдлөө» |
| `_flushTimer`-ийг ҮЕ ҮЕИЙН болгож БУЦААХГҮЙ | `ChangeTracker.cs:313` (өмнөх), `:558`, `:577`, `:584` | Давхацсан callback нь ижил `.tmp`-д бичиж, `Dirty.Clear()` аль хэдийн ажилласан тул өдрийн ажил ЧИМЭЭГҮЙ алдагдана |
| `TryGetByKey`-г циклийн уншилт БОЛГОХГҮЙ | `ChangeTracker.cs:412-437`, `:63`, `:74` | `Gate` дотор 500 000 id + 20 000 META гүнзгий хуулбар. `Metrics.FlushLock` гүйлгээ бүрд өснө |
| `OnDocumentChanged`-д ШИНЭ Revit API дуудлага НЭМЭХГҮЙ | `ChangeTracker.cs:792-795` | `GetTransactionNames()` нь ЦОРЫН ГАНЦ дуудлага гэсэн гэрээ. Нэмэх нь handler-ийн API ажлыг хоёр дахин болгоно |
| `MaxPerSlice = 4` + `RaiseAgain` | `RevitToolBus.cs:440`, `:458`, `:512` | Дараалал ХООСРОХ хүртэл эргүүлэх нь Revit-ийн мессежийн давталтыг барьж програмыг БҮХЭЛД НЬ хөлдөөнө — тэр нь тухайн тогтмолыг үүсгэсэн регресс |
| `Abandoned` протокол | `RevitToolBus.cs:309`, `:474` | Тэмдэглээгүй бол Revit «сүнс» ажлыг БҮТНЭЭР гүйцэтгэж, дараагийн дуудлага БАТАЛГААТАЙ хугацаа дуусна |
| `ApiClient.Http`-ийн 180 секунд ба UA угтвар | `ApiClient.cs:56`, `:58-84` | UA-гүй → Cloudflare 403/1010, Worker-т хүрэхээс ӨМНӨ. Compliance нь ТУСДАА клиент авна; `ApiClient.Http`-ыг ӨӨРЧЛӨХГҮЙ |
| `UiPump.DoEvents`-ыг compliance-д ХЭРЭГЛЭХГҮЙ | `UiPump.cs:11-21`, `QtoProgressWindow.xaml.cs:142` | Тэр нь ил тод модаль, хэрэглэгчийн эхлүүлсэн багц ажилд л зөвшөөрөгдөнө. Идэвхгүй хөдөлгүүрт хэрэглэх нь `DispatcherFrame`-ийн үүрлэлт үүсгэнэ |
| `ShowElements` ХЭЗЭЭ Ч | `RevitTools.cs:408`, `ChangeReport.cs:39` | Боловсруулагч ДОТОР модаль `TaskDialog` гаргана ⇒ Revit хүн товшихыг хүртэл гацна |
| `Nudges.MaxPerDay = 2` | `Nudges.cs:34`, `:23-24` | Файлын өөрийнх нь толгой: өдөрт 8 удаа гарвал хүн add-in-ыг унтраана |
| `dedup_key`-д `ruleset_version` ОРУУЛАХГҮЙ | §3.2 | Багц дахин нийтлэх бүрд бүх ack өнчирч, CRITICAL суваг хаясан мөр дээр дахин асна |
| Гүйцэтгэлийн ЗУРГАА ДАХЬ бодит багана `bim_sessions`-д НЭМЭХГҮЙ | `bimEvents.ts:384-386` | 32 → 33 нь `floor(100/34) = 2` ⇒ ingest-ийн бүтээмж 33% буурна |
| `bim.capture.*` дугуйнуудыг ХӨНДӨХГҮЙ | `learning.ts:191-218`, 0208 | Тэдгээр нь бүртгэлийн замын өмч. Энэ сесс ЗӨВХӨН `bim.compliance.*` нэмнэ |
| `RevitToolBus`-ийн одоо байгаа `Call` / `CallCore` / `Execute` замыг ӨӨРЧЛӨХГҮЙ | `RevitToolBus.cs:204`, `:246`, `:440-512` | `TryCall` нь ЗЭРЭГЦЭЭ гадаргуу. `CallCore`-ийн `Gate.Wait(timeout*1000)` (`:266`) -ыг `Wait(0)` болговол ЧАТ ба QTO нь өрсөлдөөн бүрд ЧИМЭЭГҮЙ унана |
| `compliance.ts`-ийн роутер, `index.ts`-ийн mount, `modules.ts`-ийн ангиллыг ЭНЭ СЕСС БИЧИХГҮЙ | `2-2-rule-model` §3.12 | Хоёр баримт ИЖИЛ долгионд ажилладаг. Хоёулаа `new Hono()` бичвэл нэг нь нөгөөгийнхөө файлын түвшний `requireRole` хамгаалалтыг ДАРЖ бичих ба `/api/compliance` нээлттэй үлдэж болно |
| `set_compliance_badge`-ийг `RevitTools.cs`/`RevitApi.cs`-д ЭНЭ СЕСС БҮРТГЭХГҮЙ | Тэр хоёр файл нь `2-3`-ынх | Хамрах хүрээний зөрчил нь ЯГ ТЭР файл дээр гарна — `RevitTools.cs:78-89`-ийн `switch` нь хоёр агентын зэрэг засварыг тэвчихгүй |
| `ChangeTracker.TryDrain` нь `Gate`-ыг АВААД ШУУД ТАВИНА | §3.6, Хориглолт №7 | Дотор нь bus дуудлага / диск / `await` орвол `OnDocumentChanged` гүйлгээ бүрд тэр түгжээнд хүлээнэ |
| `TryDrain`-д ХОЁР ДАХЬ дуудагч НЭМЭХГҮЙ | §3.6, §3.9.a-ийн 6-р хэсэг | `_ringDrainedSeq`-ийг шавхагч урагшлуулдаг тул хоёр дуудагч бичлэгүүдийг бие биенээсээ ХУЛГАЙЛНА: нэг хэсэг гүйлгээ дэвтэрт, нөгөө хэсэг нь дүрмийн үнэлгээнд ЧИМЭЭГҮЙ алга болно. `BimEmitter._pump` нь ЦОРЫН ГАНЦ шавхагч |
| `txn_uid` / `event_uid` нь ДЕТЕРМИНИСТ (`session_uid + ":" + seq`) | §3.9.a-ийн 3, 4-р хэсэг, `learning.ts:817-820` | Санамсаргүй GUID хэрэглэвэл resume бүрд ИЖИЛ гүйлгээ ШИНЭ мөр болж, `ON CONFLICT DO NOTHING` ажиллахаа болино — сүлжээ тасрах бүрд дэвтэр давхардана |
| Түүврийн буферийн дүүрэх ДАРААЛАЛ (`add → delete → modify`) | §3.6-ийн гурван diff, §3.9.a-ийн 3-р хэсэг | `touches[].change` нь тэр дараалал ба гурван тоолуураас ТООЦОГДДОГ. Дарааллыг сольвол «устгасан» нь «нэмсэн» болж ЧИМЭЭГҮЙ буруу сургалтын мөр гарна |
| Envelope-ийн `category`-г ТААМГААР бөглөхгүй | §3.9.a-ийн 3-р хэсэг, `bimEvents.ts:660-698` | Худал атрибут нь `parts_missing`-ийг 0 болгож, дутуу мөрийг сургалтад ЭРХГҮЙГЭЭР оруулна. Хоосон үлдээх нь `DATASET_ELIGIBLE_SQL`-ийг зориудаар давуулахгүй — тэр нь ЗӨВ зан төлөв |
| Багц угсрахад ГУРВАН хязгаарыг ЗЭРЭГ шалгана | §3.9.a-ийн 5-р хэсэг, `learning.ts:88`, `:307-311` | Зөвхөн `emit_batch_max`-ыг шалгавал 100 × 24 = 2400 > 2000 тул эхний том наалт 413 авна |

---

## 5. ДАРААЛАЛ БА ХАМААРАЛ

**Урьдчилсан нөхцөл:**

| # | Нөхцөл | Хэрхэн шалгах |
|---|---|---|
| 1 | 2-1-ийн `bim_sessions` багийн талбарууд ХЭРЭГЖСЭН | `wrangler d1 execute … --command "PRAGMA table_info(bim_sessions)"` → `team_code` мөр байна |
| 2 | 0212-0216 продакшнд ХЭРЭГЖСЭН | `SELECT name FROM d1_migrations ORDER BY id DESC LIMIT 20` → `0216_assistant_log_timing.sql` байна |
| 3 | 0226-0228 ба 0230 дугаар СУЛ | `ls backend/migrations \| tail -5` |
| 4 | `migrationSchema` тест ногоон | `cd backend && node --test src/lib/migrationSchema.test.ts` |
| 5 | **`2-2`-ийн `compliance.ts` роутер аль хэдийн БАЙНА** (`new Hono` + `index.ts`-ийн mount + `modules.ts`-ийн ангилал) | `grep -n "'/api/compliance'" backend/src/lib/modules.ts` → ХОЁР мөр. ⚠️ Байхгүй бол §3.5-ыг ЭХЛҮҮЛЭХГҮЙ — файлыг ЭНЭ СЕСС ҮҮСГЭХГҮЙ |

```
1.  cd backend && ls migrations | tail -5              (дугаар батлах)
2.  0226 · 0227 · 0228 · 0230 бичих
3.  node scripts/check-bim-events.mjs                  (bind арифметик)
4.  npx wrangler d1 migrations apply mgl-progress-db-v3 --remote --config wrangler.toml
        ▼   ⚠️ ШИНЭ БАГАНА НЬ ТҮҮНИЙГ УНШДАГ КОДООС ХАТУУ ӨМНӨХ DEPLOY-Д ГАРНА
5.  learning.ts (loadComplianceConfig, buildPerfJson) + bimEvents.ts (perf_json)
        + compliance.ts дээр ГУРВАН handler НЭМНЭ (роутер нь 2-2-ынх, ҮҮСГЭХГҮЙ)
6.  npx tsc --noEmit && npm test
7.  npx wrangler deploy --config wrangler.toml
        ▼
8.  C#: ChangeTracker (RawRing + TryDrain + таймер) → RevitToolBus
        (TryCall/UserBusy/CancelAll) → ChangeSetCoalescer → AiHttp
        → BimEmitter → Percentiles → App.cs → BatchQto.cs
9.  check_changeset.py                                  (Revit-гүй тулгалт)
10. dotnet build × 4 (R24/R25/R26/R27)                  ⚠️ net48 ЗААВАЛ ЭМХЭТГЭГДЭНЭ
11. UA утаа тест НЭГ машин дээр: 401 (403 БИШ)          ⚠️ ТАРААХЫН ӨМНӨХ ХААЛГА
12. Track 2-ын БҮХ C# бэлэн болсны ДАРАА л НЭГ РЕЛИЗ
```

**ЗЭРЭГ ХИЙЖ БОЛОХ АЖИЛ (эзэн хурдыг хүссэн):**

| Баримт | Зэрэг уу | Яагаад |
|---|---|---|
| `2-1-team-context` | ⚠️ ЭХЛЭЭД | `bim_sessions`-ийн багийн талбарууд нь миграцийн ДАРААЛЛААР энэ файлын өмнө байх ёстой. БИЧИХИЙГ зэрэг эхэлж болно, ХЭРЭГЖҮҮЛЭХИЙГ БИШ. ⚠️ `backend/src/lib/bimEvents.ts` нь ХУВААЛЦСАН файл — `SESSION_INSERT_COLUMNS`-д тэдний 4 талбарын ДАРАА `perf_json`-ыг ЗАЛГА |
| `2-2-rule-model` | ⚠️ ХЭСЭГЧИЛСЭН | Схемийн огтлолцол ТЭГ (2-2 → 0220-0223, 2-4 → 0226-0228 + 0230). **ГЭХДЭЭ `backend/src/routes/compliance.ts` нь ХУВААЛЦСАН**: 2-2 нь файл + роутер + `index.ts` mount + `modules.ts` ангиллыг ҮҮСГЭНЭ, 2-4 нь ЗӨВХӨН гурван handler нэмнэ. 2-2-ыг ЭХЛЭЭД дуусга (§5-ийн урьдчилсан нөхцөл 5) |
| `2-8-install-and-health` | ✅ БҮРЭН ЗЭРЭГ | `addin_releases` / `addin_installs` нь тусдаа хүснэгт |
| `2-6-team-training` | ✅ БҮРЭН ЗЭРЭГ | `assistant_*` хүснэгтүүд — огтлолцол байхгүй |
| `2-3-compliance-engine` | ❌ ДАРАА НЬ | Планировщик нь `RawRing`, `Wake`, `TryCall`, `UserBusy`, `Metrics.RuleEval` дээр суудаг |
| `2-5-finding-surface` | ❌ ДАРАА НЬ | `FindingFeed` нь `compliance_notice_state` ба `Nudges`-ийн төсвөөр гарна |
| `2-7-readiness-and-quality` | ❌ ДАРАА НЬ | `perf_json` ба notice өгөгдлийг уншина |

### Дараа нь юу ирэх вэ

| Баримт | Энэ файлаас юуг авах вэ |
|---|---|
| 2-3 | `ChangeTracker.RawRing` + `Wake` + **`TryDrain`** (цагирагийг унших ЦОРЫН ГАНЦ API), `ChangeSetCoalescer`, `RevitToolBus.TryCall` / `UserBusy` / `CancelAll` + `ToolCall.Skipped`, `Metrics.RuleEval`/`InputCollect`, `bim.compliance.*` арван дугуй. ⚠️ `set_compliance_badge` хэрэгслийн БҮРТГЭЛ нь 2-3-ынх (`RevitTools.cs` + `RevitApi.cs`). ⚠️ **2-3 нь `TryDrain`-ийг ӨӨРӨӨ ДУУДАХГҮЙ** — `BimEmitter._pump` нь ЦОРЫН ГАНЦ шавхагч (§3.9.a). Планировщик нь `BimEmitter.ComplianceHook`-т `Action<LogicalChangeSet>` бүртгэж, хаагдсан олонлогийг тэр дэгээгээр хүлээж авна (2-3 §3.6-ийн `RunPass(set, …)`); дэгээ NULL байхад цуглуулга ЯВСААР — R1 нь compliance-аас ХАМААРАХГҮЙ |
| 2-5 | `compliance_notice_state`, `min_severity`, `snooze_hours`, `authority_level` (0230), `Nudges`-ийн төсөв, ribbon caption badge-ийн ДУУДАХ ЦЭГ |
| 2-7 | `perf_json` ба түүний дөрвөн скаляр, `dropped_count`, `shown_count` |
| 2-8 | `bim.compliance.authority_level` (0230) → `GET /api/learning/settings`-ийн `compliance.authority_level` → `BuildInfo.SelfCheck()` → `addin_installs.authority_level`. **Энэ бол 2-8 §9 №14-ийн асуултын хариу** |

---

## 6. ХҮЛЭЭН АВАХ ШАЛГУУР

### Миграц

- [ ] `PRAGMA table_info(bim_sessions)` → `perf_json`, `p95_doc_changed_ms`, `p95_flush_lock_ms`, `p95_coalesce_ms`, `p95_emit_post_ms` — **яг 5 шинэ мөр**
- [ ] `SELECT COUNT(*) FROM pragma_index_list('bim_sessions') WHERE name LIKE 'idx_bim_sessions_perf%'` → **2**
- [ ] `SELECT COUNT(*) FROM compliance_notice_state` → **0** (шинэ хүснэгт, алдаагүй)
- [ ] `SELECT COUNT(*) FROM app_settings WHERE key LIKE 'bim.compliance.%'` → **10** (0228-ийн 8 + 0230-ийн 2)
- [ ] `SELECT value FROM app_settings WHERE key='bim.compliance.authority_level'` → **`'0'`** (LEVEL 0 OBSERVE)
- [ ] `SELECT value FROM app_settings WHERE key='bim.compliance.rollout_pct'` → **`'0'`**
- [ ] `INSERT INTO bim_sessions (…, perf_json) VALUES (…, '[]')` → **CHECK constraint failed** (объект биш)
- [ ] `INSERT INTO compliance_notice_state (user_id, dedup_key, state) VALUES (1,'x','banana')` → **CHECK constraint failed**
- [ ] Хоёр дахь `INSERT` ижил `(user_id, dedup_key)`-аар → **UNIQUE constraint failed**
- [ ] `node backend/scripts/check-bim-events.mjs` → exit 0
- [ ] `SESSION_ROWS_PER_STATEMENT` = **3** (32 bind дээр өөрчлөгдөөгүй)

### Backend

- [ ] `GET /api/learning/settings` → `compliance` объект, **10 талбар** (`authority_level` ба `rollout_pct` ОРСОН), бүгд null БИШ
- [ ] `UPDATE app_settings SET value='off' WHERE key='bim.compliance.mode'` → дараагийн `/settings` дуудлага `"mode":"off"` буцаана (кэшгүй)
- [ ] `grep -c "bim.compliance." backend/src/routes/learning.ts` → **≥10** (уншигчгүй дугуй БАЙХГҮЙ — `authority_level` ба `rollout_pct` ХОЁУЛАА уншигдана)
- [ ] `POST /api/learning/events` дээр `session.perf` бүх талбар дутуу → `perf_json` мөрөнд **NULL**, `'{}'` БИШ
- [ ] `GET /api/compliance/notices` engineer токеноор → **200**, ЗӨВХӨН өөрийн мөр
- [ ] Өөр хэрэглэгчийн `dedup_key`-ээр `POST /api/compliance/notices/:key/state` → **404** (мөр олдохгүй), 403 БИШ
- [ ] `worker` дүрээр `GET /api/compliance/notices` → **403** (`workerScope` allowlist)
- [ ] `grep -n "'/api/compliance'" backend/src/lib/modules.ts` → `API_PREFIXES` ба `MODULE_OF` ХОЁУЛАА. ⚠️ **Энэ бол `2-2`-ийн ажлын ШАЛГАЛТ, энэ сессийнх БИШ** — `git diff` дээр `modules.ts` ба `index.ts` ГАРАХ ЁСГҮЙ
- [ ] `git diff --name-only` → `backend/src/index.ts` ба `backend/src/lib/modules.ts` **БАЙХГҮЙ**
- [ ] `cd backend && npx tsc --noEmit` → 0 алдаа; `npm test` → 44/44 (эсвэл өмнөх суурь)

### Add-in

- [ ] `grep -n "new Timer(" revit-mcp/addin/ChangeTracker.cs` → `Timeout.Infinite` агуулсан **1 мөр**
- [ ] `grep -c "Interlocked.CompareExchange(ref _flushBusy" ChangeTracker.cs` → **1**
- [ ] `grep -c "TryGetByKey" ChangeTracker.cs ChangeReport.cs RevitTools.cs` → нийт **2** (`ChangeTracker.cs` 2 — тодорхойлолт `:412` + `TryGet`-ийн дуудлага `:396`; `ChangeReport.cs` 0; `RevitTools.cs` 0). ⚠️ Гурван бодит дуудагч нь `ChangeTracker.TryGet(doc, …)`-ээр ДАМЖДАГ тул тэр файлуудад энэ ТЕКСТ ГАРАХГҮЙ. **ӨМНӨ 2, ДАРАА 2 — ШИНЭ дуудагч БАЙХГҮЙ**
- [ ] `grep -c "TryGet(" ChangeReport.cs RevitTools.cs` → **2 + 1** (ӨӨРЧЛӨГДӨӨГҮЙ)
- [ ] `grep -c "internal static int TryDrain" revit-mcp/addin/ChangeTracker.cs` → **1** (цагирагийг унших API БАЙНА — үүнгүйгээр `2-3` нэг ч бичлэг уншиж чадахгүй)
- [ ] `grep -c "_ringDrainedSeq" revit-mcp/addin/ChangeTracker.cs` → **≥3** (тунхаглал + `AppendRaw`-ийн алдагдал + `TryDrain`-ийн урагшлалт)
- [ ] `grep -c "addedN" revit-mcp/addin/ChangeTracker.cs` → **≥3** (гурван давталтад тоолуур ҮНЭХЭЭР нэмэгдсэн)
- [ ] `grep -n "public static ToolCall TryCall" revit-mcp/addin/RevitToolBus.cs` → **1 мөр**
- [ ] `grep -n "Gate.Wait(0)" revit-mcp/addin/RevitToolBus.cs` → **1 мөр** (`TryCall` дотор; `CallCore`-ийн `:266` нь ХЭВЭЭР `timeoutSeconds * 1000`)
- [ ] `grep -n "public static volatile bool UserBusy\|public static void CancelAll" revit-mcp/addin/RevitToolBus.cs` → **2 мөр**
- [ ] `grep -c "public bool Skipped" revit-mcp/addin/RevitToolBus.cs` → **1**
- [ ] `grep -n "MaxPerSlice" revit-mcp/addin/RevitToolBus.cs` → **`= 4` ХЭВЭЭР** (`TryCall` нь `Execute`-ийн зүсэлтийг ХӨНДӨӨГҮЙ)
- [ ] `grep -c "Autodesk" revit-mcp/addin/ChangeSetCoalescer.cs` → **0**
- [ ] `grep -c "Autodesk" revit-mcp/addin/BimEmitter.cs` → **0**
- [ ] `grep -c "Autodesk" revit-mcp/addin/AiHttp.cs` → **0**
- [ ] `grep -c "ApiClient.Http" revit-mcp/addin/BimEmitter.cs` → **0**
- [ ] `grep -c "MglRevitAddin/" revit-mcp/addin/AiHttp.cs` → **1**
- [ ] `grep -c "IsBackground = true" revit-mcp/addin/BimEmitter.cs` → **2** (`_pump` ба `_post` — §3.9.a-ийн 6-р хэсэг; НЭГ бол шавхагч эсвэл илгээгчийн аль нэг нь ДУТУУ)
- [ ] `grep -c "BimEmitter.Enqueue" revit-mcp/addin/*.cs` → **4** — ЯГ дөрөв: `_pump`-ийн TXN, `_pump`-ийн `SESSION_START`, `Cancel()`-ийн `SESSION_END` (гурвуулаа `BimEmitter.cs`), ба `ComplianceScheduler.cs`-ийн `RULE_VALIDATION` (`2-3`). **0 бол дэвтэр хоосон хэвээр (R1 БҮТЭЛГҮЙТСЭН); 5 бол эзэнгүй мөр орж ирж байна**
- [ ] `grep -c "ChangeTracker.TryDrain" revit-mcp/addin/*.cs` → **1** (ЦОРЫН ГАНЦ шавхагч. 2 бол хоёр thread бичлэгүүдийг бие биенээсээ хулгайлж байна)
- [ ] `grep -c "SESSION_START\|SESSION_END" revit-mcp/addin/BimEmitter.cs` → **≥2**
- [ ] `grep -c "public string DocKey\|public string OpName" revit-mcp/addin/ChangeTracker.cs` → **2** (үүнгүйгээр `ChangeSetCoalescer.Feed(…, docKey, …)` эмхэтгэгдэхгүй, envelope баримтаа нэрлэж чадахгүй)
- [ ] `grep -c "2000" revit-mcp/addin/BimEmitter.cs` → **≥1** (`MAX_TOUCH_BATCH`-ийн хязгаар угсрагчид БАЙНА — 100 × 24 = 2400 > 2000, §3.9.a-ийн 5-р хэсэг)
- [ ] `grep -c "\[JsonIgnore\]" revit-mcp/addin/BimEmitter.cs` → **0** (курсор нь ФАЙЛД байна)
- [ ] `grep -c "Save()" revit-mcp/addin/BimEmitter.cs` → **0** (бүтэн дахин бичилт БАЙХГҮЙ)
- [ ] `grep -c "Dispatcher" revit-mcp/addin/BimEmitter.cs ChangeSetCoalescer.cs` → **0**
- [ ] `grep -c "DockablePane" revit-mcp/addin/BimEmitter.cs ChangeSetCoalescer.cs` → **0**
- [ ] `grep -n "IsBatch" revit-mcp/addin/BatchQto.cs` → тодорхойлолт + `Hook`-д оноолт
- [ ] `grep -n "MaxPerDay" revit-mcp/addin/Nudges.cs` → **`= 2` ХЭВЭЭР**
- [ ] `python check_changeset.py` → **10/10 тохиолдол ногоон**
- [ ] `dotnet build -c "Release R24" -p:Platform=x64` → **амжилттай** (net48-д шинэ файл бүр эмхэтгэгдэнэ)
- [ ] `App.OnShutdown`-д `ComplianceCts.Cancel` → `BimEmitter.Cancel` (`SESSION_END`-ийг дараалалд хийнэ, ХҮЛЭЭХГҮЙ) → `RevitToolBus.CancelAll` → `ChangeTracker.Shutdown` → `Join(400)` ×2 → `Metrics.EmitSummary` → `Metrics.Shutdown` → `AssistantLog.Shutdown` → **`RevitToolBus.Shutdown` ХАМГИЙН СҮҮЛД**

### Гараар (Revit нээлттэй, автоматжуулах боломжгүй)

- [ ] **Гараар:** 500+ элемент наагаад ШУУД чирэх → чирэлт ГӨЛГӨР, ямар ч цочролгүй
- [ ] **Гараар:** 40 удаа Ctrl+Z → Revit гацахгүй, badge нь 40 удаа мэдэгдэл гаргахгүй
- [ ] **Гараар:** Options цонх нээлттэй байхад 30 секунд хүлээ → хаагаад «Зураг холбох» дар → «Хугацаа дууслаа» **ГАРАХГҮЙ**
- [ ] **Гараар:** сүлжээ салгаад 10 минут ажилла → Revit хэвийн; сүлжээ залгаад мөрүүд илгээгдэнэ; `%APPDATA%\RevitMcpAddin\bim-events.jsonl` өснө
- [ ] **Гараар:** Revit-ийг ажлын дундуур хаа → **2 секундээс бага хугацаанд** хаагдана, өлгөгдөхгүй
- [ ] **Гараар + SQL:** нэг баримт дээр 10 гүйлгээ хий → Revit хаа → `SELECT COUNT(*) FROM bim_sessions` **≥1**, `SELECT COUNT(*) FROM revit_transactions` **≥10**, `SELECT COUNT(*) FROM learning_events WHERE kind IN ('SESSION_START','SESSION_END')` **=2**. ⚠️ Энэ бол R1-ийн ЦОРЫН ГАНЦ жинхэнэ нотолгоо — grep нь код байгааг л хэлнэ, мөр ирснийг БИШ
- [ ] **Гараар:** Revit 2024 ба 2027-г ЗЭРЭГ нээ → `changes\*.json` хоёулан дээр шинэчлэгдэнэ, `.tmp` файл үлдэхгүй
- [ ] **Гараар:** `bim.compliance.mode = 'off'` → Revit дахин асаахад ямар ч compliance ажил ажиллахгүй, badge алга
- [ ] **Гараар:** UA утаа тест — хугацаа дууссан токеноор нэг дуудлага → **401**, 403/1010 БИШ
- [ ] `git status --short` → ЗӨВХӨН толгойн жагсаалтын **17 файл** (`index.ts` ба `modules.ts` БАЙХГҮЙ)
- [ ] ⚠️ `npm run build` бүтэлгүйтвэл алдаа тэдгээр файлд байгаа эсэхийг батал — өөр агентын WIP байж болно

---
## 7. ШАЛГАХ КОМАНД

```bash
# ⚠️ CWD ГЭРЭЭ: ЭНЭ БЛОК РЕПОГИЙН ЯЗГУУРААС ЭХЭЛНЭ, ба МӨР 1-ийн `cd backend`
#    ХОЙНО cwd нь `backend/` ХЭВЭЭР ҮЛДЭНЭ (bash-ийн `cd` нь блок дотор
#    ХАДГАЛАГДАНА).  Тиймээс доорх зам бүр ТЭР cwd-ээс тооцогдсон.  Дахин
#    `cd backend` бичих нь «No such file or directory» өгч, `&&`-ийн ард
#    байгаа typecheck / тест / bind шалгалт ЧИМЭЭГҮЙ АЖИЛЛАХГҮЙ ӨНГӨРНӨ.

# --- 1. ДУГААР БАТЛАХ (бичихийн ӨМНӨ) ---
cd backend && ls migrations | tail -5
# Хүлээгдэх: … 0216_assistant_log_timing.sql (2026-08-30-ны байдлаар)
# ⚠️ 0226/0227/0228/0230 эзэлэгдсэн бол ДӨРВҮҮЛЭЭГ нэг блокоор шилжүүл, §3.0-г шинэчил.

node --test src/lib/migrationSchema.test.ts
# Хүлээгдэх: pass, 0 fail.  (0214/0215-ийн `reviewed_at` мөргөлдөөнөөс сэргийлнэ)

# --- 2. МИГРАЦ ХЭРЭГЖҮҮЛЭХ (cwd = backend/) ---
npx wrangler d1 migrations apply mgl-progress-db-v3 --remote --config wrangler.toml
# ⚠️ `--config wrangler.toml` ЗААВАЛ — репогийн язгуурт өөр worker зарласан
#    `wrangler.jsonc` байгаа ба wrangler түүнийг сонгож болно.

npx wrangler d1 execute mgl-progress-db-v3 --remote --config wrangler.toml \
  --command "SELECT name FROM d1_migrations ORDER BY id DESC LIMIT 5"
# Хүлээгдэх: 0230_… · 0228_… · 0227_… · 0226_… · 0216_…

# --- 3. СХЕМ БАТАЛГААЖУУЛАХ ---
npx wrangler d1 execute mgl-progress-db-v3 --remote --config wrangler.toml \
  --command "SELECT name FROM pragma_table_info('bim_sessions') WHERE name LIKE 'perf%' OR name LIKE 'p95%'"
# Хүлээгдэх: ЯГ 5 мөр — perf_json, p95_doc_changed_ms, p95_flush_lock_ms,
#            p95_coalesce_ms, p95_emit_post_ms

npx wrangler d1 execute mgl-progress-db-v3 --remote --config wrangler.toml \
  --command "SELECT key, value FROM app_settings WHERE key LIKE 'bim.compliance.%' ORDER BY key"
# Хүлээгдэх: ЯГ 10 мөр.  mode=observe · settle_ms=1200 · max_defer_ms=15000
#            max_elements_per_set=2000 · raw_ring_max=4000 · emit_batch_max=100
#            min_severity=HIGH · snooze_hours=24
#            authority_level=0 · rollout_pct=0        ← 0230
# ⚠️ Сүүлийн ХОЁР нь дутвал `authorityFromSetting(null)` ҮҮРД OBSERVE дээр
#    наалдана: 2-5-ийн самбар, 2-0-ийн релизийн төлөвлөгөө, 2-8-ийн
#    `addin_installs.authority_level` ГУРВУУЛАА үхмэл болно.

npx wrangler d1 execute mgl-progress-db-v3 --remote --config wrangler.toml \
  --command "SELECT COUNT(*) AS n FROM compliance_notice_state"
# Хүлээгдэх: n = 0

# --- 4. BIND АРИФМЕТИК (ЗААВАЛ, миграцийн ДАРАА.  cwd = backend/) ---
node scripts/check-bim-events.mjs
# Хүлээгдэх: exit 0.  SESSION_ROWS_PER_STATEMENT = 3 хэвээр.

# --- 5. WORKER (cwd = backend/) ---
npx tsc --noEmit && npm test
# Хүлээгдэх: 0 алдаа; тестийн суурь өөрчлөгдөөгүй
npx wrangler deploy --config wrangler.toml

# --- 6. УНШИГЧГҮЙ ДУГУЙ БАЙХГҮЙ (0195-ийн урхи.  cwd = backend/) ---
grep -c "bim.compliance." src/routes/learning.ts
# Хүлээгдэх: >= 10.  ӨМНӨ: 0.  ДАРАА: 10+ (арван түлхүүр бүр уншигдана)

grep -c "'/api/compliance'" src/lib/modules.ts
# Хүлээгдэх: 2 — ГЭХДЭЭ ЭНЭ НЬ `2-2`-ИЙН АЖИЛ.  `git diff --name-only`-д
#            `src/lib/modules.ts` ба `src/index.ts` ГАРАХ ЁСГҮЙ.

# --- 7. ЗАМЫН ГЭРЭЭ ХЭВЭЭР ЮҮ (cwd = backend/ → addin) ---
cd ../revit-mcp/addin
grep -c "Autodesk" ChangeSetCoalescer.cs BimEmitter.cs AiHttp.cs
# Хүлээгдэх: гурвуулаа 0 — Revit-гүй тестлэх боломж, net48 build

grep -n "new Timer(" ChangeTracker.cs
# Хүлээгдэх: ЯГ 1 мөр, `Timeout.Infinite` агуулсан (ҮЕ ҮЕИЙН БИШ)

grep -c "TryGetByKey" ChangeTracker.cs ChangeReport.cs RevitTools.cs
# Хүлээгдэх: ChangeTracker.cs:2 · ChangeReport.cs:0 · RevitTools.cs:0 = нийт 2.
# ӨМНӨ: 2.  ДАРАА: 2 — ШИНЭ дуудагч НЭМЭГДЭЭГҮЙ.
# ⚠️ Гурван БОДИТ дуудагч (`ChangeReport.cs:274`, `:729`, `RevitTools.cs:315`)
#    нь `ChangeTracker.TryGet(doc, …)`-ээр (`:394-397`) ДАМЖДАГ тул энэ ТЕКСТ
#    тэдгээр файлд ГАРАХГҮЙ.  «4» гэсэн хүлээлт нь ХӨНДӨӨГҮЙ мод дээр ч
#    улаан өгнө.

grep -n "internal static int TryDrain" ChangeTracker.cs
# Хүлээгдэх: ЯГ 1 мөр — 2-3-ийн планировщик цагирагийг УНШИХ ЦОРЫН ГАНЦ API.

grep -n "TryCall\|UserBusy\|CancelAll" RevitToolBus.cs
# Хүлээгдэх: TryCall (тодорхойлолт), UserBusy (volatile талбар),
#            CancelAll (тодорхойлолт) — ГУРВУУЛАА БАЙНА.
# ӨМНӨ: 0 мөр (2026-08-30-нд баталсан).  Байхгүй бол 2-3 ЭХЛЭЖ ЧАДАХГҮЙ.

grep -n "MaxPerSlice\|RaiseAgain" RevitToolBus.cs
# Хүлээгдэх: `MaxPerSlice = 4` ХЭВЭЭР, `RaiseAgain` ХЭВЭЭР — `Execute`-ийн
#            зүсэлтийн гэрээ (`:442-454`) ХӨНДӨГДӨӨГҮЙ.

grep -c "ApiClient.Http" BimEmitter.cs AiHttp.cs
# Хүлээгдэх: хоёулаа 0 — 180 секундын клиент дахин ашиглагдаагүй

grep -c "BimEmitter.Enqueue" *.cs
# Хүлээгдэх: 4 (§3.9.a) — TXN + SESSION_START + SESSION_END + 2-3-ын RULE_VALIDATION.
# ⚠️ 0 гарвал ЗОГС: дараалал бий, ДҮҮРГЭГЧ БАЙХГҮЙ — R1 ХЭРЭГЖЭЭГҮЙ.

grep -c "ChangeTracker.TryDrain" *.cs
# Хүлээгдэх: ЯГ 1 — цагирагийг шавхах ЭРХТЭЙ код НЭГ Л БАЙНА (`BimEmitter._pump`).

grep -n "MaxPerDay" Nudges.cs
# Хүлээгдэх: `public const int MaxPerDay = 2;` — ӨӨРЧЛӨГДӨӨГҮЙ

grep -n "Show()" AssistantPaneProvider.cs
# Хүлээгдэх: ЯГ 1 мөр (:54), хэрэглэгчийн ribbon команд дотор

# --- 8. REVIT-ГҮЙ ТУЛГАЛТ (cwd = revit-mcp/addin → training) ---
cd ../training && ../server/.venv/Scripts/python.exe check_changeset.py
# Хүлээгдэх: 10/10 ногоон, exit 0
# ⚠️ venv нь `revit-mcp/server/.venv` — `<repo>/server/.venv` ГЭЖ БАЙХГҮЙ.

# --- 9. ДӨРВӨН BUILD (Windows.  cwd = revit-mcp/training → addin) ---
cd ../addin
dotnet build RevitMcpAddin.csproj -c "Release R24" -p:Platform=x64   # net48 — ХАМГИЙН ЧУХАЛ
dotnet build RevitMcpAddin.csproj -c "Release R25" -p:Platform=x64
dotnet build RevitMcpAddin.csproj -c "Release R26" -p:Platform=x64
dotnet build RevitMcpAddin.csproj -c "Release R27" -p:Platform=x64
# ⚠️ Revit нээлттэй бол `-p:AddinDeployDir=C:\Temp\x` НЭМ (амьд суулгацыг дарахгүй)

# --- 10. UA УТАА ТЕСТ — ТАРААХЫН ӨМНӨХ ХААЛГА ---
# Нэг машин дээр, ХУГАЦАА ДУУССАН токеноор:
#   Хүлээгдэх: 401 {"error":"Invalid or expired token"}
#   ⚠️ 403 (error code 1010) ирвэл ЗОГС — UA угтвар эвдэрсэн, тараавал
#      ~20 компьютерийн БҮХ REST дуудлага үхнэ (ApiClient.cs:58-84).

# --- 11. ХАМРАХ ХҮРЭЭНИЙ ХЯНАЛТ ---
# ⚠️ cwd нь `revit-mcp/addin` — эхлээд язгуур руу БУЦ, эс бөгөөс `git status`
#    нь дэд хавтасны харьцангуй замыг үзүүлж, жагсаалттай тулгах боломжгүй.
cd ../..
git status --short
git diff --stat
# Зөвшөөрөгдсөн (17): backend/migrations/0226_*.sql 0227_*.sql 0228_*.sql 0230_*.sql
#                backend/src/routes/learning.ts backend/src/routes/compliance.ts
#                backend/src/lib/bimEvents.ts
#                revit-mcp/addin/{ChangeTracker,RevitToolBus,ChangeSetCoalescer,
#                                 BimEmitter,AiHttp,Percentiles,App,BatchQto,ApiClient}.cs
#                revit-mcp/training/check_changeset.py
# ⛔ backend/src/index.ts ба backend/src/lib/modules.ts нь `2-2`-ынх — ГАРВАЛ ЗОГС.
# ӨӨР ФАЙЛ ГАРВАЛ ЗОГС — өөр агентын ажил байж болно.
# git add -A БҮҮ хэрэглэ — файл бүрийг нэрээр нь нэм.
```

---

## 8. ROLLBACK

| Алхам | Буцаах арга |
|---|---|
| **8.1 Миграц хэрэгжихийн ӨМНӨ** | Файлыг устга. **Өгөгдлийн эрсдэл: ТЭГ.** |
| **8.2 Миграц хэрэгжсэний ДАРАА** | **БУЦААХГҮЙ.** `perf_json` ба гурван шинэ багана нь БҮГД nullable / шинэ хүснэгт — хуучин код тэднийг зүгээр л ҮЛ ТООМСОРЛОНО. Багана хасах нь `bim_sessions`-ыг ДАХИН БҮТЭЭХ шаардлагатай ба тэр нь `learning_events`-ийн `session_id`-тай холбоог эрсдэлд оруулна. `app_settings`-ийн 10 мөрийг саармагжуулна (`bim.compliance.mode='off'` ба `authority_level='0'`), `DELETE` хийхгүй. ⚠️ **ШИНЭ ДУГААР ЗААВАЛ** — хэрэгжсэн файлыг засах нь продакшн дээр **ЧИМЭЭГҮЙ NO-OP**. |
| **8.3 Worker** | `git revert` → `npx wrangler deploy --config wrangler.toml`. Хуучин код нь `perf_json`-ыг бичихгүй, `compliance_notice_state`-ыг уншихгүй — хоёулаа хоосон үлдэнэ, алдаа ҮҮСГЭХГҮЙ. **Өгөгдлийн эрсдэл: ТЭГ.** |
| **8.4 Add-in** | **АВТОМАТ БУЦААЛТ БАЙХГҮЙ.** Өмнөх zip-ийг ~20 компьютер дээр ГАРААР, Revit хаалттай байхад суулгана. ⚠️ Суулгахын ӨМНӨ `%APPDATA%\RevitMcpAddin\bim-events.jsonl` ба `bim-events.cursor` -ыг МАШИН БҮРЭЭС ХУУЛЖ АВ: хуучин add-in нь тэдгээр файлыг таньдаггүй бөгөөд илгээгдээгүй мөр АЛГА болно. |
| **8.5 Хэсэгчилсэн миграц (файл дунд унав)** | `d1_migrations`-д мөр ҮҮСЭЭГҮЙ, гэвч зарим ALTER хэрэгжсэн байна. **Файлыг ЗАСАЖ БОЛОХГҮЙ.** ШИНЭ дугаартай, аль хэдийн үүссэн объектыг ОРХИГДУУЛСАН файл бич. `PRAGMA table_info` ба `pragma_index_list`-аар яг юу үүссэнийг ТОДОРХОЙЛ. |

**Rollback-ийн шалгуур (эдгээрийн АЛЬ НЭГ илэрвэл буцаа):**

- Инженерүүд «Revit зурахад цочирдох болсон» гэж мэдэгдэв, ба `Metrics.FlushLock`-ийн p95 нь өмнөх суурьтай харьцуулахад **2 дахин** өссөн;
- `changes\*.json` файлууд шинэчлэгдэхээ БОЛИВ (flush таймерын регресс) — `bim.compliance.mode='off'` тавьж, C#-ыг буцаа;
- «Хугацаа дууслаа (30s) — өмнөх үйлдэл дуусаагүй байна» гэсэн мессеж хэрэглэгчийн эхлүүлсэн үйлдэл дээр гарч эхлэв (COLD-ийн `Gate` өрсөлдөөн);
- Revit хаагдахдаа 5 секундээс удаж, хүмүүс хүчээр таслав;
- `dropped_count` нь сессийн үйл явдлын **10%**-иас давав (дараалал хэт жижиг эсвэл backoff буруу).

⚠️ Эхний гурвыг **`bim.compliance.mode = 'off'` гэсэн НЭГ `UPDATE`-ээр** deploy-гүйгээр саармагжуулж болно. C#-ыг буцаах нь ХАМГИЙН СҮҮЛИЙН арга — ~20 компьютерийн гар ажиллагаа.

---

## 9. ЭХЛЭХИЙН ӨМНӨ ТОДРУУЛАХ

> Эдгээрийг репогоос ХАРИУЛАХ БОЛОМЖГҮЙ — эзэн эсвэл продакшны асуулга шаардана.

### 9.1 Продакшны асуулга шаардлагатай (эхлэхээс өмнө НЭГ УДАА)

```bash
# a) 0212-0216 ҮНЭХЭЭР хэрэгжсэн үү?  Хэрэв ҮГҮЙ бол add-in өнөөдөр
#    `addin_version` ба `timing_json`-ыг БАЙХГҮЙ багана руу бичиж байна.
npx wrangler d1 execute mgl-progress-db-v3 --remote --config wrangler.toml \
  --command "SELECT name FROM d1_migrations ORDER BY id DESC LIMIT 20"

# b) `bim_sessions` хэдэн мөртэй вэ?  ТЭГ гэж хүлээж байна (үйлдвэрлэгч байхгүй).
#    Тэг БИШ бол хэн нэгэн аль хэдийн бичиж эхэлсэн — эзнээс асуу.
npx wrangler d1 execute mgl-progress-db-v3 --remote --config wrangler.toml \
  --command "SELECT COUNT(*) AS sessions, COALESCE(SUM(dropped_count),0) AS dropped FROM bim_sessions"

# c) Амьд багийн бүртгэл.  ⚠️ РОСТЕР нь ШИЙДЭГДСЭН — ЭЗЭН БАТАЛСАН 2026-08-30:
#    дүрмийн багц авах салбарын баг нь ЯГ НАЙМ (BA · BB · HAS · TSBU · TSAH ·
#    HD · AU · IZ, v2 §46), MGMT · EZ · GT нь багц АВАХГҮЙ.  Диск дээрх `teams`
#    нь 11 мөр хэвээр.  Тиймээс энэ асуулга нь одоо РОСТЕР БАТАЛГААЖУУЛАХ БИШ,
#    продакшнд НЭМЭЛТ код үүссэн эсэхийг л шалгана.
#    ⚠️ ДҮРМИЙН БАГЦГҮЙ КОД нь `UNCERTAIN` БИШ (2-1 §3.4).  Илрүүлэлт
#    АМЖИЛТТАЙ болсон: `bim_sessions.team_code` нь БОДИТ код (MGMT / EZ / GT),
#    `team_source` нь шатлалын бодит эх сурвалж, `team_confidence` нь бодит
#    утга, `learning_events` нь ТЭР кодоор ШОШГОЛОГДОНО (v2 §72 — цуглуулсан
#    мөр бүр багаар тамгалагдсан байх ЁСТОЙ; шошгыг null болговол сургалтын
#    корпус баггүй үлдэж, MGMT/EZ/GT-д багц бичих өдөр эхлэлийн өгөгдөл
#    АЛГА болно), чип нь «Баг: EZ (дүрмийн багцгүй)» гэж бичнэ, хэрэглэгчээс
#    ЮУ Ч АСУУХГҮЙ — баг аль хэдийн ЗӨВ.  ЗӨВХӨН нийцлийн үнэлгээ алгасагдана
#    (`complianceEnabled → false`).
#    `UNCERTAIN` нь ӨӨР төлөв: илрүүлэлт БҮТЭЛГҮЙТСЭН — `team_code = NULL`,
#    `team_source = uncertain`, `team_confidence = 0.0`, шошго null, чип нь
#    «Баг: тодорхойгүй», хэрэглэгчээс засварыг ГУЙНА.
#    ХОЁУЛАНГИЙНХ нь хувьд ӨӨР БАГИЙН дүрэм ОРЛУУЛЖ хэрэглэгдэхгүй: багцгүй
#    бол ШАЛГАЛТГҮЙ, орлуулах шалгалт БИШ (v2 §48).
#    ⚠️ Багийн бодит ГИШҮҮНИЙ ТОО нь Cloudflare алдаа 7403-аас болж
#    ЭНЭ МАШИНААС БАТАЛГААЖААГҮЙ хэвээр.
npx wrangler d1 execute mgl-progress-db-v3 --remote --config wrangler.toml \
  --command "SELECT code, name_mn, sort_order FROM teams ORDER BY sort_order"

# d) `assistant_logs.timing_json`-д БОДИТ хэмжилт байгаа юу?  Байвал энэ нь
#    латентын ЦОРЫН ГАНЦ жинхэнэ суурь.
npx wrangler d1 execute mgl-progress-db-v3 --remote --config wrangler.toml \
  --command "SELECT COUNT(*) AS n, MIN(t_total_ms) AS lo, MAX(t_total_ms) AS hi FROM assistant_logs WHERE t_total_ms IS NOT NULL"
```

### 9.2 Хэмжигдээгүй — ХЭН Ч ТООЛООГҮЙ

| # | Асуулт | Яагаад чухал | Хэрхэн олох |
|---|---|---|---|
| 1 | **Нэг инженер өдөрт хэдэн Revit гүйлгээ хийдэг вэ?** | 1B-1 §9 нь 40-200-г ИЛ ТААМАГ гэж бичсэн. `settle_ms=1200`, `max_defer_ms=15000`, `raw_ring_max=4000`, `emit_batch_max=100` — ДӨРВҮҮЛЭЭ энэ тооноос хамаарна | Нэг ажилтны компьютерт нэг өдөр add-in ажиллуулаад `%APPDATA%\RevitMcpAddin\timing.log`-ийг унш |
| 2 | **`OnDocumentChanged`-ийн бодит p95 хэд вэ?** | §3.14-ийн «2 мс» нь PROVISIONAL, ХЭМЖИГДСЭН МӨР ТЭГ. §30 нь эхлээд хэмжихийг ШААРДДАГ | `Metrics.DocChanged` — гэхдээ 1/64 түүвэр |
| 3 | **1/64 түүвэр хангалттай юу?** | Ховор оргил (4.9 GB загварын дээр 800 мс-ийн гүйлгээ) статистикаар ҮЛ ҮЗЭГДЭНЭ. §82-ын bounded-resource шалгуурыг НОТЛОХ БОЛОМЖГҮЙ | Эзний шийдвэр: түүврийг нягтруулах уу, эсвэл хямд `max`-тракер нэмэх үү (`ChangeTracker.cs:369`) |
| 4 | **`FlushDirty`-ийн түгжээ бодитоор хэдэн мс барьдаг вэ?** | Энэ бол add-in-ы ЦОРЫН ГАНЦ бодит блоклолт (`:523-527`). Бүх R7 маргаан үүнээс эхэлнэ | `Metrics.FlushLock` — түүвэрлэгдээгүй, шууд уншина |
| 5 | **`%APPDATA%` нь roaming уу?** | Тийм бол `bim-events.jsonl`-ийн бичилт бүр СҮЛЖЭЭНИЙ I/O. Илгээгч арын thread дээр тул хор багатай, гэвч файлын хэмжээний хязгаар (2 MB) дахин авч үзэх шаардлагатай | Компьютер дээр `echo %APPDATA%` ба group policy шалга |

### 9.3 Эзний шийдвэр — инженерийн БИШ

| # | Асуулт | Яагаад чухал | Юуг өөрчлөх вэ |
|---|---|---|---|
| 6 | **Релиз N-д PUSH байх уу, ЗӨВХӨН PULL уу?** | §3.16-ийн урьдчилсан нөхцөл (`volatile Nudges.Ctx` агшин) хангагдахгүй бол PUSH нь N+1 рүү хойшилно. Эзний R2/R6 хэл («immediately states») нь идэвхтэй мэдэгдэл шаардаж байгаа мэт уншигдана | Ribbon-ийн caption дээрх тоог хангалттай гэж үзвэл N нь PULL-only. Үгүй бол `Nudges`-ийн жолоодогч + `Ctx` агшин НЭМЭГДЭНЭ |
| 7 | **Revit гүйлгээнээс илрүүлэлт хүртэлх ХҮЛЭЭН ЗӨВШӨӨРӨХ хугацаа хэд вэ?** | Энэ загварын БҮТЭЦЧИЛСЭН доод хязгаар нь ~4 секунд (3 с debounce + 50 мс bus poll + гүйцэтгэлт). `Gate.Wait(0)` алгасалт ба defer-хаалт нь завгүй машин дээр түүнийг АРАВ ХЭДЭН секунд болгож ЗОРИУД сунгана | Хэрэв «шууд» шаардлагатай бол архитектур нь ӨӨРЧЛӨГДӨНӨ (Idling-д суух, эсвэл дүрмийг HOT дээр гүйцэтгэх) — хоёулаа R7-г эрсдэлд оруулна |
| 8 | **Шөнийн БҮТЭН ТӨСЛИЙН сканнер хэрэгтэй юү, аль машин дээр?** | `BatchQto` нь бэлэн, хараа хяналтгүй хост өгдөг. Релиз N нь тэнд compliance-ыг ЗОРИУД унтраасан (§3.13). Асуудал нь ХАРЬЯАЛАЛ: чиг үүрэг хэний нэрээр бичигдэх вэ | Асаах нь §52-ын сканнер + тусдаа харьяаллын загвар шаардана |
| 9 | **Ажилтны мэдэгдэл ба гэрээ ШИНЭЧЛЭГДСЭН ҮҮ?** | Commit `9fe82a0` нь 0195-ийн «геометр, файлын агуулга цуглуулахгүй» амлалт ЦУЦЛАГДСАН гэж, «Ажилтны мэдэгдэл, гэрээ ЗААВАЛ шинэчлэгдэнэ» гэж бичсэн. `bim.capture.notice_version` нь ИРЭЭДҮЙН огноо (`2026-09-01`, 0208:38). `RawRing` нь гүйлгээ тутам түүвэрлэсэн element id НЭМЖ байна | Мэдэгдэл шинэчлэгдээгүй бол илгээгч ТАРААГДАХГҮЙ. Энэ бол релизийн УРЬДЧИЛСАН НӨХЦӨЛ, тохь тух БИШ |
| 10 | **`dropped_count` хэдэн хувь болоход АНХААРУУЛГА өгөх вэ?** | «Юу ч болоогүй» ба «алдсан» хоёрыг ялгах цорын ганц тоо (0202:99) | Босго нь 2-7-ын бэлэн байдлын хаалганд орно |

### 9.4 Техникийн — БАТЛАГДААГҮЙ, ТААМАГ гэж тэмдэглэв

| # | Зүйл | Төлөв |
|---|---|---|
| 11 | 0226/0227/0228/0230 дугаар СУЛ эсэх | **ТААМАГ.** 2026-08-30-нд `tail -5` нь 0216-г үзүүлсэн, гэвч Track 2-ын бусад баримт дугаарыг ЗЭРЭГ шаардаж байна. §3.0-ийн дагуу дахин батал |
| 12 | Продакшны D1 дээрх `bim_sessions`-ийн ОДООГИЙН баганын тоо | **ТААМАГ (27 + 2-1-ийн 4).** Cloudflare API 7403 алдаанаас болж энэ машинаас шалгагдаагүй. `PRAGMA table_info`-оор батал |
| 13 | `settle_ms = 1200` нь Revit-ийн regenerate-тэй командын дуусалтаас ИХ эсэх | **ТААМАГ.** Хэмжигдээгүй. Хэт бага бол хагас дууссан командын дунд олонлог хаагдана |
| 14 | Roaming `%APPDATA%` дээр `AppendAllText`-ийн бодит латент | **ТААМАГ.** `AssistantLog.cs:389-390` нь асуудал байдгийг хэлдэг ч тоо өгөөгүй |
| 15 | `RevitToolBus.CancelAll()` нь `ExternalEvent`-ийг Dispose ХИЙХГҮЙГЭЭР waiter-үүдийг сулласнаар Revit-ийн хаагдалт хурдасна эсэх | **ТААМАГ.** Логикоор зөв (`App.cs:167-183`-ийн тайлбартай нийцнэ), гэвч ажиллаж байгаа Revit дээр ХЭМЖИГДЭЭГҮЙ |
| 16 | Хоёр Revit нэг `%APPDATA%`-г хуваалцах үед `.tmp` мөргөлдөөн бодитоор тохиолддог эсэх | **ТААМАГ.** `PathFor` детерминист гэдэг нь батлагдсан; бодит мөргөлдөөнийг хэн ч ажиглаж бүртгээгүй |

### Хавсралт — энэ баримт зөрүүг ХААНА ОЛСОН БЭ

| Зөрүү | Дэлгэрэнгүй |
|---|---|
| v2 §31 vs §54 | Нэг хилийн ХОЁР нэр (`FAST PATH`/`AI PATH` vs `HOT`/`BACKGROUND`). Track 2 нь §54-ийг сонгосон, учир нь шипсэн монгол тайлбарууд аль хэдийн «халуун зам» гэж бичсэн (`ChangeTracker.cs:775`, `RevitToolBus.cs:442`) |
| v2 §55-R3 vs шипсэн код | «preserve the ORIGINAL event history» нь одоогийн бүтцээр ХАНГАГДАХГҮЙ — олонлогийн алгебр нь ЗОРИУД алдагдалтай (`:849`, `:206`, `:182`). `RawRing` нь ЯГ ЭНЭ зөрүүг хаана |
| v2 §76 vs `Nudges` | Төсөв нь бүрэн бичигдсэн боловч ХЭЗЭЭ Ч дуудагдаагүй (нэг ч дуудагч, зөвхөн `ChangeTracker.cs:402`-ийн тайлбар). §76 нь архитектурын хувьд шийдэгдсэн, ҮЙЛДЛИЙН хувьд ТЭГ |
| v2 §30 vs «250 мс» | §30 нь нэгдсэн 250 мс-ийг ШУУД хориглосон (:994-996). Энэ баримтын БҮХ төсөв PROVISIONAL, ХЭМЖИГДСЭН МӨР ТЭГ |
| Context pack-ийн дугаарын хуваарилалт vs энэ баримтын файлын жагсаалт | Context pack-ийн 2-р хувилбар нь 2-4-т 0232-0236-г оноосон; энэ баримтын даалгаварын файлын жагсаалт нь 0226-0228 гэж заасан. Энэ баримт нь ФАЙЛЫН ЖАГСААЛТЫГ дагасан (одоо 0226-0228 + **0230**) ба §3.0-д зөрчлийн шалгалтыг ЗААВАЛ болгосон. Ах дүү баримтуудын бодит жагсаалт: 2-1 → 0217-0219 · 2-2 → 0220-0223 · 2-3 → 0224, 0225, 0229 · 2-5 → 0237 · 2-6 → 0238-0240 · 2-8 → 0241-0242, тиймээс **0231-0236 сул** ба мөргөлдөөн БАЙХГҮЙ. **Хэрэгжүүлэгч эхлэхийн өмнө дахин батална** |
| `bim.compliance.authority_level` / `rollout_pct`-ыг ХЭН Ч ҮҮСГЭДЭГГҮЙ БАЙВ | 0228 нь ЯГ 8 statement, толгойд нь «ЕС ДЭХ дугуй нь ШИНЭ ФАЙЛ» гэж бичсэн; гэтэл `2-5` §3.1 нь `authority_level`-ийг УНШдаг, `2-0` §3.2-ийн релизийн төлөвлөгөө түүнийг `UPDATE` хийдэг, `2-8` нь `addin_installs.authority_level`-ыг ЭНДЭЭС хүлээдэг. **ЭНЭ ЗАСВАР 0230-ийг НЭМСЭН.** ⚠️ `2-5`-ийн §9 №4 нь «2-4-ийн 0235» гэж, `2-0` нь дугааргүй иш татсан хэвээр — ТЭР ХОЁР МӨРИЙГ `0230`-ээр ЗАСНА |
| `backend/src/routes/compliance.ts`-ыг ГУРВАН баримт (2-2, 2-3, 2-4) «ШИНЭ» гэж зарлаж байв | 2-2 ба 2-4 нь ИЖИЛ долгионд (wave 1). Энэ засвар: **2-2 нь ЦОРЫН ГАНЦ үүсгэгч**, 2-4 нь handler НЭМНЭ, `index.ts`/`modules.ts` нь 2-4-ийн харьяанаас ХАСАГДСАН. `2-3`-ийн :7 мөрийг МӨН ижилхэн засах шаардлагатай |
| `RevitToolBus.TryCall` / `UserBusy` / `CancelAll` -ыг ХЭН Ч БИЧИХ ЭРХГҮЙ БАЙВ | `grep -rn "TryCall\|UserBusy\|CancelAll" revit-mcp/addin/*.cs` → ТЭГ мөр, гэтэл `revit-mcp/addin/RevitToolBus.cs` нь Track 2-ын НЭГ Ч баримтын «Хөндөх файлууд»-д БАЙГААГҮЙ. **Энэ засвар түүнийг 2-4-т нэмж, §3.12.a-д гэрээг бичсэн.** Үгүй бол 2-3 ЗОГСОНО, эсвэл агент хамрах хүрээгээ ЧИМЭЭГҮЙ зөрчинө |
| `AppendRaw`-ийн `addedN` / `_sampleBuf` / `_ringDrainedSeq` нь ОРШИН БАЙГААГҮЙ | Тайлбар нь «гурван давталт аль хэдийн тоолсон» гэж БАТАЛЖ байсан ч `grep` нь ТЭГ мөр өгсөн; `_sampleBuf` нь хэзээ ч бичигдэхгүй тул бичлэг бүр ӨМНӨХ гүйлгээний id-г заах байв. **Энэ засвар гурван давталтын бодит diff-ийг нэмж, халуун замын ҮНЭН төлбөрийг бичсэн** |
| `RawRing`-д УНШИГЧИЙН API байгаагүй | `_ring` ба `_sampleBuf` нь `private static`, `_ringDrainedSeq` хэзээ ч урагшилдаггүй байв — 2-3 нь СЭРЭХ ба тоо харах боловч НЭГ Ч бичлэг уншиж чадахгүй, алдагдлын тооцоо ажиллахгүй. **`TryDrain` нэмэгдсэн** |
