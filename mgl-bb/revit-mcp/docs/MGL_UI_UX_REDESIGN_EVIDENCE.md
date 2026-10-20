# MGL UI/UX redesign — Session 0 evidence (static analysis @ 07934ebb)

Raw investigator reports behind [`MGL_UI_UX_REDESIGN.md`](MGL_UI_UX_REDESIGN.md). Written by read-only agents that quoted file:line evidence; **static analysis, nothing observed in live Revit**. Line numbers are at the baseline commit and drift — the code is authoritative. Slices that were *not* completed (stopped on request): Smart/export engines truth table, infra/API probe, docs/text systems; those facts were gathered in-line during the phases that needed them and are recorded in the main file.

Contents: A. Ribbon and every external command · B. Account/Settings/WorkPane/Assistant/Intelligence · C. XAML dialogs, FamilyHub, accessibility · D. Visual system, theming, sizing · E. UI surface inventory · F. Drawing/reinforcement tool truth tables.



---

<!-- slice A: ribbon -->

# Slice A — Ribbon and every external command (baseline 07934ebb, add-in 1.13.0)

**Method and limits.** Static reading plus grep only. Nothing here was observed in a running Revit. Anything about on-screen width, collapse, or command-id derivation is marked **NEEDS LIVE CHECK**. All paths are relative to `revit-mcp/addin/` unless they start with `revit-mcp/`. Line numbers are at 07934ebb. Mongolian strings are verbatim; `\n` is a literal newline in the source string. Double spaces after full stops are preserved.

## 0. Headline facts

- There is **one ribbon tab**, created at App.cs:559-563. The default name is `MGL`. The env var `MGL_RIBBON_TAB` overrides it (also in `revit-mcp/README.md:217`).
- Three files register panels, all with `application.CreateRibbonPanel(tabName, …)`:
  - `App.cs` creates 4 panels.
  - `Smart/Revit/SmartRibbon.cs` creates 1 panel.
  - `Reinforcement/RfRibbon.cs` creates 2 panels.
  - No other file registers a ribbon tab, panel, button, context menu, or contextual-help item. Grep over all `.cs` found only the three files above.
- **Panel creation order** (the `Smart` and `Арматур/Түүвэр` panels are inserted by the calls at App.cs:816 and 821, between «Загвар» and «Тохиргоо»):
  1. «Ажлын явц» (App.cs:602)
  2. «Сайт руу илгээх» (App.cs:658)
  3. «Загвар» (App.cs:703)
  4. «Smart» (SmartRibbon.cs:31)
  5. «Арматур» (RfRibbon.cs:32)
  6. «Түүвэр» (RfRibbon.cs:90)
  7. «Тохиргоо» (App.cs:825)
- **Counts by build:**

  | Build | Buttons | Panels | Missing vs R25–R27 |
  |---|---|---|---|
  | R25 / R26 / R27 | **23** | **7** | none |
  | R24 (net48) | **17** | **6** | `MglWorkPane`, `MglFamilyHub`, the whole «Smart» panel (4 buttons) |

- Every one of the 23 buttons is `panel.AddItem(PushButtonData)`. There is no `AddStackedItems`, pulldown, split button, slide-out, separator, `ToolTipImage` or `ContextualHelp` anywhere. Large vs stacked is therefore decided only by the call shape. Revit semantics for a single `AddItem` are **NEEDS LIVE CHECK**.
- Each button gets a 32 px `LargeImage` and a 16 px `Image` rendered from icon-font glyphs (`GlyphIcons.TryRender`, GlyphIcons.cs). If the font is missing, `TryRender` returns null and the button has no image (App.cs:536-541).
- There are **23 `IExternalCommand` classes and 23 buttons, one to one.** No command exists off the ribbon. Other entry points are listed in §2.2.
- Ribbon strings are hard-coded Mongolian literals (no `Lang.T`). The Reinforcement dialogs and reports go through `RfText` (`Lang.T(mn,en)`), but the Reinforcement ribbon strings do not.
- The three `Button`/`MakeButton` helpers are line-for-line equivalent: App.cs:513-544, SmartRibbon.cs:117-130 and RfRibbon.cs:124-137.
- Ribbon-build errors are swallowed without a log (App.cs:816 and App.cs:821, `try { … } catch { }`). A throw mid-panel silently drops the remaining buttons.

## 1. COMPLETE ribbon inventory

### 1.1 Table in registration order

Notes for the table:
- **Layout:** every row is a single `AddItem(PushButtonData)`. Large/small size is not set explicitly anywhere.
- **Command class:** all classes are in namespace `RevitMcpAddin.`
- **Availability:** `QtoCA` = `RevitMcpAddin.QtoCommandAvailability`; `ProgCA` = `ProgressCommandAvailability`; `PdfVA` = `PdfViewAvailability`; `AaAv` = `AutoAnnotate.AutoAnnotateAvailability`; `RfVA` = `Reinforcement.RfViewAvailability`. Each checks what §2.1 says.
- **Icon:** shown as "key (code points tried in order) · colour". Code points are Segoe Fluent Icons / MDL2.

| # | Panel | PushButtonData.Name (stable id) | Visible Text | Command class | Availability | Icon · colour | Compile condition | R24 | R25–R27 |
|---|---|---|---|---|---|---|---|---|---|
| 1 | Ажлын явц | `MglWorkPane` (App.cs:608) | `MGL\nажил` | `WorkPane.WorkPaneCommand` | `WorkPane.WorkPaneAvailability` (always true) | inline Glyph(E823,E121) · Work #3FB984 | `#if MGL_WORK_TRACKING` (App.cs:604) | – | ✔ |
| 2 | Ажлын явц | `MglAssistantPane` (:624) | `MGL\nтуслах` | `AssistantPaneCommand` | ProgCA | `GlyphIcons.Assistant` (E99A,E90A) · #D4A853 | none | ✔ | ✔ |
| 3 | Ажлын явц | `MglRevitBinding` (:641) | `Зураг\nхолбох` | `BindingCommand` | ProgCA | `GlyphIcons.Link` (E71B) · #1F9AA8 | none | ✔ | ✔ |
| 4 | Сайт руу илгээх | `MglQtoExport` (:661) | `Тоо\nхэмжээ` | `QtoExportCommand` | QtoCA | `GlyphIcons.Quantity` (E8EF,E9F9,E80A) · #4A7FA5 | none | ✔ | ✔ |
| 5 | Сайт руу илгээх | `MglPdfExport` (:674) | `PDF` | `PdfViewExportCommand` | PdfVA | `GlyphIcons.Pdf` (EA90,E8A5,E749) · #B87333 | none | ✔ | ✔ |
| 6 | Сайт руу илгээх | `MglScheduleExport` (:690) | `Хүснэгт` | `ScheduleExportCommand` | QtoCA | `GlyphIcons.Table` (E80A,EA98,E8A5) · #2E9E6B | none | ✔ | ✔ |
| 7 | Загвар | `MglBatchSheets` (:706) | `Хуудас\nүүсгэх` | `BatchSheetCommand` | QtoCA | `GlyphIcons.Sheets` (E7C4,E8A5,E7C3) · #7C6BC4 | none | ✔ | ✔ |
| 8 | Загвар | `MglSheetNumerator` (:720) | `Хуудас\nдугаарлах` | `SheetNumerator.SheetNumeratorCommand` | QtoCA | `GlyphIcons.SheetNumerator` (E8CB,E8FD) · #8BAE3E | none | ✔ | ✔ |
| 9 | Загвар | `MglCopyToOther` (:738) | `Хуулж\nтавих` | `CopyToOtherCommand` | QtoCA | `GlyphIcons.CopyTo` (E8C8,E16F) · #C75B7A | none | ✔ | ✔ |
| 10 | Загвар | `MglCloneDrawings` (:757) | `Зураг\nклонлох` | `CloneDrawings.CloneDrawingsCommand` | QtoCA | `GlyphIcons.CloneDrawings` (E8B9,F5ED,E8C8) · #E0833A | none | ✔ | ✔ |
| 11 | Загвар | `MglAutoAnnotate` (:778) | `Автомат\nхэмжээс` | `AutoAnnotate.AutoAnnotateCommand` | AaAv | `GlyphIcons.AutoAnnotate` (EB3C,ED5E) · #3B8FD9 | none | ✔ | ✔ |
| 12 | Загвар | `MglFamilyHub` (:799) | `Family\nHub` | `FamilyHub.Revit.FamilyHubCommand` | QtoCA | inline Glyph(E896,E8B7,E7C3) · **IconColors.Link #1F9AA8 (same colour as #3)** | `#if MGL_FAMILYHUB` (App.cs:795) | – | ✔ |
| 13 | Smart | `MglSmartImpact` (SmartRibbon.cs:45) | `Өөрчлөлтийн\nнөлөө` | `ChangeImpact.ChangeImpactCommand` | QtoCA | inline Glyph(E81C,E9F5) · #8E6FD8 | `#if MGL_SMART` (App.cs:814) | – | ✔ |
| 14 | Smart | `MglSmartCount` (:83) | `Smart\nCount` | `SmartCount.SmartCountCommand` | QtoCA | inline Glyph(E9D9,E8EF) · #D49A2A | same | – | ✔ |
| 15 | Smart | `MglSmartClash` (:64) | `Clash\nшалгах` | `ClashCheck.ClashCheckCommand` | QtoCA | inline Glyph(E7BA,E783) · #D9534F | same | – | ✔ |
| 16 | Smart | `MglSmartPublish` (:101) | `Smart\nPublish` | `SmartPublish.SmartPublishCommand` | QtoCA | inline Glyph(E898,E749) · #1F9A7A | same | – | ✔ |
| 17 | Арматур | `MglRebarEndSymbol` (RfRibbon.cs:35) | `Арматурын\nтөгсгөлийн тэмдэг` | `Reinforcement.RebarEndSymbolCommand` | RfVA | inline Glyph(E7C8,E81D,E7C1) · #C0504D | none | ✔ | ✔ |
| 18 | Арматур | `MglRebarSectionAnnotation` (:54) | `Огтлолын арматурын\nтэмдэглэгээ` | `Reinforcement.SectionAnnotationCommand` | RfVA | inline Glyph(E8EC,ED5E) · #D08A2E | none | ✔ | ✔ |
| 19 | Арматур | `MglRebarRefresh` (:76) | `Тэмдэглэгээ\nшинэчлэх` | `Reinforcement.RefreshAnnotationsCommand` | RfVA | inline Glyph(E72C,E895) · #4F9D69 | none | ✔ | ✔ |
| 20 | Түүвэр | `MglScheduleClone` (:93) | `Түүвэр\nхувилах` | `Reinforcement.ScheduleCloneCommand` | QtoCA | inline Glyph(E16F,E8C8) · #5B7DB1 | none | ✔ | ✔ |
| 21 | Түүвэр | `MglScheduleSync` (:110) | `Түүвэр\nсинк хийх` | `Reinforcement.ScheduleSyncCommand` | QtoCA | inline Glyph(E8AB,E895) · **#7C6BC4 (identical to `Sheets`, #7)** | none | ✔ | ✔ |
| 22 | Тохиргоо | `MglLicense` (App.cs:830) | `MGL\nнэвтрэлт` | `Licensing.LicenseCommand` | `Licensing.LicenseAvailability` (always true) | `GlyphIcons.Account` (E72E,E77B) · #C9A227 | none | ✔ | ✔ |
| 23 | Тохиргоо | `MglQtoSettings` (:846) | `Тохиргоо` | `QtoSettingsCommand` | **none** (App.cs:855 passes `null`) | `GlyphIcons.Settings` (E713,E9F5) · #8B94A0 | none | ✔ | ✔ |

**Compile-condition sources** (RevitMcpAddin.csproj):
- `MGL_WORK_TRACKING`, `MGL_FAMILYHUB`, `MGL_SMART` and `MGL_INTELLIGENCE` are defined only when `TargetFramework != net48`: csproj lines 187, 210, 226 and 174.
- `<Compile Remove>` is applied for net48 on `FamilyHub/**` (line 200), `WorkTracking/**` and `WorkPane/**` (213, 215), and `Smart/**`, `SmartPublish/**`, `SmartCount/**`, `ClashCheck/**`, `ChangeImpact/**` (229-233).
- `Reinforcement/**`, `CloneDrawings/**`, `AutoAnnotate/**`, `SheetNumerator/**` and `Licensing/**` have **no** `Compile Remove`, so they are compiled in R24.
- `installer/verify-bundle.ps1:59-60` requires the 5 Reinforcement command class names inside the DLL for **all** of 2024..2027.
- Colour duplicates are in App.cs:480-494, SmartRibbon.cs:17-20 and RfRibbon.cs:17-21. App.cs:476-478 says «Ижил төстэй хоёр товч нэг өнгөтэй байх ёсгүй» (similar buttons must not share a colour).
- Icon-code-point note: `GlyphIcons.CopyTo` = (E8C8,E16F) and `MglScheduleClone` = (E16F,E8C8) use the same two code points in swapped order. Whether they render identically needs a live check.
- Intelligence (`MGL_INTELLIGENCE`) and WorkTracking add no ribbon button of their own (hosts only). `MglWorkPane` is the only WorkTracking surface.

### 1.2 ToolTip and LongDescription, VERBATIM (all 23)

`LongDescription` is `data.LongDescription` (the extended tooltip). The final concatenated strings are given below.

**1. MglWorkPane** (App.cs:607-620)
- ToolTip: `Одоо аль таск дээр ажиллаж байгаагаа сонгоно — Revit-ийн идэвхтэй цаг автоматаар тоологдоно.`
- Long: `Start / Pause товч БАЙХГҮЙ: сонгосон таск дээр Revit урд, хулгана/гар идэвхтэй үед цаг өөрөө тоологдоно; 5 минут оролтгүй бол идэвхгүй болно.  Эндээс явц %, өдрийн тайлан илгээж, таскаа дуусгана (100% — дуусгалтын асуултуудтай).\n\nСүлжээгүй үед бүртгэл компьютерт хадгалагдаж, холболт сэргэхэд илгээгдэнэ.\n\nТовч ҮРГЭЛЖ идэвхтэй — файл нээгээгүй ч нэвтэрч болно.`

**2. MglAssistantPane** (App.cs:623-638)
- ToolTip: `Өдрийн ажлаа монголоор бичиж MGL сайт руу илгээнэ.`
- Long: `Хажуугийн самбарыг нээнэ.  Танд хуваарилагдсан ажлууд шууд гарна; гүйцэтгэлийн хувийг дэд ажлын жагсаалтаас тооцож, тэмдэглэлийг AI бэлдэнэ — та уншиж, зассаны дараа баталгаажуулж илгээнэ.  Танаас асуулгүйгээр юу ч илгээгдэхгүй.\n\nМөн «Δ» товчоор өнөөдөр юу өөрчилснөө хараад, мөр дээр дарж тэр элемент рүү нь шууд үсэрч болно.\n\nТовч бүдгэрэх нөхцөл: нээлттэй төсөл байхгүй, эсвэл Family засварлаж байна.`

**3. MglRevitBinding** (App.cs:640-655)
- ToolTip: `Revit-ийн хуудсуудыг MGL дээрх ажлуудтай холбоно.`
- Long: `ЗААВАЛ БИШ.  Холбоогүй ч «MGL туслах» дээр таны ажлууд харагдаж, явцаа илгээж болно.  Холбовол хоёр зүйл НЭМЭГДЭНЭ: дэд ажлын жагсаалт хуудсуудаас автоматаар үүсэх ба «энэ ажлын хуудсыг харуул» ажиллана.\n\nФайл тутамд нэг удаа хийхэд хангалттай: холбоос нь хуудасны дотоод танигчид (UniqueId) тулгуурладаг тул дугаар, нэр солигдсон ч тасрахгүй.\n\nТовч бүдгэрэх нөхцөл: нээлттэй төсөл байхгүй, эсвэл Family засварлаж байна.`

**4. MglQtoExport** (App.cs:660-671)
- ToolTip: `Загвар болон түүнд холбогдсон RVT файлуудаас тоо хэмжээг уншиж MGL сайт руу илгээнэ.`
- Long: `Загварыг ЗӨВХӨН УНШИНА — юу ч өөрчлөгдөхгүй.  Холбоос (link) файл бүр тусдаа илгээгдэнэ, учир нь вэб дээрх нэгтгэл файл тус бүрээр явдаг.\n\nТовч бүдгэрэх нөхцөл: нээлттэй төсөл байхгүй, эсвэл Family засварлаж байна.`

**5. MglPdfExport** (App.cs:673-687)
- ToolTip: `Идэвхтэй харагдацыг PDF болгон MGL сайт руу илгээнэ (модель өөрчлөгдөхгүй).`
- Long: `План болон огтлолын харагдацад тэнхлэгүүдийн (grid) хоорондох хэмжээсийг автоматаар тавьж PDF дээр гаргана.  Хэмжээсүүд ТҮР зүйл — экспортын дараа буцаагдах тул модель ч, буцаах (undo) түүх ч бохирдохгүй.\n\nХуудас, 3D, draft харагдацыг хэмжээсгүйгээр шууд PDF болгоно.\n\nТовч бүдгэрэх нөхцөл: идэвхтэй харагдац хэвлэгддэггүй төрлийнх (ж: хүснэгт, эхлэлийн хуудас) эсвэл харагдацын загвар (view template) байна.`

**6. MglScheduleExport** (App.cs:689-700)
- ToolTip: `Revit-ийн хүснэгтүүдийг (Schedule/Quantities) сонгож MGL сайт руу илгээнэ.`
- Long: `Сонголт нь загварт хадгалагдана — дараагийн удаа дахин дарахад ижил хүснэгтүүд шинэчлэгдэнэ.\n\nТовч бүдгэрэх нөхцөл: нээлттэй төсөл байхгүй, эсвэл Family засварлаж байна.`

**7. MglBatchSheets** (App.cs:705-717)
- ToolTip: `Олон хуудсыг нэг дор үүсгэнэ — параметр, эхлэх дугаар, тоо ширхэгээр.`
- Long: `Параметр (Classification / Sub-Discipline / Type Designator г.м.) сонгож, эхлэх дугаараас эхлээд заасан тоогоор хуудас үүсгэнэ.\n\nЭнэ нь загварыг ӨӨРЧИЛНӨ — үйлдлийг Ctrl+Z-ээр буцаана.\n\nТовч бүдгэрэх нөхцөл: нээлттэй төсөл байхгүй, эсвэл Family засварлаж байна.`

**8. MglSheetNumerator** (App.cs:719-735)
- ToolTip: `Зургийн хуудсыг Project Browser-ийн бүлэг дотор нь чирж эрэмбэлээд, дугаарыг нь нэг дор шинэчилнэ.`
- Long: `Хуудсуудыг Project Browser-ийн бүлгээр (хавтас, Sheet Collection, assembly) харуулна.  Хуудсыг ЗӨВХӨН ӨӨРИЙН бүлэг дотор чирж эрэмбэлнэ — өөр бүлэг рүү зөөхгүй.\n\nГоримууд: энгийн дугаарлалт (угтвар, эхлэх дугаар, орон, дагавар), нарийвчилсан (3 хэсэгт), одоогийн дугаарын тоон хэсгийг өсгөх/бууруулах, зөөхөд дугаарыг дагуулж шинэчлэх.  Урьдчилсан үр дүн цонхонд шууд харагдана; «Хэрэгжүүлэх» дарах хүртэл загвар ӨӨРЧЛӨГДӨХГҮЙ.\n\nХэрэгжүүлэхэд бүх өөрчлөлт НЭГ дор хийгдэнэ — алдаа гарвал бүгд буцаж, юу ч хадгалагдахгүй.  Энэ нь загварыг ӨӨРЧИЛНӨ — бүгдийг нэг Ctrl+Z-ээр буцаана.\n\nТовч бүдгэрэх нөхцөл: нээлттэй төсөл байхгүй, эсвэл Family засварлаж байна.`

**9. MglCopyToOther** (App.cs:737-754)
- ToolTip: `А хэсэгт хийсэн зүйлээ tag, хэмжээстэй нь Б хэсэг рүү хуулна.`
- Long: `1. Давхрын план нээнэ.\n2. Хуулах зүйлээ сонгоно (эсвэл товч дарсны дараа сонгоод «Finish»).\n3. A дээрх суурь цэгээ дарна — тэнхлэгийн огтлолцол г.м.\n4. B дээрх харгалзах цэгийг дарна — олон байршил дарж болно, Esc-ээр дуусна.\n\nЭлементүүд хуулагдаад, БҮХ харагдац (план, зүсэлт, фасад) дахь tag, өрөөний tag, хэмжээс нь шинэ элементүүд дээр нь дахин тавигдана.  Тэнхлэг, түвшин хуулагдахгүй; эргүүлэх, толин тусгал одоохондоо байхгүй.\n\nЭнэ нь загварыг ӨӨРЧИЛНӨ — бүгдийг нэг Ctrl+Z-ээр буцаана.\n\nТовч бүдгэрэх нөхцөл: нээлттэй төсөл байхгүй, эсвэл Family засварлаж байна.`

**10. MglCloneDrawings** (App.cs:756-775)
- ToolTip: `Нэг элементийн (загвар) зургийг — зүсэлт, хуудас, tag, хэмжээс — ижил төрлийн бусад элемент рүү хуулна.`
- Long: `1. Зураг нь бүрэн хийгдсэн ЗАГВАР элементээ сонгоно (жишээ нь B1 дам нуруу, C1 багана).\n2. Зорилтот элементүүдээ сонгоод «Finish» — эсвэл цонхноос «ижил төрлийн бүгд»-ийг нэмнэ.\n3. Цонхноос аль харагдац, юуг (tag, хэмжээс, 2D, хуудас) клонлохоо сонгоно.\n\nХарагдац гурван бүлэгт: загварын ӨӨРИЙН зураг (өгөгдмөлөөр сонгогдоно), ерөнхий харагдац, бусад элементийн зураг; хайлт ба төрлөөр (план, зүсэлт, 3D …) шүүнэ — шүүлтэд таарахгүй нь клонлогдохгүй.  Зорилтын урт, өндөр, эргэлт өөр байж болно: харагдацын хүрээ, tag-ийн байрлал тохирч, хэмжээс зорилтын нүүр рүү дахин холбогдоно.  Дахин ажиллуулахад давхардахгүй — өмнөхийг нь ашиглаж дутууг л нэмнэ.\n\n«Клонлох» дарсны дараа клонлолт АРЫН горимд явна — Revit-д үргэлжлүүлэн ажиллаж болно; явц (%), тайлан баруун талын «MGL — Зураг клонлох» самбарт.\n\nЭнэ нь загварыг ӨӨРЧИЛНӨ — алхам бүр тусдаа хадгалагдана; бүгдийг самбарын «Бүгдийг буцаах»-аар нэг дор буцаана.\n\nТовч бүдгэрэх нөхцөл: нээлттэй төсөл байхгүй, эсвэл Family засварлаж байна.`

**11. MglAutoAnnotate** (App.cs:777-793)
- ToolTip: `Идэвхтэй харагдацын элементийг таньж хэмжээс, tag-ийг ажлын зураг шиг автоматаар тавина.`
- Long: `План: барилгын тал бүрд гурван гинж — гадна ханын булан/цонх/хаалганы нүх, тэнхлэг хоорондын зай, нийт хэмжээ; дотор хананы зузаан ба өрөөний хэмжээ; хаалганы нүх; баганыг тэнхлэгт холбох; хаалга, цонх, өрөө, багана, дам нурууны tag.\nЗүсэлт, фасад: давхрын өндөр, тэнхлэг, цонх/хаалганы өндөр, tag.\n\nЦонхноос юуг тавихаа сонгоно.  Гараар тавьсан хэмжээс, tag хөндөгдөхгүй; дахин дарахад зөвхөн энэ хэрэгслийн өмнө тавьсныг солино (давхардахгүй).\n\nЭнэ нь загварыг ӨӨРЧИЛНӨ — бүгдийг нэг Ctrl+Z-ээр буцаана.\n\nТовч бүдгэрэх нөхцөл: идэвхтэй харагдац план, зүсэлт, фасад биш, эсвэл Family засварлаж байна.`

**12. MglFamilyHub** (App.cs:798-811)
- ToolTip: `Family хайж, шууд төсөлд ачаална (POC).`
- Long: `Нийтийн эх сурвалжаас family хайж, түр хавтсанд татаж, шалгаад (SHA-256, ZIP, хувилбар) төсөлд ачаална.  Аль хэдийн байгаа family дахин татагдахгүй («✓ IN PROJECT»).  Нэвтрэлт шаарддаг нийлүүлэгч «AUTH REQUIRED» гэж харагдана — тойрохгүй.\n\nТовч бүдгэрэх нөхцөл: нээлттэй төсөл байхгүй, эсвэл Family засварлаж байна.`

**13. MglSmartImpact** (SmartRibbon.cs:44-58)
- ToolTip: `Саяхан юу өөрчлөгдсөн, түүнд юу нөлөөлж болохыг (хуудас, харагдац, өрөө, tag) шалтгаантай нь харуулна.`
- Long: `Revit-ийн өөрчлөлтийг ТАНЫ ажиллах үеэр бүртгэж, элемент бүрээс хост, түвшин, tag, хэмжээс, өрөөний хил, харагдац, хуудас, MEP холболтоор нөлөөллийн графыг барина.\n\nНөлөө бүр ИТГЭЛИЙН түвшинтэй: «Шууд» (Revit-ийн тодорхой холбоо), «Магадлалтай», «Боломжтой» (таамаг). Таамаг хэзээ ч «шууд» болж ДЭЭШЛЭХГҮЙ.\n\nЗагварыг ӨӨРЧИЛӨХГҮЙ.\n\nТовч бүдгэрэх нөхцөл: нээлттэй төсөл байхгүй, эсвэл Family засварлаж байна.`

**14. MglSmartCount** (SmartRibbon.cs:82-95)
- ToolTip: `Элементийг ангилал, төрөл, давхар, параметрээр шүүж тоолно; хайлтаа хадгална.`
- Long: `Нөхцөл (AND/OR) байгуулж, дүнг ангилал/гэр бүл/төрөл/давхар/параметрээр бүлэглэн харна. Дүнгээс шууд сонгох, харуулах боломжтой (хэт том сонголтоос хамгаална).\n\nТоон параметр нэгжтэйгээ (мм, м², м³) зөв шалгагдана.\n\nЗагварыг ӨӨРЧИЛӨХГҮЙ.\n\nТовч бүдгэрэх нөхцөл: нээлттэй төсөл байхгүй, эсвэл Family засварлаж байна.`

**15. MglSmartClash** (SmartRibbon.cs:63-77)
- ToolTip: `Хоёр бүлэг элементийн (жишээ нь хоолой ба дам нуруу) огтлолцлыг шалгаж, давтан ажиллуулахад ч тогтвортой хадгална.`
- Long: `Дүрэм сонгоод «Шалгах» дарна: ХУРДАН шүүлтүүрээр нэр дэвшигч олж, зөвхөн тэдгээрт нарийн геометр шалгана. Линк загвартай ч ажиллана.\n\nДүн: Баталгаажсан clash / Clash биш / Дэмжигдэхгүй / Геометрийн алдаа — «дэмжигдэхгүй»-г ХЭЗЭЭ Ч «clash биш» гэж үзэхгүй.\nClash бүр өөрийн тогтвортой таних тэмдэгтэй: шинэ → хянасан → зөвшөөрсөн → шийдэгдсэн.\n\nЗагварыг ӨӨРЧИЛӨХГҮЙ.\n\nТовч бүдгэрэх нөхцөл: нээлттэй төсөл байхгүй, эсвэл Family засварлаж байна.`

**16. MglSmartPublish** (SmartRibbon.cs:100-114)
- ToolTip: `Хуудсуудыг PDF / DWG / IFC болгон нэг дор, профайл ба нэршлийн загвараар гаргана.`
- Long: `Профайл сонгоод → хуудсаа тэмдэглээд → урьдчилан харж (файлын нэр) → Preflight-ээр шалгаад → гаргана. Файл бүрийн үр дүн (амжилттай / бүтэлгүй / хэсэгчилсэн) түүхэд хадгалагдаж, бүтэлгүйтсэнийг дахин оролдож болно.\n\nНэршил нь загвартай: {ProjectNumber}_{SheetNumber}_{SheetName}[_Rev{Revision}] гэх мэт. Preflight нь давхардсан нэр, хоосон параметр, бичих эрхгүй хавтас, байхгүй DWG setup зэргийг гаргахаас ӨМНӨ барина.\n\nЗагварыг ӨӨРЧИЛӨХГҮЙ.\n\nТовч бүдгэрэх нөхцөл: нээлттэй төсөл байхгүй, эсвэл Family засварлаж байна.`

**17. MglRebarEndSymbol** (RfRibbon.cs:34-51)
- ToolTip: `Арматурын эхлэл/төгсгөл бүрд тэмдэг (family эсвэл код-оор зурсан) арматурын чиглэлээр эргүүлж автоматаар тавина.`
- Long: `1. Тэмдгийн төрлийг сонгоно: төсөлд ачаалсан family (Detail Item / Generic Annotation) ЭСВЭЛ «код-оор зурах тэмдэг» (тойрог / загалмай / налуу зураас — family шаардахгүй).  Байрлал, оффсетоо тохируулна.\n2. ЗӨВХӨН арматур (Rebar) сонгоно.  Олонлог (bar set) бол тэмдэг тавих ширхэг дээр нь дарна.  Esc = загварт юу ч өөрчлөхгүй.\n\nТэмдэг арматурын БОДИТ геометрийн эхлэл/төгсгөлд, харагдацын координатаар тавигдана — шулуун, L, U, дэгээтэй, олонлог (bar set), эргэсэн зүсэлтэд ч зөв.  Дахин дарахад ижил төгсгөлд давхар тавигдахгүй.  Гараар тавьсан юм хөндөгдөхгүй.\n\n⚠ Код-оор зурсан тэмдгийн хэмжээ нь үүсгэсэн харагдацын масштабаар тогтоогдоно (масштаб солигдвол өөрчлөгдөхгүй).\n\nЭнэ нь загварыг ӨӨРЧИЛНӨ — бүгдийг нэг Ctrl+Z-ээр буцаана.\n\nТовч бүдгэрэх нөхцөл: идэвхтэй харагдац план, зүсэлт, фасад, detail биш, эсвэл Family засварлаж байна.`

**18. MglRebarSectionAnnotation** (RfRibbon.cs:53-73)
- ToolTip: `Дам нуруу/баганын огтлол дээр хомутын хэмжээс, ажлын арматурын tag-ийг нэг командаар тавина.`
- Long: `1. Огтлолын (эсвэл баганын план) харагдацыг нээнэ.\n2. Дам нуруу/баганаа сонгоно.\n3. Цонхонд хомутын лавлах (гадна ирмэг / дотор ирмэг / тэнхлэг), талууд, tag-ийн төрлөө сонгож урьдчилан харна.\n\nБетон нүүрээс хомутын ирмэг хүртэлх хэмжээс, ажлын арматурын tag (Rebar tag family-ийн бичвэрээр) автоматаар, давхцалгүй байрлана.  Хомут/ажлын арматурыг Revit-ийн RebarStyle (Standard / Stirrup-Tie)-аар ялгаж, геометрээр баталгаажуулна (нэрээр БИШ): Standard = зөвхөн tag, Stirrup/Tie = tag + хэмжээс.\n\n⚠ Хомутын «гадна/дотор ирмэг»-ийн хэмжээс: эхлээд арматурын бодит ирмэгийн Reference-ийг хайна; олдохгүй бол хомутын ирмэгийн яг байрлал дахь үл үзэгдэх лавлагаа шугамд (бетон нүүр талдаа жинхэнэ холбоостой) холбоно; хоёулаа боломжгүй бол БУРУУ хэмжээс тавихгүй — тэр талыг АЛГАСАЖ мэдэгдэнэ.  Тайланд аль аргаар үүссэнийг хэлнэ.\n\nДахин дарахад («Өмнөх MGL тэмдэглэгээг солих» асаалттай үед) ЗӨВХӨН энэ эзэн дээр энэ хэрэгслийн өмнө тавьсныг солино; гараар тавьсан хэмжээс, tag хөндөгдөхгүй.  Бүгдийг нэг Ctrl+Z-ээр буцаана.\n\nТовч бүдгэрэх нөхцөл: идэвхтэй харагдац план, зүсэлт, фасад, detail биш, эсвэл Family засварлаж байна.`

**19. MglRebarRefresh** (RfRibbon.cs:75-88)
- ToolTip: `Энэ харагдацад тавьсан арматурын тэмдэглэгээг (төгсгөлийн тэмдэг, огтлолын хэмжээс/tag) геометрийн одоогийн байдлаар дахин тооцно.`
- Long: `Арматур зөөгдсөн, өөрчлөгдсөний дараа дарна.  Зөвхөн энэ add-in-ий тавьсныг шинэчилнэ; гараар тавьсан хэмжээс, tag хөндөгдөхгүй, арматур алга болсон бол юу ч УСТАХГҮЙ («хөндөөгүй» гэж тайлагнана).\n\n⚠ Огтлолын хэмжээс/tag-ийг ШИНЭЭР үүсгээд өмнөхийг солидог тул гараар зөөсөн/форматласан байрлал алдагдана (төгсгөлийн тэмдэг зөвхөн зөөгдөж/эргэнэ).\n\nТовч бүдгэрэх нөхцөл: идэвхтэй харагдац план, зүсэлт, фасад, detail биш, эсвэл Family засварлаж байна.`

**20. MglScheduleClone** (RfRibbon.cs:92-107)
- ToolTip: `Инженерийн форматласан нэг арматурын түүврийг (жишээ нь DN-1) Partition бүрээр хувилж, зөвхөн шүүлтүүрийг солино.`
- Long: `1. Эх түүвэр (DN-1) болон Partition талбарыг сонгоно (автоматаар танина).\n2. Үүсгэх Partition-уудаа тэмдэглэж, нэрийн загвар («Beam {Partition} Reinforcement») оруулна.\n3. Урьдчилан харна: + Үүсгэнэ · ✓ Байгаа · ↻ Шинэчилнэ · ! Нэрийн мөргөлдөөн.\n\nТүүврийг View.Duplicate-аар ХУВИЛНА — багана, формат, эрэмбэ, тооцоолсон талбар хадгалагдана.  Байгаа түүврийг өгөгдмөлөөр ХӨНДӨХГҮЙ (Алгасах / Filter шинэчлэх / Солих — сүүлийнх баталгаажуулалттай).\n\nБүгдийг нэг Ctrl+Z-ээр буцаана.\n\nТовч бүдгэрэх нөхцөл: нээлттэй төсөл байхгүй, эсвэл Family засварлаж байна.`

**21. MglScheduleSync** (RfRibbon.cs:109-121)
- ToolTip: `Загварын Partition-ууд ба үүсгэсэн түүврүүдийг харьцуулж, дутууг нөхөж, буруу шүүлтүүрийг засна.`
- Long: `Төлөв: + дутуу түүвэр · ✓ зөв · ↻ шүүлтүүр буруу · ! нэр мөргөлдөв · ○ загварт Partition алга.\n\nЮУ Ч АВТОМАТААР УСТГАХГҮЙ.  Орхигдсон Partition-ы түүврийг зөвхөн таныг чагталсан үед (баталгаажуулалттай) устгана.\n\nБүгдийг нэг Ctrl+Z-ээр буцаана.\n\nТовч бүдгэрэх нөхцөл: нээлттэй төсөл байхгүй, эсвэл Family засварлаж байна.`

**22. MglLicense** (App.cs:829-843)
- ToolTip: `Компанийн бүртгэлээр нэвтэрч, энэ компьютерын MGL лицензийг шалгана.`
- Long: `MGL add-in-ий БҮХ хэрэгсэл зөвхөн компанийн бүртгэлээр, таны ирц бүртгүүлдэг ажлын компьютер дээр ажиллана.  Энэ цонхноос нэвтрэх, лицензийн хугацааг харах, дахин шалгах, гарах боломжтой.\n\nИнтернэтгүй үед сүүлийн шалгалтаас хойш 12 цаг ажиллана.  Компьютер танигдахгүй бол цонхонд гарах «Компьютерын код»-ыг admin-д хэлж зөвшөөрүүлнэ.\n\nТовч ҮРГЭЛЖ идэвхтэй — файл нээгээгүй ч нэвтэрч болно.`

**23. MglQtoSettings** (App.cs:845-857)
- ToolTip: `Нэвтрэх, төслөө сонгох, серверийн хаяг — БҮХ тохиргоо энд.`
- Long: `Хэрэглэгчийн нэр/нууц үгээр нэвтэрч токен авна, ажиллах төслөө сонгоно. Токен нь энэ компьютерт шифрлэгдэж хадгалагдана.\n\nЭнэ товч ҮРГЭЛЖ идэвхтэй — нээлттэй төсөлгүй ч тохиргоогоо хийж болно. Нэвтрэх шаардлагатай үед бусад товч өөрсдөө энэ цонхыг нээнэ.`

### 1.3 The App.cs "one large panel collapsed into one icon" comment, VERBATIM (App.cs:572-599)

Preserve this lesson in any redesign.

```
            // ══════════════════════════════════════════════════════════════
            //  ОЛОН ЖИЖИГ САМБАР, ЗҮҮНЭЭС БАРУУН ТИЙШ (2026-08-26)
            //
            //  ⚠️ НЭГ САМБАР БОЛГОСОН НЬ АЛДАА БАЙВ.  Бүх 7 товчийг нэг
            //  «Хэрэгслүүд» самбарт хийсэн ба Revit түүнийг бүхэлд нь НЭГ
            //  унждаг товч болгож ХУЙЛСАН — хэрэглэгч ганц робот дүрс хараад
            //  «дотор нь бүгдийг нь хийчихсэн» гэж гомдоллосон.
            //
            //  Журнал (journal.0064.txt) нь товчнууд БҮГД нэмэгдсэнийг
            //  баталсан: `API_SUCCESS { Added pushbutton ... }` × 7.  Өөрөөр
            //  хэлбэл асуудал нь товчнуудад биш, САМБАРЫН БҮТЭЦЭД байв.
            //
            //  Revit-ийн байрлуулалт нь САМБАР бүрт зай хуваарилдаг: Analyze
            //  таб 14 товчийг ижил өргөнд харуулж чаддаг нь тэдгээрийг олон
            //  жижиг самбарт хуваасны ач.  Нэг өргөн самбар нь хуйлагдах
            //  анхны хохирогч болдог.
            //
            //  Тиймээс: ДӨРВӨН нэртэй самбар.  Самбарын нэр өөрөө ангиллын
            //  шошго болж, Revit тэдний хооронд босоо зураас татна — «зайтай,
            //  зүүнээс баруун тийш жагсаасан» гэсэн хүсэлт яг ингэж биелнэ.
            //
            //  ⚠️ Товчны шошгыг БОГИНОСГОВ.  Самбарын нэр «Сайт руу илгээх»
            //  гэж хэлчихсэн тул товч бүр дээр «илгээх» гэж давтах нь зөвхөн
            //  өргөнийг нэмж, хуйлагдах эрсдэлийг өсгөнө.
            //
            //  ⚠️ Товчны NAME (эхний аргумент) ХЭВЭЭР — Quick Access Toolbar-т
            //  нэмсэн байвал алдагдахгүй.
            // ══════════════════════════════════════════════════════════════
```

Reading notes:
- «ДӨРВӨН нэртэй самбар» is historical. App.cs still creates exactly 4 of the 7 panels. The "7 buttons in one panel" that collapsed is now 23 buttons across 7 panels.
- The **lessons**:
  1. Revit allocates width per panel and collapses an over-wide panel into one dropdown icon.
  2. The evidence was the journal showing all buttons were added.
  3. Labels were deliberately shortened (verbs removed) because the panel title carries the verb.
  4. The button Name is claimed to keep the QAT entry stable (see §5 for what that claim does and does not cover).

### 1.4 Surfaces that are not ribbon buttons

| Surface | Id / GUID | Opened by |
|---|---|---|
| Dockable pane «MGL туслах» | `6f1a2c74-9d43-4b1e-9a7c-2f5b0a91cc10` (AssistantPaneProvider.cs:20) | `MglAssistantPane` |
| Dockable pane «MGL ажил» | `b6c1a3e2-5f47-4d8e-9a21-7c0e4d3f8a15` (WorkPaneProvider.cs:21); `VisibleByDefault = true` (:33) | `MglWorkPane` |
| Dockable pane «MGL — Зураг клонлох» | `3f3d4d16-dd6a-44b2-81b4-bc9de7fa287c` (CdJobHost.cs:431); `VisibleByDefault = false` | **no ribbon button.** `CdJobHost.ShowPane` is called only from `CloneDrawingsCommand` (:57, :146) and job completion (CdJobHost.cs:233). |

Pane GUIDs must stay constant (comments in each provider).

## 2. COMPLETE IExternalCommand list (23 classes; 23 buttons)

Legend:
- Attrs = `[Transaction]` / `[Regeneration]`. M = Manual, R = ReadOnly, "–" = attribute absent.
- Gate = `LicenseGate.Ensure()` call site. `RfGuard.Begin` (RfGuard.cs:21) calls `Ensure()` for the 5 Reinforcement commands.
- Licence-gate behaviour: `Ensure()` returns true if the lease is valid; otherwise it opens the modal `LicenseDialog(fromTool:true)` (LicenseGate.cs:116-154). The ribbon button is therefore enabled even when unlicensed. Execution is blocked inside the command.

| # | Class (file:line; attrs lines) | Button | Attrs | Availability (see §2.1) | Gate | Early-return guards (null doc / family / view type / busy) | UI opened | Model effect / undo |
|---|---|---|---|---|---|---|---|---|
| 1 | `QtoExportCommand` QtoExportCommand.cs:20 (:18-19) | MglQtoExport | M/M | QtoCA | :27 | null uidoc/doc → Cancelled :29; no token/project → `SettingsDialog` :34-40; 0 rows → TaskDialog :70-77; >1 file → TaskDialog confirm :116-124. **No family check in Execute** (relies on availability). | TaskDialog confirm; `QtoProgressWindow` (multi-file); `SettingsDialog` | Read-only; no Transaction (:15); HTTP `ApiClient.PostRevitRunAsync` :189-191 |
| 2 | `QtoSettingsCommand` QtoExportCommand.cs:281 (:279-280) | MglQtoSettings | M/M | none | **none** | none | `SettingsDialog` | none |
| 3 | `BindingCommand` BindingCommand.cs:19 (:18) | MglRevitBinding | R/– | ProgCA | :26 | null/family → TaskDialog «Эхлээд төслийн файлаа нээнэ үү.» :29-33; no token → `SettingsDialog`; 0 sheets → TaskDialog :55-63 | `BindingDialog` | HTTP handshake; on save `RevitTools.Run("capture_baseline")` :114 |
| 4 | `BatchSheetCommand` BatchSheetCommand.cs:25 (:23-24) | MglBatchSheets | M/M | QtoCA | :32 | null → Cancelled; family → TaskDialog :37-41 | `BatchSheetDialog` | One Transaction, commit; Ctrl+Z |
| 5 | `CopyToOtherCommand` CopyToOtherCommand.cs:28 (:26-27) | MglCopyToOther | M/M | QtoCA | :42 | null; family → TaskDialog :47-51; **active view not `ViewPlan` or template → TaskDialog :53-60**; nothing copyable → TaskDialog :75-81 | `PickObjects` (if no preselection) → `CopyToOtherDialog` (code-built WPF, modal) → `PickPoint` loops → TaskDialog summary | TransactionGroup assimilated if Targets>0 :104-123 → one Ctrl+Z |
| 6 | `AssistantPaneCommand` AssistantPaneProvider.cs:41 (:40) | MglAssistantPane | R/– | ProgCA | :46 | pane null → TaskDialog + Failed :50-55; no doc check | docked pane `AssistantPane` | none |
| 7 | `PdfViewExportCommand` PdfViewExportCommand.cs:24 (:22-23) | MglPdfExport | M/M | PdfVA | :31 | null; `!IsExportable(ActiveView)` → TaskDialog :41-48; no token → `SettingsDialog`; confirm TaskDialog :60-72 | TaskDialog; `SettingsDialog` | Temp Transaction + `RollBack` :81-113; PDF uploaded to ERP :127-142 |
| 8 | `ScheduleCloneCommand` ScheduleCloneCommands.cs:18 (:16-17) | MglScheduleClone | M/M | QtoCA | `RfGuard.Begin` :24 | null → silent false; family → TaskDialog `RfText.NoProject`; no template schedules → TaskDialog :35-39 | `ScheduleCloneDialog`; report | `View.Duplicate`; one Ctrl+Z per help |
| 9 | `ScheduleSyncCommand` ScheduleCloneCommands.cs:80 (:78-79) | MglScheduleSync | M/M | QtoCA | `RfGuard.Begin` :86 | same as #8 | `ScheduleSyncDialog`; report | create / fix filter / (ticked) delete |
| 10 | `SectionAnnotationCommand` SectionAnnotationCommand.cs:34 (:32-33) | MglRebarSectionAnnotation | M/M | RfVA | `RfGuard.Begin` :40 | **view not Plan/Section/Detail → TaskDialog :44-49 (Elevation refused although RfVA allows it)**; host pick Esc → Cancelled; NotAHost / NoHostData | `PickObject` (host); `SectionAnnotationDialog` (also hosts the «Загвар харагдацаас хуулах» sub-mode, :103-111, :152-189); report | Render; one Ctrl+Z per report |
| 11 | `ScheduleExportCommand` ScheduleExportCommand.cs:20 (:18-19) | MglScheduleExport | R/M | QtoCA | :27 | null → Cancelled; no token → `SettingsDialog`; none sendable → TaskDialog :43-47; >60 → TaskDialog :96-104; **no family check in Execute** | `SchedulePickerDialog` | Read-only; saves selection to settings.json :62-64; HTTP |
| 12 | `RebarEndSymbolCommand` EndSymbolCommands.cs:33 (:31-32) | MglRebarEndSymbol | M/M | RfVA | `RfGuard.Begin` :45 | unsupported view → TaskDialog :48-52; dialog cancel → Cancelled :63-64 | `EndSymbolDialog` → preselected path **or** `PickLoop` (status-bar prompt, no dialog per click); report only if issues | see §3.2 |
| 13 | `RefreshAnnotationsCommand` EndSymbolCommands.cs:200 (:198-199) | MglRebarRefresh | M/M | RfVA | `RfGuard.Begin` :206 | unsupported view → TaskDialog :209-213; if section sets exist → TaskDialog with 2 command links :219-234 | TaskDialog (command links); report | Outer TransactionGroup, `Assimilate` if changed :243-259 |
| 14 | `FamilyHubCommand` FamilyHubCommand.cs:17 (:16) | MglFamilyHub | M/**–** | QtoCA | :25 | **no doc guard in Execute**; single instance (`_window.IsLoaded`) :33-48 | `FamilyHubWindow` (modeless, owner = Revit main window) | via `FamilyHubExternalEvent` |
| 15 | `ChangeImpactCommand` ChangeImpactCommand.cs:17 (:15-16) | MglSmartImpact | M/M | QtoCA | :24 | null; family → TaskDialog :28-32; `!SmartExecutor.IsReady` → TaskDialog + Failed :33-37 | `ChangeImpactWindow` (modeless via `SmartWindows.ShowModeless`, one per type, bound to doc identity) | read-only |
| 16 | `SmartCountCommand` SmartCountCommand.cs:17 (:15-16) | MglSmartCount | M/M | QtoCA | :24 | same as #15 | `SmartCountWindow` (modeless) | read-only |
| 17 | `ClashCheckCommand` ClashCheckCommand.cs:17 (:15-16) | MglSmartClash | M/M | QtoCA | :24 | same as #15 | `ClashWindow` (modeless) | read-only |
| 18 | `SmartPublishCommand` SmartPublishCommand.cs:27 (:25-26) | MglSmartPublish | M/M | QtoCA | :34 | null; family → TaskDialog :38-42; session-build failure → TaskDialog + Failed :47-54 | `PublishDialog` (modal loop: Publish / Retry / AnalyzeChanges) → `PublishProgressWindow` (+ `OwnerLock`) | exports to folders; IFC temp transaction rolled back |
| 19 | `WorkPaneCommand` WorkPaneProvider.cs:43 (:42) | MglWorkPane | R/– | WorkPaneAv | :48 | pane null → TaskDialog + Failed :52-56 | docked pane `WorkPaneView` | none |
| 20 | `AutoAnnotateCommand` AutoAnnotateCommand.cs:21 (:19-20) | MglAutoAnnotate | M/M | AaAv | :28 | null; family → TaskDialog :33-37; `AaScan.KindOf` unsupported → TaskDialog :39-45; view template hides Dimensions → TaskDialog **warning, continues** :46-60 | `AutoAnnotateDialog` (modal); report | `AaRunner.Run`; report says one Ctrl+Z (:136) |
| 21 | `SheetNumeratorCommand` SheetNumeratorCommand.cs:24 (:22-23) | MglSheetNumerator | M/M | QtoCA | :34 | existing window → Activate :44-52; null → Cancelled; family → TaskDialog :65-69 | `SheetNumeratorWindow` (modeless, owner = Revit main window) | via `SheetNumeratorBridge` (ExternalEvent); Apply = one Undo (SHEET_NUMERATOR.md) |
| 22 | `LicenseCommand` LicenseCommand.cs:12 (:11) | MglLicense | R/– | LicenseAv | **none (it is the gate UI)** | none | `LicenseDialog(fromTool:false)` | none |
| 23 | `CloneDrawingsCommand` CloneDrawingsCommand.cs:27 (:25-26) | MglCloneDrawings | M/M | QtoCA | :34 | null; family → TaskDialog :39-43; **active view not `ViewPlan`/`ViewSection`/`View3D` or template → TaskDialog :45-51**; busy job → `ShowPane` then continues (queue note) :55-57, :108-110 | `PickObject` (template) → `PickObjects` (targets) → `CloneDrawingsDialog` (modal) → docked pane «MGL — Зураг клонлох» | **Background job on Idling, one Transaction per step (not one Ctrl+Z)**; fallback synchronous path = one Ctrl+Z (:155-158) |

### 2.1 Availability classes (7) and what they check

| Class (file:line) | Check | Used by |
|---|---|---|
| `QtoCommandAvailability` (QtoExportCommand.cs:262-276) | `doc != null && !doc.IsFamilyDocument`; any exception → false | 13 buttons: MglQtoExport, MglScheduleExport, MglBatchSheets, MglSheetNumerator, MglCopyToOther, MglCloneDrawings, MglFamilyHub, MglSmartImpact, MglSmartCount, MglSmartClash, MglSmartPublish, MglScheduleClone, MglScheduleSync |
| `ProgressCommandAvailability` (AssistantPaneProvider.cs:68-82) | identical logic to `QtoCommandAvailability` | MglAssistantPane, MglRevitBinding |
| `PdfViewAvailability` (PdfViewExportCommand.cs:240-256) | project doc AND `PdfViewExportCommand.IsExportable(ActiveView)` (non-template `ViewPlan`/`ViewSection`/`ViewSheet`/`View3D`/`ViewDrafting` with `CanBePrinted`) | MglPdfExport |
| `AutoAnnotateAvailability` (AutoAnnotateCommand.cs:146-162) | project doc AND `AaScan.KindOf(view) != Unsupported` (plan: FloorPlan/CeilingPlan/EngineeringPlan/AreaPlan; Section/Detail/Elevation) | MglAutoAnnotate |
| `RfViewAvailability` (EndSymbolCommands.cs:288-303) | project doc AND `RfView.Use(view) != Unsupported` (FloorPlan/EngineeringPlan/CeilingPlan, Section, **Elevation**, Detail) | MglRebarEndSymbol, MglRebarSectionAnnotation, MglRebarRefresh |
| `WorkPaneAvailability` (WorkPaneProvider.cs:69-72) | always true | MglWorkPane |
| `LicenseAvailability` (LicenseCommand.cs:22-25) | always true | MglLicense |
| (none) | `AvailabilityClassName` is null (App.cs:855) → always enabled | MglQtoSettings |

**Availability vs command-guard mismatches** (button enabled, command then refuses with a dialog):
- `MglCopyToOther`: availability is project doc only; the command needs a `ViewPlan` (:53-60).
- `MglCloneDrawings`: availability is project doc only; the command needs plan/section/3D (:45-51).
- `MglRebarSectionAnnotation`: `RfViewAvailability` allows Elevation; the command refuses it (:44-49). The message says «Фасад, 3D, хуудас дээр ажиллахгүй» (RfText.cs:554).
- The two classes named `Qto…`/`Progress…` are the same predicate. The name «Qto» is misleading on 11 non-QTO buttons.

### 2.2 Entry points that act without being an IExternalCommand (not on the ribbon)

- `HttpServer` (`MCP_EXECUTOR`, R25+): `/tool`, `/execute` (Roslyn). It needs a bridge token (`BridgeAuth.Check`) and `Licensing.LicenseGate.IsLicensedNow()` (HttpServer.cs:108).
- `RevitToolBus` + `RevitToolEventHandler` (ExternalEvent) for the assistant's typed tools.
- `BatchQto` (`ApplicationInitialized` hook; `EnsureForBatch` at BatchQto.cs:141).
- Idling hosts: `CdJobHost` (CloneDrawings background steps), `WorkTrackingHost`, `RevitIntelligenceHost`. `SmartHost` is a host too.
- Docked-pane view code (`AssistantPane`, `WorkPaneView`, `CdJobPaneView`).
- ExternalEvent users: `RevitToolBus`, `CodeExecutorEventHandler`, `FamilyHubExternalEvent`, `SmartExecutor`, `SheetNumeratorBridge`.

## 3. Stale help verified from BOTH sides (finding F4)

### 3.1 CopyToOther: modes

**Stale text** (App.cs:747-749, inside MglCopyToOther LongDescription): `Элементүүд хуулагдаад, БҮХ харагдац (план, зүсэлт, фасад) дахь tag, өрөөний tag, хэмжээс нь шинэ элементүүд дээр нь дахин тавигдана.  Тэнхлэг, түвшин хуулагдахгүй; эргүүлэх, толин тусгал одоохондоо байхгүй.\n\n` — the false clause is on **App.cs:749**.

**What is TRUE today (engine and dialog):**
- The dialog (`CopyToOtherDialog`) offers three radio modes (CopyToOtherCommand.cs:311-313):
  - «Шилжүүлэх»: «A цэг → B цэг.  Олон байршилд дараалан тавьж болно.»
  - «Эргүүлж байрлуулах»: «A дээр 2 цэг → B дээр харгалзах 2 цэг.  Өнцгийг автоматаар тооцно.»
  - «Толин тусгал»: «Тэнхлэгийн 2 цэг — А ба Б нь хоорондоо толин дүр бол.»
- `switch (dlg.Mode)` dispatches to `RunMove` / `RunRotate` / `RunMirror` (:107-118).
  - Rotate takes A1, A2 then a B1, B2 pair per placement. A length mismatch above `LengthTol = 0.02` ft (≈6 mm) asks whether to skip (:185-195).
  - Mirror takes 2 axis points and runs once (:201-207).
- The engine implements all three: `ElementTransformUtils.CopyElements` + `RotateElements` (CopyToOtherEngine.cs:704-718) and `MirrorElements` guarded by `CanMirrorElement`. Non-mirrorable elements are skipped with a note: «… элементийг Revit толин тусгалаар хуулж чадахгүй — алгассан.» (CopyToOtherEngine.cs:696-701).
- The mode is persisted in `CopyToOtherPrefs.Mode` (:396).
- Z never changes (CopyToOtherEngine.cs:33-35).
- Still TRUE in the help:
  - Level/Grid/ReferencePlane/link/View elements are not copyable (`IsCopyable`, CopyToOtherEngine.cs:206-221).
  - Tags and dimensions are re-created, not copied (`SplitSelection` comment :228-231).
  - One Ctrl+Z (TransactionGroup `Assimilate`, CopyToOtherCommand.cs:104-123).
- **The help is also incomplete:** the step list jumps from selection to point-picking. The real flow is selection → settings dialog → points. The dialog is where you choose:
  - the mode;
  - what to copy («Tag», «Өрөөний tag», «Хэмжээс — утгыг нь А-тай тулгаж шалгана», «2D тэмдэглэгээ»);
  - «А-гийн зүсэлт, планыг Б-д шинээр үүсгэх» with a per-view checklist;
  - «Эх харагдац хуудсан дээр байвал Б-д шинэ хуудас үүсгэх» (:328, :357).

  The help mentions none of these.
- **History:** the stale clause was present in the very commit that introduced the tool. `0457c275` (2026-09-28) already contains `RunRotate`/`RunMirror` (4 matches) and `CopyPlacementKind.Mirror` (4 matches) **and** `эргүүлэх, толин тусгал одоохондоо байхгүй`. It has never been correct for shipped code. `git log -S` shows only that commit changed the occurrence count.

### 3.2 End-symbol: selection, Esc and Undo

**Stale text** (RfRibbon.cs:42 and 47):
- `+ "2. ЗӨВХӨН арматур (Rebar) сонгоно.  Олонлог (bar set) бол тэмдэг тавих ширхэг дээр нь дарна.  Esc = загварт юу ч өөрчлөхгүй.\n\n"`
- `+ "Энэ нь загварыг ӨӨРЧИЛНӨ — бүгдийг нэг Ctrl+Z-ээр буцаана.\n\n"`

**What is TRUE today** (EndSymbolCommands.cs, EndSymbolService.cs, RfText.cs, REINFORCEMENT.md §14):

1. **Order:** the settings dialog (`EndSymbolDialog`) comes first. Cancelling it, or `dlg.Options == null`, returns Cancelled with no change (:63-64).
2. **Preselected path** (`rebars.Count > 0` at click time):
   - A single `EndSymbolService.Place(doc, view, rebars, options)` runs (:99).
   - `Place` opens one `TransactionGroup` (EndSymbolService.cs:235) and calls `tg.Assimilate()` when `rep.Placed > 0`, else `tg.RollBack()` (:283-284).
   - One report dialog follows, containing `RfText.Ctrlz` = «Бүгдийг нэг Ctrl+Z-ээр буцаана.» (:112).
   - So «бүгдийг нэг Ctrl+Z» is TRUE here only.
   - One sub-case: with `BarSet == Nearest`, no PickPoint and exactly one preselected bar-set rebar, it asks for one click. Esc cancels with no change (:77-94).
3. **No preselection** (`rebars.Count == 0`) → `PickLoop` (:73, :123-191):
   - `PickObject` repeats with a `RfRebarPickFilter` and a status-bar prompt (`RfText.PickLoopPrompt`).
   - **Each click calls `Place(…, new List<Rebar>{ rebar }, …)`** (:163), so it has its own TransactionGroup and its own undo entry.
   - **Esc after ≥1 click finishes and keeps everything already placed.** The code comment reads `break; // Esc — дуусгах (тавьсан тэмдгүүд хэвээр)` (:140).
   - Esc before any click returns Cancelled with no change (:180).
   - On the first failed click the loop stops, shows the report, and earlier placements remain (:172-176).
   - A report dialog appears only if there were issues or nothing was placed (:183-189); the per-pick wording `RfText.CtrlzPerPick` = «Ctrl+Z бүр СҮҮЛД дарсан арматурын тэмдгийг буцаана.» (RfText.cs:453) is appended only when something was placed.
   - A clean run ends with no dialog at all.
4. **Net:** «Esc = загварт юу ч өөрчлөхгүй» is true only for dialog-cancel, Esc before the first click, or Esc at the bar-set point prompt. «Бүгдийг нэг Ctrl+Z-ээр буцаана» is true only for the preselected path. In the pick loop Ctrl+Z undoes one click at a time. `REINFORCEMENT.md` §14 QA-P: «Дараалан 3 арматур → Esc → Ctrl+Z ×1 → Зөвхөн 3 дахь арматурын тэмдэг буцна».
5. **Correction to the audit wording:** the ribbon text does not describe a loop at all. The contradiction is that the two sentences above are stated unconditionally. The accurate per-pick Undo text lives only in `RfText.cs:453` and the code XML-docs, not in the tooltip.
6. **Related stale code comment** (not UI): EndSymbolCommands.cs:195-196 says `(одоогоор төгсгөлийн тэмдэг)`, but `RefreshAnnotationsCommand` also refreshes section annotations (`RfSectionService.Refresh`, :249).

### 3.3 Section annotation: references

**Stale text** (RfRibbon.cs:65-67): `+ "⚠ Хомутын «гадна/дотор ирмэг»-ийн хэмжээс: эхлээд арматурын бодит ирмэгийн Reference-ийг хайна; олдохгүй бол хомутын "` / `+ "ирмэгийн яг байрлал дахь үл үзэгдэх лавлагаа шугамд (бетон нүүр талдаа жинхэнэ холбоостой) холбоно; хоёулаа боломжгүй "` / `+ "бол БУРУУ хэмжээс тавихгүй — тэр талыг АЛГАСАЖ мэдэгдэнэ.  Тайланд аль аргаар үүссэнийг хэлнэ.\n\n"`

**What is TRUE today:**
- Dimensions use **only real References**. The renderer comments say so:
  - RfSectionRenderer.cs:268-269: «ХЭМЖЭЭС ЗӨВХӨН арматурын БОДИТ геометрийн Reference + бетон нүүрний Reference-аар.  Лавлагаа олдохгүй бол ХУУРАМЧ лавлагаа (нэмэлт шугам, үл үзэгдэх гэх мэт) үүсгэхгүй, тэр талыг алгасаж …»
  - RfSectionRenderer.cs:52: «үгүй бол ХУУРАМЧ лавлагаа (нэмэлт шугам г.м.) ҮҮСГЭХГҮЙ — дуудагч тэр талыг алгасаж тайланд хэлнэ.»
- A side lacking a face or stirrup reference is dropped and reported with `RfText.NoFaceReference` / `RfText.NoRebarRef` (:325-326, :336, :341).
- Source guard test: `tests/Reinforcement.Tests/SectionFeedbackTests.cs:151` `Renderer_source_never_creates_detail_curves_or_invisible_lines`.
- Docs: `revit-mcp/docs/REINFORCEMENT.md:487` («C1 Хуурамч шугам БАЙХГҮЙ.»). The doc header (:9-10) states that §13 invalidated every earlier «witness / proxy line» description.
- **So the first clause («эхлээд арматурын бодит ирмэгийн Reference-ийг хайна») and the last («БУРУУ хэмжээс тавихгүй — тэр талыг АЛГАСАЖ мэдэгдэнэ») are true. The middle fallback («үл үзэгдэх лавлагаа шугамд … холбоно») is false.**
- **Legacy nuance:** files annotated by 1.11.x may still contain those invisible lines. Delete-protection code and one user-visible warning remain for them: RfText.cs:697, «… (ж: үл үзэгдэх лавлагаа шугам)»; RfSectionService.cs:345. That warning is legitimate legacy handling, not stale help.
- **Not mentioned in the tooltip** (1.13.0): the dialog also has a «Загвар харагдацаас хуулах» mode that copies dims/tags/text from a hand-drawn template view onto the active view (SectionAnnotationCommand.cs:103-111, :152-189).
- **Enablement text mismatch:** the tooltip says the button fades unless the view is «план, зүсэлт, фасад, detail», but the command refuses Elevation (:44-49).

### 3.4 Other help-vs-code mismatches found while reading (beyond F4)

| Where | Help says | Code does |
|---|---|---|
| App.cs:695 (MglScheduleExport) | `Сонголт нь загварт хадгалагдана` | `settings.SelectedSchedules = picker.SelectedNames.ToList(); SettingsStore.Save(settings);` (ScheduleExportCommand.cs:62-64). The store is `%APPDATA%\RevitMcpAddin\settings.json` (SettingsStore.cs:8), per Windows user and shared across all models, not saved in the Revit model. |
| App.cs:852 (MglQtoSettings) | `Токен нь энэ компьютерт шифрлэгдэж хадгалагдана.` | `if (!Licensing.LicenseGate.HasDeviceSession()) settings.Token = _token;` (SettingsDialog.xaml.cs:191-192), with the comment «Төхөөрөмжийн session идэвхтэй үед токеныг ДИСКЭНД бичихгүй». Login uses a 30-minute device session (SettingsDialog.xaml.cs:112-125). The tooltip text predates 1.10.0. |
| App.cs:743-746 (MglCopyToOther) | 4-step flow | omits the settings dialog and view/sheet cloning (see §3.1) |
| RfRibbon.cs:59-70 (section) | 3-step flow | omits template-copy mode (see §3.3) |
| `revit-mcp/docs/dev`: `docs/dev/08-qto-revit.md:7-14` | old button names «Тоо хэмжээ илгээх», «PDF илгээх», «Хүснэгт илгээх», «Тохиргоо — login»; «~1 жилийн token» | current names are «Тоо хэмжээ», «PDF», «Хүснэгт»; no long-lived token since 1.10.0 |
| `revit-mcp/docs/REINFORCEMENT.md:377` | «Арматур» самбар … 4 товч … + «Шинэчлэх» | the ribbon has two panels: «Арматур» (3 buttons) and «Түүвэр» (2) |

## 4. Panel crowding analysis — NEEDS LIVE VERIFICATION

Nothing below is a measurement; it is inputs only.

| Panel | Buttons R25–R27 | Buttons R24 | Longest label line (chars, Mongolian) | Panel title (chars) |
|---|---|---|---|---|
| Ажлын явц | 3 (#1–3) | 2 | 6 («туслах», «холбох») | 9 |
| Сайт руу илгээх | 3 (#4–6) | 3 | 7 («Хүснэгт») | **15** (longest title) |
| Загвар | **6** (#7–12) | 5 | 9 («дугаарлах») | 6 |
| Smart | 4 (#13–16) | – | 11 («Өөрчлөлтийн») | 5 |
| Арматур | 3 (#17–19) | 3 | **18** («Огтлолын арматурын»), **17** («төгсгөлийн тэмдэг») | 7 |
| Түүвэр | 2 (#20–21) | 2 | 9 («синк хийх») | 6 |
| Тохиргоо | 2 (#22–23) | 2 | 8 | 8 |
| **Total** | **23 in 7** | **17 in 6** | | |

- **Large vs small:** all 23 are single `AddItem` buttons with a 32 px image, plus a 16 px image if the font rendered (§0). No stacked layout is requested anywhere, so no panel can show two small buttons in one column unless Revit does so on its own.
- **Labels:** all but 3 (`PDF`, `Хүснэгт`, `Тохиргоо`) use two-line labels (explicit `\n`). The two widest labels («Арматурын\nтөгсгөлийн тэмдэг», «Огтлолын арматурын\nтэмдэглэгээ») are both in «Арматур».
- **Only data point on collapse:** App.cs:575-587 (1.3 above): 7 buttons in one panel collapsed to one dropdown icon, evidenced by journal.0064.txt. The current largest panel («Загвар») has 6 two-line buttons. The collapse rule belongs to Revit and is not observable here. The repo contains no measurement of the current layout at any width or DPI.
- **What to measure live** (not asserted): at several window widths (e.g. 1366 / 1600 / 1920 / 2560 px) and DPI scales (100/125/150 %), on R24 and R27, record per panel whether it renders expanded or collapses to a single icon, and the order in which panels collapse. The Revit journal shows `API_SUCCESS … Added pushbutton` lines for existence only.
- **Composition varies by Revit year:** R24 has no «Smart» panel, no FamilyHub and no WorkPane. A design validated on R27 must also be checked on R24 (17 buttons, 6 panels).

## 5. Command identity

**What the repo does:**
- Every button is `new PushButtonData(name, text, assemblyPath, commandClass)` (App.cs:524, SmartRibbon.cs:120, RfRibbon.cs:127). The `.addin` manifest (`RevitMcpAddin.addin`) declares only `Type="Application"` / `FullClassName RevitMcpAddin.App` — no per-command entries.
- Command and availability classes are referenced as **strings** (full class name). Renaming a class or namespace breaks button load. Mitigation: `installer/verify-bundle.ps1:59-61` string-scans the DLL for **18** command class names (`$common` 12, `$newer` 6). It does **not** list `PdfViewExportCommand`, `ScheduleExportCommand`, `BindingCommand`, `LicenseCommand`, `QtoSettingsCommand`.
- **No code in the repo uses** `RevitCommandId`, `LookupCommandId`, `PostCommand` or `LookupPostableCommandId` (grep over `revit-mcp/`). Only `docs/SHEET_NUMERATOR.md:236, 335` mention `PostCommand(Undo/Redo)` for an out-of-tree live harness. Panes are shown with `GetDockablePane(...).Show()`.
- `ExternalEvent` is used by: `RevitToolBus.cs:154`, `App.cs:182` (MCP executor), `FamilyHubExternalEvent.cs:40`, `SmartExecutor.cs:158`, `SheetNumeratorBridge.cs:44`. `Idling` is used by `CdJobHost.cs:54`, `WorkTrackingHost.cs:124`, `RevitIntelligenceHost.cs:227`.
- No test refers to a button Name. `SheetNumerator.LiveHarness/UiStage.cs:382-399` instantiates `SheetNumeratorCommand` directly. The strings `Mgl…` found elsewhere are unrelated (Extensible Storage schema names `MglAutoAnnotate`/`MglCloneDrawingsLink`/`MglFamilyHubRegistry`, a drag-format string).
- **Repo claim:** App.cs:597-598, SmartRibbon.cs:12-13 and RfRibbon.cs:11-12 say the button **Name** (first argument) must not change so Quick Access Toolbar entries survive. Nothing enforces this.

**Revit convention (NOT verifiable from this repo; NEEDS LIVE CHECK):**
- Revit derives a ribbon command's id from its position:
  - plain button: `CustomCtrl_%CustomCtrl_%<tab>%<panel>%<button Name>`;
  - button inside a pulldown/split: an extra `CustomCtrl_%` prefix and a `%<pulldown name>` segment.
  - Verify with `RevitCommandId.LookupCommandId(...)` or the journal.
- If that holds, the id depends on tab + panel (+ pulldown) **and** the Name. Keeping Name stable is not enough when a button is moved to a different panel or into a pulldown.
- QAT items and `KeyboardShortcuts.xml` entries persist those id strings. This is Revit behaviour, not tested here.
- Whether a stacked group (`AddStackedItems`) changes the id format is unknown.

**PREDICTED ids at default tab `MGL` (unverified; use as a diff checklist live):**

```
CustomCtrl_%CustomCtrl_%MGL%Ажлын явц%MglWorkPane          (…%MglAssistantPane, …%MglRevitBinding)
CustomCtrl_%CustomCtrl_%MGL%Сайт руу илгээх%MglQtoExport   (…%MglPdfExport, …%MglScheduleExport)
CustomCtrl_%CustomCtrl_%MGL%Загвар%MglBatchSheets          (…%MglSheetNumerator, %MglCopyToOther, %MglCloneDrawings, %MglAutoAnnotate, %MglFamilyHub)
CustomCtrl_%CustomCtrl_%MGL%Smart%MglSmartImpact           (…%MglSmartCount, %MglSmartClash, %MglSmartPublish)
CustomCtrl_%CustomCtrl_%MGL%Арматур%MglRebarEndSymbol      (…%MglRebarSectionAnnotation, %MglRebarRefresh)
CustomCtrl_%CustomCtrl_%MGL%Түүвэр%MglScheduleClone         (…%MglScheduleSync)
CustomCtrl_%CustomCtrl_%MGL%Тохиргоо%MglLicense            (…%MglQtoSettings)
```

**Which ids change if buttons are reparented (given the convention):**
- Moving a button between panels changes that button's id.
- Renaming a panel changes the ids of all its buttons.
- Moving into a pulldown or split adds a segment.
- Setting `MGL_RIBBON_TAB` changes the tab segment for **every** button on that machine today.
- Dockable panes are keyed by GUID, not by ribbon position, and are unaffected.
- Stable `Name` values (all ASCII, `Mgl…`) are the only continuity the repo controls.
- Moving a button to another panel is therefore a QAT/shortcut break risk even with the Name kept.

## 6. Confusable pairs (exact current names; `\n` shown as a space)

| Pair | Why confusable (evidence) |
|---|---|
| «Хуулж тавих» ↔ «Зураг клонлох» | Both copy annotations to other places. One copies selected elements A→B on a plan, with a rotate/mirror option; the other copies a template element's drawing (views, sheets, tags, dims) to same-type elements. App.cs:490 already notes the icon colour was changed to separate them. |
| «Хуудас үүсгэх» ↔ «Хуудас дугаарлах» | Create sheets vs renumber/reorder sheets; two-word names that differ only in the verb. |
| «Тоо хэмжээ» ↔ «Smart Count» | ERP quantity push vs local count/filter. Both are "quantities". |
| «PDF» ↔ «Smart Publish» | ERP upload of one view vs folder export of PDF/DWG/IFC sheets (finding F3). |
| «PDF» ↔ «Автомат хэмжээс» | `PdfViewExportCommand` adds temporary grid dimensions then rolls back (:81-113). AutoAnnotate places permanent dimensions and tags. |
| «Хүснэгт» ↔ «Түүвэр хувилах» ↔ «Түүвэр синк хийх» | The same Revit object (`ViewSchedule`) is «Хүснэгт» in one panel and «Түүвэр» in another (App.cs:693 vs RfRibbon.cs:94). |
| «Түүвэр хувилах» ↔ «Түүвэр синк хийх» | Both can create per-Partition schedules and both end in `session.Execute(dlg.Request)` (ScheduleCloneCommands.cs:48 and 117). Sync adds fix/delete. |
| «Огтлолын арматурын тэмдэглэгээ» ↔ «Автомат хэмжээс» | Both place dimensions and tags on section views; AutoAnnotate also tags beams and columns. |
| «Тэмдэглэгээ шинэчлэх» ↔ «Арматурын төгсгөлийн тэмдэг» / «Огтлолын арматурын тэмдэглэгээ» | Refresh re-runs both tools' output; section dialog has its own «Өмнөх MGL тэмдэглэгээг солих» option. The words «тэмдэг» / «тэмдэглэгээ» / «tag» / «хэмжээс» are all used for annotation. |
| «MGL ажил» ↔ «MGL туслах» | Two docked panes, both described as sending progress/daily work (App.cs:613-615 vs 629-633). |
| «Өөрчлөлтийн нөлөө» ↔ «MGL туслах» «Δ» | Both let you see what changed (App.cs:633-634 vs SmartRibbon.cs:50). |
| «MGL нэвтрэлт» ↔ «Тохиргоо» (button) ↔ «MGL ажил» pane | Three sign-in surfaces all call `LicenseGate.SignInAsync`: `LicenseDialog.cs:153`, `SettingsDialog.xaml.cs:121`, `WorkPaneView.xaml.cs:261`. |
| «Зураг холбох» ↔ «Хуудас …» | «Зураг» means sheets here, but «Зураг клонлох» means views/drawings, and «Хуудас» means sheets elsewhere. |
| «Тоо хэмжээ» ↔ «Хүснэгт» ↔ «PDF» | Three "send" buttons whose results land on the same web page `/app/qto` (ScheduleExportCommand.cs:118; PdfViewExportCommand.cs:152). |

## 7. Verdict summary

- **F1 CONFIRMED** (static facts). The crowding itself is unverified. The 23/7 figure applies to R25–R27 only; R24 has 17 buttons in 6 panels.
- **F2 CONFIRMED** (wording judgement), with one nuance: the «Автомат хэмжээс» tooltip does say «хэмжээс, tag-ийг», only the name hides it. The short names were chosen on purpose (App.cs:593-595).
- **F3 CONFIRMED.** The distinction is already carried by the panel title «Сайт руу илгээх» and the «MGL сайт руу» wording in PDF/Тоо хэмжээ tooltips. The «Smart Publish» tooltip and name say nothing about folder output or "not sent to MGL". Its code has no network call; grep of SmartPublish/SmartCount found only a comment mentioning SettingsStore.
- **F4 CONFIRMED** on all three counts (§3.1-3.3), with corrections to the audit wording in §3.2, plus extra stale items in §3.4.


---

<!-- slice B: account -->

## Slice B — Account/Settings dialogs, WorkPane, AssistantPane, Intelligence panel
Static audit at baseline `07934ebb` (add-in 1.13.0). Paths are relative to `revit-mcp/addin` unless they start with `revit-mcp/`. Nothing below is an observation of live Revit; "blocks the UI thread" means "by code reading, the same thread that would render is inside a wait". Timeout figures are upper bounds taken from code constants, not measurements.

### 0. Verification summary

| ID | Status | What the code says today |
|---|---|---|
| F7 | CONFIRMED (one correction) | `SettingsDialog` login and manual project reload block the dialog thread with `Task.Run(...).GetAwaiter().GetResult()`. The *automatic* reload on open is already async (`LoadProjectsSoon`). Title, first field and "Токен" status text are as the audit says. |
| F8 | CONFIRMED | `▾`, `Δ`, `AI`, `⟳` are icon-only; 1 WPF `Expander` + 3 toggle-driven hosts + 6 conditional panels; Intelligence panel is nested inside; 24 `FontSize` declarations < 12 (8 × 10, 16 × 11). Neither pane references the other; only ribbon tooltips differentiate them. |
| F9 | CONFIRMED | `DEV` is declared as the **2nd** tab, unconditionally; nothing hides it; the host creates the panel unconditionally on first "AI" toggle. Tool-level guards exist and must stay. |

---

### 1. Settings dialog and licence/login dialogs

#### 1.1 Who opens what (coupling that a redesign must keep consistent)
- Ribbon panel «Тохиргоо» (`App.cs:825`) contains TWO buttons: «MGL\nнэвтрэлт» → `LicenseCommand` → `LicenseDialog(fromTool:false)` (`App.cs:829-843`, `Licensing/LicenseCommand.cs:16`) and «Тохиргоо» → `QtoSettingsCommand` → `SettingsDialog` (`App.cs:845-856`, `QtoExportCommand.cs:278-287`).
- Every tool command calls `LicenseGate.Ensure()` first; only if the lease is not Valid it opens `LicenseDialog(fromTool:true)` (`Licensing/LicenseGate.cs:143-153`).
- QTO send, schedules, PDF view, sheet binding open `SettingsDialog` when `string.IsNullOrEmpty(settings.Token) || settings.ProjectId == null` (`QtoExportCommand.cs:34-41`, `ScheduleExportCommand.cs:34-41`, `PdfViewExportCommand.cs:51-58`, `BindingCommand.cs:36-43`) and after a 401 (`QtoExportCommand.cs:208`). These are the only consumers that REQUIRE the Settings-selected project; AssistantPane uses it as a hint (`AssistantPane.xaml.cs:605`, `:786`, `:900`, `:1033-1045`, `:1123`).
- A THIRD login UI exists: WorkPane `LoginCard` (`WorkPane/WorkPaneView.xaml:226-241`, `WorkPaneView.xaml.cs:240-285`). All three call `LicenseGate.SignInAsync`.
- `AddinSettings.ProjectId/ProjectName` are written in exactly one place: `SettingsDialog.xaml.cs:193-194`.
- Ribbon tooltip text (stale): `App.cs:850` «Нэвтрэх, төслөө сонгох, серверийн хаяг — БҮХ тохиргоо энд.» and `App.cs:854` «Нэвтрэх шаардлагатай үед бусад товч өөрсдөө энэ цонхыг нээнэ.» — other tools now open `LicenseDialog`, not Settings.
- Strings that send the user to "MGL → Тохиргоо" (must be updated together if the dialog/button is renamed): `AssistantPane.xaml.cs:565`, `:651`, `:1037`, `:1136`, `:2309`, `:2839`; `RevitApi.cs:539`, `:568`; `BindingCommand.cs:82`; `BatchQto.cs:149`; `HttpServer.cs:115`; `Intelligence/Ui/IntelligenceViewModels.cs:375`, `:415`. "Тохиргоо" is ambiguous: it is both a ribbon panel and a button.

#### 1.2 `SettingsDialog.xaml` — every element
Window: `Title="MGL — Тоо хэмжээ тохиргоо"` (`SettingsDialog.xaml:4`), `Width="460"`, `SizeToContent="Height"`, `ResizeMode="NoResize"`, `ShowInTaskbar="False"` (`:5-9`). No custom styles (default WPF chrome; status text colours are `Brushes.Gray` / `Brushes.Firebrick`, `SettingsDialog.xaml.cs:239`).

| Row | Label / control | Text (verbatim) | Line |
|---|---|---|---|
| 0 | label + `HostBox` | «API хост:» | `.xaml:26-27` |
| 1 | label + `UserBox` | «Нэвтрэх нэр:» | `:29-30` |
| 2 | label + `PassBox` | «Нууц үг:» | `:32-33` |
| 3 | `LoginBtn` (IsDefault) | «Нэвтрэх» | `:36` |
| 3 | `LoadProjectsBtn` | «Төслүүд ачаалах» | `:37` |
| 4 | `StatusText` | (code-set) | `:40` |
| 5 | label + `ProjectCombo` (`DisplayMemberPath="Name"`) | «Төсөл:» | `:42-43` |
| 6 | `IncludeLinksBox` | «Холбоос (link) файлуудыг хамруулах»; tooltip «Ачаалагдсан RVT link бүр тусдаа run болж илгээгдэнэ (файл тус бүрийн түүх вэб дээр харагдана).» | `:45-47` |
| 7 | `SaveBtn` (IsEnabled False) | «Хадгалах» | `:50` |
| 7 | `CancelBtn` (IsCancel) | «Болих» | `:51` |

Status strings (`SettingsDialog.xaml.cs`): `:33` «Токен хадгалагдсан (нэвтэрсэн: <username или ?>)»; `:43` fallback project «Төсөл #<id>»; `:80`/`:154` «Төслүүдийг ачаалж байна…»; `:86`/`:160` «Төсөл: <count>» (a count that reads like a selected-project label); `:91`/`:165` «Токен хүчингүй боллоо — дахин нэвтэрнэ үү.»; `:98` «Төслүүдийг татаж чадсангүй: …»; `:109` «API хост, нэвтрэх нэр, нууц үгээ бөглөнө үү.»; `:114` «Нэвтэрч байна…»; `:125` «Нэвтэрч чадсангүй.»; `:134` «Нэвтэрлээ — <role>» with `RoleLabel` (`:242-255`: админ, инженер, архитектор, ахлах, захиалагч, `OK`). `LicenseText.RoleLabel` (`Licensing/Core/LicenseText.cs:30-40`) duplicates this without `захиалагч`.

#### 1.3 `SettingsDialog.xaml.cs` — handlers, blocking calls, state

| Handler | Line | Reads | Writes | Blocking call |
|---|---|---|---|---|
| ctor | `:18-66` | `SettingsStore.Load()` (ApiHost, Username, IncludeLinks, Token, ProjectId, ProjectName) | `HostBox`, `UserBox`, `IncludeLinksBox`, `_token`, `StatusText`, `ProjectCombo` (single saved project); `Loaded += … LoadProjectsSoon()` (`:65`) | none |
| `LoadProjectsSoon` (async void) | `:75-100` | `HostBox`, `_token` | `ProjectCombo` via `ApplyProjects`, `StatusText`; on 401 `_token = null` (`:90`) | none — `await … ConfigureAwait(true)` |
| `LoginBtn_Click` | `:102-145` | `HostBox`, `UserBox`, `PassBox.Password` | `LoginBtn.IsEnabled`, `StatusText`, `_token`, `ProjectCombo`; indirectly `settings.json` (ApiHost/Username, `LicenseGate.cs:374-377`), `device.json`, `license.json`, in-memory session | **`:119-130`** `Task.Run(async () => { SignInAsync…; SettingsStore.Load().Token; GetProjectsAsync… }).GetAwaiter().GetResult()` |
| `LoadProjectsBtn_Click` | `:147-175` | `HostBox`, `_token` | `LoadProjectsBtn.IsEnabled`, `ProjectCombo`, `StatusText`, `_token` on 401 | **`:157-158`** `Task.Run(() => ApiClient.GetProjectsAsync(host, _token)).GetAwaiter().GetResult()` |
| `ProjectCombo_SelectionChanged` | `:177` | selection | button state | none |
| `SaveBtn_Click` | `:182-201` | `ProjectCombo`, `HostBox`, `UserBox`, `IncludeLinksBox`, `_token`, `HasDeviceSession()` | `settings.json`: api_host, username, token (only if no device session, `:192`), project_id, project_name, include_links; `LicenseGate.RefreshInBackground(force:true)` (`:198`); `DialogResult = true` | none |
| `CancelBtn_Click` | `:203` | — | `DialogResult = false` | none |
| `UpdateButtons` / `SetStatus` / `ApplyProjects` | `:229-240`, `:208-227` | `_token`, selection | buttons, status | none |

Why F7 holds: the dialog is shown via `App.ShowOwned(...)` → `window.ShowDialog()` (`App.cs:464`) from a command's `Execute` (Revit main thread), so the WPF dispatcher that would repaint `StatusText` («Нэвтэрч байна…», assigned at `:114`) is the thread parked in `GetResult()`. Worst-case wait by code timeouts: `ApiClient.LoginAsync` has no token and the shared client timeout is 180 s (`ApiClient.cs:63-66`); `SignInAsync` adds up to 4–6 POSTs at 20 s each (`LicenseGate.cs:499`; challenge, enroll, optional key-rotation retry, challenge, licence); `GetProjectsAsync` another 180 s → ≈ 480 s upper bound. No wait cursor, no cancel button, no progress.

Other defects seen while reading:
- Possible race: `LoadProjectsSoon` (auto-start on `Loaded`) catches 401 and sets `_token = null` (`:88-93`) without checking that the token it used is still current. If the user logs in meanwhile, a late 401 for the old token can null the new `_token` (Save then stays disabled). By static reading only.
- `PassBox` is read (`:106`) but never cleared after success (`LicenseDialog.cs:154` and `WorkPaneView.xaml.cs:269` do clear).
- Sign-in state is derived from `settings.Token` (`:29`), not from `LicenseGate.Snapshot()`. `SettingsStore.Load()` injects the in-memory session only when one exists (`SettingsStore.cs:56`), while `LicenseGate.HasToken` also counts the DPAPI credential (`LicenseGate.cs:854-859`). Between Revit start and the first session refresh the two can disagree.
- `API хост` is a free text field and `LoginAsync(host, username, password)` posts the password to whatever is typed (`LicenseGate.cs:371`). `LicenseDialog` and WorkPane never expose it. Remaining host overrides: `MGL_API_HOST` env (`QtoDtos.cs:257-273`) and `api_host` in `settings.json`.
- `IncludeLinksBox` (QTO export option) lives inside the account dialog.

#### 1.4 `Licensing/LicenseDialog.cs` — code-built window (no XAML), fully async
Window: `Title = "MGL — компанийн нэвтрэлт"` (`:54`), `Width = 470`, `SizeToContent.Height`, `NoResize`, `CenterOwner`, `ShowInTaskbar=false` (`:55-59`).

| Element | Text (verbatim) | Line |
|---|---|---|
| heading | «MGL add-in — компанийн нэвтрэлт» (16 DIP SemiBold) | `:64` |
| paragraph | «MGL add-in компанийн бүртгэлээр нэвтэрмэгц ажиллана. Компьютер бүр өөрийн аюулгүй байдлын түлхүүртэй (TPM) — add-in-ийн файлыг хуулж өөр компьютерт тавьсан ч ажиллахгүй. Интернэтгүй үед сүүлийн шалгалтаас хойш 12 цаг ажилласаар байна.» | `:70-72` |
| status (13 DIP) + `_who` | set by `Render` | `:30-31`, `:86-87` |
| login panel | «Нэвтрэх нэр», «Нууц үг» (`_user`, `_pass`) | `:91-94` |
| device code | «Компьютерын код: » + read-only Consolas box (`DeviceShortId` or «—») | `:101-102`, `:199` |
| buttons (MinWidth) | «Нэвтрэх» 110, «Дахин шалгах» 120, «Гарах» 80, «Үргэлжлүүлэх» 120, «Хаах» 80 (IsCancel) | `:35-39`, `:123` |

Handlers: button/key wiring `:118-125` (Enter in `_pass` → login); `Loaded` `:127-133` (calls `LicenseGate.Snapshot()` twice on the UI thread, auto `CheckAsync()` if token but not Valid, else focuses `_user`); `LoginAsync` `:136-167`; `CheckAsync` `:169-187`; `SignOut` `:189-195`; `Render` `:197-238`; `SetBusy` `:240-249` (sets `Cursors.Wait`); `SetStatus` `:251-255`. **No blocking waits.** Late-result guards: `_busy` (`:48`, `:138`, `:171`, `:191`), `_cts` cancelled on `Closed` (`:49`, `:125`), `if (!IsLoaded || !IsVisible) return;` after each await (`:163`, `:183`).

Status strings: `:143` «Нэвтрэх нэр, нууц үгээ бичнэ үү.»; `:146` «Нэвтэрч, энэ компьютерыг бүртгэж байна…»; `:172` «Энэ компьютерыг шалгаж байна…»; `:194` «Гарлаа. MGL add-in-ийг ашиглахын тулд дахин нэвтэрнэ үү.»; `:206` «✓ Лиценз хүчинтэй — энэ компьютер таны бүртгэлээр баталгаажсан.»; `:209` «Интернэтгүй <yyyy-MM-dd HH:mm> хүртэл ажиллана.»; `:210` «Admin гараар зөвшөөрсөн компьютер.»; `:211-215` «Хамгаалалт: TPM түлхүүр.» / «Хамгаалалт: програмын түлхүүр (TPM олдсонгүй).»; `:217` «Анхаар: хуучин горим — удахгүй дуусна. «Гарах» дараад дахин нэвтэрч төхөөрөмжөө бүртгүүлнэ үү.»; `:224` «Бүртгэл: <username>». Messages from `LicenseText` (`Licensing/Core/LicenseText.cs:10-26`) and `LicenseGate` (e.g. `:451` «Энэ төхөөрөмжийг ашиглах зөвшөөрөл хүлээгдэж байна. Системийн админд хандана уу.», `:420` «Сервертэй холбогдож чадсангүй — интернэт холболтоо шалгана уу.», `:582` «Төхөөрөмжийн түлхүүрийг нээж чадсангүй. …», `:618` «Серверийн лицензийг энэ add-in таньсангүй. Add-in-ийг шинэчилнэ үү (admin-д хандана уу).»).

---

### 2. API surface a non-blocking, awaited login / project reload / availability preview can use

Async APIs already exist — no new async surface is needed in `LicenseGate`; the dialog can simply `await`.

| Member | Kind | Line | Notes |
|---|---|---|---|
| `LicenseGate.SignInAsync(host, user, pass, ct)` → `Task<RefreshResult>` | async | `LicenseGate.cs:368` | `ct` reaches only the later `PostAsync` calls (20 s each). The first step `ApiClient.LoginAsync(host, username, password)` (`:371`) takes **no** token — cancel is not honoured there. Persists `ApiHost`+`Username` before the licence completes (`:374-377`). |
| `LicenseGate.RefreshAsync(ct)` | async | `:337` | uses stored credential; used by `LicenseDialog.CheckAsync`. |
| `ApiClient.GetProjectsAsync(host, token)` | async | `ApiClient.cs:210` | no `CancellationToken`; 180 s client timeout. |
| `ApiClient.LoginAsync` | async | `ApiClient.cs:105` | no `CancellationToken`. |
| `LicenseGate.IsLicensedNow()` | sync, no network | `:95` | lock + parsed lease + ECDSA verify + `HardwareProbe.DeviceId` (registry MachineGuid, `HardwareProbe.cs:76`) + cached signer. |
| `LicenseGate.Snapshot()` → `LicenseSnapshot` | sync, no network | `:189`, type `:919` | adds `DeviceCredentialStore.Load()` (file read + DPAPI, called twice via `HasToken`) and `GetSigner(...,false)` (CNG key open, 30 s negative cache `:742`; may touch TPM on first call — latency unmeasured). Already called on the UI thread in `LicenseDialog.Loaded`. |
| `LicenseGate.HasDeviceSession()` | sync | `:248` | `DeviceSession.TryGetToken`. |
| `LicenseGate.RefreshInBackground(force)` | fire-and-forget | `:267` | no result object. |
| `LicenseGate.SignOut()` | sync (file IO) | `:460` | bumps `_generation`. |
| `LicenseGate.Ensure()` / `EnsureForBatch()` | sync, **blocking** | `:116`, `:222` | `Ensure` may block ≤ 12 s in `WaitForSession` (`:160-175`) and may open a modal. |
| `SettingsStore.Load()` | sync, cached copy | `SettingsStore.cs:44` | disk+DPAPI only on first call/after `Save`; also invokes `LicenseGate.OnSettingsRead()` (can start a background session refresh, `:254-264`). Injects session token into `Token` (`:56`). |
| `SettingsStore.Save/ClearStoredToken/Invalidate` | sync | `:154`, `:66`, `:104` | |
| `DeviceSession.TryGetToken/NeedsRefresh/Set/Clear/Upgrade` | internal sync | `DeviceSession.cs:87`, `:104`, `:48`, `:59`, `:73` | `TryGetToken` returns an already-expired token too (`:82-86`). Expiry `_expires` is private — **no getter** (`RefreshBefore` = 12 min, `:39`). |
| `LicenseLease.NeedsRefresh(info, now)` | static | `LicenseLease.cs:138` | `RefreshAfter` default `IssuedAt + 1 h` (`:200-202`). |

**What exposes what**
- Signed-in user: `LicenseSnapshot.UserName` (`settings.Username`, `:206`); `LicenseSnapshot.Info.Name/UserName/Role/Sub` (lease claims, `LicenseLease.cs:161-176`).
- Device authorisation: `Snapshot.Status` (`LeaseStatus`: Valid, Missing, Malformed, UnknownKey, BadSignature, WrongAudience, WrongDevice, NotYetValid, ClockRolledBack, Expired — `LicenseLease.cs:144-156`); `LastCode`/`LastMessage` (persisted, `:46-47`, `LicenseFile` `:894-901`); `Info.Via` (`"approved"` etc.), `Info.Security`, `DeviceSecurity`, `DeviceKeyShortId`, `DeviceShortId`, `DeviceKeyNote`. "Pending approval" is not typed — it is `LastCode == "DEVICE_PENDING"` (`LicenseGate.cs:450`); "needs re-login" is `LastCode` ∈ `LicenseResponse.EnrollCodes` or `"UNAUTHORIZED"` (`LicenseResponse.cs:34-37`, used at `LicenseDialog.cs:227-230`). `RefreshOutcome` (`LicenseGate.cs:904`) is returned, not persisted: an offline refresh stores `code = null` + message (`Remember(RefreshOutcome.Offline, null, …)`), so "offline" can only be inferred from "lease Valid + `LastMessage != null`".
- Lease expiry / offline grace: `Info.ExpiresAt` (offline grace ends here; texts say 12 h), `Info.IssuedAt`, `Info.RefreshAfter`, `Snapshot.CheckedAt`.
- Selected ERP project: local only — `AddinSettings.ProjectId/ProjectName` (`QtoDtos.cs:314-318`) via `SettingsStore.Load()`. Per-document project knowledge is elsewhere: WorkPane `_chosenProject` + `tracking\context.json`, Intelligence `ProjectLinkStore`.

**Non-network preview can read:** `IsLicensedNow()`, `Snapshot()`, `SettingsStore.Load()` (username, host, saved project id/name, include-links), `DeviceSession.TryGetToken/NeedsRefresh`. It cannot know the project list, display name beyond the lease, or team names (network).

**Race guards that already exist (reuse, do not reinvent):** `LicenseGate._generation` (`:57`, bumped in `Remember(clear)`/`SignOut`, checked `:573`, `:623`, `:651`, `:677`); `LicenseDialog._cts` + `_busy` + `IsLoaded/IsVisible` (above); `WorkPaneView._loadVersion` (`:62`, checked `:348`, `:352`, `:388`, `:396`) and `_rejectedToken` (`:69`); Intelligence VM `Post` wraps UI updates in try/catch (`IntelligenceViewModels.cs:299-303`). `SettingsDialog` has none.

**Testability:** `tests/Licensing.Tests` compiles only `Licensing/Core/*.cs`, `HardwareProbe.cs`, `DeviceKeyStore.cs` (`Licensing.Tests.csproj:34-36`); `WorkPane.Tests` only `WorkPane/Core/*.cs`; `Intelligence.Tests` only `Intelligence/{Contracts,Core,Ai}` (`Intelligence.Tests.csproj:34-36`). `LicenseGate`, `SettingsDialog`, both panes and the Intelligence UI have no automated tests. Put new pure view-state logic in those `Core` folders.

---

### 3. `AssistantPane` structure map (`AssistantPane.xaml` 895 lines, `.xaml.cs` 3539)

Root: `UserControl MinWidth="300"` → `Border` → `Grid Margin="9,8,9,9"` with 8 rows (`:371-389`). **No outer `ScrollViewer`**; row 1 is `Auto`, row 2 (chat) is `*` — expanding hosts in row 1 take space from the chat row.

| Row | Content | Lines |
|---|---|---|
| 0 | header: `StatusDot` Ellipse 8×8, `HeaderText` «MGL туслах» (12 SemiBold), `SubHeaderText` «Холбогдоогүй» (11), `RefreshBtn` «⟳» (14 DIP, tooltip «Вэбээс дахин унших») | `:392-419` |
| 1 | "work context" card (Auto height): toolbar `TaskCombo` + `ChecklistToggle` «▾» (tooltip «Дэд жагсаалт харах», swaps to «▴» in `.cs:1494`) + `ChangesToggle` «Δ» (tooltip «Өөрчлөлтүүд — юуг нэмсэн, зассан, устгасан») + `IntelToggle` «AI» (tooltip «MGL AI — Revit контекст, даалгавар, асуудал, тайлан») | `:422-468` |
| 1 | `StatusText` + `TeamChip` (hidden until `SetTeamChip`; «…» fix button tooltip «Багийг залруулах») | `:483-511` |
| 1 | `TeamPickHost` «Аль багийн ажил вэ?», «Батлах», «✕», «Энэ файлд байнга хадгалах» | `:519-555` |
| 1 | `ChecklistHost` (MaxHeight 190) | `:557-577` |
| 1 | `IntelligenceHost` Border `MinHeight="260" MaxHeight="560"` — hosts `IntelligencePanel` | `:580-583` |
| 1 | `ChangesHost`: `ChangesSummary`, «Шинэчлэх» (10 DIP), list in `ScrollViewer MaxHeight="230"` | `:586-611` |
| 1 | `FindingsExpander` «Норм шалгалт» — the ONLY WPF `Expander` (custom `DarkExpander` template `:229-278`); scope text, list `MaxHeight="230"`, `FindingOverrideHost` «Болих»/«Хаах» | `:629-709` |
| 2 | chat `ItemsControl` in `ScrollViewer` | `:714-724` |
| 3 | `DraftPanel` «ИЛГЭЭХ НООРОГ»: «Явц», `PercentBox` (52 wide), `BasisText`, `NoteBox` (86 high), `AiHint`, `ConfirmBox` «Би энэ тайланг уншиж, зөв гэдгийг баталж байна», «Болих», «Илгээх» | `:727-778` |
| 4 | `SuggestPanel` «Аль нь вэ?», items, «Бусад…» | `:786-811` |
| 5 | `FeedbackPanel` «Зөв ойлгов уу?» 👍 👎; `FeedbackNoteRow` «Юу нь буруу байсан бэ?  (заавал биш)», «Илгээх», «Алгасах» | `:814-858` |
| 6 | `BusyText` | `:861` |
| 7 | `InputBox`, `MicBtn` «🎤» (tooltip «Дуугаар бичих (удаан дарж хэл)»), `SendBtn` «➤» | `:866-892` |

Small symbol controls: `ChecklistToggle`, `ChangesToggle`, `IntelToggle` have no `FontSize`, `Width`, `Height` or `MinWidth` — only `Padding="8,2"`/`"7,2"`, `Background="Transparent"`, `Foreground=FgMuted` (`:437-467`), so size is glyph + padding. `RefreshBtn`: `FontSize="14" Padding="8,2"` (`:416`). `MicBtn` is a placeholder: `MicBtn_Up` only says «Дуугаар бичих боломж бэлтгэгдэж байна — одоохондоо бичээд илгээнэ үү.» (`.cs:3531-3537`).

**`FontSize` < 12 in `AssistantPane.xaml` (24 declarations):** 10 DIP at `:167`, `:311`, `:315`, `:323`, `:328`, `:357`, `:363`, `:602`; 11 DIP at `:76` (the `MutedText` style — applied to 16 TextBlocks: `:410`, `:489`, `:498`, `:527`, `:598`, `:637`, `:655`, `:676`, `:689`, `:732`, `:748`, `:758`, `:791`, `:817`, `:837`, `:862`), `:251`, `:308`, `:353`, `:505`, `:552`, `:571`, `:684`, `:695`, `:700`, `:764`, `:802`, `:808`, `:846`, `:850`, `:854`. Other surfaces: WorkPane `MutedText`/`SectionTitle`/`LinkButton` 11 (`WorkPaneView.xaml:84`, `:94`, `:98`), disclosure 10 (`:346`), outbox 11/11.5 (`.cs:753`, `:946`, `:969`, `:998`); Intelligence `IMuted` 11 (`IntelligencePanel.xaml:32`, used 19×).

**Nested Intelligence workspace:** `IntelToggle_Changed` (`.cs:1217-1244`) — on first open sets `IntelligenceHost.Child = new Intelligence.Ui.IntelligencePanel()` (`:1225`) inside `#if MGL_INTELLIGENCE`; on R24 (`net48`) it shows «MGL AI (Revit Intelligence) нь Revit 2025+ дээр л байна.». It is the only host of `IntelligencePanel`. The panel has its own `TabControl` and `ScrollViewer`s inside the 560 DIP-max host inside the pane.

**Naming/purpose collisions:** the toggle «AI» opens a workspace whose last tab is also «AI» (`IntelligencePanel.xaml:265`); the chat itself is a third AI (local Claude agent or `/api/revit/agent/turn`, «Локал AI · таны Claude захиалгаар», `.cs:2846`) while the toggle goes to `MglAiTurnClient` (`RevitIntelligenceHost.cs:196-201`). Four different "refresh" buttons: `⟳` (`ReloadAsync`), «Шинэчлэх» in changes, `↻` in Intelligence (`IntelligencePanel.xaml:144`), «Шинэчлэх» in WorkPane (`WorkPaneView.xaml:218`).

**Patterns to PRESERVE (with evidence)**
1. Nested-button handling: `Click` bubbles, so inner «Ойлголоо/Дараа» and «Хүчингүй болгох» set `e.Handled = true` (`.cs:3373`, `:3396`); rationale comments `.xaml:288-292` and `.cs:3367-3369`. Row template is a `Button` (keyboard/AT access) `:294-336`.
2. UI-thread marshaling: `AcceptSurface`/`PublishFindings` check `Dispatcher.CheckAccess()` and use fire-and-forget `InvokeAsync`, never `Invoke` (deadlock with `ChangeTracker.Gate`) `.cs:2975-3012`; same rule `SetTeamChip` comment `:703-707`, `RefreshTeamContextSoon` (`:813`, `:925`); Intelligence `Post` uses `BeginInvoke(Background)` (`IntelligenceViewModels.cs:299-303`); WorkPane `OnHostChanged` `BeginInvoke` (`WorkPaneView.xaml.cs:116-120`). All `RevitToolBus.Call` use go through `Task.Run` (`.cs:280-283`, `:570`). Note the deliberate exception: agent callbacks use synchronous `Dispatcher.Invoke` (`.cs:2855-2872`) from the agent thread.
3. Bounded finding feed: `FindingFeed.MaxVisible = 40`, `MaxVisibleRows = 120`, `MaxConsequencesShown = 9` (`FindingFeed.cs:48`, `:65`, `:68`), list `ScrollViewer MaxHeight="230"` (`.xaml:658`), explicit truncation rows «…бас N дагавар» / «+N бүлэг харагдаагүй» (`.cs:3039-3051`); `ItemsControl` is not virtualized (`FindingFeed.cs:43-46`).
4. No focus stealing / no auto-open: comments `.cs:2946-2954`, `:697-701`; override row «ФОКУС АВАХГҮЙ» (`:3408`); the single `.Focus()` is user-initiated after 👎 (`:2366`); `DockablePane.Show()` only from ribbon commands (`AssistantPaneProvider.cs:56`, `WorkPane/WorkPaneProvider.cs:57`); `SetBusy` (application-wide `Mouse.OverrideCursor`, `:542`) is not called from background flows (`:2941-2944`). Findings start collapsed (`FindingsExpander IsExpanded="False"`, `.xaml:629`).
5. Idempotent draft submit (`_draftUid`, `.cs:1661-1662`, `:1805-1808`); comma→dot percent parsing (`:1754-1758`); `Click` not `Checked` for checklist items (`:1501-1507`); readable combo templates on dark theme (`.xaml:90-147`).
Stale line references inside comments (code is truth): `.cs:2953` says focus at `:1874` (actual `:2366`); `.cs:2942` says cursor at `:351` (actual `:542`); `.xaml:620`, `.cs:699`, `:2947` say `AssistantPaneProvider.cs:54` (actual `:56`); `docs/ASSISTANT.md:129` says 815 lines.

**Duplication with WorkPane** — see §5 table.

Dead/stale in Assistant: `res.AwaitingApprover` → «Ахлагчийн баталгаажуулалт хүлээж байна.» (`.cs:1789-1791`) while the server hard-codes `awaiting_approver: false` (`backend/src/routes/revit.ts:2260`); the pane has no handling of hours-mode projects (`grep -i hours` = 0 hits in `AssistantPane.xaml.cs`/`RevitApi.cs`) or of `TAKE_REQUIRED`/`MANAGED_ROOT` (0 hits anywhere in the add-in).

---

### 4. `IntelligencePanel` and the DEV tab

Tabs in declaration order (`Intelligence/Ui/IntelligencePanel.xaml`): `BannerText` (`:130`), then Контекст (`:135`), **DEV (`:173`)**, Даалгавар (`:199`), Асуудал (`:226`), Тайлан (`:242`), AI (`:265`). DEV is the 2nd tab, ahead of the four employee tabs.

DEV declaration, verbatim: `<TabItem Header="DEV" Style="{StaticResource ITab}" ToolTip="DEVELOPMENT / TEST ONLY — синтетик тест загвар">` (`:173`), banner «DEVELOPMENT / TEST ONLY · NON-PRODUCTION · SYNTHETIC MODEL» (`:176`). The TabItem has **no `x:Name`, no `Visibility`, no binding** and `IntelligencePanel.xaml.cs:20-30` (constructor) does not touch it — nothing hides it. `IntelligenceViewModel.RefreshContext` only updates `Dev.Gate/NoDocument/IsTestDoc` text (`IntelligenceViewModels.cs:312-317`). The panel is created unconditionally on first «AI» toggle (`AssistantPane.xaml.cs:1225`) in every net8/net10 build (`RevitMcpAddin.csproj:170-175`, `net48` excluded `:176-179`).

| DEV button (`.xaml` line) | Handler (`.xaml.cs`) | Tool | Guard that exists today |
|---|---|---|---|
| «Тест төсөл үүсгэх (хоосон, метрик)» (`:179`) | `DevNewProject_Click` `:77` | `test_project_new` | **None.** `NewTestProject` (`TestModelFixture.cs:340-369`) makes a blank Metric project, marks it, `SaveAs` into AppData `test-models`, then `OpenAndActivateDocument`. |
| «Хаалт шалгах» (`:181`) | `:78` | `test_model_gate` | read-only |
| «Тест загвар үүсгэх» (`:182`) | `:79` | `test_model_create` | `Create` → `Gate`: `if (!gate.Allowed) throw new InvalidOperationException("TEST_MODEL_REFUSED: " + gate.Reason);` (`TestModelFixture.cs:104-105`); `Gate` refuses family/linked/workshared/read-only (`:80-83`) and any content: `if (g.ModelElementCount > 0) { g.Reason = TestModelGateReason.REFUSED_HAS_MODEL_CONTENT; return g; }` (`:89`); allows only marked blank, unsaved blank, or saved blank + confirm token (`:90-92`) |
| «Тест: ханыг зөөх» / «ханыг устгах» / «хаалга устгах» (`:185-187`) | `:80-82` | `test_model_mutate` | `if (!IsTestMarked(doc)) throw new InvalidOperationException("TEST_MUTATE_REFUSED: баримт MGL-AI-TEST тэмдэггүй");` (`:266`) + manifest required (`:268`) |
| «Тест загварыг хадгалах (.rvt)» (`:190`) | `:83` | `test_model_save` | `if (!IsTestMarked(doc)) throw new InvalidOperationException("TEST_SAVE_REFUSED: баримт MGL-AI-TEST тэмдэггүй — компанийн загварыг энэ замаар хадгалахгүй");` (`:319`), `OverwriteExistingFile = false` (`:323`) |
| «Бүгдийг дахин үнэлэх» (`:191`) | `DevEvaluate_Click` `:84` | `EvaluateAllCurrent` | none (generic) |
| (not in UI) | — | `test_project_open` / `test_project_close` | restricted to the `test-models` folder (`:377`, `:392`) |

The guards sit in `TestModelFixture`/`IntelligenceTools` (`IntelligenceTools.cs:33`, `:193-210`) and are also reachable through the localhost bridge `POST /tool` (token + licence only, no tool allowlist: `HttpServer.cs:103-139`); `docs/mgl-ai/REVIT_INTELLIGENCE.md:195` documents a DEV bridge acceptance path — so the tools/guards must be preserved; only the UI exposure should be gated.

**Other non-employee-friendly content in the same panel (not F9, but same decision):** the AI tab embeds a write path («Санал болгож буй өөрчлөлт (CONFIRM_WRITE · зөвхөн сонгосон элемент)», English `Preview`/`Apply`, `Comments`/`Mark`/«Зөөх Y (мм)»/«Зөөх X (мм)»/«Төрөл солих», `IntelligencePanel.xaml:275-307`; `ApplyAsync` `IntelligenceViewModels.cs:604-626`); tooltips leak internal ids («R4 — бичих үйлдэл энэ релизэд идэвхгүй (PROPOSE preview-only)» `:118`, «(R-9)» `:217`); disabled placeholders «Засвар санал» `:118` and «ERP руу илгээх» `:257`; line `:220` «Явцын хувийг Revit тооцохгүй — «Миний ажил» хуудасны дэд жагсаалт л хувь өгнө.» sits beside two panes that submit percentages (possibly stale).

**Candidate "development mode" surfaces**

| Option | Evidence | Risk | Verdict |
|---|---|---|---|
| New env var, default off, `Ordinal == "1"` (e.g. `MGL_DEV_MODE`) | exact precedent `BridgeAuth.ArbitraryCodeAllowed` ← `MGL_ALLOW_EXEC` (`BridgeAuth.cs:92-97`); `MGLAI_TURN_BASE_URL` already "ЗӨВХӨН DEV/TEST" (`RevitIntelligenceHost.cs:198-200`); others `MGL_API_HOST` (`QtoDtos.cs:257`), `MGL_RIBBON_TAB` (`App.cs:559`), `MGL_SMART_DIR` | per-process, not persisted, not in `settings.json`; user can set it but tool guards remain | **Recommended (least risky)** |
| `settings.json` key | `AddinSettings` is hand-editable; comment `QtoDtos.cs:352-367` says such values must never open rights | persists, easy to leave on | No |
| Build constant | csproj defines `MGL_INTELLIGENCE`/`MGL_WORK_TRACKING`/`MGL_SMART` (`:165-233`); **`DEBUG` is never defined** — configs give `DEBUG_R27`/`RELEASE_R27` (`Percentiles.cs:255-275`, `RevitToolBus.cs:181-186`, `AssistantPane.xaml.cs:2051`) so `#if DEBUG` would silently never compile in | XAML cannot `#if`; needs the tab moved to code-behind or a second DLL | Possible later hardening, not step one |
| Hidden registry key | `Registry` only used read-only in `HardwareProbe.cs:76-101` | new surface, no precedent | No |
| Role/licence claim | `LicenseGate.Snapshot().Info.Role` | admin ≠ developer | No (optional AND-condition) |
| Test-document marker | `Dev.IsTestDoc` (`IntelligenceViewModels.cs:314`) | only true after a test model exists — cannot reveal «Тест төсөл үүсгэх» | Secondary display hint only |

Mechanics: give the TabItem `x:Name="DevTab" Visibility="Collapsed"`; in the constructor set `Visible` only when a single static helper (put in `Intelligence/Core` so `Intelligence.Tests` can cover it) returns true; move the tab to last position; leave `DevToolAsync`, `TestModelFixture` and tool registration untouched.

---

### 5. `WorkPane` (`WorkPane/WorkPaneView.xaml` 352 lines, `.cs` 1020, `Core/WorkPaneRules.cs`)

Structure (single `ScrollViewer`, `MinWidth="280"`): header «MGL ажил» 14 SemiBold + `WhoText` («Нэвтрээгүй» default) + «Шинэчлэх» + «Гарах» (`:208-223`); `LoginCard` «ERP-ийн нэр, нууц үгээрээ нэвтэрнэ үү» / «Нууц үг хадгалагдахгүй — энэ компьютерт зөвхөн шифрлэгдсэн нэвтрэлтийн токен үлдэнэ.» / «Нэвтрэх нэр» / «Нууц үг» / «Нэвтрэх» (`:226-241`); `WorkBody` (`:244-348`): `OutboxCard` «ИЛГЭЭГДЭЭГҮЙ ТАЙЛАН» (`:253-258`), card «ОДООГИЙН АЖИЛ» (`DocLine` «Файл: —», `ProjectLine` «Төсөл: —», `ContextStatus`, `ChoicePanel`, `TaskPanel` «Одоо аль таск дээр ажиллаж байна вэ?» + «Таскийн сонголтыг цуцлах», `:261-290`), card «ЯВЦ БА ТАЙЛАН» (`PercentPanel`: «Явц %», «Өнөөдөр юу хийсэн бэ? (богино)», `CompleteCheck` «Энэ таскийг ДУУСГАХ (100%)», `QuestionsPanel`, «Тайлан илгээх», «Вэб дээр нээх»; `HoursPanel`: «Засварын таск — хувь бөглөхгүй. «Ажилласан» гэж тэмдэглэхэд цагийг систем бодно (вэбийн «Миний ажлууд»-тай ижил).» + «Өнөөдөр ажилласан»; `ReportStatus`, `:293-338`), then the disclosure `:346-347`. Pane registered with `VisibleByDefault = true` (`WorkPaneProvider.cs:33`); compiled only for net8/net10 (`RevitMcpAddin.csproj:208-216`), so absent on R24.

Flow: `OnLoaded` → `ApplyAuth` → `LoadContextAsync` (`Task.Run(RevitApi.CallTool("get_document_context"))`, then `WorkPaneApi.GetWorkContextAsync`) with `_loadVersion` stale guard → `ApplyContext` → `BuildTaskList` (`WorkPaneRules.DecideTask`; auto-select only for a single task in a server-confirmed project, never guesses) → task pick calls `WorkTrackingHost.SelectTask` → `SendBtn_Click` validates (`WorkPaneRules.CheckPercent`, ceiling 99, no regression, notes ≥ 3 chars, 100% needs all `completion_questions` + MessageBox) → `h.EnqueueReport(...)` to the disk outbox → `ScheduleReload(8000)`. Hours-mode tasks use `MarkBtn_Click` → `POST /api/repair`.

**Explanatory strings about active time / tracking / offline (verbatim, with where)**
- Disclosure (FontSize 10, `MutedText`): «MGL-ийн Revit нэмэлт нь сонгосон таск дээр Revit-д идэвхтэй ажилласан хугацааг бүртгэдэг. Товчлуур, дэлгэцийн зураг, файлын агуулга, бусад програм цуглуулахгүй.» — `WorkPaneView.xaml:346-347`; comment `:340-345`: «Мэдэгдлийг бүхэлд нь авах эсэх нь эзний шийдвэр — өөрөө бүү хас.»
- Ribbon tooltip: «Одоо аль таск дээр ажиллаж байгаагаа сонгоно — Revit-ийн идэвхтэй цаг автоматаар тоологдоно.» (`App.cs:612`); detail «Start / Pause товч БАЙХГҮЙ: сонгосон таск дээр Revit урд, хулгана/гар идэвхтэй үед цаг өөрөө тоологдоно; 5 минут оролтгүй бол идэвхгүй болно.» (`App.cs:613-614`); «Сүлжээгүй үед бүртгэл компьютерт хадгалагдаж, холболт сэргэхэд илгээгдэнэ.» (`App.cs:616`). These two tooltip sentences contradict the pane's own rule «текстэнд «цаг тоологдоно» гэж бичихгүй» (`WorkPaneView.xaml.cs:27-29`); resolving that is an owner decision.
- `WorkPaneView.xaml.cs:167` «“MGL ажил” энэ Revit дээр ажиллахгүй байна (Revit 2027 шаардлагатай).» — shown when `WorkTrackingHost.Instance == null`, but the pane compiles for R25/R26 too.
- Offline/outbox: `:390-393` «Сервертэй холбогдож чадсангүй — «Шинэчлэх»-ээр дахин оролдоно уу. Бичсэн тайлан хадгалагдаж, холболт сэргэхэд илгээгдэнэ.»; `:834-837` «Тайлан дараалалд орлоо — сүлжээтэй бол хэдэн секундэд илгээгдэнэ. Илгээгдэх хүртэл дээд талын «Илгээгдээгүй тайлан» хэсэгт харагдана.»; `:290-291` logout confirm «Илгээгдээгүй тайлан хадгалагдсан хэвээр — та дахин нэвтрэхэд илгээгдэнэ.»; `WorkPaneRules.cs:312-315` «⚠ Илгээгдсэнгүй: …», «⏳ Дахин нэвтэрсний дараа илгээгдэнэ: …», «⏳ Сүлжээ сэргэхэд илгээгдэнэ: …», «⏳ Илгээж байна: …».

**Constraints from WorkTracking (do not change):** all thresholds live in `WorkTracking/Core/TrackingPolicy.cs` (`SampleInterval` 2 s `:25`, `SyncInterval` 10 s `:28`, `IdleThreshold` 5 min `:35`, `ForegroundGrace` 30 s `:42`, `MaxSampleGap` 60 s `:49`, `HttpTimeout` 8 s `:55`). `TrackingView` carries `State`, `TodayTaskMs`, `TodayTotalMs` (`WorkTracking/WorkTrackingHost.cs:19-40`) but no UI reads them (grep: zero consumers outside the host; `WorkPaneView` uses only `UserId`, `ProjectId`, `DocName`, `TaskId`, `WorkDate`, `Online`, `AuthRequired`). The pane must keep showing no timer, no "counting" state, no daily list; `TrackingPanel` was removed deliberately (`WorkPaneView.xaml:19-23`, `WorkTrackingHost.cs` header).

**WorkPane vs Assistant overlap**

| Concern | AssistantPane | WorkPane |
|---|---|---|
| Ribbon purpose text | «Өдрийн ажлаа монголоор бичиж MGL сайт руу илгээнэ.» (`App.cs:628`) | «Одоо аль таск дээр ажиллаж байгаагаа сонгоно — …» (`App.cs:612`) |
| Cross-reference | none | none |
| Login | none; says «Эхлээд MGL → Тохиргоо цонхноос нэвтэрнэ үү.» (`.cs:565`) | own `LoginCard` → `SignInAsync` |
| Project source | `Settings.ProjectId` hint → `GET /api/revit/context` (`RevitApi.cs:383-387`, `.cs:605`) | per-file registration/choice → `GET /api/revit/work-context` (`WorkPaneApi.cs:47-52`) |
| Task selector | `TaskCombo` (`.xaml:433`) | `TaskCombo` (`WorkPaneView.xaml:282`); selection = attribution via `SelectTask` |
| Percent/notes/submit | AI-drafted DraftPanel + explicit confirm checkbox → `RevitApi.SubmitAsync` | direct entry → disk outbox → background send |
| 100% closure | not offered (ceiling 99) | `CompleteCheck` + questions + confirm |
| Hours-mode (ZA) | not handled | `HoursPanel` / «Өнөөдөр ажилласан» |
| Offline | needs network; idempotent retry via `_draftUid` | outbox with retry/discard |
| Also has | chat, changes (Δ), compliance, AI workspace, team chip | outbox, disclosure |
| Auto-show | no (`SetupDockablePane` sets no `VisibleByDefault`) | `VisibleByDefault = true` |
| Builds | R24–R27 | R25–R27 |

---

### 6. Blocking waits across the add-in (`GetAwaiter().GetResult()`, `.Result`, `.Wait()`, `Task.Wait`, `Thread.Sleep`, `Join`)

**A. On the Revit UI thread / a WPF dispatcher on it**

| file:line | Construct | Path | Bound |
|---|---|---|---|
| `SettingsDialog.xaml.cs:130` | `Task.Run(async…SignInAsync+GetProjects).GetAwaiter().GetResult()` | dialog click handler (UI) | ≈ 480 s upper bound (see §1.3) |
| `SettingsDialog.xaml.cs:158` | `Task.Run(GetProjectsAsync).GetAwaiter().GetResult()` | dialog click handler (UI) | 180 s |
| `QtoExportCommand.cs:191` | `Task.Run(PostRevitRunAsync).GetAwaiter().GetResult()` | `IExternalCommand.Execute` | 180 s |
| `ScheduleExportCommand.cs:110` | `Task.Run(PostSchedulesAsync)…GetResult()` | `Execute` | 180 s |
| `PdfViewExportCommand.cs:131`, `:142` | upload + register `…GetResult()` | `Execute` | 180 s each |
| `BindingCommand.cs:77` | `Task.Run(HandshakeAsync)…GetResult()` | `Execute` | HTTP timeout of that call |
| `Licensing/LicenseGate.cs:175` | `t.Wait(TimeSpan.FromSeconds(12))` in `WaitForSession`, reached from `Ensure()` (`:139`) at the start of almost every ribbon command and both pane commands | `Execute` | ≤ 12 s, at most once per 60 s (`:165`) |
| `Licensing/LicenseGate.cs:233` | `Task.Run(...).GetAwaiter().GetResult()` in `EnsureForBatch` | unattended batch on main thread | ≤ 45 s |
| `BatchQto.cs:172` | `Task.Run(PostRevitRunAsync)…GetResult()` | unattended batch `ApplicationInitialized` | 180 s |
| `QtoProgressWindow.xaml.cs:236-240` | `while (!task.IsCompleted) { UiPump.DoEvents(); Thread.Sleep(50); }` then `GetResult()` | modal progress window | not a hard block (pump loop), but a busy-poll on the UI thread |
| `CodeExecutorEventHandler.cs:66` | `CSharpScript.EvaluateAsync(...).GetAwaiter().GetResult()` | `ExternalEvent.Execute` (MCP executor, not net48) | script runtime |
| `WorkTracking/WorkTrackingHost.cs:151` | `t.Wait(ShutdownFlushTimeout)` | `App.OnShutdown` | 1.5 s |
| `App.cs:371`, `:379` (+ `Percentiles.cs:361`) | `BimEmitter.Join(400)`, `ComplianceScheduler.Join(400)`, thread `Join` | `App.OnShutdown` | 400 ms each |

**B. Background threads (not UI)**: `BimEmitter.cs:1144`, `:1175` (post thread), `:632`, `:648` (pump); `HttpServer.cs:265`, `:279` (listener worker, 60 s); `RevitToolBus.cs:237` (`Wait(0)`), `:269`, `:450`, `:484` (callers must be non-UI by contract, `RevitToolBus.cs:219`, `:382`); `ComplianceScheduler.cs:743`, `:775`; `Intelligence/Revit/RevitIntelligenceHost.cs:515`, `:555` (`ResolveLink`/`RefreshTasks` only reached via `Task.Run`/debouncer), `:682` (`_refreshLock.Wait()`), `:610`, `:703`, `:714` (`Thread.Sleep`); `Intelligence/Ui/IntelligenceViewModels.cs:694` (`ProbeRuntimeAsync().Wait()` inside `Task.Run`); `Smart/Core/SmartLog.cs:174` (`Flush`); `Smart/Core/SmartStore.cs:301`, `:491` (`Thread.Sleep` retry; caller thread not verified).

**C. Not waits (false positives of the grep):** `FamilyHub/Revit/FamilyHubExternalEvent.cs:64` and `SheetNumerator/Revit/SheetNumeratorBridge.cs:111` read `t.Result`/`x.Result` inside a `ContinueWith` after completion; `job.Result` in `ChangeImpact/Revit/RevitImpactSession.cs:27`, `ClashCheck/Revit/RevitClashSession.cs:81`, `SmartCount/Revit/RevitCountSession.cs:122`, `SmartPublish/Revit/PublishImpactAnalysis.cs:69-70` is a property of a job object; `RuleEngine`/`ComplianceState` `.Result` are enum fields.

**D. Synchronous marshaling (blocks the *calling* thread until the UI answers):** `AssistantPane.xaml.cs:2855-2872` (agent callbacks), `FamilyHub/Ui/FamilyHubWindow.xaml.cs:558`.

Only `SettingsDialog` (2 sites) is a *dialog* freezing on a click; the `Execute`-path network waits (rows 3-7 of table A) are structural (`IExternalCommand.Execute` is synchronous) and would need a progress surface rather than a simple `await`; `QtoProgressWindow` is the existing pump-based pattern.


---

<!-- slice C: dialogs -->

# Slice report: XAML dialogs, FamilyHub and accessibility audit

Baseline: commit `07934ebb`, add-in v1.13.0, static analysis only. Paths are relative to `revit-mcp/addin` unless they start with `revit-mcp/` or `backend/`.
Nothing here is an observation of live Revit. Contrast ratios are arithmetic on the hex literals found in XAML or code.
Classification codes: **F** fine · **A** ambiguous · **E** English or developer-facing · **J** technical jargon · **M** mixed.

## 0. Verdicts

| Finding | Verdict | One-line truth |
|---|---|---|
| F10 | CONFIRMED | «Цэвэрлэх» only unticks (nothing deleted). «Бүгдийг батлах» writes ticked rows as `confirmed` AND every unticked row as `ignored`. In SchedulePicker, «Цэвэрлэх» clears hidden (filtered) rows too, while «Бүгдийг сонгох» touches only visible rows. |
| F11 | CONFIRMED (minor correction) | All quoted strings exist. «Family loaded» has no trailing period in XAML (`FamilyHubWindow.xaml:199`). Far more English tokens exist than the audit lists (section 1.5). Two tests assert the English token `AUTH_REQUIRED`. |
| F12 | CONFIRMED | Both good patterns exist. Gaps are real and systemic: `AutomationProperties` appears in only one XAML file, and there are zero `LabeledBy`, `Label`, `AccessText`, `FocusVisualStyle`, `ShowOnDisabled`, `LiveSetting` or `SystemColors` uses repo-wide. |

---

## 1. Full user-visible string extraction

### 1.1 BindingDialog (+ BindingCommand)

No `ToolTip` exists anywhere in `BindingDialog.xaml`.

| file:line | verbatim string | class / note |
|---|---|---|
| BindingDialog.xaml:4 | `Title="MGL — Зураг холбох"` | F |
| BindingDialog.xaml.cs:136 | `"MGL — Зураг холбох · " + ProjectName` | F |
| BindingDialog.xaml:18-23 | «Revit-ийн хуудас бүрийг вэб дээрх ажилтай холбоно. Систем таамаглаж бөглөсөн — та зөвхөн шалгаад буруу мөрийг нь засна. Нэг удаа хийхэд хангалттай: дараа нь хуудасны дугаар/нэр солигдсон ч холбоос үлдэнэ. Тэмдэглээгүй мөрийг «алгассан» гэж хадгална (саараар харагдана) — хожим хүссэн үедээ дахин тэмдэглэж болно.» | A. The ONLY place that says unticked means saved-as-ignored. «алгассан» never appears on any control. |
| BindingDialog.xaml:27 | `Content="Итгэлтэй мөрүүдийг сонгох"` | A. Real rule: `Confidence >= 0.8 && SelectedTask != null`; it also UNTICKS every other row (.cs:191-196). |
| BindingDialog.xaml:29 | `Content="Бүгд"` | A. Ticks every row that has a task; unticks rows without a task (.cs:198-202). |
| BindingDialog.xaml:31 | `Content="Цэвэрлэх"` | A. Unticks all rows; the drawing/task combos are untouched (.cs:204-208). |
| BindingDialog.xaml:33 + .cs:184 | `$"{ready} / {_rows.Count} холбогдохоор бэлэн"` | A. «ready» = ticked AND task chosen. The total includes previously ignored rows. |
| BindingDialog.xaml.cs:185-187 | `$"{checkedNoTask} мөрөнд ажил сонгоогүй байна"` | F |
| BindingDialog.xaml:60 | `Header="✓"` | J. Glyph-only column header. |
| BindingDialog.xaml:68 / 69 | `Header="Хуудас"` / `Header="Нэр"` | F |
| BindingDialog.xaml:70 | `Header="Зураг"` | A. Means the web «зураг» (drawing group entity), not the Revit sheet. |
| BindingDialog.xaml:80 | `Header="Ажил"` | A. The web task. |
| BindingDialog.xaml:90 | `Header="Итгэл"` | J/A. Heuristic score (section 2). Shown as `0.00` format or `—` (.cs:40). |
| BindingDialog.xaml:96-97 | «Хуудас бүрийг ажлын дэд жагсаалтад автоматаар нэмэх» + `Text="— явцын хувийг үүнээс тооцно (8/13 → 62%)"` | J («дэд жагсаалт» = the user's personal checklist). Default ticked. |
| BindingDialog.xaml:102 | StatusText, Foreground `#B45309` | F |
| BindingDialog.xaml:103 | `Content="Бүгдийг батлах"` (`IsDefault="True"`) | A. Does not confirm all rows. |
| BindingDialog.xaml:105 | `Content="Хаах"` (`IsCancel`) | A. Closing discards ticks silently; there is no Closing handler. |
| BindingDialog.xaml.cs:213 | `"Хадгалж байна…"` | F |
| BindingDialog.xaml.cs:257-260 | `$"{res?.Saved ?? 0} хуудас холбогдлоо."` + «\n\nАжил бүрийн дэд жагсаалт автоматаар үүслээ — одоо «MGL туслах» самбараас өдрийн явцаа илгээж болно.» | A. Ignores `res.Ignored`. The checklist sentence is printed whenever the box was ticked, even if the server added 0 rows (dedupe, 50-item cap). |
| BindingDialog.xaml.cs:270 | MessageBox caption `"MGL — алдаа"` + `RevitApi.FriendlyError(ex)` | F |
| BindingDialog.xaml.cs:155-171 | Option labels: drawing `BlockName + " · " + Name`; task `t.Name` | F |

BindingCommand.cs messages (shown before/after the dialog):

| line | string | class |
|---|---|---|
| 21 | `"MGL — Зураг холбох"` | F |
| 31 | «Эхлээд төслийн файлаа нээнэ үү.» | F |
| 51 | «Хуудсуудыг уншиж чадсангүй.\n\n» + FriendlyError | F |
| 59-61 | «Энэ файлд хуудас (Sheet) олдсонгүй.\n\nЯвцын бүртгэл нь ХУУДАС дээр тулгуурладаг — эхлээд хуудсуудаа үүсгэнэ үү.» | J («Sheet») |
| 81-82 | «Нэвтрэлт хүчингүй болжээ. Тохиргоо цонхноос дахин нэвтэрнэ үү.» | F |
| 87-88 | «Сервертэй холбогдож чадсангүй:\n\n» + FriendlyError | F |
| 94 | «Сервер хүлээгдээгүй хариу буцаалаа.» | F |

Ribbon, App.cs:641 onward: «Зураг\nхолбох», ToolTip «Revit-ийн хуудсуудыг MGL дээрх ажлуудтай холбоно.»; LongDescription starts «ЗААВАЛ БИШ.…». All F.

### 1.2 SchedulePickerDialog (+ ScheduleExportCommand)

No `ToolTip` exists in `SchedulePickerDialog.xaml`.

| file:line | verbatim string | class / note |
|---|---|---|
| SchedulePickerDialog.xaml:4 | `Title="MGL — Хүснэгт сонгох"` | F |
| SchedulePickerDialog.xaml:17-18 | `SearchBox` TextBox with NO label, NO hint, NO name | gap (section 5) |
| SchedulePickerDialog.xaml:21 | `Content="Бүгдийг сонгох"` | A. Selects only the currently filtered (visible) rows (.cs:90-95). |
| SchedulePickerDialog.xaml:22 | `Content="Цэвэрлэх"` | A. Unticks ALL rows including filtered-out ones (.cs:97-101). |
| SchedulePickerDialog.xaml:32-35 | Item = `{Category} — {Name}` + `RowLabel` | F. Category comes from `ScheduleReader.CategoryNameOf`; a raw Revit category name can be English. |
| SchedulePickerDialog.xaml.cs:18 | `"(" + RowCount + " мөр)"` | F |
| SchedulePickerDialog.xaml.cs:82 | `selected + " / " + _all.Count + " сонгосон"` | F. Counts across ALL rows, not only the filtered view. |
| SchedulePickerDialog.xaml:43 / 44 | `Content="Илгээх"` (`IsDefault`) / `Content="Болих"` (`IsCancel`) | F. «Илгээх» is never disabled; zero selection raises a MessageBox. |
| SchedulePickerDialog.xaml.cs:109 | MessageBox «Дор хаяж нэг хүснэгт сонгоно уу.» caption `"MGL"` | F |

ScheduleExportCommand.cs:
- `22` «MGL — Хүснэгт»
- `45` «Илгээж болох хүснэгт олдсонгүй.»
- `87` «Сонгосон хүснэгтүүдийг уншиж чадсангүй.»
- `99-102` «N хүснэгт сонгосон байна — нэг удаад 60 хүртэл илгээх боломжтой.\n\nСонголтоо цөөрүүлээд дахин оролдоно уу (үлдсэнийг нь дараагийн удаад илгээж болно — сервер тал нэрээр нь шинэчилдэг).» A: the 60 cap is revealed only AFTER the picker closes, and the saved selection is already persisted.
- `113-118` «Илгээлээ.», «Хүснэгт: N», «Нийт мөр: N», «Вэб: /app/qto → Самбар → Хүснэгт»
- `124` «Токен хүчингүй — Тохиргооноос дахин нэвтэрнэ үү.»
- `129` «Илгээхэд алдаа гарлаа.\n\n» + FriendlyError

### 1.3 BatchSheetDialog (+ BatchSheetCommand)

Only tooltip: `ToolTip="{Binding Name}"` on the parameter-name TextBlock (BatchSheetDialog.xaml:57).

| file:line | verbatim string | class / note |
|---|---|---|
| BatchSheetDialog.xaml:4 / BatchSheetCommand.cs:27 | `"MGL — Хуудас үүсгэх"` | F |
| BatchSheetDialog.xaml:24 | «Хуудасны параметрүүдийн утгыг сонгоод эхлэх дугаар ба тоо ширхэгээ өгнө үү. «Дугаарт» гэж тэмдэглэсэн параметрүүд хуудасны дугаарт угсарна.» | F |
| BatchSheetDialog.xaml:33 / 34 / 35 | «Дугаарт» / «Параметр» / «Утга» | F. Column headers; the row controls beneath them have no accessible label. |
| BatchSheetDialog.xaml:70 | «Хуудасны текст параметр олдсонгүй. Зөвхөн дугаараар хуудас үүсгэж болно.» | F |
| BatchSheetDialog.xaml:87-90 | «Тусгаарлагч» / «Эхлэх дугаар» / «Тоо ширхэг» / «Урт (0 = нөхөхгүй)» | A for «Урт»: unit is not stated (digits of the counter only, section 3). |
| BatchSheetDialog.xaml:104 | «Гарчгийн хүснэгт (Title Block)» | F (bilingual) |
| BatchSheetDialog.xaml:110 | `Хуудасны нэр (&lt;n&gt; = дугаар)` | A. `<n>` is replaced by the PADDED counter only, not the full sheet number. |
| BatchSheetDialog.xaml:116 | «Урьдчилан харах» | F |
| BatchSheetDialog.xaml:125 / 126 | «Үүсгэх» (`IsDefault`) / «Болих» (`IsCancel`) | F. «Үүсгэх» is always enabled; validation happens by MessageBox on click. |
| BatchSheetDialog.xaml.cs:104 | default name template «Хуудас <n>» | F |
| BatchSheetDialog.xaml.cs:108 | «(гарчгийн хүснэгтгүй)» | F. Silent fallback (section 3). |
| BatchSheetDialog.xaml.cs:154 | «(тоо ширхэг ≥ 1 байх ёстой)» | F |
| BatchSheetDialog.xaml.cs:176 | `"   (давхцсан — алгасна)"` | F |
| BatchSheetDialog.xaml.cs:180 | `"… (нийт " + count + ")"` | F |
| BatchSheetDialog.xaml.cs:189 / 194 / 199 | «Эхлэх дугаар нь 0 буюу эерэг бүхэл тоо байх ёстой.» / «Тоо ширхэг нь 1–500 хооронд байх ёстой.» / «Урт нь 0–10 хооронд байх ёстой.» (caption `"MGL"`) | F |
| BatchSheetCommand.cs:39 | «Хуудас зөвхөн project документэд үүснэ (family биш).» | J («project», «family») |
| BatchSheetCommand.cs:95 | Transaction name `"MGL — Хуудас үүсгэх"` | F |
| BatchSheetCommand.cs:182-190 | «Хуудас үүсгэлээ.» / «Хуудас үүсгэсэнгүй.»; «Үүсгэсэн: N»; «Алгассан (дугаар давхцсан): N»; «Амжилтгүй: N»; «Дугаар: A … B» | F. «Амжилтгүй» has no reason. |

Ribbon (App.cs:706): «Хуудас\nүүсгэх». ToolTip «Олон хуудсыг нэг дор үүсгэнэ — параметр, эхлэх дугаар, тоо ширхэгээр.»

### 1.4 QtoProgressWindow (+ QtoExportCommand multi-file flow)

| file:line | verbatim string | class / note |
|---|---|---|
| QtoProgressWindow.xaml:4 | `Title="MGL — Тоо хэмжээ илгээж байна"` | A. The title stays «…илгээж байна» after completion. |
| QtoProgressWindow.xaml:22 | «Файлуудыг задалж илгээж байна…» | F |
| QtoProgressWindow.xaml:47 | «Цуцлах» | F |
| QtoProgressWindow.xaml.cs:96 | «Хаах» (button after finish) | F |
| QtoProgressWindow.xaml.cs:99-100 | «Цуцлагдлаа.» / «Дууслаа.» | F |
| QtoProgressWindow.xaml.cs:245 | `finished + " / " + CountRunnable()` | A. Bare "n / m", no unit. |
| QtoProgressWindow.xaml.cs:261, 277 | «Цуцалж байна…» | F |
| QtoProgressWindow.xaml.cs:302 | «Хүлээж байна…» | F |
| QtoProgressWindow.xaml.cs:305 | «Задалж байна… (N элемент)» / «Задалж байна…» | F |
| QtoProgressWindow.xaml.cs:308 | «Илгээж байна…» | F |
| QtoProgressWindow.xaml.cs:311-312 | `"✓ Run #" + runId + " (" + facts + " мөр, ангилаагүй " + unmapped + ")"` | J («Run #», «ангилаагүй»). `unmapped` is `facts.length - mapped` from the server (`backend/src/routes/qto.ts:869`). |
| QtoProgressWindow.xaml.cs:316 | `"✓ Давхардсан (Run #" + runId + ")"` | J |
| QtoProgressWindow.xaml.cs:318 | `"✗ " + reason` with `Shorten(ex.Message)` (:221) | **E**. Raw `ApiException.Message` = `"API 403: {json}"` (ApiClient.cs:19), cut to 80 chars; `FriendlyError` is NOT used here. |
| QtoProgressWindow.xaml.cs:319 | `"Алгассан: " + reason` | F. Reasons are from `LinkEnumerator.DescribeStatus`: «файл олдсонгүй», «ачаалагдаагүй (unload)», «ачаалагдаагүй (локал unload)», «хаалттай workset-д», «ачаалагдаагүй». |
| QtoProgressWindow.xaml.cs:322 | «Цуцлагдсан» / «Цуцлагдсан (токен хүчингүй)» | F. See the string-coupling trap in section 6. |
| QtoProgressWindow.xaml.cs:127, 132, 160, 196-208 | `"токен хүчингүй"`, `"цуцлагдсан"` as `outcome.Error` | **string-coupled control flow** |

QtoExportCommand.cs strings around the window (all F unless noted):
- `22` «MGL — Тоо хэмжээ»
- `72-75` ««file» файлаас тоо хэмжээ гаргах элемент олдсонгүй.\n\nИлгээх зүйл алга — загварт хана, хучилт, багана зэрэг бодит элемент байгаа эсэхээ шалгана уу.»
- `94-114` «Төсөл: …», «  • file  (үндсэн)», «  — алгасна: file (reason)», «Файл бүр ТУСДАА run болж илгээгдэнэ.» (J «run»)
- `116-124` MainInstruction «N файлын тоо хэмжээг илгээх үү?»
- `152-168` «Файл:», «Төсөл:», «Элемент:», «Мөр (бүлэглэсэн):», «Жингүй материал:», «Ангилал (топ):»; MainInstruction «Тоо хэмжээ илгээх үү?»
- `193-195` «Илгээлээ. Run #{0} — {1} мөр (ангилсан {2}, ангилаагүй {3}).»
- `202-222` «Токен хүчингүй хэвээр байна. Тохиргооноос дахин нэвтэрнэ үү.», «Токен хүчингүй боллоо — дахин нэвтэрнэ үү.», «Энэ илгээлт аль хэдийн хүлээн авагдсан байна (Run #N).», «Илгээж чадсангүй.\n\n…»
- `248-256` «Сүлжээнд холбогдож чадсангүй — payload last-run.json-д хадгалагдлаа.» + path + raw `ex.Message`. **E**: «payload», «last-run.json», raw English .NET text.

### 1.5 FamilyHubWindow (XAML, code-behind, Core messages that reach the status line)

**XAML (FamilyHub/Ui/FamilyHubWindow.xaml):**

| line | string | class |
|---|---|---|
| 5 | `Title="Family Hub (POC)"` | E |
| 44 | `Header="  BIMobject  "` | F (brand; padding spaces inside header text) |
| 61 / 62 / 63 / 64 | ToolTips «Буцах» / «Урагш» / «Дахин ачаалах» / «bimobject.com» | F; the last is a domain, not an action («Нүүр» would be). Buttons themselves are glyphs ◀ ▶ ⟳ ⌂. |
| 66 | ToolTip «Enter — тэр хаяг руу очно» | F |
| 78 (= .cs:309) | «BIMobject-ийн сайт жинхэнэ хөтчөөр нээгдэнэ. Өөрийн бүртгэлээр нэвтэрч, бүтээгдэхүүний «Download» товчийг дарахад файл шууд Revit руу орно (шалгалт → давхардал → ачаалах → байрлуулах). Downloads хавтсанд юу ч үлдэхгүй.» | M. «Download» is the site's own button: keep verbatim. |
| 79, 157, 203 | `Content="PLACE"` ×3 | E |
| 88 | «Хөтөч эхэлж байна…» | F |
| 89 | «Дахин оролдох» | F |
| 98 | `Header="  Нийтийн сан  "` | F |
| 115 | `Text="Search families..."` (overlay hint; ASCII three dots) | E |
| 120 | `Content="Хайх"` | F |
| 177 | `Text="Бэлэн."` | F |
| 180 | `Content="Цуцлах"` | F, but inconsistent with «Cancel» at :191 |
| 187 | `Text="SAME NAME — DIFFERENT FAMILY"` | E |
| 190 / 191 | `Content="Use existing"` / `Content="Cancel"` | E |
| 199 | `Text="Family loaded"` (no period) | E |
| 200 | `Text="Available Types:"` | E |
| 204 | «Revit-ийн энгийн байрлуулалт эхэлнэ; Esc-ээр дуусгана.» | F |

**Code-behind (FamilyHubWindow.xaml.cs):**

| line | string | class |
|---|---|---|
| 39 | `" · Revit: " + RevitCompatibilityCheck.Label(...)` giving COMPATIBLE / LIKELY_COMPATIBLE / INCOMPATIBLE / UNKNOWN (FamilyPackageInspector.cs:311-320) | E. Every GitHub row reads «Revit: UNKNOWN» before download because the provider supplies no versions. |
| 40, 41 | `" (файл: N)"`, `" KB"` | F |
| 55 | `"✓ IN PROJECT"` | E |
| 64 / 65 / 66 | «ADD TO REVIT» / «AUTH REQUIRED» / «METADATA ONLY» | E |
| 113 | «Бүх нээлттэй эх» | F |
| 139 | «Хөтөч эхэлж байна…» | F |
| 169-170 | «WebView2 эхлүүлж чадсангүй: » + ex.Message + «\n\nMicrosoft Edge WebView2 Runtime суусан эсэхийг шалгана уу (Windows 11-д өгөгдмөл суусан байдаг).» | M. Raw `ex.Message`. |
| 187 | «Хаяг буруу: » + ex.Message | M |
| 212 | «Өмнөх үйлдэл дуусаагүй — NAME татахыг цуцлав» | F |
| 218 | «Зөвхөн HTTPS татна: URL» | F |
| 224 | ««NAME» — Family Hub зөвхөн .rfa / .zip (доторх .rfa) авна. Энэ форматыг Revit-д ачаалахгүй.» | F |
| 230 | ««NAME» хэт том (X MB > Y MB)» | F |
| 241, 251 | `"Downloading… "` + name; + `"  N KB / M KB"` | E |
| 265 | «Татах тасарлаа: » + `op.InterruptReason` (English enum name) + « (NAME)» | M |
| 293, 467 | `"Family loaded: " + primary.FamilyName` | E |
| 298, 339, 472, 518 | `"✓ IN PROJECT: " + name` | E |
| 323 | «✓ IN PROJECT: «NAME» энэ бүтээгдэхүүнээс аль хэдийн ачаалагдсан — дахин татах шаардлагагүй.» | M |
| 328 | «Бүтээгдэхүүн: BRAND / SLUG — «Download» дарж Revit форматыг сонгоход шууд ачаалагдана.» | M |
| 370, 398, 402 | «Хайж байна…», `N + " үр дүн."`, «Хайлт амжилтгүй: » + ex.Message | F/M |
| 385 | `notices.Add(p.DisplayName + ": " + ex.Message)` | M, raw English |
| 430 | «Эхэлж байна…» | F |
| 496-498 | `" (N family)"`, `" · N өөр хувилбарын хуулбарыг алгасав"`, `" ⚠️ түр файл цэвэрлэгдээгүй"` | M |
| 533 | «READY TO PLACE ✓ — Revit дээр байрлуулна уу (Esc = дуусгах)…» | E/M |
| 538, 542 | `o.Message + " [" + SymbolName + "]"`; «Байрлуулалт: » + ex.Message | F/M |
| 562-564 | Conflict body: ««NAME» нэртэй family төсөлд аль хэдийн бий (CATEGORY, N төрөл), гэвч файл нь ӨӨР (SHA-256 таарахгүй, нийлүүлэгчийн бүртгэлд байхгүй).\nАвтоматаар нэр өөрчлөхгүй, дарж бичихгүй.  Одоо байгааг ашиглах уу?» | F |
| 595-600 | status prefixes `"Checking duplicates… "` (Checking and Deduplicating), `"Downloading… "`, `"Validating… "`, `"Loading… "` | E |

**Core messages that surface in StatusText via `Summarize`/`Report`:**

| file:line | string | class |
|---|---|---|
| FamilyHubPipeline.cs:192 | «INCOMPATIBLE — нийлүүлэгчийн мэдээлсэн хувилбар … > Revit N» | M |
| FamilyHubPipeline.cs:200, 223 | «AUTH_REQUIRED — …» | E (asserted by tests) |
| FamilyHubPipeline.cs:225 | `down.Status + ": " + down.Reason` giving e.g. «HostNotAllowed: Хост цагаан жагсаалтад байхгүй: …» | E (enum name leaks) |
| FamilyHubPipeline.cs:237, 281 | `ex.GetType().Name + ": " + ex.Message` | E |
| FamilyHubPipeline.cs:301 | «Нээлттэй төслийн файл алга (эсвэл Family засварлаж байна)» | F |
| FamilyHubPipeline.cs:326 | «✓ IN PROJECT — дахин татсангүй» | M |
| FamilyHubPipeline.cs:365 | «Өөр хувилбарын хуулбар (Revit N) — алгасав» | F |
| FamilyHubPipeline.cs:375 | «INCOMPATIBLE — файл Revit X-д хадгалагдсан, энэ нь Revit Y» | M |
| FamilyHubPipeline.cs:391 | «Ижил файл (SHA-256) аль хэдийн төсөлд бий — бичлэгийг түүн рүү холбов» | M |
| FamilyHubPipeline.cs:410, 420 | «ИЖИЛ НЭР — ӨӨР FAMILY: одоо байгааг ашиглав» / «…: цуцлав» | F |
| FamilyHubPipeline.cs:438 | «Ачаалж чадсангүй: » + ex.Message | M |
| FamilyHubPipeline.cs:444 | «Family loaded» | E (outcome message) |
| FamilyHubPipeline.cs:464 | «READY TO PLACE ✓» | E |
| RevitGateway.cs:109 | «Revit family-г ачаалж чадсангүй (LoadFamily=false — ижил нэртэй family байна уу, эсвэл файл эвдэрхий)» | J |
| RevitGateway.cs:125, 130, 146, 150, 154 | «Family төсөлд олдсонгүй (устгагдсан?)», «Family-д төрөл (type) алга», «Байрлуулалт дууссан», «Байрлуулалтыг хэрэглэгч дуусгав (Esc)», «Байрлуулалт эхлүүлж чадсангүй: » | F |
| SafeDownloader.cs:141-147, 164-218 | «Хэрэглэгч цуцалсан», «Хугацаа дууссан (N с)», «Сүлжээний алдаа: », «Зөвхөн HTTPS зөвшөөрнө: », «Хост цагаан жагсаалтад байхгүй: », «Нэвтрэх хуудас руу redirect: », «HTTP 401/403 — нэвтрэлт шаардлагатай», «HTML нэвтрэх хуудас буцаав (файлын оронд)», «Content-Type зөвшөөрөгдөөгүй: » | M |
| FamilyPackageInspector.cs:82-185 | «Файлын магик байт нь RFA (OLE) ч биш, ZIP ч биш», «ZIP traversal: », «ZIP дотор гүйцэтгэгдэх/скрипт файл: », «ZIP дотор .rfa файл алга» etc. | M/J |
| GitHubPublicRfaProvider.cs:63, 141 | Always-on notice: «StudioLE/RevitFamilies@main: Repo-д LICENSE файл алга — POC-ийн туршилтын файл болгон л ашиглана, тараахгүй.» | E/M. Shows the repo key and «POC» to end users on every search. |
| GitHubPublicRfaProvider.cs:74, 209 | DisplayName «GitHub (нийтийн .rfa)»; «GitHub API rate limit / 403 — дараа дахин оролдоно уу» | M |
| BimObjectProvider.cs:51-53 | `AnonymousNotice` «BIMobject: хөтөчийн бус хүсэлт бүр Cloudflare challenge-ээр хаагддаг (403)… AUTH_REQUIRED…» | Not visible today: BIMobject has `SupportsAnonymousSearch = false`, so it is excluded from `ProviderBox` (.cs:115) and `SelectedProviders` (.cs:357-365). |
| App.cs:799-806 | Ribbon «Family\nHub», ToolTip «Family хайж, шууд төсөлд ачаална (POC).», LongDescription contains «✓ IN PROJECT» and «AUTH REQUIRED» | E |

---

## 2. Binding semantics (code path, not labels)

### 2.1 What «Бүгдийг батлах» actually saves
Path: `BindingDialog.SaveBtn_Click` (.cs:210-273) → `RevitApi.SaveBindingsAsync` (RevitApi.cs:370-381) → `PUT /api/revit/bindings`.

Payload: `{ revit_document_id, items:[{sheet_uid, drawing_id|null, task_id|null, status}], seed_checklist }`.
- **`status:"confirmed"`**: rows with `IsChecked && SelectedTask != null` (.cs:223-232).
- **`status:"ignored"`**: EVERY other row, i.e. all unticked rows (.cs:236-248). The currently selected drawing and task ids ride along, so an «ignored» row keeps its suggestion. The code comment explains why: the server writes `drawing_id=?, task_id=?` unconditionally.
- `seed_checklist` = «Хуудас бүрийг ажлын дэд жагсаалтад автоматаар нэмэх» (read on the UI thread, .cs:221).
- Enabled only when `ready > 0 && checkedNoTask == 0` (.cs:188). Zero ticked rows disables the button, so «ignore everything» cannot be persisted from this dialog.
- Initial ticks: `!ignored && (Status == "confirmed" || (Confidence >= 0.8 && TaskId.HasValue))` (.cs:169-171). Previously ignored rows are NOT auto-ticked and are drawn grey (`#9CA3AF`, xaml:45-53).

Backend, `backend/src/routes/revit.ts:673-806`:
- `UPDATE revit_sheet_bindings SET drawing_id, task_id, status, match_source='manual', confidence=1.0, bound_by, bound_at … WHERE revit_document_id=? AND sheet_uid=? AND user_id IS NULL`. This applies to confirmed AND ignored rows (:725-729).
- The per-user checklist is seeded only from `confirmed` items: `task_checklist_items(task_id, user_id=user.sub, text="<number> — <name>")` with dedupe by text and `MAX_CHECKLIST_ITEMS=50` (:748-803). Response: `{saved, ignored, checklist_seeded}`; the DTO `BindingSaveResult` reads only `Saved` and `Ignored` (RevitApi.cs:232-236).
- After success `BindingCommand` runs `RevitTools.Run(..., "capture_baseline", "{}")` (BindingCommand.cs:104-116), so the change baseline starts at the bind moment.

### 2.2 What «Цэвэрлэх» does
`ClearBtn_Click` (.cs:204-208) sets `IsChecked=false` on all rows and recounts. It deletes nothing and clears no combo. Because `Save` then disables, the user must re-tick. Whatever stays unticked is saved as `ignored`, not «unconfirmed». No control says so except the intro paragraph.

### 2.3 What «Итгэл» means
It is the server heuristic `suggestBinding` (`backend/src/lib/revitMatch.ts:104-176`), not a probability:
- 0.95: letter-prefix of the sheet number matches a drawing AND task-name overlap ≥ 0.8
- 0.85: prefix matches exactly one drawing
- 0.80: prefix matches several drawings
- 0.60: no prefix, name overlap ≥ 0.5
- 0.50: drawing found, no task
- 0: nothing

The header comment of that file still lists 0.60 for the multi-drawing prefix case. The code returns 0.80 (`:158-167`), which meets the client auto-tick threshold `AutoTickConfidence = 0.8` (`BindingDialog.xaml.cs:125`, twin of `AUTO_TICK_CONFIDENCE` at `revitMatch.ts:42`). After ANY save the server stores `confidence = 1.0` and `match_source='manual'`, including for rows saved as `ignored`, so the dialog shows «1.00» for rows a human skipped. Nothing in the UI explains the number (no tooltip).

### 2.4 Search, filter, counts
- Search: none. Filter: none. No sort control; DataGrid defaults are not overridden (header sorting of the three text columns is the framework default, not verified).
- Counts: only `CountText` («{ready} / {total} холбогдохоор бэлэн») and the «{n} мөрөнд ажил сонгоогүй байна» warning. There is no count of ignored, unmatched or low-confidence rows, and none of «will be saved as ignored».

### 2.5 Backend contract the redesign must not silently change
1. **Handshake** `POST /api/revit/handshake` (revit.ts:303-533):
   - body `{project_id, doc_uid, uid_source:"project_info", file_name, revit_version, is_link, sheets:[{uid, number, name, placed_view_count}]}`
   - `sheets.length ≤ MAX_SHEETS = 500` (413 otherwise)
   - response `{document{id,…}, bindings[{id, sheet_uid, sheet_number, sheet_name, drawing_id, task_id, drawing_name, task_name, status, match_source, confidence, placed_view_count}], candidates{drawings[{id,name,block_name,block_id}], tasks[{id,name,drawing_id}]}, same_uid_elsewhere}`
   - `bindings` are the shared rows (`user_id IS NULL`), ordered by `sheet_number`.
   - `candidates.tasks` is ALL project tasks, not filtered by assignee.
2. **Save** `PUT /api/revit/bindings`:
   - **`items.length ≤ MAX_BINDING_ITEMS = 200`** → 413 (revit.ts:687). The dialog sends every row (confirmed + ignored), so any file with 201–500 sheets cannot be saved, although the handshake accepts 500. `FriendlyError(413)` then says «Илгээх өгөгдөл хэтэрхий их байна — багасгаад дахин оролдоно уу.», which the user cannot act on.
   - `status`: anything other than `'ignored'` is coerced to `'confirmed'` (revit.ts:719); the DB CHECK allows only `suggested | confirmed | ignored`. A redesign cannot add a third saved state. «Leave undecided» can only mean OMITTING the row from `items` (the row stays `suggested` and is re-suggested next handshake).
   - Non-manager roles: every confirmed `task_id` must pass `isAssigned` (assigned_to or a `task_assignees` row), else the WHOLE request fails 403 `TAKE_REQUIRED` with the message «Энэ таск дээр эхлээд цагаа эхлүүлнэ үү («Миний ажлууд» эсвэл төслийн хуудсанд ▶ дарна) — таскийг авч ажиллаагүй бол хувь оруулах боломжгүй.» (`backend/src/lib/taskTake.ts:101-102`). The body carries `task_id`, but the dialog shows neither the row nor the task, and the text talks about reporting progress, not binding.
   - Upsert key `(revit_document_id, sheet_uid, IFNULL(user_id,0))`; `sheet_uid` = `ViewSheet.UniqueId`.
3. Handshake re-run keeps `drawing_id/task_id/match_source/confidence` for non-`suggested` rows (revit.ts:456-463).

---

## 3. BatchSheet

### 3.1 «Урт (0 = нөхөхгүй)» semantics and padding code
`BatchSheetCommand.cs:199-203`:
```
internal static string PadNumber(int num, int pad)
{ string s = num.ToString(CultureInfo.InvariantCulture);
  return pad > 0 && s.Length < pad ? s.PadLeft(pad, '0') : s; }
```
- It pads ONLY the counter portion to a minimum digit width. It never truncates and it never pads the composed sheet number.
- Range: 0–10 (BatchSheetDialog.xaml.cs:197-201).
- The padded counter is also what `<n>` in the name template becomes (`ResolveName`, BatchSheetCommand.cs:215-220; regex replace, case-insensitive).
- Composition `ComposeNumber` (:206-212): `string.Join(sep, includedValues) + sep + padded`, or just `padded` when no parameter is included. Included values are rows with `IncludeInNumber && !IsNullOrWhiteSpace(Value)`, in list order. List order = `KnownRank` (names containing classification / subdiscipline / typedesignator first), then alphabetical (:296-302). `DefaultIncludeInNumber = KnownRank(name) < 3` (:314).
- **Persistence bug**: the saved `pad_width` is read back as `prefs.PadWidth > 0 ? prefs.PadWidth : 3` (BatchSheetDialog.xaml.cs:103). A saved «0 = нөхөхгүй» therefore always reloads as 3.
- Saved settings keys (`QtoDtos.cs:461-483`, `settings.json`): `separator`, `pad_width`, `title_block_name`, `name_template`, `values`, `include_in_number`.

### 3.2 Preview and validation that exist today
- Preview (BatchSheetDialog.xaml.cs:141-183): first `min(count, 8)` lines of `composed   name`, a «(давхцсан — алгасна)» marker only for those lines, and `… (нийт N)`. There is no duplicate total, and no check against other rows beyond the first 8.
- Invalid numbers silently fall back to 0 in the preview (`ParseInt`, :217-220); the error appears only on «Үүсгэх» via three MessageBoxes: start ≥ 0, count 1–500, pad 0–10 (:187-201).
- Title-block restore: when a saved `title_block_name` no longer exists, selection stays at index 0 = «(гарчгийн хүснэгтгүй)» (:114-130). The «first real title block» default only applies when no name was saved. Sheets would then be created without a title block.

### 3.3 Duplicate detection capability
There is no separate planner class. The helpers `PadNumber`, `ComposeNumber` and `ResolveName` are `internal static` in the command and have zero tests (no test references them).
- Existing set: `HashSet<string>(StringComparer.OrdinalIgnoreCase)` built from all `ViewSheet.SheetNumber` (BatchSheetCommand.cs:47-53).
- Skip and count: `if (existing.Contains(composed)) { skipped++; continue; }` (:116-120).
- Revit setter failure: delete the just-created sheet and `skipped++` (:133-143).
- Intra-run guard: `existing.Add(composed)` (:163).
- Preview flag: BatchSheetDialog.xaml.cs:175-176.
- Not detected: duplicate sheet NAMES (allowed), illegal characters in the composed number, unwritable or non-String parameters (silently skipped, :151-156).

### 3.4 Generation rules a redesign must not rewrite
1. One `Transaction` «MGL — Хуудас үүсгэх» (Manual), committed even when 0 sheets were created (:95-174).
2. Activate the title-block `FamilySymbol` and `doc.Regenerate()` first (:100-108).
3. Per sheet: `ViewSheet.Create(doc, titleBlockId)` (failure → `failed++`); set `SheetNumber`; set `Name` from the template when the template is non-blank; for every row with a non-blank value (included in the number or not) set the parameter only when `LookupParameter` finds it writable and `StorageType.String`.
4. Existing numbers are skipped (case-insensitive) and reported as «Алгассан (дугаар давхцсан)».
5. After commit make the FIRST created sheet the active view (:176-179).
6. Settings are saved BEFORE generation, whether or not generation succeeds (:62-77).
7. Dialog bounds: count 1–500, pad 0–10, start ≥ 0.
8. Result TaskDialog lines (§1.3).

---

## 4. FamilyHub

### 4.1 Provider and supplier strings that must stay verbatim
- «BIMobject», «bimobject.com», «Download» (the site's own button), «Downloads» (Windows folder).
- `GitHub` and `StudioLE/RevitFamilies@main` repo key.
- Family names (`FamilyProduct.Name`, from the file name), manufacturer (Subtitle), category (repo directory), type/symbol names (`TypesList`), `.rfa`, `.zip`, `SHA-256`, `WebView2`, `Microsoft Edge WebView2 Runtime`, `Revit`, `Esc`, `KB/MB`.
- Provider ids `bimobject` / `github`, the `owner/repo@ref` spec format and the env var `FAMILYHUB_GITHUB_SOURCES`.
- The `ExtensibleStorage` schema GUID `b3f1e6c2-4a7d-4f0e-9c1b-7d2a8e5f6a01`, schema name `MglFamilyHubRegistry`, DataStorage name `MGL.FamilyHub.Registry` (RevitGateway.cs:218-223). Changing any of these hides existing registries.
- Registered providers (FamilyHubCommand.cs:68-70): GitHub first (anonymous search), then BIMobject (`SupportsAnonymousSearch=false`, `AllowedDownloadHosts` empty, `ResolveDownloadAsync` always `AuthRequired`).

### 4.2 Conflict flow («SAME NAME — DIFFERENT FAMILY»)
- Trigger: `ProcessPackageAsync` step C (FamilyHubPipeline.cs:400-424), reached only after the SHA-256 lookup (B) misses and a Revit family with the same name exists.
- UI: `ResolveNameConflictAsync` (FamilyHubWindow.xaml.cs:554-568) makes `ConflictPanel` visible and returns a `TaskCompletionSource`. There is no focus move and no announcement.
- Decisions: only `ConflictDecision.UseExisting | Cancel` (FamilyHubPipeline.cs:49). **There is no replace and no rename path**, by design («Автоматаар нэр өөрчлөхгүй, дарж бичихгүй»). `NoOverwriteLoadOptions` also refuses overwrite at the Revit level (RevitGateway.cs:195-209).
- UseExisting writes a registry entry with `MappedByHash = true` and outcome `UsedExisting`. Cancel gives `NameConflictCancelled`.
- The status-bar «Цуцлах» (`CancelBtn`) also resolves a pending conflict as Cancel (.cs:548-552), and the pipeline token does too (.cs:557).

### 4.3 States
- **Idle** «Бэлэн.»
- **Loading/busy**: `SetBusy(true, …)` shows the indeterminate `Progress`, disables `SearchBtn`, and `_busy` blocks new searches, adds and downloads.
- **Per row**: not in project (button «ADD TO REVIT» enabled only for `AnonymousDirect` and not `Incompatible`; «AUTH REQUIRED» / «METADATA ONLY» disabled) → in project («✓ IN PROJECT» + «PLACE»).
- **Loaded**: `TypesPanel` («Family loaded: NAME», type list, «PLACE»).
- **Placing**: after a successful load, `PlaceAsync` runs immediately (.cs:294, 468) with «READY TO PLACE ✓ — Revit дээр байрлуулна уу (Esc = дуусгах)…». This is automatic.
- **Placed / ended**: outcome `Message + [symbol]`.
- **Web banner** has three states: default, product page detected, in-project with PLACE (.cs:303-334).

### 4.4 WebView2 fallback
- Init (.cs:133-173): profile dir `%LOCALAPPDATA%\MGL\RevitMcpAddin\WebView2Profile`; `AreDevToolsEnabled=false`, `IsStatusBarEnabled=false`, `NewWindowRequested` handled in the same tab; `Navigate(BimObjectProvider.BrowserHomeUrl)`.
- On exception: `_webInitStarted=false`, overlay text «WebView2 эхлүүлж чадсангүй: …» + Runtime hint, «Дахин оролдох» button (`WebRetryBtn`).
- Tab switch back to index 0 re-inits if never started (.cs:190-194). The «Нийтийн сан» tab works independently.
- Build: WebView2 package `1.0.2478.35` and the whole `FamilyHub/**` exist only for R25–R27 (`RevitMcpAddin.csproj:186-201`); R24 has `<Compile Remove="FamilyHub/**" />`.

### 4.5 Auth and download safety checks to preserve

**Browser (WebView2) path, FamilyHubWindow.xaml.cs:201-268**
1. `e.Handled = true` (no default download UI).
2. Cancel if `_busy` (:209-214).
3. HTTPS only (:215-220).
4. Extension allowlist `.rfa` / `.zip` (:221-226).
5. `TotalBytesToReceive > MaxBytes` (50 MB) cancels (:227-232), plus a live byte cap (:249).
6. Destination is a fresh temp session dir with `TempFiles.SafeFileName` (:205, 234-236).
7. Cancel token wired to `op.Cancel()` (:244).
8. Non-completed state deletes the temp dir (:262-265).
9. Completed → `AddDownloadedAsync` → cleanup in `finally`.
10. The add-in never handles credentials: the user logs in inside WebView2 with their own account.

**Anonymous provider path, SafeDownloader.cs**
1. HTTPS only; host allowlist (exact or `*.` wildcard) re-checked on EVERY redirect hop.
2. `AllowAutoRedirect=false`, `UseCookies=false`, `AutomaticDecompression=None`, max 5 redirects.
3. Login-redirect heuristic → `AuthRequired`, not followed (`LoginPathHints`, `returnurl=` etc.).
4. 401/403 → `AuthRequired`; 404/410 → `NotFound`; HTML 200 → `AuthRequired` if it contains login/sign in/password, else `BadContentType`.
5. Content-Type allowlist (octet-stream, zip variants, vnd.autodesk.revit).
6. Size cap on header and stream; streaming SHA-256; 120 s timeout; partial file deleted.

**Package, FamilyPackageInspector.cs**
- Magic bytes must agree with the extension (OLE `D0CF11E0A1B11AE1` / ZIP `PK\x03\x04`).
- ZIP: traversal detector (absolute, drive letter, `..`, control chars); `ForbiddenExtensions` (including `.rvt`, `.dyn`, `.dyf`) reject the WHOLE archive; declared-total cap; duplicate `.rfa` names rejected; only `.rfa` extracted; per-entry actual ≤ declared size; each extracted `.rfa` must be OLE.
- Saved Revit version read from `BasicFileInfo` («Revit Build:» / «Format: 20xx»); unknown stays `UNKNOWN`, never guessed; a newer file than running Revit → `Incompatible`.

**Dedupe and Revit side**
- Dedupe order: A provider identity, B SHA-256 (`MappedByHash`), C name conflict. A stale registry entry (family deleted) is dropped and reload is allowed (FamilyHubPipeline.cs:309-322).
- `SelectVersionVariants` keeps only the best version variant of a family.
- `FamilyHubExternalEvent` is separate from `RevitToolBus`, so it does not hold the global gate.
- Transactions are short and named: «Family Hub: family ачаалах», «Family Hub: бүртгэл», «Family Hub: төрөл идэвхжүүлэх».
- Placement uses `PromptForFamilyInstancePlacement` (coordinates never guessed).
- Temp: `TempFiles.SweepStale(6 h)` at session create; per-operation cleanup in `finally`; `TempCleaned=false` surfaces as «⚠️ түр файл цэвэрлэгдээгүй».
- No anti-bot bypass (README, `BimObjectProvider` class doc).

**Guarded by tests (Core only, `tests/FamilyHub.Tests`, no UI):** T01–T21 and unit tests cover redirects, login, size, ZIP and registry. Two tests assert the English token inside user-visible messages: `tests/FamilyHub.Tests/UnitTests.cs:127` (`Assert.Contains(s.Notice, "AUTH_REQUIRED")`) and `PipelineTests.cs:254` (`Assert.Contains(res.Message, "AUTH_REQUIRED")`). Localizing those messages needs a machine code separated from the display text.

---

## 5. Accessibility audit (all XAML and code-built UI)

### 5.1 Good patterns to extend (verified)
| pattern | evidence |
|---|---|
| SheetNumerator: 41 `AutomationProperties.AutomationId` values (window, banner, mode radios, toolbar, every tab field, status line) | `SheetNumeratorWindow.xaml:14,279,300,308…695` |
| SheetNumerator: keyboard parity for drag reorder and apply | `:260-267` KeyBindings F5, Ctrl+Enter, Alt+↑/↓/Home/End; tooltips show the chords (`:312-315`) |
| SheetNumerator: disabled-state explanation in text | `ViewModel.cs:714` «Хэрэгжүүлэх боломжгүй: …»; `:671-678` `SettingsErrors` list mirrors the red-border tooltips |
| SheetNumerator: status not colour-only | state glyph ●/⚠/✖ (`:96-108`) PLUS the «Төлөв» text column (`:435-441`) |
| Assistant: rows are real Buttons so Tab, Enter and Space work | `AssistantPane.xaml:181-215` (comment «Border + MouseDown хийвэл Tab-аар явж болохгүй болно»), `:295,339` |
| Assistant: nested-button bubbling handled | `:288-292` comment; `AssistantPane.xaml.cs:3367-3373` and `:3396` `e.Handled = true` |
| Assistant: expander header is a ToggleButton | `AssistantPane.xaml:226-228,236` |
| Assistant: reason text for disabled Apply | `AssistantPane.xaml.cs:3420-3430` `UpdateOverrideApplyState` |
| Assistant: Enter sends, Shift+Enter newline | `AssistantPane.xaml.cs:1827-1833` |
| Esc/Enter defaults on most dialogs | `IsDefault`/`IsCancel` on Binding, Schedule, BatchSheet, Settings, TextPrompt, CloneDrawings, AutoAnnotate, ClashRule, ProfileEditor, License, RfUi.MakeButton |
| Initial focus managed | `LicenseDialog.cs:136-139`, `TextPromptDialog.cs:45-48` |
| Search with hint and «hidden by search» status | `Reinforcement/Ui/RfSearchBox.cs:36-60` |
| Selectable read-only text for copy | `WorkPaneView.xaml.cs:958-969` |
| Disabled-with-tooltip reasons | `IntelligencePanel.xaml:118,257` (but see ShowOnDisabled below) |

### 5.2 Real gaps
**A. Icon/glyph-only controls without `AutomationProperties.Name`** (`AutomationProperties` appears only in `SheetNumeratorWindow.xaml`; the glyph itself is the only candidate name):

| control | evidence |
|---|---|
| ⟳ refresh | `AssistantPane.xaml:416`; `FamilyHubWindow.xaml:63`; ↻ `IntelligencePanel.xaml:144` |
| ▾ checklist toggle | `AssistantPane.xaml:441` |
| Δ changes toggle | `AssistantPane.xaml:449` |
| AI toggle | `AssistantPane.xaml:464` |
| … team fix | `AssistantPane.xaml:501` |
| ✕ close | `AssistantPane.xaml:544` |
| 👍 / 👎 (NO tooltip either) | `AssistantPane.xaml:820,822` |
| 🎤 (tooltip only) | `AssistantPane.xaml:883` |
| ➤ send (no tooltip) | `AssistantPane.xaml:890` |
| ◀ ▶ ⌂ | `FamilyHubWindow.xaml:61,62,64` |
| ▲ ▼ ⤒ ⤓ (AutomationId present, Name absent) | `SheetNumeratorWindow.xaml:312-315` |
| × clear search | `CloneDrawings/CloneDrawingsDialog.cs:372` |
| Column header «✓» and the cell CheckBox without label | `BindingDialog.xaml:60,63` |
| Per-row «Дугаарт» CheckBox without Content | `BatchSheetDialog.xaml:51-53` |
| Schedule picker row CheckBox | named by its text content (OK) |

**B. Labels not associated with inputs.** Repo-wide: `LabeledBy` / `<Label` / `new Label` / `AccessText` / mnemonic = 0 matches. Examples:
- `SettingsDialog.xaml:26-33` («API хост:», «Нэвтрэх нэр:», «Нууц үг:» are bare TextBlocks)
- `WorkPaneView.xaml:232-235`
- `Licensing/LicenseDialog.cs:101-104`
- `SheetNumerator/Ui/TextPromptDialog.cs:28-31`
- `Smart/Ui/SmartUi.cs:113-120` (`UiKit.Form` builds TextBlock + control with no association; feeds ClashRuleDialog and ProfileEditorDialog)
- `Reinforcement/Ui/EndSymbolDialog.cs:69-74,103-104,118,126`
- `AutoAnnotate/AutoAnnotateDialog.cs:24-26,158-164`
- `CloneDrawings/CloneDrawingsDialog.cs:370-372`
- `BatchSheetDialog.xaml:87-99` (four fields)
- `SheetNumeratorWindow.xaml:473-505` (`FieldLabel` style TextBlocks; seven ComboBoxes carry no AutomationId or Name: `:572,576,592,595,602,625,657`)
- `AssistantPane.xaml:741-743,753,844` (PercentBox, NoteBox, FeedbackNoteBox, InputBox; no label or hint)
- `FamilyHubWindow.xaml:113-116` (overlay hint TextBlock only; `WebUrl` and `ProviderBox` have none)
- `SchedulePickerDialog.xaml:17` (no label, no hint)
- `WorkPaneView.xaml.cs:746-761` (completion-question TextBlock + TextBox pairs, which gate a 100% close)

**C. Focus visuals.** `FocusVisualStyle` = 0 matches; `IsKeyboardFocused` / `IsFocused` triggers = 0. Custom templates that define only hover, pressed, selected or disabled triggers (the framework's default focus adorner is not overridden, but its default stroke is a thin dotted rectangle in the system ControlText colour; if black, ≈1.5:1 against `#FF2B2B2B` and ≈1.7:1 against `#FF333337`, computed):
- `AssistantPane.xaml:36-57` (FlatButton), `:118-136` (ComboRow), `:197-212` (ChangeRowButton), `:234-275` (DarkExpander)
- `WorkPaneView.xaml:47-68`, `:145-157`, `:176-188`
- `IntelligencePanel.xaml:61-73` (tab: only `IsSelected`)
- code-built: `CloneDrawings/CdJobPaneView.cs:378-401` (hover, disabled only)

Setter-only styles keep the default template: `FamilyHubWindow.xaml:9-31`, `IntelligencePanel.xaml:38-46`.

**D. DataGrid, ListView and TreeView keyboard behaviour (not verified live).**
- `BindingDialog.xaml:36-92`: ✓/Зураг/Ажил live inside `DataGridTemplateColumn.CellTemplate` (always-live controls); no `KeyboardNavigation.*`, no `IsTabStop`, no row-level key handler (`BindingDialog.xaml.cs` has no `KeyDown`). Whether Space toggles a row's CheckBox from a grid cell, and how Tab traverses template cells, needs a live check. ComboBoxes are `BorderThickness="0" Background="Transparent"`.
- `SmartPublish/Ui/PublishDialog.cs:329` uses `DataGridCheckBoxColumn`, the exact pattern whose two-click problem BindingDialog's comment (xaml:55-59) rejects.
- `Reinforcement/Ui/ScheduleSyncDialog.cs:128-134` and `ScheduleCloneDialog.cs:163-167` use FrameworkElementFactory CheckBoxes in template columns with no `AutomationProperties.Name`.
- SheetNumerator `SheetList` ListView: selection and Alt+arrows via KeyBindings (good), mouse-only drag is the only drag path but there is a keyboard equivalent.

**E. Disabled buttons with no (or hidden) explanation.**
- `BindingDialog.xaml.cs:188` Save disabled at 0 ready: only the implicit count explains it.
- `AssistantPane.xaml:774` / `.cs:537,1738` SubmitBtn disabled until ConfirmBox ticked: no text.
- `AssistantPane.xaml:541` TeamPickApply; `SettingsDialog.xaml:50` SaveBtn: explained only via status line.
- `FamilyHubWindow.xaml.cs:70` «ADD TO REVIT» disabled for `Incompatible`: no reason on the button; only «Revit: INCOMPATIBLE» in Meta.
- Tooltip-carried reasons on disabled controls (`IntelligencePanel.xaml:118,257`) do not show in WPF unless `ToolTipService.ShowOnDisabled` is set; it is set nowhere (0 matches).

**F. No live regions.** `AutomationProperties.LiveSetting` / `RaiseAutomationEvent` = 0 matches. Status text, busy text, chat list, conflict panel, progress counts all change without announcement. The FamilyHub conflict panel and `AssistantPane` override panel appear without moving focus. `QtoProgressWindow` and FamilyHub `ProgressBar`s have no value text or name.

**G. Colour and contrast** (computed from literals; verify visually):
- `BindingDialog.xaml:48-50` ignored rows differ ONLY by foreground `#9CA3AF`: 2.54:1 on white; no glyph or text cue.
- `Foreground="Gray"` (`#808080`) on white is 3.95:1 (BindingDialog.xaml:33,97; BatchSheetDialog.xaml:23,33-35,87-90,104,116; SchedulePickerDialog.xaml:23; QtoProgressWindow.xaml:46).
- FamilyHub: `#8B94A0` Meta/hint on white 3.07:1 (xaml:115,149); StateText `#2E9E6B` on white 3.38:1 (:150); white-on-`#4A7FA5` primary button 4.31:1 (:12-13); disabled `#5B6470` on `#C9CED6` 3.79:1 (:19-20).
- SheetNumerator warn `#E65100` on `#FFF4E5` 3.49:1 (xaml:27,34); muted `#6B7280` on `#F7F8FA` 4.55:1.
- Assistant: error bubbles are distinguished from system/bot messages by colour only: 26 `Say(ChatKind.Error` calls with a null header (`AssistantPane.xaml.cs:498-506`); error header `#E05C5C` on `#43272A` is 3.75:1 (`:215-217,257`); muted header on user bubble is 2.13:1; `Danger #E05C5C` on `#2B2B2B` 3.95:1.
- No high-contrast support: `SystemColors`, `HighContrast`, `DynamicResource` = 0 matches. Five independent hard-coded palettes (Assistant, WorkPane, Intelligence dark; FamilyHub light; default/system elsewhere).

**H. Keyboard and Esc consistency.**
- Mouse-only: `MicBtn` handles only `PreviewMouseLeftButtonDown/Up` (`AssistantPane.xaml:885-886`) and the handler is a stub that says voice input is being prepared (`.cs:3531-3538`); keyboard activation does nothing.
- `SheetNumeratorWindow.xaml:689` sets `IsCancel="False"` explicitly, so Esc does nothing.
- Modeless FamilyHub, Clash, ChangeImpact, SmartCount and QtoProgress have no Esc path (QtoProgress deliberately blocks close while running).
- `UiKit.Btn` (`Smart/Ui/SmartUi.cs:39-45`) and `RfUi.MakeButton` never set a name or tooltip.
- Nested interactive content: `FindingRowTemplate` puts two Buttons inside a Button (`AssistantPane.xaml:295-335`); WPF permits it and the bubbling is handled, but screen-reader behaviour is unverified.
- No explicit `TabIndex` anywhere; order is visual-tree order.

### 5.3 Test coverage relevant to redesign
- No test references `BindingDialog`, `BatchSheetDialog`, `SchedulePickerDialog`, `QtoProgressWindow`, `FamilyHubWindow`, `AssistantPane`, `BatchSheetCommand`, `PadNumber` or `ComposeNumber`.
- UiSmoke projects exist only for SheetNumerator, Smart, CloneDrawings and Reinforcement. They locate controls with `FrameworkElement.FindName` (x:Name), not AutomationId; a repo-wide grep for `AutomationId` in `revit-mcp/tests` returns 0, so the 41 SheetNumerator ids are currently unconsumed in-repo.

---

## 6. Traps found while reading

- **String-coupled control flow.** `QtoExportCommand.cs:137` decides «cancelled» by `outcome.Error == "цуцлагдсан"`; `QtoProgressWindow.xaml.cs:132,160` set that literal. Renaming or localizing the string silently changes the exit code.
- **Localization infrastructure.** `Lang.T(mn, en)` is the assistant-reply-language switch (`Lang.cs:110-113`, default Mn), and the five audited surfaces use it zero times. The repo's single-table precedent is `Reinforcement/RfText.cs`. XAML literals cannot go through `Lang.T`.
- **English leaks in other surfaces**: `AssistantPane.xaml.cs:1617` `Say(ChatKind.Tool, …, "list_changes")` shows a tool name as a chat header.
- **Chat messages**: `Say` header defaults to null, so message KIND is not text.


---

<!-- slice D: visual -->

# Visual system, theming, sizing and placement: static baseline

Baseline: commit `07934ebb`, add-in 1.13.0. All paths are relative to `revit-mcp/addin` unless they start with `revit-mcp/`.

**Method and limits.** This is static analysis only. Nothing here was observed in a live Revit session.

- Counts come from regex scans (`grep` plus a Python script kept in the session scratchpad). I cross-checked the font count: 95 raw `FontSize` lines = 94 scanned literals + 1 non-literal (`CdJobPaneView.cs:343`).
- Statements about how WPF or Revit behave are tagged **(inference)** when the repo cannot prove them.
- Revit API facts come from the `RevitAPIUI.xml` reference docs inside the Nice3point NuGet packages for 2024.3.60, 2025.4.60, 2026.4.10 and 2027.3.0. Those packages sit in the session scratchpad `nuget-packages/` folder. This proves API surface only, not runtime behaviour.
- Contrast ratios are WCAG 2 arithmetic on the hex values. They assume a white window background, which is the WPF default (`SystemColors.WindowBrush`). The comment at `AssistantPane.xaml:9-11` corroborates it: "WPF-ийн анхдагч ЦАГААН дэвсгэр".

---

## 0. Headline facts

- **Style definitions (counts):**
  - 10 `.xaml` files, 0 standalone `ResourceDictionary` files, no `App.xaml`, and 0 `pack://` strings.
  - 0 `DynamicResource`, 0 `SystemColors`/`SystemFonts`/`x:Static` references, and 0 `Application.Current` references.
  - 77 `static readonly Brush/Pen` fields, almost all frozen.
- **Pane vs window split:**
  - Every dockable pane is a hard-coded dark palette. These are AssistantPane, WorkPane, IntelligencePanel (hosted inside AssistantPane) and CdJobPaneView.
  - Every window is either hard-coded light or system-default controls plus fixed semantic brushes.
- **Theme detection:** none.
  - No code reads Revit's theme, Windows high contrast or Windows colours.
  - `UIThemeManager.CurrentTheme` and `UIControlledApplication.ThemeChanged` do exist in all four referenced Revit API versions (§2).
- **Font size:** 64 of 102 explicit `FontSize` assignments are below 12 DIP. Adding two `FormattedText` sites makes 66 sub-12 sites (§1C).
- **Placement:**
  - 25 windows plus 4 pane surfaces.
  - Only 4 windows use a work-area clamp (`RfUi.Setup`), and it uses the primary monitor.
  - Only SheetNumerator persists or restores window bounds, and it clamps to the virtual-screen bounding box.
  - 0 uses of `VisualTreeHelper.GetDpi`, `DpiChanged`, per-monitor APIs or an app manifest.

---

## 1. Per-surface style baseline

### 1A. Surfaces

"Local XAML" means resources live in the page's own `UserControl.Resources` or `Window.Resources`. "System default" means the dialog is built in code with no styles or templates, so it inherits the Aero2 controls and the white window background.

| # | Surface (files) | How styles are defined | Mode | Bg / Fg / border / accent | Semantic colours | Font family and sizes |
|---|---|---|---|---|---|---|
| S1 | **AssistantPane** (`AssistantPane.xaml` + `.xaml.cs`, dockable UserControl) | Local XAML `UserControl.Resources` (xaml:14-368) plus code-built frozen brushes in `.cs` (55-58 `FindingViewRow`, 132-134 `ChangeRow`, 206-218 `ChatMessage`) | Dark, hard-coded | Bg `#2B2B2B`, BgRaised `#333337`, BgInput `#1E1E1E`, Line `#454549`, Fg `#E8E8E8`, FgMuted `#9A9AA0`, Accent `#3FB984`, AccentDim `#2E6F55`. Hover/press: buttons `#3E3E44`/`#4A4A52`, rows `#3A3A41`/`#46464F`. Primary-button text `#F2FFF9`. Combo popups are deliberately light: surface `#F7F8FA`, text `#111827`, hover `#DCE7FF`, picked `#BBD3FF`. Bubbles: user `#2E6F55`, bot `#333337`, tool `#2A2A2E`, error `#43272A`. | Warn `#E0A34A`, Danger `#E05C5C`, danger text `#F0A0A0`, ok/header `#3FB984`. Severity mapping `FindingViewRow.TitleFg` (.cs:86-87): rank ≤1 `#E05C5C`, rank 2 `#E0A34A`, else `#E8E8E8`. | No FontFamily set (inherits). Sizes: 10×8, 11×16, 12×5, 13×3, 14×3. `TextFormattingMode=Display`, `UseLayoutRounding`. |
| S2 | **WorkPane** (`WorkPane/WorkPaneView.xaml(.cs)`) | Local XAML (xaml:25-201); `FindResource` for code-built rows (.cs:754-1016) | Dark | **Byte-identical** palette to S1 (same 10 keys, lines 26-35, plus the same combo block 132-135). Adds `LinkButton`, `DarkPass`, `DarkCheck`, `ChoiceRow`, `Card` (CornerRadius 5, 193-200). | Warn, Danger as S1 | Sizes: 10×1, 11×6, 11.5×1 (`.cs:946`), 12×4, 14×1 |
| S3 | **IntelligencePanel** (`Intelligence/Ui/IntelligencePanel.xaml`, hosted at `AssistantPane.xaml:580`) | Local XAML with `I`-prefixed copy of the palette (xaml:16-23: IBg…IWarn, 8 tokens, no AccentDim or Danger) | Dark | Same values as S1 | IWarn `#E0A34A`; issue-class edge uses **named brushes** `IndianRed`/`Goldenrod`/`SlateGray` (`IntelligenceViewModels.cs:208-210`); `Brushes.Gray` (:332) | Sizes: 11 (`IMuted`), 12 (`IText`) |
| S4 | **CdJobPaneView** (`CloneDrawings/CdJobPaneView.cs`, code-built UserControl) | 12 static frozen brushes (cs:64-75) plus a code-built `ControlTemplate` (cs:371-397) | Dark | Bg/BgRaised/BgInput/Line/Fg/FgMuted as S1, plus BgButton `#3E3E44` | Accent `#E0833A` (orange), AccentDim `#6B3F1C`, Ok `#3FB984`, Warn `#E0A34A`, Danger `#E05C5C`; primary-button text `Brushes.White` (:353) | Sizes via `Text(size…)` helper: 13×2, 12×1, 11×5, plus 14, 11 (literals) |
| S5 | **FamilyHubWindow** (`FamilyHub/Ui/FamilyHubWindow.xaml`) | Local XAML, 4 button styles with no ControlTemplate (xaml:8-31) | Light | Window `#F7F8FA`, panels/tabs white, border `#D8DDE4`. Primary button `#4A7FA5` on white text. Ghost `#E6EAF0` / `#1F2A37`. Disabled `#C9CED6` / `#5B6470`. | Info banner `#EEF4FA`/`#B9CFE4`/`#1F3A57`. Warn `#FFF6E5`/`#E8C98A`/`#6B4E00`. Error `#FDECEC`/`#E5A3A3`/`#8A1F1F`. Success `#EAF6EF`/`#9ED3B4`/`#1F6B44`, state text `#2E9E6B`. Muted `#5B6470`, `#8B94A0`. | `Segoe UI` 12 (window); 22, 14, 13, 11 elsewhere. Hard-coded English strings mixed with Mongolian. |
| S6 | **SheetNumeratorWindow** (`SheetNumerator/Ui/SheetNumeratorWindow.xaml(.cs)`) | Local XAML tokens (xaml:26-35) plus duplicates in code (`Converters.cs:16-17,60-61`; `.xaml.cs:383,602`) | Light | PanelBrush `#F7F8FA`, LineBrush `#D0D5DD`, Section bg white, banner `#FFF4E5`/`#F0B27A`, field border `#ABADB3` | ErrorBrush `#C62828`, WarnBrush `#E65100`, OkBrush `#2E7D32`, ChangedBrush `#1565C0`, MutedBrush `#6B7280`; row tints `#FDECEA`, `#FFF4E5`, `#EAF2FE`. State is **not colour-only**: glyphs ● ⚠ ✖ in `Segoe UI Symbol` (xaml:90-109). | `Segoe UI` 12; sizes 12, 11×2, 10×1. 41 `AutomationProperties.AutomationId`. |
| S7 | **Smart windows**: ChangeImpact, Clash, SmartCount, PublishDialog, ProfileEditor, PublishProgress, ClashRule, ImpactHistory, PromptDialog | Code-built through `UiKit` (`Smart/Ui/SmartUi.cs:15-140`). **System-default controls**, 5 fixed brushes, no styles or templates. | System default (white) | Grid lines `Brushes.LightGray`; alternating row `#F6F7FA` (ChangeImpact:74, Clash:67) | Blocking `#BE2828` (190,40,40), Warning `#BE7800`, Info `#46648C`, Ok `#1E8246`, Muted `#6E6E6E` (SmartUi.cs:17-21). **`ConfBrush` maps confidence A–D onto severity brushes** (ChangeImpactWindow.cs:502-511). | **No `FontSize` set anywhere**; only `FontWeight.SemiBold` on primary buttons |
| S8 | **Reinforcement dialogs**: EndSymbol, SectionAnnotation, ScheduleClone, ScheduleSync, plus `RfSearchBox`, `RfScheduleSourcePanel`, `SectionPreview` | Code-built through `RfUi` (`Reinforcement/Ui/RfUi.cs:12-94`), system default | System default; the preview canvas is always white | Note box = alpha tint of `#4A7FA5` (bg α24, border α90; also α18/α120 at SectionAnnotation:263-264, 319-320). Preview: concrete `#EEEEEE`, outline `#404040`, stirrup `#2E9E6B`, bar `#4A7FA5`, dim `#B87333`, tag `#8E6FD8`. | Muted `#6B7280`, Warn `#B45F06`, Bad `#B91C1C` (RfUi.cs:14-16) | Headers 16 (×4) / 14 (×1). Preview `FormattedText` 11 and 9 with `pixelsPerDip` hard-coded 1.0 (SectionPreview.cs:155-156, 173-174). |
| S9 | **AutoAnnotate / CloneDrawings / CopyToOther dialogs** | Code-built, system default. Each hand-rolls its own note box. | System default | Same `#4A7FA5` α24/α90 note tint | Warn text `#B86E00` + bg rgba(230,160,0,40) + border rgba(200,130,0,140) (AutoAnnotate:267,292-293). CloneDrawings relevance text `#B06020` / `#3C7850` (:480). Secondary text uses `Opacity` 0.65–0.8, not a muted brush. | Headings 16 / 15; hints 11 (13 sites in CloneDrawings) |
| S10 | **Legacy XAML dialogs**: Settings, Binding, BatchSheet, SchedulePicker, QtoProgress | XAML with no styles (one `DataGridRow` style in Binding) | System default | `Foreground="Gray"` ×19, `Background="White"` ×4, `Background="Transparent"` ×7, `#DDD` borders, `#444` | `#B45309` (Binding status); `#9CA3AF` hint; QtoProgress code brushes Gray/SteelBlue/ForestGreen/Firebrick/DarkOrange (.cs:286-322); Settings Firebrick/Gray (.cs:239) | 11 (×10 in BatchSheet only); `Consolas` for the preview |
| S11 | **LicenseDialog** | Code-built | System default | Border `#D5D9DE` | Ok `#2E8B57`, Bad `#B22222`, Muted `#5F6770` (cs:25-27) | `Consolas` (device code); 16, 13 |
| S12 | **TextPromptDialog** and **PromptDialog** (two duplicates) | Code-built | System default | none | none | `Segoe UI` 12 (TextPrompt only) |
| S13 | **Ribbon icons** (`App.cs:480-494` `IconColors`, `Reinforcement/RfRibbon.cs:17-21`, `Smart/Revit/SmartRibbon.cs:17-20`) | Fixed frozen mid-tone brushes, rendered once at `OnStartup` by `GlyphIcons.TryRender` | Neither: mid-tones chosen to read on both themes (App.cs:475-478) | 13 + 5 + 4 = 22 colours (e.g. `#4A7FA5`, `#B87333`, `#3FB984`, `#C9A227`) | n/a | Segoe Fluent Icons / Segoe MDL2 Assets glyphs, one bitmap per size |

**Counts.** By my script there are about 97 distinct opaque RGB literals across `.xaml` and `.cs` (about 83 excluding the three ribbon files), comments excluded. XAML also uses the named colours Gray ×19, White ×4 and Transparent ×7. Code uses named brushes: LightGray ×8, Gray ×5, Firebrick ×2, SteelBlue ×2, ForestGreen ×2, White ×2, Black ×2, plus DarkOrange, IndianRed, Goldenrod, SlateGray and Transparent.

**Where the duplication comes from.**
- The dark palette is textually copied four times. Values are the same in S1/S2/S3/S4 (S4 swaps the accent). The audit's "separate dark styles" is true textually, but values do not diverge inside the dark family. The audit omits S4.
- `UiKit` lives in `Smart/**`, which csproj removes from the R24 (net48) build. R24 still compiles AutoAnnotate, CloneDrawings, CopyToOther, Reinforcement, Licensing and SheetNumerator, so those dialogs cannot use `UiKit`. That is why 5 hand-rolled copies of the `#4A7FA5` note box exist (RfUi.cs:45, AutoAnnotate:84 and :288, CloneDrawings:154, SectionAnnotation:259 and :316).
- Message surfaces are mixed: 100 Revit `TaskDialog` sites, 30 WPF `MessageBox` sites (WorkPaneView ×6 and CdJobPaneView ×3 are inside dark panes), and inline notes.

### 1B. Semantic colour collisions

| Meaning | Distinct values in use (location) |
|---|---|
| **Error / blocking** (8) | `#E05C5C` (dark panes), `#F0A0A0` (error-bubble text), `#C62828` (SheetNumerator), `#B91C1C` (RfUi.Bad), `#BE2828` (UiKit.Blocking), `#B22222` (LicenseDialog.Bad, `Firebrick` in QtoProgress/Settings), `#CD5C5C` (`IndianRed`, Intelligence), `#8A1F1F` (FamilyHub) |
| **Warning** (9+) | `#E0A34A` (dark panes), `#E65100` (SheetNumerator), `#B45F06` (RfUi.Warn), `#BE7800` (UiKit.Warning), `#B86E00` (AutoAnnotate), `#B45309` (Binding), `#B06020` (CloneDrawings), `#FF8C00` (`DarkOrange`, QtoProgress), `#6B4E00` (FamilyHub), `#DAA520` (`Goldenrod`, Intelligence) |
| **Success / OK** (7) | `#3FB984` (dark panes), `#2E7D32` (SheetNumerator), `#1E8246` (UiKit.Ok), `#2E8B57` (LicenseDialog), `#2E9E6B` (FamilyHub), `#3C7850` (CloneDrawings), `#228B22` (`ForestGreen`, QtoProgress) |
| **Info / changed** (5) | `#4A7FA5` (note tint, FamilyHub primary), `#1565C0` (SheetNumerator), `#46648C` (UiKit.Info), `#4682B4` (`SteelBlue`, QtoProgress), `#1F3A57` (FamilyHub banner) |
| **Muted** (10+) | `#9A9AA0` (dark panes), `#6B7280` (SheetNumerator, RfUi), `#6E6E6E` (UiKit), `#5F6770` (License), `#5B6470` and `#8B94A0` (FamilyHub), `Gray` `#808080` (×19 XAML + 5 code), `#444` and `#9CA3AF` (Binding), `SlateGray` (Intelligence), `Opacity` 0.65–0.8 |

### 1C. Font sizes

**Frequency** across all XAML plus code-built UI, counting the 8 `Text(size,…)` helper calls in CdJobPaneView:

| Size (DIP) | 10 | 11 | 11.5 | 12 | 13 | 14 | 15 | 16 | 22 |
|---|---|---|---|---|---|---|---|---|---|
| Count | 10 | 53 | 1 | 14 | 8 | 7 | 1 | 7 | 1 |

That is 102 explicit assignments. 64 of them (63%) are below 12. All code-built dialogs with no `FontSize` inherit the WPF system default, nominally 12 DIP **(inference)**.

**Every site below 12 DIP** (`line:size`). Total 66, including two `FormattedText` draw calls:

- `AssistantPane.xaml` (24): 76:11 167:10 251:11 308:11 311:10 315:10 323:10 328:10 353:11 357:10 363:10 505:11 552:11 571:11 602:10 684:11 695:11 700:11 764:11 802:11 808:11 846:11 850:11 854:11
- `WorkPane/WorkPaneView.xaml` (4): 84:11 94:11 98:11 346:10
- `WorkPane/WorkPaneView.xaml.cs` (4): 753:11 946:11.5 969:11 998:11
- `Intelligence/Ui/IntelligencePanel.xaml` (1): 32:11
- `CloneDrawings/CdJobPaneView.cs` (7): 92:11 163:11 191:11 192:11 197:11 224:11 237:11
- `CloneDrawings/CloneDrawingsDialog.cs` (6): 49:11 225:11 456:11 472:11 478:11 922:11
- `AutoAnnotate/AutoAnnotateDialog.cs` (2): 206:11 263:11
- `CopyToOtherCommand.cs` (1): 435:11
- `BatchSheetDialog.xaml` (10): 33 34 35 87 88 89 90 104 110 116 (all 11)
- `FamilyHub/Ui/FamilyHubWindow.xaml` (2): 149:11 150:11
- `SheetNumerator/Ui/SheetNumeratorWindow.xaml` (3): 39:11 429:10 661:11
- `Reinforcement/Ui/SectionPreview.cs` (2, `FormattedText`): 156:11 174:9

**Leverage.** Four shared styles multiply the 11-DIP size well beyond the literal count: `MutedText` (referenced on 18 lines in AssistantPane and 14 in WorkPane), `IMuted` (19 lines), and `FieldLabel` (18 lines in SheetNumerator).

### 1D. Control templates and focus treatment

- **No `FocusVisualStyle`, `IsKeyboardFocused`, `IsFocused` or `Focusable` anywhere** (0 hits in `.cs` and `.xaml`).
- **10 custom `ControlTemplate`s** replace the Aero2 defaults:
  - AssistantPane: FlatButton Button (xaml:36), ComboRow ComboBoxItem (118), ChangeRowButton Button (197), DarkExpander Expander (234), and its inner ToggleButton (241).
  - WorkPane: FlatButton (47), ComboRow (145), ChoiceRow ListBoxItem (176).
  - Intelligence: ITab TabItem (61).
  - CdJobPaneView: a code-built Button template (`MakeButtonTemplate`, cs:371-397) whose only triggers are hover opacity 0.85 and disabled opacity 0.4.
- None of the 10 has a keyboard-focus trigger. Because `FocusVisualStyle` is never set, keyboard focus on these buttons falls back to WPF's default dotted focus rectangle **(inference)**. That rectangle is not themed.
- TextBox, PasswordBox, CheckBox, ScrollBar, DataGrid and ListView keep default templates with only Background/Foreground/Border overridden in dark panes. Those default templates draw their own hover, focus and popup colours from the system theme **(inference)**.
- In-repo evidence of the template workarounds:
  - `AssistantPane.xaml:95-96`: "унжих цэсээ СИСТЕМИЙН цагаан дэвсгэр дээр зурдаг"
  - `AssistantPane.xaml:221`: "толгойн сумаа СИСТЕМИЙН бараан бийрээр зурдаг"
  - `CdJobPaneView.cs:365`: the comment says Windows' default button is "цагаан, цэнхэр hover" and is invisible on the dark pane.
- Accessibility attributes: only SheetNumerator has `AutomationId` (41). There is no `AutomationProperties.Name`, `AccessKey` or `TabIndex`. `IsDefault`/`IsCancel` are used on most dialogs.

### 1E. Contrast spot-checks

WCAG AA needs 4.5:1 for normal text and 3:1 for UI boundaries.

| Pair | Ratio |
|---|---|
| Dark: FgMuted `#9A9AA0` on Bg `#2B2B2B` | 5.06 |
| Dark: FgMuted on BgRaised `#333337` | 4.49 |
| Dark: Danger `#E05C5C` on Bg | 3.95 |
| Dark: CdJob accent `#E0833A` on BgRaised | 4.48 |
| Dark: input border `Line #454549` vs BgInput `#1E1E1E` | 1.75 |
| Dark: Line vs Bg | 1.48 |
| Light: WPF `Gray` `#808080` on white (used ×19 in XAML and ×5 in code) | 3.95 |
| Light: Binding hint `#9CA3AF` | 2.54 |
| Light: FamilyHub `#8B94A0` on white / on `#F7F8FA` | 3.07 / 2.89 |
| Light: FamilyHub state `#2E9E6B` | 3.38 |
| Light: white text on FamilyHub primary `#4A7FA5` | 4.31 |
| Light: FamilyHub disabled `#5B6470` on `#C9CED6` | 3.79 |
| Light: `UiKit.Warning #BE7800` | 3.57 |
| Light: `LicenseDialog.Ok #2E8B57` | 4.25 |
| Light: SheetNumerator `WarnBrush #E65100` on white / on `#FFF4E5` | 3.79 / 3.49 |
| Light: SheetNumerator input border `#ABADB3` | 2.24 |
| Light: `RfUi.Warn #B45F06` | 4.58 (passes) |
| Light: `UiKit.Ok #1E8246` | 4.84 (passes) |
| Light: `RfUi.Muted #6B7280` | 4.83 (passes) |

---

## 2. Theme detection today

**Code that reads a theme:** none. Grep over all `.cs`/`.xaml` returns 0 hits for `UIThemeManager`, `UIFramework`, `ThemeChanged`, `HighContrast`, `SystemColors`, `SystemFonts`, `AppsUseLightTheme`, `SystemEvents`, `UserPreferenceChanged`, `DynamicResource`.

- The only registry reads are `Licensing/HardwareProbe.cs:76-77` (HKLM `SOFTWARE\Microsoft\Cryptography`) and `:91-92` (display-adapter class key). Neither is theme related.
- The only `SystemParameters` uses are the work-area and virtual-screen reads in §4C and the two drag-distance reads at `SheetNumeratorWindow.xaml.cs:144-145`.

**Does any surface react to a theme change or high contrast?** No. The structure prevents it:
- Styling uses only `StaticResource` (≈436 references in 5 XAML files).
- Brushes are frozen singletons: 77 `static readonly Brush/Pen` fields, e.g. `AssistantPane.xaml.cs:55-58`, `CdJobPaneView.cs:64-75`, `UiKit`, `RfUi`, `LicenseDialog`.
- Ribbon icons are rendered once at `OnStartup`.
- In Windows high contrast, default-template controls follow system colours while the hard-coded dark or light brushes do not **(inference)**.

**Design intent in comments is "static, theme-independent":**
- `AssistantPane.xaml:9`: "Revit 2027-ийн харанхуй сэдэвт таарсан палитр."
- `AssistantPane.xaml:12`: "Revit сэдвээ өөрчилвөл энэ блокийг л засна."
- `CdJobPaneView.cs:63`: "бараан палитр — Revit-ийн гэрэл/бараан загвараас үл хамааран уншигдана."
- `App.cs:475-477`: "Revit-ийн БАРААН болон ЦАЙВАР хоёр themе дээр хоёуланд нь уншигдах дунд тонуудыг сонгосон: өмнөх `DimGray` (#696969) нь бараан туузан дээр бараг харагддаггүй байв."

**What the referenced Revit API offers.** From the reference `RevitAPIUI.xml` for all four versions (R24 = 2024.3.60, R25 = 2025.4.60, R26 = 2026.4.10, R27 = 2027.3.0); not exercised at runtime:
- `Autodesk.Revit.UI.UIThemeManager`: properties `CurrentTheme`, `CurrentCanvasTheme`, `FollowSystemColorTheme`, and (2024 docs) `DefaultTheme`.
- `UITheme.Light` and `UITheme.Dark`.
- Event `UIControlledApplication.ThemeChanged`, and `UIApplication.ThemeChanged`, in all four versions. Args: `ThemeChangedEventArgs.ThemeChangedType` of type `ThemeType` (`UITheme` or `CanvasTheme`).
- Doc inconsistency to resolve when implementing: `ThemeType` is marked "since 2025" in the 2024 XML, although the type is present in the 2024.3.60 package.

---

## 3. XAML loading and resource-dictionary implications

- **10 XAML files, 10 `InitializeComponent()` calls.** Sites: `AssistantPane.xaml.cs:424`, `WorkPane/WorkPaneView.xaml.cs:73`, `Intelligence/Ui/IntelligencePanel.xaml.cs:22`, `FamilyHub/Ui/FamilyHubWindow.xaml.cs:111`, `SheetNumerator/Ui/SheetNumeratorWindow.xaml.cs:43`, `QtoProgressWindow.xaml.cs:52`, `BatchSheetDialog.xaml.cs:72`, `SettingsDialog.xaml.cs:20`, `BindingDialog.xaml.cs:131`, `SchedulePickerDialog.xaml.cs:47`.
- **0 `pack://` strings, 0 `Application.LoadComponent` calls, 0 `ResourceDictionary` `.xaml` files, 0 `MergedDictionaries`, no `App.xaml`, no `Themes/` folder.**
  - The generated `obj/*.g.cs` was not inspected (not present locally). Standard WPF `InitializeComponent` loads BAML through a relative component URI **(inference)**.
  - There is therefore no repo precedent for merging a shared dictionary by URI.
- **`Application.Current` / `Application.Resources`: 0 references. The redesign must keep it that way.** `UiPump.cs:16` uses `Dispatcher.CurrentDispatcher` only.
- **Code-to-XAML key coupling.** `FindResource` with string keys: `AssistantPane.xaml.cs:547` (`"Accent"`/`"FgMuted"`), `:1232` and `:1240` (`"MutedText"`), `WorkPaneView.xaml.cs:754` (`"Fg"`), `:758` and `:963` (`"DarkBox"`), `:947` (`"Danger"`/`"Warn"`), `:954` (`"MutedText"`), `:995` (`"FlatButton"`), `:1016` (`"Danger"`/`"FgMuted"`). Renaming keys breaks these.
- **Code-built UI is deliberate.** 17 `Window` classes are XAML-less: `RfUi.cs:9`, `SmartUi.cs:12`, `LicenseDialog.cs:20` ("XAML-гүй (кодоор) — WPF markup-ийн хоёр алхмын эмхэтгэлд шинэ файл нэмэхгүйн тулд"). The WPF two-pass markup compile is fragile: `revit-mcp/docs/INSTALL_BUNDLE.md:30` and `docs/SMART.md:305` document `BG1002 …baml cannot be found`, mitigated by `build-bundle.ps1 -Isolated`.
- **Build matrix effect on XAML.** The SDK default globs `*.xaml` into `Page`. The csproj `Page Remove`s `Intelligence/**`, `FamilyHub/**`, `WorkTracking/**`, `WorkPane/**` for net48. Any new `.xaml` in a shared folder compiles for all four configurations including net48. Any new `.xaml` in an excluded folder needs a `Page Remove`.
- **Isolated load context.**
  - csproj:162-165 sets `EnableDynamicLoading=true` for net8/net10 ("isolated load (deps.json)"). `installer/verify-bundle.ps1:86` checks `deps.json` for exactly that reason.
  - `App.cs` has no `AssemblyLoadContext` code.
  - The risk to flag: a `pack://application:,,,/RevitMcpAddin;component/...` dictionary URI could fail if the add-in sits in a non-default load context **(unverified; inference)**. The proven mechanisms are BAML via `InitializeComponent` and fully code-built resources.
- **How dockable-pane controls are created.**
  - Each provider holds a static lazy singleton: `AssistantPaneProvider.cs:25` (`View => _view ?? (_view = new AssistantPane())`), `WorkPaneProvider.cs:25`, `CdJobPaneProvider.View` (`CdJobHost.cs:437-449`, with `Attach(...)`, `CdJobHost.Changed += Refresh`).
  - `SetupDockablePane` assigns `data.FrameworkElement = View` and `InitialState.DockPosition = Right`. `FrameworkElementCreator` is not used.
  - `RegisterDockablePane` runs only in `OnStartup` (`App.cs:202`, `:220`, `:237`).
  - `IntelligencePanel` is created lazily on first toggle into `IntelligenceHost.Child` (`AssistantPane.xaml.cs:1225`). On R24 a text fallback is shown instead.
  - Revit doc: `DockablePaneProviderData.FrameworkElement` — "Using a System.Windows.Controls.Page is recommended"; the add-in uses `UserControl`.
- **R24 (net48) excludes** Intelligence, FamilyHub, WorkTracking, WorkPane, Smart, SmartPublish, SmartCount, ClashCheck, ChangeImpact, and the MCP executor files. It still includes AssistantPane, CdJobPane, SheetNumerator, AutoAnnotate, CloneDrawings, CopyTo, Reinforcement, Licensing and the legacy dialogs. A shared UI layer must compile there too, so it must avoid net8-only APIs. `FolderPicker` uses `Microsoft.Win32.OpenFolderDialog`, which is .NET 8+ and is why it sits in Smart.

---

## 4. Sizing and placement

### 4A. Every window (25)

Owner column legend: **modal** = `App.ShowOwned(window, hwnd)`, which sets `WindowInteropHelper.Owner = App.MainWindowHandle` (App.cs:454) and overrides `WindowStartupLocation` to `CenterOwner` (App.cs:457) when the handle is known. If not, the window keeps its own startup location.

| # | Window | Source (size lines) | Width × Height | Min | SizeToContent / ResizeMode | Own startup | Owner / show path |
|---|---|---|---|---|---|---|---|
| 1 | SettingsDialog | `SettingsDialog.xaml:5-9` | 460 × auto | none | Height / NoResize | CenterScreen | modal (QtoExportCommand.cs:36/208/285, BindingCommand.cs:38, PdfViewExportCommand.cs:53, ScheduleExportCommand.cs:36); also `new SettingsDialog { Owner = this }` (QtoProgressWindow.xaml.cs:201) |
| 2 | BindingDialog | `BindingDialog.xaml:5-8` | 1040 × 680 | none | default resize | CenterScreen | modal (BindingCommand.cs:99) |
| 3 | BatchSheetDialog | `BatchSheetDialog.xaml:5-8` | 640 × 720 | none | default | CenterScreen | modal (BatchSheetCommand.cs:59) |
| 4 | SchedulePickerDialog | `SchedulePickerDialog.xaml:5-8` | 560 × 620 | none | default | CenterScreen | modal (ScheduleExportCommand.cs:59) |
| 5 | QtoProgressWindow | `QtoProgressWindow.xaml:5-10` | 560 × auto, MaxHeight 640 | none | Height / NoResize | CenterScreen | modal (QtoExportCommand.cs:128) |
| 6 | CopyToOtherDialog | `CopyToOtherCommand.cs:292-297` | 540 × auto | none | Height / NoResize; no ScrollViewer, no MaxHeight | CenterScreen | modal (:90) |
| 7 | AutoAnnotateDialog | `AutoAnnotateDialog.cs:34-40` | 860 × 640 | 760 × 560 | CanResizeWithGrip | CenterScreen | modal (AutoAnnotateCommand.cs:77) |
| 8 | CloneDrawingsDialog | `CloneDrawingsDialog.cs:110-117` | 1040 × 760 | 860 × 580 | CanResizeWithGrip | CenterScreen | modal (CloneDrawingsCommand.cs:122) |
| 9 | EndSymbolDialog | `EndSymbolDialog.cs:49-50` | 680 × 860 → clamped | 600 × 640 | `RfUi.Setup` then **NoResize** | CenterScreen | modal (EndSymbolCommands.cs:63) |
| 10 | SectionAnnotationDialog | `SectionAnnotationDialog.cs:98` | 1100 × 800 → clamped | 980 × 700 | CanResizeWithGrip | CenterScreen | modal (SectionAnnotationCommand.cs:106) |
| 11 | ScheduleCloneDialog | `ScheduleCloneDialog.cs:75` | 1000 × 760 → clamped | 860 × 620 | CanResizeWithGrip | CenterScreen | modal (ScheduleCloneCommands.cs:43) |
| 12 | ScheduleSyncDialog | `ScheduleSyncDialog.cs:70` | 1000 × 740 → clamped | 860 × 600 | CanResizeWithGrip | CenterScreen | modal (:104) |
| 13 | LicenseDialog | `LicenseDialog.cs:54-59` | 470 × auto | none | Height / NoResize | CenterOwner | modal (LicenseCommand.cs:16; LicenseGate.cs:146 uses the remembered handle) |
| 14 | PublishDialog | `PublishDialog.cs:149-154` | 1180 × 780 | 900 × 560 | default | CenterOwner | modal (SmartPublishCommand.cs:61); `ShowInTaskbar` not set |
| 15 | ProfileEditorDialog | `ProfileEditorDialog.cs:78-83` | 780 × 700 | 640 × 520 | default | CenterOwner | `Owner = this` (PublishDialog.cs:490) |
| 16 | PublishProgressWindow | `PublishProgressWindow.cs:37-42` | 480 × 190 | none | NoResize | CenterOwner | modeless `Show()` + `WindowInteropHelper` (SmartPublishCommand.cs:113-114; PublishImpactAnalysis.cs:45-46) + `OwnerLock` |
| 17 | ChangeImpactWindow | `ChangeImpactWindow.cs:111-116` | 1320 × 820 | **1000 × 620** | default | none set (WPF default) | modeless `SmartWindows.ShowModeless` → `ApplyOwner` (ChangeImpactCommand.cs:41) |
| 18 | ImpactHistoryDialog | `ChangeImpactWindow.cs:740-745` | 760 × 520 | none | default | CenterOwner | `Owner = owner`; `ShowDialog` (:433) |
| 19 | PromptDialog (anonymous `new Window`) | `ChangeImpactWindow.cs:711-714` | 480 × auto | none | Height / NoResize | CenterOwner | `Owner = owner`; `ShowDialog` (:731) |
| 20 | ClashWindow | `ClashWindow.cs:103-108` | 1240 × 800 | 960 × 600 | default | none set | modeless `SmartWindows` (ClashCheckCommand.cs:41) |
| 21 | ClashRuleDialog | `ClashRuleDialog.cs:52-59` | 900 × 780 | 700 × 520 | default | CenterOwner | `Owner = owner`; `ShowDialog` (ClashWindow.cs:360) |
| 22 | SmartCountWindow | `SmartCountWindow.cs:93-98` | 1180 × 780 | 900 × 560 | default | none set | modeless `SmartWindows` (SmartCountCommand.cs:41) |
| 23 | SheetNumeratorWindow | `SheetNumeratorWindow.xaml:5-10` | 1180 × 780 (or restored) | **960 × 620** | default | CenterScreen if no saved bounds, else Manual (xaml.cs:466-491) | modeless `Show()`; `WindowInteropHelper.Owner` (SheetNumeratorCommand.cs:90,104) |
| 24 | TextPromptDialog | `TextPromptDialog.cs:18-23` | 460 × auto | none | Height / NoResize | CenterOwner | `Owner = owner` when non-null (:60); `ShowDialog` (:61) |
| 25 | FamilyHubWindow | `FamilyHubWindow.xaml:5-6` | 1100 × 760 | 640 × 480 | default | CenterOwner | modeless `Show()`; `WindowInteropHelper.Owner = App.MainWindowHandle` (FamilyHubCommand.cs:39,43) |

All windows except PublishDialog and ProfileEditorDialog set `ShowInTaskbar = false`. The ownership helper comments (App.cs:425-431, SmartWindows.cs:14) state the reason: without an owner such a window is lost behind Revit.

**Dockable panes (4 surfaces):**
- **AssistantPane:** `MinWidth="300"` (xaml:4). `InitialState.DockPosition = Right`. `VisibleByDefault` is unset. The Revit docs say the default is shown at first launch.
- **WorkPane:** `MinWidth="280"` (xaml:4). `VisibleByDefault = true` (`WorkPaneProvider.cs:33`).
- **CdJobPaneView:** no MinWidth. `VisibleByDefault = false` (`CdJobHost.cs:461`).
- **IntelligencePanel:** inside AssistantPane. `IntelligenceHost` has `MinHeight="260" MaxHeight="560"` (xaml:580-583).
- `DockablePaneState.MinimumWidth` and `MinimumHeight` exist (pixels, default 200, since 2020 per Revit docs) but are never set.
- The WPF `MinWidth` values are in DIPs, so the pane units are inconsistent under non-100% scaling.
- AssistantPane's layout has seven Auto rows and one star row (the chat) with no outer ScrollViewer (xaml:372-388). On a short pane the composer row can clip **(inference)**.

### 4B. Fixed-width layouts

- **SmartCount** `leftScroll`: `Width = 560` (cs:150). At the window MinWidth of 900 this leaves 340 DIP for the results panel.
- **SectionAnnotation:** left panel `Width = 420` and `leftScroll Width = 440` (cs:130, 191).
- **ChangeImpact:** left DockPanel `Width = 400` (cs:200).
- **Clash:** history column `Width = 360` (cs:223).
- **SheetNumerator:**
  - Right column `410` with MinWidth `380`; left column MinWidth `500` (xaml:288-290).
  - ListView columns are fixed at 28+130+140+210+230 = 738 DIP (xaml:386-435) with horizontal scroll Auto (:371).
  - Tree `Height="150"`.
- **PublishDialog:** star split 7:6 with MinWidth 340/320 (cs:272-273).
- **Other fixed widths:** Intelligence key column 110 (xaml:81), WorkPane column 64 (xaml:303), RfSearchBox 420, `RfScheduleSourcePanel` combo and textbox MinWidth 380 (cs:28-30).

**Windows whose default or minimum size is large.** 11 of 25 windows default to a width ≥1000 DIP. Windows with MinWidth ≥900: SheetNumerator, ChangeImpact, Clash, SmartCount, SmartPublish, SectionAnnotation. Illustrative arithmetic only, not observation:
- A 1366×768 panel at 125% scaling gives about 1093×582 DIP of work area after the taskbar. SheetNumerator (min 620 high), ChangeImpact (620) and Clash (600) exceed it.
- At 150% scaling the work area is about 911 wide, which is below the 960, 960 and 1000 MinWidth of SheetNumerator, Clash and ChangeImpact.
- WPF enforces MinWidth and MinHeight regardless of screen size **(inference)**.

### 4C. Clamping, monitors and DPI

- **`RfUi.Setup`** (`Reinforcement/Ui/RfUi.cs:72-86`) is the only work-area clamp. Callers: EndSymbol (:49), SectionAnnotation (:98), ScheduleClone (:75), ScheduleSync (:70). It:
  - reads `SystemParameters.WorkArea` (:75);
  - sets `MaxWidth`/`MaxHeight` to the work area (:77-78);
  - clamps Width, Height, MinWidth and MinHeight (:79-82);
  - sets `CanResizeWithGrip`, `ShowInTaskbar=false`, `CenterScreen`.
- **What it misses:**
  - `WorkArea` is the **primary** monitor only, in system-DPI DIPs. It has no knowledge of the monitor that hosts the owner HWND (`App.MainWindowHandle`, App.cs:433).
  - It never clamps `Left`/`Top`.
  - `ShowOwned` then overrides placement to `CenterOwner`, so a window sized to the primary work area can overflow a smaller secondary monitor **(inference)**.
  - There is no re-clamp on monitor move or DPI change, and EndSymbol then forces `NoResize` (:50).
  - The other 21 windows have no clamp.
- **SheetNumerator `ApplySavedBounds`** (`SheetNumeratorWindow.xaml.cs:466-491`):
  - runs in the constructor, before the owner is set;
  - clamps to the **virtual-screen bounding box**: `Math.Max(MinWidth, Math.Min(w.Width, VirtualScreenWidth))` (:479), and keeps ≥120×80 DIP visible;
  - saves `Left/Top/Width/Height` as DIP doubles in `OnClosing` (:493-511) with no monitor id or DPI;
  - `docs/SHEET_NUMERATOR.md:345` admits the multi-monitor restore was "бодит дэлгэц салгаж шалгаагүй".
- **DPI handling:** 0 uses of `VisualTreeHelper.GetDpi`, `DpiChanged`, `PerMonitor`, `GetDpiForWindow`, and no `app.manifest` in the add-in. Process DPI awareness is Revit's and cannot be determined from this repo. Other DPI-related code:
  - `GlyphIcons.cs:95` renders ribbon bitmaps at a fixed `Dpi = 192.0` (16 → 32 px, 32 → 64 px), with one bitmap per size and no per-DPI variants.
  - `SectionPreview.cs:155-156, 173-174` pass `pixelsPerDip` as a literal `1.0` to `FormattedText`.
  - `TextOptions.TextFormattingMode="Display"` plus `UseLayoutRounding` on the three panes (AssistantPane:5-6, WorkPane:5-6, Intelligence:4-5); `UseLayoutRounding` also on SheetNumerator (:13).
- **P/Invoke precedent for a monitor-aware helper:** `OwnerLock` (`SmartUi.cs:157-160`), `WorkTrackingHost.cs:546-549`, `HardwareProbe.cs:143-146`. `HardwareProbe` reads physical display resolutions for licensing and is not a UI helper.

### 4D. Action buttons inside scrolling content

- **EndSymbolDialog:** `buttons` is added to `root` (cs:147-153) and `Content = new ScrollViewer { ..., Content = root }` (cs:155). After `RfUi.Setup`, `ResizeMode.NoResize` is forced (:50). The comment at :154 says scroll was added so the "Тавих" button would not be clipped, but the button scrolls away with the content.
- **SmartCountWindow:** Run/Stop (`UiKit.Row(_runBtn, _stopBtn)`, cs:147) are inside `leftScroll` (:150). Select/Show/Copy sit in an Auto row outside the scroll (:152-162).
- **ChangeImpactWindow:** Open/Copy sit inside `detailBox`'s ScrollViewer, `MaxHeight = 280` (cs:214-219).
- **ClashWindow:** the detail Border has `MaxHeight = 300` but no ScrollViewer around the status button `Wrap` (cs:213-246). `_detail` is a wrapping `TextBlock` (:70), so growth clips the buttons **(inference)**.
- **Correct pattern already in the repo:** `DockPanel.Dock=Bottom` outside any ScrollViewer. Used by SectionAnnotation (:109-126), ScheduleClone (:87-100), ScheduleSync (:92), AutoAnnotate, CloneDrawings (:165), ClashRule (:126), ProfileEditor (:120) and SheetNumerator's footer row (xaml:684).
- **No safeguard against tall content:** CopyToOtherDialog (`SizeToContent=Height`, `NoResize`, no scroll), LicenseDialog, and QtoProgressWindow (fixed `MaxHeight 640`).

---

## 5. Where UI preferences persist today

**Root:** `%APPDATA%\RevitMcpAddin\` (`SettingsStore.Dir`, SettingsStore.cs:18-21). Writers are separate stores per tool.

| File | Code | Keys / content | UI relevance |
|---|---|---|---|
| `settings.json` | `SettingsStore` (cached shallow copy) / `AddinSettings` QtoDtos.cs:241 | `api_host`:296 `token`:299 (not written when DPAPI works) `token_enc`:308 `username`:311 `project_id`:314 `project_name`:317 `include_links`:325 `selected_schedules`:329 `sheet_gen`:333 `copy_to_other`:337 `clone_drawings`:341 `team_override`:357 `authority_level`:378. `clone_drawings` has `tags`, `dimensions`, `spots`, `details`, `sheets`, `rebar`, `replace_mark`, `annotation_kinds`, `views_on`, `views_off`, `view_types_off`. | Tool option memory only. Do not add UI-chrome keys; this file carries token and session handling. |
| `auto-annotate.json` | `AaPrefs` (AaModel.cs:145) | `AaOptions` (`OnlySelection` forced false on load) | option memory |
| `reinforcement.json` | `RfPrefs` (RfPrefs.cs:96) | `EndSymbol`, `Section`, `Schedule`; saved only if `Remember` | option memory |
| `sheet-numerator.json` | `SheetNumeratorPrefsStore` (:27), atomic tmp-then-move | `schema_version`, `window{left,top,width,height,maximized}`, `grouped_mode`, `sort_by_name`, `hide_preview`, **`unicode_warning_accepted`** (one-time acknowledgement), `mode`, `simple{…}` | **The only window-bounds and acknowledgement-flag store** |
| `smart\settings.json`, `smart\*.json`, `smart\docs\<hash>\*.json` | `SmartPaths` (:27-60), `SmartSettings` | `ImpactTracking`, `TrackingGapThroughSeq`, `DocGapThroughSeq`; `profiles.json`, `clash-rules.json`, `queries.json`; per-doc `impact-*.json`, `clash-state.json`, `publish-history.json`, `publish-checkpoints.json` | none |
| `tracking\context.json` | `WorkTrackingHost.cs:99-105` | `docs`, `tasks` (remembered project and task choices) | workflow memory |
| `license.json`, `device.json` | LicenseGate, DeviceCredentialStore | licensing | none |
| `intelligence\…` | `AppDataStoragePaths` (`ActivityJournal.cs:27`) | journals | none |
| `%LOCALAPPDATA%\MGL\RevitMcpAddin\FamilyHubCache` | `FamilyHubCommand.cs:71` | cache | none |

- **Pane visibility, size and dock position:** the add-in stores nothing. The provider comments say Revit remembers them per pane GUID (`AssistantPaneProvider.cs:14-15`: "Revit самбарын байрлал/хэмжээг үүгээр санадаг"). Revit's own storage is outside this repo.
- **Onboarding or first-run flags:** none, apart from `unicode_warning_accepted` and `WorkPaneProvider VisibleByDefault = true`. Pane toggles (`ChangesToggle`, `IntelToggle`) are in-memory only.
- **Writes into the RVT:** all via Extensible Storage, and all provenance or ownership data, not UI state.
  - `MglRfScheduleClone` (`RfStores.cs:15-60`).
  - `MglRfSectionAnn` (`RfSectionStore.cs`): a JSON blob that includes the per-host **options used** (`RfSectionSaved`: ref, sides, offsets, type uids) for re-runs.
  - The end-symbol store, the AutoAnnotate view stamp, `CdLinks`, and the FamilyHub registry in `DataStorage` named `MGL.FamilyHub.Registry`.
  - Nothing writes window bounds or onboarding state into the RVT.

---

## 6. Reusable helpers

| Helper | Where | What it offers |
|---|---|---|
| `App.ShowOwned`, `App.MainWindowHandle`, `RememberMainWindow` | `App.cs:433-471` | Single owner and CenterOwner path for modal windows; the owner HWND for monitor and DPI lookups |
| `SmartWindows.ShowModeless / ApplyOwner / CloseAll / IdentityOf` | `Smart/Revit/SmartWindows.cs:47 / 92 / 106 / 39` | One-instance-per-type modeless lifecycle with owner. Smart-folder only (R24-excluded). |
| `OwnerLock`, `UiThread`, `NotifyBase`, `FolderPicker` | `Smart/Ui/SmartUi.cs:155 / 184 / 237 / 257` | Disable the Revit main window during sync work; safe dispatcher marshalling; INPC base; folder picker (.NET 8+) |
| `UiKit` factories | `SmartUi.cs:15-140` | `Text`, `Btn`, `Check`, `Combo`, `Box`, `Row`, `Wrap`, `Col`, `Section`, `Form`/`F`, `SeverityBrush` + 5 fixed brushes |
| `RfUi` | `Reinforcement/Ui/RfUi.cs:12-94` | `Muted`/`Warn`/`Bad`, `Section`, `Hint`, `Note`, `MakeButton`, `Setup` (the work-area clamp), `TryParse`. R24-included. |
| `RfSearchBox`, `RfChoice`, `RfFilteredList` | `RfSearchBox.cs:34`, `RfSearch.cs:86` | Live-filter chooser with pinned items; reused by EndSymbol and `RfScheduleSourcePanel` |
| `RfScheduleSourcePanel` | `RfScheduleSourcePanel.cs:21` | Shared top section of ScheduleClone and ScheduleSync |
| `SectionPreview` | `SectionPreview.cs:17` | `FrameworkElement` drawing canvas (needs the `pixelsPerDip` fix) |
| `GlyphIcons` | `GlyphIcons.cs:31` (`TryRender` :83, font probe/cache :164-230) | Fluent/MDL2 glyph rendering with font fallback. Currently ribbon only; usable for in-window icons. |
| Dark-pane resource set | `AssistantPane.xaml:15-147`, `WorkPane/WorkPaneView.xaml:26-200` | `FlatButton`, `PrimaryButton`, `MutedText`, `DarkBox`, `ComboRow`, `DarkExpander`, `Card`: the de-facto dark token set |
| View-model-computed brushes | `AssistantPane.xaml.cs:52-257` (`FindingViewRow`, `ChangeRow`, `ChatMessage`) | Colour and visibility computed on the row model, no converters (a pattern to keep) |
| `FindingFeed.SurfaceState`, `StateOf`, `ClaimsClean`, `RankOf` | `FindingFeed.cs:253-338` | **Semantic state taxonomy only.** The file contains no styles or brushes (grep for Brush/Color/Style/FontSize returns 0). |
| SheetNumerator tokens and triggers | `SheetNumeratorWindow.xaml:26-35, 63-110` | Colour plus glyph state styles (`RowStyle`, `StateGlyph`, `StatusLine`); `Converters.cs`; `ObservableObject` |
| `ApplySavedBounds` / `WindowPrefs` / atomic prefs store | `SheetNumeratorWindow.xaml.cs:466-511`, `Prefs.cs:10-19`, `SheetNumeratorPrefsStore.cs` | Only existing window-bounds persistence, atomic write pattern |
| `IconColors`, `RfRibbon`, `SmartRibbon` brushes | `App.cs:480-494`, `RfRibbon.cs:17-21`, `SmartRibbon.cs:17-20` | The ribbon colour palette |
| Prompt dialogs | `TextPromptDialog.cs:12`, `PromptDialog.Ask` (`ChangeImpactWindow.cs:709`) | Two duplicate single-line prompts |
| `UiPump.DoEvents` | `UiPump.cs` | WPF DoEvents for synchronous long jobs |

---

## 7. Constraints and traps for the redesign

- **Tests compile add-in sources by wildcard.**
  - `Smart.UiSmoke` includes `Smart\Ui\*.cs`, `SmartPublish\Ui\*.cs`, `SmartCount\Ui\*.cs`, `ClashCheck\Ui\*.cs`, `ChangeImpact\Ui\*.cs`.
  - `CloneDrawings.UiSmoke` includes **only** `CdJobPaneView.cs`.
  - `Reinforcement.UiSmoke` includes `Reinforcement\Core\*.cs` and `SectionPreview.cs` only, so no Reinforcement dialog is covered by any UiSmoke.
  - `SheetNumerator.UiSmoke` includes `SheetNumerator\Core\*.cs` and `Ui\*.cs`.
  - A new shared folder therefore needs `Compile Include` additions in those csproj files.
  - UiSmoke can emit PNGs (`SMOKE_OUT`) and works as a before/after harness.
- **Tests locate controls by layout constants.**
  - `ImpactSmoke.cs:237,311,324,473` (MinWidth 300, 130, 300, 300).
  - `ClashSmoke.cs:205,318` (MinWidth 320, 180).
  - `CountSmoke.cs:143` (MinWidth 240).
  - SheetNumerator XAML carries 41 `AutomationId`s.
- **Key names used by code-behind** (see §3) must be kept or updated together.
- **R24 (net48) parity:** the shared layer must compile there. WorkPane, FamilyHub, Intelligence and all Smart windows do not exist on R24.
- **Single-file license and device constants** are in `Licensing/`. Nothing in the UI layer should touch them.


---

<!-- slice E: surfaces -->

## UI surface inventory (complete, static analysis, baseline `07934ebb`, add-in 1.13.0)

**Method.** Exhaustive grep over all 322 `.cs` + 10 `.xaml` files in `revit-mcp/addin` (15 folders). Patterns used: `: Window`, `new Window`, `: UserControl`, `IDockablePaneProvider`/`RegisterDockablePane`, `TaskDialog`, `MessageBox`, `OpenFolderDialog`/`*FileDialog`, `ContextMenu`/`Popup`/`MenuItem`, `ToolTip`, `ShowDialog`/`.Show(`/`ShowOwned`, `Pick*`, `Clipboard`, `Process.Start`, ribbon builders, plus `*.csproj` `<Compile Remove>`/`DefineConstants`. All counts are from code, not from comments. Nothing here is an observation of live Revit (appearance, DPI, Revit theme, ribbon label widths are NOT verified).

### 0. Final totals

| Class | Count (R25-R27, all constants on) | Count in R24 build (net48) |
|---|---|---|
| WPF windows (24 `: Window` classes + 1 anonymous `new Window` in `PromptDialog.Ask`, ChangeImpactWindow.cs:711) | **25** (7 XAML, 18 code-built) | 15 |
| of which modal dialogs (`ShowDialog`/`App.ShowOwned`) | **19** | 14 |
| of which modeless (`Show()`) | **6** (ChangeImpact, Clash, SmartCount, SheetNumerator, FamilyHub, PublishProgress+OwnerLock) | 1 (SheetNumerator) |
| OS common dialogs | **1 type** (`Microsoft.Win32.OpenFolderDialog`), 2 call sites | 0 |
| Dockable panes registered (`RegisterDockablePane`: App.cs:202, :220, :237) | **3** (+1 nested `UserControl`, IntelligencePanel) = 4 UserControl types | 2 (Assistant, CdJob) |
| `TaskDialog` call sites | **100** (86 static `Show` + 14 constructed) in 25 files | 82 |
| `MessageBox.Show` call sites | **30** in 12 files | 11 |
| TaskDialog + MessageBox | **130** call sites in 37 files | 93 |
| Revit status-bar selection prompts (`PickObject/PickObjects/PickPoint`) | 12 call sites in 4 files | 12 |
| Ribbon | 1 tab, **7 panels, 23 large buttons** | 6 panels, 17 buttons |
| ContextMenu / Popup (code or XAML) | 1 / 0 (only `SheetNumeratorWindow.xaml:373` RowMenu) | 1 / 0 |

R24 exclusions come from `RevitMcpAddin.csproj` (`Compile Remove` for `Intelligence/**` :177, `FamilyHub/**` :200, `WorkTracking/**`+`WorkPane/**` :213-216, `Smart/**`, `SmartPublish/**`, `SmartCount/**`, `ClashCheck/**`, `ChangeImpact/**` :229-233, and the 4 MCP-executor files :301-304). `Reinforcement`, `CloneDrawings`, `SheetNumerator`, `AutoAnnotate`, `Licensing` compile on every Revit version.

**Legend for the table.** Placement: **SO** = `App.ShowOwned` (HWND owner = Revit main window, forces `CenterOwner` when handle known, `ShowDialog`; App.cs:447-465). **AO** = `SmartWindows.ApplyOwner` + `Show()` (owner only, no `WindowStartupLocation` assigned; Smart/Revit/SmartWindows.cs:47-102). **MO** = manual `WindowInteropHelper.Owner` + `Show()`. **WO** = WPF `Owner = <parent window>` (nested). **OL** = `OwnerLock` (Revit main window disabled via `EnableWindow`, SmartUi.cs:155). Theme: **SYS** = unthemed WPF default controls (plus a few hard-coded accent brushes); **LIGHT** = own hard-coded light palette; **DARK** = own hard-coded dark palette (`#FF2B2B2B` family). No code reads the Revit UI theme (grep for `UIThemeManager|ApplicationTheme|CurrentTheme` = 0 hits; no `App.xaml`, no `ResourceDictionary`/`pack://` use anywhere). Copy: **MN** = Mongolian inline; **MN\*** = Mongolian + English Revit/product terms; **MN/EN** = `Lang.T(mn,en)` pairs; **MIX** = Mongolian labels + English UI strings. Built: **X** = XAML(+code-behind), **C** = code only. `R24✗` = absent from the net48 build.

### 1. Surface table

| Surface | Files | Class | Kind | Opened by | Modal? | Size & min size | Built in | Copy language | Owner/placement approach | Theme approach | Notes for redesign |
|---|---|---|---|---|---|---|---|---|---|---|---|
| **P1 «MGL туслах»** | AssistantPane.xaml (895 L), AssistantPane.xaml.cs (3,539 L), AssistantPaneProvider.cs | `AssistantPane : UserControl` (.xaml.cs:295); `AssistantPaneProvider : IDockablePaneProvider` | dockable pane | ribbon «MGL⏎туслах» → `AssistantPaneCommand` → `pane.Show()` (AssistantPaneProvider.cs:56); registered App.cs:202 | no | `MinWidth=300`, no MinHeight, `DockPosition.Right` | X + code (chat rows via DataTemplate) | MN/EN: 141 `Lang.T` pairs; XAML labels MN only | Revit docking, GUID `6f1a2c74-…`, one static `View` | DARK: 10 brushes + custom FlatButton/DarkCombo/DarkExpander templates | Many in-pane sub-surfaces: header (`MGL туслах`, `Холбогдоогүй`, ⟳), TaskCombo + toggles ▾ / Δ / AI, status line + team chip + `TeamPickHost` («Аль багийн ажил вэ?»), `ChecklistHost`, `ChangesHost`, `IntelligenceHost`, «Норм шалгалт» expander + `FindingOverrideHost`, chat list, `DraftPanel` («ИЛГЭЭХ НООРОГ»), `SuggestPanel` («Аль нь вэ?»), feedback («Зөв ойлгов уу?» 👍 👎 + note row), busy text, input + 🎤 + ➤. 🎤 is inert (`MicBtn_Up` only says «Дуугаар бичих боломж бэлтгэгдэж байна …», .cs:3533-3538) though tooltip says «Дуугаар бичих (удаан дарж хэл)». `SetBusy` sets app-wide `Mouse.OverrideCursor` (.cs:542). Code comment forbids background `Show()/Focus()` of the pane (.cs:694-704). |
| **P2 «MGL ажил»** | WorkPane/WorkPaneView.xaml (352 L), .xaml.cs (1,020 L), WorkPaneProvider.cs, WorkPaneApi.cs, Core/WorkPaneRules.cs | `WorkPaneView : UserControl` (.xaml.cs:40); `WorkPaneProvider` | dockable pane | ribbon «MGL⏎ажил» → `WorkPaneCommand`; `VisibleByDefault = true` (WorkPaneProvider.cs:35); registered App.cs:220 under `#if MGL_WORK_TRACKING` | no | `MinWidth=280`, Right | X + code (outbox rows, completion-question boxes built in code, .cs:748-760, 941-1003) | MN only | Revit docking, GUID `b6c1a3e2-…`, static `View` | DARK: same 10-brush palette re-declared (comment: «Эцэг самбарын resource-оос хамаарахгүйн тулд») | Sections: header (`MGL ажил`, `Нэвтрээгүй`, «Шинэчлэх», «Гарах»), `LoginCard` (3rd login form), `OutboxCard` («ИЛГЭЭГДЭЭГҮЙ ТАЙЛАН»), «ОДООГИЙН АЖИЛ» (`ChoicePanel`, `TaskPanel`), «ЯВЦ БА ТАЙЛАН» (`PercentPanel`/`HoursPanel`, dynamic `QuestionsPanel`), privacy footnote. 6 owner-less `MessageBox`. Opens browser to `/app/my-tasks` (.cs:880). No Start/Pause by design. R24✗ |
| **P3 «MGL — Зураг клонлох» pane** | CloneDrawings/CdJobPaneView.cs (408 L), CdJobHost.cs (provider :429) | `CdJobPaneView : UserControl` (:61); `CdJobPaneProvider` | dockable pane | NO ribbon button. `CdJobHost.ShowPane` (CdJobHost.cs:126) after a job is queued (CloneDrawingsCommand.cs:57,146) and on every job finish (`OnFinished`, :233); registered App.cs:237 | no | no MinWidth, Right, `VisibleByDefault=false` | C only | MN only | Revit docking, GUID `3f3d4d16-…` | DARK: own 12-brush palette in code + custom `ButtonTemplate` | One card per job: title, state word (`Явагдаж байна`/`Түр зогссон`/`Дараалалд`/`Дууссан`/`Цуцалсан`/`Алдаатай зогссон`), %, time, counters, Expander report, 7 action buttons; 3 owner-less `MessageBox` («Клонлолтыг зогсоох уу?», «Бүгдийг буцаах»). Compiled alone by `CloneDrawings.UiSmoke` (must stay Revit-free). |
| **P4 «MGL AI» sub-panel** | Intelligence/Ui/IntelligencePanel.xaml (320 L), .xaml.cs (106 L), IntelligenceViewModels.cs (722 L) | `IntelligencePanel : UserControl` (.xaml.cs:16) | user control nested in P1 | «AI» ToggleButton in P1 (`IntelToggle_Changed`, AssistantPane.xaml.cs:1217), created lazily | no | inherits pane width; no own min | X | MN + EN ("DEV", «DEVELOPMENT / TEST ONLY …», "Apply") | n/a (child of P1) | DARK: `I*` brushes (duplicate palette) | 6 tabs: Контекст · DEV · Даалгавар · Асуудал · Тайлан · AI. DEV tab is unconditional (IntelligencePanel.xaml:173). Disabled placeholders: «Засвар санал», «ERP руу илгээх». R24: replaced by TextBlock «MGL AI (Revit Intelligence) нь Revit 2025+ дээр л байна.» R24✗ |
| **W1 «MGL — Тоо хэмжээ тохиргоо»** | SettingsDialog.xaml, .xaml.cs | `SettingsDialog : Window` (.cs:14) | modal dialog | ribbon «Тохиргоо» (`QtoSettingsCommand`); auto when token/project missing in Qto/Binding/Schedule/PDF commands (e.g. QtoExportCommand.cs:36); 401 retry (:208); nested in W2 (`Owner = this`, QtoProgressWindow.xaml.cs:201) | yes | W460, `SizeToContent=Height`, NoResize | X | MN | SO (declared CenterScreen, overridden to CenterOwner) | SYS | Login (.cs:119-130) and project reload (.cs:158) block the UI thread via `Task.Run(...).GetAwaiter().GetResult()`. 2nd of 3 login forms. Title says «Тоо хэмжээ тохиргоо» but it is the add-in-wide connection settings. |
| **W2 «MGL — Тоо хэмжээ илгээж байна»** | QtoProgressWindow.xaml, .xaml.cs | `QtoProgressWindow : Window` (.cs:35), `FileProgressItem` | modal progress dialog | «Тоо хэмжээ» when >1 runnable file, after TaskDialog confirm (QtoExportCommand.cs:126-128) | yes | W560, `SizeToContent=Height`, MaxHeight 640, NoResize | X | MN | SO; `Closing` cancelled while running | SYS + code-set named brushes (SteelBlue, ForestGreen, Firebrick, DarkOrange) | Whole job runs inside `ContentRendered` (`RunAll`) on the UI thread, repainted with `UiPump.DoEvents`. Opens nested W1 on 401. |
| **W3 «MGL — Хуудас үүсгэх»** | BatchSheetDialog.xaml, .xaml.cs | `BatchSheetDialog : Window` (.cs:50) | modal dialog | ribbon «Хуудас⏎үүсгэх» | yes | 640×720, resizable, no min | X | MN* («Title Block») | SO | SYS (hard-coded `Gray`, `#DDD`) | Params grid with editable combos, live monospace preview; 3 `MessageBox` validation errors; ends with TaskDialog summary. |
| **W4 «MGL — Зураг холбох · ‹төсөл›»** | BindingDialog.xaml, .xaml.cs | `BindingDialog : Window` (.cs:117) | modal dialog | ribbon «Зураг⏎холбох» after handshake (BindingCommand.cs:98) | yes | 1040×680, resizable, no min | X (title overwritten in code, .cs:136) | MN | SO | SYS (`#444`, `#B45309`, `#9CA3AF`) | DataGrid with per-row combos, buttons «Итгэлтэй мөрүүдийг сонгох»/«Бүгд»/«Цэвэрлэх», seed-checklist checkbox; 2 `MessageBox` (success is a MessageBox before `DialogResult`). |
| **W5 «MGL — Хүснэгт сонгох»** | SchedulePickerDialog.xaml, .xaml.cs | `SchedulePickerDialog : Window` (.cs:37) | modal dialog | ribbon «Хүснэгт» | yes | 560×620, resizable, no min | X | MN | SO | SYS | Search + checkbox list; 1 `MessageBox`. |
| **W6 «MGL — Хуулж тавих»** | CopyToOtherCommand.cs (class in command file) | `CopyToOtherDialog : Window` (:284) | modal dialog | ribbon «Хуулж⏎тавих» after `PickObjects` (if no preselection) | yes | W540, `SizeToContent=Height`, NoResize (inner list MaxHeight 170) | C | MN* | SO (declared CenterScreen) | SYS (GroupBoxes, `Opacity` for hints) | Followed by `PickPoint` prompts (O5) and TaskDialogs incl. a Yes/No mismatch dialog (:189). |
| **W7 «MGL — Автомат хэмжээс»** | AutoAnnotate/AutoAnnotateDialog.cs (403 L) | `AutoAnnotateDialog : Window` (:16) | modal dialog | ribbon «Автомат⏎хэмжээс» | yes | 860×640, min 760×560, `CanResizeWithGrip` | C | MN* | SO | SYS + translucent blue note (`Color.FromArgb(24,74,127,165)`) | Plan vs section/elevation checkbox sets with live counts; 1 `MessageBox`; report TaskDialog with `ExpandedContent`. |
| **W8 «MGL — Зураг клонлох: ‹төрөл›»** | CloneDrawings/CloneDrawingsDialog.cs (927 L) | `CloneDrawingsDialog : Window` (:35) | modal dialog | ribbon «Зураг⏎клонлох» after two Revit pick prompts | yes | 1040×760, min 860×580, grip | C | MN | SO | SYS + custom colours | 3 Expander view groups + filter bar with per-type ToggleButtons, target list, annotation-kind section, queue note, preview box; 1 `MessageBox`; hands the job to P3. |
| **W9 «MGL — Арматурын төгсгөлийн тэмдэг»** | Reinforcement/Ui/EndSymbolDialog.cs (333 L), RfUi.cs | `EndSymbolDialog : Window` (:20) | modal dialog | ribbon «Арматурын⏎төгсгөлийн тэмдэг» | yes | `RfUi.Setup` 680×860 min 600×640, then `NoResize`; clamped to work area; content in ScrollViewer | C | MN/EN (`RfText`) | SO | SYS | Live-search symbol picker (`RfSearchBox`); then PickPoint/PickObject loop, Esc = finish. |
| **W10 «MGL — Огтлолын арматурын тэмдэглэгээ»** | Reinforcement/Ui/SectionAnnotationDialog.cs (614 L), SectionPreview.cs | `SectionAnnotationDialog : Window` (:34) | modal dialog | ribbon «Огтлолын арматурын⏎тэмдэглэгээ» after `PickObject` host | yes | `RfUi.Setup` 1100×800 min 980×700, grip, work-area clamp | C | MN/EN | SO | SYS + custom-drawn `SectionPreview` | Two modes: generate, and «Загвар харагдацаас хуулах» (title `RfText.TplTitle`). `SectionPreview.cs` is compiled alone by `Reinforcement.UiSmoke`. |
| **W11 «MGL — Түүвэр хувилах»** | Reinforcement/Ui/ScheduleCloneDialog.cs (365 L), RfScheduleSourcePanel.cs, RfSearchBox.cs | `ScheduleCloneDialog : Window` (:54) | modal dialog | ribbon «Түүвэр⏎хувилах» | yes | `RfUi.Setup` 1000×760 min 860×620 | C | MN/EN | SO | SYS | DataGrid preview; sets wait cursor in `RfScheduleSourcePanel` (:224); 1 static + 1 Yes/No TaskDialog (default No). |
| **W12 «MGL — Түүвэр синк хийх»** | Reinforcement/Ui/ScheduleSyncDialog.cs (250 L) | `ScheduleSyncDialog : Window` (:53) | modal dialog | ribbon «Түүвэр⏎синк хийх» | yes | `RfUi.Setup` 1000×740 min 860×600 | C | MN/EN | SO | SYS | Status grid with delete-tick column; 1 Yes/No TaskDialog (default No). |
| **W13 «MGL — компанийн нэвтрэлт»** | Licensing/LicenseDialog.cs (275 L), LicenseGate.cs | `LicenseDialog : Window` (:23) | modal dialog | ribbon «MGL⏎нэвтрэлт» (`fromTool:false`) AND automatically by `LicenseGate.Ensure()` (LicenseGate.cs:145, `fromTool:true`) at the start of every gated command | yes | W470, `SizeToContent=Height`, NoResize | C (comment: «XAML-гүй») | MN | SO (declared CenterOwner) | SYS + 3 brushes; `Consolas` for device code | 3rd login form; 5 state-dependent buttons; shows «Компьютерын код»; TaskDialog fallback if it cannot open (LicenseGate.cs:151). |
| **W14 «Зургийн хуудасны дугаарлалт»** (no «MGL —» prefix) | SheetNumerator/Ui/SheetNumeratorWindow.xaml (700 L), .xaml.cs (610 L), ViewModel.cs (1,074 L), ViewModel.Settings.cs (792 L), Revit/SheetNumeratorCommand.cs | `SheetNumeratorWindow : Window` (.cs:22) | modeless window, singleton | ribbon «Хуудас⏎дугаарлах» (static `_window`, SheetNumeratorCommand.cs:26) | no | 1180×780, min 960×620; saved bounds restored/clamped to virtual screen (.cs:463-513) | X (MVVM) | MN (central `Msg`) | MO (HWND owner), CenterScreen fallback | LIGHT: own palette, Segoe UI 12 | Stale banner; group TreeView; sheet ListView with drag-drop + `InsertionAdorner`; the only ContextMenu; tabs «Энгийн дугаарлалт»/«Нарийвчилсан тохиргоо»; shortcuts F5, Ctrl+Enter, Alt+↑/↓/Home/End; only file with `AutomationProperties` (41, used by UiSmoke). Prompts via `IUserPrompts` → 3 TaskDialogs + W15. Only window that persists geometry. |
| **W15 TextPromptDialog** (title from caller, e.g. «Хуудасны нэр өөрчлөх») | SheetNumerator/Ui/TextPromptDialog.cs | `TextPromptDialog : Window` (:12) | modal dialog | W14 rename via `RevitUserPrompts.AskText` | yes | W460, `SizeToContent=Height`, NoResize | C | MN («Зөв», «Болих») | WO only if parent `IsLoaded` | SYS + Segoe UI 12 | Near-duplicate of W19. |
| **W16 «Family Hub (POC)»** | FamilyHub/Ui/FamilyHubWindow.xaml (212 L), .xaml.cs (633 L), Revit/FamilyHubCommand.cs | `FamilyHubWindow : Window, IConflictResolver, IPipelineObserver` (.cs:96) | modeless window, singleton | ribbon «Family⏎Hub» (static `_window`) | no | 1100×760, min 640×480 | X | MIX: MN + EN ("PLACE", "Search families...", «SAME NAME — DIFFERENT FAMILY», "Use existing", "Cancel", "Family loaded", "Available Types:") | MO, CenterOwner declared | LIGHT: Background `#F7F8FA`, Segoe UI 12 | Tabs «BIMobject» (WebView2 with ◀ ▶ ⟳ ⌂ + URL box) and «Нийтийн сан» (search + result cards). Conflict and loaded-types are inline panels, not windows. WebView2 package pinned to Revit's version. R24✗ |
| **W17 «MGL — Өөрчлөлтийн нөлөө · ‹doc›»** | ChangeImpact/Ui/ChangeImpactWindow.cs (770 L) | `ChangeImpactWindow : Window` (:32) | modeless window (one per type per document identity) | ribbon «Өөрчлөлтийн⏎нөлөө» → `SmartWindows.ShowModeless` | no | 1320×820, min 1000×620 (no work-area clamp) | C | MN* | AO (no startup location) | SYS + `UiKit` severity brushes, LightGray | 10 s DispatcherTimer; 2 DataGrids; confidence chips A-D; clipboard copy (:691); 2 `MessageBox`; opens W18, W19. R24✗ |
| **W18 «Шинжилгээний түүх»** | ChangeImpactWindow.cs (:736) | `ImpactHistoryDialog : Window` | modal dialog | W17 «Түүх…» (:432) | yes | 760×520, resizable | C | MN | WO CenterOwner | SYS | Read-only (2 ListBoxes). R24✗ |
| **W19 «Шалгах цэг тавих»** (anonymous `new Window`) | ChangeImpactWindow.cs:707-731 (`PromptDialog.Ask`) | anonymous `Window` | modal dialog | W17 «Шалгах цэг тавих…» (:382) | yes | W480, `SizeToContent=Height`, NoResize | C | MN | WO CenterOwner | SYS | Duplicate of W15. R24✗ |
| **W20 «MGL — Clash шалгах · ‹doc›»** | ClashCheck/Ui/ClashWindow.cs (928 L) | `ClashWindow : Window` (:33) | modeless window | ribbon «Clash⏎шалгах» → `ShowModeless` | no | 1240×800, min 960×600 | C | MN* | AO | SYS + `UiKit` brushes | Rule bar, status chips (Шинэ/Хянасан/Зөвшөөрсөн/Шийдэгдсэн), filters, DataGrid (3000-row cap), detail + history pane; 8 code tooltips; 2 `MessageBox`; opens W21. R24✗ |
| **W21 «Шинэ clash дүрэм» / «Clash дүрэм засах»** | ClashCheck/Ui/ClashRuleDialog.cs (274 L) | `ClashRuleDialog : Window` (:21) | modal dialog | W20 «Шинэ/Засах/Хуулах» (:359) | yes | 900×780, min 700×520 | C | MN* | WO CenterOwner | SYS | Two nested `SelectorEditor`s («A тал», «B тал»); a disabled mode item «Зай (clearance) — ДЭМЖИГДЭХГҮЙ». R24✗ |
| **W22 «MGL — Smart Count · ‹doc›»** | SmartCount/Ui/SmartCountWindow.cs (680 L) | `SmartCountWindow : Window` (:24) | modeless window | ribbon «Smart⏎Count» → `ShowModeless` | no | 1180×780, min 900×560 | C | MN* (unit codes mm/cm/m2… in EN) | AO | SYS | Saved-query combo, scope, category filter list, nested AND/OR condition builder, TreeView + DataGrid; clipboard TSV (:662); 2 `MessageBox`. R24✗ |
| **W23 «MGL — Smart Publish · ‹doc›»** | SmartPublish/Ui/PublishDialog.cs (811 L) | `PublishDialog : Window` (:121) | modal dialog, re-opened in a `while(true)` loop by the command (SmartPublishCommand.cs:57-60) | ribbon «Smart⏎Publish» | yes | 1180×780, min 900×560 | C | MN* | SO (CenterOwner declared); NO `ShowInTaskbar` assignment (WPF default) | SYS | Tabs «Урьдчилан харах»/«Preflight»/«Түүх» (4 DataGrids), profile bar, folder row + O4, Explorer launch (:773); 4 `MessageBox`; opens W24. R24✗ |
| **W24 «Гаргалтын профайл»** | SmartPublish/Ui/ProfileEditorDialog.cs (481 L) | `ProfileEditorDialog : Window` (:18) | modal dialog | W23 «Засах…»/«Шинэ…» | yes | 780×700, min 640×520 | C | MN* (many EN terms: "Scope box", "Halftone", "XRef", "Base quantities") | WO CenterOwner; NO `ShowInTaskbar` assignment | SYS | 6 tabs: «Ерөнхий», «Нэршил, хавтас», «PDF», «DWG · IFC», «Сонголт», «Preflight»; 3 `MessageBox`; folder picker (:157). R24✗ |
| **W25 «MGL — Гаргаж байна» / «MGL — Өөрчлөлт шинжилж байна»** | SmartPublish/Ui/PublishProgressWindow.cs | `PublishProgressWindow : Window, IProgress<JobProgress>` (:18) | modeless `Show()` made effectively modal with `OwnerLock` + `UiPump.DoEvents` | `SmartPublishCommand.RunPublish` (:107-114) and `PublishImpactAnalysis` (:41-46) | effectively yes | 480×190, NoResize | C | MN | MO CenterOwner | SYS | `Closing` is cancelled and turned into a cancel request. R24✗ |
| **O1 Ribbon** tab «MGL» (env `MGL_RIBBON_TAB`) | App.cs (`CreateRibbon` :553-860, `MakeButton` :513), Reinforcement/RfRibbon.cs, Smart/Revit/SmartRibbon.cs, GlyphIcons.cs | 23 × `PushButtonData` built by 3 duplicated helpers | ribbon | Revit startup | n/a | LargeImage 32 + Image 16, rendered at runtime from Segoe Fluent Icons / Segoe MDL2 Assets (null icon if font missing) | C | MN | panels left→right: «Ажлын явц», «Сайт руу илгээх», «Загвар», «Smart», «Арматур», «Түүвэр», «Тохиргоо» | per-button glyph brush (mid-tones) | All large `AddItem` buttons (zero stacked/split/pulldown). Each has ToolTip + multi-paragraph LongDescription + availability class; NAME strings must stay stable (QAT). Labels use `\n`; longest lines «Огтлолын арматурын» (18 ch), «төгсгөлийн тэмдэг» (17 ch). R24: 17 buttons / 6 panels. |
| **O2 TaskDialog** | 25 files (section 2) | `Autodesk.Revit.UI.TaskDialog` | TaskDialog | nearly every command; `RevitUserPrompts` (SheetNumerator VM, ≥12 call sites → 3 dialogs); App.cs:209,271 startup failures; `CdJobHost.OnFinished` fallback; LicenseGate.cs:151 | Revit-modal | Revit-controlled | C | MN; Reinforcement MN/EN; titles «MGL — …» via per-command `DialogTitle` consts | none (Revit) | Revit-native | 86 static `Show(title, text)` (API puts text in the `mainInstruction` slot) + 14 constructed: 8 Yes/No, 2 command-link dialogs (EndSymbolCommands.cs:228-229, CloneDrawingsCommand.cs:280-282), 4 report/info (3 use `ExpandedContent`, 2 use `MainIcon`). A 9th Yes/No is a static call (CopyToOtherCommand.cs:189). |
| **O3 MessageBox** | 12 files (section 2) | `System.Windows.MessageBox` | message box | WPF windows and panes | yes | OS | C | MN (titles «MGL», «MGL — алдаа», «MGL ажил», window `Title`) | 21 owned (`this`), 9 owner-less (WorkPaneView 6, CdJobPaneView 3) | OS | 17 are Yes/No confirmations, rest are OK warnings/info. |
| **O4 Folder picker** | Smart/Ui/SmartUi.cs:257-272 (`FolderPicker`) | `Microsoft.Win32.OpenFolderDialog` | OS dialog | W23 «Хавтас…» (PublishDialog.cs:283), W24 (ProfileEditorDialog.cs:157); title «Гаргах үндсэн хавтас» | yes | OS | C | MN | WO (owner window) | OS | Only OS dialog in the add-in (no Open/Save file dialogs). R24✗ |
| **O5 Revit selection prompts** | CopyToOtherCommand.cs (7), Reinforcement/EndSymbolCommands.cs (2), SectionAnnotationCommand.cs (1), CloneDrawings/CloneDrawingsCommand.cs (2) | `Selection.PickObject/PickObjects/PickPoint` | Revit status-bar prompt | commands 9, 10, 17, 18 | Revit-modal | n/a | C | MN (CopyTo/CloneDrawings inline; Reinforcement via `RfText.Pick*Prompt`, MN/EN) | n/a | Revit-native | 12 call sites; prompts are long sentences with «Finish»/Esc instructions. |
| **O6 Clipboard and external launches** | ChangeImpactWindow.cs:691, SmartCountWindow.cs:662; WorkPaneView.xaml.cs:880, PublishDialog.cs:773 | `Clipboard.SetText`, `Process.Start` | side-effect | W17/W22 buttons; P2 «Вэб дээр нээх»; W23 «Хавтас нээх» | n/a | n/a | C | MN | n/a | n/a | Browser to `/app/my-tasks`; `explorer.exe`. |
| **O7 Add-in manifest** | RevitMcpAddin.addin | `<Name>Revit MCP</Name>`, `<VendorDescription>Revit MCP HTTP bridge (localhost code executor)</VendorDescription>` | Revit-owned text | Revit load / Add-In Security (documented Revit behaviour, not observed) | n/a | n/a | XML | EN, non-MGL brand | n/a | n/a | Brand string differs from the «MGL» ribbon/titles. |

### 2. Counts by file: TaskDialog and MessageBox call sites

| File | `TaskDialog.Show` | `new TaskDialog` | `MessageBox.Show` | Total | In R24? |
|---|---|---|---|---|---|
| QtoExportCommand.cs | 8 | 2 | 0 | 10 | yes |
| SmartPublish/Revit/SmartPublishCommand.cs | 6 | 2 | 0 | 8 | no |
| Reinforcement/EndSymbolCommands.cs | 6 | 1 | 0 | 7 | yes |
| Reinforcement/SectionAnnotationCommand.cs | 7 | 0 | 0 | 7 | yes |
| AutoAnnotate/AutoAnnotateCommand.cs | 5 | 1 | 0 | 6 | yes |
| BindingCommand.cs | 6 | 0 | 0 | 6 | yes |
| CloneDrawings/CloneDrawingsCommand.cs | 5 | 1 | 0 | 6 | yes |
| PdfViewExportCommand.cs | 5 | 1 | 0 | 6 | yes |
| Reinforcement/ScheduleCloneCommands.cs | 6 | 0 | 0 | 6 | yes |
| ScheduleExportCommand.cs | 6 | 0 | 0 | 6 | yes |
| WorkPane/WorkPaneView.xaml.cs | 0 | 0 | 6 | 6 | no |
| CopyToOtherCommand.cs | 5 | 0 | 0 | 5 | yes |
| SmartPublish/Ui/PublishDialog.cs | 0 | 0 | 4 | 4 | no |
| ChangeImpact/Revit/ChangeImpactCommand.cs | 3 | 0 | 0 | 3 | no |
| ClashCheck/Revit/ClashCheckCommand.cs | 3 | 0 | 0 | 3 | no |
| SmartCount/Revit/SmartCountCommand.cs | 3 | 0 | 0 | 3 | no |
| SheetNumerator/Revit/RevitUserPrompts.cs | 0 | 3 | 0 | 3 | yes |
| BatchSheetDialog.xaml.cs | 0 | 0 | 3 | 3 | yes |
| CloneDrawings/CdJobPaneView.cs | 0 | 0 | 3 | 3 | yes |
| SmartPublish/Ui/ProfileEditorDialog.cs | 0 | 0 | 3 | 3 | no |
| App.cs | 2 | 0 | 0 | 2 | yes |
| BatchSheetCommand.cs | 2 | 0 | 0 | 2 | yes |
| Reinforcement/RfGuard.cs | 1 | 1 | 0 | 2 | yes |
| Reinforcement/Ui/ScheduleCloneDialog.cs | 1 | 1 | 0 | 2 | yes |
| SheetNumerator/Revit/SheetNumeratorCommand.cs | 2 | 0 | 0 | 2 | yes |
| BindingDialog.xaml.cs | 0 | 0 | 2 | 2 | yes |
| ChangeImpact/Ui/ChangeImpactWindow.cs | 0 | 0 | 2 | 2 | no |
| ClashCheck/Ui/ClashWindow.cs | 0 | 0 | 2 | 2 | no |
| SmartCount/Ui/SmartCountWindow.cs | 0 | 0 | 2 | 2 | no |
| AssistantPaneProvider.cs | 1 | 0 | 0 | 1 | yes |
| CloneDrawings/CdJobHost.cs | 1 | 0 | 0 | 1 | yes |
| Licensing/LicenseGate.cs | 1 | 0 | 0 | 1 | yes |
| Reinforcement/Ui/ScheduleSyncDialog.cs | 0 | 1 | 0 | 1 | yes |
| WorkPane/WorkPaneProvider.cs | 1 | 0 | 0 | 1 | no |
| AutoAnnotate/AutoAnnotateDialog.cs | 0 | 0 | 1 | 1 | yes |
| CloneDrawings/CloneDrawingsDialog.cs | 0 | 0 | 1 | 1 | yes |
| SchedulePickerDialog.xaml.cs | 0 | 0 | 1 | 1 | yes |
| **Total (37 files)** | **86** | **14** | **30** | **130** | 93 in R24 |

(Counts exclude comment-only mentions, e.g. BatchQto.cs:21, App.cs:50, RevitTools.cs:433, ChangeReport.cs:40.)

### 3. Ribbon button map (the «Opened by» cross-reference)

| # | Panel | Button NAME | Label (⏎ = line break) | Command class (`RevitMcpAddin.`) | Availability class | Surfaces reached | R24 |
|---|---|---|---|---|---|---|---|
| 1 | Ажлын явц | MglWorkPane | MGL⏎ажил | WorkPane.WorkPaneCommand | WorkPane.WorkPaneAvailability (always on) | P2 | ✗ |
| 2 | Ажлын явц | MglAssistantPane | MGL⏎туслах | AssistantPaneCommand | ProgressCommandAvailability | P1 → P4 | ✓ |
| 3 | Ажлын явц | MglRevitBinding | Зураг⏎холбох | BindingCommand | ProgressCommandAvailability | [W1] · TaskDialogs · W4 · MessageBox | ✓ |
| 4 | Сайт руу илгээх | MglQtoExport | Тоо⏎хэмжээ | QtoExportCommand | QtoCommandAvailability | [W1] · confirm TaskDialog · W2 (+W1) or result TaskDialog | ✓ |
| 5 | Сайт руу илгээх | MglPdfExport | PDF | PdfViewExportCommand | PdfViewAvailability | [W1] · confirm + result TaskDialogs | ✓ |
| 6 | Сайт руу илгээх | MglScheduleExport | Хүснэгт | ScheduleExportCommand | QtoCommandAvailability | [W1] · W5 · result TaskDialog | ✓ |
| 7 | Загвар | MglBatchSheets | Хуудас⏎үүсгэх | BatchSheetCommand | QtoCommandAvailability | W3 · summary TaskDialog | ✓ |
| 8 | Загвар | MglSheetNumerator | Хуудас⏎дугаарлах | SheetNumerator.SheetNumeratorCommand | QtoCommandAvailability | W14 · W15 · 3 prompt TaskDialogs | ✓ |
| 9 | Загвар | MglCopyToOther | Хуулж⏎тавих | CopyToOtherCommand | QtoCommandAvailability | O5 · W6 · TaskDialogs | ✓ |
| 10 | Загвар | MglCloneDrawings | Зураг⏎клонлох | CloneDrawings.CloneDrawingsCommand | QtoCommandAvailability | O5 ×2 · W8 · P3 / TaskDialog | ✓ |
| 11 | Загвар | MglAutoAnnotate | Автомат⏎хэмжээс | AutoAnnotate.AutoAnnotateCommand | AutoAnnotate.AutoAnnotateAvailability | W7 · TaskDialogs | ✓ |
| 12 | Загвар | MglFamilyHub | Family⏎Hub | FamilyHub.Revit.FamilyHubCommand | QtoCommandAvailability | W16 | ✗ |
| 13 | Smart | MglSmartImpact | Өөрчлөлтийн⏎нөлөө | ChangeImpact.ChangeImpactCommand | QtoCommandAvailability | W17 (+W18, W19) | ✗ |
| 14 | Smart | MglSmartCount | Smart⏎Count | SmartCount.SmartCountCommand | QtoCommandAvailability | W22 | ✗ |
| 15 | Smart | MglSmartClash | Clash⏎шалгах | ClashCheck.ClashCheckCommand | QtoCommandAvailability | W20 (+W21) | ✗ |
| 16 | Smart | MglSmartPublish | Smart⏎Publish | SmartPublish.SmartPublishCommand | QtoCommandAvailability | W23 loop (+W24, O4) · W25 · TaskDialogs | ✗ |
| 17 | Арматур | MglRebarEndSymbol | Арматурын⏎төгсгөлийн тэмдэг | Reinforcement.RebarEndSymbolCommand | Reinforcement.RfViewAvailability | W9 · O5 loop · report TaskDialog | ✓ |
| 18 | Арматур | MglRebarSectionAnnotation | Огтлолын арматурын⏎тэмдэглэгээ | Reinforcement.SectionAnnotationCommand | RfViewAvailability | O5 · W10 · TaskDialogs | ✓ |
| 19 | Арматур | MglRebarRefresh | Тэмдэглэгээ⏎шинэчлэх | Reinforcement.RefreshAnnotationsCommand | RfViewAvailability | command-link TaskDialog · report TaskDialog | ✓ |
| 20 | Түүвэр | MglScheduleClone | Түүвэр⏎хувилах | Reinforcement.ScheduleCloneCommand | QtoCommandAvailability | W11 · TaskDialogs | ✓ |
| 21 | Түүвэр | MglScheduleSync | Түүвэр⏎синк хийх | Reinforcement.ScheduleSyncCommand | QtoCommandAvailability | W12 · TaskDialogs | ✓ |
| 22 | Тохиргоо | MglLicense | MGL⏎нэвтрэлт | Licensing.LicenseCommand | Licensing.LicenseAvailability (always on) | W13 | ✓ |
| 23 | Тохиргоо | MglQtoSettings | Тохиргоо | QtoSettingsCommand | none (always on) | W1 | ✓ |

Gating: 21 of 23 commands call `LicenseGate.Ensure()` (16 directly, 5 via `RfGuard.Begin`, RfGuard.cs:21); only `LicenseCommand` and `QtoSettingsCommand` do not. An invalid license therefore pops W13 on top of any command.

### 4. Easy-to-skip secondary surfaces (every small prompt / editor / progress / hidden surface)

1. **W1 SettingsDialog** is reachable 7 ways (own button, 4 commands' missing-token path, 401 retry, nested inside W2), not only from «Тохиргоо».
2. **W13 LicenseDialog** auto-opens from `LicenseGate.Ensure()` before any gated command; users never press its button in the common path.
3. **W15 TextPromptDialog** (SheetNumerator rename) and **W19 PromptDialog** (checkpoint label): two near-identical one-field dialogs.
4. **W18 ImpactHistoryDialog**: read-only two-list history.
5. **W21 ClashRuleDialog** with two nested `SelectorEditor` blocks.
6. **W24 ProfileEditorDialog**: 6-tab editor behind PublishDialog's «Засах…»/«Шинэ…»; no `ShowInTaskbar` assignment (also none on W23).
7. **W25 PublishProgressWindow**: used twice (publish; impact analysis) with different titles/verbs; relies on `OwnerLock` + `UiPump`.
8. **W2 QtoProgressWindow**: progress UI of a synchronous job running inside `ContentRendered`.
9. **W5 SchedulePickerDialog**: search + checkbox list.
10. **O4 FolderPicker** (`OpenFolderDialog`), 2 call sites.
11. **TaskDialog command-link dialogs**: «Тэмдэглэгээ шинэчлэх» ask (EndSymbolCommands.cs:221-232) and clone report with «Эхний шинэ хуудсыг нээх»/«Эхний шинэ харагдацыг нээх» (CloneDrawingsCommand.cs:270-283).
12. **Yes/No TaskDialogs with default No** (SmartPublishCommand.cs:222,264; ScheduleCloneDialog.cs:331; ScheduleSyncDialog.cs:237) and the rotate-mismatch dialog (CopyToOtherCommand.cs:189).
13. **`RevitUserPrompts`**: 3 constructed TaskDialogs serving ≥12 ViewModel call sites (Confirm/ShowError with `ExpandedContent`/ShowInfo).
14. **`RfGuard.ShowReport`** report dialog with `ExpandedContent` (first 25 lines) used by all Reinforcement commands.
15. **P1 inline editors**: `TeamPickHost`, `FindingOverrideHost` (combo + reason + «Болих»/«Хаах»), feedback note row (`FeedbackNoteRow`: «Юу нь буруу байсан бэ?  (заавал биш)»), `SuggestPanel`, `DraftPanel` with confirm checkbox «Би энэ тайланг уншиж, зөв гэдгийг баталж байна».
16. **P1 `ChangesHost` («Δ»), `ChecklistHost` («▾»)**, and the 🎤 control that only answers «… бэлтгэгдэж байна».
17. **P2 inline cards**: `LoginCard`, `OutboxCard` (retry/«Устгах» buttons built in code with owner-less MessageBox), `ChoicePanel`, dynamic `QuestionsPanel`, `HoursPanel` («Өнөөдөр ажилласан»).
18. **P3 job cards**: pause/resume/cancel/undo/open/dismiss buttons and a collapsible report.
19. **P4 DEV tab** (always visible, English) and disabled «Засвар санал» / «ERP руу илгээх».
20. **W16 inline panels**: conflict panel, loaded-types panel, WebView2 init/retry overlay («Хөтөч эхэлж байна…», «Дахин оролдох»), «PLACE» buttons.
21. **W10 template-copy mode** and the custom-drawn `SectionPreview` (`FrameworkElement`).
22. **Shared custom controls**: `RfSearchBox`, `RfScheduleSourcePanel` (Reinforcement), `InsertionAdorner` (SheetNumerator).
23. **W14 context menu** `RowMenu` (rename, delete, move ×4), stale `Banner`, per-field error tooltips (38 XAML tooltips), settings-error list.
24. **Tooltips**: 23 ribbon ToolTip+LongDescription pairs; 67 XAML `ToolTip=` attributes; 24 code-set tooltips in 7 files.
25. **Revit status-bar prompts (O5)**, 12 call sites, with embedded instructions («Finish», Esc).
26. **Clipboard and launches (O6)**: TSV copy in W17/W22; browser (`/app/my-tasks`); Explorer.
27. **Startup failure TaskDialogs** (App.cs:209 pane registration, :271 ribbon creation) and `CdJobHost.OnFinished` fallback TaskDialog (CdJobHost.cs:238).
28. **Add-in manifest text (O7)**: «Revit MCP» name/vendor description.
29. **Wait/busy cursors**: `Mouse.OverrideCursor` in P1 `SetBusy` (.cs:542) and `RfScheduleSourcePanel.cs:224-234`.
30. **Adjacent, outside `addin/`**: installer `revit-mcp/installer/install-all.ps1:52-54` uses a WinForms `MessageBox`; IExpress `FriendlyName=MGL Revit 2027 Setup <version>` (build-installer.ps1:210).

### 5. Cross-cutting facts verified in code (evidence)

| Fact | Evidence |
|---|---|
| Language is a global static switched by chat input | Lang.cs:27 `public static UiLang Current { get; set; } = UiLang.Mn;` · Lang.cs:95 `public static void Observe(string userText)` · AssistantPane.xaml.cs:1875 `Lang.Observe(text);` (only caller) |
| Only P1 and Reinforcement have English strings; other surfaces hard-code Mongolian | 141 `Lang.T(` in AssistantPane.xaml.cs; ~250 `T("mn","en")` in Reinforcement/RfText.cs:19; SheetNumerator `Msg` (Text.cs:12) is Mongolian-only |
| Three separate credential forms | SettingsDialog.xaml:36 `Content="Нэвтрэх"`; WorkPane/WorkPaneView.xaml:226 `x:Name="LoginCard"`; Licensing/LicenseDialog.cs:44-45 `_user`/`_pass` |
| Modal owner/placement helper | App.cs:447 `internal static bool? ShowOwned(System.Windows.Window window, IntPtr owner)` · App.cs:454 `new System.Windows.Interop.WindowInteropHelper(window).Owner = MainWindowHandle;` · App.cs:464 `return window.ShowDialog();` |
| Modeless helper differs (owner only) | Smart/Revit/SmartWindows.cs:47 `internal static T ShowModeless<T>(string documentId, Func<T> factory) where T : Window` |
| Only Reinforcement clamps windows to the work area | Reinforcement/Ui/RfUi.cs:75 `double waH = SystemParameters.WorkArea.Height, waW = SystemParameters.WorkArea.Width;` (e.g. ChangeImpactWindow.cs:112-115 `Width = 1320; Height = 820;` unclamped) |
| Only SheetNumerator persists window geometry | SheetNumerator/Ui/SheetNumeratorWindow.xaml.cs:493-513 (`OnClosing` writes `WindowPrefs`) |
| `ShowInTaskbar` unset on W23/W24 only (23 of 25 set false) | grep: 0 hits in PublishDialog.cs and ProfileEditorDialog.cs |
| No theme detection, no shared resources | 0 hits for `UIThemeManager`, `MergedDictionaries`, `pack://`, `App.xaml` |
| Dark palette re-declared 4 times | AssistantPane.xaml:17-26, WorkPane/WorkPaneView.xaml:27-36, Intelligence/Ui/IntelligencePanel.xaml:22-29 (`I*`), CloneDrawings/CdJobPaneView.cs:~72-83 |
| ≥5 independent code-built UI kits | `UiKit` (Smart/Ui/SmartUi.cs:15), `RfUi` (Reinforcement/Ui/RfUi.cs), inline helpers in CopyToOtherCommand.cs:425-445, CloneDrawingsDialog.cs:891-927, AutoAnnotateDialog.cs, LicenseDialog.cs |
| Ribbon builder duplicated 3× | App.cs:513 `MakeButton`, Reinforcement/RfRibbon.cs:124 `Button`, Smart/Revit/SmartRibbon.cs:117 `Button` |
| Ribbon icons from font glyphs | GlyphIcons.cs: `FontNames = { "Segoe Fluent Icons", "Segoe MDL2 Assets" }`; returns null when font missing |
| Smart UI kit lives in a folder excluded from R24 | csproj :229-233 `<Compile Remove="Smart/**" />` while `UiKit`/`OwnerLock`/`FolderPicker` are in Smart/Ui/SmartUi.cs |
| UiSmoke projects compile UI files in isolation | tests/CloneDrawings.UiSmoke/*.csproj:32 (`CdJobPaneView.cs`); Reinforcement.UiSmoke:25 (`SectionPreview.cs` only); SheetNumerator.UiSmoke:35-36 (`Ui\*.cs` + XAML); Smart.UiSmoke:33-41 (`Smart/SmartPublish/SmartCount/ClashCheck/ChangeImpact` `Ui\*.cs`) |
| UI-thread-blocking login | SettingsDialog.xaml.cs:130 `}).GetAwaiter().GetResult();` and :158 |
| Inert / placeholder controls | AssistantPane.xaml.cs:3533-3538; IntelligencePanel.xaml:118 (`IsEnabled="False"`), :257, :173 (DEV tab); ClashRuleDialog.cs:85 (disabled clearance item) |
| Window titles are inconsistent | with «MGL — » prefix: 18 windows; without: W14 «Зургийн хуудасны дугаарлалт», W16 «Family Hub (POC)», W18, W21, W24 and caller-supplied W15/W19 |

**Not established (needs live Revit):** actual look on Revit's light/dark UI, DPI scaling, whether 1320×820 / 1180×780 windows overflow 1366×768 work areas (constants only), ribbon collapse behaviour with the long «Арматур» labels, Add-In Security prompt wording, WebView2 behaviour, and whether PublishDialog/ProfileEditorDialog actually show in the taskbar.


---

<!-- slice F: engines-drawing -->

# Behaviour truth-table — drawing / model-editing tools (static read, baseline `07934ebb`, add-in 1.13.0)

**Method.** Static reading only; nothing was run in Revit, so nothing below is an observation of live Revit behaviour. Executable code is authoritative; comments and ribbon text were treated as claims to verify. Every claim cites `path:line` (paths relative to `revit-mcp/addin/`). Mongolian UI strings are quoted verbatim.

**Legend.** `CTC` = `CopyToOtherCommand.cs`, `CTE` = `CopyToOtherEngine.cs`, `APP` = `App.cs`, `RFR` = `Reinforcement/RfRibbon.cs`, `RFT` = `Reinforcement/RfText.cs`, `CDC` = `CloneDrawings/CloneDrawingsCommand.cs`, `CDJ` = `CloneDrawings/CdJob.cs`, `CDH` = `CloneDrawings/CdJobHost.cs`, `CDE` = `CloneDrawings/CdEngine.cs`, `CDA` = `CloneDrawings/CdAnalysis.cs`, `CDM` = `CloneDrawings/CdModel.cs`, `CDD` = `CloneDrawings/CloneDrawingsDialog.cs`, `AAR` = `AutoAnnotate/AaRunner.cs`, `ESC` = `Reinforcement/EndSymbolCommands.cs`, `ESS` = `Reinforcement/Revit/EndSymbolService.cs`, `RSS` = `Reinforcement/Revit/RfSectionService.cs`, `RSR` = `Reinforcement/Revit/RfSectionRenderer.cs`, `RTS` = `Reinforcement/Revit/RfTemplateService.cs`, `SAC` = `Reinforcement/SectionAnnotationCommand.cs`, `RSE` = `Reinforcement/Revit/RfScheduleSession.cs`, `SNA` = `SheetNumerator/Revit/RenumberApplyService.cs`, `SNV` = `SheetNumerator/Ui/SheetNumeratorViewModel.cs`.

**Build matrix fact.** None of the tools in this slice is excluded from R24 (net48): the csproj removes only Intelligence, FamilyHub, WorkTracking/WorkPane, Smart*, ClashCheck, ChangeImpact and the MCP executor (`RevitMcpAddin.csproj:176-233,300-304`). The only `#if` in these tools is `SheetNumerator/Revit/SheetCollectionCompat.cs:26,43,55` (`NET8_0_OR_GREATER` = Revit 2025+).

---

## X1. Undo / atomicity matrix (where the brief's «atomic» / «one Ctrl+Z» is true or false)

| Tool (ribbon button) | Revit structure | Ctrl+Z steps for one run | All-or-nothing? | «one Ctrl+Z» | «atomic» |
|---|---|---|---|---|---|
| Хуулж тавих | `TransactionGroup` "MGL: Хуулж тавих" (`CTC:104`) around **one Transaction per placement** (`CTC:227`), each with SubTransactions per view/tag/dim/detail/sheet; `Assimilate` only if `report.Targets > 0`, else `RollBack` (`CTC:119-122`) | 1 | **No.** A placement that throws rolls back only itself (`CTC:238-244`); earlier placements stay; item-level skips inside a placement are normal | TRUE (when ≥1 placement counted) | **FALSE** |
| Зураг клонлох — background (default) | **One Transaction per step**, no group (`CDJ:721-768`); steps = view, annotate slice/element, sheet, finish, per target | N (one per step); a user Ctrl+Z pauses the job (`CDJ:916-922`) | **No** | **FALSE** | **FALSE** |
| Зураг клонлох — sync fallback (only if `CdJobHost` failed to init) | `CdRunner.Run`: one `TransactionGroup` + per-step Transactions (`CloneDrawings/CdRunner.cs:22-30`); used when `!CdJobHost.IsReady` (`CDC:142-158`) | 1 | No (steps independent) | TRUE (fallback only) | FALSE |
| Автомат хэмжээс | One `TransactionGroup`, 3 Transactions: delete previous → create → write registry (`AAR:158-267`); `Assimilate` if `Created>0 \|\| PreviousRemoved>0 \|\| GridsExtended>0` (`AAR:263`) | 1 | **No.** The delete commits *before* creation; if creation fails the deletion stays and the group is still assimilated | TRUE | **FALSE** («replace» is delete-then-create) |
| Арматурын төгсгөлийн тэмдэг — **preselected rebars** | `Place` = one `TransactionGroup` + one Transaction for all rebars (`ESS:235-285`) | 1 | Commit or rollback as a whole, but per-rebar failures are recorded and skipped inside (`ESS:450-464`) so partial across rebars; `RfMarkerNotDetectableException` aborts all (`ESS:462`) | TRUE | partial |
| Арматурын төгсгөлийн тэмдэг — **pick loop** (nothing preselected) | `Place` is called **once per click** (`ESC:163`) → one `TransactionGroup` per click | **1 per click** (`RFT:453` `CtrlzPerPick`) | per click | **FALSE** | per click only |
| Огтлолын арматурын тэмдэглэгээ (generate) | `TransactionGroup` + one Transaction + SubTransactions per chain/tag (`RSS:259-435`); commit only if ≥1 element created (`RSS:318-321`) | 1 | **No** (chains can be incomplete, tags skipped) but "nothing created ⇒ nothing changes" | TRUE | partial |
| «Загвараас хуулах» (template copy, inside the section dialog) | `TransactionGroup` + one Transaction (`RTS:236-286`); commit only if `rep.Made > 0` | 1 | No (item skips) | TRUE | partial |
| Тэмдэглэгээ шинэчлэх | Outer `TransactionGroup` (`ESC:243-259`) wrapping the end-symbol refresh group and one group per section set; assimilate only if something changed | 1 | No | TRUE | partial |
| Түүвэр хувилах | `TransactionGroup` + one Transaction, SubTransaction per item (`RSE:338-396`); assimilate iff `Created+Updated+Replaced>0` | 1 | **Replace is atomic per item** (`RSE:540-569`); the run is not | TRUE | per item only |
| Түүвэр синк хийх — «Дутууг үүсгэх»/«Шүүлтүүр засах» | same `Execute` as above | 1 each | same | TRUE | per item only |
| Түүвэр синк хийх — «Сонгосныг устгах» | one Transaction, per-item try/catch, commit if `n>0` (`RSE:576-608`) | 1 | **No** (failed items are skipped) | TRUE | FALSE |
| Хуудас дугаарлах — «Хэрэгжүүлэх» | `TransactionGroup` = Transaction A (temp numbers `MGLTMP_<guid>_<i>`) + Transaction B (final numbers, names, parameters) + read-back verify; any error → `tg.RollBack()` + verify original (`SNA:139-306`) | 1 | **Yes** (rollback verified; the outcome `RollbackUnverified` exists and tells the user to check/Ctrl+Z, `SheetNumerator/Core/Text.cs:199-200`) | TRUE | **TRUE** (for Apply only) |
| Хуудас дугаарлах — right-click «Хуудасны нэр өөрчлөх» / «Хуудас устгах» | each its **own immediate Transaction** (`SheetNumerator/Revit/SheetEditService.cs:48,108`), outside Apply | 1 each | n/a | not part of Apply | not part of Apply |
| Хуудас үүсгэх | One Transaction, no group, per-sheet try/catch (`BatchSheetCommand.cs:95-174`) | 1 | **No** (duplicates/failed numbers skipped; a sheet whose name/parameters failed is kept, `:158-161`) | TRUE | **FALSE** |
| Зураг холбох | `TransactionMode.ReadOnly` (`BindingCommand.cs:20`); writes to the MGL server, not the model | 0 | n/a | n/a (no model change) | n/a |

**Compensating action that is not an undo:** CloneDrawings «Бүгдийг буцаах» is a *new* deletion transaction (`CDJ:993-1061`) of everything the job added (whitelist: views non-template, tags, room tags, dimensions, MRA, text, filled regions, viewports, schedule instances, detail lines, view-specific family instances; `CDJ:1063-1071`). It does **not** restore what «Өмнөх клоныг устгаж шинээр» deleted (explicit warning `CDH:316-321`), and does not remove the Extensible-Storage stamps written to template/target elements (`CloneDrawings/CdLinks.cs:197-219`).

---

## X2. Supported contexts (document kind · view · selection)

| Tool | Document | Active view accepted | Selection / pre-selection | Ribbon dimming (`AvailabilityClassName`) |
|---|---|---|---|---|
| Хуулж тавих | project only, `CTC:47-51` | any `ViewPlan` non-template (floor, ceiling, structural, area, dependent) `CTC:54`; message says only «Давхрын план (Floor Plan)» | pre-selection used if non-empty (`CTC:66`), else `PickObjects` with `IsCopyable` filter (`CTE:206-220`); re-filtered silently by `SplitSelection` (`CTE:227-242`) | `QtoCommandAvailability` = any non-family doc (`QtoExportCommand.cs:262-276`) → never dimmed by view type |
| Зураг клонлох | project only, `CDC:39-43` | `ViewPlan` ∥ `ViewSection` (section, detail, elevation) ∥ `View3D`, non-template (`CDC:45`) | template: exactly one pre-selected cloneable element, else pick; targets: same **Category** as template (`CdPickFilter`, `CDC:299-320`) | `QtoCommandAvailability` |
| Автомат хэмжээс | project only | plan (Floor/Ceiling/Engineering/**Area**), section/detail, elevation; not 3D/sheet/schedule/drafting; template views excluded (`AutoAnnotate/AaScan.cs:508-527`) | optional (only for «Зөвхөн сонгосон» scope) | `AutoAnnotateAvailability` (`AutoAnnotateCommand.cs:146-161`) |
| Арматурын төгсгөлийн тэмдэг · Тэмдэглэгээ шинэчлэх | project only (`RfGuard.cs:25-30`) | `RfView.Use != Unsupported`: Floor/Engineering/Ceiling plan, Section, Elevation, Detail — **not AreaPlan**, 3D, sheet, schedule (`Reinforcement/Revit/RfView.cs:49-70`) | rebars only (`RfRebarPickFilter`, `ESC:15-23`); non-rebar pre-selection counted and skipped | `RfViewAvailability` (`ESC:288-303`) |
| Огтлолын арматурын тэмдэглэгээ | project only | **Plan / Section / Detail only** — Elevation is refused by the command (`SAC:43-50`, `RFT:551-556`) although `RfViewAvailability` leaves the button enabled on elevations | host = beam/column that can host rebar (`RfSectionAnalyzer.IsAcceptableHost`, `Reinforcement/Revit/RfSectionAnalyzer.cs:62-90`): 1 valid pre-selected ⇒ used silently, ≥2 ⇒ pick prompt, 0 ⇒ pick prompt (`Reinforcement/Core/RfHostPick.cs`) | `RfViewAvailability` |
| Түүвэр хувилах · синк хийх | project only | any (acts on schedules, not the view) | source schedule = Rebar-category, non-key, non-material-takeoff, non-template (`RSE:92-112`); active schedule preferred | `QtoCommandAvailability` |
| Хуудас дугаарлах | project only (`SheetNumeratorCommand.cs:65-69`) | any (modeless window; active sheet only used to pre-select) | none | `QtoCommandAvailability` |
| Хуудас үүсгэх | project only (`BatchSheetCommand.cs:37-41`) | any | none | `QtoCommandAvailability` |
| Зураг холбох | project only (`BindingCommand.cs:30-35`); needs token + project (else opens `SettingsDialog`, `:38-45`) and ≥1 sheet (`:58-67`) | any | none | `ProgressCommandAvailability` (`AssistantPaneProvider.cs:68-82`, same predicate) |

## X3. Esc / cancel semantics

| Tool | Before any commit | After ≥1 commit |
|---|---|---|
| Хуулж тавих | Esc at `PickObjects`, dialog «Болих», Esc at A / first B / mirror axis ⇒ `Cancelled`, nothing written (an uncaught `OperationCanceledException` leaves the `using` TG un-assimilated, so it is disposed unfinished — relies on Dispose-time rollback; nothing had been written yet, `CTC:92-129`) | **Esc = «finish»**: `PickOrNull` returns null → loop ends (`CTC:157-161,177-183`) → group assimilated → report. Mirror has no loop (one placement). |
| Зураг клонлох | Esc during template/target pick ⇒ `Cancelled` (`CDC:160-163`); dialog «Болих» ⇒ `Cancelled`. Note the pre-pick `SetElementIds(tpl)` changes the user's selection (`CDC:88`) | No Esc. Pane «Цуцлах» (confirm) cancels **between steps**; finished steps stay; `TargetsUnfinished` counted; re-running adds only the missing (`CDJ:238-250`, `CDM:174-179`) |
| Автомат хэмжээс | dialog «Болих» ⇒ nothing | n/a |
| Төгсгөлийн тэмдэг | dialog «Болих»; immediate Esc in loop with 0 clicks ⇒ `Cancelled` (`ESC:180`); Esc at bar-set pick prompt ⇒ `Cancelled` (`ESC:84-87`) | **Esc = finish, placed symbols stay** (`ESC:138-141`) |
| Огтлолын тэмдэглэгээ | Esc at host pick ⇒ `Cancelled` (`SAC:65-68`); dialog «Болих» | n/a (dialog preview is read-only) |
| Тэмдэглэгээ шинэчлэх | the section-sets TaskDialog «Cancel» ⇒ `Cancelled` (`ESC:233`) | n/a |
| Түүвэр хувилах/синк | dialog «Болих»; «Солих» confirm «No» returns to the dialog (`ScheduleCloneDialog.cs:338`); sync delete confirm «No» likewise | n/a |
| Хуудас дугаарлах | modeless; nothing written until «Хэрэгжүүлэх» or an explicit rename/delete. Closing with an unapplied reorder asks `CloseDirtyConfirm` (`SNV:536-539`) | n/a |
| Хуудас үүсгэх · Зураг холбох | dialog «Болих»/«Хаах» ⇒ nothing (BatchSheets still saves prefs only after OK) | n/a |

## X4. Persistence of options (what must survive a redesign)

| Tool | File / store | Persisted | Never persisted |
|---|---|---|---|
| Хуулж тавих | `settings.json` → `copy_to_other` (`QtoDtos.cs:430-451`), saved right after OK (`CTC:92-100`) | mode, tags, room_tags, dimensions, details, clone_views, clone_sheets | per-source-view checklist |
| Зураг клонлох | `settings.json` → `clone_drawings` (`QtoDtos.cs:350-382`), saved before enqueue (`CDC:124-132`) | tags, dimensions, spots, details, sheets, rebar (only if template has rebar), replace_mark, `annotation_kinds` (per template kind), `views_on`, `views_off` (UniqueId, ≤400 each), `view_types_off` (per template kind) | **`Recreate`** (`CDD:291`), per-row mode NewView/InPlace, target selection |
| Автомат хэмжээс | `%APPDATA%\RevitMcpAddin\auto-annotate.json` (`AaModel.cs:143-182`) | all `AaOptions` (list in T4) | `OnlySelection` (forced false on load, `AaModel.cs:156`) |
| Төгсгөлийн тэмдэг · Огтлол · Түүвэр | `%APPDATA%\RevitMcpAddin\reinforcement.json` (`Reinforcement/Revit/RfPrefs.cs:98-148`) | see T5/T6/T8; **only if «Дараагийн удаа санах» is ticked** | **If unticked, the stored block is reset to defaults and saved** (`ESC:68-70`, `SAC:115-117`) — «Remember» is not "don't save", it is "reset". Template-copy path saves nothing (`SAC:109-111`). Schedule: only `Policy` 0/1; «Солих» is never remembered (`ScheduleCloneDialog.cs:341-342`) |
| Хуудас дугаарлах | `%APPDATA%\RevitMcpAddin\sheet-numerator.json` (`SheetNumerator/Core/Prefs.cs:58-170`) | window bounds, DisplayMode, SortByName, HidePreview, unicode-warning-accepted, mode simple/advanced, simple{prefix,suffix,use_start,start,width}, 3 advanced parts{enabled,prefix,suffix,value_mode,start,step,width,wrap,limit}+2 separators, param prefix/suffix, write_result{+source}, group_count{+scope}, name_numbering{at_start,at_end,source,separator}, shift{amount,token_index}, marker{enabled,char} | **session-only:** MoveRenumber, StartFromSelected, ShiftActive (Өсгөх/Бууруулах), CleanMarkers (`Prefs.cs:36-38`, `Settings.cs:203-215`) |
| Хуудас үүсгэх | `settings.json` → `sheet_gen` (`QtoDtos.cs:476-502`), saved after OK even if creation fails (`BatchSheetCommand.cs:62-77`) | separator, pad_width, title_block_name, name_template, per-parameter value and include-in-number | — |

## X5. Units

| Tool | Convention |
|---|---|
| Хуулж тавих | internal feet only; user inputs are picked points. Tolerances: match 0.005 ft ≈ 1.5 mm (`CTE:195`), dimension value 0.0033 ft ≈ 1 mm (`CTE:197`), rotate length mismatch 0.02 ft ≈ 6 mm (`CTC:37`, shown to the user in mm `CTC:188`) |
| Зураг клонлох | internal feet only; neighbour 0.5 ft ≈ 15 cm, relaxed tag match 3.3 ft ≈ 1 m, plane 0.05 ft, datum 0.5 ft, dim value 0.0033 ft (`CDE:922-935`); «dedicated view» = crop ≤ max(4 × element, element + 10 ft ≈ 3.05 m) (`CloneDrawings/Core/CloneRules.cs:49-72`); proportional "stretch" mapping inside the element box, distance-preserving outside (`CloneRules.cs:25-40`) |
| Автомат хэмжээс | **paper mm × view scale**: «Ханаас эхний гинж» 3–40 mm, «гинж хооронд» 4–30 mm (`AutoAnnotateDialog.cs:344`); footer explains «(1:{scale} масштабт 10 мм = … м)» (`:95-98`); independent of project units |
| Төгсгөлийн тэмдэг | «Оффсет ({unit})» in the **project length unit** (`RfUnits`, `RfPrefs.cs:155-182`) → mm → feet (`EndSymbolDialog.cs:325`); code-drawn marker size = **paper mm** 0.5–20, default 3 (`Reinforcement/Core/RfMarker.cs:53-55`), radius scaled by `view.Scale` at creation and floored at 2 × `ShortCurveTolerance` (`ESS:402-404`); rotations in degrees |
| Огтлолын тэмдэглэгээ | «Хэмжээсийн шугамын зай (цаасан дээр, {unit})» and «Tag хоорондын зай» are typed in the **project unit**, converted to mm and treated as **paper** distance × view scale (`RSS:34-52`, `SectionAnnotationDialog.cs:510-511`); defaults 10 mm / 6 mm; fixed non-UI constants TagOut 6, TagWidth 16, TagHeight 5 mm (`RSS:30-32`) |
| Түүвэр хувилах/синк, Хуудас дугаарлах, Хуудас үүсгэх, Зураг холбох | no length units (integers / strings) |

## X6. Brief-wording verdict per phrase

| Phrase in the brief | TRUE for | FALSE / needs qualification for |
|---|---|---|
| «atomic» | Хуудас дугаарлах → Хэрэгжүүлэх; Түүвэр хувилах → «Солих» per item | Хуулж тавих, Зураг клонлох (both modes), Автомат хэмжээс, Тэмдэг (loop), Огтлол, Template-copy, Түүвэр delete, Хуудас үүсгэх, Хуудас дугаарлах rename/delete |
| «one Ctrl+Z» | Хуулж тавих, Автомат хэмжээс, Тэмдэг (preselected), Огтлол (both paths), Тэмдэглэгээ шинэчлэх, Түүвэр хувилах/синк (per action), Хуудас дугаарлах Apply, Хуудас үүсгэх | **Зураг клонлох (background)**; **Тэмдэг pick loop** (one per click); Хуудас дугаарлах rename/delete (separate steps); Зураг холбох (no model change) |
| «replace safely» | Огтлол: new set is created first, old deleted only if the new kind is complete and no foreign dependents (`RSS:324-402`) | **Автомат хэмжээс**: old set deleted first (`AAR:164-190`); **Зураг клонлох Recreate**: old clones deleted in a committed step first (`CDJ:468-479`) |

---

# Per-tool truth tables

## T1. Хуулж тавих (`MglCopyToOther`, `CopyToOtherCommand`, `CopyToOtherEngine`)

| Aspect | Truth |
|---|---|
| **Flow** | licence (`CTC:42`) → family check → active view must be a non-template `ViewPlan` → selection → split model/2D → **settings dialog** (`CTC:89`) → pick points (mode-specific) → run per placement → report. The dialog comes **before** point picks. |
| **Selection filter** | excluded: element types, no category, tags, spatial tags, dimensions (auto-follow their elements); view-specific only when owned by the active view; excluded model: Level, Grid, ReferencePlane, RevitLinkInstance, View, Viewers, VolumeOfInterest, Cameras (`CTE:206-220`). Zero copyable ⇒ TaskDialog (`CTC:75-81`). |
| **Inputs** | Mode radios «Шилжүүлэх» / «Эргүүлж байрлуулах» / «Толин тусгал»; checkboxes «Tag (хаалга, хана, тавилга …)», «Өрөөний tag», «Хэмжээс — утгыг нь А-тай тулгаж шалгана», «2D тэмдэглэгээ — зураас, текст, штрих, detail component», «А-гийн зүсэлт, планыг Б-д шинээр үүсгэх» (+ per-view checklist, default all ticked, max height 170 px), «Эх харагдац хуудсан дээр байвал Б-д шинэ хуудас үүсгэх» (forced off when view cloning is off, `CTC:390`). Snaps: Endpoints∣Intersections∣Midpoints∣Centers∣Perpendicular (`CTC:32-34`). **Move:** A once, then B repeatedly. **Rotate:** A1, A2, then (B1, B2) repeatedly; length mismatch > 0.02 ft ⇒ TaskDialog «Энэ байршлыг алгасах уу?» Yes=skip / No=continue (`CTC:185-195`). **Mirror:** axis P1, P2, one placement (`CTC:201-207`). Zero-length translation is skipped silently (`CTC:163-164`). Placements get letters Б, В, Г… (`CTE:198-201`). All transforms are planar: Z never changes (`CTE:33`). |
| **Creates / modifies / deletes** | **Model:** `ElementTransformUtils.CopyElements` (+`RotateElements` about the vertical axis through the pivot) or `MirrorElements(...,true)` (`CTE:693-724`). Elements already present at B are **reused, not copied** (signature match 1.5 mm; rooms by `IsPointInRoom`; a long wall covering the segment) (`CTE:540-601`). Doors/windows hosted on copied hosts are tracked explicitly and **placed anew** on existing B hosts (`CTE:672-690,727-750`). **Views** (option on): new section/detail via `ViewSection.CreateSection/CreateDetail`, plan via `Duplicate` (dependent or duplicate) with transformed crop; mirrored sections get a handed frame; names via `NameFor` («А секц»→«Б секц», else « (Б)»); identical earlier clones reused (`CTE:796-916,969-982`). Only crop-active plan/ceiling/structural/area/section/detail views that intersect the region and show a source element are candidates; elevations/3D are never created (`CTE:251-282`). **Annotations:** `IndependentTag` (all tagged elements must be mapped; destination = same view if it sees all targets, else the created clone), `RoomTag` (plan destinations only), **linear** `Dimension`s only (spot/angular excluded), 2D (TextNote, `OST_Lines` curves, FilledRegion, detail components/generic annotation) (`CTE:1035-1172,1176-1268,1474-1569`). **Sheets** (option on): `ViewSheet.Create`, number `<src>-<letter>` made unique with `.2`, name via `NameFor`, sheet parameters, viewports at the same box centre + viewport type, legends, non-revision schedule instances, sheet 2D (`CTE:1664-1736`). **Selection:** sets selection to the created model ids (`CTC:135-144`). **Deletes:** nothing (only rollbacks). |
| **Transaction / Undo** | see X1; each placement inside `Execute` has its own `Transaction` + failure preprocessor that deletes **warnings only** (`CTE:1941-1958`). **`t.Commit()` return value is not checked** (`CTC:236`). `rep.Targets++` happens in the middle of `Run` (`CTE:358`) before view/annotation steps, and the catch does not undo it (`CTC:238-244`) — a later throw would leave an over-counted «N байршилд хуулав». |
| **Skip / failure reporting** | `CopyToOtherReport.Summary()` (`CTE:129-173`): header «N байршилд хуулав.»; **ЗАГВАР** (Шинээр хуулсан, Б-д аль хэдийн байсан, Тулгаж чадаагүй); **ЗУРАГ** (Tag/Өрөөний tag/Хэмжээс with «байсан N, алгассан N»; «↳ N хэмжээс утга нь А-гаас зөрсөн тул үүсгээгүй»; 2D; Шинэ харагдац list ≤8; Шинэ хуудас ≤8); **АНХААР** ≤8 notes; «Revit-ийн анхааруулга … нуусан»; «Алдаа: …». The footer «Бүгдийг нэг Ctrl+Z-ээр буцаана.» is appended **unconditionally** (`CTE:171`), even when `Targets==0` and only errors are shown. Result `Succeeded` iff `Targets>0`. |
| **Guards** | licence; family; view type; selection filter; Rotate length-mismatch prompt; value gate on every new dimension (≈1 mm, else SubTransaction rollback, `CTE:1245-1255`); duplicate prevention for tags/room tags/dims/2D (`HasTagNear`-style key sets, `HasEquivalentDimension`, `DetailExists`); no worksharing/ownership check; no read-only check. |
| **Strings the user sees** | ToolTip «А хэсэгт хийсэн зүйлээ tag, хэмжээстэй нь Б хэсэг рүү хуулна.» ✔. LongDescription (`APP:743-751`): «1. Давхрын план нээнэ.» ~ (any plan type). «2. Хуулах зүйлээ сонгоно (эсвэл товч дарсны дараа сонгоод «Finish»).» ✔. «3. A дээрх суурь цэгээ дарна — тэнхлэгийн огтлолцол г.м.» ~ (Move only; **omits the settings dialog** that opens first and the Rotate/Mirror sequences). «4. B дээрх харгалзах цэгийг дарна — олон байршил дарж болно, Esc-ээр дуусна.» ✔ for Move and Rotate, ✖ for Mirror (single placement). «БҮХ харагдац (план, зүсэлт, фасад) дахь tag, өрөөний tag, хэмжээс нь шинэ элементүүд дээр нь дахин тавигдана» ~ overstated (see Flags). «Тэнхлэг, түвшин хуулагдахгүй» ✔. **«эргүүлэх, толин тусгал одоохондоо байхгүй» ✖ FALSE** (`APP:749` vs `CTC:107-117,312-313`). «Бүгдийг нэг Ctrl+Z-ээр буцаана» ✔. Dimming sentence ✔. Header comment of the command (`CTC:13-25`) and the dialog hints are accurate. |
| **Flags for help text** | (1) rotate/mirror exist and are the 2nd/3rd radio buttons; (2) the tool also creates views, sheets, 2D and verifies dimension values — none is in the tooltip; (3) tags/dims land only in views that already see every mapped target or in newly created/reused clone views, otherwise they are counted as «алгассан»; (4) dimensions: linear only, every reference must map (Level kept, Grid only if a grid sits at the transformed position, faces by geometry) (`CTE:1361-1466`); (5) existing elements at B are reused, so «хуулна» ≠ always copies. |

## T2. Зураг клонлох (`MglCloneDrawings`; command, dialog, job host, pane, engine)

| Aspect | Truth |
|---|---|
| **Flow** | licence → family/view checks → template (pre-selected single cloneable element or `PickObject`) → `CdAnalysis.AnalyzeTemplate` (dependency-graph based, fast) → if no linked views **and** no candidates ⇒ TaskDialog (`CDC:77-85`) → target `PickObjects` + «Finish» (empty Finish allowed) → dialog → prefs saved → `CdJob` enqueued in `CdJobHost` → command returns `Succeeded` immediately (`CDC:142-153`); progress/report in the right-docked pane «MGL — Зураг клонлох». |
| **Template / target rules** | cloneable = model-category element, not type/view-specific/View/Level/Grid/ReferencePlane/RevitLinkInstance/Group/SpatialElement/**Rebar**, has a bbox (`CDA:134-144`). Targets: same category (`CdPickFilter`); dialog also has «+ Ижил төрлийн бүгд» (same type) and «+ Ижил ангиллын бүгд» (`CDD:316-317`). |
| **Views found** | dependency graph of template + its rebars/hosted elements (tags, dimensions, spots, MRA) → views; plus views whose name/sheet contains the template mark as a whole word (Cyrillic/Latin look-alikes folded, non-replaceable marks like «1» never match, `CloneDrawings/Core/ElementKind.cs:98-130`); plus manually linked views (Extensible Storage on the template); sheets, schedules, drafting views, legends excluded (`CDA:266-337`, `:324-325`). «Бусад харагдац хайх (удаан байж болно)» deep-scans for views that show the template but carry no annotation (`CDD:223-256`); ticking them stores a manual link on the template. |
| **View groups** | `ViewRelevanceRule.Classify` (`CloneDrawings/Core/ViewFilter.cs:65-85`): manual or already a clone for this template ⇒ **Own**; clone made for another element ⇒ **Other**; name contains template mark ⇒ Own if dedicated else General; name contains another tagged element's mark ⇒ Other; non-dedicated (large) ⇒ **General**; callout whose parent is Own ⇒ Own; crop centred on another element with more references ⇒ Other; else Own. Only **Own** is pre-selected (`ViewFilter.cs:87`); General/Other open only if a row is ticked. Group titles ««{label}»-ийн өөрийн зураг» / «Ерөнхий харагдац — tag/хэмжээсийг байранд нь нэмнэ» / «Бусад элементийн зураг — «{label}» зөвхөн харагддаг». «Хайж олсон харагдац» is a 4th group, default unticked. |
| **Per-row mode** | combo «Шинэ харагдац үүсгэх» (`NewView`, only if `CanClone`) / «Байгаа харагдацад нэмэх» (`InPlace`) (`CDD:493-505`). `Skip` exists in the model (`CDM:11-18`) but is not exposed. Default = `NewView` for dedicated, `InPlace` otherwise (`CDA:799`). |
| **Filter** | text search (Cyrillic/Latin folded, every token must match name/type/sheet/note) + type toggles План/Зүсэлт/Фасад/Callout/3D/Бусад (`ViewFilter.cs:104-190`). **A ticked row hidden by the filter is NOT cloned** (`CDD:781`, summary «сонгосон N нь шүүлтээр нуугдсан тул ОРОХГҮЙ», `CDD:748`); manual-link saving ignores the filter (`CDD:797-811`). |
| **Cloneable source view types** | FloorPlan, CeilingPlan, EngineeringPlan, Section, Detail, Elevation (crop active), 3D non-perspective with section box; **AreaPlan not cloneable** (`CDA:829-845`). New view kinds: callout (if source is a callout), plan crop duplicate, 3D, section (`CDE:1140-1204`). |
| **Option checkboxes** | «Tag», «Хэмжээс (зорилтын нүү рүү)», «Түвшний тэмдэг (spot)», «2D — текст, зураас, штрих, detail», «Хуудас (ижил байрлалтай)», «Арматур тулгах (N)» (disabled when template has no rebar), ««{Mark}»-ийг нэр, текстэд зорилтын тэмдэгээр солих», «Өмнөх клоныг устгаж шинээр үүсгэх» (`CDD:283-291`); «Аль элементийн tag, хэмжээсийг клонлох» per-kind checkboxes (template kind always on and disabled; shown only if >1 kind). **«Tag» also governs room tags (new views only) and rebar MRA**; in 3D only tags of *locked* views are cloned, never dimensions/spots/2D (`CDE:1881-1906`). In `InPlace` views only annotations that reference the template or its rebar/hosted elements are cloned; 2D and room tags are not (`CDE:266-305,1893-1906`). |
| **Creates / modifies / deletes** | views (+ `FinishView`: graphics, view range, parameters), sheets + viewports aligned by crop + title position, legends, schedule instances, sheet 2D; tags (+leaders), dims (re-attached to the target's face by geometry, value-verified ≈1 mm, text overrides copied), spots, MRA, 2D; hides stray section markers inside clone views (`HideStrayViewers`, counted «Клон харагдацад хол байрлах бусад зүсэлтийн тэмдэг нуусан»); writes **Extensible-Storage** records on clone views/sheets (`SourceUid`,`TargetUid`), on the **target** (`MarkTarget`) and, when links changed, on the **template** (`SetManualViews`) (`CdLinks.cs:197-219`, `CDJ:411-422`). Deletes only under «Өмнөх клоныг устгаж шинээр»: the target's previous clone views **and sheets** for the selected NewView links, cascading to viewports/annotations (`CDE:1095-1138`). |
| **Reuse (default) vs Replace** | **Reuse:** clone lookup by `(source uid, target uid)` stamp (`CDE:1145-1152,3513-3515`); per-annotation duplicate checks. **Replace** = `Recreate` (default off, not persisted): delete step is its own committed transaction before re-creation (`CDJ:468-479`); not restored by «Бүгдийг буцаах». |
| **Job host / pane** | one active job at a time, others queue; `Idling` slices of 150 ms (`CDH:34,155-209`); keeps last 5 finished cards (`CDH:36`); pane buttons «Түр зогсоох», «Үргэлжлүүлэх», «Цуцлах» (confirm), «Эхний хуудсыг нээх», «Эхний харагдацыг нээх», «Бүгдийг буцаах» (confirm), «Хаах» (card only) (`CdJobPaneView.cs:210-219`). **State is in memory only:** Revit shutdown cancels jobs (`CDH:60-74`); closing the document cancels/fails them (`CDH:269-282`, `CDJ:349-353`); not resumable after a restart. «Resumable» = pause/resume + safe re-run (existing clones are reused, missing parts added). Pane registration or `CdJobHost.Init` failure ⇒ sync fallback and a TaskDialog report (`APP:235-246`, `CDH:233-241`). |
| **Step structure** | per target: Links → Prepare (once) → Begin (`BeginTarget`, optional delete step) → Views (1 tx per new view) → Annotate (1 tx per time slice, or per single element in "safe mode" after a rollback) → Sheets (1 tx per source sheet) → Finish (1 tx stamps the target) (`CDJ:105,398-668`). Transaction names «MGL клон #{job} · {i}/{n} · {label} · …» appear in Revit's Undo list (`CloneDrawings/Core/ViewFilter.cs` `JobNames`). |
| **Failure model** | `CdFailureHandler` (`CDM:401-481`): warnings deleted (counted), errors with a `DeleteElements` resolution resolved up to 5 rounds (`InvalidRemoved`), otherwise **silent rollback of that step** with Revit's text in the report; a rolled-back annotate slice is retried element-by-element, the culprit skipped; worksharing-owned view abandoned after 2 skips (`CDJ:53,590-596`); Revit refusing a transaction (edit mode) ⇒ job waits (`WaitingForRevit`, `CDJ:296-307`); read-only doc ⇒ Failed. A user edit between steps ⇒ light/full resync; a user Ctrl+Z of one of our steps ⇒ job **paused** with notice and that target re-run on «Үргэлжлүүлэх» (`CDJ:873-923`). |
| **Report shape** | `CdReport.Summary(background)` (`CDM:313-385`): «N элементэд зураг клонлов (… алхам бүтэлгүйтсэн … дутуу — цуцалсан)»; **ХАРАГДАЦ, ХУУДАС**; **ТЭМДЭГЛЭГЭЭ** (Tag, Хэмжээс, Түвшний тэмдэг, 2D, Арматур тулгасан); **АНХААР** (10 of ≤60); warnings/invalid removed; **АЛДАА** (10 of ≤60); footer «Буцаах бол самбарын «Бүгдийг буцаах» товч — …» (background) or «Бүгдийг нэг Ctrl+Z-ээр буцаана.» (sync). Shown in the pane card «Тайлан»; TaskDialog only without pane. |
| **Strings the user sees** | ToolTip «…ижил төрлийн бусад элемент рүү хуулна.» ~ (it is same **category**; dialog offers both). LongDescription (`APP:762-772`) steps 1-3 ✔; view groups/filter sentence ✔; «Зорилтын урт, өндөр, эргэлт өөр байж болно…» ✔ (Stretch/frame mapping); «Дахин ажиллуулахад давхардахгүй — өмнөхийг нь ашиглаж дутууг л нэмнэ» ✔ (default only); «клонлолт АРЫН горимд явна…» ✔ (only when host initialised); «алхам бүр тусдаа хадгалагдана; бүгдийг самбарын «Бүгдийг буцаах»-аар нэг дор буцаана» ~ **accurate about "no single Ctrl+Z"**, but «буцаана» is a *delete of what was added*, with the caveats in X1. Dialog text, tooltips and pane texts (`CdJobPaneView.cs:216-217,299-312`) are accurate. |
| **Flags** | never say «one Ctrl+Z» (only the sync fallback has it); a single user Ctrl+Z pauses the job; «Бүгдийг буцаах» also deletes annotations the user later added to clone views (confirm text says so, `CdJobPaneView.cs:309`) but not Recreate-deleted clones or ES stamps; Recreate is destructive and unrecoverable by the pane. |

## T3. CdOntoView (engine only — NOT a ribbon tool)

`CloneDrawings/CdOntoView.cs` is reachable **only** from the «Загвараас хуулах» button of the section dialog via `RfTemplateService.Run` (`RTS:249`). It reuses the CloneDrawings engine to add a hand-drawn template view's dimensions/tags/2D onto the **active** view for a chosen host.

| Aspect | Truth |
|---|---|
| Inputs | template view (list = views owning dimensions/tags, non-active, plan/section/detail, ordered same-kind first then by annotation count, `RTS:97-137`); template host (auto-detected from dimension/tag references, rebar→host; if several the user picks; kind-mismatch warning, `RTS:149-203`, `SectionAnnotationDialog.cs:359-379`); options «Хэмжээс (арматурын хэмжээс/MRA орно)», «Tag (арматурын шошго)», «Текст, 2D зураас» (default all on, ≥1 required). Fixed internally: Spots off, Sheets off, Rebar on, ReplaceMark on, Recreate off (`RTS:222-231`). |
| Behaviour | `CdOptions`/`CdPlan.Prepare` for one `NewView`-mode pseudo-link; destination view = the **active** view (`ctx.Dest[templateView.Id] = targetView`, `CdOntoView.cs:82`); `w.Stray=false` so nothing is hidden in the user's view (`:95`); frame flipped 180° when the two views look at a beam from opposite ends (`OntoViewRules.NeedsFlip`, |cos| ≥ 0.5); scale difference reported (`RFT:915-917`). Creates no views; never deletes; hand-placed items untouched. |
| Undo / Esc | `TransactionGroup` + one Transaction; commit iff `Made>0` (Dims+Tags+Details), else rollback; commit rejected ⇒ message «Revit хэмжээс/tag-ийг хүлээж авсангүй (алдаа) — бүгд буцаагдлаа, юу ч өөрчлөгдсөнгүй.» and counters restored (`RTS:236-286`). One Ctrl+Z. No Esc (dialog only). |
| Guards | view must be writable by this user (`RfSectionStore.CanWrite`, `RTS:216-220`); same-view and missing host/view problems returned as `Problem` (`CdOntoView.cs:47-58`). |
| Report | `RFT.TplResult` (`RFT:897-919`): Template→view line, Хэмжээс/Tag (MRA included)/Текст·2D with «байсан/алгассан», Арматур тулгасан, adapted-value warning, flipped note, scale note; headings «Загвараас хууллаа» / «…ХЭСЭГЧИЛЭН хууллаа» / «Юу ч хуулагдсангүй»; Ctrl+Z hint only if something was made. |

## T4. Автомат хэмжээс (`MglAutoAnnotate`)

| Aspect | Truth |
|---|---|
| **Contexts** | see X2. If the view's template hides the Dimensions category a non-blocking TaskDialog warns (`AutoAnnotateCommand.cs:46-60`). Links: elements from loaded Revit links in the view are measured and dimensions attach to link references; unloaded links and nested links are reported as notes (`AAR:97-112,206-209`). |
| **Inputs (`AaOptions`, `AaModel.cs:11-62`)** | Plan: `GridDims`, `FacadeDims`, `InteriorDims`, `DoorDims`, `ColumnTies` (+ stored per discipline: `ColumnTiesStructural`=true, `ColumnTiesArchitectural`=false). Section/elevation: `LevelDims`, `GridDims`, `OpeningHeights`. Placement: `AllSides` (4 sides vs bottom+left / left+bottom), `ExtendGrids`, `FirstMm` (default 12, 3–40), `StepMm` (default 8, 4–30), `DimensionTypeId` (−1 = file default). Tags: `TagDoors`, `TagWindows`, `TagRooms`, `TagColumns`, `TagFraming` (default on), **`TagWalls` (default off)**; tag checkboxes disabled only when no tag family exists. Scope: «Харагдацад байгаа бүх элемент» / «Зөвхөн сонгосон N элемент (тэнхлэг/түвшин сонгосон бол тэдний гинж)»; `ReplacePrevious` (default on). Dimension checkboxes are never disabled (impossible ones are unticked + amber reason, `AutoAnnotateDialog.cs:252-272`). |
| **Creates / modifies / deletes** | Dimension chains (counted as фасад / тэнхлэг / нийт / дотор / хаалга / багана / түвшин / нүхний өндөр), tags and room tags; `NudgeTexts` repositions text of created dimensions (`AAR:228`); **`ExtendGrids` (default ON) rewrites grid extents view-specifically in this view** (`AutoAnnotate/AaDim.cs:149-153`, reported «Тэнхлэгийн бөмбөлөг гаргасан: N») — an edit of existing elements, not of dims/tags; writes an Extensible-Storage registry of created UniqueIds on the **view** (`AutoAnnotate/AaStore.cs`). **Deletes the previously registered set before creating** (`doc.Delete(prev)`, `AAR:164-190`); only elements whose `OwnerViewId` is this view; hand-made dims/tags are not in the registry. No ownership check and no equivalent of the Section tool's `DeleteWouldTakeForeign`. |
| **Transaction / Undo** | see X1. Failure handler `AaFailureHandler` (`AaModel.cs:195-249`): warnings deleted; error-level failures delete **only elements created in this run**; user elements are left for Revit to raise; returns `Continue` (not `ProceedWithCommit`) while rolling back. |
| **Skip / failure reporting** | TaskDialog `AutoAnnotateCommand.cs:131-142`: instruction «Автомат хэмжээс тавигдлаа» or «Хэмжээс тавигдсангүй» (`Errors>0 && Created==0`); body `Summary` (`:100-129`) «Хэмжээс: N гинж (фасад …, тэнхлэг …, нийт …, дотор …, хаалга …, багана …, түвшин …, нүхний өндөр …)» or «Хэмжээс: тавигдсангүй», «Tag: N (өрөөний …) · M нь аль хэдийн tag-тай байсан», «Өмнөх автомат хэмжээс/tag: N устгаж дахин тавив», «Тавьж чадаагүй: …»; footer «Бүгдийг Ctrl+Z-ээр нэг дор буцаана.»; expandable list of ≤15 errors/notes. Empty-view reasons come from `AaRunner.EmptyReason` (`AAR:97-113`). **In the failure case the summary still prints «…устгаж дахин тавив»** although nothing was re-placed. |
| **Guards** | licence, family, unsupported view, dialog range validation (`AutoAnnotateDialog.cs:342-350`), view-template/Dimensions-hidden warning, `Reconcile` removes dimensions Revit dropped at commit and notes them (`AAR:119-147`). |
| **Strings the user sees** | ToolTip «Идэвхтэй харагдацын элементийг таньж хэмжээс, tag-ийг ажлын зураг шиг автоматаар тавина.» ✔. LongDescription (`APP:783-790`): plan chains / interior / door openings / column ties / tags ✔ (wall tags exist, off by default); «Зүсэлт, фасад: давхрын өндөр, тэнхлэг, цонх/хаалганы өндөр, tag.» ✔; «Гараар тавьсан хэмжээс, tag хөндөгдөхгүй; дахин дарахад зөвхөн энэ хэрэгслийн өмнө тавьсныг солино (давхардахгүй).» ~ ✔ for dims/tags, but silent about grid-bubble extension and delete-first; «бүгдийг нэг Ctrl+Z-ээр буцаана» ✔; dimming sentence ✔ (Detail and Area views also qualify). Dialog footer (`AutoAnnotateDialog.cs:95-98`) accurate. |

## T5. Арматурын төгсгөлийн тэмдэг (`MglRebarEndSymbol`, `RebarEndSymbolCommand`)

| Aspect | Truth |
|---|---|
| **Flow** | `RfGuard.Begin` (licence, project) → view must be plan/section/elevation/detail → list view-based symbols (`Generic Annotation`/`Detail Item`) → `RfRebarCollect.Resolve(pre-selection)` (non-rebar counted) → **settings dialog first** (`ESC:62`; OK button reads «Тавих» if rebars are preselected, «Арматур сонгох» otherwise) → prefs saved per «Remember» rule → **branch**. |
| **Branch A — preselected rebars** (`ESC:75-114`) | single `EndSymbolService.Place` for all preselected rebars = one group = one Ctrl+Z. If `BarSet==Nearest`, no pick point, exactly one preselected rebar and it is a bar set ⇒ one click on a bar is requested (`PickBarPrompt`, Esc = cancel, nothing changed). With ≥2 preselected rebars and mode «Сонгосон ширхэг», bar sets get **all** bars and `NearestFallback` is reported (`Reinforcement/Revit/RfRebarEnds.cs:116-120`). Final dialog always shown. |
| **Branch B — pick loop** (`ESC:123-191`) | no open transaction during `PickObject`; each click: `options.PickPoint = picked.GlobalPoint`, `Place(single rebar)` (own `TransactionGroup`), status-bar prompt «Тэмдэг тавих арматур дээр дараалан дарна уу (Esc = дуусгах)  ·  Тавьсан: N  ·  Сүүлийнх: …» (`RFT:433-437`; last result e.g. «+2», «өмнө тавигдсан — давхар тавиагүй», «crop хүрээнээс гадна — тавиагүй» `RFT:440-451`). **Esc = finish; everything placed stays.** First failure **stops the loop** and is shown (`ESC:172-176`). Final dialog only if `HasIssues` or `Placed==0` (`ESC:183-189`), with «Ctrl+Z бүр СҮҮЛД дарсан арматурын тэмдгийг буцаана.» |
| **Inputs (`RfEndSymbolOptions` / `RfEndSymbolPrefs`, `ESS:11-38`, `RfPrefs.cs:9-48`)** | symbol = family `Family : Type` (searchable) **or** «◇ Код-оор зурах тэмдэг (family шаардахгүй)» (shape «Тойрог» / «Загалмай (×)» / «Налуу зураас (/)», size mm 0.5–20); «Байрлуулах» Эхлэл + Төгсгөл / Зөвхөн эхлэл / Зөвхөн төгсгөл; «Эргүүлэх» Арматур дагуу (auto) / Тогтмол; **separate** «Эхлэлийн тэмдэг — эргэлт (°)» and «Төгсгөлийн тэмдэг — эргэлт (°)» (offset added to the automatic direction, or absolute angle in Fixed mode; legacy single `FixedAngleDeg` migrated, `RfPrefs.cs:128-135`); «Family-ийн заах чиглэл (°)» (disabled for code-drawn markers); «Оффсет» (project unit); «Дэгээний үзүүрт тавих (дэгээг арматурын төгсгөл гэж тооцно)»; «Олонлог (bar set)»: Сонгосон ширхэг (дарсан цэгт хамгийн ойр) / Бүх ширхэг / Эхний ширхэг / Эхний ба сүүлийн ширхэг; «Давхар тавихыг зөвшөөрөх»; «Дараагийн удаа санах». Family is stored by **Family + Type name**, never ElementId (`RfPrefs.cs:11-15`). |
| **Creates / modifies / deletes** | per end: `NewFamilyInstance(origin, symbol, view)` rotated about the view normal, or 1–2 `DetailCurve`s (lines/arcs) for the code-drawn marker; every part gets an Extensible-Storage record (rebar uid, end kind, bar index, symbol uid, rotation, offset, hooks, auto flag) (`ESS:382-446`). Duplicate protection = lookup of those records (not geometry). Half-placed symbols are deleted on failure (`ESS:450-464`). End-on bars (seen as a dot) get one symbol using the **Start** rotation (`ESS:352-366`, note `EndOnRotationNote`). Caps: 5000 symbols per run (`ESS:123`). Skips counted: duplicates, outside crop, hidden bars, not visible, beyond view depth (end-on), freeform (unsupported), no geometry, different symbol already present, damaged/copy-pasted markers (left untouched). |
| **Checks** | symbol must be view-based (`ESS:205-218`); symbol/`Lines` category hidden in the view ⇒ note; code-drawn markers must be re-detectable by the duplicate lookup or **the whole run rolls back** (`RfMarkerNotDetectableException`, `ESS:415-422`). |
| **Strings the user sees** | ToolTip «Арматурын эхлэл/төгсгөл бүрд тэмдэг (family эсвэл код-оор зурсан) арматурын чиглэлээр эргүүлж автоматаар тавина.» ✔. LongDescription (`RFR:40-48`): step 1 ✔; «2. ЗӨВХӨН арматур (Rebar) сонгоно. Олонлог (bar set) бол тэмдэг тавих ширхэг дээр нь дарна.» ✔ — **«Esc = загварт юу ч өөрчлөхгүй.» ✖** (true only for Esc on the first prompt/bar-set prompt; in the loop Esc keeps what was placed); «шулуун, L, U, дэгээтэй, олонлог (bar set), эргэсэн зүсэлтэд ч зөв» ~ (freeform bars are unsupported and reported); «Дахин дарахад ижил төгсгөлд давхар тавигдахгүй. Гараар тавьсан юм хөндөгдөхгүй.» ✔; «Код-оор зурсан тэмдгийн хэмжээ нь … масштабаар тогтоогдоно» ✔; **«Энэ нь загварыг ӨӨРЧИЛНӨ — бүгдийг нэг Ctrl+Z-ээр буцаана.» ✖** for the loop (per click); dimming sentence ✔. In-dialog texts (`RFT:331-338,422-430,453`) are accurate. |

## T6. Огтлолын арматурын тэмдэглэгээ (`MglRebarSectionAnnotation`)

### T6a. Automatic creation

| Aspect | Truth |
|---|---|
| **Flow** | `RfGuard.Begin` → view check (Plan/Section/Detail; **Elevation refused**) → host (`RfHostPick.Decide`: 1 valid pre-selected ⇒ used, otherwise pick; Esc ⇒ `Cancelled`) → `Analyze` (read-only; `NoHostData` ⇒ message) → dialog with live preview (every option change recomputes the pure planner; «Урьдчилан харах» is redundant) → `Plan` → `Render` → report. |
| **Inputs (`RfSectionUi`/`RfSectionPrefs`, `RSS:11-52`, `RfPrefs.cs:51-74`)** | «Хомутын ирмэг» Гадна (default) / Дотор / Тэнхлэг; sides Зүүн/Баруун/Дээд/Доод; «Хомутын хэмжээс үүсгэх»; dimension type; «Ажлын арматурыг tag-лах» + tag type; «Хомутыг tag-лах» + tag type; «Ижил дугаартай арматурын tag-ийг нэгтгэх» (GroupTags); «Өмнөх MGL тэмдэглэгээг солих» (default on); dimension offset (default 10 mm paper) and tag spacing (6 mm, min 1); «Дараагийн удаа санах». «Tag-ийн байрлуулалт» combo is **disabled** (only «Автомат», `SectionAnnotationDialog.cs:174-178`). Host-kind pref exists but the dialog uses the detected kind (`:97,499`). **Create is disabled** until tags are valid: no rebar-tag family, not selected, not a Structural Rebar Tag, or tag category hidden in view (`RSS:187-202`, `SectionAnnotationDialog.cs:526-565`); impossible/unsafe sides produce warnings, not guesses (`RFT:637-666`). Limits: ≤1500 work bars (`RfSectionAnalyzer.cs:57`), stirrups only within 3.2808 ft (≈1 m) of the cut (`:54,319`), native-reference search skipped for bar sets > 200 positions (`RSR:42,91,418`). |
| **Classification** | by Revit `RebarStyle` first, geometry confirms (`RfSectionAnalyzer.cs:301-327`): Stirrup/Tie ⇒ stirrup (tag + dimension); Standard straight ⇒ work bar (tag); **Standard loop ⇒ tag only**; style/geometry disagreement ⇒ skipped and counted (`StyleMismatch`). |
| **Creates / modifies / deletes** | One chain `Dimension` per axis (concrete face → stirrup edges → face) built **only from real references** — the stirrup edge line/cylinder reference found through geometry with `ComputeReferences`, concrete-face references; each side is trial-dimensioned and the value compared to the expected distance (0.5 mm), then rolled back; a side without a verifiable reference is **skipped and reported**, never faked (`RSR:268-271,307-355,445-495`); no helper/invisible lines are created. `IndependentTag.Create` per tag, free leader, activates the tag family type if needed (`RSR:588-716`). Registry on the view (Extensible Storage). **Previous set is deleted only after ≥1 new element exists**, kind by kind: dimensions only if every planned chain was created complete and none failed; tags only if all planned tags were created; any previous element whose deletion would also delete a foreign (user) element is **kept** (`DeleteWouldTakeForeign`, `RSS:324-402,447-476`, `RfReplacePolicy.cs`). With «Өмнөх … солих» off, previous items become ordinary annotations. Workshared view owned by someone else ⇒ nothing is written (`RSS:253-257`). A view that is a Duplicate-with-Detailing has a foreign registry: old copies are not touched, new ones are added on top (note `RFT:676-683`). |
| **Report** | `RfGuard.ShowReport` (`RfGuard.cs:34-41`): instruction «Тэмдэглэгээ тавигдлаа» / «…ХЭСЭГЧИЛЭН тавигдлаа» / «Тэмдэглэгээ тавигдсангүй»; body `RFT.SecResult` (`RFT:686-702`): «Гинжин хэмжээс: made/planned (N сегмент)», incomplete/failed chains, «Tag: made/planned», replaced/kept/protected previous, style mismatches, grouped tags; «Бүгдийг нэг Ctrl+Z-ээр буцаана.» only if something was placed; ms; expandable ≤25 detail lines (plan warnings, failures, notes). |
| **Strings the user sees** | ToolTip «Дам нуруу/баганын огтлол дээр хомутын хэмжээс, ажлын арматурын tag-ийг нэг командаар тавина.» ✔. LongDescription (`RFR:59-70`): steps 1-3 ✔ (step 1 ✔ for plan/section/detail only); «давхцалгүй байрлана» ~ (planner tries; `RFT:664` warns «Зарим tag давхцаж магадгүй»); RebarStyle sentence ~ ✔ with the loop nuance above; **«олдохгүй бол … үл үзэгдэх лавлагаа шугамд (бетон нүүр талдаа жинхэнэ холбоостой) холбоно» ✖ FALSE** (`RFR:66` vs `RSR:268-271`, `RFT:830`); «…ЗӨВХӨН энэ эзэн дээр энэ хэрэгслийн өмнө тавьсныг солино; гараар тавьсан хэмжээс, tag хөндөгдөхгүй. Бүгдийг нэг Ctrl+Z-ээр буцаана» ~ ✔ but omits the "only if the new set is complete, otherwise old stays and duplicates may appear" rule; dimming sentence ✖ for this button on **elevations** (button enabled, command refuses). Residual stale wording: `RFT:697` still gives «(ж: үл үзэгдэх лавлагаа шугам)» as an example of a user-attached element (legacy runs only). |

### T6b. «Загвараас хуулах» (copy-from-template-view, same dialog)

Described in T3. Entry: left panel of the dialog (search box «Загвар харагдац хайх (нэр)…», host combo «Загварын элемент:» or «Хэд хэдэн элемент олдсон — загвар болгох нэгийг сонгоно уу:», 3 checkboxes, button «Загвараас хуулах» enabled only with view + host + ≥1 option) (`SectionAnnotationDialog.cs:276-415`). Choosing it bypasses prefs saving (`SAC:109-111`). Strings: header `RFT:836-848` accurate; **the ribbon tooltip does not mention this path at all.**

## T7. Тэмдэглэгээ шинэчлэх (`MglRebarRefresh`, `RefreshAnnotationsCommand`)

| Aspect | Truth |
|---|---|
| Contexts | as `RfViewAvailability` (X2) |
| Flow | if the view has ≥1 stored section set: TaskDialog «Огтлолын хэмжээс/tag-ийг дахин үүсгэх үү?» with links «Бүгдийг шинэчлэх (хэмжээс/tag дахин үүснэ)» and **default** «Зөвхөн төгсгөлийн тэмдгийг шинэчлэх (аюулгүй)» + Cancel (`ESC:217-234`, `RFT:935-944`). Then one outer `TransactionGroup` over `EndSymbolService.Refresh` and (if chosen) `RfSectionService.Refresh`. |
| End-symbol refresh | for every registered placement recompute the end with bar-set mode All, move/rotate the existing instance or all detail curves of a code-drawn marker; **never deletes** (orphans = rebar gone/end not computable, reported «хөндөөгүй, УСТГААГҮЙ»); damaged or copy-paste markers untouched (`ESS:473-693`). User rotation offsets survive because they are stored with the record (`ESS:372-373`). |
| Section refresh | for every stored set: host must exist and the re-plan must produce content, else left untouched (counted as orphan); uses the **saved** options with `ReplacePrevious` forced true (`RSS:71-86,493-516`), i.e. dimensions/tags are re-created and hand-moved positions are lost (the dialog warns). |
| Report | «Тэмдэглэгээ шинэчлэгдлээ» + `RefreshResult` (Шинэчилсэн / Өөрчлөгдөөгүй / Арматур олдохгүй / Гэмтсэн / Copy-Paste / Алдаатай) + section summary; if nothing at all was found: TaskDialog «Энэ харагдацад энэ хэрэгслийн тавьсан тэмдэглэгээ олдсонгүй.» (`ESC:268-273`). One Ctrl+Z (assimilate only if something changed). |
| Strings | ToolTip ✔. LongDescription (`RFR:81-85`) ✔ in substance («Зөвхөн энэ add-in-ий тавьсныг шинэчилнэ… юу ч УСТАХГҮЙ», «⚠ Огтлолын хэмжээс/tag-ийг ШИНЭЭР үүсгээд өмнөхийг солидог…»); omits that the command first **asks** and defaults to end-symbols only. |

## T8. Түүвэр хувилах (`MglScheduleClone`)

| Aspect | Truth |
|---|---|
| Inputs | source schedule (searchable; Rebar category non-key non-MTO; active schedule preferred) · «Partition талбар» (auto-detected; or «(Partition — нуугдсан талбар нэмнэ)» which adds a hidden field **to each copy**, template untouched) · name pattern with `{Partition}` and `{Template}`, default derived from the template name (`RfScheduleNames.SuggestPattern`), forbidden chars `\ : { } [ ] \| ; < > ? \` ~`, example line per first ticked Partition · «Байгаа түүвэр»: **Алгасах** (default) / **Filter шинэчлэх** / **Солих (устгаад дахин үүсгэнэ)** · Partition grid (checkbox, rebar count, status, proposed name, note; search filters and «Бүгдийг сонгох» act on visible rows only; template's own value unticked by default). Create enabled iff pattern valid and create+update+replace > 0. «Солих» ⇒ confirm TaskDialog (default **No**) listing names and sheet placements (`ScheduleCloneDialog.cs:327-339`). |
| Creates / modifies / deletes | `View.Duplicate(Duplicate)` of the template (columns, format, sort, calculated fields preserved) + rename + one «Equal» Partition filter via `SetFilter(index)`/`AddFilter` (other filters untouched; Revit's 8-filter limit checked up front) + Extensible-Storage marker (copy discarded if the marker cannot be written) (`RSE:405-443,639-724`). **Update:** changes only the Partition filter of an existing compatible schedule; refuses hand-made schedules without a Partition filter. **Replace:** only schedules this tool created, not split / filter-by-sheet; saves sheet placements (point, segment, rotation) → deletes → creates → re-places, atomically per item (`RSE:504-570`). Ownership by another user ⇒ skipped with note (`RSE:618-633`). |
| Status vocabulary | `+ Үүсгэнэ`, `✓ Байгаа`, `↻ Шинэчилнэ`, `⇄ Солино`, `○ Алгасна`, `! Мөргөлдөөн` (`RFT:115-126`); reasons `RFT:128-143` |
| Failure/report | Revit rejecting the Partition filter stops the remaining items (`RFT:230-234`); report heading «Түүвэр хувилагдлаа» / «Түүвэр шинэчлэгдлээ» / «Түүвэрт өөрчлөлт хийгдсэнгүй» / «Түүвэр хувилагдсангүй», counts Үүсгэсэн/Шинэчилсэн/Сольсон/Аль хэдийн зөв/Мөргөлдөөн/Алгассан/Алдаатай, sheet placements re-placed, Ctrl+Z hint only if changed (`SCC:59-71`, `RFT:215-223`). |
| Strings | ToolTip ✔. LongDescription (`RFR:98-104`) ✔; the preview legend lists only four of the six statuses and calls `!` «Нэрийн мөргөлдөөн» (actual label «! Мөргөлдөөн»); omits Replace limits (tool-created only, not split/filter-by-sheet) and the 8-filter limit. |

## T9. Түүвэр синк хийх (`MglScheduleSync`)

| Aspect | Truth |
|---|---|
| Inputs | same source panel; grid columns Partition / Төлөв / Үүсэх нэр / Одоогийн түүвэр / Устгах (checkbox only on «○ Загварт Partition алга» rows) |
| Actions | **one action per run** — each of «Дутууг үүсгэх», «Шүүлтүүр засах», «Сонгосныг устгах» closes the dialog and executes (`ScheduleSyncDialog.cs:190-248`); to do two, run the command twice. Delete asks a confirm (default No), re-checks at execution that the schedule exists, is not the template and not owned by someone else (`RSE:576-608`). Two Partitions mapping to one name: only the first is created, the other noted (`ScheduleSyncDialog.cs:192-209`). |
| Statuses | `+ Дутуу түүвэр`, `✓ Зөв`, `✓ Зөв (нэр өөр)`, `↻ Шүүлтүүр буруу`, `! Нэр мөргөлдөв`, `○ Загварт Partition алга` (`RFT:296-307`) |
| Strings | ToolTip ✔; LongDescription (`RFR:115-118`) ✔ («ЮУ Ч АВТОМАТААР УСТГАХГҮЙ…», statuses); omits "one action per run". |

## T10. Хуудас дугаарлах (`MglSheetNumerator`, `SheetNumeratorCommand`)

| Aspect | Truth |
|---|---|
| **Shape** | modeless, single-instance WPF window (`SheetNumeratorCommand.cs:44-60`), owned by the Revit main window; all Revit access via one `ExternalEvent` bridge (`SheetNumeratorBridge.cs`); window `Activated` re-checks freshness (`SheetNumeratorWindow.xaml.cs:67-69`, `SNV:922-963`); an unrelated document switch with a clean order silently reloads, otherwise a stale banner blocks Apply. **No in-window undo** — only Revit's Ctrl+Z; «Дарааллыг буцаах» only resets the pending list order; «Урьдчилсан өөрчлөлтийг нуух» tooltip says «(Revit-ийн Undo/Redo БИШ)» (`SheetNumeratorWindow.xaml:310`). |
| **Grouping** | «Бүлэглэж харах» (current Browser Organization: folders; Sheet Collections **Revit 2025+ only**; assembly sheets) or «Бүгдийг нэг бүлэгт» (+ «Хуудасны нэрээр эрэмбэлэх», all-in-one only). Group identity = (kind, folder path, collection id, assembly id), never the display name (`SheetNumerator/Core/Model.cs:61-151`). Browser sort reproduced by `NaturalComparer` (`SheetNumerator/Core/Grouping.cs:25-123`). Duplicate-number scope: `Global` on Revit 2024, `PerSheetCollection` on 2025+ (`SheetCollectionCompat.cs:35-38`). Browser-filtered-out sheets stay in duplicate checks. |
| **Reorder** | drag inside the current group only (cross-group drop rejected with «Хуудсыг зөвхөн ӨӨРИЙН бүлэг дотор зөөнө — өөр бүлэг рүү зөөх боломжгүй.», `Text.cs:266-267`, `SNV:473-489`), multi-select block moves, ▲ ▼ ⤒ ⤓ (Alt+↑/↓/Home/End), context menu. Changes only the in-memory `WorkingOrderState` (`WorkingOrder.cs:9-60`); switching group/refresh/mode/close with a dirty order asks for confirmation (`SNV:213-218,411-416,536-539`). |
| **Options (all to preserve)** | **Simple**: «Угтвар», «Эхлэх дугаар ашиглах» (off ⇒ prefix + *current number* + suffix), «Эхлэх дугаар» (negative allowed), «Дугаарын орон» (0–18), «Дагавар». **Advanced («Нарийвчилсан тохиргоо»)**: 3 parts, each Enabled · Угтвар · Утга (None/Fixed/Increment/Decrement) · Эхлэх · Алхам ≥1 · Дугаарын орон · Хязгаар (empty = none) · «Хязгаарт хүрвэл эхлэх утга руу буцаж, өмнөх хэсгийг нэмэх»; 2 free-text separators. **Shift** «Одоогийн дугаарын тоон хэсгийг өөрчлөх»: Өсгөх/Бууруулах (toggle), amount, «Тоон хэсэг» (default last). **Parameters**: «Параметрээс угтвар/дагавар авах», «Үр дүнг параметрт бичих» (+ source: full number / part 1-3 full or numeric), «Бүлгийн хуудасны тоог параметрт бичих» (+ «Зөвхөн эхний хуудсанд» / «Бүх хуудсанд»). **Name**: «Хуудасны нэрийн эхэнд/төгсгөлд дугаар нэмэх» + part + separator. **Scope**: «Сонгосон хуудаснаас эхлэх» (earlier rows unchanged but still checked for duplicates). **Move**: «Зөөхөд дугаарыг дагуулж шинэчлэх» — each sheet takes the group's *original* number of its new position. **Markers**: «Давхардлыг хэвлэгддэггүй Unicode тэмдэг ашиглан ялгах» (probe of what this Revit stores; U+200B default; first-use warning) and «Хэвлэгддэггүй тэмдэг цэвэрлэх». Effective-mode precedence CleanMarkers > Move > Shift > Advanced/Simple (`Settings.cs:217-229`). Parameter writes accept text, integer and unit-less number targets only (`Text.cs:126-129`). |
| **Preview** | pure engine `NumberingEngine.Compute` from snapshot + settings + order — writes nothing and calls no Revit API (`SheetNumerator/Core/NumberingEngine.cs:7-82`); 120 ms debounce; per-row state glyphs, global warnings, summary «Өөрчлөгдөх: N хуудас · Алдаа: … · Анхааруулга: …». «Хэрэгжүүлэх» (Ctrl+Enter) enabled only if not busy/stale and the plan has changes, no blocking error and no field parse error (`SNV:187-194`). |
| **Apply** | re-validates against **live** state (document key; each sheet exists with same UniqueId, number and name — else `Stale`; prohibited characters; live duplicates in the right scope; worksharing: other-user ownership / updated-or-deleted in central ⇒ `Blocked`, **no checkout attempted**; parameter bindings writable; read-only doc) (`SNA:55-134`) then Transaction A temp numbers → Transaction B final numbers, names, parameters (each re-read and compared) → verify → `Assimilate`; any exception ⇒ `RollBack` + verify original (`SNA:139-330`). Outcomes: Applied / NothingToDo / Stale / Blocked / RolledBack / RollbackUnverified (`ApplyContract.cs:39-57`). After Applied the Shift/Clean toggles are reset and the list is reloaded **without keeping the reorder** (`SNV:784-795`). |
| **Immediate edits in the same window** | context menu «Хуудасны нэр өөрчлөх» (prompt → own Transaction) and «Хуудас устгах» (confirm «хуудас болон Revit-ийн устгалтай холбоотой хамааралтай элементүүдийг устгах гэж байна» → `Document.Delete` cascades; refuses the active view) — **both change the model at once, not on «Хэрэгжүүлэх»** (`SNV:830-916`, `Text.cs:238-248`). |
| **Report** | status bar + summary; success flash «Хэрэгжүүллээ: N хуудасны дугаар, M нэр, K параметр. Нэг Ctrl+Z-ээр буцаана.» (`Text.cs:205-213`); stale banner; error dialogs via `IUserPrompts` with log path (`sheet-numerator.log`). |
| **Strings the user sees** | ToolTip «Зургийн хуудсыг Project Browser-ийн бүлэг дотор нь чирж эрэмбэлээд, дугаарыг нь нэг дор шинэчилнэ.» ✔. LongDescription (`APP:725-732`): grouping sentence ✔ (Sheet Collection only 2025+); «ЗӨВХӨН ӨӨРИЙН бүлэг дотор чирж эрэмбэлнэ — өөр бүлэг рүү зөөхгүй» ✔; mode list ✔ but incomplete (parameter prefix/suffix, result/count parameters, name numbering, start-from-selected, Unicode markers, clean-markers, all-in-one mode not listed); **«Урьдчилсан үр дүн… «Хэрэгжүүлэх» дарах хүртэл загвар ӨӨРЧЛӨГДӨХГҮЙ» ~ ✖ for rename/delete** (immediate); «Хэрэгжүүлэхэд бүх өөрчлөлт НЭГ дор хийгдэнэ — алдаа гарвал бүгд буцаж» ✔ (except the explicit `RollbackUnverified` outcome); «бүгдийг нэг Ctrl+Z-ээр буцаана» ✔ for Apply. |

## T11. Хуудас үүсгэх (`MglBatchSheets`, `BatchSheetCommand`, `BatchSheetDialog`)

| Aspect | Truth |
|---|---|
| Inputs | per discovered text parameter a row: «Дугаарт» checkbox, «Параметр», «Утга» (combo with values seen on existing sheets); parameters = text-type instance bindings on `OST_Sheets` plus writable string, non-built-in parameters found on existing sheets (`BatchSheetCommand.cs:229-304`); defaults: Classification / Sub-Discipline / Type Designator ticked. Fields: «Тусгаарлагч» (default «-»), «Эхлэх дугаар» (≥0), «Тоо ширхэг» (1–500), «Урт (0 = нөхөхгүй)» (0–10, default 3), «Гарчгийн хүснэгт (Title Block)» (default first real family, or «(гарчгийн хүснэгтгүй)»), «Хуудасны нэр (<n> = дугаар)» (default «Хуудас <n>»; empty ⇒ name left to Revit) (`BatchSheetDialog.xaml.cs:185-215`). **Planner** = the live preview in the dialog (≤8 lines + «… (нийт N)», marks «(давхцсан — алгасна)»; `:141-183`) over `PadNumber`/`ComposeNumber`/`ResolveName` (`BatchSheetCommand.cs:199-220`). Number = ticked non-empty values (listed order) joined by separator + separator + zero-padded counter. |
| Creates / modifies | `ViewSheet.Create(titleBlockId or Invalid)`, sets `SheetNumber`, `Name`, then each non-empty **string** parameter via `LookupParameter(name)` (by name — ambiguous if duplicated) if not read-only; activates an inactive title-block symbol (`:99-108`); **activates the first created sheet in the UI** (`:176-179`). Numbers already used are skipped but the counter is **not** shifted; a number Revit refuses ⇒ the blank sheet is deleted and counted skipped (`:116-143`). Name/parameter failure keeps the sheet (`:158-161`). |
| Transaction / report | single Transaction, **`Commit()` result unchecked and no outer try/catch** (`:95-174`); one Ctrl+Z. TaskDialog «Хуудас үүсгэлээ.»/«Хуудас үүсгэсэнгүй.», «Үүсгэсэн: N», «Алгассан (дугаар давхцсан): N», «Амжилтгүй: N», «Дугаар: first … last». No worksharing/read-only checks. |
| Strings | ToolTip ✔. LongDescription (`APP:711-714`): «Параметр (Classification / Sub-Discipline / Type Designator г.м.) сонгож, эхлэх дугаараас эхлээд заасан тоогоор хуудас үүсгэнэ.» ✔ (omits separator/padding/title block/name template/limits 1–500/duplicate skipping); «Энэ нь загварыг ӨӨРЧИЛНӨ — үйлдлийг Ctrl+Z-ээр буцаана.» ✔ (one step); not mentioned: first sheet gets activated. |

## T12. Зураг холбох (`MglRevitBinding`, `BindingCommand`, `BindingDialog`)

| Aspect | Truth |
|---|---|
| Model effect | none (`TransactionMode.ReadOnly`); writes sheet↔task bindings to the MGL server and (only if saved) runs `RevitTools.Run(..., "capture_baseline")` (`BindingCommand.cs:96-113`). |
| Flow | project doc → token+project (else `SettingsDialog`) → sheet list (`ViewSheet.UniqueId`, number, name, placed view count) → server handshake → dialog. Row = sheet, Drawing combo, Task combo (filtered by drawing), confidence. Pre-ticked: status `confirmed`, or confidence ≥ 0.8 with a task, and not `ignored` (`BindingDialog.xaml.cs:125,169-171`). Buttons «Итгэлтэй мөрүүдийг сонгох», «Бүгд», «Цэвэрлэх»; checkbox «Хуудас бүрийг ажлын дэд жагсаалтад автоматаар нэмэх» (default **on**, → `seed_checklist`); «Бүгдийг батлах» enabled only if ≥1 ready row and no ticked row without a task. **Unticked rows are saved as `ignored`** (selection kept) (`:210-248`). |
| Failure | errors shown with `RevitApi.FriendlyError`; 401 ⇒ re-login text. Esc/«Хаах» saves nothing. |
| Strings | ToolTip ✔. LongDescription (`APP:646-652`): «ЗААВАЛ БИШ…» ✔ (assistant pane only reminds, `AssistantPane.xaml.cs:1002-1009`); «Холбовол хоёр зүйл НЭМЭГДЭНЭ: дэд ажлын жагсаалт… ба «энэ ажлын хуудсыг харуул» ажиллана» ~ (the first is an optional checkbox; the second is server/pane behaviour not verified in this slice); «холбоос нь хуудасны дотоод танигчид (UniqueId) тулгуурладаг» ✔. Not mentioned: unticked rows become `ignored`. |

---

## F4 cross-check — help text vs engine (summary)

| Claim in help text | Engine reality | Verdict |
|---|---|---|
| `APP:749` «эргүүлэх, толин тусгал одоохондоо байхгүй» | `CTC:107-117` three-way switch; radios `CTC:312-313` | stale |
| `RFR:42` «Esc = загварт юу ч өөрчлөхгүй» and `RFR:47` «бүгдийг нэг Ctrl+Z-ээр буцаана» | pick loop: Esc finishes, symbols stay (`ESC:140`); one group per click (`ESC:163`, `ESS:235,283`, `RFT:453`); true only for the preselected branch and the bar-set prompt | stale for the main interactive path |
| `RFR:66` «…үл үзэгдэх лавлагаа шугамд… холбоно» | `RSR:268-271`, `RSR:339-343`, `RFT:830`: real references only; unreferenceable sides skipped and reported; no detail curves in the section code (only `RfMarkerDraw.cs:44` creates curves, for end-symbol markers) | stale |
