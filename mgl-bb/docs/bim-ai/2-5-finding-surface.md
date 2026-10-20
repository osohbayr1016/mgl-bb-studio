# 2-5-finding-surface — нотолгоонд суурилсан илэрхийлэл, үндсэн шалтгааны граф, өгөгдөл эвдэхгүй хүчингүй болголт, эрхийн түвшин

> **Track:** 2 · FINDING SURFACE (эзний R2/R5/R6-ийн ХАРАГДАХ тал)
> **v2 хэсэг:** §65 (нотолгооны түвшин), §68 (гар хүчингүй болголт), §77 (үндсэн шалтгааны граф), §80 (үйлдвэрлэлийн эрхийн түвшин) · дам: §67 (хүнд байдлын эрэмбэ), §76-R3 (бүлэглэлт), §69-R3 (гэрчилгээ БИШ), §53/§84 (тасалдалгүй)
> **Хамаарал (depends on):** `2-3-compliance-engine` — `compliance_findings`, `finding_elements`, `finding_teams`, `finding_edges`, `rule_run_ledger` ба `backend/src/routes/compliance.ts`-ийн МОУНТ нь тэнд үүснэ; `2-2-rule-model` — `rules.verification_state` заалт (clause) хавсаргалт ба UNVERIFIED хавчаар; `2-4-nonblocking-runtime` — `FindingFeed`-ийн төсөв, `set_compliance_badge` COLD хэрэгсэл, `ComplianceScheduler`-ийн урсгал.
> **Блоклож буй (blocks):** `2-6-team-training` — хүчингүй болголт нь `review_state IN ('reviewed','verified')` давсны ДАРАА л сургалтын өгөгдөл болно (§68-R4); `2-7-readiness-and-quality` — худал дохионы хэмжүүр нь `finding_overrides.override_kind = 'FALSE_POSITIVE'`-ыг уншина (§66).
> **Хөндөх файлууд:** `backend/migrations/0237_finding_overrides.sql` (ШИНЭ), `backend/src/lib/complianceModel.ts`, `backend/src/routes/compliance.ts`, `revit-mcp/addin/FindingFeed.cs` (ШИНЭ), `revit-mcp/addin/Nudges.cs` (ЗӨВХӨН тайлбар), `revit-mcp/addin/AssistantPane.xaml`, `revit-mcp/addin/AssistantPane.xaml.cs`, `frontend/src/features/revit-assistant/AssistantCurationPage.tsx`, `frontend/src/features/revit-assistant/components/OverridesTab.tsx` (ШИНЭ), `frontend/src/shared/lib/search/sections.ts`, `frontend/src/shared/i18n/mn.json`, `frontend/src/shared/i18n/en.json`, `revit-mcp/training/check_findingfeed.py` (ШИНЭ). **ӨӨР ФАЙЛ БАЙХГҮЙ.**
> **Deploy тоо:** 3 (1 × `d1 migrations apply` → 1 × `wrangler deploy` → 1 × `pages deploy`). Migration 1 (0237). Add-in (C#) нь ТУСДАА deploy БИШ — Track 2-ийн НЭГ релизэд багцлагдана. Frontend-д шинэ түлхүүр `mn.json` БА `en.json` ХОЁУЛАНД нэмэгдэнэ.

---

## 0. ЭНЭ СЕССИЙН ДҮРЭМ

**Хамрах хүрээ (scope).** Энэ сесс нь дүгнэлтийг инженер ХЭРХЭН ХАРАХ, түүнтэй санал НИЙЛЭХГҮЙ бол ЮУ БОЛОХ хоёрыг л шийднэ. Дүрмийн хөдөлгүүр (`2-2`), дүгнэлтийн хүснэгт (`2-3`), хуваарилагч ба төсөв (`2-4`) нь энэ сессийн ажил БИШ — тэднийг ХЭРЭГЛЭНЭ, ХӨНДӨХГҮЙ.

**Бусад агентуудтай зэрэг ажиллаж байна.** Ажлын мод дээр өөр агентын дуусаагүй, магадгүй КОМПИЛЯЦ ХИЙГДЭХГҮЙ өөрчлөлт байж болно. `npm run build` унасан нь автоматаар таных БИШ — алдаа өөрийн хөндсөн файлууд дээр байгаа эсэхийг шалгаад, бусдыг нь эзэнд мэдэгд.

**Deploy хийж болох уу?** Тийм, гэхдээ ДАРААЛАЛТАЙГААР: migration → worker → pages. C# кодыг ЭНЭ СЕССЭД deploy ХИЙХГҮЙ — Track 2-ийн бүх C# өөрчлөлт НЭГ релизэд гарна.

**ЭНЭ СЕССИД ХЭЗЭЭ Ч ХИЙЖ БОЛОХГҮЙ:**

| ⛔ | Дүрэм | Зөрчсөн үеийн БОДИТ үр дагавар |
|---|---|---|
| 1 | `/api/*` дээр `purpose === 'mcp'` токеныг ХЭЗЭЭ Ч татгалзахгүй | Add-in бүх REST дуудлагаа тэр токеноор гарын үсэг зурдаг, refresh урсгал БАЙХГҮЙ. ~20 PC, `Install.bat`, Revit хаалттай — алсаас БУЦААХ БОЛОМЖГҮЙ ГАНЦ өөрчлөлт. Бэхлээстэй: `middleware/auth.ts:101-102`, `types.ts:209-212`, `lib/tokenValidity.ts:30-34` |
| 2 | `users` (19 каскад хүүхэд) ба `projects` (33) -ыг `migrations apply`-аар ХЭЗЭЭ Ч дахин барихгүй | `migrations apply` нь файл бүрийг гүйлгээнд ороодог ба тэнд каскад АЖИЛЛАНА — эцгийг унагахад хүүхдийн бүх мөр устана |
| 3 | Migration нь ЗӨВХӨН нэмэгдэнэ. Бичихийн ӨМНӨ `ls backend/migrations \| tail -5` | Хэрэгжсэн файлыг засах нь продакшн дээр ЧИМЭЭГҮЙ NO-OP — тестэд ногоон, продакшнд байхгүй |
| 4 | Trigger дотор `END;` том үсгээр, ӨӨРИЙН МӨРӨНД | wrangler-ийн салгагчийн regex нь том/жижиг үсэг ЯЛГАНА. Буруу бол файл ХАГАС хэрэгжиж, `d1_migrations` мөр БИЧИГДЭХГҮЙ — цорын ганц засвар нь ШИНЭ дугаар |
| 5 | Инференс нь итгэмжлэгдсэн замд ХЭЗЭЭ Ч байхгүй — `RevitToolEventHandler.Execute`, `ChangeTracker.OnDocumentChanged`, keyword/model салаа | ⛔ гэрээ нь `RevitToolBus.cs:442-454`, `ChangeTracker.cs:769-775`-д бичээстэй. Зөвшөөрөгдсөн ГАНЦ оёдол нь `AssistantPane`-ийн `DecidedBy.Fallback` арын thread |
| 6 | `DocumentChanged` дотор баримт нь УНШИХ ЗОРИУЛАЛТТАЙ — гүйлгээ, `Regenerate()`, ДИСК БИЧИЛТ, сүлжээ БАЙХГҮЙ | Түүнийг орлуулсан сканнер 120+ секунд авдаг байсан (`ChangeTracker.cs:764-775`) |
| 7 | `ChangeTracker.Gate`-ийг хэрэгслийн автобусны дуудлага, диск бичилт, `await`-аар ДАМЖУУЛЖ БАРИХГҮЙ | `OnDocumentChanged` нь гүйлгээ бүр дээр Revit-ийн үндсэн thread дээр `lock (Gate)` авдаг (`ChangeTracker.cs:800`) — барьж байхад хэрэглэгчийн дараагийн чирэлт бүтэн хугацаагаар гацна |
| 8 | `DockablePane.Show()`-ыг ХЭЗЭЭ Ч кодоос дуудахгүй | Add-in дахь ЦОРЫН ГАНЦ `Show()` нь хэрэглэгчийн өөрийнх нь ribbon товч (`AssistantPaneProvider.cs:54`). Автоматаар нээх нь файл нээх бүрд ~300 px ба фокусыг хулгайлна — R7-ийн хамгийн магадлалтай регресс |
| 9 | `Gate` барих боломжтой thread-ээс `Dispatcher.Invoke` ХЭЗЭЭ Ч хийхгүй | UI thread нь өөрөө `lock (Gate)` дотор блоклогдож болно; түүн рүү marshal хийх нь хоёр thread-ийн deadlock — хэрэглэгчид Revit гацсан мэт харагдана |
| 10 | Бүх C# өөрчлөлт НЭГ релизэд. «Дараагийн релизэд» гэж хойшлуулахгүй | Авто-шинэчлэл БАЙХГҮЙ, ~20 PC, `Install.bat`, Revit хаалттай. Хагас бэлэн релизийг БҮХЭЛД нь хойшлуулна |
| 11 | Салбарын багц нь `teams.code`-оос АЖИЛЛАХ ҮЕДЭЭ уншигдана. 7, 8, 9, 11 гэж ХАТУУ БИЧИХГҮЙ | **ЭЗЭН БАТАЛСАН 2026-08-30:** дүрмийн багц авах салбарын баг нь ЯГ НАЙМ — BA · BB · HAS · TSBU · TSAH · HD · AU · IZ (v2 §46), **MGMT · EZ · GT нь багц АВАХГҮЙ**. Диск дээрх `teams` нь 11 мөр хэвээр. Тэр найм нь ТӨЛӨВЛӨЛТИЙН тоо (хэдэн багц бичих вэ), кодод бичих ЛИТЕРАЛ БИШ. ⚠️ **Багцгүй код нь `TEAM = UNCERTAIN` БИШ** (залруулга 2026-08-30): илрүүлэлт АМЖИЛТТАЙ болсон, `team_code` нь бодит код хэвээр, зөвхөн нийцлийн шалгалт алгасагдана — `2-1` §3.4-ийн «ДҮРМИЙН БАГЦГҮЙ БАГ» харьцуулах хүснэгт. Багцгүй багийг ӨӨР БАГИЙН дүрмээр шалгах нь ХОРИОТОЙ (v2 §48-R6) (§9-1) |
| 12 | Өөр агентын хадгалаагүй ажлыг ХЭЗЭЭ Ч хөндөхгүй. `git restore` / `checkout --` / `stash` / `reset` / `git add -A` БАЙХГҮЙ | Тэдний ажил чимээгүй устана |

**Энэ сессийн НЭМЭЛТ хориглолт** (§4-т дэлгэрэнгүй): авто-`Show()`, авто-`Focus()`, дэвсгэр ажилд `SetBusy`, ЭРЭМБЭЛЭХЭЭС ӨМНӨ таслах, ХОЁР ДАХЬ хянах хуудас, UI дээр «баталгаажлаа» гэсэн үг.

---

## 1. КОНТЕКСТ

### Систем (хүйтэн сессид хангалттай хэмжээгээр)

| Хэсэг | Юу вэ |
|---|---|
| Backend | Cloudflare Worker — `@cloudflare/workers-oauth-provider` дотор Hono. D1 + R2 + KV + нэг Durable Object + Workers AI |
| Frontend | Vite + React 19 SPA, Cloudflare Pages төсөл `mgl-design-system` |
| Add-in | `revit-mcp/addin/` — 46 `.cs` файл, C# тест ТЭГ, авто-шинэчлэл БАЙХГҮЙ, ~20 ажилтны PC дээр `Install.bat`-аар суудаг |
| Хэрэглэгч | ~49 мэдлэгийн ажилтан, 8 салбарын баг + MGMT (миграцийн үрээр; 0074-өөр EZ, GT нэмэгдэж `teams` нь 11 мөр). Дүрмийн багц авах **найман** салбар — ЭЗЭН БАТАЛСАН 2026-08-30, v2 §46 |
| Migration | Дискэн дээрх хамгийн өндөр нь `0216_assistant_log_timing.sql`, нийт 206 файл (2026-08-30) |

### Платформын хатуу хязгаарууд (энэ даалгаварт хамаарах хэсэг)

- D1-ийн нэг мэдэгдэлд **100 bind**. `finding_overrides` нь BIM-ийн нэмэгдэх-л хүснэгтүүдийн нэг БИШ тул `bimEvents.ts`-ийн bind тооцоонд НӨЛӨӨЛӨХГҮЙ — гэхдээ `check-bim-events.mjs`-ийг ямар ч тохиолдолд дахин ажиллуулна.
- `migrations apply` нь файлыг `d1_migrations` INSERT-тэй хамт НЭГ `--command` болгож нийлүүлдэг. Салгагч нь `/* */` блок тайлбарыг ойлгодоггүй, мөр дотор `;`-ээр таслана, нэг дуудлагад хэт олон мэдэгдэл байвал унана. **Файл бүр ≤ 7 ӨӨРИЙН мэдэгдэл**, мэдэгдэл бүр `IF NOT EXISTS`.
- WPF-ийн `Mouse.OverrideCursor` нь **апп даяар** үйлчилнэ — Revit-ийн бүх цонхонд.
- `DockablePane` нь `RegisterDockablePane`-ээр ЗӨВХӨН `OnStartup` дотор бүртгэгдэнэ; дараа нь `GetDockablePane(id)`-ээр хэдэн ч удаа нээгдэнэ (`AssistantPaneProvider.cs:9-15`).

### Яагаад энэ даалгавар байна вэ

1. **Дүгнэлтийг харуулах гадаргуу БАЙХГҮЙ.** `AssistantPane.xaml` нь ажил / чеклист / өөрчлөлт / чат / ноорог / санал / санал асуулга самбартай — хүнд байдал, дүрмийн лавлагаа, нотолгооны холбоос, хүчингүй болгох товч НЭГ Ч БАЙХГҮЙ.
2. **Итгэлийн таксономи ГУРАВ байгаа бөгөөд тэд ЗӨРЧИЖ байна** (§2.7). `evidence_level` нь ДӨРӨВ дэх тэнхлэг ба өөрийн баганатай байх ЁСТОЙ.
3. **Хүчингүй болголтын бүртгэл БАЙХГҮЙ.** §68-ийн долоон элементийн гинжийг (дүгнэлт → хүчингүй болголт → хэн → хэзээ → шалтгаан → нотолгоо → дүрэм/загварын хувилбар) хадгалах хүснэгт репод алга.
4. **Үндсэн шалтгааны УНШИХ тал байхгүй.** `finding_edges` нь `2-3`-д үүснэ; түүнийг «нэг үндсэн + N дагавар» болгож харуулах код хаана ч алга.
5. **Эрхийн түвшин тодорхойлогдоогүй.** `assistant_models.eval_passed` нь ГАНЦ boolean (`0213:44`) — §80-R3-ийн «түвшин бүрд ТУСДАА хаалга»-г илэрхийлж ЧАДАХГҮЙ.
6. **`Nudges` нэг ч удаа ажиллаж байгаагүй** (§2.8) — тиймээс «сануулга руу шууд залгачихъя» гэсэн хамгийн ойлгомжтой шийдэл нь бодит биш.

---

## 2. БАТАЛГААЖСАН ОДООГИЙН ЗАН ТӨЛӨВ

> Доорх `file:line` бүрийг энэ сесс өөрөө нээж баталгаажуулав (**2026-08-30**, commit `6a8e4f5`).

### 2.1 Add-in дахь ЦОРЫН ГАНЦ `pane.Show()` нь хэрэглэгчийн ribbon товч — БАТЛАГДСАН

```
AssistantPaneProvider.cs:20     public static readonly Guid PaneGuid = new Guid("6f1a2c74-9d43-4b1e-9a7c-2f5b0a91cc10");
AssistantPaneProvider.cs:27     public static AssistantPane View => _view ?? (_view = new AssistantPane());
AssistantPaneProvider.cs:39     /// <summary>«MGL туслах» товч — самбарыг нээж, идэвхжүүлнэ.</summary>
AssistantPaneProvider.cs:41     public class AssistantPaneCommand : IExternalCommand
AssistantPaneProvider.cs:54                 pane.Show();
```

`grep -n "pane.Show()" revit-mcp/addin/*.cs` → **ганц мөр**, `AssistantPaneProvider.cs:54`, `IExternalCommand.Execute` дотор. Түүнийг дуудах цорын ганц зам нь `App.cs:378`-ийн `MglAssistantPane` ribbon товч.

⚠️ **Энэ бол §53 ба §84-ийн КОД ХЭЛБЭР.** Самбар нь `:27`-д ЗАЛХУУ singleton — хаагдаад дахин нээгдэхэд төлөв нь үлддэг. Өөрөөр хэлбэл **арын thread нь самбар ХААЛТТАЙ байхад ч түүний цуглуулга руу мөр нэмж чадна, юу ч хулгайлахгүй.** Тасалдалгүй гадаргуу нь ӨНӨӨДӨР боломжтой — зөвхөн хэн ч түүнийг ашиглаагүй байна.

### 2.2 Add-in дахь ЦОРЫН ГАНЦ `Focus()` нь 👎-ийн ДАРАА — БАТЛАГДСАН

```
AssistantPane.xaml.cs:1843     private void ThumbDown_Click(object sender, RoutedEventArgs e)
AssistantPane.xaml.cs:1871         FeedbackPanel.Visibility = Visibility.Visible;
AssistantPane.xaml.cs:1872         FeedbackNoteRow.Visibility = Visibility.Visible;
AssistantPane.xaml.cs:1874         FeedbackNoteBox.Focus();
```

Фокус нь ЗӨВХӨН хүн 👎 дарсны дараа шилжинэ — өөрөөр хэлбэл **хүн өөрөө бичихээр шийдсэн үед**. Ямар ч автомат урсгал фокус авдаггүй.

### 2.3 `SetBusy` нь курсорыг АПП ДАЯАР солино — БАТЛАГДСАН

```
AssistantPane.xaml.cs:341     private void SetBusy(bool busy, string what = null)
AssistantPane.xaml.cs:343         _busy = busy;
AssistantPane.xaml.cs:344         RefreshBtn.IsEnabled = !busy;
AssistantPane.xaml.cs:345         SendBtn.IsEnabled = !busy;
AssistantPane.xaml.cs:351         Mouse.OverrideCursor = busy ? Cursors.AppStarting : null;
```

⚠️ `Mouse.OverrideCursor` нь WPF-д **процессын бүх цонхонд** үйлчилнэ. Дэвсгэрийн норм шалгалтыг `SetBusy`-аар дамжуулбал инженер юу ч блоклогдоогүй байхад Revit-ийн бүх талбар дээр «завгүй» курсор хараад **гацсан гэж ойлгоно** — §53-ийн шууд зөрчил, гэхдээ ямар ч thread үнэндээ саатаагүй.

### 2.4 Самбарын хоёр жагсаалт нь ВИРТУАЛЖУУЛААГҮЙ `ItemsControl` — БАТЛАГДСАН

```
AssistantPane.xaml:341                         <ScrollViewer VerticalScrollBarVisibility="Auto">
AssistantPane.xaml:342                             <ItemsControl x:Name="ChecklistBox" Margin="6,4">
AssistantPane.xaml:379                             <ScrollViewer VerticalScrollBarVisibility="Auto" MaxHeight="230">
AssistantPane.xaml:380                                 <ItemsControl x:Name="ChangesBox" Margin="4,0,4,5"
AssistantPane.xaml:396                     <ItemsControl x:Name="ChatList"
```

`ItemsControl` нь `VirtualizingStackPanel`-гүй тул **мөр бүр нэг удаа бүтээгдэж, бүгд санах ойд үлдэнэ**. Тоо хэмжээг ДЭЭД урсгалд хязгаарлах ёстой — WPF-ийн render дамжлага өөрөө гацал болно.

### 2.5 ЭРЭМБЭЛЭХЭЭС ӨМНӨ таслах нь ҮНЭН МЭТ ХУДЛЫГ гаргадаг — тэмдэглэгдсэн регресс

```
ChangeReport.cs:58     /// ⚠️ ЭНЭ НЬ ДЭЛГЭЦИЙН ХЯЗГААР БИШ.  Урьд нь 400 байсан ба `HashSet`-ийг
ChangeReport.cs:59     ///    дунд нь таслдаг байв — HashSet-ийн дараалал дурын учир хэрэглэгч
ChangeReport.cs:60     ///    «сүүлийн 400» БИШ, «санамсаргүй 400»-г хардаг байсан бөгөөд мөр бүр
ChangeReport.cs:61     ///    цагтай тул үнэн шиг харагддаг байв.  Тайлбарлах нь индексийн лавлагаа
ChangeReport.cs:62     ///    тул хямд — БҮГДИЙГ тайлбарлаад, ЭРЭМБЭЛСНИЙ ДАРАА л таслана.
ChangeReport.cs:64     private const int MaxItems = 5000;
ChangeReport.cs:67     private const int MaxItemsPerGroup = 60;
```

Зөв хэв маяг нь `:320-332`-т хэрэгжсэн:

```
ChangeReport.cs:320                 // Сүүлд хөндсөн нь ДЭЭР — хүн юун дээр дөнгөж сая ажилласнаа хайдаг.
ChangeReport.cs:321                 list.Sort((a, b) => b.at_sec.CompareTo(a.at_sec));
ChangeReport.cs:323                 int shown = Math.Min(list.Count, MaxItemsPerGroup);
ChangeReport.cs:331                     count = list.Count,
ChangeReport.cs:332                     more = list.Count - shown,
```

⚠️ **Дүгнэлтэд ЯГ ЭНЭ дүрэм үйлчилнэ**: эрэмбэлэх → таслах → таслагдсаныг ИЛ хэлэх (`more`). Зөрчилтэй загварын «санамсаргүй 40 зөрчил» нь өмнөх 400 мөрөөс ХАМААГҮЙ аюултай — учир нь инженер түүнийг БҮРЭН жагсаалт гэж үзээд үлдсэнийг нь засахгүй.

### 2.6 Элемент рүү үсрэх нь ИЛ ХЭРЭГЛЭГЧИЙН ҮЙЛДЭЛ ба цонх гаргадаггүй — БАТЛАГДСАН

```
ChangeReport.cs:39     ///   3. `ShowElements` ХЭЗЭЭ Ч ДУУДАХГҮЙ.  Элемент нээлттэй харагдацаас
ChangeReport.cs:40     ///      олдохгүй бол тэр нь модаль TaskDialog гаргаж, ExternalEvent-ийн
ChangeReport.cs:41     ///      боловсруулагч дотор Revit-ийн үндсэн thread-ийг хүн товч дарах
ChangeReport.cs:42     ///      хүртэл бүхэлд нь блоклодог
ChangeReport.cs:44     ///      харагдацыг сольж → сонгож → хүрээ рүү нь ойртуулна.  Гурвуулаа
ChangeReport.cs:45     ///      цонх гаргадаггүй.
ChangeReport.cs:558     public static string GotoElement(UIDocument uidoc, Document doc, JsonElement args)
ChangeReport.cs:565             if (el == null)
ChangeReport.cs:568                     "Энэ элемент загварт байхгүй болжээ — устгагдсан эсвэл буцаагдсан байна.");
RevitTools.cs:61             "goto_element",
RevitTools.cs:86                 case "goto_element": return ChangeReport.GotoElement(uidoc, doc, args);
```

Хэрэгсэл нь бэлэн. Дүгнэлтийн мөр дээр дарахад **шинэ хэрэгсэл БИЧИХГҮЙ** — `goto_element`-ыг `element_id`-тэй нь дуудна.

### 2.7 Итгэлийн ГУРВАН таксономи аль хэдийн байгаа бөгөөд тэд ЗӨРЧИЖ байна — БАТЛАГДСАН

| Тэнхлэг | Хаана | Утгууд | CHECK |
|---|---|---|---|
| `assistant_examples.source_type` | `0215_assistant_trust_taxonomy.sql:51-55` | `HUMAN`, `HUMAN_CORRECTED`, `HUMAN_VERIFIED`, `RULE_VERIFIED`, `SYNTHETIC`, `AI_GENERATED`, `IMPORTED`, `UNKNOWN` (8) | ТИЙМ, DB дээр |
| `assistant_examples.review_state` | `0215:59-61` | `pending`, `reviewed`, `verified`, `rejected` (4) | ТИЙМ, DB дээр |
| `learning_events.provenance` | `backend/src/lib/bimEvents.ts:245-252` | `UNVERIFIED`, `MACHINE_GENERATED`, `RULE_VERIFIED`, `HUMAN_VERIFIED`, `HUMAN_CORRECTED`, `REJECTED` (6) | **ҮГҮЙ** — `0205:145-149` дээр CHECK ЗОРИУД тавиагүй |
| v1 §19-ийн ойлголтын шошго | `REVIT_BIM_AI_Architecture_Freeze_v2.md:669-672` | `KNOWN`, `INFERRED`, `ASSUMED`, `UNKNOWN` (4) | Зөвхөн спекд |

**Нэрээрээ давхцаж буй нь ЗӨВХӨН `HUMAN_VERIFIED` ба `UNKNOWN`.** `HUMAN` / `SYNTHETIC` / `AI_GENERATED` / `IMPORTED` нь `provenance`-д ХОСГҮЙ; `UNVERIFIED` / `MACHINE_GENERATED` / `REJECTED` нь `source_type`-д ХОСГҮЙ.

Хөрвүүлэх функц репод БАЙХГҮЙ:

```bash
grep -rn "provenance" backend/src/routes/*.ts backend/src/lib/*.ts | grep -i "source_type"
```

Хүлээгдэх: **гаралт БАЙХГҮЙ** (2026-08-30-нд хэмжсэн).

⚠️ **Тиймээс §65-ийн таван нотолгооны түвшин нь ДӨРӨВ ДЭХ тэнхлэг ба ӨӨРИЙН баганатай байх ЁСТОЙ.** `source_type`-ыг дахин ашиглах нь шипсэн, CHECK-тэй баганыг гуйвуулна: `RULE_BACKED` гэсэн утга `0215:52-55`-ийн CHECK-д БАЙХГҮЙ тул `INSERT` нь «CHECK constraint failed» өгнө.

### 2.8 `Nudges` нь бүтээгдэхүүнд НЭГ Ч УДАА ажиллаж байгаагүй — БАТЛАГДСАН

```bash
grep -rn "Nudges\." revit-mcp/addin/*.cs
```

Хүлээгдэх: **гаралт БАЙХГҮЙ** (`Nudges.cs` өөрөө статик метод дуудахгүй; цорын ганц дурдалт нь `ChangeTracker.cs:402`-ийн ТАЙЛБАР).

```
Nudges.cs:23     /// ⚠️ ХАМГИЙН ЧУХАЛ НЬ ДҮРЭМ БИШ, ТӨСӨВ.  Ямар ч ухаалаг сануулга өдөрт
Nudges.cs:24     ///    8 удаа гарвал хүн add-in-ыг унтраана.  Тиймээс дүрэм ердөө ГУРАВ,
Nudges.cs:25     ///    нийт хязгаар нь ӨДӨРТ ХОЁР, хоорондоо 90 минут.
Nudges.cs:34     public const int MaxPerDay = 2;
Nudges.cs:36     public static readonly TimeSpan MinGap = TimeSpan.FromMinutes(90);
Nudges.cs:42     public static readonly TimeSpan QuietAfterTyping = TimeSpan.FromSeconds(90);
Nudges.cs:69     public bool Busy;              // хэрэгсэл ажиллаж байна
Nudges.cs:70     public bool AwaitingAnswer;    // хүнээс асуулт хүлээж байна
Nudges.cs:71     public bool Suppressed;        // sync / reload-latest явж байна
Nudges.cs:72     public bool WebConnected;      // вэб уншигдсан эсэх
Nudges.cs:73     public double SecondsSinceTyping;
Nudges.cs:119         if (s.SentToday >= MaxPerDay) return null;
Nudges.cs:120         if (c.Busy || c.AwaitingAnswer || c.Suppressed) return null;
```

⚠️ `Ctx`-ийн `Busy` / `AwaitingAnswer` / `SecondsSinceTyping` нь бүгд **WPF самбарын төлөв** — арын thread аюулгүй уншиж чадахгүй, харин §0-ийн 9 дэх хориглолт нь `Gate` барих thread-ээс `Dispatcher.Invoke` хийхийг хориглоно. **Тиймээс релиз N нь сануулга ХОЛБОХГҮЙ** ба `MaxPerDay`-г НЭМЭХГҮЙ.

### 2.9 Курацийн хуудас, гурван таб, хоёр URL конвенц аль хэдийн байгаа — БАТЛАГДСАН

```
AssistantCurationPage.tsx:46     const CURATION_TABS = ['pending', 'reviewed', 'examples'] as const;
AssistantCurationPage.tsx:51       const [tab, setTab] = useTabParam(CURATION_TABS, 'pending', 'tab');
AssistantCurationPage.tsx:54       const allowed = !!user && (user.role === 'admin' || user.role === 'senior');
AssistantCurationPage.tsx:70       <KeepAliveTabs value={tab} onValueChange={(v) => setTab(v as (typeof CURATION_TABS)[number])}>
AssistantCurationPage.tsx:78             <section id="sec-assistant-pending" className="scroll-mt-24">
routes.tsx:339                     <Route path="admin/assistant" element={<AssistantCurationPage />} />
sections.ts:571-575                { page: '/app/admin/assistant', to: '…?tab=pending', labelKey: 'assistantCuration.pendingTab', … }
```

```
AssistantCurationPage.tsx:43     /** Табны утгууд нь глобал хайлтын гүн холбоосын бай (`?tab=…`) —
AssistantCurationPage.tsx:44      *  `shared/lib/search/sections.ts` эдгээрийг давхар тусгасан тул нэрийг
AssistantCurationPage.tsx:45      *  солих бол ХОЁУЛАНГ нь зэрэг солино. */
```

Хоёр конвенц: **`?tab=` нь `useTabParam`-аар** (`useState` БОЛГОВОЛ глобал хайлт чимээгүй эвдэрнэ), **`id="sec-…" className="scroll-mt-24"` + `sections.ts`-д НЭГ мөр**. Гуравдахь алхам БАЙХГҮЙ.

### 2.10 Курацийн үйл үгийн сан аль хэдийн тодорхойлогдсон — БАТЛАГДСАН

```
curation.ts:34-43     export const SOURCE_TYPES = ['HUMAN','HUMAN_CORRECTED','HUMAN_VERIFIED','RULE_VERIFIED','SYNTHETIC','AI_GENERATED','IMPORTED','UNKNOWN'] as const;
curation.ts:55        export type CurationAction = 'approved' | 'corrected' | 'manual';
curation.ts:68-75     export function curationSourceType(action, predicted): SourceType { … }
curation.ts:10         * Тиймээс `ExamplePayload`-д `source_type` ба `curation_action` хоёулаа
curation.ts:11         * ЗААВАЛ (optional БИШ) — шинэ бичигч мартах боломжгүй, `tsc` барина.
```

Серверийн тал: `revit.ts:2125` `GET /assistant/pending`, `:2183` `POST /assistant/examples`, `:2484` `POST /assistant/review`, `:2448` `rejectLogStatements` (хуваалцсан SQL), `assistantExampleInsert.ts:157` `deriveSourceType` (СЕРВЕР талд ургана, клиентийн зарлалыг дарж бичих эрхтэй).

⚠️ **Хоёр дахь хянах гадаргуу барих нь §68-ийн бүртгэлийг ХУВААНА.** Хүчингүй болголтыг ЭНЭ хуудсанд дөрөв дэх таб болгож нэмнэ.

### 2.11 Загвар нийтлэх ГУРВАН НӨХЦӨЛТ хаалга — INSERT-ЭЭС ӨМНӨ — БАТЛАГДСАН

```
revit.ts:1970       const evalPassed =
revit.ts:1971         evalRaw && evalRaw.passed === true && evalBlocked.length === 0 && evalVersionMatches
revit.ts:1972           ? 1
revit.ts:1973           : 0;
revit.ts:1975       // ⚠️⚠️ ГОЛ ХААЛГА (1B-5) — INSERT-ЭЭС ӨМНӨ.
revit.ts:1996       if (body.activate !== false && evalPassed !== 1) {
revit.ts:1999             error: 'golden багц даваагүй загварыг идэвхжүүлэх боломжгүй',
revit.ts:2049              is_active            = 0`,
```

Тайлбар нь яагаад гэдгийг бичсэн: хаалга нь INSERT-ийн ДАРАА байхад ижил `ver` дээр дахин нийтлэхэд `weights_json` ДАРАГДААД `is_active` 1 ХЭВЭЭР үлдэж, шалгагдаагүй жин ~20 суулгац руу тардаг байв.

Харин **түвшний хаалга нь ганц boolean байж ЧАДАХГҮЙ**:

```
0213_assistant_model_eval.sql:44     ALTER TABLE assistant_models ADD COLUMN eval_passed INTEGER NOT NULL DEFAULT 0;
```

§80-R3 нь «түвшин бүрд ТУСДАА үнэлгээний хаалга» гэдэг. `eval_passed` нь «ямар нэг golden давсан уу» гэсэн НЭГ асуултыг л хариулна.

### 2.12 Нэмэгдэх-л trigger-ийн ЯГ хэлбэр — БАТЛАГДСАН

```
0206_bim_append_only.sql:1     CREATE TRIGGER IF NOT EXISTS bim_artifacts_append_only
0206_bim_append_only.sql:2     BEFORE UPDATE ON bim_artifacts
0206_bim_append_only.sql:3     WHEN NEW.redacted_at IS NULL
0206_bim_append_only.sql:4     BEGIN
0206_bim_append_only.sql:5       SELECT RAISE(ABORT, 'bim_artifacts is append-only — only redaction may UPDATE');
0206_bim_append_only.sql:6     END;
```

Найман trigger, `END;` бүр **том үсгээр, ӨӨРИЙН МӨРӨНД**. 0237 нь энэ хэлбэрийг БАЙТ БАЙТААР давтана.

### 2.13 Зам ба эрхийн хүрээ — БАТЛАГДСАН

```
modules.ts:99      export const API_PREFIXES = [
modules.ts:166     export const MODULE_OF: Record<ApiPrefix, ModuleId> = {
workerScope.ts:18  const WORKER_ALLOWED_PREFIXES = [
workerScope.ts:20    '/api/auth',
workerScope.ts:22    '/api/attendance',
workerScope.ts:26    '/api/leaves',
workerScope.ts:28    '/api/notifications',
workerScope.ts:30    '/api/push',
workerScope.ts:32    '/api/upload',
```

`workerScope` нь **зөвшөөрлийн жагсаалт** — `/api/compliance` тэнд БАЙХГҮЙ тул `worker` дүр автоматаар 403 авна. `API_PREFIXES` + `MODULE_OF`-д бүртгэх нь `2-3`-ийн ажил (тэр compliance роутыг үүсгэж, mount хийнэ); энэ сесс зөвхөн ХАНДЛАГЧ нэмнэ.

### 2.14 Хамтын .rvt дээр өөр салбарын ажил харагдах нь ЗОРИУД хаагдсан — БАТЛАГДСАН

```
AssistantPane.xaml.cs:249     /// ⚠️ Анхдагч нь ҮРГЭЛЖ false.  Нэг .rvt файлыг олон салбарын инженер
AssistantPane.xaml.cs:250     /// хуваалцдаг ба хуудасны холбоос нь багийн ХУВААЛЦСАН тул бүх ажлыг
AssistantPane.xaml.cs:251     /// анхдагчаар харуулбал цахилгаанчин архитекторын ажил дээр явц илгээх
AssistantPane.xaml.cs:252     /// эрсдэл үүснэ.  Сервер энэ тугийг зөвхөн admin/senior-д хүлээж авна.
```

Энэ бол §60-ийн шийдлийн ЖИШИГ: **инженер өөрийнхөө багийн эзэмшдэг ба өөрт нөлөөлдөг дүгнэлтийг л хардаг**, файлын бүх дүгнэлтийг БИШ.

---

## 3. ХИЙХ АЖИЛ

### 3.0 Дугаар авах

```bash
ls backend/migrations | tail -5
```

Хүлээгдэх (2026-08-30): `0212…` `0213…` `0214…` `0215…` `0216_assistant_log_timing.sql`.

**Энэ сессийн нөөцлөгдсөн дугаар: 0237.** Track 2 нь 0217–0242-ыг нөөцөлсөн (`README.md:142`); `2-1` нь 0217–0219, `2-2` нь 0220–0223, **`2-3-compliance-engine` нь 0224–0225** (ба `rule_run_ledger`-т зориулж нөөцөөс ЗАРЛАН АВСАН 0229), `2-4` нь 0226–0228 ба 0230, 0237 нь ЭНЭ файлынх.

⚠️ **ДУГААРЫН ЗӨРҮҮ — ЗААВАЛ УНШ.** Даалгаврын хураангуйд «§3 нь 0229-ыг эзэмшинэ» гэж бичигдсэн нь контекст багцын ЭХНИЙ хувилбарын дугаарлалт. Бодит байдал дээр **0229-ыг `2-3-compliance-engine` өөрийн §3.0-д ЗАРЛАН АВСАН** (`rule_run_ledger`) тул 0229-ыг энд хэрэглэвэл ХОЁР файл нэг дугаар авч, `2-3` эсвэл энэ файлын аль нэг нь хэрэгжихгүй үлдэнэ. Репод аль хэдийн найман давхардсан дугаар байгаа (0002, 0060, 0080, 0110, 0120, 0121, 0173, 0176). **0237-г ашиглана.** Хэрэв `ls` нь 0237-г аль хэдийн эзэлсэн байвал README-ийн нөөц блокоос (0231–0236 — 0229 нь `2-3`-д, 0230 нь `2-4`-д авагдсан) НЭГИЙГ аваад §9-д зарлана.

⚠️ Бичихийн ӨМНӨ:

```bash
cd backend && node --test src/lib/migrationSchema.test.ts
```

Энэ хамгаалалт нь 0214 ба 0215 хоёулаа `reviewed_at` нэмэх шахсаны улмаас бий болсон.

### 3.1 `backend/src/lib/complianceModel.ts` — ДӨРӨВ ДЭХ тэнхлэг ба эрхийн түвшин

⚠️ Энэ файлыг `2-3` үүсгэнэ (verdict, issue_class, lifecycle_state). Энэ сесс нь доорх БЛОКУУДЫГ НЭМНЭ — байгаа экспортыг ХӨНДӨХГҮЙ.

```ts
/* ------------------------------------------------------------------ */
/*  §65 — НОТОЛГООНЫ ТҮВШИН (ДӨРӨВ ДЭХ ТЭНХЛЭГ)                        */
/* ------------------------------------------------------------------ */

/**
 * ⚠️ ЯАГААД ЭНЭ НЬ ТУСДАА ТЭНХЛЭГ ВЭ:
 * Репод аль хэдийн ГУРВАН итгэлийн үгсийн сан байгаа бөгөөд тэд ЗӨРЧИЖ байна —
 *   · `assistant_examples.source_type`   (8 утга, DB CHECK, 0215:51-55)
 *   · `learning_events.provenance`       (6 утга, CHECK БАЙХГҮЙ, bimEvents.ts:245-252)
 *   · v1 §19-ийн KNOWN/INFERRED/ASSUMED/UNKNOWN (зөвхөн спекд)
 * Нэрээрээ давхцаж буй нь ЗӨВХӨН `HUMAN_VERIFIED` ба `UNKNOWN`, ба хооронд нь
 * хөрвүүлэх функц репод БАЙХГҮЙ (2026-08-30-нд grep-ээр хэмжсэн).
 * `source_type`-ыг дахин ашиглавал `RULE_BACKED` нь 0215-ийн CHECK-д байхгүй
 * тул INSERT «CHECK constraint failed» өгнө.  Тиймээс ӨӨРИЙН багана.
 */
export const EVIDENCE_LEVELS = [
  'RULE_BACKED',
  'MODEL_DERIVED',
  'HUMAN_VERIFIED',
  'AI_INFERRED',
  'UNKNOWN',
] as const;
export type EvidenceLevel = (typeof EVIDENCE_LEVELS)[number];

/**
 * Түвшин бүрийн ХАРАГДАХ гэрээ.  ⚠️ Энэ бол UI-ийн загвар БИШ, ХИЛ.
 *
 * `citation` = тухайн түвшин нормын КОД, ЗААЛТ, ХЭВЛЭЛИЙГ хэвлэж болох эсэх.
 * `false` үед UI нь `2-2`-ийн «дотоод шалгуур» хэллэгийг л гаргана.
 * §65: «A model-generated explanation without evidence must never be
 * presented as a verified regulatory fact» (v2:2158).
 */
export interface EvidenceRender {
  /** Нормын код/заалт/хэвлэл хэвлэхийг зөвшөөрөх үү. */
  citation: boolean;
  /** Хамгийн өндөр зөвшөөрөгдөх дүгнэлт — үүнээс дээшгүй. */
  maxVerdict: 'PASS' | 'WARNING' | 'VIOLATION' | 'UNCERTAIN';
  /** Бэлэн байдлын хаалганд тоологдох уу (§69). */
  countsForReadiness: boolean;
  /** Сургалтад тэнцэх БОЛОМЖТОЙ эсэх (эцсийн шийдвэр 2-6-д). */
  trainingCandidate: boolean;
  /** Монгол шошго — UI-д ЯГ ЭНЭ мөр гарна. */
  labelMn: string;
  labelEn: string;
}

/** ⚠️ TOTAL Record — шинэ түвшин нэмэх нь КОМПИЛЯЦИЙН АЛДАА. */
export const EVIDENCE_RENDER: Record<EvidenceLevel, EvidenceRender> = {
  RULE_BACKED: {
    citation: true,
    maxVerdict: 'VIOLATION',
    countsForReadiness: true,
    trainingCandidate: true,
    labelMn: 'Норм эх сурвалжтай',
    labelEn: 'Rule-backed',
  },
  MODEL_DERIVED: {
    citation: false,
    maxVerdict: 'WARNING',
    countsForReadiness: true,
    trainingCandidate: false,
    labelMn: 'Дотоод шалгуур (эх сурвалж баталгаажаагүй)',
    labelEn: 'Internal check (source unverified)',
  },
  HUMAN_VERIFIED: {
    citation: true,
    maxVerdict: 'VIOLATION',
    countsForReadiness: true,
    trainingCandidate: true,
    labelMn: 'Хүн баталсан',
    labelEn: 'Human-verified',
  },
  AI_INFERRED: {
    citation: false,
    maxVerdict: 'UNCERTAIN',
    countsForReadiness: false,
    trainingCandidate: false,
    labelMn: 'AI-ийн таамаг — норм БИШ',
    labelEn: 'AI inference — not a regulation',
  },
  UNKNOWN: {
    citation: false,
    maxVerdict: 'UNCERTAIN',
    countsForReadiness: false,
    trainingCandidate: false,
    labelMn: 'Эх сурвалж тодорхойгүй',
    labelEn: 'Unknown provenance',
  },
};

/* ------------------------------------------------------------------ */
/*  §67 — ХҮНД БАЙДЛЫН ЭРЭМБЭ                                          */
/* ------------------------------------------------------------------ */

export const SEVERITIES = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO'] as const;
export type Severity = (typeof SEVERITIES)[number];

/** ⚠️ Жижиг тоо = ЭХЭНД.  Таслахаас ӨМНӨ энэ дарааллаар эрэмбэлнэ (§2.5). */
export const SEVERITY_RANK: Record<Severity, number> = {
  CRITICAL: 0,
  HIGH: 1,
  MEDIUM: 2,
  LOW: 3,
  INFO: 4,
};

/* ------------------------------------------------------------------ */
/*  §68 — ХҮЧИНГҮЙ БОЛГОХ ТӨРӨЛ                                        */
/* ------------------------------------------------------------------ */

/**
 * ⚠️ `FALSE_POSITIVE` нь `2-7`-ийн худал дохионы хэмжүүрийн ЦОРЫН ГАНЦ оролт.
 * Түүнийг «хамаарахгүй» эсвэл «хүлээн зөвшөөрсөн эрсдэл»-тэй нэг болгож
 * НЭГТГЭХГҮЙ: эхнийх нь ДҮРЭМ буруу гэсэн үг, сүүлийнх нь ДҮРЭМ ЗӨВ ч
 * инженер зориудаар давсан гэсэн үг.  Нэгтгэвэл §66 хэмжигдэхээ болино.
 */
export const OVERRIDE_KINDS = [
  'FALSE_POSITIVE',      // дүрэм буруу ажиллав — загвар зөв
  'RULE_WRONG',          // дүрмийн УТГА буруу (босго, нэгж, заалт)
  'NOT_APPLICABLE_HERE', // дүрэм зөв ч энэ тохиолдолд хамаарахгүй
  'ACCEPTED_RISK',       // зөрчил мөн, мэдсээр байж хүлээн авав
  'DESIGN_EXCEPTION',    // зөвшөөрөгдсөн онцгой шийдэл (баримттай)
  'DUPLICATE',           // өөр дүгнэлттэй давхардсан
] as const;
export type OverrideKind = (typeof OVERRIDE_KINDS)[number];

/** 0215-ийн ДӨРВӨН утгыг БАЙТ БАЙТААР дахин ашиглана — тав дахь үгсийн сан ҮҮСГЭХГҮЙ. */
export const REVIEW_STATES = ['pending', 'reviewed', 'verified', 'rejected'] as const;
export type ReviewState = (typeof REVIEW_STATES)[number];

/* ------------------------------------------------------------------ */
/*  §80 — ҮЙЛДВЭРЛЭЛИЙН ЭРХИЙН ТҮВШИН                                  */
/* ------------------------------------------------------------------ */

/** v2:2524-2529-ийн зургаан түвшин, БАЙТ БАЙТААР. */
export const AUTHORITY_LEVELS = [
  'OBSERVE',              // 0
  'EXPLAIN',              // 1
  'RECOMMEND',            // 2
  'PREVIEW',              // 3
  'HUMAN_APPROVED_EXECUTE', // 4
  'LIMITED_AUTONOMOUS_EXECUTE', // 5
] as const;
export type AuthorityLevel = (typeof AUTHORITY_LEVELS)[number];

export interface AuthorityCaps {
  /** Дүгнэлтийг ЦУГЛУУЛЖ, хадгалж болох уу. */
  collect: boolean;
  /** Инженерт ХАРУУЛЖ болох уу. */
  surface: boolean;
  /** ЯАГААД гэдгийг тайлбарлаж болох уу (заалт, тооцоо). */
  explain: boolean;
  /** ЗАСВАРЫГ САНАЛ болгож болох уу (текстээр). */
  recommend: boolean;
  /** Урьдчилан харах өөрчлөлт БЭЛТГЭЖ болох уу. */
  preview: boolean;
  /** Загварыг БИЧИЖ болох уу. */
  write: boolean;
}

/** ⚠️ TOTAL Record.  `write` нь зөвхөн 4/5-д true — релиз N-д хүрэхгүй. */
export const AUTHORITY_CAPS: Record<AuthorityLevel, AuthorityCaps> = {
  OBSERVE:                    { collect: true, surface: false, explain: false, recommend: false, preview: false, write: false },
  EXPLAIN:                    { collect: true, surface: true,  explain: true,  recommend: false, preview: false, write: false },
  RECOMMEND:                  { collect: true, surface: true,  explain: true,  recommend: true,  preview: false, write: false },
  PREVIEW:                    { collect: true, surface: true,  explain: true,  recommend: true,  preview: true,  write: false },
  HUMAN_APPROVED_EXECUTE:     { collect: true, surface: true,  explain: true,  recommend: true,  preview: true,  write: true  },
  LIMITED_AUTONOMOUS_EXECUTE: { collect: true, surface: true,  explain: true,  recommend: true,  preview: true,  write: true  },
};

/** `app_settings['bim.compliance.authority_level']` нь '0'…'5' тэмдэгт мөр. */
export function authorityFromSetting(raw: string | null | undefined): AuthorityLevel {
  const n = Number(raw);
  // ⚠️ Танихгүй / хоосон / гэмтэлтэй утга ҮРГЭЛЖ хамгийн БАГА эрх рүү унана.
  if (!Number.isInteger(n) || n < 0 || n >= AUTHORITY_LEVELS.length) return 'OBSERVE';
  return AUTHORITY_LEVELS[n]!;
}

/** §80-R3 — түвшин бүрд ТУСДАА хаалга.  Ганц boolean-оор илэрхийлэгдэхгүй. */
export interface AuthorityGate {
  level: AuthorityLevel;
  /** Тухайн түвшинд шаардагдах golden хуваарийн нэрс. */
  requiredPartitions: readonly string[];
  /** `rules.verification_state`-ийн хамгийн бага шаардлага. */
  minVerificationState: 'UNVERIFIED' | 'CLAUSE_CITED' | 'HUMAN_VERIFIED';
  /** Тухайн түвшинг асаахад ЗААВАЛ бөглөгдсөн байх нотолгооны талбарууд. */
  requiredEvidenceFields: readonly string[];
}
```

⚠️ `EVIDENCE_RENDER.maxVerdict` нь `2-2`-ийн `verification_state` хавчаартай **ХАМТ** ажиллана: `2-2` нь дүрмийн түвшинд хавчина, энэ нь ИЛЭРХИЙЛЭЛИЙН түвшинд хавчина. Хоёулаа хэрэгтэй — эхнийх нь бичих үед, хоёр дахь нь унших үед.

### 3.2 `backend/migrations/0237_finding_overrides.sql` — БҮРЭН файл

```sql
-- ================================================================
-- 0237_finding_overrides.sql — §68 ГАР ХҮЧИНГҮЙ БОЛГОЛТ
--
-- ЗОРИЛГО: мэргэжлийн инженер дүгнэлттэй санал нийлэхгүй үед түүнийг
-- ХААХ боловч дүгнэлтийг ӨӨРИЙГ нь ХЭЗЭЭ Ч устгахгүй.  v2 §68 (мөр 2196)
-- долоон элементийн гинжийг шаарддаг:
--   дүгнэлт → хүчингүй болголт → хэн → хэзээ → шалтгаан → нотолгоо
--            → дүрэм/загварын хувилбар
-- Долоо нь бүгд ЭНЭ хүснэгтэд БАГАНА байна.
--
-- ⚠️ ХҮЧИНГҮЙ БОЛГОЛТ НЬ НЭМЭЛТ, UPDATE БИШ.  `compliance_findings` нь
--    ӨӨРЧЛӨГДӨХ (0224) — учир нь §57-ийн шилжилтүүд UPDATE юм.  Аудитын
--    мөрийг ЭНЭ хүснэгт барина: доорх trigger нь бүртгэлийн ХЭСГИЙГ
--    хөдөлгөшгүй болгоно.  Дүгнэлтийн `lifecycle_state` нь 'DISMISSED'
--    болно; `verdict`, тооцоо, нотолгоо нь ХӨНДӨГДӨХГҮЙ.
--
-- ⚠️ REFERENCES compliance_findings(id) ТАВИХГҮЙ.  1B-1 §2.6-д хэмжсэнээр
--    `ON DELETE SET NULL` нь хүүхдийн UPDATE болж хувирч, нэмэгдэх-л
--    trigger-ийг асааж, эцгийн DELETE-ийг БҮХЭЛД нь ABORT хийдэг.
--    `finding_id`-г энгийн INTEGER болгож, хүүхдийг ГАРААР устгах
--    конвенцийг барина (email.ts, calendar.ts, pgp.ts, repair.ts-тэй адил).
--    `users(id)` рүү заах нь ЗӨВШӨӨРӨГДӨНӨ — тэр хүснэгтэд trigger байхгүй.
--
-- ⚠️ `review_state` нь 0215:59-61-ийн ДӨРВӨН утгыг БАЙТ БАЙТААР давтана.
--    §68-R4 «An override may become valuable learning data later, but only
--    after appropriate verification» — тав дахь үгсийн сан ҮҮСГЭХГҮЙ.
--
-- ⚠️ `END;` нь ТОМ ҮСГЭЭР, ӨӨРИЙН МӨРӨНД.  wrangler-ийн салгагчийн regex
--    том/жижиг үсэг ЯЛГАНА; буруу бол файл ХАГАС хэрэгжиж, `d1_migrations`
--    мөр БИЧИГДЭХГҮЙ, цорын ганц засвар нь ШИНЭ дугаар.
--
-- ⚠️ ЭНЭ ФАЙЛД 4 ӨӨРИЙН МЭДЭГДЭЛ (нийт 5, хавсаргасан INSERT-тэй).
--    Дээд хязгаар 7.  Мэдэгдэл бүр `IF NOT EXISTS` — хагас хэрэгжсэн файл
--    шинэ дугаараар дахин ажиллах боломжтой байх ЁСТОЙ.
-- ================================================================

CREATE TABLE IF NOT EXISTS finding_overrides (
  id                          INTEGER PRIMARY KEY AUTOINCREMENT,

  /* --- 1. АЛЬ ДҮГНЭЛТ (REFERENCES ЗОРИУД БАЙХГҮЙ) --- */
  finding_id                  INTEGER NOT NULL,
  /* Дүгнэлтийн тогтвортой түлхүүр = sha256(rule_uid + '\x00' + element_uid)[:16].
     ⚠️ `ruleset_version` нь энэ түлхүүрийн ХЭСЭГ БИШ — багц дахин нийтлэхэд
     бүх хүлээн зөвшөөрөл сална.  Хувилбарууд нь ДЭРГЭД нь багана. */
  dedup_key                   TEXT    NOT NULL,

  /* --- 2. ЮУ ГЭСЭН ХҮЧИНГҮЙ БОЛГОЛТ --- */
  override_kind               TEXT    NOT NULL
    CHECK (override_kind IN (
      'FALSE_POSITIVE','RULE_WRONG','NOT_APPLICABLE_HERE',
      'ACCEPTED_RISK','DESIGN_EXCEPTION','DUPLICATE')),
  /* ⚠️ ШАЛТГААН ЗААВАЛ.  Хоосон шалтгаантай хүчингүй болголт нь §66-д
     хэмжигдэхгүй, §70-д тест болохгүй — өөрөөр хэлбэл өгөгдөл БИШ. */
  reason                      TEXT    NOT NULL,

  /* --- 3. НОТОЛГОО --- */
  evidence_artifact_id        INTEGER,
  evidence_note               TEXT,

  /* --- 4. ХҮЧИНГҮЙ БОЛГОХ ҮЕИЙН ТӨЛӨВ (ХӨЛДӨӨСӨН) --- */
  verdict_at_override         TEXT    NOT NULL,
  severity_at_override        TEXT    NOT NULL,
  evidence_level_at_override  TEXT    NOT NULL,
  issue_class_at_override     TEXT,

  /* --- 5. ДҮРЭМ / ЗАГВАРЫН ХУВИЛБАР (§68-ийн 7 дахь элемент) --- */
  rule_uid                    TEXT,
  rule_version                INTEGER,
  ruleset_version             TEXT,
  pack_sha256                 TEXT,
  semantic_hash               TEXT,
  model_version               TEXT,
  addin_version               TEXT,
  team_code                   TEXT,

  /* --- 6. ХЭН, ХЭЗЭЭ --- */
  created_by                  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at                  TEXT    NOT NULL DEFAULT (datetime('now')),

  /* --- 7. ХЯНАЛТ (0215-ийн үгсийн сан) --- */
  review_state                TEXT    NOT NULL DEFAULT 'pending'
    CHECK (review_state IN ('pending','reviewed','verified','rejected')),
  reviewed_by                 INTEGER REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at                 TEXT,
  review_note                 TEXT
);

CREATE INDEX IF NOT EXISTS idx_finding_overrides_finding
  ON finding_overrides (finding_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_finding_overrides_review
  ON finding_overrides (review_state, override_kind, created_at DESC);

CREATE TRIGGER IF NOT EXISTS finding_overrides_append_only
BEFORE UPDATE ON finding_overrides
WHEN OLD.reviewed_at IS NOT NULL
  OR NEW.finding_id <> OLD.finding_id
  OR NEW.dedup_key <> OLD.dedup_key
  OR NEW.override_kind <> OLD.override_kind
  OR NEW.reason <> OLD.reason
  OR NEW.created_at <> OLD.created_at
  OR NEW.verdict_at_override <> OLD.verdict_at_override
  OR NEW.severity_at_override <> OLD.severity_at_override
  OR NEW.evidence_level_at_override <> OLD.evidence_level_at_override
BEGIN
  SELECT RAISE(ABORT, 'finding_overrides: record is immutable; review may be written once');
END;
```

⚠️ Trigger нь **хоёр зүйлийг нэг мэдэгдлээр** барина: (а) хянагдсан мөрийг ДАХИН хянахыг хориглоно (эхний шийдвэр ялна — `revit.ts:2397-2403`-ийн жишиг), (б) хөдөлгөшгүй хагасыг өөрчлөхийг хориглоно. `review_state` / `reviewed_by` / `reviewed_at` / `review_note` нь НЭГ УДАА бичигдэнэ.

### 3.3 `backend/src/routes/compliance.ts` — УНШИХ ба ХҮЧИНГҮЙ БОЛГОХ

⚠️ Роутыг `2-3` үүсгэж, `index.ts` ба `modules.ts`-д бүртгэнэ. Энэ сесс нь доорх ТАВАН хандлагчийг НЭМНЭ.

```ts
/**
 * ⚠️ ӨӨРИЙГӨӨ л ХАРАХ ИНВАРИАНТ.  Дөрвөн миграцийн толгойд (0201:23-32,
 * 0203:27, 0205:44) ба `revitNoteAi.test.ts:262`-д түгжигдсэн: элементийн
 * түвшний үйл ажиллагаа нь ЗӨВХӨН өөрийн харагдана.  Тиймээс дүгнэлтийн
 * жагсаалт нь `detected_by = viewer.sub` эсвэл ЦЭВЭР НЭГТГЭЛ байна.
 * Багийн «хэн хамгийн олон зөрчилтэй вэ» харагдац ХЭЗЭЭ Ч БАЙХГҮЙ.
 */

// GET /api/compliance/findings?doc_uid=&severity_min=&state=
//   → { authority, ruleset_version, items: [...], more: N }
// Эрэмбэ: severity_rank ASC, is_root DESC, detected_at DESC.
// ⚠️ ЭРЭМБЭЛСНИЙ ДАРАА л таслана (§2.5); `more` нь таслагдсаныг ИЛ хэлнэ.

// GET /api/compliance/findings/:id
//   → { finding, evidence, root, consequences: [...], overrides: [...] }
// `root` = finding_edges (kind='causes') дээгүүр дээш явж олсон ҮНДЭС.
// `consequences` = тэр үндэснээс доош гарах бүх зам (§77).

// POST /api/compliance/findings/:id/override
//   body: { override_kind, reason, evidence_note?, evidence_artifact_id? }
//   → 201 { override_id, lifecycle_state: 'DISMISSED' }

// POST /api/compliance/overrides/:id/review
//   body: { review_state: 'reviewed'|'verified'|'rejected', review_note? }
//   → 200 | 409 (аль хэдийн хянагдсан)

// GET /api/compliance/authority
//   → { level, caps, ruleset_version, rollout_pct, gates: [...] }
```

**Хүчингүй болголтын хандлагчийн ЯГ дараалал** (алдах боломжгүй байх ёстой):

```ts
compliance.post('/findings/:id/override', async (c) => {
  const user = c.get('user');
  const id = Number(c.req.param('id'));
  const body = await c.req.json().catch(() => ({}));

  // 1. Төрөл ба шалтгаан ЗААВАЛ.  Хоосон шалтгаан = 400, DB CHECK хүртэл
  //    хүргэхгүй (хэрэглэгчид харагдах алдаа нь DB-ийнх байх ЁСГҮЙ).
  if (!OVERRIDE_KINDS.includes(body.override_kind)) return c.json({ error: 'override_kind буруу' }, 400);
  const reason = String(body.reason ?? '').trim();
  if (reason.length < 8) return c.json({ error: 'Шалтгаан заавал (наад зах нь 8 тэмдэгт)' }, 400);

  // 2. Дүгнэлтийг УНШИНА — ХӨЛДӨӨХ утгууд СЕРВЕРЭЭС гарна, клиентээс БИШ.
  //    ⚠️ `learning.ts:338-340`-ийн жишиг: биеэс ирсэн таних мэдээллийг
  //    сервер ХЭЗЭЭ Ч итгэдэггүй.  Хувилбар, хүнд байдал, нотолгооны
  //    түвшинг клиент зарлавал хүчингүй болголтын түүх ЗОХИОМОЛ болно.
  const f = await db.prepare(
    `SELECT id, dedup_key, verdict, severity, evidence_level, issue_class,
            rule_uid, rule_version, ruleset_version, pack_sha256,
            semantic_hash, model_version, addin_version, team_code,
            detected_by, lifecycle_state
       FROM compliance_findings WHERE id = ?`).bind(id).first();
  if (!f) return c.json({ error: 'олдсонгүй' }, 404);

  // 3. Эрх: дүгнэлтийг ИЛРҮҮЛСЭН хүн ӨӨРӨӨ, эсвэл менежер (admin|senior).
  //    ⚠️ Өөрийгөө л харах инвариантын шууд үр дагавар.
  const isManager = user.role === 'admin' || user.role === 'senior';
  if (!isManager && f.detected_by !== user.sub) return c.json({ error: 'эрх хүрэхгүй' }, 403);

  // 4. НЭМНЭ.  Дараалал АЧААЛАЛТАЙ: override мөр ЭХЛЭЭД, дараа нь дүгнэлтийн
  //    төлөв.  Урвуулбал бичилт таслагдахад дүгнэлт хаагдсан ч ЯАГААД
  //    гэдэг нь ХЭЗЭЭ Ч мэдэгдэхгүй болно.
  const ins = await db.prepare(
    `INSERT INTO finding_overrides
       (finding_id, dedup_key, override_kind, reason, evidence_note,
        evidence_artifact_id, verdict_at_override, severity_at_override,
        evidence_level_at_override, issue_class_at_override,
        rule_uid, rule_version, ruleset_version, pack_sha256, semantic_hash,
        model_version, addin_version, team_code, created_by)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .bind(f.id, f.dedup_key, body.override_kind, reason,
          str(body.evidence_note, 2000) || null,
          Number(body.evidence_artifact_id) || null,
          f.verdict, f.severity, f.evidence_level, f.issue_class,
          f.rule_uid, f.rule_version, f.ruleset_version, f.pack_sha256,
          f.semantic_hash, f.model_version, f.addin_version, f.team_code,
          user.sub)
    .run();

  // 5. Дүгнэлтийг ХААНА — verdict, тооцоо, нотолгоо ХӨНДӨГДӨХГҮЙ (§68-R2).
  //    ⚠️ SET хэсэгт `verdict`, `severity`, `evidence_level` БАЙХГҮЙ.
  await db.prepare(
    `UPDATE compliance_findings
        SET lifecycle_state = 'DISMISSED', dismissed_at = datetime('now')
      WHERE id = ? AND lifecycle_state <> 'DISMISSED'`).bind(id).run();

  // 6. ТӨЛӨВ ӨӨРЧЛӨЛТИЙН үйл явдал — `RULE_VALIDATION` мөр (2-3-ийн ялгагч).
  //    ⚠️ Үнэлгээ бүрд БИШ, ЗӨВХӨН төлөв солигдоход.
  await emitVerdictStateChange(c, f, 'DISMISSED', { override_id: ins.meta.last_row_id });

  return c.json({ override_id: ins.meta.last_row_id, lifecycle_state: 'DISMISSED' }, 201);
});
```

**Хяналтын хандлагч** (§68-R4 — сургалтад орох хаалга):

```ts
compliance.post('/overrides/:id/review', requireManager(), async (c) => {
  // ⚠️ ЭХНИЙ ШИЙДВЭР ЯЛНА — `revit.ts:2397-2403`-ийн жишиг.  `AND
  //    reviewed_at IS NULL` нь уралдааны хамгаалалт; trigger нь хоёр дахь
  //    давхарга (`WHEN OLD.reviewed_at IS NOT NULL` → ABORT).
  const res = await db.prepare(
    `UPDATE finding_overrides
        SET review_state = ?, reviewed_by = ?, reviewed_at = datetime('now'),
            review_note = ?
      WHERE id = ? AND reviewed_at IS NULL`)
    .bind(state, user.sub, note || null, id).run();
  if (res.meta.changes === 0) return c.json({ error: 'аль хэдийн хянагдсан' }, 409);
  return c.json({ ok: true });
});
```

⚠️ **`2-6` НЬ `review_state IN ('reviewed','verified')` БОЛСОН МӨРИЙГ Л УНШИНА.** `pending` хүчингүй болголт нь сургалтад ХЭЗЭЭ Ч орохгүй — 0215-ийн бодлого БАЙТ БАЙТААР: `eligible(row) = policy_allows(source_type) AND review_state IN ('reviewed','verified')`.

### 3.4 `revit-mcp/addin/FindingFeed.cs` — ЦЭВЭР, Revit-гүй, эрэмбэлсний дараа таслана

```csharp
using System;
using System.Collections.Generic;

namespace RevitMcpAddin
{
    /// <summary>
    /// Дүгнэлтийн ХАРАГДАХ дараалал — дедуп → хойшлуулалт → хүлээн
    /// зөвшөөрөл → үндэс рүү нугалах → төсөв.
    ///
    /// ⚠️ ЭНЭ ФАЙЛ `Autodesk.Revit.*` ТӨРӨЛ ОГТ АШИГЛАХГҮЙ.  `Nudges.cs`,
    ///    `Timing.cs`, `Percentiles.cs`-ийн хэв маяг: `check_findingfeed.py`
    ///    нь ЭНЭ ГАНЦ файлыг `dotnet run`-аар Revit-гүйгээр компиляцлаж
    ///    бүх дүрмийг шалгана.  Revit-ийн төрөл оруулбал add-in дахь
    ///    ЦОРЫН ГАНЦ автомат тест боломжгүй болно (C# тест ТЭГ).
    ///
    /// ⚠️ ЭНЭ ФАЙЛ UI-Д ХҮРЭХГҮЙ.  `Dispatcher` дуудахгүй, `DockablePane`
    ///    мэдэхгүй.  Дуудагч нь үр дүнг аваад UI thread дээр зурна.
    ///    Шалтгаан: §0-ийн 9 дэх хориглолт — `Gate` барих боломжтой
    ///    thread-ээс `Dispatcher.Invoke` нь deadlock.
    /// </summary>
    internal static class FindingFeed
    {
        /* ============================================================== */
        /*  Төсөв                                                          */
        /* ============================================================== */

        /// <summary>
        /// Самбарт нэг удаад харуулах ДЭЭД мөр.
        ///
        /// ⚠️ Хоёр самбарын жагсаалт нь ВИРТУАЛЖУУЛААГҮЙ `ItemsControl`
        ///    (`AssistantPane.xaml:342`, `:380`) — мөр бүр нэг удаа
        ///    бүтээгдээд санах ойд үлддэг.  Хязгаарыг ДЭЭД урсгалд тавина.
        /// </summary>
        public const int MaxVisible = 40;

        /// <summary>Нэг үндсэн шалтгааны дор нугалж харуулах дагаврын дээд тоо.</summary>
        public const int MaxConsequencesShown = 9;

        /// <summary>Хүлээн зөвшөөрөгдсөн мөрийг дахин гаргах хамгийн бага завсар (хоног).</summary>
        public const int SnoozeDays = 7;

        /* ============================================================== */
        /*  Оролт / гаралт                                                 */
        /* ============================================================== */

        internal sealed class Item
        {
            public string DedupKey;        // sha256(rule_uid + '\0' + element_uid)[:16]
            public long   ElementId;       // goto_element-д дамжуулна
            public string Verdict;         // PASS | WARNING | VIOLATION | UNCERTAIN
            public string Severity;        // CRITICAL | HIGH | MEDIUM | LOW | INFO
            public string IssueClass;
            public string EvidenceLevel;   // RULE_BACKED | MODEL_DERIVED | HUMAN_VERIFIED | AI_INFERRED | UNKNOWN
            public string TitleMn, TitleEn;
            public string RecommendationMn, RecommendationEn;
            public string CitationMn;      // ⚠️ EvidenceLevel зөвшөөрөөгүй бол NULL байх ЁСТОЙ
            public long   DetectedAtSec;   // unix, эрэмбэлэлтэд
            public bool   IsStale;
            public string RootDedupKey;    // өөрөө үндэс бол null
        }

        internal sealed class State
        {
            /// <summary>Хүлээн зөвшөөрсөн түлхүүр → хэзээ (unix сек).</summary>
            public readonly Dictionary<string, long> AckedAt =
                new Dictionary<string, long>(StringComparer.Ordinal);
            /// <summary>Сүүлд харуулсан түлхүүрүүд — давхардлыг таслахад.</summary>
            public readonly HashSet<string> ShownKeys =
                new HashSet<string>(StringComparer.Ordinal);
        }

        internal sealed class Group
        {
            public Item Primary;                       // ҮНДСЭН ШАЛТГААН — ЭХЭНД
            public readonly List<Item> Consequences = new List<Item>();
            public int ConsequenceTotal;               // нугалахаас ӨМНӨХ бүтэн тоо
        }

        internal sealed class Result
        {
            public readonly List<Group> Groups = new List<Group>();
            public int TotalFindings;    // шүүхээс ӨМНӨХ бүтэн тоо
            public int Hidden;           // хүлээн зөвшөөрөгдсөн / хойшлуулсан
            public int Truncated;        // ЭРЭМБЭЛСНИЙ ДАРАА таслагдсан тоо
            public bool AnyStale;
        }

        /* ============================================================== */
        /*  Эрэмбэ                                                         */
        /* ============================================================== */

        private static int SeverityRank(string s)
        {
            switch (s)
            {
                case "CRITICAL": return 0;
                case "HIGH":     return 1;
                case "MEDIUM":   return 2;
                case "LOW":      return 3;
                default:         return 4; // INFO ба танихгүй утга
            }
        }

        /// <summary>
        /// ⚠️ ЭРЭМБЭ → ДАРАА нь ТАСЛАХ.  Урвуулбал `ChangeReport.cs:56-60`-д
        ///    тэмдэглэсэн регресс давтагдана: хэрэглэгч «санамсаргүй N»-г
        ///    БҮРЭН жагсаалт гэж үзээд үлдсэн зөрчлийг засахгүй.  Дүгнэлтийн
        ///    хувьд энэ нь өмнөх алдаанаас ХАМААГҮЙ аюултай.
        /// </summary>
        private static int Compare(Item a, Item b)
        {
            int r = SeverityRank(a.Severity).CompareTo(SeverityRank(b.Severity));
            if (r != 0) return r;
            // Үндэс нь дагавраасаа ДЭЭР (§77 — «show the primary cause first»).
            bool ra = a.RootDedupKey == null, rb = b.RootDedupKey == null;
            if (ra != rb) return ra ? -1 : 1;
            // Хуучирсан нь ДООР — одоогийн дүгнэлт БИШ (§58).
            if (a.IsStale != b.IsStale) return a.IsStale ? 1 : -1;
            // Сүүлд илрүүлсэн нь ДЭЭР.
            return b.DetectedAtSec.CompareTo(a.DetectedAtSec);
        }

        /* ============================================================== */
        /*  Гол функц — ЦЭВЭР                                              */
        /* ============================================================== */

        /// <summary>
        /// `raw` бол серверээс ирсэн бүтэн жагсаалт.  ЦЭВЭР функц: ижил
        /// оролтод ижил гаралт, гадаад төлөв уншихгүй.
        ///
        /// ⚠️ `minSeverityRank` нь `bim.compliance.min_severity`-оос ирнэ —
        ///    C#-д ХАТУУ БИЧИХГҮЙ.  Босгыг DLL-д шатаавал түүнийг өөрчлөх
        ///    нь ~20 PC дээр дахин суулгалт болно.
        /// </summary>
        public static Result Build(IList<Item> raw, State state, long nowSec, int minSeverityRank)
        {
            var res = new Result();
            if (raw == null || state == null) return res;
            res.TotalFindings = raw.Count;

            // --- 1. ШҮҮЛТ: хүнд байдал, хүлээн зөвшөөрөл, хойшлуулалт ---
            var kept = new List<Item>(raw.Count);
            foreach (Item it in raw)
            {
                if (it == null || string.IsNullOrEmpty(it.DedupKey)) continue;
                if (SeverityRank(it.Severity) > minSeverityRank) { res.Hidden++; continue; }

                long ackAt;
                if (state.AckedAt.TryGetValue(it.DedupKey, out ackAt))
                {
                    // ⚠️ Хүлээн зөвшөөрөл нь ДҮРМИЙН semantic_hash солигдоход л
                    //    хүчингүй болно — тэр шийдвэрийг СЕРВЕР гаргаж, мөрийг
                    //    буцаахаа болино.  Клиент зөвхөн хугацааг барина.
                    if (nowSec - ackAt < SnoozeDays * 86400L) { res.Hidden++; continue; }
                }
                if (it.IsStale) res.AnyStale = true;
                kept.Add(it);
            }

            // --- 2. ЭРЭМБЭ (таслахаас ӨМНӨ) ---
            kept.Sort(Compare);

            // --- 3. ҮНДЭС РҮҮ НУГАЛАХ (§77 + §76-R3) ---
            var byKey = new Dictionary<string, Group>(StringComparer.Ordinal);
            var order = new List<Group>();
            foreach (Item it in kept)
            {
                string rootKey = it.RootDedupKey ?? it.DedupKey;
                Group g;
                if (!byKey.TryGetValue(rootKey, out g))
                {
                    g = new Group();
                    byKey[rootKey] = g;
                    order.Add(g);
                }
                if (it.RootDedupKey == null && g.Primary == null) { g.Primary = it; continue; }
                g.ConsequenceTotal++;
                if (g.Consequences.Count < MaxConsequencesShown) g.Consequences.Add(it);
            }

            // ⚠️ Үндэс нь шүүлтэд унасан (жишээ нь хүлээн зөвшөөрөгдсөн) бол
            //    хамгийн хүнд дагаврыг ТҮР үндэс болгоно — бүлэг толгойгүй
            //    үлдвэл дагаврууд нь харагдахаа болино.
            foreach (Group g in order)
            {
                if (g.Primary == null && g.Consequences.Count > 0)
                {
                    g.Primary = g.Consequences[0];
                    g.Consequences.RemoveAt(0);
                    g.ConsequenceTotal--;
                }
            }

            // --- 4. ТӨСӨВ (эрэмбэлсний ДАРАА) ---
            int shown = 0;
            foreach (Group g in order)
            {
                if (g.Primary == null) continue;
                if (shown >= MaxVisible) { res.Truncated++; continue; }
                res.Groups.Add(g);
                state.ShownKeys.Add(g.Primary.DedupKey);
                shown++;
            }
            return res;
        }

        /// <summary>Хүн «Ойлголоо» дарахад — төсвөөс ХАСАХГҮЙ, зөвхөн хугацаа.</summary>
        public static void Acknowledge(State s, string dedupKey, long nowSec)
        {
            if (s == null || string.IsNullOrEmpty(dedupKey)) return;
            s.AckedAt[dedupKey] = nowSec;
        }

        /// <summary>
        /// ⚠️ ЭНД `Show()` ЧЮ Ч БАЙХГҮЙ.  Тоог ribbon товчны бичээсээр
        ///    хүргэнэ (`set_compliance_badge`, 2-4).  Самбарыг кодоос
        ///    нээх нь файл нээх бүрд ~300 px ба фокус хулгайлна.
        /// </summary>
        public static string BadgeCaption(Result r)
        {
            if (r == null || r.Groups.Count == 0) return "Норм\nшалгалт";
            return "Норм\nшалгалт (" + r.Groups.Count + ")";
        }
    }
}
```

### 3.5 `AssistantPane.xaml` + `.xaml.cs` — ТАСАЛДАЛГҮЙ гадаргуу ба МОНГОЛ мөрүүд

**Хийх зүйл** (цэгэн засварууд):

| # | Файл:мөр | Өөрчлөлт |
|---|---|---|
| 1 | `AssistantPane.xaml:378` орчим | «Δ өөрчлөлт» самбарын ДАРАА `FindingsExpander` нэмнэ — АНХДАГЧААР ХУМИГДСАН (`IsExpanded="False"`). Гарчиг нь `FindingsHeaderText` |
| 2 | `AssistantPane.xaml` (шинэ) | `<ScrollViewer VerticalScrollBarVisibility="Auto" MaxHeight="230">` дотор `<ItemsControl x:Name="FindingsBox">` — `:379-380`-ийн хэв маягийг БАЙТ БАЙТААР давтана |
| 3 | `AssistantPane.xaml.cs` конструктор (`:259` орчим) | `FindingsBox.ItemsSource = _findings;` — `ChangesBox`-ийн хажууд |
| 4 | `AssistantPane.xaml.cs` (шинэ) | `public void PublishFindings(FindingFeed.Result r)` — цорын ганц оруулах цэг |
| 5 | `AssistantPane.xaml.cs` (шинэ) | `FindingRow_Click` → `goto_element` (`Task.Run`-аар, ХЭЗЭЭ Ч UI thread-ээс шууд) |
| 6 | `AssistantPane.xaml.cs` (шинэ) | `FindingAck_Click`, `FindingOverride_Click` |

```csharp
        /// <summary>
        /// Дүгнэлтийг самбарт нийтэлнэ.  ⚠️ ЦОРЫН ГАНЦ ОРУУЛАХ ЦЭГ.
        ///
        /// ⚠️ ЯАГААД ЭНД `SetBusy` ДУУДАХГҮЙ ВЭ: `SetBusy` нь
        ///    `Mouse.OverrideCursor`-ыг тавьдаг (`AssistantPane.xaml.cs:351`)
        ///    ба тэр нь WPF-д АПП ДАЯАР үйлчилнэ.  Дэвсгэрийн шалгалтад
        ///    түүнийг дуудвал инженер юу ч блоклогдоогүй байхад Revit-ийн
        ///    бүх цонхонд «завгүй» курсор хараад ГАЦСАН гэж ойлгоно.
        ///
        /// ⚠️ ЯАГААД ЭНД `Show()` БАЙХГҮЙ ВЭ: add-in дахь цорын ганц
        ///    `pane.Show()` нь `AssistantPaneProvider.cs:54` — хэрэглэгчийн
        ///    ribbon товч.  Самбар нь `:27`-д ЗАЛХУУ singleton тул ХААЛТТАЙ
        ///    байхад ч цуглуулга нь шинэчлэгдэнэ; тоо нь ribbon-ы бичээсээр
        ///    хүрнэ (`set_compliance_badge`).
        ///
        /// ⚠️ ЯАГААД ЭНД `Focus()` БАЙХГҮЙ ВЭ: add-in дахь цорын ганц
        ///    `Focus()` нь `:1874` — хүн 👎 дарж, өөрөө бичихээр шийдсэний
        ///    ДАРАА.  Автомат урсгал фокус авдаггүй.
        /// </summary>
        public void PublishFindings(FindingFeed.Result r)
        {
            // Дуудагч нь ЗААВАЛ UI thread дээр байна (2-4-ийн COLD зүсэлт).
            _findings.Clear();
            if (r == null) return;

            foreach (FindingFeed.Group g in r.Groups)
            {
                _findings.Add(RowOf(g.Primary, isPrimary: true, stale: g.Primary.IsStale));
                foreach (FindingFeed.Item c in g.Consequences)
                    _findings.Add(RowOf(c, isPrimary: false, stale: c.IsStale));
                if (g.ConsequenceTotal > g.Consequences.Count)
                {
                    _findings.Add(NoteRow(Lang.T(
                        "…бас " + (g.ConsequenceTotal - g.Consequences.Count) + " дагавар",
                        "…and " + (g.ConsequenceTotal - g.Consequences.Count) + " more consequences")));
                }
            }

            // ⚠️ Таслагдсаныг ИЛ хэлнэ — «санамсаргүй N»-г БҮРЭН жагсаалт гэж
            //    ойлгуулах нь `ChangeReport.cs:56-60`-ийн тэмдэглэсэн алдаа.
            if (r.Truncated > 0)
                _findings.Add(NoteRow(Lang.T(
                    "+" + r.Truncated + " бүлэг харагдаагүй — хүнд байдлаар эрэмбэлэв.",
                    "+" + r.Truncated + " groups not shown — sorted by severity.")));

            FindingsHeaderText.Text = r.Groups.Count == 0
                ? Lang.T("Норм шалгалт — анхаарах зүйл алга",
                         "Compliance — nothing to review")
                : Lang.T("Норм шалгалт (" + r.Groups.Count + ")",
                         "Compliance (" + r.Groups.Count + ")");
        }
```

**МОНГОЛ UI МӨРҮҮД — ТӨЛӨВ БҮРД.** (`Lang.T(mn, en)` хос; `Lang.cs:102-113`-ийн дагуу түлхүүрийн хүснэгт БИШ, мөрөн дотор.)

| Төлөв | Монгол мөр | English |
|---|---|---|
| Эрх LEVEL 0 | «Ажиглалт горим — дүрмийн үр дүн хараахан харагдахгүй.» | Observe mode — results are not surfaced yet. |
| Дүгнэлт алга | «Одоогоор анхаарах зүйл алга.» | Nothing to review right now. |
| Verdict `VIOLATION` | «Зөрчил» | Violation |
| Verdict `WARNING` | «Анхааруулга» | Warning |
| Verdict `UNCERTAIN` | «Тодорхойгүй — хүн шалгана» | Uncertain — needs a human |
| Verdict `PASS` | «Тэнцсэн» | Pass |
| Class `REGULATORY_VIOLATION` | «Нормын зөрчил» | Regulatory violation |
| Class `MODEL_QUALITY` | «Загварын чанар» | Model quality |
| Class `PROJECT_INCOMPLETENESS` | «Төслийн мэдээлэл дутуу» | Project incompleteness |
| Class `TEAM_STANDARD` | «Багийн стандарт» | Team standard |
| Class `UNKNOWN_NEEDS_REVIEW` | «Хүн шалгах шаардлагатай» | Needs review |
| Evidence `RULE_BACKED` | «Эх сурвалж: {code} {clause}, {edition}» | Source: {code} {clause}, {edition} |
| Evidence `MODEL_DERIVED` | «Дотоод шалгуур (эх сурвалж баталгаажаагүй)» | Internal check (source unverified) |
| Evidence `HUMAN_VERIFIED` | «Хүн баталсан: {name}, {date}» | Verified by {name}, {date} |
| Evidence `AI_INFERRED` | «AI-ийн таамаг — норм БИШ. Заавал хүн шалгана.» | AI inference — not a regulation. Must be checked. |
| Evidence `UNKNOWN` | «Эх сурвалж тодорхойгүй — тооцоонд авахгүй.» | Unknown provenance — not counted. |
| Хуучирсан | «дахин шалгах шаардлагатай» | needs re-check |
| Үндэс | «Үндсэн шалтгаан» | Primary cause |
| Дагавар | «Үүнээс үүдсэн» | Caused by the above |
| Үсрэх товч | «Элемент рүү очих» | Go to element |
| Хүлээн зөвшөөрөх | «Ойлголоо» | Acknowledged |
| Хойшлуулах | «Дараа» | Later |
| Хүчингүй болгох | «Хүчингүй болгох» | Override |
| Хүчингүй болгосны дараа | «Хаагдлаа. Дүгнэлт устаагүй — түүхэнд үлдэнэ.» | Closed. The finding is not deleted — it stays in the record. |
| Хамрах хүрээ | «Дүрмийн багц {ruleset_version}-ээр шалгав.» | Checked against rule set {ruleset_version}. |
| Хэсэгчилсэн | «{M}/{N} дүрэм шалгагдав.» | {M} of {N} rules evaluated. |
| Багц танигдаагүй | «Дүрмийн багц танигдсангүй — үр дүнг тооцоонд авахгүй.» | Unrecognised rule pack — results are not counted. |
| Баг МЭДЭГДЭЖ байгаа ч багцгүй (MGMT·EZ·GT) | «Баг: {team_code} (дүрмийн багцгүй)» | Team: {team_code} — no rule pack |
| Баг тодорхойлогдоогүй (`team_source='uncertain'`) | «Баг: тодорхойгүй» | Team: unknown |

⚠️ **Эдгээр сүүлийн ХОЁР мөрийг ХЭЗЭЭ Ч ХОЛИХГҮЙ** (залруулга 2026-08-30, `2-1` §3.4-ийн «ДҮРМИЙН БАГЦГҮЙ БАГ» харьцуулах хүснэгт). Багцгүй баг нь илрүүлэлт УНАСАН гэсэн үг БИШ: `team_code` нь бодит код (`MGMT` / `EZ` / `GT`), `team_source` нь шатны бодит эх сурвалж, `team_confidence` нь бодит утга, `learning_events` нь ТЭР КОДООР шошголсон хэвээр — зөвхөн нийцлийн шалгалт алгасагдана (`complianceEnabled` → `false`). Тиймээс:

- Багцгүй багийн chip нь **МЭДЭГДЭЖ БУЙ баг** гэж уншигдана — «Баг: EZ (дүрмийн багцгүй)». «тодорхойгүй» гэдэг үг тэнд ГАРАХГҮЙ.
- Тэр chip нь **ДАРАГДАХГҮЙ, залруулга ХҮСЭХГҮЙ** — §73-ын «баг сонгох» урсгал нь ЗӨВХӨН `team_source='uncertain'`-д хамаарна. Аль хэдийн ЗӨВ харьяалалтыг «залруул» гэж асуух нь хэрэглэгчийг буруу мэдээллээр төөрөгдүүлнэ.
- ⛔ Багцгүй баг нь ӨӨР БАГИЙН дүрэм рүү **ХЭЗЭЭ Ч УНАХГҮЙ** — багц алга бол шалгалт АЛГА, орлуулга БИШ (v2 §48-R6).

⚠️ **«баталгаажлаа», «нийцэж байна», «зөвшөөрөгдлөө» гэсэн үг UI-д ХЭЗЭЭ Ч гарахгүй** — §69-R3 «This should never be a legal certification» (v2:2238).

### 3.6 `revit-mcp/addin/Nudges.cs` — ЗӨВХӨН ТАЙЛБАР (релиз N-д ХОЛБОХГҮЙ)

```diff
     public const int MaxPerDay = 2;
+
+    // ⚠️ ЭНЭ ТООГ НОРМЫН ДҮГНЭЛТИЙН ТӨЛӨӨ БҮҮ НЭМ (Track 2-5, 2026-08-30).
+    //    Энэ файлын толгойд «өдөрт 8 удаа гарвал хүн add-in-ыг унтраана»
+    //    гэж бичсэн нь эзний R7 («огт гацалт байхгүй») ҮГ ЧАНД.  Норм
+    //    шалгалт нь релиз N-д TАТАХ загвараар (ribbon-ы бичээс + самбар)
+    //    хүрнэ, ТҮЛХЭХ мэдэгдэл ОГТ гаргахгүй.
+    //
+    // ⚠️ РЕЛИЗ N+1-д сануулга холбох УРЬДЧИЛСАН НӨХЦӨЛ:
+    //    доорх `Ctx`-ийн `Busy` / `AwaitingAnswer` / `Suppressed` /
+    //    `SecondsSinceTyping` нь бүгд WPF САМБАРЫН төлөв.  Арын thread
+    //    тэднийг аюулгүй уншиж ЧАДАХГҮЙ, `Dispatcher.Invoke` нь `Gate`
+    //    барих thread-ээс deadlock.  Тиймээс самбар нь UI үйл явдал бүрд
+    //    ХӨДӨЛГӨШГҮЙ `Ctx` агшныг `volatile` талбарт нийтэлсний ДАРАА л
+    //    жолоодогч бичигдэнэ.  Энэ нөхцөлгүйгээр холбох нь эсвэл
+    //    залгидаг catch руу cross-thread шидэж (төсөв ЧИМЭЭГҮЙ утгагүй
+    //    болно), эсвэл Revit-ийг гацаана.
```

⚠️ Энэ бол КОМПИЛЯЦИД НӨЛӨӨЛӨХГҮЙ өөрчлөлт. `check_nudge.py` (gate 7) хэвээр ногоон байна.

### 3.7 Frontend — курацийн хуудсанд ДӨРӨВ ДЭХ таб

**Хоёр дахь хянах хуудас БАРИХГҮЙ.** `AssistantCurationPage.tsx:44`-ийн массивыг өргөтгөнө:

```ts
const CURATION_TABS = ['pending', 'reviewed', 'examples', 'overrides'] as const;
```

`KeepAliveTabs`-д нэг `TabsTrigger` + нэг `KeepAliveTabsPanel`, дотор нь:

```tsx
<KeepAliveTabsPanel value="overrides">
  <section id="sec-assistant-overrides" className="scroll-mt-24">
    <OverridesTab currentUserId={currentUserId} isAdmin={isAdmin} />
  </section>
</KeepAliveTabsPanel>
```

⚠️ `useTabParam` ХЭВЭЭР (`:49`). `useState` руу буцаах нь глобал хайлтын гүн холбоосыг ЧИМЭЭГҮЙ эвдэнэ (`AssistantCurationPage.tsx:41-43`-ийн тайлбар).

`frontend/src/shared/lib/search/sections.ts` — `:587`-ийн ДАРАА НЭГ мөр:

```ts
  {
    page: '/app/admin/assistant',
    to: '/app/admin/assistant?tab=overrides',
    labelKey: 'assistantCuration.overridesTab',
    keywords: 'хүчингүй болголт зөрчил татгалзал override false positive норм дүгнэлт',
  },
```

`OverridesTab.tsx` (ШИНЭ) нь `PendingTab.tsx`-ийн бүтцийг давтана: багана нь `override_kind` (монгол шошготой), `reason`, `verdict_at_override`, `severity_at_override`, `evidence_level_at_override`, `rule_uid @ rule_version`, `ruleset_version`, `created_by`, `created_at`; үйлдэл нь `POST /api/compliance/overrides/:id/review` дээр `reviewed` | `verified` | `rejected` — `ReviewDialogs.tsx`-ийн `review_note` Textarea-г ДАХИН АШИГЛАНА.

**i18n түлхүүрүүд** — `mn.json` БА `en.json` ХОЁУЛАНД (одоо тус бүр 4054 түлхүүр, зөрүү ТЭГ; хавтгай цэгтэй түлхүүр, `mn.json:4761`-ийн хэв маяг):

```json
"assistantCuration.overridesTab": "Хүчингүй болголт",
"assistantCuration.overrides.empty": "Хүчингүй болголт алга.",
"assistantCuration.overrides.kind.FALSE_POSITIVE": "Худал дохио — дүрэм буруу ажиллав",
"assistantCuration.overrides.kind.RULE_WRONG": "Дүрмийн утга буруу",
"assistantCuration.overrides.kind.NOT_APPLICABLE_HERE": "Энэ тохиолдолд хамаарахгүй",
"assistantCuration.overrides.kind.ACCEPTED_RISK": "Мэдсээр байж хүлээн зөвшөөрөв",
"assistantCuration.overrides.kind.DESIGN_EXCEPTION": "Зөвшөөрөгдсөн онцгой шийдэл",
"assistantCuration.overrides.kind.DUPLICATE": "Давхардсан",
"assistantCuration.overrides.review.verified": "Зөв — сургалтад оруулна",
"assistantCuration.overrides.review.reviewed": "Хараад дуусгав",
"assistantCuration.overrides.review.rejected": "Татгалзав",
"assistantCuration.overrides.alreadyReviewed": "Энэ бүртгэл аль хэдийн хянагдсан.",
"assistantCuration.overrides.hint": "Хянасны дараа л сургалтын багцад орно. Дүгнэлт нь устдаггүй."
```

### 3.8 `revit-mcp/training/check_findingfeed.py` — ШИНЭ хаалга

`check_nudge.py`-ийн хэв маягийг БАЙТ БАЙТААР давтана: түр `.csproj` үүсгээд `<Compile Include="…/FindingFeed.cs" />` ГАНЦ файл оруулж, `dotnet run` хийнэ. Revit шаардахгүй.

**Заавал шалгах тохиолдлууд (наад зах нь 12):**

| # | Тохиолдол | Хүлээгдэх |
|---|---|---|
| 1 | Хоосон оролт | `Groups.Count == 0`, онцгой шидэхгүй |
| 2 | `null` элемент жагсаалтад | алгасна, унахгүй |
| 3 | CRITICAL + INFO холимог | CRITICAL нь ЭХЭНД |
| 4 | Ижил хүнд байдал, өөр цаг | сүүлд илрүүлсэн нь ДЭЭР |
| 5 | Үндэс + 3 дагавар | `Primary` нь үндэс, `Consequences.Count == 3` |
| 6 | Үндэс + 20 дагавар | `Consequences.Count == 9`, `ConsequenceTotal == 20` |
| 7 | Үндэс хүлээн зөвшөөрөгдсөн | хамгийн хүнд дагавар нь `Primary` болно, бүлэг алга болохгүй |
| 8 | 100 дүгнэлт, `MaxVisible = 40` | `Groups.Count == 40`, `Truncated == 60` |
| 9 | 100 дүгнэлт, 1 нь CRITICAL сүүлд | CRITICAL нь ХАРАГДАНА (эрэмбэ → таслалт) |
| 10 | Хүлээн зөвшөөрсний 3 хоногийн дараа | нуугдана, `Hidden` нэмэгдэнэ |
| 11 | Хүлээн зөвшөөрсний 8 хоногийн дараа | ДАХИН харагдана |
| 12 | `minSeverityRank = 1` (HIGH) | MEDIUM/LOW/INFO нуугдана |
| 13 | Хуучирсан мөр | `AnyStale == true`, ижил хүнд байдалд ДООР |
| 14 | `BadgeCaption` 0 бүлэгтэй | тоо БАЙХГҮЙ мөр |

⚠️ **9 дэх тохиолдол нь энэ файлын оршин байх шалтгаан.** Эрэмбэлэхээс өмнө таслах алдаа нь яг тэнд л баригдана.

### 3.9 §80 — ЭРХИЙН ТҮВШИН БА РЕЛИЗ N

**Зургаан түвшин (v2:2524-2529, БАЙТ БАЙТААР):**

| № | Түвшин | Юу зөвшөөрөгдөнө | Релиз N |
|---|---|---|---|
| 0 | `LEVEL 0 — OBSERVE` | цуглуулна, ХАРУУЛАХГҮЙ | ✅ ЭНД ЗОГСОНО |
| 1 | `LEVEL 1 — EXPLAIN` | харуулна + ЯАГААД (заалт, тооцоо) | ❌ |
| 2 | `LEVEL 2 — RECOMMEND` | + засварыг ТЕКСТЭЭР санал болгоно | ❌ |
| 3 | `LEVEL 3 — PREVIEW` | + өөрчлөлтийг урьдчилан харуулна | ❌ |
| 4 | `LEVEL 4 — HUMAN-APPROVED EXECUTE` | + хүн зөвшөөрвөл БИЧНЭ | ❌ |
| 5 | `LEVEL 5 — LIMITED AUTONOMOUS EXECUTE` | + өөрөө БИЧНЭ | ❌ |

**Релиз N нь LEVEL 0-д гарна: `app_settings['bim.compliance.authority_level'] = '0'`.** DLL нь БҮРЭН үнэлэгч, багц ачаалагч, `FindingFeed`, илгээгч, эрүүл мэндийн тайланг агуулна — гэхдээ бүгд ХАРАНХУЙ.

**Дэвших ҮНЭ (энэ бол бүх дизайны гол шалтгаан):**

```
LEVEL 0 → LEVEL 1 → LEVEL 2
  = 1 × UPDATE app_settings SET value='1' WHERE key='bim.compliance.authority_level'
  + 1 × дүрмийн багц нийтлэлт (одоо байгаа `?have=` сувгаар)

  DLL БАЙХГҮЙ · Install.bat БАЙХГҮЙ · 20 PC БАЙХГҮЙ · Revit хаах БАЙХГҮЙ
```

⚠️ Дэвшилт нь **үе шаттай**: `bim.compliance.rollout_pct` (анхдагч `'0'`) нь `machine_hash`-ыг 0–99 болгож хэшлээд харьцуулна. Эхний бодит багц 1–2 машинд очно, 20-д БИШ.

**Яагаад эхний өдөр LEVEL 1-ээс дээш ГАРАХГҮЙ вэ — ЗУРГААН БЛОКЕР:**

| # | Блокер | Нотолгоо |
|---|---|---|
| 1 | `eval/golden/rules.json` нь ХООСОН ба `"frozen": true`; `run_golden.py` нь required хуваарь хоосон үед **exit 2** | Файлын өөрийн `_note` нь `revit-mcp/CLAUDE.md`-ийн тоог golden болгохыг ХОРИГЛОНО |
| 2 | Репо дахь БНбД тоонууд нь **өөрсдөө баталгаажаагүй** | `revit-mcp/CLAUDE.md:7-12` — «design-guidance values … not verified against the current official БНбД / MNS» |
| 3 | `revit-mcp/addin/` дээр C# тест **ТЭГ** | `find revit-mcp -iname '*test*'` → зөвхөн Python/PS файлууд |
| 4 | Хоцролтын суурь **хэмжигдээгүй** | `revit-mcp/dist/` байхгүй, CI байхгүй, `timing.log` нь ЗӨВХӨН локал (512 KB, нэг эргэлт) |
| 5 | `Nudges` нь бүтээгдэхүүнд **дуудагдаж байгаагүй** | §2.8-ийн grep |
| 6 | ~20 PC дээр **авто-шинэчлэл байхгүй** | `Install.bat`, Revit хаалттай — муу дүрмийг алсаас БУЦААХ БОЛОМЖГҮЙ |

**§80-R3 — түвшин бүрд ТУСДАА хаалга.** `assistant_models.eval_passed` (`0213:44`) нь ГАНЦ boolean тул энэ шаардлагыг илэрхийлж ЧАДАХГҮЙ. Тиймээс `2-6`-ийн `model_capabilities` хүснэгтэд `authority_level` багана орно, ба нийтлэлийн хаалга нь `revit.ts:1970-1973`-ийн **ГУРВАН НӨХЦӨЛИЙГ** БАЙТ БАЙТААР хуулна:

```
passed === true   БА   blocked.length === 0   БА   eval.model_version === нийтлэх хувилбар
```

бөгөөд **INSERT-ЭЭС ӨМНӨ** шалгагдана (`revit.ts:1996`). Унасан гүйлт нь амьд төлөвт ХҮРЭХГҮЙ.

**ЯАГААД ЗАСВАР ХЭЗЭЭ Ч АВТОМАТААР ХЭРЭГЖИХГҮЙ ВЭ:**

1. **§45-R2-ийн дараалал ачаалалтай** — «detect problems proactively» нь «eventually execute validated fixes»-ээс ӨМНӨ. Илрүүлэлт нь өөрөө хараахан хэмжигдээгүй.
2. **`DocumentChanged` дотор баримт нь УНШИХ ЗОРИУЛАЛТТАЙ** (`ChangeTracker.cs:764-775`) — гүйлгээ ОГТ БОЛОХГҮЙ.
3. **`RevitToolBus`-ийн зүсэлт дотор бичих нь загварыг эргүүлж болохгүй байдлаар өөрчилнө** — `call.Abandoned` нь ЗӨВХӨН гүйцэтгэхээс ӨМНӨ шалгагддаг (`RevitToolBus.cs:474`), тиймээс эхэлсэн бичилтийг цуцлах БОЛОМЖГҮЙ.
4. **Алсаас буцаах зам байхгүй** — муу авто-засвар нь 20 PC дээр гараар суулгах ажил.

**Ирээдүйн засвар ямар байх ЁСТОЙ вэ** (одоо ХЭРЭГЖҮҮЛЭХГҮЙ, зөвхөн тодорхойлолт): ил хэрэглэгчийн үйлдэл (товч дарна) → COLD зурвасын хэрэгсэл → `using (var t = new Transaction(doc, "MGL: <rule_uid> засвар")) { t.Start(); … t.Commit(); }` → амжилтгүй бол `t.RollBack()` → `learning_events`-д `HUMAN_CORRECTION` мөр. `BatchSheetCommand` ба `GridDimensioner` нь энэ хэв маягийн бэлэн жишиг; хоёулаа **баталгаажуулах цонх ХҮЛЭЭЖ БАЙГАА** тул холбогдоогүй.

---

## 4. ХӨНДӨЖ БОЛОХГҮЙ (load-bearing)

| Юу | Хаана (баталгаажсан) | Яагаад эвдрэх вэ |
|---|---|---|
| `pane.Show()`-ыг кодоос дуудахгүй | `AssistantPaneProvider.cs:54` — add-in дахь ГАНЦ Show() | Файл нээх бүрд ~300 px ба фокус хулгайлна. R7-ийн хамгийн магадлалтай регресс; самбар нь `:27`-д залхуу singleton тул хэрэггүй ч |
| Автомат `Focus()` хийхгүй | `AssistantPane.xaml.cs:1874` — ГАНЦ Focus(), 👎-ийн дараа | Хүн Revit-д бичиж байхад гар нь өөр талбар руу үсэрнэ — тасалдлын хамгийн муу хэлбэр |
| Дэвсгэрийн ажилд `SetBusy` дуудахгүй | `AssistantPane.xaml.cs:341-352`, курсор `:351` | `Mouse.OverrideCursor` нь АПП ДАЯАР — юу ч блоклогдоогүй байхад Revit бүхэлдээ гацсан мэт харагдана |
| ЭРЭМБЭЛЭХЭЭС ӨМНӨ таслахгүй | `ChangeReport.cs:56-60`, зөв хэв маяг `:321-326` | «санамсаргүй N»-г БҮРЭН жагсаалт гэж үзээд үлдсэн зөрчлийг засахгүй. Дүгнэлтийн хувьд илүү аюултай |
| Виртуалжуулаагүй жагсаалтад хязгааргүй мөр нэмэхгүй | `AssistantPane.xaml:342`, `:380`, `:396` | `ItemsControl` нь мөр бүрийг бүтээж санах ойд үлдээнэ — render дамжлага өөрөө гацал болно |
| `evidence_level`-д `source_type`-ыг ДАХИН АШИГЛАХГҮЙ | `0215:51-55` (8 утга, DB CHECK) | `RULE_BACKED` нь CHECK-д БАЙХГҮЙ — INSERT «CHECK constraint failed» өгнө; шипсэн баганыг гуйвуулна |
| `learning_events.provenance`-той нэгтгэхгүй | `bimEvents.ts:245-252` (6 утга, CHECK БАЙХГҮЙ) | Хоёр таксономи аль хэдийн зөрчиж байна; гуравдахийг нэгтгэвэл «энэ дүгнэлт нотолгоотой юу» гэсэн асуулт SQL-ээр хариулагдахаа болино |
| ХОЁР ДАХЬ хянах хуудас барихгүй | `AssistantCurationPage.tsx:44-79`, `sections.ts:571-588` | §68-ийн бүртгэлийг хоёр газар хуваана; татгалзлын үгсийн сан хоёр болж, `2-6`-ийн тэнцэх дүрэм тодорхойгүй болно |
| `useTabParam`-ыг `useState` болгохгүй | `AssistantCurationPage.tsx:41-43`, `:49` | Глобал хайлтын `?tab=` гүн холбоос ЧИМЭЭГҮЙ эвдэрнэ |
| UI-д «баталгаажлаа» гэж бичихгүй | v2:2238 «This should never be a legal certification» | Мэргэжлийн хариуцлагын асуудал. «Дүрмийн багц X-ээр шалгав» гэсэн хэллэг л зөвшөөрөгдөнө |
| `Nudges.MaxPerDay`-г нэмэхгүй | `Nudges.cs:24-26`, `:34` | Файлын толгой нь өөрөө «өдөрт 8 удаа гарвал хүн add-in-ыг унтраана» гэж бичсэн — R7 ҮГ ЧАНД |
| `finding_overrides`-д `REFERENCES compliance_findings` тавихгүй | 1B-1 §2.6-ийн хэмжилт | `ON DELETE SET NULL` нь хүүхдийн UPDATE болж, нэмэгдэх-л trigger асааж, эцгийн DELETE-ийг БҮХЭЛД нь ABORT хийнэ |
| `purpose === 'mcp'` токеныг татгалзахгүй | `middleware/auth.ts:101-102`, `types.ts:209-212`, `tokenValidity.ts:30-34` | Add-in бүх REST дуудлагаа тэр токеноор хийдэг, refresh БАЙХГҮЙ. Алсаас буцаах БОЛОМЖГҮЙ |
| `users` / `projects`-ыг `migrations apply`-аар дахин барихгүй | 19 / 33 каскад хүүхэд | Хүүхдийн бүх мөр устана |
| `END;` том үсгээр, өөрийн мөрөнд | `0206_bim_append_only.sql:6` ба бусад 7 | wrangler-ийн салгагч том/жижиг үсэг ялгана — файл хагас хэрэгжинэ |

---

## 5. ДАРААЛАЛ БА ХАМААРАЛ

**Урьдчилсан нөхцөл:**

| # | Нөхцөл | Хэрхэн шалгах |
|---|---|---|
| 1 | `compliance_findings` (`2-3`-ийн 0224) хэрэгжсэн | `wrangler d1 execute … --command "SELECT name FROM sqlite_master WHERE name='compliance_findings'"` |
| 2 | `finding_edges` (`2-3`-ийн 0225) хэрэгжсэн | ижил асуулга, `name='finding_edges'` |
| 3 | `backend/src/routes/compliance.ts` үүсээд `index.ts`-д mount хийгдсэн | `grep -n "api/compliance" backend/src/index.ts backend/src/lib/modules.ts` |
| 4 | `2-2`-ийн `rules.verification_state` заалтын хавчаар бэлэн | `grep -n "verification_state" backend/src/lib/complianceModel.ts` |
| 5 | Миграц 0212–0216 продакшнд ХЭРЭГЖСЭН | §7-ийн 5 дугаар блок (ТААМАГ — §9-2) |

**Deploy дараалал:**

```
1. cd backend
   npx wrangler d1 migrations apply mgl-progress-db-v3 --remote --config wrangler.toml
   └─ 0237 нь ЭНД гарна.  ШИНЭ БАГАНА НЬ ТҮҮНИЙГ УНШДАГ КОДООС
      ХАТУУ ӨМНӨХ deploy-Д ГАРНА.
   ▼
2. npx wrangler deploy --config wrangler.toml
   └─ complianceModel.ts + compliance.ts-ийн шинэ хандлагчид
   ▼
3. cd ../frontend && npm run verify && npx -y wrangler@latest pages deploy dist \
     --project-name mgl-design-system --branch main
   └─ Курацийн 4 дэх таб
   ▼
4. C# (FindingFeed.cs, AssistantPane, Nudges тайлбар) — deploy ХИЙХГҮЙ.
   Track 2-ийн НЭГ релизэд багцлагдана.
```

**⚠️ 1 → 2 дараалал АЧААЛАЛТАЙ.** `finding_overrides` байхгүй байхад роут гарвал `POST /override` нь «no such table» өгнө, ба клиент түүнийг сүлжээний алдаа гэж харуулна.

### ЗЭРЭГЦЭЭ ХИЙГДЭЖ БОЛОХ Track 2 файлууд

Эзэн хурдыг хүссэн. Доорх нь ЗЭРЭГЦЭЭ ажиллана:

| Файл | Зэрэгцээ? | Яагаад |
|---|---|---|
| `2-1-team-context` | ✅ БҮРЭН | 0217–0219 — өөр хүснэгт, өөр роут. Огт огтлолцохгүй |
| `2-2-rule-model` | ✅ БҮРЭН | 0220–0223. Энэ файл нь `verification_state`-ийг ЗӨВХӨН УНШИНА; гэрээ нь контекст багцад бэхлэгдсэн |
| `2-3-compliance-engine` | ⚠️ ХЭСЭГЧИЛСЭН | **0224–0225** (`compliance_findings` · `finding_elements`/`finding_teams`/`finding_edges`) нь ЭНЭ файлаас ӨМНӨ хэрэгжинэ. `complianceModel.ts` ба `compliance.ts` нь ХУВААЛЦСАН — өөр блок нэмнэ, байгааг ХӨНДӨХГҮЙ |
| `2-4-nonblocking-runtime` | ✅ БҮРЭН | 0226–0228 ба 0230 (`authority_level` нь **0230**-д — 0229-ийн мөргөлдөөн ШИЙДЭГДСЭН, `2-0-OWNER-BRIEF` §3.5). `FindingFeed`-ийг ДУУДАГЧ нь тэнд, ТОДОРХОЙЛОЛТ нь энд — гэрээ (`Build`, `Result`, `BadgeCaption`) энэ файлд бичигдсэн |
| `2-6-team-training` | ✅ БҮРЭН (энэ файлаас ХОЙШ) | 0238–0240. `finding_overrides.review_state`-ийг УНШИНА |
| `2-7-readiness-and-quality` | ✅ БҮРЭН (энэ файлаас ХОЙШ) | Migration БАЙХГҮЙ. `override_kind = 'FALSE_POSITIVE'`-ыг УНШИНА |
| `2-8-install-and-health` | ✅ БҮРЭН | 0241–0242 |

**Хэрэгжүүлэлтийн долгион:** долгион 1 = 2-1, 2-2, 2-4, 2-8 · долгион 2 = 2-3, 2-6 · **долгион 3 = 2-5 (ЭНЭ), 2-7**.

### Дараа нь юу ирэх вэ

| Сесс | Энэ файлаас юуг хэрэглэх вэ |
|---|---|
| `2-6-team-training` | `finding_overrides` нь `review_state IN ('reviewed','verified')` болсны дараа л сургалтын нэр дэвшигч. `EVIDENCE_RENDER[x].trainingCandidate` нь эхний шүүлт |
| `2-7-readiness-and-quality` | `override_kind = 'FALSE_POSITIVE'` = §66-ийн худал дохио; `'ACCEPTED_RISK'` нь худал дохио БИШ. `EVIDENCE_RENDER[x].countsForReadiness` нь §69-ийн тоологчийн шүүлт |
| Track 2-ийн релиз | `FindingFeed.cs` + `AssistantPane` өөрчлөлт нь НЭГ zip-д |

---

## 6. ХҮЛЭЭН АВАХ ШАЛГУУР

### Миграц

- [ ] `ls backend/migrations | tail -5` нь `0237_finding_overrides.sql`-ыг ХАМГИЙН СҮҮЛД харуулна
- [ ] Файл дотор ӨӨРИЙН мэдэгдэл **яг 4** (1 table + 2 index + 1 trigger)
- [ ] `grep -c "^END;" backend/migrations/0237_finding_overrides.sql` → **1**
- [ ] `grep -n "end;" backend/migrations/0237_finding_overrides.sql` → **гаралт БАЙХГҮЙ** (жижиг үсэг байхгүй)
- [ ] `grep -c "/\*" backend/migrations/0237_finding_overrides.sql` — блок тайлбар нь ЗӨВХӨН баганын бүлгийн тэмдэглэгээ, мөр дотор `;` БАЙХГҮЙ
- [ ] `grep -n "REFERENCES compliance_findings" backend/migrations/0237_finding_overrides.sql` → **гаралт БАЙХГҮЙ**
- [ ] `grep -c "IF NOT EXISTS" backend/migrations/0237_finding_overrides.sql` → **4**
- [ ] Хэрэгжсэний дараа: `PRAGMA table_info(finding_overrides)` → **26 багана**
- [ ] `UPDATE finding_overrides SET reason='x' WHERE id=1` → **`SQLITE_CONSTRAINT: … immutable …`**
- [ ] Нэг мөрийг хянана → 200; ижил мөрийг ДАХИН хянана → **409**
- [ ] `node backend/scripts/check-bim-events.mjs` → ногоон (bind тоо ӨӨРЧЛӨГДӨӨГҮЙ)

### Backend

- [ ] `cd backend && npx tsc --noEmit` → өөрийн файлууд дээр алдаа БАЙХГҮЙ
- [ ] `cd backend && npm test` → өмнөхтэй ижил тоо (регресс БАЙХГҮЙ)
- [ ] `POST /findings/:id/override` шалтгаангүйгээр → **400**
- [ ] `POST /findings/:id/override` танихгүй `override_kind`-аар → **400**
- [ ] Өөр хүний дүгнэлт дээр engineer-ээр → **403**; senior-ээр → **201**
- [ ] Амжилттай override-ийн ДАРАА: `SELECT verdict, severity, evidence_level FROM compliance_findings WHERE id=?` → **ӨӨРЧЛӨГДӨӨГҮЙ**; `lifecycle_state` → `'DISMISSED'`
- [ ] `SELECT COUNT(*) FROM finding_overrides WHERE finding_id=?` → **1**, `review_state='pending'`
- [ ] `GET /findings` нь `AI_INFERRED` мөрөнд `citation` талбарыг **null** буцаана
- [ ] `GET /findings` нь `MODEL_DERIVED` мөрөнд `verdict` нь `'VIOLATION'` **БАЙХГҮЙ**
- [ ] `GET /authority` нь LEVEL 0 дээр `caps.surface === false`
- [ ] `authorityFromSetting('9')`, `('')`, `(null)`, `('abc')` → бүгд **`'OBSERVE'`**
- [ ] `worker` дүрээр `GET /api/compliance/findings` → **403** (`workerScope`-ийн зөвшөөрлийн жагсаалтад байхгүй)

### C#

- [ ] `grep -rn "Autodesk.Revit" revit-mcp/addin/FindingFeed.cs` → **гаралт БАЙХГҮЙ**
- [ ] `grep -rn "Dispatcher\|Show()\|Focus()\|SetBusy" revit-mcp/addin/FindingFeed.cs` → **гаралт БАЙХГҮЙ**
- [ ] `python revit-mcp/training/check_findingfeed.py` → **14/14 ногоон**
- [ ] `python revit-mcp/training/check_nudge.py` → ХЭВЭЭР ногоон (тайлбарын өөрчлөлт)
- [ ] `grep -c "pane.Show()" revit-mcp/addin/*.cs` → **1** (ХЭВЭЭР)
- [ ] `grep -c "\.Focus()" revit-mcp/addin/AssistantPane.xaml.cs` → **1** (ХЭВЭЭР)
- [ ] `grep -n "SetBusy" revit-mcp/addin/AssistantPane.xaml.cs` — `PublishFindings` дотор БАЙХГҮЙ
- [ ] `dotnet build RevitMcpAddin.csproj -c "Release R24" -p:Platform=x64` → амжилттай (net48 БАС компиляц хийгдэнэ)

### Frontend

- [ ] `cd frontend && npm run verify` → ногоон
- [ ] `/app/admin/assistant?tab=overrides` → 4 дэх таб нээгдэнэ
- [ ] Хуудсыг сэргээхэд таб ХЭВЭЭР `overrides` (`useTabParam`, `useState` БИШ)
- [ ] Глобал хайлтад «хүчингүй» гэж бичихэд «Хүчингүй болголт» мөр гарна
- [ ] `node -e "const a=require('./src/shared/i18n/mn.json'),b=require('./src/shared/i18n/en.json');console.log(Object.keys(a).length, Object.keys(b).length)"` → **хоёр тоо ТЭНЦҮҮ**
- [ ] Гараар: engineer дүрээр `/app/admin/assistant` → `/app` руу шилжинэ
- [ ] Гараар: хянасан мөр дээр товч идэвхгүй, «Энэ бүртгэл аль хэдийн хянагдсан.» гарна

### Гараар (Revit нээлттэй — автоматжуулах боломжгүй)

- [ ] `authority_level = '0'` үед самбарт «Ажиглалт горим…» гарч, дүгнэлт ХАРАГДАХГҮЙ
- [ ] `'1'` болгосны дараа Revit ДАХИН ЭХЛҮҮЛЭХГҮЙГЭЭР дүгнэлт гарна (багц дахин ачаалагдана)
- [ ] Дүгнэлт гарахад самбар өөрөө НЭЭГДЭХГҮЙ, фокус хулгайлагдахгүй, курсор ӨӨРЧЛӨГДӨХГҮЙ
- [ ] Ribbon-ы «Норм шалгалт (N)» бичээс самбар ХААЛТТАЙ үед шинэчлэгдэнэ
- [ ] Мөр дээр дарахад харагдац солигдож, элемент сонгогдож, ойртоно — цонх ГАРАХГҮЙ
- [ ] «Хүчингүй болгох» → шалтгаан бичих → «Хаагдлаа. Дүгнэлт устаагүй…» гарна
- [ ] «Ойлголоо» дарсан мөр Revit дахин эхлүүлэхэд ЭРГЭЖ ГАРАХГҮЙ (сервер талын төлөв)
- [ ] Багцгүй баг (MGMT/EZ/GT) шийдэгдсэн сессид chip нь «Баг: EZ (дүрмийн багцгүй)» гэж бодит кодоор гарна — «тодорхойгүй» гэж ГАРАХГҮЙ, залруулга ХҮСЭХГҮЙ, өөр багийн дүрэм ажиллуулахгүй (`2-1` §3.4)
- [ ] Хамрах хүрээ: `git status --short` нь §0-ийн жагсаалтаас ГАДУУР файл харуулахгүй

---

## 7. ШАЛГАХ КОМАНД

```bash
# ⚠️ ЭНЭ БЛОК НЬ ДАРААЛЛААР АЖИЛЛАНА.  Эхний `cd` нь БҮХ доорх замыг
#    тодорхойлно — доор cwd нь `backend/`, 9 дүгээр блокоос хойш `frontend/`,
#    10 дугаараас хойш `revit-mcp/training/`.  Мөр бүрийг ХУУЛААД ажиллуулна.
cd backend

# --- 1. МИГРАЦИЙН ДУГААР (бичихийн ӨМНӨ) ---
ls migrations | tail -5
# Хүлээгдэх: ... 0216_assistant_log_timing.sql
# 0237 нь эзэнгүй байх ЁСТОЙ.  Эзэлсэн бол README-ийн нөөцөөс (0231–0236) ав.

node --test src/lib/migrationSchema.test.ts
# Хүлээгдэх: pass.  Энэ хамгаалалт нь 0214/0215-ийн `reviewed_at` мөргөлдөөнөөс төрсөн.

# --- 2. МИГРАЦИЙН ТРАНСПОРТЫН ДҮРЭМ ---
awk '/;\s*$/ {n++} END {print "мэдэгдэл:", n}' migrations/0237_finding_overrides.sql
# Хүлээгдэх: 5 (4 өөрийн + trigger-ийн дотоод SELECT).  Дээд хязгаар 7 + 1.

grep -c "^END;" migrations/0237_finding_overrides.sql   # Хүлээгдэх: 1
grep -n  "end;" migrations/0237_finding_overrides.sql   # Хүлээгдэх: гаралт БАЙХГҮЙ
grep -c  "IF NOT EXISTS" migrations/0237_finding_overrides.sql   # Хүлээгдэх: 4
grep -n  "REFERENCES compliance_findings" migrations/0237_finding_overrides.sql
# Хүлээгдэх: гаралт БАЙХГҮЙ (1B-1 §2.6 — trigger нь эцгийн DELETE-ийг ABORT хийнэ)

# --- 3. ГАДАРГУУГИЙН ИНВАРИАНТУУД (C#) ---
# ⚠️ cwd нь `backend/` тул add-in руу `../` -аар очно.
grep -c "pane.Show()" ../revit-mcp/addin/*.cs | grep -v ":0"
# Хүлээгдэх: ../revit-mcp/addin/AssistantPaneProvider.cs:1  — ӨӨР ФАЙЛ БАЙХГҮЙ

grep -n "\.Focus()" ../revit-mcp/addin/AssistantPane.xaml.cs
# Хүлээгдэх: 1874:            FeedbackNoteBox.Focus();   — ганц мөр

grep -rn "Autodesk.Revit\|Dispatcher\|Mouse.OverrideCursor" ../revit-mcp/addin/FindingFeed.cs
# Хүлээгдэх: гаралт БАЙХГҮЙ

# --- 4. ИТГЭЛИЙН ТАКСОНОМИ ХОЛИЛДООГҮЙ ЭСЭХ ---
grep -n "RULE_BACKED\|AI_INFERRED" migrations/*.sql
# Хүлээгдэх: гаралт БАЙХГҮЙ — эдгээр нь `source_type`-д ХЭЗЭЭ Ч ОРОХГҮЙ

grep -n "EVIDENCE_LEVELS\|EVIDENCE_RENDER" src/lib/complianceModel.ts
# Хүлээгдэх: тус бүр 1 тодорхойлолт

# --- 5. МИГРАЦИЙН ТӨЛӨВ ПРОДАКШНД (ТААМАГ — §9-2-ыг хаана) ---
npx wrangler d1 execute mgl-progress-db-v3 --remote --config wrangler.toml \
  --command "SELECT name FROM d1_migrations ORDER BY id DESC LIMIT 25"
# Хүлээгдэх: 0212…0216 ба `2-3`-ийн 0224…0225 нь ЖАГСААЛТАД БАЙНА.

# --- 6. МИГРАЦ ХЭРЭГЖҮҮЛЭХ ---
npx wrangler d1 migrations apply mgl-progress-db-v3 --remote --config wrangler.toml
# Хүлээгдэх: «0237_finding_overrides.sql … ✅»

npx wrangler d1 execute mgl-progress-db-v3 --remote --config wrangler.toml \
  --command "SELECT COUNT(*) AS cols FROM pragma_table_info('finding_overrides')"
# Хүлээгдэх: cols = 26

# --- 7. ХӨДӨЛГӨШГҮЙ БАЙДЛЫГ ТУРШИХ ---
npx wrangler d1 execute mgl-progress-db-v3 --remote --config wrangler.toml \
  --command "INSERT INTO finding_overrides (finding_id, dedup_key, override_kind, reason, verdict_at_override, severity_at_override, evidence_level_at_override) VALUES (999999,'test0000','FALSE_POSITIVE','туршилтын шалтгаан','WARNING','LOW','MODEL_DERIVED')"
npx wrangler d1 execute mgl-progress-db-v3 --remote --config wrangler.toml \
  --command "UPDATE finding_overrides SET reason='өөрчлөв' WHERE dedup_key='test0000'"
# Хүлээгдэх: ⚠️ АЛДАА — «finding_overrides: record is immutable…»
npx wrangler d1 execute mgl-progress-db-v3 --remote --config wrangler.toml \
  --command "DELETE FROM finding_overrides WHERE dedup_key='test0000'"

# --- 8. BACKEND DEPLOY ---
npx tsc --noEmit && npm test
npx wrangler deploy --config wrangler.toml

# --- 9. FRONTEND (cwd нь `backend/` тул `../frontend`) ---
cd ../frontend && npm run verify
node -e "const a=require('./src/shared/i18n/mn.json'),b=require('./src/shared/i18n/en.json');const A=Object.keys(a),B=Object.keys(b);console.log('mn',A.length,'en',B.length,'зөрүү',A.filter(k=>!(k in b)).concat(B.filter(k=>!(k in a))).length)"
# Хүлээгдэх: зөрүү 0
npx -y wrangler@latest pages deploy dist --project-name mgl-design-system --branch main
npx -y wrangler@latest pages deployment list --project-name mgl-design-system | head -3
# Хүлээгдэх: дээд мөр нь ЭНЭ commit

# --- 10. C# (компиляц + шинэ хаалга; РЕЛИЗ БИШ) ---
# cwd нь `frontend/` тул `../revit-mcp/training`.
cd ../revit-mcp/training && python check_findingfeed.py   # Хүлээгдэх: 14/14
python check_nudge.py                                     # Хүлээгдэх: ХЭВЭЭР ногоон

# --- 11. ХАМРАХ ХҮРЭЭНИЙ ХЯНАЛТ ---
# ⚠️ `git status --short` нь ЗАМЫГ cwd-ээс хамааруулж хэвлэнэ — РЕПОГИЙН ҮНДЭС рүү буц.
cd ../..
git status --short
git diff --stat
# ЗӨВШӨӨРӨГДСӨН ЗАМУУД, ӨӨР ЮУ Ч БИШ:
#   backend/migrations/0237_finding_overrides.sql
#   backend/src/lib/complianceModel.ts
#   backend/src/routes/compliance.ts
#   revit-mcp/addin/FindingFeed.cs
#   revit-mcp/addin/Nudges.cs
#   revit-mcp/addin/AssistantPane.xaml
#   revit-mcp/addin/AssistantPane.xaml.cs
#   frontend/src/features/revit-assistant/AssistantCurationPage.tsx
#   frontend/src/features/revit-assistant/components/OverridesTab.tsx
#   frontend/src/shared/lib/search/sections.ts
#   frontend/src/shared/i18n/mn.json
#   frontend/src/shared/i18n/en.json
#   revit-mcp/training/check_findingfeed.py
#   docs/bim-ai/2-5-finding-surface.md
# git add -A БҮҮ хэрэглэ — файл бүрийг нэрээр нь нэм.
```

---

## 8. ROLLBACK

### 8.1 Миграц хэрэгжүүлэхээс ӨМНӨ

Файлыг устгана. **Өгөгдлийн эрсдэл: ТЭГ.** Дугаар нь эргэж ашиглагдана.

### 8.2 Миграц хэрэгжсэний ДАРАА

| Юу | Хэрхэн буцаах |
|---|---|
| `finding_overrides` хүснэгт | **БУЦААХГҮЙ.** Хоосон хүснэгт нь юуг ч эвдэхгүй; `DROP` нь `d1_migrations` мөртэй зөрчилдөнө |
| Trigger | `DROP TRIGGER IF EXISTS finding_overrides_append_only` — ШИНЭ дугаартай файлаар |
| Хоёр индекс | Ижил — ШИНЭ дугаар |

**⚠️ ШИНЭ ДУГААР ЗААВАЛ** — хэрэгжсэн файлыг засах нь продакшн дээр **ЧИМЭЭГҮЙ NO-OP**: локалд ногоон, продакшнд юу ч болохгүй.

### 8.3 Файл дунд унасан бол

`migrations apply` нь файлыг `d1_migrations` INSERT-тэй хамт НЭГ `--command` болгоно. Дунд нь унавал **хүснэгт үүссэн ч `d1_migrations` мөр БИЧИГДЭХГҮЙ** — дараагийн `apply` нь ижил файлыг дахин ажиллуулж, `CREATE TABLE` нь `IF NOT EXISTS`-ээс болж алгасана. Тиймээс мэдэгдэл бүр `IF NOT EXISTS`. Хэрэв дараагийн `apply` ч унавал:

```bash
npx wrangler d1 execute mgl-progress-db-v3 --remote --config wrangler.toml \
  --command "SELECT name FROM sqlite_master WHERE name LIKE 'finding_overrides%'"
```

Хүснэгт + 2 индекс + trigger бүгд байвал **гараар** бүртгэнэ:

```bash
npx wrangler d1 execute mgl-progress-db-v3 --remote --config wrangler.toml \
  --command "INSERT INTO d1_migrations (name) VALUES ('0237_finding_overrides.sql')"
```

### 8.4 Worker / Pages

| Юу | Хэрхэн |
|---|---|
| Worker | Өмнөх commit-оос `npx wrangler deploy --config wrangler.toml`. Шинэ хандлагч алга болно; хүснэгт үлдэнэ |
| Pages | Өмнөх commit-оос `pages deploy`. ⚠️ «хамгийн шинэ production deployment ялна» — `pages deployment list`-ээр ЗААВАЛ шалга |
| Edge cache | `/api/compliance` нь `withEdgeCache` ХЭРЭГЛЭХГҮЙ (өөрийгөө л харах инвариант) — цэвэрлэх зүйл БАЙХГҮЙ |
| C# | Deploy хийгээгүй тул буцаах зүйл БАЙХГҮЙ |

**Rollback-ийн шалгуур.** Дараах ГУРВАН шинжийн АЛЬ НЭГ гарвал буцаана: (1) Revit-ийн курсор дэвсгэрийн шалгалтын үед «завгүй» болж эхэлсэн; (2) самбар нь хэрэглэгчийн зөвшөөрөлгүй нээгдсэн, эсвэл фокус хулгайлагдсан; (3) курацийн хуудасны байгаа гурван таб алдаа өгсөн. Эхний хоёр нь R7-ийн шууд зөрчил ба **хэлэлцэлгүй буцаана**.

**Өгөгдлийн эрсдэл: ТЭГ.** Энэ сесс нь мөр УСТГАДАГГҮЙ; `compliance_findings`-д хийх цорын ганц UPDATE нь `lifecycle_state` — `verdict`, `severity`, `evidence_level` нь SET хэсэгт БАЙХГҮЙ.

---

## 9. ЭХЛЭХИЙН ӨМНӨ ТОДРУУЛАХ

> Эдгээрийг репогоос ХАРИУЛАХ БОЛОМЖГҮЙ — эзэн эсвэл продакшны асуулга шаардана.

### 9.1 Продакшны асуулга шаардлагатай (эхлэхээс өмнө нэг удаа)

```bash
cd backend

# a) Багийн жагсаалт.  ⚠️ РОСТЕР нь ШИЙДЭГДСЭН — ЭЗЭН БАТАЛСАН 2026-08-30:
#    дүрмийн багц авах салбар нь ЯГ НАЙМ (BA · BB · HAS · TSBU · TSAH · HD ·
#    AU · IZ, v2 §46); MGMT · EZ · GT нь багц АВАХГҮЙ.  Энэ асуулга нь одоо
#    РОСТЕР БАТАЛГААЖУУЛАХ БИШ — продакшнд НЭМЭЛТ код үүссэн эсэхийг л
#    шалгана.  ⚠️ ЗАЛРУУЛГА 2026-08-30: багцгүй код нь `TEAM = UNCERTAIN`
#    БИШ — илрүүлэлт АМЖИЛТТАЙ, `team_code` нь бодит код, `team_source`
#    нь шатны бодит эх сурвалж, зөвхөн шалгалт алгасагдана (`2-1` §3.4).
#    ТЭМДЭГЛЭЛ (үнэнч байдлын үүднээс): эзэнд `0007_teams.sql`-ийн ЕСӨН
#    мөрийг үзүүлж, «MGMT-ийг хасаад үлдсэн 8» гэж хариулсан.  EZ, GT
#    (0074-өөр дараа нэмэгдсэн) нь түүнд НЭРЭЭР нь тусад нь асуугдаагүй —
#    гэвч тэд бүтцээрээ наймын ГАДНА, ба төслийн блокийн угтварын баг
#    болохоос салбарын инженерийн баг БИШ тул дүгнэлт хэвээр.  Энэ нь
#    ХААЛТ БИШ, тэмдэглэл.  Багийн бодит
#    ГИШҮҮНИЙ ТОО нь ЭНЭ МАШИНААС БАТАЛГААЖААГҮЙ хэвээр (Cloudflare API
#    алдаа 7403).  Тоог хатуу бичихийг ХОРИГЛОСОН хэвээр.
npx wrangler d1 execute mgl-progress-db-v3 --remote --config wrangler.toml \
  --command "SELECT code, name_mn, sort_order FROM teams ORDER BY sort_order"

# b) Миграц 0212–0216 ба `2-3`-ийн 0224–0225 ХЭРЭГЖСЭН эсэх
npx wrangler d1 execute mgl-progress-db-v3 --remote --config wrangler.toml \
  --command "SELECT name FROM d1_migrations ORDER BY id DESC LIMIT 25"

# c) 0237 дугаар эзэнгүй эсэх (сесс агентууд зэрэг дугаар авдаг)
ls migrations | tail -5
```

### 9.2 Техникийн — прод/алсын D1 дээр л шалгагдана

| # | Асуулт | Яагаад чухал | Хэрхэн олох |
|---|---|---|---|
| 1 | ~~**Багийн жинхэнэ жагсаалт ямар вэ?**~~ **✅ ХААГДСАН — ЭЗЭН БАТАЛСАН 2026-08-30: салбарын баг НАЙМ** (BA · BB · HAS · TSBU · TSAH · HD · AU · IZ), MGMT · EZ · GT нь багцгүй (v2 §46) | §69-ийн «Team checks: n/n» нь ТООЦООЛОГДСОН хэвээр, литерал БИШ — хуваарь нь төсөлд оролцож БУЙ, ба багцТАЙ багуудын огтлолцол. Багийн ГИШҮҮНИЙ ТОО нь баталгаажаагүй хэвээр | 9.1-a |
| 2 | **0212–0216 продакшнд хэрэгжсэн үү?** | Хэрэв үгүй бол add-in аль хэдийн байхгүй багана руу `addin_version`, `timing_json` бичиж байна — ЭНЭ ДОКУМЕНТЭД ТААМАГ хэвээр | 9.1-b |
| 3 | **`2-3`-ийн 0224–0225 (`compliance_findings`, `finding_elements`/`finding_teams`/`finding_edges`) хэрэгжсэн үү?** | Энэ сессийн ҮНДСЭН урьдчилсан нөхцөл. Байхгүй бол 0237 нь эзэнгүй гадаад түлхүүртэй үлдэнэ | 9.1-b |
| 4 | **`bim.compliance.authority_level` мөр `app_settings`-д байгаа юу?** | `2-4` нь түүнийг `0230_compliance_authority.sql`-д үүсгэнэ. Байхгүй бол `authorityFromSetting(null)` нь `'OBSERVE'` руу унана — АЮУЛГҮЙ, гэхдээ дэвшилт боломжгүй. ⚠️ **0229-ийн мөргөлдөөн ШИЙДЭГДСЭН** (`2-0-OWNER-BRIEF` §3.5): 0229 нь `2-3`-ынх (`rule_run_ledger`), `2-4`-ийн `compliance_authority` нь **0230** руу шилжсэн. ЭНЭ ФАЙЛД нөлөөлөхгүй (0237 нь тусдаа) | `SELECT * FROM app_settings WHERE key LIKE 'bim.compliance.%'` · `README.md:133-142` |

### 9.3 Хэмжигдээгүй — хэн ч тоолоогүй

| # | Асуулт | Яагаад чухал |
|---|---|---|
| 5 | **Нэг инженер өдөрт хэдэн дүгнэлт хүлээж авах вэ?** | `MaxVisible = 40`, `MaxConsequencesShown = 9`, `SnoozeDays = 7` нь бүгд ТААМАГ. 1B-1 §9 нь үйл явдлын хурдыг «ХЭН Ч ХЭМЖЭЭГҮЙ» гэж бичсэн. Нэг өдрийн хэмжилт эдгээр гурван тоог шийднэ |
| 6 | **Инженер дүгнэлт гарснаас хойш хэдэн секундын дотор хүлээж байна?** | Энэ дизайны БҮТЦИЙН доод хязгаар нь ~4 сек (3 сек debounce + 50 мс автобусны poll + үнэлгээ), ба `Gate.Wait(0)`-ийн алгасалт түүнийг хэдэн арван секунд болгож УРТАСГАНА — ЗОРИУД |

### 9.4 Эзний шийдвэр — инженерийн биш

| # | Асуулт | Юуг өөрчлөх вэ |
|---|---|---|
| 7 | **Хүчингүй болголтыг ХЭН хийж чадах вэ?** Санал: дүгнэлтийг илрүүлсэн хүн ӨӨРӨӨ + менежер (admin\|senior). Өөр хувилбар: зөвхөн менежер | Зөвхөн менежер бол инженер өөрийн «худал дохио»-г тэмдэглэж чадахгүй — §66-ийн хамгийн хямд эх сурвалж алдагдана |
| 8 | **Хүчингүй болголтыг ХЭН хянах вэ?** Санал: `requireManager()` (0215 §9.2-ийн «хувилбар A»-тай ижил) | Дөрвөн нүдний дүрэм (`AND created_by <> ?`) нэмэх эсэх нь эзний шийдвэр |
| 9 | **`ACCEPTED_RISK` хүчингүй болголт нь §69-ийн бэлэн байдлын хаалганд ТООЛОГДОХ уу?** Санал: ТООЛОГДОНО — «мэдсээр байж давсан зөрчил» нь ЗӨРЧИЛ хэвээр | Тоологдохгүй бол хаалгыг «бүгдийг хүлээн зөвшөөрөх»-өөр ногоон болгож болно |
| 10 | **ТҮЛХЭХ мэдэгдэлгүй (зөвхөн ribbon-ы бичээс + самбар) нь релиз N-д ХАНГАЛТТАЙ юу?** | R2/R6-ийн «immediately states» / «realtime» хэллэгийг проактив мэдэгдэл гэж уншиж болно. Хангалтгүй бол N+1-д НЭГ сануулгын үүр нэмнэ — `volatile Ctx` урьдчилсан нөхцөлийн ард |
| 11 | **Дүгнэлтийг ӨӨР ХҮН харж болох уу?** Санал: ҮГҮЙ — өөрийгөө л харах инвариант, багийн түвшинд зөвхөн НЭГТГЭЛ | BA-гийн senior төслийн бүх дүгнэлтийг харах шаардлагатай гэж үзвэл дөрвөн миграцийн толгойд бичигдэж, тестээр түгжигдсэн дүрэм өөрчлөгдөнө |
| 12 | **Албан ёсны БНбД PDF-ийг ХЭН авах вэ?** | Тэдгүйгээр ямар ч дүрэм КОД хэвлэх эрхгүй (§65 + `2-2`-ийн хавчаар) — бүтээгдэхүүн зөвхөн «дотоод шалгуур» гэж хэлж чадна. R2/R5/R6-ийн ЭГЗЭГТЭЙ ЗАМ, ЭЗЭНГҮЙ |
| 13 | **Ажилтны мэдэгдэл, гэрээ ШИНЭЧЛЭГДСЭН үү?** | Дүгнэлт нь элементийн id, өрөөний нэр, хэмжээг агуулна — үйл явдлын санхаас ЧАНГА илүү. Commit `9fe82a0` нь «Ажилтны мэдэгдэл, гэрээ ЗААВАЛ шинэчлэгдэнэ» гэж бичсэн, `notice_version` нь ИРЭЭДҮЙН огноо |
| 14 | **Эрхийн түвшнийг ХЭН дэвшүүлэх эрхтэй вэ?** Санал: зөвхөн `admin`, ба `rollout_pct`-ээр 1–2 машинаас | LEVEL 0 → 1 нь НЭГ `app_settings` UPDATE. Хэн дарж болохыг тодорхойлохгүй бол «түвшин бүрд тусдаа хаалга» (§80-R3) нь бодит биш |

### Хавсралт — ТААМАГ гэж тэмдэглэсэн зүйлс

Доорхийг энэ сесс **БАТАЛГААЖУУЛААГҮЙ**:

- Продакшн D1-ийн ямар ч төлөв (миграцийн жагсаалт, `teams` мөрүүд, `app_settings` мөрүүд) — Cloudflare API алдаа **7403 not authorized** тул хүрэх боломжгүй байв.
- `compliance_findings`, `finding_edges`, `finding_elements`, `finding_teams`, `rule_run_ledger`-ийн ЯГ баганын нэрс — тэдгээрийг `2-3` үүсгэнэ. Энэ файлын SQL нь контекст багцын нэрсийг ашигласан; `2-3` хэрэгжсэний ДАРАА `PRAGMA table_info`-оор тулгана.
- `set_compliance_badge` COLD хэрэгслийн гарын үсэг — `2-4`-ийнх. `FindingFeed.BadgeCaption` нь мөр буцаадаг тул интерфейс тогтвортой.
- `dotnet` энэ машин дээр БАЙХГҮЙ (`which dotnet` → олдсонгүй), тиймээс `check_findingfeed.py` ба net48 компиляцийг ЭНД ажиллуулж чадаагүй — Windows машин дээр ажиллуулна.
- `revit-mcp/dist/` БАЙХГҮЙ, add-in-ийн релиз артефакт ОГТ байхгүй — тиймээс «C# нь НЭГ релизэд» гэсэн төлөвлөгөө нь Track 2-ийн бүх C# файл дуусахаас өмнө шалгагдах боломжгүй.
